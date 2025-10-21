"use strict";

(async () => {
  await loadConfig();

  async function getMe() {
    try { const r = await authFetch(`${API_BASE}/me`); if (!r.ok) return null; return await r.json(); } catch { return null; }
  }

  const gate = document.getElementById("admin-gate");
  const listEl = document.getElementById("reports-list");
  const refreshBtn = document.getElementById("refresh");
  const filterBtns = Array.from(document.querySelectorAll('[data-filter]'));
  let currentFilter = 'open';
  const searchInput = document.getElementById('search');
  const blockedOnlyEl = document.getElementById('blocked-only');
  const autoRefreshEl = document.getElementById('auto-refresh');
  const loadingEl = document.getElementById('admin-loading');
  const emptyEl = document.getElementById('reports-empty');
  let autoTimer = 0;
  let cache = [];

  function escapeHtml(s){ const d=document.createElement('div'); d.textContent=String(s||""); return d.innerHTML; }
  function fmtDate(s){ try { const d=new Date(s); return d.toLocaleString(); } catch { return String(s||""); } }

  async function requireAdmin() {
    const me = await getMe();
    if (!me || !me.isAdmin) { gate?.classList.remove("d-none"); if (listEl) listEl.innerHTML = ""; return false; }
    gate?.classList.add("d-none");
    return true;
  }

  async function fetchReports() {
    const r = await authFetch(`${API_BASE}/api/admin/reports`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  }

  function questionKey(r){
    if (r.kind === 'assignment') return `Assignment ${r.assignmentId} — Q#${Number(r.questionIndex)+1}`;
    return `PYQs ${r.examId}/${r.subjectId}/${r.chapterId} — Q#${Number(r.questionIndex)+1}`;
  }

  function questionHref(r){
    if (r.kind === 'assignment') {
      const q = Number(r.questionIndex)+1;
      return `./assignment.html?aID=${encodeURIComponent(r.assignmentId)}&q=${q}`;
    } else {
      const q = Number(r.questionIndex)+1;
      const p = new URLSearchParams({ exam: r.examId, subject: r.subjectId, chapter: r.chapterId, q: String(q) });
      return `./pyqs_assignment.html?${p.toString()}`;
    }
  }

  function statusClass(s){ s=String(s||"").toLowerCase(); if (s==='wip') return 'status-wip'; if (s==='closed') return 'status-closed'; return 'status-open'; }

  async function setStatus(id, status){
    const r = await authFetch(`${API_BASE}/api/admin/reports/${encodeURIComponent(id)}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ status }) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  }
  async function setNotes(id, notes){
    const r = await authFetch(`${API_BASE}/api/admin/reports/${encodeURIComponent(id)}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ notes }) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  }

  async function blockQuestion(r){
    const payload = { kind: r.kind, questionIndex: r.questionIndex };
    if (r.kind === 'assignment') payload.assignmentId = r.assignmentId; else { payload.examId=r.examId; payload.subjectId=r.subjectId; payload.chapterId=r.chapterId; }
    const resp = await authFetch(`${API_BASE}/api/admin/blocks`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  }
  async function unblockQuestion(r){
    const payload = { kind: r.kind, questionIndex: r.questionIndex };
    if (r.kind === 'assignment') payload.assignmentId = r.assignmentId; else { payload.examId=r.examId; payload.subjectId=r.subjectId; payload.chapterId=r.chapterId; }
    const resp = await authFetch(`${API_BASE}/api/admin/blocks`, { method:'DELETE', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  }

  function render(reports){
    if (!listEl) return;
    listEl.innerHTML = '';
    // Apply filter, search, and blocked-only
    const needle = String(searchInput?.value || '').trim().toLowerCase();
    let filtered = currentFilter==='all' ? reports : reports.filter(r => String(r.status||'').toLowerCase()===currentFilter);
    if (blockedOnlyEl?.checked) filtered = filtered.filter(r => !!r.blocked);
    if (needle) {
      filtered = filtered.filter((r) => {
        const hay = [questionKey(r), r.reason||'', r.message||'', r.username||'', r.id||''].join('\n').toLowerCase();
        return hay.includes(needle);
      });
    }
    // Group by question
    const byKey = new Map();
    for (const r of filtered) {
      const k = JSON.stringify({
        kind: r.kind,
        assignmentId: r.assignmentId ?? null,
        examId: r.examId ?? null,
        subjectId: r.subjectId ?? null,
        chapterId: r.chapterId ?? null,
        questionIndex: r.questionIndex,
      });
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(r);
    }

    const groups = Array.from(byKey.values());
    // Sort groups: any open first, then any wip, then closed only; then newest report time
    const bucket = (arr) => {
      const sts = new Set(arr.map(x => String(x.status||'').toLowerCase()));
      if (sts.has('open')) return 0; if (sts.has('wip')) return 1; return 2;
    };
    groups.sort((a,b)=>{
      const ba = bucket(a), bb = bucket(b);
      if (ba !== bb) return ba - bb;
      const ta = Math.max(...a.map(x => +new Date(x.created_at))), tb = Math.max(...b.map(x => +new Date(x.created_at)));
      return tb - ta;
    });

    // Empty state toggle
    if (!groups.length) { emptyEl?.classList.remove('d-none'); } else { emptyEl?.classList.add('d-none'); }

    for (const arr of groups) {
      const r0 = arr[0];
      const qTitle = questionKey(r0);
      const href = questionHref(r0);
      const counts = { open:0, wip:0, closed:0 };
      arr.forEach(x => counts[String(x.status||'').toLowerCase()] = (counts[String(x.status||'').toLowerCase()]||0)+1);
      const anyBlocked = arr.some(x => !!x.blocked);
      const groupCard = document.createElement('div');
      groupCard.className = 'card report-card';
      groupCard.setAttribute('data-status', (bucket(arr)===0?'open':bucket(arr)===1?'wip':'closed'));
      groupCard.innerHTML = `
        <div class="card-header d-flex align-items-center justify-content-between">
          <div class="d-flex flex-column">
            <div class="fw-semibold">${escapeHtml(qTitle)}</div>
            <div class="small text-secondary">${arr.length} report(s)</div>
          </div>
          <div class="d-flex align-items-center gap-2">
            <span class="badge text-bg-info">Open ${counts.open||0}</span>
            <span class="badge text-bg-warning text-dark">WIP ${counts.wip||0}</span>
            <span class="badge text-bg-success">Closed ${counts.closed||0}</span>
            <a class="btn btn-sm btn-outline-light" href="${escapeHtml(href)}" target="_blank" rel="noopener">Open Question</a>
            <button class="btn btn-sm ${anyBlocked?'btn-danger':'btn-outline-danger'} block-btn">${anyBlocked?'Unblock':'Block'}</button>
            <button class="btn btn-sm btn-outline-secondary toggle-btn"><i class="bi bi-caret-down"></i> Details</button>
          </div>
        </div>
        <div class="card-body d-none group-body"></div>
      `;
      const body = groupCard.querySelector('.group-body');

      // Build item cards
      arr.sort((a,b)=> +new Date(b.created_at) - +new Date(a.created_at));
      for (const r of arr) {
        const item = document.createElement('div');
        item.className = 'border rounded p-3 mb-3';
        item.innerHTML = `
          <div class="d-flex justify-content-between align-items-center mb-2">
            <div class="small text-secondary">Reported by <span class="text-light fw-semibold">${escapeHtml(r.username||'')}</span> • ${escapeHtml(fmtDate(r.created_at))}</div>
            <select class="form-select form-select-sm ${statusClass(r.status)}" style="max-width:140px" data-id="${escapeHtml(r.id)}">
              <option value="open" ${r.status==='open'?'selected':''}>Open</option>
              <option value="wip" ${r.status==='wip'?'selected':''}>WIP</option>
              <option value="closed" ${r.status==='closed'?'selected':''}>Closed</option>
            </select>
          </div>
          <div class="mb-1"><strong>Reason</strong>: ${escapeHtml(r.reason)}</div>
          <div class="mb-3"><strong>Details</strong><div class="p-3 bg-dark rounded border border-dark-subtle" style="min-height: 140px; white-space: pre-wrap">${escapeHtml(r.message)}</div></div>
          <div class="mb-0"><strong>Notes</strong><textarea class="form-control admin-notes" rows="5" placeholder="Add notes...">${escapeHtml(r.notes||'')}</textarea></div>
        `;
        const sel = item.querySelector('select');
        sel?.addEventListener('change', async (e) => {
          const val = e.target.value;
          try { await setStatus(r.id, val); sel.classList.remove('status-open','status-wip','status-closed'); sel.classList.add(statusClass(val)); }
          catch {}
        });
        const notesEl = item.querySelector('.admin-notes');
        let notesTimer = 0, lastVal = notesEl.value;
        const pushNotes = async () => { const v = String(notesEl.value||''); if (v === lastVal) return; lastVal = v; try { await setNotes(r.id, v); } catch {} };
        notesEl.addEventListener('input', () => { clearTimeout(notesTimer); notesTimer = setTimeout(pushNotes, 600); });
        notesEl.addEventListener('blur', pushNotes);
        body.appendChild(item);
      }

      const toggleBtn = groupCard.querySelector('.toggle-btn');
      toggleBtn?.addEventListener('click', () => { body.classList.toggle('d-none'); });
      const blockBtn = groupCard.querySelector('.block-btn');
      blockBtn?.addEventListener('click', async () => { try { if (anyBlocked) await unblockQuestion(r0); else await blockQuestion(r0); await load(); } catch {} });
      listEl.appendChild(groupCard);
    }
  }

  async function load(){
    if (!(await requireAdmin())) return;
    try { loadingEl?.classList.remove('d-none'); const list = await fetchReports(); cache = list; render(list); }
    catch (e) { if (listEl) listEl.innerHTML = '<div class="text-danger">Failed to load reports</div>'; }
    finally { loadingEl?.classList.add('d-none'); }
  }

  refreshBtn?.addEventListener('click', load);
  searchInput?.addEventListener('input', () => render(cache));
  blockedOnlyEl?.addEventListener('change', () => render(cache));
  filterBtns.forEach(btn => btn.addEventListener('click', () => {
    filterBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = String(btn.getAttribute('data-filter')||'open');
    render(cache);
  }));
  autoRefreshEl?.addEventListener('change', () => {
    try { clearInterval(autoTimer); } catch {}
    if (autoRefreshEl.checked) { autoTimer = setInterval(load, 30000); } else { autoTimer = 0; }
  });
  // Initialize filter chip default
  const def = filterBtns.find(b => (b.getAttribute('data-filter')||'')==='open');
  def?.classList.add('active');
  await load();
})();
