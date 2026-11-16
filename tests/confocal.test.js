// Building a confocal: a scan mirror that works from both sides (and de-scans), a collimated
// beam that runs right to left, and light sources that can be switched off.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/scene.js');
const R = require('../js/rays.js');

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const DEG = Math.PI / 180;
const OPT = { tol: 2, free: false };
const pts = (s, r) => R.solveScene(s).rays[r.id].pts;
const slope = (a, b) => (b.y - a.y) / (b.z - a.z);

function draw(s, r, C, opt = OPT) {
  const sol = R.solveScene(s), p = sol.rays[r.id].pts, n = p.length;
  const prop = R.proposeSegment(s, sol, p[n - 1], n > 1 ? p[n - 2] : null, C, { ...opt, self: r.id });
  assert.ok(prop, 'no proposal');
  r.nodes.push(...prop.nodes);
  return prop;
}

test('a beam turned round runs right to left, as the mirror image of itself', () => {
  const s = S.create();
  const L = S.addLens(s, 0, 50, 40);
  const B = S.addBeam(s, 100, 0, null, -1);
  B.angle = 3;
  const sol = R.solveScene(s);
  const top = s.rays.find(r => r.start.at.pt === 'top');
  const q = sol.rays[top.id].pts;
  assert.equal(q[1].z, L.z);                                   // reaches the lens to its left
  close(slope(q[0], q[1]), -Math.tan(3 * DEG));                // angled up as it runs left
  close(q[0].z, 100 + 10 * Math.sin(3 * DEG));                 // the bar is at right angles to it
  assert.deepEqual(top.nodes[0].end, { kind: 'next', sgn: -1 });
  const back = S.fromJSON(S.toJSON(s));
  assert.equal(back.elements.find(e => e.type === 'beam').dir, -1);
});

test('the mirror works from the right too, and turns light the same way (up for a positive tilt)', () => {
  const s = S.create();
  const M = S.addMirror(s, 0);
  M.tilt = 4;
  const r = S.addRay(s, { z: 100, y: 2 });
  const p = draw(s, r, { z: -60, y: 2.3 });                   // parallel, leftwards, through the mirror
  assert.equal(p.nodes.length, 2);
  assert.deepEqual(p.nodes[1].dir, { kind: 'deflect', el: M.id });
  const q = pts(s, r);
  assert.ok(q[2].y > q[1].y, 'goes up');
  close(slope(q[1], q[2]), -Math.tan(4 * DEG));
});

test('light sent back along a ray retraces it through the mirror: it is de-scanned', () => {
  const s = S.create();
  const M = S.addMirror(s, 0);
  M.tilt = 6;
  const out = S.addRay(s, { z: 100, y: 3 });                  // leftwards, in parallel
  out.nodes.push({ dir: { kind: 'parallel' }, end: { kind: 'lens', el: M.id } },
    { dir: { kind: 'deflect', el: M.id }, end: { kind: 'z', z: -80 } });
  const e = pts(s, out)[2];
  const back = S.addRay(s, { z: e.z, y: e.y });                // and back the way it came
  back.nodes.push({ dir: { kind: 'through', at: { ray: out.id, k: 1 } }, end: { kind: 'lens', el: M.id } });
  assert.equal(R.passMirrors(s), true);
  const q = pts(s, back);
  close(slope(q[1], q[2]), 0);                                // leaves parallel to the axis again
  close(q[2].y, 3);
});

test('a confocal: the fluorescence from the scanned spot leaves the scan mirror the way the laser came in', () => {
  for (const tilt of [0, 3, -5]) {
    const s = S.create();
    const obj = S.addLens(s, 0, 20, 30), tube = S.addLens(s, 120, 100, 40), scan = S.addLens(s, 270, 50, 40);
    const M = S.addMirror(s, 320);
    M.tilt = tilt;
    const B = S.addBeam(s, 400, 0, null, -1);                 // the laser, running right to left
    R.passMirrors(s);                                         // through the mirror to the scan lens
    const mid = s.rays.find(r => r.start.at && r.start.at.el === B.id && r.start.at.pt === 'mid');
    assert.equal(mid.nodes.length, 2);
    mid.nodes.push({ dir: { kind: 'refract', el: scan.id }, end: { kind: 'next', sgn: -1 } },
      { dir: { kind: 'refract', el: tube.id }, end: { kind: 'next', sgn: -1 } },
      { dir: { kind: 'refract', el: obj.id }, end: { kind: 'z', z: -20 } });
    const m = pts(s, mid), spot = m[5];
    if (tilt) assert.ok(Math.abs(spot.y) > 0.1, 'the spot moves as the mirror turns'); else close(spot.y, 0);
    const P = S.addPoint(s, -20, spot.y);                     // a fluorophore at the spot
    const f = S.addRay(s, { at: { el: P.id, pt: 'src' } });
    f.nodes.push({ dir: { kind: 'through', at: { ray: mid.id, k: 4 } }, end: { kind: 'lens', el: obj.id } },
      { dir: { kind: 'refract', el: obj.id }, end: { kind: 'next' } },
      { dir: { kind: 'refract', el: tube.id }, end: { kind: 'next' } },
      { dir: { kind: 'refract', el: scan.id }, end: { kind: 'next' } });
    R.passMirrors(s);
    const q = pts(s, f);
    assert.equal(q[4].z, M.z);
    close(slope(q[4], q[5]), 0, 1e-9);                        // de-scanned: parallel to the axis
    close(q[5].y, 0, 1e-9);                                   // on the line the laser came in on
  }
});

test('a light source switched off takes its rays out of the view, not helpers parallel to them', () => {
  const s = S.create();
  const ax = S.addAxis(s, 0);
  const L = S.addLens(s, 0, 50, 40, ax.id);
  const P = S.addPoint(s, -100, 5); P.axis = ax.id;
  const Q = S.addPoint(s, -100, -5); Q.axis = ax.id;
  const a = S.addRay(s, { at: { el: P.id, pt: 'src' } }); a.axis = ax.id;
  a.nodes.push({ dir: { kind: 'parallel' }, end: { kind: 'lens', el: L.id } });
  const h = S.addRay(s, { at: { el: L.id, pt: 'C' } }, true); h.axis = ax.id;         // a helper parallel to it
  h.nodes.push({ dir: { kind: 'parallelTo', ray: a.id, seg: 0 }, end: { kind: 'z', z: 50 } });
  const b = S.addRay(s, { at: { el: Q.id, pt: 'src' } }); b.axis = ax.id;
  b.nodes.push({ dir: { kind: 'parallel' }, end: { kind: 'lens', el: L.id } });
  const v = S.axisView(s, ax.id);
  const set = R.raysOf(v, P.id);
  assert.deepEqual(Object.keys(set), [a.id]);
  s.rays.forEach(r => { if (set[r.id]) r.off = P.id; });
  P.hidden = true;
  assert.deepEqual(v.elements.map(e => e.id).sort(), [L.id, Q.id].sort());
  assert.deepEqual(v.rays.map(r => r.id).sort(), [h.id, b.id].sort());
  close(R.solveScene(v).rays[h.id].pts[1].y, 0);            // still parallel to the ray that is off
  R.bakeAll(v);                                               // writing the view's lists keeps what is off
  assert.equal(s.rays.length, 3);
  assert.equal(s.elements.length, 4);
  const back = S.fromJSON(S.toJSON(s));
  assert.equal(back.elements.find(e => e.id === P.id).hidden, true);
  assert.equal(back.rays.find(r => r.id === a.id).off, P.id);
  ax.hideHelpers = true;
  P.hidden = false; s.rays.forEach(r => { delete r.off; });
  assert.deepEqual(v.rays.map(r => r.id).sort(), [a.id, b.id].sort());   // helpers hidden on this axis
  assert.equal(S.fromJSON(S.toJSON(s)).elements.find(e => e.id === ax.id).hideHelpers, true);
});

test('a flipped mirror is saved', () => {
  const s = S.create();
  const M = S.addMirror(s, 0);
  M.flip = true;
  assert.equal(S.fromJSON(S.toJSON(s)).elements[0].flip, true);
});

test('a scanned ray drawn at tilt 0 through lens centres is bent by them, so it stays right while scanning', () => {
  const s = S.create();
  const scan = S.addLens(s, 0, 50, 40), tube = S.addLens(s, 150, 100, 40);
  const M = S.addMirror(s, -50);
  const pl = S.addPlane(s, 250, null);
  const r = S.addRay(s, { z: -100, y: 0 });
  let p = draw(s, r, { z: 100, y: 0 });                     // along the axis, through the mirror, on through the scan lens
  assert.ok(p.nodes.some(n => n.dir.kind === 'refract' && n.dir.el === scan.id), JSON.stringify(p.nodes));
  p = draw(s, r, { z: 250, y: 0.3 });                       // through the tube lens centre, to the image plane
  const last = r.nodes[r.nodes.length - 1];
  assert.notEqual(last.end.kind, 'at');                      // not pinned to the plane's centre
  M.tilt = 4;
  const q = pts(s, r);
  close(q[q.length - 1].z, pl.z);                            // still ends on the plane
  const iS = q.findIndex(x => x.z === scan.z);               // the mirror is at the scan lens's F:
  close(slope(q[iS], q[iS + 1]), 0);                         // it leaves the scan lens parallel to the axis
  const iT = q.findIndex(x => x.z === tube.z);
  close(slope(q[iT], q[iT + 1]), -q[iT].y / 100);            // and the tube lens bends it
});
