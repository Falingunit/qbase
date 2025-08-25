"use strict";
(async () => {
  await loadConfig();

  let allData = [];
  let cachedScores = {};
  let lastSearch = "";

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

  // Login hook mirrors initial load
  window.addEventListener("qbase:login", bootstrap);
  initApp();

  async function initApp() {
    toggle(els.loading, true);
    toggle(els.error, false);
    toggle(els.empty, false);
    toggle(els.content, false);

    try {
      const [assignRes, scores] = await Promise.all([
        fetch("./data/assignment_list.json").then((r) => r.json()),
        fetchScores(),
      ]);
      allData = assignRes || [];
      cachedScores = scores || {};
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

  async function fetchScores() {
    try {
      const r = await authFetch(`${API_BASE}/api/scores`);
      if (!r.ok) return {};
      return await r.json(); // { [aID]: {score,maxScore, attempted, totalQuestions} }
    } catch {
      return {};
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

    const title = document.createElement("h5");
    title.className = "card-title mb-1 as-highlightable";
    title.dataset.raw = entry.title || "Assignment";
    title.textContent = entry.title || "Assignment";

    const meta = document.createElement("div");
    meta.className = "as-meta";
    const ch = document.createElement("div");
    ch.innerHTML = `Chapter: <strong class="as-highlightable" data-raw="${escapeAttr(
      entry.chapter || "—"
    )}">${escapeHtml(entry.chapter || "—")}</strong>`;
    const fac = document.createElement("div");
    fac.innerHTML = `Faculty: <strong class="as-highlightable" data-raw="${escapeAttr(
      entry.faculty || "—"
    )}">${escapeHtml(entry.faculty || "—")}</strong>`;
    meta.append(ch, fac);

    const titleDiv = document.createElement("div");
    titleDiv.className = "d-flex justify-content-between"

    titleDiv.append(title)

    body.append(titleDiv, meta);

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
        ? `<span class="badge bg-primary">${score} / ${maxScore}</span>`
        : `<span class="badge bg-secondary">-</span>`;
    info.append(scoreSpan);
        
    const starBtn = document.createElement("button");
    starBtn.type = "button";
    starBtn.className = "btn p-0 ms-auto";
    starBtn.innerHTML = '<i class="bi bi-star text-warning"></i>';
    starBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const iconEl = starBtn.querySelector("i");
      toggleStar(iconEl, entry.aID);
    });

    titleDiv.append(starBtn)

    const progressWrap = document.createElement("div");
    progressWrap.className = "as-progress w-100";
    progressWrap.innerHTML = `<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div class="progress-bar ${
      statusClass === "completed" ? "bg-success" : "bg-success"
    }" style="width:${pct}%">${pct}% (${attempted}/${totalQ})</div></div>`;

    footer.append(info, progressWrap);

    card.dataset.starId = String(entry.aID);

    // Initialize star state from storage
    const starSet = new Set(
      JSON.parse(localStorage.getItem("starredAssignments") || "[]")
    );
    if (starSet.has(String(entry.aID))) {
      const iconEl = starBtn.querySelector("i");
      iconEl.classList.add("bi-star-fill");
      iconEl.classList.remove("bi-star");
      const sec = ensureStarSection();
      const grid = sec.querySelector(".as-grid");
      const clone = card.cloneNode(true);
      clone.dataset.starId = String(entry.aID);
      const cloneIcon = clone.querySelector(".bi-star, .bi-star-fill");
      if (cloneIcon) {
        cloneIcon.classList.add("bi-star-fill");
        cloneIcon.classList.remove("bi-star");
        const cloneBtn = cloneIcon.closest("button");
        (cloneBtn || cloneIcon).addEventListener("click", (e) => {
          e.stopPropagation();
          toggleStar(cloneIcon, String(entry.aID));
        });
      }
      clone.addEventListener("click", (e) => {
        if (e.target.closest("a, button, input, textarea, select, label")) return;
        window.location.href = `./assignment.html?aID=${encodeURIComponent(
          entry.aID
        )}`;
      });
      grid.appendChild(clone);
      updateStarSection(sec);
    }

    card.append(body, footer);

    // Entire card clickable (non-interactive areas)
    card.addEventListener("click", (e) => {
      if (e.target.closest("a, button, input, textarea, select, label")) return;
      window.location.href = `./assignment.html?aID=${encodeURIComponent(
        entry.aID
      )}`;
    });

    return card;
  }

  // === Starred assignments ===
  function ensureStarSection() {
    let sec = document.getElementById("as-starred");
    if (!sec) {
      sec = document.createElement("section");
      sec.id = "as-starred";
      sec.className = "as-subject";
      sec.innerHTML =
        '<div class="as-header"><button class="btn btn-sm btn-link as-toggle text-dark-emphasis fs-5" data-bs-toggle="collapse" data-bs-target="#as-starred-collapse" aria-controls="as-starred-collapse"><i class="bi bi-chevron-right"></i><span class="me-1">Starred</span> <span class="as-count">(0)</span></button></div>' +
        '<div id="as-starred-collapse" class="collapse show"><div class="as-grid"></div></div>';
      els.content.prepend(sec);
    }
    return sec;
  }

  function updateStarSection(sec) {
    const grid = sec.querySelector(".as-grid");
    const count = sec.querySelector(".as-count");
    if (count) count.textContent = `(${grid.querySelectorAll(".as-card").length})`;
    if (grid.children.length === 0) sec.remove();
  }

  function toggleStar(icon, id) {
    const key = "starredAssignments";
    const raw = localStorage.getItem(key);
    const set = new Set(raw ? JSON.parse(raw) : []);
    const strId = String(id);
    const card = icon.closest(".as-card");
    if (!card) return;
    card.dataset.starId = strId;

    const starred = set.has(strId);
    if (starred) {
      set.delete(strId);
      localStorage.setItem(key, JSON.stringify([...set]));
      const sec = document.getElementById("as-starred");
      sec?.querySelector(`.as-card[data-star-id="${strId}"]`)?.remove();
      if (sec) updateStarSection(sec);
    } else {
      set.add(strId);
      localStorage.setItem(key, JSON.stringify([...set]));
      const sec = ensureStarSection();
      const grid = sec.querySelector(".as-grid");
      const clone = card.cloneNode(true);
      clone.dataset.starId = strId;
      const cloneIcon = clone.querySelector(".bi-star, .bi-star-fill");
      if (cloneIcon) {
        const cloneBtn = cloneIcon.closest("button");
        (cloneBtn || cloneIcon).addEventListener("click", (e) => {
          e.stopPropagation();
          toggleStar(cloneIcon, strId);
        });
      }
      clone.addEventListener("click", (e) => {
        if (e.target.closest("a, button, input, textarea, select, label")) return;
        window.location.href = `./assignment.html?aID=${encodeURIComponent(
          strId
        )}`;
      });
      grid.appendChild(clone);
      updateStarSection(sec);
    }

    document
      .querySelectorAll(
        `.as-card[data-star-id="${strId}"] .bi-star, .as-card[data-star-id="${strId}"] .bi-star-fill`
      )
      .forEach((i) => {
        i.classList.toggle("bi-star-fill", set.has(strId));
        i.classList.toggle("bi-star", !set.has(strId));
      });
  }

  window.toggleStar = toggleStar;

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
