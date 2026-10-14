// Studo+ Frontend – bewusst ohne Framework. Fünf Tabs, Unterseiten wie in iOS (mit Zurück), eigener Admin-Bereich.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const state = {
  me: null, unis: [], tab: "home",
  cal: { mode: "day", day: midnight(new Date()), scrolled: "" },
  sem: null, coursesData: null, gradesData: null, program: "all",
};
const WD = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const TAB_TITLES = { home: "Home", calendar: "Kalender", courses: "Kurse", study: "Studium", settings: "Einstellungen" };
const HOUR = 48, H0 = 6, H1 = 23;
const fmtTime = new Intl.DateTimeFormat("de-AT", { hour: "2-digit", minute: "2-digit" });
const fmtDay = new Intl.DateTimeFormat("de-AT", { weekday: "long", day: "numeric", month: "long" });
const fmtDayShort = new Intl.DateTimeFormat("de-AT", { weekday: "short", day: "numeric", month: "short" });
const fmtMonth = new Intl.DateTimeFormat("de-AT", { month: "long", year: "numeric" });
const fmtWeek = new Intl.DateTimeFormat("de-AT", { day: "numeric", month: "short" });
const fmtShort = new Intl.DateTimeFormat("de-AT", { day: "numeric", month: "numeric" });
const fmtDate = new Intl.DateTimeFormat("de-AT", { day: "numeric", month: "numeric", year: "numeric" });
const fmtNum = new Intl.NumberFormat("de-AT", { maximumFractionDigits: 2 });
const fmtAvg = new Intl.NumberFormat("de-AT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Service Worker: lädt neue Versionen im Hintergrund. Ob eine neuere Version online ist, prüft die
// App selbst (Versionsnummer in sw.js), denn iOS meldet einen Wechsel des Service Workers nicht
// zuverlässig. Dann erscheint oben ein Banner wie eine iOS-Mitteilung mit Knopf zum Neustarten.
const BUILD = "studo-v23"; // muss zu VERSION in sw.js passen (Test prüft das)
let swReg = null;
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").then((reg) => { swReg = reg; }).catch(() => {});
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkForUpdate(); });
  setTimeout(checkForUpdate, 2500);
}
let lastUpdateCheck = 0;
async function checkForUpdate() {
  if (Date.now() - lastUpdateCheck < 30_000 || document.querySelector(".update-toast")) return;
  lastUpdateCheck = Date.now();
  try {
    const res = await fetch(`/sw.js?check=${Date.now()}`, { cache: "no-store" });
    const online = (await res.text()).match(/const VERSION = "([^"]+)"/)?.[1];
    if (online && online !== BUILD) { swReg?.update().catch(() => {}); showUpdateToast(); }
  } catch { /* offline: später erneut */ }
}
// Neue Version übernehmen: Service Worker aktualisieren, kurz auf den Wechsel warten, neu laden
async function applyUpdate() {
  try {
    await swReg?.update();
    if (swReg?.installing || swReg?.waiting) {
      await new Promise((ok) => { navigator.serviceWorker.addEventListener("controllerchange", ok, { once: true }); setTimeout(ok, 6000); });
    }
  } catch { /* trotzdem neu laden */ }
  location.reload();
}
function showUpdateToast() {
  if (document.querySelector(".update-toast")) return;
  const t = el("div", "update-toast"); t.setAttribute("role", "status");
  const icon = el("img", "update-icon"); icon.src = "/icons/icon-192.png"; icon.alt = "";
  const txt = el("div", "update-text");
  txt.append(el("strong", "", "Neue Version verfügbar"), el("span", "", "Bereit zum Installieren."));
  const b = el("button", "", "Neu starten");
  b.addEventListener("click", (e) => { e.stopPropagation(); haptic(); b.disabled = true; b.textContent = "Lädt …"; applyUpdate(); });
  t.append(icon, txt, b);
  document.body.append(t);
  // Hereinfedern wie eine iOS-Mitteilung, dabei ein kurzes Tippen
  requestAnimationFrame(() => requestAnimationFrame(() => { t.classList.add("in"); haptic(); }));
  // Nach oben wischen blendet das Banner aus (bis zum nächsten Öffnen der App)
  let y0 = null, dy = 0;
  t.addEventListener("touchstart", (e) => { y0 = e.touches[0].clientY; dy = 0; t.classList.add("drag"); }, { passive: true });
  t.addEventListener("touchmove", (e) => {
    if (y0 === null) return;
    dy = e.touches[0].clientY - y0;
    t.style.transform = `translate3d(0, ${dy < 0 ? dy : Math.sqrt(dy) * 3}px, 0)`; // nach unten nur Gummiband
  }, { passive: true });
  t.addEventListener("touchend", () => {
    y0 = null; t.classList.remove("drag"); t.style.transform = "";
    if (dy < -30) { t.classList.remove("in"); haptic(); setTimeout(() => t.remove(), 500); lastUpdateCheck = Date.now(); }
  });
}

// ---------- Erscheinungsbild (Standard: hell) ----------
function getTheme() { try { return localStorage.getItem("studo_theme") || "light"; } catch { return "light"; } }
const darkQuery = matchMedia("(prefers-color-scheme: dark)");
function applyTheme(theme = getTheme()) {
  document.documentElement.dataset.theme = theme;
  const dark = theme === "dark" || (theme === "auto" && darkQuery.matches);
  // iOS übernimmt eine geänderte Farbe der Statusleiste oft erst verzögert: Meta-Tag neu einsetzen
  const color = dark ? "#000000" : "#F2F2F7", old = $("#theme-color");
  if (old.content !== color) {
    const meta = document.createElement("meta");
    meta.name = "theme-color"; meta.id = "theme-color"; meta.content = color;
    old.replaceWith(meta);
  }
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  $$("#theme-seg button").forEach((b) => b.classList.toggle("on", b.dataset.theme === theme));
}
applyTheme();
darkQuery.addEventListener?.("change", () => applyTheme());
$$("#theme-seg button").forEach((b) => b.addEventListener("click", () => {
  try { localStorage.setItem("studo_theme", b.dataset.theme); } catch {}
  applyTheme(b.dataset.theme); haptic();
}));

// ---------- Start-Animation ----------
const splashStarted = Date.now();
function endSplash() {
  const html = document.documentElement;
  const splash = $("#splash");
  if (!splash || html.classList.contains("splash-done")) return;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const hold = Math.max(0, (reduced ? 100 : 1500) - (Date.now() - splashStarted));
  let done = false;
  const finish = () => { if (done) return; done = true; splash.remove(); html.classList.add("splash-done"); };
  setTimeout(() => {
    splash.classList.add("is-leaving");
    html.classList.remove("splashing");
    splash.addEventListener("animationend", (e) => { if (e.target === splash) finish(); });
    setTimeout(finish, 1000);
  }, hold);
}

// ---------- API ----------
const NO_REDIRECT = new Set(["/api/login", "/api/jku/connect", "/api/grades/refresh"]);
async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    credentials: "same-origin",
  });
  if (res.status === 401 && !NO_REDIRECT.has(path) && !path.startsWith("/api/admin")) { showLogin(); throw new Error("Nicht angemeldet"); }
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) { const e = new Error(data?.detail || `Fehler ${res.status}`); e.status = res.status; throw e; }
  return data;
}
const put = (path, body) => api(path, { method: "PUT", body: JSON.stringify(body) });
const post = (path, body) => api(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

// ---------- Hilfen ----------
function midnight(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function startOfWeek(d) { const x = midnight(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function dayKey(d) { return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }
function ago(iso) {
  if (!iso) return "nie";
  const min = Math.round((Date.now() - new Date(iso)) / 60000);
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} Min.`;
  const h = Math.round(min / 60);
  if (h < 24) return `vor ${h} Std.`;
  const d = Math.round(h / 24);
  return d === 1 ? "gestern" : `vor ${d} Tagen`;
}
function inDays(d) {
  const n = Math.round((midnight(d) - midnight(new Date())) / 86400000);
  return n === 0 ? "Heute" : n === 1 ? "Morgen" : fmtDayShort.format(d);
}

// Haptik: Android über vibrate(). iOS hat dafür keine Schnittstelle, aber ein Schalter (<input switch>,
// Safari 18) gibt beim Umschalten ein Taptic-Feedback, auch wenn er über ein verstecktes Label ausgelöst wird.
function haptic() {
  if (navigator.vibrate) { navigator.vibrate(8); return; }
  // Jedes Mal ein frischer, unsichtbarer Schalter: ein wiederverwendeter gibt auf iOS nicht zuverlässig Feedback
  try {
    const label = document.createElement("label");
    label.ariaHidden = "true"; label.style.display = "none";
    const sw = document.createElement("input"); sw.type = "checkbox"; sw.setAttribute("switch", "");
    label.append(sw); document.head.append(label);
    label.click();
    label.remove();
  } catch { /* ohne Haptik */ }
}

const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
// Zahl hochzählen (iOS-artig abbremsend); onStep bekommt den Fortschritt 0..1 für Haptik-Ticks
function countUp(node, to, { dur = 1100, fmt = (v) => String(Math.round(v)), onStep } = {}) {
  if (REDUCED || !to) { node.textContent = fmt(to); return; }
  const t0 = performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const tick = (now) => {
    const t = Math.min(1, (now - t0) / dur), k = ease(t);
    node.textContent = fmt(to * k);
    onStep?.(k);
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}
function svg(inner, cls) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24"); if (cls) s.setAttribute("class", cls);
  s.innerHTML = inner; return s;
}
const chev = () => svg('<path d="M9 5l7 7-7 7"/>', "chev");
function row(label, value, cls = "") {
  const r = el("div", `row ${cls}`); r.append(el("span", "", label), el("span", "muted", value ?? "–")); return r;
}
function group(...rows) { const g = el("div", "group"); g.append(...rows.filter(Boolean)); return g; }
function navRow(label, onClick, value) {
  const r = el("button", "row row-nav");
  r.append(el("span", "", label));
  if (value) r.append(el("span", "value", value));
  r.append(chev());
  r.addEventListener("click", onClick);
  return r;
}
function header(text) { return el("h2", "section-header", text); }
function note(text) { return el("p", "footnote", text); }

// LVA-Art immer zuerst: "VL Analysis 1"
function titleWithKind(kind, title, tag = "span") {
  const n = el(tag);
  if (kind) n.append(el("span", "kind", kind));
  n.append(document.createTextNode(title));
  return n;
}

// Art eines Termins (Klausur, Vortrag, …): Farbe nach Gruppe
const TAGS = {
  klausur: "Klausur", teilklausur: "Teilklausur", nachklausur: "Nachklausur",
  vortrag: "Vortrag", praesentation: "Präsentation", abgabe: "Abgabe", einsicht: "Einsicht",
};
const TAG_SHORT = { teilklausur: "Teilkl.", nachklausur: "Nachkl.", praesentation: "Präs." };
// Die Art steht im Namen: "Klausur: Analysis 1" (außer der Titel sagt es schon selbst)
function tagName(ev) {
  const label = ev.tag && TAGS[ev.tag];
  return label && !ev.title.toLowerCase().includes(label.toLowerCase()) ? `${label}: ${ev.title}` : ev.title;
}
function evTitle(ev, node = "span") { return titleWithKind(ev.kind, tagName(ev), node); }

// Kurzname für die Wochenansicht: eigenes Kürzel, sonst aus den Anfangsbuchstaben der wichtigen Wörter
// ("Marktorientiertes Management: Grundlagen" -> "MMG", "Lineare Algebra" -> "LA", "Statistik" -> "Stati")
const STOP = new Set(["in", "die", "der", "das", "den", "dem", "des", "und", "für", "von", "zu", "zur", "zum", "mit", "im", "am", "an", "auf", "aus", "bei", "über", "the", "of", "and", "to", "for", "a", "an", "into", "on"]);
function autoShort(title) {
  const words = String(title || "").replace(/\(.*?\)/g, " ").split(/[\s/:,–-]+/).filter((w) => w && !STOP.has(w.toLowerCase()));
  if (!words.length) return "";
  const text = words.filter((w) => !/^(\d+|[IVX]+)$/.test(w)), nums = words.filter((w) => /^(\d+|[IVX]+)$/.test(w));
  // Ein einziges Wort (+ Nummer): Wortanfang statt nur Initiale ("Analysis 1" -> "Analy 1")
  if (text.length === 1) return [text[0].slice(0, 5), ...nums].join(" ");
  return words.map((w) => (/^\d+$/.test(w) ? w : /^[IVX]+$/.test(w) ? w : w[0].toUpperCase())).join("").slice(0, 6);
}
const shortName = (x) => x.short || autoShort(x.title);

// Initialen aus dem echten Namen ("Jacob Haselgruber" -> "JH"), sonst Personen-Symbol
function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter((p) => /^\p{L}/u.test(p));
  if (!parts.length) return "";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
function setAvatar(node, me = state.me) {
  if (me?.avatar) { const img = el("img"); img.src = me.avatar; img.alt = ""; node.replaceChildren(img); return; }
  const ini = initials(me?.name);
  if (ini) node.textContent = ini;
  else node.replaceChildren(svg('<circle cx="12" cy="8.5" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7z"/>'));
}
function firstName(name) { return String(name || "").trim().split(/\s+/)[0] || ""; }

// KUSSS liefert Semester teils als "2024W"/"2025S" – einheitlich "WS 2024/25"/"SS 2025"
function normSem(s) {
  const m = /^(\d{4})\s*([WS])$/i.exec(String(s || "").trim());
  if (!m) return s || null;
  const y = +m[1];
  return m[2].toUpperCase() === "W" ? `WS ${y}/${String(y + 1).slice(2)}` : `SS ${y}`;
}
function semSort(s) { const m = /(WS|SS) (\d{4})/.exec(s || ""); return m ? +m[2] * 2 + (m[1] === "WS" ? 1 : 0) : -1; }
function semShort(s) { return String(s).replace(/^(WS|SS) (\d{2})(\d{2})(\/\d+)?$/, "$1 $3$4"); }

// Schalter mit sofortigem Feedback: UI ändert sich gleich, Server im Hintergrund, nur bei Fehler zurück
function makeSwitch(checked, onChange) {
  const sw = el("input", "switch");
  sw.type = "checkbox"; sw.setAttribute("switch", ""); sw.checked = checked;
  sw.addEventListener("change", async () => {
    if (navigator.vibrate) navigator.vibrate(8); // iOS: der Schalter gibt sein Taptic-Feedback selbst
    try { await onChange(sw.checked); } catch (err) { sw.checked = !sw.checked; alert(err.message); }
  });
  return sw;
}

// ---------- Unterseiten: Push-Navigation wie in iOS, mit Browser-Zurück ----------
// Verlauf ist immer genau [Sperre, Tab, Seite 1, …, Seite n] ohne Einträge "nach vorne":
// Zurück-Wischen geht so nur aus Unterseiten heraus, nie zu einem früheren Tab oder aus der App,
// und Vorwärts-Wischen öffnet keine alten Seiten wieder.
const stack = [];
const shade = el("div", "page-shade");
document.body.append(shade);
let navLockUntil = 0, ownBack = false, settling = false;
const navLocked = () => Date.now() < navLockUntil;
const lockNav = (ms = 480) => { navLockUntil = Date.now() + ms; };
// Als Home-Bildschirm-App gibt es keinen Browser-Verlauf: dann hat iOS keine eigene Zurück-Geste
// (die zeigte veraltete, teils helle Bildschirmfotos) und wir wischen selbst – nur aus Unterseiten.
const STANDALONE = navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
if (!STANDALONE) {
  history.replaceState({ depth: -1 }, "");
  history.pushState({ depth: 0 }, "");
}

function pushPage(title, build, { head = true } = {}) {
  if (navLocked()) return null; // Doppeltipp öffnet nicht zwei Seiten übereinander
  lockNav();
  const prevTitle = stack.length ? stack[stack.length - 1].title : TAB_TITLES[state.tab];
  const page = el("div", "page");
  const bar = el("div", "navbar");
  const back = el("button", "back");
  back.append(svg('<path d="M15 5l-7 7 7 7"/>'), el("span", "", prevTitle));
  back.addEventListener("click", goBack);
  bar.append(back, el("div", "navbar-title", title), el("div"));
  const body = el("div", "page-body");
  page.append(bar, body);
  if (!head) page.classList.add("plain");
  const entry = { page, title, body, build };
  build(body, entry);
  page.addEventListener("scroll", () => page.classList.toggle("scrolled", page.scrollTop > 30), { passive: true });
  if (STANDALONE) enableEdgeSwipe(page);
  $("#pages").append(page);
  stack.at(-1)?.page.classList.add("under");
  stack.push(entry);
  shade.classList.add("on");
  document.body.classList.add("locked");
  // Während des Hereinschiebens keine Tipps annehmen (zweiter Tipp eines Doppeltipps landet sonst auf der neuen Seite)
  page.style.pointerEvents = "none";
  setTimeout(() => { page.style.pointerEvents = ""; }, 450);
  requestAnimationFrame(() => requestAnimationFrame(() => page.classList.add("in")));
  if (!STANDALONE) history.pushState({ depth: stack.length }, "");
  return entry;
}
function goBack() {
  if (!stack.length || navLocked()) return;
  lockNav();
  if (STANDALONE) popTop(true);
  else { ownBack = true; history.back(); }
}
function refreshPage(entry) { entry.body.replaceChildren(); entry.build(entry.body, entry); }
function popTop(animate = true) {
  const top = stack.pop();
  if (!top) return;
  if (animate) {
    top.page.classList.remove("in");
    setTimeout(() => top.page.remove(), 460);
  } else top.page.remove(); // System-Wischgeste hat schon animiert
  const prev = stack.at(-1);
  if (prev) {
    if (!animate) prev.page.classList.add("no-anim");
    prev.page.classList.remove("under");
    if (!animate) requestAnimationFrame(() => prev.page.classList.remove("no-anim"));
    if (prev.refresh) prev.refresh();
  }
  else { shade.classList.remove("on"); document.body.classList.toggle("locked", state.tab === "calendar"); for (const w of weekCache.values()) w.at = 0; renderTab(state.tab); }
}
addEventListener("popstate", (e) => {
  if (STANDALONE) return;
  const depth = e.state?.depth ?? -1;
  if (settling) {
    // Wieder bei der Sperre angekommen: Tab + offene Seiten neu eintragen, Vorwärts-Verlauf ist damit weg
    if (depth !== -1) return;
    settling = false;
    for (let d = 0; d <= stack.length; d++) history.pushState({ depth: d }, "");
    return;
  }
  const animate = ownBack;
  ownBack = false;
  while (stack.length > Math.max(0, depth)) popTop(animate);
  lockNav(animate ? 480 : 250);
  settling = true;
  if (depth === -1) { settling = false; history.pushState({ depth: 0 }, ""); }
  else history.go(-(depth + 1));
});
function closeAllPages() {
  const n = stack.length;
  while (stack.length) stack.pop().page.remove();
  shade.classList.remove("on"); document.body.classList.toggle("locked", state.tab === "calendar" && !$("#app").hidden);
  if (n && !STANDALONE) { settling = true; history.go(-(n + 1)); }
}

// Vom linken Rand wischen schließt die oberste Unterseite (nur Home-Bildschirm-App, s. o.)
function enableEdgeSwipe(page) {
  let x0 = null, dx = 0, t0 = 0, dir = null, y0 = 0;
  const under = () => stack.at(-2)?.page;
  page.addEventListener("touchstart", (e) => {
    if (e.touches[0].clientX > 30 || stack.at(-1)?.page !== page || navLocked()) return;
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; dir = null; t0 = Date.now();
  }, { passive: true });
  page.addEventListener("touchmove", (e) => {
    if (x0 === null) return;
    const mx = e.touches[0].clientX - x0, my = e.touches[0].clientY - y0;
    if (!dir) { if (Math.abs(mx) < 6 && Math.abs(my) < 6) return; dir = mx > Math.abs(my) ? "h" : "v"; if (dir === "v") { x0 = null; return; }
      page.classList.add("no-anim"); under()?.classList.add("no-anim"); }
    e.preventDefault();
    dx = Math.max(0, mx);
    const f = dx / innerWidth;
    page.style.transform = `translate3d(${dx}px,0,0)`;
    const u = under(); if (u) u.style.transform = `translate3d(${-28 * (1 - f)}%,0,0)`;
    shade.style.opacity = String(1 - f);
  }, { passive: false });
  const end = () => {
    if (x0 === null) return;
    x0 = null;
    page.classList.remove("no-anim"); under()?.classList.remove("no-anim");
    const fast = dx / Math.max(1, Date.now() - t0) > 0.5;
    const close = dx > innerWidth * 0.35 || (fast && dx > 40);
    requestAnimationFrame(() => {
      page.style.transform = ""; shade.style.opacity = "";
      const u = under(); if (u) u.style.transform = "";
      if (close) { lockNav(); popTop(true); }
    });
  };
  page.addEventListener("touchend", end);
  page.addEventListener("touchcancel", end);
}

// Formular-Seite (Note hinzufügen, KUSSS-Passwort, Studienrichtung …)
function formPage(title, fields, submitLabel, onSubmit, footnote) {
  pushPage(title, (body) => {
    const form = el("form");
    const g = el("div", "group");
    for (const f of fields) {
      const l = el("label", "row");
      let input;
      if (f.options) { input = el("select"); input.append(...f.options.map(([v, t]) => new Option(t, v))); }
      else { input = el("input"); input.type = f.type || "text"; if (f.placeholder) input.placeholder = f.placeholder; if (f.inputmode) input.inputMode = f.inputmode; }
      input.name = f.name; if (f.required) input.required = true; if (f.value !== undefined && f.value !== null) input.value = f.value;
      if (f.autocomplete) input.autocomplete = f.autocomplete;
      if (f.onChange) input.addEventListener("change", () => f.onChange(input, form));
      l.append(el("span", "row-label", f.label), input);
      if (f.hidden) l.hidden = true;
      g.append(l);
    }
    const btn = el("button", "btn-primary", submitLabel); btn.type = "submit";
    const errP = el("p", "error");
    form.append(g, ...(footnote ? [note(footnote)] : []), btn, errP);
    form.addEventListener("submit", async (e) => {
      e.preventDefault(); errP.textContent = ""; btn.disabled = true;
      const old = btn.textContent; btn.textContent = "Bitte warten …";
      try { await onSubmit(Object.fromEntries(new FormData(form)), form); navLockUntil = 0; goBack(); }
      catch (err) { errP.textContent = err.message; }
      finally { btn.disabled = false; btn.textContent = old; }
    });
    body.append(el("div", "page-head", undefined), form);
    $(".page-head", body).append(el("h1", "", title));
  });
}

// ---------- Login ----------
function hideAll() { ["#login", "#admin-login", "#admin-screen", "#app"].forEach((s) => ($(s).hidden = true)); closeAllPages(); }
function showLogin() {
  hideAll(); $("#login").hidden = false; endSplash();
  loadUnis();
}

// Auswahl immer neu füllen: Die Liste kann schon geladen sein (z. B. nach dem Abmelden),
// das Auswahlfeld enthält dann aber noch den Platzhalter "JKU Linz" aus index.html
async function loadUnis() {
  if (!state.unis.length) { try { state.unis = await api("/api/unis"); } catch { return; } }
  const sel = $("#login-uni");
  sel.replaceChildren(...state.unis.map((u) => { const o = el("option", "", u.name); o.value = u.id; return o; }));
  try { const last = localStorage.getItem("studo_uni"); if (last && state.unis.some((u) => u.id === last)) sel.value = last; } catch {}
  updateLoginHint();
}

function updateLoginHint() {
  const u = state.unis.find((x) => x.id === $("#login-uni").value);
  if (!u) return;
  const user = $("#login-user");
  user.placeholder = u.userLabel; user.setAttribute("aria-label", u.userLabel);
  $("#login-hint").textContent = u.auto
    ? "Mit deinem JKU-Account. Das Passwort wird nicht gespeichert."
    : `Beim ersten Login legst du ein eigenes Passwort fest und verbindest danach deinen Stundenplan per iCal-Link.`;
}
$("#login-uni").addEventListener("change", updateLoginHint);

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const btn = $("#login-form .btn-primary");
  const uni = state.unis.find((x) => x.id === f.get("uni"));
  btn.disabled = true; $(".spinner", btn).hidden = false;
  $(".label", btn).textContent = uni?.auto ? "Verbinde mit KUSSS …" : "Anmelden …";
  $("#login-error").textContent = "";
  try {
    await post("/api/login", { uni: f.get("uni"), username: f.get("username"), password: f.get("password") });
    try { localStorage.setItem("studo_uni", f.get("uni")); } catch {}
    e.target.reset();
    await boot();
  } catch (err) { $("#login-error").textContent = err.message; }
  finally { btn.disabled = false; $(".spinner", btn).hidden = true; $(".label", btn).textContent = "Anmelden"; }
});

// ---------- Admin (eigenes Konto, getrennt von Studierenden) ----------
$("#to-admin").addEventListener("click", () => { hideAll(); $("#admin-login").hidden = false; $("#admin-form [name=password]").focus(); });
$("#admin-back-login").addEventListener("click", showLogin);
$("#admin-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  $("#admin-error").textContent = "";
  try {
    await post("/api/admin/login", { username: f.get("username"), password: f.get("password") });
    e.target.reset(); $("#admin-form [name=username]").value = "admin";
    await showAdmin();
  } catch (err) { $("#admin-error").textContent = err.status === 401 ? "Benutzer oder Passwort falsch." : err.message; }
});
$("#admin-logout").addEventListener("click", async () => { await post("/api/admin/logout").catch(() => {}); showLogin(); });

async function showAdmin() {
  const data = await api("/api/admin/overview");
  hideAll(); $("#admin-screen").hidden = false; endSplash();
  renderAdmin(data);
}

async function renderAdmin(data) {
  const t = data.totals;
  $("#admin-updated").textContent = `Stand ${fmtTime.format(new Date())} Uhr`;
  const stats = [
    [t.users, "Konten"], [t.active_7d, "aktiv (7 Tage)"],
    [t.active_1d, "aktiv (heute)"], [t.connected, "mit Stundenplan"],
    [t.opens, "App geöffnet"], [t.feed_hits, "Kalender-Abrufe"],
    [t.logins, "Logins"], [t.syncs, "Synchronisierungen"],
  ];
  $("#admin-stats").replaceChildren(...stats.map(([v, l]) => {
    const s = el("div", "stat"); s.append(el("div", "stat-value", String(v)), el("div", "stat-label", l)); return s;
  }));
  const max = Math.max(1, ...data.days.map((d) => d.opens + d.logins + d.feed));
  $("#admin-chart").replaceChildren(...data.days.map((d, i) => {
    const col = el("div", "col");
    col.title = `${d.day}: ${d.opens + d.logins} App, ${d.feed} Kalender`;
    const a = el("div", "bar bar-a"); a.style.height = `${((d.opens + d.logins) / max) * 100}%`;
    const b = el("div", "bar bar-b"); b.style.height = `${(d.feed / max) * 100}%`;
    col.append(b, a);
    if (i % 3 === 1 || i === 13) col.append(el("span", "lbl", fmtShort.format(new Date(d.day))));
    return col;
  }));
  if (!state.unis.length) state.unis = await api("/api/unis").catch(() => []);
  const names = Object.fromEntries(state.unis.map((u) => [u.id, u.name]));
  const unis = Object.entries(data.by_uni).sort((a, b) => b[1] - a[1]);
  $("#admin-unis").replaceChildren(...(unis.length ? unis : [["–", 0]]).map(([id, n]) => row(names[id] || id, String(n))));
  $("#admin-users").replaceChildren(...(data.users.length ? data.users.map((u) => {
    const r = el("div", "row user-row");
    const head = el("div", "user-head");
    const name = el("strong", "", u.username);
    if (u.verified) name.append(el("span", "badge ok", "bestätigt"));
    if (!u.connected) name.append(el("span", "badge", "ohne Stundenplan"));
    const last = [u.last_open, u.last_login, u.last_feed].filter(Boolean).sort().pop();
    head.append(name, el("span", "muted", ago(last)));
    r.append(head,
      el("div", "user-meta", `${names[u.uni] || u.uni} · seit ${new Date(u.created_at).toLocaleDateString("de-AT")}`),
      el("div", "user-meta", `${u.logins} Logins · ${u.opens}× geöffnet · ${u.feed_hits} Kalender-Abrufe · ${u.events} Termine`));
    return r;
  }) : [el("div", "row muted", "Noch keine Konten.")]));
}

// ---------- Tabs ----------
$$(".tabbar button").forEach((b) => b.addEventListener("click", () => {
  if (b.dataset.tab === state.tab) { window.scrollTo({ top: 0, behavior: "smooth" }); return; }
  haptic(); switchTab(b.dataset.tab);
  if (!REDUCED) b.querySelector("svg")?.animate([{ transform: "scale(.78)" }, { transform: "scale(1.08)", offset: .6 }, { transform: "none" }], { duration: 380, easing: "ease-out" });
}));
$("#avatar").addEventListener("click", openProfile);
$("#btn-profile").addEventListener("click", openProfile);
$("#btn-connection").addEventListener("click", openConnection);
$("#btn-abo").addEventListener("click", openAbo);
$("#btn-moodle").addEventListener("click", openMoodle);
$("#btn-push").addEventListener("click", openPush);

// Antippen von Chips und Segmenten: kurzes Einfedern
document.addEventListener("click", (e) => {
  const c = e.target.closest?.(".chip, .segmented button");
  if (c && !REDUCED) c.animate([{ transform: "scale(.92)" }, { transform: "scale(1.03)", offset: .6 }, { transform: "none" }], { duration: 300, easing: "ease-out" });
});

// Beim Öffnen eines Tabs gleiten die Blöcke dezent nacheinander herein (nicht bei Hintergrund-Updates)
function enterTab(name) {
  if (REDUCED || name === "calendar") return;
  const tab = $(`#tab-${name}`);
  const sel = name === "study" ? ".chart-box, #grade-list > *" : ".next, .group, .links, .stats, .chips, .section-header, .notice";
  [...tab.querySelectorAll(sel)].filter((n) => !n.hidden && n.offsetParent).slice(0, 10).forEach((n, i) =>
    n.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }],
      { duration: 380, delay: 30 + i * 35, easing: "cubic-bezier(.32,.72,0,1)", fill: "backwards" }));
}

// Segmentschalter wie bei iOS: ein Schieber gleitet zur gewählten Option statt hart umzuspringen
function syncSegment(seg) {
  const on = seg.querySelector("button.on");
  let thumb = seg.querySelector(".seg-thumb");
  if (!on) { thumb?.remove(); return; }
  if (!thumb) { thumb = el("span", "seg-thumb"); seg.prepend(thumb); seg.classList.add("has-thumb"); thumb.style.transition = "none"; }
  thumb.style.width = `${on.offsetWidth}px`;
  thumb.style.transform = `translateX(${on.offsetLeft - 2}px)`;
  if (thumb.style.transition === "none") requestAnimationFrame(() => (thumb.style.transition = ""));
}
new MutationObserver((list) => {
  const segs = new Set();
  for (const m of list) {
    const t = m.target.closest?.(".segmented");
    if (t) segs.add(t);
    for (const n of m.addedNodes || []) if (n.nodeType === 1) n.querySelectorAll?.(".segmented").forEach((x) => segs.add(x));
  }
  segs.forEach((s) => requestAnimationFrame(() => syncSegment(s)));
}).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
addEventListener("resize", () => $$(".segmented").forEach(syncSegment));

function switchTab(name) {
  state.tab = name;
  if (name === "study") state.studyIntro = true; // Ring und Balken beim Öffnen einmal animieren
  $$(".tabbar button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  $$(".tab").forEach((t) => (t.hidden = t.id !== `tab-${name}`));
  $("#appbar-title").textContent = TAB_TITLES[name] || "";
  document.body.classList.toggle("locked", name === "calendar" || stack.length > 0);
  window.scrollTo({ top: 0 });
  $("#appbar").classList.remove("scrolled");
  // Alter Inhalt bleibt unsichtbar, bis neu gerendert ist (höchstens 180 ms), dann gleitet alles einmal herein
  const tab = $(`#tab-${name}`), intro = !REDUCED && name !== "calendar";
  let shown = false;
  const show = () => {
    if (shown) return; shown = true;
    tab.classList.remove("entering");
    if (intro && state.tab === name) enterTab(name);
  };
  if (intro) tab.classList.add("entering");
  renderTab(name).finally(show);
  setTimeout(show, 180);
  requestAnimationFrame(() => $$(`#tab-${name} .segmented`).forEach(syncSegment)); // war versteckt -> Maße erst jetzt bekannt
}
function renderTab(name) {
  const run = { home: renderHome, calendar: renderCalendar, courses: renderCourses, study: renderStudy, settings: renderSettings }[name];
  return run ? Promise.resolve(run()).catch((err) => console.error(err)) : Promise.resolve();
}
// Waagrechtes Ziehen mit Richtungserkennung: senkrechtes Scrollen bleibt unberührt
function hDrag(target, { canStart = () => true, onMove, onEnd }) {
  let x0 = null, y0 = 0, t0 = 0, dir = null, dx = 0;
  target.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1 || !canStart(e)) { x0 = null; return; }
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now(); dir = null; dx = 0;
  }, { passive: true });
  target.addEventListener("touchmove", (e) => {
    if (x0 === null) return;
    const mx = e.touches[0].clientX - x0, my = e.touches[0].clientY - y0;
    if (!dir) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      dir = Math.abs(mx) > Math.abs(my) * 1.2 ? "h" : "v";
      if (dir === "v") { x0 = null; return; }
    }
    e.preventDefault();
    dx = mx; onMove(dx);
  }, { passive: false });
  const end = () => {
    if (x0 === null) return;
    x0 = null;
    if (dir === "h") onEnd(dx, dx / Math.max(1, Date.now() - t0));
  };
  target.addEventListener("touchend", end);
  target.addEventListener("touchcancel", () => { if (x0 !== null && dir === "h") { x0 = null; onEnd(0, 0); } x0 = null; });
}
const EASE = "cubic-bezier(.25,.8,.25,1)";

addEventListener("scroll", () => $$(".appbar").forEach((a) => a.classList.toggle("scrolled", scrollY > 40)), { passive: true });

async function fetchEvents(from, to) {
  return api(`/api/events?start=${encodeURIComponent(from.toISOString())}&end=${encodeURIComponent(to.toISOString())}`);
}
function errorBox(box, err, what = "Termine") {
  box.replaceChildren(el("div", "row empty-row", `${what} konnten nicht geladen werden: ${err.message}`));
}

// ---------- Termin-Zeile und Termin-Seite ----------
function evRow(ev) {
  const r = el("button", "row ev-row");
  r.classList.toggle("cancelled", ev.status === "cancelled");
  const s = new Date(ev.start), e = new Date(ev.end);
  const time = el("div", "ev-time", fmtTime.format(s));
  time.append(el("span", "", fmtTime.format(e)));
  const main = el("div", "ev-main");
  main.append(evTitle(ev, "div"), el("div", "ev-loc", ev.status === "cancelled" ? "Entfällt" : ev.location || "Ort unbekannt"));
  main.firstChild.className = "ev-title";
  r.append(time, el("div", "ev-bar"), main);
  if (ev.attendance) { const m = el("span", "must", "!"); m.title = "Anwesenheitspflicht"; r.append(m); } else r.append(el("span"));
  r.addEventListener("click", () => openEvent(ev));
  return r;
}

function openEvent(ev) {
  const course = state.coursesData?.courses.find((c) => c.course_id === ev.course_id);
  pushPage(ev.title, (body) => {
    const s = new Date(ev.start), e = new Date(ev.end);
    const head = el("div", "page-head");
    head.append(evTitle(ev, "h1"),
      el("p", "", `${fmtDay.format(s)} · ${fmtTime.format(s)} – ${fmtTime.format(e)}`));
    body.append(head);
    body.append(group(
      row("Ort", ev.location || "unbekannt"),
      ev.room_raw && ev.room_raw !== ev.room ? row("Laut Uni", ev.room_raw) : null,
      ev.note ? row("Notiz", ev.note) : null,
      course?.lecturer ? row("Lehrende", course.lecturer) : null,
      ev.status === "cancelled" ? row("Status", "Entfällt") : null,
    ));

    // Anwesenheitspflicht ist eine Zusatzfunktion: Kurs-Standard + optionale Ausnahme für diesen Termin
    const courseRow = el("label", "row");
    courseRow.append(el("span", "", "Alle Termine des Kurses"), makeSwitch(ev.course_attendance, async (v) => {
      await put(`/api/courses/${encodeURIComponent(ev.course_id)}/attendance`, { attendance: v });
      ev.course_attendance = v; if (!ev.is_override) ev.attendance = v;
      if (course) course.attendance = v;
    }));
    const segRow = el("div", "row row-stack");
    segRow.append(el("span", "", "Nur dieser Termin"));
    const seg = el("div", "segmented seg-full");
    const current = ev.is_override ? (ev.attendance ? "1" : "0") : "inherit";
    for (const [v, label] of [["inherit", "Wie Kurs"], ["1", "Pflicht"], ["0", "Keine"]]) {
      const b = el("button", v === current ? "on" : "", label);
      b.addEventListener("click", async () => {
        const value = v === "inherit" ? null : v === "1";
        try {
          await put(`/api/events/${encodeURIComponent(ev.uid)}/attendance`, { attendance: value });
          $$("button", seg).forEach((x) => x.classList.toggle("on", x === b)); haptic();
          ev.is_override = value !== null; ev.attendance = value === null ? ev.course_attendance : value;
        } catch (err) { alert(err.message); }
      });
      seg.append(b);
    }
    segRow.append(seg);
    body.append(header("Anwesenheitspflicht"), group(courseRow, segRow),
      note("Markierte Termine bekommen im Apple Kalender ein „!“ vor dem Namen."));

    // Art des Termins: aus KUSSS erkannt oder von Hand gewählt
    const tagBox = el("div", "row tag-picker");
    const tagNote = note("");
    const showTagNote = () => {
      tagNote.textContent = ev.tag_auto
        ? `Aus dem Uni-Kalender erkannt: ${TAGS[ev.tag_auto]}.${ev.tag !== ev.tag_auto ? " Du hast das geändert." : ""}`
        : "Steht dann im Namen des Termins, in der App und im Apple Kalender.";
    };
    const choices = [["", "Normal"], ...Object.entries(TAGS)];
    const btns = choices.map(([k, label]) => {
      const b = el("button", `chip${(ev.tag || "") === k ? " on" : ""}`, label);
      b.addEventListener("click", async () => {
        if ((ev.tag || "") === k) return;
        try {
          const r = await put(`/api/events/${encodeURIComponent(ev.uid)}/tag`, { tag: k || (ev.tag_auto ? "none" : null) });
          Object.assign(ev, { tag: r.tag, tag_auto: r.tag_auto, tag_manual: r.tag_manual });
          btns.forEach((x, i) => x.classList.toggle("on", choices[i][0] === (ev.tag || "")));
          const h1 = $(".page-head h1", body); h1.replaceWith(evTitle(ev, "h1"));
          weekCache.clear(); showTagNote(); haptic();
        } catch (err) { alert(err.message); }
      });
      return b;
    });
    tagBox.append(...btns); showTagNote();
    body.append(header("Art des Termins"), group(tagBox), tagNote);
    body.append(el("div", "group-spaced"), group(navRow("Kurs anzeigen", () => openCourse(ev.course_id))));
  });
}

// ---------- Tab: Home ----------
function greeting() {
  const h = new Date().getHours();
  const hi = h < 11 ? "Guten Morgen" : h < 18 ? "Hallo" : "Guten Abend";
  const n = firstName(state.me?.name);
  return n ? `${hi}, ${n}` : hi;
}

async function renderHome() {
  const now = new Date();
  $("#greeting").textContent = greeting();
  $("#today-date").textContent = fmtDay.format(now);
  const me = state.me;
  const notice = me.notice || me.last_sync_error || (!me.connected ? "Noch kein Stundenplan verbunden. Unter Einstellungen › Verbindung zur Uni richtest du ihn ein." : "");
  $("#notice").hidden = !notice; $("#notice").textContent = notice;

  const list = $("#today-list"), next = $("#next-card");
  let events;
  try { events = await fetchEvents(midnight(now), addDays(midnight(now), 14)); } catch (err) { next.replaceChildren(); errorBox(list, err); return; }
  const upcoming = events.find((e) => e.status !== "cancelled" && new Date(e.end) > now);
  next.replaceChildren();
  if (upcoming) {
    const s = new Date(upcoming.start), running = s <= now;
    const card = el("button", "next");
    const mins = Math.round((s - now) / 60000);
    const when = running ? "läuft gerade" : mins < 60 ? `in ${mins} Min.` : `${inDays(s)}, ${fmtTime.format(s)}`;
    const label = el("div", "next-label", "Als Nächstes · "); label.append(el("b", "", when));
    const t = titleWithKind(upcoming.kind, upcoming.title, "div"); t.className = "next-title";
    card.append(label, t, el("div", "next-meta", `${fmtTime.format(s)} – ${fmtTime.format(new Date(upcoming.end))} · ${upcoming.location || "Ort unbekannt"}`));
    card.addEventListener("click", () => openEvent(upcoming));
    next.append(card);
  }
  const todays = events.filter((e) => dayKey(new Date(e.start)) === dayKey(now));
  list.replaceChildren(...todays.map((e) => evRow(e)));
  if (!todays.length) list.append(el("div", "row empty-row", "Heute keine Termine"));
  renderExams(now).catch(() => {});
  renderCampus().catch(() => { $("#campus-head").hidden = $("#campus-card").hidden = true; });
  renderMensa(now).catch(() => { $("#mensa-head").hidden = $("#mensa-card").hidden = true; });
}

// Klausuren, Vorträge, Abgaben (auch aus Moodle) der nächsten Monate; nur sichtbar, wenn es welche gibt
async function loadDeadlines() {
  if (!state.me?.moodle?.connected) return [];
  if (!state.deadlines || Date.now() - state.deadlines.at > 60_000) state.deadlines = { at: Date.now(), list: await api("/api/deadlines") };
  return state.deadlines.list;
}
async function loadRegs() {
  if (!state.me?.uni?.auto) return { items: [] };
  if (!state.regs || Date.now() - state.regs.at > 60_000) state.regs = { at: Date.now(), ...(await api("/api/exam-regs")) };
  return state.regs;
}
function dueText(s, now = new Date()) {
  const n = Math.round((midnight(s) - midnight(now)) / 86400000);
  return n <= 1 ? `${inDays(s)}, ${fmtTime.format(s)}` : `in ${n} Tagen`;
}
// Alles Anstehende: Prüfungen/Vorträge, Moodle-Abgaben, offene Prüfungsanmeldungen
async function upcomingItems(now) {
  const [evs, dls, regs] = await Promise.all([
    fetchEvents(now, addDays(midnight(now), 150)).then((l) => l.filter((e) => e.tag && e.status !== "cancelled")),
    loadDeadlines().catch(() => []),
    loadRegs().catch(() => ({ items: [] })),
  ]);
  return [
    ...evs.map((e) => ({ at: new Date(e.start), title: tagName(e), open: () => openEvent(e) })),
    ...dls.filter((d) => !d.done && new Date(d.due) > now).map((d) => ({ at: new Date(d.due), title: `Abgabe: ${d.title}`, open: () => openDeadline(d) })),
    ...regs.items.filter((x) => !x.registered).map((x) => ({ at: new Date(x.until), title: `Anmeldung: ${x.title}`, open: () => openReg(x) })),
  ].sort((a, b) => a.at - b.at);
}
function upcomingRow(it, now) {
  const r = el("button", "row row-nav exam-row");
  r.append(el("span", "exam-title", it.title), el("span", "value", dueText(it.at, now)), chev());
  r.addEventListener("click", it.open);
  return r;
}
// Home zeigt nur die nächsten 14 Tage (höchstens 3), der Rest liegt eine Ebene tiefer
const SOON_DAYS = 14;
async function renderExams(now) {
  const items = await upcomingItems(now);
  const soon = items.filter((it) => it.at - now < SOON_DAYS * 86400000).slice(0, 3);
  const rows = soon.map((it) => upcomingRow(it, now));
  if (items.length > soon.length) {
    const rest = items.length - soon.length;
    rows.push(navRow(soon.length ? `${rest} weitere` : `${items.length} anstehend`, () => openUpcoming(), soon.length ? "" : `nächste ${dueText(items[0].at, now)}`));
  }
  $("#exams-head").hidden = $("#exam-list").hidden = !items.length;
  $("#exam-list").replaceChildren(...rows);
}
function openUpcoming() {
  pushPage("Prüfungen & Abgaben", async (body) => {
    const head = el("div", "page-head");
    head.append(el("h1", "", "Prüfungen & Abgaben"), el("p", "", "Alles Anstehende der nächsten Monate."));
    body.append(head);
    const now = new Date();
    const fmtMon = new Intl.DateTimeFormat("de-AT", { month: "long", year: "numeric" });
    let month = null, box = null;
    for (const it of await upcomingItems(now)) {
      const m = fmtMon.format(it.at);
      if (m !== month) { month = m; box = group(); body.append(header(m), box); }
      box.append(upcomingRow(it, now));
    }
  });
}

// Eine Moodle-Abgabe: Fälligkeit, Kurs, abhaken
function openDeadline(d) {
  pushPage(d.title, (body) => {
    const due = new Date(d.due);
    const head = el("div", "page-head");
    head.append(el("h1", "", `Abgabe: ${d.title}`), el("p", "", `${fmtDay.format(due)} · ${fmtTime.format(due)}`));
    body.append(head);
    body.append(group(row("Kurs", d.course || "–"), row("Fällig", dueText(due)), d.note ? row("Notiz", d.note) : null));
    const doneRow = el("label", "row");
    doneRow.append(el("span", "", "Erledigt"), makeSwitch(d.done, async (v) => {
      const list = await put(`/api/deadlines/${encodeURIComponent(d.uid)}`, { done: v });
      d.done = v; state.deadlines = { at: Date.now(), list };
    }));
    body.append(group(doneRow), note("Erledigte Abgaben verschwinden vom Home-Screen und aus dem Apple Kalender."));
    const moodle = (state.me.links || []).find((l) => l.id === "moodle");
    if (moodle) {
      const a = el("a", "row row-nav"); a.href = moodle.url; a.target = "_blank"; a.rel = "noopener";
      a.append(el("span", "", "Moodle öffnen"), chev());
      body.append(el("div", "group-spaced"), group(a));
    }
  });
}

// Prüfungsanmeldung aus KUSSS: Frist und Prüfungstermin
function openReg(x) {
  pushPage(x.title, (body) => {
    const until = new Date(x.until);
    const head = el("div", "page-head");
    head.append(el("h1", "", `Anmeldung: ${x.title}`), el("p", "", `Anmeldung bis ${fmtDay.format(until)} · ${fmtTime.format(until)}`));
    body.append(head);
    const ex = x.exam_date && new Date(x.exam_date);
    body.append(group(
      row("Endet", dueText(until)),
      ex ? row("Prüfung", `${fmtDayShort.format(ex)}, ${fmtTime.format(ex)}`) : null,
      x.nr ? row("LVA-Nr.", x.nr) : null,
    ));
    const kusss = (state.me.links || []).find((l) => l.id === "kusss");
    if (kusss) {
      const a = el("a", "row row-nav"); a.href = kusss.url; a.target = "_blank"; a.rel = "noopener";
      a.append(el("span", "", "In KUSSS anmelden"), chev());
      body.append(el("div", "group-spaced"), group(a));
    }
    body.append(note("Die Fristen kommen aus KUSSS und werden bei jedem Holen von Kalender und Noten aktualisiert. Nach der Anmeldung verschwindet der Eintrag beim nächsten Mal."));
  });
}

// Campus (JKU: USI): Fitnessstudio und Sauna mit Live-Status, Hinweise; Details eine Ebene tiefer
const CAMPUS_HIDE = "studo_campus_off";
const campusHidden = () => { try { return localStorage.getItem(CAMPUS_HIDE) === "1"; } catch { return false; } };
const fmtShortDay = new Intl.DateTimeFormat("de-AT", { weekday: "short", day: "numeric", month: "numeric" });
async function loadCampus() {
  if (!state.campus || Date.now() - state.campus.at > 5 * 60_000) state.campus = { at: Date.now(), ...(await api("/api/campus")) };
  return state.campus;
}
function statusRow(label, st, onClick) {
  const r = el(onClick ? "button" : "div", `row${onClick ? " row-nav" : ""} status-row`);
  const v = el("span", "value");
  v.append(el("i", `dot${st.open ? " on" : ""}`), document.createTextNode(st.text));
  r.append(el("span", "", label), v);
  if (onClick) { r.append(chev()); r.addEventListener("click", onClick); }
  return r;
}
async function renderCampus() {
  const head = $("#campus-head"), box = $("#campus-card");
  if (state.me.campus !== "usi" || campusHidden()) { head.hidden = box.hidden = true; return; }
  const { usi } = await loadCampus();
  if (!usi) { head.hidden = box.hidden = true; return; }
  const soon = usi.notices.filter((n) => (new Date(n.date) - midnight(new Date())) / 86400000 < 7);
  const rows = [statusRow("Fitnessstudio", usi.gym, openUsi), statusRow("Sauna", usi.sauna, openUsi)];
  for (const n of soon) rows.push(el("div", "row notice-row", n.text));
  box.replaceChildren(group(...rows));
  head.hidden = box.hidden = false;
}
function openUsi() {
  pushPage("USI", async (body) => {
    const head = el("div", "page-head");
    head.append(el("h1", "", "USI"), el("p", "", "Universitätssportinstitut der JKU"));
    body.append(head);
    let usi;
    try { ({ usi } = await loadCampus()); } catch (err) { errorBox(body, err, "USI-Infos"); return; }
    body.append(group(statusRow("Fitnessstudio", usi.gym), statusRow("Sauna", usi.sauna)));
    if (usi.notices.length) body.append(header("Hinweise"), group(...usi.notices.map((n) => el("div", "row notice-row", n.text))));
    body.append(header("Öffnungszeiten"), group(...usi.hours.map(([k, v]) => row(k, v))));
    body.append(header("Sauna"), group(...usi.sauna_plan.map(([k, v]) => row(k, v))), note(usi.sauna_note));
    if (usi.news.length) {
      body.append(header("News"), group(...usi.news.map((n) => {
        const a = el("a", "row row-nav news-row"); a.href = n.url; a.target = "_blank"; a.rel = "noopener";
        const t = el("div", "meal-text");
        if (n.date) t.append(el("span", "meal-cat pref-hint", fmtShortDay.format(new Date(`${n.date}T12:00:00`))));
        t.append(el("span", "meal-name", n.title));
        a.append(t, chev());
        return a;
      })));
    }
    body.append(header("Links"), group(...usi.links.map((l) => {
      const a = el("a", "row row-nav"); a.href = l.url; a.target = "_blank"; a.rel = "noopener";
      a.append(el("span", "", l.name), chev());
      return a;
    })), note("Eine Live-Auslastung veröffentlicht das USI leider nicht. Sobald es eine gibt, kommt sie hierher."));
  });
}

// Mensa: heutiger Speiseplan (ab 14 Uhr der nächste Tag), mehrere Mensen per Umschalter
const MENSA_KEY = "studo_mensa", MENSA_HIDE = "studo_mensa_off";
const mensaHidden = () => { try { return localStorage.getItem(MENSA_HIDE) === "1"; } catch { return false; } };
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtPrice = new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR" });
async function renderMensa(now) {
  const head = $("#mensa-head"), box = $("#mensa-card");
  if (!state.me.mensa || mensaHidden()) { head.hidden = box.hidden = true; return; }
  if (!state.mensa || Date.now() - state.mensa.at > 30 * 60_000) state.mensa = { at: Date.now(), ...(await api("/api/mensa")) };
  const canteens = state.mensa.canteens.filter((c) => c.days.length || c.error);
  if (!canteens.length) { head.hidden = box.hidden = true; return; }
  let pick; try { pick = localStorage.getItem(MENSA_KEY); } catch {}
  let c = canteens.find((x) => String(x.id) === pick) || canteens[0];
  const wrap = el("div");
  const show = () => {
    const today = isoDay(now), late = now.getHours() >= 14;
    const day = c.days.find((d) => (late ? d.date > today : d.date >= today) && !d.closed && d.meals.length);
    const date = day && new Date(`${day.date}T12:00:00`);
    const diff = date ? Math.round((midnight(date) - midnight(now)) / 86400000) : null;
    head.textContent = `Mensa · ${diff === 0 ? "heute" : diff === 1 ? "morgen" : date ? fmtDay.format(date) : "diese Woche"}`;
    const meals = day ? day.meals : [];
    const list = group(...meals.map((m) => {
      const r = el("div", "row meal");
      const t = el("div", "meal-text");
      if (m.category) t.append(el("span", "meal-cat", m.category.replace(/\s*\(.*?\)\s*/g, " ").trim()));
      t.append(el("span", "meal-name", m.name));
      r.append(t);
      if (m.price != null) r.append(el("span", "value", fmtPrice.format(m.price)));
      return r;
    }));
    if (!meals.length) list.append(el("div", "row empty-row", c.error ? "Speiseplan gerade nicht erreichbar" : "Kein Speiseplan in den nächsten Tagen"));
    wrap.replaceChildren(list, ...(c.hours ? [note(c.hours)] : []));
  };
  const parts = [];
  if (canteens.length > 1) {
    const seg = el("div", "segmented seg-full mensa-seg");
    for (const x of canteens) {
      const b = el("button", x === c ? "on" : "", x.name);
      b.addEventListener("click", () => {
        if (x === c) return;
        c = x;
        try { localStorage.setItem(MENSA_KEY, String(x.id)); } catch {}
        $$("button", seg).forEach((y) => y.classList.toggle("on", y === b));
        haptic(); show();
        if (!REDUCED) wrap.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 220, easing: "ease-out" });
      });
      seg.append(b);
    }
    parts.push(seg);
  }
  show();
  box.replaceChildren(...parts, wrap);
  head.hidden = box.hidden = false;
}

const ICONS = {
  grid: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 21H20"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m3.5 7 8.5 6 8.5-6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  library: '<path d="M5 4v16M9 4v16M13.5 4.5l5 15M3 20h18"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.3c2.1.8 3.5 2.8 3.5 5.7"/>',
};
function renderLinks() {
  const links = state.me.links || [];
  $("#links-head").hidden = !links.length;
  $("#quick-links").replaceChildren(...links.map((l) => {
    const a = el("a", "link");
    a.href = l.url; a.target = "_blank"; a.rel = "noopener";
    const ico = el("span", "ico"); ico.append(svg(ICONS[l.icon] || ICONS.grid));
    a.append(ico, l.name);
    return a;
  }));
}

// ---------- Tab: Kalender (Tag, Woche, Liste) ----------
$$("#cal-mode button").forEach((b) => b.addEventListener("click", () => {
  if (state.cal.mode === b.dataset.mode) return;
  state.cal.mode = b.dataset.mode; haptic();
  try { localStorage.setItem("studo_calmode", b.dataset.mode); } catch {}
  renderCalendar();
}));
$("#cal-prev").addEventListener("click", () => moveCal(-1));
$("#cal-next").addEventListener("click", () => moveCal(1));
$("#cal-today").addEventListener("click", () => { state.cal.day = midnight(new Date()); state.cal.scrolled = ""; haptic(); renderCalendar(); });
function moveCal(dir) { state.cal.day = addDays(state.cal.day, state.cal.mode === "day" ? dir : dir * 7); haptic(); return renderCalendar(); }

// Wochen-Cache: Blättern zeigt sofort an, aktualisiert wird im Hintergrund
const weekCache = new Map();
function weekEvents(ws, { fresh = 15000 } = {}) {
  const k = ws.toISOString(), hit = weekCache.get(k);
  if (hit && (Date.now() - hit.at < fresh || hit.pending)) return hit.pending || Promise.resolve(hit.events);
  const pending = fetchEvents(ws, addDays(ws, 7)).then((events) => { weekCache.set(k, { events, at: Date.now() }); return events; })
    .catch((err) => { if (hit) weekCache.set(k, hit); else weekCache.delete(k); throw err; });
  weekCache.set(k, { ...(hit || {}), pending });
  return pending;
}

// Wischen nach links/rechts blättert: Raster folgt dem Finger, neuer Tag schiebt nach
hDrag($("#cal-view"), {
  canStart: (e) => e.touches[0].clientX > 22 && e.touches[0].clientX < innerWidth - 22,
  onMove: (dx) => { $("#cal-view").style.transform = `translate3d(${dx}px,0,0)`; },
  onEnd: async (dx, v) => {
    const view = $("#cal-view"), from = view.style.transform;
    view.style.transform = "";
    const commit = Math.abs(dx) > view.clientWidth * 0.22 || (Math.abs(v) > 0.35 && Math.abs(dx) > 30);
    if (!commit) { view.animate([{ transform: from }, { transform: "none" }], { duration: 220, easing: EASE }); return; }
    const sign = dx < 0 ? -1 : 1;
    await view.animate([{ transform: from, opacity: 1 }, { transform: `translate3d(${sign * view.clientWidth}px,0,0)`, opacity: 0.3 }],
      { duration: 160, easing: "ease-out" }).finished;
    view.style.opacity = "0";
    await moveCal(-sign);
    view.style.opacity = "";
    view.animate([{ transform: `translate3d(${-sign * view.clientWidth * 0.6}px,0,0)`, opacity: 0.3 }, { transform: "none", opacity: 1 }], { duration: 240, easing: EASE });
  },
});

// Kalenderbereich füllt genau den Platz zwischen Kopf und Tab-Leiste: Kopf bleibt stehen, nur das Raster scrollt
function sizeCalendar() {
  const v = $("#cal-view");
  if ($("#tab-calendar").hidden) return;
  const top = v.getBoundingClientRect().top + scrollY;
  const bottom = $(".tabbar").offsetHeight + 10;
  // dvh passt sich selbst an, wenn Safari-Leisten oder Tastatur die Höhe ändern
  v.style.height = `max(240px, calc(100dvh - ${Math.round(top + bottom)}px))`;
}
addEventListener("resize", sizeCalendar);
visualViewport?.addEventListener("resize", sizeCalendar);
addEventListener("pageshow", sizeCalendar);

let calSeq = 0;
async function renderCalendar() {
  const { mode, day } = state.cal;
  const seq = ++calSeq;
  $$("#cal-mode button").forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
  const ws = startOfWeek(day), we = addDays(ws, 7);
  $("#cal-month").textContent = fmtMonth.format(mode === "day" ? day : addDays(ws, 3));
  $("#cal-range").textContent = mode === "day" ? fmtDay.format(day) : `${fmtWeek.format(ws)} – ${fmtWeek.format(addDays(ws, 6))}`;

  const view = $("#cal-view");
  let events;
  const cached = weekCache.get(ws.toISOString());
  if (cached?.events && !cached.pending) {
    events = cached.events;
    if (Date.now() - cached.at > 15000) weekEvents(ws).then((fresh) => { if (seq === calSeq && JSON.stringify(fresh) !== JSON.stringify(events)) renderCalendar(); }).catch(() => {});
  } else {
    try { events = await weekEvents(ws); } catch (err) { errorBox(view, err); return; }
  }
  if (seq !== calSeq) return; // inzwischen weitergeblättert
  // Nachbarwochen vorladen, damit Wischen sofort reagiert
  setTimeout(() => { weekEvents(addDays(ws, 7), { fresh: 60000 }).catch(() => {}); weekEvents(addDays(ws, -7), { fresh: 60000 }).catch(() => {}); }, 300);
  const byDay = events.reduce((m, e) => ((m[dayKey(new Date(e.start))] ??= []).push(e), m), {});

  const strip = $("#week-strip");
  strip.hidden = mode !== "day";
  if (mode === "day") {
    strip.replaceChildren(...Array.from({ length: 7 }, (_, i) => {
      const d = addDays(ws, i), k = dayKey(d);
      const b = el("button");
      b.classList.toggle("today", k === dayKey(new Date()));
      b.classList.toggle("sel", k === dayKey(day));
      b.classList.toggle("has", !!byDay[k]);
      b.append(el("span", "", WD[i]), el("span", "num", String(d.getDate())));
      b.addEventListener("click", () => { state.cal.day = d; haptic(); renderCalendar(); });
      return b;
    }));
  }
  view.classList.toggle("list", mode === "list");

  if (mode === "list") {
    const out = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(ws, i), list = byDay[dayKey(d)];
      if (!list) continue;
      out.push(el("div", "day-head", fmtDay.format(d)), group(...list.map((e) => evRow(e))));
    }
    if (!out.length) out.push(group(el("div", "row empty-row", "Keine Termine in dieser Woche")));
    view.replaceChildren(...out);
  } else {
    const days = mode === "day" ? [day]
      : Array.from({ length: [5, 6].some((i) => byDay[dayKey(addDays(ws, i))]) ? 7 : 5 }, (_, i) => addDays(ws, i));
    view.replaceChildren(timeGrid(days, byDay, mode));
  }
  sizeCalendar();

  // Beim ersten Anzeigen eines Tages/einer Woche zum ersten Termin bzw. zur aktuellen Uhrzeit scrollen
  const key = `${mode}:${dayKey(mode === "day" ? day : ws)}`;
  if (state.cal.scrolled !== key) {
    state.cal.scrolled = key;
    if (mode === "list") view.scrollTop = 0;
    else {
      const shown = mode === "day" ? byDay[dayKey(day)] || [] : events;
      const first = shown.length ? Math.min(...shown.map((e) => new Date(e.start).getHours() + new Date(e.start).getMinutes() / 60)) : 8;
      const now = new Date(), nowH = now.getHours() + now.getMinutes() / 60;
      const isNow = mode === "day" ? dayKey(day) === dayKey(now) : ws <= now && now < we;
      const last = shown.length ? Math.max(...shown.map((e) => new Date(e.end).getHours())) : 18;
      const target = mode === "day" && isNow && nowH > first && nowH < last ? nowH - 1 : first - .5;
      view.scrollTop = Math.max(0, (target - H0) * HOUR);
    }
  }
}

// Zeitraster wie im Apple Kalender: Stundenlinien, Blöcke nach Uhrzeit, Jetzt-Linie
function timeGrid(days, byDay, mode) {
  const height = (H1 - H0) * HOUR;
  const grid = el("div", `grid ${mode}`);
  grid.style.setProperty("--days", days.length);
  grid.style.setProperty("--hour", `${HOUR}px`);
  const today = dayKey(new Date());
  if (mode === "week") {
    const head = el("div", "grid-head");
    head.append(el("div"));
    for (const d of days) head.append(el("div", dayKey(d) === today ? "today" : "", `${WD[(d.getDay() + 6) % 7]} ${d.getDate()}`));
    grid.append(head);
  }
  const hours = el("div", "hours"); hours.style.height = `${height}px`;
  for (let h = H0 + 1; h < H1; h++) { const s = el("span", "", `${h}:00`); s.style.top = `${(h - H0) * HOUR}px`; hours.append(s); }
  grid.append(hours);

  for (const d of days) {
    const col = el("div", "daycol");
    col.style.height = `${height}px`;
    col.classList.toggle("is-today", dayKey(d) === today && mode === "week");
    const list = (byDay[dayKey(d)] || []).slice().sort((a, b) => new Date(a.start) - new Date(b.start));
    const lanes = [];
    const placed = list.map((e) => {
      const s = new Date(e.start), en = new Date(e.end);
      let lane = lanes.findIndex((end) => end <= s);
      if (lane < 0) { lane = lanes.length; lanes.push(en); } else lanes[lane] = en;
      return { e, s, en, lane };
    });
    for (const p of placed) {
      const overlapping = placed.filter((q) => q.s < p.en && q.en > p.s);
      const n = Math.max(...overlapping.map((q) => q.lane)) + 1;
      const top = Math.max(0, ((p.s.getHours() + p.s.getMinutes() / 60) - H0) * HOUR);
      const dur = Math.max(20, ((p.en - p.s) / 3600000) * HOUR - 2);
      const b = el("button", "block");
      b.classList.toggle("cancelled", p.e.status === "cancelled");
      b.style.top = `${top + 1}px`; b.style.height = `${dur}px`;
      b.style.left = `${(p.lane / n) * 100}%`; b.style.width = `calc(${100 / n}% - 3px)`;
      if (mode === "day") {
        b.append(evTitle(p.e, "b"));
        b.append(el("span", "", `${fmtTime.format(p.s)} – ${fmtTime.format(p.en)}${p.e.location ? " · " + p.e.location : ""}`));
      } else {
        // Woche: zu schmal für ganze Titel -> Kürzel, darunter der Raum
        b.title = p.e.title;
        const t = titleWithKind(p.e.kind, shortName(p.e), "b");
        // Bei Prüfungen ist die Art wichtiger als VL/UE: statt der LVA-Art anzeigen
        if (p.e.tag) { t.querySelector(".kind")?.remove(); t.prepend(el("span", "kind", TAG_SHORT[p.e.tag] || TAGS[p.e.tag])); }
        b.append(t);
        if (p.e.room || p.e.location) b.append(el("span", "room", p.e.status === "cancelled" ? "entfällt" : p.e.room || p.e.location));
      }
      if (p.e.attendance) b.append(el("span", "must", "!"));
      b.addEventListener("click", () => openEvent(p.e));
      col.append(b);
    }
    if (dayKey(d) === today) {
      const now = new Date(), y = ((now.getHours() + now.getMinutes() / 60) - H0) * HOUR;
      if (y >= 0 && y <= height) { const line = el("div", "now-line"); line.style.top = `${y}px`; col.append(line); }
    }
    if (!list.length && mode === "day") col.append(el("div", "grid-empty", "Keine Termine"));
    grid.append(col);
  }
  return grid;
}

// ---------- Tab: Kurse (alle Semester, auch frühere aus den Noten) ----------
async function loadCourses() { state.coursesData = await api("/api/courses"); return state.coursesData; }
async function loadGrades() {
  state.gradesData = await api("/api/grades");
  for (const g of state.gradesData.grades) g.semester = normSem(g.semester);
  return state.gradesData;
}

function normTitle(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9äöüß]/g, ""); }
function gradeMatches(g, course) {
  const nr = String(course.nr || "").replace(/\D/g, "");
  if (nr && String(g.nr || "").replace(/\D/g, "") === nr) return true;
  return normTitle(g.title) && normTitle(g.title) === normTitle(course.title) && (!g.kind || !course.kinds || course.kinds.includes(g.kind))
    && (!g.semester || !course.semesters?.length || course.semesters.includes(g.semester));
}
function matchGrade(course) { return (state.gradesData?.grades || []).find((g) => gradeMatches(g, course)); }

function courseEntries() {
  const courses = state.coursesData?.courses || [];
  const grades = state.gradesData?.grades || [];
  const out = courses.map((c) => ({ id: c.course_id, title: c.title, kind: (c.kinds || "").split(",")[0] || null, semesters: c.semesters, course: c, grade: matchGrade(c) }));
  for (const g of grades) {
    if (courses.some((c) => gradeMatches(g, c))) continue;
    out.push({ id: `g${g.id}`, title: g.title, kind: g.kind, semesters: g.semester ? [g.semester] : [], grade: g });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title, "de"));
}

async function renderCourses() {
  const box = $("#course-list");
  try { await Promise.all([loadCourses(), state.gradesData ? null : loadGrades().catch(() => null)]); }
  catch (err) { errorBox(box, err, "Kurse"); return; }
  const entries = courseEntries();
  const sems = [...new Set(entries.flatMap((e) => e.semesters))].sort((a, b) => semSort(b) - semSort(a));
  const current = state.coursesData.current;
  if (!state.sem || (state.sem !== "all" && !sems.includes(state.sem))) state.sem = sems.includes(current) ? current : sems[0] || "all";
  const chips = ["all", ...sems].map((s) => {
    const c = el("button", `chip${s === state.sem ? " on" : ""}`, s === "all" ? "Alle" : semShort(s));
    c.addEventListener("click", () => { state.sem = s; haptic(); renderCourses(); });
    return c;
  });
  $("#sem-chips").replaceChildren(...(sems.length ? chips : []));
  const list = entries.filter((e) => state.sem === "all" || e.semesters.includes(state.sem));
  $("#courses-sub").textContent = `${list.length} ${list.length === 1 ? "Kurs" : "Kurse"}${state.sem !== "all" ? ` · ${state.sem}` : ""}`;
  box.replaceChildren(...list.map((e) => {
    const r = el("button", "row course-row");
    const text = el("span", "course-text");
    const t = titleWithKind(e.kind, e.title); t.className = "course-title";
    let sub;
    if (e.course) sub = e.course.next_start ? `Nächster Termin ${inDays(new Date(e.course.next_start))}, ${fmtTime.format(new Date(e.course.next_start))}` : "Keine weiteren Termine";
    else sub = [e.grade?.ects ? `${fmtNum.format(e.grade.ects)} ECTS` : null, e.semesters[0]].filter(Boolean).join(" · ");
    text.append(t, el("span", "course-sub", sub));
    r.append(text);
    if (e.grade) r.append(gradePill(e.grade));
    if (e.course?.attendance) r.append(el("span", "must", "!"));
    r.append(chev());
    r.addEventListener("click", () => (e.course ? openCourse(e.course.course_id) : openGrade(e.grade)));
    return r;
  }));
  if (!list.length) box.append(el("div", "row empty-row", entries.length ? "Keine Kurse in diesem Semester" : "Noch keine Kurse"));
}

async function openCourse(id) {
  const data = state.coursesData || await loadCourses().catch(() => null);
  const c = data?.courses.find((x) => x.course_id === id);
  if (!c) return;
  const kind = (c.kinds || "").split(",")[0] || null;
  pushPage(c.title, (body) => {
    const head = el("div", "page-head");
    head.append(titleWithKind(kind, c.title, "h1"));
    if (c.lecturer) head.append(el("p", "", c.lecturer));
    body.append(head);
    const grade = matchGrade(c);
    body.append(group(
      c.nr ? row("LVA-Nummer", c.nr) : null,
      row("Semester", c.semesters.join(", ") || "–"),
      c.first_start ? row("Zeitraum", `${fmtShort.format(new Date(c.first_start))} – ${fmtDate.format(new Date(c.last_end))}`) : null,
      grade ? row("Note", grade.grade_text || String(grade.grade ?? "")) : null,
    ));
    const r = el("label", "row");
    r.append(el("span", "", "Anwesenheitspflicht"), makeSwitch(c.attendance, async (v) => {
      await put(`/api/courses/${encodeURIComponent(c.course_id)}/attendance`, { attendance: v });
      c.attendance = v;
    }));
    const sl = el("label", "row");
    const si = el("input"); si.placeholder = autoShort(c.title); si.value = c.short || ""; si.maxLength = 12;
    si.autocapitalize = "characters"; si.enterKeyHint = "done";
    si.addEventListener("change", async () => {
      try { const r = await put(`/api/courses/${encodeURIComponent(c.course_id)}/short`, { short: si.value }); c.short = r.short; weekCache.clear(); haptic(); }
      catch (err) { alert(err.message); }
    });
    si.addEventListener("keydown", (e) => { if (e.key === "Enter") si.blur(); });
    sl.append(el("span", "row-label", "Kürzel"), si);
    body.append(header("Zusatzfunktion"), group(r), note("Gilt für alle Termine. Einzelne Termine änderst du im Termin selbst."),
      header("Wochenansicht"), group(sl), note("So heißt der Kurs in der Wochenansicht. Leer lassen für den Vorschlag."));
    const upcoming = group(el("div", "row empty-row", "Lade Termine …"));
    body.append(header("Nächste Termine"), upcoming);
    const from = new Date(), to = c.last_end ? new Date(c.last_end) : addDays(from, 120);
    (to > from ? fetchEvents(from, to) : Promise.resolve([])).then((evs) => {
      evs = evs.filter((e) => e.course_id === id);
      upcoming.replaceChildren(...evs.map((e) => {
        const s = new Date(e.start);
        const r = row(`${inDays(s)}`, `${fmtTime.format(s)} · ${e.status === "cancelled" ? "Entfällt" : e.location || "Ort unbekannt"}`, "tap nowrap-label");
        if (e.tag) r.firstChild.append(` · ${TAGS[e.tag]}`);
        r.addEventListener("click", () => openEvent(e));
        return r;
      }));
      if (!evs.length) upcoming.append(el("div", "row empty-row", "Keine weiteren Termine"));
    }).catch((err) => errorBox(upcoming, err));
  });
}

// ---------- Tab: Studium (Noten, ECTS, Statistik) ----------
function isPassed(g) { return g.grade ? g.grade <= 4 : g.passed === true; }
function currentSemester(d = new Date()) {
  const y = d.getFullYear(), m = d.getMonth() + 1;
  return normSem(m >= 10 ? `${y}W` : m <= 2 ? `${y - 1}W` : `${y}S`);
}
// Dieselbe LVA kann mehrfach in KUSSS stehen (z. B. Notenverbesserung, Teilleistungen):
// pro LVA zählt nur die neueste positive Beurteilung, sonst würden ECTS doppelt gezählt
function uniquePassed(grades) {
  const best = new Map();
  for (const g of grades.filter(isPassed)) {
    const k = g.nr ? `nr:${String(g.nr).replace(/\D/g, "")}:${g.kind || ""}` : `t:${normTitle(g.title)}:${g.kind || ""}`;
    const prev = best.get(k);
    if (!prev || String(g.date || "") > String(prev.date || "")) best.set(k, g);
  }
  return [...best.values()];
}
function studyNumbers(grades, target) {
  const passed = uniquePassed(grades);
  const ects = passed.reduce((s, g) => s + (+g.ects || 0), 0);
  const graded = passed.filter((g) => g.grade >= 1 && g.grade <= 4);
  const w = graded.reduce((s, g) => s + (+g.ects || 1), 0);
  const avg = w ? graded.reduce((s, g) => s + g.grade * (+g.ects || 1), 0) / w : null;
  const plain = graded.length ? graded.reduce((s, g) => s + g.grade, 0) / graded.length : null;
  return { passed, ects, avg, plain, target };
}
function gradePill(g) {
  const pill = el("span", "grade-pill");
  if (g.grade) { pill.textContent = String(g.grade); if (g.grade === 5) pill.classList.add("fail"); }
  else if (g.passed === false) { pill.textContent = "✕"; pill.classList.add("fail"); }
  else if (g.passed) { pill.textContent = "✓"; pill.classList.add("ok"); pill.title = "Mit Erfolg teilgenommen"; }
  else { pill.textContent = "–"; pill.title = g.grade_text || "Noch keine Beurteilung"; }
  return pill;
}

async function renderStudy() {
  let data;
  try { data = await loadGrades(); } catch (err) { $("#study-cta").replaceChildren(el("div", "notice", err.message)); return; }
  const { programs } = data;
  if (state.program !== "all" && !programs.some((p) => String(p.id) === state.program)) state.program = "all";

  // Studienrichtungen als Filter, damit ECTS pro Studium getrennt zählen
  const chips = [["all", "Alle"], ...programs.map((p) => [String(p.id), p.name])].map(([id, name]) => {
    const c = el("button", `chip${id === state.program ? " on" : ""}`, name);
    c.addEventListener("click", () => { state.program = id; haptic(); renderStudy(); });
    return c;
  });
  $("#program-chips").replaceChildren(...(programs.length > 1 ? chips : []));

  const prog = programs.find((p) => String(p.id) === state.program);
  const grades = data.grades.filter((g) => state.program === "all" || String(g.program_id) === state.program);
  const target = (prog ? prog.ects_target : programs.length === 1 ? programs[0].ects_target : programs.reduce((s, p) => s + (p.ects_target || 0), 0)) || 180;
  const n = studyNumbers(grades, target);
  $("#study-sub").textContent = prog ? prog.name : programs.length === 1 ? programs[0].name : "Studienfortschritt";

  // Noch keine Noten geladen -> klarer Hinweis mit Knopf statt leerer Statistik
  const cta = $("#study-cta"); cta.replaceChildren();
  if (data.auto && !state.me.demo && (!data.synced || data.error) && !data.grades.length) {
    const box = el("div", "notice");
    box.append(el("strong", "", data.error ? "Noten konnten nicht gelesen werden" : "Noten noch nicht geladen"),
      document.createTextNode(data.error || "Studo+ holt deine Noten und ECTS aus der KUSSS-Notenauskunft."));
    const b = el("button", "pill-btn", "Aus KUSSS laden"); b.addEventListener("click", openGradesRefresh);
    box.append(el("br"), b);
    cta.append(box);
  }

  // Fortschrittsring
  const pct = Math.min(1, n.ects / n.target);
  const C = 2 * Math.PI * 40;
  const ring = el("div", "ring");
  const ringSvg = svg(`<circle class="track" cx="46" cy="46" r="40"/><circle class="val" cx="46" cy="46" r="40" stroke-dasharray="${C}" stroke-dashoffset="${C}"/>`);
  ringSvg.setAttribute("viewBox", "0 0 92 92");
  const ringLabel = el("div", "ring-label", `${Math.round(pct * 100)} %`);
  ring.append(ringSvg, ringLabel);
  const intro = state.studyIntro; state.studyIntro = false;
  requestAnimationFrame(() => requestAnimationFrame(() => { const v = $(".val", ring); if (v) v.style.strokeDashoffset = String(C * (1 - pct)); }));
  if (intro) {
    // Prozent zählen mit dem Ring mit, dazu ein leichtes Tippen je 10 % und ein Abschluss-Tippen
    let ticks = 0;
    countUp(ringLabel, pct * 100, { fmt: (v) => `${Math.round(v)} %`, onStep: (k) => {
      const n = Math.floor(k * pct * 10);
      if (n > ticks) { ticks = n; haptic(); }
      if (k === 1) { setTimeout(haptic, 90); ring.animate([{ transform: "none" }, { transform: "scale(1.06)" }, { transform: "none" }], { duration: 320, easing: "ease-out" }); }
    } });
  } else $(".val", ring).style.transition = "none";
  const txt = el("div", "progress-text");
  txt.append(el("strong", "", `${fmtNum.format(n.ects)} von ${n.target} ECTS`),
    el("span", "", n.ects >= n.target ? "Geschafft!" : `Noch ${fmtNum.format(Math.max(0, n.target - n.ects))} ECTS`));
  $("#progress-card").replaceChildren(ring, txt);

  const sems = {};
  for (const g of n.passed) if (g.semester) sems[g.semester] = (sems[g.semester] || 0) + (+g.ects || 0);
  // Laufendes Semester immer zeigen, auch wenn noch keine Note da ist
  const cur = currentSemester();
  if (Object.keys(sems).length || grades.length) sems[cur] ??= 0;
  const semList = Object.entries(sems).sort((a, b) => semSort(a[0]) - semSort(b[0])).slice(-8);
  // Schnitt pro Semester nur über abgeschlossene Semester (das laufende würde ihn drücken)
  const done = semList.filter(([s]) => semSort(s) < semSort(cur));
  const perSem = done.length ? done.reduce((a, [, v]) => a + v, 0) / done.length : semList.length ? n.ects / semList.length : 0;
  const stats = [
    [n.avg ? fmtAvg.format(n.avg) : "–", "Notenschnitt"],
    [n.plain ? fmtAvg.format(n.plain) : "–", "Schnitt ungewichtet"],
    [String(n.passed.length), "Prüfungen bestanden"],
    [perSem ? fmtNum.format(Math.round(perSem * 10) / 10) : "–", "ECTS pro Semester"],
  ];
  $("#study-stats").replaceChildren(...stats.map(([v, l], i) => {
    const s = el("div", "stat"); s.append(el("div", "stat-value", v), el("div", "stat-label", l));
    if (intro && !REDUCED) s.animate([{ opacity: 0, transform: "translateY(8px) scale(.97)" }, { opacity: 1, transform: "none" }], { duration: 420, delay: 120 + i * 60, easing: "cubic-bezier(.32,.72,0,1)", fill: "backwards" });
    return s;
  }));

  const chart = $("#ects-chart");
  chart.style.setProperty("--n", Math.max(4, semList.length));
  const maxE = Math.max(30, ...semList.map(([, v]) => v));
  chart.replaceChildren(...semList.map(([s, v]) => {
    const col = el("div", "col");
    const b = el("div", "bar bar-a"); b.style.height = `${(v / maxE) * 100}%`;
    if (s === cur) col.classList.add("current");
    col.append(el("div", "val-lbl", fmtNum.format(v)), b, el("span", "lbl", s === cur ? "jetzt" : semShort(s)));
    if (intro) growBar(b, semList.findIndex(([x]) => x === s));
    return col;
  }));
  if (!semList.length) chart.replaceChildren(el("div", "chart-empty", "Noch keine Daten"));

  const dist = [1, 2, 3, 4, 5].map((g) => grades.filter((x) => x.grade === g).length);
  const maxD = Math.max(1, ...dist);
  $("#grade-dist").replaceChildren(...dist.map((c, i) => {
    const col = el("div", `col g${i + 1}`);
    const b = el("div", "bar"); b.style.height = `${(c / maxD) * 72}%`;
    col.append(el("span", "", String(c)), b, el("strong", "", String(i + 1)));
    if (intro) growBar(b, i);
    return col;
  }));

  $("#btn-grades-refresh").hidden = !data.auto || state.me.demo;
  $("#grades-synced").textContent = data.synced ? `Aus KUSSS geladen ${ago(data.synced)}.` : "";

  const groups = {};
  for (const g of grades) (groups[g.semester || "Ohne Semester"] ??= []).push(g);
  const out = [];
  for (const [sem, list] of Object.entries(groups).sort((a, b) => semSort(b[0]) - semSort(a[0]))) {
    const ects = list.filter(isPassed).reduce((s, g) => s + (+g.ects || 0), 0);
    out.push(header(`${sem} · ${fmtNum.format(ects)} ECTS`), group(...list.map(gradeRow)));
  }
  if (out.length) out.push(note("Rechts steht die Note. ✓ heißt „mit Erfolg teilgenommen“ (ohne Ziffernnote)."));
  $("#grade-list").replaceChildren(...out);
}

// Balken wachsen von unten mit leichtem Nachfedern, einer nach dem anderen
function growBar(b, i) {
  if (REDUCED) return;
  b.animate([{ transform: "scaleY(0)" }, { transform: "scaleY(1.04)", offset: .75 }, { transform: "none" }],
    { duration: 620, delay: 250 + i * 55, easing: "cubic-bezier(.32,.72,0,1)", fill: "backwards" });
}

function gradeRow(g) {
  const r = el("button", "row course-row");
  const text = el("span", "course-text");
  const t = titleWithKind(g.kind, g.title); t.className = "course-title";
  const prog = state.gradesData.programs.find((p) => p.id === g.program_id);
  text.append(t, el("span", "course-sub", [g.date ? fmtDate.format(new Date(g.date)) : null, g.ects ? `${fmtNum.format(g.ects)} ECTS` : null, prog?.name].filter(Boolean).join(" · ") || "–"));
  r.append(text, gradePill(g), chev());
  r.addEventListener("click", () => openGrade(g));
  return r;
}

function openGrade(g) {
  const { programs } = state.gradesData;
  pushPage(g.title, (body) => {
    const head = el("div", "page-head");
    head.append(titleWithKind(g.kind, g.title, "h1"));
    if (g.semester) head.append(el("p", "", g.semester));
    body.append(head, group(
      row("Note", g.grade_text || (g.grade ? String(g.grade) : "–")),
      g.date ? row("Datum", fmtDate.format(new Date(g.date))) : null,
      g.ects ? row("ECTS", fmtNum.format(g.ects)) : null,
      g.sws ? row("SWS", fmtNum.format(g.sws)) : null,
      g.nr ? row("LVA-Nummer", g.nr) : null,
      row("Quelle", g.source === "manual" ? "Manuell eingetragen" : "KUSSS"),
    ));
    const label = el("label", "row");
    const sel = el("select");
    sel.append(new Option("Keine", ""), ...programs.map((p) => new Option(p.name, String(p.id))));
    sel.value = g.program_id ? String(g.program_id) : "";
    sel.addEventListener("change", async () => {
      try { state.gradesData = await put(`/api/grades/${g.id}`, { program_id: sel.value ? +sel.value : null }); g.program_id = sel.value ? +sel.value : null; haptic(); }
      catch (err) { alert(err.message); }
    });
    label.append(el("span", "row-label", "Studium"), sel);
    body.append(header("Zuordnung"), group(label),
      note(programs.length ? "Bestimmt, zu welchem Studium die ECTS zählen." : "Studienrichtungen legst du unter Einstellungen › Persönliche Daten an."));
    if (g.source === "manual") {
      const del = el("button", "row row-btn danger", "Note löschen");
      del.addEventListener("click", async () => {
        if (!confirm(`„${g.title}“ löschen?`)) return;
        await api(`/api/grades/${g.id}`, { method: "DELETE" }); navLockUntil = 0; goBack();
      });
      body.append(el("div", "group-spaced"), group(del));
    }
  });
}

$("#btn-grade-add").addEventListener("click", () => {
  const programs = state.gradesData?.programs || [];
  formPage("Note hinzufügen", [
    { name: "title", label: "Kurs", placeholder: "z. B. Analysis", required: true },
    { name: "kind", label: "LVA-Art", options: [["", "–"], ...["VL", "UE", "KS", "KV", "PR", "SE", "PS", "IK", "VU"].map((k) => [k, k])] },
    { name: "grade", label: "Note", options: [["1", "1 – Sehr gut"], ["2", "2 – Gut"], ["3", "3 – Befriedigend"], ["4", "4 – Genügend"], ["5", "5 – Nicht genügend"], ["ok", "Mit Erfolg teilgenommen"]] },
    { name: "ects", label: "ECTS", placeholder: "6", inputmode: "decimal" },
    { name: "date", label: "Datum", type: "date", value: new Date().toISOString().slice(0, 10) },
    ...(programs.length ? [{ name: "program_id", label: "Studium", options: [["", "Keine"], ...programs.map((p) => [String(p.id), p.name])], value: state.program !== "all" ? state.program : String(programs[0].id) }] : []),
  ], "Hinzufügen", async (v) => {
    state.gradesData = await post("/api/grades", {
      title: v.title, grade: v.grade === "ok" ? null : +v.grade, passed: true,
      ects: v.ects ? +String(v.ects).replace(",", ".") : null, kind: v.kind || null, date: v.date || null,
      program_id: v.program_id ? +v.program_id : null,
    });
  });
});

function openGradesRefresh() {
  formPage("Noten aus KUSSS", [
    { name: "password", label: "JKU-Passwort", type: "password", required: true, autocomplete: "current-password", placeholder: "Passwort" },
  ], "Noten laden", async (v) => {
    state.gradesData = await post("/api/grades/refresh", { password: v.password }); state.regs = null;
    await loadMe();
  }, "Studo+ meldet sich einmal bei KUSSS an und liest die Notenauskunft und deinen Namen. Das Passwort wird nicht gespeichert.");
}
$("#btn-grades-refresh").addEventListener("click", openGradesRefresh);

// ---------- Tab: Einstellungen ----------
function displayName(me) { return me.name || (me.uni.id === "jku" ? me.matrikel : me.username); }

function renderSettings() {
  const me = state.me;
  setAvatar($("#set-avatar"));
  $("#set-name").textContent = displayName(me) + (me.demo ? " (Demo)" : "");
  $("#set-sub").textContent = [me.name ? me.matrikel : null, me.uni.name].filter(Boolean).join(" · ");
  $("#set-status").textContent = me.connected ? (me.ical_source === "auto" ? "Automatisch" : "Verbunden") : "Nicht verbunden";
  $("#set-sync").textContent = me.last_sync ? ago(me.last_sync) : "noch nie";
  $("#sync-error").textContent = me.last_sync_error || "";
  $("#set-moodle").textContent = me.moodle?.error ? "Fehler" : me.moodle?.connected ? "Verbunden" : "";
  $("#mensa-row").hidden = !me.mensa;
  $("#campus-row").hidden = me.campus !== "usi";
  if (me.campus === "usi" && !$("#campus-row .switch")) {
    $("#campus-row").append(makeSwitch(!campusHidden(), (v) => { try { localStorage.setItem(CAMPUS_HIDE, v ? "0" : "1"); } catch {} }));
  }
  if (me.mensa && !$("#mensa-row .switch")) {
    $("#mensa-row").append(makeSwitch(!mensaHidden(), (v) => { try { localStorage.setItem(MENSA_HIDE, v ? "0" : "1"); } catch {} }));
  }
  applyTheme();
}

$("#btn-sync").addEventListener("click", async () => {
  $("#btn-sync").textContent = "Wird aktualisiert …";
  try { await post("/api/sync"); weekCache.clear(); state.deadlines = null; $("#sync-error").textContent = ""; }
  catch (err) { $("#sync-error").textContent = err.message; }
  $("#btn-sync").textContent = "Jetzt aktualisieren";
  await loadMe(); renderSettings();
});
$("#btn-logout").addEventListener("click", async () => { await post("/api/logout").catch(() => {}); showLogin(); });
$("#btn-delete").addEventListener("click", async () => {
  if (!confirm("Konto mit allen Schaltern, Terminen und Noten endgültig löschen? Der Kalender-Abo-Link hört auf zu funktionieren.")) return;
  await api("/api/account", { method: "DELETE" }); showLogin();
});

// Testmodus für Unis ohne fertige Anbindung: einmal anmelden, Diagnose-Text an Jacob schicken
function probeSection(me) {
  const form = el("form");
  const user = el("input"); user.className = "field"; user.placeholder = "Benutzername der Uni"; user.autocomplete = "username"; user.required = true;
  user.value = me.matrikel || ""; user.autocapitalize = "none";
  const pw = el("input"); pw.className = "field"; pw.type = "password"; pw.placeholder = "Passwort der Uni"; pw.autocomplete = "current-password"; pw.required = true;
  const btn = el("button", "row row-btn", "Login testen"); btn.type = "submit";
  const err = el("p", "error");
  const out = el("div");
  form.append(group(user, pw, btn), note("Studo+ meldet sich einmal an und notiert nur, welche Seiten und Formularfelder kamen – keine Passwörter, keine Inhalte. Das Passwort wird nicht gespeichert."), err, out);
  form.addEventListener("submit", async (e) => {
    e.preventDefault(); err.textContent = ""; out.replaceChildren();
    btn.disabled = true; btn.textContent = "Wird getestet …";
    try {
      const r = await post("/api/probe", { username: user.value, password: pw.value });
      pw.value = "";
      const pre = el("pre", "probe-report", r.report);
      const copy = el("button", "row row-btn", "Text kopieren");
      copy.type = "button";
      copy.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(r.report); copy.textContent = "Kopiert ✓"; haptic(); } catch { copy.textContent = "Bitte Text markieren und kopieren"; }
      });
      out.append(header(`Ergebnis: ${r.status}`), group(pre, copy), note("Diesen Text bitte an Jacob schicken."));
    } catch (x) { err.textContent = x.message; }
    btn.disabled = false; btn.textContent = "Login testen";
  });
  return [header("Automatische Anbindung testen"), form];
}

// Verbindung zur Uni: KUSSS neu verbinden oder iCal-Link einfügen
function openConnection() {
  const me = state.me;
  pushPage("Verbindung zur Uni", (body) => {
    body.append(el("div", "page-head"));
    $(".page-head", body).append(el("h1", "", "Verbindung zur Uni"), el("p", "", me.connected ? `Verbunden${me.last_sync ? `, aktualisiert ${ago(me.last_sync)}` : ""}` : "Noch nicht verbunden"));
    if (me.uni.auto && !me.demo) {
      const form = el("form");
      const pw = el("input"); pw.type = "password"; pw.name = "password"; pw.required = true; pw.placeholder = "JKU-Passwort"; pw.autocomplete = "current-password"; pw.className = "field";
      const btn = el("button", "row row-btn", "Kalender, Noten und Name holen"); btn.type = "submit";
      const err = el("p", "error");
      form.append(group(pw, btn), note("Studo+ meldet sich einmal bei KUSSS an. Das Passwort wird nicht gespeichert."), err);
      form.addEventListener("submit", async (e) => {
        e.preventDefault(); btn.textContent = "Verbinde mit KUSSS …"; btn.disabled = true; err.textContent = "";
        try { await post("/api/jku/connect", { password: pw.value }); await loadMe(); state.gradesData = null; state.regs = null; navLockUntil = 0; goBack(); }
        catch (x) { err.textContent = x.message; }
        btn.textContent = "Kalender, Noten und Name holen"; btn.disabled = false;
      });
      body.append(header("KUSSS"), form);
      loadRegs().then((r) => {
        if (!r.synced) return;
        const rows = [row("Anmeldefristen", r.items.length ? `${r.items.length} gefunden` : "keine gefunden"), row("Zuletzt geholt", ago(r.synced))];
        const box = [header("Prüfungsanmeldungen"), group(...rows)];
        if (!r.items.length && r.diag) {
          const copy = el("button", "row row-btn", "Diagnose für Jacob kopieren");
          copy.addEventListener("click", async () => {
            try { await navigator.clipboard.writeText(r.diag); copy.textContent = "Kopiert ✓"; haptic(); } catch { copy.textContent = "Kopieren nicht möglich"; }
          });
          box.push(group(copy), note("Falls in KUSSS Prüfungstermine mit Anmeldung stehen, Studo+ sie aber nicht erkennt: Diesen Text an Jacob schicken. Er enthält nur den Aufbau der Seite, keine Namen oder Noten."));
        }
        form.after(...box);
      }).catch(() => {});
    }
    if (me.uni.probe && !me.demo) body.append(...probeSection(me));
    const form = el("form");
    const url = el("input"); url.type = "url"; url.name = "ical_url"; url.placeholder = "https://…"; url.autocomplete = "off"; url.className = "field";
    const btn = el("button", "row row-btn", "Link speichern"); btn.type = "submit";
    const err = el("p", "error");
    form.append(group(url, btn), note(me.uni.ical_hint), err);
    form.addEventListener("submit", async (e) => {
      e.preventDefault(); btn.textContent = "Wird geprüft …"; err.textContent = "";
      try { await put("/api/settings", { ical_url: url.value }); await loadMe(); navLockUntil = 0; goBack(); }
      catch (x) { err.textContent = x.message; }
      btn.textContent = "Link speichern";
    });
    body.append(header("Kalender-Link (iCal)"), form);
  });
}

// Moodle-Abgaben: persönlichen Kalender-Export-Link aus Moodle hinterlegen
function openMoodle() {
  const me = state.me;
  pushPage("Moodle-Abgaben", (body) => {
    const head = el("div", "page-head");
    const m = me.moodle || {};
    head.append(el("h1", "", "Moodle-Abgaben"),
      el("p", "", m.connected ? `Verbunden${m.last_sync ? `, aktualisiert ${ago(m.last_sync)}` : ""}` : "Abgabefristen aus Moodle auf dem Home-Screen und im Apple Kalender."));
    body.append(head);
    const form = el("form");
    const url = el("input"); url.type = "url"; url.name = "moodle_url"; url.placeholder = "https://…/calendar/export_execute.php?…"; url.autocomplete = "off"; url.className = "field";
    const btn = el("button", "row row-btn", "Link speichern"); btn.type = "submit";
    const err = el("p", "error", m.error || "");
    form.append(group(url, btn), err);
    form.addEventListener("submit", async (e) => {
      e.preventDefault(); btn.textContent = "Wird geprüft …"; btn.disabled = true; err.textContent = "";
      try { await put("/api/settings", { moodle_url: url.value }); await loadMe(); state.deadlines = null; haptic(); navLockUntil = 0; goBack(); }
      catch (x) { err.textContent = x.message; }
      btn.textContent = "Link speichern"; btn.disabled = false;
    });
    body.append(header(m.connected ? "Neuen Link einfügen" : "Kalender-Link aus Moodle"), form);
    const steps = el("ol", "steps");
    for (const t of ["In Moodle oben auf das Kalender-Symbol tippen und „Vollständigen Kalender“ öffnen.",
      "Ganz unten „Kalender importieren oder exportieren“ und dann „Kalender exportieren“ wählen.",
      "Bei Ereignisse „Alle Ereignisse“ (oder „Ereignisse aus Kursen“), bei Zeitspanne „Kürzliche und nächste 60 Tage“ wählen.",
      "„Kalender-URL abfragen“ tippen, den Link kopieren und oben einfügen."]) steps.append(el("li", "", t));
    body.append(header("So findest du den Link"), group(steps),
      note("Der Link wirkt wie ein Passwort für deinen Moodle-Kalender. Teile ihn mit niemandem."));
    if (m.connected && !me.demo) {
      const rm = el("button", "row row-btn danger", "Moodle trennen");
      rm.addEventListener("click", async () => {
        if (!confirm("Moodle-Abgaben aus Studo+ entfernen?")) return;
        try { await put("/api/settings", { moodle_url: "" }); await loadMe(); state.deadlines = null; navLockUntil = 0; goBack(); }
        catch (x) { err.textContent = x.message; }
      });
      body.append(el("div", "group-spaced"), group(rm));
    }
  });
}

// Mitteilungen (Web Push): Raumänderungen, Ausfälle, Erinnerungen an Abgaben und Prüfungen
const PUSH_OK = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const keyBytes = (b64) => Uint8Array.from(atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64.length + 3) % 4)), (c) => c.charCodeAt(0));
function openPush() {
  pushPage("Mitteilungen", async (body) => {
    const head = el("div", "page-head");
    head.append(el("h1", "", "Mitteilungen"), el("p", "", "Studo+ meldet sich, wenn sich bei deinen Terminen etwas ändert oder eine Frist näher rückt."));
    body.append(head);
    if (!PUSH_OK) {
      const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
      body.append(group(el("div", "row empty-row", "Auf diesem Gerät nicht verfügbar")),
        note(ios && !STANDALONE
          ? "Auf dem iPhone gibt es Mitteilungen nur, wenn Studo+ am Home-Bildschirm liegt: In Safari auf Teilen › „Zum Home-Bildschirm“ tippen und Studo+ dann von dort öffnen."
          : "Dieser Browser unterstützt keine Mitteilungen."));
      return;
    }
    let info, sub;
    try { [info, sub] = await Promise.all([api("/api/push"), navigator.serviceWorker.ready.then((r) => r.pushManager.getSubscription())]); }
    catch (err) { errorBox(body, err); return; }
    const prefsBox = el("div"), testBtn = el("button", "row row-btn", "Test-Mitteilung senden");
    const refresh = () => { prefsBox.hidden = !sub; testBtn.disabled = !sub; };

    const devRow = el("label", "row");
    devRow.append(el("span", "", "Auf diesem Gerät"), makeSwitch(!!sub && Notification.permission === "granted", async (on) => {
      if (on) {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") {
          throw new Error(perm === "denied"
            ? "Mitteilungen sind blockiert. Erlaube sie in den Einstellungen deines Geräts unter Mitteilungen › Studo+."
            : "Mitteilungen wurden nicht erlaubt.");
        }
        const reg = await navigator.serviceWorker.ready;
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(info.key) });
        await post("/api/push/subscribe", { subscription: sub.toJSON() });
      } else if (sub) {
        await post("/api/push/unsubscribe", { endpoint: sub.endpoint });
        await sub.unsubscribe().catch(() => {});
        sub = null;
      }
      refresh();
    }));
    body.append(group(devRow));

    const prefRow = (key, label, hint) => {
      const r = el("label", "row");
      const t = el("div", "meal-text"); t.append(el("span", "", label), el("span", "meal-cat pref-hint", hint));
      r.append(t, makeSwitch(info.prefs[key], async (v) => { info.prefs = await put("/api/push/prefs", { [key]: v }); }));
      return r;
    };
    prefsBox.append(header("Worüber"), group(
      prefRow("changes", "Raumänderungen und Ausfälle", "Termine der nächsten 7 Tage"),
      prefRow("deadlines", "Abgaben", "24 Stunden vorher"),
      prefRow("exams", "Prüfungen und Vorträge", "24 Stunden vorher"),
    ));
    testBtn.addEventListener("click", async () => {
      testBtn.disabled = true; testBtn.textContent = "Wird gesendet …";
      try { await post("/api/push/test", { endpoint: sub.endpoint }); testBtn.textContent = "Gesendet ✓"; haptic(); }
      catch (err) { testBtn.textContent = "Test-Mitteilung senden"; alert(err.message); }
      setTimeout(() => { testBtn.textContent = "Test-Mitteilung senden"; testBtn.disabled = !sub; }, 2500);
    });
    prefsBox.append(el("div", "group-spaced"), group(testBtn));
    body.append(prefsBox,
      note("Neue Noten können leider nicht gemeldet werden: KUSSS gibt sie nur mit deinem Passwort heraus, und das speichert Studo+ bewusst nicht."));
    refresh();
  });
}

// Apple Kalender: Abo, Markierung der Anwesenheitspflicht, Link
function openAbo() {
  pushPage("Apple Kalender", (body) => {
    body.append(el("div", "page-head"));
    $(".page-head", body).append(el("h1", "", "Apple Kalender"), el("p", "", "Dein Stundenplan als Kalender-Abo, aktualisiert sich von selbst."));
    const sub = el("a", "btn-primary", "In Apple Kalender abonnieren");
    sub.href = state.me.feed.webcal;
    sub.style.textDecoration = "none"; sub.style.marginTop = "0";
    body.append(sub);

    const marker = el("div", "group");
    for (const [v, label] of [["prefix", "„!“ vor dem Kursnamen"], ["emoji", "🔴 vor dem Kursnamen"], ["notes", "Nur in den Notizen"]]) {
      const l = el("label", "row check-row");
      const r = el("input"); r.type = "radio"; r.name = "marker"; r.value = v; r.checked = state.me.marker_style === v;
      r.addEventListener("change", async () => { await put("/api/settings", { marker_style: v }); state.me.marker_style = v; haptic(); });
      l.append(el("span", "", label), r, el("span", "check"));
      marker.append(l);
    }
    body.append(header("Anwesenheitspflicht markieren"), marker);

    const copy = el("button", "row row-btn", "Abo-Link kopieren");
    copy.addEventListener("click", async () => {
      await navigator.clipboard.writeText(state.me.feed.https);
      copy.textContent = "Kopiert ✓"; haptic(); setTimeout(() => (copy.textContent = "Abo-Link kopieren"), 1500);
    });
    const rotate = el("button", "row row-btn", "Abo-Link erneuern");
    rotate.addEventListener("click", async () => {
      if (!confirm("Neuen Abo-Link erzeugen? Bestehende Kalender-Abos hören auf zu aktualisieren.")) return;
      state.me.feed = await post("/api/feed/rotate"); sub.href = state.me.feed.webcal;
    });
    body.append(header("Abo-Link"), group(copy, rotate), note("Erneuern macht den alten Link ungültig. Danach neu abonnieren."));
  });
}

// ---------- Persönliche Daten + Studienrichtungen ----------
// Studienangebot der JKU als Baum: Studienart › Fakultät › Studium. Kennzahlen nur, wo sie sicher bekannt sind;
// alle anderen kommen beim Laden der Noten automatisch aus KUSSS.
const TNF = "Technisch-Naturwissenschaftliche Fakultät", SOWI = "Sozial- und Wirtschaftswissenschaftliche Fakultät";
const JKU_TREE = {
  Bachelor: {
    [TNF]: [["Artificial Intelligence"], ["Biologische Chemie"], ["Chemie"], ["Elektronik und Informationstechnik"], ["Informatik", "UK 033 521"],
      ["Kunststofftechnik"], ["Mechatronik"], ["Medizintechnik"], ["Technische Mathematik"], ["Technische Physik"]],
    [SOWI]: [["Kulturwissenschaften"], ["Sozialwirtschaft"], ["Soziologie"], ["Statistik und Data Science"],
      ["Wirtschaftsinformatik", "UK 033 526"], ["Wirtschaftswissenschaften"]],
    "Medizinische Fakultät": [["Humanmedizin"]],
  },
  Master: {
    [TNF]: [["Artificial Intelligence"], ["Computer Science"], ["Mechatronik"]],
    [SOWI]: [["Wirtschaftsinformatik"]],
  },
  Diplom: { "Rechtswissenschaftliche Fakultät": [["Rechtswissenschaften"]] },
};
const ECTS_BY_TYPE = { Bachelor: 180, Master: 120, Diplom: 240 };

// Profilbild: quadratisch zuschneiden, auf 256 px verkleinern, als JPEG speichern
function pickAvatar(onDone) {
  const input = el("input"); input.type = "file"; input.accept = "image/*";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = async () => {
        const size = 256, c = document.createElement("canvas");
        c.width = c.height = size;
        const side = Math.min(img.width, img.height);
        c.getContext("2d").drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
        try { state.me = { ...state.me, ...(await put("/api/profile", { avatar: c.toDataURL("image/jpeg", .85) })) }; onDone(); haptic(); }
        catch (err) { alert(err.message); }
      };
      img.onerror = () => alert("Das Bild konnte nicht gelesen werden.");
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
  input.click();
}

function openProfile() {
  pushPage("Persönliche Daten", (body, entry) => {
    const me = state.me;
    const head = el("div", "page-head profile-head");
    const av = el("button", "avatar avatar-lg"); setAvatar(av);
    av.setAttribute("aria-label", "Profilbild ändern");
    const edit = el("button", "text-btn", me.avatar ? "Foto ändern" : "Foto hinzufügen");
    const refreshAvatar = () => { setAvatar(av); setAvatar($("#avatar")); edit.textContent = state.me.avatar ? "Foto ändern" : "Foto hinzufügen"; remove.hidden = !state.me.avatar; };
    const remove = el("button", "text-btn muted-btn", "Entfernen");
    remove.hidden = !me.avatar;
    remove.addEventListener("click", async () => { state.me = { ...state.me, ...(await put("/api/profile", { avatar: null })) }; refreshAvatar(); });
    av.addEventListener("click", () => pickAvatar(refreshAvatar));
    edit.addEventListener("click", () => pickAvatar(refreshAvatar));
    const actions = el("div", "avatar-actions"); actions.append(edit, remove);
    head.append(av, actions);
    body.append(head);

    const fromUni = me.name_source === "uni";
    let nameRow;
    if (fromUni || me.uni.auto) nameRow = row("Name", me.name || "wird beim nächsten KUSSS-Login übernommen");
    else {
      nameRow = el("label", "row");
      const input = el("input"); input.value = me.name || ""; input.placeholder = "Vor- und Nachname"; input.autocomplete = "name";
      input.addEventListener("change", async () => {
        try { state.me = { ...state.me, ...(await put("/api/profile", { name: input.value })) }; refreshAvatar(); haptic(); }
        catch (err) { alert(err.message); }
      });
      nameRow.append(el("span", "row-label", "Name"), input);
    }
    body.append(group(nameRow, row(me.uni.id === "jku" ? "Matrikelnummer" : "Kennung", me.matrikel), row("Hochschule", me.uni.name)));
    if (me.uni.auto) body.append(note(me.name ? "Name und Matrikelnummer kommen direkt aus KUSSS." : "Der Name kommt aus KUSSS. Unter Einstellungen › Verbindung zur Uni holst du ihn jetzt."));

    const list = el("div", "group");
    body.append(header("Studienrichtungen"), list);
    const add = group(navRow("Studienrichtung hinzufügen", openProgramAdd));
    add.classList.add("group-gap");
    body.append(add, note("ECTS und Notenschnitt werden pro Studienrichtung berechnet."));
    const fill = (programs) => {
      list.replaceChildren(...programs.map((p) => {
        const r = el("button", "row course-row");
        const text = el("span", "course-text");
        text.append(el("span", "course-title", p.name), el("span", "course-sub", [p.code, p.ects_target ? `${p.ects_target} ECTS` : null, p.source === "kusss" ? "aus KUSSS" : null].filter(Boolean).join(" · ") || "–"));
        r.append(text, chev());
        r.addEventListener("click", () => openProgram(p));
        return r;
      }));
      if (!programs.length) list.append(el("div", "row empty-row", "Noch keine Studienrichtung"));
    };
    entry.refresh = () => fill(state.gradesData?.programs || []);
    (state.gradesData ? Promise.resolve(state.gradesData) : loadGrades()).then((d) => fill(d.programs)).catch((err) => errorBox(list, err, "Studienrichtungen"));
  });
}

// Studienrichtung wählen: Studienart › Fakultät › Studium, Kennzahl und ECTS-Ziel füllen sich selbst
function openProgramAdd() {
  const isJku = state.me.uni.id === "jku";
  pushPage("Studienrichtung", (body) => {
    const head = el("div", "page-head"); head.append(el("h1", "", "Studienrichtung")); body.append(head);
    const mkSelect = (label) => {
      const r = el("label", "row"); const s = el("select");
      r.append(el("span", "row-label", label), s);
      return [r, s];
    };
    const [typeRow, typeSel] = mkSelect("Studienart");
    const [facRow, facSel] = mkSelect("Fakultät");
    const [progRow, progSel] = mkSelect("Studium");
    const nameRow = el("label", "row"); const nameIn = el("input"); nameIn.placeholder = "z. B. Bachelor Statistik";
    nameRow.append(el("span", "row-label", "Name"), nameIn);
    const ectsRow = el("label", "row"); const ectsIn = el("input"); ectsIn.inputMode = "numeric"; ectsIn.placeholder = "180";
    ectsRow.append(el("span", "row-label", "ECTS-Ziel"), ectsIn);
    const codeRow = el("label", "row"); const codeIn = el("input"); codeIn.placeholder = "kommt aus KUSSS";
    codeRow.append(el("span", "row-label", "Kennzahl"), codeIn);

    const fillSel = (sel, items) => { sel.replaceChildren(...items.map(([v, t]) => new Option(t, v))); };
    const types = isJku ? Object.keys(JKU_TREE) : [];
    fillSel(typeSel, [["", "Bitte wählen"], ...types.map((t) => [t, t]), ["other", "Anderes Studium …"]]);
    const update = (level) => {
      const type = typeSel.value, other = type === "other" || !type;
      if (level <= 1) {
        const facs = JKU_TREE[type] ? Object.keys(JKU_TREE[type]) : [];
        fillSel(facSel, facs.map((f) => [f, f]));
        if (ECTS_BY_TYPE[type]) ectsIn.value = ECTS_BY_TYPE[type];
      }
      if (level <= 2) {
        const progs = JKU_TREE[type]?.[facSel.value] || [];
        fillSel(progSel, progs.map(([n]) => [n, n]));
      }
      const prog = (JKU_TREE[type]?.[facSel.value] || []).find(([n]) => n === progSel.value);
      codeIn.value = prog?.[1] || "";
      facRow.hidden = progRow.hidden = other;
      nameRow.hidden = type !== "other";
    };
    typeSel.addEventListener("change", () => update(1));
    facSel.addEventListener("change", () => update(2));
    progSel.addEventListener("change", () => update(3));
    update(1);

    const btn = el("button", "btn-primary", "Hinzufügen");
    const err = el("p", "error");
    btn.addEventListener("click", async () => {
      err.textContent = "";
      const type = typeSel.value;
      const name = type === "other" ? nameIn.value.trim() : type && progSel.value ? `${type} ${progSel.value}` : "";
      if (!name) { err.textContent = "Bitte ein Studium wählen."; return; }
      try {
        state.gradesData = await post("/api/programs", { name, code: codeIn.value || null, ects_target: +ectsIn.value || null });
        navLockUntil = 0; goBack();
      } catch (x) { err.textContent = x.message; }
    });
    body.append(group(typeRow, facRow, progRow, nameRow, ectsRow, codeRow),
      note(isJku ? "Kennzahl und ECTS-Ziel werden ausgefüllt, sobald du ein Studium wählst. Fehlt die Kennzahl, kommt sie mit den Noten aus KUSSS." : "ECTS-Ziel: Bachelor meist 180, Master 120."),
      btn, err);
  });
}

function openProgram(p) {
  pushPage(p.name, (body) => {
    const head = el("div", "page-head"); head.append(el("h1", "", p.name)); body.append(head);
    const ects = el("input"); ects.inputMode = "numeric"; ects.value = p.ects_target || ""; ects.placeholder = "180";
    const code = el("input"); code.value = p.code || ""; code.placeholder = "optional";
    const save = async () => {
      try { state.gradesData = await put(`/api/programs/${p.id}`, { code: code.value || null, ects_target: +ects.value || null }); Object.assign(p, { code: code.value || null, ects_target: +ects.value || null }); haptic(); }
      catch (err) { alert(err.message); }
    };
    ects.addEventListener("change", save); code.addEventListener("change", save);
    const r1 = el("label", "row"); r1.append(el("span", "row-label", "ECTS-Ziel"), ects);
    const r2 = el("label", "row"); r2.append(el("span", "row-label", "Kennzahl"), code);
    const del = el("button", "row row-btn danger", "Studienrichtung entfernen");
    del.addEventListener("click", async () => {
      if (!confirm(`„${p.name}“ entfernen? Die Noten bleiben erhalten.`)) return;
      state.gradesData = await api(`/api/programs/${p.id}`, { method: "DELETE" }); navLockUntil = 0; goBack();
    });
    body.append(group(r1, r2), el("div", "group-spaced"), group(del));
  });
}

// ---------- Start ----------
async function loadMe() {
  state.me = await api("/api/me");
  setAvatar($("#avatar"));
}

async function boot() {
  try { await loadMe(); }
  catch {
    // Nicht als Student angemeldet: vielleicht läuft noch eine Admin-Sitzung
    try { await showAdmin(); } catch { showLogin(); }
    return;
  }
  hideAll(); $("#app").hidden = false;
  try { const m = localStorage.getItem("studo_calmode"); if (["day", "week", "list"].includes(m)) state.cal.mode = m; } catch {}
  if (!state.unis.length) api("/api/unis").then((u) => (state.unis = u)).catch(() => {});
  loadGrades().catch(() => {});
  loadCourses().catch(() => {});
  renderLinks();
  switchTab("home");
  endSplash();
  freshen();
}

// Beim Öffnen/Zurückkehren: Stundenplan frisch holen, wenn der letzte Abgleich älter als 3 Minuten ist
let freshening = false;
async function freshen() {
  if (freshening || !state.me || state.me.demo || $("#app").hidden) return;
  freshening = true;
  try {
    const r = await post("/api/sync?if_stale=1");
    if (!r?.skipped) { for (const w of weekCache.values()) w.at = 0; state.deadlines = null; await loadMe(); if (!stack.length) renderTab(state.tab); }
  } catch {} finally { freshening = false; }
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden || !state.me || $("#app").hidden) return;
  if (!stack.length) renderTab(state.tab);
  freshen();
});
boot();
