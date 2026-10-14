// Campus-Infos für den Home-Screen. Erst einmal das USI (Universitätssportinstitut der JKU):
// Öffnungszeiten und Sauna-Tage sind fest hinterlegt (ändern sich selten), Hinweise wie
// „komplett geschlossen“ und die News kommen von der JKU-Website (6 Stunden gecacht).
// Eine Live-Auslastung veröffentlicht das USI nicht.

const USI_PAGE = "https://www.jku.at/universitaetssportinstitut/";
const USI_NEWS = "https://www.jku.at/campus/freizeit/usi-sportangebot/news-events/";
const MONTHS = ["januar", "februar", "märz", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "dezember"];
const WD = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const SAUNA = { 1: "Herren", 2: "Damen", 3: "gemischt" }; // Di, Mi, Do (Wochentag 0 = Montag)

const partsFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23",
});
const WEEK = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
/** Wiener Datum/Uhrzeit: { y, m, d, wd (0 = Mo), min (Minuten seit Mitternacht), key "YYYY-MM-DD" } */
export function vienna(date) {
  const p = Object.fromEntries(partsFmt.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, wd: WEEK[p.weekday], min: +p.hour * 60 + +p.minute, key: `${p.year}-${p.month}-${p.day}` };
}
const keyOf = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
function addDaysKey(v, n) {
  const t = new Date(Date.UTC(v.y, v.m - 1, v.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), wd: (v.wd + n % 7 + 7) % 7, key: keyOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()) };
}

/** Gesetzliche Feiertage in Österreich (Sauna an Feiertagen zu). */
export function holidays(year) {
  // Ostersonntag nach Gauß/Meeus
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  const easter = Date.UTC(year, month - 1, day);
  const rel = (n) => { const t = new Date(easter + n * 86400_000); return keyOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); };
  return new Set([
    keyOf(year, 1, 1), keyOf(year, 1, 6), rel(1), keyOf(year, 5, 1), rel(39), rel(50), rel(60),
    keyOf(year, 8, 15), keyOf(year, 10, 26), keyOf(year, 11, 1), keyOf(year, 12, 8), keyOf(year, 12, 25), keyOf(year, 12, 26),
  ]);
}

/** Lehrveranstaltungsfreie Zeit (ungefähr): Weihnachten, Februar, Juli bis September. */
function isBreak(v) {
  return v.m === 2 || (v.m >= 7 && v.m <= 9) || (v.m === 12 && v.d >= 24) || (v.m === 1 && v.d <= 6);
}

const hhmm = (min) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;

/** Status von Fitnessstudio und Sauna zu einem Zeitpunkt, als kurze Texte für die App. */
export function usiStatus(now = new Date(), closedDays = new Set(), saunaClosed = new Set()) {
  const v = vienna(now);
  const gymClose = (isBreak(v) ? 20 : 21) * 60, gymOpen = 8 * 60;
  let gym;
  if (closedDays.has(v.key)) gym = { open: false, text: "Heute geschlossen" };
  else if (v.min >= gymOpen && v.min < gymClose) gym = { open: true, text: `Offen bis ${hhmm(gymClose)}` };
  else if (v.min < gymOpen) gym = { open: false, text: "Öffnet um 8:00" };
  else gym = { open: false, text: "Öffnet morgen um 8:00" };

  let sauna = null;
  for (let n = 0; n < 21 && !sauna; n++) {
    const day = n ? addDaysKey(v, n) : v;
    if (!SAUNA[day.wd] || (day.m >= 7 && day.m <= 9) || holidays(day.y).has(day.key) || closedDays.has(day.key) || saunaClosed.has(day.key)) continue;
    const end = (isBreak(day) ? 19 : 20) * 60, until = `16–${end / 60} Uhr`;
    const who = SAUNA[day.wd];
    if (n === 0) {
      if (v.min >= end) continue;
      sauna = v.min >= 16 * 60 ? { open: true, text: `Offen bis ${hhmm(end)} · ${who}` } : { open: false, text: `Heute ${until} · ${who}` };
    } else {
      sauna = { open: false, text: `${n === 1 ? "Morgen" : WD[day.wd]} ${until} · ${who}` };
    }
  }
  if (!sauna) sauna = { open: false, text: "Im Sommer zu, ab Oktober wieder offen" };
  return { gym, sauna };
}

const decode = (s) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&[a-z]+;/g, " ");
const text = (html) => decode(String(html).replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** Hinweise wie „Donnerstag, 08. Oktober 2026 komplett geschlossen!“ (ab heute, höchstens 30 Tage voraus). */
export function parseNotices(html, now = new Date()) {
  const t = text(html), v = vienna(now), out = [];
  const re = new RegExp(`((?:Mo|Di|Mi|Do|Fr|Sa|So)[a-z]*,?\\s*)?(\\d{1,2})\\.\\s*(?:(${MONTHS.join("|")})|(\\d{1,2})\\.)\\s*(\\d{4})?[^!?]{0,90}?geschlossen[^.!?]{0,40}[.!]?`, "gi");
  for (const m of t.matchAll(re)) {
    const month = m[3] ? MONTHS.indexOf(m[3].toLowerCase()) + 1 : +m[4];
    const year = m[5] ? +m[5] : (month < v.m - 1 ? v.y + 1 : v.y);
    const key = keyOf(year, month, +m[2]);
    const days = (Date.parse(key) - Date.parse(v.key)) / 86400_000;
    if (days < 0 || days > 30) continue;
    if (!out.some((x) => x.date === key)) {
      out.push({ date: key, text: m[0].trim().replace(/\s+/g, " ").slice(0, 140), closed: /komplett|ganz|gesamt/i.test(m[0]), sauna: /sauna/i.test(m[0]) });
    }
  }
  return out;
}

/** Die neuesten News-Beiträge der USI-Seite: [{ title, date, url }] */
export function parseNews(html, base = USI_NEWS, limit = 3) {
  const out = [];
  for (const m of html.matchAll(/<a\b[^>]*href="([^"]*\/detail\/news\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const title = text(m[2]);
    if (title.length < 8 || /zum artikel|weiterlesen|mehr/i.test(title)) continue;
    const url = new URL(decode(m[1]), base).toString();
    if (out.some((x) => x.url === url)) continue;
    const before = html.slice(Math.max(0, m.index - 1500), m.index);
    const dates = [...before.matchAll(/(\d{2})\.(\d{2})\.(\d{4})/g)];
    const d = dates.at(-1);
    out.push({ title, url, date: d ? `${d[3]}-${d[2]}-${d[1]}` : null });
    if (out.length >= limit) break;
  }
  return out;
}

async function page(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: { "User-Agent": "StudoPlus/1.0", Accept: "text/html" }, cf: { cacheTtl: 6 * 3600, cacheEverything: true } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export async function usiInfo(now = new Date(), fetchImpl = (...a) => fetch(...a)) {
  const [main, news] = await Promise.allSettled([page(USI_PAGE, fetchImpl), page(USI_NEWS, fetchImpl)]);
  const notices = main.status === "fulfilled" ? parseNotices(main.value, now) : [];
  const closed = new Set(notices.filter((n) => n.closed).map((n) => n.date));
  const saunaClosed = new Set(notices.filter((n) => n.sauna).map((n) => n.date));
  return {
    ...usiStatus(now, closed, saunaClosed),
    notices,
    news: news.status === "fulfilled" ? parseNews(news.value) : [],
    hours: [
      ["Fitnessstudio (Vollabo)", "Mo–So 8–21 Uhr"],
      ["Fitnessstudio (Teilabo)", "Mo–Fr 8–14, Sa/So 8–21 Uhr"],
      ["In den Ferien", "bis 20 Uhr"],
    ],
    sauna_plan: [["Dienstag", "16–20 Uhr · Herren"], ["Mittwoch", "16–20 Uhr · Damen"], ["Donnerstag", "16–20 Uhr · gemischt"]],
    sauna_note: "In den Ferien bis 19 Uhr. An Feiertagen und von Juli bis September geschlossen.",
    links: [
      { name: "USI-Website", url: USI_PAGE },
      { name: "Kurse buchen", url: "https://usi.jku.at/" },
    ],
  };
}
