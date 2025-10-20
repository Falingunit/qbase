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
