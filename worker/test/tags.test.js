import { test } from "node:test";
import assert from "node:assert/strict";
import { detectTag } from "../src/tags.js";

test("erkennt Prüfungsarten aus dem Titel", () => {
  assert.equal(detectTag("Klausur Analysis 1"), "klausur");
  assert.equal(detectTag("Analysis 1 - 1. Teilklausur"), "teilklausur");
  assert.equal(detectTag("Nachklausur Lineare Algebra"), "nachklausur");
  assert.equal(detectTag("Prüfung Statistik"), "klausur");
  assert.equal(detectTag("Klausureinsicht"), "einsicht");
  assert.equal(detectTag("Zwischentest"), "teilklausur");
  assert.equal(detectTag("Präsentation der Projekte"), "praesentation");
  assert.equal(detectTag("Referate"), "vortrag");
});

test("normale Termine bleiben ohne Art", () => {
  assert.equal(detectTag("Analysis 1"), null);
  assert.equal(detectTag("Softwareentwicklung 1", "prüfungsimmanente LV"), null);
  assert.equal(detectTag("Lineare Algebra", ""), null);
});

test("Beschreibung zählt, wenn der Titel nichts verrät", () => {
  assert.equal(detectTag("Analysis 1", "Schriftliche Prüfung, Hörsaal 1"), "klausur");
});
