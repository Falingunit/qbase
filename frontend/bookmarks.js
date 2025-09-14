"use strict";
(async () => {
  const katexOptions = {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "$", right: "$", display: false },
      { left: "\\(", right: "\\)", display: false },
      { left: "\\[", right: "\\]", display: true },
    ],
  };

  //
  // Attach UI handlers ASAP (works whether DOM is loading or already loaded)
  //
  const onReady = () => {
    // These elements exist on the page layout
    const refreshBtn = document.getElementById("refresh-bookmarks");
    const openBtn = document.getElementById("open-assignment-btn");

    if (refreshBtn) refreshBtn.addEventListener("click", loadBookmarks);
    if (openBtn) openBtn.addEventListener("click", openInAssignment);

    // Initial load
    loadBookmarks();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", onReady, { once: true });
  } else {
    onReady();
  }

  // Map aID -> title from assignment_list.json (best-effort)
  const assignmentTitles = new Map();
  (async () => {
    try {
      const raw = await (await fetch("./data/assignment_list.json")).json();
      const items = normalizeAssignmentsForTitles(raw);
      items.forEach((it) => assignmentTitles.set(Number(it.aID), it.title));
    } catch {
      /* ignore */
    }
  })();

  function normalizeAssignmentsForTitles(input) {
    const out = [];
    const pushItem = (raw) => {
      if (!raw || typeof raw !== "object") return;
      const id = Number(
        raw.aID ?? raw.id ?? raw.assignmentId ?? raw.AID ?? raw.Aid
      );
      if (!Number.isFinite(id)) return;
      const title = String(raw.title ?? raw.name ?? raw.assignmentTitle ?? `Assignment ${id}`);
      out.push({ aID: id, title });
    };
    if (Array.isArray(input)) input.forEach(pushItem);
    else if (input && Array.isArray(input.assignments)) input.assignments.forEach(pushItem);
    else if (input && Array.isArray(input.items)) input.items.forEach(pushItem);
    else if (input && typeof input === "object") {
      Object.values(input).forEach((arr) => {
        if (Array.isArray(arr)) arr.forEach(pushItem);
      });
    }
    return out;
  }

  //
  // Do async config after handlers are registered
  //
  await loadConfig();

  // Refresh on login / bfcache restore
  window.addEventListener("qbase:login", loadBookmarks);
  window.addEventListener("pageshow", loadBookmarks);

  // Show logged-out state
  window.addEventListener("qbase:logout", () => {
    const loadingEl = document.getElementById("loading");
    const noBookmarksEl = document.getElementById("no-bookmarks");
    const contentEl = document.getElementById("bookmarks-content");
    if (!loadingEl || !noBookmarksEl || !contentEl) return;

    loadingEl.style.display = "none";
    contentEl.style.display = "none";
    noBookmarksEl.style.display = "block";
    noBookmarksEl.innerHTML = `
      <h3>Login required</h3>
      <p class="text-muted">Please sign in to view your bookmarks.</p>
    `;
  });

  let currentBookmarks = [];
  let __bookmarksLoadSeq = 0; // prevent overlapping load races
  const assignmentData = new Map();

  async function loadBookmarks() {
    const mySeq = ++__bookmarksLoadSeq;
    const loadingEl = document.getElementById("loading");
    const noBookmarksEl = document.getElementById("no-bookmarks");
    const contentEl = document.getElementById("bookmarks-content");
    if (!loadingEl || !noBookmarksEl || !contentEl) return;

    loadingEl.style.display = "block";
    noBookmarksEl.style.display = "none";
    contentEl.style.display = "none";

    try {
      const response = await authFetch(`${API_BASE}/api/bookmarks`, {
        cache: "no-store",
      });
      if (mySeq !== __bookmarksLoadSeq) return; // outdated response

      if (!response.ok) {
        if (response.status === 401) {
          if (mySeq !== __bookmarksLoadSeq) return;
          loadingEl.style.display = "none";
          noBookmarksEl.style.display = "block";
          noBookmarksEl.innerHTML = `
            <h3>Login required</h3>
            <p class="text-muted">Please sign in to view your bookmarks.</p>
            <button class="btn btn-primary" onclick="window.dispatchEvent(new Event('qbase:force-login'))">
              Sign in
            </button>
          `;
          window.dispatchEvent(new Event("qbase:logout"));
          return;
        }
        throw new Error(`HTTP ${response.status}`);
      }

      currentBookmarks = await response.json();
      if (mySeq !== __bookmarksLoadSeq) return;

      if (!Array.isArray(currentBookmarks) || currentBookmarks.length === 0) {
        loadingEl.style.display = "none";
        noBookmarksEl.style.display = "block";
        noBookmarksEl.textContent = "No bookmarks yet.";
        return;
      }

      const bookmarksByTag = groupBookmarksByTag(currentBookmarks);
      await loadAssignmentData(bookmarksByTag);
      if (mySeq !== __bookmarksLoadSeq) return;
      renderBookmarks(bookmarksByTag);

      loadingEl.style.display = "none";
      contentEl.style.display = "block";
    } catch (error) {
      console.error("Failed to load bookmarks:", error);
      if (mySeq !== __bookmarksLoadSeq) return;
      loadingEl.style.display = "none";
      noBookmarksEl.style.display = "block";
      noBookmarksEl.innerHTML = `
        <h3>Error loading bookmarks</h3>
        <p class="text-muted">Failed to load bookmarks. Please try again.</p>
        <button class="btn btn-primary" onclick="window.qbLoadBookmarks()">Retry</button>
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

    questions.forEach((q) => {
      if (q.qType === "Passage") {
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
          const resp = await fetch(
            `./data/question_data/${id}/assignment.json`
          );
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

  // KaTeX-safe truncation: avoids cutting through math blocks
  function truncateKaTeXSafe(input, limit = 100, katexDelimiters) {
    const s = String(input ?? "");
    if (!s) return "";

    const delimiters = (
      Array.isArray(katexDelimiters) && katexDelimiters.length
        ? [...katexDelimiters]
        : [
            { left: "$$", right: "$$" },
            { left: "$", right: "$" },
            { left: "\\[", right: "\\]" },
            { left: "\\(", right: "\\)" },
          ]
    ).sort((a, b) => b.left.length - a.left.length); // prefer "$$" over "$"

    const isEscaped = (str, pos) => {
      let n = 0,
        i = pos - 1;
      while (i >= 0 && str[i] === "\\") {
        n++;
        i--;
      }
      return n % 2 === 1;
    };

    let i = 0;
    let out = "";
    let truncated = false;

    while (i < s.length && out.length < limit) {
      // Check if a math block starts at i
      let matched = null;
      for (const d of delimiters) {
        if (s.startsWith(d.left, i)) {
          if (d.left[0] === "$" && isEscaped(s, i)) continue; // skip escaped $
          matched = d;
          break;
        }
      }

      if (matched) {
        // Find closing delimiter (unescaped for $)
        const right = matched.right;
        let searchFrom = i + matched.left.length;
        let end = -1;

        while (searchFrom <= s.length - right.length) {
          const idx = s.indexOf(right, searchFrom);
          if (idx === -1) break;
          if (right[0] === "$" && isEscaped(s, idx)) {
            searchFrom = idx + 1;
            continue;
          }
          end = idx;
          break;
        }

        if (end === -1) {
          // Unmatched opener; treat as plain text
          const remaining = Math.min(1, limit - out.length);
          out += s.slice(i, i + remaining);
          i += remaining;
        } else {
          const block = s.slice(i, end + right.length);
          if (out.length + block.length <= limit) {
            out += block;
            i = end + right.length;
          } else {
            truncated = true;
            break; // don't include partial block
          }
        }
      } else {
        // Append plain text up to next math start or limit
        let next = s.length;
        for (const d of delimiters) {
          const idx = s.indexOf(d.left, i);
          if (idx !== -1) {
            if (d.left[0] === "$" && isEscaped(s, idx)) continue;
            if (idx < next) next = idx;
          }
        }
        const take = Math.min(next, i + (limit - out.length));
        out += s.slice(i, take);
        i = take;
        if (out.length >= limit && i < s.length) truncated = true;
      }
    }

    if (truncated || out.length < s.length) return out + "...";
    return out;
  }

  function renderBookmarks(bookmarksByTag) {
    const contentEl = document.getElementById("bookmarks-content");
    if (!contentEl) return;

    const sortedTags = Object.keys(bookmarksByTag).sort((a, b) => {
      if (a === "Doubt") return -1;
      if (b === "Doubt") return 1;
      return a.localeCompare(b);
    });

    const TRUNCATE_LIMIT = 100;

    let html = "";
    for (const tagName of sortedTags) {
      const bookmarks = bookmarksByTag[tagName];
      const tagId = bookmarks && bookmarks.length ? bookmarks[0].tagId : null;
      html += `
      <div class="card mb-4">
        <div class="card-header d-flex justify-content-between align-items-center">
          <h5 class="mb-0">
            <i class="bi bi-bookmark-fill text-primary"></i>
            ${escapeHtml(tagName)}
            <span class="badge bg-secondary ms-2">${bookmarks.length}</span>
          </h5>
          <div>
            ${
              tagId
                ? `<button class="btn btn-sm btn-outline-danger delete-tag" data-tag-id="${escapeHtml(
                    String(tagId)
                  )}" data-tag-name="${escapeHtml(tagName)}" title="Delete tag and its bookmarks">
                     <i class="bi bi-trash"></i>
                   </button>`
                : ""
            }
          </div>
        </div>
        <div class="card-body">
          <div class="row row-cols-1 row-cols-md-2 row-cols-lg-3 g-3">
    `;
      for (const b of bookmarks) {
        const assignment = assignmentData.get(b.assignmentId);
        if (!assignment) continue;
        const q = assignment.questions[b.questionIndex];
        if (!q) continue;
        // Compute display index (excludes Passage markers)
        const displayIndex =
          assignment.questions
            .slice(0, b.questionIndex + 1)
            .filter((qq) => qq.qType !== "Passage").length - 1;

        const text = q.qText || "Question text not available";
        const truncated = truncateKaTeXSafe(
          text,
          TRUNCATE_LIMIT,
          katexOptions?.delimiters
        );

        html += `
        <div class="col">
          <div class="as-card card h-100 bookmark-card"
            data-assignment-id="${escapeHtml(String(b.assignmentId))}"
            data-question-index="${escapeHtml(String(b.questionIndex))}"
            data-display-index="${escapeHtml(String(displayIndex))}"
            style="cursor:pointer;">
            <div class="card-body">
              <div class="d-flex justify-content-between align-items-start mb-2">
                <small class="text-muted">Assignment ${b.assignmentId} • Q${
          displayIndex + 1
        }</small>
                <button class="btn btn-sm btn-outline-danger remove-bookmark"
                  data-assignment-id="${escapeHtml(String(b.assignmentId))}"
                  data-question-index="${escapeHtml(String(b.questionIndex))}"
                  data-tag-id="${escapeHtml(String(b.tagId))}">
                  <i class="bi bi-x"></i>
                </button>
              </div>
              <p class="card-text">${escapeHtml(truncated).replace(/\n/g, "<br>")}</p>
              <div class="d-flex justify-content-between align-items-center">
                <span class="badge bg-info">${escapeHtml(
                  String(q.qType)
                )}</span>
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

    // Render KaTeX after injecting HTML
    document.querySelectorAll(".card-text").forEach((card) => {
      renderMathInElement(card, katexOptions);
    });

    // Card click -> show modal with question
    document.querySelectorAll(".bookmark-card").forEach((card) => {
      card.addEventListener("click", (e) => {
        if (!e.target.closest(".remove-bookmark")) {
          showQuestion(card.dataset.assignmentId, card.dataset.questionIndex);
        }
      });
    });

    // Remove bookmark buttons
    document.querySelectorAll(".remove-bookmark").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (
          await removeBookmark(
            btn.dataset.assignmentId,
            btn.dataset.questionIndex,
            btn.dataset.tagId
          )
        ) {
          loadBookmarks();
        }
      });
    });

    // Delete entire tag (and its bookmarks)
    document.querySelectorAll(".delete-tag").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const tagId = btn.dataset.tagId;
        const tagName = btn.dataset.tagName || "this tag";
        let confirmed = false;
        try {
          confirmed = await (window.showConfirm
            ? showConfirm({
                title: "Delete Tag",
                message: `Delete "${escapeHtml(tagName)}" and all its bookmarks?`,
                okText: "Delete",
                cancelText: "Cancel",
              })
            : Promise.resolve(
                confirm(
                  `Delete "${tagName}" and all its bookmarks? This cannot be undone.`
                )
              ));
        } catch {}
        if (!confirmed) return;
        if (await deleteBookmarkTag(tagId)) {
          loadBookmarks();
        }
      });
    });
  }

  async function removeBookmark(assignmentId, questionIndex, tagId) {
    try {
      const resp = await authFetch(
        `${API_BASE}/api/bookmarks/${assignmentId}/${questionIndex}/${tagId}`,
        { method: "DELETE" }
      );
      return resp.ok;
    } catch (err) {
      console.error("Failed to remove bookmark:", err);
      alert("Failed to remove bookmark.");
      return false;
    }
  }

  async function deleteBookmarkTag(tagId) {
    try {
      const resp = await authFetch(
        `${API_BASE}/api/bookmark-tags/${tagId}`,
        { method: "DELETE" }
      );
      if (!resp.ok) {
        const msg = `Failed to delete tag (HTTP ${resp.status})`;
        console.error(msg);
        alert(msg);
        return false;
      }
      return true;
    } catch (err) {
      console.error("Failed to delete tag:", err);
      alert("Failed to delete tag.");
      return false;
    }
  }

  async function showQuestion(assignmentId, questionIndex) {
    try {
      const assignment = assignmentData.get(parseInt(assignmentId, 10));
      if (!assignment) {
        alert("Assignment data not available");
        return;
      }

      const qIdx = parseInt(questionIndex, 10);
      const question = assignment.questions[qIdx];
      if (!question) {
        alert("Question not found");
        return;
      }

      // Load question state for notes
      let questionState = null;
      try {
        const stateResponse = await authFetch(
          `${API_BASE}/api/state/${assignmentId}`
        );
        if (stateResponse.ok) {
          const states = await stateResponse.json();
          if (Array.isArray(states) && states[qIdx]) {
            questionState = states[qIdx];
          }
        }
      } catch (error) {
        console.warn("Failed to load question state:", error);
      }

      const modalEl = document.getElementById("questionModal");
      const titleEl = document.getElementById("questionModalTitle");
      const bodyEl = document.getElementById("questionModalBody");
      const openBtn = document.getElementById("open-assignment-btn");

      if (!modalEl || !titleEl || !bodyEl || !openBtn) return;

      const modal = new bootstrap.Modal(modalEl);

      const niceTitle =
        assignmentTitles.get(Number(assignmentId)) ||
        `Assignment ${assignmentId}`;
      // Compute display index to show consistent numbering with assignment page
      const displayIndex =
        assignment.questions
          .slice(0, qIdx + 1)
          .filter((qq) => qq.qType !== "Passage").length - 1;
      titleEl.textContent = `${niceTitle} • Question ${displayIndex + 1}`;

      // Store for "Open in Assignment"
      openBtn.dataset.assignmentId = assignmentId;
      openBtn.dataset.questionIndex = String(qIdx); // original index
      openBtn.dataset.displayIndex = String(displayIndex);

      // Render the question
      bodyEl.innerHTML = renderQuestionForView(
        question,
        assignment,
        questionState,
        assignmentId,
        qIdx
      );

      // Render KaTeX if present
      if (window.renderMathInElement) {
        const katexOptions = {
          delimiters: [
            { left: "$$", right: "$$", display: true },
            { left: "$", right: "$", display: false },
            { left: "\\(", right: "\\)", display: false },
            { left: "\\[", right: "\\]", display: true },
          ],
        };
        window.renderMathInElement(bodyEl, katexOptions);
      }

      // Notes
      setupNotesEditing(assignmentId, qIdx, questionState);

      modal.show();
    } catch (error) {
      console.error("Failed to show question:", error);
      alert("Failed to load question");
    }
  }

  function renderQuestionForView(
    question,
    assignment,
    questionState,
    assignmentId,
    questionIndex
  ) {
    const esc = (v) =>
      String(v ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

    const imgSrc = (file) =>
      `./data/question_data/${encodeURIComponent(
        String(assignmentId)
      )}/${encodeURIComponent(String(file))}`;

    let html = "";

    // Passage
    if (question.passage) {
      html += '<div class="mb-4 p-3 bg-dark rounded">';
      html += '<h6 class="text-muted mb-2">Passage:</h6>';

      if (question.passageImage) {
        html += `<div class="mb-3"><img src="${imgSrc(
          question.passageImage
        )}" class="img-fluid" alt="Passage Image"></div>`;
      }

      // keep as plain text (safe for KaTeX render later)
      html += `<div class="passage-text">${esc(question.passage)}</div>`;
      html += "</div>";
    }

    // Question text
    if (question.qText) {
      html += `<div class="mb-3"><strong>Question:</strong><br><div class="question-text">${esc(
        question.qText
      ).replace(/\n/g, "<br>")}</div></div>`;
    }

    // Question image
    if (question.image) {
      html += `<div class="mb-3"><img src="${imgSrc(
        question.image
      )}" class="img-fluid" alt="Question Image"></div>`;
    }

    // Options (SMCQ/MMCQ)
    if (question.qType === "SMCQ" || question.qType === "MMCQ") {
      html += '<div class="mb-3">';
      const options = ["A", "B", "C", "D"];
      const correctAnswers = normalizeAnswer(question);

      for (let i = 0; i < options.length; i++) {
        const option = options[i];
        const optionText = question.qOptions
          ? question.qOptions[i]
          : question[`q${option}`];
        if (!optionText) continue;

        const isCorrect = correctAnswers.has(option);
        const correctClass = isCorrect ? "border-success border-2" : "";
        html += `
          <div class="btn btn-outline-secondary text-start w-100 mb-2 ${correctClass}" style="pointer-events: none; color: white !important;">
            <span class="option-label">${option}.</span> <span class="option-text">${esc(
          optionText
        )}</span>
          </div>
        `;
      }
      html += "</div>";

      const correctOptions = Array.from(correctAnswers).sort();
      html += `<div class="alert alert-success"><strong>Correct Answer:</strong> ${esc(
        correctOptions.join(", ")
      )}</div>`;
    }

    // Numerical
    if (question.qType === "Numerical") {
      const answer = normalizeAnswer(question);
      if (answer.valid) {
        html += `<div class="alert alert-success"><strong>Correct Answer:</strong> ${esc(
          answer.value
        )}</div>`;
      }
    }

    // Notes
    html += `
      <div class="mt-4">
        <h6>Notes:</h6>
        <textarea id="question-notes" class="form-control" rows="4" placeholder="Add your notes here...">${esc(
          questionState?.notes || ""
        )}</textarea>
        <div class="mt-2">
          <button id="save-notes-btn" class="btn btn-primary btn-sm">Save Notes</button>
          <span id="notes-save-status" class="ms-2 text-muted"></span>
        </div>
      </div>
    `;

    return html;
  }

  function normalizeAnswer(q) {
    if (q.qType === "SMCQ") {
      return new Set([String(q.qAnswer).trim().toUpperCase()]);
    }
    if (q.qType === "MMCQ") {
      const arr = Array.isArray(q.qAnswer) ? q.qAnswer : [q.qAnswer];
      return new Set(arr.map((x) => String(x).trim().toUpperCase()));
    }
    if (q.qType === "Numerical") {
      const n = Number(q.qAnswer);
      return { value: n, valid: !Number.isNaN(n) };
    }
    return new Set();
  }

  function openInAssignment() {
    const btn = document.getElementById("open-assignment-btn");
    if (!btn) return;

    const assignmentId = btn.dataset.assignmentId;
    const originalIndex = btn.dataset.questionIndex;
    // Prefer the precomputed display index if present
    let displayIndex = btn.dataset.displayIndex;

    if (!displayIndex && assignmentId && originalIndex !== undefined) {
      // Derive display index from loaded assignment data
      const a = assignmentData.get(parseInt(assignmentId, 10));
      if (a) {
        const qIdx = parseInt(originalIndex, 10);
        displayIndex = String(
          a.questions.slice(0, qIdx + 1).filter((q) => q.qType !== "Passage").length - 1
        );
      }
    }

    if (assignmentId && displayIndex !== undefined) {
      window.open(
        `./assignment.html?aID=${encodeURIComponent(assignmentId)}&q=${
          parseInt(displayIndex, 10) + 1
        }`,
        "_blank"
      );
    }
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text ?? "";
    return div.innerHTML;
  }

  function formatDate(dateString) {
    const date = new Date(dateString);
    return (
      date.toLocaleDateString() +
      " " +
      date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    );
  }

  // Notes editing
  function setupNotesEditing(assignmentId, questionIndex, questionState) {
    const notesTextarea = document.getElementById("question-notes");
    const saveNotesBtn = document.getElementById("save-notes-btn");
    const saveStatus = document.getElementById("notes-save-status");

    if (!notesTextarea || !saveNotesBtn) return;

    let saveTimeout;

    // Auto-save on input (debounced)
    notesTextarea.addEventListener("input", () => {
      clearTimeout(saveTimeout);
      saveTimeout = setTimeout(() => {
        saveNotes(assignmentId, questionIndex, notesTextarea.value, saveStatus);
      }, 1000);
    });

    // Manual save button
    saveNotesBtn.addEventListener("click", () => {
      saveNotes(assignmentId, questionIndex, notesTextarea.value, saveStatus);
    });
  }

  // Save notes to server
  async function saveNotes(assignmentId, questionIndex, notes, statusElement) {
    try {
      // First, get the current state
      const stateResponse = await authFetch(
        `${API_BASE}/api/state/${assignmentId}`
      );
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
          pickedAnswer: "",
          pickedNumerical: undefined,
          time: 0,
          notes: "",
        });
      }

      // Update notes
      states[questionIndex].notes = notes;

      // Save the updated state
      const saveResponse = await authFetch(
        `${API_BASE}/api/state/${assignmentId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: states }),
        }
      );

      if (saveResponse.ok) {
        statusElement.textContent = "Saved";
        statusElement.className = "ms-2 text-success";
        setTimeout(() => {
          statusElement.textContent = "";
        }, 2000);
      } else {
        throw new Error("Failed to save");
      }
    } catch (error) {
      console.error("Failed to save notes:", error);
      statusElement.textContent = "Save failed";
      statusElement.className = "ms-2 text-danger";
      setTimeout(() => {
        statusElement.textContent = "";
      }, 3000);
    }
  }
  
  // Expose retry for inline button
  window.qbLoadBookmarks = loadBookmarks;
})();
