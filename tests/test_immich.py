"""Mapping auf Immich-Aufrufe, Immich wird mit respx gemockt."""

import json

import httpx
import pytest
import respx

from dia_assistent.immich import ImmichClient, ImmichError, save_answers
from dia_assistent.logic import Answers

BASE = "https://immich.example"
API = f"{BASE}/api"
ASSET = "11111111-1111-4111-8111-111111111111"
WORK_TAG = "22222222-2222-4222-8222-222222222222"
APPROX_TAG = "33333333-3333-4333-8333-333333333333"
PERSON_A = "44444444-4444-4444-8444-444444444444"
PERSON_B = "55555555-5555-4555-8555-555555555555"


@pytest.fixture
def mock():
    with respx.mock(base_url=API, assert_all_called=False) as router:
        yield router


@pytest.fixture
async def client():
    c = ImmichClient(BASE, "geheim")
    yield c
    await c.aclose()


def asset(description=None, width=4000, height=2667):
    return {"id": ASSET, "width": width, "height": height, "exifInfo": {"description": description}}


def body(call):
    return json.loads(call.request.content)


async def test_api_key_header_and_tag_lookup(mock, client):
    route = mock.get("/tags").respond(json=[
        {"id": "x", "name": "Dia-Nachpflege", "value": "Eltern/Dia-Nachpflege"},
        {"id": WORK_TAG, "name": "Dia-Nachpflege", "value": "Dia-Nachpflege"},
    ])
    assert await client.find_tag_id("Dia-Nachpflege") == WORK_TAG
    assert route.calls.last.request.headers["x-api-key"] == "geheim"


async def test_tag_lookup_missing(mock, client):
    mock.get("/tags").respond(json=[])
    assert await client.find_tag_id("Dia-Nachpflege") is None


async def test_search_follows_cursor(mock, client):
    route = mock.post("/search/metadata").mock(side_effect=[
        httpx.Response(200, json={"assets": {"items": [{"id": "a"}, {"id": "b"}], "nextCursor": "c2"}}),
        httpx.Response(200, json={"assets": {"items": [{"id": "c"}], "nextCursor": None}}),
    ])
    assert await client.asset_ids_with_tag(WORK_TAG) == ["a", "b", "c"]
    first, second = body(route.calls[0]), body(route.calls[1])
    assert first["filter"] == {"tagIds": {"any": [WORK_TAG]}}
    assert "cursor" not in first
    assert second["cursor"] == "c2"


async def test_people_only_named_and_visible(mock, client):
    mock.get("/people").respond(json={"people": [
        {"id": "1", "name": "Oma", "isHidden": False},
        {"id": "2", "name": "", "isHidden": False},
        {"id": "3", "name": "Versteckt", "isHidden": True},
        {"id": "4", "name": "anton", "isHidden": False},
    ], "hasNextPage": False, "total": 4, "hidden": 1})
    assert [p["name"] for p in await client.people()] == ["anton", "Oma"]


async def test_save_everything(mock, client):
    mock.get(f"/assets/{ASSET}").respond(json=asset(description="Kiste 3"))
    put = mock.put(f"/assets/{ASSET}").respond(json={})
    upsert = mock.put("/tags").respond(json=[{"id": APPROX_TAG}])
    tag = mock.put(f"/tags/{APPROX_TAG}/assets").respond(json=[{"id": ASSET, "success": True}])
    mock.get("/faces", params={"id": ASSET}).respond(json=[{"person": {"id": PERSON_A}}, {"person": None}])
    faces = mock.post("/faces").respond(201)
    untag = mock.delete(f"/tags/{WORK_TAG}/assets").respond(json=[{"id": ASSET, "success": True}])

    answers = Answers(year=1965, month=8, approximate=True, latitude=49.98, longitude=7.92,
                      description="Weinlese", person_ids=[PERSON_A, PERSON_B, PERSON_B])
    await save_answers(client, ASSET, answers, work_tag_id=WORK_TAG, approx_tag_name="Datum-ungefähr",
                       tz="Europe/Berlin")

    assert body(put.calls.last) == {
        "dateTimeOriginal": "1965-08-15T12:00:00.000+01:00",
        "latitude": 49.98,
        "longitude": 7.92,
        "description": "Kiste 3\n\nWeinlese",
    }
    assert body(upsert.calls.last) == {"tags": ["Datum-ungefähr"]}
    assert body(tag.calls.last) == {"ids": [ASSET]}
    # Person A ist schon drauf, B nur einmal
    assert faces.call_count == 1
    assert body(faces.calls.last) == {"assetId": ASSET, "personId": PERSON_B, "imageWidth": 4000,
                                      "imageHeight": 2667, "x": 0, "y": 0, "width": 4000, "height": 2667}
    assert body(untag.calls.last) == {"ids": [ASSET]}


async def test_save_nothing_only_removes_tag(mock, client):
    mock.get(f"/assets/{ASSET}").respond(json=asset())
    put = mock.put(f"/assets/{ASSET}")
    upsert = mock.put("/tags")
    faces = mock.post("/faces")
    untag = mock.delete(f"/tags/{WORK_TAG}/assets").respond(json=[{"id": ASSET, "success": True}])
    await save_answers(client, ASSET, Answers(approximate=True), work_tag_id=WORK_TAG,
                       approx_tag_name="Datum-ungefähr", tz="Europe/Berlin")
    assert not put.called and not upsert.called and not faces.called
    assert untag.called


async def test_failure_keeps_work_tag(mock, client):
    mock.get(f"/assets/{ASSET}").respond(json=asset())
    mock.put(f"/assets/{ASSET}").mock(side_effect=httpx.ConnectError("weg"))
    untag = mock.delete(f"/tags/{WORK_TAG}/assets")
    with pytest.raises(ImmichError, match="Keine Verbindung"):
        await save_answers(client, ASSET, Answers(year=1970), work_tag_id=WORK_TAG,
                           approx_tag_name="x", tz="Europe/Berlin")
    assert not untag.called


async def test_retry_after_partial_save_is_idempotent(mock, client):
    mock.get(f"/assets/{ASSET}").respond(json=asset(description="Weinlese"))
    put = mock.put(f"/assets/{ASSET}").respond(json={})
    mock.delete(f"/tags/{WORK_TAG}/assets").respond(json=[{"id": ASSET, "success": False, "error": "not_found"}])
    await save_answers(client, ASSET, Answers(description="Weinlese"), work_tag_id=WORK_TAG,
                       approx_tag_name="x", tz="Europe/Berlin")
    assert not put.called


@pytest.mark.parametrize("status,text", [(401, "Zugangsschlüssel"), (403, "Berechtigung"), (500, "Problem")])
async def test_german_error_messages(mock, client, status, text):
    mock.get("/tags").respond(status)
    with pytest.raises(ImmichError, match=text):
        await client.find_tag_id("x")


async def test_untag_permission_error(mock, client):
    mock.delete(f"/tags/{WORK_TAG}/assets").respond(json=[{"id": ASSET, "success": False, "error": "no_permission"}])
    with pytest.raises(ImmichError):
        await client.untag_asset(WORK_TAG, ASSET)
