"use strict";
(function () {
  const DATA_URL = "./data/worksheets/worksheet_list.json";

  // Elements (mirror index.html ids so styles/behavior match)
  const els = {
    content: document.getElementById("as-content"),
    loading: document.getElementById("as-loading"),
    error: document.getElementById("as-error"),
    empty: document.getElementById("as-empty"),
    search: document.getElementById("table-search-input"),
    clear: document.getElementById("as-clear-btn"),
  };

  let allData = [];
  let lastSearch = "";
  const STAR_KEY = "starredWorksheets";
  let starred = new Set(JSON.parse(localStorage.getItem(STAR_KEY) || "[]"));

  // Wire global navbar search to local search (same as index.js UX)
  (function wireNavbarToLocalSearch() {
    const globalInput = document.getElementById("navbar-search-input");
    const globalBtn = document.getElementById("navbar-search-btn");
    if (globalInput && els.search) {
      globalInput.addEventListener("input", () => {
        els.search.value = globalInput.value;
        applyFilter();
      });
    }
    if (globalBtn) globalBtn.addEventListener("click", () => applyFilter());
  })();

  // Init
  document.addEventListener("DOMContentLoaded", init, { once: true });

  async function init() {
    toggle(els.loading, true);
    toggle(els.error, false);
    toggle(els.content, false);
    toggle(els.empty, false);

    try {
      const raw = await fetchJson(DATA_URL);
      allData = normalizeWorksheets(raw);
      renderGroups(allData);
      bindSearch();

      // Query param (?q=foo)
      const q = new URLSearchParams(location.search).get("q");
      if (q) {
        els.search.value = q;
      }
      applyFilter();

      toggle(els.loading, false);
      toggle(els.content, true);
      document.title = q ? `Worksheets – ${q}` : "QBase – Worksheets";
    } catch (err) {
      console.error(err);
      showError(err?.message || "Failed to load worksheets.");
    }
  }

  // === Fetch helpers ===
  async function fetchJson(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return await r.json();
  }

  // === Data normalization (accept a few common shapes) ===
  function normalizeWorksheets(input) {
    const out = [];

    const pushItem = (raw, subjHint) => {
      if (!raw) return;
      const subject = (raw.subject || subjHint || "(No subject)").toString();
      const chapter = (
        raw.chapter ||
        raw.chapterName ||
        raw.topic ||
        ""
      ).toString();
      const title = (
        raw.title ||
        raw.name ||
        raw.worksheetTitle ||
        raw.label ||
        raw.file ||
        "Worksheet"
      ).toString();
      const fileField =
        raw.file || raw.path || raw.url || raw.pdf || raw.href || "";
      const fileUrl = resolveFile(fileField);
      const chapterIndex = parseChapterIndex(chapter, raw.chapterIndex);
      const wID = String(
        raw.wID || raw.id || raw.wid || generateWID(subject, chapter, title)
      );
      out.push({ subject, chapter, title, wID, fileUrl, chapterIndex });
    };

    if (Array.isArray(input)) {
      input.forEach((it) => pushItem(it));
    } else if (input && Array.isArray(input.worksheets)) {
      input.worksheets.forEach((it) => pushItem(it));
    } else if (input && Array.isArray(input.items)) {
      input.items.forEach((it) => pushItem(it));
    } else if (input && typeof input === "object") {
      // Possibly an object: { "Physics": [..], "Chemistry": [..] }
      Object.entries(input).forEach(([subj, arr]) => {
        if (Array.isArray(arr)) arr.forEach((it) => pushItem(it, subj));
      });
    }

    // Stable sort by subject, then chapterIndex/chapter, then title
    out.sort(
      (a, b) =>
        a.subject.localeCompare(b.subject, undefined, {
          sensitivity: "base",
        }) ||
        (a.chapterIndex ?? 1e9) - (b.chapterIndex ?? 1e9) ||
        a.chapter.localeCompare(b.chapter, undefined, {
          sensitivity: "base",
        }) ||
        a.title.localeCompare(b.title, undefined, { sensitivity: "base" })
    );

    return out;
  }

  function parseChapterIndex(chapter, fallback) {
    if (typeof fallback === "number") return fallback;
    const m = /(^|\b)(\d{1,3})(\b|\D)/.exec(String(chapter || ""));
    return m ? parseInt(m[2], 10) : 1e9; // put non-numbered at the end
  }

  function resolveFile(v) {
    if (!v) return "";
    // pass through absolute/relative URLs
    return String(v);
  }

  function bindSearch() {
    if (!els.search) return;
    let t;
    els.search.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(applyFilter, 120);
    });
  }

  function generateWID(subject, chapter, title) {
    const slug = (s) =>
      String(s || "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-");
    const base = [slug(subject), slug(chapter), slug(title)]
      .filter(Boolean)
      .join("-");
    return base.slice(0, 96) || String(Date.now());
  }

  function toggleStar(id) {
    id = String(id);
    if (starred.has(id)) starred.delete(id);
    else starred.add(id);
    localStorage.setItem(STAR_KEY, JSON.stringify([...starred]));
    renderGroups(allData);
    applyFilter();
  }

  // === Rendering (match index.js structure/classes) ===
  function renderGroups(data) {
    const container = els.content;
    container.innerHTML = "";

    const starredItems = data.filter((it) =>
      starred.has(String(it.wID))
    );
    const otherItems = data.filter((it) => !starred.has(String(it.wID)));

    if (starredItems.length) {
      const starEl = document.createElement("section");
      starEl.className = "as-subject as-starred";
      const head = document.createElement("div");
      head.className = "as-header";
      head.innerHTML = `<i class="bi bi-star-fill text-warning"></i><span class="me-1">Starred</span> <span class="as-count">(${starredItems.length})</span>`;
      const grid = document.createElement("div");
      grid.className = "as-grid";
      starredItems.forEach((it) => grid.appendChild(cardFor(it)));
      starEl.append(head, grid);
      container.appendChild(starEl);
    }

    // Group by subject
    const subjects = new Map();
    for (const it of otherItems) {
      const s = it.subject || "(No subject)";
      if (!subjects.has(s)) subjects.set(s, []);
      subjects.get(s).push(it);
    }

    const subjOrder = Array.from(subjects.keys()).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );

    subjOrder.forEach((subject) => {
      const items = subjects.get(subject) || [];

      const subEl = document.createElement("section");
      subEl.className = "as-subject";
      const subId = `sub-${slug(subject)}`;

      // Subject header with collapse toggle (match index.js)
      const header = document.createElement("div");
      header.className = "as-header";
      header.innerHTML = `<button class=\"btn btn-sm btn-link as-toggle text-dark-emphasis fs-5\" data-bs-toggle=\"collapse\" data-bs-target=\"#${subId}\" aria-controls=\"${subId}\"><i class=\"bi bi-chevron-right\"></i><span class=\"me-1\">${escapeHtml(
        subject
      )}</span> <span class=\"as-count\">(${items.length})</span></button>`;

      const collapse = document.createElement("div");
      collapse.className = "collapse";
      collapse.id = subId;

      // Group by chapter inside subject
      const chapters = new Map();
      items.forEach((it) => {
        const key = it.chapter || "(No chapter)";
        if (!chapters.has(key)) chapters.set(key, []);
        chapters.get(key).push(it);
      });

      const chapterOrder = Array.from(chapters.entries())
        .map(([k, arr]) => ({
          key: k,
          arr,
          idx: arr[0]?.chapterIndex ?? parseChapterIndex(k),
        }))
        .sort(
          (a, b) =>
            a.idx - b.idx ||
            a.key.localeCompare(b.key, undefined, { sensitivity: "base" })
        );

      chapterOrder.forEach(({ key: chapter, arr: list }) => {
        const chapWrap = document.createElement("div");
        chapWrap.className = "as-chapter ps-5";
        const chapId = `${subId}-ch-${slug(chapter)}`;

        const h = document.createElement("div");
        h.className = "as-header";
        h.innerHTML = `<button class=\"btn btn-sm btn-link as-toggle fs-5\" data-bs-toggle=\"collapse\" data-bs-target=\"#${chapId}\" aria-controls=\"${chapId}\"><i class=\"bi bi-chevron-right\"></i><span class=\"me-1\">${escapeHtml(
          chapter
        )}</span> <span class=\"as-count\">(${list.length})</span></button>`;

        const wrap = document.createElement("div");
        wrap.className = "collapse";
        wrap.id = chapId;

        const grid = document.createElement("div");
        grid.className = "as-grid";

        list.forEach((it) => grid.appendChild(cardFor(it)));

        wrap.appendChild(grid);
        chapWrap.append(h, wrap);
        collapse.appendChild(chapWrap);
      });

      subEl.append(header, collapse);
      container.appendChild(subEl);
    });
  }

  function cardFor(it) {
    const card = document.createElement("div");
    card.className = "card as-card h-100";
    card.dataset.haystack = [it.subject, it.chapter, it.title]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const id = String(it.wID);
    const starBtn = document.createElement("button");
    starBtn.type = "button";
    starBtn.className = "btn btn-sm btn-link as-star-btn position-absolute top-0 end-0";
    starBtn.innerHTML = `<i class="bi ${starred.has(id) ? "bi-star-fill" : "bi-star"}"></i>`;
    starBtn.classList.toggle("text-warning", starred.has(id));
    starBtn.classList.toggle("text-secondary", !starred.has(id));
    starBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleStar(id);
    });
    card.appendChild(starBtn);

    const body = document.createElement("div");
    body.className = "card-body d-flex flex-column gap-1";

    const title = document.createElement("h5");
    title.className = "card-title mb-1 as-highlightable";
    title.dataset.raw = it.title || "Worksheet";
    title.textContent = it.title || "Worksheet";

    const meta = document.createElement("div");
    meta.className = "as-meta";
    const ch = document.createElement("div");
    ch.textContent = "Chapter: ";
    const chValue = document.createElement("strong");
    chValue.className = "as-highlightable";
    chValue.dataset.raw = it.chapter || "—";
    chValue.textContent = it.chapter || "—";
    ch.appendChild(chValue);
    meta.appendChild(ch);

    body.append(title, meta);

    const footer = document.createElement("div");
    footer.className = "card-footer bg-transparent border-0 as-actions";

    card.append(body, footer);

    // Make entire card clickable (but keep links/buttons functional)
    card.addEventListener("click", (e) => {
      if (e.defaultPrevented) return;
      if (e.target.closest("a, button, input, textarea, select, label")) return;
      window.location.href = `./worksheet.html?wID=${encodeURIComponent(
        it.wID || ""
      )}`;
    });

    return card;
  }

  // === Search / filter like index.js ===
  function applyFilter() {
    lastSearch = (els.search.value || "").trim();
    els.clear?.classList.toggle("d-none", lastSearch.length === 0);

    filterVisibility(lastSearch);
    checkEmpty();
    highlightElements(document, lastSearch);
    document.title = lastSearch
      ? `Worksheets – ${lastSearch}`
      : "QBase – Worksheets";
  }

  function filterVisibility(qRaw) {
    const q = (qRaw || "").toLowerCase();

    // Show/hide cards
    document.querySelectorAll(".as-card").forEach((card) => {
      const hay = card.dataset.haystack || "";
      const match = !q || hay.includes(q);
      card.classList.toggle("d-none", !match);
    });

    document.querySelectorAll(".as-starred").forEach((sec) => {
      const visible = sec.querySelectorAll(".as-card:not(.d-none)").length;
      sec.classList.toggle("d-none", visible === 0);
      const badge = sec.querySelector(".as-count");
      if (badge) badge.textContent = `(${visible})`;
    });

    const BS = window.bootstrap; // avoid any local shadowing

    // Chapters
    document.querySelectorAll(".as-chapter").forEach((chap) => {
      const visible = chap.querySelectorAll(".as-card:not(.d-none)").length;
      chap.classList.toggle("d-none", visible === 0);

      const badge = chap.querySelector(".as-count");
      if (badge) badge.textContent = `(${visible})`;

      const collapseEl = chap.querySelector(".collapse");
      if (collapseEl && BS?.Collapse) {
        const coll = BS.Collapse.getOrCreateInstance(collapseEl, {
          toggle: false,
        });
        if (q && visible > 0) coll.show();
        else coll.hide();
      }
    });

    // Subjects
    document.querySelectorAll(".as-subject").forEach((sub) => {
      const visible = sub.querySelectorAll(".as-card:not(.d-none)").length;
      sub.classList.toggle("d-none", visible === 0);

      const badge = sub.querySelector(":scope > .as-header .as-count");
      if (badge) badge.textContent = `(${visible})`;

      const collapseEl = sub.querySelector(":scope > .collapse");
      if (collapseEl && BS?.Collapse) {
        const coll = BS.Collapse.getOrCreateInstance(collapseEl, {
          toggle: false,
        });
        if (q && visible > 0) coll.show();
        else coll.hide();
      }
    });
  }

  function checkEmpty() {
    const any = document.querySelectorAll(".as-card:not(.d-none)").length > 0;
    toggle(els.empty, !any);
  }

  // Clear button
  els.clear?.addEventListener("click", () => {
    els.search.value = "";
    applyFilter();
    els.search.focus();
  });

  // === Highlight helpers (same API as index.js) ===
  function highlightElements(root, q) {
    (root || document).querySelectorAll(".as-highlightable").forEach((el) => {
      const raw =
        el.dataset.raw ?? el.getAttribute("data-raw") ?? el.textContent ?? "";
      el.innerHTML = q ? highlightText(raw, q) : escapeHtml(raw);
    });
  }

  const OPEN = "\u0001"; // control chars survive HTML escaping
  const CLOSE = "\u0002";

  function highlightText(raw, q) {
    if (!q) return escapeHtml(raw ?? "");
    const re = new RegExp(escapeRegExp(q), "ig");
    const marked = String(raw ?? "").replace(re, (m) => OPEN + m + CLOSE);
    return escapeHtml(marked)
      .split(OPEN)
      .join("<mark>")
      .split(CLOSE)
      .join("</mark>");
  }

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text ?? "";
    return div.innerHTML;
  }

  // === Small utils ===
  function slug(s) {
    return String(s || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");
  }

  function toggle(el, show) {
    if (!el) return;
    el.classList.toggle("d-none", !show);
  }
})();
