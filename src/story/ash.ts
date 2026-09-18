/**
 * Where Ash Ketchum is, which depends on what time it is.
 *
 * Everybody else in Domino City is *placed*: a shopkeeper behind his counter,
 * two duelists in a street, a courier walking one arcade. Ash is not from here
 * and is not meant to be found on purpose — he is an easter egg, and Mike's
 * brief was that he turns up "on random parts of the day", in Grandpa's shop
 * or in Black Crown Games, walking about, looking around. So he has two places
 * he might be and a schedule that says which, if either, right now.
 *
 * Pure data and arithmetic, like everything else in `src/story`: no three.js,
 * no React. `OpenWorld` asks `ashWhereabouts` and builds or removes him;
 * `npm run ash` reads the same function for a month of days and checks it
 * never contradicts itself.
 *
 * ## The clock
 *
 * The hour is the wall clock's (`hourFrom` in `sky.ts`): one day is seventy-two
 * real minutes and the same in every area. A schedule keyed on the hour alone
 * would put him in the same shop at the same time every day, which is a
 * timetable, not a surprise — so it is keyed on the *day* as well, and each
 * day rolls its own visits from a seed. `dayFrom` is that day: the number of
 * seventy-two-minute days since the epoch, read off the same clock, so it
 * survives a door, a reload and a phone that was closed for a week exactly as
 * the hour does.
 *
 * `?t=` pins the hour for the checks, and a pinned hour pins the day to zero
 * as well — two frames a millimetre apart cannot have him walk out between
 * them, and a screenshot has to be comparable with last week's.
 *
 * ## The schedule
 *
 * Three visits a day, none overlapping, each two and a half to four hours
 * long (seven to twelve real minutes), between seven in the morning and
 * half past eleven at night — a boy is not in a card shop at four a.m. Both
 * shops are visited every day: whichever shop the first two visits did not
 * pick, the third goes to. Over a day that is roughly ten of twenty-four
 * hours in one shop or the other, which is a coin-toss chance of meeting him
 * on any one walk through either — often enough to happen, rare enough to
 * mean something when it does.
 */

import type { AreaId } from './areas';
import { DAY_MINUTES } from './sky';

/** A route somebody walks — the same shape `npcs.ts` declares. */
export interface HauntRoute {
  path: [{ x: number; z: number }, { x: number; z: number }, ...{ x: number; z: number }[]];
  speed: number;
  dwell: number;
  restEvery?: number;
  gestures?: string[];
}

/** One of the places somebody might be, and what they do there. */
export interface Haunt {
  area: AreaId;
  /** Where they stand, or start walking from — the first point of `roam`. */
  x: number;
  z: number;
  facing: number;
  roam?: HauntRoute;
}

const GESTURES = ['LookAround', 'Settle', 'Stretch'];

/**
 * Grandpa's shop: the front half of the room, along the shelves and the
 * window, and never near the counter.
 *
 * The room is 13 × 11 m with the counter across the back at z −2.6 and
 * Grandpa behind it at (0.9, −3.6), talk range 3.4. Ash's range is 3.2, so
 * every point of his route stays more than 6.6 m from Grandpa — two prompts
 * live at once is a choice of two conversations the world never offers. The
 * left shelf unit stands at x −6.38..−5.28, the door's trigger at x 1.55..3.65,
 * z 2.9..5.1: he browses the shelf from seventy centimetres off it and turns
 * back well short of the door.
 */
const GRANDPA_SHOP: Haunt = {
  area: 'grandpa-shop',
  /* Sixty centimetres east of where he used to stand: the chalkboard's easel
     by the window (`areas.ts`, `draw: 'chalkboard'`) stands on the old spot. */
  x: -4.0,
  z: 3.6,
  facing: Math.PI,
  roam: {
    path: [
      { x: -4.0, z: 3.6 },
      { x: -4.0, z: 1.0 },
      { x: -1.2, z: 2.9 },
    ],
    /* Slow: he is reading the shelves. 0.89× of his Walk clip's own rating, so
       the feet still cover the ground they show. */
    speed: 1.25,
    dwell: 2.6,
    restEvery: 11,
    gestures: GESTURES,
  },
};

/**
 * Black Crown Games: all three floors.
 *
 * In from the door across the atrium between the tables, up the east flight
 * to the first gallery, round it to the west flight, up to the second gallery
 * and round that — and, because a route is there-and-back, all the way down
 * again. Every point sits on a slab `CS_GROUND` draws and clear of every rail,
 * shelf, table and understair in `areas.ts`; `npm run ash` walks the legs and
 * measures the floor under each step.
 *
 * The flights are climbed by walking to their foot and along their cross line
 * (x ±14.19): `groundAt` answers the tread height at every step and the route
 * never has to know there are stairs.
 */
const CROWN_SHOP: Haunt = {
  area: 'crown-shop',
  x: -12,
  z: 0,
  facing: Math.PI / 2,
  roam: {
    path: [
      { x: -12, z: 0 },
      { x: -7.5, z: -6 },
      { x: 7.5, z: -6 },
      { x: 10.5, z: -1.5 },
      /* The foot of the east flight, then its head. */
      { x: 14.19, z: 0.0 },
      { x: 14.19, z: 10.5 },
      { x: 14.2, z: 11.3 },
      /* The first gallery: south side westwards, then north along the west. */
      { x: 11.4, z: 11.3 },
      { x: -13, z: 9.6 },
      { x: -13, z: 1.5 },
      /* The foot of the west flight, then its head. */
      { x: -14.19, z: -0.4 },
      { x: -14.19, z: -10.5 },
      { x: -14.2, z: -11.3 },
      /* The second gallery, the whole ring: north side eastwards, down the
         east, back along the south. */
      { x: -11.6, z: -11.3 },
      { x: 13, z: -9.6 },
      { x: 13, z: 9.6 },
      { x: -7, z: 9.6 },
    ],
    speed: 1.35,
    dwell: 2.5,
    restEvery: 20,
    gestures: GESTURES,
  },
};

export const ASH_HAUNTS: Haunt[] = [GRANDPA_SHOP, CROWN_SHOP];

/** One visit: hours of the day, and which haunt. */
export interface Visit {
  from: number;
  to: number;
  haunt: number;
}

/** Which seventy-two-minute day it is, on the same clock as the hour. */
export function dayFrom(nowMs: number, pinnedHour?: number | null, pinnedDay?: number | null): number {
  if (pinnedDay !== null && pinnedDay !== undefined && Number.isFinite(pinnedDay)) return Math.floor(pinnedDay);
  /* A pinned hour pins the day too — see the header. */
  if (pinnedHour !== null && pinnedHour !== undefined && Number.isFinite(pinnedHour)) return 0;
  return Math.floor(nowMs / (DAY_MINUTES * 60_000));
}

/** Earliest and latest an hour a visit may run, and how long one is. */
const OPEN = 7;
const CLOSE = 23.5;
const SHORTEST = 2.5;
const LONGEST = 4;
const VISITS = 3;
/** Standing room between two visits, so leaving one shop and turning up in
 *  the other reads as a walk across town rather than a teleport. */
const GAP = 1;

/**
 * The day's visits, rolled from the day number.
 *
 * The open hours are cut into three equal slots and each visit is placed
 * inside its own slot — a start somewhere in the first part of it and a
 * length that leaves the gap — which is what guarantees they never overlap
 * without a loop that might not terminate. A linear congruential generator
 * rather than `Math.random`, for the reason every seeded thing in this world
 * gives: the same day must roll the same visits on every phone and every
 * reload, or he vanishes when you turn round.
 */
export function ashVisits(day: number): Visit[] {
  let seed = ((day + 1) * 0x9e3779b9) >>> 0;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const span = (CLOSE - OPEN) / VISITS;
  const visits: Visit[] = [];
  for (let i = 0; i < VISITS; i++) {
    const slotStart = OPEN + i * span;
    const length = SHORTEST + rnd() * (LONGEST - SHORTEST);
    const latest = slotStart + span - length - GAP;
    const from = slotStart + rnd() * Math.max(0, latest - slotStart);
    visits.push({ from, to: from + length, haunt: rnd() < 0.5 ? 0 : 1 });
  }
  /* Both shops, every day. If the roll put every visit in one shop, the last
     one goes to the other. */
  if (visits.every((v) => v.haunt === visits[0].haunt)) visits[VISITS - 1].haunt = 1 - visits[0].haunt;
  return visits;
}

/** Where Ash is at this hour of this day, or `null` while he is away. */
export function ashWhereabouts(hour: number, day: number): Haunt | null {
  for (const v of ashVisits(day)) {
    if (hour >= v.from && hour < v.to) return ASH_HAUNTS[v.haunt];
  }
  return null;
}
