// Robustness and safety of scenes that come from outside (#19, #20, #21): a file, a link, an
// embedded page or a workbook may hold anything. Whatever loads must solve and draw without an
// exception, and whatever RayMan makes from it (an edit, an undo step, the saved bench) must
// load again: a scene that cannot be reloaded breaks undo and loses the bench on the next visit.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const S = require('../js/scene.js');
const R = require('../js/rays.js');
const Share = require('../js/share.js');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');

// ---------------------------------------------------------------- reloading what RayMan makes

/** A lens with an image plane behind it, and a ray from the left through the lens past the plane. */
function benchWithPlane() {
  const s = S.create(), ax = S.addAxis(s, 0);
  const L = S.addLens(s, 0, 50, 25, ax.id), P = S.addPlane(s, 60, ax.id);
  const r = S.addRay(s, { z: -100, y: 10 });
  r.axis = ax.id;
  r.nodes.push({ dir: { kind: 'parallel' }, end: { kind: 'lens', el: L.id } });
  r.nodes.push({ dir: { kind: 'free' }, end: { kind: 'z', z: 120, y: -10 } });
  return { s, ax, L, P, r };
}

test('a ray started where another crosses an image plane loads again (#19)', () => {
  const { s, ax } = benchWithPlane();
  const v = S.axisView(s, ax.id), sol = R.solveScene(v);
  const at = R.anchors(v, sol).find(a => a.ref.plane && a.ref.plane.pt === 'Z');
  assert.ok(at, 'RayMan offers the crossing as a point to start from');
  const r2 = S.addRay(s, { at: at.ref });
  r2.axis = ax.id;
  r2.nodes.push({ dir: { kind: 'parallel' }, end: { kind: 'edge', sgn: 1 } });
  const r3 = S.addRay(s, { z: -100, y: 0 });
  r3.axis = ax.id;
  r3.nodes.push({ dir: { kind: 'through', at: at.ref }, end: { kind: 'z', z: 200 } });
  const back = S.fromJSON(S.toJSON(s));                  // undo and the saved bench do exactly this
  assert.deepEqual(JSON.parse(S.toJSON(back)).rays, JSON.parse(S.toJSON(s)).rays);
});

test('reversing a ray with a zero-length piece is refused, not saved broken (#19)', () => {
  const { s, ax, L } = benchWithPlane();
  S.addPlane(s, 0, ax.id);                               // a marker on the lens's own plane
  const r = S.addRay(s, { z: -100, y: 5 });
  r.axis = ax.id;
  const marker = s.elements.filter(e => e.type === 'plane')[1];
  r.nodes.push({ dir: { kind: 'parallel' }, end: { kind: 'lens', el: L.id } });
  r.nodes.push({ dir: { kind: 'refract', el: L.id }, end: { kind: 'lens', el: marker.id } });   // bent by L, ending at once
  const before = S.toJSON(s);
  assert.equal(R.reverseRay(S.axisView(s, ax.id), r), false);
  assert.equal(S.toJSON(s), before, 'nothing changed');
  S.fromJSON(S.toJSON(s));
});

test('reversing a ray leaves references past its end out of range, never negative (#19)', () => {
  const { s, ax, r } = benchWithPlane();
  const q = S.addRay(s, { z: -100, y: -5 });
  q.axis = ax.id;
  q.nodes.push({ dir: { kind: 'parallelTo', ray: r.id, seg: 7 }, end: { kind: 'z', z: 0 } });
  const p = S.addRay(s, { at: { ray: r.id, k: 9 } });
  p.axis = ax.id;
  assert.equal(R.reverseRay(S.axisView(s, ax.id), r), true);
  assert.equal(q.nodes[0].dir.seg, 7);
  assert.equal(p.start.at.k, 9);
  S.fromJSON(S.toJSON(s));
  R.solveScene(S.axisView(s, ax.id));                     // used to read .z of undefined
});

test('a damaged negative segment index solves as unplaceable, not as an exception (#19)', () => {
  const { s, ax, r } = benchWithPlane();
  const q = S.addRay(s, { z: -100, y: -5 });
  q.axis = ax.id;
  q.nodes.push({ dir: { kind: 'parallelTo', ray: r.id, seg: -2 }, end: { kind: 'z', z: 0 } });
  const sol = R.solveScene(S.axisView(s, ax.id));
  assert.equal(sol.rays[q.id].ok, false);
});

test('fill-in rays where a ray leaves a crossing point straight up do not recurse for ever (#19)', () => {
  // two rays from a point source cross at a free point after the lens; one leaves it vertically
  const s = S.create(), ax = S.addAxis(s, 0), L = S.addLens(s, 0, 50, 25, ax.id), P = S.addPoint(s, -100, 0);
  P.axis = ax.id;
  /** A ray from the source through the lens at height y to the crossing, then on through tail. */
  const ray = (y, tail) => {
    const r = S.addRay(s, { at: { el: P.id, pt: 'src' } });
    r.axis = ax.id;
    r.nodes.push({ dir: { kind: 'free' }, end: { kind: 'lens', el: L.id, y } });
    r.nodes.push({ dir: { kind: 'free' }, end: { kind: 'z', z: 50, y: 0 } });
    tail.forEach(p => r.nodes.push({ dir: { kind: 'free' }, end: { kind: 'z', z: p[0], y: p[1] } }));
  };
  ray(10, [[50, 5], [100, 5]]);
  ray(-10, [[100, -5]]);
  const v = S.axisView(s, ax.id);
  assert.equal(R.fillRays(v, R.solveScene(v), 3).length, 3);      // was: Maximum call stack size exceeded
});

test('start-up keeps a saved bench it cannot open, and undo cannot throw (#19)', () => {
  assert.match(app, /store\(UNREADABLE_KEY, saved\)/, 'the unreadable bench is kept aside before the empty one is saved');
  assert.match(app, /function restore\(snap\) \{\s*var scene;\s*try \{ scene = S\.fromJSON\(snap\); \}/);
});

// ---------------------------------------------------------------- what the loader lets in

/** A one-element scene with the given element. */
const one = e => JSON.stringify({ elements: [Object.assign({ id: 'e1', type: 'object', z: 0, h: 5 }, e)] });

test('ids are plain: no markup can ride in on one (#20)', () => {
  assert.throws(() => S.fromJSON(one({ id: 'x"><img src=x onerror=alert(1)>' })), /id may only have/);
  assert.throws(() => S.fromJSON(JSON.stringify({ elements: [], rays: [{ id: 'r 1', start: { z: 0, y: 0 }, nodes: [] }] })), /id may only have/);
  assert.equal(S.fromJSON(one({ id: 'e12' })).elements[0].id, 'e12');
});

test('colours are CSS colours only (#20)', () => {
  const colourOf = c => S.fromJSON(one({ color: c })).elements[0].color;
  ['#2e9e3a', '#abc', 'red', 'rgb(10, 20, 30)', 'hsla(120, 50%, 50%, 0.5)'].forEach(c => assert.equal(colourOf(c), c));
  ['red;background:url(//evil.example/x)', 'url(x)', 'expression(alert(1))', '#12"><b>', 'var(--x)', 5].forEach(c =>
    assert.equal(colourOf(c), null, String(c)));
});

test('the Objects panel escapes everything it takes from the scene (#20)', () => {
  const html = app.slice(app.indexOf('function syncObjects'), app.indexOf('function setSourceOn'));
  assert.doesNotMatch(html, /\+ e\.id \+|\+ ax\.id \+|e\.hidden \? '' : e\.id\)/, 'ids are escaped');
  assert.match(html, /esc\(e\.color/);
  assert.match(html, /esc\(name\)/);
});

test('labels are cut short, and absurd numbers are refused (#21)', () => {
  assert.equal(S.fromJSON(one({ label: 'x'.repeat(100000) })).elements[0].label.length, 40);
  assert.throws(() => S.fromJSON(one({ z: 1e300 })), /bad position/);
  assert.throws(() => S.fromJSON(one({ h: -1e300 })), /bad height/);
  assert.throws(() => S.fromJSON(JSON.stringify({ elements: [{ id: 'e1', type: 'lens', z: 0, f: 1e-12, ap: 5 }] })), /focal length/);
  assert.equal(S.fromJSON(JSON.stringify({ elements: [{ id: 'e1', type: 'lens', z: 0, f: -0.1, ap: 5 }] })).elements[0].f, -0.1,
    'the shortest focal length the panel allows still loads');
  const slope = u => JSON.stringify({ elements: [], rays: [{ id: 'r1', start: { z: 0, y: 0 }, nodes: [{ dir: { kind: 'slope', u }, end: { kind: 'edge', sgn: 1 } }] }] });
  assert.equal(S.fromJSON(slope(5e6)).rays.length, 1, 'a steep frozen ray is fine');
  assert.throws(() => S.fromJSON(slope(1e300)), /bad segment/);
});

test('a huge id number or nextId cannot make every new id the same (#21)', () => {
  const s = S.fromJSON(JSON.stringify({ nextId: 1e300, elements: [{ id: 'e99999999999999999999', type: 'object', z: 0, h: 5 }] }));
  const a = S.addLens(s, 0, 50), b = S.addLens(s, 10, 50);
  assert.notEqual(a.id, b.id);
  assert.ok(s.nextId < 1e9);
});

test('a link that unpacks to something huge is refused, not opened (#21)', async () => {
  const bomb = new Uint8Array(Share.MAX_SCENE_BYTES + 1000).fill(32);       // spaces compress ~1000:1
  const zipped = new Uint8Array(await new Response(new Blob([bomb]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  let s = '';
  zipped.forEach(b => { s += String.fromCharCode(b); });
  const tok = 'z' + btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.ok(tok.length < 20000, 'a short link');
  await assert.rejects(Share.decode(tok), /too big/);
  const text = S.toJSON(S.create());
  assert.equal(await Share.decode(await Share.encode(text)), text, 'ordinary links still open');
});

// ---------------------------------------------------------------- fuzzing

// the drawing code, loaded as a page loads it, onto a canvas that does nothing
const sandbox = { Path2D: class { constructor() {} }, console };
['moveTo', 'lineTo', 'arc', 'rect', 'closePath', 'quadraticCurveTo', 'bezierCurveTo', 'ellipse', 'roundRect']
  .forEach(m => { sandbox.Path2D.prototype[m] = function () {}; });
sandbox.self = sandbox; sandbox.RM = {};
vm.createContext(sandbox);
['geom', 'scene', 'rays', 'snap', 'view', 'render', 'share'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8'), sandbox, { filename: f + '.js' }));
const RM = sandbox.RM;
const ctx = new Proxy({}, {
  get: (t, n) => n === 'measureText' ? s => ({ width: String(s).length * 6 }) : n in t ? t[n]
    : function () { if (/^create/.test(n)) return { addColorStop() {} }; },
  set: (t, n, v) => { t[n] = v; return true; }
});

/** Every example and test scene. */
function sceneTexts() {
  const out = [];
  (function walk(d) {
    fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.json') && !/^(bundle|manifest)/.test(e.name)) out.push(fs.readFileSync(p, 'utf8'));
    });
  })(path.join(root, 'examples'));
  fs.readdirSync(path.join(__dirname, 'scenes')).forEach(n => out.push(fs.readFileSync(path.join(__dirname, 'scenes', n), 'utf8')));
  return out;
}

/** A small seeded random number generator, so a failure can be replayed. */
function random(seed) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

/** Damage a parsed scene in one to three random ways: extreme numbers, elements and rays deleted
    without care, references pointed elsewhere (or at the ray itself), indexes out of range,
    elements stacked at one z, slopes, unknown axes, other ends. */
function mutate(d, rnd) {
  const pick = a => a[Math.floor(rnd() * a.length)];
  const nums = [0, 1e-12, -1e-12, 1e12, -1e12, 1, -1, 0.5, 1e-300, 1e300, 25, -25, 100];
  const ids = d.elements.map(e => e.id).concat(d.rays.map(r => r.id), ['nope']);
  /** Call fn on every object inside o. */
  const walk = (o, fn) => { if (o && typeof o === 'object') { fn(o); Object.values(o).forEach(v => walk(v, fn)); } };
  for (let i = 1 + Math.floor(rnd() * 3); i > 0; i--) {
    const kind = Math.floor(rnd() * 9), e = d.elements.length && pick(d.elements), r = d.rays.length && pick(d.rays);
    if (kind === 0 && e) {
      const ks = Object.keys(e).filter(k => typeof e[k] === 'number');
      if (ks.length) e[pick(ks)] = pick(nums);
    } else if (kind === 1 && e) d.elements.splice(d.elements.indexOf(e), 1);
    else if (kind === 2 && r) d.rays.splice(d.rays.indexOf(r), 1);
    else if (kind === 3 && r) {
      const refs = [];
      walk(r, o => { if (typeof o.el === 'string' || typeof o.ray === 'string') refs.push(o); });
      if (refs.length) {
        const o = pick(refs);
        if (typeof o.el === 'string') o.el = pick(ids);
        else o.ray = rnd() < 0.3 ? r.id : pick(ids);
      }
    } else if (kind === 4 && r) {
      walk(r, o => {
        if (typeof o.k === 'number') o.k = pick([0, 1, 5, 1000]);
        if (typeof o.seg === 'number') o.seg = pick([0, 1, 5, 1000]);
      });
    } else if (kind === 5 && e) {
      const b = pick(d.elements);
      if (typeof e.z === 'number' && typeof b.z === 'number') e.z = b.z;
    } else if (kind === 6 && r) r.nodes.forEach(n => { if (rnd() < 0.3) n.dir = { kind: 'slope', u: pick(nums) }; });
    else if (kind === 7 && e) e.axis = pick(ids);
    else if (kind === 8 && r && r.nodes.length) {
      pick(r.nodes).end = pick([{ kind: 'edge', sgn: 1 }, { kind: 'next', sgn: -1 }, { kind: 'z', z: pick(nums), y: pick(nums) },
        { kind: 'lens', el: pick(ids) }, { kind: 'plane', el: pick(ids), pt: 'F' }]);
    }
  }
  return d;
}

/** Everything a loaded scene goes through: solving, framing, snapping, fill-in rays, drawing,
    and edits (deleting, reversing, lengthening), each of which must leave a scene that loads. */
function exercise(text, rnd) {
  const real = RM.scene.ensureAxis(RM.scene.fromJSON(text));
  RM.share.passMirrors(real);
  RM.share.box(real);
  real.settings.fill = 3;
  real.settings.rims = rnd() < 0.5;
  RM.scene.axes(real).forEach(ax => {
    const v = RM.scene.axisView(real, ax.id), sol = RM.rays.solveScene(v);
    RM.rays.fillRays(v, sol, 3);
    RM.rays.proposeStart(v, sol, { z: 10, y: 3 }, { tol: 2, grid: 1 });
    v.rays.forEach(r => {
      const p = sol.rays[r.id].pts;
      if (p.length >= 2) RM.rays.proposeSegment(v, sol, p[p.length - 1], p[p.length - 2], { z: p[p.length - 1].z + 40, y: 1 }, { tol: 2, self: r.id });
    });
  });
  const view = new RM.View();
  view.fit(RM.share.box(real) || { z0: -60, z1: 140, y0: -30, y1: 30 }, 800, 500);   // framed as the app and embeds frame it
  RM.render.draw(ctx, 800, 500, { scene: real, real, view, theme: 'light', tool: 'ray', sel: null, hover: null, ghost: null,
    hints: null, hotFocal: null, axisHot: false, draft: null, caption: null, axis: (RM.scene.axes(real)[0] || {}).id });
  const saved = RM.scene.toJSON(real);
  RM.scene.fromJSON(saved);
  const parsed = JSON.parse(saved);
  parsed.elements.filter(e => e.type !== 'axis' && rnd() < 0.2).slice(0, 2).forEach(e => {
    const c = RM.scene.fromJSON(saved), v = RM.scene.axisView(c, e.axis);
    RM.rays.bakeRefsTo(v, e.id, RM.scene.remove);
    RM.rays.solveScene(v);
    RM.scene.fromJSON(RM.scene.toJSON(c));
  });
  parsed.rays.filter(() => rnd() < 0.2).slice(0, 2).forEach(r => {
    const c = RM.scene.fromJSON(saved), v = RM.scene.axisView(c, r.axis);
    RM.rays.reverseRay(v, RM.scene.find(c, r.id));
    RM.rays.extendToImages(v, 1);
    RM.rays.solveScene(v);
    RM.scene.fromJSON(RM.scene.toJSON(c));
  });
}

// A longer or different run: RAYMAN_FUZZ_SEED=7 RAYMAN_FUZZ_N=20000 node --test tests/robustness.test.js
const FUZZ_SEED = +process.env.RAYMAN_FUZZ_SEED || 20261122, FUZZ_N = +process.env.RAYMAN_FUZZ_N || 400;

test('damaged scenes either fail to load with a reason, or work and reload after edits (fuzzing)', () => {
  const texts = sceneTexts(), rnd = random(FUZZ_SEED);
  let loaded = 0;
  texts.forEach(t => exercise(t, rnd));
  for (let i = 0; i < FUZZ_N; i++) {
    const text = JSON.stringify(mutate(JSON.parse(texts[i % texts.length]), rnd));
    try { RM.scene.fromJSON(text); }
    catch (err) {
      assert.equal(typeof err.message, 'string', 'a reason to show');
      continue;
    }
    loaded++;
    assert.doesNotThrow(() => exercise(text, rnd), 'case ' + i + ': ' + text.slice(0, 200));
  }
  assert.ok(loaded > FUZZ_N * 0.75, 'most damaged scenes still load: ' + loaded);
});
