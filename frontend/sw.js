// sw.js (PWA cache for project page at /qbase/)
const CACHE_NAME = 'qbase-v1';
const PRECACHE = [
  '/qbase/',           // start page
  '/qbase/index.html',
  '/qbase/index.css', // adjust to your actual files
  '/qbase/index.js',
  '/qbase/android-chrome-192x192',
  '/qbase/android-chrome-512x512',
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

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        return res;
      }).catch(() => cached || caches.match('/qbase/offline.html'));
      return cached || network;
    })
  );
});
