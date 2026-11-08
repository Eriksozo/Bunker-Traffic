#!/bin/sh
# Build, self-test and install "Bunker para Mac" (notch + menu bar companion, read-only).
# Works with the Command Line Tools only. Usage: mac/build.sh [--no-install]
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
pkg="$here/BunkerNotch"
out="$here/dist"
app="$out/Bunker.app"

swift build --package-path "$pkg" -c release
bin="$(swift build --package-path "$pkg" -c release --show-bin-path)/BunkerNotch"
"$bin" --self-test

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$bin" "$app/Contents/MacOS/Bunker"
version="$(git -C "$here/.." rev-parse --short HEAD 2>/dev/null || echo dev)"
cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
 <key>CFBundleIdentifier</key><string>com.eriksozo.bunker.notch</string>
 <key>CFBundleName</key><string>Bunker</string>
 <key>CFBundleDisplayName</key><string>Bunker</string>
 <key>CFBundleExecutable</key><string>Bunker</string>
 <key>CFBundlePackageType</key><string>APPL</string>
 <key>CFBundleShortVersionString</key><string>1.0</string>
 <key>CFBundleVersion</key><string>$version</string>
 <key>LSMinimumSystemVersion</key><string>14.0</string>
 <key>LSUIElement</key><true/>
 <key>NSHumanReadableCopyright</key><string>Bunker · leitura e planejamento</string>
</dict></plist>
PLIST
# Ad-hoc signature: enough for this Mac (Keychain, notifications, login item). Not for distribution.
codesign --force --deep --sign - "$app"
codesign --verify --deep "$app"
echo "Montado: $app ($version)"

if [ "${1:-}" != "--no-install" ]; then
  dest="$HOME/Applications"
  mkdir -p "$dest"
  # Reinstalling quits the running notch; reopen it afterwards so a rebuild never leaves the owner without it.
  was_running=0; pgrep -x Bunker >/dev/null 2>&1 && was_running=1
  pkill -x Bunker 2>/dev/null || true
  rm -rf "$dest/Bunker.app"
  cp -R "$app" "$dest/Bunker.app"
  echo "Instalado: $dest/Bunker.app"
  if [ "$was_running" = 1 ] && [ "${BUNKER_NO_RELAUNCH:-}" != 1 ]; then
    for _ in 1 2 3 4 5 6 7 8 9 10; do pgrep -x Bunker >/dev/null 2>&1 || break; sleep 0.3; done
    open "$dest/Bunker.app" && echo "Reaberto: $dest/Bunker.app"
  fi
fi
