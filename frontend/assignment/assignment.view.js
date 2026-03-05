// Assignment view: DOM-only helpers (image overlay)
(function () {
  const style = document.createElement("style");
  style.textContent = `
    #image-overlay{position:fixed;inset:0;display:none;z-index:1060;background:rgba(10,12,14,.85)}
    #image-overlay .io-backdrop{position:absolute;inset:0}
    #image-overlay .io-stage{position:absolute;inset:0;display:grid;place-items:center;overflow:hidden;touch-action:none}
    #image-overlay .io-img{max-width:none;max-height:none;max-inline-size:none;max-block-size:none;transform-origin:center center;user-select:none;-webkit-user-drag:none}
    #image-overlay .io-hint{position:absolute;bottom:12px;left:50%;transform:translateX(-50%);font:500 13px/1.2 system-ui,sans-serif;color:#cfe7ff;opacity:.9;background:rgba(20,22,26,.6);border:1px solid rgba(255,255,255,.06);padding:.35rem .65rem;border-radius:12px;white-space:nowrap}
    @media (max-width:575.98px){ #image-overlay .io-hint{ bottom:8px } }
  `;
  document.head.appendChild(style);

  const root = document.createElement("div");
  root.id = "image-overlay";
  root.innerHTML = `
    <div class="io-backdrop" aria-hidden="true"></div>
    <div class="io-stage" role="dialog" aria-label="Image viewer" aria-modal="true">
      <img class="io-img" alt="" draggable="false">
      <div class="io-hint">Scroll or pinch to zoom - Click/drag to pan - 0 to reset - Esc to close</div>
    </div>
  `;
  document.body.appendChild(root);

  const stage = root.querySelector(".io-stage");
  const img = root.querySelector(".io-img");

  const FIT_SCALE_FACTOR = 0.92;
  const MIN_ZOOM = 0.3;
  const MAX_ZOOM = 8;

  let open = false;
  let naturalW = 0;
  let naturalH = 0;
  let fitScale = 1;
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let openToken = 0;

  const pointers = new Map();
  let pinchDist = null;
  let pinchMid = null;
  let suppressCloseClick = false;

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const clampZoom = (z) => clamp(z, MIN_ZOOM, MAX_ZOOM);

  function currentScale() {
    return fitScale * zoom;
  }

  function updateCursor() {
    stage.style.cursor = pointers.size > 0 ? "grabbing" : "grab";
  }

  function clampPan() {
    // Intentionally unrestricted panning.
  }

  function render() {
    img.style.transform = `translate(${panX}px, ${panY}px) scale(${currentScale()})`;
    updateCursor();
  }

  function resetView() {
    const rect = stage.getBoundingClientRect();
    img.style.width = "auto";
    img.style.height = "auto";
    img.style.maxWidth = `${Math.max(1, Math.floor(rect.width * FIT_SCALE_FACTOR))}px`;
    img.style.maxHeight = `${Math.max(1, Math.floor(rect.height * FIT_SCALE_FACTOR))}px`;
    fitScale = 1;
    img.style.transform = "translate(0px, 0px) scale(1)";
    const baseRect = img.getBoundingClientRect();
    naturalW = Math.max(1, baseRect.width || naturalW || 1);
    naturalH = Math.max(1, baseRect.height || naturalH || 1);
    zoom = 1;
    panX = 0;
    panY = 0;
    render();
  }

  function zoomToAt(nextZoom, clientX, clientY) {
    const rect = stage.getBoundingClientRect();
    const anchorX = clientX - rect.left - rect.width / 2;
    const anchorY = clientY - rect.top - rect.height / 2;
    const oldScale = currentScale();
    zoom = clampZoom(nextZoom);
    const newScale = currentScale();
    if (oldScale > 0 && newScale > 0) {
      const k = newScale / oldScale;
      panX = (1 - k) * anchorX + k * panX;
      panY = (1 - k) * anchorY + k * panY;
    }
    clampPan();
    render();
  }

  function stageCenterClient() {
    const rect = stage.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function openOverlay(src, alt = "") {
    const token = ++openToken;
    open = true;
    root.style.display = "block";
    img.style.visibility = "hidden";
    img.onload = null;
    img.onerror = null;
    img.alt = alt || "Image";
    img.style.transform = "translate(0px, 0px) scale(1)";
    const probe = new Image();
    probe.decoding = "async";
    probe.onload = () => {
      if (!open || token !== openToken) return;
      img.src = src;
      requestAnimationFrame(() => {
        if (!open || token !== openToken) return;
        requestAnimationFrame(() => {
          if (!open || token !== openToken) return;
          naturalW = Math.max(1, probe.naturalWidth || 1);
          naturalH = Math.max(1, probe.naturalHeight || 1);
          resetView();
          img.style.visibility = "";
        });
      });
    };
    probe.onerror = () => {
      if (!open || token !== openToken) return;
      img.src = src;
      img.style.visibility = "";
    };
    probe.src = src;
  }

  function closeOverlay() {
    openToken += 1;
    open = false;
    pointers.clear();
    pinchDist = null;
    pinchMid = null;
    root.style.display = "none";
    img.onload = null;
    img.onerror = null;
    img.style.visibility = "";
    img.src = "";
    updateCursor();
  }

  window.showImageOverlay = (src) => openOverlay(src);

  root.querySelector(".io-backdrop").addEventListener("click", closeOverlay);
  root
    .querySelector(".io-backdrop")
    .addEventListener("touchstart", closeOverlay, { passive: true });
  stage.addEventListener("click", (e) => {
    if (!open) return;
    if (suppressCloseClick) {
      suppressCloseClick = false;
      return;
    }
    if (e.target === img) return;
    closeOverlay();
  });
  img.addEventListener("click", (e) => e.stopPropagation());
  img.addEventListener("touchstart", (e) => e.stopPropagation(), { passive: true });

  stage.addEventListener(
    "wheel",
    (e) => {
      if (!open) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      zoomToAt(zoom * factor, e.clientX, e.clientY);
    },
    { passive: false }
  );

  stage.addEventListener("pointerdown", (e) => {
    if (!open) return;
    stage.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      pinchMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
    updateCursor();
  });

  stage.addEventListener(
    "pointermove",
    (e) => {
      if (!open) return;
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (pinchMid) {
          panX += mid.x - pinchMid.x;
          panY += mid.y - pinchMid.y;
        }
        if (pinchDist && pinchDist > 0) {
          const ratio = clamp(dist / pinchDist, 0.9, 1.1);
          zoomToAt(zoom * ratio, mid.x, mid.y);
        } else {
          clampPan();
          render();
        }
        pinchDist = dist;
        pinchMid = mid;
        suppressCloseClick = true;
      } else if (pointers.size === 1) {
        const dx = e.clientX - prev.x;
        const dy = e.clientY - prev.y;
        if (dx || dy) {
          panX += dx;
          panY += dy;
          clampPan();
          render();
          suppressCloseClick = true;
        }
      }
    },
    { passive: false }
  );

  function endPointer(e) {
    try {
      stage.releasePointerCapture?.(e.pointerId);
    } catch {}
    pointers.delete(e.pointerId);
    if (pointers.size < 2) {
      pinchDist = null;
      pinchMid = null;
    }
    updateCursor();
  }

  stage.addEventListener("pointerup", endPointer);
  stage.addEventListener("pointercancel", endPointer);
  stage.addEventListener("pointerleave", endPointer);

  window.addEventListener("keydown", (e) => {
    if (!open) return;
    if (e.key === "Escape") closeOverlay();
    if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      const c = stageCenterClient();
      zoomToAt(zoom * 1.2, c.x, c.y);
    }
    if (e.key === "-") {
      e.preventDefault();
      const c = stageCenterClient();
      zoomToAt(zoom / 1.2, c.x, c.y);
    }
    if (e.key === "0") {
      e.preventDefault();
      resetView();
    }
  });

  window.addEventListener("resize", () => {
    if (!open || !(naturalW > 0 && naturalH > 0)) return;
    resetView();
  });
})();
