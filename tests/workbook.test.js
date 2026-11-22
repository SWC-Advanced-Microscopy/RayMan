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

test('an exercise\'s scene is inside its element, or fetched from data-src', async () => {
  const el = (src, inline) => ({ dataset: src ? { src } : {}, querySelector: () => inline ? { textContent: inline } : null });
  const asked = [];
  const files = { 'a.json': { ok: true, status: 200, text: async () => '{"scene":1}' }, 'gone.json': { ok: false, status: 404 } };
  const get = url => { asked.push(url); return Promise.resolve(files[url]); };
  assert.equal(await W.sceneText(el('a.json'), get), '{"scene":1}');
  assert.deepEqual(asked, ['a.json']);
  assert.equal(await W.sceneText(el('a.json', 'inline'), get), 'inline', 'a scene in the element needs no fetch');
  assert.equal(asked.length, 1);
  await assert.rejects(W.sceneText(el('gone.json'), get), /Could not load gone\.json \(404\)/);
  await assert.rejects(W.sceneText(el(null), get), /No scene: give data-src/);
});

test('the instructions for an exercise are the text of the element that is data-for it', () => {
  const found = { q1: '  Trace the\n   three rays. ', 'a"b]\nc': 'Odd id.' };
  const root = { querySelectorAll: () => Object.keys(found).map(id => ({ getAttribute: () => id, textContent: found[id] })) };
  assert.equal(W.instructionsFor(root, 'q1'), 'Trace the three rays.');
  assert.equal(W.instructionsFor(root, 'q2'), '');
  assert.equal(W.instructionsFor(root, 'a"b]\nc'), 'Odd id.', 'any id is matched as text: nothing to escape, nothing to throw');
});

test('answers loaded from a file or the browser are checked: only text answers are kept', () => {
  assert.equal(W.clean(null), null);
  assert.equal(W.clean({ scenes: null }), null, 'scenes: null used to pass (typeof null is "object") and crash Load');
  assert.equal(W.clean({ scenes: ['a'] }), null);
  assert.deepEqual(W.clean({ saved: 'soon', scenes: { q1: '{}', q2: { not: 'text' }, q3: 5 } }), { saved: 0, scenes: { q1: '{}' } });
  assert.equal(W.answersIn('<script type="application/json" id="rayman-answers">{"scenes":null}</script>'), null);
});

test('the workbook sends scenes only to the RayMan it opened', () => {
  assert.equal(W.targetOrigin('https://swcmicroscopy.com/RayMan/index.html?workbook'), 'https://swcmicroscopy.com');
  assert.equal(W.targetOrigin('http://localhost:8765/index.html?workbook'), 'http://localhost:8765');
  assert.equal(W.targetOrigin('file:///Users/x/RayMan/index.html?workbook'), '*', 'from disk there is no origin to name');
  const src = fs.readFileSync(path.join(root, 'workbook.js'), 'utf8');
  assert.doesNotMatch(src, /postMessage\([^)]*'\*'\)/, 'no message to just anyone');
});

test('the bar over RayMan shows the title and the instructions beside Back to workbook, and may grow', () => {
  const src = fs.readFileSync(path.join(root, 'workbook.js'), 'utf8');
  assert.match(src, /x\.instructions = instructionsFor\(document, x\.id\)/);
  assert.match(src, /if \(x\.instructions\) note\.appendChild\(document\.createTextNode\(x\.instructions\)\)/);
  assert.match(src, /\.rm-wb-top\{[^']*min-height:44px/, 'the bar grows with the text, not a fixed height');
  assert.match(src, /querySelector\('\.rm-wb-text'\)/, 'the text goes in its own element, not the first span (the back button holds one)');
});

test('the example workbook: scenes are .json files next to the page, f = 50 mm, objects at 1.75 f and f, hints on', () => {
  const dir = path.join(root, 'examples/workbook');
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.match(html, /<script src="\.\.\/\.\.\/workbook\.js" defer><\/script>/);
  const ex = [...html.matchAll(/<div class="rayman-exercise" id="([\w-]+)" data-src="([\w.-]+\.json)"[^>]*><\/div>/g)];
  assert.deepEqual(ex.map(m => m[1]), ['three-rays', 'infinity']);
  assert.ok(!/<script type="application\/json">/.test(html.slice(0, html.indexOf('<h2>Making'))), 'no scene written into the page');
  const zs = ex.map(m => {
    const s = S.fromJSON(fs.readFileSync(path.join(dir, m[2]), 'utf8'));
    const lens = s.elements.find(e => e.type === 'lens'), obj = s.elements.find(e => e.type === 'object');
    assert.equal(lens.f, 50);
    assert.equal(obj.h, 25, 'a clear arrow, a little under 0.75 of the lens half height');
    assert.equal(s.settings.colour, true, 'hints on');
    return (lens.z - obj.z) / lens.f;
  });
  assert.deepEqual(zs, [1.75, 1]);
  for (const m of ex) assert.match(html, new RegExp('class="rayman-instructions" data-for="' + m[1] + '">\\S'), m[1] + ' has instructions');
});
