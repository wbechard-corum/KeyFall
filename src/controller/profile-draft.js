import { validateProfile } from '../profiles/validate.js';

// A profile under construction.
//
// The hard part of adding a keyboard isn't the JSON — it's knowing what the
// bank numbers are and what lives in each slot, which normally means owning
// the instrument or finding its MIDI implementation chart. This turns the
// keyboard itself into the source: step through Bank Select + Program Change
// combinations, read the name off the instrument's own display, type it in.
//
// Kept free of DOM so the model can be tested and reused.

const STORAGE_KEY = 'keyfall.profileDraft';

export function emptyDraft() {
  return {
    id: '',
    manufacturer: '',
    model: '',
    identityResponse: null,
    banks: [],
    effects: [],
    controls: [],
    notes: '',
    // Where the scanner is: which bank, and which program within it.
    cursor: { bankIndex: 0, pc: 0 },
  };
}

// Turn a model name into a plausible slug so the user doesn't have to think
// about it: "JUNO-DS 61" under "Roland" -> "roland-juno-ds-61".
export function suggestId(manufacturer, model) {
  return [manufacturer, model]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function createDraft(initial) {
  let draft = normalise(initial) ?? emptyDraft();
  const listeners = new Set();

  function emit() {
    save();
    for (const fn of listeners) { try { fn(draft); } catch { /* listener's problem */ } }
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(draft)); }
    catch { /* storage unavailable — the draft just isn't kept */ }
  }

  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  function get() { return draft; }

  function setIdentity(patch) {
    draft = { ...draft, ...patch };
    // Only auto-fill the slug while the user hasn't typed one of their own.
    if (!draft.__idEdited && (patch.manufacturer !== undefined || patch.model !== undefined)) {
      draft.id = suggestId(draft.manufacturer, draft.model);
    }
    emit();
  }

  function setId(id) {
    draft.id = id;
    draft.__idEdited = true;
    emit();
  }

  function setIdentityResponse(reply) {
    draft.identityResponse = reply ? {
      manufacturerId: `0x${reply.manufacturerId.toString(16).padStart(2, '0')}`,
      familyCode: [...reply.familyCode],
      modelNumber: [...reply.modelNumber],
    } : null;
    // A reply is also the best guess at the manufacturer we have.
    if (reply?.manufacturerName && !draft.manufacturer) {
      setIdentity({ manufacturer: reply.manufacturerName });
      return;
    }
    emit();
  }

  function addBank({ id, label, msb, lsb } = {}) {
    const n = draft.banks.length + 1;
    draft.banks.push({
      id: id || `BANK-${n}`,
      label: label || id || `Bank ${n}`,
      msb: Number.isInteger(msb) ? msb : 0,
      lsb: Number.isInteger(lsb) ? lsb : 0,
      patches: [],
    });
    draft.cursor = { bankIndex: draft.banks.length - 1, pc: 0 };
    emit();
    return draft.banks.length - 1;
  }

  function updateBank(index, patch) {
    const bank = draft.banks[index];
    if (!bank) return;
    Object.assign(bank, patch);
    emit();
  }

  function removeBank(index) {
    if (!draft.banks[index]) return;
    draft.banks.splice(index, 1);
    const bankIndex = Math.max(0, Math.min(draft.cursor.bankIndex, draft.banks.length - 1));
    draft.cursor = { bankIndex, pc: 0 };
    emit();
  }

  function selectBank(index) {
    if (!draft.banks[index]) return;
    draft.cursor = { bankIndex: index, pc: 0 };
    emit();
  }

  function setCursor(pc) {
    draft.cursor.pc = Math.max(0, Math.min(127, Math.round(pc) || 0));
    emit();
  }

  function currentBank() { return draft.banks[draft.cursor.bankIndex] ?? null; }

  // Record the name for the slot the scanner is on. An empty name clears it,
  // which is how you mark a slot the instrument leaves blank.
  function nameCurrent(name) {
    const bank = currentBank();
    if (!bank) return;
    const pc = draft.cursor.pc;
    // Patches are stored densely by index, so pad up to the slot.
    while (bank.patches.length <= pc) bank.patches.push('');
    bank.patches[pc] = String(name ?? '').trim();
    emit();
  }

  function advance(step = 1) {
    setCursor(draft.cursor.pc + step);
  }

  function namedCount(bank = currentBank()) {
    if (!bank) return 0;
    return bank.patches.filter(p => typeof p === 'string' && p.trim() !== '').length;
  }

  function reset() {
    draft = emptyDraft();
    emit();
  }

  function load(next) {
    const n = normalise(next);
    if (!n) return false;
    draft = n;
    emit();
    return true;
  }

  return {
    get, onChange, save, reset, load,
    setIdentity, setId, setIdentityResponse,
    addBank, updateBank, removeBank, selectBank,
    setCursor, advance, nameCurrent, currentBank, namedCount,
    toProfile: () => toProfile(draft),
    validate: () => validateProfile(toProfile(draft), { source: draft.id || 'draft' }),
  };
}

export function loadStoredDraft() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalise(JSON.parse(raw)) : null;
  } catch { return null; }
}

function normalise(d) {
  if (!d || typeof d !== 'object') return null;
  const banks = Array.isArray(d.banks) ? d.banks.map(b => ({
    id: String(b?.id ?? ''),
    label: String(b?.label ?? b?.id ?? ''),
    msb: Number.isInteger(b?.msb) ? b.msb : 0,
    lsb: Number.isInteger(b?.lsb) ? b.lsb : 0,
    patches: Array.isArray(b?.patches) ? b.patches.map(p => (typeof p === 'string' ? p : '')) : [],
  })) : [];
  return {
    ...emptyDraft(),
    id: String(d.id ?? ''),
    manufacturer: String(d.manufacturer ?? ''),
    model: String(d.model ?? ''),
    identityResponse: d.identityResponse ?? null,
    banks,
    effects: Array.isArray(d.effects) ? d.effects : [],
    controls: Array.isArray(d.controls) ? d.controls : [],
    notes: String(d.notes ?? ''),
    __idEdited: !!d.__idEdited,
    cursor: {
      bankIndex: Number.isInteger(d.cursor?.bankIndex) ? d.cursor.bankIndex : 0,
      pc: Number.isInteger(d.cursor?.pc) ? d.cursor.pc : 0,
    },
  };
}

// Produce the profile JSON. Trailing unnamed slots are dropped — a bank
// scanned only as far as PC 40 should declare 41 patches, not 128 mostly
// empty strings. Gaps in the middle are kept, since a blank slot between two
// named ones is real information about the instrument.
export function toProfile(draft) {
  const banks = draft.banks.map(bank => {
    const patches = [...bank.patches];
    while (patches.length > 0 && patches[patches.length - 1].trim() === '') patches.pop();
    return {
      id: bank.id,
      label: bank.label || bank.id,
      msb: bank.msb,
      lsb: bank.lsb,
      patches: patches.map((p, i) => (p.trim() === '' ? `${bank.label || bank.id} ${i + 1}` : p)),
    };
  }).filter(b => b.patches.length > 0);

  const profile = {
    id: draft.id,
    manufacturer: draft.manufacturer,
    model: draft.model,
    banks,
  };
  if (draft.identityResponse) profile.identityResponse = draft.identityResponse;
  if (draft.effects?.length) profile.effects = draft.effects;
  if (draft.controls?.length) profile.controls = draft.controls;
  if (draft.notes?.trim()) profile.notes = draft.notes.trim();
  return profile;
}
