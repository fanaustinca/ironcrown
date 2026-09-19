#!/usr/bin/env python3
"""Ironcrown backend — optional cloud-save + leaderboard server.

Standard library only (no pip install needed). Serves the static frontend from
../public and exposes a tiny JSON API:

    GET  /api/health            -> {"ok": true, "version": 1}
    GET  /api/save/<player-id>  -> {"state": {...}, "meta": {...}}   (404 if none)
    POST /api/save/<player-id>  <- {"state": {...}, "meta": {"name", "power", "hall"}}
    GET  /api/leaderboard       -> {"players": [{"name", "power", "hall"}, ...]}

The frontend auto-detects this API. On GitHub Pages (static hosting) the API is
absent and the game falls back to browser localStorage.

Usage:  python3 server/server.py [--port 8000] [--host 127.0.0.1] [--data DIR]
"""
from __future__ import annotations

import argparse
import json
import re
import threading
import time
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
ID_RE = re.compile(r"^[A-Za-z0-9_-]{4,64}$")
MAX_BODY = 2 * 1024 * 1024  # 2 MB per save
VERSION = 2  # API version; saves carry their own format version


class SaveStore:
    """One JSON file per player; a lock keeps concurrent writes sane."""

    def __init__(self, directory: Path):
        self.dir = directory
        self.dir.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()

    def _path(self, pid: str) -> Path:
        return self.dir / f"{pid}.json"

    def get(self, pid: str) -> dict | None:
        p = self._path(pid)
        if not p.exists():
            return None
        with self.lock:
            return json.loads(p.read_text("utf-8"))

    def put(self, pid: str, record: dict) -> None:
        p = self._path(pid)
        tmp = p.with_suffix(".tmp")
        with self.lock:
            tmp.write_text(json.dumps(record, separators=(",", ":")), "utf-8")
            tmp.replace(p)

    def leaderboard(self, limit: int = 20) -> list[dict]:
        rows = []
        with self.lock:
            files = list(self.dir.glob("*.json"))
        for f in files:
            try:
                meta = json.loads(f.read_text("utf-8")).get("meta", {})
            except (OSError, json.JSONDecodeError):
                continue
            rows.append({
                "name": str(meta.get("name", "Unknown"))[:24],
                "power": int(meta.get("power", 0)),
                "hall": int(meta.get("hall", 1)),
            })
        rows.sort(key=lambda r: r["power"], reverse=True)
        return rows[:limit]


class Handler(SimpleHTTPRequestHandler):
    store: SaveStore  # set in main()

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC), **kwargs)

    # --- helpers -----------------------------------------------------------
    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _player_id(self) -> str | None:
        pid = self.path.split("?")[0].rsplit("/", 1)[-1]
        return pid if ID_RE.match(pid) else None

    def end_headers(self) -> None:
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, fmt: str, *args) -> None:  # quieter logs
        if "/api/" in (args[0] if args else ""):
            super().log_message(fmt, *args)

    # --- routes ------------------------------------------------------------
    def do_GET(self) -> None:
        path = self.path.split("?")[0]
        if path == "/api/health":
            return self._json(HTTPStatus.OK, {"ok": True, "version": VERSION, "time": int(time.time())})
        if path == "/api/leaderboard":
            return self._json(HTTPStatus.OK, {"players": self.store.leaderboard()})
        if path.startswith("/api/save/"):
            pid = self._player_id()
            if not pid:
                return self._json(HTTPStatus.BAD_REQUEST, {"error": "bad player id"})
            rec = self.store.get(pid)
            if rec is None:
                return self._json(HTTPStatus.NOT_FOUND, {"error": "no save"})
            return self._json(HTTPStatus.OK, rec)
        if path.startswith("/api/"):
            return self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})
        return super().do_GET()

    def do_POST(self) -> None:
        path = self.path.split("?")[0]
        if not path.startswith("/api/save/"):
            return self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})
        pid = self._player_id()
        if not pid:
            return self._json(HTTPStatus.BAD_REQUEST, {"error": "bad player id"})
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            return self._json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "body size"})
        try:
            data = json.loads(self.rfile.read(length))
        except json.JSONDecodeError:
            return self._json(HTTPStatus.BAD_REQUEST, {"error": "invalid json"})
        state, meta = data.get("state"), data.get("meta", {})
        if not isinstance(state, dict) or not isinstance(state.get("version"), int):
            return self._json(HTTPStatus.BAD_REQUEST, {"error": "invalid state"})
        self.store.put(pid, {"state": state, "meta": meta, "updated": int(time.time())})
        return self._json(HTTPStatus.OK, {"ok": True})


def main() -> None:
    ap = argparse.ArgumentParser(description="Ironcrown game server")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--data", default=str(ROOT / "server" / "data"), help="directory for save files")
    args = ap.parse_args()
    Handler.store = SaveStore(Path(args.data))
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Ironcrown running at http://{args.host}:{args.port}/  (saves in {args.data})", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
