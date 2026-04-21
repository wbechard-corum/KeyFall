import { requestAccess, onStateChange, autoSelect } from './midi/connection.js';
import { mountTrainer } from './trainer/ui.js';
import { mountController } from './controller/ui.js';
import { mountMirrorClient } from './mirror-client/ui.js';
import { getSettings, updateSettings } from './shared/settings.js';

const views = {
  trainer: { el: document.getElementById('trainerView'), mount: mountTrainer, handle: null },
  controller: { el: document.getElementById('controllerView'), mount: mountController, handle: null },
};

function setMode(mode) {
  for (const [key, v] of Object.entries(views)) {
    v.el.classList.toggle('hidden', key !== mode);
    if (key === mode && !v.handle) v.handle = v.mount(v.el);
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
  registerServiceWorker();
}

function boot() {
  const code = parseMirrorCode();
  if (code) {
    bootMirrorClient(code);
    return;
  }

  setupModeSwitcher();
  setupMIDIStatus();

  // Eagerly request MIDI (user can also trigger via tapping the status label).
  requestAccess({ sysex: true }).then(() => autoSelect({ preferManufacturer: 'Roland' }));

  registerServiceWorker();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
