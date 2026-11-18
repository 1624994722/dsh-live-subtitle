# 实时字幕 · DSH Live Subtitles

把电脑正在播放的声音实时识别成原文并翻译，显示在一个**可拖动的原生浮窗**或**桌面挂件**里。

- 本地语音识别：DSH 自带 SenseVoice（音频不出本机，约 0.1 秒识别数秒音频）。
- 翻译引擎：高质量（DeepSeek Flash，带上下文、流式出字）或快速（Bing 匿名）。
- 两种显示位置：置顶浮窗（悬于所有应用之上）或桌面挂件（贴在桌面）。
- 历史面板：深色 HUD、按时间分组、单行工具条 + 设置区。

## 下载

从本仓库的 **Releases** 下载最新的 `dsh-live-subtitle-<version>.zip`（内含 macOS 通用原生助手），按下面的「安装」步骤使用。

## 平台支持

| 平台 | 系统声音 | 置顶/桌面浮窗 | 说明 |
|---|---|---|---|
| macOS 13+（Apple Silicon / Intel） | ✅ ScreenCaptureKit | ✅ 原生浮窗 + 桌面挂件 | 需要「屏幕录制」权限；插件自带通用二进制 |
| Windows 10/11 | ⚠️ 通过「立体声混音」或 VB-Cable 作为麦克风输入 | ⚠️ 字幕在 DSH 窗口内的浮层里 | 暂无 Windows 原生采集/置顶窗助手；可使用系统自带立体声混音或安装 VB-Cable 后选为输入设备 |
| Linux | ⚠️ 麦克风 / PulseAudio monitor | ⚠️ DSH 内浮层 | 同上，无原生助手 |

> Windows 的「完全体」（直接抓系统声音 + 独立置顶窗）需要另写一个 Windows 原生助手（WASAPI 回环 + 置顶窗），它必须在 Windows 上编译和测试；当前包内没有附带，以免给你一个未经验证的 exe。见文末「Windows 完整支持」。

## 安装

### 前置

在 DSH 的 **插件** 页启用这两个内置插件（它们提供识别与翻译）：

1. **语音输入**（Voice input）——提供本地 SenseVoice；
2. **思考过程机器翻译**（Machine translation of reasoning）——提供翻译服务和 Bing 兜底。

### 安装本插件

**方式 A：本地目录（推荐）**

1. 解压 `dsh-live-subtitle-1.0.0.zip`，得到 `dsh-live-subtitle-1.0.0/` 文件夹。
2. DSH → **插件** → **添加插件**（Add plugin）→ 选择该文件夹。
3. 按 `Cmd+R`（Windows `Ctrl+R`）刷新窗口；右下角出现字幕小球。

**方式 B：命令行 / 插件管理器**

把目录传给 `plugin_manager` 的 `install_bundle`，或让 Agent 执行安装（目标为包含 `package.json` 的绝对路径）。

### macOS 权限

首次点「开始字幕」时，如果系统提示，请在：

**系统设置 → 隐私与安全性 → 屏幕录制（或「屏幕与系统音频录制」）** 中允许 **DeepSeek Harness**。

如果从浏览器下载 zip 后助手被 Gatekeeper 隔离，执行一次：

```bash
xattr -dr com.apple.quarantine /path/to/dsh-live-subtitle-1.0.0
```

## 使用

1. 点右下角小球 → 设置里选来源：
   - **系统声音**（macOS）：直接抓电脑播放的声音，不用外放、不占麦克风；
   - **麦克风**：兜底；Windows 用户在这里选「立体声混音」或 VB-Cable。
2. 选显示位置：**置顶浮窗** / **桌面挂件**（仅 macOS 系统声音模式）。
3. 点「开始字幕」；DSH 面板会自动收起，只看浮窗。
4. 想看历史时点小球打开面板；面板 ✕ 只收起，不停止；「停止」才结束。
5. 设置区可调：翻译引擎、翻译目标、字号、双语/仅译文/仅原文、面板大小、麦克风设备。

### Windows 设置（立体声混音 / VB-Cable）

1. **设置 → 系统 → 声音 → 更多声音设置 → 录制**，右键空白处勾选「显示禁用的设备」，启用 **立体声混音**；或在 Windows 上安装 [VB-Cable](https://vb-audio.com/Cable/)，把系统输出设为 CABLE Input（或用「侦听」把声音送到 CABLE Input）。
2. 在 DSH 面板里把来源选「麦克风」，打开设置，在「麦克风设备」里选 **立体声混音** / **CABLE Output**。
3. 字幕会显示在 DSH 窗口内的浮层里；把 DSH 窗口缩小放在屏幕下方即可边看边看字幕。

## 翻译引擎

- **高质量（默认）**：DeepSeek Flash，关闭思考，带最近 4 句上下文，流式出字。默认「自然口语」风格 + **深度润色**：第一遍快速出草稿，第二遍让模型以字幕编辑的方式改写成更地道、口语化的表达，再替换草稿。每句会把**识别出的文字**（不是音频）发送给 DeepSeek，消耗少量 token。失败会自动退回快速引擎（本场会话内保持退回）。
- **快速**：Bing 匿名翻译，不消耗模型 token，质量偏直译。

### 关键设置

- **源语言**：看日语内容时选「日语」，看英语选「英语」；这会让本地识别按该语言解码，显著减少识别错误，翻译自然度也会跟着提高。默认「自动识别」。
- **翻译风格**：`自然口语`（意译、口语化，默认）或 `忠实直译`（逐字对照，适合学习）。
- **深度润色**：开启后多一次模型调用（约 +0.5 秒，但草稿先显示，最终替换）；觉得慢可关。
- 切句等待约 0.4 秒；译文边生成边显示。

> 日语建议组合：源语言=日语、目标=中文、风格=自然口语、润色=开启。若仍偏字面，可再开启「忠实直译」对比，或反馈具体句子。

## 隐私

- 音频只在本机做识别，不上传。
- 高质量模式只把识别文本发给 DeepSeek；快速模式只发给 Bing。
- 不保存音频；历史仅存在当前 DSH 会话的面板里。

## 构建 macOS 原生助手

需要 Xcode Command Line Tools：

```bash
./native/build.sh
```

会编译 arm64 + x86_64 并 `lipo` 成通用二进制，输出到 `bin/live-subtitle-helper`。

## 目录

| 文件 | 作用 |
|---|---|
| `index.js` | Host：识别/翻译路由、原生助手生命周期、系统声音会话 |
| `client.js` | 面板 UI、麦克风采集、系统声音轮询、设置 |
| `bin/live-subtitle-helper` | macOS 通用原生助手（采集 + 浮窗/桌面挂件） |
| `native/LiveSubtitleHelper.swift` | 助手源码 |
| `native/build.sh` | 通用二进制构建脚本 |
| `locale/` `icon.svg` | 插件页显示信息 |

## 已知限制

- Windows / Linux 暂时没有原生系统声音采集和独立置顶窗；使用麦克风/立体声混音 + DSH 内浮层。
- 全屏视频会盖住普通置顶窗（豆包同样要求窗口模式）。
- 桌面挂件在桌面层，会被应用窗口遮住，这是 macOS 桌面挂件的正常行为。
- 只支持 SenseVoice 覆盖的语言（中、英、粤、日、韩）；其他语言识别质量会下降。
- 高质量翻译依赖你的 DSH 账号/模型配置；未配置时自动退回 Bing。

## Windows 完整支持（待 Windows 环境）

要实现和 macOS 一样的「直接抓系统声音 + 独立置顶窗」，需要一个 Windows 原生助手：

- 采集：WASAPI loopback（无需虚拟声卡）；
- 窗口：Win32/WPF 无边框置顶窗（Topmost + 不抢焦点）；
- 协议与 macOS 助手一致（stdout 16 kHz PCM、stdin JSON 字幕、`--surface floating|desktop`）；
- 放到 `bin/live-subtitle-helper.exe` 后，插件会自动走 Windows 系统声音模式（Host 已按平台选择 `.exe`）。

这部分必须在 Windows 上编译和实测（本仓库的开发机是 macOS，没有 Windows 工具链）。如果你有 Windows 机器愿意测试，我可以补上 C#/Rust 助手源码和 CI 构建流程。
