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

test('dragging a ray end keeps its line, and stops it on a lens put in its path', () => {
  const s = S.create();
  const L1 = S.addLens(s, 0, 50, 40);
  const r = S.addRay(s, { z: -80, y: 10 });
  r.nodes.push({ dir: { kind: 'parallel' }, end: { kind: 'lens', el: L1.id } },
    { dir: { kind: 'free' }, end: { kind: 'z', z: 200, y: -30 } });       // free angle: slope -0.2
  const L2 = S.addLens(s, 120, 50, 40);                   // now dangles through L2
  let sol = R.solveScene(s), P = sol.rays[r.id].pts;
  const keep = R.keepDir(r.nodes[1], P[1], P[2]);
  assert.deepEqual(keep.dir, { kind: 'slope', u: -0.2 });
  // drag the end back a little, a bit off the line: it snaps to the same line and stops on L2
  const prop = R.proposeSegment(s, sol, P[1], P[0], { z: 170, y: -23.1 }, { ...OPT, self: r.id, keep });
  assert.equal(prop.nodes[0].end.el, L2.id);
  assert.match(prop.text, /same line/);
  r.nodes.splice(1, 1, ...prop.nodes);
  P = R.solveScene(s).rays[r.id].pts;
  close(P[2].z, 120); close(P[2].y, 10 - 0.2 * 120);    // same angle, on L2
});

test('a ray passing straight through a lens can be stopped there, keeping its angle', () => {
  const s = S.create();
  const L1 = S.addLens(s, 0, 50, 40);
  const r = S.addRay(s, { z: -80, y: 10 });
  r.nodes.push({ dir: { kind: 'parallel' }, end: { kind: 'lens', el: L1.id } },
    { dir: { kind: 'through', at: { el: L1.id, pt: 'Fp' } }, end: { kind: 'edge', sgn: 1 } });
  const L2 = S.addLens(s, 150, 50, 40);
  const cr = R.crossings(s, r, R.solveScene(s).rays[r.id]);
  assert.equal(cr.length, 1);
  assert.equal(cr[0].lens.id, L2.id);
  close(cr[0].p.y, 10 - 0.2 * 150);
  assert.equal(R.cutAt(s, r, L2), true);
  assert.deepEqual(r.nodes[1], { dir: { kind: 'through', at: { el: L1.id, pt: 'Fp' } }, end: { kind: 'lens', el: L2.id } });
  assert.equal(R.crossings(s, r, R.solveScene(s).rays[r.id]).length, 0);
  // it still follows: through F′ of L1 as L1 changes, ending on L2
  L1.f = 40;
  const P = R.solveScene(s).rays[r.id].pts;
  close(P[2].z, 150); close(P[2].y, 10 - 10 / 40 * 150);
});

test('helper rays are not offered a stop where they cross a lens', () => {
  const s = S.create();
  S.addLens(s, 0, 50, 40);
  const h = S.addRay(s, { z: -80, y: 5 }, true);
  h.nodes.push({ dir: { kind: 'parallel' }, end: { kind: 'z', z: 80 } });
  assert.equal(R.crossings(s, h, R.solveScene(s).rays[h.id]).length, 0);
});

test('fill-in ignores free points along a ray (a focal ray drawn in two pieces)', () => {
  const { s, L, O } = imaging();
  // a focal ray drawn with a pause before the lens: tip -> through F, stopping at z = -20, then on to the lens
  const f = S.addRay(s, tip(O));
  f.nodes.push({ dir: { kind: 'through', at: { el: L.id, pt: 'F' } }, end: { kind: 'z', z: -20 } },
    { dir: { kind: 'straight' }, end: { kind: 'lens', el: L.id } },
    { dir: { kind: 'parallel' }, end: { kind: 'z', z: 140 } });
  R.extendToImages(s, 1);
  const sol = R.solveScene(s), im = sol.images[0];
  const fill = R.fillRays(s, sol, 5);
  assert.equal(fill.length, 5);
  fill.forEach(fr => {
    assert.equal(fr.pts[1].z, 0);                          // the first bend is at the lens, not in mid-air
    const e = fr.pts[fr.pts.length - 1];
    close(e.z, im.z); close(e.y, im.y);                    // and they all reach the image
  });
});

test('a lamp filament: its ends and middle are sources, and each end forms its own image', () => {
  const s = S.create();
  const L = S.addLens(s, 0, 50, 40);
  const Fl = S.addFilament(s, -100);
  Fl.top = 12; Fl.bottom = -6;
  const sol0 = R.solveScene(s);
  const st = R.proposeStart(s, sol0, { z: -100.4, y: 11.6 }, { ...OPT, grid: 5 });
  assert.deepEqual(st.start, { at: { el: Fl.id, pt: 'top' } });
  assert.match(st.text, /top of the filament/);
  for (const pt of ['top', 'bot']) {
    const y = pt === 'top' ? 12 : -6;
    const a = S.addRay(s, { at: { el: Fl.id, pt } }), b = S.addRay(s, { at: { el: Fl.id, pt } });
    a.nodes.push({ dir: { kind: 'parallel' }, end: { kind: 'lens', el: L.id } },
      { dir: { kind: 'through', at: { el: L.id, pt: 'Fp' } }, end: { kind: 'z', z: 140 } });
    b.nodes.push({ dir: { kind: 'through', at: { el: L.id, pt: 'C' } }, end: { kind: 'lens', el: L.id } },
      { dir: { kind: 'straight' }, end: { kind: 'z', z: 140 } });
    void y;
  }
  const ims = R.solveScene(s).images.map(i => [R.refKey(i.src), i.z, i.y]);
  assert.deepEqual(ims.map(i => i[0]).sort(), [Fl.id + ':bot', Fl.id + ':top']);
  ims.forEach(i => { close(i[1], 100); close(i[2], i[0].endsWith('top') ? -12 : 6); });   // inverted, m = -1
  assert.deepEqual(R.refPos(s, { el: Fl.id, pt: 'mid' }, R.solveScene(s).solver), { z: -100, y: 3 });
});

test('filaments survive save and load, and reject top below bottom', () => {
  const s = S.create();
  const f = S.addFilament(s, 0); f.top = 5; f.bottom = -9; f.color = '#ff0000';
  assert.deepEqual(S.fromJSON(S.toJSON(s)).elements, s.elements);
  assert.throws(() => S.fromJSON(JSON.stringify({ elements: [{ id: 'e1', type: 'filament', z: 0, top: -1, bottom: 2 }] })), /filament ends/);
});

test('a collimated beam brings three rays to the first lens, and they focus at F′', () => {
  const s = S.create();
  const L = S.addLens(s, 0, 50, 40);
  const B = S.addBeam(s, -100, 0);
  B.width = 20;
  const rays = s.rays.filter(r => r.start.at && r.start.at.el === B.id);
  assert.equal(rays.length, 3);
  let sol = R.solveScene(s);
  const ends = rays.map(r => sol.rays[r.id].pts[1]);
  assert.deepEqual(ends.map(p => [p.z, +p.y.toFixed(9)]), [[0, 10], [0, 0], [0, -10]]);
  assert.equal(sol.roles[rays[0].id], 'parallel');
  // continue two of them through F′: they meet at a focus there; fill-in fills the bundle
  for (const r of [rays[0], rays[2]]) r.nodes.push({ dir: { kind: 'through', at: { el: L.id, pt: 'Fp' } }, end: { kind: 'z', z: 100 } });
  sol = R.solveScene(s);
  assert.equal(sol.images.length, 1);
  assert.ok(sol.images[0].focus);
  close(sol.images[0].z, 50); close(sol.images[0].y, 0);
  assert.equal(R.fillRays(s, sol, 4).length, 4);
});

test('a tilted beam keeps reaching whatever lens is first in its way', () => {
  const s = S.create();
  const B = S.addBeam(s, -100, 0);
  B.angle = 5; B.width = 10;
  const mid = s.rays.find(r => r.start.at.pt === 'mid');
  assert.ok(R.solveScene(s).rays[mid.id].pts[1].z > 1000);          // no lens yet: off to the edge
  const L = S.addLens(s, 0, 50, 40);
  let p = R.solveScene(s).rays[mid.id].pts[1];
  close(p.z, 0); close(p.y, 100 * Math.tan(5 * Math.PI / 180));
  // raise the beam so that the middle ray goes through the lens centre
  B.y = -100 * Math.tan(5 * Math.PI / 180);
  p = R.solveScene(s).rays[mid.id].pts[1];
  close(p.y, 0);
  assert.equal(R.solveScene(s).roles[mid.id], 'central');
  void L;
});

test('beams survive save and load', () => {
  const s = S.create();
  const B = S.addBeam(s, -50, 3); B.angle = -2; B.color = '#ff0000';
  const t = S.fromJSON(S.toJSON(s));
  assert.deepEqual(t.elements, s.elements);
  assert.deepEqual(t.rays, s.rays);
});

test('a tilted beam\'s middle ray, straight on through the centre, ends on the back focal plane', () => {
  const s = S.create();
  const L = S.addLens(s, 0, 50, 40);
  const B = S.addBeam(s, -100, 0); B.angle = 5;
  B.y = -100 * Math.tan(5 * Math.PI / 180);                    // middle ray through the centre
  const mid = s.rays.find(r => r.start.at.pt === 'mid');
  const sol = R.solveScene(s), P = sol.rays[mid.id].pts;
  const u = Math.tan(5 * Math.PI / 180);
  const p = R.proposeSegment(s, sol, P[1], P[0], { z: 50.8, y: 50 * u + 0.3 }, { ...OPT, self: mid.id });
  assert.deepEqual(p.nodes[0], { dir: { kind: 'straight' }, end: { kind: 'plane', el: L.id, pt: 'Fp' } });
  assert.match(p.text, /back focal plane of L1/);
  assert.ok(p.hints.some(h => h.plane));
  mid.nodes.push(...p.nodes);
  L.f = 40;                                                    // the end follows the plane
  const q = R.solveScene(s).rays[mid.id].pts;
  close(q[2].z, 40); close(q[2].y, 40 * u);
});

test('deleting an iris that blocks a ray gives the whole ray back (issue #1)', () => {
  const { s, L, b } = imaging();
  const L2 = S.addLens(s, 200, 50, 40);
  b.nodes.length = 0;                                     // a ray through L1 and L2 to the image
  b.nodes.push({ dir: { kind: 'through', at: { el: L.id, pt: 'C' } }, end: { kind: 'lens', el: L.id } },
    { dir: { kind: 'straight' }, end: { kind: 'lens', el: L2.id } },
    { dir: { kind: 'refract', el: L2.id }, end: { kind: 'z', z: 330 } });
  const full = pts(s, b);
  assert.equal(full.length, 4);
  const I = S.addIris(s, 100); I.r = 1;                   // blocks the ray between the lenses
  assert.equal(R.solveScene(s).rays[b.id].blocked, I.id);
  R.bakeRefsTo(s, I.id, S.remove);                        // what deleting the iris does
  S.remove(s, I.id);
  assert.deepEqual(pts(s, b), full);
});
