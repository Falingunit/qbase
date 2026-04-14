"use strict";

(() => {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode") === "test-review" ? "review" : "take";
  const testId = String(params.get("testId") || "").trim();
  let attemptId = String(params.get("attemptId") || "").trim();
  let payloadPromise = null;
  let payload = null;
  let elapsedSeconds = 0;
  let remainingSeconds = null;
  let submitInFlight = false;
  let timerStarted = false;

  window.__PYQS_ASSIGNMENT_ID__ = 0;
  window.__ASSIGNMENT_TEST_ADAPTER__ = {
    mode,
    loadState,
    saveState,
    flushState,
    onStateChange,
    onQuestionChange,
  };
  window.__ASSIGNMENT_CUSTOM_LOADER__ = loadTestAssignment;

  async function loadTestAssignment() {
    payload = await ensurePayload();
    attemptId = String(payload?.attempt?.attemptId || attemptId || "");
    elapsedSeconds = Number(payload?.attempt?.elapsedSeconds || 0);
    remainingSeconds =
      payload?.attempt?.remainingSeconds == null
        ? payload?.test?.timeLimitSeconds
          ? Math.max(0, Number(payload.test.timeLimitSeconds) - elapsedSeconds)
          : null
        : Number(payload.attempt.remainingSeconds);
    setupTestShell();
    if (mode === "take") startAttemptTimer();
    const title = payload?.test?.title || "Test";
    window.__PYQS_ASSIGNMENT_TITLE__ = title;
    return {
      meta: { title: mode === "review" ? `${title} Review` : title },
      questions: (payload.questions || []).map(normalizeQuestion),
    };
  }

  async function ensurePayload() {
    if (!testId) throw new Error("Missing test id.");
    if (!payloadPromise) {
      const path =
        mode === "review"
          ? `/api/tests/${encodeURIComponent(testId)}/attempts/${encodeURIComponent(attemptId)}/review`
          : attemptId
            ? `/api/tests/${encodeURIComponent(testId)}/attempts/${encodeURIComponent(attemptId)}`
            : `/api/tests/${encodeURIComponent(testId)}/attempts`;
      payloadPromise = api(path, {
        method: mode === "take" && !attemptId ? "POST" : "GET",
      }).then(preparePayload);
    }
    return payloadPromise;
  }

  async function loadState() {
    const data = await ensurePayload();
    const questions = data.questions || [];
    const normalizedQuestions = questions.map(normalizeQuestion);
    const state = toDisplayState(data?.attempt?.state, questions);
    if (mode === "review") {
      return state.map((item, index) => ({
        ...item,
        isAnswerEvaluated: true,
        evalStatus: getEvalStatus(normalizedQuestions[index], item),
      }));
    }
    return state;
  }

  async function saveState(state) {
    if (mode !== "take" || !attemptId) return;
    await api(`/api/tests/${encodeURIComponent(testId)}/attempts/${encodeURIComponent(attemptId)}/save`, {
      method: "POST",
      body: JSON.stringify(buildAttemptState(state)),
    });
  }

  function flushState(state) {
    if (mode !== "take" || !attemptId) return;
    const body = JSON.stringify(buildAttemptState(state));
    try {
      fetch(`${API_BASE}/api/tests/${encodeURIComponent(testId)}/attempts/${encodeURIComponent(attemptId)}/save`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(window.qbGetToken ? { Authorization: `Bearer ${window.qbGetToken()}` } : {}),
        },
        body,
        keepalive: true,
      }).catch(() => {});
    } catch {}
  }

  function onStateChange(context) {
    window.__ASSIGNMENT_TEST_LAST_STATE__ = context?.state || [];
    updateStatus(context?.state || []);
  }

  function onQuestionChange(context) {
    window.__ASSIGNMENT_TEST_LAST_STATE__ = context?.state || [];
    updateStatus(context?.state || []);
  }

  function buildAttemptState(state) {
    return {
      state: toBackendState(state),
      elapsedSeconds,
      remainingSeconds,
    };
  }

  function setupTestShell() {
    const title = payload?.test?.title || "Test";
    const titleEl = document.getElementById("assignment-title");
    if (titleEl) titleEl.textContent = mode === "review" ? `${title} Review` : title;
    const back = document.querySelector(".topbar-back");
    if (back) {
      back.href = `./test_overview.html?testId=${encodeURIComponent(testId)}`;
      back.title = "Back to Test Overview";
      back.setAttribute("aria-label", "Back to Test Overview");
    }
    document.getElementById("reset-assignment")?.classList.add("d-none");
    document.getElementById("notesSection")?.classList.add("d-none");
    document.getElementById("filters-info-btn")?.classList.add("d-none");
    document.getElementById("filter-btn")?.closest(".dropdown")?.classList.add("d-none");
    if (mode === "take") {
      document.getElementById("bookmark-btn")?.classList.add("d-none");
      document.getElementById("qcolor-picker")?.classList.add("d-none");
      document.getElementById("report-btn")?.classList.add("d-none");
    }
    const actions = document.getElementById("question-actions");
    const controls = actions?.querySelector(".controls");
    const palette = document.querySelector(".right-col");
    if (palette && !document.getElementById("test-attempt-status")) {
      const status = document.createElement("div");
      status.id = "test-attempt-status";
      status.className = "test-attempt-status";
      status.innerHTML = `
        <div id="test-time-left" class="fw-semibold">${mode === "review" ? "Review" : "No time limit"}</div>
        <div id="test-subject-progress" class="small text-secondary"></div>
      `;
      palette.appendChild(status);
    }
    if (controls && mode === "take" && !document.getElementById("submit-test")) {
      const btn = document.createElement("button");
      btn.id = "submit-test";
      btn.type = "button";
      btn.className = "btn btn-success";
      btn.textContent = "Submit Test";
      btn.addEventListener("click", () => submitAttempt(false));
      controls.appendChild(btn);
    }
  }

  function startAttemptTimer() {
    if (timerStarted) return;
    timerStarted = true;
    updateTimerText();
    setInterval(() => {
      elapsedSeconds += 1;
      if (remainingSeconds != null) {
        remainingSeconds = Math.max(0, remainingSeconds - 1);
        if (remainingSeconds === 0) submitAttempt(true);
      }
      updateTimerText();
    }, 1000);
  }

  function updateTimerText() {
    const text =
      remainingSeconds == null ? "No time limit" : `Time left: ${formatTime(remainingSeconds)}`;
    const host = document.getElementById("test-time-left");
    if (host) host.textContent = mode === "review" ? "Review" : text;
  }

  function updateStatus(state) {
    updateTimerText();
    const questions = (payload?.questions || []).map(normalizeQuestion);
    const bySubject = new Map();
    questions.forEach((q, index) => {
      const subject = q.subjectName || "Unknown";
      if (!bySubject.has(subject)) bySubject.set(subject, { attempted: 0, total: 0 });
      const row = bySubject.get(subject);
      row.total += 1;
      if (hasAnswer(state[index])) row.attempted += 1;
    });
    const text = Array.from(bySubject.entries())
      .map(([subject, row]) => `${subject}: ${row.attempted}/${row.total}`)
      .join(" · ");
    const host = document.getElementById("test-subject-progress");
    if (host) host.textContent = text;
  }

  async function submitAttempt(force) {
    if (mode !== "take" || submitInFlight || !attemptId) return;
    if (!force) {
      const ok =
        typeof window.showConfirm === "function"
          ? await window.showConfirm({
              title: "Submit Test?",
              message: "You cannot change this attempt after submitting.",
              okText: "Submit",
              cancelText: "Cancel",
            })
          : window.confirm("Submit this test? You cannot change this attempt after submitting.");
      if (!ok) return;
    }
    submitInFlight = true;
    const currentState = window.__ASSIGNMENT_TEST_LAST_STATE__ || [];
    await api(`/api/tests/${encodeURIComponent(testId)}/attempts/${encodeURIComponent(attemptId)}/submit`, {
      method: "POST",
      body: JSON.stringify(buildAttemptState(currentState)),
    });
    window.location.href = `./test_overview.html?testId=${encodeURIComponent(testId)}`;
  }

  function normalizeState(input, length) {
    const arr = Array.isArray(input) ? input.slice() : [];
    while (arr.length < length) arr.push(defaultAnswer());
    return arr.map((item) => ({ ...defaultAnswer(), ...(item || {}) }));
  }

  function preparePayload(data) {
    if (!data || data._testPrepared) return data;
    const rows = Array.isArray(data.questions) ? data.questions : [];
    const subjectOrder = new Map();
    const sectionOrder = new Map();
    rows.forEach((row, index) => {
      row._testStateIndex = index;
      const subjectKey = normalizeGroupKey(row.subjectName || row.payload?.subjectName || row.payload?.subject || "Unknown");
      if (!subjectOrder.has(subjectKey)) subjectOrder.set(subjectKey, subjectOrder.size);
      const sectionKey = normalizeGroupKey(row.sectionName || row.payload?.sectionName || row.questionType || row.payload?.qType || "Section");
      if (!sectionOrder.has(`${subjectKey}:${sectionKey}`)) {
        sectionOrder.set(`${subjectKey}:${sectionKey}`, sectionOrder.size);
      }
    });
    data.questions = rows.slice().sort((a, b) => {
      const aSubject = normalizeGroupKey(a.subjectName || a.payload?.subjectName || a.payload?.subject || "Unknown");
      const bSubject = normalizeGroupKey(b.subjectName || b.payload?.subjectName || b.payload?.subject || "Unknown");
      const bySubject = (subjectOrder.get(aSubject) ?? 0) - (subjectOrder.get(bSubject) ?? 0);
      if (bySubject) return bySubject;
      const byType = questionTypeRank(a.questionType || a.payload?.qType || a.payload?.type) - questionTypeRank(b.questionType || b.payload?.qType || b.payload?.type);
      if (byType) return byType;
      const aSection = normalizeGroupKey(a.sectionName || a.payload?.sectionName || a.questionType || a.payload?.qType || "Section");
      const bSection = normalizeGroupKey(b.sectionName || b.payload?.sectionName || b.questionType || b.payload?.qType || "Section");
      const bySection = (sectionOrder.get(`${aSubject}:${aSection}`) ?? 0) - (sectionOrder.get(`${bSubject}:${bSection}`) ?? 0);
      if (bySection) return bySection;
      return Number(a._testStateIndex || 0) - Number(b._testStateIndex || 0);
    });
    data._testPrepared = true;
    return data;
  }

  function toDisplayState(input, questions) {
    const maxIndex = Math.max(
      questions.length - 1,
      ...questions.map((row) => Number(row?._testStateIndex || 0)),
    );
    const backend = normalizeState(input, maxIndex + 1);
    return questions.map((row, index) => ({
      ...defaultAnswer(),
      ...(backend[Number(row?._testStateIndex ?? index)] || {}),
    }));
  }

  function toBackendState(displayState) {
    const rows = Array.isArray(payload?.questions) ? payload.questions : [];
    const out = [];
    rows.forEach((row, displayIndex) => {
      out[Number(row?._testStateIndex ?? displayIndex)] = {
        ...defaultAnswer(),
        ...((Array.isArray(displayState) ? displayState[displayIndex] : null) || {}),
      };
    });
    return normalizeState(out, Math.max(out.length, rows.length));
  }

  function defaultAnswer() {
    return {
      isAnswerPicked: false,
      pickedAnswers: [],
      pickedAnswer: "",
      pickedNumerical: undefined,
      time: 0,
      notes: "",
      markedForReview: false,
      resetLockedUntil: 0,
    };
  }

  function normalizeQuestion(row, index) {
    const q = row?.payload || row || {};
    const source = normalizeSource(row);
    const type = normalizeQuestionType(row?.questionType || q.qType || q.type);
    return {
      ...q,
      _testQuestionKey: row?.questionKey || row?.question_key || "",
      _testSource: source,
      subjectName: row?.subjectName || q.subjectName || q.subject || "",
      sectionName: row?.sectionName || q.sectionName || "",
      _testStateIndex: row?._testStateIndex ?? index,
      qType: type,
      qText: normalizeInlineAssetHtml(q.qText || q.questionText || q.text || "", source),
      qAnswer: q.qAnswer ?? q.correctAnswer ?? q.answer ?? "",
      image: resolveSourceAsset(q.image || q.qImage || q.questionImage || "", source),
      passage: normalizeInlineAssetHtml(q.passage || "", source),
      passageImage: resolveSourceAsset(q.passageImage || "", source),
      qOptions: buildOptions(q, source),
      sText: normalizeInlineAssetHtml(q.sText || q.solutionText || q.solution?.sText || q.solution?.text || "", source),
      sImage: resolveSourceAsset(q.sImage || q.solutionImage || q.solution?.sImage || q.solution?.image || "", source),
      questionIndex: row?.questionIndex ?? row?.question_index ?? index,
    };
  }

  function buildOptions(q, source) {
    if (Array.isArray(q.qOptions)) return q.qOptions.map((value) => normalizeOptionValue(value, source));
    if (Array.isArray(q.options)) return q.options.map((value) => normalizeOptionValue(value, source));
    return ["A", "B", "C", "D"].map((key) =>
      normalizeOptionValue(
        q[`${key}Text`] || q[`${key}Content`] || q[`option${key}`] || "",
        source,
      ),
    );
  }

  function normalizeOptionValue(value, source) {
    if (value && typeof value === "object") {
      const text = normalizeInlineAssetHtml(value.oText || value.text || value.content || "", source);
      const image = resolveSourceAsset(value.oImage || value.image || "", source);
      return image ? `${text || ""}<div><img src="${escapeAttr(image)}" alt="" loading="lazy" decoding="async"></div>` : text;
    }
    return normalizeInlineAssetHtml(value ?? "", source);
  }

  function normalizeQuestionType(value) {
    const raw = String(value || "").toLowerCase();
    if (raw.includes("num")) return "Numerical";
    if (raw.includes("multi") || raw.includes("mmcq")) return "MMCQ";
    return "SMCQ";
  }

  function questionTypeRank(value) {
    const type = normalizeQuestionType(value);
    if (type === "SMCQ") return 0;
    if (type === "MMCQ") return 1;
    if (type === "Numerical") return 2;
    return 9;
  }

  function normalizeGroupKey(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function normalizeSource(row) {
    const kind = String(row?.kind || row?.sourceKind || "").toLowerCase();
    return {
      kind,
      assignmentId: row?.assignmentId || row?.sourceId || row?.source_id || "",
      examId: row?.examId || row?.exam_id || "",
      subjectId: row?.subjectId || row?.subject_id || "",
      chapterId: row?.chapterId || row?.chapter_id || row?.sourceId || row?.source_id || "",
    };
  }

  function resolveSourceAsset(src, source) {
    const value = String(src || "").trim();
    if (!value || /^(https?:|data:|\/\/|\.\/|\/)/i.test(value)) return value;
    if (/^\.\.\//.test(value)) return value;
    if (/^data\/question_data\//i.test(value)) return `./${value}`;
    if (source?.kind === "assignment" && source.assignmentId) {
      return `./data/question_data/${encodeURIComponent(source.assignmentId)}/${value}`;
    }
    return value;
  }

  function normalizeInlineAssetHtml(value, source) {
    const html = String(value ?? "");
    if (!html || !/<img\b/i.test(html)) return html;
    return html.replace(
      /(<img\b[^>]*?\bsrc\s*=\s*["'])([^"']+)(["'][^>]*>)/gi,
      (_match, prefix, src, suffix) => `${prefix}${escapeAttr(resolveSourceAsset(src, source))}${suffix}`,
    );
  }

  function hasAnswer(answer) {
    return !!(
      answer?.pickedAnswer ||
      (Array.isArray(answer?.pickedAnswers) && answer.pickedAnswers.length) ||
      (answer?.pickedNumerical !== undefined && answer?.pickedNumerical !== "")
    );
  }

  function getEvalStatus(question, state) {
    if (question?.qBonus === true || question?.bonus === true || question?.isBonus === true) {
      return "correct";
    }
    if (!hasAnswer(state)) return "unattempted";
    const correct = normalizeCorrect(question);
    if (question.qType === "Numerical") {
      return Number(state?.pickedNumerical) === Number(question.qAnswer) ? "correct" : "incorrect";
    }
    const picked =
      question.qType === "MMCQ"
        ? new Set((state?.pickedAnswers || []).map((x) => String(x).toUpperCase()))
        : new Set(state?.pickedAnswer ? [String(state.pickedAnswer).toUpperCase()] : []);
    const wrong = Array.from(picked).some((x) => !correct.has(x));
    const missed = Array.from(correct).some((x) => !picked.has(x));
    if (!wrong && !missed && picked.size) return "correct";
    if (question.qType === "MMCQ" && !wrong && picked.size > 0) return "partial";
    return "incorrect";
  }

  function normalizeCorrect(question) {
    const raw = question?.qAnswer;
    const arr = Array.isArray(raw) ? raw : String(raw ?? "").split(/[,\s]+/);
    return new Set(arr.filter(Boolean).map((x) => String(x).toUpperCase()));
  }

  function formatTime(seconds) {
    const n = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(n / 3600);
    const m = Math.floor((n % 3600) / 60);
    const s = n % 60;
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
  }

  function escapeAttr(value) {
    return String(value || "").replace(/"/g, "&quot;");
  }

  async function api(path, options = {}) {
    const res = await authFetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error || `Request failed: ${res.status}`);
    }
    return await res.json();
  }

})();
