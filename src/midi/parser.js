import { MIDDLE_C } from '../shared/constants.js';

export function parseMIDI(buffer) {
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
    let val = 0, b;
    do {
      b = readU8();
      val = (val << 7) | (b & 0x7F);
    } while (b & 0x80);
    return val;
  };

  if (readStr(4) !== 'MThd') throw new Error('Not a MIDI file');
  readU32();
  const format = readU16();
  const numTracks = readU16();
  const ticksPerBeat = readU16();

  const tracks = [];
  for (let t = 0; t < numTracks; t++) {
    if (readStr(4) !== 'MTrk') throw new Error('Invalid track chunk');
    const trackLen = readU32();
    const trackEnd = pos + trackLen;

    const events = [];
    let runningStatus = 0;

    while (pos < trackEnd) {
      const delta = readVarLen();
      let statusByte = data.getUint8(pos);

      if (statusByte & 0x80) { pos++; runningStatus = statusByte; }
      else { statusByte = runningStatus; }

      const cmd = statusByte & 0xF0;
      const ch = statusByte & 0x0F;

      if (statusByte === 0xFF) {
        const type = readU8();
        const len = readVarLen();
        const metaData = new Uint8Array(buffer, pos, len);
        pos += len;
        events.push({ delta, meta: true, type, data: metaData });
      } else if (statusByte === 0xF0 || statusByte === 0xF7) {
        const len = readVarLen();
        pos += len;
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
  }

  const tempoMap = [{ tick: 0, tempo: 500000, time: 0 }];
  for (const track of tracks) {
    let tick = 0;
    for (const ev of track) {
      tick += ev.delta;
      if (ev.meta && ev.type === 0x51 && ev.data.length === 3) {
        const tempo = (ev.data[0] << 16) | (ev.data[1] << 8) | ev.data[2];
        tempoMap.push({ tick, tempo, time: 0 });
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
    const activeNotes = {};
    for (const ev of tracks[t]) {
      tick += ev.delta;
      if (!ev.cmd) continue;
      const cmd = ev.cmd & 0xF0;

      if (cmd === 0x90 && ev.vel > 0) {
        const key = `${ev.note}-${ev.ch}`;
        activeNotes[key] = { midi: ev.note, startTick: tick, velocity: ev.vel, ch: ev.ch };
      } else if (cmd === 0x80 || (cmd === 0x90 && ev.vel === 0)) {
        const key = `${ev.note}-${ev.ch}`;
        if (activeNotes[key]) {
          notes.push({
            midi: ev.note,
            startTime: tickToTime(activeNotes[key].startTick),
            endTime: tickToTime(tick),
            velocity: activeNotes[key].velocity,
            track: t,
            ch: ev.ch,
            played: false,
            hit: false,
          });
          delete activeNotes[key];
        }
      }
    }
  }

  notes.sort((a, b) => a.startTime - b.startTime);

  const trackNoteCount = {};
  for (const n of notes) trackNoteCount[n.track] = (trackNoteCount[n.track] || 0) + 1;
  const usedTracks = Object.keys(trackNoteCount).map(Number).filter(t => trackNoteCount[t] > 0);

  if (usedTracks.length === 1) {
    for (const n of notes) n.track = n.midi >= MIDDLE_C ? 0 : 1;
  } else if (usedTracks.length >= 2) {
    const mapping = {};
    usedTracks.forEach((t, i) => { mapping[t] = i < 2 ? i : i % 2; });
    for (const n of notes) n.track = mapping[n.track] ?? 0;
  }

  const duration = notes.length > 0 ? Math.max(...notes.map(n => n.endTime)) : 0;

  return { notes, duration, format, tracks: usedTracks.length, tempoMap, ticksPerBeat };
}
