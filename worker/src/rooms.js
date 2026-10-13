// Raumangaben aus KUSSS in (Gebäude, Raum) zerlegen.
// KUSSS liefert Kurzcodes wie "HS 1", "K 224B", "S3 048", "T 911". Die Tabelle ist ein
// Startpunkt: Unbekannte Präfixe werden unverändert angezeigt, es geht nichts verloren.

export const BUILDINGS = {
  HS: "Hörsaaltrakt",
  K: "Keplergebäude",
  KEP: "Keplergebäude",
  S1: "Science Park 1",
  S2: "Science Park 2",
  S3: "Science Park 3",
  S4: "Science Park 4",
  S5: "Science Park 5",
  T: "TNF-Turm",
  TNF: "TNF-Turm",
  MT: "Managementzentrum",
  MZ: "Managementzentrum",
  UC: "Uni-Center",
  LC: "Learning Center",
  BA: "Bankengebäude",
  JUR: "Juridicum",
  HF: "Hochschulfondsgebäude",
};

const HS = /^\s*(HS|Hörsaal)\s*(\d+[A-Z]?)\s*$/i;
const CODE = /^\s*([A-Za-z]{1,3}\d?)[\s\-_]*([0-9][0-9A-Za-z.\-]*)\s*$/;
const ONLINE = /(online|zoom|teams|webex|digital)/i;

/** @returns {[string|null, string|null]} [gebäude, raum] */
export function parseRoom(raw) {
  if (!raw) return [null, null];
  const text = raw.replace(/\\,/g, ",").split(/\s+/).filter(Boolean).join(" ");

  if (ONLINE.test(text)) return ["Online", text];

  // "Keplergebäude, HS 1" -> rechten Teil als Raum parsen
  const comma = text.indexOf(",");
  if (comma !== -1) {
    const left = text.slice(0, comma).trim();
    const right = text.slice(comma + 1).trim();
    const [b, r] = parseRoom(right);
    return [b && b !== right ? b : left, r || right];
  }

  let m = text.match(HS);
  if (m) return ["Hörsaaltrakt", `HS ${m[2].toUpperCase()}`];

  m = text.match(CODE);
  if (m) {
    const prefix = m[1].toUpperCase();
    if (BUILDINGS[prefix]) return [BUILDINGS[prefix], `${prefix} ${m[2]}`];
  }
  return [null, text];
}

export function formatRoom(building, room) {
  if (building && room) return `${building} · ${room}`;
  return room || building || "";
}
