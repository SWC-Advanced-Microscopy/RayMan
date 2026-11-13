/* RayMan rays: solving hand-drawn rays from what they are pinned to, snapping a segment while
   it is being drawn, and "baking" pins into fixed coordinates. Pure functions, no DOM.

   The ray format is described at the top of scene.js. In short, each point of a ray says
   why it is where it is ("on lens L1", "through F′ of L1", "parallel to the axis", ...), so
   moving a lens or changing f moves the rays with it. */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var m = factory(node ? require('./geom.js') : root.RM.geom);
  if (node) module.exports = m;
  else root.RM.rays = m;
})(typeof self !== 'undefined' ? self : this, function (G) {
  'use strict';

  var FAR = 1e5;          // mm: how far a ray "to the edge" goes
  var EPS = 1e-9;

  function element(scene, id) {
    for (var i = 0; i < scene.elements.length; i++) if (scene.elements[i].id === id) return scene.elements[i];
    return null;
  }
  function rayById(scene, id) {
    for (var i = 0; i < scene.rays.length; i++) if (scene.rays[i].id === id) return scene.rays[i];
    return null;
  }

  // ---------------------------------------------------------------- references

  /** Where a ref points now, or null if its target has gone. solve(id) gives another ray. */
  function refPos(scene, ref, solve) {
    if (ref.ray != null) {
      var r = solve(ref.ray), p = r && r.pts[ref.k];
      return p ? { z: p.z, y: p.y } : null;
    }
    var e = element(scene, ref.el);
    if (!e) return null;
    if (ref.pt === 'tip' && e.type === 'object') return { z: e.z, y: e.h };
    if (ref.pt === 'src' && e.type === 'point') return { z: e.z, y: e.y };
    if (e.type === 'lens') {
      if (ref.pt === 'C') return { z: e.z, y: 0 };
      if (ref.pt === 'F') return { z: e.z - e.f, y: 0 };
      if (ref.pt === 'Fp') return { z: e.z + e.f, y: 0 };
    }
    return null;
  }

  /** The lens a ref sits on (its centre, or a ray point on a lens), else null. */
  function refLens(ref, solve) {
    if (ref.ray != null) { var r = solve(ref.ray); return (r && r.lens[ref.k]) || null; }
    return ref.pt === 'C' ? ref.el : null;
  }

  /** A few words naming what a ref points at, for hints: "F′ of L1". */
  function refName(scene, ref) {
    if (ref.ray != null) return 'a point on a ray';
    var e = element(scene, ref.el), n = e && e.label ? e.label : 'the lens';
    switch (ref.pt) {
      case 'tip': return 'the object tip';
      case 'src': return 'the point source';
      case 'C': return 'the centre of ' + n;
      case 'F': return 'F of ' + n;
      case 'Fp': return 'F′ of ' + n;
    }
    return '?';
  }

  function sameRef(a, b) {
    return !!a && !!b && (a.ray != null ? a.ray === b.ray && a.k === b.k : a.el === b.el && a.pt === b.pt);
  }

  // ---------------------------------------------------------------- solving

  /** Solve every ray. Returns { rayId: { pts: [{z, y}], lens: [lensId or null per point], ok } }.
      A ray whose pin has gone is cut short at the last point that could be placed (ok = false). */
  function solveAll(scene) {
    var out = {}, busy = {};
    function solve(id) {
      if (out[id]) return out[id];
      if (busy[id]) return null;                       // rays pinned to each other in a loop
      var r = rayById(scene, id);
      if (!r) return null;
      busy[id] = true;
      out[id] = solveRay(scene, r, solve);
      busy[id] = false;
      return out[id];
    }
    scene.rays.forEach(function (r) { solve(r.id); });
    return out;
  }

  function solveRay(scene, r, solve) {
    var res = { pts: [], lens: [], ok: true };
    var p = r.start.at ? refPos(scene, r.start.at, solve) : { z: r.start.z, y: r.start.y };
    if (!p) { res.ok = false; return res; }
    res.pts.push(p);
    res.lens.push(r.start.at ? refLens(r.start.at, solve) : null);
    for (var k = 0; k < r.nodes.length; k++) {
      var q = solveNode(scene, r.nodes[k], res.pts, solve);
      if (!q) { res.ok = false; break; }
      res.pts.push(q.p); res.lens.push(q.lens);
    }
    return res;
  }

  /** Slope of a segment's direction: a number, null for "free" (the end fixes it), or
      undefined if it cannot be worked out. */
  function dirSlope(scene, d, pts, solve) {
    var P = pts[pts.length - 1];
    if (d.kind === 'parallel') return 0;
    if (d.kind === 'slope') return d.u;
    if (d.kind === 'free') return null;
    if (d.kind === 'straight') {
      var Q = pts[pts.length - 2];
      return Q && Math.abs(P.z - Q.z) > EPS ? (P.y - Q.y) / (P.z - Q.z) : undefined;
    }
    if (d.kind === 'through') {
      var A = refPos(scene, d.at, solve);
      return A && Math.abs(A.z - P.z) > EPS ? (A.y - P.y) / (A.z - P.z) : undefined;
    }
    return undefined;
  }

  /** Place the next point of a ray after pts. Returns { p, lens } or null. */
  function solveNode(scene, n, pts, solve) {
    var P = pts[pts.length - 1], e = n.end;
    if (e.kind === 'at') {
      var A = refPos(scene, e.at, solve);
      return A && { p: A, lens: refLens(e.at, solve) };
    }
    var u = dirSlope(scene, n.dir, pts, solve);
    if (u === undefined) return null;
    var z, lens = null;
    if (e.kind === 'lens') {
      var L = element(scene, e.el);
      if (!L || L.type !== 'lens') return null;
      z = L.z; lens = L.id;
    } else if (e.kind === 'z') z = e.z;
    else if (e.kind === 'edge') { if (u === null) return null; z = P.z + e.sgn * FAR; }
    else return null;
    if (u === null) return e.y == null ? null : { p: { z: z, y: e.y }, lens: lens };
    return { p: { z: z, y: P.y + u * (z - P.z) }, lens: lens };
  }

  // ---------------------------------------------------------------- baking

  /** The refs a node depends on. A node lying on a lens offers { el, pt: 'plane' }. */
  function nodeRefs(n) {
    var out = [];
    if (n.dir.at) out.push(n.dir.at);
    if (n.end.at) out.push(n.end.at);
    if (n.end.kind === 'lens') out.push({ el: n.end.el, pt: 'plane' });
    return out;
  }

  /** Replace every pin for which pred(ref) is true with fixed coordinates, leaving each ray
      exactly where it is now. Points that can no longer be placed are dropped, and rays that
      cannot even start are removed. */
  function bake(scene, pred) {
    var solved = solveAll(scene);
    scene.rays = scene.rays.filter(function (r) { return solved[r.id] && solved[r.id].pts.length; });
    scene.rays.forEach(function (r) {
      var s = solved[r.id];
      if (r.start.at && pred(r.start.at)) r.start = { z: s.pts[0].z, y: s.pts[0].y };
      r.nodes.length = Math.min(r.nodes.length, s.pts.length - 1);
      r.nodes.forEach(function (n, k) {
        if (!nodeRefs(n).some(pred)) return;
        var P = s.pts[k], Q = s.pts[k + 1];
        if (n.end.kind === 'edge') n.dir = { kind: 'slope', u: (Q.y - P.y) / (Q.z - P.z) };
        else r.nodes[k] = { dir: { kind: 'free' }, end: { kind: 'z', z: Q.z, y: Q.y } };
      });
    });
  }

  function bakeAll(scene) { bake(scene, function () { return true; }); }

  /** Before deleting element or ray `id`: free every ray that is pinned to it. */
  function bakeRefsTo(scene, id) {
    bake(scene, function (ref) { return ref.el === id || ref.ray === id; });
  }

  // ---------------------------------------------------------------- drawing

  /** Points a ray can start from or be aimed through: [{ ref, p }]. Elements come first so
      they win ties with ray points lying on top of them. */
  function anchors(scene, solved) {
    var out = [], solve = function (id) { return solved[id]; };
    function add(ref) { var p = refPos(scene, ref, solve); if (p) out.push({ ref: ref, p: p }); }
    scene.elements.forEach(function (e) {
      if (e.type === 'lens') { add({ el: e.id, pt: 'C' }); add({ el: e.id, pt: 'F' }); add({ el: e.id, pt: 'Fp' }); }
      else if (e.type === 'object') add({ el: e.id, pt: 'tip' });
      else if (e.type === 'point') add({ el: e.id, pt: 'src' });
    });
    scene.rays.forEach(function (r) {
      (solved[r.id] ? solved[r.id].pts : []).forEach(function (p, k) {
        if (Math.abs(p.z) < FAR / 2) out.push({ ref: { ray: r.id, k: k }, p: p });
      });
    });
    return out;
  }

  /** The first lens met going from P with slope u in direction sgn (+1 = to the right), if
      the ray hits it within its aperture (plus tol). Returns { lens, y } or null. */
  function nextLens(scene, P, u, sgn, tol) {
    var best = null, bestD = Infinity;
    scene.elements.forEach(function (L) {
      if (L.type !== 'lens') return;
      var d = (L.z - P.z) * sgn, y = P.y + u * (L.z - P.z);
      if (d > 1e-6 && d < bestD && Math.abs(y) <= L.ap + (tol || 0)) { best = { lens: L, y: y }; bestD = d; }
    });
    return best;
  }

  /** The nearest anchor to C within tol, or null. */
  function nearestAnchor(list, C, tol) {
    var best = null, bestD = tol;
    list.forEach(function (a) {
      var d = G.dist(a.p, C);
      if (d <= bestD + 1e-12 && (!best || d < bestD)) { best = a; bestD = d; }
    });
    return best;
  }

  /** Where a ray would start for a click at C: on an anchor if close, else a free point
      snapped to the grid (and onto the axis). opt: { tol, grid, free }. */
  function proposeStart(scene, solved, C, opt) {
    if (!opt.free) {
      var a = nearestAnchor(anchors(scene, solved), C, opt.tol);
      if (a) return { start: { at: a.ref }, p: a.p, text: 'from ' + refName(scene, a.ref) };
    }
    var z = opt.free || !opt.grid ? C.z : G.quantize(C.z, opt.grid);
    var y = opt.free ? C.y : Math.abs(C.y) <= opt.tol ? 0 : opt.grid ? G.quantize(C.y, opt.grid) : C.y;
    return { start: { z: z, y: y }, p: { z: z, y: y }, text: y === 0 && !opt.free ? 'on the axis' : '' };
  }

  /** Propose the next segment of a ray being drawn from P (the point before it is Q, or null)
      toward the cursor C. The direction snaps to: through an anchor (F, F′, a lens centre,
      the object tip, a point on another ray), straight on, or parallel to the axis. The
      segment stops at the first lens it reaches (if the cursor is at or past it), else at
      the cursor. opt: { tol (world units), free }.
      Returns { node, p, hints: [{ z, y, text }], axis, text } or null. */
  function proposeSegment(scene, solved, P, Q, C, opt) {
    var tol = opt.tol, dz = C.z - P.z, dy = C.y - P.y;
    if (Math.hypot(dz, dy) < tol) return null;
    var best = null;
    function offer(err, cand) { if (err <= tol && (!best || err < best.err)) { cand.err = err; best = cand; } }

    if (!opt.free) {
      anchors(scene, solved).forEach(function (a) {
        var az = a.p.z - P.z, ay = a.p.y - P.y, al = Math.hypot(az, ay);
        if (al < tol || Math.abs(az) < EPS || az * dz + ay * dy <= 0) return;   // on P, vertical, or behind
        offer(0.7 * Math.abs(az * dy - ay * dz) / al, {                         // C's distance from line P-A
          dir: { kind: 'through', at: a.ref }, u: ay / az, sgn: az > 0 ? 1 : -1, anchor: a,
          hint: { z: a.p.z, y: a.p.y, text: 'through ' + refName(scene, a.ref) }
        });
      });
      if (Q && Math.abs(P.z - Q.z) > EPS) {
        var u0 = (P.y - Q.y) / (P.z - Q.z), s0 = P.z > Q.z ? 1 : -1;
        if (dz * s0 > 0) offer(0.85 * Math.abs(dy - u0 * dz) / Math.hypot(1, u0),
          { dir: { kind: 'straight' }, u: u0, sgn: s0, hint: { z: P.z, y: P.y, text: 'straight on' } });
      }
      if (Math.abs(dz) > EPS) offer(Math.abs(dy),
        { dir: { kind: 'parallel' }, u: 0, sgn: dz > 0 ? 1 : -1, axis: true, hint: { text: 'parallel to the axis' } });
    }
    if (!best) {
      if (Math.abs(dz) < EPS) return null;
      best = { dir: { kind: 'free' }, u: dy / dz, sgn: dz > 0 ? 1 : -1, hint: null };
    }

    var u = best.u, sgn = best.sgn, free = best.dir.kind === 'free';
    var hints = best.hint && best.hint.z != null ? [best.hint] : [];
    var text = best.hint ? best.hint.text : '';
    var hit = nextLens(scene, P, u, sgn, tol), node, p;
    if (hit && (C.z - hit.lens.z) * sgn >= -tol) {                    // reached a lens: stop on it
      p = { z: hit.lens.z, y: hit.y };
      node = { dir: best.dir, end: free ? { kind: 'lens', el: hit.lens.id, y: hit.y } : { kind: 'lens', el: hit.lens.id } };
      hints.push({ z: p.z, y: p.y, text: '', small: true });
      text = (text ? text + ', ' : '') + 'to ' + (hit.lens.label || 'the lens');
    } else if (best.anchor && G.dist(C, best.anchor.p) <= tol) {      // ending on the anchor itself
      p = { z: best.anchor.p.z, y: best.anchor.p.y };
      node = { dir: best.dir, end: { kind: 'at', at: best.anchor.ref } };
      text = 'to ' + refName(scene, best.anchor.ref);
    } else if (free) {
      p = { z: C.z, y: C.y };
      node = { dir: best.dir, end: { kind: 'z', z: C.z, y: C.y } };
    } else {                                                          // the cursor projected onto the line
      var t = (dz + u * dy) / (1 + u * u);
      p = { z: P.z + t, y: P.y + u * t };
      node = { dir: best.dir, end: { kind: 'z', z: p.z } };
    }
    return { node: node, p: p, hints: hints, axis: !!best.axis, text: text };
  }

  /** Lengthen the last segment of a ray to the next lens, or to the edge if there is none.
      Returns the new node, or null if the segment cannot be extended. */
  function extendNode(scene, n, P, E, tol) {
    if (Math.abs(E.z - P.z) < EPS || n.end.kind === 'edge' || n.end.kind === 'lens') return null;
    var u = (E.y - P.y) / (E.z - P.z), sgn = E.z > P.z ? 1 : -1;
    var dir = n.dir.kind === 'free' ? { kind: 'slope', u: u } : n.dir;
    if (n.end.kind === 'at') dir = n.dir.kind === 'through' ? n.dir : { kind: 'slope', u: u };
    var hit = nextLens(scene, E, u, sgn, tol);
    return { dir: dir, end: hit ? { kind: 'lens', el: hit.lens.id } : { kind: 'edge', sgn: sgn } };
  }

  return {
    FAR: FAR, refPos: refPos, refName: refName, sameRef: sameRef, solveAll: solveAll,
    bake: bake, bakeAll: bakeAll, bakeRefsTo: bakeRefsTo, anchors: anchors, nextLens: nextLens,
    proposeStart: proposeStart, proposeSegment: proposeSegment, extendNode: extendNode
  };
});
