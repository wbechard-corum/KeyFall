import { COLORS, NOTE_NAMES, RATING_COLORS, resolveHandMode } from '../shared/constants.js';
import { computeKeyLayout, getNoteX, getNoteWidth } from '../shared/piano-keyboard.js';

const BOTH_HANDS = [resolveHandMode('both'), resolveHandMode('both')];

// Callers may pass resolved hand objects, mode-name strings, or nothing.
function normaliseHands(hands) {
  if (!Array.isArray(hands) || hands.length < 2) return BOTH_HANDS;
  return hands.map(h => (typeof h === 'string' ? resolveHandMode(h) : (h || BOTH_HANDS[0])));
}

// Colour a note that the playhead has already passed. Judged notes get their
// rating colour; unjudged ones (an APP hand, or scoring not applicable) stay
// neutral so the player isn't told they missed something they never owed.
function pastNoteFill(note) {
  if (!note.judged) return 'rgba(255,255,255,0.08)';
  const hex = RATING_COLORS[note.rating] || RATING_COLORS.miss;
  return hexToRgba(hex, note.rating === 'miss' ? 0.22 : 0.32);
}

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

// Safari <15.4 and older browsers lack CanvasRenderingContext2D.roundRect.
function ensureRoundRect(ctx) {
  if (ctx.roundRect) return;
  ctx.roundRect = function (x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    this.moveTo(x + rr, y);
    this.lineTo(x + w - rr, y);
    this.arcTo(x + w, y, x + w, y + rr, rr);
    this.lineTo(x + w, y + h - rr);
    this.arcTo(x + w, y + h, x + w - rr, y + h, rr);
    this.lineTo(x + rr, y + h);
    this.arcTo(x, y + h, x, y + h - rr, rr);
    this.lineTo(x, y + rr);
    this.arcTo(x, y, x + rr, y, rr);
    return this;
  };
}

// Index of the first note with startTime >= t (notes are sorted by startTime).
function lowerBound(notes, t) {
  let lo = 0, hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].startTime < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Longest note in the song, cached on the song object. Tells us how far
// back a binary search has to reach before it can be sure it has seen
// every note that might still be sounding at a given instant.
function maxNoteDuration(song) {
  if (song.__maxNoteDuration === undefined) {
    let max = 0;
    for (const n of song.notes) {
      const d = n.endTime - n.startTime;
      if (d > max) max = d;
    }
    song.__maxNoteDuration = max;
  }
  return song.__maxNoteDuration;
}

// Index of the first note that could still overlap time `t`.
function firstLiveIndex(song, t) {
  return lowerBound(song.notes, t - maxNoteDuration(song));
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  ensureRoundRect(ctx);
  const state = {
    W: 0,
    H: 0,
    pianoHeight: 0,
    noteAreaHeight: 0,
    layout: null,
    fallTimeSeconds: 3,
    keyboardRange: 88,
    // Configurable colors. Null for C-key means use the regular white.
    colors: {
      cKey: null,
      white: COLORS.whiteKey,
      black: COLORS.blackKey,
      right: COLORS.rightHand,
      left: COLORS.leftHand,
    },
    // 'none' | 'c-only' | 'all'
    labelMode: 'c-only',
  };

  function resize() {
    const wrap = canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    state.W = wrap.clientWidth;
    state.H = wrap.clientHeight;
    canvas.width = state.W * dpr;
    canvas.height = state.H * dpr;
    canvas.style.width = state.W + 'px';
    canvas.style.height = state.H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    state.pianoHeight = Math.min(120, state.H * 0.18);
    state.noteAreaHeight = state.H - state.pianoHeight;
    state.layout = computeKeyLayout(state.W, state.keyboardRange);
  }

  function setKeyboardRange(range) {
    state.keyboardRange = range;
    if (state.W) state.layout = computeKeyLayout(state.W, state.keyboardRange);
  }

  function setColors(next = {}) {
    Object.assign(state.colors, next);
  }

  function setLabelMode(mode) {
    state.labelMode = mode;
  }

  // How many seconds of upcoming music fill the note area. Strongly personal:
  // a short window makes notes fall fast and read clearly, a long one gives
  // more warning but compresses everything.
  function setFallTime(seconds) {
    const v = Number(seconds);
    if (Number.isFinite(v) && v > 0) state.fallTimeSeconds = Math.max(1, Math.min(10, v));
  }

  function drawGrid() {
    const pixelsPerSecond = state.noteAreaHeight / state.fallTimeSeconds;
    const beatDuration = 0.5;
    for (let t = 0; t < state.fallTimeSeconds; t += beatDuration) {
      const y = state.noteAreaHeight - t * pixelsPerSecond;
      ctx.strokeStyle = t % 2 === 0 ? COLORS.gridLineBeat : COLORS.gridLine;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(state.W, y);
      ctx.stroke();
    }
  }

  function drawHitLine() {
    const y = state.noteAreaHeight;
    ctx.strokeStyle = COLORS.hitLine;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(state.W, y);
    ctx.stroke();

    const grad = ctx.createLinearGradient(0, y - 8, 0, y + 2);
    grad.addColorStop(0, 'transparent');
    grad.addColorStop(1, 'rgba(255,255,255,0.05)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, y - 8, state.W, 10);
  }

  function drawNotes(song, currentTime, hands, isPlaying) {
    if (!song || song.notes.length === 0) return;
    const pixelsPerSecond = state.noteAreaHeight / state.fallTimeSeconds;
    const viewStart = currentTime - 0.1;
    const viewEnd = currentTime + state.fallTimeSeconds + 0.5;

    // Seek to the first note that could still be on screen and stop at the
    // first one past the top edge, instead of walking the whole song.
    const notes = song.notes;
    for (let i = firstLiveIndex(song, viewStart); i < notes.length; i++) {
      const note = notes[i];
      if (note.startTime > viewEnd) break;
      if (note.endTime < viewStart) continue;
      const trackIdx = note.track || 0;
      if (!hands[trackIdx].visible) continue;

      const x = getNoteX(state.layout, note.midi);
      if (x === null) continue;
      const w = getNoteWidth(state.layout, note.midi);
      const isRight = trackIdx === 0;
      const color = isRight ? state.colors.right : state.colors.left;

      const yBottom = state.noteAreaHeight - (note.startTime - currentTime) * pixelsPerSecond;
      const yTop = state.noteAreaHeight - (note.endTime - currentTime) * pixelsPerSecond;
      const noteH = Math.max(4, yBottom - yTop);

      const isActive = currentTime >= note.startTime && currentTime <= note.endTime;
      const isPast = currentTime > note.endTime;
      if (isPast && !isPlaying) continue;

      const radius = Math.min(4, w / 4, noteH / 4);
      const noteX = x - w / 2;

      // Hit glow under the bar while it crosses the playhead.
      if (isActive) {
        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur = 18;
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.roundRect(noteX - 3, yTop - 2, w + 6, noteH + 4, radius + 2);
        ctx.fill();
        ctx.restore();
      }

      ctx.fillStyle = isPast ? pastNoteFill(note) : color;
      ctx.globalAlpha = isPast ? 0.55 : (isActive ? 1 : 0.92);

      ctx.beginPath();
      ctx.roundRect(noteX, yTop, w, noteH, radius);
      ctx.fill();

      // A judged note keeps a thin rating-coloured edge so hits and misses
      // stay legible after the fill has faded out.
      if (isPast && note.judged) {
        ctx.strokeStyle = RATING_COLORS[note.rating] || RATING_COLORS.miss;
        ctx.globalAlpha = note.rating === 'miss' ? 0.55 : 0.7;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(noteX, yTop, w, noteH, radius);
        ctx.stroke();
      }

      if (!isPast && noteH > 8) {
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.beginPath();
        ctx.roundRect(noteX + 2, yTop + 2, Math.max(0, w - 4), Math.max(0, Math.min(4, noteH / 3)), Math.max(0, radius - 1));
        ctx.fill();
      }

      ctx.globalAlpha = 1;

      // Crisp outline on the active note (on top of fill) to
      // match the design spec's "hit" frame.
      if (isActive) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.roundRect(noteX - 1.5, yTop - 1, w + 3, noteH + 2, radius + 1);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Falling-note labels are always on — knowing the upcoming
      // pitch is the whole point of the trainer. Piano-key labels
      // honour state.labelMode separately (in drawPiano).
      const pc = note.midi % 12;
      if (!isPast && noteH > 14 && w > 14) {
        const noteName = NOTE_NAMES[pc];
        const octave = Math.floor(note.midi / 12) - 1;
        ctx.fillStyle = isActive ? 'rgba(0,0,0,0.75)' : 'rgba(0,0,0,0.6)';
        ctx.font = '600 10px "IBM Plex Mono", ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const labelY = Math.min(yTop + noteH / 2, yBottom - 8);
        ctx.fillText(pc === 0 ? noteName + octave : noteName, x, labelY);
      }
    }
  }

  // midi note → track index, for every note sounding at `currentTime`.
  // Built once per frame. Previously drawPiano called two whole-song scans
  // per key, so a 5,000-note song did 1.7M comparisons every frame just to
  // decide which keys to light up.
  function computeActiveNotes(song, currentTime, hands) {
    const active = new Map();
    if (!song || song.notes.length === 0) return active;
    const notes = song.notes;
    for (let i = firstLiveIndex(song, currentTime); i < notes.length; i++) {
      const note = notes[i];
      if (note.startTime > currentTime) break;
      if (note.endTime < currentTime) continue;
      if (!hands[note.track === 1 ? 1 : 0].visible) continue;
      if (!active.has(note.midi)) active.set(note.midi, note.track || 0);
    }
    return active;
  }

  function drawPiano(song, currentTime, pressedKeys, keyVelocity, activeNotes) {
    const y = state.H - state.pianoHeight;
    ctx.fillStyle = '#0a0c0f';
    ctx.fillRect(0, y, state.W, state.pianoHeight);

    function velocityGlow(note) {
      const v = keyVelocity?.get?.(note) ?? (keyVelocity?.[note] ?? 100);
      return 0.35 + 0.65 * Math.max(0, Math.min(1, v / 127));
    }

    const cKey = state.colors.cKey;
    const whiteBase = state.colors.white || COLORS.whiteKey;
    const blackBase = state.colors.black || COLORS.blackKey;
    const rightC = state.colors.right || COLORS.rightHand;
    const leftC = state.colors.left || COLORS.leftHand;

    for (const key of state.layout.whiteKeyPositions) {
      const pressed = pressedKeys.has(key.note);
      const active = activeNotes.has(key.note);
      const isC = (key.note % 12) === 0;
      const baseFill = isC && cKey ? cKey : whiteBase;
      ctx.fillStyle = pressed || active ? COLORS.whiteKeyPressed : baseFill;
      ctx.fillRect(key.x + 0.5, y + 1, key.w - 1, state.pianoHeight - 2);

      if (!pressed && !active) {
        ctx.fillStyle = 'rgba(0,0,0,0.08)';
        ctx.fillRect(key.x + 0.5, y + state.pianoHeight - 6, key.w - 1, 5);
      }

      if (active) {
        ctx.fillStyle = activeNotes.get(key.note) === 0 ? rightC : leftC;
        ctx.globalAlpha = 0.3;
        ctx.fillRect(key.x + 0.5, y + 1, key.w - 1, state.pianoHeight - 2);
        ctx.globalAlpha = 1;
      }

      if (pressed) {
        ctx.fillStyle = COLORS.accent;
        ctx.globalAlpha = 0.15 + 0.55 * velocityGlow(key.note);
        ctx.fillRect(key.x + 0.5, y + 1, key.w - 1, state.pianoHeight - 2);
        ctx.globalAlpha = 1;
      }

      // Piano key labels: honour labelMode for pitch-class labels;
      // always show octave number on Cs (so range is legible).
      const pc = key.note % 12;
      const octave = Math.floor(key.note / 12) - 1;
      let keyLabel = null;
      if (state.labelMode === 'all') {
        keyLabel = pc === 0 ? `C${octave}` : NOTE_NAMES[pc];
      } else if (state.labelMode === 'c-only' && pc === 0) {
        keyLabel = `C${octave}`;
      }
      if (keyLabel && key.w > 12) {
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.font = `600 ${Math.min(10, key.w * 0.5)}px "IBM Plex Mono", ui-monospace, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(keyLabel, key.x + key.w / 2, y + state.pianoHeight - 8);
      }

      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(key.x + 0.5, y + 1, key.w - 1, state.pianoHeight - 2);
    }

    const bkH = state.pianoHeight * 0.62;
    for (const key of state.layout.blackKeyPositions) {
      const pressed = pressedKeys.has(key.note);
      const active = activeNotes.has(key.note);
      ctx.fillStyle = pressed || active ? COLORS.blackKeyPressed : blackBase;
      ctx.fillRect(key.x, y, key.w, bkH);

      if (!pressed && !active) {
        const grad = ctx.createLinearGradient(0, y, 0, y + bkH);
        grad.addColorStop(0, 'rgba(80,80,80,0.3)');
        grad.addColorStop(0.3, 'transparent');
        grad.addColorStop(1, 'rgba(0,0,0,0.2)');
        ctx.fillStyle = grad;
        ctx.fillRect(key.x, y, key.w, bkH);
      }

      if (active) {
        ctx.fillStyle = activeNotes.get(key.note) === 0 ? rightC : leftC;
        ctx.globalAlpha = 0.4;
        ctx.fillRect(key.x, y, key.w, bkH);
        ctx.globalAlpha = 1;
      }

      if (pressed) {
        ctx.fillStyle = COLORS.accent;
        ctx.globalAlpha = 0.2 + 0.6 * velocityGlow(key.note);
        ctx.fillRect(key.x, y, key.w, bkH);
        ctx.globalAlpha = 1;
      }

      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(key.x, y, key.w, bkH);
    }
  }

  function render({ song, currentTime, pressedKeys, hands, isPlaying, keyVelocity }) {
    const handState = normaliseHands(hands);
    ctx.clearRect(0, 0, state.W, state.H);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, state.W, state.H);

    const activeNotes = computeActiveNotes(song, currentTime, handState);

    if (song) {
      drawGrid();
      drawNotes(song, currentTime, handState, isPlaying);
      drawHitLine();
    }
    drawPiano(song, currentTime, pressedKeys, keyVelocity, activeNotes);
  }

  return {
    resize,
    render,
    setKeyboardRange,
    setColors,
    setLabelMode,
    setFallTime,
    getState: () => state,
  };
}
