// View helpers for PYQs question list (DOM-only). No data fetching.
export function buildYearsMenu(els, questions, filters, parseYear, onChange) {
  const set = new Set();
  questions.forEach((q) => {
    const y = parseYear(q.pyqInfo);
    if (y) set.add(y);
  });
  const years = Array.from(set).sort((a, b) => b - a);
  els.yearsMenu.innerHTML = "";
  if (!years.length) {
    els.yearsMenu.innerHTML = '<div class="text-muted px-2">No year info</div>';
    return;
  }
  years.forEach((y) => {
    const id = `yr-${y}`;
    const wrap = document.createElement("div");
    wrap.className = "form-check";
    wrap.innerHTML = `<input class="form-check-input" type="checkbox" value="${y}" id="${id}"> <label class="form-check-label" for="${id}">${y}</label>`;
    const cb = wrap.querySelector("input");
    cb.checked = filters.years.includes(y);
    cb.addEventListener("change", () => {
      const v = Number(cb.value);
      if (cb.checked) {
        if (!filters.years.includes(v)) filters.years.push(v);
      } else {
        filters.years = filters.years.filter((x) => x !== v);
      }
      onChange?.(filters);
    });
    els.yearsMenu.appendChild(wrap);
  });
}

export function initQListView(
  els,
  { parseYear, getStatusForIndex, onItemClick, renderMath }
) {
  const INITIAL_RENDER = 60;
  const RENDER_BATCH = 60;
  let mappedCache = [];
  let renderLimit = INITIAL_RENDER;
  // Count of mapped question items rendered (excludes headers)
  let renderedCount = 0;
  let observer = null;
  let sentinel = null;

  try { els?.list?.classList?.add("pyqs-list"); } catch {}

  function teardownObserver() {
    try {
      if (observer) observer.disconnect();
    } catch {}
    observer = null;
  }
  function ensureSentinel() {
    if (!sentinel) {
      sentinel = document.createElement("div");
      sentinel.id = "q-list-sentinel";
      sentinel.className = "text-center text-muted small py-3";
      sentinel.textContent = "";
    }
    if (!sentinel.isConnected) els.list.parentElement.appendChild(sentinel);
    return sentinel;
  }
  function sanitizeHtml(html) {
    try {
      return window.DOMPurify.sanitize(String(html || ""), {
        ALLOWED_TAGS: [
          "b",
          "i",
          "em",
          "strong",
          "u",
          "sup",
          "sub",
          "br",
          "p",
          "ul",
          "ol",
          "li",
          "span",
          "div",
          "img",
          "a",
          "code",
          "pre",
          "blockquote",
          "hr",
          "table",
          "thead",
          "tbody",
          "tr",
          "td",
          "th",
        ],
        ALLOWED_ATTR: [
          "class",
          "style",
          "href",
          "src",
          "alt",
          "title",
          "width",
          "height",
          "loading",
          "decoding",
          "rel",
          "target",
        ],
      });
    } catch {
      return String(html || "");
    }
  }
  function itemForMapped({ q, i }, idxInMapped) {
    const item = document.createElement("a");
    item.href = "#";
    item.className =
      "list-group-item list-group-item-action bg-transparent text-light border-secondary-subtle pt-3";
    item.classList.add("anim-enter-fast");
    item.setAttribute("data-mapped-idx", String(idxInMapped));
    const yr = parseYear(q.pyqInfo);
    const st = getStatusForIndex(i);
    const icon =
      st === "correct"
        ? "bi-check-lg text-success"
        : st === "incorrect"
        ? "bi-x-lg text-danger"
        : st === "partial"
        ? "bi-dash-lg text-warning"
        : st === "in-progress"
        ? "bi-pencil text-info"
        : "bi-circle text-secondary";
    const qhtml = sanitizeHtml(q.qText || "");
    const color = q.diffuculty === 1 ? "success" : q.diffuculty === 2 ? "warning" : q.diffuculty === 3 ? "danger" : "info";
    const diffuculty = q.diffuculty === 1 ? "Easy" : q.diffuculty === 2 ? "Moderate" : q.diffuculty === 3 ? "Hard" : "-";
    item.innerHTML = `<div class="d-flex justify-content-between gap-2 pb-2">
      <div class="" style="width: 20px; height: 20px;">${i + 1}</div>
      <i class="bi ${icon}" aria-hidden="true"></i>
      <div class="flex-grow-1">
        <div class="pyq-qtext mb-3 lh-sm">${qhtml}</div>
        <div class="d-flex justify-content-between">
          <div class="text-muted small">${escapeHtml(q.pyqInfo || "")}</div>
          <div class="badge diff-bg-${color} fw-normal">${diffuculty}</div>
        </div>
      </div>
      <div class="text-muted small">${yr || ""}</div>
    </div>`;
    try {
      const imgs = item.querySelectorAll('img');
      imgs.forEach((im) => {
        im.loading = 'lazy';
        im.decoding = 'async';
        try { im.referrerPolicy = 'no-referrer'; } catch {}
        im.onerror = () => { im.onerror = null; im.style.display = 'none'; };
      });
    } catch {}
    try {
      if (renderMath && window.renderMathInElement)
        window.renderMathInElement(item, {
          delimiters: [
            { left: "$$", right: "$$", display: true },
            { left: "$", right: "$", display: false },
            { left: "\\(", right: "\\)", display: false },
            { left: "\\[", right: "\\]", display: true },
          ],
          throwOnError: false,
          strict: "ignore",
        });
    } catch {}
    item.addEventListener("click", (e) => {
      e.preventDefault();
      onItemClick?.(idxInMapped);
    });
    return item;
  }
  function yearHeader(y) {
    const h = document.createElement("div");
    h.className =
      "list-group-item text-white border-secondary-subtle q-year-header";
    h.textContent = y ? String(y) : "Unknown Year";
    return h;
  }
  function renderNextBatch() {
    const from = renderedCount;
    const to = Math.min(renderLimit, mappedCache.length);
    if (from >= to) return;
    const frag = document.createDocumentFragment();
    for (let idx = from; idx < to; idx++) {
      const curY = parseYear(mappedCache[idx].q.pyqInfo);
      const prevY =
        idx > 0 ? parseYear(mappedCache[idx - 1].q.pyqInfo) : undefined;
      if (idx === 0 || curY !== prevY) {
        frag.appendChild(yearHeader(curY));
      }
      frag.appendChild(itemForMapped(mappedCache[idx], idx));
    }
    els.list.appendChild(frag);
    renderedCount = to;
  }
  function initObserver() {
    teardownObserver();
    observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          if (renderedCount < mappedCache.length) {
            renderLimit = Math.min(
              mappedCache.length,
              renderLimit + RENDER_BATCH
            );
            renderNextBatch();
          }
        }
      },
      { root: null, rootMargin: "600px 0px", threshold: 0 }
    );
    observer.observe(ensureSentinel());
  }

  function render(mappedList, total) {
    mappedCache = mappedList || [];
    renderLimit = INITIAL_RENDER;
    renderedCount = 0;
    els.list.innerHTML = "";
    if (!mappedCache.length) {
      els.empty.classList.remove("d-none");
      els.count?.classList.add("d-none");
      teardownObserver();
      return;
    }
    els.empty.classList.add("d-none");
    els.list.classList.add("fade-in");
    els.count?.classList.remove("d-none");
    if (typeof total === "number")
      els.count.textContent = `Showing ${mappedCache.length} Qs (${total} total)`;
    renderNextBatch();
    const s = ensureSentinel();
    s.textContent = mappedCache.length > renderLimit ? "Loading more..." : "";
    initObserver();
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text || "";
    return div.innerHTML;
  }

  return { render };
}
