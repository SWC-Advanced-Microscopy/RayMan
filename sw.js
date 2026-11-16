/* RayMan's service worker: lets RayMan open with no network (e.g. from the iPad home screen in
   a lecture theatre). Network first, always: online, every request goes to the website, so an
   update shows on the next load, and the answer is kept as the offline copy. Offline, or if the
   network has not answered within NET_WAIT ms, the kept copy is used. URLs are matched without
   their ?v= stamps (tools/stamp-assets.py), so a copy kept under one stamp still serves.

   CORE is stored on the first visit, so the app works offline even if only the start page was
   ever opened. tests/sw.test.js checks it lists every file index.html loads: add new files here. */
'use strict';
var CACHE = 'rayman';
var NET_WAIT = 4000;
var CORE = [
  './', 'index.html', 'manifest.json', 'css/style.css',
  'js/geom.js', 'js/scene.js', 'js/snap.js', 'js/rays.js', 'js/view.js', 'js/render.js', 'js/share.js', 'js/panel.js', 'js/app.js',
  'images/rayman_1000_667.jpg', 'images/icons/apple-touch-icon.png', 'images/icons/icon-192.png', 'images/icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(CORE.map(function (u) { return new Request(u, { cache: 'reload' }); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {               // drop caches of any older scheme
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(new Promise(function (resolve) {
    var done = false;
    function answer(r) { if (!done && r) { done = true; resolve(r); } }
    function kept() { return caches.match(req, { ignoreSearch: true }); }
    var timer = setTimeout(function () {                         // a slow network: use the kept copy if there is one
      kept().then(answer);
    }, NET_WAIT);
    fetch(req).then(function (res) {
      clearTimeout(timer);
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      answer(res);
    }).catch(function () {                                       // offline
      clearTimeout(timer);
      kept().then(function (r) { answer(r || Response.error()); });
    });
  }));
});
