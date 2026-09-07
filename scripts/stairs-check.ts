/**
 * Whether a duelist's feet stay on the stairs while she is walking up them.
 *
 * `npm run footing` samples a grid and asks whether each cell has a floor under
 * it. That is a question about the world standing still, and every stair in
 * this game passed it while Mike was watching his own feet disappear into the
 * stone going up the shop steps.
 *
 * The fault was not in the geometry. The duelist's height is eased towards the
 * ground under her — which is right, it is what stops a kerb snapping her up —
 * and an exponential ease does not lag by a fixed amount, it lags by *speed
 * over rate*. On the flat that is nothing. On a slope it settles at a constant
 * error and stays there for as long as the slope does: Black Crown's shop steps
 * rise 1.62 m over 4 m of run, so at a full stick she climbs at 1.34 m a second
 * and walks the whole flight eleven centimetres under the treads.
 *
 * Which is a thing you can only see by *moving*. So this holds a key down, runs
 * her up each flight in the game, and compares the height she is drawn at with
 * the height of the step under her.
 *
 *   npm run stairs
 *   npm run stairs -- crown
 */

import { chromium, type Page } from 'playwright';
import { AREAS, groundAt, type AreaId } from '../src/story/areas';
import { BASE, NAME, PINNED_HOUR, ensurePlayer, enterStory, refuseRemote, walkBack, walkForward } from './story-setup';

/** How far under the step a foot may go before it is inside it. */
const ALLOWED = 0.035;

/** And how much height a flight has to actually gain (or lose) to be one. */
const GAINED = 0.05;

interface Flight {
  name: string;
  area: AreaId;
  /** Where to stand, and which way to walk. */
  x: number;
  z: number;
  facing: number;
  /** How long to hold the key, in seconds. */
  hold: number;
  /**
   * Which way this flight goes.
   *
   * Because "her feet are on the step" is not the same claim as "she climbed",
   * and until this was here the sweep only ever made the first one — against
   * the game's own answer, at that: `near` is the y the game reported a moment
   * ago, so a duelist standing at zero *under* a flight is compared with
   * `groundAt(…, 0)`, which is also zero, and the check says "0.0 cm under the
   * step" about somebody in a stairwell with the stairs over her head. Both
   * of the school's towers were started a metre and a third up their own
   * flight and it passed three times.
   */
  goes: 'up' | 'down';
  /**
   * Seconds of climbing before the walk that is measured, for a flight whose
   * top cannot be spawned on to.
   *
   * A save carries x, z and a facing but no floor, and under the landing of a
   * multi-storey building the ground is the ground: there is no way to ask to
   * start up there. So she walks up first and then walks *back*, which needs
   * no teleport — `__teleport` re-grounds with `standingOn` and would drop her
   * through the floor she had just climbed to.
   */
  upFirst?: number;
}

const FLIGHTS: Flight[] = [
  { name: 'Black Crown, up to the shop', area: 'black-crown', x: 6.5, z: 1.75, facing: Math.PI / 2, hold: 2.2, goes: 'up' },
  /* Up it and back down it, from the same place as the leg above. At x 13.5
     she was on the lower level looking at the podium's face, not on top of it:
     `groundAt` there is zero and she walked into the stone at 11.66. */
  { name: 'Black Crown, down to the shop', area: 'black-crown', x: 6.5, z: 1.75, facing: Math.PI / 2, hold: 2.4, goes: 'down', upFirst: 3.0 },
  /* From 12.2 and not 13.5: this drop is two steps in one metre of run, and
     from 13.5 the stick has not finished ramping in before the samples do. */
  { name: 'Black Crown, down to the court', area: 'black-crown', x: 12.2, z: -15.95, facing: -Math.PI / 2, hold: 3.0, goes: 'down' },
  { name: 'Black Crown, up from the court', area: 'black-crown', x: 9.5, z: -15.95, facing: Math.PI / 2, hold: 2.0, goes: 'up' },
  /* At the foot of the flight, walking up it. From z 11.9 facing north she
     was standing on the shop floor *under* the gallery, at the top end of a
     stair she then walked into the side of: one metre covered and blocked. */
  { name: 'the shop, up to the first gallery', area: 'crown-shop', x: 14.2, z: -1.0, facing: 0, hold: 6.0, goes: 'up' },
  { name: 'the shrine, up the great flight', area: 'domino-shrine', x: 0, z: -21.5, facing: 0, hold: 2.4, goes: 'up' },
  { name: 'the shrine, up to the hall', area: 'domino-shrine', x: 0, z: 3.5, facing: 0, hold: 3.0, goes: 'up' },
  { name: 'the cemetery, up to the middle terrace', area: 'old-cemetery', x: 12.4, z: -18, facing: 0, hold: 4.0, goes: 'up' },
  { name: 'the cemetery, up to the oldest ground', area: 'old-cemetery', x: 12.4, z: 10, facing: 0, hold: 4.0, goes: 'up' },
  { name: 'the station, up to the west terrace', area: 'domino-station', x: -24, z: 30.5, facing: 0, hold: 3.0, goes: 'up' },
  { name: 'the station, up to the east terrace', area: 'domino-station', x: 24, z: 30.5, facing: 0, hold: 3.0, goes: 'up' },
  { name: 'the station, down off the terrace', area: 'domino-station', x: 24, z: 36, facing: Math.PI, hold: 3.0, goes: 'down' },
  { name: 'the plaza, down off the forecourt', area: 'station-plaza', x: -52, z: -10, facing: Math.PI / 2, hold: 3.0, goes: 'down' },
  { name: 'the plaza, up on to the forecourt', area: 'station-plaza', x: -42, z: -10, facing: -Math.PI / 2, hold: 3.0, goes: 'up' },
  /*
   * On the tower's own floor, below the bottom step — not at z −59, which is
   * a metre and a third *up* the flight and therefore, to a save that carries
   * no floor, the ground underneath it. And held for twenty-five seconds
   * rather than five: headless Chromium draws these two areas at about a
   * frame a second and the world's `dt` is clamped at a fiftieth, so five
   * seconds of wall clock is a quarter of a second of walking and she never
   * left the bottom tread.
   */
  { name: 'the school, up the west tower', area: 'domino-high', x: -48, z: -62.5, facing: 0, hold: 25.0, goes: 'up' },
  { name: 'the school, down the west tower', area: 'domino-high', x: -48, z: -62.5, facing: 0, hold: 25.0, goes: 'down', upFirst: 25.0 },
  { name: 'the school, up the east tower', area: 'domino-high', x: 48, z: -62.5, facing: 0, hold: 25.0, goes: 'up' },
  { name: 'Turtle Lane, up the hill', area: 'step-lane', x: 14.6, z: 0, facing: -Math.PI / 2, hold: 6.0, goes: 'up' },
  { name: 'Turtle Lane, down the hill', area: 'step-lane', x: -13, z: 0, facing: Math.PI / 2, hold: 6.0, goes: 'down' },
];

interface Sample { x: number; z: number; y: number }

async function climb(browser: import('playwright').Browser, f: Flight): Promise<Sample[]> {
  /*
   * A page of her own for each flight.
   *
   * Nine worlds built in one browser context is nine WebGL contexts, and a
   * browser keeps only so many alive: the oldest is dropped, the page it
   * belonged to stops rendering, and the check reports "never got going" for
   * whichever flight happened to be holding it. It was a different flight every
   * run, which is the shape of a resource running out rather than of a fault.
   */
  const ctx = await browser.newContext({ viewport: { width: 900, height: 640 } });
  const page = await ctx.newPage();
  try {
    return await run(page, f);
  } finally {
    await ctx.close();
  }
}

async function run(page: Page, f: Flight): Promise<Sample[]> {
  await fetch(`${BASE}/api/story/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: NAME, world: { area: f.area, x: f.x, z: f.z, facing: f.facing } }),
  }).catch(() => {});
  /* Twice before giving up. A cold area can take longer to compile than the
     wait allows, and "never got going" would then be a fact about the machine
     rather than about the stairs. */
  let there = await enterStory(page, f.area, PINNED_HOUR);
  if (!there) there = await enterStory(page, f.area, PINNED_HOUR);
  if (!there) return [];
  await page.waitForTimeout(1200);
  if (f.upFirst) await walkForward(page, f.upFirst * 1000);
  const out: Sample[] = [];
  /* Sampled while she walks, so the stick is held from a second task. */
  const walking = f.upFirst ? walkBack(page, f.hold * 1000) : walkForward(page, f.hold * 1000);
  for (let t = 0; t < f.hold * 1000; t += 90) {
    await page.waitForTimeout(90);
    const s = await page.evaluate(() => {
      const p = (window as unknown as { __probe?: { player: [number, number]; y: number } }).__probe;
      return p ? { x: p.player[0], z: p.player[1], y: p.y } : null;
    }).catch(() => null);
    if (s) out.push(s);
  }
  await walking;
  return out;
}

async function main() {
  refuseRemote();
  await ensurePlayer();
  const only = process.argv.slice(2).filter((a) => !a.startsWith('-') && !/^https?:/.test(a));
  const chosen = only.length
    ? FLIGHTS.filter((f) => only.some((o) => f.name.includes(o) || f.area.includes(o)))
    : FLIGHTS;

  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  });
  console.log('\nStairs — where her feet are while she is climbing\n');
  let bad = 0;
  for (const f of chosen) {
    const walk = await climb(browser, f);
    if (walk.length < 4) { console.log(`  ❌ ${f.name} — never got going`); bad++; continue; }
    /* The floor she is on, asked the way the game asks it: from the height she
       was at a moment ago, which is what tells a stair from a storey. */
    let near = walk[0].y;
    let worst = 0;
    let at: Sample | null = null;
    let moved = 0;
    for (let i = 1; i < walk.length; i++) {
      const s = walk[i];
      moved += Math.hypot(s.x - walk[i - 1].x, s.z - walk[i - 1].z);
      const floor = groundAt(AREAS[f.area], s.x, s.z, near);
      near = s.y;
      const under = floor - s.y;
      if (under > worst) { worst = under; at = s; }
    }
    /* Six tenths of a metre. The stick ramps in, so a short flight is a short
       walk, and the point of this number is only to catch a duelist who never
       set off at all. */
    if (moved < 0.6) { console.log(`  ❌ ${f.name} — she did not move (${moved.toFixed(2)} m)`); bad++; continue; }
    /*
     * And she has to have got somewhere vertically, which is the whole idea
     * of a stair.
     *
     * "Feet on the step" is measured against `groundAt` asked from the game's
     * own reported height, so it agrees with the game by construction: a
     * duelist standing at zero in a stairwell with the flight over her head is
     * compared with the floor at zero and comes out perfect. Five centimetres
     * is deliberately small — the stick ramps in and headless Chromium walks
     * these in slow motion — but it is the difference between climbing a
     * stair and walking underneath one.
     */
    const rose = walk[walk.length - 1].y - walk[0].y;
    const gained = f.goes === 'up' ? rose : -rose;
    const went = gained >= GAINED;
    const ok = worst <= ALLOWED && went;
    if (!ok) bad++;
    console.log(`  ${ok ? '✅' : '❌'} ${f.name} — ${(worst * 100).toFixed(1)} cm under the step`
                + (at && worst > ALLOWED ? `, worst at ${at.x.toFixed(1)}, ${at.z.toFixed(1)}` : '')
                + `  (${moved.toFixed(1)} m walked, ${rose >= 0 ? '+' : ''}${rose.toFixed(2)} m)`
                + (went ? '' : ` — she never went ${f.goes}`));
  }
  await browser.close();
  console.log(bad ? `\nSTAIRS: ${bad} flight(s) put her feet in the stone\n`
                  : '\nHer feet are on every step. ✅\n');
  process.exit(bad ? 1 : 0);
}

main();
