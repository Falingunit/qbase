// === index.js (drop-in replacement) ===
"use strict";
(async () => {
  await loadConfig();

  // Cache for search + scores + sorting
  let allData = [];
  let cachedScores = {};
  let searchBound = false;
  let lastSearch = "";
  let sortBound = false;
  let sortState = { key: "chapter", dir: "asc" }; // default sort within each subject

  window.addEventListener("qbase:login", async () => {
    const data = await (await fetch("./data/assignment_list.json")).json();
    const scores = await fetchScores();
    cachedScores = scores;
    allData = data;
    // clear and rebuild
    document.querySelector("#chaptersTable tbody").innerHTML = "";
    buildTable(data);
    setupSearchOnce();
    setupSortingOnce();
  });

  // Now you can use API_BASE in your fetch calls
  authFetch(`${API_BASE}/me`)
    .then((res) => res.json())
    .then((data) => {
      console.log("User data:", data);
    });

  fetch("./data/assignment_list.json")
    .then((res) => res.json())
    .then(async (data) => {
      const scores = await fetchScores();
      cachedScores = scores;
      allData = data;
      buildTable(data);
      setupSearchOnce();
      setupSortingOnce();
    });

  async function fetchScores() {
    try {
      const r = await authFetch(`${API_BASE}/api/scores`);
      if (!r.ok) return {};
      return await r.json(); // { [aID]: {score,maxScore, attempted, totalQuestions} }
    } catch {
      return {};
    }
  }

  function highlightMatch(text) {
    if (!lastSearch) return text;
    const pattern = new RegExp(`(${escapeRegExp(lastSearch)})`, "gi");
    return String(text).replace(pattern, "<mark>$1</mark>");
  }

  function escapeRegExp(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // ---- Sorting helpers ----
  function getScoreRatio(entry) {
    const s = cachedScores?.[entry.aID]?.score;
    const m = cachedScores?.[entry.aID]?.maxScore;
    if (typeof s === "number" && typeof m === "number" && m > 0) {
      return s / m; // 0..1
    }
    return -1; // missing scores go last on asc
  }

  function getProgressPct(entry) {
    const attempted = cachedScores?.[entry.aID]?.attempted ?? 0;
    const totalQ =
      cachedScores?.[entry.aID]?.totalQuestions ?? entry.totalQuestions ?? 0;
    return totalQ ? attempted / totalQ : -1;
  }

  function getSortVal(entry) {
    switch (sortState.key) {
      case "subject":
        return (entry.subject || "").toLowerCase();
      case "chapter":
        return (entry.chapter || "").toLowerCase();
      case "faculty":
        return (entry.faculty || "").toLowerCase();
      case "title":
      case "assignment":
        return (entry.title || "").toLowerCase();
      case "score":
        return getScoreRatio(entry);
      case "progress":
        return getProgressPct(entry);
      default:
        return (entry.chapter || "").toLowerCase();
    }
  }

  function compareEntries(a, b) {
    const va = getSortVal(a);
    const vb = getSortVal(b);

    // Numeric sort if both are numbers
    if (typeof va === "number" && typeof vb === "number") {
      return sortState.dir === "asc" ? va - vb : vb - va;
    }

    // String sort otherwise
    const res = String(va).localeCompare(String(vb), undefined, {
      numeric: true,
      sensitivity: "base",
    });
    return sortState.dir === "asc" ? res : -res;
  }

  function setupSortingOnce() {
    if (sortBound) return;
    const headers = document.querySelectorAll("#chaptersTable thead th");
    if (!headers.length) return;

    const keys = [
      "subject",
      "chapter",
      "faculty",
      "assignment",
      "score",
      "progress",
    ];
    headers.forEach((th, idx) => {
      const key = keys[idx];
      if (!key) return;
      th.classList.add("sortable");
      th.setAttribute("role", "button");
      th.dataset.sortKey = key;
      const label = th.textContent.trim();
      th.innerHTML = `${label} <span class="sort-indicator" aria-hidden="true"></span>`;
      th.addEventListener("click", () => {
        const k = th.dataset.sortKey;
        if (sortState.key === k) {
          sortState.dir = sortState.dir === "asc" ? "desc" : "asc";
        } else {
          sortState.key = k;
          sortState.dir = k === "score" || k === "progress" ? "desc" : "asc"; // sensible defaults
        }
        updateSortIndicators();
        // Rebuild using current filtered dataset
        const filtered = getFilteredData();
        buildTable(filtered);
      });
    });

    updateSortIndicators();
    sortBound = true;
  }

  function updateSortIndicators() {
    const headers = document.querySelectorAll(
      "#chaptersTable thead th.sortable"
    );
    headers.forEach((th) => {
      const span = th.querySelector(".sort-indicator");
      const active = th.dataset.sortKey === sortState.key;
      span.textContent = active ? (sortState.dir === "asc" ? "▲" : "▼") : "";
      th.setAttribute(
        "aria-sort",
        active ? (sortState.dir === "asc" ? "ascending" : "descending") : "none"
      );
    });
  }

  function getFilteredData() {
    const qLower = (lastSearch || "").toLowerCase();
    return !qLower
      ? allData
      : allData.filter((e) => {
          const fields = [e.subject, e.chapter, e.faculty, e.title]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return fields.includes(qLower);
        });
  }

  // ---- Grouped table builder ----
  function buildTable(data) {
    const tbody = document.querySelector("#chaptersTable tbody");
    tbody.innerHTML = "";

    // Group by subject
    const groups = new Map(); // subject -> entries[]
    for (const entry of data) {
      const subj = entry.subject || "(No subject)";
      if (!groups.has(subj)) groups.set(subj, []);
      groups.get(subj).push(entry);
    }

    // Sort subjects alphabetically
    const subjects = Array.from(groups.keys()).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );

    subjects.forEach((subject, idx) => {
      const entries = groups.get(subject).slice().sort(compareEntries);

      // Subject header row (collapsible)
      const hdr = document.createElement("tr");
      hdr.className = "table-group-header";
      hdr.innerHTML = `<th colspan="6"><button type="button" class="btn btn-link btn-sm px-0 toggle-subject" data-sidx="${idx}"><i class="bi bi-caret-down-fill me-1"></i>${subject} <span class="text-secondary small">(${entries.length})</span></button></th>`;
      tbody.appendChild(hdr);

      // Data rows
      entries.forEach((entry) => {
        const s = cachedScores?.[entry.aID]?.score;
        const m = cachedScores?.[entry.aID]?.maxScore;
        const attempted = cachedScores?.[entry.aID]?.attempted ?? 0;
        const totalQ =
          cachedScores?.[entry.aID]?.totalQuestions ??
          entry.totalQuestions ??
          0;
        const pct = totalQ ? Math.round((attempted / totalQ) * 100) : 0;

        const scoreBadge =
          typeof s === "number" && typeof m === "number"
            ? `<span class="badge bg-primary">${s} / ${m}</span>`
            : `<span class="badge bg-secondary">-</span>`;

        const tr = document.createElement("tr");
        tr.dataset.sidx = String(idx);
        tr.innerHTML = `
            <td data-open-assignment>${highlightMatch(entry.subject)}</td>
            <td data-open-assignment>${highlightMatch(entry.chapter)}</td>
            <td data-open-assignment>${highlightMatch(entry.faculty)}</td>
            <td data-open-assignment>${highlightMatch(entry.title)}</td>
            <td>${scoreBadge}</td>
            <td style="min-width:200px">
              <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}">
                <div class="progress-bar bg-success" style="width:${pct}%">${pct}% (${attempted}/${totalQ})</div>
              </div>
            </td>
          `;

        tr.querySelectorAll("[data-open-assignment]").forEach((td) => {
          td.style.cursor = "pointer";
          td.addEventListener("click", () => {
            window.location.href = `./assignment.html?aID=${entry.aID}`;
          });
        });

        tbody.appendChild(tr);
      });
    });

    // Bind collapse toggles
    tbody.querySelectorAll(".toggle-subject").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = btn.dataset.sidx;
        const isCollapsed = btn.classList.toggle("is-collapsed");
        // toggle icon
        const icon = btn.querySelector(".bi");
        if (icon)
          icon.className = `bi ${
            isCollapsed ? "bi-caret-right-fill" : "bi-caret-down-fill"
          } me-1`;
        // hide/show rows belonging to this subject index
        tbody.querySelectorAll(`tr[data-sidx="${idx}"]`).forEach((row) => {
          row.classList.toggle("d-none", isCollapsed);
        });
      });
    });
  }

  function setupSearchOnce() {
    if (searchBound) return;
    const input = document.getElementById("table-search-input");
    if (!input) return;

    input.addEventListener("input", () => {
      lastSearch = input.value.trim();
      const filtered = getFilteredData();
      buildTable(filtered);
    });

    searchBound = true;
  }
})();
