// Moodle-Abgaben: Moodle bietet unter Kalender → Exportieren einen persönlichen iCal-Link
// (calendar/export_execute.php?userid=…&authtoken=…). Daraus werden Fristen wie
// "Übungsblatt 3 ist fällig"; "… öffnet" ist keine Frist und wird übersprungen.

import { parseIcsDate, readEvents, unescapeIcs } from "./ical.js";

const OPENS = /\s+(?:öffnet|ist geöffnet|beginnt|opens|is open|starts)\.?$/i;
const DUE = /\s+(?:ist fällig|ist zu erledigen|fällig|schließt|endet|is due|closes|ends|due)\.?$/i;

/** Ist das ein Moodle-Kalenderexport (nicht irgendein anderer Link)? */
export function isMoodleLink(link) {
  let u;
  try { u = new URL(String(link).trim().replace(/^webcal:\/\//i, "https://")); } catch { return false; }
  return u.protocol === "https:" && /\/calendar\/export_execute\.php$/.test(u.pathname) && u.searchParams.has("authtoken");
}

export function cleanDeadline(summary) {
  let t = String(summary).trim().replace(DUE, "").replace(/^(?:fällig|due|abgabe)\s*:\s*/i, "").trim();
  t = t.replace(/^["'„“‚‘](.*)["'“”‘’]$/, "$1").trim();
  return t || String(summary).trim();
}

function plain(text) {
  return String(text).replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

/** Liest den Moodle-Export: [{ uid, title, course, due, note }] (ohne "öffnet"-Einträge). */
export function parseMoodle(text) {
  const out = [];
  for (const e of readEvents(text)) {
    if (!e.DTSTART) continue;
    const summary = unescapeIcs(e.SUMMARY?.value ?? "").trim();
    if (!summary || OPENS.test(summary)) continue;
    let due;
    try { due = parseIcsDate(e.DTSTART.value, e.DTSTART.params); } catch { continue; }
    const course = e.CATEGORIES ? unescapeIcs(e.CATEGORIES.value).split(",")[0].trim() || null : null;
    const note = e.DESCRIPTION ? plain(unescapeIcs(e.DESCRIPTION.value)).slice(0, 400) || null : null;
    out.push({ uid: e.UID?.value || `${summary}-${due.toISOString()}`, title: cleanDeadline(summary), course, due, note });
  }
  return out;
}
