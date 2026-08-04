// The profile capture draft: bank management, the scan cursor, and the JSON
// it produces. Plus the screen itself in a browser.
import { check, finish, note, repoRoot, sleep,
         loadPlaywrightOptional, chromiumExecutable, waitForHttp } from './helpers.mjs';
import { spawn } from 'node:child_process';

// createDraft persists to localStorage; give it somewhere to write.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { createDraft, toProfile, suggestId, emptyDraft, loadStoredDraft } =
  await import('../src/controller/profile-draft.js');
const { validateProfile } = await import('../src/profiles/validate.js');

// ── 1. Slug suggestion ───────────────────────────────────────────────────
console.log('id suggestion');
{
  check('builds a slug from maker and model',
    suggestId('Roland', 'JUNO-DS') === 'roland-juno-ds', suggestId('Roland', 'JUNO-DS'));
  check('collapses punctuation and spaces',
    suggestId('Yamaha', 'PSR-E473 (61)') === 'yamaha-psr-e473-61',
    suggestId('Yamaha', 'PSR-E473 (61)'));
  check('handles a missing half', suggestId('', 'Nord Stage') === 'nord-stage',
    suggestId('', 'Nord Stage'));
  check('empty in, empty out', suggestId('', '') === '');
}

// ── 2. Identity, and the id staying under the user's control ─────────────
console.log('identity');
{
  const d = createDraft();
  d.setIdentity({ manufacturer: 'Korg' });
  d.setIdentity({ model: 'Minilogue' });
  check('the id is suggested automatically', d.get().id === 'korg-minilogue', d.get().id);

  d.setId('my-custom-id');
  d.setIdentity({ model: 'Minilogue XD' });
  check('an edited id is not overwritten', d.get().id === 'my-custom-id', d.get().id);

  d.setIdentityResponse({
    manufacturerId: 0x42, manufacturerName: 'Korg',
    familyCode: [0x01, 0x02], modelNumber: [0x03, 0x04],
  });
  const ir = d.get().identityResponse;
  check('manufacturer id is stored as hex', ir.manufacturerId === '0x42', ir.manufacturerId);
  check('family and model are byte arrays',
    Array.isArray(ir.familyCode) && ir.familyCode[1] === 2, JSON.stringify(ir));
}

// ── 3. Banks ─────────────────────────────────────────────────────────────
console.log('banks');
{
  const d = createDraft();
  const i = d.addBank({ id: 'PR-A', label: 'PR-A', msb: 87, lsb: 0 });
  check('adding a bank returns its index', i === 0, `${i}`);
  check('the new bank is selected', d.get().cursor.bankIndex === 0);
  check('the cursor starts at PC 0', d.get().cursor.pc === 0);

  d.addBank({ id: 'PR-B', msb: 87, lsb: 1 });
  check('adding again selects the new one', d.get().cursor.bankIndex === 1);
  check('bank defaults fill in', d.get().banks[1].label === 'PR-B', d.get().banks[1].label);

  d.updateBank(0, { msb: 88 });
  check('a bank can be edited', d.get().banks[0].msb === 88);

  d.removeBank(1);
  check('a bank can be removed', d.get().banks.length === 1);
  check('the cursor stays in range', d.get().cursor.bankIndex === 0,
    `${d.get().cursor.bankIndex}`);
}

// ── 4. The scan cursor ───────────────────────────────────────────────────
console.log('scanning');
{
  const d = createDraft();
  d.addBank({ id: 'A', msb: 0, lsb: 0 });

  d.nameCurrent('Grand Piano');
  check('names the current slot', d.currentBank().patches[0] === 'Grand Piano');
  d.advance(1);
  check('advances', d.get().cursor.pc === 1);
  d.nameCurrent('Bright Piano');
  d.advance(1);
  d.advance(1);                       // leave PC 2 blank
  d.nameCurrent('Harpsichord');

  const patches = d.currentBank().patches;
  check('a skipped slot stays blank', patches[2] === '', JSON.stringify(patches));
  check('later slots still land correctly', patches[3] === 'Harpsichord', JSON.stringify(patches));
  check('the named count ignores blanks', d.namedCount() === 3, `${d.namedCount()}`);

  d.setCursor(999);
  check('the cursor clamps at 127', d.get().cursor.pc === 127, `${d.get().cursor.pc}`);
  d.setCursor(-5);
  check('and at 0', d.get().cursor.pc === 0, `${d.get().cursor.pc}`);
  d.advance(-1);
  check('stepping below zero stays at zero', d.get().cursor.pc === 0);
}

// ── 5. The exported profile ──────────────────────────────────────────────
console.log('export');
{
  const d = createDraft();
  d.setIdentity({ manufacturer: 'Roland', model: 'JUNO-DS' });
  d.addBank({ id: 'PR-A', label: 'PR-A', msb: 87, lsb: 0 });
  d.nameCurrent('Grand'); d.advance(1);
  d.nameCurrent('Rhodes'); d.advance(1);
  d.nameCurrent('Strings');

  const profile = d.toProfile();
  check('carries the identity',
    profile.manufacturer === 'Roland' && profile.model === 'JUNO-DS'
    && profile.id === 'roland-juno-ds', JSON.stringify(profile).slice(0, 90));
  check('one bank with three patches',
    profile.banks.length === 1 && profile.banks[0].patches.length === 3,
    JSON.stringify(profile.banks[0]?.patches));
  check('bank numbers survive',
    profile.banks[0].msb === 87 && profile.banks[0].lsb === 0);

  const result = validateProfile(profile);
  check('the exported profile validates', result.valid,
    JSON.stringify(result.errors.slice(0, 2)));

  // Trailing blanks are noise; a gap in the middle is information.
  const d2 = createDraft();
  d2.setIdentity({ manufacturer: 'X', model: 'Y' });
  d2.addBank({ id: 'A', msb: 0, lsb: 0 });
  d2.setCursor(0); d2.nameCurrent('First');
  d2.setCursor(2); d2.nameCurrent('Third');
  d2.setCursor(40);                     // visited but never named
  const p2 = d2.toProfile();
  check('trailing unnamed slots are dropped', p2.banks[0].patches.length === 3,
    `${p2.banks[0].patches.length}`);
  check('an interior gap is kept and given a placeholder',
    p2.banks[0].patches[1] !== '' && p2.banks[0].patches[2] === 'Third',
    JSON.stringify(p2.banks[0].patches));
  check('the placeholder profile still validates', validateProfile(p2).valid,
    JSON.stringify(validateProfile(p2).errors.slice(0, 2)));

  // A bank with nothing in it shouldn't reach the file.
  const d3 = createDraft();
  d3.setIdentity({ manufacturer: 'X', model: 'Y' });
  d3.addBank({ id: 'Empty', msb: 0, lsb: 0 });
  check('an entirely empty bank is omitted', d3.toProfile().banks.length === 0,
    JSON.stringify(d3.toProfile().banks));
}

// ── 6. Validation feedback while incomplete ──────────────────────────────
console.log('incomplete drafts');
{
  const d = createDraft();
  check('an empty draft is not valid', d.validate().valid === false);
  d.setIdentity({ manufacturer: 'Roland', model: 'JUNO-DS' });
  check('still invalid with no banks', d.validate().valid === false);
  d.addBank({ id: 'A', msb: 0, lsb: 0 });
  d.nameCurrent('Something');
  check('valid once a bank has a patch', d.validate().valid === true,
    JSON.stringify(d.validate().errors));
}

// ── 7. Persistence and recovery ──────────────────────────────────────────
console.log('persistence');
{
  store.clear();
  const d = createDraft();
  d.setIdentity({ manufacturer: 'Nord', model: 'Stage 3' });
  d.addBank({ id: 'A', msb: 0, lsb: 0 });
  d.nameCurrent('Piano 1');

  const restored = loadStoredDraft();
  check('the draft is written to storage', !!restored);
  check('identity survives a reload', restored.model === 'Stage 3', restored.model);
  check('captured names survive', restored.banks[0].patches[0] === 'Piano 1',
    JSON.stringify(restored.banks[0].patches));

  // Corrupt storage must not take the screen down with it.
  store.set('keyfall.profileDraft', '{ not json');
  check('unparseable storage yields null', loadStoredDraft() === null);
  store.set('keyfall.profileDraft', JSON.stringify({ banks: 'nope', cursor: 5 }));
  const salvaged = loadStoredDraft();
  check('a malformed draft is salvaged into a usable shape',
    Array.isArray(salvaged.banks) && typeof salvaged.cursor === 'object',
    JSON.stringify(salvaged).slice(0, 80));

  d.reset();
  check('reset clears the draft', d.get().banks.length === 0 && d.get().model === '');
}

// ── 8. The screen, in a browser ──────────────────────────────────────────
const chromium = await loadPlaywrightOptional();
if (!chromium) {
  note('browser checks skipped — playwright not installed (npm run test:setup)');
  finish('builder');
}

const vite = spawn('npx', ['vite', '--port', '5223', '--strictPort'], {
  cwd: repoRoot, stdio: 'ignore',
});
let browser;
try {
  if (!await waitForHttp('http://127.0.0.1:5223/')) throw new Error('vite never came up');
  browser = await chromium.launch({ executablePath: chromiumExecutable() });
  const page = await (await browser.newContext()).newPage();
  await page.route('**/api/**', r => r.fulfill({ status: 200, body: '[]', contentType: 'application/json' }));
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://127.0.0.1:5223/', { waitUntil: 'networkidle' });
  await sleep(300);

  console.log('capture screen');
  await page.locator('.mode-tab[data-mode="controller"]').click();
  await sleep(200);
  await page.locator('.tab-btn[data-tab="capture"]').click();
  await sleep(300);

  check('the capture screen renders', await page.locator('.builder').isVisible());
  check('the scan panel hides until there is a bank',
    await page.locator('[data-role="scan-section"]').isHidden());
  const initial = await page.locator('[data-role="validation"]').textContent();
  check('an empty draft reports what is missing', /Not exportable/.test(initial || ''),
    (initial || '').slice(0, 60));

  await page.locator('[data-role="builder-manufacturer"]').fill('Roland');
  await page.locator('[data-role="builder-model"]').fill('JUNO-DS');
  await sleep(200);
  check('the profile id is suggested',
    await page.locator('[data-role="builder-id"]').inputValue() === 'roland-juno-ds',
    await page.locator('[data-role="builder-id"]').inputValue());

  await page.locator('[data-action="add-bank"]').click();
  await sleep(200);
  check('the bank appears', await page.locator('.builder-bank').count() === 1);
  check('the scan panel opens', await page.locator('[data-role="scan-section"]').isVisible());
  check('it starts at PC 0',
    (await page.locator('[data-role="slot-pc"]').textContent())?.trim() === 'PC 0');

  // Type a name and press Enter — should store it and advance.
  const nameField = page.locator('[data-role="patch-name"]');
  await nameField.fill('Grand Piano');
  await nameField.press('Enter');
  await sleep(200);
  check('Enter advances to the next slot',
    (await page.locator('[data-role="slot-pc"]').textContent())?.trim() === 'PC 1',
    await page.locator('[data-role="slot-pc"]').textContent());
  await nameField.fill('Rhodes');
  await nameField.press('Enter');
  await sleep(200);
  check('the named count tracks progress',
    /2 of 128/.test((await page.locator('[data-role="scan-count"]').textContent()) || ''),
    await page.locator('[data-role="scan-count"]').textContent());

  const valid = await page.locator('[data-role="validation"]').textContent();
  check('the draft becomes exportable', /Valid/.test(valid || ''), (valid || '').slice(0, 60));

  // The draft must survive a reload — this is potentially an hour of typing.
  await page.reload({ waitUntil: 'networkidle' });
  await sleep(400);
  await page.locator('.mode-tab[data-mode="controller"]').click();
  await sleep(200);
  await page.locator('.tab-btn[data-tab="capture"]').click();
  await sleep(300);
  check('the draft survives a reload',
    await page.locator('[data-role="builder-model"]').inputValue() === 'JUNO-DS',
    await page.locator('[data-role="builder-model"]').inputValue());
  check('and so do the captured names',
    /2 of 128/.test((await page.locator('[data-role="scan-count"]').textContent()) || ''),
    await page.locator('[data-role="scan-count"]').textContent());

  check('no console errors', errors.length === 0, errors.join(' | '));
} finally {
  await browser?.close();
  vite.kill('SIGKILL');
}

finish('builder');
