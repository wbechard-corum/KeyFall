// Piano voice for the trainer.
//
// The original engine was a triangle + detuned sine with a fixed-length
// envelope and no note-off: every note rang for a preset duration whether or
// not you were still holding the key, and it read as a toy.
//
// This is still synthesis rather than samples — samples would be tens of
// megabytes and would break the offline PWA story — but it models the parts
// of a piano note the ear actually keys on:
//
//   * a register-dependent harmonic spectrum (PeriodicWave), not one partial
//   * brightness that scales with velocity and decays faster than loudness,
//     which is what makes a struck string sound struck
//   * two slightly detuned "strings" per note, so sustained notes beat
//   * a short filtered noise burst for the hammer thump
//   * real note-off with damping, plus a sustain pedal
//
// The exported surface is instrument-shaped (noteOn / noteOff / sustain), so
// a sampled backend can replace the internals without touching callers.

let ctx = null;
let master = null;
let limiter = null;

const MAX_VOICES = 32;
const voices = new Map();      // midi -> Voice[]  (a retrigger can stack briefly)
const sustained = new Set();   // midi values held by the pedal
let sustainOn = false;
let voiceCount = 0;

export function getAudioContext() {
  if (!ctx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();

    // A gentle compressor stops dense chords from clipping into fuzz, which
    // an unbounded sum of voices will do very easily.
    limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 12;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.18;

    master = ctx.createGain();
    master.gain.value = 0.5;

    master.connect(limiter);
    limiter.connect(ctx.destination);
  }
  return ctx;
}

export function resume() {
  try { getAudioContext()?.resume(); } catch { /* no audio available */ }
}

export function setMasterVolume(v) {
  const c = getAudioContext();
  if (!c) return;
  master.gain.setTargetAtTime(Math.max(0, Math.min(1, v)), c.currentTime, 0.01);
}

// Anything that wants to make its own noise (the metronome) should hang off
// the same master so one volume control governs everything.
export function getMasterGain() {
  getAudioContext();
  return master;
}

// ── Timbre ───────────────────────────────────────────────────────────────

// Harmonic amplitudes for three registers. Bass strings are rich and
// inharmonic; the treble is nearly a pure tone with a little second partial.
const SPECTRA = {
  bass:   [0, 1.00, 0.68, 0.52, 0.40, 0.30, 0.22, 0.17, 0.13, 0.10, 0.08, 0.06, 0.05, 0.04, 0.03, 0.02],
  mid:    [0, 1.00, 0.50, 0.32, 0.20, 0.13, 0.09, 0.06, 0.04, 0.03, 0.02, 0.015],
  treble: [0, 1.00, 0.28, 0.12, 0.05, 0.02],
};

const waveCache = new Map();

function waveFor(midi) {
  const register = midi < 48 ? 'bass' : midi < 79 ? 'mid' : 'treble';
  let wave = waveCache.get(register);
  if (!wave) {
    const c = getAudioContext();
    const harmonics = SPECTRA[register];
    const real = new Float32Array(harmonics.length);
    const imag = new Float32Array(harmonics.length);
    // Slight phase scatter keeps the summed waveform from spiking on attack.
    for (let i = 1; i < harmonics.length; i++) {
      const phase = (i * i * 0.7) % (Math.PI * 2);
      imag[i] = harmonics[i] * Math.cos(phase);
      real[i] = harmonics[i] * Math.sin(phase);
    }
    wave = c.createPeriodicWave(real, imag, { disableNormalization: false });
    waveCache.set(register, wave);
  }
  return wave;
}

let noiseBuffer = null;
function hammerNoise() {
  const c = getAudioContext();
  if (!noiseBuffer) {
    const len = Math.floor(c.sampleRate * 0.05);
    noiseBuffer = c.createBuffer(1, len, c.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      // Decaying white noise — the felt thump, not a click.
      data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
    }
  }
  return noiseBuffer;
}

const freqOf = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

// Low notes ring for many seconds; the top octave dies almost at once.
function decayTimeFor(midi) {
  return Math.max(0.45, 18 * Math.pow(0.5, (midi - 21) / 26));
}

// ── Voices ───────────────────────────────────────────────────────────────

function stealOldestVoice() {
  let oldest = null;
  for (const list of voices.values()) {
    for (const v of list) {
      if (!oldest || v.startedAt < oldest.startedAt) oldest = v;
    }
  }
  oldest?.release(0.05);
}

function trackVoice(midi, voice) {
  let list = voices.get(midi);
  if (!list) { list = []; voices.set(midi, list); }
  list.push(voice);
  voiceCount += 1;
}

function untrackVoice(midi, voice) {
  const list = voices.get(midi);
  if (!list) return;
  const i = list.indexOf(voice);
  if (i !== -1) { list.splice(i, 1); voiceCount -= 1; }
  if (list.length === 0) voices.delete(midi);
}

function createVoice(midi, velocity) {
  const c = getAudioContext();
  if (!c) return null;
  if (voiceCount >= MAX_VOICES) stealOldestVoice();

  const now = c.currentTime;
  const f0 = freqOf(midi);
  const vel = Math.max(1, Math.min(127, velocity)) / 127;
  const wave = waveFor(midi);

  // Loudness follows velocity with a curve, not linearly; quiet notes should
  // be quiet but still present.
  const peak = 0.06 + 0.30 * Math.pow(vel, 1.6);
  const decay = decayTimeFor(midi);

  const amp = c.createGain();
  amp.gain.setValueAtTime(0.0001, now);

  // Brightness: harder strikes open the filter much further, and the filter
  // closes faster than the amplitude falls.
  const tone = c.createBiquadFilter();
  tone.type = 'lowpass';
  tone.Q.value = 0.6;
  const openHz = Math.min(c.sampleRate / 2.2, f0 * (4 + 22 * Math.pow(vel, 1.4)));
  const restHz = Math.min(openHz, Math.max(f0 * 2.2, 320));
  tone.frequency.setValueAtTime(openHz, now);
  tone.frequency.exponentialRampToValueAtTime(restHz, now + Math.min(decay, 1.1));

  // Two strings, a few cents apart, so held notes shimmer instead of sitting
  // perfectly still.
  const oscA = c.createOscillator();
  const oscB = c.createOscillator();
  oscA.setPeriodicWave(wave);
  oscB.setPeriodicWave(wave);
  oscA.frequency.setValueAtTime(f0, now);
  oscB.frequency.setValueAtTime(f0, now);
  oscA.detune.setValueAtTime(-2.5, now);
  oscB.detune.setValueAtTime(2.5, now);

  const stringMix = c.createGain();
  stringMix.gain.value = 0.5;
  oscA.connect(stringMix);
  oscB.connect(stringMix);
  stringMix.connect(tone);
  tone.connect(amp);
  amp.connect(master);

  // Attack: fast, and faster still when struck hard.
  const attack = 0.002 + 0.006 * (1 - vel);
  amp.gain.exponentialRampToValueAtTime(peak, now + attack);
  // Initial fast drop, then the long tail — a single exponential sounds like
  // an organ, not a string.
  amp.gain.exponentialRampToValueAtTime(peak * 0.32, now + attack + Math.min(0.4, decay * 0.12));
  amp.gain.exponentialRampToValueAtTime(0.0001, now + decay);

  oscA.start(now);
  oscB.start(now);

  // Hammer thump, only loud enough to be felt.
  let noiseSrc = null;
  if (vel > 0.08) {
    noiseSrc = c.createBufferSource();
    noiseSrc.buffer = hammerNoise();
    const nf = c.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = Math.min(c.sampleRate / 2.5, f0 * 3);
    nf.Q.value = 0.8;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.055 * vel * vel, now);
    ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    noiseSrc.connect(nf); nf.connect(ng); ng.connect(master);
    noiseSrc.start(now);
    noiseSrc.stop(now + 0.06);
  }

  let stopAt = now + decay + 0.05;
  let released = false;

  const voice = {
    midi,
    startedAt: now,
    // Damp the string. `time` is how long the felt takes to stop it.
    release(time = 0.18) {
      if (released) return;
      released = true;
      // Stop counting against polyphony straight away. Waiting for `onended`
      // meant a released voice still occupied a slot for its whole natural
      // decay, and stealOldestVoice could pick an already-damped voice and
      // free nothing — so heavy passages blew past the cap.
      untrackVoice(midi, voice);
      const t = c.currentTime;
      const end = t + time;
      if (end < stopAt) {
        try {
          amp.gain.cancelScheduledValues(t);
          // Read the live value before overwriting the ramp, so damping
          // starts from wherever the note actually is.
          amp.gain.setValueAtTime(Math.max(0.0001, amp.gain.value), t);
          amp.gain.exponentialRampToValueAtTime(0.0001, end);
          oscA.stop(end + 0.02);
          oscB.stop(end + 0.02);
          stopAt = end + 0.02;
        } catch { /* already stopped */ }
      }
    },
    stopAtTime: () => stopAt,
  };

  oscA.onended = () => {
    // release() already untracked in the damped case; this covers a voice
    // that simply decayed to nothing on its own.
    untrackVoice(midi, voice);
    try { amp.disconnect(); tone.disconnect(); stringMix.disconnect(); } catch { /* gone */ }
  };
  oscA.stop(stopAt);
  oscB.stop(stopAt);

  trackVoice(midi, voice);
  return voice;
}

// ── Public API ───────────────────────────────────────────────────────────

export function noteOn(midi, velocity = 80) {
  try {
    // Retrigger: damp whatever is already sounding on this key quickly rather
    // than letting two copies pile up.
    const existing = voices.get(midi);
    if (existing) for (const v of [...existing]) v.release(0.03);
    sustained.delete(midi);
    return createVoice(midi, velocity);
  } catch {
    return null;   // audio unavailable
  }
}

export function noteOff(midi) {
  try {
    if (sustainOn) { sustained.add(midi); return; }
    const list = voices.get(midi);
    if (!list) return;
    for (const v of [...list]) v.release();
  } catch { /* audio unavailable */ }
}

export function setSustain(on) {
  sustainOn = !!on;
  if (sustainOn) return;
  // Pedal up: damp everything that was only being held by the pedal.
  for (const midi of [...sustained]) {
    const list = voices.get(midi);
    if (list) for (const v of [...list]) v.release();
  }
  sustained.clear();
}

export function allNotesOff() {
  sustained.clear();
  for (const list of [...voices.values()]) {
    for (const v of [...list]) v.release(0.06);
  }
}

// Scheduled song note: sounds now, damps after `duration` seconds. Callers
// pass wall-clock duration (song duration adjusted for playback speed).
export function playNote(midi, duration, velocity = 80) {
  const voice = noteOn(midi, velocity);
  if (!voice) return;
  const hold = Math.max(0.05, Number(duration) || 0.05);
  setTimeout(() => {
    if (sustainOn) { sustained.add(midi); return; }
    voice.release();
  }, hold * 1000);
}
