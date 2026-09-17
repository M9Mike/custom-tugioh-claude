/**
 * Builds an area of Domino City: collision → Blender → GLB.
 *
 *   node scripts/world/build.mjs grandpa-shop            # → public/models/world/grandpa-shop.glb
 *   node scripts/world/build.mjs grandpa-shop --look     # and a render of it, to look at
 *
 * Four steps, in order:
 *
 *   1. `layout.ts` writes the area's collision truth out of `areas.ts`.
 *   2. The pictures the room hangs — posters, box fronts, booster packs,
 *      the shop sign — are drawn from the game's own card art with sharp.
 *   3. Blender, headless, builds the room from the layout and the dressing
 *      (`scripts/blender/world`) and exports a raw GLB.
 *   4. `optimize.mjs` compresses it into `public/models/world/`, which is
 *      what the game loads.
 *
 * Poly Haven assets are fetched by `fetch-assets.mjs` the first time.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, stat, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE = path.join(ROOT, '.cache', 'world');
const ASSETS = path.join(ROOT, '.cache', 'assets', 'polyhaven');
const ART = path.join(CACHE, 'art');
const OUT = path.join(ROOT, 'public', 'models', 'world');
const BLENDER = process.env.BLENDER ?? '/opt/homebrew/bin/blender';

const args = process.argv.slice(2);
const area = args.find((a) => !a.startsWith('--'));
if (!area) {
  console.error('usage: node scripts/world/build.mjs <area> [--look]');
  process.exit(1);
}
const look = args.includes('--look');

const run = (cmd, argv, opts = {}) => execFileSync(cmd, argv, { cwd: ROOT, stdio: 'inherit', ...opts });
const exists = (p) => stat(p).then(() => true, () => false);

/* 0. assets */
if (!(await exists(ASSETS))) run('node', ['scripts/world/fetch-assets.mjs']);

/* 1. the layout */
run('npx', ['tsx', 'scripts/world/layout.ts', area]);
const layout = JSON.parse(await readFile(path.join(CACHE, `${area}.layout.json`), 'utf8'));

/* texture sizes, in metres, from Poly Haven's own listing */
const sizesFile = path.join(CACHE, 'texture-sizes.json');
if (!(await exists(sizesFile))) {
  const listing = await (await fetch('https://api.polyhaven.com/assets?t=textures')).json();
  const sizes = {};
  for (const [id, meta] of Object.entries(listing)) {
    const mm = meta.dimensions?.[0];
    if (mm) sizes[id] = mm / 1000;
  }
  await mkdir(CACHE, { recursive: true });
  await writeFile(sizesFile, JSON.stringify(sizes));
}

/* 2. an area ported from its old builder: run that builder in Node and write
   down what it drew. Its lamps and its sky go into the dressing the first
   time, where the thin builder reads them; its signs are drawn below. */
const dressingFile = path.join(ROOT, 'data', 'world', `${area}.dressing.json`);
const dressing = JSON.parse(await readFile(dressingFile, 'utf8'));
const capture = path.join(CACHE, `${area}.capture.json`);
let captured = null;
if (dressing.recipe === 'port') {
  run('npx', ['tsx', 'scripts/world/capture.ts', area, capture]);
  captured = JSON.parse(await readFile(capture, 'utf8'));
  if (!dressing.lights || !dressing.sky) {
    dressing.lights = captured.lights;
    dressing.sky = captured.sky;
    await writeFile(dressingFile, JSON.stringify(dressing, null, 2) + '\n');
    console.log(`• ${captured.lights.length} lamps and the sky written into ${path.relative(ROOT, dressingFile)}`);
  }
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/* 3. the pictures */
await mkdir(ART, { recursive: true });
const cards = JSON.parse(await readFile(path.join(ROOT, 'src', 'game', 'generated', 'cards.json'), 'utf8'));
const artOf = (slug) => {
  const c = Array.isArray(cards) ? cards.find((x) => x.slug === slug) : cards[slug];
  return c ? path.join(ROOT, 'public', 'art', `${c.artId}.webp`) : null;
};
const nameOf = (slug) => {
  const c = Array.isArray(cards) ? cards.find((x) => x.slug === slug) : cards[slug];
  return c?.name ?? slug;
};
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

const POSTERS = ['blue-eyes-white-dragon', 'dark-magician', 'red-eyes-black-dragon'];
const BOXES = ['blue-eyes-white-dragon', 'dark-magician', 'red-eyes-black-dragon', 'summoned-skull', 'celtic-guardian', 'gaia-the-fierce-knight',
  'harpie-lady', 'time-wizard', 'kuriboh', 'exodia-the-forbidden-one', 'curse-of-dragon', 'jinzo', 'dark-magician-girl', 'buster-blader'];
const PACKS = ['blue-eyes-white-dragon', 'dark-magician', 'red-eyes-black-dragon', 'exodia-the-forbidden-one', 'harpie-lady', 'summoned-skull'];
const CASE = ['blue-eyes-white-dragon', 'dark-magician', 'exodia-the-forbidden-one', 'red-eyes-black-dragon', 'summoned-skull', 'dark-magician-girl', 'jinzo', 'time-wizard'];
const TONES = ['#7a4638', '#3f566f', '#6b5f3c', '#47654f', '#5b3f5b', '#7d6840', '#4f3a2a', '#2f4a5f'];

const have = (slugs) => slugs.filter((s) => artOf(s));
const index = { posters: [], boxes: [], packs: [], cards: [] };

async function picture(file, make) {
  const out = path.join(ART, file);
  if (!(await exists(out))) await make(out);
  return out;
}

for (const slug of have(POSTERS)) {
  const name = nameOf(slug);
  index.posters.push(await picture(`poster-${slug}.png`, async (out) => {
    const art = await sharp(artOf(slug)).resize(512, 512, { fit: 'cover' }).toBuffer();
    const svg = Buffer.from(`<svg width="560" height="780"><rect width="560" height="780" fill="#e9dcc0"/>
      <rect x="20" y="20" width="520" height="740" fill="none" stroke="#3a2a1a" stroke-width="6"/>
      <text x="280" y="700" font-family="Georgia, serif" font-size="34" font-weight="bold" fill="#2b1d12" text-anchor="middle">${esc(name.toUpperCase())}</text>
      <text x="280" y="740" font-family="Georgia, serif" font-size="20" fill="#6b5638" text-anchor="middle">KAME GAME · DOMINO CITY</text></svg>`);
    await sharp(svg).composite([{ input: await sharp(art).resize(500, 560, { fit: 'cover' }).toBuffer(), left: 30, top: 30 }]).png().toFile(out);
  }));
}
for (const [i, slug] of have(BOXES).entries()) {
  const name = nameOf(slug);
  const tone = TONES[i % TONES.length];
  index.boxes.push(await picture(`box-${slug}.png`, async (out) => {
    const art = await sharp(artOf(slug)).resize(300, 300, { fit: 'cover' }).toBuffer();
    const svg = Buffer.from(`<svg width="360" height="480"><rect width="360" height="480" fill="${tone}"/>
      <rect x="14" y="14" width="332" height="452" fill="none" stroke="#e8dcc4" stroke-opacity="0.55" stroke-width="3"/>
      <rect x="0" y="360" width="360" height="120" fill="#1d1712" fill-opacity="0.75"/>
      <text x="180" y="405" font-family="Georgia, serif" font-size="24" font-weight="bold" fill="#efe3c8" text-anchor="middle">${esc(name.length > 22 ? name.slice(0, 21) + '…' : name)}</text>
      <text x="180" y="440" font-family="Helvetica, Arial, sans-serif" font-size="15" fill="#c9b98f" text-anchor="middle">BOOSTER BOX · 24 PACKS</text></svg>`);
    await sharp(svg).composite([{ input: art, left: 30, top: 40 }]).png().toFile(out);
  }));
}
for (const [i, slug] of have(PACKS).entries()) {
  const name = nameOf(slug);
  const tone = TONES[(i + 3) % TONES.length];
  index.packs.push(await picture(`pack-${slug}.png`, async (out) => {
    const art = await sharp(artOf(slug)).resize(200, 200, { fit: 'cover' }).toBuffer();
    const svg = Buffer.from(`<svg width="240" height="384"><rect width="240" height="384" fill="${tone}"/>
      <rect x="8" y="8" width="224" height="368" fill="none" stroke="#f1e6cc" stroke-width="3"/>
      <rect x="0" y="0" width="240" height="70" fill="#f1e6cc"/>
      <text x="120" y="45" font-family="Georgia, serif" font-size="26" font-weight="bold" fill="#2b1d12" text-anchor="middle">SHADOW DUEL</text>
      <text x="120" y="330" font-family="Georgia, serif" font-size="16" fill="#f1e6cc" text-anchor="middle">${esc(name.length > 24 ? name.slice(0, 23) + '…' : name)}</text>
      <text x="120" y="360" font-family="Helvetica, Arial, sans-serif" font-size="12" fill="#e2d4b5" text-anchor="middle">9 CARDS · 1 RARE</text></svg>`);
    await sharp(svg).composite([{ input: art, left: 20, top: 90 }]).png().toFile(out);
  }));
}
for (const slug of have(CASE)) {
  index.cards.push(await picture(`card-${slug}.png`, async (out) => {
    const art = await sharp(artOf(slug)).resize(220, 220, { fit: 'cover' }).toBuffer();
    const svg = Buffer.from(`<svg width="260" height="380"><rect width="260" height="380" rx="10" fill="#c9a24a"/>
      <rect x="12" y="12" width="236" height="356" rx="6" fill="#6f5a2e"/>
      <rect x="0" y="250" width="260" height="130" fill="#efe3c8" fill-opacity="0.0"/>
      <text x="130" y="36" font-family="Georgia, serif" font-size="15" font-weight="bold" fill="#f3e9d2" text-anchor="middle">${esc(nameOf(slug).length > 24 ? nameOf(slug).slice(0, 23) + '…' : nameOf(slug))}</text></svg>`);
    await sharp(svg).composite([{ input: art, left: 20, top: 48 }]).png().toFile(out);
  }));
}
index.sign_open = await picture('sign-open.png', async (out) => {
  const svg = Buffer.from(`<svg width="360" height="200"><rect width="360" height="200" rx="14" fill="#1d6b3a"/>
    <rect x="10" y="10" width="340" height="180" rx="10" fill="none" stroke="#e9dcc0" stroke-width="5"/>
    <text x="180" y="128" font-family="Georgia, serif" font-size="96" font-weight="bold" fill="#f3ead4" text-anchor="middle">OPEN</text></svg>`);
  await sharp(svg).png().toFile(out);
});
index.sign_kame = await picture('sign-kame.png', async (out) => {
  const svg = Buffer.from(`<svg width="1400" height="130"><rect width="1400" height="130" fill="#000" fill-opacity="0"/>
    <text x="700" y="92" font-family="Georgia, serif" font-size="88" font-weight="bold" fill="#c9a227" stroke="#3a2a1a" stroke-width="3" text-anchor="middle" letter-spacing="10">KAME GAME</text></svg>`);
  await sharp(svg).png().toFile(out);
});
index.sign_far = await picture('sign-far.png', async (out) => {
  const svg = Buffer.from(`<svg width="1120" height="160"><rect width="1120" height="160" fill="#2f2620"/>
    <rect x="8" y="8" width="1104" height="144" fill="none" stroke="#b08d57" stroke-width="6"/>
    <text x="560" y="108" font-family="Georgia, serif" font-size="82" font-weight="bold" fill="#e2c98a" text-anchor="middle" letter-spacing="6">DOMINO CAFÉ</text></svg>`);
  await sharp(svg).png().toFile(out);
});
/* Signs the dressing asks for by name: a board of the proportion it is shown at.
   And every sign a captured builder drew, by what it says. */
index.signs = {};
const signSpecs = { ...(dressing.signs ?? {}) };
for (const m of captured?.meshes ?? []) {
  const sg = m.mat.sign;
  if (!sg) continue;
  const key = slug(sg.text + (sg.sub ? '-' + sg.sub : ''));
  const aspect = Math.max(0.5, Math.min(12, sg.aspect ?? 4));
  signSpecs[key] ??= { text: sg.text, sub: sg.sub, fg: sg.ink, bg: sg.ground, w: 1024, h: Math.max(96, Math.round(1024 / aspect)) };
}
for (const [key, spec] of Object.entries(signSpecs)) {
  const w = spec.w ?? 1400;
  const h = spec.h ?? 200;
  const sub = spec.sub ? `<text x="${w / 2}" y="${h * 0.88}" font-family="Georgia, serif" font-size="${h * 0.24}" fill="${spec.fg}" text-anchor="middle" letter-spacing="6">${esc(spec.sub)}</text>` : '';
  const mainY = spec.sub ? h * 0.54 : h * 0.68;
  const mainSize = spec.sub ? h * 0.42 : h * 0.5;
  index.signs[key] = await picture(`sign-${key}.png`, async (out) => {
    const svg = Buffer.from(`<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${spec.bg}"/>
      <rect x="6" y="6" width="${w - 12}" height="${h - 12}" fill="none" stroke="${spec.fg}" stroke-opacity="0.55" stroke-width="4"/>
      <text x="${w / 2}" y="${mainY}" font-family="Georgia, serif" font-size="${mainSize}" font-weight="bold" fill="${spec.fg}" text-anchor="middle" letter-spacing="8">${esc(spec.text)}</text>${sub}</svg>`);
    await sharp(svg).png().toFile(out);
  });
}
index.tree = path.join(ART, 'billboard-island_tree_02.png');
/* The fir picture is three trees in a row with a reference cube by the first;
   a tree of its own is a crop of it, with the note the kit reads its size from. */
const fir = path.join(ART, 'billboard-fir_tree_01.png');
if (await exists(fir)) {
  const firNote = JSON.parse(await readFile(fir + '.json', 'utf8').catch(() => '{"size":[18.78,18.94,6.51]}'));
  const meta = await sharp(fir).metadata();
  for (const [key, left, width] of [['fir_a', 0.355, 0.27], ['fir_b', 0.65, 0.33]]) {
    const out = path.join(ART, `billboard-${key}.png`);
    if (!(await exists(out))) {
      const l = Math.round(meta.width * left);
      const w = Math.round(meta.width * width);
      await sharp(fir).extract({ left: l, top: 0, width: w, height: meta.height }).png().toFile(out);
      const across = firNote.size[0] * width;
      await writeFile(out + '.json', JSON.stringify({ aspect: firNote.size[1] / across, size: [across, firNote.size[1], firNote.size[2] * 0.4] }));
    }
  }
}
await writeFile(path.join(ART, 'index.json'), JSON.stringify(index, null, 1));
console.log(`• pictures: ${index.posters.length} posters, ${index.boxes.length} boxes, ${index.packs.length} packs, ${index.cards.length} cards`);

/* 4. Blender */
const raw = path.join(CACHE, `${area}.raw.glb`);
/* `--python-exit-code`: headless Blender exits 0 after a Python traceback
   unless told otherwise, and a build that failed then re-packed the last
   raw file as if nothing had happened. */
const blenderArgs = ['-b', '--factory-startup', '--python-exit-code', '1', '--python', 'scripts/blender/world/build.py', '--',
  '--layout', path.join(CACHE, `${area}.layout.json`),
  '--dressing', path.join(ROOT, 'data', 'world', `${area}.dressing.json`),
  '--assets', ASSETS, '--art', ART, '--sizes', sizesFile, '--out', raw];
if (look) blenderArgs.push('--render', path.join(CACHE, `${area}.look.png`));
if (dressing.recipe === 'port') blenderArgs.push('--capture', capture);
run(BLENDER, blenderArgs);

/* 5. shrink it */
await mkdir(OUT, { recursive: true });
run('node', ['scripts/world/optimize.mjs', raw, path.join(OUT, `${area}.glb`)]);
if (look) console.log(`• look: ${path.relative(ROOT, path.join(CACHE, `${area}.look.png`))}`);
