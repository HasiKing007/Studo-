// iCalendar lesen (KUSSS-Export) und schreiben (eigener Abo-Feed). Ohne externe Bibliothek,
// damit der Worker klein bleibt. Unterstützt, was Uni-Kalender praktisch verwenden:
// gefaltete Zeilen, TZID=Europe/Vienna, UTC-Zeiten (…Z), Ganztagstermine, Escapes.

const TZ = "Europe/Vienna";
const LVA_NR = /\b(\d{3}\.\d{3})\b/;
const KIND = /\b(VL|VO|UE|KS|PR|SE|PS|IK|KV|VU|AG|PJ|EX)\b/;

// ---------- Zeitzonen ----------

const dtf = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
});

function tzOffsetMs(ts) {
  const p = Object.fromEntries(dtf.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ts;
}

/** Wiener Ortszeit -> Date (UTC). Zweimal korrigieren deckt die Sommerzeit-Umstellung ab. */
export function viennaToUtc(y, mo, d, h = 0, mi = 0, s = 0) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let ts = guess - tzOffsetMs(guess);
  ts = guess - tzOffsetMs(ts);
  return new Date(ts);
}

function parseDate(value, params) {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) throw new Error(`Unbekanntes Datumsformat: ${value}`);
  const [, y, mo, d, h = "0", mi = "0", s = "0", z] = m;
  if (z) return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
  // Lokale Zeit (mit TZID oder "floating") wird als Wiener Zeit gelesen.
  return viennaToUtc(+y, +mo, +d, +h, +mi, +s);
}

// ---------- Lesen ----------

function unescapeText(v) {
  return v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
}

function splitContentLine(line) {
  // Der Doppelpunkt nach Name;Parametern, Anführungszeichen in Parametern beachten
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === ":" && !quoted) return [line.slice(0, i), line.slice(i + 1)];
  }
  return [line, ""];
}

export function cleanTitle(summary) {
  const nr = summary.match(LVA_NR)?.[1] ?? null;
  const kind = summary.match(KIND)?.[1] ?? null;
  let title = summary;
  for (const part of [nr, kind].filter(Boolean)) {
    title = title.replace(new RegExp(`\\b${part.replace(".", "\\.")}\\b`), "");
  }
  title = title.replace(/\s*[/|\-–,]\s*(?=[/|\-–,]|$)/g, "");
  title = title.replace(/^[\s/|\-–,]+|[\s/|\-–,]+$/g, "").split(/\s+/).filter(Boolean).join(" ");
  return { title: title || summary, kind, nr };
}

/** Parst einen iCal-Text in eine Liste normalisierter Termine. */
export function parseICS(text) {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const raw = [];
  let cur = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = {}; continue; }
    if (line === "END:VEVENT") { if (cur) raw.push(cur); cur = null; continue; }
    if (!cur || !line) continue;
    const [head, value] = splitContentLine(line);
    const [name, ...paramParts] = head.split(";");
    const params = {};
    for (const p of paramParts) {
      const [k, v = ""] = p.split("=");
      params[k.toUpperCase()] = v.replace(/^"|"$/g, "");
    }
    cur[name.toUpperCase()] = { value, params };
  }

  return raw.filter((e) => e.DTSTART).map((e) => {
    const summary = unescapeText(e.SUMMARY?.value ?? "").trim();
    const { title, kind, nr } = cleanTitle(summary);
    const start = parseDate(e.DTSTART.value, e.DTSTART.params);
    const end = e.DTEND ? parseDate(e.DTEND.value, e.DTEND.params) : start;
    const status = (e.STATUS?.value ?? "CONFIRMED").toUpperCase();
    return {
      uid: e.UID?.value || `${summary}-${start.toISOString()}`,
      courseId: nr || title.toLowerCase(),
      title,
      kind,
      start,
      end,
      location: e.LOCATION ? unescapeText(e.LOCATION.value) : null,
      description: e.DESCRIPTION ? unescapeText(e.DESCRIPTION.value) : null,
      cancelled: status === "CANCELLED" || summary.toLowerCase().includes("entfällt"),
    };
  });
}

// ---------- Schreiben ----------

function escapeText(v) {
  return String(v).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Zeilen nach RFC 5545 auf 75 Bytes falten (UTF-8-sicher, keine Zeichen zerschneiden). */
function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let chunk = "", bytes = 0, limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) { out.push(chunk); chunk = ""; bytes = 0; limit = 74; }
    chunk += ch; bytes += n;
  }
  out.push(chunk);
  return out.join("\r\n ");
}

export function icsDate(d) {
  return new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * Baut einen VCALENDAR. events: [{uid, summary, start, end, stamp, lastModified,
 * sequence, status, location?, description?, categories?, priority?}]
 */
export function buildCalendar(name, events) {
  const L = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Studo+//Stundenplan//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(name)}`,
    `X-WR-TIMEZONE:${TZ}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT30M",
    "X-PUBLISHED-TTL:PT30M",
  ];
  for (const e of events) {
    L.push("BEGIN:VEVENT");
    L.push(`UID:${escapeText(e.uid)}`);
    L.push(`DTSTAMP:${icsDate(e.stamp)}`);
    L.push(`DTSTART:${icsDate(e.start)}`);
    L.push(`DTEND:${icsDate(e.end)}`);
    L.push(`LAST-MODIFIED:${icsDate(e.lastModified)}`);
    L.push(`SEQUENCE:${e.sequence}`);
    L.push(`SUMMARY:${escapeText(e.summary)}`);
    L.push(`STATUS:${e.status}`);
    if (e.location) L.push(`LOCATION:${escapeText(e.location)}`);
    if (e.description) L.push(`DESCRIPTION:${escapeText(e.description)}`);
    if (e.categories) L.push(`CATEGORIES:${e.categories.map(escapeText).join(",")}`);
    if (e.priority) L.push(`PRIORITY:${e.priority}`);
    L.push("END:VEVENT");
  }
  L.push("END:VCALENDAR");
  return L.map(fold).join("\r\n") + "\r\n";
}
