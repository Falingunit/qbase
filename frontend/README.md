Frontend (static) structure — feature‑oriented

- Path base: Pages are served under `/qbase/` (see `<base href="/qbase/">` in some pages) and a root‑scoped service worker at `/qbase/sw.js`. Keep `sw.js`, `offline.html`, icons, and `manifest.webmanifest` in this folder so PWA scope and links remain correct.
- Organization: Assets are grouped by feature (not by file type). HTML files remain at the top level to avoid breaking deep links.

Subfolders (by feature)

- `common/`
  - Shared CSS: `theme.css`, `index.css` (global layout/components)
  - Shared JS: `config.js` (loads config, auth helpers), `navbar.js` (UI + auth)
- `home/`
  - `index.js` — home page logic (Assignments list)
- `bookmarks/`
  - `bookmarks.css`, `bookmarks.js`
- `worksheets/`
  - `worksheet.css`, `worksheet.js`, `index.css`, `index.js`
- `assignment/`
  - `assignment.css`, `assignment.js` — generic assignment UI
- `pyqs/`
  - `pyqs.css`, `pyqs-common.js`, `pyqs-index.js`, `pyqs-chapters.js`, `pyqs-qlist.js`, `pyqs-questions.js`
- `data/` — Static content consumed by the site (see READMEs inside)
- `vendor/` — Optional third‑party assets checked into the repo (currently empty)

Root files

- `index.html` and other HTML entry points.
- `sw.js` service worker (kept at root for `/qbase/` scope).
- `offline.html` offline fallback page used by the service worker.
- Icons (`*.png`, `favicon.ico`) and `manifest.webmanifest`.

Local development tips

- If you serve from a path other than `/qbase/`, either keep the folder name as `qbase` at the server root or remove the `<base href="/qbase/">` line in the relevant pages during local testing.
- Config is loaded from `config.json` with `cache: 'no-store'`. Update `dev.config.json` locally as needed.
