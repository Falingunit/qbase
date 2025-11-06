# Assignment Base System

This document explains how the unified Assignment Base system works and how to add new views that reuse the same reader UI with different data sources or behavior.

## Overview

The page `frontend/assignment_base.html` is a shared shell that renders the common Assignment UI (question header, options, numerical answer, notes, check/reset, solution panel, navigation, question grid, color/bookmark/filters). At runtime it picks a "mode" from the URL to inject only the scripts needed for that view.

- Shared shell: `frontend/assignment_base.html` (UI + dynamic loader)
  - Dynamic loader switch at: `frontend/assignment_base.html:510`
  - Solution card (common for all modes): `frontend/assignment_base.html:418`
  - Color picker: `frontend/assignment_base.html:325`
  - Bookmark button: `frontend/assignment_base.html:335`
  - Check/Reset: `frontend/assignment_base.html:461`
  - Keyboard (arrows, A–D, Space, N): `frontend/assignment_base.html:749`

- Default Assignment view (local/static data)
  - `frontend/assignment/assignment.service.js` (fetch local JSON or server state)
  - `frontend/assignment/assignment.view.js` (DOM helpers for overlay, etc.)
  - `frontend/assignment/assignment.js` (main controller; consumes custom loader if provided)
    - Uses custom loader when present: `frontend/assignment/assignment.js:1947`

- PYQs view (server-backed, filtered/sorted chapter questions)
  - Loader: `frontend/pyqs/pyqs-assignment-loader.js:2` sets `window.__ASSIGNMENT_CUSTOM_LOADER__`
  - Viewer: `frontend/pyqs/pyqs-questions.js` renders with Assignment UI

- Wrappers (stable deep links preserved)
  - `frontend/assignment.html` → redirects to `assignment_base.html?mode=assignment`
  - `frontend/pyqs_assignment.html` → redirects to `assignment_base.html?mode=pyqs`

## Boot Flow

1) `assignment_base.html` loads minimal shared deps (theme, Bootstrap, KaTeX, `common/config.js`).

2) The dynamic loader reads `mode` from the URL and loads the specific scripts:

   - `mode=assignment`
     - Loads `assignment.service.js` → `assignment.view.js` → `assignment.js`.
     - Then loads `EasyMDE` for notes.

   - `mode=pyqs`
     - Loads DOMPurify for safe HTML.
     - Loads `pyqs/pyqs-assignment-loader.js` (sets `__ASSIGNMENT_CUSTOM_LOADER__`).
     - Loads `pyqs/pyqs-questions.js` (viewer with server integrations).
     - Then loads `EasyMDE` for notes.

3) The viewer code (assignment.js or pyqs-questions.js) looks for a custom loader:

   - If `window.__ASSIGNMENT_CUSTOM_LOADER__` exists, the viewer calls it to obtain the questions. Otherwise, it falls back to loading a local assignment JSON via `AssignmentService.loadLocalAssignment(aID)`.

## Data Contract for Custom Loader

Custom loaders must return an object:

```
{
  questions: AssignmentQuestion[],
  originalIndexMap: number[],
  originalTotalCount?: number,
  allQuestionsMap?: any
}
```

Where an `AssignmentQuestion` has the following shape (minimum needed by the UI):

```
{
  qType: "SMCQ" | "MMCQ" | "Numerical" | "Passage",
  qText: string,
  image?: string | null,
  qOptions?: [string, string, string, string], // MCQ only
  qAnswer?: string | string[] | number,       // MCQ or Numerical
  passageId?: string | null,
  passage?: string | null,
  passageImage?: string | null,
  solutionText?: string,
  solutionImage?: string | null,
  pyqInfo?: string,
  diffuculty?: string
}
```

- `originalIndexMap[i]` must point to the original index of display question `i`. This supports consistent server state, bookmarks, and color marks across filtered/sorted sets.
- If you support filtering/sorting, keep a stable mapping and set `originalTotalCount` and `allQuestionsMap` as needed for auxiliary features.

The PYQs loader (`frontend/pyqs/pyqs-assignment-loader.js`) is a full example that:
- Reads `exam`, `subject`, `chapter` from the URL.
- Sets a deterministic synthetic assignment id `__PYQS_ASSIGNMENT_ID__` and title `__PYQS_ASSIGNMENT_TITLE__`.
- Fetches chapter questions from the API.
- Maps them into `AssignmentQuestion` objects.
- Applies saved filters/sorting from server prefs.
- Returns the shaped data and `originalIndexMap`.

## Keyboard Shortcuts (Common)

Shared navigation shortcuts live in the base page and work in all modes:
- Left/Right Arrows: previous/next question (`assignment_base.html:749`)
- Space: Check/Reset (depending on state)
- A–D: Select options in MCQ
- N: Focus notes editor

Color mark shortcuts (Alt+1..5) work in both viewers and fall back to Alt+Digit even if hotkey config hasn’t loaded yet. The color picker is common in the base page (`assignment_base.html:325`). The hotkey mapping defaults are provided by `frontend/common/config.js` and are read by both viewers.

## Solution Rendering

The base page includes a shared Solution panel (`assignment_base.html:418`).
Both viewers call their evaluation logic; PYQs explicitly calls `showSolution(question)` after evaluation. The solution panel displays either `solutionText` (sanitized + KaTeX render) and/or `solutionImage` (click to enlarge).

## Adding a New View

Goal: add a new data source or bespoke behavior while reusing the Assignment UI.

1) Pick a mode name
   - Example: `mode=review`.

2) Add a loader (optional if you reuse the default local loader)
   - Create `frontend/review/review-assignment-loader.js`.
   - Set `window.__ASSIGNMENT_CUSTOM_LOADER__ = async () => ({ questions, originalIndexMap, ... })`.
   - Provide a stable `originalIndexMap` mapping.

3) Add a viewer script or reuse `assignment/assignment.js`
   - If you need special UI hooks or server endpoints, add `frontend/review/review-questions.js` (fork of `pyqs-questions.js` or lean wrapper around `assignment.js`).
   - Otherwise skip this and just use the default `assignment.js` with your custom loader.

4) Wire the dynamic loader in `assignment_base.html`
   - Locate the dynamic loader switch: `frontend/assignment_base.html:510`.
   - Add a new `if (mode === 'review') { ... }` branch to load:
     - Any CDN dependencies needed by your view.
     - Your custom loader (`./review/review-assignment-loader.js`).
     - Your viewer (`./review/review-questions.js`) or the default `./assignment/assignment.js`.
     - Finally, load `EasyMDE`.

5) Optional: wrapper entry for deep links
   - Create `frontend/review_assignment.html` to redirect to `assignment_base.html?mode=review` while preserving query parameters, mirroring `assignment.html`/`pyqs_assignment.html` behavior.

6) Test the integration
   - Verify questions render and navigation works.
   - Check Check/Reset, notes, solution panel, color marks (Alt+1..5), and bookmark flows.
   - Confirm state and indices are consistent when filters/sorting are applied.

## Tips & Gotchas

- Always provide `originalIndexMap` so server-side features (state, marks, bookmarks) map back to the original question indices.
- If you introduce filtering/sorting, keep sorting stable and include a tiebreaker on original index.
- Ensure images in question/solution are clickable; both viewers attach overlay handling to images via event delegation.
- Load `EasyMDE` after the viewer script to ensure the fallback textarea exists.
- The base page already includes a solution panel and keyboard handlers; avoid duplicating them in new views.

## Where To Start

- Dynamic loader: `frontend/assignment_base.html:510`
- PYQs loader example: `frontend/pyqs/pyqs-assignment-loader.js:2`
- Viewer that consumes the loader:
  - Default: `frontend/assignment/assignment.js:1947`
  - PYQs: `frontend/pyqs/pyqs-questions.js`

