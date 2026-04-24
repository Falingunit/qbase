"use strict";

(() => {
  const params = new URLSearchParams(window.location.search);
  const testId = String(params.get("testId") || "").trim();
  const attemptId = String(params.get("attemptId") || "").trim();
  const runtime = window.QBaseTestAttemptRuntime?.create({
    mode: "take",
    testId,
    attemptId,
  });
  const utils = window.QBaseTestAttemptRuntime?.utils || {};

  if (!runtime) {
    throw new Error("QBaseTestAttemptRuntime is required before test-attempt-exam.js");
  }

  const elements = {
    title: document.querySelector(".subjectDetailHead.mockName"),
    headerTitle: document.getElementById("exam_name_h1"),
    timerHours: document.getElementById("m01_hrs"),
    timerMinutes: document.getElementById("min_val"),
    timerSeconds: document.getElementById("sec01_val"),
    timerCompact: document.getElementById("timeInMins"),
    back: document.getElementById("exam-back-link"),
    candidateName: document.getElementById("candidate-name"),
    candidateAttempt: document.getElementById("candidate-attempt"),
    sectionTabs: document.getElementById("sections"),
    sectionLeftArrow: document.getElementById("sections-left-arrow"),
    sectionRightArrow: document.getElementById("sections-right-arrow"),
    sectionTitle: document.getElementById("current-section-title"),
    answeredCount: document.querySelector(".answeredCount"),
    notAnsweredCount: document.querySelector(".notAnsweredCount"),
    notVisitedCount: document.querySelector(".notVisitedCount"),
    markedCount: document.querySelector(".markedCount"),
    markedAnsweredCount: document.querySelector(".markedAnsweredCount"),
    questionType: document.getElementById("questiontype-details_id"),
    questionHeader: document.getElementById("divHeader_id"),
    questionBody: document.getElementById("quesAnsContent"),
    questionScroll: document.querySelector(".qbase-question-scroll"),
    palette: document.getElementById("numberpanelQues"),
    previousBtn: document.getElementById("previousBtn"),
    clearBtn: document.getElementById("clearResponse"),
    markReviewBtn: document.getElementById("underreview"),
    saveNextBtn: document.getElementById("savenext"),
    submitBtn: document.getElementById("finalSubmit"),
    scrollToBottom: document.getElementById("scrollToBottom"),
    scrollToTop: document.getElementById("scrollToTop"),
    imageOverlay: document.getElementById("image-overlay"),
    imageOverlayImage: document.getElementById("image-overlay-img"),
    imageOverlayClose: document.getElementById("image-overlay-close"),
  };

  let payload = null;
  let questions = [];
  let state = [];
  let sections = [];
  let currentIndex = 0;
  let currentSectionKey = "";
  let sectionIndexByQuestion = new Map();
  let saveTimer = null;
  let flushInFlight = Promise.resolve();

  runtime.subscribe((snapshot) => {
    if (!snapshot) return;
    if (snapshot.payload) payload = snapshot.payload;
    if (Array.isArray(snapshot.questions) && snapshot.questions.length) questions = snapshot.questions;
    if (Array.isArray(snapshot.state)) state = cloneState(snapshot.state);
    updateTimer(snapshot.remainingSeconds);
    if (sections.length) renderSectionTabs();
    updateLegend();
    updatePalette();
    updateActionState();
  });

  initialize().catch((error) => {
    console.error("test attempt exam init failed:", error);
    renderFatal(error?.message || "Failed to load test attempt.");
  });

  async function initialize() {
    await runtime.init();
    payload = runtime.getPayload();
    questions = runtime.getQuestions();
    state = cloneState(runtime.getState());
    sections = buildSections(questions);
    sectionIndexByQuestion = new Map();
    sections.forEach((section) => {
      section.indices.forEach((index) => sectionIndexByQuestion.set(index, section.key));
    });

    const title = payload?.test?.title || "Test Attempt";
    if (elements.title) elements.title.textContent = title;
    if (elements.headerTitle) elements.headerTitle.textContent = title;
    if (elements.back) elements.back.href = `./test_overview.html?testId=${encodeURIComponent(testId)}`;
    if (elements.candidateAttempt) {
      elements.candidateAttempt.textContent = payload?.attempt?.attemptId
        ? `Attempt ID: ${payload.attempt.attemptId}`
        : "Attempt";
    }

    attachEvents();
    await hydrateCandidateName();

    if (!questions.length) {
      renderEmpty();
      return;
    }

    const requestedIndex = Math.max(0, Number(params.get("q") || 1) - 1 || 0);
    currentIndex = Math.min(requestedIndex, Math.max(questions.length - 1, 0));
    currentSectionKey = sectionIndexByQuestion.get(currentIndex) || sections[0]?.key || "";
    ensureVisited(currentIndex, { schedule: true });
    renderSectionTabs();
    renderQuestion();
    updateLegend();
    updatePalette();
    updateActionState();
    updateSectionArrows();
  }

  function attachEvents() {
    elements.previousBtn?.addEventListener("click", () => {
      navigateRelative(-1).catch((error) => console.error("previous question failed:", error));
    });
    elements.clearBtn?.addEventListener("click", () => clearCurrentResponse());
    elements.markReviewBtn?.addEventListener("click", () => {
      markReviewAndNext().catch((error) => console.error("mark review failed:", error));
    });
    elements.saveNextBtn?.addEventListener("click", () => {
      saveAndNext().catch((error) => console.error("save next failed:", error));
    });
    elements.submitBtn?.addEventListener("click", () => {
      flushSave(true)
        .catch(() => {})
        .then(() => runtime.submitAttempt(false))
        .catch((error) => console.error("submit failed:", error));
    });

    elements.scrollToBottom?.addEventListener("click", (event) => {
      event.preventDefault();
      elements.questionScroll?.scrollTo({ top: elements.questionScroll.scrollHeight, behavior: "smooth" });
    });
    elements.scrollToTop?.addEventListener("click", (event) => {
      event.preventDefault();
      elements.questionScroll?.scrollTo({ top: 0, behavior: "smooth" });
    });
    elements.imageOverlayClose?.addEventListener("click", closeImageOverlay);
    elements.imageOverlay?.addEventListener("click", (event) => {
      if (event.target === elements.imageOverlay) closeImageOverlay();
    });

    elements.sectionLeftArrow?.addEventListener("click", () => {
      scrollSections(-240);
    });
    elements.sectionRightArrow?.addEventListener("click", () => {
      scrollSections(240);
    });
    elements.sectionTabs?.addEventListener("scroll", updateSectionArrows, { passive: true });
    window.addEventListener("resize", updateSectionArrows);

    window.addEventListener("pagehide", flushKeepalive, { capture: true });
    window.addEventListener("beforeunload", flushKeepalive, { capture: true });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushKeepalive();
    });
  }

  async function hydrateCandidateName() {
    try {
      const res = await authFetch(`${API_BASE}/me`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const me = await res.json();
      if (me?.username && elements.candidateName) {
        elements.candidateName.textContent = me.username;
        elements.candidateName.title = me.username;
      }
    } catch {
      if (elements.candidateName) elements.candidateName.textContent = "Candidate";
    }
  }

  function buildSections(items) {
    const map = new Map();
    items.forEach((question, index) => {
      const subjectName = String(question?.subjectName || "Unknown Subject").trim() || "Unknown Subject";
      const sectionName = String(question?.sectionName || "Section").trim() || "Section";
      const key = `${subjectName}::${sectionName}`;
      const lowerSection = sectionName.toLowerCase();
      const lowerSubject = subjectName.toLowerCase();
      const fullLabel = lowerSection.includes(lowerSubject)
        ? sectionName
        : `${subjectName} ${sectionName}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          subjectName,
          sectionName,
          label: fullLabel,
          shortLabel: sectionName,
          fullLabel,
          indices: [],
        });
      }
      map.get(key).indices.push(index);
    });
    return Array.from(map.values());
  }

  function cloneState(items) {
    return Array.isArray(items)
      ? items.map((item) => ({
          ...(item || {}),
          pickedAnswers: Array.isArray(item?.pickedAnswers) ? item.pickedAnswers.slice() : [],
        }))
      : [];
  }

  function defaultState() {
    return {
      isAnswerPicked: false,
      pickedAnswers: [],
      pickedAnswer: "",
      pickedNumerical: undefined,
      markedForReview: false,
      visited: false,
      time: 0,
      notes: "",
      resetLockedUntil: 0,
    };
  }

  function getCurrentQuestion() {
    return questions[currentIndex] || null;
  }

  function getCurrentState() {
    if (!state[currentIndex]) state[currentIndex] = defaultState();
    return state[currentIndex];
  }

  function getCurrentSection() {
    return sections.find((section) => section.key === currentSectionKey) || sections[0] || null;
  }

  function commitState({ schedule = false } = {}) {
    state = runtime.setState(state);
    if (schedule) scheduleSave();
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      flushSave(false).catch((error) => console.warn("exam attempt autosave failed:", error));
    }, 800);
  }

  function flushKeepalive() {
    try {
      clearTimeout(saveTimer);
      runtime.setState(state);
      runtime.flushKeepalive();
    } catch {}
  }

  async function flushSave(force) {
    clearTimeout(saveTimer);
    flushInFlight = flushInFlight.catch(() => {}).then(async () => {
      runtime.setState(state);
      if (force || questions.length) {
        await runtime.saveNow();
      }
    });
    return flushInFlight;
  }

  function ensureVisited(index, { schedule = false } = {}) {
    if (!state[index]) state[index] = defaultState();
    if (state[index].visited) return;
    state[index].visited = true;
    commitState({ schedule });
  }

  function updateTimer(remainingSeconds) {
    if (remainingSeconds == null) {
      setClock("00", "00", "00");
      if (elements.timerCompact) elements.timerCompact.textContent = "No Limit";
      return;
    }
    const total = Math.max(0, Math.floor(Number(remainingSeconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    setClock(String(hours).padStart(2, "0"), String(minutes).padStart(2, "0"), String(seconds).padStart(2, "0"));
    if (elements.timerCompact) {
      elements.timerCompact.textContent = `${Math.floor(total / 60)}:${String(seconds).padStart(2, "0")}`;
    }
  }

  function setClock(hours, minutes, seconds) {
    if (elements.timerHours) elements.timerHours.textContent = hours;
    if (elements.timerMinutes) elements.timerMinutes.textContent = minutes;
    if (elements.timerSeconds) elements.timerSeconds.textContent = seconds;
  }

  function renderSectionTabs() {
    if (!elements.sectionTabs) return;
    elements.sectionTabs.innerHTML = "";
    sections.forEach((section, index) => {
      const counts = getCountsForSection(section);
      const tab = document.createElement("div");
      tab.className = `subject-name${section.key === currentSectionKey ? " selectedsubject" : ""}`;
      tab.id = `s${index}`;
      tab.tabIndex = section.key === currentSectionKey ? 0 : -1;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", "currentQues");
      tab.setAttribute("aria-selected", section.key === currentSectionKey ? "true" : "false");
      tab.innerHTML = `
        <span style="vertical-align: middle" class="sectionName" title="${escapeAttr(section.fullLabel)}">${escapeHtml(section.label)}</span>
        <span aria-hidden="true" class="tooltip1">
          <div aria-label="section info" role="button" aria-controls="subject_info_sec${index}" aria-haspopup="true" aria-expanded="false" class="subject_instruction_icon1 subject_instruction_icon_section" id="icon${index}"></div>
          <div role="tooltip" id="subject_info_sec${index}" class="subject_information_div1">
            <div><div role="heading" aria-level="2" class="subject_name" style="text-align:left">${escapeHtml(section.fullLabel)}</div></div>
            <div role="list" class="notation_type_description diff_type_notation_area_inner" style="background: #e5f6fc; text-align: left; padding-left: 8px;">
              <div role="listitem" class="notation_typeDiv" title="Answered"><span class="answered">${counts.answered}</span><span class="type_title secAnswered longtext-hide1" style="text-align:left">Answered</span></div>
              <div role="listitem" class="notation_typeDiv" title="Not Answered"><span class="not_answered">${counts["not-answered"]}</span><span class="type_title secNotAnswered longtext-hide1" style="text-align:left">Not Answered</span></div>
              <div role="listitem" class="notation_typeDiv" title="Not Visited"><span class="not_visited">${counts["not-visited"]}</span><span class="type_title secNotAttempted longtext-hide1" style="text-align:left">Not Visited</span></div>
              <div role="listitem" class="notation_typeDiv" title="Marked for Review"><span class="review">${counts["marked-review"]}</span><span class="type_title secMarkReview longtext-hide1" style="text-align:left">Marked for Review</span></div>
              <div role="listitem" class="notation_typeDiv review_answer" title="Answered &amp; Marked for Review (will also be evaluated)"><span class="review_answered">${counts["answered-marked"]}</span><span class="type_title secMarkedAndAnswered longtext-hide1" style="text-align:left">Answered &amp; Marked for Review (will also be evaluated)</span></div>
            </div>
          </div>
        </span>
      `;
      tab.addEventListener("click", () => {
        changeSection(section.key).catch((error) => console.error("change section failed:", error));
      });
      tab.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          changeSection(section.key).catch((error) => console.error("change section failed:", error));
        }
      });
      elements.sectionTabs.appendChild(tab);
    });
    window.setTimeout(updateSectionArrows, 0);
  }

  async function changeSection(sectionKey) {
    if (!sectionKey || sectionKey === currentSectionKey) return;
    await flushSave(true);
    const section = sections.find((item) => item.key === sectionKey);
    if (!section?.indices?.length) return;
    currentSectionKey = section.key;
    currentIndex = section.indices[0];
    ensureVisited(currentIndex, { schedule: true });
    renderSectionTabs();
    renderQuestion();
    updateLegend();
    updatePalette();
    updateActionState();
    focusSectionTab(section.key);
  }

  function focusSectionTab(sectionKey) {
    const section = sections.find((item) => item.key === sectionKey);
    if (!section) return;
    const index = sections.indexOf(section);
    const tab = document.getElementById(`s${index}`);
    tab?.focus();
    tab?.scrollIntoView({ inline: "nearest", block: "nearest" });
    updateSectionArrows();
  }

  function renderQuestion() {
    const question = getCurrentQuestion();
    if (!question) {
      renderEmpty();
      return;
    }

    const section = getCurrentSection();
    if (elements.sectionTitle) {
      elements.sectionTitle.textContent = section?.fullLabel || "Current Section";
      elements.sectionTitle.title = section?.fullLabel || "Current Section";
    }

    if (elements.questionType) {
      elements.questionType.innerHTML = `<span class="questionType langLabel" lang="en">Question Type: </span>${escapeHtml(toQuestionTypeLabel(question.qType))}`;
    }
    if (elements.questionHeader) {
      elements.questionHeader.innerHTML = `<b><span class="questionNumber langLabel" lang="en">Question No</span>. ${currentIndex + 1}</b>`;
    }

    renderQuestionContent(question);
    renderSectionTabs();
    updateLegend();
    updatePalette();
    updateActionState();
    if (elements.questionScroll) elements.questionScroll.scrollTop = 0;
  }

  function renderQuestionContent(question) {
    const currentState = getCurrentState();
    if (!elements.questionBody) return;
    elements.questionBody.innerHTML = "";

    const container = document.createElement("div");
    container.className = "qbase-question-block";

    if (String(question.passage || "").trim()) {
      const passage = document.createElement("div");
      passage.className = "qbase-passage";
      renderHtml(passage, question.passage || "");
      container.appendChild(passage);
    }

    if (String(question.passageImage || "").trim()) {
      container.appendChild(renderStandaloneImage(question.passageImage, "Passage image"));
    }

    const questionText = document.createElement("div");
    questionText.className = "qbase-question-text";
    renderHtml(questionText, question.qText || "");
    container.appendChild(questionText);

    if (String(question.image || "").trim()) {
      container.appendChild(renderStandaloneImage(question.image, "Question image"));
    }

    if (question.qType === "Numerical") {
      const wrap = document.createElement("div");
      wrap.className = "qbase-numerical-wrap";
      const label = document.createElement("label");
      label.setAttribute("for", "qbase-numerical-answer");
      label.textContent = "Enter your answer";
      const input = document.createElement("input");
      input.id = "qbase-numerical-answer";
      input.type = "number";
      input.value =
        currentState.pickedNumerical === undefined || currentState.pickedNumerical === null
          ? ""
          : String(currentState.pickedNumerical);
      input.addEventListener("input", () => {
        const raw = String(input.value || "").trim();
        currentState.pickedAnswer = "";
        currentState.pickedAnswers = [];
        currentState.pickedNumerical = raw === "" ? undefined : Number(raw);
        currentState.isAnswerPicked = raw !== "";
        commitState({ schedule: true });
        updateLegend();
        updatePalette();
        updateActionState();
      });
      wrap.appendChild(label);
      wrap.appendChild(input);
      container.appendChild(wrap);
      elements.questionBody.appendChild(container);
      return;
    }

    const optionsHost = document.createElement("div");
    optionsHost.className = "qbase-option-group";
    optionsHost.setAttribute("role", question.qType === "MMCQ" ? "group" : "radiogroup");
    (question.qOptions || []).forEach((optionHtml, optionIndex) => {
      const optionKey = String.fromCharCode(65 + optionIndex);
      const inputId = `question-${currentIndex}-option-${optionKey}`;
      const label = document.createElement("label");
      label.className = "optionLabel";
      label.setAttribute("for", inputId);

      const spanInput = document.createElement("span");
      const input = document.createElement("input");
      input.id = inputId;
      input.type = question.qType === "MMCQ" ? "checkbox" : "radio";
      input.className = `answer ${question.qType === "MMCQ" ? "checkboxBtnClass" : "MCQanswer radioBtnClass"}`;
      input.name = question.qType === "MMCQ" ? inputId : `answers-${currentIndex}`;
      input.value = optionKey;
      input.checked =
        question.qType === "MMCQ"
          ? Array.isArray(currentState.pickedAnswers) && currentState.pickedAnswers.includes(optionKey)
          : currentState.pickedAnswer === optionKey;
      input.addEventListener("change", () => {
        handleOptionChange(question, optionKey, input.checked);
      });
      spanInput.appendChild(input);

      const spanText = document.createElement("span");
      spanText.className = "labelForOptText";
      spanText.style.cssText =
        "font-family:Arial,verdana,helvetica,sans-serif;width:93%;vertical-align:top;";
      renderHtml(spanText, optionHtml || "");

      label.appendChild(spanInput);
      label.appendChild(spanText);
      optionsHost.appendChild(label);
    });

    container.appendChild(optionsHost);
    elements.questionBody.appendChild(container);
  }

  function renderStandaloneImage(src, alt) {
    const wrap = document.createElement("div");
    wrap.className = "qbase-question-block";
    const img = document.createElement("img");
    img.src = src;
    img.alt = alt || "";
    img.loading = "lazy";
    img.decoding = "async";
    img.addEventListener("click", () => openImageOverlay(src, alt || ""));
    wrap.appendChild(img);
    return wrap;
  }

  function handleOptionChange(question, optionKey, checked) {
    const currentState = getCurrentState();
    if (question.qType === "MMCQ") {
      const picked = Array.isArray(currentState.pickedAnswers) ? currentState.pickedAnswers.slice() : [];
      const existingIndex = picked.indexOf(optionKey);
      if (checked && existingIndex < 0) picked.push(optionKey);
      if (!checked && existingIndex >= 0) picked.splice(existingIndex, 1);
      currentState.pickedAnswers = picked;
      currentState.pickedAnswer = "";
      currentState.pickedNumerical = undefined;
      currentState.isAnswerPicked = picked.length > 0;
    } else {
      currentState.pickedAnswer = checked ? optionKey : "";
      currentState.pickedAnswers = [];
      currentState.pickedNumerical = undefined;
      currentState.isAnswerPicked = checked;
    }
    commitState({ schedule: true });
    updateLegend();
    updatePalette();
    updateActionState();
  }

  function clearCurrentResponse() {
    const currentState = getCurrentState();
    currentState.pickedAnswer = "";
    currentState.pickedAnswers = [];
    currentState.pickedNumerical = undefined;
    currentState.isAnswerPicked = false;
    commitState({ schedule: true });
    renderQuestion();
  }

  async function markReviewAndNext() {
    const currentState = getCurrentState();
    currentState.markedForReview = true;
    commitState({ schedule: false });
    await flushSave(true);
    moveToRelativeIndex(1);
  }

  async function saveAndNext() {
    await flushSave(true);
    moveToRelativeIndex(1);
  }

  async function navigateRelative(delta) {
    await flushSave(true);
    moveToRelativeIndex(delta);
  }

  function moveToRelativeIndex(delta) {
    const nextIndex = currentIndex + delta;
    if (nextIndex < 0 || nextIndex >= questions.length) {
      updateActionState();
      return;
    }
    currentIndex = nextIndex;
    currentSectionKey = sectionIndexByQuestion.get(currentIndex) || currentSectionKey;
    ensureVisited(currentIndex, { schedule: true });
    renderQuestion();
  }

  async function navigateToQuestion(index) {
    if (index === currentIndex) return;
    await flushSave(true);
    currentIndex = index;
    currentSectionKey = sectionIndexByQuestion.get(index) || currentSectionKey;
    ensureVisited(currentIndex, { schedule: true });
    renderQuestion();
  }

  function updateLegend() {
    const section = getCurrentSection();
    if (!section) return;
    const counts = getCountsForSection(section);
    if (elements.answeredCount) elements.answeredCount.textContent = String(counts.answered);
    if (elements.notAnsweredCount) elements.notAnsweredCount.textContent = String(counts["not-answered"]);
    if (elements.notVisitedCount) elements.notVisitedCount.textContent = String(counts["not-visited"]);
    if (elements.markedCount) elements.markedCount.textContent = String(counts["marked-review"]);
    if (elements.markedAnsweredCount) elements.markedAnsweredCount.textContent = String(counts["answered-marked"]);
  }

  function getCountsForSection(section) {
    const counts = {
      "not-visited": 0,
      "not-answered": 0,
      answered: 0,
      "marked-review": 0,
      "answered-marked": 0,
    };
    (section?.indices || []).forEach((index) => {
      counts[getStatusKey(state[index])] += 1;
    });
    return counts;
  }

  function updatePalette() {
    const section = getCurrentSection();
    if (!section || !elements.palette) return;
    elements.palette.innerHTML = "";
    const row = document.createElement("div");
    section.indices.forEach((index) => {
      const statusKey = getStatusKey(state[index]);
      const statusClass = toVendorStatusClass(statusKey);
      const holder = document.createElement("div");
      holder.id = `qtd${index}`;
      const span = document.createElement("span");
      span.objid = toVendorStatusText(statusKey);
      span.id = String(index);
      span.className = `tipIcon numpan ${statusClass} auditlog ${index}${index === currentIndex ? " qbase-current" : ""}`;
      span.tabIndex = index === currentIndex ? 0 : -1;
      span.setAttribute("role", "tab");
      span.setAttribute("aria-controls", "currentQues");
      span.setAttribute("aria-selected", index === currentIndex ? "true" : "false");
      span.setAttribute("aria-label", `Question ${index + 1}, ${toVendorStatusText(statusKey)}`);
      span.textContent = ` ${index + 1}`;
      span.addEventListener("click", () => {
        navigateToQuestion(index).catch((error) => console.error("navigate to question failed:", error));
      });
      span.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          navigateToQuestion(index).catch((error) => console.error("navigate to question failed:", error));
        }
      });
      holder.appendChild(span);
      row.appendChild(holder);
    });
    elements.palette.appendChild(row);
  }

  function updateActionState() {
    if (elements.previousBtn) elements.previousBtn.disabled = currentIndex <= 0;
    if (elements.clearBtn) elements.clearBtn.disabled = !utils.hasAnswer?.(getCurrentState());
    if (elements.markReviewBtn) elements.markReviewBtn.disabled = questions.length === 0;
    if (elements.saveNextBtn) elements.saveNextBtn.disabled = questions.length === 0;
    if (elements.submitBtn) elements.submitBtn.disabled = questions.length === 0;
  }

  function getStatusKey(answerState) {
    const row = answerState || defaultState();
    const answered = utils.hasAnswer?.(row);
    if (!row.visited) return "not-visited";
    if (row.markedForReview && answered) return "answered-marked";
    if (row.markedForReview) return "marked-review";
    if (answered) return "answered";
    return "not-answered";
  }

  function toVendorStatusClass(statusKey) {
    if (statusKey === "not-visited") return "not_visited";
    if (statusKey === "not-answered") return "not_answered";
    if (statusKey === "answered") return "answered";
    if (statusKey === "marked-review") return "review";
    return "review_answered";
  }

  function toVendorStatusText(statusKey) {
    if (statusKey === "not-visited") return "Not Visited";
    if (statusKey === "not-answered") return "Not Answered";
    if (statusKey === "answered") return "Answered";
    if (statusKey === "marked-review") return "Marked for Review";
    return "Answered & Marked for Review";
  }

  function toQuestionTypeLabel(type) {
    if (type === "MMCQ") return "Multiple Select";
    if (type === "Numerical") return "Numerical";
    return "MCQ";
  }

  function renderHtml(target, html) {
    if (!target) return;
    const safeHtml = window.DOMPurify ? DOMPurify.sanitize(String(html || "")) : String(html || "");
    target.innerHTML = safeHtml;
    try {
      if (typeof renderMathInElement === "function") renderMathInElement(target);
    } catch {}
    target.querySelectorAll("img").forEach((img) => {
      img.addEventListener("click", () => openImageOverlay(img.src, img.alt || ""));
    });
  }

  function openImageOverlay(src, alt) {
    if (!src || !elements.imageOverlay || !elements.imageOverlayImage) return;
    elements.imageOverlayImage.src = src;
    elements.imageOverlayImage.alt = alt || "";
    elements.imageOverlay.classList.remove("qbase-hidden");
    elements.imageOverlay.setAttribute("aria-hidden", "false");
  }

  function closeImageOverlay() {
    if (!elements.imageOverlay || !elements.imageOverlayImage) return;
    elements.imageOverlay.classList.add("qbase-hidden");
    elements.imageOverlay.setAttribute("aria-hidden", "true");
    elements.imageOverlayImage.src = "";
    elements.imageOverlayImage.alt = "";
  }

  function scrollSections(delta) {
    elements.sectionTabs?.scrollBy({ left: delta, behavior: "smooth" });
    window.setTimeout(updateSectionArrows, 180);
  }

  function updateSectionArrows() {
    const scroller = elements.sectionTabs;
    if (!scroller || !elements.sectionLeftArrow || !elements.sectionRightArrow) return;
    const canScrollLeft = scroller.scrollLeft > 2;
    const canScrollRight = scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 2;
    elements.sectionLeftArrow.className = canScrollLeft ? "subject-arrow-left" : "subject-arrow-left-disabled";
    elements.sectionLeftArrow.setAttribute("aria-disabled", canScrollLeft ? "false" : "true");
    elements.sectionRightArrow.className = canScrollRight ? "subject-arrow-right" : "subject-arrow-right-disabled";
    elements.sectionRightArrow.setAttribute("aria-disabled", canScrollRight ? "false" : "true");
  }

  function renderEmpty() {
    if (elements.questionBody) {
      elements.questionBody.innerHTML = `<div class="qbase-empty-state">No questions are available in this test attempt.</div>`;
    }
    if (elements.palette) elements.palette.innerHTML = "";
    if (elements.sectionTabs) elements.sectionTabs.innerHTML = "";
    updateActionState();
  }

  function renderFatal(message) {
    if (elements.questionBody) {
      elements.questionBody.innerHTML = `<div class="qbase-empty-state">${escapeHtml(message)}</div>`;
    }
    if (elements.palette) elements.palette.innerHTML = "";
    if (elements.sectionTabs) elements.sectionTabs.innerHTML = "";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
  }
})();
