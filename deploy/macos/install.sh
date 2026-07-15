#!/bin/bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
INSTALL_ROOT=${DC_INSTALL_ROOT:-"$HOME/Library/Application Support/DigitalColleague"}
LAUNCH_AGENTS_DIR=${DC_LAUNCH_AGENTS_DIR:-"$HOME/Library/LaunchAgents"}
LOG_ROOT=${DC_LOG_ROOT:-"$HOME/Library/Logs/DigitalColleague"}
COLLEAGUE_SOURCE=

usage() {
  echo "Usage: $0 --colleague <directory>" >&2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --colleague) COLLEAGUE_SOURCE=$2; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage; exit 2 ;;
  esac
done

[[ -n "$COLLEAGUE_SOURCE" && -d "$COLLEAGUE_SOURCE" ]] || { usage; exit 2; }
command -v node >/dev/null 2>&1 || { echo "Node.js 20.19+ is required." >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm is required." >&2; exit 1; }
if [[ ${DC_SKIP_CODEX_PREFLIGHT:-0} != 1 ]]; then
  command -v codex >/dev/null 2>&1 || { echo "Codex CLI is required." >&2; exit 1; }
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
NODE_MINOR=$(node -p "process.versions.node.split('.')[1]")
if (( NODE_MAJOR < 20 || (NODE_MAJOR == 20 && NODE_MINOR < 19) )); then
  echo "Node.js 20.19+ is required; found $(node --version)." >&2
  exit 1
fi

ID=$(node -e "const fs=require('fs');const p=process.argv[1]+'/person.yaml';const m=fs.readFileSync(p,'utf8').match(/^id:\\s*[\\\"']?([^\\s\\\"']+)/m);if(!m)process.exit(1);process.stdout.write(m[1])" "$COLLEAGUE_SOURCE")
[[ "$ID" =~ ^[a-z0-9][a-z0-9-]*$ ]] || { echo "Invalid colleague id: $ID" >&2; exit 1; }
VERSION=$(node -e "process.stdout.write(require(process.argv[1]).version)" "$REPO_ROOT/package.json")
APP_VERSION="$INSTALL_ROOT/app/$VERSION"
APP_CURRENT="$INSTALL_ROOT/app/current"
COLLEAGUE_TARGET="$INSTALL_ROOT/colleagues/$ID"
ENV_FILE="$INSTALL_ROOT/env/$ID.env"
LOG_DIR="$LOG_ROOT/$ID"
LABEL="com.digitalcolleague.$ID"
PLIST="$LAUNCH_AGENTS_DIR/$LABEL.plist"

if [[ ${DC_SKIP_BUILD:-0} != 1 ]]; then
  (cd "$REPO_ROOT" && npm ci && npm run build && npm run build:web)
fi

rm -rf "$APP_VERSION"
mkdir -p "$APP_VERSION/deploy/macos" "$INSTALL_ROOT/colleagues" "$INSTALL_ROOT/env" "$INSTALL_ROOT/state/$ID/memory" "$LOG_DIR" "$LAUNCH_AGENTS_DIR"
cp "$REPO_ROOT/package.json" "$REPO_ROOT/package-lock.json" "$APP_VERSION/"
cp -R "$REPO_ROOT/dist" "$REPO_ROOT/dist-web" "$APP_VERSION/"
cp "$SCRIPT_DIR/run-colleague.sh" "$APP_VERSION/deploy/macos/"
chmod 0555 "$APP_VERSION/deploy/macos/run-colleague.sh"
if [[ ${DC_SKIP_DEPENDENCIES:-0} != 1 ]]; then
  (cd "$APP_VERSION" && npm ci --omit=dev)
fi
ln -sfn "$VERSION" "$APP_CURRENT"

if [[ ! -d "$COLLEAGUE_TARGET" ]]; then
  cp -R "$COLLEAGUE_SOURCE" "$COLLEAGUE_TARGET"
fi
if [[ ! -f "$ENV_FILE" ]]; then
  printf '%s\n' 'DC_AGENT_RUNTIME=codex' 'DC_HOST=127.0.0.1' 'DC_PORT=8787' >"$ENV_FILE"
fi
chmod 0600 "$ENV_FILE"

node "$SCRIPT_DIR/render-plist.mjs" \
  "$SCRIPT_DIR/com.digitalcolleague.plist.template" \
  "$PLIST" "$LABEL" "$APP_CURRENT/deploy/macos/run-colleague.sh" \
  "$INSTALL_ROOT" "$ID" "$APP_CURRENT" \
  "$LOG_DIR/stdout.log" "$LOG_DIR/stderr.log"
chmod 0644 "$PLIST"
plutil -lint "$PLIST" >/dev/null

if [[ ${DC_SKIP_SUPERVISOR:-0} != 1 ]]; then
  DOMAIN="gui/$(id -u)"
  launchctl bootout "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
  launchctl bootstrap "$DOMAIN" "$PLIST"
  launchctl kickstart -k "$DOMAIN/$LABEL"
fi

echo "Installed $ID $VERSION"
echo "Open http://127.0.0.1:8787"
