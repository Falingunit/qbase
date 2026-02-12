Common

- Shared CSS
  - `theme.css`: color tokens, dark theme, variables.
  - `index.css`: shared layout/components used across pages.
- Shared JS
  - `config.js`: loads runtime config from `/.env` first, then `config.json` on GitHub Pages, otherwise uses built-in defaults (`LOCAL_MODE=true`), and exposes `API_BASE`, token helpers, `authFetch`.
  - `navbar.js`: auto-hiding navbar behavior and login/logout UI wiring.

