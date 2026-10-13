"""SQLite-Speicher. Bewusst ohne ORM: wenige Tabellen, ein Nutzer, gut lesbar."""
import sqlite3
from contextlib import contextmanager

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Ein Termin aus dem Uni-System. uid = stabile ID aus der Quelle (iCal-UID).
CREATE TABLE IF NOT EXISTS events (
    uid         TEXT PRIMARY KEY,
    course_id   TEXT NOT NULL,          -- z. B. LVA-Nummer "336.100" oder normalisierter Titel
    title       TEXT NOT NULL,          -- "Analysis 1"
    kind        TEXT,                   -- "VL", "UE", "KS", "PR" ...
    start       TEXT NOT NULL,          -- ISO-8601 in UTC
    end         TEXT NOT NULL,
    room_raw    TEXT,                   -- Originaltext aus KUSSS
    building    TEXT,                   -- "Keplergebäude"
    room        TEXT,                   -- "HS 1"
    description TEXT,
    status      TEXT NOT NULL DEFAULT 'confirmed',  -- confirmed | cancelled
    fingerprint TEXT NOT NULL,          -- Hash über die Inhalte -> Änderungserkennung
    sequence    INTEGER NOT NULL DEFAULT 0,         -- iCal SEQUENCE, steigt bei Änderung
    last_seen   TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_start ON events(start);

-- Anwesenheitspflicht pro Kurs (Standard für alle Termine des Kurses)
CREATE TABLE IF NOT EXISTS course_settings (
    course_id  TEXT PRIMARY KEY,
    attendance INTEGER NOT NULL DEFAULT 0
);

-- Ausnahme für einen einzelnen Termin (überschreibt den Kurs-Standard)
CREATE TABLE IF NOT EXISTS event_overrides (
    uid        TEXT PRIMARY KEY,
    attendance INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    expires_at TEXT NOT NULL
);
"""


def connect() -> sqlite3.Connection:
    config.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(config.DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


@contextmanager
def tx():
    conn = connect()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init() -> None:
    with tx() as c:
        c.executescript(SCHEMA)


def get_setting(key: str, default: str | None = None) -> str | None:
    with tx() as c:
        row = c.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return row["value"] if row else default


def set_setting(key: str, value: str | None) -> None:
    with tx() as c:
        if value is None:
            c.execute("DELETE FROM settings WHERE key=?", (key,))
        else:
            c.execute("INSERT INTO settings(key,value) VALUES(?,?) "
                      "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))


EFFECTIVE_ATTENDANCE_SQL = """
SELECT e.*,
       COALESCE(o.attendance, cs.attendance, 0) AS attendance,
       o.attendance IS NOT NULL                 AS is_override,
       COALESCE(cs.attendance, 0)               AS course_attendance
FROM events e
LEFT JOIN event_overrides o  ON o.uid = e.uid
LEFT JOIN course_settings cs ON cs.course_id = e.course_id
"""
