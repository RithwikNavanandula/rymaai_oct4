#!/usr/bin/env bash
# ============================================================
# tunnel.sh — Start the AI CCTV app AND the Cloudflare Tunnel
#             in one command.
#
# Usage:
#   ./tunnel.sh            # normal stream (15fps, 1280px)
#   ./tunnel.sh --low      # also prints the low-bandwidth URL
#
# Requirements:
#   - cloudflared must be installed (see below)
#   - The app backend must exist at ./backend/
# ============================================================

set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
CLOUDFLARED="${HOME}/.local/bin/cloudflared"
LOW_MODE=false
[[ "$1" == "--low" ]] && LOW_MODE=true

# ── Check cloudflared ─────────────────────────────────────────
if ! command -v cloudflared &>/dev/null && [ ! -f "$CLOUDFLARED" ]; then
    echo ""
    echo "  cloudflared not found. Installing..."
    mkdir -p "${HOME}/.local/bin"
    curl -fsSL \
        "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64" \
        -o "$CLOUDFLARED"
    chmod +x "$CLOUDFLARED"
    echo "  ✅ cloudflared installed to ${CLOUDFLARED}"
fi

CF="${CLOUDFLARED}"
command -v cloudflared &>/dev/null && CF="cloudflared"

# ── Build frontend if dist/ doesn't exist ─────────────────────
if [ ! -d "$ROOT/frontends/version_5/dist" ]; then
    echo ""
    echo "  Building frontend first (one-time)..."
    cd "$ROOT/frontends/version_5"
    npm install --prefer-offline --silent
    npm run build
    cd "$ROOT"
fi

# ── Kill any old process on port 5000 ─────────────────────────
fuser -k 5000/tcp 2>/dev/null || true
sleep 0.5

# ── Start Flask backend in background ────────────────────────
echo ""
echo "  Starting AI CCTV backend..."
cd "$ROOT/backend"
[ -d "venv" ] && source venv/bin/activate
python3 run.py &
FLASK_PID=$!
echo "  ✅ Backend PID: $FLASK_PID"

# ── Wait for Flask to be ready ────────────────────────────────
echo "  Waiting for server to be ready..."
for i in {1..20}; do
    curl -sf http://localhost:5000/health > /dev/null 2>&1 && break
    sleep 0.5
done

# ── Start Cloudflare Tunnel ───────────────────────────────────
echo ""
echo "  Starting Cloudflare Tunnel..."
echo "  (Ctrl+C to stop everything)"
echo ""

# Run tunnel and capture the URL from its output
$CF tunnel --url http://localhost:5000 2>&1 | while IFS= read -r line; do
    echo "$line"
    if echo "$line" | grep -q "trycloudflare.com"; then
        URL=$(echo "$line" | grep -o 'https://[^ ]*trycloudflare.com[^ ]*')
        echo ""
        echo "  ╔══════════════════════════════════════════════════════╗"
        echo "  ║   🌍  Your public URL is ready!                     ║"
        echo "  ║                                                       ║"
        echo "  ║   Full quality  : ${URL}"
        if $LOW_MODE; then
        echo "  ║   Low bandwidth : ${URL}/api/video_feed?quality=low  ║"
        fi
        echo "  ║                                                       ║"
        echo "  ║   Share this link with anyone, anywhere.             ║"
        echo "  ║   Login: demo@aicctv.com / demo123                  ║"
        echo "  ╚══════════════════════════════════════════════════════╝"
        echo ""
    fi
done

# ── Cleanup on exit ───────────────────────────────────────────
trap "echo ''; echo 'Shutting down...'; kill $FLASK_PID 2>/dev/null; exit 0" INT TERM
wait $FLASK_PID
