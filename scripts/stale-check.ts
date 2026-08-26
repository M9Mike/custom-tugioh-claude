/**
 * The stale-build guard, checked against the wordings that actually occur.
 *
 *   npm run stale [baseUrl]
 *
 * A tab open across a deploy asks the new build for a chunk the old one hashed,
 * gets a 404, and falls over. `src/app/StaleBuild.tsx` catches that and reloads
 * once. Two things about it are worth asserting and neither is obvious:
 *
 * - **It fires on the right errors.** There is no error *type* for a missing
 *   chunk — every browser words it differently — so the guard matches text, and
 *   matching text is the sort of thing that quietly stops working when a browser
 *   rewords a message. Every string below is one a real browser emits.
 * - **It does not fire on the wrong ones.** A guard that reloads on any error is
 *   a page that reloads in a circle over an ordinary bug, which is worse than
 *   the bug. The negatives here matter more than the positives.
 *
 * And then it is run for real: a page is loaded, a genuine `ChunkLoadError` is
 * thrown inside it, and the reload is counted. Twice, to prove the loop guard
 * holds — because the failure mode of getting that wrong is a page nobody can
 * close.
 */

import { chromium, type Page } from 'playwright';
import { COOLDOWN_MS, isStaleBuild, shouldReload } from '../src/lib/staleBuild';
import { BASE, ensurePlayer, enterStory } from './story-setup';

let failures = 0;
const check = (ok: boolean, what: string, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${what}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
};

/* ---------------------------------------------------------------- */
console.log('\nThe stale-build guard\n');

console.log('it recognises a build that has gone');
{
  /* Every one of these is what a browser actually says. */
  const real: [string, string, string][] = [
    ['Chromium, a webpack chunk', 'ChunkLoadError', 'Loading chunk 4821 failed.\n(missing: https://shadow-duel.vercel.app/_next/static/chunks/4821.js)'],
    ['Chromium, a dynamic import', 'TypeError', 'Failed to fetch dynamically imported module: https://shadow-duel.vercel.app/_next/static/chunks/app/story/page.js'],
    ['Firefox, a dynamic import', 'TypeError', 'error loading dynamically imported module'],
    ['Safari, a module script', 'TypeError', 'Importing a module script failed.'],
    ['a stylesheet chunk', 'ChunkLoadError', 'Loading CSS chunk 12 failed.'],
  ];
  for (const [who, name, message] of real) {
    check(isStaleBuild(message, name), `${who}`);
  }
}

console.log('\nand leaves every other kind of error alone');
{
  const ordinary: [string, string, string][] = [
    ['a plain bug in our own code', 'TypeError', "Cannot read properties of undefined (reading 'slug')"],
    ['a failed API call', 'TypeError', 'NetworkError when attempting to fetch resource.'],
    ['a rules error', 'Error', 'Ra cannot be summoned from the graveyard'],
    ['a syntax error', 'SyntaxError', "Unexpected token '<'"],
    ['WebGL falling over', 'Error', 'THREE.WebGLRenderer: Context Lost.'],
    ['an aborted request', 'AbortError', 'The operation was aborted.'],
    ['nothing at all', '', ''],
  ];
  for (const [who, name, message] of ordinary) {
    check(!isStaleBuild(message, name), `${who} does not trigger a reload`);
  }
  check(!isStaleBuild(undefined, undefined), 'and neither does an error with no message');
}

console.log('\nand it reloads once, not for ever');
{
  const now = 1_700_000_000_000;
  check(shouldReload(now, null), 'the first failure reloads');
  check(!shouldReload(now, String(now - 1_000)), 'a second one a second later does not');
  check(!shouldReload(now, String(now - (COOLDOWN_MS - 1))), 'nor one just inside the cooldown');
  check(shouldReload(now, String(now - (COOLDOWN_MS + 1))), 'but one after it does');
  check(shouldReload(now, 'nonsense'), 'and an unreadable stamp counts as never having tried');
}

/* ---------------------------------------------------------------- */

async function live() {
  console.log('\nand it does it in a real browser');
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  });
  const page = await (await browser.newContext()).newPage();

  let loads = 0;
  page.on('load', () => { loads++; });

  await page.goto(BASE, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(1500);
  const afterFirst = loads;

  /* A real one: thrown from a timeout so it reaches `window.onerror` the same
     way a failed chunk does, rather than being caught by the caller. */
  const throwChunkError = () =>
    page.evaluate(() => {
      setTimeout(() => {
        const err = new Error('Loading chunk 4821 failed.');
        err.name = 'ChunkLoadError';
        throw err;
      }, 0);
    });

  await throwChunkError();
  for (let i = 0; i < 40 && loads === afterFirst; i++) await page.waitForTimeout(250);
  check(loads === afterFirst + 1, 'a missing chunk reloads the page once',
        `${loads - afterFirst} reload(s)`);

  /* Immediately again: inside the cooldown, so nothing should happen. */
  await page.waitForTimeout(1200);
  const afterReload = loads;
  await throwChunkError();
  await page.waitForTimeout(4000);
  check(loads === afterReload, 'and a second failure inside the cooldown does not',
        `${loads - afterReload} extra reload(s)`);

  await browser.close();
}

/**
 * The whole rescue, from a player's side.
 *
 * The other half of the fix and the half that is easy to leave out: reloading
 * gets the right build, and then Story Mode comes back on its sign-in card
 * asking who you are. From the player's chair that is still "I pressed Save and
 * got thrown out" — the world just happens to be the right one this time.
 *
 * So this walks it: reach the open world, take the build away underneath it, and
 * assert that the player ends up back in the open world having pressed nothing.
 */
async function rescued() {
  console.log('\nand the player ends up back where they were');
  await ensurePlayer();

  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  });
  const page = await (await browser.newContext({ viewport: { width: 430, height: 932 } })).newPage();
  let loads = 0;
  page.on('load', () => { loads++; });

  const inWorld = async (p: Page) =>
    p.evaluate(() => !!(window as unknown as { __probe?: unknown }).__probe).catch(() => false);

  const arrived = await enterStory(page);
  check(arrived, 'the world is open to begin with');

  if (arrived) {
    const before = loads;
    await page.evaluate(() => {
      setTimeout(() => {
        const err = new Error('Loading chunk 4821 failed.');
        err.name = 'ChunkLoadError';
        throw err;
      }, 0);
    });

    /*
     * The reload has to actually happen before the world coming back means
     * anything.
     *
     * Without this the check passes on the *old* page: `__probe` is still on
     * `window` for the few hundred milliseconds between throwing and the browser
     * tearing the document down, so the first poll sees a world, says yes, and
     * proves nothing at all.
     */
    let reloaded = false;
    for (let i = 0; i < 60 && !reloaded; i++) {
      await page.waitForTimeout(250);
      reloaded = loads > before;
    }
    check(reloaded, 'the page reloads out from under the world');

    /* And then: no clicking, no typing, no filling anything in. */
    let back = false;
    for (let i = 0; i < 240 && reloaded; i++) {
      await page.waitForTimeout(250);
      if (await inWorld(page)) { back = true; break; }
    }
    check(back, 'and the player is back in it, untouched',
          back ? '' : 'left on the sign-in card');
  }

  await browser.close();
}

live()
  .then(rescued)
  .then(() => {
    console.log(
      failures === 0
        ? '\nThe guard holds. ✅\n'
        : `\n${failures} problem(s) with the stale-build guard. ❌\n`
    );
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error('\nstale check failed to run:', err);
    process.exit(1);
  });
