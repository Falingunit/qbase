Question Data

- Purpose: Source assets and JSON grouped by numeric IDs (e.g. exam, subject, or assignment identifiers).
- Typical contents per folder
  - `assignment.json` — The assignment/PYQs payload for that ID (when present).
  - `*.png` (and other images) — Figures and icons referenced from pages.

Conventions

- Folders are named with numeric IDs that the frontend or backend uses to build URLs.
- Files here are fetched directly by the app; keep paths stable when reorganizing.

