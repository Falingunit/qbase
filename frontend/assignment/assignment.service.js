// Assignment service: logic/data helpers (no DOM)
(function(){
  async function loadLocalAssignment(aID){
    const url = `./data/question_data/${encodeURIComponent(aID)}/assignment.json`;
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return await r.json();
  }

  async function fetchState(aID){
    try { const res = await authFetch(`${API_BASE}/api/state/${aID}`); if (!res.ok) return []; return await res.json(); } catch { return []; }
  }
  async function saveState(aID, state){
    const res = await authFetch(`${API_BASE}/api/state/${aID}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state }) });
    return res.ok;
  }

  window.AssignmentService = { loadLocalAssignment, fetchState, saveState };
})();

