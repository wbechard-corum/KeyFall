// Verifies that a host reconnecting keeps its room code and that already
// paired clients survive the blip.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { repoRoot, serverDir, check, finish, sleep, loadWs, waitForHttp, sampleMidiBytes } from './helpers.mjs';

const WebSocket = await loadWs();


const PORT = 8901;
const dataDir = await mkdtemp(path.join(tmpdir(), 'keyfall-rc-'));
const server = spawn(process.execPath, ['mirror-server.js'], {
  cwd: serverDir,
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', d => { log += d; });
server.stderr.on('data', d => { log += d; });

const wsUrl = `ws://127.0.0.1:${PORT}/mirror/ws`;

async function waitUp() {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/healthz`)).ok) return true; }
    catch { /* not up */ }
    await sleep(100);
  }
  return false;
}

// Open a socket and collect every message it receives.
function open() {
  const ws = new WebSocket(wsUrl);
  ws.inbox = [];
  ws.on('message', raw => ws.inbox.push(JSON.parse(raw)));
  return new Promise((resolve, reject) => {
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}
function waitFor(ws, type, ms = 3000) {
  return new Promise((resolve, reject) => {
    const found = ws.inbox.find(m => m.type === type);
    if (found) return resolve(found);
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), ms);
    const h = (raw) => {
      const m = JSON.parse(raw);
      if (m.type === type) { clearTimeout(t); ws.off('message', h); resolve(m); }
    };
    ws.on('message', h);
  });
}

async function main() {
  if (!await waitUp()) throw new Error(`server never came up:\n${log}`);

  console.log('host reconnect keeps the room code');
  const host1 = await open();
  host1.send(JSON.stringify({ type: 'host', code: null }));
  const { code } = await waitFor(host1, 'hosted');
  check('initial host gets a code', /^\d{6}$/.test(code), code);

  const client = await open();
  client.send(JSON.stringify({ type: 'join', code }));
  await waitFor(client, 'joined');
  check('client joined the room', true);

  host1.send(JSON.stringify({ type: 'state', payload: { trainer: { song: 'before' } } }));
  await waitFor(client, 'state');

  // Host drops (simulating a Wi-Fi blip) and reconnects asking for its code.
  host1.close();
  await waitFor(client, 'host-gone');
  check('client is told the host went away', true);

  await sleep(100);
  const host2 = await open();
  host2.send(JSON.stringify({ type: 'host', code }));
  const resumed = await waitFor(host2, 'hosted');
  check('reconnecting host keeps the same code', resumed.code === code,
    `${resumed.code} vs ${code}`);
  check('server marks it as resumed', resumed.resumed === true, JSON.stringify(resumed));

  const back = await waitFor(client, 'host-back');
  check('client is told the host is back', back.type === 'host-back');

  // The original client never had to reconnect — state should flow again.
  client.inbox.length = 0;
  host2.send(JSON.stringify({ type: 'state', payload: { trainer: { song: 'after' } } }));
  const st = await waitFor(client, 'state');
  check('state flows to the still-connected client', st.payload?.trainer?.song === 'after',
    JSON.stringify(st.payload));

  // And commands still route back to the new host socket.
  client.send(JSON.stringify({ type: 'cmd', payload: { target: 'trainer', action: 'stop' } }));
  const cmd = await waitFor(host2, 'cmd');
  check('commands reach the reconnected host', cmd.payload?.action === 'stop',
    JSON.stringify(cmd.payload));

  console.log('a stranger still cannot claim an occupied room');
  const intruder = await open();
  intruder.send(JSON.stringify({ type: 'host', code }));
  const got = await waitFor(intruder, 'hosted');
  check('claiming a live room yields a different code', got.code !== code,
    `${got.code} vs ${code}`);

  host2.close(); client.close(); intruder.close();
}

try {
  await main();
} catch (err) {
  check('harness ran to completion', false, err.message);
  console.log(log.slice(-1500));
} finally {
  server.kill('SIGKILL');
  await rm(dataDir, { recursive: true, force: true });
}

finish('reconnect');
