// Einstiegspunkt des Workers. Jedes Konto hat sein eigenes Durable Object (StudoStore),
// gefunden über den Namen "<uni>:<benutzer>" beim Login und danach über die ID im
// Session-Cookie bzw. im Abo-Link. Die Registry führt Nutzungszahlen und das Rate-Limit.
// Alles andere sind die statischen PWA-Dateien aus ../frontend.

import { SESSION_DAYS } from "./store.js";
import { UNIS, USER_RE, normalizeUser, publicUnis } from "./unis.js";
import { error, getCookie, json, parseSession, randomToken, sessionCookie, sha256, timingSafeEqual } from "./util.js";

export { StudoStore } from "./store.js";
export { Registry } from "./registry.js";

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Strict-Transport-Security": "max-age=31536000",
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; " +
    "connect-src 'self'; frame-ancestors 'none'",
};

const registry = (env) => env.REGISTRY.get(env.REGISTRY.idFromName("global"));

function storeById(env, hexId) {
  try { return env.STORE.get(env.STORE.idFromString(hexId)); } catch { return null; }
}

async function login(request, env) {
  const body = await request.json().catch(() => ({}));
  const uni = String(body.uni || "jku");
  const username = normalizeUser(body.username, uni);
  const password = String(body.password || "");
  if (!UNIS[uni]) return error(422, "Unbekannte Hochschule.");
  if (!USER_RE.test(username) || !password) return error(422, "Benutzername und Passwort angeben.");
  if (password.length > 256) return error(422, "Passwort zu lang.");

  const ip = request.headers.get("CF-Connecting-IP") || "?";
  const reg = registry(env);
  if (await reg.isBlocked(ip)) return error(429, "Zu viele Fehlversuche. Bitte in 15 Minuten erneut probieren.");

  const id = env.STORE.idFromName(`${uni}:${username}`);
  const result = await env.STORE.get(id).login({ uni, username, password });
  if (!result.ok) {
    if (result.status === 401) await reg.recordFailure(ip);
    return error(result.status, result.detail);
  }
  return json({ ok: true, first_login: result.firstLogin }, 200, {
    "Set-Cookie": sessionCookie(`${id.toString()}.${result.token}`, SESSION_DAYS * 86400),
  });
}

// ---------- Admin: eigenes Konto, unabhängig von den Studierenden-Konten ----------
// Benutzername "admin" (oder ADMIN_USER), Passwort aus dem Secret ADMIN_PASSWORD.
// Die Admin-Session ist ein signiertes Cookie (HMAC-SHA256), gültig 12 Stunden.

const ADMIN_COOKIE = "studo_admin";
const ADMIN_HOURS = 12;

async function hmac(env, data) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(`studo-admin:${env.ADMIN_PASSWORD}`),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function adminSession(request, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const raw = getCookie(request, ADMIN_COOKIE);
  const m = raw && raw.match(/^(\d+)\.([A-Za-z0-9_-]+)\.([0-9a-f]{64})$/);
  if (!m || +m[1] < Date.now()) return false;
  return timingSafeEqual(await hmac(env, `${m[1]}.${m[2]}`), m[3]);
}

const adminCookie = (value, maxAge) =>
  `${ADMIN_COOKIE}=${value}; Max-Age=${maxAge}; Path=/api/admin; HttpOnly; Secure; SameSite=Strict`;

async function admin(request, env, pathname) {
  const reg = registry(env);
  if (pathname === "/api/admin/login" && request.method === "POST") {
    if (!env.ADMIN_PASSWORD) return error(503, "Admin-Zugang ist nicht eingerichtet (Secret STUDO_ADMIN_PASSWORD fehlt).");
    const ip = request.headers.get("CF-Connecting-IP") || "?";
    if (await reg.isBlocked(ip)) return error(429, "Zu viele Fehlversuche. Bitte in 15 Minuten erneut probieren.");
    const body = await request.json().catch(() => ({}));
    const userOk = String(body.username || "").trim().toLowerCase() === String(env.ADMIN_USER || "admin").toLowerCase();
    const pwOk = timingSafeEqual(await sha256(String(body.password || "")), await sha256(env.ADMIN_PASSWORD));
    if (!userOk || !pwOk) { await reg.recordFailure(ip); return error(401, "Benutzername oder Passwort falsch."); }
    const exp = Date.now() + ADMIN_HOURS * 3600_000, nonce = randomToken(12);
    return json({ ok: true }, 200, { "Set-Cookie": adminCookie(`${exp}.${nonce}.${await hmac(env, `${exp}.${nonce}`)}`, ADMIN_HOURS * 3600) });
  }
  if (pathname === "/api/admin/logout" && request.method === "POST") return json({ ok: true }, 200, { "Set-Cookie": adminCookie("", 0) });
  if (!(await adminSession(request, env))) return error(401, "Nicht als Admin angemeldet");
  if (pathname === "/api/admin/overview" && request.method === "GET") return json(await reg.overview());
  return error(404, "Unbekannter Endpunkt");
}

async function api(request, env, pathname) {
  if (pathname.startsWith("/api/admin/")) return admin(request, env, pathname);
  if (pathname === "/api/unis" && request.method === "GET") return json(publicUnis());
  if (pathname === "/api/login" && request.method === "POST") return login(request, env);

  const session = parseSession(request);
  const stub = session && storeById(env, session.id);
  if (!stub) return error(401, "Nicht angemeldet");

  if (pathname === "/api/logout" || (pathname === "/api/account" && request.method === "DELETE")) {
    const res = await stub.fetch(request);
    const out = new Response(res.body, res);
    out.headers.append("Set-Cookie", sessionCookie("", 0));
    return out;
  }

  return stub.fetch(request);
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    let response;
    if (pathname.startsWith("/api/")) {
      response = await api(request, env, pathname);
    } else if (pathname.startsWith("/cal/")) {
      const m = pathname.match(/^\/cal\/([0-9a-f]{64})\/[A-Za-z0-9_-]+\.ics$/);
      const stub = m && storeById(env, m[1]);
      response = stub ? await stub.fetch(request) : new Response("Not found", { status: 404 });
    } else {
      response = await env.ASSETS.fetch(request);
      if (pathname === "/sw.js") {
        response = new Response(response.body, response);
        response.headers.set("Cache-Control", "no-cache");
      }
    }
    response = new Response(response.body, response);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) response.headers.set(k, v);
    if (pathname.startsWith("/api/")) response.headers.set("Cache-Control", "no-store");
    return response;
  },
};
