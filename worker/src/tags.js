// Art eines Termins (Klausur, Vortrag, …). Wird aus Titel und Beschreibung des Uni-Kalenders
// erkannt und lässt sich pro Termin von Hand setzen oder entfernen.

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
export function detectTag(title, description = "") {
  for (const text of [title, description]) {
    const t = String(text || "").toLowerCase();
    if (!t) continue;
    for (const [tag, re] of RULES) if (re.test(t)) return tag;
  }
  return null;
}
