// sw.js (PWA cache for project page at /qbase/)
// Use a versioned cache; bump when strategy/critical assets change
const CACHE_NAME = 'qbase-v2';
const PRECACHE = [
  '/qbase/',           // start page
  '/qbase/index.html',
  // Keep precache minimal; network-first will fetch latest for CSS/JS
  '/qbase/android-chrome-192x192.png',
  '/qbase/android-chrome-512x512.png',
  '/qbase/offline.html'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Runtime caching strategy: network-first for same-origin GETs with no-store,
// fallback to cache when offline. This ensures updates appear immediately.
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Pass through cross-origin and API calls (let browser handle)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request).catch(() => caches.match('/qbase/offline.html')));
    return;
  }

  // For same-origin assets/pages: try network first with cache bypass,
  // then update cache, else fallback to cache/offline.
  event.respondWith((async () => {
    try {
      const noStoreReq = new Request(request, { cache: 'no-store' });
      const netRes = await fetch(noStoreReq);
      const resClone = netRes.clone();
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, resClone);
      return netRes;
    } catch (e) {
      const cached = await caches.match(request);
      if (cached) return cached;
      return caches.match('/qbase/offline.html');
    }
  })());
});
