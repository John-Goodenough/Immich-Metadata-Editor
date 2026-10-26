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


# Kontinent je Ländercode (ISO 3166-1). Grundlage ist die UN-Einteilung (M49), Mittelamerika und
# Karibik zählen zu Nordamerika. Abweichend davon: Zypern zu Europa. Russland zählt ganz zu Europa,
# die Türkei und die Kaukasusstaaten zu Asien.
_CONTINENT_CODES = {
    "Europa": "AD AL AT AX BA BE BG BY CH CY CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE IM IS IT JE LI LT "
              "LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SJ SK SM UA VA XK",
    "Asien": "AE AF AM AZ BD BH BN BT CN GE HK ID IL IN IO IQ IR JO JP KG KH KP KR KW KZ LA LB LK MM MN MO "
             "MV MY NP OM PH PK PS QA SA SG SY TH TJ TL TM TR TW UZ VN YE",
    "Afrika": "AO BF BI BJ BW CD CF CG CI CM CV DJ DZ EG EH ER ET GA GH GM GN GQ GW KE KM LR LS LY MA MG ML "
              "MR MU MW MZ NA NE NG RE RW SC SD SH SL SN SO SS ST SZ TD TG TN TZ UG YT ZA ZM ZW",
    "Nordamerika": "AG AI AW BB BL BM BQ BS BZ CA CR CU CW DM DO GD GL GP GT HN HT JM KN KY LC MF MQ MS MX NI "
                   "PA PM PR SV SX TC TT US VC VG VI",
    "Südamerika": "AR BO BR CL CO EC FK GF GY PE PY SR UY VE",
    "Ozeanien": "AS AU CK FJ FM GU KI MH MP NC NF NR NU NZ PF PG PN PW SB TK TO TV UM VU WF",
    "Antarktis": "AQ BV GS HM TF",
}
CONTINENTS = {code: name for name, codes in _CONTINENT_CODES.items() for code in codes.split()}
CONTINENT_NAMES = frozenset(_CONTINENT_CODES)


def place_kind(item: dict) -> str | None:
    for key in ("addresstype", "type"):
        kind = KINDS.get(item.get(key) or "")
        if kind:
            return kind
    return None


def place_tag(item: dict, name: str) -> str | None:
    """Tag-Pfad Kontinent/Land/Ort, z. B. "Europa/Deutschland/Kassel". Ein Land ergibt nur
    Kontinent/Land. Ohne Land (z. B. auf dem Meer) gibt es keinen Tag."""
    def clean(part: str) -> str:
        return " ".join(part.replace("/", "-").split())

    if item.get("addresstype") == "continent" and clean(name) in CONTINENT_NAMES:
        return clean(name)
    address = item.get("address") or {}
    continent = CONTINENTS.get((address.get("country_code") or "").upper())
    country = clean(address.get("country") or "")
    if not continent or not country:
        return None
    parts = [continent, country]
    if item.get("addresstype") != "country" and clean(name) and clean(name) != country:
        parts.append(clean(name))
    return "/".join(parts)


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
        results = []
        for item in response.json():
            name = item.get("name") or item["display_name"].split(",")[0]
            results.append({
                "name": name,
                "kind": place_kind(item),
                "tag": place_tag(item, name),
                "detail": item["display_name"],
                "lat": float(item["lat"]),
                "lon": float(item["lon"]),
            })
        self._cache[key] = results
        return results
