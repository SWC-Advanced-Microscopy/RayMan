/* RayMan rays: solving hand-drawn rays from what they are pinned to, finding the images they
   form, recognising principal rays, snapping a segment while it is being drawn, and "baking"
   pins into fixed coordinates. Pure functions, no DOM.

   The ray format is described at the top of scene.js. In short, each point of a ray says
   why it is where it is ("on lens L1", "through F′ of L1", "parallel to that ray", ...), so
   moving a lens, a mirror or changing f moves the rays with it.

   Images are never stored: they are found from the rays. When two rays from the same source
   cross after a lens, that crossing is the image of the source through the lens. It is real if
   the drawn segments actually reach it, virtual if the rays diverge and only their backward
   extensions meet. A source is an object tip, a point source, another image, or a point at
   infinity: rays starting from free points and drawn parallel to the axis, or parallel to one
   another, come from the same point at infinity, and the "image" they form is a focus. An image
   is referred to as { img: { src, lens } } and can itself be a source. Helper rays are
   construction lines: they never form images. */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var m = factory(node ? require('./geom.js') : root.RM.geom);
  if (node) module.exports = m;
  else root.RM.rays = m;
})(typeof self !== 'undefined' ? self : this, function (G) {
  'use strict';

  var FAR = 1e5;          // mm: how far a ray "to the edge" goes
  var EPS = 1e-9;
  var DEG = Math.PI / 180;

  function element(scene, id) {
    for (var i = 0; i < scene.elements.length; i++) if (scene.elements[i].id === id) return scene.elements[i];
    return null;
  }
  function rayById(scene, id) {
    for (var i = 0; i < scene.rays.length; i++) if (scene.rays[i].id === id) return scene.rays[i];
    return null;
  }
  /** Elements a ray stops on when it reaches them: lenses and scan mirrors. */
  function isStop(e) { return !!e && (e.type === 'lens' || e.type === 'mirror'); }
  /** Elements whose plane a ray point can lie on: those, and irises (where a blocked ray ends). */
  function isPlane(e) { return isStop(e) || (!!e && e.type === 'iris'); }
  function planeName(e) {
    return e.label || (e.type === 'mirror' ? 'the scan mirror' : e.type === 'iris' ? 'the iris' : 'the lens');
  }

  /** Where segment a-b first meets the blade of an iris (strictly between its ends), as
      { z, y, iris }, or null. A blade runs from the opening r out to the iris's size ap. */
  function blockAt(scene, a, b) {
    var best = null, bestT = Infinity;
    if (Math.abs(b.z - a.z) < EPS) return null;
    scene.elements.forEach(function (e) {
      if (e.type !== 'iris') return;
      var t = (e.z - a.z) / (b.z - a.z);
      if (t <= 1e-9 || t >= 1 - 1e-9 || t >= bestT) return;
      var y = a.y + t * (b.y - a.y), ay = Math.abs(y);
      if (ay > e.r + 1e-9 && ay <= e.ap + 1e-9) { best = { z: e.z, y: y, iris: e }; bestT = t; }
    });
    return best;
  }
  function slope(a, b) { return Math.abs(b.z - a.z) > EPS ? (b.y - a.y) / (b.z - a.z) : undefined; }

  // ---------------------------------------------------------------- references

  /** A string naming a ref: equal strings mean the same point. */
  function refKey(ref) {
    if (!ref) return '';
    if (ref.inf != null) return 'inf:' + ref.inf;
    if (ref.img) return 'img(' + refKey(ref.img.src) + '@' + ref.img.lens + ')';
    if (ref.ray != null && ref.plane) return 'ray:' + ref.ray + ':s' + ref.seg + ':' + ref.plane.el + ':' + ref.plane.pt;
    if (ref.ray != null) return 'ray:' + ref.ray + ':' + ref.k;
    return ref.el + ':' + ref.pt;
  }
  function sameRef(a, b) { return !!a && !!b && refKey(a) === refKey(b); }

  /** Does ref depend on element or ray `id`? */
  function mentions(ref, id) {
    if (!ref) return false;
    if (ref.img) return ref.img.lens === id || mentions(ref.img.src, id);
    return ref.el === id || ref.ray === id || (!!ref.plane && ref.plane.el === id);
  }

  /** Where a ray's light comes from: the ref its start is pinned to (followed back through rays
      branching from other rays); { inf: key } for light from a point at infinity; null for a
      helper ray. A ray from a free point is light from infinity: rays drawn parallel to the axis
      share { inf: 'axis' }, and rays drawn parallel to one of them share its source. */
  function raySource(scene, r) {
    for (var depth = 0; r && depth < 100; depth++) {
      if (r.helper) return null;
      if (r.start.at) {
        if (r.start.at.ray == null) return r.start.at;
        r = rayById(scene, r.start.at.ray);
        continue;
      }
      var d = r.nodes[0] && r.nodes[0].dir;
      if (d && d.kind === 'parallel') return { inf: 'axis' };
      if (d && d.kind === 'parallelTo') {
        var q = rayById(scene, d.ray);
        if (q && !q.helper && !q.start.at && q !== r) { r = q; continue; }
      }
      return { inf: r.id };
    }
    return null;
  }

  /** Is the image of this source an arrow (from an object arrow) rather than a point? */
  function isArrow(src) {
    while (src && src.img) src = src.img.src;
    return !!src && src.pt === 'tip';
  }
  function isInfinite(src) {
    while (src && src.img) src = src.img.src;
    return !!src && src.inf != null;
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
  function Solver(scene, opts) {
    this.scene = scene; this.rays = {}; this.imgs = {}; this.busy = {}; this.tainted = false;
    this.noBlock = !!(opts && opts.noBlock);     // ignore irises (to see where light would go)
    this.partial = {};      // rays being solved: the points placed so far are already final
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
  /** { pts: [{z, y}], lens: [plane element id or null per point], ok } for a ray, or null. */
  Solver.prototype.ray = function (id) {
    return this.memo(this.rays, 'ray:' + id, function () {
      var r = rayById(this.scene, id);
      return r ? solveRay(this.scene, r, this) : null;
    });
  };
  /** A ray with at least its first n points placed. A ray can depend on another that depends
      on an earlier part of the first (a ray aimed through a helper that is parallel to the
      ray's own first segment), so while a ray is being solved, the points it already has can
      be handed out. Returns null if those points are not available. */
  Solver.prototype.points = function (id, n) {
    var key = 'ray:' + id, part = this.partial[id];
    if (!Object.prototype.hasOwnProperty.call(this.rays, key) && this.busy[key] && part && part.pts.length >= n) return part;
    var r = this.ray(id);
    return r && r.pts.length >= n ? r : null;
  };
  /** The image of src through lens lensId: { z, y, virtual, focus, src, lens, rays } or null. */
  Solver.prototype.image = function (src, lensId) {
    return this.memo(this.imgs, 'img:' + refKey(src) + '@' + lensId, function () {
      return findImage(this, src, lensId);
    });
  };

  /** The two ends of segment seg of a ray, or null. */
  function segmentOf(sv, id, seg) {
    var r = sv.points(id, seg + 2);
    return r ? { a: r.pts[seg], b: r.pts[seg + 1] } : null;
  }

  /** z of a lens's front (F) or back (F′) focal plane. */
  function focalZ(L, pt) { return pt === 'F' ? L.z - L.f : L.z + L.f; }

  /** Where a ref points now, or null if its target has gone. */
  function refPos(scene, ref, sv) {
    if (ref.img) {
      var im = sv.image(ref.img.src, ref.img.lens);
      return im ? { z: im.z, y: im.y } : null;
    }
    if (ref.ray != null && ref.plane) {
      var sg = segmentOf(sv, ref.ray, ref.seg), L = element(scene, ref.plane.el);
      if (!sg || !L || L.type !== 'lens' || Math.abs(sg.b.z - sg.a.z) < EPS) return null;
      var zp = focalZ(L, ref.plane.pt);
      return { z: zp, y: G.yAtZ(sg.a, sg.b, zp) };
    }
    if (ref.ray != null) {
      var r = sv.points(ref.ray, ref.k + 1), p = r && r.pts[ref.k];
      return p ? { z: p.z, y: p.y } : null;
    }
    var e = element(scene, ref.el);
    if (!e) return null;
    if (ref.pt === 'tip' && e.type === 'object') return { z: e.z, y: e.h };
    if (ref.pt === 'src' && e.type === 'point') return { z: e.z, y: e.y };
    if (ref.pt === 'P' && e.type === 'mirror') return { z: e.z, y: 0 };
    if (e.type === 'iris') {
      if (ref.pt === 'C') return { z: e.z, y: 0 };
      if (ref.pt === 'Et') return { z: e.z, y: e.r };
      if (ref.pt === 'Eb') return { z: e.z, y: -e.r };
      return null;
    }
    if (e.type === 'lens') {
      if (ref.pt === 'C') return { z: e.z, y: 0 };
      if (ref.pt === 'F' || ref.pt === 'Fp') return { z: focalZ(e, ref.pt), y: 0 };
    }
    return null;
  }

  /** The lens or mirror a ref sits on (a lens centre, a mirror pivot, a ray point on one). */
  function refLens(ref, sv) {
    if (ref.ray != null && !ref.plane) { var r = sv.points(ref.ray, ref.k + 1); return (r && r.lens[ref.k]) || null; }
    return ref.pt === 'C' || ref.pt === 'P' ? ref.el : null;
  }

  function solveRay(scene, r, sv) {
    var res = { pts: [], lens: [], ok: true };
    sv.partial[r.id] = res;
    var p = r.start.at ? refPos(scene, r.start.at, sv) : { z: r.start.z, y: r.start.y };
    if (!p) { res.ok = false; return res; }
    res.pts.push(p);
    res.lens.push(r.start.at ? refLens(r.start.at, sv) : null);
    for (var k = 0; k < r.nodes.length; k++) {
      var q = solveNode(scene, r.nodes[k], res.pts, sv);
      if (!q) { res.ok = false; break; }
      var blk = r.helper || sv.noBlock ? null : blockAt(scene, res.pts[res.pts.length - 1], q.p);
      if (blk) {                     // stopped by an iris: the rest of the ray is not reached
        res.pts.push({ z: blk.z, y: blk.y }); res.lens.push(blk.iris.id); res.blocked = blk.iris.id;
        break;
      }
      res.pts.push(q.p); res.lens.push(q.lens);
    }
    return res;
  }

  /** Slope of a segment's direction: a number, null for "free" (the end fixes it), or
      undefined if it cannot be worked out. */
  function dirSlope(scene, d, pts, sv) {
    var P = pts[pts.length - 1], Q = pts[pts.length - 2];
    switch (d.kind) {
      case 'parallel': return 0;
      case 'slope': return d.u;
      case 'free': return null;
      case 'straight': return Q ? slope(Q, P) : undefined;
      case 'through':
        var A = refPos(scene, d.at, sv);
        return A ? slope(P, A) : undefined;
      case 'parallelTo':
        var sg = segmentOf(sv, d.ray, d.seg);
        return sg ? slope(sg.a, sg.b) : undefined;
      case 'deflect':
        var M = element(scene, d.el), uin = Q ? slope(Q, P) : 0;
        if (!M || M.type !== 'mirror' || uin === undefined) return undefined;
        return Math.tan(Math.atan(uin) + M.tilt * DEG);
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
      if (!isPlane(L)) return null;
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
        return { z: X.z, y: X.y, virtual: virtual, focus: isInfinite(src), src: src, lens: lensId,
          arrow: isArrow(src), rays: through };
      }
    }
    return null;
  }

  /** Which principal ray is this, judged where it reaches the first lens after its start
      (scan mirrors are passed over): 'parallel' (arrives parallel to the axis), 'focal'
      (arrives through F), 'central' (hits the lens centre), or null. */
  function classify(scene, s) {
    if (!s) return null;
    for (var k = 1; k < s.pts.length; k++) {
      var L = s.lens[k] && element(scene, s.lens[k]);
      if (!L || L.type !== 'lens') continue;
      var a = s.pts[k - 1], b = s.pts[k];
      if (Math.abs(b.z - a.z) < EPS) return null;
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
      real image of an object is drawn ending at the image (`trimmed`), not beyond it. A focus
      of light from infinity does not trim: the beam carries on, as through a relay. */
  function solveScene(scene, opts) {
    var sv = new Solver(scene, opts), rays = {}, roles = {}, images = [], seen = {};
    scene.rays.forEach(function (r) {
      var s = sv.ray(r.id) || { pts: [], lens: [], ok: false };
      rays[r.id] = { pts: s.pts, lens: s.lens, ok: s.ok, shown: s.pts, trimmed: false, blocked: s.blocked || null };
      roles[r.id] = r.helper ? null : classify(scene, s);
    });
    var lenses = scene.elements.filter(function (e) { return e.type === 'lens'; });
    scene.rays.forEach(function (r) {
      var src = raySource(scene, r), key = refKey(src);
      if (!src || seen[key]) return;
      seen[key] = true;
      lenses.forEach(function (L) { var im = sv.image(src, L.id); if (im) images.push(im); });
    });
    images.forEach(function (im) {
      if (im.virtual || im.focus) return;
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

  /** Just the solved rays: { rayId: { pts, lens, ok, shown, trimmed } }. */
  function solveAll(scene) { return solveScene(scene).rays; }

  /** A few words naming what a ref points at, for hints: "F′ of L1", "the image". */
  function refName(scene, ref, sol) {
    if (ref.img) {
      var im = sol && sol.solver.image(ref.img.src, ref.img.lens);
      return im && im.focus ? 'the focus' : im && im.virtual ? 'the virtual image' : 'the image';
    }
    if (ref.ray != null && ref.plane) {
      var L = element(scene, ref.plane.el);
      return 'that ray at the ' + (ref.plane.pt === 'Fp' ? 'back' : 'front') + ' focal plane' +
        (L && L.label ? ' of ' + L.label : '');
    }
    if (ref.ray != null) return 'a point on a ray';
    var e = element(scene, ref.el), n = e && e.label ? e.label : 'the lens';
    switch (ref.pt) {
      case 'tip': return 'the object tip';
      case 'src': return 'the point source';
      case 'P': return 'the scan mirror';
      case 'Et': case 'Eb': return 'the edge of ' + (e && e.label ? 'iris ' + e.label : 'the iris');
      case 'C': return 'the centre of ' + (e && e.type === 'iris' ? (e.label ? 'iris ' + e.label : 'the iris') : n);
      case 'F': return 'F of ' + n;
      case 'Fp': return 'F′ of ' + n;
    }
    return '?';
  }

  // ---------------------------------------------------------------- baking

  /** The refs a node depends on. A node lying on a lens or mirror offers { el, pt: 'plane' }. */
  function nodeRefs(n) {
    var out = [];
    if (n.dir.at) out.push(n.dir.at);
    if (n.end.at) out.push(n.end.at);
    if (n.end.kind === 'lens') out.push({ el: n.end.el, pt: 'plane' });
    if (n.dir.kind === 'parallelTo') out.push({ ray: n.dir.ray, seg: n.dir.seg });
    if (n.dir.kind === 'deflect') out.push({ el: n.dir.el, pt: 'plane' });
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
    bakeBefore(scene, function (s) { remove(s, id); }, function (ref) { return mentions(ref, id); });
  }

  /** A pred for refs to the tail of ray id: its point k, or the segment ending there. */
  function tailRefs(id, k) {
    return function (ref) { return ref.ray === id && (ref.k === k || ref.seg === k - 1); };
  }

  // ---------------------------------------------------------------- drawing

  /** Points a ray can start from or be aimed through: [{ ref, p }]. Elements come first so
      they win ties with images and ray points lying on top of them. Points on ray `self` (the
      one being drawn) are left out: a ray cannot be pinned to itself. sol = solveScene(scene). */
  function anchors(scene, sol, self) {
    var out = [];
    function add(ref) { var p = refPos(scene, ref, sol.solver); if (p) out.push({ ref: ref, p: p }); }
    var lenses = [];
    scene.elements.forEach(function (e) {
      if (e.type === 'lens') { lenses.push(e); add({ el: e.id, pt: 'C' }); add({ el: e.id, pt: 'F' }); add({ el: e.id, pt: 'Fp' }); }
      else if (e.type === 'object') add({ el: e.id, pt: 'tip' });
      else if (e.type === 'point') add({ el: e.id, pt: 'src' });
      else if (e.type === 'mirror') add({ el: e.id, pt: 'P' });
      else if (e.type === 'iris') { add({ el: e.id, pt: 'C' }); add({ el: e.id, pt: 'Et' }); add({ el: e.id, pt: 'Eb' }); }
    });
    sol.images.forEach(function (im) {
      out.push({ ref: { img: { src: im.src, lens: im.lens } }, p: { z: im.z, y: im.y } });
    });
    scene.rays.forEach(function (r) {
      if (r.id === self) return;
      var pts = sol.rays[r.id] ? sol.rays[r.id].shown : [];
      pts.forEach(function (p, k) {
        if (Math.abs(p.z) < FAR / 2 && k < sol.rays[r.id].pts.length) out.push({ ref: { ray: r.id, k: k }, p: p });
      });
      // where each segment crosses a focal plane: the heart of the helper-ray construction
      for (var k = 0; k + 1 < pts.length; k++) {
        var a = pts[k], b = pts[k + 1];
        if (Math.abs(b.z - a.z) < EPS) continue;
        lenses.forEach(function (L) {
          ['F', 'Fp'].forEach(function (pt) {
            var z = focalZ(L, pt), t = (z - a.z) / (b.z - a.z);
            if (t > 1e-6 && t < 1 - 1e-6) out.push({ ref: { ray: r.id, seg: k, plane: { el: L.id, pt: pt } }, p: { z: z, y: a.y + t * (b.y - a.y) } });
          });
        });
      }
    });
    return out;
  }

  /** The first lens or mirror met going from P with slope u in direction sgn (+1 = to the
      right), if the ray hits it within its aperture (plus tol). Returns { lens, y } or null. */
  function nextLens(scene, P, u, sgn, tol) {
    var best = null, bestD = Infinity;
    scene.elements.forEach(function (L) {
      if (!isStop(L)) return;
      var d = (L.z - P.z) * sgn, y = P.y + u * (L.z - P.z);
      if (d > 1e-6 && d < bestD && Math.abs(y) <= L.ap + (tol || 0)) { best = { lens: L, y: y }; bestD = d; }
    });
    return best;
  }

  /** For a helper ray, which passes through lenses: the lens or mirror ahead of P whose plane
      the cursor C is right at (so the helper is meant to end there), as { lens, y }, or null. */
  function planeAtCursor(scene, P, u, sgn, C, tol) {
    var best = null;
    scene.elements.forEach(function (L) {
      if (!isStop(L) || (L.z - P.z) * sgn <= 1e-6 || Math.abs(C.z - L.z) > tol) return;
      var y = P.y + u * (L.z - P.z);
      if (Math.abs(y) <= L.ap + tol && (!best || Math.abs(C.z - L.z) < Math.abs(C.z - best.lens.z))) best = { lens: L, y: y };
    });
    return best;
  }

  /** The scan mirror P lies on, if any. */
  function mirrorAt(scene, P, tol) {
    var found = null;
    scene.elements.forEach(function (m) {
      if (m.type === 'mirror' && Math.abs(m.z - P.z) < 1e-6 && Math.abs(P.y) <= m.ap + (tol || 0)) found = m;
    });
    return found;
  }

  /** The lens whose centre is at P, if any. */
  function centreAt(scene, P) {
    var found = null;
    scene.elements.forEach(function (L) {
      if (L.type === 'lens' && Math.abs(L.z - P.z) < 1e-6 && Math.abs(P.y) < 1e-6) found = L;
    });
    return found;
  }

  /** Is point k of a solved ray a joint rather than a corner? At a lens centre light goes
      straight on, so the segment into the centre and the "straight on" segment out of it are
      one straight line: the point between them is not a place where the ray can bend, and is
      not offered as a node. r is the ray, s its solved form. */
  function isJoint(scene, r, s, k) {
    var n = r.nodes[k];                        // the segment leaving point k
    return k > 0 && !!n && n.dir.kind === 'straight' && !!s.pts[k] && !!centreAt(scene, s.pts[k]);
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
      snapped to the grid (and onto the axis). opt: { tol, grid, free, self (a ray being moved,
      which cannot start on itself) }. */
  function proposeStart(scene, sol, C, opt) {
    var list = opt.free ? [] : anchors(scene, sol, opt.self);
    var a = nearestAnchor(list, C, opt.tol);
    if (a) return { start: { at: a.ref }, p: a.p, text: 'from ' + refName(scene, a.ref, sol) };
    var z = opt.free || !opt.grid ? C.z : G.quantize(C.z, opt.grid);
    var y = opt.free ? C.y : Math.abs(C.y) <= opt.tol ? 0 : opt.grid ? G.quantize(C.y, opt.grid) : C.y;
    if (!opt.free) {                         // a grid point that lands exactly on something is that thing
      var on = nearestAnchor(list, { z: z, y: y }, 1e-9);
      if (on && on.ref.ray == null) return { start: { at: on.ref }, p: on.p, text: 'from ' + refName(scene, on.ref, sol) };
    }
    return { start: { z: z, y: y }, p: { z: z, y: y }, text: y === 0 && !opt.free ? 'on the axis' : '' };
  }

  /** Propose the next segment of a ray being drawn from P (the point before it is Q, or null)
      toward the cursor C. The direction snaps to: through an anchor (F, F′, a lens centre, the
      object tip, an image, a point on another ray, where a ray crosses a focal plane), straight
      on, reflected by a scan mirror, parallel to another ray, or parallel to the axis. The
      segment stops at the first lens or mirror it reaches (if the cursor is at or past it),
      else at the cursor. Aimed through a lens centre with the cursor beyond, it carries straight
      on. A helper ray is a construction line and passes through lenses and mirrors; it only
      stops on one if the cursor is right at its plane.
      opt: { tol (world units), free, self (id of the ray being drawn), helper,
             keep: { dir, u, sgn } — the line the segment had before (when dragging its end);
                   "same line" is then the strongest snap }.
      sol = solveScene(scene). Returns { nodes, pts, p, hints, axis, text } or null. */
  function proposeSegment(scene, sol, P, Q, C, opt) {
    var tol = opt.tol, dz = C.z - P.z, dy = C.y - P.y;
    if (Math.hypot(dz, dy) < tol) return null;
    var Lc = Q && centreAt(scene, P), uc = Lc && slope(Q, P);
    if (Lc && uc !== undefined) {
      // A ray that has reached a lens centre can only carry straight on: no choice of angle.
      var sc = P.z > Q.z ? 1 : -1;
      if (dz * sc <= 0) return null;
      var on = straightOn(scene, P, uc, sc, C, tol);
      return { node: on.node, nodes: [on.node], p: on.p, pts: [on.p], axis: false,
        hints: [{ z: P.z, y: P.y, text: '' }],
        text: 'straight on through the centre of ' + planeName(Lc) + (on.lens ? ', to ' + planeName(on.lens) : '') };
    }
    // Two tiers: weak suggestions (a point on another ray, parallel to another ray) only win
    // when nothing with optical meaning (F, F′, a centre, an image, a focal-plane crossing, the
    // mirror's reflection, straight on, parallel to the axis) is within reach.
    var strong = null, weak = null;
    function offer(err, cand, isWeak) {
      if (err > tol) return;
      cand.err = err;
      if (isWeak) { if (!weak || err < weak.err) weak = cand; }
      else if (!strong || err < strong.err) strong = cand;
    }
    function lineErr(u) { return Math.abs(dy - u * dz) / Math.hypot(1, u); }   // C's distance from the line

    if (!opt.free && opt.keep && dz * opt.keep.sgn > 0) {
      offer(0.5 * lineErr(opt.keep.u), { dir: opt.keep.dir, u: opt.keep.u, sgn: opt.keep.sgn,
        hint: { text: 'same line' } });
    }
    if (!opt.free) {
      anchors(scene, sol, opt.self).forEach(function (a) {
        var az = a.p.z - P.z, ay = a.p.y - P.y, al = Math.hypot(az, ay);
        if (al < tol || Math.abs(az) < EPS || az * dz + ay * dy <= 0) return;   // on P, vertical, or behind
        var onRay = a.ref.ray != null && !a.ref.plane;
        var hint = { z: a.p.z, y: a.p.y, text: 'through ' + refName(scene, a.ref, sol) };
        if (a.ref.plane) {
          var L = element(scene, a.ref.plane.el);
          hint.plane = { z: a.p.z, ap: L ? L.ap : 20 };
        }
        offer(Math.abs(az * dy - ay * dz) / al, {
          dir: { kind: 'through', at: a.ref }, u: ay / az, sgn: az > 0 ? 1 : -1, anchor: a, hint: hint
        }, onRay);
      });
      var uin = Q ? slope(Q, P) : undefined;
      if (uin !== undefined) {
        var s0 = P.z > Q.z ? 1 : -1;
        if (dz * s0 > 0) offer(1.2 * lineErr(uin),
          { dir: { kind: 'straight' }, u: uin, sgn: s0, hint: { z: P.z, y: P.y, text: 'straight on' } });
      }
      var M = mirrorAt(scene, P, tol);
      if (M && dz > 0) {
        var um = Math.tan(Math.atan(uin === undefined ? 0 : uin) + M.tilt * DEG);
        offer(0.8 * lineErr(um), { dir: { kind: 'deflect', el: M.id }, u: um, sgn: 1,
          hint: { z: P.z, y: P.y, text: 'reflected by ' + planeName(M) + ' (' + M.tilt + '°)' } });
      }
      scene.rays.forEach(function (r) {                                        // parallel to another ray
        if (r.id === opt.self || !sol.rays[r.id]) return;
        var pts = sol.rays[r.id].pts;
        for (var k = 0; k + 1 < pts.length; k++) {
          var u = slope(pts[k], pts[k + 1]);
          if (u === undefined || Math.abs(u) < 1e-6 || Math.abs(dz) < EPS) continue;
          offer(lineErr(u), { dir: { kind: 'parallelTo', ray: r.id, seg: k }, u: u, sgn: dz > 0 ? 1 : -1,
            hint: { seg: { a: sol.rays[r.id].shown[k] || pts[k], b: sol.rays[r.id].shown[k + 1] || pts[k + 1] }, text: 'parallel to that ray' } }, true);
        }
      });
      if (Math.abs(dz) > EPS) offer(1.3 * Math.abs(dy),
        { dir: { kind: 'parallel' }, u: 0, sgn: dz > 0 ? 1 : -1, axis: true, hint: { text: 'parallel to the axis' } });
    }
    var best = strong || weak;
    if (!best) {
      if (Math.abs(dz) < EPS) return null;
      best = { dir: { kind: 'free' }, u: dy / dz, sgn: dz > 0 ? 1 : -1, hint: null };
    }

    var u0 = best.u, sgn = best.sgn, free = best.dir.kind === 'free';
    var hints = best.hint && (best.hint.z != null || best.hint.seg) ? [best.hint] : [];
    var text = best.hint ? best.hint.text : '';
    var hit = opt.helper ? planeAtCursor(scene, P, u0, sgn, C, tol) : nextLens(scene, P, u0, sgn, tol), node, p, more = null;
    var stop = hit && (opt.helper || (C.z - hit.lens.z) * sgn >= -tol);
    if (stop) {                                                       // reached a lens or mirror: stop on it
      p = { z: hit.lens.z, y: hit.y };
      node = { dir: best.dir, end: free ? { kind: 'lens', el: hit.lens.id, y: hit.y } : { kind: 'lens', el: hit.lens.id } };
      hints.push({ z: p.z, y: p.y, text: '', small: true });
      var at = best.dir.at;
      if (at && at.el === hit.lens.id && at.pt === 'C' && (C.z - hit.lens.z) * sgn > tol) {
        // through the centre and on: light there is undeviated, so carry straight on in the same click
        more = straightOn(scene, p, u0, sgn, C, tol);
        text = (text ? text + ', ' : '') + 'straight on' + (more.lens ? ' to ' + planeName(more.lens) : '');
      } else text = (text ? text + ', ' : '') + 'to ' + planeName(hit.lens);
    } else if (best.anchor && G.dist(C, best.anchor.p) <= tol) {      // ending on the anchor itself
      p = { z: best.anchor.p.z, y: best.anchor.p.y };
      node = { dir: best.dir, end: { kind: 'at', at: best.anchor.ref } };
      text = 'to ' + refName(scene, best.anchor.ref, sol);
    } else if (free) {
      p = { z: C.z, y: C.y };
      node = { dir: best.dir, end: { kind: 'z', z: C.z, y: C.y } };
    } else {                                                          // the cursor projected onto the line
      var t = (dz + u0 * dy) / (1 + u0 * u0);
      p = { z: P.z + t, y: P.y + u0 * t };
      node = { dir: best.dir, end: { kind: 'z', z: p.z } };
    }
    var nodes = [node], pts = [p];
    if (more) { nodes.push(more.node); pts.push(more.p); }
    if (!opt.helper) {                                                // an iris blade in the way stops it there
      var from = P;
      for (var i = 0; i < pts.length; i++) {
        var blk = blockAt(scene, from, pts[i]);
        if (blk) {
          var bn = { dir: nodes[i].dir, end: nodes[i].dir.kind === 'free' ? { kind: 'lens', el: blk.iris.id, y: blk.y } : { kind: 'lens', el: blk.iris.id } };
          nodes = nodes.slice(0, i).concat([bn]); pts = pts.slice(0, i).concat([{ z: blk.z, y: blk.y }]);
          hints.push({ z: blk.z, y: blk.y, text: '', small: true });
          text = (text ? text + ', ' : '') + 'blocked by ' + planeName(blk.iris);
          break;
        }
        from = pts[i];
      }
    }
    return { node: nodes[0], nodes: nodes, p: pts[pts.length - 1], pts: pts, hints: hints, axis: !!best.axis, text: text };
  }

  /** The "straight on" segment after the lens centre at p (slope u, direction sgn), stopping
      at the next lens or mirror if the cursor C is at or past it, else at C projected onto the line. */
  function straightOn(scene, p, u, sgn, C, tol) {
    var hit = nextLens(scene, p, u, sgn, tol);
    if (hit && (C.z - hit.lens.z) * sgn >= -tol) {
      return { node: { dir: { kind: 'straight' }, end: { kind: 'lens', el: hit.lens.id } },
        p: { z: hit.lens.z, y: hit.y }, lens: hit.lens };
    }
    var t = ((C.z - p.z) + u * (C.y - p.y)) / (1 + u * u);
    return { node: { dir: { kind: 'straight' }, end: { kind: 'z', z: p.z + t } }, p: { z: p.z + t, y: p.y + u * t }, lens: null };
  }

  /** Lengthen the last segment of a ray to the next lens or mirror, or to the edge if there is
      none (a helper, which passes through lenses, always goes to the edge). Returns the new
      node, or null if the segment cannot be extended. */
  function extendNode(scene, n, P, E, tol, helper) {
    if (Math.abs(E.z - P.z) < EPS || n.end.kind === 'edge' || n.end.kind === 'lens') return null;
    var u = (E.y - P.y) / (E.z - P.z), sgn = E.z > P.z ? 1 : -1;
    var dir = n.dir.kind === 'free' ? { kind: 'slope', u: u } : n.dir;
    if (n.end.kind === 'at') dir = n.dir.kind === 'through' ? n.dir : { kind: 'slope', u: u };
    var hit = helper ? null : nextLens(scene, E, u, sgn, tol);
    return { dir: dir, end: hit ? { kind: 'lens', el: hit.lens.id } : { kind: 'edge', sgn: sgn } };
  }

  /** Once rays form a real image they are drawn ending there. So that the image keeps forming
      when the optics change, lengthen the last segment of each ray through a real image to
      the next lens or the edge (it is still drawn only as far as the image). Returns true if
      anything changed. tol: aperture tolerance (world units). */
  function extendToImages(scene, tol) {
    var sol = solveScene(scene), changed = false;
    sol.images.forEach(function (im) {
      if (im.virtual || im.focus) return;
      im.rays.forEach(function (rr) {
        var r = rayById(scene, rr.ray), s = sol.rays[rr.ray], last = s && s.pts.length - 1;
        if (!r || !r.nodes.length || rr.k + 1 !== last) return;
        var node = extendNode(scene, r.nodes[r.nodes.length - 1], s.pts[rr.k], s.pts[last], tol);
        if (!node) return;
        bake(scene, tailRefs(r.id, last));
        node.auto = true;                  // lengthened by RayMan, not drawn: shown faint if its image goes
        r.nodes[r.nodes.length - 1] = node;
        changed = true;
      });
    });
    return changed;
  }

  // ---------------------------------------------------------------- rays passing through lenses

  /** The direction a segment keeps if its end moves along the same line: its own pinned
      direction, or for a free one, its slope. node: the segment's node; a, b: its ends. */
  function keepDir(node, a, b) {
    var u = slope(a, b);
    if (u === undefined) return null;
    var dir = node.dir.kind === 'free' ? { kind: 'slope', u: u } : node.dir;
    return { dir: dir, u: u, sgn: b.z > a.z ? 1 : -1 };
  }

  /** Lenses and mirrors that the drawn part of a ray's last segment passes straight through
      (as happens when a lens is put in the path of a ray drawn earlier): [{ lens, p }], nearest
      first. s = the solved ray. Helpers pass through lenses on purpose, so they have none. */
  function crossings(scene, r, s) {
    var sh = s.shown, n = sh.length;
    if (r.helper || n < 2 || !r.nodes.length || n - 1 !== r.nodes.length && !s.trimmed) return [];
    var a = sh[n - 2], b = sh[n - 1], out = [];
    if (Math.abs(b.z - a.z) < EPS) return out;
    scene.elements.forEach(function (L) {
      if (!isStop(L)) return;
      var t = (L.z - a.z) / (b.z - a.z), y = a.y + t * (b.y - a.y);
      if (t > 1e-6 && t < 1 - 1e-6 && Math.abs(y) <= L.ap) out.push({ lens: L, p: { z: L.z, y: y }, t: t });
    });
    return out.sort(function (x, y) { return x.t - y.t; });
  }

  /** Make the last segment of ray r stop on lens (or mirror) L, keeping its line. Rays pinned
      to the part cut off are freed first. Returns true if done. */
  function cutAt(scene, r, L) {
    var s = solveScene(scene).rays[r.id], n = s.pts.length;
    var k = keepDir(r.nodes[r.nodes.length - 1], s.pts[n - 2], s.pts[n - 1]);
    if (!k) return false;
    bake(scene, tailRefs(r.id, n - 1));
    r.nodes[r.nodes.length - 1] = { dir: k.dir, end: { kind: 'lens', el: L.id } };
    return true;
  }

  // ---------------------------------------------------------------- fill-in rays

  /** Faint rays filling in each bundle. For every source with at least two ordinary rays drawn
      (and not stopped by an iris), take the two outermost at the first lens or mirror and
      interpolate n rays between them, plane by plane: the height at each shared plane and the
      slope of the last segment are blended. A thin lens maps (height, slope) linearly, so if the
      drawn rays are right the fill is exactly right, and if they are not the fill shows it.
      The bundle is worked out as if no iris were there (closing an iris must not make the
      whole fill vanish because one drawn ray is clipped), then each fill ray is stopped by
      irises on its own. Returns [{ pts, ray (the ray whose colour to use) }]. */
  function fillRays(scene, sol, n) {
    var out = [], groups = {}, order = [];
    if (!n) return out;
    sol = solveScene(scene, { noBlock: true });
    scene.rays.forEach(function (r) {
      var src = raySource(scene, r), s = sol.rays[r.id];
      if (!src || !s || s.shown.length < 2) return;
      var key = refKey(src);
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push({ r: r, s: s });
    });
    /** The lenses and mirrors a ray has points on, in order, as [{ id, k }] (k: index in shown).
        Free points along the way are ignored: they are not where a ray bends. The end counts
        only if it lies on a plane and the ray is not drawn ending at an image. */
    function planesOf(m) {
      var out = [], sh = m.s.shown, last = sh.length - 1;
      for (var k = 1; k <= last; k++) {
        if (!m.s.lens[k] || (k === last && m.s.trimmed)) continue;
        out.push({ id: m.s.lens[k], k: k });
      }
      return out;
    }
    order.forEach(function (key) {
      var g = groups[key];
      if (g.length < 2) return;
      // the two outermost rays at the first plane they reach, among rays reaching the same one
      var byPlane = {};
      g.forEach(function (m) {
        m.planes = planesOf(m);
        var id = m.planes.length ? m.planes[0].id : '';
        (byPlane[id] = byPlane[id] || []).push({ m: m, y: m.planes.length ? m.s.shown[m.planes[0].k].y : m.s.shown[1].y });
      });
      var set = null;
      Object.keys(byPlane).forEach(function (id) { if (!set || byPlane[id].length > set.length) set = byPlane[id]; });
      if (!set || set.length < 2) return;
      set.sort(function (a, b) { return a.y - b.y; });
      var A = set[0].m, B = set[set.length - 1].m;
      if (Math.abs(set[0].y - set[set.length - 1].y) < 1e-9) return;
      var pa = A.s.shown, pb = B.s.shown, qa = A.planes, qb = B.planes, m = 0;
      while (m < qa.length && m < qb.length && qa[m].id === qb[m].id) m++;     // planes both pass, in order
      // after the last shared plane: each ray's next segment gives a slope, its end a length
      var ka = m ? qa[m - 1].k : 0, kb = m ? qb[m - 1].k : 0;
      var ua = pa[ka + 1] ? slope(pa[ka], pa[ka + 1]) : undefined, ub = pb[kb + 1] ? slope(pb[kb], pb[kb + 1]) : undefined;
      var ea = pa[pa.length - 1], eb = pb[pb.length - 1];
      for (var i = 1; i <= n; i++) {
        var t = i / (n + 1), lerp = function (a, b) { return a + (b - a) * t; };
        var pts = [{ z: lerp(pa[0].z, pb[0].z), y: lerp(pa[0].y, pb[0].y) }];
        for (var j = 0; j < m; j++) pts.push({ z: pa[qa[j].k].z, y: lerp(pa[qa[j].k].y, pb[qb[j].k].y) });
        var P = pts[pts.length - 1];
        if (ua !== undefined && ub !== undefined) {
          var z = lerp(ea.z, eb.z);
          if ((z - P.z) * (ea.z - pa[ka].z) > 0) pts.push({ z: z, y: P.y + lerp(ua, ub) * (z - P.z) });
        }
        for (var q = 1; q < pts.length; q++) {                     // stopped by an iris?
          var blk = blockAt(scene, pts[q - 1], pts[q]);
          if (blk) { pts = pts.slice(0, q).concat([{ z: blk.z, y: blk.y }]); break; }
        }
        if (pts.length > 1) out.push({ pts: pts, ray: A.r });
      }
    });
    return out;
  }

  return {
    FAR: FAR, refKey: refKey, fillRays: fillRays, blockAt: blockAt, refPos: refPos, refName: refName, sameRef: sameRef, mentions: mentions,
    raySource: raySource, rootElement: rootElement, classify: classify,
    solveScene: solveScene, solveAll: solveAll, extendToImages: extendToImages,
    bake: bake, bakeAll: bakeAll, bakeBefore: bakeBefore, bakeRefsTo: bakeRefsTo, tailRefs: tailRefs,
    anchors: anchors, nextLens: nextLens, centreAt: centreAt, isJoint: isJoint,
    keepDir: keepDir, crossings: crossings, cutAt: cutAt,
    proposeStart: proposeStart, proposeSegment: proposeSegment, extendNode: extendNode
  };
});
