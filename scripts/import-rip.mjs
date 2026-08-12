/**
 * Turns a ripped character into a duelist this game can use.
 *
 * The vendored roster is twelve generic people, and a named character built out
 * of one is a costume: right silhouette, wrong face. Real models of the cast do
 * exist — ripped from the games — but they arrive as Valve SMD and Collada with
 * their animation in separate files, which is nothing the browser can load. This
 * converts one into a single `.glb` with its clips aboard, named the three names
 * `premadeRig` plays.
 *
 * ## Why SMD and not the Collada beside it
 *
 * Each rip ships both. The `.dae` has the mesh and the skeleton but **no
 * animation** (`library_animations` is empty in every one of them), and its axis
 * and unit conventions are unstated, so pairing it with motion from elsewhere is
 * a guess. The SMD set is self-consistent: `Model.smd` carries the hierarchy,
 * the rest pose, the mesh and its skin weights, and each `Motion*.smd` carries
 * frames in exactly the same bone space. Everything comes from one file family,
 * so nothing has to be reconciled.
 *
 * ## Retargeting
 *
 * Only the character who was playable in the source game has a walk and a run;
 * everyone else stands and duels, so they ship idle only. Their skeletons share
 * 25 bones — the whole biped core — differing only in what hangs off them (a
 * coat on one, cloth on another), so a walk can be borrowed by name.
 *
 * Borrowed clips keep **rotation only**. An SMD frame stores absolute local
 * transforms, so replaying one character's positions on another gives them the
 * first character's limb lengths — a visibly different person mid-stride. Bone
 * rotations are the motion; bone positions are the body.
 *
 *   node scripts/import-rip.mjs --in "/tmp/rips/Seto Kaiba" --id kaiba \
 *     --borrow "/tmp/rips/Yugi Muto/Yami"
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { readSmd, clipFrames } from './lib/smd.mjs';

/* Resolved from this file, not the working directory: the rips live wherever
   they were unzipped, and running the importer from there used to serve
   `three` out of a `node_modules` that was not here. The page then never
   finished importing and the only symptom was a timeout. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};

const IN = flag('in', '');
const ID = flag('id', '');
const BORROW = flag('borrow', '');
const OUT_DIR = flag('outDir', 'public/models/duelists');
const EXEC = process.env.PLAYWRIGHT_CHROMIUM_PATH || '/opt/pw-browsers/chromium';
/* SMD is authored at 30fps and says so nowhere in the file. */
const FPS = 30;

if (!IN || !ID) {
  console.error('import-rip: --in <folder> --id <model id> [--borrow <folder with WALK/RUN>]');
  process.exit(2);
}

/* ------------------------------------------------------------------ */
/* Reading one character off disk                                      */
/* ------------------------------------------------------------------ */

async function readCharacter(dir) {
  const files = await fs.readdir(dir);
  const pick = (re) => files.find((f) => re.test(f));

  const modelFile = pick(/^Model\.smd$/i);
  if (!modelFile) throw new Error(`${dir}: no Model.smd`);
  const model = readSmd(await fs.readFile(path.join(dir, modelFile), 'utf8'));

  const motions = {};
  for (const f of files.slice().sort()) {
    const m = f.match(/^Motion([A-Z]+)(\d*)\.smd$/i);
    if (!m) continue;
    const kind = m[1].toUpperCase();
    /* The first numbered take of each kind. IDLE02 is usually a fidget — a
       glance or a shrug — which is worth having later and wrong as the loop. */
    if (motions[kind]) continue;
    const smd = readSmd(await fs.readFile(path.join(dir, f), 'utf8'));
    /*
     * **A motion file has its own node list, and it is not the model's.**
     * These rips drop the two `mesh` nodes from the motion files, so every
     * bone index is shifted by two: read a clip through `Model.smd`'s indices
     * and the hips drive the left thigh, the spine drives the left shin, and
     * the character comes apart while still animating smoothly enough to look
     * deliberate. Each clip carries the names it was written against.
     */
    motions[kind] = { nodes: smd.nodes, frames: clipFrames(smd) };
  }

  const textures = {};
  for (const f of files.filter((x) => /\.png$/i.test(x))) {
    textures[path.parse(f).name] = (await fs.readFile(path.join(dir, f))).toString('base64');
  }

  return { dir, model, motions, textures };
}

/* ------------------------------------------------------------------ */
/* Build and export, in a browser because that is where three.js lives */
/* ------------------------------------------------------------------ */

const PAGE = `<!doctype html><meta charset="utf8">
<script type="importmap">{"imports":{
  "three":"/three/build/three.module.js",
  "three/addons/":"/three/examples/jsm/"
}}</script>
<script type="module">
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
window.THREE = THREE;
window.GLTFExporter = GLTFExporter;
window.ready = true;
</script>`;

async function build(payload) {
  const server = http.createServer(async (req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    if (url === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(PAGE);
    }
    if (url.startsWith('/three/')) {
      try {
        const body = await fs.readFile(path.join(ROOT, 'node_modules/three', url.slice('/three/'.length)));
        res.writeHead(200, { 'content-type': 'text/javascript' });
        return res.end(body);
      } catch {
        res.writeHead(404).end();
        return;
      }
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;

  const browser = await chromium.launch({ executablePath: EXEC });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.ready === true', { timeout: 30000 });

  const base64 = await page.evaluate(async (d) => {
    const T = window.THREE;

    /* ---- skeleton, posed to the reference frame ---- */
    const bones = d.nodes.map((n) => {
      const b = new T.Bone();
      b.name = n.name;
      return b;
    });
    d.nodes.forEach((n, i) => {
      if (n.parent >= 0 && bones[n.parent]) bones[n.parent].add(bones[i]);
    });
    d.rest.forEach((t, i) => {
      if (!t || !bones[i]) return;
      bones[i].position.set(t.px, t.py, t.pz);
      bones[i].rotation.set(t.rx, t.ry, t.rz, 'XYZ');
    });

    /* ---- geometry ----
       Bucketed by material *first*. An SMD names its material before every
       single triangle, so reading the file in order gives thousands of
       one-triangle runs; a draw group per run built a mesh with 1962
       primitives — 1962 draw calls a frame for a character with two textures.
       Gathering each material's triangles together gives exactly one primitive
       per material. */
    const order = [];
    const buckets = new Map();
    for (const g of d.groups) {
      if (!buckets.has(g.material)) {
        order.push(g.material);
        buckets.set(g.material, []);
      }
      buckets.get(g.material).push(...g.verts);
    }

    const pos = [];
    const nrm = [];
    const uv = [];
    const si = [];
    const sw = [];
    const geo = new T.BufferGeometry();
    let offset = 0;
    order.forEach((name, materialIndex) => {
      const verts = buckets.get(name);
      for (const v of verts) {
        pos.push(v.pos[0], v.pos[1], v.pos[2]);
        nrm.push(v.normal[0], v.normal[1], v.normal[2]);
        /* SMD runs V the other way up from glTF. */
        uv.push(v.uv[0], 1 - v.uv[1]);
        const l = v.links.slice(0, 4);
        while (l.length < 4) l.push({ bone: 0, weight: 0 });
        const total = l.reduce((s, x) => s + x.weight, 0) || 1;
        si.push(l[0].bone, l[1].bone, l[2].bone, l[3].bone);
        sw.push(l[0].weight / total, l[1].weight / total, l[2].weight / total, l[3].weight / total);
      }
      geo.addGroup(offset, verts.length, materialIndex);
      offset += verts.length;
    });

    geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new T.Float32BufferAttribute(nrm, 3));
    geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    geo.setAttribute('skinIndex', new T.Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new T.Float32BufferAttribute(sw, 4));

    const loadTexture = (name) =>
      new Promise((resolve) => {
        const key = Object.keys(d.textures).find((k) => name.endsWith(k) || k === name);
        if (!key) return resolve(null);
        const img = new Image();
        img.onload = () => {
          const t = new T.Texture(img);
          t.colorSpace = T.SRGBColorSpace;
          /* The rips use UVs outside 0..1 on purpose. */
          t.wrapS = t.wrapT = T.RepeatWrapping;
          t.flipY = false;
          t.needsUpdate = true;
          resolve(t);
        };
        img.onerror = () => resolve(null);
        img.src = 'data:image/png;base64,' + d.textures[key];
      });

    const materials = [];
    for (const name of order) {
      const map = await loadTexture(name);
      const m = new T.MeshStandardMaterial({
        map: map || null,
        color: 0xffffff,
        roughness: 1,
        metalness: 0,
        /* Hair and eyelash cards on these rips are cut-outs. */
        alphaTest: 0.5,
        transparent: false,
        side: T.DoubleSide,
      });
      m.name = name.split('/').pop();
      materials.push(m);
    }

    const mesh = new T.SkinnedMesh(geo, materials);
    mesh.name = d.id;
    for (let i = 0; i < d.nodes.length; i++) if (d.nodes[i].parent < 0) mesh.add(bones[i]);
    mesh.updateMatrixWorld(true);
    const skeleton = new T.Skeleton(bones);
    mesh.bind(skeleton);

    /* ---- clips ---- */
    const byName = new Map(bones.map((b) => [b.name, b]));
    const q = new T.Quaternion();
    const e = new T.Euler();
    const clips = [];
    for (const c of d.clips) {
      const tracks = [];
      const times = c.frames.map((_, i) => i / d.fps);
      for (let i = 0; i < c.nodes.length; i++) {
        const bone = byName.get(c.nodes[i].name);
        if (!bone) continue;
        const quats = [];
        const posns = [];
        for (const frame of c.frames) {
          const t = frame[i];
          if (!t) {
            quats.push(0, 0, 0, 1);
            posns.push(bone.position.x, bone.position.y, bone.position.z);
            continue;
          }
          e.set(t.rx, t.ry, t.rz, 'XYZ');
          q.setFromEuler(e);
          quats.push(q.x, q.y, q.z, q.w);
          posns.push(t.px, t.py, t.pz);
        }
        tracks.push(new T.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, quats));
        /* Positions only where the motion is the character's own. Borrowed
           motion carries the lender's bone lengths, and replaying those makes
           the borrower briefly into somebody else. The hips are the exception:
           without them the walk has no rise and fall. */
        if (!c.borrowed || bone.name === 'Hips') {
          tracks.push(new T.VectorKeyframeTrack(`${bone.name}.position`, times, posns));
        }
      }
      clips.push(new T.AnimationClip(c.name, times[times.length - 1] + 1 / d.fps, tracks));
    }

    const scene = new T.Group();
    scene.name = d.id;
    scene.add(mesh);

    const glb = await new Promise((resolve, reject) => {
      new window.GLTFExporter().parse(
        scene,
        (result) => resolve(result),
        (err) => reject(err),
        { binary: true, animations: clips, embedImages: true }
      );
    });
    let bin = '';
    const bytes = new Uint8Array(glb);
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }, payload);

  await browser.close();
  server.close();
  if (errors.length) console.error('  ! page errors:', errors.slice(0, 3));
  return Buffer.from(base64, 'base64');
}

/* ------------------------------------------------------------------ */

const me = await readCharacter(IN);
const lender = BORROW ? await readCharacter(BORROW) : null;

/* Which clip fills which of the three names the rig plays. Idle is always the
   character's own; a walk or run is theirs if the source game gave them one and
   borrowed if it did not. */
const clips = [];
const add = (name, kind) => {
  const mine = me.motions[kind];
  const source = mine ?? lender?.motions[kind];
  if (!source) return;
  /* Names, not indices — each clip brought its own. */
  clips.push({ name, frames: source.frames, nodes: source.nodes, borrowed: !mine });
};
add('Idle', 'IDLE');
add('Walk', 'WALK');
add('Run', 'RUN');

if (!clips.length) throw new Error(`${IN}: no motion files, and nothing to borrow`);

console.log(`import-rip: ${ID}`);
console.log(`  ${me.model.nodes.length} bones · ${me.model.groups.length * 3} tris · ${Object.keys(me.textures).length} textures`);
for (const c of clips) console.log(`  ${c.name.padEnd(5)} ${String(c.frames.length).padStart(3)} frames${c.borrowed ? ' (borrowed, rotation only)' : ''}`);

const glb = await build({
  id: ID,
  fps: FPS,
  nodes: me.model.nodes,
  rest: clipFrames(me.model)[0] ?? [],
  groups: me.model.groups,
  textures: me.textures,
  clips,
});

await fs.mkdir(OUT_DIR, { recursive: true });
const out = path.join(OUT_DIR, `${ID}.glb`);
await fs.writeFile(out, glb);
console.log(`  wrote ${out} (${(glb.length / 1e6).toFixed(2)} MB)`);
