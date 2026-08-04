// Shared plumbing for the test files. Deliberately dependency-free so the
// unit tests run on a bare `npm install` with nothing else set up.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const serverDir = path.join(repoRoot, 'server');

let failures = 0;
export function check(label, cond, extra = '') {
  if (cond) console.log(`  ok   ${label}`);
  else { console.log(`  FAIL ${label} ${extra}`); failures++; }
}
export function note(msg) { console.log(`    ${msg}`); }

export function finish(what) {
  console.log(failures === 0
    ? `\nAll ${what} checks passed.`
    : `\n${failures} ${what} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

// Exit code 64 tells the runner "not applicable here", which it reports as a
// skip rather than a failure. Keeps `npm test` green on a machine without the
// server deps or a browser installed.
export const SKIP = 64;
export function skip(reason) {
  console.log(`  SKIP ${reason}`);
  process.exit(SKIP);
}

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// `ws` is a dependency of server/, not of the app, so resolve it from there.
export async function loadWs() {
  const req = createRequire(path.join(serverDir, 'package.json'));
  let entry;
  try { entry = req.resolve('ws'); }
  catch { skip('server deps not installed — run `npm --prefix server install`'); }
  const mod = await import(`file://${entry}`);
  return mod.default?.WebSocket || mod.WebSocket || mod.default;
}

export async function loadPlaywright() {
  const req = createRequire(path.join(repoRoot, 'package.json'));
  let entry;
  try { entry = req.resolve('playwright'); }
  catch { skip('playwright not installed — run `npm run test:setup`'); }
  const mod = await import(`file://${entry}`);
  return mod.chromium || mod.default?.chromium;
}

// Playwright normally finds its own browser. When PLAYWRIGHT_BROWSERS_PATH
// points at a shared directory (as in CI images), pick the chromium build out
// of it so we don't depend on the exact versioned folder name.
export function chromiumExecutable() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!base || !existsSync(base)) return undefined;
  const dir = readdirSync(base)
    .filter(d => /^chromium-\d+$/.test(d))
    .sort()
    .pop();
  if (!dir) return undefined;
  const exe = path.join(base, dir, 'chrome-linux', 'chrome');
  return existsSync(exe) ? exe : undefined;
}

// Wait for an HTTP endpoint to start answering.
export async function waitForHttp(url, attempts = 150) {
  for (let i = 0; i < attempts; i++) {
    try { if ((await fetch(url)).ok) return true; } catch { /* not up yet */ }
    await sleep(100);
  }
  return false;
}

// A minimal but valid Standard MIDI File containing one note.
export function sampleMidiBytes() {
  const body = [0x00, 0x90, 0x3c, 0x64, 0x81, 0x70, 0x80, 0x3c, 0x00, 0x00, 0xff, 0x2f, 0x00];
  return Buffer.from([
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0,
    0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, body.length, ...body,
  ]);
}
