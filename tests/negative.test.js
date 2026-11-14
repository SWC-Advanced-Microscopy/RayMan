// The guide's steps for a negative lens (guide/index.html, "A negative lens"), drawn as the
// mouse would: f = -50, an object 25 high at z = -62.5. The image is virtual, at z = -27.8,
// M = +0.44.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/scene.js');
const R = require('../js/rays.js');

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const OPT = { tol: 1.5, free: false };

function draw(s, r, C, extra = {}) {
  const sol = R.solveScene(s), p = sol.rays[r.id].pts, n = p.length;
  const prop = R.proposeSegment(s, sol, p[n - 1], n > 1 ? p[n - 2] : null, C, { ...OPT, self: r.id, helper: r.helper, ...extra });
  assert.ok(prop, 'no proposal');
  r.nodes.push(...prop.nodes);
  return prop;
}

function bench() {
  const s = S.create();
  s.settings.virtual = true;
  const L = S.addLens(s, 0, -50, 30);
  const O = S.addObject(s, -62.5, 25);
  return { s, L, O };
}

test('negative lens: through the centre, parallel then along the helper from F′, gives the virtual image', () => {
  const { s, L, O } = bench();
  const a = S.addRay(s, { at: { el: O.id, pt: 'tip' } });
  assert.match(draw(s, a, { z: 100, y: -39.8 }).text, /centre of L1, straight on/);
  const b = S.addRay(s, { at: { el: O.id, pt: 'tip' } });
  assert.match(draw(s, b, { z: 0, y: 25.2 }).text, /parallel to the axis/);
  const h = S.addRay(s, { at: { el: L.id, pt: 'Fp' } }, true);
  close(R.solveScene(s).rays[h.id].pts[0].z, -50);        // F′ of a negative lens is on the left
  draw(s, h, { z: 0, y: 25 });
  const p = draw(s, b, { z: 55, y: 52.6 });
  assert.match(p.text, /parallel to that ray/);
  const im = R.solveScene(s).images.find(i => !i.focus);
  assert.ok(im && im.virtual);
  close(im.z, -250 / 9); close(im.y, 100 / 9);
});

test('negative lens: a ray aimed at F beyond the lens stops at it, leaves parallel, and joins the image', () => {
  const { s, L, O } = bench();
  const a = S.addRay(s, { at: { el: O.id, pt: 'tip' } });
  draw(s, a, { z: 100, y: -39.8 });
  const c = S.addRay(s, { at: { el: O.id, pt: 'tip' } });
  const p = draw(s, c, { z: 50, y: 0.3 });
  assert.match(p.text, /through F of L1, to L1/);
  assert.equal(p.nodes[0].end.kind, 'lens');
  assert.match(draw(s, c, { z: 100, y: 100 / 9 + 0.2 }).text, /parallel to the axis/);
  const im = R.solveScene(s).images.find(i => !i.focus);
  assert.ok(im && im.virtual && im.rays.some(q => q.ray === c.id));
  close(im.z, -250 / 9); close(im.y, 100 / 9);
});
