/* Pompki vGPT_1.0.6 — never cache integration requests. */
'use strict';
const VERSION = 'vGPT_1.0.6';
const CACHE = `pompki-${VERSION}`;
const AUDIO_FILES = ['./audio/runda_x.wav', './audio/runda_x-end.wav'];
const FILES = ['./', './index.html', './install.html', './styles.css?v=vGPT_1.0.6', './core.js?v=vGPT_1.0.6', './app.js?v=vGPT_1.0.6', './sync.js?v=vGPT_1.0.6', './updates.js?v=vGPT_1.0.6', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png', './obrazki/pompki.png', ...[100,110,120,130,140,150].map(n => `./obrazki/${n}_pompek.png`)];
// Activate only after the complete new offline bundle is available. This also
// releases updates held by older clients; the current page decides when to reload.
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(async cache => {
  await cache.addAll(FILES.map(url => new Request(url, { cache: 'reload' })));
  // Prepare recordings for the first offline workout, without making audio failure fatal to the shell.
  await Promise.all(AUDIO_FILES.map(async url => {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 2500);
    try {
      const request = new Request(new URL(url, self.registration.scope).href, { cache: 'reload' });
      const response = await fetch(request, { signal: controller.signal });
      if (response.ok) await cache.put(request, response);
    } catch { /* The complete essential shell and synthesized alarms remain usable. */ }
    finally { clearTimeout(timeout); }
  }));
}).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('pompki-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('message', event => { if (event.data === 'ACTIVATE_UPDATE') self.skipWaiting(); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    // Optional recording: never require it for installation, and never cache a 404.
    // Network-first discovers a file published later; a successful cached copy works offline.
    if (AUDIO_FILES.some(file => url.href === new URL(file, self.registration.scope).href)) {
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 2500);
      try {
        const fresh = await fetch(event.request, { cache: 'no-cache', signal: controller.signal });
        if (fresh.ok) { try { await cache.put(event.request, fresh.clone()); } catch {} return fresh; }
        return await cache.match(event.request) || fresh;
      } catch (error) {
        const cached = await cache.match(event.request); if (cached) return cached; throw error;
      } finally { clearTimeout(timeout); }
    }
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
