// The one AudioContext and master bus, shared by every sound source: the
// synthesised piano, the sampled piano, and the metronome. Kept separate from
// audio.js so the backends can use it without importing each other.

let ctx = null;
let master = null;
let limiter = null;

export function getAudioContext() {
  if (!ctx) {
    const Ctor = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
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

export function getMasterGain() {
  getAudioContext();
  return master;
}
