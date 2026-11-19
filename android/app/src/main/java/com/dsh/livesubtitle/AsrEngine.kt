package com.dsh.livesubtitle

import android.content.Context
import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.OfflineModelConfig
import com.k2fsa.sherpa.onnx.OfflineRecognizer
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig
import com.k2fsa.sherpa.onnx.OfflineSenseVoiceModelConfig

/**
 * Thin wrapper around sherpa-onnx SenseVoice. Loading is slow (~1-3 s), so the
 * service calls [load] off the main thread.
 */
class AsrEngine(
    private val context: Context,
    private val languageHint: String,
    private val modelPath: String,
    private val tokensPath: String,
) {
    private var recognizer: OfflineRecognizer? = null

    fun load() {
        val senseVoice = OfflineSenseVoiceModelConfig().apply {
            model = modelPath
            language = if (languageHint == "auto") "auto" else languageHint
            useInverseTextNormalization = true
        }
        val modelConfig = OfflineModelConfig().apply {
            this.senseVoice = senseVoice
            tokens = tokensPath
            numThreads = 2
            provider = "cpu"
            debug = false
        }
        val config = OfflineRecognizerConfig().apply {
            featConfig = FeatureConfig(16000, 80)
            this.modelConfig = modelConfig
            decodingMethod = "greedy_search"
        }
        recognizer = OfflineRecognizer(context.assets, config)
    }

    @Synchronized
    fun transcribe(samples: FloatArray): String {
        val engine = recognizer ?: return ""
        if (samples.isEmpty()) return ""
        val stream = engine.createStream()
        return try {
            stream.acceptWaveform(samples, 16000)
            engine.decode(stream)
            engine.getResult(stream).text.trim()
        } finally {
            stream.release()
        }
    }

    @Synchronized
    fun close() {
        recognizer?.release()
        recognizer = null
    }
}
