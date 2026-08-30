/**
 * Everywhere in an area a duelist can actually stand.
 *
 * Shared by the checks rather than living in `src/story/areas.ts`, because
 * nothing the game does at runtime needs it — the player walks one step at a
 * time and never asks where the whole floor is. The checks ask constantly:
 * "is this door reachable", "can you see out from anywhere", "do your feet sit
 * on the floor everywhere", and all three want the same answer computed the
 * same way.
 */

import { PLAYER_RADIUS, groundAt, hasStoreys, inside, settle, type Area } from '../src/story/areas';

/** A quarter of a metre: finer than the player is wide, coarse enough to be quick. */
export const STEP = 0.25;

/**
 * A point a duelist can occupy — `settle` leaves it exactly where it was put.
 *
 * `atY` is which floor they are on, and it matters the moment a building has
 * more than one: the balustrade round a first-floor gallery is not something
 * you walk into on the ground floor, and a fill that thinks it is reports the
 * shop's own front door as walled off from the shop's own floor. Left out, as
 * every outdoor area leaves it out, every solid applies exactly as before.
 */
export function standable(area: Area, x: number, z: number, atY = Number.NaN): boolean {
  const s = settle(area, x, z, PLAYER_RADIUS, atY);
  return Math.abs(s.x - x) < 1e-9 && Math.abs(s.z - z) < 1e-9;
}

/** The nearest grid point to the spawn that a duelist actually fits on. */
function snap(area: Area): { ix: number; iz: number } | null {
  const cx = Math.round(area.spawn.x / STEP);
  const cz = Math.round(area.spawn.z / STEP);
  for (let r = 0; r <= 8; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const ix = cx + dx;
        const iz = cz + dz;
        const x = ix * STEP;
        const z = iz * STEP;
        if (standable(area, x, z, hasStoreys(area) ? groundAt(area, x, z, 0) : Number.NaN)) {
          return { ix, iz };
        }
      }
    }
  }
  return null;
}

/**
 * Everywhere you can get to from the spawn, on a quarter-metre grid.
 *
 * Four-way rather than eight, deliberately: a diagonal step slips through a
 * corner a duelist could never fit round, and a fill that cheats is a fill that
 * reports doors as reachable when they are walled off.
 *
 * ## Door triggers absorb
 *
 * A trigger cell is reached and then not expanded from, because that is what the
 * game does: step into one and the next thing that happens is a different area.
 * The ground past it is standable and never stood on.
 *
 * That distinction is not academic — it is what the area check was wrong about
 * first time out. Both sides of the arch between Turtle Lane and Market Row let
 * a duelist walk a metre or two into the archway before the trigger fires, so a
 * fill that ran straight through reported seventy-five cells of Domino City
 * occupied by two areas at once. They are not: nobody is ever standing on them.
 * Filling past a door measures a floor plan; stopping at one measures the game.
 */
export function walkableCells(area: Area): { x: number; z: number; y: number }[] {
  const start = snap(area);
  if (!start) return [];
  const seen = new Set<string>();
  /* `y` is the floor the cell was reached on, which in a building with storeys
     is the only thing that says which of the surfaces stacked over that spot is
     the one under your feet. */
  const out: { x: number; z: number; y: number }[] = [];
  const edges = new Map<string, { x: number; z: number; y: number }>();
  /*
   * Each cell carries the height it was reached at.
   *
   * That is what makes the fill climb: a stair tread is only a candidate from
   * the tread below it, a gallery only from the flight that serves it, and the
   * railing round that gallery only applies to somebody standing on it. Walking
   * *into* an area always starts on the ground floor, which is what the 0 is.
   */
  /*
   * Flat places keep the answer they always had.
   *
   * Floor-awareness is only meaningful where floors are stacked, and switching
   * it on for a street changes what the check says about ground it has already
   * been signed off on — a podium's edge stops being somewhere the fill can
   * step onto from below, which is *more* correct and is not this area's
   * question. `hasStoreys` is the opt-in, and it is inferred so a new interior
   * cannot forget it.
   */
  const storeys = hasStoreys(area);
  const floorAt = (x: number, z: number, near: number) =>
    storeys ? groundAt(area, x, z, near) : Number.NaN;
  /*
   * A cell is a column *and* a floor.
   *
   * Keyed on the column alone — which is how this was written, and is right for
   * a street — the shop's ground floor claims every column in the building
   * before the fill ever reaches the stairs, and then the galleries over those
   * columns can never be entered. Whichever of the two the depth-first walk
   * happens to reach first wins, so the coverage was arbitrary: the second
   * gallery came out with nothing on it at all, and `npm run footing`, which
   * tests the floor under the cells the fill reaches, passed a storey nobody
   * could stand on by never looking at it.
   *
   * Bucketed to half a metre so a flight of treads is a handful of visits to a
   * column and not one per tread.
   */
  const cellKey = (ix: number, iz: number, y: number) =>
    `${ix},${iz},${Number.isFinite(y) ? Math.round(y / 0.5) : 0}`;
  const startY = floorAt(start.ix * STEP, start.iz * STEP, 0);
  const queue: { ix: number; iz: number; y: number }[] = [{ ...start, y: startY }];
  seen.add(cellKey(start.ix, start.iz, startY));

  while (queue.length) {
    const { ix, iz, y } = queue.pop()!;
    const x = ix * STEP;
    const z = iz * STEP;
    out.push({ x, z, y });
    /* On the floor this cell was reached on: a trigger scoped to the ground
       floor is not a door on the gallery above it. */
    if (area.doors.some((d) => {
      if (!inside(d.trigger, x, z)) return false;
      if (!Number.isFinite(y)) return true;
      return y >= (d.trigger.from ?? -Infinity) - 0.5 && y <= (d.trigger.to ?? Infinity);
    })) continue;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = ix + dx;
      const nz = iz + dz;
      const ny = floorAt(nx * STEP, nz * STEP, y);
      const k = cellKey(nx, nz, ny);
      if (seen.has(k)) continue;
      seen.add(k);
      if (standable(area, nx * STEP, nz * STEP, ny)) {
        queue.push({ ix: nx, iz: nz, y: ny });
        continue;
      }
      /*
       * Where the wall actually stops you.
       *
       * A grid anchored to the spawn lands on multiples of a quarter metre and
       * nothing else, so the closest it ever gets to a shopfront is whatever
       * happens to fall inside — and the last nine centimetres, which is
       * precisely where a player ends up when they walk into something and keep
       * pushing, are never sampled at all.
       *
       * That is not a rounding detail. Market Row's shopfronts have a timber
       * stallboard along the bottom that sticks 25 cm out into the arcade, and
       * the grid missed the strip you can stand on by 9 cm — so `npm run
       * footing` passed while walking along the shops put both feet inside the
       * wood. Mike found it in about a minute.
       *
       * So every cell the fill *cannot* enter is settled instead, and the
       * position it settles to — hard against the thing that stopped it — is
       * checked like anywhere else you can stand.
       */
      const at = settle(area, nx * STEP, nz * STEP, PLAYER_RADIUS, y);
      const ay = storeys ? groundAt(area, at.x, at.z, y) : Number.NaN;
      const key = `${Math.round(at.x * 1000)},${Math.round(at.z * 1000)}`;
      /* On the floor it was pushed back onto, which for a duelist walking into
         a gallery's balustrade is the gallery and not the shop below it. */
      if (!edges.has(key)) edges.set(key, { ...at, y: ay });
    }
  }
  return out.concat([...edges.values()]);
}
