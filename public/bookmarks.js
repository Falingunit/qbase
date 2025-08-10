"use strict";

const API_BASE = ''; // same-origin
let currentBookmarks = [];
let assignmentData = new Map();

// Initialize the page
document.addEventListener('DOMContentLoaded', () => {
    loadBookmarks();
    
    // Set up event listeners
    document.getElementById('refresh-bookmarks').addEventListener('click', loadBookmarks);
    document.getElementById('open-assignment-btn').addEventListener('click', openInAssignment);
});

async function loadBookmarks() {
    const loadingEl = document.getElementById('loading');
    const noBookmarksEl = document.getElementById('no-bookmarks');
    const contentEl = document.getElementById('bookmarks-content');
    
    try {
        loadingEl.style.display = 'block';
        noBookmarksEl.style.display = 'none';
        contentEl.style.display = 'none';
        
        const response = await fetch(`${API_BASE}/api/bookmarks`, { credentials: 'include' });
        if (!response.ok) {
            if (response.status === 401) {
                // Not logged in, show login gate
                window.dispatchEvent(new Event('qbase:logout'));
                return;
            }
            throw new Error(`HTTP ${response.status}`);
        }
        
        currentBookmarks = await response.json();
        
        if (currentBookmarks.length === 0) {
            loadingEl.style.display = 'none';
            noBookmarksEl.style.display = 'block';
            return;
        }
        
        // Group bookmarks by tag
        const bookmarksByTag = groupBookmarksByTag(currentBookmarks);
        
        // Load assignment data for all bookmarked assignments
        await loadAssignmentData(bookmarksByTag);
        
        // Render the bookmarks
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
    
    for (const bookmark of bookmarks) {
        const tagName = bookmark.tagName;
        if (!grouped[tagName]) {
            grouped[tagName] = [];
        }
        grouped[tagName].push(bookmark);
    }
    
    return grouped;
}

// Process passage questions similar to assignment.js
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
        } else {
            if (q.passageId === currentPassageId) {
                q.passage = currentPassage;
                q.passageImage = currentPassageImage;
            }
        }
    });
}

async function loadAssignmentData(bookmarksByTag) {
    const assignmentIds = new Set();
    
    // Collect all unique assignment IDs
    for (const tagBookmarks of Object.values(bookmarksByTag)) {
        for (const bookmark of tagBookmarks) {
            assignmentIds.add(bookmark.assignmentId);
        }
    }
    
    // Load assignment data for each assignment
    for (const assignmentId of assignmentIds) {
        if (!assignmentData.has(assignmentId)) {
            try {
                const response = await fetch(`./data/question_data/${assignmentId}/assignment.json`);
                if (response.ok) {
                    const data = await response.json();
                    // Process passage questions similar to assignment.js
                    processPassageQuestions(data.questions);
                    assignmentData.set(assignmentId, data);
                }
            } catch (error) {
                console.error(`Failed to load assignment ${assignmentId}:`, error);
            }
        }
    }
}

function renderBookmarks(bookmarksByTag) {
    const contentEl = document.getElementById('bookmarks-content');
    
    // Sort tags: "Doubt" first, then alphabetically
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
        
        for (const bookmark of bookmarks) {
            const assignment = assignmentData.get(bookmark.assignmentId);
            if (!assignment) continue;
            
            const question = assignment.questions[bookmark.questionIndex];
            if (!question) continue;
            
            const questionText = question.qText || 'Question text not available';
            const truncatedText = questionText.length > 100 ? questionText.substring(0, 100) + '...' : questionText;
            
            html += `
                <div class="col">
                    <div class="card h-100 bookmark-card" 
                         data-assignment-id="${bookmark.assignmentId}" 
                         data-question-index="${bookmark.questionIndex}"
                         style="cursor: pointer;">
                        <div class="card-body">
                            <div class="d-flex justify-content-between align-items-start mb-2">
                                <small class="text-muted">
                                    Assignment ${bookmark.assignmentId} • Q${bookmark.questionIndex + 1}
                                </small>
                                <button class="btn btn-sm btn-outline-danger remove-bookmark" 
                                        data-assignment-id="${bookmark.assignmentId}" 
                                        data-question-index="${bookmark.questionIndex}"
                                        data-tag-id="${bookmark.tagId}">
                                    <i class="bi bi-x"></i>
                                </button>
                            </div>
                            <p class="card-text">${escapeHtml(truncatedText)}</p>
                            <div class="d-flex justify-content-between align-items-center">
                                <span class="badge bg-info">${question.qType}</span>
                                <small class="text-muted">${formatDate(bookmark.created_at)}</small>
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
    
    // Add event listeners
    document.querySelectorAll('.bookmark-card').forEach(card => {
        card.addEventListener('click', (e) => {
            if (!e.target.closest('.remove-bookmark')) {
                const assignmentId = card.dataset.assignmentId;
                const questionIndex = card.dataset.questionIndex;
                showQuestion(assignmentId, questionIndex);
            }
        });
    });
    
    document.querySelectorAll('.remove-bookmark').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const assignmentId = btn.dataset.assignmentId;
            const questionIndex = btn.dataset.questionIndex;
            const tagId = btn.dataset.tagId;
            
            if (await removeBookmark(assignmentId, questionIndex, tagId)) {
                loadBookmarks(); // Reload to refresh the display
            }
        });
    });
}

async function removeBookmark(assignmentId, questionIndex, tagId) {
    try {
        const response = await fetch(`${API_BASE}/api/bookmarks/${assignmentId}/${questionIndex}/${tagId}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        return true;
    } catch (error) {
        console.error('Failed to remove bookmark:', error);
        alert('Failed to remove bookmark. Please try again.');
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
            const stateResponse = await fetch(`${API_BASE}/api/state/${assignmentId}`, { credentials: 'include' });
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
    let html = '';
    
    // Passage (if this question has a passage)
    if (question.passage) {
        html += '<div class="mb-4 p-3 bg-dark rounded">';
        html += '<h6 class="text-muted mb-2">Passage:</h6>';
        
        // Passage image
        if (question.passageImage) {
            html += `<div class="mb-3"><img src="./data/question_data/${assignmentId}/${question.passageImage}" class="img-fluid" alt="Passage Image"></div>`;
        }
        
        // Passage text
        html += `<div class="passage-text">${question.passage}</div>`;
        html += '</div>';
    }
    
    // Question text
    if (question.qText) {
        html += `<div class="mb-3"><strong>Question:</strong><br><div class="question-text">${question.qText}</div></div>`;
    }
    
    // Question image
    if (question.image) {
        html += `<div class="mb-3"><img src="./data/question_data/${assignmentId}/${question.image}" class="img-fluid" alt="Question Image"></div>`;
    }
    
    // Options for MCQ questions
    if (question.qType === 'SMCQ' || question.qType === 'MMCQ') {
        html += '<div class="mb-3">';
        const options = ['A', 'B', 'C', 'D'];
        const correctAnswers = normalizeAnswer(question);
        
        for (let i = 0; i < options.length; i++) {
            const option = options[i];
            const optionText = question.qOptions ? question.qOptions[i] : question[`q${option}`];
            if (optionText) {
                const isCorrect = correctAnswers.has(option);
                const correctClass = isCorrect ? 'border-success border-2' : '';
                html += `
                    <div class="btn btn-outline-secondary text-start w-100 mb-2 ${correctClass}" style="pointer-events: none; color: white !important;">
                        <span class="option-label">${option}.</span> <span class="option-text">${optionText}</span>
                    </div>
                `;
            }
        }
        html += '</div>';
        
        // Show correct answer
        const correctOptions = Array.from(correctAnswers).sort();
        html += `<div class="alert alert-success"><strong>Correct Answer:</strong> ${correctOptions.join(', ')}</div>`;
    }
    
    // Numerical answer
    if (question.qType === 'Numerical') {
        const answer = normalizeAnswer(question);
        if (answer.valid) {
            html += `<div class="alert alert-success"><strong>Correct Answer:</strong> ${answer.value}</div>`;
        }
    }
    
    // Notes section
    html += `
        <div class="mt-4">
            <h6>Notes:</h6>
            <textarea id="question-notes" class="form-control" rows="4" placeholder="Add your notes here...">${questionState?.notes || ''}</textarea>
            <div class="mt-2">
                <button id="save-notes-btn" class="btn btn-primary btn-sm">Save Notes</button>
                <span id="notes-save-status" class="ms-2 text-muted"></span>
            </div>
        </div>
    `;
    
    return html;
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
        const stateResponse = await fetch(`${API_BASE}/api/state/${assignmentId}`, { credentials: 'include' });
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
        const saveResponse = await fetch(`${API_BASE}/api/state/${assignmentId}`, {
            method: 'POST',
            credentials: 'include',
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
