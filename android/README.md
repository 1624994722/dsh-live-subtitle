# 实时字幕 · Android 独立 App

手机本地识别（SenseVoice）+ DeepSeek 翻译 + 可拖动悬浮字幕。不需要电脑或 DSH 在后台运行。

> 这是 `dsh-live-subtitle` DSH 插件的 Android 版本，源码与桌面插件放在同一仓库。

## 状态

- 版本 **0.1.0**，debug 构建（debug 签名，未上架）。
- minSdk **29（Android 10+）**，targetSdk 34，仅 **arm64-v8a**。
- 编译和静态检查通过（包名/权限/ABI/Service 均核对）；**上传时尚未在真机上完成完整验证**，模型加载、`MediaProjection` 采集和悬浮窗是重点观察项。真机跑通前请按调试版对待。

## 功能

- **系统声音采集**：`MediaProjection` + `AudioPlaybackCapture`，需每次授权「屏幕录制」；只能抓允许被录制的 App（YouTube/多数播放器可用，Netflix 等 DRM 内容可能无声）。
- **麦克风模式**：用于先验证识别/翻译/悬浮窗链路。
- **本地识别**：sherpa-onnx + SenseVoiceSmall int8（约 228 MB，App 内下载或导入）。
- **翻译**：DeepSeek API（OpenAI 兼容 `chat/completions`），自然口语提示词、带上下文；不填 Key 时只显示原文。
- **悬浮字幕**：可拖动、`A+`/`A−` 调字号、`✕` 关闭；深色 HUD。

## 安装 APK

从本仓库的 **Releases** 下载 `dsh-live-subtitle-android-0.1.0-debug.apk`（33 MB，SHA256 见 Release 附件 `SHA256SUMS`）。

```bash
adb install -r dsh-live-subtitle-android-0.1.0-debug.apk
```

或把 APK 传到手机、允许「安装未知来源应用」后手动安装。

## 首次使用

1. **准备模型**（约 230 MB）：
   - App 内点「下载模型」（走 hf-mirror，需网络）；或
   - 从电脑导入：`adb push model.int8.onnx /sdcard/Download/` 和 `adb push tokens.txt /sdcard/Download/`，然后在 App 里点「导入模型文件」选择这两个文件。
2. **填 DeepSeek API Key**：在 <https://platform.deepseek.com> 创建（DSH 账号不能直接用于 App 的 API）。
3. **授予悬浮窗权限**：点「打开悬浮窗权限设置」。
4. **源语言**按内容选择（日语内容选「日语」），目标语言选中文。
5. 来源先选 **麦克风** 测一遍识别/翻译/悬浮窗；再切 **系统声音**。
6. 播放视频 → 点「开始字幕」→ 允许屏幕录制 → 悬浮窗出现。

## 从源码构建

前置：JDK 17、Android SDK `platforms;android-34` 与 `build-tools;34.0.0`、Gradle 8.9。

1. 下载 sherpa-onnx 预编译 AAR（47 MB，仓库不提交二进制）：

   ```bash
   curl -L -o android/app/libs/sherpa-onnx.aar \
     https://github.com/k2-fsa/sherpa-onnx/releases/download/v2.0.1/sherpa-onnx-2.0.1.aar
   ```

2. 设置环境并构建：

   ```bash
   export JAVA_HOME=/path/to/jdk-17
   export ANDROID_HOME=/path/to/android-sdk
   gradle -p android assembleDebug
   ```

3. APK 输出：`android/app/build/outputs/apk/debug/app-debug.apk`。

## 目录

| 文件 | 作用 |
|---|---|
| `app/src/main/java/com/dsh/livesubtitle/MainActivity.kt` | 设置界面、模型下载/导入、权限与启动流程 |
| `app/src/main/java/com/dsh/livesubtitle/CaptureService.kt` | 前台服务：MediaProjection/麦克风采集、识别与翻译调度 |
| `app/src/main/java/com/dsh/livesubtitle/AsrEngine.kt` | sherpa-onnx SenseVoice 封装 |
| `app/src/main/java/com/dsh/livesubtitle/ModelManager.kt` | 模型下载、导入、清理 |
| `app/src/main/java/com/dsh/livesubtitle/Translator.kt` | DeepSeek 翻译（自然口语提示词、上下文） |
| `app/src/main/java/com/dsh/livesubtitle/OverlayController.kt` | 悬浮字幕窗 |
| `app/src/main/java/com/dsh/livesubtitle/Segmenter.kt` | 按停顿切句 |
| `app/src/main/java/com/dsh/livesubtitle/Prefs.kt` | 本地设置 |

## 已知限制

- debug 构建，正式分发需要 release 签名；首次启动模型加载约 1–3 秒。
- 仅 arm64-v8a；32 位设备/模拟器需要另行配置 ABI。
- 系统声音受系统限制：DRM 应用可能静音，部分播放器禁止录制；麦克风模式始终可用。
- 全屏视频会盖住普通悬浮窗，需要窗口模式播放。
