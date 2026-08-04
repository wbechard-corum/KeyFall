// Runs the Vite dev server and the songs/mirror backend together, so the
// Songs tab and sheet-music view work out of the box. Vite proxies /api and
// /mirror/ws to the backend (see vite.config.js).
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR || path.join(repoRoot, '.data');
mkdirSync(dataDir, { recursive: true });

const children = [];
function run(name, cmd, args, env = {}) {
  const child = spawn(cmd, args, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
  const tag = `\x1b[2m[${name}]\x1b[0m `;
  const relay = (stream, out) => {
    stream.on('data', (d) => {
      for (const line of String(d).split('\n')) {
        if (line.trim()) out.write(tag + line + '\n');
      }
    });
  };
  relay(child.stdout, process.stdout);
  relay(child.stderr, process.stderr);
  child.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(`${tag}exited with code ${code} — shutting down`);
      shutdown(code ?? 1);
    }
  });
  children.push(child);
  return child;
}

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) { try { c.kill('SIGTERM'); } catch { /* already gone */ } }
  setTimeout(() => process.exit(code), 200);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log(`KeyFall dev — song storage in ${dataDir}`);
run('server', process.execPath, ['server/mirror-server.js'], { DATA_DIR: dataDir });
run('vite', 'npx', ['vite']);
