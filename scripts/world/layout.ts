/**
 * The collision truth, written out for Blender.
 *
 *   npx tsx scripts/world/layout.ts grandpa-shop      # → .cache/world/grandpa-shop.layout.json
 *   npx tsx scripts/world/layout.ts                   # every area
 *
 * An area built in Blender is built *from* `areas.ts`: the bounds are its
 * floor and ceiling, the tall solids are its walls, a solid that names what
 * it draws as gets that thing to that footprint, the doors say where the
 * openings are. This is the one place the two meet, and the file carries a
 * hash of everything it was made from so `npm run world` can tell a GLB that
 * was built from an older room — the drawing must be rebuilt when the
 * collision moves, and a stale drawing is exactly the fault the laws are
 * about.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { AREAS, SHRINE_THINGS, STEP_LANE_CLIMB, type AreaId } from '../../src/story/areas';

const OUT = path.resolve(__dirname, '..', '..', '.cache', 'world');

export interface Layout {
  id: AreaId;
  name: string;
  kind: string;
  world: { x: number; z: number };
  bounds: { x: number; z: number; hw: number; hd: number };
  solids: Array<{ x: number; z: number; hw: number; hd: number; tall?: boolean; from?: number; to?: number; draw?: string }>;
  platforms: Array<{ x: number; z: number; hw: number; hd: number; y: number }>;
  doors: Array<{ id: string; to: string; label?: string; seam: { x: number; z: number }; trigger: { x: number; z: number; hw: number; hd: number }; arrive: { x: number; z: number; facing: number } }>;
  spawn: { x: number; z: number; facing: number };
  /** The runs a stepped lane is made of, for the rails and walls that follow them. */
  climb?: Array<{ east: number; west: number; from: number; to: number }>;
  /** What stands in a precinct, by kind — the solids are made from these and lose the kind. */
  things?: Array<{ kind: string; x: number; z: number; hw: number; hd: number; lit?: boolean }>;
  /** Of everything above, so a drawing can say what it was drawn from. */
  hash: string;
}

export function layoutOf(id: AreaId): Layout {
  const a = AREAS[id];
  const body = {
    id: a.id,
    name: a.name,
    kind: a.kind,
    world: a.world,
    bounds: a.bounds,
    solids: a.solids,
    platforms: a.platforms ?? [],
    doors: a.doors.map((d) => ({ id: d.id, to: d.to, label: d.label, seam: d.seam, trigger: d.trigger, arrive: d.arrive })),
    spawn: a.spawn,
    ...(id === 'step-lane' ? { climb: STEP_LANE_CLIMB } : {}),
    ...(id === 'domino-shrine' ? { things: SHRINE_THINGS } : {}),
  };
  const hash = createHash('sha1').update(JSON.stringify(body)).digest('hex').slice(0, 12);
  return { ...body, hash } as Layout;
}

export function writeLayout(id: AreaId): string {
  mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `${id}.layout.json`);
  writeFileSync(file, JSON.stringify(layoutOf(id), null, 1) + '\n');
  return file;
}

if (require.main === module) {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const ids = (Object.keys(AREAS) as AreaId[]).filter((id) => !only.length || only.includes(id));
  for (const id of ids) console.log(`• ${id} → ${path.relative(process.cwd(), writeLayout(id))}`);
}
