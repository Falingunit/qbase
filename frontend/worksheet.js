"use strict";
(function () {
  // Data locations:
  // Expects a manifest at ./data/worksheets/{wID}.json with shape:
  // { title?: string, pages: string[], answers?: string[] }

  const els = {
    title: document.getElementById("ws-title"),
    pages: document.getElementById("ws-pages"),
    answersWrap: document.getElementById("ws-answers-wrap"),
    answers: document.getElementById("ws-answers"),
    reset: document.getElementById("ws-reset"),
    toolDraw: document.getElementById("tool-draw"),
    toolErase: document.getElementById("tool-erase"),
    markSearch: document.getElementById("mark-search"),
    markPrev: document.getElementById("mark-prev"),
    markNext: document.getElementById("mark-next"),
    markCount: document.getElementById("mark-count"),
    ansMask: document.getElementById("ans-mask"),
    ansReveal: document.getElementById("ans-reveal"),
    ansClear: document.getElementById("ans-clear"),
  };

  const wID = new URLSearchParams(location.search).get("wID") || "";
  const storeKey = (suffix) => `qb_ws_${wID}_${suffix}`;

  let worksheet = { title: "Worksheet", pages: [], answers: [] };
  let drawTool = "draw"; // or "erase"
  let markers = loadMarkers(); // [{page,i, side, yRatio, text, id}]
  let currentMarkHits = [];
  let currentHitIndex = -1;

  init();

  async function init() {
    await loadConfig();
    if (!wID) {
      alert("Missing worksheet ID (wID)");
      return;
    }
    try {
      worksheet = await loadWorksheet(wID);
      renderTitle();
      renderPages();
      renderAnswers();
      updateMarkerCount();
      bindUI();
      window.addEventListener("resize", () => {
        // Reflow marker positions on resize
        worksheet.pages.forEach((_, i) => renderMarkersFor(i));
      });
      // scroll to hash marker if provided
      if (location.hash.startsWith("#m-")) {
        const id = location.hash.slice(3);
        jumpToMarkerId(id);
      }
    } catch (e) {
      console.error(e);
      alert("Failed to load worksheet. Ensure data/worksheets/" + wID + ".json exists.");
    }
  }

  async function loadWorksheet(id) {
    const url = `./data/worksheets/${encodeURIComponent(id)}.json`;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    const json = await r.json();
    const pages = (json.pages || []).slice().sort(byFilename);
    const answers = (json.answers || []).slice().sort(byFilename);
    return { title: json.title || "Worksheet", pages, answers };
  }

  function byFilename(a, b) {
    const fa = a.split("/").pop().toLowerCase();
    const fb = b.split("/").pop().toLowerCase();
    return fa.localeCompare(fb);
  }

  function renderTitle() {
    if (els.title) els.title.textContent = worksheet.title || "Worksheet";
    document.title = `${worksheet.title} — QBase`;
  }

  function bindUI() {
    // Tools
    els.toolDraw?.addEventListener("click", () => setDrawTool("draw"));
    els.toolErase?.addEventListener("click", () => setDrawTool("erase"));
    setDrawTool("draw");

    els.reset?.addEventListener("click", resetWorksheet);

    // Marker search controls
    let searchDebounce;
    els.markSearch?.addEventListener("input", () => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(updateSearchHits, 150);
    });
    els.markPrev?.addEventListener("click", () => jumpHit(-1));
    els.markNext?.addEventListener("click", () => jumpHit(1));

    // Answer tools
    els.ansMask?.addEventListener("click", () => setAnsTool("mask"));
    els.ansReveal?.addEventListener("click", () => setAnsTool("reveal"));
    els.ansClear?.addEventListener("click", clearAllMasks);
  }

  function setDrawTool(t) {
    drawTool = t;
    els.toolDraw?.classList.toggle("active", t === "draw");
    els.toolErase?.classList.toggle("active", t === "erase");
    // Set all page canvases active for drawing
    document.querySelectorAll(".ws-canvas").forEach((c) => c.classList.add("active"));
  }

  function renderPages() {
    const host = els.pages;
    host.innerHTML = "";
    worksheet.pages.forEach((src, index) => {
      const page = document.createElement("div");
      page.className = "ws-page";

      // gutters for markers
      const gl = document.createElement("div");
      gl.className = "ws-gutter left";
      gl.innerHTML = '<span class="hint mt-1">Add marker</span>';
      const gr = document.createElement("div");
      gr.className = "ws-gutter right";
      gr.innerHTML = '<span class="hint mt-1">Add marker</span>';

      const wrap = document.createElement("div");
      wrap.className = "ws-media-wrap";
      const img = document.createElement("img");
      img.className = "ws-img";
      img.loading = "lazy";
      img.src = src;

      const canvas = document.createElement("canvas");
      canvas.className = "ws-canvas";

      wrap.append(img, canvas);
      page.append(gl, gr, wrap);
      host.appendChild(page);

      img.addEventListener("load", () => preparePageCanvas(canvas, img, index));

      gl.addEventListener("click", (e) => addMarkerAt(page, index, "left", e));
      gr.addEventListener("click", (e) => addMarkerAt(page, index, "right", e));
    });
  }

  function preparePageCanvas(canvas, img, index) {
    // Natural size canvas; auto-scale with CSS width/height:100%
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    // Restore saved drawing if any
    const dataUrl = localStorage.getItem(storeKey(`page_${index}_draw`));
    if (dataUrl) {
      const im = new Image();
      im.onload = () => {
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(im, 0, 0);
      };
      im.src = dataUrl;
    }
    enableCanvasDrawing(canvas, index);
    // Re-render markers on this page
    renderMarkersFor(index);
  }

  function enableCanvasDrawing(canvas, pageIndex) {
    const ctx = canvas.getContext("2d");
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    let drawing = false;
    let last = null;

    function getPos(evt) {
      const rect = canvas.getBoundingClientRect();
      const x = (evt.touches ? evt.touches[0].clientX : evt.clientX) - rect.left;
      const y = (evt.touches ? evt.touches[0].clientY : evt.clientY) - rect.top;
      // scale to canvas size
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return { x: x * scaleX, y: y * scaleY };
    }

    function start(e) {
      drawing = true;
      last = getPos(e);
      e.preventDefault();
    }
    function move(e) {
      if (!drawing) return;
      const p = getPos(e);
      if (drawTool === "erase") {
        ctx.globalCompositeOperation = "destination-out";
        ctx.lineWidth = 30;
      } else {
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = "#ffd166";
        ctx.lineWidth = 3;
      }
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last = p;
      e.preventDefault();
    }
    function end() {
      drawing = false;
      last = null;
      // persist
      try {
        const url = canvas.toDataURL("image/png");
        localStorage.setItem(storeKey(`page_${pageIndex}_draw`), url);
      } catch {}
    }

    canvas.addEventListener("mousedown", start);
    canvas.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
    canvas.addEventListener("touchstart", start, { passive: false });
    canvas.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", end);
  }

  // ===== Markers =====
  function loadMarkers() {
    try {
      const raw = localStorage.getItem(storeKey("markers"));
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }
  function saveMarkers() {
    try { localStorage.setItem(storeKey("markers"), JSON.stringify(markers)); } catch {}
  }

  function addMarkerAt(pageEl, pageIndex, side, evt) {
    const img = pageEl.querySelector(".ws-img");
    if (!img) return;
    const rect = img.getBoundingClientRect();
    const y = (evt.touches ? evt.touches[0].clientY : evt.clientY) - rect.top;
    const yRatio = Math.max(0, Math.min(1, y / rect.height));
    const text = prompt("Marker text?") || "";
    const id = `m${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}`;
    const m = { id, page: pageIndex, side, yRatio, text };
    markers.push(m);
    saveMarkers();
    renderMarkersFor(pageIndex);
    updateMarkerCount();
    location.hash = `m-${id}`;
  }

  function renderMarkersFor(pageIndex) {
    const pageEl = els.pages.children[pageIndex];
    if (!pageEl) return;
    pageEl.querySelectorAll(".ws-marker").forEach((el) => el.remove());
    const img = pageEl.querySelector(".ws-img");
    const rect = img.getBoundingClientRect();
    markers.filter((m) => m.page === pageIndex).forEach((m) => {
      const el = document.createElement("div");
      el.className = `ws-marker ${m.side}`;
      el.textContent = m.text || "Marker";
      el.style.top = `${m.yRatio * rect.height}px`;
      el.id = `marker-${m.id}`;
      pageEl.appendChild(el);
    });
  }

  function updateMarkerCount() {
    if (!els.markCount) return;
    els.markCount.textContent = `${markers.length} marker${markers.length===1?"":"s"}`;
  }

  function updateSearchHits() {
    const q = (els.markSearch?.value || "").toLowerCase().trim();
    currentMarkHits = markers
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => !q || String(m.text || "").toLowerCase().includes(q));
    currentHitIndex = currentMarkHits.length > 0 ? 0 : -1;
    if (currentHitIndex >= 0) jumpToMarker(currentMarkHits[0].m);
    updateMarkerCount();
  }
  function jumpHit(dir) {
    if (currentMarkHits.length === 0) return;
    currentHitIndex = (currentHitIndex + dir + currentMarkHits.length) % currentMarkHits.length;
    jumpToMarker(currentMarkHits[currentHitIndex].m);
  }
  function jumpToMarkerId(id) {
    const m = markers.find((x) => x.id === id);
    if (m) jumpToMarker(m);
  }
  function jumpToMarker(m) {
    const pageEl = els.pages.children[m.page];
    const img = pageEl?.querySelector(".ws-img");
    if (!pageEl || !img) return;
    const rect = img.getBoundingClientRect();
    const y = pageEl.getBoundingClientRect().top + window.scrollY + rect.height * m.yRatio - 100;
    window.scrollTo({ top: y, behavior: "smooth" });
    // flash marker
    const el = document.getElementById(`marker-${m.id}`);
    if (el) {
      el.style.boxShadow = "0 0 0 3px rgba(13,202,240,.6)";
      setTimeout(() => (el.style.boxShadow = ""), 1200);
    }
  }

  // ===== Reset =====
  function resetWorksheet() {
    if (!confirm("Reset drawings and markers for this worksheet?")) return;
    // Clear drawings
    worksheet.pages.forEach((_, i) => {
      localStorage.removeItem(storeKey(`page_${i}_draw`));
    });
    // Clear masks
    worksheet.answers.forEach((_, i) => {
      localStorage.removeItem(storeKey(`ans_${i}_mask`));
    });
    // Clear markers
    markers = [];
    saveMarkers();
    // Re-render
    renderPages();
    renderAnswers();
    updateMarkerCount();
  }

  // ===== Answers (mask/reveal) =====
  let ansTool = "mask"; // or "reveal"
  function setAnsTool(t) {
    ansTool = t;
    els.ansMask?.classList.toggle("active", t === "mask");
    els.ansReveal?.classList.toggle("active", t === "reveal");
  }
  function clearAllMasks() {
    worksheet.answers.forEach((_, i) => {
      localStorage.removeItem(storeKey(`ans_${i}_mask`));
    });
    document.querySelectorAll(".ws-ans-mask").forEach((c) => {
      const ctx = c.getContext("2d");
      ctx.clearRect(0, 0, c.width, c.height);
    });
  }

  function renderAnswers() {
    const wrap = els.answersWrap;
    const host = els.answers;
    if (!worksheet.answers || worksheet.answers.length === 0) {
      wrap?.classList.add("d-none");
      return;
    }
    wrap?.classList.remove("d-none");
    host.innerHTML = "";
    worksheet.answers.forEach((src, index) => {
      const d = document.createElement("div");
      d.className = "ws-answer";
      const img = document.createElement("img");
      img.className = "ws-ans-img";
      img.loading = "lazy";
      img.src = src;
      const mask = document.createElement("canvas");
      mask.className = "ws-ans-mask";
      d.append(img, mask);
      host.appendChild(d);
      img.addEventListener("load", () => prepareAnsCanvas(mask, img, index));
    });
    setAnsTool("mask");
  }

  function prepareAnsCanvas(canvas, img, index) {
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d");
    // restore
    const dataUrl = localStorage.getItem(storeKey(`ans_${index}_mask`));
    if (dataUrl) {
      const im = new Image();
      im.onload = () => ctx.drawImage(im, 0, 0);
      im.src = dataUrl;
    }
    canvas.classList.add("active");

    let dragging = false;
    let start = null;

    function getPos(evt) {
      const rect = canvas.getBoundingClientRect();
      const x = (evt.touches ? evt.touches[0].clientX : evt.clientX) - rect.left;
      const y = (evt.touches ? evt.touches[0].clientY : evt.clientY) - rect.top;
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return { x: x * scaleX, y: y * scaleY };
    }

    function startDrag(e) {
      dragging = true;
      start = getPos(e);
      e.preventDefault();
    }
    function moveDrag(e) {
      if (!dragging) return;
      const pos = getPos(e);
      if (ansTool === "mask") {
        // draw rounded rectangle from start to pos
        const x = Math.min(start.x, pos.x);
        const y = Math.min(start.y, pos.y);
        const w = Math.abs(pos.x - start.x);
        const h = Math.abs(pos.y - start.y);
        const r = Math.min(18, Math.min(w, h) / 4);
        // redraw previous saved onto a fresh clear to avoid trails
        const bg = new Image();
        bg.onload = () => {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(bg, 0, 0);
          ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--mask-color") || "rgba(0,0,0,0.96)";
          roundRect(ctx, x, y, w, h, r);
          ctx.fill();
        };
        bg.src = canvas.toDataURL();
      } else if (ansTool === "reveal") {
        ctx.globalCompositeOperation = "destination-out";
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 16, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
      }
      e.preventDefault();
    }
    function endDrag() {
      dragging = false;
      start = null;
      try {
        const url = canvas.toDataURL("image/png");
        localStorage.setItem(storeKey(`ans_${index}_mask`), url);
      } catch {}
    }

    canvas.addEventListener("mousedown", startDrag);
    canvas.addEventListener("mousemove", moveDrag);
    window.addEventListener("mouseup", endDrag);
    canvas.addEventListener("touchstart", startDrag, { passive: false });
    canvas.addEventListener("touchmove", moveDrag, { passive: false });
    window.addEventListener("touchend", endDrag);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
})();
