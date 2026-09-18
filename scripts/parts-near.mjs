/**
 * `npm run parts -- <area> x,y,z[,r] …`
 *
 * Every baked part of the area's GLB whose box comes within `r` (0.6 m) of
 * the point — the boxes the four box-reading gates read (`walls`, `footing`,
 * `embedded`, `coplanar`), straight out of the file, with no browser. When
 * `npm run walls` says a stop has nothing drawn near it and `npm run whystop`
 * has named the solid, this says what the file actually holds there.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
const [area, ...pts] = process.argv.slice(2);
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(`/Users/mike/Desktop/custom-tugioh-game/public/models/world/${area}.glb`);
const parts = [];
for (const n of doc.getRoot().listNodes()) {
  const ex = n.getExtras();
  if (!ex || !ex.parts) continue;
  /* Parts are written in area metres; the loader folds the node's transform into the vertices. */
  const t = [0, 0, 0];
  for (const p of JSON.parse(ex.parts)) parts.push({ name: n.getName(), p, t });
}
console.log(`${area}: ${parts.length} parts`);
for (const spec of pts) {
  const [x, y, z, r = 0.6] = spec.split(',').map(Number);
  console.log(`— near ${x},${y},${z} (within ${r}):`);
  for (const { name, p, t } of parts) {
    const [x0, y0, z0, x1, y1, z1, flag] = p;
    const dx = Math.max(x0 + t[0] - x, 0, x - (x1 + t[0]));
    const dy = Math.max(y0 + t[1] - y, 0, y - (y1 + t[1]));
    const dz = Math.max(z0 + t[2] - z, 0, z - (z1 + t[2]));
    if (Math.hypot(dx, dy, dz) <= r) console.log(`   ${name}: x ${(x0+t[0]).toFixed(2)}..${(x1+t[0]).toFixed(2)} y ${(y0+t[1]).toFixed(2)}..${(y1+t[1]).toFixed(2)} z ${(z0+t[2]).toFixed(2)}..${(z1+t[2]).toFixed(2)} flag ${flag}${p.length > 7 ? ' turned' : ''}`);
  }
}
