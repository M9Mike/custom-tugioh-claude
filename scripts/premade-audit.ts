/**
 * The instrument for the vendored duelists — the premade system's answer to
 * the character lab.
 *
 *   npm run premade                # audit, and write the sheets
 *   npm run premade -- --out /tmp/premade
 *
 * Two jobs, one command:
 *
 * **Assert what a file must hold.** Every model the catalog names has to
 * exist, parse, carry a skin, and ship the three clips the rig plays — Idle,
 * Walk, Run. A model swapped for one that is missing its Walk would otherwise
 * be discovered by a duelist gliding across the field in a T-pose.
 *
 * **Photograph what cannot be asserted.** Each tint slot's window is a claim
 * — "these pixels are the tabard, none of them are the face" — and the only
 * way to know it is true is to look. For every slot this writes a sheet:
 * the atlas as shipped, the pixels the window catches painted magenta, and
 * the repaint in three swatches spread across the slot's palette. If the
 * magenta touches a face, the window is wrong, whatever the exit code says.
 *
 * The repaint here is the same arithmetic the game runs (`premadeRig.ts`
 * repaints through the same `hslOfRgb`/`windowCatches`), so what these sheets
 * show is what a player gets.
 */

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {
  DUELIST_MODELS,
  hslOfRgb,
  paletteFor,
  windowCatches,
  type DuelistModel,
} from '../src/story/premade';

const argv = process.argv.slice(2);
const flagIndex = argv.indexOf('--out');
const OUT = flagIndex >= 0 && argv[flagIndex + 1] ? argv[flagIndex + 1] : '/tmp/premade';

let failures = 0;
const ok = (label: string) => console.log(`  ✓ ${label}`);
const bad = (label: string, detail?: string) => {
  failures++;
  console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
};
const check = (cond: boolean, label: string, detail?: string) => (cond ? ok(label) : bad(label, detail));

/** The clips the rig plays. A model without them cannot walk the field. */
const REQUIRED_CLIPS = ['Idle', 'Walk', 'Run'];

interface GlbImage {
  data: Buffer;
  material: string;
}

/** Just enough GLB parsing for an audit: the JSON chunk, and the images. */
function readGlb(file: string): { json: GlbJson; images: GlbImage[] } {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString()) as GlbJson;
  const binStart = 20 + jsonLen + 8;
  const images = (json.images ?? []).map((img, i) => {
    const bv = json.bufferViews[img.bufferView];
    const material =
      json.materials.find((m) => {
        const t = m.pbrMetallicRoughness?.baseColorTexture?.index;
        return t !== undefined && json.textures[t].source === i;
      })?.name ?? `image ${i}`;
    return {
      data: buf.subarray(binStart + (bv.byteOffset ?? 0), binStart + (bv.byteOffset ?? 0) + bv.byteLength),
      material,
    };
  });
  return { json, images };
}

interface GlbJson {
  images?: { bufferView: number }[];
  bufferViews: { byteOffset?: number; byteLength: number }[];
  materials: { name?: string; pbrMetallicRoughness?: { baseColorTexture?: { index: number } } }[];
  textures: { source: number }[];
  animations?: { name?: string }[];
  skins?: unknown[];
  nodes?: { mesh?: number; skin?: number }[];
}

const hexToRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/**
 * One slot's sheet: original · magenta mask · three repaints. Wide, so open
 * it full-screen — a mask read at thumbnail size hides exactly the stray
 * pixels it exists to show.
 */
async function slotSheet(
  model: DuelistModel,
  slotIndex: number,
  images: GlbImage[]
): Promise<{ coverage: number[] }> {
  const slot = model.tintSlots[slotIndex];
  const palette = paletteFor(slot);
  /* First, middle, last: the spread says more than three neighbours would. */
  const swatches = [0, Math.floor(palette.length / 2), palette.length - 1];
  const coverage: number[] = [];

  for (let i = 0; i < images.length; i++) {
    const { data: raw, info } = await sharp(images[i].data).raw().toBuffer({ resolveWithObject: true });
    const n = info.width * info.height;
    const panes: Buffer[] = [Buffer.from(raw)];

    const caught = new Uint8Array(n);
    const lum = new Float32Array(n);
    let sum = 0;
    let count = 0;
    for (let p = 0; p < n; p++) {
      const { h, s, l } = hslOfRgb(raw[p * info.channels], raw[p * info.channels + 1], raw[p * info.channels + 2]);
      lum[p] = l;
      if (windowCatches(slot.window, h, s, l)) {
        caught[p] = 1;
        sum += l;
        count++;
      }
    }
    coverage.push(count / n);
    const ref = count > 0 ? sum / count : 0.5;

    const mask = Buffer.from(raw);
    for (let p = 0; p < n; p++) {
      if (caught[p]) {
        mask[p * info.channels] = 255;
        mask[p * info.channels + 1] = 0;
        mask[p * info.channels + 2] = 220;
      }
    }
    panes.push(mask);

    for (const sw of swatches) {
      const [tr, tg, tb] = hexToRgb(palette[sw]);
      const painted = Buffer.from(raw);
      for (let p = 0; p < n; p++) {
        if (!caught[p]) continue;
        const k = lum[p] / ref;
        painted[p * info.channels] = Math.min(255, tr * k);
        painted[p * info.channels + 1] = Math.min(255, tg * k);
        painted[p * info.channels + 2] = Math.min(255, tb * k);
      }
      panes.push(painted);
    }

    const sheet = sharp({
      create: {
        width: info.width * panes.length,
        height: info.height,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    }).composite(
      panes.map((pane, j) => ({
        input: pane,
        raw: { width: info.width, height: info.height, channels: info.channels as 3 },
        left: j * info.width,
        top: 0,
      }))
    );
    const file = path.join(
      OUT,
      `${model.id}-${slot.label.toLowerCase()}-${images[i].material.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`
    );
    await sheet.png().toFile(file);
  }
  return { coverage };
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });
  console.log(`Premade duelist audit — sheets in ${OUT}`);

  for (const model of DUELIST_MODELS) {
    console.log(`\n── ${model.id} ──`);
    const file = path.join('public', model.file);
    if (!fs.existsSync(file)) {
    bad('the model file exists', file);
    continue;
    }
    const { json, images } = readGlb(file);

    check((json.skins?.length ?? 0) > 0, 'the model is rigged');
    const clips = (json.animations ?? []).map((a) => a.name ?? '');
    for (const need of REQUIRED_CLIPS) {
    check(clips.includes(need), `the ${need} clip is aboard`, `clips: ${clips.join(', ')}`);
    }
    check(images.length > 0, 'there is an atlas to tint');

    for (let s = 0; s < model.tintSlots.length; s++) {
    const slot = model.tintSlots[s];
    const { coverage } = await slotSheet(model, s, images);
    /* The window has to catch a real garment on the body atlas — a sliver
       means it misses its own garment, and most of the image means it is
       eating the model. The weapon atlas may legitimately be untouched. */
    const body = coverage[0] ?? 0;
    check(
      body > 0.01 && body < 0.6,
      `"${slot.label}" catches a garment-sized share of the atlas`,
      `${(body * 100).toFixed(1)}%`
    );
    }
  }

  console.log(
    failures === 0
      ? `\nAll checks passed. Now look at the sheets: ${OUT}`
      : `\n${failures} check${failures === 1 ? '' : 's'} failed. Sheets in ${OUT}`
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
