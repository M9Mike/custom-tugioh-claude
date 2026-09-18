/**
 * The drawn thing is the colliding thing — for an area built in Blender.
 *
 *   npx tsx scripts/world-check.ts            # every built area
 *   npx tsx scripts/world-check.ts grandpa-shop
 *
 * A procedural area reads its numbers from `areas.ts` at run time and cannot
 * drift from them. An area built in Blender is a *file*, made from those
 * numbers on the day it was built, and the day somebody moves a counter in
 * `areas.ts` the file is a drawing of a room that no longer exists — every
 * gate stays green, because `footing` and `walls` read the file, and the
 * player walks into a counter that is not there. So the GLB carries the hash
 * of the layout it was built from, and this refuses one that is stale.
 *
 * And the rest of what a built area promises:
 *
 *   - every baked mesh says what it was baked from (`parts`), or four gates
 *     cannot see inside it;
 *   - every solid that names what it draws as has something drawn in it;
 *   - it fits the budget a phone can carry — bytes, triangles, textures;
 *   - everything it stands in the room is in the assets manifest, so a fresh
 *     checkout can build it again.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { GLB_OF } from '../src/components/story/world/files';
import { layoutOf } from './world/layout';
import { AREAS, type AreaId } from '../src/story/areas';

const ROOT = path.resolve(__dirname, '..');
const DRESSINGS = path.join(ROOT, 'data', 'world');
const MODELS = path.join(ROOT, 'public', 'models', 'world');
const MANIFEST = JSON.parse(readFileSync(path.join(DRESSINGS, 'assets.json'), 'utf8')) as { textures: string[]; models: string[] };

/* What a phone can carry for one room. Numbers, so they can be argued with. */
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_TRIANGLES = 120_000;
const MAX_TEXTURES = 96;
const MAX_TEXTURE_SIDE = 1024;

let checks = 0;
const problems: string[] = [];
function ok(pass: boolean, label: string, why?: string) {
  checks += 1;
  console.log(`  ${pass ? '✅' : '❌'} ${label}${pass || !why ? '' : ` — ${why}`}`);
  if (!pass) problems.push(`${label}${why ? ` — ${why}` : ''}`);
}

interface Dressing {
  recipe: string;
  surfaces: Record<string, { tex?: string; colour?: string }>;
  props?: Array<{ model: string }>;
  lamps?: Array<{ fixture?: string | null }>;
}

async function checkArea(id: AreaId, io: NodeIO) {
  console.log(`\n${AREAS[id].name}`);
  const dressing = JSON.parse(readFileSync(path.join(DRESSINGS, `${id}.dressing.json`), 'utf8')) as Dressing;
  const file = path.join(MODELS, `${id}.glb`);
  ok(existsSync(file), 'the room has been built', `${path.relative(ROOT, file)} is missing — npm run world -- ${id}`);
  if (!existsSync(file)) return;

  const layout = layoutOf(id);
  const doc = await io.read(file);
  const root = doc.getRoot();
  const scene = root.listScenes()[0];
  const extras = (scene?.getExtras() ?? {}) as { layoutHash?: string; area?: string };
  ok(extras.area === id, 'the file names its area', `says ${extras.area ?? 'nothing'}`);
  ok(GLB_OF[id] === `/models/world/${id}.glb`, 'the file list names it', `world/files.ts has ${GLB_OF[id] ?? 'nothing'} for ${id} — the doors cannot prefetch it`);
  ok(
    extras.layoutHash === layout.hash,
    'the drawing is of the room as it stands',
    `built from ${extras.layoutHash ?? 'no hash'}, areas.ts is now ${layout.hash} — npm run world -- ${id}`
  );

  /* parts on every bake, and the parts well-formed */
  let bakes = 0;
  const bare: string[] = [];
  const malformed: string[] = [];
  const partCentres: Array<[number, number]> = [];
  const propCentres: Array<[number, number]> = [];
  let triangles = 0;
  const walk = (n: import('@gltf-transform/core').Node) => {
    const mesh = n.getMesh();
    const name = n.getName();
    if (mesh) {
      for (const p of mesh.listPrimitives()) {
        const idx = p.getIndices();
        triangles += (idx ? idx.getCount() : p.getAttribute('POSITION')?.getCount() ?? 0) / 3;
      }
      const ex = n.getExtras() as { parts?: string };
      if (name.startsWith('bake:')) {
        bakes += 1;
        if (!ex.parts) bare.push(name);
        else {
          try {
            const parts = JSON.parse(ex.parts) as number[][];
            if (!Array.isArray(parts) || !parts.length || parts.some((r) => (r.length !== 7 && r.length !== 12) || r.some((v) => typeof v !== 'number'))) malformed.push(name);
            else for (const r of parts) partCentres.push([(r[0] + r[3]) / 2, (r[2] + r[5]) / 2]);
          } catch {
            malformed.push(name);
          }
        }
      } else {
        const t = n.getWorldTranslation();
        propCentres.push([t[0], t[2]]);
      }
    }
    for (const c of n.listChildren()) walk(c);
  };
  for (const n of scene.listChildren()) walk(n);
  ok(bakes > 0, 'something was baked', 'no bake:* meshes in the file');
  ok(bare.length === 0, 'every bake says what it was baked from', bare.slice(0, 5).join(', '));
  ok(malformed.length === 0, 'and says it as boxes', malformed.slice(0, 5).join(', '));

  /* every named solid has something drawn in it */
  const inside = (c: [number, number], s: { x: number; z: number; hw: number; hd: number }) =>
    Math.abs(c[0] - s.x) <= s.hw + 0.05 && Math.abs(c[1] - s.z) <= s.hd + 0.05;
  const empty = layout.solids.filter((s) => s.draw && !partCentres.some((c) => inside(c, s)) && !propCentres.some((c) => inside(c, s)));
  ok(empty.length === 0, 'every solid that names what it draws as has it drawn', empty.map((s) => `${s.draw} at (${s.x}, ${s.z})`).join(', '));

  /* the budget */
  const bytes = statSync(file).size;
  ok(bytes <= MAX_BYTES, `the file fits a phone (${(bytes / 1048576).toFixed(1)} MB)`, `over ${MAX_BYTES / 1048576} MB`);
  ok(triangles <= MAX_TRIANGLES, `and so do its triangles (${Math.round(triangles)})`, `over ${MAX_TRIANGLES}`);
  const textures = root.listTextures();
  ok(textures.length <= MAX_TEXTURES, `and its textures (${textures.length})`, `over ${MAX_TEXTURES}`);
  const big = textures.filter((t) => { const s = t.getSize(); return s && (s[0] > MAX_TEXTURE_SIDE || s[1] > MAX_TEXTURE_SIDE); });
  ok(big.length === 0, 'no texture is bigger than the optimiser allows', `${big.length} over ${MAX_TEXTURE_SIDE}`);

  /* the manifest */
  const texIds = Object.values(dressing.surfaces).map((s) => s.tex).filter((t): t is string => !!t);
  const missingTex = [...new Set(texIds)].filter((t) => !MANIFEST.textures.includes(t));
  ok(missingTex.length === 0, 'every texture it uses is in the assets manifest', missingTex.join(', '));
  const modelIds = [
    ...(dressing.props ?? []).map((p) => p.model),
    ...(dressing.lamps ?? []).map((l) => l.fixture).filter((f): f is string => !!f),
  ];
  const missingModels = [...new Set(modelIds)].filter((m) => !MANIFEST.models.includes(m));
  ok(missingModels.length === 0, 'and every model', missingModels.join(', '));
}

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const built = readdirSync(DRESSINGS)
    .filter((f) => f.endsWith('.dressing.json'))
    .map((f) => f.replace('.dressing.json', '') as AreaId)
    .filter((id) => id in AREAS && (!only.length || only.includes(id)));
  console.log(`\nThe drawn thing is the colliding thing — ${built.length} built area(s)`);
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  for (const id of built) await checkArea(id, io);
  console.log(`\n${checks} checks`);
  if (problems.length) {
    console.log(`\n❌ ${problems.length} problem(s):`);
    for (const p of problems) console.log(`   ${p}`);
    process.exitCode = 1;
  } else {
    console.log('\nEvery built room is the room that stands. ✅');
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
