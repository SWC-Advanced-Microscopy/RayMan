/* RayMan drawing: everything that touches the canvas. Colours and the lens symbol follow the
   optics.mouse.vision demos (ray-optics/common.js and ideal.js). */
(function (root) {
  'use strict';
  var RM = root.RM, G = RM.geom;
  var TAU = 2 * Math.PI;
  var SERIF = 'italic 19px "Times New Roman", Times, Georgia, serif';
  var SANS = 'system-ui, -apple-system, "Segoe UI", sans-serif';

  var THEMES = {
    dark: {
      name: 'dark', bg: '#060913', text: '#e3e9f6', dim: '#94a0ba',
      grid: 'rgba(255,255,255,0.055)', gridMajor: 'rgba(255,255,255,0.12)',
      axis: 'rgba(255,255,255,0.55)', lens: 'rgba(200,208,225,0.78)', lensHead: '#ff5a5f',
      accent: '#ffb454', select: 'rgba(255,180,84,0.28)', plane: 'rgba(255,180,84,0.55)',
      object: '#e3e9f6', source: '#f3e96b', ray: '#f3e96b',
      blue: '#5aa7ff', red: '#ff6b57', green: '#7ee06b'
    },
    light: {
      name: 'light', bg: '#f7f8fb', text: '#1b2233', dim: '#5d6880',
      grid: 'rgba(20,30,60,0.06)', gridMajor: 'rgba(20,30,60,0.14)',
      axis: 'rgba(20,30,60,0.6)', lens: 'rgba(60,70,90,0.75)', lensHead: '#d63c41',
      accent: '#d9772b', select: 'rgba(217,119,43,0.25)', plane: 'rgba(217,119,43,0.6)',
      object: '#1b2233', source: '#c99a00', ray: '#b8960a',
      blue: '#1f6fd6', red: '#d9422b', green: '#2e9e3a'
    }
  };

  // ---------------------------------------------------------------- primitives

  /** A filled arrowhead with its tip at (x1, y1), pointing away from (x0, y0). */
  function arrowHead(c, x0, y0, x1, y1, size, col) {
    var dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy);
    if (L < 1e-6) return;
    var ux = dx / L, uy = dy / L, h = size;
    c.fillStyle = col;
    c.beginPath();
    c.moveTo(x1, y1);
    c.lineTo(x1 - ux * h - uy * h * 0.42, y1 - uy * h + ux * h * 0.42);
    c.lineTo(x1 - ux * h + uy * h * 0.42, y1 - uy * h - ux * h * 0.42);
    c.closePath(); c.fill();
  }

  function text(c, s, x, y, col, font, align, base) {
    c.fillStyle = col; c.font = font;
    c.textAlign = align || 'center'; c.textBaseline = base || 'middle';
    c.fillText(s, x, y);
  }

  var SUB = '₀₁₂₃₄₅₆₇₈₉';
  function subscript(digits) { return digits.replace(/\d/g, function (d) { return SUB[+d]; }); }

  /** Focal-point labels for a lens: F/F′, with the lens number as a subscript when there are
      several lenses and the lens is called Ln. */
  function focalLabels(lens, nLenses) {
    var m = /^L(\d+)$/.exec(lens.label), s = nLenses > 1 && m ? subscript(m[1]) : '';
    return { F: 'F' + s, Fp: 'F' + s + '′' };
  }

  // ---------------------------------------------------------------- the bench

  function grid(c, v, th, W, H) {
    var step = G.niceStep(v.s, 14), every = G.majorEvery(step);
    var minor = new Path2D(), major = new Path2D(), k, x, y;
    for (k = Math.ceil(v.z(0) / step); k * step <= v.z(W); k++) {
      x = Math.round(v.X(k * step)) + 0.5;
      (k % every === 0 ? major : minor).moveTo(x, 0);
      (k % every === 0 ? major : minor).lineTo(x, H);
    }
    for (k = Math.ceil(v.y(H) / step); k * step <= v.y(0); k++) {
      y = Math.round(v.Y(k * step)) + 0.5;
      (k % every === 0 ? major : minor).moveTo(0, y);
      (k % every === 0 ? major : minor).lineTo(W, y);
    }
    c.lineWidth = 1;
    c.strokeStyle = th.grid; c.stroke(minor);
    c.strokeStyle = th.gridMajor; c.stroke(major);
    // scale along the bottom edge, in mm
    var big = step * every, dec = big < 1 ? Math.ceil(-Math.log10(big)) : 0;
    for (k = Math.ceil(v.z(0) / big); k * big <= v.z(W); k++) {
      x = v.X(k * big);
      if (x < 24 || x > W - 40) continue;
      text(c, (k * big).toFixed(dec), x, H - 10, th.dim, '11px ' + SANS);
    }
    text(c, 'mm', W - 14, H - 10, th.dim, '11px ' + SANS, 'right');
  }

  function axis(c, v, th, W, highlight) {
    var y = Math.round(v.Y(0)) + 0.5;
    c.strokeStyle = highlight ? th.accent : th.axis;
    c.lineWidth = highlight ? 3 : 1.6;
    c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke();
  }

  /** A thin ideal lens: a vertical line with arrowheads pointing out (f > 0) or in (f < 0). */
  function lens(c, v, th, e, o) {
    var X = v.X(e.z), Yt = v.Y(e.ap), Yb = v.Y(-e.ap);
    if (o.selected || o.hover) {
      c.strokeStyle = o.selected ? th.select : 'rgba(128,128,128,0.18)';
      c.lineWidth = 14; c.lineCap = 'round';
      c.beginPath(); c.moveTo(X, Yt - 8); c.lineTo(X, Yb + 8); c.stroke();
    }
    c.strokeStyle = th.lens; c.lineWidth = 3; c.lineCap = 'butt';
    c.beginPath(); c.moveTo(X, Yt); c.lineTo(X, Yb); c.stroke();
    if (e.f > 0) {
      arrowHead(c, X, v.Y(0), X, Yt - 12, 13, th.lensHead);
      arrowHead(c, X, v.Y(0), X, Yb + 12, 13, th.lensHead);
    } else {
      arrowHead(c, X, Yt - 20, X, Yt + 11, 13, th.lensHead);
      arrowHead(c, X, Yb + 20, X, Yb - 11, 13, th.lensHead);
    }
    if (e.label) text(c, e.label, X, Yt - 26, o.selected ? th.accent : th.text, '600 14px ' + SANS, 'center', 'alphabetic');
  }

  function focalPlane(c, v, th, z, ap) {
    var X = Math.round(v.X(z)) + 0.5;
    c.save();
    c.strokeStyle = th.plane; c.lineWidth = 1.4; c.setLineDash([6, 5]);
    c.beginPath(); c.moveTo(X, v.Y(ap * 1.15)); c.lineTo(X, v.Y(-ap * 1.15)); c.stroke();
    c.restore();
  }

  /** A focal point: a dot on the axis with a serif label below it. */
  function focal(c, v, th, z, label, hot) {
    var X = v.X(z), Y = v.Y(0);
    c.fillStyle = hot ? th.accent : th.text;
    c.beginPath(); c.arc(X, Y, hot ? 5 : 3.5, 0, TAU); c.fill();
    text(c, label, X, Y + 24, hot ? th.accent : th.text, SERIF);
  }

  /** All the lenses' focal points. Points that coincide on screen (as in a 4f system, where
      F′ of one lens is F of the next) share one dot and one label, "F₁′ = F₂". */
  function focalMarkers(c, v, th, els, nL, hot) {
    var pts = [];
    els.forEach(function (e) {
      if (e.type !== 'lens') return;
      var fp = G.focalPoints(e), lab = focalLabels(e, nL);
      pts.push({ z: fp.F, label: lab.F, hot: hot.id === e.id && hot.which === 'F' },
        { z: fp.Fp, label: lab.Fp, hot: hot.id === e.id && hot.which === 'Fp' });
    });
    pts.sort(function (a, b) { return a.z - b.z; });
    for (var i = 0; i < pts.length;) {
      var g = [pts[i]], j = i + 1;
      while (j < pts.length && v.X(pts[j].z) - v.X(g[0].z) < 3) g.push(pts[j++]);
      focal(c, v, th, g[0].z, g.map(function (p) { return p.label; }).join(' = '),
        g.some(function (p) { return p.hot; }));
      i = j;
    }
  }

  /** An object: an arrow from the axis at z up (or down) to height h. */
  function objectArrow(c, v, th, e, o, col) {
    var X = v.X(e.z), Y0 = v.Y(0), Y1 = v.Y(e.h), up = e.h >= 0 ? 1 : -1;
    if (o.selected || o.hover) {
      c.strokeStyle = o.selected ? th.select : 'rgba(128,128,128,0.18)';
      c.lineWidth = 14; c.lineCap = 'round';
      c.beginPath(); c.moveTo(X, Y0); c.lineTo(X, Y1); c.stroke();
    }
    var head = Math.min(15, Math.abs(Y1 - Y0) * 0.6);
    c.strokeStyle = col || th.object; c.lineWidth = 3; c.lineCap = 'butt';
    c.beginPath(); c.moveTo(X, Y0); c.lineTo(X, Y1 + up * head * 0.7); c.stroke();
    arrowHead(c, X, Y0, X, Y1, head, col || th.object);
    if (o.selected) {                                     // the tip is a handle for the height
      c.strokeStyle = th.accent; c.lineWidth = 2;
      c.beginPath(); c.arc(X, Y1, 7, 0, TAU); c.stroke();
    }
    if (e.label) text(c, e.label, X + 10, Y1 - up * 4, th.text, '600 14px ' + SANS, 'left', up > 0 ? 'bottom' : 'top');
  }

  /** A point source: a bright dot with a soft halo. */
  function pointSource(c, v, th, e, o) {
    var X = v.X(e.z), Y = v.Y(e.y);
    if (o.selected || o.hover) {
      c.fillStyle = o.selected ? th.select : 'rgba(128,128,128,0.2)';
      c.beginPath(); c.arc(X, Y, 15, 0, TAU); c.fill();
    }
    c.globalAlpha = 0.3; c.fillStyle = th.source;
    c.beginPath(); c.arc(X, Y, 10, 0, TAU); c.fill();
    c.globalAlpha = 1;
    c.beginPath(); c.arc(X, Y, 5, 0, TAU); c.fill();
    if (e.label) text(c, e.label, X + 12, Y - 10, th.text, '600 14px ' + SANS, 'left', 'bottom');
  }

  /** Highlight what a drag snapped to: a ring and a short caption. */
  function snapHint(c, v, th, hit) {
    if (!hit || hit.z == null) return;
    var X = v.X(hit.z), Y = v.Y(hit.y || 0);
    c.strokeStyle = th.accent; c.lineWidth = 2.2;
    c.beginPath(); c.arc(X, Y, 10, 0, TAU); c.stroke();
    if (hit.text) {
      c.font = '600 13px ' + SANS;
      var w = c.measureText(hit.text).width + 12;
      c.fillStyle = th.name === 'dark' ? 'rgba(6,9,19,0.85)' : 'rgba(255,255,255,0.9)';
      c.fillRect(X + 14, Y - 36, w, 22);
      text(c, hit.text, X + 20, Y - 25, th.accent, '600 13px ' + SANS, 'left');
    }
  }

  // ---------------------------------------------------------------- the frame

  /** Draw one frame. st: { scene, view, theme, sel, hover, ghost, hint, hotFocal, axisHot }. */
  function draw(c, W, H, st) {
    var th = THEMES[st.theme] || THEMES.dark, v = st.view, els = st.scene.elements;
    c.fillStyle = th.bg; c.fillRect(0, 0, W, H);
    grid(c, v, th, W, H);
    axis(c, v, th, W, st.axisHot);

    var nL = els.filter(function (e) { return e.type === 'lens'; }).length;
    function opts(e) { return { selected: e.id === st.sel, hover: e.id === st.hover }; }

    els.forEach(function (e) {
      if (e.type === 'lens' && e.planes) {
        var fp = G.focalPoints(e);
        focalPlane(c, v, th, fp.F, e.ap); focalPlane(c, v, th, fp.Fp, e.ap);
      }
    });
    els.forEach(function (e) { if (e.type === 'lens') lens(c, v, th, e, opts(e)); });
    focalMarkers(c, v, th, els, nL, st.hotFocal || {});
    els.forEach(function (e) { if (e.type === 'object') objectArrow(c, v, th, e, opts(e)); });
    els.forEach(function (e) { if (e.type === 'point') pointSource(c, v, th, e, opts(e)); });

    if (st.ghost) {
      c.save(); c.globalAlpha = 0.5;
      var g = st.ghost, o = { selected: false, hover: false };
      if (g.type === 'lens') {
        lens(c, v, th, g, o);
        var gf = G.focalPoints(g), gl = focalLabels(g, nL + 1);
        focal(c, v, th, gf.F, gl.F); focal(c, v, th, gf.Fp, gl.Fp);
      } else if (g.type === 'object') objectArrow(c, v, th, g, o);
      else if (g.type === 'point') pointSource(c, v, th, g, o);
      c.restore();
    }
    snapHint(c, v, th, st.hint);
  }

  RM.render = { THEMES: THEMES, draw: draw, focalLabels: focalLabels };
})(typeof self !== 'undefined' ? self : this);
