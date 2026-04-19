import { createController } from './controller.js';
import { renderEffects, renderControls } from './effects-ui.js';
import { availableProfiles } from './profile-loader.js';
import { onTx } from '../midi/output.js';

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
        <div class="setting-label">MIDI Channel</div>
        <div class="setting-options" data-role="channel-options"></div>
      </div>
      <div class="setting-group">
        <div class="setting-label">Diagnostics</div>
        <button class="identity-btn" data-action="identity">SEND IDENTITY REQUEST (F0 7E 7F 06 01 F7)</button>
        <div class="identity-result hidden" data-role="identity-result"></div>
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

  buildProfileSelect();
  buildChannelOptions();
  onTx(() => flashLed());

  $$('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  $('[data-action="identity"]').addEventListener('click', () => controller.sendIdentityRequest());

  const unsubscribe = controller.onChange(render);
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
    const patchName = patches[patchIndex] || '—';

    $('[data-role="lcd-bank"]').textContent = bank?.label ?? '—';
    $('[data-role="lcd-patch-num"]').textContent = bank
      ? `${String(patchIndex + 1).padStart(3, '0')}/${patches.length}`
      : '000/000';
    $('[data-role="lcd-patch-name"]').textContent = patchName;
    $('[data-role="lcd-channel"]').textContent = channel + 1;
    $('[data-role="lcd-msg"]').textContent = lastMessage || 'READY';

    renderBankBar(profile.banks, bankIndex);
    if (activeTab === 'patches') renderPatchList(patches, patchIndex);
    if (activeTab === 'effects') renderEffects($('[data-role="fx-sliders"]'), profile, effectValues, (id, v) => controller.setEffectValue(id, v));
    if (activeTab === 'controls') renderControls($('[data-role="controls-list"]'), profile, controlStates, (id) => controller.toggleControl(id));

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

  function renderBankBar(banks, activeIdx) {
    const bar = $('[data-role="bank-bar"]');
    bar.innerHTML = '';
    banks.forEach((bank, i) => {
      const btn = document.createElement('button');
      btn.className = 'bank-btn' + (i === activeIdx ? ' active' : '');
      btn.textContent = bank.label;
      btn.addEventListener('click', () => controller.setBank(i));
      bar.appendChild(btn);
    });
  }

  function renderPatchList(patches, activeIdx) {
    const list = $('[data-role="patch-list"]');
    list.innerHTML = '';
    patches.forEach((name, i) => {
      const btn = document.createElement('button');
      btn.className = 'patch-item' + (i === activeIdx ? ' active' : '');
      btn.innerHTML = `
        <span class="patch-num">${String(i + 1).padStart(3, '0')}</span>
        <span class="patch-name">${name}</span>
      `;
      btn.addEventListener('click', () => {
        controller.setPatch(i);
        btn.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
      list.appendChild(btn);
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

  return {
    destroy() { unsubscribe(); },
  };
}
