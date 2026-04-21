import { createRenderer } from './renderer.js';
import { createPlayback } from './playback.js';
import { playNote, resume as resumeAudio } from './audio.js';
import { parseMIDI } from '../midi/parser.js';
import { onNote as onMIDINote } from '../midi/input.js';
import { keyAtPoint } from '../shared/piano-keyboard.js';
import { DEMOS } from './demos.js';
import { saveSong, listSongs, getSong, deleteSong, isSupported as dbSupported } from './songs-db.js';

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
        <button class="drop-close" data-action="close-overlay" title="Close">×</button>
        <div class="drop-icon">♪</div>
        <div class="drop-title">Load a MIDI file</div>
        <div class="drop-subtitle">drop a .mid here, open one, or pick a demo</div>
        <div class="drop-actions">
          <button class="drop-btn primary" data-action="open">Open MIDI File</button>
        </div>
        <div class="drop-sections">
          <div class="drop-section">
            <div class="drop-section-title">DEMOS</div>
            <div class="demo-list" data-role="demo-list"></div>
          </div>
          <div class="drop-section">
            <div class="drop-section-title">MY LIBRARY</div>
            <div class="library-list" data-role="library-list">
              <div class="library-empty">Loading…</div>
            </div>
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
    onPlayStateChange: (playing) => setPlayButtonState(playing),
    onWaitChange: () => render(),
  });

  playback.onNotePlay((note) => {
    playNote(note.midi, note.endTime - note.startTime, note.velocity || 80);
  });

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
      try {
        const song = parseMIDI(bytes);
        song.name = file.name.replace(/\.(mid|midi)$/i, '');
        onSongLoaded(song);
        if (dbSupported()) {
          try {
            await saveSong({
              name: song.name,
              bytes,
              notes: song.notes.length,
              duration: song.duration,
            });
            buildLibrary();
          } catch (dbErr) {
            console.warn('Could not save song to library:', dbErr);
          }
        }
      } catch (err) {
        alert('Error parsing MIDI file: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  async function loadFromLibrary(id) {
    try {
      const saved = await getSong(id);
      if (!saved) return;
      const song = parseMIDI(saved.bytes);
      song.name = saved.name;
      onSongLoaded(song);
    } catch (err) {
      alert('Error loading saved song: ' + err.message);
    }
  }

  async function buildLibrary() {
    const list = $('[data-role="library-list"]');
    if (!dbSupported()) {
      list.innerHTML = '<div class="library-empty">Saved library not available (IndexedDB missing).</div>';
      return;
    }
    let songs = [];
    try {
      songs = await listSongs();
    } catch (err) {
      list.innerHTML = `<div class="library-empty">Library error: ${err.message}</div>`;
      return;
    }

    if (songs.length === 0) {
      list.innerHTML = '<div class="library-empty">No saved songs yet. Open a .mid file to add one.</div>';
      return;
    }

    list.innerHTML = '';
    for (const s of songs) {
      const item = document.createElement('div');
      item.className = 'library-item';
      item.innerHTML = `
        <button class="library-load" type="button">
          <span class="library-name"></span>
          <span class="library-meta"></span>
        </button>
        <button class="library-delete" type="button" title="Delete">✕</button>
      `;
      item.querySelector('.library-name').textContent = s.name;
      item.querySelector('.library-meta').textContent = `${s.notes} notes · ${formatTime(s.duration)}`;
      item.querySelector('.library-load').addEventListener('click', () => loadFromLibrary(s.id));
      item.querySelector('.library-delete').addEventListener('click', async (ev) => {
        ev.stopPropagation();
        if (!confirm(`Delete "${s.name}" from your library?`)) return;
        try {
          await deleteSong(s.id);
          buildLibrary();
        } catch (err) {
          alert('Could not delete: ' + err.message);
        }
      });
      list.appendChild(item);
    }
  }

  function showOverlay() {
    $('[data-role="drop-overlay"]').classList.remove('hidden');
    buildLibrary();
  }

  function hideOverlay() {
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
    $('[data-role="file-input"]').addEventListener('change', (e) => {
      loadFile(e.target.files[0]);
      e.target.value = '';
    });
    $('[data-action="library"]').addEventListener('click', showOverlay);
    $('[data-action="close-overlay"]').addEventListener('click', () => {
      if (playback.state.song) hideOverlay();
    });

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
  buildLibrary();
  setupControls();
  setupDragDrop();
  setupTouchPiano();
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
