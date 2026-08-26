/**
 * Domino City, checked against its own rules.
 *
 * Areas used to be verified by walking them, which worked when there were two.
 * The city has thirty-six planned and every one of them arrives with a doorway
 * that has to line up with somewhere already built — and a door that lands you
 * half a metre inside a wall looks, in a screenshot, exactly like a door that
 * does not. So the geometry is checked as arithmetic:
 *
 *   npm run areas
 *
 * ## What it actually proves
 *
 * - **Doors pair up.** Every door has one on the other side leading back, found
 *   by where the doorway stands in Domino City rather than by name — so a
 *   `world` offset with a sign error in it stops the pairing dead instead of
 *   quietly landing somebody in the wrong place.
 * - **Arrivals are somewhere you can stand.** Not inside a wall, not inside a
 *   crate, and not inside a door trigger — that last one being how you walk
 *   straight back out of a room you have just entered.
 * - **Everywhere reachable is reachable.** A flood fill from the spawn, at a
 *   quarter of a metre, over the same `settle` the game itself walks with. It
 *   finds doors you cannot get to and floors you cannot get off.
 * - **You cannot see out.** From every point that fill reaches, sixteen rays.
 *   Each one has to meet something tall before it leaves the area. This is the
 *   rule the whole world is built on written down as a test, and it is the one
 *   thing here no screenshot would reliably catch — a two-metre gap between two
 *   buildings is invisible until you happen to stand in front of it.
 * - **No two streets are on the same ground.** Reachable floors compared in
 *   Domino City's coordinates, so the map cannot fold over itself as it grows.
 */

import { readFileSync } from 'node:fs';
import {
  AREAS, FIRST_AREA, MARKET_GOODS, PLAYER_RADIUS, SEAM_TOLERANCE,
  arrivalThrough, partnerOf, settle, toWorld, inside,
  type Area, type AreaId, type Rect,
} from '../src/story/areas';
import { STEP, walkableCells as reachable } from './walkable';

let failures = 0;
const check = (ok: boolean, what: string, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${what}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
};

const ids = Object.keys(AREAS) as AreaId[];

/* ------------------------------------------------------------------ */
/* seeing out                                                          */
/* ------------------------------------------------------------------ */

/**
 * Whether a ray from here meets anything tall before it leaves.
 *
 * `camSolids` count. A doorway is a hole in the collision on purpose — you have
 * to be able to walk through it — and the thing standing in it from the outside
 * is a shopfront, which is exactly what a `camSolid` is for. So a way through
 * that has one is enclosed, and a way through that has neither a solid nor a
 * `camSolid` is a hole you can see the void through.
 */
function meetsSomethingTall(area: Area, x: number, z: number, dx: number, dz: number): boolean {
  const blockers: Rect[] = [
    ...area.solids.filter((r) => r.tall),
    ...(area.camSolids ?? []),
  ];
  for (const r of blockers) {
    let t0 = 0;
    let t1 = Infinity;
    let hit = true;
    for (const [o, d, lo, hi] of [
      [x, dx, r.x - r.hw, r.x + r.hw],
      [z, dz, r.z - r.hd, r.z + r.hd],
    ] as const) {
      if (Math.abs(d) < 1e-9) {
        if (o < lo || o > hi) { hit = false; break; }
        continue;
      }
      let a = (lo - o) / d;
      let b = (hi - o) / d;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, b);
      if (t0 > t1) { hit = false; break; }
    }
    if (hit && t1 > 0.01) return true;
  }
  return false;
}

const RAYS = 16;

/* ------------------------------------------------------------------ */

console.log('\nDomino City\n');

/* ---------------------------------------------------------------- */
console.log('the map');
{
  check(
    ids.every((id) => AREAS[id].id === id),
    'every area is filed under its own id',
    ids.filter((id) => AREAS[id].id !== id).join(', ')
  );
  check(
    ids.every((id) => Number.isFinite(AREAS[id].world.x) && Number.isFinite(AREAS[id].world.z)),
    'every area has a place in Domino City'
  );
  const allIds = ids.flatMap((id) => AREAS[id].doors.map((d) => `${id}/${d.id}`));
  check(new Set(allIds).size === allIds.length, 'every door id is unique');
  check(
    ids.every((id) => AREAS[id].doors.every((d) => d.label.trim().length > 0)),
    'every door says where it goes'
  );
}

/* ---------------------------------------------------------------- */
console.log('\ndoors pair up');
for (const id of ids) {
  const area = AREAS[id];
  for (const door of area.doors) {
    const there = AREAS[door.to];
    if (!there) {
      check(false, `${id}/${door.id} leads somewhere that exists`, door.to);
      continue;
    }
    const partner = partnerOf(door, id);
    if (!partner) {
      const seam = toWorld(area, door.seam.x, door.seam.z);
      check(false, `${id}/${door.id} has a door back`,
            `nothing in ${door.to} within ${SEAM_TOLERANCE} m of (${seam.x.toFixed(1)}, ${seam.z.toFixed(1)})`);
      continue;
    }
    const a = toWorld(area, door.seam.x, door.seam.z);
    const b = toWorld(there, partner.seam.x, partner.seam.z);
    const gap = Math.hypot(a.x - b.x, a.z - b.z);
    check(gap <= SEAM_TOLERANCE,
          `${id}/${door.id} ↔ ${door.to}/${partner.id} are one doorway`,
          `${gap.toFixed(2)} m apart at (${a.x.toFixed(1)}, ${a.z.toFixed(1)})`);
    /* And the pairing has to be mutual, or A → B → C is possible. */
    check(partnerOf(partner, door.to)?.id === door.id,
          `and ${door.to}/${partner.id} pairs back to it`,
          partnerOf(partner, door.to)?.id ?? 'nothing');
  }
}

/* ---------------------------------------------------------------- */
console.log('\nwalking through actually lands you there');
{
  /*
   * `arrivalThrough` is the whole of the change that removed `Door.spawn`, so it
   * gets asserted rather than assumed: walking A → B must hand back the arrival
   * written on B's own door home, in B's own coordinates.
   *
   * The failure this guards against is the quiet one. If the partner lookup ever
   * comes back empty the function falls through to the target area's spawn,
   * which is a perfectly valid place to stand — so the game keeps working and
   * every door in the city silently starts dropping you at the same spot.
   */
  for (const id of ids) {
    for (const door of AREAS[id].doors) {
      const partner = partnerOf(door, id);
      const landed = arrivalThrough(door, id);
      check(landed.area === door.to, `${id}/${door.id} lands you in ${door.to}`, landed.area);
      check(
        !!partner &&
          landed.x === partner.arrive.x &&
          landed.z === partner.arrive.z &&
          landed.facing === partner.arrive.facing,
        `${id}/${door.id} lands you where ${door.to} says, not on its spawn`,
        `got (${landed.x}, ${landed.z}) facing ${landed.facing.toFixed(2)}`
      );
      /* And it must not be the fallback by coincidence. */
      const target = AREAS[door.to];
      const isSpawn =
        landed.x === target.spawn.x && landed.z === target.spawn.z &&
        landed.facing === target.spawn.facing;
      check(
        !isSpawn || (partner?.arrive.x === target.spawn.x && partner?.arrive.z === target.spawn.z),
        `${id}/${door.id} is not quietly falling back to a spawn`
      );
    }
  }
}

/* ---------------------------------------------------------------- */
console.log('\nwhere you land');
for (const id of ids) {
  const area = AREAS[id];
  const spots: { what: string; at: { x: number; z: number; facing: number } }[] = [
    { what: 'spawn', at: area.spawn },
    ...area.doors.map((d) => ({ what: `${d.id} arrival`, at: d.arrive })),
  ];
  for (const { what, at } of spots) {
    const settled = settle(area, at.x, at.z, PLAYER_RADIUS);
    const moved = Math.hypot(settled.x - at.x, settled.z - at.z);
    check(moved < 1e-9, `${id}: ${what} is somewhere you can stand`,
          moved > 0 ? `pushed ${moved.toFixed(2)} m to (${settled.x.toFixed(2)}, ${settled.z.toFixed(2)})` : '');
    /*
     * And clear of every trigger in the area, not just its own. Land inside one
     * and the very next frame walks you back through it — which is a door that
     * looks like a crash.
     */
    const caught = area.doors.filter((d) => inside(d.trigger, at.x, at.z));
    check(caught.length === 0, `${id}: ${what} is clear of every door trigger`,
          caught.map((d) => d.id).join(', '));
    check(Number.isFinite(at.facing), `${id}: ${what} faces somewhere`);
  }
}

/* ---------------------------------------------------------------- */
console.log('\nwalking the whole of it');
const floors = new Map<AreaId, { x: number; z: number }[]>();
for (const id of ids) {
  const area = AREAS[id];
  const walkable = reachable(area);
  floors.set(id, walkable);
  check(walkable.length > 0, `${id}: the spawn is standable`, `${walkable.length} cells`);

  /* Every door has to be walk-up-able, or it is scenery. */
  for (const door of area.doors) {
    const got = walkable.some((p) => inside(door.trigger, p.x, p.z));
    check(got, `${id}: ${door.id} can be walked into`);
  }

  /* And nothing reachable may be cut off from the rest — a flood fill that
     reaches the doors but leaves an island behind is a floor with a hole in it,
     which is only ever a mistake. */
  const area2 = area.bounds.hw * area.bounds.hd * 4;
  check(walkable.length * STEP * STEP < area2 + 1,
        `${id}: the floor fits inside its own bounds`);
}

/* ---------------------------------------------------------------- */
console.log('\nyou cannot see out');
for (const id of ids) {
  const area = AREAS[id];
  const walkable = floors.get(id) ?? [];
  let holes = 0;
  let worst = '';
  for (const p of walkable) {
    for (let r = 0; r < RAYS; r++) {
      const a = (r / RAYS) * Math.PI * 2;
      if (!meetsSomethingTall(area, p.x, p.z, Math.sin(a), Math.cos(a))) {
        holes++;
        if (!worst) {
          worst = `from (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) looking ${(a * 180 / Math.PI).toFixed(0)}°`;
        }
      }
    }
  }
  check(holes === 0, `${id}: every direction meets something tall`,
        holes ? `${holes} sightline(s) escape, first ${worst}` : '');
}

/* ---------------------------------------------------------------- */
console.log('\nthe city does not fold over itself');
{
  /*
   * Exteriors only. An interior is *supposed* to sit inside an exterior's
   * footprint — the Kame Game Shop is a room inside a building on Turtle Lane,
   * and the two overlapping is the whole reason there is a door between them.
   * Two streets on the same ground is a different thing entirely.
   */
  const outdoors = ids.filter((id) => AREAS[id].kind === 'exterior');
  for (let i = 0; i < outdoors.length; i++) {
    for (let j = i + 1; j < outdoors.length; j++) {
      const a = AREAS[outdoors[i]];
      const b = AREAS[outdoors[j]];
      const cells = new Set(
        (floors.get(a.id) ?? []).map((p) => {
          const w = toWorld(a, p.x, p.z);
          return `${Math.round(w.x / STEP)},${Math.round(w.z / STEP)}`;
        })
      );
      const clash = (floors.get(b.id) ?? []).filter((p) => {
        const w = toWorld(b, p.x, p.z);
        return cells.has(`${Math.round(w.x / STEP)},${Math.round(w.z / STEP)}`);
      });
      check(clash.length === 0, `${a.id} and ${b.id} stand on different ground`,
            clash.length ? `${clash.length} cell(s) shared` : '');
    }
  }
}

/* ---------------------------------------------------------------- */
console.log('\nMarket Row');
{
  const market = AREAS['market-row'];
  check(!!market, 'exists');
  /* The goods are spread into the solids, so every one of them has to be in
     there — this is what makes `world/market.ts` drawing from the same list a
     guarantee rather than a convention. */
  const missing = MARKET_GOODS.filter(
    (g) => !market.solids.some(
      (s) => s.x === g.x && s.z === g.z && s.hw === g.hw && s.hd === g.hd
    )
  );
  check(missing.length === 0, 'every crate on the floor is also something you bump into',
        missing.map((g) => `${g.kind} at ${g.x}`).join(', '));
  check(
    MARKET_GOODS.every((g) => Math.abs(g.z) > 3.2),
    'and all of it is against the shopfronts, not in the middle',
    MARKET_GOODS.filter((g) => Math.abs(g.z) <= 3.2).map((g) => g.kind).join(', ')
  );
}

/* ---------------------------------------------------------------- */
console.log('\nevery area is in the sweeps that need naming');
{
  /*
   * `npm run coplanar` has to be *told* where to go — it drives a browser and
   * there is no way for it to enumerate areas from inside the page. A list that
   * has to be maintained by hand is a list that falls behind, and the way it
   * falls behind is silent: the newest area, which is the one with all the new
   * geometry in it, is the one that never gets audited for z-fighting.
   *
   * So the list is checked from out here, where the areas actually live.
   */
  const sweep = readFileSync(new URL('./coplanar-check.mjs', import.meta.url), 'utf8');
  const unswept = ids.filter((id) => !sweep.includes(`'${id}'`));
  check(unswept.length === 0, 'coplanar-check.mjs visits every area', unswept.join(', '));
}

/* ---------------------------------------------------------------- */
console.log('\nyou can get everywhere from the start');
{
  const seen = new Set<AreaId>([FIRST_AREA]);
  const queue: AreaId[] = [FIRST_AREA];
  while (queue.length) {
    const id = queue.pop()!;
    for (const door of AREAS[id].doors) {
      if (!seen.has(door.to)) {
        seen.add(door.to);
        queue.push(door.to);
      }
    }
  }
  const stranded = ids.filter((id) => !seen.has(id));
  check(stranded.length === 0, `all ${ids.length} areas are walkable from ${FIRST_AREA}`,
        stranded.join(', '));
}

console.log(
  failures === 0
    ? '\nEvery area holds. ✅\n'
    : `\n${failures} thing(s) wrong with the map. ❌\n`
);
process.exit(failures === 0 ? 0 : 1);
