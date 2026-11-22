/* RayMan snapping rules for moving things on the bench. Pure functions, no DOM.

   Every snap returns the snapped value and, when it lined up with something meaningful,
   a `hit` describing that something ({ z, y, text }) so the canvas can highlight it.
   Grid snapping is the fallback and is not highlighted. */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var m = factory(node ? require('./geom.js') : root.RM.geom);
  if (node) module.exports = m;
  else root.RM.snap = m;
})(typeof self !== 'undefined' ? self : this, function (G) {
  'use strict';

  /** The name to show for a lens: its label, or "lens". */
  function lensName(e) { return e.label || 'lens'; }

  /** Positions on the axis worth lining things up with, excluding element excludeId. */
  function axisKeyPoints(scene, excludeId) {
    var pts = [];
    scene.elements.forEach(function (e) {
      if (e.id === excludeId) return;
      var n = lensName(e);
      if (e.type === 'lens') {
        var fp = G.focalPoints(e);
        pts.push({ value: e.z, text: 'centre of ' + n },
          { value: fp.F, text: 'F of ' + n, lens: true }, { value: fp.Fp, text: 'F′ of ' + n, lens: true },
          { value: e.z - 2 * e.f, text: '2F of ' + n, lens: true }, { value: e.z + 2 * e.f, text: '2F′ of ' + n, lens: true });
        pts[pts.length - 5].lens = true;                     // the centre too
      } else if (e.type === 'object') {
        pts.push({ value: e.z, text: 'object' + (e.label ? ' ' + e.label : '') });
      } else if (e.type === 'point') {
        pts.push({ value: e.z, text: 'point source' + (e.label ? ' ' + e.label : '') });
      } else if (e.type === 'mirror') {
        pts.push({ value: e.z, text: 'the scan mirror' + (e.label ? ' ' + e.label : '') });
      } else if (e.type === 'iris') {
        pts.push({ value: e.z, text: 'the iris' + (e.label ? ' ' + e.label : '') });
      } else if (e.type === 'dichroic') {
        pts.push({ value: e.z, text: e.label ? 'the ' + e.label : 'the dichroic' });
      } else if (e.type === 'plane') {
        pts.push({ value: e.z, text: e.label ? 'the ' + e.label + ' plane' : 'the image plane' });
      } else if (e.type === 'filament') {
        pts.push({ value: e.z, text: 'the lamp filament' + (e.label ? ' ' + e.label : '') });
      }
    });
    return pts;
  }

  /** Snap a position on the axis to a key point, else to the grid. opt: { tol, grid, free,
      extra: more key points, e.g. where images are ([{ value, text }]) }. */
  function snapAxisZ(scene, rawZ, excludeId, opt) {
    if (opt.free) return { z: rawZ, hit: null };
    var k = G.nearest1D(rawZ, (opt.extra || []).concat(axisKeyPoints(scene, excludeId)), opt.tol);   // extras win ties
    if (k) return { z: k.value, hit: { z: k.value, y: 0, text: k.text } };
    return { z: opt.grid ? G.quantize(rawZ, opt.grid) : rawZ, hit: null };
  }

  /** Distances from a lens, in focal lengths, that an object snaps to: F, then quarter steps
      to 2F, then half steps beyond. */
  var MULTIPLES = [1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6];

  /** Snap an object (or filament, or point source) along the axis. Only the nearest lens on
      each side counts: the object lines up with F, every quarter F between F and 2F, and every
      half F beyond, on its side of that lens, and with the lens itself. Other elements (objects,
      mirrors, irises) count as usual; lenses further away do not. The hit carries `dim`, the
      lens and object positions, so the distance can be drawn. */
  function snapObjectZ(scene, rawZ, excludeId, opt) {
    if (opt.free) return { z: rawZ, hit: null };
    var left = null, right = null;
    scene.elements.forEach(function (e) {
      if (e.type !== 'lens') return;
      if (e.z <= rawZ && (!left || e.z > left.z)) left = e;
      if (e.z > rawZ && (!right || e.z < right.z)) right = e;
    });
    var cands = axisKeyPoints(scene, excludeId).filter(function (k) { return !k.lens; });
    [left, right].forEach(function (L) {
      if (!L) return;
      var side = L === left ? 1 : -1, n = lensName(L), f = Math.abs(L.f);
      var mark = (side > 0) === (L.f > 0) ? 'F′' : 'F';       // F′ on the outgoing side of a converging lens
      cands.push({ value: L.z, text: 'centre of ' + n });
      MULTIPLES.forEach(function (k) {
        cands.push({ value: L.z + side * k * f, text: (k === 1 ? '' : String(k)) + mark + ' of ' + n,
          dim: { from: L.z, label: (k === 1 ? '' : String(k)) + 'f' } });
      });
    });
    var best = G.nearest1D(rawZ, cands, opt.tol);
    if (best) {
      var hit = { z: best.value, y: 0, text: best.text };
      if (best.dim) hit.dim = { z0: best.dim.from, z1: best.value, label: best.dim.label };
      return { z: best.value, hit: hit };
    }
    return { z: opt.grid ? G.quantize(rawZ, opt.grid) : rawZ, hit: null };
  }

  /** Snap a dragged lens (focal length f, id) whose centre is near rawZ. Its centre, F or F′
      may land on any key point of the other elements, which is how you build a 4f system:
      drag lens 2 until its F sits on F′ of lens 1. Two lens centres may not coincide. */
  function snapLensZ(scene, lens, rawZ, opt) {
    if (opt.free) return { z: rawZ, hit: null };
    var own = [{ d: 0, text: 'centre' }, { d: -lens.f, text: 'F' }, { d: lens.f, text: 'F′' }];
    var cands = [];
    axisKeyPoints(scene, lens.id).forEach(function (k) {
      own.forEach(function (o) {
        if (o.d === 0 && k.text.indexOf('centre') === 0) return;
        cands.push({ value: k.value - o.d, at: k.value,
          text: (o.d === 0 ? 'lens' : o.text) + ' on ' + k.text });
      });
    });
    var best = G.nearest1D(rawZ, cands, opt.tol);
    if (best) return { z: best.value, hit: { z: best.at, y: 0, text: best.text } };
    return { z: opt.grid ? G.quantize(rawZ, opt.grid) : rawZ, hit: null };
  }

  /** Snap a dragged focal point of a lens to a key point or the grid, returning the new f.
      which is 'F' or 'Fp'. f is never allowed closer to zero than minF. */
  function snapFocal(scene, lens, which, rawZ, opt) {
    var s = snapAxisZ(scene, rawZ, lens.id, opt);
    var f = which === 'Fp' ? s.z - lens.z : lens.z - s.z;
    var minF = opt.minF || 1;
    if (Math.abs(f) < minF) { f = (f < 0 ? -1 : 1) * minF; s.hit = null; }
    return { f: f, hit: s.hit };
  }

  /** Snap a height: onto the axis if close, else the grid. */
  function snapHeight(rawY, opt) {
    if (opt.free) return { y: rawY, hit: null };
    if (Math.abs(rawY) <= opt.tol) return { y: 0, hit: { text: 'on the axis' } };
    return { y: opt.grid ? G.quantize(rawY, opt.grid) : rawY, hit: null };
  }

  var MIN_OBJECT_H = 10;
  /** An object's height from the cursor's height: never smaller than 10 mm either way up (a point
      source is for no height). Across the axis it flips to -10. */
  function objectHeight(rawY, opt) {
    var y = snapHeight(rawY, opt).y;
    return Math.abs(y) < MIN_OBJECT_H ? (rawY < 0 ? -MIN_OBJECT_H : MIN_OBJECT_H) : y;
  }

  return {
    objectHeight: objectHeight, MIN_OBJECT_H: MIN_OBJECT_H, axisKeyPoints: axisKeyPoints, snapAxisZ: snapAxisZ, snapObjectZ: snapObjectZ, snapLensZ: snapLensZ,
    snapFocal: snapFocal, snapHeight: snapHeight
  };
});
