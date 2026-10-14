import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeCtx } from "./helpers/fake-do.mjs";

const { StudoStore, whenText } = await import("../src/store.js");

const H = 3600_000;
function store() {
  const s = new StudoStore(fakeCtx(), { DEMO: "0" });
  s.setSetting("uni", "other"); s.setSetting("username", "x"); s.setSetting("pw_hash", "h");
  s.sql.exec("INSERT INTO push_subs(endpoint,p256dh,auth,created_at) VALUES('https://push.example/1','k','a','now')");
  s.sent = [];
  s.push = async (msgs) => { s.sent.push(...msgs); return msgs.length; };
  return s;
}
const ev = (uid, startMs, extra = {}) => ({
  uid, courseId: "c1", title: "Analysis 1", kind: "VL", lecturer: null,
  start: new Date(startMs), end: new Date(startMs + 1.5 * H), location: "HS 1", description: null, cancelled: false, ...extra,
});

test("whenText: heute/morgen in Wiener Zeit", () => {
  const now = new Date("2026-10-14T08:00:00Z");
  assert.equal(whenText("2026-10-14T12:30:00Z", now), "heute 14:30");
  assert.equal(whenText("2026-10-15T06:30:00Z", now), "morgen 08:30");
});

test("Raumänderung, Zeitänderung und Ausfall werden gemeldet, neue Termine nicht", async () => {
  const s = store();
  const t = Date.now() + 26 * H;
  const first = await s.apply([ev("a", t), ev("b", t + 3 * H), ev("c", t + 6 * H), ev("far", t + 20 * 24 * H)]);
  assert.equal(first.notes.length, 0);
  const second = await s.apply([
    ev("a", t, { location: "HS 2" }),
    ev("b", t + 4 * H),
    ev("c", t + 6 * H, { cancelled: true }),
    ev("far", t + 20 * 24 * H, { location: "HS 9" }),
  ]);
  assert.deepEqual(second.notes.map((n) => n.title), ["Raumänderung: VL Analysis 1", "Zeitänderung: VL Analysis 1", "Entfällt: VL Analysis 1"]);
  assert.match(second.notes[0].body, /jetzt in HS 2 \(statt HS 1\)/);
});

test("Viele verschwundene Termine auf einmal lösen keine Ausfall-Flut aus", async () => {
  const s = store();
  const t = Date.now() + 26 * H;
  await s.apply([1, 2, 3, 4, 5, 6].map((i) => ev(`e${i}`, t + i * H)).concat(ev("keep", t)));
  const r = await s.apply([ev("keep", t)]);
  assert.equal(r.cancelled, 6);
  assert.equal(r.notes.length, 0);
});

test("Erinnerung 24 h vor Abgabe und Klausur, nur einmal", async () => {
  const s = store();
  const now = new Date("2026-10-14T08:00:00Z"); // 10:00 Wien
  s.sql.exec("INSERT INTO deadlines(uid,title,course,due,updated_at) VALUES('d1','Übungsblatt 3','Analysis 1','2026-10-14T21:59:00.000Z','x')");
  s.sql.exec("INSERT INTO deadlines(uid,title,course,due,updated_at) VALUES('d2','Später','X','2026-10-20T21:59:00.000Z','x')");
  s.sql.exec(`INSERT INTO events(uid,course_id,title,kind,start,"end",building,room,status,fingerprint,last_seen,updated_at)
    VALUES('k1','c1','Klausur Lineare Algebra','VL','2026-10-15T06:30:00.000Z','2026-10-15T08:00:00.000Z',null,'HS 1','confirmed','f','x','x')`);
  await s.remind(now);
  assert.deepEqual(s.sent.map((m) => [m.title, m.body]), [
    ["Abgabe heute 23:59", "Übungsblatt 3 · Analysis 1"],
    ["Klausur morgen 08:30", "Klausur Lineare Algebra · HS 1"],
  ]);
  await s.remind(new Date(now.getTime() + 600_000));
  assert.equal(s.sent.length, 2);
  s.setSetting("push_exams", "0");
  s.sql.exec("DELETE FROM push_log");
  s.sent = [];
  await s.remind(now);
  assert.deepEqual(s.sent.map((m) => m.title), ["Abgabe heute 23:59"]);
});

test("Nachts keine Erinnerungen", async () => {
  const s = store();
  s.sql.exec("INSERT INTO deadlines(uid,title,due,updated_at) VALUES('d1','A','2026-10-14T10:00:00.000Z','x')");
  await s.remind(new Date("2026-10-14T02:00:00Z")); // 04:00 Wien
  assert.equal(s.sent.length, 0);
});

test("Sync-Takt: tagsüber 10 Minuten, nachts 60", async () => {
  const { nextSyncDelay } = await import("../src/store.js");
  assert.equal(nextSyncDelay(new Date("2026-10-14T10:00:00Z")), 10 * 60_000);
  assert.equal(nextSyncDelay(new Date("2026-10-14T23:00:00Z")), 60 * 60_000);
});

test("Erinnerung 48 h vor Ende der Prüfungsanmeldung, nur wenn nicht angemeldet", async () => {
  const s = store();
  const now = new Date("2026-10-14T08:00:00Z");
  s.storeExams({ items: [
    { nr: "1", title: "Analysis 1", date: "2026-10-30T08:30", until: "2026-10-15T23:59", registered: false },
    { nr: "2", title: "Statistik", date: "2026-10-30T08:30", until: "2026-10-15T23:59", registered: true },
  ], diag: null });
  await s.remind(now);
  assert.deepEqual(s.sent.map((m) => [m.title, m.body]), [["Anmeldung endet morgen 23:59", "Analysis 1 · Prüfung Fr., 30.10. 08:30"]]);
});
