// Workbooks (issue #15): a page of exercises opens RayMan over itself, gets each change back,
// keeps the answers in the browser, and saves a copy of itself with the answers inside.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const W = require('../workbook.js');
const S = require('../js/scene.js');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');

const PAGE = '<!DOCTYPE html>\n<html><head><title>T</title></head><body><p>x</p></body></html>';

test('the newer answer record wins; a missing one never does', () => {
  const a = { saved: 1, scenes: { q: 'a' } }, b = { saved: 2, scenes: { q: 'b' } };
  assert.equal(W.pick(a, b), b);
  assert.equal(W.pick(b, a), b);
  assert.equal(W.pick(null, a), a);
  assert.equal(W.pick(a, null), a);
  assert.equal(W.pick(null, null), null);
  assert.equal(W.pick({ junk: 1 }, a), a);
});

test('a saved page holds the answers, once, and they come back out', () => {
  const rec = { saved: 5, scenes: { q1: '{"label":"</script><b>"}' } };
  const once = W.withAnswers(PAGE, rec, 'https://x.org/wb/index.html#top');
  assert.deepEqual(W.answersIn(once), rec);
  assert.ok(!/<\/script><b>/.test(once.replace(/<\/script>\n<\/body>/, '')), 'no text ends the script early');
  assert.match(once, /<head><base href="https:\/\/x\.org\/wb\/index\.html">/, 'a <base> so the copy finds its files');
  const rec2 = { saved: 9, scenes: { q1: 'new' } };
  const twice = W.withAnswers(once, rec2, 'file:///Users/me/Downloads/t.html');
  assert.equal((twice.match(/id="rayman-answers"/g) || []).length, 1, 'the old record replaced');
  assert.equal((twice.match(/<base /g) || []).length, 1, 'the first <base> kept');
  assert.deepEqual(W.answersIn(twice), rec2);
  assert.equal(W.answersIn(PAGE), null);
  assert.equal(W.answersIn('<script id="rayman-answers">not json</script>'), null);
});

test('the saved file is named from the page title', () => {
  assert.equal(W.fileName('RayMan Workbook: one lens'), 'rayman-workbook-one-lens-answers.html');
  assert.equal(W.fileName(''), 'workbook-answers.html');
});

test('in a workbook, RayMan sends changes to the page and leaves its own autosave alone', () => {
  assert.match(app, /var WORKBOOK = \/\[\?&\]workbook\\b\/\.test\(location\.search\) && window\.parent !== window;/);
  assert.match(app, /if \(!WORKBOOK\) store\(STORE_KEY, snap\);/);
  assert.equal((app.match(/store\(STORE_KEY/g) || []).length, 1, 'every save of the scene goes through keep()');
  assert.match(app, /if \(hist\.push\(S\.toJSON\(st\.real\)\)\) keep\(hist\.current\(\)\);/);
  assert.match(app, /var saved = WORKBOOK \? null : stored\(STORE_KEY\)/, 'starts with an empty bench');
  assert.match(app, /if \(e\.source !== window\.parent/, 'only the page that holds it can open an exercise');
  assert.match(app, /!shared && !WORKBOOK\) showAbout\(\)/, 'no splash');
});

test('History.reset forgets every step', () => {
  const h = new S.History();
  h.push('a'); h.push('b');
  h.reset();
  assert.equal(h.canUndo(), false);
  assert.equal(h.current(), undefined);
  h.push('c');
  assert.equal(h.current(), 'c');
  assert.equal(h.canUndo(), false);
});

test('the deploy stamps the embed.js that workbook.js loads', () => {
  const src = fs.readFileSync(path.join(root, 'workbook.js'), 'utf8');
  assert.match(src, /BASE \+ 'embed\.js'/);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-stamp-'));
  fs.copyFileSync(path.join(root, 'embed.js'), path.join(tmp, 'embed.js'));
  fs.copyFileSync(path.join(root, 'workbook.js'), path.join(tmp, 'workbook.js'));
  execFileSync('python3', [path.join(root, 'tools', 'stamp-assets.py'), tmp]);
  assert.match(fs.readFileSync(path.join(tmp, 'workbook.js'), 'utf8'), /BASE \+ 'embed\.js\?v=[0-9a-f]{10}'/);
  fs.rmSync(tmp, { recursive: true });
});

test('the example workbook: two exercises with lasting ids, f = 50 mm, objects at 1.75 f and f, hints on', () => {
  const html = fs.readFileSync(path.join(root, 'examples/workbook/index.html'), 'utf8');
  assert.match(html, /<script src="\.\.\/\.\.\/workbook\.js" defer><\/script>/);
  const ex = [...html.matchAll(/<div class="rayman-exercise" id="([\w-]+)"[^>]*>\s*<script type="application\/json">([^<]*)<\/script>/g)];
  assert.deepEqual(ex.map(m => m[1]), ['three-rays', 'infinity']);
  const zs = ex.map(m => {
    const s = S.fromJSON(m[2]);
    const lens = s.elements.find(e => e.type === 'lens'), obj = s.elements.find(e => e.type === 'object');
    assert.equal(lens.f, 50);
    assert.equal(s.settings.colour, true, 'hints on');
    return (lens.z - obj.z) / lens.f;
  });
  assert.deepEqual(zs, [1.75, 1]);
});
