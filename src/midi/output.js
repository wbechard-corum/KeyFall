import { getOutputPort } from './connection.js';

const txListeners = new Set();

export function onTx(listener) {
  txListeners.add(listener);
  return () => txListeners.delete(listener);
}

export function send(data) {
  const port = getOutputPort();
  if (!port) return false;
  try {
    port.send(data);
    for (const fn of txListeners) fn(data);
    return true;
  } catch (e) {
    console.error('MIDI send error:', e);
    return false;
  }
}

export function sendNoteOn(channel, note, velocity = 100) {
  return send([0x90 | (channel & 0x0F), note & 0x7F, velocity & 0x7F]);
}

export function sendNoteOff(channel, note) {
  return send([0x80 | (channel & 0x0F), note & 0x7F, 0]);
}

export function sendCC(channel, cc, value) {
  return send([0xB0 | (channel & 0x0F), cc & 0x7F, value & 0x7F]);
}

export function sendProgramChange(channel, program) {
  return send([0xC0 | (channel & 0x0F), program & 0x7F]);
}

export function sendBankSelect(channel, msb, lsb) {
  send([0xB0 | (channel & 0x0F), 0x00, msb & 0x7F]);
  send([0xB0 | (channel & 0x0F), 0x20, lsb & 0x7F]);
}

export function sendPatchChange(channel, msb, lsb, program) {
  sendBankSelect(channel, msb, lsb);
  sendProgramChange(channel, program);
}

export function sendSysEx(bytes) {
  return send(bytes);
}
