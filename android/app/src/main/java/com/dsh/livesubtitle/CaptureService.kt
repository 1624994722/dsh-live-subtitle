package com.dsh.livesubtitle

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import java.util.concurrent.Executors

class CaptureService : Service() {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    @Volatile private var running = false
    private var record: AudioRecord? = null
    private var captureThread: Thread? = null
    private var projection: MediaProjection? = null
    private var overlay: OverlayController? = null
    private var asr: AsrEngine? = null
    private var translator: Translator? = null
    private val contextLines = ArrayList<Pair<String, String>>()
    private var sourceLanguage = "auto"
    private var targetLanguage = "zh-Hans"

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (running) return START_NOT_STICKY
        if (intent == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        sourceLanguage = intent.getStringExtra("source") ?: Prefs.sourceLang(this)
        targetLanguage = intent.getStringExtra("target") ?: Prefs.targetLang(this)
        val mode = intent.getStringExtra("mode") ?: Prefs.mode(this)
        createChannel()
        val type = if (mode == "system") {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
        } else {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        }
        startForeground(NOTIFICATION_ID, buildNotification(), type)

        if (mode == "system") {
            val resultCode = intent.getIntExtra("resultCode", 0)
            @Suppress("DEPRECATION")
            val data = intent.getParcelableExtra("data") as? Intent
            if (resultCode == 0 || data == null) {
                stopSelf()
                return START_NOT_STICKY
            }
            val manager = getSystemService(MediaProjectionManager::class.java)
            projection = try {
                manager.getMediaProjection(resultCode, data)
            } catch (_: Exception) {
                null
            }
            if (projection == null) {
                stopSelf()
                return START_NOT_STICKY
            }
            projection?.registerCallback(object : MediaProjection.Callback() {
                override fun onStop() {
                    stopSelf()
                }
            }, mainHandler)
        }

        overlay = OverlayController(this) { stopSelf() }
        overlay?.show()
        overlay?.setStatus("正在加载模型…")
        running = true
        worker.execute { startPipeline(mode) }
        return START_NOT_STICKY
    }

    private fun startPipeline(mode: String) {
        if (!ModelManager.isReady(this)) {
            overlay?.setStatus("模型未准备：请先在 App 中下载或导入")
            return
        }
        translator = Translator(
            Prefs.apiKey(this),
            Prefs.endpoint(this),
            Prefs.model(this),
        )
        if (!translator!!.isConfigured()) {
            overlay?.setStatus("未配置 DeepSeek API Key")
        }
        try {
            val engine = AsrEngine(
                applicationContext,
                sourceLanguage,
                ModelManager.modelFile(this).absolutePath,
                ModelManager.tokensFile(this).absolutePath,
            )
            engine.load()
            asr = engine
        } catch (error: Throwable) {
            overlay?.setStatus("模型加载失败：${error.message ?: error.javaClass.simpleName}")
            return
        }
        if (!running) return
        overlay?.setStatus("正在听…")
        startCapture(mode)
    }

    private fun startCapture(mode: String) {
        val format = AudioFormat.Builder()
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .setSampleRate(16000)
            .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
            .build()
        val minBuffer = AudioRecord.getMinBufferSize(
            16000,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
        )
        val bufferSize = maxOf(minBuffer * 2, 16000)
        record = try {
            if (mode == "system") {
                val active = projection ?: run {
                    overlay?.setStatus("屏幕录制未授权")
                    return
                }
                val captureConfig = AudioPlaybackCaptureConfiguration.Builder(active)
                    .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                    .addMatchingUsage(AudioAttributes.USAGE_GAME)
                    .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
                    .build()
                AudioRecord.Builder()
                    .setAudioFormat(format)
                    .setBufferSizeInBytes(bufferSize)
                    .setAudioPlaybackCaptureConfig(captureConfig)
                    .build()
            } else {
                AudioRecord(
                    MediaRecorder.AudioSource.MIC,
                    16000,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                    bufferSize,
                )
            }
        } catch (error: Throwable) {
            overlay?.setStatus("无法创建录音：${error.message ?: "未知错误"}")
            return
        }
        val audio = record ?: return
        if (audio.state != AudioRecord.STATE_INITIALIZED) {
            overlay?.setStatus("录音初始化失败（权限或系统限制）")
            audio.release()
            record = null
            return
        }
        val segmenter = Segmenter { samples ->
            worker.execute { processSegment(samples) }
        }
        try {
            audio.startRecording()
        } catch (error: Throwable) {
            overlay?.setStatus("录音启动失败：${error.message ?: "未知错误"}")
            return
        }
        captureThread = Thread {
            val buffer = ShortArray(1600)
            while (running) {
                val read = try {
                    audio.read(buffer, 0, buffer.size)
                } catch (_: Throwable) {
                    break
                }
                if (read > 0) {
                    val floats = FloatArray(read)
                    for (i in 0 until read) floats[i] = buffer[i] / 32768f
                    segmenter.feed(floats)
                }
            }
        }.also { it.start() }
    }

    private fun processSegment(samples: FloatArray) {
        val engine = asr ?: return
        val text = try {
            engine.transcribe(samples)
        } catch (_: Throwable) {
            ""
        }
        if (text.isBlank()) return
        overlay?.setOriginal(text)
        val output = translator?.translate(text, sourceLanguage, targetLanguage, contextLines) ?: ""
        if (output.isBlank()) {
            overlay?.setTranslation("（翻译失败：检查 API Key / 网络）")
        } else {
            overlay?.setTranslation(output)
            contextLines.add(text to output)
            while (contextLines.size > 3) contextLines.removeAt(0)
        }
    }

    private fun createChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "实时字幕",
            NotificationManager.IMPORTANCE_LOW,
        )
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun buildNotification(): Notification {
        val intent = Intent(this, MainActivity::class.java)
        val pending = PendingIntent.getActivity(
            this,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("实时字幕运行中")
            .setContentText("悬浮字幕已开启")
            .setContentIntent(pending)
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .build()
    }

    override fun onDestroy() {
        running = false
        captureThread?.interrupt()
        captureThread = null
        try {
            record?.stop()
        } catch (_: Throwable) {
        }
        record?.release()
        record = null
        try {
            projection?.stop()
        } catch (_: Throwable) {
        }
        projection = null
        asr?.close()
        asr = null
        worker.shutdown()
        overlay?.remove()
        overlay = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }

    companion object {
        private const val CHANNEL_ID = "live_subtitle"
        private const val NOTIFICATION_ID = 1
    }
}
