const CACHE = "budget-v9";

self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// CSS et JS : jamais mis en cache, toujours depuis le réseau
// Autres fichiers (HTML, icônes) : network-first avec cache offline
self.addEventListener("fetch", (e) => {
  const url = e.request.url;
  if (url.match(/\.(css|js)(\?|$)/)) {
    e.respondWith(fetch(e.request));
    return;
  }
  e.respondWith(
    fetch(e.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE).then((c) => c.put(e.request, clone));
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});
