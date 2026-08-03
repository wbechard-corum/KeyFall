let audioCtx = null;

function getCtx() {
  if (!audioCtx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    audioCtx = new Ctor();
  }
  return audioCtx;
}

export function resume() {
  try { getCtx().resume(); } catch { /* no audio available */ }
}

// Hard cap on simultaneous voices. Dense MIDI (orchestral transcriptions,
// sustained pedal passages) could otherwise spawn hundreds of oscillators
// at once, which both clips into distortion and starves the audio thread.
const MAX_VOICES = 24;
let liveVoices = 0;

export function playNote(midiNote, duration, velocity = 80) {
  try {
    if (liveVoices >= MAX_VOICES) return;
    const ctx = getCtx();
    const freq = 440 * Math.pow(2, (midiNote - 69) / 12);
    // A zero gain would make the exponential ramps below throw, and a
    // non-positive duration would schedule envelope points out of order.
    const gain = Math.max(0.0005, Math.min(velocity, 127) / 127 * 0.12);
    const dur = Math.max(0.05, Number(duration) || 0.05);

    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const env = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = 'triangle';
    osc.frequency.value = freq;

    osc2.type = 'sine';
    osc2.frequency.value = freq;
    osc2.detune.value = 3;

    filter.type = 'lowpass';
    filter.frequency.value = Math.min(8000, freq * 4);

    const now = ctx.currentTime;
    const attack = Math.min(0.01, dur / 4);
    const decayAt = now + Math.max(attack + 0.001, Math.min(dur, 0.3));
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(gain, now + attack);
    env.gain.exponentialRampToValueAtTime(gain * 0.4, decayAt);
    env.gain.exponentialRampToValueAtTime(0.0001, now + dur + 0.1);

    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(env);
    env.connect(ctx.destination);

    const stopAt = now + dur + 0.15;
    liveVoices++;
    osc.onended = () => {
      liveVoices = Math.max(0, liveVoices - 1);
      // Detach so the nodes are collectable instead of piling up on the
      // destination for the lifetime of the page.
      try { env.disconnect(); filter.disconnect(); } catch { /* already gone */ }
    };

    osc.start(now);
    osc2.start(now);
    osc.stop(stopAt);
    osc2.stop(stopAt);
  } catch {
    // audio unavailable
  }
}
