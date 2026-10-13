// JKU-Login wie bei Studo: Der Worker meldet sich mit den Zugangsdaten einmalig über das
// JKU-Single-Sign-on (Shibboleth, SAML2) bei KUSSS an, holt sich auf der Seite
// "Terminexport" den persönlichen Kalender-Abo-Link (legt ihn bei Bedarf per "Create" an)
// und vergisst das Passwort danach wieder. Gespeichert wird nur der Abo-Link.
//
// Ohne Browser: eigene Cookie-Verwaltung, Weiterleitungen von Hand, Formulare per Regex.

const KUSSS = "https://www.kusss.jku.at";
export const KUSSS_LOGIN = `${KUSSS}/kusss/login.action`;
export const KUSSS_EXPORT = `${KUSSS}/kusss/ical-multi-form-sz.action`;
export const KUSSS_GRADES = `${KUSSS}/kusss/gradeinfo.action`;
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

const text = (html) => decode(String(html).replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** Name aus der KUSSS-Kopfzeile "Vorname Nachname | Username: K12345678". */
export function extractName(html) {
  const m = text(html).match(/([A-ZÄÖÜ][\p{L}'.\- ]{2,80}?)\s*\|\s*Username\s*:/u);
  return m ? m[1].trim() : null;
}

const GRADE_WORDS = [
  [/nicht\s+genügend/i, 5], [/sehr\s+gut/i, 1], [/befriedigend/i, 3], [/genügend/i, 4], [/\bgut\b/i, 2],
];

/** Note aus KUSSS-Text: Zahl 1-5, Wort, oder Teilnahme-Beurteilung. */
export function parseGrade(raw) {
  const t = String(raw || "").trim();
  const num = t.match(/(?:^|\()\s*([1-5])\s*(?:\)|$)/);
  if (num) return { grade: +num[1], passed: +num[1] < 5 };
  for (const [re, g] of GRADE_WORDS) if (re.test(t)) return { grade: g, passed: g < 5 };
  if (/ohne\s+erfolg|nicht\s+bestanden|negativ/i.test(t)) return { grade: null, passed: false };
  if (/mit\s+erfolg|bestanden|teilgenommen|positiv/i.test(t)) return { grade: null, passed: true };
  return { grade: null, passed: null };
}

const num = (v) => { const m = String(v || "").replace(",", ".").match(/\d+(?:\.\d+)?/); return m ? +m[0] : null; };

/** Datum "14.10.2026" -> "2026-10-14". */
function isoDate(v) {
  const m = String(v || "").match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}

/**
 * Notenauskunft lesen. Spalten werden über ihre Überschriften erkannt (Datum, LVA/Titel, Typ,
 * Note/Beurteilung, ECTS, SSt, Semester), damit kleine Layout-Änderungen nichts kaputt machen.
 * Überschriften wie "Bachelorstudium Informatik" über einer Tabelle werden als Studium übernommen.
 */
export function parseGrades(html) {
  const grades = [], programs = new Set();
  const COLS = {
    date: /datum/i, nr: /(lva-?nr|nummer|^nr)/i, kind: /typ/i, grade: /(note|beurteilung)/i,
    ects: /ects/i, sws: /(sst|sws|semesterstunden)/i, semester: /semester/i,
    title: /(titel|lehrveranstaltung|lva|prüfung|kurs|fach)/i,
  };
  const PROGRAM = /((?:Bachelor|Master|Diplom|Doktorats?|Lehramts?)[\p{L}-]*studium[^<|]{0,120}|(?:UG|UK|UC)\s?\d{3}\s?\d{0,3}[^<|]{0,120})/u;
  let program = null, pos = 0;
  for (const t of html.matchAll(/<table\b[\s\S]*?<\/table>/gi)) {
    const before = html.slice(pos, t.index);
    pos = t.index + t[0].length;
    const progs = [...text(before).matchAll(new RegExp(PROGRAM.source, "gu"))];
    if (progs.length) { program = progs.at(-1)[1].trim().replace(/\s*[:–-]\s*$/, ""); }

    const rows = [...t[0].matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map((r) =>
      [...r[0].matchAll(/<t([hd])\b[^>]*>([\s\S]*?)<\/t\1>/gi)].map((c) => text(c[2])));
    const headIdx = rows.findIndex((r) => r.some((c) => COLS.grade.test(c)) && r.some((c) => COLS.ects.test(c) || COLS.title.test(c)));
    if (headIdx < 0) continue;
    const head = rows[headIdx];
    const col = {};
    for (const [key, re] of Object.entries(COLS)) {
      const i = head.findIndex((c, idx) => re.test(c) && !Object.values(col).includes(idx));
      if (i >= 0) col[key] = i;
    }
    for (const r of rows.slice(headIdx + 1)) {
      if (r.length < 3 || col.grade === undefined || !r[col.grade]) continue;
      const titleCell = r[col.title] ?? "";
      const nr = (r[col.nr] || titleCell).match(/\b\d{3}\.\w{3}\b/)?.[0] || null;
      const g = parseGrade(r[col.grade]);
      const title = titleCell.replace(/\b\d{3}\.\w{3}\b/, "").replace(/^[\s,/|-]+|[\s,/|-]+$/g, "") || titleCell;
      if (!title) continue;
      grades.push({
        date: isoDate(r[col.date]), nr, title, kind: (r[col.kind] || "").match(/\b[A-Z]{2}\b/)?.[0] || null,
        grade_text: r[col.grade], grade: g.grade, passed: g.passed,
        ects: num(r[col.ects]), sws: num(r[col.sws]), semester: r[col.semester] || null, program,
      });
      if (program) programs.add(program);
    }
  }
  return { grades, programs: [...programs] };
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
        return { status: "ok", name: extractName(page.html) };
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
    if (sentCredentials && /logout/i.test(page.html)) return { status: "ok", name: extractName(page.html) };
    const detail = describePage(page);
    console.warn("JKU-Login unerwartet:", detail, "| Verlauf:", this.trace.join(" | "));
    return {
      status: "unavailable",
      message: `Der JKU-Login hat sich unerwartet verhalten. Bitte den Kalender-Link manuell einfügen. ` +
        `Diagnose: ${detail}. Verlauf: ${this.trace.slice(-8).join(" | ")}`,
    };
  }

  /** Notenauskunft holen und lesen. */
  async grades() {
    let page = await this.request(KUSSS_GRADES);
    let r = parseGrades(page.html);
    if (!r.grades.length) {
      // Falls sich die Adresse geändert hat: dem Menüpunkt "Notenauskunft" folgen
      const a = page.html.match(/<a\b[^>]*href="([^"]+)"[^>]*>\s*Notenauskunft/i);
      if (a) { page = await this.request(new URL(decode(a[1]), page.url).toString(), { referer: page.url }); r = parseGrades(page.html); }
    }
    if (!r.grades.length) r.error = `Notenauskunft nicht erkannt (${describePage(page)})`;
    return r;
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
export async function jkuConnect(username, password, fetchImpl, { calendar = true, grades = true } = {}) {
  const s = new JkuSession(fetchImpl);
  try {
    const r = await s.login(username, password);
    if (r.status !== "ok") return r;
    const out = { status: "ok", name: r.name || null, icalUrl: null, grades: null };
    if (calendar) {
      try { out.icalUrl = await s.calendarLink(); } catch (e) { console.warn("Terminexport:", e.message); }
    }
    if (grades) {
      try { out.grades = await s.grades(); } catch (e) { out.grades = { grades: [], programs: [], error: e.message }; }
      if (out.grades.error) console.warn("Notenauskunft:", out.grades.error);
    }
    return out;
  } catch (e) {
    return { status: "unavailable", message: `JKU nicht erreichbar (${e.message}).` };
  }
}
