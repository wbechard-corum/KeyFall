// Keyboard profile validation. Profiles are the project's extension point
// for non-programmers, so a bad one must produce a precise complaint rather
// than a runtime mystery.
import { check, finish } from './helpers.mjs';
import { validateProfile, assertValidProfile } from '../src/profiles/validate.js';
import junoG from '../src/profiles/roland-juno-g.json' with { type: 'json' };
import genericGM from '../src/profiles/generic-gm.json' with { type: 'json' };

// A minimal profile that passes, used as the base for negative cases.
const base = () => ({
  id: 'test-board',
  manufacturer: 'Test',
  model: 'Board',
  banks: [{ id: 'A', label: 'A', msb: 0, lsb: 0, patches: ['One', 'Two'] }],
});

const errPaths = (p) => validateProfile(p).errors.map(e => e.path);
const hasErrorAt = (p, path) => errPaths(p).some(x => x === path || x.startsWith(path));

// ── 1. The shipped profiles are valid ────────────────────────────────────
console.log('shipped profiles');
{
  for (const [name, profile] of [['roland-juno-g', junoG], ['generic-gm', genericGM]]) {
    const r = validateProfile(profile, { source: name });
    check(`${name} validates`, r.valid,
      r.errors.map(e => `${e.path}: ${e.message}`).join(' | '));
  }
}

// ── 2. Required identity fields ──────────────────────────────────────────
console.log('identity');
{
  check('missing id is rejected', hasErrorAt({ ...base(), id: undefined }, 'id'));
  check('empty manufacturer is rejected', hasErrorAt({ ...base(), manufacturer: '  ' }, 'manufacturer'));
  check('missing model is rejected', hasErrorAt({ ...base(), model: undefined }, 'model'));
  check('a non-slug id is rejected', hasErrorAt({ ...base(), id: 'Roland Juno G' }, 'id'));
  check('a proper slug passes', validateProfile({ ...base(), id: 'roland-juno-g' }).valid);
  check('a non-object is rejected', !validateProfile('nope').valid);
}

// ── 3. Banks ─────────────────────────────────────────────────────────────
console.log('banks');
{
  check('missing banks is rejected', hasErrorAt({ ...base(), banks: undefined }, 'banks'));
  check('empty banks is rejected', hasErrorAt({ ...base(), banks: [] }, 'banks'));
  check('out-of-range msb is rejected',
    hasErrorAt({ ...base(), banks: [{ id: 'A', msb: 200, lsb: 0, patches: [] }] }, 'banks[0].msb'));
  check('negative lsb is rejected',
    hasErrorAt({ ...base(), banks: [{ id: 'A', msb: 0, lsb: -1, patches: [] }] }, 'banks[0].lsb'));
  check('duplicate bank ids are rejected', hasErrorAt({
    ...base(),
    banks: [
      { id: 'A', msb: 0, lsb: 0, patches: [] },
      { id: 'A', msb: 0, lsb: 1, patches: [] },
    ],
  }, 'banks[1].id'));
  check('a missing msb only warns', (() => {
    const r = validateProfile({ ...base(), banks: [{ id: 'A', patches: ['x'] }] });
    return r.valid && r.warnings.some(w => w.path.includes('msb'));
  })());
}

// ── 4. Unreachable patches ───────────────────────────────────────────────
// This is the rule that matters: a bank may exceed 128 entries as a UI
// grouping, but only if the extras carry explicit lsb/pc.
console.log('patch addressing');
{
  const tooMany = {
    ...base(),
    banks: [{
      id: 'BIG', msb: 87, lsb: 0,
      patches: Array.from({ length: 200 }, (_, i) => `Patch ${i + 1}`),
    }],
  };
  const r = validateProfile(tooMany);
  check('a 200-patch bank of plain names is rejected', !r.valid);
  check('and the message names the unreachable patch',
    r.errors.some(e => /unreachable|outside 0-127/.test(e.message)),
    JSON.stringify(r.errors.slice(0, 2)));

  const properlySplit = {
    ...base(),
    banks: [{
      id: 'BIG', msb: 87, lsb: 0,
      patches: [
        ...Array.from({ length: 128 }, (_, i) => `Low ${i + 1}`),
        ...Array.from({ length: 72 }, (_, i) => ({ name: `High ${i + 1}`, lsb: 1, pc: i })),
      ],
    }],
  };
  check('the same bank with explicit lsb/pc passes',
    validateProfile(properlySplit).valid,
    JSON.stringify(validateProfile(properlySplit).errors.slice(0, 2)));

  const collide = {
    ...base(),
    banks: [{
      id: 'A', msb: 0, lsb: 0,
      patches: ['First', { name: 'Clash', pc: 0 }],
    }],
  };
  const c = validateProfile(collide);
  check('two patches at the same address are rejected', !c.valid);
  check('and the message says which pair collides',
    c.errors.some(e => /same MSB .* LSB .* PC/.test(e.message)),
    JSON.stringify(c.errors));
}

// ── 5. Effects and controls ──────────────────────────────────────────────
console.log('effects and controls');
{
  const withFx = (fx) => ({ ...base(), effects: [fx] });
  check('cc above 127 is rejected',
    hasErrorAt(withFx({ id: 'a', label: 'A', cc: 200 }), 'effects[0].cc'));
  check('missing cc is rejected',
    hasErrorAt(withFx({ id: 'a', label: 'A' }), 'effects[0].cc'));
  check('missing label is rejected',
    hasErrorAt(withFx({ id: 'a', cc: 7 }), 'effects[0].label'));
  check('min >= max is rejected',
    hasErrorAt(withFx({ id: 'a', label: 'A', cc: 7, min: 100, max: 50 }), 'effects[0]'));
  check('a default outside min/max is rejected',
    hasErrorAt(withFx({ id: 'a', label: 'A', cc: 7, min: 0, max: 50, default: 90 }),
      'effects[0].default'));
  check('a sane effect passes',
    validateProfile(withFx({ id: 'a', label: 'A', cc: 7, min: 0, max: 127, default: 100 })).valid);
  check('duplicate effect ids are rejected', hasErrorAt({
    ...base(),
    effects: [{ id: 'x', label: 'X', cc: 1 }, { id: 'x', label: 'Y', cc: 2 }],
  }, 'effects[1].id'));
  check('control onValue above 127 is rejected', hasErrorAt({
    ...base(),
    controls: [{ id: 's', label: 'Sustain', cc: 64, onValue: 200 }],
  }, 'controls[0].onValue'));
}

// ── 6. SysEx ─────────────────────────────────────────────────────────────
console.log('sysex');
{
  check('an unknown parameterFormat is rejected', hasErrorAt({
    ...base(), sysex: { parameterFormat: 'yamaha-xg' },
  }, 'sysex.parameterFormat'));
  check('roland-dt1 is accepted',
    validateProfile({ ...base(), sysex: { parameterFormat: 'roland-dt1' } }).valid);
  check('commands without a format are rejected', hasErrorAt({
    ...base(),
    sysex: { commands: { mfx: { address: [16, 0, 4, 0] } } },
  }, 'sysex.parameterFormat'));
  check('a non-7-bit sysex address is rejected', hasErrorAt({
    ...base(),
    sysex: { parameterFormat: 'roland-dt1', commands: { mfx: { address: [200] } } },
  }, 'sysex.commands.mfx.address'));
  check('a valid command passes', validateProfile({
    ...base(),
    sysex: {
      parameterFormat: 'roland-dt1', deviceId: 16, modelId: [0, 0, 0, 21],
      commands: { mfx: { address: [16, 0, 4, 0], size: 2 } },
    },
  }).valid);
}

// ── 7. assertValidProfile reports everything at once ─────────────────────
console.log('assertValidProfile');
{
  let message = '';
  try {
    assertValidProfile({ id: 'Bad Id', banks: [] }, 'broken.json');
  } catch (e) { message = e.message; }
  check('it throws for an invalid profile', message !== '');
  check('the source is named', message.includes('broken.json'), message);
  check('it lists more than one problem',
    message.split(';').length >= 3, message);

  let ok = true;
  try { assertValidProfile(base(), 'fine.json'); } catch { ok = false; }
  check('it accepts a valid profile', ok);
}

finish('profiles');
