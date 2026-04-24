import { PIANO_MIN, PIANO_MAX, WHITE_NOTES, BLACK_NOTES } from './constants.js';

// Standard keyboard sizes → MIDI range.
export const KEYBOARD_RANGES = {
  88: { min: 21, max: 108, label: '88 keys (A0–C8)' },   // Full piano
  76: { min: 28, max: 103, label: '76 keys (E1–G7)' },
  61: { min: 36, max: 96,  label: '61 keys (C2–C7)' },
  49: { min: 36, max: 84,  label: '49 keys (C2–C6)' },
  37: { min: 48, max: 84,  label: '37 keys (C3–C6)' },
  25: { min: 60, max: 84,  label: '25 keys (C4–C6)' },
};

export function resolveRange(rangeOrObject) {
  if (rangeOrObject && typeof rangeOrObject === 'object') {
    return { min: rangeOrObject.min ?? PIANO_MIN, max: rangeOrObject.max ?? PIANO_MAX };
  }
  const r = KEYBOARD_RANGES[rangeOrObject];
  return r ? { min: r.min, max: r.max } : { min: PIANO_MIN, max: PIANO_MAX };
}

export function computeKeyLayout(totalWidth, rangeOpt) {
  const { min, max } = resolveRange(rangeOpt);
  const whiteKeyPositions = [];
  const blackKeyPositions = [];
  const allKeyPositions = new Array(128).fill(null);

  let whiteCount = 0;
  for (let n = min; n <= max; n++) {
    if (WHITE_NOTES.includes(n % 12)) whiteCount++;
  }
  if (whiteCount === 0) whiteCount = 1;

  const whiteKeyWidth = totalWidth / whiteCount;
  const blackKeyWidth = whiteKeyWidth * 0.6;

  let wx = 0;
  for (let n = min; n <= max; n++) {
    if (WHITE_NOTES.includes(n % 12)) {
      const pos = { x: wx, w: whiteKeyWidth, note: n, black: false };
      whiteKeyPositions.push(pos);
      allKeyPositions[n] = pos;
      wx += whiteKeyWidth;
    }
  }

  for (let n = min; n <= max; n++) {
    if (BLACK_NOTES.includes(n % 12)) {
      const whiteBelow = allKeyPositions[n - 1];
      if (whiteBelow) {
        const bx = whiteBelow.x + whiteKeyWidth - blackKeyWidth / 2;
        const pos = { x: bx, w: blackKeyWidth, note: n, black: true };
        blackKeyPositions.push(pos);
        allKeyPositions[n] = pos;
      }
    }
  }

  return { whiteKeyPositions, blackKeyPositions, allKeyPositions, whiteKeyWidth, blackKeyWidth, range: { min, max } };
}

export function getNoteX(layout, midiNote) {
  const pos = layout.allKeyPositions[midiNote];
  if (!pos) return null;
  return pos.x + pos.w / 2;
}

export function getNoteWidth(layout, midiNote) {
  const pos = layout.allKeyPositions[midiNote];
  if (!pos) return layout.whiteKeyWidth * 0.8;
  return pos.black ? pos.w * 0.9 : pos.w * 0.82;
}

export function keyAtPoint(layout, x, y, pianoTop, pianoHeight) {
  if (y < pianoTop || y > pianoTop + pianoHeight) return null;

  const blackHeight = pianoHeight * 0.62;
  if (y <= pianoTop + blackHeight) {
    for (const key of layout.blackKeyPositions) {
      if (x >= key.x && x <= key.x + key.w) return key.note;
    }
  }
  for (const key of layout.whiteKeyPositions) {
    if (x >= key.x && x <= key.x + key.w) return key.note;
  }
  return null;
}
