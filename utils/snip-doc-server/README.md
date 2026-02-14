# Snip Doc Server

Standalone local Node server for `utils/Screenshots.htm`.

## What it does

- Treats each **leaf folder** in `utils/PDF Screenshots` as one document.
- Treats files like `page_0001.png`, `page_0002.png`, etc. as pages.
- Saves per-document selection state to `utils/PDF Screenshots/<doc>/.sniplab.selections.json`.
- Exposes:
  - `GET /api/snip-docs`
  - `GET /api/snip-docs/pages?doc=<id>`
  - `GET /api/snip-docs/session?doc=<id>`
  - `PUT /api/snip-docs/session?doc=<id>`
  - `GET /snip-doc-files/...`
- Serves `utils/Screenshots.htm` at `/`.

## Run

```bash
cd utils/snip-doc-server
npm start
```

Then open:

- `http://localhost:3030/`

Optional port override:

```bash
SNIP_SERVER_PORT=3040 npm start
```
