// sw.js — Service Worker
// Scope-aware precache + runtime caching for static pages, catalog APIs, and remote icons.
const SCOPE_PATH = new URL(self.registration.scope).pathname.replace(/\/?$/, '/');
// Bump versions when changing strategies to invalidate old caches
const CACHE_STATIC = 'qbase-static-v4';
const CACHE_RUNTIME = 'qbase-rt-v4';

// Dedicated caches for PYQs content
const CACHE_PYQS_JSON = 'qbase-pyqs-json-v1';
const CACHE_PYQS_IMG = 'qbase-pyqs-img-v1';

// PYQs cache policy (approximate LRU via entry caps + TTL)
const PYQS_JSON_MAX = 600; // recent JSON entries (exams, subjects, chapters, questions/meta)
const PYQS_IMG_MAX = 2000; // recent images used in PYQs
const PYQS_JSON_TTL_MS = 180 * 24 * 60 * 60 * 1000; // ~6 months
const PYQS_IMG_TTL_MS = 365 * 24 * 60 * 60 * 1000;  // ~1 year

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
    const allow = new Set([CACHE_STATIC, CACHE_RUNTIME, CACHE_PYQS_JSON, CACHE_PYQS_IMG]);
    await Promise.all(keys.filter(k => !allow.has(k)).map(k => caches.delete(k)));
  })());
  self.clients.claim();
});

// ---------- IndexedDB metadata for approximate LRU ----------
const IDB_NAME = 'qbase-sw-meta';
const IDB_STORE = 'entries';

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function idbGet(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const st = tx.objectStore(IDB_STORE);
    const r = st.get(key);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => reject(r.error);
  });
}
function idbSet(db, key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const st = tx.objectStore(IDB_STORE);
    const r = st.put(value, key);
    r.onsuccess = () => resolve(true);
    r.onerror = () => reject(r.error);
  });
}
function idbDel(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const st = tx.objectStore(IDB_STORE);
    const r = st.delete(key);
    r.onsuccess = () => resolve(true);
    r.onerror = () => reject(r.error);
  });
}
function idbScanAll(db) {
  return new Promise((resolve, reject) => {
    const out = [];
    const tx = db.transaction(IDB_STORE, 'readonly');
    const st = tx.objectStore(IDB_STORE);
    const r = st.openCursor();
    r.onsuccess = () => {
      const cur = r.result;
      if (cur) { out.push({ key: cur.key, value: cur.value }); cur.continue(); } else { resolve(out); }
    };
    r.onerror = () => reject(r.error);
  });
}

async function metaTouch(url, type) {
  try { const db = await idbOpen(); await idbSet(db, url, { type, ts: Date.now() }); } catch {}
}
async function metaGet(url) {
  try { const db = await idbOpen(); return await idbGet(db, url); } catch { return null; }
}
async function metaDelete(url) { try { const db = await idbOpen(); await idbDel(db, url); } catch {} }

function isPyqsContentApi(url) {
  // Allow-list PYQs content that is identical for all users
  const p = url.pathname;
  if (!p.startsWith('/api/pyqs/')) return false;
  // Exclude user data routes
  if (p.includes('/state') || p.includes('/prefs') || p.includes('/overlays') || p.includes('/starred') || p.includes('/progress') || p.includes('/search') || p.includes('/subject-overview') || p.includes('/questions-bundle')) return false;
  // Content routes
  if (p === '/api/pyqs/exams' || p.startsWith('/api/pyqs/exams/')) return true; // subjects, chapters, questions[, meta]
  if (p.startsWith('/api/pyqs/exam-overview/')) return true;
  if (p.includes('/questions')) return true; // non-bundle
  return false;
}

// Cache-first with TTL for PYQs JSON
async function cacheFirstJsonWithTtl(request) {
  const url = new URL(request.url);
  const cache = await caches.open(CACHE_PYQS_JSON);
  const cached = await cache.match(request);
  const now = Date.now();
  if (cached) {
    const meta = await metaGet(url.href);
    const fresh = meta && typeof meta.ts === 'number' && (now - meta.ts) < PYQS_JSON_TTL_MS;
    metaTouch(url.href, 'json').catch(()=>{});
    if (fresh) return cached;
  }
  try {
    const net = await fetch(new Request(request, { cache: 'no-store' }));
    if (net && net.ok) {
      try { await cache.put(request, net.clone()); await metaTouch(url.href, 'json'); } catch {}
      pruneCache('json').catch(()=>{});
    }
    if (net) return net;
  } catch {}
  if (cached) return cached;
  throw new Error('Network error');
}

async function cacheFirstOpaque(request) {
  // For cross-origin icon/image requests used in PYQs
  const cache = await caches.open(CACHE_PYQS_IMG);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request, { mode: 'no-cors' });
    try { await cache.put(request, res.clone()); await metaTouch(new URL(request.url).href, 'img'); pruneCache('img').catch(()=>{}); } catch {}
    return res;
  } catch {
    // Fallback to local icon if available
    return caches.match(SCOPE_PATH + 'android-chrome-192x192.png');
  }
}

// Same-origin images for PYQs (e.g., /uploads/...)
async function cacheFirstImageWithTtl(request) {
  const url = new URL(request.url);
  const cache = await caches.open(CACHE_PYQS_IMG);
  const cached = await cache.match(request);
  const now = Date.now();
  if (cached) {
    const meta = await metaGet(url.href);
    const fresh = meta && typeof meta.ts === 'number' && (now - meta.ts) < PYQS_IMG_TTL_MS;
    metaTouch(url.href, 'img').catch(()=>{});
    if (fresh) return cached;
  }
  try {
    const net = await fetch(new Request(request, { cache: 'no-store' }));
    if (net && (net.ok || net.type === 'opaque')) {
      try { await cache.put(request, net.clone()); await metaTouch(url.href, 'img'); pruneCache('img').catch(()=>{}); } catch {}
      return net;
    }
  } catch {}
  if (cached) return cached;
  throw new Error('Network error');
}

// Prune caches by type using metadata (simple LRU-ish)
async function pruneCache(type) {
  const db = await idbOpen();
  const all = await idbScanAll(db);
  const limit = type === 'img' ? PYQS_IMG_MAX : PYQS_JSON_MAX;
  const ttl = type === 'img' ? PYQS_IMG_TTL_MS : PYQS_JSON_TTL_MS;
  const cacheName = type === 'img' ? CACHE_PYQS_IMG : CACHE_PYQS_JSON;
  const cache = await caches.open(cacheName);
  const now = Date.now();
  const entries = all.filter(e => e?.value?.type === type);
  const expired = entries.filter(e => (now - (e.value.ts || 0)) >= ttl);
  await Promise.all(expired.map(async (e) => { await cache.delete(e.key); await idbDel(db, e.key); }));
  const survivors = (await idbScanAll(db)).filter(e => e?.value?.type === type).sort((a,b)=> (a.value.ts||0) - (b.value.ts||0));
  const over = Math.max(0, survivors.length - limit);
  if (over > 0) {
    const victims = survivors.slice(0, over);
    await Promise.all(victims.map(async (e) => { await cache.delete(e.key); await idbDel(db, e.key); }));
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

  // Same-origin PYQs content APIs: cache-first with TTL
  if (isPyqsContentApi(url)) {
    event.respondWith(cacheFirstJsonWithTtl(request));
    return;
  }

  // Same-origin images used by PYQs (e.g., /uploads/...). Only cache when request originates from a PYQs page
  if (/^\/uploads\//.test(url.pathname)) {
    const cid = event.clientId;
    if (cid) {
      event.respondWith((async () => {
        try {
          const c = await self.clients.get(cid);
          const p = new URL(c.url).pathname;
          if (/(^|\/)qbase\/(pyqs|pyqs_|pyqs-)|(\/)(pyqs|pyqs_|pyqs-)/.test(p)) {
            return await cacheFirstImageWithTtl(request);
          }
        } catch {}
        return fetch(request);
      })());
      return;
    }
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
