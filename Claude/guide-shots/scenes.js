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

  // ---------------------------------------------------------------- helper rays
  function helperBase() {
    var L = lens(0, 50, 30); L.planes = true;
    var P = point(-80, 6);
    var r = ray({ at: { el: P.id, pt: 'src' } }); r.label = 'r1';
    r.nodes.push({ dir: { kind: 'free' }, end: { kind: 'lens', el: L.id, y: 18 } });
    return { L: L, P: P, r: r };
  }
  function withHelper(b) {
    var h = ray({ at: { el: b.L.id, pt: 'C' } }, true); h.label = 'h1';
    h.nodes.push({ dir: { kind: 'parallelTo', ray: b.r.id, seg: 0 }, end: { kind: 'z', z: 80 } });
    return h;
  }
  var G = {
    helper1: function () { helperBase(); },
    helper2: function () { var b = helperBase(); withHelper(b); },
    helper3: function () {
      var b = helperBase(), h = withHelper(b);
      b.r.nodes.push({ dir: { kind: 'through', at: { ray: h.id, seg: 0, plane: { el: b.L.id, pt: 'Fp' } } }, end: { kind: 'z', z: 170 } });
    },
    helper4: function () {
      var b = helperBase(), h = withHelper(b);
      b.r.nodes.push({ dir: { kind: 'through', at: { ray: h.id, seg: 0, plane: { el: b.L.id, pt: 'Fp' } } }, end: { kind: 'z', z: 170 } });
      var c = ray({ at: { el: b.P.id, pt: 'src' } }); c.label = 'r2';
      draw(c, { z: 0, y: 0 }); draw(c, { z: 170, y: -12.8 });
    },
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
    irisClosed: function () { G.iris({ r: 5 }); }
  };
  window.GUIDE = G;
})();
