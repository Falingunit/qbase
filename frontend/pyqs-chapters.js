// PYQs Chapters Page
// This module powers frontend/pyqs_chapters.html. It renders the chapters grid
// for a given exam + subject. Clicking a chapter opens the dedicated questions page.

import {
  ensureConfig, getEls, toggle, showError, clearError,
  buildToolbar, checkEmpty, ICON_FALLBACK, CHAPTER_ICON_BASE,
  refreshStarred, starredChapters, chKey,
  fetchExams, fetchSubjects, fetchChapters,
  toggleChapterStar, renderBackBtn as _renderBackBtn,
} from './pyqs-common.js';

(async () => {
  await ensureConfig();
  const els = getEls();

  // Parse URL params
  const url = new URL(location.href);
  const examId = url.searchParams.get('exam');
  let subjectId = url.searchParams.get('subject');
  if (!examId) { location.href = './pyqs.html'; return; }

  let state = { exam: null, subjects: [], subject: null };
  const chaptersCache = new Map(); // subjectId -> chapters array

  toggle(els.loading, true); clearError(els.error);
  try {
    await refreshStarred();
    const exams = await fetchExams();
    state.exam = (exams || []).find((e) => String(e.id) === String(examId)) || { id: examId, name: 'Exam' };
    state.subjects = await fetchSubjects(examId);
    // Default to first subject if none provided or not found
    if (!subjectId || !state.subjects.some(s => String(s.id) === String(subjectId))) {
      subjectId = state.subjects[0]?.id;
    }
    state.subject = state.subjects.find((s) => String(s.id) === String(subjectId)) || null;
    if (state.subject) { chaptersCache.set(state.subject.id, await fetchChapters(examId, state.subject.id)); }
    ensureLayout();
    render();
  } catch (e) {
    console.error(e); showError(els.error, 'Failed to load chapters.');
  } finally {
    toggle(els.loading, false); toggle(els.content, true); checkEmpty(els.content);
  }

  window.addEventListener('qbase:login', async () => { try { await refreshStarred(); } catch {} render(); });
  window.addEventListener('qbase:logout', () => { starredChapters.clear(); render(); });

  function buildBreadcrumb() {
    // Breadcrumbs removed; hide if present
    try { if (els.breadcrumb) els.breadcrumb.classList.add('d-none'); } catch {}
  }

  // Restructure the page into sidebar + main if not already
  function ensureLayout() {
    const container = document.querySelector('.pyqs-container');
    if (!container) return;
    // Already laid out?
    if (container.querySelector('.pyqs-layout')) return;

    // Back button (top-left, above tabs/exam info)
    const backbar = document.createElement('div');
    backbar.id = 'pyqs-backbar';
    backbar.className = 'd-flex align-items-center gap-2 mt-2';
    const backBtn = _renderBackBtn(() => { const u = new URL('./pyqs.html', location.href); location.href = u.toString(); });
    backbar.appendChild(backBtn);

    const layout = document.createElement('div');
    layout.className = 'pyqs-layout';

    // Build sidebar skeleton
    const side = document.createElement('aside');
    side.id = 'pyqs-side';
    side.className = 'pyqs-sidenav';
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

    // Main: move existing blocks
    const main = document.createElement('main');
    main.id = 'pyqs-main';
    main.className = 'flex-grow-1';
    const toolbar = document.getElementById('pyqs-toolbar');
    const loading = document.getElementById('pyqs-loading');
    const error = document.getElementById('pyqs-error');
    const starredWrap = document.getElementById('pyqs-starred-chapters-wrap');
    const content = document.getElementById('pyqs-content');
    const empty = document.getElementById('pyqs-empty');

    const countLine = document.createElement('div');
    countLine.id = 'pyqs-count-line';
    countLine.className = 'text-muted small mb-2 d-none';

    main.append(toolbar, loading, error, countLine, starredWrap, content, empty);

    // Insert layout
    const h1 = container.querySelector('h1');
    if (h1) h1.remove();
    const tabs = document.getElementById('pyqs-subject-tabs');
    if (tabs) tabs.remove();
    container.appendChild(backbar);
    container.appendChild(layout);
    layout.append(side, main);
  }

  function showChaptersSkeleton(count = 8) {
    try {
      const host = document.getElementById('pyqs-content');
      if (!host) return;
      const grid = document.createElement('div'); grid.className = 'as-grid fade-in';
      for (let i = 0; i < count; i++) {
        const card = document.createElement('div'); card.className = 'card as-card pyqs-card h-100';
        const body = document.createElement('div'); body.className = 'card-body';
        const icoWrap = document.createElement('div'); icoWrap.className = 'pyqs-icon-wrap';
        const ico = document.createElement('div'); ico.className = 'sk-skeleton sk-ico'; icoWrap.appendChild(ico);
        const info = document.createElement('div'); info.className = 'flex-grow-1';
        const ln1 = document.createElement('div'); ln1.className = 'sk-skeleton sk-line sk-w-60';
        const ln2 = document.createElement('div'); ln2.className = 'sk-skeleton sk-line sk-w-30 mt-2';
        info.append(ln1, ln2);
        body.append(icoWrap, info); card.appendChild(body); grid.appendChild(card);
      }
      host.innerHTML = ''; host.appendChild(grid);
    } catch {}
  }

  function render(opts = {}) {
    buildBreadcrumb();
    renderSidebarSubjects();

    // Toolbar: search only (no sort/filters)
    buildToolbar(els.toolbar, (ctx) => {
      const q = ctx.q;
      const list = [...(chaptersCache.get(state.subject?.id) || [])]
        .filter((c) => { const hay = `${c.name}`.toLowerCase(); return !q || hay.includes(q); });

      // Starred section for current subject
      if (els.starredChaptersGrid && els.starredChaptersWrap) {
        els.starredChaptersGrid.innerHTML = '';
        const starredList = list.filter((ch) => starredChapters.has(chKey(examId, state.subject?.id, ch.id)));
        if (starredList.length > 0) {
          starredList.forEach((ch) => els.starredChaptersGrid.appendChild(chapterCard(ch)));
          els.starredChaptersWrap.classList.remove('d-none');
          if (els.starredChaptersCount) els.starredChaptersCount.textContent = `(${starredList.length})`;
        } else { els.starredChaptersWrap.classList.add('d-none'); }
      }

      const grid = document.createElement('div'); grid.className = 'as-grid fade-in';
      list.forEach((ch) => grid.appendChild(chapterCard(ch)));
      // Count line
      try {
        const line = document.getElementById('pyqs-count-line');
        if (line) { line.classList.remove('d-none'); line.textContent = `Showing ${list.length} chapter${list.length===1?'':'s'}`; }
      } catch {}
      els.content.innerHTML = ''; els.content.appendChild(grid); checkEmpty(els.content);
    }, { onlySearch: true, placeholder: 'Search chapters…', searchMaxWidth: 800 });
  }

  function renderSidebarSubjects() {
    const ul = document.getElementById('pyqs-subject-list');
    const examTitle = document.getElementById('pyqs-exam-title');
    const examSub = document.getElementById('pyqs-exam-sub');
    const examIcon = document.getElementById('pyqs-exam-icon');
    if (!ul) return;
    try { if (examTitle) examTitle.textContent = state.exam?.name || 'Exam'; } catch {}
    try { if (examIcon && state.exam?.icon) { examIcon.src = state.exam.icon; examIcon.alt = (state.exam?.name||'') + ' icon'; } } catch {}
    try { if (examSub) examSub.textContent = `${state.subjects.length} subjects`; } catch {}

    ul.innerHTML = '';
    state.subjects.forEach((s) => {
      const li = document.createElement('li');
      const a = document.createElement('div');
      a.className = 'pyqs-side-item' + (String(s.id) === String(state.subject?.id) ? ' active' : '');
      const ico = document.createElement('img'); ico.className = 'ico'; ico.alt=''; ico.loading='lazy'; ico.src = s.icon || ICON_FALLBACK;
      const nm = document.createElement('div'); nm.className = 'name'; nm.textContent = s.name;
      const ch = document.createElement('i'); ch.className = 'chev bi bi-chevron-right'; ch.setAttribute('aria-hidden','true');
      a.append(ico, nm, ch); li.appendChild(a);
      a.addEventListener('click', async () => {
        if (String(s.id) === String(state.subject?.id)) return;
        state.subject = s;
        const u = new URL(location.href); u.searchParams.set('subject', s.id); history.replaceState({}, '', u);
        if (!chaptersCache.has(s.id)) { showChaptersSkeleton(); toggle(els.loading, true); try { chaptersCache.set(s.id, await fetchChapters(examId, s.id)); } finally { toggle(els.loading, false); } }
        render();
      });
      ul.appendChild(li);
    });
  }

  function chapterCard(chapter) {
    const card = document.createElement('div'); card.className = 'card as-card pyqs-card h-100';
    const body = document.createElement('div'); body.className = 'card-body';
    const icoWrap = document.createElement('div'); icoWrap.className = 'pyqs-icon-wrap';
    const img = document.createElement('img'); img.className = 'pyqs-icon'; img.loading = 'lazy';
    const iconUrl = chapter.icon || (chapter.icon_name ? (CHAPTER_ICON_BASE + chapter.icon_name) : ICON_FALLBACK);
    img.src = iconUrl; img.onerror = () => { img.src = ICON_FALLBACK; }; icoWrap.appendChild(img);
    const info = document.createElement('div'); info.className = 'flex-grow-1';
    const title = document.createElement('h5'); title.className = 'pyqs-title'; title.textContent = chapter.name;
    const sub = document.createElement('div'); sub.className = 'pyqs-sub'; sub.textContent = `${Number(chapter.total_questions || 0)} PYQs`; info.append(title, sub);

    const starBtn = document.createElement('button'); starBtn.type = 'button'; starBtn.className = 'as-star-btn btn btn-sm btn-link p-0 m-0';
    const key = chKey(examId, state.subject?.id, chapter.id); const isStarred = starredChapters.has(key);
    starBtn.innerHTML = isStarred ? '<i class="bi bi-star-fill"></i>' : '<i class="bi bi-star"></i>';
    starBtn.title = isStarred ? 'Unstar' : 'Star';
    starBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); toggleChapterStar(examId, state.subject?.id, chapter.id, !isStarred).then(() => render()); });
    if (isStarred) card.classList.add('as-starred');

    card.append(starBtn, body); body.append(icoWrap, info);
    card.addEventListener('click', () => {
      const url = new URL('./pyqs_questions.html', location.href);
      url.searchParams.set('exam', examId);
      url.searchParams.set('subject', state.subject?.id);
      url.searchParams.set('chapter', chapter.id);
      location.href = url.toString();
    });
    return card;
  }
})();
