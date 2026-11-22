/* RayMan workbook: a web page of exercises, each a RayMan diagram the student works on.

     <script src="https://swcmicroscopy.com/RayMan/workbook.js" defer></script>
     <div class="rayman-workbook-bar"></div>                      (optional: where Save and Load go)
     <p>Trace the three rays from the tip of the object.</p>
     <p><span class="rayman-instructions" data-for="three-rays">Trace the three rays…</span></p>
     <div class="rayman-exercise" id="three-rays" data-src="three-rays.json" data-title="Three rays"></div>

   The scene is a .json file saved from RayMan, next to the page (data-src; the page must be served
   from a web address, since browsers will not fetch files for a page opened from disk). It can also
   be inside the element: <script type="application/json">{ … }</script>. data-height and data-theme
   work as in embed.js. The instructions, in an element with class rayman-instructions and
   data-for the exercise's id, are shown in the bar above RayMan, beside Back to workbook. Clicking an exercise opens RayMan over the page (an iframe, index.html?workbook);
   every change the student makes comes back to the page (postMessage), so the page may be served
   from any site. "Back to workbook" closes RayMan, and the diagram in the page shows the work.

   The answers are kept in the browser (localStorage), so a reload loses nothing. Save downloads
   a copy of the whole page with the answers written into it: opening that file brings them
   back, and so does Load (choose the saved file) in the page online, e.g. on an iPad.
   Each exercise needs a lasting id (its id attribute) for its answer to find it again.
   Optional on the script tag: data-rayman="https://…/", the RayMan to use (default: the one
   this script came from). */
(function () {
  'use strict';

  var ANSWERS_ID = 'rayman-answers';

  // ---------------------------------------------------------------- pure helpers (tested in node)

  /** Of two answer records ({ saved: ms, scenes: { id: scene text } }, or null), the newer. */
  function pick(a, b) {
    if (!a || !a.scenes) return b && b.scenes ? b : null;
    if (!b || !b.scenes) return a;
    return (b.saved || 0) > (a.saved || 0) ? b : a;
  }

  var ANSWERS_RE = /<script[^>]*\bid="rayman-answers"[^>]*>[\s\S]*?<\/script>\s*/gi;

  /** The answer record written into a page (a saved workbook), or null. */
  function answersIn(html) {
    var m = /<script[^>]*\bid="rayman-answers"[^>]*>([\s\S]*?)<\/script>/i.exec(html || '');
    if (!m) return null;
    try { var r = JSON.parse(m[1]); return r && typeof r.scenes === 'object' ? r : null; }
    catch (e) { return null; }
  }

  /** The page's HTML with record written into it (in place of any record already there), and a
      <base> pointing at where the page came from, so a copy opened from disk still finds its
      scripts, pictures and scene files. '<' is escaped so no text can end the script early. */
  function withAnswers(html, record, pageUrl) {
    var json = JSON.stringify(record).replace(/</g, '\\u003c');
    var tag = '<script type="application/json" id="' + ANSWERS_ID + '">' + json + '</script>\n';
    var out = html.replace(ANSWERS_RE, '');
    var end = out.toLowerCase().lastIndexOf('</body>');
    out = end < 0 ? out + tag : out.slice(0, end) + tag + out.slice(end);
    if (pageUrl && !/<base\b/i.test(out)) {
      var base = '<base href="' + pageUrl.replace(/[#].*$/, '').replace(/"/g, '%22') + '">';
      out = out.replace(/<head\b[^>]*>/i, function (h) { return h + base; });
    }
    return out;
  }

  /** A file name for the saved copy, from the page's title. */
  function fileName(title) {
    var s = String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return (s || 'workbook') + '-answers.html';
  }

  /** The exercise's starting scene as text: inside the element, else fetched from its data-src
      (get = fetch, or a stand-in). Rejects with a message to show if there is neither, or the
      file is not there. */
  function sceneText(el, get) {
    var inline = el.querySelector('script[type="application/json"]');
    if (inline) return Promise.resolve(inline.textContent);
    if (!el.dataset.src) return Promise.reject(new Error('No scene: give data-src, or the scene inside the element.'));
    return (get || fetch)(el.dataset.src).then(function (r) {
      if (!r.ok) throw new Error('Could not load ' + el.dataset.src + ' (' + r.status + ').');
      return r.text();
    });
  }

  /** The instructions for exercise id: the text of the element with class rayman-instructions and
      data-for that id, in root (the document), or '' if there is none. */
  function instructionsFor(root, id) {
    var el = root.querySelector('.rayman-instructions[data-for="' + String(id).replace(/["\\]/g, '\\$&') + '"]');
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  var H = { pick: pick, answersIn: answersIn, withAnswers: withAnswers, fileName: fileName,
            sceneText: sceneText, instructionsFor: instructionsFor };
  if (typeof module === 'object' && module.exports) { module.exports = H; return; }

  // ---------------------------------------------------------------- the page

  if (window.RayManWorkbook) return;
  window.RayManWorkbook = H;

  // The page as written, before this script changes anything: what Save writes out.
  var PAGE = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
  var me = document.currentScript || document.querySelector('script[src*="workbook.js"]');
  var BASE = me.src.replace(/[?#].*$/, '').replace(/[^/]*$/, '');
  var RAYMAN = me.getAttribute('data-rayman') || BASE;
  if (!/\/$/.test(RAYMAN)) RAYMAN += '/';
  var KEY = 'rayman.workbook:' + location.pathname;
  var E, RM, record = { saved: 0, scenes: {} }, exercises = [];

  /** The saved answers record from the browser, or null. */
  function stored() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } }
  /** Save the answers record in the browser. */
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(record)); } catch (e) { /* private mode etc. */ } }

  /** Load embed.js if it is not already loaded, and return its drawing pieces. */
  function embedJs() {
    if (window.RayManEmbed) return Promise.resolve(window.RayManEmbed);
    return new Promise(function (ok, fail) {
      var s = document.createElement('script');
      s.src = BASE + 'embed.js';
      s.onload = function () { ok(window.RayManEmbed); };
      s.onerror = function () { fail(new Error('RayMan could not be loaded from ' + BASE)); };
      document.head.appendChild(s);
    });
  }

  var CSS = [
    '.rayman-exercise{position:relative;display:block;width:100%;border-radius:10px;overflow:hidden;background:#fafbfc;cursor:pointer}',
    '.rayman-exercise.rm-dark{background:#060913}',
    '.rayman-exercise>script{display:none}',
    '.rayman-exercise canvas{position:absolute;inset:0;width:100%;height:100%;display:block}',
    '.rayman-exercise .rm-bar{opacity:1}',
    '.rayman-exercise .rm-btn[hidden]{display:none}',             // .rm-btn's all:unset would show it
    '.rm-wb-tools{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:12px 0}',
    '.rm-wb-tools .rm-btn{position:static}',
    '.rm-wb-note{font:13px system-ui,-apple-system,"Segoe UI",sans-serif;color:#7a8396}',
    '.rm-wb-over{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;background:#fafbfc}',
    '.rm-wb-over.rm-away{visibility:hidden;pointer-events:none}',
    '.rm-wb-top{display:flex;align-items:flex-start;gap:12px;min-height:44px;max-height:35vh;overflow-y:auto;padding:6px 12px 6px 8px;flex:none;box-sizing:border-box;',
    'font:14px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1c2230;background:#eef1f6;border-bottom:1px solid rgba(20,30,60,.14)}',
    '.rm-wb-top .rm-btn{flex:none}',
    '.rm-wb-text{flex:1;min-width:0;align-self:center}',
    '.rm-wb-top b{margin-right:6px}',
    '.rm-wb-over iframe{flex:1;width:100%;border:0;display:block}',
    '.rm-wb-wait{position:absolute;inset:44px 0 0;display:grid;place-items:center;font:14px system-ui,sans-serif;color:#7a8396;z-index:-1}'
  ].join('');

  function style() {
    E.styles();
    var s = document.createElement('style');
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function say(text) { window.alert(text); }

  // ---------------------------------------------------------------- one exercise

  /** A scene as RayMan holds it: the text it sends back for an unchanged exercise. */
  function scene(text) {
    var s = RM.scene.ensureAxis(RM.scene.fromJSON(text));
    RM.share.passMirrors(s);
    return s;
  }

  function Exercise(el, i, start) {
    var x = { el: el, id: el.id || 'exercise-' + (i + 1), start: RM.scene.toJSON(scene(start)), canvas: null };
    x.title = el.dataset.title || 'Exercise ' + (i + 1);
    x.instructions = instructionsFor(document, x.id);
    var theme = function () { return E.themeOf(el); };
    var bar = document.createElement('div');
    bar.className = 'rm-bar';
    var work = E.button('edit', 'Work on this', 'Open this exercise in RayMan');
    var reset = E.button('reset', 'Start again', 'Put this exercise back as it was at the start');
    work.addEventListener('click', function (e) { e.stopPropagation(); open(x); });
    reset.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!window.confirm('Start "' + x.title + '" again? Your work on it will be lost.')) return;
      delete record.scenes[x.id]; record.saved = Date.now(); persist(); x.draw();
    });
    bar.appendChild(reset); bar.appendChild(work);
    el.appendChild(bar);
    el.addEventListener('click', function () { open(x); });
    x.text = function () { return record.scenes[x.id] || x.start; };
    x.draw = function () {
      el.classList.toggle('rm-dark', theme() === 'dark');
      if (x.canvas) x.canvas.stop();
      var s;
      try { s = scene(x.text()); } catch (err) { s = scene(x.start); }
      x.canvas = E.Canvas(el, s, theme);
      x.canvas.cv.setAttribute('aria-label', x.title + (record.scenes[x.id] ? ' (your work)' : ''));
      reset.hidden = !record.scenes[x.id];
    };
    x.draw();
    return x;
  }

  function setup(el, i) {
    if (el.clientHeight < 20) {
      if (el.dataset.height) el.style.height = parseFloat(el.dataset.height) + 'px';
      else el.style.aspectRatio = '2 / 1';
    }
    return sceneText(el).then(function (t) { return Exercise(el, i, t); })
      .catch(function (err) {
        var m = document.createElement('div');
        m.className = 'rm-msg'; m.textContent = 'RayMan exercise: ' + err.message;
        el.appendChild(m);
        return null;
      });
  }

  // ---------------------------------------------------------------- RayMan over the page

  var over = null, frame = null, ready = false, current = null, overflow = '';

  function overlay() {
    if (over) return;
    over = document.createElement('div');
    over.className = 'rm-wb-over rm-away';
    over.setAttribute('role', 'dialog'); over.setAttribute('aria-modal', 'true');
    var top = document.createElement('div');
    top.className = 'rm-wb-top';
    var back = E.button('back', 'Back to workbook', 'Close RayMan and go back to the workbook');
    back.addEventListener('click', close);
    var title = document.createElement('div');
    title.className = 'rm-wb-text';
    top.appendChild(back); top.appendChild(title);
    var wait = document.createElement('div');
    wait.className = 'rm-wb-wait'; wait.textContent = 'Opening RayMan…';
    frame = document.createElement('iframe');
    frame.title = 'RayMan';
    frame.allow = 'clipboard-write';
    over.appendChild(top); over.appendChild(frame); over.appendChild(wait);
    document.body.appendChild(over);
    window.addEventListener('message', function (e) {
      var d = e.data;
      if (!frame || e.source !== frame.contentWindow || !d) return;
      if (d.rayman === 'ready') { ready = true; send(); }
      else if (d.rayman === 'scene' && typeof d.scene === 'string') changed(d.id, d.scene);
    });
    frame.src = RAYMAN + 'index.html?workbook';
  }

  function send() {
    if (ready && current) frame.contentWindow.postMessage({ rayman: 'open', id: current.id, scene: current.text() }, '*');
  }

  function open(x) {
    overlay();
    current = x;
    var note = over.querySelector('.rm-wb-text');
    note.textContent = '';
    var t = document.createElement('b');
    t.textContent = x.title;
    note.appendChild(t);
    if (x.instructions) note.appendChild(document.createTextNode(x.instructions));
    over.classList.remove('rm-away');
    overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    send();
    try { frame.focus(); } catch (e) { /* fine */ }
  }

  function close() {
    over.classList.add('rm-away');
    document.body.style.overflow = overflow;
    var x = current;
    current = null;
    if (x) { x.draw(); x.el.scrollIntoView({ block: 'nearest' }); }
  }

  /** A change from RayMan: the exercise's answer (none if it is back to the start). */
  function changed(id, text) {
    var x = exercises.filter(function (e) { return e.id === id; })[0];
    if (!x) return;
    if (text === x.start) delete record.scenes[id];
    else record.scenes[id] = text;
    record.saved = Date.now();
    persist();
    x.draw();
  }

  // ---------------------------------------------------------------- Save and Load

  function save() {
    var html = withAnswers(PAGE, record, location.href);
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    a.download = fileName(document.title);
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function load(file) {
    file.text().then(function (html) {
      var r = answersIn(html);
      if (!r) return say('There are no workbook answers in ' + file.name + '. Choose a page saved with Save.');
      var known = exercises.filter(function (x) { return r.scenes[x.id]; }).length;
      if (!known) return say(file.name + ' holds answers to a different workbook.');
      record = { saved: Date.now(), scenes: r.scenes };
      persist();
      exercises.forEach(function (x) { x.draw(); });
    });
  }

  function tools() {
    var box = document.querySelector('.rayman-workbook-bar');
    if (!box) {
      box = document.createElement('div');
      var first = exercises[0] && exercises[0].el;
      if (first) first.parentNode.insertBefore(box, first);
      else document.body.appendChild(box);
    }
    box.classList.add('rm-wb-tools');
    var s = E.button('download', 'Save', 'Save this workbook, with your answers, as a web page');
    s.addEventListener('click', save);
    var l = E.button('upload', 'Load', 'Load the answers from a workbook you saved');
    var input = document.createElement('input');
    input.type = 'file'; input.accept = '.html,.htm,text/html'; input.hidden = true;
    l.addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function () { if (input.files[0]) load(input.files[0]); input.value = ''; });
    var note = document.createElement('span');
    note.className = 'rm-wb-note';
    note.textContent = 'Your work is kept in this browser. Save to keep a copy.';
    box.appendChild(s); box.appendChild(l); box.appendChild(input); box.appendChild(note);
  }

  function start() {
    embedJs().then(function (e) { E = e; return E.load(); }).then(function () {
      RM = window.RM;
      style();
      record = pick(stored(), answersIn(PAGE)) || record;
      if (!record.scenes) record = { saved: 0, scenes: {} };
      var els = Array.prototype.slice.call(document.querySelectorAll('.rayman-exercise'));
      return Promise.all(els.map(setup));
    }).then(function (xs) {
      exercises = xs.filter(Boolean);
      tools();
    }).catch(function (err) { say('RayMan workbook: ' + err.message); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
