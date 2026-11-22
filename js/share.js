/* RayMan sharing: a scene packed into a link (…/#scene=<token>), the HTML that embeds a scene in a
   web page (embed.js draws it), and the box that fits a scene in view. No DOM.

   A token is the scene's JSON, compressed (deflate, zlib format) and written in base64url, so a link holds a
   whole scene and the scene never goes to a server (the part after # is not sent). The first
   letter says how it is packed: 'z' compressed, 'j' plain (a browser without CompressionStream). */
/* Short names used in this file:
     z, y     position along the axis and height above it, in mm; b: a bounding box { z0, z1, y0, y1 }
     ax       an optical axis; g: a group of things; i: an index; m: a match; s: a string; v: a value
     S, R     the modules RM.scene, RM.rays */

(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var m = factory(node ? require('./scene.js') : root.RM.scene, node ? require('./rays.js') : root.RM.rays);
  if (node) module.exports = m;
  else root.RM.share = m;
})(typeof self !== 'undefined' ? self : this, function (S, R) {
  'use strict';

  /** Where RayMan lives on the web: used for links made from a copy opened from disk. */
  var PUBLIC = 'https://swcmicroscopy.com/RayMan/';

  /** Encode bytes as URL-safe base64 text. */
  function toB64url(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /** Decode URL-safe base64 text back to bytes. */
  function fromB64url(t) {
    var s = atob(t.replace(/-/g, '+').replace(/_/g, '/'));
    var b = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  }

  /** Run bytes through a (de)compression stream and return the resulting bytes. */
  function pipe(bytes, stream) {
    return new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()
      .then(function (buf) { return new Uint8Array(buf); });
  }

  /** Pack scene text (JSON) into a token for a link. Resolves to a string. */
  function encode(text) {
    var bytes = new TextEncoder().encode(text);
    if (typeof CompressionStream !== 'function') return Promise.resolve('j' + toB64url(bytes));
    return pipe(bytes, new CompressionStream('deflate')).then(function (z) { return 'z' + toB64url(z); });
  }

  /** Unpack a token. Resolves to the scene text; rejects if the token is damaged. */
  function decode(token) {
    return Promise.resolve().then(function () {
      var kind = token.charAt(0), bytes = fromB64url(token.slice(1));
      if (kind === 'j') return bytes;
      if (kind !== 'z') throw new Error('bad');
      if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot open shared scenes.');
      return pipe(bytes, new DecompressionStream('deflate'));
    }).then(function (b) { return new TextDecoder('utf-8', { fatal: true }).decode(b); })
      .catch(function (err) {
        throw new Error(/browser/.test(err.message) ? err.message : 'The shared scene in this link is damaged (was it cut short?).');
      });
  }

  /** The token in a location hash ('#scene=…'), or null. */
  function tokenOf(hash) {
    var m = /^#?scene=([A-Za-z0-9_-]+)/.exec(hash || '');
    return m ? m[1] : null;
  }

  /** The folder RayMan is served from, for links to it: the page's address without the file
      name, query or hash. A copy opened from disk (file:) has no address others can use, so
      links point at the public copy. */
  function baseOf(href) {
    if (!/^https?:/.test(href)) return PUBLIC;
    return href.replace(/[?#].*$/, '').replace(/[^/]*$/, '');
  }

  /** The share link: the base address plus the packed scene. */
  function link(base, token) { return base + '#scene=' + token; }

  /** The HTML that embeds a scene in a web page, the scene written into it. '<' is escaped so
      no text in the scene (a label) can end the script element early. */
  function embedCode(sceneText, base) {
    var json = JSON.stringify(JSON.parse(sceneText)).replace(/</g, '\\u003c');
    return '<script src="' + base + 'embed.js" defer></script>\n' +
      '<div class="rayman" data-height="320">\n' +
      '<script type="application/json">' + json + '</script>\n' +
      '</div>';
  }

  /** The world box { z0, z1, y0, y1 } that shows every axis with its elements, rays and images,
      or null for an empty bench. Rays running off to the edge, and virtual images while they
      are hidden, do not count. */
  function box(real) {
    var b = null;
    /** Grow the bounding box b to include the point (z, y). */
    function take(z, y) {
      b = b || { z0: z, z1: z, y0: y, y1: y };
      b.z0 = Math.min(b.z0, z); b.z1 = Math.max(b.z1, z); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y);
    }
    S.axes(real).forEach(function (ax) {
      var v = S.axisView(real, ax.id), bb = S.bounds(v), sol = R.solveScene(v), solved = sol.rays;
      var hideV = real.settings && real.settings.virtual === false;
      sol.images.forEach(function (im) {
        if (hideV && im.virtual) return;                      // not drawn, so not in view
        take(im.z, ax.y + im.y); take(im.z, ax.y);
      });
      take(bb ? bb.z0 : 0, ax.y - 10); take(bb ? bb.z1 : 0, ax.y + 10);
      if (bb) { take(bb.z0, ax.y + bb.y0); take(bb.z1, ax.y + bb.y1); }
      v.rays.forEach(function (r) {
        solved[r.id].pts.forEach(function (p) {
          if (Math.abs(p.z) < R.FAR / 2) take(p.z, ax.y + p.y);
        });
      });
    });
    if (b && b.z1 - b.z0 < 40) { b.z0 -= 60; b.z1 += 140; }
    return b;
  }

  /** Rays reaching a scan mirror go on through it, on every axis (as in the app). */
  function passMirrors(real) {
    S.axes(real).forEach(function (ax) { R.passMirrors(S.axisView(real, ax.id)); });
  }

  return {
    PUBLIC: PUBLIC, encode: encode, decode: decode, tokenOf: tokenOf, baseOf: baseOf, link: link,
    embedCode: embedCode, box: box, passMirrors: passMirrors
  };
});
