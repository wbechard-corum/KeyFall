// Loads the built app in Chromium and drives the UI, failing on any
// console error or uncaught exception.
import { repoRoot, serverDir, check, finish, sleep, loadPlaywright, chromiumExecutable, waitForHttp } from './helpers.mjs';

const chromium = await loadPlaywright();
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';


const API_PORT = 8902;
const dataDir = await mkdtemp(path.join(tmpdir(), 'keyfall-smoke-'));

// Real backend for /api/songs, so the Songs tab exercises live code.
const api = spawn(process.execPath, ['mirror-server.js'], {
  cwd: serverDir,
  env: { ...process.env, PORT: String(API_PORT), DATA_DIR: dataDir },
  stdio: ['ignore', 'pipe', 'pipe'],
});
api.stdout.on('data', () => {});
api.stderr.on('data', () => {});

// Vite dev server for the app itself.
const vite = spawn('npx', ['vite', '--port', '5199', '--strictPort'], {
  cwd: repoRoot,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let viteLog = '';
vite.stdout.on('data', d => { viteLog += d; });
vite.stderr.on('data', d => { viteLog += d; });

async function waitFor(url) {
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(url)).ok) return true; } catch { /* not up */ }
    await sleep(100);
  }
  return false;
}

let browser;
try {
  if (!await waitFor(`http://127.0.0.1:${API_PORT}/healthz`)) throw new Error('api never came up');
  if (!await waitFor('http://127.0.0.1:5199/')) throw new Error(`vite never came up:\n${viteLog}`);

  browser = await chromium.launch({ executablePath: chromiumExecutable() });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Proxy the app's /api calls to the real backend.
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const target = `http://127.0.0.1:${API_PORT}${url.pathname}${url.search}`;
    const res = await route.fetch({ url: target });
    await route.fulfill({ response: res });
  });

  // Anything the page fetches from another origin would break the offline
  // PWA and leak a request to a third party.
  const external = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) && url.protocol.startsWith('http')) {
      external.push(req.url());
    }
  });

  const errors = [];
  page.on('console', m => {
    const t = m.text();
    // Google Fonts is unreachable in this sandbox; not an app fault.
    if (m.type() === 'error' && !/Failed to load resource/.test(t)) errors.push(t);
  });
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));

  await page.goto('http://127.0.0.1:5199/', { waitUntil: 'networkidle' });
  await sleep(400);

  console.log('app boot');
  check('nav rendered', await page.locator('#modeNav').isVisible());
  check('version label populated', /^v\d/.test((await page.locator('#appVersion').textContent()) || ''),
    await page.locator('#appVersion').textContent());
  check('no console errors on boot', errors.length === 0, errors.join(' | '));

  console.log('offline readiness');
  check('nothing is fetched from a third party', external.length === 0, external.join(' | '));
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    const loaded = [...document.fonts].filter(f => f.status === 'loaded');
    return {
      families: [...new Set(loaded.map(f => f.family))],
      // Does the rendered UI actually resolve to the bundled face?
      navFont: getComputedStyle(document.querySelector('.mode-brand')).fontFamily,
    };
  });
  check('IBM Plex is loaded from the bundle',
    fonts.families.some(f => /IBM Plex/i.test(f)), JSON.stringify(fonts.families));
  check('the UI asks for IBM Plex', /IBM Plex/i.test(fonts.navFont), fonts.navFont);

  console.log('trainer: load a demo and play');
  errors.length = 0;
  await page.locator('.demo-item').first().click();
  await sleep(200);
  const info = await page.locator('[data-role="song-info"]').textContent();
  check('song info shows note count', /notes/.test(info || ''), info);

  await page.locator('[data-action="play"]').click();
  await sleep(900);
  check('play button flipped to PAUSE',
    (await page.locator('[data-action="play"]').textContent())?.trim() === 'PAUSE');
  const w1 = await page.locator('[data-role="progress-fill"]').evaluate(el => el.style.width);
  await sleep(600);
  const w2 = await page.locator('[data-role="progress-fill"]').evaluate(el => el.style.width);
  check('progress advances during playback', parseFloat(w2) > parseFloat(w1), `${w1} → ${w2}`);

  await page.locator('[data-action="play"]').click();   // pause
  await page.locator('[data-action="stop"]').click();
  await sleep(150);
  check('stop resets progress',
    parseFloat(await page.locator('[data-role="progress-fill"]').evaluate(el => el.style.width)) === 0);
  check('no console errors during playback', errors.length === 0, errors.join(' | '));

  console.log('trainer: hand modes + score HUD');
  errors.length = 0;
  const handBtn = page.locator('[data-action="hand-r"]');
  const modeOf = () => handBtn.getAttribute('data-mode');
  check('right hand starts on BOTH', await modeOf() === 'both', await modeOf());
  await handBtn.click(); await sleep(80);
  check('cycles to YOU', await modeOf() === 'you', await modeOf());
  await handBtn.click(); await sleep(80);
  check('cycles to APP', await modeOf() === 'app', await modeOf());
  await handBtn.click(); await sleep(80);
  check('cycles to OFF', await modeOf() === 'off', await modeOf());
  await handBtn.click(); await sleep(80);
  check('wraps back to BOTH', await modeOf() === 'both', await modeOf());

  // The score HUD should start empty and stay empty until something is judged.
  check('score starts blank',
    (await page.locator('[data-role="score-acc"]').textContent())?.trim() === '—');

  // Play a demo far enough that unplayed notes get swept as misses, which is
  // only possible now that scoring runs with wait mode off.
  await page.locator('[data-action="stop"]').click();
  await page.locator('[data-action="play"]').click();
  await sleep(2500);
  const accText = (await page.locator('[data-role="score-acc"]').textContent())?.trim();
  check('accuracy appears once notes are judged', /%$/.test(accText || ''), accText);
  const detail = (await page.locator('[data-role="score-detail"]').textContent())?.trim();
  check('hit/total counter populated', /^\d+\/\d+$/.test(detail || ''), detail);
  await page.locator('[data-action="play"]').click();   // pause
  await page.locator('[data-action="stop"]').click();
  await sleep(150);
  check('stop clears the score',
    (await page.locator('[data-role="score-acc"]').textContent())?.trim() === '—');
  check('no console errors from scoring', errors.length === 0, errors.join(' | '));

  console.log('trainer: canvas piano interaction');
  errors.length = 0;
  const box = await page.locator('.canvas-wrap canvas').boundingBox();
  // Press near the bottom of the canvas, where the keyboard is drawn.
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.95);
  await page.mouse.down();
  await sleep(80);
  // Drag well off the canvas before releasing — this used to strand the key.
  await page.mouse.move(box.x + box.width * 0.5, box.y - 60);
  await page.mouse.up();
  await sleep(150);
  check('no errors from touch piano', errors.length === 0, errors.join(' | '));

  console.log('trainer: wait mode + speed + keys');
  errors.length = 0;
  await page.locator('[data-action="wait"]').click();
  await page.locator('[data-action="speed"]').selectOption('0.5');
  await page.locator('[data-action="keys"]').selectOption('61');
  await sleep(200);
  await page.locator('[data-action="play"]').click();
  await sleep(500);
  await page.locator('[data-action="play"]').click();
  check('no errors from controls', errors.length === 0, errors.join(' | '));

  console.log('controller tab');
  errors.length = 0;
  await page.locator('.mode-tab[data-mode="controller"]').click();
  await sleep(300);
  const patchCount = await page.locator('.patch-item').count();
  check('patch list rendered', patchCount > 0, `${patchCount} patches`);
  await page.locator('.patch-item').nth(3).click();
  await sleep(120);
  const lcd = await page.locator('[data-role="lcd-patch-name"]').textContent();
  check('LCD shows a patch name', !!lcd && lcd !== '—', lcd);

  await page.locator('.tab-btn[data-tab="effects"]').click();
  await sleep(200);
  check('effect sliders rendered', await page.locator('.fx-slider').count() > 0);
  const fxLabel = await page.locator('.fx-label').first().textContent();
  check('effect label is text, not markup', !!fxLabel?.trim(), fxLabel);

  await page.locator('.tab-btn[data-tab="controls"]').click();
  await sleep(200);
  check('controls panel rendered',
    await page.locator('.control-toggle, .no-controls').count() > 0);
  check('no console errors in controller', errors.length === 0, errors.join(' | '));

  console.log('settings tab: profile switch reaches the controller');
  errors.length = 0;
  await page.locator('.mode-tab[data-mode="settings"]').click();
  await sleep(300);
  const options = await page.locator('#settingsView [data-role="profile-select"] option').allTextContents();
  check('profile select populated', options.length >= 2, options.join(','));
  const shown = await page.locator('#settingsView [data-role="profile-select"]').inputValue();
  check('settings select matches the controller default', shown === 'generic-gm', shown);

  await page.locator('#settingsView [data-role="profile-select"]').selectOption('roland-juno-g');
  await sleep(300);
  await page.locator('.mode-tab[data-mode="controller"]').click();
  await sleep(300);
  const model = await page.locator('[data-role="model"]').textContent();
  check('controller switched profile live (no reload)', /JUNO/.test(model || ''), model);
  check('no console errors from profile switch', errors.length === 0, errors.join(' | '));

  console.log('songs tab');
  errors.length = 0;
  await page.locator('.mode-tab[data-mode="songs"]').click();
  await sleep(500);
  check('songs view rendered', await page.locator('.songs-root').isVisible());
  const empty = await page.locator('[data-role="empty"]').textContent();
  check('empty library message shown', /No songs/.test(empty || ''), empty);
  check('no console errors in songs tab', errors.length === 0, errors.join(' | '));

  console.log('keyboard shortcut does not double-toggle');
  errors.length = 0;
  await page.locator('.mode-tab[data-mode="trainer"]').click();
  await sleep(200);
  // Focus the PLAY button, then press Space: the button's own activation
  // fires, and the global handler must NOT also toggle.
  await page.locator('[data-action="play"]').focus();
  await page.keyboard.press('Space');
  await sleep(300);
  const label = (await page.locator('[data-action="play"]').textContent())?.trim();
  check('space with PLAY focused toggles exactly once', label === 'PAUSE', `label=${label}`);
  await page.keyboard.press('Escape');
  await sleep(150);
  check('no console errors from shortcuts', errors.length === 0, errors.join(' | '));

} catch (err) {
  check('harness ran to completion', false, err.message);
} finally {
  await browser?.close();
  api.kill('SIGKILL');
  vite.kill('SIGKILL');
  await rm(dataDir, { recursive: true, force: true });
}

finish('smoke');
