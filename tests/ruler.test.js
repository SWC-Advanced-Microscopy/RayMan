// The ruler's numbers: a nice step that keeps about 10 to 15 across the bench at any zoom.
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../js/geom.js');

const NICE = [1, 2, 5];
function isNice(x) {
  const p = Math.pow(10, Math.floor(Math.log10(x) + 1e-9));
  return NICE.some(m => Math.abs(x - m * p) < 1e-9 * x);
}

test('the ruler step is a nice number (1, 2 or 5 x 10^n)', () => {
  for (let s = 0.05; s <= 80; s *= 1.07) {
    assert.ok(isNice(G.rulerStep(s, 1300)), 'not nice at ' + s + ': ' + G.rulerStep(s, 1300));
  }
  assert.equal(G.rulerStep(3, 1300), 50);      // raw 1300/16/3 = 27 mm, so the next nice step, 50
});

test('about 10 to 15 numbers across the bench at every zoom', () => {
  [1300, 1000, 800].forEach(W => {
    for (let s = 0.05; s <= 80; s *= 1.07) {
      const n = W / (G.rulerStep(s, W) * s);     // numbers across the width
      assert.ok(n >= 5 && n <= 16, `W ${W}, ${s.toFixed(2)} px/mm: ${n.toFixed(1)} numbers`);
    }
  });
});

test('on narrow screens the numbers are never closer than 56 px', () => {
  for (let s = 0.05; s <= 80; s *= 1.07) {
    const step = G.rulerStep(s, 420);
    assert.ok(step * s >= 56 - 1e-9, `${s.toFixed(2)} px/mm: ${(step * s).toFixed(0)} px`);
  }
});

// #9: the bottom readout and the hint pill are gone; the cursor's marker lives in the renderer.
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
const render = fs.readFileSync(path.join(ROOT, 'js/render.js'), 'utf8');

test('the bottom readout and the hint pill are removed', () => {
  assert.ok(!/id="(hint|coords|rulerline)"/.test(html));
  assert.ok(!/showHint|forDevice|TOOL_HINTS/.test(app));
});

test('the ruler marker is drawn by the renderer, mouse only, and covers the numbers it touches', () => {
  assert.match(app, /st\.ruler = on \? \{ px: p\.px, z: view\.z\(p\.px\) \} : null;/);
  assert.match(app, /if \(e\.pointerType === 'touch'\) \{\s+rulerMarker\(e, p\);/);
  assert.match(render, /if \(covered\(x, ctx\.measureText\(s\)\.width \/ 2\)\) continue;/);
});
