# QBase — Local and Production Setup

This repository contains a static frontend (`frontend/`) and a Node.js backend (`backend/`). The frontend talks to the backend over HTTP using a configurable API base URL.

## Prerequisites

- Node.js 18+ installed (LTS recommended)
- A simple static file server for the frontend (e.g., `npx serve`, `python -m http.server`, or VS Code Live Server)

## Configuration

- `frontend/config.json` controls which backend the frontend uses.
- `frontend/config.js` loads that config at runtime.

Keys in `frontend/config.json`:

```json
{
  "API_BASE": "https://your-prod-backend.example.com",   // Production backend base URL
  "DEV_API_BASE": "http://10.0.0.1:3000",                // Optional dev/staging backend
  "LOCAL_MODE": false,                                    // If true, force local backend
  "LOCAL_API_BASE": "http://localhost:3000"              // Local backend base URL
}
```

Behavior:
- If `LOCAL_MODE` is `true`, the app uses `LOCAL_API_BASE`.
- Otherwise, it uses `API_BASE` by default.
- When not in local mode, visiting from `localhost` or adding `?dev=1` prefers `DEV_API_BASE` if set.

## Run Locally

1) Start the backend

```bash
cd backend
npm install
# Optional during local testing to relax CORS:
# ALLOW_ALL_ORIGINS=1 npm start
npm start  # starts on http://localhost:3000
```

Environment variables you can set:
- `PORT` (default `3000`)
- `JWT_SECRET` (recommend setting a strong secret in non-dev)
- `JWT_EXPIRES_IN` (default `7d`)
- `ASSETS_BASE` (default `https://falingunit.github.io/qbase`) — used by the backend to fetch assignment data
- `ALLOW_ALL_ORIGINS=1` (dev only) — temporarily allow all CORS origins

2) Configure the frontend for local

Edit `frontend/config.json`:

```json
{
  "API_BASE": "https://your-prod-backend.example.com",
  "DEV_API_BASE": "http://10.0.0.1:3000",
  "LOCAL_MODE": true,
  "LOCAL_API_BASE": "http://localhost:3000"
}
```

3) Serve the frontend

Serve the `frontend/` folder with any static server, for example:

```bash
# Option A: using node
npx serve frontend -l 8081
# Option B: using Python
cd frontend && python -m http.server 8081
```

Then open `http://localhost:8081` in your browser.

Tips:
- If you previously logged in against a different server, clear the token: open DevTools Console and run `localStorage.removeItem('qb_token')`.
- CORS error during local testing? Start the backend with `ALLOW_ALL_ORIGINS=1`.

## Deploy to Production

Frontend (static hosting):
- Host the `frontend/` directory on a static host (e.g., GitHub Pages). This app is path-aware for `/qbase` when using Pages.
- Set `frontend/config.json` for production:

```json
{
  "API_BASE": "https://your-prod-backend.example.com",
  "DEV_API_BASE": "",
  "LOCAL_MODE": false,
  "LOCAL_API_BASE": "http://localhost:3000"
}
```

Backend (Node server):
- Deploy `backend/` to a server (VM/container). Install Node 18+, then:

```bash
cd backend
npm ci
# Set strong secrets and your environment
export PORT=3000
export JWT_SECRET="change-me-strong"
# If your frontend is not on *.github.io, either add its origin in code or use:
# export ALLOW_ALL_ORIGINS=1   # temporary/testing only
npm start
```

Notes on CORS and assets:
- The backend allows `*.github.io`, `localhost`, and a few predefined origins. If hosting the frontend on a custom domain, either:
  - set `ALLOW_ALL_ORIGINS=1` (temporary), or
  - update the allowed origins list in `backend/server.js` and redeploy.
- `ASSETS_BASE` controls where the backend fetches assignment JSON. If your frontend path differs, set `ASSETS_BASE` accordingly (e.g., `https://your-domain.example.com/qbase`).

## Troubleshooting

- 401/Invalid token: clear local token with `localStorage.removeItem('qb_token')` and sign in again.
- CORS blocked: confirm backend is running and origins are allowed, or use `ALLOW_ALL_ORIGINS=1` while iterating locally.
- 404s for assignment data: ensure `ASSETS_BASE` matches where your `data/` folder is hosted.

## Quick Commands

- Local backend: `cd backend && npm start`
- Local frontend: `npx serve frontend -l 8081` then open `http://localhost:8081`
- Toggle local mode: set `"LOCAL_MODE": true` in `frontend/config.json`
