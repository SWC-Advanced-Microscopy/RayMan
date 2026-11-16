// The Objects panel (issue #4): switching a light source or the helper rays off takes only
// those off the bench. Rays drawn through or parallel to them stay where they were drawn.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../js/scene.js');
const R = require('../js/rays.js');

const load = () => S.fromJSON(fs.readFileSync(path.join(__dirname, 'scenes', 'issue4.json'), 'utf8'));
const solved = (s) => R.solveScene(S.axisView(s, 'e1')).rays;

/** What the app's switch does (app.js setSourceOn). */
function switchOff(s, id) {
  const e = S.find(s, id), set = R.raysOf(S.axisView(s, e.axis), id);
  s.rays.forEach(r => { if (set[r.id]) r.off = id; });
  e.hidden = true;
}

test('hiding helper rays leaves the rays drawn through them whole', () => {
  const s = load(), before = solved(s);
  S.find(s, 'e1').hideHelpers = true;
  const after = solved(s);
  assert.deepEqual(Object.keys(after).sort(), ['r5', 'r6']);
  for (const id of ['r5', 'r6']) {
    assert.equal(after[id].pts.length, 4, id + ' runs through both lenses to the end');
    assert.deepEqual(after[id].pts, before[id].pts);
  }
});

test('switching the point source off leaves the helpers drawn parallel to its rays', () => {
  const s = load(), before = solved(s);
  switchOff(s, 'e4');
  assert.deepEqual(s.rays.filter(r => r.off).map(r => r.label).sort(), ['r1', 'r2']);
  const after = solved(s);
  assert.deepEqual(Object.keys(after).sort(), ['r7', 'r8', 'r9', 'r10'].sort());
  for (const id of Object.keys(after)) assert.deepEqual(after[id].pts, before[id].pts, id);
});

test('a helper started on a source goes off with it', () => {
  const s = load();
  const h = S.addRay(s, { at: { el: 'e4', pt: 'src' } }, true); h.axis = 'e1';
  h.nodes.push({ dir: { kind: 'parallel' }, end: { kind: 'lens', el: 'e2' } });
  switchOff(s, 'e4');
  assert.equal(h.off, 'e4');
});
