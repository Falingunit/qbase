"use strict";

(async () => {
  await loadConfig();

  const PYQ_ICON_FALLBACK = "https://via.placeholder.com/48?text=PYQ";
  const PYQ_CHAPTER_ICON_BASE = "https://web.getmarks.app/icons/exam/";

  let allTests = [];
  let starredIds = new Set();
  let lastSearch = "";

  const els = {
    loading: document.getElementById("tests-loading"),
    error: document.getElementById("tests-error"),
    empty: document.getElementById("tests-empty"),
    content: document.getElementById("tests-content"),
    grid: document.getElementById("tests-grid"),
    pausedWrap: document.getElementById("tests-paused-wrap"),
    pausedGrid: document.getElementById("tests-paused"),
    pausedCount: document.getElementById("tests-paused-count"),
    attemptedWrap: document.getElementById("tests-attempted-wrap"),
    attemptedCount: document.getElementById("tests-attempted-count"),
    unattemptedWrap: document.getElementById("tests-unattempted-wrap"),
    unattemptedGrid: document.getElementById("tests-unattempted"),
    unattemptedCount: document.getElementById("tests-unattempted-count"),
    search: document.getElementById("table-search-input"),
    clear: document.getElementById("tests-clear-btn"),
    addById: document.getElementById("tests-add-by-id-btn"),
    create: document.getElementById("tests-create-btn"),
    emptyCreate: document.getElementById("tests-empty-create-btn"),
    starredWrap: document.getElementById("tests-starred-wrap"),
    starredGrid: document.getElementById("tests-starred"),
    starredCount: document.getElementById("tests-starred-count"),
  };

  wireNavbarToLocalSearch();
  bindActions();
  window.addEventListener("qbase:login", refreshStarredState);
  window.addEventListener("qbase:logout", refreshStarredState);

  await init();

  async function init() {
    setVisible(els.loading, true);
    setVisible(els.content, false);
    setVisible(els.error, false);
    setVisible(els.empty, false);

    try {
      const [tests, starred] = await Promise.all([
        TestsService.fetchTests(),
        TestsService.fetchStarred(),
      ]);
      allTests = TestsService.normalizeTests(tests);
      starredIds = new Set((starred || []).map(String));

      render();
      setVisible(els.loading, false);
      setVisible(els.content, true);
      syncEmptyState();
      await maybeOpenDuplicateModal();
    } catch (err) {
      console.error(err);
      showError("Failed to load tests.");
      setVisible(els.loading, false);
    }
  }

  function wireNavbarToLocalSearch() {
    const globalInput = document.getElementById("navbar-search-input");
    const globalBtn = document.getElementById("navbar-search-btn");
    if (globalInput && els.search) {
      globalInput.addEventListener("input", () => {
        els.search.value = globalInput.value;
        applyFilter();
      });
    }
    globalBtn?.addEventListener("click", applyFilter);
  }

  function bindActions() {
    let debounceId;
    els.search?.addEventListener("input", () => {
      clearTimeout(debounceId);
      debounceId = setTimeout(applyFilter, 120);
    });
    els.clear?.addEventListener("click", () => {
      els.search.value = "";
      applyFilter();
      els.search.focus();
    });
    els.addById?.addEventListener("click", handleAddByIdClick);
    els.create?.addEventListener("click", handleCreateClick);
    els.emptyCreate?.addEventListener("click", handleCreateClick);
  }

  function applyFilter() {
    lastSearch = (els.search?.value || "").trim().toLowerCase();
    els.clear?.classList.toggle("d-none", !lastSearch);
    render();
    syncEmptyState();
  }

  async function refreshStarredState() {
    starredIds = new Set((await TestsService.fetchStarred()).map(String));
    render();
    syncEmptyState();
  }

  function render() {
    const visible = getVisibleTests();
    renderStarred(visible.filter((test) => starredIds.has(test.testId)));
    renderSections(visible.filter((test) => !starredIds.has(test.testId)));
  }

  function renderStarred(tests) {
    els.starredGrid.innerHTML = "";
    if (!tests.length) {
      els.starredWrap.classList.add("d-none");
      els.starredCount.textContent = "";
      return;
    }

    tests.forEach((test) => {
      const card = cardFor(test);
      card.classList.add("anim-enter");
      els.starredGrid.appendChild(card);
    });
    els.starredCount.textContent = `(${tests.length})`;
    els.starredWrap.classList.remove("d-none");
  }

  function renderSections(tests) {
    const paused = tests.filter((test) => getSectionKind(test) === "paused");
    const attempted = tests.filter((test) => getSectionKind(test) === "attempted");
    const unattempted = tests.filter((test) => getSectionKind(test) === "unattempted");

    els.pausedGrid.innerHTML = "";
    els.grid.innerHTML = "";
    els.unattemptedGrid.innerHTML = "";

    paused.forEach((test) => {
      const card = cardFor(test);
      card.classList.add("anim-enter");
      els.pausedGrid.appendChild(card);
    });
    attempted.forEach((test) => {
      const card = cardFor(test);
      card.classList.add("anim-enter");
      els.grid.appendChild(card);
    });
    unattempted.forEach((test) => {
      const card = cardFor(test);
      card.classList.add("anim-enter");
      els.unattemptedGrid.appendChild(card);
    });

    els.pausedWrap.classList.toggle("d-none", paused.length === 0);
    els.attemptedWrap.classList.toggle("d-none", attempted.length === 0);
    els.unattemptedWrap.classList.toggle("d-none", unattempted.length === 0);
    els.pausedCount.textContent = paused.length ? `(${paused.length})` : "";
    els.attemptedCount.textContent = attempted.length ? `(${attempted.length})` : "";
    els.unattemptedCount.textContent = unattempted.length
      ? `(${unattempted.length})`
      : "";
  }

  function getVisibleTests() {
    if (!lastSearch) return allTests.slice();
    return allTests.filter((test) =>
      [test.title, test.creator, test.createdAt]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(lastSearch)
    );
  }

  function syncEmptyState() {
    const hasAnyTests = allTests.length > 0;
    const hasVisibleTests = getVisibleTests().length > 0;
    setVisible(els.empty, !hasVisibleTests);
    els.empty.querySelector("h4").textContent = hasAnyTests
      ? "No matching tests"
      : "No tests yet";
    els.empty.querySelector("p").textContent = hasAnyTests
      ? "Try a different search or clear the filter."
      : "Create your first test to start building the collection.";
    setVisible(els.emptyCreate, !hasAnyTests);
  }

  function cardFor(test) {
    const card = document.createElement("div");
    card.className = "card as-card tests-card h-100";
    card.dataset.testId = String(test.testId);
    if (starredIds.has(test.testId)) card.classList.add("as-starred");

    const attempted = Number.isFinite(test.attempted) ? test.attempted : 0;
    const totalQuestions = Number.isFinite(test.totalQuestions)
      ? test.totalQuestions
      : 0;
    const score = Number.isFinite(test.score) ? test.score : null;
    const maxScore = Number.isFinite(test.maxScore) ? test.maxScore : null;
    const pct = totalQuestions
      ? Math.round((attempted / totalQuestions) * 100)
      : 0;
    const sectionKind = getSectionKind(test);
    const statusClass = attempted > 0 ? "started" : "";
    if (statusClass) card.classList.add(statusClass);

    const body = document.createElement("div");
    body.className = "card-body d-flex flex-column gap-2";

    const title = document.createElement("h5");
    title.className = "card-title mb-1";
    title.textContent = test.title || "Untitled Test";

    const meta = document.createElement("div");
    meta.className = "as-meta tests-meta";
    meta.innerHTML = `
      <div>Date Created: <strong>${escapeHtml(test.createdAt || "Not set")}</strong></div>
      <div>Creator: <strong>${escapeHtml(test.creator || "Unknown")}</strong></div>
    `;

    const footer = document.createElement("div");
    footer.className = "card-footer bg-transparent border-0 as-actions pt-0";
    if (sectionKind === "paused") {
      const rank = Number.isFinite(test.rank) ? test.rank : null;
      if (rank) {
        const rankInfo = document.createElement("div");
        rankInfo.className = "d-flex justify-content-end mb-2";
        rankInfo.innerHTML = `<span class="badge bg-success">Rank #${rank}</span>`;
        footer.append(rankInfo);
      }
      const progressWrap = document.createElement("div");
      progressWrap.className = "as-progress w-100";
      progressWrap.innerHTML = `<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div class="progress-bar bg-success" style="width:${pct}%">${attempted}/${totalQuestions} attempted</div></div>`;
      footer.append(progressWrap);
    } else if (attempted > 0) {
      const info = document.createElement("div");
      info.className =
        "d-flex align-items-center justify-content-between flex-wrap gap-2 mb-2";
      const scoreSpan = document.createElement("span");
      scoreSpan.className = "as-score";
      const rank = Number.isFinite(test.rank) ? test.rank : null;
      scoreSpan.innerHTML =
        score !== null && maxScore !== null
          ? `<span class="badge bg-primary">${score} / ${maxScore}</span>${
              rank ? ` <span class="badge bg-success">Rank #${rank}</span>` : ""
            }`
          : '<span class="badge bg-secondary">-</span>';
      info.append(scoreSpan);

      const progressWrap = document.createElement("div");
      progressWrap.className = "as-progress w-100";
      progressWrap.innerHTML = `<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div class="progress-bar bg-success" style="width:${pct}%">${pct}% (${attempted}/${totalQuestions})</div></div>`;
      footer.append(info, progressWrap);
    } else {
      footer.classList.add("d-none");
    }

    const shareBtn = document.createElement("button");
    shareBtn.type = "button";
    shareBtn.className = "tests-share-btn btn btn-sm btn-link p-0 m-0";
    shareBtn.innerHTML = '<i class="bi bi-share"></i>';
    shareBtn.title = "Share";
    shareBtn.setAttribute("aria-label", "Share test");
    shareBtn.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await handleShareClick(test);
    });

    const starBtn = document.createElement("button");
    starBtn.type = "button";
    starBtn.className = "as-star-btn btn btn-sm btn-link p-0 m-0";
    syncStarButton(starBtn, starredIds.has(test.testId));
    starBtn.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const makeStarred = !starredIds.has(test.testId);
      if (makeStarred) starredIds.add(test.testId);
      else starredIds.delete(test.testId);
      render();
      syncEmptyState();
      try {
        await TestsService.toggleStar(test.testId, makeStarred);
      } catch (error) {
        console.error(error);
        if (makeStarred) starredIds.delete(test.testId);
        else starredIds.add(test.testId);
        render();
        syncEmptyState();
        showError("Failed to update starred tests.");
      }
    });

    body.append(title, meta);
    card.append(shareBtn, starBtn, body, footer);
    card.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      openTestOverview(test);
    });
    return card;
  }

  function openTestOverview(test) {
    const testId = String(test?.testId || "").trim();
    if (!testId) return;
    const url = new URL("./test_overview.html", window.location.href);
    url.searchParams.set("testId", String(testId));
    window.location.href = url.toString();
  }

  async function handleCreateClick() {
    await openCreateTestModal();
  }

  async function handleAddByIdClick() {
    const inputId = "tests-add-by-id-input";
    const result = await showModal({
      title: "Add Test",
      bodyHTML: `
        <div class="tests-add-by-id-modal">
          <label for="${inputId}" class="form-label">Test ID</label>
          <input id="${inputId}" class="form-control" autocomplete="off" placeholder="Enter shared test id">
          <div class="form-text">Add a shared test to your Tests tab using its test id.</div>
        </div>
      `,
      focusSelector: `#${inputId}`,
      buttons: [
        { text: "Cancel", className: "btn btn-outline-secondary", value: "cancel" },
        {
          text: "Add Test",
          className: "btn btn-primary",
          value: "add",
        },
      ],
    });
    if (result !== "add") return;
    const submittedId = String(document.getElementById(inputId)?.value || "").trim();
    if (!submittedId) return;
    try {
      await TestsService.addTestById(submittedId);
      const [tests, starred] = await Promise.all([
        TestsService.fetchTests(),
        TestsService.fetchStarred(),
      ]);
      allTests = TestsService.normalizeTests(tests);
      starredIds = new Set((starred || []).map(String));
      render();
      syncEmptyState();
      if (typeof showNotice === "function") {
        await showNotice({ title: "Add Test", message: "Test added." });
      }
    } catch (error) {
      console.error(error);
      const message = error?.message || "Failed to add test.";
      if (typeof showNotice === "function") {
        await showNotice({ title: "Add Test", message });
      } else {
        alert(message);
      }
    }
  }

  async function maybeOpenDuplicateModal() {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("duplicateTestId")) return;
    const duplicateTestId = String(params.get("duplicateTestId") || "").trim();
    if (!duplicateTestId) return;
    params.delete("duplicateTestId");
    const nextUrl = `${window.location.pathname}${
      params.toString() ? `?${params.toString()}` : ""
    }${window.location.hash || ""}`;
    window.history.replaceState({}, "", nextUrl);
    try {
      const test = await TestsService.fetchTest(duplicateTestId);
      const draft = {
        ...(test.config || {}),
        testName: `${test.config?.testName || test.title || "Untitled test"} Copy`,
        testDescription:
          test.config?.testDescription || test.description || "",
        shareWith: Array.isArray(test.config?.shareWith)
          ? test.config.shareWith
          : Array.isArray(test.shareWith)
          ? test.shareWith
          : [],
        questionReusePolicy:
          test.config?.questionReusePolicy ||
          test.questionReusePolicy ||
          undefined,
      };
      await openCreateTestModal(draft);
    } catch (error) {
      console.error(error);
      showError("Failed to load test for duplication.");
    }
  }

  async function handleShareClick(test) {
    const testId = String(test?.testId || "").trim();
    if (!testId) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(testId);
        if (typeof showNotice === "function") {
          await showNotice({
            title: "Share Test",
            message: "Test ID copied to clipboard.",
          });
          return;
        }
      }
    } catch {}

    if (typeof showNotice === "function") {
      await showNotice({
        title: "Share Test",
        message: `Test ID: ${testId}`,
      });
      return;
    }

    alert(`Test ID: ${testId}`);
  }

  async function openCreateTestModal(draft = {}) {
    const [sourceOptions, bookmarkTags, shareUsers] = await Promise.all([
      loadQuestionSourceOptions(),
      loadBookmarkTags(),
      TestsService.fetchShareUsers().catch(() => []),
    ]);
    const shareUsernames = shareUsers
      .map((user) => String(user.username || "").trim())
      .filter(Boolean);
    const formId = "create-test-form";
    const nameId = "create-test-name";
    const descId = "create-test-description";
    const shareInputId = "create-test-share-input";
    const shareFieldId = "create-test-share-field";
    const shareTagsId = "create-test-share-tags";
    const shareSuggestionsId = "create-test-share-suggestions";
    const sectionTabsId = "create-test-section-tabs";
    const sectionPanelsId = "create-test-section-panels";
    const sourceTopTabsId = "create-test-source-top-tabs";
    const sourceTopPanelsId = "create-test-source-top-panels";
    const sourceReuseHostId = "create-test-source-reuse";
    const configHostId = "create-test-blueprint";
    const reviewHostId = "create-test-review";
    const initialShareWith = Array.isArray(draft.shareWith)
      ? draft.shareWith
      : [];
    const bodyHTML = `
      <form id="${formId}" class="tests-create-form" novalidate>
        <div class="tests-create-form-tabs-wrap overflow-x-auto">
          <ul id="${sectionTabsId}" class="nav nav-tabs flex-nowrap mb-3 rounded-top tests-create-form-tabs">
            <li class="nav-item" role="presentation">
              <button
                type="button"
                class="nav-link tests-create-form-tab active"
                data-form-tab="details"
              >
                Test Details
              </button>
            </li>
            <li class="nav-item" role="presentation">
              <button
                type="button"
                class="nav-link tests-create-form-tab"
                data-form-tab="sources"
              >
                Question Sources
              </button>
            </li>
            <li class="nav-item" role="presentation">
              <button
                type="button"
                class="nav-link tests-create-form-tab"
                data-form-tab="blueprint"
              >
                Test Blueprint
              </button>
            </li>
            <li class="nav-item" role="presentation">
              <button
                type="button"
                class="nav-link tests-create-form-tab"
                data-form-tab="review"
              >
                Review & Create
              </button>
            </li>
          </ul>
        </div>
        <div id="${sectionPanelsId}" class="tests-create-form-panels">
          <section class="tests-create-section tests-create-form-panel active" data-form-panel="details">
            <div>
              <label for="${nameId}" class="form-label">Test name</label>
              <input
                id="${nameId}"
                name="testName"
                type="text"
                class="form-control"
                placeholder="Enter test name"
                value="${escapeAttr(draft.testName || "")}"
                autocomplete="off"
              />
              <div class="invalid-feedback">Test name is required.</div>
            </div>
            <div>
              <label for="${descId}" class="form-label">Test description</label>
              <textarea
                id="${descId}"
                name="testDescription"
                class="form-control"
                rows="3"
                placeholder="Enter test description"
              >${escapeHtml(draft.testDescription || "")}</textarea>
            </div>
            <div>
              <label for="${shareInputId}" class="form-label">Share With</label>
              <div class="tests-tag-field" id="${shareFieldId}">
                <div class="tests-tag-list" id="${shareTagsId}"></div>
                <input
                  id="${shareInputId}"
                  type="text"
                  class="tests-tag-input"
                  placeholder="Type a username"
                  autocomplete="off"
                  spellcheck="false"
                />
              </div>
              <div class="tests-tag-suggestions d-none" id="${shareSuggestionsId}"></div>
            </div>
          </section>
          <section class="tests-create-section tests-create-form-panel" data-form-panel="sources">
            <div class="tests-source-picker">
              <div class="tests-source-tabs-card">
                <div class="tests-source-tabs" id="${sourceTopTabsId}"></div>
                <div class="tests-source-panels" id="${sourceTopPanelsId}"></div>
                <div id="${sourceReuseHostId}" class="tests-source-reuse-host"></div>
              </div>
            </div>
          </section>
          <section class="tests-create-section tests-create-form-panel" data-form-panel="blueprint">
            <div id="${configHostId}"></div>
          </section>
          <section class="tests-create-section tests-create-form-panel" data-form-panel="review">
            <div id="${reviewHostId}"></div>
          </section>
        </div>
      </form>
    `;

    let submittedDraft = null;
    await showModal({
      title: "Create Test",
      bodyHTML,
      focusSelector: `#${nameId}`,
      dialogClass: "modal-lg",
      buttons: [],
      onContentReady: (modalEl) => {
        const form = modalEl.querySelector(`#${formId}`);
        const nameInput = modalEl.querySelector(`#${nameId}`);
        const descInput = modalEl.querySelector(`#${descId}`);
        const shareField = modalEl.querySelector(`#${shareFieldId}`);
        const shareTags = modalEl.querySelector(`#${shareTagsId}`);
        const shareInput = modalEl.querySelector(`#${shareInputId}`);
        const shareSuggestions = modalEl.querySelector(`#${shareSuggestionsId}`);
        const sectionTabs = modalEl.querySelector(`#${sectionTabsId}`);
        const sectionPanels = modalEl.querySelector(`#${sectionPanelsId}`);
        const sourceTopTabs = modalEl.querySelector(`#${sourceTopTabsId}`);
        const sourceTopPanels = modalEl.querySelector(`#${sourceTopPanelsId}`);
        const sourceReuseHost = modalEl.querySelector(`#${sourceReuseHostId}`);
        const configHost = modalEl.querySelector(`#${configHostId}`);
        const reviewHost = modalEl.querySelector(`#${reviewHostId}`);
        const footerEl = modalEl.querySelector("#qbaseModalFooter");
        const sectionOrder = Array.from(
          sectionTabs?.querySelectorAll(".tests-create-form-tab") || []
        ).map((el) => String(el.dataset.formTab || ""));
        let activeSection = sectionOrder[0] || "details";
        const state = {
          selected: Array.from(new Set(initialShareWith.map((x) => String(x).trim()).filter(Boolean))),
          highlightedIndex: 0,
        };
        const sourceSelectionState =
          draft.sourceSelectionsRaw || draft.sourceSelections || {};
        const globalFilterState =
          draft.globalFilters && typeof draft.globalFilters === "object"
            ? draft.globalFilters
            : {
                assignment: getDefaultSourceFilters("assignment"),
                pyq: getDefaultSourceFilters("pyq"),
              };
        const testBlueprintState = normalizeTestBlueprint(draft.testBlueprint);
        const questionReusePolicy = normalizeQuestionReusePolicy(
          draft.questionReusePolicy
        );
        let refreshBlueprintAvailability = null;
        let renderReview = null;

        nameInput?.addEventListener("input", () => {
          nameInput.classList.remove("is-invalid");
        });

        const closeSuggestions = () => {
          shareSuggestions.classList.add("d-none");
          shareSuggestions.innerHTML = "";
          state.highlightedIndex = 0;
        };

        const getMatches = () => {
          const query = (shareInput.value || "").trim().toLowerCase();
          if (!query) return [];
          return shareUsernames.filter((username) => {
            const lowered = username.toLowerCase();
            return lowered.includes(query) && !state.selected.includes(username);
          }).slice(0, 6);
        };

        const renderTags = () => {
          shareTags.innerHTML = "";
          state.selected.forEach((username) => {
            const tag = document.createElement("span");
            tag.className = "tests-tag-chip";
            tag.innerHTML = `
              <span>${escapeHtml(username)}</span>
              <button type="button" class="tests-tag-chip-remove" aria-label="Remove ${escapeAttr(
                username
              )}" title="Remove ${escapeAttr(username)}">
                <i class="bi bi-x-lg"></i>
              </button>
            `;
            tag
              .querySelector(".tests-tag-chip-remove")
              ?.addEventListener("click", () => {
                state.selected = state.selected.filter((item) => item !== username);
                renderTags();
                renderSuggestions();
                shareInput.focus();
            });
            shareTags.appendChild(tag);
          });
          shareInput.placeholder = state.selected.length
            ? ""
            : "Type a username";
        };

        const addUsername = (rawUsername) => {
          const username = String(rawUsername || "").trim();
          if (
            !username ||
            state.selected.includes(username) ||
            !shareUsernames.includes(username)
          ) return;
          state.selected.push(username);
          shareInput.value = "";
          renderTags();
          closeSuggestions();
        };

        const renderSuggestions = () => {
          const matches = getMatches();
          if (!matches.length) {
            closeSuggestions();
            return;
          }
          if (state.highlightedIndex >= matches.length) state.highlightedIndex = 0;
          shareSuggestions.innerHTML = "";
          matches.forEach((username, index) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = `tests-tag-suggestion${
              index === state.highlightedIndex ? " active" : ""
            }`;
            btn.textContent = username;
            btn.addEventListener("mousedown", (event) => {
              event.preventDefault();
              addUsername(username);
            });
            shareSuggestions.appendChild(btn);
          });
          shareSuggestions.classList.remove("d-none");
        };

        shareField?.addEventListener("click", () => shareInput?.focus());
        shareInput?.addEventListener("input", () => {
          state.highlightedIndex = 0;
          renderSuggestions();
        });
        shareInput?.addEventListener("keydown", (event) => {
          const matches = getMatches();
          if ((event.key === "Tab" || event.key === "Enter") && matches.length) {
            event.preventDefault();
            addUsername(matches[state.highlightedIndex] || matches[0]);
            return;
          }
          if (event.key === "ArrowDown" && matches.length) {
            event.preventDefault();
            state.highlightedIndex = (state.highlightedIndex + 1) % matches.length;
            renderSuggestions();
            return;
          }
          if (event.key === "ArrowUp" && matches.length) {
            event.preventDefault();
            state.highlightedIndex =
              (state.highlightedIndex - 1 + matches.length) % matches.length;
            renderSuggestions();
            return;
          }
          if (
            event.key === "Backspace" &&
            !shareInput.value &&
            state.selected.length
          ) {
            state.selected.pop();
            renderTags();
            renderSuggestions();
          }
        });
        shareInput?.addEventListener("blur", () => {
          window.setTimeout(closeSuggestions, 120);
        });

        modalEl.__createTestDraft = {
          getValue() {
            return {
              testName: (nameInput?.value || "").trim(),
              testDescription: (descInput?.value || "").trim(),
              shareWith: state.selected.slice(),
              globalFilters: structuredCloneSafe(globalFilterState),
              testBlueprint: serializeTestBlueprint(testBlueprintState),
              questionReusePolicy: structuredCloneSafe(questionReusePolicy),
              sourceSelections: buildEffectiveSourceSelections(
                sourceSelectionState,
                globalFilterState
              ),
              sourceSelectionsRaw: compactSourceSelectionState(sourceSelectionState),
            };
          },
        };

        const setActiveSection = (key) => {
          activeSection = sectionOrder.includes(key) ? key : sectionOrder[0];
          sectionTabs
            ?.querySelectorAll(".tests-create-form-tab")
            .forEach((el) =>
              el.classList.toggle("active", el.dataset.formTab === activeSection)
            );
          sectionPanels
            ?.querySelectorAll(".tests-create-form-panel")
            .forEach((el) =>
              el.classList.toggle("active", el.dataset.formPanel === activeSection)
            );
          if (activeSection === "blueprint") refreshBlueprintAvailability?.();
          if (activeSection === "review") renderReview?.();
          renderFooter();
        };

        const submitCreate = () => {
          const draftValue = modalEl.__createTestDraft?.getValue?.() || {
            testName: (nameInput?.value || "").trim(),
            testDescription: "",
            shareWith: [],
            globalFilters: {},
            testBlueprint: serializeTestBlueprint(),
            questionReusePolicy: normalizeQuestionReusePolicy(),
            sourceSelections: {},
          };
          const testName = String(draftValue.testName || "").trim();
          if (!testName) {
            nameInput?.classList.add("is-invalid");
            setActiveSection("details");
            nameInput?.focus();
            return;
          }
          submittedDraft = draftValue;
          bootstrap.Modal.getInstance(modalEl)?.hide();
        };

        const renderFooter = () => {
          if (!footerEl) return;
          const currentIndex = Math.max(0, sectionOrder.indexOf(activeSection));
          const isFirst = currentIndex <= 0;
          const isLast = currentIndex >= sectionOrder.length - 1;

          footerEl.innerHTML = "";

          const secondaryBtn = document.createElement("button");
          secondaryBtn.type = "button";
          secondaryBtn.className = "btn btn-outline-secondary";
          secondaryBtn.textContent = isFirst ? "Cancel" : "Previous";
          secondaryBtn.addEventListener("click", () => {
            if (isFirst) {
              bootstrap.Modal.getInstance(modalEl)?.hide();
              return;
            }
            setActiveSection(sectionOrder[currentIndex - 1]);
          });
          footerEl.appendChild(secondaryBtn);

          const primaryBtn = document.createElement("button");
          primaryBtn.type = "button";
          primaryBtn.className = "btn btn-primary";
          primaryBtn.textContent = isLast ? "Create Test" : "Next";
          primaryBtn.addEventListener("click", () => {
            if (isLast) {
              submitCreate();
              return;
            }
            setActiveSection(sectionOrder[currentIndex + 1]);
          });
          footerEl.appendChild(primaryBtn);
        };

        sectionTabs
          ?.querySelectorAll(".tests-create-form-tab")
          .forEach((tabBtn) => {
            tabBtn.addEventListener("click", () => {
              setActiveSection(tabBtn.dataset.formTab);
            });
          });

        renderTags();
        renderSourcePicker(
          sourceTopTabs,
          sourceTopPanels,
          sourceOptions,
          sourceSelectionState,
          bookmarkTags,
          globalFilterState
        );
        renderQuestionReusePolicySourceEditor({
          host: sourceReuseHost,
          reusePolicy: questionReusePolicy,
          priorTests: allTests,
        });
        refreshBlueprintAvailability = renderTestBlueprintStep({
          host: configHost,
          state: testBlueprintState,
          sourceOptions,
          sourceSelectionState,
          globalFilterState,
          questionReusePolicy,
          priorTests: allTests,
        });
        renderReview = () => {
          renderCreateTestReview({
            host: reviewHost,
            draftValue: modalEl.__createTestDraft?.getValue?.(),
            sourceOptions,
          });
        };
        renderReview();
        form?.addEventListener("submit", (event) => {
          event.preventDefault();
          modalEl.querySelector(".modal-footer .btn.btn-primary")?.click();
        });
        renderFooter();
      },
    });

    if (!submittedDraft) return;
    const draftValue = submittedDraft;
    try {
      const created = await TestsService.createTest(draftValue);
      allTests = TestsService.normalizeTests([created]).concat(allTests);
      render();
      setVisible(els.content, true);
      syncEmptyState();
    } catch (error) {
      console.error(error);
      const message = error?.message || "Failed to create test.";
      if (typeof showNotice === "function") {
        await showNotice({
          title: "Create Test",
          message,
        });
        return;
      }
      alert(message);
    }
  }

  function syncStarButton(btn, isStarred) {
    btn.innerHTML = isStarred
      ? '<i class="bi bi-star-fill"></i>'
      : '<i class="bi bi-star"></i>';
    btn.title = isStarred ? "Unstar" : "Star";
  }

  function normalizeTestBlueprint(value) {
    const sections = Array.isArray(value?.sections)
      ? value.sections
      : [
          {
            id: makeBlueprintSectionId(),
            name: "Section A",
            type: "single",
            questionCount: 10,
            positiveMarks: 4,
            negativeMarks: 1,
          },
        ];
    return {
      preset: value?.preset || "custom",
      timeLimitMinutes: Math.max(
        0,
        Number(
          value?.timeLimitMinutes ??
            (Number(value?.timeLimitSeconds) > 0
              ? Number(value.timeLimitSeconds) / 60
              : 0)
        ) || 0
      ),
      sections: sections.map((section, index) => ({
        id: section.id || makeBlueprintSectionId(),
        name: String(section.name || `Section ${String.fromCharCode(65 + index)}`),
        type: normalizeBlueprintQuestionType(section.type),
        questionCount: Math.max(0, Number(section.questionCount) || 0),
        positiveMarks: Number(section.positiveMarks ?? 4),
        negativeMarks: Number(section.negativeMarks ?? 0),
      })),
    };
  }

  function serializeTestBlueprint(state) {
    const normalized = normalizeTestBlueprint(state);
    return {
      ...normalized,
      timeLimitSeconds: Math.max(
        0,
        Math.round(Number(normalized.timeLimitMinutes || 0) * 60)
      ),
    };
  }

  function makeBlueprintSectionId() {
    return `section_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function makeBlueprintSection({
    name,
    type,
    questionCount,
    positiveMarks,
    negativeMarks,
  }) {
    return {
      id: makeBlueprintSectionId(),
      name,
      type: normalizeBlueprintQuestionType(type),
      questionCount: Math.max(0, Number(questionCount) || 0),
      positiveMarks: Number(positiveMarks ?? 4),
      negativeMarks: Number(negativeMarks ?? 0),
    };
  }

  function getBlueprintPresets() {
    return [
      { id: "custom", label: "Custom" },
      {
        id: "all-selected",
        label: "All selected questions",
        buildSections: (availability) => {
          const totals = sumBlueprintAvailability(availability);
          return [
            makeBlueprintSection({
              name: "Single Correct",
              type: "single",
              questionCount: totals.single,
              positiveMarks: 4,
              negativeMarks: 1,
            }),
            makeBlueprintSection({
              name: "Multiple Correct",
              type: "multiple",
              questionCount: totals.multiple,
              positiveMarks: 4,
              negativeMarks: 0,
            }),
            makeBlueprintSection({
              name: "Numerical",
              type: "numerical",
              questionCount: totals.numerical,
              positiveMarks: 4,
              negativeMarks: 0,
            }),
          ];
        },
      },
      {
        id: "jee-main",
        label: "JEE Main",
        buildSections: () => [
          makeBlueprintSection({
            name: "Single Correct",
            type: "single",
            questionCount: 20,
            positiveMarks: 4,
            negativeMarks: 1,
          }),
          makeBlueprintSection({
            name: "Numerical",
            type: "numerical",
            questionCount: 5,
            positiveMarks: 4,
            negativeMarks: 0,
          }),
        ],
      },
      {
        id: "jee-advanced",
        label: "JEE Advanced",
        buildSections: () => [
          makeBlueprintSection({
            name: "Single Correct",
            type: "single",
            questionCount: 6,
            positiveMarks: 3,
            negativeMarks: 1,
          }),
          makeBlueprintSection({
            name: "Multiple Correct",
            type: "multiple",
            questionCount: 6,
            positiveMarks: 4,
            negativeMarks: 2,
          }),
          makeBlueprintSection({
            name: "Numerical",
            type: "numerical",
            questionCount: 6,
            positiveMarks: 4,
            negativeMarks: 0,
          }),
        ],
      },
    ];
  }

  function getBlueprintPresetLabel(presetId) {
    return (
      getBlueprintPresets().find((preset) => preset.id === presetId)?.label ||
      "Custom"
    );
  }

  function renderBlueprintPresetDropdown(presetId) {
    return `
      <div class="dropdown tests-blueprint-dropdown">
        <button class="btn btn-sm btn-outline-secondary dropdown-toggle tests-blueprint-preset-btn" type="button" data-bs-toggle="dropdown" aria-expanded="false">
          ${escapeHtml(getBlueprintPresetLabel(presetId || "custom"))}
        </button>
        <ul class="dropdown-menu">
          ${getBlueprintPresets()
            .map(
              (preset) => `
                <li>
                  <button type="button" class="dropdown-item tests-blueprint-preset-item ${
                    preset.id === presetId ? "active" : ""
                  }" data-preset-id="${escapeAttr(preset.id)}">
                    ${escapeHtml(preset.label)}
                  </button>
                </li>
              `
            )
            .join("")}
        </ul>
      </div>
    `;
  }

  function renderBlueprintQuestionTypeDropdown(type) {
    const current = normalizeBlueprintQuestionType(type);
    const options = [
      { id: "single", label: "Single correct" },
      { id: "multiple", label: "Multiple correct" },
      { id: "numerical", label: "Numerical" },
    ];
    return `
      <div class="dropdown tests-blueprint-dropdown">
        <button class="btn btn-sm btn-outline-secondary dropdown-toggle tests-blueprint-type-btn" type="button" data-bs-toggle="dropdown" aria-expanded="false">
          ${escapeHtml(getBlueprintQuestionTypeLabel(current))}
        </button>
        <ul class="dropdown-menu">
          ${options
            .map(
              (option) => `
                <li>
                  <button type="button" class="dropdown-item tests-blueprint-type-item ${
                    option.id === current ? "active" : ""
                  }" data-type="${escapeAttr(option.id)}">
                    ${escapeHtml(option.label)}
                  </button>
                </li>
              `
            )
            .join("")}
        </ul>
      </div>
    `;
  }

  function sumBlueprintAvailability(availability) {
    return (availability || []).reduce(
      (acc, subject) => {
        acc.single += Number(subject.counts?.single || 0);
        acc.multiple += Number(subject.counts?.multiple || 0);
        acc.numerical += Number(subject.counts?.numerical || 0);
        return acc;
      },
      { single: 0, multiple: 0, numerical: 0 }
    );
  }

  function normalizeBlueprintQuestionType(value) {
    const raw = String(value || "").toLowerCase();
    if (raw.includes("multi") || raw === "mmcq") return "multiple";
    if (raw.includes("num")) return "numerical";
    return "single";
  }

  function renderTestBlueprintStep({
    host,
    state,
    sourceOptions,
    sourceSelectionState,
    globalFilterState,
    questionReusePolicy,
    priorTests,
  }) {
    if (!host) return () => {};
    const availabilityHostId = `test-blueprint-availability-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    host.innerHTML = `
      <div class="tests-blueprint">
        <div class="tests-blueprint-head">
          <div>
            <h6 class="mb-1">Test Blueprint</h6>
            <div class="text-secondary small">Create shared sections applied to every matched subject.</div>
          </div>
          <div class="tests-blueprint-actions">
            ${renderBlueprintPresetDropdown(state.preset)}
            <button type="button" class="btn btn-sm btn-primary tests-blueprint-add">
              <i class="bi bi-plus-lg"></i>
              <span>Add Section</span>
            </button>
          </div>
        </div>
        <div class="tests-blueprint-sections"></div>
        <div class="tests-blueprint-time-card">
          <label class="form-label mb-0">
            <span>Time limit</span>
            <div class="input-group input-group-sm">
              <input class="form-control tests-blueprint-time" type="number" min="0" step="1" value="${escapeAttr(
                state.timeLimitMinutes || 0
              )}" aria-label="Time limit in minutes">
              <span class="input-group-text">minutes</span>
            </div>
          </label>
          <div class="text-secondary small">Use 0 for no time limit.</div>
        </div>
        <div class="tests-blueprint-availability-toolbar">
          <div id="${availabilityHostId}" class="text-secondary small">Select sources, then refresh counts.</div>
          <button type="button" class="btn btn-sm btn-outline-secondary tests-blueprint-refresh">
            <i class="bi bi-arrow-clockwise"></i>
            <span>Refresh Counts</span>
          </button>
        </div>
      </div>
    `;

    const sectionsHost = host.querySelector(".tests-blueprint-sections");
    const availabilityHost = host.querySelector(`#${availabilityHostId}`);
    const renderSections = () => {
      sectionsHost.innerHTML = "";
      state.sections.forEach((section, index) => {
        sectionsHost.appendChild(
          buildBlueprintSectionCard({
            section,
            index,
            availability: lastAvailability,
            onChange: renderAvailabilityFromCache,
            onDirty: markCustomPreset,
            onRemove: () => {
              markCustomPreset();
              state.sections = state.sections.filter((item) => item !== section);
              if (!state.sections.length) {
                state.sections.push({
                  id: makeBlueprintSectionId(),
                  name: "Section A",
                  type: "single",
                  questionCount: 10,
                  positiveMarks: 4,
                  negativeMarks: 1,
                });
              }
              renderSections();
              renderAvailabilityFromCache();
            },
          })
        );
      });
    };

    let lastAvailability = [];
    const renderAvailabilityFromCache = () => {
      renderBlueprintAvailabilitySummary(availabilityHost, lastAvailability);
    };
    const refreshAvailability = async () => {
      await refreshBlueprintAvailability({
        host: availabilityHost,
        state,
        sourceOptions,
        sourceSelectionState,
        globalFilterState,
        questionReusePolicy,
        priorTests,
        onLoaded: (availability) => {
          lastAvailability = availability;
          renderSections();
        },
      });
    };

    host.querySelector(".tests-blueprint-add")?.addEventListener("click", () => {
      markCustomPreset();
      state.sections.push({
        id: makeBlueprintSectionId(),
        name: `Section ${String.fromCharCode(65 + state.sections.length)}`,
        type: "single",
        questionCount: 10,
        positiveMarks: 4,
        negativeMarks: 1,
      });
      renderSections();
      renderAvailabilityFromCache();
    });
    host
      .querySelector(".tests-blueprint-refresh")
      ?.addEventListener("click", refreshAvailability);
    host.querySelector(".tests-blueprint-time")?.addEventListener("input", (event) => {
      markCustomPreset();
      state.timeLimitMinutes = Math.max(0, Number(event.target.value) || 0);
    });
    const presetBtn = host.querySelector(".tests-blueprint-preset-btn");
    const syncPresetSelect = () => {
      if (presetBtn) {
        presetBtn.textContent = getBlueprintPresetLabel(state.preset || "custom");
      }
    };
    const markCustomPreset = () => {
      state.preset = "custom";
      syncPresetSelect();
    };
    host.querySelectorAll(".tests-blueprint-preset-item").forEach((item) => {
      item.addEventListener("click", async () => {
      const presetId = item.dataset.presetId || "custom";
      host
        .querySelectorAll(".tests-blueprint-preset-item")
        .forEach((el) => el.classList.toggle("active", el === item));
      const preset = getBlueprintPresets().find(
        (item) => item.id === presetId
      );
      if (!preset || preset.id === "custom") {
        state.preset = "custom";
        syncPresetSelect();
        return;
      }
      const availability = lastAvailability.length
        ? lastAvailability
        : await loadBlueprintAvailability({
            sourceOptions,
            sourceSelectionState,
            globalFilterState,
            questionReusePolicy,
            priorTests,
          });
      lastAvailability = availability;
      state.preset = preset.id;
      syncPresetSelect();
      state.sections = preset.buildSections(availability);
      renderSections();
      renderBlueprintAvailabilitySummary(availabilityHost, availability);
    });
    });

    renderSections();
    renderAvailabilityFromCache();
    return refreshAvailability;
  }

  function buildBlueprintSectionCard({
    section,
    index,
    availability,
    onChange,
    onDirty,
    onRemove,
  }) {
    const card = document.createElement("div");
    card.className = "tests-blueprint-section-card";
    card.innerHTML = `
      <div class="tests-blueprint-section-title">
        <div class="fw-semibold">Section ${index + 1}</div>
        <button type="button" class="btn btn-sm btn-outline-danger tests-blueprint-remove" title="Remove section" aria-label="Remove section" ${
          index === 0 ? "disabled" : ""
        }><i class="bi bi-trash"></i></button>
      </div>
      <div class="tests-blueprint-grid">
        <label class="form-label">
          <span>Section name</span>
          <input class="form-control form-control-sm tests-blueprint-name" type="text" value="${escapeAttr(
            section.name
          )}">
        </label>
        <label class="form-label">
          <span>Question type</span>
          ${renderBlueprintQuestionTypeDropdown(section.type)}
        </label>
        <label class="form-label">
          <span>Questions</span>
          <input class="form-control form-control-sm tests-blueprint-count" type="number" min="0" step="1" value="${escapeAttr(
            section.questionCount
          )}">
        </label>
        <label class="form-label">
          <span>Marks</span>
          <input class="form-control form-control-sm tests-blueprint-positive" type="number" step="0.25" value="${escapeAttr(
            section.positiveMarks
          )}">
        </label>
        <label class="form-label">
          <span>Negative</span>
          <input class="form-control form-control-sm tests-blueprint-negative" type="number" step="0.25" value="${escapeAttr(
            section.negativeMarks
          )}">
        </label>
      </div>
      ${renderBlueprintSectionAvailability(section, availability)}
    `;
    card.querySelector(".tests-blueprint-name")?.addEventListener("input", (event) => {
      onDirty?.();
      section.name = event.target.value;
      onChange?.();
    });
    card.querySelectorAll(".tests-blueprint-type-item").forEach((item) => {
      item.addEventListener("click", () => {
        onDirty?.();
        section.type = normalizeBlueprintQuestionType(item.dataset.type);
        card
          .querySelectorAll(".tests-blueprint-type-item")
          .forEach((el) => el.classList.toggle("active", el === item));
        const btn = card.querySelector(".tests-blueprint-type-btn");
        if (btn) btn.textContent = getBlueprintQuestionTypeLabel(section.type);
        onChange?.();
      });
    });
    card.querySelector(".tests-blueprint-count")?.addEventListener("input", (event) => {
      onDirty?.();
      section.questionCount = Math.max(0, Number(event.target.value) || 0);
      onChange?.();
    });
    card.querySelector(".tests-blueprint-positive")?.addEventListener("input", (event) => {
      onDirty?.();
      section.positiveMarks = Number(event.target.value) || 0;
    });
    card.querySelector(".tests-blueprint-negative")?.addEventListener("input", (event) => {
      onDirty?.();
      section.negativeMarks = Number(event.target.value) || 0;
    });
    card.querySelector(".tests-blueprint-remove")?.addEventListener("click", onRemove);
    return card;
  }

  function renderBlueprintSectionAvailability(section, availability) {
    if (!availability?.length) {
      return `
        <div class="tests-blueprint-section-availability text-secondary small">
          Refresh counts to see available questions by subject.
        </div>
      `;
    }
    const need = Number(section.questionCount) || 0;
    const chips = availability
      .map((subject) => {
        const available = Number(subject.counts?.[section.type] || 0);
        const picked = Math.min(need, available);
        const underfilled = available < need;
        const empty = available <= 0;
        const cls = empty
          ? "bg-danger-subtle text-danger-emphasis"
          : underfilled
          ? "bg-warning-subtle text-warning-emphasis"
          : "bg-success-subtle text-success-emphasis";
        return `
          <span class="tests-blueprint-availability-chip ${cls}" title="${escapeAttr(
            `${available} available; ${picked} will be picked`
          )}">
            <span>${escapeHtml(subject.name)}</span>
            <strong>${picked}/${available}</strong>
          </span>
        `;
      })
      .join("");
    return `
      <div class="tests-blueprint-section-availability">
        <div class="text-secondary small mb-2">Available by subject. Yellow means fewer than requested; all available questions will be used.</div>
        <div class="tests-blueprint-availability-list">${chips}</div>
      </div>
    `;
  }

  async function refreshBlueprintAvailability({
    host,
    state,
    sourceOptions,
    sourceSelectionState,
    globalFilterState,
    questionReusePolicy,
    priorTests,
    onLoaded,
  }) {
    if (!host) return;
    host.innerHTML = `
      <div class="tests-blueprint-loading">
        <span class="spinner-border spinner-border-sm" aria-hidden="true"></span>
        <span>Loading selected-source counts...</span>
      </div>
    `;
    try {
      const availability = await loadBlueprintAvailability({
        sourceOptions,
        sourceSelectionState,
        globalFilterState,
        questionReusePolicy,
        priorTests,
      });
      onLoaded?.(availability);
      renderBlueprintAvailabilitySummary(host, availability);
    } catch (error) {
      console.error("blueprint availability failed", error);
      host.innerHTML = `
        <div class="tests-source-empty">
          <h6>Could not load counts</h6>
          <p>Try refreshing after selecting sources.</p>
        </div>
      `;
    }
  }

  function renderBlueprintAvailabilitySummary(host, availability) {
    if (!host) return;
    if (!availability?.length) {
      host.textContent = "Select sources, then refresh counts.";
      return;
    }
    host.textContent = `Counts loaded for ${availability.length} subject${
      availability.length === 1 ? "" : "s"
    }.`;
  }

  async function loadBlueprintAvailability({
    sourceOptions,
    sourceSelectionState,
    globalFilterState,
    questionReusePolicy,
    priorTests,
  }) {
    const sourceIndex = buildSourceIndex(sourceOptions);
    const effectiveSelections = buildEffectiveSourceSelections(
      sourceSelectionState,
      globalFilterState
    );
    const selectedSources = Object.entries(effectiveSelections || {})
      .filter(([, state]) => state?.selected && !state?.filters?.matchNone)
      .map(([sourceId, state]) => {
        const source = sourceIndex.get(String(sourceId));
        return source ? { ...source, filters: state.filters } : null;
      })
      .filter(Boolean);
    const reuseFilter = buildQuestionReuseFilter(questionReusePolicy, priorTests);
    const grouped = new Map();
    const results = await Promise.all(
      selectedSources.map(async (source) => ({
        source,
        counts: await loadBlueprintSourceCounts(source, reuseFilter),
      }))
    );
    results.forEach(({ source, counts }) => {
      const subjectKey = normalizeSubjectName(source.subjectName);
      if (!grouped.has(subjectKey)) {
        grouped.set(subjectKey, {
          name: source.subjectName || "Unknown Subject",
          counts: { single: 0, multiple: 0, numerical: 0 },
        });
      }
      const bucket = grouped.get(subjectKey);
      bucket.counts.single += counts.single || 0;
      bucket.counts.multiple += counts.multiple || 0;
      bucket.counts.numerical += counts.numerical || 0;
    });
    return Array.from(grouped.values()).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );
  }

  function buildSourceIndex(sourceOptions) {
    const map = new Map();
    (sourceOptions?.assignmentSubjects || []).forEach((subjectGroup) => {
      (subjectGroup.items || []).forEach((entry) => {
        map.set(String(entry.id), {
          ...entry,
          subjectName: subjectGroup.label || entry.subtext || "Assignments",
        });
      });
    });
    (sourceOptions?.pyqExams || []).forEach((exam) => {
      (exam.items || []).forEach((subjectGroup) => {
        (subjectGroup.items || []).forEach((entry) => {
          map.set(String(entry.id), {
            ...entry,
            subjectName: subjectGroup.label || "PYQs",
          });
        });
      });
    });
    return map;
  }

  async function loadBlueprintSourceCounts(source, reuseFilter) {
    if (source.kind === "pyq") {
      return loadPyqBlueprintCounts(source.id, source.filters, reuseFilter);
    }
    return loadAssignmentBlueprintCounts(source.id, source.filters, reuseFilter);
  }

  async function loadAssignmentBlueprintCounts(assignmentId, filters, reuseFilter) {
    try {
      const [res, bookmarksRes, marksRes] = await Promise.all([
        authFetch(`${API_BASE}/api/assignments/${encodeURIComponent(assignmentId)}`, {
          cache: "no-store",
        }),
        authFetch(`${API_BASE}/api/bookmarks`, { cache: "no-store" }),
        authFetch(`${API_BASE}/api/question-marks`, { cache: "no-store" }),
      ]);
      if (!res.ok) return getEmptyBlueprintCounts();
      const data = await res.json();
      const allBookmarks = bookmarksRes.ok ? await bookmarksRes.json() : [];
      const allMarks = marksRes.ok ? await marksRes.json() : [];
      const assignmentKey = String(assignmentId);
      const questions = Array.isArray(data?.assignment?.questions)
        ? data.assignment.questions
        : Array.isArray(data?.assignment)
        ? data.assignment
        : [];
      return countBlueprintQuestionTypes(
        applyBlueprintSourceFilters({
          kind: "assignment",
          questions,
          filters,
          bookmarks: (allBookmarks || []).filter(
            (bookmark) => String(bookmark.assignmentId) === assignmentKey
          ),
          marks: (allMarks || []).filter(
            (mark) => String(mark.assignmentId) === assignmentKey
          ),
          sourceId: assignmentId,
          reuseFilter,
        })
      );
    } catch {
      return getEmptyBlueprintCounts();
    }
  }

  async function loadPyqBlueprintCounts(sourceId, filters, reuseFilter) {
    const [examId, subjectId, chapterId] = String(sourceId || "").split("::");
    if (!examId || !subjectId || !chapterId) return getEmptyBlueprintCounts();
    try {
      const res = await authFetch(
        `${API_BASE}/api/pyqs/questions-bundle/${encodeURIComponent(
          examId
        )}/${encodeURIComponent(subjectId)}/${encodeURIComponent(
          chapterId
        )}?full=1&state=1&overlays=1`,
        { cache: "no-store" }
      );
      if (!res.ok) return getEmptyBlueprintCounts();
      const data = await res.json();
      const questions = Array.isArray(data?.questions) ? data.questions : [];
      return countBlueprintQuestionTypes(
        applyBlueprintSourceFilters({
          kind: "pyq",
          questions,
          filters,
          bookmarks: data?.bookmarks || [],
          marks: data?.marks || [],
          state: data?.state || [],
          sourceId,
          reuseFilter,
        })
      );
    } catch {
      return getEmptyBlueprintCounts();
    }
  }

  function applyBlueprintSourceFilters({
    kind,
    questions,
    filters,
    bookmarks,
    marks,
    state,
    sourceId,
    reuseFilter,
  }) {
    if (!filters || filters.matchNone) return filters?.matchNone ? [] : questions;
    const bookmarkTags = new Set((filters.bookmarkTagIds || []).map(String));
    const colors = new Set((filters.colors || []).map((c) => String(c).toLowerCase()));
    const years = new Set((filters.years || []).map(Number));
    const statuses = new Set((filters.status || []).map(String));
    const diffs = new Set((filters.diff || []).map(String));
    const qSearchTerms = String(filters.q || "")
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    const bookmarkByIndex = groupBookmarksByQuestionIndex(bookmarks);
    const markByIndex = new Map(
      (marks || []).map((mark) => [
        Number(mark.questionIndex),
        String(mark.color || "").toLowerCase(),
      ])
    );

    return (questions || []).filter((question, index) => {
      if (isQuestionBlockedByReusePolicy({ kind, sourceId, question, index, reuseFilter })) {
        return false;
      }
      if (bookmarkTags.size) {
        const tags = bookmarkByIndex.get(index) || new Set();
        if (!Array.from(bookmarkTags).some((tagId) => tags.has(tagId))) return false;
      }
      if (colors.size) {
        const color = markByIndex.get(index) || "none";
        if (!colors.has(color)) return false;
      }
      if (kind === "pyq") {
        if (
          qSearchTerms.length &&
          !qSearchTerms.every((term) =>
            String(question.qText || "").toLowerCase().includes(term)
          )
        ) {
          return false;
        }
        if (years.size) {
          const m = String(question.pyqInfo || "").match(/(19|20)\d{2}/);
          const year = m ? Number(m[0]) : null;
          if (!years.has(year)) return false;
        }
        if (diffs.size && !diffs.has(normalizeBlueprintDiff(question.diffuculty))) {
          return false;
        }
        if (statuses.size) {
          const status = getBlueprintPyqStatus(state?.[index]);
          const completed =
            status === "correct" || status === "partial" || status === "incorrect";
          if (!statuses.has(status) && !(statuses.has("completed") && completed)) {
            return false;
          }
        }
      }
      return true;
    });
  }

  function buildQuestionReuseFilter(questionReusePolicy, priorTests) {
    const policy = normalizeQuestionReusePolicy(questionReusePolicy);
    const selectedIds = new Set(policy.testIds.map(String));
    const tests = Array.isArray(priorTests) ? priorTests : [];
    const allKeys = new Set();
    const selectedKeys = new Set();

    tests.forEach((test) => {
      const keys = collectPriorTestQuestionKeys(test);
      keys.forEach((key) => allKeys.add(key));
      if (selectedIds.has(String(test.testId))) {
        keys.forEach((key) => selectedKeys.add(key));
      }
    });

    if (!allKeys.size) return { blockedKeys: new Set() };
    if (policy.mode === "whitelist") {
      return {
        blockedKeys: new Set(
          Array.from(allKeys).filter((key) => !selectedKeys.has(key))
        ),
      };
    }
    return { blockedKeys: selectedKeys };
  }

  function collectPriorTestQuestionKeys(test) {
    const keys = new Set();
    const add = (value) => {
      const key = String(value || "").trim();
      if (key) keys.add(key);
    };
    (test?.questionKeys || []).forEach(add);
    return keys;
  }

  function isQuestionBlockedByReusePolicy({
    kind,
    sourceId,
    question,
    index,
    reuseFilter,
  }) {
    const blockedKeys = reuseFilter?.blockedKeys;
    if (!blockedKeys?.size) return false;
    return getBlueprintQuestionKeyAliases({ kind, sourceId, question, index }).some(
      (key) => blockedKeys.has(key)
    );
  }

  function getBlueprintQuestionKeyAliases({ kind, sourceId, question, index }) {
    const aliases = new Set();
    const add = (value) => {
      const key = String(value || "").trim();
      if (key) aliases.add(key);
    };
    const sourceKey = String(sourceId || "");
    const questionId =
      question?.questionId ??
      question?.qid ??
      question?.id ??
      question?._id ??
      question?.qId;
    add(question?.questionKey);
    add(question?.key);
    add(question?.sourceQuestionKey);
    add(question?.generatedQuestionKey);
    if (questionId !== undefined) {
      add(`${kind}:${sourceKey}:${questionId}`);
    }
    add(`${kind}:${sourceKey}:${index}`);
    add(`${kind}:${sourceKey}:index:${index}`);

    if (kind === "assignment") {
      const assignmentId = question?.assignmentId ?? sourceKey;
      if (questionId !== undefined) add(`assignment:${assignmentId}:${questionId}`);
      add(`assignment:${assignmentId}:${index}`);
      add(`assignment:${assignmentId}:index:${index}`);
    }

    if (kind === "pyq") {
      const [examId, subjectId, chapterId] = sourceKey.split("::");
      if (examId && subjectId && chapterId) {
        if (questionId !== undefined) {
          add(`pyq:${examId}::${subjectId}::${chapterId}:${questionId}`);
        }
        add(`pyq:${examId}::${subjectId}::${chapterId}:${index}`);
        add(`pyq:${examId}::${subjectId}::${chapterId}:index:${index}`);
      }
    }

    return Array.from(aliases);
  }

  function groupBookmarksByQuestionIndex(bookmarks) {
    const grouped = new Map();
    (bookmarks || []).forEach((bookmark) => {
      const index = Number(bookmark.questionIndex);
      if (!grouped.has(index)) grouped.set(index, new Set());
      grouped.get(index).add(String(bookmark.tagId));
    });
    return grouped;
  }

  function normalizeBlueprintDiff(value) {
    const raw = String(value || "").toLowerCase();
    if (raw === "1" || raw.includes("easy")) return "easy";
    if (raw === "2" || raw.includes("moderate") || raw.includes("medium")) {
      return "medium";
    }
    if (raw === "3" || raw.includes("hard")) return "hard";
    return raw;
  }

  function getBlueprintPyqStatus(questionState) {
    if (!questionState || typeof questionState !== "object") return "not-started";
    const hasAnswer =
      questionState.pickedAnswer ||
      (Array.isArray(questionState.pickedAnswers) &&
        questionState.pickedAnswers.length) ||
      questionState.pickedNumerical !== undefined;
    if (!questionState.evaluated) return hasAnswer ? "in-progress" : "not-started";
    if (questionState.correct) return "correct";
    if (questionState.partial) return "partial";
    return "incorrect";
  }

  function countBlueprintQuestionTypes(questions) {
    const counts = getEmptyBlueprintCounts();
    (questions || []).forEach((question) => {
      const type = normalizeQuestionTypeForBlueprint(question);
      if (type) counts[type] += 1;
    });
    return counts;
  }

  function normalizeQuestionTypeForBlueprint(question) {
    const raw = String(question?.qType || question?.type || "").toLowerCase();
    if (raw.includes("passage")) return "";
    if (raw.includes("num")) return "numerical";
    if (raw.includes("mmcq") || raw.includes("multiple")) return "multiple";
    if (raw.includes("smcq") || raw.includes("single") || raw.includes("mcq")) {
      return "single";
    }
    const correct = question?.correctAnswer;
    if (Array.isArray(correct) && correct.length > 1) return "multiple";
    return "single";
  }

  function getEmptyBlueprintCounts() {
    return { single: 0, multiple: 0, numerical: 0 };
  }

  function normalizeSubjectName(value) {
    return String(value || "Unknown Subject")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function getBlueprintQuestionTypeLabel(type) {
    if (type === "multiple") return "Multiple correct";
    if (type === "numerical") return "Numerical";
    return "Single correct";
  }

  function normalizeQuestionReusePolicy(value) {
    const mode = value?.mode === "whitelist" ? "whitelist" : "blacklist";
    const testIds = Array.isArray(value?.testIds)
      ? value.testIds.map((id) => String(id).trim()).filter(Boolean)
      : [];
    return { mode, testIds };
  }

  function renderQuestionReusePolicySourceEditor({
    host,
    reusePolicy,
    priorTests,
  }) {
    if (!host) return;
    host.innerHTML = `
      <div class="tests-source-reuse-card">
        <div class="tests-source-reuse-head">
          <div>
            <h6 class="mb-1">Question Reuse</h6>
            <div class="text-secondary small">Control repeats from previous tests before blueprint counts are calculated.</div>
          </div>
        </div>
        ${renderQuestionReusePolicyEditor({ reusePolicy, priorTests })}
      </div>
    `;
    wireQuestionReusePolicyEditor({ host, reusePolicy, priorTests });
  }

  function renderCreateTestReview({
    host,
    draftValue,
    sourceOptions,
  }) {
    if (!host) return;
    const draft = draftValue || {};
    const sourceIndex = buildSourceIndex(sourceOptions);
    const selectedSources = Object.entries(draft.sourceSelections || {})
      .filter(([, state]) => state?.selected)
      .map(([sourceId, state]) => ({
        id: sourceId,
        state,
        source: sourceIndex.get(String(sourceId)),
      }));
    const byKind = selectedSources.reduce(
      (acc, item) => {
        const kind = item.source?.kind === "pyq" ? "pyq" : "assignment";
        acc[kind] += 1;
        return acc;
      },
      { assignment: 0, pyq: 0 }
    );
    const globalFilterCount = [
      hasSourceFilters("assignment", draft.globalFilters?.assignment),
      hasSourceFilters("pyq", draft.globalFilters?.pyq),
    ].filter(Boolean).length;
    const sections = draft.testBlueprint?.sections || [];
    const timeLimitMinutes = Number(draft.testBlueprint?.timeLimitMinutes || 0);
    const reusePolicy = normalizeQuestionReusePolicy(draft.questionReusePolicy);
    const reuseLabel = `${
      reusePolicy.mode === "whitelist" ? "Whitelist" : "Blacklist"
    } ${reusePolicy.testIds.length} test${
      reusePolicy.testIds.length === 1 ? "" : "s"
    }`;

    host.innerHTML = `
      <div class="tests-review">
        <div class="tests-review-card">
          <h6>Test Details</h6>
          <dl class="tests-review-list">
            <div><dt>Name</dt><dd>${escapeHtml(draft.testName || "Untitled test")}</dd></div>
            <div><dt>Description</dt><dd>${escapeHtml(draft.testDescription || "No description")}</dd></div>
            <div><dt>Shared with</dt><dd>${escapeHtml(
              (draft.shareWith || []).length ? draft.shareWith.join(", ") : "No one"
            )}</dd></div>
          </dl>
        </div>
        <div class="tests-review-card">
          <h6>Question Sources</h6>
          <div class="tests-review-metrics">
            <span class="tests-review-pill">${byKind.assignment} assignments</span>
            <span class="tests-review-pill">${byKind.pyq} PYQ chapters</span>
            <span class="tests-review-pill">${globalFilterCount} global filters</span>
            <span class="tests-review-pill">${escapeHtml(reuseLabel)}</span>
          </div>
          ${renderReviewSourceList(selectedSources)}
        </div>
        <div class="tests-review-card">
          <h6>Test Blueprint</h6>
          <div class="tests-review-metrics mb-3">
            <span class="tests-review-pill">${
              timeLimitMinutes > 0
                ? `${escapeHtml(formatBlueprintTimeLimit(timeLimitMinutes))} time limit`
                : "No time limit"
            }</span>
          </div>
          ${renderReviewBlueprintSections(sections)}
        </div>
      </div>
    `;
  }

  function renderReviewSourceList(selectedSources) {
    if (!selectedSources.length) {
      return '<div class="text-secondary small mt-2">No sources selected yet.</div>';
    }
    return `
      <div class="tests-review-source-list">
        ${selectedSources
          .slice(0, 8)
          .map(({ source, state }) => {
            const active = hasSourceFilters(source?.kind || "assignment", state.filters);
            return `
              <div class="tests-review-source-row">
                <span>${escapeHtml(source?.title || "Unknown source")}</span>
                <span class="text-secondary small">${escapeHtml(
                  source?.subjectName || source?.subtext || ""
                )}${active ? " &middot; filters on" : ""}</span>
              </div>
            `;
          })
          .join("")}
        ${
          selectedSources.length > 8
            ? `<div class="text-secondary small">+${selectedSources.length - 8} more</div>`
            : ""
        }
      </div>
    `;
  }

  function renderReviewBlueprintSections(sections) {
    if (!sections.length) {
      return '<div class="text-secondary small">No sections configured.</div>';
    }
    return `
      <div class="tests-review-section-list">
        ${sections
          .map(
            (section) => `
              <div class="tests-review-section-row">
                <div>
                  <div class="fw-semibold">${escapeHtml(section.name || "Section")}</div>
                  <div class="text-secondary small">${escapeHtml(
                    getBlueprintQuestionTypeLabel(section.type)
                  )} &middot; ${Number(section.questionCount) || 0} question(s) per subject</div>
                </div>
                <div class="tests-review-pill">+${Number(section.positiveMarks) || 0} / -${
              Number(section.negativeMarks) || 0
            }</div>
              </div>
            `
          )
          .join("")}
      </div>
    `;
  }

  function formatBlueprintTimeLimit(minutes) {
    const totalMinutes = Math.max(0, Math.round(Number(minutes) || 0));
    if (!totalMinutes) return "No";
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    if (!hours) return `${mins} min`;
    if (!mins) return `${hours} hr${hours === 1 ? "" : "s"}`;
    return `${hours} hr${hours === 1 ? "" : "s"} ${mins} min`;
  }

  function renderQuestionReusePolicyEditor({ reusePolicy, priorTests }) {
    const tests = Array.isArray(priorTests) ? priorTests : [];
    const selected = new Set((reusePolicy?.testIds || []).map(String));
    const mode = reusePolicy?.mode === "whitelist" ? "whitelist" : "blacklist";
    const modeText =
      mode === "whitelist"
        ? "Questions from selected previous tests may repeat. Other previous-test questions should be avoided."
        : "Selected tests cannot repeat questions.";
    const selectAllText =
      tests.length && selected.size >= tests.length
        ? `Clear ${mode}`
        : `Select all into ${mode}`;
    return `
      <div class="tests-reuse-policy">
        <div class="tests-reuse-topline">
          <div class="tests-reuse-mode" role="group" aria-label="Question reuse mode">
            <button type="button" class="btn btn-sm ${
              mode === "blacklist" ? "btn-primary" : "btn-outline-secondary"
            } tests-reuse-mode-btn" data-mode="blacklist">Blacklist</button>
            <button type="button" class="btn btn-sm ${
              mode === "whitelist" ? "btn-primary" : "btn-outline-secondary"
            } tests-reuse-mode-btn" data-mode="whitelist">Whitelist</button>
          </div>
          <button type="button" class="btn btn-sm btn-outline-secondary tests-reuse-select-all" ${
            tests.length ? "" : "disabled"
          }>
            ${selectAllText}
          </button>
        </div>
        <div class="tests-reuse-summary">
          <span class="text-secondary small tests-reuse-mode-help">${modeText}</span>
          <span class="tests-review-pill tests-reuse-selected-count">${selected.size} selected</span>
        </div>
        <div class="tests-reuse-test-list">
          ${
            tests.length
              ? tests
                  .map((test) => {
                    const id = String(test.testId || "");
                    return `
                      <label class="tests-reuse-test-row">
                        <input class="form-check-input tests-reuse-test-check" type="checkbox" value="${escapeHtml(id)}" ${
                      selected.has(id) ? "checked" : ""
                    }>
                        <span class="tests-reuse-test-title">${escapeHtml(test.title || `Test ${id}`)}</span>
                        <span class="text-secondary small">${escapeHtml(test.createdAt || "")}</span>
                      </label>
                    `;
                  })
                  .join("")
              : '<div class="text-secondary small">No previous tests available.</div>'
          }
        </div>
      </div>
    `;
  }

  function wireQuestionReusePolicyEditor({ host, reusePolicy, priorTests }) {
    const tests = Array.isArray(priorTests) ? priorTests : [];
    const modeHelp = host.querySelector(".tests-reuse-mode-help");
    const selectedCount = host.querySelector(".tests-reuse-selected-count");
    const selectAllBtn = host.querySelector(".tests-reuse-select-all");
    const getChecks = () =>
      Array.from(host.querySelectorAll(".tests-reuse-test-check"));
    const getSelectedIds = () =>
      getChecks()
        .filter((input) => input.checked)
        .map((input) => String(input.value).trim())
        .filter(Boolean);
    const syncSummary = () => {
      const selectedIds = getSelectedIds();
      reusePolicy.testIds = selectedIds;
      if (modeHelp) {
        modeHelp.textContent =
          reusePolicy.mode === "whitelist"
            ? "Questions from selected previous tests may repeat. Other previous-test questions should be avoided."
            : "Questions from selected previous tests cannot repeat.";
      }
      if (selectedCount) {
        selectedCount.textContent = `${selectedIds.length} selected`;
      }
      if (selectAllBtn) {
        selectAllBtn.textContent =
          tests.length && selectedIds.length >= tests.length
            ? `Clear ${reusePolicy.mode}`
            : `Select all into ${reusePolicy.mode}`;
      }
    };
    const updateModeButtons = () => {
      host.querySelectorAll(".tests-reuse-mode-btn").forEach((btn) => {
        const active = btn.dataset.mode === reusePolicy.mode;
        btn.classList.toggle("btn-primary", active);
        btn.classList.toggle("btn-outline-secondary", !active);
      });
      syncSummary();
    };
    host.querySelectorAll(".tests-reuse-mode-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        reusePolicy.mode = btn.dataset.mode === "whitelist" ? "whitelist" : "blacklist";
        updateModeButtons();
      });
    });
    host.querySelectorAll(".tests-reuse-test-check").forEach((input) => {
      input.addEventListener("change", syncSummary);
    });
    selectAllBtn?.addEventListener("click", () => {
      const checks = getChecks();
      const shouldCheck = checks.some((input) => !input.checked);
      checks.forEach((input) => {
        input.checked = shouldCheck;
      });
      syncSummary();
    });
    syncSummary();
  }

  function setVisible(el, show) {
    if (!el) return;
    el.classList.toggle("d-none", !show);
  }

  function getAttemptedCount(test) {
    return Number.isFinite(test.attempted) ? test.attempted : 0;
  }

  function getSectionKind(test) {
    const explicit = String(test.status || "").toLowerCase();
    if (explicit === "paused") return "paused";
    if (explicit === "unattempted") return "unattempted";
    if (getAttemptedCount(test) <= 0) return "unattempted";
    return "attempted";
  }

  function showError(message) {
    els.error.textContent = message;
    setVisible(els.error, true);
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text ?? "";
    return div.innerHTML;
  }

  function escapeAttr(text) {
    return escapeHtml(text).replaceAll('"', "&quot;");
  }

  async function loadQuestionSourceOptions() {
    const [assignmentSubjects, pyqExams] = await Promise.all([
      loadAssignmentsBySubject(),
      loadStarredPyqExams(),
    ]);
    return { assignmentSubjects, pyqExams };
  }

  async function loadAssignmentsBySubject() {
    try {
      if (!window.HomeService?.fetchAssignments || !window.HomeService?.normalizeAssignments) {
        return [];
      }
      const raw = await window.HomeService.fetchAssignments();
      const items = window.HomeService.normalizeAssignments(raw);
      const map = new Map();
      items.forEach((item) => {
        const subject = String(item.subject || "").trim();
        if (!subject) return;
        if (!map.has(subject)) map.set(subject, []);
        map.get(subject).push({
          id: String(item.aID),
          kind: "assignment",
          title: String(item.title || `Assignment ${item.aID}`),
          subtext: item.chapter ? String(item.chapter) : "",
        });
      });
      return Array.from(map.entries())
        .sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: "base" }))
        .map(([subject, assignments]) => ({
          key: slugify(subject),
          label: subject,
          items: assignments.sort((a, b) =>
            a.title.localeCompare(b.title, undefined, { sensitivity: "base" })
          ),
        }));
    } catch {
      return [];
    }
  }

  async function loadStarredPyqExams() {
    try {
      const [starredRes, starredChaptersRes, examsRes] = await Promise.all([
        authFetch(`${API_BASE}/api/pyqs/starred/exams`, { cache: "no-store" }),
        authFetch(`${API_BASE}/api/pyqs/starred/chapters`, { cache: "no-store" }),
        authFetch(`${API_BASE}/api/pyqs/exams`, { cache: "no-store" }),
      ]);
      const starredIds = starredRes.ok ? await starredRes.json() : [];
      const starredChapters = starredChaptersRes.ok
        ? await starredChaptersRes.json()
        : [];
      const exams = examsRes.ok ? await examsRes.json() : [];
      const starredSet = new Set((Array.isArray(starredIds) ? starredIds : []).map(String));
      const starredChapterSet = new Set(
        (Array.isArray(starredChapters) ? starredChapters : []).map((it) =>
          `${it.examId}::${it.subjectId}::${it.chapterId}`
        )
      );
      const starredExams = (Array.isArray(exams) ? exams : []).filter((exam) =>
        starredSet.has(String(exam?.id))
      );
      const withChapters = await Promise.all(
        starredExams.map(async (exam) => {
          const examId = String(exam.id);
          try {
            const subjectsRes = await authFetch(
              `${API_BASE}/api/pyqs/exams/${encodeURIComponent(examId)}/subjects`,
              { cache: "no-store" }
            );
            const subjects = subjectsRes.ok ? await subjectsRes.json() : [];
            const chapterGroups = await Promise.all(
              (Array.isArray(subjects) ? subjects : []).map(async (subject) => {
                const subjectId = String(subject.id);
                const chaptersRes = await authFetch(
                  `${API_BASE}/api/pyqs/exams/${encodeURIComponent(
                    examId
                  )}/subjects/${encodeURIComponent(subjectId)}/chapters`,
                  { cache: "no-store" }
                );
                const chapters = chaptersRes.ok ? await chaptersRes.json() : [];
                return {
                  key: subjectId,
                  label: String(subject.name || subjectId),
                  icon: String(subject.icon || ""),
                  items: (Array.isArray(chapters) ? chapters : [])
                    .map((chapter) => {
                      const id = `${examId}::${subjectId}::${chapter.id}`;
                      return {
                        id,
                        kind: "pyq",
                        title: String(chapter.name || chapter.title || chapter.id),
                        subtext: "",
                        icon:
                          String(chapter.icon || "") ||
                          (chapter.icon_name
                            ? `${PYQ_CHAPTER_ICON_BASE}${chapter.icon_name}`
                            : ""),
                        starred: starredChapterSet.has(id),
                      };
                    })
                    .sort((a, b) => {
                      if (Number(b.starred) !== Number(a.starred)) {
                        return Number(b.starred) - Number(a.starred);
                      }
                      return a.title.localeCompare(b.title, undefined, {
                        sensitivity: "base",
                      });
                    }),
                };
              })
            );
            return {
              key: examId,
              label: String(exam.name ?? exam.title ?? exam.id),
              icon: String(exam.icon || ""),
              items: chapterGroups
                .filter((group) => group && group.label)
                .sort((a, b) =>
                  a.label.localeCompare(b.label, undefined, { sensitivity: "base" })
                ),
              renderNestedItems: true,
            };
          } catch {
            return {
              key: examId,
              label: String(exam.name ?? exam.title ?? exam.id),
              icon: String(exam.icon || ""),
              items: [],
            };
          }
        })
      );
      return withChapters;
    } catch {
      return [];
    }
  }

  function renderSourcePicker(
    topTabsHost,
    topPanelsHost,
    options,
    sourceSelectionState,
    bookmarkTags,
    globalFilterState
  ) {
    ensureGlobalFilterState(globalFilterState);
    const topTabs = getSourceTypeTabs(options);

    topTabsHost.innerHTML = "";
    topPanelsHost.innerHTML = "";
    topTabsHost.className = "tests-source-tabs-wrap overflow-x-auto";
    topPanelsHost.className = "tests-source-panels";

    const topList = document.createElement("ul");
    topList.className = "nav nav-tabs flex-nowrap mb-1 rounded-top tests-source-tabs-list";
    topTabsHost.appendChild(topList);

    topTabs.forEach((tab, index) => {
      const { li, tabBtn } = buildSourceTypeTabControl({
        tab,
        active: index === 0,
        globalFilterState,
        bookmarkTags,
        sourceOptions: options,
      });
      topList.appendChild(li);

      const panel = buildSourceTypePanel({
        tab,
        active: index === 0,
        sourceSelectionState,
        bookmarkTags,
      });
      topPanelsHost.appendChild(panel);

      tabBtn.addEventListener("click", () => {
        activateTabbedPanel({
          tabsHost: topList,
          panelsHost: topPanelsHost,
          activeTab: tabBtn,
          tabSelector: ".tests-source-tab",
          panelSelector: ".tests-source-panel",
          panelDataKey: "sourcePanel",
          activeKey: tab.key,
        });
      });
    });
  }

  function getSourceTypeTabs(options) {
    return [
      {
        key: "assignments",
        label: "Assignments",
        kind: "assignment",
        items: options.assignmentSubjects || [],
        emptyTitle: "No assignment subjects available",
        emptyText:
          "Assignment subjects will appear here once assignment data is available.",
      },
      {
        key: "pyqs",
        label: "PYQs",
        kind: "pyq",
        items: options.pyqExams || [],
        emptyTitle: "No starred exams yet",
        emptyText: "Star PYQ exams first and they will appear here.",
      },
    ];
  }

  function buildSourceTypeTabControl({
    tab,
    active,
    globalFilterState,
    bookmarkTags,
    sourceOptions,
  }) {
    const li = document.createElement("li");
    li.className = "nav-item tests-source-tab-item";
    li.setAttribute("role", "presentation");

    const tabBtn = document.createElement("button");
    tabBtn.type = "button";
    tabBtn.className = `nav-link tests-source-tab${active ? " active" : ""}`;
    tabBtn.dataset.sourceTab = tab.key;
    tabBtn.appendChild(buildSourceTabLabel(tab));

    const filterBtn = buildGlobalFilterButton({
      tab,
      globalFilterState,
      bookmarkTags,
      sourceOptions,
    });
    tabBtn.appendChild(filterBtn);
    li.appendChild(tabBtn);
    return { li, tabBtn };
  }

  function buildSourceTypePanel({
    tab,
    active,
    sourceSelectionState,
    bookmarkTags,
  }) {
    const panel = document.createElement("section");
    panel.className = `tests-source-panel${active ? " active" : ""}`;
    panel.dataset.sourcePanel = tab.key;
    if (tab.key === "pyqs") panel.appendChild(buildSourceTip("Only starred exams are shown."));
    panel.appendChild(
      buildNestedSourcePanel(tab, sourceSelectionState, bookmarkTags)
    );
    return panel;
  }

  function buildSourceTip(text) {
    const tip = document.createElement("div");
    tip.className = "tests-source-tip";
    tip.innerHTML = `<i class="bi bi-info-circle"></i><span>${escapeHtml(
      text
    )}</span>`;
    return tip;
  }

  function buildGlobalFilterButton({
    tab,
    globalFilterState,
    bookmarkTags,
    sourceOptions,
  }) {
    const filterBtn = document.createElement("span");
    filterBtn.className = "tests-source-global-filter-btn";
    filterBtn.dataset.sourceGlobalFilter = tab.kind;
    filterBtn.innerHTML = '<i class="bi bi-funnel"></i>';
    filterBtn.tabIndex = 0;
    filterBtn.setAttribute("role", "button");

    const syncGlobalFilterBtn = () => {
      const active = hasSourceFilters(tab.kind, globalFilterState?.[tab.kind]);
      filterBtn.classList.toggle("active", active);
      filterBtn.title = active
        ? `Global ${tab.label} filters active`
        : `Global ${tab.label} filters`;
      filterBtn.setAttribute("aria-label", filterBtn.title);
    };

    filterBtn.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (filterBtn.getAttribute("aria-disabled") === "true") return;
      await openGlobalSourceFilter({
        kind: tab.kind,
        label: tab.label,
        button: filterBtn,
        globalFilterState,
        bookmarkTags,
        sourceOptions,
        onApplied: syncGlobalFilterBtn,
      });
    });
    filterBtn.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      filterBtn.click();
    });
    syncGlobalFilterBtn();
    return filterBtn;
  }

  function activateTabbedPanel({
    tabsHost,
    panelsHost,
    activeTab,
    tabSelector,
    panelSelector,
    panelDataKey,
    activeKey,
  }) {
    tabsHost
      ?.querySelectorAll(tabSelector)
      .forEach((el) => el.classList.toggle("active", el === activeTab));
    panelsHost
      ?.querySelectorAll(panelSelector)
      .forEach((el) =>
        el.classList.toggle("active", el.dataset[panelDataKey] === activeKey)
      );
  }

  async function openGlobalSourceFilter({
    kind,
    label,
    button,
    globalFilterState,
    bookmarkTags,
    sourceOptions,
    onApplied,
  }) {
    const originalHtml = button?.innerHTML || "";
    if (button) {
      button.setAttribute("aria-disabled", "true");
      button.innerHTML =
        '<span class="spinner-border spinner-border-sm" aria-hidden="true"></span>';
    }
    const entry = {
      id: `__global_${kind}`,
      kind,
      title: `Global ${label} filters`,
      subtext: "Applied with each selected source filter.",
      sourceIds: kind === "pyq" ? collectPyqSourceIds(sourceOptions) : undefined,
    };
    const modalState = {
      [entry.id]: {
        selected: true,
        filters: structuredCloneSafe(globalFilterState[kind]),
      },
    };
    try {
      await openSourceFilterModal(entry, modalState, bookmarkTags, () => {
        globalFilterState[kind] = normalizeSourceFilters(
          kind,
          modalState[entry.id]?.filters
        );
        onApplied?.();
      });
    } finally {
      if (button && button.isConnected) {
        button.removeAttribute("aria-disabled");
        button.innerHTML = originalHtml;
        onApplied?.();
      }
    }
  }

  function buildNestedSourcePanel(tab, sourceSelectionState, bookmarkTags) {
    const wrap = document.createElement("div");
    wrap.className = "tests-source-panel-inner";

    if (!tab.items.length) {
      const empty = document.createElement("div");
      empty.className = "tests-source-empty";
      empty.innerHTML = `
        <h6>${escapeHtml(tab.emptyTitle)}</h6>
        <p>${escapeHtml(tab.emptyText)}</p>
      `;
      wrap.appendChild(empty);
      return wrap;
    }

    const innerTabsWrap = document.createElement("nav");
    innerTabsWrap.className = "tests-source-inner-tabs-wrap overflow-x-auto";
    const innerTabs = document.createElement("ul");
    innerTabs.className =
      "nav nav-tabs flex-nowrap mb-1 rounded-top tests-source-inner-tabs";
    innerTabsWrap.appendChild(innerTabs);
    const innerPanels = document.createElement("div");
    innerPanels.className = "tests-source-inner-panels";

    tab.items.forEach((item, index) => {
      const li = document.createElement("li");
      li.className = "nav-item";
      li.setAttribute("role", "presentation");
      const innerBtn = document.createElement("button");
      innerBtn.type = "button";
      innerBtn.className = `nav-link tests-source-inner-tab${index === 0 ? " active" : ""}`;
      innerBtn.dataset.innerSourceTab = item.key;
      innerBtn.appendChild(buildSourceTabLabel(item));
      li.appendChild(innerBtn);
      innerTabs.appendChild(li);

      const panel = document.createElement("div");
      panel.className = `tests-source-inner-panel${index === 0 ? " active" : ""}`;
      panel.dataset.innerSourcePanel = item.key;
      panel.appendChild(
        item.renderNestedItems
          ? buildThirdLevelSourceTabs(item.items || [], sourceSelectionState, bookmarkTags)
          : buildSelectableSourceList(item, sourceSelectionState, bookmarkTags)
      );
      innerPanels.appendChild(panel);

      innerBtn.addEventListener("click", () => {
        activateTabbedPanel({
          tabsHost: innerTabs,
          panelsHost: innerPanels,
          activeTab: innerBtn,
          tabSelector: ".tests-source-inner-tab",
          panelSelector: ".tests-source-inner-panel",
          panelDataKey: "innerSourcePanel",
          activeKey: item.key,
        });
      });
    });

    wrap.append(innerTabsWrap, innerPanels);
    return wrap;
  }

  function slugify(value) {
    return String(value || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");
  }

  function buildSelectableSourceList(item, sourceSelectionState, bookmarkTags) {
    const wrap = document.createElement("div");
    wrap.className = "tests-source-list-wrap";

    const search = document.createElement("div");
    search.className = "input-group tests-source-search";
    search.innerHTML = `
      <span class="input-group-text"><i class="bi bi-search"></i></span>
      <input
        type="text"
        class="form-control"
        placeholder="Search..."
        autocomplete="off"
      />
      <button
        type="button"
        class="btn btn-outline-secondary tests-source-pick-visible"
        title="Pick all search results"
        aria-label="Pick all search results"
      >
        <i class="bi bi-check2-all"></i>
      </button>
    `;

    const list = document.createElement("div");
    list.className = "tests-source-list";

    const rows = (item.items || []).map((entry) => {
      const row = buildSelectableSourceRow({
        entry,
        sourceSelectionState,
        bookmarkTags,
      });
      list.appendChild(row);
      return row;
    });

    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "tests-source-empty";
      empty.innerHTML = `
        <h6>No items available</h6>
        <p>Nothing is available in this tab yet.</p>
      `;
      wrap.appendChild(empty);
      return wrap;
    }

    const input = search.querySelector("input");
    const pickVisibleBtn = search.querySelector(".tests-source-pick-visible");

    const emptyState = document.createElement("div");
    emptyState.className = "tests-source-empty d-none";
    emptyState.innerHTML = `
      <h6>No matches</h6>
      <p>Try a different search.</p>
    `;

    wrap.append(search, list, emptyState);
    wireSourceListSearchAndBulkPick({
      input,
      pickVisibleBtn,
      rows,
      emptyState,
      sourceSelectionState,
    });
    return wrap;
  }

  function buildSelectableSourceRow({
    entry,
    sourceSelectionState,
    bookmarkTags,
  }) {
    ensureSourceEntryState(sourceSelectionState, entry);
    const row = document.createElement("div");
    row.className = "tests-source-row";
    row.dataset.sourceId = entry.id;
    row.dataset.haystack = `${entry.title || ""} ${
      entry.subtext || ""
    }`.toLowerCase();
    row.tabIndex = 0;
    row.role = "button";
    row.innerHTML = `
      ${
        entry.icon
          ? `<img class="tests-source-row-icon" src="${escapeAttr(
              entry.icon
            )}" alt="" loading="lazy" decoding="async">`
          : ""
      }
      <div class="tests-source-row-copy">
        <div class="tests-source-row-title">${escapeHtml(entry.title || "")}</div>
        ${
          entry.subtext
            ? `<div class="tests-source-row-sub">${escapeHtml(entry.subtext)}</div>`
            : ""
        }
        <div class="tests-source-row-filter-state d-none"></div>
      </div>
      <div class="tests-source-row-actions">
        <button type="button" class="btn btn-sm btn-outline-secondary tests-source-filter-btn d-none" title="Filters" aria-label="Filters">
          <i class="bi bi-funnel"></i>
        </button>
        <button type="button" class="btn btn-sm btn-link tests-source-clear-btn d-none">
          Clear
        </button>
        <div class="tests-source-row-check">
          <i class="bi bi-check-lg"></i>
        </div>
      </div>
    `;
    const rowIcon = row.querySelector(".tests-source-row-icon");
    if (rowIcon) {
      rowIcon.onerror = () => {
        rowIcon.onerror = null;
        rowIcon.src = PYQ_ICON_FALLBACK;
      };
    }

    const filterBtn = row.querySelector(".tests-source-filter-btn");
    const clearBtn = row.querySelector(".tests-source-clear-btn");
    const syncRowState = () => {
      syncSelectableSourceRowState({
        row,
        entry,
        sourceSelectionState,
        filterBtn,
        clearBtn,
      });
    };
    row.__syncSourceRow = syncRowState;

    row.addEventListener("click", () => {
      sourceSelectionState[entry.id].selected =
        !sourceSelectionState[entry.id].selected;
      syncRowState();
    });
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        sourceSelectionState[entry.id].selected =
          !sourceSelectionState[entry.id].selected;
        syncRowState();
      }
    });
    filterBtn?.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        await openSourceFilterModal(
          entry,
          sourceSelectionState,
          bookmarkTags,
          syncRowState
        );
      } catch (error) {
        console.error("source filter modal failed", error);
        if (typeof showNotice === "function") {
          await showNotice({
            title: "Filters",
            message: "Failed to open filters for this source.",
          });
        }
      }
    });
    clearBtn?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      sourceSelectionState[entry.id].filters = getDefaultSourceFilters(
        entry.kind
      );
      syncRowState();
    });
    syncRowState();
    return row;
  }

  function syncSelectableSourceRowState({
    row,
    entry,
    sourceSelectionState,
    filterBtn,
    clearBtn,
  }) {
    const entryState = sourceSelectionState[entry.id];
    const isSelected = !!entryState?.selected;
    row.classList.toggle("selected", isSelected);
    const active = hasSourceFilters(entry.kind, entryState?.filters);
    const stateEl = row.querySelector(".tests-source-row-filter-state");
    stateEl.classList.toggle("d-none", !active);
    stateEl.innerHTML = active
      ? `<span class="badge bg-warning-subtle text-warning-emphasis">Filters on</span>`
      : "";
    filterBtn.classList.toggle("d-none", !isSelected);
    clearBtn.classList.toggle("d-none", !active);
    filterBtn.classList.toggle("btn-primary", active);
    filterBtn.classList.toggle("btn-outline-secondary", !active);
  }

  function wireSourceListSearchAndBulkPick({
    input,
    pickVisibleBtn,
    rows,
    emptyState,
    sourceSelectionState,
  }) {
    const syncPickVisibleBtn = () => {
      if (!pickVisibleBtn) return;
      const visibleRows = getVisibleSourceRows(rows);
      const allVisibleSelected =
        visibleRows.length > 0 &&
        visibleRows.every((row) => {
          const sourceId = row.dataset.sourceId;
          return sourceId && sourceSelectionState[sourceId]?.selected;
        });
      pickVisibleBtn.disabled = !visibleRows.length;
      pickVisibleBtn.title = visibleRows.length
        ? `${allVisibleSelected ? "Unpick" : "Pick"} ${
            visibleRows.length
          } search result${visibleRows.length === 1 ? "" : "s"}`
        : "No search results to pick";
      pickVisibleBtn.setAttribute("aria-label", pickVisibleBtn.title);
    };

    input?.addEventListener("input", () => {
      const q = (input.value || "").trim().toLowerCase();
      let visibleCount = 0;
      rows.forEach((row) => {
        const visible = !q || (row.dataset.haystack || "").includes(q);
        row.classList.toggle("d-none", !visible);
        if (visible) visibleCount++;
      });
      emptyState.classList.toggle("d-none", visibleCount > 0);
      syncPickVisibleBtn();
    });

    pickVisibleBtn?.addEventListener("click", () => {
      const visibleRows = getVisibleSourceRows(rows);
      const shouldSelect = !visibleRows.every((row) => {
        const sourceId = row.dataset.sourceId;
        return sourceId && sourceSelectionState[sourceId]?.selected;
      });
      visibleRows.forEach((row) => {
        const sourceId = row.dataset.sourceId;
        if (!sourceId || !sourceSelectionState[sourceId]) return;
        sourceSelectionState[sourceId].selected = shouldSelect;
        row.__syncSourceRow?.();
      });
      syncPickVisibleBtn();
    });

    syncPickVisibleBtn();
  }

  function getVisibleSourceRows(rows) {
    return rows.filter((row) => !row.classList.contains("d-none"));
  }

  function buildThirdLevelSourceTabs(items, sourceSelectionState, bookmarkTags) {
    const wrap = document.createElement("div");
    wrap.className = "tests-source-panel-inner";

    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "tests-source-empty";
      empty.innerHTML = `
        <h6>No subjects available</h6>
        <p>No chapters are available in this exam yet.</p>
      `;
      wrap.appendChild(empty);
      return wrap;
    }

    const tabsWrap = document.createElement("nav");
    tabsWrap.className = "tests-source-inner-tabs-wrap overflow-x-auto";
    const tabs = document.createElement("ul");
    tabs.className =
      "nav nav-tabs flex-nowrap mb-1 rounded-top tests-source-inner-tabs";
    tabsWrap.appendChild(tabs);

    const panels = document.createElement("div");
    panels.className = "tests-source-inner-panels";

    items.forEach((item, index) => {
      const li = document.createElement("li");
      li.className = "nav-item";
      li.setAttribute("role", "presentation");

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `nav-link tests-source-third-tab${index === 0 ? " active" : ""}`;
      btn.dataset.thirdSourceTab = item.key;
      btn.appendChild(buildSourceTabLabel(item));
      li.appendChild(btn);
      tabs.appendChild(li);

      const panel = document.createElement("div");
      panel.className = `tests-source-third-panel${index === 0 ? " active" : ""}`;
      panel.dataset.thirdSourcePanel = item.key;
      panel.appendChild(
        buildSelectableSourceList(item, sourceSelectionState, bookmarkTags)
      );
      panels.appendChild(panel);

      btn.addEventListener("click", () => {
        activateTabbedPanel({
          tabsHost: tabs,
          panelsHost: panels,
          activeTab: btn,
          tabSelector: ".tests-source-third-tab",
          panelSelector: ".tests-source-third-panel",
          panelDataKey: "thirdSourcePanel",
          activeKey: item.key,
        });
      });
    });

    wrap.append(tabsWrap, panels);
    return wrap;
  }

  function buildSourceTabLabel(item) {
    const wrap = document.createElement("span");
    wrap.className = "tests-source-tab-label";

    if (item?.icon) {
      const ico = document.createElement("img");
      ico.className = "ico";
      ico.alt = "";
      ico.loading = "lazy";
      ico.decoding = "async";
      ico.referrerPolicy = "no-referrer";
      ico.crossOrigin = "anonymous";
      ico.src = item.icon;
      ico.onerror = () => {
        ico.style.display = "none";
      };
      wrap.appendChild(ico);
    }

    const text = document.createElement("span");
    text.textContent = item?.label || "";
    wrap.appendChild(text);
    return wrap;
  }

  function collectPyqSourceIds(sourceOptions) {
    const ids = [];
    const visit = (items) => {
      (items || []).forEach((item) => {
        if (!item) return;
        if (item.kind === "pyq" && item.id) {
          ids.push(String(item.id));
          return;
        }
        if (Array.isArray(item.items)) visit(item.items);
      });
    };
    visit(sourceOptions?.pyqExams || []);
    return Array.from(new Set(ids));
  }

  async function loadBookmarkTags() {
    try {
      const res = await authFetch(`${API_BASE}/api/bookmark-tags`, {
        cache: "no-store",
      });
      if (!res.ok) return [];
      return await res.json();
    } catch {
      return [];
    }
  }

  function ensureSourceEntryState(state, entry) {
    if (!state[entry.id]) {
      state[entry.id] = {
        selected: false,
        kind: entry.kind,
        filters: getDefaultSourceFilters(entry.kind),
      };
    } else if (!state[entry.id].filters) {
      state[entry.id].filters = getDefaultSourceFilters(entry.kind);
    }
    state[entry.id].kind = entry.kind;
  }

  function getDefaultSourceFilters(kind) {
    if (kind === "pyq") {
      return {
        q: "",
        years: [],
        status: [],
        diff: [],
        bookmarkTagIds: [],
        colors: [],
      };
    }
    return {
      bookmarkTagIds: [],
      colors: [],
    };
  }

  function hasSourceFilters(kind, filters) {
    const f = filters || getDefaultSourceFilters(kind);
    if (kind === "pyq") {
      return !!(
        (f.q || "").trim() ||
        (Array.isArray(f.years) && f.years.length) ||
        (Array.isArray(f.status) && f.status.length) ||
        (Array.isArray(f.diff) && f.diff.length) ||
        (Array.isArray(f.bookmarkTagIds) && f.bookmarkTagIds.length) ||
        (Array.isArray(f.colors) && f.colors.length)
      );
    }
    return !!(
      (Array.isArray(f.bookmarkTagIds) && f.bookmarkTagIds.length) ||
      (Array.isArray(f.colors) && f.colors.length)
    );
  }

  function normalizeSourceFilters(kind, filters) {
    const base = { ...getDefaultSourceFilters(kind), ...(filters || {}) };
    if (kind === "pyq") {
      return {
        ...base,
        years: Array.isArray(base.years)
          ? base.years.filter((y) => Number.isFinite(Number(y))).map(Number)
          : [],
        status: Array.isArray(base.status)
          ? base.status.filter(Boolean)
          : base.status
          ? [String(base.status)]
          : [],
        diff: Array.isArray(base.diff)
          ? base.diff.filter(Boolean)
          : base.diff
          ? [String(base.diff)]
          : [],
        bookmarkTagIds: Array.isArray(base.bookmarkTagIds)
          ? base.bookmarkTagIds.filter(Boolean)
          : [],
        colors: Array.isArray(base.colors) ? base.colors.filter(Boolean) : [],
      };
    }
    return {
      ...base,
      bookmarkTagIds: Array.isArray(base.bookmarkTagIds)
        ? base.bookmarkTagIds.filter(Boolean)
        : [],
      colors: Array.isArray(base.colors) ? base.colors.filter(Boolean) : [],
    };
  }

  function ensureGlobalFilterState(state) {
    if (!state || typeof state !== "object") return;
    state.assignment = normalizeSourceFilters("assignment", state.assignment);
    state.pyq = normalizeSourceFilters("pyq", state.pyq);
  }

  function buildEffectiveSourceSelections(sourceSelectionState, globalFilterState) {
    ensureGlobalFilterState(globalFilterState);
    const result = {};
    Object.entries(sourceSelectionState || {}).forEach(([sourceId, state]) => {
      if (!state || !state.selected) return;
      const kind = String(state.kind || "").toLowerCase();
      const inferredKind =
        kind === "pyq" || String(sourceId).includes("::") ? "pyq" : "assignment";
      result[sourceId] = {
        ...structuredCloneSafe(state),
        selected: true,
        filters: intersectSourceFilters(
          inferredKind,
          normalizeSourceFilters(inferredKind, state.filters),
          globalFilterState?.[inferredKind]
        ),
      };
    });
    return result;
  }

  function compactSourceSelectionState(sourceSelectionState) {
    const result = {};
    Object.entries(sourceSelectionState || {}).forEach(([sourceId, state]) => {
      if (!state || !state.selected) return;
      const kind = String(state.kind || "").toLowerCase();
      const inferredKind =
        kind === "pyq" || String(sourceId).includes("::") ? "pyq" : "assignment";
      result[sourceId] = {
        selected: true,
        kind: inferredKind,
        filters: normalizeSourceFilters(inferredKind, state.filters),
      };
    });
    return result;
  }

  function intersectSourceFilters(kind, localFilters, globalFilters) {
    const local = normalizeSourceFilters(kind, localFilters);
    const global = normalizeSourceFilters(kind, globalFilters);
    const intersectArrayFilter = (a, b) => {
      const left = Array.isArray(a) ? a.map(String) : [];
      const right = Array.isArray(b) ? b.map(String) : [];
      if (!left.length) return { values: right.slice(), matchNone: false };
      if (!right.length) return { values: left.slice(), matchNone: false };
      const rightSet = new Set(right);
      const values = left.filter((item) => rightSet.has(item));
      return { values, matchNone: values.length === 0 };
    };

    if (kind === "pyq") {
      const qParts = [global.q, local.q]
        .map((value) => String(value || "").trim())
        .filter(Boolean);
      const years = intersectArrayFilter(local.years, global.years);
      const status = intersectArrayFilter(local.status, global.status);
      const diff = intersectArrayFilter(local.diff, global.diff);
      const bookmarkTagIds = intersectArrayFilter(
        local.bookmarkTagIds,
        global.bookmarkTagIds
      );
      const colors = intersectArrayFilter(local.colors, global.colors);
      return {
        ...local,
        q: qParts.join(" "),
        years: years.values.map(Number),
        status: status.values,
        diff: diff.values,
        bookmarkTagIds: bookmarkTagIds.values,
        colors: colors.values,
        matchNone:
          years.matchNone ||
          status.matchNone ||
          diff.matchNone ||
          bookmarkTagIds.matchNone ||
          colors.matchNone,
      };
    }

    const bookmarkTagIds = intersectArrayFilter(
      local.bookmarkTagIds,
      global.bookmarkTagIds
    );
    const colors = intersectArrayFilter(local.colors, global.colors);
    return {
      ...local,
      bookmarkTagIds: bookmarkTagIds.values,
      colors: colors.values,
      matchNone: bookmarkTagIds.matchNone || colors.matchNone,
    };
  }

  async function openSourceFilterModal(
    entry,
    sourceSelectionState,
    bookmarkTags,
    onApplied
  ) {
    ensureSourceEntryState(sourceSelectionState, entry);
    const state = sourceSelectionState[entry.id];
    const draftFilters = {
      ...getDefaultSourceFilters(entry.kind),
      ...normalizeSourceFilters(entry.kind, state.filters || {}),
    };
    const tagOptions = (bookmarkTags || []).map((tag) => ({
      id: String(tag.id),
      name: String(tag.name || ""),
    }));
    const yearOptions =
      entry.kind === "pyq"
        ? await loadPyqYearOptions(entry.sourceIds || entry.id)
        : [];
    const modalId = `source-filter-${slugify(entry.id)}`;
    const tagFieldId = `${modalId}-tag-field`;
    const tagListId = `${modalId}-tag-list`;
    const tagInputId = `${modalId}-tag-input`;
    const tagSuggestionsId = `${modalId}-tag-suggestions`;

    const pyqFields =
      entry.kind === "pyq"
        ? `
          <div>
            <label class="form-label" for="${modalId}-q">Question text</label>
            <input id="${modalId}-q" class="form-control" type="text" value="${escapeAttr(
              draftFilters.q || ""
            )}" placeholder="Search inside question text">
          </div>
          <div>
            <label class="form-label">Years</label>
            <div id="${modalId}-years"></div>
          </div>
          <div>
            <label class="form-label">Status</label>
            <div class="tests-filter-check-grid">
              ${buildCheckboxOption(`${modalId}-status`, "", "Any", !(draftFilters.status || []).length)}
              ${buildCheckboxOption(`${modalId}-status`, "not-started", "Not Started", (draftFilters.status || []).includes("not-started"))}
              ${buildCheckboxOption(`${modalId}-status`, "in-progress", "In Progress", (draftFilters.status || []).includes("in-progress"))}
              ${buildCheckboxOption(`${modalId}-status`, "completed", "Completed", (draftFilters.status || []).includes("completed"))}
              ${buildCheckboxOption(`${modalId}-status`, "correct", "Correct", (draftFilters.status || []).includes("correct"))}
              ${buildCheckboxOption(`${modalId}-status`, "partial", "Partial", (draftFilters.status || []).includes("partial"))}
              ${buildCheckboxOption(`${modalId}-status`, "incorrect", "Incorrect", (draftFilters.status || []).includes("incorrect"))}
            </div>
          </div>
          <div>
            <label class="form-label">Difficulty</label>
            <div class="tests-filter-check-grid">
              ${buildCheckboxOption(`${modalId}-diff`, "", "Any", !(draftFilters.diff || []).length)}
              ${buildCheckboxOption(`${modalId}-diff`, "easy", "Easy", (draftFilters.diff || []).includes("easy"))}
              ${buildCheckboxOption(`${modalId}-diff`, "medium", "Medium", (draftFilters.diff || []).includes("medium"))}
              ${buildCheckboxOption(`${modalId}-diff`, "hard", "Hard", (draftFilters.diff || []).includes("hard"))}
            </div>
          </div>
          <div>
            <label class="form-label">Question colors</label>
            <div class="tests-filter-color-grid">
              ${buildColorChip("none", "None", draftFilters.colors?.includes("none"))}
              ${buildColorChip("#0d6efd", "Blue", draftFilters.colors?.includes("#0d6efd"))}
              ${buildColorChip("#dc3545", "Red", draftFilters.colors?.includes("#dc3545"))}
              ${buildColorChip("#ffc107", "Yellow", draftFilters.colors?.includes("#ffc107"))}
              ${buildColorChip("#198754", "Green", draftFilters.colors?.includes("#198754"))}
            </div>
          </div>
        `
        : `
          <div>
            <label class="form-label">Question colors</label>
            <div class="tests-filter-color-grid">
              ${buildColorChip("none", "None", draftFilters.colors?.includes("none"))}
              ${buildColorChip("#0d6efd", "Blue", draftFilters.colors?.includes("#0d6efd"))}
              ${buildColorChip("#dc3545", "Red", draftFilters.colors?.includes("#dc3545"))}
              ${buildColorChip("#ffc107", "Yellow", draftFilters.colors?.includes("#ffc107"))}
              ${buildColorChip("#198754", "Green", draftFilters.colors?.includes("#198754"))}
            </div>
          </div>
        `;

    const bodyHTML = `
      <div class="tests-filter-modal">
        <div>
          <div class="fw-semibold mb-1">${escapeHtml(entry.title || "")}</div>
          ${
            entry.subtext
              ? `<div class="text-secondary small">${escapeHtml(entry.subtext)}</div>`
              : ""
          }
        </div>
        <div>
          <label class="form-label" for="${tagInputId}">Bookmark tags</label>
          <div class="tests-tag-field" id="${tagFieldId}">
            <div class="tests-tag-list" id="${tagListId}"></div>
            <input
              id="${tagInputId}"
              type="text"
              class="tests-tag-input"
              placeholder="Type a tag"
              autocomplete="off"
              spellcheck="false"
            />
          </div>
          <div class="tests-tag-suggestions d-none" id="${tagSuggestionsId}"></div>
        </div>
        ${pyqFields}
      </div>
    `;

    let filterModalEl = null;
    const result = await showModal({
      title: "Question Filters",
      bodyHTML,
      dialogClass: "modal-lg modal-dialog-scrollable",
      stack: true,
      buttons: [
        {
          text: "Cancel",
          className: "btn btn-outline-secondary",
          value: { action: "cancel" },
        },
        {
          text: "Clear",
          className: "btn btn-outline-warning",
          value: { action: "clear" },
        },
        {
          text: "Apply",
          className: "btn btn-primary",
          value: { action: "apply" },
        },
      ],
      onContentReady: (modalEl) => {
        filterModalEl = modalEl;
        const selectedTagIds = Array.from(draftFilters.bookmarkTagIds || []);
        if (entry.kind === "pyq") {
          setupYearRangeControl({
            host: modalEl.querySelector(`#${modalId}-years`),
            years: yearOptions,
            selectedYears: draftFilters.years || [],
          });
        }
        setupGenericChipPicker({
          fieldEl: modalEl.querySelector(`#${tagFieldId}`),
          listEl: modalEl.querySelector(`#${tagListId}`),
          inputEl: modalEl.querySelector(`#${tagInputId}`),
          suggestionsEl: modalEl.querySelector(`#${tagSuggestionsId}`),
          options: tagOptions.map((tag) => ({
            id: String(tag.id),
            label: tag.name,
          })),
          selected: selectedTagIds,
        });
        if (entry.kind === "pyq") {
          setupMultiCheckboxGroup(modalEl, `${modalId}-status`);
          setupMultiCheckboxGroup(modalEl, `${modalId}-diff`);
        }

        modalEl.__sourceFilterDraft = {
          getValue() {
            const base = {
              bookmarkTagIds: selectedTagIds.slice(),
            };
            if (entry.kind === "pyq") {
              return {
                ...base,
                q: String(modalEl.querySelector(`#${modalId}-q`)?.value || "").trim(),
                years: readYearRangeControl(
                  modalEl.querySelector(`#${modalId}-years`)
                ),
                status: readMultiCheckboxGroup(modalEl, `${modalId}-status`),
                diff: readMultiCheckboxGroup(modalEl, `${modalId}-diff`),
                colors: Array.from(
                  modalEl.querySelectorAll(".tests-filter-color-chip.selected")
                ).map((el) =>
                  String(el.getAttribute("data-color") || "").toLowerCase()
                ),
              };
            }
            return {
              ...base,
              colors: Array.from(
                modalEl.querySelectorAll(".tests-filter-color-chip.selected")
              ).map((el) => String(el.getAttribute("data-color") || "").toLowerCase()),
            };
          },
        };

        modalEl
          .querySelectorAll(".tests-filter-color-chip")
          .forEach((el) =>
            el.addEventListener("click", () => el.classList.toggle("selected"))
          );
      },
    });

    if (result?.action === "clear") {
      state.filters = getDefaultSourceFilters(entry.kind);
      onApplied?.();
      return;
    }
    if (result?.action !== "apply") return;

    const modalRoot = filterModalEl || document;
    const nextFilters =
      modalRoot.__sourceFilterDraft?.getValue?.() ||
      getDefaultSourceFilters(entry.kind);
    state.filters = nextFilters;
    onApplied?.();
  }

  async function loadPyqYearOptions(sourceId) {
    if (Array.isArray(sourceId)) {
      const yearLists = await Promise.all(
        sourceId.map((id) => loadPyqYearOptions(id))
      );
      return Array.from(new Set(yearLists.flat())).sort((a, b) => b - a);
    }
    const [examId, subjectId, chapterId] = String(sourceId || "").split("::");
    if (!examId || !subjectId || !chapterId) return [];
    try {
      const res = await authFetch(
        `${API_BASE}/api/pyqs/exams/${encodeURIComponent(
          examId
        )}/subjects/${encodeURIComponent(
          subjectId
        )}/chapters/${encodeURIComponent(chapterId)}/questions?meta=1`,
        { cache: "no-store" }
      );
      if (!res.ok) return [];
      const data = await res.json();
      const rows = Array.isArray(data?.questions) ? data.questions : Array.isArray(data) ? data : [];
      const years = Array.from(
        new Set(
          rows
            .map((q) => {
              const m = String(q?.pyqInfo || "").match(/(19|20)\d{2}/);
              return m ? Number(m[0]) : null;
            })
            .filter(Number.isFinite)
        )
      );
      return years.sort((a, b) => b - a);
    } catch {
      return [];
    }
  }

  function buildCheckboxOption(name, value, label, checked) {
    const id = `${name}-${slugify(`${value || "any"}-${label}`)}`;
    return `<div class="form-check form-check-sm">
      <input class="form-check-input" type="checkbox" name="${name}" id="${id}" value="${escapeAttr(
      value
    )}" ${checked ? "checked" : ""}>
      <label class="form-check-label" for="${id}">${escapeHtml(label)}</label>
    </div>`;
  }

  function buildColorChip(color, label, selected) {
    const style = color === "none" ? "" : `style="--qc:${color}"`;
    return `<button type="button" class="tests-filter-color-chip ${
      selected ? "selected" : ""
    }" data-color="${color.toLowerCase()}" ${style} title="${escapeAttr(
      label
    )}" aria-label="${escapeAttr(label)}"></button>`;
  }

  function setupGenericChipPicker({
    fieldEl,
    listEl,
    inputEl,
    suggestionsEl,
    options,
    selected,
  }) {
    const state = {
      selected,
      highlightedIndex: 0,
    };

    const closeSuggestions = () => {
      suggestionsEl.classList.add("d-none");
      suggestionsEl.innerHTML = "";
      state.highlightedIndex = 0;
    };

    const getMatches = () => {
      const query = String(inputEl.value || "").trim().toLowerCase();
      if (!query) return [];
      return (options || [])
        .filter(
          (opt) =>
            String(opt.label || "")
              .toLowerCase()
              .includes(query) && !state.selected.includes(String(opt.id))
        )
        .slice(0, 6);
    };

    const renderTags = () => {
      listEl.innerHTML = "";
      state.selected.forEach((id) => {
        const opt = (options || []).find((item) => String(item.id) === String(id));
        if (!opt) return;
        const tag = document.createElement("span");
        tag.className = "tests-tag-chip";
        tag.innerHTML = `
          <span>${escapeHtml(opt.label)}</span>
          <button type="button" class="tests-tag-chip-remove" aria-label="Remove ${escapeAttr(
            opt.label
          )}">
            <i class="bi bi-x-lg"></i>
          </button>
        `;
        tag
          .querySelector(".tests-tag-chip-remove")
          ?.addEventListener("click", () => {
            state.selected.splice(state.selected.indexOf(String(id)), 1);
            renderTags();
            renderSuggestions();
            inputEl.focus();
          });
        listEl.appendChild(tag);
      });
      inputEl.placeholder = state.selected.length ? "" : "Type a tag";
    };

    const addOption = (id) => {
      const sid = String(id || "");
      if (!sid || state.selected.includes(sid)) return;
      state.selected.push(sid);
      inputEl.value = "";
      renderTags();
      closeSuggestions();
    };

    const renderSuggestions = () => {
      const matches = getMatches();
      if (!matches.length) {
        closeSuggestions();
        return;
      }
      suggestionsEl.innerHTML = "";
      if (state.highlightedIndex >= matches.length) state.highlightedIndex = 0;
      matches.forEach((opt, index) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `tests-tag-suggestion${
          index === state.highlightedIndex ? " active" : ""
        }`;
        btn.textContent = opt.label;
        btn.addEventListener("mousedown", (event) => {
          event.preventDefault();
          addOption(opt.id);
        });
        suggestionsEl.appendChild(btn);
      });
      suggestionsEl.classList.remove("d-none");
    };

    fieldEl?.addEventListener("click", () => inputEl?.focus());
    inputEl?.addEventListener("input", () => {
      state.highlightedIndex = 0;
      renderSuggestions();
    });
    inputEl?.addEventListener("keydown", (event) => {
      const matches = getMatches();
      if ((event.key === "Tab" || event.key === "Enter") && matches.length) {
        event.preventDefault();
        addOption(matches[state.highlightedIndex]?.id || matches[0].id);
        return;
      }
      if (event.key === "ArrowDown" && matches.length) {
        event.preventDefault();
        state.highlightedIndex = (state.highlightedIndex + 1) % matches.length;
        renderSuggestions();
        return;
      }
      if (event.key === "ArrowUp" && matches.length) {
        event.preventDefault();
        state.highlightedIndex =
          (state.highlightedIndex - 1 + matches.length) % matches.length;
        renderSuggestions();
        return;
      }
      if (event.key === "Backspace" && !inputEl.value && state.selected.length) {
        state.selected.pop();
        renderTags();
        renderSuggestions();
      }
    });
    inputEl?.addEventListener("blur", () => window.setTimeout(closeSuggestions, 120));
    renderTags();
  }

  function structuredCloneSafe(value) {
    try {
      return structuredClone(value);
    } catch {
      return JSON.parse(JSON.stringify(value || {}));
    }
  }

  function setupYearRangeControl({ host, years, selectedYears }) {
    if (!host) return;
    const sortedYears = Array.from(
      new Set((years || []).filter(Number.isFinite))
    ).sort((a, b) => a - b);
    if (!sortedYears.length) {
      host.innerHTML = '<div class="text-muted small">No year data available</div>';
      return;
    }
    const minYear = sortedYears[0];
    const maxYear = sortedYears[sortedYears.length - 1];
    const activeYears =
      Array.isArray(selectedYears) && selectedYears.length
        ? sortedYears.filter((y) => selectedYears.includes(y))
        : sortedYears.slice();
    const startMin = activeYears.length ? Math.min(...activeYears) : minYear;
    const startMax = activeYears.length ? Math.max(...activeYears) : maxYear;

    host.innerHTML = `
      <div class="tests-year-range" data-year-range-host>
        <div class="d-flex align-items-center justify-content-between gap-2 mb-2">
          <span class="small text-muted">Selected range</span>
          <button type="button" class="btn btn-sm btn-link py-0 px-0 text-warning tests-year-clear">Clear</button>
        </div>
        <div class="tests-year-range-values">
          <input
            class="form-control form-control-sm tests-year-value-input tests-year-value-min"
            type="number"
            min="${minYear}"
            max="${maxYear}"
            step="1"
            value="${startMin}"
            aria-label="Minimum year"
          >
          <input
            class="form-control form-control-sm tests-year-value-input tests-year-value-max"
            type="number"
            min="${minYear}"
            max="${maxYear}"
            step="1"
            value="${startMax}"
            aria-label="Maximum year"
          >
        </div>
        <div class="tests-year-slider-wrap">
          <div class="tests-year-slider-track">
            <div class="tests-year-slider-fill"></div>
          </div>
          <input class="form-range tests-year-range-input tests-year-range-min" type="range" min="${minYear}" max="${maxYear}" step="1" value="${startMin}">
          <input class="form-range tests-year-range-input tests-year-range-max" type="range" min="${minYear}" max="${maxYear}" step="1" value="${startMax}">
        </div>
        <div class="d-flex justify-content-between text-muted small mt-2">
          <span>${minYear}</span>
          <span>${maxYear}</span>
        </div>
      </div>
    `;
    host.dataset.allYears = JSON.stringify(sortedYears);
    syncYearRangeControl(host, "init");
    host
      .querySelector(".tests-year-range-min")
      ?.addEventListener("input", () => syncYearRangeControl(host, "min"));
    host
      .querySelector(".tests-year-range-max")
      ?.addEventListener("input", () => syncYearRangeControl(host, "max"));
    host
      .querySelector(".tests-year-value-min")
      ?.addEventListener("change", () => syncYearRangeControl(host, "value-min"));
    host
      .querySelector(".tests-year-value-max")
      ?.addEventListener("change", () => syncYearRangeControl(host, "value-max"));
    host.querySelectorAll(".tests-year-value-input").forEach((input) => {
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        syncYearRangeControl(
          host,
          input.classList.contains("tests-year-value-min")
            ? "value-min"
            : "value-max"
        );
        input.blur();
      });
    });
    host.querySelector(".tests-year-clear")?.addEventListener("click", () => {
      host.querySelector(".tests-year-range-min").value = String(minYear);
      host.querySelector(".tests-year-range-max").value = String(maxYear);
      syncYearRangeControl(host, "clear");
    });
  }

  function syncYearRangeControl(host, source) {
    if (!host) return;
    const allYears = JSON.parse(host.dataset.allYears || "[]");
    if (!allYears.length) return;
    const minYear = Math.min(...allYears);
    const maxYear = Math.max(...allYears);
    const minInput = host.querySelector(".tests-year-range-min");
    const maxInput = host.querySelector(".tests-year-range-max");
    const minValueInput = host.querySelector(".tests-year-value-min");
    const maxValueInput = host.querySelector(".tests-year-value-max");
    const clampYear = (value, fallback) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return fallback;
      return Math.min(maxYear, Math.max(minYear, Math.round(parsed)));
    };
    const isValueMin = source === "value-min";
    const isValueMax = source === "value-max";
    let lo = clampYear(
      isValueMin ? minValueInput?.value : minInput?.value,
      Number(minInput.value) || minYear
    );
    let hi = clampYear(
      isValueMax ? maxValueInput?.value : maxInput?.value,
      Number(maxInput.value) || maxYear
    );
    if (lo > hi) {
      if (source === "min" || isValueMin) hi = lo;
      else lo = hi;
    }
    minInput.value = String(lo);
    maxInput.value = String(hi);
    if (minValueInput) minValueInput.value = String(lo);
    if (maxValueInput) maxValueInput.value = String(hi);
    const left = ((lo - minYear) / Math.max(1, maxYear - minYear)) * 100;
    const right = ((hi - minYear) / Math.max(1, maxYear - minYear)) * 100;
    const fill = host.querySelector(".tests-year-slider-fill");
    fill.style.left = `${left}%`;
    fill.style.width = `${right - left}%`;
  }

  function readYearRangeControl(host) {
    if (!host) return [];
    const allYears = JSON.parse(host.dataset.allYears || "[]");
    if (!allYears.length) return [];
    const minYear = Math.min(...allYears);
    const maxYear = Math.max(...allYears);
    const lo = Number(
      host.querySelector(".tests-year-range-min")?.value || minYear
    );
    const hi = Number(
      host.querySelector(".tests-year-range-max")?.value || maxYear
    );
    if (lo === minYear && hi === maxYear) return [];
    return allYears.filter((y) => y >= lo && y <= hi);
  }

  function setupMultiCheckboxGroup(modalEl, name) {
    const boxes = Array.from(
      modalEl.querySelectorAll(`input[type="checkbox"][name="${name}"]`)
    );
    const anyBox = boxes.find((box) => String(box.value || "") === "");
    boxes.forEach((box) => {
      box.addEventListener("change", () => {
        const value = String(box.value || "");
        if (!value) {
          if (box.checked) {
            boxes.forEach((other) => {
              if (other !== box) other.checked = false;
            });
          }
          return;
        }
        if (box.checked && anyBox) anyBox.checked = false;
        if (!boxes.some((other) => String(other.value || "") !== "" && other.checked) && anyBox) {
          anyBox.checked = true;
        }
      });
    });
  }

  function readMultiCheckboxGroup(modalEl, name) {
    return Array.from(
      modalEl.querySelectorAll(`input[type="checkbox"][name="${name}"]:checked`)
    )
      .map((el) => String(el.value || ""))
      .filter(Boolean);
  }
})();
