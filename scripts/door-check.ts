/**
 * Every door in Domino City, walked through.
 *
 *   npm run doors [baseUrl]
 *
 * `npm run areas` proves the doors line up as arithmetic: the seams agree, the
 * arrivals are somewhere you can stand, `arrivalThrough` hands back the partner's
 * landing. All of that is true of data that never moves a duelist an inch.
 *
 * This is the other half. It puts a real player two metres short of a real door,
 * pushes the stick forward, and asks where they ended up — through the trigger,
 * through the fade, through `enter`, through the rebuild of an entire area, and
 * out the other side. It is the only check in the project that exercises the
 * transition itself rather than the numbers it is made of.
 *
 * ## It walks the list, not a hand-written route
 *
 * Every door in `AREAS` is visited, in both directions, because both directions
 * are separate doors with separate arrivals. Adding an area to the city adds its
 * doors to this run without anybody editing this file — which is the property
 * that matters, since the city is going to be thirty-six of them and the doors
 * are the part nobody looks at twice.
 *
 * ## The approach is derived, not typed
 *
 * Where to stand to walk into a door is worked out from the door: back off from
 * the trigger, along the line from the area's own arrival towards it, far enough
 * to clear the trigger and get a run-up. Hand-picked approach points would be
 * one more set of coordinates to keep in step with geometry that is still moving.
 *
 * Local stores only. It writes a character, a deck and a position, and none of
 * those are things to do to somebody's real save.
 */

import { chromium, type Page } from 'playwright';
import {
  AREAS, PLAYER_RADIUS, arrivalThrough, partnerOf,
  type AreaId, type Door,
} from '../src/story/areas';
import { BASE, NAME, ensurePlayer, enterStory, post } from './story-setup';


let failures = 0;
const check = (ok: boolean, what: string, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${what}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
};

/**
 * Where to stand to walk into this door, and which way to face.
 *
 * Backed off from the trigger along the line the player would come in on, by
 * the trigger's own half-extent in that direction plus a run-up — so it is
 * outside the trigger (standing in one starts the transition before anybody has
 * pressed anything) with room to build up walking speed.
 */
function approach(door: Door): { x: number; z: number; facing: number } {
  let dx = door.trigger.x - door.arrive.x;
  let dz = door.trigger.z - door.arrive.z;
  const len = Math.hypot(dx, dz) || 1;
  dx /= len;
  dz /= len;
  const clear = Math.abs(dx) * door.trigger.hw + Math.abs(dz) * door.trigger.hd + PLAYER_RADIUS + 1.9;
  return {
    x: door.trigger.x - dx * clear,
    z: door.trigger.z - dz * clear,
    facing: Math.atan2(dx, dz),
  };
}

/** The world's live state, or null while it is still building. */
type Probe = { area: AreaId; player: [number, number]; camDist: number; camLift: number };
const probe = (page: Page) =>
  page.evaluate(() => (window as unknown as { __probe?: Probe }).__probe ?? null);

/**
 * Waits for the camera to stop moving, and hands back what it settled to.
 *
 * `camDist` and `camLift` are both eased towards their targets rather than
 * snapped to them, so for about a second after a door the camera is still
 * carrying the last area's framing — step out of the shop and it arrives on the
 * street with the interior's shorter distance, opening out as it goes.
 *
 * Reading either of them in that window measures the transition instead of the
 * arrival, which is exactly what this check got wrong first time out: it
 * reported the shop's own door as putting the camera in a squeeze, at a landing
 * that settles to a perfectly clear 4.5 m about a second later.
 */
async function settleCamera(page: Page): Promise<Probe | null> {
  let last: Probe | null = null;
  for (let i = 0; i < 14; i++) {
    await page.waitForTimeout(200);
    const now = await probe(page);
    if (last && now && Math.abs(now.camDist - last.camDist) < 0.01
        && Math.abs(now.camLift - last.camLift) < 0.005) {
      return now;
    }
    last = now;
  }
  return last;
}

/** Polls until the world reports itself in `want`, or gives up. */
async function waitForArea(page: Page, want: AreaId, ms: number): Promise<Probe | null> {
  const until = Date.now() + ms;
  for (;;) {
    const p = await probe(page);
    if (p && p.area === want) return p;
    if (Date.now() > until) return p;
    await page.waitForTimeout(200);
  }
}

/** Pushes the stick forward for as long as it takes, then lets go. */
async function walkForward(page: Page, ms: number): Promise<void> {
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

/* ------------------------------------------------------------------ */

async function main() {
  console.log(`\nWalking every door in Domino City, against ${BASE}\n`);
  await ensurePlayer();

  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  });
  const context = await browser.newContext({
    viewport: { width: 440, height: 956 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  page.on('pageerror', (err) => check(false, 'the world threw', err.message));

  /*
   * `npm run doors -- shrine` for one area's doors, or one door's name.
   *
   * Every door in the city is nine minutes, because each one is a real page
   * load and a real walk into a trigger. That is the right thing to run before
   * a release and the wrong thing to run eleven times while building one area,
   * which is what it was being used for.
   */
  const only = process.argv.slice(2).filter((a) => !a.startsWith('-') && !/^https?:\/\//.test(a));
  const ids = (Object.keys(AREAS) as AreaId[]).filter(
    (id) => !only.length || only.some((o) => id.includes(o) || AREAS[id].doors.some((d) => d.id.includes(o)))
  );
  if (only.length) console.log(`  (only ${ids.join(', ')})\n`);
  for (const id of ids) {
    for (const door of AREAS[id].doors) {
      const from = approach(door);
      const want = arrivalThrough(door, id);
      const partner = partnerOf(door, id);

      await post('/api/story/save', { username: NAME, world: { area: id, ...from } });
      await enterStory(page, id);

      const start = await waitForArea(page, id, 25000);
      if (!start || start.area !== id) {
        check(false, `${id}/${door.id}: the run-up starts in ${id}`, start?.area ?? 'nothing built');
        continue;
      }

      /* Long enough to cover the run-up at walking pace, plus the fade. */
      /* Three and a bit seconds, not two and a half: the stick ramps in, and
         the run-up to Black Crown's door was finishing three centimetres short
         of its trigger about one run in two. */
      await walkForward(page, 3200);
      const landed = await waitForArea(page, door.to, 12000);

      check(
        landed?.area === door.to,
        `${id}/${door.id}: walking into it reaches ${door.to}`,
        landed ? `stopped in ${landed.area} at ${JSON.stringify(landed.player)}` : 'no probe'
      );
      if (landed?.area !== door.to) continue;

      const settled = (await settleCamera(page)) ?? landed;
      const [px, pz] = settled.player;
      const off = Math.hypot(px - want.x, pz - want.z);
      check(off < 1.2, `${id}/${door.id}: and lands where ${partner?.id ?? '?'} says`,
            `${off.toFixed(2)} m from (${want.x}, ${want.z})`);

      /*
       * And the camera has somewhere to stand when it gets there.
       *
       * `camLift` is what the camera does when it cannot get its distance: it
       * trades the metres it lost for height and looks down over the shoulder.
       * Arriving with it already on means the landing was put too close to a
       * wall, and the player walks through a door into a shot of the top of
       * their own head — which is what both sides of the Market Row arch did
       * before they were moved back, and which nothing but this would have
       * caught.
       *
       * ## Rooms are allowed some, streets are not
       *
       * A shop eleven metres deep cannot give a camera four and a half metres
       * from anywhere near its middle, and it is not supposed to: riding a
       * little higher indoors is the whole reason the lift exists, and the Kame
       * Game Shop's own landing sits at about 0.18 and frames Grandpa and his
       * counter exactly as intended.
       *
       * Outdoors there is no such excuse. An exterior arrival that cannot get
       * its distance is an arrival stood against a building, so that side of it
       * is held to nearly nothing.
       */
      const allowed = AREAS[door.to].kind === 'interior' ? 0.32 : 0.06;
      check(settled.camLift < allowed,
            `${id}/${door.id}: and the camera is not squeezed once it settles`,
            `camLift ${settled.camLift} (${AREAS[door.to].kind} allows ${allowed}), camDist ${settled.camDist}`);
    }
  }

  await browser.close();
  console.log(
    failures === 0
      ? '\nEvery door works. ✅\n'
      : `\n${failures} door problem(s). ❌\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\ndoor check failed to run:', err);
  process.exit(1);
});
