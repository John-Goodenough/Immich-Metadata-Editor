"""Start: Server auf 127.0.0.1 hochfahren und den Browser öffnen.

Läuft der Assistent schon (Port belegt), wird nur der Browser geöffnet.
"""

from __future__ import annotations

import shutil
import socket
import subprocess
import sys
import threading
import time
import webbrowser

from .config import ConfigError, load_config

HOST = "127.0.0.1"


def _port_open(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.3)
        return sock.connect_ex((HOST, port)) == 0


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
        if not no_browser:
            webbrowser.open(url)
        return 0

    import uvicorn

    from .app import create_app

    if not no_browser:
        threading.Thread(target=_open_browser_when_ready, args=(url, config.port), daemon=True).start()
    uvicorn.run(create_app(config), host=HOST, port=config.port, log_level="warning")
    return 0


if __name__ == "__main__":
    sys.exit(main())
