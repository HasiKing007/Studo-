"""Abgleich Uni-Quelle -> lokale DB, mit Änderungserkennung.

Jeder Termin bekommt einen Fingerprint über Zeit, Ort, Titel und Status. Ändert sich
etwas (Raumänderung, Verschiebung, Ausfall), steigt die iCal-SEQUENCE. Dadurch
übernimmt Apple Kalender die Änderung beim nächsten Abo-Refresh sauber.

Verschwindet ein zukünftiger Termin aus der Quelle, wird er nicht gelöscht, sondern als
'cancelled' markiert und im Feed als "Entfällt" ausgeliefert. So bemerkst du Ausfälle,
statt dass der Termin kommentarlos verschwindet.
"""
import asyncio
import logging
from datetime import datetime, timedelta, timezone

from . import config, crypto, db, rooms
from .jku import ical_source
from .jku.ical_source import SourceEvent

log = logging.getLogger("studo.sync")
_lock = asyncio.Lock()


def _fingerprint(e: SourceEvent, building, room) -> str:
    return crypto.sha256("|".join(map(str, [e.title, e.kind, e.start.isoformat(), e.end.isoformat(),
                                             building, room, e.cancelled])))


def apply(events: list[SourceEvent]) -> dict:
    now = datetime.now(timezone.utc)
    stamp = now.isoformat()
    stats = {"new": 0, "changed": 0, "cancelled": 0, "total": len(events)}
    seen = set()
    with db.tx() as c:
        for e in events:
            building, room = rooms.parse_room(e.location)
            fp = _fingerprint(e, building, room)
            seen.add(e.uid)
            row = c.execute("SELECT fingerprint, sequence FROM events WHERE uid=?", (e.uid,)).fetchone()
            values = dict(uid=e.uid, course_id=e.course_id, title=e.title, kind=e.kind,
                          start=e.start.isoformat(), end=e.end.isoformat(), room_raw=e.location,
                          building=building, room=room, description=e.description,
                          status="cancelled" if e.cancelled else "confirmed",
                          fingerprint=fp, last_seen=stamp, updated_at=stamp)
            if row is None:
                c.execute(f"INSERT INTO events({','.join(values)}, sequence) "
                          f"VALUES({','.join('?' * len(values))}, 0)", tuple(values.values()))
                stats["new"] += 1
            elif row["fingerprint"] != fp:
                values["sequence"] = row["sequence"] + 1
                c.execute(f"UPDATE events SET {', '.join(f'{k}=?' for k in values)} WHERE uid=?",
                          (*values.values(), e.uid))
                stats["changed"] += 1
            else:
                c.execute("UPDATE events SET last_seen=? WHERE uid=?", (stamp, e.uid))

        # Zukünftige Termine, die nicht mehr geliefert werden -> als entfallen markieren
        for row in c.execute("SELECT uid FROM events WHERE start > ? AND status='confirmed'",
                             (stamp,)).fetchall():
            if row["uid"] not in seen:
                c.execute("UPDATE events SET status='cancelled', sequence=sequence+1, updated_at=? "
                          "WHERE uid=?", (stamp, row["uid"]))
                stats["cancelled"] += 1

        # Aufräumen: alte Termine (> 1 Semester) entfernen
        c.execute("DELETE FROM events WHERE end < ?", ((now - timedelta(days=180)).isoformat(),))

    db.set_setting("last_sync", stamp)
    db.set_setting("last_sync_error", None)
    return stats


async def run_once() -> dict:
    async with _lock:
        if config.DEMO and not db.get_setting("ical_url"):
            from . import demo
            return apply(demo.events())
        enc = db.get_setting("ical_url")
        if not enc:
            raise RuntimeError("Kein Kalender verbunden. Hinterlege den KUSSS-iCal-Link in den Einstellungen.")
        try:
            events = await ical_source.fetch(crypto.decrypt(enc))
        except Exception as e:
            db.set_setting("last_sync_error", str(e))
            raise
        stats = apply(events)
        log.info("Sync: %s", stats)
        return stats


async def loop_forever() -> None:
    while True:
        try:
            await run_once()
        except Exception as e:  # nie den Loop sterben lassen
            log.warning("Sync fehlgeschlagen: %s", e)
        await asyncio.sleep(config.SYNC_MINUTES * 60)
