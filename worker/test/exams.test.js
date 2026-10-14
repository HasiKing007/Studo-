import { test } from "node:test";
import assert from "node:assert/strict";
import { describeTables, parseExams } from "../src/jku.js";

const HTML = `<html><head><title>KUSSS</title></head><body>
<a href="/kusss/gradeinfo.action">Notenauskunft</a> <a href="/kusss/szexaminationlist.action">Prüfungen</a>
<table><tr><th>LVA-Nr.</th><th>Titel</th><th>Datum</th><th>Ort</th><th>Anmeldung</th><th></th></tr>
<tr><td>336.100</td><td>Analysis 1 (VL)</td><td>29.01.2027 08:30</td><td>HS 1</td><td>01.12.2026 - 22.01.2027 23:59</td><td><input type="submit" value="anmelden"></td></tr>
<tr><td>351.001</td><td>Softwareentwicklung 1</td><td>05.02.2027, 10:00</td><td>HS 18</td><td>bis 30.01.2027</td><td><a href="x">abmelden</a></td></tr>
<tr><td>351.002</td><td>Ohne Frist</td><td>05.02.2027</td><td>HS 18</td><td>–</td><td></td></tr>
</table></body></html>`;

test("Prüfungen mit Anmeldefrist lesen", () => {
  const x = parseExams(HTML);
  assert.deepEqual(x, [
    { nr: "336.100", title: "Analysis 1 (VL)", date: "2027-01-29T08:30", until: "2027-01-22T23:59", registered: false },
    { nr: "351.001", title: "Softwareentwicklung 1", date: "2027-02-05T10:00", until: "2027-01-30T23:59", registered: true },
  ]);
});

test("Seiten ohne Anmeldespalte liefern nichts, Diagnose ohne Klartext", () => {
  assert.deepEqual(parseExams("<table><tr><th>Datum</th><th>Titel</th></tr><tr><td>1</td><td>2</td></tr></table>"), []);
  const d = describeTables({ status: 200, url: "https://www.kusss.jku.at/kusss/szexaminationlist.action", html: HTML });
  assert.match(d, /Kopf: LVA-Nr\. \| Titel \| Datum/);
  assert.match(d, /Zeile 2: 336\.100 \| a 1 \(a\)/);
  assert.ok(!d.includes("Analysis"));
  assert.match(d, /Prüfungen → szexaminationlist\.action/);
});
