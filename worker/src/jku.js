// JKU-Login wie bei Studo: Der Worker meldet sich mit den Zugangsdaten einmalig über das
// JKU-Single-Sign-on (Shibboleth, SAML2) bei KUSSS an, holt sich auf der Seite
// "Terminexport" den persönlichen Kalender-Abo-Link (legt ihn bei Bedarf per "Create" an)
// und vergisst das Passwort danach wieder. Gespeichert wird nur der Abo-Link.
//
// Ohne Browser: eigene Cookie-Verwaltung, Weiterleitungen von Hand, Formulare per Regex.

const KUSSS = "https://www.kusss.jku.at";
export const KUSSS_LOGIN = `${KUSSS}/kusss/login.action`;
export const KUSSS_EXPORT = `${KUSSS}/kusss/ical-multi-form-sz.action`;
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const MAX_REDIRECTS = 15;
const MAX_STEPS = 10;

// ---------- Cookies ----------

export class CookieJar {
  constructor() { this.cookies = []; }

  store(url, setCookies) {
    const host = new URL(url).hostname;
    for (const line of setCookies) {
      const [pair, ...attrs] = line.split(";");
      const eq = pair.indexOf("=");
      if (eq < 1) continue;
      const name = pair.slice(0, eq).trim(), value = pair.slice(eq + 1).trim();
      let domain = host, hostOnly = true, expired = false;
      for (const a of attrs) {
        const [k, v = ""] = a.split("=").map((s) => s.trim());
        if (/^domain$/i.test(k) && v) { domain = v.replace(/^\./, "").toLowerCase(); hostOnly = false; }
        if (/^max-age$/i.test(k) && Number(v) <= 0) expired = true;
        if (/^expires$/i.test(k) && Date.parse(v) < Date.now()) expired = true;
      }
      this.cookies = this.cookies.filter((c) => !(c.name === name && c.domain === domain));
      if (!expired) this.cookies.push({ name, value, domain, hostOnly });
    }
  }

  header(url) {
    const host = new URL(url).hostname;
    return this.cookies
      .filter((c) => host === c.domain || (!c.hostOnly && host.endsWith(`.${c.domain}`)))
      .map((c) => `${c.name}=${c.value}`).join("; ");
  }
}

// ---------- HTML ----------

const decode = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&amp;/g, "&");

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    out[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

/** Alle Formulare mit Feldern (input, button, select) einer Seite. */
export function parseForms(html) {
  const forms = [];
  for (const m of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const a = attrs(m[1]);
    const fields = [], buttons = [];
    for (const f of m[2].matchAll(/<(input|button|select|textarea)\b([^>]*)>(?:([\s\S]*?)<\/\1>)?/gi)) {
      const t = f[1].toLowerCase(), fa = attrs(f[2]);
      if (!fa.name && t !== "button" && fa.type !== "submit") continue;
      const type = (fa.type || (t === "button" ? "submit" : t === "input" ? "text" : t)).toLowerCase();
      const label = decode((f[3] || "").replace(/<[^>]+>/g, "")).trim() || fa.value || "";
      if (type === "submit" || type === "image") buttons.push({ name: fa.name, value: fa.value ?? "", label });
      else if (type === "checkbox" || type === "radio") { if ("checked" in fa) fields.push({ name: fa.name, value: fa.value ?? "on", type }); }
      else fields.push({ name: fa.name, value: fa.value ?? "", type });
    }
    forms.push({ action: a.action ?? "", method: (a.method || "get").toLowerCase(), id: a.id || a.name || "", fields, buttons, html: m[2] });
  }
  return forms;
}

/** Fehlermeldung der Shibboleth-Loginseite, falls vorhanden. */
function loginError(html) {
  const m = html.match(/class="[^"]*(?:output--failure|form-error|login-error|alert-danger|error)[^"]*"[^>]*>([\s\S]*?)<\//i);
  return m ? decode(m[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() : null;
}

/** Kurzform einer URL für die Diagnose: ohne Query (SAMLRequest u. Ä.), nur "execution" bleibt. */
function shortUrl(url) {
  const u = new URL(url);
  const exec = u.searchParams.get("execution");
  return `${u.hostname.replace(/^www\./, "")}${u.pathname}${exec ? `?execution=${exec}` : ""}`;
}

/** Seite für die Diagnose beschreiben: Titel, Formulare mit Feldnamen (nie Werte). */
export function describePage(page) {
  const title = (page.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s+/g, " ").trim();
  const forms = parseForms(page.html).map((f) =>
    `Formular ${f.method.toUpperCase()} ${f.action ? shortUrl(new URL(f.action, page.url).toString()) : "(gleiche Seite)"}` +
    ` [${[...f.fields.map((x) => `${x.name}:${x.type}`), ...f.buttons.map((b) => `Knopf ${b.name || b.label}`)].join(", ")}]`);
  const err = loginError(page.html);
  return [`${page.status} ${shortUrl(page.url)}`, title && `Titel „${title.slice(0, 80)}“`, err && `Meldung „${err.slice(0, 120)}“`,
    ...forms, !forms.length && `keine Formulare, ${page.html.length} Zeichen`].filter(Boolean).join("; ");
}

const CAL_LINK = /(?:https?|webcal):\/\/[^\s"'<>]*?(?:published-calendar|ical|calendar)[^\s"'<>]*?token=[^\s"'<>]+/i;

/** Abo-Link aus der Terminexport-Seite (falls schon angelegt). */
export function findCalendarLink(html) {
  const plain = decode(html);
  const m = plain.match(CAL_LINK);
  return m ? m[0].replace(/^webcal:\/\//i, "https://") : null;
}

// ---------- Ablauf ----------

export class JkuSession {
  constructor(fetchImpl = (...args) => fetch(...args)) {
    // fetch nicht als Methode speichern: Workers verlangen beim Aufruf this === globalThis
    this.fetchImpl = fetchImpl;
    this.jar = new CookieJar();
    this.url = null;
    this.trace = [];
  }

  async request(url, { method = "GET", body = null, referer = null } = {}) {
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      const headers = { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*", "Accept-Language": "de-AT,de;q=0.9" };
      const cookie = this.jar.header(url);
      if (cookie) headers.Cookie = cookie;
      if (referer) headers.Referer = referer;
      if (body) headers["Content-Type"] = "application/x-www-form-urlencoded";
      const doFetch = this.fetchImpl;
      const res = await doFetch(url, { method, headers, body, redirect: "manual" });
      this.trace.push(`${method} ${shortUrl(url)} → ${res.status}`);
      const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      this.jar.store(url, setCookies);
      const loc = res.headers.get("Location");
      if (res.status >= 300 && res.status < 400 && loc) {
        referer = url;
        url = new URL(loc, url).toString();
        if (res.status !== 307 && res.status !== 308) { method = "GET"; body = null; }
        continue;
      }
      this.url = url;
      return { status: res.status, url, html: await res.text() };
    }
    throw new Error("Zu viele Weiterleitungen beim JKU-Login.");
  }

  submit(page, form, extra = {}, button = null) {
    const params = new URLSearchParams();
    for (const f of form.fields) if (f.name) params.append(f.name, f.value);
    for (const [k, v] of Object.entries(extra)) params.set(k, v);
    if (button?.name) params.set(button.name, button.value);
    const action = new URL(form.action || page.url, page.url).toString();
    if (form.method === "post") return this.request(action, { method: "POST", body: params.toString(), referer: page.url });
    const u = new URL(action);
    for (const [k, v] of params) u.searchParams.set(k, v);
    return this.request(u.toString(), { referer: page.url });
  }

  /**
   * Meldet sich an. Ergebnis:
   *  { status: "ok" } | { status: "invalid", message } | { status: "unavailable", message }
   */
  async login(username, password) {
    let page = await this.request(KUSSS_LOGIN);
    let sentCredentials = false;

    for (let step = 0; step < MAX_STEPS; step++) {
      const host = new URL(page.url).hostname;
      if (host.endsWith("kusss.jku.at") && !/login/i.test(new URL(page.url).pathname) && /logout/i.test(page.html)) {
        return { status: "ok" };
      }
      const forms = parseForms(page.html);

      // 1) SAML-Antwort an KUSSS weiterreichen (im Browser automatisch per JavaScript)
      const saml = forms.find((f) => f.fields.some((x) => x.name === "SAMLResponse"));
      if (saml) { page = await this.submit(page, saml); continue; }

      // 2) Zugangsdaten
      const cred = forms.find((f) => f.fields.some((x) => x.type === "password"));
      if (cred) {
        if (sentCredentials) {
          return { status: "invalid", message: loginError(page.html) || "Kennung oder Passwort falsch." };
        }
        const user = cred.fields.find((x) => x.type === "text" || x.type === "email" || /user/i.test(x.name || ""));
        const pass = cred.fields.find((x) => x.type === "password");
        const proceed = cred.buttons.find((b) => /proceed|login|submit/i.test(`${b.name} ${b.label}`)) || cred.buttons[0] || { name: "_eventId_proceed", value: "" };
        sentCredentials = true;
        page = await this.submit(page, cred, { [user?.name || "j_username"]: username, [pass.name]: password }, proceed);
        continue;
      }

      // 3) Zwischenschritte des IdP (Session-Speicher prüfen, Einwilligung, Hinweise): einfach weiter
      const shib = forms.find((f) => f.fields.some((x) => /^(shib_idp_|csrf_token|_shib_idp)/.test(x.name || ""))
        || f.buttons.some((b) => /_eventId_proceed/.test(b.name || "")));
      if (shib && host.includes("shibboleth")) {
        const extra = {};
        for (const x of shib.fields) if (/^shib_idp_ls_supported/.test(x.name || "")) extra[x.name] = "true";
        const btn = shib.buttons.find((b) => /proceed/i.test(b.name || "")) || { name: "_eventId_proceed", value: "" };
        page = await this.submit(page, shib, extra, btn);
        continue;
      }

      // 4) KUSSS ohne Session: SSO-Login-Link folgen
      const sso = page.html.match(/href="([^"]*(?:sso-login|login)\.action[^"]*)"/i);
      if (host.endsWith("kusss.jku.at") && sso && step < 3) {
        page = await this.request(new URL(decode(sso[1]), page.url).toString(), { referer: page.url });
        continue;
      }
      break;
    }
    if (sentCredentials && /logout/i.test(page.html)) return { status: "ok" };
    const detail = describePage(page);
    console.warn("JKU-Login unerwartet:", detail, "| Verlauf:", this.trace.join(" | "));
    return {
      status: "unavailable",
      message: `Der JKU-Login hat sich unerwartet verhalten. Bitte den Kalender-Link manuell einfügen. ` +
        `Diagnose: ${detail}. Verlauf: ${this.trace.slice(-8).join(" | ")}`,
    };
  }

  /** Persönlichen Abo-Link holen; legt ihn über "Create" an, falls es noch keinen gibt. */
  async calendarLink() {
    let page = await this.request(KUSSS_EXPORT);
    let link = findCalendarLink(page.html);
    if (link) return link;

    // "Create"-Knopf: entweder Formular-Button oder Link
    const forms = parseForms(page.html);
    for (const f of forms) {
      const btn = f.buttons.find((b) => /create|erstellen|anlegen/i.test(`${b.label} ${b.value} ${b.name}`));
      if (btn) { page = await this.submit(page, f, {}, btn); break; }
    }
    if (!findCalendarLink(page.html)) {
      const a = page.html.match(/<a\b[^>]*href="([^"]+)"[^>]*>\s*(?:<[^>]+>\s*)*(?:Create|Erstellen)\b/i);
      if (a) page = await this.request(new URL(decode(a[1]), page.url).toString(), { referer: page.url });
    }
    link = findCalendarLink(page.html);
    if (link) return link;
    page = await this.request(KUSSS_EXPORT);
    return findCalendarLink(page.html);
  }
}

/** Kompletter Ablauf: Login + Abo-Link. Wirft nie, liefert immer ein Ergebnis-Objekt. */
export async function jkuConnect(username, password, fetchImpl) {
  const s = new JkuSession(fetchImpl);
  try {
    const r = await s.login(username, password);
    if (r.status !== "ok") return r;
    let icalUrl = null;
    try { icalUrl = await s.calendarLink(); } catch (e) { console.warn("Terminexport:", e.message); }
    return { status: "ok", icalUrl };
  } catch (e) {
    return { status: "unavailable", message: `JKU nicht erreichbar (${e.message}).` };
  }
}
