// Home service: logic + data loading for the Assignments landing page
// Exposes a global to keep current non-module script setup working.

(function(){
  async function fetchScores() {
    try {
      const r = await authFetch(`${API_BASE}/api/scores`);
      if (!r.ok) return {};
      return await r.json();
    } catch {
      return {};
    }
  }

  async function fetchStarred() {
    try {
      const r = await authFetch(`${API_BASE}/api/starred`);
      if (!r.ok) return [];
      return await r.json(); // [assignmentId]
    } catch {
      return [];
    }
  }

  function normalizeAssignments(input) {
    const out = [];

    const pushItem = (raw, subjHint) => {
      if (!raw || typeof raw !== "object") return;
      const id = Number(
        raw.aID ?? raw.id ?? raw.assignmentId ?? raw.AID ?? raw.Aid
      );
      if (!Number.isFinite(id)) return;

      const subject = String(raw.subject ?? subjHint ?? "").trim() || "(No subject)";
      const chapter = String(
        raw.chapter ?? raw.chapterName ?? raw.topic ?? ""
      );
      const title = String(
        raw.title ?? raw.name ?? raw.assignmentTitle ?? `Assignment ${id}`
      );
      const faculty = String(
        raw.faculty ?? raw.teacher ?? raw.mentor ?? ""
      );

      const attemptedRaw =
        raw.attempted ?? raw.attemptedCount ?? raw.progress?.attempted;
      const totalRaw =
        raw.totalQuestions ?? raw.total ?? raw.questionsCount ?? raw.progress?.total;

      const item = { aID: id, subject, chapter, title, faculty };
      const attempted = Number(attemptedRaw);
      const totalQuestions = Number(totalRaw);
      if (Number.isFinite(attempted)) item.attempted = attempted;
      if (Number.isFinite(totalQuestions)) item.totalQuestions = totalQuestions;

      out.push(item);
    };

    if (Array.isArray(input)) {
      input.forEach(pushItem);
    } else if (input && Array.isArray(input.assignments)) {
      input.assignments.forEach(pushItem);
    } else if (input && Array.isArray(input.items)) {
      input.items.forEach(pushItem);
    } else if (input && typeof input === "object") {
      Object.entries(input).forEach(([subj, arr]) => {
        if (Array.isArray(arr)) arr.forEach((it) => pushItem(it, subj));
      });
    }

    return out;
  }

  window.HomeService = { fetchScores, fetchStarred, normalizeAssignments };
})();

