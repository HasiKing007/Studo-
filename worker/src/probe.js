// Testmodus für Unis ohne fertige Anbindung: läuft den Login des Uni-Systems einmal durch und
// beschreibt jede Seite (Adresse ohne Parameter, Titel, Formularfelder, login-relevante Links).
// Nie enthalten: Passwort, Feldwerte, Seiteninhalte. Mit dem Text lässt sich die echte Anbindung bauen.

import { JkuSession, describePage, parseForms } from "./jku.js";

const MAX_STEPS = 12;
const MFA = /(otp|totp|token|2fa|mfa|one.?time|authenticator|verification|code)/i;
const LOGINISH = /(login|anmeld|sso|saml|oauth|authorize|shibboleth|idp|weblogin|auth)/i;

/** Login-relevante Links und Skripte einer Seite (nur Adressen, ohne Parameter). */
function hints(page) {
  const out = new Set();
  for (const m of page.html.matchAll(/(?:href|src|action)\s*=\s*["']([^"'#]+)["']/gi)) {
    if (!LOGINISH.test(m[1])) continue;
    try { const u = new URL(m[1], page.url); out.add(`${u.hostname}${u.pathname}`); } catch { /* ungültige Adresse */ }
    if (out.size >= 8) break;
  }
  // Seiten, die sich per JavaScript aufbauen: Skript-Adressen verraten, wohin der Login geht
  if (!/<form\b/i.test(page.html)) {
    for (const m of page.html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"'#?]+)/gi)) {
      try { const u = new URL(m[1], page.url); out.add(`${u.hostname}${u.pathname}`); } catch { /* ungültige Adresse */ }
      if (out.size >= 12) break;
    }
  }
  return [...out];
}

/**
 * JavaScript-Apps (z. B. neue CAMPUSonline-Oberfläche) bauen den Login erst im Browser. Ihre Skripte
 * verraten aber, wo der Keycloak-Login liegt (Realm, Client-ID). Daraus wird die Login-Adresse gebaut.
 */
async function discoverKeycloak(s, page, lines) {
  const scripts = [...page.html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"'#]+)/gi)]
    .map((m) => { try { return new URL(m[1], page.url).href; } catch { return null; } })
    .filter((u) => u && /(main|custom|config|env)/i.test(u)).slice(0, 4);
  const found = { realms: new Set(), clients: new Set(), bases: new Set() };
  for (const u of [...scripts, new URL("assets/config.json", page.url).href, new URL("assets/env.json", page.url).href]) {
    let txt;
    try { txt = (await s.request(u)).html.slice(0, 3_000_000); } catch { continue; }
    // Nur kleine Ausschnitte rund um Schlüsselwörter prüfen: die Skripte sind groß, die CPU-Zeit knapp
    for (const word of ["realm", "lient_id", "lientId", "sec/auth"]) {
      for (let i = txt.indexOf(word), n = 0; i >= 0 && n < 40; i = txt.indexOf(word, i + word.length), n++) {
        const w = txt.slice(Math.max(0, i - 60), i + 80);
        for (const m of w.matchAll(/realms\/([A-Za-z0-9_.-]{2,40})/g)) found.realms.add(m[1]);
        for (const m of w.matchAll(/\brealm["']?\s*[:=]\s*["']([A-Za-z0-9_.-]{2,40})["']/g)) found.realms.add(m[1]);
        for (const m of w.matchAll(/client_?id["']?\s*[:=]\s*["']([A-Za-z0-9_.-]{2,60})["']/gi)) found.clients.add(m[1]);
        for (const m of w.matchAll(/["']([\w$/.-]*\/sec\/auth[\w$/.-]*)["']/g)) found.bases.add(m[1]);
      }
    }
  }
  const list = (set) => [...set].slice(0, 6).join(", ") || "–";
  lines.push(`   Skripte: Realm ${list(found.realms)} · Client ${list(found.clients)} · Auth-Pfade ${list(found.bases)}`);
  const realm = [...found.realms][0];
  if (!realm) return null;
  const origin = new URL(page.url);
  const base = origin.pathname.match(/^\/[^/]+/)?.[0] || "";
  const client = [...found.clients][0] || "account-console";
  const redirect = client === "account-console" ? `${origin.origin}${base}/co/public/sec/auth/realms/${realm}/account/` : page.url;
  return `${origin.origin}${base}/co/public/sec/auth/realms/${encodeURIComponent(realm)}/protocol/openid-connect/auth?` +
    new URLSearchParams({ client_id: client, response_type: "code", scope: "openid", redirect_uri: redirect });
}

/**
 * @param {{start: string[]}} cfg  Einstiegsadressen des Uni-Systems
 * @returns {Promise<{status: string, report: string}>}
 */
export async function probeLogin(cfg, username, password, fetchImpl) {
  const lines = [];
  let status = "unbekannt";
  for (const start of cfg.start) {
    const s = new JkuSession(fetchImpl);
    lines.push(`== Start ${start}`);
    let page;
    try { page = await s.request(start); } catch (e) { lines.push(`Fehler: ${e.message}`); continue; }
    let sent = false, discovered = false;
    for (let step = 0; step < MAX_STEPS; step++) {
      const h = hints(page);
      lines.push(`${step + 1}. ${describePage(page)}${h.length ? ` | Links: ${h.join(", ")}` : ""}`);
      const forms = parseForms(page.html);
      const saml = forms.find((f) => f.fields.some((x) => /^(SAMLResponse|SAMLRequest|RelayState)$/.test(x.name || "")));
      if (saml) { page = await s.submit(page, saml); continue; }
      const cred = forms.find((f) => f.fields.some((x) => x.type === "password"));
      if (cred && !sent) {
        const user = cred.fields.find((x) => x.type === "text" || x.type === "email" || /user|name|login|kennung/i.test(x.name || ""));
        const pass = cred.fields.find((x) => x.type === "password");
        sent = true;
        page = await s.submit(page, cred, { [user?.name || "username"]: username, [pass.name]: password }, cred.buttons[0]);
        continue;
      }
      if (cred && sent) { status = "Login abgelehnt oder erneut gefragt"; break; }
      if (forms.some((f) => f.fields.some((x) => MFA.test(`${x.name} ${x.type}`)))) { status = "Zwei-Faktor-Abfrage"; break; }
      // Weiterleitungs-Formulare ohne Eingaben (z. B. "Weiter", JavaScript-Autosubmit)
      const auto = forms.find((f) => f.fields.every((x) => x.type === "hidden") && f.action);
      if (auto && step < MAX_STEPS - 1) { page = await s.submit(page, auto, {}, auto.buttons[0]); continue; }
      if (!sent && !discovered && !forms.length && /<script\b[^>]*\bsrc=/i.test(page.html)) {
        discovered = true;
        const next = await discoverKeycloak(s, page, lines).catch(() => null);
        if (next) { page = await s.request(next); continue; }
      }
      status = sent ? (/(logout|abmelden)/i.test(page.html) ? "angemeldet" : "nach Login unklar") : "kein Login-Formular gefunden";
      break;
    }
    lines.push(`Verlauf: ${s.trace.join(" | ")}`);
    lines.push(`Ergebnis: ${status}`);
    if (status === "angemeldet" || status === "Zwei-Faktor-Abfrage") break;
  }
  return { status, report: lines.join("\n").slice(0, 12000) };
}
