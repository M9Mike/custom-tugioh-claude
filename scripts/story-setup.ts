import type { Page } from 'playwright';
import { STARTER_POOL } from '../src/story/roster';

/**
 * A signed-in duelist with a sleeved deck, so a check can reach the open world.
 *
 * Both browser checks need the same three things before they can start — an
 * account, a character bound to it and twenty-five cards — and neither of them
 * is about any of that. Worse, the Story Mode end-to-end deletes the character
 * on its way out (that is the one sanctioned way back, and it is what lets the
 * next phone run the whole journey), so whichever check runs after it arrives to
 * an empty account and stalls in the creation booth.
 *
 * Which is exactly what happened: `npm run footing` had no setup of its own and
 * reported an area as "never reached" the first time it ran after the e2e.
 *
 * Local stores only. This writes a character and a deck, and neither is a thing
 * to do to somebody's real save.
 */

/*
 * A URL, or nothing. Not "the first argument that is not a flag".
 *
 * Scripts that share this also take arguments of their own — `npm run walk --
 * gates`, `npm run shimmer -- "up the steps"` — and under the old rule the first
 * of those became the target host. `walk -- gates` set BASE to `gates`, which
 * the guard below then refused as a deployment. The filter that was documented
 * in both of those scripts did not work and could not have.
 */
const BASE_ARG = process.argv.slice(2).find((a) => /^https?:\/\//.test(a));
export const BASE = BASE_ARG ?? 'http://localhost:3000';

/**
 * The hour every check runs at, unless it says otherwise.
 *
 * The world has a day/night cycle now, and a check that compares two frames a
 * millimetre apart cannot have the sun move between them — nor can a screenshot
 * that is meant to be comparable with last week's. `?t=` pins it, and this is
 * the default: late afternoon, which is the one hour with a real sun in the sky
 * *and* the long shadows that find every fault in a wall.
 *
 * Pass `--hour=1` to a script to sweep the night instead.
 */
export const PINNED_HOUR = (() => {
  const flag = process.argv.slice(2).find((a) => a.startsWith('--hour='));
  const n = flag ? Number(flag.slice(7)) : NaN;
  return Number.isFinite(n) ? n : 16;
})();
export const NAME = 'Mike';

/**
 * Refuses anything that is not a local store, and refuses it here.
 *
 * The guard used to sit at the top of `door-check.ts`, which protected exactly
 * the script that happened to have it — `footing-check.ts` was written later,
 * writes the same character, the same deck and the same position, and had none.
 * A rule that has to be copied into each new check is a rule that is one new
 * check away from being missed, and the thing it is protecting is somebody's
 * only duelist.
 *
 * So it lives with the writing. Anything that imports this to set a player up
 * cannot get past this line pointed at a deployment.
 */
export function refuseRemote(): void {
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE)) return;
  console.error(
    `\nRefusing to run against ${BASE}.\n\n` +
    `This writes a character, a deck and a world position against "${NAME}".\n` +
    `Against a deployment those are a real player's, and there is no flag for\n` +
    `that because a flag is a thing you can forget.\n`
  );
  process.exit(1);
}

/** As much of a story route's reply as this script ever looks at. */
interface Reply {
  ok?: boolean;
  error?: string;
  profile?: {
    character?: unknown;
    deck?: unknown;
    collection?: string[];
  };
}

export const post = async (path: string, body: unknown): Promise<Reply> => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<Reply>;
};

/** A duelist and a sleeved deck, so the run reaches the world. */
export async function ensurePlayer(): Promise<void> {
  refuseRemote();
  const seen = await post('/api/story/login', { username: NAME });
  if (!seen.ok) throw new Error(`cannot sign in as ${NAME}: ${seen.error ?? 'unknown'}`);

  if (!seen.profile?.character) {
    const made = await post('/api/story/character', {
      username: NAME,
      character: { model: 'sandra-afrika', name: NAME, stature: 0.5, tints: [] },
    });
    if (!made.ok) throw new Error(`cannot make a duelist: ${made.error}`);
  }

  const now = await post('/api/story/login', { username: NAME });
  const deckNow = now.profile?.deck;
  if (!Array.isArray(deckNow) || deckNow.length !== 25) {
    /* The first deck is cut from the starter pool, not from the collection —
       the collection is still empty at this point, which is the whole reason
       the pool exists. Afterwards it is the collection, and by then there is
       already a deck and this branch does not run. */
    const owned: string[] = now.profile?.collection ?? [];
    const deck = (owned.length >= 25 ? owned : STARTER_POOL).slice(0, 25);
    const sleeved = await post('/api/story/deck', { username: NAME, deck });
    if (!sleeved.ok) throw new Error(`cannot sleeve a deck: ${sleeved.error}`);
  }
}




/**
 * Opens Story Mode and waits until the world is actually built.
 *
 * Every browser check had its own copy of this and every copy had the same bug:
 * `fill(NAME)` on the sign-in field. It works on the first load, when the field
 * is empty — and on every load after that the field has already been filled in
 * from `localStorage`, and filling a controlled React input that is not empty
 * leaves you signed in as "MikeMike", which is not a duelist. Whichever check
 * happened to reload landed on the sign-in card with a red error and reported
 * whatever nonsense followed from that.
 *
 * So the name is only typed when it is wrong, and the wait is for the *scene*
 * rather than for the canvas — a canvas exists while the world is still being
 * built, and auditing a half-built area is worse than not auditing it.
 */
/**
 * Walks her forward, by the stick a player would use.
 *
 * Not `keyboard.down('w')`. The key works when the page happens to have focus
 * and does nothing when it does not, which in a check that has just navigated
 * is a coin toss — the carry-on check reported her walking 3.1 m, then 2.8, then
 * 0.9, then 0.7, off identical code, and the stairs sweep called a flight
 * "never got going" for the same reason. The door check has always driven the
 * stick and has never once been flaky. So this is that, shared.
 */
export async function walkForward(page: Page, ms: number): Promise<void> {
  const box = await page.locator('[aria-label="Move"]').boundingBox();
  if (!box) throw new Error('the thumb stick is not on screen');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, box.y - 40, { steps: 8 });
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

export async function enterStory(page: Page, area?: string, hour = PINNED_HOUR): Promise<boolean> {
  await page.goto(`${BASE}/story?t=${hour}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  /*
   * Sign in if asked, and do not mind if the card goes away mid-sentence.
   *
   * Story Mode remembers, for the life of a tab, that this session has already
   * said who it is — so the second and later visits inside one browser context
   * go straight through and the card is gone between `isVisible` and the click.
   * Every one of these checks enters the world a dozen times, and a race that
   * throws in the setup fails a check that has nothing wrong with it. Which is
   * what it did: `npm run doors` died on the fourth door with a timeout waiting
   * for a name box that had already served its purpose.
   */
  const field = page.locator('input[placeholder="Enter your name"]');
  if (await field.isVisible().catch(() => false)) {
    try {
      if ((await field.inputValue()) !== NAME) {
        await field.fill('');
        await field.fill(NAME);
      }
      const enter = page.locator('button:has-text("Enter Story Mode")').first();
      for (let i = 0; i < 200 && !(await enter.isEnabled().catch(() => false)); i++) {
        await page.waitForTimeout(200);
      }
      await enter.click({ timeout: 5000 });
    } catch {
      /* Signed in while we were typing. The wait below is the real test. */
    }
  }
  for (let i = 0; i < 250; i++) {
    const there = await page
      .evaluate((want) => {
        const w = window as unknown as { __scene?: unknown; __probe?: { area: string } };
        return !!w.__scene && (!want || w.__probe?.area === want);
      }, area ?? null)
      .catch(() => false);
    if (there) {
      /*
       * And wait for the duelist herself.
       *
       * The area being built is not the same thing as the game being ready to
       * play: a duelist is a *fetch*, and until her rig lands there is nobody
       * for a keypress to move. Checks that hold a key down — the stairs, the
       * carry-on — were pressing it into an empty world and reporting "she did
       * not move", and the seam sweep read "never reached" off the same race.
       * Every one of those was the harness, not the game.
       */
      for (let k = 0; k < 80; k++) {
        const rigged = await page.evaluate(() => {
          const w = window as unknown as { __scene?: { traverse(f: (o: { isSkinnedMesh?: boolean }) => void): void } };
          let n = 0;
          w.__scene?.traverse((o) => { if (o.isSkinnedMesh) n++; });
          return n;
        }).catch(() => 0);
        if (rigged > 0) break;
        await page.waitForTimeout(250);
      }
      await page.waitForTimeout(700);
      return true;
    }
    await page.waitForTimeout(200);
  }
  return false;
}
