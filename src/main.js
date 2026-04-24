import { requestAccess, onStateChange, autoSelect } from './midi/connection.js';
import { mountTrainer } from './trainer/ui.js';
import { mountController } from './controller/ui.js';
import { mountSongs } from './songs/ui.js';
import { mountMirrorClient } from './mirror-client/ui.js';
import { getSettings, updateSettings } from './shared/settings.js';
import { keepAwake } from './shared/wake-lock.js';

const views = {
  trainer: {
    el: document.getElementById('trainerView'),
    mount: (el) => mountTrainer(el),
    handle: null,
  },
  songs: {
    el: document.getElementById('songsView'),
    mount: (el) => mountSongs(el, {
      onLoadSong: ({ id, name, bytes }) => {
        ensureMounted('trainer');
        views.trainer.handle?.loadSongBytes?.(name, bytes, { id, source: 'library' });
        setMode('trainer');
      },
    }),
    handle: null,
  },
  controller: {
    el: document.getElementById('controllerView'),
    mount: (el) => mountController(el),
    handle: null,
  },
};

function ensureMounted(mode) {
  const v = views[mode];
  if (v && !v.handle) v.handle = v.mount(v.el);
}

function setMode(mode) {
  for (const [key, v] of Object.entries(views)) {
    v.el.classList.toggle('hidden', key !== mode);
    if (key === mode) ensureMounted(key);
    if (key === mode && v.handle?.refresh) v.handle.refresh();
  }
  document.querySelectorAll('.mode-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  updateSettings({ mode });
}

function setupModeSwitcher() {
  document.querySelectorAll('.mode-tab').forEach(btn => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });
  const { mode } = getSettings();
  setMode(mode || 'trainer');
}

function setupMIDIStatus() {
  const dot = document.getElementById('globalMidiDot');
  const label = document.getElementById('globalMidiLabel');

  onStateChange((state) => {
    // Devices may enumerate via a delayed `statechange` after access is granted.
    // Re-run auto-select whenever ports appear and nothing is selected yet.
    if (state.requested && !state.error
        && !state.selectedOutputId && !state.selectedInputId
        && (state.outputs.length > 0 || state.inputs.length > 0)) {
      autoSelect({ preferManufacturer: 'Roland' });
      return;
    }

    const hasDevice = !!(state.selectedOutputId || state.selectedInputId);
    dot.classList.toggle('on', hasDevice);

    if (!state.supported) { label.textContent = 'NO WEBMIDI'; return; }
    if (!state.requested) { label.textContent = 'TAP TO CONNECT'; return; }
    if (state.error) { label.textContent = 'DENIED'; return; }

    if (hasDevice) {
      const out = state.outputs.find(o => o.id === state.selectedOutputId);
      const inp = state.inputs.find(i => i.id === state.selectedInputId);
      const name = (out || inp)?.name || 'CONNECTED';
      label.textContent = name.slice(0, 18).toUpperCase();
    } else if (state.outputs.length > 0 || state.inputs.length > 0) {
      label.textContent = 'NO DEVICE SELECTED';
    } else {
      label.textContent = 'NO MIDI DEVICES';
    }
  });

  const nav = document.getElementById('modeNav');
  const midiButton = nav.querySelector('.mode-midi');
  midiButton.addEventListener('click', async () => {
    await requestAccess({ sysex: true });
    autoSelect({ preferManufacturer: 'Roland' });
  });
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (import.meta.env?.DEV) return;
  try {
    await navigator.serviceWorker.register('./sw.js');
  } catch {
    // SW registration failures are non-fatal.
  }
}

function parseMirrorCode() {
  const m = /^#mirror=(\d{6})$/.exec(location.hash);
  return m ? m[1] : null;
}

function bootMirrorClient(code) {
  const app = document.getElementById('app');
  app.innerHTML = '<section class="mode-view" id="mirrorClientView"></section>';
  const view = document.getElementById('mirrorClientView');
  mountMirrorClient(view, code);
  // Entering a remote code is a user gesture; request the wake lock
  // immediately so the iPad stays awake on the music stand.
  keepAwake();
  registerServiceWorker();
}

function setupRemoteModal() {
  const modal = document.getElementById('remoteModal');
  const input = document.getElementById('remoteCodeInput');
  const error = document.getElementById('remoteModalError');
  const openBtn = document.getElementById('modeRemote');
  const cancelBtn = document.getElementById('remoteCancel');
  const connectBtn = document.getElementById('remoteConnect');
  const backdrop = modal.querySelector('[data-role="backdrop"]');

  function open() {
    error.classList.add('hidden');
    input.value = '';
    modal.classList.remove('hidden');
    // Delay focus so the modal animation settles and iOS brings up
    // the numeric keyboard reliably.
    setTimeout(() => input.focus(), 50);
  }

  function close() {
    modal.classList.add('hidden');
  }

  function submit() {
    const code = (input.value || '').replace(/\D/g, '');
    if (code.length !== 6) {
      error.textContent = 'Enter all 6 digits.';
      error.classList.remove('hidden');
      input.focus();
      return;
    }
    location.hash = `#mirror=${code}`;
    location.reload();
  }

  openBtn.addEventListener('click', open);
  cancelBtn.addEventListener('click', close);
  backdrop.addEventListener('click', close);
  connectBtn.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
    else if (e.key === 'Escape') close();
  });
  input.addEventListener('input', () => {
    input.value = input.value.replace(/\D/g, '').slice(0, 6);
    error.classList.add('hidden');
  });
}

function showVersion() {
  const el = document.getElementById('appVersion');
  if (el) el.textContent = `v${__APP_VERSION__}`;
}

function boot() {
  showVersion();
  const code = parseMirrorCode();
  if (code) {
    bootMirrorClient(code);
    return;
  }

  setupModeSwitcher();
  setupMIDIStatus();
  setupRemoteModal();

  // The Wake Lock API requires a recent user gesture. First tap or
  // click anywhere in the app triggers the request once; subsequent
  // visibility changes re-acquire automatically.
  const armWakeLock = () => {
    keepAwake();
    document.removeEventListener('pointerdown', armWakeLock);
    document.removeEventListener('keydown', armWakeLock);
  };
  document.addEventListener('pointerdown', armWakeLock, { once: true });
  document.addEventListener('keydown', armWakeLock, { once: true });

  // Eagerly request MIDI (user can also trigger via tapping the status label).
  requestAccess({ sysex: true }).then(() => autoSelect({ preferManufacturer: 'Roland' }));

  registerServiceWorker();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
