"""Ortssuche über Nominatim (OpenStreetMap), mit 1 Anfrage pro Sekunde."""

from __future__ import annotations

import asyncio
import time

import httpx

from . import __version__
from .immich import ImmichError


# Nominatim "addresstype" (bzw. "type") auf deutsche Bezeichnungen, damit z. B. Stadt und Kreis
# gleichen Namens unterscheidbar sind. Unbekannte Arten bleiben ohne Bezeichnung.
KINDS = {
    "city": "Stadt",
    "town": "Stadt",
    "village": "Dorf",
    "hamlet": "Weiler",
    "isolated_dwelling": "Einzelhof",
    "farm": "Hof",
    "locality": "Ortslage",
    "municipality": "Gemeinde",
    "suburb": "Stadtteil",
    "borough": "Stadtbezirk",
    "city_district": "Stadtbezirk",
    "district": "Bezirk",
    "quarter": "Viertel",
    "neighbourhood": "Viertel",
    "city_block": "Häuserblock",
    "county": "Kreis",
    "state_district": "Regierungsbezirk",
    "state": "Bundesland",
    "province": "Provinz",
    "region": "Region",
    "country": "Land",
    "continent": "Kontinent",
    "island": "Insel",
    "islet": "Insel",
    "road": "Straße",
    "peak": "Berg",
    "mountain_range": "Gebirge",
    "water": "Gewässer",
    "lake": "See",
    "river": "Fluss",
    "bay": "Bucht",
    "beach": "Strand",
    "station": "Bahnhof",
    "attraction": "Sehenswürdigkeit",
    "castle": "Burg/Schloss",
    "church": "Kirche",
    "museum": "Museum",
    "park": "Park",
}


def place_kind(item: dict) -> str | None:
    for key in ("addresstype", "type"):
        kind = KINDS.get(item.get(key) or "")
        if kind:
            return kind
    return None


class Geocoder:
    def __init__(self, url: str, contact: str = "", transport: httpx.AsyncBaseTransport | None = None):
        agent = f"Dia-Assistent/{__version__} (privates Familienprojekt"
        agent += f"; {contact})" if contact else ")"
        self._http = httpx.AsyncClient(
            headers={"User-Agent": agent, "Accept-Language": "de"},
            timeout=httpx.Timeout(15.0, connect=10.0),
            transport=transport,
        )
        self._url = url
        self._lock = asyncio.Lock()
        self._last = 0.0
        self._cache: dict[str, list[dict]] = {}

    async def aclose(self) -> None:
        await self._http.aclose()

    async def search(self, query: str) -> list[dict]:
        query = " ".join(query.split())
        if len(query) < 2:
            return []
        key = query.casefold()
        if key in self._cache:
            return self._cache[key]
        async with self._lock:
            wait = 1.0 - (time.monotonic() - self._last)
            if wait > 0:
                await asyncio.sleep(wait)
            try:
                response = await self._http.get(
                    self._url,
                    params={"q": query, "format": "jsonv2", "limit": 6, "addressdetails": 1},
                )
                response.raise_for_status()
            except httpx.HTTPError as exc:
                raise ImmichError("Die Ortssuche ist gerade nicht erreichbar.") from exc
            finally:
                self._last = time.monotonic()
        results = [
            {
                "name": item.get("name") or item["display_name"].split(",")[0],
                "kind": place_kind(item),
                "detail": item["display_name"],
                "lat": float(item["lat"]),
                "lon": float(item["lon"]),
            }
            for item in response.json()
        ]
        self._cache[key] = results
        return results
