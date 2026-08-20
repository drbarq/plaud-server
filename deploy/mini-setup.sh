#!/bin/bash
# Threads PWA — Mac mini deployment (run on the mini, or via SSH from the MacBook).
# Serves the app on the tailnet at https://mac-mini.<tailnet>.ts.net via
# `tailscale serve` (automatic HTTPS). Idempotent — safe to re-run for updates.
set -euo pipefail

APP_DIR="$HOME/threads"
REPO="https://github.com/drbarq/plaud-server.git"

echo "== toolchain =="
if ! command -v brew >/dev/null; then
  echo "Homebrew missing — install from https://brew.sh first" && exit 1
fi
command -v node >/dev/null || brew install node
command -v git >/dev/null || brew install git
node --version

echo "== code =="
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone "$REPO" "$APP_DIR"
fi
cd "$APP_DIR/web"

echo "== env =="
if [ ! -f .env.local ]; then
  echo "MISSING $APP_DIR/web/.env.local — copy it from the MacBook:"
  echo "  scp ~/Code/current/plaud-server/web/.env.local joetustin@mac-mini.tailf2ffdd.ts.net:threads/web/"
  exit 1
fi

echo "== build =="
npm ci
npm run build

echo "== launchd service =="
PLIST="$HOME/Library/LaunchAgents/com.joe.threads.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.joe.threads</string>
    <key>WorkingDirectory</key><string>$APP_DIR/web</string>
    <key>ProgramArguments</key>
    <array>
        <string>$(command -v npm)</string>
        <string>run</string>
        <string>start</string>
    </array>
    <key>KeepAlive</key><true/>
    <key>RunAtLoad</key><true/>
    <key>StandardOutPath</key><string>$HOME/Library/Logs/threads.log</string>
    <key>StandardErrorPath</key><string>$HOME/Library/Logs/threads.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>PORT</key><string>3000</string>
    </dict>
</dict>
</plist>
PLIST_EOF
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo "== tailscale serve (HTTPS on the tailnet) =="
tailscale serve --bg 3000 || sudo tailscale serve --bg 3000

echo "== done =="
sleep 3
curl -s -o /dev/null -w "local app: HTTP %{http_code}\n" http://localhost:3000/signin
tailscale serve status
echo "Open: https://mac-mini.tailf2ffdd.ts.net (from any tailnet device, incl. the iPhone)"
