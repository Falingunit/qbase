// Assignment service: logic/data helpers (no DOM)
(function(){
  const bundleCache = new Map();

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  async function loadAssignmentBundle(aID){
    const key = String(aID);
    if (bundleCache.has(key)) return clone(bundleCache.get(key));
    const url = `${API_BASE}/api/assignment/${encodeURIComponent(aID)}/bootstrap`;
    const r = await authFetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    const data = await r.json();
    const bundle = {
      assignment: data?.assignment ?? { questions: [] },
      meta: data?.meta && typeof data.meta === 'object' ? data.meta : null,
      state: Array.isArray(data?.state) ? data.state : [],
      bookmarks: Array.isArray(data?.bookmarks) ? data.bookmarks : [],
      marks: Array.isArray(data?.marks) ? data.marks : [],
      tags: Array.isArray(data?.tags) ? data.tags : [],
    };
    bundleCache.set(key, bundle);
    return clone(bundle);
  }

  function invalidateAssignmentBundle(aID){
    bundleCache.delete(String(aID));
  }

  async function loadAssignment(aID){
    const bundle = await loadAssignmentBundle(aID);
    return bundle.assignment;
  }

  async function fetchState(aID){
    try { const res = await authFetch(`${API_BASE}/api/state/${aID}`); if (!res.ok) return []; return await res.json(); } catch { return []; }
  }
  async function saveState(aID, state){
    const res = await authFetch(`${API_BASE}/api/state/${aID}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state }) });
    if (res.ok && bundleCache.has(String(aID))) {
      const cached = bundleCache.get(String(aID));
      cached.state = clone(state);
    }
    return res.ok;
  }

  window.AssignmentService = {
    loadAssignment,
    loadAssignmentBundle,
    invalidateAssignmentBundle,
    fetchState,
    saveState
  };
})();

