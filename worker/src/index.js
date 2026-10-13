// Einstiegspunkt des Workers: API und Kalender-Feed gehen an das Durable Object,
// alles andere sind die statischen PWA-Dateien aus ../frontend.

export { StudoStore } from "./store.js";

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Strict-Transport-Security": "max-age=31536000",
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; " +
    "connect-src 'self'; frame-ancestors 'none'",
};

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    let response;
    if (pathname.startsWith("/api/") || pathname.startsWith("/cal/")) {
      response = await env.STORE.get(env.STORE.idFromName("main")).fetch(request);
    } else {
      response = await env.ASSETS.fetch(request);
      if (pathname === "/sw.js") {
        response = new Response(response.body, response);
        response.headers.set("Cache-Control", "no-cache");
      }
    }
    response = new Response(response.body, response);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) response.headers.set(k, v);
    return response;
  },
};
