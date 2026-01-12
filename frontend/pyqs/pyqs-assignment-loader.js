        (function () {
          window.__ASSIGNMENT_CUSTOM_LOADER__ = async function () {
            try {
              if (typeof loadConfig === "function") await loadConfig();
            } catch {}
            const fetcher = typeof authFetch === "function" ? authFetch : fetch;
            const url = new URL(window.location.href);
            const exam = url.searchParams.get("exam");
            const subject = url.searchParams.get("subject");
            const chapter = url.searchParams.get("chapter");

            // Update back link to return to questions list for this chapter
            try {
              const back = document.querySelector("a.topbar-back");
              if (back && exam && subject) {
                const u = new URL(
                  "./pyqs_questions.html",
                  window.location.href
                );
                u.searchParams.set("exam", exam);
                u.searchParams.set("subject", subject);
                if (chapter) u.searchParams.set("chapter", chapter);
                back.href = u.toString();
                back.title = "Back to Questions";
                back.setAttribute("aria-label", "Back to Questions");
              }
            } catch {}

            // Derive a stable synthetic assignment ID from route params (for local save state)
            try {
              const key =
                String(exam || "") +
                "::" +
                String(subject || "") +
                "::" +
                String(chapter || "");
              let h = 0;
              for (let i = 0; i < key.length; i++)
                h = ((h << 5) - h + key.charCodeAt(i)) | 0; // djb2-ish
              const aID = (h >>> 0) % 2147483647;
              window.__PYQS_ASSIGNMENT_ID__ = aID;
            } catch {}

            // Resolve names (exam, subject, chapter) for metadata and title
            try {
              let examName = "",
                subjectName = "",
                chapterName = "";
              if (exam) {
                try {
                  const re = await fetcher(`${API_BASE}/api/pyqs/exams`, {
                    cache: "no-store",
                  });
                  if (re.ok) {
                    const ex = await re.json();
                    examName =
                      (ex || []).find((e) => String(e.id) === String(exam))
                        ?.name || "";
                  }
                } catch {}
              }
              if (exam && subject) {
                try {
                  const rs = await fetcher(
                    `${API_BASE}/api/pyqs/exams/${encodeURIComponent(
                      exam
                    )}/subjects`,
                    { cache: "no-store" }
                  );
                  if (rs.ok) {
                    const ss = await rs.json();
                    subjectName =
                      (ss || []).find((s) => String(s.id) === String(subject))
                        ?.name || "";
                  }
                } catch {}
              }
              if (exam && subject) {
                const rc = await fetcher(
                  `${API_BASE}/api/pyqs/exams/${encodeURIComponent(
                    exam
                  )}/subjects/${encodeURIComponent(subject)}/chapters`,
                  { cache: "no-store" }
                );
                if (rc.ok) {
                  const arr = await rc.json();
                  const ch = (arr || []).find(
                    (x) => String(x.id) === String(chapter)
                  );
                  if (ch && ch.name) chapterName = ch.name;
                }
              }
              if (chapterName) {
                // Show only the PYQ chapter name in the header
                window.__PYQS_ASSIGNMENT_TITLE__ = String(chapterName);
                try {
                  document.title = `QBase - ${window.__PYQS_ASSIGNMENT_TITLE__}`;
                } catch {}
                try {
                  const t = document.getElementById("assignment-title");
                  if (t) t.textContent = window.__PYQS_ASSIGNMENT_TITLE__;
                } catch {}
              }
              window.__PYQS_IDS__ = {
                examId: exam,
                subjectId: subject,
                chapterId: chapter,
              };
              window.__PYQS_META__ = {
                examId: exam,
                subjectId: subject,
                chapterId: chapter,
                examName,
                subjectName,
                chapterName,
              };
            } catch {}

            // Fetch questions for the selected chapter
            const resp = await fetcher(
              `${API_BASE}/api/pyqs/exams/${encodeURIComponent(
                exam
              )}/subjects/${encodeURIComponent(
                subject
              )}/chapters/${encodeURIComponent(chapter)}/questions`,
              { cache: "no-store" }
            );
            if (!resp.ok)
              throw new Error(`questions fetch failed: ${resp.status}`);
            const list = await resp.json();

            // Map server PYQ shape to assignment viewer shape AND track original indices
            let allQuestions = (Array.isArray(list) ? list : []).map(
              (q, originalIndex) => {
                const t = String(q?.type || "").toLowerCase();
                let qType = "SMCQ";
                if (
                  t.includes("numerical") ||
                  t === "numerical" ||
                  t.includes("integer")
                )
                  qType = "Numerical";
                else if (
                  Array.isArray(q?.correctAnswer) &&
                  q.correctAnswer.length > 1
                )
                  qType = "MMCQ";

                const qText = String(q?.qText || "");
                const image = q?.qImage || null;

                let qOptions = [];
                if (Array.isArray(q?.options) && q.options.length) {
                  qOptions = q.options
                    .map((o) => String(o?.oText || ""))
                    .slice(0, 4);
                  while (qOptions.length < 4) qOptions.push("");
                }

                let qAnswer;
                if (qType === "Numerical") {
                  const n = Number(q?.correctAnswer);
                  qAnswer = Number.isFinite(n) ? n : undefined;
                } else if (Array.isArray(q?.correctAnswer)) {
                  if (qType === "MMCQ")
                    qAnswer = q.correctAnswer.map((x) =>
                      String(x).trim().toUpperCase()
                    );
                  else
                    qAnswer = String(q.correctAnswer[0] || "")
                      .trim()
                      .toUpperCase();
                } else {
                  qAnswer = String(q?.correctAnswer || "")
                    .trim()
                    .toUpperCase();
                }

                return {
                  qType,
                  passageId: null,
                  qText,
                  image: image || null,
                  qOptions,
                  qAnswer,
                  pyqInfo: String(q?.pyqInfo || ""),
                  solutionText: String(q?.solution?.sText || ""),
                  solutionImage: q?.solution?.sImage || null,
                  diffuculty: String(q?.diffuculty || q?.level || ""),
                  __originalIndex: originalIndex, // âœ“ Store original index
                };
              }
            );

            // Store the original total count BEFORE filtering
            const originalTotalCount = allQuestions.length;

            // Apply filters from server preferences (from list view)
            let filteredWithIndices = allQuestions.map((Q, originalIdx) => ({
              Q,
              originalIdx, // âœ“ Track original index through filtering
            }));

            try {
              const prefUrl = `${API_BASE}/api/pyqs/prefs/${encodeURIComponent(
                exam
              )}/${encodeURIComponent(subject)}/${encodeURIComponent(chapter)}`;
              const prefResp = await authFetch(prefUrl);
              if (prefResp.ok) {
                const raw = await prefResp.json();

                // Unwrap if server returns {prefs: {...}}
                const serverPrefs =
                  raw &&
                  typeof raw === "object" &&
                  raw.prefs &&
                  typeof raw.prefs === "object"
                    ? raw.prefs
                    : raw;

                // Merge with safe defaults so .sort is always defined
                const defaults = {
                  q: "",
                  years: [],
                  status: "",
                  diff: "",
                  hasSol: false,
                  sort: "index",
                };
                const f = Object.assign({}, defaults, serverPrefs);

                window.__ASSIGNMENT_FILTER_OBJECT__ = f;

                function normDiff(d) {
                  const s = String(d || "").toLowerCase();
                  if (s.startsWith("1") || s.startsWith("e")) return "easy";
                  if (s.startsWith("2") || s.startsWith("m")) return "medium";
                  if (s.startsWith("3") || s.startsWith("h")) return "hard";
                  return "";
                }
                const parseYear = (info) => {
                  const m = String(info || "").match(/(19|20)\d{2}/);
                  return m ? Number(m[0]) : null;
                };
                const hasSol = (q) =>
                  String(q.solutionText || "").trim().length ||
                  String(q.solutionImage || "").trim().length;

                // Apply text/year/difficulty/solution filters
                filteredWithIndices = filteredWithIndices.filter(({ Q }) => {
                  if (
                    f.q &&
                    !String(Q.qText || "")
                      .toLowerCase()
                      .includes(String(f.q || "").toLowerCase())
                  )
                    return false;
                  if (Array.isArray(f.years) && f.years.length) {
                    const y = parseYear(Q.pyqInfo);
                    if (!y || !f.years.includes(y)) return false;
                  }
                  if (f.diff && normDiff(Q.diffuculty) !== f.diff) return false;
                  if (f.hasSol && !hasSol(Q)) return false;
                  return true;
                });

                // Apply status filter (requires server state lookup)
                if (f.status) {
                  try {
                    const stateResp = await authFetch(
                      `${API_BASE}/api/pyqs/state/${encodeURIComponent(
                        exam
                      )}/${encodeURIComponent(subject)}/${encodeURIComponent(
                        chapter
                      )}`
                    );
                    if (stateResp.ok) {
                      const states = await stateResp.json();
                      const statusFromState = (st) => {
                        if (!st) return "not-started";
                        if (st.isAnswerEvaluated)
                          return st.evalStatus || "completed";
                        if (st.isAnswerPicked) return "in-progress";
                        return "not-started";
                      };

                      // âœ“ CRITICAL FIX: Use originalIdx, not display index
                      filteredWithIndices = filteredWithIndices.filter(
                        ({ originalIdx }) => {
                          const s = states?.[originalIdx]; // âœ“ Access state by original index
                          const st = statusFromState(s);
                          if (f.status === "completed")
                            return !!s?.isAnswerEvaluated;
                          return st === f.status;
                        }
                      );
                    }
                  } catch (e) {
                    console.warn("Status filter failed:", e);
                  }
                }

                // Build human-readable summary
                const parts = [];
                if (f.q) parts.push(`Search: "${f.q}"`);
                if (f.years?.length) parts.push(`Years: ${f.years.join(", ")}`);
                if (f.diff) parts.push(`Difficulty: ${f.diff}`);
                if (f.status) parts.push(`Attempt: ${f.status}`);
                if (f.hasSol) parts.push("Has solution");
                window.__ASSIGNMENT_FILTER_INFO__ = parts.length
                  ? parts.join(" â€¢ ")
                  : "No filters";
                if (f.sort && f.sort !== "index") {
                  window.__ASSIGNMENT_FILTER_INFO__ += ` â€¢ Sort: ${f.sort}`;
                }
              }
            } catch (e) {
              console.warn("Filter application failed:", e);
            }

            // --- Apply sort according to saved prefs (year/difficulty/index) ---
            try {
              const f = window.__ASSIGNMENT_FILTER_OBJECT__ || {};
              const sort = String(f.sort || "index").toLowerCase();

              // Fallback if parseYear wasn't available (e.g., prefs fetch failed)
              const parseYearSafe = (info) => {
                try {
                  if (typeof parseYear === "function") return parseYear(info);
                } catch {}
                const m = String(info || "").match(/(19|20)\d{2}/);
                return m ? Number(m[0]) : null;
              };

              // Map difficulty to a rank for sorting
              const diffRank = (d) => {
                const s = String(d || "")
                  .trim()
                  .toLowerCase();

                // direct matches
                if (s === "easy" || s === "e" || s === "1") return 1;
                if (s === "medium" || s === "med" || s === "m" || s === "2")
                  return 2;
                if (s === "hard" || s === "h" || s === "3") return 3;

                // partials / variants
                if (/^e(as(y)?)?$/.test(s)) return 1;
                if (/^m(e(d(iu)?m)?)?$/.test(s)) return 2;
                if (/^h(ar(d)?)?$/.test(s)) return 3;

                // phrases like "level 1", "lvl 2"
                if (/^(level|lvl)\s*1$/.test(s)) return 1;
                if (/^(level|lvl)\s*2$/.test(s)) return 2;
                if (/^(level|lvl)\s*3$/.test(s)) return 3;

                // fallback: prefix-based (your old behavior)
                if (s.startsWith("e")) return 1;
                if (s.startsWith("m")) return 2;
                if (s.startsWith("h")) return 3;

                // unknown
                return null;
              };

              // Stable sort wrapper so ties keep original order
              const withPos = filteredWithIndices.map((row) => ({
                row,
                orig: row.originalIdx, // for stable tiebreak
              }));

              const cmp = (a, b) => {
                const A = a.row.Q;
                const B = b.row.Q;

                switch (sort) {
                  case "year-asc": {
                    const ay = parseYearSafe(A.pyqInfo) ?? -Infinity;
                    const by = parseYearSafe(B.pyqInfo) ?? -Infinity;
                    if (ay !== by) return ay - by;
                    break;
                  }
                  case "year-desc": {
                    const ay = parseYearSafe(A.pyqInfo) ?? -Infinity;
                    const by = parseYearSafe(B.pyqInfo) ?? -Infinity;
                    if (ay !== by) return by - ay;
                    break;
                  }
                  case "diff-asc": {
                    const ad = diffRank(A.diffuculty);
                    const bd = diffRank(B.diffuculty);

                    // Put unknowns LAST
                    if (ad == null && bd == null) break; // tie â†’ tiebreaker
                    if (ad == null) return 1; // A unknown â†’ after B
                    if (bd == null) return -1; // B unknown â†’ after A

                    if (ad !== bd) return ad - bd; // easyâ†’mediumâ†’hard
                    break;
                  }

                  case "diff-desc": {
                    const ad = diffRank(A.diffuculty);
                    const bd = diffRank(B.diffuculty);

                    // Put unknowns LAST
                    if (ad == null && bd == null) break; // tie â†’ tiebreaker
                    if (ad == null) return 1; // A unknown â†’ after B
                    if (bd == null) return -1; // B unknown â†’ after A

                    if (ad !== bd) return bd - ad; // hardâ†’mediumâ†’easy
                    break;
                  }
                  case "index":
                  default:
                    // keep API/list order
                    break;
                }
                // Stable tiebreak: original source order
                return a.orig - b.orig;
              };

              withPos.sort(cmp);
              filteredWithIndices = withPos.map((x) => x.row);
            } catch (e) {
              console.warn("Sort application failed:", e);
            }
            // --- END sort ---

            // Extract filtered questions and build index map
            const questions = filteredWithIndices.map((x) => x.Q);
            const originalIndexMap = filteredWithIndices.map(
              (x) => x.originalIdx
            );

            return {
              questions,
              originalIndexMap,
              originalTotalCount,
              allQuestionsMap: allQuestions,
            };
          };
        })();
