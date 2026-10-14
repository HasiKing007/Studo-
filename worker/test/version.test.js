import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Die App erkennt neue Versionen am Vergleich mit sw.js: beide Nummern müssen gemeinsam steigen
test("BUILD in app.js passt zu VERSION in sw.js", () => {
  const app = readFileSync(new URL("../../frontend/app.js", import.meta.url), "utf8");
  const sw = readFileSync(new URL("../../frontend/sw.js", import.meta.url), "utf8");
  assert.equal(app.match(/const BUILD = "([^"]+)"/)[1], sw.match(/const VERSION = "([^"]+)"/)[1]);
});
