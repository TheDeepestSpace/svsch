#!/usr/bin/env bash
# Ensure a VNC + noVNC session is running, then launch playwright headed.
# All remaining arguments are forwarded to playwright (e.g. --grep "scenario name").
set -euo pipefail

DISPLAY_NUM=":1"
VNC_PORT=5901
NOVNC_PORT=6080

# ── xstartup: keep the X session alive (no desktop WM needed) ────────────────
if [ ! -f "$HOME/.vnc/xstartup" ]; then
  mkdir -p "$HOME/.vnc"
  printf '#!/bin/sh\nexec sleep infinity\n' > "$HOME/.vnc/xstartup"
  chmod 755 "$HOME/.vnc/xstartup"
fi

# ── Start VNC server if not already running ───────────────────────────────────
if ! pgrep -x Xtigervnc > /dev/null; then
  vncserver "$DISPLAY_NUM" -geometry 1920x1080 -depth 24 \
    -SecurityTypes None -BlacklistThreshold=0
  sleep 1
fi

# ── Start websockify / noVNC proxy if not already running ─────────────────────
if ! pgrep -f "websockify.*${NOVNC_PORT}" > /dev/null; then
  websockify --web=/usr/share/novnc "$NOVNC_PORT" "localhost:${VNC_PORT}" \
    > /tmp/websockify.log 2>&1 &
  sleep 1
fi

NOVNC_URL="http://localhost:${NOVNC_PORT}/vnc.html"

echo ""
echo "┌──────────────────────────────────────────────────────────┐"
echo "│  noVNC  →  ${NOVNC_URL}              │"
echo "│  No password — click Connect to enter                    │"
echo "└──────────────────────────────────────────────────────────┘"
echo ""

# ── Run playwright headed (snapshots skipped — rendering differs from CI) ─────
npx bddgen --config test/bdd/playwright.config.ts
SKIP_SNAPSHOTS=1 env -u ELECTRON_RUN_AS_NODE DISPLAY="$DISPLAY_NUM" \
  npx playwright test --config test/bdd/playwright.config.ts "$@"
