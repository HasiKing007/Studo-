// Ein Durable Object pro Konto ("<uni>:<benutzer>") mit eigener SQLite-Datenbank:
// Termine, Schalter, Einstellungen, Sessions. Ein Alarm gleicht alle 30 Minuten mit dem
// Uni-Kalender ab, auch wenn niemand die App öffnet. Nutzungszahlen gehen an die Registry.

import { DurableObject } from "cloudflare:workers";
import { buildCalendar, parseICS } from "./ical.js";
import { formatRoom, parseRoom } from "./rooms.js";
import { demoEvents } from "./demo.js";
import { jkuConnect, parseGrade } from "./jku.js";
import { UNIS, matrikel } from "./unis.js";
import { error, hashPassword, json, parseSession, randomToken, sha256, timingSafeEqual, verifyPassword } from "./util.js";

const SYNC_MINUTES = 30;
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
`;

const EFFECTIVE = `
SELECT e.*, COALESCE(o.attendance, cs.attendance, 0) AS attendance,
       o.attendance IS NOT NULL AS is_override, COALESCE(cs.attendance, 0) AS course_attendance
FROM events e
LEFT JOIN event_overrides o ON o.uid = e.uid
LEFT JOIN course_settings cs ON cs.course_id = e.course_id`;

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

export class StudoStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.failures = [];
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(SCHEMA);
      try { this.sql.exec("ALTER TABLE courses ADD COLUMN lecturer TEXT"); } catch { /* Spalte gibt es schon */ }
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
      ...info,
    }).catch((e) => console.warn("Registry:", e.message)));
  }

  // ---------- Hintergrund-Sync ----------

  async alarm() {
    if (!this.exists) return; // gelöschtes oder nie angelegtes Konto: nicht weiterlaufen
    try { await this.sync(); } catch (e) { console.warn("Sync fehlgeschlagen:", e.message); }
    finally { await this.ctx.storage.setAlarm(Date.now() + SYNC_MINUTES * 60_000); }
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
        });
        if (!res.ok) throw new Error(`Der Uni-Server antwortet mit HTTP ${res.status}`);
        const text = await res.text();
        if (!text.slice(0, 2000).includes("BEGIN:VCALENDAR")) throw new Error("Antwort ist kein iCal. Ist der Link noch gültig?");
        events = parseICS(text);
      } catch (e) {
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
    return stats;
  }

  room(raw) {
    return this.uni.rooms === "jku" ? parseRoom(raw) : [null, raw ? raw.replace(/\\,/g, ",").trim() : null];
  }

  /** Abgleich mit Änderungserkennung (Fingerprint -> SEQUENCE+1) und Ausfall-Erkennung. */
  async apply(events) {
    const now = new Date();
    const stamp = now.toISOString();
    const stats = { new: 0, changed: 0, cancelled: 0, total: events.length };
    const seen = new Set();

    for (const e of events) {
      const [building, room] = this.room(e.location);
      const fp = await sha256([e.title, e.kind, e.start.toISOString(), e.end.toISOString(), building, room, e.cancelled].join("|"));
      seen.add(e.uid);
      const row = this.sql.exec("SELECT fingerprint, sequence FROM events WHERE uid=?", e.uid).toArray()[0];
      const v = [e.courseId, e.title, e.kind, e.start.toISOString(), e.end.toISOString(), e.location, building, room,
        e.description, e.cancelled ? "cancelled" : "confirmed", fp, stamp, stamp];
      if (!row) {
        this.sql.exec(`INSERT INTO events(course_id,title,kind,start,"end",room_raw,building,room,description,status,
          fingerprint,last_seen,updated_at,uid,sequence) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`, ...v, e.uid);
        stats.new++;
      } else if (row.fingerprint !== fp) {
        this.sql.exec(`UPDATE events SET course_id=?,title=?,kind=?,start=?,"end"=?,room_raw=?,building=?,room=?,
          description=?,status=?,fingerprint=?,last_seen=?,updated_at=?,sequence=sequence+1 WHERE uid=?`, ...v, e.uid);
        stats.changed++;
      } else {
        this.sql.exec("UPDATE events SET last_seen=? WHERE uid=?", stamp, e.uid);
      }
    }

    // Zukünftige Termine, die nicht mehr geliefert werden -> als entfallen markieren
    for (const { uid } of this.sql.exec("SELECT uid FROM events WHERE start > ? AND status='confirmed'", stamp).toArray()) {
      if (!seen.has(uid)) {
        this.sql.exec("UPDATE events SET status='cancelled', sequence=sequence+1, updated_at=? WHERE uid=?", stamp, uid);
        stats.cancelled++;
      }
    }
    this.updateCourses(events);
    // Aufräumen: Termine, die älter als ein Semester sind
    this.sql.exec(`DELETE FROM events WHERE "end" < ?`, new Date(now - 180 * 86400_000).toISOString());

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
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + SYNC_MINUTES * 60_000);
    this.track("login", { uni, username });
    this.ctx.waitUntil(this.sync().catch(() => {}));
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
      let summary = (r.kind ? `${r.kind} ` : "") + r.title; // LVA-Art immer zuerst
      if (mandatory) summary = marker + summary;
      if (cancelled) summary = "Entfällt: " + summary;
      const notes = [];
      if (mandatory) notes.push("Anwesenheitspflicht");
      if (r.room_raw && r.room_raw !== r.room) notes.push(`Ort laut Uni: ${r.room_raw}`);
      if (r.description) notes.push(r.description);
      return {
        uid: r.uid, summary, start: r.start, end: r.end, stamp: now, lastModified: r.updated_at,
        sequence: r.sequence, status: cancelled ? "CANCELLED" : "CONFIRMED",
        location: formatRoom(r.building, r.room) || null,
        description: notes.length ? notes.join("\n") : null,
        categories: mandatory ? ["Anwesenheitspflicht"] : null,
        priority: mandatory ? 1 : null,
      };
    }));
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
      uni: { id: uniId, name: this.uni.name, auto: this.uni.auth === "jku", ical_hint: this.uni.icalHint },
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
      return json({ ok: true });
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
      try { return json(await this.sync()); } catch (e) { return error(502, `Sync fehlgeschlagen: ${e.message}`); }
    }

    if (path === "/api/feed/rotate" && method === "POST") {
      this.setSetting("feed_token", randomToken(24));
      return json(this.feedUrls(url.origin));
    }

    if (path === "/api/account" && method === "DELETE") {
      await this.deleteAccount();
      return json({ ok: true });
    }

    if (path === "/api/events" && method === "GET") {
      const start = url.searchParams.get("start"), end = url.searchParams.get("end");
      if (!start || !end) return error(422, "start und end angeben.");
      const rows = this.sql.exec(`${EFFECTIVE} WHERE e."end" > ? AND e.start < ? ORDER BY e.start`,
        new Date(start).toISOString(), new Date(end).toISOString()).toArray();
      return json(rows.map((r) => ({
        uid: r.uid, course_id: r.course_id, title: r.title, kind: r.kind, start: r.start, end: r.end,
        status: r.status, building: r.building, room: r.room, room_raw: r.room_raw,
        location: formatRoom(r.building, r.room), attendance: !!r.attendance,
        is_override: !!r.is_override, course_attendance: !!r.course_attendance,
      })));
    }

    if (path === "/api/courses" && method === "GET") {
      const now = new Date().toISOString();
      const rows = this.sql.exec(`SELECT c.*, COALESCE(cs.attendance, 0) AS attendance,
          (SELECT COUNT(*) FROM events e WHERE e.course_id = c.course_id AND e.status='confirmed') AS n,
          (SELECT MIN(e.start) FROM events e WHERE e.course_id = c.course_id AND e.status='confirmed' AND e.start > ?) AS next_start
        FROM courses c LEFT JOIN course_settings cs ON cs.course_id = c.course_id ORDER BY c.title`, now).toArray();
      const courses = rows.map((r) => ({
        course_id: r.course_id, title: r.title, nr: r.nr, kinds: r.kinds, lecturer: r.lecturer, events: r.n, next_start: r.next_start,
        first_start: r.first_start, last_end: r.last_end,
        semesters: r.semesters ? r.semesters.split(",") : [], attendance: !!r.attendance,
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

    return error(404, "Unbekannter Endpunkt");
  }
}
