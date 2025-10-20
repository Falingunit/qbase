// PYQs Chapters Page
// Refactored to separate logic/data (service) from DOM (view) for easier migration.

import { ensureConfig, refreshStarred, fetchExams, fetchSubjects, fetchChapters, toggleChapterStar } from './pyqs-service.js';
import { getEls, toggle, showError, clearError } from './pyqs-ui.js';
import { ensureLayout, showChaptersSkeleton, renderSidebarSubjects, renderChaptersView, hideBreadcrumb } from './pyqs-chapters.view.js';

(async () => {
  await ensureConfig();
  const els = getEls();

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
    if (!subjectId || !state.subjects.some(s => String(s.id) === String(subjectId))) subjectId = state.subjects[0]?.id;
    state.subject = state.subjects.find((s) => String(s.id) === String(subjectId)) || null;
    if (state.subject) { chaptersCache.set(state.subject.id, await fetchChapters(examId, state.subject.id)); }
    ensureLayout(els);
    render();
  } catch (e) {
    console.error(e); showError(els.error, 'Failed to load chapters.');
  } finally {
    toggle(els.loading, false); toggle(els.content, true);
  }

  window.addEventListener('qbase:login', async () => { try { await refreshStarred(); } catch {} render(); });
  window.addEventListener('qbase:logout', () => { render(); });

  function render() {
    hideBreadcrumb(els);
    renderSidebarSubjects(state, { onSelectSubject: onSelectSubject });
    const current = chaptersCache.get(state.subject?.id) || [];
    renderChaptersView(els, state, current, { onToggleStar: (chapter, make) => toggleChapterStar(examId, state.subject?.id, chapter.id, make).then(() => render()) });
  }

  async function onSelectSubject(s) {
    if (String(s.id) === String(state.subject?.id)) return;
    state.subject = s;
    const u = new URL(location.href); u.searchParams.set('subject', s.id); history.replaceState({}, '', u);
    if (!chaptersCache.has(s.id)) { showChaptersSkeleton(); toggle(els.loading, true); try { chaptersCache.set(s.id, await fetchChapters(examId, s.id)); } finally { toggle(els.loading, false); } }
    render();
  }
})();

