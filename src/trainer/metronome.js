import { getAudioContext, getMasterGain } from './audio-context.js';

// Click track and count-in.
//
// Beat positions come from the song's own tempo map, so the metronome stays
// locked to the score through tempo changes rather than assuming a constant
// BPM. Clicks are scheduled a little ahead of the playhead — scheduling them
// exactly on time would put them at the mercy of frame jitter, which is very
// audible on a click.

const LOOKAHEAD = 0.15;     // seconds of clicks to schedule in advance

function click(when, { accent = false } = {}) {
  const c = getAudioContext();
  if (!c) return;
  const master = getMasterGain();
  const t = Math.max(when, c.currentTime);

  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'square';
  osc.frequency.value = accent ? 1600 : 1100;

  const peak = accent ? 0.22 : 0.13;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + 0.001);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);

  // Take the edge off the square wave so it reads as a woodblock, not a beep.
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = accent ? 4200 : 3200;

  osc.connect(lp); lp.connect(gain); gain.connect(master);
  osc.start(t);
  osc.stop(t + 0.06);
  osc.onended = () => { try { gain.disconnect(); lp.disconnect(); } catch { /* gone */ } };
}

// Seconds per beat at a given song position, read from the tempo map the
// parser built. Falls back to 120bpm for demo songs, which have no map.
export function secondsPerBeatAt(song, timeSec) {
  const map = song?.tempoMap;
  if (!Array.isArray(map) || map.length === 0) return 0.5;
  let entry = map[0];
  for (const e of map) {
    if (e.time <= timeSec + 1e-9) entry = e;
    else break;
  }
  return (entry.tempo || 500000) / 1_000_000;
}

// Beat grid for a song: every beat time from 0 to `until`.
export function beatTimes(song, until) {
  const out = [];
  if (!song) return out;
  let t = 0;
  let guard = 0;
  while (t <= until && guard++ < 100000) {
    out.push(t);
    t += secondsPerBeatAt(song, t);
  }
  return out;
}

export function createMetronome() {
  let enabled = false;
  let beatsPerBar = 4;
  let nextBeatIndex = 0;
  let lastPosition = 0;

  function setEnabled(on) {
    enabled = !!on;
    if (!enabled) nextBeatIndex = 0;
  }

  function setBeatsPerBar(n) {
    const v = Number(n);
    beatsPerBar = Number.isFinite(v) && v >= 1 ? Math.floor(v) : 4;
  }

  function isEnabled() { return enabled; }
  function getBeatsPerBar() { return beatsPerBar; }

  // Re-aim the scheduler after a seek, a loop wrap or a stop.
  function resync(song, position) {
    lastPosition = position;
    nextBeatIndex = 0;
    if (!song) return;
    let t = 0, i = 0;
    while (t < position - 1e-9 && i < 100000) {
      t += secondsPerBeatAt(song, t);
      i += 1;
    }
    nextBeatIndex = i;
  }

  // Called each frame. `position` is the playhead in song time; `audioNow`
  // and `speed` translate song time into audio-clock time.
  function schedule(song, position, speed = 1) {
    if (!enabled || !song) { lastPosition = position; return; }
    const c = getAudioContext();
    if (!c) return;

    // A jump (seek or loop wrap) invalidates the beat cursor.
    if (position < lastPosition - 0.05 || position > lastPosition + 0.5) {
      resync(song, position);
    }
    lastPosition = position;

    const horizon = position + LOOKAHEAD * (speed || 1);
    let beatTime = beatTimeOf(song, nextBeatIndex);
    let guard = 0;
    while (beatTime <= horizon && guard++ < 64) {
      if (beatTime >= position - 0.02) {
        const delay = Math.max(0, (beatTime - position) / (speed || 1));
        click(c.currentTime + delay, { accent: nextBeatIndex % beatsPerBar === 0 });
      }
      nextBeatIndex += 1;
      beatTime = beatTimeOf(song, nextBeatIndex);
    }
  }

  // Walking the map from zero each frame would be O(beats); cache the last
  // answer so the common case (the next beat) is a single step.
  let cacheSong = null, cacheIndex = 0, cacheTime = 0;
  function beatTimeOf(song, index) {
    if (cacheSong !== song || index < cacheIndex) {
      cacheSong = song; cacheIndex = 0; cacheTime = 0;
    }
    while (cacheIndex < index) {
      cacheTime += secondsPerBeatAt(song, cacheTime);
      cacheIndex += 1;
    }
    return cacheTime;
  }

  // Count the player in before playback starts. Resolves when the last click
  // has sounded; the caller starts the song then.
  function countIn(song, position, bars = 1) {
    return new Promise((resolve) => {
      const c = getAudioContext();
      const beats = Math.max(1, Math.round(beatsPerBar * bars));
      if (!c) { resolve(); return; }
      const spb = secondsPerBeatAt(song, position);
      const start = c.currentTime + 0.08;
      for (let i = 0; i < beats; i++) {
        click(start + i * spb, { accent: i % beatsPerBar === 0 });
      }
      const total = (start + beats * spb - c.currentTime) * 1000;
      setTimeout(resolve, Math.max(0, total));
    });
  }

  return {
    setEnabled, isEnabled,
    setBeatsPerBar, getBeatsPerBar,
    schedule, resync, countIn,
  };
}
