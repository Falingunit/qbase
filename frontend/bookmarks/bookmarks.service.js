// Bookmarks service: logic + data (no DOM)
(function(){
  // Simple in-memory caches to avoid re-fetching the same data during a session
  const _assignmentCache = new Map(); // key: Number(assignmentId) -> assignment data
  const _pyqsCache = new Map();       // key: `${examId}__${subjectId}__${chapterId}` -> { examId, subjectId, chapterId, questions }

  // Small utility to run async work with a concurrency cap
  async function _runWithConcurrency(items, limit, worker) {
    const arr = Array.from(items || []);
    if (arr.length === 0) return [];
    const results = new Array(arr.length);
    let idx = 0;
    const workers = new Array(Math.min(limit, arr.length)).fill(0).map(async () => {
      while (true) {
        const i = idx++;
        if (i >= arr.length) break;
        const item = arr[i];
        try {
          results[i] = await worker(item, i);
        } catch {
          results[i] = undefined;
        }
      }
    });
    await Promise.all(workers);
    return results;
  }
  async function fetchBookmarks() {
    const r = await authFetch(`${API_BASE}/api/bookmarks`, { cache: 'no-store' });
    if (!r.ok) {
      const err = new Error(`HTTP ${r.status}`);
      err.status = r.status;
      throw err;
    }
    return await r.json();
  }

  async function fetchPyqsBookmarks() {
    const r = await authFetch(`${API_BASE}/api/pyqs/bookmarks`, { cache: 'no-store' });
    if (!r.ok) {
      const err = new Error(`HTTP ${r.status}`);
      err.status = r.status;
      throw err;
    }
    return await r.json();
  }

  async function fetchAllBookmarks() {
    const [a, p] = await Promise.allSettled([fetchBookmarks(), fetchPyqsBookmarks()]);
    const out = [];
    if (a.status === 'fulfilled' && Array.isArray(a.value)) {
      for (const b of a.value) out.push({ kind: 'assignment', ...b });
    }
    if (p.status === 'fulfilled' && Array.isArray(p.value)) {
      for (const b of p.value) out.push({ kind: 'pyq', ...b });
    }
    return out;
  }

  function groupBookmarksByTag(bookmarks) {
    const grouped = {};
    for (const b of bookmarks) {
      const tagName = b.tagName;
      if (!grouped[tagName]) grouped[tagName] = [];
      grouped[tagName].push(b);
    }
    return grouped;
  }

  function normalizeAssignmentTitles(input) {
    const out = [];
    const pushItem = (raw) => {
      if (!raw || typeof raw !== 'object') return;
      const id = Number(raw.aID ?? raw.id ?? raw.assignmentId ?? raw.AID ?? raw.Aid);
      if (!Number.isFinite(id)) return;
      const title = String(raw.title ?? raw.name ?? raw.assignmentTitle ?? `Assignment ${id}`);
      out.push({ aID: id, title });
    };
    if (Array.isArray(input)) input.forEach(pushItem);
    else if (input && Array.isArray(input.assignments)) input.assignments.forEach(pushItem);
    else if (input && Array.isArray(input.items)) input.items.forEach(pushItem);
    else if (input && typeof input === 'object') {
      Object.values(input).forEach((arr) => { if (Array.isArray(arr)) arr.forEach(pushItem); });
    }
    return out;
  }

  async function fetchAssignmentTitlesMap() {
    const map = new Map();
    try {
      const raw = await (await fetch('./data/assignment_list.json', { cache: 'no-store' })).json();
      normalizeAssignmentTitles(raw).forEach((it) => map.set(Number(it.aID), it.title));
    } catch {}
    return map;
  }

  function processPassageQuestions(questions) {
    let currentPassage = null, currentPassageImage = null, currentPassageId = null, passageCounter = 1;
    questions.forEach((q) => {
      if (q.qType === 'Passage') {
        currentPassage = q.qText; currentPassageImage = q.image; currentPassageId = `P${passageCounter++}`; q.passageId = currentPassageId; q._isPassage = true;
      } else if (q.passageId === currentPassageId) {
        q.passage = currentPassage; q.passageImage = currentPassageImage;
      }
    });
  }

  async function fetchAssignmentDataForIds(ids) {
    // Prepare results map and determine which IDs are missing from cache
    const result = new Map();
    const allIds = Array.from(ids || []);
    const missing = [];
    for (const id of allIds) {
      const key = Number(id);
      if (_assignmentCache.has(key)) {
        result.set(key, _assignmentCache.get(key));
      } else {
        missing.push(key);
      }
    }

    // Fetch missing IDs with limited concurrency to speed up loads without overloading
    if (missing.length > 0) {
      const fetched = await _runWithConcurrency(missing, 8, async (key) => {
        const resp = await fetch(`./data/question_data/${key}/assignment.json`, { cache: 'no-store' });
        if (!resp.ok) return undefined;
        const data = await resp.json();
        try { processPassageQuestions(Array.isArray(data.questions) ? data.questions : []); } catch {}
        return { key, data };
      });

      for (const item of fetched) {
        if (!item) continue;
        _assignmentCache.set(item.key, item.data);
        result.set(item.key, item.data);
      }
    }

    return result;
  }

  function mkPyqsKey(examId, subjectId, chapterId) {
    return `${examId}__${subjectId}__${chapterId}`;
  }

  async function fetchPyqsDataForKeys(keys) {
    const result = new Map();
    const all = Array.from(keys || []);
    const missing = [];
    for (const k of all) {
      if (_pyqsCache.has(k)) {
        result.set(k, _pyqsCache.get(k));
      } else {
        missing.push(k);
      }
    }

    if (missing.length > 0) {
      const fetched = await _runWithConcurrency(missing, 6, async (key) => {
        const [examId, subjectId, chapterId] = String(key).split('__');
        const r = await authFetch(`${API_BASE}/api/pyqs/exams/${encodeURIComponent(examId)}/subjects/${encodeURIComponent(subjectId)}/chapters/${encodeURIComponent(chapterId)}/questions`);
        if (!r.ok) return undefined;
        const data = await r.json();
        const questions = Array.isArray(data?.questions) ? data.questions : (Array.isArray(data) ? data : []);
        return { key, value: { examId, subjectId, chapterId, questions } };
      });

      for (const item of fetched) {
        if (!item) continue;
        _pyqsCache.set(item.key, item.value);
        result.set(item.key, item.value);
      }
    }

    return result;
  }

  async function fetchQuestionState(assignmentId) {
    try {
      const r = await authFetch(`${API_BASE}/api/state/${assignmentId}`);
      if (!r.ok) return [];
      return await r.json();
    } catch { return []; }
  }

  async function fetchPyqsQuestionState(examId, subjectId, chapterId) {
    try {
      const r = await authFetch(`${API_BASE}/api/pyqs/state/${encodeURIComponent(examId)}/${encodeURIComponent(subjectId)}/${encodeURIComponent(chapterId)}`);
      if (!r.ok) return [];
      return await r.json();
    } catch { return []; }
  }

  async function saveNotes(assignmentId, states) {
    const r = await authFetch(`${API_BASE}/api/state/${assignmentId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: states }) });
    return r.ok;
  }

  async function savePyqsNotes(examId, subjectId, chapterId, states) {
    const r = await authFetch(`${API_BASE}/api/pyqs/state/${encodeURIComponent(examId)}/${encodeURIComponent(subjectId)}/${encodeURIComponent(chapterId)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: states }) });
    return r.ok;
  }

  async function removeBookmark(assignmentId, questionIndex, tagId) {
    try {
      const resp = await authFetch(`${API_BASE}/api/bookmarks/${assignmentId}/${questionIndex}/${tagId}`, { method: 'DELETE' });
      return resp.ok;
    } catch { return false; }
  }
  async function removePyqsBookmark(examId, subjectId, chapterId, questionIndex, tagId) {
    try {
      const resp = await authFetch(`${API_BASE}/api/pyqs/bookmarks/${encodeURIComponent(examId)}/${encodeURIComponent(subjectId)}/${encodeURIComponent(chapterId)}/${questionIndex}/${encodeURIComponent(tagId)}`, { method: 'DELETE' });
      return resp.ok;
    } catch { return false; }
  }
  async function deleteBookmarkTag(tagId) {
    try {
      const resp = await authFetch(`${API_BASE}/api/bookmark-tags/${tagId}`, { method: 'DELETE' });
      return resp.ok;
    } catch { return false; }
  }

  window.BookmarksService = { fetchBookmarks, fetchPyqsBookmarks, fetchAllBookmarks, groupBookmarksByTag, fetchAssignmentTitlesMap, fetchAssignmentDataForIds, mkPyqsKey, fetchPyqsDataForKeys, fetchQuestionState, fetchPyqsQuestionState, saveNotes, savePyqsNotes, removeBookmark, removePyqsBookmark, deleteBookmarkTag };
})();
