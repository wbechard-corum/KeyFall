export function createPlayback({ onTick, onEnded, onPlayStateChange, onWaitChange }) {
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
    trackMuted: [false, false],
    lastFrameTime: 0,
    animFrameId: null,
    // Cursors into song.notes (sorted by startTime). They turn what used to
    // be a full-array walk on every frame into an amortised O(1) step.
    emitIndex: 0,                 // next note not yet handed to audio
    scanIndex: 0,                 // first note still near enough to matter
  };

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
    if (song) song.notes.forEach(n => { n.played = false; n.hit = false; });
    resetCursors();
  }

  function setSpeed(v) { state.playSpeed = Number(v) || 1; }

  function setWaitMode(enabled) {
    state.waitMode = !!enabled;
    if (!state.waitMode) clearWait();
  }

  function toggleTrackMuted(idx) {
    state.trackMuted[idx] = !state.trackMuted[idx];
    return state.trackMuted[idx];
  }

  function isTrackMuted(idx) {
    return !!state.trackMuted[idx];
  }

  function play() {
    if (!state.song || state.isPlaying) return;
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
    state.currentTime = 0;
    if (state.song) state.song.notes.forEach(n => { n.played = false; n.hit = false; });
    clearWait();
    resetCursors();
    onTick?.({ currentTime: 0, song: state.song });
  }

  function seek(seconds) {
    if (!state.song) return;
    state.currentTime = Math.max(0, Math.min(state.song.duration, seconds));
    state.song.notes.forEach(n => { n.played = false; n.hit = false; });
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

    if (state.waitMode) checkWait();

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
      if (!state.trackMuted[note.track || 0]) {
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
      if (state.trackMuted[note.track || 0]) continue;
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
      if (note.hit || state.trackMuted[note.track || 0]) continue;
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
    if (!state.waitMode || !state.song) return;
    // If a chord is already active, see if this press fits.
    if (state.waitingForChord) {
      const match = state.waitingForChord.find(n => n.midi === midiNote && !n.hit);
      if (match) {
        match.hit = true;
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
      if (note.hit || state.trackMuted[note.track || 0]) continue;
      if (note.startTime < state.currentTime - lookBack) continue;
      if (note.midi === midiNote) { matchNote = note; break; }
    }
    if (!matchNote) return;
    const chord = buildChordAround(matchNote);
    matchNote.hit = true;
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
    toggleTrackMuted,
    isTrackMuted,
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
  };
}
