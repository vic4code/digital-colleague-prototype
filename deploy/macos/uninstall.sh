#!/bin/bash
set -euo pipefail

INSTALL_ROOT=${DC_INSTALL_ROOT:-"$HOME/Library/Application Support/DigitalColleague"}
LAUNCH_AGENTS_DIR=${DC_LAUNCH_AGENTS_DIR:-"$HOME/Library/LaunchAgents"}
LOG_ROOT=${DC_LOG_ROOT:-"$HOME/Library/Logs/DigitalColleague"}
ID=ada
PURGE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --id) ID=$2; shift 2 ;;
    --purge-data) PURGE=1; shift ;;
    *) echo "Usage: $0 [--id <id>] [--purge-data]" >&2; exit 2 ;;
  esac
done

LABEL="com.digitalcolleague.$ID"
PLIST="$LAUNCH_AGENTS_DIR/$LABEL.plist"
if [[ ${DC_SKIP_SUPERVISOR:-0} != 1 ]]; then
  launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
fi
rm -f "$PLIST"
rm -rf "$INSTALL_ROOT/app"

if [[ $PURGE == 1 ]]; then
  rm -rf "$INSTALL_ROOT/colleagues/$ID" "$INSTALL_ROOT/env/$ID.env" "$INSTALL_ROOT/state/$ID" "$LOG_ROOT/$ID"
  echo "Uninstalled $ID and purged its data"
else
  echo "Uninstalled $ID; colleague, environment, memory, and logs were preserved"
fi
