#!/usr/bin/env bash
# ============================================================
# start.sh — ONE command to run the entire AI CCTV system.
#
#   First run:    ./start.sh
#   After changes to backend only:  ./start.sh --skip-build
#
# Everything — frontend + backend — is served on http://localhost:5000
# No separate npm server is needed.
# ============================================================

set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
FRONTEND="$ROOT/frontends/version_5"
BACKEND="$ROOT/backend"

# ── Step 1: Build React frontend (skippable) ──────────────────
if [[ "$1" != "--skip-build" ]]; then
    echo ""
    echo "══════════════════════════════════════════"
    echo "  Step 1/2 — Building React frontend..."
    echo "══════════════════════════════════════════"
    cd "$FRONTEND"
    npm install --prefer-offline --silent
    npm run build
    echo "  ✅ Built → frontends/version_5/dist/"
fi

# ── Step 2: Start Flask (serves both API + built frontend) ────
echo ""
echo "══════════════════════════════════════════"
echo "  Step 2/2 — Starting server..."
echo "  ➜  Open: http://localhost:5000"
echo "══════════════════════════════════════════"

cd "$BACKEND"

if [ -d "venv" ]; then
    source venv/bin/activate
fi

# run.py patches gevent before imports; falls back to threaded Flask if not installed
python3 run.py
