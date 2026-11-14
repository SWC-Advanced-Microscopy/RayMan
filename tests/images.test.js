// Phase 3: recognising principal rays, and images found from the rays.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/scene.js');
const R = require('../js/rays.js');

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const OPT = { tol: 2, free: false };

/** Draw one segment of ray r toward cursor C (as the app does). */
function draw(s, r, C, opt = OPT) {
  const sol = R.solveScene(s), pts = sol.rays[r.id].pts, n = pts.length;
  const prop = R.proposeSegment(s, sol, pts[n - 1], n > 1 ? pts[n - 2] : null, C, opt);
  assert.ok(prop, 'no proposal');
  r.nodes.push(...prop.nodes);
  return prop;
}
const tip = O => ({ at: { el: O.id, pt: 'tip' } });

/** Object at z0 (height h) in front of a lens of focal length f at 0, with the parallel and
    central rays drawn out to zEnd. */
function twoRays(f, z0, h, zEnd) {
  const s = S.create();
  const L = S.addLens(s, 0, f, 40);
  const O = S.addObject(s, z0, h);
  const par = S.addRay(s, tip(O));
  draw(s, par, { z: 5, y: h });                               // parallel, to the lens
  par.nodes.push({ dir: { kind: 'through', at: { el: L.id, pt: 'Fp' } }, end: { kind: 'z', z: zEnd } });
  const cen = S.addRay(s, tip(O));
  cen.nodes.push({ dir: { kind: 'through', at: { el: L.id, pt: 'C' } }, end: { kind: 'lens', el: L.id } },
    { dir: { kind: 'straight' }, end: { kind: 'z', z: zEnd } });
  return { s, L, O, par, cen };
}

test('principal rays are recognised at the first lens', () => {
  const { s, L, O, par, cen } = twoRays(50, -100, 10, 200);
  const foc = S.addRay(s, tip(O));
  foc.nodes.push({ dir: { kind: 'through', at: { el: L.id, pt: 'F' } }, end: { kind: 'lens', el: L.id } },
    { dir: { kind: 'parallel' }, end: { kind: 'z', z: 200 } });
  const other = S.addRay(s, tip(O));
  other.nodes.push({ dir: { kind: 'free' }, end: { kind: 'lens', el: L.id, y: 3 } });
  const roles = R.solveScene(s).roles;
  assert.equal(roles[par.id], 'parallel');
  assert.equal(roles[cen.id], 'central');
  assert.equal(roles[foc.id], 'focal');
  assert.equal(roles[other.id], null);
});

test('a diverging lens: the focal ray is the one aimed at F beyond the lens', () => {
  const s = S.create();
  const L = S.addLens(s, 0, -50, 40);                         // F is at +50
  const O = S.addObject(s, -100, 10);
  const r = S.addRay(s, tip(O));
  r.nodes.push({ dir: { kind: 'through', at: { el: L.id, pt: 'F' } }, end: { kind: 'lens', el: L.id } });
  assert.equal(R.solveScene(s).roles[r.id], 'focal');
});

test('a real image appears where the drawn rays cross (object at 2F)', () => {
  const { s } = twoRays(50, -100, 10, 200);
  const ims = R.solveScene(s).images;
  assert.equal(ims.length, 1);
  close(ims[0].z, 100); close(ims[0].y, -10);
  assert.equal(ims[0].virtual, false);
  assert.equal(ims[0].arrow, true);
  assert.equal(ims[0].rays.length, 2);
});

test('no image until the rays are drawn far enough to cross', () => {
  const { s } = twoRays(50, -100, 10, 80);                    // they cross at z = 100
  assert.equal(R.solveScene(s).images.length, 0);
});

test('a virtual image when the object is inside F', () => {
  // object at -25, f = 50: image at -50, magnification 2, upright
  const { s } = twoRays(50, -25, 10, 150);
  const im = R.solveScene(s).images[0];
  assert.ok(im, 'no image');
  assert.equal(im.virtual, true);
  close(im.z, -50); close(im.y, 20);
});

test('an object at F gives no image (the rays leave parallel)', () => {
  const { s } = twoRays(50, -50, 10, 200);
  assert.equal(R.solveScene(s).images.length, 0);
});

test('an image is an object for the next lens, and rays from it follow it', () => {
  const { s, L } = twoRays(50, -100, 10, 200);              // image at (100, -10)
  const L2 = S.addLens(s, 200, 50, 40);
  const im = R.solveScene(s).images[0];
  const ref = { img: { src: im.src, lens: im.lens } };
  // the image is offered as a place to start a ray
  const st = R.proposeStart(s, R.solveScene(s), { z: 100.5, y: -10.4 }, { ...OPT, grid: 5 });
  assert.deepEqual(st.start, { at: ref });
  assert.match(st.text, /the image/);
  const r = S.addRay(s, st.start);
  draw(s, r, { z: 210, y: -10 });                             // parallel to L2
  assert.deepEqual(R.solveScene(s).rays[r.id].pts[0], { z: 100, y: -10 });
  assert.equal(R.solveScene(s).roles[r.id], 'parallel');      // judged at L2, its first lens
  // move L1: the image moves, and the ray from it follows
  L.f = 40;                                                   // 1/v = 1/40 - 1/100 -> v = 66.67, m = -2/3
  const p0 = R.solveScene(s).rays[r.id].pts[0];
  close(p0.z, 200 / 3, 1e-6); close(p0.y, -20 / 3, 1e-6);
  void L2;
});

test('two lenses: the image through both is found from the rays after the second lens', () => {
  const s = S.create();
  const L1 = S.addLens(s, 0, 50, 40), L2 = S.addLens(s, 100, 50, 40);   // 4f relay
  const O = S.addObject(s, -50, 10);                                     // at F1
  const a = S.addRay(s, tip(O)), b = S.addRay(s, tip(O));
  a.nodes.push({ dir: { kind: 'parallel' }, end: { kind: 'lens', el: L1.id } },
    { dir: { kind: 'through', at: { el: L1.id, pt: 'Fp' } }, end: { kind: 'lens', el: L2.id } },
    { dir: { kind: 'parallel' }, end: { kind: 'z', z: 250 } });
  b.nodes.push({ dir: { kind: 'through', at: { el: L1.id, pt: 'C' } }, end: { kind: 'lens', el: L1.id } },
    { dir: { kind: 'straight' }, end: { kind: 'lens', el: L2.id } },               // reaches L2 at (100, -20)
    { dir: { kind: 'free' }, end: { kind: 'z', z: 250, y: 10 } });                // correctly refracted: slope +0.2
  const ims = R.solveScene(s).images;
  assert.equal(ims.length, 1);                                // none after L1: the rays are parallel there
  assert.equal(ims[0].lens, L2.id);
  close(ims[0].z, 150); close(ims[0].y, -10);                 // at F2′, inverted, magnification -1
});

test('deleting a ray that formed an image frees the rays drawn from that image', () => {
  const { s, cen } = twoRays(50, -100, 10, 200);
  const im = R.solveScene(s).images[0];
  const r = S.addRay(s, { at: { img: { src: im.src, lens: im.lens } } });
  r.nodes.push({ dir: { kind: 'free' }, end: { kind: 'z', z: 150, y: 0 } });
  const before = R.solveScene(s).rays[r.id].pts;
  R.bakeRefsTo(s, cen.id, S.remove);
  S.remove(s, cen.id);
  const sol = R.solveScene(s);
  assert.equal(sol.images.length, 0);
  assert.deepEqual(sol.rays[r.id].pts, before);               // still there, now free
});

test('a ray aimed through the image it helps define does not loop forever', () => {
  const { s, O } = twoRays(50, -100, 10, 200);
  const im = R.solveScene(s).images[0];
  const third = S.addRay(s, tip(O));
  third.nodes.push({ dir: { kind: 'free' }, end: { kind: 'lens', el: s.elements[0].id, y: 4 } },
    { dir: { kind: 'through', at: { img: { src: im.src, lens: im.lens } } }, end: { kind: 'z', z: 200 } });
  const sol = R.solveScene(s);
  assert.equal(sol.images.length, 1);
  close(R.solveScene(s).rays[third.id].pts[2].y, 4 + (-10 - 4) / 100 * 200);
});

test('scenes with image refs survive save and load', () => {
  const { s } = twoRays(50, -100, 10, 200);
  const im = R.solveScene(s).images[0];
  S.addRay(s, { at: { img: { src: im.src, lens: im.lens } } });
  const t = S.fromJSON(S.toJSON(s));
  assert.deepEqual(t.rays, s.rays);
});

test('one click carries a ray through the lens centre and straight on, pinned to the centre', () => {
  const s = S.create();
  const L = S.addLens(s, 0, 50, 40);
  const O = S.addObject(s, -100, 10);
  const r = S.addRay(s, tip(O));
  const p = draw(s, r, { z: 100, y: -10.8 });                 // well past the lens, on the line through C
  assert.equal(p.nodes.length, 2);
  assert.deepEqual(p.nodes[0], { dir: { kind: 'through', at: { el: L.id, pt: 'C' } }, end: { kind: 'lens', el: L.id } });
  assert.equal(p.nodes[1].dir.kind, 'straight');
  assert.match(p.text, /centre of L1, straight on/);
  const pts = R.solveScene(s).rays[r.id].pts;
  assert.deepEqual(pts[1], { z: 0, y: 0 });
  close(pts[2].y, -pts[2].z / 10);
  L.z = 10;                                                   // still through the (moved) centre
  const q = R.solveScene(s).rays[r.id].pts;
  assert.deepEqual(q[1], { z: 10, y: 0 });
});

test('clicking at the lens itself still stops there', () => {
  const s = S.create();
  S.addLens(s, 0, 50, 40);
  const O = S.addObject(s, -100, 10);
  const r = S.addRay(s, tip(O));
  assert.equal(draw(s, r, { z: 1, y: 0.5 }).nodes.length, 1);
});

test('rays are drawn ending at the real image they form', () => {
  const { s, par, cen } = twoRays(50, -100, 10, 200);         // image at (100, -10)
  const sol = R.solveScene(s);
  for (const r of [par, cen]) {
    const sh = sol.rays[r.id].shown;
    assert.equal(sol.rays[r.id].trimmed, true);
    assert.deepEqual(sh[sh.length - 1], { z: sol.images[0].z, y: sol.images[0].y });
    assert.equal(sol.rays[r.id].pts[sol.rays[r.id].pts.length - 1].z, 200);   // the data is untouched
  }
});

test('virtual images do not trim rays', () => {
  const { s, par } = twoRays(50, -25, 10, 150);
  assert.equal(R.solveScene(s).rays[par.id].trimmed, false);
});

test('once an image forms, the rays are lengthened so it keeps forming as the optics move', () => {
  const { s, L, par, cen } = twoRays(50, -100, 10, 110);      // they just reach the image at 100
  assert.equal(R.extendToImages(s, 1), true);
  assert.equal(par.nodes[par.nodes.length - 1].end.kind, 'edge');
  assert.equal(cen.nodes[cen.nodes.length - 1].end.kind, 'edge');
  L.f = 40;                                                   // image moves out to 166.7: still found
  const im = R.solveScene(s).images[0];
  close(im.z, 1 / (1 / 40 - 1 / 100), 1e-6);
  assert.equal(R.extendToImages(s, 1), false);                // nothing more to do
});

test('a focal ray disappears while its object is inside F, and comes back outside it', () => {
  const s = S.create();
  const L = S.addLens(s, 0, 50, 40);
  const O = S.addObject(s, -100, 10);
  const f = S.addRay(s, tip(O));
  f.nodes.push({ dir: { kind: 'through', at: { el: L.id, pt: 'F' } }, end: { kind: 'lens', el: L.id } },
    { dir: { kind: 'parallel' }, end: { kind: 'z', z: 150 } });
  assert.equal(R.solveScene(s).rays[f.id].pts.length, 3);
  O.z = -30;                                              // inside F: F is now behind the tip
  const s1 = R.solveScene(s).rays[f.id];
  assert.equal(s1.pts.length, 1);                         // nothing drawn
  assert.equal(R.solveScene(s).images.length, 0);
  O.z = -80;                                              // back outside F: as drawn
  assert.equal(R.solveScene(s).rays[f.id].pts.length, 3);
  assert.equal(f.nodes.length, 2);                        // nothing was deleted
});

test('a ray along the axis, straight on through a lens centre, can end on F′', () => {
  const s = S.create();
  const L = S.addLens(s, 0, 50, 40);
  const r = S.addRay(s, { z: -80, y: 0 });
  r.nodes.push({ dir: { kind: 'parallel' }, end: { kind: 'lens', el: L.id } });   // reaches the centre
  const sol = R.solveScene(s), P = sol.rays[r.id].pts;
  const p = R.proposeSegment(s, sol, P[1], P[0], { z: 51, y: 1 }, { tol: 2, free: false, self: r.id });
  assert.deepEqual(p.nodes[0], { dir: { kind: 'straight' }, end: { kind: 'at', at: { el: L.id, pt: 'Fp' } } });
  assert.match(p.text, /to F′ of L1/);
  // and in one click from before the lens, through the centre and on to F′
  const q = S.addRay(s, { z: -80, y: 0 });
  const so = R.solveScene(s);
  const p2 = R.proposeSegment(s, so, so.rays[q.id].pts[0], null, { z: 50.5, y: 0.5 }, { tol: 2, free: false, self: q.id });
  assert.deepEqual(p2.nodes.map(n => n.end), [{ kind: 'lens', el: L.id }, { kind: 'at', at: { el: L.id, pt: 'Fp' } }]);
});

test('an axis ray goes straight on through two lens centres in one click, to F′ of the second', () => {
  const s = S.create();
  const L1 = S.addLens(s, 0, 50, 40), L2 = S.addLens(s, 70, 50, 40);
  const r = S.addRay(s, { z: -50, y: 0 });
  const sol = R.solveScene(s);
  const p = R.proposeSegment(s, sol, sol.rays[r.id].pts[0], null, { z: 120.4, y: 0.3 }, { tol: 2, free: false, self: r.id });
  assert.deepEqual(p.nodes.map(n => n.end), [{ kind: 'lens', el: L1.id }, { kind: 'lens', el: L2.id }, { kind: 'at', at: { el: L2.id, pt: 'Fp' } }]);
});

test('a ray "bent by" a lens stays correctly bent when its source moves', () => {
  const s = S.create();
  const L = S.addLens(s, 0, 50, 40);
  const P = S.addPoint(s, -50, 0);                         // at F: rays leave parallel
  const r = S.addRay(s, { at: { el: P.id, pt: 'src' } });
  r.nodes.push({ dir: { kind: 'free' }, end: { kind: 'lens', el: L.id, y: 9 } });
  const sol = R.solveScene(s), pts = sol.rays[r.id].pts;
  const p = R.proposeSegment(s, sol, pts[1], pts[0], { z: 60, y: 9.5 }, { tol: 2, free: false, self: r.id, inDir: { kind: 'free' } });
  assert.deepEqual(p.nodes[0].dir, { kind: 'refract', el: L.id });          // remembered as "bent by", not "parallel"
  assert.equal(p.axis, true);                                               // the axis still lights up
  assert.match(p.text, /bent by L1/);
  r.nodes.push(...p.nodes);
  P.z = -100;                                              // now at 2F: rays from it should meet at (100, 0)
  const q = R.solveScene(s).rays[r.id].pts;
  close(q[1].y + (q[2].y - q[1].y) / (q[2].z - q[1].z) * 100, 0, 1e-9);
});

test('through a second lens, a ray bent by the first is remembered as bent by the second too', () => {
  const s = S.create();
  const L1 = S.addLens(s, 0, 50, 40), L2 = S.addLens(s, 60, 50, 40);
  const P = S.addPoint(s, -50, 0);                                 // at F of L1: parallel between the lenses
  const r = S.addRay(s, { at: { el: P.id, pt: 'src' } });
  r.nodes.push({ dir: { kind: 'free' }, end: { kind: 'lens', el: L1.id, y: 9 } },
    { dir: { kind: 'refract', el: L1.id }, end: { kind: 'lens', el: L2.id } });
  const sol = R.solveScene(s), pts = sol.rays[r.id].pts;           // reaches L2 at y = 9, parallel
  const p = R.proposeSegment(s, sol, pts[2], pts[1], { z: 140, y: 9 - 9 / 50 * 80 + 0.4 },
    { tol: 2, free: false, self: r.id, inDir: r.nodes[1].dir });
  assert.deepEqual(p.nodes[0].dir, { kind: 'refract', el: L2.id });  // not a fixed "through F′ of L2"
  assert.match(p.text, /F′ of L2 \(bent by L2\)/);
  r.nodes.push(...p.nodes);
  P.z = -100;                                                       // move the source: still the lenses' own bends
  const q = R.solveScene(s).rays[r.id].pts, u1 = (q[1].y - q[0].y) / (q[1].z - q[0].z) - q[1].y / 50;
  close((q[2].y - q[1].y) / (q[2].z - q[1].z), u1, 1e-9);
  const u2 = u1 - q[2].y / 50;
  close((q[3].y - q[2].y) / (q[3].z - q[2].z), u2, 1e-9);
  void L2;
});

test('"bent by" a lens works for a ray drawn right to left', () => {
  // light from the left through (0, 10) on a lens of f = 50 leaving parallel came from F at (-50, 0);
  // drawn backwards (from the right, parallel, onto the lens), the bend must lead back to F
  const s = S.create();
  const L = S.addLens(s, 0, 50, 40);
  const r = S.addRay(s, { z: 80, y: 10 });
  r.nodes.push({ dir: { kind: 'parallel' }, end: { kind: 'lens', el: L.id } });
  const sol = R.solveScene(s), pts = sol.rays[r.id].pts;
  const p = R.proposeSegment(s, sol, pts[1], pts[0], { z: -30, y: 4.3 }, { tol: 2, free: false, self: r.id, inDir: { kind: 'free' } });
  assert.deepEqual(p.nodes[0].dir, { kind: 'refract', el: L.id });
  r.nodes.push({ dir: { kind: 'refract', el: L.id }, end: { kind: 'z', z: -50 } });
  const q = R.solveScene(s).rays[r.id].pts;
  close(q[2].y, 0, 1e-9);
});

test('a ray drawn parallel to another keeps that rule when the other is lengthened to its image', () => {
  const s = S.create();
  const L = S.addLens(s, 50, 25, 30), F = S.addFilament(s, 0);
  const a = S.addRay(s, { at: { el: F.id, pt: 'top' } });
  a.nodes.push({ dir: { kind: 'free' }, end: { kind: 'lens', el: L.id, y: 14 } }, { dir: { kind: 'refract', el: L.id }, end: { kind: 'z', z: 105 } });
  const b = S.addRay(s, { at: { el: F.id, pt: 'bot' } });
  b.nodes.push({ dir: { kind: 'parallelTo', ray: a.id, seg: 1 }, end: { kind: 'lens', el: L.id } });
  const c = S.addRay(s, { at: { el: F.id, pt: 'top' } });
  c.nodes.push({ dir: { kind: 'through', at: { el: L.id, pt: 'C' } }, end: { kind: 'lens', el: L.id } }, { dir: { kind: 'straight' }, end: { kind: 'z', z: 110 } });
  assert.ok(R.extendToImages(s, 1));                      // a and c meet: a is lengthened past the image
  assert.equal(a.nodes[1].end.kind, 'edge');
  assert.deepEqual(b.nodes[0].dir, { kind: 'parallelTo', ray: a.id, seg: 1 });
});

test('a ray lengthened past its image can be cut back to the image and drawn on from there', () => {
  const s = S.create();
  const L = S.addLens(s, 50, 25, 30), F = S.addFilament(s, 0);
  const a = S.addRay(s, { at: { el: F.id, pt: 'top' } }), c = S.addRay(s, { at: { el: F.id, pt: 'top' } });
  a.nodes.push({ dir: { kind: 'free' }, end: { kind: 'lens', el: L.id, y: 14 } }, { dir: { kind: 'refract', el: L.id }, end: { kind: 'z', z: 105 } });
  c.nodes.push({ dir: { kind: 'through', at: { el: L.id, pt: 'C' } }, end: { kind: 'lens', el: L.id } }, { dir: { kind: 'straight' }, end: { kind: 'z', z: 110 } });
  R.extendToImages(s, 1);
  const im = R.solveScene(s).images[0];
  assert.ok(R.cutAt(s, a, null, im.z));
  assert.deepEqual(a.nodes[1], { dir: { kind: 'refract', el: L.id }, end: { kind: 'z', z: im.z } });
  const sol = R.solveScene(s), pts = sol.rays[a.id].pts;
  close(pts[2].y, im.y, 1e-9);
  const p = R.proposeSegment(s, sol, pts[2], pts[1], { z: 140, y: im.y + (pts[2].y - pts[1].y) / 50 * 40 + 0.3 }, { tol: 2, free: false, self: a.id });
  assert.equal(p.nodes[0].dir.kind, 'straight');                   // carries on in a straight line
});

test('where another ray crosses a focal plane is only a weak snap, unless leaving that lens', () => {
  const s = S.create();
  const L = S.addLens(s, 50, 25, 30), P = S.addPoint(s, 0, 6);
  const o = S.addRay(s, { z: 0, y: 7 });                       // crosses the front focal plane (z = 25) at y = 6.2
  o.nodes.push({ dir: { kind: 'free' }, end: { kind: 'lens', el: L.id, y: 5.4 } });
  const sol = R.solveScene(s), C = { z: 52, y: 6.4 };          // aiming parallel to the axis, onto the lens
  const p = R.proposeSegment(s, sol, { z: 0, y: 6 }, null, C, { tol: 2, free: false });
  assert.deepEqual(p.nodes[0].dir, { kind: 'parallel' });
  void P;
});

test('an iris at a filament image stops rays that have a corner on its plane', () => {
  const s = S.create();
  const L = S.addLens(s, 50, 25, 30), F = S.addFilament(s, 0), A = S.addIris(s, 100);
  F.top = 6; F.bottom = -6; A.r = 9;
  const a = S.addRay(s, { at: { el: F.id, pt: 'top' } });
  a.nodes.push({ dir: { kind: 'free' }, end: { kind: 'lens', el: L.id, y: 14 } },
    { dir: { kind: 'refract', el: L.id }, end: { kind: 'z', z: 100 } },     // ends at the image, on the iris plane
    { dir: { kind: 'straight' }, end: { kind: 'z', z: 140 } });
  assert.equal(R.solveScene(s).rays[a.id].blocked, null);                  // open: the image (y = -6) passes
  A.r = 4;                                                                  // closed past the image
  const s2 = R.solveScene(s).rays[a.id];
  assert.equal(s2.blocked, A.id);
  close(s2.pts[s2.pts.length - 1].z, 100);
});

test('an image plane marker: rays end on it, pass straight through it, and images beyond it still form', () => {
  const s = S.create();
  const L = S.addLens(s, 0, 50, 30), O = S.addObject(s, -100, 10);
  const M = S.addPlane(s, 60), M2 = S.addPlane(s, 300);
  assert.equal(M.label, 'sample'); assert.equal(M2.label, 'camera');
  const tipRef = { at: { el: O.id, pt: 'tip' } };
  const a = S.addRay(s, tipRef);
  a.nodes.push({ dir: { kind: 'parallel' }, end: { kind: 'lens', el: L.id } });
  let sol = R.solveScene(s), pts = sol.rays[a.id].pts;
  const p = R.proposeSegment(s, sol, pts[1], pts[0], { z: 60.5, y: 10 - 10 / 50 * 60 + 0.2 }, { tol: 2, free: false, self: a.id, inDir: a.nodes[0].dir });
  assert.match(p.text, /to sample/);
  assert.deepEqual(p.nodes[0].end, { kind: 'lens', el: M.id });
  a.nodes.push(...p.nodes, { dir: { kind: 'straight' }, end: { kind: 'z', z: 150 } });   // on through the sample plane
  const b = S.addRay(s, tipRef);
  b.nodes.push({ dir: { kind: 'through', at: { el: L.id, pt: 'C' } }, end: { kind: 'lens', el: L.id } },
    { dir: { kind: 'straight' }, end: { kind: 'z', z: 150 } });
  const im = R.solveScene(s).images[0];                    // object at 2F: image at 2F′ = 100, beyond the sample
  assert.ok(im && !im.virtual);
  close(im.z, 100); close(im.y, -10);
  const t = S.fromJSON(S.toJSON(s));
  assert.deepEqual(t.elements, s.elements);
});

test('an arrow image reports its magnification: image height over object height', () => {
  const at2F = twoRays(50, -100, 10, 200), im1 = R.solveScene(at2F.s).images[0];
  close(R.magnification(at2F.s, im1), -1);                    // same size, inverted
  const at15F = twoRays(50, -75, 10, 300), im2 = R.solveScene(at15F.s).images[0];
  close(im2.z, 150); close(R.magnification(at15F.s, im2), -2); // twice the size, inverted
  const inside = twoRays(50, -25, 10, 200), im3 = R.solveScene(inside.s).images[0];
  assert.equal(im3.virtual, true);
  close(R.magnification(inside.s, im3), 2);                    // a magnifier: upright, twice the size
});

test('the image of a point source has no magnification', () => {
  const s = S.create();
  const L = S.addLens(s, 0, 50, 40);
  const P = S.addPoint(s, -100, 10);
  for (const pt of ['C', 'Fp']) {
    const r = S.addRay(s, { at: { el: P.id, pt: 'src' } });
    if (pt === 'C') r.nodes.push({ dir: { kind: 'through', at: { el: L.id, pt: 'C' } }, end: { kind: 'lens', el: L.id } },
      { dir: { kind: 'straight' }, end: { kind: 'z', z: 200 } });
    else { draw(s, r, { z: 5, y: 10 }); r.nodes.push({ dir: { kind: 'through', at: { el: L.id, pt: 'Fp' } }, end: { kind: 'z', z: 200 } }); }
  }
  const im = R.solveScene(s).images[0];
  assert.ok(im && !im.arrow);
  assert.equal(R.magnification(s, im), null);
});
