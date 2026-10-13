"""Beispieltermine für den Demo-Modus (STUDO_DEMO=1), damit die App ohne JKU-Zugang läuft."""
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from .jku.ical_source import SourceEvent

VIENNA = ZoneInfo("Europe/Vienna")

# (Wochentag 0=Mo, Start, Ende, LVA-Nr, Typ, Titel, Ort)
WEEK = [
    (0, "08:30", "10:00", "336.100", "VL", "Analysis 1", "HS 1"),
    (0, "10:15", "11:45", "336.101", "UE", "Analysis 1", "S3 055"),
    (1, "12:00", "13:30", "351.001", "VL", "Softwareentwicklung 1", "HS 18"),
    (2, "08:30", "10:00", "351.002", "UE", "Softwareentwicklung 1", "K 224B"),
    (2, "13:45", "15:15", "336.200", "VL", "Lineare Algebra", "HS 9"),
    (3, "10:15", "11:45", "336.201", "UE", "Lineare Algebra", "T 911"),
    (4, "08:30", "11:45", "351.010", "KS", "Algorithmen & Datenstrukturen", "Online (Zoom)"),
]


def events() -> list[SourceEvent]:
    today = datetime.now(VIENNA).date()
    monday = today - timedelta(days=today.weekday())
    out = []
    for week in range(-1, 6):
        for wd, s, e, nr, kind, title, loc in WEEK:
            d = monday + timedelta(days=wd + 7 * week)
            start = datetime.combine(d, time.fromisoformat(s), VIENNA).astimezone(timezone.utc)
            end = datetime.combine(d, time.fromisoformat(e), VIENNA).astimezone(timezone.utc)
            out.append(SourceEvent(uid=f"demo-{nr}-{d.isoformat()}@studo.plus", course_id=nr,
                                   title=title, kind=kind, start=start, end=end, location=loc,
                                   description=None, cancelled=False))
    return out
