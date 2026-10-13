// Unterstützte Hochschulen. Die JKU hat einen vollautomatischen Login (Shibboleth + KUSSS),
// alle anderen funktionieren über den persönlichen iCal-Link, den fast jedes Uni-System
// (CAMPUSonline, TISS, u:space, …) anbietet. Neue Unis = ein Eintrag in dieser Liste.

export const UNIS = {
  jku: {
    name: "JKU Linz",
    auth: "jku",
    userLabel: "Matrikelnummer",
    userPlaceholder: "12345678",
    icalHint: "KUSSS → Studierzimmer → Terminexport → Kalender Abonnement → Create.",
    rooms: "jku",
    // Einstiegs-URLs, die direkt das JKU-Single-Sign-on auslösen: Wer im Browser schon
    // einmal angemeldet ist, landet ohne erneute Passworteingabe im jeweiligen System.
    links: [
      { id: "kusss", name: "KUSSS", url: "https://www.kusss.jku.at/kusss/login.action", icon: "grid" },
      { id: "moodle", name: "Moodle", url: "https://moodle.jku.at/jku/login/index.php", icon: "book" },
      { id: "lisss", name: "LISSS", url: "https://lisss.jku.at/", icon: "library" },
      { id: "mail", name: "JKU-Mail", url: "https://outlook.office.com/mail/", icon: "mail" },
      { id: "handbuch", name: "Studienhandbuch", url: "https://studienhandbuch.jku.at/", icon: "search" },
      { id: "oeh", name: "ÖH JKU", url: "https://oeh.jku.at/", icon: "people" },
    ],
  },
  tuwien: {
    name: "TU Wien",
    auth: "local",
    userLabel: "Matrikelnummer",
    userPlaceholder: "e12345678",
    icalHint: "TISS → Favoriten / Terminkalender → iCal-Export, Link kopieren.",
    links: [
      { id: "tiss", name: "TISS", url: "https://tiss.tuwien.ac.at/", icon: "grid" },
      { id: "tuwel", name: "TUWEL", url: "https://tuwel.tuwien.ac.at/", icon: "book" },
      { id: "mail", name: "Mail", url: "https://outlook.office.com/mail/", icon: "mail" },
    ],
  },
  univie: {
    name: "Universität Wien",
    auth: "local",
    userLabel: "u:account",
    userPlaceholder: "a12345678",
    icalHint: "u:space → Stundenplan → Kalender abonnieren (iCal), Link kopieren.",
    links: [
      { id: "uspace", name: "u:space", url: "https://uspace.univie.ac.at/", icon: "grid" },
      { id: "moodle", name: "Moodle", url: "https://moodle.univie.ac.at/", icon: "book" },
      { id: "ufind", name: "u:find", url: "https://ufind.univie.ac.at/", icon: "search" },
    ],
  },
  tugraz: {
    name: "TU Graz",
    auth: "local",
    userLabel: "Benutzername",
    userPlaceholder: "Benutzername",
    icalHint: "TUGRAZonline → Mein Kalender → Exportieren / Abonnieren, Link kopieren.",
    links: [
      { id: "online", name: "TUGRAZonline", url: "https://online.tugraz.at/", icon: "grid" },
      { id: "tc", name: "TeachCenter", url: "https://tc.tugraz.at/", icon: "book" },
      { id: "mail", name: "Mail", url: "https://outlook.office.com/mail/", icon: "mail" },
    ],
  },
  unigraz: {
    name: "Universität Graz",
    auth: "local",
    userLabel: "Benutzername",
    userPlaceholder: "Benutzername",
    icalHint: "UNIGRAZonline → Mein Kalender → Exportieren / Abonnieren, Link kopieren.",
    links: [
      { id: "online", name: "UNIGRAZonline", url: "https://online.uni-graz.at/", icon: "grid" },
      { id: "moodle", name: "Moodle", url: "https://moodle.uni-graz.at/", icon: "book" },
      { id: "mail", name: "Mail", url: "https://outlook.office.com/mail/", icon: "mail" },
    ],
  },
  wu: {
    name: "WU Wien",
    auth: "local",
    userLabel: "Matrikelnummer",
    userPlaceholder: "h12345678",
    icalHint: "LPIS bzw. Learn@WU → Kalender → iCal-Abo, Link kopieren.",
    links: [
      { id: "lpis", name: "LPIS", url: "https://lpis.wu.ac.at/", icon: "grid" },
      { id: "learn", name: "Learn@WU", url: "https://learn.wu.ac.at/", icon: "book" },
      { id: "mail", name: "Mail", url: "https://outlook.office.com/mail/", icon: "mail" },
    ],
  },
  uibk: {
    name: "Universität Innsbruck",
    auth: "local",
    userLabel: "Benutzername",
    userPlaceholder: "csaa1234",
    icalHint: "LFU:online → Mein Kalender → Exportieren / Abonnieren, Link kopieren.",
    links: [
      { id: "lfu", name: "LFU:online", url: "https://lfuonline.uibk.ac.at/", icon: "grid" },
      { id: "olat", name: "OLAT", url: "https://lms.uibk.ac.at/", icon: "book" },
      { id: "mail", name: "Mail", url: "https://outlook.office.com/mail/", icon: "mail" },
    ],
  },
  plus: {
    name: "Universität Salzburg",
    auth: "local",
    userLabel: "Benutzername",
    userPlaceholder: "Benutzername",
    icalHint: "PLUSonline → Mein Kalender → Exportieren / Abonnieren, Link kopieren.",
    links: [
      { id: "online", name: "PLUSonline", url: "https://online.uni-salzburg.at/", icon: "grid" },
      { id: "web", name: "PLUS", url: "https://www.plus.ac.at/", icon: "book" },
      { id: "mail", name: "Mail", url: "https://outlook.office.com/mail/", icon: "mail" },
    ],
  },
  other: {
    name: "Andere Hochschule",
    auth: "local",
    userLabel: "Benutzername",
    userPlaceholder: "frei wählbar",
    icalHint: "Im Uni-System nach „Kalender exportieren“, „iCal“ oder „abonnieren“ suchen und den Link kopieren.",
    links: [],
  },
};

/** Öffentliche Sicht für den Login-Bildschirm (ohne interne Felder). */
export function publicUnis() {
  return Object.entries(UNIS).map(([id, u]) => ({
    id, name: u.name, auto: u.auth === "jku", userLabel: u.userLabel, userPlaceholder: u.userPlaceholder,
  }));
}

/** Benutzername vereinheitlichen. JKU: Matrikelnummer mit oder ohne "k" -> "k12345678". */
export function normalizeUser(username, uni = null) {
  const u = String(username || "").trim().toLowerCase().replace(/\s+/g, "");
  if (uni === "jku" && /^k?\d{6,9}$/.test(u)) return `k${u.replace(/^k/, "")}`;
  return u;
}

/** Matrikelnummer zur Anzeige (JKU ohne "k"). */
export function matrikel(uni, username) {
  return uni === "jku" ? String(username || "").replace(/^k/, "") : String(username || "");
}

export const USER_RE = /^[a-z0-9][a-z0-9._@+-]{1,63}$/;

