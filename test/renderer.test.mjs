import { check, finish } from './helpers.mjs';
// Runs the real renderer against a recording canvas stub, and compares the
// keys it lights up with a brute-force reference implementation.
// ── Canvas / DOM stubs ───────────────────────────────────────────────────
const fills = [];   // every fillRect issued this frame, with its fillStyle
function makeCtx() {
  return {
    _style: '#000',
    get fillStyle() { return this._style; },
    set fillStyle(v) { this._style = v; },
    strokeStyle: '', lineWidth: 0, globalAlpha: 1, font: '', textAlign: '', textBaseline: '',
    shadowColor: '', shadowBlur: 0,
    setTransform() {}, clearRect() {}, save() {}, restore() {},
    beginPath() {}, moveTo() {}, lineTo() {}, arcTo() {}, stroke() {}, fill() {},
    strokeRect() {}, fillText() {}, roundRect() {},
    createLinearGradient() { return { addColorStop() {} }; },
    fillRect(x, y, w, h) { fills.push({ x, y, w, h, style: this._style, alpha: this.globalAlpha }); },
  };
}

const ctx = makeCtx();
const canvas = {
  width: 0, height: 0, style: {},
  parentElement: { clientWidth: 1200, clientHeight: 600 },
  getContext: () => ctx,
};
globalThis.window = { devicePixelRatio: 1 };

const { createRenderer } = await import('../src/trainer/renderer.js');
const { computeKeyLayout } = await import('../src/shared/piano-keyboard.js');

function makeSong(specs) {
  const notes = specs.map(([midi, startTime, dur, track = 0]) => ({
    midi, startTime, endTime: startTime + dur, velocity: 80, track, played: false, hit: false,
  }));
  notes.sort((a, b) => a.startTime - b.startTime);
  let duration = 0;
  for (const n of notes) if (n.endTime > duration) duration = n.endTime;
  return { notes, duration, name: 'test' };
}

// The pre-fix logic, kept here as the reference oracle.
function referenceActive(song, t, trackMuted) {
  const out = new Map();
  for (const note of song.notes) {
    if (t >= note.startTime && t <= note.endTime && !trackMuted[note.track || 0]) {
      if (!out.has(note.midi)) out.set(note.midi, note.track || 0);
    }
  }
  return out;
}

// Which piano keys did this frame highlight? A key is "active" when the
// renderer paints it with a hand colour at the reduced alpha drawPiano uses.
const RIGHT = '#4dd6c3', LEFT = '#c89dff';
function activeKeysFromFills(layout, pianoTop) {
  const found = new Map();
  const byX = new Map();
  for (const k of [...layout.whiteKeyPositions, ...layout.blackKeyPositions]) {
    byX.set(Math.round(k.x * 100), k.note);
  }
  for (const f of fills) {
    if (f.y < pianoTop - 1) continue;                       // note area, not the keyboard
    if (f.style !== RIGHT && f.style !== LEFT) continue;
    if (f.alpha !== 0.3 && f.alpha !== 0.4) continue;       // white=0.3, black=0.4
    const note = byX.get(Math.round(f.x * 100)) ?? byX.get(Math.round((f.x - 0.5) * 100));
    if (note !== undefined) found.set(note, f.style === RIGHT ? 0 : 1);
  }
  return found;
}

// ── 1. Active-key highlighting matches the brute-force oracle ────────────
console.log('active-key highlighting');
{
  const renderer = createRenderer(canvas);
  renderer.resize();
  const layout = computeKeyLayout(1200, 88);
  const st = renderer.getState();
  const pianoTop = st.H - st.pianoHeight;

  const song = makeSong([
    [60, 0.0, 2.0, 0],    // long sustained right-hand note
    [64, 0.5, 0.3, 0],
    [67, 0.5, 0.3, 0],
    [40, 0.6, 0.4, 1],    // left hand
    [61, 1.0, 0.2, 0],    // black key
    [90, 1.2, 0.2, 0],
    [21, 1.2, 0.2, 1],    // lowest key on an 88
  ]);

  let mismatches = 0;
  for (let t = 0; t <= 2.2; t += 0.05) {
    for (const hands of [['both','both'], ['both','off'], ['off','both']]) {
      fills.length = 0;
      renderer.render({
        song, currentTime: t, pressedKeys: new Map(), keyVelocity: new Map(),
        hands, isPlaying: true,
      });
      const got = activeKeysFromFills(layout, pianoTop);
      const muted = hands.map(h => h === 'off');
      const want = referenceActive(song, t, muted);
      // Only compare notes that are actually on the 88-key layout.
      const wantOnKeyboard = new Map(
        [...want].filter(([midi]) => layout.allKeyPositions[midi]));
      const sameSize = got.size === wantOnKeyboard.size;
      const sameEntries = [...wantOnKeyboard].every(([m, tr]) => got.get(m) === tr);
      if (!sameSize || !sameEntries) {
        if (mismatches < 3) {
          console.log(`    t=${t.toFixed(2)} hands=${hands}`,
            'got', [...got], 'want', [...wantOnKeyboard]);
        }
        mismatches++;
      }
    }
  }
  check('highlighted keys match brute-force reference at every sampled time',
    mismatches === 0, `${mismatches} mismatching frames`);
}

// ── 2. Rendering a dense song stays fast ─────────────────────────────────
console.log('render performance');
{
  const renderer = createRenderer(canvas);
  renderer.resize();
  const specs = [];
  for (let i = 0; i < 40000; i++) specs.push([21 + (i % 88), i * 0.02, 0.15, i % 2]);
  const song = makeSong(specs);
  const args = {
    song, pressedKeys: new Map(), keyVelocity: new Map(),
    hands: ['both', 'both'], isPlaying: true,
  };
  renderer.render({ ...args, currentTime: 0 });   // warm the maxDuration cache
  const t0 = Date.now();
  for (let f = 0; f < 300; f++) {
    fills.length = 0;
    renderer.render({ ...args, currentTime: 100 + f * 0.016 });
  }
  const elapsed = Date.now() - t0;
  check('300 frames over a 40k-note song render fast', elapsed < 1500, `${elapsed}ms`);
  console.log(`    (${elapsed}ms for 300 frames)`);
}

finish('renderer');
