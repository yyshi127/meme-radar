const CACHE_NAME = "meme-radar-shell-v4";
const DATA_CACHE_NAME = "meme-radar-data-v1";
const APP_SHELL = ["/", "/discovery", "/manifest.webmanifest", "/icons/meme-radar.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => ![CACHE_NAME, DATA_CACHE_NAME].includes(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const pathname = new URL(event.request.url).pathname;
  if (pathname === "/api/report") {
    const cachePromise = caches.open(DATA_CACHE_NAME);
    const updatePromise = cachePromise.then((cache) => fetch(event.request).then((response) => {
      if (response.ok) return cache.put(event.request, response.clone()).then(() => response);
      return response;
    }));
    event.waitUntil(updatePromise.catch(() => {}));
    event.respondWith(
      cachePromise.then((cache) => cache.match(event.request)
        .then((cached) => cached || updatePromise))
    );
    return;
  }
  if (pathname.startsWith("/api/")) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("/")))
  );
});
