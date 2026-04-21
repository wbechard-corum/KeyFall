// KeyFall pair-mirror relay.
//
// Clients open a WebSocket, register as either `host` or `client` with a short
// pair code, and any messages they send afterwards are relayed to all other
// peers sharing the same code. The server does not inspect payloads and keeps
// zero persistent state — rooms live only as long as at least one peer is
// connected.

import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT || 3030);
const HOST = process.env.HOST || '0.0.0.0';
const ROOM_MAX_PEERS = Number(process.env.ROOM_MAX_PEERS || 4);
const PING_INTERVAL_MS = 30_000;

const rooms = new Map(); // code -> Set<ws>

function genCode() {
  // 6-digit numeric code. Easy to read, type on a phone.
  let code;
  do {
    code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
  } while (rooms.has(code));
  return code;
}

function send(ws, obj) {
  if (ws.readyState !== 1) return;
  try { ws.send(JSON.stringify(obj)); } catch { /* best effort */ }
}

function broadcast(room, sender, msg) {
  for (const peer of room) {
    if (peer === sender) continue;
    send(peer, msg);
  }
}

function removeFromRoom(ws) {
  const code = ws._code;
  if (!code) return;
  const room = rooms.get(code);
  if (!room) return;
  room.delete(ws);
  broadcast(room, ws, { type: 'peer-left', role: ws._role });
  if (room.size === 0) rooms.delete(code);
}

function handleMessage(ws, raw) {
  let msg;
  try { msg = JSON.parse(raw.toString()); }
  catch { return send(ws, { type: 'error', reason: 'bad_json' }); }

  switch (msg.type) {
    case 'register-host': {
      if (ws._code) return send(ws, { type: 'error', reason: 'already_registered' });
      const code = genCode();
      const room = new Set([ws]);
      rooms.set(code, room);
      ws._code = code;
      ws._role = 'host';
      send(ws, { type: 'registered', role: 'host', code, peers: room.size });
      return;
    }

    case 'join': {
      if (ws._code) return send(ws, { type: 'error', reason: 'already_registered' });
      const code = String(msg.code || '').trim();
      const room = rooms.get(code);
      if (!room) return send(ws, { type: 'error', reason: 'room_not_found' });
      if (room.size >= ROOM_MAX_PEERS) return send(ws, { type: 'error', reason: 'room_full' });
      room.add(ws);
      ws._code = code;
      ws._role = 'client';
      send(ws, { type: 'joined', role: 'client', code, peers: room.size });
      broadcast(room, ws, { type: 'peer-joined', role: 'client' });
      return;
    }

    case 'leave':
      removeFromRoom(ws);
      ws._code = null;
      ws._role = null;
      send(ws, { type: 'left' });
      return;

    case 'ping':
      return send(ws, { type: 'pong', t: msg.t });

    case 'state':
    case 'intent':
    case 'custom': {
      const room = rooms.get(ws._code);
      if (!room) return;
      // Tag sender role so the receiver can ignore its own echoes.
      broadcast(room, ws, { ...msg, from: ws._role });
      return;
    }

    default:
      return send(ws, { type: 'error', reason: 'unknown_type', got: msg.type });
  }
}

const http = createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }
  res.writeHead(426, { 'Content-Type': 'text/plain' });
  res.end('Upgrade to WebSocket required');
});

const wss = new WebSocketServer({ server: http, path: '/ws' });

wss.on('connection', (ws) => {
  ws._code = null;
  ws._role = null;
  ws._alive = true;

  ws.on('pong', () => { ws._alive = true; });
  ws.on('message', (raw) => handleMessage(ws, raw));
  ws.on('close', () => removeFromRoom(ws));
  ws.on('error', () => removeFromRoom(ws));

  send(ws, { type: 'hello', version: 1 });
});

// Liveness check: drop dead sockets that never responded to a ping.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws._alive) {
      try { ws.terminate(); } catch { /* noop */ }
      continue;
    }
    ws._alive = false;
    try { ws.ping(); } catch { /* noop */ }
  }
}, PING_INTERVAL_MS);

wss.on('close', () => clearInterval(heartbeat));

http.listen(PORT, HOST, () => {
  console.log(`KeyFall relay listening ws://${HOST}:${PORT}/ws`);
});

function shutdown() {
  console.log('Relay shutting down…');
  for (const ws of wss.clients) { try { ws.close(1001, 'server-shutdown'); } catch { /* noop */ } }
  http.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
