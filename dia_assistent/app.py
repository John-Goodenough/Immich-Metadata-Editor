"""FastAPI-Backend. Hält den API-Key, der Browser spricht nur mit 127.0.0.1."""

from __future__ import annotations

import asyncio
import logging
import os
import signal
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi import Path as PathParam
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import __version__, build_id
from .config import DEFAULT_STEPS_FILE, Config, ConfigError, load_steps, save_steps
from .geocode import Geocoder
from .immich import ImmichClient, ImmichError, save_answers
from .logic import Answers, InvalidInput

STATIC_DIR = Path(__file__).parent / "static"
UUID = r"^[0-9a-fA-F-]{36}$"
# Eigener Header: Browser schicken ihn von fremden Seiten nicht ohne CORS-Freigabe mit
CONTROL_HEADER = "x-dia-assistent"

log = logging.getLogger("dia_assistent")


class SaveRequest(BaseModel):
    year: int | None = None
    month: int | None = None
    day: int | None = None
    approximate: bool = False
    latitude: float | None = None
    longitude: float | None = None
    description: str | None = Field(default=None, max_length=5000)
    person_ids: list[str] = Field(default_factory=list)
    tag_values: list[str] = Field(default_factory=list, max_length=100)


class StepsRequest(BaseModel):
    steps: list[str] = Field(max_length=10)


def create_app(
    config: Config,
    immich: ImmichClient | None = None,
    geocoder: Geocoder | None = None,
    steps_file: Path = DEFAULT_STEPS_FILE,
) -> FastAPI:
    immich = immich or ImmichClient(config.immich_url, config.api_key)
    geocoder = geocoder or Geocoder(config.nominatim_url, config.nominatim_contact)
    state: dict = {"work_tag_id": None}
    build = build_id()

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        yield
        await immich.aclose()
        await geocoder.aclose()

    app = FastAPI(title="Dia-Assistent", version=__version__, lifespan=lifespan, docs_url=None, redoc_url=None)

    @app.exception_handler(ImmichError)
    async def immich_error(request: Request, exc: ImmichError):
        log.warning("%s %s: %s (%r)", request.method, request.url.path, exc, exc.__cause__)
        return JSONResponse({"fehler": str(exc)}, status_code=502)

    @app.exception_handler(InvalidInput)
    async def invalid_input(_: Request, exc: InvalidInput):
        return JSONResponse({"fehler": str(exc)}, status_code=400)

    @app.exception_handler(Exception)
    async def unexpected(request: Request, exc: Exception):
        log.error("%s %s: unerwarteter Fehler", request.method, request.url.path, exc_info=exc)
        return JSONResponse({"fehler": "Da ist etwas schiefgegangen. Bitte noch einmal versuchen."}, status_code=500)

    async def work_tag_id() -> str:
        if not state["work_tag_id"]:
            tag_id = await immich.find_tag_id(config.tag_name)
            if not tag_id:
                raise ImmichError(f"Die Markierung „{config.tag_name}“ gibt es in Immich nicht.")
            state["work_tag_id"] = tag_id
        return state["work_tag_id"]

    @app.get("/")
    async def index():
        return FileResponse(STATIC_DIR / "index.html", headers={"Cache-Control": "no-store"})

    @app.get("/api/settings")
    async def settings():
        return {
            "yearFrom": config.year_from,
            "yearTo": config.year_to,
            "steps": load_steps(steps_file),
            "version": __version__,
            "build": build,
        }

    @app.put("/api/settings/steps")
    async def put_steps(body: StepsRequest, request: Request):
        # Eigener Header erzwingt CORS-Preflight: fremde Webseiten können den Ablauf nicht ändern
        if request.headers.get(CONTROL_HEADER) != "1":
            return JSONResponse({"fehler": "Nicht erlaubt."}, status_code=403)
        try:
            save_steps(steps_file, body.steps)
        except ConfigError as exc:
            return JSONResponse({"fehler": str(exc)}, status_code=400)
        log.info("Ablauf geändert: %s", ", ".join(body.steps))
        return {"steps": body.steps}

    @app.post("/api/quit")
    async def quit_server(request: Request):
        """Vom Starter benutzt, um einen veralteten Server zu beenden."""
        if request.headers.get(CONTROL_HEADER) != "1":
            return JSONResponse({"fehler": "Nicht erlaubt."}, status_code=403)
        log.info("Beenden angefordert")
        asyncio.get_running_loop().call_later(0.2, os.kill, os.getpid(), signal.SIGTERM)
        return {"ok": True}

    hidden_tags = {config.tag_name, config.approx_tag_name, config.done_tag_name}

    def visible(tag: dict) -> bool:
        return tag["value"] not in hidden_tags and tag["name"] not in hidden_tags

    @app.get("/api/tags")
    async def tags():
        return sorted((t["value"] for t in await immich.tags() if visible(t)), key=str.casefold)

    @app.get("/api/queue")
    async def queue():
        return {"ids": await immich.asset_ids_with_tag(await work_tag_id())}

    @app.get("/api/assets/{asset_id}")
    async def asset(asset_id: str = PathParam(pattern=UUID)):
        data = await immich.get_asset(asset_id)
        exif = data.get("exifInfo") or {}
        return {
            "id": data["id"],
            "description": exif.get("description") or "",
            "city": exif.get("city"),
            "country": exif.get("country"),
            "personIds": [p["id"] for p in data.get("people") or []],
            "tagValues": [t["value"] for t in data.get("tags") or [] if visible(t)],
        }

    @app.get("/api/assets/{asset_id}/preview")
    async def preview(asset_id: str = PathParam(pattern=UUID)):
        upstream = await immich.preview(asset_id)
        return Response(
            upstream.content,
            media_type=upstream.headers.get("content-type", "image/jpeg"),
            headers={"Cache-Control": "private, max-age=3600"},
        )

    @app.get("/api/people")
    async def people():
        return [{"id": p["id"], "name": p["name"]} for p in await immich.people()]

    @app.get("/api/people/{person_id}/thumbnail")
    async def person_thumbnail(person_id: str = PathParam(pattern=UUID)):
        upstream = await immich.person_thumbnail(person_id)
        return Response(
            upstream.content,
            media_type=upstream.headers.get("content-type", "image/jpeg"),
            headers={"Cache-Control": "private, max-age=86400"},
        )

    @app.get("/api/places")
    async def places(q: str = ""):
        return await geocoder.search(q[:200])

    @app.post("/api/assets/{asset_id}/save")
    async def save(body: SaveRequest, asset_id: str = PathParam(pattern=UUID)):
        await save_answers(
            immich,
            asset_id,
            Answers(**body.model_dump()),
            work_tag_id=await work_tag_id(),
            approx_tag_name=config.approx_tag_name,
            done_tag_name=config.done_tag_name,
            tz=config.timezone,
        )
        return {"ok": True}

    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
    return app
