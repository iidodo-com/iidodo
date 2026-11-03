/* Service Worker: アプリシェルのみキャッシュ。外部API（Gemini）は一切キャッシュしない */
const CACHE = 'mojiokoshi-pro-v2';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/style.css',
  './js/util.js', './js/errors.js', './js/storage.js', './js/mock.js', './js/mask.js', './js/audio.js', './js/gemini.js', './js/export.js', './js/app.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // 外部APIは素通し
  // ネットワーク優先、失敗時にキャッシュ（更新を反映しやすくするため）
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then((r) => r || caches.match('./index.html'))));
});
