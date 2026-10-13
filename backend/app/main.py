"""Studo+ Backend (FastAPI). Start: siehe README.md / run.sh"""
import asyncio
import hmac
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from urllib.parse import quote

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import auth, config, crypto, db, ics_feed, rooms, sync

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init()
    if not db.get_setting("feed_token"):
        db.set_setting("feed_token", crypto.new_token(24))
    task = asyncio.create_task(sync.loop_forever())
    yield
    task.cancel()


app = FastAPI(title="Studo+", lifespan=lifespan, docs_url=None, redoc_url=None)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    resp = await call_next(request)
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("Referrer-Policy", "no-referrer")
    resp.headers.setdefault("X-Frame-Options", "DENY")
    resp.headers.setdefault("Content-Security-Policy",
                            "default-src 'self'; img-src 'self' data:; style-src 'self'; "
                            "script-src 'self'; connect-src 'self'; frame-ancestors 'none'")
    if config.BASE_URL.startswith("https"):
        resp.headers.setdefault("Strict-Transport-Security", "max-age=31536000")
    return resp


# ---------- Auth ----------

class LoginIn(BaseModel):
    username: str = Field(min_length=2, max_length=64)
    password: str = Field(min_length=1, max_length=256)
    remember_for_sync: bool = False


@app.post("/api/login")
async def login(body: LoginIn, request: Request, response: Response):
    user = await auth.login(body.username, body.password, body.remember_for_sync,
                            request.client.host if request.client else "?")
    auth.create_session(response)
    asyncio.create_task(_safe_sync())
    return user


@app.post("/api/logout")
def logout(request: Request, response: Response):
    auth.destroy_session(request, response)
    return {"ok": True}


@app.post("/api/disconnect")
def disconnect(response: Response, _=Depends(auth.require_user)):
    auth.disconnect()
    response.delete_cookie(config.SESSION_COOKIE, path="/")
    return {"ok": True}


async def _safe_sync():
    try:
        await sync.run_once()
    except Exception as e:
        logging.getLogger("studo").warning("Sync nach Login fehlgeschlagen: %s", e)


# ---------- Status & Einstellungen ----------

def _feed_urls() -> dict:
    token = db.get_setting("feed_token")
    https_url = f"{config.BASE_URL}/cal/{token}.ics"
    return {"https": https_url, "webcal": "webcal://" + https_url.split("://", 1)[1]}


@app.get("/api/me")
def me(user: str = Depends(auth.require_user)):
    return {
        "username": user,
        "demo": config.DEMO,
        "connected": bool(db.get_setting("ical_url")) or config.DEMO,
        "sync_password_stored": bool(db.get_setting("jku_password")),
        "last_sync": db.get_setting("last_sync"),
        "last_sync_error": db.get_setting("last_sync_error"),
        "marker_style": db.get_setting("marker_style", "prefix"),
        "feed": _feed_urls(),
        "links": config.QUICK_LINKS,
    }


class SettingsIn(BaseModel):
    marker_style: str | None = Field(default=None, pattern="^(prefix|emoji|notes)$")
    ical_url: str | None = Field(default=None, max_length=1000)


@app.put("/api/settings")
async def update_settings(body: SettingsIn, _=Depends(auth.require_user)):
    if body.marker_style:
        db.set_setting("marker_style", body.marker_style)
    if body.ical_url is not None:
        url = body.ical_url.strip()
        if url and not url.lower().startswith(("https://", "webcal://")):
            raise HTTPException(422, "Bitte den vollständigen https:// oder webcal:// Link einfügen.")
        db.set_setting("ical_url", crypto.encrypt(url) if url else None)
        if url:
            await sync.run_once()
    return {"ok": True}


@app.post("/api/feed/rotate")
def rotate_feed(_=Depends(auth.require_user)):
    """Neuer Abo-Link, z. B. wenn der alte geleakt ist. Danach in Apple Kalender neu abonnieren."""
    db.set_setting("feed_token", crypto.new_token(24))
    return _feed_urls()


@app.post("/api/sync")
async def manual_sync(_=Depends(auth.require_user)):
    try:
        return await sync.run_once()
    except Exception as e:
        raise HTTPException(502, f"Sync fehlgeschlagen: {e}") from e


# ---------- Termine & Anwesenheitspflicht ----------

@app.get("/api/events")
def list_events(start: str, end: str, _=Depends(auth.require_user)):
    """start/end als ISO-Zeitpunkte (UTC empfohlen)."""
    with db.tx() as c:
        rows = c.execute(db.EFFECTIVE_ATTENDANCE_SQL + " WHERE e.end > ? AND e.start < ? ORDER BY e.start",
                         (start, end)).fetchall()
    return [{
        "uid": r["uid"], "course_id": r["course_id"], "title": r["title"], "kind": r["kind"],
        "start": r["start"], "end": r["end"], "status": r["status"],
        "building": r["building"], "room": r["room"], "room_raw": r["room_raw"],
        "location": rooms.format_room(r["building"], r["room"]),
        "attendance": bool(r["attendance"]), "is_override": bool(r["is_override"]),
        "course_attendance": bool(r["course_attendance"]),
    } for r in rows]


class AttendanceIn(BaseModel):
    attendance: bool | None  # None = Ausnahme entfernen (nur bei Einzelterminen)


def _touch(c, where: str, arg: str) -> None:
    """Geänderte Termine im Feed als neu markieren, damit Kalender-Clients sie übernehmen."""
    c.execute(f"UPDATE events SET sequence=sequence+1, updated_at=? WHERE {where}",
              (datetime.now(timezone.utc).isoformat(), arg))


@app.put("/api/courses/{course_id}/attendance")
def set_course_attendance(course_id: str, body: AttendanceIn, _=Depends(auth.require_user)):
    with db.tx() as c:
        c.execute("INSERT INTO course_settings(course_id, attendance) VALUES(?,?) "
                  "ON CONFLICT(course_id) DO UPDATE SET attendance=excluded.attendance",
                  (course_id, int(bool(body.attendance))))
        _touch(c, "course_id=?", course_id)
    return {"ok": True}


@app.put("/api/events/{uid}/attendance")
def set_event_attendance(uid: str, body: AttendanceIn, _=Depends(auth.require_user)):
    with db.tx() as c:
        if not c.execute("SELECT 1 FROM events WHERE uid=?", (uid,)).fetchone():
            raise HTTPException(404, "Termin nicht gefunden")
        if body.attendance is None:
            c.execute("DELETE FROM event_overrides WHERE uid=?", (uid,))
        else:
            c.execute("INSERT INTO event_overrides(uid, attendance) VALUES(?,?) "
                      "ON CONFLICT(uid) DO UPDATE SET attendance=excluded.attendance",
                      (uid, int(body.attendance)))
        _touch(c, "uid=?", uid)
    return {"ok": True}


# ---------- Abonnierbarer Kalender (öffentlich, durch geheimes Token geschützt) ----------

@app.get("/cal/{token}.ics")
def calendar_feed(token: str):
    expected = db.get_setting("feed_token") or ""
    if not expected or not hmac.compare_digest(token, expected):
        raise HTTPException(404)
    body = ics_feed.build_feed(db.get_setting("marker_style", "prefix"))
    return Response(body, media_type="text/calendar; charset=utf-8", headers={
        "Content-Disposition": f"inline; filename*=UTF-8''{quote('JKU Stundenplan.ics')}",
        "Cache-Control": "no-cache, max-age=0",
    })


# ---------- Frontend (PWA) ----------

@app.get("/sw.js", include_in_schema=False)
def service_worker():
    # Muss von der Wurzel kommen, damit der Service Worker die ganze App abdeckt.
    return FileResponse(config.FRONTEND_DIR / "sw.js", media_type="application/javascript",
                        headers={"Cache-Control": "no-cache"})


app.mount("/", StaticFiles(directory=config.FRONTEND_DIR, html=True), name="frontend")
