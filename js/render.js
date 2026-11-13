/* RayMan drawing: everything that touches the canvas. The ray colours follow the
   optics.mouse.vision demos (blue parallel, red focal, green central). */
(function (root) {
  'use strict';
  var RM = root.RM, G = RM.geom;
  var TAU = 2 * Math.PI;
  var SERIF = 'italic 19px "Times New Roman", Times, Georgia, serif';
  var SANS = 'system-ui, -apple-system, "Segoe UI", sans-serif';

  var THEMES = {
    light: {
      name: 'light', bg: '#f7f8fb', text: '#1b2233', dim: '#5d6880', panel: 'rgba(255,255,255,0.92)',
      grid: 'rgba(20,30,60,0.06)', gridMajor: 'rgba(20,30,60,0.14)', axis: 'rgba(20,30,60,0.6)',
      glassTop: 'rgba(200,225,250,0.75)', glassMid: 'rgba(150,195,240,0.55)', glassEdge: 'rgba(45,95,165,0.85)',
      glassPlane: 'rgba(45,95,165,0.35)', glassShine: 'rgba(255,255,255,0.9)',
      accent: '#d9772b', select: 'rgba(217,119,43,0.25)', hover: 'rgba(20,30,60,0.08)', plane: 'rgba(217,119,43,0.6)',
      source: '#c99a00', ray: '#2b3245',
      blue: '#1f6fd6', red: '#d9422b', green: '#2e9e3a'
    },
    dark: {
      name: 'dark', bg: '#060913', text: '#e3e9f6', dim: '#94a0ba', panel: 'rgba(6,9,19,0.85)',
      grid: 'rgba(255,255,255,0.055)', gridMajor: 'rgba(255,255,255,0.12)', axis: 'rgba(255,255,255,0.55)',
      glassTop: 'rgba(150,190,255,0.30)', glassMid: 'rgba(110,150,230,0.16)', glassEdge: 'rgba(175,205,255,0.85)',
      glassPlane: 'rgba(175,205,255,0.3)', glassShine: 'rgba(255,255,255,0.35)',
      accent: '#ffb454', select: 'rgba(255,180,84,0.28)', hover: 'rgba(255,255,255,0.1)', plane: 'rgba(255,180,84,0.55)',
      source: '#f3e96b', ray: '#f3e96b',
      blue: '#5aa7ff', red: '#ff6b57', green: '#7ee06b'
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
    if (highlight) {
      c.strokeStyle = th.select; c.lineWidth = 9;
      c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke();
    }
    c.strokeStyle = highlight ? th.accent : th.axis;
    c.lineWidth = highlight ? 2.5 : 1.6;
    c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke();
  }

  /** How thick (px, at the centre or the rim) to draw a lens: stronger lenses look fatter,
      as a real lens of the same diameter would (sag ~ ap² / f). */
  function lensThickness(v, e) {
    var hpx = 2 * e.ap * v.s;
    return Math.max(7, Math.min(0.42 * e.ap * e.ap / Math.abs(e.f) * v.s, 0.22 * hpx, 34));
  }

  /** A thin ideal lens drawn as glass: biconvex for f > 0, biconcave for f < 0, with a faint
      line marking the plane where the (thin-lens) refraction happens. */
  function lens(c, v, th, e, o) {
    var X = v.X(e.z), Yt = v.Y(e.ap), Yb = v.Y(-e.ap), Ym = v.Y(0), T = lensThickness(v, e);
    var path = new Path2D();
    if (e.f > 0) {                                    // pointed ends, bulging faces
      path.moveTo(X, Yt);
      path.quadraticCurveTo(X + T, Ym, X, Yb);
      path.quadraticCurveTo(X - T, Ym, X, Yt);
    } else {                                          // flat ends T wide, faces hollowed to ~3 px
      var t = 3, h = T / 2;
      path.moveTo(X - h, Yt); path.lineTo(X + h, Yt);
      path.quadraticCurveTo(X + t - h, Ym, X + h, Yb);
      path.lineTo(X - h, Yb);
      path.quadraticCurveTo(X - t + h, Ym, X - h, Yt);
    }
    path.closePath();
    if (o.selected || o.hover) {
      c.save();
      c.strokeStyle = o.selected ? th.select : th.hover; c.lineWidth = 12; c.lineJoin = 'round';
      c.stroke(path); c.restore();
    }
    var g = c.createLinearGradient(X - T, 0, X + T, 0);
    g.addColorStop(0, th.glassMid); g.addColorStop(0.42, th.glassTop); g.addColorStop(1, th.glassMid);
    c.fillStyle = g; c.fill(path);
    c.strokeStyle = th.glassPlane; c.lineWidth = 1;   // the thin-lens plane
    c.beginPath(); c.moveTo(X, Yt); c.lineTo(X, Yb); c.stroke();
    c.strokeStyle = th.glassEdge; c.lineWidth = 1.6; c.lineJoin = 'round';
    c.stroke(path);
    if (e.label) text(c, e.label, X, Yt - 12, o.selected ? th.accent : th.text, '600 14px ' + SANS, 'center', 'alphabetic');
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

  /** An object: an arrow from the axis at z up (or down) to height h. Green unless coloured. */
  function objectArrow(c, v, th, e, o) {
    var X = v.X(e.z), Y0 = v.Y(0), Y1 = v.Y(e.h), up = e.h >= 0 ? 1 : -1, col = e.color || th.green;
    if (o.selected || o.hover) {
      c.strokeStyle = o.selected ? th.select : th.hover;
      c.lineWidth = 14; c.lineCap = 'round';
      c.beginPath(); c.moveTo(X, Y0); c.lineTo(X, Y1); c.stroke();
    }
    var head = Math.min(15, Math.abs(Y1 - Y0) * 0.6);
    c.strokeStyle = col; c.lineWidth = 3.5; c.lineCap = 'butt';
    c.beginPath(); c.moveTo(X, Y0); c.lineTo(X, Y1 + up * head * 0.7); c.stroke();
    arrowHead(c, X, Y0, X, Y1, head, col);
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
      c.fillStyle = o.selected ? th.select : th.hover;
      c.beginPath(); c.arc(X, Y, 15, 0, TAU); c.fill();
    }
    c.globalAlpha = 0.3; c.fillStyle = th.source;
    c.beginPath(); c.arc(X, Y, 10, 0, TAU); c.fill();
    c.globalAlpha = 1;
    c.beginPath(); c.arc(X, Y, 5, 0, TAU); c.fill();
    if (e.label) text(c, e.label, X + 12, Y - 10, th.text, '600 14px ' + SANS, 'left', 'bottom');
  }

  // ---------------------------------------------------------------- rays

  /** Where along screen segment a-b to put the direction arrow: the middle of its visible part. */
  function arrowSpot(a, b, W) {
    var dx = b.x - a.x, t0 = 0, t1 = 1;
    if (Math.abs(dx) > 1e-9) {
      var ta = (0 - a.x) / dx, tb = (W - a.x) / dx;
      t0 = Math.max(0, Math.min(ta, tb)); t1 = Math.min(1, Math.max(ta, tb));
    }
    if (t1 <= t0) return null;
    var tm = (t0 + t1) / 2, L = Math.hypot(dx, b.y - a.y) * (t1 - t0);
    return L < 50 ? null : { x: a.x + dx * tm, y: a.y + (b.y - a.y) * tm };
  }

  /** A ray through screen points sp: a line with a small arrowhead along each long segment. */
  function rayPath(c, sp, col, w, W) {
    c.strokeStyle = col; c.lineWidth = w; c.lineJoin = 'round'; c.lineCap = 'round';
    c.beginPath();
    sp.forEach(function (p, i) { if (i) c.lineTo(p.x, p.y); else c.moveTo(p.x, p.y); });
    c.stroke();
    for (var i = 0; i + 1 < sp.length; i++) {
      var m = arrowSpot(sp[i], sp[i + 1], W);
      if (!m) continue;
      var L = Math.hypot(sp[i + 1].x - sp[i].x, sp[i + 1].y - sp[i].y);
      var ux = (sp[i + 1].x - sp[i].x) / L, uy = (sp[i + 1].y - sp[i].y) / L;
      arrowHead(c, m.x - ux, m.y - uy, m.x + ux * 5, m.y + uy * 5, 7 + w * 1.4, col);
    }
  }

  function rays(c, v, th, st, solved, W) {
    var showNodes = st.tool === 'ray';
    st.scene.rays.forEach(function (r) {
      var s = solved[r.id];
      if (!s || !s.pts.length) return;
      var sp = s.pts.map(function (p) { return { x: v.X(p.z), y: v.Y(p.y) }; });
      var col = r.color || th.ray, sel = r.id === st.sel, hov = r.id === st.hover;
      if (sel || hov) {
        c.save(); c.globalAlpha = 1;
        c.strokeStyle = sel ? th.select : th.hover; c.lineWidth = 10; c.lineJoin = 'round'; c.lineCap = 'round';
        c.beginPath(); sp.forEach(function (p, i) { if (i) c.lineTo(p.x, p.y); else c.moveTo(p.x, p.y); }); c.stroke();
        c.restore();
      }
      rayPath(c, sp, col, 2.2, W);
      if (showNodes || sel) {
        sp.forEach(function (p, i) {
          var last = i === sp.length - 1;
          c.fillStyle = th.bg; c.strokeStyle = col; c.lineWidth = 1.8;
          c.beginPath(); c.arc(p.x, p.y, last ? 5 : 3.5, 0, TAU); c.fill(); c.stroke();
        });
      }
    });
  }

  /** The segment being drawn, from the ray's last point to where it would end. */
  function draft(c, v, th, d, W) {
    if (!d || !d.from) return;
    var a = { x: v.X(d.from.z), y: v.Y(d.from.y) };
    c.save();
    if (d.to) { c.globalAlpha = 0.85; rayPath(c, [a, { x: v.X(d.to.z), y: v.Y(d.to.y) }], d.color || th.ray, 2.2, W); }
    c.globalAlpha = 1; c.fillStyle = th.accent;
    c.beginPath(); c.arc(a.x, a.y, 4.5, 0, TAU); c.fill();
    c.restore();
  }

  /** Rings around what something snapped to. */
  function hints(c, v, th, list) {
    (list || []).forEach(function (h) {
      if (h.z == null) return;
      c.strokeStyle = th.accent; c.lineWidth = h.small ? 1.8 : 2.4;
      c.beginPath(); c.arc(v.X(h.z), v.Y(h.y || 0), h.small ? 6 : 10, 0, TAU); c.stroke();
    });
  }

  /** A short caption by the cursor saying what snapped ("through F′ of L1"). */
  function caption(c, th, cap, W) {
    if (!cap || !cap.text) return;
    c.font = '600 13px ' + SANS;
    var w = c.measureText(cap.text).width + 14, x = cap.x + 16, y = cap.y + 18;
    if (x + w > W - 8) x = cap.x - 16 - w;
    c.fillStyle = th.panel; c.strokeStyle = th.accent; c.lineWidth = 1;
    c.beginPath(); c.rect(x, y, w, 23); c.fill(); c.stroke();
    text(c, cap.text, x + 7, y + 12, th.accent, '600 13px ' + SANS, 'left');
  }

  // ---------------------------------------------------------------- the frame

  /** Draw one frame. st: { scene, view, theme, tool, sel, hover, ghost, hints, hotFocal, axisHot, draft }. */
  function draw(c, W, H, st) {
    var th = THEMES[st.theme] || THEMES.light, v = st.view, els = st.scene.elements;
    var solved = RM.rays.solveAll(st.scene);
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
    rays(c, v, th, st, solved, W);
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
    draft(c, v, th, st.draft, W);
    hints(c, v, th, st.hints);
    caption(c, th, st.caption, W);
  }

  RM.render = { THEMES: THEMES, draw: draw, focalLabels: focalLabels };
})(typeof self !== 'undefined' ? self : this);
