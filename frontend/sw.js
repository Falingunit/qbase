// sw.js — Service Worker
// Scope-aware precache + runtime caching for static pages, catalog APIs, and remote icons.
const SCOPE_PATH = new URL(self.registration.scope).pathname.replace(/\/?$/, '/');
const CACHE_STATIC = 'qbase-static-v3';
const CACHE_RUNTIME = 'qbase-rt-v3';
const PRECACHE = [
  SCOPE_PATH,
  SCOPE_PATH + 'index.html',
  SCOPE_PATH + 'offline.html',
  SCOPE_PATH + 'android-chrome-192x192.png',
  SCOPE_PATH + 'android-chrome-512x512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_STATIC).then(cache => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => ![CACHE_STATIC, CACHE_RUNTIME].includes(k)).map(k => caches.delete(k)));
  })());
  self.clients.claim();
});

function isCatalogApi(url) {
  // Cache GETs for public catalog endpoints only (no user data)
  const p = url.pathname;
  if (!p.startsWith('/api/pyqs/')) return false;
  if (p.includes('/questions') || p.includes('/state') || p.includes('/prefs') || p.includes('/overlays') || p.includes('/starred') || p.includes('/progress') || p.includes('/subject-overview')) return false;
  // exams, subjects, chapters, exam-overview are safe
  return p.startsWith('/api/pyqs/exams') || p.startsWith('/api/pyqs/exam-overview');
}

async function swrRespond(request) {
  const cache = await caches.open(CACHE_RUNTIME);
  const cached = await cache.match(request);
  const fetchAndPut = fetch(new Request(request, { cache: 'no-store' }))
    .then(async (res) => { try { await cache.put(request, res.clone()); } catch {} return res; })
    .catch(() => null);
  // Return cached immediately if present, else wait for network
  if (cached) { fetchAndPut.catch(()=>{}); return cached; }
  const net = await fetchAndPut; if (net) return net;
  // As a last resort, serve offline page for same-origin HTML navigations
  if (request.mode === 'navigate') return caches.match(SCOPE_PATH + 'offline.html');
  throw new Error('Network error');
}

async function cacheFirstOpaque(request) {
  // For cross-origin icon requests; store opaque responses
  const cache = await caches.open(CACHE_RUNTIME);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request, { mode: 'no-cors' });
    try { await cache.put(request, res.clone()); } catch {}
    return res;
  } catch {
    // Fallback to local icon if available
    return caches.match(SCOPE_PATH + 'android-chrome-192x192.png');
  }
}

// Runtime caching strategy
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Cross-origin remote icons (cache-first, opaque)
  if (url.origin !== self.location.origin) {
    const host = url.hostname;
    if (host.endsWith('getmarks.app')) {
      event.respondWith(cacheFirstOpaque(request));
      return;
    }
    // Other cross-origin: pass-through
    return;
  }

  // Same-origin catalog APIs: stale-while-revalidate
  if (isCatalogApi(url)) {
    event.respondWith(swrRespond(request));
    return;
  }

  // For same-origin assets/pages: try network first with cache bypass,
  // then update cache, else fallback to cache/offline.
  event.respondWith((async () => {
    try {
      const netRes = await fetch(new Request(request, { cache: 'no-store' }));
      const resClone = netRes.clone();
      const cache = await caches.open(CACHE_STATIC);
      try { await cache.put(request, resClone); } catch {}
      return netRes;
    } catch (e) {
      const cached = await caches.match(request);
      if (cached) return cached;
      return caches.match(SCOPE_PATH + 'offline.html');
    }
  })());
});
