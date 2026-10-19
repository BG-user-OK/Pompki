/* Pompki vGPT_1.1.0 — authenticated writes + explicit receipts, never infer success from no-cors. */
(function () {
  'use strict';
  let signingKey = null, signingEndpoint = '', remembered = false, storedCredential = false, authRevision = 0;
  const AUTH_DB = 'pompki.auth.v1', AUTH_STORE = 'credentials';
  function endpoint() { return localStorage.getItem('pompki.endpoint') || ''; }
  function validEndpoint(value) {
    try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'script.google.com' && /^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(u.pathname) && !u.search && !u.hash; } catch { return false; }
  }
  function credentialStore(mode, operation) {
    return new Promise((resolve, reject) => {
      let db, transaction, settled = false, result;
      const failure = () => new Error('Pamięć klucza jest niedostępna. Nie potwierdzono zapisania ani usunięcia klucza. Spróbuj ponownie.');
      const finish = error => {
        if (settled) return;
        settled = true; clearTimeout(timeout); db?.close();
        if (error) reject(failure()); else resolve(result);
      };
      const timeout = setTimeout(() => { try { transaction?.abort(); } catch {} finish(true); }, 5000);
      try {
        const request = indexedDB.open(AUTH_DB, 1);
        request.onupgradeneeded = () => {
          if (settled) { request.transaction.abort(); return; }
          if (!request.result.objectStoreNames.contains(AUTH_STORE)) request.result.createObjectStore(AUTH_STORE);
        };
        request.onerror = request.onblocked = () => finish(true);
        request.onsuccess = () => {
          db = request.result;
          if (settled) { db.close(); return; }
          db.onversionchange = () => db.close();
          try {
            transaction = db.transaction(AUTH_STORE, mode);
            transaction.oncomplete = () => finish();
            transaction.onerror = transaction.onabort = () => finish(true);
            const read = operation(transaction.objectStore(AUTH_STORE));
            read.onsuccess = () => { result = read.result; };
          } catch { try { transaction?.abort(); } catch {} finish(true); }
        };
      } catch { finish(true); }
    });
  }
  function validKey(key) {
    return typeof CryptoKey !== 'undefined' && key instanceof CryptoKey && key.type === 'secret' && !key.extractable &&
      key.algorithm.name === 'HMAC' && key.algorithm.hash?.name === 'SHA-256' && key.usages.length === 1 && key.usages[0] === 'sign';
  }
  function isConfigured() { return Boolean(signingKey && signingEndpoint === endpoint() && validEndpoint(signingEndpoint)); }
  async function restore() {
    const revision = ++authRevision;
    try {
      if (typeof indexedDB === 'undefined') return { error: 'Zapamiętywanie klucza jest niedostępne. Możesz używać klucza tylko w tej sesji.' };
      const record = await credentialStore('readonly', store => store.get('active'));
      if (revision !== authRevision) return {};
      storedCredential = record != null;
      if (!record) return {};
      if (!validKey(record.key) || !validEndpoint(record.endpoint) || record.endpoint !== endpoint()) {
        throw new Error('Zapamiętany klucz nie pasuje do ustawień. Wpisz klucz ponownie albo usuń zapamiętany klucz.');
      }
      signingKey = record.key; signingEndpoint = record.endpoint; remembered = true;
      return {};
    } catch (error) {
      if (revision !== authRevision) return {};
      storedCredential = true;
      return { error: error.message };
    }
  }
  async function configure(url, secret, remember = false) {
    ++authRevision;
    if (!validEndpoint(url)) throw new Error('Wpisz poprawny adres wdrożenia Apps Script zakończony /exec.');
    const reuse = !secret && isConfigured() && signingEndpoint === url;
    if (!reuse && secret.length < 32) throw new Error('Klucz synchronizacji musi mieć co najmniej 32 znaki.');
    const imported = reuse ? signingKey : await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    localStorage.setItem('pompki.endpoint', url);
    if (remember) {
      await credentialStore('readwrite', store => store.put({ endpoint: url, key: imported }, 'active'));
      storedCredential = true;
    } else if (storedCredential) {
      await credentialStore('readwrite', store => store.delete('active'));
      storedCredential = false;
    }
    signingKey = imported; signingEndpoint = url; remembered = remember;
  }
  async function forget() {
    ++authRevision; signingKey = null; signingEndpoint = ''; remembered = false;
    if (storedCredential) await credentialStore('readwrite', store => store.delete('active'));
    storedCredential = false;
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
    if (!isConfigured()) throw new Error('Otwórz ustawienia ⚙ i podaj klucz synchronizacji. Wynik jest zapisany lokalnie.');
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
  window.PompkiSync = { configure, endpoint, send, isConfigured, restore, forget,
    isRemembered: () => remembered && isConfigured(), hasStoredCredential: () => storedCredential };
})();
