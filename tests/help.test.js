// The help pane (the ? panel in index.html): the wording and layout the lecturer asked for.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const help = html.slice(html.indexOf('id="help"'), html.indexOf('id="about"'));

test('the help pane has no long-winded asides it used to carry', () => {
  ['(dashed)', 'Virtual images are hidden', 'with pictures', 'Put a lens', 'can only be continued straight on',
    'as light does', 'magnification <b>M</b>'].forEach(s => assert.ok(!help.includes(s), 'still has: ' + s));
  assert.ok(help.includes('(must be enabled in Settings)'));
  assert.ok(help.includes('Full guide'));
  assert.ok(!help.includes('Toolbars'), 'the Toolbars section is removed');
});

test('the help pane keeps its title, with the close button on the same line', () => {
  assert.ok(help.includes('<div class="ph"><h2>How to use RayMan</h2><button class="close" data-act="help"'));
});

test('Tools come before Keys, so every button is in one place', () => {
  assert.ok(help.indexOf('<h3>Tools</h3>') < help.indexOf('>Keys</h3>'));
});

test('Double-click is bold in Drawing rays', () => {
  assert.ok(help.includes('<b>Double-click</b>'));
});

test('the small pictures in the help pane exist and are cached offline', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const imgs = [...help.matchAll(/<img src="(images\/help\/[^"]+)"/g)].map(m => m[1]);
  assert.equal(imgs.length, 3, 'three pictures');
  imgs.forEach(u => {
    assert.ok(fs.existsSync(path.join(ROOT, u)), u + ' exists');
    assert.ok(sw.includes("'" + u + "'"), u + ' is in sw.js CORE');
  });
});
