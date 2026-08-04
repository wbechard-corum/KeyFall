import { MIDDLE_C } from '../shared/constants.js';

// Accept an ArrayBuffer, a TypedArray, or a Node Buffer. Callers hand us
// whatever `FileReader`/`Response.arrayBuffer()`/the mirror client produced,
// and a TypedArray with a non-zero byteOffset would silently make every
// absolute read in here point at the wrong bytes.
function toArrayBuffer(input) {
  if (input instanceof ArrayBuffer) return input;
  if (ArrayBuffer.isView(input)) {
    return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  }
  throw new Error('Expected an ArrayBuffer or TypedArray of MIDI bytes');
}

function latin1(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return s.trim();
}

export function parseMIDI(input) {
  const buffer = toArrayBuffer(input);
  const data = new DataView(buffer);
  let pos = 0;

  const readStr = (len) => {
    let s = '';
    for (let i = 0; i < len; i++) s += String.fromCharCode(data.getUint8(pos++));
    return s;
  };
  const readU32 = () => { const v = data.getUint32(pos); pos += 4; return v; };
  const readU16 = () => { const v = data.getUint16(pos); pos += 2; return v; };
  const readU8 = () => data.getUint8(pos++);
  const readVarLen = () => {
    let val = 0, b, count = 0;
    do {
      if (pos >= data.byteLength || count >= 4) {
        throw new Error('Malformed variable-length quantity');
      }
      b = readU8();
      val = (val << 7) | (b & 0x7F);
      count++;
    } while (b & 0x80);
    return val;
  };

  if (readStr(4) !== 'MThd') throw new Error('Not a MIDI file');
  readU32();
  const format = readU16();
  if (format !== 0 && format !== 1) {
    throw new Error(`Unsupported MIDI format ${format} (only formats 0 and 1 are supported)`);
  }
  const numTracks = readU16();
  const ticksPerBeat = readU16();
  if (ticksPerBeat & 0x8000) {
    throw new Error('SMPTE timecode MIDI files are not supported (only ticks-per-beat timing)');
  }

  const tracks = [];
  const trackNames = [];
  for (let t = 0; t < numTracks; t++) {
    // Some writers pad between chunks or emit unknown chunk types; the spec
    // says skip any chunk whose id isn't MTrk rather than bailing out.
    while (pos + 8 <= data.byteLength) {
      const id = readStr(4);
      const len = readU32();
      if (id === 'MTrk') { pos -= 8; break; }
      pos += len;
    }
    if (pos + 8 > data.byteLength) break;   // truncated file — keep what we have
    pos += 4;                                // consume the 'MTrk' we peeked at
    const trackLen = readU32();
    const trackEnd = Math.min(pos + trackLen, data.byteLength);

    const events = [];
    let runningStatus = 0;
    let name = '';

    while (pos < trackEnd) {
      const delta = readVarLen();
      if (pos >= trackEnd) break;
      let statusByte = data.getUint8(pos);

      if (statusByte & 0x80) {
        pos++;
        // Running status only carries across channel voice messages. System
        // messages (0xF0–0xFF) cancel it; keeping 0xFF here made every
        // following running-status event re-parse as a meta event.
        runningStatus = statusByte < 0xF0 ? statusByte : 0;
      } else {
        if (!runningStatus) { pos++; continue; }   // data byte with no status — skip
        statusByte = runningStatus;
      }

      const cmd = statusByte & 0xF0;
      const ch = statusByte & 0x0F;

      if (statusByte === 0xFF) {
        const type = readU8();
        const len = readVarLen();
        const end = Math.min(pos + len, trackEnd);
        const metaData = new Uint8Array(buffer, pos, Math.max(0, end - pos));
        if (type === 0x03 && !name) name = latin1(metaData);
        pos = end;
        events.push({ delta, meta: true, type, data: metaData });
      } else if (statusByte === 0xF0 || statusByte === 0xF7) {
        const len = readVarLen();
        pos = Math.min(pos + len, trackEnd);
        events.push({ delta, sysex: true });
      } else if (cmd === 0x90 || cmd === 0x80) {
        const note = readU8();
        const vel = readU8();
        events.push({ delta, cmd, ch, note, vel });
      } else if (cmd === 0xA0 || cmd === 0xB0 || cmd === 0xE0) {
        readU8(); readU8();
        events.push({ delta, cmd, ch });
      } else if (cmd === 0xC0 || cmd === 0xD0) {
        readU8();
        events.push({ delta, cmd, ch });
      } else {
        events.push({ delta });
      }
    }

    pos = trackEnd;
    tracks.push(events);
    trackNames.push(name);
  }

  const tempoMap = [{ tick: 0, tempo: 500000, time: 0 }];
  // Meta 0x59: sharps/flats as a signed byte, then 0 major / 1 minor. Used
  // for movable-do solfège, which is meaningless without knowing the key.
  let keySignature = null;
  for (const track of tracks) {
    let tick = 0;
    for (const ev of track) {
      tick += ev.delta;
      if (ev.meta && ev.type === 0x51 && ev.data.length === 3) {
        const tempo = (ev.data[0] << 16) | (ev.data[1] << 8) | ev.data[2];
        tempoMap.push({ tick, tempo, time: 0 });
      } else if (ev.meta && ev.type === 0x59 && ev.data.length >= 2 && keySignature === null) {
        const sharps = ev.data[0] > 127 ? ev.data[0] - 256 : ev.data[0];
        if (sharps >= -7 && sharps <= 7) {
          keySignature = { sharps, minor: ev.data[1] === 1 };
        }
      }
    }
  }
  tempoMap.sort((a, b) => a.tick - b.tick);
  for (let i = 1; i < tempoMap.length; i++) {
    const prev = tempoMap[i - 1];
    const dt = tempoMap[i].tick - prev.tick;
    tempoMap[i].time = prev.time + (dt / ticksPerBeat) * (prev.tempo / 1_000_000);
  }

  const tickToTime = (tick) => {
    let entry = tempoMap[0];
    for (let i = 1; i < tempoMap.length; i++) {
      if (tempoMap[i].tick <= tick) entry = tempoMap[i];
      else break;
    }
    const dt = tick - entry.tick;
    return entry.time + (dt / ticksPerBeat) * (entry.tempo / 1_000_000);
  };

  const notes = [];
  for (let t = 0; t < tracks.length; t++) {
    let tick = 0;
    let lastTick = 0;
    // Stack per (note, channel) so a note retriggered before its note-off
    // still produces two notes instead of the first one vanishing.
    const activeNotes = new Map();
    const emit = (pending, endTick) => {
      notes.push({
        midi: pending.midi,
        startTime: tickToTime(pending.startTick),
        endTime: tickToTime(endTick),
        velocity: pending.velocity,
        track: t,
        ch: pending.ch,
        played: false,
        hit: false,
      });
    };

    for (const ev of tracks[t]) {
      tick += ev.delta;
      lastTick = tick;
      if (!ev.cmd) continue;
      const cmd = ev.cmd & 0xF0;
      const key = ev.note * 16 + ev.ch;

      if (cmd === 0x90 && ev.vel > 0) {
        let stack = activeNotes.get(key);
        if (!stack) { stack = []; activeNotes.set(key, stack); }
        stack.push({ midi: ev.note, startTick: tick, velocity: ev.vel, ch: ev.ch });
      } else if (cmd === 0x80 || (cmd === 0x90 && ev.vel === 0)) {
        const stack = activeNotes.get(key);
        if (stack && stack.length > 0) {
          emit(stack.shift(), tick);
          if (stack.length === 0) activeNotes.delete(key);
        }
      }
    }

    // A note-on with no matching note-off (truncated or sloppily written
    // file) used to be dropped entirely, silently losing notes. Close it
    // at the end of the track instead.
    for (const stack of activeNotes.values()) {
      for (const pending of stack) emit(pending, Math.max(lastTick, pending.startTick + ticksPerBeat));
    }
  }

  notes.sort((a, b) => a.startTime - b.startTime);

  const stats = new Map();   // track index → { count, pitchSum }
  for (const n of notes) {
    let s = stats.get(n.track);
    if (!s) { s = { count: 0, pitchSum: 0 }; stats.set(n.track, s); }
    s.count++;
    s.pitchSum += n.midi;
  }
  const usedTracks = [...stats.keys()].sort((a, b) => a - b);

  if (usedTracks.length === 1) {
    for (const n of notes) n.track = n.midi >= MIDDLE_C ? 0 : 1;
  } else if (usedTracks.length >= 2) {
    // Assign hands by average pitch rather than by track order. The old
    // `i % 2` alternation put track 3 of a 5-track arrangement on the right
    // hand purely because of its index, which is wrong for most scores.
    // A track named like a hand ("Right Hand", "L.H.", "Bass") wins outright.
    const scored = usedTracks.map(t => ({
      track: t,
      hinted: handHint(trackNames[t]),
      mean: stats.get(t).pitchSum / stats.get(t).count,
    }));
    const byPitch = [...scored].sort((a, b) => b.mean - a.mean);
    const mapping = new Map();
    for (const entry of scored) {
      if (entry.hinted !== null) mapping.set(entry.track, entry.hinted);
    }
    // Everything unhinted: highest-average track is the right hand, the
    // rest fall to the left. With exactly two tracks this reduces to the
    // familiar "melody on top, accompaniment below".
    const unhinted = byPitch.filter(e => !mapping.has(e.track));
    unhinted.forEach((entry, i) => mapping.set(entry.track, i === 0 ? 0 : 1));
    for (const n of notes) n.track = mapping.get(n.track) ?? 0;
  }

  // Spreading a big array into Math.max blows the call stack on dense
  // files (`RangeError` past ~120k notes), so fold instead.
  let duration = 0;
  for (const n of notes) if (n.endTime > duration) duration = n.endTime;

  return { notes, duration, format, tracks: usedTracks.length, trackNames,
           tempoMap, ticksPerBeat, keySignature };
}

// Returns 0 (right), 1 (left), or null when the name says nothing useful.
function handHint(name) {
  if (!name) return null;
  const s = name.toLowerCase();
  if (/\b(right|r\.?h\.?|treble|melody|soprano)\b/.test(s)) return 0;
  if (/\b(left|l\.?h\.?|bass|accomp\w*)\b/.test(s)) return 1;
  return null;
}
