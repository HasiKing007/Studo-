// Studo+ Frontend – bewusst ohne Framework: drei Tabs (+ Admin), wenig Zustand.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const state = { me: null, unis: [], weekStart: startOfWeek(new Date()), selDay: dayKey(new Date()) };
const WD = ["M", "D", "M", "D", "F", "S", "S"];
const fmtTime = new Intl.DateTimeFormat("de-AT", { hour: "2-digit", minute: "2-digit" });
const fmtDay = new Intl.DateTimeFormat("de-AT", { weekday: "long", day: "numeric", month: "long" });
const fmtWeek = new Intl.DateTimeFormat("de-AT", { day: "numeric", month: "short" });
const fmtShort = new Intl.DateTimeFormat("de-AT", { day: "numeric", month: "numeric" });

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
async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    credentials: "same-origin",
  });
  if (res.status === 401 && path !== "/api/login" && path !== "/api/jku/connect") { showLogin(); throw new Error("Nicht angemeldet"); }
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) throw new Error(data?.detail || `Fehler ${res.status}`);
  return data;
}

// ---------- Datum ----------
function startOfWeek(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
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

// ---------- Haptik ----------
// iOS: Der native <input switch> (Safari 17.4+/iOS 18) gibt selbst ein Taptic-Feedback.
// Eine JS-API für die Taptic Engine gibt es in Safari nicht; Android nutzt vibrate().
function haptic() { if (navigator.vibrate) navigator.vibrate(8); }

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function initials(name) { return ((name || "?").match(/[a-z]/i)?.[0] || "?").toUpperCase(); }

// ---------- Login ----------
function showLogin() {
  $("#app").hidden = true; $("#login").hidden = false;
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
  $("#login-hint").textContent = u.auto
    ? `Mit deinem ${u.name}-Account anmelden. Studo+ holt deinen Stundenplan automatisch aus KUSSS. ` +
      "Dein Passwort wird nur für die Anmeldung an die Uni weitergegeben und nie im Klartext gespeichert."
    : `Für ${u.name} gibt es noch keinen automatischen Login. Beim ersten Mal legst du hier ein eigenes ` +
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
    await api("/api/login", { method: "POST", body: JSON.stringify({
      uni: f.get("uni"), username: f.get("username"), password: f.get("password"),
    }) });
    try { localStorage.setItem("studo_uni", f.get("uni")); } catch {}
    e.target.reset();
    await boot();
  } catch (err) { $("#login-error").textContent = err.message; }
  finally { btn.disabled = false; $(".spinner", btn).hidden = true; $(".label", btn).textContent = "Anmelden"; }
});

// ---------- Tabs ----------
$$(".tabbar button").forEach((b) => b.addEventListener("click", () => { haptic(); switchTab(b.dataset.tab); }));
$("#avatar").addEventListener("click", () => switchTab("settings"));
function switchTab(name) {
  const navName = name === "admin" ? "settings" : name;
  $$(".tabbar button").forEach((b) => b.classList.toggle("active", b.dataset.tab === navName));
  $$(".tab").forEach((t) => (t.hidden = t.id !== `tab-${name}`));
  window.scrollTo({ top: 0 });
  if (name === "today") renderToday();
  if (name === "calendar") { renderWeek(); renderCourses(); }
  if (name === "settings") renderSettings();
  if (name === "admin") renderAdmin();
}
addEventListener("scroll", () => $(".appbar").classList.toggle("scrolled", scrollY > 4), { passive: true });

// ---------- Event-Karte ----------
function eventCard(ev) {
  const node = $("#event-tpl").content.firstElementChild.cloneNode(true);
  const s = new Date(ev.start), e = new Date(ev.end);
  node.classList.toggle("cancelled", ev.status === "cancelled");
  node.classList.toggle("mandatory", ev.attendance);
  $(".card-time", node).textContent = `${fmtTime.format(s)} – ${fmtTime.format(e)}` + (ev.status === "cancelled" ? " · Entfällt" : "");
  const title = $(".card-title", node);
  title.textContent = ev.title;
  if (ev.kind) title.append(el("span", "kind", ev.kind));
  $(".card-loc", node).textContent = ev.location || "Ort unbekannt";

  // Hauptschalter = Standard für den ganzen Kurs
  const sw = $(".card-toggle input", node);
  sw.checked = ev.attendance;
  sw.addEventListener("change", async () => {
    haptic();
    node.classList.toggle("mandatory", sw.checked);
    try {
      if (ev.is_override) {   // Einzeltermin hat eine Ausnahme -> diese ändern
        await api(`/api/events/${encodeURIComponent(ev.uid)}/attendance`, { method: "PUT", body: JSON.stringify({ attendance: sw.checked }) });
      } else {
        await api(`/api/courses/${encodeURIComponent(ev.course_id)}/attendance`, { method: "PUT", body: JSON.stringify({ attendance: sw.checked }) });
      }
      refreshCurrent();
    } catch (err) { sw.checked = !sw.checked; alert(err.message); }
  });

  // Antippen der Karte -> Ausnahme nur für diesen Termin
  const detail = $(".card-detail", node);
  const current = ev.is_override ? (ev.attendance ? "1" : "0") : "inherit";
  $$(".segmented button", node).forEach((b) => {
    b.classList.toggle("on", b.dataset.v === current);
    b.addEventListener("click", async () => {
      const v = b.dataset.v === "inherit" ? null : b.dataset.v === "1";
      await api(`/api/events/${encodeURIComponent(ev.uid)}/attendance`, { method: "PUT", body: JSON.stringify({ attendance: v }) });
      haptic(); refreshCurrent();
    });
  });
  $(".card-main", node).addEventListener("click", () => (detail.hidden = !detail.hidden));
  return node;
}

// Fehler beim Laden sichtbar machen statt eine leere Seite zu zeigen
function showLoadError(box, err) {
  box.replaceChildren(el("p", "empty error-box", `Termine konnten nicht geladen werden: ${err.message}`));
}

async function fetchEvents(from, to) {
  return api(`/api/events?start=${encodeURIComponent(from.toISOString())}&end=${encodeURIComponent(to.toISOString())}`);
}

function refreshCurrent() {
  const active = $$(".tab").find((t) => !t.hidden)?.id;
  if (active === "tab-today") renderToday();
  else if (active === "tab-calendar") { renderWeek(); renderCourses(); }
}

// ---------- Tab: Heute ----------
async function renderToday() {
  const now = new Date();
  $("#today-date").textContent = fmtDay.format(now);
  const notice = state.me.notice || state.me.last_sync_error || (!state.me.connected ? "Noch kein Stundenplan verbunden. Tippe auf Einstellungen, um ihn einzurichten." : "");
  $("#notice").hidden = !notice; $("#notice").textContent = notice;

  const list = $("#today-list");
  let events;
  try { events = await fetchEvents(now, addDays(startOfWeek(now), 14)); } catch (err) { showLoadError(list, err); return; }
  const todays = events.filter((e) => dayKey(new Date(e.start)) === dayKey(now));
  list.replaceChildren();
  if (todays.length) {
    todays.forEach((e) => list.append(eventCard(e)));
  } else {
    list.append(el("p", "empty", "Heute stehen keine Termine mehr an."));
    if (events.length) {   // nächster Tag mit Terminen
      const nextKey = dayKey(new Date(events[0].start));
      list.append(el("div", "day-head", `Als Nächstes · ${fmtDay.format(new Date(events[0].start))}`));
      events.filter((e) => dayKey(new Date(e.start)) === nextKey).forEach((e) => list.append(eventCard(e)));
    }
  }
}

const ICONS = {
  grid: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 21H20"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m3.5 7 8.5 6 8.5-6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
};
function renderLinks() {
  const box = $("#quick-links"); box.replaceChildren();
  $("#quick-links").previousElementSibling.hidden = !state.me.links.length;
  for (const l of state.me.links) {
    const a = el("a", "link");
    a.href = l.url; a.target = "_blank"; a.rel = "noopener";
    const ico = el("span", "ico");
    ico.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[l.icon] || ICONS.grid}</svg>`;
    a.append(ico, l.name);
    box.append(a);
  }
}

// ---------- Tab: Kalender ----------
$("#week-prev").addEventListener("click", () => { state.weekStart = addDays(state.weekStart, -7); state.selDay = dayKey(state.weekStart); haptic(); renderWeek(); });
$("#week-next").addEventListener("click", () => { state.weekStart = addDays(state.weekStart, 7); state.selDay = dayKey(state.weekStart); haptic(); renderWeek(); });

async function renderWeek() {
  const start = state.weekStart, end = addDays(start, 7);
  $("#week-label").textContent = `${fmtWeek.format(start)} – ${fmtWeek.format(addDays(start, 6))}`;
  let events;
  try { events = await fetchEvents(start, end); } catch (err) { showLoadError($("#calendar-list"), err); return; }
  const byDay = events.reduce((m, e) => ((m[dayKey(new Date(e.start))] ??= []).push(e), m), {});

  const strip = $("#week-strip"); strip.replaceChildren();
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i), k = dayKey(d);
    const b = el("button");
    b.classList.toggle("today", k === dayKey(new Date()));
    b.classList.toggle("sel", k === state.selDay);
    b.classList.toggle("has", !!byDay[k]);
    b.append(el("span", "", WD[i]), el("span", "num", String(d.getDate())));
    b.addEventListener("click", () => { state.selDay = k; state.scrollToSel = true; haptic(); renderWeek(); });
    strip.append(b);
  }

  const list = $("#calendar-list"); list.replaceChildren();
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i), k = dayKey(d);
    if (!byDay[k]) continue;
    const h = el("div", "day-head", fmtDay.format(d));
    list.append(h);
    byDay[k].forEach((e) => list.append(eventCard(e)));
    if (k === state.selDay && state.scrollToSel) requestAnimationFrame(() => h.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
  state.scrollToSel = false;
  if (!events.length) list.append(el("p", "empty", "Keine Termine in dieser Woche."));
}

async function renderCourses() {
  const box = $("#course-list");
  let courses;
  try { courses = await api("/api/courses"); } catch (err) { box.replaceChildren(el("div", "row error", err.message)); return; }
  box.replaceChildren();
  if (!courses.length) { box.append(el("div", "row muted", "Noch keine Kurse.")); return; }
  for (const c of courses) {
    const row = el("label", "row course-row");
    const text = el("span", "course-text");
    text.append(el("span", "", c.title), el("span", "", [c.kinds, `${c.events} Termine`].filter(Boolean).join(" · ")));
    const sw = el("input", "switch");
    sw.type = "checkbox"; sw.setAttribute("switch", ""); sw.checked = c.attendance;
    sw.addEventListener("change", async () => {
      haptic();
      try {
        await api(`/api/courses/${encodeURIComponent(c.course_id)}/attendance`, { method: "PUT", body: JSON.stringify({ attendance: sw.checked }) });
        renderWeek();
      } catch (err) { sw.checked = !sw.checked; alert(err.message); }
    });
    row.append(text, sw);
    box.append(row);
  }
}

// ---------- Tab: Einstellungen ----------
function renderSettings() {
  const me = state.me;
  $("#set-avatar").textContent = initials(me.username);
  $("#set-user").textContent = me.username + (me.demo ? " (Demo)" : "");
  $("#set-uni").textContent = me.uni.name + (me.verified ? " · bestätigt" : "");
  $("#set-status").textContent = me.connected ? (me.ical_source === "auto" ? "Automatisch verbunden" : "Verbunden") : "Nicht verbunden";
  $("#set-sync").textContent = me.last_sync ? ago(me.last_sync) : "noch nie";
  $("#sync-error").textContent = me.last_sync_error || "";
  $("#jku-connect").hidden = !me.uni.auto || me.demo;
  $("#ical-hint").textContent = `${me.uni.ical_hint} Der Link bleibt auf dem Server und wird nur für deinen Stundenplan verwendet.`;
  $$("input[name=marker]").forEach((r) => (r.checked = r.value === me.marker_style));
  $("#admin-entry").hidden = !me.admin;
}

$$("input[name=marker]").forEach((r) => r.addEventListener("change", async () => {
  await api("/api/settings", { method: "PUT", body: JSON.stringify({ marker_style: r.value }) });
  state.me.marker_style = r.value; haptic();
}));

$("#ical-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("button", e.target);
  btn.textContent = "Wird geprüft …";
  try {
    await api("/api/settings", { method: "PUT", body: JSON.stringify({ ical_url: new FormData(e.target).get("ical_url") }) });
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
    await api("/api/jku/connect", { method: "POST", body: JSON.stringify({ password: new FormData(e.target).get("password") }) });
    e.target.reset(); $("#sync-error").textContent = "";
    await loadMe(); renderSettings();
  } catch (err) { $("#sync-error").textContent = err.message; }
  btn.textContent = "Kalender-Link von KUSSS holen"; btn.disabled = false;
});

$("#btn-sync").addEventListener("click", async () => {
  $("#btn-sync").textContent = "Synchronisiere …";
  try { await api("/api/sync", { method: "POST" }); $("#sync-error").textContent = ""; }
  catch (err) { $("#sync-error").textContent = err.message; }
  $("#btn-sync").textContent = "Jetzt synchronisieren";
  await loadMe(); renderSettings();
});
$("#btn-logout").addEventListener("click", async () => { await api("/api/logout", { method: "POST" }).catch(() => {}); showLogin(); });
$("#btn-delete").addEventListener("click", async () => {
  if (!confirm("Konto mit allen Schaltern und Terminen endgültig löschen? Der Kalender-Abo-Link hört auf zu funktionieren.")) return;
  await api("/api/account", { method: "DELETE" }); showLogin();
});
$("#btn-copy-feed").addEventListener("click", async () => {
  await navigator.clipboard.writeText(state.me.feed.https);
  $("#btn-copy-feed").textContent = "Kopiert ✓"; haptic();
  setTimeout(() => ($("#btn-copy-feed").textContent = "Abo-Link kopieren"), 1500);
});
$("#btn-rotate-feed").addEventListener("click", async () => {
  if (!confirm("Neuen Abo-Link erzeugen? Bestehende Kalender-Abos hören auf zu aktualisieren.")) return;
  state.me.feed = await api("/api/feed/rotate", { method: "POST" });
  $("#subscribe").href = state.me.feed.webcal;
});
$("#btn-admin").addEventListener("click", () => switchTab("admin"));
$("#admin-back").addEventListener("click", () => switchTab("settings"));

// ---------- Admin ----------
async function renderAdmin() {
  const data = await api("/api/admin/overview");
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

  const names = Object.fromEntries((state.unis.length ? state.unis : await api("/api/unis")).map((u) => [u.id, u.name]));
  const unis = Object.entries(data.by_uni).sort((a, b) => b[1] - a[1]);
  $("#admin-unis").replaceChildren(...(unis.length ? unis : [["–", 0]]).map(([id, n]) => {
    const r = el("div", "row"); r.append(el("span", "", names[id] || id), el("span", "muted", String(n))); return r;
  }));

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

// ---------- Start ----------
async function loadMe() {
  state.me = await api("/api/me");
  $("#avatar").textContent = initials(state.me.username);
  // webcal:// öffnet auf iOS direkt den Dialog "Kalenderabonnement hinzufügen"
  $("#subscribe").href = state.me.feed.webcal;
}

async function boot() {
  try { await loadMe(); } catch { endSplash(); return; }
  $("#login").hidden = true; $("#app").hidden = false;
  if (!state.unis.length) api("/api/unis").then((u) => (state.unis = u)).catch(() => {});
  renderLinks();
  switchTab("today");
  endSplash();
}

document.addEventListener("visibilitychange", () => { if (!document.hidden && state.me && !$("#app").hidden) refreshCurrent(); });
boot();
