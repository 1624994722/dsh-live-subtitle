/**
 * Live subtitles — browser half.
 *
 * A floating subtitle window registered into `shell.overlay`: it listens to the
 * microphone, cuts on natural pauses, sends each segment to the Host for local
 * sensevoice recognition and translation, and shows the original + translation
 * as it arrives.
 */

window.__ModuleLoader__.load({
  id: '@local/live-subtitle',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'live-subtitle'
    const STORE_KEY = 'dsh.live-subtitle.v1'
    const READY_PHASES = new Set(['ready', 'standby'])

    /** Host routes, browser-relative so a path-prefixing proxy keeps working. */
    const ROUTES = {
      status: 'api/live-subtitle/status',
      prepare: 'api/live-subtitle/prepare',
      transcribe: 'api/live-subtitle/transcribe',
      translate: 'api/live-subtitle/translate',
      systemStart: 'api/live-subtitle/system/start',
      systemStop: 'api/live-subtitle/system/stop',
      systemConfig: 'api/live-subtitle/system/config',
      poll: 'api/live-subtitle/poll',
    }

    const TARGETS = [
      ['zh-Hans', '中文（简体）'],
      ['zh-Hant', '繁體中文'],
      ['en', 'English'],
      ['ja', '日本語'],
      ['ko', '한국어'],
    ]

    const zh = {
      title: '实时字幕',
      start: '开始字幕',
      stop: '停止',
      starting: '正在连接麦克风…',
      startingSystem: '正在启动系统声音…',
      preparing: '正在准备语音模型…',
      listening: '正在收听',
      idle: '未开始',
      error: '出错了',
      retry: '重试',
      close: '关闭',
      clear: '清空',
      fontSmaller: '缩小字号',
      fontLarger: '放大字号',
      mode: '显示方式',
      modeBoth: '双语',
      modeTrans: '仅译文',
      modeOrig: '仅原文',
      size: '窗口大小',
      sizeNormal: '标准',
      sizeTall: '加高',
      sizeCompact: '精简',
      target: '翻译成',
      source: '声音来源',
      settings: '设置',
      engine: '翻译引擎',
      engineSmart: '高质量',
      engineFast: '快速',
      surface: '显示位置',
      surfaceFloating: '置顶浮窗',
      surfaceDesktop: '桌面挂件',
      fontSize: '字号',
      desktopHint: '桌面挂件贴在桌面上，会被应用窗口遮住；按 F11 或最小化窗口即可看到。',
      micDevice: '麦克风设备',
      deviceDefault: '默认麦克风',
      unavailable: '当前平台不可用',
      platformHintWin: 'Windows：在「设置 › 系统 › 声音 › 更多声音设置 › 录制」启用「立体声混音」，再在麦克风设备里选它；没有的话可安装 VB-Cable。字幕显示在 DSH 窗口内的浮层里。',
      platformHintOther: '当前平台暂不支持原生系统声音采集，请使用麦克风作为声音来源。',
      sourceMic: '麦克风',
      sourceSystem: '系统声音',
      systemHint: '系统声音模式会打开一个原生置顶字幕窗，直接抓取电脑正在播放的声音：不用外放，也不占用麦克风。',
      systemFloating: '字幕显示在独立的置顶小窗里，可拖动、可调字号；这个面板保留历史记录和控制。',
      systemClosed: '字幕浮窗已关闭。',
      systemFailed: '系统声音字幕启动失败：{message}',
      systemPermission: '需要「屏幕录制」权限：请在「系统设置 › 隐私与安全性 › 屏幕录制」中允许 DeepSeek Harness，然后重试。',
      emptyTitle: '把正在播放的声音变成双语字幕',
      emptyBody: '点击「开始字幕」，播放视频或音频并保持外放。声音会先在本机识别成文字，再翻译成目标语言。',
      emptyBodySystem: '点击「开始字幕」，播放视频或音频即可。电脑正在播放的声音会先在本机识别成文字，再翻译成目标语言。',
      hintMic: '使用麦克风收音：声音需要外放。系统声音不会被直接抓取。',
      hintLocal: '语音识别在本机完成，只有识别出的文字会发送给翻译服务。',
      prepBytes: '正在下载语音模型 {done} / {total}',
      noSpeech: '语音识别服务未启用：请在插件页启用「语音输入」。',
      noTranslator: '翻译服务未启用：只显示原文。',
      micDenied: '需要麦克风权限：请在「系统设置 › 隐私与安全性 › 麦克风」中允许 DeepSeek Harness。',
      micMissing: '没有找到可用的麦克风。',
      micUnavailable: '当前环境不支持麦克风录音。',
      micLost: '麦克风已断开：请检查设备后重试。',
      prepareShort: '准备中…',
      audioBlocked: '系统暂停了音频采集：请点击窗口后重试。',
      transcribeFailed: '这一段没有识别成功。',
      translateFailed: '翻译暂不可用，仅显示原文。',
      waiting: '识别中…',
      translating: '翻译中…',
      history: '已识别 {count} 句',
      panelHint: '拖动标题栏可以移动窗口，字号和显示方式会自动保存。',
    }

    const en = {
      title: 'Live subtitles',
      start: 'Start subtitles',
      stop: 'Stop',
      starting: 'Connecting to the microphone…',
      startingSystem: 'Starting system audio…',
      preparing: 'Preparing the speech model…',
      listening: 'Listening',
      idle: 'Not started',
      error: 'Something went wrong',
      retry: 'Retry',
      close: 'Close',
      clear: 'Clear',
      fontSmaller: 'Smaller text',
      fontLarger: 'Larger text',
      mode: 'Display',
      modeBoth: 'Both',
      modeTrans: 'Translation',
      modeOrig: 'Original',
      size: 'Window size',
      sizeNormal: 'Normal',
      sizeTall: 'Tall',
      sizeCompact: 'Compact',
      target: 'Translate to',
      source: 'Audio source',
      settings: 'Settings',
      engine: 'Engine',
      engineSmart: 'High quality',
      engineFast: 'Fast',
      surface: 'Placement',
      surfaceFloating: 'Always on top',
      surfaceDesktop: 'Desktop widget',
      fontSize: 'Text size',
      desktopHint: 'The desktop widget sits on the desktop and is covered by app windows; press F11 or minimize windows to see it.',
      micDevice: 'Microphone',
      deviceDefault: 'Default microphone',
      unavailable: 'unavailable on this platform',
      platformHintWin: 'Windows: enable Stereo Mix under Settings › System › Sound › More sound settings › Recording, then pick it as the microphone; or install VB-Cable. Subtitles appear in the in-app overlay.',
      platformHintOther: 'Native system audio is not available on this platform; use the microphone as the source.',
      sourceMic: 'Microphone',
      sourceSystem: 'System audio',
      systemHint: 'System audio opens a native always-on-top window that captures what the computer is playing: no speakers needed, and the microphone stays free.',
      systemFloating: 'Subtitles appear in a separate always-on-top window you can drag and resize; this panel keeps history and controls.',
      systemClosed: 'The subtitle window was closed.',
      systemFailed: 'System audio subtitles could not start: {message}',
      systemPermission: 'Screen Recording permission is required: allow DeepSeek Harness in System Settings › Privacy & Security › Screen Recording, then try again.',
      emptyTitle: 'Turn what is playing into bilingual subtitles',
      emptyBody: 'Start subtitles and play the video or audio out loud. Sound is recognized on this machine first, then translated.',
      emptyBodySystem: 'Start subtitles, then play the video or audio. What the computer plays is recognized on this machine first, then translated.',
      hintMic: 'Uses the microphone: play the sound out loud. System audio is not captured directly.',
      hintLocal: 'Recognition runs on this machine; only recognized text goes to the translation service.',
      prepBytes: 'Downloading the speech model {done} / {total}',
      noSpeech: 'Speech recognition is off: enable Voice input in the Plugins page.',
      noTranslator: 'Translation is off: only the original text is shown.',
      micDenied: 'Microphone permission is required: allow DeepSeek Harness in System Settings › Privacy & Security › Microphone.',
      micMissing: 'No microphone was found.',
      micUnavailable: 'Microphone recording is not available in this environment.',
      micLost: 'The microphone disconnected: check the device and try again.',
      prepareShort: 'Preparing…',
      audioBlocked: 'Audio capture is suspended: click the window and try again.',
      transcribeFailed: 'This segment could not be recognized.',
      translateFailed: 'Translation is unavailable; showing the original only.',
      waiting: 'Recognizing…',
      translating: 'Translating…',
      history: '{count} lines',
      panelHint: 'Drag the header to move this window; text size and display mode are remembered.',
    }

    const css = `
.ls-root{position:fixed;inset:0;pointer-events:none;z-index:2147482000;font-family:inherit;color:#f4f5f7}
.ls-ball{position:fixed;touch-action:none;width:46px;height:46px;border-radius:50%;background:rgba(20,21,25,.9);border:1px solid rgba(255,255,255,.14);box-shadow:0 10px 30px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;pointer-events:auto;cursor:grab;color:#f4f5f7;backdrop-filter:blur(12px);transition:transform .12s ease}
.ls-ball:hover{transform:scale(1.04)}
.ls-ball.live{border-color:#7aa2ff;box-shadow:0 0 0 1px rgba(122,162,255,.35),0 10px 30px rgba(0,0,0,.4)}
.ls-ball svg{display:block}
.ls-panel{position:fixed;display:flex;flex-direction:column;border-radius:16px;background:rgba(17,18,22,.88);border:1px solid rgba(255,255,255,.12);box-shadow:0 24px 64px rgba(0,0,0,.5);backdrop-filter:blur(24px) saturate(1.25);pointer-events:auto;overflow:hidden;min-width:340px;min-height:200px;color:#f4f5f7;color-scheme:dark}
.ls-head{display:flex;align-items:center;gap:8px;padding:10px 12px;cursor:grab;touch-action:none;user-select:none;border-bottom:1px solid rgba(255,255,255,.08);flex:none}
.ls-badge{font-size:10px;font-weight:700;letter-spacing:.6px;padding:2px 5px;border-radius:5px;background:rgba(122,162,255,.16);color:#9db8ff}
.ls-htitle{font-size:13px;font-weight:600}
.ls-hstatus{font-size:11.5px;color:rgba(255,255,255,.58);margin-left:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:230px}
.ls-dot{width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.28);flex:none}
.ls-dot.live{background:#5ad19a;animation:ls-pulse 1.2s ease-in-out infinite}
.ls-dot.error{background:#ff7676}
@keyframes ls-pulse{0%,100%{opacity:.35}50%{opacity:1}}
.ls-close{width:24px;height:24px;border:none;border-radius:6px;background:transparent;color:rgba(255,255,255,.55);cursor:pointer;font-size:15px;line-height:1;display:flex;align-items:center;justify-content:center;flex:none}
.ls-close:hover{background:rgba(255,255,255,.08);color:#fff}
.ls-body{flex:1;overflow-y:auto;overscroll-behavior:contain;padding:4px 14px 8px;scrollbar-width:thin}
.ls-line{padding:9px 0;border-bottom:1px solid rgba(255,255,255,.07)}
.ls-line:last-child{border-bottom:none}
.ls-orig{color:rgba(255,255,255,.55);font-size:max(12px,calc(var(--ls-font,22px) * .72));line-height:1.35;margin-bottom:2px;word-break:break-word}
.ls-trans{color:#f4f5f7;font-size:var(--ls-font,22px);line-height:1.42;font-weight:600;word-break:break-word}
.ls-line.pending .ls-trans{color:rgba(255,255,255,.45);font-weight:400;opacity:.8}
.ls-line.failed .ls-trans{color:#ff8a8a;font-size:12.5px;font-weight:400}
.ls-note{color:#f2b86b;font-size:11.5px;margin-top:3px}
.ls-time{display:flex;align-items:center;gap:10px;margin:10px 0 2px;color:rgba(255,255,255,.32);font-size:10.5px;letter-spacing:.4px}
.ls-time::before,.ls-time::after{content:'';flex:1;height:1px;background:rgba(255,255,255,.07)}
.ls-live{display:flex;align-items:center;gap:8px;padding:10px 2px 4px;color:rgba(255,255,255,.5);font-size:12px}
.ls-eq{display:flex;align-items:flex-end;gap:2px;height:13px}
.ls-eq i{width:3px;border-radius:2px;background:#5ad19a;transition:height .12s linear}
.ls-empty{padding:18px 14px 20px;display:flex;flex-direction:column;gap:9px}
.ls-empty h3{font-size:14px;font-weight:600;margin:0;color:#f4f5f7}
.ls-empty p{font-size:12.5px;line-height:1.65;margin:0;color:rgba(255,255,255,.58)}
.ls-prep{padding:16px 14px 18px;display:flex;flex-direction:column;gap:8px}
.ls-prep p{font-size:12.5px;margin:0;color:rgba(255,255,255,.58)}
.ls-bar{height:5px;border-radius:3px;background:rgba(255,255,255,.1);overflow:hidden}
.ls-bar i{display:block;height:100%;background:#7aa2ff;transition:width .2s ease}
.ls-err{padding:16px 14px;font-size:12.5px;line-height:1.6;color:#ff9b9b;display:flex;flex-direction:column;gap:9px;align-items:flex-start}
.ls-foot{display:flex;align-items:center;gap:8px;padding:9px 12px;border-top:1px solid rgba(255,255,255,.08);background:rgba(0,0,0,.18);flex:none}
.ls-primary{border:none;border-radius:9px;padding:7px 14px;font-size:12.5px;font-weight:600;cursor:pointer;background:#7aa2ff;color:#0c1222;white-space:nowrap}
.ls-primary:hover{background:#8fb2ff}
.ls-primary:disabled{opacity:.55;cursor:default}
.ls-primary.stop{background:rgba(255,118,118,.16);color:#ff9b9b}
.ls-footmeta{font-size:11px;color:rgba(255,255,255,.45);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.ls-ghost{height:28px;padding:0 8px;border:1px solid rgba(255,255,255,.12);border-radius:8px;background:transparent;color:rgba(255,255,255,.72);cursor:pointer;font-size:11.5px;display:inline-flex;align-items:center;gap:4px;white-space:nowrap;flex:none}
.ls-ghost:hover{background:rgba(255,255,255,.08);color:#fff}
.ls-ghost.on{background:rgba(122,162,255,.16);border-color:rgba(122,162,255,.4);color:#b9ccff}
.ls-settings{position:absolute;left:0;right:0;bottom:46px;z-index:3;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 12px;padding:12px 12px 14px;border-top:1px solid rgba(255,255,255,.1);background:rgba(20,21,26,.98);box-shadow:0 -14px 34px rgba(0,0,0,.45);max-height:calc(100% - 92px);overflow:auto;border-radius:0 0 14px 14px}
.ls-field{display:flex;align-items:center;gap:6px;font-size:11.5px;color:rgba(255,255,255,.55);min-width:0}
.ls-field>span{white-space:nowrap;flex:none}
.ls-select{height:26px;border:1px solid rgba(255,255,255,.14);border-radius:7px;background:rgba(255,255,255,.07);color:#f4f5f7;font-size:11.5px;padding:0 4px;min-width:0;flex:1}
.ls-select option{background:#1b1d23;color:#f4f5f7}
.ls-step{height:26px;min-width:26px;padding:0 6px;border:1px solid rgba(255,255,255,.14);border-radius:7px;background:rgba(255,255,255,.05);color:#f4f5f7;cursor:pointer;font-size:12px}
.ls-step:hover{background:rgba(255,255,255,.1)}
.ls-value{min-width:30px;text-align:center;color:#f4f5f7;font-size:12px}
.ls-spacer{flex:1}
.ls-toast{position:absolute;left:12px;right:12px;bottom:52px;background:rgba(35,37,43,.96);border:1px solid rgba(255,255,255,.12);border-radius:9px;padding:7px 10px;font-size:11.5px;color:rgba(255,255,255,.72)}
@media (prefers-reduced-motion: reduce){.ls-dot.live{animation:none}.ls-ball{transition:none}.ls-bar i{transition:none}.ls-eq i{transition:none}}
`

    // ---------------------------------------------------------------------
    // Audio helpers
    // ---------------------------------------------------------------------

    /**
     * @param {number} at - slice start.
     * @param {number} count - slice length.
     * @returns {number} root-mean-square amplitude.
     */
    function rmsAt(samples, at, count) {
      let sum = 0
      const end = Math.min(samples.length, at + count)
      for (let i = at; i < end; i++) {
        const value = samples[i]
        sum += value * value
      }
      return Math.sqrt(sum / Math.max(1, end - at))
    }

    /**
     * Trim leading and trailing silence.
     * @param {Float32Array} samples - mono samples.
     * @param {number} threshold - speech amplitude.
     * @returns {Float32Array} trimmed copy.
     */
    function trimSilence(samples, threshold) {
      const frame = 160
      const pad = 80
      let start = 0
      let end = samples.length
      while (start + frame < end && rmsAt(samples, start, frame) < threshold * 0.6) start += frame
      while (end - frame > start && rmsAt(samples, end - frame, frame) < threshold * 0.6) end -= frame
      start = Math.max(0, start - pad)
      end = Math.min(samples.length, end + pad)
      return samples.slice(start, end)
    }

    /**
     * @param {Float32Array} samples - 16 kHz mono samples.
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
      view.setUint32(24, 16000, true)
      view.setUint32(28, 32000, true)
      view.setUint16(32, 2, true)
      view.setUint16(34, 16, true)
      text(36, 'data')
      view.setUint32(40, samples.length * 2, true)
      for (let i = 0; i < samples.length; i++) {
        const value = Math.max(-1, Math.min(1, samples[i]))
        view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true)
      }
      return bytes
    }

    /**
     * @param {Uint8Array} bytes - binary data.
     * @returns {string} canonical base64.
     */
    function toBase64(bytes) {
      let binary = ''
      for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192))
      }
      return btoa(binary)
    }

    /**
     * @param {Float32Array} samples - source samples.
     * @param {number} fromRate - source sample rate.
     * @returns {Promise<Float32Array>} 16 kHz samples.
     */
    async function resampleTo16k(samples, fromRate) {
      const frames = Math.max(1, Math.round(samples.length * 16000 / fromRate))
      const offline = new OfflineAudioContext(1, frames, 16000)
      const buffer = offline.createBuffer(1, samples.length, fromRate)
      buffer.copyToChannel(samples, 0)
      const source = offline.createBufferSource()
      source.buffer = buffer
      source.connect(offline.destination)
      source.start()
      const rendered = await offline.startRendering()
      return rendered.getChannelData(0)
    }

    /**
     * Turns a live microphone stream into pause-delimited speech segments.
     */
    class Segmenter {
      /**
       * @param {(wav: Uint8Array) => void} onSegment - one finished utterance.
       * @param {(level: number) => void} onLevel - normalized input level.
       */
      constructor(onSegment, onLevel, onEnded) {
        this.onSegment = onSegment
        this.onLevel = onLevel
        this.onEnded = onEnded
        this.stream = null
        this.context = null
        this.source = null
        this.processor = null
        this.silent = null
        this.rate = 16000
        this.blockSeconds = 0.128
        this.speaking = false
        this.blocks = []
        this.blockLength = 0
        this.preroll = []
        this.prerollLength = 0
        this.silenceBlocks = 0
        this.noise = 0.004
        this.threshold = 0.007
        this.closed = true
        this.pending = Promise.resolve()
      }

      async start(deviceId) {
        if (navigator.mediaDevices === undefined || typeof navigator.mediaDevices.getUserMedia !== 'function') {
          throw new Error('unsupported')
        }
        try {
          const base = {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: 1,
          }
          try {
            this.stream = await navigator.mediaDevices.getUserMedia({
              audio: deviceId === '' || deviceId === undefined
                ? base
                : { ...base, deviceId: { exact: deviceId } },
              video: false,
            })
          } catch (failure) {
            if (deviceId !== undefined && deviceId !== ''
              && (failure.name === 'OverconstrainedError' || failure.name === 'NotFoundError')) {
              // The remembered device disappeared; fall back to the system default.
              this.stream = await navigator.mediaDevices.getUserMedia({ audio: base, video: false })
            } else {
              throw failure
            }
          }
          try {
            this.context = new AudioContext({ sampleRate: 16000 })
          } catch (_unsupportedRate) {
            this.context = new AudioContext()
          }
          this.rate = this.context.sampleRate
          this.blockSeconds = 2048 / this.rate
          this.source = this.context.createMediaStreamSource(this.stream)
          await Promise.race([
            this.context.resume(),
            new Promise((resolve) => { window.setTimeout(resolve, 2000) }),
          ])
          if (this.context.state !== 'running') throw new Error('audio-blocked')
          this.processor = this.context.createScriptProcessor(2048, 1, 1)
          this.processor.onaudioprocess = (event) => {
            if (this.closed) return
            this.block(new Float32Array(event.inputBuffer.getChannelData(0)))
          }
          this.silent = this.context.createGain()
          this.silent.gain.value = 0
          this.source.connect(this.processor)
          this.processor.connect(this.silent)
          this.silent.connect(this.context.destination)
          this.closed = false
          const track = this.stream.getAudioTracks()[0]
          if (track !== undefined) track.addEventListener('ended', () => {
            try { this.onEnded() } finally { this.stop() }
          })
        } catch (failure) {
          this.stop()
          throw failure
        }
      }

      stop() {
        if (this.closed && this.context === null && this.stream === null
          && this.source === null && this.processor === null && this.silent === null) return
        this.closed = true
        try { if (this.processor !== null) this.processor.disconnect() } catch (_ignored) { /* already detached */ }
        try { if (this.source !== null) this.source.disconnect() } catch (_ignored) { /* already detached */ }
        try { if (this.silent !== null) this.silent.disconnect() } catch (_ignored) { /* already detached */ }
        if (this.stream !== null) this.stream.getTracks().forEach((item) => { item.stop() })
        const context = this.context
        this.context = null
        if (context !== null && context.state !== 'closed') context.close().catch(() => undefined)
        this.stream = null
        this.source = null
        this.processor = null
        this.silent = null
        this.speaking = false
        this.blocks = []
        this.preroll = []
        this.prerollLength = 0
        this.silenceBlocks = 0
      }

      block(data) {
        const energy = rmsAt(data, 0, data.length)
        this.onLevel(Math.min(1, energy * 18))
        if (!this.speaking) {
          this.noise = this.noise * 0.98 + energy * 0.02
          this.threshold = Math.min(0.05, Math.max(0.007, this.noise * 2.4 + 0.0015))
          this.preroll.push(data)
          this.prerollLength += data.length
          while (this.prerollLength > this.rate * 0.4 && this.preroll.length > 1) {
            this.prerollLength -= this.preroll[0].length
            this.preroll.shift()
          }
          if (energy > this.threshold) {
            this.speaking = true
            this.silenceBlocks = 0
            this.blocks = this.preroll.slice()
            this.blockLength = this.prerollLength
            this.preroll = []
            this.prerollLength = 0
          }
          return
        }
        this.blocks.push(data)
        this.blockLength += data.length
        if (energy > this.threshold) this.silenceBlocks = 0
        else this.silenceBlocks += 1
        const silence = this.silenceBlocks * this.blockSeconds
        if ((silence >= 0.4 && this.blockLength >= this.rate * 0.6) || this.blockLength >= this.rate * 4.5) {
          this.finish()
        }
      }

      finish() {
        const blocks = this.blocks
        const total = this.blockLength
        this.speaking = false
        this.blocks = []
        this.blockLength = 0
        this.silenceBlocks = 0
        if (blocks.length === 0 || total < this.rate * 0.45) return
        const merged = new Float32Array(total)
        let offset = 0
        for (const block of blocks) {
          merged.set(block, offset)
          offset += block.length
        }
        const trimmed = trimSilence(merged, this.threshold)
        if (trimmed.length < this.rate * 0.4) return
        this.pending = this.pending
          .then(() => this.emit(trimmed))
          .catch(() => undefined)
      }

      async emit(samples) {
        const pcm = this.rate === 16000 ? samples : await resampleTo16k(samples, this.rate)
        this.onSegment(encodeWav(pcm))
      }
    }

    // ---------------------------------------------------------------------
    // Settings + helpers
    // ---------------------------------------------------------------------

    /**
     * @param {number} value - candidate.
     * @param {number} min - lower bound.
     * @param {number} max - upper bound.
     * @returns {number} clamped value.
     */
    function clamp(value, min, max) {
      return Math.max(min, Math.min(max, value))
    }

    /**
     * @returns {object} stored settings merged with defaults.
     */
    function loadSettings() {
      const defaults = {
        font: 22,
        mode: 'both',
        target: 'zh-Hans',
        source: 'system',
        surface: 'floating',
        engine: 'smart',
        micDeviceId: '',
        size: 'normal',
        x: Math.max(12, Math.round(window.innerWidth - 592)),
        y: Math.max(12, Math.round(window.innerHeight - 500)),
        ballX: Math.max(12, Math.round(window.innerWidth - 74)),
        ballY: Math.max(12, Math.round(window.innerHeight - 210)),
      }
      try {
        const raw = window.localStorage.getItem(STORE_KEY)
        if (raw === null) return defaults
        const parsed = JSON.parse(raw)
        if (typeof parsed !== 'object' || parsed === null) return defaults
        return {
          font: clamp(Number(parsed.font) || defaults.font, 14, 36),
          mode: ['both', 'trans', 'orig'].includes(parsed.mode) ? parsed.mode : defaults.mode,
          target: TARGETS.some(([id]) => id === parsed.target) ? parsed.target : defaults.target,
          source: ['system', 'mic'].includes(parsed.source) ? parsed.source : defaults.source,
          surface: ['floating', 'desktop'].includes(parsed.surface) ? parsed.surface : defaults.surface,
          engine: ['smart', 'fast'].includes(parsed.engine) ? parsed.engine : defaults.engine,
          micDeviceId: typeof parsed.micDeviceId === 'string' ? parsed.micDeviceId : defaults.micDeviceId,
          size: ['normal', 'tall', 'compact'].includes(parsed.size) ? parsed.size : defaults.size,
          x: Number.isFinite(parsed.x) ? clamp(parsed.x, 0, window.innerWidth - 180) : defaults.x,
          y: Number.isFinite(parsed.y) ? clamp(parsed.y, 0, window.innerHeight - 60) : defaults.y,
          ballX: Number.isFinite(parsed.ballX) ? clamp(parsed.ballX, 0, window.innerWidth - 46) : defaults.ballX,
          ballY: Number.isFinite(parsed.ballY) ? clamp(parsed.ballY, 0, window.innerHeight - 46) : defaults.ballY,
        }
      } catch (_ignored) {
        return defaults
      }
    }

    /**
     * @param {unknown} error - thrown value.
     * @param {string} fallback - fallback message.
     * @returns {string} user-facing text.
     */
    function errorText(error, fallback) {
      if (error instanceof DOMException) {
        if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return 'mic-denied'
        if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') return 'mic-missing'
      }
      if (error instanceof Error && error.message.length > 0) return error.message
      return fallback
    }

    /**
     * @param {string} path - browser-relative route.
     * @param {object} body - JSON body.
     * @param {number} timeoutMs - deadline.
     * @param {AbortSignal | undefined} session - session cancellation.
     * @returns {Promise<any>} decoded response.
     */
    async function postJson(path, body, timeoutMs, session) {
      const controller = new AbortController()
      const timer = window.setTimeout(() => {
        controller.abort(new DOMException('timeout', 'TimeoutError'))
      }, timeoutMs)
      const relay = () => { controller.abort(session === undefined ? undefined : session.reason) }
      if (session !== undefined) session.addEventListener('abort', relay, { once: true })
      try {
        const response = await fetch(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
          cache: 'no-store',
        })
        let value = null
        try {
          value = await response.json()
        } catch (_invalidJson) {
          value = null
        }
        if (!response.ok || (value !== null && value.ok === false)) {
          const detail = value !== null && value.error !== undefined ? value.error.message : undefined
          const error = new Error(typeof detail === 'string' && detail.length > 0 ? detail : `HTTP ${response.status}`)
          const code = value !== null && value.error !== undefined ? value.error.code : undefined
          if (typeof code === 'string') error.code = code
          throw error
        }
        if (value === null) throw new Error('服务返回了无法解析的结果')
        return value
      } finally {
        window.clearTimeout(timer)
        if (session !== undefined) session.removeEventListener('abort', relay)
      }
    }

    /**
     * @param {number} ms - delay.
     * @param {AbortSignal} signal - cancellation.
     * @returns {Promise<void>} settles after the delay.
     */
    function sleep(ms, signal) {
      return new Promise((resolve, reject) => {
        if (signal.aborted) {
          reject(signal.reason)
          return
        }
        const timer = window.setTimeout(() => {
          signal.removeEventListener('abort', onAbort)
          resolve()
        }, ms)
        const onAbort = () => {
          window.clearTimeout(timer)
          reject(signal.reason)
        }
        signal.addEventListener('abort', onAbort, { once: true })
      })
    }

    /**
     * @param {string} key - dictionary key.
     * @param {string} text - source text used for size hints.
     * @returns {string} formatted text.
     */
    function fill(text, values) {
      return text.replace(/\{(\w+)\}/g, (match, name) => {
        const value = values[name]
        return value === undefined ? match : String(value)
      })
    }

    // ---------------------------------------------------------------------
    // SVG glyphs
    // ---------------------------------------------------------------------

    function iconMic(size) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
        h('rect', { x: 9, y: 3, width: 6, height: 11, rx: 3, stroke: 'currentColor', strokeWidth: 1.8 }),
        h('path', { d: 'M5 11a7 7 0 0 0 14 0M12 18v3', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' }))
    }

    function iconClose() {
      return h('svg', { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', 'aria-hidden': true },
        h('path', { d: 'M3 3l8 8M11 3l-8 8', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }))
    }

    function iconBars(active) {
      return h('svg', { width: 22, height: 22, viewBox: '0 0 22 22', fill: 'none', 'aria-hidden': true },
        h('rect', { x: 2, y: 8, width: 3.2, height: 6, rx: 1.6, fill: 'currentColor', opacity: active ? 0.95 : 0.55 }),
        h('rect', { x: 9.4, y: 4, width: 3.2, height: 14, rx: 1.6, fill: 'currentColor', opacity: active ? 0.95 : 0.55 }),
        h('rect', { x: 16.8, y: 8, width: 3.2, height: 6, rx: 1.6, fill: 'currentColor', opacity: active ? 0.95 : 0.55 }))
    }

    // ---------------------------------------------------------------------
    // Component
    // ---------------------------------------------------------------------

    /**
     * @param {{ t?: (key: string) => string }} props - synthesized slot props.
     * @returns {React.ReactElement} floating subtitle surface.
     */
    function App(props = {}) {
      const translate = typeof props.t === 'function' ? props.t : (key) => (zh[key] ?? key)
      const tr = (key) => {
        const value = translate(key)
        return typeof value === 'string' && value !== key ? value : (zh[key] ?? key)
      }

      const [open, setOpen] = React.useState(false)
      const [phase, setPhase] = React.useState('idle')
      const [entries, setEntries] = React.useState([])
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [level, setLevel] = React.useState(0)
      const [prep, setPrep] = React.useState(null)
      const [settings, setSettings] = React.useState(loadSettings)
      const [showSettings, setShowSettings] = React.useState(false)
      const [devices, setDevices] = React.useState([])
      const [systemAvailable, setSystemAvailable] = React.useState(true)
      const [platform, setPlatform] = React.useState('')

      const settingsRef = React.useRef(settings)
      settingsRef.current = settings
      const phaseRef = React.useRef(phase)
      phaseRef.current = phase
      const segmenterRef = React.useRef(null)
      const abortRef = React.useRef(null)
      const queueRef = React.useRef([])
      const busyRef = React.useRef(false)
      const seqRef = React.useRef(0)
      const sessionSeqRef = React.useRef(0)
      const tokenRef = React.useRef(0)
      const pumpRef = React.useRef(null)
      const listRef = React.useRef(null)
      const autoScrollRef = React.useRef(true)
      const levelAtRef = React.useRef(0)
      const noticeTimerRef = React.useRef(0)
      const dragRef = React.useRef(null)
      const systemPollRef = React.useRef(0)
      const pollBusyRef = React.useRef(false)
      const lastSeqRef = React.useRef(0)

      const patch = (values) => {
        setSettings((previous) => ({ ...previous, ...values }))
      }

      const showNotice = (text) => {
        setNotice(text)
        window.clearTimeout(noticeTimerRef.current)
        noticeTimerRef.current = window.setTimeout(() => { setNotice('') }, 6000)
      }

      const systemErrorMessage = (message) => {
        if (/屏幕录制|Screen Recording|permission|SCStreamError/i.test(message)) return tr('systemPermission')
        return fill(tr('systemFailed'), { message })
      }

      const stopPolling = () => {
        if (systemPollRef.current !== 0) {
          window.clearInterval(systemPollRef.current)
          systemPollRef.current = 0
        }
      }

      const appendLines = (lines) => {
        if (!Array.isArray(lines) || lines.length === 0) return
        let highest = lastSeqRef.current
        const fresh = []
        for (const line of lines) {
          if (typeof line.seq !== 'number' || line.seq <= lastSeqRef.current) continue
          highest = Math.max(highest, line.seq)
          fresh.push({
            id: line.seq,
            original: String(line.original ?? ''),
            translation: String(line.translation ?? ''),
            state: 'done',
            note: '',
            at: Number.isFinite(line.at) ? line.at : Date.now(),
          })
        }
        lastSeqRef.current = highest
        if (fresh.length === 0) return
        setEntries((previous) => [...previous, ...fresh].slice(-300))
      }

      const pollSystem = async (signal) => {
        if (pollBusyRef.current) return
        pollBusyRef.current = true
        try {
          const result = await postJson(ROUTES.poll, { after: lastSeqRef.current }, 8000, signal)
          appendLines(result.lines)
          if (result.running === false) {
            stopPolling()
            if (typeof result.error === 'string' && result.error.length > 0) {
              setError(systemErrorMessage(result.error))
              setPhase('error')
              setOpen(true)
            } else {
              setPhase('idle')
              showNotice(tr('systemClosed'))
            }
          }
        } catch (_pollFailure) {
          // A single poll failure is transient; the interval retries.
        } finally {
          pollBusyRef.current = false
        }
      }

      const startSystem = async (controller) => {
        const current = settingsRef.current
        await postJson(ROUTES.systemStart, {
          font: current.font,
          mode: current.mode,
          target: current.target,
          surface: current.surface,
          engine: current.engine,
        }, 15000, controller.signal)
        lastSeqRef.current = 0
        stopPolling()
        systemPollRef.current = window.setInterval(() => { void pollSystem(controller.signal) }, 800)
        void pollSystem(controller.signal)
        setPhase('live')
        setOpen(false)
      }

      const refreshDevices = async (unlockLabels) => {
        try {
          if (navigator.mediaDevices === undefined || typeof navigator.mediaDevices.enumerateDevices !== 'function') return
          if (unlockLabels === true) {
            // Labels stay empty until a capture grant exists; a short probe unlocks them.
            try {
              const probe = await navigator.mediaDevices.getUserMedia({ audio: true })
              probe.getTracks().forEach((track) => { track.stop() })
            } catch (_probeFailure) { /* the user may decline; the default device still works */ }
          }
          const list = await navigator.mediaDevices.enumerateDevices()
          const inputs = list.filter((device) => device.kind === 'audioinput')
          setDevices(inputs.map((device, index) => ({
            id: device.deviceId,
            label: device.label || `${tr('micDevice')} ${index + 1}`,
          })))
        } catch (_enumerationFailure) {
          // Device labels are optional; capture still works with the default device.
        }
      }

      const refreshStatus = async () => {
        try {
          const status = await postJson(ROUTES.status, {}, 8000)
          const available = status.systemAvailable !== false
          setSystemAvailable(available)
          setPlatform(typeof status.platform === 'string' ? status.platform : '')
          if (!available && settingsRef.current.source === 'system') patch({ source: 'mic' })
        } catch (_statusFailure) {
          // Keep the optimistic default; the start request reports real failures.
        }
      }

      React.useEffect(() => {
        void refreshStatus()
        void refreshDevices(false)
      }, [])

      React.useEffect(() => {
        if (showSettings) void refreshDevices(true)
      }, [showSettings])

      React.useEffect(() => {
        try {
          window.localStorage.setItem(STORE_KEY, JSON.stringify(settings))
        } catch (_ignored) { /* private mode */ }
      }, [settings])

      React.useEffect(() => {
        const onResize = () => {
          setSettings((previous) => ({
            ...previous,
            x: clamp(previous.x, 0, Math.max(0, window.innerWidth - Math.min(560, window.innerWidth - 24))),
            y: clamp(previous.y, 0, Math.max(0, window.innerHeight - 48)),
            ballX: clamp(previous.ballX, 0, window.innerWidth - 46),
            ballY: clamp(previous.ballY, 0, window.innerHeight - 46),
          }))
        }
        window.addEventListener('resize', onResize)
        return () => { window.removeEventListener('resize', onResize) }
      }, [])

      React.useEffect(() => () => {
        window.clearTimeout(noticeTimerRef.current)
        stopPolling()
        try {
          if (settingsRef.current.source === 'system') {
            navigator.sendBeacon(ROUTES.systemStop, new Blob(['{}'], { type: 'application/json' }))
          }
        } catch (_beaconFailure) { /* page teardown */ }
        if (abortRef.current !== null) abortRef.current.abort()
        if (segmenterRef.current !== null) segmenterRef.current.stop()
        segmenterRef.current = null
      }, [])

      React.useEffect(() => {
        if (phaseRef.current !== 'live' || settingsRef.current.source !== 'system') return undefined
        const timer = window.setTimeout(() => {
          void postJson(ROUTES.systemConfig, {
            font: settings.font,
            mode: settings.mode,
            target: settings.target,
            surface: settings.surface,
            engine: settings.engine,
          }, 8000).catch(() => undefined)
        }, 250)
        return () => { window.clearTimeout(timer) }
      }, [settings.font, settings.mode, settings.target, settings.surface, settings.engine])

      React.useEffect(() => {
        const element = listRef.current
        if (element === null) return
        if (autoScrollRef.current) element.scrollTop = element.scrollHeight
      }, [entries])

      const levelHandler = React.useRef(null)
      levelHandler.current = (value) => {
        const now = performance.now()
        if (now - levelAtRef.current < 110) return
        levelAtRef.current = now
        setLevel(value)
      }

      const segmentHandler = React.useRef(null)
      segmentHandler.current = (wav) => {
        const token = tokenRef.current
        if (token === 0) return
        const queue = queueRef.current
        if (queue.length >= 3) queue.shift()
        queue.push({ wav, token })
        if (pumpRef.current !== null) void pumpRef.current()
      }

      const pump = async () => {
        if (busyRef.current) return
        busyRef.current = true
        try {
          while (queueRef.current.length > 0) {
            const item = queueRef.current.shift()
            if (item.token !== tokenRef.current) continue
            await processSegment(item.wav)
          }
        } finally {
          busyRef.current = false
        }
      }
      pumpRef.current = pump

      /**
       * @param {Uint8Array} wav - one utterance.
       * @returns {Promise<void>} after the entry settles.
       */
      const processSegment = async (wav) => {
        const session = abortRef.current
        if (session === null || session.signal.aborted) return
        const id = ++seqRef.current
        setEntries((previous) => [...previous.slice(-299), {
          id, original: '', translation: '', state: 'pending', note: '', at: Date.now(),
        }])
        let text = ''
        try {
          const result = await postJson(ROUTES.transcribe, {
            audioBase64: toBase64(wav),
            language: 'auto',
          }, 45000, session.signal)
          text = String(result.text ?? '').trim()
        } catch (failure) {
          if (session.signal.aborted) {
            setEntries((previous) => previous.filter((entry) => entry.id !== id))
            return
          }
          setEntries((previous) => previous.map((entry) => entry.id === id
            ? { ...entry, state: 'failed', note: tr('transcribeFailed') }
            : entry))
          return
        }
        if (text.length === 0) {
          setEntries((previous) => previous.filter((entry) => entry.id !== id))
          return
        }
        setEntries((previous) => previous.map((entry) => entry.id === id
          ? { ...entry, original: text, state: 'translating' }
          : entry))
        try {
          const result = await postJson(ROUTES.translate, {
            text,
            targetLanguage: settingsRef.current.target,
            engine: settingsRef.current.engine,
          }, 25000, session.signal)
          setEntries((previous) => previous.map((entry) => entry.id === id
            ? { ...entry, translation: String(result.text ?? ''), state: 'done' }
            : entry))
        } catch (failure) {
          if (session.signal.aborted) {
            setEntries((previous) => previous.map((entry) => entry.id === id
              ? { ...entry, state: 'done' }
              : entry))
            return
          }
          setEntries((previous) => previous.map((entry) => entry.id === id
            ? { ...entry, state: 'done', note: tr('translateFailed') }
            : entry))
        }
      }

      const waitPrepared = async (signal) => {
        for (let attempt = 0; attempt < 900; attempt++) {
          await sleep(1000, signal)
          const status = await postJson(ROUTES.status, {}, 8000, signal)
          const speech = status.speech
          if (speech === null || speech === undefined) throw new Error(tr('noSpeech'))
          const provider = speech.providers.find((item) => item.id === speech.selection.providerId)
          const state = provider === undefined ? undefined : provider.preparation
          if (state === undefined) return
          setPrep(state)
          if (READY_PHASES.has(state.phase)) return
          if (state.phase === 'failed') throw new Error(state.message || '语音模型准备失败')
          if (state.phase === 'cancelled') throw new Error('语音模型准备已取消')
        }
        throw new Error('语音模型准备超时')
      }

      const start = async () => {
        if (phaseRef.current === 'starting' || phaseRef.current === 'preparing' || phaseRef.current === 'live') return
        setError('')
        setNotice('')
        setEntries([])
        setPhase('starting')
        const controller = new AbortController()
        abortRef.current = controller
        const token = ++sessionSeqRef.current
        tokenRef.current = token
        try {
          const status = await postJson(ROUTES.status, {}, 8000, controller.signal)
          if (status.speech === null || status.speech === undefined) throw new Error(tr('noSpeech'))
          if (status.translator === false) showNotice(tr('noTranslator'))
          const provider = status.speech.providers.find((item) => item.id === status.speech.selection.providerId)
          if (provider !== undefined && provider.preparation !== undefined && !READY_PHASES.has(provider.preparation.phase)) {
            setPhase('preparing')
            setPrep(provider.preparation)
            await postJson(ROUTES.prepare, {}, 8000, controller.signal)
            await waitPrepared(controller.signal)
          }
          if (settingsRef.current.source === 'system') {
            await startSystem(controller)
            return
          }
          const segmenter = new Segmenter(
            (wav) => {
              if (tokenRef.current !== token) return
              if (segmentHandler.current !== null) segmentHandler.current(wav)
            },
            (value) => { if (levelHandler.current !== null) levelHandler.current(value) },
            () => {
              if (tokenRef.current !== token) return
              tokenRef.current = 0
              if (abortRef.current !== null) abortRef.current.abort()
              abortRef.current = null
              segmenterRef.current = null
              queueRef.current = []
              setEntries((previous) => previous.filter((entry) => entry.state !== 'pending' && entry.state !== 'translating'))
              setLevel(0)
              setError(tr('micLost'))
              setPhase('error')
            },
          )
          await segmenter.start(settingsRef.current.micDeviceId)
          if (controller.signal.aborted) {
            segmenter.stop()
            return
          }
          segmenterRef.current = segmenter
          setPrep(null)
          setPhase('live')
          void refreshDevices(false)
        } catch (failure) {
          if (controller.signal.aborted) {
            setPhase('idle')
            return
          }
          if (segmenterRef.current !== null) segmenterRef.current.stop()
          segmenterRef.current = null
          if (abortRef.current !== null) abortRef.current.abort()
          abortRef.current = null
          const text = errorText(failure, tr('error'))
          if (text === 'mic-denied') setError(tr('micDenied'))
          else if (text === 'mic-missing') setError(tr('micMissing'))
          else if (text === 'unsupported') setError(tr('micUnavailable'))
          else if (text === 'audio-blocked') setError(tr('audioBlocked'))
          else if (failure !== null && typeof failure === 'object' && failure.code === 'unavailable') setError(tr('noSpeech'))
          else setError(text)
          setPhase('error')
        }
      }

      const stop = () => {
        stopPolling()
        if (settingsRef.current.source === 'system') {
          void postJson(ROUTES.systemStop, {}, 5000).catch(() => undefined)
        }
        tokenRef.current = 0
        if (abortRef.current !== null) abortRef.current.abort()
        abortRef.current = null
        if (segmenterRef.current !== null) segmenterRef.current.stop()
        segmenterRef.current = null
        queueRef.current = []
        busyRef.current = false
        setLevel(0)
        setPrep(null)
        setPhase('idle')
        setEntries((previous) => previous.filter((entry) => entry.state === 'done' || entry.state === 'failed'))
      }

      const closePanel = () => {
        if (phaseRef.current === 'live' && settingsRef.current.source === 'system') {
          setOpen(false)
          return
        }
        stop()
        setOpen(false)
      }

      React.useEffect(() => {
        if (!open) return undefined
        const onKey = (event) => {
          if (event.key === 'Escape') closePanel()
        }
        window.addEventListener('keydown', onKey)
        return () => { window.removeEventListener('keydown', onKey) }
      }, [open, phase])

      const toggleBall = () => {
        setOpen(true)
      }

      const beginDrag = (kind, event) => {
        if (event.button !== 0) return
        event.preventDefault()
        const startX = event.clientX
        const startY = event.clientY
        const current = settingsRef.current
        const origin = kind === 'panel' ? { x: current.x, y: current.y } : { x: current.ballX, y: current.ballY }
        const drag = { moved: false }
        dragRef.current = drag
        const onMove = (moveEvent) => {
          const dx = moveEvent.clientX - startX
          const dy = moveEvent.clientY - startY
          if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true
          if (kind === 'panel') {
            const width = Math.max(320, Math.min(560, window.innerWidth - 24))
            patch({
              x: clamp(origin.x + dx, 0, Math.max(0, window.innerWidth - width)),
              y: clamp(origin.y + dy, 0, Math.max(0, window.innerHeight - 48)),
            })
          } else {
            patch({
              ballX: clamp(origin.x + dx, 0, window.innerWidth - 46),
              ballY: clamp(origin.y + dy, 0, window.innerHeight - 46),
            })
          }
        }
        const onUp = () => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          window.removeEventListener('pointercancel', onUp)
          const clicked = !drag.moved
          dragRef.current = null
          if (clicked && kind === 'ball') toggleBall()
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        window.addEventListener('pointercancel', onUp)
      }

      const cycleMode = () => {
        const order = ['both', 'trans', 'orig']
        const at = order.indexOf(settingsRef.current.mode)
        patch({ mode: order[(at + 1) % order.length] })
      }

      const cycleSize = () => {
        const order = ['normal', 'tall', 'compact']
        const at = order.indexOf(settingsRef.current.size)
        patch({ size: order[(at + 1) % order.length] })
      }

      const modeLabel = { both: tr('modeBoth'), trans: tr('modeTrans'), orig: tr('modeOrig') }[settings.mode]
      const sizeLabel = { normal: tr('sizeNormal'), tall: tr('sizeTall'), compact: tr('sizeCompact') }[settings.size]
      const height = settings.size === 'tall'
        ? Math.min(600, Math.round(window.innerHeight * 0.6))
        : settings.size === 'compact' ? 240 : 360
      const live = phase === 'live'
      const busy = phase === 'starting' || phase === 'preparing'
      const translated = entries.filter((entry) => entry.state === 'done').length
      const sourceLabel = settings.source === 'system' ? tr('sourceSystem') : tr('sourceMic')
      const statusText = phase === 'live'
        ? `${sourceLabel} · ${tr('listening')} · ${fill(tr('history'), { count: String(translated) })}`
        : phase === 'starting' ? (settings.source === 'system' ? tr('startingSystem') : tr('starting'))
          : phase === 'preparing' ? tr('preparing')
            : phase === 'error' ? tr('error') : tr('idle')
      const preparingPercent = prep !== null && prep.phase === 'downloading' && typeof prep.totalBytes === 'number' && prep.totalBytes > 0
        ? Math.round((prep.completedBytes / prep.totalBytes) * 100)
        : null

      const visible = entries.filter((entry) => {
        if (settings.mode === 'orig') return entry.original.length > 0
        if (settings.mode === 'trans') return entry.translation.length > 0 || entry.state === 'pending'
        return true
      })
      const shown = visible.slice(-60)

      const panelWidth = Math.max(320, Math.min(560, window.innerWidth - 24))
      const translationLine = (entry) => {
        if (entry.state === 'pending') return tr('waiting')
        if (entry.state === 'translating') return tr('translating')
        if (entry.state === 'failed') return (entry.note || '').length > 0 ? entry.note : tr('transcribeFailed')
        if ((entry.translation || '').length > 0) return entry.translation
        return settings.mode === 'trans' ? entry.original : null
      }

      const style = {
        left: `${clamp(settings.x, 0, Math.max(0, window.innerWidth - panelWidth))}px`,
        top: `${clamp(settings.y, 0, Math.max(0, window.innerHeight - 48))}px`,
        width: `${panelWidth}px`,
        height: `${height}px`,
        '--ls-font': `${settings.font}px`,
      }

      const surfaceLabel = settings.surface === 'desktop' ? tr('surfaceDesktop') : tr('surfaceFloating')
      const metaText = phase === 'live'
        ? `${sourceLabel} · ${surfaceLabel} · ${fill(tr('history'), { count: String(translated) })}`
        : phase === 'error' ? tr('error') : tr('idle')

      const items = []
      let lastMinute = ''
      for (const entry of shown) {
        if (typeof entry.at === 'number' && entry.at > 0) {
          const minute = new Date(entry.at).toTimeString().slice(0, 5)
          if (minute !== lastMinute) {
            items.push({ key: `t-${entry.id}`, minute })
            lastMinute = minute
          }
        }
        items.push({ key: `e-${entry.id}`, entry })
      }

      const selectField = (value, options, onChange, disabled) => h('select', {
        className: 'ls-select',
        value,
        disabled: disabled === true,
        onChange,
      }, options.map(([id, label]) => h('option', { key: id, value: id }, label)))

      return h('div', { className: 'ls-root' },
        h('style', { dangerouslySetInnerHTML: { __html: css } }),
        open ? h('div', {
          className: 'ls-panel',
          style,
          role: 'dialog',
          'aria-label': tr('title'),
        },
        h('div', { className: 'ls-head', onPointerDown: (event) => beginDrag('panel', event) },
          h('span', { className: 'ls-badge' }, 'CC'),
          h('span', { className: 'ls-htitle' }, tr('title')),
          h('span', { className: `ls-dot${live ? ' live' : phase === 'error' ? ' error' : ''}` }),
          h('span', { className: 'ls-hstatus', title: statusText }, statusText),
          live && settings.source !== 'system' ? h('span', { className: 'ls-eq', 'aria-hidden': true },
            [0.55, 0.9, 1, 0.75, 0.45].map((weight, index) => h('i', {
              key: index,
              style: { height: `${Math.max(3, Math.round(3 + level * 10 * weight))}px` },
            }))) : null,
          h('button', {
            type: 'button',
            className: 'ls-close',
            title: tr('close'),
            'aria-label': tr('close'),
            onPointerDown: (event) => { event.stopPropagation() },
            onClick: closePanel,
          }, iconClose())),
        h('div', {
          className: 'ls-body',
          role: 'log',
          'aria-live': 'polite',
          'aria-relevant': 'additions text',
          'aria-label': tr('title'),
          ref: listRef,
          onScroll: (event) => {
            const element = event.currentTarget
            autoScrollRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80
          },
        },
        phase === 'error' ? h('div', { className: 'ls-err' },
          h('span', null, error),
          h('button', { type: 'button', className: 'ls-primary', onClick: start }, tr('retry'))) : null,
        phase === 'starting' ? h('div', { className: 'ls-prep' }, h('p', null, settings.source === 'system' ? tr('startingSystem') : tr('starting'))) : null,
        phase === 'preparing' ? h('div', { className: 'ls-prep' },
          h('p', null, prep !== null && prep.phase === 'downloading'
            ? fill(tr('prepBytes'), { done: formatBytes(prep.completedBytes), total: formatBytes(prep.totalBytes) })
            : tr('preparing')),
          preparingPercent !== null ? h('div', { className: 'ls-bar' }, h('i', { style: { width: `${preparingPercent}%` } })) : null) : null,
        visible.length === 0 && phase !== 'error' && !busy && !live
          ? h('div', { className: 'ls-empty' },
            h('h3', null, tr('emptyTitle')),
            h('p', null, settings.source === 'system' ? tr('emptyBodySystem') : tr('emptyBody')),
            h('p', null, settings.source === 'system'
              ? tr('systemHint')
              : platform === 'win32'
                ? tr('platformHintWin')
                : platform !== '' && platform !== 'darwin' ? tr('platformHintOther') : tr('hintMic')),
            h('p', null, settings.source === 'system'
              ? (settings.surface === 'desktop' ? tr('desktopHint') : tr('systemFloating'))
              : tr('hintLocal')),
            h('p', null, tr('panelHint')))
          : null,
        items.map((item) => item.minute !== undefined
          ? h('div', { key: item.key, className: 'ls-time' }, item.minute)
          : h('div', {
            key: item.key,
            className: `ls-line${item.entry.state === 'pending' || item.entry.state === 'translating' ? ' pending' : ''}${item.entry.state === 'failed' ? ' failed' : ''}`,
          },
          settings.mode !== 'trans' && item.entry.original.length > 0
            ? h('div', { className: 'ls-orig' }, item.entry.original)
            : null,
          settings.mode !== 'orig'
            ? h('div', { className: 'ls-trans' }, translationLine(item.entry))
            : null,
          item.entry.note !== undefined && item.entry.note.length > 0 && item.entry.state === 'done'
            ? h('div', { className: 'ls-note' }, item.entry.note)
            : null)),
        live ? h('div', { className: 'ls-live' },
          h('span', { className: 'ls-dot live' }),
          h('span', null, tr('listening'))) : null,
        notice.length > 0 ? h('div', { className: 'ls-toast' }, notice) : null),
        h('div', { className: 'ls-foot' },
          h('button', {
            type: 'button',
            className: `ls-primary${live ? ' stop' : ''}`,
            disabled: busy,
            onClick: live || busy ? stop : start,
          }, live ? tr('stop') : phase === 'preparing' ? tr('prepareShort') : busy ? (settings.source === 'system' ? tr('startingSystem') : tr('starting')) : tr('start')),
          h('span', { className: 'ls-footmeta', title: metaText }, metaText),
          h('span', { className: 'ls-spacer' }),
          h('button', {
            type: 'button',
            className: `ls-ghost${showSettings ? ' on' : ''}`,
            'aria-expanded': showSettings,
            onClick: () => { setShowSettings((value) => !value) },
          }, tr('settings')),
          h('button', {
            type: 'button', className: 'ls-ghost', title: tr('clear'), 'aria-label': tr('clear'),
            onClick: () => { setEntries([]) },
          }, tr('clear'))),
        showSettings ? h('div', { className: 'ls-settings' },
          h('div', { className: 'ls-field' }, h('span', null, tr('source')),
            selectField(settings.source, systemAvailable
              ? [['system', tr('sourceSystem')], ['mic', tr('sourceMic')]]
              : [['mic', tr('sourceMic')]],
              (event) => { setEntries([]); patch({ source: event.target.value }) }, live || busy)),
          systemAvailable && settings.source === 'system'
            ? h('div', { className: 'ls-field' }, h('span', null, tr('surface')),
              selectField(settings.surface, [['floating', tr('surfaceFloating')], ['desktop', tr('surfaceDesktop')]],
                (event) => {
                  const placement = event.target.value
                  patch({ surface: placement })
                  if (placement === 'desktop') showNotice(tr('desktopHint'))
                }, false))
            : null,
          settings.source === 'mic'
            ? h('div', { className: 'ls-field' }, h('span', null, tr('micDevice')),
              selectField(settings.micDeviceId, [['', tr('deviceDefault')], ...devices.map((device) => [device.id, device.label])],
                (event) => { patch({ micDeviceId: event.target.value }) }, live || busy))
            : null,
          h('div', { className: 'ls-field' }, h('span', null, tr('target')),
            selectField(settings.target, TARGETS, (event) => { patch({ target: event.target.value }) }, false)),
          h('div', { className: 'ls-field' }, h('span', null, tr('engine')),
            selectField(settings.engine, [['smart', tr('engineSmart')], ['fast', tr('engineFast')]],
              (event) => { patch({ engine: event.target.value }) }, false)),
          h('div', { className: 'ls-field' }, h('span', null, tr('fontSize')),
            h('button', { type: 'button', className: 'ls-step', title: tr('fontSmaller'), 'aria-label': tr('fontSmaller'), onClick: () => { patch({ font: clamp(settingsRef.current.font - 2, 14, 36) }) } }, 'A−'),
            h('span', { className: 'ls-value' }, String(settings.font)),
            h('button', { type: 'button', className: 'ls-step', title: tr('fontLarger'), 'aria-label': tr('fontLarger'), onClick: () => { patch({ font: clamp(settingsRef.current.font + 2, 14, 36) }) } }, 'A+')),
          h('div', { className: 'ls-field' }, h('span', null, tr('mode')),
            h('button', { type: 'button', className: 'ls-ghost', onClick: cycleMode }, modeLabel)),
          h('div', { className: 'ls-field' }, h('span', null, tr('size')),
            h('button', { type: 'button', className: 'ls-ghost', onClick: cycleSize }, sizeLabel))) : null)
          : h('button', {
            type: 'button',
            className: `ls-ball${live ? ' live' : ''}`,
            style: { left: `${settings.ballX}px`, top: `${settings.ballY}px` },
            title: tr('title'),
            'aria-label': tr('title'),
            'aria-haspopup': 'dialog',
            onPointerDown: (event) => beginDrag('ball', event),
            onKeyDown: (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                toggleBall()
              }
            },
          }, iconBars(live)))

    }

    /**
     * @param {number | undefined} bytes - byte count.
     * @returns {string} short human-readable size.
     */
    function formatBytes(bytes) {
      if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return '0 B'
      if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }))
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'live-subtitle',
          order: 20,
          locale: NS,
        }, App))
      },
    }
  },
})

