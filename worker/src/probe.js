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
  return [...out];
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
    let sent = false;
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
      status = sent ? (/(logout|abmelden)/i.test(page.html) ? "angemeldet" : "nach Login unklar") : "kein Login-Formular gefunden";
      break;
    }
    lines.push(`Verlauf: ${s.trace.join(" | ")}`);
    lines.push(`Ergebnis: ${status}`);
    if (status === "angemeldet" || status === "Zwei-Faktor-Abfrage") break;
  }
  return { status, report: lines.join("\n").slice(0, 12000) };
}
