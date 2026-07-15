#!/bin/sh
set -eu

APP_ROOT=/opt/dcolleague
COLLEAGUE_DIR=${DC_COLLEAGUE_DIR:-$APP_ROOT/colleague}

if [ "$#" -gt 0 ]; then
  exec node "$APP_ROOT/dist/cli.js" "$@"
fi

node "$APP_ROOT/dist/cli.js" inspect --colleague "$COLLEAGUE_DIR" >/dev/null

exec node "$APP_ROOT/dist/cli.js" serve \
  --colleague "$COLLEAGUE_DIR" \
  --runtime "${DC_AGENT_RUNTIME:-echo}" \
  --host 0.0.0.0 \
  --port "${DC_PORT:-8787}" \
  --web-root "$APP_ROOT/dist-web"
