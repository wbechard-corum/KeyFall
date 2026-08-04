import { identityMatches } from '../midi/sysex.js';
import { listProfiles, getProfile, getDefaultProfile } from '../profiles/index.js';
import { validateProfile, assertValidProfile } from '../profiles/validate.js';

export function loadProfile(id) {
  const profile = getProfile(id);
  if (!profile) throw new Error(`Unknown profile: ${id}`);
  assertValidProfile(profile, id);
  return normalizeProfile(profile);
}

export function loadDefaultProfile() {
  const profile = getDefaultProfile();
  assertValidProfile(profile, profile?.id ?? 'default');
  return normalizeProfile(profile);
}

// Validate every registered profile. Called at boot so a broken contributed
// profile is reported in the console rather than blowing up whenever someone
// happens to select it.
export function validateAllProfiles() {
  return listProfiles().map(p => validateProfile(p, { source: p?.id ?? 'unknown' }));
}

export function availableProfiles() {
  return listProfiles().map(p => ({ id: p.id, manufacturer: p.manufacturer, model: p.model }));
}

export function matchProfileFromIdentity(reply) {
  if (!reply) return null;
  for (const profile of listProfiles()) {
    if (profile.identityResponse && identityMatches(reply, profile.identityResponse)) {
      // An invalid profile shouldn't be force-selected by auto-detect; log
      // and keep looking rather than throwing inside a MIDI callback.
      const check = validateProfile(profile, { source: profile.id });
      if (!check.valid) {
        console.warn(`Auto-detected profile "${profile.id}" is invalid; ignoring.`, check.errors);
        continue;
      }
      return normalizeProfile(profile);
    }
  }
  return null;
}

function normalizeProfile(profile) {
  const banks = (profile.banks || []).map(bank => {
    const count = bank.patchCount ?? 128;
    const rawPatches = bank.patches && bank.patches.length > 0
      ? bank.patches
      : Array.from({ length: count }, (_, i) => `${bank.label || bank.id} Patch ${String(i + 1).padStart(3, '0')}`);
    const patches = rawPatches.map((p, i) => normalizePatch(p, i, bank));
    return {
      id: bank.id,
      label: bank.label || bank.id,
      msb: bank.msb ?? 0,
      lsb: bank.lsb ?? 0,
      patches,
    };
  });

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

function normalizePatch(patch, index, bank) {
  if (typeof patch === 'string') {
    return { name: patch, msb: bank.msb ?? 0, lsb: bank.lsb ?? 0, pc: index & 0x7F };
  }
  return {
    name: patch.name ?? `Patch ${index + 1}`,
    msb: patch.msb ?? bank.msb ?? 0,
    lsb: patch.lsb ?? bank.lsb ?? 0,
    pc: (patch.pc ?? index) & 0x7F,
  };
}
