"""Reine Logik ohne Netzwerk: Datum, Beschreibung, Aufbau der Immich-Aufrufe."""

from __future__ import annotations

import calendar
from dataclasses import dataclass, field
from datetime import datetime
from zoneinfo import ZoneInfo


class InvalidInput(ValueError):
    """Ungültige Eingabe. Meldung ist deutsch."""


@dataclass
class FaceAnswer:
    """Ein von Immich erkanntes Gesicht bekommt eine vorhandene oder eine neue Person."""

    face_id: str
    person_id: str | None = None
    new_name: str | None = None


@dataclass
class Answers:
    """Was im Assistenten ausgefüllt wurde. None bedeutet: übersprungen."""

    year: int | None = None
    month: int | None = None
    day: int | None = None
    approximate: bool = False
    latitude: float | None = None
    longitude: float | None = None
    place_tag: str | None = None
    description: str | None = None
    person_ids: list[str] = field(default_factory=list)
    tag_values: list[str] = field(default_factory=list)
    faces: list[FaceAnswer] = field(default_factory=list)


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
    if answers.place_tag:
        values.append(normalize_tag_value(answers.place_tag))
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


def normalize_person_name(name: str) -> str:
    """Name einer neuen Person säubern: Leerraum zusammenziehen, nicht leer."""
    name = " ".join(name.split())
    if not name:
        raise InvalidInput("Eine neue Person hat keinen Namen.")
    if len(name) > 100:
        raise InvalidInput("Ein Name ist zu lang.")
    return name


def face_boxes(faces: list[dict]) -> list[dict]:
    """Antwort von GET /faces für die Oberfläche: Rahmen als Anteil der Bildgröße.

    Manuelle Gesichter (z. B. Ganzbild-Rahmen) und Gesichter versteckter
    Personen fallen weg. Sortiert von links nach rechts.
    """
    result = []
    for face in faces:
        width, height = face.get("imageWidth"), face.get("imageHeight")
        person = face.get("person") or {}
        if face.get("sourceType") == "manual" or not width or not height or person.get("isHidden"):
            continue
        x1, x2 = sorted((face["boundingBoxX1"], face["boundingBoxX2"]))
        y1, y2 = sorted((face["boundingBoxY1"], face["boundingBoxY2"]))
        result.append({
            "id": face["id"],
            "x": x1 / width,
            "y": y1 / height,
            "w": (x2 - x1) / width,
            "h": (y2 - y1) / height,
            "aspect": width / height,
            "personId": person.get("id"),
            "personName": person.get("name") or None,
        })
    return sorted(result, key=lambda f: (f["x"], f["y"]))
