const FX_COLORS = ['#4FC3F7', '#81C784', '#FFB74D', '#E57373', '#B39DDB', '#FFB3A7', '#A5D6A7', '#9FA8DA', '#CE93D8'];

export function mountEffects(container, profile, onChange) {
  // Idempotent: only rebuild the slider DOM when the profile changes,
  // otherwise update existing fill/thumb/value in place. Rebuilding mid-drag
  // would orphan the pointermove listener and break the slider.
  // Guard on the updater too: a container tagged with the profile id but
  // missing its updater would return undefined, and the caller invokes the
  // result immediately.
  if (container.dataset.profileId === profile.id && container._fxUpdate) {
    return container._fxUpdate;
  }

  container.innerHTML = '';
  container.dataset.profileId = profile.id;

  const sliders = new Map();

  profile.effects.forEach((fx, idx) => {
    const color = FX_COLORS[idx % FX_COLORS.length];
    const min = fx.min ?? 0;
    const max = fx.max ?? 127;

    // Labels and ids come from profile JSON. `color` is ours (FX_COLORS), so
    // it's safe in the style strings; everything profile-supplied goes in as
    // text, never markup.
    const slider = document.createElement('div');
    slider.className = 'fx-slider';
    slider.innerHTML = `
      <div class="fx-label" style="color:${color}"></div>
      <div class="fx-track">
        <div class="fx-fill" style="background:linear-gradient(to top,${color}22,${color}66)"></div>
        <div class="fx-thumb" style="background:${color}"></div>
      </div>
      <div class="fx-value"></div>
      <div class="fx-cc"></div>
    `;
    slider.querySelector('.fx-label').textContent = fx.label;
    slider.querySelector('.fx-track').dataset.fx = fx.id;
    slider.querySelector('.fx-cc').textContent = `CC ${fx.cc}`;
    container.appendChild(slider);

    const track = slider.querySelector('.fx-track');
    const fill = slider.querySelector('.fx-fill');
    const thumb = slider.querySelector('.fx-thumb');
    const valLabel = slider.querySelector('.fx-value');

    function applyValue(v) {
      const pct = ((v - min) / (max - min)) * 100;
      fill.style.height = `${pct}%`;
      thumb.style.bottom = `${pct}%`;
      valLabel.textContent = v;
    }

    function updateFromY(clientY) {
      const rect = track.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height));
      const val = Math.round(min + ratio * (max - min));
      applyValue(val);
      onChange(fx.id, val);
    }

    // Listeners on `document` so drag survives any container re-render.
    track.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { track.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      updateFromY(e.clientY);

      const move = (ev) => { ev.preventDefault(); updateFromY(ev.clientY); };
      const up = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        document.removeEventListener('pointercancel', up);
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
      document.addEventListener('pointercancel', up);
    });

    sliders.set(fx.id, { applyValue });
  });

  const update = (values) => {
    for (const fx of profile.effects) {
      const v = values[fx.id] ?? fx.default ?? 0;
      sliders.get(fx.id)?.applyValue(v);
    }
  };

  container._fxUpdate = update;
  return update;
}

export function mountControls(container, profile, onToggle) {
  if (container.dataset.profileId === profile.id && container._ctlUpdate) {
    return container._ctlUpdate;
  }

  container.innerHTML = '';
  container.dataset.profileId = profile.id;

  if (!profile.controls || profile.controls.length === 0) {
    container.innerHTML = '<div class="no-controls">No toggle controls defined for this profile.</div>';
    container._ctlUpdate = () => {};
    return container._ctlUpdate;
  }

  const buttons = new Map();

  profile.controls.forEach((ctl) => {
    const btn = document.createElement('button');
    btn.className = 'control-toggle';
    btn.innerHTML = `
      <span class="control-label"></span>
      <span class="control-cc"></span>
      <span class="control-state">OFF</span>
    `;
    btn.querySelector('.control-label').textContent = ctl.label;
    btn.querySelector('.control-cc').textContent = `CC ${ctl.cc}`;
    btn.addEventListener('click', () => onToggle(ctl.id));
    container.appendChild(btn);
    buttons.set(ctl.id, btn);
  });

  const update = (states) => {
    for (const ctl of profile.controls) {
      const btn = buttons.get(ctl.id);
      if (!btn) continue;
      const on = !!states[ctl.id];
      btn.classList.toggle('active', on);
      btn.querySelector('.control-state').textContent = on ? 'ON' : 'OFF';
    }
  };

  container._ctlUpdate = update;
  return update;
}
