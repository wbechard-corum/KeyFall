import {
  sendCC,
  sendPatchChange,
  sendSysEx,
} from '../midi/output.js';
import { IDENTITY_REQUEST, buildSysEx, parseIdentityReply } from '../midi/sysex.js';
import { onSysEx } from '../midi/input.js';
import { getSetting, updateSettings } from '../shared/settings.js';
import { loadProfile, loadDefaultProfile, matchProfileFromIdentity } from './profile-loader.js';

export function createController() {
  const listeners = new Set();
  const state = {
    profile: loadDefaultProfile(),
    bankIndex: 0,
    patchIndex: 0,
    channel: getSetting('midiChannel') ?? 0,
    effectValues: {},
    controlStates: {},
    lastIdentity: null,
    lastMessage: 'READY',
  };

  // Mirror role. 'solo' (default) owns MIDI. 'host' owns MIDI and broadcasts
  // state snapshots to peers. 'client' sends intents to the host and never
  // touches the physical MIDI port.
  let mirrorRole = 'solo';
  let intentSender = null;

  hydrateDefaultsFromProfile();

  const initial = getSetting('selectedProfileId');
  if (initial && initial !== state.profile.id) {
    try {
      setProfile(initial);
    } catch (e) {
      console.warn(`Saved profile "${initial}" not found, falling back to default.`, e);
      updateSettings({ selectedProfileId: null });
    }
  }

  onSysEx((bytes) => {
    const reply = parseIdentityReply(bytes);
    if (!reply) return;
    state.lastIdentity = reply;
    const matched = matchProfileFromIdentity(reply);
    if (matched && matched.id !== state.profile.id) {
      setProfile(matched.id);
    }
    state.lastMessage = `FW: ${reply.version.map(b => b.toString(16).padStart(2, '0')).join(' ')}`;
    emit();
  });

  function hydrateDefaultsFromProfile() {
    state.effectValues = {};
    for (const fx of state.profile.effects) {
      state.effectValues[fx.id] = fx.default ?? 0;
    }
    state.controlStates = {};
    for (const ctl of state.profile.controls) {
      state.controlStates[ctl.id] = false;
    }
    state.bankIndex = 0;
    state.patchIndex = 0;
  }

  function emit() {
    for (const fn of listeners) fn(getSnapshot());
  }

  function getSnapshot() {
    return {
      profile: state.profile,
      bankIndex: state.bankIndex,
      patchIndex: state.patchIndex,
      channel: state.channel,
      effectValues: { ...state.effectValues },
      controlStates: { ...state.controlStates },
      lastMessage: state.lastMessage,
      lastIdentity: state.lastIdentity,
      mirrorRole,
    };
  }

  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  function asClient() { return mirrorRole === 'client'; }

  function setProfile(id) {
    state.profile = loadProfile(id);
    hydrateDefaultsFromProfile();
    updateSettings({ selectedProfileId: id });
    state.lastMessage = `PROFILE: ${state.profile.model}`;
    if (asClient()) intentSender?.('setProfile', { id });
    emit();
  }

  function setBank(idx) {
    state.bankIndex = idx;
    state.patchIndex = 0;
    if (asClient()) {
      intentSender?.('setBank', { bankIndex: idx });
    } else {
      sendSelectedPatch();
    }
    emit();
  }

  function setPatch(idx) {
    state.patchIndex = idx;
    if (asClient()) {
      intentSender?.('setPatch', { patchIndex: idx });
    } else {
      sendSelectedPatch();
    }
    emit();
  }

  function setChannel(ch) {
    state.channel = ch & 0x0F;
    updateSettings({ midiChannel: state.channel });
    if (asClient()) intentSender?.('setChannel', { channel: state.channel });
    emit();
  }

  function sendSelectedPatch() {
    const bank = state.profile.banks[state.bankIndex];
    if (!bank) return;
    sendPatchChange(state.channel, bank.msb, bank.lsb, state.patchIndex);
    state.lastMessage = `CC0:${bank.msb} CC32:${bank.lsb} PC:${state.patchIndex}`;
  }

  function setEffectValue(id, value) {
    const fx = state.profile.effects.find(f => f.id === id);
    if (!fx) return;
    const v = Math.max(fx.min ?? 0, Math.min(fx.max ?? 127, value | 0));
    state.effectValues[id] = v;
    if (asClient()) {
      intentSender?.('setEffectValue', { id, value: v });
    } else {
      sendCC(state.channel, fx.cc, v);
      state.lastMessage = `CC${fx.cc}:${v}`;
    }
    emit();
  }

  function toggleControl(id) {
    const ctl = state.profile.controls.find(c => c.id === id);
    if (!ctl) return;
    const next = !state.controlStates[id];
    state.controlStates[id] = next;
    const value = next ? (ctl.onValue ?? 127) : (ctl.offValue ?? 0);
    if (asClient()) {
      intentSender?.('toggleControl', { id });
    } else {
      sendCC(state.channel, ctl.cc, value);
      state.lastMessage = `CC${ctl.cc}:${value}`;
    }
    emit();
  }

  function sendIdentityRequest() {
    if (asClient()) {
      intentSender?.('sendIdentityRequest', {});
    } else {
      sendSysEx(IDENTITY_REQUEST);
      state.lastMessage = 'SYSEX: ID REQ';
    }
    emit();
  }

  function sendSysExCommand(commandId, data = []) {
    const sx = state.profile.sysex;
    if (!sx || !sx.commands || !sx.commands[commandId]) return;
    const cmd = sx.commands[commandId];
    if (asClient()) {
      intentSender?.('sendSysExCommand', { commandId, data });
    } else {
      const bytes = buildSysEx(sx.parameterFormat, {
        deviceId: sx.deviceId,
        modelId: sx.modelId,
        address: cmd.address,
        data,
      });
      sendSysEx(bytes);
      state.lastMessage = `SYSEX: ${commandId}`;
    }
    emit();
  }

  function setMirrorRole(role, sender = null) {
    mirrorRole = role;
    intentSender = sender;
    emit();
  }

  // Applied on the CLIENT when a state snapshot arrives from the host.
  // No MIDI is sent; no intent is re-emitted.
  function applyRemoteSnapshot(snap) {
    let changed = false;
    if (snap.profile?.id && snap.profile.id !== state.profile.id) {
      try {
        state.profile = loadProfile(snap.profile.id);
        hydrateDefaultsFromProfile();
        changed = true;
      } catch (e) {
        console.warn('Unknown profile from host:', snap.profile.id, e);
      }
    }
    if (typeof snap.bankIndex === 'number' && snap.bankIndex !== state.bankIndex) {
      state.bankIndex = snap.bankIndex;
      changed = true;
    }
    if (typeof snap.patchIndex === 'number' && snap.patchIndex !== state.patchIndex) {
      state.patchIndex = snap.patchIndex;
      changed = true;
    }
    if (typeof snap.channel === 'number' && snap.channel !== state.channel) {
      state.channel = snap.channel;
      changed = true;
    }
    if (snap.effectValues) { state.effectValues = { ...snap.effectValues }; changed = true; }
    if (snap.controlStates) { state.controlStates = { ...snap.controlStates }; changed = true; }
    if (typeof snap.lastMessage === 'string') state.lastMessage = snap.lastMessage;
    if (changed) emit();
  }

  // Applied on the HOST when an intent arrives from a client. Routes through
  // the normal setters so MIDI gets sent and subsequent state-sync broadcasts
  // fire through the existing emit() path.
  function applyRemoteIntent(action, payload = {}) {
    switch (action) {
      case 'setPatch':    return setPatch(payload.patchIndex ?? 0);
      case 'setBank':     return setBank(payload.bankIndex ?? 0);
      case 'setChannel':  return setChannel(payload.channel ?? 0);
      case 'setProfile':  try { setProfile(payload.id); } catch (e) { console.warn(e); } return;
      case 'setEffectValue': return setEffectValue(payload.id, payload.value);
      case 'toggleControl':  return toggleControl(payload.id);
      case 'sendIdentityRequest': return sendIdentityRequest();
      case 'sendSysExCommand':    return sendSysExCommand(payload.commandId, payload.data || []);
      default: console.warn('Unknown remote intent:', action, payload);
    }
  }

  return {
    onChange,
    getSnapshot,
    setProfile,
    setBank,
    setPatch,
    setChannel,
    setEffectValue,
    toggleControl,
    sendIdentityRequest,
    sendSysExCommand,
    setMirrorRole,
    applyRemoteSnapshot,
    applyRemoteIntent,
  };
}
