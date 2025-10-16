// PYQs Index Page (Exams only)
// This module powers frontend/pyqs.html. It renders:
//  - Exam grid (with starred exams section)
// Clicking an exam navigates to the dedicated chapters page,
// where subjects are rendered as tabs.

import {
  ensureConfig, getEls, toggle, showError, clearError,
  buildToolbar, checkEmpty, ICON_FALLBACK,
  refreshStarred, starredExams, toggleExamStar,
  fetchExams, fetchSubjects,
  renderBackBtn as _renderBackBtn,
} from './pyqs-common.js';

(async () => {
  await ensureConfig();

  const els = getEls();
  let state = { view: 'exams' };
  let cache = { exams: null };

  // Init
  toggle(els.loading, true);
  clearError(els.error);
  try {
    await refreshStarred();
    const exams = await fetchExams();
    cache.exams = exams;

    // Always render exams; subjects are handled as tabs on the chapters page
    renderExams(exams);
  } catch (e) {
    console.error(e);
    showError(els.error, 'Failed to load PYQs.');
  } finally {
    toggle(els.loading, false);
    toggle(els.content, true);
    checkEmpty(els.content);
  }

  // Re-sync stars when auth changes
  window.addEventListener('qbase:login', async () => { try { await refreshStarred(); } catch {} render(); });
  window.addEventListener('qbase:logout', () => { starredExams.clear(); render(); });

  function render() {
    renderExams(cache.exams || []);
  }

  function buildBreadcrumb() {
    // Breadcrumbs removed in exams view
    try { if (els.breadcrumb) els.breadcrumb.classList.add('d-none'); } catch {}
  }

  function renderExams(exams) {
    state = { view: 'exams', exam: null };
    buildBreadcrumb();
    els.toolbar.innerHTML = '';

    // Toolbar: search
    buildToolbar(els.toolbar, ({ q }) => {
      els.content.innerHTML = '';

      // Starred section
      if (els.starredExamsWrap && els.starredExamsGrid) {
        els.starredExamsGrid.innerHTML = '';
        const starredList = exams.filter((e) => starredExams.has(e.id) && matchExam(e, q));
        if (starredList.length > 0) {
          starredList.forEach((it) => els.starredExamsGrid.appendChild(examCard(it)));
          els.starredExamsWrap.classList.remove('d-none');
          if (els.starredExamsCount) els.starredExamsCount.textContent = `(${starredList.length})`;
        } else {
          els.starredExamsWrap.classList.add('d-none');
        }
      }

      const grid = document.createElement('div'); grid.className = 'as-grid';
      exams.forEach((ex) => {
        const card = examCard(ex);
        //Searching
        const isVisible = matchExam(ex, q);
        card.classList.toggle('d-none', !isVisible);
        grid.appendChild(card);
      });
      els.content.appendChild(grid);
      checkEmpty(els.content);
    }, { title: 'Exams', placeholder: 'Search exams…' });
  }

  function matchExam(exam, q) { const hay = `${exam.name}`.toLowerCase(); return !q || hay.includes(q); }

  function examCard(exam) {
    const card = document.createElement('div'); card.className = 'card as-card pyqs-card h-100';
    if (starredExams.has(exam.id)) card.classList.add('as-starred');
    const body = document.createElement('div'); body.className = 'card-body';
    const icoWrap = document.createElement('div'); icoWrap.className = 'pyqs-icon-wrap';
    const img = document.createElement('img'); img.className = 'pyqs-icon'; img.loading = 'lazy'; img.src = exam.icon || ICON_FALLBACK; img.onerror = () => { img.src = ICON_FALLBACK; };
    icoWrap.appendChild(img);
    const info = document.createElement('div'); info.className = 'flex-grow-1';
    const title = document.createElement('h5'); title.className = 'pyqs-title'; title.textContent = exam.name;
    info.append(title);
    
    // Star button
    const starBtn = document.createElement('button');
    starBtn.type = 'button'; starBtn.className = 'as-star-btn btn btn-sm btn-link p-0 m-0';
    const isStarred = starredExams.has(exam.id);
    starBtn.innerHTML = isStarred ? '<i class="bi bi-star-fill"></i>' : '<i class="bi bi-star"></i>';
    starBtn.title = isStarred ? 'Unstar' : 'Star';
    starBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); toggleExamStar(exam.id, !isStarred).then(render); });
    if (isStarred) card.classList.add('as-starred');

    card.append(starBtn, body); body.append(icoWrap, info);

    card.addEventListener('click', () => {
      const url = new URL('./pyqs_chapters.html', location.href);
      url.searchParams.set('exam', exam.id);
      location.href = url.toString();
    });
    return card;
  }
})();
