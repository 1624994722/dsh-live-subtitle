package com.dsh.livesubtitle

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * DeepSeek (OpenAI-compatible) subtitle translation with the same natural,
 * context-aware prompt used by the desktop plugin.
 */
class Translator(
    private val apiKey: String,
    private val endpoint: String,
    private val model: String,
) {
    fun isConfigured(): Boolean = apiKey.isNotBlank()

    fun translate(
        text: String,
        sourceLanguage: String,
        targetLanguage: String,
        context: List<Pair<String, String>>,
    ): String {
        if (!isConfigured()) return ""
        val target = nameOf(targetLanguage)
        val source = nameOf(sourceLanguage)
        val recent = context.takeLast(3).mapIndexed { index, pair ->
            "#${index + 1} ${pair.first}\n→ ${pair.second}"
        }.joinToString("\n")
        val system = buildString {
            appendLine("You are a professional live subtitle translator. Translate the MEANING and the speaker's intent, never word-for-word.")
            appendLine(style(targetLanguage))
            appendLine("Rules:")
            appendLine("- Output only the translation. No explanations, quotes, notes, labels, or alternative versions.")
            appendLine("- Preserve who is speaking to whom, tone and register, personality, humor, sarcasm and implied meaning.")
            appendLine("- Adapt idioms and set phrases into natural target-language equivalents, not literal glosses.")
            appendLine("- Keep names, honorifics and recurring terminology consistent with the recent lines.")
            appendLine("- Prefer short, speakable lines; do not add information that is not in the source.")
        }
        val user = buildString {
            if (recent.isNotEmpty()) appendLine("Recent subtitles (source → translation):\n$recent\n")
            appendLine("Source language: $source")
            appendLine("Translate this subtitle line into $target:")
            append(text)
        }
        val body = JSONObject().apply {
            put("model", model)
            put("temperature", 0.45)
            put("max_tokens", 512)
            put("stream", false)
            put("messages", JSONArray().apply {
                put(JSONObject().put("role", "system").put("content", system))
                put(JSONObject().put("role", "user").put("content", user))
            })
        }.toString()

        var connection: HttpURLConnection? = null
        return try {
            connection = (URL(endpoint).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 15_000
                readTimeout = 30_000
                doOutput = true
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
                setRequestProperty("Authorization", "Bearer $apiKey")
            }
            connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            val code = connection.responseCode
            if (code !in 200..299) {
                connection.errorStream?.close()
                return ""
            }
            val response = connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
            val content = JSONObject(response)
                .getJSONArray("choices")
                .getJSONObject(0)
                .getJSONObject("message")
                .getString("content")
            clean(content)
        } catch (_: Exception) {
            ""
        } finally {
            connection?.disconnect()
        }
    }

    private fun nameOf(tag: String): String = when (tag) {
        "ja" -> "Japanese"
        "en" -> "English"
        "zh", "zh-Hans" -> "Simplified Chinese"
        "zh-Hant" -> "Traditional Chinese"
        "ko" -> "Korean"
        "yue" -> "Cantonese"
        else -> "the source language"
    }

    private fun style(tag: String): String = when (tag) {
        "ja" -> "Write natural spoken Japanese (話し言葉). Avoid 直訳調/翻訳調 and stiff written Japanese; use natural contractions and particles; choose 敬体 or 常体 from the scene. Example: \"Are you serious?\" → casual マジで？ or formal 本気ですか？, never a word-for-word gloss."
        "zh-Hans", "zh" -> "Write natural, colloquial Simplified Chinese. Avoid 翻译腔/直译腔; do not keep foreign word order; keep lines short like subtitles."
        "zh-Hant" -> "Write natural, colloquial Traditional Chinese. Avoid 翻譯腔/直譯腔; keep lines short like subtitles."
        "ko" -> "Write natural spoken Korean, matching the scene's politeness level; keep lines short."
        else -> "Write natural, colloquial English; avoid translationese."
    }

    private fun clean(value: String): String {
        var text = value.trim()
        if (text.length > 1 && ((text.startsWith("\"") && text.endsWith("\"")) || (text.startsWith("“") && text.endsWith("”")))) {
            text = text.substring(1, text.length - 1).trim()
        }
        return text.replace(Regex("^(Translation|译文|翻译)[:：]\\s*"), "")
    }
}
