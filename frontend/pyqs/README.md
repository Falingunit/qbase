PYQs

Pages
- `pyqs.html` — Exams (click to open chapters page)
- `pyqs_chapters.html` — Subjects as tabs + chapters grid for selected subject
- `pyqs_questions.html` — Question list + viewer for a given exam+subject+chapter
- `pyqs_assignment.html` — Assignment-style PYQs viewer (full assignment UI)

Modules
- `pyqs-service.js` — Shared logic and data fetchers (no DOM)
- `pyqs-ui.js` — Shared DOM utilities/widgets (toolbar, helpers)
- `pyqs-index.view.js` — View for exams grid (DOM only)
- `pyqs-chapters.view.js` — View for chapters page (DOM only)
- `pyqs-common.js` — Legacy utilities (DOM + logic mixed). New code should prefer `pyqs-service.js` and `pyqs-ui.js`.
- `pyqs-index.js` — Logic for `pyqs.html` (exams only)
- `pyqs-chapters.js` — Logic for `pyqs_chapters.html` (subjects as tabs)
- `pyqs-qlist.js` — Logic for `pyqs_questions.html` (list + viewer)
- `pyqs-qlist.view.js` — View for `pyqs_questions.html` list (DOM-only, infinite scroll)
- `pyqs-questions.js` — Assignment-style PYQs viewer used by `pyqs_assignment.html`

Deep links (URL params)
- Chapters (optional subject): `pyqs_chapters.html?exam=<id>[&subject=<id>]`
- Questions: `pyqs_questions.html?exam=<id>&subject=<id>&chapter=<id>`

Notes on structure
- Page entry files (e.g., `pyqs-index.js`, `pyqs-chapters.js`) now orchestrate data from `pyqs-service.js` and delegate DOM construction to their `*.view.js` modules. This keeps logic and UI separate and eases migration to React.
