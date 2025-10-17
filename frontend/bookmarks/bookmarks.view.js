// Bookmarks view: DOM only, calls back to service via callbacks
(function(){
  function escapeHtml(text) { const div = document.createElement('div'); div.textContent = text ?? ''; return div.innerHTML; }
  function formatDate(dateString) { const d = new Date(dateString); return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }

  function truncateKaTeXSafe(input, limit = 100, katexDelimiters) {
    const s = String(input ?? ''); if (!s) return '';
    const delimiters = (Array.isArray(katexDelimiters) && katexDelimiters.length ? [...katexDelimiters] : [ { left: '$$', right: '$$' }, { left: '$', right: '$' }, { left: '\\[', right: '\\]' }, { left: '\\(', right: '\\)' } ]).sort((a,b)=>b.left.length-a.left.length);
    const isEscaped = (str, pos) => { let n=0, i=pos-1; while(i>=0 && str[i]==='\\'){ n++; i--; } return (n%2)===1; };
    const findBalanced = (str, i, left, right) => { let depth=0; for (let p=i; p<str.length; p++){ if (str.startsWith(left, p) && !isEscaped(str,p)) { depth++; p+=left.length-1; } else if (str.startsWith(right,p) && !isEscaped(str,p)) { depth--; if (depth===0) return p+right.length; p+=right.length-1; } } return -1; };
    let out=''; let truncated=false; let i=0;
    while(i<s.length && out.length<limit){ let next=s.length; for(const {left,right} of delimiters){ const idx=s.indexOf(left,i); if(idx>=0 && idx<next) next=idx; }
      if (next===s.length){ out+=s.slice(i,Math.min(s.length,i+(limit-out.length))); i=s.length; break; }
      if (next>i){ const take=Math.min(next,i+(limit-out.length)); out+=s.slice(i,take); i=take; if(out.length>=limit) break; }
      let matched=false; for(const {left,right} of delimiters){ if (s.startsWith(left,i) && !isEscaped(s,i)){ const end=findBalanced(s,i,left,right); if(end===-1){ out+=s.slice(i,Math.min(s.length,i+(limit-out.length))); i=s.length; truncated=true; matched=true; break; } const chunk=s.slice(i,end); if(out.length+chunk.length<=limit){ out+=chunk; i=end; } else { truncated=true; const remain=limit-out.length; if(remain>0) out+=chunk.slice(0,remain); i=end; } matched=true; break; } }
      if(!matched){ const take=Math.min(s.length,i+(limit-out.length)); out+=s.slice(i,take); i=take; if(out.length>=limit) truncated=true; }
    }
    return (truncated || out.length < s.length) ? out + '...' : out;
  }

  function renderBookmarks(bookmarksByTag, assignmentData, opts){
    const katexOptions = opts?.katexOptions; const onRemove = opts?.onRemove; const onDeleteTag = opts?.onDeleteTag; const onShow = opts?.onShow;
    const contentEl = document.getElementById('bookmarks-content'); if(!contentEl) return;
    const sortedTags = Object.keys(bookmarksByTag).sort((a,b)=>{ if(a==='Doubt') return -1; if(b==='Doubt') return 1; return a.localeCompare(b); });
    const TRUNCATE_LIMIT = 100; let html='';
    for (const tagName of sortedTags){ const bookmarks = bookmarksByTag[tagName]; const tagId = bookmarks && bookmarks.length ? bookmarks[0].tagId : null; html += `
      <div class="card mb-4">
        <div class="card-header d-flex justify-content-between align-items-center">
          <h5 class="mb-0"><i class="bi bi-bookmark-fill text-primary"></i> ${escapeHtml(tagName)} <span class="badge bg-secondary ms-2">${bookmarks.length}</span></h5>
          <div>${tagId ? `<button class="btn btn-sm btn-outline-danger delete-tag" data-tag-id="${escapeHtml(String(tagId))}" data-tag-name="${escapeHtml(tagName)}" title="Delete tag and its bookmarks"><i class="bi bi-trash"></i></button>` : ''}</div>
        </div>
        <div class="card-body"><div class="row row-cols-1 row-cols-md-2 row-cols-lg-3 g-3">`;
      for (const b of bookmarks){ const assignment = assignmentData.get(b.assignmentId); if(!assignment) continue; const q = assignment.questions[b.questionIndex]; if(!q) continue; const displayIndex = assignment.questions.slice(0,b.questionIndex+1).filter(qq=>qq.qType!=='Passage').length - 1; const text = q.qText || 'Question text not available'; const truncated = truncateKaTeXSafe(text, TRUNCATE_LIMIT, katexOptions?.delimiters);
        html += `
        <div class="col">
          <div class="as-card card h-100 bookmark-card" data-assignment-id="${escapeHtml(String(b.assignmentId))}" data-question-index="${escapeHtml(String(b.questionIndex))}" data-display-index="${escapeHtml(String(displayIndex))}" style="cursor:pointer;">
            <div class="card-body">
              <div class="d-flex justify-content-between align-items-start mb-2">
                <small class="text-muted">Assignment ${b.assignmentId} – Q${displayIndex + 1}</small>
                <button class="btn btn-sm btn-outline-danger remove-bookmark" data-assignment-id="${escapeHtml(String(b.assignmentId))}" data-question-index="${escapeHtml(String(b.questionIndex))}" data-tag-id="${escapeHtml(String(b.tagId))}"><i class="bi bi-x"></i></button>
              </div>
              <p class="card-text">${escapeHtml(truncated).replace(/\n/g,'<br>')}</p>
              <div class="d-flex justify-content-between align-items-center">
                <span class="badge bg-info">${escapeHtml(String(q.qType))}</span>
                <small class="text-muted">${formatDate(b.created_at)}</small>
              </div>
            </div>
          </div>
        </div>`;
      }
      html += `</div></div></div>`;
    }
    contentEl.innerHTML = html;

    document.querySelectorAll('.card-text').forEach((card)=>{ if(window.renderMathInElement) window.renderMathInElement(card, katexOptions || {}); });

    document.querySelectorAll('.bookmark-card').forEach((card)=>{
      card.addEventListener('click', (e)=>{ if (!e.target.closest('.remove-bookmark')) onShow?.(card.dataset.assignmentId, card.dataset.questionIndex); });
    });
    document.querySelectorAll('.remove-bookmark').forEach((btn)=>{
      btn.addEventListener('click', async (e)=>{ e.stopPropagation(); onRemove?.(btn.dataset.assignmentId, btn.dataset.questionIndex, btn.dataset.tagId); });
    });
    document.querySelectorAll('.delete-tag').forEach((btn)=>{
      btn.addEventListener('click', async (e)=>{ e.stopPropagation(); const tagId = btn.dataset.tagId; const tagName = btn.dataset.tagName || 'this tag'; let confirmed=false; try { confirmed = await (window.showConfirm ? showConfirm({ title:'Delete Tag', message:`Delete "${escapeHtml(tagName)}" and all its bookmarks?`, okText:'Delete', cancelText:'Cancel' }) : Promise.resolve(confirm(`Delete "${tagName}" and all its bookmarks? This cannot be undone.`))); } catch {} if (!confirmed) return; onDeleteTag?.(tagId); });
    });
  }

  async function showQuestion(assignmentId, questionIndex, assignmentData, assignmentTitles){
    const assignment = assignmentData.get(parseInt(assignmentId, 10)); if(!assignment){ alert('Assignment data not available'); return; }
    const qIdx = parseInt(questionIndex, 10); const question = assignment.questions[qIdx]; if(!question){ alert('Question not found'); return; }
    let questionState = null; try { const states = await BookmarksService.fetchQuestionState(assignmentId); if (Array.isArray(states) && states[qIdx]) questionState = states[qIdx]; } catch {}

    const modalEl = document.getElementById('questionModal'); const titleEl = document.getElementById('questionModalTitle'); const bodyEl = document.getElementById('questionModalBody'); const openBtn = document.getElementById('open-assignment-btn'); if (!modalEl || !titleEl || !bodyEl || !openBtn) return;
    const modal = new bootstrap.Modal(modalEl);
    const niceTitle = assignmentTitles.get(Number(assignmentId)) || `Assignment ${assignmentId}`;
    const displayIndex = assignment.questions.slice(0,qIdx+1).filter(qq=>qq.qType!=='Passage').length - 1; titleEl.textContent = `${niceTitle} – Question ${displayIndex + 1}`;
    openBtn.dataset.assignmentId = assignmentId; openBtn.dataset.questionIndex = String(qIdx); openBtn.dataset.displayIndex = String(displayIndex);
    bodyEl.innerHTML = renderQuestionForView(question, assignment, questionState, assignmentId, qIdx);
    if (window.renderMathInElement) window.renderMathInElement(bodyEl, { delimiters: [ { left:'$$', right:'$$', display:true }, { left:'$', right:'$', display:false }, { left:'\\(', right:'\\)', display:false }, { left:'\\[', right:'\\]', display:true } ] });
    setupNotesEditing(assignmentId, qIdx, questionState);
    modal.show();
  }

  function setupNotesEditing(assignmentId, questionIndex, questionState){
    const notesTextarea = document.getElementById('question-notes'); const saveNotesBtn = document.getElementById('save-notes-btn'); const saveStatus = document.getElementById('notes-save-status'); if (!notesTextarea || !saveNotesBtn) return;
    let saveTimeout; const saveFn = async () => { try { const stateResponse = await authFetch(`${API_BASE}/api/state/${assignmentId}`); let states = []; if (stateResponse.ok) states = await stateResponse.json(); while (states.length <= questionIndex) { states.push({ isAnswerPicked:false, pickedAnswers:[], isAnswerEvaluated:false, pickedAnswer:'', pickedNumerical:undefined, time:0, notes:'' }); } states[questionIndex].notes = notesTextarea.value; const ok = await BookmarksService.saveNotes(assignmentId, states); if (ok) { saveStatus.textContent='Saved'; saveStatus.className='ms-2 text-success'; setTimeout(()=>{ saveStatus.textContent=''; }, 2000); } else throw new Error('save failed'); } catch { saveStatus.textContent='Save failed'; saveStatus.className='ms-2 text-danger'; setTimeout(()=>{ saveStatus.textContent=''; }, 3000); } };
    notesTextarea.addEventListener('input', () => { clearTimeout(saveTimeout); saveTimeout = setTimeout(saveFn, 1000); });
    saveNotesBtn.addEventListener('click', saveFn);
  }

  function renderQuestionForView(question, assignment, questionState, assignmentId, questionIndex){
    const esc = (v) => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    const imgSrc = (file) => `./data/question_data/${encodeURIComponent(String(assignmentId))}/${encodeURIComponent(String(file))}`;
    let html='';
    if (question.passage){ html += '<div class="mb-4 p-3 bg-dark rounded">'; html += '<h6 class="text-muted mb-2">Passage:</h6>'; if (question.passageImage) { html += `<div class="mb-3"><img src="${imgSrc(question.passageImage)}" class="img-fluid" alt="Passage Image" loading="lazy" decoding="async"></div>`; } html += `<div class="passage-text">${esc(question.passage)}</div>`; html += '</div>'; }
    if (question.qText){ html += `<div class="mb-3"><strong>Question:</strong><br><div class="question-text">${esc(question.qText).replace(/\n/g,'<br>')}</div></div>`; }
    if (question.image){ html += `<div class="mb-3"><img src="${imgSrc(question.image)}" class="img-fluid" alt="Question Image" loading="lazy" decoding="async"></div>`; }
    if (question.qType==='SMCQ' || question.qType==='MMCQ'){ html += '<div class="mb-3">'; const options=['A','B','C','D']; const correct = normalizeAnswer(question); for (let i=0;i<options.length;i++){ const option=options[i]; const optionText = question.qOptions ? question.qOptions[i] : question[`q${option}`]; if (!optionText) continue; const isCorrect = correct.has(option); const correctClass = isCorrect ? 'border-success border-2' : ''; html += `<div class="btn btn-outline-secondary text-start w-100 mb-2 ${correctClass}" style="pointer-events: none; color: white !important;"><span class="option-label">${option}.</span> <span class="option-text">${esc(optionText)}</span></div>`; } html += '</div>'; const correctOptions = Array.from(correct).sort(); html += `<div class="alert alert-success"><strong>Correct Answer:</strong> ${esc(correctOptions.join(', '))}</div>`; }
    if (question.qType==='Numerical'){ const ans = normalizeAnswer(question); if (ans.valid) html += `<div class="alert alert-success"><strong>Correct Answer:</strong> ${esc(ans.value)}</div>`; }
    html += `<div class="mt-4"><h6>Notes:</h6><textarea id="question-notes" class="form-control" rows="4" placeholder="Add your notes here...">${esc(questionState?.notes || '')}</textarea><div class="mt-2"><button id="save-notes-btn" class="btn btn-primary btn-sm">Save Notes</button><span id="notes-save-status" class="ms-2 text-muted"></span></div></div>`;
    return html;
  }
  function normalizeAnswer(q){ if (q.qType==='SMCQ') return new Set([String(q.qAnswer).trim().toUpperCase()]); if (q.qType==='MMCQ'){ const arr = Array.isArray(q.qAnswer)? q.qAnswer : [q.qAnswer]; return new Set(arr.map(x=>String(x).trim().toUpperCase())); } if (q.qType==='Numerical'){ const n=Number(q.qAnswer); return { value:n, valid: !Number.isNaN(n) }; } return new Set(); }

  function openInAssignment(){ const btn = document.getElementById('open-assignment-btn'); if(!btn) return; const assignmentId = btn.dataset.assignmentId; let displayIndex = btn.dataset.displayIndex; const originalIndex = btn.dataset.questionIndex; if (!displayIndex && assignmentId && originalIndex !== undefined) { /* no-op, view expects data prefilled */ } if (assignmentId && displayIndex !== undefined){ window.open(`./assignment.html?aID=${encodeURIComponent(assignmentId)}&q=${parseInt(displayIndex,10)+1}`, '_blank'); } }

  window.BookmarksView = { renderBookmarks, showQuestion, setupNotesEditing, truncateKaTeXSafe, openInAssignment };
})();

