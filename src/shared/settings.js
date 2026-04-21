const KEY = 'keyfall.settings';

const DEFAULTS = {
  mode: 'trainer',
  midiChannel: 0,
  selectedDeviceId: null,
  selectedProfileId: null,
  theme: 'dark',
  trainerMidiOut: false,
};

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function write(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable (private mode, etc.) — ignore.
  }
}

let current = read();

export function getSettings() {
  return { ...current };
}

export function getSetting(key) {
  return current[key];
}

export function updateSettings(patch) {
  current = { ...current, ...patch };
  write(current);
  return { ...current };
}
