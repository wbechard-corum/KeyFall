// Automatic piano fingering.
//
// Fingers are numbered 1 (thumb) to 5 (little finger) on both hands. Choosing
// good fingering is genuinely hard — it depends on what comes next, on hand
// size, and on musical phrasing, and real editions disagree with each other.
// This is a greedy heuristic, not an edition: it gets simple scale and chord
// passages right and will sometimes suggest something awkward in busy music.
// The UI labels it as automatic for exactly that reason.
//
// Rules, per hand, in time order:
//   * a chord spreads the available fingers across its notes, low to high
//     (reversed for the left hand, where the thumb is on top)
//   * stepwise motion walks to the neighbouring finger
//   * running out of fingers going up triggers a thumb-under (right hand) or
//     a cross-over (left hand), which is what a player actually does
//   * a leap wider than the hand resets to a comfortable middle finger

const CHORD_EPS = 0.03;

const RIGHT = 0;
const LEFT = 1;

// Distribute n fingers across a chord. Wide chords reach for the outer
// fingers; narrow ones stay bunched in the middle of the hand.
function chordFingers(count, span) {
  if (count <= 1) return [1];
  if (count >= 5) return [1, 2, 3, 4, 5];
  if (count === 2) return span > 7 ? [1, 5] : span > 4 ? [1, 4] : [1, 3];
  if (count === 3) return span > 9 ? [1, 3, 5] : [1, 2, 4];
  return span > 10 ? [1, 2, 3, 5] : [1, 2, 3, 4];
}

function clampFinger(f) {
  return Math.max(1, Math.min(5, f));
}

// Assign `finger` (1-5) to every note in the song. Safe to call repeatedly.
export function assignFingering(song) {
  if (!song?.notes?.length) return song;

  for (const hand of [RIGHT, LEFT]) {
    const notes = song.notes.filter(n => (n.track === 1 ? LEFT : RIGHT) === hand);
    if (notes.length === 0) continue;

    // Group into chords first, so each step can see where the line is going.
    // Fingering a scale well needs more than one note of lookahead: the thumb
    // tucks under after finger 3, not after 5, precisely so the last group of
    // the run can finish 1-2-3-4-5.
    const groups = [];
    for (let k = 0; k < notes.length;) {
      const start = notes[k].startTime;
      let end = k;
      while (end < notes.length && notes[end].startTime - start <= CHORD_EPS) end++;
      groups.push(notes.slice(k, end).sort((a, b) => a.midi - b.midi));
      k = end;
    }

    // For each single-note group, how many further groups keep stepping in
    // the same direction.
    const runLength = groups.map((g, gi) => {
      if (g.length !== 1) return 0;
      let n = 0;
      let prev = g[0].midi;
      for (let k = gi + 1; k < groups.length; k++) {
        const next = groups[k];
        if (next.length !== 1) break;
        const step = next[0].midi - prev;
        if (step === 0 || Math.abs(step) > 2) break;
        if (n > 0 && Math.sign(step) !== Math.sign(groups[gi + 1][0].midi - g[0].midi)) break;
        prev = next[0].midi;
        n++;
      }
      return n;
    });

    let prevPitch = null;
    let prevFinger = null;

    for (let gi = 0; gi < groups.length; gi++) {
      const chord = groups[gi];

      if (chord.length > 1) {
        const span = chord[chord.length - 1].midi - chord[0].midi;
        const fingers = chordFingers(chord.length, span);
        // The right thumb sits on the lowest note of a chord; the left thumb
        // sits on the highest.
        const ordered = hand === RIGHT ? fingers : [...fingers].reverse();
        chord.forEach((note, k) => { note.finger = ordered[k] ?? 3; });
        // Continue from the outermost finger — that's where the hand is.
        prevPitch = hand === RIGHT ? chord[chord.length - 1].midi : chord[0].midi;
        prevFinger = hand === RIGHT ? ordered[ordered.length - 1] : ordered[0];
      } else {
        const note = chord[0];
        const following = groups[gi + 1]?.[0]?.midi ?? null;
        note.finger = nextFinger(hand, prevPitch, prevFinger, note.midi, following, runLength[gi]);
        prevPitch = note.midi;
        prevFinger = note.finger;
      }
    }
  }
  song.__fingered = true;
  return song;
}

function nextFinger(hand, prevPitch, prevFinger, pitch, followingPitch = null, runAhead = 0) {
  // First note of the hand. Which finger to start on depends entirely on
  // where the line goes next: beginning an ascending run on the thumb is what
  // gives the textbook 1-2-3-1-2-3-4-5 for a right-hand scale. With nothing
  // to go on, start in the middle so there's room either way.
  if (prevPitch === null || prevFinger === null) {
    if (followingPitch === null || followingPitch === pitch) return 3;
    const rising = followingPitch > pitch;
    const outward = hand === RIGHT ? rising : !rising;
    return outward ? 1 : 5;
  }

  const delta = pitch - prevPitch;
  if (delta === 0) return prevFinger;              // repeated note keeps the finger

  const up = delta > 0;
  const distance = Math.abs(delta);

  // A leap beyond a comfortable stretch means the hand moves; reset rather
  // than pretend the fingers can span it.
  if (distance > 9) return 3;
  if (distance > 5) return up ? (hand === RIGHT ? 2 : 4) : (hand === RIGHT ? 4 : 2);

  // Stepwise or small skips: walk the fingers, stepping by more than one for
  // a skip so the hand doesn't bunch up.
  const step = distance <= 2 ? 1 : 2;
  // On the right hand, ascending means higher finger numbers. On the left,
  // ascending means lower ones, because the hand is mirrored.
  const direction = hand === RIGHT ? (up ? 1 : -1) : (up ? -1 : 1);
  const target = prevFinger + direction * step;

  // Tuck early on a long run. Passing the thumb under the third finger is
  // comfortable; under the fifth is not. Tucking at 3 also leaves exactly
  // enough fingers for the run to finish 1-2-3-4-5, which is why that's the
  // standard scale fingering. Only worth it when enough notes remain to use
  // the whole hand afterwards.
  if (direction > 0 && prevFinger >= 3 && runAhead >= 4) return 1;

  if (target >= 1 && target <= 5) return target;

  // Out of fingers. Going "outward" past the little finger, the thumb passes
  // under (or the hand crosses over) and we start again from the thumb.
  // Coming back past the thumb, land on the middle of the hand.
  const outward = hand === RIGHT ? up : !up;
  return outward ? 1 : clampFinger(3);
}

// Fingering depends only on pitch and rhythm, so it can be computed once and
// cached on the song.
export function ensureFingering(song) {
  if (song && !song.__fingered) assignFingering(song);
  return song;
}
