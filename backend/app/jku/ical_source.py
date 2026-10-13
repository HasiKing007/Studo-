"""Stundenplan aus dem KUSSS-iCal-Export lesen (empfohlener Weg, kein Scraping).

KUSSS kann deinen persönlichen Kalender als iCal veröffentlichen. Der Link enthält ein
geheimes Token und funktioniert ohne Login. Er ist damit stabiler als jedes Scraping und
du musst dein JKU-Passwort für den Sync gar nicht speichern.

Achtung: Der Link ist selbst ein Geheimnis (wer ihn hat, sieht deinen Stundenplan) und
wird deshalb verschlüsselt gespeichert.
"""
import re
from dataclasses import dataclass
from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo

import httpx
from icalendar import Calendar

from .. import config

VIENNA = ZoneInfo(config.TIMEZONE)
LVA_NR = re.compile(r"\b(\d{3}\.\d{3})\b")
KIND = re.compile(r"\b(VL|VO|UE|KS|PR|SE|PS|IK|KV|VU|AG|PJ|EX)\b")


@dataclass
class SourceEvent:
    uid: str
    course_id: str
    title: str
    kind: str | None
    start: datetime   # UTC, tz-aware
    end: datetime
    location: str | None
    description: str | None
    cancelled: bool


def _to_utc(value) -> datetime:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=VIENNA)
        return value.astimezone(timezone.utc)
    if isinstance(value, date):  # Ganztagstermin
        return datetime.combine(value, time(0, 0), VIENNA).astimezone(timezone.utc)
    raise ValueError(f"Unbekanntes Datumsformat: {value!r}")


def clean_title(summary: str) -> tuple[str, str | None, str | None]:
    """'336.100 VL Analysis 1' / 'Analysis 1 / VL / 336.100' -> ('Analysis 1', 'VL', '336.100')."""
    nr = m.group(1) if (m := LVA_NR.search(summary)) else None
    kind = k.group(1) if (k := KIND.search(summary)) else None
    title = summary
    for part in filter(None, [nr, kind]):
        title = re.sub(rf"\b{re.escape(part)}\b", "", title)
    title = re.sub(r"\s*[/|\-–,]\s*(?=[/|\-–,]|$)", "", title)  # übrig gebliebene Trenner
    title = " ".join(title.strip(" /|-–,").split())
    return title or summary, kind, nr


def parse_ics(raw: bytes) -> list[SourceEvent]:
    cal = Calendar.from_ical(raw)
    out: list[SourceEvent] = []
    for comp in cal.walk("VEVENT"):
        summary = str(comp.get("SUMMARY", "")).strip()
        title, kind, nr = clean_title(summary)
        start = _to_utc(comp.decoded("DTSTART"))
        end = _to_utc(comp.decoded("DTEND")) if comp.get("DTEND") else start
        uid = str(comp.get("UID") or f"{summary}-{start.isoformat()}")
        status = str(comp.get("STATUS", "CONFIRMED")).upper()
        out.append(SourceEvent(
            uid=uid,
            course_id=nr or title.lower(),
            title=title,
            kind=kind,
            start=start,
            end=end,
            location=str(comp.get("LOCATION")) if comp.get("LOCATION") else None,
            description=str(comp.get("DESCRIPTION")) if comp.get("DESCRIPTION") else None,
            cancelled=status == "CANCELLED" or "entfällt" in summary.lower(),
        ))
    return out


async def fetch(ical_url: str) -> list[SourceEvent]:
    # webcal:// ist nur ein Hinweis für Kalender-Apps, technisch ist es https://
    url = re.sub(r"^webcal://", "https://", ical_url.strip())
    async with httpx.AsyncClient(timeout=30, follow_redirects=True,
                                 headers={"User-Agent": "StudoPlus/0.1 (private use)"}) as client:
        r = await client.get(url)
        r.raise_for_status()
        if b"BEGIN:VCALENDAR" not in r.content[:2000]:
            raise ValueError("Antwort ist kein iCal. Ist der Link noch gültig?")
        return parse_ics(r.content)
