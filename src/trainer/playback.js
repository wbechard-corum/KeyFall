export function createPlayback({ onTick, onEnded, onPlayStateChange, onWaitChange }) {
  const state = {
    song: null,
    isPlaying: false,
    currentTime: 0,
    playSpeed: 1,
    waitMode: false,
    waitingForNote: null,
    trackMuted: [false, false],
    lastFrameTime: 0,
    animFrameId: null,
  };

  function resetNoteFlags(song) {
    if (!song) return;
    for (const n of song.notes) {
      n.played = false;
      n.hit = false;
      n.offEmitted = false;
    }
  }

  function setSong(song) {
    state.song = song;
    state.currentTime = 0;
    state.waitingForNote = null;
    resetNoteFlags(song);
  }

  function setSpeed(v) { state.playSpeed = Number(v) || 1; }

  function setWaitMode(enabled) {
    state.waitMode = !!enabled;
    if (!state.waitMode) {
      state.waitingForNote = null;
      onWaitChange?.(null);
    }
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
    flushOutstanding();
    state.currentTime = 0;
    state.waitingForNote = null;
    resetNoteFlags(state.song);
    onWaitChange?.(null);
    onTick?.({ currentTime: 0, song: state.song });
  }

  function seek(seconds) {
    if (!state.song) return;
    flushOutstanding();
    state.currentTime = Math.max(0, Math.min(state.song.duration, seconds));
    resetNoteFlags(state.song);
    state.waitingForNote = null;
    onWaitChange?.(null);
    onTick?.({ currentTime: state.currentTime, song: state.song });
  }

  // Send note-offs for every note currently believed to be sounding, so that
  // consumers (audio, MIDI out) don't leave hanging notes after a stop/seek.
  function flushOutstanding() {
    if (!state.song) return;
    for (const note of state.song.notes) {
      if (note.played && !note.offEmitted) {
        note.offEmitted = true;
        noteOffListeners.forEach(fn => fn(note));
      }
    }
  }

  function seekPct(pct) {
    if (!state.song) return;
    seek(pct * state.song.duration);
  }

  function tick() {
    if (!state.isPlaying) return;
    const now = performance.now();
    const dt = (now - state.lastFrameTime) / 1000;
    state.lastFrameTime = now;

    if (state.waitMode && state.waitingForNote) {
      onTick?.({ currentTime: state.currentTime, song: state.song, waitingFor: state.waitingForNote });
      state.animFrameId = requestAnimationFrame(tick);
      return;
    }

    state.currentTime += dt * state.playSpeed;

    emitDueNotes();
    emitDueNoteOffs();

    if (state.waitMode) checkWait();

    if (state.currentTime >= state.song.duration + 1) {
      stop();
      onEnded?.();
      return;
    }

    onTick?.({ currentTime: state.currentTime, song: state.song, waitingFor: state.waitingForNote });
    state.animFrameId = requestAnimationFrame(tick);
  }

  function emitDueNotes() {
    if (!state.song) return;
    const lookback = 0.05;
    for (const note of state.song.notes) {
      if (note.played) continue;
      if (note.startTime <= state.currentTime && note.startTime >= state.currentTime - lookback) {
        note.played = true;
        if (!state.trackMuted[note.track || 0]) {
          notePlayListeners.forEach(fn => fn(note));
        } else {
          // Skip emit but mark as played+off so the pair stays balanced.
          note.offEmitted = true;
        }
      }
    }
  }

  function emitDueNoteOffs() {
    if (!state.song) return;
    for (const note of state.song.notes) {
      if (!note.played || note.offEmitted) continue;
      if (note.endTime <= state.currentTime) {
        note.offEmitted = true;
        noteOffListeners.forEach(fn => fn(note));
      }
    }
  }

  function checkWait() {
    if (!state.song) return;
    for (const note of state.song.notes) {
      if (note.hit || state.trackMuted[note.track || 0]) continue;
      if (note.startTime >= state.currentTime - 0.05 && note.startTime <= state.currentTime + 0.05) {
        state.waitingForNote = note;
        onWaitChange?.(note);
        return;
      }
    }
  }

  function reportKeyPress(midiNote) {
    if (state.waitMode && state.waitingForNote && state.waitingForNote.midi === midiNote) {
      state.waitingForNote.hit = true;
      state.waitingForNote = null;
      onWaitChange?.(null);
    }
  }

  const notePlayListeners = new Set();
  const noteOffListeners = new Set();
  function onNotePlay(fn) {
    notePlayListeners.add(fn);
    return () => notePlayListeners.delete(fn);
  }
  function onNoteOff(fn) {
    noteOffListeners.add(fn);
    return () => noteOffListeners.delete(fn);
  }

  function pauseWithFlush() {
    pause();
    flushOutstanding();
  }

  return {
    state,
    setSong,
    setSpeed,
    setWaitMode,
    toggleTrackMuted,
    isTrackMuted,
    play,
    pause: pauseWithFlush,
    stop,
    seek,
    seekPct,
    reportKeyPress,
    onNotePlay,
    onNoteOff,
    flushOutstanding,
    isPlaying: () => state.isPlaying,
    getCurrentTime: () => state.currentTime,
    getWaitingForNote: () => state.waitingForNote,
  };
}
