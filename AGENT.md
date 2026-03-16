# QBase Agent Guide

This file is the top-level operating guide for agents working in this repository.

## 1) Project Summary

QBase is split into a static multi-page frontend and a Node.js backend.

- `frontend/`: static site (served on GitHub Pages at `/qbase/`)
- `backend/`: Express + SQLite API server
- `utils/`: helper tools (PDF screenshot tooling, local snip-doc server, scrapers)

## 2) Quick Start

### Backend

```powershell
cd backend
npm install
npm start
```

Server defaults to `http://localhost:3000`.

### Frontend

Serve `frontend/` with any static server:

```powershell
npx serve frontend -l 8081
```

Then open `http://localhost:8081`.

### Snip tool (utils)

```powershell
cd utils/snip-doc-server
npm start
```

Then open `http://localhost:3030`.

## 3) Important Config

### Backend env (`backend/.env`)

Common keys:
- `PORT` (default `3000`)
- `JWT_SECRET`
- `JWT_EXPIRES_IN`
- `ASSETS_BASE`
- `GETMARKS_AUTH_TOKEN` (required for PYQs proxy routes)
- `ALLOW_ALL_ORIGINS=1` (dev-only CORS bypass)

### Frontend runtime config

`frontend/common/config.js` resolves config in this order:
1. `frontend/.env`
2. `frontend/.env.ghpages` (when hosted on GitHub Pages)
3. built-in defaults

`API_BASE` changes by `LOCAL_MODE`, `DEV_API_BASE`, and host detection.

## 4) Repo Guardrails

- Do not edit or commit generated/dependency directories:
  - `**/node_modules/`
  - `backend/uploads/`, `backend/pyqs_assets/`, `backend/db.sqlite*`
- Treat large static data as source-of-truth content:
  - `frontend/data/question_data/**`
  - `frontend/data/worksheets/**`
  - `utils/PDF Screenshots/**`
- Keep PWA/scope-critical files in `frontend/` root:
  - `sw.js`, `offline.html`, `manifest.webmanifest`, icons
- Keep `/qbase/` assumptions intact in pages that use `<base href="/qbase/">` (`index.html`, `worksheet.html`).
- Do not rely on `backend/schema.sql` right now; it currently contains non-schema text and is not authoritative.

## 5) Change Workflow

1. Identify target area (`backend`, `frontend`, or `utils`) and read that folder's `AGENT.md`.
2. Make minimal scoped changes.
3. Run only relevant checks/manual verifications (no global test suite exists yet).
4. Summarize:
   - files changed
   - behavior impact
   - verification performed
   - any risks left unvalidated

## 6) Sub-Guides

- `backend/AGENT.md`
- `frontend/AGENT.md`
- `utils/AGENT.md`
