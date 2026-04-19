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

export function playNote(midiNote, duration, velocity = 80) {
  try {
    const ctx = getCtx();
    const freq = 440 * Math.pow(2, (midiNote - 69) / 12);
    const gain = Math.max(0, Math.min(velocity, 127)) / 127 * 0.12;

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
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(gain, now + 0.01);
    env.gain.exponentialRampToValueAtTime(gain * 0.4, now + Math.min(duration, 0.3));
    env.gain.exponentialRampToValueAtTime(0.001, now + duration + 0.1);

    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(env);
    env.connect(ctx.destination);

    osc.start(now);
    osc2.start(now);
    osc.stop(now + duration + 0.15);
    osc2.stop(now + duration + 0.15);
  } catch {
    // audio unavailable
  }
}
