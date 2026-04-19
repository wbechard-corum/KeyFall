export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const PIANO_MIN = 21;
export const PIANO_MAX = 108;
export const PIANO_KEYS = PIANO_MAX - PIANO_MIN + 1;

export const WHITE_NOTES = [0, 2, 4, 5, 7, 9, 11];
export const BLACK_NOTES = [1, 3, 6, 8, 10];

export const MIDDLE_C = 60;

export const COLORS = {
  rightHand: '#4FC3F7',
  rightHandDim: 'rgba(79,195,247,0.15)',
  rightHandGlow: 'rgba(79,195,247,0.4)',
  leftHand: '#FF8A65',
  leftHandDim: 'rgba(255,138,101,0.15)',
  leftHandGlow: 'rgba(255,138,101,0.4)',
  whiteKey: '#e8e8e8',
  whiteKeyPressed: '#b0d8ff',
  blackKey: '#1a1a1e',
  blackKeyPressed: '#2a4a6a',
  bg: '#0c0c0f',
  gridLine: 'rgba(255,255,255,0.03)',
  gridLineBeat: 'rgba(255,255,255,0.07)',
  hitLine: 'rgba(255,255,255,0.15)',
};

export function midiNoteName(midi) {
  const name = NOTE_NAMES[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}
