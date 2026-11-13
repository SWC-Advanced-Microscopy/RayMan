/* RayMan properties panel: edits the selected element. Typing or sliding updates the canvas
   live (onLive); finishing an edit records an undo step (onCommit). */
(function (root) {
  'use strict';
  var RM = root.RM;

  var TITLES = { lens: 'Thin lens', object: 'Object', point: 'Point source' };

  /** Fields per element type. num: number input; check: checkbox; text: text input. */
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
      { key: 'h', kind: 'num', label: 'Height', unit: 'mm', step: 1, nonzero: true }
    ],
    point: [
      { key: 'label', kind: 'text', label: 'Label' },
      { key: 'z', kind: 'num', label: 'Position z', unit: 'mm', step: 1 },
      { key: 'y', kind: 'num', label: 'Height y', unit: 'mm', step: 1 }
    ]
  };

  /** Show a number without float noise: at most 2 decimals, no trailing zeros. */
  function fmt(x) { return String(Math.round(x * 100) / 100); }

  /** api: { onLive(), onCommit(), onDelete(id), onClose() } */
  function Panel(rootEl, api) {
    this.el = rootEl; this.api = api; this.target = null;
  }

  Panel.prototype.show = function (e) {
    if (!e) { this.hide(); return; }
    if (this.target && this.target.id === e.id && this.target.type === e.type) {
      this.target = e; this.sync(); return;
    }
    this.target = e;
    var self = this, h = '<div class="ph"><b>' + TITLES[e.type] + '</b>' +
      '<button class="icon-btn" data-act="close" title="Deselect (Esc)">&times;</button></div>';
    FIELDS[e.type].forEach(function (fd) {
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
      }
    });
    h += '<p class="hint" data-hint></p><button class="danger" data-act="delete">Delete</button>';
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
    this.el.querySelectorAll('[data-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        var t = self.target; if (!t) return;
        if (b.dataset.act === 'sign') { t.f = -t.f; self.sync(); self.api.onLive(); self.api.onCommit(); }
        else if (b.dataset.act === 'delete') self.api.onDelete(t.id);
        else if (b.dataset.act === 'close') self.api.onClose();
      });
    });
    this.sync();
  };

  Panel.prototype.hide = function () { this.target = null; this.el.hidden = true; this.el.innerHTML = ''; };

  /** Copy the element's values into the inputs, leaving alone the one being typed in. */
  Panel.prototype.sync = function () {
    var t = this.target; if (!t) return;
    this.el.querySelectorAll('input').forEach(function (inp) {
      if (inp === document.activeElement && inp.type !== 'range') return;
      var k = inp.dataset.k;
      if (k === 'fabs') {
        inp.max = Math.max(300, Math.ceil(Math.abs(t.f)));
        inp.value = Math.abs(t.f);
      } else if (inp.type === 'checkbox') inp.checked = !!t[k];
      else if (inp.type === 'number') inp.value = fmt(t[k]);
      else inp.value = t[k];
    });
    var hint = this.el.querySelector('[data-hint]');
    if (hint) hint.textContent = t.type === 'lens'
      ? (t.f > 0 ? 'Converging lens.' : 'Diverging lens: F′ is on the incoming side.') +
        ' Drag F or F′ on the canvas to change f.'
      : t.type === 'object' ? 'Drag the arrow to move it, its tip to change the height.' : '';
  };

  /** Apply one input's value to the element if it is valid. */
  Panel.prototype.read = function (inp, commit) {
    var t = this.target; if (!t) return;
    var k = inp.dataset.k, ok = true;
    if (inp.type === 'checkbox') t[k] = inp.checked;
    else if (inp.type === 'text') t[k] = inp.value.trim();
    else {
      var x = parseFloat(inp.value);
      var fd = FIELDS[t.type].filter(function (f) { return f.key === k; })[0];
      if (k === 'fabs') { if (x >= 1) t.f = (t.f < 0 ? -1 : 1) * x; else ok = false; }
      else if (!isFinite(x)) ok = false;
      else if (k === 'f' && Math.abs(x) < 0.1) ok = false;
      else if (fd && fd.min != null && x < fd.min) ok = false;
      else if (fd && fd.nonzero && x === 0) ok = false;
      else t[k] = x;
    }
    inp.classList.toggle('bad', !ok);
    if (!ok) { if (commit) { inp.classList.remove('bad'); this.sync(); } return; }
    if (k === 'fabs' || k === 'f') this.sync();     // keep the f box and the slider in step
    this.api.onLive();
    if (commit) this.api.onCommit();
  };

  RM.Panel = Panel;
})(typeof self !== 'undefined' ? self : this);
