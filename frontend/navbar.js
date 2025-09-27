(async () => {
  // Robust dev mode detection (localhost or explicit opt-in)
  const IS_DEV = (() => {
    try {
      const qs = new URLSearchParams(location.search);
      if (["1", "true"].includes((qs.get("dev") || "").toLowerCase()))
        return true;
      const ls = (localStorage.getItem("qbase.dev") || "").toLowerCase();
      if (["1", "true"].includes(ls)) return true;
      const h = location.hostname;
      return h === "localhost" || h === "127.0.0.1";
    } catch {
      return false;
    }
  })();
  window.QBASE_DEV = IS_DEV;
  // Dev auto-login suppression per session (set on logout)
  const DEV_NO_AUTO = (() => {
    try {
      return sessionStorage.getItem("qbase.dev.noAutoLogin") === "1";
    } catch {
      return false;
    }
  })();
  const FORCE_LOGIN = (() => {
    try {
      const qs = new URLSearchParams(location.search);
      if (["1", "true"].includes((qs.get("login") || "").toLowerCase()))
        return true;
      if (["1", "true"].includes((qs.get("forceLogin") || "").toLowerCase()))
        return true;
      const ls = (localStorage.getItem("qbase.forceLogin") || "").toLowerCase();
      return ["1", "true"].includes(ls);
    } catch {
      return false;
    }
  })();
  window.QBASE_FORCE_LOGIN = FORCE_LOGIN;

  // Try to load optional dev auto-login config at runtime
  let __devAutoCfgLoaded = false;
  let __devAutoCfg = null;
  async function loadDevAutoConfig() {
    if (__devAutoCfgLoaded) return __devAutoCfg;
    __devAutoCfgLoaded = true;
    try {
      const r = await fetch("./dev.config.json", { cache: "no-store" });
      if (!r.ok) return (__devAutoCfg = null);
      const cfg = await r.json();
      return (__devAutoCfg = cfg || null);
    } catch {
      return (__devAutoCfg = null);
    }
  }

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

  // In assignment mode, make the navbar overlay the page (fixed) so it doesn't push content
  if (document.querySelector(".assignment-topbar")) {
    const overlayCss = document.createElement("style");
    overlayCss.textContent = `
      .navbar.js-autohide { position: fixed; top: 0; left: 0; right: 0; width: 100%; z-index: 1050; }
    `;
    document.head.appendChild(overlayCss);
  }

  // Detect Assignment mode (page with special topbar)
  const IS_ASSIGNMENT = !!document.querySelector(".assignment-topbar");

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

  // Autohide behavior differs on Assignment page vs others
  if (!IS_ASSIGNMENT) {
    // Generic pages: scroll-driven autohide
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
  } else {
    // Assignment page: always start hidden and reveal only by hover-at-top (desktop)
    // or scroll gesture on the assignment topbar (touch devices)
    hide();

    const REVEAL_ZONE_PX = 14; // top area for desktop hover reveal
    const hasFinePointer = (() => {
      try { return !!(window.matchMedia && window.matchMedia('(pointer: fine)').matches); } catch { return false; }
    })();
    const hasCoarsePointer = (() => {
      try { return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); } catch { return false; }
    })();
    const topbar = document.querySelector(".assignment-topbar");

    const isMenuOpen = () => !!document.querySelector(".navbar-collapse.show");

    // Keep visible while the collapse menu is open
    const collEl = nav.querySelector(".navbar-collapse");
    if (collEl) {
      collEl.addEventListener("shown.bs.collapse", () => show());
      collEl.addEventListener("hidden.bs.collapse", () => {
        // Hide unless cursor is still in reveal zone or hovering on navbar
        if (hasFinePointer) {
          const lastMouseY = window.__qbase_lastMouseY__ ?? Number.POSITIVE_INFINITY;
          if (!nav.matches(":hover") && lastMouseY > REVEAL_ZONE_PX) hide();
        } else {
          hide();
        }
      });
    }

    let navHovered = false;
    // Desktop hover-hide: introduce a short grace period to avoid accidental hides
    let hoverHideTimer = 0;
    const scheduleHoverHide = (ms = 300) => {
      if (hoverHideTimer) clearTimeout(hoverHideTimer);
      hoverHideTimer = window.setTimeout(() => {
        if (!navHovered && !isMenuOpen()) hide();
      }, ms);
    };
    const cancelHoverHide = () => {
      if (hoverHideTimer) clearTimeout(hoverHideTimer);
      hoverHideTimer = 0;
    };
    if (hasFinePointer) {
      // Desktop: reveal when mouse is near the top edge, hide otherwise
      document.addEventListener(
        "mousemove",
        (e) => {
          const y = e.clientY || 0;
          window.__qbase_lastMouseY__ = y;
          if (y <= REVEAL_ZONE_PX || navHovered) {
            cancelHoverHide();
            show();
          } else if (!isMenuOpen()) {
            scheduleHoverHide(320);
          }
        },
        { passive: true }
      );
      nav.addEventListener("mouseenter", () => { navHovered = true; cancelHoverHide(); show(); }, { passive: true });
      nav.addEventListener(
        "mouseleave",
        (e) => {
          navHovered = false;
          const y = (window.__qbase_lastMouseY__ ?? Number.POSITIVE_INFINITY);
          if (y > REVEAL_ZONE_PX && !isMenuOpen()) scheduleHoverHide(320);
        },
        { passive: true }
      );
    }

    // Touch devices: reveal only if the user scrolls (drags) on the assignment topbar
    // Prefer Pointer Events when available; fall back to touch events.
    let hideTimer = 0;
    const scheduleHide = (ms = 1400) => {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => {
        if (!isMenuOpen()) hide();
      }, ms);
    };
    // Also keep visible while user interacts with navbar itself.
    nav.addEventListener('pointerdown', () => { if (hideTimer) clearTimeout(hideTimer); show(); }, { passive: true });
    nav.addEventListener('pointerleave', () => { if (!isMenuOpen()) scheduleHide(); }, { passive: true });

    const startTracker = { active: false, id: null, y: 0 };
    const onRevealGesture = () => {
      show();
      scheduleHide();
    };

    if (topbar) {
      if ("onpointerdown" in window) {
        topbar.addEventListener(
          "pointerdown",
          (e) => {
            if (e.pointerType === "mouse") return; // only touch/pen
            startTracker.active = true;
            startTracker.id = e.pointerId;
            startTracker.y = e.clientY;
          },
          { passive: true }
        );
        topbar.addEventListener(
          "pointermove",
          (e) => {
            if (!startTracker.active || e.pointerId !== startTracker.id) return;
            const dy = Math.abs((e.clientY || 0) - startTracker.y);
            if (dy > 8) onRevealGesture();
          },
          { passive: true }
        );
        const end = () => {
          startTracker.active = false;
        };
        topbar.addEventListener("pointerup", end, { passive: true });
        topbar.addEventListener("pointercancel", end, { passive: true });
      } else {
        // Fallback: touch events
        let y0 = 0;
        topbar.addEventListener(
          "touchstart",
          (e) => {
            const t = e.touches?.[0];
            if (!t) return;
            y0 = t.clientY || 0;
          },
          { passive: true }
        );
        topbar.addEventListener(
          "touchmove",
          (e) => {
            const t = e.touches?.[0];
            if (!t) return;
            const dy = Math.abs((t.clientY || 0) - y0);
            if (dy > 8) onRevealGesture();
          },
          { passive: true }
        );
        topbar.addEventListener(
          "touchend",
          () => scheduleHide(),
          { passive: true }
        );
      }
    }
  }

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
  const userDropdownMenu = document.querySelector('#nav-user-item .dropdown-menu');
  let profileLink = document.getElementById('nav-profile');
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
    const el = ensureLoginGate2();
    if (!el) return;
    el.classList.remove("d-none");
    el.classList.add("d-flex");
    document.body.style.overflow = "hidden";
    setTimeout(() => {
      const target = el.querySelector("#qbaseLoginUsername") || el.querySelector("#qbaseSignupUsername");
      target?.focus();
    }, 0);
  }

  function hideLoginGate() {
    if (!loginGateEl) return;
    loginGateEl.classList.remove("d-flex");
    loginGateEl.classList.add("d-none");
    document.body.style.overflow = "";
  }
  // New tabbed login/signup modal
  function ensureLoginGate2() {
    if (loginGateEl && document.body.contains(loginGateEl)) return loginGateEl;

    const existing = document.getElementById("qbaseLoginGate");
    if (existing) {
      loginGateEl = existing;
      return existing;
    }

    const wrap = document.createElement("div");
    wrap.id = "qbaseLoginGate";
    wrap.className =
      "position-fixed top-0 start-0 w-100 h-100 align-items-center justify-content-center d-none";
    wrap.style.cssText =
      "z-index:2000;background:rgba(0,0,0,0.85);backdrop-filter:saturate(120%) blur(2px)";
    wrap.innerHTML = `
      <div class="card text-light" style="background:#15171b;border:1px solid rgba(255,255,255,0.08);min-width:320px;max-width:460px">
        <div class="card-body">
          <h5 class="card-title mb-2">Account</h5>
          <p class="card-text">Sign in or create a new account.</p>

          <ul class="nav nav-tabs" id="qbaseAuthTabs" role="tablist">
            <li class="nav-item" role="presentation">
              <button class="nav-link active text-white" id="qbaseTabSignIn" data-bs-toggle="tab" data-bs-target="#qbasePaneSignIn" type="button" role="tab" aria-controls="qbasePaneSignIn" aria-selected="true">Sign In</button>
            </li>
            <li class="nav-item" role="presentation">
              <button class="nav-link text-white" id="qbaseTabSignUp" data-bs-toggle="tab" data-bs-target="#qbasePaneSignUp" type="button" role="tab" aria-controls="qbasePaneSignUp" aria-selected="false">Create new account</button>
            </li>
          </ul>
          <div class="tab-content pt-3">
            <div class="tab-pane fade show active" id="qbasePaneSignIn" role="tabpanel" aria-labelledby="qbaseTabSignIn">
              <form id="qbaseSignInForm">
                <div class="mb-2">
                  <label for="qbaseLoginUsername" class="form-label">Username</label>
                  <input id="qbaseLoginUsername" class="form-control" type="text" placeholder="Enter username" autocomplete="username" />
                </div>
                <div class="mb-2">
                  <label for="qbaseLoginPassword" class="form-label mb-0">Password</label>
                  <div class="d-flex align-items-center justify-content-between">
                    <input id="qbaseLoginPassword" class="form-control" type="password" placeholder="Enter password" autocomplete="current-password" />
                    <div class="d-flex ms-2">
                      <button type="button" id="qbaseLoginTogglePwd" class="btn btn-sm btn-outline-secondary">Show</button>
                    </div>
                  </div>
                </div>
                <div id="qbaseLoginError" class="text-danger small mb-2" style="display:none"></div>
                <div class="d-flex gap-2">
                  <button id="qbaseSignInBtn" class="btn btn-success flex-fill" type="submit">Sign In</button>
                </div>
              </form>
            </div>
            <div class="tab-pane fade" id="qbasePaneSignUp" role="tabpanel" aria-labelledby="qbaseTabSignUp">
              <form id="qbaseSignUpForm">
                <div class="mb-2">
                  <label for="qbaseSignupUsername" class="form-label">Username</label>
                  <input id="qbaseSignupUsername" class="form-control" type="text" placeholder="Choose a username" autocomplete="username" />
                </div>
                <div class="mb-2">
                  <label for="qbaseSignupPassword" class="form-label mb-0">Password</label>
                  <div class="d-flex align-items-center justify-content-between">
                    <input id="qbaseSignupPassword" class="form-control" type="password" placeholder="Create a password" autocomplete="new-password" />
                    <div class="d-flex ms-2">
                      <button type="button" id="qbaseSignupTogglePwd" class="btn btn-sm btn-outline-secondary">Show</button>
                    </div>
                  </div>
                </div>
                <div class="mb-2">
                  <label for="qbaseSignupConfirm" class="form-label mb-0">Confirm Password</label>
                  <div class="d-flex align-items-center justify-content-between">
                    <input id="qbaseSignupConfirm" class="form-control" type="password" placeholder="Re-enter password" autocomplete="new-password" />
                    <div class="d-flex ms-2">
                      <button type="button" id="qbaseSignupToggleConfirm" class="btn btn-sm btn-outline-secondary">Show</button>
                    </div>
                  </div>
                </div>
                <div id="qbaseSignupError" class="text-danger small mb-2" style="display:none"></div>
                <div class="d-flex gap-2">
                  <button id="qbaseSignUpBtn" class="btn btn-success flex-fill" type="submit">Create Account</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>`;

    document.body.appendChild(wrap);

    const signInForm = wrap.querySelector("#qbaseSignInForm");
    const signUpForm = wrap.querySelector("#qbaseSignUpForm");

    const inUser = wrap.querySelector("#qbaseLoginUsername");
    const inPwd = wrap.querySelector("#qbaseLoginPassword");
    const inError = wrap.querySelector("#qbaseLoginError");
    const inToggle = wrap.querySelector("#qbaseLoginTogglePwd");

    const upUser = wrap.querySelector("#qbaseSignupUsername");
    const upPwd = wrap.querySelector("#qbaseSignupPassword");
    const upPwd2 = wrap.querySelector("#qbaseSignupConfirm");
    const upError = wrap.querySelector("#qbaseSignupError");
    const upToggle1 = wrap.querySelector("#qbaseSignupTogglePwd");
    const upToggle2 = wrap.querySelector("#qbaseSignupToggleConfirm");

    const onSignIn = (e) => {
      e?.preventDefault?.();
      gateLoginFlow2("signin");
    };
    const onSignUp = (e) => {
      e?.preventDefault?.();
      gateLoginFlow2("signup");
    };
    signInForm?.addEventListener("submit", onSignIn);
    signUpForm?.addEventListener("submit", onSignUp);

    // Show/hide toggles
    inToggle?.addEventListener("click", (e) => {
      e.preventDefault();
      if (!inPwd) return;
      const isPw = inPwd.type === "password";
      inPwd.type = isPw ? "text" : "password";
      inToggle.textContent = isPw ? "Hide" : "Show";
    });
    upToggle1?.addEventListener("click", (e) => {
      e.preventDefault();
      if (!upPwd) return;
      const isPw = upPwd.type === "password";
      upPwd.type = isPw ? "text" : "password";
      upToggle1.textContent = isPw ? "Hide" : "Show";
    });
    upToggle2?.addEventListener("click", (e) => {
      e.preventDefault();
      if (!upPwd2) return;
      const isPw = upPwd2.type === "password";
      upPwd2.type = isPw ? "text" : "password";
      upToggle2.textContent = isPw ? "Hide" : "Show";
    });

    loginGateEl = wrap;
    return wrap;
  }

  async function gateLoginFlow2(mode = "signin") {
    ensureLoginGate2();
    const inUser = document.getElementById("qbaseLoginUsername");
    const inPwd = document.getElementById("qbaseLoginPassword");
    const inErr = document.getElementById("qbaseLoginError");

    const upUser = document.getElementById("qbaseSignupUsername");
    const upPwd = document.getElementById("qbaseSignupPassword");
    const upPwd2 = document.getElementById("qbaseSignupConfirm");
    const upErr = document.getElementById("qbaseSignupError");

    if (mode === "signup") {
      const username = (upUser?.value || "").trim();
      const password = (upPwd?.value || "").trim();
      const confirm = (upPwd2?.value || "").trim();

      if (upErr) upErr.style.display = "none";

      if (!username || username.length < 2) {
        if (upErr) {
          upErr.textContent = "Please enter a valid username (min 2 characters).";
          upErr.style.display = "block";
        }
        upUser?.focus();
        return;
      }
      if (!password || password.length < 6) {
        if (upErr) {
          upErr.textContent = "Password must be at least 6 characters.";
          upErr.style.display = "block";
        }
        upPwd?.focus();
        return;
      }
      if (password !== confirm) {
        if (upErr) {
          upErr.textContent = "Passwords do not match.";
          upErr.style.display = "block";
        }
        upPwd2?.focus();
        return;
      }

      try {
        let r = await fetch(`${API_BASE}/signup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        });
        if (r.status === 404) {
          r = await fetch(`${API_BASE}/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password }),
          });
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json().catch(() => ({}));
        if (data && data.token && data.user && data.user.username) {
          qbSetToken(data.token);
          setLoggedInUI(data.user.username);
          broadcastLogin(data.user.username);
          hideLoginGate();
          upUser && (upUser.value = "");
          upPwd && (upPwd.value = "");
          upPwd2 && (upPwd2.value = "");
        } else {
          await showNotice({
            title: "Account Created",
            message: "Your account was created. Please sign in.",
          });
          try {
            const tabBtn = document.getElementById("qbaseTabSignIn");
            if (tabBtn) tabBtn.click();
          } catch {}
        }
      } catch (e) {
        if (upErr) {
          upErr.textContent = "Sign up failed. Please try again.";
          upErr.style.display = "block";
        }
      }
      return;
    }

    // Default: sign in
    const username = (inUser?.value || "").trim();
    const password = (inPwd?.value || "").trim();

    if (inErr) inErr.style.display = "none";
    if (!username || username.length < 2) {
      if (inErr) {
        inErr.textContent = "Please enter a valid username (min 2 characters).";
        inErr.style.display = "block";
      }
      inUser?.focus();
      return;
    }
    if (!password) {
      if (inErr) {
        inErr.textContent = "Please enter your password.";
        inErr.style.display = "block";
      }
      inPwd?.focus();
      return;
    }

    try {
      const r = await fetch(`${API_BASE}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      if (data && data.token && data.user && data.user.username) {
        qbSetToken(data.token);
        setLoggedInUI(data.user.username);
        broadcastLogin(data.user.username);
        hideLoginGate();
        inUser && (inUser.value = "");
        inPwd && (inPwd.value = "");
        try {
          if (data.user.mustChangePassword) {
            await showChangePasswordFlow();
          }
        } catch {}
      } else {
        throw new Error("Session not established");
      }
    } catch (e) {
      if (inErr) {
        inErr.textContent = "Sign in failed. Please try again.";
        inErr.style.display = "block";
      }
      showLoginGate();
    }
  }

  async function showChangePasswordFlow() {
    // Non-dismissible, enforced password update flow used for legacy users.
    const idNew = "qbaseChangePwNew";
    const idCon = "qbaseChangePwCon";
    const btnId = "qbaseChangePwSubmit";
    const errId = "qbasePwErr";
    const body = `
      <div class="mb-2">
        <label for="${idNew}" class="form-label">New Password</label>
        <input id="${idNew}" class="form-control" type="password" autocomplete="new-password" />
      </div>
      <div class="mb-2">
        <label for="${idCon}" class="form-label">Confirm New Password</label>
        <input id="${idCon}" class="form-control" type="password" autocomplete="new-password" />
      </div>
      <div id="${errId}" class="text-danger small" style="display:none"></div>
      <div class="mt-2 d-flex justify-content-end">
        <button id="${btnId}" class="btn btn-success">Update Password</button>
      </div>
    `;
    await showModal({
      title: "Update Your Password",
      bodyHTML: body,
      // No footer buttons; we control submission and closing from content.
      buttons: [],
      focusSelector: `#${idNew}`,
      backdrop: "static", // cannot close by clicking outside
      keyboard: false,     // cannot close with ESC
      onContentReady: (modalEl) => {
        // Hide the header close button to prevent dismissal
        try {
          const closeBtn = modalEl.querySelector('.btn-close');
          if (closeBtn) closeBtn.style.display = 'none';
        } catch {}

        const btn = modalEl.querySelector(`#${btnId}`);
        const err = modalEl.querySelector(`#${errId}`);
        const showErr = (msg) => {
          if (!err) return;
          err.textContent = msg || "";
          err.style.display = msg ? "block" : "none";
        };
        const getVals = () => {
          const nw = modalEl.querySelector(`#${idNew}`);
          const cn = modalEl.querySelector(`#${idCon}`);
          return {
            newPassword: (nw?.value || "").trim(),
            confirm: (cn?.value || "").trim(),
          };
        };
        const setBusy = (busy) => {
          if (!btn) return;
          btn.disabled = !!busy;
          btn.textContent = busy ? 'Updating…' : 'Update Password';
        };
        btn?.addEventListener('click', async (e) => {
          e.preventDefault();
          const { newPassword, confirm } = getVals();
          // Client validations with clear errors
          if (!newPassword || newPassword.length < 6) {
            showErr('New password must be at least 6 characters.');
            return;
          }
          if (newPassword !== confirm) {
            showErr('New passwords do not match.');
            return;
          }
          setBusy(true);
          try {
            const r = await authFetch(`${API_BASE}/account/password`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ newPassword }),
            });
            if (!r.ok) {
              // Attempt to show specific error messages
              let msg = 'Failed to update password. Please try again.';
              try {
                const data = await r.json();
                if (data && data.error) msg = String(data.error);
              } catch {}
              showErr(msg);
              setBusy(false);
              return;
            }
            showErr('');
            try { await showNotice({ title: 'Password Updated', message: 'Your password has been changed.' }); } catch {}
            // Close modal after successful update
            try { bootstrap.Modal.getInstance(modalEl)?.hide(); } catch {}
          } catch {
            showErr('Failed to update password. Please check your connection and try again.');
            setBusy(false);
          }
        });
      },
    });
  }

  async function showProfileModal() {
    const idCur = "qbaseProfCur";
    const idNew = "qbaseProfNew";
    const idCon = "qbaseProfCon";
    const delBtnId = "qbaseProfDeleteBtn";
    const saveBtnId = "qbaseProfSaveBtn";
    const errId = "qbaseProfErr";
    const body = `
      <div class="mb-3">
        <h6 class="mb-2">Change Password</h6>
        <div class="mb-2">
          <label for="${idCur}" class="form-label">Current Password</label>
          <input id="${idCur}" class="form-control" type="password" autocomplete="current-password" />
        </div>
        <div class="mb-2">
          <label for="${idNew}" class="form-label">New Password</label>
          <input id="${idNew}" class="form-control" type="password" autocomplete="new-password" />
        </div>
        <div class="mb-2">
          <label for="${idCon}" class="form-label">Confirm New Password</label>
          <input id="${idCon}" class="form-control" type="password" autocomplete="new-password" />
        </div>
        <div id="${errId}" class="text-danger small" style="display:none"></div>
        <button id="${saveBtnId}" class="btn btn-primary">Update Password</button>
      </div>
      <hr/>
      <div class="mt-3">
        <h6 class="mb-2 text-danger">Danger Zone</h6>
        <p class="small text-muted">Deleting your account permanently removes all saved data.</p>
        <button id="${delBtnId}" class="btn btn-outline-danger">Delete Account…</button>
      </div>
    `;
    await showModal({
      title: "Profile",
      bodyHTML: body,
      buttons: [{ text: "Close", className: "btn btn-outline-secondary", value: true }],
      focusSelector: `#${idCur}`,
      onContentReady: (modalEl) => {
        const saveBtn = modalEl.querySelector(`#${saveBtnId}`);
        const delBtn = modalEl.querySelector(`#${delBtnId}`);
        const err = modalEl.querySelector(`#${errId}`);
        const getVals = () => {
          const cur = modalEl.querySelector(`#${idCur}`);
          const nw = modalEl.querySelector(`#${idNew}`);
          const cn = modalEl.querySelector(`#${idCon}`);
          return {
            currentPassword: (cur?.value || "").trim(),
            newPassword: (nw?.value || "").trim(),
            confirm: (cn?.value || "").trim(),
          };
        };
        const showErr = (msg) => {
          if (err) {
            err.textContent = msg || "";
            err.style.display = msg ? "block" : "none";
          }
        };
        saveBtn?.addEventListener('click', async (e) => {
          e.preventDefault();
          const { currentPassword, newPassword, confirm } = getVals();
          if (!newPassword || newPassword.length < 6) {
            showErr("New password must be at least 6 characters.");
            return;
          }
          if (newPassword !== confirm) {
            showErr("New passwords do not match.");
            return;
          }
          try {
            const r = await authFetch(`${API_BASE}/account/password`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ currentPassword, newPassword }),
            });
            if (!r.ok) throw new Error(String(r.status));
            showErr("");
            await showNotice({ title: 'Password Updated', message: 'Your password has been changed.' });
          } catch (e) {
            showErr('Failed to update password. Check current password and try again.');
          }
        });
        delBtn?.addEventListener('click', async (e) => {
          e.preventDefault();
          await doDeleteAccountFlow();
        });
      },
    });
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
          <div class="modal-content">
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
    stack = false,
    onContentReady,
  }) {
    const run = () =>
      new Promise((resolve) => {
        // If stacking is requested, create an ephemeral modal element
        if (stack) {
          const uid = `qbaseModal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const tpl = document.createElement("div");
          tpl.innerHTML = `
            <div class="modal fade" id="${uid}" tabindex="-1" aria-hidden="true">
              <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                  <div class="modal-header border-0">
                    <h5 class="modal-title">Message</h5>
                    <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close"></button>
                  </div>
                  <div class="modal-body"></div>
                  <div class="modal-footer border-0"></div>
                </div>
              </div>
            </div>`;
          const host = tpl.firstElementChild;
          document.body.appendChild(host);

          const modalEl = host;
          const titleEl = modalEl.querySelector(".modal-title");
          const bodyEl = modalEl.querySelector(".modal-body");
          const footEl = modalEl.querySelector(".modal-footer");

          titleEl.textContent = title || "Message";
          bodyEl.innerHTML = bodyHTML || "";
          footEl.innerHTML = "";

          if (onContentReady && typeof onContentReady === "function") {
            onContentReady(modalEl);
          }

          let result = undefined;
          const onHidden = () => {
            modalEl.removeEventListener("hidden.bs.modal", onHidden);
            // remove the ephemeral modal from DOM on close
            try { modalEl.parentElement?.removeChild(modalEl); } catch {}
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

          // Raise z-index to appear above any currently open modal and adjust backdrop
          modalEl.addEventListener("shown.bs.modal", () => {
            try {
              const openCount = document.querySelectorAll('.modal.show').length;
              const z = 1055 + openCount * 20;
              modalEl.style.zIndex = String(z);
              const bds = document.querySelectorAll('.modal-backdrop');
              const lastBd = bds[bds.length - 1];
              if (lastBd) lastBd.style.zIndex = String(z - 5);
            } catch {}
          }, { once: true });

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
          return;
        }

        // Default: use singleton host and queue to avoid overlap
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
      });
    return stack ? run() : queueModal(run);
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
      stack: true,
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
      stack: true,
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
      stack: true,
    });
  }

  // Expose globally for assignment.js
  window.showConfirm = showConfirm;
  window.showPrompt = showPrompt;
  window.showNotice = showNotice;
  window.showModal = showModal;

  // -------------------- Backend helpers --------------------
  async function whoAmI() {
    const token = (typeof qbGetToken === "function" ? qbGetToken() : "") || "";

    // In dev, prefer auto-login to a real server account if configured.
    if (IS_DEV && !DEV_NO_AUTO && !FORCE_LOGIN) {
      const devCfg = await loadDevAutoConfig();
      if (devCfg && devCfg.autoLogin && devCfg.username && devCfg.password) {
        // If no real token (or a dev stub), attempt auto-login.
        let needsLogin = !token || token === "dev-token";
        // If there is some token, verify it; if invalid, we will re-login below.
        if (!needsLogin) {
          try {
            const r0 = await authFetch(`${API_BASE}/me`);
            if (!r0.ok) needsLogin = true;
          } catch {
            needsLogin = true;
          }
        }
        if (needsLogin) {
          try {
            const r = await fetch(`${API_BASE}/login`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                username: String(devCfg.username || "").trim(),
                password: String(devCfg.password || ""),
              }),
            });
            if (r.ok) {
              const data = await r.json();
              if (data && data.token) {
                qbSetToken(data.token);
              }
            }
          } catch {}
        }
        // After ensuring token, ask server who we are.
        try {
          const r = await authFetch(`${API_BASE}/me`);
          if (r.ok) {
            const u = await r.json();
            if (u && u.username) return u;
          }
        } catch {}
        // If dev auto-login is configured, do not fall back to dummy unless forced.
        if (!FORCE_LOGIN) return null;
      }
    }

    // Standard path: ask the server.
    try {
      const r = await authFetch(`${API_BASE}/me`);
      if (!r.ok) throw new Error(String(r.status));
      const u = await r.json();
      return u && u.username ? u : null;
    } catch {
      // Legacy dev fallback only when no auto-login is configured and not forcing login.
      if (IS_DEV && !FORCE_LOGIN) {
        const devName = localStorage.getItem("qbase.dev.user") || "Dev";
        try {
          if (!token) qbSetToken("dev-token");
        } catch {}
        // Return a stub identity just to keep UI usable offline.
        return { username: devName };
      }
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
    try { sessionStorage.setItem("qbase.dev.noAutoLogin", "1"); } catch {}
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
  // Build Profile entry dynamically if missing, and move Delete Account into Profile modal
  (function setupProfileEntry() {
    try {
      // Hide existing Delete Account item if present
      if (deleteAccountLink) {
        const li = deleteAccountLink.closest('li');
        if (li) li.classList.add('d-none');
      }
      if (!profileLink && userDropdownMenu) {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.className = 'dropdown-item';
        a.href = '#';
        a.id = 'nav-profile';
        a.textContent = 'Profile';
        li.appendChild(a);
        // Insert as first item
        userDropdownMenu.insertBefore(li, userDropdownMenu.firstElementChild || null);
        profileLink = a;
      }
      profileLink?.addEventListener('click', (e) => {
        e.preventDefault();
        showProfileModal();
      });
    } catch {}
  })();

  (async () => {
    const me = await whoAmI();
    if (me?.username) {
      setLoggedInUI(me.username);
      broadcastLogin(me.username);
      hideLoginGate();
      try {
        if (me.mustChangePassword) {
          await showChangePasswordFlow();
        }
      } catch {}
    } else {
      setLoggedOutUI();
      if ((!IS_DEV || FORCE_LOGIN) && !isAuthenticated) {
        showLoginGate();
      } else if (IS_DEV && !isAuthenticated) {
        // If dev auto-login is configured but failed, show the gate.
        const cfg = await loadDevAutoConfig();
        if (cfg && cfg.autoLogin) showLoginGate();
      }
    }
  })();

  // Hide gate on login event
  window.addEventListener("qbase:login", () => hideLoginGate());
  window.addEventListener("qbase:force-login", showLoginGate);
})();
