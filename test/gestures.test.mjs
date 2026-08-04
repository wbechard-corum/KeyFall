// Gesture recognition, keyboard zoom/pan maths, and the mobile interactions
// driven through a real browser with touch input.
import { check, finish, note, repoRoot, sleep,
         loadPlaywrightOptional, chromiumExecutable, waitForHttp } from './helpers.mjs';
import { spawn } from 'node:child_process';

// ── A tiny DOM shim so the recogniser can run headless ───────────────────
// The recogniser reads performance.now() to time swipes, so we drive it from
// a fake clock. The real object is put back before the browser section —
// Node's fetch and playwright both need the genuine article.
let now = 0;
const realPerformance = globalThis.performance;
globalThis.performance = { now: () => now };

function fakeElement() {
  const handlers = new Map();
  return {
    addEventListener(type, fn) {
      if (!handlers.has(type)) handlers.set(type, []);
      handlers.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = handlers.get(type) || [];
      const i = list.indexOf(fn);
      if (i !== -1) list.splice(i, 1);
    },
    fire(type, event) {
      for (const fn of handlers.get(type) || []) fn(event);
    },
    handlerCount() {
      let n = 0;
      for (const list of handlers.values()) n += list.length;
      return n;
    },
  };
}

const { createGestureTarget } = await import('../src/shared/gestures.js');

const down = (el, id, x, y) => el.fire('pointerdown', { pointerId: id, clientX: x, clientY: y });
const move = (el, id, x, y) => el.fire('pointermove', { pointerId: id, clientX: x, clientY: y });
const up   = (el, id, x, y) => el.fire('pointerup',   { pointerId: id, clientX: x, clientY: y });

// ── 1. Pinch ─────────────────────────────────────────────────────────────
console.log('pinch');
{
  const el = fakeElement();
  const pinches = [];
  let started = 0, ended = 0;
  createGestureTarget(el, {
    onPinch: (p) => pinches.push(p),
    onGestureStart: () => started++,
    onGestureEnd: () => ended++,
  });

  down(el, 1, 100, 100);
  check('one finger is not a gesture yet', started === 0);
  down(el, 2, 200, 100);
  check('a second finger starts a gesture', started === 1);

  move(el, 2, 300, 100);              // fingers now 200px apart, was 100
  check('spreading reports a scale above 1', pinches.at(-1)?.scale > 1,
    `${pinches.at(-1)?.scale}`);
  check('scale is relative to the previous event',
    Math.abs(pinches.at(-1).scale - 2) < 1e-6, `${pinches.at(-1).scale}`);
  check('the centre sits between the fingers',
    Math.abs(pinches.at(-1).centerX - 200) < 1e-6, `${pinches.at(-1).centerX}`);

  move(el, 2, 200, 100);              // back to 100px apart
  check('pinching in reports a scale below 1', pinches.at(-1).scale < 1,
    `${pinches.at(-1).scale}`);

  up(el, 1, 100, 100);
  up(el, 2, 200, 100);
  check('the gesture ends when the fingers lift', ended === 1, `${ended}`);
}

// ── 2. One-finger pan, and the threshold before it engages ───────────────
console.log('pan');
{
  const el = fakeElement();
  const pans = [];
  createGestureTarget(el, { onPan: (p) => pans.push(p) });

  down(el, 1, 100, 100);
  move(el, 1, 103, 100);
  check('a small movement is not a pan yet', pans.length === 0, `${pans.length}`);
  move(el, 1, 150, 100);
  check('crossing the threshold starts panning', pans.length > 0);
  check('pan reports the delta since the last move',
    pans.at(-1).dx === 47, `${pans.at(-1).dx}`);
  up(el, 1, 150, 100);
}

// ── 3. allowPan gates where a drag may pan from ──────────────────────────
console.log('allowPan');
{
  const el = fakeElement();
  const pans = [];
  // Refuse panning below y=300, as the trainer does for the piano area.
  createGestureTarget(el, { onPan: (p) => pans.push(p), allowPan: (e) => e.clientY < 300 });

  down(el, 1, 100, 400);
  move(el, 1, 200, 400);
  check('a drag in the forbidden zone does not pan', pans.length === 0, `${pans.length}`);
  up(el, 1, 200, 400);

  down(el, 2, 100, 100);
  move(el, 2, 200, 100);
  check('a drag elsewhere pans normally', pans.length > 0);
  up(el, 2, 200, 100);
}

// ── 4. Swipes ────────────────────────────────────────────────────────────
console.log('swipe');
{
  const el = fakeElement();
  const swipes = [];
  createGestureTarget(el, { onSwipe: (s) => swipes.push(s.direction), allowPan: () => false });

  const swipe = (fromX, toX, fromY, toY, ms = 200) => {
    down(el, 9, fromX, fromY);
    now += ms;
    move(el, 9, toX, toY);
    up(el, 9, toX, toY);
  };

  swipe(300, 100, 50, 50);
  check('a fast leftward flick is a left swipe', swipes.at(-1) === 'left', swipes.join(','));
  swipe(100, 300, 50, 50);
  check('and rightward is a right swipe', swipes.at(-1) === 'right', swipes.join(','));

  const before = swipes.length;
  swipe(100, 130, 50, 50);            // too short
  check('a short drag is not a swipe', swipes.length === before, swipes.join(','));

  swipe(100, 300, 50, 200);           // too diagonal
  check('a diagonal drag is not a swipe', swipes.length === before, swipes.join(','));

  now += 0;
  down(el, 8, 100, 50);
  now += 1200;                        // too slow
  move(el, 8, 300, 50);
  up(el, 8, 300, 50);
  check('a slow drag is not a swipe', swipes.length === before, swipes.join(','));
}

// ── 5. Teardown removes every listener ───────────────────────────────────
console.log('teardown');
{
  const el = fakeElement();
  const g = createGestureTarget(el, {});
  check('listeners are attached', el.handlerCount() === 4, `${el.handlerCount()}`);
  g.destroy();
  check('destroy removes them all', el.handlerCount() === 0, `${el.handlerCount()}`);
}

// ── 6. Zoom and pan maths, through the real renderer ─────────────────────
console.log('keyboard zoom');
{
  globalThis.window = { devicePixelRatio: 1 };
  const noop = () => {};
  const ctx = new Proxy({}, {
    get: (t, k) => {
      if (k === 'canvas') return undefined;
      if (['fillStyle', 'strokeStyle', 'globalAlpha', 'font', 'lineWidth',
           'textAlign', 'textBaseline', 'shadowColor', 'shadowBlur'].includes(k)) return '';
      if (k === 'createLinearGradient') return () => ({ addColorStop: noop });
      return noop;
    },
    set: () => true,
  });
  const canvas = {
    width: 0, height: 0, style: {},
    parentElement: { clientWidth: 1000, clientHeight: 600 },
    getContext: () => ctx,
  };
  const { createRenderer } = await import('../src/trainer/renderer.js');
  const r = createRenderer(canvas);
  r.resize();

  check('starts at the full 88 keys',
    r.getRange().min === 21 && r.getRange().max === 108, JSON.stringify(r.getRange()));

  r.zoomKeyboard(2, 0.5);
  const zoomed = r.getRange();
  check('pinching in halves the visible span',
    Math.abs((zoomed.max - zoomed.min + 1) - 44) <= 1,
    `${zoomed.max - zoomed.min + 1} keys`);
  check('the centre stays roughly put',
    Math.abs((zoomed.min + zoomed.max) / 2 - 64.5) <= 2, JSON.stringify(zoomed));

  // Zooming in far must stop at an octave, not collapse to nothing.
  for (let i = 0; i < 12; i++) r.zoomKeyboard(2, 0.5);
  const tight = r.getRange();
  check('never zooms past one octave', tight.max - tight.min + 1 >= 12,
    `${tight.max - tight.min + 1} keys`);

  // Panning past the ends clamps rather than scrolling into empty space.
  r.panKeyboard(-500);
  check('panning down stops at the lowest key', r.getRange().min === 21,
    JSON.stringify(r.getRange()));
  r.panKeyboard(500);
  check('panning up stops at the highest key', r.getRange().max === 108,
    JSON.stringify(r.getRange()));
  check('the span survives clamping at the edges',
    r.getRange().max - r.getRange().min + 1 === tight.max - tight.min + 1,
    `${r.getRange().max - r.getRange().min + 1} vs ${tight.max - tight.min + 1}`);

  // Zooming out returns to the whole keyboard and stops there.
  for (let i = 0; i < 20; i++) r.zoomKeyboard(0.5, 0.5);
  check('zooming out stops at the full keyboard',
    r.getRange().min === 21 && r.getRange().max === 108, JSON.stringify(r.getRange()));

  check('keysPerPixel reflects the current zoom',
    Math.abs(r.keysPerPixel() - 88 / 1000) < 1e-9, `${r.keysPerPixel()}`);

  // A garbage scale must not corrupt the range.
  const before = r.getRange();
  r.zoomKeyboard(NaN, 0.5);
  r.zoomKeyboard(0, 0.5);
  r.zoomKeyboard(-1, 0.5);
  check('nonsense scales are ignored',
    r.getRange().min === before.min && r.getRange().max === before.max,
    JSON.stringify(r.getRange()));
}

// ── 7. In a real browser, with touch ─────────────────────────────────────
globalThis.performance = realPerformance;

const chromium = await loadPlaywrightOptional();
if (!chromium) {
  note('browser checks skipped — playwright not installed (npm run test:setup)');
  finish('gestures');
}

const vite = spawn('npx', ['vite', '--port', '5221', '--strictPort'], {
  cwd: repoRoot, stdio: 'ignore',
});
let browser;
try {
  if (!await waitForHttp('http://127.0.0.1:5221/')) throw new Error('vite never came up');
  browser = await chromium.launch({ executablePath: chromiumExecutable() });
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 420, height: 780 },
  });
  const page = await context.newPage();
  await page.route('**/api/**', r => r.fulfill({ status: 200, body: '[]', contentType: 'application/json' }));
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://127.0.0.1:5221/', { waitUntil: 'networkidle' });
  await sleep(400);

  console.log('mobile');
  await page.locator('.demo-item').first().click();
  await sleep(250);

  const rangeOf = () => page.evaluate(() =>
    JSON.parse(localStorage.getItem('keyfall.settings') || '{}').keyboardRange);

  // Pinch the keyboard using CDP touch events — Playwright's tap helper
  // can't express two simultaneous contacts.
  const box = await page.locator('.canvas-wrap canvas').boundingBox();
  const cdp = await context.newCDPSession(page);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height * 0.4;
  const pinch = async (from, to) => {
    const pts = (d) => [
      { x: cx - d, y: cy, id: 1 },
      { x: cx + d, y: cy, id: 2 },
    ];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(from) });
    const steps = 6;
    for (let i = 1; i <= steps; i++) {
      const d = from + (to - from) * (i / steps);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(d) });
      await sleep(20);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(350);   // let the persist debounce fire
  };

  await pinch(40, 130);     // spread = zoom in = fewer keys
  const zoomedIn = await rangeOf();
  check('pinching out zooms the keyboard in',
    zoomedIn && typeof zoomedIn === 'object' && (zoomedIn.max - zoomedIn.min + 1) < 88,
    JSON.stringify(zoomedIn));

  await pinch(130, 40);     // pinch = zoom out = more keys
  const zoomedOut = await rangeOf();
  check('pinching in zooms back out',
    zoomedOut && (zoomedOut.max - zoomedOut.min + 1) > (zoomedIn.max - zoomedIn.min + 1),
    `${JSON.stringify(zoomedIn)} -> ${JSON.stringify(zoomedOut)}`);

  // Swiping the nav moves between tabs.
  const nav = await page.locator('#modeNav').boundingBox();
  const swipeNav = async (dir) => {
    const y = nav.y + nav.height / 2;
    const [x1, x2] = dir === 'left'
      ? [nav.x + nav.width * 0.8, nav.x + nav.width * 0.2]
      : [nav.x + nav.width * 0.2, nav.x + nav.width * 0.8];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y, id: 1 }] });
    await sleep(60);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x2, y, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(300);
  };

  const modeOf = () => page.evaluate(() =>
    JSON.parse(localStorage.getItem('keyfall.settings') || '{}').mode);
  check('starts on the trainer', await modeOf() === 'trainer', await modeOf());
  await swipeNav('left');
  check('swiping left advances a tab', await modeOf() === 'songs', await modeOf());
  await swipeNav('right');
  check('swiping right goes back', await modeOf() === 'trainer', await modeOf());

  // Dragging the progress bar scrubs.
  await page.locator('[data-action="play"]').click();
  await sleep(300);
  await page.locator('[data-action="play"]').click();
  const bar = await page.locator('[data-action="seek"]').boundingBox();
  const y = bar.y + bar.height / 2;
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: [{ x: bar.x + bar.width * 0.1, y, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove', touchPoints: [{ x: bar.x + bar.width * 0.7, y, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(250);
  const fill = await page.locator('[data-role="progress-fill"]').evaluate(el => parseFloat(el.style.width));
  check('dragging the bar scrubs to that position', fill > 50, `${fill}%`);

  check('no console errors', errors.length === 0, errors.join(' | '));
} finally {
  await browser?.close();
  vite.kill('SIGKILL');
}

finish('gestures');
