// Lightweight localStorage cache with TTL + stale-while-revalidate (SWR)
// Usage:
//   const { hit, fresh, data } = cacheGet(key)
//   cacheSet(key, value, { ttlMs: 15*60*1000, swrMs: 24*60*60*1000 })

const NS = 'pyqs-cache-v1:';

function now() { return Date.now(); }

export function cacheSet(key, value, { ttlMs = 0, swrMs = 0 } = {}) {
  try {
    const item = { v: 1, t: now(), ttl: Number(ttlMs)||0, swr: Number(swrMs)||0, d: value };
    localStorage.setItem(NS + key, JSON.stringify(item));
    return true;
  } catch { return false; }
}

export function cacheGet(key) {
  try {
    const raw = localStorage.getItem(NS + key);
    if (!raw) return { hit: false };
    const item = JSON.parse(raw);
    const age = now() - Number(item.t||0);
    const fresh = item.ttl ? age < item.ttl : false;
    const usable = item.ttl || item.swr ? age < (Number(item.ttl||0) + Number(item.swr||0)) : true;
    return { hit: true, fresh, usable, data: item.d };
  } catch { return { hit: false }; }
}

export function cacheDel(key) { try { localStorage.removeItem(NS + key); } catch {} }

export function cacheClear(prefix = '') {
  try {
    const p = NS + String(prefix||'');
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(p)) localStorage.removeItem(k);
    }
  } catch {}
}

