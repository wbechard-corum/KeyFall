const KEY = 'keyfall.settings';

const DEFAULTS = {
  mode: 'trainer',
  midiChannel: 0,
  selectedDeviceId: null,
  selectedProfileId: null,
  theme: 'dark',
  trainerMidiOut: false,
  keyboardRange: 88,

  // Practice state, remembered between sessions.
  waitMode: false,
  handModes: ['both', 'both'],   // [right, left] — see HAND_MODES
  metronome: false,
  beatsPerBar: 4,
  countInBars: 0,                // 0 = start immediately
  lookAheadSeconds: 3,           // height of the falling-note window
  inputLatencyMs: 0,             // positive = your input arrives late

  // Colors are configurable in the top-level Settings tab. Null for
  // cKeyColor means Cs look like any other white.
  cKeyColor: '#4dd6c3',
  whiteKeyColor: '#eaeef2',
  blackKeyColor: '#0a0c0f',
  rightHandColor: '#4dd6c3',
  leftHandColor: '#c89dff',

  // 'none' | 'c-only' | 'all'
  labelMode: 'c-only',
};

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function write(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable (private mode, etc.) — ignore.
  }
}

let current = read();

const listeners = new Set();

export function getSettings() {
  return { ...current };
}

export function getSetting(key) {
  return current[key];
}

export function updateSettings(patch) {
  current = { ...current, ...patch };
  write(current);
  for (const fn of listeners) {
    try { fn({ ...current }, patch); } catch (e) { console.error('settings listener error:', e); }
  }
  return { ...current };
}

export function onSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
