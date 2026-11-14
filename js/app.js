/* RayMan app: wires the canvas, tool strip, properties panel and keyboard together, and
   holds the interaction state (current tool, selection, what is being dragged or drawn). */
(function () {
  'use strict';
  var RM = window.RM, G = RM.geom, S = RM.scene, Snap = RM.snap, R = RM.rays;
  function $(id) { return document.getElementById(id); }

  var HIT_PX = 9;          // how close the pointer must be to grab something
  var RAY_HIT_PX = 6;      // ... to pick a ray
  var SNAP_PX = 12;        // how close counts as "lined up" when snapping
  var DOUBLE_MS = 450;     // two clicks this close together make a double-click
  var STORE_KEY = 'rayman.scene.v1', THEME_KEY = 'rayman.theme';

  var cv = $('cv'), ctx = cv.getContext('2d'), stage = $('stage');
  var view = new RM.View();
  var st = {                // everything the renderer needs
    scene: S.create(), view: view, theme: 'light', tool: 'select',
    sel: null, hover: null, ghost: null, hints: null, hotFocal: null, axisHot: false,
    draft: null, caption: null
  };
  var hist = new S.History();
  var drag = null, drawing = null, lastPlaced = null;
  var spaceDown = false, W = 0, H = 0, queued = false, lastF = S.DEFAULT_F, lastPos = null;

  var panel = new RM.Panel($('props'), {
    onBeforeChange: function () { stopScan(true); beforeEdit(); },
    onLive: redraw,
    onCommit: commit,
    onDelete: deleteThing,
    onClose: function () { select(null); },
    onScan: toggleScan,
    onColour: function (t) {                              // a beam's rays always take the beam's colour
      if (t.type === 'beam' || t.type === 'point') st.real.rays.forEach(function (q) { if (beamOf(q) === t) q.color = null; });
    },
    scanning: function (id) { return !!scan && scan.id === id; }
  });

  var RAY_COLOUR_KEY = 'rayman.rayColour';
  st.rayColour = stored(RAY_COLOUR_KEY) || null;           // colour for new rays (null = default)
  st.helper = false;                                         // the Ray tool draws helper rays

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

  /** Fit every axis, with its elements and rays, in view, keeping clear of the properties panel. */
  function fit() {
    var props = $('props'), right = props.hidden ? 0 : props.offsetWidth + 20, b = null;
    function take(z, y) {
      b = b || { z0: z, z1: z, y0: y, y1: y };
      b.z0 = Math.min(b.z0, z); b.z1 = Math.max(b.z1, z); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y);
    }
    S.axes(st.real).forEach(function (ax) {
      var v = S.axisView(st.real, ax.id), bb = S.bounds(v), sol = R.solveScene(v), solved = sol.rays;
      sol.images.forEach(function (im) { take(im.z, ax.y + im.y); take(im.z, ax.y); });
      take(bb ? bb.z0 : 0, ax.y - 10); take(bb ? bb.z1 : 0, ax.y + 10);
      if (bb) { take(bb.z0, ax.y + bb.y0); take(bb.z1, ax.y + bb.y1); }
      v.rays.forEach(function (r) {
        solved[r.id].pts.forEach(function (p) {
          if (Math.abs(p.z) < R.FAR / 2) take(p.z, ax.y + p.y);       // not rays running off to the edge
        });
      });
    });
    if (b && b.z1 - b.z0 < 40) { b.z0 -= 60; b.z1 += 140; }
    view.fit(b || { z0: -60, z1: 140, y0: -30, y1: 30 }, W - right, H);
    redraw();
  }

  /** Clear every transient highlight. */
  function clearHints() {
    st.hints = null; st.axisHot = false; st.hotFocal = null; st.caption = null; st.ghost = null;
  }

  // ---------------------------------------------------------------- history

  /** Record the scene as an undo step (no-op if unchanged) and autosave it. */
  function commit() {
    var e = st.sel && S.find(st.real, st.sel);
    if (e && e.type === 'lens') lastF = e.f;
    var m = scan && S.find(st.real, scan.id), live = m && m.tilt;   // record a scanning mirror at rest
    if (m) m.tilt = scan.base;
    if (hist.push(S.toJSON(st.real))) store(STORE_KEY, hist.current());
    if (m) m.tilt = live;
    updateButtons();
  }

  function setScene(s) {
    st.real = S.ensureAxis(s);
    if (!st.axis || !S.find(st.real, st.axis)) st.axis = null;
    useAxis(st.axis || (S.axes(st.real)[0] || {}).id || null);
    if (st.sel && !S.find(st.real, st.sel)) st.sel = null;
    showSelection();
    $('set-follow').checked = st.real.settings.follow;
    $('set-virtual').checked = st.real.settings.virtual !== false;
    syncHints();
    syncFill();
  }

  function restore(snap) {
    stopScan(true);
    setScene(S.fromJSON(snap));
    drawing = null; st.draft = null;
    store(STORE_KEY, snap);
    updateButtons(); redraw();
  }
  function undo() { var s = hist.undo(); if (s) restore(s); }
  function redo() { var s = hist.redo(); if (s) restore(s); }

  function updateButtons() {
    document.querySelector('[data-act=undo]').disabled = !hist.canUndo();
    document.querySelector('[data-act=redo]').disabled = !hist.canRedo();
  }

  /** Call before changing the optics: with following off, freeze the rays (on every axis) where they are. */
  function beforeEdit() {
    if (st.real.settings.follow) return;
    S.axes(st.real).forEach(function (ax) { R.bakeAll(S.axisView(st.real, ax.id)); });
  }

  // ---------------------------------------------------------------- optical axes
  // Every element and ray belongs to an optical axis and is stored relative to it. Interaction
  // works on one axis at a time: st.scene is a live view of it (see scene.js), and positions
  // from the pointer are measured from it. It is the axis nearest the pointer, or the one that
  // owns whatever is being drawn or dragged. st.real is the whole scene.

  /** Work on axis id from now on. */
  function useAxis(id) {
    st.axis = id;
    st.scene = S.axisView(st.real, id);
  }
  /** The height of the current axis. */
  function ay() { var a = st.axis && S.find(st.real, st.axis); return a ? a.y : 0; }
  /** Screen y of a height measured from the current axis. */
  function sy(y) { return view.Y(y + ay()); }
  /** The axis nearest screen point p, or null if there are none. */
  function nearestAxis(p) {
    var best = null, bestD = Infinity;
    S.axes(st.real).forEach(function (a) {
      var d = Math.abs(view.Y(a.y) - p.py);
      if (d < bestD) { bestD = d; best = a.id; }
    });
    return best;
  }
  /** Give a new element or ray to the current axis. */
  function adopt(x) { x.axis = st.axis; return x; }

  /** Delete an optical axis and everything on it, asking first if anything is on it. */
  function deleteAxis(id) {
    var on = st.real.elements.some(function (e) { return e.axis === id; }) || st.real.rays.some(function (r) { return r.axis === id; });
    function go() {
      st.real.elements = st.real.elements.filter(function (e) { return e.id !== id && e.axis !== id; });
      st.real.rays = st.real.rays.filter(function (r) { return r.axis !== id; });
      if (st.axis === id) useAxis((S.axes(st.real)[0] || {}).id || null);
      select(null); commit(); redraw();
    }
    if (on) ask(go, 'Delete this optical axis?', 'Everything on it (lenses, objects, rays…) goes too. You can undo it with ⌘Z.', 'Delete');
    else go();
  }

  // ---------------------------------------------------------------- selection and tools

  function select(id) {
    st.sel = id;
    showSelection();
    redraw();
  }

  var ROLE_TITLE = { parallel: 'Parallel ray', focal: 'Focal ray', central: 'Central ray' };

  /** Elements get the properties panel. A selected ray gets no panel (it would be in the way
      while drawing): the hint pill says what kind of ray it is instead. */
  function showSelection() {
    var x = st.sel && S.find(st.real, st.sel);
    if (S.isRay(x)) {
      panel.hide();
      var role = R.solveScene(S.axisView(st.real, x.axis)).roles[x.id];
      showHint(x.helper ? 'Helper ray' : ROLE_TITLE[role] || 'Ray', 'Delete removes its last segment · colour: the corner of the Ray tool');
    } else {
      panel.show(x);
      var tip = st.tool === 'ray' && st.helper ? HELPER_HINT : TOOL_HINTS[st.tool];
      showHint(tip[0], tip[1]);
    }
    var del = document.querySelector('#rail [data-act=delete]');
    if (del) del.disabled = !x;
    var rev = document.querySelector('#rail [data-act=reverse]');
    if (rev) rev.disabled = !S.isRay(x);
    var cp = document.querySelector('#rail [data-act=copy]');
    if (cp) cp.disabled = !x || S.isRay(x) || x.type === 'axis';
    syncRayColour();
  }

  /** Delete an element or a ray. Rays pinned to it keep their shape but become free. */
  function deleteThing(id) {
    var x = id && S.find(st.real, id);
    if (!x) return;
    if (x.type === 'axis') { deleteAxis(id); return; }
    useAxis(x.axis);
    if (x.type === 'beam') {                               // a beam's own rays go with it
      st.real.rays = st.real.rays.filter(function (r) { return !(r.start.at && r.start.at.el === id); });
    }
    if (scan && scan.id === id) stopScan();
    R.bakeRefsTo(st.scene, id, S.remove);
    S.remove(st.real, id);
    select(null); commit();
  }

  /** Remove the last segment of a ray, or the ray once nothing is left. A line through a lens
      centre and straight on is one segment, so both parts go together. */
  function trimRay(id) {
    var r = S.find(st.real, id);
    if (!S.isRay(r)) return;
    useAxis(r.axis);
    var s = R.solveAll(st.scene)[id], N = r.nodes.length, drop = 1;
    while (drop < N && R.isJoint(st.scene, r, s, N - drop)) drop++;
    var beamRay = N > 0 && r.nodes[0].dir.kind === 'beam';  // a beam's three rays are part of the beam:
    if (beamRay && N - drop < 1) drop = N - 1;              // its first piece (to the lens) always stays
    if (beamRay && drop < 1) { toast('This ray is part of its beam: delete the beam to remove it.'); return; }
    if (drop >= N) { deleteThing(id); return; }
    var keep = N - drop, first = keep + 1;             // nodes kept; first point removed
    R.bakeBefore(st.scene, function (sc) { S.find(sc, id).nodes.length = keep; },
      function (ref) { return ref.ray === id && (ref.k >= first || ref.seg >= first - 1); });
    r = S.find(st.real, id);
    r.nodes.length = keep;
    commit(); showSelection(); redraw();
  }

  /** Reverse the selected ray: same line, light running the other way. Its old start becomes
      its end, so drawing can carry on from there. */
  function reverseSelected() {
    var r = S.find(st.real, st.sel);
    if (!S.isRay(r)) return;
    useAxis(r.axis);
    if (R.reverseRay(st.scene, r)) { commit(); showSelection(); redraw(); toast('Ray reversed.'); }
    else toast('This ray cannot be reversed (it is cut short).', true);
  }

  /** Copy the selected component: it then follows the cursor as a ghost, to be pasted with a
      click (Shift-click for several). ⌘V brings the ghost back to paste again. */
  var clip = null;
  function copySelected() {
    var x = S.find(st.real, st.sel);
    if (!x || S.isRay(x) || x.type === 'axis') return;
    clip = JSON.parse(JSON.stringify(x));
    clip.copyOf = { id: x.id, z: x.z, y: x.y };           // so its rays can be copied with it
    delete clip.id; delete clip.axis;
    setTool('paste');
    toast('Copied: click to paste (Shift-click for several, Esc to stop).');
  }
  function pasteMode() { if (clip) setTool('paste'); }

  /** Delete key: a ray loses its last segment; anything else is deleted. */
  function deleteKey() {
    if (S.isRay(S.find(st.real, st.sel))) trimRay(st.sel);
    else deleteThing(st.sel);
  }

  var TOOL_HINTS = {
    select: ['Select', 'drag lenses, objects, F and F′ · drag empty space to pan · scroll to zoom · Alt: no snapping'],
    lens: ['Thin lens', 'click to place on the axis · Shift-click to place several · Esc to stop'],
    object: ['Object', 'click where the arrow tip should be · Esc to stop'],
    point: ['Point source', 'click to place · Esc to stop'],
    mirror: ['Scan mirror', 'click to place on the axis · Esc to stop'],
    iris: ['Iris', 'click to place on the axis (it lines up with focal points and images) · Esc to stop'],
    axis: ['Optical axis', 'click to add an optical axis at that height · Esc to stop'],
    paste: ['Paste', 'click to put down a copy · Shift-click for several · Esc to stop · ⌘V to paste again later'],
    beam: ['Collimated beam', 'click to place; it snaps onto the axis · Esc to stop'],
    filament: ['Lamp filament', 'click to place on the axis; drag its ends to set how far it reaches above and below · Esc to stop'],
    ray: ['Ray', 'click to start · click a ray’s end to continue · double-click to extend · Alt: no snapping · Esc cancels']
  };
  var HELPER_HINT = ['Helper ray', 'dashed construction line: start at a lens centre and draw parallel to a ray · H / R switch kinds'];

  function setTool(t) {
    st.tool = t; st.hover = null; drawing = null; st.draft = null;
    clearHints();
    document.querySelectorAll('[data-tool]').forEach(function (b) {
      b.classList.toggle('on', b.dataset.tool === t);
    });
    showSelection();
    cv.style.cursor = t === 'select' ? 'default' : 'crosshair';
    redraw();
  }

  /** The hint pill: a bold title and a line of help. */
  function showHint(title, help) {
    var h = $('hint'), b = document.createElement('b');
    h.textContent = ''; b.textContent = title;
    h.appendChild(b); h.appendChild(document.createTextNode(help));
  }

  // ---------------------------------------------------------------- pointer geometry

  function pos(e) {
    var r = cv.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  }
  /** Pointer position on the bench, measured from the current optical axis. */
  function world(p) { return { z: view.z(p.px), y: view.y(p.py) - ay() }; }

  function snapOpt(e) {
    return { tol: SNAP_PX / view.s, grid: G.niceStep(view.s, 14), free: e.altKey };
  }

  /** Screen distance from p to the ray, or Infinity. */
  function rayDistPx(p, pts) {
    var best = Infinity, w = world(p);
    for (var i = 0; i + 1 < pts.length; i++) best = Math.min(best, G.distToSegment(w, pts[i], pts[i + 1]) * view.s);
    return best;
  }

  /** What is under screen point p (Select tool)? Topmost and smallest things win. */
  function hitTest(p) {
    // try each axis, nearest first; whatever is hit decides the axis we work on
    var list = S.axes(st.real).slice().sort(function (a, b) { return Math.abs(view.Y(a.y) - p.py) - Math.abs(view.Y(b.y) - p.py); });
    var keep = st.axis;
    for (var i = 0; i < list.length; i++) {
      useAxis(list[i].id);
      var h = hitAxis(p);
      if (h) return h;
    }
    for (i = 0; i < list.length; i++) {                  // an axis line itself (where nothing else is)
      if (Math.abs(view.Y(list[i].y) - p.py) <= 5) { useAxis(list[i].id); return { el: list[i], kind: 'axis' }; }
    }
    useAxis(keep && S.find(st.real, keep) ? keep : (list[0] || {}).id || null);
    return null;
  }

  /** What is under p on the current axis? */
  function hitAxis(p) {
    var w = world(p), tol = HIT_PX / view.s, els = st.scene.elements, i, e;
    var sel = st.sel && S.find(st.real, st.sel);       // the selected iris's edge handles come first
    if (sel && sel.type === 'iris' && Math.abs(w.z - sel.z) <= 1.5 * tol && Math.abs(Math.abs(w.y) - sel.r) <= tol) {
      return { el: sel, kind: 'irisEdge' };
    }
    for (i = els.length - 1; i >= 0; i--) {
      e = els[i];
      if (e.type === 'point' && G.dist(w, { z: e.z, y: e.y }) <= 1.5 * tol) return { el: e, kind: 'point' };
    }
    for (i = els.length - 1; i >= 0; i--) {
      e = els[i];
      if (e.type === 'object' && G.dist(w, { z: e.z, y: e.h }) <= 1.5 * tol) return { el: e, kind: 'tip' };
      if (e.type === 'filament' && Math.abs(w.z - e.z) <= 1.5 * tol) {
        if (Math.abs(w.y - e.top) <= 1.5 * tol) return { el: e, kind: 'filTop' };
        if (Math.abs(w.y - e.bottom) <= 1.5 * tol) return { el: e, kind: 'filBot' };
      }
    }
    var lensesSelectedLast = els.filter(function (x) { return x.type === 'lens'; })
      .sort(function (a, b) { return (a.id === st.sel) - (b.id === st.sel); });   // selected is tried first
    for (i = lensesSelectedLast.length - 1; i >= 0; i--) {
      e = lensesSelectedLast[i];
      var fp = G.focalPoints(e);
      if (G.dist(w, { z: fp.Fp, y: 0 }) <= tol) return { el: e, kind: 'Fp' };
      if (G.dist(w, { z: fp.F, y: 0 }) <= tol) return { el: e, kind: 'F' };
    }
    for (i = els.length - 1; i >= 0; i--) {                // a beam's source bar (before its own rays)
      e = els[i];
      if (e.type !== 'beam') continue;
      var ba = e.angle * Math.PI / 180, bh = e.width / 2;
      if (G.distToSegment(w, { z: e.z - bh * Math.sin(ba), y: e.y + bh * Math.cos(ba) },
        { z: e.z + bh * Math.sin(ba), y: e.y - bh * Math.cos(ba) }) <= tol) return { el: e, kind: 'beam' };
    }
    var handle = rayHandleAt(p);
    if (handle) return handle;
    var solved = R.solveAll(st.scene);
    for (i = st.scene.rays.length - 1; i >= 0; i--) {
      var r = st.scene.rays[i];
      if (rayDistPx(p, solved[r.id].shown) <= RAY_HIT_PX) return { el: r, kind: 'ray' };
    }
    for (i = els.length - 1; i >= 0; i--) {
      e = els[i];
      if (e.type === 'object' && G.distToSegment(w, { z: e.z, y: 0 }, { z: e.z, y: e.h }) <= tol) return { el: e, kind: 'object' };
      if (e.type === 'filament' && Math.abs(w.z - e.z) <= 1.5 * tol && w.y < e.top && w.y > e.bottom) return { el: e, kind: 'filament' };
    }
    for (i = els.length - 1; i >= 0; i--) {
      e = els[i];
      if (e.type === 'mirror' && Math.abs(w.z - e.z) <= 1.5 * tol && Math.abs(w.y) <= e.ap + tol) return { el: e, kind: 'mirror' };
      if (e.type === 'iris' && Math.abs(w.z - e.z) <= 1.5 * tol) {
        var ay2 = Math.abs(w.y);
        if (Math.abs(ay2 - e.r) <= tol) return { el: e, kind: 'irisEdge' };       // the edge of the opening
        if (ay2 > e.r && ay2 <= e.ap + tol) return { el: e, kind: 'iris' };      // a blade (the opening lets clicks through)
      }
    }
    var head = 6 / view.s;
    for (i = els.length - 1; i >= 0; i--) {
      e = els[i];
      if (e.type !== 'lens' || Math.abs(w.z - e.z) > tol) continue;
      var ay = Math.abs(w.y);
      if (ay >= e.ap - tol && ay <= e.ap + head) return { el: e, kind: 'aperture' };
      if (ay < e.ap) return { el: e, kind: 'lens' };
    }
    return null;
  }

  var CURSORS = { point: 'move', tip: 'ns-resize', aperture: 'ns-resize', F: 'ew-resize', Fp: 'ew-resize',
    object: 'ew-resize', lens: 'ew-resize', mirror: 'ew-resize', ray: 'pointer',
    rayStart: 'move', rayEnd: 'move', rayMid: 'move', iris: 'ew-resize', irisEdge: 'ns-resize',
    filament: 'ew-resize', filTop: 'ns-resize', filBot: 'ns-resize', axis: 'ns-resize', beam: 'move' };

  /** Where the images and foci are, as extra places for irises and mirrors to line up with. */
  function imageKeys() {
    return R.solveScene(st.scene).images.map(function (im) {
      return { value: im.z, text: im.focus ? 'the focus' : im.virtual ? 'the virtual image' : 'the image' };
    });
  }

  /** A ray point under p that the Select tool can drag: a free start, a free point along the
      way, or the end of the ray (unless it is drawn ending at its image). Pinned points belong
      to what they are pinned to and are not handles. */
  function rayHandleAt(p) {
    var solved = R.solveAll(st.scene), best = null, bestD = HIT_PX;
    st.scene.rays.forEach(function (r) {
      var s = solved[r.id], N = r.nodes.length;
      s.pts.forEach(function (q, k) {
        var kind = null;
        if (k === 0) kind = r.start.at ? null : 'rayStart';
        else if (k === N) kind = !s.trimmed && r.nodes[k - 1].end.kind === 'z' ? 'rayEnd' : null;
        else if (r.nodes[k - 1].end.kind === 'z' && r.nodes[k - 1].dir.kind === 'free' && !R.isJoint(st.scene, r, s, k)) kind = 'rayMid';
        if (!kind || Math.abs(q.z) > R.FAR / 2) return;
        var d = Math.hypot(view.X(q.z) - p.px, sy(q.y) - p.py) - (r.id === st.sel ? 1 : 0);
        if (d <= bestD) { bestD = d; best = { el: r, kind: kind, k: k }; }
      });
    });
    return best;
  }

  /** Hovering over a lens shows its 2F and 3F marks. After the cursor leaves the lens they
      stay for 750 ms, then fade out over the next 500 ms. */
  var marksLeft = null;
  function lensMarks(h) {
    if (h && h.el.type === 'lens') {
      marksLeft = null; st.marksFade = 1;
      if (st.lensMarks !== h.el.id) { st.lensMarks = h.el.id; redraw(); }
    } else if (st.lensMarks && marksLeft === null) {
      marksLeft = performance.now();
      requestAnimationFrame(fadeMarks);
    }
  }
  function fadeMarks(now) {
    if (marksLeft === null) return;                      // back over a lens
    var t = now - marksLeft;
    st.marksFade = Math.max(0, Math.min(1, 1 - (t - 750) / 500));
    if (t >= 1250) { st.lensMarks = null; marksLeft = null; st.marksFade = 1; }
    else requestAnimationFrame(fadeMarks);
    redraw();
  }

  function hover(p) {
    var h = hitTest(p);
    lensMarks(h);
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
    if (st.tool === 'paste' && clip) {                  // a copy, snapping as its kind does
      var c = JSON.parse(JSON.stringify(clip)), hit;
      if (c.type === 'lens') r = Snap.snapLensZ(st.scene, c, w.z, o);
      else if (c.type === 'mirror' || c.type === 'iris') { o.extra = imageKeys(); r = Snap.snapAxisZ(st.scene, w.z, null, o); }
      else r = Snap.snapObjectZ(st.scene, w.z, null, o);
      c.z = r.z; hit = r.hit;
      var pre = { lens: 'L', mirror: 'M', iris: 'A' }[c.type];        // show the name it will get
      if (pre && new RegExp('^' + pre + '\\d+$').test(c.label)) c.label = S.nextLabel(st.real, c.type, pre, st.axis);
      if (c.type === 'point') c.y = Snap.snapHeight(w.y, o).y;
      if (c.type === 'beam') { var cb = beamY(w.y, c, o); c.y = cb.y; hit = cb.hit || hit; }
      return { g: c, hit: hit };
    }
    if (st.tool === 'axis') {
      var y = view.y(p.py);
      return { g: { type: 'axis', y: o.free ? y : G.quantize(y, o.grid) }, hit: null };
    }
    if (st.tool === 'lens') {
      var g = { id: null, type: 'lens', z: 0, f: lastF, ap: S.DEFAULT_AP, label: '' };
      r = Snap.snapLensZ(st.scene, g, w.z, o); g.z = r.z;
      return { g: g, hit: r.hit };
    }
    if (st.tool === 'object') {
      r = Snap.snapObjectZ(st.scene, w.z, null, o);
      var h = Snap.snapHeight(w.y, o).y;
      return { g: { type: 'object', z: r.z, h: h === 0 ? S.DEFAULT_H : h, label: '', color: null }, hit: r.hit };
    }
    if (st.tool === 'point') return pointSnap(w, null, o);
    if (st.tool === 'beam') {
      r = Snap.snapObjectZ(st.scene, w.z, null, o);
      var by = beamY(w.y, { z: r.z, angle: 0, id: null }, o);
      return { g: { type: 'beam', z: r.z, y: by.y, width: 20, angle: 0, label: '', color: null }, hit: by.hit || r.hit };
    }
    if (st.tool === 'filament') {
      r = Snap.snapObjectZ(st.scene, w.z, null, o);
      return { g: { type: 'filament', z: r.z, top: 8, bottom: -8, label: '', color: null }, hit: r.hit };
    }
    if (st.tool === 'mirror' || st.tool === 'iris') {
      o.extra = imageKeys();
      r = Snap.snapAxisZ(st.scene, w.z, null, o);
      return { g: st.tool === 'mirror' ? { type: 'mirror', z: r.z, tilt: 0, range: 5, ap: 15, label: '' }
        : { type: 'iris', z: r.z, r: 10, ap: 30, label: '' }, hit: r.hit };
    }
    return null;
  }

  /** Snap the height of a beam's centre: onto the axis, or so that its middle ray goes through
      the centre of a lens ahead of it; else to the grid. */
  function beamY(rawY, b, o) {
    if (o.free) return { y: rawY, hit: null };
    var u = Math.tan(b.angle * Math.PI / 180), cands = [{ value: 0, text: 'on the axis' }];
    st.scene.elements.forEach(function (L) {
      if (L.type === 'lens' && L.z > b.z) cands.push({ value: -u * (L.z - b.z), text: 'middle ray through the centre of ' + (L.label || 'the lens'), z: L.z });
    });
    var k = G.nearest1D(rawY, cands, o.tol);
    if (k) return { y: k.value, hit: { z: k.z != null ? k.z : b.z, y: 0, text: k.text } };
    return { y: G.quantize(rawY, o.grid), hit: null };
  }

  /** Snap a point source position (z on key points/grid, y onto the axis/grid). */
  function pointSnap(w, id, o) {
    var rz = Snap.snapObjectZ(st.scene, w.z, id, o), ry = Snap.snapHeight(w.y, o);
    var hit = rz.hit ? { z: rz.z, y: ry.y, text: rz.hit.text + (ry.y === 0 ? ', on the axis' : ''), dim: rz.hit.dim }
      : ry.hit ? { z: rz.z, y: 0, text: 'on the axis' } : null;
    return { g: { type: 'point', z: rz.z, y: ry.y, label: '' }, hit: hit };
  }

  function place(e, p) {
    var r = ghostAt(p, e), g = r.g, el;
    if (g.type === 'axis') el = S.addAxis(st.real, g.y);
    else if (!st.axis) { toast('Add an optical axis first (X).'); return; }
    else if (st.tool === 'paste') el = S.copyElement(st.real, g, st.axis, g.z, g.y);
    else if (g.type === 'lens') el = adopt(S.addLens(st.real, g.z, g.f, g.ap, st.axis));
    else if (g.type === 'object') el = adopt(S.addObject(st.real, g.z, g.h));
    else if (g.type === 'mirror') el = adopt(S.addMirror(st.real, g.z, st.axis));
    else if (g.type === 'iris') el = adopt(S.addIris(st.real, g.z, st.axis));
    else if (g.type === 'filament') el = adopt(S.addFilament(st.real, g.z));
    else if (g.type === 'beam') el = S.addBeam(st.real, g.z, g.y, st.axis);
    else el = adopt(S.addPoint(st.real, g.z, g.y));
    commit();
    if (e.shiftKey) { select(el.id); updateGhost(p, e); }
    else { setTool('select'); select(el.id); }
  }

  function setHint(hit, p) {
    st.hints = hit && hit.z != null ? [hit] : null;
    st.caption = hit && hit.text ? { x: p.px, y: p.py, text: hit.text } : null;
  }

  function updateGhost(p, e) {
    var r = ghostAt(p, e);
    st.ghost = r && r.g; setHint(r && r.hit, p);
    redraw();
  }

  // ---------------------------------------------------------------- drawing rays

  /** The ray point under screen point p, preferring the open end of a ray: { ray, k, last, p }.
      The end of a ray drawn as stopping at its image is not an open end. */
  /** A ray's colour as drawn when hints are off: its own, else its beam's, else null (default). */
  function colourOf(r) {
    var o = !r.helper && R.owner(st.real, r);           // owned rays take their owner's colour
    if (o) return o.color ? o.color.toLowerCase() : null;
    return r.color ? r.color.toLowerCase() : null;
  }

  /** The ray point under p. Where several rays have a point in the same place (two beams hitting
      a lens at the same three points), the one in the colour of the ray about to be drawn wins. */
  function rayNodeAt(p) {
    var solved = R.solveAll(st.scene), best = null, bestD = HIT_PX;
    var want = st.rayColour ? st.rayColour.toLowerCase() : null;
    function match(r) { return colourOf(r) === want; }
    st.scene.rays.forEach(function (r) {
      var s = solved[r.id], pts = s.trimmed ? s.pts.slice(0, -1) : s.pts;
      pts.forEach(function (q, k) {
        if (R.isJoint(st.scene, r, s, k)) return;               // not a place a ray can bend or branch
        var d = Math.hypot(view.X(q.z) - p.px, sy(q.y) - p.py), last = !s.trimmed && k === pts.length - 1;
        if (last) d -= 2;                                       // ends win ties
        var better = !best ? d <= bestD : d < bestD - 0.5 || (Math.abs(d - bestD) <= 0.5 && match(r) && !match(best.ray));
        if (better) { bestD = d; best = { ray: r, k: k, last: last, p: q }; }
      });
    });
    return best;
  }

  /** Can this ray be continued from its end? Not if it runs off to the edge or was cut short. */
  function continuable(r) {
    var n = r.nodes[r.nodes.length - 1], s = R.solveAll(st.scene)[r.id];
    return s.ok && (!n || n.end.kind !== 'edge');
  }

  /** Where the end of a ray passes straight through a lens (one put in its path after it was
      drawn), under screen point p: { ray, lens, p } or null. Clicking there stops the ray at
      the lens, keeping its angle, and carries on drawing from there. */
  function crossingAt(p) {
    var sol = R.solveScene(st.scene), best = null, bestD = HIT_PX;
    st.scene.rays.forEach(function (r) {
      R.crossings(st.scene, r, sol.rays[r.id]).forEach(function (c) {
        var d = Math.hypot(view.X(c.p.z) - p.px, sy(c.p.y) - p.py);
        if (d <= bestD) { bestD = d; best = { ray: r, lens: c.lens, p: c.p }; }
      });
    });
    return best;
  }

  /** Ray tool, not drawing: show where a click would start or continue a ray. */
  /** Is there a real or virtual image (not a focus) under screen point p? */
  function imageAt(p) {
    return R.solveScene(st.scene).images.some(function (im) {
      return !im.focus && Math.hypot(view.X(im.z) - p.px, sy(im.y) - p.py) <= HIT_PX;
    });
  }
  /** Continue the ray whose end is under p? Not on an image (unless Shift is held): there a
      click starts a new ray from the image, the object for the next lens. */
  function continuesAt(hit, p, e) {
    return hit && hit.last && continuable(hit.ray) && (e.shiftKey || !imageAt(p));
  }
  /** A ray drawn ending at the real image under p (it runs on past it, hidden, so the image
      keeps forming): { ray, im } or null. Shift-click there carries that ray on past the image.
      The ray in the colour about to be drawn wins. */
  function imageRayAt(p) {
    var sol = R.solveScene(st.scene), want = st.rayColour ? st.rayColour.toLowerCase() : null, best = null;
    sol.images.forEach(function (im) {
      if (im.virtual || im.focus || Math.hypot(view.X(im.z) - p.px, sy(im.y) - p.py) > HIT_PX) return;
      im.rays.forEach(function (rr) {
        var r = S.find(st.real, rr.ray), s = sol.rays[rr.ray];
        if (!r || !s || !s.trimmed || rr.k !== s.pts.length - 2) return;
        if (!best || (colourOf(r) === want && colourOf(best.ray) !== want)) best = { ray: r, im: im };
      });
    });
    return best;
  }

  function rayHover(p, e) {
    var hit = rayNodeAt(p), cross = crossingAt(p), txt, at, thru;
    if (cross) { at = cross.p; txt = 'stop this ray at ' + (cross.lens.label || 'the lens') + ' and carry on'; }
    else if (continuesAt(hit, p, e)) { at = hit.p; txt = 'continue this ray'; }
    else if (e.shiftKey && (thru = imageRayAt(p))) { at = { z: thru.im.z, y: thru.im.y }; txt = 'carry this ray on past the image'; }
    else {
      var s = R.proposeStart(st.scene, R.solveScene(st.scene), world(p), snapOpt(e));
      at = s.start.at || s.text ? s.p : null;
      txt = s.start.at ? s.text.replace(/^from a point on a ray$/, 'branch from this ray') : s.text;
    }
    if (!cross && !e.shiftKey && txt && imageAt(p) && (hit && hit.last && continuable(hit.ray) || imageRayAt(p))) txt += ' (Shift: continue a ray through it)';
    st.draft = null;
    st.hints = at ? [{ z: at.z, y: at.y, text: '' }] : null;
    st.caption = txt ? { x: p.px, y: p.py, text: txt } : null;
    redraw();
  }

  /** Ray tool click when not drawing: extend (double-click), continue, or start a ray. */
  function rayClick(e, p, dbl) {
    var placed = lastPlaced;
    lastPlaced = null;
    if (dbl && placed && extendLast(placed)) return;     // double-click just after placing: extend it
    var cross = crossingAt(p);
    if (cross && R.cutAt(st.scene, cross.ray, cross.lens)) {    // stop it at the lens in its path, carry on
      commit();
      drawing = { ray: cross.ray.id, start: null };
      select(drawing.ray);
      rayMove(p, e);
      return;
    }
    var hit = rayNodeAt(p), thru = !continuesAt(hit, p, e) && e.shiftKey && imageRayAt(p);
    if (thru && R.cutAt(st.scene, thru.ray, null, thru.im.z)) {   // stop it at its image, carry on from there
      commit();
      drawing = { ray: thru.ray.id, start: null };
      select(drawing.ray);
      rayMove(p, e);
      return;
    }
    if (continuesAt(hit, p, e)) {
      drawing = { ray: hit.ray.id, start: null };
    } else {
      var s = R.proposeStart(st.scene, R.solveScene(st.scene), world(p), snapOpt(e));
      drawing = { ray: null, start: s.start, p: s.p };
    }
    select(drawing.ray);
    rayMove(p, e);
  }

  /** Where the ray being drawn currently ends, and the point before that. */
  function drawingTail() {
    if (!drawing.ray) return { P: drawing.p, Q: null };
    var pts = R.solveAll(st.scene)[drawing.ray].pts, n = pts.length;
    return { P: pts[n - 1], Q: n > 1 ? pts[n - 2] : null };
  }

  /** Rubber-band the next segment toward the cursor. */
  function rayMove(p, e) {
    var ray = drawing.ray && S.find(st.real, drawing.ray);
    var opt = snapOpt(e); opt.self = drawing.ray; opt.helper = ray ? ray.helper : st.helper;
    opt.inDir = ray && ray.nodes.length ? ray.nodes[ray.nodes.length - 1].dir : null;        // how it came in
    var t = drawingTail(), prop = R.proposeSegment(st.scene, R.solveScene(st.scene), t.P, t.Q, world(p), opt);
    drawing.prop = prop;
    var own = ray ? (!ray.helper && R.owner(st.real, ray))                 // whose colour it will take
      : !st.helper && drawing.start && drawing.start.at && drawing.start.at.el && S.find(st.real, drawing.start.at.el);
    if (own && own.type !== 'point' && own.type !== 'beam') own = null;
    st.draft = { from: t.P, pts: prop && prop.pts, color: own ? own.color : ray ? colourOf(ray) : st.rayColour,   // as it will be drawn
      ownerType: own ? own.type : null,
      role: ray && !ray.helper && st.real.settings.colour ? R.solveScene(st.scene).roles[ray.id] : null,
      helper: ray ? ray.helper : st.helper };
    st.hints = prop ? prop.hints : null;
    st.axisHot = !!(prop && prop.axis);
    var at = prop && prop.node.dir.at;
    st.hotFocal = at && (at.pt === 'F' || at.pt === 'Fp') ? { id: at.el, which: at.pt } : null;
    st.caption = prop && prop.text ? { x: p.px, y: p.py, text: prop.text } : null;
    redraw();
  }

  /** Place the proposed segment; drawing stops (click the end to carry on). */
  function rayPlace(p, dbl) {
    var prop = drawing.prop;
    if (!prop) {                                         // clicked on the start point itself
      if (dbl && drawing.ray) { var id = drawing.ray; cancelDrawing(); extendLast(id); }
      return;
    }
    var r = drawing.ray ? S.find(st.real, drawing.ray) : adopt(S.addRay(st.real, drawing.start, st.helper));
    if (!drawing.ray) r.color = st.rayColour;
    Array.prototype.push.apply(r.nodes, prop.nodes);
    R.extendToImages(st.scene, SNAP_PX / view.s);          // keep newly formed images forming
    commit();
    lastPlaced = r.id;
    drawing = null; st.draft = null; clearHints();
    select(r.id);
  }

  /** Lengthen a ray's last segment to the next lens, or to the edge. False if it can't be. */
  function extendLast(id) {
    var r = S.find(st.real, id);
    if (!S.isRay(r) || !r.nodes.length) return false;
    useAxis(r.axis);
    var pts = R.solveAll(st.scene)[id].pts, n = pts.length;
    var node = R.extendNode(st.scene, r.nodes[r.nodes.length - 1], pts[n - 2], pts[n - 1], SNAP_PX / view.s, r.helper);
    if (!node) return false;
    R.bake(st.scene, R.tailRefs(id, n - 1));
    r.nodes[r.nodes.length - 1] = node;
    select(id); commit(); redraw();
    return true;
  }

  function cancelDrawing() {
    drawing = null; st.draft = null; clearHints(); redraw();
  }

  // ---------------------------------------------------------------- dragging

  /** Drag a ray's free point. The end is re-drawn with the usual snapping (as if drawing that
      segment again); a free start or a free point along the way just moves, snapped to the grid.
      Whatever is drawn on from the point follows. */
  function dragRayPoint(d, r, p, e) {
    var w = world(p), o = snapOpt(e), sol = R.solveScene(st.scene);
    o.self = r.id; o.helper = r.helper; o.keep = d.keep;
    clearHints();
    if (d.kind === 'rayStart') {
      var s = R.proposeStart(st.scene, sol, w, o);
      r.start = s.start;
      st.hints = [{ z: s.p.z, y: s.p.y, text: '' }];
      if (s.text) st.caption = { x: p.px, y: p.py, text: s.text };
    } else if (d.kind === 'rayMid') {
      var z = o.free ? w.z : G.quantize(w.z, o.grid), y = o.free ? w.y : G.quantize(w.y, o.grid);
      r.nodes[d.k - 1] = { dir: { kind: 'free' }, end: { kind: 'z', z: z, y: y } };
    } else {                                             // the end: propose the last segment afresh
      var pts = sol.rays[r.id].pts, P = pts[d.k - 1], Q = d.k > 1 ? pts[d.k - 2] : null;
      var prop = R.proposeSegment(st.scene, sol, P, Q, w, o);
      if (!prop) return;
      r.nodes.splice(d.k - 1, d.count, ...prop.nodes);
      d.count = prop.nodes.length;
      st.hints = prop.hints; st.axisHot = !!prop.axis;
      var at = prop.node.dir.at;
      st.hotFocal = at && (at.pt === 'F' || at.pt === 'Fp') ? { id: at.el, which: at.pt } : null;
      if (prop.text) st.caption = { x: p.px, y: p.py, text: prop.text };
    }
    redraw();
  }

  function dragTo(d, p, e) {
    var el = S.find(st.real, d.id);
    if (!el || d.kind === 'ray') return;
    if (d.kind === 'rayStart' || d.kind === 'rayEnd' || d.kind === 'rayMid') {
      if (!d.moved && Math.hypot(p.px - d.start.px, p.py - d.start.py) < 3) return;
      d.moved = true;
      dragRayPoint(d, el, p, e);
      return;
    }
    if (!d.moved) {
      if (Math.hypot(p.px - d.start.px, p.py - d.start.py) < 3) return;
      d.moved = true;
      beforeEdit();
    }
    var w = world(p), o = snapOpt(e), r, hit = null;
    switch (d.kind) {
      case 'lens':
        r = Snap.snapLensZ(st.scene, el, w.z - d.dz, o); el.z = r.z; hit = r.hit; break;
      case 'object': case 'filament':
        r = Snap.snapObjectZ(st.scene, w.z - d.dz, el.id, o); el.z = r.z; hit = r.hit; break;
      case 'beam':                                           // along the axis, and up or down
        r = Snap.snapObjectZ(st.scene, w.z - d.dz, el.id, o); el.z = r.z;
        var bb = beamY(w.y - d.dy, el, o); el.y = bb.y; hit = bb.hit || r.hit; break;
      case 'filTop': case 'filBot':                          // an end: anywhere, as long as top stays above bottom
        var fy = o.free ? w.y : G.quantize(w.y, o.grid / 5), gap = o.free ? 0.1 : o.grid / 5;
        if (d.kind === 'filTop') el.top = Math.max(fy, el.bottom + gap); else el.bottom = Math.min(fy, el.top - gap);
        break;
      case 'mirror': case 'iris':
        o.extra = d.extra || (d.extra = imageKeys());       // where the images were when the drag began
        r = Snap.snapAxisZ(st.scene, w.z - d.dz, el.id, o); el.z = r.z; hit = r.hit; break;
      case 'axis':                                          // everything on it moves with it
        var ny = view.y(p.py) - d.dy;
        el.y = o.free ? ny : G.quantize(ny, o.grid); break;
      case 'irisEdge':
        var ry = Math.min(el.ap, Math.abs(w.y));
        el.r = o.free ? ry : Math.min(el.ap, G.quantize(ry, o.grid / 5)); break;
      case 'tip':
        r = Snap.snapHeight(w.y, o); if (r.y !== 0) el.h = r.y; break;
      case 'point':
        r = pointSnap({ z: w.z - d.dz, y: w.y - d.dy }, el.id, o);
        el.z = r.g.z; el.y = r.g.y; hit = r.hit; break;
      case 'aperture':
        el.ap = o.free ? Math.max(1, Math.abs(w.y)) : Math.max(o.grid, G.quantize(Math.abs(w.y), o.grid)); break;
      case 'F': case 'Fp':
        r = Snap.snapFocal(st.scene, el, d.kind, w.z, o); el.f = r.f; hit = r.hit;
        st.hotFocal = { id: el.id, which: d.kind }; break;
    }
    setHint(hit, p);
    panel.sync(); redraw();
  }

  function endDrag(cancel) {
    var d = drag;
    drag = null; clearHints();
    if (!d || d.kind === 'pan') return;
    if (cancel) restore(hist.current());
    else if (d.moved) {
      if (d.kind === 'rayEnd') R.extendToImages(st.scene, SNAP_PX / view.s);
      commit();
    }
    redraw();
  }

  // ---------------------------------------------------------------- pointer events
  // A mouse and an Apple Pencil (pointerType 'pen') do everything. Fingers ('touch') only
  // navigate: one finger pans, two pinch to zoom, a tap selects. While the pen is down,
  // touches are ignored (a palm resting on the screen). In the Ray tool a segment can be drawn
  // press-drag-lift as well as click-move-click.

  /** Is this press the second of a double-click? (PointerEvent.detail is not reliable.) */
  var lastDown = null;
  function isDoubleClick(p, e) {
    var now = performance.now(), near = e.pointerType === 'mouse' ? HIT_PX : 2 * HIT_PX;
    var dbl = !!lastDown && now - lastDown.t < DOUBLE_MS && Math.hypot(p.px - lastDown.px, p.py - lastDown.py) < near;
    lastDown = dbl ? null : { t: now, px: p.px, py: p.py };
    return dbl;
  }

  var touches = {}, nTouch = 0, gesture = null, penDown = false, drawDrag = null;

  function touchPair() {
    var ids = Object.keys(touches), a = touches[ids[0]], b = touches[ids[1]];
    return { d: Math.hypot(a.px - b.px, a.py - b.py), mid: { px: (a.px + b.px) / 2, py: (a.py + b.py) / 2 } };
  }
  function cancelTouches() { touches = {}; nTouch = 0; gesture = null; }

  function touchDown(e, p) {
    if (penDown) return;                                   // a palm on the screen while the pen draws
    touches[e.pointerId] = p; nTouch++;
    if (nTouch === 1) gesture = { kind: 'pan', last: p, start: p, moved: false };
    else if (nTouch === 2) { var t = touchPair(); gesture = { kind: 'pinch', d: t.d, mid: t.mid }; }
    else gesture = null;
  }
  function touchMove(e, p) {
    if (!touches[e.pointerId]) return;
    touches[e.pointerId] = p;
    if (!gesture) return;
    if (gesture.kind === 'pan') {
      if (Math.hypot(p.px - gesture.start.px, p.py - gesture.start.py) > 8) gesture.moved = true;
      view.pan(p.px - gesture.last.px, p.py - gesture.last.py); gesture.last = p;
    } else if (nTouch === 2) {
      var t = touchPair();
      view.pan(t.mid.px - gesture.mid.px, t.mid.py - gesture.mid.py);
      if (gesture.d > 0 && t.d > 0) view.zoomAt(t.mid.px, t.mid.py, t.d / gesture.d);
      gesture.d = t.d; gesture.mid = t.mid;
    }
    redraw();
  }
  function touchUp(e, p) {
    if (!touches[e.pointerId]) return;
    delete touches[e.pointerId]; nTouch--;
    var g = gesture;
    if (nTouch === 0) {
      gesture = null;
      if (g && g.kind === 'pan' && !g.moved && !drawing) {  // a tap selects (it never draws or places)
        var h = hitTest(p);
        select(h ? h.el.id : null);
      }
    } else if (nTouch === 1) {                              // a pinch became one finger: keep panning
      var q = touches[Object.keys(touches)[0]];
      gesture = { kind: 'pan', last: q, start: q, moved: true };
    }
  }

  cv.addEventListener('pointerdown', function (e) {
    if (e.button === 2) return;
    var p = pos(e);
    cv.setPointerCapture(e.pointerId);
    if (e.pointerType === 'touch') { touchDown(e, p); return; }
    if (e.pointerType === 'pen') { penDown = true; cancelTouches(); }
    if (e.button === 1 || spaceDown) { drag = { kind: 'pan', last: p }; cv.style.cursor = 'grabbing'; return; }
    var dbl = isDoubleClick(p, e);
    if (!drawing && st.tool !== 'select') useAxis(nearestAxis(p) || st.axis);
    if (st.tool === 'ray') {
      if (!st.axis) { toast('Add an optical axis first (X).'); return; }
      var wasDrawing = !!drawing;
      if (drawing) rayPlace(p, dbl); else rayClick(e, p, dbl);
      if (!wasDrawing && drawing) drawDrag = { start: p, moved: false };   // maybe press-drag-lift
      return;
    }
    if (st.tool !== 'select') { place(e, p); return; }
    var h = hitTest(p);
    if (!h) { select(null); drag = { kind: 'pan', last: p }; cv.style.cursor = 'grabbing'; return; }
    select(h.el.id);
    var w = world(p);
    drag = { kind: h.kind, id: h.el.id, start: p, moved: false, k: h.k, count: 1,
      dz: w.z - (h.el.z || 0), dy: h.el.type === 'point' || h.el.type === 'beam' ? w.y - h.el.y : h.kind === 'axis' ? view.y(p.py) - h.el.y : 0 };
    if (h.kind === 'rayEnd') {                           // remember the line, so the end can slide along it
      var sp = R.solveAll(st.scene)[h.el.id].pts;
      drag.keep = R.keepDir(h.el.nodes[h.k - 1], sp[h.k - 1], sp[h.k]);
    }
  });

  cv.addEventListener('pointermove', function (e) {
    var p = pos(e);
    if (e.pointerType === 'touch') { touchMove(e, p); return; }
    var w = world(p);
    lastPos = p;
    if (drag && drag.kind === 'pan') {
      view.pan(p.px - drag.last.px, p.py - drag.last.py); drag.last = p; redraw(); return;
    }
    if (drag) { dragTo(drag, p, e); return; }
    if (drawDrag && Math.hypot(p.px - drawDrag.start.px, p.py - drawDrag.start.py) > 8) drawDrag.moved = true;
    if (!drawing && st.tool !== 'select') {             // work on the axis nearest the pointer
      var near = nearestAxis(p);
      if (near && near !== st.axis) { useAxis(near); w = world(p); }
    }
    $('coords').textContent = 'z ' + w.z.toFixed(1) + ' mm   y ' + w.y.toFixed(1) + ' mm';
    if (st.tool === 'select') hover(p);
    else if (st.tool === 'ray') { if (drawing) rayMove(p, e); else rayHover(p, e); }
    else updateGhost(p, e);
  });

  cv.addEventListener('pointerup', function (e) {
    var p = pos(e);
    if (e.pointerType === 'touch') { touchUp(e, p); return; }
    if (e.pointerType === 'pen') penDown = false;
    var dd = drawDrag;
    drawDrag = null;
    if (dd && dd.moved && drawing && drawing.prop) { rayPlace(p, false); return; }   // lifted after dragging: place it
    if (!drag) return;
    endDrag(false);
    if (st.tool === 'select') hover(p);
    else cv.style.cursor = 'crosshair';
  });
  cv.addEventListener('pointercancel', function (e) {
    if (e.pointerType === 'touch') { touchUp(e, pos(e)); return; }
    if (e.pointerType === 'pen') penDown = false;
    drawDrag = null;
    endDrag(true);
  });
  cv.addEventListener('pointerleave', function (e) {
    if (drag || e.pointerType === 'touch') return;
    st.hover = null; clearHints();
    if (st.draft) st.draft.pts = null;
    redraw();
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

  var TOOL_KEYS = { v: 'select', x: 'axis', l: 'lens', o: 'object', p: 'point', c: 'beam', a: 'filament', m: 'mirror', i: 'iris', r: 'ray', h: 'ray' };

  document.addEventListener('keydown', function (e) {
    var typing = 'input[type=text], input[type=number], input[type=range], textarea, select';
    if (e.target.matches && e.target.matches(typing)) return;   // keys belong to the field being edited
    var k = e.key, mod = e.metaKey || e.ctrlKey;
    if (mod && k.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && k.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (mod && k.toLowerCase() === 's') { e.preventDefault(); saveFile(); return; }
    if (mod && k.toLowerCase() === 'c') { e.preventDefault(); copySelected(); return; }
    if (mod && k.toLowerCase() === 'v') { e.preventDefault(); pasteMode(); return; }
    if (mod) return;
    if (k === 'Alt' && lastPos) {                          // re-snap the preview at once
      var fake = { altKey: true, shiftKey: e.shiftKey };
      if (drawing) rayMove(lastPos, fake);
      return;
    }
    if (e.altKey) return;
    if (k === ' ') { e.preventDefault(); if (!spaceDown) { spaceDown = true; cv.style.cursor = 'grab'; } return; }
    if (!$('confirm').hidden) {                                // the dialog has the keyboard
      if (k === 'Escape') answered(false);
      else if (k === 'Enter') { e.preventDefault(); answered(true); }
      return;
    }
    if (k === 'Escape') {
      if (scan) stopScan();
      else if (!$('about').hidden) $('about').hidden = true;
      else if (drag) endDrag(true);
      else if (drawing) cancelDrawing();
      else if (anyPopover()) closePopovers();
      else if (st.tool !== 'select') setTool('select');
      else select(null);
      return;
    }
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); if (!drawing) deleteKey(); return; }
    if ((k === 'ArrowUp' || k === 'ArrowDown') && st.sel && (S.find(st.real, st.sel) || {}).type === 'axis') {
      e.preventDefault();
      var ax = S.find(st.real, st.sel), st2 = G.niceStep(view.s, 14) * (e.shiftKey ? 5 : 1);
      ax.y = G.quantize(ax.y + (k === 'ArrowUp' ? st2 : -st2), st2);
      panel.sync(); commit(); redraw();
      return;
    }
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      var el = st.sel && S.find(st.real, st.sel);
      if (!el || S.isRay(el) || el.type === 'axis') return;
      e.preventDefault();
      beforeEdit();
      var step = G.niceStep(view.s, 14) * (e.shiftKey ? 5 : 1);
      el.z = G.quantize(el.z + (k === 'ArrowLeft' ? -step : step), step);
      panel.sync(); commit(); redraw();
      return;
    }
    if (k === 'R' && e.shiftKey) { reverseSelected(); return; }
    var t = TOOL_KEYS[k.toLowerCase()];
    if (t === 'ray') setRayKind(k.toLowerCase() === 'h');
    if (t) { setTool(t); return; }
    if (k === 'f') fit();
    else if (k === 'g') toggleHints();
    else if (k === 'b') toggleFill();
    else if (k === '?') toggle('help');
  });
  document.addEventListener('keyup', function (e) {
    if (e.key === ' ') { spaceDown = false; cv.style.cursor = st.tool === 'select' ? 'default' : 'crosshair'; }
    if (e.key === 'Alt' && drawing && lastPos) rayMove(lastPos, { altKey: false });
  });

  // ---------------------------------------------------------------- files

  function download(name, blob) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function saveFile() {
    download('rayman-scene.json', new Blob([JSON.stringify(st.real, null, 2)], { type: 'application/json' }));
    toast('Scene saved to your downloads.');
  }

  $('file').addEventListener('change', function () {
    var f = this.files[0];
    this.value = '';
    if (!f) return;
    f.text().then(function (txt) {
      st.sel = null; setScene(S.fromJSON(txt));
      commit(); fit();
      toast('Loaded ' + f.name);
    }).catch(function (err) { toast(err.message, true); });
  });

  function exportPng() {
    var k = 2, off = document.createElement('canvas');
    off.width = Math.round(W * k); off.height = Math.round(H * k);
    var c = off.getContext('2d');
    c.setTransform(k, 0, 0, k, 0, 0);
    RM.render.draw(c, W, H, { real: st.real, view: view, theme: st.theme, tool: 'select' });
    off.toBlob(function (b) { download('rayman.png', b); toast('Picture saved to your downloads.'); });
  }

  /** Wipe the bench, after asking. (It is one undo step, so it can be taken back.) */
  function resetCanvas() {
    if (!st.real.elements.some(function (e) { return e.type !== 'axis'; }) && !st.real.rays.length) return;
    ask(function () {
      var s = S.create(); s.settings = st.real.settings;
      st.sel = null; drawing = null; st.draft = null;
      setScene(s); commit(); redraw();
      toast('Canvas reset. ⌘Z brings it back.');
    });
  }

  /** The confirmation dialog: run onYes if the user agrees. Enter agrees, Esc declines. */
  var answer = null;
  function ask(onYes, title, text, yes) {
    answer = onYes;
    $('confirm-title').textContent = title || 'Reset the canvas?';
    $('confirm').querySelector('p').textContent = text || 'This removes every lens, object and ray. You can still undo it with ⌘Z.';
    $('confirm').querySelector('[data-answer=yes]').textContent = yes || 'Reset';
    closePopovers();
    $('confirm').hidden = false;
    $('confirm').querySelector('[data-answer=yes]').focus();
  }
  function answered(yes) {
    var f = answer;
    answer = null; $('confirm').hidden = true;
    if (yes && f) f();
  }
  $('confirm').addEventListener('click', function (e) {
    var b = e.target.closest('[data-answer]');
    if (b) answered(b.dataset.answer === 'yes');
    else if (e.target === this) answered(false);           // clicking the backdrop declines
  });

  // ---------------------------------------------------------------- the ray colour flyout

  /** Open the flyout beside the Ray tool's button. */
  function openRayColour() {
    var btn = document.querySelector('#tools [data-tool=ray]').getBoundingClientRect();
    var box = stage.getBoundingClientRect();
    $('raycolour').style.top = Math.max(12, btn.top - box.top - 6) + 'px';
    toggle('raycolour');
    syncRayColour();
  }

  /** Show the current colour: the selected ray's, else the one for new rays. */
  /** The element that owns a ray (its beam or point source), whose colour it takes, or null. */
  function beamOf(r) { return r && !r.helper ? R.owner(st.real, r) : null; }

  /** The ray the colour flyout recolours: the selected ray, but not while drawing with the Ray
      tool (there the flyout only sets the colour of the next ray). */
  function recolourTarget() {
    var r = S.find(st.real, st.sel);
    return st.tool !== 'ray' && S.isRay(r) ? r : null;
  }

  function syncRayColour() {
    var ray = recolourTarget(), bm = beamOf(ray);
    var c = bm ? bm.color : ray ? ray.color : st.rayColour;
    document.querySelectorAll('#raycolour [data-colour]').forEach(function (b) {
      b.classList.toggle('on', (b.dataset.colour || null) === (c || null));
    });
    $('raycolour-any').value = /^#[0-9a-f]{6}$/i.test(c || '') ? c : '#888888';
    $('raycolour-note').textContent = bm ? 'For the selected ' + (bm.type === 'beam' ? 'beam' : 'point source') + ' (all its rays), and the next ray you draw.'
      : ray ? 'For the selected ray, and the next one you draw.' : 'For the next ray you draw.';
    document.querySelector('#tools [data-tool=ray] .corner').style.setProperty('--rc', st.rayColour || 'var(--faint)');
  }

  /** Pick a colour: it applies to new rays and to the selected ray, if there is one.
      live: still choosing (the colour picker is being dragged), so no undo step yet. */
  function pickRayColour(c, live) {
    st.rayColour = c || null;
    store(RAY_COLOUR_KEY, c || '');
    var r = recolourTarget(), bm = beamOf(r);
    if (bm) {                                             // recolour the owner (beam / point source): its rays follow
      bm.color = st.rayColour;
      st.real.rays.forEach(function (q) { if (beamOf(q) === bm) q.color = null; });
      if (!live) commit();
    } else if (S.isRay(r)) { r.color = st.rayColour; if (!live) commit(); }
    syncRayColour(); panel.sync(); redraw();
  }
  document.querySelectorAll('#raycolour [data-colour]').forEach(function (b) {
    b.addEventListener('click', function () { pickRayColour(b.dataset.colour); });
  });
  $('raycolour-any').addEventListener('input', function () { pickRayColour(this.value, true); });
  $('raycolour-any').addEventListener('change', function () { pickRayColour(this.value); });
  document.querySelector('#tools [data-tool=ray] .corner').addEventListener('click', function (e) {
    if (lastPointer === 'touch') return;                   // a finger: the whole button picks the tool
    e.stopPropagation();                                   // the corner opens options; it does not pick the tool
    if ($('raycolour').hidden) openRayColour(); else closePopovers();
  });
  document.querySelector('#tools [data-tool=ray]').addEventListener('contextmenu', function (e) {
    e.preventDefault(); openRayColour();                   // right-click works too
  });

  /** Draw ordinary rays or dashed helper rays: the Ray tool's two kinds (keys R and H). The
      rail button shows which kind is active. */
  function setRayKind(helper) {
    st.helper = !!helper;
    var btn = document.querySelector('#tools [data-tool=ray]');
    btn.classList.toggle('helper', st.helper);
    btn.dataset.tip = st.helper ? 'Helper ray' : 'Ray';
    btn.dataset.key = st.helper ? 'H' : 'R';
    document.querySelectorAll('#raycolour [data-kind]').forEach(function (b) {
      b.classList.toggle('on', (b.dataset.kind === 'helper') === st.helper);
    });
    if (st.tool === 'ray') showSelection();
  }
  document.querySelectorAll('#raycolour [data-kind]').forEach(function (b) {
    b.addEventListener('click', function () { setRayKind(b.dataset.kind === 'helper'); setTool('ray'); });
  });

  // ---------------------------------------------------------------- scanning

  /** Sweeping a scan mirror's tilt back and forth (tilt ± range, one sweep in 2.4 s). Rays
      reflected by the mirror follow it. Nothing is recorded in the history: stopping puts the
      tilt back where it was. */
  var scan = null, SCAN_PERIOD = 2400;
  function toggleScan(id) { if (scan && scan.id === id) stopScan(); else startScan(id); }
  function startScan(id) {
    stopScan();
    var m = S.find(st.real, id);
    if (!m || m.type !== 'mirror') return;
    scan = { id: id, base: m.tilt, t0: performance.now() };
    requestAnimationFrame(scanStep);
    panel.sync();
  }
  function scanStep(now) {
    if (!scan) return;
    var m = S.find(st.real, scan.id);
    if (!m) { scan = null; return; }
    m.tilt = scan.base + m.range * Math.sin(2 * Math.PI * (now - scan.t0) / SCAN_PERIOD);
    m.tilt = Math.round(m.tilt * 100) / 100;
    panel.sync(); redraw();
    requestAnimationFrame(scanStep);
  }
  /** Stop scanning and put the tilt back (quiet: no redraw, e.g. before a restore). */
  function stopScan(quiet) {
    if (!scan) return;
    var m = S.find(st.real, scan.id);
    if (m) m.tilt = scan.base;
    scan = null;
    if (!quiet) { panel.sync(); redraw(); }
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
    st.theme = name === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = st.theme;
    store(THEME_KEY, st.theme);
    redraw();
  }

  var POPOVERS = ['menu', 'settings', 'help', 'raycolour', 'fillcount'];

  /** Show or hide a popover, closing the others; marks its rail button as open. */
  function toggle(id, show) {
    POPOVERS.forEach(function (p) {
      var open = p === id ? (show == null ? $(p).hidden : show) : false;
      $(p).hidden = !open;
      var btn = document.querySelector('#rail [data-act=' + p + ']');
      if (btn) btn.classList.toggle('on', open);
      if (open && btn && $(p).classList.contains('popover')) {      // line it up with its button
        var top = btn.getBoundingClientRect().top - 6, room = window.innerHeight - $(p).offsetHeight - 10;
        $(p).style.top = Math.max(10, Math.min(top, room)) + 'px';
      }
    });
  }
  function closePopovers() { toggle(null); }

  /** The About card. The logo is large, so it is only loaded the first time. */
  function showAbout() {
    var img = document.querySelector('#about img');
    if (!img.src) img.src = img.dataset.src;
    closePopovers();
    $('about').hidden = false;
  }
  $('about').addEventListener('click', function (e) {
    if (e.target.closest('a')) return;                  // the website link opens; the card stays
    $('about').hidden = true;
  });
  function anyPopover() { return POPOVERS.some(function (p) { return !$(p).hidden; }); }

  var ACTIONS = {
    undo: undo, redo: redo, fit: fit, reset: resetCanvas, save: saveFile, png: exportPng,
    load: function () { $('file').click(); },
    theme: function () { setTheme(st.theme === 'dark' ? 'light' : 'dark'); },
    menu: function () { toggle('menu'); },
    hints: function () { toggleHints(); },
    delete: function () { deleteKey(); },
    reverse: function () { reverseSelected(); },
    copy: function () { copySelected(); },
    fill: function () { toggleFill(); },
    about: showAbout,
    help: function () { toggle('help'); },
    settings: function () { toggle('settings'); }
  };
  document.querySelectorAll('[data-tool]').forEach(function (b) {
    b.addEventListener('click', function () { setTool(b.dataset.tool); closePopovers(); b.blur(); });
  });
  document.querySelectorAll('[data-act]').forEach(function (b) {
    if (b.closest('#props')) return;
    b.addEventListener('click', function () {
      if (b.closest('#menu')) closePopovers();             // a menu item: run it and close the menu
      ACTIONS[b.dataset.act](); b.blur();
    });
  });
  cv.addEventListener('pointerdown', function () {             // clicking the bench closes small popovers
    if (!$('menu').hidden || !$('settings').hidden || !$('raycolour').hidden || !$('fillcount').hidden) toggle(null);
  }, true);
  $('set-follow').addEventListener('change', function () {
    st.scene.settings.follow = this.checked;
    commit();
    toast(this.checked ? 'Rays now follow when the optics move.' : 'Rays now stay put when the optics move.');
  });
  $('set-virtual').addEventListener('change', function () {
    st.scene.settings.virtual = this.checked;
    commit(); redraw();
  });
  /** Hint mode: the three rules shown at the top, and rays coloured by the rule they follow.
      It is the scene's colour-coding setting, so a scene can be saved with hints on. */
  function syncHints() {
    var on = !!st.scene.settings.colour;
    $('guide').hidden = !on;
    document.querySelector('#rail [data-act=hints]').classList.toggle('on', on);
  }
  function toggleHints() {
    st.scene.settings.colour = !st.scene.settings.colour;
    syncHints(); commit(); showSelection(); redraw();
  }
  /** Fill-in rays: a latched button on the rail (B). The scene stores how many rays are drawn
      per bundle (0 = off); the count chosen in the button's corner flyout is remembered. */
  var FILL_KEY = 'rayman.fillCount';
  st.fillCount = +stored(FILL_KEY) || 10;
  function syncFill() {
    var n = st.scene.settings.fill || 0;
    if (n) st.fillCount = n;
    document.querySelector('#rail [data-act=fill]').classList.toggle('on', n > 0);
    document.querySelectorAll('#fillcount [data-fill]').forEach(function (b) {
      b.classList.toggle('on', +b.dataset.fill === st.fillCount);
    });
  }
  function toggleFill() {
    st.scene.settings.fill = st.scene.settings.fill ? 0 : st.fillCount;
    syncFill(); commit(); redraw();
  }
  document.querySelectorAll('#fillcount [data-fill]').forEach(function (b) {
    b.addEventListener('click', function () {                 // choosing a count also turns fill-in on
      st.fillCount = +b.dataset.fill; store(FILL_KEY, String(st.fillCount));
      st.scene.settings.fill = st.fillCount;
      syncFill(); commit(); redraw();
    });
  });
  function openFillCount() {
    var btn = document.querySelector('#rail [data-act=fill]').getBoundingClientRect(), box = stage.getBoundingClientRect();
    $('fillcount').style.top = Math.max(12, Math.min(btn.top - box.top - 6, box.height - 150)) + 'px';
    toggle('fillcount', true); syncFill();
  }
  document.querySelector('#rail [data-act=fill] .corner').addEventListener('click', function (e) {
    if (lastPointer === 'touch') return;                      // a finger: the whole button toggles
    e.stopPropagation();                                      // the corner opens options; it does not toggle
    if ($('fillcount').hidden) openFillCount(); else closePopovers();
  });
  document.querySelector('#rail [data-act=fill]').addEventListener('contextmenu', function (e) {
    e.preventDefault(); e.target.closest('button').querySelector('.corner').click();
  });

  // ---------------------------------------------------------------- auto-hiding the rails
  // A desktop preference (not saved with the scene): the rails float off the edges and slide
  // back when the mouse comes within a few pixels of an edge. Not offered on touch screens,
  // where there is no mouse to bring them back.

  var AUTOHIDE_KEY = 'rayman.autohide', EDGE_PX = 14;
  var canHover = !!(window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches);
  var peekTimers = {};
  function setAutohide(on) {
    on = !!on && canHover;
    document.body.classList.toggle('autohide', on);
    $('set-autohide').checked = on;
    store(AUTOHIDE_KEY, on ? '1' : '');
    peek('tools', false, true); peek('rail', false, true);
    resize();
  }
  /** Slide a rail out (show) or, after a short pause, back in. */
  function peek(id, show, now) {
    clearTimeout(peekTimers[id]);
    if (show || now) $(id).classList.toggle('peek', !!show);
    else peekTimers[id] = setTimeout(function () { $(id).classList.remove('peek'); }, 450);
  }
  document.addEventListener('mousemove', function (e) {
    if (!document.body.classList.contains('autohide')) return;
    var t = e.target.closest ? e.target : null;
    var leftOpen = !$('raycolour').hidden;
    var rightOpen = !$('menu').hidden || !$('settings').hidden || !$('fillcount').hidden || !$('help').hidden;
    peek('tools', e.clientX <= EDGE_PX || !!(t && t.closest('#tools, #raycolour')) || leftOpen);
    peek('rail', e.clientX >= window.innerWidth - EDGE_PX || !!(t && t.closest('#rail, #menu, #settings, #fillcount')) || rightOpen);
  });
  if (!canHover) $('autohide-row').hidden = true;
  $('set-autohide').addEventListener('change', function () { setAutohide(this.checked); });

  // ---------------------------------------------------------------- fingers on the rail
  // A finger is too broad for the little corner triangles, so for touch the whole button acts
  // as the button, and a long press (half a second) opens the button's flyout instead.

  var lastPointer = 'mouse';
  document.addEventListener('pointerdown', function (e) { lastPointer = e.pointerType; }, true);

  function longPress(btn, open) {
    var timer = null, fired = false;
    btn.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'touch') return;
      fired = false;
      timer = setTimeout(function () { fired = true; open(); }, 500);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (t) {
      btn.addEventListener(t, function () { clearTimeout(timer); });
    });
    btn.addEventListener('click', function (e) {             // the tap that ends a long press does nothing more
      if (fired) { fired = false; e.stopImmediatePropagation(); e.preventDefault(); }
    }, true);
    btn.addEventListener('contextmenu', function (e) { if (lastPointer === 'touch') e.preventDefault(); });
  }
  longPress(document.querySelector('#tools [data-tool=ray]'), function () { if ($('raycolour').hidden) openRayColour(); });
  longPress(document.querySelector('#rail [data-act=fill]'), function () { if ($('fillcount').hidden) openFillCount(); });

  // ---------------------------------------------------------------- start up

  setTheme(stored(THEME_KEY) || 'light');
  if (stored(AUTOHIDE_KEY)) setAutohide(true);
  new ResizeObserver(resize).observe(stage);
  resize();
  var saved = stored(STORE_KEY), restored = false;
  if (saved) {
    try { setScene(S.fromJSON(saved)); restored = st.real.elements.some(function (e) { return e.type !== 'axis'; }); }
    catch (err) { setScene(S.create()); }
  } else setScene(S.create());
  commit();
  if (restored) fit();
  else { view.s = 3; view.ox = W * 0.35; view.oy = H / 2; }
  setTool('select');

  RM.app = { st: st, view: view, hist: hist };    // handy from the browser console
})();
