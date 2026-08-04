import { check, finish } from './helpers.mjs';
// Drives src/trainer/playback.js with a fake clock + rAF so we can force
// the exact frame timings that used to drop notes.
let clock = 0;
const frameQueue = [];
globalThis.performance = { now: () => clock };
globalThis.requestAnimationFrame = (fn) => { frameQueue.push(fn); return frameQueue.length; };
globalThis.cancelAnimationFrame = () => {};

// Advance the fake clock by `ms` and run exactly one queued frame.
function stepFrame(ms) {
  clock += ms;
  const fns = frameQueue.splice(0, frameQueue.length);
  for (const fn of fns) fn();
}

const { createPlayback } = await import('../src/trainer/playback.js');

function song(noteSpecs) {
  const notes = noteSpecs.map(([midi, startTime, dur = 0.2, track = 0]) => ({
    midi, startTime, endTime: startTime + dur, velocity: 80, track,
    played: false, hit: false,
  }));
  notes.sort((a, b) => a.startTime - b.startTime);
  let duration = 0;
  for (const n of notes) if (n.endTime > duration) duration = n.endTime;
  return { notes, duration, name: 'test' };
}

// ── 1. A long frame must not step over notes ─────────────────────────────
console.log('long frame (GC pause / tab throttle)');
{
  const heard = [];
  const pb = createPlayback({});
  pb.onNotePlay(n => heard.push(n.midi));
  // Eight notes packed into 400ms.
  pb.setSong(song([[60, 0.05], [61, 0.10], [62, 0.15], [63, 0.20],
                   [64, 0.25], [65, 0.30], [66, 0.35], [67, 0.40]]));
  pb.play();
  // 80ms frames: slow enough that each step lands well outside the old
  // 50ms emit window, so notes in the first 30ms of every step used to be
  // stepped over and never sound at all.
  for (let i = 0; i < 10; i++) stepFrame(80);
  check('every note in the skipped span still sounded', heard.length === 8,
    `heard ${heard.length}: ${heard}`);
  check('they sound in pitch order', heard.join(',') === '60,61,62,63,64,65,66,67', heard.join(','));
  pb.pause();
}

// ── 2. Clock jump is clamped, playhead does not teleport ─────────────────
console.log('backgrounded tab');
{
  const pb = createPlayback({});
  pb.setSong(song([[60, 0], [62, 30]]));
  pb.play();
  stepFrame(16);
  // Simulate 30 seconds of the tab being hidden with no rAF callbacks.
  stepFrame(30000);
  check('playhead advanced by at most one clamped frame',
    pb.getCurrentTime() < 0.2, `currentTime=${pb.getCurrentTime()}`);
  pb.pause();
}

// ── 3. Normal playback still emits at the right times ────────────────────
console.log('steady playback');
{
  const heard = [];
  const pb = createPlayback({});
  pb.onNotePlay(n => heard.push(n.midi));
  pb.setSong(song([[60, 0.1], [62, 0.5], [64, 0.9]]));
  pb.play();
  for (let i = 0; i < 12; i++) stepFrame(16);   // ~192ms
  check('only the first note has sounded', heard.join(',') === '60', heard.join(','));
  for (let i = 0; i < 25; i++) stepFrame(16);   // ~592ms total
  check('second note sounded on time', heard.join(',') === '60,62', heard.join(','));
  pb.pause();
}

// ── 4. Muted track is silent but still advances the cursor ───────────────
console.log('muted track');
{
  const heard = [];
  const pb = createPlayback({});
  pb.onNotePlay(n => heard.push(n.midi));
  pb.setSong(song([[60, 0.05, 0.2, 0], [40, 0.05, 0.2, 1], [62, 0.15, 0.2, 0]]));
  pb.toggleTrackMuted(1);
  pb.play();
  for (let i = 0; i < 20; i++) stepFrame(16);
  check('left-hand note suppressed', !heard.includes(40), heard.join(','));
  check('right-hand notes still heard', heard.includes(60) && heard.includes(62), heard.join(','));
  pb.pause();
}

// ── 5. Seeking does not replay everything before the seek point ──────────
console.log('seek');
{
  const heard = [];
  const pb = createPlayback({});
  pb.onNotePlay(n => heard.push(n.midi));
  pb.setSong(song([[60, 0.1], [62, 0.2], [64, 5.0], [65, 5.1]]));
  pb.seek(4.9);
  pb.play();
  stepFrame(300);
  check('notes before the seek point stay silent',
    !heard.includes(60) && !heard.includes(62), heard.join(','));
  check('notes after the seek point sound', heard.includes(64), heard.join(','));
  pb.pause();
}

// ── 6. Chord wait mode: all notes required ───────────────────────────────
console.log('chord wait mode');
{
  const pb = createPlayback({});
  const s = song([[60, 0.2], [64, 0.2], [67, 0.2], [72, 1.5]]);
  pb.setSong(s);
  pb.setWaitMode(true);
  pb.play();
  for (let i = 0; i < 20; i++) stepFrame(16);   // reach the chord and stall
  const stalledAt = pb.getCurrentTime();
  check('playback waits at the chord', pb.getWaitingForChord()?.length === 3,
    JSON.stringify(pb.getWaitingForChord()?.map(n => n.midi)));

  pb.reportKeyPress(60);
  stepFrame(16);
  check('still waiting after one of three notes',
    Math.abs(pb.getCurrentTime() - stalledAt) < 0.05, `${pb.getCurrentTime()} vs ${stalledAt}`);

  pb.reportKeyPress(64);
  stepFrame(16);
  check('still waiting after two of three', !!pb.getWaitingForChord());

  pb.reportKeyPress(67);
  for (let i = 0; i < 5; i++) stepFrame(16);
  check('advances once the whole chord is played', pb.getWaitingForChord() === null);
  check('playhead moved past the chord', pb.getCurrentTime() > stalledAt,
    `${pb.getCurrentTime()} vs ${stalledAt}`);
  pb.pause();
}

// ── 7. Wrong key during a chord does not advance ─────────────────────────
console.log('wrong key in wait mode');
{
  const pb = createPlayback({});
  pb.setSong(song([[60, 0.2], [64, 0.2]]));
  pb.setWaitMode(true);
  pb.play();
  for (let i = 0; i < 20; i++) stepFrame(16);
  pb.reportKeyPress(61);        // wrong note
  pb.reportKeyPress(62);        // wrong note
  stepFrame(16);
  check('wrong keys leave the chord unsatisfied', pb.getWaitingForChord()?.length === 2,
    JSON.stringify(pb.getWaitingForChord()?.map(n => n.midi)));
  pb.pause();
}

// ── 8. Large song stays responsive (cursor, not full scan) ───────────────
console.log('large song performance');
{
  const specs = [];
  for (let i = 0; i < 60000; i++) specs.push([60 + (i % 24), i * 0.01, 0.05]);
  const pb = createPlayback({});
  let emitted = 0;
  pb.onNotePlay(() => emitted++);
  pb.setSong(song(specs));
  pb.setWaitMode(false);
  pb.play();
  const t0 = Date.now();
  for (let i = 0; i < 600; i++) stepFrame(16);   // ~9.6s of playback
  const elapsed = Date.now() - t0;
  check('600 frames over a 60k-note song run fast', elapsed < 1000, `${elapsed}ms`);
  check('roughly the right number of notes emitted', emitted > 900 && emitted < 1100, `${emitted}`);
  pb.pause();
}

finish('playback');
