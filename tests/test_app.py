import httpx
import respx
from fastapi.testclient import TestClient

from dia_assistent.app import create_app
from dia_assistent.config import Config, parse_env

API = "https://immich.example/api"
ASSET = "11111111-1111-4111-8111-111111111111"


def make_client(**kwargs):
    return TestClient(create_app(Config(immich_url="https://immich.example", api_key="k"), **kwargs))


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


@respx.mock
def test_tag_list_hides_technical_tags():
    respx.get(f"{API}/tags").respond(json=[
        {"id": "1", "name": "Dia-Nachpflege", "value": "Dia-Nachpflege"},
        {"id": "2", "name": "Dia-bearbeitet", "value": "Dia-bearbeitet"},
        {"id": "3", "name": "Datum-ungefähr", "value": "Datum-ungefähr"},
        {"id": "4", "name": "urlaub", "value": "urlaub"},
        {"id": "5", "name": "Italien", "value": "urlaub/Italien"},
        {"id": "6", "name": "Familie", "value": "Familie"},
    ])
    with make_client() as c:
        assert c.get("/api/tags").json() == ["Familie", "urlaub", "urlaub/Italien"]


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


def test_quit_requires_control_header():
    with make_client() as c:
        assert c.post("/api/quit").status_code == 403


def test_settings_report_build():
    from dia_assistent import build_id

    with make_client() as c:
        assert c.get("/api/settings").json()["build"] == build_id()


def test_steps_default_and_saved(tmp_path):
    path = tmp_path / "ablauf.json"
    with make_client(steps_file=path) as c:
        assert c.get("/api/settings").json()["steps"] == ["when", "where", "what", "who", "tags"]
        r = c.put("/api/settings/steps", json={"steps": ["who", "when"]}, headers={"x-dia-assistent": "1"})
        assert r.status_code == 200
        assert c.get("/api/settings").json()["steps"] == ["who", "when"]
    assert '"who"' in path.read_text(encoding="utf-8")


def test_steps_rejects_invalid_and_foreign(tmp_path):
    path = tmp_path / "ablauf.json"
    with make_client(steps_file=path) as c:
        h = {"x-dia-assistent": "1"}
        assert c.put("/api/settings/steps", json={"steps": []}, headers=h).status_code == 400
        assert c.put("/api/settings/steps", json={"steps": ["when", "when"]}, headers=h).status_code == 400
        assert c.put("/api/settings/steps", json={"steps": ["boese"]}, headers=h).status_code == 400
        assert c.put("/api/settings/steps", json={"steps": ["when"]}).status_code == 403
    assert not path.exists()


def test_broken_steps_file_falls_back(tmp_path):
    path = tmp_path / "ablauf.json"
    path.write_text("kaputt", encoding="utf-8")
    with make_client(steps_file=path) as c:
        assert c.get("/api/settings").json()["steps"] == ["when", "where", "what", "who", "tags"]
