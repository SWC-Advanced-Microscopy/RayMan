/* RayMan rays: solving hand-drawn rays from what they are pinned to, finding the images they
   form, recognising principal rays, snapping a segment while it is being drawn, and "baking"
   pins into fixed coordinates. Pure functions, no DOM.

   The ray format is described at the top of scene.js. In short, each point of a ray says
   why it is where it is ("on lens L1", "through F′ of L1", "parallel to the axis", ...), so
   moving a lens or changing f moves the rays with it.

   Images are never stored: they are found from the rays. When two rays from the same source
   point (an object tip, a point source, or another image) cross after a lens, that crossing
   is the image of the source through the lens. It is real if the drawn segments actually
   reach it, virtual if the rays diverge and only their backward extensions meet. An image is
   referred to as { img: { src: ref, lens: lensId } } and can itself be a source. */
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

  /** A string naming a ref: equal strings mean the same point. */
  function refKey(ref) {
    if (!ref) return '';
    if (ref.img) return 'img(' + refKey(ref.img.src) + '@' + ref.img.lens + ')';
    if (ref.ray != null) return 'ray:' + ref.ray + ':' + ref.k;
    return ref.el + ':' + ref.pt;
  }
  function sameRef(a, b) { return !!a && !!b && refKey(a) === refKey(b); }

  /** The point a ray's light comes from: the ref its start is pinned to, followed back through
      rays branching from other rays. Null for a ray that starts at a free point. */
  function raySource(scene, r) {
    for (var depth = 0; r && r.start.at && depth < 100; depth++) {
      var a = r.start.at;
      if (a.ray == null) return a;
      r = rayById(scene, a.ray);
    }
    return null;
  }

  /** Is the image of this source an arrow (from an object arrow) rather than a point? */
  function isArrow(src) {
    while (src && src.img) src = src.img.src;
    return !!src && src.pt === 'tip';
  }

  /** The element at the root of a chain of images (the object or point source), or null. */
  function rootElement(scene, src) {
    while (src && src.img) src = src.img.src;
    return src && src.el ? element(scene, src.el) : null;
  }

  // ---------------------------------------------------------------- solving

  /** Solves rays and images on demand, remembering results. Rays and images can depend on each
      other (a ray from an image, an image from rays); a loop is broken by treating the inner
      request as unsolvable, and anything computed during such a loop is not remembered. */
  function Solver(scene) {
    this.scene = scene; this.rays = {}; this.imgs = {}; this.busy = {}; this.tainted = false;
  }
  Solver.prototype.memo = function (store, key, compute) {
    if (Object.prototype.hasOwnProperty.call(store, key)) return store[key];
    if (this.busy[key]) { this.tainted = true; return null; }
    var outer = this.tainted;
    this.busy[key] = true; this.tainted = false;
    var res = compute.call(this);
    this.busy[key] = false;
    if (!this.tainted) store[key] = res;
    this.tainted = outer || this.tainted;
    return res;
  };
  /** { pts: [{z, y}], lens: [lensId or null per point], ok } for a ray, or null. */
  Solver.prototype.ray = function (id) {
    return this.memo(this.rays, 'ray:' + id, function () {
      var r = rayById(this.scene, id);
      return r ? solveRay(this.scene, r, this) : null;
    });
  };
  /** The image of src through lens lensId: { z, y, virtual, src, lens, rays } or null. */
  Solver.prototype.image = function (src, lensId) {
    return this.memo(this.imgs, 'img:' + refKey(src) + '@' + lensId, function () {
      return findImage(this, src, lensId);
    });
  };

  /** Where a ref points now, or null if its target has gone. */
  function refPos(scene, ref, sv) {
    if (ref.img) {
      var im = sv.image(ref.img.src, ref.img.lens);
      return im ? { z: im.z, y: im.y } : null;
    }
    if (ref.ray != null) {
      var r = sv.ray(ref.ray), p = r && r.pts[ref.k];
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
  function refLens(ref, sv) {
    if (ref.ray != null) { var r = sv.ray(ref.ray); return (r && r.lens[ref.k]) || null; }
    return ref.pt === 'C' ? ref.el : null;
  }

  function solveRay(scene, r, sv) {
    var res = { pts: [], lens: [], ok: true };
    var p = r.start.at ? refPos(scene, r.start.at, sv) : { z: r.start.z, y: r.start.y };
    if (!p) { res.ok = false; return res; }
    res.pts.push(p);
    res.lens.push(r.start.at ? refLens(r.start.at, sv) : null);
    for (var k = 0; k < r.nodes.length; k++) {
      var q = solveNode(scene, r.nodes[k], res.pts, sv);
      if (!q) { res.ok = false; break; }
      res.pts.push(q.p); res.lens.push(q.lens);
    }
    return res;
  }

  /** Slope of a segment's direction: a number, null for "free" (the end fixes it), or
      undefined if it cannot be worked out. */
  function dirSlope(scene, d, pts, sv) {
    var P = pts[pts.length - 1];
    if (d.kind === 'parallel') return 0;
    if (d.kind === 'slope') return d.u;
    if (d.kind === 'free') return null;
    if (d.kind === 'straight') {
      var Q = pts[pts.length - 2];
      return Q && Math.abs(P.z - Q.z) > EPS ? (P.y - Q.y) / (P.z - Q.z) : undefined;
    }
    if (d.kind === 'through') {
      var A = refPos(scene, d.at, sv);
      return A && Math.abs(A.z - P.z) > EPS ? (A.y - P.y) / (A.z - P.z) : undefined;
    }
    return undefined;
  }

  /** Place the next point of a ray after pts. Returns { p, lens } or null. */
  function solveNode(scene, n, pts, sv) {
    var P = pts[pts.length - 1], e = n.end;
    if (e.kind === 'at') {
      var A = refPos(scene, e.at, sv);
      return A && { p: A, lens: refLens(e.at, sv) };
    }
    var u = dirSlope(scene, n.dir, pts, sv);
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

  /** Distance from X to the infinite line through a and b. */
  function lineDist(X, a, b) {
    var dz = b.z - a.z, dy = b.y - a.y;
    return Math.abs((X.z - a.z) * dy - (X.y - a.y) * dz) / Math.hypot(dz, dy);
  }

  /** Position of X along segment a-b (0 at a, 1 at b). */
  function along(X, a, b) {
    var dz = b.z - a.z, dy = b.y - a.y;
    return ((X.z - a.z) * dz + (X.y - a.y) * dy) / (dz * dz + dy * dy);
  }

  /** The image of src through a lens, from the segments leaving that lens on rays from src.
      The first pair of rays (in drawing order) that cross decides it. */
  function findImage(sv, src, lensId) {
    var scene = sv.scene, L = element(scene, lensId), key = refKey(src), segs = [];
    if (!L || L.type !== 'lens') return null;
    scene.rays.forEach(function (r) {
      if (refKey(raySource(scene, r)) !== key) return;
      var s = sv.ray(r.id);
      if (!s) return;
      for (var k = 0; k + 1 < s.pts.length; k++) {
        if (s.lens[k] !== lensId) continue;
        var a = s.pts[k], b = s.pts[k + 1];
        if (Math.hypot(b.z - a.z, b.y - a.y) > EPS) segs.push({ ray: r.id, k: k, a: a, b: b });
        break;
      }
    });
    var e = 1e-6;
    for (var i = 0; i < segs.length; i++) {
      for (var j = i + 1; j < segs.length; j++) {
        var s1 = segs[i], s2 = segs[j], X = G.lineIntersection(s1.a, s1.b, s2.a, s2.b);
        if (!X) continue;
        var t1 = along(X, s1.a, s1.b), t2 = along(X, s2.a, s2.b), virtual;
        if (t1 > e && t2 > e && t1 <= 1 + e && t2 <= 1 + e) virtual = false;   // the drawn rays meet
        else if (t1 < -e && t2 < -e) virtual = true;                            // they spread from a point behind
        else continue;
        var through = segs.filter(function (s) {                               // every ray consistent with it
          return lineDist(X, s.a, s.b) <= 1e-3 * (1 + G.dist(X, s.a));
        }).map(function (s) { return { ray: s.ray, k: s.k, a: s.a }; });
        return { z: X.z, y: X.y, virtual: virtual, src: src, lens: lensId, arrow: isArrow(src), rays: through };
      }
    }
    return null;
  }

  /** Which principal ray is this, judged where it reaches the first lens after its start:
      'parallel' (comes in parallel to the axis), 'focal' (comes in through F), 'central'
      (hits the lens centre), or null. */
  function classify(scene, s) {
    if (!s) return null;
    for (var k = 1; k < s.pts.length; k++) {
      if (!s.lens[k]) continue;
      var L = element(scene, s.lens[k]);
      var a = s.pts[k - 1], b = s.pts[k];
      if (!L || Math.abs(b.z - a.z) < EPS) return null;
      var u = (b.y - a.y) / (b.z - a.z), tol = 2e-3 * Math.abs(L.f) + 1e-6;
      var centre = Math.abs(b.y) <= tol, flat = Math.abs(u) <= 2e-3;
      if (centre && flat) return null;                       // along the axis itself
      if (centre) return 'central';
      if (flat) return 'parallel';
      return Math.abs(a.y + u * (L.z - L.f - a.z)) <= tol ? 'focal' : null;
    }
    return null;
  }

  /** Solve the whole bench: { rays: { id: solved ray }, images: [image], roles: { id: role } }.
      Each solved ray also has `shown`, the points to draw: a ray whose last segment forms a
      real image is drawn ending at the image (`trimmed`), not beyond it. */
  function solveScene(scene) {
    var sv = new Solver(scene), rays = {}, roles = {}, images = [], seen = {};
    scene.rays.forEach(function (r) {
      var s = sv.ray(r.id) || { pts: [], lens: [], ok: false };
      rays[r.id] = { pts: s.pts, lens: s.lens, ok: s.ok, shown: s.pts, trimmed: false };
      roles[r.id] = classify(scene, s);
    });
    var lenses = scene.elements.filter(function (e) { return e.type === 'lens'; });
    scene.rays.forEach(function (r) {
      var src = raySource(scene, r), key = refKey(src);
      if (!src || seen[key]) return;
      seen[key] = true;
      lenses.forEach(function (L) { var im = sv.image(src, L.id); if (im) images.push(im); });
    });
    images.forEach(function (im) {
      if (im.virtual) return;
      im.rays.forEach(function (rr) {
        var s = rays[rr.ray];
        if (!s || rr.k + 2 !== s.pts.length) return;                 // only a ray's last segment
        var t = along(im, s.pts[rr.k], s.pts[rr.k + 1]);
        if (t <= 1e-6 || t > 1 + 1e-6) return;
        s.shown = s.pts.slice(0, rr.k + 1).concat([{ z: im.z, y: im.y }]);
        s.trimmed = true;
      });
    });
    return { rays: rays, images: images, roles: roles, solver: sv };
  }

  /** Once rays form a real image they are drawn ending there. So that the image keeps forming
      when the optics change, lengthen the last segment of each ray through a real image to
      the next lens or the edge (it is still drawn only as far as the image). Returns true if
      anything changed. tol: aperture tolerance (world units). */
  function extendToImages(scene, tol) {
    var sol = solveScene(scene), changed = false;
    sol.images.forEach(function (im) {
      if (im.virtual) return;
      im.rays.forEach(function (rr) {
        var r = rayById(scene, rr.ray), s = sol.rays[rr.ray], last = s && s.pts.length - 1;
        if (!r || !r.nodes.length || rr.k + 1 !== last) return;
        var node = extendNode(scene, r.nodes[r.nodes.length - 1], s.pts[rr.k], s.pts[last], tol);
        if (!node) return;
        bake(scene, function (ref) { return ref.ray === r.id && ref.k === last; });
        r.nodes[r.nodes.length - 1] = node;
        changed = true;
      });
    });
    return changed;
  }

  /** Just the solved rays: { rayId: { pts, lens, ok } }. */
  function solveAll(scene) { return solveScene(scene).rays; }

  /** A few words naming what a ref points at, for hints: "F′ of L1", "the image". */
  function refName(scene, ref, sol) {
    if (ref.img) {
      var im = sol && sol.solver.image(ref.img.src, ref.img.lens);
      return im && im.virtual ? 'the virtual image' : 'the image';
    }
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

  /** Before making change(scene): free every pin matching pred, and every pin to an image that
      the change would make disappear, keeping the rays' shapes. (The change is tried on a
      copy first to see which images survive.) */
  function bakeBefore(scene, change, pred) {
    var trial = JSON.parse(JSON.stringify(scene)), after = {};
    change(trial);
    solveScene(trial).images.forEach(function (im) { after[refKey({ img: { src: im.src, lens: im.lens } })] = true; });
    bake(scene, function (ref) { return pred(ref) || (!!ref.img && !after[refKey(ref)]); });
  }

  /** Before removing element or ray `id` with remove(scene, id): free whatever is pinned to it. */
  function bakeRefsTo(scene, id, remove) {
    bakeBefore(scene, function (s) { remove(s, id); },
      function (ref) { return ref.el === id || ref.ray === id; });
  }

  // ---------------------------------------------------------------- drawing

  /** Points a ray can start from or be aimed through: [{ ref, p }]. Elements come first so
      they win ties with images and ray points lying on top of them. sol = solveScene(scene). */
  function anchors(scene, sol) {
    var out = [];
    function add(ref) { var p = refPos(scene, ref, sol.solver); if (p) out.push({ ref: ref, p: p }); }
    scene.elements.forEach(function (e) {
      if (e.type === 'lens') { add({ el: e.id, pt: 'C' }); add({ el: e.id, pt: 'F' }); add({ el: e.id, pt: 'Fp' }); }
      else if (e.type === 'object') add({ el: e.id, pt: 'tip' });
      else if (e.type === 'point') add({ el: e.id, pt: 'src' });
    });
    sol.images.forEach(function (im) {
      out.push({ ref: { img: { src: im.src, lens: im.lens } }, p: { z: im.z, y: im.y } });
    });
    scene.rays.forEach(function (r) {
      (sol.rays[r.id] ? sol.rays[r.id].pts : []).forEach(function (p, k) {
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
  function proposeStart(scene, sol, C, opt) {
    if (!opt.free) {
      var a = nearestAnchor(anchors(scene, sol), C, opt.tol);
      if (a) return { start: { at: a.ref }, p: a.p, text: 'from ' + refName(scene, a.ref, sol) };
    }
    var z = opt.free || !opt.grid ? C.z : G.quantize(C.z, opt.grid);
    var y = opt.free ? C.y : Math.abs(C.y) <= opt.tol ? 0 : opt.grid ? G.quantize(C.y, opt.grid) : C.y;
    if (!opt.free) {                         // a grid point that lands exactly on something is that thing
      var on = nearestAnchor(anchors(scene, sol), { z: z, y: y }, 1e-9);
      if (on && on.ref.ray == null) return { start: { at: on.ref }, p: on.p, text: 'from ' + refName(scene, on.ref, sol) };
    }
    return { start: { z: z, y: y }, p: { z: z, y: y }, text: y === 0 && !opt.free ? 'on the axis' : '' };
  }

  /** Propose the next segment of a ray being drawn from P (the point before it is Q, or null)
      toward the cursor C. The direction snaps to: through an anchor (F, F′, a lens centre,
      the object tip, an image, a point on another ray), straight on, or parallel to the axis.
      The segment stops at the first lens it reaches (if the cursor is at or past it), else at
      the cursor. opt: { tol (world units), free }. sol = solveScene(scene).
      Returns { node, p, hints: [{ z, y, text }], axis, text } or null. */
  function proposeSegment(scene, sol, P, Q, C, opt) {
    var tol = opt.tol, dz = C.z - P.z, dy = C.y - P.y;
    if (Math.hypot(dz, dy) < tol) return null;
    var best = null;
    function offer(err, cand) { if (err <= tol && (!best || err < best.err)) { cand.err = err; best = cand; } }

    if (!opt.free) {
      anchors(scene, sol).forEach(function (a) {
        var az = a.p.z - P.z, ay = a.p.y - P.y, al = Math.hypot(az, ay);
        if (al < tol || Math.abs(az) < EPS || az * dz + ay * dy <= 0) return;   // on P, vertical, or behind
        var weight = a.ref.ray != null ? 1 : 0.7;     // F, F′, centres, images win over points on rays
        offer(weight * Math.abs(az * dy - ay * dz) / al, {                      // C's distance from line P-A
          dir: { kind: 'through', at: a.ref }, u: ay / az, sgn: az > 0 ? 1 : -1, anchor: a,
          hint: { z: a.p.z, y: a.p.y, text: 'through ' + refName(scene, a.ref, sol) }
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
    var hit = nextLens(scene, P, u, sgn, tol), node, p, more = null;
    if (hit && (C.z - hit.lens.z) * sgn >= -tol) {                    // reached a lens: stop on it
      p = { z: hit.lens.z, y: hit.y };
      node = { dir: best.dir, end: free ? { kind: 'lens', el: hit.lens.id, y: hit.y } : { kind: 'lens', el: hit.lens.id } };
      hints.push({ z: p.z, y: p.y, text: '', small: true });
      var at = best.dir.at;
      if (at && at.el === hit.lens.id && at.pt === 'C' && (C.z - hit.lens.z) * sgn > tol) {
        // through the centre and on: light there is undeviated, so carry straight on in the same click
        more = straightOn(scene, p, u, sgn, C, tol);
        text = (text ? text + ', ' : '') + 'straight on' + (more.lens ? ' to ' + (more.lens.label || 'the next lens') : '');
      } else text = (text ? text + ', ' : '') + 'to ' + (hit.lens.label || 'the lens');
    } else if (best.anchor && G.dist(C, best.anchor.p) <= tol) {      // ending on the anchor itself
      p = { z: best.anchor.p.z, y: best.anchor.p.y };
      node = { dir: best.dir, end: { kind: 'at', at: best.anchor.ref } };
      text = 'to ' + refName(scene, best.anchor.ref, sol);
    } else if (free) {
      p = { z: C.z, y: C.y };
      node = { dir: best.dir, end: { kind: 'z', z: C.z, y: C.y } };
    } else {                                                          // the cursor projected onto the line
      var t = (dz + u * dy) / (1 + u * u);
      p = { z: P.z + t, y: P.y + u * t };
      node = { dir: best.dir, end: { kind: 'z', z: p.z } };
    }
    var nodes = [node], pts = [p];
    if (more) { nodes.push(more.node); pts.push(more.p); }
    return { node: node, nodes: nodes, p: pts[pts.length - 1], pts: pts, hints: hints, axis: !!best.axis, text: text };
  }

  /** The "straight on" segment after the lens centre at p (slope u, direction sgn), stopping
      at the next lens if the cursor C is at or past it, else at C projected onto the line. */
  function straightOn(scene, p, u, sgn, C, tol) {
    var hit = nextLens(scene, p, u, sgn, tol);
    if (hit && (C.z - hit.lens.z) * sgn >= -tol) {
      return { node: { dir: { kind: 'straight' }, end: { kind: 'lens', el: hit.lens.id } },
        p: { z: hit.lens.z, y: hit.y }, lens: hit.lens };
    }
    var t = ((C.z - p.z) + u * (C.y - p.y)) / (1 + u * u);
    return { node: { dir: { kind: 'straight' }, end: { kind: 'z', z: p.z + t } }, p: { z: p.z + t, y: p.y + u * t }, lens: null };
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
    FAR: FAR, refKey: refKey, refPos: refPos, refName: refName, sameRef: sameRef,
    raySource: raySource, rootElement: rootElement, classify: classify,
    solveScene: solveScene, solveAll: solveAll,
    extendToImages: extendToImages,
    bake: bake, bakeAll: bakeAll, bakeBefore: bakeBefore, bakeRefsTo: bakeRefsTo, anchors: anchors, nextLens: nextLens,
    proposeStart: proposeStart, proposeSegment: proposeSegment, extendNode: extendNode
  };
});
