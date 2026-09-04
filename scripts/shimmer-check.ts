/**
 * How much of the picture changes when the camera moves a millimetre.
 *
 *   npm run shimmer [baseUrl]
 *
 * ## What this measures that nothing else could
 *
 * `npm run coplanar` finds two surfaces at the same depth. That is one cause of
 * "it flickers when I move" and it turned out not to be the common one. The
 * others do not live in the geometry at all:
 *
 * - a texture whose detail lands at about the size of a pixel, so which parts of
 *   it win changes as you walk — brick was doing this, at ±22% between adjacent
 *   bricks;
 * - shadow acne on a surface edge-on to the light;
 * - anything sub-pixel and high contrast, which is most railings, mullions and
 *   mortar seen from far enough away.
 *
 * All of them share one signature: **the frame changes far more than the camera
 * did.** Move 1.2 mm and honest geometry barely shifts — a millimetre of parallax
 * at ten metres is a hundredth of a pixel — so anything that flips is something
 * that was never stable to begin with. That is the whole test, and it needs no
 * theory about *why*.
 *
 * ## Reading the number
 *
 * A few tenths of a percent is the edges of things resolving differently under
 * multisampling, and is fine. A percent and up is a surface crawling, and you can
 * see exactly which one: every run writes its difference image to `/tmp/shimmer`,
 * white where the pixel flipped. That picture is what identified brick — not the
 * count, the *shape* of what was flashing.
 *
 * Vantage points avoid door triggers on purpose: cross one and the second shot is
 * taken in a different area, which reads as 76% of the frame changing and means
 * nothing at all.
 *
 * People are hidden for the same reason. An idle animation advances between two
 * page loads however carefully they are timed, so a duelist standing in shot
 * flips their whole silhouette and swamps everything the test is actually for —
 * the first run of this blamed the far gates for what was entirely Mike breathing.
 * Characters are the only skinned meshes in the world, which makes them exactly
 * one line to exclude.
 */

import { chromium, type Page } from 'playwright';
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import type { AreaId } from '../src/story/areas';
import { BASE, NAME, ensurePlayer, enterStory } from './story-setup';

/** A millimetre and a bit: far below any real parallax, far above nothing. */
const NUDGE = 0.0012;

/** Greyscale steps. Below this is dithering; above it the pixel changed. */
const CHANGED = 22;

/**
 * How much of a frame may flip.
 *
 * With the people out of it this is measuring the world alone. Before brick was
 * calmed the arch was at 1.07%; a view with nothing wrong in it sits in the low
 * tenths.
 */
const LIMIT = 0.006;

interface Vantage {
  name: string;
  area: AreaId;
  x: number;
  z: number;
  facing: number;
}

const VANTAGES: Vantage[] = [
  { name: 'the arch from the street', area: 'starting-area', x: 12, z: 0.5, facing: Math.PI / 2 },
  { name: 'the terraces, looking west', area: 'starting-area', x: 6, z: 0.5, facing: -Math.PI / 2 },
  { name: 'down the arcade', area: 'market-row', x: -15, z: 0, facing: Math.PI / 2 },
  { name: 'the far gates', area: 'market-row', x: 16, z: 0, facing: Math.PI / 2 },
  { name: 'the shopfronts, close', area: 'market-row', x: -8.5, z: -2, facing: Math.PI },
  /* Along a row rather than across it: a shopfront seen at a shallow angle is
     the case that needs more anisotropy than any hardware gives, and it is what
     put bare brick inside the street's archway on this list in the first place. */
  { name: 'along the north shopfronts', area: 'market-row', x: -4, z: -3.6, facing: Math.PI / 2 },
  { name: 'the arch from inside', area: 'market-row', x: -18.5, z: 0, facing: -Math.PI / 2 },
  /*
   * And two looking *along* a brick wall rather than at it.
   *
   * Grazing is where a repeating pattern aliases worst — each pixel covers a
   * long thin strip of texture, so the filter has the most averaging to do and
   * the least budget to do it with. Facing a wall square on, brick was already
   * within tolerance while it was still crawling from the side.
   */
  { name: 'along the east wall', area: 'starting-area', x: 16.4, z: 7.5, facing: Math.PI },
  { name: 'along the north terrace', area: 'starting-area', x: -14, z: -7.6, facing: Math.PI / 2 },
  /* And the hill, from the bottom looking up it and from the top looking back
     down — the two shots that only exist because the ground is not flat. */
  { name: 'up the steps', area: 'step-lane', x: 14.6, z: 0, facing: -Math.PI / 2 },
  { name: 'down the steps', area: 'step-lane', x: -12, z: 0, facing: Math.PI / 2 },
  /* And the precinct: the first area with a real horizon in three directions,
     and the first whose gravel is thousands of small things at once. */
  { name: 'up the shrine steps', area: 'domino-shrine', x: 0, z: -21.4, facing: 0 },
  { name: 'across the precinct', area: 'domino-shrine', x: -6, z: 0, facing: Math.PI / 2 },
  { name: 'the hall', area: 'domino-shrine', x: 0, z: 2, facing: 0 },
  /* The off-path finds. This area is big enough that the path is a small part
     of it, and the corners nobody is steered towards get looked at hardest. */
  { name: 'the basin, west', area: 'domino-shrine', x: -12.4, z: -6.5, facing: -Math.PI / 2 },
  { name: 'the plaque rack, east', area: 'domino-shrine', x: 12.2, z: -9, facing: Math.PI / 2 },
  { name: 'the lantern avenue, along it', area: 'domino-shrine', x: -5.6, z: -15.5, facing: 0 },
  { name: 'the little shrine in the trees', area: 'domino-shrine', x: 22.5, z: 8.6, facing: 0 },
  { name: 'the stone behind the hall', area: 'domino-shrine', x: 0, z: 18.2, facing: 0 },

  /* Black Crown: one vantage per place, and the two flights from below, which
     is where a step's nosing crawls if it is going to. */
  { name: 'down the lane', area: 'black-crown', x: -19, z: -40, facing: 0 },
  { name: 'the square, at the shop', area: 'black-crown', x: -4, z: 2, facing: Math.PI / 2 },
  { name: 'the shop steps from below', area: 'black-crown', x: 3, z: 2, facing: Math.PI / 2 },
  { name: 'the dice court', area: 'black-crown', x: 6, z: -16, facing: Math.PI / 2 },
  { name: 'the south street', area: 'black-crown', x: -8, z: 24, facing: 0 },
  { name: 'the alley west', area: 'black-crown', x: -24, z: -1.5, facing: -Math.PI / 2 },
  { name: 'the yard', area: 'black-crown', x: -44, z: -1.5, facing: -Math.PI / 2 },
  { name: 'the square, looking back', area: 'black-crown', x: -8, z: 6, facing: Math.PI },

  /* Inside Black Crown. The galleries cannot be reached by putting a duelist on
     one — arriving in a building starts you on the floor you walked in on — so
     these are the views from the floor that have three storeys of geometry in
     them, which is where a shelf edge would crawl if it were going to. */
  /* The Old Cemetery: the avenue, a row of stones, and the ossuary. */
  { name: 'up the avenue', area: 'old-cemetery', x: 12.4, z: -40, facing: 0 },
  { name: 'along a row of stones', area: 'old-cemetery', x: -21, z: -30, facing: 0 },
  { name: 'the ossuary porch', area: 'old-cemetery', x: 21, z: 30, facing: 0 },

  /* Domino Station: the hall, the gate line, the shed both ways, a platform
     edge against a train and one against an empty road, and the terrace. */
  { name: 'the hall from the lobby', area: 'domino-station', x: -40, z: 30, facing: Math.PI / 2 },
  { name: 'the gate line', area: 'domino-station', x: 0, z: 24, facing: Math.PI },
  { name: 'up the middle platform', area: 'domino-station', x: 0, z: 4, facing: Math.PI },
  { name: 'back down the shed', area: 'domino-station', x: 0, z: -40, facing: 0 },
  { name: 'beside the green train', area: 'domino-station', x: -32, z: -20, facing: Math.PI },
  { name: 'over the empty road', area: 'domino-station', x: -13.5, z: -20, facing: Math.PI / 2 },
  { name: 'the terrace over the hall', area: 'domino-station', x: 0, z: 40, facing: Math.PI },

  { name: 'the shop, from the mat', area: 'crown-shop', x: -11.5, z: 0, facing: Math.PI / 2 },
  { name: 'the shop, under the galleries', area: 'crown-shop', x: -12, z: -8, facing: Math.PI / 2 },
  { name: 'the shop counter', area: 'crown-shop', x: 6, z: 6, facing: Math.PI / 4 },
  { name: 'the shop stair', area: 'crown-shop', x: 14.2, z: 12, facing: Math.PI },
  { name: 'the shop counter', area: 'grandpa-shop', x: 2.6, z: 2.6, facing: Math.PI },
];

let failures = 0;
const check = (ok: boolean, what: string, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${what}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

/**
 * Waits for the camera to stop moving.
 *
 * It does not arrive where it is going — it eases there, and against a wall it
 * eases twice: once for the distance the geometry allows and once for the height
 * it trades for it. A fixed wait is a bet on that being over, and at the street's
 * archway it is not: two shots of an identical scene measured 0.24% apart on one
 * run and 1.84% on the next, which is the check reporting on its own timing
 * rather than on the world.
 *
 * So it watches `camDist` until it stops changing, and the number it returns is
 * how far back the camera actually ended up — which is also what tells you the
 * two frames were taken from the same place.
 */
async function settled(page: Page): Promise<number> {
  let last = Number.NaN;
  for (let i = 0; i < 120; i++) {
    const now = await page
      .evaluate(() => (window as unknown as { __probe?: { camDist?: number } }).__probe?.camDist ?? Number.NaN)
      .catch(() => Number.NaN);
    if (Number.isFinite(now) && Number.isFinite(last) && Math.abs(now - last) < 0.0004) return now;
    last = now;
    await page.waitForTimeout(200);
  }
  return last;
}

async function frame(page: Page, v: Vantage, dx: number, file: string) {
  await fetch(`${BASE}/api/story/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: NAME,
      world: { area: v.area, x: v.x + dx, z: v.z, facing: v.facing },
    }),
  }).catch(() => {});
  /* Twice before giving up. A cold area can take longer to compile than the
     wait allows, and "never finished building" is then a fact about the machine
     rather than about the world — see the note in `stairs-check.ts`. */
  let there = await enterStory(page, v.area);
  if (!there) there = await enterStory(page, v.area);
  const dist = await settled(page);

  /*
   * Everybody out of the shot: the world is what is being measured.
   *
   * Waited for rather than fired once, because a duelist is a *fetch*. The area
   * is built and the camera has settled long before the model lands, so hiding
   * on a timer hides nothing and then the rig walks into frame — which is how
   * the arch measured 0.24% on one run and 1.84% on the next off identical code.
   * Both numbers were about whether Mike had finished loading.
   */
  let hidden = 0;
  for (let i = 0; i < 60 && hidden === 0; i++) {
    hidden = await page.evaluate(() => {
      const w = window as unknown as {
        __scene?: { traverse(fn: (o: { isSkinnedMesh?: boolean; visible: boolean }) => void): void };
      };
      let n = 0;
      w.__scene?.traverse((o) => { if (o.isSkinnedMesh) { o.visible = false; n++; } });
      return n;
    }).catch(() => 0);
    if (hidden === 0) await page.waitForTimeout(250);
  }
  /* And again after a beat, in case a second one arrived behind the first. */
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const w = window as unknown as {
      __scene?: { traverse(fn: (o: { isSkinnedMesh?: boolean; visible: boolean }) => void): void };
    };
    w.__scene?.traverse((o) => { if (o.isSkinnedMesh) o.visible = false; });
  }).catch(() => {});

  await page.screenshot({ path: file, timeout: 60000 });
  return there && hidden > 0 ? dist : Number.NaN;
}

async function main() {
  mkdirSync('/tmp/shimmer', { recursive: true });
  await ensurePlayer();
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  });

  console.log(`\nShimmer — ${(NUDGE * 1000).toFixed(1)} mm of camera, and what it costs\n`);

  /* `npm run shimmer -- steps` for just the views whose name says "steps".
     Twenty vantages is three minutes, which is three minutes per attempt at
     one of them. */
  const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const chosen = only.length
    ? VANTAGES.filter((v) => only.some((o) => v.name.includes(o) || v.area.includes(o)))
    : VANTAGES;
  for (const v of chosen) {
    const slug = v.name.replace(/[^a-z]+/gi, '-').toLowerCase();
    const a = `/tmp/shimmer/${slug}-a.png`;
    const b = `/tmp/shimmer/${slug}-b.png`;
    /*
     * A context per vantage, and both frames inside it.
     *
     * Twelve vantages is twenty-four worlds built in one browser, and a browser
     * keeps only so many WebGL contexts alive — the oldest is dropped, its page
     * stops rendering, and this reports "the area never finished building" for
     * whichever vantage was holding it. A different one every run, which is
     * what running out of something looks like rather than what a fault looks
     * like. `npm run stairs` had the same tell for the same reason.
     */
    const ctx = await browser.newContext({ viewport: { width: 900, height: 640 } });
    const page = await ctx.newPage();
    const distA = await frame(page, v, 0, a);
    const distB = await frame(page, v, NUDGE, b);
    if (!Number.isFinite(distA) || !Number.isFinite(distB)) {
      await ctx.close();
      check(false, `${v.area}: ${v.name}`, 'the area never finished building');
      continue;
    }
    /*
     * If the camera did not come to rest in the same place both times, whatever
     * the pixels say is about that and not about the world — so take the frames
     * again rather than reporting a number that means nothing.
     *
     * It happens under load: run this behind three other browser jobs sharing
     * one dev server and two views will fail on timing that pass on their own,
     * seconds later, by a factor of six. A check that cries wolf when the
     * machine is busy is a check people learn to ignore.
     */
    let okA = distA;
    let okB = distB;
    /* Three goes, not one. Twenty vantages back to back is exactly the load
       this is describing, and one retry was still losing a view to it about
       half the time — while the same view passes alone, three times running. */
    for (let tries = 0; tries < 3 && Math.abs(okA - okB) > 0.01; tries++) {
      okA = await frame(page, v, 0, a);
      okB = await frame(page, v, NUDGE, b);
    }
    if (!Number.isFinite(okA) || !Number.isFinite(okB) || Math.abs(okA - okB) > 0.01) {
      check(false, `${v.area}: ${v.name}`,
            `the camera would not settle in the same place twice — not comparable`);
      continue;
    }

    const A = await sharp(a).greyscale().raw().toBuffer({ resolveWithObject: true });
    const B = await sharp(b).greyscale().raw().toBuffer();
    const w = A.info.width;
    const h = A.info.height;
    const diff = Buffer.alloc(w * h);
    let flipped = 0;
    for (let i = 0; i < w * h; i++) {
      const d = Math.abs(A.data[i] - B[i]);
      diff[i] = d > CHANGED ? 255 : 0;
      if (d > CHANGED) flipped++;
    }
    await sharp(diff, { raw: { width: w, height: h, channels: 1 } })
      .png()
      .toFile(`/tmp/shimmer/${slug}-diff.png`);

    const share = flipped / (w * h);
    check(
      share <= LIMIT,
      `${v.area}: ${v.name}`,
      `${(share * 100).toFixed(2)}% of the frame flipped (limit ${(LIMIT * 100).toFixed(1)}%)`
    );
    await ctx.close();
  }

  await browser.close();
  console.log(
    failures === 0
      ? '\nNothing crawls. ✅\n'
      : `\n${failures} view(s) shimmer — look at /tmp/shimmer/*-diff.png to see what. ❌\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nshimmer check failed to run:', err);
  process.exit(1);
});
