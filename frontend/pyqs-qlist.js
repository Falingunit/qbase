// PYQs Question List view (sidebar + list with filters)
import { ensureConfig, fetchChapters, fetchQuestions } from './pyqs-common.js';

(async () => {
  await ensureConfig();
  const url = new URL(location.href);
  const examId = url.searchParams.get('exam');
  const subjectId = url.searchParams.get('subject');
  const chapterId = url.searchParams.get('chapter');
  if (!examId || !subjectId || !chapterId) { location.href = './pyqs.html'; return; }

  const els = {
    breadcrumb: document.getElementById('pyqs-breadcrumb'),
    search: document.getElementById('q-search'),
    searchClear: document.getElementById('q-search-clear'),
    sort: document.getElementById('q-sort'),
    yearsMenu: document.getElementById('f-years-menu'),
    statusMenu: document.getElementById('f-status-menu'),
    diffMenu: document.getElementById('f-diff-menu'),
    solBtn: document.getElementById('f-solution'),
    list: document.getElementById('q-list'),
    err: document.getElementById('q-error'),
    load: document.getElementById('q-loading'),
    empty: document.getElementById('q-empty'),
    count: document.getElementById('q-count'),
    title: document.getElementById('qview-title'),
    sub: document.getElementById('qview-sub'),
    backTop: document.getElementById('q-back-top'),
  };

  const SS_KEY = `pyqs:f:${examId}:${subjectId}:${chapterId}`;

  function loadSavedFilters() {
    try { const raw = sessionStorage.getItem(SS_KEY); if (raw) return JSON.parse(raw); } catch {}
    return { q: '', years: [], status: '', diff: '', hasSol: false, sort: 'index' };
  }
  function saveFilters(obj) { try { sessionStorage.setItem(SS_KEY, JSON.stringify(obj)); } catch {} }

  let filters = loadSavedFilters();

  // Breadcrumbs removed
  try { if (els.breadcrumb) els.breadcrumb.classList.add('d-none'); } catch {}

  // Back link (top-left)
  try { if (els.backTop) els.backTop.href = `./pyqs_chapters.html?exam=${encodeURIComponent(examId)}&subject=${encodeURIComponent(subjectId)}`; } catch {}

  // Show loading skeleton while fetching
  try {
    const host = els.load;
    const makeItem = () => {
      const row = document.createElement('div'); row.className = 'list-group-item bg-transparent border-0';
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
    host.innerHTML = '';
    for (let i = 0; i < 8; i++) host.appendChild(makeItem());
  } catch {}

  function parseYear(pyqInfo) {
    const m = String(pyqInfo || '').match(/(19|20)\d{2}/);
    return m ? Number(m[0]) : null;
  }
  function normDiff(d) {
    const s = String(d || '').toLowerCase();
    if (s.startsWith('e')) return 'easy';
    if (s.startsWith('m')) return 'medium';
    if (s.startsWith('h')) return 'hard';
    return '';
  }
  function statusFromState(st) {
    if (!st) return 'not-started';
    if (st.isAnswerEvaluated) {
      if (st.evalStatus === 'correct') return 'correct';
      if (st.evalStatus === 'partial') return 'partial';
      if (st.evalStatus === 'incorrect') return 'incorrect';
      return 'completed';
    }
    if (st.isAnswerPicked) return 'in-progress';
    return 'not-started';
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
    els.err.classList.remove('d-none'); els.err.textContent = 'Failed to load questions'; els.load.classList.add('d-none'); return;
  }

  // Try to fetch server state (ignore errors and auth)
  try {
    const r = await authFetch(`${API_BASE}/api/pyqs/state/${encodeURIComponent(examId)}/${encodeURIComponent(subjectId)}/${encodeURIComponent(chapterId)}`);
    if (r.ok) states = await r.json();
  } catch {}

  // Build Years menu from questions
  (function buildYearsMenu() {
    const set = new Set(); questions.forEach(q => { const y = parseYear(q.pyqInfo); if (y) set.add(y); });
    const years = Array.from(set).sort((a,b)=>b-a);
    els.yearsMenu.innerHTML = '';
    if (!years.length) { els.yearsMenu.innerHTML = '<div class="text-muted px-2">No year info</div>'; return; }
    years.forEach(y => {
      const id = `yr-${y}`; const wrap = document.createElement('div'); wrap.className='form-check';
      wrap.innerHTML = `<input class="form-check-input" type="checkbox" value="${y}" id="${id}"> <label class="form-check-label" for="${id}">${y}</label>`;
      const cb = wrap.querySelector('input'); cb.checked = filters.years.includes(y);
      cb.addEventListener('change', () => { const v = Number(cb.value); if (cb.checked) { if (!filters.years.includes(v)) filters.years.push(v); } else { filters.years = filters.years.filter(x=>x!==v); } saveFilters(filters); render(); });
      els.yearsMenu.appendChild(wrap);
    });
  })();

  // Sort menu
  els.sort?.querySelectorAll('.dropdown-menu .dropdown-item').forEach(a => {
    a.addEventListener('click', () => { filters.sort = a.dataset.sort || 'index'; saveFilters(filters); render(); });
  });
  // Status menu
  els.statusMenu?.querySelectorAll('.dropdown-item').forEach(a => {
    a.addEventListener('click', () => { filters.status = a.dataset.status || ''; saveFilters(filters); render(); });
  });
  // Difficulty menu
  els.diffMenu?.querySelectorAll('.dropdown-item').forEach(a => {
    a.addEventListener('click', () => { filters.diff = a.dataset.diff || ''; saveFilters(filters); render(); });
  });
  // Solution toggle
  els.solBtn?.addEventListener('click', () => { const on = els.solBtn.getAttribute('data-active') === '1'; const n = on ? '0':'1'; els.solBtn.setAttribute('data-active', n); els.solBtn.classList.toggle('btn-primary', n==='1'); filters.hasSol = (n==='1'); saveFilters(filters); render(); });

  // Search
  els.search.value = filters.q || '';
  els.search.addEventListener('input', () => { filters.q = els.search.value.trim().toLowerCase(); els.searchClear.classList.toggle('d-none', !filters.q); saveFilters(filters); render(); });
  els.searchClear.addEventListener('click', () => { els.search.value=''; filters.q=''; els.searchClear.classList.add('d-none'); saveFilters(filters); render(); });

  function applyFilters(list) {
    const f = filters; const q = f.q;
    let out = list.map((q, i) => ({ q, i }));
    if (q) out = out.filter(o => (o.q.qText||'').toLowerCase().includes(q));
    if (f.years.length) out = out.filter(o => { const y = parseYear(o.q.pyqInfo); return y && f.years.includes(y); });
    if (f.diff) out = out.filter(o => normDiff(o.q.diffuculty) === f.diff);
    if (f.hasSol) out = out.filter(o => (String(o.q?.solution?.sText||'').trim().length || String(o.q?.solution?.sImage||'').trim().length));
    if (f.status) out = out.filter(o => statusFromState(states[o.i]) === f.status || (f.status==='completed' && states[o.i]?.isAnswerEvaluated));

    // Sort
    out.sort((a,b) => {
      switch (f.sort) {
        case 'year-desc': return (parseYear(b.q.pyqInfo)||0) - (parseYear(a.q.pyqInfo)||0);
        case 'year-asc': return (parseYear(a.q.pyqInfo)||0) - (parseYear(b.q.pyqInfo)||0);
        case 'diff-desc': return diffRank(b.q) - diffRank(a.q);
        case 'diff-asc': return diffRank(a.q) - diffRank(b.q);
        default: return a.i - b.i;
      }
    });
    return out;
  }
  function diffRank(q) { const d = normDiff(q.diffuculty); if (d==='easy') return 1; if (d==='medium') return 2; if (d==='hard') return 3; return 0; }

  function sanitizeHtml(html) {
    try { return window.DOMPurify.sanitize(String(html||''), { ALLOWED_TAGS: ['b','i','em','strong','u','sup','sub','br','p','ul','ol','li','span','div','img','a','code','pre','blockquote','hr','table','thead','tbody','tr','td','th'], ALLOWED_ATTR: ['class','style','href','src','alt','title','width','height','loading','decoding','rel','target'] }); } catch { return String(html||''); }
  }
  // Incremental rendering state
  const INITIAL_RENDER = 60;
  const RENDER_BATCH = 60;
  let mappedCache = [];
  let renderLimit = INITIAL_RENDER;
  let observer = null;
  let sentinel = null;

  function teardownObserver() { try { if (observer) observer.disconnect(); } catch {} observer = null; }

  function ensureSentinel() {
    if (!sentinel) {
      sentinel = document.createElement('div');
      sentinel.id = 'q-list-sentinel';
      sentinel.className = 'text-center text-muted small py-3';
      sentinel.textContent = '';
    }
    if (!sentinel.isConnected) els.list.parentElement.appendChild(sentinel);
    return sentinel;
  }

  function itemForMapped({ q, i }, idxInMapped) {
    const item = document.createElement('a');
    item.href = '#'; item.className = 'list-group-item list-group-item-action bg-transparent text-light border-secondary-subtle';
    item.setAttribute('data-mapped-idx', String(idxInMapped));
    const yr = parseYear(q.pyqInfo); const st = statusFromState(states[i]);
    const icon = st==='correct'?'bi-check-lg text-success': st==='incorrect'?'bi-x-lg text-danger': st==='partial'?'bi-dash-lg text-warning': st==='in-progress'?'bi-pencil text-info': 'bi-circle text-secondary';
    const qhtml = sanitizeHtml(q.qText || '').replace(/\r\n|\r|\n/g,'<br>');
    item.innerHTML = `
      <div class="d-flex align-items-start gap-2">
        <div class="text-muted small" style="width:2ch;">${i+1}</div>
        <i class="bi ${icon}" aria-hidden="true"></i>
        <div class="flex-grow-1">
          <div class="pyq-qtext">${qhtml}</div>
          <div class="text-muted small">${escapeHtml(q.pyqInfo || '')}</div>
        </div>
        <div class="text-muted small">${yr || ''}</div>
      </div>`;
    try { if (window.renderMathInElement) window.renderMathInElement(item, { delimiters: [ { left: "$$", right: "$$", display: true }, { left: "$", right: "$", display: false }, { left: "\\(", right: "\\)", display: false }, { left: "\\[", right: "\\]", display: true } ], throwOnError:false, strict:'ignore' }); } catch {}
    item.addEventListener('click', (e) => {
      e.preventDefault();
      // Persist filters for assignment view
      saveFilters(filters);
      // We pass the index within the filtered array so assignment opens that one
      const u = new URL('./pyqs_assignment.html', location.href);
      u.searchParams.set('exam', examId); u.searchParams.set('subject', subjectId); u.searchParams.set('chapter', chapterId); u.searchParams.set('q', String(idxInMapped+1));
      location.href = u.toString();
    });
    return item;
  }

  function renderNextBatch() {
    const from = els.list.children.length;
    const to = Math.min(renderLimit, mappedCache.length);
    if (from >= to) return;
    const frag = document.createDocumentFragment();
    for (let idx = from; idx < to; idx++) {
      const item = itemForMapped(mappedCache[idx], idx);
      frag.appendChild(item);
    }
    els.list.appendChild(frag);
  }

  function initObserver() {
    teardownObserver();
    const root = null; // window scroll
    const opts = { root, rootMargin: '600px 0px', threshold: 0 };
    observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        if (els.list.children.length < mappedCache.length) {
          renderLimit = Math.min(mappedCache.length, renderLimit + RENDER_BATCH);
          renderNextBatch();
        }
      }
    }, opts);
    observer.observe(ensureSentinel());
  }

  function render() {
    els.load.classList.add('d-none'); els.err.classList.add('d-none');
    mappedCache = applyFilters(questions);
    renderLimit = INITIAL_RENDER;
    els.count.classList.remove('d-none'); els.count.textContent = `Showing ${mappedCache.length} Qs (${questions.length} total)`;
    els.list.innerHTML = '';
    if (!mappedCache.length) { els.empty.classList.remove('d-none'); teardownObserver(); return; } else els.empty.classList.add('d-none');
    els.list.classList.add('fade-in');
    renderNextBatch();
    // Sentinel and observer
    const s = ensureSentinel();
    s.textContent = mappedCache.length > renderLimit ? 'Loading more…' : '';
    initObserver();
    // Title/sub line
    try { els.title.textContent = 'All PYQs'; els.sub.textContent = `${mappedCache.length} of ${questions.length} shown`; } catch {}
  }

  function escapeHtml(text) { const div = document.createElement('div'); div.textContent = text || ''; return div.innerHTML; }

  render();
})();
