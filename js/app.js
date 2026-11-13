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

  /** Fit the elements and rays in view, keeping clear of the properties panel when it is open. */
  function fit() {
    var props = $('props'), right = props.hidden ? 0 : props.offsetWidth + 20;
    var b = S.bounds(st.scene), solved = R.solveAll(st.scene);
    st.scene.rays.forEach(function (r) {
      solved[r.id].pts.forEach(function (p) {
        if (Math.abs(p.z) > R.FAR / 2) return;            // rays running off to the edge
        b = b || { z0: p.z, z1: p.z, y0: -10, y1: 10 };
        b.z0 = Math.min(b.z0, p.z); b.z1 = Math.max(b.z1, p.z);
        b.y0 = Math.min(b.y0, p.y, -Math.abs(p.y)); b.y1 = Math.max(b.y1, p.y, Math.abs(p.y));
      });
    });
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
    var e = st.sel && S.find(st.scene, st.sel);
    if (e && e.type === 'lens') lastF = e.f;
    var m = scan && S.find(st.scene, scan.id), live = m && m.tilt;   // record a scanning mirror at rest
    if (m) m.tilt = scan.base;
    if (hist.push(S.toJSON(st.scene))) store(STORE_KEY, hist.current());
    if (m) m.tilt = live;
    updateButtons();
  }

  function setScene(s) {
    st.scene = s;
    if (st.sel && !S.find(st.scene, st.sel)) st.sel = null;
    showSelection();
    $('set-follow').checked = st.scene.settings.follow;
    $('set-colour').checked = st.scene.settings.colour;
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

  /** Call before changing the optics: with following off, freeze the rays where they are. */
  function beforeEdit() {
    if (!st.scene.settings.follow) R.bakeAll(st.scene);
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
    var x = st.sel && S.find(st.scene, st.sel);
    if (S.isRay(x)) {
      panel.hide();
      var role = R.solveScene(st.scene).roles[x.id];
      showHint(x.helper ? 'Helper ray' : ROLE_TITLE[role] || 'Ray', 'Delete removes its last segment · colour: the corner of the Ray tool');
    } else {
      panel.show(x);
      var tip = st.tool === 'ray' && st.helper ? HELPER_HINT : TOOL_HINTS[st.tool];
      showHint(tip[0], tip[1]);
    }
    syncRayColour();
  }

  /** Delete an element or a ray. Rays pinned to it keep their shape but become free. */
  function deleteThing(id) {
    if (!id || !S.find(st.scene, id)) return;
    if (scan && scan.id === id) stopScan();
    R.bakeRefsTo(st.scene, id, S.remove);
    S.remove(st.scene, id);
    select(null); commit();
  }

  /** Remove the last segment of a ray, or the ray once nothing is left. A line through a lens
      centre and straight on is one segment, so both parts go together. */
  function trimRay(id) {
    var r = S.find(st.scene, id);
    if (!S.isRay(r)) return;
    var s = R.solveAll(st.scene)[id], N = r.nodes.length, drop = 1;
    while (drop < N && R.isJoint(st.scene, r, s, N - drop)) drop++;
    if (drop >= N) { deleteThing(id); return; }
    var keep = N - drop, first = keep + 1;             // nodes kept; first point removed
    R.bakeBefore(st.scene, function (sc) { S.find(sc, id).nodes.length = keep; },
      function (ref) { return ref.ray === id && (ref.k >= first || ref.seg >= first - 1); });
    r = S.find(st.scene, id);
    r.nodes.length = keep;
    commit(); showSelection(); redraw();
  }

  /** Delete key: a ray loses its last segment; anything else is deleted. */
  function deleteKey() {
    if (S.isRay(S.find(st.scene, st.sel))) trimRay(st.sel);
    else deleteThing(st.sel);
  }

  var TOOL_HINTS = {
    select: ['Select', 'drag lenses, objects, F and F′ · drag empty space to pan · scroll to zoom · Alt: no snapping'],
    lens: ['Thin lens', 'click to place on the axis · Shift-click to place several · Esc to stop'],
    object: ['Object', 'click where the arrow tip should be · Esc to stop'],
    point: ['Point source', 'click to place · Esc to stop'],
    mirror: ['Scan mirror', 'click to place on the axis · Esc to stop'],
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
  function world(p) { return { z: view.z(p.px), y: view.y(p.py) }; }

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
    var w = world(p), tol = HIT_PX / view.s, els = st.scene.elements, i, e;
    for (i = els.length - 1; i >= 0; i--) {
      e = els[i];
      if (e.type === 'point' && G.dist(w, { z: e.z, y: e.y }) <= 1.5 * tol) return { el: e, kind: 'point' };
    }
    for (i = els.length - 1; i >= 0; i--) {
      e = els[i];
      if (e.type === 'object' && G.dist(w, { z: e.z, y: e.h }) <= 1.5 * tol) return { el: e, kind: 'tip' };
    }
    var lensesSelectedLast = els.filter(function (x) { return x.type === 'lens'; })
      .sort(function (a, b) { return (a.id === st.sel) - (b.id === st.sel); });   // selected is tried first
    for (i = lensesSelectedLast.length - 1; i >= 0; i--) {
      e = lensesSelectedLast[i];
      var fp = G.focalPoints(e);
      if (G.dist(w, { z: fp.Fp, y: 0 }) <= tol) return { el: e, kind: 'Fp' };
      if (G.dist(w, { z: fp.F, y: 0 }) <= tol) return { el: e, kind: 'F' };
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
    }
    for (i = els.length - 1; i >= 0; i--) {
      e = els[i];
      if (e.type === 'mirror' && Math.abs(w.z - e.z) <= 1.5 * tol && Math.abs(w.y) <= e.ap + tol) return { el: e, kind: 'mirror' };
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
    rayStart: 'move', rayEnd: 'move', rayMid: 'move' };

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
        var d = Math.hypot(view.X(q.z) - p.px, view.Y(q.y) - p.py) - (r.id === st.sel ? 1 : 0);
        if (d <= bestD) { bestD = d; best = { el: r, kind: kind, k: k }; }
      });
    });
    return best;
  }

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
      return { g: { type: 'object', z: r.z, h: h === 0 ? S.DEFAULT_H : h, label: '', color: null }, hit: r.hit };
    }
    if (st.tool === 'point') return pointSnap(w, null, o);
    if (st.tool === 'mirror') {
      r = Snap.snapAxisZ(st.scene, w.z, null, o);
      return { g: { type: 'mirror', z: r.z, tilt: 0, range: 5, ap: 15, label: '' }, hit: r.hit };
    }
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
    else if (g.type === 'mirror') el = S.addMirror(st.scene, g.z);
    else el = S.addPoint(st.scene, g.z, g.y);
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
  function rayNodeAt(p) {
    var solved = R.solveAll(st.scene), best = null, bestD = HIT_PX;
    st.scene.rays.forEach(function (r) {
      var s = solved[r.id], pts = s.trimmed ? s.pts.slice(0, -1) : s.pts;
      pts.forEach(function (q, k) {
        if (R.isJoint(st.scene, r, s, k)) return;               // not a place a ray can bend or branch
        var d = Math.hypot(view.X(q.z) - p.px, view.Y(q.y) - p.py), last = !s.trimmed && k === pts.length - 1;
        if (last) d -= 2;                                       // ends win ties
        if (d <= bestD) { bestD = d; best = { ray: r, k: k, last: last, p: q }; }
      });
    });
    return best;
  }

  /** Can this ray be continued from its end? Not if it runs off to the edge or was cut short. */
  function continuable(r) {
    var n = r.nodes[r.nodes.length - 1], s = R.solveAll(st.scene)[r.id];
    return s.ok && (!n || n.end.kind !== 'edge');
  }

  /** Ray tool, not drawing: show where a click would start or continue a ray. */
  function rayHover(p, e) {
    var hit = rayNodeAt(p), txt, at;
    if (hit && hit.last && continuable(hit.ray)) { at = hit.p; txt = 'continue this ray'; }
    else {
      var s = R.proposeStart(st.scene, R.solveScene(st.scene), world(p), snapOpt(e));
      at = s.start.at || s.text ? s.p : null;
      txt = s.start.at ? s.text.replace(/^from a point on a ray$/, 'branch from this ray') : s.text;
    }
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
    var hit = rayNodeAt(p);
    if (hit && hit.last && continuable(hit.ray)) {
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
    var opt = snapOpt(e); opt.self = drawing.ray;
    var t = drawingTail(), prop = R.proposeSegment(st.scene, R.solveScene(st.scene), t.P, t.Q, world(p), opt);
    var ray = drawing.ray && S.find(st.scene, drawing.ray);
    drawing.prop = prop;
    st.draft = { from: t.P, pts: prop && prop.pts, color: ray ? ray.color : st.rayColour,
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
    var r = drawing.ray ? S.find(st.scene, drawing.ray) : S.addRay(st.scene, drawing.start, st.helper);
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
    var r = S.find(st.scene, id);
    if (!S.isRay(r) || !r.nodes.length) return false;
    var pts = R.solveAll(st.scene)[id].pts, n = pts.length;
    var node = R.extendNode(st.scene, r.nodes[r.nodes.length - 1], pts[n - 2], pts[n - 1], SNAP_PX / view.s);
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
    o.self = r.id;
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
    var el = S.find(st.scene, d.id);
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
      case 'object': case 'mirror':
        r = Snap.snapAxisZ(st.scene, w.z - d.dz, el.id, o); el.z = r.z; hit = r.hit; break;
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

  /** Is this press the second of a double-click? (PointerEvent.detail is not reliable.) */
  var lastDown = null;
  function isDoubleClick(p) {
    var now = performance.now();
    var dbl = !!lastDown && now - lastDown.t < DOUBLE_MS && Math.hypot(p.px - lastDown.px, p.py - lastDown.py) < HIT_PX;
    lastDown = dbl ? null : { t: now, px: p.px, py: p.py };
    return dbl;
  }

  cv.addEventListener('pointerdown', function (e) {
    if (e.button === 2) return;
    cv.setPointerCapture(e.pointerId);
    var p = pos(e);
    if (e.button === 1 || spaceDown) { drag = { kind: 'pan', last: p }; cv.style.cursor = 'grabbing'; return; }
    var dbl = isDoubleClick(p);
    if (st.tool === 'ray') { if (drawing) rayPlace(p, dbl); else rayClick(e, p, dbl); return; }
    if (st.tool !== 'select') { place(e, p); return; }
    var h = hitTest(p);
    if (!h) { select(null); drag = { kind: 'pan', last: p }; cv.style.cursor = 'grabbing'; return; }
    select(h.el.id);
    var w = world(p);
    drag = { kind: h.kind, id: h.el.id, start: p, moved: false, k: h.k, count: 1,
      dz: w.z - (h.el.z || 0), dy: h.el.type === 'point' ? w.y - h.el.y : 0 };
  });

  cv.addEventListener('pointermove', function (e) {
    var p = pos(e), w = world(p);
    lastPos = p;
    $('coords').textContent = 'z ' + w.z.toFixed(1) + ' mm   y ' + w.y.toFixed(1) + ' mm';
    if (drag && drag.kind === 'pan') {
      view.pan(p.px - drag.last.px, p.py - drag.last.py); drag.last = p; redraw(); return;
    }
    if (drag) { dragTo(drag, p, e); return; }
    if (st.tool === 'select') hover(p);
    else if (st.tool === 'ray') { if (drawing) rayMove(p, e); else rayHover(p, e); }
    else updateGhost(p, e);
  });

  cv.addEventListener('pointerup', function (e) {
    if (!drag) return;
    endDrag(false);
    if (st.tool === 'select') hover(pos(e));
    else cv.style.cursor = 'crosshair';
  });
  cv.addEventListener('pointercancel', function () { endDrag(true); });
  cv.addEventListener('pointerleave', function () {
    if (drag) return;
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

  var TOOL_KEYS = { v: 'select', l: 'lens', o: 'object', p: 'point', m: 'mirror', r: 'ray', h: 'ray' };

  document.addEventListener('keydown', function (e) {
    var typing = 'input[type=text], input[type=number], input[type=range], textarea, select';
    if (e.target.matches && e.target.matches(typing)) return;   // keys belong to the field being edited
    var k = e.key, mod = e.metaKey || e.ctrlKey;
    if (mod && k.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && k.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (mod && k.toLowerCase() === 's') { e.preventDefault(); saveFile(); return; }
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
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      var el = st.sel && S.find(st.scene, st.sel);
      if (!el || S.isRay(el)) return;
      e.preventDefault();
      beforeEdit();
      var step = G.niceStep(view.s, 14) * (e.shiftKey ? 5 : 1);
      el.z = G.quantize(el.z + (k === 'ArrowLeft' ? -step : step), step);
      panel.sync(); commit(); redraw();
      return;
    }
    var t = TOOL_KEYS[k.toLowerCase()];
    if (t === 'ray') setRayKind(k.toLowerCase() === 'h');
    if (t) { setTool(t); return; }
    if (k === 'f') fit();
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
    download('rayman-scene.json', new Blob([JSON.stringify(st.scene, null, 2)], { type: 'application/json' }));
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
    RM.render.draw(c, W, H, { scene: st.scene, view: view, theme: st.theme, tool: 'select' });
    off.toBlob(function (b) { download('rayman.png', b); toast('Picture saved to your downloads.'); });
  }

  /** Wipe the bench, after asking. (It is one undo step, so it can be taken back.) */
  function resetCanvas() {
    if (!st.scene.elements.length && !st.scene.rays.length) return;
    ask(function () {
      var s = S.create(); s.settings = st.scene.settings;
      st.sel = null; drawing = null; st.draft = null;
      setScene(s); commit(); redraw();
      toast('Canvas reset. ⌘Z brings it back.');
    });
  }

  /** The confirmation dialog: run onYes if the user agrees. Enter agrees, Esc declines. */
  var answer = null;
  function ask(onYes) {
    answer = onYes;
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
    var btn = document.querySelector('#rail [data-tool=ray]').getBoundingClientRect();
    var box = stage.getBoundingClientRect();
    $('raycolour').style.top = Math.max(12, btn.top - box.top - 6) + 'px';
    toggle('raycolour');
    syncRayColour();
  }

  /** Show the current colour: the selected ray's, else the one for new rays. */
  function syncRayColour() {
    var r = S.find(st.scene, st.sel), ray = S.isRay(r) ? r : null;
    var c = ray ? ray.color : st.rayColour;
    document.querySelectorAll('#raycolour [data-colour]').forEach(function (b) {
      b.classList.toggle('on', (b.dataset.colour || null) === (c || null));
    });
    $('raycolour-any').value = /^#[0-9a-f]{6}$/i.test(c || '') ? c : '#888888';
    $('raycolour-note').textContent = ray ? 'For the selected ray, and the next one you draw.' : 'For the next ray you draw.';
    document.querySelector('#rail .corner').style.setProperty('--rc', st.rayColour || 'var(--faint)');
  }

  /** Pick a colour: it applies to new rays and to the selected ray, if there is one.
      live: still choosing (the colour picker is being dragged), so no undo step yet. */
  function pickRayColour(c, live) {
    st.rayColour = c || null;
    store(RAY_COLOUR_KEY, c || '');
    var r = S.find(st.scene, st.sel);
    if (S.isRay(r)) { r.color = st.rayColour; if (!live) commit(); }
    syncRayColour(); redraw();
  }
  document.querySelectorAll('#raycolour [data-colour]').forEach(function (b) {
    b.addEventListener('click', function () { pickRayColour(b.dataset.colour); });
  });
  $('raycolour-any').addEventListener('input', function () { pickRayColour(this.value, true); });
  $('raycolour-any').addEventListener('change', function () { pickRayColour(this.value); });
  document.querySelector('#rail .corner').addEventListener('click', function (e) {
    e.stopPropagation();                                   // the corner opens options; it does not pick the tool
    if ($('raycolour').hidden) openRayColour(); else closePopovers();
  });
  document.querySelector('#rail [data-tool=ray]').addEventListener('contextmenu', function (e) {
    e.preventDefault(); openRayColour();                   // right-click works too
  });

  /** Draw ordinary rays or dashed helper rays: the Ray tool's two kinds (keys R and H). The
      rail button shows which kind is active. */
  function setRayKind(helper) {
    st.helper = !!helper;
    var btn = document.querySelector('#rail [data-tool=ray]');
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
    var m = S.find(st.scene, id);
    if (!m || m.type !== 'mirror') return;
    scan = { id: id, base: m.tilt, t0: performance.now() };
    requestAnimationFrame(scanStep);
    panel.sync();
  }
  function scanStep(now) {
    if (!scan) return;
    var m = S.find(st.scene, scan.id);
    if (!m) { scan = null; return; }
    m.tilt = scan.base + m.range * Math.sin(2 * Math.PI * (now - scan.t0) / SCAN_PERIOD);
    m.tilt = Math.round(m.tilt * 100) / 100;
    panel.sync(); redraw();
    requestAnimationFrame(scanStep);
  }
  /** Stop scanning and put the tilt back (quiet: no redraw, e.g. before a restore). */
  function stopScan(quiet) {
    if (!scan) return;
    var m = S.find(st.scene, scan.id);
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

  var POPOVERS = ['menu', 'settings', 'help', 'raycolour'];

  /** Show or hide a popover, closing the others; marks its rail button as open. */
  function toggle(id, show) {
    POPOVERS.forEach(function (p) {
      var open = p === id ? (show == null ? $(p).hidden : show) : false;
      $(p).hidden = !open;
      var btn = document.querySelector('#rail [data-act=' + p + ']');
      if (btn) btn.classList.toggle('on', open);
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
    if (!$('menu').hidden || !$('settings').hidden || !$('raycolour').hidden) toggle(null);
  }, true);
  $('set-follow').addEventListener('change', function () {
    st.scene.settings.follow = this.checked;
    commit();
    toast(this.checked ? 'Rays now follow when the optics move.' : 'Rays now stay put when the optics move.');
  });
  $('set-colour').addEventListener('change', function () {
    st.scene.settings.colour = this.checked;
    commit(); panel.sync(); redraw();
  });

  // ---------------------------------------------------------------- start up

  setTheme(stored(THEME_KEY) || 'light');
  new ResizeObserver(resize).observe(stage);
  resize();
  var saved = stored(STORE_KEY), restored = false;
  if (saved) {
    try { setScene(S.fromJSON(saved)); restored = st.scene.elements.length > 0; }
    catch (err) { setScene(S.create()); }
  } else setScene(S.create());
  commit();
  if (restored) fit();
  else { view.s = 3; view.ox = W * 0.35; view.oy = H / 2; }
  setTool('select');

  RM.app = { st: st, view: view, hist: hist };    // handy from the browser console
})();
