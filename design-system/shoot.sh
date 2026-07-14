#!/usr/bin/env bash
# Render the design-system gallery to PNGs so a headless agent can SEE the UI.
# Usage: ./shoot.sh <label>   → writes .shots/<label>-desktop.png and -mobile.png
set -euo pipefail
cd "$(dirname "$0")"
LABEL="${1:-shot}"
OUT=".shots"; mkdir -p "$OUT"
URL="file://$(pwd)/gallery.html"
CHROME="$(command -v chromium || command -v chromium-browser || command -v google-chrome-stable || command -v google-chrome)"
common=(--headless --no-sandbox --hide-scrollbars --force-device-scale-factor=2
        --default-background-color=00000000 --virtual-time-budget=4000)
"$CHROME" "${common[@]}" --user-data-dir="$(mktemp -d)" --window-size=1120,2600 --screenshot="$OUT/${LABEL}-desktop.png" "$URL" >/dev/null 2>&1
"$CHROME" "${common[@]}" --user-data-dir="$(mktemp -d)" --window-size=402,2400  --screenshot="$OUT/${LABEL}-mobile.png"  "$URL" >/dev/null 2>&1
echo "wrote $OUT/${LABEL}-desktop.png  $OUT/${LABEL}-mobile.png"
