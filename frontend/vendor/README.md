Vendor

- Purpose: Optional third‑party assets that you want to check into the repo (e.g. polyfills, fonts) rather than load from a CDN.
- Status: Currently empty. The app primarily uses CDN‑hosted libraries (Bootstrap, Icons, KaTeX, EasyMDE).
- Recommendation: Prefer CDNs for large libs. If you add files here, reference them from HTML with `./vendor/<file>`.

