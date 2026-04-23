import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import { createReadStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const PORT = Number(process.env.PORT || 8081);
const ROOM_IDLE_MS = Number(process.env.ROOM_IDLE_MS || 10 * 60 * 1000);
const DATA_DIR = process.env.DATA_DIR || '/data';
const SONGS_DIR = path.join(DATA_DIR, 'songs');
const INDEX_FILE = path.join(SONGS_DIR, 'index.json');
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 5 * 1024 * 1024);

// ───────── Song storage ─────────

async function ensureStorage() {
  await fs.mkdir(SONGS_DIR, { recursive: true });
  try { await fs.access(INDEX_FILE); }
  catch { await fs.writeFile(INDEX_FILE, '[]'); }
}

async function readIndex() {
  const raw = await fs.readFile(INDEX_FILE, 'utf8');
  try { return JSON.parse(raw); } catch { return []; }
}

async function writeIndex(rows) {
  const tmp = INDEX_FILE + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(rows, null, 2));
  await fs.rename(tmp, INDEX_FILE);
}

async function listSongs() {
  const rows = await readIndex();
  return rows.sort((a, b) => b.addedAt - a.addedAt);
}

async function createSong(name, bytes) {
  const id = randomUUID();
  const filename = `${id}.mid`;
  await fs.writeFile(path.join(SONGS_DIR, filename), Buffer.from(bytes));
  const rows = await readIndex();
  const record = { id, name, filename, size: bytes.byteLength ?? bytes.length, addedAt: Date.now() };
  rows.push(record);
  await writeIndex(rows);
  return record;
}

async function getSongRecord(id) {
  const rows = await readIndex();
  return rows.find(r => r.id === id) || null;
}

async function deleteSongById(id) {
  const rows = await readIndex();
  const idx = rows.findIndex(r => r.id === id);
  if (idx === -1) return false;
  const [record] = rows.splice(idx, 1);
  await writeIndex(rows);
  try { await fs.unlink(path.join(SONGS_DIR, record.filename)); } catch { /* already gone */ }
  return true;
}

// ───────── HTTP helpers ─────────

function sendJson(res, status, body) {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': buf.length,
  });
  res.end(buf);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', chunk => {
      total += chunk.length;
      if (total > limit) {
        req.destroy();
        reject(Object.assign(new Error('payload too large'), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ───────── Mirror WebSocket ─────────

const rooms = new Map();

function newCode() {
  let code;
  do {
    code = String(Math.floor(100000 + Math.random() * 900000));
  } while (rooms.has(code));
  return code;
}

function touch(room) { room.lastActivity = Date.now(); }

function sweepIdleRooms() {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (!room.host && room.clients.size === 0 && now - room.lastActivity > ROOM_IDLE_MS) {
      rooms.delete(code);
    }
  }
}

setInterval(sweepIdleRooms, 60 * 1000).unref?.();

function wsSend(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcastToClients(room, msg, exclude) {
  for (const c of room.clients) {
    if (c !== exclude) wsSend(c, msg);
  }
}

// ───────── HTTP routes ─────────

const http = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const { pathname } = url;

    if (pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
      return;
    }

    if (pathname === '/api/songs' && req.method === 'GET') {
      const rows = await listSongs();
      sendJson(res, 200, rows.map(r => ({ id: r.id, name: r.name, size: r.size, addedAt: r.addedAt })));
      return;
    }

    if (pathname === '/api/songs' && req.method === 'POST') {
      const name = (url.searchParams.get('name') || 'Untitled').slice(0, 200);
      const bytes = await readBody(req, MAX_UPLOAD_BYTES);
      if (bytes.length === 0) { sendJson(res, 400, { error: 'empty body' }); return; }
      const record = await createSong(name, bytes);
      sendJson(res, 201, { id: record.id, name: record.name, size: record.size, addedAt: record.addedAt });
      return;
    }

    const songMatch = pathname.match(/^\/api\/songs\/([a-f0-9-]{36})$/i);
    if (songMatch) {
      const id = songMatch[1];
      if (req.method === 'GET') {
        const record = await getSongRecord(id);
        if (!record) { sendJson(res, 404, { error: 'not found' }); return; }
        res.writeHead(200, {
          'content-type': 'audio/midi',
          'content-length': record.size,
          'content-disposition': `attachment; filename="${record.name.replace(/"/g, '')}.mid"`,
        });
        createReadStream(path.join(SONGS_DIR, record.filename)).pipe(res);
        return;
      }
      if (req.method === 'DELETE') {
        const ok = await deleteSongById(id);
        sendJson(res, ok ? 200 : 404, { ok });
        return;
      }
    }

    res.writeHead(404);
    res.end();
  } catch (err) {
    const status = err.status || 500;
    if (!res.headersSent) sendJson(res, status, { error: err.message || 'error' });
    else res.end();
  }
});

// ───────── WS server (mirror) ─────────

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
      wsSend(ws, { type: 'hosted', code });
      return;
    }

    if (msg.type === 'join') {
      if (ws.role) return;
      const code = String(msg.code || '').trim();
      const room = rooms.get(code);
      if (!room || !room.host) {
        wsSend(ws, { type: 'join-error', reason: 'not-found' });
        ws.close();
        return;
      }
      ws.role = 'client';
      ws.code = code;
      room.clients.add(ws);
      touch(room);
      wsSend(ws, { type: 'joined', code });
      if (room.lastState) wsSend(ws, { type: 'state', payload: room.lastState });
      wsSend(room.host, { type: 'peer-joined' });
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
      wsSend(room.host, { type: 'cmd', payload: msg.payload });
      return;
    }
  });

  ws.on('close', () => {
    if (!ws.code) return;
    const room = rooms.get(ws.code);
    if (!room) return;
    if (ws.role === 'host') {
      for (const c of room.clients) wsSend(c, { type: 'host-gone' });
      room.host = null;
      rooms.delete(ws.code);
    } else if (ws.role === 'client') {
      room.clients.delete(ws);
      if (room.host) wsSend(room.host, { type: 'peer-left' });
      touch(room);
    }
  });
});

// ───────── Boot ─────────

await ensureStorage();

http.listen(PORT, () => {
  console.log(`KeyFall server (songs API + mirror relay) listening on :${PORT}`);
  console.log(`Song storage: ${SONGS_DIR}`);
});
