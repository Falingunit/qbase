// PYQs UI (DOM-only helpers)
// Contains DOM utilities and widget builders. No data fetching.

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

  const onlySearch = !!opts.onlySearch;

  const filterKeys = Object.keys(opts.filters || {});
  const filterSelects = {};
  let sortSel = null; let sortDir = (opts.sort?.defaultDir || "asc");
  let orderSel = null;

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

  const left = document.createElement("div");
  left.className = "d-flex flex-wrap align-items-center gap-2";
  const title = document.createElement("h2");
  title.textContent = opts.title || "";
  left.appendChild(title);

  const right = document.createElement("div");
  right.className = "d-flex flex-wrap align-items-center gap-2 ms-auto";
  right.appendChild(searchWrap);

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

  if (opts.sort) {
    const sortSelEl = document.createElement("select"); sortSelEl.className = "form-select"; sortSelEl.style.minWidth = "160px";
    for (const o of (opts.sort.options || [])) { const opt = document.createElement("option"); opt.value = o.value; opt.textContent = o.label; sortSelEl.appendChild(opt); }
    if (opts.sort.defaultKey) sortSelEl.value = opts.sort.defaultKey; sortSelEl.addEventListener("change", trigger);
    const dirBtn = document.createElement("button"); dirBtn.type = "button"; dirBtn.className = "btn btn-outline-secondary";
    const syncIcon = () => { dirBtn.innerHTML = sortDir === "asc" ? '<i class="bi bi-sort-down"></i>' : '<i class="bi bi-sort-up"></i>'; };
    syncIcon(); dirBtn.addEventListener("click", () => { sortDir = (sortDir === "asc" ? "desc" : "asc"); syncIcon(); trigger(); });
    right.append(sortSelEl, dirBtn);
    sortSel = sortSelEl;
  }

  if (Array.isArray(opts.order) && opts.order.length) {
    orderSel = document.createElement('select'); orderSel.className = 'form-select'; orderSel.style.minWidth = '160px';
    for (const o of opts.order) { const opt = document.createElement('option'); opt.value = o.value; opt.textContent = o.label; orderSel.appendChild(opt); }
    if (opts.orderDefault) orderSel.value = opts.orderDefault;
    orderSel.addEventListener('change', trigger);
    right.append(orderSel);
  }

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

