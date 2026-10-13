import { test } from "node:test";
import assert from "node:assert/strict";
import { CookieJar, findCalendarLink, jkuConnect, parseForms } from "../src/jku.js";

// Nachgebauter Ablauf KUSSS -> Shibboleth -> KUSSS, wie er im Browser abläuft.
function fakeJku({ password = "richtig", hasLink = false } = {}) {
  let linkCreated = hasLink;
  const calls = [];
  const IDP = "https://shibboleth.im.jku.at/idp/profile/SAML2/Redirect/SSO";
  const page = (html, headers = {}) => new Response(html, { status: 200, headers: { "Content-Type": "text/html", ...headers } });
  const redirect = (to, cookie) => new Response(null, { status: 302, headers: { Location: to, ...(cookie ? { "Set-Cookie": cookie } : {}) } });
  const credForm = (err = "") => page(`<form action="/idp/profile/SAML2/Redirect/SSO?execution=e1s2" method="post">
      ${err ? `<section><p class="form-element form-error">${err}</p></section>` : ""}
      <input type="hidden" name="csrf_token" value="_csrf2">
      <input id="username" name="j_username" type="text" value="">
      <input id="password" name="j_password" type="password">
      <button type="submit" name="_eventId_proceed">Login</button></form>`);

  async function fetchImpl(url, init = {}) {
    const u = new URL(url);
    const body = init.body ? new URLSearchParams(init.body) : null;
    calls.push({ method: init.method || "GET", url, body: body && Object.fromEntries(body), cookie: init.headers?.Cookie || "" });

    if (u.pathname === "/kusss/login.action") return redirect(`${IDP}?SAMLRequest=abc`, "JSESSIONID=kusss1; Path=/kusss; Secure; HttpOnly");
    if (u.hostname === "shibboleth.im.jku.at" && u.searchParams.get("SAMLRequest")) return redirect("/idp/profile/SAML2/Redirect/SSO?execution=e1s1", "JSESSIONID=idp1; Path=/idp");
    if (u.search === "?execution=e1s1" && (init.method || "GET") === "GET") {
      return page(`<title>Loading Session Information</title><form action="/idp/profile/SAML2/Redirect/SSO?execution=e1s1" method="post">
        <input type="hidden" name="csrf_token" value="_csrf1">
        <input type="hidden" name="shib_idp_ls_exception.shib_idp_session_ss" value="">
        <input type="hidden" name="shib_idp_ls_success.shib_idp_session_ss" value="false">
        <input type="hidden" name="shib_idp_ls_supported" value="">
        <input type="hidden" name="_eventId_proceed" value=""></form>`);
    }
    if (u.search === "?execution=e1s1") {
      assert.equal(body.get("csrf_token"), "_csrf1");
      assert.match(init.headers.Cookie, /JSESSIONID=idp1/);
      return credForm();
    }
    if (u.search === "?execution=e1s2") {
      assert.equal(body.get("j_username"), "k12345678");
      if (body.get("j_password") !== password) return credForm("The password you entered was incorrect.");
      return page(`<body onload="document.forms[0].submit()"><form action="https://www.kusss.jku.at/Shibboleth.sso/SAML2/POST" method="post">
        <input type="hidden" name="RelayState" value="ss:mem:1"><input type="hidden" name="SAMLResponse" value="PHNhbWw+"></form></body>`);
    }
    if (u.pathname === "/Shibboleth.sso/SAML2/POST") {
      assert.equal(body.get("SAMLResponse"), "PHNhbWw+");
      return redirect("https://www.kusss.jku.at/kusss/studentwelcome.action", "_shibsession_x=ok; Path=/; Secure");
    }
    if (u.pathname === "/kusss/studentwelcome.action") {
      assert.match(init.headers.Cookie, /_shibsession_x=ok/);
      assert.match(init.headers.Cookie, /JSESSIONID=kusss1/);
      return page('<a href="logout.action">Logout</a>');
    }
    if (u.pathname === "/kusss/ical-multi-form-sz.action") {
      const cell = linkCreated
        ? '<td><a href="https://www.kusss.jku.at/kusss/published-calendar.action?token=SECRET123&amp;lang=de">https://www.kusss.jku.at/kusss/published-calendar.action?token=SECRET123&amp;lang=de</a></td>'
        : "<td>--</td>";
      return page(`<h3>Kalender Abonnement</h3><form action="ical-create.action" method="post">
        <input type="submit" name="create" value="Create"> / <input type="submit" name="delete" value="Delete" disabled></form>
        <table><tr>${cell}</tr></table><a href="logout.action">Logout</a>`);
    }
    if (u.pathname === "/kusss/ical-create.action") {
      assert.equal(body.get("create"), "Create");
      assert.equal(body.get("delete"), null);
      linkCreated = true;
      return redirect("https://www.kusss.jku.at/kusss/ical-multi-form-sz.action");
    }
    throw new Error(`Unerwartete Anfrage ${url}`);
  }
  return { fetchImpl, calls };
}

test("JKU-Login: SSO-Durchlauf und Abo-Link per Create anlegen", async () => {
  const { fetchImpl, calls } = fakeJku();
  const r = await jkuConnect("k12345678", "richtig", fetchImpl);
  assert.deepEqual(r, { status: "ok", icalUrl: "https://www.kusss.jku.at/kusss/published-calendar.action?token=SECRET123&lang=de" });
  assert.ok(calls.some((c) => c.url.endsWith("ical-create.action")));
});

test("JKU-Login: vorhandenen Abo-Link übernehmen, ohne neu anzulegen", async () => {
  const { fetchImpl, calls } = fakeJku({ hasLink: true });
  const r = await jkuConnect("k12345678", "richtig", fetchImpl);
  assert.equal(r.icalUrl, "https://www.kusss.jku.at/kusss/published-calendar.action?token=SECRET123&lang=de");
  assert.ok(!calls.some((c) => c.url.endsWith("ical-create.action")));
});

test("JKU-Login: falsches Passwort wird erkannt", async () => {
  const { fetchImpl } = fakeJku();
  const r = await jkuConnect("k12345678", "falsch", fetchImpl);
  assert.equal(r.status, "invalid");
  assert.match(r.message, /incorrect/);
});

test("JKU-Login: Netzwerkfehler -> unavailable statt Absturz", async () => {
  const r = await jkuConnect("k12345678", "x", async () => { throw new Error("offline"); });
  assert.equal(r.status, "unavailable");
});

test("Formular-Parser und Cookies", () => {
  const [f] = parseForms(`<form method="POST" action="/x?a=1&amp;b=2"><input name="a" value="1"><input type="checkbox" name="c">
    <input type="checkbox" name="d" value="y" checked><button name="go" value="1">Los</button></form>`);
  assert.equal(f.action, "/x?a=1&b=2");
  assert.deepEqual(f.fields.map((x) => x.name), ["a", "d"]);
  assert.deepEqual(f.buttons, [{ name: "go", value: "1", label: "Los" }]);

  const jar = new CookieJar();
  jar.store("https://a.jku.at/", ["s=1; Domain=.jku.at; Path=/", "h=2; Path=/"]);
  assert.equal(jar.header("https://b.jku.at/"), "s=1");
  assert.equal(jar.header("https://a.jku.at/"), "s=1; h=2");
  jar.store("https://a.jku.at/", ["h=; Max-Age=0"]);
  assert.equal(jar.header("https://a.jku.at/"), "s=1");
  assert.equal(findCalendarLink("nix"), null);
});

test("JKU-Login: globales fetch wird ohne falsches this aufgerufen", async () => {
  const orig = globalThis.fetch;
  const fake = fakeJku().fetchImpl;
  // Wie in Cloudflare Workers: fetch wirft, wenn this nicht globalThis ist
  globalThis.fetch = function (...args) {
    if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
    return fake(...args);
  };
  try {
    const r = await jkuConnect("k12345678", "richtig");
    assert.equal(r.status, "ok");
  } finally { globalThis.fetch = orig; }
});
