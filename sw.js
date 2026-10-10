/* Pompki vGPT_1.0.4 — never cache integration requests. */
'use strict';
const VERSION = 'vGPT_1.0.4';
const CACHE = `pompki-${VERSION}`;
const FILES = ['./', './index.html', './install.html', './styles.css?v=vGPT_1.0.4', './core.js?v=vGPT_1.0.4', './app.js?v=vGPT_1.0.4', './sync.js?v=vGPT_1.0.4', './updates.js?v=vGPT_1.0.4', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png', './obrazki/pompki.png', ...[100,110,120,130,140,150].map(n => `./obrazki/${n}_pompek.png`)];
// Activate only after the complete new offline bundle is available. This also
// releases updates held by older clients; the current page decides when to reload.
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES.map(url => new Request(url, { cache: 'reload' })))).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('pompki-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('message', event => { if (event.data === 'ACTIVATE_UPDATE') self.skipWaiting(); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    if (event.request.mode === 'navigate' || url.pathname.endsWith('/manifest.webmanifest')) {
      const installer = url.pathname === new URL('./install.html', self.registration.scope).pathname;
      const key = event.request.mode === 'navigate' ? (installer ? './install.html' : './index.html') : './manifest.webmanifest';
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      try {
        const fresh = await fetch(event.request, { cache: 'no-cache', signal: controller.signal });
        if (fresh.ok) {
          // Keep the versioned offline shell coherent. A newer online document
          // gets its own complete cache when its worker finishes installing.
          const currentShell = event.request.mode !== 'navigate' || (await fresh.clone().text()).includes(`styles.css?v=${VERSION}"`);
          const knownPage = url.pathname === new URL('./', self.registration.scope).pathname ||
            url.pathname === new URL('./index.html', self.registration.scope).pathname || installer;
          if (currentShell && (event.request.mode !== 'navigate' || knownPage)) await cache.put(key, fresh.clone());
          return fresh;
        }
        return await cache.match(event.request) || await cache.match(key) || fresh;
      } catch (error) {
        const fallback = await cache.match(event.request) || await cache.match(key);
        if (fallback) return fallback;
        throw error;
      } finally { clearTimeout(timeout); }
    }
    const cached = await cache.match(event.request);
    if (cached) return cached;
    if (url.pathname === new URL('./install.html', self.registration.scope).pathname) return await cache.match('./install.html') || fetch(event.request);
    if (event.request.mode === 'navigate') return await cache.match('./index.html') || fetch(event.request);
    return fetch(event.request);
  }));
});
