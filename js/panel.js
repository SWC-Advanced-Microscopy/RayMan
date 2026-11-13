/* RayMan properties panel: edits the selected element (rays have none; see app.js).
   Typing or sliding updates the canvas live (onLive); finishing an edit records an undo
   step (onCommit). */
(function (root) {
  'use strict';
  var RM = root.RM;

  var TITLES = { lens: 'Thin lens', object: 'Object', point: 'Point source' };

  /** Colour swatches offered for objects (null = the theme's default). */
  var SWATCHES = ['#2e9e3a', '#1f6fd6', '#d9422b', '#e08a00', '#8e44ad', '#1b2233'];

  /** Fields per type. num: number input; check: checkbox; text: text input; color: swatches. */
  var FIELDS = {
    lens: [
      { key: 'label', kind: 'text', label: 'Label' },
      { key: 'f', kind: 'focal', label: 'Focal length', unit: 'mm' },
      { key: 'z', kind: 'num', label: 'Position z', unit: 'mm', step: 1 },
      { key: 'ap', kind: 'num', label: 'Semi-aperture', unit: 'mm', step: 1, min: 1 },
      { key: 'planes', kind: 'check', label: 'Show focal planes' }
    ],
    object: [
      { key: 'label', kind: 'text', label: 'Label' },
      { key: 'z', kind: 'num', label: 'Position z', unit: 'mm', step: 1 },
      { key: 'h', kind: 'num', label: 'Height', unit: 'mm', step: 1, nonzero: true },
      { key: 'color', kind: 'color', label: 'Colour', auto: 'Green' }
    ],
    point: [
      { key: 'label', kind: 'text', label: 'Label' },
      { key: 'z', kind: 'num', label: 'Position z', unit: 'mm', step: 1 },
      { key: 'y', kind: 'num', label: 'Height y', unit: 'mm', step: 1 }
    ]
  };

  var HINTS = {
    object: 'Drag the arrow to move it, its tip to change the height.',
    point: ''
  };

  /** Show a number without float noise: at most 2 decimals, no trailing zeros. */
  function fmt(x) { return String(Math.round(x * 100) / 100); }

  function typeOf(t) { return t.type; }

  /** api: { onBeforeChange(), onLive(), onCommit(), onDelete(id), onClose() } */
  function Panel(rootEl, api) {
    this.el = rootEl; this.api = api; this.target = null;
  }

  Panel.prototype.show = function (e) {
    if (!e) { this.hide(); return; }
    if (this.target && this.target.id === e.id) { this.target = e; this.sync(); return; }
    this.target = e;
    var self = this, type = typeOf(e);
    var h = '<div class="ph"><b>' + TITLES[type] + '</b>' +
      '<button class="icon-btn" data-act="close" title="Deselect (Esc)">&times;</button></div>';
    FIELDS[type].forEach(function (fd) {
      if (fd.kind === 'text') {
        h += '<label class="row"><span>' + fd.label + '</span><input type="text" data-k="' + fd.key + '" maxlength="12"></label>';
      } else if (fd.kind === 'num') {
        h += '<label class="row"><span>' + fd.label + '</span><span class="num"><input type="number" data-k="' + fd.key +
          '" step="' + fd.step + '"><i>' + fd.unit + '</i></span></label>';
      } else if (fd.kind === 'check') {
        h += '<label class="row check"><input type="checkbox" data-k="' + fd.key + '"><span>' + fd.label + '</span></label>';
      } else if (fd.kind === 'focal') {
        h += '<div class="row"><span>' + fd.label + '</span><span class="num">' +
          '<button class="sign" data-act="sign" title="Converging (+) or diverging (−)">±</button>' +
          '<input type="number" data-k="f" step="1"><i>mm</i></span></div>' +
          '<input type="range" class="slider" data-k="fabs" min="1" max="300" step="1" title="Drag to change |f|">';
      } else if (fd.kind === 'color') {
        h += '<div class="row"><span>' + fd.label + '</span><span class="swatches">' +
          '<button class="sw auto" data-color="" title="' + fd.auto + '">A</button>' +
          SWATCHES.map(function (c) { return '<button class="sw" data-color="' + c + '" style="background:' + c + '"></button>'; }).join('') +
          '<input type="color" data-k="' + fd.key + '" title="Any colour"></span></div>';
      }
    });
    h += '<p class="hint" data-hint></p><button class="danger wide" data-act="delete">Delete</button>';
    this.el.innerHTML = h;
    this.el.hidden = false;

    this.el.querySelectorAll('input').forEach(function (inp) {
      inp.addEventListener('input', function () { self.read(inp, false); });
      inp.addEventListener('change', function () { self.read(inp, true); });
      inp.addEventListener('keydown', function (ev) {
        ev.stopPropagation();                         // keep app shortcuts out of the inputs
        if (ev.key === 'Enter' || ev.key === 'Escape') inp.blur();
      });
    });
    this.el.querySelectorAll('[data-color]').forEach(function (b) {
      b.addEventListener('click', function () {
        self.target.color = b.dataset.color || null;
        self.sync(); self.api.onLive(); self.api.onCommit();
      });
    });
    this.el.querySelectorAll('[data-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        var t = self.target; if (!t) return;
        var act = b.dataset.act;
        if (act === 'sign') { self.api.onBeforeChange(); t.f = -t.f; self.sync(); self.api.onLive(); self.api.onCommit(); }
        else if (act === 'delete') self.api.onDelete(t.id);
        else if (act === 'close') self.api.onClose();
      });
    });
    this.sync();
  };

  Panel.prototype.hide = function () { this.target = null; this.el.hidden = true; this.el.innerHTML = ''; };

  /** Copy the target's values into the inputs, leaving alone the one being typed in. */
  Panel.prototype.sync = function () {
    var t = this.target; if (!t) return;
    this.el.querySelectorAll('input').forEach(function (inp) {
      if (inp === document.activeElement && inp.type !== 'range' && inp.type !== 'color') return;
      var k = inp.dataset.k;
      if (k === 'fabs') {
        inp.max = Math.max(300, Math.ceil(Math.abs(t.f)));
        inp.value = Math.abs(t.f);
        inp.style.setProperty('--p', (100 * (inp.value - inp.min) / (inp.max - inp.min)) + '%');
      } else if (inp.type === 'checkbox') inp.checked = !!t[k];
      else if (inp.type === 'number') inp.value = fmt(t[k]);
      else if (inp.type === 'color') inp.value = /^#[0-9a-f]{6}$/i.test(t[k] || '') ? t[k] : '#888888';
      else inp.value = t[k];
    });
    this.el.querySelectorAll('[data-color]').forEach(function (b) {
      b.classList.toggle('on', (b.dataset.color || null) === (t.color || null));
    });
    var hint = this.el.querySelector('[data-hint]');
    if (hint) hint.textContent = t.type === 'lens'
      ? (t.f > 0 ? 'Converging lens.' : 'Diverging lens: F′ is on the incoming side.') +
        ' Drag F or F′ on the canvas to change f.'
      : HINTS[typeOf(t)];
  };

  /** Apply one input's value to the target if it is valid. */
  Panel.prototype.read = function (inp, commit) {
    var t = this.target; if (!t) return;
    var k = inp.dataset.k, ok = true, val;
    if (inp.type === 'checkbox') val = inp.checked;
    else if (inp.type === 'text' || inp.type === 'color') val = inp.value.trim();
    else {
      var x = parseFloat(inp.value);
      var fd = (FIELDS[typeOf(t)] || []).filter(function (f) { return f.key === k; })[0];
      if (k === 'fabs') { if (x >= 1) { k = 'f'; val = (t.f < 0 ? -1 : 1) * x; } else ok = false; }
      else if (!isFinite(x)) ok = false;
      else if (k === 'f' && Math.abs(x) < 0.1) ok = false;
      else if (fd && fd.min != null && x < fd.min) ok = false;
      else if (fd && fd.nonzero && x === 0) ok = false;
      else val = x;
    }
    inp.classList.toggle('bad', !ok);
    if (!ok) { if (commit) { inp.classList.remove('bad'); this.sync(); } return; }
    if (t[k] !== val) { this.api.onBeforeChange(); t[k] = val; }
    if (k === 'f' || inp.type === 'color') this.sync();   // keep the f box and slider in step
    this.api.onLive();
    if (commit) this.api.onCommit();
  };

  RM.Panel = Panel;
})(typeof self !== 'undefined' ? self : this);
