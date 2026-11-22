/* RayMan geometry: pure functions, no drawing and no DOM.

   World units are millimetres. z runs along the optical axis (left to right), y is height
   above the axis (up is positive). Points are plain objects { z, y }.

   Loaded in the browser as a classic script (window.RM.geom), so the app works when opened
   straight from disk, or required from Node for the tests. */
(function (root, factory) {
  var m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else { root.RM = root.RM || {}; root.RM.geom = m; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Round v to the nearest multiple of step. */
  function quantize(v, step) {
    var q = Math.round(v / step) * step;
    return q === 0 ? 0 : q;            // no -0
  }

  /** A "nice" grid spacing (1, 2 or 5 x 10^n) such that lines are at least minPx apart. */
  function niceStep(pxPerUnit, minPx) {
    var raw = minPx / pxPerUnit;
    var p = Math.pow(10, Math.floor(Math.log10(raw)));
    var m = raw / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
  }

  /** The millimetres between the numbers on the ruler: a nice step (1, 2 or 5 x 10^n) so that
      about 10 to 15 numbers fit across widthPx at this zoom (pxPerMm), and no two are closer than
      56 px (narrow screens get fewer). */
  function rulerStep(pxPerMm, widthPx) {
    return niceStep(pxPerMm, Math.max(56, widthPx / 16));
  }

  /** How many minor grid steps make a major one, so major lines land on 5s and 10s. */
  function majorEvery(step) {
    var m = Math.round(step / Math.pow(10, Math.floor(Math.log10(step) + 1e-9)));
    return m === 5 ? 2 : 5;
  }

  /** Front (F) and back (F′) focal points of a thin lens. For f < 0 they swap sides. */
  function focalPoints(lens) {
    return { F: lens.z - lens.f, Fp: lens.z + lens.f };
  }

  /** Of candidates (objects with a numeric .value), the one nearest to v within tol, else null. */
  function nearest1D(v, candidates, tol) {
    var best = null, bestErr = Infinity;
    candidates.forEach(function (c) {
      var err = Math.abs(c.value - v);
      if (err <= tol && err < bestErr) { best = c; bestErr = err; }
    });
    return best;
  }

  /** Distance between two points. */
  function dist(a, b) { return Math.hypot(a.z - b.z, a.y - b.y); }

  /** Distance from p to the segment a-b. */
  function distToSegment(p, a, b) {
    var dz = b.z - a.z, dy = b.y - a.y, L2 = dz * dz + dy * dy;
    if (L2 === 0) return dist(p, a);
    var t = ((p.z - a.z) * dz + (p.y - a.y) * dy) / L2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(p.z - (a.z + t * dz), p.y - (a.y + t * dy));
  }

  /** Intersection of the infinite lines p1-p2 and p3-p4, or null if they are parallel. */
  function lineIntersection(p1, p2, p3, p4) {
    var d1z = p2.z - p1.z, d1y = p2.y - p1.y, d2z = p4.z - p3.z, d2y = p4.y - p3.y;
    var den = d1z * d2y - d1y * d2z;
    var scale = Math.hypot(d1z, d1y) * Math.hypot(d2z, d2y);
    if (scale === 0 || Math.abs(den) <= 1e-12 * scale) return null;
    var t = ((p3.z - p1.z) * d2y - (p3.y - p1.y) * d2z) / den;
    return { z: p1.z + t * d1z, y: p1.y + t * d1y };
  }

  /** Height at which the line through a and b crosses the plane z (null if the line is vertical). */
  function yAtZ(a, b, z) {
    if (b.z === a.z) return null;
    return a.y + (b.y - a.y) * (z - a.z) / (b.z - a.z);
  }

  /** Slope after an ideal thin lens of focal length f, for a ray arriving with slope u at height y. */
  function refractSlope(u, y, f) { return u - y / f; }

  return {
    quantize: quantize, niceStep: niceStep, rulerStep: rulerStep, majorEvery: majorEvery, focalPoints: focalPoints,
    nearest1D: nearest1D, dist: dist, distToSegment: distToSegment,
    lineIntersection: lineIntersection, yAtZ: yAtZ, refractSlope: refractSlope
  };
});
