import { resolveHandMode, nextHandMode } from '../shared/constants.js';
import { createScorer } from './scoring.js';

export function createPlayback({ onTick, onEnded, onPlayStateChange, onWaitChange, onScoreChange, onLoopChange }) {
  // Notes that start within CHORD_EPS seconds of each other count
  // as one chord and must all be played before time advances.
  const CHORD_EPS = 0.03;
  const WAIT_WINDOW = 0.05;
  // Largest clock step we'll honour in a single frame. Backgrounding the
  // tab stops requestAnimationFrame; without this the first frame back
  // carries the whole gap and the playhead teleports seconds ahead.
  const MAX_FRAME_DT = 0.1;
  // How far behind the playhead the wait/keypress scans still look. Must
  // exceed every lookback below so the scan cursor never skips a live note.
  const SCAN_BACK = 0.3;

  const state = {
    song: null,
    isPlaying: false,
    currentTime: 0,
    playSpeed: 1,
    waitMode: false,
    waitingForNote: null,         // first unhit note in the active chord (legacy)
    waitingForChord: null,        // [note, …] — every note that must be pressed
    // Per hand: 0 = right, 1 = left. See HAND_MODES in shared/constants.js.
    handModes: ['both', 'both'],
    // Section repeat. Both ends must be set for the loop to engage.
    loopStart: null,
    loopEnd: null,
    loopEnabled: false,
    loopCount: 0,
    lastFrameTime: 0,
    animFrameId: null,
    // Cursors into song.notes (sorted by startTime). They turn what used to
    // be a full-array walk on every frame into an amortised O(1) step.
    emitIndex: 0,                 // next note not yet handed to audio
    scanIndex: 0,                 // first note still near enough to matter
  };

  const scorer = createScorer();

  const handOf = (note) => (note.track === 1 ? 1 : 0);
  const modeOf = (note) => resolveHandMode(state.handModes[handOf(note)]);
  const isVisible = (note) => modeOf(note).visible;
  const isAudible = (note) => modeOf(note).audible;
  const isScored  = (note) => modeOf(note).scored;

  // Renderers and the mirror protocol want a plain per-hand view.
  function handStates() {
    return state.handModes.map(m => ({ mode: m, ...resolveHandMode(m) }));
  }

  function emitScore() {
    onScoreChange?.(scorer.snapshot());
  }

  // Index of the first note with startTime >= t.
  function lowerBound(notes, t) {
    let lo = 0, hi = notes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (notes[mid].startTime < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  function resetCursors() {
    const notes = state.song?.notes;
    if (!notes) { state.emitIndex = 0; state.scanIndex = 0; return; }
    state.emitIndex = lowerBound(notes, state.currentTime);
    state.scanIndex = lowerBound(notes, state.currentTime - SCAN_BACK);
  }

  function advanceScanCursor() {
    const notes = state.song?.notes;
    if (!notes) return;
    const cutoff = state.currentTime - SCAN_BACK;
    while (state.scanIndex < notes.length && notes[state.scanIndex].startTime < cutoff) {
      state.scanIndex++;
    }
  }

  function clearWait() {
    state.waitingForNote = null;
    state.waitingForChord = null;
    onWaitChange?.(null);
  }

  function setSong(song) {
    state.song = song;
    state.currentTime = 0;
    clearWait();
    resetNoteState(song);
    resetCursors();
  }

  function setSpeed(v) { state.playSpeed = Number(v) || 1; }

  function setWaitMode(enabled) {
    state.waitMode = !!enabled;
    if (!state.waitMode) clearWait();
  }

  // ── Section repeat ──────────────────────────────────────────────────────
  // Practising four hard bars on repeat is the core piano workflow, so the
  // loop is a first-class part of the clock rather than a UI-driven seek.

  function hasLoop() {
    return state.loopEnabled
      && state.loopStart !== null && state.loopEnd !== null
      && state.loopEnd > state.loopStart;
  }

  function setLoopPoint(which, seconds) {
    if (!state.song) return;
    const t = Math.max(0, Math.min(state.song.duration, Number(seconds) || 0));
    if (which === 'start') state.loopStart = t;
    else state.loopEnd = t;
    // Keep the pair ordered however the user dropped them.
    if (state.loopStart !== null && state.loopEnd !== null && state.loopEnd < state.loopStart) {
      const swap = state.loopStart;
      state.loopStart = state.loopEnd;
      state.loopEnd = swap;
    }
    // Setting both ends arms the loop; the user shouldn't have to also
    // remember to switch it on.
    if (state.loopStart !== null && state.loopEnd !== null) state.loopEnabled = true;
    onLoopChange?.(loopState());
  }

  function clearLoop() {
    state.loopStart = null;
    state.loopEnd = null;
    state.loopEnabled = false;
    state.loopCount = 0;
    onLoopChange?.(loopState());
  }

  function setLoopEnabled(on) {
    state.loopEnabled = !!on && state.loopStart !== null && state.loopEnd !== null;
    onLoopChange?.(loopState());
  }

  function loopState() {
    return {
      start: state.loopStart,
      end: state.loopEnd,
      enabled: state.loopEnabled,
      active: hasLoop(),
      count: state.loopCount,
    };
  }

  // Jump back to the loop start, clearing judgement for the section so each
  // pass is scored fresh rather than inheriting the previous run's misses.
  function wrapLoop() {
    state.loopCount += 1;
    state.currentTime = state.loopStart;
    clearWait();
    const notes = state.song?.notes;
    if (notes) {
      for (const n of notes) {
        if (n.startTime >= state.loopStart - 0.001 && n.startTime <= state.loopEnd + 0.001) {
          n.played = false;
          n.judged = false;
          n.hit = false;
          n.rating = null;
          n.timingError = 0;
        }
      }
    }
    resetCursors();
    onLoopChange?.(loopState());
  }

  function resetNoteState(song) {
    if (!song) return;
    song.notes.forEach(n => { n.played = false; });
    scorer.resetSong(song);
    scorer.reset();
    emitScore();
  }

  function setHandMode(idx, mode) {
    if (idx !== 0 && idx !== 1) return state.handModes[0];
    state.handModes[idx] = resolveHandMode(mode) === undefined ? 'both' : mode;
    return state.handModes[idx];
  }

  function cycleHandMode(idx) {
    if (idx !== 0 && idx !== 1) return 'both';
    state.handModes[idx] = nextHandMode(state.handModes[idx]);
    return state.handModes[idx];
  }

  function getHandMode(idx) {
    return state.handModes[idx] ?? 'both';
  }

  function play() {
    if (!state.song || state.isPlaying) return;
    // Starting playback with the playhead outside an armed loop should drop
    // you into the section, not play the rest of the piece once.
    if (hasLoop() && (state.currentTime < state.loopStart || state.currentTime >= state.loopEnd)) {
      state.currentTime = state.loopStart;
      resetCursors();
    }
    state.isPlaying = true;
    state.lastFrameTime = performance.now();
    onPlayStateChange?.(true);
    tick();
  }

  function pause() {
    if (!state.isPlaying) return;
    state.isPlaying = false;
    if (state.animFrameId) cancelAnimationFrame(state.animFrameId);
    state.animFrameId = null;
    onPlayStateChange?.(false);
  }

  function stop() {
    pause();
    // Stopping inside a loop returns to the section's start, not to the top
    // of the piece — otherwise STOP would silently drop you out of the loop.
    state.currentTime = hasLoop() ? state.loopStart : 0;
    state.loopCount = 0;
    resetNoteState(state.song);
    clearWait();
    resetCursors();
    onTick?.({ currentTime: state.currentTime, song: state.song });
  }

  function seek(seconds) {
    if (!state.song) return;
    state.currentTime = Math.max(0, Math.min(state.song.duration, seconds));
    resetNoteState(state.song);
    clearWait();
    resetCursors();
    onTick?.({ currentTime: state.currentTime, song: state.song });
  }

  function seekPct(pct) {
    if (!state.song) return;
    seek(pct * state.song.duration);
  }

  function tick() {
    if (!state.isPlaying) return;
    if (!state.song) { pause(); return; }
    const now = performance.now();
    const dt = Math.min(MAX_FRAME_DT, (now - state.lastFrameTime) / 1000);
    state.lastFrameTime = now;

    if (state.waitMode && hasUnhitChord()) {
      onTick?.({ currentTime: state.currentTime, song: state.song, waitingFor: state.waitingForNote });
      state.animFrameId = requestAnimationFrame(tick);
      return;
    }

    state.currentTime += dt * state.playSpeed;

    emitDueNotes();
    advanceScanCursor();

    // Anything whose window has closed unplayed counts as a miss. Wait mode
    // stalls the playhead at each chord, so nothing can time out there.
    if (!state.waitMode) {
      if (scorer.sweepMissed(state.song, state.currentTime, state.scanIndex, isScored) > 0) {
        emitScore();
      }
    }

    if (state.waitMode) checkWait();

    // Wrap before the end-of-song check so a loop that ends at the very end
    // of the piece repeats instead of finishing the run.
    if (hasLoop() && state.currentTime >= state.loopEnd) {
      wrapLoop();
      onTick?.({ currentTime: state.currentTime, song: state.song, waitingFor: state.waitingForNote });
      state.animFrameId = requestAnimationFrame(tick);
      return;
    }

    if (state.currentTime >= state.song.duration + 1) {
      stop();
      onEnded?.();
      return;
    }

    onTick?.({ currentTime: state.currentTime, song: state.song, waitingFor: state.waitingForNote });
    state.animFrameId = requestAnimationFrame(tick);
  }

  function hasUnhitChord() {
    return !!(state.waitingForChord && state.waitingForChord.some(n => !n.hit));
  }

  function emitDueNotes() {
    const notes = state.song?.notes;
    if (!notes) return;
    // Walk the cursor forward over everything the playhead has passed.
    // The old version only emitted notes inside a fixed 50ms window, so a
    // single long frame (GC pause, tab throttling, a heavy sheet re-render)
    // stepped straight over notes and they never sounded at all.
    while (state.emitIndex < notes.length && notes[state.emitIndex].startTime <= state.currentTime) {
      const note = notes[state.emitIndex++];
      if (note.played) continue;
      note.played = true;
      if (isAudible(note)) {
        notePlayListeners.forEach(fn => fn(note));
      }
    }
  }

  function buildChordAround(seedNote) {
    // Notes are sorted by startTime; collect the contiguous run
    // whose startTime is within CHORD_EPS of seedNote.startTime
    // and that the user is supposed to play.
    const notes = state.song.notes;
    const chord = [];
    for (let i = state.scanIndex; i < notes.length; i++) {
      const note = notes[i];
      if (note.startTime > seedNote.startTime + CHORD_EPS) break;
      if (note.hit) continue;
      if (!isScored(note)) continue;
      if (note.startTime < seedNote.startTime - CHORD_EPS) continue;
      chord.push(note);
    }
    return chord;
  }

  function checkWait() {
    if (!state.song) return;
    if (hasUnhitChord()) return;  // already waiting on a chord
    // Find the next unhit note that's reached the wait window.
    const notes = state.song.notes;
    let seed = null;
    for (let i = state.scanIndex; i < notes.length; i++) {
      const note = notes[i];
      if (note.startTime > state.currentTime + WAIT_WINDOW) break;
      if (note.hit || !isScored(note)) continue;
      if (note.startTime < state.currentTime - WAIT_WINDOW) continue;
      seed = note;
      break;
    }
    if (!seed) return;
    const chord = buildChordAround(seed);
    if (chord.length === 0) return;
    state.waitingForChord = chord;
    state.waitingForNote = chord[0];
    onWaitChange?.(state.waitingForNote);
  }

  function advanceIfChordComplete() {
    if (!state.waitingForChord) return;
    const remaining = state.waitingForChord.filter(n => !n.hit);
    if (remaining.length === 0) {
      // Whole chord played — fast-forward time to the chord's
      // start so the playhead doesn't visually lag the press.
      const chordTime = state.waitingForChord[0].startTime;
      if (state.currentTime < chordTime) state.currentTime = chordTime;
      clearWait();
      return;
    }
    // Still waiting on at least one note — surface the next unhit
    // one as the visible "expected" note for renderers/UI hints.
    state.waitingForNote = remaining[0];
    onWaitChange?.(state.waitingForNote);
  }

  function reportKeyPress(midiNote) {
    if (!state.song) return;

    // Free play: no chord stalling, just grade the press. This path did not
    // exist before — with wait mode off nothing was ever scored.
    if (!state.waitMode) {
      scorer.judgePress(state.song, midiNote, state.currentTime, state.scanIndex, isScored);
      emitScore();
      return;
    }

    // If a chord is already active, see if this press fits.
    if (state.waitingForChord) {
      const match = state.waitingForChord.find(n => n.midi === midiNote && !n.hit);
      if (match) {
        // Restrict the search to this exact note so a same-pitch note
        // elsewhere in the window can't be claimed instead.
        scorer.judgePress(state.song, midiNote, match.startTime, state.scanIndex,
                          (n) => n === match, { assisted: true });
        emitScore();
        advanceIfChordComplete();
        return;
      }
      // Pressed a key that isn't in the active chord — ignore;
      // user will retry. Don't drop into the slow path because
      // that could partially-mark a *different* upcoming chord.
      return;
    }
    // No active chord — race between user press and the next tick
    // calling checkWait. Find a matching upcoming note, build a
    // chord around it, mark the pressed note hit, and either
    // advance immediately (single-note chord) or set waiting state.
    const lookBack = 0.1;
    const lookAhead = 0.25;
    const notes = state.song.notes;
    let matchNote = null;
    for (let i = state.scanIndex; i < notes.length; i++) {
      const note = notes[i];
      if (note.startTime > state.currentTime + lookAhead) break;
      if (note.hit || !isScored(note)) continue;
      if (note.startTime < state.currentTime - lookBack) continue;
      if (note.midi === midiNote) { matchNote = note; break; }
    }
    if (!matchNote) return;
    const chord = buildChordAround(matchNote);
    scorer.judgePress(state.song, midiNote, matchNote.startTime, state.scanIndex,
                      (n) => n === matchNote, { assisted: true });
    emitScore();
    if (chord.every(n => n.hit)) {
      if (state.currentTime < matchNote.startTime) state.currentTime = matchNote.startTime;
      clearWait();
    } else {
      state.waitingForChord = chord;
      state.waitingForNote = chord.find(n => !n.hit) || null;
      onWaitChange?.(state.waitingForNote);
    }
  }

  const notePlayListeners = new Set();
  function onNotePlay(fn) {
    notePlayListeners.add(fn);
    return () => notePlayListeners.delete(fn);
  }

  return {
    state,
    setSong,
    setSpeed,
    setWaitMode,
    setHandMode,
    cycleHandMode,
    getHandMode,
    handStates,
    setLoopPoint,
    clearLoop,
    setLoopEnabled,
    loopState,
    play,
    pause,
    stop,
    seek,
    seekPct,
    reportKeyPress,
    onNotePlay,
    isPlaying: () => state.isPlaying,
    getCurrentTime: () => state.currentTime,
    getWaitingForNote: () => state.waitingForNote,
    getWaitingForChord: () => state.waitingForChord,
    getScore: () => scorer.snapshot(),
    isNoteVisible: isVisible,
    isNoteScored: isScored,
  };
}
