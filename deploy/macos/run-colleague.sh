#!/bin/bash
set -euo pipefail

INSTALL_ROOT=${DC_INSTALL_ROOT:-"$HOME/Library/Application Support/DigitalColleague"}
ID=ada

while [[ $# -gt 0 ]]; do
  case "$1" in
    --root) INSTALL_ROOT=$2; shift 2 ;;
    --id) ID=$2; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

ENV_FILE="$INSTALL_ROOT/env/$ID.env"
APP_CURRENT="$INSTALL_ROOT/app/current"
COLLEAGUE_DIR="$INSTALL_ROOT/colleagues/$ID"
MEMORY_DIR="$INSTALL_ROOT/state/$ID/memory"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # This user-owned file is protected with mode 600 by install.sh.
  source "$ENV_FILE"
  set +a
fi

RUNTIME=${DC_AGENT_RUNTIME:-codex}
PORT=${DC_PORT:-8787}
HOST=${DC_HOST:-127.0.0.1}

command -v node >/dev/null 2>&1 || { echo "Node.js is required." >&2; exit 1; }
if [[ "$RUNTIME" == codex ]]; then
  command -v codex >/dev/null 2>&1 || { echo "Codex CLI is required." >&2; exit 1; }
  codex login status >/dev/null
fi
[[ -f "$APP_CURRENT/dist/cli.js" ]] || { echo "Installed app is incomplete." >&2; exit 1; }
[[ -d "$COLLEAGUE_DIR" ]] || { echo "Colleague '$ID' is not installed." >&2; exit 1; }
mkdir -p "$MEMORY_DIR"

export DC_MEMORY_DIR="$MEMORY_DIR"
exec node "$APP_CURRENT/dist/cli.js" serve \
  --colleague "$COLLEAGUE_DIR" \
  --runtime "$RUNTIME" \
  --host "$HOST" \
  --port "$PORT" \
  --web-root "$APP_CURRENT/dist-web"
