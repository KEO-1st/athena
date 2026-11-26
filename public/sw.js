/* ATHENA app shell — cache the chrome, never the API, never the HTML.
   __ATHENA_VERSION__ is replaced by the hub from version.json, so the cache
   key can never disagree with the assets index.html asks for. */
const VERSION = "athena-__ATHENA_VERSION__";
const SHELL = ["/styles.css", "/app.js", "/speech.mjs", "/screen-coords.mjs", "/manifest.webmanifest", "/icons/icon-192.png"];

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

  /* The shell is never cached: a phone must get the current index.html after
     an update. Only the versioned-by-cache-name assets are cached. */
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(
        () =>
          new Response(
            "<!doctype html><meta name=viewport content='width=device-width'><body style='background:#04050a;color:#e9e4d6;font-family:system-ui,sans-serif;padding:40px'><h1 style='letter-spacing:.3em;font-weight:300;color:#f2cf8a'>ATHENA HUB</h1><p style='color:#857e6d'>The hub is not reachable. Start it on the PC that runs it.</p>",
            { headers: { "content-type": "text/html; charset=utf-8" } }
          )
      )
    );
    return;
  }

  /* Network-first for the HTML shell's JS/CSS: after an update a controller
     must not keep running a stale app.js from yesterday's cache. The cached
     copy is only an offline fallback. */
  event.respondWith(
    fetch(event.request, { cache: "no-cache" })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put(event.request, copy)).catch(() => undefined);
        }
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
