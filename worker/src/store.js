// Das "Gehirn" von Studo+: ein Durable Object mit eigener SQLite-Datenbank.
// Es gibt genau eine Instanz ("main"), weil die App für genau einen Nutzer gedacht ist.
// Ein Alarm stößt alle 30 Minuten den Abgleich mit KUSSS an, auch wenn niemand die App öffnet.

import { DurableObject } from "cloudflare:workers";
import { buildCalendar, parseICS } from "./ical.js";
import { formatRoom, parseRoom } from "./rooms.js";
import { demoEvents } from "./demo.js";

const SYNC_MINUTES = 30;
const SESSION_DAYS = 30;
const COOKIE = "studo_session";
// PBKDF2-Runden für das App-Passwort. Zusammen mit dem Rate-Limit (5 Versuche / 15 min)
// ausreichend für eine Ein-Personen-App und schnell genug für die Gratis-Limits.
const PBKDF2_ITERATIONS = 100_000;

const QUICK_LINKS = [
  { id: "kusss", name: "KUSSS", url: "https://www.kusss.jku.at/kusss/index.action", icon: "grid" },
  { id: "moodle", name: "Moodle", url: "https://moodle.jku.at/", icon: "book" },
  { id: "mail", name: "JKU-Mail", url: "https://outlook.office.com/mail/", icon: "mail" },
];

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
`;

const EFFECTIVE = `
SELECT e.*, COALESCE(o.attendance, cs.attendance, 0) AS attendance,
       o.attendance IS NOT NULL AS is_override, COALESCE(cs.attendance, 0) AS course_attendance
FROM events e
LEFT JOIN event_overrides o ON o.uid = e.uid
LEFT JOIN course_settings cs ON cs.course_id = e.course_id`;

// ---------- Hilfen ----------

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (h) => new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16)));

function randomToken(bytes = 32) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(text) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${PBKDF2_ITERATIONS}$${hex(salt)}$${await pbkdf2(password, salt, PBKDF2_ITERATIONS)}`;
}

async function verifyPassword(password, stored) {
  const [, iter, salt, dk] = stored.split("$");
  const candidate = await pbkdf2(password, fromHex(salt), +iter);
  return timingSafeEqual(candidate, dk);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } });
const error = (status, detail) => json({ detail }, status);

function getCookie(request, name) {
  const m = (request.headers.get("Cookie") || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : null;
}

// ---------- Durable Object ----------

export class StudoStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.failed = new Map();
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(SCHEMA);
      if (!this.getSetting("feed_token")) this.setSetting("feed_token", randomToken(24));
      if ((await ctx.storage.getAlarm()) === null) await ctx.storage.setAlarm(Date.now() + 60_000);
    });
  }

  getSetting(key, fallback = null) {
    return this.sql.exec("SELECT value FROM settings WHERE key=?", key).toArray()[0]?.value ?? fallback;
  }

  setSetting(key, value) {
    if (value === null || value === undefined) this.sql.exec("DELETE FROM settings WHERE key=?", key);
    else this.sql.exec("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", key, String(value));
  }

  // ---------- Hintergrund-Sync ----------

  async alarm() {
    try { await this.sync(); } catch (e) { console.warn("Sync fehlgeschlagen:", e.message); }
    finally { await this.ctx.storage.setAlarm(Date.now() + SYNC_MINUTES * 60_000); }
  }

  async sync() {
    const url = this.getSetting("ical_url");
    let events;
    if (!url && this.env.DEMO === "1") {
      events = demoEvents();
    } else if (!url) {
      throw new Error("Kein Kalender verbunden. Hinterlege den KUSSS-iCal-Link in den Einstellungen.");
    } else {
      try {
        const res = await fetch(url.trim().replace(/^webcal:\/\//i, "https://"), {
          headers: { "User-Agent": "StudoPlus/0.1 (private use)" }, redirect: "follow",
        });
        if (!res.ok) throw new Error(`KUSSS antwortet mit HTTP ${res.status}`);
        const text = await res.text();
        if (!text.slice(0, 2000).includes("BEGIN:VCALENDAR")) throw new Error("Antwort ist kein iCal. Ist der Link noch gültig?");
        events = parseICS(text);
      } catch (e) {
        this.setSetting("last_sync_error", e.message);
        throw e;
      }
    }
    return this.apply(events);
  }

  /** Abgleich mit Änderungserkennung (Fingerprint -> SEQUENCE+1) und Ausfall-Erkennung. */
  async apply(events) {
    const now = new Date();
    const stamp = now.toISOString();
    const stats = { new: 0, changed: 0, cancelled: 0, total: events.length };
    const seen = new Set();

    for (const e of events) {
      const [building, room] = parseRoom(e.location);
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
    // Aufräumen: Termine, die älter als ein Semester sind
    this.sql.exec(`DELETE FROM events WHERE "end" < ?`, new Date(now - 180 * 86400_000).toISOString());

    this.setSetting("last_sync", stamp);
    this.setSetting("last_sync_error", null);
    return stats;
  }

  // ---------- Auth ----------

  rateLimit(ip) {
    const now = Date.now();
    const recent = (this.failed.get(ip) || []).filter((t) => now - t < 15 * 60_000);
    this.failed.set(ip, recent);
    return recent.length >= 5;
  }

  async login(body, ip) {
    if (this.rateLimit(ip)) return error(429, "Zu viele Fehlversuche. Bitte in 15 Minuten erneut probieren.");
    const username = String(body.username || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (username.length < 2 || !password) return error(422, "Benutzername und Passwort angeben.");

    const owner = this.getSetting("owner_username");
    const hash = this.getSetting("owner_pw_hash");
    const fail = (status, msg) => { this.failed.get(ip).push(Date.now()); return error(status, msg); };

    if (owner && owner !== username) return fail(403, "Diese Instanz ist bereits mit einem anderen Account verknüpft.");
    if (owner && hash && !(await verifyPassword(password, hash))) return fail(401, "Falsches Passwort.");
    if (!owner) {
      // Erster Login richtet die Instanz ein und legt das App-Passwort fest.
      this.setSetting("owner_username", username);
      this.setSetting("owner_pw_hash", await hashPassword(password));
    }

    const token = randomToken();
    const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
    this.sql.exec("INSERT INTO sessions(token_hash, expires_at) VALUES(?,?)", await sha256(token), expires);
    this.sql.exec("DELETE FROM sessions WHERE expires_at < ?", new Date().toISOString());
    this.ctx.waitUntil(this.sync().catch(() => {}));
    return json({ username }, 200, {
      "Set-Cookie": `${COOKIE}=${token}; Max-Age=${SESSION_DAYS * 86400}; Path=/; HttpOnly; Secure; SameSite=Strict`,
    });
  }

  async currentUser(request) {
    const token = getCookie(request, COOKIE);
    if (!token) return null;
    const row = this.sql.exec("SELECT expires_at FROM sessions WHERE token_hash=?", await sha256(token)).toArray()[0];
    if (!row || new Date(row.expires_at) < new Date()) return null;
    return this.getSetting("owner_username") || "";
  }

  feedUrls(origin) {
    const https = `${origin}/cal/${this.getSetting("feed_token")}.ics`;
    return { https, webcal: https.replace(/^https?:\/\//, "webcal://") };
  }

  // ---------- Feed ----------

  buildFeed() {
    const since = new Date(Date.now() - 30 * 86400_000).toISOString();
    const rows = this.sql.exec(`${EFFECTIVE} WHERE e.start >= ? ORDER BY e.start`, since).toArray();
    const marker = MARKERS[this.getSetting("marker_style", "prefix")] ?? MARKERS.prefix;
    const now = new Date();

    return buildCalendar("JKU Stundenplan", rows.map((r) => {
      const mandatory = !!r.attendance;
      const cancelled = r.status === "cancelled";
      let summary = r.title + (r.kind ? ` (${r.kind})` : "");
      if (mandatory) summary = marker + summary;
      if (cancelled) summary = "Entfällt: " + summary;
      const notes = [];
      if (mandatory) notes.push("Anwesenheitspflicht");
      if (r.room_raw && r.room_raw !== r.room) notes.push(`Ort laut KUSSS: ${r.room_raw}`);
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

  // ---------- Routing ----------

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const ip = request.headers.get("CF-Connecting-IP") || "?";

    // Öffentlich: Abo-Feed (durch geheimes Token geschützt)
    const feed = path.match(/^\/cal\/([A-Za-z0-9_-]+)\.ics$/);
    if (feed && method === "GET") {
      if (!timingSafeEqual(feed[1], this.getSetting("feed_token") || "")) return new Response("Not found", { status: 404 });
      return new Response(this.buildFeed(), {
        headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-cache, max-age=0" },
      });
    }

    if (path === "/api/login" && method === "POST") return this.login(await request.json().catch(() => ({})), ip);

    if (path === "/api/logout" && method === "POST") {
      const token = getCookie(request, COOKIE);
      if (token) this.sql.exec("DELETE FROM sessions WHERE token_hash=?", await sha256(token));
      return json({ ok: true }, 200, { "Set-Cookie": `${COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict` });
    }

    // Ab hier nur angemeldet
    const user = await this.currentUser(request);
    if (user === null) return error(401, "Nicht angemeldet");

    if (path === "/api/me" && method === "GET") {
      return json({
        username: user,
        demo: this.env.DEMO === "1",
        connected: !!this.getSetting("ical_url") || this.env.DEMO === "1",
        sync_password_stored: false,
        last_sync: this.getSetting("last_sync"),
        last_sync_error: this.getSetting("last_sync_error"),
        marker_style: this.getSetting("marker_style", "prefix"),
        feed: this.feedUrls(url.origin),
        links: QUICK_LINKS,
      });
    }

    if (path === "/api/settings" && method === "PUT") {
      const body = await request.json().catch(() => ({}));
      if (body.marker_style !== undefined && body.marker_style !== null) {
        if (!(body.marker_style in MARKERS)) return error(422, "Unbekannte Markierung.");
        this.setSetting("marker_style", body.marker_style);
      }
      if (typeof body.ical_url === "string") {
        const link = body.ical_url.trim();
        if (link && !/^(https|webcal):\/\//i.test(link)) return error(422, "Bitte den vollständigen https:// oder webcal:// Link einfügen.");
        this.setSetting("ical_url", link || null);
        if (link) {
          try { await this.sync(); } catch (e) { return error(502, `Sync fehlgeschlagen: ${e.message}`); }
        }
      }
      return json({ ok: true });
    }

    if (path === "/api/sync" && method === "POST") {
      try { return json(await this.sync()); } catch (e) { return error(502, `Sync fehlgeschlagen: ${e.message}`); }
    }

    if (path === "/api/feed/rotate" && method === "POST") {
      this.setSetting("feed_token", randomToken(24));
      return json(this.feedUrls(url.origin));
    }

    if (path === "/api/disconnect" && method === "POST") {
      for (const k of ["ical_url", "owner_username", "owner_pw_hash", "last_sync", "last_sync_error"]) this.setSetting(k, null);
      this.setSetting("feed_token", randomToken(24)); // alter Abo-Link wird ungültig
      this.sql.exec("DELETE FROM sessions");
      return json({ ok: true }, 200, { "Set-Cookie": `${COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict` });
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
