import pytest

from dia_assistent.logic import (
    Answers,
    InvalidInput,
    build_asset_update,
    build_date,
    face_boxes,
    full_image_face,
    merge_description,
    normalize_person_name,
    normalize_tag_value,
    tags_to_assign,
)

TZ = "Europe/Berlin"


def test_only_year_is_first_of_july():
    assert build_date(1965, None, None, TZ) == "1965-07-01T12:00:00.000+01:00"


def test_year_and_month_is_fifteenth():
    assert build_date(1972, 3, None, TZ) == "1972-03-15T12:00:00.000+01:00"


def test_full_date_summer_time():
    # Sommerzeit gab es in der BRD 1980–heute
    assert build_date(1985, 8, 3, TZ) == "1985-08-03T12:00:00.000+02:00"


def test_no_date():
    assert build_date(None, None, None, TZ) is None


@pytest.mark.parametrize(
    "year,month,day",
    [(None, 5, None), (1970, None, 3), (1970, 13, None), (1970, 2, 30), (1700, None, None)],
)
def test_invalid_dates(year, month, day):
    with pytest.raises(InvalidInput):
        build_date(year, month, day, TZ)


def test_leap_day():
    assert build_date(1968, 2, 29, TZ).startswith("1968-02-29")


def test_merge_description_appends():
    assert merge_description("Alt", "Neu") == "Alt\n\nNeu"
    assert merge_description(None, " Neu ") == "Neu"
    assert merge_description("", "Neu") == "Neu"


def test_merge_description_nothing_new():
    assert merge_description("Alt", "") is None
    assert merge_description("Alt", None) is None
    assert merge_description("Alt", "   ") is None


def test_merge_description_retry_does_not_duplicate():
    assert merge_description("Alt\n\nNeu", "Neu") is None


def test_asset_update_only_filled_fields():
    assert build_asset_update(Answers(), "x", TZ) == {}
    body = build_asset_update(Answers(year=1960, latitude=50.0, longitude=8.0, description="Urlaub"), None, TZ)
    assert body == {
        "dateTimeOriginal": "1960-07-01T12:00:00.000+01:00",
        "latitude": 50.0,
        "longitude": 8.0,
        "description": "Urlaub",
    }


def test_asset_update_rejects_half_coordinates():
    with pytest.raises(InvalidInput):
        build_asset_update(Answers(latitude=50.0), None, TZ)


def test_full_image_face():
    assert full_image_face("a", "p", 3000, 2000) == {
        "assetId": "a",
        "personId": "p",
        "imageWidth": 3000,
        "imageHeight": 2000,
        "x": 0,
        "y": 0,
        "width": 3000,
        "height": 2000,
    }


def test_normalize_tag_value():
    assert normalize_tag_value(" Urlaub / Italien ") == "Urlaub/Italien"
    for bad in ("", "  ", "Urlaub//Italien", "/Urlaub", "Urlaub/"):
        with pytest.raises(InvalidInput):
            normalize_tag_value(bad)


def test_tags_to_assign():
    a = Answers(approximate=True, tag_values=["Familie", "Familie "])
    assert tags_to_assign(a, "Dia-bearbeitet", "Datum-ungefähr", date_written=True) == [
        "Familie", "Datum-ungefähr", "Dia-bearbeitet"]
    assert tags_to_assign(a, "Dia-bearbeitet", "Datum-ungefähr", date_written=False) == [
        "Familie", "Dia-bearbeitet"]


def test_face_boxes_relative_sorted_and_filtered():
    def face(fid, x1, sourceType="machine-learning", person=None):
        return {"id": fid, "imageWidth": 1000, "imageHeight": 500, "boundingBoxX1": x1, "boundingBoxX2": x1 + 100,
                "boundingBoxY1": 50, "boundingBoxY2": 150, "sourceType": sourceType, "person": person}

    boxes = face_boxes([
        face("rechts", 800, person={"id": "p1", "name": "", "isHidden": False}),
        face("links", 100, person={"id": "p2", "name": "Oma", "isHidden": False}),
        face("ganzes-bild", 0, sourceType="manual"),
        face("versteckt", 400, person={"id": "p3", "name": "X", "isHidden": True}),
    ])
    assert [b["id"] for b in boxes] == ["links", "rechts"]
    assert boxes[0] == {"id": "links", "x": 0.1, "y": 0.1, "w": 0.1, "h": 0.2, "aspect": 2.0,
                        "personId": "p2", "personName": "Oma"}
    assert boxes[1]["personName"] is None


def test_normalize_person_name():
    assert normalize_person_name("  Tante \n Erna ") == "Tante Erna"
    with pytest.raises(InvalidInput):
        normalize_person_name("   ")
    with pytest.raises(InvalidInput):
        normalize_person_name("x" * 101)
