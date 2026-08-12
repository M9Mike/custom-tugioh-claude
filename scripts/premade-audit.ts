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
import { DUELIST_MODELS, UNTINTABLE } from '../src/story/premade';

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
