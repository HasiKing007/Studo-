// Ein Durable Object pro Konto ("<uni>:<benutzer>") mit eigener SQLite-Datenbank:
// Termine, Schalter, Einstellungen, Sessions. Ein Alarm gleicht alle 30 Minuten mit dem
// Uni-Kalender ab, auch wenn niemand die App öffnet. Nutzungszahlen gehen an die Registry.

import { DurableObject } from "cloudflare:workers";
import { buildCalendar, parseICS, viennaToUtc } from "./ical.js";
import { formatRoom, parseRoom } from "./rooms.js";
import { demoDeadlines, demoEvents, demoExamRegs } from "./demo.js";
import { jkuConnect, parseGrade } from "./jku.js";
import { usiInfo } from "./campus.js";
import { fetchMensa } from "./mensa.js";
import { isMoodleLink, parseMoodle } from "./moodle.js";
import { probeLogin } from "./probe.js";
import { sendPush } from "./webpush.js";
import { TAGS, detectTag } from "./tags.js";
import { UNIS, matrikel } from "./unis.js";
import { error, hashPassword, json, parseSession, randomToken, sha256, timingSafeEqual, verifyPassword } from "./util.js";

// Tagsüber (6–22 Uhr Wien) alle 10 Minuten, nachts stündlich: Raumänderungen kommen so rasch an
const SYNC_DAY_MINUTES = 10, SYNC_NIGHT_MINUTES = 60;
// Stunde in Wien als Zahl ("de-AT" formatiert "12 Uhr", daher über formatToParts)
const hourFmt = new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/Vienna" });
const viennaHour = (d = new Date()) => +hourFmt.formatToParts(d).find((p) => p.type === "hour").value;
export function nextSyncDelay(now = new Date()) {
  const h = viennaHour(now);
  return (h >= 6 && h < 22 ? SYNC_DAY_MINUTES : SYNC_NIGHT_MINUTES) * 60_000;
}
export const SESSION_DAYS = 90;
const ACCOUNT_FAIL_LIMIT = 5;

const MARKERS = { prefix: "! ", emoji: "🔴 ", notes: "" };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (
  uid TEXT PRIMARY KEY, course_id TEXT NOT NULL, title TEXT NOT NULL, kind TEXT,
  start TEXT NOT NULL, "end" TEXT NOT NULL, room_raw TEXT, building TEXT, room TEXT,
  description TEXT, status TEXT NOT NULL DEFAULT 'confirmed', fingerprint TEXT NOT NULL,
  sequence INTEGER NOT NULL DEFAULT 0, last_seen TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_start ON events(start);
CREATE TABLE IF NOT EXISTS course_settings (course_id TEXT PRIMARY KEY, attendance INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS event_overrides (uid TEXT PRIMARY KEY, attendance INTEGER NOT NULL);
-- Art des Termins von Hand gesetzt ("none" = erkannte Art ausblenden)
CREATE TABLE IF NOT EXISTS event_tags (uid TEXT PRIMARY KEY, tag TEXT NOT NULL);
-- Abgaben aus dem Moodle-Kalender (done = von Hand abgehakt)
CREATE TABLE IF NOT EXISTS deadlines (
  uid TEXT PRIMARY KEY, title TEXT NOT NULL, course TEXT, due TEXT NOT NULL, note TEXT,
  done INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
);
-- Push-Mitteilungen: ein Abo pro Gerät, Protokoll gegen doppelte Erinnerungen
CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS push_log (key TEXT PRIMARY KEY, sent_at TEXT NOT NULL);
-- Prüfungstermine mit Anmeldefrist aus KUSSS (bei jedem KUSSS-Login neu gelesen)
CREATE TABLE IF NOT EXISTS exam_regs (
  key TEXT PRIMARY KEY, nr TEXT, title TEXT NOT NULL, exam_date TEXT, until TEXT NOT NULL,
  registered INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, expires_at TEXT NOT NULL);
-- Kursübersicht bleibt erhalten, auch wenn alte Termine aufgeräumt werden (Semesterfilter)
CREATE TABLE IF NOT EXISTS courses (
  course_id TEXT PRIMARY KEY, title TEXT NOT NULL, nr TEXT, kinds TEXT,
  first_start TEXT NOT NULL, last_end TEXT NOT NULL, semesters TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS programs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, code TEXT, ects_target REAL, source TEXT NOT NULL DEFAULT 'manual'
);
CREATE TABLE IF NOT EXISTS grades (
  id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT UNIQUE, date TEXT, nr TEXT, title TEXT NOT NULL, kind TEXT,
  grade_text TEXT, grade INTEGER, passed INTEGER, ects REAL, sws REAL, semester TEXT,
  program_id INTEGER, source TEXT NOT NULL DEFAULT 'manual', updated_at TEXT NOT NULL
);
-- Ob eine Note zu den ECTS zählt (vom Nutzer festgelegt). Eigene Tabelle, weil KUSSS-Noten bei jedem Sync neu geschrieben werden
CREATE TABLE IF NOT EXISTS grade_counts (gkey TEXT PRIMARY KEY, counted INTEGER NOT NULL);
`;

const EFFECTIVE = `
SELECT e.*, COALESCE(o.attendance, cs.attendance, 0) AS attendance, cs.short AS short,
       o.attendance IS NOT NULL AS is_override, COALESCE(cs.attendance, 0) AS course_attendance, t.tag AS tag_set
FROM events e
LEFT JOIN event_overrides o ON o.uid = e.uid
LEFT JOIN event_tags t ON t.uid = e.uid
LEFT JOIN course_settings cs ON cs.course_id = e.course_id`;

/** Art eines Termins: von Hand gesetzt, sonst aus Titel oder kurzer Notiz erkannt. */
function eventTag(r) {
  const auto = detectTag(r.title, r.description);
  const tag = r.tag_set === "none" ? null : r.tag_set || auto;
  return { tag, tag_auto: auto, tag_manual: r.tag_set != null };
}

const viennaMonthYear = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit" });

/** Semester eines Datums: Okt–Feb = Wintersemester ("WS 2026/27"), März–Sept = Sommersemester ("SS 2027"). */
export function semesterOf(date) {
  const parts = Object.fromEntries(viennaMonthYear.formatToParts(new Date(date)).map((p) => [p.type, p.value]));
  const y = +parts.year, m = +parts.month;
  if (m >= 10) return `WS ${y}/${String(y + 1).slice(2)}`;
  if (m <= 2) return `WS ${y - 1}/${String(y).slice(2)}`;
  return `SS ${y}`;
}

/** Sortierschlüssel für Semester (neueste zuerst sortierbar). */
export function semesterKey(sem) {
  const m = String(sem).match(/(WS|SS)\s*(\d{4})/);
  return m ? +m[2] * 2 + (m[1] === "WS" ? 1 : 0) : 0;
}

// ---------- Texte für Mitteilungen (Wiener Zeit) ----------
const viennaDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit" });
const viennaTime = new Intl.DateTimeFormat("de-AT", { timeZone: "Europe/Vienna", hour: "2-digit", minute: "2-digit" });
const viennaWeekday = new Intl.DateTimeFormat("de-AT", { timeZone: "Europe/Vienna", weekday: "short", day: "numeric", month: "numeric" });

/** "heute 08:30", "morgen 12:00", "Mo., 19.10. 08:30" */
export function whenText(date, now = new Date()) {
  const d = new Date(date);
  const days = Math.round((Date.parse(viennaDay.format(d)) - Date.parse(viennaDay.format(now))) / 86400_000);
  const day = days === 0 ? "heute" : days === 1 ? "morgen" : viennaWeekday.format(d);
  return `${day} ${viennaTime.format(d)}`;
}
const EXAM_TAGS = new Set(["klausur", "teilklausur", "nachklausur", "vortrag", "praesentation"]);
const PUSH_WINDOW = 7 * 86400_000; // Änderungen nur für Termine der nächsten 7 Tage melden

export class StudoStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.failures = [];
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(SCHEMA);
      try { this.sql.exec("ALTER TABLE courses ADD COLUMN lecturer TEXT"); } catch { /* Spalte gibt es schon */ }
      try { this.sql.exec("ALTER TABLE course_settings ADD COLUMN short TEXT"); } catch { /* Spalte gibt es schon */ }
    });
  }

  getSetting(key, fallback = null) {
    return this.sql.exec("SELECT value FROM settings WHERE key=?", key).toArray()[0]?.value ?? fallback;
  }

  setSetting(key, value) {
    if (value === null || value === undefined) this.sql.exec("DELETE FROM settings WHERE key=?", key);
    else this.sql.exec("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", key, String(value));
  }

  get key() { return `${this.getSetting("uni")}:${this.getSetting("username")}`; }
  get uni() { return UNIS[this.getSetting("uni")] || UNIS.other; }
  get exists() { return !!this.getSetting("pw_hash"); }

  /** Nutzungszahlen an die zentrale Registry melden (blockiert nie die Antwort). */
  track(event, info = {}) {
    if (!this.env.REGISTRY || !this.exists) return;
    const stub = this.env.REGISTRY.get(this.env.REGISTRY.idFromName("global"));
    this.ctx.waitUntil(stub.track(this.key, event, {
      verified: this.getSetting("verified") === "1",
      connected: !!this.getSetting("ical_url") || this.env.DEMO === "1",
      name: this.getSetting("display_name") || this.getSetting("kusss_name") || null,
      ...info,
    }).catch((e) => console.warn("Registry:", e.message)));
  }

  // ---------- Hintergrund-Sync ----------

  async alarm() {
    if (!this.exists) return; // gelöschtes oder nie angelegtes Konto: nicht weiterlaufen
    try { await this.sync(); } catch (e) { console.warn("Sync fehlgeschlagen:", e.message); }
    try { await this.syncMoodle(); } catch (e) { console.warn("Moodle-Sync fehlgeschlagen:", e.message); }
    try { await this.remind(); } catch (e) { console.warn("Erinnerungen fehlgeschlagen:", e.message); }
    finally { await this.ctx.storage.setAlarm(Date.now() + nextSyncDelay()); }
  }

  async sync() {
    const url = this.getSetting("ical_url");
    let events;
    if (!url && this.env.DEMO === "1") {
      events = demoEvents();
    } else if (!url) {
      throw new Error("Noch kein Kalender verbunden. Den iCal-Link in den Einstellungen hinterlegen.");
    } else {
      try {
        const res = await fetch(url.trim().replace(/^webcal:\/\//i, "https://"), {
          headers: { "User-Agent": "StudoPlus/1.0" }, redirect: "follow",
          signal: AbortSignal.timeout(25_000), // hängende Uni-Server nicht ewig warten lassen
        });
        if (!res.ok) throw new Error(`Der Uni-Server antwortet mit HTTP ${res.status}. Neue Kalender-Links funktionieren manchmal erst nach einigen Stunden.`)
        const text = await res.text();
        if (!text.slice(0, 2000).includes("BEGIN:VCALENDAR")) throw new Error("Antwort ist kein iCal. Ist der Link noch gültig?");
        events = parseICS(text);
      } catch (e) {
        if (e.name === "TimeoutError") e = new Error("Der Uni-Server antwortet nicht. Studo+ versucht es später automatisch wieder.");
        this.setSetting("last_sync_error", e.message);
        this.track("sync_error");
        throw e;
      }
    }
    let stats;
    try { stats = await this.apply(events); } catch (e) {
      console.warn("Abgleich fehlgeschlagen:", e.stack || e.message);
      this.setSetting("last_sync_error", `Termine konnten nicht übernommen werden: ${e.message}`);
      this.track("sync_error");
      throw e;
    }
    this.track("sync", { events: stats.total });
    if (stats.notes.length) await this.notifyChanges(stats.notes).catch((e) => console.warn("Push:", e.message));
    return stats;
  }

  /** Moodle-Abgaben holen (eigener Link, Fehler stören den Stundenplan nicht). */
  async syncMoodle() {
    const url = this.getSetting("moodle_url");
    let items;
    if (!url && this.env.DEMO === "1") items = demoDeadlines();
    else if (!url) return null;
    else {
      try {
        const res = await fetch(url.trim().replace(/^webcal:\/\//i, "https://"), {
          headers: { "User-Agent": "StudoPlus/1.0" }, redirect: "follow",
          signal: AbortSignal.timeout(25_000), // hängende Uni-Server nicht ewig warten lassen
        });
        if (!res.ok) throw new Error(`Moodle antwortet mit HTTP ${res.status}`);
        const text = await res.text();
        if (!text.slice(0, 2000).includes("BEGIN:VCALENDAR")) throw new Error("Antwort ist kein Kalender. Ist der Moodle-Link noch gültig?");
        items = parseMoodle(text);
      } catch (e) {
        this.setSetting("moodle_error", e.message);
        throw e;
      }
    }
    const now = new Date(), stamp = now.toISOString();
    const seen = new Set();
    for (const d of items) {
      seen.add(d.uid);
      this.sql.exec(`INSERT INTO deadlines(uid, title, course, due, note, updated_at) VALUES(?,?,?,?,?,?)
        ON CONFLICT(uid) DO UPDATE SET title=excluded.title, course=excluded.course, due=excluded.due,
        note=excluded.note, updated_at=CASE WHEN deadlines.due<>excluded.due OR deadlines.title<>excluded.title
        THEN excluded.updated_at ELSE deadlines.updated_at END`,
        d.uid, d.title, d.course, d.due.toISOString(), d.note, stamp);
    }
    // Künftige Abgaben, die Moodle nicht mehr liefert, sind gestrichen; Altes nach 30 Tagen weg
    for (const { uid } of this.sql.exec("SELECT uid FROM deadlines WHERE due > ?", stamp).toArray()) {
      if (!seen.has(uid)) this.sql.exec("DELETE FROM deadlines WHERE uid=?", uid);
    }
    this.sql.exec("DELETE FROM deadlines WHERE due < ?", new Date(now - 30 * 86400_000).toISOString());
    this.setSetting("moodle_error", null);
    this.setSetting("moodle_sync", stamp);
    return { total: items.length };
  }

  deadlinesPayload() {
    const since = new Date(Date.now() - 3600_000).toISOString();
    return this.sql.exec("SELECT uid, title, course, due, note, done FROM deadlines WHERE due >= ? ORDER BY due", since)
      .toArray().map((d) => ({ ...d, done: !!d.done }));
  }

  // ---------- Push-Mitteilungen ----------

  pushPrefs() {
    return {
      changes: this.getSetting("push_changes", "1") === "1",
      deadlines: this.getSetting("push_deadlines", "1") === "1",
      exams: this.getSetting("push_exams", "1") === "1",
    };
  }

  async vapid() {
    if (!this.vapidKeys) this.vapidKeys = await this.env.REGISTRY.get(this.env.REGISTRY.idFromName("global")).vapid();
    return this.vapidKeys;
  }

  /** An alle Geräte des Kontos senden; abgelaufene Abos werden entfernt. Liefert die Zahl der Zustellungen. */
  async push(messages, only = null) {
    const subs = this.sql.exec("SELECT endpoint, p256dh, auth FROM push_subs").toArray().filter((s) => !only || s.endpoint === only);
    if (!subs.length || !messages.length) return 0;
    const vapid = await this.vapid();
    const subject = this.getSetting("app_origin") || "https://github.com/HasiKing007/Studo-";
    let sent = 0;
    for (const s of subs) {
      for (const m of messages) {
        const r = await sendPush({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, { url: "/", ...m }, vapid, subject);
        if (r === "gone") { this.sql.exec("DELETE FROM push_subs WHERE endpoint=?", s.endpoint); break; }
        if (r === "ok") sent++;
      }
    }
    return sent;
  }

  async notifyChanges(notes) {
    if (!this.pushPrefs().changes) return;
    // Viele Änderungen auf einmal: eine Sammelmitteilung statt einer Flut
    const msgs = notes.length > 4
      ? [{ title: `${notes.length} Termine geändert`, body: "Öffne Studo+ für die Details.", tag: "chg:many" }]
      : notes;
    await this.push(msgs);
  }

  /** Erinnerungen 24 Stunden vor Abgaben und Prüfungen (nicht nachts, jede nur einmal). */
  async remind(now = new Date()) {
    if (!this.sql.exec("SELECT 1 FROM push_subs LIMIT 1").toArray().length) return;
    const h = viennaHour(now);
    if (h < 7 || h >= 22) return;
    const prefs = this.pushPrefs();
    const from = now.toISOString(), until = new Date(now.getTime() + 24 * 3600_000).toISOString();
    const due = [];
    if (prefs.deadlines) {
      for (const d of this.sql.exec("SELECT * FROM deadlines WHERE done=0 AND due > ? AND due <= ?", from, until).toArray()) {
        due.push({ key: `dl:${d.uid}:${d.due}`, title: `Abgabe ${whenText(d.due, now)}`, body: d.course ? `${d.title} · ${d.course}` : d.title });
      }
    }
    if (prefs.exams) {
      for (const r of this.sql.exec(`${EFFECTIVE} WHERE e.start > ? AND e.start <= ? AND e.status='confirmed'`, from, until).toArray()) {
        const { tag } = eventTag(r);
        if (!EXAM_TAGS.has(tag)) continue;
        const where = formatRoom(r.building, r.room) || r.room_raw;
        due.push({ key: `ex:${r.uid}:${r.start}`, title: `${TAGS[tag]} ${whenText(r.start, now)}`, body: where ? `${r.title} · ${where}` : r.title });
      }
    }
    if (prefs.exams) {
      const until48 = new Date(now.getTime() + 48 * 3600_000).toISOString();
      for (const x of this.sql.exec("SELECT * FROM exam_regs WHERE registered=0 AND until > ? AND until <= ?", from, until48).toArray()) {
        due.push({ key: `reg:${x.key}:${x.until}`, title: `Anmeldung endet ${whenText(x.until, now)}`, body: x.exam_date ? `${x.title} · Prüfung ${whenText(x.exam_date, now)}` : x.title });
      }
    }
    const fresh = due.filter((m) => !this.sql.exec("SELECT 1 FROM push_log WHERE key=?", m.key).toArray().length);
    for (const m of fresh) this.sql.exec("INSERT INTO push_log(key, sent_at) VALUES(?,?)", m.key, from);
    this.sql.exec("DELETE FROM push_log WHERE sent_at < ?", new Date(now.getTime() - 60 * 86400_000).toISOString());
    if (fresh.length) await this.push(fresh.map(({ key, ...m }) => ({ ...m, tag: key })));
  }

  room(raw) {
    return this.uni.rooms === "jku" ? parseRoom(raw) : [null, raw ? raw.replace(/\\,/g, ",").trim() : null];
  }

  /** Abgleich mit Änderungserkennung (Fingerprint -> SEQUENCE+1) und Ausfall-Erkennung. */
  async apply(events) {
    const now = new Date();
    const stamp = now.toISOString();
    const stats = { new: 0, changed: 0, cancelled: 0, total: events.length, notes: [] };
    const seen = new Set();
    const watchUntil = now.getTime() + PUSH_WINDOW;
    const soon = (iso) => { const t = Date.parse(iso); return t > now.getTime() && t < watchUntil; };

    for (const e of events) {
      const [building, room] = this.room(e.location);
      const fp = await sha256([e.title, e.kind, e.start.toISOString(), e.end.toISOString(), building, room, e.cancelled].join("|"));
      seen.add(e.uid);
      const row = this.sql.exec(`SELECT fingerprint, sequence, start, building, room, room_raw, status FROM events WHERE uid=?`, e.uid).toArray()[0];
      const v = [e.courseId, e.title, e.kind, e.start.toISOString(), e.end.toISOString(), e.location, building, room,
        e.description, e.cancelled ? "cancelled" : "confirmed", fp, stamp, stamp];
      if (!row) {
        this.sql.exec(`INSERT INTO events(course_id,title,kind,start,"end",room_raw,building,room,description,status,
          fingerprint,last_seen,updated_at,uid,sequence) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`, ...v, e.uid);
        stats.new++;
      } else if (row.fingerprint !== fp) {
        const name = `${e.kind ? `${e.kind} ` : ""}${e.title}`, start = e.start.toISOString();
        const oldRoom = formatRoom(row.building, row.room) || row.room_raw, newRoom = formatRoom(building, room) || e.location;
        if (e.cancelled && row.status !== "cancelled" && soon(row.start)) {
          stats.notes.push({ title: `Entfällt: ${name}`, body: whenText(row.start, now), tag: `chg:${e.uid}` });
        } else if (!e.cancelled && row.start !== start && (soon(row.start) || soon(start))) {
          stats.notes.push({ title: `Zeitänderung: ${name}`, body: `Jetzt ${whenText(start, now)} statt ${whenText(row.start, now)}${newRoom ? ` · ${newRoom}` : ""}`, tag: `chg:${e.uid}` });
        } else if (!e.cancelled && (oldRoom || "") !== (newRoom || "") && soon(start)) {
          stats.notes.push({ title: `Raumänderung: ${name}`, body: `${whenText(start, now)} jetzt in ${newRoom || "unbekanntem Raum"}${oldRoom ? ` (statt ${oldRoom})` : ""}`, tag: `chg:${e.uid}` });
        }
        this.sql.exec(`UPDATE events SET course_id=?,title=?,kind=?,start=?,"end"=?,room_raw=?,building=?,room=?,
          description=?,status=?,fingerprint=?,last_seen=?,updated_at=?,sequence=sequence+1 WHERE uid=?`, ...v, e.uid);
        stats.changed++;
      } else {
        this.sql.exec("UPDATE events SET last_seen=? WHERE uid=?", stamp, e.uid);
      }
    }

    // Zukünftige Termine, die nicht mehr geliefert werden -> als entfallen markieren
    const vanished = [];
    for (const { uid, start, title, kind } of this.sql.exec("SELECT uid, start, title, kind FROM events WHERE start > ? AND status='confirmed'", stamp).toArray()) {
      if (!seen.has(uid)) {
        if (soon(start)) vanished.push({ title: `Entfällt: ${kind ? `${kind} ` : ""}${title}`, body: whenText(start, now), tag: `chg:${uid}` });
        this.sql.exec("UPDATE events SET status='cancelled', sequence=sequence+1, updated_at=? WHERE uid=?", stamp, uid);
        stats.cancelled++;
      }
    }
    // Viele verschwundene Termine auf einmal sind eher ein Problem des Uni-Exports als echte Ausfälle
    if (vanished.length <= 3) stats.notes.push(...vanished);
    if (!events.length) stats.notes = [];
    this.updateCourses(events);
    // Aufräumen: Termine, die älter als ein Semester sind
    this.sql.exec(`DELETE FROM events WHERE "end" < ?`, new Date(now - 180 * 86400_000).toISOString());
    this.sql.exec("DELETE FROM event_tags WHERE uid NOT IN (SELECT uid FROM events)");

    this.setSetting("last_sync", stamp);
    this.setSetting("last_sync_error", null);
    return stats;
  }

  updateCourses(events) {
    const byCourse = new Map();
    for (const e of events) {
      if (e.cancelled) continue;
      const c = byCourse.get(e.courseId) || { title: e.title, lecturer: e.lecturer || null, nr: /^\d{3}\.\w{3}$/.test(e.courseId) ? e.courseId : null, kinds: new Set(), sems: new Set(), first: e.start, last: e.end };
      if (e.kind) c.kinds.add(e.kind);
      c.sems.add(semesterOf(e.start));
      if (e.start < c.first) c.first = e.start;
      if (e.end > c.last) c.last = e.end;
      byCourse.set(e.courseId, c);
    }
    for (const [id, c] of byCourse) {
      const old = this.sql.exec("SELECT kinds, semesters, first_start, last_end FROM courses WHERE course_id=?", id).toArray()[0];
      const kinds = new Set([...(old?.kinds ? old.kinds.split(",") : []), ...c.kinds]);
      const sems = new Set([...(old?.semesters ? old.semesters.split(",") : []), ...c.sems]);
      const first = old && old.first_start < c.first.toISOString() ? old.first_start : c.first.toISOString();
      const last = old && old.last_end > c.last.toISOString() ? old.last_end : c.last.toISOString();
      this.sql.exec(`INSERT INTO courses(course_id, title, nr, kinds, first_start, last_end, semesters, lecturer) VALUES(?,?,?,?,?,?,?,?)
        ON CONFLICT(course_id) DO UPDATE SET title=excluded.title, nr=excluded.nr, kinds=excluded.kinds,
        first_start=excluded.first_start, last_end=excluded.last_end, semesters=excluded.semesters, lecturer=excluded.lecturer`,
        id, c.title, c.nr, [...kinds].join(","), first, last, [...sems].join(","), c.lecturer);
    }
    // Kurse ohne Termine (z. B. nach geänderter Kurs-ID) entfernen
    this.sql.exec("DELETE FROM courses WHERE course_id NOT IN (SELECT DISTINCT course_id FROM events)");
  }

  // ---------- Noten & Studien ----------

  /** Ergebnis der KUSSS-Notenauskunft übernehmen (manuelle Einträge bleiben unberührt). */
  storeGrades(result) {
    if (!result) return;
    if (result.error && !result.grades.length) { this.setSetting("grades_error", result.error); return; }
    const now = new Date().toISOString();
    const programIds = {};
    for (const name of result.programs) {
      let row = this.sql.exec("SELECT id FROM programs WHERE name=?", name).toArray()[0];
      if (!row) {
        this.sql.exec("INSERT INTO programs(name, source) VALUES(?, 'kusss')", name);
        row = this.sql.exec("SELECT id FROM programs WHERE name=?", name).toArray()[0];
      }
      programIds[name] = row.id;
    }
    this.sql.exec("DELETE FROM grades WHERE source='kusss'");
    for (const g of result.grades) {
      const key = [g.nr, g.title, g.kind, g.date, g.grade_text].join("|");
      this.sql.exec(`INSERT INTO grades(key, date, nr, title, kind, grade_text, grade, passed, ects, sws, semester, program_id, source, updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?, 'kusss', ?) ON CONFLICT(key) DO NOTHING`,
        key, g.date, g.nr, g.title, g.kind, g.grade_text, g.grade, g.passed === null ? null : g.passed ? 1 : 0,
        g.ects, g.sws, g.semester || (g.date ? semesterOf(g.date) : null), g.program ? programIds[g.program] ?? null : null, now);
    }
    this.setSetting("grades_synced", now);
    this.setSetting("grades_error", null);
  }

  /** Ergebnis eines erfolgreichen JKU-Logins übernehmen: Name, Kalender-Link, Noten. */
  applyJku(r) {
    if (r.name) this.setSetting("kusss_name", r.name);
    if (r.icalUrl && (this.getSetting("ical_source") !== "manual" || !this.getSetting("ical_url"))) {
      this.setSetting("ical_url", r.icalUrl);
      this.setSetting("ical_source", "auto");
    }
    this.storeGrades(r.grades);
    if (r.exams) this.storeExams(r.exams);
  }

  storeExams({ items, diag }) {
    const stamp = new Date().toISOString();
    const utc = (v) => { const m = v && v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/); return m ? viennaToUtc(+m[1], +m[2], +m[3], +m[4], +m[5]).toISOString() : null; };
    this.sql.exec("DELETE FROM exam_regs");
    for (const x of items) {
      const until = utc(x.until);
      if (!until) continue;
      const examDate = utc(x.date);
      this.sql.exec(`INSERT OR REPLACE INTO exam_regs(key, nr, title, exam_date, until, registered, updated_at) VALUES(?,?,?,?,?,?,?)`,
        `${x.nr || x.title}|${examDate || until}`, x.nr, x.title, examDate, until, x.registered ? 1 : 0, stamp);
    }
    this.setSetting("exams_synced", stamp);
    this.setSetting("kusss_exam_diag", diag || null);
  }

  examRegsPayload() {
    return {
      items: this.sql.exec("SELECT * FROM exam_regs WHERE until > ? ORDER BY until", new Date().toISOString()).toArray()
        .map((x) => ({ ...x, registered: !!x.registered })),
      synced: this.getSetting("exams_synced"),
      diag: this.getSetting("kusss_exam_diag"),
    };
  }

  gradesPayload() {
    const grades = this.sql.exec("SELECT * FROM grades ORDER BY COALESCE(date, '') DESC, title").toArray()
      .map((g) => {
        // Ältere Syncs haben "Nicht genügend" mit kaputten Umlauten nicht erkannt: Note aus dem Text neu lesen
        if (g.source === "kusss" && g.grade === null && g.grade_text) {
          const p = parseGrade(g.grade_text);
          if (p.grade !== null || p.passed !== null) Object.assign(g, { grade: p.grade, passed: p.passed === null ? null : p.passed ? 1 : 0 });
        }
        return { ...g, passed: g.passed === null ? null : !!g.passed };
      });
    const counts = new Map(this.sql.exec("SELECT gkey, counted FROM grade_counts").toArray().map((r) => [r.gkey, !!r.counted]));
    for (const g of grades) g.counted = counts.get(g.key || `id:${g.id}`) ?? null;
    const programs = this.sql.exec("SELECT * FROM programs ORDER BY id").toArray();
    return {
      grades, programs,
      synced: this.getSetting("grades_synced"), error: this.getSetting("grades_error"),
      auto: this.uni.auth === "jku",
    };
  }

  // ---------- Auth (RPC aus dem Worker) ----------

  accountLocked() {
    const now = Date.now();
    this.failures = this.failures.filter((t) => now - t < 15 * 60_000);
    return this.failures.length >= ACCOUNT_FAIL_LIMIT;
  }

  /**
   * Anmeldung. JKU: Prüfung direkt gegen das JKU-SSO, dabei wird der KUSSS-Abo-Link geholt.
   * Andere Unis (und JKU, falls das SSO gerade nicht mitspielt): eigenes Studo+-Passwort,
   * das beim ersten Login festgelegt wird.
   * @returns {{ok: true, token: string} | {ok: false, status: number, detail: string}}
   */
  async login({ uni, username, password }) {
    if (this.accountLocked()) return { ok: false, status: 429, detail: "Zu viele Fehlversuche für dieses Konto. Bitte in 15 Minuten erneut probieren." };
    const fail = (status, detail) => { this.failures.push(Date.now()); return { ok: false, status, detail }; };
    const cfg = UNIS[uni];
    const firstLogin = !this.exists;
    let verified = false;
    let notice = null;

    if (cfg.auth === "jku" && this.env.DEMO !== "1") {
      const r = await jkuConnect(username, password);
      if (r.status === "invalid") return fail(401, `JKU-Login abgelehnt: ${r.message}`);
      if (r.status === "ok") {
        verified = true;
        if (this.getSetting("verified") !== "1" && !firstLogin) {
          // Erstmals echt bestätigt: ein evtl. vorher von jemand anderem angelegtes Konto übernehmen
          this.sql.exec("DELETE FROM sessions");
        }
        this.applyJku(r);
        if (!this.getSetting("ical_url")) {
          notice = "Angemeldet, aber der KUSSS-Kalenderlink wurde nicht gefunden. Bitte in den Einstellungen manuell einfügen.";
        }
      } else {
        notice = r.message;
      }
    }

    if (!verified) {
      const hash = this.getSetting("pw_hash");
      if (hash && !(await verifyPassword(password, hash))) return fail(401, "Falsches Passwort.");
    }
    if (verified || firstLogin) this.setSetting("pw_hash", await hashPassword(password));
    if (firstLogin) {
      this.setSetting("uni", uni);
      this.setSetting("username", username);
      this.setSetting("created_at", new Date().toISOString());
      this.setSetting("feed_token", randomToken(24));
    }
    if (verified) this.setSetting("verified", "1");
    this.setSetting("login_notice", notice);

    const token = randomToken();
    const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
    this.sql.exec("INSERT INTO sessions(token_hash, expires_at) VALUES(?,?)", await sha256(token), expires);
    this.sql.exec("DELETE FROM sessions WHERE expires_at < ?", new Date().toISOString());
    const alarm = await this.ctx.storage.getAlarm();
    if (alarm === null || alarm > Date.now() + nextSyncDelay()) await this.ctx.storage.setAlarm(Date.now() + nextSyncDelay());
    this.track("login", { uni, username });
    this.ctx.waitUntil(this.sync().catch(() => {}));
    this.ctx.waitUntil(this.syncMoodle().catch(() => {}));
    if (this.env.DEMO === "1") this.storeExams({ items: demoExamRegs(), diag: null });
    return { ok: true, token, firstLogin };
  }

  async sessionValid(token) {
    if (!token || !this.exists) return false;
    const row = this.sql.exec("SELECT expires_at FROM sessions WHERE token_hash=?", await sha256(token)).toArray()[0];
    return !!row && new Date(row.expires_at) > new Date();
  }

  /** Für den Worker: zu welchem Konto gehört diese Session? */
  async whoami(token) {
    return (await this.sessionValid(token)) ? { key: this.key } : null;
  }

  feedUrls(origin) {
    const https = `${origin}/cal/${this.ctx.id.toString()}/${this.getSetting("feed_token")}.ics`;
    return { https, webcal: https.replace(/^https?:\/\//, "webcal://") };
  }

  // ---------- Feed ----------

  buildFeed() {
    const since = new Date(Date.now() - 30 * 86400_000).toISOString();
    const rows = this.sql.exec(`${EFFECTIVE} WHERE e.start >= ? ORDER BY e.start`, since).toArray();
    const marker = MARKERS[this.getSetting("marker_style", "prefix")] ?? MARKERS.prefix;
    const now = new Date();

    return buildCalendar(`${this.uni.name} · Studo+`, rows.map((r) => {
      const mandatory = !!r.attendance;
      const cancelled = r.status === "cancelled";
      const { tag } = eventTag(r);
      const named = tag && !r.title.toLowerCase().includes(TAGS[tag].toLowerCase()) ? `${TAGS[tag]}: ${r.title}` : r.title;
      let summary = (r.kind ? `${r.kind} ` : "") + named; // LVA-Art immer zuerst, wie in der App
      if (mandatory) summary = marker + summary;
      if (cancelled) summary = "Entfällt: " + summary;
      const notes = [];
      if (tag) notes.push(TAGS[tag]);
      const cats = [tag && TAGS[tag], mandatory && "Anwesenheitspflicht"].filter(Boolean);
      if (mandatory) notes.push("Anwesenheitspflicht");
      if (r.room_raw && r.room_raw !== r.room) notes.push(`Ort laut Uni: ${r.room_raw}`);
      if (r.description) notes.push(r.description);
      return {
        uid: r.uid, summary, start: r.start, end: r.end, stamp: now, lastModified: r.updated_at,
        sequence: r.sequence, status: cancelled ? "CANCELLED" : "CONFIRMED",
        location: formatRoom(r.building, r.room) || null,
        description: notes.length ? notes.join("\n") : null,
        categories: cats.length ? cats : null,
        priority: mandatory || tag ? 1 : null,
      };
    }).concat(this.sql.exec("SELECT * FROM deadlines WHERE done=0 AND due >= ? ORDER BY due", since).toArray().map((d) => ({
      // Moodle-Abgabe als Termin ohne Dauer zum Fälligkeitszeitpunkt
      uid: `moodle-${d.uid}`, summary: `Abgabe: ${d.title}`, start: d.due, end: d.due, stamp: now,
      lastModified: d.updated_at, sequence: 0, status: "CONFIRMED", location: null,
      description: [d.course, d.note].filter(Boolean).join("\n") || null, categories: ["Abgabe"], priority: 1,
    }))).concat(this.sql.exec("SELECT * FROM exam_regs WHERE registered=0 AND until >= ?", since).toArray().map((x) => ({
      // Ende der Prüfungsanmeldung in KUSSS
      uid: `reg-${x.key}@studo.plus`, summary: `Anmeldeschluss: ${x.title}`, start: x.until, end: x.until, stamp: now,
      lastModified: x.updated_at, sequence: 0, status: "CONFIRMED", location: null,
      description: x.exam_date ? `Prüfung: ${viennaWeekday.format(new Date(x.exam_date))} ${viennaTime.format(new Date(x.exam_date))}` : null, categories: ["Anmeldung"], priority: 1,
    }))));
  }

  touch(where, arg) {
    // Geänderte Termine im Feed als neu markieren, damit Kalender-Clients sie übernehmen
    this.sql.exec(`UPDATE events SET sequence=sequence+1, updated_at=? WHERE ${where}`, new Date().toISOString(), arg);
  }

  async deleteAccount() {
    this.track("delete");
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.sql.exec(SCHEMA);
  }

  me(origin) {
    const uniId = this.getSetting("uni");
    return {
      username: this.getSetting("username"),
      uni: { id: uniId, name: this.uni.name, auto: this.uni.auth === "jku", ical_hint: this.uni.icalHint, probe: !!this.uni.probe },
      name: this.getSetting("display_name") || this.getSetting("kusss_name"),
      name_source: this.getSetting("display_name") ? "manual" : this.getSetting("kusss_name") ? "uni" : null,
      avatar: this.getSetting("avatar"),
      matrikel: this.getSetting("matrikel") || matrikel(uniId, this.getSetting("username")),
      verified: this.getSetting("verified") === "1",
      demo: this.env.DEMO === "1",
      connected: !!this.getSetting("ical_url") || this.env.DEMO === "1",
      ical_source: this.getSetting("ical_source"),
      notice: this.getSetting("login_notice"),
      last_sync: this.getSetting("last_sync"),
      last_sync_error: this.getSetting("last_sync_error"),
      marker_style: this.getSetting("marker_style", "prefix"),
      feed: this.feedUrls(origin),
      links: this.uni.links,
      moodle: {
        connected: !!this.getSetting("moodle_url") || this.env.DEMO === "1",
        error: this.getSetting("moodle_error"),
        last_sync: this.getSetting("moodle_sync"),
      },
      mensa: (this.uni.mensa || []).length > 0,
      campus: this.uni.campus || null,
    };
  }

  // ---------- Routing (vom Worker weitergereicht, Session bereits zugeordnet) ----------

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Öffentlich: Abo-Feed (durch geheimes Token geschützt)
    const feed = path.match(/^\/cal\/[0-9a-f]{64}\/([A-Za-z0-9_-]+)\.ics$/);
    if (feed && method === "GET") {
      const token = this.getSetting("feed_token");
      if (!token || !timingSafeEqual(feed[1], token)) return new Response("Not found", { status: 404 });
      this.track("feed");
      return new Response(this.buildFeed(), {
        headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-cache, max-age=0" },
      });
    }

    const session = parseSession(request);
    if (!(await this.sessionValid(session?.token))) return error(401, "Nicht angemeldet");
    if (!this.alarmChecked) {
      // Ältere Konten haben noch den 30-Minuten-Takt: einmal pro Instanz auf den neuen Takt bringen
      this.alarmChecked = true;
      const alarm = await this.ctx.storage.getAlarm();
      if (alarm === null || alarm > Date.now() + nextSyncDelay()) await this.ctx.storage.setAlarm(Date.now() + nextSyncDelay());
    }

    if (path === "/api/logout" && method === "POST") {
      this.sql.exec("DELETE FROM sessions WHERE token_hash=?", await sha256(session.token));
      return json({ ok: true });
    }

    if (path === "/api/me" && method === "GET") {
      this.track("open");
      return json(this.me(url.origin));
    }

    if (path === "/api/settings" && method === "PUT") {
      const body = await request.json().catch(() => ({}));
      if (body.marker_style !== undefined && body.marker_style !== null) {
        if (!(body.marker_style in MARKERS)) return error(422, "Unbekannte Markierung.");
        this.setSetting("marker_style", body.marker_style);
        this.touch("1=?", 1);
      }
      if (typeof body.ical_url === "string") {
        const link = body.ical_url.trim();
        if (link && !/^(https|webcal):\/\//i.test(link)) return error(422, "Bitte den vollständigen https:// oder webcal:// Link einfügen.");
        this.setSetting("ical_url", link || null);
        this.setSetting("ical_source", link ? "manual" : null);
        this.setSetting("login_notice", null);
        if (link) {
          try { await this.sync(); } catch (e) { return error(502, `Sync fehlgeschlagen: ${e.message}`); }
        }
      }
      if (typeof body.moodle_url === "string") {
        const link = body.moodle_url.trim();
        if (link && !isMoodleLink(link)) {
          return error(422, "Das ist kein Moodle-Kalenderlink. Er enthält „calendar/export_execute.php“ und „authtoken“.");
        }
        this.setSetting("moodle_url", link || null);
        this.setSetting("moodle_error", null);
        if (!link) this.sql.exec("DELETE FROM deadlines");
        else {
          try { await this.syncMoodle(); } catch (e) { return error(502, `Moodle-Abgleich fehlgeschlagen: ${e.message}`); }
        }
        this.touch("1=?", 1);
      }
      return json({ ok: true });
    }

    if (path === "/api/deadlines" && method === "GET") return json(this.deadlinesPayload());
    const deadline = path.match(/^\/api\/deadlines\/(.+)$/);
    if (deadline && method === "PUT") {
      const b = await request.json().catch(() => ({}));
      this.sql.exec("UPDATE deadlines SET done=?, updated_at=? WHERE uid=?", b.done ? 1 : 0, new Date().toISOString(), decodeURIComponent(deadline[1]));
      return json(this.deadlinesPayload());
    }

    if (path === "/api/push" && method === "GET") {
      const { publicKey } = await this.vapid();
      return json({ key: publicKey, prefs: this.pushPrefs(), devices: this.sql.exec("SELECT COUNT(*) AS n FROM push_subs").one().n });
    }
    if (path === "/api/push/subscribe" && method === "POST") {
      const { subscription: sub } = await request.json().catch(() => ({}));
      let host;
      try { host = new URL(sub?.endpoint).protocol === "https:"; } catch { host = false; }
      if (!host || !sub.keys?.p256dh || !sub.keys?.auth) return error(422, "Ungültiges Push-Abo.");
      this.sql.exec(`INSERT INTO push_subs(endpoint, p256dh, auth, created_at) VALUES(?,?,?,?)
        ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth`,
        sub.endpoint, String(sub.keys.p256dh), String(sub.keys.auth), new Date().toISOString());
      this.setSetting("app_origin", url.origin);
      return json({ ok: true });
    }
    if (path === "/api/push/unsubscribe" && method === "POST") {
      const { endpoint } = await request.json().catch(() => ({}));
      this.sql.exec("DELETE FROM push_subs WHERE endpoint=?", String(endpoint || ""));
      return json({ ok: true });
    }
    if (path === "/api/push/prefs" && method === "PUT") {
      const b = await request.json().catch(() => ({}));
      for (const k of ["changes", "deadlines", "exams"]) if (typeof b[k] === "boolean") this.setSetting(`push_${k}`, b[k] ? "1" : "0");
      return json(this.pushPrefs());
    }
    if (path === "/api/push/test" && method === "POST") {
      const { endpoint } = await request.json().catch(() => ({}));
      const sent = await this.push([{ title: "Mitteilungen sind aktiv", body: "So erfährst du von Raumänderungen, Ausfällen und nahen Fristen.", tag: "test" }], endpoint || null);
      if (!sent) return error(502, "Die Mitteilung konnte nicht zugestellt werden. Schalte Mitteilungen aus und wieder ein.");
      return json({ sent });
    }

    if (path === "/api/exam-regs" && method === "GET") return json(this.examRegsPayload());

    if (path === "/api/campus" && method === "GET") {
      return json(this.uni.campus === "usi" ? { usi: await usiInfo() } : {});
    }

    if (path === "/api/mensa" && method === "GET") {
      return json({ canteens: this.uni.mensa?.length ? await fetchMensa(this.uni.mensa) : [] });
    }

    // Testmodus: Login des Uni-Systems einmal durchlaufen und nur die Seitenstruktur beschreiben
    if (path === "/api/probe" && method === "POST") {
      if (!this.uni.probe) return error(400, "Für diese Hochschule gibt es keinen Testmodus.");
      const recent = JSON.parse(this.getSetting("probe_times") || "[]").filter((t) => Date.now() - t < 3600_000);
      if (recent.length >= 5) return error(429, "Höchstens 5 Tests pro Stunde. Bitte später erneut probieren.");
      this.setSetting("probe_times", JSON.stringify([...recent, Date.now()]));
      const { username, password } = await request.json().catch(() => ({}));
      if (!username || !password) return error(422, "Benutzername und Passwort angeben.");
      try { return json(await probeLogin(this.uni.probe, String(username), String(password))); }
      catch (e) { return error(502, `Test fehlgeschlagen: ${e.message}`); }
    }

    // JKU: Abo-Link erneut automatisch holen (Passwort wird nur für diesen Vorgang verwendet)
    if (path === "/api/jku/connect" && method === "POST") {
      if (this.uni.auth !== "jku") return error(400, "Nur für die JKU verfügbar.");
      if (this.accountLocked()) return error(429, "Zu viele Fehlversuche. Bitte in 15 Minuten erneut probieren.");
      const { password } = await request.json().catch(() => ({}));
      const r = await jkuConnect(this.getSetting("username"), String(password || ""));
      if (r.status === "invalid") { this.failures.push(Date.now()); return error(401, `JKU-Login abgelehnt: ${r.message}`); }
      if (r.status !== "ok") return error(502, r.message);
      if (!r.icalUrl) return error(502, "Angemeldet, aber in KUSSS wurde kein Kalender-Abo-Link gefunden.");
      this.setSetting("ical_source", null);
      this.applyJku(r);
      this.setSetting("verified", "1");
      this.setSetting("login_notice", null);
      try { return json(await this.sync()); } catch (e) { return error(502, `Sync fehlgeschlagen: ${e.message}`); }
    }

    if (path === "/api/sync" && method === "POST") {
      // Beim Öffnen der App: nur holen, wenn der letzte Abgleich älter als 3 Minuten ist
      if (url.searchParams.get("if_stale")) {
        const last = Date.parse(this.getSetting("last_sync") || 0);
        if (Date.now() - last < 3 * 60_000) return json({ skipped: true });
      }
      const moodle = this.syncMoodle().catch(() => null); // eigener Fehlertext in moodle_error
      try { const r = await this.sync(); await moodle; return json(r); }
      catch (e) { await moodle; return error(502, `Sync fehlgeschlagen: ${e.message}`); }
    }

    if (path === "/api/feed/rotate" && method === "POST") {
      this.setSetting("feed_token", randomToken(24));
      return json(this.feedUrls(url.origin));
    }

    if (path === "/api/account" && method === "DELETE") {
      await this.deleteAccount();
      return json({ ok: true });
    }

    if ((path === "/api/events" || path === "/api/schedule") && method === "GET") { // "schedule": Werbeblocker sperren oft ".../events?"
      const start = url.searchParams.get("start"), end = url.searchParams.get("end");
      if (!start || !end) return error(422, "start und end angeben.");
      const rows = this.sql.exec(`${EFFECTIVE} WHERE e."end" > ? AND e.start < ? ORDER BY e.start`,
        new Date(start).toISOString(), new Date(end).toISOString()).toArray();
      return json(rows.map((r) => ({
        uid: r.uid, course_id: r.course_id, title: r.title, kind: r.kind, start: r.start, end: r.end,
        status: r.status, building: r.building, room: r.room, room_raw: r.room_raw, note: r.description || null,
        location: formatRoom(r.building, r.room), attendance: !!r.attendance,
        is_override: !!r.is_override, course_attendance: !!r.course_attendance, short: r.short || null,
        ...eventTag(r),
      })));
    }

    if (path === "/api/courses" && method === "GET") {
      const now = new Date().toISOString();
      const rows = this.sql.exec(`SELECT c.*, COALESCE(cs.attendance, 0) AS attendance, cs.short AS short,
          (SELECT COUNT(*) FROM events e WHERE e.course_id = c.course_id AND e.status='confirmed') AS n,
          (SELECT MIN(e.start) FROM events e WHERE e.course_id = c.course_id AND e.status='confirmed' AND e.start > ?) AS next_start
        FROM courses c LEFT JOIN course_settings cs ON cs.course_id = c.course_id ORDER BY c.title`, now).toArray();
      const courses = rows.map((r) => ({
        course_id: r.course_id, title: r.title, nr: r.nr, kinds: r.kinds, lecturer: r.lecturer, events: r.n, next_start: r.next_start,
        first_start: r.first_start, last_end: r.last_end,
        semesters: r.semesters ? r.semesters.split(",") : [], attendance: !!r.attendance, short: r.short || null,
      }));
      const semesters = [...new Set(courses.flatMap((c) => c.semesters))].sort((a, b) => semesterKey(b) - semesterKey(a));
      return json({ courses, semesters, current: semesterOf(new Date()) });
    }

    if (path === "/api/profile" && method === "PUT") {
      const body = await request.json().catch(() => ({}));
      if (typeof body.name === "string") this.setSetting("display_name", body.name.trim().slice(0, 80) || null);
      if (typeof body.matrikel === "string") this.setSetting("matrikel", body.matrikel.trim().slice(0, 20) || null);
      if (body.avatar === null) this.setSetting("avatar", null);
      else if (typeof body.avatar === "string") {
        // Profilbild: im Browser auf 256 px verkleinertes JPEG als data:-URL
        if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(body.avatar) || body.avatar.length > 200_000) {
          return error(422, "Bild zu groß oder kein gültiges Bild.");
        }
        this.setSetting("avatar", body.avatar);
      }
      return json(this.me(url.origin));
    }

    if (path === "/api/grades" && method === "GET") return json(this.gradesPayload());

    if (path === "/api/grades/refresh" && method === "POST") {
      if (this.uni.auth !== "jku") return error(400, "Automatische Noten gibt es nur für die JKU.");
      if (this.accountLocked()) return error(429, "Zu viele Fehlversuche. Bitte in 15 Minuten erneut probieren.");
      const { password } = await request.json().catch(() => ({}));
      const r = await jkuConnect(this.getSetting("username"), String(password || ""), undefined, { calendar: false });
      if (r.status === "invalid") { this.failures.push(Date.now()); return error(401, `JKU-Login abgelehnt: ${r.message}`); }
      if (r.status !== "ok") return error(502, r.message);
      this.applyJku(r);
      return json(this.gradesPayload());
    }

    if (path === "/api/grades" && method === "POST") {
      const b = await request.json().catch(() => ({}));
      const title = String(b.title || "").trim().slice(0, 120);
      if (!title) return error(422, "Titel angeben.");
      const grade = [1, 2, 3, 4, 5].includes(+b.grade) ? +b.grade : null;
      const ects = Number.isFinite(+b.ects) && +b.ects >= 0 && +b.ects <= 60 ? +b.ects : null;
      const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || "") ? b.date : null;
      const passed = grade ? grade < 5 : b.passed === false ? 0 : 1;
      this.sql.exec(`INSERT INTO grades(date, title, kind, grade_text, grade, passed, ects, semester, program_id, source, updated_at)
        VALUES(?,?,?,?,?,?,?,?,?, 'manual', ?)`, date, title, b.kind ? String(b.kind).slice(0, 4) : null,
        grade ? String(grade) : passed ? "mit Erfolg" : "ohne Erfolg", grade, passed ? 1 : 0, ects,
        date ? semesterOf(date) : null, b.program_id ? +b.program_id : null, new Date().toISOString());
      return json(this.gradesPayload());
    }

    const gradeId = path.match(/^\/api\/grades\/(\d+)$/);
    if (gradeId && method === "PUT") {
      const b = await request.json().catch(() => ({}));
      if ("program_id" in b) this.sql.exec("UPDATE grades SET program_id=? WHERE id=?", b.program_id ? +b.program_id : null, +gradeId[1]);
      if ("counted" in b) {
        const g = this.sql.exec("SELECT id, key FROM grades WHERE id=?", +gradeId[1]).toArray()[0];
        const gkey = g && (g.key || `id:${g.id}`);
        if (gkey && b.counted === null) this.sql.exec("DELETE FROM grade_counts WHERE gkey=?", gkey);
        else if (gkey) this.sql.exec("INSERT INTO grade_counts(gkey, counted) VALUES(?,?) ON CONFLICT(gkey) DO UPDATE SET counted=excluded.counted", gkey, b.counted ? 1 : 0);
      }
      return json(this.gradesPayload());
    }
    if (gradeId && method === "DELETE") {
      this.sql.exec("DELETE FROM grades WHERE id=? AND source='manual'", +gradeId[1]);
      return json(this.gradesPayload());
    }

    if (path === "/api/programs" && method === "POST") {
      const b = await request.json().catch(() => ({}));
      const name = String(b.name || "").trim().slice(0, 120);
      if (!name) return error(422, "Name der Studienrichtung angeben.");
      this.sql.exec("INSERT INTO programs(name, code, ects_target) VALUES(?,?,?)", name,
        b.code ? String(b.code).slice(0, 20) : null, +b.ects_target > 0 ? +b.ects_target : null);
      return json(this.gradesPayload());
    }
    const programId = path.match(/^\/api\/programs\/(\d+)$/);
    if (programId && method === "PUT") {
      const b = await request.json().catch(() => ({}));
      if (typeof b.name === "string" && b.name.trim()) this.sql.exec("UPDATE programs SET name=? WHERE id=?", b.name.trim().slice(0, 120), +programId[1]);
      if ("code" in b) this.sql.exec("UPDATE programs SET code=? WHERE id=?", b.code ? String(b.code).slice(0, 20) : null, +programId[1]);
      if ("ects_target" in b) this.sql.exec("UPDATE programs SET ects_target=? WHERE id=?", +b.ects_target > 0 ? +b.ects_target : null, +programId[1]);
      return json(this.gradesPayload());
    }
    if (programId && method === "DELETE") {
      this.sql.exec("UPDATE grades SET program_id=NULL WHERE program_id=?", +programId[1]);
      this.sql.exec("DELETE FROM programs WHERE id=?", +programId[1]);
      return json(this.gradesPayload());
    }

    const course = path.match(/^\/api\/courses\/(.+)\/attendance$/);
    if (course && method === "PUT") {
      const id = decodeURIComponent(course[1]);
      const { attendance } = await request.json().catch(() => ({}));
      this.sql.exec("INSERT INTO course_settings(course_id, attendance) VALUES(?,?) ON CONFLICT(course_id) DO UPDATE SET attendance=excluded.attendance", id, attendance ? 1 : 0);
      this.touch("course_id=?", id);
      return json({ ok: true });
    }

    const shortM = path.match(/^\/api\/courses\/(.+)\/short$/);
    if (shortM && method === "PUT") {
      const id = decodeURIComponent(shortM[1]);
      const { short } = await request.json().catch(() => ({}));
      const v = typeof short === "string" ? short.trim().slice(0, 12) || null : null;
      this.sql.exec("INSERT INTO course_settings(course_id, short) VALUES(?,?) ON CONFLICT(course_id) DO UPDATE SET short=excluded.short", id, v);
      return json({ ok: true, short: v });
    }

    const single = path.match(/^\/api\/events\/(.+)\/attendance$/);
    if (single && method === "PUT") {
      const uid = decodeURIComponent(single[1]);
      if (!this.sql.exec("SELECT 1 FROM events WHERE uid=?", uid).toArray().length) return error(404, "Termin nicht gefunden");
      const { attendance } = await request.json().catch(() => ({}));
      if (attendance === null || attendance === undefined) this.sql.exec("DELETE FROM event_overrides WHERE uid=?", uid);
      else this.sql.exec("INSERT INTO event_overrides(uid, attendance) VALUES(?,?) ON CONFLICT(uid) DO UPDATE SET attendance=excluded.attendance", uid, attendance ? 1 : 0);
      this.touch("uid=?", uid);
      return json({ ok: true });
    }

    const tagM = path.match(/^\/api\/events\/(.+)\/tag$/);
    if (tagM && method === "PUT") {
      const uid = decodeURIComponent(tagM[1]);
      const row = this.sql.exec("SELECT title, description FROM events WHERE uid=?", uid).toArray()[0];
      if (!row) return error(404, "Termin nicht gefunden");
      const { tag } = await request.json().catch(() => ({}));
      if (tag != null && tag !== "none" && !TAGS[tag]) return error(422, "Unbekannte Art.");
      // Gleich wie erkannt -> nichts speichern, damit spätere Änderungen in KUSSS durchkommen
      if (tag == null || tag === detectTag(row.title, row.description)) this.sql.exec("DELETE FROM event_tags WHERE uid=?", uid);
      else this.sql.exec("INSERT INTO event_tags(uid, tag) VALUES(?,?) ON CONFLICT(uid) DO UPDATE SET tag=excluded.tag", uid, tag);
      this.touch("uid=?", uid);
      const r = this.sql.exec(`${EFFECTIVE} WHERE e.uid=?`, uid).toArray()[0];
      return json({ ok: true, ...eventTag(r) });
    }

    return error(404, "Unbekannter Endpunkt");
  }
}
