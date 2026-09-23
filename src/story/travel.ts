/**
 * Where the tournament's duelists are, at any moment, anywhere in the city.
 *
 * Before the tournament everybody is *placed*: Tina walks her arcade, the three
 * sisters their precinct, Isha her avenue. Once Kaiba has opened it they are out
 * in Domino City — through every gate, from the market to the towers — the way
 * the player is, and this file is the whole of where they go.
 *
 * ## The clock, not the page
 *
 * A traveller's position is a function of the wall clock, the same one the sun
 * runs on (`sky.ts`), so it is the same on every device, survives a door, a
 * reload and a duel, and costs nothing to save. Walking from the market to the
 * station does not reset anybody: while you were crossing, so were they. Each
 * day of seventy-two minutes gets its own plan, rolled from a seed and made of
 * legs `scripts/travel-paths.ts` found against the areas' own collision.
 *
 * ## The shape of a day
 *
 * The night is kept at home. From two in the morning until five everybody is
 * where they were before the tournament — Tina in her arcade, Isha on her walk —
 * and from five they leave, staggered, and wander: a gate, a walk to somewhere
 * worth standing, a minute or two there, another gate. From half past eight in
 * the evening each of them heads home by the shortest way, and is there by ten.
 * So every day starts and ends in the same place, which is what lets a day be
 * planned on its own; and a player who wants somebody in particular can always
 * find them after dark.
 *
 * ## Two rules the plan keeps
 *
 * - **Nobody in the Starting Area.** Mike's word: the street you begin on is
 *   Sarah's and Tony's. It is also the hub — Step Lane and the shrine are only
 *   reachable through it — so a traveller crossing it does so off screen, taking
 *   exactly as long as walking it would, and comes out of the far gate.
 * - **Two people you can talk to are one person you cannot.** Nobody stops
 *   within eight metres of anybody else who is stopped, and a small area holds
 *   one traveller at a time. Walks may pass; stops may not crowd.
 *
 * No three.js, like everything else in `src/story`.
 */

import {
  AREAS,
  areaById,
  hasStoreys,
  inside,
  partnerOf,
  standingOn,
  type Area,
  type AreaId,
  type Door,
  type Rect,
} from './areas';
import { alongPath, findPath, lineClear, type Band, type NavPoint } from './nav';
import { DAY_MINUTES, DEFAULT_HOUR } from './sky';
import pathsJson from './generated/travel-paths.json';

/** Every area a traveller may be seen in. */
export const TRAVEL_AREAS: AreaId[] = [
  'market-row',
  'step-lane',
  'domino-shrine',
  'black-crown',
  'old-cemetery',
  'domino-station',
  'station-plaza',
  'domino-high',
  'central-towers',
];

/** Crossed, never seen: the street is Sarah's and Tony's. */
export const TRANSIT_AREA: AreaId = 'starting-area';

/**
 * The floors a traveller walks on: the streets and the ground storeys, never a
 * gallery.
 *
 * Only a building with storeys needs saying so. Step Lane climbs six metres and
 * the cemetery's oldest ground is three and a half up, and all of it is street;
 * where one floor stands over another, a metre and a fifth above the street
 * takes in a lobby a step up and leaves out every mezzanine in the city.
 */
export function bandOf(area: Area): Band {
  return hasStoreys(area) ? [-Infinity, (area.street ?? 0) + 1.2] : [-Infinity, Infinity];
}

/**
 * Ground nobody but the people who belong there stands on.
 *
 * The sunken forecourt at Central Towers is where Kaiba receives the finalists,
 * and a stranger strolling across it — within talking distance of him — is a
 * second prompt over his. So the travellers go round it; the plan never puts a
 * stop inside it and the legs are found with it walled off.
 */
export const KEEP_OUT: Partial<Record<AreaId, Rect[]>> = {
  'central-towers': [
    /* The forecourt and both grand flights down into it. */
    { x: 0, z: 0, hw: 17, hd: 29 },
    /* The arms either side, under the street. */
    { x: -19.5, z: 0, hw: 3.5, hd: 6 },
    { x: 24, z: 0, hw: 8, hd: 6 },
  ],
};

/** One way in or out of an area, as a traveller uses it. */
export interface Gate {
  area: AreaId;
  door: Door;
  /** Where it goes — a travel area, or the street they cross unseen. */
  to: AreaId;
  /** The threshold itself, in this area's metres. */
  seam: NavPoint;
  /** Just inside the threshold, in the doorway: where a traveller appears and disappears. */
  mouth: NavPoint;
  /** The floor the mouth is on — the landing's, walked out to the door. */
  mouthY: number;
  /** The door's own landing — the point the player arrives on. */
  inner: NavPoint;
  innerY: number;
}

/** Doors that go somewhere a traveller may be, or across the street. */
function travels(door: Door): boolean {
  return TRAVEL_AREAS.includes(door.to) || door.to === TRANSIT_AREA;
}

const GATES = new Map<AreaId, Gate[]>();

/**
 * The gates of one area, with the three points a traveller uses at each.
 *
 * The mouth is found rather than typed, and found by *walking out*: from the
 * door's landing towards the seam, the point nearest the threshold that a step
 * from the landing can reach. Measured from the seam instead, the strip of
 * doorway past the end of a terrace answers the base plate — a floor at nought
 * that nobody stands on, two metres under the precinct the landing is on — and
 * a traveller who appeared there could never have climbed out of it.
 */
export function gatesIn(id: AreaId): Gate[] {
  const had = GATES.get(id);
  if (had) return had;
  const area = areaById(id);
  const band = bandOf(area);
  const out: Gate[] = [];
  for (const door of area.doors) {
    if (!travels(door)) continue;
    const dx = door.arrive.x - door.seam.x;
    const dz = door.arrive.z - door.seam.z;
    /* Straight in off the wall the door is cut into: along whichever axis the
       landing is further from the seam. */
    const inward = Math.abs(dx) >= Math.abs(dz) ? { x: Math.sign(dx), z: 0 } : { x: 0, z: Math.sign(dz) };
    const inner = { x: door.arrive.x, z: door.arrive.z };
    const innerY = standingOn(area, inner.x, inner.z);
    let mouth: NavPoint = inner;
    let mouthY = innerY;
    for (let d = 0.3; d <= 8; d += 0.25) {
      /* On the door's own line, not the landing's — a landing set to one side
         keeps the camera clear of a far gate, and the doorway is where the
         door is. */
      const at = { x: door.seam.x + inward.x * d, z: door.seam.z + inward.z * d };
      if (!inside(area.bounds, at.x, at.z)) continue;
      const straight = lineClear(area, inner, innerY, at, undefined, band);
      if (straight !== null) {
        mouth = at;
        mouthY = straight;
        break;
      }
      const found = findPath(area, inner, innerY, at, { band, budget: 6000 });
      const last = found?.points[found.points.length - 1];
      if (found && last && Math.hypot(last.x - at.x, last.z - at.z) < 1e-6) {
        mouth = at;
        mouthY = found.heights[found.heights.length - 1];
        break;
      }
    }
    out.push({
      area: id,
      door,
      to: door.to,
      seam: { x: door.seam.x, z: door.seam.z },
      mouth,
      mouthY,
      inner,
      innerY,
    });
  }
  GATES.set(id, out);
  return out;
}

/** The gate on the far side of one, in the area it leads to. */
export function gateBeyond(gate: Gate): Gate | null {
  const partner = partnerOf(gate.door, gate.area);
  if (!partner) return null;
  return gatesIn(gate.to).find((g) => g.door.id === partner.id) ?? null;
}

/** Somewhere worth standing for a minute. */
export interface Stop {
  id: string;
  area: AreaId;
  x: number;
  z: number;
  /** Which way they look while they wait, in radians (0 is +Z). */
  facing: number;
}

/**
 * The places travellers stop, area by area.
 *
 * Chosen off the plans `scripts/travel-map.ts` draws — somewhere with room
 * round it, off the thoroughfare, clear of every gate by more than a talk
 * range, and facing something: the arcade's shopfronts, the shrine's hall, the
 * departures board. Every one is checked by `npm run travel` to be standable
 * with room to spare, and every pair of them in one area that might be held at
 * once is held eight metres apart by the plan.
 */
export const STOPS: Stop[] = [
  /* Market Row: one at a time, either side of the middle, looking at the
     shopfronts rather than down the arcade. */
  { id: 'mr-west', area: 'market-row', x: -2.5, z: 2.2, facing: 0 },
  { id: 'mr-east', area: 'market-row', x: 7.5, z: -2.0, facing: Math.PI },
  /* Step Lane: half way up the climb, looking up it — thirteen metres from
     both the terrace where Seraphina stands at night and the foot where
     Kaela does. */
  { id: 'sl-mid', area: 'step-lane', x: 0.5, z: 0.5, facing: -Math.PI / 2 },
  /* Domino Shrine: the aisles the sisters walk, and the front of the steps. */
  { id: 'ds-west', area: 'domino-shrine', x: -12.5, z: -8.5, facing: Math.PI / 2 },
  { id: 'ds-steps', area: 'domino-shrine', x: 8.5, z: -12.0, facing: 0 },
  { id: 'ds-east', area: 'domino-shrine', x: 15.5, z: 5.0, facing: -Math.PI / 2 },
  { id: 'ds-grove', area: 'domino-shrine', x: -12.5, z: 5.0, facing: Math.PI / 2 },
  { id: 'ds-hall', area: 'domino-shrine', x: 16.0, z: 12.5, facing: -Math.PI / 2 },
  /* Black Crown: the court, the quiet west street and the south lane. */
  { id: 'bc-court-w', area: 'black-crown', x: -15.0, z: -6.0, facing: Math.PI / 2 },
  { id: 'bc-court-e', area: 'black-crown', x: -1.0, z: 2.0, facing: -Math.PI / 2 },
  { id: 'bc-west', area: 'black-crown', x: -46.0, z: -5.0, facing: Math.PI / 2 },
  { id: 'bc-south', area: 'black-crown', x: -8.0, z: 30.0, facing: Math.PI },
  /* The Old Cemetery: an aisle on each terrace, and the monument. */
  { id: 'cm-low', area: 'old-cemetery', x: -22.0, z: -21.0, facing: 0 },
  { id: 'cm-mid', area: 'old-cemetery', x: -22.0, z: 0.5, facing: 0 },
  { id: 'cm-high', area: 'old-cemetery', x: -44.0, z: 31.0, facing: Math.PI / 2 },
  { id: 'cm-monument', area: 'old-cemetery', x: 21.0, z: 29.0, facing: 0 },
  { id: 'cm-east', area: 'old-cemetery', x: 45.0, z: 30.0, facing: -Math.PI / 2 },
  /* Domino Station: two platforms, both halves of the hall, the terrace. */
  { id: 'st-plat-2', area: 'domino-station', x: -15.5, z: -15.0, facing: -Math.PI / 2 },
  { id: 'st-plat-4', area: 'domino-station', x: 22.5, z: -25.0, facing: Math.PI / 2 },
  { id: 'st-hall-w', area: 'domino-station', x: -22.0, z: 27.0, facing: Math.PI },
  { id: 'st-hall-e', area: 'domino-station', x: 22.0, z: 28.0, facing: Math.PI },
  { id: 'st-terrace', area: 'domino-station', x: 0.0, z: 42.0, facing: 0 },
  /* Station Plaza: round the clock, and out on the pavements. */
  { id: 'pz-clock-n', area: 'station-plaza', x: 0.0, z: -10.0, facing: 0 },
  { id: 'pz-clock-s', area: 'station-plaza', x: 0.0, z: 13.0, facing: Math.PI },
  { id: 'pz-island-w', area: 'station-plaza', x: -20.0, z: 3.0, facing: Math.PI / 2 },
  { id: 'pz-island-e', area: 'station-plaza', x: 20.0, z: -3.0, facing: -Math.PI / 2 },
  { id: 'pz-north', area: 'station-plaza', x: -10.0, z: -50.0, facing: 0 },
  { id: 'pz-south', area: 'station-plaza', x: 15.0, z: 50.0, facing: Math.PI },
  { id: 'pz-east', area: 'station-plaza', x: 47.0, z: 10.0, facing: -Math.PI / 2 },
  { id: 'pz-west', area: 'station-plaza', x: -47.0, z: 30.0, facing: Math.PI / 2 },
  /* Domino High: the drive, the courtyard, the field. */
  { id: 'dh-drive', area: 'domino-high', x: -9.0, z: -66.0, facing: 0 },
  { id: 'dh-court', area: 'domino-high', x: -22.0, z: -24.0, facing: Math.PI / 2 },
  { id: 'dh-field', area: 'domino-high', x: -45.0, z: 35.0, facing: Math.PI / 2 },
  { id: 'dh-east', area: 'domino-high', x: 40.0, z: -20.0, facing: -Math.PI / 2 },
  /* Central Towers: the south half of the canyon, the arcade and both
     lobbies — never the forecourt itself (`KEEP_OUT`), and not the far side
     of the towers, which is a hundred and sixty metres round the forecourt
     from the only gate and was a traveller spending half an hour walking to a
     place nobody would find them. */
  { id: 'ct-sw', area: 'central-towers', x: -60.0, z: 65.0, facing: Math.PI },
  { id: 'ct-se', area: 'central-towers', x: 60.0, z: 75.0, facing: Math.PI },
  { id: 'ct-wlobby', area: 'central-towers', x: -45.0, z: 10.0, facing: Math.PI / 2 },
  { id: 'ct-elobby', area: 'central-towers', x: 33.0, z: -12.0, facing: Math.PI / 2 },
  { id: 'ct-arcade', area: 'central-towers', x: 94.0, z: 30.0, facing: -Math.PI / 2 },
];

export function stopsIn(id: AreaId): Stop[] {
  return STOPS.filter((s) => s.area === id);
}

/**
 * How many travellers an area holds at once.
 *
 * One in the places a second would crowd — the arcade is nine metres across,
 * the lane four and a half — and more in the ones a hundred metres wide.
 *
 * Those were two and three when eleven people travelled. At twenty-two the
 * same numbers turned the city into a queue: a traveller who finds nowhere
 * with room goes home, and 42% of days ended before six in the evening, which
 * is a tournament nobody can find. With the plaza holding five, the school and
 * the towers four and everywhere else of any size three, it is 15% — and the
 * eight metres between people stopped, and the stops' own distance from every
 * home, are kept exactly as they were (`npm run travel`).
 */
export const CAPACITY: Record<string, number> = {
  'market-row': 1,
  'step-lane': 1,
  'domino-shrine': 3,
  'black-crown': 3,
  'old-cemetery': 3,
  'domino-station': 3,
  'station-plaza': 5,
  'domino-high': 4,
  'central-towers': 4,
};

/** Where somebody is at night, and where their day begins and ends. */
export interface Home {
  area: AreaId;
  x: number;
  z: number;
  facing: number;
}

/**
 * Everybody who travels, and how fast.
 *
 * The homes of the eight who were in the city before the tournament are the
 * places their records have always put them — the first point of a route, or
 * where they stand — and `npm run travel` holds the two to agreeing. The four
 * who arrive with the tournament live where they fit: Yugi at his own school,
 * Joey among the station's barriers, Mai under the plaza's clock and Yami in
 * the court at Black Crown.
 *
 * A speed is a shade under the model's own Walk (`premade.ts`), so the feet
 * cover the ground they show, and every one is a walk and not a run. Isha has
 * no walk at all — she drifts — and crosses the city at the pace a ghost
 * crosses it.
 */
export interface Traveller {
  id: string;
  home: Home;
  speed: number;
}

export const TRAVELLERS: Traveller[] = [
  { id: 'tina', home: { area: 'market-row', x: -11.5, z: 2.4, facing: -2.55 }, speed: 1.85 },
  { id: 'isha', home: { area: 'old-cemetery', x: 12.4, z: -38, facing: 0 }, speed: 0.9 },
  { id: 'antiope', home: { area: 'domino-shrine', x: -23.0, z: -11.5, facing: 0.96 }, speed: 1.8 },
  { id: 'panthesilea', home: { area: 'domino-shrine', x: -1.0, z: -10.2, facing: 0.07 }, speed: 1.9 },
  { id: 'hippolyta', home: { area: 'domino-shrine', x: 16.5, z: -4.0, facing: -1.09 }, speed: 1.85 },
  { id: 'kaela', home: { area: 'step-lane', x: 14.5, z: 1.1, facing: -Math.PI / 2 }, speed: 1.95 },
  { id: 'seraphina', home: { area: 'step-lane', x: -12.5, z: -1.1, facing: Math.PI / 2 }, speed: 1.85 },
  { id: 'yugi', home: { area: 'domino-high', x: 0, z: -30, facing: Math.PI }, speed: 1.27 },
  { id: 'joey', home: { area: 'domino-station', x: -14, z: 25, facing: Math.PI }, speed: 1.46 },
  { id: 'mai', home: { area: 'station-plaza', x: 14, z: -14, facing: -Math.PI / 4 }, speed: 1.77 },
  { id: 'yami', home: { area: 'black-crown', x: -6, z: -6, facing: Math.PI / 2 }, speed: 1.41 },
  /*
   * The rest of the main menu. Homes found, not placed: `scripts/travel-homes.ts`
   * searched each area for standable ground a traveller can walk to from a
   * gate, ten metres clear of every stop and every other home and nine of
   * every gate, nearest the middle of where that area's stops are. The areas
   * are chosen: the gambler lives over the games, the priest at the shrine,
   * Marik and his guard in the cemetery, the two with money in the towers.
   * Step Lane had no room left, so Bakura keeps his dice at Black Crown too.
   */
  { id: 'pegasus', home: { area: 'central-towers', x: 16, z: 34, facing: 2.79 }, speed: 1.75 },
  { id: 'ishizu', home: { area: 'central-towers', x: 6, z: 34, facing: 2.61 }, speed: 1.75 },
  { id: 'priestseto', home: { area: 'domino-shrine', x: -2, z: 9, facing: -1.93 }, speed: 1.7 },
  { id: 'yamimarik', home: { area: 'old-cemetery', x: -4, z: 13, facing: -2.18 }, speed: 1.65 },
  { id: 'odion', home: { area: 'old-cemetery', x: -10, z: 21, facing: -2.61 }, speed: 2.0 },
  { id: 'bakura', home: { area: 'black-crown', x: -10, z: 11, facing: 2.36 }, speed: 1.8 },
  { id: 'jaden', home: { area: 'domino-high', x: -9, z: -18, facing: -2.0 }, speed: 1.75 },
  { id: 'keith', home: { area: 'black-crown', x: -18, z: 5, facing: 2.88 }, speed: 1.85 },
  { id: 'mako', home: { area: 'domino-station', x: 1, z: 11, facing: 0.89 }, speed: 1.95 },
  { id: 'rex', home: { area: 'station-plaza', x: 1, z: 3, facing: -0.1 }, speed: 1.5 },
  { id: 'weevil', home: { area: 'domino-shrine', x: 3, z: 0, facing: 2.71 }, speed: 1.3 },
];

export const TRAVELLER_BY_ID: Record<string, Traveller> = Object.fromEntries(TRAVELLERS.map((t) => [t.id, t]));

/**
 * The finals, at the bottom of the forecourt at Central Towers.
 *
 * Kaiba stands at the foot of the south flight — the way anybody coming from
 * the plaza arrives — facing up it, so he is the first thing you see on the
 * way down. The three who make the finals wait behind him in a wide arc, far
 * enough apart that each is a conversation of their own.
 */
export const FINALS_AREA: AreaId = 'central-towers';
export const HOST_SPOT: Home = { area: 'central-towers', x: 0, z: 10, facing: 0 };
export const FINALIST_SPOTS: Home[] = [
  { area: 'central-towers', x: -12, z: 6, facing: 0.35 },
  { area: 'central-towers', x: 12, z: 4, facing: -0.35 },
  { area: 'central-towers', x: 0, z: -9, facing: 0 },
];

/** Whether a point is somewhere the travellers leave to the people who belong there. */
export function keptOut(id: AreaId, x: number, z: number): boolean {
  return (KEEP_OUT[id] ?? []).some((r) => inside(r, x, z));
}

void AREAS;

/**
 * A fingerprint of everything the legs were found against.
 *
 * The collision of every area a traveller walks (and the street they cross),
 * the stops, the homes and the keep-outs. `travel-paths.json` carries the one
 * it was built from and `npm run travel` compares: a wall moved without the
 * legs being found again is a traveller walking through the wall's old place.
 */
export function travelFingerprint(): string {
  const parts = [...TRAVEL_AREAS, TRANSIT_AREA].map((id) => {
    const a = areaById(id);
    return { id, bounds: a.bounds, solids: a.solids, platforms: a.platforms ?? [], doors: a.doors };
  });
  const text = JSON.stringify({ parts, STOPS, TRAVELLERS, KEEP_OUT });
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/* ------------------------------------------------------------------ */
/* The legs                                                             */
/* ------------------------------------------------------------------ */

interface PathsFile {
  version: number;
  fingerprint: string;
  areas: Record<string, { nodes: Record<string, number[]>; legs: { a: string; b: string; len: number; points: number[] }[] }>;
  transit: Record<string, number>;
}

const PATHS = pathsJson as unknown as PathsFile;

export interface Leg {
  points: NavPoint[];
  len: number;
}

const LEGS = new Map<string, Leg>();
for (const [area, data] of Object.entries(PATHS.areas)) {
  for (const l of data.legs) {
    const pts: NavPoint[] = [];
    for (let k = 0; k < l.points.length; k += 2) pts.push({ x: l.points[k], z: l.points[k + 1] });
    LEGS.set(`${area}|${l.a}|${l.b}`, { points: pts, len: l.len });
    LEGS.set(`${area}|${l.b}|${l.a}`, { points: pts.slice().reverse(), len: l.len });
  }
}

/** The walk between two nodes of one area — `g:` a gate, `s:` a stop, `h:` a home. */
export function legBetween(area: AreaId, a: string, b: string): Leg | null {
  if (a === b) {
    const at = nodeAt(area, a);
    return at ? { points: [at, at], len: 0 } : null;
  }
  return LEGS.get(`${area}|${a}|${b}`) ?? null;
}

/** Where a node is, off the file the legs came from. */
export function nodeAt(area: AreaId, node: string): NavPoint | null {
  const p = PATHS.areas[area]?.nodes[node];
  return p ? { x: p[0], z: p[1] } : null;
}

/** The fingerprint the legs were found against — see `travelFingerprint`. */
export const PATHS_FINGERPRINT = PATHS.fingerprint;

/* ------------------------------------------------------------------ */
/* The clock                                                            */
/* ------------------------------------------------------------------ */

/** A travel day, in seconds — one of the world's seventy-two-minute days. */
export const DAY_SECONDS = DAY_MINUTES * 60;
/** A travel day runs from two in the morning to two in the morning, while everybody is at home. */
export const DAY_BEGINS = 2;

/** Seconds into a travel day at which an hour of the clock falls. */
export function secondsAt(hour: number): number {
  return ((((hour - DAY_BEGINS) % 24) + 24) % 24) / 24 * DAY_SECONDS;
}

/** When the city's own clock (`hourFrom`) reads two in the morning, in epoch milliseconds modulo a day. */
const EPOCH = ((((DAY_BEGINS - DEFAULT_HOUR) % 24) + 24) % 24) / 24 * DAY_SECONDS * 1000;

/**
 * Which travel day it is, and how far into it — off the same wall clock as the
 * sun, pinned the same way. `?t=` pins the hour and with it the day (to nought,
 * unless `?day=` names one), so a check photographing a traveller finds them
 * standing exactly where the last run did.
 */
export function travelClock(nowMs: number, pinnedHour?: number | null, pinnedDay?: number | null): { day: number; t: number } {
  const dayMs = DAY_SECONDS * 1000;
  if (pinnedHour !== null && pinnedHour !== undefined && Number.isFinite(pinnedHour)) {
    return { day: pinnedDay !== null && pinnedDay !== undefined && Number.isFinite(pinnedDay) ? Math.floor(pinnedDay) : 0, t: secondsAt(pinnedHour) };
  }
  const since = nowMs - EPOCH;
  const day = Math.floor(since / dayMs);
  const t = (since - day * dayMs) / 1000;
  return { day: pinnedDay !== null && pinnedDay !== undefined && Number.isFinite(pinnedDay) ? Math.floor(pinnedDay) : day, t };
}

/* ------------------------------------------------------------------ */
/* The plan                                                             */
/* ------------------------------------------------------------------ */

/** One stretch of somebody's day. Times are seconds into the travel day. */
export type Segment =
  | { kind: 'home'; t0: number; t1: number; area: AreaId }
  | { kind: 'walk'; t0: number; t1: number; area: AreaId; from: string; to: string; speed: number }
  | { kind: 'wait'; t0: number; t1: number; area: AreaId; stop: string }
  | { kind: 'cross'; t0: number; t1: number; from: AreaId; to: AreaId };

/** Leaving home in the morning, from five, staggered over the next seven minutes. */
const LEAVE = secondsAt(5);
const STAGGER = 420;
/**
 * Turning for home from about eight in the evening, and never setting off for
 * somewhere new that would keep them out past it — so the slowest walker from
 * the far end of the city is still home before ten.
 */
const HOMEWARD = secondsAt(20.75);
const HOMEWARD_SPREAD = 240;
/** Home by a quarter to ten: nobody sets off anywhere that would keep them out past it. */
const HOME_BY = secondsAt(21.75);
/** How long a stop lasts: a minute or two, as a person would. */
const DWELL_MIN = 45;
const DWELL_SPREAD = 70;
/** Two stopped people this close would be one prompt too many. */
const APART = 8;

function seeded(text: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let a = h || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One way out of an area into another, as a traveller takes it. */
interface Hop {
  from: AreaId;
  to: AreaId;
  exit: string;
  entry: string;
  /** Metres across the street, walked unseen, when the hop goes by way of it. */
  cross: number;
}

const HOPS = new Map<AreaId, Hop[]>();

/**
 * Every way on from an area: its own gates, and every gate across the street
 * from its street gate.
 *
 * Read off the doors and the paths file, never off the collision: `gatesIn`
 * walks each doorway to find its mouth, which is a second's work for the tools
 * that write the file and a second's stall for a phone that only needs to know
 * which door leads where.
 */
export function hopsFrom(id: AreaId): Hop[] {
  const had = HOPS.get(id);
  if (had) return had;
  const out: Hop[] = [];
  for (const door of areaById(id).doors) {
    if (!travels(door)) continue;
    if (door.to !== TRANSIT_AREA) {
      const far = partnerOf(door, id);
      if (far) out.push({ from: id, to: door.to, exit: `g:${door.id}`, entry: `g:${far.id}`, cross: 0 });
      continue;
    }
    /* Out on to the street, across it, and in at another of its gates. */
    const onStreet = partnerOf(door, id);
    if (!onStreet) continue;
    for (const other of areaById(TRANSIT_AREA).doors) {
      if (other.id === onStreet.id || !TRAVEL_AREAS.includes(other.to) || other.to === id) continue;
      const beyond = partnerOf(other, TRANSIT_AREA);
      if (!beyond) continue;
      out.push({
        from: id,
        to: other.to,
        exit: `g:${door.id}`,
        entry: `g:${beyond.id}`,
        cross: PATHS.transit[`${onStreet.id}|${other.id}`] ?? 30,
      });
    }
  }
  HOPS.set(id, out);
  return out;
}

/** The shortest way from one area to another, as hops, by the metres walked. */
function routeBetween(from: AreaId, fromNode: string, to: AreaId): Hop[] {
  if (from === to) return [];
  const best = new Map<string, number>();
  const came = new Map<string, { key: string; hop: Hop }>();
  const start = `${from}|${fromNode}`;
  best.set(start, 0);
  const open: string[] = [start];
  while (open.length) {
    open.sort((a, b) => (best.get(a) ?? 0) - (best.get(b) ?? 0));
    const key = open.shift()!;
    const [area, node] = key.split('|') as [AreaId, string];
    if (area === to) {
      const hops: Hop[] = [];
      for (let k = key; k !== start; k = came.get(k)!.key) hops.unshift(came.get(k)!.hop);
      return hops;
    }
    for (const hop of hopsFrom(area)) {
      const walk = legBetween(area, node, hop.exit);
      if (!walk) continue;
      const cost = (best.get(key) ?? 0) + walk.len + hop.cross;
      const next = `${hop.to}|${hop.entry}`;
      if (cost >= (best.get(next) ?? Infinity)) continue;
      best.set(next, cost);
      came.set(next, { key, hop });
      open.push(next);
    }
  }
  return [];
}

/** Metres from a node to somebody's home, by the shortest way — cached, since a day asks it hundreds of times. */
const HOME_COST = new Map<string, number>();
function homeCost(area: AreaId, node: string, t: Traveller): number {
  const key = `${area}|${node}|${t.id}`;
  const had = HOME_COST.get(key);
  if (had !== undefined) return had;
  let cost = 0;
  let at = area;
  let from = node;
  for (const hop of routeBetween(area, node, t.home.area)) {
    cost += (legBetween(at, from, hop.exit)?.len ?? 0) + hop.cross;
    at = hop.to;
    from = hop.entry;
  }
  cost += legBetween(at, from, `h:${t.id}`)?.len ?? 0;
  HOME_COST.set(key, cost);
  return cost;
}

interface Held {
  id: string;
  t0: number;
  t1: number;
  /** Held by somebody at home, rather than passing through. */
  home?: boolean;
}

const PLANS = new Map<number, Record<string, Segment[]>>();

/**
 * Everybody's day, planned together.
 *
 * In time order, like the day itself: whoever is next to finish what they are
 * doing decides where to go, and can only go where there is room — an area
 * under its `CAPACITY`, a stop nobody within `APART` metres is standing at. If
 * nowhere will have them they linger half a minute and ask again. From their
 * own hour in the evening they walk home by the shortest way and stay there.
 *
 * Seeded by the day, so every device agrees about it, and cached, because a
 * frame asks it a question sixty times a second.
 */
export function planFor(day: number): Record<string, Segment[]> {
  const cached = PLANS.get(day);
  if (cached) return cached;
  const rng = seeded(`travel:${day}`);
  const plan: Record<string, Segment[]> = {};
  const inArea = new Map<AreaId, Held[]>();
  const atStop = new Map<string, Held[]>();
  const hold = <K>(map: Map<K, Held[]>, key: K, h: Held) => {
    const list = map.get(key);
    if (list) list.push(h);
    else map.set(key, [h]);
    return h;
  };
  const overlaps = (h: Held, t0: number, t1: number) => h.t0 < t1 && t0 < h.t1;

  interface Walker {
    t: Traveller;
    area: AreaId;
    node: string;
    time: number;
    prev: AreaId | null;
    homeward: number;
    /** What this traveller is holding in the area they are in, to be closed when they leave. */
    held: Held | null;
    done: boolean;
  }
  const walkers: Walker[] = TRAVELLERS.map((t) => {
    const leave = LEAVE + rng() * STAGGER;
    plan[t.id] = [{ kind: 'home', t0: 0, t1: leave, area: t.home.area }];
    const held = hold(inArea, t.home.area, { id: t.id, t0: 0, t1: leave, home: true });
    return { t, area: t.home.area, node: `h:${t.id}`, time: leave, prev: null, homeward: HOMEWARD - rng() * HOMEWARD_SPREAD, held, done: false };
  });

  const stopFree = (area: AreaId, stop: Stop, t0: number, t1: number, who: string): boolean => {
    for (const other of stopsIn(area)) {
      if (Math.hypot(other.x - stop.x, other.z - stop.z) >= APART && other.id !== stop.id) continue;
      if ((atStop.get(other.id) ?? []).some((h) => h.id !== who && overlaps(h, t0, t1))) return false;
    }
    /* And clear of anybody standing at home in that area at the time. */
    for (const other of TRAVELLERS) {
      if (other.id === who || other.home.area !== area) continue;
      if (Math.hypot(other.home.x - stop.x, other.home.z - stop.z) >= APART) continue;
      if ((inArea.get(area) ?? []).some((h) => h.id === other.id && h.home && overlaps(h, t0, t1))) return false;
    }
    return true;
  };
  const roomIn = (area: AreaId, t0: number, t1: number, who: string): boolean => {
    const n = (inArea.get(area) ?? []).filter((h) => h.id !== who && overlaps(h, t0, t1)).length;
    return n < (CAPACITY[area] ?? 1);
  };

  const push = (id: string, seg: Segment) => plan[id].push(seg);

  for (let guard = 0; guard < 20000; guard++) {
    const w = walkers.filter((x) => !x.done).sort((a, b) => a.time - b.time)[0];
    if (!w) break;
    const speed = w.t.speed;

    /* Their hour — or the last moment the walk home still gets them there
       before a quarter to ten, which for Isha from the far end of the city is
       well before it. */
    if (w.time >= w.homeward || w.time + homeCost(w.area, w.node, w.t) / speed >= HOME_BY - 30) {
      /* Home, by the shortest way, and stay there. */
      const route = routeBetween(w.area, w.node, w.t.home.area);
      let area = w.area;
      let node = w.node;
      let time = w.time;
      for (const hop of route) {
        const out = legBetween(area, node, hop.exit)!;
        push(w.t.id, { kind: 'walk', t0: time, t1: time + out.len / speed, area, from: node, to: hop.exit, speed });
        time += out.len / speed;
        if (w.held) w.held.t1 = time;
        if (hop.cross) {
          push(w.t.id, { kind: 'cross', t0: time, t1: time + hop.cross / speed, from: area, to: hop.to });
          time += hop.cross / speed;
        }
        area = hop.to;
        node = hop.entry;
        w.held = hold(inArea, area, { id: w.t.id, t0: time, t1: time });
      }
      const last = legBetween(area, node, `h:${w.t.id}`)!;
      push(w.t.id, { kind: 'walk', t0: time, t1: time + last.len / speed, area, from: node, to: `h:${w.t.id}`, speed });
      time += last.len / speed;
      push(w.t.id, { kind: 'home', t0: time, t1: DAY_SECONDS, area });
      if (w.held) w.held.t1 = time;
      hold(inArea, area, { id: w.t.id, t0: time, t1: DAY_SECONDS, home: true });
      w.done = true;
      continue;
    }

    /* On, somewhere with room. */
    const hops = hopsFrom(w.area)
      .map((h) => ({ h, r: rng() + (h.to === w.prev ? 1 : 0) }))
      .sort((a, b) => a.r - b.r)
      .map((x) => x.h);
    let moved = false;
    for (const hop of hops) {
      const out = legBetween(w.area, w.node, hop.exit);
      if (!out) continue;
      const tExit = w.time + out.len / speed;
      const tIn = tExit + hop.cross / speed;
      const stops = stopsIn(hop.to)
        .map((s) => ({ s, r: rng() }))
        .sort((a, b) => a.r - b.r)
        .map((x) => x.s);
      let chosen: { stop: Stop; arrive: number; leave: number } | null = null;
      for (const stop of stops) {
        const inLeg = legBetween(hop.to, hop.entry, `s:${stop.id}`);
        if (!inLeg) continue;
        const arrive = tIn + inLeg.len / speed;
        const leave = arrive + DWELL_MIN + rng() * DWELL_SPREAD;
        if (leave > w.homeward || leave + homeCost(hop.to, `s:${stop.id}`, w.t) / speed > HOME_BY) continue;
        if (!roomIn(hop.to, tIn, leave + 60, w.t.id)) break;
        if (!stopFree(hop.to, stop, arrive, leave, w.t.id)) continue;
        chosen = { stop, arrive, leave };
        break;
      }
      if (!chosen) continue;
      push(w.t.id, { kind: 'walk', t0: w.time, t1: tExit, area: w.area, from: w.node, to: hop.exit, speed });
      if (w.held) w.held.t1 = tExit;
      if (hop.cross) push(w.t.id, { kind: 'cross', t0: tExit, t1: tIn, from: w.area, to: hop.to });
      push(w.t.id, { kind: 'walk', t0: tIn, t1: chosen.arrive, area: hop.to, from: hop.entry, to: `s:${chosen.stop.id}`, speed });
      push(w.t.id, { kind: 'wait', t0: chosen.arrive, t1: chosen.leave, area: hop.to, stop: chosen.stop.id });
      hold(atStop, chosen.stop.id, { id: w.t.id, t0: chosen.arrive, t1: chosen.leave });
      w.held = hold(inArea, hop.to, { id: w.t.id, t0: tIn, t1: chosen.leave + 60 });
      let node = `s:${chosen.stop.id}`;
      let time = chosen.leave;
      /* Sometimes a second stop before moving on — somebody killing an
         afternoon crosses the square before they leave it. */
      if (rng() < 0.35) {
        for (const second of stopsIn(hop.to).filter((s) => s.id !== chosen!.stop.id)) {
          const move = legBetween(hop.to, node, `s:${second.id}`);
          if (!move) continue;
          const arrive = time + move.len / speed;
          const leave = arrive + DWELL_MIN * 0.7 + rng() * DWELL_SPREAD * 0.6;
          if (leave > w.homeward || leave + homeCost(hop.to, `s:${second.id}`, w.t) / speed > HOME_BY) continue;
          if (!stopFree(hop.to, second, arrive, leave, w.t.id)) continue;
          push(w.t.id, { kind: 'walk', t0: time, t1: arrive, area: hop.to, from: node, to: `s:${second.id}`, speed });
          push(w.t.id, { kind: 'wait', t0: arrive, t1: leave, area: hop.to, stop: second.id });
          hold(atStop, second.id, { id: w.t.id, t0: arrive, t1: leave });
          w.held.t1 = leave + 60;
          node = `s:${second.id}`;
          time = leave;
          break;
        }
      }
      w.prev = w.area;
      w.area = hop.to;
      w.node = node;
      w.time = time;
      moved = true;
      break;
    }
    if (!moved && (w.time + 30 >= w.homeward || w.time + 30 + homeCost(w.area, w.node, w.t) / speed >= HOME_BY - 30)) {
      /* Nowhere will have them before it is time to go home: go home. */
      w.homeward = w.time;
      continue;
    }
    if (!moved) {
      /*
       * Nowhere will have them yet: half a minute more where they are — if
       * where they are is still theirs for that long. Somebody else may have
       * been promised the stop beside it for the next half minute, in which
       * case they cross to another stop in the same area, and if there is
       * none they go home early rather than crowd anybody.
       *
       * "Still theirs" is the area as well as the stop. Staying on is a longer
       * claim on the area than the one they were let in with, and in the
       * meantime somebody else may have been let in on the strength of their
       * leaving — with eleven travellers that never happened, and with
       * twenty-two it put Bandit Keith and Yugi in a Market Row that holds one.
       */
      const until = w.time + 30;
      const stayOn = !w.held || roomIn(w.area, w.held.t1, until + 60, w.t.id);
      const segs = plan[w.t.id];
      const tail = segs[segs.length - 1];
      const here = STOPS.find((x) => `s:${x.id}` === w.node);
      if (tail && tail.kind === 'home' && Math.abs(tail.t1 - w.time) < 1e-6) {
        tail.t1 = until;
        if (w.held) w.held.t1 = Math.max(w.held.t1, until);
        w.time = until;
        continue;
      }
      if (here && tail && tail.kind === 'wait' && Math.abs(tail.t1 - w.time) < 1e-6 && stayOn && stopFree(w.area, here, w.time, until, w.t.id)) {
        tail.t1 = until;
        const h = (atStop.get(tail.stop) ?? []).find((x) => x.id === w.t.id && Math.abs(x.t1 - w.time) < 1e-6);
        if (h) h.t1 = until;
        if (w.held) w.held.t1 = Math.max(w.held.t1, until + 60);
        w.time = until;
        continue;
      }
      let crossed = false;
      for (const other of stopsIn(w.area)) {
        if (`s:${other.id}` === w.node) continue;
        const move = legBetween(w.area, w.node, `s:${other.id}`);
        if (!move) continue;
        const arrive = w.time + move.len / speed;
        const leave = arrive + DWELL_MIN * 0.7;
        if (leave + homeCost(w.area, `s:${other.id}`, w.t) / speed > HOME_BY) continue;
        if (w.held && !roomIn(w.area, w.held.t1, leave + 60, w.t.id)) break;
        if (!stopFree(w.area, other, arrive, leave, w.t.id)) continue;
        push(w.t.id, { kind: 'walk', t0: w.time, t1: arrive, area: w.area, from: w.node, to: `s:${other.id}`, speed });
        push(w.t.id, { kind: 'wait', t0: arrive, t1: leave, area: w.area, stop: other.id });
        hold(atStop, other.id, { id: w.t.id, t0: arrive, t1: leave });
        if (w.held) w.held.t1 = Math.max(w.held.t1, leave + 60);
        w.node = `s:${other.id}`;
        w.time = leave;
        crossed = true;
        break;
      }
      if (!crossed) w.homeward = w.time;
    }
  }

  PLANS.set(day, plan);
  if (PLANS.size > 4) PLANS.delete(PLANS.keys().next().value as number);
  return plan;
}

/** What somebody is doing at one moment, as the world needs to draw it. */
export type TravelState =
  | { kind: 'home'; area: AreaId }
  | { kind: 'crossing'; from: AreaId; to: AreaId }
  | { kind: 'walking'; area: AreaId; x: number; z: number; heading: number; speed: number; from: string; to: string; d: number; len: number; t0: number; t1: number }
  | { kind: 'waiting'; area: AreaId; x: number; z: number; facing: number; stop: string; t1: number };

/** The segment somebody is in at `t`, by bisection. */
export function segmentAt(segs: Segment[], t: number): Segment {
  let lo = 0;
  let hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid].t0 <= t) lo = mid;
    else hi = mid - 1;
  }
  return segs[lo];
}

/** Where a traveller is, and what they are doing, at second `t` of travel day `day`. */
export function travelState(id: string, day: number, t: number): TravelState | null {
  const segs = planFor(day)[id];
  if (!segs) return null;
  const seg = segmentAt(segs, t);
  if (seg.kind === 'home') return { kind: 'home', area: seg.area };
  if (seg.kind === 'cross') return { kind: 'crossing', from: seg.from, to: seg.to };
  if (seg.kind === 'wait') {
    const stop = STOPS.find((s) => s.id === seg.stop);
    const at = stop ?? (() => {
      const p = nodeAt(seg.area, `s:${seg.stop}`) ?? nodeAt(seg.area, seg.stop) ?? { x: 0, z: 0 };
      return { x: p.x, z: p.z, facing: 0 };
    })();
    return { kind: 'waiting', area: seg.area, x: at.x, z: at.z, facing: at.facing, stop: seg.stop, t1: seg.t1 };
  }
  const leg = legBetween(seg.area, seg.from, seg.to);
  if (!leg) return { kind: 'home', area: seg.area };
  const d = Math.min(leg.len, Math.max(0, (t - seg.t0) * seg.speed));
  const p = alongPath(leg.points, d);
  return { kind: 'walking', area: seg.area, x: p.x, z: p.z, heading: p.heading, speed: seg.speed, from: seg.from, to: seg.to, d, len: leg.len, t0: seg.t0, t1: seg.t1 };
}
