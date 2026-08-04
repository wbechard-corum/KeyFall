// Fingering assignment, solfège naming, and key-signature parsing.
import { check, finish, note, repoRoot, sleep,
         loadPlaywrightOptional, chromiumExecutable, waitForHttp } from './helpers.mjs';
import { spawn } from 'node:child_process';
import { assignFingering } from '../src/trainer/fingering.js';
import { solfegeName, tonicPitchClass, SOLFEGE } from '../src/shared/constants.js';
import { parseMIDI } from '../src/midi/parser.js';

function song(specs) {
  const notes = specs.map(([midi, startTime, dur = 0.2, track = 0]) => ({
    midi, startTime, endTime: startTime + dur, velocity: 80, track,
    played: false, hit: false,
  }));
  notes.sort((a, b) => a.startTime - b.startTime);
  return { notes, duration: 10, name: 'test' };
}

// ── 1. Fingering basics ──────────────────────────────────────────────────
console.log('fingering');
{
  // Ascending C major scale, right hand.
  const scale = song([60, 62, 64, 65, 67, 69, 71, 72].map((m, i) => [m, i * 0.5]));
  assignFingering(scale);
  const fingers = scale.notes.map(n => n.finger);
  check('every note gets a finger', fingers.every(f => Number.isInteger(f)), JSON.stringify(fingers));
  check('fingers stay in 1-5', fingers.every(f => f >= 1 && f <= 5), JSON.stringify(fingers));
  check('consecutive fingers differ on stepwise motion',
    fingers.every((f, i) => i === 0 || f !== fingers[i - 1]), JSON.stringify(fingers));
  // The standard right-hand C major fingering. The thumb tucks after the
  // third finger, which is both comfortable and leaves exactly enough fingers
  // to finish the octave 1-2-3-4-5.
  check('an ascending RH C major scale is fingered 1 2 3 1 2 3 4 5',
    fingers.join(' ') === '1 2 3 1 2 3 4 5', fingers.join(' '));

  const down = song([72, 71, 69, 67, 65, 64, 62, 60].map((m, i) => [m, i * 0.5]));
  assignFingering(down);
  check('a descending RH C major scale is fingered 5 4 3 2 1 3 2 1',
    down.notes.map(n => n.finger).join(' ') === '5 4 3 2 1 3 2 1',
    down.notes.map(n => n.finger).join(' '));

  const lhUp = song([48, 50, 52, 53, 55, 57, 59, 60].map((m, i) => [m, i * 0.5, 0.2, 1]));
  assignFingering(lhUp);
  check('an ascending LH C major scale is fingered 5 4 3 2 1 3 2 1',
    lhUp.notes.map(n => n.finger).join(' ') === '5 4 3 2 1 3 2 1',
    lhUp.notes.map(n => n.finger).join(' '));

  // A short run has no reason to tuck.
  const short = song([[60, 0], [62, 0.5], [64, 1.0], [65, 1.5]]);
  assignFingering(short);
  check('a short run just walks up the hand',
    short.notes.map(n => n.finger).join(' ') === '1 2 3 4',
    short.notes.map(n => n.finger).join(' '));

  // Repeated note keeps the same finger — you don't re-finger a repetition.
  const repeated = song([[60, 0], [60, 0.5], [60, 1.0]]);
  assignFingering(repeated);
  const rf = repeated.notes.map(n => n.finger);
  check('a repeated note keeps its finger', new Set(rf).size === 1, JSON.stringify(rf));
}

// ── 2. Chords spread the hand, and the thumb sits correctly ──────────────
console.log('chord fingering');
{
  // Right-hand C major triad: thumb on the bottom.
  const rh = song([[60, 0], [64, 0], [67, 0]]);
  assignFingering(rh);
  const byPitchR = [...rh.notes].sort((a, b) => a.midi - b.midi).map(n => n.finger);
  check('right hand: thumb on the lowest note', byPitchR[0] === 1, JSON.stringify(byPitchR));
  check('right hand: fingers ascend with pitch',
    byPitchR.every((f, i) => i === 0 || f > byPitchR[i - 1]), JSON.stringify(byPitchR));

  // Left-hand triad: thumb on top, little finger on the bottom.
  const lh = song([[48, 0, 0.2, 1], [52, 0, 0.2, 1], [55, 0, 0.2, 1]]);
  assignFingering(lh);
  const byPitchL = [...lh.notes].sort((a, b) => a.midi - b.midi).map(n => n.finger);
  check('left hand: thumb on the highest note', byPitchL[byPitchL.length - 1] === 1,
    JSON.stringify(byPitchL));
  check('left hand: fingers descend as pitch rises',
    byPitchL.every((f, i) => i === 0 || f < byPitchL[i - 1]), JSON.stringify(byPitchL));

  const five = song([[60, 0], [62, 0], [64, 0], [65, 0], [67, 0]]);
  assignFingering(five);
  const f5 = [...five.notes].sort((a, b) => a.midi - b.midi).map(n => n.finger);
  check('a five-note chord uses all five fingers',
    new Set(f5).size === 5, JSON.stringify(f5));

  // More notes than fingers must not produce a 6th finger or a duplicate crash.
  const dense = song([60, 62, 64, 65, 67, 69, 71].map(m => [m, 0]));
  assignFingering(dense);
  check('an over-full chord still yields legal fingers',
    dense.notes.every(n => n.finger >= 1 && n.finger <= 5),
    JSON.stringify(dense.notes.map(n => n.finger)));
}

// ── 3. Hands are fingered independently ──────────────────────────────────
console.log('two hands');
{
  const both = song([
    [72, 0, 0.2, 0], [74, 0.5, 0.2, 0],
    [48, 0, 0.2, 1], [50, 0.5, 0.2, 1],
  ]);
  assignFingering(both);
  check('both hands get fingering', both.notes.every(n => n.finger >= 1 && n.finger <= 5),
    JSON.stringify(both.notes.map(n => `${n.midi}:${n.finger}`)));
  // The left hand's ascending step should move toward the thumb, the right
  // hand's away from it — the hands are mirrored.
  const r = both.notes.filter(n => n.track === 0).sort((a, b) => a.startTime - b.startTime);
  const l = both.notes.filter(n => n.track === 1).sort((a, b) => a.startTime - b.startTime);
  check('ascending moves the hands in opposite finger directions',
    Math.sign(r[1].finger - r[0].finger) === -Math.sign(l[1].finger - l[0].finger),
    `right ${r[0].finger}->${r[1].finger}, left ${l[0].finger}->${l[1].finger}`);
}

// ── 4. Idempotence and empty input ───────────────────────────────────────
console.log('robustness');
{
  const s = song([[60, 0], [62, 0.5]]);
  assignFingering(s);
  const first = s.notes.map(n => n.finger);
  assignFingering(s);
  check('re-running gives the same answer',
    JSON.stringify(s.notes.map(n => n.finger)) === JSON.stringify(first));

  let threw = false;
  try {
    assignFingering({ notes: [] });
    assignFingering(null);
    assignFingering(undefined);
  } catch { threw = true; }
  check('empty and missing songs are handled', !threw);
}

// ── 5. Solfège ───────────────────────────────────────────────────────────
console.log('solfège');
{
  check('twelve syllables', SOLFEGE.length === 12);
  check('fixed do: C is Do', solfegeName(60) === 'Do', solfegeName(60));
  check('fixed do: G is Sol', solfegeName(67) === 'Sol', solfegeName(67));
  check('fixed do: octaves agree', solfegeName(60) === solfegeName(72));
  check('fixed do: D is Re regardless of key',
    solfegeName(62, { movable: false, keySignature: { sharps: 2, minor: false } }) === 'Re');

  // Movable do: in D major (2 sharps) the tonic D becomes Do.
  const dMajor = { sharps: 2, minor: false };
  check('movable do: tonic of D major is D', tonicPitchClass(dMajor) === 2, `${tonicPitchClass(dMajor)}`);
  check('movable do: D is Do in D major',
    solfegeName(62, { movable: true, keySignature: dMajor }) === 'Do',
    solfegeName(62, { movable: true, keySignature: dMajor }));
  check('movable do: A is Sol in D major',
    solfegeName(69, { movable: true, keySignature: dMajor }) === 'Sol',
    solfegeName(69, { movable: true, keySignature: dMajor }));

  // A minor (no sharps, minor flag) has tonic A.
  const aMinor = { sharps: 0, minor: true };
  check('movable do: tonic of A minor is A', tonicPitchClass(aMinor) === 9, `${tonicPitchClass(aMinor)}`);
  check('movable do: A is Do in A minor',
    solfegeName(69, { movable: true, keySignature: aMinor }) === 'Do');

  check('movable do with no key falls back to C',
    solfegeName(60, { movable: true, keySignature: null }) === 'Do');

  // Every scale degree in C major should map to the seven natural syllables.
  const natural = [0, 2, 4, 5, 7, 9, 11].map(pc => solfegeName(60 + pc));
  check('the C major scale reads Do Re Mi Fa Sol La Ti',
    natural.join(' ') === 'Do Re Mi Fa Sol La Ti', natural.join(' '));
}

// ── 6. Key signature comes out of the MIDI file ──────────────────────────
console.log('key signature parsing');
{
  const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const u16 = (n) => [(n >>> 8) & 255, n & 255];
  const str = (s) => [...s].map(c => c.charCodeAt(0));
  const build = (sharps, minor) => {
    const body = [
      0x00, 0xff, 0x59, 0x02, sharps & 0xff, minor,
      0x00, 0x90, 60, 100,
      0x60, 0x80, 60, 0,
      0x00, 0xff, 0x2f, 0x00,
    ];
    return new Uint8Array([
      ...str('MThd'), ...u32(6), ...u16(0), ...u16(1), ...u16(480),
      ...str('MTrk'), ...u32(body.length), ...body,
    ]).buffer;
  };

  const d = parseMIDI(build(2, 0));
  check('sharps are read', d.keySignature?.sharps === 2, JSON.stringify(d.keySignature));
  check('major is read', d.keySignature?.minor === false, JSON.stringify(d.keySignature));

  const f = parseMIDI(build(-1, 0));   // F major: one flat, stored as -1
  check('flats decode as negative', f.keySignature?.sharps === -1, JSON.stringify(f.keySignature));

  const am = parseMIDI(build(0, 1));
  check('minor is read', am.keySignature?.minor === true, JSON.stringify(am.keySignature));

  const none = parseMIDI(new Uint8Array([
    ...str('MThd'), ...u32(6), ...u16(0), ...u16(1), ...u16(480),
    ...str('MTrk'), ...u32(4), 0x00, 0xff, 0x2f, 0x00,
  ]).buffer);
  check('a file with no key signature reports null', none.keySignature === null,
    JSON.stringify(none.keySignature));
}

// ── 7. The labels actually render ────────────────────────────────────────
const chromium = await loadPlaywrightOptional();
if (!chromium) {
  note('browser checks skipped — playwright not installed (npm run test:setup)');
  finish('labels');
}
const vite = spawn('npx', ['vite', '--port', '5215', '--strictPort'], {
  cwd: repoRoot, stdio: 'ignore',
});
let browser;
try {
  if (!await waitForHttp('http://127.0.0.1:5215/')) throw new Error('vite never came up');
  browser = await chromium.launch({ executablePath: chromiumExecutable() });
  const page = await (await browser.newContext()).newPage();
  await page.route('**/api/**', r => r.fulfill({ status: 200, body: '[]', contentType: 'application/json' }));
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://127.0.0.1:5215/', { waitUntil: 'networkidle' });
  await sleep(300);

  console.log('label settings');
  await page.locator('.demo-item').first().click();
  await sleep(200);
  await page.locator('.mode-tab[data-mode="settings"]').click();
  await sleep(300);

  check('the falling-note label row exists',
    await page.locator('[data-role="note-label-mode"] button').count() === 3);
  check('the solfège row is hidden while note names are selected',
    await page.locator('[data-role="solfege-row"]').isHidden());

  await page.locator('[data-role="note-label-mode"] button[data-value="solfege"]').click();
  await sleep(250);
  check('choosing solfège reveals the fixed/movable choice',
    await page.locator('[data-role="solfege-row"]').isVisible());

  await page.locator('[data-role="fingering-mode"] button[data-value="auto"]').click();
  await sleep(250);
  check('fingering can be switched on',
    await page.locator('[data-role="fingering-mode"] button[data-value="auto"]')
      .evaluate(el => el.classList.contains('active')));

  // Back to the trainer: the renderer should have picked the settings up and
  // the song's notes should now carry fingering.
  await page.locator('.mode-tab[data-mode="trainer"]').click();
  await sleep(300);
  const applied = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('keyfall.settings') || '{}');
    return { noteLabelMode: s.noteLabelMode, fingeringMode: s.fingeringMode };
  });
  check('settings persisted', applied.noteLabelMode === 'solfege' && applied.fingeringMode === 'auto',
    JSON.stringify(applied));

  await page.locator('[data-action="play"]').click();
  await sleep(700);
  await page.locator('[data-action="play"]').click();
  check('no console errors with labels and fingering on',
    errors.length === 0, errors.join(' | '));
} finally {
  await browser?.close();
  vite.kill('SIGKILL');
}

finish('labels');
