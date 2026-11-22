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
/* Short names used in this file:
     z, y     position along the axis and height above it, in mm; u: a slope dy/dz
     r        a ray (scene.js); s: its solved version { pts, lens, ok, ... }
     el       an element id or element; pt, pts: a point { z, y } and a list of them
     a, b     the two ends of a segment; k, i: an index into a list of points
     e        an element, in short callbacks; m, n: a count or a small helper value
     X, A     (screen-free here) where used: an x-position and an aperture, as in render.js */

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

  /** Look-ups by id see everything on the axis, switched off or not (an axis view's `all`):
      a ray drawn through a helper, or parallel to a ray of a source that is off, still goes
      where it was drawn. Only lists (what is drawn, hit, snapped to) leave those out. */
  function element(scene, id) {
    var list = scene.all ? scene.all.elements : scene.elements;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /** Find a ray by its id (searching all axes if the scene is a whole-scene view); null if none. */
  function rayById(scene, id) {
    var list = scene.all ? scene.all.rays : scene.rays;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /** Elements a ray stops on when it reaches them: lenses and scan mirrors. */
  function isStop(e) { return !!e && (e.type === 'lens' || e.type === 'mirror'); }
  /** Elements whose plane a ray point can lie on: those, and irises (where a blocked ray ends). */
  function isPlane(e) { return isStop(e) || (!!e && (e.type === 'iris' || e.type === 'plane' || e.type === 'dichroic')); }
  /** The name to show for a plane element: its label if it has one, else a generic name. */
  function planeName(e) {
    return e.label || (e.type === 'mirror' ? 'the scan mirror' : e.type === 'iris' ? 'the iris' :
      e.type === 'plane' ? 'the image plane' : e.type === 'dichroic' ? 'the dichroic' : 'the lens');
  }

  /** A colour as a key for comparing (null: the default colour). */
  function colourKey(c) { return c ? String(c).trim().toLowerCase() : null; }

  /** The colour ray r is drawn in (apart from hints): its owner's (beam, point source), else
      its own; null for the default. */
  function rayColour(scene, r) {
    var o = r.helper ? null : owner(scene, r);
    return (o && o.color) || r.color || null;
  }

  /** Where segment a-b is first stopped, as { z, y, el (the element), rim (true at the rim of a
      lens or mirror) }, or null. Stops are: the blades of an iris (from its opening r out to its
      size ap); a dichroic, for light of the colour it stops (col: the ray's colour); and, with
      the setting "lens rims stop light" on, a lens or mirror met outside its aperture. The end
      b counts (a ray with a corner on the iris plane, as at a filament image in the aperture
      diaphragm, must still be stopped); the start a does not (it was the previous segment's end). */
  function blockAt(scene, a, b, col) {
    var best = null, bestT = Infinity, rims = !!(scene.settings && scene.settings.rims), ck = colourKey(col);
    if (Math.abs(b.z - a.z) < EPS) return null;
    scene.elements.forEach(function (e) {
      var rim = rims && (e.type === 'lens' || e.type === 'mirror');
      var dich = e.type === 'dichroic' && !!e.stop && colourKey(e.stop) === ck;
      if (e.type !== 'iris' && !rim && !dich) return;
      var t = (e.z - a.z) / (b.z - a.z);
      if (t <= 1e-9 || t > 1 + 1e-9 || t >= bestT) return;
      var y = a.y + t * (b.y - a.y), ay = Math.abs(y);
      var hit = rim ? ay > e.ap + 1e-9 : dich ? ay <= e.ap + 1e-9 : ay > e.r + 1e-9 && ay <= e.ap + 1e-9;
      if (hit) {
        best = { z: e.z, y: y, el: e, rim: rim };
        bestT = t;
      }
    });
    return best;
  }

  /** Slope dy/dz of the line from a to b; undefined for a vertical line. */
  function slope(a, b) { return Math.abs(b.z - a.z) > EPS ? (b.y - a.y) / (b.z - a.z) : undefined; }

  /** The way a collimated beam runs: +1 left to right, -1 right to left. */
  function beamDir(e) { return e.dir === -1 ? -1 : 1; }

  /** The slope of light leaving scan mirror M, for light arriving with slope u running in
      direction sgn (+1 = to the right). The mirror turns the light by its beam tilt, the same
      way (up for a positive tilt) whichever side it comes from, so light sent back along a ray
      retraces it: the turn is undone (this is how the mirror de-scans the returning light). */
  function deflected(M, u, sgn) { return Math.tan(Math.atan(u) + sgn * M.tilt * DEG); }

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

  /** True if two references point to the same thing. */
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
      var pin = r.start.at || r.start.from;          // `from`: a start that was pinned, then frozen
      if (pin && pin.el && (element(scene, pin.el) || {}).type === 'beam') return { inf: pin.el };   // a collimated beam
      if (pin) {
        if (pin.ray == null) return pin;
        r = rayById(scene, pin.ray);
        continue;
      }
      var d = r.nodes[0] && r.nodes[0].dir;
      if (d && d.kind === 'parallel') return { inf: 'axis' };
      if (d && d.kind === 'parallelTo') {
        var q = rayById(scene, d.ray);
        if (q && !q.helper && !q.start.at && q !== r) {
          r = q;
          continue;
        }
      }
      return { inf: r.id };
    }
    return null;
  }

  /** Element kinds that own the rays drawn from them: those rays always take the owner's
      colour, and (for kinds in scene.js's GROUP_COPY) are copied with it. Add kinds here to
      extend the idea. */
  var OWNERS = { beam: true, point: true };

  /** The element that owns ray r (a point source or beam it was started from, directly or by
      branching off one of its rays), or null. */
  function owner(scene, r) {
    for (var depth = 0; r && depth < 100; depth++) {
      var pin = r.start.at || r.start.from;
      if (!pin || pin.img) return null;
      if (pin.ray != null) {
        r = rayById(scene, pin.ray);
        continue;
      }
      var e = element(scene, pin.el);
      return e && OWNERS[e.type] ? e : null;
    }
    return null;
  }

  /** Is the image of this source an arrow (from an object arrow) rather than a point? */
  function isArrow(src) {
    while (src && src.img) src = src.img.src;
    return !!src && src.pt === 'tip';
  }

  /** True if the source sends light from infinity (a parallel beam rather than a point). */
  function isInfinite(src) {
    while (src && src.img) src = src.img.src;
    return !!src && src.inf != null;
  }

  /** The element at the root of a chain of images (the object or point source), or null. */
  function rootElement(scene, src) {
    while (src && src.img) src = src.img.src;
    return src && src.el ? element(scene, src.el) : null;
  }

  /** The magnification of an arrow image: its height over the height of the object arrow it
      comes from (through every lens before it), so −2 is twice the size and inverted. Null for
      the image of a point. Found from the drawn rays, so wrong rays give a wrong M. */
  function magnification(scene, image) {
    if (!image || !image.arrow || image.focus) return null;
    var root = rootElement(scene, image.src);
    if (!root || root.type !== 'object' || !root.h) return null;
    return image.y / root.h;
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
    if (this.busy[key]) {
      this.tainted = true;
      return null;
    }
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
  function segmentOf(solver, id, seg) {
    var r = solver.points(id, seg + 2);
    return r ? { a: r.pts[seg], b: r.pts[seg + 1] } : null;
  }

  /** z of a lens's front (F) or back (F′) focal plane. */
  function focalZ(L, pt) { return pt === 'F' ? L.z - L.f : L.z + L.f; }

  /** Where a ref points now, or null if its target has gone. */
  function refPos(scene, ref, solver) {
    if (ref.img) {
      var image = solver.image(ref.img.src, ref.img.lens);
      return image ? { z: image.z, y: image.y } : null;
    }
    if (ref.ray != null && ref.plane) {
      var sg = segmentOf(solver, ref.ray, ref.seg), L = element(scene, ref.plane.el);
      if (!sg || !L || (L.type !== 'lens' && L.type !== 'plane') || Math.abs(sg.b.z - sg.a.z) < EPS) return null;
      var zp = L.type === 'plane' ? L.z : focalZ(L, ref.plane.pt);
      return { z: zp, y: G.yAtZ(sg.a, sg.b, zp) };
    }
    if (ref.ray != null) {
      var r = solver.points(ref.ray, ref.k + 1), p = r && r.pts[ref.k];
      return p ? { z: p.z, y: p.y } : null;
    }
    var e = element(scene, ref.el);
    if (!e) return null;
    if (ref.pt === 'tip' && e.type === 'object') return { z: e.z, y: e.h };
    if (ref.pt === 'src' && e.type === 'point') return { z: e.z, y: e.y };
    if (ref.pt === 'P' && e.type === 'mirror') return { z: e.z, y: 0 };
    if (e.type === 'beam') {                  // the source points spread across the beam, at right angles to it
      var a = e.angle * DEG, k = ref.pt === 'top' ? 1 : ref.pt === 'bot' ? -1 : ref.pt === 'mid' ? 0 : null;
      if (k === null) return null;
      return { z: e.z - beamDir(e) * k * e.width / 2 * Math.sin(a), y: e.y + k * e.width / 2 * Math.cos(a) };
    }
    if (e.type === 'filament') {
      if (ref.pt === 'top') return { z: e.z, y: e.top };
      if (ref.pt === 'bot') return { z: e.z, y: e.bottom };
      if (ref.pt === 'mid') return { z: e.z, y: (e.top + e.bottom) / 2 };
      return null;
    }
    if (e.type === 'plane') return ref.pt === 'C' ? { z: e.z, y: 0 } : null;
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
  function refLens(ref, solver) {
    if (ref.ray != null && !ref.plane) {
      var r = solver.points(ref.ray, ref.k + 1);
      return (r && r.lens[ref.k]) || null;
    }
    return ref.pt === 'C' || ref.pt === 'P' ? ref.el : null;
  }

  /** Trace one ray through the scene: follow its nodes from the start, bend it at each lens
      or mirror it reaches, and record the points, which element each point is on, and
      whether it was blocked. solver holds the rays already solved, to resolve references between rays. */
  function solveRay(scene, r, solver) {
    var res = { pts: [], lens: [], ok: true };
    solver.partial[r.id] = res;
    var p = r.start.at ? refPos(scene, r.start.at, solver) : { z: r.start.z, y: r.start.y };
    if (!p) {
      res.ok = false;
      return res;
    }
    res.pts.push(p);
    res.lens.push(r.start.at ? refLens(r.start.at, solver) : null);
    for (var k = 0; k < r.nodes.length; k++) {
      var q = solveNode(scene, r.nodes[k], res.pts, solver);
      if (!q) {
        res.ok = false;
        break;
      }
      var blk = r.helper || solver.noBlock ? null : blockAt(scene, res.pts[res.pts.length - 1], q.p, rayColour(scene, r));
      if (blk) {                     // stopped (an iris, a dichroic, a rim): the rest of the ray is not reached
        res.pts.push({ z: blk.z, y: blk.y }); res.lens.push(blk.el.id); res.blocked = blk.el.id;
        if (blk.rim) res.rim = true;
        break;
      }
      res.pts.push(q.p); res.lens.push(q.lens);
    }
    return res;
  }

  /** Slope of a segment's direction: a number, null for "free" (the end fixes it), or
      undefined if it cannot be worked out. */
  function dirSlope(scene, d, pts, solver) {
    var P = pts[pts.length - 1], Q = pts[pts.length - 2];
    switch (d.kind) {
      case 'parallel': return 0;
      case 'slope': return d.u;
      case 'free': return null;
      case 'straight': return Q ? slope(Q, P) : undefined;
      case 'through':
        var A = refPos(scene, d.at, solver);
        return A ? slope(P, A) : undefined;
      case 'parallelTo':
        var sg = segmentOf(solver, d.ray, d.seg);
        return sg ? slope(sg.a, sg.b) : undefined;
      case 'refract':                         // the ideal thin lens: u' = u - y / f
        var Lr = element(scene, d.el), ur = Q ? slope(Q, P) : undefined;
        if (!Lr || Lr.type !== 'lens' || ur === undefined || Math.abs(Lr.z - P.z) > 1e-6) return undefined;
        return ur - (P.z > Q.z ? 1 : -1) * P.y / Lr.f;     // drawn right to left, undo the bend: u + y / f
      case 'beam':
        var B = element(scene, d.el);
        return B && B.type === 'beam' ? beamDir(B) * Math.tan(B.angle * DEG) : undefined;
      case 'deflect':
        var M = element(scene, d.el), uin = Q ? slope(Q, P) : 0;
        if (!M || M.type !== 'mirror' || uin === undefined || Math.abs(M.z - P.z) > 1e-6) return undefined;
        return deflected(M, uin, Q ? (P.z > Q.z ? 1 : -1) : d.sgn || 1);
    }
    return undefined;
  }

  /** Place the next point of a ray after pts. Returns { p, lens } or null. */
  function solveNode(scene, n, pts, solver) {
    var P = pts[pts.length - 1], e = n.end;
    if (e.kind === 'at') {
      var A = refPos(scene, e.at, solver);
      return A && { p: A, lens: refLens(e.at, solver) };
    }
    var u = dirSlope(scene, n.dir, pts, solver);
    if (u === undefined) return null;
    var z, lens = null;
    if (e.kind === 'lens') {
      var L = element(scene, e.el);
      if (!isPlane(L)) return null;
      z = L.z; lens = L.id;
    } else if (e.kind === 'z') {
      z = e.z;
      if (e.on) {                         // a frozen point that was on a lens: still on it while the lens is there
        var Lo = element(scene, e.on);
        if (isPlane(Lo) && Math.abs(Lo.z - z) < 1e-6) lens = Lo.id;
      }
    } else if (e.kind === 'edge') {
      if (u === null) return null;
      z = P.z + e.sgn * FAR;
    }
    else if (e.kind === 'plane') {            // on a lens's focal plane, wherever that is now
      var Lp = element(scene, e.el);
      if (!Lp || Lp.type !== 'lens' || u === null) return null;
      z = focalZ(Lp, e.pt);
    }
    else if (e.kind === 'next') {             // the first lens or mirror ahead, as things are now
      if (u === null) return null;
      var sn = e.sgn || 1, nx = nextLens(scene, P, u, sn, 0);
      if (nx) { z = nx.lens.z; lens = nx.lens.id; } else z = P.z + sn * FAR;
    }
    else return null;
    if (n.dir.kind === 'through') {
      // Pinned through a point that has ended up behind it (an object dragged inside F leaves the
      // focal ray's F behind the tip): the ray can no longer go through it, so it stops here and
      // is not drawn beyond. Move things back and it returns as drawn.
      var A = refPos(scene, n.dir.at, solver);
      if (A && (A.z - P.z) * (z - P.z) < -EPS) return null;
    }
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

  /** A source split into the point the light starts from and the lenses it has been through
      to make the image it names: img(img(O@L1)@L2) is { root: 'O:tip', lenses: [L1, L2] }. */
  function sourceChain(src) {
    var lenses = [];
    while (src && src.img) { lenses.unshift(src.img.lens); src = src.img.src; }
    return { root: refKey(src), lenses: lenses };
  }

  /** Does the light of solved ray s (from source rsrc), leaving lens lensId at point k, belong
      to the image of src through that lens? Yes if it starts at src itself, or if it comes from
      the same object through the lenses that make src (in that order) and maybe more, whether
      the ray was drawn from the object on through those lenses or started at an image they
      make: a ray from the object through L1 and a ray started at L1's image carry the same
      light on to L2 (#16). Light that has already been through lensId does not count. */
  function sameLight(scene, rsrc, s, k, src, lensId) {
    if (refKey(rsrc) === refKey(src)) return true;
    var want = sourceChain(src), got = sourceChain(rsrc);
    if (!rsrc || got.root !== want.root) return false;
    var seen = got.lenses.slice();
    for (var j = 1; j < k; j++) {
      var E = s.lens[j] && element(scene, s.lens[j]);
      if (E && E.type === 'lens') seen.push(E.id);
    }
    if (seen.indexOf(lensId) >= 0 || seen.length < want.lenses.length) return false;
    for (var i = 0; i < want.lenses.length; i++) if (seen[i] !== want.lenses[i]) return false;
    return true;
  }

  /** The image of src through a lens, from the segments leaving that lens on rays carrying
      src's light (see sameLight). The first pair of rays (in drawing order) that cross decides it. */
  function findImage(solver, src, lensId) {
    var scene = solver.scene, L = element(scene, lensId), segs = [];
    if (!L || L.type !== 'lens') return null;
    var root = sourceChain(src).root;
    scene.rays.forEach(function (r) {
      var rsrc = raySource(scene, r);
      if (!rsrc || sourceChain(rsrc).root !== root) return;
      var s = solver.ray(r.id);
      if (!s) return;
      for (var k = 0; k + 1 < s.pts.length; k++) {
        if (s.lens[k] !== lensId) continue;
        if (!sameLight(scene, rsrc, s, k, src, lensId)) break;
        // the light leaving the lens: on through corners where it goes straight on (on a sample
        // plane, or where it was carried on through an image), until something bends it
        var a = s.pts[k], j = k + 1;
        while (j + 1 < s.pts.length && !isStop(element(scene, s.lens[j])) &&
          lineDist(s.pts[j + 1], a, s.pts[j]) <= 1e-9 * (1 + G.dist(a, s.pts[j + 1]))) j++;
        var b = s.pts[j];
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

  /** Are two found images the same one: through the same lens, of the same object, in the
      same place? */
  function sameImage(a, b) {
    return a.lens === b.lens && a.virtual === b.virtual &&
      sourceChain(a.src).root === sourceChain(b.src).root &&
      Math.hypot(a.z - b.z, a.y - b.y) <= 1e-6 * (1 + Math.abs(a.z) + Math.abs(a.y));
  }

  /** Solve the whole bench: { rays: { id: solved ray }, images: [image], roles: { id: role } }.
      Each solved ray also has `shown`, the points to draw: a ray whose last segment forms a
      real image of an object is drawn ending at the image (`trimmed`), not beyond it. A focus
      of light from infinity does not trim: the beam carries on, as through a relay. */
  function solveScene(scene, opts) {
    var solver = new Solver(scene, opts), rays = {}, roles = {}, images = [], seen = {};
    scene.rays.forEach(function (r) {
      var s = solver.ray(r.id) || { pts: [], lens: [], ok: false };
      rays[r.id] = { pts: s.pts, lens: s.lens, ok: s.ok, shown: s.pts, trimmed: false, blocked: s.blocked || null, rim: !!s.rim };
      roles[r.id] = r.helper ? null : classify(scene, s);
    });
    var lenses = scene.elements.filter(function (e) { return e.type === 'lens'; });
    scene.rays.forEach(function (r) {
      var src = raySource(scene, r), key = refKey(src);
      if (!src || seen[key]) return;
      seen[key] = true;
      lenses.forEach(function (L) {
        var image = solver.image(src, L.id);
        // the same light named two ways (from the object, or from an image it makes) gives
        // the same image twice: list it once
        if (image && !images.some(function (o) { return sameImage(o, image); })) images.push(image);
      });
    });
    images.forEach(function (image) {
      if (image.virtual || image.focus) return;
      image.rays.forEach(function (rr) {
        var s = rays[rr.ray];
        if (!s || rr.k + 2 !== s.pts.length) return;                 // only a ray's last segment
        var t = along(image, s.pts[rr.k], s.pts[rr.k + 1]);
        if (t <= 1e-6 || t > 1 + 1e-6) return;
        s.shown = s.pts.slice(0, rr.k + 1).concat([{ z: image.z, y: image.y }]);
        s.trimmed = true;
      });
    });
    return { rays: rays, images: images, roles: roles, solver: solver };
  }

  /** The smallest semi-aperture a lens or mirror can have and still take every ray that meets
      it: the largest |y| of any ray point on it (a ray stopped at its rim counts, so it will
      not shrink further). 0 if no ray meets it. scene: the element's own axis view. */
  function minAperture(scene, id) {
    var m = 0, rays = solveScene(scene).rays;
    Object.keys(rays).forEach(function (k) {
      var s = rays[k];
      s.pts.forEach(function (p, i) { if (s.lens[i] === id) m = Math.max(m, Math.abs(p.y)); });
    });
    return m;
  }

  /** Just the solved rays: { rayId: { pts, lens, ok, shown, trimmed } }. */
  function solveAll(scene) { return solveScene(scene).rays; }

  /** A few words naming what a ref points at, for hints: "F′ of L1", "the image". */
  function refName(scene, ref, solution) {
    if (ref.img) {
      var image = solution && solution.solver.image(ref.img.src, ref.img.lens);
      return image && image.focus ? 'the focus' : image && image.virtual ? 'the virtual image' : 'the image';
    }
    if (ref.ray != null && ref.plane) {
      var L = element(scene, ref.plane.el);
      if (L && L.type === 'plane') return 'that ray at ' + planeName(L);
      return 'that ray at the ' + (ref.plane.pt === 'Fp' ? 'back' : 'front') + ' focal plane' +
        (L && L.label ? ' of ' + L.label : '');
    }
    if (ref.ray != null) return 'a point on a ray';
    var e = element(scene, ref.el), n = e && e.label ? e.label : 'the lens';
    switch (ref.pt) {
      case 'tip': return 'the object tip';
      case 'src': return 'the point source';
      case 'P': return 'the scan mirror';
      case 'top': return 'the top of the ' + (e && e.type === 'beam' ? 'beam' : 'filament');
      case 'bot': return 'the bottom of the ' + (e && e.type === 'beam' ? 'beam' : 'filament');
      case 'mid': return 'the middle of the ' + (e && e.type === 'beam' ? 'beam' : 'filament');
      case 'Et': case 'Eb': return 'the edge of ' + (e && e.label ? 'iris ' + e.label : 'the iris');
      case 'C': return 'the centre of ' + (e && e.type === 'iris' ? (e.label ? 'iris ' + e.label : 'the iris') :
        e && e.type === 'plane' ? planeName(e) : n);
      case 'F': return 'F of ' + n;
      case 'Fp': return 'F′ of ' + n;
    }
    return '?';
  }

  /** The rays that go with light source `id` (an object, point source, beam or filament): rays
      whose light comes from it (or from its images), rays started on it (helpers too), and any
      ray that starts on one of those (branches). A ray that merely runs parallel to, or through,
      one of them (a helper at a lens centre) is not one: it stays when the source is off.
      Returns their ids as a set. */
  function raysOf(scene, id) {
    var set = {}, grew = true;
    scene.rays.forEach(function (r) {
      var src = raySource(scene, r), root = src ? rootElement(scene, src) : null, o = owner(scene, r);
      if ((root && root.id === id) || (o && o.id === id) || (r.start.at && mentions(r.start.at, id))) set[r.id] = true;
    });
    while (grew) {
      grew = false;
      scene.rays.forEach(function (r) {
        if (set[r.id]) return;
        var refs = [r.start.at, r.start.from];
        if (refs.some(function (f) { return f && Object.keys(set).some(function (k) { return mentions(f, k); }); })) {
          set[r.id] = true;
          grew = true;
        }
      });
    }
    return set;
  }

  // ---------------------------------------------------------------- baking

  /** The refs a node depends on. A node lying on a lens or mirror offers { el, pt: 'plane' }. */
  function nodeRefs(n) {
    var out = [];
    if (n.dir.at) out.push(n.dir.at);
    if (n.end.at) out.push(n.end.at);
    if (n.end.kind === 'lens') out.push({ el: n.end.el, pt: 'plane' });
    if (n.dir.kind === 'parallelTo') out.push({ ray: n.dir.ray, seg: n.dir.seg });
    if (n.dir.kind === 'deflect' || n.dir.kind === 'beam' || n.dir.kind === 'refract') out.push({ el: n.dir.el, pt: 'plane' });
    if (n.end.kind === 'next') out.push({ el: '', pt: 'next' });
    if (n.end.kind === 'plane') out.push({ el: n.end.el, pt: 'plane' });
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
      if (r.start.at && pred(r.start.at)) {          // frozen, but it still came from there (for images)
        r.start = { z: s.pts[0].z, y: s.pts[0].y, from: r.start.at };
      }
      var keep = s.pts.length - 1;                       // pieces the solver reached
      if (s.blocked) {                                   // pieces past a blocking iris are still drawn, just not
        keep = Math.max(keep, 0);                        // reached: keep them (deleting the iris lets the light
        for (var j = keep; j < r.nodes.length && !nodeRefs(r.nodes[j]).some(pred); j++) keep = j + 1;   // on), up to one that
      }                                                  // mentions what goes
      r.nodes.length = Math.min(r.nodes.length, keep);
      r.nodes.forEach(function (n, k) {
        if (k >= s.pts.length - 1 || !nodeRefs(n).some(pred)) return;
        var P = s.pts[k], Q = s.pts[k + 1];
        if (n.end.kind === 'edge') n.dir = { kind: 'slope', u: (Q.y - P.y) / (Q.z - P.z) };
        else {
          var end = { kind: 'z', z: Q.z, y: Q.y };
          if (s.lens[k + 1]) end.on = s.lens[k + 1];       // remember the lens it was on (images need it)
          r.nodes[k] = { dir: { kind: 'free' }, end: end };
        }
      });
    });
  }

  /** Free every pinned point so the rays keep their shapes whatever happens to the scene. */
  function bakeAll(scene) { bake(scene, function () { return true; }); }

  /** Before making change(scene): free every pin matching pred, and every pin to an image that
      the change would make disappear, keeping the rays' shapes. (The change is tried on a
      copy first to see which images survive.) */
  function bakeBefore(scene, change, pred) {
    var trial = JSON.parse(JSON.stringify(scene)), after = {};
    change(trial);
    solveScene(trial).images.forEach(function (image) { after[refKey({ img: { src: image.src, lens: image.lens } })] = true; });
    bake(scene, function (ref) { return pred(ref) || (!!ref.img && !after[refKey(ref)]); });
  }

  /** Before removing element or ray `id` with remove(scene, id): free whatever is pinned to it. */
  function bakeRefsTo(scene, id, remove) {
    bakeBefore(scene, function (s) { remove(s, id); }, function (ref) { return mentions(ref, id); });
  }

  /** A pred for refs to the end point k of ray id. Used when its last segment is lengthened or
      cut short along the same line, so refs to the segment's line (parallel to it, where it
      crosses a focal plane) stay as they are: only the end point moves. */
  function tailRefs(id, k) {
    return function (ref) { return ref.ray === id && ref.k === k; };
  }

  // ---------------------------------------------------------------- drawing

  /** Points a ray can start from or be aimed through: [{ ref, p }]. Elements come first so
      they win ties with images and ray points lying on top of them. Points on ray `self` (the
      one being drawn) are left out: a ray cannot be pinned to itself. solution = solveScene(scene). */
  function anchors(scene, solution, self) {
    var out = [];
    /** Add reference ref to the list of snap points, if it has a position. */
    function add(ref) { var p = refPos(scene, ref, solution.solver); if (p) out.push({ ref: ref, p: p }); }
    var lenses = [], markers = [];
    // light sources first: where one sits on a lens point (a point source placed at F), the
    // source wins, so rays started there belong to it
    scene.elements.forEach(function (e) {
      if (e.type === 'object') add({ el: e.id, pt: 'tip' });
      else if (e.type === 'point') add({ el: e.id, pt: 'src' });
      else if (e.type === 'filament' || e.type === 'beam') {
        add({ el: e.id, pt: 'top' });
        add({ el: e.id, pt: 'bot' });
        add({ el: e.id, pt: 'mid' });
      }
    });
    scene.elements.forEach(function (e) {
      if (e.type === 'lens') {
        lenses.push(e);
        add({ el: e.id, pt: 'C' });
        add({ el: e.id, pt: 'F' });
        add({ el: e.id, pt: 'Fp' });
      }
      else if (e.type === 'mirror') add({ el: e.id, pt: 'P' });
      else if (e.type === 'iris') {
        add({ el: e.id, pt: 'C' });
        add({ el: e.id, pt: 'Et' });
        add({ el: e.id, pt: 'Eb' });
      }
      else if (e.type === 'plane') {
        markers.push(e);
        add({ el: e.id, pt: 'C' });
      }
    });
    solution.images.forEach(function (image) {
      out.push({ ref: { img: { src: image.src, lens: image.lens } }, p: { z: image.z, y: image.y } });
    });
    scene.rays.forEach(function (r) {
      if (r.id === self) return;
      var pts = solution.rays[r.id] ? solution.rays[r.id].shown : [];
      pts.forEach(function (p, k) {
        if (Math.abs(p.z) < FAR / 2 && k < solution.rays[r.id].pts.length) out.push({ ref: { ray: r.id, k: k }, p: p });
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
        markers.forEach(function (M) {               // where it crosses the sample or camera plane
          var t = (M.z - a.z) / (b.z - a.z);
          if (t > 1e-6 && t < 1 - 1e-6) out.push({ ref: { ray: r.id, seg: k, plane: { el: M.id, pt: 'Z' } }, p: { z: M.z, y: a.y + t * (b.y - a.y) } });
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
      if (d > 1e-6 && d < bestD && Math.abs(y) <= L.ap + (tol || 0)) {
        best = { lens: L, y: y };
        bestD = d;
      }
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

  /** A lens focal plane ahead of P (direction sgn) that the cursor C is at (within tol), for a
      segment of slope u to end on: { L, pt, p, text, ap } or null, the nearest to the cursor. */
  function planeEnd(scene, P, u, sgn, C, tol) {
    var best = null, bestD = tol;
    scene.elements.forEach(function (L) {
      if (L.type === 'plane') {                  // an image plane marker: end on it
        var dm = Math.abs(C.z - L.z);
        if ((L.z - P.z) * sgn <= 1e-6 || dm > bestD) return;
        bestD = dm;
        best = { L: L, marker: true, p: { z: L.z, y: P.y + u * (L.z - P.z) }, ap: L.ap, text: 'to ' + planeName(L) };
        return;
      }
      if (L.type !== 'lens') return;
      ['F', 'Fp'].forEach(function (pt) {
        var z = focalZ(L, pt), d = Math.abs(C.z - z);
        if ((z - P.z) * sgn <= 1e-6 || d > bestD) return;
        bestD = d;
        best = { L: L, pt: pt, p: { z: z, y: P.y + u * (z - P.z) }, ap: L.ap,
          text: 'to the ' + (pt === 'Fp' ? 'back' : 'front') + ' focal plane' + (L.label ? ' of ' + L.label : '') };
      });
    });
    return best;
  }

  /** The lens whose plane P lies on (within its aperture), if any. */
  function lensAt(scene, P) {
    var found = null;
    scene.elements.forEach(function (L) {
      if (L.type === 'lens' && Math.abs(L.z - P.z) < 1e-6 && Math.abs(P.y) <= L.ap + 1e-6) found = L;
    });
    return found;
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

  /** The nearest anchor to C within tol, or null. Where an element's point and a point on a ray
      coincide (a fluorophore placed at a laser focus), the element's point wins. */
  function nearestAnchor(list, C, tol) {
    var best = null, bestD = tol;
    list.forEach(function (a) {
      var d = G.dist(a.p, C);
      var tie = best && Math.abs(d - bestD) <= 1e-9 && best.ref.ray != null && a.ref.ray == null;
      if (d <= bestD + 1e-12 && (!best || d < bestD - 1e-9 || tie)) {
        best = a;
        bestD = d;
      }
    });
    return best;
  }

  /** Where a ray would start for a click at C: on an anchor if close, else a free point
      snapped to the grid (and onto the axis). opt: { tol, grid, free, self (a ray being moved,
      which cannot start on itself) }. */
  function proposeStart(scene, solution, C, opt) {
    var list = opt.free ? [] : anchors(scene, solution, opt.self);
    var a = nearestAnchor(list, C, opt.tol);
    if (a) return { start: { at: a.ref }, p: a.p, text: 'from ' + refName(scene, a.ref, solution) };
    var z = opt.free || !opt.grid ? C.z : G.quantize(C.z, opt.grid);
    var y = opt.free ? C.y : Math.abs(C.y) <= opt.tol ? 0 : opt.grid ? G.quantize(C.y, opt.grid) : C.y;
    if (!opt.free) {                         // a grid point that lands exactly on something is that thing
      var on = nearestAnchor(list, { z: z, y: y }, 1e-9);
      if (on && on.ref.ray == null) return { start: { at: on.ref }, p: on.p, text: 'from ' + refName(scene, on.ref, solution) };
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
      solution = solveScene(scene). Returns { nodes, pts, p, hints, axis, text } or null. */
  function proposeSegment(scene, solution, P, Q, C, opt) {
    var tol = opt.tol, dz = C.z - P.z, dy = C.y - P.y;
    if (Math.hypot(dz, dy) < tol) return null;
    var Mq = !opt.helper && Q && mirrorAt(scene, P), um0 = Mq && slope(Q, P);
    if (Mq && um0 !== undefined) {
      // Light reaching the scan mirror goes on through it, tilted by the mirror: no choice of angle.
      var sq = P.z > Q.z ? 1 : -1;
      if (dz * sq <= 0) return null;
      var th = throughMirror(scene, P, um0, sq, Mq, C, tol, solution, opt.self);
      return { node: th.nodes[0], nodes: th.nodes, p: th.p, pts: th.pts, axis: false,
        hints: [{ z: P.z, y: P.y, text: '' }], text: th.text };
    }
    // A ray that has come through a scan mirror meets lens centres only while the mirror is at
    // that tilt: scanning moves it off them. So it is never pinned to a fixed point it happens to
    // pass, and at a centre it is "bent by" the lens (the same there, and right off it).
    var scanned = isScanned(scene, opt.self);
    var Lc = Q && centreAt(scene, P), uc = Lc && slope(Q, P);
    if (Lc && uc !== undefined) {
      // A ray that has reached a lens centre can only carry straight on: no choice of angle.
      var sc = P.z > Q.z ? 1 : -1;
      if (dz * sc <= 0) return null;
      var on = straightOn(scene, P, uc, sc, C, tol, solution, opt.self, scanned);
      if (scanned) on.nodes[0].dir = { kind: 'refract', el: Lc.id };
      return { node: on.nodes[0], nodes: on.nodes, p: on.p, pts: on.pts, axis: false,
        hints: [{ z: P.z, y: P.y, text: '' }].concat(on.anchor ? [{ z: on.p.z, y: on.p.y, text: '' }] : [])
          .concat(on.plane ? [{ z: on.p.z, y: on.p.y, text: '', plane: { z: on.p.z, ap: on.plane.ap } }] : []),
        text: (scanned ? 'bent by ' + planeName(Lc) + ' (straight on, at its centre)' : 'straight on through the centre of ' + planeName(Lc)) +
          (on.lens ? ', to ' + planeName(on.lens) :
          on.anchor ? ', to ' + refName(scene, on.anchor, solution) : on.plane ? ', ' + on.plane.text : '') };
    }
    // Two tiers: weak suggestions (a point on another ray, parallel to another ray, where a ray
    // crosses another lens's focal plane) only win
    // when nothing with optical meaning (F, F′, a centre, an image, a focal-plane crossing of the
    // lens being left, the
    // mirror's reflection, straight on, parallel to the axis) is within reach.
    var strong = null, weak = null, pars = [], offered = [];
    /** Offer a candidate snap: it is kept only if its error is within tolerance, and the best strong
        and best weak candidates are remembered. */
    function offer(err, cand, isWeak) {
      if (err > tol) return;
      cand.err = err; cand.weak = !!isWeak; offered.push(cand);
      if (isWeak) { if (!weak || err < weak.err) weak = cand; }
      else if (!strong || err < strong.err) strong = cand;
    }
    /** Distance from C to the line of slope u through the start point. */
    function lineErr(u) { return Math.abs(dy - u * dz) / Math.hypot(1, u); }   // C's distance from the line

    if (!opt.free && opt.keep && dz * opt.keep.sgn > 0) {
      offer(0.5 * lineErr(opt.keep.u), { dir: opt.keep.dir, u: opt.keep.u, sgn: opt.keep.sgn,
        hint: { text: 'same line' } });
    }
    if (!opt.free) {
      var LP = lensAt(scene, P);
      anchors(scene, solution, opt.self).forEach(function (a) {
        var az = a.p.z - P.z, ay = a.p.y - P.y, al = Math.hypot(az, ay);
        if (al < tol || Math.abs(az) < EPS || az * dz + ay * dy <= 0) return;   // on P, vertical, or behind
        if (!opt.helper) {
          // Past the lens the segment stops on, the straight line is not where the light goes:
          // only F of that lens (a negative lens: aimed at F, it leaves parallel) and images (a
          // virtual object for it) mean something there. Not an iris edge, F′ of a positive lens,
          // or another lens's F beyond it.
          var hitA = nextLens(scene, P, ay / az, az > 0 ? 1 : -1, tol);
          if (hitA && (a.p.z - hitA.lens.z) * (az > 0 ? 1 : -1) > tol &&
              !(a.ref.el === hitA.lens.id && a.ref.pt === 'F') && !a.ref.img) return;
        }
        // a point on another ray is a weak suggestion; so is where a ray crosses a focal plane,
        // unless it is a plane of the lens this ray is leaving (the helper-ray construction):
        // in a full bundle those crossings are everywhere and would pull rays off their aim
        var onRay = a.ref.ray != null && (!a.ref.plane || !LP || a.ref.plane.el !== LP.id);
        var hint = { z: a.p.z, y: a.p.y, text: 'through ' + refName(scene, a.ref, solution) };
        if (a.ref.plane) {
          var L = element(scene, a.ref.plane.el);
          hint.plane = { z: a.p.z, ap: L ? L.ap : 20 };
        }
        offer(Math.abs(az * dy - ay * dz) / al, {
          dir: { kind: 'through', at: a.ref }, u: ay / az, sgn: az > 0 ? 1 : -1, anchor: a, hint: hint
        }, onRay);
      });
      var uin = Q ? slope(Q, P) : undefined, straight = null;
      if (uin !== undefined) {
        var s0 = P.z > Q.z ? 1 : -1;
        if (dz * s0 > 0) offer(1.2 * lineErr(uin),
          straight = { dir: { kind: 'straight' }, u: uin, sgn: s0, hint: { z: P.z, y: P.y, text: 'straight on' } });
      }
      // leaving a lens: the way an ideal thin lens bends it, which then stays right as things move
      var Lb = !opt.helper && uin !== undefined && lensAt(scene, P), bent = null;
      if (Lb && Math.abs(P.y) > 1e-6) {
        var sb = P.z > Q.z ? 1 : -1, ub = uin - sb * P.y / Lb.f;
        if (dz * sb > 0) {
          bent = { dir: { kind: 'refract', el: Lb.id }, u: ub, sgn: sb, hint: { text: 'bent by ' + planeName(Lb) } };
          offer(1.4 * lineErr(ub), bent);        // classic rules (parallel, through F′) win ties
        }
      }
      var M = !Q && mirrorAt(scene, P, tol);            // starting at the mirror's pivot
      if (M && Math.abs(dz) > EPS) {
        var sm = dz > 0 ? 1 : -1, um = deflected(M, 0, sm);
        offer(0.8 * lineErr(um), { dir: sm > 0 ? { kind: 'deflect', el: M.id } : { kind: 'deflect', el: M.id, sgn: -1 }, u: um, sgn: sm,
          hint: { z: P.z, y: P.y, text: 'leaving ' + planeName(M) + ' at its tilt (' + M.tilt + '°)' } });
      }
      // Parallel to another ray: weak, as a full bundle is parallel rays everywhere, except
      // parallel to a helper ray, which is drawn on purpose as a construction line.
      scene.rays.forEach(function (r) {
        if (r.id === opt.self || !solution.rays[r.id]) return;
        var pts = solution.rays[r.id].pts;
        for (var k = 0; k + 1 < pts.length; k++) {
          var u = slope(pts[k], pts[k + 1]);
          if (u === undefined || Math.abs(u) < 1e-6 || Math.abs(dz) < EPS) continue;
          // highlight the whole straight line this segment is part of (e.g. both sides of a lens centre)
          var sh = solution.rays[r.id].shown, ia = k, ib = k + 1;
          while (ia > 0 && r.nodes[ia] && r.nodes[ia].dir.kind === 'straight') ia--;
          while (ib < sh.length - 1 && r.nodes[ib] && r.nodes[ib].dir.kind === 'straight') ib++;
          var pc = { dir: { kind: 'parallelTo', ray: r.id, seg: k }, u: u, sgn: dz > 0 ? 1 : -1, helper: !!r.helper,
            hint: { seg: { a: sh[ia] || pts[ia], b: sh[ib] || pts[ib] }, text: 'parallel to that ray' } };
          pars.push(pc);
          offer(lineErr(u), pc, !r.helper);
        }
      });
      if (Math.abs(dz) > EPS) offer(1.3 * Math.abs(dy),
        { dir: { kind: 'parallel' }, u: 0, sgn: dz > 0 ? 1 : -1, axis: true, hint: { text: 'parallel to the axis' } });
    }
    var best = strong || weak;
    /** True if candidates c and k describe the same line of light. */
    function onLine(c, k) { return c.sgn === k.sgn && Math.abs(c.u - k.u) <= 1e-9 * (1 + Math.abs(k.u)); }
    if (bent && bent.err != null && best && !onLine(best, bent) && best.hint.text !== 'same line') {
      // Leaving a lens, the way it bends the ray is the only line light can take: a snap that
      // gives another line (a focal-plane crossing a hair off it, say) loses to it (issue #13).
      // A snap on that very line still names it.
      best = offered.filter(function (c) { return onLine(c, bent); })
        .sort(function (a, b) { return (a.weak - b.weak) || (a.err - b.err); })[0];
    }
    if (best && best.dir.kind === 'parallelTo') best = allParallel(best, pars);
    // If the chosen line is exactly how the lens bends the ray, remember it as "bent by" the lens
    // (it then stays right when things move), keeping the classic highlight (the axis, F′) -
    // unless the way the ray came in already guarantees the classic rule at this lens: in
    // parallel to the axis (so out through F′), or in through this lens's F (so out parallel).
    var inD = opt.inDir, classic = inD && (inD.kind === 'parallel' ||
      (inD.kind === 'through' && inD.at && inD.at.el === (Lb && Lb.id) && inD.at.pt === 'F'));
    if (best && bent && best !== bent && inD && !classic &&
        Math.abs(best.u - bent.u) < 1e-9 && best.sgn === bent.sgn) {
      best = Object.assign({}, best, { dir: bent.dir, anchor: null,
        hint: best.hint ? Object.assign({}, best.hint, { text: best.hint.text + ' (bent by ' + planeName(Lb) + ')' }) : bent.hint });
    }
    var aimed = best && best.dir.at;               // what the line was aimed through, as offered
    if (best && scanned && best.dir.kind === 'through' && best.dir.at.el != null) {
      // A scanned ray only passes a fixed point (F′, a centre) at this tilt. If the way the lens
      // bends it, or straight on, is the same line, remember that instead; keep the words.
      var same = [bent, straight].filter(function (k) { return k && Math.abs(k.u - best.u) < 1e-9 && k.sgn === best.sgn; })[0];
      if (same) best = Object.assign({}, best, { dir: same.dir, anchor: null });
    }
    if (best && best.hint && !best.hint.seg) {
      // Another snap won with exactly the line parallel to other rays (e.g. all the rays from a
      // point in the front focal plane leave the lens parallel): show and say that as well.
      var along = parallelRays(best, pars);
      if (along.length) best = Object.assign({}, best, {
        hint: Object.assign({}, best.hint, { text: best.hint.text + ', parallel to ' + (along.length > 1 ? 'those rays' : 'that ray') }),
        alsoParallel: along.map(function (c) { return { seg: c.hint.seg, text: '' }; }) });
    }
    if (!best) {
      if (Math.abs(dz) < EPS) return null;
      best = { dir: { kind: 'free' }, u: dy / dz, sgn: dz > 0 ? 1 : -1, hint: null };
    }

    var u0 = best.u, sgn = best.sgn, free = best.dir.kind === 'free';
    var hints = (best.hint && (best.hint.z != null || best.hint.seg) ? [best.hint] : []).concat(best.alsoParallel || []);
    var text = best.hint ? best.hint.text : '';
    var hit = opt.helper ? planeAtCursor(scene, P, u0, sgn, C, tol) : nextLens(scene, P, u0, sgn, tol), node, p, more = null, pe;
    var stop = hit && (opt.helper || (C.z - hit.lens.z) * sgn >= -tol);
    if (stop) {                                                       // reached a lens or mirror: stop on it
      p = { z: hit.lens.z, y: hit.y };
      node = { dir: best.dir, end: free ? { kind: 'lens', el: hit.lens.id, y: hit.y } : { kind: 'lens', el: hit.lens.id } };
      hints.push({ z: p.z, y: p.y, text: '', small: true });
      var at = aimed;
      if (at && at.el === hit.lens.id && at.pt === 'C' && (C.z - hit.lens.z) * sgn > tol) {
        // through the centre and on: light there is undeviated, so carry straight on in the same click
        more = straightOn(scene, p, u0, sgn, C, tol, solution, opt.self, scanned);
        if (scanned) more.nodes[0].dir = { kind: 'refract', el: hit.lens.id };   // see isScanned
        if (more.anchor) hints.push({ z: more.p.z, y: more.p.y, text: '' });
        if (more.plane) hints.push({ z: more.p.z, y: more.p.y, text: '', plane: { z: more.p.z, ap: more.plane.ap } });
        text = (text ? text + ', ' : '') + 'straight on' + (more.lens ? ' to ' + planeName(more.lens) :
          more.anchor ? ' to ' + refName(scene, more.anchor, solution) : more.plane ? ', ' + more.plane.text : '');
      } else if (hit.lens.type === 'mirror' && !opt.helper) {
        // the scan mirror: light goes on through it, tilted by the mirror, in the same click
        more = throughMirror(scene, p, u0, sgn, hit.lens, C, tol, solution, opt.self);
        text = (text ? text + ', ' : '') + more.text;
      } else text = (text ? text + ', ' : '') + 'to ' + planeName(hit.lens);
    } else if (best.anchor && G.dist(C, best.anchor.p) <= tol && !(scanned && best.anchor.ref.el != null)) {   // ending on the anchor itself
      p = { z: best.anchor.p.z, y: best.anchor.p.y };
      node = { dir: best.dir, end: { kind: 'at', at: best.anchor.ref } };
      text = 'to ' + refName(scene, best.anchor.ref, solution);
    } else if (!opt.free && !free && (pe = planeEnd(scene, P, u0, sgn, C, tol))) {   // ending on a focal plane
      p = pe.p;
      node = { dir: best.dir, end: pe.marker ? { kind: 'lens', el: pe.L.id } : { kind: 'plane', el: pe.L.id, pt: pe.pt } };
      hints.push({ z: p.z, y: p.y, text: '', plane: { z: p.z, ap: pe.ap } });
      text = (text ? text + ', ' : '') + pe.text;
    } else if (free) {
      p = { z: C.z, y: C.y };
      node = { dir: best.dir, end: { kind: 'z', z: C.z, y: C.y } };
    } else {                                                          // the cursor projected onto the line
      var t = (dz + u0 * dy) / (1 + u0 * u0);
      p = { z: P.z + t, y: P.y + u0 * t };
      node = { dir: best.dir, end: { kind: 'z', z: p.z } };
    }
    var nodes = [node], pts = [p];
    if (more) {
      nodes = nodes.concat(more.nodes);
      pts = pts.concat(more.pts);
    }
    if (!opt.helper) {                                                // an iris blade (or a rim, a dichroic) in the way stops it there
      var from = P;
      for (var i = 0; i < pts.length; i++) {
        var blk = blockAt(scene, from, pts[i], opt.colour);
        if (blk) {
          var bn = { dir: nodes[i].dir, end: nodes[i].dir.kind === 'free' ? { kind: 'lens', el: blk.el.id, y: blk.y } : { kind: 'lens', el: blk.el.id } };
          nodes = nodes.slice(0, i).concat([bn]); pts = pts.slice(0, i).concat([{ z: blk.z, y: blk.y }]);
          hints.push({ z: blk.z, y: blk.y, text: '', small: true });
          text = (text ? text + ', ' : '') + (blk.rim ? 'misses ' + planeName(blk.el) + ': stopped by its rim' :
            blk.el.type === 'dichroic' ? 'stopped by ' + planeName(blk.el) + ' (its colour)' : 'blocked by ' + planeName(blk.el));
          break;
        }
        from = pts[i];
      }
    }
    return { node: nodes[0], nodes: nodes, p: pts[pts.length - 1], pts: pts, hints: hints, axis: !!best.axis, text: text };
  }

  /** A "parallel to that ray" snap, widened to every ray exactly parallel to it (the same
      direction to rounding), so the choice cannot flicker between them as the cursor moves. All
      are highlighted; the snap is remembered as parallel to a helper among them if there is one
      (a construction line drawn for this), else to the first drawn. */
  function parallelRays(best, pars) {
    var same = pars.filter(function (c) { return c.sgn === best.sgn && Math.abs(c.u - best.u) <= 1e-9 * (1 + Math.abs(best.u)); });
    var seen = {};
    return same.filter(function (c) { return !seen[c.dir.ray] && (seen[c.dir.ray] = true); });
  }

  /** Of several snaps that all describe parallel rays, return the one to use (the helper ray if
      there is one), keeping the error of the best. */
  function allParallel(best, pars) {
    var rays = parallelRays(best, pars);
    if (rays.length < 2) return best;
    var keep = rays.filter(function (c) { return c.helper; })[0] || rays[0];
    return Object.assign({}, keep, { err: best.err,
      hint: Object.assign({}, keep.hint, { text: 'parallel to those rays' }),
      alsoParallel: rays.filter(function (c) { return c !== keep; }).map(function (c) { return { seg: c.hint.seg, text: '' }; }) });
  }

  /** Has ray `id` come through a scan mirror (or started at one)? Then where it goes depends on
      the mirror's tilt. */
  function isScanned(scene, id) {
    var r = id && rayById(scene, id);
    return !!r && !r.helper && (r.nodes.some(function (n) { return n.dir.kind === 'deflect'; }) ||
      (!!r.start.at && r.start.at.pt === 'P'));
  }

  /** The "straight on" segment after the lens centre at p (slope u, direction sgn), stopping
      at the next lens or mirror if the cursor C is at or past it, else at C projected onto the line.
      For a scanned ray, a further lens centre it passes bends it (as a lens does, which is no bend
      at the centre) and it does not end on fixed points. */
  function straightOn(scene, p, u, sgn, C, tol, solution, self, scanned) {
    var hit = nextLens(scene, p, u, sgn, tol);
    if (hit && (C.z - hit.lens.z) * sgn >= -tol) {
      var node = { dir: { kind: 'straight' }, end: { kind: 'lens', el: hit.lens.id } }, q = { z: hit.lens.z, y: hit.y };
      if (hit.lens.type === 'lens' && Math.abs(hit.y) < 1e-6 && (C.z - hit.lens.z) * sgn > tol) {
        // through this lens's centre too (a ray along the axis): still undeviated, carry on
        var rest = straightOn(scene, q, u, sgn, C, tol, solution, self, scanned);
        if (scanned) rest.nodes[0].dir = { kind: 'refract', el: hit.lens.id };
        return { nodes: [node].concat(rest.nodes), pts: [q].concat(rest.pts), p: rest.p, lens: rest.lens,
          anchor: rest.anchor, plane: rest.plane };
      }
      return { nodes: [node], pts: [q], p: q, lens: hit.lens };
    }
    if (solution) {                                // a point (F′, an image, …) on the line, by the cursor: end there
      var best = null, bestD = tol;
      anchors(scene, solution, self).forEach(function (a) {
        if (a.ref.ray != null && !a.ref.plane) return;                   // not points on other rays
        if (scanned && a.ref.el != null) return;                          // nor fixed points, for a scanned ray
        if ((a.p.z - p.z) * sgn <= 1e-6 || Math.abs(a.p.y - (p.y + u * (a.p.z - p.z))) > 1e-6 * (1 + Math.abs(a.p.z - p.z))) return;
        var d = G.dist(a.p, C);
        if (d <= bestD) {
          best = a;
          bestD = d;
        }
      });
      if (best) return { nodes: [{ dir: { kind: 'straight' }, end: { kind: 'at', at: best.ref } }],
        pts: [{ z: best.p.z, y: best.p.y }], p: { z: best.p.z, y: best.p.y }, lens: null, anchor: best.ref };
      var fp = planeEnd(scene, p, u, sgn, C, tol);
      if (fp) return { nodes: [{ dir: { kind: 'straight' }, end: fp.marker ? { kind: 'lens', el: fp.L.id } : { kind: 'plane', el: fp.L.id, pt: fp.pt } }],
        pts: [fp.p], p: fp.p, lens: null, plane: fp };
    }
    var t = ((C.z - p.z) + u * (C.y - p.y)) / (1 + u * u), e = { z: p.z + t, y: p.y + u * t };
    return { nodes: [{ dir: { kind: 'straight' }, end: { kind: 'z', z: e.z } }], pts: [e], p: e, lens: null };
  }

  /** The segment leaving scan mirror M at p, for light arriving with slope u running in
      direction sgn: tilted by the mirror's beam tilt. It runs to the next lens if the cursor C
      is past the mirror (stopping at the cursor if C is short of that lens), or straight to the
      next lens if C is still at the mirror. Returns { nodes, pts, p, text }. */
  function throughMirror(scene, p, u, sgn, M, C, tol, solution, self) {
    var u2 = deflected(M, u, sgn), dir = { kind: 'deflect', el: M.id }, on;
    var name = 'through ' + planeName(M) + (M.tilt ? ', tilted ' + Math.round(M.tilt * 10) / 10 + '°' : '');
    if ((C.z - p.z) * sgn > tol) {
      on = straightOn(scene, p, u2, sgn, C, tol, solution, self, true);
      on.nodes[0].dir = dir;
    } else {
      var nx = nextLens(scene, p, u2, sgn, 0), q = nx ? { z: nx.lens.z, y: nx.y } : { z: p.z + sgn * FAR, y: p.y + u2 * sgn * FAR };
      on = { nodes: [{ dir: dir, end: sgn > 0 ? { kind: 'next' } : { kind: 'next', sgn: -1 }, pass: true }], pts: [q], p: q, lens: nx && nx.lens };
    }
    return { nodes: on.nodes, pts: on.pts, p: on.p,
      text: name + (on.lens ? ', to ' + planeName(on.lens) : on.anchor ? ', to ' + refName(scene, on.anchor, solution) :
        on.plane ? ', ' + on.plane.text : '') };
  }

  /** Light passes through a scan mirror. Any (non-helper) ray whose last point is on a mirror
      (a collimated beam's rays run "to the next lens", which may be a mirror placed in their
      way; a ray may have been cut at one) gets a segment through it: tilted by the mirror, on
      the way it was going, to the next lens. Such an added segment (marked `pass`) is taken
      off again if the mirror has moved away from where it starts. Returns true if anything
      changed. */
  function passMirrors(scene) {
    var changed = false, solution = solveScene(scene);
    scene.rays.forEach(function (r) {
      var s = solution.rays[r.id], N = r.nodes.length, last = r.nodes[N - 1];
      if (r.helper || !s || !N) return;
      if (last.pass && last.dir.kind === 'deflect') {
        var P0 = s.pts[N - 1], M0 = element(scene, last.dir.el);
        if (!P0 || !M0 || M0.type !== 'mirror' || Math.abs(M0.z - P0.z) > 1e-6 || Math.abs(P0.y) > M0.ap + 1e-6) {
          r.nodes.pop(); changed = true;
        }
        return;
      }
      if (!s.ok || s.blocked || s.trimmed || s.pts.length !== N + 1) return;
      var a = s.pts[N - 1], b = s.pts[N], M = element(scene, s.lens[N]);
      if (!M || M.type !== 'mirror' || Math.abs(b.z - a.z) < EPS) return;
      r.nodes.push({ dir: { kind: 'deflect', el: M.id }, end: b.z > a.z ? { kind: 'next' } : { kind: 'next', sgn: -1 }, pass: true });
      changed = true;
    });
    return changed;
  }

  /** Lengthen the last segment of a ray to the next lens or mirror, or to the edge if there is
      none (a helper, which passes through lenses, always goes to the edge). Returns the new
      node, or null if the segment cannot be extended. */
  function extendNode(scene, n, P, E, tol, helper) {
    var onMarker = n.end.kind === 'lens' && (element(scene, n.end.el) || {}).type === 'plane';
    if (Math.abs(E.z - P.z) < EPS || n.end.kind === 'edge' || (n.end.kind === 'lens' && !onMarker)) return null;
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
    var solution = solveScene(scene), changed = false;
    solution.images.forEach(function (image) {
      if (image.virtual || image.focus) return;
      image.rays.forEach(function (rr) {
        var r = rayById(scene, rr.ray), s = solution.rays[rr.ray], last = s && s.pts.length - 1;
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

  /** Make the last segment of ray r stop on lens (or mirror) L, keeping its line. With L null,
      stop it at z instead (where it forms an image, so it can be drawn on past the image).
      Rays pinned to the part cut off are freed first. Returns true if done. */
  function cutAt(scene, r, L, z) {
    var s = solveScene(scene).rays[r.id], n = s.pts.length;
    var k = keepDir(r.nodes[r.nodes.length - 1], s.pts[n - 2], s.pts[n - 1]);
    if (!k) return false;
    bake(scene, tailRefs(r.id, n - 1));
    r.nodes[r.nodes.length - 1] = { dir: k.dir, end: L ? { kind: 'lens', el: L.id } : { kind: 'z', z: z } };
    return true;
  }

  // ---------------------------------------------------------------- reversing a ray

  /** Reverse ray r in place: the light now runs the other way along the same line(s). Every
      point keeps what it was pinned to (a lens, F′, an image…), and every segment its rule
      (through a point, parallel, parallel to another ray). A "straight on" moves to the other
      segment of its pair, so a line through a lens centre stays one straight line. The new start
      is the old end: the image it was drawn ending at, the point it ended on, or (for a ray run
      to the edge) a free point 150 mm out. Rays pinned to its points are renumbered.
      Returns true if done. */
  function reverseRay(scene, r) {
    var solution = solveScene(scene), s = solution.rays[r.id];
    if (!s || !s.ok || s.pts.length < 2 || s.blocked) return false;
    var pts = s.pts, N = r.nodes.length, nodes = r.nodes, old = JSON.parse(JSON.stringify(r));
    // the rule each old segment follows, with "straight on" resolved to the segment it continues
    var real = [];
    for (var k = 0; k < N; k++) {
      var d = nodes[k].dir;
      if (d.kind === 'straight') real[k] = k ? real[k - 1] : { kind: 'slope', u: slope(pts[0], pts[1]) };
      else if (d.kind === 'deflect' || d.kind === 'refract') real[k] = { kind: 'slope', u: slope(pts[k], pts[k + 1]) };
      else real[k] = d;
    }
    /** What old point k is pinned to, written as an end of a segment. */
    function pinOf(k) {                       // what old point k is pinned to, as an end
      if (k === 0) return old.start.at ? { kind: 'at', at: old.start.at } : { kind: 'z', z: pts[0].z, y: pts[0].y };
      var e = nodes[k - 1].end;
      if (e.kind === 'lens') return { kind: 'lens', el: e.el, y: pts[k].y };
      if (e.kind === 'at') return { kind: 'at', at: e.at };
      return { kind: 'z', z: pts[k].z, y: pts[k].y, on: e.on };
    }
    // the new start: the old end
    var start, last = nodes[N - 1].end, image = null;
    solution.images.forEach(function (x) {
      if (!x.virtual && !x.focus && x.rays.some(function (rr) { return rr.ray === r.id && rr.k === N - 1; })) image = x;
    });
    if (s.trimmed && image) start = { at: { img: { src: image.src, lens: image.lens } } };
    else if (last.kind === 'at') start = { at: last.at };
    else if (last.kind === 'edge') {
      var a = pts[N - 1], b = pts[N], L = Math.hypot(b.z - a.z, b.y - a.y);
      start = { z: a.z + (b.z - a.z) * 150 / L, y: a.y + (b.y - a.y) * 150 / L };
    } else start = { z: pts[N].z, y: pts[N].y };
    // new segment j runs from old point N-j to old point N-j-1 along old segment N-1-j
    var out = [];
    for (var j = 0; j < N; j++) {
      var kk = N - 1 - j, dir;
      if (kk + 1 < N && nodes[kk + 1].dir.kind === 'straight') dir = { kind: 'straight' };   // continues the one before
      else dir = JSON.parse(JSON.stringify(real[kk]));
      var end = pinOf(kk);
      if (dir.kind !== 'free') {
        delete end.y;
        if (end.kind === 'z' && !end.on) delete end.on;
      }
      if (end.kind === 'z' && end.on == null) delete end.on;
      out.push({ dir: dir, end: end });
    }
    r.start = start; r.nodes = out;
    // other rays pinned to this one: point k becomes N-k, segment g becomes N-1-g
    function fix(ref) {
      if (!ref) return;
      if (ref.img) {
        fix(ref.img.src);
        return;
      }
      if (ref.ray !== r.id) return;
      if (ref.plane || ref.seg != null) ref.seg = N - 1 - ref.seg; else ref.k = N - ref.k;
    }
    scene.rays.forEach(function (q) {
      if (q === r) return;
      fix(q.start.at); fix(q.start.from);
      q.nodes.forEach(function (n) {
        fix(n.dir.at); fix(n.end.at);
        if (n.dir.kind === 'parallelTo' && n.dir.ray === r.id) n.dir.seg = N - 1 - n.dir.seg;
      });
    });
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
      irises on its own. Returns [{ pts, ray (the ray whose colour to use), masked (stopped by an
      iris that fades what it stops), edge (the outermost that gets past such an iris, on a side
      where the drawn ray does not: drawn like a drawn ray, to show the edge of the light, #14) }]. */
  function fillRays(scene, solution, n) {
    var out = [], groups = {}, order = [];
    if (!n) return out;
    var real = solveScene(scene);
    /** True if ray r is stopped by an iris, so its fill-in is hidden. */
    function faded(r) { var b = real.rays[r.id] && real.rays[r.id].blocked, e = b && element(scene, b); return !!(e && e.mask); }
    solution = solveScene(scene, { noBlock: true });
    scene.rays.forEach(function (r) {
      var src = raySource(scene, r), s = solution.rays[r.id];
      if (!src || !s || s.shown.length < 2) return;
      var key = refKey(src);
      if (!groups[key]) {
        groups[key] = [];
        order.push(key);
      }
      groups[key].push({ r: r, s: s });
    });
    /** The lenses and mirrors a ray has points on, in order, as [{ id, k }] (k: index in shown).
        Free points along the way are ignored: they are not where a ray bends. The end counts
        only if it lies on a plane and the ray is not drawn ending at an image. */
    function bends(s, k) {                       // does light bend at point k of a solved ray?
      if (!s.lens[k]) return false;
      var pe = element(scene, s.lens[k]);
      return !(pe && (pe.type === 'plane' || pe.type === 'dichroic'));   // a marker or dichroic: light passes straight on
    }
    /** The lens/mirror planes that the traced ray m bends at. */
    function planesOf(m) {
      var out = [], sh = m.s.shown, last = sh.length - 1;
      for (var k = 1; k <= last; k++) {
        if (!bends(m.s, k) || (k === last && m.s.trimmed)) continue;
        out.push({ id: m.s.lens[k], k: k });
      }
      return out;
    }
    /** Two rays that meet at a free point (an image) and each carry on from there along the
        other's line look the same as two straight rays: swap their tails there, so that the
        fill follows straight lines through the point. Returns [a, b] as { s } like the groups. */
    function untangle(A, B) {
      var a = A.s, b = B.s;
      for (var i = 1; i < a.shown.length - 1; i++) {
        if (bends(a, i)) continue;
        for (var j = 1; j < b.shown.length - 1; j++) {
          if (bends(b, j)) continue;
          var P = a.shown[i], Q = b.shown[j];
          if (Math.abs(P.z - Q.z) > 1e-6 || Math.abs(P.y - Q.y) > 1e-6) continue;
          var ai = slope(a.shown[i - 1], P), ao = slope(P, a.shown[i + 1]);
          var bi = slope(b.shown[j - 1], Q), bo = slope(Q, b.shown[j + 1]);
          if (Math.abs(ai - bo) + Math.abs(bi - ao) >= Math.abs(ai - ao) + Math.abs(bi - bo)) continue;
          var tail = function (s, k, t, l) {
            return { shown: s.shown.slice(0, k + 1).concat(t.shown.slice(l + 1)),
              lens: s.lens.slice(0, k + 1).concat(t.lens.slice(l + 1)), trimmed: t.trimmed };
          };
          var na = { r: A.r, s: tail(a, i, b, j) }, nb = { r: B.r, s: tail(b, j, a, i) };
          na.planes = planesOf(na); nb.planes = planesOf(nb);
          return untangle(na, nb);                 // and any further crossings
        }
      }
      return [A, B];
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
      if (Math.abs(set[0].y - set[set.length - 1].y) < 1e-9) return;
      var AB = untangle(set[0].m, set[set.length - 1].m), A = AB[0], B = AB[1];
      var pa = A.s.shown, pb = B.s.shown, qa = A.planes, qb = B.planes, m = 0;
      while (m < qa.length && m < qb.length && qa[m].id === qb[m].id) m++;     // planes both pass, in order
      // after the last shared plane: each ray's next segment gives a slope, its end a length
      var ka = m ? qa[m - 1].k : 0, kb = m ? qb[m - 1].k : 0;
      var ua = pa[ka + 1] ? slope(pa[ka], pa[ka + 1]) : undefined, ub = pb[kb + 1] ? slope(pb[kb], pb[kb + 1]) : undefined;
      var ea = pa[pa.length - 1], eb = pb[pb.length - 1], mine = [];
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
          var blk = blockAt(scene, pts[q - 1], pts[q], rayColour(scene, A.r));
          if (blk) {
            pts = pts.slice(0, q).concat([{ z: blk.z, y: blk.y }]);
            break;
          }
        }
        mine.push({ pts: pts, ray: A.r, masked: !!(blk && blk.el.mask), edge: false });
      }
      // the outermost that pass, next to one faded (or to a faded drawn ray at the edge)
      var faint = [faded(A.r)].concat(mine.map(function (f) { return f.masked; }), [faded(B.r)]);
      mine.forEach(function (f, k) { f.edge = !f.masked && (faint[k] || faint[k + 2]); });
      out.push.apply(out, mine.filter(function (f) { return f.pts.length > 1; }));
    });
    return out;
  }

  return {
    FAR: FAR, rayColour: rayColour, refKey: refKey, owner: owner, fillRays: fillRays, blockAt: blockAt, refPos: refPos, refName: refName, sameRef: sameRef, mentions: mentions,
    raySource: raySource, rootElement: rootElement, magnification: magnification, classify: classify, raysOf: raysOf, beamDir: beamDir,
    solveScene: solveScene, minAperture: minAperture, solveAll: solveAll, extendToImages: extendToImages, passMirrors: passMirrors,
    bake: bake, bakeAll: bakeAll, bakeBefore: bakeBefore, bakeRefsTo: bakeRefsTo, tailRefs: tailRefs,
    anchors: anchors, nextLens: nextLens, centreAt: centreAt, isJoint: isJoint,
    keepDir: keepDir, crossings: crossings, cutAt: cutAt, reverseRay: reverseRay,
    proposeStart: proposeStart, proposeSegment: proposeSegment, extendNode: extendNode
  };
});
