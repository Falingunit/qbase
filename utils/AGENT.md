# Utils Agent Guide

`utils/` contains helper tools and content-generation workflows. Most items are not part of production runtime.

## Contents

- `snip-doc-server/`: local Node server for `Screenshots.htm`
- `scraper/`: Python scripts for PYQs scraping/downloading
- `PDF Screenshots/`: large source/output content for screenshot workflows
- `screenshots-assets/`: frontend assets used by screenshot tooling
- `fix_ce.py`: utility script

## snip-doc-server

Run:

```powershell
cd utils/snip-doc-server
npm start
```

Default URL: `http://localhost:3030`

This serves:
- `GET /` -> `utils/Screenshots.htm`
- document/page/session APIs for leaf folders under `utils/PDF Screenshots`

## scraper

Primary script: `utils/scraper/pyqs_downloader.py`

It expects a bearer token via `GETMARKS_AUTH_TOKEN` (or uses embedded fallback token in script). Output defaults to backend paths (`pyqs_assets`, `pyqs_local.sqlite`).

Be explicit about output location when running bulk downloads to avoid accidental overwrites.

## Guardrails

- Avoid committing bulk generated files unless requested.
- Keep `utils/PDF Screenshots/**` structure stable; tools infer docs from folder layout.
- Do not hardcode secrets in new scripts.

## Validation

For utility changes, verify by running only the relevant command/tool and checking produced artifacts in expected paths.
