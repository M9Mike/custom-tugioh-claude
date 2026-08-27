/**
 * Asks the character lab whether the duelist passes through itself.
 *
 * The lab walks the model through the whole stride and again standing, and
 * tests every vertex of every hand, bracer, forearm, boot and shin against
 * every tube it could end up inside of. This just drives that and reports the
 * answer, so the check can be run without a person looking at anything.
 *
 * Exits non-zero on any overlap, so it can be trusted in a script.
 *
 *   npm run clash
 *   npm run clash -- --seed 3
 */

import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};

const BASE = flag('base', 'http://localhost:3000');
const SEED = Number(flag('seed', '0'));
if (!Number.isInteger(SEED) || SEED < 0) {
  console.error(`clash: --seed wants a non-negative integer, got "${flag('seed', '0')}"`);
  process.exit(1);
}
const EXEC = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined /* let Playwright find its own:
  the hard-coded container path does not exist on a developer's machine */;

const browser = await chromium.launch({ executablePath: EXEC });
let bad = 0;
let errors = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.on('pageerror', (e) => {
    console.log('PAGEERROR:', e.message);
    errors++;
  });
  const res = await page.goto(`${BASE}/diag/character`, { waitUntil: 'domcontentloaded' });
  if (!res || !res.ok()) throw new Error(`clash: ${BASE}/diag/character returned ${res ? res.status() : 'nothing'}`);
  await page.waitForSelector('canvas', { timeout: 30000 });
  await page.waitForTimeout(2500);

  for (let i = 0; i < SEED; i++) {
    await page.locator('button:has-text("Next duelist")').dispatchEvent('click');
    await page.waitForTimeout(600);
  }

  /* Every mode that builds its own set of bodies gets audited, so a garment or
     a frame that only clashes on the fourth roll is still caught. */
  const modes = await page.$$eval('button[data-mode]', (els) => els.map((e) => e.dataset.mode));
  for (const mode of modes) {
    await page.locator(`button[data-mode="${mode}"]`).dispatchEvent('click');
    await page.waitForSelector(`button[data-mode="${mode}"][data-on="yes"]`, { timeout: 30000 });
    await page.waitForTimeout(3500);

    /* The lab clears its verdict when the bodies change, so an empty attribute
       here is proof this answer belongs to this mode and not the last one. */
    await page.waitForFunction(() => document.querySelector('[data-clash]')?.getAttribute('data-clash') === '', {
      timeout: 30000,
    });
    await page.locator('[data-clash]').dispatchEvent('click');
    /* The audit blocks the main thread for as long as it takes; poll for the
       answer rather than guessing how long that is. */
    await page.waitForFunction(
      () => (document.querySelector('[data-clash]')?.getAttribute('data-clash') ?? '') !== '',
      { timeout: 300000 }
    );
    const verdict = await page.getAttribute('[data-clash]', 'data-clash');
    const ok = verdict === 'clear';
    if (!ok) bad++;
    console.log(`  ${ok ? '✓' : '✗'} ${mode.padEnd(14)} ${verdict}`);
  }
} finally {
  await browser.close();
}

if (bad || errors) {
  /* Reported apart, because a page error is not a limb inside a limb and
     saying so sends you looking at the model instead of the console. */
  if (errors) console.log(`\nclash: ${errors} page error(s) during the audit.`);
  if (bad) console.log(`\nclash: ${bad} mode(s) with parts inside other parts.`);
  process.exit(1);
}
console.log('\nclash: nothing passes through anything, standing or walking.');
