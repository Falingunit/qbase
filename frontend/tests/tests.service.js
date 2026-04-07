(function () {
  async function fetchTests() {
    const r = await authFetch(`${API_BASE}/api/tests`, { cache: "no-store" });
    if (!r.ok) throw new Error(`tests: ${r.status}`);
    return await r.json();
  }

  async function fetchStarred() {
    const r = await authFetch(`${API_BASE}/api/tests/starred`, {
      cache: "no-store",
    });
    if (!r.ok) throw new Error(`tests starred: ${r.status}`);
    const ids = await r.json();
    return Array.isArray(ids) ? ids.map((id) => String(id)) : [];
  }

  async function fetchShareUsers() {
    const r = await authFetch(`${API_BASE}/api/users`, { cache: "no-store" });
    if (!r.ok) throw new Error(`users: ${r.status}`);
    const users = await r.json();
    return Array.isArray(users) ? users : [];
  }

  async function createTest(draft) {
    const r = await authFetch(`${API_BASE}/api/tests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft || {}),
    });
    if (!r.ok) {
      let message = `create test: ${r.status}`;
      try {
        const data = await r.json();
        if (data?.error) message = data.error;
      } catch {}
      throw new Error(message);
    }
    return await r.json();
  }

  async function fetchTestOverview(testId) {
    const id = encodeURIComponent(String(testId || ""));
    const r = await authFetch(`${API_BASE}/api/tests/${id}/overview`, {
      cache: "no-store",
    });
    if (!r.ok) throw new Error(`test overview: ${r.status}`);
    return await r.json();
  }

  async function fetchTest(testId) {
    const id = encodeURIComponent(String(testId || ""));
    const r = await authFetch(`${API_BASE}/api/tests/${id}`, {
      cache: "no-store",
    });
    if (!r.ok) throw new Error(`test: ${r.status}`);
    return await r.json();
  }

  async function addTestById(testId) {
    const id = String(testId || "").trim();
    const r = await authFetch(`${API_BASE}/api/tests/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ testId: id }),
    });
    if (!r.ok) throw new Error(await readError(r, `add test: ${r.status}`));
    return await r.json();
  }

  async function archiveTest(testId) {
    const id = encodeURIComponent(String(testId || ""));
    const r = await authFetch(`${API_BASE}/api/tests/${id}/archive`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });
    if (!r.ok) throw new Error(await readError(r, `archive test: ${r.status}`));
    return await r.json();
  }

  async function deleteTest(testId) {
    const id = encodeURIComponent(String(testId || ""));
    const r = await authFetch(`${API_BASE}/api/tests/${id}`, {
      method: "DELETE",
    });
    if (!r.ok) throw new Error(await readError(r, `delete test: ${r.status}`));
    return await r.json();
  }

  async function deleteAttempt(testId, attemptId) {
    const id = encodeURIComponent(String(testId || ""));
    const aid = encodeURIComponent(String(attemptId || ""));
    const r = await authFetch(`${API_BASE}/api/tests/${id}/attempts/${aid}`, {
      method: "DELETE",
    });
    if (!r.ok) throw new Error(await readError(r, `delete attempt: ${r.status}`));
    return await r.json();
  }

  async function unlistTest(testId) {
    const id = encodeURIComponent(String(testId || ""));
    const r = await authFetch(`${API_BASE}/api/tests/${id}/unlist`, {
      method: "POST",
    });
    if (!r.ok) throw new Error(await readError(r, `unlist test: ${r.status}`));
    return await r.json();
  }

  async function updateTestShare(testId, shareWith) {
    const id = encodeURIComponent(String(testId || ""));
    const r = await authFetch(`${API_BASE}/api/tests/${id}/share`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shareWith }),
    });
    if (!r.ok) throw new Error(await readError(r, `share test: ${r.status}`));
    return await r.json();
  }

  async function toggleStar(testId, makeStarred) {
    const id = encodeURIComponent(String(testId || ""));
    const r = await authFetch(`${API_BASE}/api/tests/starred/${id}`, {
      method: makeStarred ? "POST" : "DELETE",
    });
    if (!r.ok) throw new Error(`test star: ${r.status}`);
    return true;
  }

  async function readError(response, fallback) {
    try {
      const data = await response.json();
      return data?.error || fallback;
    } catch {
      return fallback;
    }
  }

  function normalizeTests(input) {
    const rows = [];

    const pushItem = (raw) => {
      if (!raw || typeof raw !== "object") return;
      const id = String(raw.testId ?? raw.id ?? raw.tID ?? raw.aID ?? "").trim();
      if (!id) return;

      const title = String(raw.title ?? raw.name ?? `Test ${id}`).trim();
      const creator = String(
        raw.creator ?? raw.createdBy ?? raw.author ?? raw.faculty ?? ""
      ).trim();
      const createdAt = normalizeDate(raw.createdAt ?? raw.dateCreated ?? raw.created_on);

      rows.push({
        testId: id,
        title,
        creator,
        createdAt,
        questionKeys: normalizeQuestionKeys(raw),
        score: Number(raw.score ?? raw.marksObtained ?? raw.result?.score),
        maxScore: Number(raw.maxScore ?? raw.totalMarks ?? raw.result?.maxScore),
        attempted: Number(
          raw.attempted ?? raw.attemptedCount ?? raw.progress?.attempted
        ),
        totalQuestions: Number(
          raw.totalQuestions ?? raw.total ?? raw.questionsCount ?? raw.progress?.total
        ),
        rank: (() => {
          const rankValue = raw.rank ?? raw.bestRank ?? raw.leaderboardRank;
          return rankValue == null ? null : Number(rankValue);
        })(),
        status: String(raw.status ?? raw.state ?? "").trim().toLowerCase(),
      });
    };

    if (Array.isArray(input)) input.forEach(pushItem);
    else if (input && Array.isArray(input.tests)) input.tests.forEach(pushItem);
    else if (input && Array.isArray(input.items)) input.items.forEach(pushItem);

    return rows;
  }

  function normalizeQuestionKeys(raw) {
    const keys = new Set();
    const pushKey = (value) => {
      const key = String(value || "").trim();
      if (key) keys.add(key);
    };
    const pushQuestion = (question) => {
      if (!question || typeof question !== "object") return;
      pushKey(
        question.questionKey ??
          question.key ??
          question.sourceQuestionKey ??
          question.generatedQuestionKey
      );
      const kind = String(question.kind ?? question.sourceKind ?? question.type ?? "")
        .trim()
        .toLowerCase();
      const sourceId = question.sourceId ?? question.sourceID;
      const questionId =
        question.questionId ?? question.qid ?? question.id ?? question._id;
      const index =
        question.questionIndex ?? question.index ?? question.qIndex ?? question.idx;
      if (kind && sourceId !== undefined && questionId !== undefined) {
        pushKey(`${kind}:${sourceId}:${questionId}`);
      }
      if (kind && sourceId !== undefined && index !== undefined) {
        pushKey(`${kind}:${sourceId}:${index}`);
      }
      if (question.assignmentId !== undefined) {
        if (questionId !== undefined) {
          pushKey(`assignment:${question.assignmentId}:${questionId}`);
        }
        if (index !== undefined) {
          pushKey(`assignment:${question.assignmentId}:${index}`);
        }
      }
      const examId = question.examId ?? question.examID;
      const subjectId = question.subjectId ?? question.subjectID;
      const chapterId = question.chapterId ?? question.chapterID;
      if (examId !== undefined && subjectId !== undefined && chapterId !== undefined) {
        if (questionId !== undefined) {
          pushKey(`pyq:${examId}::${subjectId}::${chapterId}:${questionId}`);
        }
        if (index !== undefined) {
          pushKey(`pyq:${examId}::${subjectId}::${chapterId}:${index}`);
        }
      }
    };
    const explicitKeys =
      raw.questionKeys ?? raw.generatedQuestionKeys ?? raw.selectedQuestionKeys;
    if (Array.isArray(explicitKeys)) explicitKeys.forEach(pushKey);
    const questionRows =
      raw.questions ??
      raw.generatedQuestions ??
      raw.selectedQuestions ??
      raw.testQuestions;
    if (Array.isArray(questionRows)) questionRows.forEach(pushQuestion);
    return Array.from(keys);
  }

  function normalizeDate(value) {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  window.TestsService = {
    createTest,
    addTestById,
    archiveTest,
    deleteAttempt,
    deleteTest,
    fetchTests,
    fetchTest,
    fetchTestOverview,
    fetchShareUsers,
    fetchStarred,
    unlistTest,
    updateTestShare,
    toggleStar,
    normalizeTests,
  };
})();
