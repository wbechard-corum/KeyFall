// Scoring + per-hand isolation, driven through the real playback loop with a
// fake clock so timing windows are exact.
import { check, finish } from './helpers.mjs';

let clock = 0;
const frameQueue = [];
globalThis.performance = { now: () => clock };
globalThis.requestAnimationFrame = (fn) => { frameQueue.push(fn); return frameQueue.length; };
globalThis.cancelAnimationFrame = () => {};
function stepFrame(ms) {
  clock += ms;
  for (const fn of frameQueue.splice(0, frameQueue.length)) fn();
}
/** Advance `ms` in ~16ms frames so timing stays realistic. */
function advance(ms) {
  for (let i = 0; i < Math.ceil(ms / 16); i++) stepFrame(16);
}

const { createPlayback } = await import('../src/trainer/playback.js');
const { createScorer, ratingFor } = await import('../src/trainer/scoring.js');
const { HAND_MODES, TIMING } = await import('../src/shared/constants.js');

function song(specs) {
  const notes = specs.map(([midi, startTime, dur = 0.2, track = 0]) => ({
    midi, startTime, endTime: startTime + dur, velocity: 80, track,
    played: false, hit: false,
  }));
  notes.sort((a, b) => a.startTime - b.startTime);
  let duration = 0;
  for (const n of notes) if (n.endTime > duration) duration = n.endTime;
  return { notes, duration, name: 'test' };
}

// ── 1. Rating boundaries ─────────────────────────────────────────────────
console.log('rating windows');
{
  check('dead on is perfect', ratingFor(0) === 'perfect');
  check('just inside perfect', ratingFor(TIMING.perfect - 0.001) === 'perfect');
  check('just past perfect is good', ratingFor(TIMING.perfect + 0.001) === 'good');
  check('past good and late', ratingFor(TIMING.good + 0.02) === 'late');
  check('past good and early', ratingFor(-(TIMING.good + 0.02)) === 'early');
}

// ── 2. Free play is scored at all (the headline bug) ─────────────────────
console.log('scoring with wait mode OFF');
{
  const pb = createPlayback({});
  pb.setSong(song([[60, 0.30], [62, 0.80], [64, 1.30]]));
  check('starts with nothing judged', pb.getScore().total === 0);

  pb.play();
  advance(300);                 // playhead ~0.3s: right on the first note
  pb.reportKeyPress(60);
  let s = pb.getScore();
  check('a press is judged in free play', s.total === 1, JSON.stringify(s.byRating));
  check('and counted as a hit', s.hits === 1);
  check('rated perfect when on time', s.byRating.perfect === 1, JSON.stringify(s.byRating));

  advance(500);                 // ~0.8s: second note, played slightly late
  advance(60);
  pb.reportKeyPress(62);
  s = pb.getScore();
  check('late press still counts as a hit', s.hits === 2, JSON.stringify(s.byRating));
  check('but is not rated perfect', s.byRating.perfect === 1, JSON.stringify(s.byRating));

  // Never play the third note; let its window lapse.
  advance(900);
  s = pb.getScore();
  check('an unplayed note becomes a miss', s.byRating.miss === 1, JSON.stringify(s.byRating));
  check('accuracy reflects 2 of 3', Math.abs(s.accuracy - 2 / 3) < 1e-9, `${s.accuracy}`);
  pb.pause();
}

// ── 3. Wrong notes count as extras, not as note failures ─────────────────
console.log('extra presses');
{
  const pb = createPlayback({});
  pb.setSong(song([[60, 0.30]]));
  pb.play();
  advance(300);
  pb.reportKeyPress(45);        // nowhere near anything
  let s = pb.getScore();
  check('unmatched press recorded as an extra', s.extras === 1, `${s.extras}`);
  check('and does not judge the real note', s.total === 0, `${s.total}`);
  pb.reportKeyPress(60);
  s = pb.getScore();
  check('the real note can still be hit afterwards', s.hits === 1);
  pb.pause();
}

// ── 4. Combo tracking ────────────────────────────────────────────────────
console.log('combo');
{
  const pb = createPlayback({});
  pb.setSong(song([[60, 0.2], [62, 0.4], [64, 0.6], [65, 0.8], [67, 1.6]]));
  pb.play();
  // Advance relative to the playhead — `clock` is shared across this file and
  // only ever moves forward, so absolute targets would already be in the past.
  for (const [midi, at] of [[60, 0.2], [62, 0.4], [64, 0.6], [65, 0.8]]) {
    while (pb.getCurrentTime() < at) stepFrame(16);
    pb.reportKeyPress(midi);
  }
  let s = pb.getScore();
  check('combo counts consecutive hits', s.combo === 4, `${s.combo}`);
  advance(1200);                // let the last note lapse
  s = pb.getScore();
  check('a miss resets the combo', s.combo === 0, `${s.combo}`);
  check('but max combo is remembered', s.maxCombo === 4, `${s.maxCombo}`);
  pb.pause();
}

// ── 5. Hand modes: APP is audible but never graded ───────────────────────
console.log('hand modes');
{
  check('BOTH is visible, audible, scored',
    HAND_MODES.both.visible && HAND_MODES.both.audible && HAND_MODES.both.scored);
  check('YOU is silent but still graded',
    HAND_MODES.you.visible && !HAND_MODES.you.audible && HAND_MODES.you.scored);
  check('APP sounds but is not graded',
    HAND_MODES.app.visible && HAND_MODES.app.audible && !HAND_MODES.app.scored);
  check('OFF is hidden and silent',
    !HAND_MODES.off.visible && !HAND_MODES.off.audible && !HAND_MODES.off.scored);

  const heard = [];
  const pb = createPlayback({});
  pb.onNotePlay(n => heard.push(n.midi));
  // Right hand at 0.3s, left hand at 0.3s.
  pb.setSong(song([[72, 0.30, 0.2, 0], [48, 0.30, 0.2, 1]]));
  pb.setHandMode(0, 'you');     // I play the right hand, app stays quiet
  pb.setHandMode(1, 'app');     // app plays the left hand for me
  pb.play();
  advance(400);

  check('the APP hand sounded', heard.includes(48), heard.join(','));
  check('the YOU hand stayed silent', !heard.includes(72), heard.join(','));

  // Push past the note's attribution window so the miss sweep fires.
  advance(400);
  const s = pb.getScore();
  check('only the YOU hand was judged', s.total === 1, `total=${s.total}`);
  check('and it was a miss (never played)', s.byRating.miss === 1, JSON.stringify(s.byRating));
  pb.pause();
}

// ── 6. An APP hand never blocks wait mode ────────────────────────────────
console.log('wait mode with an APP hand');
{
  const pb = createPlayback({});
  pb.setSong(song([[72, 0.30, 0.2, 0], [48, 0.30, 0.2, 1]]));
  pb.setHandMode(1, 'app');     // left hand is the app's job
  pb.setWaitMode(true);
  pb.play();
  advance(400);

  const chord = pb.getWaitingForChord();
  check('wait mode only waits on the graded hand',
    chord?.length === 1 && chord[0].midi === 72,
    JSON.stringify(chord?.map(n => n.midi)));

  pb.reportKeyPress(72);
  advance(100);
  check('playing the graded note releases the wait', pb.getWaitingForChord() === null);
  pb.pause();
}

// ── 7. Wait mode marks the run assisted ──────────────────────────────────
console.log('wait-mode scoring is flagged assisted');
{
  const pb = createPlayback({});
  pb.setSong(song([[60, 0.30]]));
  pb.setWaitMode(true);
  pb.play();
  advance(400);
  pb.reportKeyPress(60);
  const s = pb.getScore();
  check('the hit is credited', s.hits === 1);
  check('run is marked wait-assisted', s.waitAssisted === true);
  check('no misses accrue while stalled', s.byRating.miss === 0, JSON.stringify(s.byRating));
  pb.pause();
}

// ── 8. Restarting clears the scoreboard ──────────────────────────────────
console.log('reset on stop/seek');
{
  const pb = createPlayback({});
  const s0 = song([[60, 0.30], [62, 0.60]]);
  pb.setSong(s0);
  pb.play();
  advance(300);
  pb.reportKeyPress(60);
  check('scored before reset', pb.getScore().total === 1);

  pb.stop();
  check('stop clears the score', pb.getScore().total === 0, JSON.stringify(pb.getScore()));
  check('and clears per-note judgement', s0.notes.every(n => !n.judged));
}

// ── 9. Scorer picks the closest candidate of the same pitch ──────────────
console.log('nearest-note attribution');
{
  const scorer = createScorer();
  const s = song([[60, 1.00], [60, 1.40]]);
  scorer.resetSong(s);
  // Press at 1.35 — much closer to the second note than the first.
  const hit = scorer.judgePress(s, 60, 1.35, 0, () => true);
  check('claims the nearer note', hit === s.notes[1], `claimed startTime=${hit?.startTime}`);
  check('the far note is left unjudged', !s.notes[0].judged);
}

finish('scoring');
