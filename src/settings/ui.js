import { getSettings, updateSettings, onSettingsChange } from '../shared/settings.js';
import { KEYBOARD_RANGES } from '../shared/piano-keyboard.js';
import { onStateChange, getState, selectInput, selectOutput, requestAccess } from '../midi/connection.js';
import { IDENTITY_REQUEST, parseIdentityReply } from '../midi/sysex.js';
import { sendSysEx } from '../midi/output.js';
import { onSysEx } from '../midi/input.js';
import { availableProfiles, loadProfile, loadDefaultProfile } from '../controller/profile-loader.js';
import {
  startMirror, stopMirror, isMirrorActive, onMirrorStatus,
} from '../shared/app-mirror.js';

const KEY_SWATCHES_C      = ['#4dd6c3','#c89dff','#6ae3d0','#ff9f7a','#e2c05a','#f4efe7'];
const KEY_SWATCHES_WHITE  = ['#eaeef2','#f4efe7','#e6dbc5','#cdd4dc','#a4aeb8'];
const KEY_SWATCHES_BLACK  = ['#0a0c0f','#1a1d22','#2a2f36','#181410','#000000'];
const HAND_SWATCHES_R     = ['#4dd6c3','#ff9f7a','#e2c05a','#ea8a5c','#ff6b7a','#c8ff4a'];
const HAND_SWATCHES_L     = ['#c89dff','#8cd3a0','#6ec5a8','#5cd4ea','#a4aeb8','#e94bd8'];

const TEMPLATE = `
  <div class="settings-root">
    <div class="settings-inner">

      <div class="settings-card">
        <div class="settings-card-head">
          <div class="settings-card-title">Keyboard</div>
          <div class="settings-card-sub">Setup items — configure once to match your MIDI controller.</div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">Key range</div>
          <div class="settings-row-value" data-role="key-range"></div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">Keyboard labels</div>
          <div class="settings-row-value" data-role="label-mode">
            <span class="settings-row-hint">FALLING NOTES ARE ALWAYS LABELED.</span>
          </div>
        </div>
      </div>

      <div class="settings-card">
        <div class="settings-card-head">
          <div class="settings-card-title">Practice</div>
          <div class="settings-card-sub">Timing, the click track, and how far ahead you see.</div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">Look ahead</div>
          <div class="settings-row-value">
            <input class="settings-range" type="range" min="1" max="8" step="0.5"
                   data-role="lookahead-input">
            <span class="settings-range-value" data-role="lookahead-value">3.0s</span>
            <span class="settings-row-hint">HEIGHT OF THE FALLING-NOTE WINDOW.</span>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">Input offset</div>
          <div class="settings-row-value">
            <input class="settings-range" type="range" min="-200" max="200" step="5"
                   data-role="latency-input">
            <span class="settings-range-value" data-role="latency-value">0 ms</span>
            <span class="settings-row-hint">
              RAISE IF YOU'RE MARKED LATE WHEN PLAYING IN TIME.
            </span>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">Beats per bar</div>
          <div class="settings-row-value" data-role="beats-per-bar"></div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">Count-in</div>
          <div class="settings-row-value" data-role="count-in"></div>
        </div>
      </div>

      <div class="settings-card">
        <div class="settings-card-head">
          <div class="settings-card-title">Key colors</div>
          <div class="settings-card-sub">All C keys share the same color across every octave.</div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">C keys</div>
          <div class="settings-row-value" data-role="ck-color"></div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">White keys</div>
          <div class="settings-row-value" data-role="wk-color"></div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">Black keys</div>
          <div class="settings-row-value" data-role="bk-color"></div>
        </div>
      </div>

      <div class="settings-card">
        <div class="settings-card-head">
          <div class="settings-card-title">Hand colors</div>
          <div class="settings-card-sub">Color for falling notes.</div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">Right hand</div>
          <div class="settings-row-value" data-role="r-color"></div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">Left hand</div>
          <div class="settings-row-value" data-role="l-color"></div>
        </div>
      </div>

      <div class="settings-card">
        <div class="settings-card-head">
          <div class="settings-card-title">MIDI</div>
          <div class="settings-card-sub">Device and channel configuration.</div>
        </div>
        <div class="settings-row" data-role="profile-row">
          <div class="settings-row-label">Profile</div>
          <div class="settings-row-value">
            <select class="settings-select" data-role="profile-select"></select>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">Output device</div>
          <div class="settings-row-value settings-device-list" data-role="output-devices"></div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">Input device</div>
          <div class="settings-row-value settings-device-list" data-role="input-devices"></div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">Channel</div>
          <div class="settings-row-value">
            <select class="settings-select" data-role="channel-select"></select>
            <span class="settings-row-hint">SELDOM CHANGED</span>
          </div>
        </div>
      </div>

      <div class="settings-card">
        <div class="settings-card-head">
          <div class="settings-card-title">Mirror to iPad</div>
          <div class="settings-card-sub">Start mirroring to get a 6-digit code for the iPad or iPhone.</div>
        </div>
        <div class="settings-mirror" data-role="mirror-panel">
          <div class="settings-mirror-code" data-role="mirror-code">------</div>
          <button class="settings-btn primary" data-action="mirror-toggle">START MIRRORING</button>
          <div class="settings-mirror-help" data-role="mirror-help">
            Enter this code on your iPad after you start mirroring.
          </div>
        </div>
      </div>

      <div class="settings-card">
        <div class="settings-card-head">
          <div class="settings-card-title">Diagnostics</div>
        </div>
        <div class="settings-row">
          <div class="settings-row-label">Identity Request</div>
          <div class="settings-row-value">
            <button class="settings-btn" data-action="identity">SEND (F0 7E 7F 06 01 F7)</button>
          </div>
        </div>
        <div class="settings-row hidden" data-role="identity-result-row">
          <div class="settings-row-label">Response</div>
          <div class="settings-row-value">
            <pre class="settings-identity-result" data-role="identity-result"></pre>
          </div>
        </div>
      </div>

      <div class="settings-card">
        <div class="settings-card-head">
          <div class="settings-card-title">Profile notes</div>
        </div>
        <div class="settings-card-body">
          <div class="settings-profile-notes" data-role="profile-notes">—</div>
        </div>
      </div>
    </div>
  </div>
`;

export function mountSettings(root, { onProfileChange } = {}) {
  root.innerHTML = TEMPLATE;
  const $ = (sel) => root.querySelector(sel);

  buildKeyRange();
  buildLabelMode();
  buildPracticeControls();
  buildColorRow('[data-role="ck-color"]', 'cKeyColor', KEY_SWATCHES_C);
  buildColorRow('[data-role="wk-color"]', 'whiteKeyColor', KEY_SWATCHES_WHITE);
  buildColorRow('[data-role="bk-color"]', 'blackKeyColor', KEY_SWATCHES_BLACK);
  buildColorRow('[data-role="r-color"]',  'rightHandColor', HAND_SWATCHES_R);
  buildColorRow('[data-role="l-color"]',  'leftHandColor',  HAND_SWATCHES_L);
  buildProfileSelect();
  buildChannelSelect();
  renderProfileNotes();

  $('[data-action="identity"]').addEventListener('click', sendIdentityRequest);
  $('[data-action="mirror-toggle"]').addEventListener('click', toggleMirror);

  const unsubscribeMIDI = onStateChange(() => { renderDevices(); });
  const unsubscribeSettings = onSettingsChange(() => renderAll());
  const unsubscribeMirror = onMirrorStatus(renderMirror);
  const unsubscribeSysEx = onSysEx((bytes) => {
    const reply = parseIdentityReply(bytes);
    if (reply) showIdentityReply(reply);
  });
  renderDevices();
  renderMirror({ state: isMirrorActive() ? 'ready' : 'idle' });

  function renderAll() {
    // Re-sync header rows where settings drive an input's visible value.
    const s = getSettings();
    $('[data-role="key-range"]').querySelectorAll('button').forEach(btn => {
      btn.classList.toggle('active', Number(btn.dataset.keys) === Number(s.keyboardRange));
    });
    $('[data-role="label-mode"]').querySelectorAll('button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === (s.labelMode || 'c-only'));
    });
    syncSwatches('[data-role="ck-color"]', s.cKeyColor);
    syncSwatches('[data-role="wk-color"]', s.whiteKeyColor);
    syncSwatches('[data-role="bk-color"]', s.blackKeyColor);
    syncSwatches('[data-role="r-color"]',  s.rightHandColor);
    syncSwatches('[data-role="l-color"]',  s.leftHandColor);

    // The controller view has its own profile picker, and auto-detection can
    // switch profiles on its own. Keep this one in step instead of showing
    // whatever was selected when the tab was first built.
    for (const [sel, key, fallback] of [
      ['[data-role="beats-per-bar"]', 'beatsPerBar', 4],
      ['[data-role="count-in"]', 'countInBars', 0],
    ]) {
      const value = s[key] ?? fallback;
      $(sel).querySelectorAll('button').forEach(btn => {
        btn.classList.toggle('active', Number(btn.dataset.value) === Number(value));
      });
    }
    const look = $('[data-role="lookahead-input"]');
    if (document.activeElement !== look) look.value = String(Number(s.lookAheadSeconds) || 3);
    $('[data-role="lookahead-value"]').textContent = `${Number(look.value).toFixed(1)}s`;
    const lat = $('[data-role="latency-input"]');
    if (document.activeElement !== lat) lat.value = String(Number(s.inputLatencyMs) || 0);
    $('[data-role="latency-value"]').textContent = `${lat.value} ms`;

    const profileSel = $('[data-role="profile-select"]');
    const wanted = s.selectedProfileId || loadDefaultProfile().id;
    if (profileSel.value !== wanted) profileSel.value = wanted;
    $('[data-role="channel-select"]').value = String(s.midiChannel ?? 0);
  }

  function buildKeyRange() {
    const host = $('[data-role="key-range"]');
    host.innerHTML = '';
    const current = Number(getSettings().keyboardRange || 88);
    for (const n of [25,37,49,61,76,88]) {
      const r = KEYBOARD_RANGES[n];
      const btn = document.createElement('button');
      btn.className = 'settings-chip';
      btn.dataset.keys = n;
      if (n === current) btn.classList.add('active');
      btn.textContent = r ? `${n} · ${r.label.replace(`${n} keys (`, '').replace(')', '')}` : `${n}`;
      btn.addEventListener('click', () => updateSettings({ keyboardRange: n }));
      host.appendChild(btn);
    }
  }

  function buildLabelMode() {
    const host = $('[data-role="label-mode"]');
    const hint = host.querySelector('.settings-row-hint');
    host.innerHTML = '';
    const current = getSettings().labelMode || 'c-only';
    for (const [mode, label] of [['none','None'],['c-only','C keys only'],['all','All notes']]) {
      const btn = document.createElement('button');
      btn.className = 'settings-chip';
      btn.dataset.mode = mode;
      if (mode === current) btn.classList.add('active');
      btn.textContent = label;
      btn.addEventListener('click', () => updateSettings({ labelMode: mode }));
      host.appendChild(btn);
    }
    if (hint) host.appendChild(hint);
  }

  function buildChipRow(sel, settingKey, options, fallback) {
    const host = $(sel);
    host.innerHTML = '';
    const current = getSettings()[settingKey] ?? fallback;
    for (const [value, label] of options) {
      const btn = document.createElement('button');
      btn.className = 'settings-chip';
      btn.dataset.value = String(value);
      btn.textContent = label;
      if (value === current) btn.classList.add('active');
      btn.addEventListener('click', () => updateSettings({ [settingKey]: value }));
      host.appendChild(btn);
    }
  }

  function buildPracticeControls() {
    const s = getSettings();

    const look = $('[data-role="lookahead-input"]');
    look.value = String(Number(s.lookAheadSeconds) || 3);
    $('[data-role="lookahead-value"]').textContent = `${Number(look.value).toFixed(1)}s`;
    look.addEventListener('input', () => {
      $('[data-role="lookahead-value"]').textContent = `${Number(look.value).toFixed(1)}s`;
      updateSettings({ lookAheadSeconds: Number(look.value) });
    });

    const lat = $('[data-role="latency-input"]');
    lat.value = String(Number(s.inputLatencyMs) || 0);
    $('[data-role="latency-value"]').textContent = `${lat.value} ms`;
    lat.addEventListener('input', () => {
      $('[data-role="latency-value"]').textContent = `${lat.value} ms`;
      updateSettings({ inputLatencyMs: Number(lat.value) });
    });

    buildChipRow('[data-role="beats-per-bar"]', 'beatsPerBar',
      [[2, '2'], [3, '3'], [4, '4'], [6, '6']], 4);
    buildChipRow('[data-role="count-in"]', 'countInBars',
      [[0, 'Off'], [1, '1 bar'], [2, '2 bars']], 0);
  }

  function buildColorRow(sel, settingKey, swatches) {
    const host = $(sel);
    host.innerHTML = '';
    const current = getSettings()[settingKey];
    for (const color of swatches) {
      const el = document.createElement('button');
      el.className = 'settings-swatch';
      el.style.background = color;
      el.dataset.color = color;
      if (color === current) el.classList.add('active');
      el.addEventListener('click', () => updateSettings({ [settingKey]: color }));
      host.appendChild(el);
    }
    const code = document.createElement('span');
    code.className = 'settings-swatch-code';
    code.dataset.role = 'code';
    code.textContent = (current || '').toUpperCase();
    host.appendChild(code);
  }

  function syncSwatches(sel, value) {
    const host = $(sel);
    host.querySelectorAll('.settings-swatch').forEach(el => {
      el.classList.toggle('active', el.dataset.color === value);
    });
    const code = host.querySelector('[data-role="code"]');
    if (code) code.textContent = (value || '').toUpperCase();
  }

  function buildProfileSelect() {
    const sel = $('[data-role="profile-select"]');
    sel.innerHTML = '';
    for (const p of availableProfiles()) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.manufacturer} ${p.model}`;
      sel.appendChild(opt);
    }
    // Fall back to the profile the controller actually boots with, not
    // whichever entry happens to be first in the registry — those differ,
    // so a fresh install showed "Roland JUNO-G" while driving Generic GM.
    sel.value = getSettings().selectedProfileId || loadDefaultProfile().id;
    sel.addEventListener('change', (e) => {
      updateSettings({ selectedProfileId: e.target.value });
      onProfileChange?.(e.target.value);
      renderProfileNotes();
    });
  }

  function buildChannelSelect() {
    const sel = $('[data-role="channel-select"]');
    sel.innerHTML = '';
    for (let i = 0; i < 16; i++) {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = `Channel ${i + 1}`;
      sel.appendChild(opt);
    }
    sel.value = String(getSettings().midiChannel ?? 0);
    sel.addEventListener('change', (e) => {
      updateSettings({ midiChannel: Number(e.target.value) });
    });
  }

  function renderDevices() {
    renderDeviceList($('[data-role="output-devices"]'), 'output');
    renderDeviceList($('[data-role="input-devices"]'), 'input');
  }

  function renderDeviceList(container, kind) {
    const midi = getState();
    container.innerHTML = '';
    if (!midi.supported) {
      container.innerHTML = '<div class="settings-empty">Web MIDI not supported. Open in Chrome or Edge.</div>';
      return;
    }
    if (!midi.requested) {
      const btn = document.createElement('button');
      btn.className = 'settings-btn';
      btn.textContent = 'GRANT MIDI ACCESS';
      btn.addEventListener('click', () => requestAccess({ sysex: true }));
      container.appendChild(btn);
      return;
    }
    if (midi.error) {
      const el = document.createElement('div');
      el.className = 'settings-empty';
      el.textContent = `MIDI access denied: ${midi.error}`;
      container.appendChild(el);
      return;
    }
    const devices = kind === 'output' ? midi.outputs : midi.inputs;
    if (devices.length === 0) {
      container.innerHTML = `<div class="settings-empty">No MIDI ${kind}s found.</div>`;
      return;
    }
    const selectedId = kind === 'output' ? midi.selectedOutputId : midi.selectedInputId;
    const pick = kind === 'output' ? selectOutput : selectInput;
    devices.forEach(d => {
      const el = document.createElement('button');
      el.className = 'settings-device' + (d.id === selectedId ? ' active' : '');
      // Device names/manufacturers come from the OS and the hardware's USB
      // descriptors — never interpolate them into markup.
      const name = document.createElement('span');
      name.className = 'settings-device-name';
      name.textContent = d.name;
      const meta = document.createElement('span');
      meta.className = 'settings-device-meta';
      meta.textContent = d.manufacturer || '—';
      el.append(name, meta);
      el.addEventListener('click', () => pick(d.id));
      container.appendChild(el);
    });
  }

  function renderProfileNotes() {
    const notesEl = $('[data-role="profile-notes"]');
    const id = getSettings().selectedProfileId;
    try {
      const profile = id ? loadProfile(id) : loadDefaultProfile();
      notesEl.textContent = profile.notes || '—';
    } catch { notesEl.textContent = '—'; }
  }

  function sendIdentityRequest() {
    sendSysEx(IDENTITY_REQUEST);
    $('[data-role="identity-result-row"]').classList.remove('hidden');
    $('[data-role="identity-result"]').textContent = 'Waiting for reply…';
  }

  function formatPair(bytes) {
    return bytes.map(b => b.toString(16).padStart(2, '0')).join(' ');
  }

  function showIdentityReply(reply) {
    $('[data-role="identity-result-row"]').classList.remove('hidden');
    $('[data-role="identity-result"]').textContent =
      `Manufacturer: ${reply.manufacturerName}\n` +
      `Family:       ${formatPair(reply.familyCode)}\n` +
      `Model:        ${formatPair(reply.modelNumber)}\n` +
      `Version:      ${reply.version.map(b => b.toString(16).padStart(2, '0')).join(' ')}`;
  }

  function toggleMirror() {
    if (isMirrorActive()) stopMirror();
    else startMirror();
  }

  function renderMirror(st) {
    const btn = $('[data-action="mirror-toggle"]');
    const codeEl = $('[data-role="mirror-code"]');
    const helpEl = $('[data-role="mirror-help"]');
    const active = st && st.state !== 'idle';
    if (active) {
      btn.textContent = 'STOP MIRRORING';
      btn.classList.add('danger');
      btn.classList.remove('primary');
      codeEl.textContent = (st.code || '------').split('').join(' ');
      const peers = st.peers || 0;
      helpEl.textContent = peers > 0
        ? `${peers} device${peers === 1 ? '' : 's'} connected.`
        : 'Waiting for a device — open keyfall on your iPad and tap REMOTE.';
    } else {
      btn.textContent = 'START MIRRORING';
      btn.classList.remove('danger');
      btn.classList.add('primary');
      codeEl.textContent = '------';
      helpEl.textContent = 'Start mirroring to get a pairing code.';
    }
  }

  renderAll();

  return {
    destroy() {
      unsubscribeMIDI();
      unsubscribeSettings();
      unsubscribeMirror();
      unsubscribeSysEx();
    },
    refresh() { renderAll(); renderDevices(); renderProfileNotes(); },
  };
}
