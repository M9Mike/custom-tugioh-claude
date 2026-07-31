/**
 * Downloads the card artwork referenced by src/game/generated/cards.json into
 * public/art/, resized and re-encoded as WebP.
 *
 * This runs as a `prebuild` step so the images are baked into the deployment's
 * own static output rather than hot-linked at runtime, and so the repository
 * (and any deploy payload) stays small.
 *
 * Failures are non-fatal: a missing image degrades to a placeholder rather than
 * breaking the build.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const ART_DIR = path.join(ROOT, 'public', 'art');
const CARDS = path.join(ROOT, 'src', 'game', 'generated', 'cards.json');

const CONCURRENCY = 10;
const ATTEMPTS = 3;

let sharp = null;
try {
  ({ default: sharp } = await import('sharp'));
} catch {
  console.log('• sharp unavailable — artwork will be stored as downloaded');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchArt(artId) {
  const dest = path.join(ART_DIR, `${artId}.webp`);
  try {
    const stat = await fs.stat(dest);
    if (stat.size > 0) return 'cached';
  } catch {
    /* not downloaded yet */
  }

  const url = `https://images.ygoprodeck.com/images/cards_cropped/${artId}.jpg`;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (sharp) {
        await sharp(buf).resize(420, 420, { fit: 'cover', position: 'attention' }).webp({ quality: 82 }).toFile(dest);
      } else {
        await fs.writeFile(dest, buf);
      }
      return 'downloaded';
    } catch (err) {
      if (attempt === ATTEMPTS) {
        console.log(`   ! ${artId}: ${err.message}`);
        return 'failed';
      }
      await sleep(attempt * 600);
    }
  }
  return 'failed';
}

const main = async () => {
  await fs.mkdir(ART_DIR, { recursive: true });
  const cards = JSON.parse(await fs.readFile(CARDS, 'utf8'));
  const ids = [...new Set(Object.values(cards).map((c) => c.artId))].filter(Boolean);

  const counts = { cached: 0, downloaded: 0, failed: 0 };
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const results = await Promise.all(ids.slice(i, i + CONCURRENCY).map(fetchArt));
    for (const r of results) counts[r] += 1;
    process.stdout.write(`\r• artwork ${Math.min(i + CONCURRENCY, ids.length)}/${ids.length}`);
  }
  console.log(
    `\n• artwork ready: ${counts.cached} cached, ${counts.downloaded} downloaded, ${counts.failed} failed`
  );
};

main().catch((err) => {
  // Never fail the build over artwork.
  console.log(`• artwork step skipped: ${err.message}`);
});
