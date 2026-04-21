import { createController } from './controller.js';
import { mountEffects, mountControls } from './effects-ui.js';
import { availableProfiles } from './profile-loader.js';
import { onTx } from '../midi/output.js';
import { onStateChange, getState, selectInput, selectOutput, requestAccess } from '../midi/connection.js';
import { createMirrorHost } from '../shared/mirror.js';

const TEMPLATE = `
  <div class="controller-root">
    <div class="header">
      <div class="header-top">
        <div>
          <div class="brand-label" data-role="manufacturer">ROLAND</div>
          <div class="brand-name" data-role="model">JUNO-G</div>
        </div>
        <select class="profile-select" data-role="profile-select"></select>
      </div>
      <div class="lcd">
        <div class="lcd-row">
          <span class="lcd-label" data-role="lcd-bank">—</span>
          <span class="lcd-label" data-role="lcd-patch-num">000/000</span>
        </div>
        <div class="lcd-patch" data-role="lcd-patch-name">—</div>
        <div class="lcd-midi-info">
          <span>CH <span data-role="lcd-channel">1</span></span>
          <span data-role="lcd-msg">READY</span>
        </div>
      </div>
    </div>

    <div class="bank-bar" data-role="bank-bar"></div>

    <div class="tab-bar">
      <button class="tab-btn active" data-tab="patches">PATCHES</button>
      <button class="tab-btn" data-tab="effects">EFFECTS</button>
      <button class="tab-btn" data-tab="controls">CONTROLS</button>
      <button class="tab-btn" data-tab="settings">SETTINGS</button>
    </div>

    <div class="patch-list" data-role="patch-list"></div>

    <div class="effects-panel hidden" data-role="effects-panel">
      <div class="fx-sliders" data-role="fx-sliders"></div>
    </div>

    <div class="controls-panel hidden" data-role="controls-panel">
      <div class="controls-list" data-role="controls-list"></div>
    </div>

    <div class="settings-panel hidden" data-role="settings-panel">
      <div class="setting-group">
        <div class="setting-label">MIDI Output Device</div>
        <div class="device-list" data-role="output-devices"></div>
      </div>
      <div class="setting-group">
        <div class="setting-label">MIDI Input Device</div>
        <div class="device-list" data-role="input-devices"></div>
      </div>
      <div class="setting-group">
        <div class="setting-label">MIDI Channel</div>
        <div class="setting-options" data-role="channel-options"></div>
      </div>
      <div class="setting-group">
        <div class="setting-label">Diagnostics</div>
        <button class="identity-btn" data-action="identity">SEND IDENTITY REQUEST (F0 7E 7F 06 01 F7)</button>
        <div class="identity-result hidden" data-role="identity-result"></div>
      </div>
      <div class="setting-group">
        <div class="setting-label">Mirror to iPad</div>
        <div class="mirror-panel" data-role="mirror-panel">
          <button class="identity-btn" data-action="mirror-toggle">START MIRRORING</button>
          <div class="mirror-status hidden" data-role="mirror-status">
            <div class="mirror-code" data-role="mirror-code">------</div>
            <div class="mirror-help">
              On your iPad, open this page and add
              <code data-role="mirror-hash">#mirror=------</code>
              to the URL.
            </div>
            <div class="mirror-peers" data-role="mirror-peers">0 connected</div>
          </div>
        </div>
      </div>
      <div class="setting-group">
        <div class="setting-label">Profile Notes</div>
        <div class="profile-notes" data-role="profile-notes">—</div>
      </div>
    </div>

    <div class="footer">
      <span><span class="midi-activity" data-role="midi-led"></span>MIDI <span data-role="footer-status">IDLE</span></span>
      <span>v0.2</span>
    </div>
  </div>
`;

export function mountController(root) {
  root.innerHTML = TEMPLATE;
  const $ = (sel) => root.querySelector(sel);
  const $$ = (sel) => root.querySelectorAll(sel);

  const controller = createController();
  let activeTab = 'patches';
  let lastRenderedBankKey = null;  // `${profileId}:${bankIndex}` — triggers patch-list rebuild
  let lastRenderedBanksFor = null; // profile id for bank bar

  buildProfileSelect();
  buildChannelOptions();
  const unsubscribeTx = onTx(() => flashLed());

  $$('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  $('[data-action="identity"]').addEventListener('click', () => controller.sendIdentityRequest());
  $('[data-action="mirror-toggle"]').addEventListener('click', toggleMirror);

  let mirrorHost = null;
  let mirrorStatus = null;
  let unsubscribeMirrorPublish = null;

  function toggleMirror() {
    if (mirrorHost) {
      stopMirror();
    } else {
      startMirror();
    }
  }

  function startMirror() {
    mirrorHost = createMirrorHost({
      onStatus: (st) => { mirrorStatus = st; renderMirrorPanel(); },
      onCommand: (cmd) => controller.handleMirrorCommand(cmd),
    });
    unsubscribeMirrorPublish = controller.onChange((snap) => {
      mirrorHost?.publishState(buildMirrorState(snap));
    });
    // Publish initial snapshot so newly-joining clients see current state.
    mirrorHost.publishState(buildMirrorState(controller.getSnapshot()));
    $('[data-action="mirror-toggle"]').textContent = 'STOP MIRRORING';
    $('[data-role="mirror-status"]').classList.remove('hidden');
  }

  function stopMirror() {
    unsubscribeMirrorPublish?.();
    unsubscribeMirrorPublish = null;
    mirrorHost?.close();
    mirrorHost = null;
    mirrorStatus = null;
    $('[data-action="mirror-toggle"]').textContent = 'START MIRRORING';
    $('[data-role="mirror-status"]').classList.add('hidden');
  }

  function buildMirrorState(snap) {
    return {
      profileId: snap.profile.id,
      bankIndex: snap.bankIndex,
      patchIndex: snap.patchIndex,
      channel: snap.channel,
      effectValues: snap.effectValues,
      controlStates: snap.controlStates,
      lastMessage: snap.lastMessage,
    };
  }

  function renderMirrorPanel() {
    if (!mirrorStatus) return;
    const codeEl = $('[data-role="mirror-code"]');
    const hashEl = $('[data-role="mirror-hash"]');
    const peersEl = $('[data-role="mirror-peers"]');
    const code = mirrorStatus.code || '------';
    codeEl.textContent = code;
    hashEl.textContent = `#mirror=${code}`;
    peersEl.textContent = mirrorStatus.state === 'disconnected'
      ? 'Disconnected — retrying…'
      : `${mirrorStatus.peers || 0} connected`;
  }

  const unsubscribe = controller.onChange(render);
  const unsubscribeMIDI = onStateChange(() => render(controller.getSnapshot()));
  render(controller.getSnapshot());

  function switchTab(tab) {
    activeTab = tab;
    $$('.tab-btn').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    $('[data-role="patch-list"]').classList.toggle('hidden', tab !== 'patches');
    $('[data-role="effects-panel"]').classList.toggle('hidden', tab !== 'effects');
    $('[data-role="controls-panel"]').classList.toggle('hidden', tab !== 'controls');
    $('[data-role="settings-panel"]').classList.toggle('hidden', tab !== 'settings');
    render(controller.getSnapshot());
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
    sel.addEventListener('change', (e) => controller.setProfile(e.target.value));
  }

  function buildChannelOptions() {
    const container = $('[data-role="channel-options"]');
    container.innerHTML = '';
    for (let i = 0; i < 16; i++) {
      const btn = document.createElement('button');
      btn.className = 'setting-opt';
      btn.textContent = String(i + 1);
      btn.addEventListener('click', () => controller.setChannel(i));
      container.appendChild(btn);
    }
  }

  function render(snap) {
    const { profile, bankIndex, patchIndex, channel, effectValues, controlStates, lastMessage, lastIdentity } = snap;

    $('[data-role="manufacturer"]').textContent = (profile.manufacturer || '').toUpperCase();
    $('[data-role="model"]').textContent = (profile.model || '').toUpperCase();
    $('[data-role="profile-select"]').value = profile.id;
    $('[data-role="profile-notes"]').textContent = profile.notes || '—';

    const bank = profile.banks[bankIndex];
    const patches = bank?.patches || [];
    const patchName = patches[patchIndex]?.name || '—';

    $('[data-role="lcd-bank"]').textContent = bank?.label ?? '—';
    $('[data-role="lcd-patch-num"]').textContent = bank
      ? `${String(patchIndex + 1).padStart(3, '0')}/${patches.length}`
      : '000/000';
    $('[data-role="lcd-patch-name"]').textContent = patchName;
    $('[data-role="lcd-channel"]').textContent = channel + 1;
    $('[data-role="lcd-msg"]').textContent = lastMessage || 'READY';

    renderBankBar(profile, bankIndex);
    renderPatchList(profile, patches, bankIndex, patchIndex);

    if (activeTab === 'effects') {
      mountEffects($('[data-role="fx-sliders"]'), profile, (id, v) => controller.setEffectValue(id, v))(effectValues);
    }
    if (activeTab === 'controls') {
      mountControls($('[data-role="controls-list"]'), profile, (id) => controller.toggleControl(id))(controlStates);
    }
    if (activeTab === 'settings') renderDeviceLists();

    $$('[data-role="channel-options"] .setting-opt').forEach((btn, i) => {
      btn.classList.toggle('active', i === channel);
    });

    const result = $('[data-role="identity-result"]');
    if (lastIdentity) {
      result.classList.remove('hidden');
      result.textContent =
        `Manufacturer: ${lastIdentity.manufacturerName}\n` +
        `Family:       ${formatPair(lastIdentity.familyCode)}\n` +
        `Model:        ${formatPair(lastIdentity.modelNumber)}\n` +
        `Version:      ${lastIdentity.version.map(b => b.toString(16).padStart(2, '0')).join(' ')}`;
    }
  }

  function renderBankBar(profile, activeIdx) {
    const bar = $('[data-role="bank-bar"]');
    if (lastRenderedBanksFor !== profile.id) {
      bar.innerHTML = '';
      profile.banks.forEach((bank, i) => {
        const btn = document.createElement('button');
        btn.className = 'bank-btn';
        btn.textContent = bank.label;
        btn.addEventListener('click', () => controller.setBank(i));
        bar.appendChild(btn);
      });
      lastRenderedBanksFor = profile.id;
    }
    bar.querySelectorAll('.bank-btn').forEach((btn, i) => {
      btn.classList.toggle('active', i === activeIdx);
    });
  }

  function renderPatchList(profile, patches, bankIndex, patchIndex) {
    const list = $('[data-role="patch-list"]');
    const bankKey = `${profile.id}:${bankIndex}`;
    if (lastRenderedBankKey !== bankKey) {
      list.innerHTML = '';
      patches.forEach((patch, i) => {
        const btn = document.createElement('button');
        btn.className = 'patch-item';
        btn.innerHTML = `
          <span class="patch-num">${String(i + 1).padStart(3, '0')}</span>
          <span class="patch-name">${patch.name}</span>
        `;
        btn.addEventListener('click', () => {
          controller.setPatch(i);
          btn.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        });
        list.appendChild(btn);
      });
      lastRenderedBankKey = bankKey;
    }
    list.querySelectorAll('.patch-item').forEach((btn, i) => {
      btn.classList.toggle('active', i === patchIndex);
    });
  }

  function formatPair(bytes) {
    return bytes.map(b => b.toString(16).padStart(2, '0')).join(' ');
  }

  function flashLed() {
    const led = $('[data-role="midi-led"]');
    if (!led) return;
    led.classList.add('flash');
    $('[data-role="footer-status"]').textContent = 'TX';
    clearTimeout(flashLed._t);
    flashLed._t = setTimeout(() => {
      led.classList.remove('flash');
      $('[data-role="footer-status"]').textContent = 'IDLE';
    }, 120);
  }

  function renderDeviceLists() {
    const midi = getState();
    renderDeviceList($('[data-role="output-devices"]'), midi.outputs, midi.selectedOutputId, (id) => selectOutput(id), 'output');
    renderDeviceList($('[data-role="input-devices"]'), midi.inputs, midi.selectedInputId, (id) => selectInput(id), 'input');
  }

  function renderDeviceList(container, devices, selectedId, onPick, kind) {
    container.innerHTML = '';

    const midi = getState();
    if (!midi.supported) {
      container.innerHTML = '<div class="no-devices">Web MIDI not supported. Open in Chrome or Edge.</div>';
      return;
    }
    if (!midi.requested) {
      const btn = document.createElement('button');
      btn.className = 'identity-btn';
      btn.textContent = 'GRANT MIDI ACCESS';
      btn.addEventListener('click', () => requestAccess({ sysex: true }));
      container.appendChild(btn);
      return;
    }
    if (midi.error) {
      container.innerHTML = `<div class="no-devices">MIDI access denied: ${midi.error}</div>`;
      return;
    }
    if (devices.length === 0) {
      container.innerHTML = `<div class="no-devices">No MIDI ${kind}s found. Connect your keyboard and reload.</div>`;
      return;
    }

    devices.forEach(d => {
      const isActive = d.id === selectedId;
      const div = document.createElement('button');
      div.className = 'device-item' + (isActive ? ' active' : '');
      div.innerHTML = `
        <div>
          <div class="device-name">${d.name}</div>
          <div class="device-id">${d.manufacturer || '—'} · ${d.id.slice(0, 12)}</div>
        </div>
        ${isActive ? '<span class="device-check">✓</span>' : ''}
      `;
      div.addEventListener('click', () => onPick(d.id));
      container.appendChild(div);
    });
  }

  return {
    destroy() {
      unsubscribe();
      unsubscribeMIDI();
      unsubscribeTx();
      stopMirror();
    },
  };
}
