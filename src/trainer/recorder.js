// Records what you actually played, so you can hear it back and see it
// against the score.
//
// A take is stored in *song time*, not wall-clock: every note is stamped with
// the playhead position when it was struck. That means a take recorded at
// 0.5x speed lines up with the score at 1x, and a take made inside an A/B
// loop lands where the loop is rather than at the start of the piece.
//
// Notes are captured on note-on and closed on note-off. Anything still held
// when recording stops is closed at the stop point, so a take never contains
// a note with no end.

const MAX_TAKE_NOTES = 20000;

export function createRecorder({ onStateChange } = {}) {
  const state = {
    recording: false,
    take: null,          // the finished take
    notes: [],           // notes captured so far this pass
    open: new Map(),     // midi -> note being held
    startedAt: null,     // song time where recording began
    lastTime: 0,         // most recent playhead position seen
    truncated: false,
  };

  function emit() {
    onStateChange?.(status());
  }

  function status() {
    return {
      recording: state.recording,
      noteCount: state.recording ? state.notes.length : (state.take?.notes.length ?? 0),
      hasTake: !!state.take,
      truncated: state.truncated,
    };
  }

  function start(songTime = 0) {
    state.recording = true;
    state.notes = [];
    state.open.clear();
    state.startedAt = songTime;
    state.lastTime = songTime;
    state.truncated = false;
    emit();
  }

  // The playhead moved. Recording is driven by this rather than by a clock of
  // its own so it can't drift away from the score.
  function tick(songTime) {
    if (state.recording) state.lastTime = songTime;
  }

  function noteOn(midi, velocity = 90, songTime = state.lastTime) {
    if (!state.recording) return;
    if (state.notes.length >= MAX_TAKE_NOTES) { state.truncated = true; return; }
    // A retrigger without a note-off closes the previous one first, so the
    // take can't contain overlapping copies of the same key.
    if (state.open.has(midi)) noteOff(midi, songTime);
    const note = { midi, startTime: songTime, endTime: null, velocity };
    state.open.set(midi, note);
    state.notes.push(note);
    emit();
  }

  function noteOff(midi, songTime = state.lastTime) {
    if (!state.recording) return;
    const note = state.open.get(midi);
    if (!note) return;
    note.endTime = Math.max(songTime, note.startTime + 0.02);
    state.open.delete(midi);
  }

  function stop({ songId = null, songName = null, score = null } = {}) {
    if (!state.recording) return state.take;
    // Close anything still held rather than leaving an endless note.
    for (const midi of [...state.open.keys()]) noteOff(midi, state.lastTime);
    state.recording = false;

    const notes = state.notes
      .filter(n => n.endTime !== null)
      .sort((a, b) => a.startTime - b.startTime);

    state.take = notes.length > 0 ? {
      songId,
      songName,
      recordedAt: Date.now(),
      startTime: state.startedAt,
      endTime: state.lastTime,
      truncated: state.truncated,
      score,
      notes,
    } : null;

    state.notes = [];
    emit();
    return state.take;
  }

  function cancel() {
    state.recording = false;
    state.notes = [];
    state.open.clear();
    emit();
  }

  function clearTake() {
    state.take = null;
    emit();
  }

  function setTake(take) {
    state.take = normaliseTake(take);
    emit();
    return state.take;
  }

  return {
    state,
    status,
    start, stop, cancel, tick,
    noteOn, noteOff,
    getTake: () => state.take,
    setTake, clearTake,
    isRecording: () => state.recording,
  };
}

// Guard against a malformed take from storage — a stored take is just JSON
// and a bad one would otherwise poison the renderer every frame.
export function normaliseTake(take) {
  if (!take || !Array.isArray(take.notes)) return null;
  const notes = take.notes
    .filter(n => n && Number.isFinite(n.midi) && Number.isFinite(n.startTime)
                 && Number.isFinite(n.endTime) && n.endTime > n.startTime)
    .map(n => ({
      midi: Math.max(0, Math.min(127, Math.round(n.midi))),
      startTime: n.startTime,
      endTime: n.endTime,
      velocity: Number.isFinite(n.velocity) ? n.velocity : 90,
    }))
    .sort((a, b) => a.startTime - b.startTime);
  if (notes.length === 0) return null;
  return {
    songId: take.songId ?? null,
    songName: take.songName ?? null,
    recordedAt: take.recordedAt ?? Date.now(),
    startTime: Number.isFinite(take.startTime) ? take.startTime : notes[0].startTime,
    endTime: Number.isFinite(take.endTime) ? take.endTime : notes[notes.length - 1].endTime,
    truncated: !!take.truncated,
    score: take.score ?? null,
    notes,
  };
}

// Replays a take against the playhead, emitting notes as the playhead reaches
// them. Uses the same cursor approach as playback so a long frame can't step
// over a note.
export function createTakePlayer(onNote) {
  let take = null;
  let index = 0;
  let last = -Infinity;

  function load(nextTake) {
    take = nextTake;
    reset(0);
  }

  function reset(songTime) {
    index = 0;
    last = songTime;
    if (!take) return;
    while (index < take.notes.length && take.notes[index].startTime < songTime) index++;
  }

  function tick(songTime) {
    if (!take) return;
    // A jump backwards (seek, loop wrap) needs the cursor re-aimed.
    if (songTime < last - 0.05) reset(songTime);
    last = songTime;
    while (index < take.notes.length && take.notes[index].startTime <= songTime) {
      onNote?.(take.notes[index++]);
    }
  }

  return { load, reset, tick, hasTake: () => !!take };
}
