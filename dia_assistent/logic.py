"""Reine Logik ohne Netzwerk: Datum, Beschreibung, Aufbau der Immich-Aufrufe."""

from __future__ import annotations

import calendar
from dataclasses import dataclass, field
from datetime import datetime
from zoneinfo import ZoneInfo


class InvalidInput(ValueError):
    """Ungültige Eingabe. Meldung ist deutsch."""


@dataclass
class Answers:
    """Was im Assistenten ausgefüllt wurde. None bedeutet: übersprungen."""

    year: int | None = None
    month: int | None = None
    day: int | None = None
    approximate: bool = False
    latitude: float | None = None
    longitude: float | None = None
    description: str | None = None
    person_ids: list[str] = field(default_factory=list)
    tag_values: list[str] = field(default_factory=list)


def build_date(year: int | None, month: int | None, day: int | None, tz: str) -> str | None:
    """Datum nach den Regeln: nur Jahr -> 1. Juli, Jahr+Monat -> 15., sonst genau.

    Uhrzeit ist 12:00 Ortszeit, damit das Datum in keiner Zeitzone auf den
    Nachbartag rutscht. Ergebnis ist ISO 8601 mit Offset.
    """
    if year is None:
        if month is not None or day is not None:
            raise InvalidInput("Ohne Jahr kann kein Datum gespeichert werden.")
        return None
    if not 1800 <= year <= 2100:
        raise InvalidInput("Das Jahr ist ungültig.")
    if month is None:
        if day is not None:
            raise InvalidInput("Ohne Monat kann kein Tag gespeichert werden.")
        month, day = 7, 1
    elif not 1 <= month <= 12:
        raise InvalidInput("Der Monat ist ungültig.")
    elif day is None:
        day = 15
    if not 1 <= day <= calendar.monthrange(year, month)[1]:
        raise InvalidInput("Diesen Tag gibt es in dem Monat nicht.")
    return datetime(year, month, day, 12, 0, 0, tzinfo=ZoneInfo(tz)).isoformat(timespec="milliseconds")


def merge_description(existing: str | None, new: str | None) -> str | None:
    """Neuen Text an vorhandene Beschreibung anhängen. None = nichts ändern.

    Steht der neue Text schon am Ende (z. B. nach einem abgebrochenen
    Speichern), wird er nicht doppelt angehängt.
    """
    new = (new or "").strip()
    if not new:
        return None
    existing = (existing or "").strip()
    if not existing:
        return new
    if existing.endswith(new):
        return None
    return f"{existing}\n\n{new}"


def build_asset_update(answers: Answers, existing_description: str | None, tz: str) -> dict:
    """Body für PUT /assets/{id}. Enthält nur ausgefüllte Felder."""
    body: dict = {}
    date = build_date(answers.year, answers.month, answers.day, tz)
    if date:
        body["dateTimeOriginal"] = date
    if (answers.latitude is None) != (answers.longitude is None):
        raise InvalidInput("Der Ort ist unvollständig.")
    if answers.latitude is not None:
        if not (-90 <= answers.latitude <= 90 and -180 <= answers.longitude <= 180):
            raise InvalidInput("Der Ort ist ungültig.")
        body["latitude"] = answers.latitude
        body["longitude"] = answers.longitude
    description = merge_description(existing_description, answers.description)
    if description is not None:
        body["description"] = description
    return body


def normalize_tag_value(value: str) -> str:
    """Tag-Pfad wie "Urlaub/Italien" säubern. Leere Teile sind nicht erlaubt."""
    parts = [part.strip() for part in value.split("/")]
    if not value.strip() or any(not part for part in parts):
        raise InvalidInput("Ein Thema hat keinen Namen.")
    if any(len(part) > 100 for part in parts):
        raise InvalidInput("Ein Thema hat einen zu langen Namen.")
    return "/".join(parts)


def tags_to_assign(answers: Answers, done_tag: str, approx_tag: str, date_written: bool) -> list[str]:
    """Alle Tag-Pfade, die das Bild beim Speichern bekommt (ohne Doppelte)."""
    values = [normalize_tag_value(v) for v in answers.tag_values]
    if answers.approximate and date_written:
        values.append(approx_tag)
    values.append(done_tag)
    return list(dict.fromkeys(values))


def full_image_face(asset_id: str, person_id: str, width: int, height: int) -> dict:
    """Body für POST /faces: Gesichtsrahmen über das ganze Bild."""
    return {
        "assetId": asset_id,
        "personId": person_id,
        "imageWidth": width,
        "imageHeight": height,
        "x": 0,
        "y": 0,
        "width": width,
        "height": height,
    }
