// Characterisation ("golden") tests for the readability refactor (#17): every example scene is
// solved and drawn onto a recording canvas, and the result is compared with a stored copy
// (tests/golden.json). Renaming variables or moving code must not change a single number.
// After a change that is MEANT to alter the output: UPDATE_GOLDEN=1 node --test tests/golden.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const GOLDEN = path.join(__dirname, 'golden.json');

// the browser scripts, loaded the way a page loads them (a shared RM object)
const sandbox = { Path2D: class { constructor() { this.ops = []; } }, console };
['moveTo', 'lineTo', 'arc', 'rect', 'closePath', 'quadraticCurveTo', 'bezierCurveTo', 'ellipse', 'roundRect']
  .forEach(m => { sandbox.Path2D.prototype[m] = function () { this.ops.push([m].concat([...arguments])); }; });
sandbox.self = sandbox; sandbox.RM = {};
vm.createContext(sandbox);
['geom', 'scene', 'rays', 'snap', 'view', 'render'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8'), sandbox, { filename: f + '.js' }));
const RM = sandbox.RM;

const round = v => typeof v === 'number' ? Math.round(v * 1000) / 1000 : v;

/** A canvas context that records every call and property set, with numbers rounded. */
function recorder() {
  const log = [];
  const rec = v => v && v.ops ? ['path', v.ops.map(o => o.map(round))] : (v && typeof v === 'object' ? 'obj' : round(v));
  return {
    log,
    ctx: new Proxy({}, {
      get: (t, name) => name === 'measureText' ? s => ({ width: String(s).length * 6 })
        : name in t ? t[name] : function () {
          log.push([name].concat([...arguments].map(rec)));
          if (/^create/.test(name)) return { addColorStop() { log.push(['stop'].concat([...arguments].map(rec))); } };
        },
      set: (t, name, v) => { log.push(['=' + String(name), rec(v)]); t[name] = v; return true; }
    })
  };
}

function sceneFiles() {
  const out = [];
  (function walk(d) {
    fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.json') && !e.name.startsWith('golden') && !e.name.startsWith('manifest') && !e.name.startsWith('bundle')) out.push(p);
    });
  })(path.join(root, 'examples'));
  fs.readdirSync(path.join(__dirname, 'scenes')).forEach(n => out.push(path.join(__dirname, 'scenes', n)));
  return out.sort();
}

function stateFor(scene, extra) {
  const view = new RM.View();
  view.s = 4; view.ox = 400; view.oy = 250;
  const real = RM.scene.ensureAxis(scene);
  return Object.assign({ scene: real, real, view, theme: 'light', tool: 'select', sel: null, hover: null,
    ghost: null, hints: null, hotFocal: null, axisHot: false, draft: null, caption: null,
    axis: (RM.scene.axes(real)[0] || {}).id }, extra);
}

function snapshot() {
  const snap = {};
  sceneFiles().forEach(file => {
    const name = path.relative(root, file);
    const text = fs.readFileSync(file, 'utf8');
    const entry = {};
    const solved = RM.rays.solveAll ? RM.rays.solveAll(RM.scene.ensureAxis(RM.scene.fromJSON(text))) : null;
    entry.solve = JSON.parse(JSON.stringify(solved, (k, v) => round(v)));
    const whole = RM.scene.ensureAxis(RM.scene.fromJSON(text));
    RM.scene.axes(whole).forEach(ax => {
      const sol = RM.rays.solveScene(RM.scene.axisView(whole, ax.id));
      entry['scene-' + ax.id] = JSON.parse(JSON.stringify(sol, (k, v) => round(v)));
    });
    const variants = { plain: {}, dark: { theme: 'dark' }, rayTool: { tool: 'ray' }, noRuler: { ruler: false, scale: false } };
    const probe = stateFor(RM.scene.fromJSON(text), {});
    probe.scene.elements.forEach(e => {
      variants['sel-' + e.id] = { sel: e.id };
      variants['hover-' + e.id] = { hover: e.id, tool: 'ray' };
    });
    entry.draw = {};
    Object.keys(variants).forEach(v => {
      const st = stateFor(RM.scene.fromJSON(text), variants[v]);
      const r = recorder();
      RM.render.draw(r.ctx, 800, 500, st);
      entry.draw[v] = crypto.createHash('sha1').update(JSON.stringify(r.log)).digest('hex') + ':' + r.log.length;
    });
    snap[name] = entry;
  });
  return snap;
}

test('every example scene solves and draws exactly as before the refactor', () => {
  const now = JSON.parse(JSON.stringify(snapshot()));
  if (process.env.UPDATE_GOLDEN || !fs.existsSync(GOLDEN)) {
    fs.writeFileSync(GOLDEN, JSON.stringify(now));
    return;
  }
  const then = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  assert.deepEqual(Object.keys(now), Object.keys(then), 'same scenes');
  Object.keys(then).forEach(name => {
    Object.keys(then[name]).filter(k => k !== 'draw').forEach(k =>
      assert.deepEqual(now[name][k], then[name][k], name + ' [' + k + ']: solver output changed'));
    Object.keys(then[name].draw).forEach(v =>
      assert.equal(now[name].draw[v], then[name].draw[v], name + ' [' + v + ']: drawing changed'));
  });
});

test('the golden snapshot is not trivially empty', () => {
  const g = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  const names = Object.keys(g);
  assert.ok(names.length >= 10);
  names.forEach(n => {
    assert.ok(Number(g[n].draw.plain.split(':')[1]) > 50, n + ' draws something');
    if (!/workbook/.test(n)) assert.ok(Object.keys(g[n].solve).length > 0, n + ' solves to something');
  });
});
