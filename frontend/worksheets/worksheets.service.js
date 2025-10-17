// Worksheets service: normalize + fetch (no DOM)
(function(){
  async function fetchJson(url){ const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`); return await r.json(); }

  function normalizeWorksheets(input){
    const out = [];
    const pushItem = (raw, subjHint) => {
      if (!raw) return;
      const subject = (raw.subject || subjHint || '(No subject)').toString();
      const chapter = (raw.chapter || raw.chapterName || raw.topic || '').toString();
      const title = (raw.title || raw.name || raw.worksheetTitle || raw.label || raw.file || 'Worksheet').toString();
      const fileField = raw.file || raw.path || raw.url || raw.pdf || raw.href || '';
      const fileUrl = String(fileField);
      const chapterIndex = parseChapterIndex(chapter, raw.chapterIndex);
      const wID = String(raw.wID || raw.id || raw.wid || generateWID(subject, chapter, title));
      out.push({ subject, chapter, title, wID, fileUrl, chapterIndex });
    };
    if (Array.isArray(input)) input.forEach((it)=>pushItem(it));
    else if (input && Array.isArray(input.worksheets)) input.worksheets.forEach((it)=>pushItem(it));
    else if (input && Array.isArray(input.items)) input.items.forEach((it)=>pushItem(it));
    else if (input && typeof input === 'object') { Object.entries(input).forEach(([subj, arr]) => { if (Array.isArray(arr)) arr.forEach((it)=>pushItem(it, subj)); }); }
    out.sort((a,b)=> a.subject.localeCompare(b.subject, undefined, { sensitivity:'base' }) || (a.chapterIndex ?? 1e9) - (b.chapterIndex ?? 1e9) || a.chapter.localeCompare(b.chapter, undefined, { sensitivity:'base' }) || a.title.localeCompare(b.title, undefined, { sensitivity:'base' }));
    return out;
  }

  function parseChapterIndex(chapter, fallback){ if (typeof fallback==='number') return fallback; const m=/(^|\b)(\d{1,3})(\b|\D)/.exec(String(chapter||'')); return m ? parseInt(m[2],10) : 1e9; }
  function generateWID(subject, chapter, title){ const slug=(s)=>String(s||'').toLowerCase().trim().replace(/[^a-z0-9\s-]/g,'').replace(/\s+/g,'-').replace(/-+/g,'-'); const base=[slug(subject), slug(chapter), slug(title)].filter(Boolean).join('-'); return base.slice(0,96) || String(Date.now()); }

  async function loadWorksheetManifest(wid){ const url = `./data/worksheets/${encodeURIComponent(wid)}.json`; const json = await fetchJson(url); const byFilename = (a,b)=> a.split('/').pop().toLowerCase().localeCompare(b.split('/').pop().toLowerCase()); const pages = (json.pages||[]).slice().sort(byFilename); const answers=(json.answers||[]).slice().sort(byFilename); return { title: json.title || 'Worksheet', pages, answers };
  }

  window.WorksheetsService = { fetchJson, normalizeWorksheets, parseChapterIndex, generateWID, loadWorksheetManifest };
})();

