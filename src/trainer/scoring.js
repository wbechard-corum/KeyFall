import { TIMING } from '../shared/constants.js';

// Judges what the player actually pressed against what the song asked for.
//
// The trainer previously only ever set `note.hit` inside wait mode, so with
// wait mode off you got no feedback at all — the renderer's "you hit this"
// colour could never appear. This module grades every scored note whether or
// not wait mode is on.
//
// Notes gain three fields as they're judged:
//   judged      - true once the note's fate is decided
//   hit         - true if the player played it in time
//   timingError - seconds; negative = early, positive = late
//   rating      - 'perfect' | 'good' | 'early' | 'late' | 'miss'

export function ratingFor(timingError) {
  const d = Math.abs(timingError);
  if (d <= TIMING.perfect) return 'perfect';
  if (d <= TIMING.good) return 'good';
  return timingError < 0 ? 'early' : 'late';
}

export function createScorer() {
  const stats = blankStats();

  function blankStats() {
    return {
      total: 0,          // notes judged so far
      hits: 0,
      misses: 0,
      extras: 0,         // presses that matched no expected note
      combo: 0,
      maxCombo: 0,
      sumAbsError: 0,    // for average timing
      byRating: { perfect: 0, good: 0, early: 0, late: 0, miss: 0 },
      waitAssisted: false,
    };
  }

  function reset() {
    Object.assign(stats, blankStats());
  }

  // Clear judgement state from a previous run over the same song object.
  function resetSong(song) {
    if (!song) return;
    for (const n of song.notes) {
      n.judged = false;
      n.hit = false;
      n.timingError = 0;
      n.rating = null;
    }
  }

  function record(note, rating, timingError) {
    note.judged = true;
    note.rating = rating;
    note.timingError = timingError;
    note.hit = rating !== 'miss';

    stats.total += 1;
    stats.byRating[rating] += 1;
    if (note.hit) {
      stats.hits += 1;
      stats.sumAbsError += Math.abs(timingError);
      stats.combo += 1;
      if (stats.combo > stats.maxCombo) stats.maxCombo = stats.combo;
    } else {
      stats.misses += 1;
      stats.combo = 0;
    }
  }

  // A press landed. Find the closest unjudged scored note of that pitch
  // within the attribution window and grade it.
  //
  // `from` is playback's scan cursor — notes before it are far enough in the
  // past that they can no longer be claimed.
  function judgePress(song, midi, currentTime, from, isScored, { assisted = false } = {}) {
    if (!song) return null;
    const notes = song.notes;
    let best = null;
    let bestDelta = Infinity;

    for (let i = Math.max(0, from); i < notes.length; i++) {
      const note = notes[i];
      const delta = currentTime - note.startTime;
      if (delta < -TIMING.ok) break;          // sorted: everything later is further away
      if (note.judged || note.midi !== midi) continue;
      if (!isScored(note)) continue;
      if (Math.abs(delta) > TIMING.ok) continue;
      if (Math.abs(delta) < Math.abs(bestDelta)) { best = note; bestDelta = delta; }
    }

    if (!best) {
      stats.extras += 1;
      return null;
    }
    // In wait mode the playhead stalls at the note, so measured timing is
    // meaningless — credit it as perfect but flag the run so the summary can
    // say the score was assisted.
    if (assisted) {
      stats.waitAssisted = true;
      record(best, 'perfect', 0);
    } else {
      record(best, ratingFor(bestDelta), bestDelta);
    }
    return best;
  }

  // Mark every scored note whose window has fully passed and that nobody
  // played. Called each frame from the playback loop.
  function sweepMissed(song, currentTime, from, isScored) {
    if (!song) return 0;
    const notes = song.notes;
    const cutoff = currentTime - TIMING.ok;
    let missed = 0;
    for (let i = Math.max(0, from); i < notes.length; i++) {
      const note = notes[i];
      if (note.startTime > cutoff) break;
      if (note.judged || !isScored(note)) continue;
      record(note, 'miss', TIMING.ok);
      missed += 1;
    }
    return missed;
  }

  function snapshot() {
    const accuracy = stats.total > 0 ? stats.hits / stats.total : null;
    return {
      ...stats,
      byRating: { ...stats.byRating },
      accuracy,
      averageError: stats.hits > 0 ? stats.sumAbsError / stats.hits : 0,
    };
  }

  return { reset, resetSong, judgePress, sweepMissed, snapshot };
}
