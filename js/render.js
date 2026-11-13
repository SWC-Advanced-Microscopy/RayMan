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
      name: 'light', bg: '#fafbfc', text: '#1c2230', dim: '#7a8396', panel: 'rgba(255,255,255,0.95)',
      grid: 'rgba(20,30,60,0.045)', gridMajor: 'rgba(20,30,60,0.10)', axis: 'rgba(28,34,48,0.55)',
      glassTop: 'rgba(200,225,250,0.75)', glassMid: 'rgba(150,195,240,0.55)', glassEdge: 'rgba(45,95,165,0.85)',
      glassPlane: 'rgba(45,95,165,0.35)', glassShine: 'rgba(255,255,255,0.9)',
      accent: '#e0782a', select: 'rgba(224,120,42,0.22)', hover: 'rgba(20,30,60,0.07)', plane: 'rgba(224,120,42,0.6)',
      source: '#c99a00', ray: '#2b3245', helper: '#7d879b', filament: '#d48a00',
      mirror: '#3d4555', mirrorBack: 'rgba(61,69,85,0.45)',
      blue: '#1f6fd6', red: '#d9422b', green: '#2e9e3a'
    },
    dark: {
      name: 'dark', bg: '#060913', text: '#e3e9f6', dim: '#94a0ba', panel: 'rgba(6,9,19,0.85)',
      grid: 'rgba(255,255,255,0.055)', gridMajor: 'rgba(255,255,255,0.12)', axis: 'rgba(255,255,255,0.55)',
      glassTop: 'rgba(150,190,255,0.30)', glassMid: 'rgba(110,150,230,0.16)', glassEdge: 'rgba(175,205,255,0.85)',
      glassPlane: 'rgba(175,205,255,0.3)', glassShine: 'rgba(255,255,255,0.35)',
      accent: '#ffb454', select: 'rgba(255,180,84,0.28)', hover: 'rgba(255,255,255,0.1)', plane: 'rgba(255,180,84,0.55)',
      source: '#f3e96b', ray: '#f3e96b', helper: '#8f9bb8', filament: '#ffc857',
      mirror: '#d5dcea', mirrorBack: 'rgba(213,220,234,0.4)',
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

  /** An optical axis across the whole width. highlight: a ray being drawn is parallel to it;
      o: { selected, hover } for the axis itself; label: drawn at its left end. */
  function axis(c, v, th, W, highlight, o, label) {
    var y = Math.round(v.Y(0)) + 0.5;
    o = o || {};
    if (highlight || o.selected || o.hover) {
      c.strokeStyle = o.hover && !o.selected && !highlight ? th.hover : th.select; c.lineWidth = 9;
      c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke();
    }
    c.strokeStyle = highlight || o.selected ? th.accent : th.axis;
    c.lineWidth = highlight ? 2.5 : 1.6;
    c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke();
    if (label) text(c, label, 80, y - 8, o.selected ? th.accent : th.dim, 'italic 12.5px ' + SANS, 'left', 'alphabetic');
  }

  /** A view of the world shifted so that an axis at height ay is its y = 0. */
  function shifted(v, ay) {
    return { s: v.s, X: function (z) { return v.X(z); }, Y: function (y) { return v.Y(y + ay); },
      z: function (px) { return v.z(px); }, y: function (py) { return v.y(py) - ay; } };
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

  /** A scan mirror, drawn unfolded: a short mirror turned by half the beam tilt (a mirror
      turned by α tilts the beam by 2α), hatched on its back, pivoting on the axis. When it is
      selected, a faint fan shows the scan range. */
  function mirror(c, v, th, e, o) {
    var X = v.X(e.z), Y = v.Y(0), h = e.ap * v.s, a = e.tilt / 2 * Math.PI / 180;
    var sx = Math.sin(a) * h, sy = Math.cos(a) * h;          // half-length along the mirror
    if (o.selected || o.hover) {
      c.strokeStyle = o.selected ? th.select : th.hover; c.lineWidth = 14; c.lineCap = 'round';
      c.beginPath(); c.moveTo(X - sx, Y - sy); c.lineTo(X + sx, Y + sy); c.stroke();
    }
    if (o.selected && e.range) {
      c.save(); c.strokeStyle = th.plane; c.lineWidth = 1; c.setLineDash([3, 4]);
      [-1, 1].forEach(function (k) {
        var b = (e.tilt + k * e.range) * Math.PI / 180, L = h * 2.2;
        c.beginPath(); c.moveTo(X, Y); c.lineTo(X + Math.cos(b) * L, Y - Math.sin(b) * L); c.stroke();
      });
      c.restore();
    }
    c.strokeStyle = th.mirrorBack; c.lineWidth = 1.2; c.lineCap = 'round';  // hatching on the back (left)
    for (var t = -0.85; t <= 0.86; t += 0.17) {
      var px = X + sx * t, py = Y + sy * t;
      c.beginPath(); c.moveTo(px, py); c.lineTo(px - 7, py + 5); c.stroke();
    }
    c.strokeStyle = th.mirror; c.lineWidth = 3.5; c.lineCap = 'round';
    c.beginPath(); c.moveTo(X - sx, Y - sy); c.lineTo(X + sx, Y + sy); c.stroke();
    c.fillStyle = th.bg; c.strokeStyle = th.mirror; c.lineWidth = 1.8;
    c.beginPath(); c.arc(X, Y, 3.5, 0, TAU); c.fill(); c.stroke();
    text(c, (e.label || 'scan mirror') + (e.tilt ? '  ' + (Math.round(e.tilt * 10) / 10) + '°' : ''),
      X, Y - h - 12, o.selected ? th.accent : th.text, '600 13px ' + SANS, 'center', 'alphabetic');
  }

  /** An iris: two blades reaching in from ±ap to the opening at ±r, with knife edges. When it
      is selected, the edges of the opening are handles. */
  function iris(c, v, th, e, o) {
    var X = v.X(e.z), Y = v.Y(0), r = e.r * v.s, A = e.ap * v.s;
    if (o.selected || o.hover) {
      c.strokeStyle = o.selected ? th.select : th.hover; c.lineWidth = 14; c.lineCap = 'round';
      c.beginPath(); c.moveTo(X, Y - A); c.lineTo(X, Y - r); c.moveTo(X, Y + r); c.lineTo(X, Y + A); c.stroke();
    }
    c.strokeStyle = th.mirror; c.lineCap = 'butt';
    c.lineWidth = 4.5;
    c.beginPath(); c.moveTo(X, Y - A); c.lineTo(X, Y - r); c.moveTo(X, Y + r); c.lineTo(X, Y + A); c.stroke();
    c.lineWidth = 2;                                      // knife edges at the opening
    c.beginPath(); c.moveTo(X - 6, Y - r); c.lineTo(X + 6, Y - r); c.moveTo(X - 6, Y + r); c.lineTo(X + 6, Y + r); c.stroke();
    if (o.selected) {
      c.fillStyle = th.bg; c.strokeStyle = th.accent; c.lineWidth = 2;
      [-1, 1].forEach(function (k) { c.beginPath(); c.arc(X, Y + k * r, 5, 0, TAU); c.fill(); c.stroke(); });
    }
    text(c, e.label || 'iris', X, Y - A - 10, o.selected ? th.accent : th.text, '600 13px ' + SANS, 'center', 'alphabetic');
  }

  /** A coil from screen point (X, Ya) to (X, Yb): the shape of a lamp filament. */
  function coil(c, X, Ya, Yb, col, w) {
    var L = Yb - Ya, n = Math.max(2, Math.round(Math.abs(L) / 7)), steps = n * 12;
    c.strokeStyle = col; c.lineWidth = w; c.lineJoin = 'round'; c.lineCap = 'round';
    c.beginPath();
    for (var i = 0; i <= steps; i++) {
      var t = i / steps, x = X + 4.5 * Math.sin(2 * Math.PI * n * t), y = Ya + L * t;
      if (i) c.lineTo(x, y); else c.moveTo(x, y);
    }
    c.stroke();
  }

  /** A lamp filament: a glowing coil from its bottom end to its top end, with a lead wire at
      each end. When it is selected, both ends are handles. */
  function filament(c, v, th, e, o) {
    var X = v.X(e.z), Yt = v.Y(e.top), Yb = v.Y(e.bottom), col = e.color || th.filament;
    if (o.selected || o.hover) {
      c.strokeStyle = o.selected ? th.select : th.hover; c.lineWidth = 18; c.lineCap = 'round';
      c.beginPath(); c.moveTo(X, Yt); c.lineTo(X, Yb); c.stroke();
    }
    c.save(); c.globalAlpha = 0.22; c.strokeStyle = col; c.lineWidth = 14; c.lineCap = 'round';   // the glow
    c.beginPath(); c.moveTo(X, Yt); c.lineTo(X, Yb); c.stroke(); c.restore();
    coil(c, X, Yb, Yt, col, 2);
    c.fillStyle = col;
    [Yt, Yb].forEach(function (Y) { c.beginPath(); c.arc(X, Y, 2.6, 0, TAU); c.fill(); });
    if (o.selected) {
      c.fillStyle = th.bg; c.strokeStyle = th.accent; c.lineWidth = 2;
      [Yt, Yb].forEach(function (Y) { c.beginPath(); c.arc(X, Y, 6.5, 0, TAU); c.fill(); c.stroke(); });
    }
    if (e.label) text(c, e.label, X + 12, Yt - 4, th.text, '600 14px ' + SANS, 'left', 'bottom');
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
  function rayPath(c, sp, col, w, W, dash) {
    c.strokeStyle = col; c.lineWidth = w; c.lineJoin = 'round'; c.lineCap = dash ? 'butt' : 'round';
    c.setLineDash(dash || []);
    c.beginPath();
    sp.forEach(function (p, i) { if (i) c.lineTo(p.x, p.y); else c.moveTo(p.x, p.y); });
    c.stroke();
    c.setLineDash([]);
    for (var i = 0; i + 1 < sp.length; i++) {
      var m = arrowSpot(sp[i], sp[i + 1], W);
      if (!m) continue;
      var L = Math.hypot(sp[i + 1].x - sp[i].x, sp[i + 1].y - sp[i].y);
      var ux = (sp[i + 1].x - sp[i].x) / L, uy = (sp[i + 1].y - sp[i].y) / L;
      arrowHead(c, m.x - ux, m.y - uy, m.x + ux * 5, m.y + uy * 5, 7 + w * 1.4, col);
    }
  }

  var ROLE_COLOUR = { parallel: 'blue', focal: 'red', central: 'green' };

  /** A ray's colour. In hint mode a principal ray takes its rule's colour (blue parallel, red
      focal, green central), over any colour picked for it; otherwise its own colour if set,
      else the default. */
  function rayColour(th, st, sol, r) {
    var role = st.scene.settings.colour && !r.helper && sol.roles[r.id];
    if (role) return th[ROLE_COLOUR[role]];
    if (r.color) return r.color;
    return r.helper ? th.helper : th.ray;
  }

  function rays(c, v, th, st, sol, W) {
    var showNodes = st.tool === 'ray';
    st.scene.rays.forEach(function (r) {
      var s = sol.rays[r.id];
      if (!s || !s.shown.length) return;
      var sp = s.shown.map(function (p) { return { x: v.X(p.z), y: v.Y(p.y) }; });
      var col = rayColour(th, st, sol, r), sel = r.id === st.sel, hov = r.id === st.hover;
      if (sel || hov) {
        c.save(); c.globalAlpha = 1;
        c.strokeStyle = sel ? th.select : th.hover; c.lineWidth = 10; c.lineJoin = 'round'; c.lineCap = 'round';
        c.beginPath(); sp.forEach(function (p, i) { if (i) c.lineTo(p.x, p.y); else c.moveTo(p.x, p.y); }); c.stroke();
        c.restore();
      }
      var w = r.helper ? 1.6 : 2.2, dash = r.helper ? [7, 5] : null;   // a helper: dashed construction line
      var lastNode = r.nodes[r.nodes.length - 1];
      if (lastNode && lastNode.auto && !s.trimmed && sp.length > 1) {
        // lengthened by RayMan to meet an image that has since gone: shown faint until it meets again
        if (sp.length > 2) rayPath(c, sp.slice(0, -1), col, w, W, dash);
        c.save(); c.globalAlpha = 0.5; rayPath(c, sp.slice(-2), col, w, W, dash); c.restore();
      } else rayPath(c, sp, col, w, W, dash);
      if (showNodes || sel) {
        sp.forEach(function (p, i) {
          if (RM.rays.isJoint(st.scene, r, s, i)) return;       // straight through a centre: not a node
          var last = i === sp.length - 1 && !s.trimmed;          // an open end that can be continued
          c.fillStyle = th.bg; c.strokeStyle = col; c.lineWidth = 1.8;
          c.beginPath(); c.arc(p.x, p.y, last ? 5 : 3.5, 0, TAU); c.fill(); c.stroke();
        });
      }
    });
  }

  /** Fill-in rays: thin and faint, between the two outermost rays of each bundle. */
  function fills(c, v, th, st, sol, W) {
    var n = st.scene.settings.fill || 0;
    if (!n) return;
    c.save(); c.globalAlpha = 0.38;
    RM.rays.fillRays(st.scene, sol, n).forEach(function (f) {
      var sp = f.pts.map(function (p) { return { x: v.X(p.z), y: v.Y(p.y) }; });
      c.strokeStyle = f.ray.color || th.ray;              // the bundle's colour, never a rule's (they are not principal rays)
      c.lineWidth = 1; c.lineJoin = 'round';
      c.beginPath(); sp.forEach(function (p, i) { if (i) c.lineTo(p.x, p.y); else c.moveTo(p.x, p.y); }); c.stroke();
    });
    c.restore();
  }

  /** The images the rays form: an arrow (image of an object) or a point (image of a point
      source). Real images are solid; virtual ones are dashed and hollow, with the rays'
      backward extensions drawn dashed to them. Coloured like the object they come from. */
  function images(c, v, th, st, sol) {
    // a lamp filament's two ends imaged through the same lens make an image of the filament
    var pairs = {}, inPair = {};
    sol.images.forEach(function (im, i) {
      var key = RM.rays.refKey(im.src), end = /:(top|bot)\b/.exec(key);
      if (!end || im.focus) return;
      var k = key.replace(/:(top|bot)\b/, ':*') + '@' + im.lens + (im.virtual ? 'v' : 'r');
      (pairs[k] = pairs[k] || {})[end[1]] = i;
    });
    Object.keys(pairs).forEach(function (k) {
      var p = pairs[k];
      if (p.top == null || p.bot == null) return;
      inPair[p.top] = inPair[p.bot] = true;
      var a = sol.images[p.top], b = sol.images[p.bot], root = RM.rays.rootElement(st.scene, a.src);
      var col = (root && root.color) || th.filament, X = v.X((a.z + b.z) / 2);
      c.save(); c.globalAlpha = 0.55;
      if (a.virtual) c.setLineDash([4, 3]);
      coil(c, X, v.Y(b.y), v.Y(a.y), col, 1.8);
      c.setLineDash([]);
      text(c, a.virtual ? 'virtual image' : 'image', X + 10, Math.min(v.Y(a.y), v.Y(b.y)) - 4, th.dim, 'italic 13px ' + SANS, 'left', 'bottom');
      c.restore();
    });
    sol.images.forEach(function (im, i) {
      if (inPair[i]) {                                    // drawn as part of the filament's image; just mark the ends
        c.save(); c.globalAlpha = 0.55; c.fillStyle = th.text;
        c.beginPath(); c.arc(v.X(im.z), v.Y(im.y), 2.5, 0, TAU); c.fill(); c.restore();
        if (!im.virtual) return;
      }
      var root = RM.rays.rootElement(st.scene, im.src);
      var col = root && root.type === 'object' ? root.color || th.green : root && root.type === 'point' ? th.source :
        root && root.type === 'filament' ? root.color || th.filament : th.text;
      if (im.focus) col = th.text;
      var X = v.X(im.z), Y0 = v.Y(0), Y1 = v.Y(im.y), up = im.y >= 0 ? 1 : -1;
      c.save();
      c.globalAlpha = 0.55;                               // images are fainter than objects
      if (im.virtual) {                                   // backward extensions of the rays
        c.setLineDash([5, 5]); c.lineWidth = 1.5;
        im.rays.forEach(function (rr) {
          var r = st.scene.rays.filter(function (x) { return x.id === rr.ray; })[0];
          if (!r) return;
          c.strokeStyle = rayColour(th, st, sol, r);
          c.beginPath(); c.moveTo(v.X(rr.a.z), v.Y(rr.a.y)); c.lineTo(X, Y1); c.stroke();
        });
      }
      if (inPair[i]) { c.restore(); return; }            // the filament's image is already drawn
      if (im.arrow && Math.abs(Y1 - Y0) > 4) {
        var head = Math.min(15, Math.abs(Y1 - Y0) * 0.6);
        c.strokeStyle = col; c.lineWidth = 3; c.lineCap = 'butt';
        c.setLineDash(im.virtual ? [6, 4] : []);
        c.beginPath(); c.moveTo(X, Y0); c.lineTo(X, Y1 + up * head * 0.7); c.stroke();
        c.setLineDash([]);
        if (im.virtual) {                                 // hollow head
          c.fillStyle = th.bg; arrowHead(c, X, Y0, X, Y1, head, th.bg);
          c.lineWidth = 1.8; c.beginPath();
          c.moveTo(X, Y1); c.lineTo(X - head * 0.42, Y1 + up * head); c.lineTo(X + head * 0.42, Y1 + up * head); c.closePath(); c.stroke();
        } else arrowHead(c, X, Y0, X, Y1, head, col);
      } else {
        c.setLineDash([]); c.lineWidth = 2;
        c.strokeStyle = col; c.fillStyle = im.virtual ? th.bg : col;
        c.beginPath(); c.arc(X, Y1, 5, 0, TAU); c.fill(); c.stroke();
      }
      c.setLineDash([]);
      text(c, im.focus ? 'focus' : im.virtual ? 'virtual image' : 'image', X + 9, Y1 - up * 2, th.dim, 'italic 13px ' + SANS, 'left', up > 0 ? 'bottom' : 'top');
      c.restore();
    });
  }

  /** The segment being drawn, from the ray's last point to where it would end. */
  function draft(c, v, th, d, W) {
    if (!d || !d.from) return;
    var a = { x: v.X(d.from.z), y: v.Y(d.from.y) };
    c.save();
    if (d.pts && d.pts.length) {
      c.globalAlpha = 0.85;
      rayPath(c, [a].concat(d.pts.map(function (p) { return { x: v.X(p.z), y: v.Y(p.y) }; })),
        d.color || (d.helper ? th.helper : th.ray), d.helper ? 1.6 : 2.2, W, d.helper ? [7, 5] : null);
    }
    c.globalAlpha = 1; c.fillStyle = th.accent;
    c.beginPath(); c.arc(a.x, a.y, 4.5, 0, TAU); c.fill();
    c.restore();
  }

  /** What something snapped to: rings around points, a glow along a ray it is parallel to, and
      the focal plane it is aimed across. */
  function hints(c, v, th, list) {
    (list || []).forEach(function (h) {
      if (h.seg) {
        c.save(); c.strokeStyle = th.select; c.lineWidth = 9; c.lineCap = 'round';
        c.beginPath(); c.moveTo(v.X(h.seg.a.z), v.Y(h.seg.a.y)); c.lineTo(v.X(h.seg.b.z), v.Y(h.seg.b.y)); c.stroke();
        c.restore();
      }
      if (h.plane) focalPlane(c, v, { plane: th.accent }, h.plane.z, h.plane.ap);
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

  /** Draw one frame. st: { real (the whole scene), view, theme, tool, sel, hover, axis (the one
      being worked on: ghost, draft, hints and highlights belong to it), ghost, hints, hotFocal,
      axisHot, draft, caption }. Each optical axis is drawn from its own view, shifted to its
      height. A scene with no axes (as in old files and the tests) is one implicit axis at 0. */
  function draw(c, W, H, st) {
    var th = THEMES[st.theme] || THEMES.light, real = st.real || st.scene;
    c.fillStyle = th.bg; c.fillRect(0, 0, W, H);
    grid(c, st.view, th, W, H);
    var list = RM.scene.axes(real);
    (list.length ? list : [null]).forEach(function (ax) {
      var on = !ax || ax.id === st.axis;
      bench(c, W, H, th, Object.assign({}, st, {
        scene: ax ? RM.scene.axisView(real, ax.id) : real,
        view: ax ? shifted(st.view, ax.y) : st.view,
        ghost: on && st.ghost && st.ghost.type !== 'axis' ? st.ghost : null,
        draft: on ? st.draft : null, hints: on ? st.hints : null,
        hotFocal: on ? st.hotFocal : null, axisHot: on && st.axisHot
      }), ax);
    });
    if (st.ghost && st.ghost.type === 'axis') {          // a new axis about to be placed
      c.save(); c.globalAlpha = 0.45; c.setLineDash([8, 6]);
      axis(c, shifted(st.view, st.ghost.y), th, W, false, {}, '');
      c.restore();
    }
    caption(c, th, st.caption, W);
  }

  /** One optical axis and everything on it. st.scene is the axis's view, st.view is shifted. */
  function bench(c, W, H, th, st, ax) {
    var v = st.view, els = st.scene.elements;
    var sol = RM.rays.solveScene(st.scene);
    axis(c, v, th, W, st.axisHot, ax ? { selected: ax.id === st.sel, hover: ax.id === st.hover } : {}, ax && ax.label);

    var nL = els.filter(function (e) { return e.type === 'lens'; }).length;
    function opts(e) { return { selected: e.id === st.sel, hover: e.id === st.hover }; }

    els.forEach(function (e) {
      if (e.type === 'lens' && e.planes) {
        var fp = G.focalPoints(e);
        focalPlane(c, v, th, fp.F, e.ap); focalPlane(c, v, th, fp.Fp, e.ap);
      }
    });
    els.forEach(function (e) { if (e.type === 'lens') lens(c, v, th, e, opts(e)); });
    els.forEach(function (e) { if (e.type === 'mirror') mirror(c, v, th, e, opts(e)); });
    els.forEach(function (e) { if (e.type === 'iris') iris(c, v, th, e, opts(e)); });
    focalMarkers(c, v, th, els, nL, st.hotFocal || {});
    els.forEach(function (e) { if (e.type === 'object') objectArrow(c, v, th, e, opts(e)); });
    els.forEach(function (e) { if (e.type === 'filament') filament(c, v, th, e, opts(e)); });
    fills(c, v, th, st, sol, W);
    rays(c, v, th, st, sol, W);
    images(c, v, th, st, sol);
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
      else if (g.type === 'mirror') mirror(c, v, th, g, o);
      else if (g.type === 'iris') iris(c, v, th, g, o);
      else if (g.type === 'filament') filament(c, v, th, g, o);
      c.restore();
    }
    draft(c, v, th, st.draft, W);
    hints(c, v, th, st.hints);
  }

  RM.render = { THEMES: THEMES, draw: draw, focalLabels: focalLabels, ROLE_COLOUR: ROLE_COLOUR };
})(typeof self !== 'undefined' ? self : this);
