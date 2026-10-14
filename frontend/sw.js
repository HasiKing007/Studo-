// Service Worker: App-Shell offline verfügbar, API immer frisch (Netzwerk zuerst,
// bei Offline die letzte Antwort aus dem Cache -> Stundenplan auch im Funkloch lesbar).
const VERSION = "studo-v17";
const SHELL = ["/", "/index.html", "/styles.css", "/app.js", "/manifest.json",
               "/icons/icon-192.png", "/icons/icon-512.png", "/apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // sw.js selbst nie aus dem Cache: daran erkennt die App neue Versionen
  if (url.origin !== location.origin || url.pathname.startsWith("/cal/") || url.pathname === "/sw.js") return;

  if (url.pathname.startsWith("/api/")) {
    if (e.request.method !== "GET") return; // Schreibzugriffe nie cachen
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.ok) caches.open(VERSION).then((c) => c.put(e.request, res.clone()));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // App-Shell: Cache zuerst, im Hintergrund aktualisieren
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const network = fetch(e.request).then((res) => {
        if (res.ok) caches.open(VERSION).then((c) => c.put(e.request, res.clone()));
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
