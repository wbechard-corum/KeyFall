import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import { createReadStream } from 'node:fs';
import { randomUUID, randomInt } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';

const PORT = Number(process.env.PORT || 8081);
const ROOM_IDLE_MS = Number(process.env.ROOM_IDLE_MS || 10 * 60 * 1000);
const DATA_DIR = process.env.DATA_DIR || '/data';
const SONGS_DIR = path.join(DATA_DIR, 'songs');
const INDEX_FILE = path.join(SONGS_DIR, 'index.json');
const INDEX_BACKUP = path.join(SONGS_DIR, 'index.json.backup');
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 5 * 1024 * 1024);
const MSCORE_CMD = process.env.NOTATION_CMD || 'midi2xml';
const CONVERSION_TIMEOUT_MS = Number(process.env.CONVERSION_TIMEOUT_MS || 60 * 1000);

// ───────── Song storage ─────────

async function ensureStorage() {
  await fs.mkdir(SONGS_DIR, { recursive: true });
  // Best-effort restore from backup if the live index is missing
  // or empty but the backup looks fine. Catches the previous
  // race-condition damage at boot.
  let liveOk = false;
  try {
    const stat = await fs.stat(INDEX_FILE);
    liveOk = stat.size > 2;  // anything bigger than "[]" is interesting
  } catch { liveOk = false; }
  if (!liveOk) {
    try {
      const backupStat = await fs.stat(INDEX_BACKUP);
      if (backupStat.size > 2) {
        await fs.copyFile(INDEX_BACKUP, INDEX_FILE);
        console.log('Restored index.json from backup.');
        return;
      }
    } catch { /* no backup, continue */ }
  }
  try { await fs.access(INDEX_FILE); }
  catch { await fs.writeFile(INDEX_FILE, '[]'); }
}

async function readIndex() {
  let raw;
  try { raw = await fs.readFile(INDEX_FILE, 'utf8'); }
  catch { return []; }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

async function persistIndex(rows) {
  const tmp = INDEX_FILE + '.tmp';
  const json = JSON.stringify(rows, null, 2);
  await fs.writeFile(tmp, json);
  await fs.rename(tmp, INDEX_FILE);
  // Maintain a backup so the next boot has something to recover
  // from if the live file is corrupted again.
  try { await fs.writeFile(INDEX_BACKUP, json); }
  catch (e) { console.warn('index backup write failed:', e.message); }
}

// Every index change runs read → mutate → write as one serialised unit.
//
// Serialising only the *write* (as this used to) still left the read-modify-
// write open: two uploads landing together both read the same array, each
// appended its own record, and whichever wrote last clobbered the other's
// entry. The .mid file stayed on disk but vanished from the library — which
// is exactly what recoverOrphanSongs() below was papering over.
let indexChain = Promise.resolve();
function mutateIndex(mutator) {
  const run = indexChain.then(async () => {
    const rows = await readIndex();
    const result = await mutator(rows);
    await persistIndex(rows);
    return result;
  });
  // Keep the chain healthy even if this particular mutation throws.
  indexChain = run.then(() => {}, () => {});
  return run;
}

// Song names reach us from a query string and from PATCH bodies, and end up
// in a Content-Disposition header. Strip control characters (a bare CR/LF
// would either inject a header or make Node throw ERR_INVALID_CHAR and 500
// the download) and collapse whitespace.
function cleanName(raw) {
  const s = String(raw ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  return s || 'Untitled';
}

// Content-Disposition filename: ASCII-only, no quotes or path separators.
function dispositionFilename(name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\/]/g, '_');
  return ascii.trim() || 'song';
}

async function listSongs() {
  const rows = await readIndex();
  return rows.sort((a, b) => b.addedAt - a.addedAt);
}

async function createSong(name, bytes) {
  const id = randomUUID();
  const filename = `${id}.mid`;
  await fs.writeFile(path.join(SONGS_DIR, filename), Buffer.from(bytes));
  const record = {
    id, name, filename,
    size: bytes.byteLength ?? bytes.length,
    addedAt: Date.now(),
    starred: false,
    notationStatus: 'pending',
  };
  await mutateIndex(rows => { rows.push(record); });
  // Kick off conversion in the background — uploads stay snappy and
  // the song is playable immediately; the staff just lights up once
  // the .musicxml lands.
  scheduleConversion(record.id).catch(err =>
    console.warn(`Conversion enqueue failed for ${record.id}:`, err.message));
  return record;
}

// ───────── MIDI → MusicXML conversion ─────────

function notationPath(id) {
  return path.join(SONGS_DIR, `${id}.musicxml`);
}

function convertMidi(srcPath, outPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(MSCORE_CMD, [srcPath, outPath], { stdio: 'pipe' });
    let stderr = '';
    proc.stderr.on('data', chunk => { stderr += chunk.toString(); });
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`mscore timed out after ${CONVERSION_TIMEOUT_MS}ms`));
    }, CONVERSION_TIMEOUT_MS);
    proc.on('error', err => { clearTimeout(timer); reject(err); });
    proc.on('exit', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`mscore exit ${code}: ${stderr.slice(0, 400)}`));
    });
  });
}

// Single-file mutex to keep mscore invocations sequential. Running
// many xvfb sessions in parallel chews RAM and gains nothing.
let conversionChain = Promise.resolve();
async function scheduleConversion(id) {
  conversionChain = conversionChain.then(() => runConversion(id));
  return conversionChain;
}

async function runConversion(id) {
  const rows = await readIndex();
  const row = rows.find(r => r.id === id);
  if (!row) return;
  const src = path.join(SONGS_DIR, row.filename);
  const dst = notationPath(id);
  try {
    await fs.access(src);
  } catch {
    await markStatus(id, 'failed');
    return;
  }
  try {
    await convertMidi(src, dst);
    const stat = await fs.stat(dst).catch(() => null);
    if (!stat || stat.size === 0) throw new Error('output empty');
    await markStatus(id, 'ready', { converter: MSCORE_CMD, conversionError: null });
  } catch (err) {
    const msg = err.message || String(err);
    console.warn(`MIDI→MusicXML conversion failed for ${id}: ${msg}`);
    await markStatus(id, 'failed', { converter: MSCORE_CMD, conversionError: msg.slice(0, 400) });
  }
}

async function markStatus(id, status, extra = {}) {
  await mutateIndex(rows => {
    const row = rows.find(r => r.id === id);
    if (!row) return;
    row.notationStatus = status;
    for (const k of Object.keys(extra)) row[k] = extra[k];
  });
}

async function backfillNotation() {
  const rows = await readIndex();
  let queued = 0;
  for (const row of rows) {
    const dst = notationPath(row.id);
    const have = await fs.stat(dst).then(s => s.size > 0).catch(() => false);
    if (have) {
      if (row.notationStatus !== 'ready') await markStatus(row.id, 'ready', { converter: MSCORE_CMD });
      continue;
    }
    // Retry failed entries when the converter has changed since the
    // last attempt. Stops boot from spinning on permanently-broken
    // MIDIs once they've failed under the current converter too.
    if (row.notationStatus === 'failed' && row.converter === MSCORE_CMD) continue;
    await markStatus(row.id, 'pending');
    scheduleConversion(row.id);
    queued += 1;
  }
  if (queued > 0) console.log(`Backfilling notation for ${queued} song(s) using ${MSCORE_CMD}…`);
}

// If the index has lost track of a .mid file that's actually on
// disk, re-add it with a placeholder name. ensureStorage() already
// restores from index.json.backup when possible, so this only kicks
// in for genuine orphans (a file appeared in the volume that was
// never in any index — usually only happens if someone scp'd a MIDI
// straight into /data/songs).
async function recoverOrphanSongs() {
  let entries;
  try { entries = await fs.readdir(SONGS_DIR); }
  catch { return 0; }

  // Stat everything up front so the mutation below stays synchronous and
  // can't interleave with a concurrent upload.
  const candidates = [];
  const now = Date.now();
  for (const name of entries) {
    const m = name.match(/^([a-f0-9-]{36})\.mid$/i);
    if (!m) continue;
    const full = path.join(SONGS_DIR, name);
    let stat;
    try { stat = await fs.stat(full); } catch { continue; }
    candidates.push({ id: m[1], filename: name, size: stat.size, addedAt: stat.mtimeMs || now });
  }
  if (candidates.length === 0) return 0;

  const recovered = await mutateIndex(rows => {
    const known = new Set(rows.map(r => r.id));
    let count = 0;
    for (const c of candidates) {
      if (known.has(c.id)) continue;
      rows.push({
        id: c.id,
        name: `Recovered ${c.id.slice(0, 8)}`,
        filename: c.filename,
        size: c.size,
        addedAt: c.addedAt,
        starred: false,
        notationStatus: 'pending',
      });
      count += 1;
    }
    if (count > 0) rows.sort((a, b) => a.addedAt - b.addedAt);
    return count;
  });

  if (recovered > 0) {
    console.log(`Recovered ${recovered} orphan song(s) from disk; added to index with placeholder names.`);
  }
  return recovered;
}

async function getSongRecord(id) {
  const rows = await readIndex();
  return rows.find(r => r.id === id) || null;
}

async function patchSong(id, patch) {
  return mutateIndex(rows => {
    const row = rows.find(r => r.id === id);
    if (!row) return null;
    if (typeof patch.name === 'string') {
      row.name = cleanName(patch.name);
    }
    if (typeof patch.starred === 'boolean') {
      row.starred = patch.starred;
    }
    return row;
  });
}

async function deleteSongById(id) {
  const record = await mutateIndex(rows => {
    const idx = rows.findIndex(r => r.id === id);
    if (idx === -1) return null;
    return rows.splice(idx, 1)[0];
  });
  if (!record) return false;
  // Delete the generated .musicxml too — it used to be left behind, so
  // every deleted song leaked its notation file onto the volume forever.
  for (const p of [path.join(SONGS_DIR, record.filename), notationPath(id)]) {
    try { await fs.unlink(p); } catch { /* already gone */ }
  }
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

// A room code is the only thing standing between a stranger and full remote
// control of someone's MIDI rig, so draw it from the CSPRNG rather than
// Math.random(), whose state is recoverable from a couple of observed codes.
function newCode() {
  let code;
  do {
    code = String(100000 + randomInt(900000));
  } while (rooms.has(code));
  return code;
}

function touch(room) { room.lastActivity = Date.now(); }

function sweepIdleRooms() {
  const now = Date.now();
  for (const [code, room] of rooms) {
    // A room with no host is dead weight regardless of who's still watching
    // it — clients have already been told 'host-gone'. Reap it once the
    // reconnect window has passed so the code can be reused.
    if (!room.host && now - room.lastActivity > ROOM_IDLE_MS) {
      for (const c of room.clients) { c.code = null; }
      rooms.delete(code);
    }
  }
}

setInterval(sweepIdleRooms, 60 * 1000).unref?.();

// Failed-join throttle. A 6-digit code is only a million guesses, and the
// reward for finding a live one is control of someone's keyboard, so cap how
// fast a single address can probe.
const JOIN_FAIL_LIMIT = Number(process.env.JOIN_FAIL_LIMIT || 20);
const JOIN_FAIL_WINDOW_MS = Number(process.env.JOIN_FAIL_WINDOW_MS || 5 * 60 * 1000);
const joinFailures = new Map();   // ip → [timestamp, …]

function recentFailures(ip) {
  const cutoff = Date.now() - JOIN_FAIL_WINDOW_MS;
  const hits = (joinFailures.get(ip) || []).filter(t => t > cutoff);
  if (hits.length > 0) joinFailures.set(ip, hits);
  else joinFailures.delete(ip);
  return hits;
}

function noteJoinFailure(ip) {
  const hits = recentFailures(ip);
  hits.push(Date.now());
  joinFailures.set(ip, hits);
}

function joinThrottled(ip) {
  return recentFailures(ip).length >= JOIN_FAIL_LIMIT;
}

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
      sendJson(res, 200, rows.map(r => ({
        id: r.id, name: r.name, size: r.size,
        addedAt: r.addedAt, starred: !!r.starred,
        notationStatus: r.notationStatus || 'unknown',
      })));
      return;
    }

    if (pathname === '/api/songs' && req.method === 'POST') {
      const name = cleanName(url.searchParams.get('name') || 'Untitled');
      const bytes = await readBody(req, MAX_UPLOAD_BYTES);
      if (bytes.length === 0) { sendJson(res, 400, { error: 'empty body' }); return; }
      // Reject anything that isn't a Standard MIDI File up front, rather
      // than storing it and letting both the parser and the converter fail
      // on it later with confusing errors.
      if (bytes.length < 14 || bytes.toString('latin1', 0, 4) !== 'MThd') {
        sendJson(res, 415, { error: 'not a MIDI file (missing MThd header)' });
        return;
      }
      const record = await createSong(name, bytes);
      sendJson(res, 201, {
        id: record.id, name: record.name, size: record.size,
        addedAt: record.addedAt, starred: !!record.starred,
        notationStatus: record.notationStatus,
      });
      return;
    }

    const songMatch = pathname.match(/^\/api\/songs\/([a-f0-9-]{36})$/i);
    if (songMatch) {
      const id = songMatch[1];
      if (req.method === 'GET') {
        const record = await getSongRecord(id);
        if (!record) { sendJson(res, 404, { error: 'not found' }); return; }
        const file = path.join(SONGS_DIR, record.filename);
        // Length from the file itself, not the index. A restored-from-backup
        // index can disagree with what's on disk, and an over-long
        // content-length leaves the client hanging on a truncated body.
        const stat = await fs.stat(file).catch(() => null);
        if (!stat) { sendJson(res, 404, { error: 'file missing' }); return; }
        res.writeHead(200, {
          'content-type': 'audio/midi',
          'content-length': stat.size,
          'content-disposition':
            `attachment; filename="${dispositionFilename(record.name)}.mid"; ` +
            `filename*=UTF-8''${encodeURIComponent(record.name)}.mid`,
        });
        const stream = createReadStream(file);
        stream.on('error', () => res.destroy());
        stream.pipe(res);
        return;
      }
      if (req.method === 'DELETE') {
        const ok = await deleteSongById(id);
        sendJson(res, ok ? 200 : 404, { ok });
        return;
      }
      if (req.method === 'PATCH') {
        const raw = await readBody(req, 64 * 1024);
        let patch;
        try { patch = JSON.parse(raw.toString('utf8') || '{}'); }
        catch { sendJson(res, 400, { error: 'invalid json' }); return; }
        const updated = await patchSong(id, patch);
        if (!updated) { sendJson(res, 404, { error: 'not found' }); return; }
        sendJson(res, 200, {
          id: updated.id, name: updated.name, size: updated.size,
          addedAt: updated.addedAt, starred: !!updated.starred,
          notationStatus: updated.notationStatus || 'unknown',
        });
        return;
      }
    }

    const notationMatch = pathname.match(/^\/api\/songs\/([a-f0-9-]{36})\/notation$/i);
    if (notationMatch && req.method === 'GET') {
      const id = notationMatch[1];
      const record = await getSongRecord(id);
      if (!record) { sendJson(res, 404, { error: 'not found' }); return; }
      const dst = notationPath(id);
      const stat = await fs.stat(dst).catch(() => null);
      if (!stat || stat.size === 0) {
        sendJson(res, 202, {
          status: record.notationStatus || 'pending',
          error: record.conversionError || null,
        });
        return;
      }
      res.writeHead(200, {
        'content-type': 'application/vnd.recordare.musicxml+xml; charset=utf-8',
        'content-length': stat.size,
        'cache-control': 'private, max-age=300',
      });
      createReadStream(dst).pipe(res);
      return;
    }
    const retryMatch = pathname.match(/^\/api\/songs\/([a-f0-9-]{36})\/notation\/retry$/i);
    if (retryMatch && req.method === 'POST') {
      const id = retryMatch[1];
      const record = await getSongRecord(id);
      if (!record) { sendJson(res, 404, { error: 'not found' }); return; }
      await markStatus(id, 'pending');
      scheduleConversion(id).catch(() => {});
      sendJson(res, 202, { status: 'pending' });
      return;
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

wss.on('connection', (ws, req) => {
  ws.role = null;
  ws.code = null;
  ws.isAlive = true;
  ws.remoteIp = req?.headers?.['x-real-ip']
    || req?.headers?.['x-forwarded-for']?.split(',')[0].trim()
    || req?.socket?.remoteAddress
    || 'unknown';
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'host') {
      if (ws.role) return;
      // A host that reconnects (Wi-Fi blip, phone waking up) asks to keep its
      // previous code. Handing out a fresh one stranded every already-paired
      // iPad, which then retried the old code forever.
      const wanted = String(msg.code || '').trim();
      const existing = /^\d{6}$/.test(wanted) ? rooms.get(wanted) : null;
      if (existing && !existing.host) {
        existing.host = ws;
        touch(existing);
        ws.role = 'host';
        ws.code = wanted;
        wsSend(ws, { type: 'hosted', code: wanted, resumed: true });
        for (const c of existing.clients) wsSend(c, { type: 'host-back' });
        return;
      }
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
      if (joinThrottled(ws.remoteIp)) {
        wsSend(ws, { type: 'join-error', reason: 'too-many-attempts' });
        ws.close();
        return;
      }
      const code = String(msg.code || '').trim();
      const room = rooms.get(code);
      if (!room || !room.host) {
        // Only count a *wrong* code against the throttle. A known room whose
        // host is momentarily reconnecting isn't a guess, and clients retry
        // it on a backoff — charging those would lock out a legitimate iPad.
        if (!room) noteJoinFailure(ws.remoteIp);
        wsSend(ws, { type: 'join-error', reason: room ? 'host-offline' : 'not-found' });
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
      // Keep the room (and its code) around so a reconnecting host can
      // reclaim it. sweepIdleRooms reaps it if the host never comes back.
      touch(room);
    } else if (ws.role === 'client') {
      room.clients.delete(ws);
      if (room.host) wsSend(room.host, { type: 'peer-left' });
      touch(room);
    }
  });
});

// A phone that goes to sleep or drops off Wi-Fi often never sends a TCP FIN,
// so without this the room keeps a dead host forever: clients see "connected"
// and every command they send disappears.
const HEARTBEAT_MS = 30 * 1000;
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* socket already going away */ }
  }
}, HEARTBEAT_MS).unref?.();

// ───────── Boot ─────────

await ensureStorage();
await recoverOrphanSongs().catch(err =>
  console.warn('Orphan recovery failed:', err.message));
backfillNotation().catch(err =>
  console.warn('Notation backfill failed:', err.message));

http.listen(PORT, () => {
  console.log(`KeyFall server (songs API + mirror relay) listening on :${PORT}`);
  console.log(`Song storage: ${SONGS_DIR}`);
});
