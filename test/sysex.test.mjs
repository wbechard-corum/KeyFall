// Roland DT1 message construction and the SysEx parameter editor. These
// bytes go to real hardware, so the encoding is worth pinning down precisely.
import { check, finish, note, repoRoot, sleep,
         loadPlaywrightOptional, chromiumExecutable, waitForHttp } from './helpers.mjs';
import { spawn } from 'node:child_process';
import {
  buildRolandDT1, rolandChecksum, buildSysEx,
  encodeRolandValue, maxValueFor, encodingForSize, formatHex,
} from '../src/midi/sysex.js';
import { validateProfile } from '../src/profiles/validate.js';
import junoG from '../src/profiles/roland-juno-g.json' with { type: 'json' };

// ── 1. Checksum ──────────────────────────────────────────────────────────
console.log('roland checksum');
{
  // Roland's rule: the address + data bytes plus the checksum must sum to a
  // multiple of 128 (in 7 bits).
  const cases = [
    [0x10, 0x00, 0x04, 0x00, 0x01],
    [0x00],
    [0x7f, 0x7f, 0x7f],
    [0x10, 0x00, 0x06, 0x00, 0x0f, 0x0f],
  ];
  let ok = true;
  for (const bytes of cases) {
    const sum = bytes.reduce((a, b) => a + b, 0) + rolandChecksum(bytes);
    if (sum % 128 !== 0) { ok = false; console.log(`    ${formatHex(bytes)} -> ${sum % 128}`); }
    if (rolandChecksum(bytes) < 0 || rolandChecksum(bytes) > 127) ok = false;
  }
  check('checksum makes the total a multiple of 128', ok);
  check('a zero-sum payload checksums to 0', rolandChecksum([0x00]) === 0,
    `${rolandChecksum([0x00])}`);
}

// ── 2. Message framing ───────────────────────────────────────────────────
console.log('DT1 framing');
{
  const msg = buildRolandDT1(0x10, [0x00, 0x00, 0x00, 0x15], [0x10, 0x00, 0x04, 0x00], [0x01]);
  check('starts with F0 41', msg[0] === 0xF0 && msg[1] === 0x41, formatHex(msg.slice(0, 2)));
  check('carries the device id', msg[2] === 0x10, `${msg[2]}`);
  check('carries the model id', formatHex(msg.slice(3, 7)) === '00 00 00 15',
    formatHex(msg.slice(3, 7)));
  check('uses command 0x12 (DT1)', msg[7] === 0x12, `${msg[7]}`);
  check('ends with F7', msg[msg.length - 1] === 0xF7);
  check('every byte is legal in SysEx',
    msg.slice(1, -1).every(b => b >= 0 && b <= 0x7F),
    formatHex(msg.filter(b => b > 0x7F)));

  const body = msg.slice(8, -2);
  check('checksum matches the body',
    msg[msg.length - 2] === rolandChecksum(body), formatHex(msg));
}

// ── 3. Nibble encoding ───────────────────────────────────────────────────
console.log('value encoding');
{
  check('size 1 defaults to a plain 7-bit byte', encodingForSize(1) === 'byte');
  check('size 2+ defaults to nibbles', encodingForSize(2) === 'nibble' && encodingForSize(4) === 'nibble');
  check('an explicit encoding wins', encodingForSize(4, 'byte') === 'byte');

  check('a byte parameter tops out at 127', maxValueFor(1) === 127, `${maxValueFor(1)}`);
  check('two nibbles reach 255', maxValueFor(2) === 255, `${maxValueFor(2)}`);
  check('four nibbles reach 65535', maxValueFor(4) === 65535, `${maxValueFor(4)}`);

  check('0x1234 over 4 nibbles is 01 02 03 04',
    formatHex(encodeRolandValue(0x1234, 4)) === '01 02 03 04',
    formatHex(encodeRolandValue(0x1234, 4)));
  check('255 over 2 nibbles is 0f 0f',
    formatHex(encodeRolandValue(255, 2)) === '0f 0f',
    formatHex(encodeRolandValue(255, 2)));
  check('0 over 2 nibbles is 00 00',
    formatHex(encodeRolandValue(0, 2)) === '00 00');
  check('a single byte passes through', encodeRolandValue(64, 1)[0] === 64);

  // Every nibble must be 0-15 or the message is illegal.
  let allLegal = true;
  for (const size of [1, 2, 3, 4]) {
    for (const v of [0, 1, 15, 16, 127, 255, 4095, 65535, 999999, -5]) {
      const enc = encodeRolandValue(v, size);
      if (enc.length !== size) allLegal = false;
      const limit = encodingForSize(size) === 'nibble' ? 15 : 127;
      if (enc.some(b => b < 0 || b > limit)) allLegal = false;
    }
  }
  check('encoding stays in range for every size and input', allLegal);

  check('out-of-range values clamp rather than wrap',
    formatHex(encodeRolandValue(999999, 2)) === '0f 0f' &&
    formatHex(encodeRolandValue(-5, 2)) === '00 00',
    `${formatHex(encodeRolandValue(999999, 2))} / ${formatHex(encodeRolandValue(-5, 2))}`);

  // Round-trip: decode the nibbles back and confirm we get the value.
  const decode = (bytes) => bytes.reduce((acc, b) => (acc << 4) | b, 0);
  check('nibbles round-trip', [0, 1, 255, 4096, 65535]
    .every(v => decode(encodeRolandValue(v, 4)) === v));
}

// ── 4. buildSysEx dispatch ───────────────────────────────────────────────
console.log('format dispatch');
{
  const bytes = buildSysEx('roland-dt1', {
    deviceId: 16, modelId: [0, 0, 0, 21], address: [16, 0, 4, 0], data: [1],
  });
  check('roland-dt1 builds a message', Array.isArray(bytes) && bytes[0] === 0xF0);
  let threw = false;
  try { buildSysEx('yamaha-xg', { address: [0], data: [0] }); } catch { threw = true; }
  check('an unknown format throws', threw);
}

// ── 5. Profile metadata validation ───────────────────────────────────────
console.log('profile sysex metadata');
{
  const base = () => ({
    id: 'test', manufacturer: 'T', model: 'M',
    banks: [{ id: 'A', msb: 0, lsb: 0, patches: ['x'] }],
  });
  const withCmd = (cmd) => ({
    ...base(),
    sysex: { parameterFormat: 'roland-dt1', commands: { p: { address: [1], ...cmd } } },
  });
  const bad = (p) => validateProfile(p).errors.map(e => e.path);

  check('the shipped Juno-G profile still validates', validateProfile(junoG).valid,
    JSON.stringify(validateProfile(junoG).errors.slice(0, 2)));
  check('an oversized size is rejected', bad(withCmd({ size: 99 })).some(p => p.endsWith('.size')));
  check('an unknown encoding is rejected',
    bad(withCmd({ size: 2, encoding: 'bcd' })).some(p => p.endsWith('.encoding')));
  check('a max beyond the size ceiling is rejected',
    bad(withCmd({ size: 2, max: 9999 })).some(p => p.endsWith('.max')),
    JSON.stringify(bad(withCmd({ size: 2, max: 9999 }))));
  check('a size-2 max of 255 is allowed',
    validateProfile(withCmd({ size: 2, max: 255 })).valid);
  check('a default outside min/max is rejected',
    bad(withCmd({ size: 2, min: 10, max: 20, default: 99 })).some(p => p.endsWith('.default')));
  check('min >= max is rejected',
    bad(withCmd({ size: 2, min: 200, max: 100 })).length > 0);
  check('a value label list is accepted',
    validateProfile(withCmd({ size: 1, values: ['Off', 'On'] })).valid,
    JSON.stringify(validateProfile(withCmd({ size: 1, values: ['Off', 'On'] })).errors));
  check('an object value map is accepted',
    validateProfile(withCmd({ size: 1, values: { 0: 'Off', 64: 'Half', 127: 'Full' } })).valid);
  check('a value key beyond the ceiling is rejected',
    bad(withCmd({ size: 1, values: { 999: 'Nope' } })).some(p => p.endsWith('.values')));
  check('an empty value label is rejected',
    bad(withCmd({ size: 1, values: ['', 'On'] })).some(p => p.endsWith('.values')));
}

// ── 6. The editor screen, in a browser ───────────────────────────────────
const chromium = await loadPlaywrightOptional();
if (!chromium) {
  note('browser checks skipped — playwright not installed (npm run test:setup)');
  finish('sysex');
}
const vite = spawn('npx', ['vite', '--port', '5213', '--strictPort'], {
  cwd: repoRoot, stdio: 'ignore',
});
let browser;
try {
  if (!await waitForHttp('http://127.0.0.1:5213/')) throw new Error('vite never came up');
  browser = await chromium.launch({ executablePath: chromiumExecutable() });
  const page = await (await browser.newContext()).newPage();
  await page.route('**/api/**', r => r.fulfill({ status: 200, body: '[]', contentType: 'application/json' }));
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://127.0.0.1:5213/', { waitUntil: 'networkidle' });
  await sleep(300);

  console.log('sysex editor');
  // The Juno-G has SysEx commands; Generic GM does not.
  await page.locator('.mode-tab[data-mode="settings"]').click();
  await sleep(200);
  await page.locator('#settingsView [data-role="profile-select"]').selectOption('roland-juno-g');
  await sleep(200);
  await page.locator('.mode-tab[data-mode="controller"]').click();
  await sleep(200);
  await page.locator('.tab-btn[data-tab="sysex"]').click();
  await sleep(300);

  const rowCount = await page.locator('.sysex-row').count();
  check('a row per SysEx command', rowCount === Object.keys(junoG.sysex.commands).length,
    `${rowCount} rows`);
  check('the address is shown', /^[0-9a-f ]+ · /i.test(
    (await page.locator('.sysex-addr').first().textContent()) || ''),
    await page.locator('.sysex-addr').first().textContent());

  const preview = (await page.locator('.sysex-preview').first().textContent())?.trim();
  check('the encoded message is previewed', /^F0 41/.test(preview || ''), preview);
  check('the preview ends with F7', /F7$/.test(preview || ''), preview);

  // Moving a slider must change the preview, and pressing SEND transmits.
  const slider = page.locator('.sysex-row').first().locator('input[type="range"]');
  await slider.fill('5');
  await sleep(150);
  const after = (await page.locator('.sysex-preview').first().textContent())?.trim();
  check('changing the value changes the message', after !== preview, `${preview} -> ${after}`);

  await page.locator('.sysex-row').first().locator('.ctrl-btn').click();
  await sleep(150);
  const lcd = await page.locator('[data-role="lcd-msg"]').textContent();
  check('sending reports the parameter on the LCD', /SYSEX/.test(lcd || ''), lcd);

  // A profile with no SysEx section should explain itself, not render blank.
  await page.locator('.mode-tab[data-mode="settings"]').click();
  await sleep(200);
  await page.locator('#settingsView [data-role="profile-select"]').selectOption('generic-gm');
  await sleep(200);
  await page.locator('.mode-tab[data-mode="controller"]').click();
  await sleep(300);
  const emptyText = await page.locator('[data-role="sysex-list"]').textContent();
  check('a profile without SysEx explains itself',
    /no SysEx|defines no/i.test(emptyText || ''), (emptyText || '').slice(0, 80));

  check('no console errors', errors.length === 0, errors.join(' | '));
} finally {
  await browser?.close();
  vite.kill('SIGKILL');
}

finish('sysex');
