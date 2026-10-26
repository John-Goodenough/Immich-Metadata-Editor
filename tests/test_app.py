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
def test_asset_includes_faces():
    respx.get(f"{API}/assets/{ASSET}").respond(json={"id": ASSET, "exifInfo": {}, "people": [], "tags": []})
    respx.get(f"{API}/faces", params={"id": ASSET}).respond(json=[{
        "id": "f1", "imageWidth": 200, "imageHeight": 100, "boundingBoxX1": 20, "boundingBoxX2": 60,
        "boundingBoxY1": 10, "boundingBoxY2": 50, "sourceType": "machine-learning", "person": None,
    }])
    with make_client() as c:
        faces = c.get(f"/api/assets/{ASSET}").json()["faces"]
    assert faces == [{"id": "f1", "x": 0.1, "y": 0.1, "w": 0.2, "h": 0.4, "aspect": 2.0,
                      "personId": None, "personName": None}]


def test_save_rejects_bad_face_id():
    with make_client() as c:
        r = c.post(f"/api/assets/{ASSET}/save", json={"faces": [{"face_id": "../x", "new_name": "Erna"}]})
    assert r.status_code in (400, 422)


@respx.mock
def test_tag_list_hides_technical_tags():
    respx.get(f"{API}/tags").respond(json=[
        {"id": "1", "name": "Dia-Nachpflege", "value": "Dia-Nachpflege"},
        {"id": "2", "name": "Dia-bearbeitet", "value": "Dia-bearbeitet"},
        {"id": "3", "name": "Datum-ungefähr", "value": "Datum-ungefähr"},
        {"id": "4", "name": "urlaub", "value": "urlaub"},
        {"id": "5", "name": "Italien", "value": "urlaub/Italien"},
        {"id": "6", "name": "Familie", "value": "Familie"},
        {"id": "7", "name": "Europa", "value": "Europa"},
        {"id": "8", "name": "Deutschland", "value": "Europa/Deutschland"},
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
         "lat": "49.978", "lon": "7.923", "addresstype": "town", "type": "administrative",
         "address": {"town": "Rüdesheim am Rhein", "country": "Deutschland", "country_code": "de"}},
    ])
    geo = Geocoder("https://nominatim.example/search", contact="test@example.org")
    result = await geo.search("  Rüdesheim  ")
    assert result == [{"name": "Rüdesheim am Rhein", "kind": "Stadt", "tag": "Europa/Deutschland/Rüdesheim am Rhein",
                       "detail": "Rüdesheim am Rhein, Hessen, Deutschland",
                       "lat": 49.978, "lon": 7.923}]
    request = route.calls.last.request
    assert "test@example.org" in request.headers["user-agent"]
    assert request.url.params["q"] == "Rüdesheim"
    await geo.search("rüdesheim")  # aus dem Zwischenspeicher
    assert route.call_count == 1
    await geo.aclose()


def test_place_kind():
    from dia_assistent.geocode import place_kind

    assert place_kind({"addresstype": "county", "type": "administrative"}) == "Kreis"
    assert place_kind({"addresstype": "city", "type": "administrative"}) == "Stadt"
    assert place_kind({"type": "lake"}) == "See"  # ohne addresstype: type
    assert place_kind({"addresstype": "unbekannt", "type": "administrative"}) is None


def test_place_tag():
    from dia_assistent.geocode import CONTINENTS, place_tag

    de = {"country": "Deutschland", "country_code": "de"}
    assert place_tag({"addresstype": "county", "address": de}, "Landkreis Kassel") == "Europa/Deutschland/Kassel"
    assert place_tag({"addresstype": "state_district", "address": de}, "Regierungsbezirk Kassel") == "Europa/Deutschland/Kassel"
    assert place_tag({"addresstype": "city", "address": de}, "Kassel") == "Europa/Deutschland/Kassel"
    assert place_tag({"addresstype": "county", "address": de}, "Rhein-Sieg-Kreis") == "Europa/Deutschland/Rhein-Sieg-Kreis"
    assert place_tag({"addresstype": "town", "address": de}, "Stadtallendorf") == "Europa/Deutschland/Stadtallendorf"
    assert place_tag({"addresstype": "country", "address": de}, "Deutschland") == "Europa/Deutschland"
    assert place_tag({"addresstype": "continent"}, "Europa") == "Europa"
    assert place_tag({"addresstype": "city", "address": {"country": "USA", "country_code": "us"}},
                     "New York") == "Nordamerika/USA/New York"
    assert place_tag({"addresstype": "town", "address": de}, "Halle/Saale") == "Europa/Deutschland/Halle-Saale"
    assert place_tag({"type": "bay", "address": {}}, "Golf von Biskaya") is None  # kein Land
    assert CONTINENTS["CY"] == "Europa" and CONTINENTS["TR"] == "Asien"


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
