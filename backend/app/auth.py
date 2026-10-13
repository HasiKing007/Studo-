"""App-Login mit JKU-Zugangsdaten.

Ablauf:
1. Erster Login: Benutzername/Passwort werden einmal gegen die JKU geprüft
   (Headless-Login, siehe jku/kusss_login.py). Bei Erfolg:
   - scrypt-Hash des Passworts wird gespeichert (für spätere lokale Logins),
   - optional ("Für automatischen Sync merken") das Passwort Fernet-verschlüsselt,
   - ein gefundener iCal-Link wird verschlüsselt gespeichert.
2. Spätere Logins prüfen lokal gegen den Hash -> kein Request an die JKU nötig.
3. Die App-Session ist ein zufälliges Token in einem HttpOnly/Secure/SameSite-Cookie;
   in der DB liegt nur sein SHA-256.

Die App ist für genau einen Nutzer (dich) gedacht. Ein zweiter JKU-Account wird abgelehnt.
"""
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, Request, Response

from . import config, crypto, db

_failed: dict[str, list[datetime]] = {}


def _rate_limit(key: str) -> None:
    now = datetime.now(timezone.utc)
    recent = [t for t in _failed.get(key, []) if now - t < timedelta(minutes=15)]
    _failed[key] = recent
    if len(recent) >= 5:
        raise HTTPException(429, "Zu viele Fehlversuche. Bitte in 15 Minuten erneut probieren.")


async def login(username: str, password: str, remember_for_sync: bool, client_ip: str) -> dict:
    _rate_limit(client_ip)
    username = username.strip().lower()
    owner = db.get_setting("owner_username")
    pw_hash = db.get_setting("owner_pw_hash")

    if owner and owner != username:
        _failed.setdefault(client_ip, []).append(datetime.now(timezone.utc))
        raise HTTPException(403, "Diese Instanz ist bereits mit einem anderen JKU-Account verknüpft.")

    if owner and pw_hash and crypto.verify_password(password, pw_hash):
        verified = True
    elif config.DEMO:
        verified = True
    else:
        # Erster Login oder Passwort an der JKU geändert -> gegen die JKU prüfen
        from .jku import kusss_login
        try:
            session = await kusss_login.login(username, password, find_ical=not db.get_setting("ical_url"))
        except kusss_login.LoginError as e:
            _failed.setdefault(client_ip, []).append(datetime.now(timezone.utc))
            raise HTTPException(401, str(e)) from e
        verified = True
        if session.ical_url:
            db.set_setting("ical_url", crypto.encrypt(session.ical_url))

    if verified:
        db.set_setting("owner_username", username)
        db.set_setting("owner_pw_hash", crypto.hash_password(password))
        if remember_for_sync and not config.DEMO:
            db.set_setting("jku_password", crypto.encrypt(password))
    return {"username": username}


def create_session(response: Response) -> None:
    token = crypto.new_token()
    expires = datetime.now(timezone.utc) + timedelta(days=config.SESSION_DAYS)
    with db.tx() as c:
        c.execute("INSERT INTO sessions(token_hash, expires_at) VALUES(?,?)",
                  (crypto.sha256(token), expires.isoformat()))
    response.set_cookie(config.SESSION_COOKIE, token, max_age=config.SESSION_DAYS * 86400,
                        httponly=True, secure=config.BASE_URL.startswith("https"),
                        samesite="strict", path="/")


def destroy_session(request: Request, response: Response) -> None:
    if token := request.cookies.get(config.SESSION_COOKIE):
        with db.tx() as c:
            c.execute("DELETE FROM sessions WHERE token_hash=?", (crypto.sha256(token),))
    response.delete_cookie(config.SESSION_COOKIE, path="/")


def require_user(request: Request) -> str:
    """FastAPI-Dependency für geschützte Endpunkte."""
    token = request.cookies.get(config.SESSION_COOKIE)
    if token:
        with db.tx() as c:
            row = c.execute("SELECT expires_at FROM sessions WHERE token_hash=?",
                            (crypto.sha256(token),)).fetchone()
        if row and datetime.fromisoformat(row["expires_at"]) > datetime.now(timezone.utc):
            return db.get_setting("owner_username") or ""
    raise HTTPException(401, "Nicht angemeldet")


def disconnect() -> None:
    """'Verbindung trennen': alle JKU-Geheimnisse und Sessions löschen."""
    for key in ("jku_password", "ical_url", "owner_pw_hash", "owner_username"):
        db.set_setting(key, None)
    db.set_setting("feed_token", crypto.new_token(24))  # alter Abo-Link wird ungültig
    with db.tx() as c:
        c.execute("DELETE FROM sessions")
