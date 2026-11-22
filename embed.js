/* RayMan embed: draws RayMan scenes, read-only, in any web page.

     <script src="https://swcmicroscopy.com/RayMan/embed.js" defer></script>
     <div class="rayman" data-src="lens.json"></div>

   The scene comes from data-src (a .json saved by RayMan, relative to the page), or from a
   <script type="application/json"> inside the element (what RayMan's "Copy embed code" gives).
   Optional attributes:
     data-height="320"            height in px (default: half the width, or the element's own CSS height)
     data-theme="light|dark|auto" colours (default light; auto follows the reader's system)
     data-alt="…"                 what the diagram shows, for screen readers
     data-enlarge="off"           no Enlarge button (enlarged: drag to pan, pinch or wheel to zoom,
                                  and a reset button returns to the start)
     data-open="off"              no Open in RayMan button
     data-rayman="https://…/"     the RayMan that opens it (default: the one this script came from)
   If that RayMan cannot be reached, Open in RayMan becomes Download RayMan file.

   This script loads RayMan's own drawing code (FILES) from its folder, so diagrams look exactly
   as in RayMan. The deploy stamps those names with ?v= (tools/stamp-assets.py). */
/* Short names used in this file:
     el       the page element that holds a diagram (class "rayman"); e: a DOM event
     b        a button; d: a distance between two fingers; ptrs: the pointers down, by id
     x, y, w, h   a screen position, width and height in pixels; t: a time or theme; n: a count
     ok, fail the resolve and reject functions of a promise; r: a response or ray; s: a string or style element */

(function () {
  'use strict';
  if (window.RayManEmbed) { window.RayManEmbed.scan(); return; }

  var FILES = ['js/geom.js', 'js/scene.js', 'js/rays.js', 'js/view.js', 'js/render.js', 'js/share.js'];
  var me = document.currentScript || document.querySelector('script[src*="embed.js"]');
  var BASE = me.src.replace(/[?#].*$/, '').replace(/[^/]*$/, '');
  var RM, ready = null, reach = {};

  /** Load the RayMan scripts once; later calls get the same promise. */
  function load() {
    if (ready) return ready;
    ready = FILES.reduce(function (p, f) {
      return p.then(function () {
        return new Promise(function (ok, fail) {
          var s = document.createElement('script');
          s.src = BASE + f; s.onload = ok;
          s.onerror = function () { fail(new Error('RayMan could not be loaded from ' + BASE)); };
          document.head.appendChild(s);
        });
      });
    }, Promise.resolve()).then(function () { RM = window.RM; });
    return ready;
  }

  /** Whether RayMan is at url: loading one of its pictures works across sites, with no help
      from the server (a fetch would need CORS). Resolves true or false. */
  function reachable(url) {
    if (!reach[url]) reach[url] = new Promise(function (ok) {
      var img = new Image(), t = setTimeout(function () { ok(false); }, 8000);
      img.onload = function () { clearTimeout(t); ok(true); };
      img.onerror = function () { clearTimeout(t); ok(false); };
      img.src = url + 'images/icons/icon-192.png';
    });
    return reach[url];
  }

  // ---------------------------------------------------------------- styles (once)

  var CSS = [
    ':where(.rayman){display:block;width:100%;border-radius:10px}',     // :where: the page's own CSS wins
    '.rayman{position:relative;overflow:hidden;background:#fafbfc}',
    '.rayman.rm-dark{background:#060913}',
    '.rayman canvas,.rm-panel canvas{position:absolute;inset:0;width:100%;height:100%;display:block}',
    '.rm-bar{position:absolute;top:8px;right:8px;display:flex;gap:6px;opacity:0;transition:opacity .15s;z-index:1}',
    '.rayman:hover .rm-bar,.rayman:focus-within .rm-bar,.rm-panel .rm-bar{opacity:1}',
    '@media (hover:none){.rayman .rm-bar{opacity:.85}}',
    '.rm-btn{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 8px;border-radius:8px;cursor:pointer;',
    'font:500 13px/1 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1c2230;background:rgba(255,255,255,.72);',
    'border:1px solid rgba(20,30,60,.14);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)}',
    '.rm-btn:hover{background:rgba(255,255,255,.95)}',
    '.rm-btn:focus-visible{outline:2px solid #e0782a;outline-offset:1px}',
    '.rm-dark .rm-btn{color:#e3e9f6;background:rgba(6,9,19,.6);border-color:rgba(255,255,255,.18)}',
    '.rm-dark .rm-btn:hover{background:rgba(6,9,19,.9)}',
    '.rm-btn svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}',
    '.rm-msg{position:absolute;inset:0;display:grid;place-items:center;padding:16px;text-align:center;',
    'font:14px system-ui,-apple-system,"Segoe UI",sans-serif;color:#7a8396}',
    '.rm-overlay{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;background:rgba(20,26,40,.32);',
    '-webkit-backdrop-filter:blur(7px);backdrop-filter:blur(7px)}',
    '.rm-panel{position:relative;width:80vw;height:80vh;border-radius:14px;overflow:hidden;background:#fafbfc;',
    'box-shadow:0 18px 60px rgba(0,0,0,.35)}',
    '.rm-panel.rm-dark{background:#060913}',
    '.rm-tl{position:absolute;top:8px;left:8px;z-index:1;display:flex;gap:6px}',
    '.rm-close{width:32px;padding:0;justify-content:center}',
    '.rm-reset{width:32px;padding:0;justify-content:center}'
  ].join('');
  /** Add the embed's style rules to the page, once. */
  function styles() {
    if (document.getElementById('rayman-embed-css')) return;
    var s = document.createElement('style');
    s.id = 'rayman-embed-css'; s.textContent = CSS;
    document.head.appendChild(s);
  }

  var ICON = {
    enlarge: '<path d="M11 3h6v6M9 17H3v-6M17 3l-6 6M3 17l6-6"/>',
    open: '<path d="M11 3h6v6M17 3l-8 8M14 12v4.5H3.5V6H8"/>',
    download: '<path d="M10 3v9.5M6.2 8.8 10 12.5l3.8-3.7M3.5 14.5v2h13v-2"/>',
    reset: '<path d="M2.93 12.5a7.5 7.5 0 1 0 1.78-7.8L.83 8.33M.83 3.33v5h5"/>',   // a circular arrow turning back
    close: '<path d="M5 5l10 10M15 5L5 15"/>',
    upload: '<path d="M10 12.5V3M6.2 6.7 10 3l3.8 3.7M3.5 14.5v2h13v-2"/>',       // for workbook.js
    edit: '<path d="M13.5 3.5l3 3L7 16H4v-3z"/>',
    back: '<path d="M16 10H4M9 5l-5 5 5 5"/>'
  };
  /** Make a small icon button (icon name, optional text, tooltip title). */
  function button(icon, text, title) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'rm-btn'; b.title = title;
    b.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true">' + ICON[icon] + '</svg>' + (text ? '<span></span>' : '');
    if (text) b.querySelector('span').textContent = text;
    else b.setAttribute('aria-label', title);
    return b;
  }

  // ---------------------------------------------------------------- one diagram

  /** Draw scene on a canvas that fills host, refitting whenever the host changes size. No mm ruler
      along the bottom (scale: false).
      live (the enlarged view): the reader can pan (drag, the hand cursor), zoom (pinch, or the wheel)
      and reset (the reset button). Until they move it, it refits as before. */
  function Canvas(host, scene, theme, live) {
    var cv = document.createElement('canvas'), view = new RM.View();
    var moved = false, drag = null;
    cv.setAttribute('role', 'img');
    host.appendChild(cv);
    /** Zoom and pan to show the whole scene in a box w by h pixels. */
    function fit(w, h) {
      var b = RM.share.box(scene) || { z0: -60, z1: 140, y0: -30, y1: 30 };
      view.fit(b, w, h, Math.max(24, Math.min(64, Math.min(w, h) * 0.15)));   // room for labels at the edges
    }
    /** Draw the scene now, sized to its container. */
    function draw() {
      var w = host.clientWidth, h = host.clientHeight, dpr = window.devicePixelRatio || 1;
      if (!w || !h) return;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      if (!live || !moved) fit(w, h);
      var c = cv.getContext('2d');
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      RM.render.draw(c, w, h, { real: scene, view: view, theme: theme(), tool: 'select', axis: null, scale: false });
    }
    /** The viewer has panned or zoomed: stop auto-fitting and redraw. */
    function changed() { moved = true; draw(); }
    if (live) {
      cv.style.cursor = 'grab';                       // the hand, over the diagram
      cv.style.touchAction = 'none';                  // a finger pans; the page does not scroll
      var ptrs = {}, n = 0, pinch = null;             // every pointer down on the diagram, by id
      /** Two pointers: their midpoint and distance (client px). */
      function pair() {
        var a = ptrs[Object.keys(ptrs)[0]], b = ptrs[Object.keys(ptrs)[1]];
        return { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
      }
      cv.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        ptrs[e.pointerId] = { x: e.clientX, y: e.clientY }; n++;
        cv.setPointerCapture(e.pointerId);
        cv.style.cursor = 'grabbing';
        if (n === 1) drag = { x: e.clientX, y: e.clientY };
        else if (n === 2) { drag = null; pinch = pair(); }
      });
      cv.addEventListener('pointermove', function (e) {
        if (!ptrs[e.pointerId]) return;
        ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
        if (n >= 2 && pinch) {                        // two fingers: zoom about their midpoint, and pan with it
          var p = pair(), r = cv.getBoundingClientRect();
          view.zoomAt(p.mx - r.left, p.my - r.top, p.d / pinch.d);
          view.pan(p.mx - pinch.mx, p.my - pinch.my);
          pinch = p; changed();
        } else if (drag) {
          view.pan(e.clientX - drag.x, e.clientY - drag.y);
          drag = { x: e.clientX, y: e.clientY };
          changed();
        }
      });
      /** A finger or mouse button is released: end any drag or pinch. */
      function letGo(e) {
        if (!ptrs[e.pointerId]) return;
        delete ptrs[e.pointerId]; n--;
        pinch = null;
        var rest = Object.keys(ptrs);
        drag = n === 1 ? { x: ptrs[rest[0]].x, y: ptrs[rest[0]].y } : null;   // a pinch left one finger: it pans on
        if (n === 0) cv.style.cursor = 'grab';
      }
      cv.addEventListener('pointerup', letGo);
      cv.addEventListener('pointercancel', letGo);
      cv.addEventListener('wheel', function (e) {
        e.preventDefault();
        var r = cv.getBoundingClientRect();
        view.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
        changed();
      }, { passive: false });
    }
    var ro = new ResizeObserver(draw);
    ro.observe(host);
    return {
      cv: cv, draw: draw,
      reset: function () { moved = false; draw(); },
      stop: function () { ro.disconnect(); cv.remove(); }
    };
  }

  /** The theme ("light" or "dark") an embed asks for; "auto" follows the visitor's system setting. */
  function themeOf(el) {
    var t = el.dataset.theme;
    if (t === 'auto') return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    return t === 'dark' ? 'dark' : 'light';
  }

  /** The scene's JSON text, from inside the element or fetched from data-src. */
  function sceneText(el) {
    var inline = el.querySelector('script[type="application/json"]');
    if (inline) return Promise.resolve(inline.textContent);
    if (!el.dataset.src) return Promise.reject(new Error('No scene: give data-src, or the scene inside the element.'));
    return fetch(el.dataset.src).then(function (r) {
      if (!r.ok) throw new Error('Could not load ' + el.dataset.src + ' (' + r.status + ').');
      return r.text();
    });
  }

  /** The file name to save the scene as, taken from data-src. */
  function fileName(el) {
    var m = /([^/?#]+\.json)(?:[?#]|$)/i.exec(el.dataset.src || '');
    return m ? m[1] : 'rayman-scene.json';
  }

  /** Show a message inside the element (used for errors). */
  function message(el, text) {
    var m = document.createElement('div');
    m.className = 'rm-msg'; m.textContent = text;
    el.appendChild(m);
  }

  /** Turn one .rayman element into a diagram (once only). */
  function setup(el) {
    if (el.dataset.rmDone) return;
    el.dataset.rmDone = '1';
    styles();
    if (el.clientHeight < 20) {
      if (el.dataset.height) el.style.height = parseFloat(el.dataset.height) + 'px';
      else el.style.aspectRatio = '2 / 1';
    }
    var text;
    Promise.all([load(), sceneText(el)]).then(function (r) {
      text = r[1];
      var scene = RM.scene.ensureAxis(RM.scene.fromJSON(text));
      RM.share.passMirrors(scene);
      return RM.share.encode(RM.scene.toJSON(scene)).then(function (tok) { build(el, scene, text, tok); });
    }).catch(function (err) { message(el, 'RayMan diagram: ' + err.message); });
  }

  /** Build the diagram, its buttons and the enlarged view for one .rayman element. */
  function build(el, scene, text, token) {
    var theme = function () { return themeOf(el); };
    var rayman = el.dataset.rayman || BASE;
    if (!/\/$/.test(rayman)) rayman += '/';
    var alt = el.dataset.alt || 'A ray diagram drawn with RayMan';
    /** Set the dark or light look of box to match the current theme. */
    function paint(box) { box.classList.toggle('rm-dark', theme() === 'dark'); }
    paint(el);
    var main = Canvas(el, scene, theme);
    main.cv.setAttribute('aria-label', alt);

    /** The buttons: (enlarged only) reset the view, then Open in RayMan (or Download), and Enlarge unless big. */
    function bar(big, reset) {
      var b = document.createElement('div');
      b.className = 'rm-bar';
      if (big) {
        var rs = button('reset', '', 'Reset view');
        rs.classList.add('rm-reset');
        rs.addEventListener('click', reset);
        b.appendChild(rs);
      }
      if (el.dataset.open !== 'off') {
        var open = button('open', 'Open in RayMan', 'Open this diagram in RayMan, to change it or trace more rays');
        open.addEventListener('click', function () {
          if (open.dataset.download) {
            var a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([JSON.stringify(JSON.parse(text), null, 2)], { type: 'application/json' }));
            a.download = fileName(el);
            document.body.appendChild(a); a.click();
            setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
          } else window.open(RM.share.link(rayman, token), '_blank', 'noopener');
        });
        reachable(rayman).then(function (ok) {
          if (ok) return;
          var d = button('download', 'Download RayMan file', 'Download this diagram as a RayMan file (.json)');
          open.innerHTML = d.innerHTML; open.title = d.title; open.dataset.download = '1';
        });
        b.appendChild(open);
      }
      if (!big && el.dataset.enlarge !== 'off') {
        var en = button('enlarge', '', 'Enlarge');
        en.addEventListener('click', enlarge);
        b.appendChild(en);
      }
      return b;
    }
    el.appendChild(bar(false, null));

    /** Show the diagram enlarged in an overlay, with its own zoom and pan. */
    function enlarge() {
      var ov = document.createElement('div'), panel = document.createElement('div');
      ov.className = 'rm-overlay';
      panel.className = 'rm-panel';
      panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', alt);
      paint(panel);
      ov.appendChild(panel); document.body.appendChild(ov);
      var big = Canvas(panel, scene, theme, true);
      big.cv.setAttribute('aria-label', alt);
      var x = button('close', '', 'Close');
      x.classList.add('rm-close');
      var tl = document.createElement('div');          // top left: close
      tl.className = 'rm-tl';
      tl.appendChild(x);
      panel.appendChild(tl); panel.appendChild(bar(true, big.reset));
      var overflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      /** Close the enlarged view and return focus to the page. */
      function close() {                                    // ✕, Esc, or a click outside the diagram
        big.stop(); ov.remove();
        document.body.style.overflow = overflow;
        document.removeEventListener('keydown', key);
        var en = el.querySelector('.rm-bar .rm-btn:last-child');
        if (en) en.focus();
      }
      function key(e) { if (e.key === 'Escape') close(); }
      x.addEventListener('click', close);
      ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
      document.addEventListener('keydown', key);
      panel.tabIndex = -1; panel.style.outline = 'none';
      panel.focus();                                        // Tab then reaches ✕; no ring after a click
    }

    if (el.dataset.theme === 'auto' && window.matchMedia) {
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { paint(el); main.draw(); });
    }
  }

  /** Set up every .rayman element on the page. */
  function scan() { document.querySelectorAll('.rayman').forEach(setup); }

  // The drawing pieces, for workbook.js (which loads this script).
  window.RayManEmbed = {
    scan: scan, load: load, Canvas: Canvas, styles: styles, button: button, themeOf: themeOf, BASE: BASE
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan);
  else scan();
})();
