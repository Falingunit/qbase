"use strict";

(() => {
  const utils = {
    hasAnswer,
    formatTime,
    getEvalStatus,
    normalizeQuestionType,
    questionTypeRank,
    normalizeGroupKey,
  };

  function create({ mode = "take", testId = "", attemptId = "" } = {}) {
    const normalizedMode = String(mode || "").toLowerCase() === "review" ? "review" : "take";
    const normalizedTestId = String(testId || "").trim();
    let currentAttemptId = String(attemptId || "").trim();
    let payloadPromise = null;
    let payload = null;
    let questions = [];
    let state = [];
    let elapsedSeconds = 0;
    let remainingSeconds = null;
    let submitInFlight = false;
    let timerHandle = null;
    let initialized = false;
    const listeners = new Set();

    async function init() {
      if (initialized) return api;
      if (typeof loadConfig === "function") {
        await loadConfig();
      }
      payload = await ensurePayload();
      currentAttemptId = String(payload?.attempt?.attemptId || currentAttemptId || "");
      elapsedSeconds = Number(payload?.attempt?.elapsedSeconds || 0);
      remainingSeconds =
        payload?.attempt?.remainingSeconds == null
          ? payload?.test?.timeLimitSeconds
            ? Math.max(0, Number(payload.test.timeLimitSeconds) - elapsedSeconds)
            : null
          : Number(payload.attempt.remainingSeconds);
      questions = (payload?.questions || []).map(normalizeQuestion);
      state = buildDisplayState(payload?.attempt?.state, payload?.questions || [], questions);
      if (normalizedMode === "review") {
        state = state.map((item, index) => ({
          ...item,
          isAnswerEvaluated: true,
          evalStatus: getEvalStatus(questions[index], item),
        }));
      }
      initialized = true;
      if (normalizedMode === "take") startTimer();
      emit("init");
      return api;
    }

    async function ensurePayload() {
      if (!normalizedTestId) throw new Error("Missing test id.");
      if (!payloadPromise) {
        payloadPromise = loadAttemptPayload().then(preparePayload).catch((error) => {
          payloadPromise = null;
          throw error;
        });
      }
      return payloadPromise;
    }

    async function loadAttemptPayload() {
      if (normalizedMode === "review") {
        return apiRequest(
          `/api/tests/${encodeURIComponent(normalizedTestId)}/attempts/${encodeURIComponent(currentAttemptId)}/review`,
          { method: "GET" },
        );
      }
      if (!currentAttemptId) {
        return apiRequest(`/api/tests/${encodeURIComponent(normalizedTestId)}/attempts`, {
          method: "POST",
        });
      }
      try {
        return await apiRequest(
          `/api/tests/${encodeURIComponent(normalizedTestId)}/attempts/${encodeURIComponent(currentAttemptId)}`,
          { method: "GET" },
        );
      } catch (error) {
        const msg = String(error?.message || "");
        if (/attempt not found/i.test(msg) || /request failed: 404/i.test(msg)) {
          currentAttemptId = "";
          return apiRequest(`/api/tests/${encodeURIComponent(normalizedTestId)}/attempts`, {
            method: "POST",
          });
        }
        throw error;
      }
    }

    function startTimer() {
      if (timerHandle || normalizedMode !== "take") return;
      timerHandle = window.setInterval(() => {
        elapsedSeconds += 1;
        if (remainingSeconds != null) {
          remainingSeconds = Math.max(0, remainingSeconds - 1);
          if (remainingSeconds === 0) {
            submitAttempt(true).catch(() => {});
          }
        }
        emit("tick");
      }, 1000);
    }

    function buildAttemptState(nextState = state) {
      return {
        state: toBackendState(nextState),
        elapsedSeconds,
        remainingSeconds,
      };
    }

    function getSnapshot(type = "snapshot") {
      return {
        type,
        mode: normalizedMode,
        testId: normalizedTestId,
        attemptId: currentAttemptId,
        payload,
        questions,
        state: cloneStateArray(state),
        elapsedSeconds,
        remainingSeconds,
      };
    }

    function emit(type) {
      const snapshot = getSnapshot(type);
      listeners.forEach((listener) => {
        try {
          listener(snapshot);
        } catch (error) {
          console.warn("test-attempt runtime listener failed:", error);
        }
      });
    }

    function getPayload() {
      return payload;
    }

    function getQuestions() {
      return questions;
    }

    function getState() {
      return cloneStateArray(state);
    }

    function setState(nextState) {
      state = normalizeState(nextState, questions.length);
      emit("state");
      return getState();
    }

    async function saveNow() {
      if (normalizedMode !== "take" || !currentAttemptId) return;
      await apiRequest(
        `/api/tests/${encodeURIComponent(normalizedTestId)}/attempts/${encodeURIComponent(currentAttemptId)}/save`,
        {
          method: "POST",
          body: JSON.stringify(buildAttemptState()),
        },
      );
    }

    function flushKeepalive() {
      if (normalizedMode !== "take" || !currentAttemptId) return;
      try {
        fetch(
          `${API_BASE}/api/tests/${encodeURIComponent(normalizedTestId)}/attempts/${encodeURIComponent(currentAttemptId)}/save`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(window.qbGetToken ? { Authorization: `Bearer ${window.qbGetToken()}` } : {}),
            },
            body: JSON.stringify(buildAttemptState()),
            keepalive: true,
          },
        ).catch(() => {});
      } catch {}
    }

    async function submitAttempt(force) {
      if (normalizedMode !== "take" || submitInFlight || !currentAttemptId) return;
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
      try {
        await apiRequest(
          `/api/tests/${encodeURIComponent(normalizedTestId)}/attempts/${encodeURIComponent(currentAttemptId)}/submit`,
          {
            method: "POST",
            body: JSON.stringify(buildAttemptState()),
          },
        );
      } finally {
        submitInFlight = false;
      }
      window.location.href = `./test_overview.html?testId=${encodeURIComponent(normalizedTestId)}`;
    }

    function subscribe(listener) {
      if (typeof listener !== "function") return () => {};
      listeners.add(listener);
      if (initialized) {
        try {
          listener(getSnapshot("subscribe"));
        } catch {}
      }
      return () => listeners.delete(listener);
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

    const api = {
      init,
      getPayload,
      getQuestions,
      getState,
      setState,
      saveNow,
      flushKeepalive,
      submitAttempt,
      subscribe,
    };

    return api;
  }

  function buildDisplayState(input, rawQuestions, normalizedQuestions) {
    const maxIndex = Math.max(
      rawQuestions.length - 1,
      ...rawQuestions.map((row) => Number(row?._testStateIndex || 0)),
    );
    const backend = normalizeState(input, maxIndex + 1);
    return rawQuestions.map((row, index) => ({
      ...defaultAnswer(),
      ...(backend[Number(row?._testStateIndex ?? index)] || {}),
      ...(normalizedQuestions[index]?.qType ? {} : {}),
    }));
  }

  function normalizeState(input, length) {
    const arr = Array.isArray(input) ? input.slice() : [];
    while (arr.length < length) arr.push(defaultAnswer());
    return arr.map((item) => {
      const base = { ...defaultAnswer(), ...(item || {}) };
      base.pickedAnswers = Array.isArray(base.pickedAnswers) ? base.pickedAnswers.slice() : [];
      base.visited = base.visited === true;
      return base;
    });
  }

  function cloneStateArray(input) {
    return normalizeState(input, Array.isArray(input) ? input.length : 0);
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
      visited: false,
      resetLockedUntil: 0,
    };
  }

  function preparePayload(data) {
    if (!data || data._testPrepared) return data;
    const rows = Array.isArray(data.questions) ? data.questions : [];
    const subjectOrder = new Map();
    const sectionOrder = new Map();
    rows.forEach((row, index) => {
      row._testStateIndex = index;
      const subjectKey = normalizeGroupKey(
        row.subjectName || row.payload?.subjectName || row.payload?.subject || "Unknown",
      );
      if (!subjectOrder.has(subjectKey)) subjectOrder.set(subjectKey, subjectOrder.size);
      const sectionKey = normalizeGroupKey(
        row.sectionName || row.payload?.sectionName || row.questionType || row.payload?.qType || "Section",
      );
      if (!sectionOrder.has(`${subjectKey}:${sectionKey}`)) {
        sectionOrder.set(`${subjectKey}:${sectionKey}`, sectionOrder.size);
      }
    });
    data.questions = rows.slice().sort((a, b) => {
      const aSubject = normalizeGroupKey(
        a.subjectName || a.payload?.subjectName || a.payload?.subject || "Unknown",
      );
      const bSubject = normalizeGroupKey(
        b.subjectName || b.payload?.subjectName || b.payload?.subject || "Unknown",
      );
      const bySubject = (subjectOrder.get(aSubject) ?? 0) - (subjectOrder.get(bSubject) ?? 0);
      if (bySubject) return bySubject;
      const byType =
        questionTypeRank(a.questionType || a.payload?.qType || a.payload?.type) -
        questionTypeRank(b.questionType || b.payload?.qType || b.payload?.type);
      if (byType) return byType;
      const aSection = normalizeGroupKey(
        a.sectionName || a.payload?.sectionName || a.questionType || a.payload?.qType || "Section",
      );
      const bSection = normalizeGroupKey(
        b.sectionName || b.payload?.sectionName || b.questionType || b.payload?.qType || "Section",
      );
      const bySection =
        (sectionOrder.get(`${aSubject}:${aSection}`) ?? 0) -
        (sectionOrder.get(`${bSubject}:${bSection}`) ?? 0);
      if (bySection) return bySection;
      return Number(a._testStateIndex || 0) - Number(b._testStateIndex || 0);
    });
    data._testPrepared = true;
    return data;
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
      sText: normalizeInlineAssetHtml(
        q.sText || q.solutionText || q.solution?.sText || q.solution?.text || "",
        source,
      ),
      sImage: resolveSourceAsset(
        q.sImage || q.solutionImage || q.solution?.sImage || q.solution?.image || "",
        source,
      ),
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
      return image
        ? `${text || ""}<div><img src="${escapeAttr(image)}" alt="" loading="lazy" decoding="async"></div>`
        : text;
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

  function getEvalStatus(question, answerState) {
    if (question?.qBonus === true || question?.bonus === true || question?.isBonus === true) {
      return "correct";
    }
    if (!hasAnswer(answerState)) return "unattempted";
    const correct = normalizeCorrect(question);
    if (question.qType === "Numerical") {
      return Number(answerState?.pickedNumerical) === Number(question.qAnswer) ? "correct" : "incorrect";
    }
    const picked =
      question.qType === "MMCQ"
        ? new Set((answerState?.pickedAnswers || []).map((x) => String(x).toUpperCase()))
        : new Set(answerState?.pickedAnswer ? [String(answerState.pickedAnswer).toUpperCase()] : []);
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
    return h
      ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${m}:${String(s).padStart(2, "0")}`;
  }

  function escapeAttr(value) {
    return String(value || "").replace(/"/g, "&quot;");
  }

  async function apiRequest(path, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const headers = {
      ...(options.headers || {}),
    };
    if (options.body != null && method !== "GET" && method !== "HEAD" && !("Content-Type" in headers)) {
      headers["Content-Type"] = "application/json";
    }
    const res = await authFetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error || `Request failed: ${res.status}`);
    }
    return await res.json();
  }

  window.QBaseTestAttemptRuntime = {
    create,
    utils,
  };
})();
