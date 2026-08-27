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
  for (let i = 0; i < 60; i++) {
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
  const there = await enterStory(page, v.area);
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
  const page = await (await browser.newContext({ viewport: { width: 900, height: 640 } })).newPage();

  console.log(`\nShimmer — ${(NUDGE * 1000).toFixed(1)} mm of camera, and what it costs\n`);

  for (const v of VANTAGES) {
    const slug = v.name.replace(/[^a-z]+/gi, '-').toLowerCase();
    const a = `/tmp/shimmer/${slug}-a.png`;
    const b = `/tmp/shimmer/${slug}-b.png`;
    const distA = await frame(page, v, 0, a);
    const distB = await frame(page, v, NUDGE, b);
    if (!Number.isFinite(distA) || !Number.isFinite(distB)) {
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
    if (Math.abs(distA - distB) > 0.01) {
      const againA = await frame(page, v, 0, a);
      const againB = await frame(page, v, NUDGE, b);
      if (!Number.isFinite(againA) || !Number.isFinite(againB) || Math.abs(againA - againB) > 0.01) {
        check(false, `${v.area}: ${v.name}`,
              `the camera would not settle in the same place twice — not comparable`);
        continue;
      }
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
