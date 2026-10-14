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
  return out;
}

/** Beispiel-Abgaben wie aus Moodle, relativ zu heute. */
export function demoDeadlines() {
  const at = (days, h) => {
    const d = new Date(Date.now() + days * 86400_000);
    return viennaToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), h, 0);
  };
  return [
    { uid: "demo-moodle-1@studo.plus", title: "Übungsblatt 3", course: "Analysis 1", due: at(2, 23), note: null },
    { uid: "demo-moodle-2@studo.plus", title: "Projektbericht Teil 1", course: "Softwareentwicklung 1", due: at(9, 12), note: null },
  ];
}

/** Beispiel-Prüfungsanmeldungen wie aus KUSSS (Wiener Ortszeit). */
export function demoExamRegs() {
  const day = (n) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);
  return [
    { nr: "336.200", title: "Lineare Algebra", date: `${day(7)}T10:15`, until: `${day(1)}T23:59`, registered: false },
    { nr: "336.100", title: "Analysis 1", date: `${day(30)}T08:30`, until: `${day(20)}T23:59`, registered: true },
  ];
}
