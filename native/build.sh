#!/bin/bash
# Build the universal macOS helper used by the live-subtitle plugin.
set -euo pipefail
cd "$(dirname "$0")/.."
FRAMEWORKS=(-framework AppKit -framework ScreenCaptureKit -framework AVFoundation -framework CoreMedia)
swiftc -O -swift-version 5 -target arm64-apple-macos13.0 native/LiveSubtitleHelper.swift -o /tmp/live-subtitle-helper-arm64 "${FRAMEWORKS[@]}"
swiftc -O -swift-version 5 -target x86_64-apple-macos13.0 native/LiveSubtitleHelper.swift -o /tmp/live-subtitle-helper-x64 "${FRAMEWORKS[@]}"
lipo -create /tmp/live-subtitle-helper-arm64 /tmp/live-subtitle-helper-x64 -output bin/live-subtitle-helper
codesign --force --sign - bin/live-subtitle-helper
rm -f /tmp/live-subtitle-helper-arm64 /tmp/live-subtitle-helper-x64
echo "built bin/live-subtitle-helper"
