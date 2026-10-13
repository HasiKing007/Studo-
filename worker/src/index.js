// Einstiegspunkt des Workers. Jedes Konto hat sein eigenes Durable Object (StudoStore),
// gefunden über den Namen "<uni>:<benutzer>" beim Login und danach über die ID im
// Session-Cookie bzw. im Abo-Link. Die Registry führt Nutzungszahlen und das Rate-Limit.
// Alles andere sind die statischen PWA-Dateien aus ../frontend.

import { SESSION_DAYS } from "./store.js";
import { UNIS, USER_RE, adminSet, normalizeUser, publicUnis } from "./unis.js";
import { error, json, parseSession, sessionCookie } from "./util.js";

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
  const username = normalizeUser(body.username);
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

async function api(request, env, pathname) {
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

  if (pathname.startsWith("/api/admin/")) {
    const who = await stub.whoami(session.token);
    if (!who) return error(401, "Nicht angemeldet");
    if (!adminSet(env).has(who.key)) return error(403, "Kein Admin-Zugang.");
    if (pathname === "/api/admin/overview" && request.method === "GET") return json(await registry(env).overview());
    return error(404, "Unbekannter Endpunkt");
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
