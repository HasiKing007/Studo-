import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCalendar, cleanTitle, parseICS, viennaToUtc } from "../src/ical.js";
import { parseRoom } from "../src/rooms.js";

test("Raum-Parser", () => {
  assert.deepEqual(parseRoom("HS 1"), ["Hörsaaltrakt", "HS 1"]);
  assert.deepEqual(parseRoom("K 224B"), ["Keplergebäude", "K 224B"]);
  assert.deepEqual(parseRoom("S3 055"), ["Science Park 3", "S3 055"]);
  assert.deepEqual(parseRoom("S2 Z74"), ["Science Park 2", "S2 Z74"]);
  assert.deepEqual(parseRoom("K 269D"), ["Keplergebäude", "K 269D"]);
  assert.deepEqual(parseRoom("t 911"), ["TNF-Turm", "T 911"]);
  assert.deepEqual(parseRoom("ESH 1"), [null, "ESH 1"]);
  assert.equal(parseRoom("Online (Zoom)")[0], "Online");
  assert.deepEqual(parseRoom("XYZ irgendwo"), [null, "XYZ irgendwo"]);
  assert.deepEqual(parseRoom(null), [null, null]);
});

test("Titel bereinigen", () => {
  assert.deepEqual(cleanTitle("336.100 VL Analysis 1"), { title: "Analysis 1", kind: "VL", nr: "336.100", lecturer: null });
  assert.deepEqual(cleanTitle("Analysis 1 / UE / 336.101"), { title: "Analysis 1", kind: "UE", nr: "336.101", lecturer: null });
  assert.deepEqual(cleanTitle("Mathe"), { title: "Mathe", kind: null, nr: null, lecturer: null });
  assert.deepEqual(cleanTitle("KS Einführung in die Medienpsychologie / Andrea Wisenöcker / (232427/2026W)"),
    { title: "Einführung in die Medienpsychologie", kind: "KS", nr: "232.427", lecturer: "Andrea Wisenöcker" });
});

test("Wiener Zeit inkl. Sommer-/Winterzeit", () => {
  assert.equal(viennaToUtc(2026, 10, 14, 8, 30).toISOString(), "2026-10-14T06:30:00.000Z"); // Sommerzeit
  assert.equal(viennaToUtc(2026, 11, 4, 8, 30).toISOString(), "2026-11-04T07:30:00.000Z"); // Winterzeit
});

test("iCal parsen (gefaltete Zeilen, Escapes, UTC)", () => {
  const raw = [
    "BEGIN:VCALENDAR", "VERSION:2.0",
    "BEGIN:VEVENT", "UID:abc@kusss", "SUMMARY:336.100 VL Analysis 1",
    "DTSTART;TZID=Europe/Vienna:20261014T083000", "DTEND;TZID=Europe/Vienna:20261014T100000",
    "LOCATION:Keplergebäude\\, HS 1", "DESCRIPTION:Zeile 1\\nZeile 2 mit sehr langem Text, der",
    "  gefaltet wurde", "END:VEVENT",
    "BEGIN:VEVENT", "UID:x", "SUMMARY:Entfällt: Lineare Algebra", "DTSTART:20261015T120000Z", "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const [a, b] = parseICS(raw);
  assert.equal(a.courseId, "336.100");
  assert.equal(a.title, "Analysis 1");
  assert.equal(a.start.toISOString(), "2026-10-14T06:30:00.000Z");
  assert.equal(a.location, "Keplergebäude, HS 1");
  assert.equal(a.description, "Zeile 1\nZeile 2 mit sehr langem Text, der gefaltet wurde");
  assert.equal(b.cancelled, true);
  assert.equal(b.end.toISOString(), "2026-10-15T12:00:00.000Z");
});

test("Feed: Escapes, Faltung, Rundreise", () => {
  const ics = buildCalendar("JKU Stundenplan", [{
    uid: "a", summary: "! Analysis 1 (UE)", start: "2026-10-14T06:30:00Z", end: "2026-10-14T08:00:00Z",
    stamp: new Date(), lastModified: "2026-10-13T10:00:00Z", sequence: 2, status: "CONFIRMED",
    location: "Keplergebäude · K 224B", description: "Anwesenheitspflicht\n" + "ä".repeat(80),
    categories: ["Anwesenheitspflicht"], priority: 1,
  }]);
  for (const line of ics.split("\r\n")) assert.ok(new TextEncoder().encode(line).length <= 75, line);
  const [e] = parseICS(ics);
  assert.equal(e.uid, "a");
  assert.equal(e.description, "Anwesenheitspflicht\n" + "ä".repeat(80));
  assert.equal(e.start.toISOString(), "2026-10-14T06:30:00.000Z");
  assert.match(ics, /SEQUENCE:2/);
});
