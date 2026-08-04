// Runs every test/*.test.mjs in its own process and summarises the result.
// No test framework — each file is a plain node script that exits non-zero on
// failure, or with code 64 to signal "not applicable on this machine".
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const SKIP = 64;

// Order matters only for readability: cheap unit tests first, then the ones
// that boot a server, then the ones that drive a browser.
const ORDER = ['parser', 'playback', 'renderer', 'audio', 'sampler', 'scoring',
               'loop', 'practice', 'labels', 'recording', 'gestures', 'profiles', 'sysex', 'builder', 'docs', 'server', 'reconnect', 'smoke', 'modal-key'];
const rank = (f) => {
  const i = ORDER.indexOf(f.replace(/\.test\.mjs$/, ''));
  return i === -1 ? ORDER.length : i;
};

const filter = process.argv[2];
const files = readdirSync(here)
  .filter(f => f.endsWith('.test.mjs'))
  .filter(f => !filter || f.includes(filter))
  .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

if (files.length === 0) {
  console.error(filter ? `No test files match "${filter}".` : 'No test files found.');
  process.exit(1);
}

const results = [];
for (const file of files) {
  const name = file.replace(/\.test\.mjs$/, '');
  process.stdout.write(`\n\x1b[1m── ${name} ${'─'.repeat(Math.max(0, 56 - name.length))}\x1b[0m\n`);
  const code = await new Promise((resolve) => {
    const p = spawn(process.execPath, ['--stack-size=4000', path.join(here, file)], {
      stdio: 'inherit',
      env: process.env,
    });
    p.on('exit', (c) => resolve(c ?? 1));
    p.on('error', () => resolve(1));
  });
  results.push({ name, code });
}

const pass = results.filter(r => r.code === 0);
const skipped = results.filter(r => r.code === SKIP);
const failed = results.filter(r => r.code !== 0 && r.code !== SKIP);

console.log(`\n\x1b[1m── summary ─────────────────────────────────────────────\x1b[0m`);
for (const r of results) {
  const tag = r.code === 0 ? '\x1b[32mPASS\x1b[0m'
    : r.code === SKIP ? '\x1b[33mSKIP\x1b[0m'
    : '\x1b[31mFAIL\x1b[0m';
  console.log(`  ${tag}  ${r.name}`);
}
console.log(`\n  ${pass.length} passed, ${failed.length} failed, ${skipped.length} skipped`);
process.exit(failed.length > 0 ? 1 : 0);
