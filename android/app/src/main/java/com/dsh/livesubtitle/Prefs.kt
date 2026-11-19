package com.dsh.livesubtitle

import android.content.Context

object Prefs {
    private const val NAME = "live_subtitle"

    private fun p(ctx: Context) = ctx.getSharedPreferences(NAME, Context.MODE_PRIVATE)

    fun apiKey(ctx: Context): String = p(ctx).getString("api_key", "") ?: ""
    fun endpoint(ctx: Context): String =
        p(ctx).getString("endpoint", "https://api.deepseek.com/chat/completions")
            ?: "https://api.deepseek.com/chat/completions"
    fun model(ctx: Context): String = p(ctx).getString("model", "deepseek-chat") ?: "deepseek-chat"
    fun sourceLang(ctx: Context): String = p(ctx).getString("source_lang", "auto") ?: "auto"
    fun targetLang(ctx: Context): String = p(ctx).getString("target_lang", "zh-Hans") ?: "zh-Hans"
    fun mode(ctx: Context): String = p(ctx).getString("mode", "system") ?: "system"
    fun fontSp(ctx: Context): Int = p(ctx).getInt("font_sp", 22)

    fun save(ctx: Context, key: String, value: String) {
        p(ctx).edit().putString(key, value).apply()
    }

    fun saveFont(ctx: Context, value: Int) {
        p(ctx).edit().putInt("font_sp", value).apply()
    }
}
