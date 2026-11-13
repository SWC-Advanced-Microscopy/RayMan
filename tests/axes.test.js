// Several optical axes: each is its own bench, in its own coordinates.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/scene.js');
const R = require('../js/rays.js');

/** Two axes, each with a lens, an object and two rays forming an image. */
function twoBenches() {
  const s = S.create();
  const A = S.addAxis(s, 0), B = S.addAxis(s, 80);
  const on = (x, ax) => { x.axis = ax.id; return x; };
  for (const [ax, f] of [[A, 50], [B, 25]]) {
    const L = on(S.addLens(s, 0, f, 30), ax), O = on(S.addObject(s, -2 * f, 10), ax);
    const a = on(S.addRay(s, { at: { el: O.id, pt: 'tip' } }), ax), b = on(S.addRay(s, { at: { el: O.id, pt: 'tip' } }), ax);
    a.nodes.push({ dir: { kind: 'parallel' }, end: { kind: 'lens', el: L.id } },
      { dir: { kind: 'through', at: { el: L.id, pt: 'Fp' } }, end: { kind: 'z', z: 3 * f } });
    b.nodes.push({ dir: { kind: 'through', at: { el: L.id, pt: 'C' } }, end: { kind: 'lens', el: L.id } },
      { dir: { kind: 'straight' }, end: { kind: 'z', z: 3 * f } });
  }
  return { s, A, B };
}

test('an axis view holds just that axis\'s elements and rays', () => {
  const { s, A, B } = twoBenches();
  const va = S.axisView(s, A.id), vb = S.axisView(s, B.id);
  assert.equal(va.elements.length, 2); assert.equal(vb.elements.length, 2);
  assert.equal(va.rays.length, 2); assert.equal(vb.rays.length, 2);
  assert.ok(va.elements.every(e => e.axis === A.id && e.type !== 'axis'));
});

test('each axis forms its own image, in its own coordinates', () => {
  const { s, A, B } = twoBenches();
  const ia = R.solveScene(S.axisView(s, A.id)).images, ib = R.solveScene(S.axisView(s, B.id)).images;
  assert.equal(ia.length, 1); assert.equal(ib.length, 1);
  assert.deepEqual([ia[0].z, ia[0].y], [100, -10]);       // object at 2F of f = 50
  assert.deepEqual([ib[0].z, ib[0].y], [50, -10]);        // object at 2F of f = 25
  // moving axis B changes nothing in its own coordinates: everything on it moves with it
  B.y = -120;
  const ib2 = R.solveScene(S.axisView(s, B.id)).images;
  assert.deepEqual([ib2[0].z, ib2[0].y], [50, -10]);
});

test('removing through a view writes back to the scene, leaving the other axis alone', () => {
  const { s, A, B } = twoBenches();
  const vb = S.axisView(s, B.id), ray = vb.rays[0];
  R.bakeRefsTo(vb, ray.id, S.remove);
  S.remove(vb, ray.id);
  assert.equal(s.rays.length, 3);
  assert.equal(S.axisView(s, B.id).rays.length, 1);
  assert.equal(S.axisView(s, A.id).rays.length, 2);
});

test('freezing rays through a view keeps them on their axis', () => {
  const { s, A } = twoBenches();
  const va = S.axisView(s, A.id), before = R.solveAll(va);
  R.bakeAll(va);
  assert.deepEqual(R.solveAll(S.axisView(s, A.id)), before);
  assert.equal(s.rays.filter(r => r.axis === A.id).length, 2);
});

test('an old scene with no axes gets one at 0, and everything goes on it', () => {
  const s = S.create();
  S.addLens(s, 0, 50); S.addRay(s, { z: -50, y: 5 });
  S.ensureAxis(s);
  const ax = S.axes(s);
  assert.equal(ax.length, 1); assert.equal(ax[0].y, 0);
  assert.ok(s.elements.filter(e => e.type !== 'axis').every(e => e.axis === ax[0].id));
  assert.ok(s.rays.every(r => r.axis === ax[0].id));
  assert.equal(S.ensureAxis(s).elements.filter(e => e.type === 'axis').length, 1);   // idempotent
});

test('axes and membership survive save and load; bounds ignore the axes', () => {
  const { s, A, B } = twoBenches();
  const t = S.fromJSON(S.toJSON(s));
  assert.deepEqual(t.elements, s.elements);
  assert.deepEqual(t.rays, s.rays);
  assert.deepEqual(S.bounds(S.axisView(t, B.id)), { z0: -50, z1: 25, y0: -30, y1: 30 });
  void A;
  assert.throws(() => S.fromJSON(JSON.stringify({ elements: [{ id: 'e1', type: 'axis', y: 'high' }] })), /axis height/);
});

test('each axis numbers its own lenses from L1', () => {
  const s = S.create();
  const A = S.addAxis(s, 0), B = S.addAxis(s, 60);
  assert.equal(S.addLens(s, 0, 50, 20, A.id).label, 'L1');
  assert.equal(S.addLens(s, 100, 50, 20, A.id).label, 'L2');
  assert.equal(S.addLens(s, 0, 50, 20, B.id).label, 'L1');
  assert.equal(S.addMirror(s, -50, B.id).label, 'M1');
});
