// Generated with this build's exact asset list and content hash.
const CACHE_NAME = __CACHE_NAME__;
const ASSETS = __ASSETS__;

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(ASSETS.map(url => new Request(url, { cache: "reload" })));
  })());
  // An update waits for existing windows to close, keeping HTML and JS together.
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith("and1-shell-") && name !== CACHE_NAME) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  // Only public app files belong in this cache. API/auth always use the network.
  if (event.request.method !== "GET" || url.origin !== self.location.origin || !ASSETS.includes(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    return await cache.match(url.pathname) || fetch(event.request);
  })());
});
