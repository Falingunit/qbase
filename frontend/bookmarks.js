"use strict";
(async () => {
  await loadConfig();

  // Refresh on login
  window.addEventListener('qbase:login', () => {
    loadBookmarks();
  });

  // Refresh when returning via back/forward cache
  window.addEventListener('pageshow', () => {
    loadBookmarks();
  });

  // Show logged-out state
  window.addEventListener('qbase:logout', () => {
    const loadingEl = document.getElementById('loading');
    const noBookmarksEl = document.getElementById('no-bookmarks');
    const contentEl = document.getElementById('bookmarks-content');
    loadingEl.style.display = 'none';
    contentEl.style.display = 'none';
    noBookmarksEl.style.display = 'block';
    noBookmarksEl.innerHTML = `
      <h3>Login required</h3>
      <p class="text-muted">Please sign in to view your bookmarks.</p>
    `;
  });

  let currentBookmarks = [];
  let assignmentData = new Map();

  document.addEventListener('DOMContentLoaded', () => {
    loadBookmarks();
    document.getElementById('refresh-bookmarks').addEventListener('click', loadBookmarks);
    document.getElementById('open-assignment-btn').addEventListener('click', openInAssignment);
  });

  async function loadBookmarks() {
    const loadingEl = document.getElementById('loading');
    const noBookmarksEl = document.getElementById('no-bookmarks');
    const contentEl = document.getElementById('bookmarks-content');

    loadingEl.style.display = 'block';
    noBookmarksEl.style.display = 'none';
    contentEl.style.display = 'none';

    try {
      const response = await authFetch(`${API_BASE}/api/bookmarks`, { cache: 'no-store' });

      if (!response.ok) {
        if (response.status === 401) {
          loadingEl.style.display = 'none';
          noBookmarksEl.style.display = 'block';
          noBookmarksEl.innerHTML = `
            <h3>Login required</h3>
            <p class="text-muted">Please sign in to view your bookmarks.</p>
            <button class="btn btn-primary" onclick="window.dispatchEvent(new Event('qbase:force-login'))">
              Sign in
            </button>
          `;
          window.dispatchEvent(new Event('qbase:logout'));
          return;
        }
        throw new Error(`HTTP ${response.status}`);
      }

      currentBookmarks = await response.json();

      if (!Array.isArray(currentBookmarks) || currentBookmarks.length === 0) {
        loadingEl.style.display = 'none';
        noBookmarksEl.style.display = 'block';
        noBookmarksEl.textContent = 'No bookmarks yet.';
        return;
      }

      const bookmarksByTag = groupBookmarksByTag(currentBookmarks);
      await loadAssignmentData(bookmarksByTag);
      renderBookmarks(bookmarksByTag);

      loadingEl.style.display = 'none';
      contentEl.style.display = 'block';

    } catch (error) {
      console.error('Failed to load bookmarks:', error);
      loadingEl.style.display = 'none';
      noBookmarksEl.style.display = 'block';
      noBookmarksEl.innerHTML = `
        <h3>Error loading bookmarks</h3>
        <p class="text-muted">Failed to load bookmarks. Please try again.</p>
        <button class="btn btn-primary" onclick="loadBookmarks()">Retry</button>
      `;
    }
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

  function processPassageQuestions(questions) {
    let currentPassage = null;
    let currentPassageImage = null;
    let currentPassageId = null;
    let passageCounter = 1;

    questions.forEach(q => {
      if (q.qType === 'Passage') {
        currentPassage = q.qText;
        currentPassageImage = q.image;
        currentPassageId = `P${passageCounter++}`;
        q.passageId = currentPassageId;
        q._isPassage = true;
      } else if (q.passageId === currentPassageId) {
        q.passage = currentPassage;
        q.passageImage = currentPassageImage;
      }
    });
  }

  async function loadAssignmentData(bookmarksByTag) {
    const ids = new Set();
    for (const tagBookmarks of Object.values(bookmarksByTag)) {
      for (const bookmark of tagBookmarks) {
        ids.add(bookmark.assignmentId);
      }
    }

    for (const id of ids) {
      if (!assignmentData.has(id)) {
        try {
          const resp = await fetch(`./data/question_data/${id}/assignment.json`);
          if (resp.ok) {
            const data = await resp.json();
            processPassageQuestions(data.questions);
            assignmentData.set(id, data);
          }
        } catch (err) {
          console.error(`Failed to load assignment ${id}:`, err);
        }
      }
    }
  }

  function renderBookmarks(bookmarksByTag) {
    const contentEl = document.getElementById('bookmarks-content');
    const sortedTags = Object.keys(bookmarksByTag).sort((a, b) => {
      if (a === 'Doubt') return -1;
      if (b === 'Doubt') return 1;
      return a.localeCompare(b);
    });

    let html = '';
    for (const tagName of sortedTags) {
      const bookmarks = bookmarksByTag[tagName];
      html += `
        <div class="card mb-4">
          <div class="card-header d-flex justify-content-between align-items-center">
            <h5 class="mb-0">
              <i class="bi bi-bookmark-fill text-primary"></i>
              ${escapeHtml(tagName)}
              <span class="badge bg-secondary ms-2">${bookmarks.length}</span>
            </h5>
          </div>
          <div class="card-body">
            <div class="row row-cols-1 row-cols-md-2 row-cols-lg-3 g-3">
      `;
      for (const b of bookmarks) {
        const assignment = assignmentData.get(b.assignmentId);
        if (!assignment) continue;
        const q = assignment.questions[b.questionIndex];
        if (!q) continue;

        const truncatedText = (q.qText || 'Question text not available').slice(0, 100) + (q.qText?.length > 100 ? '...' : '');
        html += `
          <div class="col">
            <div class="card h-100 bookmark-card"
              data-assignment-id="${b.assignmentId}"
              data-question-index="${b.questionIndex}"
              style="cursor:pointer;">
              <div class="card-body">
                <div class="d-flex justify-content-between align-items-start mb-2">
                  <small class="text-muted">Assignment ${b.assignmentId} • Q${b.questionIndex + 1}</small>
                  <button class="btn btn-sm btn-outline-danger remove-bookmark"
                    data-assignment-id="${b.assignmentId}"
                    data-question-index="${b.questionIndex}"
                    data-tag-id="${b.tagId}">
                    <i class="bi bi-x"></i>
                  </button>
                </div>
                <p class="card-text">${escapeHtml(truncatedText)}</p>
                <div class="d-flex justify-content-between align-items-center">
                  <span class="badge bg-info">${q.qType}</span>
                  <small class="text-muted">${formatDate(b.created_at)}</small>
                </div>
              </div>
            </div>
          </div>
        `;
      }
      html += `
            </div>
          </div>
        </div>
      `;
    }

    contentEl.innerHTML = html;

    document.querySelectorAll('.bookmark-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (!e.target.closest('.remove-bookmark')) {
          showQuestion(card.dataset.assignmentId, card.dataset.questionIndex);
        }
      });
    });

    document.querySelectorAll('.remove-bookmark').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (await removeBookmark(btn.dataset.assignmentId, btn.dataset.questionIndex, btn.dataset.tagId)) {
          loadBookmarks();
        }
      });
    });
  }

  async function removeBookmark(assignmentId, questionIndex, tagId) {
    try {
      const resp = await authFetch(`${API_BASE}/api/bookmarks/${assignmentId}/${questionIndex}/${tagId}`, { method: 'DELETE' });
      return resp.ok;
    } catch (err) {
      console.error('Failed to remove bookmark:', err);
      alert('Failed to remove bookmark.');
      return false;
    }
  }
    async function showQuestion(assignmentId, questionIndex) {
        try {
            const assignment = assignmentData.get(parseInt(assignmentId));
            if (!assignment) {
                alert('Assignment data not available');
                return;
            }
            
            const question = assignment.questions[questionIndex];
            if (!question) {
                alert('Question not found');
                return;
            }
            
            // Load question state for notes
            let questionState = null;
            try {
                const stateResponse = await authFetch(`${API_BASE}/api/state/${assignmentId}`);
                if (stateResponse.ok) {
                    const states = await stateResponse.json();
                    if (Array.isArray(states) && states[questionIndex]) {
                        questionState = states[questionIndex];
                    }
                }
            } catch (error) {
                console.warn('Failed to load question state:', error);
            }
            
            const modal = new bootstrap.Modal(document.getElementById('questionModal'));
            const titleEl = document.getElementById('questionModalTitle');
            const bodyEl = document.getElementById('questionModalBody');
            
            titleEl.textContent = `Assignment ${assignmentId} • Question ${questionIndex + 1}`;
            
            // Store assignment and question info for the "Open in Assignment" button
            document.getElementById('open-assignment-btn').dataset.assignmentId = assignmentId;
            document.getElementById('open-assignment-btn').dataset.questionIndex = questionIndex;
            
            // Render the question
            bodyEl.innerHTML = renderQuestionForView(question, assignment, questionState, assignmentId, questionIndex);
            
            // Render KaTeX if present
            if (window.renderMathInElement) {
                const katexOptions = {
                    delimiters: [
                        {left: '$$', right: '$$', display: true},
                        {left: '$', right: '$', display: false},
                        {left: '\\(', right: '\\)', display: false},
                        {left: '\\[', right: '\\]', display: true}
                    ]
                };
                
                // Render KaTeX on the entire modal body
                window.renderMathInElement(bodyEl, katexOptions);
            }
            
            // Set up notes editing functionality
            setupNotesEditing(assignmentId, questionIndex, questionState);
            
            modal.show();
            
        } catch (error) {
            console.error('Failed to show question:', error);
            alert('Failed to load question');
        }
    }

    function renderQuestionForView(question, assignment, questionState, assignmentId, questionIndex) {
      const el = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text; // keep as plain text (safe for KaTeX)
        return node;
      };

      const container = el('div');

      // Passage
      if (question.passage) {
        const card = el('div', 'mb-4 p-3 bg-dark rounded');
        card.appendChild(el('h6', 'text-muted mb-2', 'Passage:'));
        if (question.passageImage) {
          const imgWrap = el('div', 'mb-3');
          const img = el('img', 'img-fluid');
          img.alt = 'Passage Image';
          img.src = `./data/question_data/${assignmentId}/${question.passageImage}`;
          imgWrap.appendChild(img);
          card.appendChild(imgWrap);
        }
        const passageText = el('div', 'passage-text', question.passage);
        card.appendChild(passageText);
        container.appendChild(card);
      }

      // Question text
      if (question.qText) {
        const wrap = el('div', 'mb-3');
        const label = el('strong', null, 'Question:');
        wrap.appendChild(label);
        wrap.appendChild(document.createElement('br'));
        wrap.appendChild(el('div', 'question-text', question.qText));
        container.appendChild(wrap);
      }

      // Question image
      if (question.image) {
        const imgWrap = el('div', 'mb-3');
        const img = el('img', 'img-fluid');
        img.alt = 'Question Image';
        img.src = `./data/question_data/${assignmentId}/${question.image}`;
        imgWrap.appendChild(img);
        container.appendChild(imgWrap);
      }

      // Options
      if (question.qType === 'SMCQ' || question.qType === 'MMCQ') {
        const optionsWrap = el('div', 'mb-3');
        const options = ['A', 'B', 'C', 'D'];
        const correctAnswers = normalizeAnswer(question);

        for (let i = 0; i < options.length; i++) {
          const option = options[i];
          const optionText = question.qOptions ? question.qOptions[i] : question[`q${option}`];
          if (!optionText) continue;

          const isCorrect = correctAnswers.has(option);
          const btn = el(
            'div',
            `btn btn-outline-secondary text-start w-100 mb-2 ${isCorrect ? 'border-success border-2' : ''}`
          );
          btn.style.pointerEvents = 'none';
          btn.style.color = 'white';

          const label = el('span', 'option-label', `${option}.`);
          const text = el('span', 'option-text', optionText);

          btn.appendChild(label);
          btn.appendChild(document.createTextNode(' '));
          btn.appendChild(text);
          optionsWrap.appendChild(btn);
        }
        container.appendChild(optionsWrap);

        const correctOptions = Array.from(correctAnswers).sort();
        const ans = el('div', 'alert alert-success');
        ans.appendChild(el('strong', null, 'Correct Answer:'));
        ans.appendChild(document.createTextNode(' ' + correctOptions.join(', ')));
        container.appendChild(ans);
      }

      // Numerical
      if (question.qType === 'Numerical') {
        const answer = normalizeAnswer(question);
        if (answer.valid) {
          const ans = el('div', 'alert alert-success');
          ans.appendChild(el('strong', null, 'Correct Answer:'));
          ans.appendChild(document.createTextNode(' ' + String(answer.value)));
          container.appendChild(ans);
        }
      }

      // Notes
      const notesWrap = el('div', 'mt-4');
      notesWrap.appendChild(el('h6', null, 'Notes:'));
      const textarea = el('textarea', 'form-control');
      textarea.id = 'question-notes';
      textarea.rows = 4;
      textarea.placeholder = 'Add your notes here...';
      textarea.value = questionState?.notes || '';
      notesWrap.appendChild(textarea);

      const controls = el('div', 'mt-2');
      const saveBtn = el('button', 'btn btn-primary btn-sm', 'Save Notes');
      saveBtn.id = 'save-notes-btn';
      const status = el('span', 'ms-2 text-muted');
      status.id = 'notes-save-status';
      controls.appendChild(saveBtn);
      controls.appendChild(status);
      notesWrap.appendChild(controls);

      container.appendChild(notesWrap);

      // NOTE: caller can now do:
      // parent.appendChild(container);
      // renderMathInElement(container, { delimiters: [...] });

      return container;
    }


    function normalizeAnswer(q) {
        if (q.qType === 'SMCQ') {
            return new Set([String(q.qAnswer).trim().toUpperCase()]);
        }
        if (q.qType === 'MMCQ') {
            const arr = Array.isArray(q.qAnswer) ? q.qAnswer : [q.qAnswer];
            return new Set(arr.map(x => String(x).trim().toUpperCase()));
        }
        if (q.qType === 'Numerical') {
            const n = Number(q.qAnswer);
            return { value: n, valid: !Number.isNaN(n) };
        }
        return new Set();
    }

    function openInAssignment() {
        const assignmentId = document.getElementById('open-assignment-btn').dataset.assignmentId;
        const questionIndex = document.getElementById('open-assignment-btn').dataset.questionIndex;
        
        if (assignmentId && questionIndex !== undefined) {
            window.open(`./assignment.html?aID=${assignmentId}&q=${parseInt(questionIndex) + 1}`, '_blank');
        }
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function formatDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    // Set up notes editing functionality
    function setupNotesEditing(assignmentId, questionIndex, questionState) {
        const notesTextarea = document.getElementById('question-notes');
        const saveNotesBtn = document.getElementById('save-notes-btn');
        const saveStatus = document.getElementById('notes-save-status');
        
        if (!notesTextarea || !saveNotesBtn) return;
        
        let saveTimeout;
        
        // Auto-save on input (debounced)
        notesTextarea.addEventListener('input', () => {
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(() => {
                saveNotes(assignmentId, questionIndex, notesTextarea.value, saveStatus);
            }, 1000);
        });
        
        // Manual save button
        saveNotesBtn.addEventListener('click', () => {
            saveNotes(assignmentId, questionIndex, notesTextarea.value, saveStatus);
        });
    }

    // Save notes to server
    async function saveNotes(assignmentId, questionIndex, notes, statusElement) {
        try {
            // First, get the current state
            const stateResponse = await authFetch(`${API_BASE}/api/state/${assignmentId}`);
            let states = [];
            
            if (stateResponse.ok) {
                states = await stateResponse.json();
            }
            
            // Ensure states array is long enough
            while (states.length <= questionIndex) {
                states.push({
                    isAnswerPicked: false,
                    pickedAnswers: [],
                    isAnswerEvaluated: false,
                    pickedAnswer: '',
                    pickedNumerical: undefined,
                    time: 0,
                    notes: ''
                });
            }
            
            // Update the notes for this question
            states[questionIndex].notes = notes;
            
            // Save the updated state
            const saveResponse = await authFetch(`${API_BASE}/api/state/${assignmentId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ state: states })
            });
            
            if (saveResponse.ok) {
                statusElement.textContent = 'Saved';
                statusElement.className = 'ms-2 text-success';
                setTimeout(() => {
                    statusElement.textContent = '';
                }, 2000);
            } else {
                throw new Error('Failed to save');
            }
            
        } catch (error) {
            console.error('Failed to save notes:', error);
            statusElement.textContent = 'Save failed';
            statusElement.className = 'ms-2 text-danger';
            setTimeout(() => {
                statusElement.textContent = '';
            }, 3000);
        }
    }
})();
