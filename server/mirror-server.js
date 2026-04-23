import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT || 8081);
const ROOM_IDLE_MS = Number(process.env.ROOM_IDLE_MS || 10 * 60 * 1000);

// rooms: code -> { host: ws | null, clients: Set<ws>, lastActivity: number }
const rooms = new Map();

function newCode() {
  let code;
  do {
    code = String(Math.floor(100000 + Math.random() * 900000));
  } while (rooms.has(code));
  return code;
}

function touch(room) {
  room.lastActivity = Date.now();
}

function sweepIdleRooms() {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (!room.host && room.clients.size === 0 && now - room.lastActivity > ROOM_IDLE_MS) {
      rooms.delete(code);
    }
  }
}

setInterval(sweepIdleRooms, 60 * 1000).unref?.();

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcastToClients(room, msg, exclude) {
  for (const c of room.clients) {
    if (c !== exclude) send(c, msg);
  }
}

const http = createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: http });

wss.on('connection', (ws) => {
  ws.role = null;
  ws.code = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'host') {
      if (ws.role) return;
      const code = newCode();
      const room = { host: ws, clients: new Set(), lastState: null, lastActivity: Date.now() };
      rooms.set(code, room);
      ws.role = 'host';
      ws.code = code;
      send(ws, { type: 'hosted', code });
      return;
    }

    if (msg.type === 'join') {
      if (ws.role) return;
      const code = String(msg.code || '').trim();
      const room = rooms.get(code);
      if (!room || !room.host) {
        send(ws, { type: 'join-error', reason: 'not-found' });
        ws.close();
        return;
      }
      ws.role = 'client';
      ws.code = code;
      room.clients.add(ws);
      touch(room);
      send(ws, { type: 'joined', code });
      // Replay the most recent host snapshot so a late-joining client
      // sees the current state instead of a blank view.
      if (room.lastState) send(ws, { type: 'state', payload: room.lastState });
      send(room.host, { type: 'peer-joined' });
      return;
    }

    if (msg.type === 'state' && ws.role === 'host') {
      const room = rooms.get(ws.code);
      if (!room) return;
      touch(room);
      room.lastState = msg.payload;
      broadcastToClients(room, { type: 'state', payload: msg.payload }, ws);
      return;
    }

    if (msg.type === 'cmd' && ws.role === 'client') {
      const room = rooms.get(ws.code);
      if (!room || !room.host) return;
      touch(room);
      send(room.host, { type: 'cmd', payload: msg.payload });
      return;
    }
  });

  ws.on('close', () => {
    if (!ws.code) return;
    const room = rooms.get(ws.code);
    if (!room) return;
    if (ws.role === 'host') {
      for (const c of room.clients) send(c, { type: 'host-gone' });
      room.host = null;
      rooms.delete(ws.code);
    } else if (ws.role === 'client') {
      room.clients.delete(ws);
      if (room.host) send(room.host, { type: 'peer-left' });
      touch(room);
    }
  });
});

http.listen(PORT, () => {
  console.log(`KeyFall mirror relay listening on :${PORT}`);
});
