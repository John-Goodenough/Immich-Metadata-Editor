"""Dia-Assistent: seniorengerechte Oberfläche zum Nachpflegen von Immich-Bildern."""

import functools
import hashlib
from pathlib import Path

__version__ = "0.6.5"


@functools.lru_cache(maxsize=None)
def build_id() -> str:
    """Prüfsumme über den eigenen Programmcode.

    Damit erkennt der Starter einen Server, der noch mit altem Code läuft
    (z. B. nach "git pull" ohne Neustart), auch wenn die Version gleich blieb.
    Berechnet wird nur einmal je Prozess: maßgeblich ist der Code beim Start.
    """
    root = Path(__file__).parent
    digest = hashlib.sha256()
    for path in sorted(root.rglob("*")):
        if path.is_file() and path.suffix in {".py", ".js", ".css", ".html"}:
            digest.update(path.relative_to(root).as_posix().encode())
            digest.update(path.read_bytes())
    return digest.hexdigest()[:16]
