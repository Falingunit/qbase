"use strict";

(function () {
  const params = new URLSearchParams(window.location.search);
  const tagId = String(params.get("tagId") || "").trim();
  const fetcher = typeof authFetch === "function" ? authFetch : fetch;

  const stateCache = new Map();
  const sourceLabels = new Map();

  function defaultState() {
    return {
      isAnswerPicked: false,
      pickedAnswers: [],
      isAnswerEvaluated: false,
      pickedAnswer: "",
      pickedNumerical: undefined,
      time: 0,
      notes: "",
      markedForReview: false,
      resetLockedUntil: 0,
    };
  }

  function stableViewId(seed) {
    const input = String(seed || "bookmark-tag");
    let h = 0;
    for (let i = 0; i < input.length; i += 1) {
      h = ((h << 5) - h + input.charCodeAt(i)) | 0;
    }
    return ((h >>> 0) % 2147483647) || 2147483646;
  }

  function sourceContainerKey(source) {
    if (!source || typeof source !== "object") return "";
    if (source.kind === "pyq") {
      return `pyq:${source.examId}:${source.subjectId}:${source.chapterId}`;
    }
    return `assignment:${source.assignmentId}`;
  }

  function sourceQuestionKey(source) {
    return `${sourceContainerKey(source)}:q:${Number(source.questionIndex)}`;
  }

  function normalizeAssignmentImagePath(assignmentId, value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (
      /^(https?:)?\/\//i.test(raw) ||
      /^data:/i.test(raw) ||
      raw.startsWith("./") ||
      raw.startsWith("../") ||
      raw.startsWith("/")
    ) {
      return raw;
    }
    if (/^data\/question_data\//i.test(raw)) return raw;
    return `data/question_data/${encodeURIComponent(String(assignmentId))}/${raw}`;
  }

  function normalizeAssignmentQuestion(row, assignmentId, sourceLabel) {
    const q = row && typeof row === "object" ? row : {};
    return {
      ...q,
      qType: String(q.qType || "SMCQ"),
      qText: String(q.qText || ""),
      image: normalizeAssignmentImagePath(assignmentId, q.image),
      passage: String(q.passage || ""),
      passageImage: normalizeAssignmentImagePath(assignmentId, q.passageImage),
      qOptions: Array.isArray(q.qOptions)
        ? q.qOptions.slice(0, 4)
        : [q.qA || "", q.qB || "", q.qC || "", q.qD || ""],
      qAnswer: q.qAnswer,
      solutionText:
        typeof q.solutionText === "string"
          ? q.solutionText
          : typeof q.sText === "string"
            ? q.sText
            : typeof q?.solution?.sText === "string"
              ? q.solution.sText
              : "",
      solutionImage:
        normalizeAssignmentImagePath(
          assignmentId,
          q.solutionImage || q.sImage || q?.solution?.sImage || q?.solution?.image,
        ) || null,
      questionIndex: Number(q.questionIndex),
      _testSource: {
        kind: "assignment",
        assignmentId: Number(assignmentId),
        questionIndex: Number(q.questionIndex),
      },
      _testSourceLabel: sourceLabel,
    };
  }

  function normalizePyqQuestion(row, source, sourceLabel) {
    const q = row && typeof row === "object" ? row : {};
    const type = String(q.qType || q.type || "").toLowerCase();
    let qType = "SMCQ";
    if (type.includes("numerical") || type.includes("integer")) qType = "Numerical";
    else if (Array.isArray(q.correctAnswer) && q.correctAnswer.length > 1) qType = "MMCQ";
    const qOptions = Array.isArray(q.options) && q.options.length
      ? q.options.map((opt) => String(opt?.oText || opt || "")).slice(0, 4)
      : Array.isArray(q.qOptions)
        ? q.qOptions.slice(0, 4)
        : [q.qA || "", q.qB || "", q.qC || "", q.qD || ""];
    while (qOptions.length < 4) qOptions.push("");

    let qAnswer = q.qAnswer;
    if (qAnswer == null) {
      if (q.correctAnswer && typeof q.correctAnswer === "object" && !Array.isArray(q.correctAnswer)) {
        qAnswer = q.correctAnswer;
      } else if (qType === "Numerical") {
        const n = Number(q.correctAnswer);
        qAnswer = Number.isFinite(n) ? n : undefined;
      } else if (Array.isArray(q.correctAnswer)) {
        qAnswer =
          qType === "MMCQ"
            ? q.correctAnswer.map((x) => String(x).trim().toUpperCase())
            : String(q.correctAnswer[0] || "").trim().toUpperCase();
      } else {
        qAnswer = String(q.correctAnswer || "").trim().toUpperCase();
      }
    }

    return {
      ...q,
      qType,
      qText: String(q.qText || ""),
      image: q.qImage || q.image || null,
      qOptions,
      qAnswer,
      pyqInfo: String(q.pyqInfo || ""),
      diffuculty: String(q.diffuculty || q.level || ""),
      solutionText:
        String(q?.solution?.sText || q.solutionText || q.sText || ""),
      solutionImage:
        q?.solution?.sImage || q.solutionImage || q.sImage || null,
      questionIndex: Number(source.questionIndex),
      _testSource: { ...source },
      _testSourceLabel: sourceLabel,
    };
  }

  async function fetchJson(url) {
    const response = await fetcher(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return await response.json();
  }

  async function buildPyqLabelMaps(rows) {
    const uniqueExamIds = Array.from(new Set(rows.map((row) => String(row.examId))));
    const examNames = new Map();
    const subjectNames = new Map();
    const chapterNames = new Map();

    try {
      const exams = await fetchJson(`${API_BASE}/api/pyqs/exams`);
      (Array.isArray(exams) ? exams : []).forEach((exam) => {
        examNames.set(String(exam.id), String(exam.name || exam.id));
      });
    } catch {}

    for (const examId of uniqueExamIds) {
      try {
        const subjects = await fetchJson(
          `${API_BASE}/api/pyqs/exams/${encodeURIComponent(examId)}/subjects`,
        );
        (Array.isArray(subjects) ? subjects : []).forEach((subject) => {
          subjectNames.set(
            `${examId}:${subject.id}`,
            String(subject.name || subject.id),
          );
        });
      } catch {}
    }

    const chapterGroups = new Map();
    rows.forEach((row) => {
      const key = `${row.examId}:${row.subjectId}`;
      if (!chapterGroups.has(key)) {
        chapterGroups.set(key, {
          examId: String(row.examId),
          subjectId: String(row.subjectId),
        });
      }
    });

    for (const group of chapterGroups.values()) {
      try {
        const chapters = await fetchJson(
          `${API_BASE}/api/pyqs/exams/${encodeURIComponent(group.examId)}/subjects/${encodeURIComponent(group.subjectId)}/chapters`,
        );
        (Array.isArray(chapters) ? chapters : []).forEach((chapter) => {
          chapterNames.set(
            `${group.examId}:${group.subjectId}:${chapter.id}`,
            String(chapter.name || chapter.id),
          );
        });
      } catch {}
    }

    rows.forEach((row) => {
      const examId = String(row.examId);
      const subjectId = String(row.subjectId);
      const chapterId = String(row.chapterId);
      const examName = examNames.get(examId) || examId;
      const subjectName = subjectNames.get(`${examId}:${subjectId}`) || subjectId;
      const chapterName =
        chapterNames.get(`${examId}:${subjectId}:${chapterId}`) || chapterId;
      const label = [chapterName, subjectName, examName].filter(Boolean).join(" · ");
      sourceLabels.set(
        sourceContainerKey({
          kind: "pyq",
          examId,
          subjectId,
          chapterId,
        }),
        label,
      );
    });
  }

  function normalizeBookmarkRow(row) {
    if (row && row.kind === "pyq") {
      return {
        kind: "pyq",
        examId: String(row.examId),
        subjectId: String(row.subjectId),
        chapterId: String(row.chapterId),
        questionIndex: Number(row.questionIndex),
        tagId: String(row.tagId),
        tagName: String(row.tagName || ""),
        created_at: row.created_at || "",
      };
    }
    return {
      kind: "assignment",
      assignmentId: Number(row.assignmentId),
      questionIndex: Number(row.questionIndex),
      tagId: String(row.tagId),
      tagName: String(row.tagName || ""),
      created_at: row.created_at || "",
    };
  }

  function normalizeMarkRow(row, source) {
    if (source.kind === "pyq") {
      return {
        kind: "pyq",
        examId: String(source.examId),
        subjectId: String(source.subjectId),
        chapterId: String(source.chapterId),
        questionIndex: Number(row.questionIndex),
        color: String(row.color || ""),
      };
    }
    return {
      kind: "assignment",
      assignmentId: Number(source.assignmentId),
      questionIndex: Number(row.questionIndex),
      color: String(row.color || ""),
    };
  }

  function groupRowsByContainer(rows) {
    const groups = new Map();
    rows.forEach((row, displayIdx) => {
      const key = sourceContainerKey(row._testSource);
      if (!groups.has(key)) {
        groups.set(key, {
          source: row._testSource,
          displayIndices: [],
        });
      }
      groups.get(key).displayIndices.push(displayIdx);
    });
    return groups;
  }

  async function loadFullStateForSource(source) {
    const key = sourceContainerKey(source);
    if (stateCache.has(key)) return stateCache.get(key);

    let states = [];
    try {
      if (source.kind === "pyq") {
        states = await BookmarksService.fetchPyqsQuestionState(
          source.examId,
          source.subjectId,
          source.chapterId,
        );
      } else {
        states = await BookmarksService.fetchQuestionState(source.assignmentId);
      }
    } catch {
      states = [];
    }
    const safe = Array.isArray(states) ? states.slice() : [];
    stateCache.set(key, safe);
    return safe;
  }

  async function persistStateGroups(displayState, options = {}) {
    const rows = Array.isArray(window.__BOOKMARK_TAG_ROWS__)
      ? window.__BOOKMARK_TAG_ROWS__
      : [];
    const groups = groupRowsByContainer(rows);

    for (const group of groups.values()) {
      const base = Array.isArray(stateCache.get(sourceContainerKey(group.source)))
        ? stateCache.get(sourceContainerKey(group.source)).slice()
        : (await loadFullStateForSource(group.source)).slice();

      group.displayIndices.forEach((displayIdx) => {
        const row = rows[displayIdx];
        const nextState = {
          ...defaultState(),
          ...((Array.isArray(displayState) ? displayState[displayIdx] : null) || {}),
        };
        while (base.length <= row.questionIndex) base.push(defaultState());
        base[row.questionIndex] = nextState;
      });

      stateCache.set(sourceContainerKey(group.source), base);

      if (options.keepalive) {
        const url =
          group.source.kind === "pyq"
            ? `${API_BASE}/api/pyqs/state/${encodeURIComponent(group.source.examId)}/${encodeURIComponent(group.source.subjectId)}/${encodeURIComponent(group.source.chapterId)}`
            : `${API_BASE}/api/state/${encodeURIComponent(group.source.assignmentId)}`;
        try {
          fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(window.qbGetToken ? { Authorization: `Bearer ${window.qbGetToken()}` } : {}),
            },
            body: JSON.stringify({ state: base }),
            keepalive: true,
          }).catch(() => {});
        } catch {}
        continue;
      }

      if (group.source.kind === "pyq") {
        await BookmarksService.savePyqsNotes(
          group.source.examId,
          group.source.subjectId,
          group.source.chapterId,
          base,
        );
      } else {
        await BookmarksService.saveNotes(group.source.assignmentId, base);
      }
    }
  }

  async function loadBookmarkTagAssignment() {
    if (typeof loadConfig === "function") {
      try {
        await loadConfig();
      } catch {}
    }

    const emptyState = {
      title: "Bookmark Tag",
      message: "No questions remain for this bookmark tag.",
      description:
        "This tag has no bookmarked questions yet. Go back to Bookmarks and pick another tag.",
      backHref: "./bookmarks.html",
      backText: "Back to Bookmarks",
    };

    window.__ASSIGNMENT_VIEW_ID__ = stableViewId(`bookmark-tag:${tagId}`);
    window.__ASSIGNMENT_EMPTY_STATE__ = emptyState;
    window.__BOOKMARK_TAG_CONTEXT__ = { tagId, tagName: "" };
    window.__BOOKMARK_TAG_ROWS__ = [];
    window.__ASSIGNMENT_CUSTOM_BOOTSTRAP__ = {
      meta: { title: "Bookmarks" },
      state: [],
      bookmarks: [],
      marks: [],
      tags: [],
    };

    if (!tagId) {
      return { meta: { title: "Bookmarks" }, questions: [] };
    }

    const [tags, assignmentBookmarks, pyqBookmarks] = await Promise.all([
      fetchJson(`${API_BASE}/api/bookmark-tags`).catch(() => []),
      fetchJson(`${API_BASE}/api/bookmarks`).catch(() => []),
      fetchJson(`${API_BASE}/api/pyqs/bookmarks`).catch(() => []),
    ]);

    const tag = (Array.isArray(tags) ? tags : []).find(
      (item) => String(item.id) === tagId,
    );
    const tagName = String(tag?.name || "Bookmark Tag");
    window.__BOOKMARK_TAG_CONTEXT__ = { tagId, tagName };
    window.__ASSIGNMENT_EMPTY_STATE__ = {
      ...emptyState,
      title: `Bookmarks · ${tagName}`,
      message: `No questions remain for "${tagName}".`,
    };

    const normalizedAssignmentBookmarks = (Array.isArray(assignmentBookmarks)
      ? assignmentBookmarks
      : []
    ).map((row) => normalizeBookmarkRow({ ...row, kind: "assignment" }));
    const normalizedPyqBookmarks = (Array.isArray(pyqBookmarks) ? pyqBookmarks : []).map(
      (row) => normalizeBookmarkRow({ ...row, kind: "pyq" }),
    );
    const allBookmarks = normalizedAssignmentBookmarks.concat(normalizedPyqBookmarks);

    const tagRows = allBookmarks
      .filter((row) => String(row.tagId) === tagId)
      .sort((a, b) => {
        const left = Date.parse(a.created_at || "") || 0;
        const right = Date.parse(b.created_at || "") || 0;
        return right - left;
      });

    if (!tagRows.length) {
      window.__ASSIGNMENT_CUSTOM_BOOTSTRAP__ = {
        meta: { title: `Bookmarks · ${tagName}` },
        state: [],
        bookmarks: [],
        marks: [],
        tags: Array.isArray(tags) ? tags : [],
      };
      return { meta: { title: `Bookmarks · ${tagName}` }, questions: [] };
    }

    const assignmentIds = Array.from(
      new Set(
        tagRows
          .filter((row) => row.kind === "assignment")
          .map((row) => Number(row.assignmentId))
          .filter(Number.isFinite),
      ),
    );
    const pyqKeys = Array.from(
      new Set(
        tagRows
          .filter((row) => row.kind === "pyq")
          .map((row) => BookmarksService.mkPyqsKey(row.examId, row.subjectId, row.chapterId)),
      ),
    );

    const [assignmentTitles, assignmentDataMap, pyqDataMap] = await Promise.all([
      BookmarksService.fetchAssignmentTitlesMap().catch(() => new Map()),
      BookmarksService.fetchAssignmentDataForIds(assignmentIds).catch(() => new Map()),
      BookmarksService.fetchPyqsDataForKeys(pyqKeys).catch(() => new Map()),
    ]);

    await buildPyqLabelMaps(tagRows.filter((row) => row.kind === "pyq"));

    assignmentIds.forEach((assignmentId) => {
      const title = assignmentTitles.get(Number(assignmentId)) || `Assignment ${assignmentId}`;
      sourceLabels.set(
        sourceContainerKey({
          kind: "assignment",
          assignmentId: Number(assignmentId),
        }),
        String(title),
      );
    });

    const relevantQuestionKeys = new Set(
      tagRows.map((row) =>
        row.kind === "pyq"
          ? sourceQuestionKey({
              kind: "pyq",
              examId: row.examId,
              subjectId: row.subjectId,
              chapterId: row.chapterId,
              questionIndex: row.questionIndex,
            })
          : sourceQuestionKey({
              kind: "assignment",
              assignmentId: row.assignmentId,
              questionIndex: row.questionIndex,
            }),
      ),
    );

    const rows = [];
    tagRows.forEach((row) => {
      if (row.kind === "assignment") {
        const assignmentId = Number(row.assignmentId);
        const assignment = assignmentDataMap.get(assignmentId);
        const question = assignment?.questions?.[row.questionIndex];
        if (!question) return;
        const sourceLabel =
          sourceLabels.get(
            sourceContainerKey({ kind: "assignment", assignmentId }),
          ) || `Assignment ${assignmentId}`;
        rows.push({
          ...normalizeAssignmentQuestion(
            { ...question, questionIndex: row.questionIndex },
            assignmentId,
            sourceLabel,
          ),
          _bookmarkTagId: tagId,
          _bookmarkCreatedAt: row.created_at || "",
        });
        return;
      }

      const source = {
        kind: "pyq",
        examId: row.examId,
        subjectId: row.subjectId,
        chapterId: row.chapterId,
        questionIndex: Number(row.questionIndex),
      };
      const key = BookmarksService.mkPyqsKey(row.examId, row.subjectId, row.chapterId);
      const chapter = pyqDataMap.get(key);
      const question = chapter?.questions?.[row.questionIndex];
      if (!question) return;
      const sourceLabel =
        sourceLabels.get(sourceContainerKey(source)) ||
        [row.chapterId, row.subjectId, row.examId].join(" · ");
      rows.push({
        ...normalizePyqQuestion(question, source, sourceLabel),
        _bookmarkTagId: tagId,
        _bookmarkCreatedAt: row.created_at || "",
      });
    });

    const assignmentQuestionMarks = await fetchJson(`${API_BASE}/api/question-marks`).catch(
      () => [],
    );
    const pyqMarkGroups = new Map();
    rows.forEach((row) => {
      const source = row._testSource;
      if (source.kind !== "pyq") return;
      const key = sourceContainerKey(source);
      if (!pyqMarkGroups.has(key)) pyqMarkGroups.set(key, source);
    });
    const pyqMarksResults = await Promise.all(
      Array.from(pyqMarkGroups.values()).map(async (source) => {
        const items = await fetchJson(
          `${API_BASE}/api/pyqs/question-marks/${encodeURIComponent(source.examId)}/${encodeURIComponent(source.subjectId)}/${encodeURIComponent(source.chapterId)}`,
        ).catch(() => []);
        return { source, items: Array.isArray(items) ? items : [] };
      }),
    );

    const relevantBookmarks = allBookmarks.filter((row) => {
      if (row.kind === "pyq") {
        return relevantQuestionKeys.has(
          sourceQuestionKey({
            kind: "pyq",
            examId: row.examId,
            subjectId: row.subjectId,
            chapterId: row.chapterId,
            questionIndex: row.questionIndex,
          }),
        );
      }
      return relevantQuestionKeys.has(
        sourceQuestionKey({
          kind: "assignment",
          assignmentId: row.assignmentId,
          questionIndex: row.questionIndex,
        }),
      );
    });

    const relevantAssignmentMarks = (Array.isArray(assignmentQuestionMarks)
      ? assignmentQuestionMarks
      : []
    )
      .filter((row) =>
        relevantQuestionKeys.has(
          sourceQuestionKey({
            kind: "assignment",
            assignmentId: row.assignmentId,
            questionIndex: row.questionIndex,
          }),
        ),
      )
      .map((row) =>
        normalizeMarkRow(row, {
          kind: "assignment",
          assignmentId: Number(row.assignmentId),
        }),
      );

    const relevantPyqMarks = pyqMarksResults.flatMap((result) =>
      result.items
        .filter((row) =>
          relevantQuestionKeys.has(
            sourceQuestionKey({
              kind: "pyq",
              examId: result.source.examId,
              subjectId: result.source.subjectId,
              chapterId: result.source.chapterId,
              questionIndex: row.questionIndex,
            }),
          ),
        )
        .map((row) => normalizeMarkRow(row, result.source)),
    );

    window.__BOOKMARK_TAG_ROWS__ = rows;
    window.__ASSIGNMENT_CUSTOM_BOOTSTRAP__ = {
      meta: { title: `Bookmarks · ${tagName}` },
      state: [],
      bookmarks: relevantBookmarks,
      marks: relevantAssignmentMarks.concat(relevantPyqMarks),
      tags: Array.isArray(tags) ? tags : [],
    };

    return {
      meta: { title: `Bookmarks · ${tagName}` },
      questions: rows,
    };
  }

  window.__ASSIGNMENT_TEST_ADAPTER__ = {
    mode: "",
    async loadState() {
      const rows = Array.isArray(window.__BOOKMARK_TAG_ROWS__)
        ? window.__BOOKMARK_TAG_ROWS__
        : [];
      const displayState = Array(rows.length)
        .fill(null)
        .map(() => defaultState());
      const groups = groupRowsByContainer(rows);

      for (const group of groups.values()) {
        const fullState = await loadFullStateForSource(group.source);
        group.displayIndices.forEach((displayIdx) => {
          const row = rows[displayIdx];
          displayState[displayIdx] = {
            ...defaultState(),
            ...((Array.isArray(fullState) ? fullState[row.questionIndex] : null) || {}),
          };
        });
      }
      return displayState;
    },
    async saveState(state) {
      await persistStateGroups(state);
    },
    flushState(state) {
      persistStateGroups(state, { keepalive: true }).catch(() => {});
    },
    onStateChange() {},
    onQuestionChange() {},
  };

  window.__ASSIGNMENT_CUSTOM_LOADER__ = loadBookmarkTagAssignment;
})();
