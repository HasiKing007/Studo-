// Art eines Termins (Klausur, Vortrag, …). Erkannt aus dem Titel und aus kurzen Notizen zum
// einzelnen Termin (KUSSS: Spalte rechts neben dem Raum, z. B. "Klausur F"). Lange Beschreibungen
// zählen nicht, weil sie Prüfungen oft nur nebenbei erwähnen. und lässt sich pro Termin von Hand setzen oder entfernen.

export const TAGS = {
  klausur: "Klausur",
  teilklausur: "Teilklausur",
  nachklausur: "Nachklausur",
  vortrag: "Vortrag",
  praesentation: "Präsentation",
  abgabe: "Abgabe",
  einsicht: "Einsicht",
};

// Reihenfolge zählt: das Genauere zuerst ("Nachklausur" vor "Klausur")
const RULES = [
  ["einsicht", /(klausur|prüfungs|pruefungs)?einsicht/],
  ["nachklausur", /nach(klausur|prüfung|pruefung|termin)|wiederholungs(klausur|prüfung|pruefung|test)|retake|resit/],
  ["teilklausur", /(teil|zwischen)(klausur|prüfung|pruefung|test)|mid-?term|teilleistung/],
  ["klausur", /klausur|(?<![\p{L}])(prüfung|pruefung|exam|examination)(?![\p{L}])|abschlusstest|endtest/u],
  ["praesentation", /präsentation|praesentation|presentation/],
  ["vortrag", /vortrag|referat/],
  ["abgabe", /(?<![\p{L}])abgabe(?![\p{L}])|deadline|einreichung/u],
];

/** Erkannte Art eines Termins oder null. */
export function detectTag(title, note = "") {
  const n = String(note || "").trim();
  for (const text of [title, n.length <= 60 && !n.includes("\n") ? n : ""]) {
    const t = String(text || "").toLowerCase();
    if (!t) continue;
    for (const [tag, re] of RULES) if (re.test(t)) return tag;
  }
  return null;
}
