# Backend Agent Guide

## Stack

- Node.js (ESM)
- Express
- SQLite via `better-sqlite3`
- JWT auth

Main entrypoint: `backend/server.js`

## Local Run

```powershell
cd backend
npm install
npm start
```

Scripts:
- `npm run migrate:legacy-passwords`
- `npm run clear:users`
- `npm run init:doubt`

## Configuration

Use `backend/.env` (`dotenv` is loaded by the app).

High-impact keys:
- `JWT_SECRET`
- `ASSETS_BASE`
- `GETMARKS_AUTH_TOKEN`
- `ALLOW_ALL_ORIGINS`

## Data and Runtime Artifacts

- Primary DB: `backend/db.sqlite` (+ `-wal`, `-shm`)
- Optional local PYQs DB: `backend/pyqs_local.sqlite`
- Uploads: `backend/uploads/`
- Local PYQs assets: `backend/pyqs_assets/`

Do not commit runtime artifacts unless explicitly requested.

## API Surface Notes

`server.js` includes many route groups:
- auth/account routes (`/signup`, `/login`, `/me`, `/account/*`)
- assignment/state routes (`/api/assignment/*`, `/api/state/*`, `/api/scores`)
- bookmarks/starred/question marks
- PYQs content/state/preferences/overlays/search routes
- admin/report/notification routes
- upload routes

When changing behavior, avoid response shape drift unless caller changes are coordinated.

## CORS and Origin Rules

CORS is custom and permissive for select hosts (including `*.github.io`, localhost, and configured origins). Keep behavior stable unless the task explicitly targets CORS.

## Validation Checklist

After backend edits:
1. Start server without crash.
2. Check `GET /healthz`.
3. Verify one changed endpoint manually.
4. Confirm auth-protected endpoints still reject missing/invalid tokens when applicable.

## Known Caveat

`backend/schema.sql` is not currently a reliable schema file (contains non-schema text). Use live DB behavior and `server.js` logic as source of truth.
