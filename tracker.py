"""Local job application tracker. Standard library only.

Run:  python tracker.py
Then open http://127.0.0.1:8765

Data lives in applications.json next to this file. The server only listens on
this computer. Set TRACKER_DATA and TRACKER_PORT to use another file or port.
"""
import json
import os
import re
import shutil
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

BASE = Path(__file__).resolve().parent
DATA = Path(os.environ.get("TRACKER_DATA", BASE / "applications.json"))
PORT = int(os.environ.get("TRACKER_PORT", "8765"))
HOSTS = {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}
ORIGINS = {f"http://{host}" for host in HOSTS}
STATIC = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/styles.css": ("styles.css", "text/css; charset=utf-8"),
}
STATUSES = ["Interested", "Applied", "Screening", "Interviewing", "Offer", "Rejected", "Withdrawn"]
TEXT_LIMITS = {
    "company": 120, "role": 160, "location": 120, "pay": 80, "resume": 160,
    "contact": 200, "next_step": 300, "notes": 4000,
}
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
LOCK = threading.Lock()


def load():
    if not DATA.exists():
        return []
    with DATA.open(encoding="utf-8") as handle:
        return json.load(handle)


def save(items):
    """Write atomically and keep one backup, so a crash cannot corrupt the data."""
    if DATA.exists():
        shutil.copyfile(DATA, DATA.with_suffix(".backup.json"))
    temp = DATA.with_suffix(".tmp")
    with temp.open("w", encoding="utf-8") as handle:
        json.dump(items, handle, indent=2)
    os.replace(temp, DATA)


def clean(raw):
    """Validate a submitted application and return only known fields."""
    if not isinstance(raw, dict):
        raise ValueError("Expected an object")
    item = {}
    for field, limit in TEXT_LIMITS.items():
        value = raw.get(field, "")
        if not isinstance(value, str):
            raise ValueError(f"{field} must be text")
        value = value.strip()
        if len(value) > limit:
            raise ValueError(f"{field} is too long")
        item[field] = value
    if not item["company"] or not item["role"]:
        raise ValueError("Company and role are required")

    status = raw.get("status", "Interested")
    if status not in STATUSES:
        raise ValueError("Unknown status")
    item["status"] = status

    for field in ("applied", "next_date"):
        value = raw.get(field, "") or ""
        if not isinstance(value, str) or (value and not DATE.match(value)):
            raise ValueError(f"{field} must be a date")
        item[field] = value

    url = raw.get("url", "") or ""
    if not isinstance(url, str) or len(url) > 2000:
        raise ValueError("Link is not valid")
    url = url.strip()
    if url:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise ValueError("Link must start with http:// or https://")
    item["url"] = url

    rank = raw.get("rank", "")
    if rank in ("", None):
        item["rank"] = None
    else:
        if isinstance(rank, (bool, float)):
            raise ValueError("Priority must be a whole number")
        try:
            rank = int(rank)
        except (TypeError, ValueError):
            raise ValueError("Priority must be a whole number") from None
        if not 1 <= rank <= 9999:
            raise ValueError("Priority must be between 1 and 9999")
        item["rank"] = rank
    return item


class Handler(BaseHTTPRequestHandler):
    server_version = "JobTracker"
    sys_version = ""

    def log_message(self, *args):
        pass

    def send_body(self, status, body, content_type):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, status, value):
        self.send_body(status, json.dumps(value).encode("utf-8"), "application/json")

    def host_ok(self):
        """Refuse other hosts, which blocks DNS rebinding from a website."""
        if self.headers.get("Host") in HOSTS:
            return True
        self.send_json(403, {"error": "Forbidden"})
        return False

    def write_ok(self):
        """Refuse writes from other websites."""
        origin = self.headers.get("Origin")
        if origin is not None and origin not in ORIGINS:
            self.send_json(403, {"error": "Forbidden"})
            return False
        if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
            self.send_json(415, {"error": "Expected JSON"})
            return False
        return True

    def read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > 100_000:
            raise ValueError("Request is too large")
        return json.loads(self.rfile.read(length) or b"{}")

    def item_id(self):
        match = re.fullmatch(r"/api/applications/([0-9a-f-]{36})", self.path)
        return match.group(1) if match else None

    def do_GET(self):
        if not self.host_ok():
            return
        if self.path == "/api/applications":
            with LOCK:
                self.send_json(200, {"statuses": STATUSES, "applications": load()})
        elif self.path in STATIC:
            name, content_type = STATIC[self.path]
            self.send_body(200, (BASE / name).read_bytes(), content_type)
        else:
            self.send_json(404, {"error": "Not found"})

    def do_POST(self):
        if not self.host_ok() or not self.write_ok():
            return
        if self.path != "/api/applications":
            self.send_json(404, {"error": "Not found"})
            return
        try:
            item = clean(self.read_json())
        except ValueError as err:
            self.send_json(400, {"error": str(err)})
            return
        item["id"] = str(uuid.uuid4())
        with LOCK:
            items = load()
            items.append(item)
            save(items)
        self.send_json(201, item)

    def do_PUT(self):
        if not self.host_ok() or not self.write_ok():
            return
        item_id = self.item_id()
        try:
            item = clean(self.read_json())
        except ValueError as err:
            self.send_json(400, {"error": str(err)})
            return
        with LOCK:
            items = load()
            for index, existing in enumerate(items):
                if existing.get("id") == item_id:
                    item["id"] = item_id
                    items[index] = item
                    save(items)
                    self.send_json(200, item)
                    return
        self.send_json(404, {"error": "Not found"})

    def do_DELETE(self):
        if not self.host_ok():
            return
        origin = self.headers.get("Origin")
        if origin is not None and origin not in ORIGINS:
            self.send_json(403, {"error": "Forbidden"})
            return
        item_id = self.item_id()
        with LOCK:
            items = load()
            remaining = [item for item in items if item.get("id") != item_id]
            if len(remaining) == len(items):
                self.send_json(404, {"error": "Not found"})
                return
            save(remaining)
        self.send_json(200, {"deleted": item_id})


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Job tracker running at http://127.0.0.1:{PORT}  (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
