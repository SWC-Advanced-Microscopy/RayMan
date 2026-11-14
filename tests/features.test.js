// Dichroics, lens rims that stop light, coloured planes and named rays.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/scene.js');
const R = require('../js/rays.js');

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const OPT = { tol: 2, free: false };
const solved = (s, r) => R.solveScene(s).rays[r.id];

function freeRay(s, y, z1, color) {
  const r = S.addRay(s, { z: -100, y });
  r.nodes.push({ dir: { kind: 'parallel' }, end: { kind: 'z', z: z1 } });
  if (color) r.color = color;
  return r;
}

test('a dichroic stops light of its colour and lets the rest through', () => {
  const s = S.create();
  const D = S.addDichroic(s, 0);
  D.stop = '#1F6FD6';                                       // any case
  const blue = freeRay(s, 2, 100, '#1f6fd6'), green = freeRay(s, -2, 100, '#2e9e3a'), plain = freeRay(s, 0, 100);
  assert.equal(solved(s, blue).blocked, D.id);
  close(solved(s, blue).pts[1].z, 0);
  assert.equal(solved(s, green).blocked, null);
  assert.equal(solved(s, plain).blocked, null);
  D.stop = null;
  assert.equal(solved(s, blue).blocked, null);              // no colour chosen: all light passes
});

test('a dichroic stops the rays of a beam of its colour, and a ray being drawn of its colour', () => {
  const s = S.create();
  S.addLens(s, 100, 50, 40);
  const D = S.addDichroic(s, 50);
  D.stop = '#d9422b';
  const B = S.addBeam(s, -50, 0);
  B.color = '#d9422b';
  s.rays.forEach(r => assert.equal(solved(s, r).blocked, D.id));
  const r = S.addRay(s, { z: -100, y: 5 });
  const sol = R.solveScene(s);
  const p = R.proposeSegment(s, sol, { z: -100, y: 5 }, null, { z: 120, y: 5.4 }, { ...OPT, self: r.id, colour: '#d9422b' });
  assert.match(p.text, /stopped by dichroic/);
  close(p.p.z, 50);
});

test('with lens rims on, light missing a lens or mirror stops at its rim', () => {
  const s = S.create();
  const L = S.addLens(s, 0, 50, 10), M = S.addMirror(s, 50);
  const miss = freeRay(s, 15, 100), hit = freeRay(s, 5, 100);
  const helper = S.addRay(s, { z: -100, y: 15 }, true);
  helper.nodes.push({ dir: { kind: 'parallel' }, end: { kind: 'z', z: 100 } });
  assert.equal(solved(s, miss).blocked, null);              // off by default: it goes on past
  s.settings.rims = true;
  const sm = solved(s, miss);
  assert.equal(sm.blocked, L.id);
  assert.equal(sm.rim, true);
  close(sm.pts[sm.pts.length - 1].z, 0);
  assert.equal(solved(s, hit).blocked, null);               // inside the aperture: fine (and inside the mirror)
  assert.equal(solved(s, helper).blocked, null);            // helpers are construction lines
  const high = S.addRay(s, { z: 20, y: 0 });                // misses the mirror (half-size 15)
  high.nodes.push({ dir: { kind: 'slope', u: 0.6 }, end: { kind: 'z', z: 100 } });
  assert.equal(solved(s, high).blocked, M.id);
  assert.equal(S.fromJSON(S.toJSON(s)).settings.rims, true);
});

test('plane colours, dichroics and ray names are saved', () => {
  const s = S.create();
  const P = S.addPlane(s, 10); P.color = '#8e44ad';
  const D = S.addDichroic(s, 20); D.stop = '#1f6fd6';
  const r = freeRay(s, 1, 50); r.label = 'r1';
  const back = S.fromJSON(S.toJSON(s));
  assert.equal(back.elements.find(e => e.id === P.id).color, '#8e44ad');
  assert.equal(back.elements.find(e => e.id === D.id).stop, '#1f6fd6');
  assert.equal(back.rays[0].label, 'r1');
});
