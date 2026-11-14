// Phase 4: parallel-to-a-ray snapping, focal-plane points, light from infinity, helper rays,
// and the scan mirror.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/scene.js');
const R = require('../js/rays.js');
const Snap = require('../js/snap.js');

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const OPT = { tol: 2, free: false };

/** Draw one segment of ray r toward cursor C (as the app does). */
function draw(s, r, C, opt = OPT) {
  const sol = R.solveScene(s), pts = sol.rays[r.id].pts, n = pts.length;
  const prop = R.proposeSegment(s, sol, pts[n - 1], n > 1 ? pts[n - 2] : null, C, { ...opt, self: r.id });
  assert.ok(prop, 'no proposal');
  r.nodes.push(...prop.nodes);
  return prop;
}
const pts = (s, r) => R.solveScene(s).rays[r.id].pts;

/** A tilted bundle: a central ray from the left at slope -0.1 through the lens centre, then a
    second ray drawn parallel to it. */
function bundle() {
  const s = S.create();
  const L = S.addLens(s, 0, 50, 40);
  const c = S.addRay(s, { z: -100, y: 10 });
  c.nodes.push({ dir: { kind: 'through', at: { el: L.id, pt: 'C' } }, end: { kind: 'lens', el: L.id } },
    { dir: { kind: 'straight' }, end: { kind: 'z', z: 150 } });
  const b = S.addRay(s, { z: -100, y: 0 });
  return { s, L, c, b };
}

test('a ray snaps parallel to another ray', () => {
  const { s, c, b } = bundle();
  const p = draw(s, b, { z: 0, y: -9.6 });               // slope -0.1 would reach y = -10
  assert.deepEqual(p.nodes[0].dir, { kind: 'parallelTo', ray: c.id, seg: 0 });
  assert.equal(p.text.indexOf('parallel to that ray'), 0);
  assert.ok(p.hints.some(h => h.seg));                   // the reference ray is highlighted
  close(pts(s, b)[1].y, -10);
});

test('where a ray crosses a focal plane is a point to aim through', () => {
  const { s, L, c, b } = bundle();
  draw(s, b, { z: 0, y: -9.6 });                         // parallel to c, onto the lens at y = -10
  // c crosses the back focal plane (z = 50) at y = -5: aim b's next segment through it
  const p = draw(s, b, { z: 100, y: 0.6 });
  assert.deepEqual(p.nodes[0].dir, { kind: 'through', at: { ray: c.id, seg: 1, plane: { el: L.id, pt: 'Fp' } } });
  assert.match(p.text, /back focal plane of L1/);
  assert.ok(p.hints[0].plane);                           // the plane is drawn while snapping
  const q = pts(s, b);
  close(q[2].y, -10 + 0.1 * q[2].z);
});

test('parallel rays from free points come from one point at infinity, and form a focus', () => {
  const { s, L, c, b } = bundle();
  draw(s, b, { z: 0, y: -9.6 });
  draw(s, b, { z: 100, y: 0.6 });
  assert.equal(R.refKey(R.raySource(s, b)), R.refKey(R.raySource(s, c)));
  const ims = R.solveScene(s).images;
  assert.equal(ims.length, 1);
  assert.equal(ims[0].focus, true);
  close(ims[0].z, 50); close(ims[0].y, -5);              // height f·tanθ in the back focal plane
  assert.equal(R.solveScene(s).rays[c.id].trimmed, false);   // a focus does not cut the beam
  // tilt the bundle: the focus moves along the focal plane, and b follows
  c.start.y = 20;
  const im = R.solveScene(s).images[0];
  close(im.z, 50); close(im.y, -10);
  void L;
});

test('rays drawn parallel to the axis from free points focus at F′', () => {
  const s = S.create();
  const L = S.addLens(s, 0, 50, 40);
  const r1 = S.addRay(s, { z: -80, y: 10 }), r2 = S.addRay(s, { z: -80, y: -6 });
  for (const [r, y] of [[r1, 10], [r2, -6]]) {
    r.nodes.push({ dir: { kind: 'parallel' }, end: { kind: 'lens', el: L.id } },
      { dir: { kind: 'through', at: { el: L.id, pt: 'Fp' } }, end: { kind: 'z', z: 120 } });
    void y;
  }
  const im = R.solveScene(s).images[0];
  assert.ok(im.focus);
  close(im.z, 50); close(im.y, 0);
});

test('a helper ray through the centre, parallel to a ray, shows where that ray goes', () => {
  const s = S.create();
  const L = S.addLens(s, 0, 50, 40);
  const O = S.addObject(s, -100, 10);
  const r = S.addRay(s, { at: { el: O.id, pt: 'tip' } });
  r.nodes.push({ dir: { kind: 'free' }, end: { kind: 'lens', el: L.id, y: 4 } });     // an arbitrary ray, slope -0.06
  const h = S.addRay(s, { at: { el: L.id, pt: 'C' } }, true);
  const ph = draw(s, h, { z: 100, y: -5.7 });            // parallel to r
  assert.deepEqual(ph.nodes[0].dir, { kind: 'parallelTo', ray: r.id, seg: 0 });
  // r leaves the lens through the point where the helper crosses the back focal plane: (50, -3)
  const pr = draw(s, r, { z: 100, y: -9.8 });
  assert.deepEqual(pr.nodes[0].dir.at, { ray: h.id, seg: 0, plane: { el: L.id, pt: 'Fp' } });
  const q = pts(s, r);
  close(4 + (q[2].z) * (-3 - 4) / 50, q[2].y);           // through (50, -3)
  // the result agrees with the lens equation: image of the tip at v = 100, y = -10
  close(4 + 100 * (-3 - 4) / 50, -10);
  const sol = R.solveScene(s);
  assert.equal(R.raySource(s, h), null);                 // helpers make no images
  assert.equal(sol.roles[h.id], null);
});

test('a ray goes through the scan mirror, tilted by it, and follows when the mirror turns', () => {
  const s = S.create();
  const M = S.addMirror(s, -50);
  const L = S.addLens(s, 0, 50, 40);                     // scan lens with F on the mirror
  M.tilt = 5;
  const r = S.addRay(s, { z: -150, y: 0 });
  const t = Math.tan(5 * Math.PI / 180);
  const p = draw(s, r, { z: 10, y: 0.5 });                // parallel to the axis, on through the mirror to L
  assert.equal(r.nodes[0].end.el, M.id);
  assert.deepEqual(p.nodes[1].dir, { kind: 'deflect', el: M.id });
  assert.equal(p.nodes[1].end.el, L.id);
  assert.match(p.text, /through M1, tilted 5°, to L1/);
  close(pts(s, r)[2].y, 50 * t);
  draw(s, r, { z: 60, y: 50 * t + 0.3 });                 // parallel after the scan lens (it came from F)
  M.tilt = 10;
  const q = pts(s, r);
  close(q[2].y, 50 * Math.tan(10 * Math.PI / 180));
  close(q[3].y, q[2].y);                                  // still parallel: pivot at the front focal plane
});

test('a click on the scan mirror sends the ray on through it to the next lens', () => {
  const s = S.create();
  const M = S.addMirror(s, -50);
  const L = S.addLens(s, 0, 50, 40);
  M.tilt = -3;
  const r = S.addRay(s, { z: -150, y: 4 });
  const p = draw(s, r, { z: -50.5, y: 4.3 });
  assert.equal(p.nodes.length, 2);
  assert.deepEqual(p.nodes[1], { dir: { kind: 'deflect', el: M.id }, end: { kind: 'next' }, pass: true });
  const q = pts(s, r);
  assert.equal(q[2].z, L.z);
  close(q[2].y, 4 + 50 * Math.tan(-3 * Math.PI / 180));
});

test('from a ray ending on the mirror, the only way on is through it, tilted', () => {
  const s = S.create();
  const M = S.addMirror(s, 0);
  M.tilt = 4;
  const r = S.addRay(s, { z: -100, y: 2 });
  r.nodes.push({ dir: { kind: 'parallel' }, end: { kind: 'lens', el: M.id } });   // as saved before
  const p = draw(s, r, { z: 80, y: 30 });                  // aimed anywhere to the right
  assert.deepEqual(p.nodes[0].dir, { kind: 'deflect', el: M.id });
  close(pts(s, r)[2].y, 2 + (p.p.z) * Math.tan(4 * Math.PI / 180));
  const sol = R.solveScene(s), P = pts(s, r)[1];
  assert.equal(R.proposeSegment(s, sol, P, { z: -100, y: 2 }, { z: -20, y: 2 }, OPT), null);   // not backwards
});

test('a collimated beam passes through a scan mirror placed in its way, and scans', () => {
  const s = S.create();
  const B = S.addBeam(s, -150, 0);                       // three rays at y = 10, 0, -10, to the next lens
  const L = S.addLens(s, 0, 50, 40);
  const M = S.addMirror(s, -50);
  M.tilt = 2;
  assert.equal(R.passMirrors(s), true);
  assert.equal(R.passMirrors(s), false);                  // once is enough
  const sol = R.solveScene(s), u = Math.tan(2 * Math.PI / 180);
  s.rays.forEach(r => {
    const q = sol.rays[r.id].pts;
    assert.equal(q.length, 3);
    assert.equal(q[1].z, M.z);
    assert.equal(q[2].z, L.z);
    close(q[2].y, q[1].y + 50 * u);
  });
  M.tilt = -2;                                            // scanning: the beam swings the other way
  s.rays.forEach(r => { const q = pts(s, r); close(q[2].y, q[1].y - 50 * u); });
  M.z = 50;                                               // moved behind the lens: the beam just meets the lens
  assert.equal(R.passMirrors(s), true);
  s.rays.forEach(r => { assert.equal(r.nodes.length, 1); assert.equal(pts(s, r)[1].z, L.z); });
  void B;
});

test('helper rays pass the scan mirror undeviated', () => {
  const s = S.create();
  const M = S.addMirror(s, -50);
  M.tilt = 5;
  const h = S.addRay(s, { z: -150, y: 0 }, true);
  draw(s, h, { z: 10, y: 0.5 }, { ...OPT, helper: true });
  assert.equal(R.passMirrors(s), false);
  assert.ok(pts(s, h).every(p => Math.abs(p.y) < 1e-9));
});

test('a ray can start at the mirror pivot and leave at the mirror angle', () => {
  const s = S.create();
  const M = S.addMirror(s, 0);
  M.tilt = -4;
  const st = R.proposeStart(s, R.solveScene(s), { z: 0.5, y: 0.3 }, { ...OPT, grid: 5 });
  assert.deepEqual(st.start, { at: { el: M.id, pt: 'P' } });
  const r = S.addRay(s, st.start);
  const u = Math.tan(-4 * Math.PI / 180);
  const p = draw(s, r, { z: 80, y: 80 * u + 0.5 });
  assert.equal(p.nodes[0].dir.kind, 'deflect');
});

test('a lens snaps its F onto the scan mirror', () => {
  const s = S.create();
  S.addMirror(s, -50);
  const L = S.addLens(s, 100, 50);
  const r = Snap.snapLensZ(s, L, 1.2, { tol: 2, grid: 5 });
  assert.equal(r.z, 0);
  assert.match(r.hit.text, /F on the scan mirror/);
});

test('deleting a ray that another is drawn parallel to keeps the other in place', () => {
  const { s, c, b } = bundle();
  draw(s, b, { z: 0, y: -9.6 });
  const before = pts(s, b);
  R.bakeRefsTo(s, c.id, S.remove);
  S.remove(s, c.id);
  assert.deepEqual(pts(s, b), before);
});

test('removing a segment frees rays aimed at its focal-plane crossing', () => {
  const { s, c, b } = bundle();
  draw(s, b, { z: 0, y: -9.6 });
  draw(s, b, { z: 100, y: 0.6 });                        // through c's segment 1 at the BFP
  const before = pts(s, b);
  R.bake(s, ref => ref.ray === c.id && (ref.k === 2 || ref.seg === 1));   // c's last point / segment 1 (as trimRay does)
  c.nodes.pop();
  assert.deepEqual(pts(s, b), before);
});

test('mirrors, helpers and the new pins survive save and load', () => {
  const { s, c, b } = bundle();
  draw(s, b, { z: 0, y: -9.6 });
  draw(s, b, { z: 100, y: 0.6 });
  const M = S.addMirror(s, -200);
  M.tilt = 3;
  const h = S.addRay(s, { at: { el: M.id, pt: 'P' } }, true);
  h.nodes.push({ dir: { kind: 'deflect', el: M.id }, end: { kind: 'z', z: -150 } });
  const t = S.fromJSON(S.toJSON(s));
  assert.deepEqual(t.rays, s.rays);
  assert.deepEqual(t.elements, s.elements);
  assert.deepEqual(R.solveAll(t), R.solveAll(s));
  void c;
});

test('a ray ending at a lens centre can only carry straight on', () => {
  const s = S.create();
  const L = S.addLens(s, 0, 50, 40);
  const O = S.addObject(s, -100, 10);
  const r = S.addRay(s, { at: { el: O.id, pt: 'tip' } });
  draw(s, r, { z: 0.5, y: 0.5 });                         // stop at the centre
  const p = draw(s, r, { z: 80, y: 20 });                 // try to bend it: not possible
  assert.equal(p.nodes[0].dir.kind, 'straight');
  assert.match(p.text, /straight on through the centre of L1/);
  const q = pts(s, r);
  close(q[2].y, -q[2].z / 10);
  // the centre is a joint, not a node: the two parts are one segment
  assert.equal(R.isJoint(s, r, R.solveScene(s).rays[r.id], 1), true);
  // going backwards from the centre is not offered at all
  const sol = R.solveScene(s), P = sol.rays[r.id].pts;
  assert.equal(R.proposeSegment(s, sol, P[1], P[0], { z: -50, y: 5 }, { ...OPT, self: r.id }), null);
  void L;
});

test('a ray starting at a lens centre (a helper) can still go any way', () => {
  const s = S.create();
  const L = S.addLens(s, 0, 50, 40);
  const h = S.addRay(s, { at: { el: L.id, pt: 'C' } }, true);
  const p = draw(s, h, { z: 80, y: 20 }, { ...OPT, free: true });
  assert.equal(p.nodes[0].dir.kind, 'free');
});

test('segments lengthened by RayMan are marked, so they can be shown as provisional', () => {
  const s = S.create();
  const L = S.addLens(s, 0, 50, 40);
  const O = S.addObject(s, -100, 10);
  const a = S.addRay(s, { at: { el: O.id, pt: 'tip' } }), b = S.addRay(s, { at: { el: O.id, pt: 'tip' } });
  a.nodes.push({ dir: { kind: 'parallel' }, end: { kind: 'lens', el: L.id } },
    { dir: { kind: 'through', at: { el: L.id, pt: 'Fp' } }, end: { kind: 'z', z: 120 } });
  b.nodes.push({ dir: { kind: 'through', at: { el: L.id, pt: 'C' } }, end: { kind: 'lens', el: L.id } },
    { dir: { kind: 'straight' }, end: { kind: 'z', z: 120 } });
  R.extendToImages(s, 1);
  assert.equal(a.nodes[1].auto, true);
  assert.equal(R.solveScene(s).rays[a.id].trimmed, true);
  S.remove(s, b.id);                                     // the image goes; a is no longer trimmed
  assert.equal(R.solveScene(s).rays[a.id].trimmed, false);
  assert.equal(S.fromJSON(S.toJSON(s)).rays[0].nodes[1].auto, true);   // remembered across save/load
});

test('a helper ray passes through lenses unless it is ended right at one', () => {
  const s = S.create();
  const L1 = S.addLens(s, 0, 50, 40), L2 = S.addLens(s, 100, 50, 40);
  const h = S.addRay(s, { z: -80, y: 8 }, true);
  const HOPT = { ...OPT, helper: true };
  let p = draw(s, h, { z: 160, y: -16.4 }, HOPT);          // through L1's centre and on, past L2 (off any focal plane)
  assert.equal(p.nodes.length, 1);
  assert.deepEqual(p.nodes[0].dir, { kind: 'through', at: { el: L1.id, pt: 'C' } });
  assert.equal(p.nodes[0].end.kind, 'z');
  close(R.solveScene(s).rays[h.id].pts[1].z, 160, 0.5);
  // ended right at a lens, it stops there
  const g = S.addRay(s, { z: -80, y: -8 }, true);
  p = draw(s, g, { z: 100.5, y: 3 }, HOPT);
  assert.equal(p.nodes[0].end.kind, 'lens');
  assert.equal(p.nodes[0].end.el, L2.id);
  // ordinary rays still stop at the first lens
  const r = S.addRay(s, { z: -80, y: 8 });
  assert.equal(draw(s, r, { z: 150, y: -15.4 }).nodes[0].end.el, L1.id);
  // double-click extension of a helper goes to the edge, not the next lens
  const E = R.extendNode(s, { dir: { kind: 'free' }, end: { kind: 'z', z: 20, y: 0 } }, { z: -80, y: 0 }, { z: 20, y: 0 }, 1, true);
  assert.deepEqual(E.end, { kind: 'edge', sgn: 1 });
});

test('reversing a ray keeps its line and its pins, and flips its direction', () => {
  const s = S.create();
  const L = S.addLens(s, 0, 50, 40);
  const r = S.addRay(s, { z: -80, y: 10 });
  r.nodes.push({ dir: { kind: 'parallel' }, end: { kind: 'lens', el: L.id } },
    { dir: { kind: 'through', at: { el: L.id, pt: 'Fp' } }, end: { kind: 'z', z: 120 } });
  const before = pts(s, r);
  assert.equal(R.reverseRay(s, r), true);
  const after = pts(s, r);
  assert.deepEqual(after.map(p => [+p.z.toFixed(9), +p.y.toFixed(9)]), before.slice().reverse().map(p => [+p.z.toFixed(9), +p.y.toFixed(9)]));
  assert.deepEqual(r.nodes[0].dir, { kind: 'through', at: { el: L.id, pt: 'Fp' } });
  assert.deepEqual(r.nodes[0].end, { kind: 'lens', el: L.id });
  // still pinned: change f and it still passes through (the new) F′, then leaves parallel
  L.f = 40;
  const q = pts(s, r);
  close(q[0].y + (q[1].y - q[0].y) * (40 - q[0].z) / (q[1].z - q[0].z), 0);
  close(q[2].y, q[1].y);
});

test('a line drawn outwards from a lens centre, reversed, ends at the centre and continues straight', () => {
  const s = S.create();
  const L = S.addLens(s, 0, 50, 40);
  const h = S.addRay(s, { at: { el: L.id, pt: 'C' } });
  h.nodes.push({ dir: { kind: 'free' }, end: { kind: 'z', z: -100, y: 20 } });     // drawn backwards, to the left
  R.reverseRay(s, h);
  assert.deepEqual(h.start, { z: -100, y: 20 });
  assert.deepEqual(h.nodes[0].end, { kind: 'at', at: { el: L.id, pt: 'C' } });
  // continuing from its (new) end at the centre is locked to straight on
  const sol = R.solveScene(s), P = sol.rays[h.id].pts;
  const p = R.proposeSegment(s, sol, P[1], P[0], { z: 80, y: 30 }, { ...OPT, self: h.id });
  assert.equal(p.nodes[0].dir.kind, 'straight');
  close(pts(s, h).length, 2);
});

test('reversing keeps a through-the-centre line one straight segment, and renumbers rays pinned to it', () => {
  const s = S.create();
  const L = S.addLens(s, 0, 50, 40);
  const O = S.addObject(s, -100, 10);
  const r = S.addRay(s, { at: { el: O.id, pt: 'tip' } });
  r.nodes.push({ dir: { kind: 'through', at: { el: L.id, pt: 'C' } }, end: { kind: 'lens', el: L.id } },
    { dir: { kind: 'straight' }, end: { kind: 'z', z: 100 } });
  const b = S.addRay(s, { at: { ray: r.id, k: 2 } });                                // pinned to r's end
  b.nodes.push({ dir: { kind: 'free' }, end: { kind: 'z', z: 150, y: 0 } });
  const bStart = pts(s, b)[0];
  R.reverseRay(s, r);
  assert.deepEqual(r.start, { z: 100, y: -10 });
  assert.equal(r.nodes[1].dir.kind, 'straight');                                 // straight on moved to the other piece
  assert.equal(R.isJoint(s, r, R.solveScene(s).rays[r.id], 1), true);
  assert.deepEqual(r.nodes[1].end, { kind: 'at', at: { el: O.id, pt: 'tip' } });
  assert.deepEqual(b.start.at, { ray: r.id, k: 0 });
  assert.deepEqual(pts(s, b)[0], bStart);
});

test('the "parallel to that ray" glow covers the whole straight line through a lens centre', () => {
  const s = S.create();
  const L = S.addLens(s, 0, 50, 40);
  const c = S.addRay(s, { z: -100, y: 10 });
  c.nodes.push({ dir: { kind: 'through', at: { el: L.id, pt: 'C' } }, end: { kind: 'lens', el: L.id } },
    { dir: { kind: 'straight' }, end: { kind: 'z', z: 100 } });
  const b = S.addRay(s, { z: -100, y: 30 });
  const p = draw(s, b, { z: -60, y: 26.2 });                // parallel to c (slope -0.1), short of the lens
  const h = p.hints.find(x => x.seg);
  assert.deepEqual([h.seg.a.z, h.seg.b.z], [-100, 100]);   // from c's start to its end, across the centre
});

test('parallel to several rays at once: all are highlighted, and the helper is the one remembered', () => {
  const { s, L, c } = bundle();                            // c: slope -0.1 through the centre
  const h = S.addRay(s, { z: -100, y: -20 }, true);        // a helper parallel to c
  h.nodes.push({ dir: { kind: 'parallelTo', ray: c.id, seg: 0 }, end: { kind: 'z', z: -50 } });
  const d = S.addRay(s, { z: -100, y: 30 });               // a ray parallel to the helper
  d.nodes.push({ dir: { kind: 'parallelTo', ray: h.id, seg: 0 }, end: { kind: 'z', z: -50 } });
  const b = S.addRay(s, { z: -100, y: 20 });
  // anywhere along the line, and from either side of it, the same snap: no flicker
  [{ z: -70, y: 17.3 }, { z: -60, y: 15.8 }, { z: -55, y: 15.6 }, { z: -65, y: 16.2 }].forEach(C => {
    const sol = R.solveScene(s);
    const p = R.proposeSegment(s, sol, { z: -100, y: 20 }, null, C, { ...OPT, self: b.id });
    assert.deepEqual(p.nodes[0].dir, { kind: 'parallelTo', ray: h.id, seg: 0 });
    assert.match(p.text, /^parallel to those rays/);
    assert.equal(p.hints.filter(x => x.seg).length, 3);    // c, the helper and d all glow
  });
  void L;
});

test('parallel to a helper ray is a strong snap: the helper was drawn to be used', () => {
  // A ray from (-50, -2) in the front focal plane, and a helper from there through the centre:
  // the ray leaves parallel to the helper (slope 0.04). Near the axis, other snaps compete.
  const s = S.create();
  const L = S.addLens(s, 0, 50, 40);
  const r = S.addRay(s, { z: -100, y: -7 });
  r.nodes.push({ dir: { kind: 'free' }, end: { kind: 'lens', el: L.id, y: 3 } });
  const h = S.addRay(s, { z: -50, y: -2 }, true);
  h.nodes.push({ dir: { kind: 'through', at: { el: L.id, pt: 'C' } }, end: { kind: 'z', z: 80 } });
  const propose = () => R.proposeSegment(s, R.solveScene(s), { z: 0, y: 3 }, { z: -100, y: -7 }, { z: 50, y: 4 },
    { tol: 6, free: false, self: r.id, inDir: { kind: 'free' } });
  const p = propose();
  assert.match(p.text, /^parallel to that ray \(bent by L1\)/);
  assert.deepEqual(p.nodes[0].dir, { kind: 'refract', el: L.id });   // stays right as things move
  assert.equal(p.hints.filter(x => x.seg).length, 1);                // the helper glows
  h.helper = false;                                                  // an ordinary ray is only a weak snap
  assert.match(propose().text, /^parallel to the axis/);
});
