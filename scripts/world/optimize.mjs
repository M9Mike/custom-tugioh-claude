/**
 * Makes an exported area small enough to ship.
 *
 *   node scripts/world/optimize.mjs in.glb out.glb [--tex=1024]
 *
 * Blender writes what it was given: JPEGs at the size they were fetched, and
 * every vertex at full precision. This is the same pass the character
 * models go through — dedup, prune, weld — with the textures re-encoded as
 * WebP at a bounded size and the geometry meshopt-compressed, which three.js
 * decodes with the module already shipped in the bundle. What it must not
 * touch: the `parts` extras on every baked mesh and the layout hash on the
 * scene, which is what the checks and `npm run world` read.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, simplify, simplifyPrimitive, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { stat } from 'node:fs/promises';

const [input, output] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!input || !output) {
  console.error('usage: node scripts/world/optimize.mjs in.glb out.glb [--tex=1024]');
  process.exit(1);
}
const TEX = Number((process.argv.find((a) => a.startsWith('--tex=')) ?? '--tex=1024').slice(6));

const RATIO = Number((process.argv.find((a) => a.startsWith('--simplify=')) ?? '--simplify=0.3').slice(11));

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const doc = await io.read(input);
const trisOf = (d) => d.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => {
  const idx = p.getIndices();
  return k + (idx ? idx.getCount() : p.getAttribute('POSITION')?.getCount() ?? 0) / 3;
}, 0), 0);
const trisBefore = Math.round(trisOf(doc));
/* A picture with holes in it — a tree on two crossed planes — is a mask, not
   a blend: Blender 4.2 exports its clip as BLEND, and a blended plane sorts
   against everything behind it and casts no shadow. Cut at half. */
for (const m of doc.getRoot().listMaterials()) {
  if (m.getAlphaMode() === 'BLEND' && m.getBaseColorTexture()) {
    m.setAlphaMode('MASK');
    m.setAlphaCutoff(0.5);
  }
}

await doc.transform(
  dedup(),
  prune(),
  weld(),
  /* The props are photogrammetry-dense — a cardboard box arrives at
     seventeen thousand triangles, a set of books at sixty-seven — and every
     triangle is drawn once per shadow pass, which with three pendants is
     nineteen times a frame. The simplifier keeps the silhouette to a
     millimetre and throws the rest away; the kit's own boxes have nothing
     to lose and lose nothing. */
  simplify({ simplifier: MeshoptSimplifier, ratio: RATIO, error: 0.001 }),
  /* And again, harder, on any prop still over budget: a lamp post is not
     worth twenty-five thousand triangles at four metres. */
  async (document) => {
    const HEAVY = 2500;
    for (const mesh of document.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        for (let pass = 0; pass < 3; pass++) {
          const idx = prim.getIndices();
          const tris = (idx ? idx.getCount() : prim.getAttribute('POSITION')?.getCount() ?? 0) / 3;
          if (tris <= HEAVY) break;
          simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: Math.max(0.05, HEAVY / tris), error: 0.01 * (pass + 1) });
        }
      }
    }
  },
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [TEX, TEX], quality: 82 }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  prune()
);
const trisAfter = Math.round(trisOf(doc));
await io.write(output, doc);
const before = (await stat(input)).size;
const after = (await stat(output)).size;
const root = doc.getRoot();
const meshes = root.listMeshes().length;
const textures = root.listTextures().length;
console.log(`• ${output}: ${(before / 1048576).toFixed(1)} MB → ${(after / 1048576).toFixed(1)} MB, ${meshes} meshes, ${textures} textures, ${trisBefore} → ${trisAfter} triangles`);
