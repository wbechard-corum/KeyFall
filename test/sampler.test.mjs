// Sampled piano: verifies the shipped sample set is complete and coherent,
// and drives the real sampler in Chromium against the real files, rendering
// audio offline to confirm it makes sound and picks the right sample.
import { check, finish, note, sleep, skip, repoRoot,
         loadPlaywrightOptional, chromiumExecutable, waitForHttp } from './helpers.mjs';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const sampleDir = path.join(repoRoot, 'public', 'samples', 'piano');
if (!existsSync(path.join(sampleDir, 'manifest.json'))) {
  skip('piano samples not built — run `node scripts/build-piano-samples.mjs`');
}

// ── 1. The shipped set is complete and internally consistent ─────────────
console.log('sample set');
const manifest = JSON.parse(await readFile(path.join(sampleDir, 'manifest.json'), 'utf8'));
const files = new Set(await readdir(sampleDir));
{
  check('manifest declares layers', Array.isArray(manifest.layers) && manifest.layers.length > 0,
    `${manifest.layers?.length}`);
  check('attribution is recorded', /Salamander/i.test(manifest.attribution || ''),
    manifest.attribution);
  check('licence file ships', files.has('LICENSE.txt'));

  let missing = [];
  for (const layer of manifest.layers) {
    for (const s of layer.samples) if (!files.has(s.file)) missing.push(s.file);
  }
  check('every declared sample exists on disk', missing.length === 0,
    missing.slice(0, 3).join(', '));

  // Velocity bands must ascend and finish at 127, or some velocity has no layer.
  const maxes = manifest.layers.map(l => l.maxVelocity);
  check('velocity bands ascend', maxes.every((v, i) => i === 0 || v > maxes[i - 1]),
    maxes.join(','));
  check('the top band reaches 127', maxes[maxes.length - 1] === 127, `${maxes.at(-1)}`);

  // Pitch coverage: no gap wider than 3 semitones anywhere in the 88 keys.
  for (const layer of manifest.layers) {
    const midis = layer.samples.map(s => s.midi).sort((a, b) => a - b);
    const gaps = midis.slice(1).map((m, i) => m - midis[i]);
    const worst = Math.max(...gaps);
    check(`layer ${layer.id} has no gap wider than 3 semitones`, worst <= 3, `worst gap ${worst}`);
    check(`layer ${layer.id} spans the keyboard`,
      midis[0] <= 21 && midis[midis.length - 1] >= 108,
      `${midis[0]}-${midis[midis.length - 1]}`);
  }
  note(`${manifest.layers.length} layers x ${manifest.layers[0].samples.length} notes`);
}

// ── 2. Drive the real sampler in Chromium ────────────────────────────────
const chromium = await loadPlaywrightOptional();
if (!chromium) {
  note('browser checks skipped — playwright not installed (npm run test:setup)');
  finish('sampler');
}

const vite = spawn('npx', ['vite', '--port', '5211', '--strictPort'], {
  cwd: repoRoot, stdio: 'ignore',
});
let browser;
try {
  if (!await waitForHttp('http://127.0.0.1:5211/')) throw new Error('vite never came up');
  browser = await chromium.launch({ executablePath: chromiumExecutable() });
  const page = await (await browser.newContext()).newPage();
  await page.route('**/api/**', r => r.fulfill({ status: 200, body: '[]', contentType: 'application/json' }));
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.goto('http://127.0.0.1:5211/', { waitUntil: 'networkidle' });

  console.log('loading the sample set');
  const loadResult = await page.evaluate(async () => {
    const sampler = await import('/src/trainer/sampler.js');
    const seen = [];
    sampler.onSamplerStatus(s => seen.push(s.state));
    const ok = await sampler.load();
    const st = sampler.status();
    return { ok, state: st.state, loaded: st.loaded, total: st.total, error: st.error, seen };
  });
  check('the set loads', loadResult.ok === true, loadResult.error || '');
  check('every sample decoded', loadResult.loaded === loadResult.total,
    `${loadResult.loaded}/${loadResult.total}`);
  check('status went idle -> loading -> ready',
    loadResult.seen.includes('loading') && loadResult.seen.at(-1) === 'ready',
    loadResult.seen.join(' -> '));

  console.log('rendering audio');
  // A *fresh* page: audio-context.js caches its AudioContext on first use, so
  // the offline stub has to be installed before anything audio-related is
  // imported. Reusing the page above would render against the real context
  // and measure silence.
  const renderPage = await (await browser.newContext()).newPage();
  await renderPage.route('**/api/**', r => r.fulfill({ status: 200, body: '[]', contentType: 'application/json' }));
  await renderPage.addInitScript(() => {
    window.__offline = new OfflineAudioContext(1, 48000 * 3, 48000);
    window.AudioContext = function () { return window.__offline; };
    window.webkitAudioContext = undefined;
  });
  await renderPage.goto('http://127.0.0.1:5211/', { waitUntil: 'networkidle' });

  const audio = await renderPage.evaluate(async () => {
    const offline = window.__offline;
    const sampler = await import('/src/trainer/sampler.js');
    await sampler.load();

    sampler.noteOn(60, 100);
    sampler.noteOn(64, 100);
    sampler.noteOn(67, 100);

    const buf = await offline.startRendering();

    const d = buf.getChannelData(0);
    const win = (from, to) => {
      let peak = 0, sum = 0;
      const a = Math.floor(from * 48000), b = Math.min(d.length, Math.floor(to * 48000));
      for (let i = a; i < b; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; sum += v * v; }
      return { peak, rms: Math.sqrt(sum / Math.max(1, b - a)) };
    };
    let clipped = 0;
    for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > 0.999) clipped++;
    return { early: win(0.02, 0.5), late: win(2.0, 2.9), clipped };
  });
  check('a chord is audible', audio.early.peak > 0.05, `peak=${audio.early.peak.toFixed(4)}`);
  check('nothing clips', audio.clipped === 0, `${audio.clipped} samples`);
  check('the note decays', audio.late.rms < audio.early.rms,
    `${audio.early.rms.toFixed(4)} -> ${audio.late.rms.toFixed(4)}`);

  console.log('sample and layer selection');
  const picks = await page.evaluate(async () => {
    const sampler = await import('/src/trainer/sampler.js');
    await sampler.load();
    // playbackRate tells us which source sample was chosen: 1.0 means an
    // exact hit, otherwise it's the 2^(semitones/12) shift.
    const probe = (midi, vel) => {
      const v = sampler.noteOn(midi, vel);
      const rate = v ? v.playbackRate : null;
      v?.release(0.001);
      return rate;
    };
    return { c4: probe(60, 100), c4sharp: probe(61, 100), d4: probe(62, 100) };
  });
  // 60 is sampled directly; 61 and 62 shift by at most one semitone.
  const semis = (r) => (r === null ? null : Math.round(Math.log2(r) * 12));
  check('an exactly-sampled note is not pitch-shifted', semis(picks.c4) === 0, `${picks.c4}`);
  check('neighbouring notes shift by at most a semitone',
    [picks.c4sharp, picks.d4].every(r => Math.abs(semis(r)) <= 1),
    JSON.stringify([semis(picks.c4sharp), semis(picks.d4)]));

  console.log('facade fallback');
  const fallback = await page.evaluate(async () => {
    const audio = await import('/src/trainer/audio.js');
    // With the synth selected, the sampler must not be driving anything.
    await audio.setInstrument('synth');
    const synthVoice = audio.noteOn(60, 100);
    audio.noteOff(60);
    // Switching to sampled kicks off a load and should end up ready.
    await audio.setInstrument('sampled');
    const st = audio.samplerStatus();
    const sampledVoice = audio.noteOn(60, 100);
    audio.noteOff(60);
    audio.allNotesOff();
    return { synth: !!synthVoice, sampled: !!sampledVoice, state: st.state, instrument: audio.getInstrument() };
  });
  check('the synth plays when selected', fallback.synth);
  check('selecting sampled loads it', fallback.state === 'ready', fallback.state);
  check('the sampled piano plays', fallback.sampled);
  check('the facade reports the active instrument', fallback.instrument === 'sampled',
    fallback.instrument);

  check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
} finally {
  await browser?.close();
  vite.kill('SIGKILL');
}

finish('sampler');
