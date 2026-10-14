// Beispieltermine für den Demo-Modus (Variable DEMO=1), damit die App ohne KUSSS-Link läuft.
import { viennaToUtc } from "./ical.js";

// [Wochentag 0=Mo, Start, Ende, LVA-Nr, Typ, Titel, Ort]
const WEEK = [
  [0, "08:30", "10:00", "336.100", "VL", "Analysis 1", "HS 1"],
  [0, "10:15", "11:45", "336.101", "UE", "Analysis 1", "S3 055"],
  [1, "12:00", "13:30", "351.001", "VL", "Softwareentwicklung 1", "HS 18"],
  [2, "08:30", "10:00", "351.002", "UE", "Softwareentwicklung 1", "K 224B"],
  [2, "13:45", "15:15", "336.200", "VL", "Lineare Algebra", "HS 9"],
  [3, "10:15", "11:45", "336.201", "UE", "Lineare Algebra", "T 911"],
  [4, "08:30", "11:45", "351.010", "KS", "Algorithmen & Datenstrukturen", "Online (Zoom)"],
];

export function demoEvents() {
  const now = new Date();
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7)));
  const out = [];
  for (let week = -1; week < 6; week++) {
    for (const [wd, s, e, nr, kind, title, loc] of WEEK) {
      const d = new Date(monday.getTime() + (wd + 7 * week) * 86400_000);
      const [y, mo, day] = [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
      const [sh, sm] = s.split(":").map(Number), [eh, em] = e.split(":").map(Number);
      out.push({
        uid: `demo-${nr}-${d.toISOString().slice(0, 10)}@studo.plus`, courseId: nr, title, kind,
        start: viennaToUtc(y, mo, day, sh, sm), end: viennaToUtc(y, mo, day, eh, em),
        location: loc, description: null, cancelled: false,
      });
    }
  }
  // Eine Teilklausur und eine Präsentation, damit die Prüfungsanzeige etwas zeigt
  const exam = (days, h, nr, title, desc) => {
    const d = new Date(monday.getTime() + days * 86400_000);
    const [y, mo, day] = [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
    out.push({ uid: `demo-exam-${days}@studo.plus`, courseId: nr, title, kind: "VL",
      start: viennaToUtc(y, mo, day, h, 0), end: viennaToUtc(y, mo, day, h + 1, 30), location: "HS 1", description: desc, cancelled: false });
  };
  exam(10, 16, "336.100", "Analysis 1", "1. Teilklausur");
  exam(17, 14, "351.001", "Softwareentwicklung 1", "Präsentation der Projekte");
  return out;
}
