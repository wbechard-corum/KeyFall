// Validation for keyboard profile JSON.
//
// Profiles are the project's extension point: adding a keyboard is meant to
// be a data change, contributed by someone who doesn't write JavaScript. That
// only works if a malformed profile produces a precise complaint instead of
// a mystery — a CC of 200 silently masked to 72 by `& 0x7F`, or a missing
// `banks` array turning into "cannot read properties of undefined".
//
// Deliberately dependency-free (no JSON Schema library) so it can run in the
// browser at load time, in the test suite, and in the CLI unchanged.

const SYSEX_FORMATS = ['roland-dt1'];

// Mirrors src/midi/sysex.js. Duplicated rather than imported so this module
// stays dependency-free and usable from the CLI and CI without pulling in the
// WebMIDI layer.
function encodingName(size, explicit) {
  if (explicit === 'byte' || explicit === 'nibble') return explicit;
  return size > 1 ? 'nibble' : 'byte';
}
function maxValueForSize(size, explicit) {
  const n = Math.max(1, Math.min(8, size | 0));
  return encodingName(n, explicit) === 'nibble' ? Math.pow(16, n) - 1 : 127;
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isInt = (v) => Number.isInteger(v);
const inRange = (v, lo, hi) => isInt(v) && v >= lo && v <= hi;

// Accepts 87, "0x57", or [0x0f, 0x02] depending on `len`.
function parseHexish(value, len) {
  if (Array.isArray(value)) {
    return value.length === len && value.every(b => inRange(b, 0, 255)) ? value : null;
  }
  if (typeof value === 'number') return isInt(value) && value >= 0 ? value : null;
  if (typeof value === 'string') {
    return /^(0x)?[0-9a-f]+$/i.test(value.trim()) ? value : null;
  }
  return null;
}

export function validateProfile(profile, { source = 'profile' } = {}) {
  const errors = [];
  const warnings = [];
  const err = (path, msg) => errors.push({ path, message: msg });
  const warn = (path, msg) => warnings.push({ path, message: msg });

  if (!isObject(profile)) {
    return { valid: false, errors: [{ path: '', message: 'profile must be a JSON object' }], warnings, source };
  }

  // ── Identity ───────────────────────────────────────────────────────────
  for (const key of ['id', 'manufacturer', 'model']) {
    if (typeof profile[key] !== 'string' || profile[key].trim() === '') {
      err(key, `${key} is required and must be a non-empty string`);
    }
  }
  if (typeof profile.id === 'string' && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(profile.id)) {
    err('id', `id must be a lowercase slug like "roland-juno-g" (got ${JSON.stringify(profile.id)})`);
  }

  if (profile.identityResponse !== undefined) {
    const ir = profile.identityResponse;
    if (!isObject(ir)) {
      err('identityResponse', 'identityResponse must be an object');
    } else {
      if (ir.manufacturerId !== undefined && parseHexish(ir.manufacturerId, 1) === null) {
        err('identityResponse.manufacturerId', 'must be a number or hex string, e.g. 65 or "0x41"');
      }
      for (const [key, len] of [['familyCode', 2], ['modelNumber', 2]]) {
        if (ir[key] !== undefined && parseHexish(ir[key], len) === null) {
          err(`identityResponse.${key}`, `must be a hex string like "0x0f02" or a ${len}-byte array`);
        }
      }
      if (ir.manufacturerId === undefined) {
        warn('identityResponse', 'without manufacturerId this profile can never auto-detect');
      }
    }
  }

  // ── Banks ──────────────────────────────────────────────────────────────
  if (!Array.isArray(profile.banks)) {
    err('banks', 'banks is required and must be an array');
  } else if (profile.banks.length === 0) {
    err('banks', 'at least one bank is required');
  } else {
    const seen = new Set();
    profile.banks.forEach((bank, i) => {
      const at = `banks[${i}]`;
      if (!isObject(bank)) { err(at, 'each bank must be an object'); return; }
      if (typeof bank.id !== 'string' || bank.id.trim() === '') {
        err(`${at}.id`, 'bank id is required and must be a non-empty string');
      } else if (seen.has(bank.id)) {
        err(`${at}.id`, `duplicate bank id ${JSON.stringify(bank.id)}`);
      } else {
        seen.add(bank.id);
      }
      for (const key of ['msb', 'lsb']) {
        if (bank[key] === undefined) {
          warn(`${at}.${key}`, `${key} defaults to 0; set it explicitly if the keyboard needs it`);
        } else if (!inRange(bank[key], 0, 127)) {
          err(`${at}.${key}`, `${key} must be an integer 0-127 (got ${JSON.stringify(bank[key])})`);
        }
      }
      if (bank.patchCount !== undefined && !inRange(bank.patchCount, 1, 1024)) {
        err(`${at}.patchCount`, `patchCount must be an integer 1-1024 (got ${JSON.stringify(bank.patchCount)})`);
      }
      if (bank.patches !== undefined) {
        if (!Array.isArray(bank.patches)) {
          err(`${at}.patches`, 'patches must be an array of names or patch objects');
        } else {
          // A bank may hold more than 128 patches as a UI grouping, so long
          // as the extras carry explicit lsb/pc. What actually matters is
          // that every patch resolves to a distinct Bank Select + Program
          // Change: a repeat is a patch the user can select but never reach,
          // because it just re-sends an earlier patch's address.
          const addresses = new Map();
          bank.patches.forEach((patch, pi) => {
            const pAt = `${at}.patches[${pi}]`;
            let msb = bank.msb ?? 0;
            let lsb = bank.lsb ?? 0;
            let pc = pi;

            if (typeof patch !== 'string') {
              if (!isObject(patch)) {
                err(pAt, 'each patch must be a name string or an object');
                return;
              }
              if (patch.name !== undefined && typeof patch.name !== 'string') {
                err(`${pAt}.name`, 'patch name must be a string');
              }
              for (const key of ['msb', 'lsb', 'pc']) {
                if (patch[key] !== undefined && !inRange(patch[key], 0, 127)) {
                  err(`${pAt}.${key}`, `${key} must be an integer 0-127 (got ${JSON.stringify(patch[key])})`);
                }
              }
              msb = patch.msb ?? msb;
              lsb = patch.lsb ?? lsb;
              pc = patch.pc ?? pi;
            }

            if (!inRange(pc, 0, 127)) {
              err(`${pAt}`, `resolves to Program Change ${pc}, which is outside 0-127. ` +
                `Patch ${pi + 1} of this bank needs an explicit "pc" (and usually "lsb"), ` +
                'otherwise it is unreachable.');
              return;
            }

            const key = `${msb}/${lsb}/${pc}`;
            if (addresses.has(key)) {
              err(`${pAt}`, `sends the same MSB ${msb} / LSB ${lsb} / PC ${pc} as ` +
                `patch ${addresses.get(key) + 1} — one of them can never be selected`);
            } else {
              addresses.set(key, pi);
            }
          });
        }
      }
    });
  }

  // ── Effects and toggle controls ────────────────────────────────────────
  validateCcList(profile.effects, 'effects', { isEffect: true });
  validateCcList(profile.controls, 'controls', { isEffect: false });

  function validateCcList(list, name, { isEffect }) {
    if (list === undefined) return;
    if (!Array.isArray(list)) { err(name, `${name} must be an array`); return; }
    const seen = new Set();
    list.forEach((item, i) => {
      const at = `${name}[${i}]`;
      if (!isObject(item)) { err(at, `each entry in ${name} must be an object`); return; }
      if (typeof item.id !== 'string' || item.id.trim() === '') {
        err(`${at}.id`, 'id is required and must be a non-empty string');
      } else if (seen.has(item.id)) {
        err(`${at}.id`, `duplicate id ${JSON.stringify(item.id)} within ${name}`);
      } else {
        seen.add(item.id);
      }
      if (typeof item.label !== 'string' || item.label.trim() === '') {
        err(`${at}.label`, 'label is required and must be a non-empty string');
      }
      if (!inRange(item.cc, 0, 127)) {
        err(`${at}.cc`, `cc must be an integer 0-127 (got ${JSON.stringify(item.cc)})`);
      }
      if (isEffect) {
        const min = item.min ?? 0;
        const max = item.max ?? 127;
        if (!inRange(min, 0, 127)) err(`${at}.min`, `min must be an integer 0-127 (got ${JSON.stringify(item.min)})`);
        if (!inRange(max, 0, 127)) err(`${at}.max`, `max must be an integer 0-127 (got ${JSON.stringify(item.max)})`);
        if (inRange(min, 0, 127) && inRange(max, 0, 127) && min >= max) {
          err(`${at}`, `min (${min}) must be less than max (${max})`);
        }
        if (item.default !== undefined) {
          if (!inRange(item.default, 0, 127)) {
            err(`${at}.default`, `default must be an integer 0-127 (got ${JSON.stringify(item.default)})`);
          } else if (item.default < min || item.default > max) {
            err(`${at}.default`, `default ${item.default} is outside this effect's range ${min}-${max}`);
          }
        }
      } else {
        for (const key of ['onValue', 'offValue']) {
          if (item[key] !== undefined && !inRange(item[key], 0, 127)) {
            err(`${at}.${key}`, `${key} must be an integer 0-127 (got ${JSON.stringify(item[key])})`);
          }
        }
      }
    });
  }

  // ── SysEx ──────────────────────────────────────────────────────────────
  if (profile.sysex !== undefined) {
    const sx = profile.sysex;
    if (!isObject(sx)) {
      err('sysex', 'sysex must be an object');
    } else {
      if (sx.parameterFormat !== undefined && !SYSEX_FORMATS.includes(sx.parameterFormat)) {
        err('sysex.parameterFormat',
          `unknown format ${JSON.stringify(sx.parameterFormat)}; supported: ${SYSEX_FORMATS.join(', ')}`);
      }
      if (sx.deviceId !== undefined && !inRange(sx.deviceId, 0, 127)) {
        err('sysex.deviceId', `deviceId must be an integer 0-127 (got ${JSON.stringify(sx.deviceId)})`);
      }
      for (const key of ['identityRequest', 'modelId']) {
        if (sx[key] === undefined) continue;
        if (!Array.isArray(sx[key]) || !sx[key].every(b => inRange(b, 0, 255))) {
          err(`sysex.${key}`, `${key} must be an array of byte values 0-255`);
        }
      }
      if (sx.commands !== undefined) {
        if (!isObject(sx.commands)) {
          err('sysex.commands', 'commands must be an object keyed by command name');
        } else {
          if (Object.keys(sx.commands).length > 0 && sx.parameterFormat === undefined) {
            err('sysex.parameterFormat',
              'parameterFormat is required when sysex.commands are defined');
          }
          for (const [name, cmd] of Object.entries(sx.commands)) {
            const at = `sysex.commands.${name}`;
            if (!isObject(cmd)) { err(at, 'each command must be an object'); continue; }
            if (!Array.isArray(cmd.address) || cmd.address.length === 0
                || !cmd.address.every(b => inRange(b, 0, 127))) {
              err(`${at}.address`, 'address must be a non-empty array of 7-bit values 0-127');
            }
            if (cmd.size !== undefined && !inRange(cmd.size, 1, 8)) {
              err(`${at}.size`, `size must be an integer 1-8 — the number of SysEx data ` +
                `bytes the parameter occupies (got ${JSON.stringify(cmd.size)})`);
            }
            if (cmd.encoding !== undefined && !['nibble', 'byte'].includes(cmd.encoding)) {
              err(`${at}.encoding`, `encoding must be "nibble" or "byte" (got ${JSON.stringify(cmd.encoding)})`);
            }
            if (cmd.label !== undefined && typeof cmd.label !== 'string') {
              err(`${at}.label`, 'label must be a string');
            }

            // Editor metadata. All optional — without it the editor falls
            // back to the full range the size allows.
            const size = cmd.size ?? 1;
            const ceiling = maxValueForSize(size, cmd.encoding);
            for (const key of ['min', 'max', 'default']) {
              if (cmd[key] === undefined) continue;
              if (!isInt(cmd[key]) || cmd[key] < 0 || cmd[key] > ceiling) {
                err(`${at}.${key}`, `${key} must be an integer 0-${ceiling} for a ` +
                  `size-${size} ${encodingName(size, cmd.encoding)} parameter ` +
                  `(got ${JSON.stringify(cmd[key])})`);
              }
            }
            const lo = cmd.min ?? 0;
            const hi = cmd.max ?? ceiling;
            if (isInt(cmd.min) && isInt(cmd.max) && cmd.min >= cmd.max) {
              err(at, `min (${cmd.min}) must be less than max (${cmd.max})`);
            }
            if (isInt(cmd.default) && (cmd.default < lo || cmd.default > hi)) {
              err(`${at}.default`, `default ${cmd.default} is outside this parameter's range ${lo}-${hi}`);
            }
            if (cmd.values !== undefined) {
              if (!isObject(cmd.values) && !Array.isArray(cmd.values)) {
                err(`${at}.values`, 'values must be an array of labels or an object keyed by value');
              } else {
                const pairs = Array.isArray(cmd.values)
                  ? cmd.values.map((label, i) => [i, label])
                  : Object.entries(cmd.values).map(([k, label]) => [Number(k), label]);
                for (const [num, label] of pairs) {
                  if (!Number.isInteger(num) || num < 0 || num > ceiling) {
                    err(`${at}.values`, `value key ${JSON.stringify(num)} is outside 0-${ceiling}`);
                  }
                  if (typeof label !== 'string' || label.trim() === '') {
                    err(`${at}.values`, `value ${num} needs a non-empty label`);
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  if (profile.notes !== undefined && typeof profile.notes !== 'string') {
    err('notes', 'notes must be a string');
  }

  return { valid: errors.length === 0, errors, warnings, source };
}

export function formatValidationResult(result) {
  const lines = [];
  for (const e of result.errors) {
    lines.push(`  error  ${e.path ? e.path + ': ' : ''}${e.message}`);
  }
  for (const w of result.warnings) {
    lines.push(`  warn   ${w.path ? w.path + ': ' : ''}${w.message}`);
  }
  return lines.join('\n');
}

// Throwing form used by the loader, so a bad profile fails loudly at the
// point of use with everything that's wrong, not just the first problem.
export function assertValidProfile(profile, source) {
  const result = validateProfile(profile, { source });
  if (!result.valid) {
    const detail = result.errors.map(e => `${e.path ? e.path + ': ' : ''}${e.message}`).join('; ');
    throw new Error(`Invalid keyboard profile (${source || profile?.id || 'unknown'}): ${detail}`);
  }
  return result;
}
