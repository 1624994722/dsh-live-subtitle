// Live subtitle helper: captures system audio with ScreenCaptureKit and shows a
// borderless, always-on-top subtitle panel. Launched by the DSH live-subtitle
// plugin. Protocol:
//   stdout : raw Int16 little-endian mono PCM, 16000 Hz, continuous
//   stderr : human-readable diagnostics
//   stdin  : newline-delimited JSON commands
//            {"type":"subtitle","original":"...","translation":"..."}
//            {"type":"config","font":22,"mode":"both"}
//            {"type":"status","text":"..."}
//            {"type":"quit"}
//
// Options: --window (default) | --headless ; --font N ; --mode both|trans|orig

import AppKit
import AVFoundation
import CoreMedia
import ScreenCaptureKit

signal(SIGPIPE, SIG_IGN)

func logLine(_ text: String) {
    FileHandle.standardError.write(Data(("live-subtitle: " + text + "\n").utf8))
}

// MARK: - Command line

var showWindow = true
var initialFont = 26.0
var initialMode = "both"
var initialSurface = "floating"

var arguments = Array(CommandLine.arguments.dropFirst())
while let argument = arguments.first {
    arguments.removeFirst()
    switch argument {
    case "--headless": showWindow = false
    case "--window": showWindow = true
    case "--font":
        if let value = arguments.first, let parsed = Double(value) { initialFont = parsed; arguments.removeFirst() }
    case "--mode":
        if let value = arguments.first { initialMode = value; arguments.removeFirst() }
    case "--surface":
        if let value = arguments.first { initialSurface = value; arguments.removeFirst() }
    default:
        logLine("unknown argument \(argument)")
    }
}

// MARK: - Subtitle panel

final class DragView: NSVisualEffectView {
    override func mouseDown(with event: NSEvent) {
        window?.performDrag(with: event)
    }
}

final class PassThroughLabel: NSTextField {
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

final class SubtitlePanel: NSPanel {
    private let originalLabel = PassThroughLabel(labelWithString: "")
    private let translationLabel = PassThroughLabel(labelWithString: "")
    private let backdrop = DragView()
    private let closeButton = NSButton()
    private var fontSize = 26.0
    private var mode = "both"
    private var hasPlaced = false
    private let surface: String
    private let panelWidth: CGFloat
    private let textWidth: CGFloat
    private let padding: CGFloat

    var currentText: (String, String) {
        (originalLabel.stringValue, translationLabel.stringValue)
    }

    init(surface: String) {
        self.surface = surface == "desktop" ? "desktop" : "floating"
        self.panelWidth = surface == "desktop" ? 360 : 480
        self.textWidth = surface == "desktop" ? 300 : 400
        self.padding = surface == "desktop" ? 12 : 16
        super.init(contentRect: NSRect(x: 0, y: 0, width: panelWidth, height: 88),
                   styleMask: [.borderless, .nonactivatingPanel],
                   backing: .buffered, defer: false)
        isOpaque = false
        backgroundColor = .clear
        hasShadow = self.surface != "desktop"
        if self.surface == "desktop" {
            level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)))
            collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
        } else {
            level = .statusBar
            collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        }
        logLine("surface: \(self.surface) level=\(level.rawValue)")
        isMovableByWindowBackground = true
        hidesOnDeactivate = false
        becomesKeyOnlyIfNeeded = true
        animationBehavior = .none

        backdrop.material = .hudWindow
        backdrop.blendingMode = .behindWindow
        backdrop.state = .active
        backdrop.wantsLayer = true
        backdrop.layer?.cornerRadius = surface == "desktop" ? 14 : 16
        backdrop.layer?.masksToBounds = true

        for label in [originalLabel, translationLabel] {
            label.isEditable = false
            label.isSelectable = false
            label.isBordered = false
            label.drawsBackground = false
            label.lineBreakMode = .byWordWrapping
            label.maximumNumberOfLines = 0
            label.cell?.wraps = true
            label.cell?.isScrollable = false
        }
        translationLabel.textColor = .white
        originalLabel.textColor = NSColor.white.withAlphaComponent(0.72)
        translationLabel.font = .systemFont(ofSize: fontSize, weight: .semibold)
        originalLabel.font = .systemFont(ofSize: max(12, fontSize * 0.72), weight: .regular)

        closeButton.title = "✕"
        closeButton.bezelStyle = .inline
        closeButton.isBordered = false
        closeButton.contentTintColor = NSColor.white.withAlphaComponent(0.55)
        closeButton.font = .systemFont(ofSize: 12, weight: .medium)
        closeButton.target = self
        closeButton.action = #selector(closeTapped)

        let content = NSView()
        content.addSubview(backdrop)
        content.addSubview(originalLabel)
        content.addSubview(translationLabel)
        content.addSubview(closeButton)
        contentView = content
        applyMode(initialMode)
        applyFont(initialFont)
    }

    @objc private func closeTapped() {
        logLine("close tapped")
        exit(0)
    }

    private func textHeight(_ text: String, font: NSFont, width: CGFloat) -> CGFloat {
        guard !text.isEmpty else { return 0 }
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineBreakMode = .byWordWrapping
        let attributes: [NSAttributedString.Key: Any] = [.font: font, .paragraphStyle: paragraph]
        let rect = (text as NSString).boundingRect(
            with: NSSize(width: width, height: CGFloat.greatestFiniteMagnitude),
            options: [.usesLineFragmentOrigin, .usesFontLeading],
            attributes: attributes)
        return ceil(rect.height)
    }

    private func applyFont(_ value: Double) {
        fontSize = min(44, max(14, value))
        translationLabel.font = .systemFont(ofSize: fontSize, weight: .semibold)
        originalLabel.font = .systemFont(ofSize: max(12, fontSize * 0.72), weight: .regular)
        resizeToFit()
    }

    private func applyMode(_ value: String) {
        mode = ["both", "trans", "orig"].contains(value) ? value : "both"
        originalLabel.isHidden = mode == "trans"
        translationLabel.isHidden = mode == "orig"
        resizeToFit()
    }

    func update(original: String?, translation: String?, status: String?) {
        if let status {
            originalLabel.stringValue = ""
            translationLabel.stringValue = status
        } else {
            if let original { originalLabel.stringValue = original }
            if let translation { translationLabel.stringValue = translation }
        }
        resizeToFit()
    }

    private func resizeToFit() {
        guard let screen = NSScreen.main else { return }
        let originalText = originalLabel.isHidden ? "" : originalLabel.stringValue
        let translationText = translationLabel.isHidden ? "" : translationLabel.stringValue
        let originalHeight = textHeight(originalText, font: originalLabel.font ?? .systemFont(ofSize: 18), width: textWidth)
        let translationHeight = textHeight(translationText, font: translationLabel.font ?? .systemFont(ofSize: 26), width: textWidth)
        let gap: CGFloat = originalText.isEmpty || translationText.isEmpty ? 0 : 5
        let contentHeight = padding + originalHeight + gap + translationHeight + padding
        let height = max(120, min(CGFloat(screen.visibleFrame.height * 0.55), contentHeight))
        let frame = self.frame
        let x: CGFloat
        let y: CGFloat
        if surface == "desktop" {
            x = hasPlaced ? frame.minX : screen.visibleFrame.maxX - panelWidth - 40
            let top = hasPlaced ? frame.maxY : screen.visibleFrame.maxY - 40
            y = top - height
        } else {
            x = hasPlaced ? frame.minX : screen.visibleFrame.midX - panelWidth / 2
            let bottom = hasPlaced ? frame.minY : screen.visibleFrame.minY + 90
            y = bottom
        }
        setFrame(NSRect(x: x, y: y, width: panelWidth, height: height), display: true)
        backdrop.frame = NSRect(x: 0, y: 0, width: panelWidth, height: height)
        var textY = padding
        if !originalText.isEmpty {
            originalLabel.frame = NSRect(x: 20, y: textY, width: textWidth, height: originalHeight)
            textY += originalHeight + gap
        }
        if !translationText.isEmpty {
            translationLabel.frame = NSRect(x: 20, y: textY, width: textWidth, height: translationHeight)
        }
        closeButton.frame = NSRect(x: panelWidth - 30, y: 8, width: 20, height: 20)
        hasPlaced = true
        orderFrontRegardless()
    }

    func updateConfig(font: Double?, mode: String?) {
        if let font { applyFont(font) }
        if let mode { applyMode(mode) }
    }
}

// MARK: - Audio capture

final class AudioTap: NSObject, SCStreamOutput {
    private let output = FileHandle.standardOutput
    private var reported = false

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, sampleBuffer.isValid else { return }
        guard let format = CMSampleBufferGetFormatDescription(sampleBuffer),
              let description = CMAudioFormatDescriptionGetStreamBasicDescription(format) else { return }
        let asbd = description.pointee
        let channels = Int(max(1, asbd.mChannelsPerFrame))
        let isFloat = (asbd.mFormatFlags & kAudioFormatFlagIsFloat) != 0

        var bufferList = AudioBufferList()
        var blockBuffer: CMBlockBuffer?
        let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer,
            bufferListSizeNeededOut: nil,
            bufferListOut: &bufferList,
            bufferListSize: MemoryLayout<AudioBufferList>.size,
            blockBufferAllocator: nil,
            blockBufferMemoryAllocator: nil,
            flags: 0,
            blockBufferOut: &blockBuffer)
        guard status == noErr else { return }

        var samples = [Int16]()
        let buffers = UnsafeMutableAudioBufferListPointer(&bufferList)
        for buffer in buffers {
            guard let data = buffer.mData else { continue }
            let bytes = Int(buffer.mDataByteSize)
            let frames = isFloat ? bytes / MemoryLayout<Float>.size : bytes / MemoryLayout<Int16>.size
            if isFloat {
                data.bindMemory(to: Float.self, capacity: frames)
                let floats = UnsafeBufferPointer(start: data.assumingMemoryBound(to: Float.self), count: frames)
                if channels == 1 {
                    for index in 0..<frames {
                        samples.append(Int16(max(-32768, min(32767, floats[index] * 32767))))
                    }
                } else {
                    let frameCount = frames / channels
                    for frame in 0..<frameCount {
                        var sum: Float = 0
                        for channel in 0..<channels { sum += floats[frame * channels + channel] }
                        samples.append(Int16(max(-32768, min(32767, (sum / Float(channels)) * 32767))))
                    }
                }
            } else {
                data.bindMemory(to: Int16.self, capacity: frames)
                let ints = UnsafeBufferPointer(start: data.assumingMemoryBound(to: Int16.self), count: frames)
                if channels == 1 {
                    samples.append(contentsOf: ints)
                } else {
                    var index = 0
                    while index + channels <= frames {
                        samples.append(ints[index])
                        index += channels
                    }
                }
            }
        }
        if !samples.isEmpty {
            if !reported {
                reported = true
                logLine("audio format: \(asbd.mSampleRate) Hz, \(channels) ch, float=\(isFloat)")
            }
            let little = samples.map { $0.littleEndian }
            let data = little.withUnsafeBufferPointer { Data(buffer: $0) }
            do { try output.write(contentsOf: data) } catch {
                logLine("stdout closed")
                exit(0)
            }
        }
    }
}

// MARK: - App

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var panel: SubtitlePanel?
    private var surface = initialSurface
    private var stream: SCStream?
    private let tap = AudioTap()
    private var captureStarted = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        if showWindow {
            surface = initialSurface == "desktop" ? "desktop" : "floating"
            let panel = SubtitlePanel(surface: surface)
            self.panel = panel
            panel.update(original: "", translation: "正在启动系统声音字幕…", status: nil)
        }
        readCommands()
        startCapture()
    }

    private func readCommands() {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            while let line = readLine() {
                guard let data = line.data(using: .utf8),
                      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let type = object["type"] as? String else { continue }
                DispatchQueue.main.async {
                    guard let self else { return }
                    switch type {
                    case "subtitle":
                        self.panel?.update(original: object["original"] as? String,
                                           translation: object["translation"] as? String,
                                           status: object["status"] as? String)
                    case "config":
                        self.panel?.updateConfig(font: object["font"] as? Double, mode: object["mode"] as? String)
                        if let next = object["surface"] as? String { self.applySurface(next) }
                    case "status":
                        self.panel?.update(original: nil, translation: object["text"] as? String, status: nil)
                    case "quit":
                        exit(0)
                    default:
                        break
                    }
                }
            }
            logLine("stdin closed")
            exit(0)
        }
    }

    private func applySurface(_ value: String) {
        let next = value == "desktop" ? "desktop" : "floating"
        guard showWindow, next != surface else { return }
        surface = next
        let text = panel?.currentText ?? ("", "")
        panel?.orderOut(nil)
        panel?.close()
        let replacement = SubtitlePanel(surface: next)
        panel = replacement
        replacement.update(original: text.0, translation: text.1, status: nil)
    }

    private func startCapture() {
        Task { [weak self] in
            guard let self else { return }
            do {
                let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
                guard let display = content.displays.first else {
                    logLine("no display")
                    exit(2)
                }
                let filter = SCContentFilter(display: display, excludingWindows: [])
                let config = SCStreamConfiguration()
                config.capturesAudio = true
                config.excludesCurrentProcessAudio = true
                config.sampleRate = 16000
                config.channelCount = 1
                config.width = 2
                config.height = 2
                config.minimumFrameInterval = CMTime(value: 1, timescale: 2)
                let stream = SCStream(filter: filter, configuration: config, delegate: nil)
                try stream.addStreamOutput(self.tap, type: .audio, sampleHandlerQueue: DispatchQueue(label: "live-subtitle.audio", qos: .userInitiated))
                try await stream.startCapture()
                self.stream = stream
                self.captureStarted = true
                logLine("capture started")
            } catch {
                logLine("capture failed: \(error)")
                FileHandle.standardError.write(Data("permission-or-error\n".utf8))
                exit(3)
            }
        }
    }
}

let application = NSApplication.shared
application.setActivationPolicy(.accessory)
let delegate = AppDelegate()
application.delegate = delegate
application.run()
