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
  function pass() { R.passMirrors(view()); }
  function bent(r, L, z) {            // on from lens L, bent by it, to z
    r.nodes.push({ dir: { kind: 'refract', el: L.id }, end: z == null ? { kind: 'next' } : { kind: 'z', z: z } });
  }
  var BLUE = '#1f6fd6', GREEN = '#2e9e3a', PURPLE = '#8e44ad', ORANGE = '#e08a00';

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
    // ---------------------------------------------------------------- 4f relay and scanning
    relay: function (opts) {
      opts = opts || {};
      var scan = lens(0, 50, 25, 'scan'), tube = lens(150, 100, 35, 'tube');
      var M = on(S.addMirror(real, -50)); M.tilt = opts.tilt == null ? 4 : opts.tilt; M.range = 6; M.extremes = !!opts.extremes;
      var B = S.addBeam(real, -120, 0, ax); B.width = 10; B.color = BLUE;
      pass();
      real.rays.forEach(function (r) { bent(r, scan); bent(r, tube, 340); });
      if (opts.planes) {
        var a = on(S.addPlane(real, 50)); a.label = 'image'; a.color = ORANGE;
        var b = on(S.addPlane(real, 250)); b.label = 'pupil'; b.color = PURPLE; b.ap = 20;
      }
    },
    relayExtremes: function () { G.relay({ extremes: true }); },
    relayPlanes: function () { G.relay({ extremes: true, planes: true }); },
    noRelay: function () {               // the mirror some way behind the objective: the beam walks off
      real.settings.rims = true;
      var obj = lens(0, 20, 8, 'objective');
      var M = on(S.addMirror(real, -80)); M.tilt = 0; M.range = 8; M.extremes = true;
      var B = S.addBeam(real, -150, 0, ax); B.width = 12; B.color = BLUE;
      pass();
      real.rays.forEach(function (r) { bent(r, obj, 40); });
    },
    // ---------------------------------------------------------------- a confocal
    confocal: function (opts) {
      opts = opts || {};
      var sample = on(S.addPlane(real, -40)); sample.label = 'sample'; sample.color = ORANGE; sample.ap = 14;
      var obj = lens(0, 40, 14, 'objective'), tube = lens(140, 100, 25, 'tube'), scan = lens(290, 50, 20, 'scan');
      var M = on(S.addMirror(real, 340)); M.tilt = opts.tilt == null ? 3 : opts.tilt; M.range = 4; M.ap = 12;
      var D = on(S.addDichroic(real, 395)); D.stop = BLUE; D.ap = 14;
      var B = S.addBeam(real, 368, 0, ax, -1); B.width = 8; B.color = BLUE; B.label = 'laser';
      var pl = lens(440, 40, 14, 'L4');
      var I = on(S.addIris(real, 480)); I.r = opts.pinhole == null ? 1 : opts.pinhole; I.ap = 12; I.label = 'pinhole';
      var det = on(S.addPlane(real, 525)); det.label = 'detector'; det.ap = 10;
      if (opts.planes) {
        var im = on(S.addPlane(real, 240)); im.label = 'image'; im.color = ORANGE; im.ap = 14;
        var bfp = on(S.addPlane(real, 40)); bfp.label = 'BFP'; bfp.color = PURPLE; bfp.ap = 12;
      }
      pass();
      var laser = real.rays.slice();
      laser.forEach(function (r) {
        r.nodes.push({ dir: { kind: 'refract', el: scan.id }, end: { kind: 'next', sgn: -1 } },
          { dir: { kind: 'refract', el: tube.id }, end: { kind: 'next', sgn: -1 } },
          { dir: { kind: 'refract', el: obj.id }, end: { kind: 'lens', el: sample.id } });
      });
      var mid = laser.filter(function (r) { return r.start.at.pt === 'mid'; })[0], spot = last(mid);
      function fluor(src, h) {
        var r = ray({ at: { el: src.id, pt: 'src' } });
        r.nodes.push({ dir: { kind: 'free' }, end: { kind: 'lens', el: obj.id, y: h } });
        bent(r, obj); bent(r, tube); bent(r, scan);
        return r;
      }
      var F = point(-40, spot.y, GREEN, opts.beadOff ? 'fluorophore' : '');
      fluor(F, 9); fluor(F, -9);
      if (opts.bead) { var Bd = point(-60, spot.y, GREEN, 'bead'); fluor(Bd, 9); fluor(Bd, -9); }
      pass();
      real.rays.forEach(function (r) {
        var n = r.nodes[r.nodes.length - 1];
        if (r.nodes.length > 2 && n.pass && n.end.sgn !== -1) {     // on from the mirror, through the pinhole lens
          bent(r, pl); r.nodes[r.nodes.length - 1].end = { kind: 'lens', el: det.id };
        }
      });
      if (opts.beadOff) {
        var set = R.raysOf(view(), Bd.id);
        real.rays.forEach(function (r) { if (set[r.id]) r.off = Bd.id; });
        Bd.hidden = true;
      }
    },
    confocalPlanes: function () { G.confocal({ planes: true }); },
    confocalBead: function () { G.confocal({ bead: true }); },
    confocalBeadOff: function () { G.confocal({ bead: true, beadOff: true }); },
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
