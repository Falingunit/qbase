let API_BASE = "";

const DEFAULT_CONFIG = {
  API_BASE: "https://qbase.103.125.154.215.nip.io",
  DEV_API_BASE: "http://10.0.0.1:3000",
  LOCAL_MODE: true,
  LOCAL_API_BASE: "http://localhost:3000",
};

function isGithubPagesHost() {
  try {
    return /\.github\.io$/i.test(location.hostname || "");
  } catch {
    return false;
  }
}

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

function parseEnvText(text) {
  const out = {};
  const lines = String(text || "").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    const low = value.toLowerCase();
    if (low === "true") out[key] = true;
    else if (low === "false") out[key] = false;
    else out[key] = value;
  }
  return out;
}

async function tryLoadEnvConfig(path = "./.env") {
  try {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) return null;
    const txt = await res.text();
    const parsed = parseEnvText(txt);
    return Object.keys(parsed).length ? parsed : null;
  } catch {
    return null;
  }
}

async function loadConfig() {
  // Priority:
  // 1) .env (local/private),
  // 2) .env.ghpages on GitHub Pages publish,
  // 3) built-in defaults (LOCAL_MODE=true).
  const envConfig = await tryLoadEnvConfig();
  const ghPagesEnvConfig =
    envConfig || !isGithubPagesHost() ? null : await tryLoadEnvConfig("./.env.ghpages");
  let config = { ...DEFAULT_CONFIG };
  let source = "defaults";
  if (envConfig) {
    config = { ...config, ...envConfig };
    source = ".env";
  } else if (ghPagesEnvConfig) {
    config = { ...config, ...ghPagesEnvConfig };
    source = ".env.ghpages";
  }

  try { window.CONFIG_SOURCE = source; } catch {}
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
let __qbMaintNoticeAt = 0;
let __qbMaintDialog = null;
let __qbMaintDialogVisible = false;
let __qbMaintProbeInFlight = false;
let __qbPrevBodyOverflow = "";
function __qbEnsureMaintenanceDialog() {
  if (__qbMaintDialog || typeof document === "undefined") return __qbMaintDialog;
  const wrap = document.createElement("div");
  wrap.id = "qb-maintenance-overlay";
  wrap.setAttribute("role", "dialog");
  wrap.setAttribute("aria-modal", "true");
  wrap.setAttribute("aria-labelledby", "qb-maintenance-title");
  wrap.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:2147483647",
    "display:none",
    "align-items:center",
    "justify-content:center",
    "background:rgba(0,0,0,0.7)",
    "padding:16px"
  ].join(";");

  const box = document.createElement("div");
  box.style.cssText = [
    "width:min(520px,100%)",
    "background:#121417",
    "color:#f3f4f6",
    "border:1px solid rgba(255,255,255,0.12)",
    "border-radius:14px",
    "box-shadow:0 20px 60px rgba(0,0,0,0.45)",
    "padding:18px"
  ].join(";");

  const title = document.createElement("h2");
  title.id = "qb-maintenance-title";
  title.textContent = "Server Under Maintenance";
  title.style.cssText = "margin:0 0 8px;font:600 20px/1.2 system-ui,sans-serif;";

  const msg = document.createElement("p");
  msg.textContent = "The server is under maintenance and will be back soon.";
  msg.style.cssText = "margin:0 0 12px;color:#d1d5db;font:400 14px/1.4 system-ui,sans-serif;";

  const status = document.createElement("div");
  status.id = "qb-maintenance-status";
  status.textContent = "Connection lost.";
  status.style.cssText = "margin:0 0 14px;color:#fbbf24;font:500 13px/1.4 system-ui,sans-serif;";

  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex;gap:10px;justify-content:flex-end;";

  const refreshBtn = document.createElement("button");
  refreshBtn.type = "button";
  refreshBtn.id = "qb-maintenance-refresh";
  refreshBtn.textContent = "Refresh";
  refreshBtn.style.cssText = [
    "border:0",
    "border-radius:10px",
    "padding:10px 14px",
    "background:#2563eb",
    "color:#fff",
    "font:600 14px/1 system-ui,sans-serif",
    "cursor:pointer"
  ].join(";");

  refreshBtn.addEventListener("click", async () => {
    if (__qbMaintProbeInFlight) return;
    __qbMaintProbeInFlight = true;
    refreshBtn.disabled = true;
    refreshBtn.style.opacity = "0.75";
    status.textContent = "Checking server status...";
    status.style.color = "#93c5fd";
    try {
      const probeUrl = `${API_BASE}/me?_=${Date.now()}`;
      const resp = await fetch(probeUrl, { cache: "no-store" });
      if (resp) {
        status.textContent = "Server is back. Reloading...";
        status.style.color = "#86efac";
        try { location.reload(); } catch {}
        return;
      }
      status.textContent = "Server is still unreachable. Please try again shortly.";
      status.style.color = "#fbbf24";
    } catch {
      status.textContent = "Server is still unreachable. Please try again shortly.";
      status.style.color = "#fbbf24";
    } finally {
      __qbMaintProbeInFlight = false;
      refreshBtn.disabled = false;
      refreshBtn.style.opacity = "1";
    }
  });

  box.append(title, msg, status);
  btnRow.appendChild(refreshBtn);
  box.appendChild(btnRow);
  wrap.appendChild(box);
  document.body.appendChild(wrap);
  __qbMaintDialog = wrap;
  return __qbMaintDialog;
}

function __qbOpenMaintenanceDialog() {
  const dlg = __qbEnsureMaintenanceDialog();
  if (!dlg) return;
  if (!__qbMaintDialogVisible) {
    try {
      __qbPrevBodyOverflow = document.body.style.overflow || "";
      document.body.style.overflow = "hidden";
    } catch {}
  }
  const status = dlg.querySelector("#qb-maintenance-status");
  if (status) {
    status.textContent = "Connection lost.";
    status.style.color = "#fbbf24";
  }
  dlg.style.display = "flex";
  __qbMaintDialogVisible = true;
}

function __qbShowMaintenanceNotice() {
  const now = Date.now();
  // Throttle repeated show calls while many requests fail at once.
  if (now - __qbMaintNoticeAt < 500 && __qbMaintDialogVisible) return;
  __qbMaintNoticeAt = now;
  const msg = "Server is under maintenance and will be back soon.";
  __qbOpenMaintenanceDialog();
  try { console.warn(msg); } catch {}
}
window.authFetch = (url, opts = {}) => {
  const token = qbGetToken();
  const headers = new Headers(opts.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { cache: "no-store", ...opts, headers }).catch((err) => {
    __qbShowMaintenanceNotice();
    throw err;
  });
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
