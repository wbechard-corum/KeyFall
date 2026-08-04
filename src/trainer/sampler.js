// Sampled piano backend — Salamander Grand Piano V3.
//
// The sample set lives in public/samples/piano and is built by
// scripts/build-piano-samples.mjs. It covers all 88 keys every three
// semitones across four velocity layers, so playback never pitch-shifts by
// more than a semitone and dynamics come from real recordings rather than a
// filter sweep.
//
// It is ~6.6 MB, which is far too much to block startup on, so:
//   * nothing is fetched until sampled mode is actually selected
//   * any note whose sample hasn't decoded yet falls back to the synth, so
//     the instrument is playable throughout the download
//   * the service worker caches the files, so it's a one-time cost
//
// Exposes the same shape as synth.js: noteOn / noteOff / setSustain /
// allNotesOff / playNote.
import { getAudioContext, getMasterGain } from './audio-context.js';

const MANIFEST_URL = './samples/piano/manifest.json';
const SAMPLE_BASE = './samples/piano/';
const MAX_VOICES = 32;

let manifest = null;
let loadPromise = null;
let state = 'idle';        // 'idle' | 'loading' | 'ready' | 'error'
let error = null;
let loaded = 0;
let total = 0;

// layer id -> Map(midi -> AudioBuffer)
const buffers = new Map();
const voices = new Map();      // midi -> Voice[]
const sustained = new Set();
let sustainOn = false;
let voiceCount = 0;

const listeners = new Set();
export function onSamplerStatus(fn) {
  listeners.add(fn);
  fn(status());
  return () => listeners.delete(fn);
}
function emit() {
  const s = status();
  for (const fn of listeners) { try { fn(s); } catch { /* listener's problem */ } }
}

export function status() {
  return {
    state,
    error,
    loaded,
    total,
    progress: total > 0 ? loaded / total : 0,
    attribution: manifest?.attribution ?? null,
  };
}

export function isReady() { return state === 'ready'; }

// Load the manifest and every sample. Safe to call repeatedly — the same
// promise is returned while a load is in flight.
export function load() {
  if (state === 'ready') return Promise.resolve(true);
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    state = 'loading';
    error = null;
    loaded = 0;
    total = 0;
    emit();
    try {
      const res = await fetch(MANIFEST_URL);
      if (!res.ok) throw new Error(`manifest ${res.status}`);
      manifest = await res.json();

      const jobs = [];
      for (const layer of manifest.layers) {
        buffers.set(layer.id, new Map());
        for (const s of layer.samples) jobs.push({ layer: layer.id, ...s });
      }
      total = jobs.length;
      emit();

      const ctx = getAudioContext();
      if (!ctx) throw new Error('Web Audio is unavailable');

      // A handful at a time: enough to saturate the connection without
      // opening 120 sockets at once.
      const CONCURRENCY = 6;
      let next = 0;
      const worker = async () => {
        while (next < jobs.length) {
          const job = jobs[next++];
          try {
            const r = await fetch(SAMPLE_BASE + job.file);
            if (!r.ok) throw new Error(`${job.file} ${r.status}`);
            const buf = await ctx.decodeAudioData(await r.arrayBuffer());
            buffers.get(job.layer).set(job.midi, buf);
          } catch (e) {
            // One missing sample shouldn't sink the set; that note just
            // keeps using the synth.
            console.warn('Piano sample failed to load:', job.file, e);
          }
          loaded += 1;
          if (loaded % 8 === 0 || loaded === total) emit();
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));

      const any = [...buffers.values()].some(m => m.size > 0);
      if (!any) throw new Error('no samples could be decoded');
      state = 'ready';
      emit();
      return true;
    } catch (e) {
      state = 'error';
      error = e?.message || String(e);
      emit();
      return false;
    } finally {
      loadPromise = null;
    }
  })();

  return loadPromise;
}

// ── Sample selection ─────────────────────────────────────────────────────

function layerFor(velocity) {
  if (!manifest) return null;
  const v = Math.max(1, Math.min(127, velocity));
  for (const layer of manifest.layers) {
    if (v <= layer.maxVelocity) return layer;
  }
  return manifest.layers[manifest.layers.length - 1];
}

// Nearest sampled pitch in this layer. Samples sit every three semitones, so
// the shift is at most one semitone either way.
function nearestSample(layerId, midi) {
  const map = buffers.get(layerId);
  if (!map || map.size === 0) return null;
  if (map.has(midi)) return { midi, buffer: map.get(midi) };
  let best = null;
  let bestDist = Infinity;
  for (const [m, buffer] of map) {
    const d = Math.abs(m - midi);
    if (d < bestDist) { bestDist = d; best = { midi: m, buffer }; }
  }
  return best;
}

// Where this velocity sits inside its layer's band, 0..1. The recordings
// already carry most of the dynamic difference, so this is a gentle trim
// rather than the main volume control.
function bandPosition(layer, velocity) {
  if (!manifest) return 1;
  const i = manifest.layers.indexOf(layer);
  const lo = i > 0 ? manifest.layers[i - 1].maxVelocity : 0;
  const hi = layer.maxVelocity;
  if (hi <= lo) return 1;
  return Math.max(0, Math.min(1, (velocity - lo) / (hi - lo)));
}

// ── Voices ───────────────────────────────────────────────────────────────

function stealOldest() {
  let oldest = null;
  for (const list of voices.values()) {
    for (const v of list) if (!oldest || v.startedAt < oldest.startedAt) oldest = v;
  }
  oldest?.release(0.05);
}

function untrack(midi, voice) {
  const list = voices.get(midi);
  if (!list) return;
  const i = list.indexOf(voice);
  if (i !== -1) { list.splice(i, 1); voiceCount -= 1; }
  if (list.length === 0) voices.delete(midi);
}

export function noteOn(midi, velocity = 80) {
  if (state !== 'ready') return null;
  const ctx = getAudioContext();
  if (!ctx) return null;

  const layer = layerFor(velocity);
  if (!layer) return null;
  const sample = nearestSample(layer.id, midi);
  if (!sample) return null;   // caller falls back to the synth

  const existing = voices.get(midi);
  if (existing) for (const v of [...existing]) v.release(0.03);
  sustained.delete(midi);
  if (voiceCount >= MAX_VOICES) stealOldest();

  const now = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = sample.buffer;
  src.playbackRate.value = Math.pow(2, (midi - sample.midi) / 12);

  const gain = ctx.createGain();
  const level = 0.55 + 0.45 * bandPosition(layer, velocity);
  gain.gain.setValueAtTime(level, now);

  src.connect(gain);
  gain.connect(getMasterGain());
  src.start(now);

  let released = false;
  const voice = {
    midi,
    startedAt: now,
    // Which recording this note is actually using, and by how much it's
    // being shifted. Useful when checking sample coverage.
    sourceMidi: sample.midi,
    playbackRate: src.playbackRate.value,
    layer: layer.id,
    release(time = 0.22) {
      if (released) return;
      released = true;
      untrack(midi, voice);
      const t = ctx.currentTime;
      try {
        gain.gain.cancelScheduledValues(t);
        gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), t);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + time);
        src.stop(t + time + 0.02);
      } catch { /* already stopped */ }
    },
  };

  src.onended = () => {
    untrack(midi, voice);
    try { gain.disconnect(); } catch { /* gone */ }
  };

  let list = voices.get(midi);
  if (!list) { list = []; voices.set(midi, list); }
  list.push(voice);
  voiceCount += 1;
  return voice;
}

export function noteOff(midi) {
  if (sustainOn) { sustained.add(midi); return; }
  const list = voices.get(midi);
  if (!list) return;
  for (const v of [...list]) v.release();
}

export function setSustain(on) {
  sustainOn = !!on;
  if (sustainOn) return;
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

export function playNote(midi, duration, velocity = 80) {
  const voice = noteOn(midi, velocity);
  if (!voice) return null;
  const hold = Math.max(0.05, Number(duration) || 0.05);
  setTimeout(() => {
    if (sustainOn) { sustained.add(midi); return; }
    voice.release();
  }, hold * 1000);
  return voice;
}
