/**
 * Brings in a character that arrives already rigged, one at a time.
 *
 * This is the third door into `public/models`, and the difference between it
 * and `import-sculpt.mjs` is where the skeleton comes from. That one takes a
 * static sculpt and the skeleton is fitted afterwards; this one takes a model
 * that was rigged against its own body by the tool that made it, and the only
 * job left is to make the file small enough to serve.
 *
 * ## Why this exists at all
 *
 * There was a version of this project where one skeleton was fitted to every
 * sculpt automatically. It failed, and it failed for a reason worth writing
 * down: these characters are each posed individually. Mai stands with her
 * weight on one hip, Sandra Afrika with her ankles crossed. An automatic fit
 * places joints from a table of average anatomy, so on a crossed stance the
 * left leg bone runs through the right calf, the weights cross over, and the
 * model comes back with a distorted face and mangled ankles. A rig built
 * against the actual body does not have that problem, because it was never
 * guessing where the body was.
 *
 * So the rule is one character at a time, rigged at source.
 *
 * ## What it actually does
 *
 * Almost nothing to the geometry, on purpose. The mesh and its weights are the
 * part that was got right and there is no version of touching them that makes
 * them better:
 *
 * - **Clips are renamed**, and that is the only edit to the animation. The
 *   exporters call them `Walking` and `Running`; `premadeRig` plays `Walk` and
 *   `Run` by name and silently stands still if it cannot find them.
 * - **The duplicate texture goes.** These bundles ship the same image twice —
 *   two 17 MB PNGs byte-for-byte identical, 34 of the file's 39 MB — because
 *   the material references one and the other is left over. `dedup` collapses
 *   them to the one that is used.
 * - **Maps the renderer never reads go.** `premadeRig` rebuilds every material
 *   matte and carries `map` and nothing else, so a normal or
 *   metallic-roughness image is downloaded, decoded, uploaded and ignored.
 * - **Texture to WebP, positions to integers.** The two things that make a
 *   39 MB file a 2 MB one without touching a vertex.
 *
 * **Simplification is deliberately not run.** It is the default in
 * `import-sculpt` because a raw Meshy sculpt is three million triangles; a
 * rigged bundle is a hundred thousand, which quantizes to about two megabytes
 * on its own. Decimating a skinned mesh redistributes its weights, and there is
 * no reason to spend quality on a saving that is not needed. Pass `--tris` if a
 * particular character ever does need it.
 *
 *   npm run rigged -- --in ~/Downloads/MaiValentine.glb --id mai --dir cast
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup,
  prune,
  quantize,
  resample,
  simplify,
  textureCompress,
  weld,
} from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};

const IN = flag('in', '');
const ID = flag('id', '');
const DIR = flag('dir', 'cast');
/**
 * Texture size and quality, defaulting to whatever the bundle shipped.
 *
 * These were 2048 and 85, and that was a reflex rather than a decision: the
 * sculpt pipeline halves textures because a raw Meshy sculpt is a hundred
 * megabytes and something has to give. Nothing has to give here. A rigged
 * bundle is four megabytes after the duplicate texture goes, the project is on
 * Vercel Pro, and GitHub's only hard limit is 100 MB a file — so downscaling
 * Mai's 4096² atlas to 2048 was throwing away three quarters of her face to
 * save four hundred kilobytes nobody was short of.
 *
 * `--tex` still exists for a character that genuinely needs it. The default is
 * now to keep what was authored.
 */
const TEX = Number(flag('tex', 4096));
const QUALITY = Number(flag('quality', 95));
const TRIS = flag('tris', '') ? Number(flag('tris')) : 0;
const OUT_DIR = flag('outDir', `public/models/${DIR}`);

if (!IN || !ID) {
  console.error('import-rigged: --in <file.glb> --id <model id> [--dir cast|players]');
  console.error('               [--tex 2048] [--tris N to decimate]');
  process.exit(2);
}

/**
 * What the exporters call the clips, and what the game calls them.
 *
 * Matched case-insensitively on the whole name. Anything unrecognised is left
 * alone and reported, rather than guessed at — a clip this does not know about
 * is a question for a human, not something to rename hopefully.
 */
const CLIP_NAMES = {
  walking: 'Walk',
  walk: 'Walk',
  running: 'Run',
  run: 'Run',
  idle: 'Idle',
  idling: 'Idle',
  standing: 'Idle',
  tpose: null,
  'a-pose': null,
};

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;

const triangleCount = (doc) => {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      n += Math.floor((idx ? idx.getCount() : prim.getAttribute('POSITION')?.getCount() ?? 0) / 3);
    }
  }
  return n;
};

const before = (await fs.stat(IN)).size;
const doc = await io.read(IN);
const root = doc.getRoot();

/* ---- clips ---- */
const renamed = [];
for (const anim of root.listAnimations()) {
  const from = anim.getName();
  const key = from.toLowerCase().replace(/[\s_]/g, '');
  if (!(key in CLIP_NAMES)) {
    console.log(`  ? unrecognised clip "${from}" — left as it is`);
    continue;
  }
  const to = CLIP_NAMES[key];
  if (to === null) {
    anim.dispose();
    renamed.push(`${from} -> dropped`);
    continue;
  }
  anim.setName(to);
  renamed.push(`${from} -> ${to}`);
}

/* ---- materials: matte, and only the map the renderer reads ---- */
let droppedMaps = 0;
for (const material of root.listMaterials()) {
  for (const drop of ['NormalTexture', 'MetallicRoughnessTexture', 'OcclusionTexture', 'EmissiveTexture']) {
    if (material[`get${drop}`]()) {
      material[`set${drop}`](null);
      droppedMaps++;
    }
  }
  material.setMetallicFactor(0);
  material.setRoughnessFactor(1);
  material.setDoubleSided(false);
}

const startTris = triangleCount(doc);
const startTex = root.listTextures().length;

const steps = [dedup(), prune()];
if (TRIS) {
  steps.push(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, TRIS / startTris), error: 0.001 }));
}
steps.push(
  resample(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [TEX, TEX], quality: QUALITY }),
  dedup(),
  prune()
);
await doc.transform(...steps);

/*
 * Last. three.js reads KHR_mesh_quantization natively, with no decoder to
 * register, including on a skin.
 *
 * The skinning attributes are in the list for a reason: on a rigged bundle they
 * are most of the file. Mai carries 74,436 vertices, and `WEIGHTS_0` at float32
 * is 16 bytes of every one of them — 1.2 MB on its own, for four numbers that
 * are all between zero and one. `JOINTS_0` is worse value still, holding an
 * index into a list of twenty-four bones in a type that can count to 65,535.
 * As normalised bytes they cost a quarter of that and there is nothing to lose:
 * a weight is a blend factor, and no skin has ever needed the 24th decimal
 * place of one.
 */
await doc.transform(
  quantize({
    pattern: /^(POSITION|NORMAL|TEXCOORD_0|WEIGHTS_0|JOINTS_0)$/,
    quantizeWeight: 8,
  })
);

await fs.mkdir(OUT_DIR, { recursive: true });
const out = path.join(OUT_DIR, `${ID}.glb`);
await io.write(out, doc);
const after = (await fs.stat(out)).size;

const skin = root.listSkins()[0];
console.log(`import-rigged: ${ID} -> ${out}`);
console.log(`  ${(before / 1e6).toFixed(1)} MB -> ${(after / 1e6).toFixed(2)} MB`);
console.log(`  ${startTris} -> ${triangleCount(doc)} tris   ${startTex} -> ${root.listTextures().length} tex` +
  (droppedMaps ? `  (-${droppedMaps} unread maps)` : ''));
console.log(`  joints ${skin ? skin.listJoints().length : 0}   clips ${root.listAnimations().map((a) => a.getName()).join(', ') || '(none)'}`);
for (const r of renamed) console.log(`  clip ${r}`);

const missing = ['Idle', 'Walk', 'Run'].filter(
  (n) => !root.listAnimations().some((a) => a.getName() === n)
);
if (missing.length) console.log(`  ! still missing: ${missing.join(', ')}`);
if (!skin) {
  console.error('  ! no skin — this file is not rigged');
  process.exit(1);
}
