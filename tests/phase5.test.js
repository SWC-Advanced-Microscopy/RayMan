// Phase 5: irises and fill-in rays.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/scene.js');
const R = require('../js/rays.js');
const Snap = require('../js/snap.js');

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const OPT = { tol: 2, free: false };

function draw(s, r, C, opt = OPT) {
  const sol = R.solveScene(s), pts = sol.rays[r.id].pts, n = pts.length;
  const prop = R.proposeSegment(s, sol, pts[n - 1], n > 1 ? pts[n - 2] : null, C, { ...opt, self: r.id, helper: r.helper });
  assert.ok(prop, 'no proposal');
  r.nodes.push(...prop.nodes);
  return prop;
}
const pts = (s, r) => R.solveScene(s).rays[r.id].pts;
const tip = O => ({ at: { el: O.id, pt: 'tip' } });

/** An object at 2F of a lens, with the parallel and central rays drawn to the image. */
function imaging() {
  const s = S.create();
  const L = S.addLens(s, 0, 50, 40);
  const O = S.addObject(s, -100, 10);
  const a = S.addRay(s, tip(O)), b = S.addRay(s, tip(O));
  a.nodes.push({ dir: { kind: 'parallel' }, end: { kind: 'lens', el: L.id } },
    { dir: { kind: 'through', at: { el: L.id, pt: 'Fp' } }, end: { kind: 'z', z: 140 } });
  b.nodes.push({ dir: { kind: 'through', at: { el: L.id, pt: 'C' } }, end: { kind: 'lens', el: L.id } },
    { dir: { kind: 'straight' }, end: { kind: 'z', z: 140 } });
  return { s, L, O, a, b };
}

test('a ray drawn into an iris blade stops there', () => {
  const s = S.create();
  const I = S.addIris(s, -40);                            // opening ±10, blades to ±30
  S.addLens(s, 0, 50, 40);
  const r = S.addRay(s, { z: -100, y: 15 });
  const p = draw(s, r, { z: 20, y: 15.5 });               // parallel at y = 15: hits the blade
  assert.equal(p.nodes[0].end.el, I.id);
  assert.match(p.text, /blocked by A1/);
  assert.deepEqual(pts(s, r)[1], { z: -40, y: 15 });
  const q = S.addRay(s, { z: -100, y: 5 });               // through the opening: carries on to the lens
  assert.equal(draw(s, q, { z: 20, y: 5.5 }).nodes[0].end.kind, 'lens');
  assert.notEqual(q.nodes[0].end.el, I.id);
});

test('closing an iris clips rays that went through it; opening it gives them back', () => {
  const { s, a, b } = imaging();
  const I = S.addIris(s, -50);                            // at F: the central ray crosses at y = 5
  I.r = 12;
  assert.equal(R.solveScene(s).images.length, 1);
  I.r = 3;                                                // now the central ray (y = 5) is blocked, the parallel ray (y = 10) too
  const sol = R.solveScene(s);
  assert.equal(sol.rays[b.id].blocked, I.id);
  assert.deepEqual(sol.rays[b.id].pts[1], { z: -50, y: 5 });
  assert.equal(sol.images.length, 0);
  I.r = 12;
  assert.equal(R.solveScene(s).rays[b.id].blocked, null);
  void a;
});

test('the centre and edges of an iris are points to aim through', () => {
  const s = S.create();
  const I = S.addIris(s, 0);
  I.r = 8;
  const O = S.addObject(s, -60, 12);
  const r = S.addRay(s, tip(O));
  const p = draw(s, r, { z: 40, y: 5.1 });                // through the top edge (0, 8): y = 8 - 0.0667 z... at 40: 5.33
  assert.deepEqual(p.nodes[0].dir.at, { el: I.id, pt: 'Et' });
  assert.match(p.text, /edge of iris A1/);
  assert.equal(R.solveScene(s).rays[r.id].blocked, null);   // grazing the edge passes
});

test('helper rays ignore irises', () => {
  const s = S.create();
  S.addIris(s, 0);
  const h = S.addRay(s, { z: -50, y: 20 }, true);
  draw(s, h, { z: 50, y: 20 });
  assert.equal(R.solveScene(s).rays[h.id].blocked, null);
  close(pts(s, h)[1].z, 50, 0.5);
});

test('an iris snaps to F of a lens and to an image', () => {
  const { s } = imaging();
  const I = S.addIris(s, 300);
  const extra = R.solveScene(s).images.map(im => ({ value: im.z, text: 'the image' }));
  assert.equal(Snap.snapAxisZ(s, -51, I.id, { tol: 2, grid: 5 }).z, -50);
  const r = Snap.snapAxisZ(s, 101, I.id, { tol: 2, grid: 5, extra });
  assert.equal(r.z, 100); assert.match(r.hit.text, /the image/);
});

test('fill-in rays lie between the two drawn rays and meet at the image', () => {
  const { s, L, a, b } = imaging();
  const sol = R.solveScene(s);
  const fill = R.fillRays(s, sol, 4);
  assert.equal(fill.length, 4);
  const im = sol.images[0];
  fill.forEach(f => {
    const y0 = f.pts[1].y;                                // at the lens: between 0 (central) and 10 (parallel)
    assert.ok(y0 > 0 && y0 < 10);
    assert.equal(f.pts[1].z, L.z);
    const e = f.pts[f.pts.length - 1];
    close(e.z, im.z); close(e.y, im.y);                   // they converge on the image
  });
  // exactly what an ideal lens does with a ray from the tip hitting the lens at that height
  const f = fill[1], h = f.pts[1].y, u = (h - 10) / 100, uOut = u - h / 50;
  close(h + uOut * 100, -10);
  void a; void b;
});

test('fill-in rays follow the drawn ones, and are stopped by an iris', () => {
  const { s, L } = imaging();
  L.f = 40;                                               // image moves to 66.7
  const sol = R.solveScene(s);
  const fill = R.fillRays(s, sol, 3);
  const e = fill[0].pts[fill[0].pts.length - 1];
  close(e.z, sol.images[0].z);
  const I = S.addIris(s, 20);
  I.r = 2;                                                // clips the drawn parallel ray, and some fill
  const after = R.fillRays(s, R.solveScene(s), 3);
  assert.equal(after.length, 3);                          // the bundle is still filled in
  assert.ok(after.some(f => f.pts[f.pts.length - 1].z === 20));          // some stopped at the iris
  assert.ok(after.some(f => f.pts[f.pts.length - 1].z !== 20));          // some through the opening
});

test('no fill without two rays from the same point, and none when n = 0', () => {
  const { s, a, b } = imaging();
  assert.equal(R.fillRays(s, R.solveScene(s), 0).length, 0);
  S.remove(s, b.id);
  assert.equal(R.fillRays(s, R.solveScene(s), 5).length, 0);
  void a;
});

test('a tilted bundle from infinity fills in too', () => {
  const s = S.create();
  const L = S.addLens(s, 0, 50, 40);
  const c = S.addRay(s, { z: -100, y: 10 });
  c.nodes.push({ dir: { kind: 'through', at: { el: L.id, pt: 'C' } }, end: { kind: 'lens', el: L.id } },
    { dir: { kind: 'straight' }, end: { kind: 'z', z: 100 } });
  const b = S.addRay(s, { z: -100, y: 30 });
  b.nodes.push({ dir: { kind: 'parallelTo', ray: c.id, seg: 0 }, end: { kind: 'lens', el: L.id } },
    { dir: { kind: 'through', at: { ray: c.id, seg: 1, plane: { el: L.id, pt: 'Fp' } } }, end: { kind: 'z', z: 100 } });
  const fill = R.fillRays(s, R.solveScene(s), 3);
  assert.equal(fill.length, 3);
  fill.forEach(f => {                                     // parallel coming in, through the focus (50, -5)
    close((f.pts[1].y - f.pts[0].y) / (f.pts[1].z - f.pts[0].z), -0.1);
    const a = f.pts[1], e = f.pts[2];
    close(a.y + (e.y - a.y) * (50 - a.z) / (e.z - a.z), -5);
  });
});

test('irises and the fill setting survive save and load', () => {
  const { s } = imaging();
  const I = S.addIris(s, -50); I.r = 7;
  s.settings.fill = 8;
  const t = S.fromJSON(S.toJSON(s));
  assert.deepEqual(t.elements, s.elements);
  assert.equal(t.settings.fill, 8);
  assert.throws(() => S.fromJSON(JSON.stringify({ elements: [{ id: 'e1', type: 'iris', z: 0, r: -1, ap: 5 }] })), /bad iris/);
});
