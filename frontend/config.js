let API_BASE = '';

async function loadConfig() {
  const res = await fetch('./config.json');
  const config = await res.json();
  API_BASE = config.API_BASE;
}