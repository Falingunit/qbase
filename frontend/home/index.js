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
        HomeService.fetchScores(),
        HomeService.fetchStarred(),
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
        fetch("./data/assignment_list.json", { cache: "no-store" }).then((r) => r.json()),
        HomeService.fetchScores(),
        HomeService.fetchStarred(),
      ]);
      allData = HomeService.normalizeAssignments(assignRes);
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
  // normalizeAssignments moved to HomeService
})();



