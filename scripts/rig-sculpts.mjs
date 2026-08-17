/**
 * Gives every sculpted character a skeleton, an idle, a walk and a run.
 *
 * Two steps per character, and this file is mostly the list of which donor each
 * one borrows from:
 *
 *   1. `scripts/blender/autorig.py` fits one of the game's own rigged bipeds
 *      into the sculpt and brings its clips along. Read that file for what the
 *      fitting actually does — the chibi proportions, the A-pose correction and
 *      the hand-rolled skinning are all documented where they happen.
 *   2. `import-sculpt.mjs --finish` puts the file back to the shape the game
 *      wants: WebP texture, quantized positions, resampled keys. Blender
 *      exports PNG and float32 and roughly doubles the file otherwise.
 *
 * ## On donors
 *
 * `man1` and `woman1` are the two clean FK bipeds in the vendored roster, and
 * each character takes the one that matches how they are built. It is not
 * squeamishness about which skeleton goes in which body — the skeletons are
 * near-identical — it is that the *clips* differ. The two idles stand
 * differently, and the walks carry their weight differently, and a character
 * given the wrong one reads subtly as somebody doing an impression.
 *
 * ## The dragon
 *
 * `blue-eyes` is not in this list and cannot be. Every step above assumes a
 * biped: the proportion table is human anatomy, the skinning walks a human
 * chain, and the clips are a human walking. A quadruped with a six-metre
 * wingspan has none of those. It keeps the breathing idle `premadeRig` gives an
 * unrigged model, which is the right answer for something that stands at the
 * end of the field and is looked at rather than followed.
 *
 *   npm run rig                 # everybody
 *   npm run rig -- pegasus mai  # just these
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const BLENDER = process.env.BLENDER || 'blender';
const SCRATCH = process.env.RIG_SCRATCH || '.cache/rig';

/** id → [directory under public/models, donor] */
const CAST = {
  // the world cast
  solomon: ['cast', 'man1'],
  mai: ['cast', 'woman1'],
  pegasus: ['cast', 'man1'],
  keith: ['cast', 'man1'],
  bakura: ['cast', 'man1'],
  mako: ['cast', 'man1'],
  weevil: ['cast', 'man1'],
  rex: ['cast', 'man1'],
  marik: ['cast', 'man1'],
  odion: ['cast', 'man1'],
  ishizu: ['cast', 'woman1'],
  'priest-seto': ['cast', 'man1'],
  ash: ['cast', 'man1'],
  // the booth
  amazoni: ['players', 'woman1'],
  'savage-valkyrie': ['players', 'woman1'],
  'valkyrie-sentinel': ['players', 'woman1'],
  wave: ['players', 'woman1'],
  christy: ['players', 'woman1'],
  meg: ['players', 'woman1'],
  shea: ['players', 'woman1'],
  'sandra-afrika': ['players', 'woman1'],
};

const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ids = only.length ? only : Object.keys(CAST);

await fs.mkdir(SCRATCH, { recursive: true });

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.error) throw r.error;
  return r;
};

let failed = 0;
for (const id of ids) {
  const entry = CAST[id];
  if (!entry) {
    console.error(`rig: no such character "${id}"`);
    failed++;
    continue;
  }
  const [dir, donor] = entry;
  const src = `public/models/${dir}/${id}.glb`;
  const staged = path.join(SCRATCH, `${id}.glb`);

  const rigged = run(BLENDER, [
    '-b', '--factory-startup', '-P', 'scripts/blender/autorig.py',
    '--', '--in', src, '--donor', donor, '--out', staged,
  ]);
  const note = (rigged.stdout || '').split('\n').filter((l) => l.startsWith('autorig:'));
  if (!note.some((l) => l.includes('wrote'))) {
    console.error(`rig: ${id} FAILED\n${note.join('\n')}\n${(rigged.stderr || '').slice(-500)}`);
    failed++;
    continue;
  }

  const finish = run('node', [
    '--max-old-space-size=8192', 'scripts/import-sculpt.mjs',
    '--in', staged, '--id', id, '--outDir', `public/models/${dir}`, '--finish',
  ]);
  const line = (finish.stdout || '').split('\n').find((l) => l.startsWith(id.padEnd(16).slice(0, id.length)));
  console.log(`${(line || id).trim()}   [${donor}]`);
}

if (failed) {
  console.error(`\nrig: ${failed} character(s) failed`);
  process.exit(1);
}
console.log(`\nrig: ${ids.length} character(s) rigged`);
