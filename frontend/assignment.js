"use strict";

(async () => {
  await loadConfig();

const params = new URLSearchParams(window.location.search);
const aID = parseInt(params.get('aID'), 10);

let saveTimeout;

// ---------- Local keys & auth tracking ----------
let loggedInUser = null;          // username or null
let authSource   = 'none';        // 'server' | 'none'

function askLocalOrServer() {
  // OK  => Use LOCAL data and upload to server
  // Cancel => Use SERVER data
  return confirm('Both server and local progress exist.\n\nOK = Use LOCAL and upload to server\nCancel = Use SERVER');
}
function deleteLocal() {}


// ---------- Default state & guards ----------
function defaultState() {
  return {
    isAnswerPicked: false,
    pickedAnswers: [],
    isAnswerEvaluated: false,
    pickedAnswer: '',
    pickedNumerical: undefined,
    time: 0,
    notes: ''
  };
}
function ensureStateLength(n) {
  if (!Array.isArray(questionStates)) questionStates = [];
  for (let i = 0; i < n; i++) {
    if (!questionStates[i]) questionStates[i] = defaultState();
  }
}

function normalizeAnswer(q) {
  // q.qAnswer may be "A" | ["A","C"] | number | string-number
  if (q.qType === 'SMCQ') {
    return new Set([String(q.qAnswer).trim().toUpperCase()]);
  }
  if (q.qType === 'MMCQ') {
    const arr = Array.isArray(q.qAnswer) ? q.qAnswer : [q.qAnswer];
    return new Set(arr.map(x => String(x).trim().toUpperCase()));
  }
  if (q.qType === 'Numerical') {
    // Allow number or numeric string in data
    const n = Number(q.qAnswer);
    return { value: n, valid: !Number.isNaN(n) };
  }
  return new Set();
}

function getUserSelection(state, qType) {
  if (qType === 'SMCQ') return new Set(state.pickedAnswer ? [state.pickedAnswer] : []);
  if (qType === 'MMCQ') return new Set(state.pickedAnswers || []);
  if (qType === 'Numerical') return state.pickedNumerical;
  return null;
}

function clearMCQVisuals() {
  optionButtons.forEach(btn => {
    btn.classList.remove('correct','wrong','missed','disabled','mcq-option-selected');
  });
}

function applyMCQEvaluationStyles(correctSet, pickedSet) {
  // Mark picked ones
  optionButtons.forEach(btn => {
    const opt = btn.dataset.opt;
    const picked = pickedSet.has(opt);
    const correct = correctSet.has(opt);
    if (picked && correct) {
      btn.classList.add('correct');
    } else if (picked && !correct) {
      btn.classList.add('wrong');
    }
    // lock interaction
    btn.classList.add('disabled');
  });
  // Outline missed corrects
  optionButtons.forEach(btn => {
    const opt = btn.dataset.opt;
    if (!pickedSet.has(opt) && correctSet.has(opt)) {
      btn.classList.add('missed');
    }
  });
}

function applyNumericalEvaluationStyles(isCorrect) {
  numericalInput.classList.remove('is-correct','is-wrong');
  numericalInput.classList.add(isCorrect ? 'is-correct' : 'is-wrong');
  numericalInput.disabled = true;
}


// ---------- Auth helpers ----------
async function whoAmI() {
  try {
    const r = await authFetch(`${API_BASE}/me`);
    if (r.ok) {
      const u = await r.json();
      if (u?.username) return { username: u.username, source: 'server' };
    }
  } catch {}
  return null;
}

// ---------- Local cache helpers ----------
function saveLocal() {}
function loadLocal() { return null; }

// ---------- Merge logic (server ⟷ local) ----------
function mergeStates(serverArr, localArr) {
  const n = Math.max(serverArr?.length||0, localArr?.length||0);
  const out = Array(n).fill(null).map((_,i) => {
    const s = serverArr?.[i] || {};
    const l = localArr?.[i] || {};

    const isPicked = (x) => !!(x && (x.isAnswerPicked || x.pickedAnswer || (x.pickedAnswers?.length) || (x.pickedNumerical!==undefined)));
    const preferLocal = isPicked(l) && !isPicked(s);

    return {
      isAnswerPicked: !!(l.isAnswerPicked || s.isAnswerPicked),
      pickedAnswer:   preferLocal ? (l.pickedAnswer ?? '') : (s.pickedAnswer ?? ''),
      pickedAnswers:  Array.from(new Set([...(s.pickedAnswers||[]), ...(l.pickedAnswers||[])])),
      pickedNumerical: (l.pickedNumerical!==undefined) ? l.pickedNumerical : s.pickedNumerical,
      isAnswerEvaluated: !!(l.isAnswerEvaluated || s.isAnswerEvaluated),
      time: Math.max(l.time||0, s.time||0)
    };
  });
  return out;
}

// ---------- Passages preprocessing ----------
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

// ---------- Load saved state (server/local with migration prompt) ----------
async function loadSavedState(aID) {
  const me = await whoAmI();
  loggedInUser = me?.username || null;
  authSource   = me?.source   || 'none';

  if (!loggedInUser) {
    // Force login to proceed
    window.dispatchEvent(new Event('qbase:force-login'));
    return;
  }

  // Logged in → use server if available; fallback to local only if server has nothing
  try {
    const res = await authFetch(`${API_BASE}/api/state/${aID}`);
    if (res.ok) {
      const server = await res.json();
      if (Array.isArray(server) && server.length) {
        questionStates = server;
        return;
      }
    }
  } catch { /* ignore */ }

  // If server empty/unreachable, initialize fresh default states
  questionStates = Array(window.displayQuestions.length).fill().map(defaultState);
}


// ---------- Server POST helper ----------
async function postState(aID, state) {
  const res = await authFetch(`${API_BASE}/api/state/${aID}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state })
  });
  if (!res.ok) throw new Error(`postState failed: ${res.status}`);
}

// ---------- Save strategy (debounced + flush + periodic) ----------
let dirty = false;
const markDirty = () => { dirty = true; };
let toldLocalFallback = false;

async function scheduleSave(aID) {
  if (!dirty) return;
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    try {
      if (authSource === 'server') {
        await postState(aID, questionStates);
        dirty = false;                 // success → clear dirty
      }
    } catch (e) {
      console.warn('Server save failed; will retry later.', e);
      // keep dirty=true so periodic/next user action can retry
    }
  }, 800);
}

function flushSave() {
  if (!dirty) return;
  try {
    if (authSource === 'server') {
      const payload = JSON.stringify({ state: questionStates });
      const ok = navigator.sendBeacon(
        `${API_BASE}/api/state/${aID}`,
        new Blob([payload], { type: 'application/json' })
      );
      if (!ok) {
        authFetch(`${API_BASE}/api/state/${aID}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload, keepalive: true
        });
      }
      dirty = false;
    }
  } catch (e) {
    console.warn('flushSave error', e);
  }
}

document.getElementById('reset-question').addEventListener('click', () => {
  resetCurrentQuestion();
});

// Flush on close/background
window.addEventListener('pagehide', flushSave, { capture: true });
window.addEventListener('beforeunload', flushSave, { capture: true });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushSave();
});
// Gentle periodic autosave (only does work if dirty)
setInterval(() => scheduleSave(aID), 60000);

// React to runtime login/logout from navbar.js
window.addEventListener('qbase:login', async () => {
  const me = await whoAmI();
  loggedInUser = me?.username || null;
  authSource   = me?.source   || 'none';

  if (authSource === 'server') {
    try {
      if (dirty) {
        await postState(aID, questionStates);
        dirty = false;
      }
      console.info('Login detected.');
    } catch (e) {
      console.warn('Upload after login failed; will retry later.', e);
      // keep dirty=true so it retries on next scheduleSave/flush
    }
  }
});
window.addEventListener('qbase:logout', () => {
  loggedInUser = null;
  authSource = 'none';
});

// ---------- KaTeX render options ----------
const katexOptions = {
  delimiters: [
    {left: '$$', right: '$$', display: true},
    {left: '$',  right: '$',  display: false},
    {left: '\\(', right: '\\)', display: false},
    {left: '\\[', right: '\\]', display: true}
  ]
};

// ---------- App state ----------
let questionData;
let currentQuestionID;
let questionButtons;
let questionStates;
let optionButtons = [];
let timerInterval;

// ---------- UI helpers ----------
function formatTime(sec) {
  const m = String(Math.floor(sec/60)).padStart(2,'0');
  const s = String(sec % 60).padStart(2,'0');
  return `${m}:${s}`;
}

// Wire option buttons
document.querySelectorAll('.mcq-option').forEach(btn => {
  optionButtons.push(btn);
  btn.addEventListener('click', () => MCQOptionClicked(btn));
});

// Numerical input
const numericalInput = document.getElementById('numericalInput');
numericalInput.addEventListener('input', () => {
  const qState = questionStates[currentQuestionID];
  const raw   = numericalInput.value.trim();

  if (raw === '') {
    qState.pickedNumerical = undefined;
    qState.isAnswerPicked = false;
  } else {
    qState.pickedNumerical = Number(raw);
    qState.isAnswerPicked  = true;
  }

  evaluateQuestionButtonColor(currentQuestionID);
  markDirty();
  scheduleSave(aID);
});

// Notes input
const notesInput = document.getElementById('notesInput');
notesInput.addEventListener('input', () => {
  if (currentQuestionID == null) return;
  const qState = questionStates[currentQuestionID];
  qState.notes = notesInput.value;
  markDirty();
  scheduleSave(aID);
});

// Reuse modal helper from navbar.js if available, else fallback to confirm
async function confirmReset() {
  if (typeof showConfirm === 'function') {
    return await showConfirm({
      title: 'Reset Assignment?',
      message: 'This will permanently clear all your answers and progress for this assignment.',
      okText: 'Yes, Reset',
      cancelText: 'Cancel'
    });
  }
  return confirm('This will permanently clear all your answers and progress for this assignment.');
}

document.getElementById('reset-assignment').addEventListener('click', async () => {
  const yes = await confirmReset();
  if (!yes) return;

  try {
    if (authSource === 'server') {
      // Clear on server
      await postState(aID, []); // send empty state
      questionStates = Array(window.displayQuestions.length).fill().map(defaultState);
    } else {
      // Clear localStorage fallback
      localStorage.removeItem(`qbase:${aID}:state`);
      questionStates = Array(window.displayQuestions.length).fill().map(defaultState);
    }

    // Refresh UI to first question
    questionButtons.forEach((btn) => evaluateQuestionButtonColor(btn.dataset.qid));
    clickQuestionButton(0);
    dirty = false;
  } catch (e) {
    console.error('Reset failed:', e);
    if (typeof showNotice === 'function') {
      await showNotice({ title: 'Error', message: 'Failed to reset assignment.' });
    } else {
      alert('Failed to reset assignment.');
    }
  }
});

function resetCurrentQuestion() {
  if (currentQuestionID == null) return;
  const qID = currentQuestionID;
  const originalIdx = window.questionIndexMap[qID];
  const q = questionData.questions[originalIdx];

  // Fully reset state (time = 0 now)
  questionStates[qID] = { ...defaultState(), time: 0 };

  // Clear visuals + unlock
  if (q.qType === 'SMCQ' || q.qType === 'MMCQ') {
    optionButtons.forEach(btn => {
      btn.classList.remove('correct','wrong','missed','disabled','mcq-option-selected');
    });
  } else if (q.qType === 'Numerical') {
    numericalInput.disabled = false;
    numericalInput.classList.remove('is-correct','is-wrong');
    numericalInput.value = '';
    const numericalAnswer = document.getElementById('numericalAnswer');
    if (numericalAnswer) numericalAnswer.parentElement.style.display = 'none';
  }

  // Hide reset, show check answer again
  document.getElementById('reset-question').classList.add('d-none');
  document.getElementById('check-answer').classList.remove('d-none');

  // Re-render question UI from scratch (timer restarts from 0)
  setQuestion(qID);
  evaluateQuestionButtonColor(qID);

  markDirty();
  scheduleSave(aID);
}



// Hook up the Check Answer button once
document.getElementById('check-answer').addEventListener('click', () => {
  if (currentQuestionID == null) return;
  checkCurrentAnswer();
});

// Bookmark functionality
document.getElementById('bookmark-btn').addEventListener('click', () => {
  if (currentQuestionID == null) return;
  showBookmarkDialog();
});

function checkCurrentAnswer() {
  const qID = currentQuestionID;
  const originalIdx = window.questionIndexMap[qID];
  const q = questionData.questions[originalIdx];
  const st = questionStates[qID];

  if (!st) return;

  // Don't re-grade if already evaluated
  if (st.isAnswerEvaluated) return;

  let status = 'incorrect'; // default
  let partial = false;

  if (q.qType === 'SMCQ') {
    const correct = normalizeAnswer(q);      // Set
    const picked  = getUserSelection(st, 'SMCQ'); // Set
    const isCorrect = picked.size === 1 && correct.has([...picked][0]);
    status = isCorrect ? 'correct' : 'incorrect';
    // visuals
    clearMCQVisuals();
    applyMCQEvaluationStyles(correct, picked);

  } else if (q.qType === 'MMCQ') {
    const correct = normalizeAnswer(q);      // Set of correct opts
    const picked  = getUserSelection(st, 'MMCQ'); // Set of picked opts

    const pickedWrong = [...picked].some(x => !correct.has(x));
    const missed = [...correct].some(x => !picked.has(x));
    const allCorrectPickedOnly = !pickedWrong && !missed;

    if (allCorrectPickedOnly) status = 'correct';
    else if (!pickedWrong && picked.size > 0 && picked.size < correct.size) {
      status = 'partial'; partial = true;
    } else {
      status = 'incorrect';
    }

    clearMCQVisuals();
    applyMCQEvaluationStyles(correct, picked);

  } else if (q.qType === 'Numerical') {
    const ans = normalizeAnswer(q); // {value, valid}
    const user = getUserSelection(st, 'Numerical'); // number | undefined
    let isCorrect = false;
    if (ans.valid && typeof user === 'number') {
      // exact match by default; adjust tolerance if needed:
      isCorrect = (user === ans.value);
    }
    status = isCorrect ? 'correct' : 'incorrect';
    applyNumericalEvaluationStyles(isCorrect);
    // show correct answer text
    const numericalAnswer = document.getElementById('numericalAnswer');
    if (numericalAnswer) numericalAnswer.parentElement.style.display = 'block';
  }

  // Lock MCQ interaction if applicable
  if (q.qType === 'SMCQ' || q.qType === 'MMCQ') {
    optionButtons.forEach(btn => btn.classList.add('disabled'));
  }

  document.getElementById('check-answer').classList.add('d-none');
  document.getElementById('reset-question').classList.remove('d-none');

  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  // Store evaluation
  st.isAnswerEvaluated = true;
  st.evalStatus = status;     // 'correct' | 'partial' | 'incorrect'
  st.isAnswerPicked = st.isAnswerPicked; // unchanged
  markDirty();
  scheduleSave(aID);

  // Update question grid color
  evaluateQuestionButtonColor(qID);
}

// ---------- Bootstrap: fetch assignment, build UI, load state ----------
fetch(`./data/question_data/${aID}/assignment.json`)
  .then(res => res.json())
  .then(async data => {
    // 1) passages
    processPassageQuestions(data.questions);
    questionData = data;

    // 2) filter out Passage markers for display
    const allQuestions = data.questions;
    const displayQuestions = [];
    const questionIndexMap = [];
    allQuestions.forEach((q, idx) => {
      if (q.qType !== 'Passage') {
        displayQuestions.push(q);
        questionIndexMap.push(idx);
      }
    });
    window.displayQuestions = displayQuestions;
    window.questionIndexMap = questionIndexMap;

    // 3) build UI and states
    fillQuestionData(displayQuestions);

    // 4) load saved state (server/local), then pad
    await loadSavedState(aID);
    ensureStateLength(displayQuestions.length);

    // 5) paint buttons + open first
    questionButtons.forEach((_, i) => evaluateQuestionButtonColor(i));
    const qParam = parseInt(params.get('q'), 10);
    if (!isNaN(qParam) && qParam > 0 && qParam <= displayQuestions.length) {
        clickQuestionButton(qParam - 1); // convert to zero-based index
    } else {
        clickQuestionButton(0); // default to first question
    }
  });

// ---------- UI builders & handlers ----------
function fillQuestionData(questionsParam) {
  const questions = Array.isArray(questionsParam) ? questionsParam : questionsParam.questions;
  const mobile = document.getElementById('mobile-qbar');
  const desktop = document.getElementById('q_list');

  // init clean state array matching display length
  questionStates = Array(questions.length);

  mobile.innerHTML = '';
  desktop.innerHTML = '';
  questions.forEach((_, i) => {
    questionStates[i] = defaultState();

    // desktop button
    const dcol = document.createElement('div');
    dcol.className = 'col';
    const dbtn = document.createElement('button');
    dbtn.className = 'btn btn-secondary w-100 q-btn';
    dbtn.textContent = i + 1;
    dbtn.dataset.qid = i;
    dbtn.addEventListener('click', () => clickQuestionButton(i));
    dcol.appendChild(dbtn);
    desktop.appendChild(dcol);

    // mobile button
    const mbtn = document.createElement('button');
    mbtn.className = 'btn btn-secondary q-btn';
    mbtn.textContent = i + 1;
    mbtn.dataset.qid = i;
    mbtn.addEventListener('click', () => clickQuestionButton(i));
    mobile.appendChild(mbtn);
  });

  questionButtons = Array.from(document.getElementsByClassName('q-btn'));
}

function MCQOptionClicked(optionElement) {
  const clickedOption = optionElement.dataset.opt;
  const originalIdx   = window.questionIndexMap[currentQuestionID];
  const question      = questionData.questions[originalIdx];
  const questionState = questionStates[currentQuestionID];
  const questionType  = question.qType;

  if (questionType === "SMCQ") {
    optionButtons.forEach(el => el.classList.remove('mcq-option-selected'));
    if (clickedOption === questionState.pickedAnswer) {
      questionState.pickedAnswer = '';
      questionState.isAnswerPicked = false;
    } else {
      optionElement.classList.add('mcq-option-selected');
      questionState.pickedAnswer = clickedOption;
      questionState.isAnswerPicked = true;
    }
  } else if (questionType === "MMCQ") {
    const idx = questionState.pickedAnswers.indexOf(clickedOption);
    if (idx !== -1) {
      questionState.pickedAnswers.splice(idx, 1);
      optionElement.classList.remove('mcq-option-selected');
    } else {
      optionElement.classList.add('mcq-option-selected');
      questionState.pickedAnswers.push(clickedOption);
    }
    questionState.isAnswerPicked = questionState.pickedAnswers.length > 0;
  }

  evaluateQuestionButtonColor(currentQuestionID);
  markDirty();
  scheduleSave(aID);
}

function evaluateQuestionButtonColor(qID) {
  const idx = Number(qID);
  const qs = questionStates[idx] || defaultState();

  // Remove previous states
  questionButtons.forEach((button) => {
    if (Number(button.dataset.qid) === idx) {
      button.classList.remove('unevaluated','correct','incorrect','partial');
    }
  });

  // Unevaluated but picked → yellow marker (“unevaluated” pill you already had)
  if (!qs.isAnswerEvaluated) {
    if (qs.isAnswerPicked) {
      questionButtons.forEach((button) => {
        if (Number(button.dataset.qid) === idx) button.classList.add('unevaluated');
      });
    }
    return;
  }

  // Evaluated → correct/partial/incorrect
  const cls =
    qs.evalStatus === 'correct'  ? 'correct'  :
    qs.evalStatus === 'partial'  ? 'partial'  :
                                   'incorrect';

  questionButtons.forEach((button) => {
    if (Number(button.dataset.qid) === idx) button.classList.add(cls);
  });
}


function clickQuestionButton(qID) {
  // Save any pending changes from the previously open question only after the first selection.
  if (currentQuestionID != null) {
    markDirty();
    scheduleSave(aID);
  }

  questionButtons.forEach((button) => {
    if (Number(button.dataset.qid) === currentQuestionID) button.classList.remove("selected");
    if (Number(button.dataset.qid) === qID)               button.classList.add("selected");
  });

  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  currentQuestionID = qID;
  setQuestion(qID);
  evaluateQuestionButtonColor(qID);
}

function setQuestion(qID) {

  // 1) Always start with a clean slate for MCQ visuals
  optionButtons.forEach(btn => {
    btn.classList.remove('correct','wrong','missed','disabled','mcq-option-selected');
  });

  // 2) Also reset numerical UI defaults whenever we enter a question
  numericalInput.disabled = false;
  numericalInput.classList.remove('is-correct','is-wrong');
  const numAnsWrap = document.getElementById('numericalAnswer')?.parentElement;
  if (numAnsWrap) numAnsWrap.style.display = 'none';

  // 3) Hide the per-question reset icon by default; we’ll show it again if evaluated
  const resetIcon = document.getElementById('reset-question-icon');
  if (resetIcon) resetIcon.classList.add('d-none');

  ensureStateLength(window.displayQuestions.length);

  const originalIdx = window.questionIndexMap[qID];
  const numerical   = document.getElementById("numericalDiv");
  const MCQOptions  = document.getElementById("MCQOptionDiv");
  const assignmentDetails = document.getElementById("assignmentDetails");
  const typeInfo    = document.getElementById("qTypeInfo");
  const qNo         = document.getElementById("qNo");
  const numericalAnswer = document.getElementById("numericalAnswer");
  const notesInput = document.getElementById('notesInput');
  const questionState = questionStates[qID];
  const question    = questionData.questions[originalIdx];

  qNo.textContent = qID + 1;
  typeInfo.textContent = question.qType;
  assignmentDetails.textContent = questionData.title;

  // Passage (text + image)
  const passageImgDiv = document.getElementById('passageImage');
  const passageDiv    = document.getElementById('passageText');
  if (question.passage) {
    if (question.passageImage) {
      passageImgDiv.style.display = 'block';
      passageImgDiv.innerHTML = `<img src="./data/question_data/${aID}/${question.passageImage}" alt="Passage image">`;
    } else {
      passageImgDiv.style.display = 'none';
      passageImgDiv.innerHTML = '';
    }
    passageDiv.style.display = 'block';
    passageDiv.textContent = question.passage;
    renderMathInElement(passageDiv, katexOptions);
  } else {
    passageImgDiv.style.display = 'none';
    passageDiv.style.display    = 'none';
    passageImgDiv.innerHTML = '';
    passageDiv.innerHTML    = '';
  }

  // Question image + text
  const qImgDiv  = document.getElementById('questionImage');
  const qTextElm = document.getElementById('questionText');
  if (question.image) {
    qImgDiv.style.display = 'block';
    qImgDiv.innerHTML = `<img src="./data/question_data/${aID}/${question.image}" alt="Question image">`;
  } else {
    qImgDiv.style.display ='none';
    qImgDiv.innerHTML = '';
  }
  qTextElm.textContent = question.qText;
  renderMathInElement(qTextElm, katexOptions);

  // --- Timer control ---
  if (timerInterval) clearInterval(timerInterval);

  const timerElem = document.getElementById('timer');
  timerElem.textContent = formatTime(questionStates[qID].time);

  // Only tick if the question is NOT yet evaluated
  if (!questionStates[qID].isAnswerEvaluated) {
    timerInterval = setInterval(() => {
      questionStates[qID].time++;
      timerElem.textContent = formatTime(questionStates[qID].time);
      markDirty(); // keep local change; don't scheduleSave here
    }, 1000);
  } else {
    timerInterval = null; // ensure paused
  }


  // Reset MCQ selection UI
  optionButtons.forEach(btn => btn.classList.remove('mcq-option-selected'));
  if (question.qType === "SMCQ" && questionState.pickedAnswer) {
    const selBtn = optionButtons.find(b => b.dataset.opt === questionState.pickedAnswer);
    if (selBtn) selBtn.classList.add('mcq-option-selected');
  } else if (question.qType === "MMCQ" && questionState.pickedAnswers.length) {
    questionState.pickedAnswers.forEach(opt => {
      const selBtn = optionButtons.find(b => b.dataset.opt === opt);
      if (selBtn) selBtn.classList.add('mcq-option-selected');
    });
  }

  if (questionState.isAnswerEvaluated) {
    if (question.qType === 'SMCQ') {
      const correct = normalizeAnswer(question);
      const picked  = getUserSelection(questionState, 'SMCQ');
      clearMCQVisuals();
      applyMCQEvaluationStyles(correct, picked);
    } else if (question.qType === 'MMCQ') {
      const correct = normalizeAnswer(question);
      const picked  = getUserSelection(questionState, 'MMCQ');
      clearMCQVisuals();
      applyMCQEvaluationStyles(correct, picked);
    } else if (question.qType === 'Numerical') {
      const ans = normalizeAnswer(question);
      const user = getUserSelection(questionState, 'Numerical');
      const isCorrect = (typeof user === 'number' && ans.valid && user === ans.value);
      applyNumericalEvaluationStyles(isCorrect);
      if (numericalAnswer) numericalAnswer.parentElement.style.display = 'block';
    }
  } else {
    // Not evaluated yet → ensure reset icon hidden
    const icon = document.getElementById('reset-question-icon');
    if (icon) icon.classList.add('d-none');
  }

  // Show numerical vs MCQ
  if (question.qType === "Numerical") {
    numericalAnswer.textContent = question.qAnswer;
    numerical.style.display = "block";
    MCQOptions.style.display  = "none";
    numericalInput.value = (questionStates[qID].pickedNumerical ?? "");
  } else {
    const A = document.getElementById("AContent");
    const B = document.getElementById("BContent");
    const C = document.getElementById("CContent");
    const D = document.getElementById("DContent");

    A.textContent = question.qOptions[0];
    B.textContent = question.qOptions[1];
    C.textContent = question.qOptions[2];
    D.textContent = question.qOptions[3];

    renderMathInElement(A, katexOptions);
    renderMathInElement(B, katexOptions);
    renderMathInElement(C, katexOptions);
    renderMathInElement(D, katexOptions);

    numerical.style.display = "none";
    MCQOptions.style.display = "block";
    renderMathInElement(MCQOptions, katexOptions);
  }

  // Toggle which action button to show for this question
  const checkBtn = document.getElementById('check-answer');
  const resetBtn = document.getElementById('reset-question');

  if (questionState.isAnswerEvaluated) {
    checkBtn.classList.add('d-none');
    resetBtn.classList.remove('d-none');
  } else {
    resetBtn.classList.add('d-none');
    checkBtn.classList.remove('d-none');
  }

  // Populate notes for this question
  if (notesInput) notesInput.value = questionState.notes || '';
  
  // Update bookmark button state
  updateBookmarkButton();
}

// --- Bookmark functionality ---

let currentBookmarks = [];
let bookmarkTags = [];

async function updateBookmarkButton() {
  const bookmarkBtn = document.getElementById('bookmark-btn');
  const icon = bookmarkBtn.querySelector('i');
  
  try {
    const response = await authFetch(`${API_BASE}/api/bookmarks/${aID}/${currentQuestionID}`);
    if (response.ok) {
      currentBookmarks = await response.json();
      if (currentBookmarks.length > 0) {
        bookmarkBtn.classList.remove('btn-outline-primary');
        bookmarkBtn.classList.add('btn-primary');
        icon.className = 'bi bi-bookmark-fill';
        bookmarkBtn.title = `Bookmarked with ${currentBookmarks.length} tag(s)`;
      } else {
        bookmarkBtn.classList.remove('btn-primary');
        bookmarkBtn.classList.add('btn-outline-primary');
        icon.className = 'bi bi-bookmark';
        bookmarkBtn.title = 'Bookmark this question';
      }
    }
  } catch (error) {
    console.error('Failed to update bookmark button:', error);
  }
}

async function showBookmarkDialog() {
  try {
    const response = await authFetch(`${API_BASE}/api/bookmark-tags`);
    if (!response.ok) {
      if (response.status === 401) {
        window.dispatchEvent(new Event('qbase:logout'));
        return;
      }
      throw new Error(`HTTP ${response.status}`);
    }
    bookmarkTags = await response.json();
    
    // Create dialog content
    const currentTagIds = currentBookmarks.map(b => b.tagId);
    const availableTags = bookmarkTags.filter(tag => !currentTagIds.includes(tag.id));
    
    let bodyHTML = '';
    
    if (currentBookmarks.length > 0) {
      bodyHTML += '<div class="mb-3"><strong>Current bookmarks:</strong><br>';
      for (const bookmark of currentBookmarks) {
        const tag = bookmarkTags.find(t => t.id === bookmark.tagId);
        if (tag) {
          bodyHTML += `
            <div class="d-flex justify-content-between align-items-center mb-1">
              <span class="badge bg-primary">${escapeHtml(tag.name)}</span>
              <button class="btn btn-sm btn-outline-danger remove-bookmark-btn" 
                      data-tag-id="${tag.id}">
                <i class="bi bi-x"></i>
              </button>
            </div>
          `;
        }
      }
      bodyHTML += '</div>';
    }
    
    if (availableTags.length > 0) {
      bodyHTML += '<div class="mb-3"><strong>Add to tag:</strong><br>';
      for (const tag of availableTags) {
        bodyHTML += `
          <button class="btn btn-outline-primary btn-sm me-2 mb-1 add-bookmark-btn" 
                  data-tag-id="${tag.id}">
            ${escapeHtml(tag.name)}
          </button>
        `;
      }
      bodyHTML += '</div>';
    }
    
    bodyHTML += `
      <div class="mb-3">
        <strong>Create new tag:</strong>
        <div class="input-group mt-2">
          <input type="text" class="form-control" id="new-tag-input" placeholder="Enter tag name...">
          <button class="btn btn-outline-success" id="create-tag-btn">
            <i class="bi bi-plus"></i>
          </button>
        </div>
      </div>
    `;
    
    // Show modal with onContentReady callback to attach event listeners
    const modal = await showModal({
      title: 'Bookmark Question',
      bodyHTML: bodyHTML,
      buttons: [
        { text: 'Close', className: 'btn btn-secondary', value: 'close' }
      ],
      onContentReady: (modalEl) => {
        // Add event listeners to modal content
        const modalBody = modalEl.querySelector('#qbaseModalBody');
        
        // Remove bookmark buttons
        modalBody.querySelectorAll('.remove-bookmark-btn').forEach(btn => {
          btn.addEventListener('click', async () => {
            const tagId = btn.dataset.tagId;
            if (await removeBookmark(tagId)) {
              updateBookmarkButton();
              refreshBookmarkDialog(modalEl); // Refresh current modal content
            }
          });
        });
        
        // Add bookmark buttons
        modalBody.querySelectorAll('.add-bookmark-btn').forEach(btn => {
          btn.addEventListener('click', async () => {
            const tagId = btn.dataset.tagId;
            if (await addBookmark(tagId)) {
              updateBookmarkButton();
              refreshBookmarkDialog(modalEl); // Refresh current modal content
            }
          });
        });
        
        // Create new tag
        const createTagBtn = modalBody.querySelector('#create-tag-btn');
        const newTagInput = modalBody.querySelector('#new-tag-input');
        
        createTagBtn.addEventListener('click', async () => {
          const tagName = newTagInput.value.trim();
          if (tagName) {
            if (await createBookmarkTag(tagName)) {
              updateBookmarkButton();
              refreshBookmarkDialog(modalEl); // Refresh current modal content
            }
          }
        });
        
        newTagInput.addEventListener('keydown', async (e) => {
          if (e.key === 'Enter') {
            const tagName = newTagInput.value.trim();
            if (tagName) {
              if (await createBookmarkTag(tagName)) {
                updateBookmarkButton();
                refreshBookmarkDialog(modalEl); // Refresh current modal content
              }
            }
          }
        });
      }
    });
    
  } catch (error) {
    console.error('Failed to show bookmark dialog:', error);
    await showNotice({ title: 'Error', message: 'Failed to load bookmark options' });
  }
}

// Helper function to refresh the bookmark dialog content in-place
async function refreshBookmarkDialog(modalEl) {
  try {
    // Reload bookmark tags and current bookmarks
    const response = await authFetch(`${API_BASE}/api/bookmark-tags`);
    if (!response.ok) {
      if (response.status === 401) {
        window.dispatchEvent(new Event('qbase:logout'));
        return;
      }
      throw new Error(`HTTP ${response.status}`);
    }
    bookmarkTags = await response.json();
    
    // Reload current bookmarks for this question
    const bookmarkResponse = await authFetch(`${API_BASE}/api/bookmarks/${aID}/${currentQuestionID}`);
    if (bookmarkResponse.ok) {
      currentBookmarks = await bookmarkResponse.json();
    } else {
      currentBookmarks = [];
    }
    
    // Create updated dialog content
    const currentTagIds = currentBookmarks.map(b => b.tagId);
    const availableTags = bookmarkTags.filter(tag => !currentTagIds.includes(tag.id));
    
    let bodyHTML = '';
    
    if (currentBookmarks.length > 0) {
      bodyHTML += '<div class="mb-3"><strong>Current bookmarks:</strong><br>';
      for (const bookmark of currentBookmarks) {
        const tag = bookmarkTags.find(t => t.id === bookmark.tagId);
        if (tag) {
          bodyHTML += `
            <div class="d-flex justify-content-between align-items-center mb-1">
              <span class="badge bg-primary">${escapeHtml(tag.name)}</span>
              <button class="btn btn-sm btn-outline-danger remove-bookmark-btn" 
                      data-tag-id="${tag.id}">
                <i class="bi bi-x"></i>
              </button>
            </div>
          `;
        }
      }
      bodyHTML += '</div>';
    }
    
    if (availableTags.length > 0) {
      bodyHTML += '<div class="mb-3"><strong>Add to tag:</strong><br>';
      for (const tag of availableTags) {
        bodyHTML += `
          <button class="btn btn-outline-primary btn-sm me-2 mb-1 add-bookmark-btn" 
                  data-tag-id="${tag.id}">
            ${escapeHtml(tag.name)}
          </button>
        `;
      }
      bodyHTML += '</div>';
    }
    
    bodyHTML += `
      <div class="mb-3">
        <strong>Create new tag:</strong>
        <div class="input-group mt-2">
          <input type="text" class="form-control" id="new-tag-input" placeholder="Enter tag name...">
          <button class="btn btn-outline-success" id="create-tag-btn">
            <i class="bi bi-plus"></i>
          </button>
        </div>
      </div>
    `;
    
    // Update the modal content
    const modalBody = modalEl.querySelector('#qbaseModalBody');
    modalBody.innerHTML = bodyHTML;
    
    // Re-attach event listeners to the new content
    // Remove bookmark buttons
    modalBody.querySelectorAll('.remove-bookmark-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const tagId = btn.dataset.tagId;
        if (await removeBookmark(tagId)) {
          updateBookmarkButton();
          refreshBookmarkDialog(modalEl); // Refresh current modal content
        }
      });
    });
    
    // Add bookmark buttons
    modalBody.querySelectorAll('.add-bookmark-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const tagId = btn.dataset.tagId;
        if (await addBookmark(tagId)) {
          updateBookmarkButton();
          refreshBookmarkDialog(modalEl); // Refresh current modal content
        }
      });
    });
    
    // Create new tag
    const createTagBtn = modalBody.querySelector('#create-tag-btn');
    const newTagInput = modalBody.querySelector('#new-tag-input');
    
    createTagBtn.addEventListener('click', async () => {
      const tagName = newTagInput.value.trim();
      if (tagName) {
        if (await createBookmarkTag(tagName)) {
          updateBookmarkButton();
          refreshBookmarkDialog(modalEl); // Refresh current modal content
        }
      }
    });
    
    newTagInput.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        const tagName = newTagInput.value.trim();
        if (tagName) {
          if (await createBookmarkTag(tagName)) {
            updateBookmarkButton();
            refreshBookmarkDialog(modalEl); // Refresh current modal content
          }
        }
      }
    });
    
  } catch (error) {
    console.error('Failed to refresh bookmark dialog:', error);
  }
}

async function addBookmark(tagId) {
  try {
    const response = await authFetch(`${API_BASE}/api/bookmarks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assignmentId: aID,
        questionIndex: currentQuestionID,
        tagId: tagId
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to add bookmark');
    }
    
    return true;
  } catch (error) {
    console.error('Failed to add bookmark:', error);
    await showNotice({ title: 'Error', message: error.message || 'Failed to add bookmark' });
    return false;
  }
}

async function removeBookmark(tagId) {
  try {
    const response = await authFetch(`${API_BASE}/api/bookmarks/${aID}/${currentQuestionID}/${tagId}`, {
      method: 'DELETE'
    });
    
    if (!response.ok) {
      throw new Error('Failed to remove bookmark');
    }
    
    return true;
  } catch (error) {
    console.error('Failed to remove bookmark:', error);
    await showNotice({ title: 'Error', message: 'Failed to remove bookmark' });
    return false;
  }
}

async function createBookmarkTag(tagName) {
  try {
    const response = await authFetch(`${API_BASE}/api/bookmark-tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: tagName })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create tag');
    }
    
    const newTag = await response.json();
    
    // Automatically add bookmark to the new tag
    return await addBookmark(newTag.id);
    
  } catch (error) {
    console.error('Failed to create bookmark tag:', error);
    await showNotice({ title: 'Error', message: error.message || 'Failed to create tag' });
    return false;
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
})();
