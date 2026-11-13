/* RayMan view: world (mm, y up) <-> screen (CSS px, y down), with pan and zoom. */
(function (root, factory) {
  var m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else { root.RM = root.RM || {}; root.RM.View = m; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MIN_S = 0.2, MAX_S = 80;

  /** s = pixels per mm; (ox, oy) = screen position of the world origin. */
  function View() { this.s = 3; this.ox = 300; this.oy = 300; }

  View.prototype.X = function (z) { return this.ox + this.s * z; };
  View.prototype.Y = function (y) { return this.oy - this.s * y; };
  View.prototype.z = function (px) { return (px - this.ox) / this.s; };
  View.prototype.y = function (py) { return (this.oy - py) / this.s; };

  View.prototype.pan = function (dx, dy) { this.ox += dx; this.oy += dy; };

  /** Zoom by factor k keeping the world point under screen (px, py) fixed. */
  View.prototype.zoomAt = function (px, py, k) {
    var z = this.z(px), y = this.y(py);
    this.s = Math.min(MAX_S, Math.max(MIN_S, this.s * k));
    this.ox = px - this.s * z;
    this.oy = py + this.s * y;
  };

  /** Fit the world box b = { z0, z1, y0, y1 } into a w x h screen with a margin, axis level. */
  View.prototype.fit = function (b, w, h, margin) {
    margin = margin == null ? 80 : margin;
    var dz = Math.max(b.z1 - b.z0, 20), dy = Math.max(b.y1 - b.y0, 20);
    this.s = Math.min(MAX_S, Math.max(MIN_S,
      Math.min((w - 2 * margin) / dz, (h - 2 * margin) / dy)));
    this.ox = w / 2 - this.s * (b.z0 + b.z1) / 2;
    this.oy = h / 2 + this.s * (b.y0 + b.y1) / 2;
  };

  return View;
});
