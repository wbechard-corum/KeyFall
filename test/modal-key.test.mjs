// Typing in the REMOTE code field must not drive trainer playback.
import { repoRoot, serverDir, check, finish, sleep, loadPlaywright, chromiumExecutable, waitForHttp } from './helpers.mjs';

const chromium = await loadPlaywright();
import { spawn } from 'node:child_process';


const vite = spawn('npx', ['vite', '--port', '5201', '--strictPort'], { cwd: repoRoot, stdio: 'ignore' });
for (let i = 0; i < 150; i++) { try { if ((await fetch('http://127.0.0.1:5201/')).ok) break; } catch {} await sleep(100); }

const browser = await chromium.launch({ executablePath: chromiumExecutable() });
try {
  const page = await (await browser.newContext()).newPage();
  await page.route('**/api/**', r => r.fulfill({ status: 200, body: '[]', contentType: 'application/json' }));
  await page.goto('http://127.0.0.1:5201/', { waitUntil: 'networkidle' });
  await sleep(400);

  await page.locator('.demo-item').first().click();
  await sleep(200);
  check('starts paused', (await page.locator('[data-action="play"]').textContent()).trim() === 'PLAY');

  await page.locator('#modeRemote').click();
  await sleep(200);
  check('remote modal is open', await page.locator('#remoteModal').isVisible());
  check('trainer still visible behind it', await page.locator('#trainerView').isVisible());

  await page.locator('#remoteCodeInput').focus();
  await page.keyboard.press('Space');
  await sleep(250);
  const label = (await page.locator('[data-action="play"]').textContent()).trim();
  check('space in the code field did NOT start playback', label === 'PLAY', `label=${label}`);
} finally {
  await browser.close();
  vite.kill('SIGKILL');
}
finish('modal key');
