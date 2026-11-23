/* ATHENA app shell — cache the chrome, never the API, never the HTML. */
const VERSION = "athena-v16";
const SHELL = ["/styles.css?v=11", "/app.js?v=11", "/manifest.webmanifest", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(names.filter((name) => name !== VERSION).map((name) => caches.delete(name))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.pathname.startsWith("/api/") || url.pathname.startsWith("/v1/")) return;

  /* The shell is never cached: a phone must get the current index.html and the
     current ?v= assets after an update. Only the files that are versioned by
     their query string are cached. */
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(
        () =>
          new Response(
            "<!doctype html><meta name=viewport content='width=device-width'><body style='background:#04050a;color:#e9e4d6;font-family:system-ui,sans-serif;padding:40px'><h1 style='letter-spacing:.3em;font-weight:300;color:#f2cf8a'>ATHENA</h1><p style='color:#857e6d'>The hub is not reachable. Start it on the PC that runs it.</p>",
            { headers: { "content-type": "text/html; charset=utf-8" } }
          )
      )
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(
      (hit) =>
        hit ||
        fetch(event.request)
          .then((res) => {
            const copy = res.clone();
            caches.open(VERSION).then((cache) => cache.put(event.request, copy)).catch(() => undefined);
            return res;
          })
          .catch(() => caches.match(event.request))
    )
  );
});
