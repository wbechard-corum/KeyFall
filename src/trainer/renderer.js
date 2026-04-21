import { COLORS, NOTE_NAMES } from '../shared/constants.js';
import { computeKeyLayout, getNoteX, getNoteWidth } from '../shared/piano-keyboard.js';

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

export function createRenderer(canvas, { min, max } = {}) {
  const ctx = canvas.getContext('2d');
  ensureRoundRect(ctx);
  const state = {
    W: 0,
    H: 0,
    pianoHeight: 0,
    noteAreaHeight: 0,
    layout: null,
    fallTimeSeconds: 3,
    rangeMin: min,
    rangeMax: max,
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
    state.layout = computeKeyLayout(state.W, state.rangeMin, state.rangeMax);
  }

  function setRange(newMin, newMax) {
    state.rangeMin = newMin;
    state.rangeMax = newMax;
    if (state.W > 0) {
      state.layout = computeKeyLayout(state.W, state.rangeMin, state.rangeMax);
    }
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

  function drawNotes(song, currentTime, trackMuted, isPlaying) {
    if (!song) return;
    const pixelsPerSecond = state.noteAreaHeight / state.fallTimeSeconds;
    const viewStart = currentTime - 0.1;
    const viewEnd = currentTime + state.fallTimeSeconds + 0.5;

    for (const note of song.notes) {
      if (note.endTime < viewStart || note.startTime > viewEnd) continue;
      const trackIdx = note.track || 0;
      if (trackMuted[trackIdx]) continue;

      const x = getNoteX(state.layout, note.midi);
      if (x === null) continue;
      const w = getNoteWidth(state.layout, note.midi);
      const isRight = trackIdx === 0;
      const color = isRight ? COLORS.rightHand : COLORS.leftHand;
      const colorGlow = isRight ? COLORS.rightHandGlow : COLORS.leftHandGlow;

      const yBottom = state.noteAreaHeight - (note.startTime - currentTime) * pixelsPerSecond;
      const yTop = state.noteAreaHeight - (note.endTime - currentTime) * pixelsPerSecond;
      const noteH = Math.max(4, yBottom - yTop);

      const isActive = currentTime >= note.startTime && currentTime <= note.endTime;
      const isPast = currentTime > note.endTime;
      if (isPast && !isPlaying) continue;

      const radius = Math.min(4, w / 4, noteH / 4);

      if (isActive) {
        ctx.shadowColor = colorGlow;
        ctx.shadowBlur = 12;
      }

      ctx.fillStyle = isPast ? (note.hit ? 'rgba(102,187,106,0.3)' : 'rgba(255,255,255,0.08)') : color;
      ctx.globalAlpha = isPast ? 0.4 : (isActive ? 1 : 0.85);

      ctx.beginPath();
      ctx.roundRect(x - w / 2, yTop, w, noteH, radius);
      ctx.fill();

      if (!isPast && noteH > 8) {
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.beginPath();
        ctx.roundRect(x - w / 2 + 1, yTop + 1, w - 2, Math.min(4, noteH / 3), radius);
        ctx.fill();
      }

      ctx.globalAlpha = 1;
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;

      if (isActive && noteH > 16) {
        const noteName = NOTE_NAMES[note.midi % 12];
        const octave = Math.floor(note.midi / 12) - 1;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.font = '600 10px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(noteName + octave, x, yTop + noteH / 2);
      }
    }
  }

  function isNoteActive(song, midiNote, currentTime, trackMuted) {
    if (!song) return false;
    for (const note of song.notes) {
      if (note.midi === midiNote && currentTime >= note.startTime && currentTime <= note.endTime) {
        if (!trackMuted[note.track || 0]) return true;
      }
    }
    return false;
  }

  function activeNoteTrack(song, midiNote, currentTime) {
    if (!song) return 0;
    for (const note of song.notes) {
      if (note.midi === midiNote && currentTime >= note.startTime && currentTime <= note.endTime) {
        return note.track || 0;
      }
    }
    return 0;
  }

  function drawPiano(song, currentTime, pressedKeys, trackMuted) {
    const y = state.H - state.pianoHeight;
    ctx.fillStyle = '#0a0a0e';
    ctx.fillRect(0, y, state.W, state.pianoHeight);

    for (const key of state.layout.whiteKeyPositions) {
      const pressed = pressedKeys.has(key.note);
      const active = isNoteActive(song, key.note, currentTime, trackMuted);
      ctx.fillStyle = pressed || active ? COLORS.whiteKeyPressed : COLORS.whiteKey;
      ctx.fillRect(key.x + 0.5, y + 1, key.w - 1, state.pianoHeight - 2);

      if (!pressed && !active) {
        ctx.fillStyle = 'rgba(0,0,0,0.08)';
        ctx.fillRect(key.x + 0.5, y + state.pianoHeight - 6, key.w - 1, 5);
      }

      if (active) {
        const track = activeNoteTrack(song, key.note, currentTime);
        ctx.fillStyle = track === 0 ? COLORS.rightHand : COLORS.leftHand;
        ctx.globalAlpha = 0.25;
        ctx.fillRect(key.x + 0.5, y + 1, key.w - 1, state.pianoHeight - 2);
        ctx.globalAlpha = 1;
      }

      ctx.strokeStyle = '#bbb';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(key.x + 0.5, y + 1, key.w - 1, state.pianoHeight - 2);
    }

    const bkH = state.pianoHeight * 0.62;
    for (const key of state.layout.blackKeyPositions) {
      const pressed = pressedKeys.has(key.note);
      const active = isNoteActive(song, key.note, currentTime, trackMuted);
      ctx.fillStyle = pressed || active ? COLORS.blackKeyPressed : COLORS.blackKey;
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
        const track = activeNoteTrack(song, key.note, currentTime);
        ctx.fillStyle = track === 0 ? COLORS.rightHand : COLORS.leftHand;
        ctx.globalAlpha = 0.35;
        ctx.fillRect(key.x, y, key.w, bkH);
        ctx.globalAlpha = 1;
      }

      ctx.strokeStyle = '#000';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(key.x, y, key.w, bkH);
    }
  }

  function render({ song, currentTime, pressedKeys, trackMuted, isPlaying }) {
    ctx.clearRect(0, 0, state.W, state.H);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, state.W, state.H);

    if (song) {
      drawGrid();
      drawNotes(song, currentTime, trackMuted, isPlaying);
      drawHitLine();
    }
    drawPiano(song, currentTime, pressedKeys, trackMuted);
  }

  return {
    resize,
    render,
    setRange,
    getState: () => state,
  };
}
