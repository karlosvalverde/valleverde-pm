#!/bin/sh
# Start Valleverde PM on macOS or Linux. Double-click (macOS: rename to start.command) or run ./start.sh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Valleverde PM needs Node.js 18 or newer: https://nodejs.org"
  exit 1
fi
exec node server.js --open
