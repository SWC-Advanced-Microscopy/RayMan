// The service worker must keep every file the page loads, or RayMan breaks offline.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

test('sw.js stores every local file index.html loads', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const core = JSON.parse(sw.match(/var CORE = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"'));
  const loaded = [...html.matchAll(/\b(?:src|href)="([^"#:?]+)"/g)].map(m => m[1])
    .filter(u => !u.endsWith('.html') && !u.endsWith('/') && fs.existsSync(path.join(root, u)));
  assert.ok(loaded.length >= 10, 'found the page\'s scripts and styles');
  loaded.forEach(u => assert.ok(core.includes(u), u + ' is not in sw.js CORE'));
  core.filter(u => u !== './').forEach(u => assert.ok(fs.existsSync(path.join(root, u)), u + ' listed in CORE does not exist'));
});
