// Recording takes in song time, and replaying them against the playhead.
import { check, finish, note, repoRoot, sleep,
         loadPlaywrightOptional, chromiumExecutable, waitForHttp } from './helpers.mjs';
import { spawn } from 'node:child_process';
import { createRecorder, createTakePlayer, normaliseTake } from '../src/trainer/recorder.js';

// ── 1. Capturing a take ──────────────────────────────────────────────────
console.log('capture');
{
  const rec = createRecorder();
  check('starts idle', rec.isRecording() === false && rec.status().hasTake === false);

  rec.start(0);
  check('recording after start', rec.isRecording());

  rec.tick(1.0); rec.noteOn(60, 100);
  rec.tick(1.4); rec.noteOff(60);
  rec.tick(2.0); rec.noteOn(64, 80);
  rec.tick(2.5); rec.noteOff(64);
  rec.tick(3.0);
  const take = rec.stop({ songId: 'abc', songName: 'Test' });

  check('a take is produced', !!take);
  check('both notes captured', take.notes.length === 2, `${take.notes.length}`);
  check('times are song time, not wall clock',
    take.notes[0].startTime === 1.0 && take.notes[0].endTime === 1.4,
    JSON.stringify(take.notes[0]));
  check('velocity is kept', take.notes[0].velocity === 100 && take.notes[1].velocity === 80);
  check('song identity is recorded', take.songId === 'abc' && take.songName === 'Test');
  check('recording stops', rec.isRecording() === false);
  check('the take is retained', rec.getTake() === take);
}

// ── 2. Notes still held when recording stops ─────────────────────────────
console.log('dangling notes');
{
  const rec = createRecorder();
  rec.start(0);
  rec.tick(1.0); rec.noteOn(60, 100);
  rec.tick(2.5);
  const take = rec.stop();
  check('a held note is closed at the stop point', take.notes.length === 1, `${take.notes.length}`);
  check('and gets a real end time',
    take.notes[0].endTime === 2.5 && take.notes[0].endTime > take.notes[0].startTime,
    JSON.stringify(take.notes[0]));
  check('no note has a null end', take.notes.every(n => n.endTime !== null));
}

// ── 3. Retriggering the same key ─────────────────────────────────────────
console.log('retrigger');
{
  const rec = createRecorder();
  rec.start(0);
  rec.tick(1.0); rec.noteOn(60, 100);
  rec.tick(1.5); rec.noteOn(60, 110);   // struck again with no note-off
  rec.tick(2.0); rec.noteOff(60);
  const take = rec.stop();
  check('both strikes are recorded', take.notes.length === 2, `${take.notes.length}`);
  check('they do not overlap',
    take.notes[0].endTime <= take.notes[1].startTime,
    JSON.stringify(take.notes));
}

// ── 4. Recording inside a loop starts where the loop does ────────────────
console.log('song-time anchoring');
{
  const rec = createRecorder();
  rec.start(8.0);                       // recording began mid-piece
  rec.tick(8.2); rec.noteOn(72, 90);
  rec.tick(8.6); rec.noteOff(72);
  const take = rec.stop();
  check('the take remembers where it began', take.startTime === 8.0, `${take.startTime}`);
  check('notes land at their song position', take.notes[0].startTime === 8.2,
    `${take.notes[0].startTime}`);
}

// ── 5. Cancel and empty takes ────────────────────────────────────────────
console.log('cancel and empty');
{
  const rec = createRecorder();
  rec.start(0);
  rec.tick(1); rec.noteOn(60, 90); rec.noteOff(60);
  rec.cancel();
  check('cancel stops recording', rec.isRecording() === false);
  check('cancel keeps no take', rec.getTake() === null);

  rec.start(0);
  rec.tick(1);
  const empty = rec.stop();
  check('a take with no notes is null rather than empty', empty === null);

  // Events outside a recording must be ignored, not throw.
  let threw = false;
  try { rec.noteOn(60, 90); rec.noteOff(60); rec.tick(5); } catch { threw = true; }
  check('note events outside a recording are ignored', !threw && rec.getTake() === null);
}

// ── 6. normaliseTake defends against bad stored data ─────────────────────
console.log('stored take validation');
{
  check('null in, null out', normaliseTake(null) === null);
  check('a non-take is rejected', normaliseTake({ notes: 'nope' }) === null);
  check('an empty note list is rejected', normaliseTake({ notes: [] }) === null);

  const messy = normaliseTake({
    notes: [
      { midi: 64, startTime: 2, endTime: 2.5, velocity: 90 },
      { midi: 60, startTime: 1, endTime: 1.5, velocity: 100 },
      { midi: 999, startTime: 3, endTime: 3.5 },        // out of range pitch
      { midi: 62, startTime: 5, endTime: 4 },           // ends before it starts
      { midi: NaN, startTime: 6, endTime: 7 },          // not a note
      null,
    ],
  });
  check('bad notes are dropped', messy.notes.length === 3,
    JSON.stringify(messy.notes.map(n => n.midi)));
  check('notes come back sorted by time',
    messy.notes.every((n, i) => i === 0 || n.startTime >= messy.notes[i - 1].startTime),
    JSON.stringify(messy.notes.map(n => n.startTime)));
  check('pitch is clamped into MIDI range',
    messy.notes.every(n => n.midi >= 0 && n.midi <= 127),
    JSON.stringify(messy.notes.map(n => n.midi)));
  check('a missing velocity gets a default',
    messy.notes.every(n => Number.isFinite(n.velocity)));
}

// ── 7. Replaying a take against the playhead ─────────────────────────────
console.log('take playback');
{
  const heard = [];
  const player = createTakePlayer(n => heard.push(n.midi));
  check('nothing loaded reports no take', player.hasTake() === false);

  player.load({
    notes: [
      { midi: 60, startTime: 1.0, endTime: 1.4, velocity: 90 },
      { midi: 62, startTime: 1.5, endTime: 1.9, velocity: 90 },
      { midi: 64, startTime: 2.0, endTime: 2.4, velocity: 90 },
    ],
  });
  check('a loaded take is reported', player.hasTake());

  player.tick(0.5);
  check('nothing sounds before the first note', heard.length === 0, heard.join(','));
  player.tick(1.0);
  check('the first note sounds on time', heard.join(',') === '60', heard.join(','));

  // A long frame must not step over a note, same as song playback.
  player.tick(2.1);
  check('a long frame catches every note it passed', heard.join(',') === '60,62,64',
    heard.join(','));

  // Seeking backwards re-aims the cursor rather than going silent.
  heard.length = 0;
  player.tick(0.0);
  player.tick(1.2);
  check('seeking back replays from there', heard.join(',') === '60', heard.join(','));
}

// ── 8. The controls, in a browser ────────────────────────────────────────
const chromium = await loadPlaywrightOptional();
if (!chromium) {
  note('browser checks skipped — playwright not installed (npm run test:setup)');
  finish('recording');
}

const vite = spawn('npx', ['vite', '--port', '5219', '--strictPort'], {
  cwd: repoRoot, stdio: 'ignore',
});
let browser;
try {
  if (!await waitForHttp('http://127.0.0.1:5219/')) throw new Error('vite never came up');
  browser = await chromium.launch({ executablePath: chromiumExecutable() });
  const page = await (await browser.newContext()).newPage();
  await page.route('**/api/**', r => r.fulfill({ status: 200, body: '[]', contentType: 'application/json' }));
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://127.0.0.1:5219/', { waitUntil: 'networkidle' });
  await sleep(300);

  console.log('recording UI');
  await page.locator('.demo-item').first().click();
  await sleep(250);

  check('compare and hear start disabled',
    await page.locator('[data-action="take-compare"]').isDisabled()
    && await page.locator('[data-action="take-play"]').isDisabled());

  // Record, play some notes on the on-screen piano, then stop.
  await page.locator('[data-action="record"]').click();
  await sleep(200);
  check('REC engages', await page.locator('[data-action="record"]')
    .evaluate(el => el.classList.contains('active')));
  check('recording starts playback',
    (await page.locator('[data-action="play"]').textContent())?.trim() === 'PAUSE');

  const box = await page.locator('.canvas-wrap canvas').boundingBox();
  for (const frac of [0.35, 0.4, 0.45]) {
    await page.mouse.move(box.x + box.width * frac, box.y + box.height * 0.95);
    await page.mouse.down();
    await sleep(120);
    await page.mouse.up();
    await sleep(100);
  }
  const during = (await page.locator('[data-role="take-info"]').textContent())?.trim();
  check('the note counter runs during recording', /note/.test(during || ''), during);

  await page.locator('[data-action="record"]').click();
  await sleep(250);
  check('REC disengages', !(await page.locator('[data-action="record"]')
    .evaluate(el => el.classList.contains('active'))));
  check('compare and hear become available',
    !(await page.locator('[data-action="take-compare"]').isDisabled())
    && !(await page.locator('[data-action="take-play"]').isDisabled()));
  check('comparing is on after a recording',
    await page.locator('[data-action="take-compare"]')
      .evaluate(el => el.classList.contains('active')));

  // The take should survive a reload of the same song.
  const stored = await page.evaluate(() => localStorage.getItem('keyfall.lastTake'));
  check('the take is persisted', !!stored && JSON.parse(stored).take?.notes?.length > 0,
    (stored || '').slice(0, 60));

  await page.locator('[data-action="take-play"]').click();
  await sleep(150);
  check('hear-take toggles on', await page.locator('[data-action="take-play"]')
    .evaluate(el => el.classList.contains('active')));
  await page.locator('[data-action="play"]').click();
  await sleep(600);
  await page.locator('[data-action="stop"]').click();

  check('no console errors', errors.length === 0, errors.join(' | '));
} finally {
  await browser?.close();
  vite.kill('SIGKILL');
}

finish('recording');
