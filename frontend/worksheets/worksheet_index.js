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
  let starredWids = (function loadStarred() {
    try {
      const raw = localStorage.getItem("qb_ws_starred");
      const arr = raw ? JSON.parse(raw) : [];
      return new Set((Array.isArray(arr) ? arr : []).map(String));
    } catch {
      return new Set();
    }
  })();
  function saveStarred() {
    try {
      localStorage.setItem("qb_ws_starred", JSON.stringify(Array.from(starredWids)));
    } catch {}
  }
  async function toggleStar(wID, makeStarred) {
    const id = String(wID || "");
    if (!id) return;
    // Preserve currently open collapses (subjects/chapters)
    const previouslyOpen = Array.from(
      document.querySelectorAll(".as-subject > .collapse.show, .as-chapter .collapse.show")
    )
      .map((el) => el.id)
      .filter(Boolean);
    if (makeStarred) starredWids.add(id);
    else starredWids.delete(id);
    saveStarred();
    // Rebuild to reflect updated stars
    renderGroups(getFilteredData());
    filterVisibility(lastSearch);
    highlightElements(document, (els.search?.value || "").trim());
    checkEmpty();
    // Restore previously open collapses
    const BS = window.bootstrap;
    previouslyOpen.forEach((cid) => {
      const el = cid ? document.getElementById(cid) : null;
      if (el && BS?.Collapse) {
        const coll = BS.Collapse.getOrCreateInstance(el, { toggle: false });
        try { coll.show(); } catch {}
      }
    });
  }
  function getFilteredData() {
    const q = (lastSearch || "").toLowerCase();
    if (!q) return allData;
    return allData.filter((e) => {
      const hay = [e.subject, e.chapter, e.title]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }

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
      const raw = await WorksheetsService.fetchJson(DATA_URL);
      allData = WorksheetsService.normalizeWorksheets(raw);
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

  function bindSearch() {
    if (!els.search) return;
    let t;
    els.search.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(applyFilter, 120);
    });
  }

  // id generation moved to service when needed

  // === Rendering (match index.js structure/classes) ===
  function renderGroups(data) {
    const container = els.content;
    container.innerHTML = "";

    // Build starred section at top
    const starredWrap = document.getElementById("as-starred-wrap");
    const starredGrid = document.getElementById("as-starred");
    const starredCount = document.getElementById("as-starred-count");
    if (starredWrap && starredGrid) {
      starredGrid.innerHTML = "";
      const starredList = data.filter((it) => starredWids.has(String(it.wID)));
      if (starredList.length > 0) {
        starredList.forEach((it) => starredGrid.appendChild(cardFor(it)));
        if (starredCount) starredCount.textContent = `(${starredList.length})`;
        starredWrap.classList.remove("d-none");
      } else {
        starredWrap.classList.add("d-none");
      }
    }

    // Group by subject
    const subjects = new Map();
    for (const it of data) {
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
    if (starredWids.has(String(it.wID))) card.classList.add("as-starred");
    card.dataset.haystack = [it.subject, it.chapter, it.title]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const body = document.createElement("div");
    body.className = "card-body d-flex flex-column gap-1";

    // Star button (top-right)
    const starBtn = document.createElement("button");
    starBtn.type = "button";
    starBtn.className = "as-star-btn btn btn-sm btn-link p-0 m-0";
    const isStarred = starredWids.has(String(it.wID));
    starBtn.innerHTML = isStarred
      ? '<i class="bi bi-star-fill"></i>'
      : '<i class="bi bi-star"></i>';
    starBtn.title = isStarred ? "Unstar" : "Star";
    starBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await toggleStar(it.wID, !isStarred);
    });

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

    card.append(starBtn, body, footer);

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
