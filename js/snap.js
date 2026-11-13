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
          { value: fp.F, text: 'F of ' + n }, { value: fp.Fp, text: 'F′ of ' + n },
          { value: e.z - 2 * e.f, text: '2F of ' + n }, { value: e.z + 2 * e.f, text: '2F′ of ' + n });
      } else if (e.type === 'object') {
        pts.push({ value: e.z, text: 'object' + (e.label ? ' ' + e.label : '') });
      } else if (e.type === 'point') {
        pts.push({ value: e.z, text: 'point source' + (e.label ? ' ' + e.label : '') });
      } else if (e.type === 'mirror') {
        pts.push({ value: e.z, text: 'the scan mirror' + (e.label ? ' ' + e.label : '') });
      }
    });
    return pts;
  }

  /** Snap a position on the axis to a key point, else to the grid. opt: { tol, grid, free }. */
  function snapAxisZ(scene, rawZ, excludeId, opt) {
    if (opt.free) return { z: rawZ, hit: null };
    var k = G.nearest1D(rawZ, axisKeyPoints(scene, excludeId), opt.tol);
    if (k) return { z: k.value, hit: { z: k.value, y: 0, text: k.text } };
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

  return {
    axisKeyPoints: axisKeyPoints, snapAxisZ: snapAxisZ, snapLensZ: snapLensZ,
    snapFocal: snapFocal, snapHeight: snapHeight
  };
});
