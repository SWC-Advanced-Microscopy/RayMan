/* RayMan scene model: the optical elements and the rays on the bench, plus saving/loading
   and an undo history. No drawing, no DOM.

   Elements (all positions in mm, see geom.js):
     lens    { id, type: 'lens',   z, f, ap, label, planes }   thin ideal lens; ap = semi-aperture
     object  { id, type: 'object', z, h, label, color }        arrow from the axis at z up to height h
     point   { id, type: 'point',  z, y, label }               point source (a helper)
     mirror  { id, type: 'mirror', z, tilt, range, ap, label, flip } scan mirror, drawn unfolded:
                                                               light from either side passes through
                                                               it, turned by `tilt` degrees (light
                                                               coming back along a ray retraces it:
                                                               de-scanning); Scan sweeps tilt ± range;
                                                               flip: drawn hatched on the right
     iris    { id, type: 'iris',   z, r, ap, label, mask }     blades from ±r to ±ap: rays meeting a
                                                               blade stop there; mask: the rays it
                                                               stops are drawn faint all along (#14)
     plane   { id, type: 'plane',  z, ap, label, color }     an image plane marker (sample, camera):
                                                               rays pass through it and can end on it
     dichroic { id, type: 'dichroic', z, ap, label, stop }    a dichroic mirror, drawn unfolded as a tilted
                                                               plate: light passes, except light of the
                                                               colour `stop` (if set), which ends there
     filament { id, type: 'filament', z, top, bottom, label, color }  a lamp filament: an extended
                                                               object reaching from height bottom to top,
                                                               either side of the axis
     beam    { id, type: 'beam', z, y, width, angle, label, color, dir }  a collimated beam: three
                                                               rays leave it (top, middle, bottom: refs
                                                               'top', 'mid', 'bot'), at `angle` degrees
                                                               above the way it runs, from a source of
                                                               `width` centred at height y; dir -1: it
                                                               runs right to left (the mirror image)
   Light sources (object, point, beam, filament) can be switched off: { hidden: true }. Their
   rays (and rays that depend on those) then carry { off: sourceId } and are left out of the
   axis view, so nothing sees them until the source is switched on again. An axis with
   { hideHelpers: true } leaves its helper rays out of its view. The view's `all` still has
   them, so rays drawn through or parallel to them are solved as before (rays.js looks up by id
   there).
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
     ray   { id, start, nodes: [node, ...], color, helper, label }   helper rays are dashed construction
                                                     lines; label: an optional name (r1, h2) drawn by it
     start { at: ref } (pinned to something) or { z, y } (a free point)
     node  { dir, end }: the segment leading to the node, and where it stops
       dir  { kind: 'free' | 'parallel' | 'straight' } | { kind: 'through', at: ref } | { kind: 'slope', u }
          | { kind: 'parallelTo', ray, seg }  parallel to segment `seg` of another ray
          | { kind: 'deflect', el, sgn? }     leaving a scan mirror, tilted by its angle (sgn: the way
                                              the light runs, for a ray starting at the pivot)
          | { kind: 'beam', el }              at a collimated beam's angle
          | { kind: 'refract', el }           bent by lens el as an ideal thin lens would bend it
       end  { kind: 'lens', el, y? } (on a lens or mirror plane) | { kind: 'z', z, y? }
          | { kind: 'at', at: ref } | { kind: 'edge', sgn }
          | { kind: 'next', sgn? }  at the first lens or mirror ahead, whichever that is now (else
                                    the edge); sgn -1: ahead is to the left
          | { kind: 'plane', el, pt: 'F' | 'Fp' }  on a lens's front or back focal plane
     ref   { el, pt }  pt: 'tip' (object), 'src' (point source), 'C' | 'F' | 'Fp' (lens), 'P' (mirror pivot),
                       'C' | 'Et' | 'Eb' (iris centre, top and bottom edges of its opening),
                       'top' | 'bot' | 'mid' (the ends and the middle of a lamp filament)
         | { ray, k }  node k of another ray
         | { ray, seg, plane: { el, pt: 'F' | 'Fp' } }  where segment seg crosses a lens's focal plane
         | { img: { src, lens } }  the image of src formed by a lens (found from the rays); src is
                                   a ref, or { inf: key } for light from a point at infinity
   settings { follow: rays follow the optics, virtual: show virtual images, colour: colour-code principal rays,
              fill: number of faint fill-in rays drawn in each bundle (0 = none),
              rims: lens and mirror rims stop light that misses them } */
/* Short names used in this file:
     z, y     position along the axis and height above it, in mm; f: focal length; ap: aperture
     e        an element; el: an element or its id in a reference; r: a ray; pt: a point name ('top', 'bot', 'mid')
     h        an object's height; x: any element or ray; n: a number; i: an index; v: a value
     st       a saved state (a JSON snapshot) in the history */

(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var m = factory(node ? require('./geom.js') : root.RM.geom);
  if (node) module.exports = m;
  else root.RM.scene = m;
})(typeof self !== 'undefined' ? self : this, function (G) {
  'use strict';

  var VERSION = 2;
  var DEFAULT_F = 50, DEFAULT_AP = 25, DEFAULT_H = 15, DEFAULT_TILT_RANGE = 5;

  /** A new empty scene. */
  function create() {
    return { version: VERSION, nextId: 1, elements: [], rays: [], settings: { follow: true, colour: false, fill: 0, virtual: false, rims: false } };
  }

  /** A fresh unique id such as "e12", numbering from scene.nextId. */
  function newId(scene, prefix) { return (prefix || 'e') + (scene.nextId++); }

  /** The first unused label of the form prefix + n (n = 1, 2, ...) among elements of a type
      (on one optical axis, if axis is given: each axis numbers its own lenses from 1). */
  function nextLabel(scene, type, prefix, axis) {
    var used = {};
    scene.elements.forEach(function (e) { if (e.type === type && (axis == null || e.axis === axis)) used[e.label] = true; });
    for (var n = 1; ; n++) if (!used[prefix + n]) return prefix + n;
  }

  /** Add a thin lens of focal length f and half-height ap at z on the given axis. */
  function addLens(scene, z, f, ap, axis) {
    var e = { id: newId(scene), type: 'lens', z: z, f: f || DEFAULT_F, ap: ap || DEFAULT_AP,
      label: nextLabel(scene, 'lens', 'L', axis), planes: false };
    if (axis != null) e.axis = axis;
    scene.elements.push(e);
    return e;
  }

  /** Add an object (an arrow) of height h at z. */
  function addObject(scene, z, h) {
    var e = { id: newId(scene), type: 'object', z: z, h: h || DEFAULT_H, label: '', color: null };
    scene.elements.push(e);
    return e;
  }

  /** Add a point source at (z, y). */
  function addPoint(scene, z, y) {
    var e = { id: newId(scene), type: 'point', z: z, y: y || 0, label: '', color: null };
    scene.elements.push(e);
    return e;
  }

  /** Add a scan mirror at z on the given axis. */
  function addMirror(scene, z, axis) {
    var e = { id: newId(scene), type: 'mirror', z: z, tilt: 0, range: DEFAULT_TILT_RANGE, ap: 15,
      label: nextLabel(scene, 'mirror', 'M', axis) };
    if (axis != null) e.axis = axis;
    scene.elements.push(e);
    return e;
  }

  /** A dichroic, at z. It stops no colour until one is chosen. */
  function addDichroic(scene, z, axis) {
    var e = { id: newId(scene), type: 'dichroic', z: z, ap: 20, label: 'dichroic', stop: null };
    if (axis != null) e.axis = axis;
    scene.elements.push(e);
    return e;
  }

  /** An image plane marker. The first on an axis is called "sample", the next "camera". */
  function addPlane(scene, z, axis) {
    var used = {};
    scene.elements.forEach(function (e) { if (e.type === 'plane' && (axis == null || e.axis === axis)) used[e.label] = true; });
    var e = { id: newId(scene), type: 'plane', z: z, ap: 25,
      label: !used.sample ? 'sample' : !used.camera ? 'camera' : nextLabel(scene, 'plane', 'plane ', axis) };
    if (axis != null) e.axis = axis;
    scene.elements.push(e);
    return e;
  }

  /** Add an iris at z on the given axis. */
  function addIris(scene, z, axis) {
    var e = { id: newId(scene), type: 'iris', z: z, r: 10, ap: 30, label: nextLabel(scene, 'iris', 'A', axis) };
    if (axis != null) e.axis = axis;
    scene.elements.push(e);
    return e;
  }

  /** Add a lamp filament at z. */
  function addFilament(scene, z) {
    var e = { id: newId(scene), type: 'filament', z: z, top: 8, bottom: -8, label: '', color: null };
    scene.elements.push(e);
    return e;
  }

  /** Add an optical axis at height y. */
  function addAxis(scene, y) {
    var n = scene.elements.filter(function (e) { return e.type === 'axis'; }).length;
    var e = { id: newId(scene), type: 'axis', y: y || 0, label: n ? 'axis ' + (n + 1) : '' };
    scene.elements.push(e);
    return e;
  }

  /** All the optical axes in the scene. */
  function axes(scene) {
    return scene.elements.filter(function (e) { return e.type === 'axis'; });
  }

  /** A live view of one optical axis: its elements and rays, in its own coordinates, without
      the axis elements themselves. Reading filters the scene; assigning `elements` or `rays`
      (as removing and freezing rays do) writes back into the scene. The optics code works on a
      view exactly as on a single-axis scene. Adding must go to the scene itself, with `axis`
      set (pushing onto a view's filtered array would be lost). */
  function axisView(scene, id) {
    /** True if x belongs to this axis (an element, not the axis itself). */
    function mine(x) { return x.type !== 'axis' && x.axis === id; }
    /** True if x belongs to this axis and is visible. */
    function shown(x) { return mine(x) && !x.hidden; }
    /** True if this axis has its helper rays hidden. */
    function helpersOff() { var a = find(scene, id); return !!(a && a.hideHelpers); }
    /** True if ray r belongs to this axis, is on, and is not a hidden helper. */
    function rayShown(r, off) { return r.axis === id && !r.off && !(off && r.helper); }
    // switched-off sources and their rays are not in the view; setting a list keeps them
    return {
      axis: id,
      get elements() { return scene.elements.filter(shown); },
      set elements(v) { scene.elements = scene.elements.filter(function (x) { return !shown(x); }).concat(v); },
      get rays() { var off = helpersOff(); return scene.rays.filter(function (r) { return rayShown(r, off); }); },
      set rays(v) { var off = helpersOff(); scene.rays = scene.rays.filter(function (r) { return !rayShown(r, off); }).concat(v); },
      get all() { return { elements: scene.elements.filter(mine), rays: scene.rays.filter(function (r) { return r.axis === id; }) }; },
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

  /** A collimated beam and its three rays (top, middle, bottom), each running at the beam's
      angle to the first lens or mirror ahead. axis: the optical axis it goes on, if any. */
  function addBeam(scene, z, y, axis, dir) {
    var e = { id: newId(scene), type: 'beam', z: z, y: y || 0, width: 20, angle: 0, label: '', color: null, dir: dir === -1 ? -1 : 1 };
    if (axis != null) e.axis = axis;
    scene.elements.push(e);
    ['top', 'mid', 'bot'].forEach(function (pt) {
      var r = addRay(scene, { at: { el: e.id, pt: pt } });
      if (axis != null) r.axis = axis;
      r.nodes.push({ dir: { kind: 'beam', el: e.id }, end: beamEnd(e) });
    });
    return e;
  }

  /** Where a beam's own rays first run to: the next lens or mirror, the way the beam points. */
  function beamEnd(e) { return e.dir === -1 ? { kind: 'next', sgn: -1 } : { kind: 'next' }; }

  /** Put a copy of element `from` (any kind but an axis) at z on axis `axis`. It keeps every
      property; a numbered label (L1, M1, A1) becomes the next free one on that axis; a copied
      beam gets its own three rays. Returns the new element. */
  /** Kinds copied together with the rays they own (rays started from them, or branched off
      those). Beams make their own rays when copied, so are not listed. Add kinds to extend. */
  var GROUP_COPY = { point: true };

  /** Copy the rays owned by element `from` onto `to` (a copy of it), moved with it by (dz, dy).
      Points pinned to the original or to rays of the group are re-pinned to the copies; free
      points move along. Pins to other things (lenses…) are kept. */
  function copyOwnedRays(scene, from, to, dz, dy) {
    var map = {}, group = [];
    var changed = true;
    while (changed) {                                   // the rays from it, then rays branching off those
      changed = false;
      scene.rays.forEach(function (r) {
        var pin = r.start.at;
        if (map[r.id] || !pin) return;
        if (pin.el === from.id || (pin.ray != null && map[pin.ray])) {
          map[r.id] = newId(scene, 'r');
          group.push(r);
          changed = true;
        }
      });
    }
    /** Copy a reference, pointing it at the copy of an element or ray instead of the original. */
    function re(ref) {
      if (!ref) return ref;
      if (ref.img) return { img: { src: re(ref.img.src), lens: ref.img.lens } };   // the image of the copy, not of the original
      if (ref.el === from.id) return { el: to.id, pt: ref.pt };
      if (ref.ray != null && map[ref.ray]) {
        var c = JSON.parse(JSON.stringify(ref));
        c.ray = map[ref.ray];
        return c;
      }
      return ref;
    }
    group.forEach(function (r) {
      var c = JSON.parse(JSON.stringify(r));
      c.id = map[r.id]; c.axis = to.axis; c.color = null;
      c.start = c.start.at ? { at: re(c.start.at) } : { z: c.start.z + dz, y: c.start.y + dy };
      c.nodes.forEach(function (n) {
        if (n.dir.at) n.dir.at = re(n.dir.at);
        if (n.dir.kind === 'parallelTo' && map[n.dir.ray]) n.dir.ray = map[n.dir.ray];
        if (n.end.at) n.end.at = re(n.end.at);
        if (n.end.kind === 'z') {
          n.end.z += dz;
          if (n.end.y != null) n.end.y += dy;
        }
        delete n.auto;
      });
      scene.rays.push(c);
    });
  }

  /** Copy element from onto the given axis at (z, y), including its settings, with a new id and label. */
  function copyElement(scene, from, axis, z, y) {
    var prefix = { lens: 'L', mirror: 'M', iris: 'A' }[from.type], e;
    if (from.type === 'beam') {
      e = addBeam(scene, z, y != null ? y : from.y, axis, from.dir);
      e.width = from.width; e.angle = from.angle; e.color = from.color; e.label = from.label;
      return e;
    }
    // `from` may be a snapshot taken when copying, which says where it was copied from
    var orig = from.copyOf ? find(scene, from.copyOf.id) : from.id ? from : null;
    var o0 = from.copyOf || from;
    e = JSON.parse(JSON.stringify(from));
    delete e.copyOf;
    e.id = newId(scene); e.z = z;
    if (y != null) e.y = y;
    if (axis != null) e.axis = axis; else delete e.axis;
    if (prefix && new RegExp('^' + prefix + '\\d+$').test(e.label)) e.label = nextLabel(scene, from.type, prefix, axis);
    scene.elements.push(e);
    if (GROUP_COPY[from.type] && orig) copyOwnedRays(scene, orig, e, z - o0.z, (y != null && o0.y != null) ? y - o0.y : 0);
    return e;
  }

  /** Add a ray starting at start; helper marks it as a helper ray. */
  function addRay(scene, start, helper) {
    var r = { id: newId(scene, 'r'), start: start, nodes: [], color: null, helper: !!helper };
    scene.rays.push(r);
    return r;
  }

  /** Find an element or ray by id; null if none. */
  function find(scene, id) {
    for (var i = 0; i < scene.elements.length; i++) if (scene.elements[i].id === id) return scene.elements[i];
    for (i = 0; i < scene.rays.length; i++) if (scene.rays[i].id === id) return scene.rays[i];
    return null;
  }

  /** True if x is a ray. */
  function isRay(x) { return !!x && Array.isArray(x.nodes); }

  /** Remove an element or a ray by id. (Bake rays that depend on it first: rays.js.) */
  function remove(scene, id) {
    var n = scene.elements.length + scene.rays.length;
    scene.elements = scene.elements.filter(function (e) { return e.id !== id; });
    scene.rays = scene.rays.filter(function (r) { return r.id !== id; });
    return scene.elements.length + scene.rays.length !== n;
  }

  /** All the lenses, ordered left to right. */
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
      if (e.type === 'lens') {
        var fp = G.focalPoints(e);
        zs.push(fp.F, fp.Fp);
        yy = e.ap;
      }
      else if (e.type === 'object') yy = Math.abs(e.h);
      else if (e.type === 'point') yy = Math.abs(e.y);
      else if (e.type === 'mirror' || e.type === 'iris' || e.type === 'plane' || e.type === 'dichroic') yy = e.ap;
      else if (e.type === 'filament') yy = Math.max(Math.abs(e.top), Math.abs(e.bottom));
      else if (e.type === 'beam') yy = Math.abs(e.y) + e.width / 2;
      zs.forEach(function (z) { z0 = Math.min(z0, z); z1 = Math.max(z1, z); });
      ym = Math.max(ym, yy);
    });
    return { z0: z0, z1: z1, y0: -ym, y1: ym };
  }

  // ---------------------------------------------------------------- save / load

  /** The scene as JSON text. */
  function toJSON(scene) { return JSON.stringify(scene); }

  /** True for an ordinary finite number. */
  function finite(x) { return typeof x === 'number' && isFinite(x); }
  /** True if x is missing or a finite number. */
  function optFinite(x) { return x == null || finite(x); }
  /** A colour string if c is a reasonable one, else null. */
  function color(c) { return typeof c === 'string' && c.length < 40 ? c : null; }

  /** Element kinds that are light sources, and can be switched off. */
  var SOURCES = { object: true, point: true, beam: true, filament: true };

  var PTS = { tip: 1, src: 1, C: 1, F: 1, Fp: 1, P: 1, Et: 1, Eb: 1, top: 1, bot: 1, mid: 1 };
  /** True for a whole number of at least 0 (a valid list index). */
  function index(n) { return Number.isInteger(n) && n >= 0; }
  /** True if r is a well-formed reference to an element, ray or image (depth guards against loops). */
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

  /** True if n is a well-formed ray node. */
  function checkNode(n) {
    var d = n && n.dir, e = n && n.end;
    if (!d || !e) return false;
    var dirOk = d.kind === 'free' || d.kind === 'parallel' || d.kind === 'straight' ||
      (d.kind === 'through' && checkRef(d.at)) || (d.kind === 'slope' && finite(d.u)) ||
      (d.kind === 'parallelTo' && typeof d.ray === 'string' && index(d.seg)) ||
      (d.kind === 'deflect' && typeof d.el === 'string') || (d.kind === 'beam' && typeof d.el === 'string') ||
      (d.kind === 'refract' && typeof d.el === 'string');
    var endOk = (e.kind === 'lens' && typeof e.el === 'string' && optFinite(e.y)) ||
      (e.kind === 'z' && finite(e.z) && optFinite(e.y)) || (e.kind === 'at' && checkRef(e.at)) ||
      (e.kind === 'edge' && (e.sgn === 1 || e.sgn === -1)) || e.kind === 'next' ||
      (e.kind === 'plane' && typeof e.el === 'string' && (e.pt === 'F' || e.pt === 'Fp'));
    return dirOk && endOk;
  }

  /** The number at the end of an id ("e12" gives 12), or 0. */
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
        if (e.hideHelpers) out.hideHelpers = true;
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
        out = { id: e.id, type: 'point', z: e.z, y: e.y, label: String(e.label || ''), color: color(e.color) };
      } else if (e.type === 'mirror') {
        if (!finite(e.tilt) || !finite(e.range)) throw new Error(where + 'bad mirror angle.');
        if (!finite(e.ap) || e.ap <= 0) throw new Error(where + 'mirror size must be positive.');
        out = { id: e.id, type: 'mirror', z: e.z, tilt: e.tilt, range: e.range, ap: e.ap, label: String(e.label || '') };
        if (e.flip) out.flip = true;
      } else if (e.type === 'beam') {
        if (!finite(e.y) || !finite(e.width) || e.width <= 0 || !finite(e.angle)) throw new Error(where + 'bad beam.');
        out = { id: e.id, type: 'beam', z: e.z, y: e.y, width: e.width, angle: e.angle, label: String(e.label || ''), color: color(e.color),
          dir: e.dir === -1 ? -1 : 1 };
      } else if (e.type === 'filament') {
        if (!finite(e.top) || !finite(e.bottom) || e.top <= e.bottom) throw new Error(where + 'bad filament ends.');
        out = { id: e.id, type: 'filament', z: e.z, top: e.top, bottom: e.bottom, label: String(e.label || ''), color: color(e.color) };
      } else if (e.type === 'iris') {
        if (!finite(e.r) || e.r < 0 || !finite(e.ap) || e.ap <= 0) throw new Error(where + 'bad iris size.');
        out = { id: e.id, type: 'iris', z: e.z, r: e.r, ap: e.ap, label: String(e.label || '') };
        if (e.mask) out.mask = true;
      } else if (e.type === 'plane') {
        if (!finite(e.ap) || e.ap <= 0) throw new Error(where + 'bad image plane size.');
        out = { id: e.id, type: 'plane', z: e.z, ap: e.ap, label: String(e.label || '') };
        if (color(e.color)) out.color = color(e.color);
      } else if (e.type === 'dichroic') {
        if (!finite(e.ap) || e.ap <= 0) throw new Error(where + 'bad dichroic size.');
        out = { id: e.id, type: 'dichroic', z: e.z, ap: e.ap, label: String(e.label || ''), stop: color(e.stop) };
      } else throw new Error(where + 'unknown type "' + e.type + '".');
      if (e.type !== 'axis' && typeof e.axis === 'string') out.axis = e.axis;
      if (e.hidden && SOURCES[e.type]) out.hidden = true;
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
      if (typeof r.off === 'string') s.rays[s.rays.length - 1].off = r.off;
      if (typeof r.label === 'string' && r.label) s.rays[s.rays.length - 1].label = r.label.slice(0, 12);
    });
    s.nextId = Math.max(maxId + 1, finite(d.nextId) ? d.nextId : 1);
    if (d.settings) {
      if (typeof d.settings.follow === 'boolean') s.settings.follow = d.settings.follow;
      if (typeof d.settings.virtual === 'boolean') s.settings.virtual = d.settings.virtual;
      if (typeof d.settings.colour === 'boolean') s.settings.colour = d.settings.colour;
      if (typeof d.settings.rims === 'boolean') s.settings.rims = d.settings.rims;
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
  /** Forget every step (a new scene starts its own history). */
  History.prototype.reset = function () { this.stack = []; this.i = -1; };

  return {
    VERSION: VERSION, DEFAULT_F: DEFAULT_F, DEFAULT_AP: DEFAULT_AP, DEFAULT_H: DEFAULT_H,
    nextLabel: nextLabel, copyElement: copyElement,
    create: create, addLens: addLens, addObject: addObject, addPoint: addPoint, addMirror: addMirror, addIris: addIris, addPlane: addPlane, addDichroic: addDichroic, addFilament: addFilament, addBeam: addBeam, addRay: addRay,
    addAxis: addAxis, axes: axes, axisView: axisView, ensureAxis: ensureAxis,
    find: find, isRay: isRay, remove: remove, lenses: lenses, bounds: bounds,
    toJSON: toJSON, fromJSON: fromJSON, History: History, SOURCES: SOURCES, beamEnd: beamEnd
  };
});
