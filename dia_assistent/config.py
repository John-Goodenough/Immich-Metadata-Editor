"""Konfiguration aus einer einfachen KEY=VALUE-Datei (.env)."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG = PROJECT_DIR / ".env"
# Reihenfolge und Sichtbarkeit der Fragen, in der Oberfläche einstellbar
DEFAULT_STEPS_FILE = PROJECT_DIR / "ablauf.json"
ALL_STEPS = ("when", "where", "what", "who", "tags")


class ConfigError(Exception):
    """Konfiguration fehlt oder ist unvollständig. Meldung ist deutsch."""


@dataclass(frozen=True)
class Config:
    immich_url: str
    api_key: str
    tag_name: str = "Dia-Nachpflege"
    approx_tag_name: str = "Datum-ungefähr"
    done_tag_name: str = "Dia-bearbeitet"
    timezone: str = "Europe/Berlin"
    nominatim_contact: str = ""
    nominatim_url: str = "https://nominatim.openstreetmap.org/search"
    port: int = 8765
    year_from: int = 1940
    year_to: int = 2010


def parse_env(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key.strip()] = value
    return values


def load_config(path: Path | None = None) -> Config:
    path = Path(os.environ.get("DIA_CONFIG", path or DEFAULT_CONFIG))
    if not path.exists():
        raise ConfigError(f"Die Einstellungsdatei fehlt: {path}")
    values = parse_env(path.read_text(encoding="utf-8"))

    url = values.get("IMMICH_URL", "").rstrip("/")
    key = values.get("IMMICH_API_KEY", "")
    if not url or not key:
        raise ConfigError("IMMICH_URL und IMMICH_API_KEY müssen in der Einstellungsdatei stehen.")
    if url.endswith("/api"):
        url = url[: -len("/api")]

    def as_int(name: str, default: int) -> int:
        try:
            return int(values.get(name, default))
        except ValueError:
            raise ConfigError(f"{name} muss eine Zahl sein.") from None

    return Config(
        immich_url=url,
        api_key=key,
        tag_name=values.get("TAG_NAME") or Config.tag_name,
        approx_tag_name=values.get("APPROX_TAG_NAME") or Config.approx_tag_name,
        done_tag_name=values.get("DONE_TAG_NAME") or Config.done_tag_name,
        timezone=values.get("TIMEZONE") or Config.timezone,
        nominatim_contact=values.get("NOMINATIM_CONTACT", ""),
        nominatim_url=values.get("NOMINATIM_URL") or Config.nominatim_url,
        port=as_int("PORT", Config.port),
        year_from=as_int("YEAR_FROM", Config.year_from),
        year_to=as_int("YEAR_TO", Config.year_to),
    )


def validate_steps(steps: list[str]) -> list[str]:
    """Erlaubt jede Teilmenge der bekannten Fragen in beliebiger Reihenfolge, aber mindestens eine."""
    if not steps or len(set(steps)) != len(steps) or any(s not in ALL_STEPS for s in steps):
        raise ConfigError("Ungültiger Ablauf: mindestens eine Frage, keine doppelt.")
    return list(steps)


def load_steps(path: Path) -> list[str]:
    """Gespeicherter Ablauf, bei fehlender oder kaputter Datei der Standard."""
    try:
        return validate_steps(json.loads(path.read_text(encoding="utf-8"))["steps"])
    except (OSError, ValueError, KeyError, TypeError, ConfigError):
        return list(ALL_STEPS)


def save_steps(path: Path, steps: list[str]) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps({"steps": validate_steps(steps)}, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(path)
