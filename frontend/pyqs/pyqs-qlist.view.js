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
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);
  const activeYears =
    Array.isArray(filters.years) && filters.years.length
      ? years.filter((y) => filters.years.includes(y))
      : years.slice();
  const startMin = activeYears.length ? Math.min(...activeYears) : minYear;
  const startMax = activeYears.length ? Math.max(...activeYears) : maxYear;

  els.yearsMenu.innerHTML = `
    <div class="pyqs-year-range">
      <div class="d-flex align-items-center justify-content-between gap-2 mb-2">
        <span class="small text-muted">Selected range</span>
        <button type="button" class="btn btn-sm btn-link py-0 px-0 text-warning pyqs-year-clear">Clear</button>
      </div>
      <div class="pyqs-year-range-values">
        <input
          class="form-control form-control-sm pyqs-year-value-input pyqs-year-value-min"
          type="number"
          min="${minYear}"
          max="${maxYear}"
          step="1"
          value="${startMin}"
          aria-label="Minimum year"
        >
        <input
          class="form-control form-control-sm pyqs-year-value-input pyqs-year-value-max"
          type="number"
          min="${minYear}"
          max="${maxYear}"
          step="1"
          value="${startMax}"
          aria-label="Maximum year"
        >
      </div>
      <div class="pyqs-year-slider-wrap">
        <div class="pyqs-year-slider-track">
          <div class="pyqs-year-slider-fill"></div>
        </div>
        <input class="form-range pyqs-year-range-input pyqs-year-range-min" type="range" min="${minYear}" max="${maxYear}" step="1" value="${startMin}">
        <input class="form-range pyqs-year-range-input pyqs-year-range-max" type="range" min="${minYear}" max="${maxYear}" step="1" value="${startMax}">
      </div>
      <div class="d-flex justify-content-between text-muted small mt-2">
        <span>${minYear}</span>
        <span>${maxYear}</span>
      </div>
    </div>
  `;

  const minEl = els.yearsMenu.querySelector(".pyqs-year-range-min");
  const maxEl = els.yearsMenu.querySelector(".pyqs-year-range-max");
  const minValueEl = els.yearsMenu.querySelector(".pyqs-year-value-min");
  const maxValueEl = els.yearsMenu.querySelector(".pyqs-year-value-max");
  const fill = els.yearsMenu.querySelector(".pyqs-year-slider-fill");
  const clearBtn = els.yearsMenu.querySelector(".pyqs-year-clear");

  const sync = (source) => {
    const clampYear = (value, fallback) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return fallback;
      return Math.min(maxYear, Math.max(minYear, Math.round(parsed)));
    };
    const isValueMin = source === "value-min";
    const isValueMax = source === "value-max";
    let lo = clampYear(
      isValueMin ? minValueEl?.value : minEl.value,
      Number(minEl.value) || minYear
    );
    let hi = clampYear(
      isValueMax ? maxValueEl?.value : maxEl.value,
      Number(maxEl.value) || maxYear
    );
    if (lo > hi) {
      if (source === "min" || isValueMin) hi = lo;
      else lo = hi;
    }
    minEl.value = String(lo);
    maxEl.value = String(hi);
    if (minValueEl) minValueEl.value = String(lo);
    if (maxValueEl) maxValueEl.value = String(hi);
    const left = ((lo - minYear) / Math.max(1, maxYear - minYear)) * 100;
    const right = ((hi - minYear) / Math.max(1, maxYear - minYear)) * 100;
    fill.style.left = `${left}%`;
    fill.style.width = `${right - left}%`;
    filters.years =
      lo === minYear && hi === maxYear
        ? []
        : years.filter((y) => y >= lo && y <= hi);
    onChange?.(filters);
  };

  minEl.addEventListener("input", () => sync("min"));
  maxEl.addEventListener("input", () => sync("max"));
  minValueEl?.addEventListener("change", () => sync("value-min"));
  maxValueEl?.addEventListener("change", () => sync("value-max"));
  els.yearsMenu.querySelectorAll(".pyqs-year-value-input").forEach((input) => {
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      sync(
        input.classList.contains("pyqs-year-value-min")
          ? "value-min"
          : "value-max"
      );
      input.blur();
    });
  });
  clearBtn?.addEventListener("click", () => {
    minEl.value = String(minYear);
    maxEl.value = String(maxYear);
    sync("clear");
  });
  sync("init");
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
