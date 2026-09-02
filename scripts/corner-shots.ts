/**
 * A photograph of every corner in an area, at full size.
 *
 * `npm run seams` measures the same thing and is the check that gates a
 * commit, but it samples: two metres between standing places, two heights, and
 * a fan of rays. Mike's phone does not sample — he stood in the square and saw
 * daylight through a joint that four green checks had signed off. So this
 * exists to be *looked at*, one frame per corner, and it is not a pass/fail.
 *
 *   npm run corners            every corner listed
 *   npm run corners -- court   the ones whose name says court
 *
 * Frames land in /tmp/corners.
 */

import { chromium, type Page } from 'playwright';
import { mkdirSync } from 'node:fs';
import { AREAS, groundAt, hasStoreys, type AreaId } from '../src/story/areas';
import { standable } from './walkable';
import { BASE, NAME, PINNED_HOUR, ensurePlayer, enterStory, refuseRemote } from './story-setup';

interface Shot {
  name: string; area: AreaId; x: number; z: number; facing: number;
  /** The floor this vantage is written for, when it matters which one. */
  floor?: number;
}

/** North-east is where +x meets −z: `facing` is a yaw, 0 down +z, a quarter turn to +x. */
const NE = (Math.PI * 3) / 4, SE = Math.PI / 4, SW = -Math.PI / 4, NW = -(Math.PI * 3) / 4;
const N = Math.PI, S = 0, E = Math.PI / 2, W = -Math.PI / 2;

const SHOTS: Shot[] = [
  /* The Old Cemetery: the gate, the avenue, the terraces, the far corners. */
  { name: 'cemetery, in at the gate', area: 'old-cemetery', x: 12.4, z: -46, facing: N },
  { name: 'cemetery, up the avenue', area: 'old-cemetery', x: 12.4, z: -24, facing: N },
  { name: 'cemetery, the first terrace', area: 'old-cemetery', x: 12.4, z: -4, facing: N },
  { name: 'cemetery, the oldest ground', area: 'old-cemetery', x: 12.4, z: 24, facing: N },
  { name: 'cemetery, the ossuary', area: 'old-cemetery', x: 21, z: 26, facing: S },
  { name: 'cemetery, across the rows', area: 'old-cemetery', x: -22, z: -30, facing: W },
  { name: 'cemetery, the west grove', area: 'old-cemetery', x: -37.5, z: 30, facing: W },
  { name: 'cemetery, the north-east corner', area: 'old-cemetery', x: 34, z: 44, facing: NE },
  { name: 'cemetery, the south-west corner', area: 'old-cemetery', x: -34, z: -44, facing: SW },
  { name: 'cemetery, the grave with flowers', area: 'old-cemetery', x: 24.6, z: 27, facing: N },
  { name: 'cemetery, the south wall west of the gate', area: 'old-cemetery', x: 12.4, z: -48, facing: W },
  { name: 'cemetery, the south wall east of the gate', area: 'old-cemetery', x: 12.4, z: -48, facing: E },
  { name: 'the shrine, the back gate', area: 'domino-shrine', x: -17.2, z: 19, facing: 0 },
  { name: 'the stairs, walking up to them', area: 'crown-shop', x: 6, z: 2, facing: E },
  { name: 'the stairs, from the atrium', area: 'crown-shop', x: 2, z: 6, facing: SE },
  { name: 'the shop, up at the galleries', area: 'crown-shop', x: 0, z: 0, facing: NE },
  { name: 'the shop, the west gallery from below', area: 'crown-shop', x: -4, z: 0, facing: W },

  { name: 'the podium steps from the side', area: 'black-crown', x: 10, z: -9, facing: E },
  
  /* The two Mike photographed sky through. */
  { name: 'walking into the square from the lane', area: 'black-crown', x: -19, z: -24, facing: S },
  { name: 'the square, from the lane mouth', area: 'black-crown', x: -19, z: -19, facing: S },
  { name: 'the lane mouth, looking west', area: 'black-crown', x: -18, z: -19, facing: W },
  { name: 'the lane mouth, looking east', area: 'black-crown', x: -18, z: -19, facing: E },
  { name: 'the station gate, its north end', area: 'market-row', x: 16, z: -4, facing: E },
  { name: 'the station gate, its south end', area: 'market-row', x: 16, z: 4, facing: E },
  { name: 'the station gate', area: 'market-row', x: 14, z: 0, facing: E },
  { name: 'the station gate, from the side', area: 'market-row', x: 12, z: -3, facing: E },
  { name: 'the crown lane, from the arch', area: 'black-crown', x: -19, z: -44, facing: S },
  { name: 'the crown lane, the east wall', area: 'black-crown', x: -21, z: -34, facing: E },
  { name: 'the crown lane, the west wall', area: 'black-crown', x: -17, z: -34, facing: W },

  /* The first five areas, looked at again with the last three's eyes. */
  { name: 'the shop, from the door', area: 'grandpa-shop', x: 2.6, z: 0.6, facing: N },
  { name: 'the shop, the counter', area: 'grandpa-shop', x: 0, z: 0, facing: N },
  { name: 'the shop, looking back at the door', area: 'grandpa-shop', x: 0, z: -2, facing: S },
  { name: 'Turtle Lane, east to Market Row', area: 'starting-area', x: 4, z: 0.5, facing: E },
  { name: 'Turtle Lane, west to Step Lane', area: 'starting-area', x: -4, z: 4, facing: W },
  { name: 'Turtle Lane, up to the shrine', area: 'starting-area', x: -10.4, z: 8, facing: S },
  { name: 'Step Lane, from the bottom', area: 'step-lane', x: 12.4, z: 0, facing: W },
  { name: 'Step Lane, from the top', area: 'step-lane', x: -13, z: 0, facing: E },
  { name: 'Market Row, east to the crown arch', area: 'market-row', x: 6, z: 0, facing: E },
  { name: 'the shrine, in at the gate', area: 'domino-shrine', x: 0, z: -22, facing: S },
  { name: 'the shrine, the hall', area: 'domino-shrine', x: 0, z: 5, facing: S },
  { name: 'the shrine, from the hall steps', area: 'domino-shrine', x: 0, z: 14, facing: N },
  { name: 'the starting area, from the spawn', area: 'starting-area', x: 0, z: 0, facing: N },
  { name: 'the starting area, looking south', area: 'starting-area', x: 0, z: -4, facing: S },

  /* The square, from the middle of it, at all four of its corners. */
  { name: 'square NE, the pier over the court steps', area: 'black-crown', x: 5, z: -16, facing: NE },
  { name: 'square NW, the lane mouth', area: 'black-crown', x: -8, z: -8, facing: NW },
  { name: 'square SW', area: 'black-crown', x: -8, z: 2, facing: SW },
  { name: 'square SE, the terrace joint', area: 'black-crown', x: 3, z: 8, facing: SE },
  /* The alley, which is two blocks' backs and four more corners. */
  { name: 'alley mouth from the square', area: 'black-crown', x: -17, z: -1.5, facing: W },
  { name: 'alley west end, into the yard', area: 'black-crown', x: -36, z: -1.5, facing: W },
  { name: 'alley, looking back east', area: 'black-crown', x: -30, z: -1.5, facing: E },
  /* The yard. */
  { name: 'yard NW, the north shed', area: 'black-crown', x: -45, z: -14, facing: NW },
  { name: 'yard SW, the south shed', area: 'black-crown', x: -45, z: 9, facing: SW },
  { name: 'yard, the back wall', area: 'black-crown', x: -36, z: -1.5, facing: W },
  /* The lane in, from the archway and from its far end. */
  { name: 'lane from the archway', area: 'black-crown', x: -19, z: -40, facing: S },
  { name: 'lane, looking back at the arch', area: 'black-crown', x: -19, z: -26, facing: N },
  /* The south street, both ends. */
  { name: 'south street, from the square', area: 'black-crown', x: -8, z: 20, facing: S },
  { name: 'south street, far end', area: 'black-crown', x: -8, z: 40, facing: S },
  { name: 'south street, looking back north', area: 'black-crown', x: -8, z: 36, facing: N },
  /* The dice court, which is the newest walls in the block. */
  { name: 'court NW, under the pier', area: 'black-crown', x: 15, z: -12.5, facing: NW },
  { name: 'court NE', area: 'black-crown', x: 26, z: -12.5, facing: NE },
  { name: 'court SE, the shop flank', area: 'black-crown', x: 24, z: -16, facing: SE },
  { name: 'court, from the shop steps', area: 'black-crown', x: 14, z: -14, facing: E },
  /* The podium and the shop front. */
  { name: 'podium, the shop door', area: 'black-crown', x: 8, z: 6, facing: E },
  { name: 'podium south, the terrace', area: 'black-crown', x: 5, z: 7, facing: SE },

  /*
   * And inside.
   *
   * From the middle of the room and not from a metre off each wall: the camera
   * stands back from the duelist, so standing close to a corner to look at it
   * puts the camera *through* that corner and the frame is the inside of a
   * shelf. Two of these were exactly that on the first run.
   */
  { name: 'shop NW corner', area: 'crown-shop', x: 0, z: 0, facing: NW },
  { name: 'shop NE corner', area: 'crown-shop', x: 0, z: 0, facing: NE },
  { name: 'shop SE corner', area: 'crown-shop', x: 0, z: 0, facing: SE },
  { name: 'shop SW corner', area: 'crown-shop', x: 0, z: 0, facing: SW },
  { name: 'shop, the front wall and the way out', area: 'crown-shop', x: 4, z: 0, facing: W },
  { name: 'shop, at the door looking back in', area: 'crown-shop', x: -12, z: 2.5, facing: E },
  { name: 'shop, the north wall and its galleries', area: 'crown-shop', x: -3, z: 6.5, facing: N },
  { name: 'shop, the south wall and its galleries', area: 'crown-shop', x: 0, z: -4, facing: S },
  { name: 'shop, the counter', area: 'crown-shop', x: 0, z: 0, facing: E },
  { name: 'shop, the stair well', area: 'crown-shop', x: 8, z: 4, facing: SE },
];

/**
 * Look up.
 *
 * The camera rests at a pitch of 0.28, which is a third of the frame given to
 * the pavement — fine for walking and useless for this, because every joint
 * Mike photographed was above head height. Dragging is how a player raises it,
 * so the check drags: a hundred and thirty pixels puts `camPitch` on its upper
 * stop and the frame on the roofline, where the holes are.
 */
async function lookUp(page: Page) {
  const size = page.viewportSize();
  const cx = (size?.width ?? 1400) / 2;
  const cy = (size?.height ?? 900) / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(cx, cy - i * 13);
  await page.mouse.up();
  await page.waitForTimeout(500);
}

/** Everybody out of the shot: this is about the world, not about who is in it. */
async function clear(page: Page) {
  for (let i = 0; i < 40; i++) {
    const n = await page.evaluate(() => {
      const w = window as unknown as {
        __scene?: { traverse(fn: (o: { isSkinnedMesh?: boolean; visible: boolean }) => void): void };
      };
      let k = 0;
      w.__scene?.traverse((o) => { if (o.isSkinnedMesh) { o.visible = false; k++; } });
      return k;
    }).catch(() => 0);
    if (n) break;
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const w = window as unknown as {
      __scene?: { traverse(fn: (o: { isSkinnedMesh?: boolean; visible: boolean }) => void): void };
    };
    w.__scene?.traverse((o) => { if (o.isSkinnedMesh) o.visible = false; });
  }).catch(() => {});
}

async function main() {
  refuseRemote();
  await ensurePlayer();
  mkdirSync('/tmp/corners', { recursive: true });
  const only = process.argv.slice(2).filter((a) => !a.startsWith('-') && !/^https?:/.test(a));
  const chosen = only.length
    ? SHOTS.filter((s) => only.some((o) => s.name.includes(o) || s.area.includes(o)))
    : SHOTS;

  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();

  console.log(`\nCorners — ${chosen.length} frame(s) into /tmp/corners\n`);
  let refused = 0;
  for (const s of chosen) {
    /*
     * A vantage nobody can stand in is worse than no vantage.
     *
     * The save API puts a duelist wherever it is told, including inside the
     * podium — and from inside a box every face of it is back-facing and
     * invisible, so the frame comes back with the world apparently missing.
     * An hour went into "the ground under the terrace is gone" before the
     * camera turned out to be a metre inside a plinth. The check that would
     * have said so in a second is the one the walk fill already uses.
     */
    const area = AREAS[s.area];
    /*
     * On the floor the game would put her on, which is always the ground one:
     * walking into an area starts you on the floor you walked in on.
     *
     * And it has to be *that number* and not `NaN`. A solid scoped to a storey
     * is compared against the height you are standing at, and every comparison
     * against `NaN` is false — so asking "is this standable" without a height
     * makes every gallery balustrade in the shop apply on the ground floor, and
     * the guard refuses half the room.
     */
    const floor = hasStoreys(area) ? groundAt(area, s.x, s.z, 0) : Number.NaN;
    if (!standable(area, s.x, s.z, floor)) {
      console.log(`  ⛔ ${s.name} — (${s.x}, ${s.z}) is not somewhere a duelist can stand`);
      refused++;
      continue;
    }
    await fetch(`${BASE}/api/story/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: NAME, world: { area: s.area, x: s.x, z: s.z, facing: s.facing } }),
    }).catch(() => {});
    /* Once more before photographing nothing: a cold area can take longer to
       compile than the wait allows, and a frame of the sign-in card labelled
       "Step Lane, from the top" is worse than a late one. */
    let there = await enterStory(page, s.area, PINNED_HOUR);
    if (!there) there = await enterStory(page, s.area, PINNED_HOUR);
    await clear(page);
    await lookUp(page);
    await page.waitForTimeout(900);
    const slug = s.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    await page.screenshot({ path: `/tmp/corners/${slug}-t${PINNED_HOUR}.png`, timeout: 60000 });
    console.log(`  ${there ? '📸' : '⚠️ '} ${s.name}`);
  }
  await browser.close();
  console.log(refused ? `\n${refused} vantage(s) refused — fix them, they photograph nothing.\n` : '');
}

main();
