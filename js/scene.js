/* RayMan scene model: the optical elements and the rays on the bench, plus saving/loading
   and an undo history. No drawing, no DOM.

   Elements (all positions in mm, see geom.js):
     lens    { id, type: 'lens',   z, f, ap, label, planes }   thin ideal lens; ap = semi-aperture
     object  { id, type: 'object', z, h, label, color }        arrow from the axis at z up to height h
     point   { id, type: 'point',  z, y, label }               point source (a helper)
   color is a CSS colour, or null for the theme's default.

   Rays are hand-drawn polylines that remember why each point is where it is, so they can
   follow when the optics move. See rays.js for how they are solved:
     ray   { id, start, nodes: [node, ...], color }
     start { at: ref } (pinned to something) or { z, y } (a free point)
     node  { dir, end }: the segment leading to the node, and where it stops
       dir  { kind: 'free' | 'parallel' | 'straight' } | { kind: 'through', at: ref } | { kind: 'slope', u }
       end  { kind: 'lens', el, y? } | { kind: 'z', z, y? } | { kind: 'at', at: ref } | { kind: 'edge', sgn }
     ref   { el, pt }  pt: 'tip' (object), 'src' (point source), 'C' | 'F' | 'Fp' (lens)
         | { ray, k }  node k of another ray */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var m = factory(node ? require('./geom.js') : root.RM.geom);
  if (node) module.exports = m;
  else root.RM.scene = m;
})(typeof self !== 'undefined' ? self : this, function (G) {
  'use strict';

  var VERSION = 2;
  var DEFAULT_F = 50, DEFAULT_AP = 25, DEFAULT_H = 15;

  function create() {
    return { version: VERSION, nextId: 1, elements: [], rays: [], settings: { follow: true, colour: false } };
  }

  function newId(scene, prefix) { return (prefix || 'e') + (scene.nextId++); }

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
    var e = { id: newId(scene), type: 'object', z: z, h: h || DEFAULT_H, label: '', color: null };
    scene.elements.push(e);
    return e;
  }

  function addPoint(scene, z, y) {
    var e = { id: newId(scene), type: 'point', z: z, y: y || 0, label: '' };
    scene.elements.push(e);
    return e;
  }

  function addRay(scene, start) {
    var r = { id: newId(scene, 'r'), start: start, nodes: [], color: null };
    scene.rays.push(r);
    return r;
  }

  function find(scene, id) {
    for (var i = 0; i < scene.elements.length; i++) if (scene.elements[i].id === id) return scene.elements[i];
    for (i = 0; i < scene.rays.length; i++) if (scene.rays[i].id === id) return scene.rays[i];
    return null;
  }
  function isRay(x) { return !!x && Array.isArray(x.nodes); }

  /** Remove an element or a ray by id. (Bake rays that depend on it first: rays.js.) */
  function remove(scene, id) {
    var n = scene.elements.length + scene.rays.length;
    scene.elements = scene.elements.filter(function (e) { return e.id !== id; });
    scene.rays = scene.rays.filter(function (r) { return r.id !== id; });
    return scene.elements.length + scene.rays.length !== n;
  }

  function lenses(scene) {
    return scene.elements.filter(function (e) { return e.type === 'lens'; })
      .sort(function (a, b) { return a.z - b.z; });
  }

  /** World box { z0, z1, y0, y1 } around the elements, or null for an empty bench. */
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
  function optFinite(x) { return x == null || finite(x); }
  function color(c) { return typeof c === 'string' && c.length < 40 ? c : null; }

  var PTS = { tip: 1, src: 1, C: 1, F: 1, Fp: 1 };
  function checkRef(r) {
    if (!r || typeof r !== 'object') return false;
    if (typeof r.ray === 'string') return Number.isInteger(r.k) && r.k >= 0;
    return typeof r.el === 'string' && PTS[r.pt] === 1;
  }
  function checkNode(n) {
    var d = n && n.dir, e = n && n.end;
    if (!d || !e) return false;
    var dirOk = d.kind === 'free' || d.kind === 'parallel' || d.kind === 'straight' ||
      (d.kind === 'through' && checkRef(d.at)) || (d.kind === 'slope' && finite(d.u));
    var endOk = (e.kind === 'lens' && typeof e.el === 'string' && optFinite(e.y)) ||
      (e.kind === 'z' && finite(e.z) && optFinite(e.y)) || (e.kind === 'at' && checkRef(e.at)) ||
      (e.kind === 'edge' && (e.sgn === 1 || e.sgn === -1));
    return dirOk && endOk;
  }

  function idNumber(id) { var n = parseInt(String(id).replace(/^\D+/, ''), 10); return isFinite(n) ? n : 0; }

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
        out = { id: e.id, type: 'object', z: e.z, h: e.h, label: String(e.label || ''), color: color(e.color) };
      } else if (e.type === 'point') {
        if (!finite(e.y)) throw new Error(where + 'bad height.');
        out = { id: e.id, type: 'point', z: e.z, y: e.y, label: String(e.label || '') };
      } else throw new Error(where + 'unknown type "' + e.type + '".');
      seen[e.id] = true;
      maxId = Math.max(maxId, idNumber(e.id));
      s.elements.push(out);
    });
    (Array.isArray(d.rays) ? d.rays : []).forEach(function (r, i) {
      var where = 'Ray ' + (i + 1) + ': ';
      if (!r || typeof r.id !== 'string' || seen[r.id]) throw new Error(where + 'missing or repeated id.');
      var st = r.start;
      if (!st || !(checkRef(st.at) || (finite(st.z) && finite(st.y)))) throw new Error(where + 'bad start.');
      if (!Array.isArray(r.nodes) || !r.nodes.every(checkNode)) throw new Error(where + 'bad segment.');
      seen[r.id] = true;
      maxId = Math.max(maxId, idNumber(r.id));
      s.rays.push({ id: r.id, start: JSON.parse(JSON.stringify(st.at ? { at: st.at } : { z: st.z, y: st.y })),
        nodes: JSON.parse(JSON.stringify(r.nodes)), color: color(r.color) });
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
  function History(limit) { this.limit = limit || 300; this.stack = []; this.i = -1; }
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
    VERSION: VERSION, DEFAULT_F: DEFAULT_F, DEFAULT_AP: DEFAULT_AP, DEFAULT_H: DEFAULT_H,
    create: create, addLens: addLens, addObject: addObject, addPoint: addPoint, addRay: addRay,
    find: find, isRay: isRay, remove: remove, lenses: lenses, bounds: bounds,
    toJSON: toJSON, fromJSON: fromJSON, History: History
  };
});
