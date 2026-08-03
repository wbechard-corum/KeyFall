import {
  sendCC,
  sendPatchChange,
  sendSysEx,
} from '../midi/output.js';
import { IDENTITY_REQUEST, buildSysEx, parseIdentityReply } from '../midi/sysex.js';
import { onSysEx } from '../midi/input.js';
import { getSetting, updateSettings, onSettingsChange } from '../shared/settings.js';
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

  // The profile and channel pickers live in the Settings tab, which only
  // wrote to storage. Nothing told the running controller, so switching
  // profiles there did nothing until a full page reload.
  onSettingsChange((_all, patch) => {
    if ('selectedProfileId' in patch && patch.selectedProfileId
        && patch.selectedProfileId !== state.profile.id) {
      try {
        setProfile(patch.selectedProfileId);
      } catch (e) {
        console.warn(`Cannot switch to profile "${patch.selectedProfileId}":`, e);
      }
    }
    if ('midiChannel' in patch) {
      const ch = Number(patch.midiChannel) & 0x0F;
      if (ch !== state.channel) { state.channel = ch; emit(); }
    }
  });

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
    };
  }

  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  function setProfile(id) {
    state.profile = loadProfile(id);
    hydrateDefaultsFromProfile();
    updateSettings({ selectedProfileId: id });
    state.lastMessage = `PROFILE: ${state.profile.model}`;
    emit();
  }

  function setBank(idx) {
    state.bankIndex = idx;
    state.patchIndex = 0;
    sendSelectedPatch();
    emit();
  }

  function setPatch(idx) {
    state.patchIndex = idx;
    sendSelectedPatch();
    emit();
  }

  function setChannel(ch) {
    state.channel = ch & 0x0F;
    updateSettings({ midiChannel: state.channel });
    emit();
  }

  function sendSelectedPatch() {
    const bank = state.profile.banks[state.bankIndex];
    if (!bank) return;
    const patch = bank.patches[state.patchIndex];
    if (!patch) return;
    sendPatchChange(state.channel, patch.msb, patch.lsb, patch.pc);
    state.lastMessage = `CC0:${patch.msb} CC32:${patch.lsb} PC:${patch.pc}`;
  }

  function setEffectValue(id, value) {
    const fx = state.profile.effects.find(f => f.id === id);
    if (!fx) return;
    const v = Math.max(fx.min ?? 0, Math.min(fx.max ?? 127, value | 0));
    state.effectValues[id] = v;
    sendCC(state.channel, fx.cc, v);
    state.lastMessage = `CC${fx.cc}:${v}`;
    emit();
  }

  function toggleControl(id) {
    const ctl = state.profile.controls.find(c => c.id === id);
    if (!ctl) return;
    const next = !state.controlStates[id];
    state.controlStates[id] = next;
    const value = next ? (ctl.onValue ?? 127) : (ctl.offValue ?? 0);
    sendCC(state.channel, ctl.cc, value);
    state.lastMessage = `CC${ctl.cc}:${value}`;
    emit();
  }

  function sendIdentityRequest() {
    sendSysEx(IDENTITY_REQUEST);
    state.lastMessage = 'SYSEX: ID REQ';
    emit();
  }

  function sendSysExCommand(commandId, data = []) {
    const sx = state.profile.sysex;
    if (!sx || !sx.commands || !sx.commands[commandId]) return;
    const cmd = sx.commands[commandId];
    const bytes = buildSysEx(sx.parameterFormat, {
      deviceId: sx.deviceId,
      modelId: sx.modelId,
      address: cmd.address,
      data,
    });
    sendSysEx(bytes);
    state.lastMessage = `SYSEX: ${commandId}`;
    emit();
  }

  function handleMirrorCommand(cmd) {
    if (!cmd || typeof cmd.action !== 'string') return;
    const { action, args = [] } = cmd;
    switch (action) {
      case 'setProfile':   return setProfile(...args);
      case 'setBank':      return setBank(...args);
      case 'setPatch':     return setPatch(...args);
      case 'setChannel':   return setChannel(...args);
      case 'setEffectValue': return setEffectValue(...args);
      case 'toggleControl':  return toggleControl(...args);
      case 'sendIdentityRequest': return sendIdentityRequest();
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
    handleMirrorCommand,
  };
}
