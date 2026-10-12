import pytest

from dia_assistent.logic import (
    Answers,
    InvalidInput,
    build_asset_update,
    build_date,
    full_image_face,
    merge_description,
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
