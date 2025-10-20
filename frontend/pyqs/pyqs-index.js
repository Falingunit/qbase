// PYQs Index Page (Exams only)
// Refactored to separate logic/data (service) from DOM (view) for easier migration.

import { ensureConfig, refreshStarred, toggleExamStar, fetchExams } from './pyqs-service.js';
import { getEls, toggle, showError, clearError } from './pyqs-ui.js';
import { hideBreadcrumb, renderExamsView } from './pyqs-index.view.js';

(async () => {
  await ensureConfig();

  const els = getEls();
  let cache = { exams: null };

  toggle(els.loading, true);
  clearError(els.error);
  try {
    await refreshStarred();
    const exams = await fetchExams();
    cache.exams = exams;
    renderExams(exams);
  } catch (e) {
    console.error(e);
    showError(els.error, 'Failed to load PYQs.');
  } finally {
    toggle(els.loading, false);
    toggle(els.content, true);
  }

  window.addEventListener('qbase:login', async () => { try { await refreshStarred(); } catch {} render(); });
  window.addEventListener('qbase:logout', () => { render(); });

  function render() { renderExams(cache.exams || []); }

  function renderExams(exams) {
    hideBreadcrumb(els);
    renderExamsView(els, exams, { onToggleStar: (id, make) => toggleExamStar(id, make).then(render) });
  }
})();

