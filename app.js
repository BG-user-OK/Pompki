/* Pompki vGPT_1.0.8 */
(function () {
  'use strict';
  const VERSION = 'vGPT_1.0.8', C = window.PompkiCore, Sync = window.PompkiSync;
  const $ = id => document.getElementById(id), KEY = 'pompki.state.v1';
  let data = { active: null, lastResult: null, queue: [], statuses: {} };
  let timer = null, audio = null, wakeLock = null, busy = false, storageRetry = null, updates = null;
  let restAudioEnd = 0, lastRender = '', syncing = false, retryTimer = null, audioPromise = Promise.resolve();
  let processing = false, syncAttempt = null, syncError = null, tapePosition = null;
  let roundSound = null, roundSoundLoad = null;
  const reelStates = {}, ROUND_SOUND_URLS = ['./audio/runda_x.wav', './audio/runda_x-end.wav'];
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
    for (const name of ['home', 'workout', 'black', 'processing', 'result']) $(name).hidden = name !== id;
  }
  function activeWorkout() { return data.active && data.active.phase !== 'finished'; }
  async function unlockAudio() {
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state !== 'running') await audio.resume();
      const buffer = audio.createBuffer(1, 1, audio.sampleRate), source = audio.createBufferSource();
      source.buffer = buffer; source.connect(audio.destination); source.start();
      prepareRoundSound();
    } catch { /* Time and workout state remain functional without audio. */ }
  }
  async function requestWakeLock() {
    if (!activeWorkout() || document.visibilityState !== 'visible' || wakeLock || !navigator.wakeLock) return;
    try { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } catch { /* Device may refuse; deadlines still recover on return. */ }
  }
  function releaseWakeLock() { if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; } }
  function beeps(count) {
    if (!audio || audio.state !== 'running') return 0;
    const start = audio.currentTime + 0.025;
    for (let i = 0; i < count; i++) {
      const at = start + i * 0.48, oscillator = audio.createOscillator(), gain = audio.createGain();
      oscillator.type = 'square'; oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(0.24, at + 0.012); gain.gain.setValueAtTime(0.24, at + 0.24); gain.gain.linearRampToValueAtTime(0, at + 0.27);
      oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(at); oscillator.stop(at + 0.28);
    }
    return 1750 - (4 - count) * 480;
  }
  function prepareRoundSound() {
    if (!audio || roundSound || roundSoundLoad) return roundSoundLoad;
    const context = audio, controller = new AbortController();
    roundSoundLoad = (async () => {
      let timeout;
      try {
        const deadline = new Promise((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(new Error('Optional audio timeout')); }, 3000); });
        const load = (async () => {
          return Promise.all(ROUND_SOUND_URLS.map(async url => {
            const response = await fetch(url, { cache: 'no-cache', signal: controller.signal });
            if (!response.ok) throw new Error('Optional audio unavailable');
            const buffer = await context.decodeAudioData(await response.arrayBuffer());
            if (!Number.isFinite(buffer.duration) || buffer.duration <= 0) throw new Error('Invalid audio duration');
            return buffer;
          }));
        })();
        roundSound = await Promise.race([load, deadline]);
      } catch { /* Missing/corrupt/blocked recordings keep the synthesized alarm available. */ }
      finally { clearTimeout(timeout); roundSoundLoad = null; }
    })();
    return roundSoundLoad;
  }
  function roundAlarm(count) {
    const sources = [];
    if (roundSound && audio?.state === 'running') {
      try {
        let at = audio.currentTime + 0.025;
        for (let i = 0; i < count; i++) {
          const source = audio.createBufferSource(); sources.push(source);
          source.buffer = roundSound[i === count - 1 ? 1 : 0];
          source.connect(audio.destination); source.start(at);
          at += source.buffer.duration + (i === count - 1 ? 0 : 0.2);
        }
        return Math.ceil((at - audio.currentTime) * 1000) + 5;
      } catch {
        for (const source of sources) { try { source.stop(); source.disconnect(); } catch {} }
        roundSound = null;
      }
    }
    try { return beeps(count); } catch { return 0; }
  }
  function statusText(id) { return messages[data.statuses[id]] || messages.pending; }
  function updateStatuses() {
    const count = data.queue.length;
    $('home-status').textContent = count ? `${count} ${count === 1 ? 'wynik oczekuje' : 'wyniki oczekują'} na synchronizację` : '';
    $('queue-status').textContent = count ? `Niewysłane treningi: ${count}. Dane pozostają na tym urządzeniu do potwierdzenia zapisu.` : 'Brak niewysłanych treningów.';
    if (data.lastResult) $('result-status').textContent = syncError?.id === data.lastResult.id ? syncError.message : statusText(data.lastResult.id);
  }
  function renderRest(seconds, immediate = false) {
    $('rest-value').textContent = seconds;
    const timing = C.rest(data.active, Date.now()), intro = C.restIntro;
    const entryEnd = intro.blackMs + intro.entryMs, ascentStart = entryEnd + intro.previewMs;
    const stage = !timing.intro ? 'count' : timing.introElapsed < intro.blackMs ? 'black' : timing.introElapsed < entryEnd ? 'entry' : timing.introElapsed < ascentStart ? 'preview' : 'ascent';
    $('workout').classList.toggle('rest-intro', timing.intro);
    $('workout').classList.toggle('rest-intro-black', stage === 'black');
    $('workout').classList.toggle('rest-first-digit', data.active.restCountStartedAt != null && seconds === 1);
    const roller = $('rest-roller');
    const h = roller.clientHeight, w = roller.clientWidth;
    if (!h || !w) return;
    const key = `${data.active.id}:${data.active.sets.length}`, digitH = Math.round(Math.min(h * 0.6, w * 0.9));
    const resized = !tapePosition || tapePosition.h !== h || tapePosition.w !== w;
    if (resized) roller.style.fontSize = `${Math.floor(Math.min(digitH * 0.95, w * 0.64))}px`;
    if (!timing.intro && !immediate && !resized && tapePosition.key === key && tapePosition.seconds === seconds && tapePosition.stage === stage) return;
    const snap = immediate || resized || tapePosition.key !== key || (!timing.intro && !tapePosition.intro && seconds !== tapePosition.seconds + 1) || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function positionReel(id, value) {
      const inner = $(id), previous = reelStates[id], ones = id === 'rest-ones-tape';
      // Reserve both columns. During 1-8 the blank tens row holds its future 1 below the viewport;
      // at 9 it slides into the lower preview, then reaches the centre naturally at 10.
      let position = ones ? value + 1 : seconds < 9 ? -1 : value, from = position, transition = 'transform 0.6s ease';
      if (ones && timing.intro) {
        if (stage === 'black') position = from = 0;
        else if (stage === 'entry') {
          from = (timing.introElapsed - intro.blackMs) / intro.entryMs; position = 1;
          transition = `transform ${(entryEnd - timing.introElapsed) / 1000}s linear`;
        } else if (stage === 'preview') position = from = 1;
        else {
          from = 1 + (timing.introElapsed - ascentStart) / intro.ascentMs; position = 2;
          transition = `transform ${(C.exercise.restIntroMs - timing.introElapsed) / 1000}s linear`;
        }
        if (snap) position = from;
      }
      if (!snap && previous?.value === value && previous.position === position) return;
      inner.ontransitionend = null;
      const transform = position => `translateY(${h / 2 - digitH / 2 - position * digitH}px)`;
      if (!inner.childElementCount) {
        const rows = document.createDocumentFragment(), ones = id === 'rest-ones-tape', last = ones ? 12 : 6;
        for (let digit = 0; digit <= last; digit++) {
          const row = document.createElement('div'); row.className = 'rest-digit';
          row.textContent = ones ? (digit + 9) % 10 : digit === 0 ? '' : digit; rows.append(row);
        }
        inner.append(rows);
      }
      if (resized) for (const row of inner.children) row.style.height = `${digitH}px`;
      if (ones && timing.intro && !snap && from !== position) {
        inner.style.transition = 'none'; inner.style.transform = transform(from); inner.getBoundingClientRect();
      }
      // A repeated zero lets 9 -> 0 move upward; reset to the first zero without visible motion.
      if (!snap && previous?.position === 11) {
        inner.style.transition = 'none'; inner.style.transform = transform(1); inner.getBoundingClientRect();
      }
      const wrap = !snap && previous?.value === 9 && value === 0;
      const current = { value, position: wrap ? 11 : position }; reelStates[id] = current;
      inner.style.transition = snap ? 'none' : transition;
      inner.style.transform = transform(current.position);
      if (snap) inner.getBoundingClientRect();
      if (wrap) inner.ontransitionend = event => {
        if (event.propertyName !== 'transform' || reelStates[id] !== current) return;
        inner.style.transition = 'none'; inner.style.transform = transform(1); inner.getBoundingClientRect();
        current.position = 1; inner.ontransitionend = null;
      };
    }
    // Deadlines, not animation events, determine the digits; resume/resize snaps directly to now.
    positionReel('rest-tens-tape', Math.floor(seconds / 10));
    positionReel('rest-ones-tape', seconds % 10);
    tapePosition = { key, seconds, h, w, intro: timing.intro, stage };
  }
  function render() {
    if (processing) { show('processing'); return; }
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
    if (!resting) $('workout').classList.remove('rest-intro', 'rest-intro-black', 'rest-first-digit');
    if (resting) renderRest(C.rest(state, Date.now()).seconds, true);
  }
  function tick(immediate = false) {
    if (data.active?.phase !== 'rest') return;
    const r = C.rest(data.active, Date.now());
    if (!r.expired) { renderRest(r.seconds, immediate); return; }
    // The black state is committed before audio. Reloading never plays a second alarm.
    if (saveActive({ ...data.active, phase: 'black' })) {
      render(); restAudioEnd = Date.now() + roundAlarm(data.active.sets.length + 1);
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
      completeWorkout(next); return;
    } else if (saveActive(next)) render();
    busy = false;
    activateUpdate();
  }
  function processingPaint() {
    if (document.visibilityState !== 'visible') return Promise.resolve();
    return new Promise(resolve => {
      let first, second;
      const done = () => { clearTimeout(fallback); cancelAnimationFrame(first); cancelAnimationFrame(second); resolve(); };
      // Give the wheel a painted frame before the synchronous localStorage commit.
      const fallback = setTimeout(done, 150);
      first = requestAnimationFrame(() => { second = requestAnimationFrame(done); });
    });
  }
  async function completeWorkout(workout) {
    if (processing) return;
    busy = true; processing = true; syncError = null; render();
    try {
      await processingPaint();
      const completed = { ...data, active: workout, lastResult: workout, queue: [...data.queue.filter(w => w.id !== workout.id), workout], statuses: { ...data.statuses, [workout.id]: 'pending' } };
      if (!persist(completed, () => completeWorkout(workout))) return;
      releaseWakeLock();
      await syncQueue();
    } finally {
      processing = false; busy = false; render(); activateUpdate();
    }
  }
  function syncQueue() {
    if (syncing) return syncAttempt;
    if (!navigator.onLine || !Sync.isConfigured() || !data.queue.length || activeWorkout()) { updateStatuses(); return Promise.resolve(); }
    syncing = true; clearTimeout(retryTimer);
    syncError = null;
    syncAttempt = sendQueuedWorkouts();
    return syncAttempt;
  }
  async function sendQueuedWorkouts() {
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
      if (data.lastResult) syncError = { id: data.lastResult.id, message: error.message };
      updateStatuses();
    } finally {
      syncing = false;
      activateUpdate();
      if (data.queue.length && navigator.onLine && Sync.isConfigured()) retryTimer = setTimeout(syncQueue, 60000);
    }
  }
  function activateUpdate() { updates?.apply(); }
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
  $('settings-dialog').addEventListener('close', () => { $('sync-key').value = ''; activateUpdate(); });
  $('settings-form').addEventListener('submit', async event => {
    event.preventDefault();
    try { await Sync.configure($('endpoint').value.trim(), $('sync-key').value); $('sync-key').value = ''; $('settings-dialog').close(); syncQueue(); }
    catch (error) { $('queue-status').textContent = error.message; }
  });
  $('storage-retry').addEventListener('click', () => { if (storageRetry) storageRetry(); });
  $('storage-dialog').addEventListener('cancel', event => event.preventDefault());
  $('resume-workout').addEventListener('click', () => { audioPromise = unlockAudio(); $('recovery-dialog').close(); render(); requestWakeLock(); tick(true); });
  $('discard-workout').addEventListener('click', () => { if (saveActive(null)) { $('recovery-dialog').close(); render(); activateUpdate(); } });
  $('recovery-dialog').addEventListener('cancel', event => event.preventDefault());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { requestWakeLock(); tick(true); syncQueue(); } });
  window.addEventListener('resize', () => { if (data.active?.phase === 'rest') renderRest(C.rest(data.active, Date.now()).seconds, true); });
  window.addEventListener('online', syncQueue);
  window.addEventListener('online', prepareRoundSound);
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
  updates = window.PompkiUpdates.start({
    // A reload must not interrupt a set, a storage retry, an in-flight request,
    // or an unsent queue that still needs the session-only synchronization key.
    canReload: () => !activeWorkout() && !busy && !syncing &&
      !['settings-dialog', 'storage-dialog', 'recovery-dialog'].some(id => $(id).open) &&
      !(data.queue.length && Sync.isConfigured()),
    onError: () => { if (!activeWorkout()) $('home-status').textContent = 'Tryb offline będzie dostępny po poprawnym załadowaniu aplikacji online.'; }
  });
})();
