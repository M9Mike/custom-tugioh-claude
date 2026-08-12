/**
 * The instrument for the vendored duelists.
 *
 *   npm run premade
 *
 * Asserts what a model file must hold for the catalog row that names it:
 *
 * - it exists, parses, and is rigged;
 * - the three clips the rig plays — Idle, Walk, Run — are aboard;
 * - every material a tint slot names is really in the file, spelled exactly
 *   that way (a renamed material silently un-tints a garment otherwise);
 * - no slot names `Skin`, `Eye` or `Eyebrows` — the face is not a garment,
 *   and the rule is enforced here precisely so nobody has to remember it.
 *
 * It also prints each file's full material inventory, because that inventory
 * is what slots are authored against: when a model is added or swapped, run
 * this first and read the names off the output.
 *
 * What this deliberately does not do is render anything. These models carry
 * no textures — a tint is a flat material recolour — so there is no repaint
 * whose reach needs photographing the way the old atlas windows did. The
 * *pictures* of every duelist come from the handling run, which drives the
 * real booth through every catalog row and tint swatch.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DUELIST_MODELS, UNTINTABLE, slotsFor } from '../src/story/premade';

let failures = 0;
const ok = (label: string) => console.log(`  ✓ ${label}`);
const bad = (label: string, detail?: string) => {
  failures++;
  console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
};
const check = (cond: boolean, label: string, detail?: string) => (cond ? ok(label) : bad(label, detail));

/** The clips the rig plays. A model without them cannot walk the field. */
const REQUIRED_CLIPS = ['Idle', 'Walk', 'Run'];

interface GlbJson {
  materials?: { name?: string }[];
  animations?: { name?: string }[];
  skins?: unknown[];
}

/** Just enough GLB parsing for an audit: the JSON chunk. Every throw names
    what is wrong with the file, because "RangeError" against a truncated
    download tells nobody which of the twelve to re-fetch. */
function readGlb(file: string): GlbJson {
  const buf = fs.readFileSync(file);
  if (buf.length < 20) throw new Error('truncated: too short to hold a GLB header');
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
  const jsonLen = buf.readUInt32LE(12);
  if (buf.readUInt32LE(16) !== 0x4e4f534a) throw new Error('first chunk is not JSON');
  if (20 + jsonLen > buf.length) throw new Error('truncated: JSON chunk runs past the file');
  return JSON.parse(buf.subarray(20, 20 + jsonLen).toString()) as GlbJson;
}

console.log('Premade duelist audit');


/* The same measurements `repaint.ts` uses to decide what a pixel belongs to, so
   the audit and the renderer cannot disagree about what is safe. */
function toHsl(hex: string): { h: number; l: number; c: number } {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return { h: 0, l, c: 0 };
  const d = mx - mn;
  let h: number;
  if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (mx === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h, l, c: d };
}
function hueGap(a: string, b: string): number {
  const d = Math.abs(toHsl(a).h - toHsl(b).h) % 1;
  return d > 0.5 ? 1 - d : d;
}
function lightGap(a: string, b: string): number {
  return Math.abs(toHsl(a).l - toHsl(b).l);
}
/** The renderer's own reaches, so "safe here" means "safe on screen". */
const HUE_REACH = 0.055;
const SKIN_REACH = 0.13;

for (const model of DUELIST_MODELS) {
  console.log(`\n── ${model.id} ──`);
  const file = path.join('public', model.file);
  if (!fs.existsSync(file)) {
    bad('the model file exists', file);
    continue;
  }
  /* One corrupt file fails its own row and the audit's exit code — it must
     not take the report for the other eleven down with it. */
  let json: GlbJson;
  try {
    json = readGlb(file);
  } catch (err) {
    bad('the model file parses', (err as Error).message);
    continue;
  }

  check((json.skins?.length ?? 0) > 0, 'the model is rigged');
  const clips = (json.animations ?? []).map((a) => a.name ?? '');
  for (const need of REQUIRED_CLIPS) {
    check(clips.includes(need), `the ${need} clip is aboard`, `clips: ${clips.join(', ')}`);
  }

  const materials = (json.materials ?? []).map((m) => m.name ?? '');
  console.log(`  · materials: ${materials.join(', ')}`);
  /* Slot labels double as the booth's `data-tint` selectors and React keys,
     which is only sound while no model repeats one. */
  const slots = slotsFor(model);
  const labels = slots.map((s) => s.label.toLowerCase().replace(/\s+/g, '-'));
  check(new Set(labels).size === labels.length, 'tint slot labels are unique', labels.join(', '));

  /*
   * The textured models are recoloured by hue rather than by material name, so
   * the guard that keeps paint off skin is a *number* rather than a rule the
   * type system can enforce. These assertions are that guard.
   *
   * The dangerous case is a garment painted close enough to the character's own
   * skin that the recolour's hue window catches both — pick a blue jacket and
   * the hands go blue with it. `npm run palette` already withholds those
   * clusters; this is what catches a hand-edited catalog putting one back.
   */
  if (model.textureTints?.length) {
    check(!!model.skin, 'a texture-tinted model records its skin colour');
    const hexish = /^#[0-9a-f]{6}$/i;
    for (const slot of model.textureTints) {
      check(hexish.test(slot.from), `"${slot.label}" starts from a real colour (${slot.from})`);
      const win = slot.lightness;
      if (win) {
        check(
          win[0] >= 0 && win[1] <= 1 && win[0] < win[1],
          `"${slot.label}" has a sane lightness window`,
          `[${win[0]}, ${win[1]}]`
        );
        check(
          toHsl(slot.from).l >= win[0] && toHsl(slot.from).l <= win[1],
          `"${slot.label}" starts from a colour inside its own window`,
          `${slot.from} is l ${toHsl(slot.from).l.toFixed(2)}, window [${win[0]}, ${win[1]}]`
        );
      }
      if (!model.skin || !hexish.test(slot.from)) continue;
      check(
        hueGap(slot.from, model.skin) >= HUE_REACH || lightGap(slot.from, model.skin) >= SKIN_REACH,
        `"${slot.label}" is far enough from skin to repaint safely`,
        `${slot.from} vs skin ${model.skin}`
      );
    }

    /*
     * No two swatches may claim the same pixels.
     *
     * A recolour rule is a hue plus a lightness window, and the first rule that
     * matches a pixel wins — so two slots in one hue family with overlapping
     * windows means picking a colour for one silently repaints the other, and
     * which one depends on catalog order. `npm run palette` picks regions that
     * avoid this; this is what catches a hand-edited catalog putting it back.
     */
    const tints = model.textureTints;
    for (let i = 0; i < tints.length; i++) {
      for (let j = i + 1; j < tints.length; j++) {
        if (hueGap(tints[i].from, tints[j].from) >= HUE_REACH) continue;
        const a = tints[i].lightness ?? [0, 1];
        const b = tints[j].lightness ?? [0, 1];
        check(
          a[0] > b[1] || b[0] > a[1],
          `"${tints[i].label}" and "${tints[j].label}" repaint different regions`,
          `same hue family (${tints[i].from} / ${tints[j].from}) and overlapping windows ` +
            `[${a[0]}, ${a[1]}] / [${b[0]}, ${b[1]}]`
        );
      }
    }
  }

  for (const slot of model.tintSlots) {
    for (const name of slot.materials) {
      check(materials.includes(name), `"${slot.label}" names a real material (${name})`);
      check(
        !(UNTINTABLE as readonly string[]).includes(name),
        `"${slot.label}" stays off the face (${name})`
      );
    }
  }
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check${failures === 1 ? '' : 's'} failed.`);
process.exit(failures === 0 ? 0 : 1);
