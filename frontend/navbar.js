(async () => {
  isDev = false;

  if (window.__QBASE_NAVBAR_LOADED__) {
    console.warn("navbar.js loaded twice; ignoring second load");
    return;
  }
  window.__QBASE_NAVBAR_LOADED__ = true;

  await loadConfig();
  // ======= Tunables =======
  const SHOW_AT_TOP_PX = 120; // Show navbar when within this many pixels from top
  const SPEED_THRESHOLD = 600; // px/sec upward needed to "fast show"
  const MIN_DELTA = 5; // Ignore tiny scroll jitter

  // ======= Grab the navbar =======
  const nav = document.querySelector(".navbar");
  if (!nav) return;

  // Ensure smooth hide/show + minimal CSS without touching your stylesheets
  const style = document.createElement("style");
  style.textContent = `
    .navbar.js-autohide {
      transition: transform 0.2s ease, box-shadow 0.2s ease;
      will-change: transform;
    }
    .navbar.js-autohide.navbar--hidden {
      transform: translateY(-100%);
    }
  `;
  document.head.appendChild(style);
  nav.classList.add("js-autohide");

  // ======= State =======
  let lastY = Math.max(0, window.scrollY || window.pageYOffset);
  let lastT = performance.now();
  let hidden = false;
  let ticking = false;

  function hide() {
    if (!hidden) {
      nav.classList.add("navbar--hidden");
      hidden = true;
    }
  }
  function show() {
    if (hidden) {
      nav.classList.remove("navbar--hidden");
      hidden = false;
    }
  }

  function update() {
    const y = Math.max(0, window.scrollY || window.pageYOffset);
    const t = performance.now();

    const dy = y - lastY; // + = down, - = up
    const dt = Math.max(16, t - lastT); // ms (avoid divide-by-zero)
    const v = dy / (dt / 1000); // px/sec (+down, -up)

    const atTop = y <= SHOW_AT_TOP_PX;
    const menuOpen = !!document.querySelector(".navbar-collapse.show"); // don't autohide if mobile menu open

    // Add a subtle shadow when not at the top
    if (y > 0) nav.classList.add("shadow-sm");
    else nav.classList.remove("shadow-sm");

    if (menuOpen) {
      show(); // keep visible while the menu is open
    } else if (atTop) {
      show(); // always show near top
    } else if (dy > MIN_DELTA) {
      hide(); // scrolling down -> hide
    } else if (-v > SPEED_THRESHOLD) {
      show(); // fast upward scroll -> show
    }

    lastY = y;
    lastT = t;
    ticking = false;
  }

  // Use rAF to keep things smooth
  window.addEventListener(
    "scroll",
    () => {
      if (!ticking) {
        requestAnimationFrame(update);
        ticking = true;
      }
    },
    { passive: true }
  );

  // Re-evaluate on resize or orientation change (safe default)
  window.addEventListener("resize", () => {
    requestAnimationFrame(update);
  });

  // Initial position on load
  update();
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

  // -------------------- PASSWORD: deterministic derivation --------------------
  /**
   * Derives a password from a username using a "first-two, last-two, plus length" rule.
   * This algorithm is simple enough for a human to compute mentally.
   *
   * @param {string | null | undefined} usernameRaw The raw username string.
   * @returns {string} The derived password.
   */
  function derivePasswordFromUsername(usernameRaw) {
    // 1) Sanitize: lowercase, keep only letters (a-z) and digits (0-9).
    const s = (usernameRaw ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

    // 2) If the sanitized string is empty, fall back to a default.
    if (!s) {
      return "default123";
    }

    // 3) Get the required components for the password.
    const len = s.length;
    const firstTwo = s.slice(0, 2);
    const lastTwo = s.slice(-2);

    // 4) Combine the parts: [first two][last two][length].
    return `${firstTwo}${lastTwo}${len}`;
  }

  function ensureLoginGate() {
    if (isDev) return;

    if (loginGateEl && document.body.contains(loginGateEl)) return loginGateEl;

    // Reuse existing overlay if the script was loaded twice
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
          <form id="qbaseGateForm">
            <div class="mb-2">
              <label for="qbaseGateUsername" class="form-label">Username</label>
              <input id="qbaseGateUsername" class="form-control" type="text" placeholder="Enter username…" autocomplete="username" />
            </div>
            <div class="mb-2">
            <label for="qbaseGatePassword" class="form-label mb-0">Password</label>
              <div class="d-flex align-items-center justify-content-between">
                <input id="qbaseGatePassword" class="form-control" type="password" placeholder="Enter password…" autocomplete="current-password" />
                <div class="d-flex ms-2">
                  <button type="button" id="qbaseGateTogglePwd" class="btn btn-sm btn-outline-secondary">Show</button>
                </div>
              </div>
            </div>
            <div id="qbaseGateError" class="text-danger small mb-2" style="display:none"></div>
            <div class="d-flex gap-2">
              <button id="qbaseGateLoginBtn" class="btn btn-primary flex-fill" type="submit">Login</button>
            </div>
          </form>
        </div>
      </div>`;

    document.body.appendChild(wrap);
    document.body.style.overflow = "hidden";

    const form = wrap.querySelector("#qbaseGateForm");
    const btn = wrap.querySelector("#qbaseGateLoginBtn");
    const input = wrap.querySelector("#qbaseGateUsername");
    const pwd = wrap.querySelector("#qbaseGatePassword");
    const toggleBtn = wrap.querySelector("#qbaseGateTogglePwd");

    const onSubmit = (e) => {
      e?.preventDefault?.();
      gateLoginFlow();
    };
    btn?.addEventListener("click", onSubmit);
    form?.addEventListener("submit", onSubmit);

    // Show/hide toggle
    toggleBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      if (!pwd) return;
      const isPw = pwd.type === "password";
      pwd.type = isPw ? "text" : "password";
      toggleBtn.textContent = isPw ? "Hide" : "Show";
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

  // --- Modal system (unchanged) ---

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

  let __modalChain = Promise.resolve();
  function queueModal(taskFn) {
    __modalChain = __modalChain.then(() => taskFn()).catch(() => {});
    return __modalChain;
  }
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

          titleEl.textContent = title || "Message";
          bodyEl.innerHTML = bodyHTML || "";
          footEl.innerHTML = "";

          if (onContentReady && typeof onContentReady === "function") {
            onContentReady(modalEl);
          }

          let result = undefined;
          const onHidden = () => {
            modalEl.removeEventListener("hidden.bs.modal", onHidden);
            resolve(result);
          };
          modalEl.addEventListener("hidden.bs.modal", onHidden, { once: true });

          (buttons || []).forEach((b, i) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = b.className || "btn btn-primary";
            btn.textContent = b.text || `Button ${i + 1}`;
            btn.addEventListener("click", () => {
              result = b.value;
              bsModal.hide();
            });
            footEl.appendChild(btn);
          });

          const bsModal = new bootstrap.Modal(modalEl, { backdrop, keyboard });

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

          bsModal.show();
        })
    );
  }
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

  // Expose globally for assignment.js
  window.showConfirm = showConfirm;
  window.showPrompt = showPrompt;
  window.showNotice = showNotice;
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
    const pwd = document.getElementById("qbaseGatePassword");
    const err = document.getElementById("qbaseGateError");

    const username = (input?.value || "").trim();
    const typedPwd = (pwd?.value || "").trim();

    // Basic validation
    if (!username || username.length < 2) {
      if (err) {
        err.textContent = "Please enter a valid username (min 2 characters).";
        err.style.display = "block";
      }
      input?.focus();
      return;
    }

    // Require a password and validate it against the deterministic algorithm
    const expectedPwd = derivePasswordFromUsername(username);
    if (!typedPwd) {
      if (err) {
        err.textContent = "Please enter your password (you can auto-fill it).";
        err.style.display = "block";
      }
      pwd?.focus();
      return;
    }
    if (typedPwd !== expectedPwd) {
      if (err) {
        err.textContent = "Incorrect password for this username.";
        err.style.display = "block";
      }
      pwd?.focus();
      return;
    }

    err && (err.style.display = "none");
    try {
      // Include the (deterministically derived) password in the request
      const r = await fetch(`${API_BASE}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password: typedPwd }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      if (data && data.token && data.user && data.user.username) {
        qbSetToken(data.token);
        setLoggedInUI(data.user.username);
        broadcastLogin(data.user.username);
        hideLoginGate();
        if (input) input.value = "";
        if (pwd) pwd.value = "";
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
})();
