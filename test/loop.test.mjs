// Section repeat (A/B loop) driven through the real playback clock.
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
function advance(ms) { for (let i = 0; i < Math.ceil(ms / 16); i++) stepFrame(16); }

const { createPlayback } = await import('../src/trainer/playback.js');

function song(specs, duration) {
  const notes = specs.map(([midi, startTime, dur = 0.2, track = 0]) => ({
    midi, startTime, endTime: startTime + dur, velocity: 80, track,
    played: false, hit: false,
  }));
  notes.sort((a, b) => a.startTime - b.startTime);
  let d = 0;
  for (const n of notes) if (n.endTime > d) d = n.endTime;
  return { notes, duration: duration ?? d, name: 'test' };
}

// ── 1. Setting both points arms the loop ─────────────────────────────────
console.log('arming');
{
  const pb = createPlayback({});
  pb.setSong(song([[60, 0.5]], 10));
  check('no loop initially', pb.loopState().active === false);

  pb.setLoopPoint('start', 2);
  check('one point is not enough to arm', pb.loopState().active === false);
  check('but the point is remembered', pb.loopState().start === 2);

  pb.setLoopPoint('end', 4);
  const l = pb.loopState();
  check('both points arm the loop', l.active === true);
  check('start/end recorded', l.start === 2 && l.end === 4, JSON.stringify(l));
}

// ── 2. Points given out of order are sorted ──────────────────────────────
console.log('out-of-order points');
{
  const pb = createPlayback({});
  pb.setSong(song([[60, 0.5]], 10));
  pb.setLoopPoint('start', 6);
  pb.setLoopPoint('end', 3);
  const l = pb.loopState();
  check('start is the earlier of the two', l.start === 3, JSON.stringify(l));
  check('end is the later of the two', l.end === 6, JSON.stringify(l));
}

// ── 3. Playback wraps at the loop end ────────────────────────────────────
console.log('wrapping');
{
  const pb = createPlayback({});
  pb.setSong(song([[60, 1.1], [62, 1.5]], 20));
  pb.setLoopPoint('start', 1.0);
  pb.setLoopPoint('end', 2.0);
  pb.play();
  check('play jumps into the section', Math.abs(pb.getCurrentTime() - 1.0) < 0.05,
    `${pb.getCurrentTime()}`);

  advance(1500);   // well past the 1s section
  const t = pb.getCurrentTime();
  check('playhead stays inside the loop', t >= 1.0 && t <= 2.0, `${t}`);
  check('loop counted at least one pass', pb.loopState().count >= 1,
    `${pb.loopState().count}`);
  pb.pause();
}

// ── 4. Notes inside the section replay on each pass ──────────────────────
console.log('notes repeat');
{
  const heard = [];
  const pb = createPlayback({});
  pb.onNotePlay(n => heard.push(n.midi));
  pb.setSong(song([[60, 1.1], [62, 1.5], [64, 5.0]], 20));
  pb.setLoopPoint('start', 1.0);
  pb.setLoopPoint('end', 2.0);
  pb.play();
  advance(3200);   // roughly three passes
  pb.pause();

  const sixties = heard.filter(m => m === 60).length;
  check('the in-section note sounded on every pass', sixties >= 2, `heard 60 ×${sixties}`);
  check('a note outside the section never sounds', !heard.includes(64), heard.join(','));
}

// ── 5. Scoring resets per pass ───────────────────────────────────────────
console.log('scoring per pass');
{
  const pb = createPlayback({});
  pb.setSong(song([[60, 1.1]], 20));
  pb.setLoopPoint('start', 1.0);
  pb.setLoopPoint('end', 2.0);
  pb.play();
  advance(1200);                       // let the first pass miss the note
  const afterFirst = pb.getScore();
  check('the missed note is judged', afterFirst.total >= 1, JSON.stringify(afterFirst.byRating));

  advance(1200);                       // wrap and come round again
  const l = pb.loopState();
  check('wrapped again', l.count >= 1, `${l.count}`);
  // The note is re-armed each pass, so the running total keeps climbing
  // rather than the note staying permanently judged from pass one.
  check('the note is judged again on the next pass',
    pb.getScore().total > afterFirst.total,
    `${afterFirst.total} -> ${pb.getScore().total}`);
  pb.pause();
}

// ── 6. Disabling and clearing ────────────────────────────────────────────
console.log('disable and clear');
{
  const pb = createPlayback({});
  pb.setSong(song([[60, 1.1]], 20));
  pb.setLoopPoint('start', 1.0);
  pb.setLoopPoint('end', 2.0);

  pb.setLoopEnabled(false);
  check('disabled loop is inactive', pb.loopState().active === false);
  check('but the points survive', pb.loopState().start === 1.0);

  pb.play();
  advance(2500);
  check('playhead runs past the end when disabled', pb.getCurrentTime() > 2.0,
    `${pb.getCurrentTime()}`);
  pb.pause();

  pb.clearLoop();
  const l = pb.loopState();
  check('clear removes both points', l.start === null && l.end === null, JSON.stringify(l));
  check('and deactivates', l.active === false);
}

// ── 7. STOP returns to the section start, not the top of the piece ───────
console.log('stop inside a loop');
{
  const pb = createPlayback({});
  pb.setSong(song([[60, 1.1]], 20));
  pb.setLoopPoint('start', 1.0);
  pb.setLoopPoint('end', 2.0);
  pb.play();
  advance(500);
  pb.stop();
  check('stop parks at the loop start', Math.abs(pb.getCurrentTime() - 1.0) < 1e-9,
    `${pb.getCurrentTime()}`);

  pb.clearLoop();
  pb.stop();
  check('with no loop, stop returns to zero', pb.getCurrentTime() === 0,
    `${pb.getCurrentTime()}`);
}

// ── 8. A loop reaching the end of the piece repeats, not finishes ────────
console.log('loop at the end of the piece');
{
  let ended = 0;
  const pb = createPlayback({ onEnded: () => { ended += 1; } });
  const s = song([[60, 1.1]], 2.0);
  pb.setSong(s);
  pb.setLoopPoint('start', 1.0);
  pb.setLoopPoint('end', 2.0);
  pb.play();
  advance(4000);
  check('the run never "ends" while looping', ended === 0, `ended=${ended}`);
  check('and it kept wrapping', pb.loopState().count >= 2, `${pb.loopState().count}`);
  pb.pause();
}

finish('loop');
