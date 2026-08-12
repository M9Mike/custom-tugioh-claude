/**
 * What is actually inside a `.glb`.
 *
 * Every model in `public/models/duelists` is either vendored or converted from
 * a rip, and both kinds have gone wrong in ways that are invisible on screen:
 * a mesh that renders correctly at 1962 primitives instead of two, a clip that
 * is present but empty, a skin whose joint list does not match the bones. This
 * reads the JSON chunk and says so.
 *
 *   node scripts/glb-info.mjs public/models/duelists/*.glb
 */

import fs from 'node:fs/promises';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('glb-info: pass one or more .glb paths');
  process.exit(2);
}

let worst = 0;
for (const file of files) {
  const buf = await fs.readFile(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) {
    console.error(`${file}: not a GLB (bad magic)`);
    worst = 1;
    continue;
  }
  const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8'));

  const prims = (json.meshes ?? []).reduce((n, m) => n + m.primitives.length, 0);
  const tris = (json.meshes ?? [])
    .flatMap((m) => m.primitives)
    .reduce((n, p) => {
      const a = json.accessors[p.indices ?? p.attributes.POSITION];
      return n + Math.floor((a?.count ?? 0) / 3);
    }, 0);

  console.log(`${file}  ${(buf.length / 1e6).toFixed(2)} MB`);
  console.log(`  meshes ${json.meshes?.length ?? 0} · primitives ${prims} · ~${tris} tris`);
  console.log(`  materials ${(json.materials ?? []).map((m) => m.name ?? '?').join(', ') || '(none)'}`);
  console.log(`  images ${(json.images ?? []).length} · skins ${(json.skins ?? []).length} · joints ${json.skins?.[0]?.joints.length ?? 0}`);
  const clips = (json.animations ?? []).map((a) => `${a.name ?? '?'}(${a.channels.length}ch)`);
  console.log(`  animations ${clips.join(' ') || '(none)'}`);

  /* The three the rig plays. A model missing one of these will stand still
     where it should walk, and nothing else will complain. */
  const names = new Set((json.animations ?? []).map((a) => a.name));
  const missing = ['Idle', 'Walk', 'Run'].filter((n) => !names.has(n));
  if (missing.length) {
    console.log(`  ! missing clips: ${missing.join(', ')}`);
    worst = 1;
  }
  const empty = (json.animations ?? []).filter((a) => !a.channels.length).map((a) => a.name);
  if (empty.length) {
    console.log(`  ! empty clips: ${empty.join(', ')}`);
    worst = 1;
  }
  if (prims > 8) {
    console.log(`  ! ${prims} primitives — that is ${prims} draw calls a frame`);
    worst = 1;
  }
}
process.exit(worst);
