import { createRenderer } from './renderer.js';
import { createPlayback } from './playback.js';
import { playNote, resume as resumeAudio } from './audio.js';
import { parseMIDI } from '../midi/parser.js';
import { onNote as onMIDINote } from '../midi/input.js';
import { sendNoteOn, sendNoteOff } from '../midi/output.js';
import { keyAtPoint } from '../shared/piano-keyboard.js';
import { getSetting, getSettings, updateSettings, onSettingsChange } from '../shared/settings.js';
import { setSection, setCommandHandler } from '../shared/app-mirror.js';
import { getSong } from './library.js';
import { DEMOS } from './demos.js';
import { saveSong } from './library.js';
import { createSheet, retryNotation } from './sheet.js';

const TEMPLATE = `
  <div class="trainer-root">
    <div class="controls">
      <button class="ctrl-btn play" data-action="play">PLAY</button>
      <button class="ctrl-btn" data-action="stop">STOP</button>

      <div class="ctrl-group">
        <span class="ctrl-label">SPD</span>
        <select class="ctrl-select" data-action="speed">
          <option value="0.25">0.25x</option>
          <option value="0.5">0.5x</option>
          <option value="0.75">0.75x</option>
          <option value="1" selected>1x</option>
          <option value="1.25">1.25x</option>
          <option value="1.5">1.5x</option>
        </select>
      </div>

      <button class="ctrl-btn" data-action="wait">WAIT</button>
      <button class="ctrl-btn" data-action="midi-out" title="Send notes to connected MIDI keyboard">MIDI OUT</button>

      <div class="ctrl-group">
        <span class="ctrl-label">KEYS</span>
        <select class="ctrl-select" data-action="keys">
          <option value="88">88</option>
          <option value="76">76</option>
          <option value="61">61</option>
          <option value="49">49</option>
          <option value="37">37</option>
          <option value="25">25</option>
        </select>
      </div>

      <span class="spacer"></span>

      <div class="ctrl-label song-info" data-role="song-info">No song loaded</div>

      <span class="spacer"></span>

      <div class="track-toggle" data-action="track-r">
        <span class="dot" style="background:var(--right-hand)"></span>R
      </div>
      <div class="track-toggle" data-action="track-l">
        <span class="dot" style="background:var(--left-hand)"></span>L
      </div>

      <div class="ctrl-group view-toggle" data-role="view-toggle">
        <button class="ctrl-btn active" data-action="view-notes">NOTES</button>
        <button class="ctrl-btn" data-action="view-sheet">SHEET</button>
      </div>

      <button class="ctrl-btn" data-action="open">OPEN</button>
      <input type="file" class="file-input" data-role="file-input" accept=".mid,.midi">
    </div>

    <div class="progress-bar" data-action="seek">
      <div class="progress-fill" data-role="progress-fill"></div>
    </div>

    <div class="canvas-wrap" data-role="canvas-wrap">
      <canvas data-role="canvas"></canvas>
      <div class="sheet-wrap hidden" data-role="sheet-wrap">
        <div class="sheet-status" data-role="sheet-status"></div>
        <div class="sheet-host" data-role="sheet-host"></div>
      </div>
      <div class="drop-overlay" data-role="drop-overlay">
        <div class="drop-icon">♪</div>
        <div class="drop-title">Load a song</div>
        <div class="drop-subtitle">Drop a .mid file here, open one, pick a demo, or visit the Songs tab</div>
        <div class="drop-actions">
          <button class="drop-btn primary" data-action="open">Open MIDI File</button>
        </div>
        <div class="demo-list" data-role="demo-list"></div>
      </div>
    </div>
  </div>
`;

export function mountTrainer(root) {
  root.innerHTML = TEMPLATE;

  const $ = (sel) => root.querySelector(sel);
  const $$ = (sel) => root.querySelectorAll(sel);

  const canvas = $('[data-role="canvas"]');
  const canvasWrap = $('[data-role="canvas-wrap"]');
  const sheetWrap = $('[data-role="sheet-wrap"]');
  const sheetHost = $('[data-role="sheet-host"]');
  const sheetStatus = $('[data-role="sheet-status"]');
  const sheet = createSheet(sheetHost);
  let viewMode = 'notes';
  let sheetPollTimer = null;
  const renderer = createRenderer(canvas);

  // pressedKeys carries both membership and velocity so the piano
  // highlight can show how hard a note was played. .has(n) and
  // .set(n, v)/.delete(n) give us the same API shape the renderer
  // expects.
  const pressedKeys = new Map();

  const playback = createPlayback({
    onTick: () => render(),
    onEnded: () => setPlayButtonState(false),
    onPlayStateChange: (playing) => {
      setPlayButtonState(playing);
      if (!playing) panicAllOutNotes();
    },
    onWaitChange: () => render(),
  });

  playback.onNotePlay((note) => {
    playNote(note.midi, note.endTime - note.startTime, note.velocity || 80);
    if (midiOutEnabled) sendNoteToKeyboard(note);
  });

  let midiOutEnabled = !!getSetting('trainerMidiOut');
  // midi note → pending note-off timer. Keyed by note so a repeated pitch
  // cancels its predecessor's timer; otherwise the first note's note-off
  // fired partway through the second one and chopped it off.
  const activeOutNotes = new Map();

  function sendNoteToKeyboard(note) {
    const channel = getSetting('midiChannel') ?? 0;
    const velocity = note.velocity || 80;
    const dur = Math.max(0.02, (note.endTime - note.startTime) / (playback.state.playSpeed || 1));
    const existing = activeOutNotes.get(note.midi);
    if (existing !== undefined) clearTimeout(existing);
    sendNoteOn(channel, note.midi, velocity);
    activeOutNotes.set(note.midi, setTimeout(() => {
      sendNoteOff(channel, note.midi);
      activeOutNotes.delete(note.midi);
    }, dur * 1000));
  }

  function panicAllOutNotes() {
    const channel = getSetting('midiChannel') ?? 0;
    for (const [note, timer] of activeOutNotes) {
      clearTimeout(timer);
      sendNoteOff(channel, note);
    }
    activeOutNotes.clear();
  }

  function setMidiOutEnabled(on) {
    midiOutEnabled = !!on;
    updateSettings({ trainerMidiOut: midiOutEnabled });
    const btn = $('[data-action="midi-out"]');
    btn.classList.toggle('active', midiOutEnabled);
    if (!midiOutEnabled) panicAllOutNotes();
  }

  function render() {
    renderer.render({
      song: playback.state.song,
      currentTime: playback.state.currentTime,
      pressedKeys,
      keyVelocity: pressedKeys,
      trackMuted: playback.state.trackMuted,
      isPlaying: playback.isPlaying(),
    });
    if (viewMode === 'sheet') sheet?.moveCursor(playback.state.currentTime);
    updateProgress();
    publishTrainerState();
  }

  function setPlayButtonState(playing) {
    const btn = $('[data-action="play"]');
    btn.classList.toggle('active', playing);
    btn.textContent = playing ? 'PAUSE' : 'PLAY';
  }

  function updateProgress() {
    const fill = $('[data-role="progress-fill"]');
    const song = playback.state.song;
    if (!song || song.duration === 0) { fill.style.width = '0%'; return; }
    const pct = Math.min(100, (playback.state.currentTime / song.duration) * 100);
    fill.style.width = pct + '%';
  }

  function onSongLoaded(song, meta = {}) {
    playback.setSong(song);
    const info = $('[data-role="song-info"]');
    info.textContent = `${song.name} · ${song.notes.length} notes · ${formatTime(song.duration)}`;
    $('[data-role="drop-overlay"]').classList.add('hidden');
    resumeAudio();
    currentSongMeta = {
      id: meta.id ?? null,
      demoId: meta.demoId ?? null,
      name: song.name,
      source: meta.source ?? 'adhoc',
      duration: song.duration,
      notes: song.notes.length,
    };
    if (viewMode === 'sheet') refreshSheet();
    render();
  }

  function formatTime(s) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  function loadFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      const bytes = e.target.result;
      const displayName = file.name.replace(/\.(mid|midi)$/i, '');
      try {
        const song = parseMIDI(bytes);
        song.name = displayName;
        onSongLoaded(song, { source: 'adhoc' });
      } catch (err) {
        alert('Error parsing MIDI file: ' + err.message);
        return;
      }
      try {
        const record = await saveSong({ name: displayName, bytes });
        // Promote ad-hoc to library so mirror clients can fetch it by id.
        currentSongMeta = { ...currentSongMeta, id: record.id, source: 'library' };
        publishTrainerState();
      } catch (err) {
        console.warn('Failed to save to library:', err);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function loadSongBytes(name, bytes, meta = {}) {
    try {
      const song = parseMIDI(bytes);
      song.name = name;
      onSongLoaded(song, meta);
    } catch (err) {
      alert('Error loading song: ' + err.message);
    }
  }

  function buildDemos() {
    const list = $('[data-role="demo-list"]');
    list.innerHTML = '';
    for (const [id, demo] of Object.entries(DEMOS)) {
      const btn = document.createElement('button');
      btn.className = 'demo-item';
      btn.innerHTML = `<span>${demo.label}</span><span class="difficulty">${demo.difficulty}</span>`;
      btn.addEventListener('click', () => {
        const song = demo.build();
        onSongLoaded(song, { source: 'demo', demoId: id });
      });
      list.appendChild(btn);
    }
  }

  function openFile() {
    $('[data-role="file-input"]').click();
  }

  function setView(mode) {
    viewMode = mode;
    canvas.classList.toggle('hidden', mode !== 'notes');
    sheetWrap.classList.toggle('hidden', mode !== 'sheet');
    $('[data-action="view-notes"]').classList.toggle('active', mode === 'notes');
    $('[data-action="view-sheet"]').classList.toggle('active', mode === 'sheet');
    if (mode === 'sheet') refreshSheet();
    else stopSheetPoll();
  }

  function stopSheetPoll() {
    if (sheetPollTimer) { clearTimeout(sheetPollTimer); sheetPollTimer = null; }
  }

  async function refreshSheet({ force = false } = {}) {
    stopSheetPoll();
    const id = currentSongMeta?.id;
    if (!id) {
      sheet.reset();
      showSheetStatus({ text: 'Load a library song to see its sheet music.' });
      return;
    }
    showSheetStatus({ text: 'Loading notation…' });
    const result = await sheet.load(id, { force });
    if (result.state === 'ready') {
      sheetStatus.classList.add('hidden');
      sheet.moveCursor(playback.state.currentTime);
    } else if (result.state === 'pending') {
      showSheetStatus({ text: 'Converting MIDI to notation… (this can take a few seconds).' });
      sheetPollTimer = setTimeout(refreshSheet, 2500);
    } else if (result.state === 'failed') {
      const reason = result.error
        ? `Conversion error: ${result.error}`
        : 'The file may be malformed or use features the converter can’t handle.';
      showSheetStatus({
        text: `The converter couldn’t turn this MIDI into notation. ${reason}`,
        action: 'RETRY',
      });
    } else if (result.state === 'error') {
      showSheetStatus({
        text: `Couldn’t render notation: ${result.error}`,
        action: 'RETRY',
      });
    } else {
      showSheetStatus({ text: 'No notation for this song.' });
    }
  }

  function showSheetStatus({ text, action }) {
    sheetStatus.classList.remove('hidden');
    sheetStatus.innerHTML = '';
    const msg = document.createElement('div');
    msg.className = 'sheet-status-msg';
    msg.textContent = text;
    sheetStatus.appendChild(msg);
    if (action === 'RETRY') {
      const btn = document.createElement('button');
      btn.className = 'sheet-status-btn';
      btn.textContent = 'RETRY CONVERSION';
      btn.addEventListener('click', async () => {
        const id = currentSongMeta?.id;
        if (!id) return;
        showSheetStatus({ text: 'Re-queueing conversion…' });
        await retryNotation(id);
        refreshSheet({ force: true });
      });
      sheetStatus.appendChild(btn);
    }
  }

  function setupControls() {
    $('[data-action="play"]').addEventListener('click', () => {
      if (!playback.state.song) return;
      playback.isPlaying() ? playback.pause() : playback.play();
    });
    $('[data-action="stop"]').addEventListener('click', () => playback.stop());
    $('[data-action="speed"]').addEventListener('change', (e) => playback.setSpeed(e.target.value));
    $('[data-action="wait"]').addEventListener('click', (e) => {
      const enabled = !e.currentTarget.classList.contains('active');
      playback.setWaitMode(enabled);
      e.currentTarget.classList.toggle('active', enabled);
    });
    $('[data-action="midi-out"]').addEventListener('click', (e) => {
      setMidiOutEnabled(!e.currentTarget.classList.contains('active'));
    });
    if (midiOutEnabled) $('[data-action="midi-out"]').classList.add('active');

    $('[data-action="view-notes"]').addEventListener('click', () => setView('notes'));
    $('[data-action="view-sheet"]').addEventListener('click', () => setView('sheet'));

    const keysSelect = $('[data-action="keys"]');
    const savedRange = Number(getSetting('keyboardRange') || 88);
    keysSelect.value = String(savedRange);
    renderer.setKeyboardRange(savedRange);
    keysSelect.addEventListener('change', (e) => {
      const v = Number(e.target.value) || 88;
      updateSettings({ keyboardRange: v });
      renderer.setKeyboardRange(v);
      render();
    });

    // Apply color + label-mode settings from storage and keep them
    // in sync with changes made in the Settings tab.
    function applyVisualSettings(s = getSettings()) {
      renderer.setColors({
        cKey: s.cKeyColor,
        white: s.whiteKeyColor,
        black: s.blackKeyColor,
        right: s.rightHandColor,
        left: s.leftHandColor,
      });
      renderer.setLabelMode(s.labelMode || 'c-only');
    }
    applyVisualSettings();
    const unsubscribeSettings = onSettingsChange((s, patch) => {
      const visualKeys = ['cKeyColor','whiteKeyColor','blackKeyColor',
        'rightHandColor','leftHandColor','labelMode'];
      if (visualKeys.some(k => k in patch)) {
        applyVisualSettings(s);
        render();
      }
      if ('keyboardRange' in patch) {
        const nv = Number(s.keyboardRange) || 88;
        keysSelect.value = String(nv);
        renderer.setKeyboardRange(nv);
        render();
      }
    });
    $('[data-action="track-r"]').addEventListener('click', (e) => {
      const muted = playback.toggleTrackMuted(0);
      e.currentTarget.classList.toggle('muted', muted);
      render();
    });
    $('[data-action="track-l"]').addEventListener('click', (e) => {
      const muted = playback.toggleTrackMuted(1);
      e.currentTarget.classList.toggle('muted', muted);
      render();
    });
    $$('[data-action="open"]').forEach(el => el.addEventListener('click', openFile));
    $('[data-role="file-input"]').addEventListener('change', (e) => loadFile(e.target.files[0]));

    $('[data-action="seek"]').addEventListener('click', (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const pct = (e.clientX - rect.left) / rect.width;
      playback.seekPct(pct);
    });
  }

  function setupDragDrop() {
    canvasWrap.addEventListener('dragover', (e) => {
      e.preventDefault();
      $('[data-role="drop-overlay"]').classList.remove('hidden');
    });
    canvasWrap.addEventListener('dragleave', () => {
      if (!playback.state.song) return;
      $('[data-role="drop-overlay"]').classList.add('hidden');
    });
    canvasWrap.addEventListener('drop', (e) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file && (file.name.endsWith('.mid') || file.name.endsWith('.midi'))) loadFile(file);
    });
  }

  // pointerId → midi note, so releasing one finger only releases the key
  // that finger is holding. The old handler released *every* entry in
  // pressedKeys, which also cleared notes being held down on the physical
  // MIDI keyboard, and dragging off the canvas left keys stuck on.
  const touchNotes = new Map();

  function setupTouchPiano() {
    canvas.addEventListener('pointerdown', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const { H, pianoHeight, layout } = renderer.getState();
      const note = keyAtPoint(layout, x, y, H - pianoHeight, pianoHeight);
      if (note === null) return;
      e.preventDefault();
      // Capture so pointerup still reaches us if the finger slides off the
      // canvas mid-press.
      try { canvas.setPointerCapture(e.pointerId); } catch { /* not supported */ }
      touchNotes.set(e.pointerId, note);
      noteOn(note);
    });

    const releasePointer = (e) => {
      const note = touchNotes.get(e.pointerId);
      if (note === undefined) return;
      touchNotes.delete(e.pointerId);
      // Don't kill the highlight if the same key is also held on the
      // hardware keyboard or under another finger.
      if (![...touchNotes.values()].includes(note)) noteOff(note);
    };
    canvas.addEventListener('pointerup', releasePointer);
    canvas.addEventListener('pointercancel', releasePointer);
  }

  function noteOn(midi, velocity = 90) {
    pressedKeys.set(midi, velocity);
    playNote(midi, 0.5, velocity);
    playback.reportKeyPress(midi);
    if (midiOutEnabled) {
      const channel = getSetting('midiChannel') ?? 0;
      sendNoteOn(channel, midi, velocity);
    }
    render();
  }

  function noteOff(midi) {
    pressedKeys.delete(midi);
    if (midiOutEnabled) {
      const channel = getSetting('midiChannel') ?? 0;
      sendNoteOff(channel, midi);
    }
    render();
  }

  const unsubscribeMIDI = onMIDINote(({ type, note, velocity }) => {
    if (type === 'on') {
      pressedKeys.set(note, velocity || 100);
      playback.reportKeyPress(note);
    } else {
      pressedKeys.delete(note);
    }
    render();
  });

  function handleResize() {
    renderer.resize();
    render();
  }

  function handleKeydown(e) {
    if (root.offsetParent === null) return;
    // Don't hijack keys aimed at a form control. The remote-code modal sits
    // outside the trainer view but leaves it visible, so typing a space in
    // that field used to start playback behind the dialog; the same applies
    // to Escape, which should close a control rather than stop the song.
    const t = e.target;
    if (t instanceof HTMLElement &&
        (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON|OPTION)$/.test(t.tagName))) {
      return;
    }
    if (e.code === 'Space') { e.preventDefault(); playback.isPlaying() ? playback.pause() : playback.play(); }
    else if (e.code === 'Escape') playback.stop();
  }

  let currentSongMeta = { id: null, name: null, source: null, duration: 0, notes: 0 };

  function publishTrainerState() {
    setSection('trainer', {
      song: currentSongMeta,
      playing: playback.isPlaying(),
      currentTime: playback.state.currentTime,
      speed: playback.state.playSpeed,
      waitMode: playback.state.waitMode,
      trackMuted: [...playback.state.trackMuted],
      waitingForNote: playback.state.waitingForNote?.midi ?? null,
      waitingForChord: playback.state.waitingForChord
        ? playback.state.waitingForChord.filter(n => !n.hit).map(n => n.midi)
        : null,
      midiOutEnabled,
      // Array of [midi, velocity] so the client can rebuild a Map.
      pressedKeys: Array.from(pressedKeys.entries()),
      serverTime: performance.now(),
    });
  }

  async function loadSongById(id, name) {
    const record = await getSong(id).catch(() => null);
    if (!record) return;
    try {
      const song = parseMIDI(record.bytes);
      // Prefer an explicit name, then the one the API reported. Falling back
      // to currentSongMeta.name (as this used to) labelled every remotely
      // loaded song with the *previous* song's title.
      song.name = name || record.name || 'Song';
      onSongLoaded(song, { id, source: 'library' });
    } catch (err) {
      console.warn('Failed to load song by id:', err);
    }
  }

  function handleTrainerCommand(cmd) {
    switch (cmd.action) {
      case 'play':        if (playback.state.song) playback.play(); break;
      case 'pause':       playback.pause(); break;
      case 'stop':        playback.stop(); break;
      case 'seekPct':     playback.seekPct(cmd.args?.[0] ?? 0); break;
      case 'setSpeed':    playback.setSpeed(cmd.args?.[0] ?? 1); break;
      case 'setWaitMode': {
        const enabled = !!cmd.args?.[0];
        playback.setWaitMode(enabled);
        $('[data-action="wait"]').classList.toggle('active', enabled);
        break;
      }
      case 'toggleTrack': {
        const idx = cmd.args?.[0];
        if (idx === 0 || idx === 1) {
          const muted = playback.toggleTrackMuted(idx);
          const sel = idx === 0 ? '[data-action="track-r"]' : '[data-action="track-l"]';
          $(sel).classList.toggle('muted', muted);
          render();
        }
        break;
      }
      case 'setMidiOut':  setMidiOutEnabled(!!cmd.args?.[0]); break;
      case 'loadSongById': loadSongById(cmd.args?.[0], cmd.args?.[1]); break;
      case 'touchNoteOn': {
        const midi = cmd.args?.[0];
        const velocity = cmd.args?.[1] ?? 90;
        if (typeof midi === 'number') noteOn(midi, velocity);
        break;
      }
      case 'touchNoteOff': {
        const midi = cmd.args?.[0];
        if (typeof midi === 'number') noteOff(midi);
        break;
      }
      case 'loadDemo': {
        const id = cmd.args?.[0];
        const demo = DEMOS[id];
        if (demo) {
          const song = demo.build();
          currentSongMeta = { id: null, name: demo.label, source: 'demo', demoId: id, duration: song.duration, notes: song.notes.length };
          onSongLoaded(song);
        }
        break;
      }
    }
  }

  setCommandHandler('trainer', handleTrainerCommand);

  renderer.resize();
  buildDemos();
  setupControls();
  setupDragDrop();
  setupTouchPiano();
  render();
  publishTrainerState();

  window.addEventListener('resize', handleResize);
  document.addEventListener('keydown', handleKeydown);

  // ResizeObserver catches layout shifts that `window.resize` misses: late font
  // loads, container growth from flex siblings settling, DPR changes, etc.
  // Without this the canvas height stays pinned to whatever it was on first
  // paint — which on cold loads is often before the flex layout finishes.
  const resizeObserver = new ResizeObserver(handleResize);
  resizeObserver.observe(canvasWrap);

  const tickInterval = setInterval(() => { if (!playback.isPlaying()) render(); }, 100);

  return {
    render,
    loadSongBytes,
    destroy() {
      clearInterval(tickInterval);
      resizeObserver.disconnect();
      unsubscribeMIDI();
      unsubscribeSettings();
      stopSheetPoll();
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('keydown', handleKeydown);
    },
  };
}
