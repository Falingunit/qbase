// View for PYQs chapters page
import { buildToolbar, checkEmpty, renderBackBtn, toggle } from "./pyqs-ui.js";
import {
  ICON_FALLBACK,
  CHAPTER_ICON_BASE,
  starredChapters,
  chKey,
  fetchQuestionsMetaSubject,
  fetchQuestionsMeta,
} from "./pyqs-service.js";

export function ensureLayout(els) {
  const container = document.querySelector(".pyqs-container");
  if (!container) return;
  if (container.querySelector(".pyqs-layout")) return;

  const backbar = document.createElement("div");
  backbar.id = "pyqs-backbar";
  backbar.className = "d-flex align-items-center gap-2 mt-2";
  const backBtn = renderBackBtn(() => {
    const u = new URL("./pyqs.html", location.href);
    location.href = u.toString();
  });
  backbar.appendChild(backBtn);

  // Remove any pre-existing subjects tabs placeholder
  const existingTabs = document.getElementById("pyqs-subject-tabs");
  if (existingTabs) existingTabs.remove();

  // Exam summary (icon + name) above tabs, replacing sidebar card
  const examCard = document.createElement("div");
  examCard.className = "pyqs-exam card bg-body-tertiary border-0 my-3";
  examCard.innerHTML = `
    <div class="card-body d-flex align-items-center gap-2">
      <img id="pyqs-exam-icon" class="pyqs-exam-icon" alt="">
      <div>
        <div id="pyqs-exam-title" class="fw-semibold">Exam</div>
        <div id="pyqs-exam-sub" class="text-muted small"></div>
      </div>
    </div>
  `;

  // Horizontal subject tabs
  const tabsWrap = document.createElement("nav");
  tabsWrap.className = "pyqs-tabs-wrap overflow-x-auto";
  const tabs = document.createElement("ul");
  tabs.id = "pyqs-subject-tabs";
  tabs.className = "nav nav-tabs flex-nowrap mb-3 rounded-top";
  tabsWrap.appendChild(tabs);

  const layout = document.createElement("div");
  layout.className = "pyqs-layout mt-2";

  const main = document.createElement("main");
  main.id = "pyqs-main";
  main.className = "flex-grow-1";
  const toolbar = document.getElementById("pyqs-toolbar");
  const loading = document.getElementById("pyqs-loading");
  const error = document.getElementById("pyqs-error");
  const starredWrap = document.getElementById("pyqs-starred-chapters-wrap");
  const content = document.getElementById("pyqs-content");
  const empty = document.getElementById("pyqs-empty");

  const countLine = document.createElement("div");
  countLine.id = "pyqs-count-line";
  countLine.className = "text-muted small mb-2 d-none";

  main.append(toolbar, loading, error, countLine, starredWrap, content, empty);

  const h1 = container.querySelector("h1");
  if (h1) h1.remove();
  container.appendChild(backbar);
  container.appendChild(examCard);
  container.appendChild(tabsWrap);
  container.appendChild(layout);
  layout.append(main);
}

export function showChaptersSkeleton(count = 8) {
  try {
    const host = document.getElementById("pyqs-content");
    if (!host) return;
    const grid = document.createElement("div");
    grid.className = "as-grid fade-in";
    for (let i = 0; i < count; i++) {
      const card = document.createElement("div");
      card.className = "card as-card pyqs-card h-100";
      const body = document.createElement("div");
      body.className = "card-body";
      const icoWrap = document.createElement("div");
      icoWrap.className = "pyqs-icon-wrap";
      const ico = document.createElement("div");
      ico.className = "sk-skeleton sk-ico";
      icoWrap.appendChild(ico);
      const info = document.createElement("div");
      info.className = "flex-grow-1";
      const ln1 = document.createElement("div");
      ln1.className = "sk-skeleton sk-line sk-w-60";
      const ln2 = document.createElement("div");
      ln2.className = "sk-skeleton sk-line sk-w-30 mt-2";
      info.append(ln1, ln2);
      body.append(icoWrap, info);
      card.appendChild(body);
      grid.appendChild(card);
    }
    host.innerHTML = "";
    host.appendChild(grid);
  } catch {}
}

export function renderSidebarSubjects(state, { onSelectSubject }) {
  // Render subjects as horizontal tabs (nav-pills)
  const ul = document.getElementById("pyqs-subject-tabs");
  const examTitle = document.getElementById("pyqs-exam-title");
  const examSub = document.getElementById("pyqs-exam-sub");
  const examIcon = document.getElementById("pyqs-exam-icon");
  if (!ul) return;
  try {
    if (examTitle) examTitle.textContent = state.exam?.name || "Exam";
  } catch {}
  try {
    if (examIcon && state.exam?.icon) {
      examIcon.src = state.exam.icon;
      examIcon.alt = (state.exam?.name || "") + " icon";
      examIcon.loading = "lazy";
      examIcon.decoding = "async";
      examIcon.onerror = () => { examIcon.onerror = null; examIcon.src = ICON_FALLBACK; };
    }
  } catch {}
  try {
    if (examSub) examSub.textContent = `${state.subjects.length} subjects`;
  } catch {}

  ul.innerHTML = "";
  state.subjects.forEach((s) => {
    const li = document.createElement("li");
    li.className = "nav-item";
    li.setAttribute("role", "presentation");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "nav-link d-flex align-items-center gap-2" +
      (String(s.id) === String(state.subject?.id) ? " active" : "");
    btn.title = s.name;
    btn.setAttribute("role", "tab");
    btn.setAttribute(
      "aria-selected",
      String(String(s.id) === String(state.subject?.id))
    );
    const ico = document.createElement("img");
    ico.className = "ico";
    ico.alt = "";
    ico.loading = "lazy";
    ico.decoding = "async";
    ico.src = s.icon || ICON_FALLBACK;
    ico.onerror = () => { ico.onerror = null; ico.src = ICON_FALLBACK; };
    const nm = document.createElement("span");
    nm.textContent = s.name;
    btn.append(ico, nm);
    btn.addEventListener("click", () => onSelectSubject?.(s));
    li.appendChild(btn);
    ul.appendChild(li);
  });
}

export function renderChaptersView(els, state, chapters, { onToggleStar, progressMap } = {}) {
  buildToolbar(
    els.toolbar,
    (ctx) => {
      const q = ctx.q;
      const list = [...(chapters || [])].filter((c) => {
        const hay = `${c.name}`.toLowerCase();
        return !q || hay.includes(q);
      });

      if (els.starredChaptersGrid && els.starredChaptersWrap) {
        els.starredChaptersGrid.innerHTML = "";
        const starredList = list.filter((ch) =>
          starredChapters.has(chKey(state.exam.id, state.subject?.id, ch.id))
        );
        if (starredList.length > 0) {
          starredList.forEach((ch) =>
            els.starredChaptersGrid.appendChild(
              chapterCard(state, ch, { onToggleStar })
            )
          );
          els.starredChaptersWrap.classList.remove("d-none");
          if (els.starredChaptersCount)
            els.starredChaptersCount.textContent = `(${starredList.length})`;
        } else {
          els.starredChaptersWrap.classList.add("d-none");
        }
      }

      const grid = document.createElement("div");
      grid.className = "as-grid fade-in";
      list.forEach((ch) => grid.appendChild(chapterCard(state, ch, { onToggleStar })));

      try {
        const line = document.getElementById("pyqs-count-line");
        if (line) {
          line.classList.remove("d-none");
          line.textContent = `Showing ${list.length} chapter${
            list.length === 1 ? "" : "s"
          }`;
        }
      } catch {}
      els.content.innerHTML = "";
      els.content.appendChild(grid);
      // Apply any provided progress immediately, then always fetch fresh
      try {
        if (progressMap && typeof progressMap === 'object') {
          applyProgressToBars(grid, progressMap);
        }
        fetchSubjectProgress(state.exam.id, state.subject?.id)
          .then((map) => applyProgressToBars(grid, map))
          .catch(() => {});
      } catch {}
      checkEmpty(els.content);
    },
    { onlySearch: true, placeholder: "Search chapters…", searchMaxWidth: 800 }
  );
}

export function hideBreadcrumb(els) {
  try {
    if (els.breadcrumb) els.breadcrumb.classList.add("d-none");
  } catch {}
}

export function setLoading(els, on) {
  toggle(els.loading, !!on);
}

function chapterCard(state, chapter, { onToggleStar }) {
  const card = document.createElement("div");
  card.className = "card as-card pyqs-card h-100";
  const body = document.createElement("div");
  body.className = "card-body";
  const icoWrap = document.createElement("div");
  icoWrap.className = "pyqs-icon-wrap";
  const img = document.createElement("img");
  img.className = "pyqs-icon";
  img.loading = "lazy";
  img.decoding = "async";
  const iconUrl =
    chapter.icon ||
    (chapter.icon_name ? CHAPTER_ICON_BASE + chapter.icon_name : ICON_FALLBACK);
  img.src = iconUrl;
  img.onerror = () => { img.onerror = null; img.src = ICON_FALLBACK; };
  icoWrap.appendChild(img);
  const info = document.createElement("div");
  info.className = "flex-grow-1";
  const title = document.createElement("h5");
  title.className = "pyqs-title";
  title.textContent = chapter.name;
  const sub = document.createElement("div");
  sub.className = "pyqs-sub";
  sub.textContent = `${Number(chapter.total_questions || 0)} PYQs`;
  info.append(title, sub);

  const starBtn = document.createElement("button");
  starBtn.type = "button";
  starBtn.className = "as-star-btn btn btn-sm btn-link p-0 m-0";
  const key = chKey(state.exam.id, state.subject?.id, chapter.id);
  const isStarred = starredChapters.has(key);
  starBtn.innerHTML = isStarred
    ? '<i class="bi bi-star-fill"></i>'
    : '<i class="bi bi-star"></i>';
  starBtn.title = isStarred ? "Unstar" : "Star";
  starBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onToggleStar?.(chapter, !isStarred);
  });
  if (isStarred) card.classList.add("as-starred");

  card.append(starBtn, body);
  body.append(icoWrap, info);

  // Progress bar (green-red-grey) flush at bottom
  const bar = document.createElement("div");
  bar.className = "pyqs-chapbar";
  bar.innerHTML =
    '<div class="seg seg-green" style="width:0%"></div><div class="seg seg-red" style="width:0%"></div><div class="seg seg-grey" style="width:100%"></div>';
  // Defer computing progress until visible; attach identifiers for lazy loader
  bar.dataset.examId = String(state.exam.id);
  bar.dataset.subjectId = String(state.subject?.id || "");
  bar.dataset.chapterId = String(chapter.id);
  bar.dataset.total = String(Number(chapter.total_questions || 0));
  card.appendChild(bar);

  // Progress is computed lazily by an IntersectionObserver
  card.addEventListener("click", () => {
    const url = new URL("./pyqs_questions.html", location.href);
    url.searchParams.set("exam", state.exam.id);
    url.searchParams.set("subject", state.subject?.id);
    url.searchParams.set("chapter", chapter.id);
    location.href = url.toString();
  });
  return card;
}

// -------- Helpers: fetch + compute progress per chapter (green/red/grey) --------
// Caches and concurrency limiter for state fetching
const _stateCache = new Map(); // key -> Promise<normalizedStates>
const _prefsCache = new Map(); // key -> Promise<prefs>
const _bulkPrefsCache = new Map(); // subjectKey -> Promise<{[chapterId]: prefs}>
const _bulkStateCache = new Map(); // subjectKey -> Promise<{[chapterId]: state[]}>
let _inFlight = 0;
const _queue = [];
const _MAX_CONCURRENT = 4;

function _schedule(task) {
  return new Promise((resolve, reject) => {
    const run = async () => {
      _inFlight++;
      try { resolve(await task()); } catch (e) { reject(e); }
      finally {
        _inFlight--;
        const next = _queue.shift();
        if (next) next();
      }
    };
    if (_inFlight < _MAX_CONCURRENT) run(); else _queue.push(run);
  });
}

async function fetchChapterStates(examId, subjectId, chapterId) {
  const key = `${examId}__${subjectId}__${chapterId}`;
  if (_stateCache.has(key)) return _stateCache.get(key);
  const p = _schedule(async () => {
    const url = `${API_BASE}/api/pyqs/state/${encodeURIComponent(examId)}/${encodeURIComponent(subjectId)}/${encodeURIComponent(chapterId)}`;
    const r = await authFetch(url).catch(() => null);
    const data = r && r.ok ? await r.json() : [];
    return normalizeStates(data);
  });
  _stateCache.set(key, p);
  return p;
}

async function fetchBulkPrefs(examId, subjectId) {
  const key = `${examId}__${subjectId}`;
  if (_bulkPrefsCache.has(key)) return _bulkPrefsCache.get(key);
  const p = _schedule(async () => {
    const url = `${API_BASE}/api/pyqs/prefs/${encodeURIComponent(examId)}/${encodeURIComponent(subjectId)}`;
    const r = await authFetch(url).catch(() => null);
    const data = r && r.ok ? await r.json() : {};
    return data && typeof data === 'object' ? data : {};
  });
  _bulkPrefsCache.set(key, p);
  return p;
}

async function fetchBulkStates(examId, subjectId) {
  const key = `${examId}__${subjectId}`;
  if (_bulkStateCache.has(key)) return _bulkStateCache.get(key);
  const p = _schedule(async () => {
    const url = `${API_BASE}/api/pyqs/state/${encodeURIComponent(examId)}/${encodeURIComponent(subjectId)}`;
    const r = await authFetch(url).catch(() => null);
    const data = r && r.ok ? await r.json() : {};
    return data && typeof data === 'object' ? data : {};
  });
  _bulkStateCache.set(key, p);
  return p;
}

async function updateChapterProgressBar(host, examId, subjectId, chapterId, totalQuestions) {
  try {
    const totalFallback = Math.max(0, Number(totalQuestions || 0)) || 0;

    // Try bulk prefs/states first (minimize requests); fall back to per-chapter when unavailable
    const [prefsMap, statesMap, metaMap] = await Promise.all([
      fetchBulkPrefs(examId, subjectId).catch(() => ({})),
      fetchBulkStates(examId, subjectId).catch(() => ({})),
      fetchQuestionsMetaSubject(examId, subjectId).catch(() => ({})),
    ]);
    const defaults = { q: "", years: [], status: "", diff: "", sort: "index" };
    let filters = { ...defaults, ...(prefsMap?.[chapterId] || {}) };
    let states = normalizeStates(statesMap?.[chapterId] || []);
    if (!Array.isArray(states) || states.length === 0) {
      try { states = await fetchChapterStates(examId, subjectId, chapterId); } catch { states = []; }
    }
    let questions = Array.isArray(metaMap?.[chapterId]) ? metaMap[chapterId] : null;
    if (!questions) {
      questions = await fetchQuestionsMeta(examId, subjectId, chapterId).catch(() => []);
    }

    const parseYear = (pyqInfo) => {
      try { const m = String(pyqInfo || "").match(/(19|20)\d{2}/); return m ? Number(m[0]) : null; } catch { return null; }
    };
    const normDiff = (d) => {
      const s = String(d || "").toLowerCase();
      if (s.startsWith("1") || s.startsWith("e")) return "easy";
      if (s.startsWith("2") || s.startsWith("m")) return "medium";
      if (s.startsWith("3") || s.startsWith("h")) return "hard";
      return "";
    };
    const statusFromState = (st) => {
      if (!st) return "not-started";
      if (st.isAnswerEvaluated) {
        if (st.evalStatus === "correct") return "correct";
        if (st.evalStatus === "partial") return "partial";
        if (st.evalStatus === "incorrect") return "incorrect";
        return "completed";
      }
      if (st.isAnswerPicked) return "in-progress";
      return "not-started";
    };

    let mapped = (Array.isArray(questions) ? questions : []).map((q, i) => ({ q, i }));
    if (filters.q) {
      const qq = String(filters.q).trim().toLowerCase();
      mapped = mapped.filter((o) => (o.q.qText || "").toLowerCase().includes(qq));
    }
    if (Array.isArray(filters.years) && filters.years.length) {
      const set = new Set(filters.years);
      mapped = mapped.filter((o) => { const y = parseYear(o.q.pyqInfo); return y && set.has(y); });
    }
    if (filters.diff) {
      mapped = mapped.filter((o) => normDiff(o.q.diffuculty) === filters.diff);
    }
    // hasSol filter removed
    if (filters.status) {
      mapped = mapped.filter((o) => {
        const s = statusFromState(states[o.i]);
        return s === filters.status || (filters.status === "completed" && states[o.i]?.isAnswerEvaluated);
      });
    }

    const total = mapped.length || 0;
    let green = 0, red = 0, grey = 0;
    if (total > 0) {
      for (const o of mapped) {
        const s = statusFromState(states[o.i]);
        if (s === "correct") green++;
        else if (s === "incorrect" || s === "partial") red++;
        else grey++;
      }
    } else {
      // when no match under filters, show 100% grey
      grey = 1;
    }

    const denom = total > 0 ? total : 1;
    const gPct = (green * 100) / denom;
    const rPct = (red * 100) / denom;
    const grPct = total > 0 ? Math.max(0, 100 - gPct - rPct) : 100;

    const gEl = host.querySelector(".seg-green");
    const rEl = host.querySelector(".seg-red");
    const grEl = host.querySelector(".seg-grey");
    if (gEl) gEl.style.width = `${gPct.toFixed(2)}%`;
    if (rEl) rEl.style.width = `${rPct.toFixed(2)}%`;
    if (grEl) grEl.style.width = `${grPct.toFixed(2)}%`;
    try { host.title = total ? `${green} correct • ${red} incorrect • ${grey} pending (${total} in filter)` : "No questions in filter"; } catch {}
  } catch (e) {
    try { host.title = "Progress unavailable"; } catch {}
  }
}

// Subject-level progress cache and applier
const _subjectProgressCache = new Map(); // exam__subject -> Promise<map>
async function fetchSubjectProgress(examId, subjectId) {
  const key = `${examId}__${subjectId}`;
  if (_subjectProgressCache.has(key)) return _subjectProgressCache.get(key);
  const p = _schedule(async () => {
    const url = `${API_BASE}/api/pyqs/progress/${encodeURIComponent(examId)}/${encodeURIComponent(subjectId)}`;
    const r = await authFetch(url).catch(() => null);
    const data = r && r.ok ? await r.json() : {};
    return data && typeof data === 'object' ? data : {};
  });
  _subjectProgressCache.set(key, p);
  return p;
}

function applyProgressToBars(container, progressMap) {
  try {
    container.querySelectorAll('.pyqs-chapbar').forEach((host) => {
      const chId = host.dataset.chapterId;
      const rec = progressMap?.[chId];
      const total = Math.max(0, Number(rec?.total || 0));
      const green = Math.max(0, Number(rec?.green || 0));
      const red = Math.max(0, Number(rec?.red || 0));
      const grey = Math.max(0, Number(rec?.grey || Math.max(0, total - green - red)));
      const denom = total > 0 ? total : 1;
      const gPct = (green * 100) / denom;
      const rPct = (red * 100) / denom;
      const grPct = total > 0 ? Math.max(0, 100 - gPct - rPct) : 100;
      const gEl = host.querySelector('.seg-green');
      const rEl = host.querySelector('.seg-red');
      const grEl = host.querySelector('.seg-grey');
      if (gEl) gEl.style.width = `${gPct.toFixed(2)}%`;
      if (rEl) rEl.style.width = `${rPct.toFixed(2)}%`;
      if (grEl) grEl.style.width = `${grPct.toFixed(2)}%`;
      try { host.title = total ? `${green} correct • ${red} incorrect • ${grey} pending (${total} in filter)` : 'No questions in filter'; } catch {}
    });
  } catch {}
}

function normalizeStates(raw) {
  // Accept array or sparse object keyed by original index
  if (Array.isArray(raw)) return raw;
  const out = [];
  if (raw && typeof raw === "object") {
    for (const k of Object.keys(raw)) {
      const idx = Number(k);
      if (!Number.isNaN(idx)) out[idx] = raw[k];
    }
  }
  return out;
}
