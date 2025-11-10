// PYQs Chapters Page
// Refactored to separate logic/data (service) from DOM (view) for easier migration.

import { ensureConfig, refreshStarredUnified, fetchExams, fetchSubjects, fetchChapters, toggleChapterStar, subjectOverview } from './pyqs-service.js';
import { cacheGet, cacheSet } from '../common/cache.js';
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
    await refreshStarredUnified();
    const exams = await fetchExams();
    state.exam = (exams || []).find((e) => String(e.id) === String(examId)) || { id: examId, name: 'Exam' };
    state.subjects = await fetchSubjects(examId);
    if (!subjectId || !state.subjects.some(s => String(s.id) === String(subjectId))) subjectId = state.subjects[0]?.id;
    state.subject = state.subjects.find((s) => String(s.id) === String(subjectId)) || null;
    if (state.subject) {
      // Cache-first: subject overview
      const ck = `subjectOverview:${examId}:${state.subject.id}`;
      const c = cacheGet(ck);
      if (c.hit && c.usable && c.data && Array.isArray(c.data.chapters)) {
        chaptersCache.set(state.subject.id, c.data.chapters);
        state._progressMap = c.data.progress || null;
        ensureLayout(els);
        render();
      }
      try {
        const ov = await subjectOverview(examId, state.subject.id);
        chaptersCache.set(state.subject.id, Array.isArray(ov?.chapters) ? ov.chapters : await fetchChapters(examId, state.subject.id));
        // Store progress map on state for passing to view
        state._progressMap = ov?.progress || null;
        cacheSet(ck, { chapters: chaptersCache.get(state.subject.id), progress: state._progressMap }, { ttlMs: 15*60*1000, swrMs: 24*60*60*1000 });
      } catch {
        chaptersCache.set(state.subject.id, await fetchChapters(examId, state.subject.id));
        state._progressMap = null;
      }
    }
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
    renderChaptersView(els, state, current, { onToggleStar: (chapter, make) => toggleChapterStar(examId, state.subject?.id, chapter.id, make), progressMap: state._progressMap });
  }

  async function onSelectSubject(s) {
    if (String(s.id) === String(state.subject?.id)) return;
    state.subject = s;
    const u = new URL(location.href); u.searchParams.set('subject', s.id); history.replaceState({}, '', u);
    if (!chaptersCache.has(s.id)) {
      showChaptersSkeleton(); toggle(els.loading, true);
      try {
        // Cache-first
        const ck = `subjectOverview:${examId}:${s.id}`;
        const c = cacheGet(ck);
        if (c.hit && c.usable && c.data && Array.isArray(c.data.chapters)) {
          chaptersCache.set(s.id, c.data.chapters);
          state._progressMap = c.data.progress || null;
        }
        const ov = await subjectOverview(examId, s.id);
        chaptersCache.set(s.id, Array.isArray(ov?.chapters) ? ov.chapters : await fetchChapters(examId, s.id));
        state._progressMap = ov?.progress || null;
        cacheSet(ck, { chapters: chaptersCache.get(s.id), progress: state._progressMap }, { ttlMs: 15*60*1000, swrMs: 24*60*60*1000 });
      } catch {
        chaptersCache.set(s.id, await fetchChapters(examId, s.id));
        state._progressMap = null;
      } finally { toggle(els.loading, false); }
    } else { state._progressMap = null; }
    render();
  }
})();

