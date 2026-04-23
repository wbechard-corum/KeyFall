import { createMirrorClient } from '../shared/mirror.js';
import { loadProfile, loadDefaultProfile } from '../controller/profile-loader.js';

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
      if (payload.profileId && (!profile || profile.id !== payload.profileId)) {
        try { profile = loadProfile(payload.profileId); }
        catch { profile = loadDefaultProfile(); }
        lastRenderedProfile = null;
        lastEffectsProfile = null;
        lastControlsProfile = null;
        channelBuilt = false;
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

    const bank = profile.banks[state.bankIndex];
    const patches = bank?.patches || [];
    const patch = patches[state.patchIndex];
    const patchName = patch ? (patch.name || patch) : '—';

    $('[data-role="lcd-bank"]').textContent = bank?.label ?? '—';
    $('[data-role="lcd-patch-num"]').textContent = bank
      ? `${String(state.patchIndex + 1).padStart(3, '0')}/${patches.length}`
      : '000/000';
    $('[data-role="lcd-patch-name"]').textContent = patchName;
    $('[data-role="lcd-channel"]').textContent = (state.channel ?? 0) + 1;
    $('[data-role="lcd-msg"]').textContent = state.lastMessage || '—';
    $('[data-role="footer"]').textContent = `${profile.manufacturer} ${profile.model}`;

    if (activeTab === 'patches') { renderBankBar(); renderPatchList(); }
    if (activeTab === 'effects') renderEffects();
    if (activeTab === 'controls') renderControls();
    if (activeTab === 'channel') renderChannel();
  }

  function renderBankBar() {
    const bar = $('[data-role="bank-bar"]');
    if (lastRenderedProfile !== profile.id) {
      bar.innerHTML = '';
      profile.banks.forEach((bank, i) => {
        const btn = document.createElement('button');
        btn.className = 'bank-btn';
        btn.textContent = bank.label;
        btn.addEventListener('click', () => client.sendCommand({ action: 'setBank', args: [i] }));
        bar.appendChild(btn);
      });
      lastRenderedProfile = profile.id;
      lastRenderedBank = null;
    }
    bar.querySelectorAll('.bank-btn').forEach((btn, i) => {
      btn.classList.toggle('active', i === state.bankIndex);
    });
  }

  function renderPatchList() {
    const list = $('[data-role="patch-list"]');
    const key = `${profile.id}:${state.bankIndex}`;
    if (lastRenderedBank !== key) {
      list.innerHTML = '';
      const bank = profile.banks[state.bankIndex];
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
          client.sendCommand({ action: 'setPatch', args: [i] });
        });
        list.appendChild(btn);
      });
      lastRenderedBank = key;
    }
    list.querySelectorAll('.patch-item').forEach((btn, i) => {
      btn.classList.toggle('active', i === state.patchIndex);
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
          client.sendCommand({ action: 'setEffectValue', args: [fx.id, v] });
        });
        host.appendChild(row);
      }
      lastEffectsProfile = profile.id;
    }
    for (const row of host.querySelectorAll('.mc-effect')) {
      const id = row.dataset.fxId;
      const v = state.effectValues?.[id] ?? 0;
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
          client.sendCommand({ action: 'toggleControl', args: [ctl.id] });
        });
        host.appendChild(btn);
      }
      lastControlsProfile = profile.id;
    }
    for (const btn of host.querySelectorAll('.mc-control')) {
      const id = btn.dataset.ctlId;
      btn.classList.toggle('active', !!state.controlStates?.[id]);
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
        btn.addEventListener('click', () => client.sendCommand({ action: 'setChannel', args: [i] }));
        host.appendChild(btn);
      }
      channelBuilt = true;
    }
    host.querySelectorAll('.mc-channel-btn').forEach((btn, i) => {
      btn.classList.toggle('active', i === state.channel);
    });
  }

  return {
    destroy() { client.close(); },
  };
}
