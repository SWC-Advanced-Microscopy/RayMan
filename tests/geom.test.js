// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../js/geom.js');

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test('quantize rounds to the step and never returns -0', () => {
  assert.equal(G.quantize(12.4, 5), 10);
  assert.equal(G.quantize(12.6, 5), 15);
  assert.ok(Object.is(G.quantize(-0.1, 5), 0));
});

test('niceStep gives 1/2/5 x 10^n at least minPx apart', () => {
  assert.equal(G.niceStep(3, 14), 5);        // 14 px / 3 px/mm = 4.7 mm -> 5
  assert.equal(G.niceStep(10, 14), 2);       // 1.4 -> 2
  assert.equal(G.niceStep(1, 14), 20);       // 14 -> 20
  assert.equal(G.niceStep(14, 14), 1);
});

test('majorEvery puts major lines on 5s and 10s', () => {
  assert.equal(G.majorEvery(1), 5);
  assert.equal(G.majorEvery(2), 5);          // 10
  assert.equal(G.majorEvery(5), 2);          // 10
  assert.equal(G.majorEvery(50), 2);
  assert.equal(G.majorEvery(0.2), 5);
});

test('focal points of converging and diverging lenses', () => {
  assert.deepEqual(G.focalPoints({ z: 100, f: 50 }), { F: 50, Fp: 150 });
  assert.deepEqual(G.focalPoints({ z: 100, f: -50 }), { F: 150, Fp: 50 });
});

test('nearest1D picks the closest candidate inside the tolerance', () => {
  const c = [{ value: 0 }, { value: 10 }, { value: 12 }];
  assert.equal(G.nearest1D(11.2, c, 2).value, 12);
  assert.equal(G.nearest1D(5, c, 2), null);
});

test('distToSegment handles ends and interior', () => {
  const a = { z: 0, y: 0 }, b = { z: 10, y: 0 };
  close(G.distToSegment({ z: 5, y: 3 }, a, b), 3);
  close(G.distToSegment({ z: -4, y: 3 }, a, b), 5);
  close(G.distToSegment({ z: 1, y: 1 }, a, a), Math.SQRT2);
});

test('lineIntersection finds crossings and rejects parallel lines', () => {
  const p = G.lineIntersection({ z: 0, y: 0 }, { z: 10, y: 10 }, { z: 0, y: 10 }, { z: 10, y: 0 });
  close(p.z, 5); close(p.y, 5);
  assert.equal(G.lineIntersection({ z: 0, y: 0 }, { z: 1, y: 1 }, { z: 0, y: 1 }, { z: 1, y: 2 }), null);
});

test('yAtZ extends a line to a plane', () => {
  close(G.yAtZ({ z: 0, y: 0 }, { z: 10, y: 5 }, 30), 15);
  assert.equal(G.yAtZ({ z: 1, y: 0 }, { z: 1, y: 5 }, 3), null);
});

test('an ideal lens sends a parallel ray through F′ and a focal ray out parallel', () => {
  const f = 50, h = 10;
  // parallel in: slope after = -h/f, so it crosses the axis f behind the lens
  const u = G.refractSlope(0, h, f);
  close(h + u * f, 0);
  // in through F (slope h/f at height h): out parallel
  close(G.refractSlope(h / f, h, f), 0);
  // through the centre: undeviated
  close(G.refractSlope(0.3, 0, f), 0.3);
});
