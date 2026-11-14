// Köhler illumination, as in the demo optics.mouse.vision/demos/resolution/kohler (examples/kohler/):
// lamp at 0, collector f 50 at 50, field diaphragm at 100, field lens f 90 at 190, aperture
// diaphragm at 280, condenser f 60 at 340, sample at 400, objective f 30 at 430, pupil at 460,
// tube lens f 60 at 520, camera at 580. Built by mouse in headless Chrome, saved, checked here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../js/scene.js');
const R = require('../js/rays.js');

const close = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const OPT = { tol: 1.5, free: false };
const load = (f) => S.fromJSON(fs.readFileSync(path.join(__dirname, '..', 'examples', 'kohler', f), 'utf8'));

/** Height of ray `id` at z, from its solved points. */
function yAt(sol, id, z) {
  const p = sol.rays[id].pts;
  for (let k = 0; k + 1 < p.length; k++) {
    const a = p[k], b = p[k + 1];
    if (b.z > a.z && a.z <= z && z <= b.z) return a.y + (b.y - a.y) * (z - a.z) / (b.z - a.z);
  }
  return null;
}

test('Köhler, lamp points: images of the lamp at the aperture diaphragm (x -1.8) and the back focal plane (x 0.9)', () => {
  const s = load('kohler-5-whole-lamp-points.json'), sol = R.solveScene(s);
  const ims = sol.images.filter(i => !i.virtual && !i.focus).map(i => [i.z, +i.y.toFixed(3) + 0]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  assert.deepEqual(ims, [[280, -12.6], [280, 0], [280, 12.6], [460, -6.3], [460, 0], [460, 6.3]]);
  Object.values(sol.rays).forEach(r => assert.equal(r.blocked, null));
  // each lamp point lights the whole of the sample (+-12 = field diaphragm edge 18 x 2/3)
  const top = s.rays.filter(r => r.start.at && r.start.at.pt === 'top').map(r => yAt(sol, r.id, 400)).sort((a, b) => a - b);
  close(top[0], -12); close(top[2], 12);
});

test('Köhler, field points: they meet again on the sample (x -2/3) and the camera (x 2 more)', () => {
  const s = load('kohler-6-whole-field-points.json'), sol = R.solveScene(s);
  const byColour = {};
  s.rays.forEach(r => (byColour[r.color] = byColour[r.color] || []).push(r.id));
  const want = { '#2e9e3a': [15, -10, 20], '#1b2233': [0, 0, 0], '#8e44ad': [-15, 10, -20] };
  Object.entries(want).forEach(([col, [fd, sam, cam]]) => {
    assert.equal(byColour[col].length, 3);
    byColour[col].forEach(id => { close(yAt(sol, id, 100), fd); close(yAt(sol, id, 400), sam); close(yAt(sol, id, 580), cam); });
  });
});

test('closing the aperture diaphragm stops the light of the outer lamp points, at their images', () => {
  const s = load('kohler-4-aperture-diaphragm.json');
  s.elements.find(e => e.label === 'aperture').r = 10;
  const sol = R.solveScene(s), stopped = s.rays.filter(r => sol.rays[r.id].blocked).map(r => r.start.at.pt);
  assert.deepEqual(stopped.sort(), ['bot', 'bot', 'bot', 'top', 'top', 'top']);
});

test('aiming at a lens: points beyond it (an iris edge, F′) are not offered; F of a negative lens and images are', () => {
  const s = S.create();
  const L = S.addLens(s, 50, 50, 40);
  const fd = S.addIris(s, 100); fd.r = 19;
  const P = S.addPoint(s, 0, -7);
  const r = S.addRay(s, { at: { el: P.id, pt: 'src' } });
  // the straight line from (0, -7) through the iris top edge (100, 19) crosses the lens at y = 6
  const prop = R.proposeSegment(s, R.solveScene(s), { z: 0, y: -7 }, null, { z: 50, y: 6.2 }, { ...OPT, self: r.id });
  assert.doesNotMatch(prop.text, /edge/);
  close(prop.pts[0].y, 6.2);
  // F′ of a positive lens, beyond it, is not a target either
  const p2 = R.proposeSegment(s, R.solveScene(s), { z: 0, y: -7 }, null, { z: 50, y: -3.5 + 0.1 }, { ...OPT, self: r.id });
  assert.doesNotMatch(p2.text, /F′/);

  // a negative lens: aimed at its F (beyond it), the ray leaves parallel to the axis
  const s2 = S.create();
  S.addLens(s2, 0, -50, 30);
  const Q = S.addPoint(s2, -50, 10);
  const r2 = S.addRay(s2, { at: { el: Q.id, pt: 'src' } });
  const p3 = R.proposeSegment(s2, R.solveScene(s2), { z: -50, y: 10 }, null, { z: 0, y: 5.1 }, { ...OPT, self: r2.id });
  assert.match(p3.text, /through F of L1/);
});
