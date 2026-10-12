import httpx
import respx
from fastapi.testclient import TestClient

from dia_assistent.app import create_app
from dia_assistent.config import Config, parse_env

API = "https://immich.example/api"
ASSET = "11111111-1111-4111-8111-111111111111"


def make_client():
    return TestClient(create_app(Config(immich_url="https://immich.example", api_key="k")))


def test_parse_env():
    assert parse_env('# Kommentar\nA=1\nB = "zwei drei"\n\nkaputt\n') == {"A": "1", "B": "zwei drei"}


def test_index_served():
    with make_client() as c:
        assert "Dia-Assistent" in c.get("/").text


@respx.mock
def test_queue_without_tag_gives_german_error():
    respx.get(f"{API}/tags").respond(json=[])
    with make_client() as c:
        r = c.get("/api/queue")
    assert r.status_code == 502
    assert "Dia-Nachpflege" in r.json()["fehler"]


@respx.mock
def test_offline_gives_german_error():
    respx.get(f"{API}/tags").mock(side_effect=httpx.ConnectError("weg"))
    with make_client() as c:
        r = c.get("/api/queue")
    assert r.json() == {"fehler": "Keine Verbindung zum Server. Ist das Internet da?"}


def test_invalid_date_gives_400():
    with make_client() as c:
        with respx.mock:
            respx.get(f"{API}/tags").respond(json=[{"id": "t", "name": "Dia-Nachpflege", "value": "Dia-Nachpflege"}])
            respx.get(f"{API}/assets/{ASSET}").respond(json={"id": ASSET, "exifInfo": {}})
            r = c.post(f"/api/assets/{ASSET}/save", json={"year": 1970, "month": 2, "day": 31})
    assert r.status_code == 400
    assert "Tag" in r.json()["fehler"]


def test_rejects_bad_ids():
    with make_client() as c:
        assert c.get("/api/assets/..%2Fadmin").status_code in (404, 422)


@respx.mock
async def test_geocoder_maps_results_and_sends_user_agent():
    from dia_assistent.geocode import Geocoder

    route = respx.get("https://nominatim.example/search").respond(json=[
        {"name": "Rüdesheim am Rhein", "display_name": "Rüdesheim am Rhein, Hessen, Deutschland",
         "lat": "49.978", "lon": "7.923"},
    ])
    geo = Geocoder("https://nominatim.example/search", contact="test@example.org")
    result = await geo.search("  Rüdesheim  ")
    assert result == [{"name": "Rüdesheim am Rhein", "detail": "Rüdesheim am Rhein, Hessen, Deutschland",
                       "lat": 49.978, "lon": 7.923}]
    request = route.calls.last.request
    assert "test@example.org" in request.headers["user-agent"]
    assert request.url.params["q"] == "Rüdesheim"
    await geo.search("rüdesheim")  # aus dem Zwischenspeicher
    assert route.call_count == 1
    await geo.aclose()


async def test_geocoder_rate_limit():
    import time

    from dia_assistent.geocode import Geocoder

    with respx.mock:
        respx.get("https://nominatim.example/search").respond(json=[])
        geo = Geocoder("https://nominatim.example/search")
        start = time.monotonic()
        await geo.search("Ort eins")
        await geo.search("Ort zwei")
        assert time.monotonic() - start >= 1.0
        await geo.aclose()
