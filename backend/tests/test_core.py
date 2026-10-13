"""Kern-Tests: Raum-Parser, Titel-Bereinigung, Sync-Änderungserkennung, ICS-Feed."""
import os
import tempfile
from datetime import datetime, timedelta, timezone

from cryptography.fernet import Fernet

os.environ["STUDO_DB"] = tempfile.mktemp(suffix=".db")
os.environ["STUDO_MASTER_KEY"] = Fernet.generate_key().decode()

from icalendar import Calendar  # noqa: E402

from app import crypto, db, ics_feed, rooms, sync  # noqa: E402
from app.jku.ical_source import SourceEvent, clean_title, parse_ics  # noqa: E402

db.init()


def test_rooms():
    assert rooms.parse_room("HS 1") == ("Hörsaaltrakt", "HS 1")
    assert rooms.parse_room("K 224B") == ("Keplergebäude", "K 224B")
    assert rooms.parse_room("S3 055") == ("Science Park 3", "S3 055")
    assert rooms.parse_room("Online (Zoom)")[0] == "Online"
    assert rooms.parse_room("XYZ irgendwo") == (None, "XYZ irgendwo")
    assert rooms.parse_room(None) == (None, None)


def test_clean_title():
    assert clean_title("336.100 VL Analysis 1") == ("Analysis 1", "VL", "336.100")
    assert clean_title("Analysis 1 / UE / 336.101") == ("Analysis 1", "UE", "336.101")
    assert clean_title("Mathe") == ("Mathe", None, None)


def test_parse_ics():
    raw = b"""BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:abc@kusss
SUMMARY:336.100 VL Analysis 1
DTSTART;TZID=Europe/Vienna:20261014T083000
DTEND;TZID=Europe/Vienna:20261014T100000
LOCATION:HS 1
END:VEVENT
END:VCALENDAR
"""
    [e] = parse_ics(raw)
    assert e.course_id == "336.100" and e.title == "Analysis 1"
    assert e.start == datetime(2026, 10, 14, 6, 30, tzinfo=timezone.utc)  # Sommerzeit -> UTC+2


def _ev(uid, loc="HS 1", days=3):
    s = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=days)
    return SourceEvent(uid, "336.100", "Analysis 1", "VL", s, s + timedelta(hours=1.5), loc, None, False)


def test_sync_and_feed():
    assert sync.apply([_ev("a"), _ev("b", days=4)])["new"] == 2
    # Raumänderung -> SEQUENCE steigt; b fehlt -> entfällt
    st = sync.apply([_ev("a", loc="K 224B")])
    assert st["changed"] == 1 and st["cancelled"] == 1

    with db.tx() as c:
        c.execute("INSERT INTO course_settings VALUES('336.100', 1)")
    cal = Calendar.from_ical(ics_feed.build_feed("prefix"))
    evs = {str(e["UID"]): e for e in cal.walk("VEVENT")}
    assert str(evs["a"]["SUMMARY"]).startswith("! Analysis 1")
    assert int(evs["a"]["SEQUENCE"]) == 1
    assert str(evs["a"]["LOCATION"]) == "Keplergebäude · K 224B"
    assert str(evs["b"]["STATUS"]) == "CANCELLED" and str(evs["b"]["SUMMARY"]).startswith("Entfällt")

    cal = Calendar.from_ical(ics_feed.build_feed("notes"))
    a = next(e for e in cal.walk("VEVENT") if str(e["UID"]) == "a")
    assert str(a["SUMMARY"]) == "Analysis 1 (VL)" and "Anwesenheitspflicht" in str(a["DESCRIPTION"])


def test_crypto():
    assert crypto.decrypt(crypto.encrypt("geheim")) == "geheim"
    h = crypto.hash_password("pw")
    assert crypto.verify_password("pw", h) and not crypto.verify_password("nope", h)
