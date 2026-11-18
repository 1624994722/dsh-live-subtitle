/**
 * Live subtitles — Host half.
 *
 * Browser routes below /api bridge the page to DSH services:
 * - `/api/live-subtitle/status`     : speech-provider readiness + translator availability
 * - `/api/live-subtitle/prepare`    : start the local recognizer's model preparation
 * - `/api/live-subtitle/transcribe` : one canonical 16 kHz mono PCM16 WAV -> text
 * - `/api/live-subtitle/translate`  : one utterance -> translated text
 *
 * System-audio routes drive the native helper (`bin/live-subtitle-helper`):
 * - `/api/live-subtitle/system/start`  : capture system audio + show the always-on-top panel
 * - `/api/live-subtitle/system/stop`
 * - `/api/live-subtitle/system/config`: font size, display mode and target language
 * - `/api/live-subtitle/poll`          : completed subtitle lines for the in-app history
 *
 * Recognition stays on this machine; only recognized text goes to the translator.
 */
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const STATUS_PATH = '/api/live-subtitle/status'
const PREPARE_PATH = '/api/live-subtitle/prepare'
const TRANSCRIBE_PATH = '/api/live-subtitle/transcribe'
const TRANSLATE_PATH = '/api/live-subtitle/translate'
const SYSTEM_START_PATH = '/api/live-subtitle/system/start'
const SYSTEM_STOP_PATH = '/api/live-subtitle/system/stop'
const SYSTEM_CONFIG_PATH = '/api/live-subtitle/system/config'
const POLL_PATH = '/api/live-subtitle/poll'

const MAX_AUDIO_BYTES = 4 * 1024 * 1024
const MAX_BODY_BYTES = 8 * 1024 * 1024
const MAX_TEXT_CHARS = 4000
const MAX_TRANSLATE_CHARS = 1500
const REQUEST_TIMEOUT_MS = 45_000
const RATE = 16_000
const FRAME = 320
const MAX_LINES = 300

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
}

const HELPER_PATH = fileURLToPath(new URL(process.platform === 'win32' ? './bin/live-subtitle-helper.exe' : './bin/live-subtitle-helper', import.meta.url))

/**
 * @param {number} status - HTTP status.
 * @param {unknown} value - JSON-serializable body.
 * @returns {Response} JSON response.
 */
function respond(status, value) {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS })
}

/**
 * @param {number} status - HTTP status.
 * @param {string} code - stable machine code.
 * @param {string} message - human-readable detail.
 * @returns {Response} failure response.
 */
function failure(status, code, message) {
  return respond(status, { ok: false, error: { code, message } })
}

/**
 * @param {unknown} error - thrown value.
 * @returns {string} a short diagnostic without stack noise.
 */
function messageOf(error) {
  if (error instanceof Error) {
    const code = typeof error.code === 'string' && error.code.length > 0 ? `${error.code}: ` : ''
    return `${code}${error.message}`
  }
  return String(error)
}

/**
 * Read one bounded JSON body.
 * @param {Request} request - incoming request.
 * @returns {Promise<Record<string, unknown> | undefined>} parsed object or undefined.
 */
async function readJson(request) {
  const declared = Number(request.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return undefined
  let buffer
  try {
    buffer = await request.arrayBuffer()
  } catch {
    return undefined
  }
  if (buffer.byteLength > MAX_BODY_BYTES) return undefined
  let value
  try {
    value = JSON.parse(new TextDecoder().decode(buffer))
  } catch {
    return undefined
  }
  return typeof value === 'object' && value !== null ? value : undefined
}

/**
 * Client-disconnect plus a hard deadline.
 * @param {Request} request - incoming request.
 * @returns {AbortSignal} combined cancellation.
 */
function requestSignal(request) {
  return AbortSignal.any([request.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
}

/**
 * Split long text at sentence boundaries so every fragment fits the translator.
 * @param {string} text - source text.
 * @param {number} max - maximum UTF-16 length per fragment.
 * @returns {string[]} fragments whose concatenation is the source.
 */
function splitText(text, max) {
  if (text.length <= max) return [text]
  const fragments = []
  let rest = text
  const stops = new Set(['。', '！', '？', '；', '.', '!', '?', ';', '\n'])
  while (rest.length > max) {
    const window = rest.slice(0, max)
    let cut = -1
    for (let at = window.length - 1; at >= Math.floor(max / 2); at--) {
      if (stops.has(window[at])) {
        cut = at + 1
        break
      }
    }
    if (cut < 0) cut = max
    const last = rest.charCodeAt(cut - 1)
    if (cut > 1 && cut < rest.length && last >= 0xD800 && last <= 0xDBFF) cut -= 1
    fragments.push(rest.slice(0, cut))
    rest = rest.slice(cut)
  }
  if (rest.length > 0) fragments.push(rest)
  return fragments
}

const TARGET_NAMES = {
  'zh-Hans': 'Simplified Chinese',
  'zh-Hant': 'Traditional Chinese',
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
}

/**
 * @param {string} target - BCP 47-like target tag.
 * @returns {string} a human-readable language name for the prompt.
 */
function targetName(target) {
  return TARGET_NAMES[target] ?? target
}

/**
 * Translate one subtitle line with the user's configured chat model, streaming
 * partial output so the floating window fills in as tokens arrive.
 * @param {object} web - Host context carrying `llm` and `agentDefaultModel`.
 * @param {object} options - text, target, recent context, cancellation, partial sink.
 * @returns {Promise<string>} the final translation.
 */
async function translateWithLlm(web, { text, targetLanguage, context, signal, onPartial }) {
  const llm = web.get('llm')
  if (llm === undefined) throw new Error('LLM 服务不可用')
  const registered = typeof llm.listProviders === 'function'
    ? new Set(llm.listProviders().map((entry) => entry.id))
    : new Set()
  // Pin the fast subtitle model when a DeepSeek route is registered; otherwise
  // honor the user's default selection.
  let provider
  let model
  for (const candidate of ['deepseek-account', 'deepseek-official']) {
    if (registered.has(candidate)) {
      provider = candidate
      model = 'deepseek-flash'
      break
    }
  }
  if (provider === undefined) {
    const selection = web.get('agentDefaultModel')
    const chosen = selection !== undefined && typeof selection.currentSelection === 'function'
      ? selection.currentSelection()
      : undefined
    provider = chosen !== undefined && typeof chosen.provider === 'string' ? chosen.provider : 'deepseek-account'
    model = chosen !== undefined && typeof chosen.model === 'string' ? chosen.model : 'deepseek-flash'
  }
  const recent = (context ?? []).map((line, index) => `#${index + 1} ${line.original}\n→ ${line.translation}`).join('\n')
  const prompt = `${recent.length > 0 ? `Recent subtitles:\n${recent}\n\n` : ''}Translate this subtitle line into ${targetName(targetLanguage)}:\n${text}`
  let output = ''
  for await (const chunk of llm.stream({
    provider,
    model,
    system: `You are a professional real-time subtitle translator. Translate into ${targetName(targetLanguage)} naturally and concisely, matching spoken style. Return only the translation. Use the recent subtitles only to resolve pronouns, names and terminology. Never explain or answer the content.`,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    reasoningEffort: 'off',
    temperature: 0.2,
    maxTokens: 512,
    signal,
  })) {
    if (chunk.type === 'text-delta') {
      output += chunk.text
      if (onPartial !== undefined) onPartial(output)
    } else if (chunk.type === 'finish') {
      if (chunk.reason.kind === 'error') throw new Error(chunk.reason.failure.message)
      if (chunk.reason.kind === 'aborted') throw new Error('aborted')
    }
  }
  let result = output.trim()
  if (result.length > 1
    && ((result.startsWith('"') && result.endsWith('"')) || (result.startsWith('“') && result.endsWith('”')))) {
    result = result.slice(1, -1).trim()
  }
  result = result.replace(/^(Translation|译文|翻译)[:：]\s*/i, '')
  return result
}

/**
 * Translate through the configured translator service (Bing by default), with
 * the service's anonymous-endpoint retry retained.
 * @param {object} web - Host context carrying `translator`.
 * @param {object} options - text, target, optional source, cancellation.
 * @returns {Promise<string>} translated text.
 */
async function translateBing(web, { text, targetLanguage, sourceLanguage, signal }) {
  const translator = web.get('translator')
  if (translator === undefined) throw new Error('翻译服务未启用')
  const outputs = []
  for (const fragment of splitText(text, MAX_TRANSLATE_CHARS)) {
    const spec = translator.resolve({
      text: fragment,
      targetLanguage,
      ...(sourceLanguage === undefined ? {} : { sourceLanguage }),
    })
    try {
      outputs.push(await translator.translate(spec, signal))
    } catch (error) {
      if (signal.aborted) throw error
      await new Promise((resolve) => { setTimeout(resolve, 350) })
      outputs.push(await translator.translate(spec, signal))
    }
  }
  return outputs.join('')
}

/**
 * @param {Int16Array} samples - 16 kHz mono samples.
 * @returns {Uint8Array} canonical PCM16 WAV.
 */
function encodeWav(samples) {
  const bytes = new Uint8Array(44 + samples.length * 2)
  const view = new DataView(bytes.buffer)
  const text = (at, value) => {
    for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i)
  }
  text(0, 'RIFF')
  view.setUint32(4, bytes.length - 8, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, RATE, true)
  view.setUint32(28, RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, samples[i] / 32768))
    view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true)
  }
  return bytes
}

/**
 * Trim leading and trailing silence from 16 kHz mono samples.
 * @param {Int16Array} samples - samples.
 * @param {number} threshold - spoken RMS level in 0..1.
 * @returns {Int16Array} trimmed copy.
 */
function trimSilence(samples, threshold) {
  const frame = 160
  const pad = 80
  const rms = (at) => {
    const end = Math.min(samples.length, at + frame)
    let sum = 0
    for (let i = at; i < end; i++) {
      const value = samples[i] / 32768
      sum += value * value
    }
    return Math.sqrt(sum / Math.max(1, end - at))
  }
  let start = 0
  let end = samples.length
  while (start + frame < end && rms(start) < threshold * 0.6) start += frame
  while (end - frame > start && rms(end - frame) < threshold * 0.6) end -= frame
  start = Math.max(0, start - pad)
  end = Math.min(samples.length, end + pad)
  return samples.slice(start, end)
}

/**
 * Pause-delimited segmenter for a continuous 16 kHz mono PCM16 stream.
 * @param {(wav: Uint8Array) => void} onSegment - one finished utterance.
 * @returns {{ feed: (chunk: Uint8Array) => void, reset: () => void }} feed sink.
 */
function createPcmSegmenter(onSegment) {
  let pending = Buffer.alloc(0)
  let speaking = false
  let blocks = []
  let total = 0
  let silence = 0
  let noise = 0.004
  let threshold = 0.007
  let preroll = []
  let prerollCount = 0

  const finish = () => {
    const captured = blocks
    const capturedTotal = total
    speaking = false
    blocks = []
    total = 0
    silence = 0
    if (capturedTotal < RATE * 0.45) return
    const merged = new Int16Array(capturedTotal)
    let offset = 0
    for (const block of captured) {
      merged.set(block, offset)
      offset += block.length
    }
    const trimmed = trimSilence(merged, threshold)
    if (trimmed.length < RATE * 0.4) return
    onSegment(encodeWav(trimmed))
  }

  const frame = (samples) => {
    let sum = 0
    for (let i = 0; i < samples.length; i++) {
      const value = samples[i] / 32768
      sum += value * value
    }
    const rms = Math.sqrt(sum / samples.length)
    if (!speaking) {
      noise = noise * 0.98 + rms * 0.02
      threshold = Math.min(0.05, Math.max(0.007, noise * 2.4 + 0.0015))
      preroll.push(samples)
      prerollCount += samples.length
      while (prerollCount > RATE * 0.4 && preroll.length > 1) {
        prerollCount -= preroll[0].length
        preroll.shift()
      }
      if (rms > threshold) {
        speaking = true
        silence = 0
        blocks = preroll.slice()
        total = prerollCount
        preroll = []
        prerollCount = 0
      }
      return
    }
    blocks.push(samples)
    total += samples.length
    if (rms > threshold) silence = 0
    else silence += samples.length
    if ((silence >= RATE * 0.4 && total >= RATE * 0.6) || total >= RATE * 4.5) finish()
  }

  return {
    feed(chunk) {
      pending = pending.length === 0 ? Buffer.from(chunk) : Buffer.concat([pending, chunk])
      const usable = pending.length - (pending.length % (FRAME * 2))
      for (let offset = 0; offset < usable; offset += FRAME * 2) {
        const samples = new Int16Array(FRAME)
        for (let i = 0; i < FRAME; i++) samples[i] = pending.readInt16LE(offset + i * 2)
        frame(samples)
      }
      pending = pending.subarray(usable)
    },
    reset() {
      pending = Buffer.alloc(0)
      speaking = false
      blocks = []
      total = 0
      silence = 0
      preroll = []
      prerollCount = 0
    },
  }
}

/**
 * @param {string} stderr - helper diagnostics.
 * @returns {string} actionable failure text.
 */
function helperFailure(stderr) {
  if (/permission|SCStreamError|-3801|capture failed/i.test(stderr)) {
    return '需要「屏幕录制」权限：请在「系统设置 › 隐私与安全性 › 屏幕录制」中允许 DeepSeek Harness，然后重试。'
  }
  if (/stdin closed|stdout closed/i.test(stderr)) return '字幕浮窗已关闭。'
  return '系统声音字幕启动失败，请重试。'
}

/**
 * Create one system-audio session: spawn the native helper, segment its PCM,
 * recognize and translate each utterance, and forward subtitles to its panel.
 * @param {object} options - wiring.
 * @returns {object} session state.
 */
function createSystemSession({ web, font, mode, target, surface, engine, onExit }) {
  const subprocess = web.get('subprocess')
  if (subprocess === undefined) throw new Error('子进程服务不可用')
  if (!existsSync(HELPER_PATH)) throw new Error('缺少原生采集程序 bin/live-subtitle-helper')
  const handle = subprocess.spawn({
    argv: [HELPER_PATH, '--window', '--surface', surface === 'desktop' ? 'desktop' : 'floating', '--font', String(font), '--mode', String(mode)],
    cwd: dirname(HELPER_PATH),
    stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
    graceMs: 3000,
  })
  const session = {
    handle,
    target,
    engine: engine === 'fast' ? 'fast' : 'smart',
    seq: 0,
    lines: [],
    context: [],
    error: null,
    stderr: '',
    running: true,
    pending: Promise.resolve(),
    ready: null,
  }
  session.ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error('采集器启动超时')) }, 12_000)
    session.markReady = () => { clearTimeout(timer); resolve() }
    session.markFailed = (reason) => { clearTimeout(timer); reject(reason instanceof Error ? reason : new Error(String(reason))) }
  })

  const write = (value) => {
    if (handle.stdin === undefined || handle.stdin.destroyed) return
    try {
      handle.stdin.write(`${JSON.stringify(value)}\n`)
    } catch {
      // The helper exiting is reported through `done`, not a write failure.
    }
  }

  const transcribe = async (wav) => {
    if (!session.running) return
    const speech = web.get('speechToText')
    if (speech === undefined) return
    try {
      const spec = speech.resolve({ audio: wav, language: 'auto' })
      const transcript = await speech.transcribe(spec, AbortSignal.timeout(REQUEST_TIMEOUT_MS))
      const original = transcript.text.trim()
      if (original.length === 0) return
      write({ type: 'subtitle', original, translation: '' })
      let translation = ''
      let lastPartial = 0
      try {
        if (session.engine === 'smart') {
          translation = await translateWithLlm(web, {
            text: original,
            targetLanguage: session.target,
            context: session.context,
            signal: AbortSignal.timeout(30_000),
            onPartial: (partial) => {
              const now = Date.now()
              if (now - lastPartial < 120) return
              lastPartial = now
              if (session.running) write({ type: 'subtitle', original, translation: partial })
            },
          })
        } else {
          translation = await translateBing(web, {
            text: original, targetLanguage: session.target, signal: AbortSignal.timeout(20_000),
          })
        }
      } catch (_translationFailure) {
        if (session.running) {
          // A failing high-quality route should not retry for every line: fall
          // back to the fast route for the rest of this session, once.
          session.engine = 'fast'
          if (!session.fallbackNotified) {
            session.fallbackNotified = true
            write({ type: 'status', text: '高质量翻译不可用，已切换快速翻译' })
          }
          try {
            translation = await translateBing(web, {
              text: original, targetLanguage: session.target, signal: AbortSignal.timeout(20_000),
            })
          } catch {
            translation = ''
          }
        }
      }
      if (!session.running) return
      if (translation.length > 0) {
        session.context.push({ original, translation })
        if (session.context.length > 3) session.context.shift()
      }
      session.seq += 1
      const line = { seq: session.seq, original, translation, at: Date.now() }
      session.lines.push(line)
      if (session.lines.length > MAX_LINES) session.lines.shift()
      write({ type: 'subtitle', original, translation })
    } catch (error) {
      if (session.running) write({ type: 'status', text: '识别失败，继续收听…' })
      void error
    }
  }

  const segmenter = createPcmSegmenter((wav) => {
    session.pending = session.pending.then(() => transcribe(wav)).catch(() => undefined)
  })
  handle.stdout?.on('data', (chunk) => { segmenter.feed(chunk) })
  handle.stderr?.on('data', (chunk) => {
    session.stderr = (session.stderr + chunk.toString('utf8')).slice(-4000)
    if (session.stderr.includes('capture started')) session.markReady()
  })
  Promise.resolve(handle.done).then((outcome) => {
    session.running = false
    if (session.error === null && outcome.exitCode !== 0) session.error = helperFailure(session.stderr)
    if (!session.running) session.markFailed(session.error ?? '采集器已退出')
    onExit(session)
  }, (error) => {
    session.running = false
    session.error = messageOf(error)
    session.markFailed(error)
    onExit(session)
  })
  return session
}

/**
 * Mount the routes once the Connection service is present.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host plugin context.
 */
export function apply(ctx) {
  ctx.inject(['connection'], (web) => {
    /** The running system-audio session, if any. */
    let system = null

    /**
     * Register one exact, owner-only Fetch route.
     * @param {string} path - absolute /api path.
     * @param {(request: Request) => Promise<Response>} fetch - handler.
     */
    const route = (path, fetch) => {
      web.effect(
        () => web.connection.fetch.register({ path, methods: ['POST'], requestBody: 'buffered', fetch }),
        `live-subtitle: ${path}`,
      )
    }

    const stopSystem = () => {
      const current = system
      system = null
      if (current === null) return
      current.running = false
      try { current.handle.terminate() } catch { /* already gone */ }
    }

    web.effect(() => () => { stopSystem() }, 'live-subtitle: system session')

    route(STATUS_PATH, async () => {
      try {
        const speech = web.get('speechToText')
        const translator = web.get('translator')
        return respond(200, {
          ok: true,
          platform: process.platform,
          systemAvailable: existsSync(HELPER_PATH),
          desktopSupported: process.platform === 'darwin',
          speech: speech === undefined ? null : speech.snapshot(),
          translator: translator !== undefined,
          system: {
            running: system !== null && system.running,
            error: system === null ? null : system.error,
          },
        })
      } catch (error) {
        return failure(500, 'status-failed', messageOf(error))
      }
    })

    route(PREPARE_PATH, async () => {
      const speech = web.get('speechToText')
      if (speech === undefined) {
        return failure(503, 'unavailable', '语音识别未启用：请先启用「语音输入」插件')
      }
      try {
        const snapshot = speech.snapshot()
        speech.prepare(snapshot.selection.providerId)
        return respond(200, { ok: true, speech: speech.snapshot() })
      } catch (error) {
        return failure(500, 'prepare-failed', messageOf(error))
      }
    })

    route(TRANSCRIBE_PATH, async (request) => {
      const body = await readJson(request)
      if (body === undefined) return failure(400, 'bad-request', '请求体不是合法 JSON')
      const encoded = body.audioBase64
      if (typeof encoded !== 'string' || encoded.length === 0) {
        return failure(400, 'bad-request', '缺少 audioBase64')
      }
      if (encoded.length > Math.ceil(MAX_AUDIO_BYTES / 3) * 4) {
        return failure(413, 'too-large', '音频超过 4 MiB')
      }
      const audio = Buffer.from(encoded, 'base64')
      if (audio.length === 0 || audio.toString('base64') !== encoded) {
        return failure(400, 'bad-request', '音频必须是规范 base64')
      }
      if (audio.length > MAX_AUDIO_BYTES) return failure(413, 'too-large', '音频超过 4 MiB')
      const speech = web.get('speechToText')
      if (speech === undefined) {
        return failure(503, 'unavailable', '语音识别未启用：请先启用「语音输入」插件')
      }
      try {
        const spec = speech.resolve({
          audio,
          ...(typeof body.language === 'string' && body.language.length > 0 ? { language: body.language } : {}),
        })
        const transcript = await speech.transcribe(spec, requestSignal(request))
        return respond(200, {
          ok: true,
          text: transcript.text,
          audioSeconds: transcript.audioSeconds,
          inferenceSeconds: transcript.inferenceSeconds,
        })
      } catch (error) {
        const message = messageOf(error)
        if (message.includes('Invalid speech WAV') || message.includes('Unsupported language')) {
          return failure(400, 'invalid-audio', message)
        }
        return failure(502, 'transcription-failed', message)
      }
    })

    route(TRANSLATE_PATH, async (request) => {
      const body = await readJson(request)
      if (body === undefined) return failure(400, 'bad-request', '请求体不是合法 JSON')
      const text = typeof body.text === 'string' ? body.text.trim() : ''
      if (text.length === 0) return respond(200, { ok: true, text: '' })
      if (text.length > MAX_TEXT_CHARS * 4) return failure(413, 'too-large', '文本过长')
      const targetLanguage = typeof body.targetLanguage === 'string' && body.targetLanguage.length > 0
        ? body.targetLanguage
        : 'zh-Hans'
      const sourceLanguage = typeof body.sourceLanguage === 'string' && body.sourceLanguage.length > 0
        ? body.sourceLanguage
        : undefined
      const engine = body.engine === 'fast' ? 'fast' : 'smart'
      try {
        const signal = requestSignal(request)
        if (engine === 'smart') {
          try {
            const translated = await translateWithLlm(web, { text, targetLanguage, signal })
            return respond(200, { ok: true, text: translated })
          } catch (error) {
            if (signal.aborted) throw error
            // Fall through to the configured translator when the chat model is unavailable.
          }
        }
        const translated = await translateBing(web, { text, targetLanguage, sourceLanguage, signal })
        return respond(200, { ok: true, text: translated })
      } catch (error) {
        return failure(502, 'translation-failed', messageOf(error))
      }
    })

    route(SYSTEM_START_PATH, async (request) => {
      if (system !== null && system.running) return respond(200, { ok: true, running: true })
      if (!existsSync(HELPER_PATH)) {
        return failure(501, 'unsupported-platform', process.platform === 'darwin'
          ? '缺少原生采集程序 bin/live-subtitle-helper'
          : '当前平台暂不支持原生系统声音采集：请使用麦克风（Windows 可在声音设置中启用「立体声混音」，或安装 VB-Cable 后选择为输入设备）')
      }
      const body = await readJson(request)
      const settings = body === undefined ? {} : body
      const font = Number.isFinite(settings.font) ? Math.min(44, Math.max(14, settings.font)) : 26
      const mode = typeof settings.mode === 'string' ? settings.mode : 'both'
      const target = typeof settings.target === 'string' && settings.target.length > 0 ? settings.target : 'zh-Hans'
      const surface = settings.surface === 'desktop' ? 'desktop' : 'floating'
      const engine = settings.engine === 'fast' ? 'fast' : 'smart'
      let session
      try {
        session = createSystemSession({
          web, font, mode, target, surface, engine,
          onExit: (ended) => { if (system === ended) system = null },
        })
        system = session
        await session.ready
        return respond(200, { ok: true, running: true })
      } catch (error) {
        const message = messageOf(error)
        if (session !== undefined && session.running) {
          try { session.handle.terminate() } catch { /* already gone */ }
        }
        if (system === session) system = null
        const friendly = session !== undefined && session.stderr.length > 0 ? helperFailure(session.stderr) : null
        return failure(502, 'system-start-failed', friendly ?? message)
      }
    })

    route(SYSTEM_STOP_PATH, async () => {
      stopSystem()
      return respond(200, { ok: true, running: false })
    })

    route(SYSTEM_CONFIG_PATH, async (request) => {
      if (system === null) return respond(200, { ok: true, running: false })
      const body = await readJson(request)
      const settings = body === undefined ? {} : body
      if (typeof settings.target === 'string' && settings.target.length > 0) system.target = settings.target
      if (settings.engine === 'fast' || settings.engine === 'smart') system.engine = settings.engine
      const command = { type: 'config' }
      if (Number.isFinite(settings.font)) command.font = Math.min(44, Math.max(14, settings.font))
      if (typeof settings.mode === 'string') command.mode = settings.mode
      if (settings.surface === 'desktop' || settings.surface === 'floating') command.surface = settings.surface
      if (system.handle.stdin !== undefined && !system.handle.stdin.destroyed) {
        try { system.handle.stdin.write(`${JSON.stringify(command)}\n`) } catch { /* helper exiting */ }
      }
      return respond(200, { ok: true, running: system.running })
    })

    route(POLL_PATH, async (request) => {
      const body = await readJson(request)
      const after = body !== undefined && Number.isFinite(body.after) ? Number(body.after) : 0
      const lines = system === null ? [] : system.lines.filter((line) => line.seq > after)
      return respond(200, {
        ok: true,
        running: system !== null && system.running,
        seq: system === null ? 0 : system.seq,
        lines,
        error: system === null ? null : system.error,
      })
    })
  })
}
