// Zentrale Übersicht über alle Konten (für das Admin-Dashboard) und das globale
// Login-Rate-Limit. Hier liegen nur Nutzungszahlen und der Anzeigename, keine Termine und keine Links.

import { DurableObject } from "cloudflare:workers";
import { generateVapid } from "./webpush.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  key TEXT PRIMARY KEY, uni TEXT NOT NULL, username TEXT NOT NULL, created_at TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0, connected INTEGER NOT NULL DEFAULT 0, events INTEGER NOT NULL DEFAULT 0,
  logins INTEGER NOT NULL DEFAULT 0, last_login TEXT,
  opens INTEGER NOT NULL DEFAULT 0, last_open TEXT,
  syncs INTEGER NOT NULL DEFAULT 0, sync_errors INTEGER NOT NULL DEFAULT 0, last_sync TEXT,
  feed_hits INTEGER NOT NULL DEFAULT 0, last_feed TEXT
);
CREATE TABLE IF NOT EXISTS daily (day TEXT NOT NULL, metric TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY(day, metric));
CREATE TABLE IF NOT EXISTS failures (ip TEXT NOT NULL, ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_fail_ip ON failures(ip, ts);
`;

// Welche Spalten ein Ereignis hochzählt
const EVENTS = {
  login: ["logins", "last_login"],
  open: ["opens", "last_open"],
  sync: ["syncs", "last_sync"],
  sync_error: ["sync_errors", null],
  feed: ["feed_hits", "last_feed"],
};

const FAIL_WINDOW = 15 * 60_000;
const FAIL_LIMIT = 10;

export class Registry extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(SCHEMA);
      try { this.sql.exec("ALTER TABLE users ADD COLUMN name TEXT"); } catch { /* Spalte gibt es schon */ }
    });
  }

  // ---------- Rate-Limit (pro IP, über alle Konten) ----------

  /** Gemeinsames VAPID-Schlüsselpaar für Push-Mitteilungen, wird beim ersten Bedarf erzeugt. */
  async vapid() {
    let v = await this.ctx.storage.get("vapid");
    if (!v) { v = await generateVapid(); await this.ctx.storage.put("vapid", v); }
    return v;
  }

  isBlocked(ip) {
    const since = Date.now() - FAIL_WINDOW;
    this.sql.exec("DELETE FROM failures WHERE ts < ?", since);
    return this.sql.exec("SELECT COUNT(*) AS n FROM failures WHERE ip=? AND ts>=?", ip, since).one().n >= FAIL_LIMIT;
  }

  recordFailure(ip) {
    this.sql.exec("INSERT INTO failures(ip, ts) VALUES(?,?)", ip, Date.now());
  }

  // ---------- Nutzung ----------

  /** event: login|open|sync|sync_error|feed|delete; info: {uni, username, verified, connected, events} */
  track(key, event, info = {}) {
    const now = new Date().toISOString();
    if (event === "delete") { this.sql.exec("DELETE FROM users WHERE key=?", key); return; }
    const [uni, username] = key.split(":");
    this.sql.exec(`INSERT INTO users(key, uni, username, created_at) VALUES(?,?,?,?) ON CONFLICT(key) DO NOTHING`,
      key, info.uni || uni, info.username || username, now);
    const [count, last] = EVENTS[event] || [];
    if (count) this.sql.exec(`UPDATE users SET ${count}=${count}+1${last ? `, ${last}=?` : ""} WHERE key=?`, ...(last ? [now] : []), key);
    if (info.name !== undefined) this.sql.exec("UPDATE users SET name=? WHERE key=?", info.name || null, key);
    for (const col of ["verified", "connected", "events"]) {
      if (info[col] !== undefined) this.sql.exec(`UPDATE users SET ${col}=? WHERE key=?`, Number(info[col]) || 0, key);
    }
    if (EVENTS[event]) {
      this.sql.exec(`INSERT INTO daily(day, metric, n) VALUES(?,?,1) ON CONFLICT(day, metric) DO UPDATE SET n=n+1`,
        now.slice(0, 10), event);
    }
  }

  overview() {
    const now = Date.now();
    const iso = (ms) => new Date(ms).toISOString();
    const users = this.sql.exec(`SELECT * FROM users ORDER BY
      MAX(COALESCE(last_open,''), COALESCE(last_login,''), COALESCE(last_feed,'')) DESC LIMIT 1000`).toArray();
    const active = (days) => users.filter((u) =>
      [u.last_open, u.last_login, u.last_feed].some((t) => t && t >= iso(now - days * 86400_000))).length;
    const sum = (col) => users.reduce((s, u) => s + (u[col] || 0), 0);

    const since = iso(now - 13 * 86400_000).slice(0, 10);
    const rows = this.sql.exec("SELECT day, metric, n FROM daily WHERE day >= ? ORDER BY day", since).toArray();
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const day = iso(now - i * 86400_000).slice(0, 10);
      const pick = (m) => rows.find((r) => r.day === day && r.metric === m)?.n || 0;
      days.push({ day, logins: pick("login"), opens: pick("open"), feed: pick("feed"), syncs: pick("sync") });
    }
    const byUni = {};
    for (const u of users) byUni[u.uni] = (byUni[u.uni] || 0) + 1;

    return {
      totals: {
        users: users.length, active_1d: active(1), active_7d: active(7), active_30d: active(30),
        connected: users.filter((u) => u.connected).length,
        logins: sum("logins"), opens: sum("opens"), feed_hits: sum("feed_hits"), syncs: sum("syncs"),
      },
      by_uni: byUni,
      days,
      users: users.map((u) => ({
        uni: u.uni, username: u.username, name: u.name || null, created_at: u.created_at, verified: !!u.verified, connected: !!u.connected,
        events: u.events, logins: u.logins, last_login: u.last_login, opens: u.opens, last_open: u.last_open,
        syncs: u.syncs, sync_errors: u.sync_errors, last_sync: u.last_sync, feed_hits: u.feed_hits, last_feed: u.last_feed,
      })),
    };
  }
}
