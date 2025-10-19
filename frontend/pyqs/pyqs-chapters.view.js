// View for PYQs chapters page
import { buildToolbar, checkEmpty, renderBackBtn, toggle } from "./pyqs-ui.js";
import {
  ICON_FALLBACK,
  CHAPTER_ICON_BASE,
  starredChapters,
  chKey,
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

  const layout = document.createElement("div");
  layout.className = "pyqs-layout mt-2";

  const side = document.createElement("aside");
  side.id = "pyqs-side";
  side.className = "pyqs-sidenav";
  side.innerHTML = `
      <div class="pyqs-exam card bg-body-tertiary border-0 mb-3">
        <div class="card-body d-flex align-items-center gap-2">
          <img id="pyqs-exam-icon" class="pyqs-exam-icon" alt="">
          <div>
            <div id="pyqs-exam-title" class="fw-semibold">Exam</div>
            <div id="pyqs-exam-sub" class="text-muted small"></div>
          </div>
        </div>
      </div>
      <nav><ul id="pyqs-subject-list" class="list-unstyled m-0 p-0"></ul></nav>
    `;

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
  const tabs = document.getElementById("pyqs-subject-tabs");
  if (tabs) tabs.remove();
  container.appendChild(backbar);
  container.appendChild(layout);
  layout.append(side, main);
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
  const ul = document.getElementById("pyqs-subject-list");
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
    }
  } catch {}
  try {
    if (examSub) examSub.textContent = `${state.subjects.length} subjects`;
  } catch {}

  ul.innerHTML = "";
  state.subjects.forEach((s) => {
    const li = document.createElement("li");
    const a = document.createElement("div");
    a.className =
      "pyqs-side-item" +
      (String(s.id) === String(state.subject?.id) ? " active" : "");
    const ico = document.createElement("img");
    ico.className = "ico";
    ico.alt = "";
    ico.loading = "lazy";
    ico.src = s.icon || ICON_FALLBACK;
    const nm = document.createElement("div");
    nm.className = "name";
    nm.textContent = s.name;
    const ch = document.createElement("i");
    ch.className = "chev bi bi-chevron-right";
    ch.setAttribute("aria-hidden", "true");
    a.append(ico, nm, ch);
    li.appendChild(a);
    a.addEventListener("click", () => onSelectSubject?.(s));
    ul.appendChild(li);
  });
}

export function renderChaptersView(els, state, chapters, { onToggleStar }) {
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
      list.forEach((ch) =>
        grid.appendChild(chapterCard(state, ch, { onToggleStar }))
      );

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
  const iconUrl =
    chapter.icon ||
    (chapter.icon_name ? CHAPTER_ICON_BASE + chapter.icon_name : ICON_FALLBACK);
  img.src = iconUrl;
  img.onerror = () => {
    img.src = ICON_FALLBACK;
  };
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
  card.appendChild(bar);

  // Asynchronously compute chapter progress under current saved filters
  try {
    updateChapterProgressBar(bar, state.exam.id, state.subject?.id, chapter.id);
  } catch {}
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
async function updateChapterProgressBar(host, examId, subjectId, chapterId) {
  try {
    const PREF_URL = `${API_BASE}/api/pyqs/prefs/${encodeURIComponent(
      examId
    )}/${encodeURIComponent(subjectId)}/${encodeURIComponent(chapterId)}`;
    const STATE_URL = `${API_BASE}/api/pyqs/state/${encodeURIComponent(
      examId
    )}/${encodeURIComponent(subjectId)}/${encodeURIComponent(chapterId)}`;
    const Q_URL = `${API_BASE}/api/pyqs/exams/${encodeURIComponent(
      examId
    )}/subjects/${encodeURIComponent(subjectId)}/chapters/${encodeURIComponent(
      chapterId
    )}/questions`;

    // Load filters (if unavailable, defaults to all)
    const defaultFilters = () => ({
      q: "",
      years: [],
      status: "",
      diff: "",
      hasSol: false,
      sort: "index",
    });
    let filters = defaultFilters();
    try {
      const r = await authFetch(PREF_URL);
      if (r?.ok) {
        const obj = await r.json();
        if (obj && typeof obj === "object") filters = { ...filters, ...obj };
      }
    } catch {}

    // Fetch questions + state concurrently
    const [qs, st] = await Promise.all([
      authFetch(Q_URL)
        .then((r) => (r && r.ok ? r.json() : []))
        .catch(() => []),
      authFetch(STATE_URL)
        .then((r) => (r && r.ok ? r.json() : []))
        .catch(() => []),
    ]);
    const questions = Array.isArray(qs) ? qs : [];
    const states = normalizeStates(st);

    // Apply filters similar to question list
    const parseYear = (pyqInfo) => {
      try {
        const m = String(pyqInfo || "").match(/(19|20)\d{2}/);
        return m ? Number(m[0]) : null;
      } catch {
        return null;
      }
    };
    const normDiff = (d) => {
      const s = String(d || "").toLowerCase();
      if (s.startsWith("1")) return "easy";
      if (s.startsWith("2")) return "medium";
      if (s.startsWith("3")) return "hard";
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

    // Map then filter
    let mapped = questions.map((q, i) => ({ q, i }));
    if (filters.q) {
      const qq = String(filters.q).trim().toLowerCase();
      mapped = mapped.filter((o) =>
        (o.q.qText || "").toLowerCase().includes(qq)
      );
    }
    if (Array.isArray(filters.years) && filters.years.length) {
      const set = new Set(filters.years);
      mapped = mapped.filter((o) => {
        const y = parseYear(o.q.pyqInfo);
        return y && set.has(y);
      });
    }
    if (filters.diff) {
      mapped = mapped.filter((o) => normDiff(o.q.diffuculty) === filters.diff);
    }
    if (filters.hasSol) {
      mapped = mapped.filter(
        (o) =>
          String(o.q?.solution?.sText || "").trim().length ||
          String(o.q?.solution?.sImage || "").trim().length
      );
    }
    if (filters.status) {
      mapped = mapped.filter((o) => {
        const s = statusFromState(states[o.i]);
        return (
          s === filters.status ||
          (filters.status === "completed" && states[o.i]?.isAnswerEvaluated)
        );
      });
    }

    const total = mapped.length || 0;
    let green = 0,
      red = 0,
      grey = 0;
    if (total > 0) {
      for (const o of mapped) {
        const s = statusFromState(states[o.i]);
        if (s === "correct") green++;
        else if (s === "incorrect" || s === "partial") red++;
        else grey++; // includes not-started and in-progress
      }
    } else {
      // No questions after filters — show empty grey bar
      grey = 1; // width 100%
    }

    const gPct = total ? (green * 100) / total : 0;
    const rPct = total ? (red * 100) / total : 0;
    const grPct = total ? Math.max(0, 100 - gPct - rPct) : 100;

    const gEl = host.querySelector(".seg-green");
    const rEl = host.querySelector(".seg-red");
    const grEl = host.querySelector(".seg-grey");
    if (gEl) gEl.style.width = `${gPct.toFixed(2)}%`;
    if (rEl) rEl.style.width = `${rPct.toFixed(2)}%`;
    if (grEl) grEl.style.width = `${grPct.toFixed(2)}%`;

    try {
      host.title = total
        ? `${green} correct • ${red} incorrect • ${grey} pending (${total} in filter)`
        : "No questions in filter";
    } catch {}
  } catch (e) {
    // On error, keep default grey bar
    // Optionally set a tooltip
    try {
      host.title = "Progress unavailable";
    } catch {}
  }
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
