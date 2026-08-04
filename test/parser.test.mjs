import { check, finish } from './helpers.mjs';
// Exercises src/midi/parser.js against hand-built MIDI byte streams.
import { parseMIDI } from '../src/midi/parser.js';

const vlq = (n) => {
  const out = [n & 0x7f];
  n >>= 7;
  while (n > 0) { out.unshift((n & 0x7f) | 0x80); n >>= 7; }
  return out;
};
const u32 = (n) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const u16 = (n) => [(n >>> 8) & 0xff, n & 0xff];
const str = (s) => [...s].map(c => c.charCodeAt(0));

// push in chunks — spreading a million-element array into push() overflows
// the *test's* stack, which has nothing to do with the parser.
function append(dest, src) {
  for (let i = 0; i < src.length; i += 4096) {
    dest.push(...src.slice(i, i + 4096));
  }
}

function midiFile(format, ticksPerBeat, trackEvents) {
  const bytes = [
    ...str('MThd'), ...u32(6), ...u16(format), ...u16(trackEvents.length), ...u16(ticksPerBeat),
  ];
  for (const evs of trackEvents) {
    const body = evs.flat();
    append(bytes, str('MTrk'));
    append(bytes, u32(body.length));
    append(bytes, body);
  }
  return new Uint8Array(bytes).buffer;
}

const END = [...vlq(0), 0xff, 0x2f, 0x00];
const trackName = (n) => [...vlq(0), 0xff, 0x03, n.length, ...str(n)];

// ── 1. Running status must not survive a meta event ──────────────────────
console.log('running status across meta events');
{
  const buf = midiFile(0, 480, [[
    [...vlq(0), 0x90, 60, 100],          // note on, sets running status
    [...vlq(0), 0xff, 0x01, 3, ...str('abc')], // a text meta event in between
    [...vlq(480), 0x80, 60, 0],          // explicit note off
    END,
  ]]);
  const song = parseMIDI(buf);
  check('note survives an interleaved meta event', song.notes.length === 1,
    `got ${song.notes.length}`);
  check('duration is one beat at 120bpm', Math.abs(song.duration - 0.5) < 1e-6,
    `got ${song.duration}`);
}

// ── 2. Running status proper (omitted status byte) ───────────────────────
console.log('running status (omitted status byte)');
{
  const buf = midiFile(0, 480, [[
    [...vlq(0), 0x90, 60, 100],
    [...vlq(480), 60, 0],                 // running status note-off (vel 0)
    [...vlq(0), 62, 100],                 // running status note-on
    [...vlq(480), 62, 0],
    END,
  ]]);
  const song = parseMIDI(buf);
  check('two notes parsed via running status', song.notes.length === 2,
    `got ${song.notes.length}`);
  check('pitches are 60 then 62',
    song.notes[0]?.midi === 60 && song.notes[1]?.midi === 62,
    JSON.stringify(song.notes.map(n => n.midi)));
}

// ── 3. Dangling note-on (no note-off) must not be dropped ────────────────
console.log('dangling note-on');
{
  const buf = midiFile(0, 480, [[
    [...vlq(0), 0x90, 72, 100],
    [...vlq(960)], [0xff, 0x2f, 0x00],
  ]]);
  const song = parseMIDI(buf);
  check('unterminated note is still emitted', song.notes.length === 1,
    `got ${song.notes.length}`);
}

// ── 4. Retriggered note before its note-off ──────────────────────────────
console.log('retriggered note');
{
  const buf = midiFile(0, 480, [[
    [...vlq(0), 0x90, 60, 100],
    [...vlq(240), 0x90, 60, 100],   // second on before any off
    [...vlq(240), 0x80, 60, 0],
    [...vlq(240), 0x80, 60, 0],
    END,
  ]]);
  const song = parseMIDI(buf);
  check('both strikes produce notes', song.notes.length === 2, `got ${song.notes.length}`);
}

// ── 5. Hand assignment by average pitch, not track index ─────────────────
console.log('hand assignment');
{
  // Track 0 = low bass, track 1 = high melody. The old index-based rule
  // would call track 0 the right hand; pitch says otherwise.
  const low = [[...vlq(0), 0x90, 40, 90], [...vlq(480), 0x80, 40, 0], END];
  const high = [[...vlq(0), 0x91, 84, 90], [...vlq(480), 0x81, 84, 0], END];
  const song = parseMIDI(midiFile(1, 480, [low, high]));
  const byPitch = Object.fromEntries(song.notes.map(n => [n.midi, n.track]));
  check('high note is right hand (track 0)', byPitch[84] === 0, JSON.stringify(byPitch));
  check('low note is left hand (track 1)', byPitch[40] === 1, JSON.stringify(byPitch));
}

// ── 6. Track-name hints beat pitch ordering ──────────────────────────────
console.log('track-name hints');
{
  const a = [trackName('Left Hand'), [...vlq(0), 0x90, 84, 90], [...vlq(480), 0x80, 84, 0], END];
  const b = [trackName('Right Hand'), [...vlq(0), 0x91, 40, 90], [...vlq(480), 0x81, 40, 0], END];
  const song = parseMIDI(midiFile(1, 480, [a, b]));
  const byPitch = Object.fromEntries(song.notes.map(n => [n.midi, n.track]));
  check('named Left Hand wins over its high pitch', byPitch[84] === 1, JSON.stringify(byPitch));
  check('named Right Hand wins over its low pitch', byPitch[40] === 0, JSON.stringify(byPitch));
  check('track names exposed', song.trackNames[0] === 'Left Hand', JSON.stringify(song.trackNames));
}

// ── 7. Tempo map ─────────────────────────────────────────────────────────
console.log('tempo changes');
{
  const buf = midiFile(0, 480, [[
    [...vlq(0), 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20],  // 500000us = 120bpm
    [...vlq(0), 0x90, 60, 100],
    [...vlq(480), 0x80, 60, 0],
    [...vlq(0), 0xff, 0x51, 0x03, 0x03, 0xd0, 0x90],  // 250000us = 240bpm
    [...vlq(0), 0x90, 62, 100],
    [...vlq(480), 0x80, 62, 0],
    END,
  ]]);
  const song = parseMIDI(buf);
  check('first note is 0.5s long', Math.abs((song.notes[0].endTime - song.notes[0].startTime) - 0.5) < 1e-6,
    `got ${song.notes[0].endTime - song.notes[0].startTime}`);
  check('second note is 0.25s long', Math.abs((song.notes[1].endTime - song.notes[1].startTime) - 0.25) < 1e-6,
    `got ${song.notes[1].endTime - song.notes[1].startTime}`);
}

// ── 8. Large file: no Math.max stack overflow ────────────────────────────
console.log('large file');
{
  const evs = [];
  for (let i = 0; i < 150000; i++) {
    evs.push([...vlq(0), 0x90, 60, 100]);
    evs.push([...vlq(1), 0x80, 60, 0]);
  }
  evs.push(END);
  const song = parseMIDI(midiFile(0, 480, [evs]));
  check('150k notes parse without RangeError', song.notes.length === 150000, `got ${song.notes.length}`);
  check('duration computed', song.duration > 0, `got ${song.duration}`);
}

// ── 9. TypedArray input with a byte offset ───────────────────────────────
console.log('typed-array input');
{
  const base = midiFile(0, 480, [[[...vlq(0), 0x90, 60, 100], [...vlq(480), 0x80, 60, 0], END]]);
  const padded = new Uint8Array(base.byteLength + 8);
  padded.set(new Uint8Array(base), 8);
  const view = new Uint8Array(padded.buffer, 8, base.byteLength);
  const song = parseMIDI(view);
  check('offset TypedArray parses correctly', song.notes.length === 1, `got ${song.notes.length}`);
}

// ── 10. Unknown chunk types are skipped ──────────────────────────────────
console.log('unknown chunks');
{
  const body = [[...vlq(0), 0x90, 60, 100], [...vlq(480), 0x80, 60, 0], END].flat();
  const bytes = [
    ...str('MThd'), ...u32(6), ...u16(0), ...u16(1), ...u16(480),
    ...str('XFIH'), ...u32(4), 1, 2, 3, 4,       // vendor chunk before the track
    ...str('MTrk'), ...u32(body.length), ...body,
  ];
  const song = parseMIDI(new Uint8Array(bytes).buffer);
  check('vendor chunk skipped, track found', song.notes.length === 1, `got ${song.notes.length}`);
}

finish('parser');
