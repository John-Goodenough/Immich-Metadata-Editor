"""Dia-Assistent: seniorengerechte Oberfläche zum Nachpflegen von Immich-Bildern."""

__version__ = "0.2.1"


def build_id() -> str:
    """Prüfsumme über den eigenen Programmcode.

    Damit erkennt der Starter einen Server, der noch mit altem Code läuft
    (z. B. nach "git pull" ohne Neustart), auch wenn die Version gleich blieb.
    """
    import hashlib
    from pathlib import Path

    root = Path(__file__).parent
    digest = hashlib.sha256()
    for path in sorted(root.rglob("*")):
        if path.is_file() and path.suffix in {".py", ".js", ".css", ".html"}:
            digest.update(path.relative_to(root).as_posix().encode())
            digest.update(path.read_bytes())
    return digest.hexdigest()[:16]
