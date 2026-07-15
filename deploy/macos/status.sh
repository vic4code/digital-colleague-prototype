#!/bin/bash
set -euo pipefail

INSTALL_ROOT=${DC_INSTALL_ROOT:-"$HOME/Library/Application Support/DigitalColleague"}
ID=ada
while [[ $# -gt 0 ]]; do
  case "$1" in
    --id) ID=$2; shift 2 ;;
    *) echo "Usage: $0 [--id <id>]" >&2; exit 2 ;;
  esac
done

LABEL="com.digitalcolleague.$ID"
if [[ ! -L "$INSTALL_ROOT/app/current" || ! -d "$INSTALL_ROOT/colleagues/$ID" ]]; then
  echo "$ID is not installed"
  exit 1
fi

echo "$ID installed at $INSTALL_ROOT"
echo "version: $(basename "$(readlink "$INSTALL_ROOT/app/current")")"
if [[ ${DC_SKIP_SUPERVISOR:-0} == 1 ]]; then
  echo "LaunchAgent check skipped"
elif launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  echo "LaunchAgent: loaded"
else
  echo "LaunchAgent: not loaded"
  exit 1
fi
