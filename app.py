"""Vimaan server: serves the website and the AI-support API.

Run:  python server/app.py      then open http://localhost:5000
"""
from __future__ import annotations

import os
import time
from collections import defaultdict, deque
from pathlib import Path

from flask import Flask, abort, jsonify, request, send_from_directory

import assistant

ROOT = Path(__file__).resolve().parent.parent
ALLOWED_DIRS = {"css", "js", "assets"}

app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = 64 * 1024  # 64 KB request cap

try:  # optional: only needed if the site is hosted on a different origin
    from flask_cors import CORS

    CORS(app, resources={r"/api/*": {"origins": os.getenv("VIMAAN_CORS_ORIGINS", "*")}})
except ImportError:
    pass

# ---- tiny in-memory rate limiter (per IP) ----
_HITS: dict[str, deque] = defaultdict(deque)
LIMIT, WINDOW = 30, 60  # 30 messages per minute


def _limited(ip: str) -> bool:
    now = time.time()
    q = _HITS[ip]
    while q and now - q[0] > WINDOW:
        q.popleft()
    if len(q) >= LIMIT:
        return True
    q.append(now)
    return False


@app.after_request
def _headers(resp):
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    return resp


@app.get("/api/health")
def health():
    return jsonify(status="ok", llm=bool(os.getenv("ANTHROPIC_API_KEY")))


@app.post("/api/chat")
def chat():
    if _limited(request.headers.get("X-Forwarded-For", request.remote_addr or "x").split(",")[0].strip()):
        return jsonify(error="Too many messages, please slow down."), 429
    data = request.get_json(silent=True) or {}
    message = str(data.get("message", "")).strip()
    if not message:
        return jsonify(error="message is required"), 400
    if len(message) > 1000:
        return jsonify(error="message too long"), 400
    ride = data.get("ride") if isinstance(data.get("ride"), dict) else None
    history = data.get("history") if isinstance(data.get("history"), list) else []
    result = assistant.respond(str(data.get("session_id", "anon"))[:64], message, history, ride)
    return jsonify(result)


# ---- website (only the public folders; server source is never exposed) ----
@app.get("/")
def index():
    return send_from_directory(ROOT, "index.html")


@app.get("/<path:path>")
def static_files(path: str):
    if path.split("/", 1)[0] not in ALLOWED_DIRS:
        abort(404)
    return send_from_directory(ROOT, path)


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    print(f"Vimaan running on http://localhost:{port}  (LLM {'on' if os.getenv('ANTHROPIC_API_KEY') else 'off: rule engine'})")
    app.run(host="0.0.0.0", port=port, debug=os.getenv("FLASK_DEBUG") == "1")
