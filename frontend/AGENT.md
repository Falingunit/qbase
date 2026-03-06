# Frontend Agent Guide

## Architecture

This is a static multi-page app (no build step in this folder).

Core pages include:
- `index.html` (home)
- `assignment.html` / `assignment_base.html`
- `bookmarks.html`
- `worksheets.html` / `worksheet.html`
- `pyqs.html`, `pyqs_chapters.html`, `pyqs_questions.html`, `pyqs_assignment.html`
- `admin.html`

Feature folders:
- `common/` shared config, navbar, styles
- `assignment/`, `bookmarks/`, `home/`, `worksheets/`, `pyqs/`
- `data/` static JSON and images consumed by the app

## Base Path and PWA Constraints

- The deployed app is path-based under `/qbase/`.
- `index.html` and `worksheet.html` currently use `<base href="/qbase/">`.
- Keep `sw.js`, `offline.html`, icons, and `manifest.webmanifest` in frontend root so service-worker scope stays correct.

If you change path handling, update links, service worker registration behavior, and data URLs together.

## Runtime Config

`common/config.js` loads config from:
1. `frontend/.env`
2. `frontend/.env.ghpages` (when on GitHub Pages)
3. built-in defaults

It sets `API_BASE` and exposes auth helpers (`qbSetToken`, `qbGetToken`, `qbClearToken`, `authFetch`).

## Data Conventions

- Assignment/PYQ assets live under `frontend/data/question_data/<id>/`.
- Worksheets use:
  - `frontend/data/worksheets/worksheet_list.json`
  - `frontend/data/worksheets/<wID>.json`
- Preserve path stability. Many URLs are constructed directly in client code.

## Editing Guidance

- Prefer feature-local edits (`pyqs/*`, `assignment/*`, etc.) over global changes.
- Avoid cross-feature refactors unless required.
- Keep compatibility with existing localStorage keys (bookmarks, state, worksheet drawings, marks).
- When editing `assignment_base.html`, check keyboard shortcuts and mode loader logic still work.

## Validation Checklist

After frontend edits:
1. Load changed page(s) in browser.
2. Confirm API calls point at expected backend (`API_BASE` resolution).
3. Verify no console errors on initial render.
4. If `sw.js` changed, verify offline fallback and cache behavior basics.
