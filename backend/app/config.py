"""Zentrale Konfiguration aus Umgebungsvariablen (.env wird von run.sh geladen)."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DIR = ROOT / "frontend"

BASE_URL = os.getenv("STUDO_BASE_URL", "http://localhost:8000").rstrip("/")
DB_PATH = Path(os.getenv("STUDO_DB", ROOT / "data" / "studo.db"))
MASTER_KEY = os.getenv("STUDO_MASTER_KEY", "")
SYNC_MINUTES = int(os.getenv("STUDO_SYNC_MINUTES", "30"))
DEMO = os.getenv("STUDO_DEMO", "0") == "1"

SESSION_COOKIE = "studo_session"
SESSION_DAYS = 30
TIMEZONE = "Europe/Vienna"

# Quellen. Die KUSSS-URL für den veröffentlichten Kalender bekommst du in KUSSS unter
# "Mein Kalender" -> "Kalender exportieren/abonnieren" (Pfad bitte im echten KUSSS prüfen).
KUSSS_BASE = "https://www.kusss.jku.at/kusss"

# Schnellzugriffe (SSO). Die Ziel-URLs starten jeweils den normalen JKU-SSO-Login;
# ist im Browser bereits eine IdP-Session aktiv, wird ohne Passworteingabe durchgeleitet.
QUICK_LINKS = [
    {"id": "kusss", "name": "KUSSS", "url": "https://www.kusss.jku.at/kusss/index.action", "icon": "grid"},
    {"id": "moodle", "name": "Moodle", "url": "https://moodle.jku.at/", "icon": "book"},
    {"id": "mail", "name": "JKU-Mail", "url": "https://outlook.office.com/mail/", "icon": "mail"},
]
