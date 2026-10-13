// Studo+ Frontend – bewusst ohne Framework. Fünf Tabs, ein Bottom-Sheet für Details, eigener Admin-Bereich.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const state = {
  me: null, unis: [], tab: "today",
  cal: { mode: "day", day: midnight(new Date()) },
  sem: null, coursesData: null, gradesData: null, program: "all",
};
const WD = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const TAB_TITLES = { today: "Heute", calendar: "Kalender", courses: "Kurse", study: "Studium", settings: "Einstellungen", profile: "Persönliche Daten" };
const COLORS = ["#D35400", "#007AFF", "#34C759", "#AF52DE", "#FF2D55", "#5AC8FA", "#FF9500", "#5856D6", "#30B0C7", "#A2845E"];
const fmtTime = new Intl.DateTimeFormat("de-AT", { hour: "2-digit", minute: "2-digit" });
const fmtDay = new Intl.DateTimeFormat("de-AT", { weekday: "long", day: "numeric", month: "long" });
const fmtDayShort = new Intl.DateTimeFormat("de-AT", { weekday: "short", day: "numeric", month: "short" });
const fmtMonth = new Intl.DateTimeFormat("de-AT", { month: "long", year: "numeric" });
const fmtWeek = new Intl.DateTimeFormat("de-AT", { day: "numeric", month: "short" });
const fmtShort = new Intl.DateTimeFormat("de-AT", { day: "numeric", month: "numeric" });
const fmtDate = new Intl.DateTimeFormat("de-AT", { day: "numeric", month: "numeric", year: "numeric" });
const fmtNum = new Intl.NumberFormat("de-AT", { maximumFractionDigits: 2 });
const fmtAvg = new Intl.NumberFormat("de-AT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

if (!("switch" in HTMLInputElement.prototype)) document.documentElement.classList.add("no-native-switch");
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");

// ---------- Start-Animation ----------
// Hält das Logo kurz, mindestens bis die Sitzung geprüft ist, dann gleitet der Vorhang nach oben.
let splashStarted = Date.now();
function endSplash() {
  const html = document.documentElement;
  const splash = $("#splash");
  if (!splash || html.classList.contains("splash-done")) return;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const hold = Math.max(0, (reduced ? 200 : 1400) - (Date.now() - splashStarted));
  let done = false;
  const finish = () => { if (done) return; done = true; splash.remove(); html.classList.add("splash-done"); };
  setTimeout(() => {
    splash.classList.add("is-leaving");
    html.classList.remove("splashing");
    splash.addEventListener("animationend", (e) => { if (e.target === splash) finish(); });
    setTimeout(finish, reduced ? 400 : 1200); // Sicherheitsnetz
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

// iOS: Der native <input switch> (Safari 17.4+) gibt selbst ein Taptic-Feedback; Android nutzt vibrate().
function haptic() { if (navigator.vibrate) navigator.vibrate(8); }

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

// Initialen aus dem echten Namen (z. B. "Jacob Haselgruber" -> "JH"), sonst Personen-Symbol
function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter((p) => /^\p{L}/u.test(p));
  if (!parts.length) return "";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
function setAvatar(node, name) {
  const ini = initials(name);
  if (ini) node.textContent = ini;
  else node.replaceChildren(svg('<circle cx="12" cy="8.5" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7z"/>'));
}

// Kursfarbe: nach Kursliste durchnummeriert (keine Doppelten), sonst stabil aus der Kurs-ID
const colorMap = new Map();
function assignColors(courses) { courses.forEach((c, i) => colorMap.set(c.course_id, COLORS[i % COLORS.length])); }
function courseColor(id) {
  if (colorMap.has(id)) return colorMap.get(id);
  let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

// ---------- Bottom-Sheet ----------
function openSheet(title, ...content) {
  $("#sheet-title").textContent = title;
  $("#sheet-body").replaceChildren(...content);
  const sheet = $("#sheet"), bd = $("#sheet-backdrop");
  sheet.classList.remove("closing"); bd.classList.remove("closing");
  sheet.hidden = false; bd.hidden = false; sheet.scrollTop = 0;
  document.body.style.overflow = "hidden";
}
function closeSheet() {
  const sheet = $("#sheet"), bd = $("#sheet-backdrop");
  if (sheet.hidden) return;
  sheet.classList.add("closing"); bd.classList.add("closing");
  setTimeout(() => { sheet.hidden = true; bd.hidden = true; sheet.classList.remove("closing"); bd.classList.remove("closing"); }, 240);
  document.body.style.overflow = "";
}
$("#sheet-close").addEventListener("click", closeSheet);
$("#sheet-backdrop").addEventListener("click", closeSheet);
addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });

// Schalter mit sofortigem Feedback: UI ändert sich gleich, Server im Hintergrund, nur bei Fehler zurück
function makeSwitch(checked, onChange) {
  const sw = el("input", "switch");
  sw.type = "checkbox"; sw.setAttribute("switch", ""); sw.checked = checked;
  sw.addEventListener("change", async () => {
    haptic();
    try { await onChange(sw.checked); } catch (err) { sw.checked = !sw.checked; alert(err.message); }
  });
  return sw;
}

// ---------- Login ----------
function hideAll() { ["#login", "#admin-login", "#admin-screen", "#app"].forEach((s) => ($(s).hidden = true)); closeSheet(); }
function showLogin() {
  hideAll(); $("#login").hidden = false; endSplash();
  if (!state.unis.length) loadUnis();
}

async function loadUnis() {
  try { state.unis = await api("/api/unis"); } catch { return; }
  const sel = $("#login-uni");
  sel.replaceChildren(...state.unis.map((u) => { const o = el("option", "", u.name); o.value = u.id; return o; }));
  try { const last = localStorage.getItem("studo_uni"); if (last && state.unis.some((u) => u.id === last)) sel.value = last; } catch {}
  updateLoginHint();
}

function updateLoginHint() {
  const u = state.unis.find((x) => x.id === $("#login-uni").value);
  if (!u) return;
  $("#login-user-label").textContent = u.userLabel;
  $("#login-form [name=username]").placeholder = u.userPlaceholder;
  $("#login-form [name=username]").inputMode = u.id === "jku" ? "numeric" : "text";
  $("#login-hint").textContent = u.auto
    ? `Mit Matrikelnummer und Passwort deines ${u.name}-Accounts anmelden. Stundenplan und Noten kommen automatisch aus KUSSS. ` +
      "Das Passwort geht nur an die Uni und wird nie im Klartext gespeichert."
    : `Für ${u.name} gibt es noch keinen automatischen Login. Beim ersten Mal legst du ein eigenes ` +
      "Studo+-Passwort fest und fügst danach den iCal-Link deines Stundenplans ein.";
}
$("#login-uni").addEventListener("change", updateLoginHint);

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const btn = $("#login-form .btn-primary");
  const uni = state.unis.find((x) => x.id === f.get("uni"));
  btn.disabled = true; $(".spinner", btn).hidden = false;
  $(".label", btn).textContent = uni?.auto ? `Verbinde mit ${uni.name} …` : "Anmelden …";
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
$$(".tabbar button").forEach((b) => b.addEventListener("click", () => { haptic(); switchTab(b.dataset.tab); }));
$("#avatar").addEventListener("click", () => switchTab("profile"));
$("#btn-profile").addEventListener("click", () => switchTab("profile"));
$$("[data-back]").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.back)));

function switchTab(name) {
  state.tab = name;
  const navName = name === "profile" ? "settings" : name;
  $$(".tabbar button").forEach((b) => b.classList.toggle("active", b.dataset.tab === navName));
  $$(".tab").forEach((t) => (t.hidden = t.id !== `tab-${name}`));
  $("#appbar-title").textContent = TAB_TITLES[name] || "";
  window.scrollTo({ top: 0 });
  renderTab(name);
}
function renderTab(name) {
  const run = { today: renderToday, calendar: renderCalendar, courses: renderCourses, study: renderStudy, settings: renderSettings, profile: renderProfile }[name];
  if (run) Promise.resolve(run()).catch((err) => console.error(err));
}
addEventListener("scroll", () => $$(".appbar").forEach((a) => a.classList.toggle("scrolled", scrollY > 40)), { passive: true });

async function fetchEvents(from, to) {
  return api(`/api/events?start=${encodeURIComponent(from.toISOString())}&end=${encodeURIComponent(to.toISOString())}`);
}
function errorBox(box, err, what = "Termine") {
  box.replaceChildren(el("div", "row empty-row", `${what} konnten nicht geladen werden: ${err.message}`));
}

// ---------- Termin-Zeile und Termin-Details ----------
function evRow(ev) {
  const r = el("button", "row ev-row");
  r.style.setProperty("--c", courseColor(ev.course_id));
  r.classList.toggle("cancelled", ev.status === "cancelled");
  const s = new Date(ev.start), e = new Date(ev.end);
  const time = el("div", "ev-time", fmtTime.format(s)); time.append(el("span", "", fmtTime.format(e)));
  const main = el("div", "ev-main");
  const title = el("div", "ev-title", ev.title);
  if (ev.kind) title.append(el("span", "kind", ev.kind));
  main.append(title, el("div", "ev-loc", ev.status === "cancelled" ? "Entfällt" : ev.location || "Ort unbekannt"));
  r.append(time, el("div", "ev-bar"), main);
  if (ev.attendance) { const m = el("span", "must", "!"); m.title = "Anwesenheitspflicht"; r.append(m); } else r.append(el("span"));
  r.addEventListener("click", () => openEvent(ev));
  return r;
}

function openEvent(ev) {
  const s = new Date(ev.start), e = new Date(ev.end);
  const info = el("div", "group");
  info.append(
    row("Datum", fmtDay.format(s)),
    row("Zeit", `${fmtTime.format(s)} – ${fmtTime.format(e)}`),
    row("Ort", ev.location || "unbekannt"),
  );
  if (ev.kind) info.append(row("Art", ev.kind));
  if (ev.status === "cancelled") info.append(row("Status", "Entfällt"));
  if (ev.room_raw && ev.room_raw !== ev.room) info.append(row("Laut Uni", ev.room_raw));

  // Anwesenheitspflicht ist eine Zusatzfunktion: Kurs-Standard + optionale Ausnahme für diesen Termin
  const att = el("div", "group");
  const courseRow = el("label", "row");
  courseRow.append(el("span", "", "Anwesenheitspflicht im Kurs"), makeSwitch(ev.course_attendance, async (v) => {
    await put(`/api/courses/${encodeURIComponent(ev.course_id)}/attendance`, { attendance: v });
    ev.course_attendance = v; if (!ev.is_override) ev.attendance = v;
    renderTab(state.tab);
  }));
  const segRow = el("div", "row row-stack");
  segRow.append(el("span", "", "Nur dieser Termin"));
  const seg = el("div", "segmented");
  const current = ev.is_override ? (ev.attendance ? "1" : "0") : "inherit";
  for (const [v, label] of [["inherit", "Wie Kurs"], ["1", "Pflicht"], ["0", "Keine"]]) {
    const b = el("button", v === current ? "on" : "", label);
    b.addEventListener("click", async () => {
      const value = v === "inherit" ? null : v === "1";
      try {
        await put(`/api/events/${encodeURIComponent(ev.uid)}/attendance`, { attendance: value });
        $$("button", seg).forEach((x) => x.classList.toggle("on", x === b)); haptic();
        ev.is_override = value !== null; ev.attendance = value === null ? ev.course_attendance : value;
        renderTab(state.tab);
      } catch (err) { alert(err.message); }
    });
    seg.append(b);
  }
  segRow.append(seg);
  att.append(courseRow, segRow);

  const courseBtn = el("button", "row row-btn row-nav", "Kurs anzeigen");
  courseBtn.append(chev());
  courseBtn.addEventListener("click", () => openCourse(ev.course_id));

  openSheet(ev.title, info, el("h3", "section-header", "Anwesenheitspflicht"), att,
    el("p", "footnote", "Markierte Termine bekommen im Apple Kalender ein Zeichen vor dem Namen."),
    (() => { const g = el("div", "group group-spaced"); g.append(courseBtn); return g; })());
}

// ---------- Tab: Heute ----------
async function renderToday() {
  const now = new Date();
  $("#today-date").textContent = fmtDay.format(now);
  const me = state.me;
  const notice = me.notice || me.last_sync_error || (!me.connected ? "Noch kein Stundenplan verbunden. Unter Einstellungen kannst du ihn einrichten." : "");
  $("#notice").hidden = !notice; $("#notice").textContent = notice;

  const list = $("#today-list"), next = $("#next-card");
  let events;
  try { events = await fetchEvents(midnight(now), addDays(midnight(now), 14)); } catch (err) { next.replaceChildren(); errorBox(list, err); return; }
  const live = events.filter((e) => e.status !== "cancelled" && new Date(e.end) > now);
  const upcoming = live[0];
  next.replaceChildren();
  if (upcoming) {
    const s = new Date(upcoming.start), running = s <= now;
    const card = el("button", "next");
    card.style.setProperty("--c", courseColor(upcoming.course_id));
    const mins = Math.round((s - now) / 60000);
    const label = running ? "Läuft gerade" : mins < 60 ? `In ${mins} Min.` : `Als Nächstes · ${inDays(s)}`;
    card.append(el("div", "next-label", label), el("div", "next-title", upcoming.title),
      el("div", "next-meta", `${fmtTime.format(s)} – ${fmtTime.format(new Date(upcoming.end))} · ${upcoming.location || "Ort unbekannt"}`));
    card.addEventListener("click", () => openEvent(upcoming));
    next.append(card);
  }

  const todays = events.filter((e) => dayKey(new Date(e.start)) === dayKey(now));
  $("#today-head").textContent = "Termine heute";
  list.replaceChildren(...todays.map(evRow));
  if (!todays.length) {
    list.append(el("div", "row empty-row", events.length ? "Heute keine Termine." : "Keine Termine in den nächsten zwei Wochen."));
  }
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
  $("#links-hint").textContent = links.length && state.me.uni.auto
    ? "Öffnet direkt die Anmeldung der JKU. Bist du im Browser schon einmal angemeldet, geht es ohne Passwort weiter."
    : "";
}

// ---------- Tab: Kalender (Tag, Woche, Liste) ----------
$$("#cal-mode button").forEach((b) => b.addEventListener("click", () => {
  state.cal.mode = b.dataset.mode; haptic();
  try { localStorage.setItem("studo_calmode", b.dataset.mode); } catch {}
  renderCalendar();
}));
$("#cal-prev").addEventListener("click", () => moveCal(-1));
$("#cal-next").addEventListener("click", () => moveCal(1));
$("#cal-today").addEventListener("click", () => { state.cal.day = midnight(new Date()); haptic(); renderCalendar(); });
function moveCal(dir) { state.cal.day = addDays(state.cal.day, state.cal.mode === "day" ? dir : dir * 7); haptic(); renderCalendar(); }

// Wischen nach links/rechts blättert
(() => {
  let x0 = null, y0 = null;
  const view = $("#cal-view");
  view.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  view.addEventListener("touchend", (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) moveCal(dx < 0 ? 1 : -1);
    x0 = null;
  }, { passive: true });
})();

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
  try { events = await fetchEvents(ws, we); } catch (err) { errorBox(view, err); return; }
  if (seq !== calSeq) return; // inzwischen weitergeblättert
  const byDay = events.reduce((m, e) => ((m[dayKey(new Date(e.start))] ??= []).push(e), m), {});

  // Wochenleiste (nur in der Tagesansicht)
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

  if (mode === "list") {
    const out = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(ws, i), list = byDay[dayKey(d)];
      if (!list) continue;
      out.push(el("div", "day-head", fmtDay.format(d)));
      const g = el("div", "group"); g.append(...list.map(evRow)); out.push(g);
    }
    if (!out.length) { const g = el("div", "group"); g.append(el("div", "row empty-row", "Keine Termine in dieser Woche.")); out.push(g); }
    view.replaceChildren(...out);
    return;
  }

  let days;
  if (mode === "day") days = [day];
  else {
    const weekend = [5, 6].some((i) => byDay[dayKey(addDays(ws, i))]);
    days = Array.from({ length: weekend ? 7 : 5 }, (_, i) => addDays(ws, i));
  }
  view.replaceChildren(timeGrid(days, byDay, mode));
}

// Zeitraster wie im Apple Kalender: Stundenlinien, Blöcke nach Uhrzeit, rote Jetzt-Linie
function timeGrid(days, byDay, mode) {
  const HOUR = 52;
  const evs = days.flatMap((d) => byDay[dayKey(d)] || []);
  let h0 = 8, h1 = 18;
  for (const e of evs) {
    const s = new Date(e.start), en = new Date(e.end);
    h0 = Math.min(h0, s.getHours());
    h1 = Math.max(h1, en.getHours() + (en.getMinutes() ? 1 : 0));
  }
  h1 = Math.min(24, Math.max(h1, h0 + 6));
  const height = (h1 - h0) * HOUR;

  const grid = el("div", `grid ${mode}`);
  grid.style.setProperty("--days", days.length);
  const today = dayKey(new Date());
  // Kopfzeile (nur Woche)
  if (mode === "week") {
    const head = el("div", "grid-head");
    head.append(el("div"));
    for (const d of days) {
      const h = el("div", dayKey(d) === today ? "today" : "", `${WD[(d.getDay() + 6) % 7]} ${d.getDate()}`);
      head.append(h);
    }
    grid.append(head);
  }
  const hours = el("div", "hours"); hours.style.height = `${height}px`;
  for (let h = h0 + 1; h < h1; h++) { const s = el("span", "", `${h}:00`); s.style.top = `${(h - h0) * HOUR}px`; hours.append(s); }
  grid.append(hours);

  for (const d of days) {
    const col = el("div", "daycol");
    col.style.height = `${height}px`;
    col.classList.toggle("is-today", dayKey(d) === today && mode === "week");
    const list = (byDay[dayKey(d)] || []).slice().sort((a, b) => new Date(a.start) - new Date(b.start));
    // Überschneidungen nebeneinander legen
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
      const top = ((p.s.getHours() + p.s.getMinutes() / 60) - h0) * HOUR;
      const dur = Math.max(22, ((p.en - p.s) / 3600000) * HOUR - 2);
      const b = el("button", "block");
      b.classList.toggle("cancelled", p.e.status === "cancelled");
      b.style.setProperty("--c", courseColor(p.e.course_id));
      b.style.top = `${top + 1}px`; b.style.height = `${dur}px`;
      b.style.left = `${(p.lane / n) * 100}%`; b.style.width = `calc(${100 / n}% - 3px)`;
      b.append(el("b", "", p.e.title));
      if (mode === "day") b.append(el("span", "", `${fmtTime.format(p.s)} – ${fmtTime.format(p.en)}${p.e.location ? " · " + p.e.location : ""}`));
      if (p.e.attendance) b.append(el("span", "must", "!"));
      b.addEventListener("click", () => openEvent(p.e));
      col.append(b);
    }
    if (dayKey(d) === today) {
      const now = new Date(), y = ((now.getHours() + now.getMinutes() / 60) - h0) * HOUR;
      if (y >= 0 && y <= height) { const line = el("div", "now-line"); line.style.top = `${y}px`; col.append(line); }
    }
    if (!list.length && mode === "day") {
      const empty = el("div", "grid-empty", "Keine Termine");
      col.append(empty);
    }
    grid.append(col);
  }
  return grid;
}

// ---------- Tab: Kurse (nach Semester filterbar) ----------
async function loadCourses() { state.coursesData = await api("/api/courses"); assignColors(state.coursesData.courses); return state.coursesData; }
async function renderCourses() {
  const box = $("#course-list");
  let data;
  try { data = await loadCourses(); } catch (err) { errorBox(box, err, "Kurse"); return; }
  const sems = data.semesters;
  if (!state.sem || (state.sem !== "all" && !sems.includes(state.sem))) state.sem = sems.includes(data.current) ? data.current : sems[0] || "all";
  const chips = ["all", ...sems].map((s) => {
    const c = el("button", `chip${s === state.sem ? " on" : ""}`, s === "all" ? "Alle" : s);
    c.addEventListener("click", () => { state.sem = s; haptic(); renderCourses(); });
    return c;
  });
  $("#sem-chips").replaceChildren(...(sems.length > 0 ? chips : []));
  const list = data.courses.filter((c) => state.sem === "all" || c.semesters.includes(state.sem));
  $("#courses-sub").textContent = `${list.length} ${list.length === 1 ? "Kurs" : "Kurse"}${state.sem !== "all" ? ` im ${state.sem}` : ""}`;
  box.replaceChildren(...list.map((c) => {
    const r = el("button", "row course-row");
    r.style.setProperty("--c", courseColor(c.course_id));
    const text = el("span", "course-text");
    const t = el("span", "course-title", c.title);
    if (c.kinds) t.append(el("span", "kind", c.kinds));
    const sub = [c.next_start ? `Nächster Termin ${inDays(new Date(c.next_start))}` : "Keine weiteren Termine", `${c.events} Termine`];
    text.append(t, el("span", "course-sub", sub.join(" · ")));
    r.append(el("span", "dot-c"), text);
    if (c.attendance) r.append(el("span", "must", "!"));
    r.append(chev());
    r.addEventListener("click", () => openCourse(c.course_id));
    return r;
  }));
  if (!list.length) box.append(el("div", "row empty-row", data.courses.length ? "Keine Kurse in diesem Semester." : "Noch keine Kurse. Verbinde deinen Stundenplan unter Einstellungen."));
}

async function openCourse(id) {
  const data = state.coursesData || await loadCourses().catch(() => null);
  const c = data?.courses.find((x) => x.course_id === id);
  if (!c) return;
  const info = el("div", "group");
  if (c.nr) info.append(row("LVA-Nummer", c.nr));
  if (c.kinds) info.append(row("Art", c.kinds));
  info.append(row("Semester", c.semesters.join(", ") || "–"), row("Termine", String(c.events)));
  if (c.first_start) info.append(row("Zeitraum", `${fmtDate.format(new Date(c.first_start))} – ${fmtDate.format(new Date(c.last_end))}`));

  const grade = matchGrade(c);
  if (grade) info.append(row("Note", grade.grade_text || String(grade.grade ?? "")));

  const att = el("div", "group");
  const r = el("label", "row");
  r.append(el("span", "", "Anwesenheitspflicht"), makeSwitch(c.attendance, async (v) => {
    await put(`/api/courses/${encodeURIComponent(c.course_id)}/attendance`, { attendance: v });
    c.attendance = v;
    if (state.tab === "courses") renderCourses(); else renderTab(state.tab);
  }));
  att.append(r);

  const upcoming = el("div", "group");
  upcoming.append(el("div", "row empty-row", "Lade Termine …"));
  openSheet(c.title, info, el("h3", "section-header", "Zusatzfunktion"), att,
    el("p", "footnote", "Gilt für alle Termine des Kurses. Einzelne Termine änderst du im Kalender."),
    el("h3", "section-header", "Nächste Termine"), upcoming);

  const from = new Date(), to = c.last_end ? new Date(c.last_end) : addDays(from, 120);
  try {
    const evs = to > from ? (await fetchEvents(from, to)).filter((e) => e.course_id === id).slice(0, 8) : [];
    upcoming.replaceChildren(...evs.map((e) => {
      const rr = row(inDays(new Date(e.start)), `${fmtTime.format(new Date(e.start))} · ${e.location || "Ort unbekannt"}`, "nowrap-label tap");
      rr.addEventListener("click", () => openEvent(e));
      if (e.status === "cancelled") rr.classList.add("cancelled");
      return rr;
    }));
    if (!evs.length) upcoming.append(el("div", "row empty-row", "Keine weiteren Termine."));
  } catch (err) { errorBox(upcoming, err); }
}

function normTitle(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9äöüß]/g, ""); }
function matchGrade(course) {
  const grades = state.gradesData?.grades || [];
  const nr = String(course.nr || "").replace(/\D/g, "");
  return grades.find((g) => nr && String(g.nr || "").replace(/\D/g, "") === nr)
    || grades.find((g) => normTitle(g.title) && normTitle(g.title) === normTitle(course.title));
}

// ---------- Tab: Studium (Noten, ECTS, Statistik) ----------
async function loadGrades() { state.gradesData = await api("/api/grades"); return state.gradesData; }

function studyNumbers(grades, target) {
  const passed = grades.filter((g) => g.passed !== false && g.grade !== 5);
  const ects = passed.reduce((s, g) => s + (+g.ects || 0), 0);
  const graded = passed.filter((g) => g.grade >= 1 && g.grade <= 4);
  const w = graded.reduce((s, g) => s + (+g.ects || 1), 0);
  const avg = w ? graded.reduce((s, g) => s + g.grade * (+g.ects || 1), 0) / w : null;
  const plain = graded.length ? graded.reduce((s, g) => s + g.grade, 0) / graded.length : null;
  return { passed, ects, avg, plain, target, graded };
}

async function renderStudy() {
  let data;
  try { data = await loadGrades(); } catch (err) { $("#study-error").hidden = false; $("#study-error").textContent = err.message; return; }
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
  const target = prog ? prog.ects_target : (programs.length === 1 ? programs[0].ects_target : programs.reduce((s, p) => s + (p.ects_target || 0), 0)) || 180;
  const n = studyNumbers(grades, target || 180);

  $("#study-sub").textContent = prog ? prog.name : programs.length === 1 ? programs[0].name : "Studienfortschritt";
  const err = data.error && !data.grades.length ? data.error : "";
  $("#study-error").hidden = !err; $("#study-error").textContent = err ? `Noten konnten nicht gelesen werden: ${err}` : "";

  // Fortschrittsring
  const pct = Math.min(1, n.ects / n.target);
  const C = 2 * Math.PI * 45;
  const ring = el("div", "ring");
  ring.append(svg(`<circle class="track" cx="56" cy="56" r="45"/><circle class="val" cx="56" cy="56" r="45" stroke-dasharray="${C}" stroke-dashoffset="${C}"/>`));
  ring.firstChild.setAttribute("viewBox", "0 0 112 112");
  const lbl = el("div", "ring-label"); lbl.textContent = `${Math.round(pct * 100)} %`; ring.append(lbl);
  requestAnimationFrame(() => requestAnimationFrame(() => { const v = $(".val", ring); if (v) v.style.strokeDashoffset = String(C * (1 - pct)); }));
  const txt = el("div", "progress-text");
  txt.append(el("strong", "", `${fmtNum.format(n.ects)} von ${n.target} ECTS`),
    el("span", "", n.ects >= n.target ? "Geschafft!" : `Noch ${fmtNum.format(Math.max(0, n.target - n.ects))} ECTS bis zum Abschluss`));
  $("#progress-card").replaceChildren(ring, txt);

  const sems = {};
  for (const g of n.passed) if (g.semester) sems[g.semester] = (sems[g.semester] || 0) + (+g.ects || 0);
  const semList = Object.entries(sems).sort((a, b) => semSort(a[0]) - semSort(b[0])).slice(-8);
  const perSem = semList.length ? n.ects / semList.length : 0;

  const stats = [
    [n.avg ? fmtAvg.format(n.avg) : "–", "Notenschnitt (ECTS-gewichtet)"],
    [String(n.passed.length), "Prüfungen bestanden"],
    [n.plain ? fmtAvg.format(n.plain) : "–", "Schnitt ungewichtet"],
    [perSem ? fmtNum.format(Math.round(perSem * 10) / 10) : "–", "ECTS pro Semester"],
  ];
  $("#study-stats").replaceChildren(...stats.map(([v, l]) => { const s = el("div", "stat"); s.append(el("div", "stat-value", v), el("div", "stat-label", l)); return s; }));

  // ECTS pro Semester
  const chart = $("#ects-chart");
  chart.style.setProperty("--n", Math.max(4, semList.length));
  const maxE = Math.max(30, ...semList.map(([, v]) => v));
  chart.replaceChildren(...semList.map(([s, v]) => {
    const col = el("div", "col");
    const b = el("div", "bar bar-a"); b.style.height = `${(v / maxE) * 100}%`;
    col.append(el("div", "val-lbl", fmtNum.format(v)), b, el("span", "lbl", s.replace(/^(WS|SS) (\d{2})(\d{2})(\/\d+)?$/, "$1 $3$4")));
    return col;
  }));
  if (!semList.length) chart.replaceChildren(el("div", "muted chart-empty", "Noch keine Daten"));

  // Notenverteilung
  const dist = [1, 2, 3, 4, 5].map((g) => grades.filter((x) => x.grade === g).length);
  const maxD = Math.max(1, ...dist);
  $("#grade-dist").replaceChildren(...dist.map((c, i) => {
    const col = el("div", `col g${i + 1}`);
    const b = el("div", "bar"); b.style.height = `${(c / maxD) * 75}%`;
    col.append(el("span", "", String(c)), b, el("strong", "", String(i + 1)));
    return col;
  }));

  $("#btn-grades-refresh").hidden = !data.auto || state.me.demo;
  $("#grades-synced").textContent = data.synced ? `Noten aus KUSSS zuletzt ${ago(data.synced)} geladen.` : data.auto ? "Noten werden beim Login aus der KUSSS-Notenauskunft übernommen." : "";

  // Notenliste nach Semester gruppiert
  const groups = {};
  for (const g of grades) (groups[g.semester || "Ohne Semester"] ??= []).push(g);
  const out = [];
  for (const [sem, list] of Object.entries(groups).sort((a, b) => semSort(b[0]) - semSort(a[0]))) {
    const ects = list.filter((g) => g.passed !== false).reduce((s, g) => s + (+g.ects || 0), 0);
    out.push(el("h2", "section-header", `${sem} · ${fmtNum.format(ects)} ECTS`));
    const box = el("div", "group");
    box.append(...list.map(gradeRow));
    out.push(box);
  }
  if (!grades.length) {
    out.push(el("h2", "section-header", "Noten"));
    const box = el("div", "group"); box.append(el("div", "row empty-row", "Noch keine Noten.")); out.push(box);
  }
  $("#grade-list").replaceChildren(...out);
}
function semSort(s) { const m = /(WS|SS) (\d{4})/.exec(s || ""); return m ? +m[2] * 2 + (m[1] === "WS" ? 1 : 0) : -1; }

function gradeRow(g) {
  const r = el("button", "row course-row");
  const pill = el("span", "grade-pill");
  if (g.grade) { pill.textContent = String(g.grade); pill.classList.add(`g${g.grade}`); }
  else if (g.passed === false) { pill.textContent = "✕"; pill.classList.add("fail"); }
  else { pill.textContent = "✓"; pill.classList.add("ok"); }
  const text = el("span", "course-text");
  const t = el("span", "course-title", g.title);
  if (g.kind) t.append(el("span", "kind", g.kind));
  const prog = state.gradesData.programs.find((p) => p.id === g.program_id);
  text.append(t, el("span", "course-sub", [g.date ? fmtDate.format(new Date(g.date)) : null, g.ects ? `${fmtNum.format(g.ects)} ECTS` : null, prog?.name].filter(Boolean).join(" · ") || "–"));
  r.append(pill, text, chev());
  r.addEventListener("click", () => openGrade(g));
  return r;
}

function openGrade(g) {
  const { programs } = state.gradesData;
  const info = el("div", "group");
  info.append(row("Note", g.grade_text || (g.grade ? String(g.grade) : "–")));
  if (g.date) info.append(row("Datum", fmtDate.format(new Date(g.date))));
  if (g.ects) info.append(row("ECTS", fmtNum.format(g.ects)));
  if (g.sws) info.append(row("SWS", fmtNum.format(g.sws)));
  if (g.kind) info.append(row("Art", g.kind));
  if (g.nr) info.append(row("LVA-Nummer", g.nr));
  if (g.semester) info.append(row("Semester", g.semester));
  info.append(row("Quelle", g.source === "manual" ? "Manuell eingetragen" : "KUSSS"));

  const prog = el("div", "group");
  const label = el("label", "row");
  const sel = el("select");
  sel.append(new Option("Keine", ""), ...programs.map((p) => new Option(p.name, String(p.id))));
  sel.value = g.program_id ? String(g.program_id) : "";
  sel.addEventListener("change", async () => {
    try { state.gradesData = await put(`/api/grades/${g.id}`, { program_id: sel.value ? +sel.value : null }); g.program_id = sel.value ? +sel.value : null; renderStudy(); }
    catch (err) { alert(err.message); }
  });
  label.append(el("span", "row-label", "Studienrichtung"), sel);
  prog.append(label);
  const parts = [info, el("h3", "section-header", "Zuordnung"), prog,
    el("p", "footnote", programs.length ? "Bestimmt, zu welchem Studium die ECTS zählen." : "Lege unter Einstellungen › Persönliche Daten deine Studienrichtungen an.")];
  if (g.source === "manual") {
    const del = el("button", "row row-btn danger", "Note löschen");
    del.addEventListener("click", async () => {
      if (!confirm(`„${g.title}“ löschen?`)) return;
      await api(`/api/grades/${g.id}`, { method: "DELETE" }); closeSheet(); renderStudy();
    });
    const box = el("div", "group group-spaced"); box.append(del); parts.push(box);
  }
  openSheet(g.title, ...parts);
}

function formSheet(title, fields, submitLabel, onSubmit, note) {
  const form = el("form", "group");
  for (const f of fields) {
    const l = el("label", "row");
    let input;
    if (f.options) { input = el("select"); input.append(...f.options.map(([v, t]) => new Option(t, v))); }
    else { input = el("input"); input.type = f.type || "text"; if (f.placeholder) input.placeholder = f.placeholder; if (f.inputmode) input.inputMode = f.inputmode; }
    input.name = f.name; if (f.required) input.required = true; if (f.value !== undefined) input.value = f.value;
    if (f.autocomplete) input.autocomplete = f.autocomplete;
    l.append(el("span", "row-label", f.label), input);
    form.append(l);
  }
  const btn = el("button", "row row-btn", submitLabel); btn.type = "submit";
  form.append(btn);
  const errP = el("p", "error");
  form.addEventListener("submit", async (e) => {
    e.preventDefault(); errP.textContent = ""; btn.disabled = true;
    const old = btn.textContent; btn.textContent = "Bitte warten …";
    try { await onSubmit(Object.fromEntries(new FormData(form))); closeSheet(); }
    catch (err) { errP.textContent = err.message; }
    finally { btn.disabled = false; btn.textContent = old; }
  });
  openSheet(title, form, errP, ...(note ? [el("p", "footnote", note)] : []));
  setTimeout(() => $("input", form)?.focus(), 350);
}

$("#btn-grade-add").addEventListener("click", () => {
  const programs = state.gradesData?.programs || [];
  formSheet("Note hinzufügen", [
    { name: "title", label: "Kurs", placeholder: "z. B. Analysis für Informatik", required: true },
    { name: "grade", label: "Note", options: [["1", "1 – Sehr gut"], ["2", "2 – Gut"], ["3", "3 – Befriedigend"], ["4", "4 – Genügend"], ["5", "5 – Nicht genügend"], ["ok", "Mit Erfolg teilgenommen"]] },
    { name: "ects", label: "ECTS", placeholder: "6", inputmode: "decimal" },
    { name: "kind", label: "Art", placeholder: "VL, UE, KV …" },
    { name: "date", label: "Datum", type: "date", value: new Date().toISOString().slice(0, 10) },
    ...(programs.length ? [{ name: "program_id", label: "Studium", options: [["", "Keine"], ...programs.map((p) => [String(p.id), p.name])], value: state.program !== "all" ? state.program : String(programs[0].id) }] : []),
  ], "Hinzufügen", async (v) => {
    state.gradesData = await post("/api/grades", {
      title: v.title, grade: v.grade === "ok" ? null : +v.grade, passed: true,
      ects: v.ects ? +String(v.ects).replace(",", ".") : null, kind: v.kind || null, date: v.date || null,
      program_id: v.program_id ? +v.program_id : null,
    });
    renderStudy();
  });
});

$("#btn-grades-refresh").addEventListener("click", () => {
  formSheet("Noten aus KUSSS", [
    { name: "password", label: "JKU-Passwort", type: "password", required: true, autocomplete: "current-password", placeholder: "Passwort" },
  ], "Noten laden", async (v) => {
    state.gradesData = await post("/api/grades/refresh", { password: v.password });
    renderStudy();
  }, "Studo+ meldet sich einmal bei KUSSS an und liest die Notenauskunft. Das Passwort wird nicht gespeichert.");
});

// ---------- Tab: Einstellungen ----------
function displayName(me) { return me.name || (me.uni.id === "jku" ? `Matrikelnr. ${me.matrikel}` : me.username); }

function renderSettings() {
  const me = state.me;
  setAvatar($("#set-avatar"), me.name);
  $("#set-name").textContent = displayName(me) + (me.demo ? " (Demo)" : "");
  $("#set-sub").textContent = [me.name && me.matrikel ? me.matrikel : null, me.uni.name].filter(Boolean).join(" · ");
  $("#set-status").textContent = me.connected ? (me.ical_source === "auto" ? "Automatisch verbunden" : "Verbunden") : "Nicht verbunden";
  $("#set-sync").textContent = me.last_sync ? ago(me.last_sync) : "noch nie";
  $("#sync-error").textContent = me.last_sync_error || "";
  $("#jku-connect").hidden = !me.uni.auto || me.demo;
  $("#ical-hint").textContent = `${me.uni.ical_hint} Der Link bleibt auf dem Server und wird nur für deinen Stundenplan verwendet.`;
  $$("input[name=marker]").forEach((r) => (r.checked = r.value === me.marker_style));
}

$$("input[name=marker]").forEach((r) => r.addEventListener("change", async () => {
  await put("/api/settings", { marker_style: r.value });
  state.me.marker_style = r.value; haptic();
}));

$("#ical-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("button", e.target);
  btn.textContent = "Wird geprüft …";
  try {
    await put("/api/settings", { ical_url: new FormData(e.target).get("ical_url") });
    e.target.reset(); $("#sync-error").textContent = "";
    await loadMe(); renderSettings();
  } catch (err) { $("#sync-error").textContent = err.message; }
  btn.textContent = "Link speichern";
});

$("#jku-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("button", e.target);
  btn.textContent = "Verbinde mit KUSSS …"; btn.disabled = true;
  try {
    await post("/api/jku/connect", { password: new FormData(e.target).get("password") });
    e.target.reset(); $("#sync-error").textContent = "";
    await loadMe(); renderSettings();
  } catch (err) { $("#sync-error").textContent = err.message; }
  btn.textContent = "Kalender und Noten von KUSSS holen"; btn.disabled = false;
});

$("#btn-sync").addEventListener("click", async () => {
  $("#btn-sync").textContent = "Synchronisiere …";
  try { await post("/api/sync"); $("#sync-error").textContent = ""; }
  catch (err) { $("#sync-error").textContent = err.message; }
  $("#btn-sync").textContent = "Jetzt synchronisieren";
  await loadMe(); renderSettings();
});
$("#btn-logout").addEventListener("click", async () => { await post("/api/logout").catch(() => {}); showLogin(); });
$("#btn-delete").addEventListener("click", async () => {
  if (!confirm("Konto mit allen Schaltern, Terminen und Noten endgültig löschen? Der Kalender-Abo-Link hört auf zu funktionieren.")) return;
  await api("/api/account", { method: "DELETE" }); showLogin();
});
$("#btn-copy-feed").addEventListener("click", async () => {
  await navigator.clipboard.writeText(state.me.feed.https);
  $("#btn-copy-feed").textContent = "Kopiert ✓"; haptic();
  setTimeout(() => ($("#btn-copy-feed").textContent = "Abo-Link kopieren"), 1500);
});
$("#btn-rotate-feed").addEventListener("click", async () => {
  if (!confirm("Neuen Abo-Link erzeugen? Bestehende Kalender-Abos hören auf zu aktualisieren.")) return;
  state.me.feed = await post("/api/feed/rotate");
  $("#subscribe").href = state.me.feed.webcal;
});

// ---------- Unterseite: Persönliche Daten + Studienrichtungen ----------
async function renderProfile() {
  const me = state.me, f = $("#profile-form");
  f.elements.name.value = me.name || "";
  f.elements.matrikel.value = me.matrikel || "";
  $("#profile-uni").textContent = me.uni.name;
  $("#profile-hint").hidden = !me.uni.auto;
  let data;
  try { data = await loadGrades(); } catch (err) { errorBox($("#program-list"), err, "Studienrichtungen"); return; }
  renderPrograms(data.programs);
}
function renderPrograms(programs) {
  const box = $("#program-list");
  box.replaceChildren(...programs.map((p) => {
    const r = el("button", "row course-row");
    const text = el("span", "course-text");
    text.append(el("span", "course-title", p.name), el("span", "course-sub", [p.code, p.ects_target ? `${p.ects_target} ECTS` : null, p.source === "kusss" ? "aus KUSSS" : null].filter(Boolean).join(" · ") || "–"));
    r.append(text, chev());
    r.addEventListener("click", () => openProgram(p));
    return r;
  }));
  if (!programs.length) box.append(el("div", "row empty-row", "Noch keine Studienrichtung."));
}
function openProgram(p) {
  formSheet(p.name, [
    { name: "name", label: "Studium", value: p.name, required: true },
    { name: "code", label: "Kennzahl", value: p.code || "" },
    { name: "ects_target", label: "ECTS-Ziel", value: p.ects_target || "", inputmode: "numeric" },
  ], "Speichern", async (v) => {
    const d = await put(`/api/programs/${p.id}`, { name: v.name, code: v.code || null, ects_target: +v.ects_target || null });
    state.gradesData = d; renderPrograms(d.programs);
  });
  const del = el("button", "row row-btn danger", "Studienrichtung entfernen");
  del.addEventListener("click", async () => {
    if (!confirm(`„${p.name}“ entfernen? Die Noten bleiben erhalten.`)) return;
    const d = await api(`/api/programs/${p.id}`, { method: "DELETE" });
    state.gradesData = d; renderPrograms(d.programs); closeSheet();
  });
  const box = el("div", "group group-spaced"); box.append(del);
  $("#sheet-body").append(box);
}

$("#profile-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const v = Object.fromEntries(new FormData(e.target));
  const btn = $("button[type=submit]", e.target);
  try {
    state.me = { ...state.me, ...(await put("/api/profile", { name: v.name, matrikel: v.matrikel })) };
    setAvatar($("#avatar"), state.me.name); haptic();
    btn.textContent = "Gespeichert ✓"; setTimeout(() => (btn.textContent = "Speichern"), 1500);
  } catch (err) { alert(err.message); }
});
$("#program-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const v = Object.fromEntries(new FormData(e.target));
  try {
    const d = await post("/api/programs", { name: v.name, code: v.code || null, ects_target: +v.ects_target || null });
    state.gradesData = d; renderPrograms(d.programs); e.target.reset(); haptic();
  } catch (err) { alert(err.message); }
});

// ---------- Start ----------
async function loadMe() {
  state.me = await api("/api/me");
  setAvatar($("#avatar"), state.me.name);
  // webcal:// öffnet auf iOS direkt den Dialog "Kalenderabonnement hinzufügen"
  $("#subscribe").href = state.me.feed.webcal;
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
  loadGrades().catch(() => {}); // für Noten in den Kursdetails
  await loadCourses().catch(() => {}); // Kursfarben
  renderLinks();
  switchTab("today");
  endSplash();
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.me && !$("#app").hidden && $("#sheet").hidden) renderTab(state.tab);
});
boot();
