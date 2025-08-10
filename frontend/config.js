let API_BASE = '';

async function loadConfig() {
  const res = await fetch('./config.json');
  const config = await res.json();
  API_BASE = config.API_BASE;
}

// --- JWT token helpers and fetch wrapper ---
window.qbSetToken = (t) => localStorage.setItem('qb_token', t);
window.qbGetToken = () => localStorage.getItem('qb_token') || '';
window.qbClearToken = () => localStorage.removeItem('qb_token');
window.authFetch = (url, opts = {}) => {
  const token = qbGetToken();
  const headers = new Headers(opts.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(url, { ...opts, headers });
};