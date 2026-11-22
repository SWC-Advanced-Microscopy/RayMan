/* RayMan drawing: everything that touches the canvas. The ray colours follow the
   optics.mouse.vision demos (blue parallel, red focal, green central). */
/* Short names used in this file:
     X, Y     where something is on the screen, in pixels (view.X(z), view.Y(y)); Yt, Yb, Ym: top, bottom, middle
     x, y     a screen position; z: a position along the axis in mm; w, h: a width and height in pixels
     A        an aperture (half-height) in pixels; T: a lens's half thickness in pixels; ap: aperture in mm
     r        a radius, or a ray in the ray-drawing code; s: a solved ray; k, i: list indices
     a, b     the ends of a line; g: a gap in the ruler numbers, or a gradient; p: a point; t: a fraction
     G        the geometry module (geom.js); SANS, SERIF: the fonts */

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
  function arrowHead(ctx, x0, y0, x1, y1, size, col) {
    var dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy);
    if (L < 1e-6) return;
    var ux = dx / L, uy = dy / L, h = size;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - ux * h - uy * h * 0.42, y1 - uy * h + ux * h * 0.42);
    ctx.lineTo(x1 - ux * h + uy * h * 0.42, y1 - uy * h - ux * h * 0.42);
    ctx.closePath(); ctx.fill();
  }

  /** Draw the string s at (x, y) in colour col; align and base default to centred. */
  function text(ctx, s, x, y, col, font, align, base) {
    ctx.fillStyle = col; ctx.font = font;
    ctx.textAlign = align || 'center'; ctx.textBaseline = base || 'middle';
    ctx.fillText(s, x, y);
  }

  /** Focal-point labels for a lens, as lists of parts ({ t, sub }) for richText: F and F′
      with a subscript naming the lens. A lens called Ln gets its number, when there are several
      lenses; a lens with its own name (collector, condenser) gets that name, so F_collector and
      F′_condenser can be told apart. */
  function focalLabels(lens, nLenses) {
    var name = lens.label || '', m = /^L(\d+)$/.exec(name);
    var s = m ? (nLenses > 1 ? m[1] : '') : name.length > 10 ? name.slice(0, 9) + '…' : name;
    var sub = s ? [{ t: s, sub: true }] : [];
    return { F: [{ t: 'F' }].concat(sub), Fp: [{ t: 'F′' }].concat(sub) };
  }

  /** Widths of the parts of a rich label, and the whole: { ws, w }. */
  function richWidths(ctx, parts, font) {
    var subFont = font.replace(/(\d+)px/, function (all, n) { return Math.round(n * 0.62) + 'px'; }), w = 0;
    var ws = parts.map(function (p) { ctx.font = p.sub ? subFont : font; return ctx.measureText(p.t).width + (p.sub ? 1 : 0); });
    ws.forEach(function (d) { w += d; });
    return { ws: ws, w: w, subFont: subFont };
  }

  /** Draw a label made of parts ({ t, sub }) centred at x, y: subscripts smaller and lowered. */
  function richText(ctx, parts, x, y, col, font) {
    var m = richWidths(ctx, parts, font), ws = m.ws, w = m.w, subFont = m.subFont;
    var size = +/(\d+)px/.exec(font)[1];
    var at = x - w / 2;
    ctx.fillStyle = col; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    parts.forEach(function (p, i) {
      ctx.font = p.sub ? subFont : font;
      ctx.fillText(p.t, at, p.sub ? y + size * 0.3 : y);
      at += ws[i];
    });
  }

  // ---------------------------------------------------------------- the bench

  var RULER_RED = '#d9422b';

  /** Where the cursor's marker on the ruler goes: the line at the cursor's x, and a label to its
      right in the numbers' band at the bottom. Its text is measured here, so the grid can drop the
      numbers it covers. */
  function rulerGeometry(ctx, canvasHeight, ruler) {
    var label = ruler.z.toFixed(1) + ' mm', pad = 5;
    ctx.font = '600 11px ' + SANS;
    var tw = ctx.measureText(label).width, x0 = ruler.px + 5, x1 = x0 + tw + 2 * pad;
    return { x: ruler.px, canvasHeight: canvasHeight, label: label, pad: pad, box: { x0: x0, x1: x1, y0: canvasHeight - 21, y1: canvasHeight - 5 },
      from: ruler.px - 2, to: x1 };
  }

  /** The marker: a 2 px red line from the bottom of the bench up to just above the numbers, and a
      red box with white text at its top right. */
  function rulerMarker(ctx, theme, canvasHeight, g) {
    ctx.save();
    ctx.fillStyle = RULER_RED; ctx.globalAlpha = 0.9;
    ctx.fillRect(g.x - 1, canvasHeight - 22, 2, 22);
    ctx.globalAlpha = 1;
    var b = g.box, r = 4;                                   // rounded corners (arcTo: works on older Safari too)
    ctx.beginPath();
    ctx.moveTo(b.x0 + r, b.y0); ctx.arcTo(b.x1, b.y0, b.x1, b.y1, r); ctx.arcTo(b.x1, b.y1, b.x0, b.y1, r);
    ctx.arcTo(b.x0, b.y1, b.x0, b.y0, r); ctx.arcTo(b.x0, b.y0, b.x1, b.y0, r); ctx.closePath(); ctx.fill();
    text(ctx, g.label, g.box.x0 + g.pad, (g.box.y0 + g.box.y1) / 2, '#ffffff', '600 11px ' + SANS, 'left', 'middle');
    ctx.restore();
  }

  /** Draw the background grid and the ruler along the axis, with lines at nice spacings. */
  function grid(ctx, view, theme, canvasWidth, canvasHeight, ruler, scale) {
    var step = G.niceStep(view.s, 14), every = G.majorEvery(step);
    var minor = new Path2D(), major = new Path2D(), k, x, y;
    for (k = Math.ceil(view.z(0) / step); k * step <= view.z(canvasWidth); k++) {
      x = Math.round(view.X(k * step)) + 0.5;
      (k % every === 0 ? major : minor).moveTo(x, 0);
      (k % every === 0 ? major : minor).lineTo(x, canvasHeight);
    }
    for (k = Math.ceil(view.y(canvasHeight) / step); k * step <= view.y(0); k++) {
      y = Math.round(view.Y(k * step)) + 0.5;
      (k % every === 0 ? major : minor).moveTo(0, y);
      (k % every === 0 ? major : minor).lineTo(canvasWidth, y);
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = theme.grid; ctx.stroke(minor);
    ctx.strokeStyle = theme.gridMajor; ctx.stroke(major);
    if (scale === false) return;                          // no ruler (the web embed)
    // scale along the bottom edge, in mm; a number that the cursor's marker covers is left out
    var big = G.rulerStep(view.s, canvasWidth), dec = big < 1 ? Math.ceil(-Math.log10(big)) : 0;   // about 10 to 15 numbers
    var g = ruler ? rulerGeometry(ctx, canvasHeight, ruler) : null;
    /** True if a ruler number at xc (half-width half) would overlap the gap g. */
    function covered(xc, half) { return g && xc + half > g.from && xc - half < g.to; }
    ctx.font = '11px ' + SANS;
    for (k = Math.ceil(view.z(0) / big); k * big <= view.z(canvasWidth); k++) {
      x = view.X(k * big);
      if (x < 24 || x > canvasWidth - 40) continue;
      var s = (k * big).toFixed(dec);
      if (covered(x, ctx.measureText(s).width / 2)) continue;
      text(ctx, s, x, canvasHeight - 10, theme.dim, '11px ' + SANS);
    }
    var mmW = ctx.measureText('mm').width;                  // right-aligned at canvasWidth - 14
    if (!covered(canvasWidth - 14 - mmW / 2, mmW / 2)) text(ctx, 'mm', canvasWidth - 14, canvasHeight - 10, theme.dim, '11px ' + SANS, 'right');
  }

  /** An optical axis across the whole width. highlight: a ray being drawn is parallel to it;
      options: { selected, hover } for the axis itself; label: drawn at its left end. */
  function axis(ctx, view, theme, canvasWidth, highlight, options, label) {
    var y = Math.round(view.Y(0)) + 0.5;
    options = options || {};
    if (highlight || options.selected || options.hover) {
      ctx.strokeStyle = options.hover && !options.selected && !highlight ? theme.hover : theme.select; ctx.lineWidth = 9;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvasWidth, y); ctx.stroke();
    }
    ctx.strokeStyle = highlight || options.selected ? theme.accent : theme.axis;
    ctx.lineWidth = highlight ? 2.5 : 1.6;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvasWidth, y); ctx.stroke();
    if (label) text(ctx, label, 80, y - 8, options.selected ? theme.accent : theme.dim, 'italic 12.5px ' + SANS, 'left', 'alphabetic');
  }

  /** A view of the world shifted so that an axis at height ay is its y = 0. */
  function shifted(view, ay) {
    return { s: view.s, X: function (z) { return view.X(z); }, Y: function (y) { return view.Y(y + ay); },
      z: function (px) { return view.z(px); }, y: function (py) { return view.y(py) - ay; } };
  }

  /** How thick (px, at the centre or the rim) to draw a lens: stronger lenses look fatter,
      as a real lens of the same diameter would (sag ~ ap² / f). */
  function lensThickness(view, element) {
    var hpx = 2 * element.ap * view.s;
    return Math.max(7, Math.min(0.42 * element.ap * element.ap / Math.abs(element.f) * view.s, 0.22 * hpx, 34));
  }

  /** A thin ideal lens drawn as glass: biconvex for f > 0, biconcave for f < 0, with a faint
      line marking the plane where the (thin-lens) refraction happens. */
  function lens(ctx, view, theme, element, options) {
    var X = view.X(element.z), Yt = view.Y(element.ap), Yb = view.Y(-element.ap), Ym = view.Y(0), T = lensThickness(view, element);
    var path = new Path2D();
    if (element.f > 0) {                                    // pointed ends, bulging faces
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
    if (options.selected || options.hover) {
      ctx.save();
      ctx.strokeStyle = options.selected ? theme.select : theme.hover; ctx.lineWidth = 12; ctx.lineJoin = 'round';
      ctx.stroke(path); ctx.restore();
    }
    var g = ctx.createLinearGradient(X - T, 0, X + T, 0);
    g.addColorStop(0, theme.glassMid); g.addColorStop(0.42, theme.glassTop); g.addColorStop(1, theme.glassMid);
    ctx.fillStyle = g; ctx.fill(path);
    ctx.strokeStyle = theme.glassPlane; ctx.lineWidth = 1;   // the thin-lens plane
    ctx.beginPath(); ctx.moveTo(X, Yt); ctx.lineTo(X, Yb); ctx.stroke();
    ctx.strokeStyle = theme.glassEdge; ctx.lineWidth = 1.6; ctx.lineJoin = 'round';
    ctx.stroke(path);
    if (element.label) text(ctx, element.label, X, Yt - 12, options.selected ? theme.accent : theme.text, '600 14px ' + SANS, 'center', 'alphabetic');
  }

  /** Draw a dashed focal plane at position z, as tall as the aperture ap. */
  function focalPlane(ctx, view, theme, z, ap) {
    var X = Math.round(view.X(z)) + 0.5;
    ctx.save();
    ctx.strokeStyle = theme.plane; ctx.lineWidth = 1.4; ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.moveTo(X, view.Y(ap * 1.15)); ctx.lineTo(X, view.Y(-ap * 1.15)); ctx.stroke();
    ctx.restore();
  }

  /** A scan mirror, drawn unfolded: a short mirror turned by half the beam tilt (a mirror
      turned by α tilts the beam by 2α), hatched on its back, pivoting on the axis. When it is
      selected, a faint fan shows the scan range. */
  function mirror(ctx, view, theme, element, options) {
    var X = view.X(element.z), Y = view.Y(0), h = element.ap * view.s, a = element.tilt / 2 * Math.PI / 180;
    var sx = Math.sin(a) * h, sy = Math.cos(a) * h;          // half-length along the mirror
    if (options.selected || options.hover) {
      ctx.strokeStyle = options.selected ? theme.select : theme.hover; ctx.lineWidth = 14; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(X - sx, Y - sy); ctx.lineTo(X + sx, Y + sy); ctx.stroke();
    }
    if (options.selected && element.range) {
      ctx.save(); ctx.strokeStyle = theme.plane; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
      [-1, 1].forEach(function (k) {
        var b = (element.tilt + k * element.range) * Math.PI / 180, L = h * 2.2;
        ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X + Math.cos(b) * L, Y - Math.sin(b) * L); ctx.stroke();
      });
      ctx.restore();
    }
    var hb = element.flip ? 1 : -1;                                 // hatching on the back: left, or right if flipped
    ctx.strokeStyle = theme.mirrorBack; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
    for (var t = -0.85; t <= 0.86; t += 0.17) {
      var px = X + sx * t, py = Y + sy * t;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + 7 * hb, py + 5); ctx.stroke();
    }
    ctx.strokeStyle = theme.mirror; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(X - sx, Y - sy); ctx.lineTo(X + sx, Y + sy); ctx.stroke();
    ctx.fillStyle = theme.bg; ctx.strokeStyle = theme.mirror; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.arc(X, Y, 3.5, 0, TAU); ctx.fill(); ctx.stroke();
    text(ctx, (element.label || 'scan mirror') + (element.tilt ? '  ' + (Math.round(element.tilt * 10) / 10) + '°' : ''),
      X, Y - h - 12, options.selected ? theme.accent : theme.text, '600 13px ' + SANS, 'center', 'alphabetic');
  }

  /** An iris: two blades reaching in from ±ap to the opening at ±r, with knife edges. When it
      is selected, the edges of the opening are handles. */
  function iris(ctx, view, theme, element, options) {
    var X = view.X(element.z), Y = view.Y(0), r = element.r * view.s, A = element.ap * view.s;
    if (options.selected || options.hover) {
      ctx.strokeStyle = options.selected ? theme.select : theme.hover; ctx.lineWidth = 14; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(X, Y - A); ctx.lineTo(X, Y - r); ctx.moveTo(X, Y + r); ctx.lineTo(X, Y + A); ctx.stroke();
    }
    ctx.strokeStyle = theme.mirror; ctx.lineCap = 'butt';
    ctx.lineWidth = 4.5;
    ctx.beginPath(); ctx.moveTo(X, Y - A); ctx.lineTo(X, Y - r); ctx.moveTo(X, Y + r); ctx.lineTo(X, Y + A); ctx.stroke();
    ctx.lineWidth = 2;                                      // knife edges at the opening
    ctx.beginPath(); ctx.moveTo(X - 6, Y - r); ctx.lineTo(X + 6, Y - r); ctx.moveTo(X - 6, Y + r); ctx.lineTo(X + 6, Y + r); ctx.stroke();
    if (options.selected) {
      ctx.fillStyle = theme.bg; ctx.strokeStyle = theme.accent; ctx.lineWidth = 2;
      [-1, 1].forEach(function (k) { ctx.beginPath(); ctx.arc(X, Y + k * r, 5, 0, TAU); ctx.fill(); ctx.stroke(); });
    }
    text(ctx, element.label || 'iris', X, Y - A - 10, options.selected ? theme.accent : theme.text, '600 13px ' + SANS, 'center', 'alphabetic');
  }

  /** An image plane marker (sample, camera): a thin dashed line across the axis, short hatching
      on its far side like a screen, and its name above. Rays pass through it. */
  function imagePlane(ctx, view, theme, element, options) {
    var X = view.X(element.z), Y = view.Y(0), A = element.ap * view.s;
    if (options.selected || options.hover) {
      ctx.strokeStyle = options.selected ? theme.select : theme.hover; ctx.lineWidth = 12; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(X, Y - A); ctx.lineTo(X, Y + A); ctx.stroke();
    }
    var col = element.color || theme.dim;                             // a colour shows which family of planes it is in
    ctx.strokeStyle = col; ctx.lineCap = 'butt'; ctx.lineWidth = element.color ? 2 : 1.5;
    ctx.setLineDash([7, 4]);
    ctx.beginPath(); ctx.moveTo(X, Y - A); ctx.lineTo(X, Y + A); ctx.stroke();
    ctx.setLineDash([]); ctx.lineWidth = 1;
    ctx.beginPath();
    for (var y = -A; y < A - 1; y += 8) { ctx.moveTo(X + 1, Y + y + 5); ctx.lineTo(X + 6, Y + y); }
    ctx.stroke();
    text(ctx, element.label || 'image plane', X, Y - A - 10, options.selected ? theme.accent : col, 'italic 600 13px ' + SANS, 'center', 'alphabetic');
  }

  /** A dichroic, drawn unfolded: a thin glass plate on the axis, tilted as a dichroic is, tinted
      with the colour it stops (if any). */
  function dichroic(ctx, view, theme, element, options) {
    var X = view.X(element.z), Y = view.Y(0), A = element.ap * view.s, k = 0.4 * A, w = 3;
    var a = { x: X - k, y: Y + A }, b = { x: X + k, y: Y - A };
    var L = Math.hypot(b.x - a.x, b.y - a.y), nx = (b.y - a.y) / L * w, ny = -(b.x - a.x) / L * w;
    if (options.selected || options.hover) {
      ctx.strokeStyle = options.selected ? theme.select : theme.hover; ctx.lineWidth = 14; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(a.x + nx, a.y + ny); ctx.lineTo(b.x + nx, b.y + ny); ctx.lineTo(b.x - nx, b.y - ny); ctx.lineTo(a.x - nx, a.y - ny); ctx.closePath();
    ctx.save(); ctx.globalAlpha = element.stop ? 0.55 : 1; ctx.fillStyle = element.stop || theme.glassMid; ctx.fill(); ctx.restore();
    ctx.strokeStyle = theme.dim; ctx.lineWidth = 1.2; ctx.lineJoin = 'round'; ctx.stroke();
    text(ctx, element.label || 'dichroic', X, Y - A - 10, options.selected ? theme.accent : theme.dim, 'italic 600 13px ' + SANS, 'center', 'alphabetic');
  }

  /** A small cross where a ray is stopped by the rim of a lens or mirror (it misses it). */
  function cross(ctx, p, col) {
    ctx.strokeStyle = col; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(p.x - 5, p.y - 5); ctx.lineTo(p.x + 5, p.y + 5); ctx.moveTo(p.x + 5, p.y - 5); ctx.lineTo(p.x - 5, p.y + 5); ctx.stroke();
  }

  /** A label written by a ray (r1, h2): digits at the end become a subscript. It sits beside
      the middle of the ray's first segment, on the side away from the axis (screen y axisY). */
  function rayLabel(ctx, sp, label, col, axisY) {
    if (!label || sp.length < 2) return;
    var a = sp[0], b = sp[1], L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L < 1) return;
    var mx = a.x + (b.x - a.x) * Math.min(0.5, 140 / L), my = a.y + (b.y - a.y) * Math.min(0.5, 140 / L);
    var nx = (b.y - a.y) / L, ny = -(b.x - a.x) / L;
    var below = axisY != null && my > axisY + 1;               // a ray below the axis: label below it
    if ((ny > 0) !== below) { nx = -nx; ny = -ny; }
    var m = /^(.*?)(\d+)$/.exec(label), parts = m && m[1] ? [{ t: m[1] }, { t: m[2], sub: true }] : [{ t: label }];
    richText(ctx, parts, mx + nx * 13, my + ny * 13, col, SERIF.replace('19px', '17px'));
  }

  /** With "show the scan extremes" on a mirror, the light it steers is drawn again, faintly, at
      both ends of the scan (rest tilt ± range). base: the mirror's rest tilt while it scans. */
  function scanExtremes(ctx, view, theme, state, solution, canvasWidth) {
    state.scene.elements.forEach(function (m) {
      if (m.type !== 'mirror' || !m.extremes || !m.range) return;
      var base = state.scanBase && state.scanBase[m.id] != null ? state.scanBase[m.id] : m.tilt;
      [-1, 1].forEach(function (k) {
        var elements = state.scene.elements.map(function (element) { return element.id === m.id ? Object.assign({}, element, { tilt: base + k * m.range }) : element; });
        var alt = RM.rays.solveScene({ elements: elements, rays: state.scene.rays, settings: state.scene.settings });
        state.scene.rays.forEach(function (r) {
          var a = alt.rays[r.id], s0 = solution.rays[r.id];
          if (!a || !a.shown.length || r.helper) return;
          var same = s0 && s0.shown.length === a.shown.length && a.shown.every(function (p, i) {
            return Math.abs(p.z - s0.shown[i].z) < 1e-6 && Math.abs(p.y - s0.shown[i].y) < 1e-6;
          });
          if (same && base === m.tilt) return;              // not steered by this mirror
          var sp = a.shown.map(function (p) { return { x: view.X(p.z), y: view.Y(p.y) }; });
          ctx.save(); ctx.globalAlpha = 0.3; rayPath(ctx, sp, rayColour(theme, state, solution, r), 1.6, canvasWidth, null);
          if (a.rim) { ctx.globalAlpha = 0.5; cross(ctx, sp[sp.length - 1], theme.red); }
          ctx.restore();
        });
      });
    });
  }

  /** A coil from screen point (X, Ya) to (X, Yb): the shape of a lamp filament. */
  function coil(ctx, X, Ya, Yb, col, w) {
    var L = Yb - Ya, n = Math.max(2, Math.round(Math.abs(L) / 7)), steps = n * 12;
    ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    for (var i = 0; i <= steps; i++) {
      var t = i / steps, x = X + 4.5 * Math.sin(2 * Math.PI * n * t), y = Ya + L * t;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.stroke();
  }

  /** A lamp filament: a glowing coil from its bottom end to its top end, with a lead wire at
      each end. When it is selected, both ends are handles. */
  function filament(ctx, view, theme, element, options) {
    var X = view.X(element.z), Yt = view.Y(element.top), Yb = view.Y(element.bottom), col = element.color || theme.filament;
    if (options.selected || options.hover) {
      ctx.strokeStyle = options.selected ? theme.select : theme.hover; ctx.lineWidth = 18; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(X, Yt); ctx.lineTo(X, Yb); ctx.stroke();
    }
    ctx.save(); ctx.globalAlpha = 0.22; ctx.strokeStyle = col; ctx.lineWidth = 14; ctx.lineCap = 'round';   // the glow
    ctx.beginPath(); ctx.moveTo(X, Yt); ctx.lineTo(X, Yb); ctx.stroke(); ctx.restore();
    coil(ctx, X, Yb, Yt, col, 2);
    ctx.fillStyle = col;
    [Yt, Yb].forEach(function (Y) { ctx.beginPath(); ctx.arc(X, Y, 2.6, 0, TAU); ctx.fill(); });
    if (options.selected) {
      ctx.fillStyle = theme.bg; ctx.strokeStyle = theme.accent; ctx.lineWidth = 2;
      [Yt, Yb].forEach(function (Y) { ctx.beginPath(); ctx.arc(X, Y, 6.5, 0, TAU); ctx.fill(); ctx.stroke(); });
    }
    if (element.label) text(ctx, element.label, X + 12, Yt - 4, theme.text, '600 14px ' + SANS, 'left', 'bottom');
  }

  /** A collimated beam's source: a bar across the beam (at right angles to it) with a short
      emitter block behind, in the beam's colour. */
  function beam(ctx, view, theme, element, options) {
    var a = element.angle * Math.PI / 180, h = element.width / 2, col = element.color || theme.ray, d = element.dir === -1 ? -1 : 1;
    var top = { x: view.X(element.z - d * h * Math.sin(a)), y: view.Y(element.y + h * Math.cos(a)) };
    var bot = { x: view.X(element.z + d * h * Math.sin(a)), y: view.Y(element.y - h * Math.cos(a)) };
    var bx = -d * Math.cos(a) * 9, by = Math.sin(a) * 9;  // "behind": against the beam, on screen
    if (options.selected || options.hover) {
      ctx.strokeStyle = options.selected ? theme.select : theme.hover; ctx.lineWidth = 16; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(bot.x, bot.y); ctx.stroke();
    }
    ctx.fillStyle = col; ctx.globalAlpha = 0.25;
    ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(bot.x, bot.y); ctx.lineTo(bot.x + bx, bot.y + by); ctx.lineTo(top.x + bx, top.y + by); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1; ctx.strokeStyle = col; ctx.lineWidth = 4; ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(bot.x, bot.y); ctx.stroke();
    if (element.label) text(ctx, element.label, top.x, top.y - 8, theme.text, '600 13px ' + SANS, 'center', 'alphabetic');
  }

  /** A focal point: a dot on the axis with a serif label below it. */
  function focal(ctx, view, theme, z, label, hot, row) {
    var X = view.X(z), Y = view.Y(0);
    ctx.fillStyle = hot ? theme.accent : theme.text;
    ctx.beginPath(); ctx.arc(X, Y, hot ? 5 : 3.5, 0, TAU); ctx.fill();
    richText(ctx, label, X, Y + 24 + (row || 0) * 20, hot ? theme.accent : theme.text, SERIF);
  }

  /** All the lenses' focal points. Points that coincide on screen (as in a 4f system, where
      F′ of one lens is F of the next) share one dot and one label, "F₁′ = F₂". */
  function focalMarkers(ctx, view, theme, elements, nL, hot) {
    var pts = [];
    elements.forEach(function (element) {
      if (element.type !== 'lens') return;
      var fp = G.focalPoints(element), lab = focalLabels(element, nL);
      pts.push({ z: fp.F, label: lab.F, hot: hot.id === element.id && hot.which === 'F' },
        { z: fp.Fp, label: lab.Fp, hot: hot.id === element.id && hot.which === 'Fp' });
    });
    pts.sort(function (a, b) { return a.z - b.z; });
    var rights = [], boxes = [];                           // right end of the last label on each row
    for (var i = 0; i < pts.length;) {
      var g = [pts[i]], j = i + 1;
      while (j < pts.length && view.X(pts[j].z) - view.X(g[0].z) < 3) g.push(pts[j++]);
      var lab = g.reduce(function (all, p, k) { return all.concat(k ? [{ t: ' = ' }] : [], p.label); }, []);
      // a label that would run into the one before goes on the next row down
      var X = view.X(g[0].z), half = richWidths(ctx, lab, SERIF).w / 2 + 4, row = 0;
      while (row < rights.length && X - half < rights[row]) row++;
      rights[row] = X + half;
      boxes.push({ x0: X - half, x1: X + half, row: row, X: X });
      focal(ctx, view, theme, g[0].z, lab, g.some(function (p) { return p.hot; }), row);
      i = j;
    }
    return boxes;
  }

  /** Does a label from x0 to x1 on this row run into one of the boxes? */
  function clash(boxes, x0, x1, row) {
    return boxes.some(function (b) { return b.row === row && x0 < b.x1 && x1 > b.x0; });
  }

  /** Faint 1.5F, 2F and 3F marks on both sides of a lens (always for a lone lens, else on hover).
      Their labels keep clear of the others (boxes, from focalMarkers): where the lens's name
      does not fit they are just 1.5F′, 2F′…, and if even that runs into a label, a row lower. */
  function lensMultiples(ctx, view, theme, element, nL, fade, boxes) {
    var lab = focalLabels(element, nL), marks = [];
    boxes = (boxes || []).slice();
    [1.5, 2, 3].forEach(function (k) {
      [['F', -1], ['Fp', 1]].forEach(function (s) { marks.push({ k: k, s: s, X: view.X(element.z + s[1] * k * element.f) }); });
    });
    marks.sort(function (a, b) { return a.X - b.X; });
    ctx.save(); ctx.globalAlpha = 0.5 * fade;
    marks.forEach(function (m) {
      var X = m.X, Y = view.Y(0), full = [{ t: String(m.k) }].concat(lab[m.s[0]]);
      var short = [{ t: String(m.k) + (m.s[0] === 'F' ? 'F' : 'F′') }], t = full, row = 0;
      var half = function (parts) { return richWidths(ctx, parts, SERIF).w / 2 + 4; };
      if (clash(boxes, X - half(full), X + half(full), 0)) t = short;
      while (clash(boxes, X - half(t), X + half(t), row) && row < 3) row++;
      boxes.push({ x0: X - half(t), x1: X + half(t), row: row });
      ctx.strokeStyle = theme.text; ctx.fillStyle = theme.bg; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(X, Y, 3.5, 0, TAU); ctx.fill(); ctx.stroke();
      richText(ctx, t, X, Y + 24 + row * 20, theme.text, SERIF);
    });
    ctx.restore();
  }

  /** An object: an arrow from the axis at z up (or down) to height h. Green unless coloured. */
  function objectArrow(ctx, view, theme, element, options) {
    var X = view.X(element.z), Y0 = view.Y(0), Y1 = view.Y(element.h), up = element.h >= 0 ? 1 : -1, col = element.color || theme.green;
    if (options.selected || options.hover) {
      ctx.strokeStyle = options.selected ? theme.select : theme.hover;
      ctx.lineWidth = 14; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(X, Y0); ctx.lineTo(X, Y1); ctx.stroke();
    }
    var head = Math.min(15, Math.abs(Y1 - Y0) * 0.6);
    ctx.strokeStyle = col; ctx.lineWidth = 3.5; ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.moveTo(X, Y0); ctx.lineTo(X, Y1 + up * head * 0.7); ctx.stroke();
    arrowHead(ctx, X, Y0, X, Y1, head, col);
    if (options.selected) {                                     // the tip is a handle for the height
      ctx.strokeStyle = theme.accent; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(X, Y1, 7, 0, TAU); ctx.stroke();
    }
    if (element.label) text(ctx, element.label, X + 10, Y1 - up * 4, theme.text, '600 14px ' + SANS, 'left', up > 0 ? 'bottom' : 'top');
  }

  /** A point source: a bright dot with a soft halo. */
  function pointSource(ctx, view, theme, element, options) {
    var X = view.X(element.z), Y = view.Y(element.y);
    if (options.selected || options.hover) {
      ctx.fillStyle = options.selected ? theme.select : theme.hover;
      ctx.beginPath(); ctx.arc(X, Y, 15, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 0.3; ctx.fillStyle = element.color || theme.source;
    ctx.beginPath(); ctx.arc(X, Y, 10, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(X, Y, 5, 0, TAU); ctx.fill();
    if (element.label) text(ctx, element.label, X + 12, Y - 10, theme.text, '600 14px ' + SANS, 'left', 'bottom');
  }

  // ---------------------------------------------------------------- rays

  /** Where along screen segment a-b to put the direction arrow: the middle of its visible part. */
  function arrowSpot(a, b, canvasWidth) {
    var dx = b.x - a.x, t0 = 0, t1 = 1;
    if (Math.abs(dx) > 1e-9) {
      var ta = (0 - a.x) / dx, tb = (canvasWidth - a.x) / dx;
      t0 = Math.max(0, Math.min(ta, tb)); t1 = Math.min(1, Math.max(ta, tb));
    }
    if (t1 <= t0) return null;
    var tm = (t0 + t1) / 2, L = Math.hypot(dx, b.y - a.y) * (t1 - t0);
    return L < 50 ? null : { x: a.x + dx * tm, y: a.y + (b.y - a.y) * tm };
  }

  /** A ray through screen points sp: a line with a small arrowhead along each long segment. */
  function rayPath(ctx, sp, col, w, canvasWidth, dash) {
    ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineJoin = 'round'; ctx.lineCap = dash ? 'butt' : 'round';
    ctx.setLineDash(dash || []);
    ctx.beginPath();
    sp.forEach(function (p, i) { if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
    ctx.stroke();
    ctx.setLineDash([]);
    if (dash) return;                                     // helpers (dashed) are construction lines: no direction
    for (var i = 0; i + 1 < sp.length; i++) {
      var m = arrowSpot(sp[i], sp[i + 1], canvasWidth);
      if (!m) continue;
      var L = Math.hypot(sp[i + 1].x - sp[i].x, sp[i + 1].y - sp[i].y);
      var ux = (sp[i + 1].x - sp[i].x) / L, uy = (sp[i + 1].y - sp[i].y) / L;
      arrowHead(ctx, m.x - ux, m.y - uy, m.x + ux * 5, m.y + uy * 5, 7 + w * 1.4, col);
    }
  }

  var ROLE_COLOUR = { parallel: 'blue', focal: 'red', central: 'green' };

  /** A ray's colour. In hint mode a principal ray takes its rule's colour (blue parallel, red
      focal, green central), over any colour picked for it. Otherwise a ray owned by a beam or
      point source takes the owner's colour; else its own colour, else the default. */
  function rayColour(theme, state, solution, r) {
    var role = state.scene.settings.colour && !r.helper && solution.roles[r.id];
    if (role) return theme[ROLE_COLOUR[role]];
    var own = !r.helper && RM.rays.owner(state.scene, r);
    if (own) return own.color || (own.type === 'point' ? theme.source : theme.ray);   // owned rays: the owner's colour as drawn
    if (r.color) return r.color;
    return r.helper ? theme.helper : theme.ray;
  }

  /** Draw all the rays: each as a line through its solved points, with nodes while the ray tool is active. */
  function rays(ctx, view, theme, state, solution, canvasWidth) {
    var showNodes = state.tool === 'ray', inImage = {};          // rays that are part of an image now
    solution.images.forEach(function (image) { image.rays.forEach(function (rr) { inImage[rr.ray] = true; }); });
    state.scene.rays.forEach(function (r) {
      var s = solution.rays[r.id];
      if (!s || !s.shown.length) return;
      var sp = s.shown.map(function (p) { return { x: view.X(p.z), y: view.Y(p.y) }; });
      var col = rayColour(theme, state, solution, r), sel = r.id === state.sel, hov = r.id === state.hover;
      if (sel || hov) {
        ctx.save(); ctx.globalAlpha = 1;
        ctx.strokeStyle = sel ? theme.select : theme.hover; ctx.lineWidth = 10; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.beginPath(); sp.forEach(function (p, i) { if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }); ctx.stroke();
        ctx.restore();
      }
      var w = r.helper ? 1.6 : 2.2, dash = r.helper ? [7, 5] : null;   // a helper: dashed construction line
      var lastNode = r.nodes[r.nodes.length - 1];
      var stop = s.blocked && RM.scene.find(state.scene, s.blocked);
      ctx.save();
      if (stop && stop.mask) ctx.globalAlpha = MASKED;     // stopped by an iris that fades what it stops (#14)
      if (lastNode && lastNode.auto && !s.trimmed && !inImage[r.id] && sp.length > 1) {
        // lengthened by RayMan to meet an image that has since gone: shown faint until it meets again
        if (sp.length > 2) rayPath(ctx, sp.slice(0, -1), col, w, canvasWidth, dash);
        ctx.save(); ctx.globalAlpha *= 0.5; rayPath(ctx, sp.slice(-2), col, w, canvasWidth, dash); ctx.restore();
      } else rayPath(ctx, sp, col, w, canvasWidth, dash);
      if (s.rim) cross(ctx, sp[sp.length - 1], theme.red);   // missed a lens or mirror: stopped at its rim
      if (r.label) rayLabel(ctx, sp, r.label, col, view.Y(0));
      if (showNodes || sel) {
        sp.forEach(function (p, i) {
          if (RM.rays.isJoint(state.scene, r, s, i)) return;       // straight through a centre: not a node
          var last = i === sp.length - 1 && !s.trimmed;          // an open end that can be continued
          ctx.fillStyle = theme.bg; ctx.strokeStyle = col; ctx.lineWidth = 1.8;
          ctx.beginPath(); ctx.arc(p.x, p.y, last ? 5 : 3.5, 0, TAU); ctx.fill(); ctx.stroke();
        });
      }
      ctx.restore();
    });
  }
  var MASKED = 0.15;                                     // how faint a ray an iris fades is drawn

  /** Fill-in rays: thin and faint, between the two outermost rays of each bundle. */
  function fills(ctx, view, theme, state, solution, canvasWidth) {
    var n = state.scene.settings.fill || 0;
    if (!n) return;
    ctx.save(); ctx.globalAlpha = 0.38;
    RM.rays.fillRays(state.scene, solution, n).forEach(function (f) {
      var sp = f.pts.map(function (p) { return { x: view.X(p.z), y: view.Y(p.y) }; });
      if (f.edge) {                                       // the edge of the light past a fading iris (#14): drawn like a drawn ray
        ctx.save(); ctx.globalAlpha = 1; rayPath(ctx, sp, f.ray.color || theme.ray, 2.2, canvasWidth, null); ctx.restore();
        return;
      }
      if (f.masked) return;                               // stopped by an iris that hides what it stops (#14)
      ctx.globalAlpha = 0.38;
      ctx.strokeStyle = f.ray.color || theme.ray;              // the bundle's colour, never a rule's (they are not principal rays)
      ctx.lineWidth = 1; ctx.lineJoin = 'round';
      ctx.beginPath(); sp.forEach(function (p, i) { if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }); ctx.stroke();
    });
    ctx.restore();
  }

  /** A magnification for its label: up to two decimals, a real minus sign (−2, 0.5, −1.33). */
  function magText(M) {
    var r = Math.round(M * 100) / 100;
    return String(r === 0 ? 0 : r).replace('-', '\u2212');
  }

  /** The images the rays form: an arrow (image of an object) or a point (image of a point
      source). Real images are solid; virtual ones are dashed and hollow, with the rays'
      backward extensions drawn dashed to them. Coloured like the object they come from. */
  function images(ctx, view, theme, state, solution) {
    // a lamp filament's two ends imaged through the same lens make an image of the filament
    var pairs = {}, inPair = {}, hideV = state.scene.settings.virtual === false;
    solution.images.forEach(function (image, i) {
      if (hideV && image.virtual) return;
      var key = RM.rays.refKey(image.src), end = /:(top|bot)\b/.exec(key);
      if (!end || image.focus) return;
      var k = key.replace(/:(top|bot)\b/, ':*') + '@' + image.lens + (image.virtual ? 'v' : 'r');
      (pairs[k] = pairs[k] || {})[end[1]] = i;
    });
    Object.keys(pairs).forEach(function (k) {
      var p = pairs[k];
      if (p.top == null || p.bot == null) return;
      inPair[p.top] = inPair[p.bot] = true;
      var a = solution.images[p.top], b = solution.images[p.bot], root = RM.rays.rootElement(state.scene, a.src);
      var col = (root && root.color) || theme.filament, X = view.X((a.z + b.z) / 2);
      ctx.save(); ctx.globalAlpha = 0.55;
      if (a.virtual) ctx.setLineDash([4, 3]);
      coil(ctx, X, view.Y(b.y), view.Y(a.y), col, 1.8);
      ctx.setLineDash([]);
      text(ctx, a.virtual ? 'virtual image' : 'image', X + 10, Math.min(view.Y(a.y), view.Y(b.y)) - 4, theme.dim, 'italic 13px ' + SANS, 'left', 'bottom');
      ctx.restore();
    });
    solution.images.forEach(function (image, i) {
      if (hideV && image.virtual) return;
      if (inPair[i]) {                                    // drawn as part of the filament's image; just mark the ends
        ctx.save(); ctx.globalAlpha = 0.55; ctx.fillStyle = theme.text;
        ctx.beginPath(); ctx.arc(view.X(image.z), view.Y(image.y), 2.5, 0, TAU); ctx.fill(); ctx.restore();
        if (!image.virtual) return;
      }
      var root = RM.rays.rootElement(state.scene, image.src);
      var col = root && root.type === 'object' ? root.color || theme.green : root && root.type === 'point' ? theme.source :
        root && root.type === 'filament' ? root.color || theme.filament : theme.text;
      if (image.focus) col = theme.text;
      var X = view.X(image.z), Y0 = view.Y(0), Y1 = view.Y(image.y), up = image.y >= 0 ? 1 : -1;
      ctx.save();
      ctx.globalAlpha = 0.55;                               // images are fainter than objects
      if (image.virtual) {                                   // backward extensions of the rays
        ctx.setLineDash([5, 5]); ctx.lineWidth = 1.5;
        image.rays.forEach(function (rr) {
          var r = state.scene.rays.filter(function (x) { return x.id === rr.ray; })[0];
          if (!r) return;
          ctx.strokeStyle = rayColour(theme, state, solution, r);
          ctx.beginPath(); ctx.moveTo(view.X(rr.a.z), view.Y(rr.a.y)); ctx.lineTo(X, Y1); ctx.stroke();
        });
      }
      if (inPair[i]) { ctx.restore(); return; }            // the filament's image is already drawn
      if (image.arrow && Math.abs(Y1 - Y0) > 4) {
        var head = Math.min(15, Math.abs(Y1 - Y0) * 0.6);
        ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.lineCap = 'butt';
        ctx.setLineDash(image.virtual ? [6, 4] : []);
        ctx.beginPath(); ctx.moveTo(X, Y0); ctx.lineTo(X, Y1 + up * head * 0.7); ctx.stroke();
        ctx.setLineDash([]);
        if (image.virtual) {                                 // hollow head
          ctx.fillStyle = theme.bg; arrowHead(ctx, X, Y0, X, Y1, head, theme.bg);
          ctx.lineWidth = 1.8; ctx.beginPath();
          ctx.moveTo(X, Y1); ctx.lineTo(X - head * 0.42, Y1 + up * head); ctx.lineTo(X + head * 0.42, Y1 + up * head); ctx.closePath(); ctx.stroke();
        } else arrowHead(ctx, X, Y0, X, Y1, head, col);
      } else {
        ctx.setLineDash([]); ctx.lineWidth = 2;
        ctx.strokeStyle = col; ctx.fillStyle = image.virtual ? theme.bg : col;
        ctx.beginPath(); ctx.arc(X, Y1, 5, 0, TAU); ctx.fill(); ctx.stroke();
      }
      ctx.setLineDash([]);
      text(ctx, image.focus ? 'focus' : image.virtual ? 'virtual image' : 'image', X + 9, Y1 - up * 2, theme.dim, 'italic 13px ' + SANS, 'left', up > 0 ? 'bottom' : 'top');
      var M = RM.rays.magnification(state.scene, image);
      if (M != null) {                                    // beside the arrow, on its axis side
        ctx.globalAlpha = 1; ctx.font = '600 13px ' + SANS; ctx.textAlign = 'left';
        ctx.textBaseline = up > 0 ? 'top' : 'bottom';
        ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.strokeStyle = theme.bg;   // a halo, so rays don't cut it
        ctx.strokeText('M = ' + magText(M), X + 9, Y1 + up * 4);
        text(ctx, 'M = ' + magText(M), X + 9, Y1 + up * 4, theme.text, ctx.font, 'left', ctx.textBaseline);
      }
      ctx.restore();
    });
  }

  /** The segment being drawn, from the ray's last point to where it would end. */
  function draft(ctx, view, theme, d, canvasWidth) {
    if (!d || !d.from) return;
    var a = { x: view.X(d.from.z), y: view.Y(d.from.y) };
    ctx.save();
    if (d.pts && d.pts.length) {
      ctx.globalAlpha = 0.85;
      rayPath(ctx, [a].concat(d.pts.map(function (p) { return { x: view.X(p.z), y: view.Y(p.y) }; })),
        d.role ? theme[ROLE_COLOUR[d.role]] : d.color || (d.helper ? theme.helper : d.ownerType === 'point' ? theme.source : theme.ray),
        d.helper ? 1.6 : 2.2, canvasWidth, d.helper ? [7, 5] : null);
    }
    ctx.globalAlpha = 1; ctx.fillStyle = theme.accent;
    ctx.beginPath(); ctx.arc(a.x, a.y, 4.5, 0, TAU); ctx.fill();
    ctx.restore();
  }

  /** What something snapped to: rings around points, a glow along a ray it is parallel to, and
      the focal plane it is aimed across. */
  function hints(ctx, view, theme, list) {
    (list || []).forEach(function (h) {
      if (h.seg) {
        ctx.save(); ctx.strokeStyle = theme.select; ctx.lineWidth = 9; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(view.X(h.seg.a.z), view.Y(h.seg.a.y)); ctx.lineTo(view.X(h.seg.b.z), view.Y(h.seg.b.y)); ctx.stroke();
        ctx.restore();
      }
      if (h.plane) focalPlane(ctx, view, { plane: theme.accent }, h.plane.z, h.plane.ap);
      if (h.dim) dimension(ctx, view, theme, h.dim);
      if (h.z == null) return;
      ctx.strokeStyle = theme.accent; ctx.lineWidth = h.small ? 1.8 : 2.4;
      ctx.beginPath(); ctx.arc(view.X(h.z), view.Y(h.y || 0), h.small ? 6 : 10, 0, TAU); ctx.stroke();
    });
  }

  /** A dimension line along the axis, just below it, from a lens to an object snapped at a
      multiple of its focal length, labelled with that multiple ("1.5f"). */
  function dimension(ctx, view, theme, d) {
    var x0 = view.X(d.z0), x1 = view.X(d.z1), y = view.Y(0) + 44;
    ctx.save();
    ctx.strokeStyle = theme.accent; ctx.fillStyle = theme.accent; ctx.lineWidth = 1.4;
    ctx.setLineDash([4, 3]);                               // from the lens and the object down to the line
    ctx.beginPath(); ctx.moveTo(x0, view.Y(0) + 6); ctx.lineTo(x0, y + 6); ctx.moveTo(x1, view.Y(0) + 6); ctx.lineTo(x1, y + 6); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    arrowHead(ctx, x1, y, x0, y, 8, theme.accent); arrowHead(ctx, x0, y, x1, y, 8, theme.accent);
    ctx.font = '600 12.5px ' + SANS;
    var w = ctx.measureText(d.label).width + 10, xm = (x0 + x1) / 2;
    ctx.fillStyle = theme.panel; ctx.fillRect(xm - w / 2, y - 9, w, 18);
    text(ctx, d.label, xm, y, theme.accent, '600 12.5px ' + SANS);
    ctx.restore();
  }

  /** A short caption by the cursor saying what snapped ("through F′ of L1"). */
  function caption(ctx, theme, cap, canvasWidth) {
    if (!cap || !cap.text) return;
    ctx.font = '600 13px ' + SANS;
    var w = ctx.measureText(cap.text).width + 14, x = cap.x + 16, y = cap.y + 18;
    if (x + w > canvasWidth - 8) x = cap.x - 16 - w;
    ctx.fillStyle = theme.panel; ctx.strokeStyle = theme.accent; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.rect(x, y, w, 23); ctx.fill(); ctx.stroke();
    text(ctx, cap.text, x + 7, y + 12, theme.accent, '600 13px ' + SANS, 'left');
  }

  // ---------------------------------------------------------------- the frame

  /** Draw one frame. state: { real (the whole scene), view, theme, tool, sel, hover, axis (the one
      being worked on: ghost, draft, hints and highlights belong to it), ghost, hints, hotFocal,
      axisHot, draft, caption, bare (no F, F′ or 1.5F…3F marks: for the help pictures), scale
      (false: no mm ruler along the bottom; the web embed) }. Each optical axis is drawn from its own view, shifted to its
      height. A scene with no axes (as in old files and the tests) is one implicit axis at 0. */
  function draw(ctx, canvasWidth, canvasHeight, state) {
    var theme = THEMES[state.theme] || THEMES.light, real = state.real || state.scene;
    ctx.fillStyle = theme.bg; ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    grid(ctx, state.view, theme, canvasWidth, canvasHeight, state.ruler, state.scale);
    var list = RM.scene.axes(real);
    (list.length ? list : [null]).forEach(function (ax) {
      var on = !ax || ax.id === state.axis;
      bench(ctx, canvasWidth, canvasHeight, theme, Object.assign({}, state, {
        scene: ax ? RM.scene.axisView(real, ax.id) : real,
        view: ax ? shifted(state.view, ax.y) : state.view,
        ghost: on && state.ghost && state.ghost.type !== 'axis' ? state.ghost : null,
        draft: on ? state.draft : null, hints: on ? state.hints : null,
        hotFocal: on ? state.hotFocal : null, axisHot: on && state.axisHot
      }), ax);
    });
    if (state.ghost && state.ghost.type === 'axis') {          // a new axis about to be placed
      ctx.save(); ctx.globalAlpha = 0.45; ctx.setLineDash([8, 6]);
      axis(ctx, shifted(state.view, state.ghost.y), theme, canvasWidth, false, {}, '');
      ctx.restore();
    }
    caption(ctx, theme, state.caption, canvasWidth);
  }

  /** One optical axis and everything on it. state.scene is the axis's view, state.view is shifted. */
  function bench(ctx, canvasWidth, canvasHeight, theme, state, ax) {
    var view = state.view, elements = state.scene.elements;
    var solution = RM.rays.solveScene(state.scene);
    axis(ctx, view, theme, canvasWidth, state.axisHot, ax ? { selected: ax.id === state.sel, hover: ax.id === state.hover } : {}, ax && ax.label);

    var nL = elements.filter(function (element) { return element.type === 'lens'; }).length;
    /** Drawing options for the element: whether it is selected and whether the pointer is over it. */
    function opts(element) { return { selected: element.id === state.sel, hover: element.id === state.hover }; }

    elements.forEach(function (element) {
      if (element.type === 'lens' && element.planes) {
        var fp = G.focalPoints(element);
        focalPlane(ctx, view, theme, fp.F, element.ap); focalPlane(ctx, view, theme, fp.Fp, element.ap);
      }
    });
    elements.forEach(function (element) { if (element.type === 'lens') lens(ctx, view, theme, element, opts(element)); });
    elements.forEach(function (element) { if (element.type === 'mirror') mirror(ctx, view, theme, element, opts(element)); });
    elements.forEach(function (element) { if (element.type === 'iris') iris(ctx, view, theme, element, opts(element)); });
    elements.forEach(function (element) { if (element.type === 'plane') imagePlane(ctx, view, theme, element, opts(element)); });
    elements.forEach(function (element) { if (element.type === 'dichroic') dichroic(ctx, view, theme, element, opts(element)); });
    var fBoxes = state.bare ? [] : focalMarkers(ctx, view, theme, elements, nL, state.hotFocal || {});   // bare: no F or nF marks (help pictures)
    // 1.5F, 2F and 3F: always shown when the axis has a single lens, else while a lens is hovered
    var ml = nL === 1 ? elements.filter(function (element) { return element.type === 'lens'; })[0]
      : state.lensMarks && elements.filter(function (element) { return element.id === state.lensMarks && element.type === 'lens'; })[0];
    if (ml && !state.bare) lensMultiples(ctx, view, theme, ml, nL, nL === 1 || state.marksFade == null ? 1 : state.marksFade, fBoxes);
    elements.forEach(function (element) { if (element.type === 'object') objectArrow(ctx, view, theme, element, opts(element)); });
    elements.forEach(function (element) { if (element.type === 'filament') filament(ctx, view, theme, element, opts(element)); });
    elements.forEach(function (element) { if (element.type === 'beam') beam(ctx, view, theme, element, opts(element)); });
    fills(ctx, view, theme, state, solution, canvasWidth);
    scanExtremes(ctx, view, theme, state, solution, canvasWidth);
    rays(ctx, view, theme, state, solution, canvasWidth);
    images(ctx, view, theme, state, solution);
    elements.forEach(function (element) { if (element.type === 'point') pointSource(ctx, view, theme, element, opts(element)); });

    if (state.ghost) {
      ctx.save(); ctx.globalAlpha = 0.5;
      var g = state.ghost, options = { selected: false, hover: false };
      if (g.type === 'lens') {
        lens(ctx, view, theme, g, options);
        var gf = G.focalPoints(g), gl = focalLabels(g, nL + 1);
        focal(ctx, view, theme, gf.F, gl.F); focal(ctx, view, theme, gf.Fp, gl.Fp);
      } else if (g.type === 'object') objectArrow(ctx, view, theme, g, options);
      else if (g.type === 'point') pointSource(ctx, view, theme, g, options);
      else if (g.type === 'mirror') mirror(ctx, view, theme, g, options);
      else if (g.type === 'iris') iris(ctx, view, theme, g, options);
      else if (g.type === 'plane') imagePlane(ctx, view, theme, g, options);
      else if (g.type === 'dichroic') dichroic(ctx, view, theme, g, options);
      else if (g.type === 'filament') filament(ctx, view, theme, g, options);
      else if (g.type === 'beam') beam(ctx, view, theme, g, options);
      ctx.restore();
    }
    draft(ctx, view, theme, state.draft, canvasWidth);
    hints(ctx, view, theme, state.hints);
    if (state.ruler) rulerMarker(ctx, theme, canvasHeight, rulerGeometry(ctx, canvasHeight, state.ruler));
  }

  RM.render = { THEMES: THEMES, draw: draw, focalLabels: focalLabels, ROLE_COLOUR: ROLE_COLOUR };
})(typeof self !== 'undefined' ? self : this);
