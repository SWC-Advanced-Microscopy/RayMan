const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/scene.js');
const R = require('../js/rays.js');

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const OPT = { tol: 2, free: false };

/** Draw one segment of ray r toward cursor C, as the app does, and return the proposal. */
function draw(s, r, C, opt = OPT) {
  const sol = R.solveAll(s)[r.id], n = sol.pts.length;
  const prop = R.proposeSegment(s, R.solveScene(s), sol.pts[n - 1], n > 1 ? sol.pts[n - 2] : null, C, opt);
  assert.ok(prop, 'no proposal');
  r.nodes.push(...prop.nodes);
  return prop;
}
const pts = (s, r) => R.solveAll(s)[r.id].pts;

function bench() {
  const s = S.create();
  const L = S.addLens(s, 0, 50);
  const O = S.addObject(s, -100, 10);
  return { s, L, O };
}

test('step 5: a ray from the left snaps parallel to the axis and stops on the lens', () => {
  const { s, L } = bench();
  const r = S.addRay(s, { z: -80, y: 10 });
  const p = draw(s, r, { z: 20, y: 11 });           // cursor past the lens, a little high
  assert.equal(p.axis, true);
  assert.deepEqual(p.node, { dir: { kind: 'parallel' }, end: { kind: 'lens', el: L.id } });
  assert.deepEqual(pts(s, r)[1], { z: 0, y: 10 });
});

test('step 6: from the lens, the ray snaps through F′ and highlights it', () => {
  const { s, L } = bench();
  const r = S.addRay(s, { z: -80, y: 10 });
  draw(s, r, { z: 20, y: 10 });
  // F′ is at (50, 0); the line from (0, 10) to (100, -10) passes through it. Nudge it a bit.
  const p = draw(s, r, { z: 100, y: -9 });
  assert.deepEqual(p.node.dir, { kind: 'through', at: { el: L.id, pt: 'Fp' } });
  assert.deepEqual(p.hints[0], { z: 50, y: 0, text: 'through F′ of L1' });
  const q = pts(s, r)[2];
  close(q.y, 10 + (-10 / 50) * (q.z - 0));
});

test('step 7: a ray from the object tip through the lens centre carries straight on', () => {
  const { s, L, O } = bench();
  const st = R.proposeStart(s, R.solveScene(s), { z: -100.5, y: 10.4 }, { ...OPT, grid: 5 });
  assert.deepEqual(st.start, { at: { el: O.id, pt: 'tip' } });
  const r = S.addRay(s, st.start);
  const p1 = draw(s, r, { z: 0.5, y: 0.6 });         // near the centre
  assert.deepEqual(p1.node.dir, { kind: 'through', at: { el: L.id, pt: 'C' } });
  const p2 = draw(s, r, { z: 100, y: -10.8 });       // straight on would be y = -10
  assert.ok(['straight', 'through'].includes(p2.node.dir.kind));
  close(pts(s, r)[2].y, -pts(s, r)[2].z / 10);
});

test('a ray that misses the lens aperture does not stop on it', () => {
  const { s } = bench();
  const r = S.addRay(s, { z: -80, y: 40 });          // aperture is 25
  const p = draw(s, r, { z: 30, y: 40 });
  assert.equal(p.node.end.kind, 'z');
});

test('a ray short of the lens ends at the cursor (projected onto the snapped line)', () => {
  const { s } = bench();
  const r = S.addRay(s, { z: -80, y: 10 });
  const p = draw(s, r, { z: -40, y: 11 });
  assert.deepEqual(p.node, { dir: { kind: 'parallel' }, end: { kind: 'z', z: -40 } });
});

test('Alt (free) draws exactly to the cursor with no snapping', () => {
  const { s } = bench();
  const r = S.addRay(s, { z: -80, y: 10 });
  const p = draw(s, r, { z: -40, y: 11 }, { ...OPT, free: true });
  assert.deepEqual(p.node, { dir: { kind: 'free' }, end: { kind: 'z', z: -40, y: 11 } });
});

test('rays follow when the lens moves and f changes', () => {
  const { s, L } = bench();
  const r = S.addRay(s, { z: -80, y: 10 });
  draw(s, r, { z: 20, y: 10 });
  draw(s, r, { z: 100, y: -10 });                    // through F′, ends at z = 100
  L.z = 20; L.f = 40;                                // F′ now at 60
  const p = pts(s, r);
  assert.deepEqual(p[1], { z: 20, y: 10 });
  close(p[2].y, 10 - 10 / 40 * (100 - 20));         // still through the new F′
});

test('baking freezes rays where they are; then moving the lens leaves them alone', () => {
  const { s, L } = bench();
  const r = S.addRay(s, { z: -80, y: 10 });
  draw(s, r, { z: 20, y: 10 });
  draw(s, r, { z: 100, y: -10 });
  const before = pts(s, r);
  R.bakeAll(s);
  assert.deepEqual(pts(s, r), before);
  L.z = 30; L.f = 20;
  assert.deepEqual(pts(s, r), before);
});

test('deleting a lens frees the rays pinned to it but keeps their shape', () => {
  const { s, L, O } = bench();
  const r = S.addRay(s, { at: { el: O.id, pt: 'tip' } });
  draw(s, r, { z: 0.3, y: 0.2 });                    // through the centre, onto the lens
  draw(s, r, { z: 80, y: -8 });                      // straight on
  const before = pts(s, r);
  R.bakeRefsTo(s, L.id, S.remove);
  S.remove(s, L.id);
  assert.deepEqual(pts(s, r), before);
  assert.equal(R.solveAll(s)[r.id].ok, true);
});

test('a ray can be pinned to a point on another ray and follows it', () => {
  const { s, L } = bench();
  const a = S.addRay(s, { z: -80, y: 10 });
  draw(s, a, { z: 20, y: 10 });                      // node 1 at (0, 10) on the lens
  const st = R.proposeStart(s, R.solveScene(s), { z: 0.4, y: 10.3 }, { ...OPT, grid: 5 });
  assert.deepEqual(st.start, { at: { ray: a.id, k: 1 } });
  const b = S.addRay(s, st.start);
  draw(s, b, { z: 60, y: 30 }, { ...OPT, free: true });
  assert.equal(R.solveAll(s)[b.id].lens[0], L.id);  // it knows it starts on the lens
  a.start.y = 20;                                    // move ray a up: b's start follows
  assert.deepEqual(pts(s, b)[0], { z: 0, y: 20 });
});

test('double-click extension goes to the next lens, else to the edge', () => {
  const { s, L } = bench();
  const L2 = S.addLens(s, 150, 50);
  const r = S.addRay(s, { z: -80, y: 10 });
  draw(s, r, { z: 20, y: 10 });
  draw(s, r, { z: 50.5, y: 0.5 });                   // ends on F′ itself
  const P = pts(s, r);
  let n = R.extendNode(s, r.nodes[1], P[1], P[2], 2);
  assert.deepEqual(n.end, { kind: 'lens', el: L2.id });
  r.nodes[1] = n;
  close(pts(s, r)[2].y, 10 - 10 / 50 * 150);
  S.remove(s, L2.id);
  n = R.extendNode(s, { dir: { kind: 'free' }, end: { kind: 'z', z: 60, y: -2 } }, P[1], { z: 60, y: -2 }, 2);
  assert.deepEqual(n.end, { kind: 'edge', sgn: 1 });
  assert.equal(n.dir.kind, 'slope');
  void L;
});

test('4f: the parallel ray through F′ of L1 reaches L2 and leaves parallel through F′2', () => {
  const s = S.create();
  const L1 = S.addLens(s, 0, 50), L2 = S.addLens(s, 100, 50);
  const r = S.addRay(s, { z: -60, y: 10 });
  draw(s, r, { z: 10, y: 10 });                      // parallel, to L1
  const p = draw(s, r, { z: 120, y: -14 });          // through F′1 = F2 (50, 0), stops at L2
  assert.equal(p.node.end.el, L2.id);
  close(pts(s, r)[2].y, -10);
  const p3 = draw(s, r, { z: 160, y: -10.5 });       // parallel out
  assert.equal(p3.axis, true);
  void L1;
});

test('scenes with rays survive save and load', () => {
  const { s, O } = bench();
  const r = S.addRay(s, { at: { el: O.id, pt: 'tip' } });
  draw(s, r, { z: 20, y: 10 });
  const t = S.fromJSON(S.toJSON(s));
  assert.deepEqual(t.rays, s.rays);
  assert.deepEqual(R.solveAll(t), R.solveAll(s));
  assert.throws(() => S.fromJSON(JSON.stringify({ elements: [], rays: [{ id: 'r1', start: { z: 0, y: 0 }, nodes: [{ dir: { kind: 'zigzag' }, end: { kind: 'z', z: 1 } }] }] })), /bad segment/);
});

test('#10 a lens cannot be made smaller than the rays through it', () => {
  const { s, L } = bench();
  assert.equal(R.minAperture(s, L.id), 0);
  const r = S.addRay(s, { z: -80, y: 18 });
  draw(s, r, { z: 20, y: 19 });
  close(R.minAperture(s, L.id), 18);
});
