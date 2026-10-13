// Studo+ Frontend – bewusst ohne Framework: ein Nutzer, drei Tabs, wenig Zustand.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const state = { me: null, weekStart: startOfWeek(new Date()), selDay: dayKey(new Date()) };
const WD = ["M", "D", "M", "D", "F", "S", "S"];
const fmtTime = new Intl.DateTimeFormat("de-AT", { hour: "2-digit", minute: "2-digit" });
const fmtDay = new Intl.DateTimeFormat("de-AT", { weekday: "long", day: "numeric", month: "long" });
const fmtWeek = new Intl.DateTimeFormat("de-AT", { day: "numeric", month: "short" });

if (!("switch" in HTMLInputElement.prototype)) document.documentElement.classList.add("no-native-switch");
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");

// ---------- API ----------
async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    credentials: "same-origin",
  });
  if (res.status === 401 && path !== "/api/login") { showLogin(); throw new Error("Nicht angemeldet"); }
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) throw new Error(data?.detail || `Fehler ${res.status}`);
  return data;
}

// ---------- Datum ----------
function startOfWeek(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function dayKey(d) { return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }

// ---------- Haptik ----------
// iOS: Der native <input switch> (Safari 17.4+/iOS 18) gibt selbst ein Taptic-Feedback.
// Eine JS-API für die Taptic Engine gibt es in Safari nicht; Android nutzt vibrate().
function haptic() { if (navigator.vibrate) navigator.vibrate(8); }

// ---------- Login ----------
function showLogin() { $("#app").hidden = true; $("#login").hidden = false; }

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const btn = $("button[form=login-form]");
  btn.disabled = true; $("#login-error").textContent = "";
  try {
    await api("/api/login", { method: "POST", body: JSON.stringify({
      username: f.get("username"), password: f.get("password"),
    }) });
    e.target.reset();
    await boot();
  } catch (err) { $("#login-error").textContent = err.message; }
  finally { btn.disabled = false; }
});

// ---------- Tabs ----------
$$(".tabbar button").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));
function switchTab(name) {
  $$(".tabbar button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  $$(".tab").forEach((t) => (t.hidden = t.id !== `tab-${name}`));
  if (name === "today") renderToday();
  if (name === "calendar") renderWeek();
  if (name === "settings") renderSettings();
}

// ---------- Event-Karte ----------
function eventCard(ev) {
  const node = $("#event-tpl").content.firstElementChild.cloneNode(true);
  const s = new Date(ev.start), e = new Date(ev.end);
  node.classList.toggle("cancelled", ev.status === "cancelled");
  $(".card-time", node).textContent = `${fmtTime.format(s)} – ${fmtTime.format(e)}` + (ev.status === "cancelled" ? " · Entfällt" : "");
  const title = $(".card-title", node);
  title.textContent = ev.title;
  if (ev.kind) { const k = document.createElement("span"); k.className = "kind"; k.textContent = ev.kind; title.append(k); }
  $(".card-loc", node).textContent = ev.location || "Ort unbekannt";

  // Hauptschalter = Standard für den ganzen Kurs
  const sw = $(".card-toggle input", node);
  sw.checked = ev.attendance;
  sw.addEventListener("change", async () => {
    haptic();
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

async function fetchEvents(from, to) {
  return api(`/api/events?start=${encodeURIComponent(from.toISOString())}&end=${encodeURIComponent(to.toISOString())}`);
}

function refreshCurrent() {
  const active = $(".tabbar button.active")?.dataset.tab;
  if (active === "today") renderToday(); else if (active === "calendar") renderWeek();
}

// ---------- Tab: Heute ----------
async function renderToday() {
  const now = new Date();
  const list = $("#today-list");
  const events = await fetchEvents(now, addDays(startOfWeek(now), 14));
  const todays = events.filter((e) => dayKey(new Date(e.start)) === dayKey(now));
  list.replaceChildren();
  if (todays.length) {
    todays.forEach((e) => list.append(eventCard(e)));
  } else {
    const p = document.createElement("p"); p.className = "empty";
    p.textContent = "Heute stehen keine Termine mehr an.";
    list.append(p);
    if (events.length) {   // nächster Tag mit Terminen
      const nextKey = dayKey(new Date(events[0].start));
      const h = document.createElement("div"); h.className = "day-head";
      h.textContent = fmtDay.format(new Date(events[0].start));
      list.append(h);
      events.filter((e) => dayKey(new Date(e.start)) === nextKey).forEach((e) => list.append(eventCard(e)));
    }
  }
}

const ICONS = {
  grid: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 21H20"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m3.5 7 8.5 6 8.5-6"/>',
};
function renderLinks() {
  const box = $("#quick-links"); box.replaceChildren();
  for (const l of state.me.links) {
    const a = document.createElement("a");
    a.className = "link"; a.href = l.url; a.target = "_blank"; a.rel = "noopener";
    a.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[l.icon] || ICONS.grid}</svg>`;
    a.append(l.name);
    box.append(a);
  }
}

// ---------- Tab: Kalender ----------
$("#week-prev").addEventListener("click", () => { state.weekStart = addDays(state.weekStart, -7); state.selDay = dayKey(state.weekStart); renderWeek(); });
$("#week-next").addEventListener("click", () => { state.weekStart = addDays(state.weekStart, 7); state.selDay = dayKey(state.weekStart); renderWeek(); });

async function renderWeek() {
  const start = state.weekStart, end = addDays(start, 7);
  $("#week-label").textContent = `${fmtWeek.format(start)} – ${fmtWeek.format(addDays(start, 6))}`;
  const events = await fetchEvents(start, end);
  const byDay = Object.groupBy ? Object.groupBy(events, (e) => dayKey(new Date(e.start)))
    : events.reduce((m, e) => ((m[dayKey(new Date(e.start))] ??= []).push(e), m), {});

  const strip = $("#week-strip"); strip.replaceChildren();
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i), k = dayKey(d);
    const b = document.createElement("button");
    b.classList.toggle("today", k === dayKey(new Date()));
    b.classList.toggle("sel", k === state.selDay);
    b.classList.toggle("has", !!byDay[k]);
    b.innerHTML = `<span>${WD[i]}</span><span class="num">${d.getDate()}</span>`;
    b.addEventListener("click", () => { state.selDay = k; state.scrollToSel = true; renderWeek(); });
    strip.append(b);
  }

  // Chronologische Liste: ausgewählter Tag zuerst hervorgehoben, darunter die restliche Woche
  const list = $("#calendar-list"); list.replaceChildren();
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i), k = dayKey(d);
    if (!byDay[k]) continue;
    const h = document.createElement("div"); h.className = "day-head"; h.textContent = fmtDay.format(d);
    list.append(h);
    byDay[k].forEach((e) => list.append(eventCard(e)));
    if (k === state.selDay && state.scrollToSel) requestAnimationFrame(() => h.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
  state.scrollToSel = false;
  if (!events.length) { const p = document.createElement("p"); p.className = "empty"; p.textContent = "Keine Termine in dieser Woche."; list.append(p); }
}

// ---------- Tab: Einstellungen ----------
function renderSettings() {
  const me = state.me;
  $("#set-user").textContent = me.username + (me.demo ? " (Demo)" : "");
  $("#set-sync").textContent = me.last_sync ? new Date(me.last_sync).toLocaleString("de-AT") : "noch nie";
  $("#sync-error").textContent = me.last_sync_error || "";
  $$("input[name=marker]").forEach((r) => (r.checked = r.value === me.marker_style));
}

$$("input[name=marker]").forEach((r) => r.addEventListener("change", async () => {
  await api("/api/settings", { method: "PUT", body: JSON.stringify({ marker_style: r.value }) });
  state.me.marker_style = r.value; haptic();
}));

$("#ical-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/api/settings", { method: "PUT", body: JSON.stringify({ ical_url: new FormData(e.target).get("ical_url") }) });
    e.target.reset(); await loadMe(); renderSettings();
  } catch (err) { $("#sync-error").textContent = err.message; }
});

$("#btn-sync").addEventListener("click", async () => {
  $("#btn-sync").textContent = "Synchronisiere …";
  try { await api("/api/sync", { method: "POST" }); $("#sync-error").textContent = ""; }
  catch (err) { $("#sync-error").textContent = err.message; }
  $("#btn-sync").textContent = "Jetzt synchronisieren";
  await loadMe(); renderSettings();
});
$("#btn-logout").addEventListener("click", async () => { await api("/api/logout", { method: "POST" }); showLogin(); });
$("#btn-disconnect").addEventListener("click", async () => {
  if (!confirm("Alle gespeicherten JKU-Daten löschen und abmelden? Der Kalender-Abo-Link wird ungültig.")) return;
  await api("/api/disconnect", { method: "POST" }); showLogin();
});
$("#btn-copy-feed").addEventListener("click", async () => {
  await navigator.clipboard.writeText(state.me.feed.https);
  $("#btn-copy-feed").textContent = "Kopiert ✓";
  setTimeout(() => ($("#btn-copy-feed").textContent = "Abo-Link kopieren"), 1500);
});
$("#btn-rotate-feed").addEventListener("click", async () => {
  if (!confirm("Neuen Abo-Link erzeugen? Bestehende Kalender-Abos hören auf zu aktualisieren.")) return;
  state.me.feed = await api("/api/feed/rotate", { method: "POST" });
  $("#subscribe").href = state.me.feed.webcal;
});

// ---------- Start ----------
async function loadMe() {
  state.me = await api("/api/me");
  $("#me-name").textContent = state.me.username;
  $("#me-status").textContent = `JKU Linz • ${state.me.connected ? "Verbunden" : "Nicht verbunden"}`;
  // webcal:// öffnet auf iOS direkt den Dialog "Kalenderabonnement hinzufügen"
  $("#subscribe").href = state.me.feed.webcal;
}

async function boot() {
  try { await loadMe(); } catch { return; }
  $("#login").hidden = true; $("#app").hidden = false;
  renderLinks();
  switchTab("today");
}

document.addEventListener("visibilitychange", () => { if (!document.hidden && state.me) refreshCurrent(); });
boot();
