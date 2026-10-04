#!/usr/bin/env python3
"""
run.py — Production entry point for the AI CCTV backend.

gevent's monkey-patch MUST happen before any other import that touches
networking (ssl, socket, threading). This file exists solely to guarantee
that ordering before `app.py` is imported.

Usage:
    python run.py
"""

# ── 1. Patch standard library with gevent coroutines ──────────────────────────
try:
    from gevent import monkey
    monkey.patch_all(thread=False)  # thread=False: keep real threads for YOLO/CV2
    _gevent_ok = True
except ImportError:
    _gevent_ok = False

# ── 2. Now it is safe to import the app ───────────────────────────────────────
from app import app  # noqa: E402  (import after patching is intentional)

# ── 3. Start the server ───────────────────────────────────────────────────────
if __name__ == '__main__':
    HOST, PORT = '0.0.0.0', 5000

    if _gevent_ok:
        from gevent.pywsgi import WSGIServer
        print(f"\n  🚀  gevent WSGIServer  →  http://localhost:{PORT}\n")
        WSGIServer((HOST, PORT), app).serve_forever()
    else:
        print(f"\n  ⚠️  gevent not found — using Flask dev server (install gevent for lower latency)\n"
              f"  🌐  http://localhost:{PORT}\n")
        app.run(host=HOST, port=PORT, threaded=True)
