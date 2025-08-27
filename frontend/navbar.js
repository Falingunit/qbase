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

  // -------------------- PASSWORD: deterministic derivation --------------------
  function derivePasswordFromUsername(usernameRaw) {
    // 1) lowercase
    // 2) strip accents/diacritics
    // 3) keep letters a–z only
    // 4) reverse the remaining letters
    // If nothing remains (e.g., username is only digits), fall back to "user".
    let s = (usernameRaw ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/[^a-z]/g, ""); // letters only

    if (!s) s = "user";
    return [...s].reverse().join("");
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

  function handleNavbarSearchSubmit(e) {
    e && e.preventDefault && e.preventDefault();
    const input = document.getElementById("navbar-search-input");
    const query = (input?.value || "").trim();

    const url = new URL("./index.html", window.location.href);
    if (query) {
      url.searchParams.set("q", query);
    } else {
      url.searchParams.delete("q");
    }
    window.location.href = url.toString();
  }

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
