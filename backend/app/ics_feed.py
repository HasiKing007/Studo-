"""Erzeugt den abonnierbaren iCalendar-Feed für Apple Kalender.

Worauf es ankommt, damit Abos zuverlässig aktualisieren:
- Stabile UIDs: dieselbe UID wie in der Quelle -> Apple ersetzt statt dupliziert.
- SEQUENCE + LAST-MODIFIED steigen bei jeder Änderung.
- STATUS:CANCELLED für Ausfälle (Apple zeigt sie durchgestrichen bzw. blendet sie aus),
  zusätzlich "Entfällt" im Titel, weil nicht jede Ansicht den Status zeigt.
- REFRESH-INTERVAL / X-PUBLISHED-TTL als Hinweis. Das tatsächliche Intervall stellt man
  auf dem iPhone ein (Einstellungen > Kalender > Accounts > Abrufen); iOS fragt
  Abos frühestens etwa alle 15 Minuten ab.
- Zeiten in UTC (…Z): kein VTIMEZONE nötig, keine Sommerzeit-Fehler.
"""
from datetime import datetime, timedelta, timezone

from icalendar import Calendar, Event

from . import db, rooms

MARKERS = {
    "prefix": "! ",     # "! Analysis 1"
    "emoji": "🔴 ",     # "🔴 Analysis 1"
    "notes": "",        # Titel unverändert, nur Hinweis in den Notizen
}


def build_feed(marker_style: str = "prefix", past_days: int = 30) -> bytes:
    since = (datetime.now(timezone.utc) - timedelta(days=past_days)).isoformat()
    with db.tx() as c:
        rows = c.execute(db.EFFECTIVE_ATTENDANCE_SQL + " WHERE e.start >= ? ORDER BY e.start",
                         (since,)).fetchall()

    cal = Calendar()
    cal.add("prodid", "-//Studo+//JKU Stundenplan//DE")
    cal.add("version", "2.0")
    cal.add("calscale", "GREGORIAN")
    cal.add("method", "PUBLISH")
    cal.add("x-wr-calname", "JKU Stundenplan")
    cal.add("x-wr-timezone", "Europe/Vienna")
    cal.add("x-published-ttl", "PT30M")
    cal.add("refresh-interval", timedelta(minutes=30), parameters={"VALUE": "DURATION"})

    marker = MARKERS.get(marker_style, MARKERS["prefix"])
    for r in rows:
        mandatory = bool(r["attendance"])
        cancelled = r["status"] == "cancelled"

        title = r["title"] + (f" ({r['kind']})" if r["kind"] else "")
        if mandatory:
            title = marker + title
        if cancelled:
            title = "Entfällt: " + title

        notes = []
        if mandatory:
            notes.append("Anwesenheitspflicht")
        if r["room_raw"] and r["room_raw"] != r["room"]:
            notes.append(f"Ort laut KUSSS: {r['room_raw']}")
        if r["description"]:
            notes.append(r["description"])

        ev = Event()
        ev.add("uid", r["uid"])
        ev.add("summary", title)
        ev.add("dtstart", datetime.fromisoformat(r["start"]))
        ev.add("dtend", datetime.fromisoformat(r["end"]))
        ev.add("dtstamp", datetime.now(timezone.utc))
        ev.add("last-modified", datetime.fromisoformat(r["updated_at"]))
        ev.add("sequence", r["sequence"])
        ev.add("status", "CANCELLED" if cancelled else "CONFIRMED")
        loc = rooms.format_room(r["building"], r["room"])
        if loc:
            ev.add("location", loc)
        if notes:
            ev.add("description", "\n".join(notes))
        if mandatory:
            ev.add("categories", ["Anwesenheitspflicht"])
            ev.add("priority", 1)
        cal.add_component(ev)

    return cal.to_ical()
