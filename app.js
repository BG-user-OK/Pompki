/* Pompki vGPT_1.0.2 */
(function () {
  'use strict';
  const VERSION = 'vGPT_1.0.2', C = window.PompkiCore, Sync = window.PompkiSync;
  const $ = id => document.getElementById(id), KEY = 'pompki.state.v1';
  let data = { active: null, lastResult: null, queue: [], statuses: {} };
  let timer = null, audio = null, wakeLock = null, busy = false, storageRetry = null, waitingSW = null;
  let restAudioEnd = 0, lastRender = '', syncing = false, retryTimer = null, audioPromise = Promise.resolve();
  const messages = {
    saved: 'Zapisano w arkuszu.', duplicate: 'Zapisano w arkuszu.', superseded: 'Nowszy trening z tego dnia jest już zapisany.',
    ambiguous: 'Wynik zapisany lokalnie. Nie można jednoznacznie wskazać dnia w arkuszu.',
    invalid: 'Wynik zapisany lokalnie. Backend odrzucił dane.', unauthorized: 'Wynik zapisany lokalnie. Sprawdź klucz synchronizacji.',
    pending: 'Wynik zapisany lokalnie. Oczekuje na synchronizację.'
  };
  function storageProblem(error, retry) {
    storageRetry = retry;
    $('storage-error').textContent = 'Pamięć urządzenia jest niedostępna lub pełna. Nie zamykaj aplikacji: wynik pozostaje w pamięci do ponownej próby zapisu.';
    if (!$('storage-dialog').open) $('storage-dialog').showModal();
  }
  function persist(next, retry) {
    try { localStorage.setItem(KEY, JSON.stringify(next)); data = next; storageRetry = null; if ($('storage-dialog').open) $('storage-dialog').close(); return true; }
    catch (error) { storageProblem(error, retry); return false; }
  }
  function saveActive(next) {
    return persist({ ...data, active: next }, () => { if (saveActive(next)) { $('storage-dialog').close(); render(); } });
  }
  function show(id) {
    for (const name of ['home', 'workout', 'black', 'result']) $(name).hidden = name !== id;
  }
  function activeWorkout() { return data.active && data.active.phase !== 'finished'; }
  async function unlockAudio() {
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state !== 'running') await audio.resume();
      const buffer = audio.createBuffer(1, 1, audio.sampleRate), source = audio.createBufferSource();
      source.buffer = buffer; source.connect(audio.destination); source.start();
    } catch { /* Time and workout state remain functional without audio. */ }
  }
  async function requestWakeLock() {
    if (!activeWorkout() || document.visibilityState !== 'visible' || wakeLock || !navigator.wakeLock) return;
    try { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } catch { /* Device may refuse; deadlines still recover on return. */ }
  }
  function releaseWakeLock() { if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; } }
  function beeps() {
    if (!audio || audio.state !== 'running') return 0;
    const start = audio.currentTime + 0.025;
    for (let i = 0; i < 4; i++) {
      const at = start + i * 0.48, oscillator = audio.createOscillator(), gain = audio.createGain();
      oscillator.type = 'square'; oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(0.24, at + 0.012); gain.gain.setValueAtTime(0.24, at + 0.24); gain.gain.linearRampToValueAtTime(0, at + 0.27);
      oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(at); oscillator.stop(at + 0.28);
    }
    return 1750;
  }
  function statusText(id) { return messages[data.statuses[id]] || messages.pending; }
  function updateStatuses() {
    const count = data.queue.length;
    $('home-status').textContent = count ? `${count} ${count === 1 ? 'wynik oczekuje' : 'wyniki oczekują'} na synchronizację` : '';
    $('queue-status').textContent = count ? `Niewysłane treningi: ${count}. Dane pozostają na tym urządzeniu do potwierdzenia zapisu.` : 'Brak niewysłanych treningów.';
    if (data.lastResult) $('result-status').textContent = statusText(data.lastResult.id);
  }
  function render() {
    const state = data.active;
    if (!state) { show('home'); lastRender = ''; updateStatuses(); return; }
    if (state.phase === 'finished') {
      show('result'); $('duration').textContent = C.duration(state.durationMs); $('final-counter').textContent = C.counter(state);
      const path = `./obrazki/${state.threshold}_pompek.png`;
      if ($('result-image').getAttribute('src') !== path) $('result-image').src = path;
      $('result-image').alt = `Próg graficzny: ${state.threshold} pompek. Rzeczywisty wynik: ${state.actualTotal}.`;
      updateStatuses(); return;
    }
    if (state.phase === 'black') { show('black'); return; }
    show('workout'); $('counter').textContent = C.counter(state);
    const resting = state.phase === 'rest'; $('choices').hidden = resting; $('rest').hidden = !resting;
    if (resting) $('rest').textContent = C.rest(state, Date.now()).seconds;
  }
  function tick() {
    if (data.active?.phase !== 'rest') return;
    const r = C.rest(data.active, Date.now());
    if (!r.expired) { if ($('rest').textContent !== String(r.seconds)) $('rest').textContent = r.seconds; return; }
    // The black state is committed before audio. Reloading never plays a second alarm.
    if (saveActive({ ...data.active, phase: 'black' })) {
      render(); restAudioEnd = Date.now() + beeps();
    }
  }
  function startWorkout() {
    if (busy || activeWorkout()) return;
    audioPromise = unlockAudio();
    const next = C.begin(crypto.randomUUID(), Date.now());
    if (saveActive(next)) { render(); requestWakeLock(); }
  }
  function recordSet(reps) {
    if (busy || data.active?.phase !== 'ready') return;
    busy = true; $('choices').hidden = true;
    audioPromise = unlockAudio();
    const next = C.record(data.active, reps, Date.now());
    if (next.phase === 'finished') {
      const completed = { ...data, active: next, lastResult: next, queue: [...data.queue.filter(w => w.id !== next.id), next], statuses: { ...data.statuses, [next.id]: 'pending' } };
      const commit = () => {
        if (persist(completed, commit)) { $('storage-dialog').close(); render(); releaseWakeLock(); syncQueue(); activateUpdate(); }
      };
      commit();
    } else if (saveActive(next)) render();
    busy = false;
  }
  async function syncQueue() {
    if (syncing || !navigator.onLine || !Sync.isConfigured() || !data.queue.length || activeWorkout()) { updateStatuses(); return; }
    syncing = true; clearTimeout(retryTimer);
    try {
      // Oldest first; server timestamps protect newer same-day results even if arrival order changes.
      for (const workout of [...data.queue].sort((a, b) => a.completedAt - b.completedAt)) {
        const receipt = await Sync.send(workout);
        const accepted = ['saved', 'duplicate', 'superseded'].includes(receipt.status);
        const next = { ...data, queue: accepted ? data.queue.filter(w => w.id !== workout.id) : data.queue, statuses: { ...data.statuses, [workout.id]: receipt.status } };
        if (!persist(next, syncQueue)) break;
        updateStatuses();
        if (receipt.status === 'unauthorized' || receipt.status === 'invalid') break;
      }
    } catch (error) {
      if (data.lastResult) $('result-status').textContent = error.message;
    } finally {
      syncing = false;
      if (data.queue.length && navigator.onLine && Sync.isConfigured()) retryTimer = setTimeout(syncQueue, 60000);
    }
  }
  function activateUpdate() { if (waitingSW && !activeWorkout()) waitingSW.postMessage('ACTIVATE_UPDATE'); }
  $('start').addEventListener('click', startWorkout);
  document.querySelectorAll('[data-reps]').forEach(button => button.addEventListener('click', () => recordSet(Number(button.dataset.reps))));
  $('black').addEventListener('click', () => {
    if (data.active?.phase !== 'black' || Date.now() < restAudioEnd || busy) return;
    audioPromise = unlockAudio(); if (saveActive({ ...data.active, phase: 'ready' })) { render(); requestWakeLock(); }
  });
  $('new-workout').addEventListener('click', () => { if (saveActive(null)) { render(); activateUpdate(); } });
  $('sync-now').addEventListener('click', () => { if (Sync.isConfigured()) syncQueue(); else $('settings').click(); });
  $('settings').addEventListener('click', () => { $('endpoint').value = Sync.endpoint(); $('sync-key').value = ''; updateStatuses(); $('settings-dialog').showModal(); });
  $('close-settings').addEventListener('click', () => { $('sync-key').value = ''; $('settings-dialog').close(); });
  $('settings-dialog').addEventListener('close', () => { $('sync-key').value = ''; });
  $('settings-form').addEventListener('submit', async event => {
    event.preventDefault();
    try { await Sync.configure($('endpoint').value.trim(), $('sync-key').value); $('sync-key').value = ''; $('settings-dialog').close(); syncQueue(); }
    catch (error) { $('queue-status').textContent = error.message; }
  });
  $('storage-retry').addEventListener('click', () => { if (storageRetry) storageRetry(); });
  $('storage-dialog').addEventListener('cancel', event => event.preventDefault());
  $('resume-workout').addEventListener('click', () => { audioPromise = unlockAudio(); $('recovery-dialog').close(); render(); requestWakeLock(); tick(); });
  $('discard-workout').addEventListener('click', () => { if (saveActive(null)) { $('recovery-dialog').close(); render(); } });
  $('recovery-dialog').addEventListener('cancel', event => event.preventDefault());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { requestWakeLock(); tick(); syncQueue(); } });
  window.addEventListener('online', syncQueue);
  window.addEventListener('pagehide', releaseWakeLock);
  // Cross-tab changes are applied before the next input to avoid stale state.
  window.addEventListener('storage', event => { if (event.key === KEY && event.newValue) { try { data = JSON.parse(event.newValue); render(); } catch {} } });
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const loaded = JSON.parse(raw);
      if (!loaded || !Array.isArray(loaded.queue) || typeof loaded.statuses !== 'object') throw new Error('Invalid storage');
      data = loaded;
    }
  } catch (error) {
    storageProblem(error, () => location.reload());
  }
  render(); timer = setInterval(tick, 150);
  if (activeWorkout()) $('recovery-dialog').showModal();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(`./sw.js?v=${VERSION}`).then(registration => {
      if (registration.waiting) { waitingSW = registration.waiting; activateUpdate(); }
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => { if (worker.state === 'installed' && navigator.serviceWorker.controller) { waitingSW = worker; activateUpdate(); } });
      });
    }).catch(() => { if (!activeWorkout()) $('home-status').textContent = 'Tryb offline będzie dostępny po poprawnym załadowaniu aplikacji online.'; });
  }
})();
