// Metronome beat grid, count-in, and input-latency compensation.
import { check, finish, sleep } from './helpers.mjs';

// ── Minimal Web Audio mock, enough for the click scheduler ───────────────
let now = 0;
const scheduled = [];   // every click, by the time it was scheduled for

class Param {
  constructor(v = 0) { this.value = v; }
  setValueAtTime(v) { this.value = v; return this; }
  exponentialRampToValueAtTime(v, t) {
    if (v === 0) throw new RangeError('exponential ramp to zero');
    this.value = v; return this;
  }
  linearRampToValueAtTime(v) { this.value = v; return this; }
  setTargetAtTime(v) { this.value = v; return this; }
  cancelScheduledValues() { return this; }
}
class Node {
  constructor() { this.connections = []; }
  connect(d) { this.connections.push(d); return d; }
  disconnect() {}
}
const audioCtx = {
  sampleRate: 48000,
  get currentTime() { return now; },
  destination: new Node(),
  createOscillator() {
    const o = new Node();
    o.frequency = new Param(440); o.detune = new Param(0); o.type = 'sine';
    o.setPeriodicWave = () => {};
    o.start = (t) => { o._start = t; };
    o.stop = () => {};
    // A click is an oscillator started in the future by the metronome.
    Object.defineProperty(o, 'onended', { set() {}, get() { return null; } });
    return o;
  },
  createGain() { const g = new Node(); g.gain = new Param(1); return g; },
  createBiquadFilter() {
    const f = new Node();
    f.frequency = new Param(350); f.Q = new Param(1); f.type = 'lowpass';
    return f;
  },
  createDynamicsCompressor() {
    const c = new Node();
    for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) c[k] = new Param(0);
    return c;
  },
  createBufferSource() {
    const b = new Node();
    b.start = () => {}; b.stop = () => {};
    return b;
  },
  createBuffer(ch, len) { const d = new Float32Array(len); return { getChannelData: () => d }; },
  createPeriodicWave() { return {}; },
  resume() { return Promise.resolve(); },
};
globalThis.window = { AudioContext: function () { return audioCtx; } };

// Record clicks by wrapping oscillator creation.
const realCreateOsc = audioCtx.createOscillator.bind(audioCtx);
audioCtx.createOscillator = () => {
  const o = realCreateOsc();
  const start = o.start;
  o.start = (t) => { scheduled.push({ at: t, freq: o.frequency.value }); start(t); };
  return o;
};

const { createMetronome, beatTimes, secondsPerBeatAt } =
  await import('../src/trainer/metronome.js');

// A song whose tempo map says 120bpm then doubles to 240bpm at 2s.
function twoTempoSong() {
  return {
    notes: [], duration: 8, name: 'tempo',
    tempoMap: [
      { tick: 0,   tempo: 500000, time: 0 },   // 0.5 s/beat
      { tick: 960, tempo: 250000, time: 2 },   // 0.25 s/beat
    ],
  };
}

// ── 1. Beat grid follows the tempo map ───────────────────────────────────
console.log('tempo map');
{
  const song = twoTempoSong();
  check('reads the first tempo', Math.abs(secondsPerBeatAt(song, 0) - 0.5) < 1e-9,
    `${secondsPerBeatAt(song, 0)}`);
  check('reads the tempo after the change', Math.abs(secondsPerBeatAt(song, 3) - 0.25) < 1e-9,
    `${secondsPerBeatAt(song, 3)}`);

  const beats = beatTimes(song, 3);
  check('beats before the change are 0.5s apart',
    Math.abs(beats[1] - beats[0] - 0.5) < 1e-9, JSON.stringify(beats.slice(0, 6)));
  const afterIdx = beats.findIndex(t => t >= 2);
  check('beats after the change are 0.25s apart',
    Math.abs(beats[afterIdx + 1] - beats[afterIdx] - 0.25) < 1e-9,
    JSON.stringify(beats.slice(afterIdx, afterIdx + 3)));

  // A song with no tempo map (the built-in demos) must still tick.
  check('falls back to 120bpm without a map',
    Math.abs(secondsPerBeatAt({ notes: [] }, 0) - 0.5) < 1e-9);
}

// ── 2. Clicks are scheduled, once per beat, ahead of the playhead ────────
console.log('scheduling');
{
  scheduled.length = 0;
  now = 0;
  const met = createMetronome();
  met.setEnabled(true);
  met.setBeatsPerBar(4);
  const song = twoTempoSong();
  met.resync(song, 0);

  // Walk a second of playback in 16ms frames.
  for (let i = 0; i < 63; i++) {
    const pos = i * 0.016;
    now = pos;
    met.schedule(song, pos, 1);
  }
  check('clicks were scheduled', scheduled.length > 0, `${scheduled.length}`);
  check('roughly two beats in the first second',
    scheduled.length >= 2 && scheduled.length <= 4, `${scheduled.length}`);
  check('every click is scheduled at or after now',
    scheduled.every(c => c.at >= 0), JSON.stringify(scheduled));

  const times = scheduled.map(c => c.at).sort((a, b) => a - b);
  check('clicks are strictly increasing',
    times.every((t, i) => i === 0 || t > times[i - 1]), JSON.stringify(times));
}

// ── 3. Downbeats are accented ────────────────────────────────────────────
console.log('accents');
{
  scheduled.length = 0;
  now = 0;
  const met = createMetronome();
  met.setEnabled(true);
  met.setBeatsPerBar(4);
  const song = twoTempoSong();
  met.resync(song, 0);
  for (let i = 0; i < 130; i++) { now = i * 0.016; met.schedule(song, now, 1); }

  const freqs = [...new Set(scheduled.map(c => c.freq))];
  check('two distinct click pitches', freqs.length === 2, JSON.stringify(freqs));

  // Check accent *placement*, not the count: the run may end mid-bar, so the
  // ratio of accents to clicks isn't fixed.
  const accentFreq = Math.max(...freqs);
  const inOrder = [...scheduled].sort((a, b) => a.at - b.at);
  const accentIdx = inOrder
    .map((c, i) => (c.freq === accentFreq ? i : -1))
    .filter(i => i !== -1);
  check('accents land on every fourth beat',
    accentIdx.every(i => i % 4 === 0),
    `accent indices ${JSON.stringify(accentIdx)} of ${inOrder.length} clicks`);
  check('the first beat is an accent', accentIdx[0] === 0, JSON.stringify(accentIdx));
}

// ── 4. Disabled metronome is silent ──────────────────────────────────────
console.log('disabled');
{
  scheduled.length = 0;
  now = 0;
  const met = createMetronome();
  met.setEnabled(false);
  const song = twoTempoSong();
  for (let i = 0; i < 63; i++) { now = i * 0.016; met.schedule(song, now, 1); }
  check('no clicks when disabled', scheduled.length === 0, `${scheduled.length}`);
}

// ── 5. Seeking backwards re-aims the grid instead of going silent ────────
console.log('resync after a jump');
{
  const met = createMetronome();
  met.setEnabled(true);
  const song = twoTempoSong();
  now = 0;
  met.resync(song, 0);
  for (let i = 0; i < 63; i++) { now = i * 0.016; met.schedule(song, now, 1); }

  // Jump back to the top, as a loop wrap would.
  scheduled.length = 0;
  now = 1.0;
  met.schedule(song, 0, 1);
  for (let i = 0; i < 40; i++) { now = 1.0 + i * 0.016; met.schedule(song, i * 0.016, 1); }
  check('clicks resume after jumping backwards', scheduled.length > 0, `${scheduled.length}`);
}

// ── 6. Count-in fires the right number of clicks ─────────────────────────
console.log('count-in');
{
  scheduled.length = 0;
  now = 0;
  const met = createMetronome();
  met.setBeatsPerBar(4);
  const song = twoTempoSong();
  const done = met.countIn(song, 0, 1);
  check('one bar schedules four clicks', scheduled.length === 4, `${scheduled.length}`);
  const gaps = scheduled.slice(1).map((c, i) => c.at - scheduled[i].at);
  check('clicks are a beat apart', gaps.every(g => Math.abs(g - 0.5) < 1e-9),
    JSON.stringify(gaps));
  check('the first click is accented',
    scheduled[0].freq > scheduled[1].freq, `${scheduled[0].freq} vs ${scheduled[1].freq}`);
  await done;
  check('count-in resolves', true);

  scheduled.length = 0;
  await met.countIn(song, 0, 2);
  check('two bars schedule eight clicks', scheduled.length === 8, `${scheduled.length}`);
}

// ── 7. Input latency shifts judging ──────────────────────────────────────
console.log('input latency');
{
  const frameQueue = [];
  globalThis.performance = { now: () => now * 1000 };
  globalThis.requestAnimationFrame = (fn) => { frameQueue.push(fn); return 1; };
  globalThis.cancelAnimationFrame = () => {};
  const step = (ms) => { now += ms / 1000; for (const f of frameQueue.splice(0)) f(); };

  const { createPlayback } = await import('../src/trainer/playback.js');
  const mkSong = () => {
    const notes = [{ midi: 60, startTime: 0.5, endTime: 0.7, velocity: 80, track: 0,
                     played: false, hit: false }];
    return { notes, duration: 2, name: 'lat' };
  };

  // 150ms is outside the 120ms "good" window, so uncompensated it reads late.
  const LAG = 0.15;
  now = 100;
  const a = createPlayback({});
  a.setSong(mkSong());
  a.play();
  while (a.getCurrentTime() < 0.5 + LAG) step(16);
  a.reportKeyPress(60);
  const sA = a.getScore();
  check('an uncompensated late press is rated late',
    sA.byRating.late === 1, JSON.stringify(sA.byRating));
  a.pause();

  // The same lag, declared as input offset, should land as perfect.
  frameQueue.length = 0;
  const b = createPlayback({});
  b.setSong(mkSong());
  b.setInputLatency(LAG);
  b.play();
  while (b.getCurrentTime() < 0.5 + LAG) step(16);
  b.reportKeyPress(60);
  const sB = b.getScore();
  check('compensation pulls it back to perfect',
    sB.byRating.perfect === 1, JSON.stringify(sB.byRating));
  b.pause();

  // The offset is clamped so a silly value can't break judging.
  const c = createPlayback({});
  c.setSong(mkSong());
  c.setInputLatency(99);
  check('absurd offsets are clamped', Math.abs(c.state.inputLatency) <= 0.5,
    `${c.state.inputLatency}`);
  c.setInputLatency(NaN);
  check('NaN falls back to zero', c.state.inputLatency === 0, `${c.state.inputLatency}`);
}

finish('practice');
