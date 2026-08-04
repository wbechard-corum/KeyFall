// Exercises the piano voice against a recording Web Audio mock. We can't
// listen to the output here, so this checks the things that actually broke
// before: notes that never stop, envelopes scheduled out of order, voices
// leaking, and the sustain pedal.
import { check, finish, sleep } from './helpers.mjs';

// ── Web Audio mock ───────────────────────────────────────────────────────
let now = 0;
const created = { osc: [], gain: [], filter: [], buffer: [] };

class Param {
  constructor(value = 0) { this.value = value; this.events = []; }
  setValueAtTime(v, t) { this.events.push(['set', v, t]); this.value = v; return this; }
  linearRampToValueAtTime(v, t) { this.events.push(['lin', v, t]); this.value = v; return this; }
  exponentialRampToValueAtTime(v, t) {
    if (v === 0) throw new RangeError('exponentialRampToValueAtTime cannot target 0');
    this.events.push(['exp', v, t]); this.value = v; return this;
  }
  setTargetAtTime(v, t) { this.events.push(['target', v, t]); this.value = v; return this; }
  cancelScheduledValues(t) { this.events.push(['cancel', null, t]); return this; }
}

class Node {
  constructor(kind) { this.kind = kind; this.connections = []; this.disconnected = false; }
  connect(dest) { this.connections.push(dest); return dest; }
  disconnect() { this.disconnected = true; }
}

class Osc extends Node {
  constructor() {
    super('osc');
    this.frequency = new Param(440);
    this.detune = new Param(0);
    this.started = null; this.stopped = null; this.wave = null;
    this.onended = null;
    created.osc.push(this);
  }
  setPeriodicWave(w) { this.wave = w; }
  start(t) { this.started = t; }
  stop(t) {
    // Real nodes throw if you stop before start; catching that here would
    // hide exactly the kind of ordering bug we care about.
    if (this.started === null) throw new Error('stop() before start()');
    this.stopped = this.stopped === null ? t : Math.min(this.stopped, t);
  }
}

class BufferSource extends Node {
  constructor() { super('buffer'); this.started = null; this.stopped = null; created.buffer.push(this); }
  start(t) { this.started = t; }
  stop(t) { this.stopped = t; }
}

const audioCtx = {
  sampleRate: 48000,
  get currentTime() { return now; },
  destination: new Node('destination'),
  createOscillator() { return new Osc(); },
  createGain() { const g = new Node('gain'); g.gain = new Param(1); created.gain.push(g); return g; },
  createBiquadFilter() {
    const f = new Node('filter');
    f.frequency = new Param(350); f.Q = new Param(1); f.type = 'lowpass';
    created.filter.push(f); return f;
  },
  createDynamicsCompressor() {
    const c = new Node('comp');
    for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) c[k] = new Param(0);
    return c;
  },
  createBufferSource() { return new BufferSource(); },
  createBuffer(ch, len) {
    const data = new Float32Array(len);
    return { length: len, getChannelData: () => data };
  },
  createPeriodicWave(real, imag) { return { real, imag }; },
  resume() { return Promise.resolve(); },
};

globalThis.window = { AudioContext: function () { return audioCtx; } };

const audio = await import('../src/trainer/audio.js');

const reset = () => {
  for (const list of Object.values(created)) list.length = 0;
};
const liveOscs = () => created.osc.filter(o => o.started !== null);

// ── 1. A note actually starts and is scheduled to stop ───────────────────
console.log('note on');
{
  reset();
  const v = audio.noteOn(60, 100);
  check('a voice was created', !!v);
  check('two strings sound', liveOscs().length === 2, `${liveOscs().length}`);
  check('both are started at the current time', liveOscs().every(o => o.started === now));
  check('both have a scheduled stop', liveOscs().every(o => o.stopped !== null));
  check('the two strings are detuned against each other',
    liveOscs()[0].detune.value !== liveOscs()[1].detune.value,
    liveOscs().map(o => o.detune.value).join(','));
  check('a hammer noise burst fires', created.buffer.length === 1, `${created.buffer.length}`);
  audio.allNotesOff();
}

// ── 2. Envelopes never target zero exponentially ─────────────────────────
// The old engine did, which throws a RangeError and silently killed the note.
console.log('envelope validity');
{
  reset();
  let threw = null;
  try {
    audio.noteOn(21, 1);      // lowest key, minimum velocity
    audio.noteOn(108, 127);   // highest key, maximum velocity
    audio.noteOn(60, 0);      // zero velocity
  } catch (e) { threw = e; }
  check('extreme notes schedule without throwing', threw === null, String(threw));

  const ramps = created.gain.flatMap(g => g.gain.events).filter(e => e[0] === 'exp');
  check('exponential ramps exist', ramps.length > 0);
  check('none target zero', ramps.every(e => e[1] > 0), JSON.stringify(ramps.filter(e => e[1] <= 0)));

  // Every scheduled envelope point must be at or after the note's start.
  const bad = created.gain.flatMap(g => g.gain.events).filter(e => e[2] !== undefined && e[2] < 0);
  check('no envelope point is scheduled in the past', bad.length === 0, JSON.stringify(bad));
  audio.allNotesOff();
}

// ── 3. noteOff damps early — the note does not ring on regardless ────────
console.log('note off');
{
  reset();
  audio.noteOn(64, 100);
  const oscs = liveOscs();
  const naturalStop = oscs[0].stopped;
  now += 0.2;
  audio.noteOff(64);
  check('release pulls the stop time in',
    oscs[0].stopped < naturalStop, `${oscs[0].stopped} vs ${naturalStop}`);
  check('release stops after the release begins', oscs[0].stopped > 0.2, `${oscs[0].stopped}`);
}

// ── 4. Sustain pedal holds notes through note-off ────────────────────────
console.log('sustain pedal');
{
  reset(); now = 1;
  audio.setSustain(true);
  audio.noteOn(67, 100);
  const oscs = liveOscs();
  const naturalStop = oscs[0].stopped;
  now += 0.1;
  audio.noteOff(67);
  check('pedal down: note-off does not damp',
    oscs[0].stopped === naturalStop, `${oscs[0].stopped} vs ${naturalStop}`);

  now += 0.1;
  audio.setSustain(false);
  check('pedal up: the held note damps',
    oscs[0].stopped < naturalStop, `${oscs[0].stopped} vs ${naturalStop}`);
}

// ── 5. Retriggering the same key doesn't stack voices ────────────────────
console.log('retrigger');
{
  reset(); now = 5;
  audio.setSustain(false);
  const first = audio.noteOn(72, 100);
  const firstOscs = liveOscs().slice();
  now += 0.05;
  audio.noteOn(72, 100);
  check('the previous voice is damped fast',
    firstOscs[0].stopped < first.stopAtTime() + 1, `${firstOscs[0].stopped}`);
  check('the new strike created new oscillators', liveOscs().length === 4, `${liveOscs().length}`);
  audio.allNotesOff();
}

// ── 6. Polyphony is capped ───────────────────────────────────────────────
console.log('voice cap');
{
  reset(); now = 10;
  for (let i = 0; i < 60; i++) audio.noteOn(40 + (i % 40), 90);
  // Every voice past the cap should have stolen an older one, so the number
  // of oscillators still scheduled far into the future stays bounded.
  const stillRinging = liveOscs().filter(o => o.stopped > now + 0.5).length / 2;
  check('active voices stay within the cap', stillRinging <= 33, `${stillRinging} voices`);
  audio.allNotesOff();
}

// ── 7. allNotesOff silences everything ───────────────────────────────────
console.log('panic');
{
  reset(); now = 20;
  for (const m of [60, 64, 67, 72]) audio.noteOn(m, 100);
  const oscs = liveOscs().slice();
  audio.allNotesOff();
  check('every voice is damped promptly',
    oscs.every(o => o.stopped <= now + 0.2), oscs.map(o => o.stopped).join(','));
}

// ── 8. Scheduled song notes release on their own ─────────────────────────
console.log('scheduled playNote');
{
  reset(); now = 30;
  audio.playNote(60, 0.06, 90);
  const oscs = liveOscs().slice();
  const naturalStop = oscs[0].stopped;
  now += 0.06;
  await sleep(120);           // let the release timer fire
  check('the note damps once its duration elapses',
    oscs[0].stopped < naturalStop, `${oscs[0].stopped} vs ${naturalStop}`);
}

// ── 9. Brightness and level track velocity ───────────────────────────────
console.log('velocity response');
{
  // The amp gain and tone filter are the first of each kind a voice makes;
  // later ones belong to the hammer-noise burst.
  reset(); now = 40;
  audio.noteOn(60, 20);
  const soft = { gain: created.gain[0], filter: created.filter[0] };
  reset();
  audio.noteOn(60, 127);
  const hard = { gain: created.gain[0], filter: created.filter[0] };

  const peakOf = (g) => Math.max(...g.gain.events.filter(e => e[0] === 'exp').map(e => e[1]));
  check('a harder strike is louder', peakOf(hard.gain) > peakOf(soft.gain),
    `${peakOf(soft.gain)} -> ${peakOf(hard.gain)}`);

  const openOf = (f) => f.frequency.events.find(e => e[0] === 'set')?.[1] ?? 0;
  check('a harder strike is brighter', openOf(hard.filter) > openOf(soft.filter),
    `${openOf(soft.filter)} -> ${openOf(hard.filter)}`);
  audio.allNotesOff();
}

// ── 10. Register affects both timbre and decay length ────────────────────
console.log('register');
{
  reset(); now = 50;
  audio.noteOn(24, 100);
  const bassStop = liveOscs()[0].stopped - now;
  reset();
  audio.noteOn(96, 100);
  const trebleStop = liveOscs()[0].stopped - now;
  check('bass notes ring far longer than treble', bassStop > trebleStop * 3,
    `bass=${bassStop.toFixed(2)}s treble=${trebleStop.toFixed(2)}s`);
  audio.allNotesOff();
}

finish('audio');
