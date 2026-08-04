import { createDraft, loadStoredDraft, suggestId } from './profile-draft.js';
import { formatValidationResult } from '../profiles/validate.js';
import { sendPatchChange } from '../midi/output.js';
import { IDENTITY_REQUEST, parseIdentityReply, formatHex } from '../midi/sysex.js';
import { onSysEx } from '../midi/input.js';
import { sendSysEx } from '../midi/output.js';

// Capture a keyboard profile from the keyboard itself.
//
// Selecting a patch here sends Bank Select + Program Change to the connected
// instrument, which then shows the patch name on its own display. You type
// what you see and press Enter; it advances and selects the next slot. That
// makes a profile something you can produce with the hardware in front of
// you, rather than needing a MIDI implementation chart you may not have.

const TEMPLATE = `
  <div class="builder">
    <div class="builder-intro">
      Selecting a slot sends Bank Select + Program Change to the connected keyboard.
      Read the patch name off the instrument's display, type it, and press Enter to
      store it and move to the next slot.
    </div>

    <div class="builder-section">
      <div class="builder-section-title">Instrument</div>
      <div class="builder-grid">
        <label>Manufacturer<input class="builder-input" data-role="builder-manufacturer" placeholder="Roland"></label>
        <label>Model<input class="builder-input" data-role="builder-model" placeholder="JUNO-DS"></label>
        <label>Profile id<input class="builder-input" data-role="builder-id" placeholder="roland-juno-ds"></label>
      </div>
      <div class="builder-row">
        <button class="ctrl-btn" data-action="identity">READ IDENTITY</button>
        <span class="builder-hint" data-role="identity-result">
          Optional — lets the app auto-select this profile when the keyboard is plugged in.
        </span>
      </div>
    </div>

    <div class="builder-section">
      <div class="builder-section-title">Banks</div>
      <div class="builder-banks" data-role="bank-list"></div>
      <div class="builder-row">
        <button class="ctrl-btn" data-action="add-bank">ADD BANK</button>
        <span class="builder-hint">
          MSB and LSB come from the keyboard's MIDI implementation, or from trial and error —
          change them and listen.
        </span>
      </div>
    </div>

    <div class="builder-section" data-role="scan-section">
      <div class="builder-section-title">Capture <span data-role="scan-bank"></span></div>
      <div class="builder-scan">
        <button class="ctrl-btn" data-action="prev">◀</button>
        <div class="builder-slot">
          <div class="builder-slot-pc" data-role="slot-pc">PC 0</div>
          <div class="builder-slot-msg" data-role="slot-msg"></div>
        </div>
        <button class="ctrl-btn" data-action="next">▶</button>
        <input class="builder-input builder-name" data-role="patch-name"
               placeholder="Type the name shown on the keyboard" autocomplete="off">
        <button class="ctrl-btn" data-action="skip" title="Leave this slot unnamed and move on">SKIP</button>
      </div>
      <div class="builder-progress">
        <div class="builder-progress-bar"><div data-role="scan-fill"></div></div>
        <span data-role="scan-count"></span>
      </div>
    </div>

    <div class="builder-section">
      <div class="builder-section-title">Export</div>
      <pre class="builder-validation" data-role="validation"></pre>
      <div class="builder-row">
        <button class="ctrl-btn" data-action="download">DOWNLOAD JSON</button>
        <button class="ctrl-btn" data-action="copy">COPY</button>
        <button class="ctrl-btn danger" data-action="reset">START OVER</button>
        <span class="builder-hint" data-role="export-msg"></span>
      </div>
    </div>
  </div>
`;

export function mountProfileBuilder(container, { getChannel } = {}) {
  container.innerHTML = TEMPLATE;
  const $ = (sel) => container.querySelector(sel);

  const draft = createDraft(loadStoredDraft());
  const channel = () => getChannel?.() ?? 0;

  // ── Sending ─────────────────────────────────────────────────────────────

  function selectCurrentSlot() {
    const bank = draft.currentBank();
    if (!bank) return;
    const pc = draft.get().cursor.pc;
    const ok = sendPatchChange(channel(), bank.msb, bank.lsb, pc);
    $('[data-role="slot-msg"]').textContent = ok === false
      ? 'No MIDI output selected'
      : `CC0 ${bank.msb} · CC32 ${bank.lsb} · PC ${pc}`;
  }

  const unsubscribeSysEx = onSysEx((bytes) => {
    const reply = parseIdentityReply(bytes);
    if (!reply) return;
    draft.setIdentityResponse(reply);
    $('[data-role="identity-result"]').textContent =
      `${reply.manufacturerName} · family ${formatHex(reply.familyCode)} · ` +
      `model ${formatHex(reply.modelNumber)}`;
  });

  // ── Rendering ───────────────────────────────────────────────────────────

  function renderIdentity(d) {
    for (const key of ['manufacturer', 'model', 'id']) {
      const el = $(`[data-role="builder-${key}"]`);
      if (document.activeElement !== el) el.value = d[key] || '';
    }
  }

  function renderBanks(d) {
    const host = $('[data-role="bank-list"]');
    host.innerHTML = '';
    if (d.banks.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'builder-hint';
      empty.textContent = 'No banks yet. Add one to start capturing patch names.';
      host.appendChild(empty);
      return;
    }

    d.banks.forEach((bank, i) => {
      const row = document.createElement('div');
      row.className = 'builder-bank' + (i === d.cursor.bankIndex ? ' active' : '');

      const pick = document.createElement('button');
      pick.className = 'builder-bank-pick';
      pick.textContent = bank.label || bank.id;
      pick.addEventListener('click', () => { draft.selectBank(i); selectCurrentSlot(); });

      const mk = (label, key, max) => {
        const wrap = document.createElement('label');
        wrap.className = 'builder-bank-field';
        wrap.textContent = label;
        const input = document.createElement('input');
        input.className = 'builder-input tiny';
        input.type = 'number';
        input.min = '0';
        input.max = String(max);
        input.value = String(bank[key]);
        input.addEventListener('change', () => {
          const v = Math.max(0, Math.min(max, Math.round(Number(input.value) || 0)));
          input.value = String(v);
          draft.updateBank(i, { [key]: v });
          if (i === d.cursor.bankIndex) selectCurrentSlot();
        });
        wrap.appendChild(input);
        return wrap;
      };

      const name = document.createElement('input');
      name.className = 'builder-input tiny wide';
      name.value = bank.id;
      name.addEventListener('change', () => {
        draft.updateBank(i, { id: name.value.trim(), label: name.value.trim() });
      });

      const count = document.createElement('span');
      count.className = 'builder-bank-count';
      count.textContent = `${draft.namedCount(bank)} named`;

      const del = document.createElement('button');
      del.className = 'builder-bank-del';
      del.textContent = '×';
      del.setAttribute('aria-label', `Remove ${bank.label || bank.id}`);
      del.addEventListener('click', () => draft.removeBank(i));

      row.append(pick, name, mk('MSB', 'msb', 127), mk('LSB', 'lsb', 127), count, del);
      host.appendChild(row);
    });
  }

  function renderScan(d) {
    const bank = draft.currentBank();
    const section = $('[data-role="scan-section"]');
    section.classList.toggle('hidden', !bank);
    if (!bank) return;

    $('[data-role="scan-bank"]').textContent = `— ${bank.label || bank.id}`;
    $('[data-role="slot-pc"]').textContent = `PC ${d.cursor.pc}`;

    const nameInput = $('[data-role="patch-name"]');
    const existing = bank.patches[d.cursor.pc] ?? '';
    if (document.activeElement !== nameInput) nameInput.value = existing;

    const named = draft.namedCount(bank);
    $('[data-role="scan-count"]').textContent = `${named} of 128 named`;
    $('[data-role="scan-fill"]').style.width = `${(named / 128) * 100}%`;
  }

  function renderValidation() {
    const result = draft.validate();
    const el = $('[data-role="validation"]');
    if (result.valid && result.warnings.length === 0) {
      el.textContent = 'Valid — ready to export.';
      el.className = 'builder-validation ok';
    } else if (result.valid) {
      el.textContent = `Valid, with notes:\n${formatValidationResult(result)}`;
      el.className = 'builder-validation warn';
    } else {
      el.textContent = `Not exportable yet:\n${formatValidationResult(result)}`;
      el.className = 'builder-validation bad';
    }
    return result;
  }

  function renderAll(d = draft.get()) {
    renderIdentity(d);
    renderBanks(d);
    renderScan(d);
    renderValidation();
  }

  // ── Wiring ──────────────────────────────────────────────────────────────

  for (const key of ['manufacturer', 'model']) {
    $(`[data-role="builder-${key}"]`).addEventListener('input', (e) => {
      draft.setIdentity({ [key]: e.target.value });
    });
  }
  $('[data-role="builder-id"]').addEventListener('input', (e) => draft.setId(e.target.value.trim()));

  $('[data-action="identity"]').addEventListener('click', () => {
    $('[data-role="identity-result"]').textContent = 'Waiting for a reply…';
    sendSysEx(IDENTITY_REQUEST);
  });

  $('[data-action="add-bank"]').addEventListener('click', () => {
    const n = draft.get().banks.length + 1;
    draft.addBank({ id: `BANK-${n}`, label: `Bank ${n}` });
    selectCurrentSlot();
  });

  $('[data-action="prev"]').addEventListener('click', () => {
    draft.advance(-1);
    selectCurrentSlot();
  });
  $('[data-action="next"]').addEventListener('click', () => {
    draft.advance(1);
    selectCurrentSlot();
  });
  $('[data-action="skip"]').addEventListener('click', () => {
    draft.advance(1);
    selectCurrentSlot();
    $('[data-role="patch-name"]').focus();
  });

  const nameInput = $('[data-role="patch-name"]');
  nameInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    draft.nameCurrent(nameInput.value);
    draft.advance(1);
    selectCurrentSlot();
    nameInput.value = draft.currentBank()?.patches[draft.get().cursor.pc] ?? '';
    nameInput.select();
  });
  // Leaving the field shouldn't lose what you typed.
  nameInput.addEventListener('blur', () => draft.nameCurrent(nameInput.value));

  $('[data-action="download"]').addEventListener('click', () => {
    const result = renderValidation();
    if (!result.valid) {
      $('[data-role="export-msg"]').textContent = 'Fix the problems above first.';
      return;
    }
    const profile = draft.toProfile();
    const blob = new Blob([JSON.stringify(profile, null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${profile.id || 'profile'}.json`;
    a.click();
    URL.revokeObjectURL(url);
    $('[data-role="export-msg"]').textContent = `Saved ${a.download}`;
  });

  $('[data-action="copy"]').addEventListener('click', async () => {
    const json = JSON.stringify(draft.toProfile(), null, 2);
    try {
      await navigator.clipboard.writeText(json);
      $('[data-role="export-msg"]').textContent = 'Copied to clipboard.';
    } catch {
      $('[data-role="export-msg"]').textContent = 'Clipboard unavailable — use Download.';
    }
  });

  $('[data-action="reset"]').addEventListener('click', () => {
    if (!confirm('Discard this draft and start over?')) return;
    draft.reset();
    $('[data-role="export-msg"]').textContent = '';
  });

  const unsubscribeDraft = draft.onChange(renderAll);
  renderAll();

  return {
    refresh: renderAll,
    destroy() {
      unsubscribeDraft();
      unsubscribeSysEx();
    },
  };
}
