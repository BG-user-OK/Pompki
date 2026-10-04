/* Pompki vGPT_1.0.1 — pure workout rules, shared by UI and tests. */
(function (root) {
  'use strict';
  const exercise = Object.freeze({ id: 'pushups', sets: 4, choices: [20, 25, 30], restMs: 60000 });
  const thresholds = Object.freeze([100, 110, 120, 130, 140, 150]);
  function nearest(total) {
    return thresholds.reduce((best, value) => Math.abs(value - total) < Math.abs(best - total) ? value : best, thresholds[0]);
  }
  function dateKey(timestamp) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(timestamp));
    return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type).value).join('-');
  }
  function begin(id, now) { return { id, exercise: exercise.id, startedAt: now, sets: [], phase: 'ready', restStartedAt: null }; }
  function record(state, reps, now) {
    if (state.phase !== 'ready' || !exercise.choices.includes(reps) || state.sets.length >= exercise.sets) return state;
    const sets = [...state.sets, reps];
    if (sets.length === exercise.sets) return { ...state, sets, phase: 'finished', completedAt: now, date: dateKey(now), durationMs: Math.max(0, now - state.startedAt), actualTotal: sets.reduce((a, b) => a + b, 0), threshold: nearest(sets.reduce((a, b) => a + b, 0)) };
    return { ...state, sets, phase: 'rest', restStartedAt: now };
  }
  function rest(state, now) {
    const elapsed = Math.max(0, now - state.restStartedAt);
    return { expired: elapsed >= exercise.restMs, seconds: Math.min(60, Math.floor(elapsed / 1000) + 1), deadline: state.restStartedAt + exercise.restMs };
  }
  function counter(state) { return state.sets.length ? `${state.sets.length}:${state.sets.reduce((a, b) => a + b, 0)}` : '0'; }
  function duration(ms) {
    const seconds = Math.floor(ms / 1000), hours = Math.floor(seconds / 3600);
    return (hours ? `${hours}:` : '') + `${Math.floor(seconds / 60) % 60}`.padStart(2, '0') + ':' + `${seconds % 60}`.padStart(2, '0');
  }
  const api = { exercise, thresholds, nearest, dateKey, begin, record, rest, counter, duration };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PompkiCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
