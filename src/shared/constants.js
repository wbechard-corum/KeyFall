export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const PIANO_MIN = 21;
export const PIANO_MAX = 108;
export const PIANO_KEYS = PIANO_MAX - PIANO_MIN + 1;

export const WHITE_NOTES = [0, 2, 4, 5, 7, 9, 11];
export const BLACK_NOTES = [1, 3, 6, 8, 10];

export const MIDDLE_C = 60;

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
  accentBright: '#6ae3d0',
};

export function midiNoteName(midi) {
  const name = NOTE_NAMES[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}
