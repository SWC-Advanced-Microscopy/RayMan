// The tool rails: light/dark lives in Settings, a divider sits before File, and the buttons are close.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');

test('light/dark is a switch in Settings, not a rail button', () => {
  assert.ok(!/data-act="theme"/.test(html), 'the theme button should be gone from the rail');
  const settings = html.slice(html.indexOf('id="settings"'), html.indexOf('id="objects"'));
  assert.ok(/id="set-dark"/.test(settings), 'Settings holds the Dark mode switch');
});

test('a divider sits between Objects and File on the right rail', () => {
  const rail = html.slice(html.indexOf('id="rail"'), html.indexOf('</nav>', html.indexOf('id="rail"')));
  const file = rail.indexOf('data-act="menu"'), objects = rail.indexOf('data-act="objects"');
  const sep = rail.lastIndexOf('class="sep"', file);                       // the divider just above File
  assert.ok(objects < sep && sep < file, 'divider after Objects, before File');
});

test('rail buttons have no gap between them', () => {
  assert.match(css, /\.rail \.group \{ display: flex; flex-direction: column; gap: 0; \}/);
  assert.match(css, /\.rail \{[^}]*gap: 0;/);
});
