/* Pompki vGPT_1.0.3 — update checks and safe page refresh. */
(function (root) {
  'use strict';
  function start({ canReload, onError = () => {} }, env = root) {
    const { navigator, document, location } = env;
    if (!('serviceWorker' in navigator)) return { apply() {} };
    const serviceWorker = navigator.serviceWorker;
    let registration, pending = false, reloading = false, checking = false;
    let controlled = !!serviceWorker.controller;
    function apply() {
      if (pending && !reloading && document.visibilityState === 'visible' && canReload()) {
        reloading = true;
        location.reload();
      }
    }
    function activateWaiting() {
      registration.waiting?.postMessage('ACTIVATE_UPDATE');
    }
    async function check() {
      apply();
      if (!registration || checking || !navigator.onLine || document.visibilityState !== 'visible') return;
      checking = true;
      try { await registration.update(); activateWaiting(); }
      catch { /* Offline or interrupted checks are retried on return/online. */ }
      finally { checking = false; }
    }
    serviceWorker.addEventListener('controllerchange', () => {
      // First installation needs no refresh; subsequent controllers do.
      if (controlled) pending = true;
      controlled = true;
      apply();
    });
    document.addEventListener('visibilitychange', check);
    env.addEventListener('online', check);
    serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' }).then(reg => {
      registration = reg;
      activateWaiting();
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed') activateWaiting();
        });
      });
      check();
      env.setInterval(check, 60000);
    }).catch(onError);
    return { apply };
  }
  if (typeof module === 'object' && module.exports) module.exports = { start };
  else root.PompkiUpdates = { start };
})(typeof window !== 'undefined' ? window : globalThis);
