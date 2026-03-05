      (() => {
        // ---------- State ----------
        const pagesEl = document.getElementById("pages");
        const thumbsEl = document.getElementById("thumbs");
        const viewerEl = document.getElementById("viewer");
        const emptyStateEl = document.getElementById("emptyState");
        const emptyOpenDocsBtn = document.getElementById("emptyOpenDocsBtn");
        const loadingMaskEl = document.getElementById("loadingMask");
        const loadingTextEl = document.getElementById("loadingText");
        const pageCountEl = document.getElementById("pageCount");
        const nextLabelEl = document.getElementById("nextLabel");
        const histStateEl = document.getElementById("histState");
        const liveEl = document.getElementById("live");
        const docNameEl = document.getElementById("docName");
        const docTickerEl = document.querySelector(".doc-ticker");
        const exportScaleEl = document.getElementById("exportScale");
        const openDocsBtn = document.getElementById("openDocsBtn");
        const refreshDocsBtn = document.getElementById("refreshDocsBtn");
        const docModalEl = document.getElementById("docModal");
        const closeDocModalBtn = document.getElementById("closeDocModalBtn");
        const docSearchEl = document.getElementById("docSearch");
        const docTreeEl = document.getElementById("docTree");
        const expandDocsBtn = document.getElementById("expandDocsBtn");
        const collapseDocsBtn = document.getElementById("collapseDocsBtn");
        const docMatchCountEl = document.getElementById("docMatchCount");
        const saveStateEl = document.getElementById("saveState");
        let dragFromIndex = null;
        const STORAGE_KEY = "sniplab.sessions.v1";
        const MAX_SAVED_SESSIONS = 50;
        const PDF_RENDER_SCALE = 2.5;
        const DEFAULT_API_BASE = "http://localhost:3030";
        let currentSessionKey = null;
        let currentDocId = null;
        let currentDocName = "No document loaded";
        let serverDocs = [];
        const expandedDocFolders = new Set();
        let mergedPageTopOffsets = [];
        let pageBreakLayerEl = null;
        let saveTimer = null;
        let saveStateTimer = null;
        let serverSaveInFlight = false;
        const pendingServerSaves = new Map();
        let isRestoringSession = false;
        let draggedThumb = null;

        // Toolbar controls
        const zoomSlider = document.getElementById("zoom");
        const zoomInBtn = document.getElementById("zoomIn");
        const zoomOutBtn = document.getElementById("zoomOut");
        const zoomResetBtn = document.getElementById("zoomReset");
        const pToggleBtn = document.getElementById("pToggle");
        const exportBtn = document.getElementById("exportBtn");
        const helpBtn = document.getElementById("helpBtn");
        const helpPanel = document.getElementById("help");
        const undoBtn = document.getElementById("undoBtn");
        const redoBtn = document.getElementById("redoBtn");
        const urlParams = new URLSearchParams(window.location.search);
        const initialDocId = String(urlParams.get("doc") || "").trim();
        const autoCloseAfterExport = /^(1|true|yes)$/i.test(
          String(urlParams.get("autoclose") || "").trim()
        );

        function getApiBase() {
          if (location.protocol === "file:") {
            const saved = localStorage.getItem("sniplab.apiBase");
            return saved || DEFAULT_API_BASE;
          }
          return "";
        }

        function apiUrl(pathname) {
          const base = getApiBase();
          return base ? `${base}${pathname}` : pathname;
        }

        function promptCloseOrGoBackAfterExport() {
          const wantsLeave = window.confirm(
            "Export complete. Close this page and go back?"
          );
          if (!wantsLeave) return;

          try {
            window.close();
          } catch {}

          setTimeout(() => {
            if (window.closed) return;
            if (window.history.length > 1) {
              window.history.back();
              return;
            }
            try {
              window.location.replace("about:blank");
            } catch {}
          }, 120);
        }

        function tryCloseWindowAfterExport() {
          if (autoCloseAfterExport) {
            setTimeout(() => {
              try {
                window.close();
              } catch {}
              setTimeout(() => {
                if (!window.closed) {
                  promptCloseOrGoBackAfterExport();
                }
              }, 120);
            }, 120);
            return;
          }
          promptCloseOrGoBackAfterExport();
        }

        function setLoading(isLoading, message = "Loading document...") {
          if (!loadingMaskEl) return;
          if (loadingTextEl) loadingTextEl.textContent = message;
          loadingMaskEl.hidden = !isLoading;
          viewerEl.setAttribute("aria-busy", isLoading ? "true" : "false");
          updateEmptyState();
        }

        function setExportLoading(isLoading, message = "Exporting ZIP...") {
          setLoading(isLoading, message);
        }

        function setSaveStatus(state, text) {
          if (!saveStateEl) return;
          saveStateEl.dataset.state = state;
          saveStateEl.textContent = text;
        }

        function setSaveStatusSavedSoon(text = "Saved") {
          clearTimeout(saveStateTimer);
          setSaveStatus("saved", text);
          saveStateTimer = setTimeout(() => {
            setSaveStatus("saved", "Saved");
          }, 1800);
        }

        const state = {
          pages: [], // {type:'image'|'pdf', baseCSSWidth, baseCSSHeight, pixelW, pixelH, node:{...}}
          zoom: 1,
          activePage: 0,
          crosshair: true,
          // Labeling
          pMode: false,
          normalCounter: 1,
          passageCounter: 1,
          // Selection
          currentSelection: null, // HTMLElement .selection
          boxIdCounter: 1,
        };

        // History stacks
        const history = {
          undo: [],
          redo: [],
        };
        const polygonDraft = {
          pageNode: null,
          points: [],
          cursor: null,
        };
        let vertexDrag = null;
        function updateThumbMeta() {
          [...thumbsEl.children].forEach((img, i) => {
            img.alt = `Page ${i + 1}`;
            img.title = `Go to page ${i + 1}`;
          });
        }

        function pushAction(action) {
          history.undo.push(action);
          history.redo.length = 0;
          updateHistoryUI();
          scheduleSessionSave();
        }
        function updateHistoryUI() {
          histStateEl.textContent = `${history.undo.length} / ${history.redo.length}`;
          undoBtn.disabled = history.undo.length === 0;
          redoBtn.disabled = history.redo.length === 0;
        }
        function announce(msg) {
          liveEl.textContent = msg;
        }

        function updateToolbar() {
          pageCountEl.textContent = getLogicalPageCount();
          docNameEl.textContent = currentDocName;
          updateDocNameTicker();
          pToggleBtn.textContent = `Passage Select: ${state.pMode ? "ON" : "OFF"}`;
          pToggleBtn.style.background = state.pMode ? "#2a3d2f" : "#243040";
          pToggleBtn.style.borderColor = state.pMode ? "#355a41" : "#2e3b4e";
          if (nextLabelEl) nextLabelEl.textContent = nextLabel();
          zoomResetBtn.textContent = Math.round(state.zoom * 100) + "%";
          updateHistoryUI();
          updateEmptyState();
        }

        function updateEmptyState() {
          if (!emptyStateEl) return;
          const isLoading = loadingMaskEl && !loadingMaskEl.hidden;
          const showEmpty = state.pages.length === 0 && !isLoading;
          emptyStateEl.hidden = !showEmpty;
        }

        function updateDocNameTicker() {
          if (!docNameEl || !docTickerEl) return;
          requestAnimationFrame(() => {
            const visible = docTickerEl.clientWidth;
            const total = docNameEl.scrollWidth;
            const overflow = Math.max(0, total - visible);
            if (overflow > 4) {
              docNameEl.classList.add("scrolling");
              docNameEl.style.setProperty("--doc-marquee-shift", `${overflow}px`);
              const duration = Math.max(6, overflow / 18);
              docNameEl.style.setProperty(
                "--doc-marquee-duration",
                `${duration.toFixed(2)}s`
              );
            } else {
              docNameEl.classList.remove("scrolling");
              docNameEl.style.removeProperty("--doc-marquee-shift");
              docNameEl.style.removeProperty("--doc-marquee-duration");
            }
          });
        }

        function getLogicalPageCount() {
          if (state.pages.length === 1 && mergedPageTopOffsets.length > 0) {
            return mergedPageTopOffsets.length;
          }
          return state.pages.length;
        }

        function nextLabel() {
          if (!state.pMode) return String(Math.max(1, state.normalCounter));
          return `p${Math.max(1, state.passageCounter)}`;
        }

        function consumeLabel() {
          if (!state.pMode) {
            const label = String(Math.max(1, state.normalCounter));
            state.normalCounter = Math.max(1, state.normalCounter + 1);
            return label;
          } else {
            const label = `p${Math.max(1, state.passageCounter)}`;
            state.passageCounter = Math.max(1, state.passageCounter + 1);
            return label;
          }
        }

        // ---------- Loading ----------
        openDocsBtn.addEventListener("click", openDocModal);
        if (emptyOpenDocsBtn) {
          emptyOpenDocsBtn.addEventListener("click", openDocModal);
        }
        refreshDocsBtn.addEventListener("click", fetchServerDocuments);
        closeDocModalBtn.addEventListener("click", closeDocModal);
        docModalEl.addEventListener("click", (e) => {
          if (e.target === docModalEl) closeDocModal();
        });
        docSearchEl.addEventListener("input", renderDocTree);
        expandDocsBtn.addEventListener("click", () => {
          docTreeEl
            .querySelectorAll("details[data-path]")
            .forEach((d) => expandedDocFolders.add(d.getAttribute("data-path")));
          renderDocTree();
        });
        collapseDocsBtn.addEventListener("click", () => {
          expandedDocFolders.clear();
          renderDocTree();
        });
        function openDocModal() {
          docModalEl.hidden = false;
          docSearchEl.focus();
          renderDocTree();
        }

        function closeDocModal() {
          docModalEl.hidden = true;
        }

        async function fetchServerDocuments() {
          try {
            const res = await fetch(apiUrl("/api/snip-docs"));
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const payload = await res.json();
            serverDocs = Array.isArray(payload.documents) ? payload.documents : [];
            renderDocTree();
          } catch (err) {
            console.warn("Failed to fetch snip documents:", err);
            serverDocs = [];
            docTreeEl.innerHTML = '<div class="pill">Server unavailable</div>';
          }
        }

        function renderDocTree() {
          const q = String(docSearchEl.value || "").trim().toLowerCase();
          const filtered = q
            ? serverDocs.filter((d) =>
                String(d.relativePath || "").toLowerCase().includes(q)
              )
            : serverDocs.slice();

          if (!filtered.length) {
            docTreeEl.innerHTML = '<div class="pill">No matching documents</div>';
            docMatchCountEl.textContent = "0 documents";
            return;
          }
          docMatchCountEl.textContent = `${filtered.length} document${
            filtered.length === 1 ? "" : "s"
          }`;

          const root = { children: {}, docs: [] };
          for (const d of filtered) {
            const parts = String(d.relativePath || "").split("/").filter(Boolean);
            let node = root;
            for (let i = 0; i < parts.length - 1; i++) {
              const part = parts[i];
              if (!node.children[part]) node.children[part] = { children: {}, docs: [] };
              node = node.children[part];
            }
            node.docs.push(d);
          }

          const esc = (s) =>
            String(s).replace(/[&<>"]/g, (ch) =>
              ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch])
            );

          const renderNode = (node, pathParts = []) => {
            let html = "";
            const keys = Object.keys(node.children).sort((a, b) =>
              a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
            );
            for (const key of keys) {
              const nextPathParts = pathParts.concat(key);
              const pathKey = nextPathParts.join("/");
              const shouldOpen = q ? true : expandedDocFolders.has(pathKey);
              html += `<details data-path="${esc(pathKey)}" ${
                shouldOpen ? "open" : ""
              }><summary>[DIR] ${esc(key)}</summary><div class="branch">${renderNode(
                node.children[key],
                nextPathParts
              )}</div></details>`;
            }
            const docs = node.docs.slice().sort((a, b) =>
              String(a.name).localeCompare(String(b.name), undefined, {
                numeric: true,
                sensitivity: "base",
              })
            );
            for (const d of docs) {
              html += `<button class="doc-leaf" data-doc-id="${esc(
                d.id
              )}" title="${esc(d.relativePath || d.name)}"><span>[DOC] ${esc(
                d.name
              )}</span><span class="meta">${Number(d.pageCount) || 0} pages</span></button>`;
            }
            return html;
          };

          docTreeEl.innerHTML = renderNode(root);
        }

        docTreeEl.addEventListener("toggle", (e) => {
          const details = e.target;
          if (!(details instanceof HTMLDetailsElement)) return;
          const pathKey = details.getAttribute("data-path");
          if (!pathKey) return;
          if (details.open) expandedDocFolders.add(pathKey);
          else expandedDocFolders.delete(pathKey);
        });

        docTreeEl.addEventListener("click", async (e) => {
          const btn = e.target.closest(".doc-leaf");
          if (!btn) return;
          const docId = String(btn.getAttribute("data-doc-id") || "").trim();
          if (!docId) return;
          closeDocModal();
          await loadServerDocumentById(docId);
        });

        async function loadServerDocumentById(docId) {
          setLoading(true, "Loading pages...");
          pagesEl.style.visibility = "hidden";
          pagesEl.style.pointerEvents = "none";
          pagesEl.setAttribute("aria-busy", "true");
          try {
            const url = `${apiUrl("/api/snip-docs/pages")}?doc=${encodeURIComponent(
              docId
            )}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const payload = await res.json();
            const pages = Array.isArray(payload.pages) ? payload.pages : [];

            resetCurrentDocument();
            currentSessionKey = `doc:${docId}`;
            currentDocId = docId;
            currentDocName = payload?.document?.relativePath || payload?.document?.name || docId;
            setLoading(true, `Loading ${pages.length} pages...`);
            for (const page of pages) {
              if (!page?.url) continue;
              await loadImageFromUrl(page.url);
            }
            setLoading(true, "Merging pages...");
            mergeLoadedPagesIntoSinglePage();
            setLoading(true, "Restoring selections...");
            const loadedServerSession = await loadServerSession(docId);
            if (loadedServerSession) {
              applySessionSnapshot(loadedServerSession);
            } else {
              restoreSession();
            }
            updateToolbar();
            if (state.pages.length) {
              zoomToFitWidth();
              scrollToPage(0, false, "start");
            }
            announce(`Loaded document ${payload?.document?.name || docId}`);
          } catch (err) {
            console.error("Failed to load server document:", err);
            alert("Failed to load document from server.");
          } finally {
            pagesEl.style.visibility = "";
            pagesEl.style.pointerEvents = "";
            pagesEl.setAttribute("aria-busy", "false");
            setLoading(false);
          }
        }

        function mergeLoadedPagesIntoSinglePage() {
          if (state.pages.length <= 1) {
            mergedPageTopOffsets = state.pages.length ? [0] : [];
            return;
          }
          const originalPages = state.pages.slice();
          const baseCSSWidth = originalPages[0].baseCSSWidth;
          mergedPageTopOffsets = [];
          let accCSS = 0;
          for (const p of originalPages) {
            mergedPageTopOffsets.push(accCSS);
            accCSS += p.baseCSSHeight;
          }
          const totalBaseCSSHeight = accCSS;

          const factors = originalPages.map((p) => {
            const sourceW = p.type === "image" ? p.pixelW : p.canvasEl.width;
            return sourceW / p.baseCSSWidth;
          });
          const renderFactor = Math.max(1, ...factors);
          const mergedPixelW = Math.max(1, Math.round(baseCSSWidth * renderFactor));
          const mergedPixelH = Math.max(
            1,
            Math.round(totalBaseCSSHeight * renderFactor)
          );

          const mergedCanvas = document.createElement("canvas");
          mergedCanvas.width = mergedPixelW;
          mergedCanvas.height = mergedPixelH;
          const mctx = mergedCanvas.getContext("2d");

          let yPx = 0;
          for (const p of originalPages) {
            const src = p.type === "image" ? p.imgEl : p.canvasEl;
            const drawH = Math.max(1, Math.round(p.baseCSSHeight * renderFactor));
            mctx.drawImage(src, 0, yPx, mergedPixelW, drawH);
            yPx += drawH;
          }

          pagesEl.innerHTML = "";
          thumbsEl.innerHTML = "";
          state.pages = [];
          state.activePage = 0;

          const mergedShell = createPageShell(baseCSSWidth, totalBaseCSSHeight);
          mergedCanvas.className = "content";
          mergedCanvas.style.width = "100%";
          mergedCanvas.style.height = "100%";
          mergedCanvas.style.display = "block";
          mergedShell.content.appendChild(mergedCanvas);

          state.pages.push({
            type: "pdf",
            baseCSSWidth,
            baseCSSHeight: totalBaseCSSHeight,
            pixelW: mergedPixelW,
            pixelH: mergedPixelH,
            node: mergedShell,
            imgEl: null,
            canvasEl: mergedCanvas,
          });
          makeThumb(0, mergedCanvas, baseCSSWidth, totalBaseCSSHeight);
          renderMergedPageBreakIndicators();
        }

        function renderMergedPageBreakIndicators() {
          if (!state.pages.length) return;
          const p = state.pages[0];
          const layer = ensurePageBreakLayer();
          if (!layer) return;
          layer.innerHTML = "";
          if (state.pages.length !== 1 || mergedPageTopOffsets.length <= 1) return;
          const rootBox = p.node.root.getBoundingClientRect();
          const pagesRect = pagesEl.getBoundingClientRect();
          const factor = rootBox.width / Math.max(1, p.baseCSSWidth);
          const rootTop = rootBox.top - pagesRect.top;
          const rootLeft = rootBox.left - pagesRect.left;
          const rootRight = rootLeft + rootBox.width;
          for (let i = 1; i < mergedPageTopOffsets.length; i++) {
            const y = rootTop + mergedPageTopOffsets[i] * factor;
            const left = document.createElement("div");
            left.className = "page-break-mark left";
            left.setAttribute("data-page-index", String(i));
            left.style.left = `${rootLeft - 22}px`;
            left.style.top = `${y}px`;
            const right = document.createElement("div");
            right.className = "page-break-mark right";
            right.setAttribute("data-page-index", String(i));
            right.style.left = `${rootRight + 10}px`;
            right.style.top = `${y}px`;
            const label = document.createElement("div");
            label.className = "page-break-label";
            label.setAttribute("data-page-index", String(i));
            label.textContent = `Page ${i + 1}`;
            label.style.left = `${rootRight + 28}px`;
            label.style.top = `${y}px`;
            layer.appendChild(left);
            layer.appendChild(right);
            layer.appendChild(label);
          }
        }

        function ensurePageBreakLayer() {
          if (pageBreakLayerEl && pageBreakLayerEl.isConnected) return pageBreakLayerEl;
          pageBreakLayerEl = document.createElement("div");
          pageBreakLayerEl.className = "page-break-layer";
          pageBreakLayerEl.addEventListener("click", (e) => {
            const target = e.target.closest(".page-break-mark, .page-break-label");
            if (!target) return;
            const idx = Number(target.getAttribute("data-page-index"));
            if (!Number.isFinite(idx)) return;
            scrollToPage(idx, true, "start");
          });
          pagesEl.appendChild(pageBreakLayerEl);
          return pageBreakLayerEl;
        }

        function resetCurrentDocument() {
          pagesEl.innerHTML = "";
          thumbsEl.innerHTML = "";
          state.pages = [];
          mergedPageTopOffsets = [];
          pageBreakLayerEl = null;
          state.activePage = 0;
          history.undo.length = 0;
          history.redo.length = 0;
          state.currentSelection = null;
          clearPolygonDraft();
        }

        function measuredCSSSize(maxWidth = 1040) {
          const container = pagesEl.getBoundingClientRect();
          const pad = 24;
          const w = Math.min(
            maxWidth,
            Math.max(320, Math.floor(container.width - pad))
          );
          return w;
        }

        async function loadImageFile(file) {
          return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.decoding = "async";
            img.draggable = false;

            img.onload = () => {
              const pixelW = img.naturalWidth;
              const pixelH = img.naturalHeight;
              const baseCSSWidth = measuredCSSSize();
              const ratio = pixelH / pixelW;
              const baseCSSHeight = Math.round(baseCSSWidth * ratio);

              const page = createPageShell(baseCSSWidth, baseCSSHeight);
              img.className = "content";
              page.content.appendChild(img);

              page.kind = "image";
              page.canvasRef = null;

              page.root.style.width = `${baseCSSWidth * state.zoom}px`;
              page.root.style.height = `${baseCSSHeight * state.zoom}px`;
              img.style.width = "100%";
              img.style.height = "100%";

              state.pages.push({
                type: "image",
                baseCSSWidth,
                baseCSSHeight,
                pixelW,
                pixelH,
                node: page,
                imgEl: img,
                canvasEl: null,
              });

              makeThumb(
                state.pages.length - 1,
                img,
                baseCSSWidth,
                baseCSSHeight
              );
              URL.revokeObjectURL(url);
              updateToolbar();
              resolve();
            };

            img.onerror = () => {
              URL.revokeObjectURL(url);
              reject(new Error(`Failed to load image: ${file.name}`));
            };

            img.src = url;
          });
        }

        async function loadPDF(file) {
          if (!window["pdfjsLib"]) {
            alert("pdf.js failed to load.");
            return;
          }
          const arrayBuffer = await file.arrayBuffer();
          const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            canvas.width = viewport.width;
            canvas.height = viewport.height;

            await page.render({ canvasContext: ctx, viewport }).promise;

            const ratio = canvas.height / canvas.width;
            const baseCSSWidth = measuredCSSSize();
            const baseCSSHeight = Math.round(baseCSSWidth * ratio);

            const shell = createPageShell(baseCSSWidth, baseCSSHeight);
            shell.content.appendChild(canvas);
            shell.kind = "pdf";
            const pageRec = {
              type: "pdf",
              baseCSSWidth,
              baseCSSHeight,
              pixelW: canvas.width,
              pixelH: canvas.height,
              node: shell,
              imgEl: null,
              canvasEl: canvas,
            };
            canvas.className = "content";
            shell.root.style.width = `${baseCSSWidth * state.zoom}px`;
            shell.root.style.height = `${baseCSSHeight * state.zoom}px`;

            state.pages.push(pageRec);
            makeThumb(
              state.pages.length - 1,
              canvas,
              baseCSSWidth,
              baseCSSHeight
            );
            updateToolbar();
          }
        }
        function insertAt(parent, node, index) {
          const ref = parent.children[index] || null;
          parent.insertBefore(node, ref);
        }

        function movePage(from, to) {
          if (from === to) return;
          // clamp target
          to = Math.max(0, Math.min(state.pages.length - 1, to));

          // 1) move state
          const [rec] = state.pages.splice(from, 1);
          state.pages.splice(to, 0, rec);

          // 2) move DOM: page node (always), thumb node (only if not already moved by dragover)
          insertAt(pagesEl, rec.node.root, to);

          // If we're in a drag-and-drop operation, the thumb has already been positioned by dragover.
          if (!draggedThumb) {
            const thumb = thumbsEl.children[from];
            insertAt(thumbsEl, thumb, to);
          }

          // 3) fix active index and UI
          if (state.activePage === from) state.activePage = to;
          else if (state.activePage > from && state.activePage <= to)
            state.activePage--;
          else if (state.activePage < from && state.activePage >= to)
            state.activePage++;

          updateActiveThumb();
          updateThumbMeta();
          updateToolbar();
        }

        function makeThumb(index, sourceEl, baseW, baseH) {
          const t = document.createElement("img");
          t.alt = `Page ${index + 1}`;
          t.title = `Go to page ${index + 1}`;
          t.src = toDataURL(sourceEl);
          t.draggable = true;
          if (index === 0) t.classList.add("active");

          // click to navigate
          t.addEventListener("click", () => {
            const idx = [...thumbsEl.children].indexOf(t);
            scrollToPage(idx);
          });

          // drag & drop - per-thumb only needs start/end
          t.addEventListener("dragstart", (e) => {
            draggedThumb = t;
            dragFromIndex = [...thumbsEl.children].indexOf(t); // compute from now
            t.classList.add("dragging");
            e.dataTransfer.effectAllowed = "move";
          });

          thumbsEl.addEventListener("drop", (e) => {
            if (dragFromIndex == null || !draggedThumb) return;
            e.preventDefault();
            const to = [...thumbsEl.children].indexOf(draggedThumb);
            if (to !== dragFromIndex) {
              movePage(dragFromIndex, to);
            }
            // cleanup (in case dragend doesn't fire in some browsers)
            draggedThumb.classList.remove("dragging");
            draggedThumb = null;
            dragFromIndex = null;
          });

          t.addEventListener("dragend", () => {
            t.classList.remove("dragging");
            draggedThumb = null;
            dragFromIndex = null;
          });

          thumbsEl.appendChild(t);

          function toDataURL(el) {
            if (el instanceof HTMLCanvasElement)
              return el.toDataURL("image/png");
            const c = document.createElement("canvas");
            const ratio = baseH / baseW;
            c.width = 240;
            c.height = Math.round(240 * ratio);
            const ctx = c.getContext("2d");
            ctx.drawImage(el, 0, 0, c.width, c.height);
            return c.toDataURL("image/png");
          }
        }
        // Single dragover/drop handlers for the strip
        thumbsEl.addEventListener("dragover", (e) => {
          if (!draggedThumb) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";

          // find insertion point by mouse X
          const children = [...thumbsEl.children].filter(
            (n) => n !== draggedThumb
          );
          const after = children.find((child) => {
            const r = child.getBoundingClientRect();
            return e.clientX < r.left + r.width / 2;
          });
          thumbsEl.insertBefore(draggedThumb, after || null);
        });

        thumbsEl.addEventListener("drop", (e) => {
          if (dragFromIndex == null || !draggedThumb) return;
          e.preventDefault();
          const to = [...thumbsEl.children].indexOf(draggedThumb);
          movePage(dragFromIndex, to);
        });

        function createPageShell(baseCSSWidth, baseCSSHeight) {
          const page = document.createElement("div");
          page.className = "page";
          page.style.width = `${baseCSSWidth * state.zoom}px`;
          page.style.height = `${baseCSSHeight * state.zoom}px`;

          const content = document.createElement("div");
          content.className = "content";
          content.style.width = "100%";
          content.style.height = "100%";
          content.style.position = "relative";

          const overlay = document.createElement("div");
          overlay.className = "overlay";
          const boxes = document.createElement("div");
          boxes.className = "boxes";
          const draw = document.createElement("div");
          draw.className = "draw-layer";
          const polyDraftSvg = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "svg"
          );
          polyDraftSvg.setAttribute("class", "poly-draft");
          polyDraftSvg.setAttribute("width", "100%");
          polyDraftSvg.setAttribute("height", "100%");
          draw.appendChild(polyDraftSvg);
          const cross = document.createElement("div");
          cross.className = "crosshair-layer";
          const vline = document.createElement("div");
          vline.className = "v";
          const hline = document.createElement("div");
          hline.className = "h";
          cross.appendChild(vline);
          cross.appendChild(hline);

          page.appendChild(content);
          page.appendChild(overlay);
          page.appendChild(boxes);
          page.appendChild(draw);
          page.appendChild(cross);
          pagesEl.appendChild(page);

          // crosshair behavior
          function onMove(ev) {
            if (!state.crosshair) return;
            const r = page.getBoundingClientRect();
            const x = ev.clientX - r.left;
            const y = ev.clientY - r.top;
            vline.style.left = Math.max(0, Math.min(r.width, x)) + "px";
            hline.style.top = Math.max(0, Math.min(r.height, y)) + "px";
            cross.style.display = "block";
          }
          page.addEventListener("mousemove", onMove);
          page.addEventListener("mouseenter", () => {
            cross.style.display = state.crosshair ? "block" : "none";
            setActiveFromNode(page);
          });
          page.addEventListener("mouseleave", () => {
            cross.style.display = "none";
            if (polygonDraft.pageNode === page) {
              polygonDraft.cursor = null;
              renderPolygonDraft();
            }
          });

          // ---------- drawing selections (on PAGE, not the draw-layer) ----------
          let dragCandidate = null; // {pageNode,x0,y0,moved}
          let rectGhost = null;
          page.addEventListener("mousedown", (e) => {
            if (e.button !== 0) return; // left only
            // do not start a draw if clicking an existing selection/label
            if (e.target.closest(".label")) return;
            const hitSelection = e.target.closest(".selection");
            if (hitSelection) {
              if (hitSelection.dataset.kind !== "polygon") return;
              if (e.target.closest(".poly-vertex")) return;
              if (isEventInsidePolygonSelection(e, hitSelection)) return;
            }

            const bounds = page.getBoundingClientRect();
            const pagesRect = pagesEl.getBoundingClientRect();
            const startPX = e.clientX - pagesRect.left;
            const startPY = e.clientY - pagesRect.top;
            dragCandidate = {
              pageNode: page,
              x0: e.clientX - bounds.left,
              y0: e.clientY - bounds.top,
              moved: false,
              startClientX: e.clientX,
              startClientY: e.clientY,
              lastClientX: e.clientX,
              lastClientY: e.clientY,
              startPageX: startPX,
              startPageY: startPY,
              startDoc: clientToDocCoord(e.clientX, e.clientY, page),
            };
            // prevent text/image selection while dragging
            document.body.style.userSelect = "none";
            e.preventDefault();
          });

          page.addEventListener("mousemove", (e) => {
            if (polygonDraft.pageNode === page) {
              const base = getPageRecordFromNode(page);
              const r = page.getBoundingClientRect();
              const factor = base.baseCSSWidth / r.width;
              polygonDraft.cursor = {
                x: clamp(e.clientX - r.left, 0, r.width) * factor,
                y: clamp(e.clientY - r.top, 0, r.height) * factor,
              };
              renderPolygonDraft();
            }
          });

          window.addEventListener("mousemove", (e) => {
            if (!dragCandidate) return;
            dragCandidate.lastClientX = e.clientX;
            dragCandidate.lastClientY = e.clientY;
            const pagesRect = pagesEl.getBoundingClientRect();
            const curPX = e.clientX - pagesRect.left;
            const curPY = e.clientY - pagesRect.top;
            const dx = curPX - dragCandidate.startPageX;
            const dy = curPY - dragCandidate.startPageY;
            const dist = Math.hypot(dx, dy);
            if (dist >= 4) {
              dragCandidate.moved = true;
            }
            if (dragCandidate.moved) {
              if (!rectGhost) {
                rectGhost = document.createElement("div");
                rectGhost.className = "ghost-global";
                pagesEl.appendChild(rectGhost);
              }
              const left = Math.min(dragCandidate.startPageX, curPX);
              const top = Math.min(dragCandidate.startPageY, curPY);
              const w = Math.abs(curPX - dragCandidate.startPageX);
              const h = Math.abs(curPY - dragCandidate.startPageY);
              rectGhost.style.left = `${left}px`;
              rectGhost.style.top = `${top}px`;
              rectGhost.style.width = `${w}px`;
              rectGhost.style.height = `${h}px`;
            }
          });

          window.addEventListener("mouseup", (e) => {
            if (!dragCandidate) return;
            const pageNode = dragCandidate.pageNode;
            document.body.style.userSelect = "";
            if (rectGhost) {
              pagesEl.removeChild(rectGhost);
              rectGhost = null;
            }
            const minSize = 6;
            const start =
              dragCandidate.startDoc ||
              clientToDocCoord(
                dragCandidate.startClientX,
                dragCandidate.startClientY,
                pageNode
              );
            const end = clientToDocCoord(e.clientX, e.clientY, pageNode);
            const spansMultiplePages =
              !!start && !!end && start.pageIndex !== end.pageIndex;
            let hasDocSize = false;
            if (start && end) {
              const p =
                state.pages[start.pageIndex] || state.pages[state.activePage] || null;
              const docW = p ? Math.abs(end.fx - start.fx) * p.baseCSSWidth : 0;
              const docH = Math.abs(end.docY - start.docY);
              hasDocSize = docW >= minSize && docH >= minSize;
            }
            if (start && end && (spansMultiplePages || hasDocSize)) {
              if (polygonDraft.pageNode === pageNode) {
                clearPolygonDraft();
              }
              const label = consumeLabel();
              const created = createRectSelectionsAcrossPages(start, end, label);
              if (created.length) {
                for (const c of created) {
                  pushAction({
                    type: "create",
                    pageIndex: c.pageIndex,
                    rect: { ...c.rect },
                    label,
                    id: c.id,
                    kind: "polygon",
                    points: c.points,
                  });
                }
                updateToolbar();
                announce(
                  created.length > 1
                    ? `Created ${created.length} linked selections ${label}`
                    : `Created selection ${label}`
                );
              }
            } else if (start) {
              const p = state.pages[start.pageIndex];
              const tops = getPageDocTopOffsets();
              const clickPt = {
                x: start.fx * p.baseCSSWidth,
                y: start.docY - tops[start.pageIndex],
              };
              handlePolygonClick(p.node.root, clickPt);
            }
            dragCandidate = null;
          });

          return {
            root: page,
            content,
            overlay,
            boxes,
            draw,
            cross,
            vline,
            hline,
            polyDraftSvg,
            kind: "image",
          };
        }

        function clearPolygonDraft() {
          polygonDraft.pageNode = null;
          polygonDraft.points = [];
          polygonDraft.cursor = null;
          renderPolygonDraft();
        }

        function renderPolygonDraft() {
          state.pages.forEach((p) => {
            if (p.node.polyDraftSvg) {
              p.node.polyDraftSvg.innerHTML = "";
              p.node.polyDraftSvg.style.display = "none";
            }
          });
          if (!polygonDraft.pageNode || !polygonDraft.points.length) return;
          const p = getPageRecordFromNode(polygonDraft.pageNode);
          if (!p || !p.node.polyDraftSvg) return;

          const svg = p.node.polyDraftSvg;
          svg.style.display = "block";
          const rootBox = p.node.root.getBoundingClientRect();
          const factor = rootBox.width / p.baseCSSWidth;
          const cssPoints = polygonDraft.points.map((pt) => ({
            x: pt.x * factor,
            y: pt.y * factor,
          }));

          const makeLine = (a, b, color = "#ffcc66", width = 1.5) =>
            `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${color}" stroke-width="${width}" stroke-dasharray="5 4" />`;
          let markup = "";
          const previewPts = cssPoints.slice();
          let previewCursor = polygonDraft.cursor;
          if (
            polygonDraft.cursor &&
            isNearFirstVertex(polygonDraft.cursor, polygonDraft.pageNode)
          ) {
            previewCursor = polygonDraft.points[0];
          }
          if (previewCursor) {
            previewPts.push({
              x: previewCursor.x * factor,
              y: previewCursor.y * factor,
            });
          }
          if (previewPts.length >= 3) {
            markup += `<polygon points="${previewPts
              .map((p) => `${p.x},${p.y}`)
              .join(" ")}" fill="rgba(122,162,255,0.18)" stroke="none" />`;
          }

          for (let i = 1; i < cssPoints.length; i++) {
            markup += makeLine(cssPoints[i - 1], cssPoints[i], "#7aa2ff", 1.8);
          }
          if (previewCursor) {
            const c = {
              x: previewCursor.x * factor,
              y: previewCursor.y * factor,
            };
            const first = cssPoints[0];
            const last = cssPoints[cssPoints.length - 1];
            markup += makeLine(first, c, "#ffcc66", 1.3);
            markup += makeLine(last, c, "#ffcc66", 1.3);
          }
          cssPoints.forEach((pt, idx) => {
            const r = idx === 0 ? 4.5 : 3.2;
            markup += `<circle cx="${pt.x}" cy="${pt.y}" r="${r}" fill="${
              idx === 0 ? "#66d9ef" : "#7aa2ff"
            }" />`;
          });
          svg.innerHTML = markup;
        }

        function polygonBoundingRect(points) {
          const xs = points.map((p) => p.x);
          const ys = points.map((p) => p.y);
          const minX = Math.min(...xs);
          const minY = Math.min(...ys);
          const maxX = Math.max(...xs);
          const maxY = Math.max(...ys);
          return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
        }

        function rectToPolygonPoints(rect) {
          return [
            { x: rect.x, y: rect.y },
            { x: rect.x + rect.w, y: rect.y },
            { x: rect.x + rect.w, y: rect.y + rect.h },
            { x: rect.x, y: rect.y + rect.h },
          ];
        }

        function isNearFirstVertex(clickPt, pageNode) {
          if (
            polygonDraft.pageNode !== pageNode ||
            polygonDraft.points.length < 3
          ) {
            return false;
          }
          const first = polygonDraft.points[0];
          const p = getPageRecordFromNode(pageNode);
          const rootBox = p.node.root.getBoundingClientRect();
          const factor = p.baseCSSWidth / rootBox.width;
          const threshold = 10 * factor;
          return Math.hypot(first.x - clickPt.x, first.y - clickPt.y) <= threshold;
        }

        function finalizePolygonDraft(pageNode = polygonDraft.pageNode) {
          if (!pageNode || polygonDraft.pageNode !== pageNode) return false;
          const pts = polygonDraft.points.slice();
          if (pts.length < 3) return false;

          const rect = polygonBoundingRect(pts);
          const label = consumeLabel();
          const base = getPageRecordFromNode(pageNode);
          const el = createSelection(base.node.boxes, rect, label, undefined, {
            kind: "polygon",
            points: pts,
          });
          pushAction({
            type: "create",
            pageIndex: getPageIndexFromNode(pageNode),
            rect: { ...rect },
            label,
            id: el.dataset.id,
            kind: "polygon",
            points: pts,
          });
          announce(`Created polygon selection ${label}`);
          clearPolygonDraft();
          updateToolbar();
          return true;
        }

        function handlePolygonClick(pageNode, clickPt) {
          if (polygonDraft.pageNode && polygonDraft.pageNode !== pageNode) {
            clearPolygonDraft();
          }
          if (!polygonDraft.pageNode) {
            polygonDraft.pageNode = pageNode;
            polygonDraft.points = [clickPt];
            polygonDraft.cursor = clickPt;
            renderPolygonDraft();
            return;
          }

          if (isNearFirstVertex(clickPt, pageNode)) {
            finalizePolygonDraft(pageNode);
            return;
          }

          polygonDraft.points.push(clickPt);
          polygonDraft.cursor = clickPt;
          renderPolygonDraft();
        }

        function getPageRecordFromNode(node) {
          return state.pages.find((p) => p.node.root === node);
        }
        function getPageIndexFromNode(node) {
          return state.pages.findIndex((p) => p.node.root === node);
        }
        function setActiveFromNode(node) {
          const idx = getPageIndexFromNode(node);
          if (idx >= 0) {
            state.activePage = idx;
            updateActiveThumb();
            updateToolbar();
          }
        }
        function updateActiveThumb() {
          [...thumbsEl.children].forEach((img, i) =>
            img.classList.toggle("active", i === state.activePage)
          );
        }

        function getPageDocTopOffsets() {
          let acc = 0;
          return state.pages.map((p) => {
            const top = acc;
            acc += p.baseCSSHeight;
            return top;
          });
        }

        function clientToDocCoord(clientX, clientY, fallbackPageNode) {
          if (!state.pages.length) return null;
          let pageIndex = -1;
          for (let i = 0; i < state.pages.length; i++) {
            const r = state.pages[i].node.root.getBoundingClientRect();
            if (clientY >= r.top && clientY <= r.bottom) {
              pageIndex = i;
              break;
            }
          }
          if (pageIndex < 0) {
            if (clientY < state.pages[0].node.root.getBoundingClientRect().top) {
              pageIndex = 0;
            } else if (
              clientY >
              state.pages[state.pages.length - 1].node.root.getBoundingClientRect()
                .bottom
            ) {
              pageIndex = state.pages.length - 1;
            } else if (fallbackPageNode) {
              pageIndex = getPageIndexFromNode(fallbackPageNode);
            }
          }
          if (pageIndex < 0) pageIndex = Math.max(0, state.activePage);
          const p = state.pages[pageIndex];
          const r = p.node.root.getBoundingClientRect();
          const fx = clamp((clientX - r.left) / Math.max(1, r.width), 0, 1);
          const fy = clamp((clientY - r.top) / Math.max(1, r.height), 0, 1);
          const tops = getPageDocTopOffsets();
          return {
            pageIndex,
            fx,
            docY: tops[pageIndex] + fy * p.baseCSSHeight,
          };
        }

        function createRectSelectionsAcrossPages(start, end, label) {
          const tops = getPageDocTopOffsets();
          const yMin = Math.min(start.docY, end.docY);
          const yMax = Math.max(start.docY, end.docY);
          const fxMin = Math.min(start.fx, end.fx);
          const fxMax = Math.max(start.fx, end.fx);
          const created = [];
          for (let i = 0; i < state.pages.length; i++) {
            const p = state.pages[i];
            const pTop = tops[i];
            const pBottom = pTop + p.baseCSSHeight;
            const oy0 = Math.max(yMin, pTop);
            const oy1 = Math.min(yMax, pBottom);
            const h = oy1 - oy0;
            const x = fxMin * p.baseCSSWidth;
            const w = (fxMax - fxMin) * p.baseCSSWidth;
            if (w < 6 || h < 6) continue;
            const rect = {
              x,
              y: oy0 - pTop,
              w,
              h,
            };
            const points = rectToPolygonPoints(rect);
            const el = createSelection(p.node.boxes, rect, label, undefined, {
              kind: "polygon",
              points,
            });
            created.push({ pageIndex: i, rect, id: el.dataset.id, points });
          }
          return created;
        }

        // ---------- Selections ----------
        function createSelection(container, rectNorm, label, reuseId, options = {}) {
          const page = getPageRecordFromNode(container.parentElement);
          const kind = options.kind === "polygon" ? "polygon" : "rect";
          const el = document.createElement("div");
          el.className = `selection${kind === "polygon" ? " polygon" : ""}`;
          el.tabIndex = 0;
          el.dataset.id = reuseId || String(state.boxIdCounter++);
          el.dataset.kind = kind;

          if (kind === "polygon") {
            const polySvg = document.createElementNS(
              "http://www.w3.org/2000/svg",
              "svg"
            );
            polySvg.setAttribute("class", "poly-svg");
            const polyShape = document.createElementNS(
              "http://www.w3.org/2000/svg",
              "polygon"
            );
            polyShape.setAttribute("class", "poly-shape");
            polySvg.appendChild(polyShape);
            el.appendChild(polySvg);
            el.dataset.points = JSON.stringify(
              Array.isArray(options.points) ? options.points : []
            );
          }
          const labelEl = document.createElement("div");
          labelEl.className = "label";
          labelEl.textContent = label;
          labelEl.title = "Double-click to edit. Press Enter or blur to save.";
          el.appendChild(labelEl);

          el.dataset.x = String(rectNorm.x);
          el.dataset.y = String(rectNorm.y);
          el.dataset.w = String(rectNorm.w);
          el.dataset.h = String(rectNorm.h);

          placeSelectionEl(el, page);

          // Interactions (drag/resize within page) + history capture
          let startRect = null;
          const pageIndex = getPageIndexFromNode(container.parentElement);

          const dragConfig = {
            ignoreFrom: ".poly-vertex, .label",
            listeners: {
              move(event) {
                const p = getPageRecordFromNode(container.parentElement);
                const factor =
                  p.baseCSSWidth / p.node.root.getBoundingClientRect().width;
                const dx = event.dx * factor;
                const dy = event.dy * factor;

                const oldX = parseFloat(el.dataset.x);
                const oldY = parseFloat(el.dataset.y);
                const x = clamp(
                  oldX + dx,
                  0,
                  p.baseCSSWidth - parseFloat(el.dataset.w)
                );
                const y = clamp(
                  oldY + dy,
                  0,
                  p.baseCSSHeight - parseFloat(el.dataset.h)
                );
                const realDx = x - oldX;
                const realDy = y - oldY;
                el.dataset.x = String(x);
                el.dataset.y = String(y);
                if (el.dataset.kind === "polygon") {
                  shiftPolygonPoints(el, realDx, realDy);
                }
                placeSelectionEl(el, p);
              },
            },
          };
          if (kind === "polygon") {
            dragConfig.allowFrom = ".poly-shape";
          }

          interact(el)
            .draggable(dragConfig)
            .on("dragstart", () => {
              startRect = getRect(el);
              if (el.dataset.kind === "polygon") {
                el.dataset.startPoints = el.dataset.points || "[]";
              }
            })
            .on("dragend", () => {
              const end = getRect(el);
              if (!rectEqual(startRect, end)) {
                const fromPoints =
                  el.dataset.kind === "polygon"
                    ? JSON.parse(el.dataset.startPoints || "[]")
                    : null;
                const toPoints =
                  el.dataset.kind === "polygon"
                    ? JSON.parse(el.dataset.points || "[]")
                    : null;
                pushAction({
                  type: "transform",
                  id: el.dataset.id,
                  pageIndex,
                  from: startRect,
                  to: end,
                  fromPoints,
                  toPoints,
                });
              }
              delete el.dataset.startPoints;
              startRect = null;
            });

          if (kind !== "polygon") {
            interact(el)
              .resizable({
                edges: { top: true, left: true, bottom: true, right: true },
              })
              .on("resizestart", () => {
                startRect = getRect(el);
              })
              .on("resizemove", (event) => {
                const p = getPageRecordFromNode(container.parentElement);
                const factor =
                  p.baseCSSWidth / p.node.root.getBoundingClientRect().width;
                const { deltaRect } = event;

                let x = parseFloat(el.dataset.x) + deltaRect.left * factor;
                let y = parseFloat(el.dataset.y) + deltaRect.top * factor;
                let w = parseFloat(el.dataset.w) + event.deltaRect.width * factor;
                let h =
                  parseFloat(el.dataset.h) + event.deltaRect.height * factor;

                x = clamp(x, 0, p.baseCSSWidth);
                y = clamp(y, 0, p.baseCSSHeight);
                w = Math.max(4, Math.min(w, p.baseCSSWidth - x));
                h = Math.max(4, Math.min(h, p.baseCSSHeight - y));

                el.dataset.x = String(x);
                el.dataset.y = String(y);
                el.dataset.w = String(w);
                el.dataset.h = String(h);

                placeSelectionEl(el, p);
              })
              .on("resizeend", () => {
                const end = getRect(el);
                if (!rectEqual(startRect, end)) {
                  pushAction({
                    type: "transform",
                    id: el.dataset.id,
                    pageIndex,
                    from: startRect,
                    to: end,
                  });
                }
                startRect = null;
              });
          }

          el.addEventListener("mousedown", (e) => {
            if (!e.shiftKey) {
              return;
            }
            if (
              el.dataset.kind === "polygon" &&
              !e.target.closest(".poly-vertex") &&
              !e.target.closest(".label")
            ) {
              if (!isEventInsidePolygonSelection(e, el)) return;
            }
            selectBox(el);
            if (maybeInsertVertexOnEdge(el, e)) {
              e.preventDefault();
              e.stopPropagation();
              return;
            }
            e.stopPropagation();
          });
          el.addEventListener("mousemove", (e) => {
            if (el.dataset.kind !== "polygon") return;
            if (!el.classList.contains("selected") || !!vertexDrag) {
              el.classList.remove("edge-insert-cue");
              return;
            }
            const canInsert = !!getEdgeInsertCandidate(el, e);
            el.classList.toggle("edge-insert-cue", canInsert);
          });
          el.addEventListener("mouseleave", () => {
            el.classList.remove("edge-insert-cue");
          });

          // label editing + history
          labelEl.addEventListener("mousedown", (e) => {
            e.stopPropagation();
          });
          labelEl.addEventListener("dblclick", (e) => {
            startRename(el);
            e.preventDefault();
            e.stopPropagation();
          });

          container.appendChild(el);
          return el;
        }

        function getRect(el) {
          return {
            x: parseFloat(el.dataset.x),
            y: parseFloat(el.dataset.y),
            w: parseFloat(el.dataset.w),
            h: parseFloat(el.dataset.h),
          };
        }
        function setRect(el, rect, pageRec) {
          el.dataset.x = String(rect.x);
          el.dataset.y = String(rect.y);
          el.dataset.w = String(rect.w);
          el.dataset.h = String(rect.h);
          placeSelectionEl(el, pageRec);
        }
        function rectEqual(a, b) {
          return (
            a && b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
          );
        }

        function clamp(v, minv, maxv) {
          return Math.max(minv, Math.min(maxv, v));
        }

        function placeSelectionEl(el, pageRec) {
          const rootBox = pageRec.node.root.getBoundingClientRect();
          const factor = rootBox.width / pageRec.baseCSSWidth;
          el.style.left = parseFloat(el.dataset.x) * factor + "px";
          el.style.top = parseFloat(el.dataset.y) * factor + "px";
          el.style.width = parseFloat(el.dataset.w) * factor + "px";
          el.style.height = parseFloat(el.dataset.h) * factor + "px";
          if (el.dataset.kind === "polygon") {
            updatePolygonVisual(el);
          }
        }

        function shiftPolygonPoints(el, dx, dy) {
          if (el.dataset.kind !== "polygon") return;
          const pts = JSON.parse(el.dataset.points || "[]");
          const shifted = pts.map((p) => ({ x: p.x + dx, y: p.y + dy }));
          el.dataset.points = JSON.stringify(shifted);
        }

        function setPolygonPoints(el, points, pageRec) {
          if (el.dataset.kind !== "polygon") return;
          el.dataset.points = JSON.stringify(points || []);
          const rect = polygonBoundingRect(points || []);
          setRect(el, rect, pageRec);
        }

        function updatePolygonVisual(el) {
          if (el.dataset.kind !== "polygon") return;
          const svg = el.querySelector(".poly-svg");
          const poly = el.querySelector(".poly-shape");
          if (!svg || !poly) return;
          const pts = JSON.parse(el.dataset.points || "[]");
          const x0 = parseFloat(el.dataset.x);
          const y0 = parseFloat(el.dataset.y);
          const w = Math.max(1, parseFloat(el.dataset.w));
          const h = Math.max(1, parseFloat(el.dataset.h));
          if (!pts.length) return;
          svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
          poly.setAttribute(
            "points",
            pts.map((p) => `${p.x - x0},${p.y - y0}`).join(" ")
          );

          el.querySelectorAll(".poly-vertex").forEach((n) => n.remove());
          if (!el.classList.contains("selected")) return;
          pts.forEach((p, idx) => {
            const v = document.createElement("div");
            v.className = "poly-vertex";
            v.dataset.vidx = String(idx);
            v.style.left = `${((p.x - x0) / w) * 100}%`;
            v.style.top = `${((p.y - y0) / h) * 100}%`;
            v.addEventListener("pointerdown", startVertexDrag);
            el.appendChild(v);
          });
        }

        function pointsEqual(a, b) {
          if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
            return false;
          }
          for (let i = 0; i < a.length; i++) {
            if (a[i].x !== b[i].x || a[i].y !== b[i].y) return false;
          }
          return true;
        }

        function isPointOnSegment(point, a, b, eps = 1e-6) {
          const cross =
            (point.y - a.y) * (b.x - a.x) - (point.x - a.x) * (b.y - a.y);
          if (Math.abs(cross) > eps) return false;
          const dot =
            (point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y);
          if (dot < -eps) return false;
          const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
          return dot <= len2 + eps;
        }

        function pointInPolygonInclusive(point, points) {
          if (!Array.isArray(points) || points.length < 3) return false;
          for (let i = 0; i < points.length; i++) {
            const a = points[i];
            const b = points[(i + 1) % points.length];
            if (isPointOnSegment(point, a, b)) return true;
          }
          let inside = false;
          for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
            const xi = points[i].x;
            const yi = points[i].y;
            const xj = points[j].x;
            const yj = points[j].y;
            const intersects =
              yi > point.y !== yj > point.y &&
              point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
            if (intersects) inside = !inside;
          }
          return inside;
        }

        function eventPointInPageSpace(e, pageRec) {
          const r = pageRec.node.root.getBoundingClientRect();
          const fx = pageRec.baseCSSWidth / Math.max(1, r.width);
          return {
            x: clamp((e.clientX - r.left) * fx, 0, pageRec.baseCSSWidth),
            y: clamp((e.clientY - r.top) * fx, 0, pageRec.baseCSSHeight),
          };
        }

        function isEventInsidePolygonSelection(e, sel) {
          if (!sel || sel.dataset.kind !== "polygon") return false;
          const pageNode = sel.closest(".page");
          const pageRec = getPageRecordFromNode(pageNode);
          if (!pageRec) return false;
          const point = eventPointInPageSpace(e, pageRec);
          const pts = JSON.parse(sel.dataset.points || "[]");
          return pointInPolygonInclusive(point, pts);
        }

        function isPointBlockedByOtherPolygon(pageNode, point, excludeSel = null) {
          const polygons = pageNode.querySelectorAll(
            '.selection[data-kind="polygon"]'
          );
          for (const poly of polygons) {
            if (excludeSel && poly === excludeSel) continue;
            const pts = JSON.parse(poly.dataset.points || "[]");
            if (pointInPolygonInclusive(point, pts)) {
              return true;
            }
          }
          return false;
        }

        function distancePointToSegment(point, a, b) {
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len2 = dx * dx + dy * dy;
          if (len2 <= 1e-9) {
            const dpx = point.x - a.x;
            const dpy = point.y - a.y;
            return { dist: Math.hypot(dpx, dpy), proj: { x: a.x, y: a.y } };
          }
          let t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2;
          t = clamp(t, 0, 1);
          const proj = { x: a.x + t * dx, y: a.y + t * dy };
          return {
            dist: Math.hypot(point.x - proj.x, point.y - proj.y),
            proj,
          };
        }

        function beginVertexDrag(sel, idx, pageNode, startRect, startPoints) {
          const pageRec = getPageRecordFromNode(pageNode);
          if (!pageRec) return;
          vertexDrag = {
            sel,
            idx,
            pageRec,
            pageIndex: getPageIndexFromNode(pageNode),
            startRect,
            startPoints,
            pointerId: null,
          };
        }

        function getEdgeInsertCandidate(sel, e) {
          if (sel.dataset.kind !== "polygon") return null;
          if (!sel.classList.contains("selected")) return null;
          if (e.target.closest(".poly-vertex") || e.target.closest(".label")) {
            return null;
          }
          const pageNode = sel.closest(".page");
          const pageRec = getPageRecordFromNode(pageNode);
          if (!pageRec) return null;
          const oldPoints = JSON.parse(sel.dataset.points || "[]");
          if (oldPoints.length < 3) return null;
          const rootRect = pageRec.node.root.getBoundingClientRect();
          const factor = pageRec.baseCSSWidth / Math.max(1, rootRect.width);
          const clickPt = {
            x: clamp((e.clientX - rootRect.left) * factor, 0, pageRec.baseCSSWidth),
            y: clamp((e.clientY - rootRect.top) * factor, 0, pageRec.baseCSSHeight),
          };
          const hitThreshold = 8 * factor;

          for (const p of oldPoints) {
            if (Math.hypot(p.x - clickPt.x, p.y - clickPt.y) <= hitThreshold) {
              return null;
            }
          }

          let best = null;
          for (let i = 0; i < oldPoints.length; i++) {
            const a = oldPoints[i];
            const b = oldPoints[(i + 1) % oldPoints.length];
            const seg = distancePointToSegment(clickPt, a, b);
            if (!best || seg.dist < best.dist) {
              best = { dist: seg.dist, proj: seg.proj, edgeIndex: i };
            }
          }
          if (!best || best.dist > hitThreshold) return null;

          return {
            pageNode,
            pageRec,
            oldPoints,
            insertIndex: best.edgeIndex + 1,
            insertPoint: best.proj,
          };
        }

        function maybeInsertVertexOnEdge(sel, e) {
          const hit = getEdgeInsertCandidate(sel, e);
          if (!hit) return false;

          const startRect = getRect(sel);
          const newPoints = hit.oldPoints.slice();
          newPoints.splice(hit.insertIndex, 0, hit.insertPoint);
          setPolygonPoints(sel, newPoints, hit.pageRec);
          updatePolygonVisual(sel);
          beginVertexDrag(
            sel,
            hit.insertIndex,
            hit.pageNode,
            startRect,
            hit.oldPoints
          );
          return true;
        }

        function startVertexDrag(e) {
          if (e.pointerType && e.pointerType !== "mouse" && e.pointerType !== "pen") {
            return;
          }
          const handle = e.currentTarget;
          const sel = handle.closest(".selection");
          if (!sel || sel.dataset.kind !== "polygon") return;
          const idx = Number(handle.dataset.vidx);
          if (!Number.isFinite(idx)) return;
          const pageNode = sel.closest(".page");
          const startPoints = JSON.parse(sel.dataset.points || "[]");
          beginVertexDrag(sel, idx, pageNode, getRect(sel), startPoints);
          if (vertexDrag && Number.isFinite(e.pointerId)) {
            vertexDrag.pointerId = e.pointerId;
            if (handle.setPointerCapture) {
              handle.setPointerCapture(e.pointerId);
            }
          }
          e.preventDefault();
          e.stopPropagation();
        }

        window.addEventListener("pointermove", (e) => {
          if (!vertexDrag) return;
          if (
            Number.isFinite(vertexDrag.pointerId) &&
            Number.isFinite(e.pointerId) &&
            e.pointerId !== vertexDrag.pointerId
          ) {
            return;
          }
          const { sel, idx, pageRec } = vertexDrag;
          const r = pageRec.node.root.getBoundingClientRect();
          const fx = pageRec.baseCSSWidth / Math.max(1, r.width);
          const x = clamp((e.clientX - r.left) * fx, 0, pageRec.baseCSSWidth);
          const y = clamp((e.clientY - r.top) * fx, 0, pageRec.baseCSSHeight);
          const pts = JSON.parse(sel.dataset.points || "[]");
          if (!pts[idx]) return;
          pts[idx] = { x, y };
          setPolygonPoints(sel, pts, pageRec);
          updatePolygonVisual(sel);
        });

        window.addEventListener("pointerup", (e) => {
          if (!vertexDrag) return;
          if (
            Number.isFinite(vertexDrag.pointerId) &&
            Number.isFinite(e.pointerId) &&
            e.pointerId !== vertexDrag.pointerId
          ) {
            return;
          }
          const { sel, pageRec, pageIndex, startRect, startPoints } = vertexDrag;
          const endRect = getRect(sel);
          const endPoints = JSON.parse(sel.dataset.points || "[]");
          if (
            !rectEqual(startRect, endRect) ||
            !pointsEqual(startPoints, endPoints)
          ) {
            pushAction({
              type: "transform",
              id: sel.dataset.id,
              pageIndex,
              from: startRect,
              to: endRect,
              fromPoints: startPoints,
              toPoints: endPoints,
            });
          }
          updatePolygonVisual(sel);
          sel.classList.remove("edge-insert-cue");
          vertexDrag = null;
        });

        function startRename(el) {
          const tag = el.querySelector(".label");
          const before = tag.textContent;
          tag.setAttribute("contenteditable", "true");
          tag.focus();
          document.execCommand &&
            document.execCommand("selectAll", false, null);

          const finish = () => {
            tag.removeAttribute("contenteditable");
            const sanitized =
              sanitizeLabel(tag.textContent.trim()) || "untitled";
            if (sanitized !== before) {
              tag.textContent = sanitized;
              pushAction({
                type: "rename",
                id: el.dataset.id,
                from: before,
                to: sanitized,
              });
            } else {
              tag.textContent = sanitized;
            }
          };
          const onKey = (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              finish();
              tag.removeEventListener("keydown", onKey);
            }
            if (e.key === "Escape") {
              e.preventDefault();
              tag.textContent = before;
              tag.removeEventListener("keydown", onKey);
              tag.blur();
            }
          };
          tag.addEventListener("keydown", onKey);
          tag.addEventListener(
            "blur",
            () => {
              tag.removeEventListener("keydown", onKey);
              finish();
            },
            { once: true }
          );
        }

        function sanitizeLabel(str) {
          return str
            .replace(/[\\\/:*?"<>|\u0000-\u001f]+/g, "")
            .replace(/\s+/g, "_")
            .slice(0, 120);
        }

        function selectBox(el) {
          document
            .querySelectorAll(".selection.edge-insert-cue")
            .forEach((n) => n.classList.remove("edge-insert-cue"));
          document
            .querySelectorAll(".selection.selected")
            .forEach((n) => n.classList.remove("selected"));
          if (el.parentElement) {
            el.parentElement.appendChild(el);
          }
          el.classList.add("selected");
          state.currentSelection = el;
          document
            .querySelectorAll('.selection[data-kind="polygon"]')
            .forEach((n) => updatePolygonVisual(n));
        }

        function getAllSelections() {
          const out = [];
          state.pages.forEach((p, idx) => {
            const nodes = [...p.node.boxes.querySelectorAll(".selection")];
            for (const n of nodes) {
              out.push({ pageIndex: idx, node: n });
            }
          });
          return out;
        }

        function findSelectionById(id) {
          return document.querySelector(
            `.selection[data-id="${CSS.escape(id)}"]`
          );
        }

        // ---------- Zoom & Paging ----------
        function applyZoom() {
          state.pages.forEach((p) => {
            p.node.root.style.width = `${p.baseCSSWidth * state.zoom}px`;
            p.node.root.style.height = `${p.baseCSSHeight * state.zoom}px`;
            p.node.boxes
              .querySelectorAll(".selection")
              .forEach((el) => placeSelectionEl(el, p));
          });
          renderMergedPageBreakIndicators();
          updateToolbar();
        }
        function setZoomKeepingViewport(nextZoom) {
          if (!state.pages.length) return;
          const vr = viewerEl.getBoundingClientRect();
          const centerX = viewerEl.scrollLeft + vr.width / 2;
          const centerY = viewerEl.scrollTop + vr.height / 2;
          const rw = Math.max(1, pagesEl.scrollWidth);
          const rh = Math.max(1, pagesEl.scrollHeight);
          const rx = centerX / rw;
          const ry = centerY / rh;
          state.zoom = Math.max(0.1, Math.min(8, nextZoom));
          if (zoomSlider) zoomSlider.value = Math.round(state.zoom * 100);
          applyZoom();
          viewerEl.scrollLeft = rx * pagesEl.scrollWidth - vr.width / 2;
          viewerEl.scrollTop = ry * pagesEl.scrollHeight - vr.height / 2;
        }
        function zoomToFitWidth() {
          if (!state.pages.length) return;
          const w = measuredCSSSize();
          const base = state.pages[0].baseCSSWidth;
          state.zoom = w / base;
          if (zoomSlider) zoomSlider.value = Math.round(state.zoom * 100);
          applyZoom();
        }

        function scrollToPage(index, smooth = true, block = "center") {
          const logicalCount = getLogicalPageCount();
          if (!logicalCount) return;
          index = clamp(index, 0, logicalCount - 1);
          state.activePage = index;
          updateActiveThumb();
          const mergedMode =
            state.pages.length === 1 && mergedPageTopOffsets.length === logicalCount;
          if (mergedMode) {
            const p = state.pages[0];
            const root = p.node.root;
            const factor =
              root.getBoundingClientRect().width / Math.max(1, p.baseCSSWidth);
            const yWithinRoot = (mergedPageTopOffsets[index] || 0) * factor;
            const targetTop = root.offsetTop + yWithinRoot;
            let scrollTop = targetTop;
            if (block === "center") scrollTop = targetTop - viewerEl.clientHeight / 2;
            if (block === "end") scrollTop = targetTop - viewerEl.clientHeight;
            viewerEl.scrollTo({
              top: Math.max(0, scrollTop),
              behavior: smooth ? "smooth" : "auto",
            });
          } else {
            const node = state.pages[index].node.root;
            node.scrollIntoView({
              behavior: smooth ? "smooth" : "auto",
              block,
            });
          }
          updateToolbar();
        }

        if (zoomSlider) {
          zoomSlider.addEventListener("input", (e) => {
            setZoomKeepingViewport(parseInt(e.target.value, 10) / 100);
          });
        }
        zoomInBtn.addEventListener("click", () => {
          setZoomKeepingViewport(state.zoom + 0.1);
        });
        zoomOutBtn.addEventListener("click", () => {
          setZoomKeepingViewport(state.zoom - 0.1);
        });
        zoomResetBtn.addEventListener("click", () => {
          setZoomKeepingViewport(1);
        });
        pToggleBtn.addEventListener("click", () => {
          state.pMode = !state.pMode;
          updateToolbar();
          scheduleSessionSave();
          announce(`Passage Select ${state.pMode ? "ON" : "OFF"}`);
        });
        viewerEl.addEventListener(
          "wheel",
          (e) => {
            if (!e.ctrlKey) return;
            e.preventDefault();
            const step = e.deltaY < 0 ? 0.12 : -0.12;
            setZoomKeepingViewport(state.zoom + step);
          },
          { passive: false }
        );

        // ---------- Export ----------
        exportBtn.addEventListener("click", exportZip);

        const nextPaint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

        async function exportZip() {
          const selections = getAllSelections();
          if (!selections.length) {
            alert("No selections to export.");
            return;
          }
          await exportSelectionsAsZip(selections, "selections.zip");
        }

        async function exportSelectionsAsZip(selections, zipFileName) {
          if (!window.JSZip) {
            alert("JSZip failed to load.");
            return;
          }
          setExportLoading(
            true,
            `Exporting 0/${selections.length} selection${
              selections.length === 1 ? "" : "s"
            }...`
          );
            await nextPaint();
          try {
            const zip = new JSZip();
            const seen = new Set();
            const exportScale = Math.max(
              1,
              Math.min(4, parseFloat(exportScaleEl?.value || "2"))
            );

            for (let idx = 0; idx < selections.length; idx++) {
              const { pageIndex, node } = selections[idx];
              const p = state.pages[pageIndex];
              const labelRaw =
                node.querySelector(".label").textContent.trim() || "untitled";
              const baseName = sanitizeLabel(labelRaw) || "untitled";
              const name = uniqueName(baseName, seen) + ".png";

              const rectNorm = {
                x: parseFloat(node.dataset.x),
                y: parseFloat(node.dataset.y),
                w: parseFloat(node.dataset.w),
                h: parseFloat(node.dataset.h),
              };

              const factor =
                p.type === "image"
                  ? p.pixelW / p.baseCSSWidth
                  : p.canvasEl.width / p.baseCSSWidth;

              const sx = Math.round(rectNorm.x * factor);
              const sy = Math.round(rectNorm.y * factor);
              const sw = Math.round(rectNorm.w * factor);
              const sh = Math.round(rectNorm.h * factor);

              const out = document.createElement("canvas");
              out.width = Math.max(1, Math.round(sw * exportScale));
              out.height = Math.max(1, Math.round(sh * exportScale));
              const ctx = out.getContext("2d");
              ctx.imageSmoothingEnabled = true;
              ctx.imageSmoothingQuality = "high";
              const drawSource = () => {
                if (p.type === "image") {
                  ctx.drawImage(
                    p.imgEl,
                    sx,
                    sy,
                    sw,
                    sh,
                    0,
                    0,
                    out.width,
                    out.height
                  );
                } else {
                  ctx.drawImage(
                    p.canvasEl,
                    sx,
                    sy,
                    sw,
                    sh,
                    0,
                    0,
                    out.width,
                    out.height
                  );
                }
              };
              if (node.dataset.kind === "polygon") {
                const pts = JSON.parse(node.dataset.points || "[]");
                const pixelPts = pts.map((pt) => ({
                  x: pt.x * factor,
                  y: pt.y * factor,
                }));
                ctx.fillStyle = "#ffffff";
                ctx.fillRect(0, 0, out.width, out.height);
                ctx.save();
                if (pixelPts.length >= 3) {
                  ctx.beginPath();
                  ctx.moveTo(
                    (pixelPts[0].x - sx) * exportScale,
                    (pixelPts[0].y - sy) * exportScale
                  );
                  for (let i = 1; i < pixelPts.length; i++) {
                    ctx.lineTo(
                      (pixelPts[i].x - sx) * exportScale,
                      (pixelPts[i].y - sy) * exportScale
                    );
                  }
                  ctx.closePath();
                  ctx.clip();
                }
                drawSource();
                ctx.restore();
              } else {
                drawSource();
              }

              const blob = await new Promise((res) =>
                out.toBlob(res, "image/png")
              );
              zip.file(name, blob);
              setExportLoading(
                true,
                `Exporting ${idx + 1}/${selections.length} selection${
                  selections.length === 1 ? "" : "s"
                }...`
              );
              await new Promise((r) => requestAnimationFrame(r));
            }

            setExportLoading(true, "Building ZIP...");
            await nextPaint();
            const blob = await zip.generateAsync({ type: "blob" });

            if (!currentDocId) {
              alert("No document loaded (currentDocId is missing).");
              return;
            }

            const url = apiUrl(
              `/api/snip-docs/export?doc=${encodeURIComponent(currentDocId)}`
            );

            const res = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/zip" },
              body: blob,
            });

            if (!res.ok) {
              const err = await res.text();
              alert("Export failed: " + err);
            } else {
              const payload = await res.json();
              console.log("Exported to:", payload.exportedTo);
              tryCloseWindowAfterExport();
            }
          } finally {
            setExportLoading(false);
          }
        }

        function uniqueName(base, seen) {
          let name = base;
          let i = 1;
          while (seen.has(name)) {
            name = `${base}-${i++}`;
          }
          seen.add(name);
          return name;
        }

        // ---------- Undo / Redo ----------
        undoBtn.addEventListener("click", undo);
        redoBtn.addEventListener("click", redo);

        function undo() {
          const action = history.undo.pop();
          if (!action) return;

          switch (action.type) {
            case "create": {
              const sel = findSelectionById(action.id);
              if (sel) sel.remove();
              break;
            }
            case "delete": {
              const p = state.pages[action.pageIndex];
              const isPolygon = action.kind === "polygon";
              const el = createSelection(
                p.node.boxes,
                action.rect,
                action.label,
                action.id,
                {
                  kind: "polygon",
                  points: isPolygon
                    ? action.points || []
                    : rectToPolygonPoints(action.rect),
                }
              );
              break;
            }
            case "transform": {
              const sel = findSelectionById(action.id);
              if (sel) {
                const pageRec = state.pages[action.pageIndex];
                setRect(sel, action.from, pageRec);
                if (
                  sel.dataset.kind === "polygon" &&
                  Array.isArray(action.fromPoints)
                ) {
                  setPolygonPoints(sel, action.fromPoints, pageRec);
                }
              }
              break;
            }
            case "rename": {
              const sel = findSelectionById(action.id);
              if (sel) {
                sel.querySelector(".label").textContent = action.from;
              }
              break;
            }
          }
          history.redo.push(action);
          updateHistoryUI();
          scheduleSessionSave();
        }

        async function loadImageFromUrl(url) {
          return new Promise((resolve, reject) => {
            const img = new Image();
            img.decoding = "async";
            img.draggable = false;
            img.crossOrigin = "anonymous";

            img.onload = () => {
              const pixelW = img.naturalWidth;
              const pixelH = img.naturalHeight;
              const baseCSSWidth = measuredCSSSize();
              const ratio = pixelH / pixelW;
              const baseCSSHeight = Math.round(baseCSSWidth * ratio);

              const page = createPageShell(baseCSSWidth, baseCSSHeight);
              img.className = "content";
              page.content.appendChild(img);

              page.kind = "image";
              page.canvasRef = null;

              page.root.style.width = `${baseCSSWidth * state.zoom}px`;
              page.root.style.height = `${baseCSSHeight * state.zoom}px`;
              img.style.width = "100%";
              img.style.height = "100%";

              state.pages.push({
                type: "image",
                baseCSSWidth,
                baseCSSHeight,
                pixelW,
                pixelH,
                node: page,
                imgEl: img,
                canvasEl: null,
              });

              makeThumb(
                state.pages.length - 1,
                img,
                baseCSSWidth,
                baseCSSHeight
              );
              updateToolbar();
              resolve();
            };

            img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
            img.src = url;
          });
        }

        function redo() {
          const action = history.redo.pop();
          if (!action) return;

          switch (action.type) {
            case "create": {
              const p = state.pages[action.pageIndex];
              const isPolygon = action.kind === "polygon";
              const el = createSelection(
                p.node.boxes,
                action.rect,
                action.label,
                action.id,
                {
                  kind: "polygon",
                  points: isPolygon
                    ? action.points || []
                    : rectToPolygonPoints(action.rect),
                }
              );
              break;
            }
            case "delete": {
              const sel = findSelectionById(action.id);
              if (sel) sel.remove();
              break;
            }
            case "transform": {
              const sel = findSelectionById(action.id);
              if (sel) {
                const pageRec = state.pages[action.pageIndex];
                setRect(sel, action.to, pageRec);
                if (
                  sel.dataset.kind === "polygon" &&
                  Array.isArray(action.toPoints)
                ) {
                  setPolygonPoints(sel, action.toPoints, pageRec);
                }
              }
              break;
            }
            case "rename": {
              const sel = findSelectionById(action.id);
              if (sel) {
                sel.querySelector(".label").textContent = action.to;
              }
              break;
            }
          }
          history.undo.push(action);
          updateHistoryUI();
          scheduleSessionSave();
        }

        // ---------- Keyboard shortcuts ----------
        window.addEventListener("keydown", (e) => {
          // Editing labels?
          const ae = document.activeElement;
          const isEditing =
            ae &&
            ae.getAttribute &&
            ae.getAttribute("contenteditable") === "true";
          if (isEditing) {
            if (e.key === "Escape") {
              ae.blur();
            }
            return;
          }

          // Undo / Redo
          if (
            (e.ctrlKey || e.metaKey) &&
            !e.shiftKey &&
            e.key.toLowerCase() === "z"
          ) {
            e.preventDefault();
            undo();
            return;
          }
          if (
            (e.ctrlKey || e.metaKey) &&
            ((e.shiftKey && e.key.toLowerCase() === "z") ||
              e.key.toLowerCase() === "y")
          ) {
            e.preventDefault();
            redo();
            return;
          }

          // Export
          if (e.key.toLowerCase() === "e") {
            e.preventDefault();
            exportZip();
          }
          // Zoom
          else if (e.key === "+" || e.key === "=") {
            e.preventDefault();
            zoomInBtn.click();
          } else if (e.key === "-" || e.key === "_") {
            e.preventDefault();
            zoomOutBtn.click();
          } else if (e.key === "0") {
            e.preventDefault();
            zoomResetBtn.click();
          }
          // Paging
          else if (e.key.toLowerCase() === "j" || e.key === "PageDown") {
            e.preventDefault();
            scrollToPage(state.activePage + 1);
          } else if (e.key.toLowerCase() === "k" || e.key === "PageUp") {
            e.preventDefault();
            scrollToPage(state.activePage - 1);
          }
          // Passage Select toggle
          else if (e.key.toLowerCase() === "p") {
            e.preventDefault();
            state.pMode = !state.pMode;
            updateToolbar();
            scheduleSessionSave();
            announce(`Passage Select ${state.pMode ? "ON" : "OFF"}`);
          }
          // Label adjust A/D
          else if (e.key.toLowerCase() === "a") {
            e.preventDefault();
            if (state.pMode) {
              state.passageCounter = Math.max(1, state.passageCounter - 1);
            } else {
              state.normalCounter = Math.max(1, state.normalCounter - 1);
            }
            updateToolbar();
            scheduleSessionSave();
          } else if (e.key.toLowerCase() === "d") {
            e.preventDefault();
            if (state.pMode) {
              state.passageCounter = Math.max(1, state.passageCounter + 1);
            } else {
              state.normalCounter = Math.max(1, state.normalCounter + 1);
            }
            updateToolbar();
            scheduleSessionSave();
          }
          // Help
          else if (e.key === "?") {
            e.preventDefault();
            toggleHelp();
          }
          // Close polygon draft
          else if (e.key === "Enter") {
            if (polygonDraft.pageNode && polygonDraft.points.length >= 3) {
              e.preventDefault();
              finalizePolygonDraft(polygonDraft.pageNode);
            }
          }
          // Cancel polygon draft
          else if (e.key === "Escape") {
            clearPolygonDraft();
          }
          // Rename selected
          else if (e.key.toLowerCase() === "r") {
            e.preventDefault();
            if (state.currentSelection) startRename(state.currentSelection);
          }
          // Delete selected
          else if (e.key === "Delete" || e.key === "Backspace") {
            if (state.currentSelection) {
              e.preventDefault();
              const sel = state.currentSelection;
              const pageIndex = getPageIndexFromNode(sel.closest(".page"));
              pushAction({
                type: "delete",
                pageIndex,
                rect: getRect(sel),
                label: sel.querySelector(".label").textContent,
                id: sel.dataset.id,
                kind: sel.dataset.kind || "rect",
                points:
                  sel.dataset.kind === "polygon"
                    ? JSON.parse(sel.dataset.points || "[]")
                    : null,
              });
              sel.remove();
              state.currentSelection = null;
              updateToolbar();
            }
          }
          // Nudge arrow keys
          else if (
            ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
          ) {
            if (!state.currentSelection) return;
            e.preventDefault();
            const p = getPageRecordFromNode(
              state.currentSelection.closest(".page")
            );
            const before = getRect(state.currentSelection);
            const step = e.shiftKey ? 10 : 1;
            const dx =
              e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
            const dy =
              e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
            let x = before.x + dx;
            let y = before.y + dy;
            let w = before.w;
            let h = before.h;
            x = clamp(x, 0, p.baseCSSWidth - w);
            y = clamp(y, 0, p.baseCSSHeight - h);
            const after = { x, y, w, h };
            const beforePoints =
              state.currentSelection.dataset.kind === "polygon"
                ? JSON.parse(state.currentSelection.dataset.points || "[]")
                : null;
            setRect(state.currentSelection, after, p);
            if (state.currentSelection.dataset.kind === "polygon") {
              shiftPolygonPoints(state.currentSelection, x - before.x, y - before.y);
              updatePolygonVisual(state.currentSelection);
            }
            if (!rectEqual(before, after)) {
              const toPoints =
                state.currentSelection.dataset.kind === "polygon"
                  ? JSON.parse(state.currentSelection.dataset.points || "[]")
                  : null;
              pushAction({
                type: "transform",
                id: state.currentSelection.dataset.id,
                pageIndex: getPageIndexFromNode(p.node.root),
                from: before,
                to: after,
                fromPoints: beforePoints,
                toPoints,
              });
            }
          }
        });

        // Click page background to clear selection
        pagesEl.addEventListener("mousedown", (e) => {
          if (!(e.target.closest && e.target.closest(".selection"))) {
            document
              .querySelectorAll(".selection.selected")
              .forEach((n) => n.classList.remove("selected"));
            state.currentSelection = null;
            document
              .querySelectorAll('.selection[data-kind="polygon"]')
              .forEach((n) => updatePolygonVisual(n));
          }
        });

        // ---------- Help panel ----------
        helpBtn.addEventListener("click", toggleHelp);
        function toggleHelp() {
          helpPanel.style.display =
            helpPanel.style.display === "block" ? "none" : "block";
        }
        function computeSessionKey(files) {
          const signature = files
            .map((f) => `${f.name}|${f.size}|${f.lastModified}|${f.type}`)
            .sort()
            .join("||");
          return `set:${hashString(signature)}`;
        }

        function hashString(input) {
          let hash = 5381;
          for (let i = 0; i < input.length; i++) {
            hash = (hash * 33) ^ input.charCodeAt(i);
          }
          return (hash >>> 0).toString(36);
        }

        function scheduleSessionSave() {
          if (!currentSessionKey || !state.pages.length || isRestoringSession) {
            return;
          }
          setSaveStatus("saving", currentDocId ? "Saving..." : "Saving local...");
          clearTimeout(saveTimer);
          saveTimer = setTimeout(saveSession, 250);
          if (currentDocId) {
            queueServerSessionSave(buildSessionSnapshot(), currentDocId);
          }
        }

        function queueServerSessionSave(snapshot = null, docId = currentDocId) {
          if (!docId || !state.pages.length || isRestoringSession) return;
          const nextSnapshot = snapshot || buildSessionSnapshot();
          pendingServerSaves.set(docId, nextSnapshot);
          if (serverSaveInFlight) return;
          void flushServerSessionSaves();
        }

        async function flushServerSessionSaves() {
          if (serverSaveInFlight) return;
          serverSaveInFlight = true;
          setSaveStatus("saving", "Saving...");
          try {
            while (pendingServerSaves.size) {
              const queued = Array.from(pendingServerSaves.entries());
              pendingServerSaves.clear();
              for (const [docId, snapshot] of queued) {
                try {
                  await saveServerSession(docId, snapshot);
                } catch (err) {
                  pendingServerSaves.set(docId, snapshot);
                  throw err;
                }
              }
            }
            setSaveStatusSavedSoon("Saved");
          } catch (err) {
            console.warn("Server session flush failed:", err);
            setSaveStatus("error", "Save failed");
          } finally {
            serverSaveInFlight = false;
            if (pendingServerSaves.size) {
              void flushServerSessionSaves();
            }
          }
        }

        function buildSessionSnapshot() {
          const selections = getAllSelections().map(({ pageIndex, node }) => ({
            pageIndex,
            rect: getRect(node),
            label: node.querySelector(".label").textContent.trim() || "untitled",
            id: node.dataset.id,
            kind: node.dataset.kind || "rect",
            points:
              node.dataset.kind === "polygon"
                ? JSON.parse(node.dataset.points || "[]")
                : null,
          }));
          return {
            savedAt: Date.now(),
            normalCounter: state.normalCounter,
            passageCounter: state.passageCounter,
            pMode: state.pMode,
            boxIdCounter: state.boxIdCounter,
            selections,
          };
        }

        function applySessionSnapshot(session) {
          if (!session || typeof session !== "object") return;
          isRestoringSession = true;
          state.normalCounter = Math.max(1, Number(session.normalCounter) || 1);
          state.passageCounter = Math.max(
            1,
            Number(session.passageCounter ?? session.pIndex) || 1
          );
          state.pMode = !!session.pMode;
          state.boxIdCounter = Math.max(1, Number(session.boxIdCounter) || 1);

          const selections = Array.isArray(session.selections)
            ? session.selections
            : [];
          for (const s of selections) {
            if (!s || typeof s.pageIndex !== "number" || s.pageIndex < 0) {
              continue;
            }
            let targetPageIndex = s.pageIndex;
            let yOffset = 0;
            if (targetPageIndex >= state.pages.length) {
              if (
                state.pages.length === 1 &&
                mergedPageTopOffsets.length &&
                targetPageIndex < mergedPageTopOffsets.length
              ) {
                yOffset = mergedPageTopOffsets[targetPageIndex] || 0;
                targetPageIndex = 0;
              } else {
                continue;
              }
            }
            const p = state.pages[targetPageIndex];
            const rect = s.rect || {};
            const x = Number(rect.x);
            const y = Number(rect.y) + yOffset;
            const w = Number(rect.w);
            const h = Number(rect.h);
            if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) {
              continue;
            }
            const rawPoints =
              s.kind === "polygon" && Array.isArray(s.points) ? s.points : null;
            const points = rawPoints
              ? rawPoints.map((pt) => ({
                  x: Number(pt.x),
                  y: Number(pt.y) + yOffset,
                }))
              : rectToPolygonPoints({ x, y, w, h });
            createSelection(
              p.node.boxes,
              { x, y, w, h },
              sanitizeLabel(s.label || "untitled") || "untitled",
              s.id,
              {
                kind: "polygon",
                points,
              }
            );
          }
          isRestoringSession = false;
        }

        function saveSession() {
          if (!currentSessionKey || !state.pages.length) return;
          try {
            const store = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
            store[currentSessionKey] = buildSessionSnapshot();

            const keysByAge = Object.keys(store).sort(
              (a, b) => (store[b]?.savedAt || 0) - (store[a]?.savedAt || 0)
            );
            for (const key of keysByAge.slice(MAX_SAVED_SESSIONS)) {
              delete store[key];
            }
            localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
            if (!currentDocId) setSaveStatusSavedSoon("Saved local");
          } catch (err) {
            console.warn("Session save failed:", err);
            setSaveStatus("error", "Save failed");
          }
        }

        function restoreSession() {
          if (!currentSessionKey) return;
          try {
            const store = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
            const session = store[currentSessionKey];
            if (!session) return;
            applySessionSnapshot(session);
          } catch (err) {
            console.warn("Session restore failed:", err);
          }
        }

        async function loadServerSession(docId) {
          if (!docId) return null;
          try {
            const res = await fetch(
              `${apiUrl("/api/snip-docs/session")}?doc=${encodeURIComponent(docId)}`
            );
            if (!res.ok) return null;
            const payload = await res.json();
            return payload?.session || null;
          } catch {
            return null;
          }
        }

        async function saveServerSession(docId, snapshot) {
          if (!docId || !snapshot) return;
          const res = await fetch(
            `${apiUrl("/api/snip-docs/session")}?doc=${encodeURIComponent(docId)}`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ session: snapshot }),
              keepalive: true,
            }
          );
          if (!res.ok) {
            throw new Error(`Server save failed with HTTP ${res.status}`);
          }
        }

        function saveServerSessionWithBeacon(docId, snapshot) {
          if (!docId || !snapshot || typeof navigator.sendBeacon !== "function") {
            return false;
          }
          try {
            const body = JSON.stringify({ session: snapshot });
            const ok = navigator.sendBeacon(
              `${apiUrl("/api/snip-docs/session")}?doc=${encodeURIComponent(docId)}`,
              new Blob([body], { type: "application/json" })
            );
            return !!ok;
          } catch {
            return false;
          }
        }

        // ---------- Utils ----------
        function updateAllBoxesPositions() {
          state.pages.forEach((p) => {
            p.node.boxes
              .querySelectorAll(".selection")
              .forEach((el) => placeSelectionEl(el, p));
          });
        }

        let resizeTimer;
        window.addEventListener("resize", () => {
          clearTimeout(resizeTimer);
          resizeTimer = setTimeout(() => {
            applyZoom();
            updateAllBoxesPositions();
            updateDocNameTicker();
          }, 100);
        });
        document.addEventListener("visibilitychange", () => {
          if (
            document.visibilityState !== "hidden" ||
            !currentDocId ||
            !state.pages.length ||
            isRestoringSession
          ) {
            return;
          }
          saveSession();
          queueServerSessionSave(buildSessionSnapshot(), currentDocId);
        });
        window.addEventListener("beforeunload", () => {
          if (!currentDocId || !state.pages.length || isRestoringSession) return;
          saveSession();
          const docIdSnapshot = currentDocId;
          const snapshot = buildSessionSnapshot();
          if (!saveServerSessionWithBeacon(docIdSnapshot, snapshot)) {
            queueServerSessionSave(snapshot, docIdSnapshot);
          }
        });

        async function bootstrap() {
          // Initial UI
          updateToolbar();
          updateEmptyState();
          await fetchServerDocuments();

          if (initialDocId) {
            try {
              await loadServerDocumentById(initialDocId);
            } catch (err) {
              console.warn("Failed to open initial document from URL:", err);
            }
          }
        }

        bootstrap();
      })();
    
