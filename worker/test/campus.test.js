import { test } from "node:test";
import assert from "node:assert/strict";
import { holidays, parseNews, parseNotices, usiStatus } from "../src/campus.js";

// Wiener Zeit = UTC+2 im Oktober (Sommerzeit bis 25.10.2026)
const at = (iso) => new Date(iso);

test("Feiertage inkl. beweglicher (Ostern 2027 = 28.3.)", () => {
  const h = holidays(2027);
  for (const d of ["2027-01-01", "2027-03-29", "2027-05-06", "2027-05-17", "2027-05-27", "2027-10-26", "2027-12-08"]) assert.ok(h.has(d), d);
  assert.ok(!h.has("2027-03-28"));
});

test("Fitnessstudio offen/zu", () => {
  assert.deepEqual(usiStatus(at("2026-10-14T08:00:00Z")).gym, { open: true, text: "Offen bis 21:00" }); // Mi 10:00
  assert.deepEqual(usiStatus(at("2026-10-14T04:00:00Z")).gym, { open: false, text: "Öffnet um 8:00" });
  assert.deepEqual(usiStatus(at("2026-10-14T19:30:00Z")).gym, { open: false, text: "Öffnet morgen um 8:00" }); // 21:30
  assert.deepEqual(usiStatus(at("2026-10-14T08:00:00Z"), new Set(["2026-10-14"])).gym, { open: false, text: "Heute geschlossen" });
});

test("Sauna: heute, offen, nächster Tag, Feiertag, Sommer", () => {
  assert.equal(usiStatus(at("2026-10-14T08:00:00Z")).sauna.text, "Heute 16–20 Uhr · Damen"); // Mi
  assert.deepEqual(usiStatus(at("2026-10-15T15:00:00Z")).sauna, { open: true, text: "Offen bis 20:00 · gemischt" }); // Do 17:00
  assert.equal(usiStatus(at("2026-10-15T19:00:00Z")).sauna.text, "Di 16–20 Uhr · Herren"); // Do 21:00 -> nächster Di
  assert.equal(usiStatus(at("2026-10-26T08:00:00Z")).sauna.text, "Morgen 16–20 Uhr · Herren"); // Mo Nationalfeiertag
  assert.equal(usiStatus(at("2026-07-14T08:00:00Z")).sauna.text, "Im Sommer zu, ab Oktober wieder offen");
});

test("Hinweise von der USI-Seite", () => {
  const html = `<p>Öffnungszeiten</p><div><strong>Donnerstag, 08. Oktober 2026 komplett geschlossen!</strong> Wegen 60 Jahre JKU.</div>
    <p>Am 8.12. ist die Sauna geschlossen.</p><p>Alter Hinweis: 01.09.2026 geschlossen.</p>`;
  const n = parseNotices(html, at("2026-10-05T08:00:00Z"));
  assert.deepEqual(n.map((x) => [x.date, x.closed]), [["2026-10-08", true]]);
  const later = parseNotices(html, at("2026-11-20T08:00:00Z"));
  assert.deepEqual(later.map((x) => x.date), ["2026-12-08"]);
});

test("News: Titel, Datum, Link", () => {
  const html = `<div class="news"><span>10.06.2026</span> News <a href="/campus/freizeit/usi-sportangebot/news-events/detail/news/campus-run/"><img></a>
    <h2><a href="/campus/freizeit/usi-sportangebot/news-events/detail/news/campus-run/">Teilnehmer*innen-Rekord beim JKU Campus Run 2026</a></h2>
    <a href="/campus/freizeit/usi-sportangebot/news-events/detail/news/campus-run/">Zum Artikel</a></div>
    <div><span>27.11.2025</span><h2><a href="/campus/x/detail/news/volleyball/">UAM Volleyball Mixed 2025</a></h2></div>`;
  assert.deepEqual(parseNews(html), [
    { title: "Teilnehmer*innen-Rekord beim JKU Campus Run 2026", url: "https://www.jku.at/campus/freizeit/usi-sportangebot/news-events/detail/news/campus-run/", date: "2026-06-10" },
    { title: "UAM Volleyball Mixed 2025", url: "https://www.jku.at/campus/x/detail/news/volleyball/", date: "2025-11-27" },
  ]);
});
