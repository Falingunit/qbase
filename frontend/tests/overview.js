"use strict";

(async () => {
  await loadConfig();

  const params = new URLSearchParams(window.location.search);
  const testId = String(params.get("testId") || "").trim();
  const els = {
    loading: document.getElementById("test-overview-loading"),
    error: document.getElementById("test-overview-error"),
    content: document.getElementById("test-overview-content"),
    title: document.getElementById("test-overview-title"),
    meta: document.getElementById("test-overview-meta"),
    bestScore: document.getElementById("test-overview-best-score"),
    latest: document.getElementById("latest-attempt"),
    attempts: document.getElementById("all-attempts"),
    leaderboard: document.getElementById("leaderboard"),
    details: document.getElementById("test-details"),
  };

  if (!testId) {
    showError("Missing test id.");
    return;
  }

  try {
    const overview = await TestsService.fetchTestOverview(testId);
    renderOverview(overview);
  } catch (error) {
    console.error(error);
    showError("Failed to load test overview.");
  }

  function renderOverview(overview) {
    const test = overview?.test || {};
    window.__currentTestId = test.testId || testId;
    const attempts = Array.isArray(overview?.attempts) ? overview.attempts : [];
    const leaderboard = Array.isArray(overview?.leaderboard)
      ? overview.leaderboard
      : [];
    els.title.textContent = test.title || "Test";
    const bestAttempt = attempts.find((attempt) => isAttemptCompleted(attempt) && attempt.isBestAttempt);
    els.meta.innerHTML = `
      <span>${escapeHtml(test.totalQuestions || 0)} questions</span>
      <span>Created ${escapeHtml(formatDate(test.createdAt))}</span>
      ${test.creator ? `<span>By ${escapeHtml(test.creator)}</span>` : ""}
    `;
    if (els.bestScore) {
      els.bestScore.innerHTML = `
        <span>Best Score</span>
        <div>
          <strong>${escapeHtml(bestAttempt ? formatScore(bestAttempt.score) : "-")}</strong>
          <small>/ ${escapeHtml(formatScore(bestAttempt?.maxScore ?? test.maxScore ?? 0))}</small>
        </div>
        <em>${escapeHtml(bestAttempt?.rankIfCounted ? `Rank #${bestAttempt.rankIfCounted}` : "No rank yet")}</em>
      `;
    }
    renderLatestAttempt(overview?.latestAttempt);
    renderAttempts(attempts);
    renderLeaderboard(leaderboard);
    renderDetails(overview);
    wireAttemptActions();
    setVisible(els.loading, false);
    setVisible(els.content, true);
  }

  function renderLatestAttempt(attempt) {
    const resumable = attempt && isAttemptPaused(attempt);
    els.latest.innerHTML = `
      <section class="tests-overview-card">
        <div class="tests-overview-card-head">
          <div>
            <h2>Latest Attempt</h2>
            <p class="text-secondary small mb-0">The most recent attempt appears here.</p>
          </div>
          <button type="button" class="btn btn-sm btn-primary tests-new-attempt-btn">
            <i class="bi ${resumable ? "bi-play-circle" : "bi-play-fill"}"></i>
            <span>${resumable ? "Resume Test" : "New Attempt"}</span>
          </button>
        </div>
        ${
          attempt
            ? renderAttemptCard(attempt, {
                expanded: true,
                label: "Latest",
                cardId: `latest-${attempt.attemptId}`,
              })
            : '<div class="tests-overview-empty">No attempts yet.</div>'
        }
      </section>
    `;
    els.latest.querySelector(".tests-new-attempt-btn")?.addEventListener("click", () => {
      const url = new URL("./test_attempt.html", window.location.href);
      url.searchParams.set("testId", String((window.__currentTestId || new URLSearchParams(window.location.search).get("testId")) || ""));
      if (resumable && attempt?.attemptId) {
        url.searchParams.set("attemptId", String(attempt.attemptId));
      }
      window.location.href = url.toString();
    });
  }

  function renderAttempts(attempts) {
    els.attempts.innerHTML = `
      <section class="tests-overview-card">
        <div class="tests-overview-card-head">
          <div>
            <h2>All Attempts</h2>
            <p class="text-secondary small mb-0">Highest scoring attempt is marked as best attempt.</p>
          </div>
          <span class="tests-review-pill">${attempts.length} attempt${
      attempts.length === 1 ? "" : "s"
    }</span>
        </div>
        ${
          attempts.length
            ? `<div class="tests-overview-list">${attempts
                .map((attempt, index) =>
                  renderAttemptCard(attempt, {
                    expanded: index === 0,
                    highlight: !!attempt.isBestAttempt,
                    label: attempt.isBestAttempt ? "Best Attempt" : "",
                    cardId: `attempt-${attempt.attemptId || index}`,
                  })
                )
                .join("")}</div>`
            : '<div class="tests-overview-empty">No attempts yet.</div>'
        }
      </section>
    `;
  }

  function renderLeaderboard(rows) {
    els.leaderboard.innerHTML = `
      <section class="tests-overview-card">
        <div class="tests-overview-card-head">
          <div>
            <h2>Leaderboard</h2>
            <p class="text-secondary small mb-0">Best attempt from each user, ranked with skipped ranks on ties.</p>
          </div>
        </div>
        ${
          rows.length
            ? `<div class="tests-leaderboard-list">${rows
                .map((row) => renderLeaderboardRow(row))
                .join("")}</div>`
            : '<div class="tests-overview-empty">No leaderboard entries yet.</div>'
        }
      </section>
    `;
  }

  function renderAttemptRow(attempt, { highlight, label }) {
    return `
      <div class="tests-attempt-row${highlight ? " best" : ""}">
        <div>
          <div class="tests-attempt-title">
            <span>${escapeHtml(attempt.username || "Unknown user")}</span>
            ${label ? `<span class="tests-best-badge">${escapeHtml(label)}</span>` : ""}
          </div>
          <div class="text-secondary small">${escapeHtml(formatDateTime(attempt.submittedAt))}</div>
        </div>
        <div class="tests-attempt-score">
          <strong>${escapeHtml(formatScore(attempt.score))}</strong>
          <span>/ ${escapeHtml(formatScore(attempt.maxScore))}</span>
        </div>
      </div>
    `;
  }

  function renderLeaderboardRow(row) {
    return `
      <div class="tests-leaderboard-row">
        <div class="tests-leaderboard-rank">#${escapeHtml(row.rank || "-")}</div>
        <div>
          <div class="fw-semibold">${escapeHtml(row.username || "Unknown user")}</div>
          <div class="text-secondary small">Best attempt ${escapeHtml(formatDateTime(row.submittedAt))}</div>
        </div>
        <div class="tests-attempt-score">
          <strong>${escapeHtml(formatScore(row.score))}</strong>
          <span>/ ${escapeHtml(formatScore(row.maxScore))}</span>
        </div>
      </div>
    `;
  }

  function renderAttemptCard(attempt, { expanded, highlight = false, label = "", cardId }) {
    const detailsId = `attempt-details-${String(cardId || attempt.attemptId).replace(/[^a-z0-9_-]/gi, "-")}`;
    const breakdown = getAttemptScoreBreakdown(attempt);
    const completed = isAttemptCompleted(attempt);
    const subjects = Array.isArray(attempt.subjectBreakdown)
      ? attempt.subjectBreakdown
      : [];
    return `
      <article class="tests-attempt-card${highlight ? " best" : ""}" data-expanded="${expanded ? "true" : "false"}">
        <button
          type="button"
          class="tests-attempt-summary"
          aria-expanded="${expanded ? "true" : "false"}"
          aria-controls="${escapeAttr(detailsId)}"
          onclick="
            const card=this.closest('.tests-attempt-card');
            const expanded=card.dataset.expanded==='true';
            card.dataset.expanded=String(!expanded);
            this.setAttribute('aria-expanded', String(!expanded));
          "
        >
          <span>
            <span class="tests-attempt-title">
              ${
                completed
                  ? `<span class="tests-attempt-title-score">
                      <strong>${escapeHtml(formatScore(attempt.score))}</strong>
                      <span>/ ${escapeHtml(formatScore(attempt.maxScore))}</span>
                    </span>`
                  : `<span>${escapeHtml(getCompletionPercent(attempt))}% complete</span>`
              }
              ${label ? `<span class="tests-best-badge">${escapeHtml(label)}</span>` : ""}
            </span>
            <span class="text-secondary small">${escapeHtml(formatDateTime(attempt.submittedAt || attempt.startedAt))}</span>
          </span>
          <span class="tests-attempt-summary-metrics">
            ${
              completed
                ? `
                  <span class="tests-review-pill">Rank #${escapeHtml(attempt.rankIfCounted || "-")}</span>
                `
                : `
                  <span class="tests-review-pill">${escapeHtml(getAttemptStatusLabel(attempt))}</span>
                `
            }
            <i class="bi bi-chevron-down tests-attempt-chevron" aria-hidden="true"></i>
          </span>
        </button>
        <div id="${escapeAttr(detailsId)}" class="tests-attempt-details">
          <div class="d-flex justify-content-end gap-2 mb-2">
          ${!completed ? `<a class="btn btn-sm btn-outline-primary" href="./test_attempt.html?testId=${encodeURIComponent(
              String(new URLSearchParams(window.location.search).get("testId") || "")
            )}&attemptId=${encodeURIComponent(String(attempt.attemptId || ""))}">
              <i class="bi bi-play-circle"></i>
              <span>Resume Attempt</span>
            </a>` : ""}
          ${completed && attempt.canReview !== false ? `
            <a class="btn btn-sm btn-outline-primary" href="./test_review.html?testId=${encodeURIComponent(
              String(new URLSearchParams(window.location.search).get("testId") || "")
            )}&attemptId=${encodeURIComponent(String(attempt.attemptId || ""))}">
              <i class="bi bi-eye"></i>
              <span>Review Attempt</span>
            </a>
          ` : ""}
          ${attempt.canDelete !== false ? `
            <button type="button" class="btn btn-sm btn-outline-danger tests-delete-attempt-btn" data-attempt-id="${escapeAttr(attempt.attemptId || "")}">
              <i class="bi bi-trash"></i>
              <span>Delete Attempt</span>
            </button>
          ` : ""}
          </div>
          ${
            completed
              ? `
                ${renderScoreBar(breakdown, "Overall marks")}
                <div class="tests-attempt-detail-grid">
                  <span><strong>${escapeHtml(formatScore(breakdown.actualScore))}</strong><small>Actual</small></span>
                  <span><strong>${escapeHtml(formatScore(breakdown.positiveOnlyScore))}</strong><small>Positive-only</small></span>
                  <span><strong>${escapeHtml(formatScore(breakdown.negativeScore))}</strong><small>Negative</small></span>
                  <span><strong>#${escapeHtml(attempt.rankIfCounted || "-")}</strong><small>Rank if counted</small></span>
                </div>
              `
              : `
                ${renderCompletionBar(attempt, "Overall completion")}
                <div class="tests-attempt-detail-grid">
                  <span><strong>${escapeHtml(attempt.attempted || 0)}</strong><small>Attempted</small></span>
                  <span><strong>${escapeHtml(attempt.totalQuestions || 0)}</strong><small>Total</small></span>
                  <span><strong>${escapeHtml(getCompletionPercent(attempt))}%</strong><small>Complete</small></span>
                  <span><strong>${escapeHtml(getAttemptStatusLabel(attempt))}</strong><small>Status</small></span>
                </div>
              `
          }
          ${
            subjects.length
              ? `<div class="tests-attempt-subjects">
                  <div class="fw-semibold small text-secondary">Subject breakdown</div>
                  ${subjects
                    .map((subject) =>
                      completed
                        ? renderScoreBar(
                            getAttemptScoreBreakdown({
                              ...subject,
                              score: subject.score ?? subject.actualScore,
                              maxScore: subject.maxScore,
                            }),
                            subject.subjectName || subject.name || "Subject"
                          )
                        : renderCompletionBar(
                            {
                              attempted: subject.attempted ?? subject.attemptedCount,
                              totalQuestions: subject.totalQuestions ?? subject.total,
                            },
                            subject.subjectName || subject.name || "Subject"
                          )
                    )
                    .join("")}
                </div>`
              : `<div class="text-secondary small">Subject ${completed ? "breakdown" : "completion"} will appear here once attempt state stores it.</div>`
          }
        </div>
      </article>
    `;
  }

  function renderCompletionBar(attempt, label) {
    const pct = getCompletionPercent(attempt);
    return `
      <div class="tests-scorebar-wrap">
        <div class="tests-scorebar-label">
          <span>${escapeHtml(label)}</span>
          <span>${escapeHtml(pct)}%</span>
        </div>
        <div class="tests-scorebar completion" role="img" aria-label="${escapeAttr(`${label}: ${pct}% complete`)}">
          <span class="tests-scorebar-segment blue" style="left:0;width:${pct}%"></span>
        </div>
      </div>
    `;
  }

  function isAttemptCompleted(attempt) {
    const status = String(attempt?.status || "").toLowerCase();
    if (status === "paused" || status === "in-progress" || status === "started") {
      return false;
    }
    if (status === "submitted" || status === "completed") return true;
    return !!attempt?.submittedAt && Number.isFinite(Number(attempt?.score));
  }

  function isAttemptPaused(attempt) {
    const status = String(attempt?.status || "").toLowerCase();
    return !!attempt && !isAttemptCompleted(attempt) && ["paused", "in-progress", "in_progress", "started"].includes(status);
  }

  function getAttemptStatusLabel(attempt) {
    const status = String(attempt?.status || "").trim();
    if (!status) return "In progress";
    return status
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  function getCompletionPercent(attempt) {
    const attempted = Number(attempt?.attempted || 0);
    const total = Number(attempt?.totalQuestions || 0);
    if (!total) return 0;
    return Math.max(0, Math.min(100, Math.round((attempted / total) * 100)));
  }

  function wireAttemptActions() {
    document.querySelectorAll(".tests-delete-attempt-btn").forEach((btn) => {
      btn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const attemptId = String(btn.dataset.attemptId || "").trim();
        if (!attemptId) return;
        const ok =
          typeof window.showConfirm === "function"
            ? await window.showConfirm({
                title: "Delete Attempt?",
                message: "This attempt will be permanently deleted.",
                okText: "Delete",
                cancelText: "Cancel",
              })
            : confirm("Delete this attempt?");
        if (!ok) return;
        try {
          btn.disabled = true;
          await TestsService.deleteAttempt(window.__currentTestId || testId, attemptId);
          const overview = await TestsService.fetchTestOverview(window.__currentTestId || testId);
          renderOverview(overview);
        } catch (error) {
          console.error(error);
          if (typeof window.showNotice === "function") {
            await window.showNotice({
              title: "Delete failed",
              message: error?.message || "Failed to delete attempt.",
            });
          } else {
            alert(error?.message || "Failed to delete attempt.");
          }
          btn.disabled = false;
        }
      });
    });
  }

  function renderScoreBar(breakdown, label) {
    const max = Math.max(Number(breakdown.maxScore || 0), 1);
    const greenEnd = clampPercent((breakdown.greenScore / max) * 100);
    const yellowStart = greenEnd;
    const yellowWidth = clampPercent((breakdown.partialScore / max) * 100);
    const actualEnd = clampPercent((breakdown.actualScore / max) * 100);
    const redStart = actualEnd;
    const redWidth = clampPercent(
      ((breakdown.positiveOnlyScore - breakdown.actualScore) / max) * 100
    );
    return `
      <div class="tests-scorebar-wrap">
        <div class="tests-scorebar-label">
          <span>${escapeHtml(label)}</span>
          <span>${escapeHtml(formatScore(breakdown.actualScore))} / ${escapeHtml(formatScore(breakdown.maxScore))}</span>
        </div>
        <div class="tests-scorebar" role="img" aria-label="${escapeAttr(`${label}: ${formatScore(breakdown.actualScore)} out of ${formatScore(breakdown.maxScore)}`)}">
          <span class="tests-scorebar-segment green" style="left:0;width:${greenEnd}%"></span>
          <span class="tests-scorebar-segment yellow" style="left:${yellowStart}%;width:${yellowWidth}%"></span>
          <span class="tests-scorebar-segment red" style="left:${redStart}%;width:${redWidth}%"></span>
          <span class="tests-scorebar-marker actual" style="left:${actualEnd}%"></span>
          <span class="tests-scorebar-marker positive" style="left:${clampPercent((breakdown.positiveOnlyScore / max) * 100)}%"></span>
        </div>
      </div>
    `;
  }

  function getAttemptScoreBreakdown(attempt) {
    const maxScore = Math.max(Number(attempt.maxScore || 0), 0);
    const actualScore = Math.max(Number(attempt.score ?? attempt.actualScore ?? 0), 0);
    const partialScore = Math.max(Number(attempt.partialScore || 0), 0);
    const negativeScore = Math.max(Math.abs(Number(attempt.negativeScore || 0)), 0);
    const explicitPositive = Number(attempt.positiveScore ?? attempt.positiveOnlyScore);
    const positiveOnlyScore = Number.isFinite(explicitPositive)
      ? Math.max(explicitPositive + partialScore, actualScore)
      : actualScore + negativeScore;
    const greenScore = Math.max(actualScore - partialScore, 0);
    return {
      maxScore: Math.max(maxScore, positiveOnlyScore, actualScore, 1),
      actualScore,
      greenScore,
      partialScore,
      negativeScore,
      positiveOnlyScore,
    };
  }

  function clampPercent(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, n));
  }

  function renderDetails(overview) {
    const test = overview?.test || {};
    const config = overview?.config || {};
    const sourceSelections = config.sourceSelections || {};
    const selectedSources = Object.entries(sourceSelections).filter(
      ([, state]) => state?.selected
    );
    const assignmentCount = selectedSources.filter(([sourceId]) => !String(sourceId).includes("::")).length;
    const pyqCount = selectedSources.length - assignmentCount;
    const globalFilterCount = [
      hasSourceFilters(config.globalFilters?.assignment),
      hasSourceFilters(config.globalFilters?.pyq),
    ].filter(Boolean).length;
    const sections = Array.isArray(config.testBlueprint?.sections)
      ? config.testBlueprint.sections
      : [];
    const timeLimitMinutes = Number(
      config.testBlueprint?.timeLimitMinutes ??
        (Number(config.testBlueprint?.timeLimitSeconds) > 0
          ? Number(config.testBlueprint.timeLimitSeconds) / 60
          : 0)
    );
    const reusePolicy = config.questionReusePolicy || overview?.questionReusePolicy || {};
    const permissions = overview?.permissions || {};
    const sharedWith = Array.isArray(overview?.shareWith)
      ? overview.shareWith
      : Array.isArray(config.shareWith)
      ? config.shareWith
      : [];
    const reuseMode = reusePolicy.mode === "whitelist" ? "Whitelist" : "Blacklist";
    const reuseCount = Array.isArray(reusePolicy.testIds)
      ? reusePolicy.testIds.length
      : 0;
    els.details.innerHTML = `
      <section class="tests-overview-card">
        <div class="tests-overview-card-head">
          <div>
            <h2>Test Details</h2>
          </div>
          <button type="button" class="btn btn-sm btn-primary tests-duplicate-btn">
            <i class="bi bi-copy"></i>
            <span>Duplicate Test</span>
          </button>
        </div>
        <dl class="tests-review-list">
          <div><dt>Name</dt><dd>${escapeHtml(test.title || config.testName || "Untitled test")}</dd></div>
          <div><dt>Description</dt><dd>${escapeHtml(test.description || config.testDescription || "No description")}</dd></div>
          <div><dt>Shared with</dt><dd id="test-share-summary">${escapeHtml(sharedWith.length ? sharedWith.join(", ") : "No one")}</dd></div>
          <div><dt>Time limit</dt><dd>${escapeHtml(formatTimeLimit(timeLimitMinutes))}</dd></div>
          <div><dt>Test ID</dt><dd>${escapeHtml(test.testId || testId)}</dd></div>
        </dl>
        ${
          permissions.isCreator
            ? `
              <div class="tests-share-editor">
                <label class="form-label" for="test-share-input">Add People</label>
                <div class="tests-tag-field" id="test-share-field">
                  <div class="tests-tag-list" id="test-share-tags"></div>
                  <input id="test-share-input" class="tests-tag-input" placeholder="Type a username" autocomplete="off" spellcheck="false">
                </div>
                <div class="tests-tag-suggestions d-none" id="test-share-suggestions"></div>
                <div class="d-flex justify-content-end mt-2">
                  <button type="button" class="btn btn-sm btn-outline-primary tests-save-share-btn">Save Sharing</button>
                </div>
              </div>
            `
            : ""
        }
        <div class="tests-details-actions">
          ${
            permissions.isCreator
              ? `
                <button type="button" class="btn btn-sm btn-outline-warning tests-archive-btn">
                  <i class="bi bi-archive"></i>
                  <span>Archive Test</span>
                </button>
                <button type="button" class="btn btn-sm btn-outline-danger tests-delete-btn">
                  <i class="bi bi-trash"></i>
                  <span>Delete Test</span>
                </button>
              `
              : ""
          }
          <button type="button" class="btn btn-sm btn-outline-secondary tests-unlist-btn">
            <i class="bi bi-eye-slash"></i>
            <span>Unlist Test</span>
          </button>
        </div>
      </section>
      <section class="tests-overview-card">
        <h2>Question Sources</h2>
        <div class="tests-review-metrics">
          <span class="tests-review-pill">${assignmentCount} assignments</span>
          <span class="tests-review-pill">${pyqCount} PYQ chapters</span>
          <span class="tests-review-pill">${globalFilterCount} global filters</span>
          <span class="tests-review-pill">${escapeHtml(reuseMode)} ${reuseCount} test${reuseCount === 1 ? "" : "s"}</span>
        </div>
      </section>
      <section class="tests-overview-card">
        <h2>Test Blueprint</h2>
        <div class="tests-review-metrics mb-3">
          <span class="tests-review-pill">${escapeHtml(formatTimeLimit(timeLimitMinutes))}</span>
        </div>
        ${
          sections.length
            ? `<div class="tests-review-section-list">${sections
                .map(
                  (section) => `
                    <div class="tests-review-section-row">
                      <div>
                        <div class="fw-semibold">${escapeHtml(section.name || "Section")}</div>
                        <div class="text-secondary small">${escapeHtml(
                          getQuestionTypeLabel(section.type)
                        )} &middot; ${escapeHtml(section.questionCount || 0)} question(s) per subject</div>
                      </div>
                      <div class="tests-review-pill">+${escapeHtml(section.positiveMarks || 0)} / -${escapeHtml(section.negativeMarks || 0)}</div>
                    </div>
                  `
                )
                .join("")}</div>`
            : '<div class="tests-overview-empty">No blueprint sections stored.</div>'
        }
      </section>
    `;
    els.details.querySelector(".tests-duplicate-btn")?.addEventListener("click", () => {
      const url = new URL("./tests.html", window.location.href);
      url.searchParams.set("duplicateTestId", String(test.testId || testId));
      window.location.href = url.toString();
    });
    els.details.querySelector(".tests-archive-btn")?.addEventListener("click", async () => {
      if (!confirm("Archive this test? It will be hidden from the Tests tab.")) return;
      await runTestAction(() => TestsService.archiveTest(test.testId || testId), "Test archived.");
    });
    els.details.querySelector(".tests-delete-btn")?.addEventListener("click", async () => {
      if (!confirm("Delete this test permanently?")) return;
      await runTestAction(() => TestsService.deleteTest(test.testId || testId), "Test deleted.");
    });
    els.details.querySelector(".tests-unlist-btn")?.addEventListener("click", async () => {
      const shouldUnlist = await confirmTestAction({
        title: "Unlist Test",
        message:
          "This test will be removed from your Tests tab. You can add it again later using its test ID.",
        confirmText: "Unlist Test",
        confirmClass: "btn btn-warning",
      });
      if (!shouldUnlist) return;
      await runTestAction(() => TestsService.unlistTest(test.testId || testId), "", {
        showSuccess: false,
      });
    });
    if (permissions.isCreator) {
      setupShareEditor({ testId: test.testId || testId, selected: sharedWith });
    }
  }

  async function setupShareEditor({ testId, selected }) {
    const field = document.getElementById("test-share-field");
    const list = document.getElementById("test-share-tags");
    const input = document.getElementById("test-share-input");
    const suggestions = document.getElementById("test-share-suggestions");
    const summary = document.getElementById("test-share-summary");
    const saveBtn = els.details.querySelector(".tests-save-share-btn");
    if (!field || !list || !input || !suggestions || !saveBtn) return;
    const users = await TestsService.fetchShareUsers().catch(() => []);
    const usernames = users
      .map((user) => String(user.username || "").trim())
      .filter(Boolean);
    const state = {
      selected: Array.from(
        new Set((selected || []).map((item) => String(item).trim()).filter(Boolean))
      ).filter((username) => usernames.includes(username)),
      highlightedIndex: 0,
    };
    const closeSuggestions = () => {
      suggestions.classList.add("d-none");
      suggestions.innerHTML = "";
      state.highlightedIndex = 0;
    };
    const getMatches = () => {
      const query = input.value.trim().toLowerCase();
      if (!query) return [];
      return usernames
        .filter(
          (username) =>
            username.toLowerCase().includes(query) &&
            !state.selected.includes(username)
        )
        .slice(0, 6);
    };
    const renderTags = () => {
      list.innerHTML = "";
      state.selected.forEach((username) => {
        const tag = document.createElement("span");
        tag.className = "tests-tag-chip";
        tag.innerHTML = `
          <span>${escapeHtml(username)}</span>
          <button type="button" class="tests-tag-chip-remove" aria-label="Remove ${escapeAttr(username)}" title="Remove ${escapeAttr(username)}">
            <i class="bi bi-x-lg"></i>
          </button>
        `;
        tag.querySelector(".tests-tag-chip-remove")?.addEventListener("click", () => {
          state.selected = state.selected.filter((item) => item !== username);
          renderTags();
          renderSuggestions();
          input.focus();
        });
        list.appendChild(tag);
      });
      input.placeholder = state.selected.length ? "" : "Type a username";
      if (summary) summary.textContent = state.selected.length ? state.selected.join(", ") : "No one";
    };
    const addUsername = (username) => {
      if (!username || state.selected.includes(username) || !usernames.includes(username)) return;
      state.selected.push(username);
      input.value = "";
      renderTags();
      closeSuggestions();
    };
    const renderSuggestions = () => {
      const matches = getMatches();
      if (!matches.length) {
        closeSuggestions();
        return;
      }
      if (state.highlightedIndex >= matches.length) state.highlightedIndex = 0;
      suggestions.innerHTML = "";
      matches.forEach((username, index) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `tests-tag-suggestion${index === state.highlightedIndex ? " active" : ""}`;
        btn.textContent = username;
        btn.addEventListener("mousedown", (event) => {
          event.preventDefault();
          addUsername(username);
        });
        suggestions.appendChild(btn);
      });
      suggestions.classList.remove("d-none");
    };
    field.addEventListener("click", () => input.focus());
    input.addEventListener("input", () => {
      state.highlightedIndex = 0;
      renderSuggestions();
    });
    input.addEventListener("keydown", (event) => {
      const matches = getMatches();
      if ((event.key === "Tab" || event.key === "Enter") && matches.length) {
        event.preventDefault();
        addUsername(matches[state.highlightedIndex] || matches[0]);
        return;
      }
      if (event.key === "ArrowDown" && matches.length) {
        event.preventDefault();
        state.highlightedIndex = (state.highlightedIndex + 1) % matches.length;
        renderSuggestions();
        return;
      }
      if (event.key === "ArrowUp" && matches.length) {
        event.preventDefault();
        state.highlightedIndex =
          (state.highlightedIndex - 1 + matches.length) % matches.length;
        renderSuggestions();
      }
    });
    input.addEventListener("blur", () => window.setTimeout(closeSuggestions, 120));
    saveBtn.addEventListener("click", async () => {
      try {
        saveBtn.disabled = true;
        await TestsService.updateTestShare(testId, state.selected);
        alert("Sharing updated.");
      } catch (error) {
        console.error(error);
        alert(error?.message || "Failed to update sharing.");
      } finally {
        saveBtn.disabled = false;
      }
    });
    renderTags();
  }

  async function confirmTestAction({
    title,
    message,
    confirmText,
    confirmClass = "btn btn-primary",
  }) {
    if (typeof showModal !== "function") return false;
    const result = await showModal({
      title,
      bodyHTML: `<p class="mb-0">${escapeHtml(message)}</p>`,
      buttons: [
        { text: "Cancel", className: "btn btn-outline-secondary", value: "cancel" },
        { text: confirmText, className: confirmClass, value: "confirm" },
      ],
      focusSelector: ".btn-outline-secondary",
    });
    return result === "confirm";
  }

  async function runTestAction(action, message, options = {}) {
    try {
      await action();
      if (options.showSuccess !== false && message) alert(message);
      window.location.href = "./tests.html";
    } catch (error) {
      console.error(error);
      if (typeof showModal === "function") {
        await showModal({
          title: "Action Failed",
          bodyHTML: `<p class="mb-0">${escapeHtml(
            error?.message || "Action failed."
          )}</p>`,
          buttons: [{ text: "OK", className: "btn btn-primary", value: "ok" }],
        });
      } else {
        alert(error?.message || "Action failed.");
      }
    }
  }

  function hasSourceFilters(filters) {
    if (!filters || filters.matchNone) return !!filters?.matchNone;
    return !!(
      String(filters.q || "").trim() ||
      (Array.isArray(filters.years) && filters.years.length) ||
      (Array.isArray(filters.status) && filters.status.length) ||
      (Array.isArray(filters.diff) && filters.diff.length) ||
      (Array.isArray(filters.colors) && filters.colors.length) ||
      (Array.isArray(filters.bookmarkTagIds) && filters.bookmarkTagIds.length)
    );
  }

  function getQuestionTypeLabel(type) {
    if (type === "multiple") return "Multiple correct";
    if (type === "numerical") return "Numerical";
    return "Single correct";
  }

  function formatTimeLimit(minutes) {
    const totalMinutes = Math.max(0, Math.round(Number(minutes) || 0));
    if (!totalMinutes) return "No time limit";
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    if (!hours) return `${mins} min`;
    if (!mins) return `${hours} hr${hours === 1 ? "" : "s"}`;
    return `${hours} hr${hours === 1 ? "" : "s"} ${mins} min`;
  }

  function showError(message) {
    setVisible(els.loading, false);
    setVisible(els.content, false);
    els.error.textContent = message;
    setVisible(els.error, true);
  }

  function setVisible(el, show) {
    if (!el) return;
    el.classList.toggle("d-none", !show);
  }

  function formatScore(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "0";
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value || "Unknown date";
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value || "Not submitted";
    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = value ?? "";
    return div.innerHTML;
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/"/g, "&quot;");
  }
})();
