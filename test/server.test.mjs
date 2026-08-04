// Boots the real mirror-server against a temp DATA_DIR and exercises the
// songs API + mirror relay over the network.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { repoRoot, serverDir, check, finish, sleep, loadWs, waitForHttp, sampleMidiBytes } from './helpers.mjs';

const WebSocket = await loadWs();


const PORT = 8899;
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = await mkdtemp(path.join(tmpdir(), 'keyfall-test-'));

// Minimal valid MIDI file: one note.
function midiBytes() {
  const body = [0x00, 0x90, 0x3c, 0x64, 0x81, 0x70, 0x80, 0x3c, 0x00, 0x00, 0xff, 0x2f, 0x00];
  return Buffer.from([
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0,
    0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, body.length, ...body,
  ]);
}

const server = spawn(process.execPath, ['mirror-server.js'], {
  cwd: serverDir,
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, NOTATION_CMD: '/bin/false' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', d => { serverLog += d; });
server.stderr.on('data', d => { serverLog += d; });

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${BASE}/healthz`);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}

async function main() {
  if (!await waitForServer()) throw new Error(`server never came up:\n${serverLog}`);

  // ── 1. Concurrent uploads must all survive in the index ────────────────
  console.log('concurrent uploads (index read-modify-write race)');
  {
    const N = 25;
    const uploads = Array.from({ length: N }, (_, i) =>
      fetch(`${BASE}/api/songs?name=${encodeURIComponent('Song ' + i)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: midiBytes(),
      }).then(r => r.json()));
    const created = await Promise.all(uploads);
    check(`all ${N} uploads returned an id`, created.every(r => r.id), JSON.stringify(created.slice(0, 2)));

    const listed = await (await fetch(`${BASE}/api/songs`)).json();
    check(`all ${N} songs present in the index`, listed.length === N,
      `index has ${listed.length}`);
    const names = new Set(listed.map(r => r.name));
    check('no upload lost its name', names.size === N, `${names.size} distinct names`);
  }

  // ── 2. Non-MIDI uploads are rejected ───────────────────────────────────
  console.log('upload validation');
  {
    const res = await fetch(`${BASE}/api/songs?name=bogus`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: Buffer.from('this is definitely not a midi file'),
    });
    check('non-MIDI payload rejected with 415', res.status === 415, `got ${res.status}`);
    const listed = await (await fetch(`${BASE}/api/songs`)).json();
    check('rejected upload did not enter the index', listed.length === 25, `${listed.length}`);
  }

  // ── 3. CRLF in a song name must not break the download ─────────────────
  console.log('header injection via song name');
  {
    const evil = 'Bad\r\nX-Injected: yes\r\n\r\nName';
    const created = await (await fetch(`${BASE}/api/songs?name=${encodeURIComponent(evil)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: midiBytes(),
    })).json();
    check('upload with CRLF name succeeds', !!created.id, JSON.stringify(created));
    check('stored name has no CR/LF', !/[\r\n]/.test(created.name), JSON.stringify(created.name));

    const dl = await fetch(`${BASE}/api/songs/${created.id}`);
    check('download succeeds (no ERR_INVALID_CHAR 500)', dl.status === 200, `got ${dl.status}`);
    check('no injected header appeared', dl.headers.get('x-injected') === null);
    const body = Buffer.from(await dl.arrayBuffer());
    check('body is the MIDI file', body.equals(midiBytes()), `${body.length} bytes`);
    check('content-length matches body',
      Number(dl.headers.get('content-length')) === body.length,
      `${dl.headers.get('content-length')} vs ${body.length}`);
    check('content-disposition carries a usable name',
      /filename=/.test(dl.headers.get('content-disposition') || ''),
      dl.headers.get('content-disposition'));
  }

  // ── 4. Rename sanitises too, and delete removes the notation file ──────
  console.log('rename + delete');
  {
    const created = await (await fetch(`${BASE}/api/songs?name=Temp`, {
      method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: midiBytes(),
    })).json();
    const renamed = await (await fetch(`${BASE}/api/songs/${created.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Clean\r\nName' }),
    })).json();
    check('renamed name is sanitised', !/[\r\n]/.test(renamed.name), JSON.stringify(renamed.name));

    const del = await fetch(`${BASE}/api/songs/${created.id}`, { method: 'DELETE' });
    check('delete returns ok', del.status === 200, `got ${del.status}`);
    const after = await (await fetch(`${BASE}/api/songs/${created.id}`)).status;
    check('deleted song is gone', after === 404, `got ${after}`);
  }

  // ── 5. Index file on disk stays valid JSON throughout ──────────────────
  console.log('index integrity');
  {
    const raw = await readFile(path.join(dataDir, 'songs', 'index.json'), 'utf8');
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch { /* leave null */ }
    check('index.json is valid JSON', Array.isArray(parsed), raw.slice(0, 80));
    check('index has no duplicate ids',
      parsed && new Set(parsed.map(r => r.id)).size === parsed.length);
  }

  // ── 6. Mirror relay: host/join/state/cmd round trip ────────────────────
  console.log('mirror relay');
  {
    const wsUrl = `ws://127.0.0.1:${PORT}/mirror/ws`;
    const host = new WebSocket(wsUrl);
    const code = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('host timeout')), 5000);
      host.on('open', () => host.send(JSON.stringify({ type: 'host' })));
      host.on('message', (raw) => {
        const m = JSON.parse(raw);
        if (m.type === 'hosted') { clearTimeout(t); resolve(m.code); }
      });
      host.on('error', reject);
    });
    check('host got a 6-digit code', /^\d{6}$/.test(code), code);

    host.send(JSON.stringify({ type: 'state', payload: { trainer: { playing: true } } }));
    await new Promise(r => setTimeout(r, 50));

    const client = new WebSocket(wsUrl);
    const gotState = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('client timeout')), 5000);
      client.on('open', () => client.send(JSON.stringify({ type: 'join', code })));
      client.on('message', (raw) => {
        const m = JSON.parse(raw);
        if (m.type === 'state') { clearTimeout(t); resolve(m.payload); }
      });
      client.on('error', reject);
    });
    const state = await gotState;
    check('late-joining client receives the last state', state?.trainer?.playing === true,
      JSON.stringify(state));

    const gotCmd = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('cmd timeout')), 5000);
      host.on('message', (raw) => {
        const m = JSON.parse(raw);
        if (m.type === 'cmd') { clearTimeout(t); resolve(m.payload); }
      });
    });
    client.send(JSON.stringify({ type: 'cmd', payload: { target: 'trainer', action: 'play' } }));
    const cmd = await gotCmd;
    check('client command reaches the host', cmd?.action === 'play', JSON.stringify(cmd));

    host.close(); client.close();
  }

  // ── 7. Room codes are not sequential / predictable ─────────────────────
  console.log('room code randomness');
  {
    const wsUrl = `ws://127.0.0.1:${PORT}/mirror/ws`;
    const codes = [];
    const sockets = [];
    for (let i = 0; i < 12; i++) {
      const ws = new WebSocket(wsUrl);
      sockets.push(ws);
      codes.push(await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout')), 5000);
        ws.on('open', () => ws.send(JSON.stringify({ type: 'host' })));
        ws.on('message', (raw) => {
          const m = JSON.parse(raw);
          if (m.type === 'hosted') { clearTimeout(t); resolve(m.code); }
        });
        ws.on('error', reject);
      }));
    }
    check('all codes unique', new Set(codes).size === codes.length, codes.join(','));
    const diffs = codes.slice(1).map((c, i) => Math.abs(Number(c) - Number(codes[i])));
    check('codes are not near-sequential', diffs.every(d => d > 1), codes.join(','));
    for (const s of sockets) s.close();
  }

  // ── 8. Brute-force join attempts get throttled ─────────────────────────
  console.log('join throttling');
  {
    const wsUrl = `ws://127.0.0.1:${PORT}/mirror/ws`;
    let throttled = false;
    for (let i = 0; i < 30 && !throttled; i++) {
      const ws = new WebSocket(wsUrl);
      const reason = await new Promise((resolve) => {
        const t = setTimeout(() => resolve(null), 3000);
        ws.on('open', () => ws.send(JSON.stringify({ type: 'join', code: '000000' })));
        ws.on('message', (raw) => {
          const m = JSON.parse(raw);
          if (m.type === 'join-error') { clearTimeout(t); resolve(m.reason); }
        });
        ws.on('error', () => { clearTimeout(t); resolve(null); });
      });
      if (reason === 'too-many-attempts') throttled = true;
      ws.close();
    }
    check('repeated bad codes are eventually throttled', throttled);
  }
}

try {
  await main();
} catch (err) {
  check('harness ran to completion', false, err.message);
  console.log(serverLog.slice(-2000));
} finally {
  server.kill('SIGKILL');
  await rm(dataDir, { recursive: true, force: true });
}

finish('server');
