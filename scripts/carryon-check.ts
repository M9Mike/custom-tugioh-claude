/**
 * Whether the world remembers where you were.
 *
 * Mike won a duel and came back to the street the game starts on, a long walk
 * from where he had been standing, and leaving to the main menu and coming
 * back did the same. Nothing was wrong with the save *route*: the world simply
 * never wrote one unless he pressed the Save button. Leaving for a duel fired a
 * write and navigated away in the same tick — which aborts it — and leaving by
 * the menu wrote nothing at all.
 *
 * So "carry on where you left off" quietly meant "carry on wherever you last
 * remembered to press Save", and there was no check that could tell the
 * difference, because every check in here drives the world by *writing* a
 * position and then reading the same one back.
 *
 * This one walks. It puts a duelist down, holds a key until she has gone
 * somewhere, leaves through the game's own menu, comes back in through the
 * game's own front door, and asks where she is.
 *
 *   npm run carryon
 */

import { chromium } from 'playwright';
import { BASE, NAME, PINNED_HOUR, ensurePlayer, enterStory, refuseRemote, walkForward } from './story-setup';

/** How far she has to have moved for the walk to have proved anything. */
const MOVED = 3;
/** How near the place she left she has to come back. */
const NEAR = 2.5;

interface At { area: string; x: number; z: number }

async function where(page: import('playwright').Page): Promise<At | null> {
  return page.evaluate(() => {
    const p = (window as unknown as { __probe?: { area: string; player: [number, number] } }).__probe;
    return p ? { area: p.area, x: p.player[0], z: p.player[1] } : null;
  }).catch(() => null);
}

let failures = 0;
const check = (ok: boolean, what: string, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${what}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

async function main() {
  refuseRemote();
  await ensurePlayer();
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  });
  const page = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage();

  console.log('\nCarry on — walk somewhere, leave, come back\n');

  await fetch(`${BASE}/api/story/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: NAME, world: { area: 'black-crown', x: -8, z: 6, facing: 0 } }),
  }).catch(() => {});
  check(await enterStory(page, 'black-crown', PINNED_HOUR), 'the world opens');
  await page.waitForTimeout(1200);
  const from = await where(page);

  /* Walk, and give the world longer than its own save interval to notice. */
  await walkForward(page, 3000);
  await page.waitForTimeout(5200);
  const to = await where(page);
  const walked = from && to ? Math.hypot(to.x - from.x, to.z - from.z) : 0;
  check(walked > MOVED, 'she went somewhere', `${walked.toFixed(1)} m`);

  /* Out through the menu the player uses, not a reload. */
  await page.locator('button:has-text("Menu")').first().click();
  await page.waitForTimeout(500);
  await page.locator('button:has-text("Return to the Main Menu")').first().click();
  await page.waitForTimeout(2500);

  /* And back in through the front door, without a refresh. */
  await page.locator('a:has-text("Story"), button:has-text("Story")').first().click();
  await page.waitForTimeout(2500);
  /* She is asked to confirm her name, and the name is already in the box — see
     the note in `StoryMode` on why signing her in for her was taken out. */
  const field = page.locator('input[placeholder="Enter your name"]');
  const asked = await field.isVisible().catch(() => false);
  check(!asked || (await field.inputValue().catch(() => '')) === NAME,
        'the name is remembered for her');
  if (asked) {
    if ((await field.inputValue().catch(() => '')) !== NAME) await field.fill(NAME);
    const enter = page.locator('button:has-text("Enter Story Mode")').first();
    for (let i = 0; i < 200 && !(await enter.isEnabled().catch(() => false)); i++) await page.waitForTimeout(200);
    await enter.click();
  }
  for (let i = 0; i < 120 && !(await where(page)); i++) await page.waitForTimeout(250);
  await page.waitForTimeout(1200);
  const back = await where(page);

  check(!!back && !!to && back.area === to.area,
        'she comes back to the area she left', `${to?.area} -> ${back?.area}`);
  const drift = back && to ? Math.hypot(back.x - to.x, back.z - to.z) : Infinity;
  check(drift < NEAR, 'and to the spot she left it from', `${drift.toFixed(1)} m away`);

  await browser.close();
  console.log(failures ? `\n${failures} thing(s) forgotten.\n` : '\nShe carries on where she left off. ✅\n');
  process.exit(failures ? 1 : 0);
}

main();
