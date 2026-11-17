/* Scenes for the guide's screenshots (guide/index.html). Run in the RayMan page by shots.py:
   each GUIDE[name]() builds a scene in the live app, using the same rules a student's mouse
   would (proposeSegment, the snaps), so the pictures are real RayMan output. */
(function () {
  var S = RM.scene, R = RM.rays, app = RM.app, real = app.st.real;
  var ax = S.axes(real)[0].id;
  function view() { return S.axisView(real, ax); }
  function on(e) { e.axis = ax; return e; }
  function lens(z, f, ap, label) { var e = S.addLens(real, z, f, ap, ax); if (label) e.label = label; return e; }
  function point(z, y, color, label) { var e = on(S.addPoint(real, z, y)); if (color) e.color = color; if (label) e.label = label; return e; }
  function ray(start, helper) { var r = S.addRay(real, start, helper); r.axis = ax; return r; }
  /** Draw one segment of r toward C, as a click there would. */
  function draw(r, C, extra) {
    var v = view(), sol = R.solveScene(v), p = sol.rays[r.id].pts, n = p.length;
    var opt = Object.assign({ tol: 1.5, free: false, self: r.id, helper: r.helper, colour: R.rayColour(real, r) }, extra || {});
    var prop = R.proposeSegment(v, sol, p[n - 1], n > 1 ? p[n - 2] : null, C, opt);
    if (!prop) throw new Error('no segment toward ' + JSON.stringify(C));
    r.nodes.push.apply(r.nodes, prop.nodes);
    return prop;
  }
  function pts(r) { return R.solveScene(view()).rays[r.id].pts; }
  function last(r) { var p = pts(r); return p[p.length - 1]; }
  function bent(r, L, z) {            // on from lens L, bent by it, to z
    r.nodes.push({ dir: { kind: 'refract', el: L.id }, end: z == null ? { kind: 'next' } : { kind: 'z', z: z } });
  }
  var GREEN = '#2e9e3a', PURPLE = '#8e44ad';
  /** For the help pictures: draw with no F, F′ or nF marks, and with snap rings at the given
      points ({z, y}). The renderer's bare option does the first; the rings are the hints. */
  function bare(rings) {
    var draw0 = RM.render.draw;
    RM.render.draw = function (c, W, H, st) {
      var o = {}; Object.keys(st).forEach(function (k) { o[k] = st[k]; });
      o.bare = true;
      if (rings) o.hints = rings;
      return draw0(c, W, H, o);
    };
    RM.app.redraw();
  }

  // ---------------------------------------------------------------- helper rays
  /* The helper-ray trick, as in step 1 of the confocal-from-zero demo: a source just inside F of
     an objective, then a tube lens. stage 1: helpers at the objective; 2: the rays leave it;
     3: helpers at the tube lens; 4: the rays meet at the image. Virtual images are hidden (the
     objective's is far off to the left) and the view is set to the system. */
  function helperTrick(stage) {
    real.settings.virtual = false;
    var obj = lens(0, 40, 32, 'objective'), tube = lens(200, 100, 45, 'tube');
    obj.planes = true; tube.planes = true;
    var P = point(-36, 0, GREEN);
    var rs = [25, -25].map(function (h, i) {
      var r = ray({ at: { el: P.id, pt: 'src' } }); r.label = 'r' + (i + 1);
      r.nodes.push({ dir: { kind: 'free' }, end: { kind: 'lens', el: obj.id, y: h } });
      return r;
    });
    var hs = rs.map(function (r, i) {
      var h = ray({ at: { el: obj.id, pt: 'C' } }, true); h.label = 'h' + (i + 1);
      h.nodes.push({ dir: { kind: 'parallelTo', ray: r.id, seg: 0 }, end: { kind: 'z', z: 62 } });
      return h;
    });
    if (stage < 2) return;
    rs.forEach(function (r, i) {
      r.nodes.push({ dir: { kind: 'through', at: { ray: hs[i].id, seg: 0, plane: { el: obj.id, pt: 'Fp' } } }, end: { kind: 'lens', el: tube.id } });
    });
    if (stage < 3) return;
    var ht = rs.map(function (r, i) {
      var h = ray({ at: { el: tube.id, pt: 'C' } }, true); h.label = 'h' + (i + 3);
      h.nodes.push({ dir: { kind: 'parallelTo', ray: r.id, seg: 1 }, end: { kind: 'z', z: 330 } });
      return h;
    });
    if (stage < 4) return;
    rs.forEach(function (r, i) {
      r.nodes.push({ dir: { kind: 'through', at: { ray: ht[i].id, seg: 0, plane: { el: tube.id, pt: 'Fp' } } }, end: { kind: 'z', z: 365 } });
    });
  }
  var G = {
    helperA: function () { helperTrick(1); },
    helperB: function () { helperTrick(2); },
    helperC: function () { helperTrick(3); },
    helperD: function () { helperTrick(4); },
    // ---------------------------------------------------------------- light from infinity
    bundle: function () {
      var L = lens(0, 50, 30); L.planes = true;
      var c = ray({ z: -90, y: 9 });
      c.nodes.push({ dir: { kind: 'through', at: { el: L.id, pt: 'C' } }, end: { kind: 'lens', el: L.id } },
        { dir: { kind: 'straight' }, end: { kind: 'z', z: 110 } });
      [ -10, 10 ].forEach(function (dy) {
        var r = ray({ z: -90, y: 9 + dy });
        r.nodes.push({ dir: { kind: 'parallelTo', ray: c.id, seg: 0 }, end: { kind: 'lens', el: L.id } });
        bent(r, L, 110);
      });
    },
    // ---------------------------------------------------------------- the Objects panel
    objects: function () {
      var L = lens(0, 50, 30);
      var A = point(-90, 6, GREEN), B = point(-70, -5, PURPLE);
      [A, B].forEach(function (P) {
        var a = ray({ at: { el: P.id, pt: 'src' } }); draw(a, { z: 0, y: P.y + 0.2 }); bent(a, L, 160);
        var b = ray({ at: { el: P.id, pt: 'src' } }); draw(b, { z: 0, y: 0.2 }); draw(b, { z: 160, y: -P.y * 1.5 });
      });
      R.extendToImages(view(), 1);
      var set = R.raysOf(view(), B.id);
      real.rays.forEach(function (r) { if (set[r.id]) r.off = B.id; });
      B.hidden = true;
    },
    // ---------------------------------------------------------------- irises and fill-in rays
    iris: function (opts) {
      opts = opts || {};
      var L = lens(0, 50, 25);
      var O = on(S.addObject(real, -100, 10)); O.axis = ax;
      var I = on(S.addIris(real, 15)); I.r = opts.r == null ? 20 : opts.r; I.ap = 25;
      var a = ray({ at: { el: O.id, pt: 'tip' } }); draw(a, { z: 0, y: 10.3 }); bent(a, L, 140);
      var b = ray({ at: { el: O.id, pt: 'tip' } }); draw(b, { z: 0, y: 0.2 }); draw(b, { z: 140, y: -14 });
      var c = ray({ at: { el: O.id, pt: 'tip' } }); c.nodes.push({ dir: { kind: 'through', at: { el: L.id, pt: 'F' } }, end: { kind: 'lens', el: L.id } }); bent(c, L, 140);
      real.settings.fill = 8;
      R.extendToImages(view(), 1);
    },
    irisClosed: function () { G.iris({ r: 5 }); },
    irisFaded: function () { G.iris({ r: 5 }); real.elements.filter(function (e) { return e.type === 'iris'; })[0].mask = true; },
    // ---------------------------------------------------------------- a negative lens
    /* The steps in the guide, drawn as the mouse would: f = -50, an object at 1.25|f|. stage 1:
       through the centre, parallel to the axis, the helper from F′ and the ray parallel to it
       (steps 3-6); 2: adds the ray aimed at F, its helper, and it leaving parallel (step 7). */
    negative: function (stage) {
      real.settings.virtual = true;
      var L = lens(0, -50, 30);
      var O = on(S.addObject(real, -62.5, 25)); O.axis = ax;
      var a = ray({ at: { el: O.id, pt: 'tip' } }); draw(a, { z: 0, y: 0.2 }); draw(a, { z: 100, y: -40 });
      var b = ray({ at: { el: O.id, pt: 'tip' } }); draw(b, { z: 0, y: 25.2 });
      var h = ray({ at: { el: L.id, pt: 'Fp' } }, true); draw(h, { z: 0, y: 25 }, { helper: true });
      draw(b, { z: 55, y: 52.5 });
      if (stage < 2) return;
      var yc = 25 - 62.5 * 25 / 112.5;
      var c = ray({ at: { el: O.id, pt: 'tip' } }); draw(c, { z: 50, y: 0.3 });
      var h2 = ray({ at: { ray: c.id, k: 1 } }, true); draw(h2, { z: 50, y: 0 }, { helper: true });
      draw(c, { z: 100, y: yc + 0.2 });
    },
    // ---------------------------------------------------------------- carrying rays on through an image
    /* A point 2f in front of L1 makes a real image 2f behind it, 2f in front of L2. stage 1: the
       three classic rays stop at the image; 2: each carried on past it (Shift-click), straight on
       to L2, and bent by it to the second image. */
    through: function (stage) {
      var L1 = lens(0, 40, 25), L2 = lens(160, 40, 34);
      var P = point(-80, 10, GREEN);
      var a = ray({ at: { el: P.id, pt: 'src' } }); draw(a, { z: 0, y: 10.2 }); bent(a, L1, 80);
      var b = ray({ at: { el: P.id, pt: 'src' } }); draw(b, { z: 0, y: 0.2 }); draw(b, { z: 80, y: -10 });
      var c = ray({ at: { el: P.id, pt: 'src' } }); c.nodes.push({ dir: { kind: 'through', at: { el: L1.id, pt: 'F' } }, end: { kind: 'lens', el: L1.id } }); bent(c, L1, 80);
      if (stage < 2) { R.extendToImages(view(), 1); return; }
      [a, b, c].forEach(function (r) {
        r.nodes[r.nodes.length - 1].end = { kind: 'z', z: 80 };
        r.nodes.push({ dir: { kind: 'straight' }, end: { kind: 'lens', el: L2.id } });
        bent(r, L2, 250);
      });
      R.extendToImages(view(), 1);
    },
    // ---------------------------------------------------------------- pictures for the help pane (images/help/)
    bare: bare,
    /* One lens, an object 75% of the lens's height, and its image: the rays from the tip, one
       parallel to the axis (bent through F') and one through the centre, cross at the image. */
    helpLens: function () {
      var L = lens(0, 50, 30); L.label = '';
      var O = on(S.addObject(real, -100, 22.5)); O.axis = ax;
      var a = ray({ at: { el: O.id, pt: 'tip' } }); draw(a, { z: 0, y: 22.5 }); bent(a, L, 130);
      var b = ray({ at: { el: O.id, pt: 'tip' } }); draw(b, { z: 0, y: 0.2 }); draw(b, { z: 130, y: -29.25 });
      R.extendToImages(view(), 1);
    },
    // A ray snapped through F (it then leaves parallel to the axis): the snap the help pane describes.
    helpSnap: function () {
      var L = lens(0, 40, 30); L.label = '';
      var P = point(-80, 18, GREEN);
      var r = ray({ at: { el: P.id, pt: 'src' } });
      r.nodes.push({ dir: { kind: 'through', at: { el: L.id, pt: 'F' } }, end: { kind: 'lens', el: L.id } });
      bent(r, L, 120);
    },
    // Two rays end at the same point of a lens; the blue one is the one continued (in the current colour).
    helpContinue: function () {
      var L = lens(0, 50, 30); L.label = '';
      var P1 = point(-80, 0, '#1f6fd6'), P2 = point(-80, 24, '#d9422b');
      var blue = ray({ at: { el: P1.id, pt: 'src' } }); blue.color = '#1f6fd6';
      var red = ray({ at: { el: P2.id, pt: 'src' } }); red.color = '#d9422b';
      draw(blue, { z: 0, y: 12 }); draw(red, { z: 0, y: 12 });
      bent(blue, L, 120);
    },
    throughA: function () { G.through(1); },
    throughB: function () { G.through(2); },
    negativeA: function () { G.negative(1); },
    negativeB: function () { G.negative(2); }
  };
  window.GUIDE = G;
})();
