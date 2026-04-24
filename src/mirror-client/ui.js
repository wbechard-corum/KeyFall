import { createMirrorClient } from '../shared/mirror.js';
import { loadProfile, loadDefaultProfile } from '../controller/profile-loader.js';
import { createRenderer } from '../trainer/renderer.js';
import { parseMIDI } from '../midi/parser.js';
import { DEMOS } from '../trainer/demos.js';
import { getSong } from '../trainer/library.js';
import { keyAtPoint } from '../shared/piano-keyboard.js';
import { getSetting, updateSettings } from '../shared/settings.js';

const TEMPLATE = `
  <div class="mirror-client-root">
    <div class="mirror-client-header">
      <div>
        <div class="mirror-client-brand">KeyFall Remote</div>
        <div class="mirror-client-status" data-role="status">Connecting…</div>
      </div>
      <div class="mirror-client-code" data-role="code">------</div>
    </div>

    <div class="mirror-client-body" data-role="body">
      <div class="mirror-client-lcd">
        <div class="lcd-row">
          <span class="lcd-label" data-role="lcd-bank">—</span>
          <span class="lcd-label" data-role="lcd-patch-num">000/000</span>
        </div>
        <div class="lcd-patch" data-role="lcd-patch-name">—</div>
        <div class="lcd-midi-info">
          <span>CH <span data-role="lcd-channel">1</span></span>
          <span data-role="lcd-msg">—</span>
        </div>
      </div>

      <div class="mirror-client-tabs">
        <button class="mc-tab active" data-tab="patches">PATCHES</button>
        <button class="mc-tab" data-tab="effects">EFFECTS</button>
        <button class="mc-tab" data-tab="controls">CONTROLS</button>
        <button class="mc-tab" data-tab="channel">CHANNEL</button>
        <button class="mc-tab" data-tab="trainer">TRAINER</button>
      </div>

      <div class="mc-panel" data-panel="patches">
        <div class="bank-bar" data-role="bank-bar"></div>
        <div class="patch-list" data-role="patch-list"></div>
      </div>

      <div class="mc-panel hidden" data-panel="effects">
        <div class="mc-effects" data-role="effects"></div>
      </div>

      <div class="mc-panel hidden" data-panel="controls">
        <div class="mc-controls" data-role="controls"></div>
      </div>

      <div class="mc-panel hidden" data-panel="channel">
        <div class="mc-channel" data-role="channel-grid"></div>
      </div>

      <div class="mc-panel hidden" data-panel="trainer">
        <div class="mc-trainer" data-role="trainer">
          <div class="mc-trainer-song" data-role="trainer-song">No song loaded</div>
          <div class="mc-trainer-canvas-wrap" data-role="trainer-canvas-wrap">
            <canvas data-role="trainer-canvas"></canvas>
            <div class="mc-trainer-canvas-empty hidden" data-role="trainer-canvas-empty">No song yet</div>
          </div>
          <div class="mc-trainer-progress" data-role="trainer-progress-track">
            <div class="mc-trainer-progress-fill" data-role="trainer-progress-fill"></div>
          </div>
          <div class="mc-trainer-time">
            <span data-role="trainer-time-current">0:00</span>
            <span data-role="trainer-time-total">0:00</span>
          </div>
          <div class="mc-trainer-transport">
            <button class="mc-trainer-btn primary" data-action="play">PLAY</button>
            <button class="mc-trainer-btn" data-action="stop">STOP</button>
          </div>
          <div class="mc-trainer-row">
            <label>Speed</label>
            <select class="mc-trainer-select" data-action="speed">
              <option value="0.25">0.25x</option>
              <option value="0.5">0.5x</option>
              <option value="0.75">0.75x</option>
              <option value="1" selected>1x</option>
              <option value="1.25">1.25x</option>
              <option value="1.5">1.5x</option>
            </select>
          </div>
          <div class="mc-trainer-row">
            <button class="mc-trainer-toggle" data-action="wait">WAIT</button>
            <button class="mc-trainer-toggle" data-action="midi-out">MIDI OUT</button>
            <button class="mc-trainer-toggle" data-action="track-r">R</button>
            <button class="mc-trainer-toggle" data-action="track-l">L</button>
          </div>
          <div class="mc-trainer-row">
            <label>Keys</label>
            <select class="mc-trainer-select" data-action="keys">
              <option value="88">88</option>
              <option value="76">76</option>
              <option value="61">61</option>
              <option value="49">49</option>
              <option value="37">37</option>
              <option value="25">25</option>
            </select>
          </div>
          <div class="mc-trainer-library">
            <div class="mc-trainer-library-title">Library</div>
            <div class="mc-trainer-library-list" data-role="trainer-library"></div>
          </div>
        </div>
      </div>
    </div>

    <div class="mirror-client-waiting" data-role="waiting">
      <div class="mirror-client-waiting-title">Waiting for host…</div>
      <div class="mirror-client-waiting-help">
        Open the Controller tab on your laptop and click <b>START MIRRORING</b>
        in Settings. If you just reloaded this page, give it a second.
      </div>
    </div>

    <div class="mirror-client-footer" data-role="footer">Connecting…</div>
  </div>
`;

export function mountMirrorClient(root, code) {
  root.innerHTML = TEMPLATE;
  const $ = (sel) => root.querySelector(sel);
  const $$ = (sel) => root.querySelectorAll(sel);
  $('[data-role="code"]').textContent = `#${code}`;

  let state = null;
  let profile = loadDefaultProfile();
  let activeTab = 'patches';
  let lastRenderedProfile = null;
  let lastRenderedBank = null;
  let lastEffectsProfile = null;
  let lastControlsProfile = null;
  let channelBuilt = false;

  $$('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  function tCmd(action, args) { client.sendCommand({ target: 'trainer', action, args }); }
  $('[data-action="play"]').addEventListener('click', () => {
    tCmd(state?.trainer?.playing ? 'pause' : 'play', []);
  });
  $('[data-action="stop"]').addEventListener('click', () => tCmd('stop', []));
  $('[data-action="speed"]').addEventListener('change', (e) => tCmd('setSpeed', [Number(e.target.value)]));
  $('[data-action="wait"]').addEventListener('click', () => tCmd('setWaitMode', [!state?.trainer?.waitMode]));
  $('[data-action="midi-out"]').addEventListener('click', () => tCmd('setMidiOut', [!state?.trainer?.midiOutEnabled]));
  $('[data-action="track-r"]').addEventListener('click', () => tCmd('toggleTrack', [0]));
  $('[data-action="track-l"]').addEventListener('click', () => tCmd('toggleTrack', [1]));
  $('[data-role="trainer-progress-track"]').addEventListener('click', (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    tCmd('seekPct', [Math.max(0, Math.min(1, pct))]);
  });

  const client = createMirrorClient(code, {
    onStatus: (st) => {
      const statusEl = $('[data-role="status"]');
      if (st.state === 'connecting') statusEl.textContent = 'Connecting…';
      else if (st.state === 'connected') statusEl.textContent = 'Connected';
      else if (st.state === 'host-gone') statusEl.textContent = 'Host disconnected';
      else if (st.state === 'error') statusEl.textContent = `Error: ${st.reason || 'unknown'}`;
      else if (st.state === 'disconnected') statusEl.textContent = 'Reconnecting…';
    },
    onState: (payload) => {
      state = payload;
      const c = payload.controller;
      if (c?.profileId && (!profile || profile.id !== c.profileId)) {
        try { profile = loadProfile(c.profileId); }
        catch { profile = loadDefaultProfile(); }
        lastRenderedProfile = null;
        lastEffectsProfile = null;
        lastControlsProfile = null;
        channelBuilt = false;
      }
      const t = payload.trainer;
      if (t) {
        updateLocalClockFromState(t);
        syncClientSong(t.song);
      }
      render();
    },
    onHostGone: () => {
      $('[data-role="footer"]').textContent = 'Host disconnected — waiting for reconnection…';
    },
  });

  function switchTab(tab) {
    activeTab = tab;
    $$('.mc-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $$('.mc-panel').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== tab));
    if (tab === 'trainer') {
      refreshTrainerLibrary();
      ensureTrainerRenderer();
      startCanvasLoop();
    } else {
      stopCanvasLoop();
    }
    if (state) render();
  }

  function render() {
    const waitingEl = $('[data-role="waiting"]');
    const bodyEl = $('[data-role="body"]');
    if (!state) {
      waitingEl.classList.remove('hidden');
      bodyEl.classList.add('hidden');
      return;
    }
    waitingEl.classList.add('hidden');
    bodyEl.classList.remove('hidden');

    const c = state.controller || {};
    const bank = profile.banks[c.bankIndex ?? 0];
    const patches = bank?.patches || [];
    const patch = patches[c.patchIndex ?? 0];
    const patchName = patch ? (patch.name || patch) : '—';

    $('[data-role="lcd-bank"]').textContent = bank?.label ?? '—';
    $('[data-role="lcd-patch-num"]').textContent = bank
      ? `${String((c.patchIndex ?? 0) + 1).padStart(3, '0')}/${patches.length}`
      : '000/000';
    $('[data-role="lcd-patch-name"]').textContent = patchName;
    $('[data-role="lcd-channel"]').textContent = (c.channel ?? 0) + 1;
    $('[data-role="lcd-msg"]').textContent = c.lastMessage || '—';
    $('[data-role="footer"]').textContent = `${profile.manufacturer} ${profile.model}`;

    if (activeTab === 'patches') { renderBankBar(); renderPatchList(); }
    if (activeTab === 'effects') renderEffects();
    if (activeTab === 'controls') renderControls();
    if (activeTab === 'channel') renderChannel();
    if (activeTab === 'trainer') renderTrainer();
  }

  // ─── Client-side trainer canvas ───

  let trainerRenderer = null;
  let trainerCanvas = null;
  let currentClientSong = null;        // parsed song currently loaded client-side
  let currentClientSongKey = null;     // 'lib:<id>' or 'demo:<id>' — invalidates reload
  let songLoadInFlight = null;
  let localClock = {
    currentTime: 0,
    lastHostUpdate: 0,    // performance.now() when we received host state
    hostTime: 0,          // host's reported currentTime at that moment
    playing: false,
    speed: 1,
  };
  let canvasRafId = null;

  const clientPressed = new Set();  // notes the client itself is touching

  function ensureTrainerRenderer() {
    if (trainerRenderer) return;
    trainerCanvas = $('[data-role="trainer-canvas"]');
    if (!trainerCanvas) return;
    trainerRenderer = createRenderer(trainerCanvas);
    trainerRenderer.setKeyboardRange(Number(getSetting('keyboardRange') || 88));
    trainerRenderer.resize();

    const keysSelect = $('[data-action="keys"]');
    if (keysSelect) {
      keysSelect.value = String(getSetting('keyboardRange') || 88);
      keysSelect.addEventListener('change', (e) => {
        const v = Number(e.target.value) || 88;
        updateSettings({ keyboardRange: v });
        trainerRenderer.setKeyboardRange(v);
        trainerRenderer.resize();
        renderClientCanvas();
      });
    }
    const wrap = $('[data-role="trainer-canvas-wrap"]');
    new ResizeObserver(() => {
      trainerRenderer?.resize();
      renderClientCanvas();
    }).observe(wrap);

    // Touch-to-play: taps on the piano strip become note-on/off commands
    // to the host. Velocity comes from the tap position within the key's
    // height (further down = harder), capped 40..120.
    trainerCanvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      trainerCanvas.setPointerCapture?.(e.pointerId);
      const midi = noteAtPointer(e);
      if (midi === null) return;
      const vel = velocityFromPointer(e);
      clientPressed.add(midi);
      client.sendCommand({ target: 'trainer', action: 'touchNoteOn', args: [midi, vel] });
    });
    const releaseAll = () => {
      for (const midi of clientPressed) {
        client.sendCommand({ target: 'trainer', action: 'touchNoteOff', args: [midi] });
      }
      clientPressed.clear();
    };
    trainerCanvas.addEventListener('pointerup', releaseAll);
    trainerCanvas.addEventListener('pointercancel', releaseAll);
    trainerCanvas.addEventListener('pointerleave', releaseAll);
  }

  function noteAtPointer(e) {
    const rect = trainerCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const { H, pianoHeight, layout } = trainerRenderer.getState();
    return keyAtPoint(layout, x, y, H - pianoHeight, pianoHeight);
  }

  function velocityFromPointer(e) {
    const rect = trainerCanvas.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const { H, pianoHeight } = trainerRenderer.getState();
    const pianoTop = H - pianoHeight;
    // Further down the key = higher velocity (mimics an actual
    // weighted keyboard's aftertouch zone).
    const rel = Math.max(0, Math.min(1, (y - pianoTop) / pianoHeight));
    return Math.round(40 + rel * 80);
  }

  async function syncClientSong(meta) {
    if (!meta) { currentClientSong = null; currentClientSongKey = null; return; }
    const key = meta.id ? `lib:${meta.id}` : meta.demoId ? `demo:${meta.demoId}` : null;
    if (!key) {
      currentClientSong = null;
      currentClientSongKey = null;
      return;
    }
    if (key === currentClientSongKey) return;
    // Cancel any in-flight fetch for a different song so we don't flip-flop.
    const myKey = key;
    songLoadInFlight = myKey;
    try {
      if (meta.id) {
        const record = await getSong(meta.id);
        if (songLoadInFlight !== myKey) return;
        if (record) {
          const song = parseMIDI(record.bytes);
          song.name = meta.name;
          currentClientSong = song;
          currentClientSongKey = key;
        }
      } else if (meta.demoId && DEMOS[meta.demoId]) {
        const song = DEMOS[meta.demoId].build();
        if (songLoadInFlight !== myKey) return;
        currentClientSong = song;
        currentClientSongKey = key;
      }
    } catch (err) {
      console.warn('Client song load failed:', err);
      currentClientSong = null;
      currentClientSongKey = null;
    } finally {
      if (songLoadInFlight === myKey) songLoadInFlight = null;
    }
  }

  function updateLocalClockFromState(t) {
    if (!t) return;
    localClock = {
      currentTime: t.currentTime || 0,
      lastHostUpdate: performance.now(),
      hostTime: t.currentTime || 0,
      playing: !!t.playing,
      speed: t.speed ?? 1,
    };
  }

  function interpolateTime() {
    if (!localClock.playing) return localClock.hostTime;
    const elapsed = (performance.now() - localClock.lastHostUpdate) / 1000;
    return localClock.hostTime + elapsed * localClock.speed;
  }

  function renderClientCanvas() {
    if (!trainerRenderer) return;
    const t = state?.trainer;
    // Host publishes pressedKeys as [[midi, velocity], ...] tuples.
    // Fall back tolerantly when older hosts publish just an array of
    // midi numbers so a version skew doesn't crash the canvas.
    const keyMap = new Map();
    for (const entry of t?.pressedKeys || []) {
      if (Array.isArray(entry)) keyMap.set(entry[0], entry[1] ?? 100);
      else keyMap.set(entry, 100);
    }
    if (!t || !currentClientSong) {
      trainerRenderer.render({
        song: null,
        currentTime: 0,
        pressedKeys: new Set(),
        keyVelocity: new Map(),
        trackMuted: [false, false],
        isPlaying: false,
      });
      return;
    }
    const time = interpolateTime();
    trainerRenderer.render({
      song: currentClientSong,
      currentTime: time,
      pressedKeys: keyMap,
      keyVelocity: keyMap,
      trackMuted: t.trackMuted || [false, false],
      isPlaying: t.playing,
    });
  }

  function startCanvasLoop() {
    if (canvasRafId) return;
    const tick = () => {
      renderClientCanvas();
      if (activeTab === 'trainer') canvasRafId = requestAnimationFrame(tick);
      else canvasRafId = null;
    };
    canvasRafId = requestAnimationFrame(tick);
  }

  function stopCanvasLoop() {
    if (canvasRafId) cancelAnimationFrame(canvasRafId);
    canvasRafId = null;
  }

  let librarySnapshot = [];
  let libraryLoading = false;

  async function refreshTrainerLibrary() {
    if (libraryLoading) return;
    libraryLoading = true;
    try {
      const res = await fetch('/api/songs');
      if (!res.ok) throw new Error(`list failed: ${res.status}`);
      librarySnapshot = await res.json();
    } catch {
      librarySnapshot = [];
    } finally {
      libraryLoading = false;
      renderTrainerLibrary();
    }
  }

  function renderTrainerLibrary() {
    const list = $('[data-role="trainer-library"]');
    list.innerHTML = '';
    if (librarySnapshot.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'mc-trainer-library-empty';
      empty.textContent = 'No songs on server yet.';
      list.appendChild(empty);
      return;
    }
    for (const row of librarySnapshot) {
      const btn = document.createElement('button');
      btn.className = 'mc-trainer-library-item';
      const isActive = state?.trainer?.song?.id === row.id;
      if (isActive) btn.classList.add('active');
      btn.textContent = row.name;
      btn.addEventListener('click', () => {
        client.sendCommand({ target: 'trainer', action: 'loadSongById', args: [row.id] });
      });
      list.appendChild(btn);
    }
  }

  function formatClock(s) {
    if (!Number.isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  function renderTrainer() {
    const t = state.trainer;
    if (!t) {
      $('[data-role="trainer-song"]').textContent = 'Waiting for trainer state…';
      return;
    }
    const song = t.song || {};
    const name = song.name || 'No song loaded';
    const total = song.duration || 0;
    const current = interpolateTime();

    const emptyEl = $('[data-role="trainer-canvas-empty"]');
    if (!currentClientSong) {
      emptyEl.classList.remove('hidden');
      if (song.source === 'adhoc' && !song.id) {
        emptyEl.textContent = 'Saving song — canvas will appear shortly.';
      } else if (song.id || song.demoId) {
        emptyEl.textContent = 'Loading song…';
      } else {
        emptyEl.textContent = 'No song yet';
      }
    } else {
      emptyEl.classList.add('hidden');
    }

    $('[data-role="trainer-song"]').textContent = `${name}${song.notes ? ` · ${song.notes} notes` : ''}`;
    const pct = total > 0 ? Math.min(100, (current / total) * 100) : 0;
    $('[data-role="trainer-progress-fill"]').style.width = pct + '%';
    $('[data-role="trainer-time-current"]').textContent = formatClock(current);
    $('[data-role="trainer-time-total"]').textContent = formatClock(total);

    const playBtn = $('[data-action="play"]');
    playBtn.textContent = t.playing ? 'PAUSE' : 'PLAY';
    playBtn.classList.toggle('active', !!t.playing);

    const speedSelect = $('[data-action="speed"]');
    if (document.activeElement !== speedSelect) speedSelect.value = String(t.speed ?? 1);

    $('[data-action="wait"]').classList.toggle('active', !!t.waitMode);
    $('[data-action="midi-out"]').classList.toggle('active', !!t.midiOutEnabled);
    $('[data-action="track-r"]').classList.toggle('muted', !!t.trackMuted?.[0]);
    $('[data-action="track-l"]').classList.toggle('muted', !!t.trackMuted?.[1]);

    renderTrainerLibrary();
  }

  function renderBankBar() {
    const bar = $('[data-role="bank-bar"]');
    if (lastRenderedProfile !== profile.id) {
      bar.innerHTML = '';
      profile.banks.forEach((bank, i) => {
        const btn = document.createElement('button');
        btn.className = 'bank-btn';
        btn.textContent = bank.label;
        btn.addEventListener('click', () => client.sendCommand({ target: 'controller', action: 'setBank', args: [i] }));
        bar.appendChild(btn);
      });
      lastRenderedProfile = profile.id;
      lastRenderedBank = null;
    }
    const c = state.controller || {};
    bar.querySelectorAll('.bank-btn').forEach((btn, i) => {
      btn.classList.toggle('active', i === (c.bankIndex ?? 0));
    });
  }

  function renderPatchList() {
    const list = $('[data-role="patch-list"]');
    const c = state.controller || {};
    const key = `${profile.id}:${c.bankIndex ?? 0}`;
    if (lastRenderedBank !== key) {
      list.innerHTML = '';
      const bank = profile.banks[c.bankIndex ?? 0];
      const patches = bank?.patches || [];
      patches.forEach((patch, i) => {
        const btn = document.createElement('button');
        btn.className = 'patch-item';
        const name = patch.name || patch;
        btn.innerHTML = `
          <span class="patch-num">${String(i + 1).padStart(3, '0')}</span>
          <span class="patch-name">${name}</span>
        `;
        btn.addEventListener('click', () => {
          client.sendCommand({ target: 'controller', action: 'setPatch', args: [i] });
        });
        list.appendChild(btn);
      });
      lastRenderedBank = key;
    }
    list.querySelectorAll('.patch-item').forEach((btn, i) => {
      btn.classList.toggle('active', i === (c.patchIndex ?? 0));
    });
  }

  function renderEffects() {
    const host = $('[data-role="effects"]');
    if (lastEffectsProfile !== profile.id) {
      host.innerHTML = '';
      for (const fx of profile.effects || []) {
        const row = document.createElement('div');
        row.className = 'mc-effect';
        row.dataset.fxId = fx.id;
        row.innerHTML = `
          <div class="mc-effect-label">
            <span>${fx.label}</span>
            <span class="mc-effect-value" data-role="value">0</span>
          </div>
          <input type="range" class="mc-effect-range"
            min="${fx.min ?? 0}" max="${fx.max ?? 127}" value="${fx.default ?? 0}">
        `;
        const input = row.querySelector('input');
        input.addEventListener('input', (e) => {
          const v = Number(e.target.value);
          row.querySelector('[data-role="value"]').textContent = v;
          client.sendCommand({ target: 'controller', action: 'setEffectValue', args: [fx.id, v] });
        });
        host.appendChild(row);
      }
      lastEffectsProfile = profile.id;
    }
    const c = state.controller || {};
    for (const row of host.querySelectorAll('.mc-effect')) {
      const id = row.dataset.fxId;
      const v = c.effectValues?.[id] ?? 0;
      const input = row.querySelector('input');
      if (document.activeElement !== input) input.value = v;
      row.querySelector('[data-role="value"]').textContent = v;
    }
  }

  function renderControls() {
    const host = $('[data-role="controls"]');
    if (lastControlsProfile !== profile.id) {
      host.innerHTML = '';
      for (const ctl of profile.controls || []) {
        const btn = document.createElement('button');
        btn.className = 'mc-control';
        btn.dataset.ctlId = ctl.id;
        btn.textContent = ctl.label;
        btn.addEventListener('click', () => {
          client.sendCommand({ target: 'controller', action: 'toggleControl', args: [ctl.id] });
        });
        host.appendChild(btn);
      }
      lastControlsProfile = profile.id;
    }
    const c = state.controller || {};
    for (const btn of host.querySelectorAll('.mc-control')) {
      const id = btn.dataset.ctlId;
      btn.classList.toggle('active', !!c.controlStates?.[id]);
    }
  }

  function renderChannel() {
    const host = $('[data-role="channel-grid"]');
    if (!channelBuilt) {
      host.innerHTML = '';
      for (let i = 0; i < 16; i++) {
        const btn = document.createElement('button');
        btn.className = 'mc-channel-btn';
        btn.textContent = String(i + 1);
        btn.addEventListener('click', () => client.sendCommand({ target: 'controller', action: 'setChannel', args: [i] }));
        host.appendChild(btn);
      }
      channelBuilt = true;
    }
    const c = state.controller || {};
    host.querySelectorAll('.mc-channel-btn').forEach((btn, i) => {
      btn.classList.toggle('active', i === c.channel);
    });
  }

  return {
    destroy() {
      stopCanvasLoop();
      client.close();
    },
  };
}
