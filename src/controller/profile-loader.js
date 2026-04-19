import { identityMatches } from '../midi/sysex.js';
import { listProfiles, getProfile, getDefaultProfile } from '../profiles/index.js';

export function loadProfile(id) {
  const profile = getProfile(id);
  if (!profile) throw new Error(`Unknown profile: ${id}`);
  return normalizeProfile(profile);
}

export function loadDefaultProfile() {
  return normalizeProfile(getDefaultProfile());
}

export function availableProfiles() {
  return listProfiles().map(p => ({ id: p.id, manufacturer: p.manufacturer, model: p.model }));
}

export function matchProfileFromIdentity(reply) {
  if (!reply) return null;
  for (const profile of listProfiles()) {
    if (profile.identityResponse && identityMatches(reply, profile.identityResponse)) {
      return normalizeProfile(profile);
    }
  }
  return null;
}

function normalizeProfile(profile) {
  const banks = (profile.banks || []).map(bank => ({
    id: bank.id,
    label: bank.label || bank.id,
    msb: bank.msb ?? 0,
    lsb: bank.lsb ?? 0,
    patches: (bank.patches && bank.patches.length > 0)
      ? bank.patches
      : Array.from({ length: 128 }, (_, i) => `${bank.label || bank.id} Patch ${String(i + 1).padStart(3, '0')}`),
  }));

  return {
    id: profile.id,
    manufacturer: profile.manufacturer,
    model: profile.model,
    identityResponse: profile.identityResponse || null,
    banks,
    effects: profile.effects || [],
    controls: profile.controls || [],
    sysex: profile.sysex || null,
    notes: profile.notes || '',
  };
}
