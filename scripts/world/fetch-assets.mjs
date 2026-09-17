/**
 * Fetches the world's third-party assets from Poly Haven.
 *
 *   node scripts/world/fetch-assets.mjs            # everything in data/world/assets.json
 *   node scripts/world/fetch-assets.mjs wood_floor_deck
 *
 * Everything the built world leans on that was not drawn here is CC0 from
 * Poly Haven, listed by id in `data/world/assets.json`, and lands in
 * `.cache/assets/polyhaven/<id>/` at the resolution the manifest names. A
 * texture is its Diffuse, its OpenGL normal and its packed ARM (occlusion,
 * roughness, metal) as JPEG; a model is its glTF with the textures the file
 * manifest says it includes. Nothing here is committed: the GLB an area is
 * built into embeds what it uses, and this is how a fresh checkout rebuilds
 * one. Skipped when the file is already there at the size the manifest says.
 */
import { createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MANIFEST = path.join(ROOT, 'data', 'world', 'assets.json');
const CACHE = path.join(ROOT, '.cache', 'assets', 'polyhaven');
const API = 'https://api.polyhaven.com';

const manifest = JSON.parse(await (await import('node:fs/promises')).readFile(MANIFEST, 'utf8'));
const RES = manifest.resolution ?? '1k';
const only = process.argv.slice(2);
const wanted = (id) => !only.length || only.includes(id);

async function sized(file, size) {
  try {
    const s = await stat(file);
    return size == null ? s.size > 0 : s.size === size;
  } catch {
    return false;
  }
}

async function download(url, file, size) {
  if (await sized(file, size)) return false;
  await mkdir(path.dirname(file), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
  return true;
}

async function files(id) {
  const res = await fetch(`${API}/files/${id}`);
  if (!res.ok) throw new Error(`no file manifest for ${id} (${res.status})`);
  return res.json();
}

let fetched = 0;
let kept = 0;
const note = async (got) => (got ? fetched++ : kept++);

for (const id of manifest.textures.filter(wanted)) {
  const f = await files(id);
  const dir = path.join(CACHE, id);
  for (const map of ['Diffuse', 'nor_gl', 'arm']) {
    const entry = f[map]?.[RES]?.jpg;
    if (!entry) {
      console.log(`  ! ${id}: no ${map} at ${RES}`);
      continue;
    }
    await note(await download(entry.url, path.join(dir, `${map}.jpg`), entry.size));
  }
}

for (const id of manifest.models.filter(wanted)) {
  const f = await files(id);
  const entry = f.gltf?.[RES]?.gltf;
  if (!entry) {
    console.log(`  ! ${id}: no glTF at ${RES}`);
    continue;
  }
  const dir = path.join(CACHE, id);
  await note(await download(entry.url, path.join(dir, `${id}.gltf`), entry.size));
  for (const [rel, inc] of Object.entries(entry.include ?? {})) {
    await note(await download(inc.url, path.join(dir, rel), inc.size));
  }
}

console.log(`• poly haven: ${fetched} files fetched, ${kept} already here → ${path.relative(ROOT, CACHE)}`);
