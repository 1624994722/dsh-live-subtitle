package com.dsh.livesubtitle

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast

class MainActivity : Activity() {
    private lateinit var apiKey: EditText
    private lateinit var endpoint: EditText
    private lateinit var model: EditText
    private lateinit var sourceSpinner: Spinner
    private lateinit var targetSpinner: Spinner
    private lateinit var modeGroup: RadioGroup
    private lateinit var modelStatus: TextView
    private lateinit var permissionStatus: TextView
    private lateinit var status: TextView
    private var pendingStart = false

    private val sourceIds = arrayOf("auto", "ja", "en", "zh", "ko")
    private val sourceLabels = arrayOf("自动识别", "日语", "英语", "中文", "韩语")
    private val targetIds = arrayOf("zh-Hans", "ja", "en")
    private val targetLabels = arrayOf("中文（简体）", "日本語", "English")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildUi())
        loadPrefs()
        updateModelStatus()
    }

    override fun onResume() {
        super.onResume()
        updateModelStatus()
        updatePermissionStatus()
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun label(text: String, sizeSp: Float = 13f, bold: Boolean = false): TextView =
        TextView(this).apply {
            this.text = text
            textSize = sizeSp
            if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
            setPadding(0, dp(4), 0, dp(4))
        }

    private fun section(title: String): TextView =
        TextView(this).apply {
            text = title
            textSize = 15f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            setPadding(0, dp(18), 0, dp(6))
        }

    private fun field(hint: String, value: String, password: Boolean = false): EditText =
        EditText(this).apply {
            this.hint = hint
            setText(value)
            textSize = 13f
            if (password) {
                inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            }
            setSingleLine(true)
        }

    private fun action(text: String, onClick: () -> Unit): Button =
        Button(this).apply {
            this.text = text
            textSize = 13f
            setOnClickListener { onClick() }
        }

    private fun addFull(root: LinearLayout, view: View) {
        root.addView(view, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
    }

    private fun row(vararg views: View): LinearLayout =
        LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            for (view in views) {
                addView(view, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            }
        }

    private fun buildUi(): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(20), dp(20), dp(28))
        }
        root.addView(label("实时字幕", 24f, true))
        root.addView(label("手机本地识别（SenseVoice）+ DeepSeek 翻译 + 悬浮字幕", 12f))
        root.addView(label("系统声音需要「屏幕录制」授权；只能抓取允许被录制的 App（YouTube/多数播放器可用，Netflix 等 DRM 内容可能无声）。", 12f))

        root.addView(section("1. 模型（SenseVoice int8，约 230 MB）"))
        modelStatus = label("模型：检查中…", 13f)
        root.addView(modelStatus)
        root.addView(row(
            action("下载模型") { downloadModel() },
            action("导入模型文件") { pickModelFiles() },
            action("清除") { ModelManager.clear(this); updateModelStatus() },
        ))

        root.addView(section("2. 翻译 API（DeepSeek）"))
        apiKey = field("DeepSeek API Key（sk-...）", Prefs.apiKey(this), password = true)
        endpoint = field("Endpoint", Prefs.endpoint(this))
        model = field("Model", Prefs.model(this))
        addFull(root, apiKey)
        addFull(root, endpoint)
        addFull(root, model)
        root.addView(label("Key 在 platform.deepseek.com 创建。不填也能看原文，但没有翻译。", 11f))

        root.addView(section("3. 语言与来源"))
        root.addView(label("源语言（看日语内容请选日语）", 12f))
        sourceSpinner = Spinner(this).apply {
            adapter = ArrayAdapter(this@MainActivity, android.R.layout.simple_spinner_dropdown_item, sourceLabels)
        }
        addFull(root, sourceSpinner)
        root.addView(label("翻译成", 12f))
        targetSpinner = Spinner(this).apply {
            adapter = ArrayAdapter(this@MainActivity, android.R.layout.simple_spinner_dropdown_item, targetLabels)
        }
        addFull(root, targetSpinner)

        val systemRadio = RadioButton(this).apply { id = 1; text = "系统声音（需屏幕录制授权）" }
        val micRadio = RadioButton(this).apply { id = 2; text = "麦克风（测试兜底）" }
        modeGroup = RadioGroup(this).apply {
            orientation = RadioGroup.VERTICAL
            addView(systemRadio)
            addView(micRadio)
            check(1)
        }
        addFull(root, modeGroup)

        root.addView(section("4. 权限"))
        permissionStatus = label("权限：检查中…", 12f)
        root.addView(permissionStatus)
        root.addView(action("打开悬浮窗权限设置") { openOverlaySettings() })

        root.addView(section("5. 运行"))
        status = label("未运行", 12f)
        root.addView(status)
        root.addView(row(
            action("开始字幕") { startFlow() },
            action("停止") { stopSubtitles() },
        ))
        root.addView(label("提示：模型加载约 1–3 秒；打开视频后按「开始字幕」，允许屏幕录制；字幕会出现在可拖动的悬浮窗里。", 11f))

        return ScrollView(this).apply { addView(root) }
    }

    private fun loadPrefs() {
        sourceSpinner.setSelection(sourceIds.indexOf(Prefs.sourceLang(this)).coerceAtLeast(0))
        targetSpinner.setSelection(targetIds.indexOf(Prefs.targetLang(this)).coerceAtLeast(0))
        modeGroup.check(if (Prefs.mode(this) == "mic") 2 else 1)
        updatePermissionStatus()
    }

    private fun savePrefs() {
        Prefs.save(this, "api_key", apiKey.text.toString().trim())
        Prefs.save(this, "endpoint", endpoint.text.toString().trim().ifBlank { "https://api.deepseek.com/chat/completions" })
        Prefs.save(this, "model", model.text.toString().trim().ifBlank { "deepseek-chat" })
        Prefs.save(this, "source_lang", sourceIds[sourceSpinner.selectedItemPosition])
        Prefs.save(this, "target_lang", targetIds[targetSpinner.selectedItemPosition])
        Prefs.save(this, "mode", if (modeGroup.checkedRadioButtonId == 2) "mic" else "system")
    }

    private fun updateModelStatus() {
        if (ModelManager.isReady(this)) {
            val size = ModelManager.modelFile(this).length() / (1024 * 1024)
            modelStatus.text = "模型：已就绪（${size} MB）"
        } else {
            modelStatus.text = "模型：未安装"
        }
    }

    private fun updatePermissionStatus() {
        val mic = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        val overlay = Settings.canDrawOverlays(this)
        permissionStatus.text = "麦克风：${if (mic) "已授权" else "未授权"}　悬浮窗：${if (overlay) "已授权" else "未授权"}"
    }

    private fun startFlow() {
        savePrefs()
        if (!ModelManager.isReady(this)) {
            toast("请先下载或导入 SenseVoice 模型")
            return
        }
        if (!Settings.canDrawOverlays(this)) {
            toast("请先授予悬浮窗权限")
            openOverlaySettings()
            return
        }
        val needed = ArrayList<String>()
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            needed.add(Manifest.permission.RECORD_AUDIO)
        }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            needed.add(Manifest.permission.POST_NOTIFICATIONS)
        }
        if (needed.isNotEmpty()) {
            pendingStart = true
            requestPermissions(needed.toTypedArray(), REQ_PERMISSIONS)
            return
        }
        beginCapture()
    }

    private fun beginCapture() {
        val mode = Prefs.mode(this)
        if (mode == "system") {
            val manager = getSystemService(MediaProjectionManager::class.java)
            startActivityForResult(manager.createScreenCaptureIntent(), REQ_PROJECTION)
        } else {
            startServiceNow(0, null)
        }
    }

    private fun startServiceNow(resultCode: Int, data: Intent?) {
        val mode = Prefs.mode(this)
        val intent = Intent(this, CaptureService::class.java).apply {
            putExtra("mode", mode)
            putExtra("source", Prefs.sourceLang(this@MainActivity))
            putExtra("target", Prefs.targetLang(this@MainActivity))
            if (mode == "system") {
                putExtra("resultCode", resultCode)
                putExtra("data", data)
            }
        }
        startForegroundService(intent)
        status.text = "已启动：字幕会显示在悬浮窗"
    }

    private fun stopSubtitles() {
        stopService(Intent(this, CaptureService::class.java))
        status.text = "已停止"
    }

    private fun openOverlaySettings() {
        startActivity(
            Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:$packageName"),
            ),
        )
    }

    private fun downloadModel() {
        modelStatus.text = "准备下载…"
        Thread {
            try {
                ModelManager.download(this) { label, done, total ->
                    runOnUiThread {
                        val totalText = if (total > 0) "${done * 100 / total}%" else "${done / (1024 * 1024)}MB"
                        modelStatus.text = "$label：$totalText"
                    }
                }
                runOnUiThread {
                    updateModelStatus()
                    toast("模型已下载")
                }
            } catch (error: Throwable) {
                runOnUiThread { modelStatus.text = "下载失败：${error.message ?: "网络错误"}" }
            }
        }.start()
    }

    private fun pickModelFiles() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        }
        startActivityForResult(intent, REQ_IMPORT)
    }

    private fun importFiles(data: Intent?) {
        if (data == null) return
        val uris = ArrayList<Uri>()
        data.clipData?.let { clip ->
            for (index in 0 until clip.itemCount) uris.add(clip.getItemAt(index).uri)
        } ?: data.data?.let { uris.add(it) }
        var imported = 0
        for (uri in uris) {
            val name = displayName(uri) ?: continue
            if (ModelManager.import(this, uri, name)) imported += 1
        }
        updateModelStatus()
        toast(if (imported > 0) "已导入 $imported 个文件" else "未识别到模型文件（需要 .onnx 和 tokens.txt）")
    }

    private fun displayName(uri: Uri): String? =
        contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (!cursor.moveToFirst()) return@use null
            val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (index < 0) null else cursor.getString(index)
        }

    private fun toast(text: String) {
        Toast.makeText(this, text, Toast.LENGTH_LONG).show()
    }

    override fun onRequestPermissionsResult(code: Int, permissions: Array<String>, results: IntArray) {
        super.onRequestPermissionsResult(code, permissions, results)
        if (code != REQ_PERMISSIONS) return
        updatePermissionStatus()
        val audio = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        if (!audio) {
            toast("需要麦克风/录音权限才能采集声音")
            return
        }
        if (pendingStart) {
            pendingStart = false
            beginCapture()
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        when (requestCode) {
            REQ_PROJECTION -> {
                if (resultCode == RESULT_OK && data != null) {
                    startServiceNow(resultCode, data)
                } else {
                    toast("未授权屏幕录制")
                }
            }
            REQ_IMPORT -> importFiles(data)
        }
    }

    companion object {
        private const val REQ_PROJECTION = 1001
        private const val REQ_IMPORT = 1002
        private const val REQ_PERMISSIONS = 1003
    }
}
