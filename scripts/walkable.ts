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

import { PLAYER_RADIUS, inside, settle, type Area } from '../src/story/areas';

/** A quarter of a metre: finer than the player is wide, coarse enough to be quick. */
export const STEP = 0.25;

/** A point a duelist can occupy — `settle` leaves it exactly where it was put. */
export function standable(area: Area, x: number, z: number): boolean {
  const s = settle(area, x, z, PLAYER_RADIUS);
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
        if (standable(area, ix * STEP, iz * STEP)) return { ix, iz };
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
export function walkableCells(area: Area): { x: number; z: number }[] {
  const start = snap(area);
  if (!start) return [];
  const seen = new Set<string>();
  const out: { x: number; z: number }[] = [];
  const edges = new Map<string, { x: number; z: number }>();
  const queue = [start];
  seen.add(`${start.ix},${start.iz}`);

  while (queue.length) {
    const { ix, iz } = queue.pop()!;
    const x = ix * STEP;
    const z = iz * STEP;
    out.push({ x, z });
    if (area.doors.some((d) => inside(d.trigger, x, z))) continue;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = ix + dx;
      const nz = iz + dz;
      const k = `${nx},${nz}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (standable(area, nx * STEP, nz * STEP)) {
        queue.push({ ix: nx, iz: nz });
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
      const at = settle(area, nx * STEP, nz * STEP, PLAYER_RADIUS);
      const key = `${Math.round(at.x * 1000)},${Math.round(at.z * 1000)}`;
      if (!edges.has(key)) edges.set(key, at);
    }
  }
  return out.concat([...edges.values()]);
}
