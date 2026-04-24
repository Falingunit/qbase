"use strict";

(() => {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode") === "test-review" ? "review" : "take";
  const testId = String(params.get("testId") || "").trim();
  const attemptId = String(params.get("attemptId") || "").trim();
  const runtime = window.QBaseTestAttemptRuntime?.create({ mode, testId, attemptId });
  const hasAnswer = window.QBaseTestAttemptRuntime?.utils?.hasAnswer;
  const formatTime = window.QBaseTestAttemptRuntime?.utils?.formatTime;
  let latestSnapshot = null;

  if (!runtime) {
    throw new Error("QBaseTestAttemptRuntime is required before test-attempt-loader.js");
  }

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

  runtime.subscribe((snapshot) => {
    latestSnapshot = snapshot;
    if (snapshot?.state) {
      window.__ASSIGNMENT_TEST_LAST_STATE__ = snapshot.state;
    }
    updateStatus(snapshot);
  });

  async function loadTestAssignment() {
    await runtime.init();
    setupTestShell(runtime.getPayload());
    const title = runtime.getPayload()?.test?.title || "Test";
    window.__PYQS_ASSIGNMENT_TITLE__ = title;
    return {
      meta: { title: mode === "review" ? `${title} Review` : title },
      questions: runtime.getQuestions(),
    };
  }

  async function loadState() {
    await runtime.init();
    return runtime.getState();
  }

  async function saveState(state) {
    runtime.setState(state);
    await runtime.saveNow();
  }

  function flushState(state) {
    runtime.setState(state);
    runtime.flushKeepalive();
  }

  function onStateChange(context) {
    runtime.setState(context?.state || []);
  }

  function onQuestionChange(context) {
    runtime.setState(context?.state || []);
  }

  function setupTestShell(payload) {
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
      btn.addEventListener("click", () => {
        runtime.submitAttempt(false).catch((error) => {
          console.error("submit test failed:", error);
        });
      });
      controls.appendChild(btn);
    }
    updateStatus({
      mode,
      payload,
      questions: runtime.getQuestions(),
      state: runtime.getState(),
      remainingSeconds: latestSnapshot?.remainingSeconds,
    });
  }

  function updateStatus(snapshot) {
    if (!snapshot) return;
    const text =
      snapshot.mode === "review"
        ? "Review"
        : snapshot.remainingSeconds == null
          ? "No time limit"
          : `Time left: ${formatTime ? formatTime(snapshot.remainingSeconds) : snapshot.remainingSeconds}`;
    const timeHost = document.getElementById("test-time-left");
    if (timeHost) timeHost.textContent = text;

    const bySubject = new Map();
    (snapshot.questions || []).forEach((question, index) => {
      const subject = question?.subjectName || "Unknown";
      if (!bySubject.has(subject)) bySubject.set(subject, { attempted: 0, total: 0 });
      const row = bySubject.get(subject);
      row.total += 1;
      if (hasAnswer?.(snapshot.state?.[index])) row.attempted += 1;
    });
    const progressHost = document.getElementById("test-subject-progress");
    if (progressHost) {
      progressHost.textContent = Array.from(bySubject.entries())
        .map(([subject, row]) => `${subject}: ${row.attempted}/${row.total}`)
        .join(" · ");
    }
  }
})();
