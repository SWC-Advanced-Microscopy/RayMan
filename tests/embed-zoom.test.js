// The enlarged embed: zoom buttons at the top left (+, 0, −), panning with the hand cursor, the wheel.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const js = fs.readFileSync(path.join(ROOT, 'embed.js'), 'utf8');

test('the enlarged view has zoom in, reset and zoom out, top left with the close button', () => {
  assert.match(js, /\['\+', 'Zoom in', 1\.25\], \['0', 'Reset the view', 0\], \['\u2212', 'Zoom out', 0\.8\]/);
  assert.match(js, /tl\.appendChild\(x\);/);                           // close first, then the zoom buttons
});

test('the enlarged canvas pans with the hand cursor and zooms with the wheel', () => {
  assert.match(js, /cv\.style\.cursor = 'grab'/);
  assert.match(js, /cv\.style\.cursor = 'grabbing'/);
  assert.match(js, /view\.pan\(e\.clientX - drag\.x/);
  assert.match(js, /addEventListener\('wheel'/);
});

test('the small inline diagram is not live, so it still refits on resize', () => {
  assert.match(js, /if \(!live \|\| !moved\) fit\(w, h\);/);
});
