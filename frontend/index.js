"use strict";
(async () => {
  await loadConfig();

  // Cache for search + scores
  let allData = [];
  let cachedScores = {};
  let searchBound = false;
  let lastSearch = "";

  window.addEventListener("qbase:login", async () => {
    const data = await (await fetch("./data/assignment_list.json")).json();
    const scores = await fetchScores();
    cachedScores = scores;
    allData = data;
    // clear and rebuild
    document.querySelector("#chaptersTable tbody").innerHTML = "";
    buildTable(data, scores);
    setupSearchOnce();
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
      buildTable(data, scores);
      setupSearchOnce();
    });

  async function fetchScores() {
    try {
      const r = await authFetch(`${API_BASE}/api/scores`);
      if (!r.ok) return {};
      return await r.json(); // { [aID]: {score,maxScore} }
    } catch {
      return {};
    }
  }

  function highlightMatch(text) {
    if (!lastSearch) return text;
    const pattern = new RegExp(`(${escapeRegExp(lastSearch)})`, "gi");
    return text.replace(pattern, "<mark>$1</mark>");
  }

  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function buildTable(data, scores) {
    const tbody = document.querySelector("#chaptersTable tbody");
    tbody.innerHTML = "";

    data.forEach((entry) => {
      const s = scores?.[entry.aID]?.score;
      const m = scores?.[entry.aID]?.maxScore;
      const attempted = scores?.[entry.aID]?.attempted ?? 0;
      const totalQ =
        scores?.[entry.aID]?.totalQuestions ?? entry.totalQuestions ?? 0;
      const pct = totalQ ? Math.round((attempted / totalQ) * 100) : 0;

      const scoreBadge =
        typeof s === "number" && typeof m === "number"
          ? `<span class="badge bg-primary">${s} / ${m}</span>`
          : `<span class="badge bg-secondary">-</span>`;

      const tr = document.createElement("tr");
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
  }

  function setupSearchOnce() {
    if (searchBound) return;
    const input = document.getElementById("table-search-input");
    if (!input) return;

    input.addEventListener("input", () => {
      lastSearch = input.value.trim();
      const qLower = lastSearch.toLowerCase();
      const filtered = !qLower
        ? allData
        : allData.filter((e) => {
            const fields = [e.subject, e.chapter, e.faculty, e.title]
              .filter(Boolean)
              .join(" ")
              .toLowerCase();
            return fields.includes(qLower);
          });
      buildTable(filtered, cachedScores);
    });

    searchBound = true;
  }
})();
