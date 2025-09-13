"use strict";

(async () => {
  await loadConfig();

  let allData = [];
  let cachedScores = {};
  let lastSearch = "";
  let starredIds = new Set();

  const els = {
    content: document.getElementById("as-content"),
    loading: document.getElementById("as-loading"),
    error: document.getElementById("as-error"),
    empty: document.getElementById("as-empty"),
    search: document.getElementById("table-search-input"),
    clear: document.getElementById("as-clear-btn"),
  };

  // Wire navbar -> local search
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

  // Refresh server-coupled data on login (scores + starred)
  window.addEventListener("qbase:login", async () => {
    try {
      const [scores, starred] = await Promise.all([
        fetchScores(),
        fetchStarred(),
      ]);
      cachedScores = scores || {};
      starredIds = new Set(Array.isArray(starred) ? starred.map(Number) : []);
    } catch {}
    buildCards(getFilteredData());
    filterVisibility(lastSearch);
    highlightElements(document, (els.search?.value || "").trim());
    checkEmpty();
  });

  // Clear server-coupled data on logout
  window.addEventListener("qbase:logout", () => {
    cachedScores = {};
    starredIds = new Set();
    buildCards(getFilteredData());
    filterVisibility(lastSearch);
    highlightElements(document, (els.search?.value || "").trim());
    checkEmpty();
  });
  initApp();

  async function initApp() {
    toggle(els.loading, true);
    toggle(els.error, false);
    toggle(els.empty, false);
    toggle(els.content, false);

    try {
      const [assignRes, scores, starred] = await Promise.all([
        fetch("./data/assignment_list.json").then((r) => r.json()),
        fetchScores(),
        fetchStarred(),
      ]);
      allData = normalizeAssignments(assignRes);
      cachedScores = scores || {};
      starredIds = new Set(Array.isArray(starred) ? starred.map(Number) : []);
      buildCards(getFilteredData());
      bindSearch();

      toggle(els.loading, false);
      toggle(els.content, true);
      checkEmpty();
      // initial highlight pass
      highlightElements(document, (els.search?.value || "").trim());
    } catch (e) {
      console.error(e);
      showError("Failed to load assignments. Check the JSON/API.");
      toggle(els.loading, false);
    }
  }

  // Accept both old and new assignment_list.json shapes
  function normalizeAssignments(input) {
    const out = [];

    const pushItem = (raw, subjHint) => {
      if (!raw || typeof raw !== "object") return;
      const id = Number(
        raw.aID ?? raw.id ?? raw.assignmentId ?? raw.AID ?? raw.Aid
      );
      if (!Number.isFinite(id)) return;

      const subject = String(raw.subject ?? subjHint ?? "").trim() || "(No subject)";
      const chapter = String(
        raw.chapter ?? raw.chapterName ?? raw.topic ?? ""
      );
      const title = String(
        raw.title ?? raw.name ?? raw.assignmentTitle ?? `Assignment ${id}`
      );
      const faculty = String(
        raw.faculty ?? raw.teacher ?? raw.mentor ?? ""
      );

      const attemptedRaw =
        raw.attempted ?? raw.attemptedCount ?? raw.progress?.attempted;
      const totalRaw =
        raw.totalQuestions ?? raw.total ?? raw.questionsCount ?? raw.progress?.total;

      const item = { aID: id, subject, chapter, title, faculty };
      const attempted = Number(attemptedRaw);
      const totalQuestions = Number(totalRaw);
      if (Number.isFinite(attempted)) item.attempted = attempted;
      if (Number.isFinite(totalQuestions)) item.totalQuestions = totalQuestions;

      out.push(item);
    };

    if (Array.isArray(input)) {
      input.forEach(pushItem);
    } else if (input && Array.isArray(input.assignments)) {
      input.assignments.forEach(pushItem);
    } else if (input && Array.isArray(input.items)) {
      input.items.forEach(pushItem);
    } else if (input && typeof input === "object") {
      // Possibly an object: { "Physics": [..], "Chemistry": [..] }
      Object.entries(input).forEach(([subj, arr]) => {
        if (Array.isArray(arr)) arr.forEach((it) => pushItem(it, subj));
      });
    }

    return out;
  }

  async function fetchScores() {
    try {
      const r = await authFetch(`${API_BASE}/api/scores`);
      if (!r.ok) return {};
      return await r.json();
    } catch {
      return {};
    }
  }

  async function fetchStarred() {
    try {
      const r = await authFetch(`${API_BASE}/api/starred`);
      if (!r.ok) return [];
      return await r.json(); // [assignmentId]
    } catch {
      return [];
    }
  }

  function bindSearch() {
    if (!els.search) return;
    let t;
    els.search.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(applyFilter, 120);
    });
    if (els.clear) {
      els.clear.addEventListener("click", () => {
        els.search.value = "";
        applyFilter();
        els.search.focus();
      });
    }
  }

  function applyFilter() {
    lastSearch = (els.search.value || "").trim();
    els.clear?.classList.toggle("d-none", lastSearch.length === 0);
    filterVisibility(lastSearch);
    checkEmpty();
    highlightElements(document, lastSearch);
  }

  function filterVisibility(qRaw) {
    const q = qRaw.toLowerCase();
    document.querySelectorAll(".as-card").forEach((card) => {
      const hay = card.dataset.haystack || "";
      const match = !q || hay.includes(q);
      card.classList.toggle("d-none", !match);
    });

    // Chapters
    document.querySelectorAll(".as-chapter").forEach((chap) => {
      const visible = chap.querySelectorAll(".as-card:not(.d-none)").length;
      chap.classList.toggle("d-none", visible === 0);

      const badge = chap.querySelector(".as-count");
      if (badge) badge.textContent = `(${visible})`;

      const collapseEl = chap.querySelector(".collapse");
      const BS = window.bootstrap;
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
      const BS = window.bootstrap;
      if (collapseEl && BS?.Collapse) {
        const coll = BS.Collapse.getOrCreateInstance(collapseEl, {
          toggle: false,
        });
        if (q && visible > 0) coll.show();
        else coll.hide();
      }
    });
  }

  function getFilteredData() {
    const q = lastSearch.toLowerCase();
    if (!q) return allData;
    return allData.filter((e) => {
      const hay = [e.subject, e.chapter, e.faculty, e.title]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }

  function checkEmpty() {
    const any = document.querySelectorAll(".as-card:not(.d-none)").length > 0;
    toggle(els.empty, !any);
  }

  function toggle(el, show) {
    if (!el) return;
    el.classList.toggle("d-none", !show);
  }
  function showError(msg) {
    if (!els.error) return;
    els.error.textContent = msg;
    toggle(els.error, true);
  }

  // === Build grouped cards with Subject -> Chapter -> Cards, all collapsible ===
  function buildCards(data) {
    const container = els.content;
    container.innerHTML = "";

    // Build starred section at top
    const starredWrap = document.getElementById("as-starred-wrap");
    const starredGrid = document.getElementById("as-starred");
    const starredCount = document.getElementById("as-starred-count");
    if (starredWrap && starredGrid) {
      starredGrid.innerHTML = "";
      const starredList = data.filter((it) => starredIds.has(Number(it.aID)));
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

      const header = document.createElement("div");
      header.className = "as-header";
      header.innerHTML = `<button class=\"btn btn-sm btn-link as-toggle text-dark-emphasis fs-5\" data-bs-toggle=\"collapse\" data-bs-target=\"#${subId}\" aria-controls=\"${subId}\"><i class=\"bi bi-chevron-right\"></i><span class=\"me-1\">${escapeHtml(
        subject
      )}\
</span> <span class=\"as-count\">(${items.length})</span></button>`;

      const collapse = document.createElement("div");
      collapse.className = "collapse";
      collapse.id = subId;

      // Group by chapter inside subject
      const chapters = new Map();
      for (const it of items) {
        const c = it.chapter || "(No chapter)";
        if (!chapters.has(c)) chapters.set(c, []);
        chapters.get(c).push(it);
      }
      const chapOrder = Array.from(chapters.keys()).sort((a, b) => {
        const na = extractNum(a),
          nb = extractNum(b);
        if (na !== nb) return na - nb;
        return String(a).localeCompare(String(b), undefined, {
          numeric: true,
          sensitivity: "base",
        });
      });

      chapOrder.forEach((chapter) => {
        const list = chapters.get(chapter) || [];
        const chapWrap = document.createElement("div");
        chapWrap.className = "as-chapter ps-5";
        const chapId = `${subId}-ch-${slug(chapter)}`;

        const h = document.createElement("div");
        h.className = "as-header";
        h.innerHTML = `<button class=\"btn btn-sm btn-link as-toggle fs-5\" data-bs-toggle=\"collapse\" data-bs-target=\"#${chapId}\" aria-controls=\"${chapId}\"><i class=\"bi bi-chevron-right\"></i><span class=\"me-1\">${escapeHtml(
          chapter
        )}\
        </span> <span class=\"as-count\">(${list.length})</span></button>`;

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

  function cardFor(entry) {
    const card = document.createElement("div");
    card.className = "card as-card h-100";
    if (starredIds.has(Number(entry.aID))) card.classList.add("as-starred");

    // Determine status from scores: completed if all questions attempted; started if attempted > 0
    const sc = cachedScores?.[entry.aID] || {};
    const attempted = Number(sc.attempted ?? entry.attempted ?? 0);
    const totalQ = Number(sc.totalQuestions ?? entry.totalQuestions ?? 0);
    const statusClass =
      attempted > 0 && totalQ > 0 && attempted >= totalQ
        ? "completed"
        : attempted > 0
        ? "started"
        : "";
    if (statusClass) card.classList.add(statusClass);

    // Precompute searchable text
    const hay = [entry.subject, entry.chapter, entry.faculty, entry.title]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    card.dataset.haystack = hay;

    const body = document.createElement("div");
    body.className = "card-body d-flex flex-column gap-1";

    // Star button (top-right)
    const starBtn = document.createElement("button");
    starBtn.type = "button";
    starBtn.className = "as-star-btn btn btn-sm btn-link p-0 m-0";
    const isStarred = starredIds.has(Number(entry.aID));
    starBtn.innerHTML = isStarred
      ? '<i class="bi bi-star-fill"></i>'
      : '<i class="bi bi-star"></i>';
    starBtn.title = isStarred ? "Unstar" : "Star";
    starBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await toggleStar(entry.aID, !isStarred);
    });

    const title = document.createElement("h5");
    title.className = "card-title mb-1 as-highlightable";
    title.dataset.raw = entry.title || "Assignment";
    title.textContent = entry.title || "Assignment";

    const meta = document.createElement("div");
    meta.className = "as-meta";
    const ch = document.createElement("div");
    const chapterRaw = entry.chapter || "?";
    ch.innerHTML = `Chapter: <strong class="as-highlightable" data-raw="${escapeAttr(
      chapterRaw
    )}">${escapeHtml(chapterRaw)}</strong>`;
    const fac = document.createElement("div");
    const facultyRaw = entry.faculty || "?";
    fac.innerHTML = `Faculty: <strong class="as-highlightable" data-raw="${escapeAttr(
      facultyRaw
    )}">${escapeHtml(facultyRaw)}</strong>`;
    meta.append(ch, fac);

    body.append(title, meta);

    const footer = document.createElement("div");
    footer.className = "card-footer bg-transparent border-0 as-actions";

    // Score + progress
    const score = sc.score,
      maxScore = sc.maxScore;
    const pct = totalQ ? Math.round((attempted / totalQ) * 100) : 0;

    const info = document.createElement("div");
    info.className =
      "d-flex align-items-center justify-content-between flex-wrap gap-2 mb-2";
    const scoreSpan = document.createElement("span");
    scoreSpan.className = "as-score";
    scoreSpan.innerHTML =
      typeof score === "number" && typeof maxScore === "number"
        ? `<span class=\"badge bg-primary\">${score} / ${maxScore}</span>`
        : `<span class=\"badge bg-secondary\">-</span>`;

    info.append(scoreSpan);

    const progressWrap = document.createElement("div");
    progressWrap.className = "as-progress w-100";
    const barClass =
      statusClass === "completed"
        ? "bg-success"
        : statusClass === "started"
        ? "bg-info"
        : "bg-secondary";
    progressWrap.innerHTML = `<div class=\"progress\" role=\"progressbar\" aria-valuemin=\"0\" aria-valuemax=\"100\" aria-valuenow=\"${pct}\"><div class=\"progress-bar ${barClass}\" style=\"width:${pct}%\">${pct}% (${attempted}/${totalQ})</div></div>`;

    footer.append(info, progressWrap);

    card.append(starBtn, body, footer);

    // Entire card clickable (non-interactive areas)
    card.addEventListener("click", (e) => {
      if (e.target.closest("a, button, input, textarea, select, label")) return;
      window.location.href = `./assignment.html?aID=${encodeURIComponent(
        entry.aID
      )}`;
    });

    return card;
  }

  async function toggleStar(aID, makeStarred) {
    const hasToken = !!qbGetToken();
    if (!hasToken) {
      // Ask user to log in
      window.dispatchEvent(new Event("qbase:force-login"));
      return;
    }
    const id = Number(aID);
    try {
      if (makeStarred) {
        const r = await authFetch(`${API_BASE}/api/starred/${id}`, { method: "POST" });
        if (!r.ok) throw new Error("star failed");
        starredIds.add(id);
      } else {
        const r = await authFetch(`${API_BASE}/api/starred/${id}`, { method: "DELETE" });
        if (!r.ok) throw new Error("unstar failed");
        starredIds.delete(id);
      }
      // Rebuild to reflect updated stars
      buildCards(getFilteredData());
      filterVisibility(lastSearch);
      highlightElements(document, (els.search?.value || "").trim());
      checkEmpty();
    } catch (e) {
      console.error(e);
    }
  }

  // === utils ===
  function slug(s) {
    return String(s || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");
  }
  function extractNum(s) {
    const m = String(s || "").match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : Number.POSITIVE_INFINITY;
  }

  // === highlight helpers (same approach as worksheet index) ===
  function escapeAttr(s) {
    return String(s ?? "").replaceAll('"', "&quot;");
  }
  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text ?? "";
    return div.innerHTML;
  }
  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  const OPEN = "\u0001"; // sentinel that survives HTML-escape
  const CLOSE = "\u0002";

  function highlightText(raw, q) {
    if (!q) return escapeHtml(raw ?? "");
    const re = new RegExp(escapeRegExp(q), "ig");
    const marked = String(raw ?? "").replace(re, (m) => OPEN + m + CLOSE);
    // escape everything, then swap sentinels for <mark> tags
    return escapeHtml(marked)
      .split(OPEN)
      .join("<mark>")
      .split(CLOSE)
      .join("</mark>");
  }

  function highlightElements(root, q) {
    (root || document).querySelectorAll(".as-highlightable").forEach((el) => {
      const raw =
        el.dataset.raw ?? el.getAttribute("data-raw") ?? el.textContent ?? "";
      el.innerHTML = q ? highlightText(raw, q) : escapeHtml(raw);
    });
  }
})();
