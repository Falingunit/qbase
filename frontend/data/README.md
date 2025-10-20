Data

- Overview: Static JSON and assets used by pages and scripts. The site reads these files directly via `fetch` or by constructing URLs.

Contents

- `assignment_list.json` — List of available assignments shown on the home page.
- `pyqs/` — Metadata scaffolding for the PYQs feature (exam/subject/chapter). Subfolders are placeholders for structured data (`chapters/`, `subjects/`, `questions/`).
- `question_data/` — Source assets and JSON for assignments/PYQs, organized in numeric folders (IDs). Each folder may contain `assignment.json` and supporting images (e.g. question figures, icons).
- `worksheets/` — Worksheet content and schemas. See `worksheets/README.md` for details.

Notes

- Paths are read relative to the page URL and the `<base href="/qbase/">` when present. Keep this folder under `/qbase/data/` when deploying.

