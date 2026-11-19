package com.dsh.livesubtitle

import android.content.Context
import android.net.Uri
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

object ModelManager {
    const val MODEL_NAME = "model.int8.onnx"
    const val TOKENS_NAME = "tokens.txt"

    private const val BASE =
        "https://hf-mirror.com/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07"
    private const val MODEL_URL = "$BASE/model.int8.onnx"
    private const val TOKENS_URL = "$BASE/tokens.txt"

    fun dir(ctx: Context): File = File(ctx.filesDir, "models/sensevoice").apply { mkdirs() }
    fun modelFile(ctx: Context): File = File(dir(ctx), MODEL_NAME)
    fun tokensFile(ctx: Context): File = File(dir(ctx), TOKENS_NAME)

    fun isReady(ctx: Context): Boolean {
        val model = modelFile(ctx)
        val tokens = tokensFile(ctx)
        return model.isFile && model.length() > 200_000_000L && tokens.isFile && tokens.length() > 1_000L
    }

    /**
     * Download the int8 model and tokens. The callback runs on the calling thread.
     */
    fun download(ctx: Context, onProgress: (label: String, done: Long, total: Long) -> Unit) {
        fetch(MODEL_URL, modelFile(ctx), onProgress)
        fetch(TOKENS_URL, tokensFile(ctx), onProgress)
    }

    private fun fetch(urlText: String, target: File, onProgress: (String, Long, Long) -> Unit) {
        if (target.isFile && target.length() > 1_000L && (target.name != MODEL_NAME || target.length() > 200_000_000L)) {
            onProgress(target.name, target.length(), target.length())
            return
        }
        val part = File(target.parentFile, target.name + ".part")
        if (part.exists()) part.delete()
        var connection: HttpURLConnection? = null
        try {
            var current = urlText
            var redirects = 0
            while (true) {
                connection = (URL(current).openConnection() as HttpURLConnection).apply {
                    instanceFollowRedirects = false
                    connectTimeout = 30_000
                    readTimeout = 60_000
                    setRequestProperty("User-Agent", "dsh-live-subtitle-android")
                }
                val code = connection.responseCode
                if (code in 300..399) {
                    val location = connection.getHeaderField("Location")
                    connection.disconnect()
                    if (location.isNullOrBlank() || redirects >= 5) {
                        throw IllegalStateException("HTTP $code without usable redirect for $current")
                    }
                    current = if (location.startsWith("http")) location else URL(URL(current), location).toString()
                    redirects += 1
                    continue
                }
                if (code !in 200..299) throw IllegalStateException("HTTP $code for $current")
                break
            }
            val total = connection.contentLengthLong
            connection.inputStream.use { input ->
                part.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    var done = 0L
                    while (true) {
                        val read = input.read(buffer)
                        if (read <= 0) break
                        output.write(buffer, 0, read)
                        done += read
                        onProgress(target.name, done, total)
                    }
                }
            }
            if (!part.renameTo(target)) {
                part.copyTo(target, overwrite = true)
                part.delete()
            }
        } finally {
            connection?.disconnect()
            if (part.exists() && !target.exists()) part.delete()
        }
    }

    fun import(ctx: Context, uri: Uri, displayName: String): Boolean {
        val name = when {
            displayName.contains("tokens", ignoreCase = true) -> TOKENS_NAME
            displayName.endsWith(".onnx", ignoreCase = true) -> MODEL_NAME
            else -> return false
        }
        val target = File(dir(ctx), name)
        return try {
            ctx.contentResolver.openInputStream(uri)?.use { input ->
                target.outputStream().use { output -> input.copyTo(output) }
            } ?: return false
            target.length() > 1_000L
        } catch (_: Exception) {
            false
        }
    }

    fun clear(ctx: Context) {
        dir(ctx).listFiles()?.forEach { it.delete() }
    }
}
