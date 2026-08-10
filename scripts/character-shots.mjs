/**
 * Photographs the duelist, exhaustively.
 *
 * The model is the thing this game is sold on, and it cannot be judged from
 * one angle on one duelist: a nose that reads head-on is a wedge in profile, a
 * hem that clears the leg standing still is cut through by it mid-stride, and
 * a collar sized off the wrong profile looks right on the default character
 * and wrong on the fourth roll. So this drives `/diag/character` through every
 * mode it has and writes the lot to a directory you can flip through.
 *
 * Modes, and what each is for:
 *
 *   sheet    one duelist from six angles — silhouette and face
 *   seams    the joints two parts can pass through, shot walking
 *   outfit   every garment, front and (with a cape) from behind
 *   hair     every cut
 *   beard    every beard
 *   frame    every frame at both extremes of build and height
 *   gauntlet every arm option
 *   skin     every tone
 *
 * By default it shoots all of them standing, and `seams` walking as well, for
 * the default duelist. Name modes to narrow it, add `--seed N` to sweep a
 * randomised duelist instead, and `--walk` to shoot every mode mid-stride.
 *
 *   npm run character
 *   npm run character -- --base http://localhost:3000 --out /tmp/character
 *   npm run character -- --only outfit,seams --walk --seed 3
 */

import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const BASE = flag('base', 'http://localhost:3000');
const OUT = flag('out', '/tmp/character');
const SEED = Number(flag('seed', '0'));
const WALK_ALL = has('walk');
const ONLY = flag('only', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const ALL = [
  'sheet',
  'seams',
  'outfit',
  'outfit-behind',
  'hair',
  'hair-behind',
  'beard',
  'frame',
  'gauntlet',
  'skin',
];
const MODES = ONLY.length ? ALL.filter((m) => ONLY.includes(m)) : ALL;

/* The same pinned binary the other browser checks use: this sandbox has one
   Chromium at a known path and no download step. */
const EXEC = process.env.PLAYWRIGHT_CHROMIUM_PATH || '/opt/pw-browsers/chromium';

await fs.mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: EXEC });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1060 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE:', m.text().slice(0, 300));
});

await page.goto(`${BASE}/diag/character`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas', { timeout: 30000 });
await page.waitForTimeout(2500);

for (let i = 0; i < SEED; i++) {
  await page.locator('button:has-text("Next duelist")').click();
  await page.waitForTimeout(500);
}

/* Clipped to the canvas rather than screenshotted through the element: an
   element shot waits for the box to stop moving, and a canvas driven by
   `requestAnimationFrame` never satisfies that. */
const canvas = page.locator('canvas');
const box = await canvas.boundingBox();
if (!box) throw new Error('character: the canvas has no bounding box — it never became visible');
const clip = { x: box.x, y: box.y, width: box.width, height: box.height };

const slug = (s) => s.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
const shot = async (name) => {
  await fs.writeFile(`${OUT}/${name}.png`, await page.screenshot({ clip, timeout: 60000 }));
  console.log(`  ${name}.png`);
};

/* Toggled by reading the button's own state rather than by tracking it here.
   Clicking by label and remembering what we clicked is how a run ends up one
   toggle out of phase and quietly shoots the wrong pose for every mode after
   the first. */
let walking = false;
const setWalking = async (want) => {
  const now = (await page.getAttribute('[data-walk]', 'data-walk')) === 'on';
  if (now !== want) {
    await page.locator('[data-walk]').click({ noWaitAfter: true });
    await page.waitForTimeout(350);
  }
  walking = (await page.getAttribute('[data-walk]', 'data-walk')) === 'on';
  if (walking !== want) throw new Error(`character: could not set walking=${want}`);
};

for (const mode of MODES) {
  await page.locator(`button[data-mode="${mode}"]`).click({ noWaitAfter: true });
  /* Sweeps build up to twelve duelists in one frame, which blocks the main
     thread for seconds — long enough that a screenshot asked for too early
     simply times out. */
  await page.waitForTimeout(4000);

  await setWalking(WALK_ALL);
  await shot(`${slug(mode)}${walking ? '-walk0' : ''}`);

  /* Seams are about what happens mid-stride, so they get the whole cycle
     whether or not the run asked for walking everywhere. */
  if (mode === 'seams' || WALK_ALL) {
    await setWalking(true);
    for (let k = 0; k < 3; k++) {
      await page.waitForTimeout(190);
      await shot(`${slug(mode)}-walk${k + (WALK_ALL ? 1 : 0)}`);
    }
  }
}

await browser.close();
console.log(`character: ${MODES.length} mode(s), seed ${SEED} -> ${OUT}`);
