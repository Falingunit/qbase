let API_BASE = "";

function detectDev() {
  try {
    const qs = new URLSearchParams(location.search);
    if (["1", "true"].includes((qs.get("dev") || "").toLowerCase())) return true;
    const ls = (localStorage.getItem("qbase.dev") || "").toLowerCase();
    if (["1", "true"].includes(ls)) return true;
    const h = location.hostname;
    // Treat localhost, 127.0.0.1 and WireGuard client 10.0.0.3 as dev
    return h === "localhost" || h === "127.0.0.1" || h === "10.0.0.3";
  } catch {
    return false;
  }
}

async function loadConfig() {
  // Always bypass HTTP cache for config to pick up updates immediately
  const res = await fetch("./config.json", { cache: "no-store" });
  const config = await res.json();
  // Expose optional version for cache-busting elsewhere if needed
  try { window.CONFIG_VERSION = config.version || config.VERSION || null; } catch {}

  // Local run mode: explicitly override to local backend when enabled
  if (config.LOCAL_MODE) {
    API_BASE = config.LOCAL_API_BASE || "http://localhost:3000";
    return;
  }

  // Default/prod base
  API_BASE = config.API_BASE;

  // In dev, prefer a dev API base over public internet
  if (detectDev()) {
    API_BASE = config.DEV_API_BASE || config.API_BASE || "http://10.0.0.1:3000";
  }
}

// --- JWT token helpers and fetch wrapper ---
window.qbSetToken = (t) => localStorage.setItem("qb_token", t);
window.qbGetToken = () => localStorage.getItem("qb_token") || "";
window.qbClearToken = () => localStorage.removeItem("qb_token");
window.authFetch = (url, opts = {}) => {
  const token = qbGetToken();
  const headers = new Headers(opts.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { cache: "no-store", ...opts, headers });
};

// --- Service worker registration (global) ---
try {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      try {
        const pathParts = location.pathname.split('/').filter(Boolean);
        const base = pathParts.length && pathParts[0] === 'qbase' ? '/qbase/' : '/';
        const swUrl = base + 'sw.js';
        navigator.serviceWorker.register(swUrl, { scope: base }).catch(()=>{});
      } catch {}
    });
  }
} catch {}

// --- Hotkeys: defaults, storage, helpers ---
(() => {
  const STORAGE_KEY = "qbase.hotkeys";
  const SERVER_ROUTE = null; // server storage disabled
  let __hkCache = null;
  let __syncPromise = null;

  // Canonicalize a chord like "ctrl+alt+a" -> "Ctrl+Alt+A"
  function normalizeChord(input) {
    if (!input) return "";
    if (Array.isArray(input)) return input.map(normalizeChord).filter(Boolean);
    let s = String(input).trim();
    if (!s) return "";
    const parts = s.split("+").map((p) => p.trim()).filter(Boolean);
    const mods = new Set();
    let key = "";
    for (const pRaw of parts) {
      const p = pRaw.toLowerCase();
      if (p === "ctrl" || p === "control") mods.add("Ctrl");
      else if (p === "alt" || p === "option") mods.add("Alt");
      else if (p === "shift") mods.add("Shift");
      else if (p === "meta" || p === "cmd" || p === "command" || p === "os") mods.add("Meta");
      else {
        // Base key
        if (p === "spacebar" || p === "space" || p === " ") key = "Space";
        else if (p.startsWith("arrow")) key = p[0].toUpperCase() + p.slice(1);
        else if (/^f[1-9][0-2]?$/.test(p)) key = p.toUpperCase();
        else if (p.length === 1) key = p.toUpperCase();
        else key = pRaw; // keep original case for special keys
      }
    }
    const order = ["Ctrl", "Alt", "Shift", "Meta"]; // Display order
    const out = [];
    for (const m of order) if (mods.has(m)) out.push(m);
    if (key) out.push(key);
    return out.join("+");
  }

  function eventToChord(e) {
    if (!e) return "";
    let key = String(e.key || "");
    if (key === " ") key = "Space";
    if (key === "Spacebar") key = "Space";
    // Normalize arrows casing
    if (key.toLowerCase().startsWith("arrow")) key = key[0].toUpperCase() + key.slice(1);
    // Letters as uppercase
    if (key.length === 1) key = key.toUpperCase();
    const mods = [];
    if (e.ctrlKey) mods.push("Ctrl");
    if (e.altKey) mods.push("Alt");
    if (e.shiftKey) mods.push("Shift");
    if (e.metaKey) mods.push("Meta");
    return (mods.length ? mods.join("+") + (key ? "+" : "") : "") + key;
  }

  function defaults() {
    return {
      // Assignment/PYQs common actions
      navPrev: ["ArrowLeft"],
      navNext: ["ArrowRight"],
      checkToggle: ["Space"],
      focusNotes: ["N"],
      optionA: ["A"],
      optionB: ["B"],
      optionC: ["C"],
      optionD: ["D"],

      // Color mark shortcuts (Alt+Digit by default)
      colorBlue: ["Alt+1"],
      colorRed: ["Alt+2"],
      colorYellow: ["Alt+3"],
      colorGreen: ["Alt+4"],
      colorClear: ["Alt+5"],
    };
  }

  async function syncFromServer() { return null; }

  function load() {
    try {
      if (__hkCache) return __hkCache;
      const raw = localStorage.getItem(STORAGE_KEY);
      const base = defaults();
      if (!raw) { __hkCache = base; return base; }
      const parsed = JSON.parse(raw);
      for (const k of Object.keys(base)) {
        const v = parsed[k];
        if (Array.isArray(v) && v.length) base[k] = normalizeChord(v);
        else if (typeof v === "string" && v.trim()) base[k] = [normalizeChord(v)];
      }
      __hkCache = base;
      // Background sync from server (once)
      if (!__syncPromise) {
        __syncPromise = syncFromServer().catch(() => null);
      }
      return base;
    } catch {
      __hkCache = defaults();
      return __hkCache;
    }
  }

  function save(cfg) {
    try {
      const base = defaults();
      const out = {};
      for (const k of Object.keys(base)) {
        const v = cfg[k];
        if (Array.isArray(v)) out[k] = normalizeChord(v);
        else if (typeof v === "string") out[k] = [normalizeChord(v)];
        else out[k] = base[k];
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
      __hkCache = out;
      try { window.dispatchEvent(new Event("qbase:hotkeys-changed")); } catch {}
      // No server push (disabled)
      return out;
    } catch {
      // ignore
    }
  }

  function matches(e, combos) {
    if (!e) return false;
    const cur = eventToChord(e);
    const arr = Array.isArray(combos) ? combos : [combos];
    for (const c of arr) {
      if (normalizeChord(c) === cur) return true;
    }
    return false;
  }

  // Expose API globally
  try {
    window.qbHotkeysDefaults = defaults;
    window.qbLoadHotkeys = load;
    window.qbSaveHotkeys = save;
    window.qbGetHotkeys = load; // alias
    window.qbEventToChord = eventToChord;
    window.qbNormalizeChord = normalizeChord;
    window.qbMatches = matches;
    // Try syncing once on script load
    try { if (!__syncPromise) __syncPromise = syncFromServer(); } catch {}
    // On login, reconcile with server
    // No server reconciliation on login (disabled)
  } catch {}
})();
