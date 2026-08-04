#!/usr/bin/env node
// Maintainer tool. Builds public/samples/piano/ from the Salamander Grand
// Piano V3 sample set published on npm as @audio-samples/piano-mp3-velocity*.
//
// Not part of `npm run build` — the output is committed, so contributors and
// CI never need to run this. Re-run it only to change the layer set or the
// encoding, then commit what it produces.
//
// The upstream samples are stereo and generously long: four velocity layers
// as shipped are ~21 MB, which is too much to bundle. This pipeline
//
//   1. decodes each MP3 in Chromium (the only decoder available here),
//      resampling to 32 kHz on the way — a piano's top note is 4.2 kHz, so
//      16 kHz of bandwidth is plenty
//   2. downmixes to mono, which for a practice tool is arguably better than
//      stereo anyway
//   3. trims the tail once it drops below -60 dBFS, capped per register, with
//      a short fade so the cut is inaudible
//   4. re-encodes mono MP3 via lamejs
//
// Usage:
//   node scripts/build-piano-samples.mjs            # build everything
//   node scripts/build-piano-samples.mjs --dry-run  # report sizes only
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

const run = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(repoRoot, 'public', 'samples', 'piano');
const dryRun = process.argv.includes('--dry-run');

// Salamander ships 16 velocity layers. Four, well spread, give usable
// dynamics without quadrupling the download for diminishing returns.
const LAYERS = [
  { pkg: '@audio-samples/piano-mp3-velocity2',  suffix: 'v2',  velocity: 30 },
  { pkg: '@audio-samples/piano-mp3-velocity7',  suffix: 'v7',  velocity: 60 },
  { pkg: '@audio-samples/piano-mp3-velocity11', suffix: 'v11', velocity: 90 },
  { pkg: '@audio-samples/piano-mp3-velocity16', suffix: 'v16', velocity: 127 },
];

const TARGET_RATE = 32000;
const BITRATE = 80;
const SILENCE_DB = -60;
const FADE_SEC = 0.12;

// Longest we keep a sample, by register. Bass strings genuinely ring for
// many seconds; the top octave is done almost immediately.
function maxSeconds(midi) {
  if (midi < 36) return 9;
  if (midi < 60) return 7;
  if (midi < 84) return 4.5;
  return 2.5;
}

const NOTE_TO_SEMITONE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };

// "D#3v7.mp3" -> { midi, name }
function parseSampleName(file, suffix) {
  const m = new RegExp(`^([A-G]#?)(-?\\d)${suffix}\\.mp3$`).exec(file);
  if (!m) return null;
  const semitone = NOTE_TO_SEMITONE[m[1]];
  if (semitone === undefined) return null;
  return { midi: (Number(m[2]) + 1) * 12 + semitone, note: `${m[1]}${m[2]}` };
}

function loadLame() {
  const require = createRequire(import.meta.url);
  let bundlePath;
  try {
    bundlePath = path.join(path.dirname(require.resolve('lamejs/package.json')), 'lame.min.js');
  } catch {
    console.error('lamejs is not installed. Run: npm i --no-save lamejs');
    process.exit(1);
  }
  // lamejs 1.2's module entry is broken (MPEGMode is not defined); the
  // prebuilt bundle is fine, but it expects to assign to a global.
  const ctx = { window: {}, self: {}, console };
  ctx.global = ctx;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(bundlePath, 'utf8'), ctx);
  const lame = ctx.lamejs || ctx.window.lamejs;
  if (!lame?.Mp3Encoder) {
    console.error('Could not load lamejs from its prebuilt bundle.');
    process.exit(1);
  }
  return lame;
}

async function fetchLayer(pkg, workDir) {
  const dir = path.join(workDir, pkg.replace(/[@/]/g, '_'));
  await mkdir(dir, { recursive: true });
  const { stdout } = await run('npm', ['pack', pkg, '--silent'], { cwd: dir });
  const tgz = stdout.trim().split('\n').pop();
  await run('tar', ['xzf', tgz], { cwd: dir });
  return path.join(dir, 'package', 'audio');
}

function chromiumExecutable() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!base || !existsSync(base)) return undefined;
  const dir = readdirSync(base).filter(d => /^chromium-\d+$/.test(d)).sort().pop();
  if (!dir) return undefined;
  const exe = path.join(base, dir, 'chrome-linux', 'chrome');
  return existsSync(exe) ? exe : undefined;
}

async function main() {
  const lame = loadLame();
  const require = createRequire(import.meta.url);
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.error('playwright is not installed. Run: npm i --no-save playwright lamejs');
    process.exit(1);
  }

  const workDir = path.join(tmpdir(), `keyfall-samples-${process.pid}`);
  await mkdir(workDir, { recursive: true });

  console.log('Fetching Salamander sample layers from npm…');
  const layerDirs = [];
  for (const layer of LAYERS) {
    process.stdout.write(`  ${layer.pkg} … `);
    layerDirs.push(await fetchLayer(layer.pkg, workDir));
    console.log('ok');
  }

  const browser = await chromium.launch({ executablePath: chromiumExecutable() });
  const page = await (await browser.newContext()).newPage();
  // decodeAudioData needs a document; about:blank is enough.
  await page.goto('about:blank');

  if (!dryRun) {
    await rm(outDir, { recursive: true, force: true });
    await mkdir(outDir, { recursive: true });
  }

  const manifest = {
    name: 'Salamander Grand Piano V3',
    license: 'CC-BY-3.0',
    attribution: 'Alexander Holm — Salamander Grand Piano V3, CC BY 3.0',
    sampleRate: TARGET_RATE,
    layers: [],
  };

  let totalIn = 0;
  let totalOut = 0;

  for (let li = 0; li < LAYERS.length; li++) {
    const layer = LAYERS[li];
    const dir = layerDirs[li];
    const files = (await readdir(dir)).filter(f => f.endsWith('.mp3')).sort();
    const entries = [];

    console.log(`\nLayer ${layer.suffix} (velocity ≤ ${layer.velocity}) — ${files.length} samples`);
    for (const file of files) {
      const parsed = parseSampleName(file, layer.suffix);
      if (!parsed) { console.log(`  skip ${file} (unrecognised name)`); continue; }

      const raw = await readFile(path.join(dir, file));
      totalIn += raw.length;

      // Decode + trim inside the page; hand back 16-bit mono PCM as base64
      // so we're not shipping a huge JSON array across the bridge.
      const pcmB64 = await page.evaluate(async ({ b64, rate, silenceDb, maxSec, fadeSec }) => {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

        // Decoding in a context at the target rate resamples for free.
        const ctx = new OfflineAudioContext(1, 1, rate);
        const buf = await ctx.decodeAudioData(bytes.buffer);

        // Downmix to mono.
        const n = buf.length;
        const mono = new Float32Array(n);
        for (let c = 0; c < buf.numberOfChannels; c++) {
          const data = buf.getChannelData(c);
          for (let i = 0; i < n; i++) mono[i] += data[i];
        }
        for (let i = 0; i < n; i++) mono[i] /= buf.numberOfChannels;

        let peak = 0;
        for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(mono[i]));
        if (peak === 0) return '';

        // Trim where the tail falls under the noise floor, capped per register.
        const floor = peak * Math.pow(10, silenceDb / 20);
        let end = n;
        while (end > 1 && Math.abs(mono[end - 1]) < floor) end--;
        end = Math.min(end, Math.floor(maxSec * rate));

        const fade = Math.min(Math.floor(fadeSec * rate), end);
        for (let i = 0; i < fade; i++) {
          mono[end - fade + i] *= 1 - i / fade;
        }

        const pcm = new Int16Array(end);
        for (let i = 0; i < end; i++) {
          const v = Math.max(-1, Math.min(1, mono[i]));
          pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
        }
        const out = new Uint8Array(pcm.buffer);
        let s = '';
        for (let i = 0; i < out.length; i += 0x8000) {
          s += String.fromCharCode.apply(null, out.subarray(i, i + 0x8000));
        }
        return btoa(s);
      }, {
        b64: raw.toString('base64'),
        rate: TARGET_RATE,
        silenceDb: SILENCE_DB,
        maxSec: maxSeconds(parsed.midi),
        fadeSec: FADE_SEC,
      });

      if (!pcmB64) { console.log(`  skip ${file} (silent)`); continue; }

      const pcm = new Int16Array(Buffer.from(pcmB64, 'base64').buffer);
      const encoder = new lame.Mp3Encoder(1, TARGET_RATE, BITRATE);
      const chunks = [];
      const BLOCK = 1152;
      for (let i = 0; i < pcm.length; i += BLOCK) {
        const block = pcm.subarray(i, i + BLOCK);
        const buf = encoder.encodeBuffer(block);
        if (buf.length > 0) chunks.push(Buffer.from(buf));
      }
      const tail = encoder.flush();
      if (tail.length > 0) chunks.push(Buffer.from(tail));
      const mp3 = Buffer.concat(chunks);
      totalOut += mp3.length;

      const outName = `${parsed.note.replace('#', 's')}_${layer.suffix}.mp3`;
      if (!dryRun) await writeFile(path.join(outDir, outName), mp3);

      entries.push({ midi: parsed.midi, file: outName });
      process.stdout.write(
        `  ${parsed.note.padEnd(4)} ${(raw.length / 1024).toFixed(0).padStart(4)}K -> ` +
        `${(mp3.length / 1024).toFixed(0).padStart(4)}K  (${(pcm.length / TARGET_RATE).toFixed(1)}s)\n`);
    }

    entries.sort((a, b) => a.midi - b.midi);
    manifest.layers.push({ id: layer.suffix, maxVelocity: layer.velocity, samples: entries });
  }

  await browser.close();
  await rm(workDir, { recursive: true, force: true });

  if (!dryRun) {
    await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    await writeFile(path.join(outDir, 'LICENSE.txt'),
      'Salamander Grand Piano V3\n' +
      'Recorded by Alexander Holm.\n' +
      'Licensed under Creative Commons Attribution 3.0 (CC BY 3.0).\n' +
      'https://creativecommons.org/licenses/by/3.0/\n\n' +
      'Samples here were downmixed to mono, resampled to 32 kHz, tail-trimmed\n' +
      `and re-encoded at ${BITRATE} kbps for size. Sourced from the\n` +
      '@audio-samples/piano-mp3-velocity* npm packages.\n');
  }

  console.log(`\n${dryRun ? '[dry run] ' : ''}` +
    `input ${(totalIn / 1024 / 1024).toFixed(1)} MB -> output ${(totalOut / 1024 / 1024).toFixed(1)} MB ` +
    `(${(100 - (totalOut / totalIn) * 100).toFixed(0)}% smaller)`);
  if (!dryRun) console.log(`Wrote ${outDir}`);
}

await main();
