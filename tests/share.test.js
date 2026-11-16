// Sharing and embedding (issue #3): scenes in links, the embed code, the embed script's
// stamping on deploy, and the GitHub Pages workflow.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const S = require('../js/scene.js');
const Share = require('../js/share.js');

const root = path.join(__dirname, '..');

function bench() {
  const s = S.create();
  S.addLens(s, 0, 50);
  S.addObject(s, -120, 15);
  return s;
}

test('a scene survives the trip through a link, compressed', async () => {
  const text = S.toJSON(bench());
  const tok = await Share.encode(text);
  assert.equal(tok[0], 'z');
  assert.match(tok, /^[A-Za-z0-9_-]+$/, 'only characters that need no escaping in a URL');
  assert.ok(tok.length < text.length, 'shorter than the JSON');
  assert.equal(await Share.decode(tok), text);
  assert.equal(Share.tokenOf('#' + 'scene=' + tok), tok);
});

test('a plain (uncompressed) token opens too', async () => {
  const text = S.toJSON(bench());
  const tok = 'j' + Buffer.from(text).toString('base64url');
  assert.equal(await Share.decode(tok), text);
});

test('a damaged link says so', async () => {
  const tok = await Share.encode(S.toJSON(bench()));
  await assert.rejects(Share.decode(tok.slice(0, 20)), /damaged/);
  await assert.rejects(Share.decode('qabc'), /damaged/);
});

test('tokenOf finds a scene only in a #scene= hash', () => {
  assert.equal(Share.tokenOf(''), null);
  assert.equal(Share.tokenOf('#help'), null);
  assert.equal(Share.tokenOf('#scene=zAb-_9'), 'zAb-_9');
});

test('links point at the folder RayMan is served from; a copy on disk points at the public one', () => {
  assert.equal(Share.baseOf('https://example.org/RayMan/index.html?x=1#scene=z1'), 'https://example.org/RayMan/');
  assert.equal(Share.baseOf('http://localhost:8000/rayman/'), 'http://localhost:8000/rayman/');
  assert.equal(Share.baseOf('file:///Users/a/RayMan/index.html'), Share.PUBLIC);
  assert.equal(Share.link('https://x.org/R/', 'zab'), 'https://x.org/R/#scene=zab');
});

test('the embed code holds the scene, and a label cannot end its script early', () => {
  const s = bench();
  s.elements.find(e => e.type === 'lens').label = '</script><b>x';
  const code = Share.embedCode(S.toJSON(s), 'https://x.org/R/');
  assert.match(code, /^<script src="https:\/\/x\.org\/R\/embed\.js" defer><\/script>\n<div class="rayman"/);
  assert.equal(code.match(/<\/script>/g).length, 2, 'only the two real ends');
  const json = code.match(/<script type="application\/json">([\s\S]*?)<\/script>/)[1];
  assert.equal(S.fromJSON(json).elements.find(e => e.type === 'lens').label, '</script><b>x');
});

test('the fit box takes in the lens, the object and the image', () => {
  const s = S.ensureAxis(bench());
  const O = s.elements.find(e => e.type === 'object');
  const r1 = S.addRay(s, { at: { el: O.id, pt: 'tip' } });
  r1.nodes.push({ dir: { kind: 'parallel' }, end: { kind: 'next' } });
  const b = Share.box(s);
  assert.ok(b.z0 <= -120 && b.z1 >= 0 && b.y1 >= 15, JSON.stringify(b));
  assert.equal(Share.box(S.create()), null, 'no axis, nothing to show');
});

test('a hidden virtual image does not stretch the fit box', () => {
  const s = S.ensureAxis(JSON.parse(fs.readFileSync(path.join(root, 'examples', 'embed', 'two-lenses.json'), 'utf8')));
  assert.equal(s.settings.virtual, false);
  const hidden = Share.box(s);
  s.settings.virtual = true;
  const shown = Share.box(s);
  assert.ok(shown.z0 < hidden.z0 - 100, 'the objective\'s virtual image is far to the left');
  assert.ok(hidden.z0 > -100, JSON.stringify(hidden));
});

test('the menu has Copy share link and Copy embed code, wired to actions', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
  assert.match(html, /data-act="link"[^>]*>[\s\S]*?Copy share link/);
  assert.match(html, /data-act="embed"[^>]*>[\s\S]*?Copy embed code/);
  assert.match(app, /link: copyShareLink, embed: copyEmbedCode/);
});

test('embed.js loads the drawing code that exists, and the deploy stamps those names', () => {
  const src = fs.readFileSync(path.join(root, 'embed.js'), 'utf8');
  const files = JSON.parse(src.match(/var FILES = (\[[^\]]*\]);/)[1].replace(/'/g, '"'));
  files.forEach(f => assert.ok(fs.existsSync(path.join(root, f)), f));
  assert.ok(files.indexOf('js/share.js') > files.indexOf('js/rays.js'), 'share.js after what it needs');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-stamp-'));
  fs.mkdirSync(path.join(tmp, 'js'));
  files.forEach(f => fs.copyFileSync(path.join(root, f), path.join(tmp, f)));
  fs.copyFileSync(path.join(root, 'embed.js'), path.join(tmp, 'embed.js'));
  fs.writeFileSync(path.join(tmp, 'page.html'), '<script src="embed.js"></script>');
  execFileSync('python3', [path.join(root, 'tools', 'stamp-assets.py'), tmp]);
  const out = fs.readFileSync(path.join(tmp, 'embed.js'), 'utf8');
  files.forEach(f => assert.match(out, new RegExp("'" + f.replace('.', '\\.') + "\\?v=[0-9a-f]{10}'")));
  assert.match(fs.readFileSync(path.join(tmp, 'page.html'), 'utf8'), /embed\.js\?v=[0-9a-f]{10}/);
  fs.rmSync(tmp, { recursive: true });
});

test('the deploy leaves data-src alone: authors write it plainly, so the example page must too', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-stamp-'));
  fs.writeFileSync(path.join(tmp, 'scene.json'), '{}');
  fs.writeFileSync(path.join(tmp, 'page.html'), '<img src="scene.json"><div class="rayman" data-src="scene.json"></div>');
  execFileSync('python3', [path.join(root, 'tools', 'stamp-assets.py'), tmp]);
  const out = fs.readFileSync(path.join(tmp, 'page.html'), 'utf8');
  assert.match(out, /<img src="scene\.json\?v=[0-9a-f]{10}">/, 'src is stamped');
  assert.match(out, / data-src="scene\.json">/, 'data-src is not');
  fs.rmSync(tmp, { recursive: true });
});

test('the Pages workflow deploys a stamped copy without the development files', () => {
  const wf = fs.readFileSync(path.join(root, '.github', 'workflows', 'pages.yml'), 'utf8');
  ['Claude', 'CLAUDE.md', 'tests', 'tools', '.github', '*.sh'].forEach(x =>
    assert.ok(wf.includes("--exclude='" + x + "'"), 'excludes ' + x));
  assert.match(wf, /python3 tools\/stamp-assets\.py _site/);
  assert.match(wf, /actions\/deploy-pages@/);
});

test('the example page embeds scenes with embed.js', () => {
  const html = fs.readFileSync(path.join(root, 'examples', 'embed', 'index.html'), 'utf8');
  assert.match(html, /<script src="\.\.\/\.\.\/embed\.js" defer><\/script>/);
  [...html.matchAll(/<div class="rayman" data-src="([^"]+)"/g)].forEach(m =>
    assert.ok(fs.existsSync(path.join(root, 'examples', 'embed', m[1])), m[1]));
  assert.match(html, /<script type="application\/json">/);
});
