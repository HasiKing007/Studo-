// Gemeinsame Hilfen: Zufallstokens, Hashes, Passwörter, JSON-Antworten, Cookies.

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (h) => new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16)));

// PBKDF2-Runden. Zusammen mit den Rate-Limits ausreichend und schnell genug für die Gratis-Limits.
const PBKDF2_ITERATIONS = 100_000;

export const COOKIE = "studo_session";

export function randomToken(bytes = 32) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256(text) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${PBKDF2_ITERATIONS}$${hex(salt)}$${await pbkdf2(password, salt, PBKDF2_ITERATIONS)}`;
}

export async function verifyPassword(password, stored) {
  const [, iter, salt, dk] = String(stored).split("$");
  if (!salt || !dk) return false;
  return timingSafeEqual(await pbkdf2(password, fromHex(salt), +iter), dk);
}

export function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } });
export const error = (status, detail) => json({ detail }, status);

export function getCookie(request, name) {
  const m = (request.headers.get("Cookie") || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : null;
}

/** Session-Cookie "<DO-ID>.<Token>" zerlegen. */
export function parseSession(request) {
  const raw = getCookie(request, COOKIE);
  const m = raw && raw.match(/^([0-9a-f]{64})\.([A-Za-z0-9_-]{20,})$/);
  return m ? { id: m[1], token: m[2] } : null;
}

export function sessionCookie(value, maxAgeSeconds) {
  return `${COOKIE}=${value}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}
