/**
 * Does anybody run with their legs crossed?
 *
 *   npm run gait
 *
 * The Protagonist's Run clip swings his feet past the centre line — his left
 * foot ends up to the *right* of his right foot for a couple of frames each
 * cycle, which reads as crossed legs. He is not alone in it by accident: the
 * whole generic roster borrows his Run, so one clip's stance wore thirteen
 * faces. `scripts/blender/widen-stance.py` corrects it offline, and this is
 * what says whether it is still corrected.
 *
 * The measurement is the lateral gap between the feet through one cycle, as a
 * fraction of body height, so one threshold covers a child and an adult. The
 * clips that came with their own Run — Yugi, Yami, Kaiba, Joey — never drop
 * below 5%, which is where the floor here comes from.
 *
 * Two earlier attempts measured the wrong thing and are worth naming, because
 * both looked convincing:
 *
 * - *fore-aft* separation, counting how often the legs are level. They are
 *   level twice a cycle in any gait, so every model scored the same 3% and the
 *   check could not tell a crossed run from a clean one.
 * - the horizontal travel of the lowest vertices, as a "sliding feet" score.
 *   When one foot lifts, that set becomes the other foot alone and its centre
 *   jumps half a stance width, so the score measured foot *lifting* — correct
 *   animation — and flagged the cleanest clips hardest.
 *
 * This runs the clips through three.js rather than reading the file, because
 * what matters is where the skinned foot ends up after the whole bone chain,
 * which is the renderer's arithmetic and not something to restate here.
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXEC = process.env.PLAYWRIGHT_CHROMIUM_PATH || '/opt/pw-browsers/chromium';

/** Below this fraction of body height, the stride is too narrow to read. */
const FLOOR = 0.02;

const PAGE = `<!doctype html><meta charset="utf8">
<script type="importmap">{"imports":{
  "three":"/three/build/three.module.js",
  "three/addons/":"/three/examples/jsm/"
}}</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

window.gait = async (file) => {
  const gltf = await new GLTFLoader().loadAsync(file);
  const scene = gltf.scene;
  const clip = gltf.animations.find((c) => c.name === 'Run');
  if (!clip) return { skip: 'no Run clip' };

  const bones = {};
  scene.traverse((o) => { if (o.isBone) bones[o.name] = o; });
  const left = bones.LeftFoot, right = bones.RightFoot;
  if (!left || !right) return { skip: 'no feet' };

  const box = new THREE.Box3().setFromObject(scene);
  const height = Math.max(0.01, box.max.y - box.min.y);

  const mixer = new THREE.AnimationMixer(scene);
  const action = mixer.clipAction(clip);
  action.play();

  const a = new THREE.Vector3(), b = new THREE.Vector3();
  const gaps = [];
  const STEPS = 32;
  for (let i = 0; i < STEPS; i++) {
    mixer.setTime((clip.duration * i) / STEPS);
    scene.updateMatrixWorld(true);
    left.getWorldPosition(a);
    right.getWorldPosition(b);
    gaps.push((a.x - b.x) / height);
  }
  /* Signed so "positive is the left foot on the left" whichever way round this
     rig numbers its axes. */
  const side = gaps.reduce((s, g) => s + g, 0) > 0 ? 1 : -1;
  const narrowest = Math.min(...gaps.map((g) => g * side));
  return { narrowest, widest: Math.max(...gaps.map((g) => g * side)) };
};
window.ready = true;
</script>`;

const server = http.createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(PAGE);
  }
  const from = url.startsWith('/three/')
    ? path.join(ROOT, 'node_modules/three', url.slice('/three/'.length))
    : path.join(ROOT, 'public', url);
  try {
    const body = await fs.readFile(from);
    res.writeHead(200, {
      'content-type': url.endsWith('.glb') ? 'model/gltf-binary' : 'text/javascript',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const browser = await chromium.launch({ executablePath: EXEC });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('  ! ' + e.message));
await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForFunction('window.ready');

const { DUELIST_MODELS } = await import('../src/story/premade.ts').catch(() => ({}));
const files = DUELIST_MODELS
  ? DUELIST_MODELS.map((m) => m.file)
  : (await fs.readdir(path.join(ROOT, 'public/models/duelists')))
      .filter((f) => f.endsWith('.glb'))
      .map((f) => `/models/duelists/${f}`);

console.log('Gait check — narrowest gap between the feet through one Run cycle\n');
let failures = 0;
for (const file of files) {
  const r = await page.evaluate((f) => window.gait(f), file);
  const name = file.split('/').pop().replace('.glb', '');
  if (r.skip) continue;
  const ok = r.narrowest >= FLOOR;
  if (!ok) failures++;
  console.log(
    `  ${ok ? '✓' : '✗'} ${name.padEnd(12)} ${(r.narrowest * 100).toFixed(2).padStart(6)}% .. ` +
      `${(r.widest * 100).toFixed(2).padStart(6)}% of height${ok ? '' : '   legs cross'}`
  );
}
await browser.close();
server.close();
console.log(
  failures === 0
    ? '\nNobody runs with their legs crossed.'
    : `\n${failures} model${failures === 1 ? '' : 's'} cross. Run scripts/blender/widen-stance.py over them.`
);
process.exit(failures === 0 ? 0 : 1);
