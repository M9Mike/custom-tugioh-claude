/**
 * Where a new traveller could live, found rather than guessed.
 *
 *   npx tsx scripts/travel-homes.ts
 *
 * A tool, not a gate. For each id and area in `WANT`, every metre of the area
 * is tried: standable with room (0.9 m), inside the travel band, out of the
 * forecourt, ten metres clear of every stop and every home already taken and
 * nine of every gate — and of those, the one nearest the middle of the area's
 * stops that a traveller can actually walk to from a gate. It prints lines to
 * paste into `TRAVELLERS`; `npm run travel` is still what says they are right.
 */
import { areaById, standingOn, type AreaId } from '../src/story/areas';
import { findPath, standsAt } from '../src/story/nav';
import { FINALIST_SPOTS, HOST_SPOT, STOPS, TRAVELLERS, bandOf, gatesIn, keptOut } from '../src/story/travel';

const WANT: [string, AreaId][] = [
  ['jaden', 'domino-high'],
  ['rex', 'station-plaza'],
  ['weevil', 'domino-shrine'],
  ['priestseto', 'domino-shrine'],
  ['yamimarik', 'old-cemetery'],
  ['odion', 'old-cemetery'],
  ['keith', 'black-crown'],
  ['bakura', 'black-crown'],
  ['mako', 'domino-station'],
  ['pegasus', 'central-towers'],
  ['ishizu', 'central-towers'],
];

/* Everybody not being placed, so a second run finds the same homes as the first. */
const homes = TRAVELLERS.filter((t) => !WANT.some(([id]) => id === t.id)).map((t) => ({ id: t.id, area: t.home.area, x: t.home.x, z: t.home.z }));
const out: string[] = [];
for (const [id, areaId] of WANT) {
  const area = areaById(areaId);
  const band = bandOf(area);
  const stops = STOPS.filter((s) => s.area === areaId);
  const gates = gatesIn(areaId);
  const cx = stops.reduce((a, s) => a + s.x, 0) / stops.length;
  const cz = stops.reduce((a, s) => a + s.z, 0) / stops.length;
  const b = area.bounds;
  const cands: { x: number; z: number; score: number; y: number }[] = [];
  for (let x = Math.ceil(b.x - b.hw + 2); x <= b.x + b.hw - 2; x += 1) {
    for (let z = Math.ceil(b.z - b.hd + 2); z <= b.z + b.hd - 2; z += 1) {
      if (keptOut(areaId, x, z)) continue;
      const y = standingOn(area, x, z);
      if (y > band[1]) continue;
      if (!standsAt(area, x, z, y, 0.9)) continue;
      if (stops.some((s) => Math.hypot(s.x - x, s.z - z) < 10)) continue;
      if (homes.some((h) => h.area === areaId && Math.hypot(h.x - x, h.z - z) < 10)) continue;
      if (gates.some((g) => Math.min(Math.hypot(g.mouth.x - x, g.mouth.z - z), Math.hypot(g.inner.x - x, g.inner.z - z)) < 9)) continue;
      if (areaId === HOST_SPOT.area && [HOST_SPOT, ...FINALIST_SPOTS].some((p) => Math.hypot(p.x - x, p.z - z) < 12)) continue;
      cands.push({ x, z, y, score: Math.hypot(x - cx, z - cz) });
    }
  }
  cands.sort((a, b2) => a.score - b2.score);
  let chosen = null as null | { x: number; z: number; y: number };
  for (const c of cands.slice(0, 60)) {
    const g = gates[0];
    const p = findPath(area, g.mouth, g.mouthY, { x: c.x, z: c.z }, { band, budget: 400_000 });
    if (p) {
      chosen = c;
      break;
    }
  }
  if (!chosen) {
    out.push(`${id}: NO HOME in ${areaId} (${cands.length} candidates)`);
    continue;
  }
  homes.push({ id, area: areaId, x: chosen.x, z: chosen.z });
  /* Face the nearest stop: somebody at home looks out at where the day goes. */
  const near = stops.reduce((a, s) => (Math.hypot(s.x - chosen!.x, s.z - chosen!.z) < Math.hypot(a.x - chosen!.x, a.z - chosen!.z) ? s : a));
  const facing = Math.atan2(near.x - chosen.x, near.z - chosen.z);
  out.push(`  { id: '${id}', home: { area: '${areaId}', x: ${chosen.x.toFixed(1)}, z: ${chosen.z.toFixed(1)}, facing: ${facing.toFixed(2)} } },  // ${cands.length} candidates, y ${chosen.y.toFixed(2)}`);
}
console.log(out.join('\n'));
