/* RayMan scene model: the optical elements and the rays on the bench, plus saving/loading
   and an undo history. No drawing, no DOM.

   Elements (all positions in mm, see geom.js):
     lens    { id, type: 'lens',   z, f, ap, label, planes }   thin ideal lens; ap = semi-aperture
     object  { id, type: 'object', z, h, label, color }        arrow from the axis at z up to height h
     point   { id, type: 'point',  z, y, label }               point source (a helper)
     mirror  { id, type: 'mirror', z, tilt, range, ap, label } scan mirror, drawn unfolded: rays
                                                               meeting it can leave tilted by `tilt`
                                                               degrees; Scan sweeps tilt ± range
     iris    { id, type: 'iris',   z, r, ap, label }           blades from ±r to ±ap: rays meeting a
                                                               blade stop there
     filament { id, type: 'filament', z, top, bottom, label, color }  a lamp filament: an extended
                                                               object reaching from height bottom to top,
                                                               either side of the axis
     axis    { id, type: 'axis',   y, label }                  an optical axis (always horizontal) at
                                                               height y. Every other element and every
                                                               ray belongs to one (`axis: id`), and its
                                                               positions are measured from that axis, so
                                                               moving an axis moves all that is on it.
                                                               A scene with no axes at all (as in the
                                                               tests) is one implicit axis at y = 0.
   color is a CSS colour, or null for the theme's default.

   Rays are hand-drawn polylines that remember why each point is where it is, so they can
   follow when the optics move. See rays.js for how they are solved:
     ray   { id, start, nodes: [node, ...], color, helper }   helper rays are dashed construction lines
     start { at: ref } (pinned to something) or { z, y } (a free point)
     node  { dir, end }: the segment leading to the node, and where it stops
       dir  { kind: 'free' | 'parallel' | 'straight' } | { kind: 'through', at: ref } | { kind: 'slope', u }
          | { kind: 'parallelTo', ray, seg }  parallel to segment `seg` of another ray
          | { kind: 'deflect', el }           leaving a scan mirror, tilted by its angle
       end  { kind: 'lens', el, y? } (on a lens or mirror plane) | { kind: 'z', z, y? }
          | { kind: 'at', at: ref } | { kind: 'edge', sgn }
     ref   { el, pt }  pt: 'tip' (object), 'src' (point source), 'C' | 'F' | 'Fp' (lens), 'P' (mirror pivot),
                       'C' | 'Et' | 'Eb' (iris centre, top and bottom edges of its opening),
                       'top' | 'bot' | 'mid' (the ends and the middle of a lamp filament)
         | { ray, k }  node k of another ray
         | { ray, seg, plane: { el, pt: 'F' | 'Fp' } }  where segment seg crosses a lens's focal plane
         | { img: { src, lens } }  the image of src formed by a lens (found from the rays); src is
                                   a ref, or { inf: key } for light from a point at infinity
   settings { follow: rays follow the optics, colour: colour-code principal rays,
              fill: number of faint fill-in rays drawn in each bundle (0 = none) } */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var m = factory(node ? require('./geom.js') : root.RM.geom);
  if (node) module.exports = m;
  else root.RM.scene = m;
})(typeof self !== 'undefined' ? self : this, function (G) {
  'use strict';

  var VERSION = 2;
  var DEFAULT_F = 50, DEFAULT_AP = 25, DEFAULT_H = 15, DEFAULT_TILT_RANGE = 5;

  function create() {
    return { version: VERSION, nextId: 1, elements: [], rays: [], settings: { follow: true, colour: false, fill: 0 } };
  }

  function newId(scene, prefix) { return (prefix || 'e') + (scene.nextId++); }

  /** The first unused label of the form prefix + n (n = 1, 2, ...) among elements of a type
      (on one optical axis, if axis is given: each axis numbers its own lenses from 1). */
  function nextLabel(scene, type, prefix, axis) {
    var used = {};
    scene.elements.forEach(function (e) { if (e.type === type && (axis == null || e.axis === axis)) used[e.label] = true; });
    for (var n = 1; ; n++) if (!used[prefix + n]) return prefix + n;
  }

  function addLens(scene, z, f, ap, axis) {
    var e = { id: newId(scene), type: 'lens', z: z, f: f || DEFAULT_F, ap: ap || DEFAULT_AP,
      label: nextLabel(scene, 'lens', 'L', axis), planes: false };
    if (axis != null) e.axis = axis;
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

  function addMirror(scene, z, axis) {
    var e = { id: newId(scene), type: 'mirror', z: z, tilt: 0, range: DEFAULT_TILT_RANGE, ap: 15,
      label: nextLabel(scene, 'mirror', 'M', axis) };
    if (axis != null) e.axis = axis;
    scene.elements.push(e);
    return e;
  }

  function addIris(scene, z, axis) {
    var e = { id: newId(scene), type: 'iris', z: z, r: 10, ap: 30, label: nextLabel(scene, 'iris', 'A', axis) };
    if (axis != null) e.axis = axis;
    scene.elements.push(e);
    return e;
  }

  function addFilament(scene, z) {
    var e = { id: newId(scene), type: 'filament', z: z, top: 8, bottom: -8, label: '', color: null };
    scene.elements.push(e);
    return e;
  }

  function addAxis(scene, y) {
    var n = scene.elements.filter(function (e) { return e.type === 'axis'; }).length;
    var e = { id: newId(scene), type: 'axis', y: y || 0, label: n ? 'axis ' + (n + 1) : '' };
    scene.elements.push(e);
    return e;
  }
  function axes(scene) {
    return scene.elements.filter(function (e) { return e.type === 'axis'; });
  }

  /** A live view of one optical axis: its elements and rays, in its own coordinates, without
      the axis elements themselves. Reading filters the scene; assigning `elements` or `rays`
      (as removing and freezing rays do) writes back into the scene. The optics code works on a
      view exactly as on a single-axis scene. Adding must go to the scene itself, with `axis`
      set (pushing onto a view's filtered array would be lost). */
  function axisView(scene, id) {
    function mine(x) { return x.type !== 'axis' && x.axis === id; }
    return {
      axis: id,
      get elements() { return scene.elements.filter(mine); },
      set elements(v) { scene.elements = scene.elements.filter(function (x) { return !mine(x); }).concat(v); },
      get rays() { return scene.rays.filter(function (r) { return r.axis === id; }); },
      set rays(v) { scene.rays = scene.rays.filter(function (r) { return r.axis !== id; }).concat(v); },
      get settings() { return scene.settings; },
      get nextId() { return scene.nextId; },
      set nextId(v) { scene.nextId = v; }
    };
  }

  /** Give a scene from before axes existed (or one with none) an axis at 0, and put every
      element and ray that is not on an existing axis onto the first one. Returns the scene. */
  function ensureAxis(scene) {
    var list = axes(scene);
    if (!list.length) list = [addAxis(scene, 0)];
    var ids = {};
    list.forEach(function (a) { ids[a.id] = true; });
    scene.elements.forEach(function (e) { if (e.type !== 'axis' && !ids[e.axis]) e.axis = list[0].id; });
    scene.rays.forEach(function (r) { if (!ids[r.axis]) r.axis = list[0].id; });
    return scene;
  }

  function addRay(scene, start, helper) {
    var r = { id: newId(scene, 'r'), start: start, nodes: [], color: null, helper: !!helper };
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
    if (!scene.elements.some(function (e) { return e.type !== 'axis'; })) return null;
    var z0 = Infinity, z1 = -Infinity, ym = 10;
    scene.elements.forEach(function (e) {
      if (e.type === 'axis') return;
      var zs = [e.z], yy = 0;
      if (e.type === 'lens') { var fp = G.focalPoints(e); zs.push(fp.F, fp.Fp); yy = e.ap; }
      else if (e.type === 'object') yy = Math.abs(e.h);
      else if (e.type === 'point') yy = Math.abs(e.y);
      else if (e.type === 'mirror' || e.type === 'iris') yy = e.ap;
      else if (e.type === 'filament') yy = Math.max(Math.abs(e.top), Math.abs(e.bottom));
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

  var PTS = { tip: 1, src: 1, C: 1, F: 1, Fp: 1, P: 1, Et: 1, Eb: 1, top: 1, bot: 1, mid: 1 };
  function index(n) { return Number.isInteger(n) && n >= 0; }
  function checkRef(r, depth) {
    depth = depth || 0;
    if (!r || typeof r !== 'object' || depth > 50) return false;
    if (r.img) {
      var src = r.img.src;
      return typeof r.img.lens === 'string' && (!!src && typeof src.inf === 'string' || checkRef(src, depth + 1));
    }
    if (typeof r.ray === 'string') {
      if (r.plane) return index(r.seg) && typeof r.plane.el === 'string' && (r.plane.pt === 'F' || r.plane.pt === 'Fp');
      return index(r.k);
    }
    return typeof r.el === 'string' && PTS[r.pt] === 1;
  }
  function checkNode(n) {
    var d = n && n.dir, e = n && n.end;
    if (!d || !e) return false;
    var dirOk = d.kind === 'free' || d.kind === 'parallel' || d.kind === 'straight' ||
      (d.kind === 'through' && checkRef(d.at)) || (d.kind === 'slope' && finite(d.u)) ||
      (d.kind === 'parallelTo' && typeof d.ray === 'string' && index(d.seg)) ||
      (d.kind === 'deflect' && typeof d.el === 'string');
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
      var out;
      if (e.type === 'axis') {
        if (!finite(e.y)) throw new Error(where + 'bad axis height.');
        out = { id: e.id, type: 'axis', y: e.y, label: String(e.label || '') };
      } else if (!finite(e.z)) throw new Error(where + 'bad position.');
      else if (e.type === 'lens') {
        if (!finite(e.f) || e.f === 0) throw new Error(where + 'focal length must be a non-zero number.');
        if (!finite(e.ap) || e.ap <= 0) throw new Error(where + 'aperture must be positive.');
        out = { id: e.id, type: 'lens', z: e.z, f: e.f, ap: e.ap, label: String(e.label || ''), planes: !!e.planes };
      } else if (e.type === 'object') {
        if (!finite(e.h)) throw new Error(where + 'bad height.');
        out = { id: e.id, type: 'object', z: e.z, h: e.h, label: String(e.label || ''), color: color(e.color) };
      } else if (e.type === 'point') {
        if (!finite(e.y)) throw new Error(where + 'bad height.');
        out = { id: e.id, type: 'point', z: e.z, y: e.y, label: String(e.label || '') };
      } else if (e.type === 'mirror') {
        if (!finite(e.tilt) || !finite(e.range)) throw new Error(where + 'bad mirror angle.');
        if (!finite(e.ap) || e.ap <= 0) throw new Error(where + 'mirror size must be positive.');
        out = { id: e.id, type: 'mirror', z: e.z, tilt: e.tilt, range: e.range, ap: e.ap, label: String(e.label || '') };
      } else if (e.type === 'filament') {
        if (!finite(e.top) || !finite(e.bottom) || e.top <= e.bottom) throw new Error(where + 'bad filament ends.');
        out = { id: e.id, type: 'filament', z: e.z, top: e.top, bottom: e.bottom, label: String(e.label || ''), color: color(e.color) };
      } else if (e.type === 'iris') {
        if (!finite(e.r) || e.r < 0 || !finite(e.ap) || e.ap <= 0) throw new Error(where + 'bad iris size.');
        out = { id: e.id, type: 'iris', z: e.z, r: e.r, ap: e.ap, label: String(e.label || '') };
      } else throw new Error(where + 'unknown type "' + e.type + '".');
      if (e.type !== 'axis' && typeof e.axis === 'string') out.axis = e.axis;
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
      var start = st.at ? { at: st.at } : { z: st.z, y: st.y };
      if (!st.at && checkRef(st.from)) start.from = st.from;
      s.rays.push({ id: r.id, start: JSON.parse(JSON.stringify(start)),
        nodes: JSON.parse(JSON.stringify(r.nodes)), color: color(r.color), helper: !!r.helper });
      if (typeof r.axis === 'string') s.rays[s.rays.length - 1].axis = r.axis;
    });
    s.nextId = Math.max(maxId + 1, finite(d.nextId) ? d.nextId : 1);
    if (d.settings) {
      if (typeof d.settings.follow === 'boolean') s.settings.follow = d.settings.follow;
      if (typeof d.settings.colour === 'boolean') s.settings.colour = d.settings.colour;
      if (finite(d.settings.fill)) s.settings.fill = Math.max(0, Math.min(50, Math.round(d.settings.fill)));
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
    create: create, addLens: addLens, addObject: addObject, addPoint: addPoint, addMirror: addMirror, addIris: addIris, addFilament: addFilament, addRay: addRay,
    addAxis: addAxis, axes: axes, axisView: axisView, ensureAxis: ensureAxis,
    find: find, isRay: isRay, remove: remove, lenses: lenses, bounds: bounds,
    toJSON: toJSON, fromJSON: fromJSON, History: History
  };
});
