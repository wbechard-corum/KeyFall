import { createRenderer } from './renderer.js';
import { createPlayback } from './playback.js';
import { playNote, resume as resumeAudio } from './audio.js';
import { parseMIDI } from '../midi/parser.js';
import { onNote as onMIDINote } from '../midi/input.js';
import { sendNoteOn, sendNoteOff } from '../midi/output.js';
import { keyAtPoint } from '../shared/piano-keyboard.js';
import { getSetting, updateSettings } from '../shared/settings.js';
import { DEMOS } from './demos.js';
import { saveSong, listSongs, getSong, deleteSong } from './library.js';

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

      <span class="spacer"></span>

      <div class="ctrl-label song-info" data-role="song-info">No song loaded</div>

      <span class="spacer"></span>

      <div class="track-toggle" data-action="track-r">
        <span class="dot" style="background:var(--right-hand)"></span>R
      </div>
      <div class="track-toggle" data-action="track-l">
        <span class="dot" style="background:var(--left-hand)"></span>L
      </div>

      <button class="ctrl-btn" data-action="library">LIBRARY</button>
      <button class="ctrl-btn" data-action="open">OPEN</button>
      <input type="file" class="file-input" data-role="file-input" accept=".mid,.midi">
    </div>

    <div class="progress-bar" data-action="seek">
      <div class="progress-fill" data-role="progress-fill"></div>
    </div>

    <div class="canvas-wrap" data-role="canvas-wrap">
      <canvas data-role="canvas"></canvas>
      <div class="drop-overlay" data-role="drop-overlay">
        <button class="drop-close" data-action="close-library" aria-label="Close">×</button>
        <div class="drop-icon">♪</div>
        <div class="drop-title">Load a song</div>
        <div class="drop-subtitle">Drop a .mid file anywhere to add it to your library</div>
        <div class="drop-actions">
          <button class="drop-btn primary" data-action="open">Open MIDI File</button>
        </div>
        <div class="library-columns">
          <div class="library-col">
            <div class="library-col-title">My Library</div>
            <div class="library-list" data-role="library-list"></div>
          </div>
          <div class="library-col">
            <div class="library-col-title">Demos</div>
            <div class="demo-list" data-role="demo-list"></div>
          </div>
        </div>
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
  const renderer = createRenderer(canvas);

  const pressedKeys = new Set();

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
  const activeOutNotes = new Set();

  function sendNoteToKeyboard(note) {
    const channel = getSetting('midiChannel') ?? 0;
    const velocity = note.velocity || 80;
    const dur = Math.max(0.02, note.endTime - note.startTime);
    sendNoteOn(channel, note.midi, velocity);
    activeOutNotes.add(note.midi);
    setTimeout(() => {
      sendNoteOff(channel, note.midi);
      activeOutNotes.delete(note.midi);
    }, dur * 1000);
  }

  function panicAllOutNotes() {
    const channel = getSetting('midiChannel') ?? 0;
    for (const n of activeOutNotes) sendNoteOff(channel, n);
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
      trackMuted: playback.state.trackMuted,
      isPlaying: playback.isPlaying(),
    });
    updateProgress();
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

  function onSongLoaded(song) {
    playback.setSong(song);
    const info = $('[data-role="song-info"]');
    info.textContent = `${song.name} · ${song.notes.length} notes · ${formatTime(song.duration)}`;
    $('[data-role="drop-overlay"]').classList.add('hidden');
    resumeAudio();
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
        onSongLoaded(song);
      } catch (err) {
        alert('Error parsing MIDI file: ' + err.message);
        return;
      }
      try {
        await saveSong({ name: displayName, bytes });
        refreshLibrary();
      } catch (err) {
        console.warn('Failed to save to library:', err);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  async function loadFromLibrary(id) {
    const record = await getSong(id);
    if (!record) return;
    try {
      const song = parseMIDI(record.bytes);
      song.name = record.name;
      onSongLoaded(song);
    } catch (err) {
      alert('Error reading saved song: ' + err.message);
    }
  }

  async function removeFromLibrary(id, name) {
    if (!confirm(`Delete "${name}" from your library?`)) return;
    await deleteSong(id);
    refreshLibrary();
  }

  async function refreshLibrary() {
    const list = $('[data-role="library-list"]');
    const rows = await listSongs().catch(() => []);
    list.innerHTML = '';
    if (rows.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'library-empty';
      empty.textContent = 'No saved songs yet.';
      list.appendChild(empty);
      return;
    }
    for (const row of rows) {
      const item = document.createElement('div');
      item.className = 'library-item';
      const load = document.createElement('button');
      load.className = 'library-item-load';
      load.textContent = row.name;
      load.addEventListener('click', () => loadFromLibrary(row.id));
      const del = document.createElement('button');
      del.className = 'library-item-del';
      del.setAttribute('aria-label', `Delete ${row.name}`);
      del.textContent = '×';
      del.addEventListener('click', (e) => { e.stopPropagation(); removeFromLibrary(row.id, row.name); });
      item.appendChild(load);
      item.appendChild(del);
      list.appendChild(item);
    }
  }

  function showLibrary() {
    $('[data-role="drop-overlay"]').classList.remove('hidden');
    refreshLibrary();
  }

  function hideLibrary() {
    if (!playback.state.song) return;
    $('[data-role="drop-overlay"]').classList.add('hidden');
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
        onSongLoaded(song);
      });
      list.appendChild(btn);
    }
  }

  function openFile() {
    $('[data-role="file-input"]').click();
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
    $('[data-action="library"]').addEventListener('click', showLibrary);
    $('[data-action="close-library"]').addEventListener('click', hideLibrary);

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

  function setupTouchPiano() {
    canvas.addEventListener('pointerdown', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const { H, pianoHeight, layout } = renderer.getState();
      const note = keyAtPoint(layout, x, y, H - pianoHeight, pianoHeight);
      if (note !== null) noteOn(note);
    });
    canvas.addEventListener('pointerup', () => {
      for (const note of pressedKeys) noteOff(note);
    });
    canvas.addEventListener('pointercancel', () => {
      for (const note of pressedKeys) noteOff(note);
    });
  }

  function noteOn(midi) {
    pressedKeys.add(midi);
    playNote(midi, 0.5, 90);
    playback.reportKeyPress(midi);
    render();
  }

  function noteOff(midi) {
    pressedKeys.delete(midi);
    render();
  }

  const unsubscribeMIDI = onMIDINote(({ type, note }) => {
    if (type === 'on') {
      pressedKeys.add(note);
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
    if (e.code === 'Space') { e.preventDefault(); playback.isPlaying() ? playback.pause() : playback.play(); }
    else if (e.code === 'Escape') playback.stop();
  }

  renderer.resize();
  buildDemos();
  setupControls();
  setupDragDrop();
  setupTouchPiano();
  refreshLibrary();
  render();

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
    destroy() {
      clearInterval(tickInterval);
      resizeObserver.disconnect();
      unsubscribeMIDI();
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('keydown', handleKeydown);
    },
  };
}
