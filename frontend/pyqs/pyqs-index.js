// PYQs Index Page (Exams only)
// Refactored to separate logic/data (service) from DOM (view) for easier migration.

import { ensureConfig, refreshStarredUnified, toggleExamStar, fetchExams, starredExams } from './pyqs-service.js';
import { cacheGet, cacheSet } from '../common/cache.js';
import { getEls, toggle, showError, clearError } from './pyqs-ui.js';
import { hideBreadcrumb, renderExamsView } from './pyqs-index.view.js';

(async () => {
  await ensureConfig();

  const els = getEls();
  let cache = { exams: null };

  toggle(els.loading, true);
  clearError(els.error);
  try {
    // Cache-first render
    const c = cacheGet('exams');
    if (c.hit && c.usable && Array.isArray(c.data)) {
      cache.exams = c.data;
      renderExams(cache.exams);
    }
    await refreshStarredUnified();
    const exams = await fetchExams();
    cache.exams = exams;
    cacheSet('exams', exams, { ttlMs: 24*60*60*1000, swrMs: 7*24*60*60*1000 });
    renderExams(cache.exams);
  } catch (e) {
    console.error(e);
    showError(els.error, 'Failed to load PYQs.');
  } finally {
    toggle(els.loading, false);
    toggle(els.content, true);
  }

  window.addEventListener('qbase:login', async () => { try { await refreshStarredUnified(); } catch {} render(); });
  window.addEventListener('qbase:logout', () => { render(); });

  function render() { renderExams(cache.exams || []); }

  function renderExams(exams) {
    hideBreadcrumb(els);
    renderExamsView(els, exams, { onToggleStar: (id, make) => toggleExamStar(id, make) });
  }
})();

