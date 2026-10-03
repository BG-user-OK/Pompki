/* Pompki vGPT_1.0.0 — never cache integration requests. */
'use strict';
const VERSION = 'vGPT_1.0.0';
const CACHE = `pompki-${VERSION}`;
const FILES = ['./', './index.html', './styles.css?v=vGPT_1.0.0', './core.js?v=vGPT_1.0.0', './app.js?v=vGPT_1.0.0', './sync.js?v=vGPT_1.0.0', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png', './obrazki/pompki.png', ...[100,110,120,130,140,150].map(n => `./obrazki/${n}_pompek.png`)];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('pompki-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('message', event => { if (event.data === 'ACTIVATE_UPDATE') self.skipWaiting(); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(event.request);
    if (cached) return cached;
    if (event.request.mode === 'navigate') return await cache.match('./index.html') || fetch(event.request);
    return fetch(event.request);
  }));
});
