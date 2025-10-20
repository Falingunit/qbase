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

// Unified starred loader
export async function refreshStarredUnified() {
  try {
    const r = await authFetch(`${API_BASE}/api/pyqs/starred`);
    if (r.ok) {
      const obj = await r.json();
      starredExams.clear(); (obj?.exams||[]).forEach((id)=>starredExams.add(String(id)));
      starredChapters.clear(); (obj?.chapters||[]).forEach((it)=>starredChapters.add(chKey(it.examId, it.subjectId, it.chapterId)));
    }
  } catch {}
}

// Backend fetchers (simple shapes from the server)
const _examsCache = { value: null, promise: null };
const _subjectsCache = new Map(); // examId -> { value, promise }
const _chaptersCache = new Map(); // examId__subjectId -> { value, promise }

export async function fetchExams() {
  if (_examsCache.value) return _examsCache.value;
  if (_examsCache.promise) return _examsCache.promise;
  _examsCache.promise = authFetch(`${API_BASE}/api/pyqs/exams`).then(async (r) => {
    if (!r.ok) throw new Error(`exams: ${r.status}`);
    const data = await r.json();
    _examsCache.value = data;
    _examsCache.promise = null;
    return data;
  }).catch((e) => { _examsCache.promise = null; throw e; });
  return _examsCache.promise;
}
export async function fetchSubjects(examId) {
  const key = String(examId);
  const node = _subjectsCache.get(key) || { value: null, promise: null };
  if (node.value) return node.value;
  if (node.promise) return node.promise;
  node.promise = authFetch(`${API_BASE}/api/pyqs/exams/${encodeURIComponent(examId)}/subjects`).then(async (r) => {
    if (!r.ok) throw new Error(`subjects: ${r.status}`);
    const data = await r.json();
    node.value = data; node.promise = null; _subjectsCache.set(key, node);
    return data;
  }).catch((e) => { node.promise = null; _subjectsCache.set(key, node); throw e; });
  _subjectsCache.set(key, node);
  return node.promise;
}
export async function fetchChapters(examId, subjectId) {
  const key = `${examId}__${subjectId}`;
  const node = _chaptersCache.get(key) || { value: null, promise: null };
  if (node.value) return node.value;
  if (node.promise) return node.promise;
  const url = `${API_BASE}/api/pyqs/exams/${encodeURIComponent(examId)}/subjects/${encodeURIComponent(subjectId)}/chapters`;
  node.promise = authFetch(url).then(async (r) => {
    if (!r.ok) throw new Error(`chapters: ${r.status}`);
    const data = await r.json();
    node.value = data; node.promise = null; _chaptersCache.set(key, node);
    return data;
  }).catch((e) => { node.promise = null; _chaptersCache.set(key, node); throw e; });
  _chaptersCache.set(key, node);
  return node.promise;
}
const _questionsCache = new Map(); // exam__subject__chapter -> { value, promise }
export async function fetchQuestions(examId, subjectId, chapterId) {
  const key = `${examId}__${subjectId}__${chapterId}`;
  const node = _questionsCache.get(key) || { value: null, promise: null };
  if (node.value) return node.value;
  if (node.promise) return node.promise;
  const url = `${API_BASE}/api/pyqs/exams/${encodeURIComponent(examId)}/subjects/${encodeURIComponent(subjectId)}/chapters/${encodeURIComponent(chapterId)}/questions`;
  node.promise = authFetch(url).then(async (r) => {
    if (!r.ok) throw new Error(`questions: ${r.status}`);
    const data = await r.json();
    node.value = data; node.promise = null; _questionsCache.set(key, node);
    return data;
  }).catch((e) => { node.promise = null; _questionsCache.set(key, node); throw e; });
  _questionsCache.set(key, node);
  return node.promise;
}

const _questionsMetaCache = new Map(); // exam__subject__chapter -> { value, promise }
export async function fetchQuestionsMeta(examId, subjectId, chapterId) {
  const key = `${examId}__${subjectId}__${chapterId}`;
  const node = _questionsMetaCache.get(key) || { value: null, promise: null };
  if (node.value) return node.value;
  if (node.promise) return node.promise;
  const url = `${API_BASE}/api/pyqs/exams/${encodeURIComponent(examId)}/subjects/${encodeURIComponent(subjectId)}/chapters/${encodeURIComponent(chapterId)}/questions?meta=1`;
  node.promise = authFetch(url).then(async (r) => {
    if (!r.ok) throw new Error(`questions(meta): ${r.status}`);
    const data = await r.json();
    node.value = data; node.promise = null; _questionsMetaCache.set(key, node);
    return data;
  }).catch((e) => { node.promise = null; _questionsMetaCache.set(key, node); throw e; });
  _questionsMetaCache.set(key, node);
  return node.promise;
}

// Bulk subject-level meta: { [chapterId]: [ { diffuculty, pyqInfo, qText } ] }
const _questionsMetaSubjectCache = new Map(); // exam__subject -> { value, promise }
export async function fetchQuestionsMetaSubject(examId, subjectId) {
  const key = `${examId}__${subjectId}`;
  const node = _questionsMetaSubjectCache.get(key) || { value: null, promise: null };
  if (node.value) return node.value;
  if (node.promise) return node.promise;
  const url = `${API_BASE}/api/pyqs/exams/${encodeURIComponent(examId)}/subjects/${encodeURIComponent(subjectId)}/questions-meta`;
  node.promise = authFetch(url).then(async (r) => {
    if (!r.ok) throw new Error(`questions-meta: ${r.status}`);
    const data = await r.json();
    node.value = data && typeof data === 'object' ? data : {}; node.promise = null; _questionsMetaSubjectCache.set(key, node);
    return node.value;
  }).catch((e) => { node.promise = null; _questionsMetaSubjectCache.set(key, node); throw e; });
  _questionsMetaSubjectCache.set(key, node);
  return node.promise;
}

// ---------- New optimized service calls ----------
export async function bootstrap(opts = {}) {
  const params = new URLSearchParams();
  if (opts.includeExams !== false) params.set('includeExams', '1');
  if (opts.exam) params.set('exam', String(opts.exam));
  if (opts.subject) params.set('subject', String(opts.subject));
  const url = `${API_BASE}/api/pyqs/bootstrap?${params.toString()}`;
  const r = await authFetch(url);
  if (!r.ok) throw new Error(`bootstrap: ${r.status}`);
  return await r.json();
}

export async function examOverview(examId, { includeCounts = false } = {}) {
  const url = `${API_BASE}/api/pyqs/exam-overview/${encodeURIComponent(examId)}?includeCounts=${includeCounts ? '1' : '0'}`;
  const r = await authFetch(url); if (!r.ok) throw new Error(`exam-overview: ${r.status}`); return await r.json();
}

export async function subjectOverview(examId, subjectId) {
  const url = `${API_BASE}/api/pyqs/subject-overview/${encodeURIComponent(examId)}/${encodeURIComponent(subjectId)}`;
  const r = await authFetch(url); if (!r.ok) throw new Error(`subject-overview: ${r.status}`); return await r.json();
}

export async function subjectProgress(examId, subjectId, chapters = []) {
  const params = new URLSearchParams(); if (Array.isArray(chapters) && chapters.length) params.set('chapters', chapters.join(','));
  const url = `${API_BASE}/api/pyqs/progress/${encodeURIComponent(examId)}/${encodeURIComponent(subjectId)}?${params.toString()}`;
  const r = await authFetch(url); if (!r.ok) throw new Error(`progress: ${r.status}`); return await r.json();
}

export async function questionsBundle(examId, subjectId, chapterId, { full = false, state = true, overlays = false } = {}) {
  const params = new URLSearchParams(); if (full) params.set('full', '1'); if (state) params.set('state', '1'); if (overlays) params.set('overlays', '1');
  const url = `${API_BASE}/api/pyqs/questions-bundle/${encodeURIComponent(examId)}/${encodeURIComponent(subjectId)}/${encodeURIComponent(chapterId)}?${params.toString()}`;
  const r = await authFetch(url); if (!r.ok) throw new Error(`q-bundle: ${r.status}`); return await r.json();
}

export async function overlaysGet(examId, subjectId) {
  const url = `${API_BASE}/api/pyqs/overlays/${encodeURIComponent(examId)}/${encodeURIComponent(subjectId)}`;
  const r = await authFetch(url); if (!r.ok) throw new Error(`overlays: ${r.status}`); return await r.json();
}

export async function overlaysBulk(body) {
  const r = await authFetch(`${API_BASE}/api/pyqs/overlays/bulk`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body||{}) });
  if (!r.ok) throw new Error(`overlays-bulk: ${r.status}`); return await r.json();
}


export async function prefsBulk(examId, subjectId, chaptersMap) {
  const r = await authFetch(`${API_BASE}/api/pyqs/prefs/bulk`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ examId, subjectId, chapters: chaptersMap||{} }) });
  if (!r.ok) throw new Error(`prefs-bulk: ${r.status}`); return await r.json();
}

export async function stateBulk(examId, subjectId, items) {
  const r = await authFetch(`${API_BASE}/api/pyqs/state/bulk`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ examId, subjectId, items: Array.isArray(items)?items:[] }) });
  if (!r.ok) throw new Error(`state-bulk: ${r.status}`); return await r.json();
}

export async function searchChapters(examId, subjectId, chapters, q) {
  const r = await authFetch(`${API_BASE}/api/pyqs/search/${encodeURIComponent(examId)}/${encodeURIComponent(subjectId)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chapters, q }) });
  if (!r.ok) throw new Error(`search: ${r.status}`); return await r.json();
}

