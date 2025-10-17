// Assignment view: DOM-only helpers (image overlay)
(function(){
  // Image Overlay: centered + wheel/pinch zoom + pan
  const style = document.createElement('style');
  style.textContent = `
    #image-overlay{position:fixed;inset:0;display:none;z-index:1060;background:rgba(10,12,14,.85)}
    #image-overlay .io-backdrop{position:absolute;inset:0}
    #image-overlay .io-stage{position:absolute; inset:0; display:grid; place-items:center; overflow:hidden; touch-action:none}
    #image-overlay .io-img{max-width:none; max-height:none; transform-origin:center center; user-select:none; -webkit-user-drag:none}
    #image-overlay .io-hint{position:absolute; bottom:12px; left:50%; transform:translateX(-50%); font:500 13px/1.2 system-ui,sans-serif; color:#cfe7ff; opacity:.9; background:rgba(20,22,26,.6); border:1px solid rgba(255,255,255,.06); padding:.35rem .65rem; border-radius:12px; white-space:nowrap}
    @media (max-width:575.98px){ #image-overlay .io-hint{ bottom:8px } }
  `;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'image-overlay';
  root.innerHTML = `<div class="io-backdrop" aria-hidden="true"></div>
    <div class="io-stage" role="dialog" aria-label="Image viewer" aria-modal="true">
      <img class="io-img" alt="">
      <div class="io-hint">Scroll or pinch to zoom • Click/drag to pan • 0 to reset • Esc to close</div>
    </div>`;
  document.body.appendChild(root);
  const stage = root.querySelector('.io-stage');
  const img = root.querySelector('.io-img');

  let open = false; let naturalW=0, naturalH=0; let baseScale=1; let zoom=1; let panX=0, panY=0; const minZoom=0.2, maxZoom=8; const FIT_SCALE_FACTOR=0.9;
  const pointers = new Map(); let lastPinchDist = null; let suppressNextClick=false;

  function setTransform(){ img.style.transform = `translate(${panX}px, ${panY}px) scale(${baseScale*zoom})`; stage.style.cursor = pointers.size>0? 'grabbing':'grab'; }
  function clampPan(){ const rect = stage.getBoundingClientRect(); const dispW = naturalW*baseScale*zoom; const dispH = naturalH*baseScale*zoom; const halfW=rect.width/2, halfH=rect.height/2; const maxX=Math.max(halfW, Math.abs((dispW-rect.width)/2)); const maxY=Math.max(halfH, Math.abs((dispH-rect.height)/2)); panX=Math.max(-maxX, Math.min(maxX, panX)); panY=Math.max(-maxY, Math.min(maxY, panY)); }
  function fitToStage(){ const rect = stage.getBoundingClientRect(); const sx=rect.width/naturalW; const sy=rect.height/naturalH; baseScale=Math.min(sx, sy)*FIT_SCALE_FACTOR; panX=0; panY=0; setTransform(); }
  function zoomToAt(newZoom, clientX, clientY){ const rect=stage.getBoundingClientRect(); const cx=clientX - rect.left - rect.width/2; const cy=clientY - rect.top - rect.height/2; const sOld=baseScale*zoom; const sNew=baseScale*newZoom; if (sOld>0 && sNew>0){ const k=sNew/sOld; panX=(1-k)*cx + k*panX; panY=(1-k)*cy + k*panY; } zoom=Math.min(maxZoom, Math.max(minZoom, newZoom)); clampPan(); setTransform(); }
  function reset(){ zoom=1; panX=0; panY=0; fitToStage(); }
  function openOverlay(src, alt=''){ img.src=src; img.alt=alt||'Image'; root.style.display='block'; open=true; if (img.complete){ naturalW=img.naturalWidth; naturalH=img.naturalHeight; reset(); } else { img.onload=()=>{ naturalW=img.naturalWidth; naturalH=img.naturalHeight; reset(); }; } }
  function closeOverlay(){ open=false; root.style.display='none'; img.src=''; }

  window.showImageOverlay = (src) => openOverlay(src);

  root.querySelector('.io-backdrop').addEventListener('click', ()=> closeOverlay());
  root.querySelector('.io-backdrop').addEventListener('touchstart', ()=> closeOverlay(), { passive:true });
  stage.addEventListener('click', (e)=>{ if (suppressNextClick) { suppressNextClick=false; return; } if (e.target!==img) closeOverlay(); });
  img.addEventListener('click', (e)=> e.stopPropagation()); img.addEventListener('touchstart', (e)=> e.stopPropagation(), { passive:true });
  stage.addEventListener('wheel', (e)=>{ if (!open) return; e.preventDefault(); const factor=e.deltaY<0?1.1:(1/1.1); const target=Math.min(maxZoom, Math.max(minZoom, zoom*factor)); zoomToAt(target, e.clientX, e.clientY); }, { passive:false });
  stage.addEventListener('pointerdown', (e)=>{ if (!open) return; stage.setPointerCapture?.(e.pointerId); pointers.set(e.pointerId, { x:e.clientX, y:e.clientY }); stage.style.cursor='grabbing'; });
  stage.addEventListener('pointermove', (e)=>{ if (!open) return; const p=pointers.get(e.pointerId); if (!p) return; pointers.set(e.pointerId, { x:e.clientX, y:e.clientY }); if (pointers.size===1){ panX += e.clientX - p.x; panY += e.clientY - p.y; clampPan(); setTransform(); } else if (pointers.size===2){ const arr=Array.from(pointers.values()); const dx=arr[0].x - arr[1].x; const dy=arr[0].y - arr[1].y; const dist=Math.hypot(dx,dy); if (lastPinchDist){ const factor=dist/lastPinchDist; const target=Math.min(maxZoom, Math.max(minZoom, zoom*factor)); const c = { x:(arr[0].x+arr[1].x)/2, y:(arr[0].y+arr[1].y)/2 }; zoomToAt(target, c.x, c.y); } lastPinchDist=dist; suppressNextClick=true; }
  });
  stage.addEventListener('pointerup', (e)=>{ if (!open) return; pointers.delete(e.pointerId); if (pointers.size===0) { lastPinchDist=null; stage.style.cursor='grab'; } });
  stage.addEventListener('pointercancel', (e)=>{ pointers.delete(e.pointerId); if (pointers.size===0) { lastPinchDist=null; stage.style.cursor='grab'; } });
  window.addEventListener('keydown', (e)=>{ if (!open) return; if (e.key==='Escape') closeOverlay(); if (e.key==='0') reset(); });
})();

