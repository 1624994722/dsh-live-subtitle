package com.dsh.livesubtitle

import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Draggable, borderless subtitle card drawn above other apps.
 */
class OverlayController(
    private val context: Context,
    private val onClose: () -> Unit,
) {
    private val handler = Handler(Looper.getMainLooper())
    private val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private val root: LinearLayout
    private val translation: TextView
    private val original: TextView
    private val status: TextView
    private val params: WindowManager.LayoutParams
    private var shown = false
    private var fontSp = Prefs.fontSp(context).toFloat()

    init {
        val density = context.resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()

        root = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(10), dp(14), dp(14))
            background = GradientDrawable().apply {
                cornerRadius = dp(16).toFloat()
                setColor(0xE6111318.toInt())
                setStroke(dp(1), 0x22FFFFFF)
            }
        }

        val header = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val dot = TextView(context).apply {
            text = "●"
            setTextColor(0xFF5AD19A.toInt())
            textSize = 10f
            setPadding(0, 0, dp(6), 0)
        }
        val title = TextView(context).apply {
            text = "实时字幕"
            setTextColor(0x99FFFFFF.toInt())
            textSize = 11f
        }
        status = TextView(context).apply {
            text = "正在启动…"
            setTextColor(0x88FFFFFF.toInt())
            textSize = 11f
            setPadding(dp(8), 0, 0, 0)
        }
        val spacer = View(context)
        val minus = TextView(context).apply {
            text = "A−"
            setTextColor(0xCCFFFFFF.toInt())
            textSize = 12f
            setPadding(dp(8), dp(2), dp(8), dp(2))
            setOnClickListener { applyFont(fontSp - 2f) }
        }
        val plus = TextView(context).apply {
            text = "A+"
            setTextColor(0xCCFFFFFF.toInt())
            textSize = 12f
            setPadding(dp(8), dp(2), dp(8), dp(2))
            setOnClickListener { applyFont(fontSp + 2f) }
        }
        val close = TextView(context).apply {
            text = "✕"
            setTextColor(0xCCFFFFFF.toInt())
            textSize = 14f
            setPadding(dp(8), dp(2), 0, dp(2))
            setOnClickListener { onClose() }
        }
        header.addView(dot)
        header.addView(title)
        header.addView(status)
        header.addView(spacer, LinearLayout.LayoutParams(0, 1, 1f))
        header.addView(minus)
        header.addView(plus)
        header.addView(close)

        original = TextView(context).apply {
            setTextColor(0xB3FFFFFF.toInt())
            textSize = 13f
            setPadding(0, dp(6), 0, dp(2))
            visibility = View.GONE
        }
        translation = TextView(context).apply {
            setTextColor(Color.WHITE)
            textSize = fontSp
            setPadding(0, dp(2), 0, 0)
            text = "正在加载模型…"
        }

        root.addView(header)
        root.addView(original)
        root.addView(translation)

        val screenWidth = context.resources.displayMetrics.widthPixels
        val screenHeight = context.resources.displayMetrics.heightPixels
        val width = if (screenWidth > dp(560)) dp(520) else screenWidth - dp(32)
        params = WindowManager.LayoutParams(
            width,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = dp(16)
            y = (screenHeight * 0.62f).toInt()
        }

        val drag = object : View.OnTouchListener {
            private var startX = 0
            private var startY = 0
            private var touchX = 0
            private var touchY = 0

            override fun onTouch(view: View, event: MotionEvent): Boolean {
                when (event.action) {
                    MotionEvent.ACTION_DOWN -> {
                        startX = params.x
                        startY = params.y
                        touchX = event.rawX.toInt()
                        touchY = event.rawY.toInt()
                        return true
                    }
                    MotionEvent.ACTION_MOVE -> {
                        params.x = startX + (event.rawX.toInt() - touchX)
                        params.y = startY + (event.rawY.toInt() - touchY)
                        if (shown) windowManager.updateViewLayout(root, params)
                        return true
                    }
                }
                return false
            }
        }
        header.setOnTouchListener(drag)
    }

    private fun applyFont(value: Float) {
        fontSp = value.coerceIn(14f, 36f)
        translation.textSize = fontSp
        Prefs.saveFont(context, fontSp.toInt())
    }

    fun show() {
        if (shown) return
        try {
            windowManager.addView(root, params)
            shown = true
        } catch (_: Exception) {
        }
    }

    fun setStatus(text: String) = handler.post {
        status.text = text
    }

    fun setOriginal(text: String) = handler.post {
        original.text = text
        original.visibility = if (text.isBlank()) View.GONE else View.VISIBLE
    }

    fun setTranslation(text: String) = handler.post {
        translation.text = text
    }

    fun remove() = handler.post {
        if (!shown) return@post
        try {
            windowManager.removeView(root)
        } catch (_: Exception) {
        }
        shown = false
    }
}
