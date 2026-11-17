const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/scene.js');
const Snap = require('../js/snap.js');

const OPT = { tol: 2, grid: 5, free: false };

function bench() {
  const s = S.create();
  const L1 = S.addLens(s, 0, 50);
  const O = S.addObject(s, -120, 15);
  return { s, L1, O };
}

test('lenses get the first free label', () => {
  const s = S.create();
  const a = S.addLens(s, 0), b = S.addLens(s, 100);
  assert.equal(a.label, 'L1'); assert.equal(b.label, 'L2');
  S.remove(s, a.id);
  assert.equal(S.addLens(s, 200).label, 'L1');
  assert.notEqual(a.id, b.id);
});

test('save and load round-trips and keeps ids unique afterwards', () => {
  const { s } = bench();
  S.addPoint(s, 30, 4);
  const t = S.fromJSON(S.toJSON(s));
  assert.deepEqual(t.elements, s.elements);
  const n = S.addLens(t, 300);
  assert.ok(!s.elements.some(e => e.id === n.id));
});

test('loading rejects broken files with a readable reason', () => {
  assert.throws(() => S.fromJSON('nope'), /not valid JSON/);
  assert.throws(() => S.fromJSON('{"elements":[{"id":"e1","type":"lens","z":0,"f":0,"ap":5}]}'), /focal length/);
  assert.throws(() => S.fromJSON('{"elements":[{"id":"e1","type":"prism","z":0}]}'), /unknown type/);
  assert.throws(() => S.fromJSON('{"elements":[{"id":"e1","type":"point","z":0,"y":0},{"id":"e1","type":"point","z":1,"y":0}]}'), /repeated id/);
});

test('history undoes and redoes, and ignores unchanged snapshots', () => {
  const h = new S.History();
  assert.equal(h.push('a'), true);
  assert.equal(h.push('a'), false);
  h.push('b'); h.push('c');
  assert.equal(h.undo(), 'b'); assert.equal(h.undo(), 'a'); assert.equal(h.undo(), null);
  assert.equal(h.redo(), 'b');
  h.push('d');                                   // new branch drops 'c'
  assert.equal(h.canRedo(), false);
});

test('bounds include focal points', () => {
  const { s } = bench();
  assert.deepEqual(S.bounds(s), { z0: -120, z1: 50, y0: -25, y1: 25 });
  assert.equal(S.bounds(S.create()), null);
});

test('a dragged lens lines its F up with F′ of another lens (4f)', () => {
  const { s, L1 } = bench();
  const L2 = S.addLens(s, 0, 30);
  // F′ of L1 is at 50; L2's F is at z - 30, so it should snap to z = 80
  const r = Snap.snapLensZ(s, L2, 81.5, OPT);
  assert.equal(r.z, 80);
  assert.equal(r.hit.z, 50);
  assert.match(r.hit.text, /F on F′ of L1/);
  assert.equal(L1.z, 0);
});

test('a dragged lens falls back to the grid, and Alt means no snapping', () => {
  const { s } = bench();
  const L2 = S.addLens(s, 0, 30);
  assert.deepEqual(Snap.snapLensZ(s, L2, 212.4, OPT), { z: 210, hit: null });
  assert.deepEqual(Snap.snapLensZ(s, L2, 81.5, { ...OPT, free: true }), { z: 81.5, hit: null });
});

test('two lens centres never snap together', () => {
  const { s } = bench();
  const L2 = S.addLens(s, 200, 30);
  const r = Snap.snapLensZ(s, L2, 0.5, OPT);
  assert.ok(!r.hit || !/^lens on centre/.test(r.hit.text));
});

test('an object snaps to 2F of a lens', () => {
  const { s, O } = bench();
  const r = Snap.snapAxisZ(s, -101, O.id, OPT);
  assert.equal(r.z, -100);
  assert.match(r.hit.text, /2F of L1/);
});

test('dragging F′ changes f, and through the lens makes it diverging', () => {
  const { s, L1 } = bench();
  assert.equal(Snap.snapFocal(s, L1, 'Fp', 71, OPT).f, 70);
  assert.equal(Snap.snapFocal(s, L1, 'Fp', -40, OPT).f, -40);
  assert.equal(Snap.snapFocal(s, L1, 'F', -61, OPT).f, 60);
  assert.equal(Math.abs(Snap.snapFocal(s, L1, 'Fp', 0.2, OPT).f), 1);   // never zero
});

test('heights snap onto the axis', () => {
  assert.equal(Snap.snapHeight(1.5, OPT).y, 0);
  assert.equal(Snap.snapHeight(12, OPT).y, 10);
});

test('an object snaps to quarter-F steps from F to 2F, then half-F steps, of the nearest lens only', () => {
  const s = S.create();
  const L1 = S.addLens(s, 0, 40), L2 = S.addLens(s, 300, 50);
  const O = S.addObject(s, -500, 10);
  const OPT2 = { tol: 2, grid: 5 };
  let r = Snap.snapObjectZ(s, -61, O.id, OPT2);              // 1.5 f of L1 = -60
  assert.equal(r.z, -60);
  assert.match(r.hit.text, /1.5F of L1/);
  assert.deepEqual(r.hit.dim, { z0: 0, z1: -60, label: '1.5f' });
  assert.equal(Snap.snapObjectZ(s, -71, O.id, OPT2).z, -70);   // 1.75 f
  assert.equal(Snap.snapObjectZ(s, -101, O.id, OPT2).z, -100); // 2.5 f
  // between the lenses: L1's F′ side (z = 1.25 × 40 = 50) and L2's F side (300 − 1.5 × 50 = 225)
  assert.match(Snap.snapObjectZ(s, 51, O.id, OPT2).hit.text, /1.25F′ of L1/);
  assert.match(Snap.snapObjectZ(s, 226, O.id, OPT2).hit.text, /1.5F of L2/);
  // a lens beyond the next one does not count: 2F′ of L1 (z = 80) is not offered right of L2
  const r2 = Snap.snapObjectZ(s, 381, O.id, OPT2);
  assert.ok(!r2.hit || !/L1/.test(r2.hit.text));
});

test('#11 an object is never drawn smaller than 10 mm; across the axis it flips', () => {
  assert.equal(Snap.objectHeight(3, OPT), 10);
  assert.equal(Snap.objectHeight(0, OPT), 10);
  assert.equal(Snap.objectHeight(-3, OPT), -10);
  assert.equal(Snap.objectHeight(25, OPT), 25);
  assert.equal(Snap.objectHeight(-25, OPT), -25);
});
