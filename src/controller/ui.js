import { createController } from './controller.js';
import { mountEffects, mountControls } from './effects-ui.js';
import { mountSysEx } from './sysex-ui.js';
import { availableProfiles } from './profile-loader.js';
import { onTx } from '../midi/output.js';
import { onStateChange } from '../midi/connection.js';
import { setSection, setCommandHandler } from '../shared/app-mirror.js';

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
      <button class="tab-btn" data-tab="sysex">SYSEX</button>
    </div>

    <div class="patch-list" data-role="patch-list"></div>

    <div class="effects-panel hidden" data-role="effects-panel">
      <div class="fx-sliders" data-role="fx-sliders"></div>
    </div>

    <div class="controls-panel hidden" data-role="controls-panel">
      <div class="controls-list" data-role="controls-list"></div>
    </div>

    <div class="sysex-panel hidden" data-role="sysex-panel">
      <div class="sysex-list" data-role="sysex-list"></div>
    </div>

    <div class="footer">
      <span><span class="midi-activity" data-role="midi-led"></span>MIDI <span data-role="footer-status">IDLE</span></span>
      <span data-role="footer-version"></span>
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
  $('[data-role="footer-version"]').textContent = `v${__APP_VERSION__}`;
  const unsubscribeTx = onTx(() => flashLed());

  $$('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Wire this view into the shared mirror host so controller state
  // publishes out and client commands (setPatch, setBank, etc.) come
  // back in. Device lists, channel picker, mirror toggle, identity
  // request, and profile notes all live in the top-level Settings tab
  // now; this view is the "glance at the current patch" surface only.
  setCommandHandler('controller', (cmd) => controller.handleMirrorCommand(cmd));
  const unsubscribeMirrorPublish = controller.onChange((snap) => {
    setSection('controller', buildMirrorState(snap));
  });
  // Seed initial section state so late-joining clients see controller state.
  setSection('controller', buildMirrorState(controller.getSnapshot()));

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

  const unsubscribe = controller.onChange(render);
  const unsubscribeMIDI = onStateChange(() => render(controller.getSnapshot()));
  render(controller.getSnapshot());

  function switchTab(tab) {
    activeTab = tab;
    $$('.tab-btn').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    $('[data-role="patch-list"]').classList.toggle('hidden', tab !== 'patches');
    $('[data-role="effects-panel"]').classList.toggle('hidden', tab !== 'effects');
    $('[data-role="controls-panel"]').classList.toggle('hidden', tab !== 'controls');
    $('[data-role="sysex-panel"]').classList.toggle('hidden', tab !== 'sysex');
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

  function render(snap) {
    const { profile, bankIndex, patchIndex, channel, effectValues, controlStates, lastMessage } = snap;

    $('[data-role="manufacturer"]').textContent = (profile.manufacturer || '').toUpperCase();
    $('[data-role="model"]').textContent = (profile.model || '').toUpperCase();
    $('[data-role="profile-select"]').value = profile.id;

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
    if (activeTab === 'sysex') {
      const host = $('[data-role="sysex-list"]');
      // Rebuild only when the profile changes; otherwise just push values,
      // so a slider being dragged isn't torn out from under the pointer.
      const update = host.dataset.profileId === profile.id && host._sysexUpdate
        ? host._sysexUpdate
        : mountSysEx(host, profile, {
            onSet: (id, value) => controller.setSysExParameter(id, value),
            onPreview: (id, value) => controller.previewSysExParameter(id, value),
          });
      update(snap.sysexValues || {});
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
        // Patch names come from profile JSON, which the project intends to
        // accept from community contributors — keep it out of innerHTML.
        const num = document.createElement('span');
        num.className = 'patch-num';
        num.textContent = String(i + 1).padStart(3, '0');
        const name = document.createElement('span');
        name.className = 'patch-name';
        name.textContent = patch.name;
        btn.append(num, name);
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
    destroy() {
      unsubscribe();
      unsubscribeMIDI();
      unsubscribeTx();
      unsubscribeMirrorPublish();
    },
  };
}
