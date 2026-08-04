import { formatHex, maxValueFor, encodingForSize } from '../midi/sysex.js';

// SysEx parameter editor.
//
// Some instrument parameters have no CC — Roland's MFX, chorus and reverb
// blocks are reached only through System Exclusive. The builders for those
// messages already existed; this is the screen that drives them.
//
// A profile's `sysex.commands` map supplies the address and size. Optional
// metadata (label, min, max, default, unit, values) shapes the control:
// a named value list becomes a dropdown, anything else a slider plus a
// numeric field. Without metadata, the range is whatever the size allows.
//
// The encoded bytes are shown live, because when a parameter doesn't do what
// the service notes claim, the first question is always "what did we actually
// send?"

function commandRange(cmd) {
  const size = cmd.size ?? 1;
  const ceiling = maxValueFor(size, cmd.encoding);
  return {
    size,
    encoding: encodingForSize(size, cmd.encoding),
    min: cmd.min ?? 0,
    max: cmd.max ?? ceiling,
    ceiling,
  };
}

// values may be an array (index = value) or an object keyed by value.
function valueOptions(cmd) {
  if (!cmd.values) return null;
  const pairs = Array.isArray(cmd.values)
    ? cmd.values.map((label, i) => [i, label])
    : Object.entries(cmd.values).map(([k, label]) => [Number(k), label]);
  return pairs.filter(([n, label]) => Number.isInteger(n) && typeof label === 'string');
}

export function mountSysEx(container, profile, { onSet, onPreview }) {
  container.innerHTML = '';
  container.dataset.profileId = profile.id;

  const sx = profile.sysex;
  const commands = Object.entries(sx?.commands || {});

  if (!sx || commands.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'no-controls';
    empty.textContent = profile.sysex
      ? `${profile.model} defines no SysEx parameters yet.`
      : `${profile.model} has no SysEx section in its profile.`;
    container.appendChild(empty);
    const hint = document.createElement('div');
    hint.className = 'sysex-hint';
    hint.textContent = 'Add entries under "sysex.commands" in the profile JSON — '
      + 'see docs/adding-a-profile.md.';
    container.appendChild(hint);
    container._sysexUpdate = () => {};
    return container._sysexUpdate;
  }

  // Header: which device and model these messages are addressed to.
  const header = document.createElement('div');
  header.className = 'sysex-header';
  const fmt = document.createElement('span');
  fmt.textContent = sx.parameterFormat || 'unknown format';
  const dev = document.createElement('span');
  dev.textContent = `device ${sx.deviceId ?? 16}`;
  const model = document.createElement('span');
  model.textContent = `model ${formatHex(sx.modelId || [])}`;
  header.append(fmt, dev, model);
  container.appendChild(header);

  const rows = new Map();

  for (const [id, cmd] of commands) {
    const range = commandRange(cmd);
    const options = valueOptions(cmd);

    const row = document.createElement('div');
    row.className = 'sysex-row';

    const head = document.createElement('div');
    head.className = 'sysex-row-head';
    const label = document.createElement('span');
    label.className = 'sysex-label';
    label.textContent = cmd.label || id;
    const addr = document.createElement('span');
    addr.className = 'sysex-addr';
    addr.textContent = `${formatHex(cmd.address || [])} · ${range.size}×${range.encoding}`;
    head.append(label, addr);
    row.appendChild(head);

    if (cmd.description) {
      const desc = document.createElement('div');
      desc.className = 'sysex-desc';
      desc.textContent = cmd.description;
      row.appendChild(desc);
    }

    const controls = document.createElement('div');
    controls.className = 'sysex-controls';

    let read = () => 0;
    let write = () => {};

    if (options) {
      const select = document.createElement('select');
      select.className = 'ctrl-select';
      for (const [value, text] of options) {
        const opt = document.createElement('option');
        opt.value = String(value);
        opt.textContent = `${value} — ${text}`;
        select.appendChild(opt);
      }
      select.addEventListener('change', () => onSet(id, Number(select.value)));
      select.addEventListener('input', () => refreshPreview(Number(select.value)));
      controls.appendChild(select);
      read = () => Number(select.value);
      write = (v) => { if (document.activeElement !== select) select.value = String(v); };
    } else {
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.className = 'settings-range';
      slider.min = String(range.min);
      slider.max = String(range.max);
      slider.step = '1';

      const number = document.createElement('input');
      number.type = 'number';
      number.className = 'sysex-number';
      number.min = String(range.min);
      number.max = String(range.max);

      const clamp = (v) => Math.max(range.min, Math.min(range.max, Math.round(Number(v) || 0)));
      // Dragging previews continuously but only transmits on release, so a
      // slider drag doesn't flood the MIDI port with hundreds of messages.
      slider.addEventListener('input', () => {
        number.value = slider.value;
        refreshPreview(clamp(slider.value));
      });
      slider.addEventListener('change', () => onSet(id, clamp(slider.value)));
      number.addEventListener('change', () => {
        const v = clamp(number.value);
        number.value = String(v);
        slider.value = String(v);
        onSet(id, v);
      });

      controls.append(slider, number);
      read = () => clamp(slider.value);
      write = (v) => {
        const c = clamp(v);
        if (document.activeElement !== slider) slider.value = String(c);
        if (document.activeElement !== number) number.value = String(c);
      };
    }

    const send = document.createElement('button');
    send.className = 'ctrl-btn';
    send.textContent = 'SEND';
    send.addEventListener('click', () => onSet(id, read()));
    controls.appendChild(send);
    row.appendChild(controls);

    const preview = document.createElement('div');
    preview.className = 'sysex-preview';
    row.appendChild(preview);

    function refreshPreview(value) {
      const bytes = onPreview(id, value);
      preview.textContent = bytes
        ? formatHex(bytes).toUpperCase()
        : 'cannot build message for this profile';
      preview.classList.toggle('bad', !bytes);
    }

    container.appendChild(row);
    rows.set(id, { write, refreshPreview });
  }

  const update = (values = {}) => {
    for (const [id, row] of rows) {
      const v = values[id] ?? 0;
      row.write(v);
      row.refreshPreview(v);
    }
  };

  container._sysexUpdate = update;
  return update;
}
