#!/bin/sh
# Rebuild the server (incl. web UI), the Safari extension and the menu bar app, then
# replace /Applications/Jobs.app and launch it. Run after any change to src/ or menubar/.
set -eu
cd "$(dirname "$0")/menubar"
# `open` does nothing for an already-running app, so quit it first; otherwise the old server keeps running.
osascript -e 'tell application "Jobs" to quit' >/dev/null 2>&1 || true
pkill -x jobs-server 2>/dev/null || true
exec make install
