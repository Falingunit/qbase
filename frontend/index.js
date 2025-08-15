"use strict";
(async () => {
  await loadConfig();

  window.addEventListener("qbase:login", async () => {
    const data = await (await fetch("./data/assignment_list.json")).json();
    const scores = await fetchScores();
    // clear and rebuild
    document.querySelector("#chaptersTable tbody").innerHTML = "";
    buildTable(data, scores);
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
      buildTable(data, scores);
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

  function buildTable(data, scores) {
    const tbody = document.querySelector("#chaptersTable tbody");

    data.forEach((entry, i) => {
      // top‐level row
      const tr = document.createElement("tr");
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

      tr.innerHTML = `
          <td data-open-assignment>${entry.subject}</td>
          <td data-open-assignment>${entry.chapter}</td>
          <td data-open-assignment>${entry.faculty}</td>
          <td data-open-assignment>${entry.title}</td>
          <td>${scoreBadge}</td>
          <td style="min-width:200px">
            <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}">
              <div class="progress-bar bg-success" style="width:${pct}%">${pct}% (${attempted}/${totalQ})</div>
            </div>
          </td>
        `;

      // clicking any of the data-open-assignment cells opens the assignment
      tr.querySelectorAll("[data-open-assignment]").forEach((td) => {
        td.style.cursor = "pointer";
        td.addEventListener("click", () => {
          window.location.href = `./assignment.html?aID=${entry.aID}`;
        });
      });

      tbody.appendChild(tr);
    });
  }
})();
