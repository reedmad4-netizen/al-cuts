#!/bin/bash
# CLIPX AI — macOS / Linux launcher.
# macOS: double-click (Terminal opens, the app window follows).
cd "$(dirname "$0")/.." || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "CLIPX AI needs Node.js 18.18 or newer — install it from https://nodejs.org"
  read -r -p "Press Enter to close…"
  exit 1
fi
exec node desktop/launch.mjs
