import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanDeadline, isMoodleLink, parseMoodle } from "../src/moodle.js";
import { mapDays } from "../src/mensa.js";

const ICS = `BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VEVENT\r
UID:123@moodle.jku.at\r
SUMMARY:Übungsblatt 3 ist fällig\r
DESCRIPTION:<p>Bitte als PDF\\, max. 5 Seiten</p>\r
CATEGORIES:Analysis 1 (2026W)\r
DTSTART:20261020T215900Z\r
DTEND:20261020T215900Z\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:124@moodle.jku.at\r
SUMMARY:Quiz 2 öffnet\r
DTSTART:20261018T080000Z\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:125@moodle.jku.at\r
SUMMARY:'Projekt' is due\r
DTSTART;TZID=Europe/Vienna:20261101T120000\r
END:VEVENT\r
END:VCALENDAR\r
`;

test("Moodle-Export: Fristen lesen, 'öffnet' überspringen", () => {
  const d = parseMoodle(ICS);
  assert.equal(d.length, 2);
  assert.deepEqual([d[0].title, d[0].course, d[0].due.toISOString()], ["Übungsblatt 3", "Analysis 1 (2026W)", "2026-10-20T21:59:00.000Z"]);
  assert.equal(d[0].note, "Bitte als PDF, max. 5 Seiten");
  assert.equal(d[1].title, "Projekt");
  assert.equal(d[1].due.toISOString(), "2026-11-01T11:00:00.000Z");
});

test("Moodle-Titel bereinigen", () => {
  assert.equal(cleanDeadline("„Bericht“ ist fällig"), "Bericht");
  assert.equal(cleanDeadline("Test 1 schließt"), "Test 1");
  assert.equal(cleanDeadline("Abgabe: Essay"), "Essay");
  assert.equal(cleanDeadline("Sprechstunde"), "Sprechstunde");
});

test("Nur echte Moodle-Kalenderlinks", () => {
  assert.ok(isMoodleLink("https://moodle.jku.at/jku/calendar/export_execute.php?userid=1&authtoken=abc&preset_what=all&preset_time=recentupcoming"));
  assert.ok(isMoodleLink("webcal://moodle.univie.ac.at/calendar/export_execute.php?userid=1&authtoken=abc"));
  assert.ok(!isMoodleLink("https://www.kusss.jku.at/kusss/published-calendar.action?token=x"));
  assert.ok(!isMoodleLink("http://moodle.jku.at/jku/calendar/export_execute.php?authtoken=abc"));
  assert.ok(!isMoodleLink("kein link"));
});

test("Mensa: OpenMensa-Tage abbilden", () => {
  const days = mapDays([{ date: "2026-10-14", closed: false, meals: [
    { name: "Gratin ", category: "Menü Vegan", prices: { students: null, others: 8.8 } },
    { name: "", category: "x", prices: {} },
  ] }]);
  assert.deepEqual(days, [{ date: "2026-10-14", closed: false, meals: [{ name: "Gratin", category: "Menü Vegan", price: 8.8 }] }]);
  assert.deepEqual(mapDays(null), []);
});
