export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const PIANO_MIN = 21;
export const PIANO_MAX = 108;
export const PIANO_KEYS = PIANO_MAX - PIANO_MIN + 1;

export const WHITE_NOTES = [0, 2, 4, 5, 7, 9, 11];
export const BLACK_NOTES = [1, 3, 6, 8, 10];

export const MIDDLE_C = 60;

// What each hand is doing right now. A single "muted" boolean used to
// conflate three unrelated questions — should we draw it, should we sound it,
// should we grade it — which made the most useful practice mode (let the app
// play the left hand while I work on the right) impossible to express.
//
// Cycling order is BOTH -> YOU -> APP -> OFF. Naming is from the player's
// point of view: who is producing the sound for this hand.
export const HAND_MODES = {
  both: { label: 'BOTH', hint: 'You play it; the app plays along',  visible: true,  audible: true,  scored: true },
  you:  { label: 'YOU',  hint: 'You play it; the app stays silent', visible: true,  audible: false, scored: true },
  app:  { label: 'APP',  hint: 'The app plays it; not graded',      visible: true,  audible: true,  scored: false },
  off:  { label: 'OFF',  hint: 'Hidden and silent',                 visible: false, audible: false, scored: false },
};

export const HAND_MODE_ORDER = ['both', 'you', 'app', 'off'];

export function resolveHandMode(mode) {
  return HAND_MODES[mode] || HAND_MODES.both;
}

export function nextHandMode(mode) {
  const i = HAND_MODE_ORDER.indexOf(mode);
  return HAND_MODE_ORDER[(i + 1) % HAND_MODE_ORDER.length];
}

// Judging windows, in seconds either side of a note's start time.
export const TIMING = {
  perfect: 0.05,
  good: 0.12,
  ok: 0.25,      // outside this, a press can't be attributed to the note
};

// Solfège. Fixed do treats C as Do regardless of key; movable do puts Do on
// the tonic, so the same syllable means the same scale degree in any key.
// Chromatic notes take the "raised" form (Di, Ri, Fi, Si, Li) going up.
export const SOLFEGE = ['Do', 'Di', 'Re', 'Ri', 'Mi', 'Fa', 'Fi', 'Sol', 'Si', 'La', 'Li', 'Ti'];

// Sharps in the key signature -> tonic pitch class, for movable do.
// -7..7 maps Cb major through C# major (relative minors share a tonic set).
const MAJOR_TONIC_BY_SHARPS = { '-7': 11, '-6': 6, '-5': 1, '-4': 8, '-3': 3, '-2': 10, '-1': 5, 0: 0, 1: 7, 2: 2, 3: 9, 4: 4, 5: 11, 6: 6, 7: 1 };

export function tonicPitchClass(keySignature) {
  if (!keySignature) return 0;
  const major = MAJOR_TONIC_BY_SHARPS[String(keySignature.sharps)] ?? 0;
  // A minor key's tonic is a minor third below its relative major.
  return keySignature.minor ? (major + 9) % 12 : major;
}

export function solfegeName(midi, { movable = false, keySignature = null } = {}) {
  const tonic = movable ? tonicPitchClass(keySignature) : 0;
  return SOLFEGE[((midi - tonic) % 12 + 12) % 12];
}

export const RATING_COLORS = {
  perfect: '#7ae58a',
  good: '#4dd6c3',
  early: '#e2c05a',
  late: '#e2c05a',
  miss: '#ff6b7a',
};

export const COLORS = {
  rightHand: '#4dd6c3',
  rightHandDim: 'rgba(77,214,195,0.15)',
  rightHandGlow: 'rgba(77,214,195,0.5)',
  leftHand: '#c89dff',
  leftHandDim: 'rgba(200,157,255,0.15)',
  leftHandGlow: 'rgba(200,157,255,0.5)',
  whiteKey: '#eaeef2',
  whiteKeyPressed: '#c9efe9',
  blackKey: '#0a0c0f',
  blackKeyPressed: '#1b4a44',
  bg: '#0a0c0f',
  gridLine: 'rgba(255,255,255,0.03)',
  gridLineBeat: 'rgba(255,255,255,0.07)',
  hitLine: 'rgba(255,255,255,0.15)',
  accent: '#4dd6c3',
  // Recorded take overlay — deliberately neutral so it reads as 'yours'
  // rather than competing with the hand colours.
  takeOutline: 'rgba(255,255,255,0.75)',
  takeFill: 'rgba(255,255,255,0.16)',
  accentBright: '#6ae3d0',
};

export function midiNoteName(midi) {
  const name = NOTE_NAMES[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}
