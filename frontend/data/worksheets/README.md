**Worksheets Guide**
- **Location:** `frontend/data/worksheets/`
- **Pages:** `frontend/worksheet.html` renders a single worksheet by `wID`
- **Index:** `frontend/worksheets.html` lists worksheets from `./data/worksheets/worksheet_list.json`

**Overview**
- **Manifest per worksheet:** `./data/worksheets/{wID}.json` describes the pages and optional answer images.
- **Index list:** `./data/worksheets/worksheet_list.json` feeds the Worksheets page for browsing and search.
- **Local state:** Drawings, markers, and answer masks are saved in `localStorage` per `wID` and page index.

**Manifest (`{wID}.json`)**
- **Schema:** see `frontend/data/worksheets/worksheet.schema.json`
- **Fields:**
  - **title:** Optional string; shown on the page and document title.
  - **pages:** Required array of image URLs, in display order.
  - **answers:** Optional array of image URLs for answer key.
- **Paths:**
  - Relative URLs resolve under the site base `/qbase/` (due to `<base href="/qbase/">` in `worksheet.html`).
  - Use images that `<img>` can render (PNG/JPG/WebP). PDFs are not supported here.
- **Example:**
  ```json
  {
    "title": "Algebra – Linear Equations Worksheet 1",
    "pages": [
      "./data/worksheets/algebra-linear-eq-ws1/pages/1.png",
      "./data/worksheets/algebra-linear-eq-ws1/pages/2.png"
    ],
    "answers": [
      "./data/worksheets/algebra-linear-eq-ws1/answers/1.png"
    ]
  }
  ```

**Index (`worksheet_list.json`)**
- **Schema:** see `frontend/data/worksheets/worksheet_list.schema.json`
- **Accepted shapes:**
  - An array of items: `[ { ... }, { ... } ]`
  - An object with `worksheets: [ ... ]`
  - An object with `items: [ ... ]`
  - A subject map: `{ "Physics": [ ... ], "Math": [ ... ] }`
- **Item fields (common):**
  - **subject:** Display subject (optional in subject-map shape).
  - **chapter | chapterName | topic:** Chapter/topic label.
  - **chapterIndex:** Optional integer to control ordering within a subject.
  - **title | name | worksheetTitle | label:** Display title.
  - **wID | id | wid:** Worksheet identifier. If omitted, the UI generates a stable slug from subject/chapter/title.
  - Other URL-ish fields like `file | path | url | pdf | href` are accepted but not currently used by the UI.
- **Minimal example (array shape):**
  ```json
  [
    {
      "subject": "Physics",
      "chapter": "4. Kinematics",
      "title": "Displacement/Velocity Worksheet A",
      "wID": "physics-kinematics-displacement-a"
    },
    {
      "subject": "Chemistry",
      "chapter": "Stoichiometry",
      "title": "Mole Concept Practice",
      "wID": "chemistry-stoichiometry-mole-concept"
    }
  ]
  ```

**Add a New Worksheet**
- **1) Choose a `wID`:** A URL-friendly id, e.g., `physics-kinematics-displacement-a`. If you omit it in the index, the UI will generate one from text, but using an explicit `wID` is safest.
- **2) Add page/answer images:** Place them anywhere under `frontend/` (commonly under `./data/worksheets/{wID}/pages/` and `./data/worksheets/{wID}/answers/`).
- **3) Create the manifest:** Save `frontend/data/worksheets/{wID}.json` following the manifest schema.
- **4) Add to the index:** Append an item to `frontend/data/worksheets/worksheet_list.json` with at least `subject`, `chapter`, `title`, and your `wID`.
- **5) Test locally:**
  - Index: open `/qbase/worksheets.html`
  - Detail: open `/qbase/worksheet.html?wID={your-wID}`

**Manage & Maintain**
- **Reordering pages:** Drawings are stored per page index (e.g., `page_0_draw`). If you reorder or add/remove pages, previously saved drawings may no longer align. Advise users to click “Reset Worksheet” on the page if layout changes.
- **Renaming `wID`:** All local state (drawings, markers, masks, and star status) keys include `wID`. Changing `wID` will make the page look fresh to users and leave old state orphaned. Prefer keeping `wID` stable; if you must rename, communicate that local state will reset.
- **Deleting a worksheet:** Remove its item from `worksheet_list.json` and delete its `{wID}.json` and any related assets. Existing local state in browsers will remain until users reset/clear storage.
- **Clearing local data:**
  - From the worksheet page, use the “Reset Worksheet” button to clear drawings, masks, and markers for that `wID`.
  - Advanced: in DevTools Console, run `localStorage.clear()` to wipe all app data (affects bookmarks, stars, tokens, etc.).
- **Sorting:** When `chapterIndex` is provided, it is used before the chapter text for stable numeric ordering; otherwise a number is inferred from the chapter string if present.

**Validation Tips**
- Use any JSON Schema validator (Draft 2020-12) against:
  - `frontend/data/worksheets/worksheet.schema.json` for `{wID}.json`
  - `frontend/data/worksheets/worksheet_list.schema.json` for `worksheet_list.json`
- Relative paths in your JSON are resolved under `/qbase/` when served (due to the `<base>` tag). Use `./data/...` style paths for assets within this repo, or absolute URLs.


