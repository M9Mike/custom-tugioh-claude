/**
 * Photographs the duelist from six angles at once.
 *
 * The model is the thing this game is sold on, and you cannot tell whether a
 * face works from one angle: a nose that reads head-on is a wedge in profile,
 * a jaw that looks strong in profile vanishes from the front, and a hairline
 * that looks fine at arm's length is a moulded cap up close. So this drives
 * `/diag/character` — which renders front, three-quarter, side, back, head and
 * face into one canvas — and writes the contact sheet to a directory you can
 * flip through.
 *
 * It shoots the default duelist first, then as many random ones as you ask
 * for. The random ones are the point: the booth lets a player combine any
 * frame with any outfit, hair and beard, and the combinations are where the
 * geometry breaks — a collar sized off the wrong profile or a beard mask with
 * a kink in it looks fine on the default and wrong on the fourth roll.
 *
 * Pass `--seams` to switch to the second view set — the joints where two
 * parts can pass through each other — and to walk the duelist while shooting,
 * because clipping is a thing that happens mid-stride at a seam and never
 * shows up in a contact sheet of a standing figure.
 *
 *   npm run character                        # default only, to /tmp/character
 *   npm run character -- http://host:3000 out 6
 *   npm run character -- http://host:3000 out 4 --seams
 */

import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const OUT = process.argv[3] ?? '/tmp/character';
const SHOTS = Number(process.argv[4] ?? 1);
const SEAMS = process.argv.includes('--seams');

/* The same pinned binary the other browser checks use: this sandbox has one
   Chromium at a known path and no download step. */
const EXEC = process.env.PLAYWRIGHT_CHROMIUM_PATH || '/opt/pw-browsers/chromium';

await fs.mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: EXEC });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE:', m.text().slice(0, 300));
});

await page.goto(`${BASE}/diag/character`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('canvas', { timeout: 30000 });
await page.waitForTimeout(2500);

/* Clipped to the canvas rather than screenshotted through the element: an
   element shot waits for the box to stop moving, and a canvas driven by
   `requestAnimationFrame` never satisfies that. */
const canvas = page.locator('canvas');
const box = await canvas.boundingBox();
if (!box) throw new Error('character: the canvas has no bounding box — it never became visible');
const clip = { x: box.x, y: box.y, width: box.width, height: box.height };

if (SEAMS) {
  await page.locator('button:has-text("Contact sheet")').click();
  await page.waitForTimeout(400);
  await fs.writeFile(`${OUT}/seams-stand.png`, await page.screenshot({ clip }));
  await page.locator('button:has-text("Standing")').click();
  for (let i = 0; i < SHOTS; i++) {
    await page.waitForTimeout(170);
    await fs.writeFile(`${OUT}/seams-walk${i}.png`, await page.screenshot({ clip }));
  }
} else {
  await fs.writeFile(`${OUT}/00-default.png`, await page.screenshot({ clip }));
  for (let i = 1; i < SHOTS; i++) {
    await page.locator('button:has-text("Next duelist")').click();
    await page.waitForTimeout(900);
    await fs.writeFile(`${OUT}/${String(i).padStart(2, '0')}-random.png`, await page.screenshot({ clip }));
  }
}

await browser.close();
console.log(`character: ${SEAMS ? 'seam' : 'contact'} sheets -> ${OUT}`);
