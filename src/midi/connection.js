const listeners = new Set();

const state = {
  supported: typeof navigator !== 'undefined' && !!navigator.requestMIDIAccess,
  access: null,
  requested: false,
  sysexGranted: false,
  inputs: [],
  outputs: [],
  selectedInputId: null,
  selectedOutputId: null,
  error: null,
};

function emit() {
  const snapshot = getState();
  for (const fn of listeners) {
    try { fn(snapshot); } catch (e) { console.error('MIDI listener error:', e); }
  }
}

function refreshPortLists() {
  if (!state.access) {
    state.inputs = [];
    state.outputs = [];
    return;
  }
  state.inputs = Array.from(state.access.inputs.values()).map(p => ({
    id: p.id,
    name: p.name || 'Unknown Input',
    manufacturer: p.manufacturer || '',
    port: p,
  }));
  state.outputs = Array.from(state.access.outputs.values()).map(p => ({
    id: p.id,
    name: p.name || 'Unknown Output',
    manufacturer: p.manufacturer || '',
    port: p,
  }));

  // Drop a selection whose port has gone away. Without this, unplugging the
  // keyboard left selectedOutputId pointing at a dead id — getOutputPort()
  // returned null so nothing sent, and autoSelect() refused to pick the port
  // back up on replug because the id was still (stale but) truthy.
  if (state.selectedInputId && !state.inputs.some(p => p.id === state.selectedInputId)) {
    state.selectedInputId = null;
  }
  if (state.selectedOutputId && !state.outputs.some(p => p.id === state.selectedOutputId)) {
    state.selectedOutputId = null;
  }
}

export function getState() {
  return {
    supported: state.supported,
    requested: state.requested,
    sysexGranted: state.sysexGranted,
    error: state.error,
    inputs: state.inputs.map(({ port, ...rest }) => rest),
    outputs: state.outputs.map(({ port, ...rest }) => rest),
    selectedInputId: state.selectedInputId,
    selectedOutputId: state.selectedOutputId,
  };
}

export function onStateChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let pendingAccess = null;

export async function requestAccess({ sysex = true } = {}) {
  if (!state.supported) {
    state.error = 'Web MIDI is not supported in this browser. Use Chrome or Edge.';
    emit();
    return null;
  }

  if (state.access) return state.access;
  // boot() and the Settings "grant access" button can both land here before
  // the first request resolves. Share one in-flight promise so the browser
  // only ever sees a single permission request.
  if (pendingAccess) return pendingAccess;

  state.requested = true;
  pendingAccess = doRequestAccess(sysex);
  try {
    return await pendingAccess;
  } finally {
    pendingAccess = null;
  }
}

async function doRequestAccess(sysex) {
  try {
    state.access = await navigator.requestMIDIAccess({ sysex });
    state.sysexGranted = sysex;
    state.access.onstatechange = () => {
      refreshPortLists();
      emit();
    };
    refreshPortLists();
    state.error = null;
    emit();
    return state.access;
  } catch (e) {
    state.error = e?.message || 'MIDI access denied';
    state.access = null;
    state.sysexGranted = false;
    emit();
    return null;
  }
}

// Chrome WebMIDI ports start in connection="closed". Messages sent on a
// closed port do trigger an implicit open, but the first few sends during
// that transition can be silently dropped — which is why the app used to
// only work reliably after the user hit SEND IDENTITY REQUEST (that first
// sysex primed the port). Call .open() explicitly so every subsequent
// send lands cleanly.
function openPort(port) {
  if (!port || typeof port.open !== 'function') return Promise.resolve();
  if (port.connection === 'open') return Promise.resolve();
  return Promise.resolve(port.open()).catch((e) => {
    console.warn('MIDI port open failed:', e);
  });
}

export function selectInput(id) {
  state.selectedInputId = id;
  const port = getInputPort();
  if (port) openPort(port);
  emit();
  return port;
}

export function selectOutput(id) {
  state.selectedOutputId = id;
  const port = getOutputPort();
  if (port) openPort(port);
  emit();
  return port;
}

export function getInputPort() {
  if (!state.selectedInputId) return null;
  return state.inputs.find(p => p.id === state.selectedInputId)?.port ?? null;
}

export function getOutputPort() {
  if (!state.selectedOutputId) return null;
  return state.outputs.find(p => p.id === state.selectedOutputId)?.port ?? null;
}

export function autoSelect({ preferManufacturer } = {}) {
  if (!state.access) return;

  if (!state.selectedOutputId && state.outputs.length > 0) {
    const preferred = preferManufacturer
      ? state.outputs.find(o =>
          (o.name || '').toLowerCase().includes(preferManufacturer.toLowerCase()) ||
          (o.manufacturer || '').toLowerCase().includes(preferManufacturer.toLowerCase()))
      : null;
    selectOutput((preferred || state.outputs[0]).id);
  }

  if (!state.selectedInputId && state.inputs.length > 0) {
    const output = state.outputs.find(p => p.id === state.selectedOutputId);
    const matchingInput = output
      ? state.inputs.find(i => i.name === output.name)
      : null;
    selectInput((matchingInput || state.inputs[0]).id);
  }
}
