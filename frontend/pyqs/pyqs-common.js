// PYQs Common Helpers
// Shared utilities, fetchers, and star-management across PYQs pages.
// All functions are self-contained and do not rely on global state besides
// config.js globals: API_BASE, qbGetToken, authFetch, and loadConfig.

export const ICON_FALLBACK = "https://via.placeholder.com/48?text=%F0%9F%93%9A";
export const CHAPTER_ICON_BASE = "https://web.getmarks.app/icons/exam/";

// Live star sets (shared across pages via module live bindings)
export const starredExams = new Set(); // examId strings
export const starredChapters = new Set(); // `${examId}__${subjectId}__${chapterId}`
export const chKey = (examId, subjectId, chapterId) => `${examId}__${subjectId}__${chapterId}`;

// Ensure config is loaded (safe to call multiple times)
export async function ensureConfig() {
  try { await loadConfig(); } catch {}
}

// DOM helpers
export function getEls() {
  return {
    loading: document.getElementById("pyqs-loading"),
    error: document.getElementById("pyqs-error"),
    empty: document.getElementById("pyqs-empty"),
    content: document.getElementById("pyqs-content"),
    starredExamsWrap: document.getElementById("pyqs-starred-wrap"),
    starredExamsGrid: document.getElementById("pyqs-starred"),
    starredExamsCount: document.getElementById("pyqs-starred-count"),
    starredChaptersWrap: document.getElementById("pyqs-starred-chapters-wrap"),
    starredChaptersGrid: document.getElementById("pyqs-starred-chapters"),
    starredChaptersCount: document.getElementById("pyqs-starred-chapters-count"),
    toolbar: document.getElementById("pyqs-toolbar"),
    breadcrumb: document.getElementById("pyqs-breadcrumb"),
  };
}

export function toggle(el, show) { if (!el) return; el.classList.toggle("d-none", !show); }
export function showError(elError, msg) { if (!elError) return; elError.textContent = msg || "Unexpected error"; toggle(elError, true); }
export function clearError(elError) { toggle(elError, false); }

// Small UI helpers
export function badge(text) {
  const el = document.createElement("span");
  el.className = "badge text-bg-secondary";
  el.textContent = text;
  return el;
}
export function escapeHtml(text) { const div = document.createElement("div"); div.textContent = text ?? ""; return div.innerHTML; }
export function debounce(fn, ms) { let t = 0; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; }
export function renderBackBtn(onClick) {
  const btn = document.createElement("a");
  btn.href = "#";
  btn.className = "topbar-back";
  btn.innerHTML = '<i class="bi bi-arrow-left" aria-hidden="true"></i><span class="visually-hidden">Back</span>';
  btn.addEventListener("click", (e) => { e.preventDefault(); onClick?.(); });
  return btn;
}
export function checkEmpty(elContent, selector = ".card:not(.d-none)") {
  const any = elContent?.querySelectorAll(selector).length > 0;
  const emptyEl = document.getElementById("pyqs-empty");
  toggle(emptyEl, !any);
}

// Toolbar builder (search + optional sort + optional filters)
export function buildToolbar(toolbarEl, onChange, opts = {}) {
  const wrap = toolbarEl;
  wrap.className = "pyqs-toolbar d-flex flex-wrap align-items-center justify-content-between gap-3";

  // Compact mode: only the search bar, left-aligned
  const onlySearch = !!opts.onlySearch;

  // Predeclare shared state so trigger() can safely reference them even in onlySearch mode
  const filterKeys = Object.keys(opts.filters || {});
  const filterSelects = {};
  let sortSel = null; let sortDir = (opts.sort?.defaultDir || "asc");
  let orderSel = null;

  // Search
  const searchWrap = document.createElement("div");
  searchWrap.className = "input-group mb-3";
  searchWrap.style.maxWidth = String(opts.searchMaxWidth || (onlySearch ? 800 : 720)) + "px";
  const pre = document.createElement("span");
  pre.className = "input-group-text";
  pre.innerHTML = '<i class="bi bi-search"></i>';
  const input = document.createElement("input");
  input.type = "text"; input.className = "form-control"; input.placeholder = opts.placeholder || "Search."; input.autocomplete = "off";
  const clear = document.createElement("button");
  clear.className = "btn btn-outline-secondary d-none"; clear.title = "Clear"; clear.innerHTML = '<i class="bi bi-x-lg"></i>';
  clear.addEventListener("click", () => { input.value = ""; clear.classList.add("d-none"); trigger(); input.focus(); });
  input.addEventListener("input", () => { clear.classList.toggle("d-none", !(input.value||"").trim()); debounce(trigger, 120)(); });
  searchWrap.append(pre, input, clear);

  if (onlySearch) {
    wrap.className = "pyqs-toolbar d-flex flex-wrap align-items-center gap-3";
    wrap.innerHTML = "";
    wrap.appendChild(searchWrap);
    trigger();
    return;
  }

  // Left: Title
  const left = document.createElement("div");
  left.className = "d-flex flex-wrap align-items-center gap-2";
  const title = document.createElement("h2");
  title.textContent = opts.title || "";
  left.appendChild(title);

  // Right: search + sort + filters + extras
  const right = document.createElement("div");
  right.className = "d-flex flex-wrap align-items-center gap-2 ms-auto";
  right.appendChild(searchWrap);

  // Filters (dropdowns) – expects opts.filters = { key: [values] }
  if (filterKeys.length) {
    for (const key of filterKeys) {
      const sel = document.createElement("select");
      sel.className = "form-select"; sel.style.minWidth = "140px"; sel.title = key;
      const def = document.createElement("option"); def.value = ""; def.textContent = key; sel.appendChild(def);
      for (const v of (opts.filters[key] || [])) { const o = document.createElement("option"); o.value = v; o.textContent = v; sel.appendChild(o); }
      sel.addEventListener("change", trigger);
      filterSelects[key] = sel; right.appendChild(sel);
    }
  }

  // Sort (single key + direction)
  if (opts.sort) {
    sortSel = document.createElement("select"); sortSel.className = "form-select"; sortSel.style.minWidth = "160px";
    for (const o of (opts.sort.options || [])) { const opt = document.createElement("option"); opt.value = o.value; opt.textContent = o.label; sortSel.appendChild(opt); }
    if (opts.sort.defaultKey) sortSel.value = opts.sort.defaultKey; sortSel.addEventListener("change", trigger);
    const dirBtn = document.createElement("button"); dirBtn.type = "button"; dirBtn.className = "btn btn-outline-secondary";
    const syncIcon = () => { dirBtn.innerHTML = sortDir === "asc" ? '<i class="bi bi-sort-down"></i>' : '<i class="bi bi-sort-up"></i>'; };
    syncIcon(); dirBtn.addEventListener("click", () => { sortDir = (sortDir === "asc" ? "desc" : "asc"); syncIcon(); trigger(); });
    right.append(sortSel, dirBtn);
  }

  // Order (single select for custom ordering)
  if (Array.isArray(opts.order) && opts.order.length) {
    orderSel = document.createElement('select'); orderSel.className = 'form-select'; orderSel.style.minWidth = '160px';
    for (const o of opts.order) { const opt = document.createElement('option'); opt.value = o.value; opt.textContent = o.label; orderSel.appendChild(opt); }
    if (opts.orderDefault) orderSel.value = opts.orderDefault;
    orderSel.addEventListener('change', trigger);
    right.append(orderSel);
  }

  // Extras on right
  if (opts.extrasRight) right.appendChild(opts.extrasRight);

  wrap.innerHTML = ""; wrap.append(left, right);
  trigger();

  function trigger() {
    const ctx = { q: (input.value || "").trim().toLowerCase() };
    if (sortSel) { ctx.sortKey = sortSel.value; ctx.sortDir = sortDir; }
    if (orderSel) { ctx.order = orderSel.value; }
    for (const key of filterKeys) ctx[key] = filterSelects[key]?.value || "";
    onChange(ctx || {});
  }
}

// Auth and stars
export function isAuthenticated() { try { return !!qbGetToken(); } catch { return false; } }

export async function refreshStarred() {
  try {
    const [ex, ch] = await Promise.all([
      authFetch(`${API_BASE}/api/pyqs/starred/exams`).then(r => r.ok ? r.json() : []),
      authFetch(`${API_BASE}/api/pyqs/starred/chapters`).then(r => r.ok ? r.json() : []),
    ]);
    starredExams.clear(); (Array.isArray(ex) ? ex : []).forEach((id) => starredExams.add(String(id)));
    starredChapters.clear(); (Array.isArray(ch) ? ch : []).forEach((it) => starredChapters.add(chKey(it.examId, it.subjectId, it.chapterId)));
  } catch {}
}

export async function toggleExamStar(examId, makeStarred) {
  if (!isAuthenticated()) { window.dispatchEvent(new Event("qbase:force-login")); return; }
  try {
    if (makeStarred) {
      const r = await authFetch(`${API_BASE}/api/pyqs/starred/exams/${encodeURIComponent(examId)}`, { method: 'POST' });
      if (!r.ok) throw new Error('star exam failed'); starredExams.add(String(examId));
    } else {
      const r = await authFetch(`${API_BASE}/api/pyqs/starred/exams/${encodeURIComponent(examId)}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('unstar exam failed'); starredExams.delete(String(examId));
    }
  } catch (e) { console.error(e); }
}

export async function toggleChapterStar(examId, subjectId, chapterId, makeStarred) {
  if (!isAuthenticated()) { window.dispatchEvent(new Event("qbase:force-login")); return; }
  const key = chKey(examId, subjectId, chapterId);
  try {
    if (makeStarred) {
      const r = await authFetch(`${API_BASE}/api/pyqs/starred/chapters/${encodeURIComponent(examId)}/${encodeURIComponent(subjectId)}/${encodeURIComponent(chapterId)}`, { method: 'POST' });
      if (!r.ok) throw new Error('star chapter failed'); starredChapters.add(key);
    } else {
      const r = await authFetch(`${API_BASE}/api/pyqs/starred/chapters/${encodeURIComponent(examId)}/${encodeURIComponent(subjectId)}/${encodeURIComponent(chapterId)}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('unstar chapter failed'); starredChapters.delete(key);
    }
  } catch (e) { console.error(e); }
}

// Backend fetchers (simple shapes from the server)
export async function fetchExams() {
  const r = await authFetch(`${API_BASE}/api/pyqs/exams`); if (!r.ok) throw new Error(`exams: ${r.status}`); return await r.json();
}
export async function fetchSubjects(examId) {
  const r = await authFetch(`${API_BASE}/api/pyqs/exams/${encodeURIComponent(examId)}/subjects`); if (!r.ok) throw new Error(`subjects: ${r.status}`); return await r.json();
}
export async function fetchChapters(examId, subjectId) {
  const r = await authFetch(`${API_BASE}/api/pyqs/exams/${encodeURIComponent(examId)}/subjects/${encodeURIComponent(subjectId)}/chapters`); if (!r.ok) throw new Error(`chapters: ${r.status}`); return await r.json();
}
export async function fetchQuestions(examId, subjectId, chapterId) {
  const r = await authFetch(`${API_BASE}/api/pyqs/exams/${encodeURIComponent(examId)}/subjects/${encodeURIComponent(subjectId)}/chapters/${encodeURIComponent(chapterId)}/questions`); if (!r.ok) throw new Error(`questions: ${r.status}`); return await r.json();
}
