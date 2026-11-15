// The help panel's footer: About, a dot, the GitHub logo, a dot, then the icon and "Install offline",
// which must be wired to an action in app.js (a data-act with no ACTIONS entry does nothing).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');

test('the help footer reads: About, dot, GitHub, dot, icon and Install offline', () => {
  const footer = html.match(/<p class="about-link">([\s\S]*?)<\/p>/)[1];
  const order = [...footer.matchAll(/data-act="about"|class="sep"|class="gh"|class="install"/g)].map(m => m[0]);
  assert.deepEqual(order, ['data-act="about"', 'class="sep"', 'class="gh"', 'class="sep"', 'class="install"']);
  assert.match(footer, /<button class="install"[^>]*>\s*<img src="images\/icons\/icon-192\.png"[^>]*>Install offline<svg class="ios-share"[\s\S]*<\/button>/);
});

test('the Install offline button runs an action that app.js defines', () => {
  assert.match(html, /data-act="install"/);
  assert.match(app, /var ACTIONS = \{[\s\S]*?\n    install: installOffline,/);
  assert.match(app, /function installOffline\(\)/);
});

test('the Share icon after Install offline shows only on iOS', () => {
  assert.match(html, /<button class="install"[\s\S]*?Install offline<svg class="ios-share"/);
  const css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');
  assert.match(css, /#help \.ios-share \{ display: none;/);
  assert.match(css, /html\.ios #help \.ios-share \{ display: inline-block; \}/);
  assert.match(app, /classList\.toggle\('ios', ios\)/);
});

test('the footer icon is in the offline cache', () => {
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.ok(sw.includes('images/icons/icon-192.png'));
});
