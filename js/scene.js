/* RayMan scene model: the optical elements (and, from Phase 2, the rays) on the bench,
   plus saving/loading and an undo history. No drawing, no DOM.

   Elements (all positions in mm, see geom.js):
     lens    { id, type: 'lens',   z, f, ap, label, planes }   thin ideal lens; ap = semi-aperture
     object  { id, type: 'object', z, h, label }               arrow from the axis at z up to height h
     point   { id, type: 'point',  z, y, label }               point source (a helper) */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var m = factory(node ? require('./geom.js') : root.RM.geom);
  if (node) module.exports = m;
  else root.RM.scene = m;
})(typeof self !== 'undefined' ? self : this, function (G) {
  'use strict';

  var VERSION = 1;
  var DEFAULT_F = 50, DEFAULT_AP = 25, DEFAULT_H = 15;

  function create() {
    return { version: VERSION, nextId: 1, elements: [], rays: [], settings: { follow: true, colour: false } };
  }

  function newId(scene) { return 'e' + (scene.nextId++); }

  /** The first unused label of the form prefix + n (n = 1, 2, ...) among elements of a type. */
  function nextLabel(scene, type, prefix) {
    var used = {};
    scene.elements.forEach(function (e) { if (e.type === type) used[e.label] = true; });
    for (var n = 1; ; n++) if (!used[prefix + n]) return prefix + n;
  }

  function addLens(scene, z, f, ap) {
    var e = { id: newId(scene), type: 'lens', z: z, f: f || DEFAULT_F, ap: ap || DEFAULT_AP,
      label: nextLabel(scene, 'lens', 'L'), planes: false };
    scene.elements.push(e);
    return e;
  }

  function addObject(scene, z, h) {
    var e = { id: newId(scene), type: 'object', z: z, h: h || DEFAULT_H, label: '' };
    scene.elements.push(e);
    return e;
  }

  function addPoint(scene, z, y) {
    var e = { id: newId(scene), type: 'point', z: z, y: y || 0, label: '' };
    scene.elements.push(e);
    return e;
  }

  function find(scene, id) {
    for (var i = 0; i < scene.elements.length; i++) if (scene.elements[i].id === id) return scene.elements[i];
    return null;
  }

  function remove(scene, id) {
    var n = scene.elements.length;
    scene.elements = scene.elements.filter(function (e) { return e.id !== id; });
    return scene.elements.length !== n;
  }

  function lenses(scene) {
    return scene.elements.filter(function (e) { return e.type === 'lens'; })
      .sort(function (a, b) { return a.z - b.z; });
  }

  /** World box { z0, z1, y0, y1 } around everything worth seeing, or null for an empty bench. */
  function bounds(scene) {
    if (!scene.elements.length) return null;
    var z0 = Infinity, z1 = -Infinity, ym = 10;
    scene.elements.forEach(function (e) {
      var zs = [e.z], yy = 0;
      if (e.type === 'lens') { var fp = G.focalPoints(e); zs.push(fp.F, fp.Fp); yy = e.ap; }
      else if (e.type === 'object') yy = Math.abs(e.h);
      else if (e.type === 'point') yy = Math.abs(e.y);
      zs.forEach(function (z) { z0 = Math.min(z0, z); z1 = Math.max(z1, z); });
      ym = Math.max(ym, yy);
    });
    return { z0: z0, z1: z1, y0: -ym, y1: ym };
  }

  // ---------------------------------------------------------------- save / load

  function toJSON(scene) { return JSON.stringify(scene); }

  function finite(x) { return typeof x === 'number' && isFinite(x); }

  /** Parse and check a saved scene. Throws an Error saying what is wrong. */
  function fromJSON(text) {
    var d;
    try { d = JSON.parse(text); } catch (err) { throw new Error('Not a RayMan scene file (not valid JSON).'); }
    if (!d || typeof d !== 'object' || !Array.isArray(d.elements)) throw new Error('Not a RayMan scene file.');
    if (d.version > VERSION) throw new Error('This scene was saved by a newer version of RayMan.');
    var s = create(), maxId = 0, seen = {};
    d.elements.forEach(function (e, i) {
      var where = 'Element ' + (i + 1) + ': ';
      if (!e || typeof e.id !== 'string' || seen[e.id]) throw new Error(where + 'missing or repeated id.');
      if (!finite(e.z)) throw new Error(where + 'bad position.');
      var out;
      if (e.type === 'lens') {
        if (!finite(e.f) || e.f === 0) throw new Error(where + 'focal length must be a non-zero number.');
        if (!finite(e.ap) || e.ap <= 0) throw new Error(where + 'aperture must be positive.');
        out = { id: e.id, type: 'lens', z: e.z, f: e.f, ap: e.ap, label: String(e.label || ''), planes: !!e.planes };
      } else if (e.type === 'object') {
        if (!finite(e.h)) throw new Error(where + 'bad height.');
        out = { id: e.id, type: 'object', z: e.z, h: e.h, label: String(e.label || '') };
      } else if (e.type === 'point') {
        if (!finite(e.y)) throw new Error(where + 'bad height.');
        out = { id: e.id, type: 'point', z: e.z, y: e.y, label: String(e.label || '') };
      } else throw new Error(where + 'unknown type "' + e.type + '".');
      seen[e.id] = true;
      var n = parseInt(e.id.replace(/^\D+/, ''), 10);
      if (n > maxId) maxId = n;
      s.elements.push(out);
    });
    s.nextId = Math.max(maxId + 1, finite(d.nextId) ? d.nextId : 1);
    if (d.settings) {
      if (typeof d.settings.follow === 'boolean') s.settings.follow = d.settings.follow;
      if (typeof d.settings.colour === 'boolean') s.settings.colour = d.settings.colour;
    }
    return s;
  }

  // ---------------------------------------------------------------- undo history

  /** Undo/redo over whole-scene snapshots (JSON strings): scenes are small. */
  function History(limit) { this.limit = limit || 200; this.stack = []; this.i = -1; }
  /** Record a snapshot; returns false if nothing changed since the last one. */
  History.prototype.push = function (snap) {
    if (this.i >= 0 && this.stack[this.i] === snap) return false;
    this.stack.length = this.i + 1;
    this.stack.push(snap);
    if (this.stack.length > this.limit) this.stack.shift();
    this.i = this.stack.length - 1;
    return true;
  };
  History.prototype.canUndo = function () { return this.i > 0; };
  History.prototype.canRedo = function () { return this.i < this.stack.length - 1; };
  History.prototype.undo = function () { return this.canUndo() ? this.stack[--this.i] : null; };
  History.prototype.redo = function () { return this.canRedo() ? this.stack[++this.i] : null; };
  History.prototype.current = function () { return this.stack[this.i]; };

  return {
    VERSION: VERSION, DEFAULT_F: DEFAULT_F, DEFAULT_AP: DEFAULT_AP, DEFAULT_H: DEFAULT_H, create: create, addLens: addLens, addObject: addObject,
    addPoint: addPoint, find: find, remove: remove, lenses: lenses, bounds: bounds,
    toJSON: toJSON, fromJSON: fromJSON, History: History
  };
});
