const FX_COLORS = ['#4FC3F7', '#81C784', '#FFB74D', '#E57373', '#B39DDB', '#FFB3A7', '#A5D6A7', '#9FA8DA', '#CE93D8'];

export function renderEffects(container, profile, values, onChange) {
  container.innerHTML = '';
  profile.effects.forEach((fx, idx) => {
    const color = FX_COLORS[idx % FX_COLORS.length];
    const value = values[fx.id] ?? fx.default ?? 0;
    const pct = ((value - (fx.min ?? 0)) / ((fx.max ?? 127) - (fx.min ?? 0))) * 100;

    const slider = document.createElement('div');
    slider.className = 'fx-slider';
    slider.innerHTML = `
      <div class="fx-label" style="color:${color}">${fx.label}</div>
      <div class="fx-track" data-fx="${fx.id}">
        <div class="fx-fill" style="height:${pct}%;background:linear-gradient(to top,${color}22,${color}66)"></div>
        <div class="fx-thumb" style="bottom:${pct}%;background:${color}"></div>
      </div>
      <div class="fx-value" data-role="fx-val">${value}</div>
      <div class="fx-cc">CC ${fx.cc}</div>
    `;
    container.appendChild(slider);

    const track = slider.querySelector('.fx-track');
    const fill = slider.querySelector('.fx-fill');
    const thumb = slider.querySelector('.fx-thumb');
    const valLabel = slider.querySelector('[data-role="fx-val"]');

    const min = fx.min ?? 0;
    const max = fx.max ?? 127;

    function updateFromY(clientY) {
      const rect = track.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height));
      const val = Math.round(min + ratio * (max - min));
      const pct2 = ratio * 100;
      fill.style.height = `${pct2}%`;
      thumb.style.bottom = `${pct2}%`;
      valLabel.textContent = val;
      onChange(fx.id, val);
    }

    track.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      track.setPointerCapture(e.pointerId);
      updateFromY(e.clientY);

      const move = (ev) => { ev.preventDefault(); updateFromY(ev.clientY); };
      const up = () => {
        track.removeEventListener('pointermove', move);
        track.removeEventListener('pointerup', up);
      };
      track.addEventListener('pointermove', move);
      track.addEventListener('pointerup', up);
    });
  });
}

export function renderControls(container, profile, states, onToggle) {
  container.innerHTML = '';
  if (!profile.controls || profile.controls.length === 0) {
    container.innerHTML = '<div class="no-controls">No toggle controls defined for this profile.</div>';
    return;
  }

  profile.controls.forEach((ctl) => {
    const on = !!states[ctl.id];
    const btn = document.createElement('button');
    btn.className = 'control-toggle' + (on ? ' active' : '');
    btn.innerHTML = `
      <span class="control-label">${ctl.label}</span>
      <span class="control-cc">CC ${ctl.cc}</span>
      <span class="control-state">${on ? 'ON' : 'OFF'}</span>
    `;
    btn.addEventListener('click', () => onToggle(ctl.id));
    container.appendChild(btn);
  });
}
