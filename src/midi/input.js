import { getInputPort, onStateChange, getState } from './connection.js';

const noteListeners = new Set();
const ccListeners = new Set();
const sysexListeners = new Set();

let attachedPort = null;

function handleMessage(msg) {
  const data = msg.data;
  if (!data || data.length === 0) return;

  const status = data[0];

  if (status === 0xF0) {
    for (const fn of sysexListeners) fn(data);
    return;
  }

  const cmd = status & 0xF0;
  const channel = status & 0x0F;

  if (cmd === 0x90 && data[2] > 0) {
    for (const fn of noteListeners) fn({ type: 'on', note: data[1], velocity: data[2], channel });
  } else if (cmd === 0x80 || (cmd === 0x90 && data[2] === 0)) {
    for (const fn of noteListeners) fn({ type: 'off', note: data[1], velocity: data[2], channel });
  } else if (cmd === 0xB0) {
    for (const fn of ccListeners) fn({ cc: data[1], value: data[2], channel });
  }
}

function reattach() {
  const port = getInputPort();
  if (port === attachedPort) return;
  if (attachedPort) attachedPort.onmidimessage = null;
  attachedPort = port;
  if (attachedPort) attachedPort.onmidimessage = handleMessage;
}

onStateChange(() => reattach());

export function onNote(listener) {
  noteListeners.add(listener);
  reattach();
  return () => noteListeners.delete(listener);
}

export function onCC(listener) {
  ccListeners.add(listener);
  reattach();
  return () => ccListeners.delete(listener);
}

export function onSysEx(listener) {
  sysexListeners.add(listener);
  reattach();
  return () => sysexListeners.delete(listener);
}

export function isConnected() {
  return !!getState().selectedInputId;
}
