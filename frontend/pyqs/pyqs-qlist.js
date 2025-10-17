// PYQs Question List view (sidebar + list with filters)
import { ensureConfig, fetchQuestions } from "./pyqs-service.js";
import { buildYearsMenu, initQListView } from "./pyqs-qlist.view.js";

(async () => {
  await ensureConfig();
  const url = new URL(location.href);
  const examId = url.searchParams.get("exam");
  const subjectId = url.searchParams.get("subject");
  const chapterId = url.searchParams.get("chapter");
  if (!examId || !subjectId || !chapterId) {
    location.href = "./pyqs.html";
    return;
  }

  const els = {
    breadcrumb: document.getElementById("pyqs-breadcrumb"),
    search: document.getElementById("q-search"),
    searchClear: document.getElementById("q-search-clear"),
    sort: document.getElementById("q-sort"),
    yearsMenu: document.getElementById("f-years-menu"),
    statusMenu: document.getElementById("f-status-menu"),
    diffMenu: document.getElementById("f-diff-menu"),
    solBtn: document.getElementById("f-solution"),
    list: document.getElementById("q-list"),
    err: document.getElementById("q-error"),
    load: document.getElementById("q-loading"),
    empty: document.getElementById("q-empty"),
    count: document.getElementById("q-count"),
    title: document.getElementById("qview-title"),
    sub: document.getElementById("qview-sub"),
    backTop: document.getElementById("q-back-top"),
  };
  const PREF_URL = `${API_BASE}/api/pyqs/prefs/${encodeURIComponent(examId)}/${encodeURIComponent(subjectId)}/${encodeURIComponent(chapterId)}`;
  function defaultFilters() { return { q: '', years: [], status: '', diff: '', hasSol: false, sort: 'index' }; }
  async function loadServerFilters() {
    try { const r = await authFetch(PREF_URL); if (r.ok) { const obj = await r.json(); if (obj && typeof obj === 'object') return { ...defaultFilters(), ...obj }; } } catch {}
    return defaultFilters();
  }
  function saveServerFilters(obj) {
    try { authFetch(PREF_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefs: obj || {} }) }); } catch {}
  }

  let filters = await loadServerFilters();

  // Breadcrumbs removed
  try {
    if (els.breadcrumb) els.breadcrumb.classList.add("d-none");
  } catch {}

  // Back link (top-left)
  try {
    if (els.backTop)
      els.backTop.href = `./pyqs_chapters.html?exam=${encodeURIComponent(
        examId
      )}&subject=${encodeURIComponent(subjectId)}`;
  } catch {}

  // Show loading skeleton while fetching
  try {
    const host = els.load;
    const makeItem = () => {
      const row = document.createElement("div");
      row.className = "list-group-item bg-transparent border-0";
      row.innerHTML = `<div class="d-flex align-items-start gap-2">
        <div class="sk-skeleton sk-line" style="width:2ch;"></div>
        <div class="sk-skeleton sk-line" style="width:1.2rem;"></div>
        <div class="flex-grow-1">
          <div class="sk-skeleton sk-line sk-w-60"></div>
          <div class="sk-skeleton sk-line sk-w-30 mt-2"></div>
        </div>
        <div class="sk-skeleton sk-line" style="width:3ch;"></div>
      </div>`;
      return row;
    };
    host.innerHTML = "";
    for (let i = 0; i < 8; i++) host.appendChild(makeItem());
  } catch {}

  function parseYear(pyqInfo) {
    const m = String(pyqInfo || "").match(/(19|20)\d{2}/);
    return m ? Number(m[0]) : null;
  }
  function normDiff(d) {
    const s = String(d || "").toLowerCase();
    if (s.startsWith("1") || s.startsWith("e")) return "easy";
    if (s.startsWith("2") || s.startsWith("m")) return "medium";
    if (s.startsWith("3") || s.startsWith("h")) return "hard";
    return "";
  }
  function statusFromState(st) {
    if (!st) return "not-started";
    if (st.isAnswerEvaluated) {
      if (st.evalStatus === "correct") return "correct";
      if (st.evalStatus === "partial") return "partial";
      if (st.evalStatus === "incorrect") return "incorrect";
      return "completed";
    }
    if (st.isAnswerPicked) return "in-progress";
    return "not-started";
  }

  // Fetch questions + state
  let questions = [];
  let states = [];
  try {
    const [qs] = await Promise.all([
      fetchQuestions(examId, subjectId, chapterId),
    ]);
    questions = Array.isArray(qs) ? qs : [];
  } catch (e) {
    els.err.classList.remove("d-none");
    els.err.textContent = "Failed to load questions";
    els.load.classList.add("d-none");
    return;
  }

  // Try to fetch server state (ignore errors and auth)
  try {
    const r = await authFetch(
      `${API_BASE}/api/pyqs/state/${encodeURIComponent(
        examId
      )}/${encodeURIComponent(subjectId)}/${encodeURIComponent(chapterId)}`
    );
    if (r.ok) states = await r.json();
  } catch {}

  // Normalize persisted years to available set
  try {
    const avail = new Set();
    (questions || []).forEach((q) => { const y = parseYear(q.pyqInfo); if (y) avail.add(y); });
    if (Array.isArray(filters.years) && filters.years.length) {
      const next = filters.years.filter((y) => avail.has(y));
      if (next.length !== filters.years.length) { filters.years = next; saveServerFilters(filters); }
    }
  } catch {}
  // Build Years menu
  function rebuildYearsMenu() {
    try {
      buildYearsMenu(els, questions, filters, parseYear, () => {
        saveServerFilters(filters);
        render();
      });
    } catch {}
  }
  rebuildYearsMenu();

  // Sort menu
  function sortLabel(v) {
    switch (v) {
      case "year-desc": return "Year ↓";
      case "year-asc": return "Year ↑";
      case "diff-desc": return "Difficulty ↓";
      case "diff-asc": return "Difficulty ↑";
      default: return "Index";
    }
  }
  function updateSortUI() {
    try {
      const items = els.sort?.parentElement?.querySelectorAll(".dropdown-menu .dropdown-item");
      if (items) {
        items.forEach((a) => a.classList.toggle("active", (a.dataset.sort || "index") === (filters.sort || "index")));
      }
      if (els.sort) {
        els.sort.innerHTML = `<i class="bi bi-arrow-down-up"></i> ${sortLabel(filters.sort)}`;
      }
    } catch {}
  }
  const sortItems = els.sort?.parentElement?.querySelectorAll(".dropdown-menu .dropdown-item");
  sortItems?.forEach((a) => {
    a.addEventListener("click", () => {
      const next = a.dataset.sort || "index";
      if (filters.sort !== next) {
        filters.sort = next;
        saveServerFilters(filters);
        updateSortUI();
        render();
      }
    });
  });
  updateSortUI();

  // Helpers: filter state summary + clear
  function countActiveFilters(f) {
    let n = 0;
    if (f.q && f.q.length) n++;
    if (Array.isArray(f.years) && f.years.length) n++;
    if (f.status) n++;
    if (f.diff) n++;
    if (f.hasSol) n++;
    return n;
  }
  function syncFilterControlsFromFilters() {
    try {
      // Search
      if (els.search) {
        els.search.value = filters.q || "";
        els.searchClear?.classList.toggle("d-none", !filters.q);
      }
      // Years menu
      rebuildYearsMenu();
      // Status radios
      els.statusMenu?.querySelectorAll('input[type="radio"]').forEach((inp) => {
        inp.checked = String(inp.value || "") === String(filters.status || "");
      });
      // Diff radios
      els.diffMenu?.querySelectorAll('input[type="radio"]').forEach((inp) => {
        inp.checked = String(inp.value || "") === String(filters.diff || "");
      });
      // Solution toggle
      if (els.solBtn) {
        const n = filters.hasSol ? "1" : "0";
        els.solBtn.setAttribute("data-active", n);
        els.solBtn.classList.toggle("btn-primary", n === "1");
      }
      // Sort label
      updateSortUI();
    } catch {}
  }
  function clearFilters(keepSort = true) {
    const sort = filters.sort || "index";
    filters = { ...defaultFilters(), ...(keepSort ? { sort } : {}) };
    saveServerFilters(filters);
    syncFilterControlsFromFilters();
    render();
  }
  // Status menu (radio buttons)
  els.statusMenu?.querySelectorAll('input[type="radio"]').forEach((inp) => {
    if (String(inp.value || "") === String(filters.status || ""))
      inp.checked = true;
    inp.addEventListener("change", () => {
      if (inp.checked) {
        filters.status = inp.value || "";
        saveServerFilters(filters);
        render();
      }
    });
  });
  // Difficulty menu (radio buttons)
  els.diffMenu?.querySelectorAll('input[type="radio"]').forEach((inp) => {
    if (String(inp.value || "") === String(filters.diff || ""))
      inp.checked = true;
    inp.addEventListener("change", () => {
      if (inp.checked) {
        filters.diff = inp.value || "";
        saveServerFilters(filters);
        render();
      }
    });
  });
  // Solution toggle
  els.solBtn?.addEventListener("click", () => {
    const on = els.solBtn.getAttribute("data-active") === "1";
    const n = on ? "0" : "1";
    els.solBtn.setAttribute("data-active", n);
    els.solBtn.classList.toggle("btn-primary", n === "1");
    filters.hasSol = n === "1";
    saveServerFilters(filters);
    render();
  });

  // Search
  els.search.value = filters.q || "";
  els.search.addEventListener("input", () => {
    filters.q = els.search.value.trim().toLowerCase();
    els.searchClear.classList.toggle("d-none", !filters.q);
    saveServerFilters(filters);
    render();
  });
  els.searchClear.addEventListener("click", () => {
    els.search.value = "";
    filters.q = "";
    els.searchClear.classList.add("d-none");
    saveServerFilters(filters);
    render();
  });

  function applyFilters(list) {
    const f = filters;
    const q = f.q;
    let out = list.map((q, i) => ({ q, i }));
    if (q) out = out.filter((o) => (o.q.qText || "").toLowerCase().includes(q));
    if (f.years.length)
      out = out.filter((o) => {
        const y = parseYear(o.q.pyqInfo);
        return y && f.years.includes(y);
      });
    if (f.diff) out = out.filter((o) => normDiff(o.q.diffuculty) === f.diff);
    if (f.hasSol)
      out = out.filter(
        (o) =>
          String(o.q?.solution?.sText || "").trim().length ||
          String(o.q?.solution?.sImage || "").trim().length
      );
    if (f.status)
      out = out.filter(
        (o) =>
          statusFromState(states[o.i]) === f.status ||
          (f.status === "completed" && states[o.i]?.isAnswerEvaluated)
      );

    // Sort
    out.sort((a, b) => {
      switch (f.sort) {
        case "year-desc":
          return (parseYear(b.q.pyqInfo) || 0) - (parseYear(a.q.pyqInfo) || 0);
        case "year-asc":
          return (parseYear(a.q.pyqInfo) || 0) - (parseYear(b.q.pyqInfo) || 0);
        case "diff-desc":
          return diffRank(b.q) - diffRank(a.q);
        case "diff-asc":
          return diffRank(a.q) - diffRank(b.q);
        default:
          return a.i - b.i;
      }
    });
    return out;
  }
  function diffRank(q) {
    return q.diffuculty;
  }
  // sanitizeHtml moved to view
  const view = initQListView(els, {
    parseYear,
    getStatusForIndex: (i) => statusFromState(states[i]),
    renderMath: true,
    onItemClick: (idx) => {
      saveServerFilters(filters);
      const u = new URL("./pyqs_assignment.html", location.href);
      u.searchParams.set("exam", examId);
      u.searchParams.set("subject", subjectId);
      u.searchParams.set("chapter", chapterId);
      u.searchParams.set("q", String(idx + 1));
      location.href = u.toString();
    },
  });

  function render() {
    els.load.classList.add("d-none");
    els.err.classList.add("d-none");
    const mappedCache = applyFilters(questions);
    view.render(mappedCache, questions.length);
    // Title/sub line
    try {
      els.title.textContent = "All PYQs";
      const activeN = countActiveFilters(filters);
      const base = `${mappedCache.length} of ${questions.length} shown`;
      const badge = activeN ? ` <span class="badge bg-warning-subtle text-warning-emphasis ms-2">Filters ${activeN > 1 ? `(${activeN})` : "on"}</span> <a href="#" class="ms-2 link-warning q-clear-filters">Clear</a>` : "";
      els.sub.innerHTML = `${base}${badge}`;
    } catch {}
    // Also reflect on the count area below the toolbar
    try {
      if (els.count) {
        const activeN = countActiveFilters(filters);
        const base = `Showing ${mappedCache.length} Qs (${questions.length} total)`;
        const badge = activeN ? ` <span class="badge bg-warning-subtle text-warning-emphasis ms-2">Filters ${activeN > 1 ? `(${activeN})` : "on"}</span> <a href="#" class="ms-2 link-warning q-clear-filters">Clear</a>` : "";
        els.count.innerHTML = `${base}${badge}`;
        const bind = (root) => {
          root?.querySelectorAll('.q-clear-filters')?.forEach((a) => {
            a.addEventListener('click', (e) => { e.preventDefault(); clearFilters(true); });
          });
        };
        bind(els.count);
        bind(els.sub);
      }
    } catch {}
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text || "";
    return div.innerHTML;
  }

  render();
})();


