import { test } from "node:test";
import assert from "node:assert/strict";
import { b64url, encryptPayload, generateVapid, sendPush, unb64url } from "../src/webpush.js";

// Empfängerseite (wie im Browser) nachbauen und entschlüsseln
async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}
async function decrypt(body, ua, authSecret) {
  const salt = body.slice(0, 16), rs = new DataView(body.buffer, body.byteOffset).getUint32(16), idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen), cipher = body.slice(21 + idlen);
  assert.equal(rs, 4096);
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey));
  const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, ua.privateKey, 256));
  const e = new TextEncoder();
  const info = new Uint8Array([...e.encode("WebPush: info\0"), ...uaPublic, ...asPublic]);
  const ikm = await hkdf(authSecret, shared, info, 32);
  const cek = await hkdf(salt, ikm, e.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, e.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, cipher));
  assert.equal(plain[plain.length - 1], 2);
  return new TextDecoder().decode(plain.slice(0, -1));
}

async function browserSub() {
  const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const sub = { endpoint: "https://web.push.apple.com/abc", keys: { p256dh: b64url(await crypto.subtle.exportKey("raw", ua.publicKey)), auth: b64url(auth) } };
  return { ua, auth, sub };
}

test("base64url hin und zurück", () => {
  const b = Uint8Array.from([0, 250, 251, 255, 62, 63]);
  assert.deepEqual(unb64url(b64url(b)), b);
});

test("Verschlüsselung nach RFC 8291 lässt sich vom Browser entschlüsseln", async () => {
  const { ua, auth, sub } = await browserSub();
  const body = await encryptPayload(sub, JSON.stringify({ title: "Raumänderung", body: "Jetzt HS 2" }));
  assert.deepEqual(JSON.parse(await decrypt(body, ua, auth)), { title: "Raumänderung", body: "Jetzt HS 2" });
});

test("sendPush: VAPID-Header gültig signiert, 410 = Abo weg", async () => {
  const vapid = await generateVapid();
  const { sub } = await browserSub();
  let seen;
  const ok = await sendPush(sub, { title: "x" }, vapid, "https://studo.example", async (url, init) => { seen = init; return new Response("", { status: 201 }); });
  assert.equal(ok, "ok");
  assert.equal(seen.headers["Content-Encoding"], "aes128gcm");
  const m = seen.headers.Authorization.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/);
  assert.ok(m);
  const claims = JSON.parse(Buffer.from(m[2], "base64url").toString());
  assert.equal(claims.aud, "https://web.push.apple.com");
  assert.equal(claims.sub, "https://studo.example");
  const pub = await crypto.subtle.importKey("raw", unb64url(m[4]), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  assert.ok(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, unb64url(m[3]), new TextEncoder().encode(`${m[1]}.${m[2]}`)));
  assert.equal(await sendPush(sub, { title: "x" }, vapid, "https://s", async () => new Response("", { status: 410 })), "gone");
});
