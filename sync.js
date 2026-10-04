/* Pompki vGPT_1.0.2 — authenticated writes + explicit receipts, never infer success from no-cors. */
(function () {
  'use strict';
  let signingKey = null;
  function endpoint() { return localStorage.getItem('pompki.endpoint') || ''; }
  function validEndpoint(value) {
    try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'script.google.com' && /^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(u.pathname) && !u.search && !u.hash; } catch { return false; }
  }
  async function configure(url, secret) {
    if (!validEndpoint(url)) throw new Error('Wpisz poprawny adres wdrożenia Apps Script zakończony /exec.');
    if (secret.length < 32) throw new Error('Klucz synchronizacji musi mieć co najmniej 32 znaki.');
    const imported = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    localStorage.setItem('pompki.endpoint', url);
    signingKey = imported;
  }
  function jsonp(url, nonce) {
    return new Promise((resolve, reject) => {
      const callback = `pompki_cb_${crypto.randomUUID().replaceAll('-', '')}`;
      const script = document.createElement('script');
      const request = new URL(url);
      request.search = new URLSearchParams({ action: 'receipt', nonce, callback }).toString();
      const cleanup = () => { clearTimeout(timer); script.remove(); delete window[callback]; };
      const timer = setTimeout(() => { cleanup(); reject(new Error('Brak potwierdzenia zapisu. Wynik pozostaje w kolejce.')); }, 15000);
      window[callback] = data => { cleanup(); resolve(data); };
      script.onerror = () => { cleanup(); reject(new Error('Nie można połączyć się z arkuszem. Wynik pozostaje w kolejce.')); };
      script.referrerPolicy = 'no-referrer';
      script.src = request.href;
      document.head.append(script);
    });
  }
  async function send(workout) {
    const url = endpoint();
    if (!signingKey || !validEndpoint(url)) throw new Error('Otwórz ustawienia ⚙ i podaj klucz synchronizacji. Wynik jest zapisany lokalnie.');
    const nonce = crypto.randomUUID().replaceAll('-', '');
    const payload = JSON.stringify({ action: 'save', issuedAt: Date.now(), nonce, workout: { id: workout.id, exercise: workout.exercise, startedAt: workout.startedAt, completedAt: workout.completedAt, date: workout.date, sets: workout.sets, actualTotal: workout.actualTotal, durationMs: workout.durationMs } });
    const signed = await crypto.subtle.sign('HMAC', signingKey, new TextEncoder().encode(payload));
    const signature = Array.from(new Uint8Array(signed), v => v.toString(16).padStart(2, '0')).join('');
    await fetch(url, { method: 'POST', mode: 'no-cors', credentials: 'omit', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify({ payload, signature }), signal: AbortSignal.timeout(20000), referrerPolicy: 'no-referrer' });
    for (let i = 0; i < 5; i++) {
      const receipt = await jsonp(url, nonce);
      if (receipt.status !== 'pending') {
        if (receipt.nonce !== nonce || receipt.id !== workout.id) throw new Error('Nieprawidłowe potwierdzenie zapisu.');
        return receipt;
      }
      await new Promise(resolve => setTimeout(resolve, 1000 + i * 500));
    }
    throw new Error('Brak potwierdzenia zapisu. Wynik pozostaje w kolejce.');
  }
  window.PompkiSync = { configure, endpoint, send, isConfigured: () => Boolean(signingKey && validEndpoint(endpoint())) };
})();
