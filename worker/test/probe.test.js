import { test } from "node:test";
import assert from "node:assert/strict";
import { probeLogin } from "../src/probe.js";

const html = (body, status = 200, headers = {}) => new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", ...headers } });

function fakeUni({ mfa = false } = {}) {
  return async (url, init) => {
    const u = new URL(url);
    if (u.pathname === "/start") return html(`<title>Login</title><a href="/sso/login">SSO</a><form method="post" action="/idp/login"><input name="user" type="text"><input name="pass" type="password"><button name="go">Anmelden</button></form>`);
    if (u.pathname === "/idp/login") {
      assert.match(String(init.body), /pass=geheim/);
      return mfa ? html(`<title>Bestätigung</title><form method="post" action="/idp/otp"><input name="otp_code" type="text"></form>`)
        : html(`<form method="post" action="/app/acs"><input type="hidden" name="SAMLResponse" value="xyz"></form>`);
    }
    if (u.pathname === "/app/acs") return html(`<title>Start</title><p>Max Muster</p><a href="/logout">Abmelden</a>`);
    return html("nicht gefunden", 404);
  };
}

test("Testmodus beschreibt den Login ohne Passwort und Inhalte", async () => {
  const r = await probeLogin({ start: ["https://uni.example/start"] }, "a123", "geheim", fakeUni());
  assert.equal(r.status, "angemeldet");
  assert.match(r.report, /Formular POST uni\.example\/idp\/login \[user:text, pass:password, Knopf go\]/);
  assert.match(r.report, /Links: uni\.example\/sso\/login/);
  assert.doesNotMatch(r.report, /geheim|xyz|Max Muster/);
});

test("Testmodus erkennt eine Zwei-Faktor-Abfrage", async () => {
  const r = await probeLogin({ start: ["https://uni.example/start"] }, "a123", "geheim", fakeUni({ mfa: true }));
  assert.equal(r.status, "Zwei-Faktor-Abfrage");
});
