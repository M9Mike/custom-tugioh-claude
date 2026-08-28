/**
 * Checks every model's declared size against the file on disk.
 *
 *   npm run models
 *
 * ## Why a number about a file lives next to the file's name
 *
 * The home page will not open Story Mode until the whole cast is loaded, and
 * shows how far along it is. That number has to be in bytes — the catalogue
 * runs from a 564 kB Joey to a 9.0 MB Sarah, so counting files off would reach
 * forty per cent on four duelists worth six per cent of the download — and the
 * bytes have to be known before any of them arrive, or the denominator grows
 * as the downloads do and the bar reads 100% while most of it is still coming.
 *
 * Nothing at runtime will say how big they are. They are served Brotli-encoded,
 * and a browser hides `content-length` from script whenever `content-encoding`
 * is set: the header is the encoded length, and the body handed to JS is not.
 * A range request answers with the encoded length as well. And encoded is not a
 * usable stand-in, because progress events count decoded bytes and the ratio is
 * nothing like constant — Sarah compresses to 77% of herself, Joey to 33%.
 *
 * So `DUELIST_MODELS` carries each file's size, which is a fact about the file
 * that is perfectly well known here and only unavailable out there. This is the
 * part that stops it becoming a lie: re-export a model, and the number beside
 * it is wrong until somebody says so.
 *
 * A wrong number is not fatal — the preloader widens a file's share if the
 * bytes overrun what was declared, so the bar stays honest and monotonic. It is
 * only uneven. This is a check, not a guard.
 */

import { statSync } from 'node:fs';
import { join } from 'node:path';
import { DUELIST_MODELS } from '../src/story/premade';

let bad = 0;

console.log('\nModel sizes — what the catalogue says, and what is on disk\n');

for (const m of DUELIST_MODELS) {
  const path = join(process.cwd(), 'public', m.file);
  let actual: number;
  try {
    actual = statSync(path).size;
  } catch {
    console.log(`  ❌ ${m.id.padEnd(16)} ${m.file} — no such file`);
    bad++;
    continue;
  }
  const mb = (n: number) => (n / 1_048_576).toFixed(2) + ' MB';
  if (actual !== m.bytes) {
    /* Bytes, not megabytes. Two numbers a kilobyte apart both round to the same
       two decimal places, and "says 0.54 MB, is 0.54 MB" reads as a broken
       check rather than as a real difference. */
    console.log(
      `  ❌ ${m.id.padEnd(16)} says ${m.bytes.toLocaleString()}, is ${actual.toLocaleString()}` +
        ` (${mb(actual)}) — set \`bytes: ${actual}\` in premade.ts`
    );
    bad++;
  } else {
    console.log(`  ✅ ${m.id.padEnd(16)} ${mb(actual)}`);
  }
}

const total = DUELIST_MODELS.reduce((sum, m) => sum + m.bytes, 0);
console.log(`\n  the whole cast: ${(total / 1_048_576).toFixed(1)} MB\n`);

if (bad > 0) {
  console.log(`${bad} model(s) have moved since the catalogue was written. ❌\n`);
  process.exit(1);
}
console.log('Every model is the size it says it is. ✅\n');
