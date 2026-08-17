/**
 * Turns a sculpted character into one this game can actually serve.
 *
 * `import-rip.mjs` is the other door: a rip from the 3DS game arrives as SMD,
 * carries a skeleton and its own motion, and comes out a walking duelist. These
 * do not. They are single-mesh sculpts — generated, then finished by hand — and
 * what arrives is one watertight blob at photographic density with a 4K texture
 * on it. No skeleton, no skin, no clips. They are *statues*, and this script's
 * job is to make a statue small enough to put in a browser without making it
 * look like one.
 *
 * ## The numbers this exists for
 *
 * A source sculpt is 60–140 MB: two to three million triangles and one or more
 * 4096² JPEGs. Fourteen of them is 1.34 GB. That is not a "large" asset budget,
 * it is three separate impossibilities — GitHub refuses any file over 100 MB,
 * the whole of `public/` has to fit in a Vercel deployment, and the game is
 * built for two iPhones on mobile data. The vendored roster it stands beside is
 * 0.4–1.5 MB a character.
 *
 * So everything here is one decision applied four ways: *keep what a player can
 * see at conversation distance, drop what they cannot.*
 *
 * - **Triangles.** Simplified by meshoptimizer to a budget. Three million
 *   triangles on a 1.8 m body is roughly one per square millimetre of skin —
 *   detail no phone will ever resolve. What actually carries the likeness on a
 *   sculpt like this is the texture, not the mesh.
 * - **Maps that never get read.** The rig rebuilds every material as a matte
 *   `MeshStandardMaterial` and carries `map` across and nothing else — see
 *   `materialFor` in `premadeRig.ts`. So the normal and metallic-roughness
 *   images are downloaded, decoded, uploaded to the GPU and then ignored. On
 *   Bakura that is 9.3 MB of the 136. They are cut here rather than at runtime,
 *   because the cheapest texture is the one that was never in the file.
 * - **Texture size and format.** 4K JPEG down to one square of WebP. A head is
 *   a couple of hundred pixels tall on a phone held at arm's length.
 * - **Quantization.** Positions, normals and UVs from float32 down to integers
 *   via `KHR_mesh_quantization`, which three.js reads natively — no decoder to
 *   register, no wasm to serve, nothing to add to the loader. Draco and meshopt
 *   compress harder and both need a decoder wired into `GLTFLoader`; at these
 *   triangle counts the difference is a couple of hundred kilobytes and not
 *   worth the runtime dependency.
 *
 * ## What it deliberately does not do
 *
 * It does not rig anything. A sculpt has no bones, and inventing them is not a
 * conversion — it is Mixamo, or an afternoon in Blender. Everything imported
 * here stands perfectly still, and `premadeRig` is written to let it: a model
 * with no `Idle` is grounded on its own bounding box instead of on its idle
 * pose, and the clip-blending is skipped. That is the honest end state until
 * somebody rigs them.
 *
 *   node scripts/import-sculpt.mjs --in ~/Downloads/NPC/SolomonMuto.glb --id solomon
 *   node scripts/import-sculpt.mjs --in ~/Downloads/NPC --all
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
const has = (name) => argv.includes(`--${name}`);
/**
 * Finish a file that has already been through here and then been rigged.
 *
 * `scripts/blender/autorig.py` writes a GLB straight out of Blender, which
 * re-encodes the texture as PNG and drops the quantization — a 1.1 MB sculpt
 * comes back 2.3 MB with a skeleton in it. This re-runs only the parts that are
 * still true of a rigged file: the maps the renderer never reads, the texture
 * format, and the integer positions.
 *
 * Simplification and welding are skipped, and that is the point of the flag
 * rather than an optimisation. The mesh was already reduced on its first pass,
 * and re-welding one that now carries skin weights merges vertices that agree
 * on position and disagree on which bones move them — which is a seam that only
 * shows once the character is animating.
 */
const FINISH = has('finish');

const IN = flag('in', '');
const ID = flag('id', '');
const OUT_DIR = flag('outDir', 'public/models/cast');
/**
 * Triangles to keep. Fourteen of these stand in one field, so the budget is a
 * whole-scene number divided up rather than a per-model taste call: at 30k each
 * the cast is about 420k triangles, which is the same order as the grass that
 * is already there and well inside what a recent iPhone draws at 60fps.
 */
const TRIS = Number(flag('tris', 30000));
/** One side of the base-colour texture, in pixels. */
const TEX = Number(flag('tex', 1024));
/**
 * How far a vertex may move, as a fraction of the model's own size.
 *
 * The ratio asks for a triangle budget and this decides whether it may have it:
 * the simplifier stops at whichever binds first. At the default the three
 * armoured player models never got near the budget — Valkyrie Sentinel came out
 * at 86k against a 30k ask, and 4 MB — because their plate and feathers are
 * exactly the fine, high-curvature detail this protects. Loosened per model
 * where the silhouette can afford it.
 */
const ERROR = Number(flag('error', 0.0005));

if (!IN || (!ID && !has('all'))) {
  console.error('import-sculpt: --in <file.glb|dir> --id <model id>   (or --in <dir> --all)');
  console.error('               [--tris 30000] [--tex 1024] [--outDir public/models/cast]');
  process.exit(2);
}

/** `MaximilionPegasus.glb` → `maximilion-pegasus`, for `--all`. */
const idFromFile = (file) =>
  path
    .parse(file)
    .name.replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase();

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;

/** Triangles across every primitive in the document. */
function triangleCount(doc) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices();
      const count = indices ? indices.getCount() : prim.getAttribute('POSITION')?.getCount() ?? 0;
      n += Math.floor(count / 3);
    }
  }
  return n;
}

/** World-space bounds of the whole document, so the catalog can be told the truth. */
function bounds(doc) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const el = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, el);
        for (let a = 0; a < 3; a++) {
          if (el[a] < min[a]) min[a] = el[a];
          if (el[a] > max[a]) max[a] = el[a];
        }
      }
    }
  }
  return { min, max, size: max.map((v, i) => v - min[i]) };
}

/**
 * Strips every map the runtime will not read, and puts the surface back to
 * matte.
 *
 * The metallic factor is not cosmetic housekeeping: the re-exported sculpts
 * (the ones that went through pygltflib) come out with `metallicFactor: 1`,
 * which in any correct PBR renderer is a mirror with no environment to
 * reflect — that is to say, black. The rig happens to override it, so the bug
 * is invisible in the game and extremely visible the moment anybody opens the
 * file in a viewer to check their own work.
 */
function matte(doc) {
  let dropped = 0;
  for (const material of doc.getRoot().listMaterials()) {
    for (const drop of ['NormalTexture', 'MetallicRoughnessTexture', 'OcclusionTexture', 'EmissiveTexture']) {
      if (material[`get${drop}`]()) {
        material[`set${drop}`](null);
        dropped++;
      }
    }
    material.setMetallicFactor(0);
    material.setRoughnessFactor(1);
    /* Closed sculpts, so the back faces are never seen — and drawing them is
       twice the fill for nothing. Unlike the rips, there are no hair cards or
       eyelash planes here that would vanish. */
    material.setDoubleSided(false);
  }
  return dropped;
}

async function convert(file, id) {
  const before = (await fs.stat(file)).size;
  const doc = await io.read(file);
  const startTris = triangleCount(doc);
  const startTex = doc.getRoot().listTextures().length;

  const dropped = matte(doc);
  if (FINISH) {
    await doc.transform(
      /* The rig writes a key on every bone on every frame, including the
         scale channel that never leaves 1 and the translation that only the
         hips actually use. Resampling drops any key its neighbours already
         imply, which is most of them, and changes nothing about the motion. */
      resample(),
      prune(),
      textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [TEX, TEX], quality: 82 }),
      dedup()
    );
    const box = bounds(doc);
    const tris = triangleCount(doc);
    await fs.mkdir(OUT_DIR, { recursive: true });
    const out = path.join(OUT_DIR, `${id}.glb`);
    await doc.transform(quantize({ pattern: /^(POSITION|NORMAL|TEXCOORD_0)$/ }));
    await io.write(out, doc);
    const after = (await fs.stat(out)).size;
    console.log(
      `${id.padEnd(16)} ${(before / 1e6).toFixed(1).padStart(6)} MB → ${(after / 1e6).toFixed(2).padStart(5)} MB` +
        `   ${String(tris).padStart(6)} tris (rigged, unchanged)   ${startTex}→${doc.getRoot().listTextures().length} tex${dropped ? ` (-${dropped} maps)` : ''}`
    );
    return { id, out, box };
  }
  await doc.transform(
    dedup(),
    /* Simplify needs shared vertices to collapse; a sculpt exported per-corner
       has none, and the simplifier silently achieves nothing. */
    weld(),
    simplify({
      simplifier: MeshoptSimplifier,
      ratio: Math.min(1, TRIS / Math.max(1, startTris)),
      /* How far a vertex may move, as a fraction of the mesh's own size.
         These arrive normalised into a ~1.9-unit box, so this is about a
         millimetre on a person — under the budget the ratio asks for, the
         error is what actually stops the collapse, and a loose one eats
         fingers and noses first. */
      error: ERROR,
      lockBorder: false,
    }),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [TEX, TEX], quality: 82 }),
    dedup()
  );

  /* Measured here, one step before quantization, because that is the last
     moment the numbers mean anything. `quantize` rescales every position onto
     an integer grid and hangs the reciprocal off the node, so afterwards the
     attribute says "2.000 tall" for every model on earth and the real figure
     is only recoverable by walking the node transforms. The runtime does apply
     them — `Box3.setFromObject` — so the model is placed correctly either way;
     this is for the human reading the output. */
  const box = bounds(doc);
  const tris = triangleCount(doc);

  /* Last: everything above wants floats to work in. */
  await doc.transform(quantize({ pattern: /^(POSITION|NORMAL|TEXCOORD_0)$/ }));

  await fs.mkdir(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, `${id}.glb`);
  await io.write(out, doc);

  const after = (await fs.stat(out)).size;
  const tall = box.size.indexOf(Math.max(...box.size));
  console.log(
    `${id.padEnd(16)} ${(before / 1e6).toFixed(1).padStart(6)} MB → ${(after / 1e6).toFixed(2).padStart(5)} MB` +
      `   ${String(startTris).padStart(8)} → ${String(tris).padStart(6)} tris` +
      `   ${startTex}→${doc.getRoot().listTextures().length} tex${dropped ? ` (-${dropped} maps)` : ''}`
  );
  console.log(
    `${' '.repeat(16)} size [${box.size.map((v) => v.toFixed(3)).join(', ')}]` +
      `  tallest ${'XYZ'[tall]}  floor y=${box.min[1].toFixed(3)}`
  );
  return { id, out, box };
}

const stat = await fs.stat(IN);
const jobs = stat.isDirectory()
  ? (await fs.readdir(IN))
      .filter((f) => f.toLowerCase().endsWith('.glb'))
      .sort()
      .map((f) => ({ file: path.join(IN, f), id: idFromFile(f) }))
  : [{ file: IN, id: ID || idFromFile(IN) }];

console.log(`import-sculpt: ${jobs.length} model(s) → ${OUT_DIR}  (${TRIS} tris, ${TEX}px)\n`);
for (const job of jobs) await convert(job.file, job.id);
