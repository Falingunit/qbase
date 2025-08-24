(async () => {

  isDev = false;

  if (window.__QBASE_NAVBAR_LOADED__) {
    console.warn("navbar.js loaded twice; ignoring second load");
    return;
  }
  window.__QBASE_NAVBAR_LOADED__ = true;

  await loadConfig();

  window.addEventListener("qbase:login", (e) => {
    isAuthenticated = true; // <-- make other instances aware
    const name = e?.detail?.username;
    if (name) setLoggedInUI(name); // sync navbar if this instance missed it
    hideLoginGate();
  });

  // Grab navbar elements (scripts are defer-loaded)
  const loginItem = document.getElementById("nav-login-item");
  const loginLink = document.getElementById("nav-login");
  const userItem = document.getElementById("nav-user-item");
  const logoutLink = document.getElementById("nav-logout");
  const deleteAccountLink = document.getElementById("nav-delete-account");
  const usernameSpan = document.getElementById("nav-username");
  let loginGateEl = null;
  let isAuthenticated = false;

  window.showConfirm = showConfirm;
  window.showPrompt = showPrompt;
  window.showNotice = showNotice;

  // -------------------- UI helpers --------------------

  function setLoggedInUI(name) {
    isAuthenticated = true;
    usernameSpan.textContent = name;
    loginItem.classList.add("d-none");
    userItem.classList.remove("d-none");
  }
  function setLoggedOutUI() {
    isAuthenticated = false;
    usernameSpan.textContent = "User";
    userItem.classList.add("d-none");
    loginItem.classList.remove("d-none");
  }
  function ensureLoginGate() {
    if (isDev) return;

    if (loginGateEl && document.body.contains(loginGateEl)) return loginGateEl;

    // NEW: reuse existing overlay if the script was loaded twice
    const existing = document.getElementById("qbaseLoginGate");
    if (existing) {
      loginGateEl = existing;
      return existing;
    }

    const wrap = document.createElement("div");
    wrap.id = "qbaseLoginGate";
    wrap.className =
      "position-fixed top-0 start-0 w-100 h-100 align-items-center justify-content-center";
    wrap.style.cssText =
      "z-index:2000;background:rgba(0,0,0,0.85);backdrop-filter:saturate(120%) blur(2px)";
    wrap.innerHTML = `
      <div class="card text-light" style="background:#15171b;border:1px solid rgba(255,255,255,0.08);min-width:320px;max-width:420px">
        <div class="card-body">
          <h5 class="card-title mb-2">Sign in required</h5>
          <p class="card-text">Please log in to use QBase.</p>
          <div class="mb-2">
            <label for="qbaseGateUsername" class="form-label">Username</label>
            <input id="qbaseGateUsername" class="form-control" type="text" placeholder="Enter username…" />
          </div>
          <div id="qbaseGateError" class="text-danger small mb-2" style="display:none"></div>
          <div class="d-flex gap-2">
            <button id="qbaseGateLoginBtn" class="btn btn-primary flex-fill">Login</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    document.body.style.overflow = "hidden";

    const btn = wrap.querySelector("#qbaseGateLoginBtn");
    const input = wrap.querySelector("#qbaseGateUsername");
    const onSubmit = (e) => {
      e?.preventDefault?.();
      gateLoginFlow();
    };
    btn?.addEventListener("click", onSubmit);
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") onSubmit(e);
    });

    loginGateEl = wrap;
    return wrap;
  }

  function showLoginGate() {
    const el = ensureLoginGate();
    el.classList.remove("d-none");
    el.classList.add("d-flex");
    document.body.style.overflow = "hidden";
    setTimeout(() => el.querySelector("#qbaseGateUsername")?.focus(), 0);
  }

  function hideLoginGate() {
    if (!loginGateEl) return;
    loginGateEl.classList.remove("d-flex");
    loginGateEl.classList.add("d-none");
    document.body.style.overflow = "";
  }
  function broadcastLogin(name) {
    window.dispatchEvent(
      new CustomEvent("qbase:login", { detail: { username: name } })
    );
  }
  function broadcastLogout() {
    window.dispatchEvent(new Event("qbase:logout"));
  }

  // --- Modal system ---

  // 1) Host element (reused for all dialogs)
  function ensureModalHost() {
    if (document.getElementById("qbaseModal")) return;
    const tpl = document.createElement("div");
    tpl.innerHTML = `
      <div class="modal fade" id="qbaseModal" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content" style="background:#15171b;border:1px solid rgba(255,255,255,0.08)">
            <div class="modal-header border-0">
              <h5 class="modal-title" id="qbaseModalTitle">Message</h5>
              <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body" id="qbaseModalBody"></div>
            <div class="modal-footer border-0" id="qbaseModalFooter"></div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(tpl.firstElementChild);
  }

  // 2) Simple queue/mutex so modals never overlap
  let __modalChain = Promise.resolve();

  function queueModal(taskFn) {
    // Chain tasks so each waits for the previous to fully finish
    __modalChain = __modalChain.then(() => taskFn()).catch(() => {});
    return __modalChain;
  }

  // 3) Core modal: resolves AFTER hide animation finishes
  function showModal({
    title,
    bodyHTML,
    buttons,
    focusSelector,
    backdrop = "static",
    keyboard = true,
    onContentReady,
  }) {
    return queueModal(
      () =>
        new Promise((resolve) => {
          ensureModalHost();
          const modalEl = document.getElementById("qbaseModal");
          const titleEl = document.getElementById("qbaseModalTitle");
          const bodyEl = document.getElementById("qbaseModalBody");
          const footEl = document.getElementById("qbaseModalFooter");

          // Reset content
          titleEl.textContent = title || "Message";
          bodyEl.innerHTML = bodyHTML || "";
          footEl.innerHTML = "";

          // Call onContentReady callback if provided (after content is set but before modal is shown)
          if (onContentReady && typeof onContentReady === "function") {
            onContentReady(modalEl);
          }

          // Prepare result handoff: we resolve ONLY when hidden
          let result = undefined;
          const onHidden = () => {
            modalEl.removeEventListener("hidden.bs.modal", onHidden);
            resolve(result);
          };
          modalEl.addEventListener("hidden.bs.modal", onHidden, { once: true });

          // Build buttons
          (buttons || []).forEach((b, i) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = b.className || "btn btn-primary";
            btn.textContent = b.text || `Button ${i + 1}`;
            btn.addEventListener("click", () => {
              result = b.value;
              bsModal.hide(); // trigger hide animation; promise resolves on hidden
            });
            footEl.appendChild(btn);
          });

          // Bootstrap modal instance
          const bsModal = new bootstrap.Modal(modalEl, { backdrop, keyboard });

          // Optional focus when shown (e.g., prompt input)
          if (focusSelector) {
            modalEl.addEventListener(
              "shown.bs.modal",
              () => {
                const el = modalEl.querySelector(focusSelector);
                if (el) el.focus();
              },
              { once: true }
            );
          }

          // If user closes via X or backdrop (when not 'static'), result stays undefined
          bsModal.show();
        })
    );
  }

  // 4) Public helpers
  async function showConfirm({
    title,
    message,
    okText = "OK",
    cancelText = "Cancel",
  }) {
    return await showModal({
      title,
      bodyHTML: `<p class="mb-0">${message}</p>`,
      buttons: [
        {
          text: cancelText,
          className: "btn btn-outline-secondary",
          value: false,
        },
        { text: okText, className: "btn btn-success", value: true },
      ],
    });
  }

  async function showPrompt({
    title,
    label = "Enter value",
    placeholder = "",
    okText = "OK",
    cancelText = "Cancel",
    initial = "",
  }) {
    const id = "qbasePromptInput";
    const body = `
      <label for="${id}" class="form-label">${label}</label>
      <input id="${id}" class="form-control" type="text" placeholder="${placeholder}" value="${
      initial ?? ""
    }">
    `;
    const res = await showModal({
      title,
      bodyHTML: body,
      buttons: [
        {
          text: cancelText,
          className: "btn btn-outline-secondary",
          value: { ok: false, value: null },
        },
        {
          text: okText,
          className: "btn btn-primary",
          value: { ok: true, value: null },
        },
      ],
      focusSelector: `#${id}`,
    });
    if (res && typeof res === "object") {
      const input = document.getElementById(id);
      if (input) res.value = input.value.trim();
      return res;
    }
    return { ok: false, value: null };
  }

  async function showNotice({ title, message, okText = "OK" }) {
    await showModal({
      title,
      bodyHTML: `<p class="mb-0">${message}</p>`,
      buttons: [{ text: okText, className: "btn btn-primary", value: true }],
    });
  }

  // 5) Expose globally so assignment.js can use them
  window.showConfirm = showConfirm;
  window.showPrompt = showPrompt;
  window.showNotice = showNotice;
  // (Optional) also expose showModal if you plan to build custom flows elsewhere
  window.showModal = showModal;

  // -------------------- Backend helpers --------------------
  async function whoAmI() {
    try {
      const r = await authFetch(`${API_BASE}/me`);
      if (!r.ok) return null;
      const u = await r.json();
      return u && u.username ? u : null;
    } catch {
      return null;
    }
  }

  function listLocalAssignmentStates() {
    return [];
  }

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
          time: Math.max(l.time || 0, s.time || 0),
        };
      });
    return out;
  }

  async function fetchServerState(aID) {
    try {
      const r = await authFetch(`${API_BASE}/api/state/${aID}`);
      if (!r.ok) return null;
      const s = await r.json();
      return Array.isArray(s) ? s : null;
    } catch {
      return null;
    }
  }

  async function postServerState(aID, state) {
    const r = await authFetch(`${API_BASE}/api/state/${aID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state }),
    });
    if (!r.ok) throw new Error(`POST /api/state/${aID} -> ${r.status}`);
  }

  async function migrateAllLocalAssignmentsIfAny() {
    /* no-op: local storage disabled */
  }

  // -------------------- Login / Logout flows --------------------
  async function doLoginFlow() {
    showLoginGate();
  }

  async function gateLoginFlow() {
    ensureLoginGate();
    const input = document.getElementById("qbaseGateUsername");
    const err = document.getElementById("qbaseGateError");
    const username = (input?.value || "").trim();
    if (!username || username.length < 2) {
      if (err) {
        err.textContent = "Please enter a valid username (min 2 characters).";
        err.style.display = "block";
      }
      input?.focus();
      return;
    }
    err && (err.style.display = "none");
    try {
      const r = await fetch(`${API_BASE}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      if (data && data.token && data.user && data.user.username) {
        qbSetToken(data.token);
        setLoggedInUI(data.user.username);
        broadcastLogin(data.user.username);
        hideLoginGate();
        if (input) input.value = "";
      } else {
        throw new Error("Session not established");
      }
    } catch (e) {
      if (err) {
        err.textContent = "Login failed. Please try again.";
        err.style.display = "block";
      }
      showLoginGate();
    }
  }

  async function doLogoutFlow() {
    // Replace fetch with authFetch and remove credentials
    try {
      await authFetch(`${API_BASE}/logout`, { method: "POST" });
    } catch {}
    qbClearToken();
    setLoggedOutUI();
    broadcastLogout();
    showLoginGate();
  }

  async function doDeleteAccountFlow() {
    const ok = await showConfirm({
      title: "Delete Account",
      message:
        "This will permanently delete your account and ALL saved progress. This action cannot be undone. Do you want to continue?",
      okText: "Delete",
      cancelText: "Cancel",
    });
    if (!ok) return;
    const { ok: ok2, value } = await showPrompt({
      title: "Confirm Deletion",
      label: "Type DELETE to confirm",
      placeholder: "DELETE",
      okText: "Confirm",
      cancelText: "Cancel",
    });
    if (!ok2 || String(value).toUpperCase() !== "DELETE") return;
    try {
      // Replace fetch with authFetch and remove credentials
      const r = await authFetch(`${API_BASE}/account`, { method: "DELETE" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      qbClearToken();
      setLoggedOutUI();
      broadcastLogout();
      await showNotice({
        title: "Account deleted",
        message: "Your account and all progress have been deleted.",
      });
      location.reload();
    } catch (e) {
      await showNotice({
        title: "Error",
        message: "Failed to delete account. Please try again.",
      });
    }
  }

  // -------------------- Wire up & initialize --------------------
  loginLink?.addEventListener("click", (e) => {
    e.preventDefault();
    showLoginGate();
  });
  logoutLink?.addEventListener("click", (e) => {
    e.preventDefault();
    doLogoutFlow();
  });
  deleteAccountLink?.addEventListener("click", (e) => {
    e.preventDefault();
    doDeleteAccountFlow();
  });

  (async () => {
    const me = await whoAmI();
    if (me?.username) {
      setLoggedInUI(me.username);
      broadcastLogin(me.username);
      hideLoginGate();
    } else {
      setLoggedOutUI();
      if (!isAuthenticated) showLoginGate();
    }
  })();

  // Hide gate on login event
  window.addEventListener("qbase:login", () => hideLoginGate());
  window.addEventListener("qbase:force-login", showLoginGate);

  // --- Global search overlay ---
  let searchCachePromise = null;
  function fetchSearchData() {
    if (!searchCachePromise) {
      searchCachePromise = Promise.all([
        fetch("./data/assignment_list.json")
          .then((r) => r.json())
          .catch(() => []),
        fetch("./data/worksheets/worksheet_list.json")
          .then((r) => r.json())
          .catch(() => []),
      ]).then(([assignments, worksheets]) => ({
        assignments: Array.isArray(assignments) ? assignments : [],
        worksheets: normalizeWorksheets(worksheets),
      }));
    }
    return searchCachePromise;
  }

  function normalizeWorksheets(input) {
    const out = [];
    const pushItem = (raw, subjHint) => {
      if (!raw) return;
      const subject = (raw.subject || subjHint || "").toString();
      const chapter = (
        raw.chapter ||
        raw.chapterName ||
        raw.topic ||
        ""
      ).toString();
      const title = (
        raw.title ||
        raw.name ||
        raw.worksheetTitle ||
        raw.label ||
        raw.file ||
        "Worksheet"
      ).toString();
      const wID = String(
        raw.wID || raw.id || raw.wid || generateWID(subject, chapter, title)
      );
      out.push({ subject, chapter, title, wID });
    };

    if (Array.isArray(input)) {
      input.forEach((it) => pushItem(it));
    } else if (input && Array.isArray(input.worksheets)) {
      input.worksheets.forEach((it) => pushItem(it));
    } else if (input && Array.isArray(input.items)) {
      input.items.forEach((it) => pushItem(it));
    } else if (input && typeof input === "object") {
      Object.entries(input).forEach(([subj, arr]) => {
        if (Array.isArray(arr)) arr.forEach((it) => pushItem(it, subj));
      });
    }
    return out;
  }

  function generateWID(subject, chapter, title) {
    const slug = (s) =>
      String(s || "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-");
    return [slug(subject), slug(chapter), slug(title)]
      .filter(Boolean)
      .join("-");
  }

  function filterAssignments(list, q) {
    if (!q) return list;
    return list.filter((it) => {
      const hay = [it.title, it.subject, it.chapter, it.faculty]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }

  function filterWorksheets(list, q) {
    if (!q) return list;
    return list.filter((it) => {
      const hay = [it.title, it.subject, it.chapter]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }

  function ensureSearchUI() {
    let wrap = document.getElementById("navbar-search-results");
    if (wrap) {
      return {
        wrap,
        aList: wrap.querySelector("#nav-search-assignments"),
        aEmpty: wrap.querySelector("#nav-search-a-empty"),
        wList: wrap.querySelector("#nav-search-worksheets"),
        wEmpty: wrap.querySelector("#nav-search-w-empty"),
      };
    }

    wrap = document.createElement("div");
    wrap.id = "navbar-search-results";
    wrap.innerHTML = `
      <div class="section">
        <div class="section-title">Assignments</div>
        <div id="nav-search-a-empty" class="empty d-none">No assignments found</div>
        <div id="nav-search-assignments" class="list-group list-group-flush"></div>
      </div>
      <div class="section">
        <div class="section-title">Worksheets</div>
        <div id="nav-search-w-empty" class="empty d-none">No worksheets found</div>
        <div id="nav-search-worksheets" class="list-group list-group-flush"></div>
      </div>`;

    const form = document.querySelector("nav form[role='search']");
    form?.classList.add("qbase-search-form");
    form?.appendChild(wrap);

    const input = document.getElementById("navbar-search-input");
    document.addEventListener("click", (ev) => {
      if (!wrap.contains(ev.target) && ev.target !== input) {
        wrap.classList.remove("show");
      }
    });
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Escape") wrap.classList.remove("show");
    });

    if (!document.getElementById("navbar-search-style")) {
      const style = document.createElement("style");
      style.id = "navbar-search-style";
      style.textContent = `
        .qbase-search-form { position: relative; }
        #navbar-search-results {
          position: absolute;
          top: 100%;
          left: 0;
          right: 0;
          margin-top: 0.25rem;
          background: rgba(20,22,26,0.95);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 0.25rem;
          z-index: 2000;
          max-height: 60vh;
          overflow-y: auto;
          display: none;
        }
        #navbar-search-results.show { display: block; }
        #navbar-search-results .section-title {
          font-size: 0.875rem;
          margin: 0.5rem 0.75rem;
          color: #9aa3ac;
        }
        #navbar-search-results .list-group-item {
          background: transparent;
          color: #dfe6ee;
          border: none;
          padding: 0.5rem 0.75rem;
        }
        #navbar-search-results .empty {
          padding: 0.5rem 0.75rem;
          color: #9aa3ac;
        }
      `;
      document.head.appendChild(style);
    }

    return {
      wrap,
      aList: wrap.querySelector("#nav-search-assignments"),
      aEmpty: wrap.querySelector("#nav-search-a-empty"),
      wList: wrap.querySelector("#nav-search-worksheets"),
      wEmpty: wrap.querySelector("#nav-search-w-empty"),
    };
  }

  async function handleNavbarSearchSubmit(e) {
    e && e.preventDefault && e.preventDefault();
    const input = document.getElementById("navbar-search-input");
    const query = (input?.value || "").trim().toLowerCase();
    const ui = ensureSearchUI();
    ui.aList.innerHTML = "";
    ui.wList.innerHTML = "";
    ui.aEmpty.classList.add("d-none");
    ui.wEmpty.classList.add("d-none");

    if (!query) {
      ui.wrap.classList.remove("show");
      return;
    }

    const data = await fetchSearchData();
    const aMatches = filterAssignments(data.assignments, query);
    const wMatches = filterWorksheets(data.worksheets, query);

    if (aMatches.length) {
      aMatches.forEach((it) => {
        const a = document.createElement("a");
        a.className = "list-group-item list-group-item-action";
        a.href = `./assignment.html?aID=${encodeURIComponent(it.aID || "")}`;
        a.textContent = `${it.subject || ""} – ${it.title || "Assignment"}`;
        ui.aList.appendChild(a);
      });
    } else {
      ui.aEmpty.classList.remove("d-none");
    }

    if (wMatches.length) {
      wMatches.forEach((it) => {
        const a = document.createElement("a");
        a.className = "list-group-item list-group-item-action";
        a.href = `./worksheet.html?wID=${encodeURIComponent(it.wID || "")}`;
        a.textContent = `${it.subject || ""} – ${it.title || "Worksheet"}`;
        ui.wList.appendChild(a);
      });
    } else {
      ui.wEmpty.classList.remove("d-none");
    }

    ui.wrap.classList.add("show");
  }

  // Prefill navbar search with current ?q= if present and wire events
  (function initNavbarSearch() {
    try {
      const params = new URLSearchParams(window.location.search);
      const q = params.get("q") || "";
      const input = document.getElementById("navbar-search-input");
      const btn = document.getElementById("navbar-search-btn");

      if (input && q) {
        input.value = q;
      }

      const form = input?.closest("form");
      btn?.addEventListener("click", handleNavbarSearchSubmit);
      form?.addEventListener("submit", handleNavbarSearchSubmit);
      input?.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") handleNavbarSearchSubmit(ev);
      });
    } catch (err) {
      console.error("Navbar search init failed:", err);
    }
  })();
})();
