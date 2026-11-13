/* RayMan app: wires the canvas, tool strip, properties panel and keyboard together, and
   holds the interaction state (current tool, selection, what is being dragged). */
(function () {
  'use strict';
  var RM = window.RM, G = RM.geom, S = RM.scene, Snap = RM.snap;
  function $(id) { return document.getElementById(id); }

  var HIT_PX = 9;          // how close the pointer must be to grab something
  var SNAP_PX = 12;        // how close counts as "lined up" when snapping
  var STORE_KEY = 'rayman.scene.v1', THEME_KEY = 'rayman.theme';

  var cv = $('cv'), ctx = cv.getContext('2d'), stage = $('stage');
  var view = new RM.View();
  var st = {                // everything the renderer needs
    scene: S.create(), view: view, theme: 'dark', tool: 'select',
    sel: null, hover: null, ghost: null, hint: null, hotFocal: null, axisHot: false
  };
  var hist = new S.History();
  var drag = null, spaceDown = false, W = 0, H = 0, queued = false, lastF = S.DEFAULT_F;

  var panel = new RM.Panel($('props'), {
    onLive: redraw,
    onCommit: commit,
    onDelete: deleteElement,
    onClose: function () { select(null); }
  });

  // ---------------------------------------------------------------- storage (best effort)

  function stored(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function store(key, v) { try { localStorage.setItem(key, v); } catch (e) { /* private mode etc. */ } }

  // ---------------------------------------------------------------- drawing

  function redraw() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () {
      queued = false;
      var dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      RM.render.draw(ctx, W, H, st);
    });
  }

  function resize() {
    var r = stage.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (W) view.pan((r.width - W) / 2, (r.height - H) / 2);   // keep the picture centred
    W = r.width; H = r.height;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    redraw();
  }

  /** Fit everything in view, keeping clear of the properties panel when it is open. */
  function fit() {
    var props = $('props'), right = props.hidden ? 0 : props.offsetWidth + 20;
    view.fit(S.bounds(st.scene) || { z0: -60, z1: 140, y0: -30, y1: 30 }, W - right, H);
    redraw();
  }

  // ---------------------------------------------------------------- history

  /** Record the scene as an undo step (no-op if unchanged) and autosave it. */
  function commit() {
    var e = st.sel && S.find(st.scene, st.sel);
    if (e && e.type === 'lens') lastF = e.f;
    if (hist.push(S.toJSON(st.scene))) store(STORE_KEY, hist.current());
    updateButtons();
  }

  function restore(snap) {
    st.scene = S.fromJSON(snap);
    if (st.sel && !S.find(st.scene, st.sel)) st.sel = null;
    panel.show(st.sel && S.find(st.scene, st.sel));
    store(STORE_KEY, snap);
    updateButtons(); redraw();
  }
  function undo() { var s = hist.undo(); if (s) restore(s); }
  function redo() { var s = hist.redo(); if (s) restore(s); }

  function updateButtons() {
    document.querySelector('[data-act=undo]').disabled = !hist.canUndo();
    document.querySelector('[data-act=redo]').disabled = !hist.canRedo();
  }

  // ---------------------------------------------------------------- selection and tools

  function select(id) {
    st.sel = id;
    panel.show(id && S.find(st.scene, id));
    redraw();
  }

  function deleteElement(id) {
    if (!id || !S.remove(st.scene, id)) return;
    select(null); commit();
  }

  var TOOL_HINTS = {
    select: 'Drag lenses, objects and focal points to move them · drag empty space to pan · scroll to zoom · hold Alt to stop snapping',
    lens: 'Click to place a thin lens on the optical axis · Shift-click to place several · Esc to stop',
    object: 'Click where the tip of the object arrow should be; its base sits on the axis · Esc to stop',
    point: 'Click to place a point source · Esc to stop'
  };

  function setTool(t) {
    st.tool = t; st.ghost = null; st.hint = null; st.hover = null;
    document.querySelectorAll('[data-tool]').forEach(function (b) {
      b.classList.toggle('on', b.dataset.tool === t);
    });
    $('hint').textContent = TOOL_HINTS[t];
    cv.style.cursor = t === 'select' ? 'default' : 'crosshair';
    redraw();
  }

  // ---------------------------------------------------------------- pointer geometry

  function pos(e) {
    var r = cv.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  }
  function world(p) { return { z: view.z(p.px), y: view.y(p.py) }; }

  function snapOpt(e) {
    return { tol: SNAP_PX / view.s, grid: G.niceStep(view.s, 14), free: e.altKey };
  }

  /** What is under screen point p? Topmost and smallest things win. */
  function hitTest(p) {
    var w = world(p), tol = HIT_PX / view.s, els = st.scene.elements, i, e;
    var head = 16 / view.s;                       // lens arrowheads stick out this far
    for (i = els.length - 1; i >= 0; i--) {
      e = els[i];
      if (e.type === 'point' && G.dist(w, { z: e.z, y: e.y }) <= 1.5 * tol) return { el: e, kind: 'point' };
    }
    for (i = els.length - 1; i >= 0; i--) {
      e = els[i];
      if (e.type === 'object' && G.dist(w, { z: e.z, y: e.h }) <= 1.5 * tol) return { el: e, kind: 'tip' };
    }
    var lensesSelectedLast = els.filter(function (x) { return x.type === 'lens'; })
      .sort(function (a, b) { return (a.id === st.sel) - (b.id === st.sel); });   // selected last = tried first
    for (i = lensesSelectedLast.length - 1; i >= 0; i--) {
      e = lensesSelectedLast[i];
      var fp = G.focalPoints(e);
      if (G.dist(w, { z: fp.Fp, y: 0 }) <= tol) return { el: e, kind: 'Fp' };
      if (G.dist(w, { z: fp.F, y: 0 }) <= tol) return { el: e, kind: 'F' };
    }
    for (i = els.length - 1; i >= 0; i--) {
      e = els[i];
      if (e.type === 'object' && G.distToSegment(w, { z: e.z, y: 0 }, { z: e.z, y: e.h }) <= tol) return { el: e, kind: 'object' };
    }
    for (i = els.length - 1; i >= 0; i--) {
      e = els[i];
      if (e.type !== 'lens' || Math.abs(w.z - e.z) > tol) continue;
      var ay = Math.abs(w.y);
      if (ay >= e.ap - tol && ay <= e.ap + head) return { el: e, kind: 'aperture' };
      if (ay < e.ap) return { el: e, kind: 'lens' };
    }
    return null;
  }

  var CURSORS = { point: 'move', tip: 'ns-resize', aperture: 'ns-resize', F: 'ew-resize', Fp: 'ew-resize', object: 'ew-resize', lens: 'ew-resize' };

  function hover(p) {
    var h = hitTest(p);
    var id = h ? h.el.id : null;
    var hot = h && (h.kind === 'F' || h.kind === 'Fp') ? { id: id, which: h.kind } : null;
    cv.style.cursor = spaceDown ? 'grab' : h ? CURSORS[h.kind] : 'default';
    if (id !== st.hover || JSON.stringify(hot) !== JSON.stringify(st.hotFocal)) {
      st.hover = id; st.hotFocal = hot; redraw();
    }
  }

  // ---------------------------------------------------------------- placing new elements

  /** The element the current placing tool would put down at p, and what it snapped to. */
  function ghostAt(p, e) {
    var w = world(p), o = snapOpt(e), r;
    if (st.tool === 'lens') {
      var g = { id: null, type: 'lens', z: 0, f: lastF, ap: S.DEFAULT_AP, label: '' };
      r = Snap.snapLensZ(st.scene, g, w.z, o); g.z = r.z;
      return { g: g, hit: r.hit };
    }
    if (st.tool === 'object') {
      r = Snap.snapAxisZ(st.scene, w.z, null, o);
      var h = Snap.snapHeight(w.y, o).y;
      return { g: { type: 'object', z: r.z, h: h === 0 ? S.DEFAULT_H : h, label: '' }, hit: r.hit };
    }
    if (st.tool === 'point') return pointSnap(w, null, o);
    return null;
  }

  /** Snap a point source position (z on key points/grid, y onto the axis/grid). */
  function pointSnap(w, id, o) {
    var rz = Snap.snapAxisZ(st.scene, w.z, id, o), ry = Snap.snapHeight(w.y, o);
    var hit = rz.hit ? { z: rz.z, y: ry.y, text: rz.hit.text + (ry.y === 0 ? ', on the axis' : '') }
      : ry.hit ? { z: rz.z, y: 0, text: 'on the axis' } : null;
    return { g: { type: 'point', z: rz.z, y: ry.y, label: '' }, hit: hit };
  }

  function place(e, p) {
    var r = ghostAt(p, e), g = r.g, el;
    if (g.type === 'lens') el = S.addLens(st.scene, g.z, g.f, g.ap);
    else if (g.type === 'object') el = S.addObject(st.scene, g.z, g.h);
    else el = S.addPoint(st.scene, g.z, g.y);
    commit();
    if (e.shiftKey) { select(el.id); updateGhost(p, e); }
    else { setTool('select'); select(el.id); }
  }

  function updateGhost(p, e) {
    var r = ghostAt(p, e);
    st.ghost = r && r.g; st.hint = r && r.hit;
    redraw();
  }

  // ---------------------------------------------------------------- dragging

  function dragTo(d, p, e) {
    var el = S.find(st.scene, d.id);
    if (!el) return;
    if (!d.moved && Math.hypot(p.px - d.start.px, p.py - d.start.py) < 3) return;
    d.moved = true;
    var w = world(p), o = snapOpt(e), r;
    st.hint = null;
    switch (d.kind) {
      case 'lens':
        r = Snap.snapLensZ(st.scene, el, w.z - d.dz, o); el.z = r.z; st.hint = r.hit; break;
      case 'object':
        r = Snap.snapAxisZ(st.scene, w.z - d.dz, el.id, o); el.z = r.z; st.hint = r.hit; break;
      case 'tip':
        r = Snap.snapHeight(w.y, o); if (r.y !== 0) el.h = r.y; break;
      case 'point':
        r = pointSnap({ z: w.z - d.dz, y: w.y - d.dy }, el.id, o);
        el.z = r.g.z; el.y = r.g.y; st.hint = r.hit; break;
      case 'aperture':
        el.ap = o.free ? Math.max(1, Math.abs(w.y)) : Math.max(o.grid, G.quantize(Math.abs(w.y), o.grid)); break;
      case 'F': case 'Fp':
        r = Snap.snapFocal(st.scene, el, d.kind, w.z, o); el.f = r.f; st.hint = r.hit;
        st.hotFocal = { id: el.id, which: d.kind }; break;
    }
    panel.sync(); redraw();
  }

  function endDrag(cancel) {
    var d = drag;
    drag = null; st.hint = null;
    if (!d || d.kind === 'pan') return;
    if (cancel) restore(hist.current());
    else if (d.moved) commit();
    redraw();
  }

  // ---------------------------------------------------------------- pointer events

  cv.addEventListener('pointerdown', function (e) {
    if (e.button === 2) return;
    cv.setPointerCapture(e.pointerId);
    var p = pos(e);
    if (e.button === 1 || spaceDown) { drag = { kind: 'pan', last: p }; cv.style.cursor = 'grabbing'; return; }
    if (st.tool !== 'select') { place(e, p); return; }
    var h = hitTest(p);
    if (!h) { select(null); drag = { kind: 'pan', last: p }; cv.style.cursor = 'grabbing'; return; }
    select(h.el.id);
    var w = world(p);
    drag = { kind: h.kind, id: h.el.id, start: p, moved: false,
      dz: w.z - h.el.z, dy: h.el.type === 'point' ? w.y - h.el.y : 0 };
  });

  cv.addEventListener('pointermove', function (e) {
    var p = pos(e), w = world(p);
    $('coords').textContent = 'z ' + w.z.toFixed(1) + ' mm   y ' + w.y.toFixed(1) + ' mm';
    if (drag && drag.kind === 'pan') {
      view.pan(p.px - drag.last.px, p.py - drag.last.py); drag.last = p; redraw(); return;
    }
    if (drag) { dragTo(drag, p, e); return; }
    if (st.tool === 'select') hover(p); else updateGhost(p, e);
  });

  cv.addEventListener('pointerup', function (e) {
    if (!drag) return;
    endDrag(false);
    if (st.tool === 'select') { st.hotFocal = null; hover(pos(e)); }
  });
  cv.addEventListener('pointercancel', function () { endDrag(true); });
  cv.addEventListener('pointerleave', function () {
    if (drag) return;
    st.ghost = null; st.hint = null; st.hover = null; st.hotFocal = null; redraw();
  });
  cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  cv.addEventListener('wheel', function (e) {
    e.preventDefault();
    var p = pos(e), dy = e.deltaY * (e.deltaMode === 1 ? 16 : 1);
    if (e.shiftKey) view.pan(-(dy || e.deltaX), 0);
    else view.zoomAt(p.px, p.py, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)));  // ctrl = trackpad pinch
    redraw();
  }, { passive: false });

  // ---------------------------------------------------------------- keyboard

  var TOOL_KEYS = { v: 'select', l: 'lens', o: 'object', p: 'point' };

  document.addEventListener('keydown', function (e) {
    if (e.target.closest && e.target.closest('input, textarea, select')) return;
    var k = e.key, mod = e.metaKey || e.ctrlKey;
    if (mod && k.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && k.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (mod && k.toLowerCase() === 's') { e.preventDefault(); saveFile(); return; }
    if (mod || e.altKey) return;
    if (k === ' ') { e.preventDefault(); if (!spaceDown) { spaceDown = true; cv.style.cursor = 'grab'; } return; }
    if (k === 'Escape') {
      if (drag) endDrag(true);
      else if (!$('help').hidden) $('help').hidden = true;
      else if (st.tool !== 'select') setTool('select');
      else select(null);
      return;
    }
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); deleteElement(st.sel); return; }
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      var el = st.sel && S.find(st.scene, st.sel);
      if (!el) return;
      e.preventDefault();
      var step = G.niceStep(view.s, 14) * (e.shiftKey ? 5 : 1);
      el.z = G.quantize(el.z + (k === 'ArrowLeft' ? -step : step), step);
      panel.sync(); commit(); redraw();
      return;
    }
    var t = TOOL_KEYS[k.toLowerCase()];
    if (t) { setTool(t); return; }
    if (k === 'f') fit();
    else if (k === '?') toggleHelp();
  });
  document.addEventListener('keyup', function (e) {
    if (e.key === ' ') { spaceDown = false; cv.style.cursor = st.tool === 'select' ? 'default' : 'crosshair'; }
  });

  // ---------------------------------------------------------------- files

  function download(name, blob) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function saveFile() {
    download('rayman-scene.json', new Blob([JSON.stringify(st.scene, null, 2)], { type: 'application/json' }));
    toast('Scene saved to your downloads.');
  }

  $('file').addEventListener('change', function () {
    var f = this.files[0];
    this.value = '';
    if (!f) return;
    f.text().then(function (txt) {
      st.scene = S.fromJSON(txt);
      select(null); commit(); fit();
      toast('Loaded ' + f.name);
    }).catch(function (err) { toast(err.message, true); });
  });

  function exportPng() {
    var k = 2, off = document.createElement('canvas');
    off.width = Math.round(W * k); off.height = Math.round(H * k);
    var c = off.getContext('2d');
    c.setTransform(k, 0, 0, k, 0, 0);
    RM.render.draw(c, W, H, { scene: st.scene, view: view, theme: st.theme });
    off.toBlob(function (b) { download('rayman.png', b); toast('Picture saved to your downloads.'); });
  }

  function newScene() {
    if (st.scene.elements.length && !window.confirm('Clear the bench? (You can undo this.)')) return;
    var s = S.create(); s.settings = st.scene.settings;
    st.scene = s; select(null); commit(); redraw();
  }

  // ---------------------------------------------------------------- chrome

  var toastTimer;
  function toast(msg, bad) {
    var t = $('toast');
    t.textContent = msg; t.classList.toggle('bad', !!bad); t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, bad ? 5000 : 2500);
  }

  function setTheme(name) {
    st.theme = name === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = st.theme;
    store(THEME_KEY, st.theme);
    redraw();
  }

  function toggleHelp() { $('help').hidden = !$('help').hidden; }

  var ACTIONS = {
    undo: undo, redo: redo, fit: fit, new: newScene, save: saveFile, png: exportPng,
    load: function () { $('file').click(); },
    theme: function () { setTheme(st.theme === 'dark' ? 'light' : 'dark'); },
    help: toggleHelp
  };
  document.querySelectorAll('[data-tool]').forEach(function (b) {
    b.addEventListener('click', function () { setTool(b.dataset.tool); });
  });
  document.querySelectorAll('header [data-act], #help [data-act]').forEach(function (b) {
    b.addEventListener('click', function () { ACTIONS[b.dataset.act](); b.blur(); });
  });

  // ---------------------------------------------------------------- start up

  setTheme(stored(THEME_KEY) || 'dark');
  new ResizeObserver(resize).observe(stage);
  resize();
  var saved = stored(STORE_KEY), restored = false;
  if (saved) {
    try { st.scene = S.fromJSON(saved); restored = st.scene.elements.length > 0; }
    catch (err) { st.scene = S.create(); }
  }
  commit();
  if (restored) fit();
  else { view.s = 3; view.ox = W * 0.35; view.oy = H / 2; }
  setTool('select');

  RM.app = { st: st, view: view, hist: hist };    // handy from the browser console
})();
