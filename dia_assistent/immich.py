"""Schlanker Immich-API-Client (geprüft gegen die OpenAPI-Spezifikation v3.3.1)."""

from __future__ import annotations

import httpx

from .logic import Answers, InvalidInput, build_asset_update, full_image_face


class ImmichError(Exception):
    """Fehler beim Gespräch mit Immich. Meldung ist deutsch und für Laien gedacht."""


def _german_message(exc: Exception) -> str:
    if isinstance(exc, httpx.TimeoutException):
        return "Der Server antwortet nicht. Bitte gleich noch einmal versuchen."
    if isinstance(exc, httpx.TransportError):
        return "Keine Verbindung zum Server. Ist das Internet da?"
    if isinstance(exc, httpx.HTTPStatusError):
        code = exc.response.status_code
        if code == 401:
            return "Der Zugangsschlüssel stimmt nicht. Bitte Bescheid geben."
        if code == 403:
            return "Für diese Aktion fehlt die Berechtigung. Bitte Bescheid geben."
        if code == 404:
            return "Das Bild wurde auf dem Server nicht gefunden."
        if code >= 500:
            return "Der Server hat gerade ein Problem. Bitte später noch einmal versuchen."
        return "Der Server hat die Änderung nicht angenommen."
    return "Unbekannter Fehler beim Server."


class ImmichClient:
    def __init__(self, base_url: str, api_key: str, transport: httpx.AsyncBaseTransport | None = None):
        self._http = httpx.AsyncClient(
            base_url=f"{base_url}/api",
            headers={"x-api-key": api_key, "Accept": "application/json"},
            timeout=httpx.Timeout(20.0, connect=10.0),
            transport=transport,
            follow_redirects=False,
        )

    async def aclose(self) -> None:
        await self._http.aclose()

    async def _request(self, method: str, url: str, **kwargs) -> httpx.Response:
        try:
            response = await self._http.request(method, url, **kwargs)
            response.raise_for_status()
            return response
        except httpx.HTTPError as exc:
            raise ImmichError(_german_message(exc)) from exc

    # --- Lesen -----------------------------------------------------------

    async def find_tag_id(self, name: str) -> str | None:
        """GET /tags. Treffer über vollen Pfad (value) oder Namen."""
        tags = (await self._request("GET", "/tags")).json()
        for tag in tags:
            if tag.get("value") == name:
                return tag["id"]
        for tag in tags:
            if tag.get("name") == name:
                return tag["id"]
        return None

    async def asset_ids_with_tag(self, tag_id: str) -> list[str]:
        """POST /search/metadata mit filter.tagIds, cursorbasiert geblättert."""
        ids: list[str] = []
        cursor: str | None = None
        while True:
            body: dict = {
                "filter": {"tagIds": {"any": [tag_id]}},
                "orderBy": {"field": "fileCreatedAt", "direction": "asc"},
                "size": 1000,
            }
            if cursor:
                body["cursor"] = cursor
            data = (await self._request("POST", "/search/metadata", json=body)).json()
            ids.extend(item["id"] for item in data["assets"]["items"])
            cursor = data["assets"].get("nextCursor")
            if not cursor:
                return ids

    async def get_asset(self, asset_id: str) -> dict:
        return (await self._request("GET", f"/assets/{asset_id}")).json()

    async def preview(self, asset_id: str) -> httpx.Response:
        return await self._request("GET", f"/assets/{asset_id}/thumbnail", params={"size": "preview"})

    async def people(self) -> list[dict]:
        """GET /people, nur benannte und nicht versteckte Personen."""
        result: list[dict] = []
        page = 1
        while True:
            data = (await self._request("GET", "/people", params={"page": page, "size": 1000})).json()
            result.extend(p for p in data["people"] if p.get("name") and not p.get("isHidden"))
            if not data.get("hasNextPage"):
                break
            page += 1
        return sorted(result, key=lambda p: p["name"].casefold())

    async def person_thumbnail(self, person_id: str) -> httpx.Response:
        return await self._request("GET", f"/people/{person_id}/thumbnail")

    async def face_person_ids(self, asset_id: str) -> set[str]:
        faces = (await self._request("GET", "/faces", params={"id": asset_id})).json()
        return {f["person"]["id"] for f in faces if f.get("person")}

    # --- Schreiben -------------------------------------------------------

    async def update_asset(self, asset_id: str, body: dict) -> None:
        await self._request("PUT", f"/assets/{asset_id}", json=body)

    async def ensure_tag(self, name: str) -> str:
        """PUT /tags (Upsert): legt den Tag an, falls er fehlt."""
        tags = (await self._request("PUT", "/tags", json={"tags": [name]})).json()
        return tags[0]["id"]

    async def tag_asset(self, tag_id: str, asset_id: str) -> None:
        await self._bulk("PUT", tag_id, asset_id)

    async def untag_asset(self, tag_id: str, asset_id: str) -> None:
        await self._bulk("DELETE", tag_id, asset_id)

    async def _bulk(self, method: str, tag_id: str, asset_id: str) -> None:
        results = (await self._request(method, f"/tags/{tag_id}/assets", json={"ids": [asset_id]})).json()
        for item in results:
            # "duplicate" (schon getaggt) und "not_found" (schon entfernt) sind kein Fehler
            if not item.get("success") and item.get("error") not in ("duplicate", "not_found"):
                raise ImmichError("Die Markierung konnte nicht geändert werden.")

    async def add_face(self, body: dict) -> None:
        await self._request("POST", "/faces", json=body)


async def save_answers(
    client: ImmichClient,
    asset_id: str,
    answers: Answers,
    *,
    work_tag_id: str,
    approx_tag_name: str,
    tz: str,
) -> None:
    """Alles speichern und zuletzt den Arbeits-Tag entfernen.

    Jeder Schritt ist wiederholbar: Bricht die Verbindung mittendrin ab, kann
    das Speichern einfach erneut ausgelöst werden, ohne Doppelungen zu erzeugen.
    Der Arbeits-Tag wird nur entfernt, wenn alles vorher geklappt hat.
    """
    asset = await client.get_asset(asset_id)
    exif = asset.get("exifInfo") or {}

    body = build_asset_update(answers, exif.get("description"), tz)
    if body:
        await client.update_asset(asset_id, body)

    if answers.approximate and "dateTimeOriginal" in body:
        approx_id = await client.ensure_tag(approx_tag_name)
        await client.tag_asset(approx_id, asset_id)

    if answers.person_ids:
        width = asset.get("width") or exif.get("exifImageWidth")
        height = asset.get("height") or exif.get("exifImageHeight")
        if not width or not height:
            raise InvalidInput("Die Bildgröße ist unbekannt, Personen können nicht zugeordnet werden.")
        present = await client.face_person_ids(asset_id)
        for person_id in dict.fromkeys(answers.person_ids):
            if person_id not in present:
                await client.add_face(full_image_face(asset_id, person_id, int(width), int(height)))

    await client.untag_asset(work_tag_id, asset_id)
