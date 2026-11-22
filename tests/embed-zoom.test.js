// The enlarged embed: no close or zoom buttons; a reset button (left of Open in RayMan) in the top
// right; pinch and wheel zoom, panning with the hand cursor; no mm ruler on the web canvas.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const js = fs.readFileSync(path.join(ROOT, 'embed.js'), 'utf8');
const render = fs.readFileSync(path.join(ROOT, 'js/render.js'), 'utf8');

test('the enlarged view has the close cross top left, and no zoom buttons; Esc and a click outside also close', () => {
  assert.ok(!/rm-zoom|Zoom in|Zoom out|Reset the view/.test(js));
  assert.match(js, /tl\.appendChild\(x\);/);
  assert.match(js, /x\.addEventListener\('click', close\);/);
  assert.match(js, /if \(e\.key === 'Escape'\) close\(\);/);
  assert.match(js, /if \(e\.target === ov\) close\(\);/);
});

test('the enlarged bar has a reset button titled "Reset view", before Open in RayMan', () => {
  const bar = js.slice(js.indexOf('function bar(big, reset)'), js.indexOf('el.appendChild(bar(false, null))'));
  assert.match(bar, /button\('reset', '', 'Reset view'\)/);
  assert.match(bar, /rs\.addEventListener\('click', reset\)/);
  assert.ok(bar.indexOf('rs') < bar.indexOf("button('open'"), 'reset comes before Open in RayMan');
  assert.match(js, /panel\.appendChild\(bar\(true, big\.reset\)\);/);
});

test('the reset icon is a circular arrow in the icon table', () => {
  assert.match(js, /reset: '<path d="M2\.93 12\.5a7\.5 7\.5 0 1 0 1\.78-7\.8L\.83 8\.33M\.83 3\.33v5h5"\/>'/);
});

test('the enlarged canvas pans with the hand cursor, pinches and zooms with the wheel', () => {
  assert.match(js, /cv\.style\.cursor = 'grab'/);
  assert.match(js, /cv\.style\.cursor = 'grabbing'/);
  assert.match(js, /view\.pan\(e\.clientX - drag\.x/);
  assert.match(js, /view\.zoomAt\(p\.mx - r\.left, p\.my - r\.top, p\.d \/ pinch\.d\)/);   // two fingers
  assert.match(js, /addEventListener\('wheel'/);
});

test('the web canvas draws no mm ruler: the embed passes scale: false, and the renderer skips it', () => {
  assert.match(js, /axis: null, scale: false \}\);/);
  assert.match(render, /function grid\(ctx, view, theme, canvasWidth, canvasHeight, ruler, scale\)/);
  assert.match(render, /if \(scale === false\) return;/);
  assert.match(render, /grid\(ctx, state\.view, theme, canvasWidth, canvasHeight, state\.ruler, state\.scale\);/);
});

test('the small inline diagram is not live, so it still refits on resize', () => {
  assert.match(js, /if \(!live \|\| !moved\) fit\(w, h\);/);
});
