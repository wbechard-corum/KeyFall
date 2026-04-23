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

    <div class="bank-bar" data-role="bank-bar"></div>
    <div class="patch-list" data-role="patch-list"></div>
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
  $('[data-role="code"]').textContent = `#${code}`;

  let state = null;
  let profile = loadDefaultProfile();
  let lastRenderedProfile = null;
  let lastRenderedBank = null;

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
      }
      render();
    },
    onHostGone: () => {
      $('[data-role="footer"]').textContent = 'Host disconnected — waiting for reconnection…';
    },
  });

  function render() {
    const waitingEl = $('[data-role="waiting"]');
    const lcdEl = root.querySelector('.mirror-client-lcd');
    const bankBarEl = $('[data-role="bank-bar"]');
    const patchListEl = $('[data-role="patch-list"]');
    if (!state) {
      waitingEl.classList.remove('hidden');
      lcdEl.classList.add('hidden');
      bankBarEl.classList.add('hidden');
      patchListEl.classList.add('hidden');
      return;
    }
    waitingEl.classList.add('hidden');
    lcdEl.classList.remove('hidden');
    bankBarEl.classList.remove('hidden');
    patchListEl.classList.remove('hidden');
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

    renderBankBar();
    renderPatchList();
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

  return {
    destroy() { client.close(); },
  };
}
