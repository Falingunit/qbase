"use strict";

(async () => {
  // --- Image Overlay: centered + wheel/pinch zoom + pan ---
  (() => {
    // Guard: if an overlay already exists (e.g., created by assignment.view.js),
    // avoid creating a duplicate which breaks hotkey checks and overlay detection.
    if (document.getElementById("image-overlay")) return;
    const style = document.createElement("style");
    style.textContent = `
    #image-overlay{position:fixed;inset:0;display:none;z-index:1060;background:rgba(10,12,14,.85)}
    #image-overlay .io-backdrop{position:absolute;inset:0}
    #image-overlay .io-stage{
      position:absolute; inset:0;
      display:grid; place-items:center;
      overflow:hidden; touch-action:none; /* required for pinch-zoom via PointerEvents */
    }
    #image-overlay .io-img{
      max-width:none; max-height:none;
      transform-origin:center center; /* always stays centered */
      user-select:none; -webkit-user-drag:none;
    }
    #image-overlay .io-hint{
      position:absolute; bottom:12px; left:50%; transform:translateX(-50%);
      font:500 13px/1.2 system-ui,sans-serif; color:#cfe7ff; opacity:.9;
      background:rgba(20,22,26,.6); border:1px solid rgba(255,255,255,.06);
      padding:.35rem .65rem; border-radius:12px; white-space:nowrap;
    }
    @media (max-width:575.98px){ #image-overlay .io-hint{ bottom:8px; } }
  `;
    document.head.appendChild(style);

    const root = document.createElement("div");
    root.id = "image-overlay";
    root.innerHTML = `
    <div class="io-backdrop" aria-hidden="true"></div>
    <div class="io-stage" role="dialog" aria-label="Image viewer" aria-modal="true">
      <img class="io-img" alt="">
      <div class="io-hint">Scroll or pinch to zoom · Click and drag to pan · 0 to reset · Esc to close</div>
    </div>
  `;
    document.body.appendChild(root);

    const stage = root.querySelector(".io-stage");
    const img = root.querySelector(".io-img");

    // Config: start slightly smaller than fit (e.g., 90%)
    const FIT_SCALE_FACTOR = 0.9;

    // State (with panning)
    let open = false;
    let naturalW = 0,
      naturalH = 0;
    let baseScale = 1; // fits image to stage
    let zoom = 1; // user-controlled multiplier
    let panX = 0, panY = 0; // translation in screen px
    const minZoom = 0.2,
      maxZoom = 8;

    function setTransform() {
      // Use translate() before scale() so translate is in screen pixels
      img.style.transform = `translate(${panX}px, ${panY}px) scale(${baseScale * zoom})`;
      updateCursor();
    }

    function clampPan() {
      // Allow panning even if the image is smaller than the stage.
      // Clamp generously so the image can be moved entirely out of view if desired.
      const rect = stage.getBoundingClientRect();
      const dispW = naturalW * baseScale * zoom;
      const dispH = naturalH * baseScale * zoom;
      const halfStageW = rect.width / 2;
      const halfStageH = rect.height / 2;
      // When image is larger: bounds by half the overflow.
      // When image is smaller: allow at least half the stage in any direction.
      const maxX = Math.max(halfStageW, Math.abs((dispW - rect.width) / 2));
      const maxY = Math.max(halfStageH, Math.abs((dispH - rect.height) / 2));
      if (panX > maxX) panX = maxX;
      if (panX < -maxX) panX = -maxX;
      if (panY > maxY) panY = maxY;
      if (panY < -maxY) panY = -maxY;
    }

    function updateCursor() {
      // Always allow panning; show grab/grabbing
      stage.style.cursor = pointers.size > 0 ? "grabbing" : "grab";
    }

    function fitToStage() {
      const rect = stage.getBoundingClientRect();
      const sx = rect.width / naturalW;
      const sy = rect.height / naturalH;
      baseScale = Math.min(sx, sy) * FIT_SCALE_FACTOR; // contain, then shrink a bit
      panX = 0; panY = 0;
      setTransform();
    }

    function zoomBy(factor) {
      zoom = Math.min(maxZoom, Math.max(minZoom, zoom * factor));
      clampPan();
      setTransform();
    }

    function getStageCenterClient() {
      const rect = stage.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }

    function zoomToAt(newZoom, clientX, clientY) {
      const rect = stage.getBoundingClientRect();
      const cx = clientX - rect.left - rect.width / 2;
      const cy = clientY - rect.top - rect.height / 2;
      const sOld = baseScale * zoom;
      const sNew = baseScale * newZoom;
      if (sOld > 0 && sNew > 0) {
        const k = sNew / sOld;
        // Keep the point under the cursor anchored
        panX = (1 - k) * cx + k * panX;
        panY = (1 - k) * cy + k * panY;
      }
      zoom = Math.min(maxZoom, Math.max(minZoom, newZoom));
      clampPan();
      setTransform();
    }

    function reset() {
      zoom = 1;
      panX = 0;
      panY = 0;
      fitToStage();
    }

    function openOverlay(src, alt = "") {
      img.src = src;
      img.alt = alt || "Image";
      root.style.display = "block";
      open = true;
      if (img.complete) {
        naturalW = img.naturalWidth;
        naturalH = img.naturalHeight;
        reset();
      } else {
        img.onload = () => {
          naturalW = img.naturalWidth;
          naturalH = img.naturalHeight;
          reset();
        };
      }
    }

    function closeOverlay() {
      open = false;
      root.style.display = "none";
      img.src = "";
    }

    // Keep your existing API
    window.showImageOverlay = (src) => openOverlay(src);

    // Close on backdrop click/tap
    const closeOnEvent = () => {
      if (!open) return;
      closeOverlay();
    };
    root.querySelector(".io-backdrop").addEventListener("click", closeOnEvent);
    root
      .querySelector(".io-backdrop")
      .addEventListener("touchstart", closeOnEvent, { passive: true });

    // Also close when clicking/tapping empty space in the stage (but NOT the image).
    // If a pinch just happened, suppress the "click" that follows touchend.
    let suppressNextClick = false;
    stage.addEventListener("click", (e) => {
      if (suppressNextClick) {
        suppressNextClick = false;
        return;
      }
      if (e.target !== img) closeOverlay();
    });
    stage.addEventListener(
      "touchstart",
      (e) => {
        // If it's a single-finger tap that starts on empty space, we'll let the click handler close it.
        // Do nothing here to avoid blocking pinch.
      },
      { passive: true }
    );

    // Prevent clicks on the image from bubbling to stage/backdrop
    img.addEventListener("click", (e) => e.stopPropagation());
    img.addEventListener("touchstart", (e) => e.stopPropagation(), {
      passive: true,
    });

    // Wheel = zoom (cursor-centered)
    stage.addEventListener(
      "wheel",
      (e) => {
        if (!open) return;
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        const target = Math.min(maxZoom, Math.max(minZoom, zoom * factor));
        zoomToAt(target, e.clientX, e.clientY);
      },
      { passive: false }
    );

    // --- Pinch-to-zoom + pan via PointerEvents ---
    const pointers = new Map();
    let lastPinchDist = null;

    stage.addEventListener("pointerdown", (e) => {
      if (!open) return;
      stage.setPointerCapture?.(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      updateCursor();
    });

    stage.addEventListener(
      "pointermove",
      (e) => {
        if (!open) return;
        const p = pointers.get(e.pointerId);
        if (!p) return;

        if (pointers.size === 2) {
          // Two fingers => pinch
          const [a, b] = [...pointers.values()];
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          const midX = (a.x + b.x) / 2;
          const midY = (a.y + b.y) / 2;
          if (lastPinchDist != null) {
            const factor = dist / lastPinchDist;
            // gentle clamp per event to avoid jumps
            const perMoveClamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
            const target = Math.min(maxZoom, Math.max(minZoom, zoom * perMoveClamp(factor, 0.9, 1.1)));
            // Anchor zoom at pinch midpoint
            zoomToAt(target, midX, midY);
            suppressNextClick = true; // avoid accidental click after pinch
          }
          lastPinchDist = dist;
        } else if (pointers.size === 1) {
          // Single pointer drag => pan
          const dx = e.clientX - p.x;
          const dy = e.clientY - p.y;
          if (dx !== 0 || dy !== 0) {
            panX += dx;
            panY += dy;
            clampPan();
            setTransform();
            suppressNextClick = true;
          }
        }
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      },
      { passive: false }
    );

    function endPointer(e) {
      try {
        stage.releasePointerCapture?.(e.pointerId);
      } catch {}
      pointers.delete(e.pointerId);
      if (pointers.size < 2) lastPinchDist = null;
      updateCursor();
    }
    stage.addEventListener("pointerup", endPointer);
    stage.addEventListener("pointercancel", endPointer);
    stage.addEventListener("pointerleave", endPointer);

    // Keyboard zoom only
    window.addEventListener("keydown", (e) => {
      if (!open) return;
      if (e.key === "Escape") closeOverlay();
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        const c = getStageCenterClient();
        zoomToAt(Math.min(maxZoom, zoom * 1.2), c.x, c.y);
      }
      if (e.key === "-") {
        e.preventDefault();
        const c = getStageCenterClient();
        zoomToAt(Math.max(minZoom, zoom / 1.2), c.x, c.y);
      }
      if (e.key === "0") {
        e.preventDefault();
        reset();
      }
    });

    // Refit on resize
    window.addEventListener("resize", () => {
      if (open) fitToStage();
    });
  })();
  // --- End overlay (pinch + pan supported) ---

  await loadConfig();

  const params = new URLSearchParams(window.location.search);
  let aID = parseInt(params.get("aID"), 10);
  // Allow external override (e.g., PYQs viewer)
  try {
    if (typeof window !== "undefined" && window.__PYQS_ASSIGNMENT_ID__ != null) {
      const v = Number(window.__PYQS_ASSIGNMENT_ID__);
      if (Number.isFinite(v)) aID = v;
    }
  } catch {}

  let assignmentTitle = `Assignment ${aID}`;

  const assignmentTitlePromise = (async () => {
    // External override (e.g., PYQs viewer) for title
    try {
      if (typeof window !== "undefined" && window.__PYQS_ASSIGNMENT_TITLE__) {
        assignmentTitle = String(window.__PYQS_ASSIGNMENT_TITLE__);
        const el = document.getElementById("assignmentDetails");
        if (el) el.textContent = assignmentTitle;
        return; // Skip fetching assignment_list.json
      }
    } catch {}
    try {
      const raw = await (await fetch("./data/assignment_list.json")).json();
      const items = normalizeAssignmentsForLookup(raw);
      const meta = items.find((it) => Number(it.aID) === Number(aID));
      if (meta?.title) assignmentTitle = meta.title;

      // If the page UI is already up, refresh the header
      const el = document.getElementById("assignmentDetails");
      if (el) el.textContent = assignmentTitle;
    } catch (e) {
      console.warn(
        "Could not load assignment title from assignment_list.json",
        e
      );
    }
  })();

  function normalizeAssignmentsForLookup(input) {
    const out = [];
    const pushItem = (raw) => {
      if (!raw || typeof raw !== "object") return;
      const id = Number(
        raw.aID ?? raw.id ?? raw.assignmentId ?? raw.AID ?? raw.Aid
      );
      if (!Number.isFinite(id)) return;
      out.push({ aID: id, title: String(raw.title ?? raw.name ?? raw.assignmentTitle ?? `Assignment ${id}`) });
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

  function normalizeAssignmentPayload(input) {
    if (Array.isArray(input)) return { questions: input };
    if (!input || typeof input !== "object") return { questions: [] };
    if (Array.isArray(input.questions)) return input;
    if (Array.isArray(input.data)) {
      return { ...input, questions: input.data };
    }
    return { ...input, questions: [] };
  }

  let saveTimeout;

  // ---------- Local keys & auth tracking ----------
  let loggedInUser = null; // username or null
  let authSource = "none"; // 'server' | 'none'

  // ---------- Default state & guards ----------
  function defaultState() {
    return {
      isAnswerPicked: false,
      pickedAnswers: [],
      isAnswerEvaluated: false,
      pickedAnswer: "",
      pickedNumerical: undefined,
      time: 0,
      notes: "",
      resetLockedUntil: 0,
    };
  }
  function ensureStateLength(n) {
    if (!Array.isArray(questionStates)) questionStates = [];
    for (let i = 0; i < n; i++) {
      if (!questionStates[i]) {
        questionStates[i] = defaultState();
      } else if (questionStates[i].resetLockedUntil === undefined) {
        questionStates[i].resetLockedUntil = 0;
      }
    }
  }

  function normalizeAnswer(q) {
    // q.qAnswer may be "A" | ["A","C"] | number | string-number
    if (q.qType === "SMCQ") {
      return new Set([String(q.qAnswer).trim().toUpperCase()]);
    }
    if (q.qType === "MMCQ") {
      const arr = Array.isArray(q.qAnswer) ? q.qAnswer : [q.qAnswer];
      return new Set(arr.map((x) => String(x).trim().toUpperCase()));
    }
    if (q.qType === "Numerical") {
      // Allow number or numeric string in data
      const n = Number(q.qAnswer);
      return { value: n, valid: !Number.isNaN(n) };
    }
    return new Set();
  }

  function getUserSelection(state, qType) {
    if (qType === "SMCQ")
      return new Set(state.pickedAnswer ? [state.pickedAnswer] : []);
    if (qType === "MMCQ") return new Set(state.pickedAnswers || []);
    if (qType === "Numerical") return state.pickedNumerical;
    return null;
  }

  function clearMCQVisuals() {
    optionButtons.forEach((btn) => {
      btn.classList.remove(
        "correct",
        "wrong",
        "missed",
        "disabled",
        "mcq-option-selected"
      );
    });
  }

  function applyMCQEvaluationStyles(correctSet, pickedSet) {
    // Mark picked ones
    optionButtons.forEach((btn) => {
      const opt = btn.dataset.opt;
      const picked = pickedSet.has(opt);
      const correct = correctSet.has(opt);
      if (picked && correct) {
        btn.classList.add("correct");
      } else if (picked && !correct) {
        btn.classList.add("wrong");
      }
      // lock interaction
      btn.classList.add("disabled");
    });
    // Outline missed corrects
    optionButtons.forEach((btn) => {
      const opt = btn.dataset.opt;
      if (!pickedSet.has(opt) && correctSet.has(opt)) {
        btn.classList.add("missed");
      }
    });
  }

  function applyNumericalEvaluationStyles(isCorrect) {
    numericalInput.classList.remove("is-correct", "is-wrong");
    numericalInput.classList.add(isCorrect ? "is-correct" : "is-wrong");
    numericalInput.disabled = true;
  }

  // ---------- Auth helpers ----------
  async function whoAmI() {
    try {
      const r = await authFetch(`${API_BASE}/me`);
      if (r.ok) {
        const u = await r.json();
        if (u?.username) return { username: u.username, source: "server" };
      }
    } catch {}
    return null;
  }

  // ---------- Merge logic (server ⟷ local) ----------
  function mergeStates(serverArr, localArr) {
    const n = Math.max(serverArr?.length || 0, localArr?.length || 0);
    const out = Array(n)
      .fill(null)
      .map((_, i) => {
        const s = serverArr?.[i] || {};
        const l = localArr?.[i] || {};

        const isPicked = (x) =>
          !!(
            x &&
            (x.isAnswerPicked ||
              x.pickedAnswer ||
              x.pickedAnswers?.length ||
              x.pickedNumerical !== undefined)
          );
        const preferLocal = isPicked(l) && !isPicked(s);

        return {
          isAnswerPicked: !!(l.isAnswerPicked || s.isAnswerPicked),
          pickedAnswer: preferLocal
            ? l.pickedAnswer ?? ""
            : s.pickedAnswer ?? "",
          pickedAnswers: Array.from(
            new Set([...(s.pickedAnswers || []), ...(l.pickedAnswers || [])])
          ),
          pickedNumerical:
            l.pickedNumerical !== undefined
              ? l.pickedNumerical
              : s.pickedNumerical,
          isAnswerEvaluated: !!(l.isAnswerEvaluated || s.isAnswerEvaluated),
          evalStatus: l.isAnswerEvaluated ? l.evalStatus : s.evalStatus,
          time: Math.max(l.time || 0, s.time || 0),
          resetLockedUntil: Math.max(
            Number(l.resetLockedUntil) || 0,
            Number(s.resetLockedUntil) || 0
          ),
          // Prefer local notes if present, else server's
          notes: (l.notes && String(l.notes).length > 0)
            ? l.notes
            : (s.notes || ""),
        };
      });
    return out;
  }

  // ---------- Passages preprocessing ----------
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
      } else {
        if (q.passageId === currentPassageId) {
          q.passage = currentPassage;
          q.passageImage = currentPassageImage;
        }
      }
    });
  }

  // ---------- Load saved state (server/local with migration prompt) ----------
  async function loadSavedState(aID) {
    const me = await whoAmI();
    loggedInUser = me?.username || null;
    authSource = me?.source || "none";

    if (!loggedInUser) {
      try { window.dispatchEvent(new Event("qbase:force-login")); } catch {}
      // Continue offline: will try local storage below
    }

    // Logged in → use server if available; fallback to local only if server has nothing
    try {
      const res = await authFetch(`${API_BASE}/api/state/${aID}`);
      if (res.ok) {
        const server = await res.json();
        if (Array.isArray(server) && server.length) {
          questionStates = server;
          return;
        }
      }
    } catch {
      /* ignore */
    }

    // Local storage fallback
    try {
      const raw = localStorage.getItem(`qbase:${aID}:state`);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length) {
          questionStates = arr;
          return;
        }
      }
    } catch { /* ignore */ }

    // If nothing found, initialize fresh default states
    questionStates = Array(window.displayQuestions.length)
      .fill()
      .map(defaultState);
  }

  // ---------- Server POST helper ----------
  async function postState(aID, state) {
    const res = await authFetch(`${API_BASE}/api/state/${aID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state }),
    });
    if (!res.ok) throw new Error(`postState failed: ${res.status}`);
  }

  // ---------- Save strategy (debounced + flush + periodic) ----------
  let dirty = false;
  const markDirty = () => {
    dirty = true;
  };

  async function scheduleSave(aID) {
    if (!dirty) return;
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
      try {
        if (authSource === "server") {
          await postState(aID, questionStates);
          dirty = false; // success → clear dirty
        }
      } catch (e) {
        console.warn("Server save failed; will retry later.", e);
        // keep dirty=true so periodic/next user action can retry
      }
      // Also save locally when not using server auth
      if (authSource !== "server") {
        try {
          localStorage.setItem(`qbase:${aID}:state`, JSON.stringify(questionStates));
          dirty = false;
        } catch {}
      }
    }, 800);
  }

  function flushSave() {
    if (!dirty) return;
    try {
      if (authSource === "server") {
        // Use fetch with keepalive so the Authorization header is sent.
        // navigator.sendBeacon cannot include custom headers and would fail against
        // our authenticated endpoint.
        const payload = JSON.stringify({ state: questionStates });
        try {
          authFetch(`${API_BASE}/api/state/${aID}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
            keepalive: true,
          });
        } catch {}
        dirty = false;
      } else {
        try {
          localStorage.setItem(`qbase:${aID}:state`, JSON.stringify(questionStates));
          dirty = false;
        } catch {}
      }
    } catch (e) {
      console.warn("flushSave error", e);
    }
  }

  document.getElementById("reset-question").addEventListener("click", () => {
    resetCurrentQuestion();
  });

  // Flush on close/background
  window.addEventListener("pagehide", flushSave, { capture: true });
  window.addEventListener("beforeunload", flushSave, { capture: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushSave();
  });
  // Gentle periodic autosave (only does work if dirty)
  setInterval(() => scheduleSave(aID), 60000);

  // React to runtime login/logout from navbar.js
  window.addEventListener("qbase:login", async () => {
    const me = await whoAmI();
    loggedInUser = me?.username || null;
    authSource = me?.source || "none";

    if (authSource === "server") {
      try {
        // Fetch latest state from server and merge with any local progress
        try {
          const res = await authFetch(`${API_BASE}/api/state/${aID}`);
          if (res.ok) {
            const server = await res.json();
            if (Array.isArray(server) && server.length) {
              questionStates = mergeStates(server, questionStates);
              ensureStateLength(window.displayQuestions.length);
              questionButtons.forEach((_, i) => evaluateQuestionButtonColor(i));
              if (currentQuestionID != null) setQuestion(currentQuestionID);
            }
          }
        } catch {}

        if (dirty) {
          await postState(aID, questionStates);
          dirty = false;
        }
        console.info("Login detected.");
      } catch (e) {
        console.warn("Upload after login failed; will retry later.", e);
        // keep dirty=true so it retries on next scheduleSave/flush
      }
    }
  });
  window.addEventListener("qbase:logout", () => {
    loggedInUser = null;
    authSource = "none";
  });

  // ---------- KaTeX render options ----------
  const katexOptions = {
    // Prefer standard delimiters first so nested \(\ce{..}\) works reliably.
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "$", right: "$", display: false },
      { left: "\\(", right: "\\)", display: false },
      { left: "\\[", right: "\\]", display: true },
      // Also allow bare mhchem usage without math wrappers
      { left: "\\ce{", right: "}", display: false },
      { left: "\\pu{", right: "}", display: false },
    ],
    throwOnError: false,
    strict: "ignore",
    trust: true,
  };

  // ---------- Notes editor (EasyMDE with textarea fallback) ----------
  let notesMDE = null;
  let fallbackTextarea = null;
  let fallbackInputHandler = null;
  let suppressNotesChange = false;
  // Image widgets inside CodeMirror
  let imageMarks = [];
  let imageWidgetRefreshTimer = 0;
  let internalImageOp = false; // allow programmatic replace/delete
  let suppressWidgetRefresh = false; // skip widget rebuild on atomic ops
  
  

  // Simple UI wrappers to use site modals if available
  async function uiNotice(message, title = "") {
    try {
      if (typeof window.showNotice === 'function') return await window.showNotice({ title, message });
    } catch {}
    try { alert(message); } catch {}
  }
  async function uiConfirm(message, title = "") {
    try {
      if (typeof window.showConfirm === 'function') return await window.showConfirm({ title, message });
    } catch {}
    try { return confirm(message); } catch { return false; }
  }
  async function uiPrompt(message, def = "", title = "") {
    try {
      if (typeof window.showPrompt === 'function') return await window.showPrompt({ title, message, defaultValue: def });
    } catch {}
    try { return prompt(message, def); } catch { return null; }
  }

  function parseImageMeta(text) {
    // Returns array of { from:idx, to:idx, alt, url, width, align }
    const out = [];
    const re = /!\[(.*?)\]\(([^)]+?)\)(\{[^}]*\})?/g; // markdown image + optional {..}
    let m;
    while ((m = re.exec(text)) != null) {
      const alt = m[1] || '';
      const url = m[2] || '';
      let width = null;
      let align = null;
      if (m[3]) {
        const meta = m[3];
        const w = meta.match(/\bwidth\s*=\s*(\d{2,4})/i) || meta.match(/\bw\s*=\s*(\d{2,4})/i);
        width = w ? parseInt(w[1], 10) : null;
        const a = meta.match(/\balign\s*=\s*(left|right|center)/i) || meta.match(/\bfloat\s*=\s*(left|right|center)/i);
        align = a ? a[1].toLowerCase() : null;
      }
      out.push({ from: m.index, to: m.index + m[0].length, alt, url, width, align });
    }
    return out;
  }

  

  function extractUploadFilename(url) {
    try {
      const u = new URL(url, window.location.origin);
      const parts = (u.pathname || '').split('/').filter(Boolean);
      const i = parts.lastIndexOf('uploads');
      if (i >= 0 && parts[i + 1]) return parts[i + 1];
      return parts[parts.length - 1] || null;
    } catch {
      return null;
    }
  }

  // --------- Page leave animation (back navigation) ---------
  (function wireLeaveAnimation() {
    const links = document.querySelectorAll('a.topbar-back');
    links.forEach((a) => {
      a.addEventListener('click', (e) => {
        // allow modified clicks to open new tab/window
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || a.target === '_blank') return;
        e.preventDefault();
        try { document.body.classList.add('page-leave'); } catch {}
        const href = a.getAttribute('href') || './index.html';
        setTimeout(() => { window.location.href = href; }, 120);
      });
    });
  })();

  function isServerUploadUrl(url) {
    try {
      const u = new URL(url, window.location.href);
      const path = String(u.pathname || "");
      // Treat images under our origin '/uploads/' as server-managed uploads
      return (u.origin === window.location.origin) && /\/uploads\//.test(path);
    } catch {
      return false;
    }
  }

  function buildImageWidget(cm, meta, marker) {
    const wrap = document.createElement('span');
    wrap.className = 'cm-image-widget';
    wrap.setAttribute('role', 'img');
    wrap.setAttribute('aria-label', meta.alt || 'image');

    const img = document.createElement('img');
    img.src = meta.url;
    img.alt = meta.alt || '';
    img.draggable = false;
    if (meta.width && Number.isFinite(meta.width)) img.style.width = meta.width + 'px';
    wrap.appendChild(img);
    try { img.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); try { showImageOverlay(img.src); } catch {} }); } catch {}
    // initial alignment state
    try { if (meta.align === 'right') wrap.classList.add('align-right'); } catch {}

    // Delete button
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'img-del-btn';
    del.title = 'Delete image';
    del.className = 'img-btn img-del-btn';
    del.innerHTML = '×';
    del.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      try {
        const serverManaged = isServerUploadUrl(meta.url);
        if (!serverManaged) {
          // External/linked image: delete locally without server/auth
          try {
            const range = marker.find();
            if (range) {
              internalImageOp = true;
              cm.replaceRange('', range.from, range.to);
              internalImageOp = false;
            }
          } catch {}
          return;
        }

        // Server-managed upload: require auth and delete on server first
        try {
          const fn = typeof window.qbGetToken === 'function' ? window.qbGetToken : null;
          const token = fn ? String(fn() || '') : '';
          if (!token) {
            try { window.dispatchEvent(new Event('qbase:force-login')); } catch {}
            await uiNotice('Please log in to delete images.', 'Login required');
            return;
          }
        } catch {}

        const filename = extractUploadFilename(meta.url);
        if (!filename) return uiNotice('Could not determine image filename', 'Delete image');
        try {
          const r = await authFetch(`${API_BASE}/api/upload-image/${encodeURIComponent(filename)}`, { method: 'DELETE' });
          if (r.status === 401) {
            try { window.dispatchEvent(new Event('qbase:force-login')); } catch {}
            alert('Please log in to delete images.');
            return;
          }
          if (!r.ok) throw new Error('Delete failed');
          // Remove token from doc
          try {
            const range = marker.find();
            if (range) {
              internalImageOp = true;
              cm.replaceRange('', range.from, range.to);
              internalImageOp = false;
            }
          } catch {}
        } catch (err) {
          await uiNotice('Failed to delete image', 'Error');
        }
      } catch {}
    });
    wrap.appendChild(del);
    try { del.innerHTML = '<i class="bi bi-x"></i>'; } catch {}

    // Align-right toggle button (stores align=right in token)
    const alignBtn = document.createElement('button');
    alignBtn.type = 'button';
    alignBtn.className = 'img-btn img-align-right-btn';
    const setAlignBtnState = () => {
      const isRight = wrap.classList.contains('align-right') || meta.align === 'right';
      alignBtn.title = isRight ? 'Move image to left' : 'Move image to right';
      alignBtn.innerHTML = isRight ? '<i class="bi bi-arrow-left"></i>' : '<i class="bi bi-arrow-right"></i>';
    };
    setAlignBtnState();
    alignBtn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      try {
        const range = marker.find();
        if (!range) return;
        const fromIdx = cm.indexFromPos(range.from);
        const toIdx = cm.indexFromPos(range.to);
        const text = cm.getValue();
        const token = text.slice(fromIdx, toIdx);
        const body = token.replace(/\{[^}]*\}\s*$/, '');
        const m = token.match(/\{([^}]*)\}\s*$/);
        let curW = null;
        if (m) {
          const w = m[1].match(/\bwidth\s*=\s*(\d{2,4})/i) || m[1].match(/\bw\s*=\s*(\d{2,4})/i);
          curW = w ? parseInt(w[1], 10) : null;
        }
        const isRight = /\balign\s*=\s*right/i.test(token) || /\bfloat\s*=\s*right/i.test(token) || wrap.classList.contains('align-right');
        const parts = [];
        if (Number.isFinite(curW)) parts.push(`width=${curW}`);
        if (!isRight) parts.push('align=right');
        const metaStr = parts.length ? `{${parts.join(', ')}}` : '';
        const newTok = `${body}${metaStr}`;
        internalImageOp = true;
        const prev = suppressWidgetRefresh;
        suppressWidgetRefresh = true;
        cm.operation(() => {
          cm.replaceRange(newTok, range.from, range.to);
          // reflect state immediately
          wrap.classList.toggle('align-right', !isRight);
          meta.align = wrap.classList.contains('align-right') ? 'right' : null;
          setAlignBtnState();
          clearImageWidgets();
          rebuildImageWidgets();
        });
        suppressWidgetRefresh = prev;
        internalImageOp = false;
      } catch {}
    });
    wrap.appendChild(alignBtn);

    // Resize: right edge, bottom edge and bottom-right corner
    const start = { x: 0, y: 0, w: 0, h: 0 };
    let resizing = false; // 'x' | 'y' | 'xy'
    function setWidth(px) {
      const max = Math.max(80, Math.min(px, wrap.parentElement?.clientWidth ? wrap.parentElement.clientWidth - 16 : px));
      img.style.width = Math.round(max) + 'px';
    }
    function applyWidthToMarkdown() {
      try {
        const range = marker.find();
        if (!range) return;
        const fromIdx = cm.indexFromPos(range.from);
        const toIdx = cm.indexFromPos(range.to);
        const text = cm.getValue();
        const token = text.slice(fromIdx, toIdx);
        const body = token.replace(/\{[^}]*\}\s*$/, '');
        const curW = parseInt((img.style.width || '').replace(/px$/, ''), 10);
        const alignMatch = token.match(/\b(align|float)\s*=\s*(left|right|center)/i);
        const alignPart = alignMatch ? `, align=${alignMatch[2].toLowerCase()}` : '';
        const newTok = `${body}{width=${Number.isFinite(curW) ? curW : 0}${alignPart}}`;
        internalImageOp = true;
        const prev = suppressWidgetRefresh;
        suppressWidgetRefresh = true;
        cm.operation(() => {
          cm.replaceRange(newTok, range.from, range.to);
          clearImageWidgets();
          rebuildImageWidgets();
        });
        suppressWidgetRefresh = prev;
        internalImageOp = false;
      } catch {}
    }
    function onMove(ev) {
      if (!resizing) return;
      const pt = ev.touches && ev.touches[0] ? ev.touches[0] : ev;
      const dx = (pt.clientX || 0) - start.x;
      const dy = (pt.clientY || 0) - start.y;
      if (resizing === 'x') {
        setWidth(start.w + dx);
      } else if (resizing === 'y') {
        const ratio = start.w / Math.max(1, start.h);
        const newH = Math.max(10, start.h + dy);
        setWidth(newH * ratio);
      } else {
        setWidth(start.w + dx);
      }
      ev.preventDefault();
    }
    function onUp(ev) {
      if (!resizing) return;
      resizing = false;
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseup', onUp, true);
      document.removeEventListener('touchmove', onMove, true);
      document.removeEventListener('touchend', onUp, true);
      applyWidthToMarkdown();
    }
    function beginResize(ev, mode) {
      ev.preventDefault(); ev.stopPropagation();
      const pt = ev.touches && ev.touches[0] ? ev.touches[0] : ev;
      start.x = pt.clientX || 0;
      start.y = pt.clientY || 0;
      const rect = img.getBoundingClientRect();
      start.w = rect.width; start.h = rect.height;
      resizing = mode || 'x';
      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('mouseup', onUp, true);
      document.addEventListener('touchmove', onMove, true);
      document.addEventListener('touchend', onUp, true);
    }
    const edge = document.createElement('span');
    edge.className = 'img-resize-handle';
    edge.addEventListener('mousedown', (e) => beginResize(e, 'x'));
    edge.addEventListener('touchstart', (e) => beginResize(e, 'x'), { passive: false });
    wrap.appendChild(edge);
    const corner = document.createElement('span');
    corner.className = 'img-resize-corner';
    corner.addEventListener('mousedown', (e) => beginResize(e, 'xy'));
    corner.addEventListener('touchstart', (e) => beginResize(e, 'xy'), { passive: false });
    wrap.appendChild(corner);
    const bottom = document.createElement('span');
    bottom.className = 'img-resize-bottom';
    bottom.addEventListener('mousedown', (e) => beginResize(e, 'y'));
    bottom.addEventListener('touchstart', (e) => beginResize(e, 'y'), { passive: false });
    wrap.appendChild(bottom);

    return wrap;
  }

  function clearImageWidgets() {
    try { imageMarks.forEach((mk) => mk.clear()); } catch {}
    imageMarks = [];
  }

  function rebuildImageWidgets() {
    if (!notesMDE || !notesMDE.codemirror) return;
    const cm = notesMDE.codemirror;
    clearImageWidgets();
    const text = cm.getValue();
    const metas = parseImageMeta(text);
    metas.forEach((meta) => {
      try {
        const from = cm.posFromIndex(meta.from);
        const to = cm.posFromIndex(meta.to);
        const widget = buildImageWidget(cm, meta, {
          find: () => mk.find()
        });
        const mk = cm.getDoc().markText(from, to, {
          replacedWith: widget,
          atomic: true,
          clearOnEnter: false,
          handleMouseEvents: true,
        });
        // Rebind widget marker resolver with the created marker
        widget.__marker = mk;
        imageMarks.push(mk);
      } catch {}
    });
  }

  // (MathQuill inline editor removed)

  

  function scheduleImageWidgets() {
    clearTimeout(imageWidgetRefreshTimer);
    imageWidgetRefreshTimer = setTimeout(rebuildImageWidgets, 120);
  }

  function updateNotesState(val) {
    try {
      if (currentQuestionID != null && Array.isArray(questionStates)) {
        ensureStateLength(window.displayQuestions?.length || 0);
        if (questionStates[currentQuestionID]) {
          questionStates[currentQuestionID].notes = val;
          markDirty();
          scheduleSave(aID);
        }
      }
    } catch {}
  }

  function bindFallbackTextarea(textarea) {
    if (!textarea || textarea.dataset.bound === "1") return;
    textarea.dataset.bound = "1";
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        try { textarea.blur(); } catch {}
      }
    });
    const onInput = () => {
      updateNotesState(textarea.value || "");
    };
    textarea.addEventListener("input", onInput);
    fallbackInputHandler = onInput;
  }

  function refreshPreview(easyMDE) {
    try {
      if (!easyMDE || !easyMDE.isPreviewActive()) return;
      const container = easyMDE.codemirror
        .getWrapperElement()
        .closest(".EasyMDEContainer");
      if (!container) return;
      const pv = container.querySelector(".editor-preview");
      if (!pv) return;
      const val = easyMDE.value();
      let html;
      if (typeof easyMDE.options.previewRender === "function") {
        html = easyMDE.options.previewRender(val, pv);
      } else if (typeof easyMDE.markdown === "function") {
        html = easyMDE.markdown(val);
      } else {
        html = val;
      }
      pv.innerHTML = html;
      // Make preview images clickable to open overlay
      try {
        pv.querySelectorAll('img').forEach((im) => {
          im.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); try { showImageOverlay(im.src); } catch {} });
        });
      } catch {}
    } catch {}
  }

  function initNotesEditor() {
    const host = document.getElementById("notesInput");
    if (!host || notesMDE) return;

    // Ensure the textarea works as a fallback while EasyMDE loads
    if (!fallbackTextarea && String(host.tagName || "").toLowerCase() === "textarea") {
      fallbackTextarea = host;
      bindFallbackTextarea(fallbackTextarea);
      if (typeof window.focusNotesEditor !== 'function') {
        window.focusNotesEditor = () => { try { fallbackTextarea?.focus(); } catch {} };
      }
    }

    // Wait for EasyMDE (loaded via CDN in assignment.html) then initialize
    let tries = 0;
    const maxTries = 40;
    (function tryInit() {
      if (window.EasyMDE && document.getElementById("notesInput")) {
        try {
          let el = document.getElementById("notesInput");
          if (String(el.tagName || "").toLowerCase() !== "textarea") {
            const ta = document.createElement("textarea");
            ta.id = "notesInput";
            ta.className = "form-control";
            ta.placeholder = "Add your notes...";
            el.replaceWith(ta);
            el = ta;
          }

          // If we bound fallback listeners, remove them to avoid duplicate updates
          if (fallbackTextarea && fallbackInputHandler) {
            try { fallbackTextarea.removeEventListener("input", fallbackInputHandler); } catch {}
            fallbackInputHandler = null;
          }

          notesMDE = new EasyMDE({
            element: el,
            autofocus: false,
            spellChecker: false,
            forceSync: true,
            placeholder: "Add your notes...",
            status: false,
            previewRender: function (plainText, preview) {
              // Render markdown with image metadata support; strip {..} from visible HTML
              let html;
              try {
                const stripped = String(plainText).replace(/!\[(.*?)\]\(([^)]+?)\)(\{[^}]*\})/g, '![$1]($2)');
                html = (notesMDE && typeof notesMDE.markdown === 'function') ? notesMDE.markdown(stripped) : stripped;
              } catch { html = plainText; }
              try {
                const widthMap = new Map();
                const alignMap = new Map();
                parseImageMeta(plainText).forEach(m => {
                  if (m.width) widthMap.set(m.url, m.width);
                  if (m.align) alignMap.set(m.url, (m.align || '').toLowerCase());
                });
                const doc = new DOMParser().parseFromString(String(html), 'text/html');
                doc.querySelectorAll('img').forEach((img) => {
                  const src = img.getAttribute('src');
                  const w = widthMap.get(src);
                  const al = alignMap.get(src);
                  if (w) {
                    img.style.maxWidth = '100%';
                    img.style.width = String(w) + 'px';
                    img.style.height = 'auto';
                  }
                  if (al === 'right') {
                    img.classList.add('preview-align-right');
                  }
                });
                return doc.body.innerHTML;
              } catch { return html; }
            },
            toolbar: [
              { name: "bold", action: EasyMDE.toggleBold, className: "bi bi-type-bold", title: "Bold" },
              { name: "italic", action: EasyMDE.toggleItalic, className: "bi bi-type-italic", title: "Italic" },
              { name: "heading", action: EasyMDE.toggleHeadingSmaller, className: "bi bi-type-h1", title: "Heading" },
              "|",
              
              {
                name: "image-upload",
                className: "bi bi-image",
                title: "Upload Image",
                action: function (editor, ev) {
                  try {
                    if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
                    // Auth gate
                    try {
                      const getTok = (typeof window.qbGetToken === "function" && window.qbGetToken) || null;
                      const token = getTok ? String(getTok() || "") : "";
                      if (!token) {
                        try { window.dispatchEvent(new Event("qbase:force-login")); } catch {}
                        uiNotice("Please log in to upload images.", 'Login required');
                        return false;
                      }
                    } catch {}
                    // Hidden file input
                    const pick = document.createElement("input");
                    pick.type = "file";
                    pick.accept = "image/*";
                    pick.style.position = "fixed";
                    pick.style.left = "-9999px";
                    pick.style.width = "1px";
                    pick.style.height = "1px";
                    document.body.appendChild(pick);
                    pick.onchange = function () {
                      const file = pick.files && pick.files[0];
                      if (!file) return;
                      const fn = editor?.options?.imageUploadFunction;
                      if (typeof fn !== "function") { uiNotice("Image upload not available."); return; }
                      fn(
                        file,
                        function (url) {
                          try { editor.codemirror.replaceSelection(`![](${url})`); editor.codemirror.focus(); } catch {}
                        },
                        function (err) { uiNotice(err || "Upload failed", 'Upload'); }
                      );
                      try { pick.remove(); } catch {}
                    };
                    setTimeout(() => { try { pick.click(); } catch {} }, 0);
                  } catch {}
                  return false;
                },
              },
              {
                name: "image-url",
                className: "bi bi-link-45deg",
                title: "Insert Image by URL",
                action: async function (editor, ev) {
                  try { if (ev && typeof ev.preventDefault === 'function') ev.preventDefault(); } catch {}
                  const url = await uiPrompt('Enter image URL (https://...)', 'https://', 'Insert image');
                  if (!url) return false;
                  try { editor.codemirror.replaceSelection(`![](${url})`); editor.codemirror.focus(); } catch {}
                  return false;
                }
              },
            ],
            imageUpload: true,
            imageAccept: "image/*",
            imageMaxSize: 5 * 1024 * 1024,
            imageUploadFunction: function (file, onSuccess, onError) {
              (async function () {
                try {
                  try { if (typeof loadConfig === "function" && (!window.API_BASE || !String(window.API_BASE))) await loadConfig(); } catch {}
                  const fd = new FormData();
                  fd.append("image", file);
                  const base = (typeof API_BASE === "string" && API_BASE)
                    ? API_BASE
                    : (location.origin && location.origin.startsWith("http") ? location.origin : "http://localhost:3000");
                  const url = base.replace(/\/$/, "") + "/api/upload-image";
                  const fetcher = (typeof authFetch === "function") ? authFetch : fetch;
                  const r = await fetcher(url, { method: "POST", body: fd });
                  if (r && r.status === 401) {
                    try { window.dispatchEvent(new Event("qbase:force-login")); } catch {}
                    throw new Error("Please log in to upload images");
                  }
                  if (!r.ok) throw new Error(`Upload failed (${r.status})`);
                  const data = await r.json();
                  if (data && data.url) onSuccess(data.url);
                  else throw new Error("Invalid upload response");
                } catch (e) {
                  onError(e && e.message ? e.message : "Upload error");
                }
              })();
            },
          });

          // Keep app state updated on content changes
          try {
            notesMDE.codemirror.on("change", function () {
              if (suppressNotesChange) return;
              try { updateNotesState(notesMDE.value()); } catch {}
              // If in preview, refresh its content lazily
              try { refreshPreview(notesMDE); } catch {}
              // Refresh image widgets for any newly-added tokens
              if (!suppressWidgetRefresh) {
                scheduleImageWidgets();
              }
            });
          } catch {}

          // Allow Esc to exit the notes editor (blur CodeMirror)
          try {
            notesMDE.codemirror.on('keydown', function (cm, ev) {
              try {
                if (ev && (ev.key === 'Escape' || ev.key === 'Esc')) {
                  ev.preventDefault();
                  ev.stopPropagation();
                  try { cm.getInputField()?.blur(); } catch {}
                }
              } catch {}
            });
          } catch {}

          // Prevent manual deletion of image markdown; require using delete button
          try {
            notesMDE.codemirror.on('beforeChange', function (cm, change) {
              try {
                if (internalImageOp) return; // allow our own programmatic edits
                if (!change || !change.from || !change.to) return;
                const doc = cm.getDoc();
                const fromIdx = doc.indexFromPos(change.from);
                const toIdx = doc.indexFromPos(change.to);
                const metas = parseImageMeta(doc.getValue());
                const intersects = metas.some(m => fromIdx < m.to && toIdx > m.from);
                if (intersects && (change.origin || '') !== 'setValue') {
                  change.cancel();
                  try { uiNotice('Use the image delete button to remove images.', 'Images'); } catch {}
                }
              } catch {}
            });
          } catch {}

          // Start in preview mode only if there is content; keep editor visible when empty so placeholder shows
          try {
            const _initVal = String(notesMDE.value() || "").trim();
            const shouldPreview = _initVal.length > 0;
            if (shouldPreview && !notesMDE.isPreviewActive()) notesMDE.togglePreview();
          } catch {}

          // Toggle preview based on focus/blur
          try {
            notesMDE.codemirror.on("focus", function () {
              try { if (notesMDE.isPreviewActive()) notesMDE.togglePreview(); } catch {}
            });
            notesMDE.codemirror.on("blur", function () {
              try {
                setTimeout(function () {
                  try {
                    const container = notesMDE.codemirror.getWrapperElement().closest('.EasyMDEContainer');
                    const ae = document.activeElement;
                    if (container && ae && container.contains(ae)) return; // still in toolbar
                    const _val = String(notesMDE.value() || "").trim();
                    if (_val.length > 0) {
                      if (!notesMDE.isPreviewActive()) notesMDE.togglePreview();
                      refreshPreview(notesMDE);
                    } else {
                      // Keep editor visible when empty so placeholder remains visible
                      if (notesMDE.isPreviewActive()) notesMDE.togglePreview();
                    }
                  } catch {}
                }, 0);
              } catch {}
            });
          } catch {}

          // Allow clicking the preview area to enter edit mode
          try {
            const container = notesMDE.codemirror.getWrapperElement().closest('.EasyMDEContainer');
            if (container && !container.dataset.previewClickBound) {
              container.dataset.previewClickBound = "1";
              container.addEventListener("click", function (ev) {
                try {
                  if (!notesMDE.isPreviewActive()) return; // already in edit mode
                  if (ev.target.closest('.editor-toolbar')) return; // toolbar interactions
                  const pv = container.querySelector('.editor-preview, .editor-preview-active');
                  // Do not toggle to edit if clicking an image; let image handler open overlay
                  if (pv && pv.contains(ev.target)) {
                    if (ev.target && (String(ev.target.tagName||'').toLowerCase()==='img' || ev.target.closest('img'))) {
                      try {
                        const img = ev.target.closest('img');
                        if (img && typeof showImageOverlay === 'function') showImageOverlay(img.src);
                      } catch {}
                      return;
                    }
                    ev.preventDefault();
                    notesMDE.togglePreview();
                    notesMDE.codemirror.focus();
                  }
                } catch {}
              }, true);
              const style = document.createElement('style');
              style.textContent = ".EasyMDEContainer .editor-preview{cursor:text;}";
              document.head.appendChild(style);
            }
          } catch {}

          // Enable paste/drag image upload while in preview
          try {
            (function bindPreviewUploadHandlers() {
              const container = notesMDE.codemirror.getWrapperElement().closest('.EasyMDEContainer');
              if (!container || container.dataset.previewUploadBound === '1') return;
              container.dataset.previewUploadBound = '1';

              function maybeUpload(files) {
                try {
                  const list = Array.from(files || []).filter((f) => f && /^image\//i.test(f.type));
                  if (!list.length) return false;
                  const fn = notesMDE?.options?.imageUploadFunction;
                  if (typeof fn !== 'function') return false;
                  const file = list[0];
                  fn(
                    file,
                    function (url) {
                      try {
                        if (notesMDE.isPreviewActive()) notesMDE.togglePreview();
                        notesMDE.codemirror.replaceSelection(`![](${url})`);
                        notesMDE.codemirror.focus();
                      } catch {}
                    },
                    function (err) { try { alert(err || 'Upload failed'); } catch {} }
                  );
                  return true;
                } catch { return false; }
              }

              function hasFiles(e) { const dt = e && e.dataTransfer; return !!(dt && dt.files && dt.files.length); }

              container.addEventListener('dragover', function (e) { if (!hasFiles(e)) return; e.preventDefault(); try { e.dataTransfer.dropEffect = 'copy'; } catch {} }, true);
              container.addEventListener('drop', function (e) { if (!hasFiles(e)) return; e.preventDefault(); maybeUpload(e.dataTransfer.files); }, true);

              function handlePasteEvent(e) {
                try {
                  // Only handle when preview is active; avoid duplicating EasyMDE's edit-mode paste handler
                  if (!notesMDE || !notesMDE.isPreviewActive()) return;
                  if (e.__notesPasteHandled) return;
                  const cd = e.clipboardData; if (!cd) return;
                  const files = [];
                  for (let i = 0; i < cd.items.length; i++) { const it = cd.items[i]; if (it && it.kind === 'file') { const f = it.getAsFile(); if (f) files.push(f); } }
                  if (files.length) { e.preventDefault(); e.__notesPasteHandled = true; maybeUpload(files); }
                } catch {}
              }
              container.addEventListener('paste', handlePasteEvent, true);

              function globalGuard(e) { const dt = e && e.dataTransfer; if (dt && dt.files && dt.files.length) { e.preventDefault(); } }
              window.addEventListener('dragover', globalGuard, true);
              window.addEventListener('drop', globalGuard, true);
            })();
          } catch {}

          // Focus helper for hotkeys
          window.focusNotesEditor = () => { try { notesMDE?.codemirror?.focus(); } catch {} };
          // Build initial image widgets
          scheduleImageWidgets();
        } catch (e) {
          if (tries++ < maxTries) return setTimeout(tryInit, 150);
        }
        return; // done
      }
      if (tries++ < maxTries) setTimeout(tryInit, 150);
    })();
  }

  // Expose setter used when switching questions
  window.setNotesInEditor = function setNotesInEditor(text) {
    try { initNotesEditor(); } catch {}
    const val = String(text || "");
    if (notesMDE) {
      suppressNotesChange = true;
      try { notesMDE.value(val); } catch {}
      suppressNotesChange = false;
      try {
        const _trim = val.trim();
        // Ensure correct initial mode immediately when setting notes
        if (_trim.length > 0) {
          // Non-empty: show preview right away
          if (!notesMDE.isPreviewActive()) {
            try { notesMDE.togglePreview(); } catch {}
          }
        } else {
          // Empty: keep editor visible so placeholder shows
          if (notesMDE.isPreviewActive()) {
            try { notesMDE.togglePreview(); } catch {}
          }
        }
        // If in preview now, render the preview content
        if (notesMDE.isPreviewActive()) {
          const container = notesMDE.codemirror.getWrapperElement().closest('.EasyMDEContainer');
          const pv = container?.querySelector('.editor-preview');
          if (pv) {
            let html;
            try {
              html = typeof notesMDE.options.previewRender === 'function'
                ? notesMDE.options.previewRender(val, pv)
                : (typeof notesMDE.markdown === 'function' ? notesMDE.markdown(val) : val);
            } catch { html = val; }
            pv.innerHTML = html;
          }
        }
      } catch {}
      try { scheduleImageWidgets(); } catch {}
    } else if (fallbackTextarea) {
      fallbackTextarea.value = val;
    } else {
      const host = document.getElementById("notesInput");
      if (host && host.tagName.toLowerCase() === "textarea") {
        fallbackTextarea = host;
        bindFallbackTextarea(fallbackTextarea);
        fallbackTextarea.value = val;
      }
    }
  };

  // Provide a default focus helper that initializes editor on demand
  if (typeof window.focusNotesEditor !== 'function') {
    window.focusNotesEditor = () => {
      try {
        initNotesEditor();
        if (notesMDE) notesMDE.codemirror.focus();
        else if (fallbackTextarea) fallbackTextarea.focus();
      } catch {}
    };
  }

  

  // ---------- App state ----------
  let questionData;
  let currentQuestionID;
  let questionButtons;
  let questionStates;
  let optionButtons = [];
  let timerInterval;
  let resetCooldownTimer = null;

  const RESET_COOLDOWN_LS_KEY = "qbase.pref.resetCooldownMs";
  const RESET_COOLDOWN_DEFAULT_MS = 2000;
  const RESET_COOLDOWN_MAX_MS = 60000;

  // ---------- UI helpers ----------
  function formatTime(sec) {
    const m = String(Math.floor(sec / 60)).padStart(2, "0");
    const s = String(sec % 60).padStart(2, "0");
    return `${m}:${s}`;
  }

  function readResetCooldownMs() {
    try {
      const raw = localStorage.getItem(RESET_COOLDOWN_LS_KEY);
      const num = Number(raw);
      if (!Number.isFinite(num) || num < 0) return RESET_COOLDOWN_DEFAULT_MS;
      return Math.min(num, RESET_COOLDOWN_MAX_MS);
    } catch {
      return RESET_COOLDOWN_DEFAULT_MS;
    }
  }

  function clearResetCooldownTimer() {
    if (resetCooldownTimer) {
      clearTimeout(resetCooldownTimer);
      resetCooldownTimer = null;
    }
  }

  function applyResetCooldownState(qState) {
    const resetBtn = document.getElementById("reset-question");
    if (!resetBtn || !qState) return;
    clearResetCooldownTimer();
    resetBtn.disabled = false;

    const unlockAt = Number(qState.resetLockedUntil) || 0;
    if (!unlockAt) return;
    const now = Date.now();
    const remaining = unlockAt - now;
    if (remaining <= 0) {
      qState.resetLockedUntil = 0;
      return;
    }
    resetBtn.disabled = true;
    resetCooldownTimer = setTimeout(() => {
      resetBtn.disabled = false;
      resetCooldownTimer = null;
      qState.resetLockedUntil = 0;
      markDirty();
      scheduleSave(aID);
    }, remaining);
  }

  function stopQuestionTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function startQuestionTimer(qID) {
    const timerElem = document.getElementById("timer");
    if (!timerElem) return;
    stopQuestionTimer();
    const st = questionStates?.[qID];
    const value = st ? st.time || 0 : 0;
    timerElem.textContent = formatTime(value);

    if (st && !st.isAnswerEvaluated) {
      timerInterval = setInterval(() => {
        st.time++;
        timerElem.textContent = formatTime(st.time);
        markDirty(); // keep local change; don't scheduleSave here
      }, 1000);
    }
  }

  function resetTimerForCurrentQuestion() {
    if (currentQuestionID == null) return;
    const st = questionStates?.[currentQuestionID];
    if (!st) return;
    st.time = 0;
    startQuestionTimer(currentQuestionID);
    markDirty();
    scheduleSave(aID);
  }

  // Wire option buttons
  document.querySelectorAll(".mcq-option").forEach((btn) => {
    optionButtons.push(btn);
    btn.addEventListener("click", () => MCQOptionClicked(btn));
  });

  // Numerical input
  const numericalInput = document.getElementById("numericalInput");
  numericalInput.addEventListener("input", () => {
    const qState = questionStates[currentQuestionID];
    const raw = numericalInput.value.trim();

    if (raw === "") {
      qState.pickedNumerical = undefined;
      qState.isAnswerPicked = false;
    } else {
      qState.pickedNumerical = Number(raw);
      qState.isAnswerPicked = true;
    }

    evaluateQuestionButtonColor(currentQuestionID);
    markDirty();
    scheduleSave(aID);
  });

  // Timer reset (clickable badge)
  (function wireTimerReset() {
    const timerEl = document.getElementById("timer");
    if (!timerEl) return;
    const trigger = (e) => {
      e?.preventDefault();
      resetTimerForCurrentQuestion();
    };
    timerEl.addEventListener("click", trigger);
    timerEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") trigger(e);
    });
  })();

  // Initialize the notes editor once the DOM is ready
  try { initNotesEditor(); } catch {}

  // Reuse modal helper from navbar.js if available, else fallback to confirm
  async function confirmReset() {
    if (typeof showConfirm === "function") {
      return await showConfirm({
        title: "Reset Assignment?",
        message:
          "This will permanently clear all your answers and progress for this assignment.",
        okText: "Yes, Reset",
        cancelText: "Cancel",
      });
    }
    return confirm(
      "This will permanently clear all your answers and progress for this assignment."
    );
  }

  document
    .getElementById("reset-assignment")
    .addEventListener("click", async () => {
      const yes = await confirmReset();
      if (!yes) return;

      try {
        // Preserve per-question notes while resetting progress/answers
        const preservedNotes = Array.isArray(questionStates)
          ? questionStates.map((s) => (s && typeof s.notes === "string" ? s.notes : ""))
          : [];

        // Build a fresh state array with notes carried over
        const resetStates = Array(window.displayQuestions.length)
          .fill()
          .map((_, i) => ({ ...defaultState(), notes: preservedNotes[i] || "" }));

        if (authSource === "server") {
          // Write reset state (with notes kept) to server
          await postState(aID, resetStates);
          questionStates = resetStates;
        } else {
          // Local fallback: replace stored state instead of removing it
          try {
            localStorage.setItem(`qbase:${aID}:state`, JSON.stringify(resetStates));
          } catch {}
          questionStates = resetStates;
        }

        // Also clear all saved question colors for this assignment
        try {
          const listResp = await authFetch(`${API_BASE}/api/question-marks`, { cache: 'no-store' });
          if (listResp.ok) {
            const all = await listResp.json();
            const mine = Array.isArray(all)
              ? all.filter((m) => Number(m.assignmentId) === Number(aID))
              : [];
            for (const m of mine) {
              const qi = Number(m?.questionIndex);
              if (!Number.isNaN(qi)) {
                try { await authFetch(`${API_BASE}/api/question-marks/${aID}/${qi}`, { method: 'DELETE' }); } catch {}
              }
            }
          }
          try { updateColorIndicators(); } catch {}
        } catch {}

        // Refresh UI to first question
        questionButtons.forEach((btn) =>
          evaluateQuestionButtonColor(btn.dataset.qid)
        );
        clickQuestionButton(0);
        dirty = false;
      } catch (e) {
        console.error("Reset failed:", e);
        if (typeof showNotice === "function") {
          await showNotice({
            title: "Error",
            message: "Failed to reset assignment.",
          });
        } else {
          alert("Failed to reset assignment.");
        }
      }
    });

  function resetCurrentQuestion() {
    if (currentQuestionID == null) return;
    const qID = currentQuestionID;
    const originalIdx = window.questionIndexMap[qID];
    const q = questionData.questions[originalIdx];

    // Fully reset state (time = 0 now) (without resetting notes)
    const originalNotes = questionStates[qID]['notes']
    questionStates[qID] = { ...defaultState(), time: 0 };
    questionStates[qID]['notes'] = originalNotes
    questionStates[qID].resetLockedUntil = 0;
    clearResetCooldownTimer();
    stopQuestionTimer();

    // Clear visuals + unlock
    if (q.qType === "SMCQ" || q.qType === "MMCQ") {
      optionButtons.forEach((btn) => {
        btn.classList.remove(
          "correct",
          "wrong",
          "missed",
          "disabled",
          "mcq-option-selected"
        );
      });
    } else if (q.qType === "Numerical") {
      numericalInput.disabled = false;
      numericalInput.classList.remove("is-correct", "is-wrong");
      numericalInput.value = "";
      const numericalAnswer = document.getElementById("numericalAnswer");
      if (numericalAnswer) numericalAnswer.parentElement.style.display = "none";
    }

    // Hide reset, show check answer again
    document.getElementById("reset-question").classList.add("d-none");
    document.getElementById("check-answer").classList.remove("d-none");
    const resetBtn = document.getElementById("reset-question");
    if (resetBtn) resetBtn.disabled = false;
    hideSolutionPanel();

    // Re-render question UI from scratch (timer restarts from 0)
    setQuestion(qID);
    evaluateQuestionButtonColor(qID);

    markDirty();
    scheduleSave(aID);
  }

  // Hook up the Check Answer button once
  document.getElementById("check-answer").addEventListener("click", () => {
    if (currentQuestionID == null) return;
    // micro pulse for feedback
    try {
      const b = document.getElementById("check-answer");
      b.classList.remove("btn-pulse");
      void b.offsetWidth; // reflow
      b.classList.add("btn-pulse");
    } catch {}
    checkCurrentAnswer();
  });

  // Bookmark functionality
  document.getElementById("bookmark-btn").addEventListener("click", () => {
    if (currentQuestionID == null) return;
    // micro pulse for feedback
    try {
      const b = document.getElementById("bookmark-btn");
      b.classList.remove("btn-pulse");
      void b.offsetWidth; // reflow
      b.classList.add("btn-pulse");
    } catch {}
    showBookmarkDialog();
  });

  // Report functionality
  document.getElementById("report-btn")?.addEventListener("click", () => {
    if (currentQuestionID == null) return;
    try {
      const b = document.getElementById("report-btn");
      b.classList.remove("btn-pulse");
      void b.offsetWidth; // reflow
      b.classList.add("btn-pulse");
    } catch {}
    showReportDialog();
  });

  async function showReportDialog() {
    try {
      const originalIdx = window.questionIndexMap[currentQuestionID];
      const reasons = [
        { id: "wrong-answer", label: "Answer seems incorrect" },
        { id: "wrong-solution", label: "Solution seems incorrect" },
        { id: "typo", label: "Typo or formatting issue" },
        { id: "bad-image", label: "Image is unclear/broken" },
        { id: "other", label: "Other" },
      ];

      let bodyHTML = '<div class="mb-2">Whats the issue?</div>';
      bodyHTML += '<div class="list-group mb-3">';
      reasons.forEach((r, i) => {
        const checked = i === 0 ? 'checked' : '';
        bodyHTML += `
          <label class="list-group-item list-group-item-action">
            <input class="form-check-input me-1" type="radio" name="rep-reason" value="${r.id}" ${checked}>
            ${r.label}
          </label>`;
      });
      bodyHTML += '</div>';
      bodyHTML += `
        <div class="mb-1"><strong>Additional details (optional)</strong></div>
        <textarea id="rep-notes" class="form-control" rows="3" placeholder="Add any details that can help..."></textarea>
      `;

      // Override with required assignment report options and required details
      try {
        bodyHTML = "";
        bodyHTML += "<div class=\"mb-2\">What's the issue?</div>";
        bodyHTML += '<div class="list-group mb-3">';
        const _opts = [
          "Typographical or Formatting Error",
          "Missing Image",
          "Answer Incorrect",
          "Other (mention in report details.)",
        ];
        for (let i = 0; i < _opts.length; i++) {
          const label = _opts[i];
          const checked = i === 0 ? "checked" : "";
          bodyHTML += `\n<label class=\"list-group-item list-group-item-action\">\n  <input class=\"form-check-input me-1\" type=\"radio\" name=\"rep-reason\" value=\"${label}\" ${checked}>\n  ${label}\n</label>`;
        }
        bodyHTML += '</div>';
        bodyHTML += `\n<div class=\"mb-1\"><strong>Report Details (required)</strong></div>\n<textarea id=\"rep-notes\" class=\"form-control\" rows=\"3\" placeholder=\"Describe the issue...\"></textarea>`;
      } catch {}

      const modal = await showModal({
        title: "Report Question",
        bodyHTML,
        buttons: [
          { text: "Cancel", className: "btn btn-secondary", value: "cancel" },
          { text: "Submit", className: "btn btn-warning", value: "submit" },
        ],
        focusSelector: 'input[name="rep-reason"]:checked',
      });

      if (modal !== "submit") return;

      const modalEl = document.getElementById("qbaseModal");
      const reason = (modalEl.querySelector('input[name="rep-reason"]:checked')?.value || "").trim();
      const message = String(modalEl.querySelector('#rep-notes')?.value || "").trim();
      if (!message) {
        await showNotice({ title: "Report Details Required", message: "Please enter report details." });
        return;
      }

      const payload = {
        kind: "assignment",
        assignmentId: aID,
        questionIndex: Number(originalIdx),
        reason,
        message,
        meta: {
          assignmentTitle: assignmentTitle || `Assignment ${aID}`,
          displayIndex: currentQuestionID + 1,
        },
      };

      const res = await authFetch(`${API_BASE}/api/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`Failed: ${res.status} ${errText}`);
      }

      await showNotice({
        title: "Thank you",
        message: "Your report has been submitted.",
      });
    } catch (e) {
      console.error("report dialog:", e);
      await showNotice({ title: "Error", message: "Failed to submit report" });
    }
  }

  // Quick color picker near bookmark icon
  (function wireQColorPicker() {
    const picker = document.getElementById('qcolor-picker');
    if (!picker) return;
    // Toggle expand/collapse when clicking the picker background
    picker.addEventListener('click', async (e) => {
      const chip = e.target.closest('.qcolor-chip');
      if (!chip) {
        picker.classList.toggle('collapsed');
        return;
      }
      // If collapsed and clicking the selected chip, expand instead of re-setting
      if (picker.classList.contains('collapsed') && chip.classList.contains('selected')) {
        picker.classList.remove('collapsed');
        return;
      }
      // Select a color (or none)
      if (currentQuestionID == null) return;
      const val = String(chip.getAttribute('data-color') || '').trim();
      let ok = true;
      if (!val || val.toLowerCase() === 'none') ok = await clearQuestionColor();
      else ok = await setQuestionColor(val);
      if (ok) {
        updateColorIndicators();
        updateColorPickerSelection();
        // collapse after choosing
        picker.classList.add('collapsed');
      }
    });
    // Click outside to collapse
    document.addEventListener('click', (e) => {
      if (!picker) return;
      if (picker.contains(e.target)) return;
      picker.classList.add('collapsed');
    });
  })();

  function checkCurrentAnswer() {
    const qID = currentQuestionID;
    const originalIdx = window.questionIndexMap[qID];
    const q = questionData.questions[originalIdx];
    const st = questionStates[qID];

    if (!st) return;

    // Don't re-grade if already evaluated
    if (st.isAnswerEvaluated) return;

    let status = "incorrect"; // default
    let partial = false;

    if (q.qType === "SMCQ") {
      const correct = normalizeAnswer(q); // Set
      const picked = getUserSelection(st, "SMCQ"); // Set
      const isCorrect = picked.size === 1 && correct.has([...picked][0]);
      status = isCorrect ? "correct" : "incorrect";
      // visuals
      clearMCQVisuals();
      applyMCQEvaluationStyles(correct, picked);
    } else if (q.qType === "MMCQ") {
      const correct = normalizeAnswer(q); // Set of correct opts
      const picked = getUserSelection(st, "MMCQ"); // Set of picked opts

      const pickedWrong = [...picked].some((x) => !correct.has(x));
      const missed = [...correct].some((x) => !picked.has(x));
      const allCorrectPickedOnly = !pickedWrong && !missed;

      if (allCorrectPickedOnly) status = "correct";
      else if (!pickedWrong && picked.size > 0 && picked.size < correct.size) {
        status = "partial";
        partial = true;
      } else {
        status = "incorrect";
      }

      clearMCQVisuals();
      applyMCQEvaluationStyles(correct, picked);
    } else if (q.qType === "Numerical") {
      const ans = normalizeAnswer(q); // {value, valid}
      const user = getUserSelection(st, "Numerical"); // number | undefined
      let isCorrect = false;
      if (ans.valid && typeof user === "number") {
        // exact match by default; adjust tolerance if needed:
        isCorrect = user === ans.value;
      }
      status = isCorrect ? "correct" : "incorrect";
      applyNumericalEvaluationStyles(isCorrect);
      // show correct answer text
      const numericalAnswer = document.getElementById("numericalAnswer");
      if (numericalAnswer)
        numericalAnswer.parentElement.style.display = "block";
    }

    // Lock MCQ interaction if applicable
    if (q.qType === "SMCQ" || q.qType === "MMCQ") {
      optionButtons.forEach((btn) => btn.classList.add("disabled"));
    }

    const checkBtn = document.getElementById("check-answer");
    const resetBtn = document.getElementById("reset-question");
    checkBtn.classList.add("d-none");
    resetBtn.classList.remove("d-none");

    stopQuestionTimer();
    const cooldownMs = readResetCooldownMs();
    st.resetLockedUntil = cooldownMs > 0 ? Date.now() + cooldownMs : 0;
    applyResetCooldownState(st);

    // Store evaluation
    st.isAnswerEvaluated = true;
    st.evalStatus = status; // 'correct' | 'partial' | 'incorrect'
    st.isAnswerPicked = st.isAnswerPicked; // unchanged
    markDirty();
    scheduleSave(aID);

    showSolutionForQuestion(q);
    // Update question grid color
    evaluateQuestionButtonColor(qID);
  }

  // ---------- Bootstrap: fetch assignment, build UI, load state ----------
  // Show loading skeleton while fetching questions
  try { document.body.classList.add("q-loading"); } catch {}
  const __customLoader = (typeof window !== 'undefined' && window.__ASSIGNMENT_CUSTOM_LOADER__) || null;
  (async () => {
    try {
      const rawData = __customLoader
        ? await __customLoader()
        : await AssignmentService.loadLocalAssignment(aID);
      const data = normalizeAssignmentPayload(rawData);
      // 1) passages
      processPassageQuestions(data.questions);
      questionData = data;

      // 2) filter out Passage markers for display
      const allQuestions = data.questions;
      const displayQuestions = [];
      const questionIndexMap = [];
      allQuestions.forEach((q, idx) => {
        if (q.qType !== "Passage") {
          displayQuestions.push(q);
          questionIndexMap.push(idx);
        }
      });
      window.displayQuestions = displayQuestions;
      window.questionIndexMap = questionIndexMap;

      // 3) build UI and states
      fillQuestionData(displayQuestions);

      // 4) load saved state (server/local), then pad
      await loadSavedState(aID);
      ensureStateLength(displayQuestions.length);

      // 5) paint buttons + open first
      questionButtons.forEach((_, i) => evaluateQuestionButtonColor(i));
      const qParam = parseInt(params.get("q"), 10);
      if (!isNaN(qParam) && qParam > 0 && qParam <= displayQuestions.length) {
        clickQuestionButton(qParam - 1); // convert to zero-based index
      } else {
        clickQuestionButton(0); // default to first question
      }
    } catch (err) {
      console.error("Failed to load assignment data", err);
    } finally {
      try { document.body.classList.remove("q-loading"); } catch {}
    }
  })();

  // ---------- UI builders & handlers ----------
  function fillQuestionData(questionsParam) {
    const questions = Array.isArray(questionsParam)
      ? questionsParam
      : questionsParam.questions;
    const mobile = document.getElementById("mobile-qbar");
    const desktop = document.getElementById("q_list");

    // init clean state array matching display length
    questionStates = Array(questions.length);

    mobile.innerHTML = "";
    desktop.innerHTML = "";
    questions.forEach((_, i) => {
      questionStates[i] = defaultState();

      // desktop button
      const dcol = document.createElement("div");
      dcol.className = "col";
      dcol.dataset.qid = i;
      const dbtn = document.createElement("button");
      dbtn.className = "btn btn-secondary q-btn";
      dbtn.textContent = i + 1;
      dbtn.dataset.qid = i;
      dbtn.addEventListener("click", () => clickQuestionButton(i));
      // Bookmark indicator (hidden by default)
      const dInd = document.createElement("span");
      dInd.className = "q-bookmark-indicator hidden";
      dInd.innerHTML = '<i class="bi bi-bookmark-fill" aria-hidden="true"></i>';
      dbtn.appendChild(dInd);
      // Color indicator (hidden by default)
      const dColor = document.createElement('span');
      dColor.className = 'q-color-indicator hidden';
      dbtn.appendChild(dColor);
      dcol.appendChild(dbtn);
      desktop.appendChild(dcol);

      // mobile button
      const mbtn = document.createElement("button");
      mbtn.className = "btn btn-secondary q-btn";
      mbtn.textContent = i + 1;
      mbtn.dataset.qid = i;
      mbtn.addEventListener("click", () => clickQuestionButton(i));
      // Bookmark indicator (hidden by default)
      const mInd = document.createElement("span");
      mInd.className = "q-bookmark-indicator hidden";
      mInd.innerHTML = '<i class="bi bi-bookmark-fill" aria-hidden="true"></i>';
      mbtn.appendChild(mInd);
      // Color indicator (hidden by default)
      const mColor = document.createElement('span');
      mColor.className = 'q-color-indicator hidden';
      mbtn.appendChild(mColor);
      mobile.appendChild(mbtn);
    });

    questionButtons = Array.from(document.getElementsByClassName("q-btn"));
    // initial bookmark badges
    updateBookmarkIndicators();
    // initial color badges
    updateColorIndicators();
    // initialize filters UI
    try { setupFilterDropdown(); } catch {}
  }

  function MCQOptionClicked(optionElement) {
    const clickedOption = optionElement.dataset.opt;
    const originalIdx = window.questionIndexMap[currentQuestionID];
    const question = questionData.questions[originalIdx];
    const questionState = questionStates[currentQuestionID];
    const questionType = question.qType;

    if (questionType === "SMCQ") {
      optionButtons.forEach((el) => el.classList.remove("mcq-option-selected"));
      if (clickedOption === questionState.pickedAnswer) {
        questionState.pickedAnswer = "";
        questionState.isAnswerPicked = false;
      } else {
        optionElement.classList.add("mcq-option-selected");
        questionState.pickedAnswer = clickedOption;
        questionState.isAnswerPicked = true;
      }
    } else if (questionType === "MMCQ") {
      const idx = questionState.pickedAnswers.indexOf(clickedOption);
      if (idx !== -1) {
        questionState.pickedAnswers.splice(idx, 1);
        optionElement.classList.remove("mcq-option-selected");
      } else {
        optionElement.classList.add("mcq-option-selected");
        questionState.pickedAnswers.push(clickedOption);
      }
      questionState.isAnswerPicked = questionState.pickedAnswers.length > 0;
    }

    evaluateQuestionButtonColor(currentQuestionID);
    markDirty();
    scheduleSave(aID);
  }

  function evaluateQuestionButtonColor(qID) {
    const idx = Number(qID);
    const qs = questionStates[idx] || defaultState();

    // Remove previous states
    questionButtons.forEach((button) => {
      if (Number(button.dataset.qid) === idx) {
        button.classList.remove(
          "unevaluated",
          "correct",
          "incorrect",
          "partial"
        );
      }
    });

    // Unevaluated but picked → yellow marker (“unevaluated” pill you already had)
    if (!qs.isAnswerEvaluated) {
      if (qs.isAnswerPicked) {
        questionButtons.forEach((button) => {
          if (Number(button.dataset.qid) === idx)
            button.classList.add("unevaluated");
        });
      }
      return;
    }

    // Evaluated → correct/partial/incorrect
    const cls =
      qs.evalStatus === "correct"
        ? "correct"
        : qs.evalStatus === "partial"
        ? "partial"
        : "incorrect";

    questionButtons.forEach((button) => {
      if (Number(button.dataset.qid) === idx) button.classList.add(cls);
    });
  }

  function clickQuestionButton(qID) {
    // Save any pending changes from the previously open question only after the first selection.
    if (currentQuestionID != null) {
      markDirty();
      scheduleSave(aID);
    }

    questionButtons.forEach((button) => {
      if (Number(button.dataset.qid) === currentQuestionID)
        button.classList.remove("selected");
      if (Number(button.dataset.qid) === qID) button.classList.add("selected");
    });

    stopQuestionTimer();
    clearResetCooldownTimer();

    currentQuestionID = qID;
    setQuestion(qID);
    evaluateQuestionButtonColor(qID);
  }

  // Small helper to replay a quick fade/slide on question content
  function qReplayEnterAnim(el) {
    if (!el) return;
    try {
      el.classList.remove("q-anim-enter");
      // force reflow to restart animation
      void el.offsetWidth;
      el.classList.add("q-anim-enter");
    } catch {}
  }

  function setQuestion(qID) {
    // 1) Always start with a clean slate for MCQ visuals
    optionButtons.forEach((btn) => {
      btn.classList.remove(
        "correct",
        "wrong",
        "missed",
        "disabled",
        "mcq-option-selected"
      );
    });

    // 2) Also reset numerical UI defaults whenever we enter a question
    numericalInput.disabled = false;
    numericalInput.classList.remove("is-correct", "is-wrong");
    const numAnsWrap =
      document.getElementById("numericalAnswer")?.parentElement;
    if (numAnsWrap) numAnsWrap.style.display = "none";

    // 3) Hide the per-question reset icon by default; we’ll show it again if evaluated
    const resetIcon = document.getElementById("reset-question-icon");
    if (resetIcon) resetIcon.classList.add("d-none");
    // 4) Hide solution panel by default on navigation
    hideSolutionPanel();

    ensureStateLength(window.displayQuestions.length);

    const originalIdx = window.questionIndexMap[qID];
    const numerical = document.getElementById("numericalDiv");
    const MCQOptions = document.getElementById("MCQOptionDiv");
    const assignmentDetails = document.getElementById("assignmentDetails");
    const assignmentTitleElem = document.getElementById("assignment-title")
    const pageTitle = document.getElementsByTagName("title")
    const typeInfo = document.getElementById("qTypeInfo");
    const qNo = document.getElementById("qNo");
    const numericalAnswer = document.getElementById("numericalAnswer");
    // Notes editor now renders inline; no textarea reference
    const questionState = questionStates[qID];
    const question = questionData.questions[originalIdx];

    // Toggle report button based on server block status (best-effort)
    (async () => {
      try {
        const btn = document.getElementById("report-btn");
        if (!btn) return;
        const url = `${API_BASE}/api/report/blocked?kind=assignment&assignmentId=${encodeURIComponent(aID)}&questionIndex=${encodeURIComponent(originalIdx)}`;
        const r = await authFetch(url);
        if (!r.ok) return; // leave as-is on failure
        const j = await r.json();
        btn.style.display = j.blocked ? 'none' : '';
      } catch {}
    })();

    qNo.textContent = qID + 1;
    typeInfo.textContent = question.qType;
    try {
      document.body.setAttribute("data-qtype", String(question.qType || "").toUpperCase());
    } catch {}
    assignmentDetails.textContent = assignmentTitle;
    assignmentTitleElem.textContent = assignmentTitle
    pageTitle.textContent = `QBase - ${assignmentTitle} - Q${qID + 1}`

    // Passage (text + image)
    const passageImgDiv = document.getElementById("passageImage");
    const passageDiv = document.getElementById("passageText");
    if (question.passage) {
      if (question.passageImage) {
        passageImgDiv.style.display = "block";
        const imgSrc = `./data/question_data/${aID}/${question.passageImage}`;
        passageImgDiv.innerHTML = `<img src="${imgSrc}" alt="Passage image" class="q-image" loading="lazy" decoding="async">`;
        passageImgDiv.querySelector("img").addEventListener("click", () => {
          showImageOverlay(imgSrc);
        });
      } else {
        passageImgDiv.style.display = "none";
        passageImgDiv.innerHTML = "";
      }
      passageDiv.style.display = "block";
      passageDiv.textContent = question.passage;
      try { renderMathInElement && renderMathInElement(passageDiv, katexOptions); } catch {}
    } else {
      passageImgDiv.style.display = "none";
      passageDiv.style.display = "none";
      passageImgDiv.innerHTML = "";
      passageDiv.innerHTML = "";
    }

    // Question image + text
    const qImgDiv = document.getElementById("questionImage");
    const qTextElm = document.getElementById("questionText");
    if (question.image) {
      qImgDiv.style.display = "block";
      let imgSrc = String(question.image || "");
      if (!/^https?:|^data:|^\/\//i.test(imgSrc)) {
        imgSrc = `./data/question_data/${aID}/${imgSrc}`;
      }
      qImgDiv.innerHTML = `<img src="${imgSrc}" alt="Question image" class="q-image" loading="lazy" decoding="async">`;
      qImgDiv.querySelector("img").addEventListener("click", () => {
        showImageOverlay(imgSrc);
      });
    } else {
      qImgDiv.style.display = "none";
      qImgDiv.innerHTML = "";
    }
    qTextElm.innerHTML = escapeHtml(question.qText || "").replace(/\n/g, "<br>");
    try { renderMathInElement && renderMathInElement(qTextElm, katexOptions); } catch {}

    // --- Timer control ---
    startQuestionTimer(qID);

    // Reset MCQ selection UI
    optionButtons.forEach((btn) => btn.classList.remove("mcq-option-selected"));
    if (question.qType === "SMCQ" && questionState.pickedAnswer) {
      const selBtn = optionButtons.find(
        (b) => b.dataset.opt === questionState.pickedAnswer
      );
      if (selBtn) selBtn.classList.add("mcq-option-selected");
    } else if (
      question.qType === "MMCQ" &&
      questionState.pickedAnswers.length
    ) {
      questionState.pickedAnswers.forEach((opt) => {
        const selBtn = optionButtons.find((b) => b.dataset.opt === opt);
        if (selBtn) selBtn.classList.add("mcq-option-selected");
      });
    }

    if (questionState.isAnswerEvaluated) {
      // Suppress animations when restoring evaluated state on navigation
      document.body.classList.add("suppress-eval-anim");
      try {
        if (question.qType === "SMCQ") {
          const correct = normalizeAnswer(question);
          const picked = getUserSelection(questionState, "SMCQ");
          clearMCQVisuals();
          applyMCQEvaluationStyles(correct, picked);
        } else if (question.qType === "MMCQ") {
          const correct = normalizeAnswer(question);
          const picked = getUserSelection(questionState, "MMCQ");
          clearMCQVisuals();
          applyMCQEvaluationStyles(correct, picked);
        } else if (question.qType === "Numerical") {
          const ans = normalizeAnswer(question);
          const user = getUserSelection(questionState, "Numerical");
          const isCorrect =
            typeof user === "number" && ans.valid && user === ans.value;
          applyNumericalEvaluationStyles(isCorrect);
          if (numericalAnswer)
            numericalAnswer.parentElement.style.display = "block";
        }
      } finally {
        // Remove on next tick to avoid triggering animations
        // Keep suppression while viewing an evaluated question
        // (Do not remove here; animations should only play on explicit check)
        // setTimeout(() => document.body.classList.remove("suppress-eval-anim"), 0);
      }
      showSolutionForQuestion(question);
    } else {
      // Not evaluated yet → ensure reset icon hidden
      document.body.classList.remove("suppress-eval-anim");
      const icon = document.getElementById("reset-question-icon");
      if (icon) icon.classList.add("d-none");
      hideSolutionPanel();
    }

    // Show numerical vs MCQ
    if (question.qType === "Numerical") {
      numericalAnswer.textContent = question.qAnswer;
      numerical.style.display = "block";
      MCQOptions.style.display = "none";
      numericalInput.value = questionStates[qID].pickedNumerical ?? "";
    } else {
      const A = document.getElementById("AContent");
      const B = document.getElementById("BContent");
      const C = document.getElementById("CContent");
      const D = document.getElementById("DContent");

      A.textContent = question.qOptions[0];
      B.textContent = question.qOptions[1];
      C.textContent = question.qOptions[2];
      D.textContent = question.qOptions[3];

      try {
        renderMathInElement && renderMathInElement(A, katexOptions);
        renderMathInElement && renderMathInElement(B, katexOptions);
        renderMathInElement && renderMathInElement(C, katexOptions);
        renderMathInElement && renderMathInElement(D, katexOptions);
      } catch {}

      numerical.style.display = "none";
      // Allow CSS to control the layout (grid on larger screens)
      MCQOptions.style.display = "";
      try { renderMathInElement && renderMathInElement(MCQOptions, katexOptions); } catch {}
    }

    // Trigger a quick enter animation on main question body and visible answer area
    try {
      const body = document.querySelector(".card.mb-4 .card-body");
      qReplayEnterAnim(body || document.querySelector(".card.mb-4"));
      if (question.qType === "Numerical") qReplayEnterAnim(numerical);
      else qReplayEnterAnim(MCQOptions);
    } catch {}

    // Toggle which action button to show for this question
    const checkBtn = document.getElementById("check-answer");
    const resetBtn = document.getElementById("reset-question");

    if (questionState.isAnswerEvaluated) {
      checkBtn.classList.add("d-none");
      resetBtn.classList.remove("d-none");
      applyResetCooldownState(questionState);
    } else {
      resetBtn.classList.add("d-none");
      resetBtn.disabled = false;
      clearResetCooldownTimer();
      questionState.resetLockedUntil = 0;
      checkBtn.classList.remove("d-none");
    }

    // Populate notes for this question (Markdown editor)
    try {
      setNotesInEditor(questionState.notes || "");
    } catch {}

    // Update bookmark button state
    updateBookmarkButton();
    // Update color picker selected state for current question
    updateColorPickerSelection();

    // Update prev/next button disabled state
    updateTopbarNavButtons();
  }

  // --- Bookmark functionality ---

  let currentBookmarks = [];
  let bookmarkTags = [];
  // Filters: selected tag ids and colors (lowercase hex or 'none')
  let activeTagFilters = new Set();
  let activeColorFilters = new Set();
  let filteredQuestionIDs = null; // null => no filter; else Array of display indices

  async function updateBookmarkButton() {
    const bookmarkBtn = document.getElementById("bookmark-btn");
    const icon = bookmarkBtn.querySelector("i");

    try {
      // Use original question index (not display index) for bookmark lookups
      const originalIdx = window.questionIndexMap[currentQuestionID];
      const response = await authFetch(
        `${API_BASE}/api/bookmarks/${aID}/${originalIdx}`
      );
      if (response.ok) {
        currentBookmarks = await response.json();
        if (currentBookmarks.length > 0) {
          bookmarkBtn.classList.remove("btn-outline-primary");
          bookmarkBtn.classList.add("btn-primary");
          icon.className = "bi bi-bookmark-fill";
          bookmarkBtn.title = `Bookmarked with ${currentBookmarks.length} tag(s)`;
        } else {
          bookmarkBtn.classList.remove("btn-primary");
          bookmarkBtn.classList.add("btn-outline-primary");
          icon.className = "bi bi-bookmark";
          bookmarkBtn.title = "Bookmark this question";
        }
        // refresh small badges on circles as well
        updateBookmarkIndicators();
      }
    } catch (error) {
      console.error("Failed to update bookmark button:", error);
    }
  }

  async function showBookmarkDialog() {
    try {
      const response = await authFetch(`${API_BASE}/api/bookmark-tags`);
      if (!response.ok) {
        if (response.status === 401) {
          window.dispatchEvent(new Event("qbase:logout"));
          return;
        }
        throw new Error(`HTTP ${response.status}`);
      }
      bookmarkTags = await response.json();


      // Create dialog content
      const currentTagIds = currentBookmarks.map((b) => b.tagId);
      const availableTags = bookmarkTags.filter(
        (tag) => !currentTagIds.includes(tag.id)
      );

      let bodyHTML = "";

      if (currentBookmarks.length > 0) {
        bodyHTML += '<div class="mb-3"><strong>Current bookmarks:</strong><br>';
        for (const bookmark of currentBookmarks) {
          const tag = bookmarkTags.find((t) => t.id === bookmark.tagId);
          if (tag) {
            bodyHTML += `
            <div class="d-flex justify-content-between align-items-center mb-1">
              <span class="badge bg-primary">${escapeHtml(tag.name)}</span>
              <button class="btn btn-sm btn-outline-danger remove-bookmark-btn" 
                      data-tag-id="${tag.id}">
                <i class="bi bi-x"></i>
              </button>
            </div>
          `;
          }
        }
        bodyHTML += "</div>";
      }

      if (availableTags.length > 0) {
        bodyHTML += '<div class="mb-3"><strong>Add to tag:</strong><br>';
        for (const tag of availableTags) {
          bodyHTML += `
          <button class="btn btn-outline-primary btn-sm me-2 mb-1 add-bookmark-btn" 
                  data-tag-id="${tag.id}">
            ${escapeHtml(tag.name)}
          </button>
        `;
        }
        bodyHTML += "</div>";
      }

      bodyHTML += `
      <div class="mb-3">
        <strong>Create new tag:</strong>
        <div class="input-group mt-2">
          <input type="text" class="form-control" id="new-tag-input" placeholder="Enter tag name...">
          <button class="btn btn-outline-success" id="create-tag-btn">
            <i class="bi bi-plus"></i>
          </button>
        </div>
      </div>
    `;

      // Show modal with onContentReady callback to attach event listeners
      const modal = await showModal({
        title: "Bookmark Question",
        bodyHTML: bodyHTML,
        buttons: [
          { text: "Close", className: "btn btn-secondary", value: "close" },
        ],
        onContentReady: (modalEl) => {
          // Add event listeners to modal content
          const modalBody = modalEl.querySelector("#qbaseModalBody");

          // Remove bookmark buttons
          modalBody.querySelectorAll(".remove-bookmark-btn").forEach((btn) => {
            btn.addEventListener("click", async () => {
              const tagId = btn.dataset.tagId;
              if (await removeBookmark(tagId)) {
                updateBookmarkButton();
                refreshBookmarkDialog(modalEl); // Refresh current modal content
              }
            });
          });

          // Add bookmark buttons
          modalBody.querySelectorAll(".add-bookmark-btn").forEach((btn) => {
            btn.addEventListener("click", async () => {
              const tagId = btn.dataset.tagId;
              if (await addBookmark(tagId)) {
                updateBookmarkButton();
                refreshBookmarkDialog(modalEl); // Refresh current modal content
              }
            });
          });

          // Create new tag
          const createTagBtn = modalBody.querySelector("#create-tag-btn");
          const newTagInput = modalBody.querySelector("#new-tag-input");


          createTagBtn.addEventListener("click", async () => {
            const tagName = newTagInput.value.trim();
            if (tagName) {
              if (await createBookmarkTag(tagName)) {
                updateBookmarkButton();
                refreshBookmarkDialog(modalEl); // Refresh current modal content
              }
            }
          });

          newTagInput.addEventListener("keydown", async (e) => {
            if (e.key === "Enter") {
              const tagName = newTagInput.value.trim();
              if (tagName) {
                if (await createBookmarkTag(tagName)) {
                  updateBookmarkButton();
                  refreshBookmarkDialog(modalEl); // Refresh current modal content
                }
              }
            }
          });
        },
      });
    } catch (error) {
      console.error("Failed to show bookmark dialog:", error);
      await showNotice({
        title: "Error",
        message: "Failed to load bookmark options",
      });
    }
  }

  // Helper function to refresh the bookmark dialog content in-place
  async function refreshBookmarkDialog(modalEl) {
    try {
      // Reload bookmark tags and current bookmarks
      const response = await authFetch(`${API_BASE}/api/bookmark-tags`);
      if (!response.ok) {
        if (response.status === 401) {
          window.dispatchEvent(new Event("qbase:logout"));
          return;
        }
        throw new Error(`HTTP ${response.status}`);
      }
      bookmarkTags = await response.json();

      // Reload current bookmarks for this question
      // Use original question index for current question
      const originalIdx = window.questionIndexMap[currentQuestionID];
      const bookmarkResponse = await authFetch(
        `${API_BASE}/api/bookmarks/${aID}/${originalIdx}`
      );
      if (bookmarkResponse.ok) {
        currentBookmarks = await bookmarkResponse.json();
      } else {
        currentBookmarks = [];
      }

      // Create updated dialog content
      const currentTagIds = currentBookmarks.map((b) => b.tagId);
      const availableTags = bookmarkTags.filter(
        (tag) => !currentTagIds.includes(tag.id)
      );

      let bodyHTML = "";

      if (currentBookmarks.length > 0) {
        bodyHTML += '<div class="mb-3"><strong>Current bookmarks:</strong><br>';
        for (const bookmark of currentBookmarks) {
          const tag = bookmarkTags.find((t) => t.id === bookmark.tagId);
          if (tag) {
            bodyHTML += `
            <div class="d-flex justify-content-between align-items-center mb-1">
              <span class="badge bg-primary">${escapeHtml(tag.name)}</span>
              <button class="btn btn-sm btn-outline-danger remove-bookmark-btn" 
                      data-tag-id="${tag.id}">
                <i class="bi bi-x"></i>
              </button>
            </div>
          `;
          }
        }
        bodyHTML += "</div>";
      }

      if (availableTags.length > 0) {
        bodyHTML += '<div class="mb-3"><strong>Add to tag:</strong><br>';
        for (const tag of availableTags) {
          bodyHTML += `
          <button class="btn btn-outline-primary btn-sm me-2 mb-1 add-bookmark-btn" 
                  data-tag-id="${tag.id}">
            ${escapeHtml(tag.name)}
          </button>
        `;
        }
        bodyHTML += "</div>";
      }

      bodyHTML += `
      <div class="mb-3">
        <strong>Create new tag:</strong>
        <div class="input-group mt-2">
          <input type="text" class="form-control" id="new-tag-input" placeholder="Enter tag name...">
          <button class="btn btn-outline-success" id="create-tag-btn">
            <i class="bi bi-plus"></i>
          </button>
        </div>
      </div>
    `;

      // Update the modal content
      const modalBody = modalEl.querySelector("#qbaseModalBody");
      modalBody.innerHTML = bodyHTML;

      // Re-attach event listeners to the new content
      // Remove bookmark buttons
      modalBody.querySelectorAll(".remove-bookmark-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const tagId = btn.dataset.tagId;
          if (await removeBookmark(tagId)) {
            updateBookmarkButton();
            refreshBookmarkDialog(modalEl); // Refresh current modal content
          }
        });
      });

      // Add bookmark buttons
      modalBody.querySelectorAll(".add-bookmark-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const tagId = btn.dataset.tagId;
          if (await addBookmark(tagId)) {
            updateBookmarkButton();
            refreshBookmarkDialog(modalEl); // Refresh current modal content
          }
        });
      });

      // Create new tag
      const createTagBtn = modalBody.querySelector("#create-tag-btn");
      const newTagInput = modalBody.querySelector("#new-tag-input");


      createTagBtn.addEventListener("click", async () => {
        const tagName = newTagInput.value.trim();
        if (tagName) {
          if (await createBookmarkTag(tagName)) {
            updateBookmarkButton();
            refreshBookmarkDialog(modalEl); // Refresh current modal content
          }
        }
      });

      newTagInput.addEventListener("keydown", async (e) => {
        if (e.key === "Enter") {
          const tagName = newTagInput.value.trim();
          if (tagName) {
            if (await createBookmarkTag(tagName)) {
              updateBookmarkButton();
              refreshBookmarkDialog(modalEl); // Refresh current modal content
            }
          }
        }
      });
    } catch (error) {
      console.error("Failed to refresh bookmark dialog:", error);
    }
  }

  async function addBookmark(tagId) {
    try {
      const response = await authFetch(`${API_BASE}/api/bookmarks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignmentId: aID,
          // Persist original index from assignment.json
          questionIndex: window.questionIndexMap[currentQuestionID],
          tagId: tagId,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to add bookmark");
      }

      // Update badges across question circles
      updateBookmarkIndicators();
      return true;
    } catch (error) {
      console.error("Failed to add bookmark:", error);
      await showNotice({
        title: "Error",
        message: error.message || "Failed to add bookmark",
      });
      return false;
    }
  }

  async function removeBookmark(tagId) {
    try {
      // Remove by original index
      const originalIdx = window.questionIndexMap[currentQuestionID];
      const response = await authFetch(
        `${API_BASE}/api/bookmarks/${aID}/${originalIdx}/${tagId}`,
        {
          method: "DELETE",
        }
      );

      if (!response.ok) {
        throw new Error("Failed to remove bookmark");
      }

      // Update badges across question circles
      updateBookmarkIndicators();
      return true;
    } catch (error) {
      console.error("Failed to remove bookmark:", error);
      await showNotice({
        title: "Error",
        message: "Failed to remove bookmark",
      });
      return false;
    }
  }

  async function createBookmarkTag(tagName) {
    try {
      const response = await authFetch(`${API_BASE}/api/bookmark-tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: tagName }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create tag");
      }

      const newTag = await response.json();

      // Automatically add bookmark to the new tag
      const ok = await addBookmark(newTag.id);
      if (ok) updateBookmarkIndicators();
      return ok;
    } catch (error) {
      console.error("Failed to create bookmark tag:", error);
      await showNotice({
        title: "Error",
        message: error.message || "Failed to create tag",
      });
      return false;
    }
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  // ---------- Solution helpers ----------
  function resolveAssetUrl(pathStr) {
    try {
      const raw = String(pathStr || "").trim();
      if (!raw) return "";
      if (/^(https?:)?\/\//i.test(raw)) return raw;
      if (/^data:/i.test(raw)) return raw;
      if (raw.startsWith("/")) return raw;
      return `./data/question_data/${aID}/${raw}`;
    } catch {
      return "";
    }
  }

  function getSolutionParts(question) {
    if (!question || typeof question !== "object")
      return { text: "", image: "" };
    const sol = question.solution || {};
    const text =
      question.sText ||
      question.solutionText ||
      question.solutionText ||
      sol.sText ||
      sol.text ||
      sol.body ||
      "";
    const image =
      question.sImage ||
      question.solutionImage ||
      question.solutionImage ||
      sol.sImage ||
      sol.image ||
      sol.img ||
      "";
    return {
      text: typeof text === "string" ? text.trim() : "",
      image: typeof image === "string" ? image.trim() : "",
    };
  }

  function hideSolutionPanel() {
    const host = document.getElementById("solutionSection");
    const textEl = document.getElementById("solutionText");
    const imgWrap = document.getElementById("solutionImage");
    if (host) host.style.display = "none";
    if (textEl) textEl.innerHTML = "";
    if (imgWrap) {
      imgWrap.style.display = "none";
      imgWrap.innerHTML = "";
    }
  }

  function showSolutionForQuestion(question) {
    const host = document.getElementById("solutionSection");
    const textEl = document.getElementById("solutionText");
    const imgWrap = document.getElementById("solutionImage");
    if (!host || !textEl || !imgWrap) return;
    const { text, image } = getSolutionParts(question);
    const hasText = !!text;
    const hasImage = !!image;

    if (hasText) {
      renderHTML(textEl, text);
      try {
        renderMathInElement && renderMathInElement(textEl, katexOptions);
      } catch {}
    } else {
      textEl.innerHTML = "";
    }

    if (hasImage) {
      const imgSrc = resolveAssetUrl(image);
      imgWrap.style.display = "";
      imgWrap.innerHTML = `<img src="${imgSrc}" alt="Solution image" class="q-image" loading="lazy" decoding="async">`;
      try {
        imgWrap
          .querySelector("img")
          .addEventListener("click", () => showImageOverlay(imgSrc));
      } catch {}
    } else {
      imgWrap.style.display = "none";
      imgWrap.innerHTML = "";
    }

    host.style.display = hasText || hasImage ? "" : "none";
  }

  // Sanitize limited HTML so solution content renders safely.
  function sanitizeHtml(html) {
    try {
      if (
        typeof window !== "undefined" &&
        window.DOMPurify &&
        typeof window.DOMPurify.sanitize === "function"
      ) {
        const MATHML_TAGS = [
          "math",
          "mrow",
          "mi",
          "mn",
          "mo",
          "ms",
          "mtext",
          "mspace",
          "msub",
          "msup",
          "msubsup",
          "munder",
          "mover",
          "munderover",
          "mfrac",
          "msqrt",
          "mroot",
          "mfenced",
          "menclose",
          "mpadded",
          "mphantom",
          "mstyle",
          "mtable",
          "mtr",
          "mtd",
          "mlabeledtr",
          "semantics",
          "annotation",
          "annotation-xml",
        ];
        const ALLOWED_TAGS = [
          "b",
          "i",
          "em",
          "strong",
          "u",
          "sup",
          "sub",
          "br",
          "p",
          "ul",
          "ol",
          "li",
          "span",
          "div",
          "img",
          "a",
          "code",
          "pre",
          "blockquote",
          "hr",
          "table",
          "thead",
          "tbody",
          "tr",
          "td",
          "th",
          ...MATHML_TAGS,
        ];
        const ALLOWED_ATTR = [
          "class",
          "style",
          "href",
          "src",
          "alt",
          "title",
          "width",
          "height",
          "loading",
          "decoding",
          "rel",
          "target",
          "display",
          "mathvariant",
          "mathsize",
          "open",
          "close",
          "separators",
          "notation",
          "rowalign",
          "columnalign",
          "rowspan",
          "columnspan",
          "fence",
          "form",
          "accent",
          "accentunder",
          "displaystyle",
          "scriptlevel",
        ];
        return window.DOMPurify.sanitize(String(html || ""), {
          ALLOWED_TAGS,
          ALLOWED_ATTR,
          FORBID_TAGS: [
            "script",
            "style",
            "iframe",
            "object",
            "embed",
            "link",
            "meta",
            "form",
            "svg",
          ],
          ADD_ATTR: ["aria-label", "role"],
        });
      }
    } catch {}

    try {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = String(html || "");
      const disallowed = new Set([
        "SCRIPT",
        "STYLE",
        "IFRAME",
        "OBJECT",
        "EMBED",
        "LINK",
        "META",
        "FORM",
        "SVG",
      ]);
      (function walk(node) {
        const children = Array.from(node.childNodes || []);
        for (const child of children) {
          if (child.nodeType === 1) {
            if (disallowed.has(child.nodeName)) {
              child.remove();
              continue;
            }
            for (const attr of Array.from(child.attributes || [])) {
              const name = attr.name.toLowerCase();
              const val = String(attr.value || "");
              if (name.startsWith("on")) child.removeAttribute(attr.name);
              if (name === "style") {
                child.removeAttribute(attr.name);
                continue;
              }
              if (name === "href" || name === "src" || name === "xlink:href") {
                if (/^\s*javascript:/i.test(val)) child.removeAttribute(attr.name);
                if (/^\s*data:text\//i.test(val)) child.removeAttribute(attr.name);
              }
            }
            if (child.nodeName.toLowerCase() === "a") {
              try {
                const t = (child.getAttribute("target") || "").toLowerCase();
                if (t.includes("_blank"))
                  child.setAttribute("rel", "noopener noreferrer");
                const href = child.getAttribute("href") || "";
                if (!/^(https?:|mailto:|#|\/|\/\/|data:image)/i.test(href))
                  child.removeAttribute("href");
              } catch {}
            }
          }
          walk(child);
        }
      })(wrapper);
      return wrapper.innerHTML;
    } catch {
      return escapeHtml(String(html || ""));
    }
  }

  // Render HTML or plain text with newline preservation; normalizes CRLF
  // Additionally: make any <img> inside clickable to open the image overlay
  function renderHTML(el, value) {
    try {
      const raw = String(value || "")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        // Normalize any HTML <br> tags to newlines so KaTeX delimiters stay intact
        .replace(/<br\s*\/?>/gi, "\n");
      const sanitized = sanitizeHtml(raw);
      el.innerHTML = sanitized;
      if (!el.dataset.imgOverlayBound) {
        el.addEventListener("click", (ev) => {
          const target = ev.target;
          if (!target) return;
          const img = target.closest && target.closest("img");
          if (img && img.src) {
            try {
              ev.preventDefault();
              ev.stopPropagation();
            } catch {}
            try {
              if (typeof showImageOverlay === "function")
                showImageOverlay(img.src);
            } catch {}
          }
        });
        el.dataset.imgOverlayBound = "1";
      }
      el.querySelectorAll("img").forEach((img) => {
        try {
          img.style.cursor = "zoom-in";
        } catch {}
      });
    } catch {
      el.textContent = String(value || "");
    }
  }
  
  // -------------------- UI toggles: Questions sidebar and desktop Q-bar --------------------
  try {
    const btnSidebar = document.getElementById("toggle-questions");
    const btnQbar = document.getElementById("toggle-qbar");

    const LS_SIDEBAR = "qbase.assignment.sidebarVisible";
    const LS_QBAR = "qbase.assignment.desktopQbar";

    const isDesktop = () => window.matchMedia("(min-width: 992px)").matches;

    function getBool(key, fallback) {
      const raw = localStorage.getItem(key);
      if (raw === null || raw === undefined) return fallback;
      return raw === "1" || raw === "true";
    }

    function setBool(key, value) {
      localStorage.setItem(key, value ? "1" : "0");
    }

    function applySidebarVisible(visible) {
      document.body.classList.toggle("questions-hidden", !visible);
      if (btnSidebar) btnSidebar.classList.toggle("active", visible);
    }

    function applyDesktopQbar(enabled) {
      document.body.classList.toggle("desktop-qbar-visible", enabled);
      if (btnQbar) btnQbar.classList.toggle("active", enabled);
    }

    // Initial state (default: sidebar visible on desktop; desktop Qbar off)
    const sidebarDefault = true;
    const qbarDefault = false;
    applySidebarVisible(getBool(LS_SIDEBAR, sidebarDefault));
    applyDesktopQbar(getBool(LS_QBAR, qbarDefault));

    // Wire events
    btnSidebar?.addEventListener("click", () => {
      const currentlyVisible = !document.body.classList.contains("questions-hidden");
      const next = !currentlyVisible;
      applySidebarVisible(next);
      setBool(LS_SIDEBAR, next);
    });

    btnQbar?.addEventListener("click", () => {
      const enabled = !document.body.classList.contains("desktop-qbar-visible");
      applyDesktopQbar(enabled);
      setBool(LS_QBAR, enabled);
    });

    // Keep classes consistent on viewport changes
    window.addEventListener("resize", () => {
      // No-op for now; classes are responsive via CSS media queries
      // But ensure button active states sync from storage if needed
      applySidebarVisible(getBool(LS_SIDEBAR, sidebarDefault));
      applyDesktopQbar(getBool(LS_QBAR, qbarDefault));
    });
  } catch (e) {
    console.warn("Toggle wiring failed", e);
  }

  // -------------------- Topbar question navigation --------------------
  function updateTopbarNavButtons() {
    const prev = document.getElementById("nav-prev");
    const next = document.getElementById("nav-next");
    if (!prev || !next || currentQuestionID == null) return;
    const filtered = getActiveFilteredIDs();
    const pos = filtered.indexOf(Number(currentQuestionID));
    const last = filtered.length - 1;
    prev.disabled = pos <= 0;
    next.disabled = pos < 0 || pos >= last;
  }

  // Wire prev/next click handlers
  (function wireTopbarNav() {
    const prev = document.getElementById("nav-prev");
    const next = document.getElementById("nav-next");
    if (prev) prev.addEventListener("click", () => {
      if (currentQuestionID == null) return;
      const filtered = getActiveFilteredIDs();
      const pos = filtered.indexOf(Number(currentQuestionID));
      if (pos > 0) clickQuestionButton(filtered[pos - 1]);
    });
    if (next) next.addEventListener("click", () => {
      if (currentQuestionID == null) return;
      const filtered = getActiveFilteredIDs();
      const pos = filtered.indexOf(Number(currentQuestionID));
      if (pos >= 0 && pos < filtered.length - 1) clickQuestionButton(filtered[pos + 1]);
    });
    updateTopbarNavButtons();
  })();
  
  // ---------- Bookmark badges on question circles ----------
  async function updateBookmarkIndicators() {
    try {
      // Fetch all bookmarks and filter to current assignment
      const res = await authFetch(`${API_BASE}/api/bookmarks`, { cache: "no-store" });
      if (!res.ok) {
        // On unauthorized, hide all indicators
        questionButtons?.forEach((btn) => {
          btn.querySelectorAll('.q-bookmark-indicator').forEach((el) => el.classList.add('hidden'));
        });
        return;
      }
      const all = await res.json();
      const mine = Array.isArray(all)
        ? all.filter((b) => Number(b.assignmentId) === Number(aID))
        : [];
      const bookmarkedOriginalIdx = new Set(
        mine.map((b) => Number(b.questionIndex))
      );

      const qMap = window.questionIndexMap || [];
      questionButtons?.forEach((btn) => {
        const idx = Number(btn.dataset.qid);
        const orig = qMap[idx];
        let ind = btn.querySelector('.q-bookmark-indicator');
        if (!ind) {
          ind = document.createElement('span');
          ind.className = 'q-bookmark-indicator hidden';
          ind.innerHTML = '<i class="bi bi-bookmark-fill" aria-hidden="true"></i>';
          btn.appendChild(ind);
        }
        if (bookmarkedOriginalIdx.has(Number(orig))) ind.classList.remove('hidden');
        else ind.classList.add('hidden');
      });
    } catch (err) {
      console.warn('updateBookmarkIndicators failed', err);
    }
  }

  // --- Question color mark helpers ---
  async function setQuestionColor(color) {
    try {
      const originalIdx = window.questionIndexMap[currentQuestionID];
      const response = await authFetch(`${API_BASE}/api/question-marks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignmentId: aID, questionIndex: originalIdx, color })
      });
      if (!response.ok) throw new Error('Failed to set color');
      updateColorIndicators();
      return true;
    } catch (e) {
      console.error('Failed to set question color:', e);
      return false;
    }
  }

  async function clearQuestionColor() {
    try {
      const originalIdx = window.questionIndexMap[currentQuestionID];
      const response = await authFetch(`${API_BASE}/api/question-marks/${aID}/${originalIdx}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to clear color');
      return true;
    } catch (e) {
      console.error('Failed to clear question color:', e);
      return false;
    }
  }

  async function updateColorPickerSelection() {
    try {
      const picker = document.getElementById('qcolor-picker');
      if (!picker) return;
      const chips = Array.from(picker.querySelectorAll('.qcolor-chip'));
      if (currentQuestionID == null) return;
      const originalIdx = window.questionIndexMap[currentQuestionID];
      let sel = 'none';
      try {
        const res = await authFetch(`${API_BASE}/api/question-marks/${aID}/${originalIdx}`);
        if (res.ok) {
          const data = await res.json();
          const color = (data?.color || '').trim().toLowerCase();
          sel = color || 'none';
        }
      } catch {}
      chips.forEach((c) => {
        const val = String(c.getAttribute('data-color') || '').trim().toLowerCase();
        c.classList.toggle('selected', val === sel);
      });
    } catch (e) {
      // ignore
    }
  }

  // ---------- Color badges on question circles ----------
  async function updateColorIndicators() {
    try {
      const res = await authFetch(`${API_BASE}/api/question-marks`, { cache: "no-store" });
      if (!res.ok) {
        questionButtons?.forEach((btn) => {
          btn.querySelectorAll('.q-color-indicator').forEach((el) => el.classList.add('hidden'));
        });
        return;
      }
      const all = await res.json();
      const mine = Array.isArray(all)
        ? all.filter((m) => Number(m.assignmentId) === Number(aID))
        : [];
      const byIdx = new Map();
      for (const m of mine) byIdx.set(Number(m.questionIndex), String(m.color));

      const qMap = window.questionIndexMap || [];
      questionButtons?.forEach((btn) => {
        const idx = Number(btn.dataset.qid);
        const orig = qMap[idx];
        let el = btn.querySelector('.q-color-indicator');
        if (!el) {
          el = document.createElement('span');
          el.className = 'q-color-indicator hidden';
          btn.appendChild(el);
        }
        const color = byIdx.get(Number(orig));
        if (color) {
          el.style.backgroundColor = color;
          el.classList.remove('hidden');
        } else {
          el.classList.add('hidden');
          try { el.style.removeProperty('background-color'); } catch {}
        }
      });
    } catch (err) {
      console.warn('updateColorIndicators failed', err);
    }
  }

  // Refresh badges on login/logout
  window.addEventListener('qbase:login', () => { updateBookmarkIndicators(); updateColorIndicators(); updateColorPickerSelection(); });
      window.addEventListener('qbase:logout', () => {
        questionButtons?.forEach((btn) => {
          btn.querySelectorAll('.q-bookmark-indicator').forEach((el) => el.classList.add('hidden'));
          btn.querySelectorAll('.q-color-indicator').forEach((el) => el.classList.add('hidden'));
        });
      });

      // ---------- Color hotkeys (configurable) ----------
      (function wireColorHotkeys() {
        function isTypingContext() {
          const ae = document.activeElement; if (!ae) return false;
          const tag = (ae.tagName || '').toLowerCase();
          if (tag === 'input' || tag === 'textarea') return true;
          if (ae.isContentEditable) return true;
          return false;
        }
        function overlayOpen() {
          const el = document.getElementById('image-overlay');
          if (!el) return false; const s = getComputedStyle(el); return s.display !== 'none';
        }
        const COLOR_VALUES = {
          blue: '#0d6efd',
          red: '#dc3545',
          yellow: '#ffc107',
          green: '#198754',
          clear: 'none',
        };
        const getHK = () => { try { return window.qbGetHotkeys ? window.qbGetHotkeys() : null; } catch { return null; } };
        window.addEventListener('keydown', async (e) => {
          try {
            if (overlayOpen()) return;
            if (isTypingContext()) return;
            const matches = (arr) => (window.qbMatches && getHK() && arr) ? window.qbMatches(e, arr) : false;
            let action = null;
            if (matches(getHK()?.colorBlue)) action = 'blue';
            else if (matches(getHK()?.colorRed)) action = 'red';
            else if (matches(getHK()?.colorYellow)) action = 'yellow';
            else if (matches(getHK()?.colorGreen)) action = 'green';
            else if (matches(getHK()?.colorClear)) action = 'clear';

            // Fallback: accept Alt+Digit (1..5) and Ctrl+Alt+Digit in case
            // hotkey config isn’t available yet or user expects legacy mapping.
            if (!action) {
              if (e.altKey && !e.metaKey) {
                let d = null;
                if (typeof e.code === 'string' && /^Digit[1-5]$/.test(e.code)) d = e.code.slice(5);
                else if (typeof e.key === 'string' && '12345'.includes(e.key)) d = e.key;
                if (d) {
                  if (d === '1') action = 'blue';
                  else if (d === '2') action = 'red';
                  else if (d === '3') action = 'yellow';
                  else if (d === '4') action = 'green';
                  else if (d === '5') action = 'clear';
                }
              }
            }
            if (!action) return;
            e.preventDefault();
            if (currentQuestionID == null) return;
            const val = COLOR_VALUES[action];
            let ok = true;
            if (val === 'none') ok = await clearQuestionColor(); else ok = await setQuestionColor(val);
            if (ok) { try { updateColorIndicators(); } catch {} try { updateColorPickerSelection(); } catch {} }
          } catch {}
        });
      })();

      // -------------------- Filter UI (tags + colors) --------------------
      function setupFilterDropdown() {
    const btn = document.getElementById('filter-btn');
    const tagsHost = document.getElementById('filter-tags');
    const colorsHost = document.getElementById('filter-colors');
    const applyBtn = document.getElementById('filter-apply');
    const clearBtn = document.getElementById('filter-clear');
    if (!btn || !tagsHost || !colorsHost || !applyBtn || !clearBtn) return;

    // Populate on dropdown show to keep fresh
    btn.addEventListener('shown.bs.dropdown', async () => {
      await populateFilterTags(tagsHost);
      populateFilterColors(colorsHost);
    });

    applyBtn.addEventListener('click', async () => {
      // Read selected tags
      activeTagFilters = new Set(Array.from(tagsHost.querySelectorAll('input[type="checkbox"][data-tag-id]:checked')).map((el) => el.getAttribute('data-tag-id')));
      // Read selected colors
      activeColorFilters = new Set(Array.from(colorsHost.querySelectorAll('.filter-color-chip.selected')).map((el) => String(el.getAttribute('data-color') || '').toLowerCase()));
      await applyQuestionFilters();
      // Mark button active state
      const active = activeTagFilters.size > 0 || activeColorFilters.size > 0;
      btn.classList.toggle('btn-primary', active);
      btn.classList.toggle('btn-outline-secondary', !active);
      // Close dropdown
      try { bootstrap.Dropdown.getInstance(btn)?.hide(); } catch {}
    });

    clearBtn.addEventListener('click', async () => {
      activeTagFilters.clear();
      activeColorFilters.clear();
      // Reset UI state in dropdown
      try {
        tagsHost.querySelectorAll('input[type="checkbox"]').forEach((el) => (el.checked = false));
        colorsHost.querySelectorAll('.filter-color-chip').forEach((el) => el.classList.remove('selected'));
      } catch {}
      await applyQuestionFilters();
      btn.classList.remove('btn-primary');
      btn.classList.add('btn-outline-secondary');
      try { bootstrap.Dropdown.getInstance(btn)?.hide(); } catch {}
    });
  }

  async function populateFilterTags(host) {
    try {
      const res = await authFetch(`${API_BASE}/api/bookmark-tags`);
      if (!res.ok) { host.innerHTML = '<div class="text-muted small">Sign in to use tags</div>'; return; }
      const tags = await res.json();
      const items = tags.map(t => {
        const id = `ftag-${t.id}`;
        const checked = activeTagFilters.has(String(t.id)) ? 'checked' : '';
        const name = escapeHtml(t.name);
        return `<div class="form-check form-check-sm">
          <input class="form-check-input" type="checkbox" id="${id}" data-tag-id="${t.id}" ${checked}>
          <label class="form-check-label" for="${id}">${name}</label>
        </div>`;
      }).join('');
      host.innerHTML = items || '<div class="text-muted small">No tags yet</div>';
    } catch (e) {
      host.innerHTML = '<div class="text-muted small">Failed to load tags</div>';
    }
  }

  function populateFilterColors(host) {
    const colors = [
      { color: 'none', label: 'None' },
      { color: '#0d6efd', label: 'Blue' },
      { color: '#dc3545', label: 'Red' },
      { color: '#ffc107', label: 'Yellow' },
      { color: '#198754', label: 'Green' },
    ];
    host.innerHTML = colors.map(c => {
      const selected = activeColorFilters.has(c.color.toLowerCase()) ? 'selected' : '';
      const style = c.color === 'none' ? '' : `style="--qc:${c.color}"`;
      return `<button type="button" class="filter-color-chip ${selected}" data-color="${c.color}" ${style} title="${c.label}"></button>`;
    }).join('');
    host.querySelectorAll('.filter-color-chip').forEach((el) => {
      el.addEventListener('click', () => {
        el.classList.toggle('selected');
      });
    });
  }

  async function applyQuestionFilters() {
    try {
      // If no selections, show all
      const hasTag = activeTagFilters.size > 0;
      const hasColor = activeColorFilters.size > 0;
      if (!hasTag && !hasColor) {
        filteredQuestionIDs = null;
        // show all buttons
        questionButtons?.forEach((btn) => btn.classList.remove('d-none'));
        updateTopbarNavButtons();
        return;
      }

      // Build tag map and color map
      const [bmRes, cmRes] = await Promise.all([
        authFetch(`${API_BASE}/api/bookmarks`, { cache: 'no-store' }),
        authFetch(`${API_BASE}/api/question-marks`, { cache: 'no-store' }),
      ]);
      let byQTags = new Map(); // origIdx -> Set(tagId)
      if (bmRes.ok) {
        const all = await bmRes.json();
        const mine = Array.isArray(all) ? all.filter(b => Number(b.assignmentId) === Number(aID)) : [];
        for (const b of mine) {
          const key = Number(b.questionIndex);
          if (!byQTags.has(key)) byQTags.set(key, new Set());
          byQTags.get(key).add(String(b.tagId));
        }
      }
      let byQColor = new Map(); // origIdx -> color (lower)
      if (cmRes.ok) {
        const all = await cmRes.json();
        const mine = Array.isArray(all) ? all.filter(m => Number(m.assignmentId) === Number(aID)) : [];
        for (const m of mine) {
          byQColor.set(Number(m.questionIndex), String(m.color || '').trim().toLowerCase());
        }
      }

      const qMap = window.questionIndexMap || [];
      const total = window.displayQuestions?.length || 0;
      const keep = [];
      for (let i = 0; i < total; i++) {
        const orig = qMap[i];
        let ok = false;
        if (hasTag) {
          const tags = byQTags.get(Number(orig));
          if (tags) for (const t of activeTagFilters) { if (tags.has(String(t))) { ok = true; break; } }
        }
        if (hasColor && !ok) {
          const col = (byQColor.get(Number(orig)) || '').toLowerCase();
          if (activeColorFilters.has('none') && !col) ok = true;
          if (!ok && col && activeColorFilters.has(col)) ok = true;
        }
        if (ok) keep.push(i);
      }
      filteredQuestionIDs = keep;

      // Apply to UI
      const keepSet = new Set(keep);
      questionButtons?.forEach((btn) => {
        const idx = Number(btn.dataset.qid);
        const show = keepSet.has(idx);
        if (show) btn.classList.remove('d-none');
        else btn.classList.add('d-none');
        const p = btn.parentElement;
        if (p && p.classList && p.classList.contains('col')) {
          if (show) p.classList.remove('d-none');
          else p.classList.add('d-none');
        }
      });

      // If current question is filtered out, jump to first kept
      if (currentQuestionID != null && !keepSet.has(currentQuestionID) && keep.length > 0) {
        clickQuestionButton(keep[0]);
      }
      updateTopbarNavButtons();
    } catch (e) {
      console.warn('applyQuestionFilters failed', e);
    }
  }

  function getActiveFilteredIDs() {
    if (Array.isArray(filteredQuestionIDs) && filteredQuestionIDs.length > 0) return filteredQuestionIDs;
    // default: all indices
    const n = window.displayQuestions?.length || 0;
    return Array.from({ length: n }, (_, i) => i);
  }
})();
  // --- Question font size slider (question + options only) ---
  (function initQAFontSlider() {
    const slider = document.getElementById("qa-font-range");
    if (!slider) return;
    const LS_KEY = "qbase:qa-scale";
    const applyScale = (scale) => {
      const clamped = Math.min(1.6, Math.max(0.6, scale));
      document.documentElement.style.setProperty("--qa-scale", String(clamped));
    };
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) {
        const pct = Math.round(parseFloat(saved) * 100);
        if (!Number.isNaN(pct)) slider.value = String(pct);
        applyScale(parseFloat(saved));
      }
    } catch {}
    slider.addEventListener("input", () => {
      const pct = Number(slider.value || 100);
      const scale = pct / 100;
      applyScale(scale);
    });
    slider.addEventListener("change", () => {
      const pct = Number(slider.value || 100);
      const scale = pct / 100;
      try { localStorage.setItem(LS_KEY, String(scale)); } catch {}
    });
  })();
