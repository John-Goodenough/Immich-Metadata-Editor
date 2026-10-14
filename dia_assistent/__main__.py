"""Start: Server auf 127.0.0.1 hochfahren und den Browser öffnen.

Läuft der Assistent schon (Port belegt), wird nur der Browser geöffnet. Läuft
dort noch ein Server mit altem Programmcode (z. B. nach einem Update), wird er
beendet und neu gestartet.
"""

from __future__ import annotations

import json
import logging
import logging.handlers
import os
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser

from . import __version__, build_id
from .app import CONTROL_HEADER
from .config import PROJECT_DIR, ConfigError, load_config

LOG_FILE = PROJECT_DIR / "dia-assistent.log"

HOST = "127.0.0.1"


def _port_open(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.3)
        return sock.connect_ex((HOST, port)) == 0


def _running_build(port: int) -> str | None:
    try:
        with urllib.request.urlopen(f"http://{HOST}:{port}/api/settings", timeout=3) as response:
            return json.load(response).get("build")
    except Exception:
        return None


def _stop_running_server(port: int) -> bool:
    """Alten Server beenden. True, wenn der Port danach frei ist."""
    request = urllib.request.Request(
        f"http://{HOST}:{port}/api/quit", method="POST", headers={CONTROL_HEADER: "1"}, data=b""
    )
    try:
        urllib.request.urlopen(request, timeout=3).close()
    except Exception:
        # v0.1.0 kennt /api/quit nicht: Prozess direkt beenden, falls es der Assistent ist
        pid = _listening_pid(port)
        if pid is not None and "dia_assistent" in _cmdline(pid):
            os.kill(pid, signal.SIGTERM)
    for _ in range(50):
        if not _port_open(port):
            return True
        time.sleep(0.1)
    return False


def _cmdline(pid: int) -> str:
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as f:
            return f.read().replace(b"\0", b" ").decode(errors="replace")
    except OSError:
        return ""


def _listening_pid(port: int) -> int | None:
    """Prozess, der auf 127.0.0.1:<port> lauscht (Linux, über /proc)."""
    inodes = set()
    try:
        with open("/proc/net/tcp") as f:
            for line in f.readlines()[1:]:
                fields = line.split()
                local, state, inode = fields[1], fields[3], fields[9]
                if state == "0A" and int(local.split(":")[1], 16) == port:  # 0A = LISTEN
                    inodes.add(f"socket:[{inode}]")
    except OSError:
        return None
    for pid in filter(str.isdigit, os.listdir("/proc")):
        try:
            for fd in os.listdir(f"/proc/{pid}/fd"):
                if os.readlink(f"/proc/{pid}/fd/{fd}") in inodes:
                    return int(pid)
        except OSError:
            continue
    return None


def _setup_logging() -> None:
    handler = logging.handlers.RotatingFileHandler(LOG_FILE, maxBytes=1_000_000, backupCount=1, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    logger = logging.getLogger("dia_assistent")
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)


def _open_browser_when_ready(url: str, port: int) -> None:
    for _ in range(100):
        if _port_open(port):
            webbrowser.open(url)
            return
        time.sleep(0.1)


def main() -> int:
    try:
        config = load_config()
    except ConfigError as exc:
        print(f"Fehler: {exc}", file=sys.stderr)
        # Beim Start per Desktop-Symbol gibt es kein Terminal: Meldung als Fenster zeigen
        if shutil.which("zenity"):
            subprocess.run(["zenity", "--error", "--title=Dia-Assistent", f"--text={exc}"], check=False)
        return 1

    url = f"http://{HOST}:{config.port}/"
    no_browser = "--no-browser" in sys.argv

    if _port_open(config.port):
        if _running_build(config.port) == build_id() or not _stop_running_server(config.port):
            # läuft schon in aktueller Version (oder ließ sich nicht beenden): nur Browser öffnen
            if not no_browser:
                webbrowser.open(url)
            return 0

    import uvicorn

    from .app import create_app

    _setup_logging()
    logging.getLogger("dia_assistent").info("Start Version %s (%s)", __version__, build_id())
    if not no_browser:
        threading.Thread(target=_open_browser_when_ready, args=(url, config.port), daemon=True).start()
    uvicorn.run(create_app(config), host=HOST, port=config.port, log_level="warning")
    return 0


if __name__ == "__main__":
    sys.exit(main())
