export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const PIANO_MIN = 21;   // A0 (full grand piano low)
export const PIANO_MAX = 108;  // C8 (full grand piano high)

export const WHITE_NOTES = [0, 2, 4, 5, 7, 9, 11];
export const BLACK_NOTES = [1, 3, 6, 8, 10];

export const MIDDLE_C = 60;

// Standard on-screen keyboard range presets (label → { min, max }).
// Ranges chosen to match the most common hardware keyboard sizes.
export const PIANO_RANGES = [
  { id: '88', label: '88 keys (A0–C8)',    min: 21,  max: 108 },
  { id: '76', label: '76 keys (E1–G7)',    min: 28,  max: 103 },
  { id: '61', label: '61 keys (C2–C7)',    min: 36,  max: 96  },
  { id: '49', label: '49 keys (C2–C6)',    min: 36,  max: 84  },
  { id: '37', label: '37 keys (C3–C6)',    min: 48,  max: 84  },
  { id: '25', label: '25 keys (C4–C6)',    min: 60,  max: 84  },
];

export function getRangeById(id) {
  return PIANO_RANGES.find(r => r.id === id) || PIANO_RANGES[0];
}

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
