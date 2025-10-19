// PYQs Service (logic + data loading)
// Contains only non-DOM code to make view layers swappable later (e.g., React).

export const ICON_FALLBACK = "https://via.placeholder.com/48?text=%F0%9F%93%9A";
export const CHAPTER_ICON_BASE = "https://web.getmarks.app/icons/exam/";

// Live star sets (shared across pages via module live bindings)
export const starredExams = new Set(); // examId strings
export const starredChapters = new Set(); // `${examId}__${subjectId}__${chapterId}`
export const chKey = (examId, subjectId, chapterId) => `${examId}__${subjectId}__${chapterId}`;

// Ensure config is loaded (safe to call multiple times)
export async function ensureConfig() {
  try { await loadConfig(); } catch {}
}

export function isAuthenticated() { try { return !!qbGetToken(); } catch { return false; } }

export async function refreshStarred() {
  try {
    const [ex, ch] = await Promise.all([
      authFetch(`${API_BASE}/api/pyqs/starred/exams`).then(r => r.ok ? r.json() : []),
      authFetch(`${API_BASE}/api/pyqs/starred/chapters`).then(r => r.ok ? r.json() : []),
    ]);
    starredExams.clear(); (Array.isArray(ex) ? ex : []).forEach((id) => starredExams.add(String(id)));
    starredChapters.clear(); (Array.isArray(ch) ? ch : []).forEach((it) => starredChapters.add(chKey(it.examId, it.subjectId, it.chapterId)));
  } catch {}
}

export async function toggleExamStar(examId, makeStarred) {
  if (!isAuthenticated()) { window.dispatchEvent(new Event("qbase:force-login")); return; }
  try {
    if (makeStarred) {
      const r = await authFetch(`${API_BASE}/api/pyqs/starred/exams/${encodeURIComponent(examId)}`, { method: 'POST' });
      if (!r.ok) throw new Error('star exam failed'); starredExams.add(String(examId));
    } else {
      const r = await authFetch(`${API_BASE}/api/pyqs/starred/exams/${encodeURIComponent(examId)}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('unstar exam failed'); starredExams.delete(String(examId));
    }
  } catch (e) { console.error(e); }
}

export async function toggleChapterStar(examId, subjectId, chapterId, makeStarred) {
  if (!isAuthenticated()) { window.dispatchEvent(new Event("qbase:force-login")); return; }
  const key = chKey(examId, subjectId, chapterId);
  try {
    if (makeStarred) {
      const r = await authFetch(`${API_BASE}/api/pyqs/starred/chapters/${encodeURIComponent(examId)}/${encodeURIComponent(subjectId)}/${encodeURIComponent(chapterId)}`, { method: 'POST' });
      if (!r.ok) throw new Error('star chapter failed'); starredChapters.add(key);
    } else {
      const r = await authFetch(`${API_BASE}/api/pyqs/starred/chapters/${encodeURIComponent(examId)}/${encodeURIComponent(subjectId)}/${encodeURIComponent(chapterId)}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('unstar chapter failed'); starredChapters.delete(key);
    }
  } catch (e) { console.error(e); }
}

// Backend fetchers (simple shapes from the server)
export async function fetchExams() {
  const r = await authFetch(`${API_BASE}/api/pyqs/exams`); if (!r.ok) throw new Error(`exams: ${r.status}`); return await r.json();
}
export async function fetchSubjects(examId) {
  const r = await authFetch(`${API_BASE}/api/pyqs/exams/${encodeURIComponent(examId)}/subjects`); if (!r.ok) throw new Error(`subjects: ${r.status}`); return await r.json();
}
export async function fetchChapters(examId, subjectId) {
  const r = await authFetch(`${API_BASE}/api/pyqs/exams/${encodeURIComponent(examId)}/subjects/${encodeURIComponent(subjectId)}/chapters`); if (!r.ok) throw new Error(`chapters: ${r.status}`); return await r.json();
}
export async function fetchQuestions(examId, subjectId, chapterId) {
  const r = await authFetch(`${API_BASE}/api/pyqs/exams/${encodeURIComponent(examId)}/subjects/${encodeURIComponent(subjectId)}/chapters/${encodeURIComponent(chapterId)}/questions`); if (!r.ok) throw new Error(`questions: ${r.status}`); return await r.json();
}

