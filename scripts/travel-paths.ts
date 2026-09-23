/**
 * Every leg a traveller can walk, found once and written down.
 *
 *   npm run travel:paths
 *
 * For each area the tournament's duelists pass through: the gates (their
 * mouths, in the doorway), the stops (`STOPS`) and the homes of anybody who
 * lives there, and a path between every pair of them, found by `nav.ts`
 * against the area's own collision with every other door and every keep-out
 * walled off — so nobody strolls through a doorway they are not using, or
 * across Kaiba's forecourt. And for the street they cross unseen, how long each
 * crossing takes.
 *
 * The output is data the game imports (`src/story/generated/travel-paths.json`),
 * and it carries a fingerprint of the collision it was found against:
 * `npm run travel` refuses a file whose fingerprint is not the areas' own, the
 * same way `npm run drawn` refuses a room built from a layout that has moved.
 * Move a wall and this has to be run again — which is the point.
 */
import { writeFileSync } from 'node:fs';
import { areaById, standingOn, type AreaId, type Rect } from '../src/story/areas';
import { findPath, pathLength, type NavPoint } from '../src/story/nav';
import {
  KEEP_OUT,
  TRANSIT_AREA,
  TRAVEL_AREAS,
  TRAVELLERS,
  bandOf,
  gatesIn,
  stopsIn,
  travelFingerprint,
} from '../src/story/travel';

const OUT = 'src/story/generated/travel-paths.json';

interface NodeAt {
  id: string;
  p: NavPoint;
  y: number;
  /** The door this node stands in, whose trigger the leg may therefore enter. */
  door?: string;
}

const round = (n: number) => Math.round(n * 100) / 100;

function nodesOf(id: AreaId): NodeAt[] {
  const area = areaById(id);
  const out: NodeAt[] = [];
  for (const g of gatesIn(id)) out.push({ id: `g:${g.door.id}`, p: g.mouth, y: g.mouthY, door: g.door.id });
  for (const s of stopsIn(id)) out.push({ id: `s:${s.id}`, p: { x: s.x, z: s.z }, y: standingOn(area, s.x, s.z) });
  for (const t of TRAVELLERS) {
    if (t.home.area !== id) continue;
    out.push({ id: `h:${t.id}`, p: { x: t.home.x, z: t.home.z }, y: standingOn(area, t.home.x, t.home.z) });
  }
  return out;
}

function legsFor(id: AreaId, nodes: NodeAt[]) {
  const area = areaById(id);
  const band = bandOf(area);
  const legs: { a: string; b: string; len: number; points: number[] }[] = [];
  const failed: string[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      /* Nobody walks from one person's home to another's. A home to a gate is
         leaving or coming back; a home to a stop is somebody who has spent
         the evening in their own area walking the last few metres of it. */
      if (a.id.startsWith('h:') && b.id.startsWith('h:')) continue;
      const avoid: Rect[] = [
        ...areaById(id).doors.filter((d) => d.id !== a.door && d.id !== b.door).map((d) => d.trigger),
        ...(KEEP_OUT[id] ?? []),
      ];
      const found = findPath(area, a.p, a.y, b.p, { band, avoid, budget: 400_000 });
      if (!found) {
        failed.push(`${a.id} → ${b.id}`);
        continue;
      }
      const pts: number[] = [];
      for (const q of found.points) pts.push(round(q.x), round(q.z));
      legs.push({ a: a.id, b: b.id, len: round(pathLength(found.points)), points: pts });
    }
  }
  return { legs, failed };
}

/**
 * How long each crossing of the street takes, by gate pair: walked for the
 * length and never drawn. The shop door is not a way through anywhere.
 */
function transits() {
  const area = areaById(TRANSIT_AREA);
  const doors = area.doors.filter((d) => TRAVEL_AREAS.includes(d.to));
  const out: Record<string, number> = {};
  for (let i = 0; i < doors.length; i++) {
    for (let j = i + 1; j < doors.length; j++) {
      const a = doors[i];
      const b = doors[j];
      const avoid = area.doors.filter((d) => d.id !== a.id && d.id !== b.id).map((d) => d.trigger);
      const found = findPath(area, a.arrive, standingOn(area, a.arrive.x, a.arrive.z), b.arrive, { avoid });
      const len = found ? pathLength(found.points) : Math.hypot(a.arrive.x - b.arrive.x, a.arrive.z - b.arrive.z) * 1.3;
      out[`${a.id}|${b.id}`] = round(len);
      out[`${b.id}|${a.id}`] = round(len);
    }
  }
  return out;
}

const started = Date.now();
const areas: Record<string, { nodes: Record<string, number[]>; legs: { a: string; b: string; len: number; points: number[] }[] }> = {};
let failures = 0;
for (const id of TRAVEL_AREAS) {
  const t0 = Date.now();
  const nodes = nodesOf(id);
  const { legs, failed } = legsFor(id, nodes);
  areas[id] = {
    nodes: Object.fromEntries(nodes.map((n) => [n.id, [round(n.p.x), round(n.p.z)]])),
    legs,
  };
  failures += failed.length;
  console.log(
    `${id.padEnd(15)} ${String(nodes.length).padStart(2)} nodes, ${String(legs.length).padStart(3)} legs` +
      `${failed.length ? `, ${failed.length} with no way through: ${failed.join(', ')}` : ''} (${((Date.now() - t0) / 1000).toFixed(1)}s)`
  );
}
const file = {
  version: 1,
  fingerprint: travelFingerprint(),
  areas,
  transit: transits(),
};
writeFileSync(OUT, JSON.stringify(file) + '\n');
console.log(`\n→ ${OUT} in ${((Date.now() - started) / 1000).toFixed(1)}s${failures ? ` — ${failures} leg(s) could not be found ❌` : ' ✅'}`);
process.exit(failures ? 1 : 0);
