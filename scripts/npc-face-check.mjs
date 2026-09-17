/**
 * Photographs every NPC's face.
 *
 * The lab at `/diag/npc` draws four angles per character; this drives it and
 * writes the strip to a file, so a change to somebody's head is one command and
 * one image rather than a play-through.
 *
 * It also fails, rather than quietly producing a picture of nothing: a WebGL
 * context that never comes up, a model that 404s and a thrown error inside the
 * build all look identical in a screenshot of a blank page, and all three have
 * happened. The lab stamps the mount when it has finished drawing, and this
 * waits for that stamp.
 *
 *   npm run faces
 *   npm run faces -- --body
 *   npm run faces -- --base http://localhost:3000 --out /tmp/faces
 */

import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const BASE = flag('base', 'http://localhost:3000');
const OUT = flag('out', '/tmp/faces');
const BODY = has('body');
const CALIB = has('calib');
const BARE = has('bare');
const MODELS = flag('models', '');
const ONLY = flag('only', '');
const EXEC = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined /* let Playwright find its own:
  the hard-coded container path does not exist on a developer's machine */;

await fs.mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: EXEC,
  /* Software rasterisation, so this runs the same on a machine with no GPU.
     Without it the context creation silently fails and the canvas is blank. */
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();

let failed = false;
page.on('pageerror', (e) => {
  console.error(`  ! page error: ${e.message}`);
  failed = true;
});
page.on('console', (m) => {
  if (m.type() === 'error') console.error(`  ! console: ${m.text()}`);
});

const q = [BODY ? 'body=1' : '', CALIB ? 'calib=1' : '', BARE ? 'bare=1' : '', MODELS ? `models=${encodeURIComponent(MODELS)}` : '', ONLY ? `only=${encodeURIComponent(ONLY)}` : ''].filter(Boolean).join('&');
const url = `${BASE}/diag/npc${q ? `?${q}` : ''}`;
const res = await page.goto(url, { waitUntil: 'domcontentloaded' });
if (!res || res.status() >= 400) {
  console.error(`faces: ${url} returned ${res ? res.status() : 'no response'}`);
  await browser.close();
  process.exit(1);
}

try {
  /* The stamp the lab sets once every view has been rendered. A model fetch on
     a cold cache is a megabyte and a half, hence the patience. */
  await page.waitForSelector('[data-npc-lab="drawn"]', { timeout: 60_000 });
} catch {
  const shown = await page.textContent('main').catch(() => '');
  console.error(`faces: the lab never finished drawing.\n  page said: ${(shown || '').slice(0, 300)}`);
  await page.screenshot({ path: path.join(OUT, 'failed.png'), fullPage: true });
  await browser.close();
  process.exit(1);
}

const canvas = await page.$('canvas');
if (!canvas) {
  console.error('faces: no canvas on the page');
  await browser.close();
  process.exit(1);
}

const measures = await page.textContent('[data-measures]').catch(() => '');
if (measures) console.log('faces: ' + measures.replace(/\s+/g, ' ').trim());

/*
 * Has everybody got a body?
 *
 * The stamp above proves the lab finished drawing. It does not prove there is
 * anybody in the picture, and that is not a theoretical gap: Tina shipped with
 * every bone in her skeleton collapsed onto a single point — a mesh with no
 * volume, `visible: true`, a bounding box of exactly the right height, and a
 * "Talk to Tina" prompt hanging in an empty arcade. A screenshot of her panel
 * and a screenshot of a bug that failed to build are the same image, which is
 * the whole reason this check exists, and it sailed straight through.
 *
 * The lab reports how far apart each rig's **bones** are now (`boneSpread`)
 * rather than the size of its bounding box, which is the only measurement that
 * tells a person from a speck and the only one that does not depend on whether
 * the file was authored in metres or centimetres. Anybody whose skeleton is not
 * the span of a body fails the run by name.
 */
const standing = await page.$$eval('[data-spread]', (els) =>
  els.map((e) => ({ who: e.getAttribute('data-who'), m: Number(e.getAttribute('data-spread')) }))
);
if (!standing.length) {
  console.error('faces: the lab reported no measured heights at all');
  failed = true;
} else {
  /* Hip to crown on the shortest person in the game is about a metre; nobody's
     skeleton spans two. A collapsed rig measures zero, which is the fault this
     is here for, and an exploded one measures nonsense. */
  const LOW = 0.6;
  const HIGH = 2.2;
  for (const { who, m } of standing) {
    if (!Number.isFinite(m) || m < LOW || m > HIGH) {
      console.error(`faces: ${who}'s bones span ${Number.isFinite(m) ? `${m.toFixed(3)} m` : 'nothing'} — a collapsed or exploded rig, not a character`);
      failed = true;
    }
  }
  if (!failed) console.log(`faces: all ${standing.length} of them have a skeleton ${LOW}–${HIGH} m tall ✅`);
}

const file = path.join(OUT, `${BODY ? 'bodies' : 'faces'}${BARE ? '-bare' : ''}${CALIB ? '-calib' : ''}${MODELS ? '-cast' : ''}${ONLY ? `-${ONLY}` : ''}.png`);
await canvas.screenshot({ path: file });
console.log(`faces: wrote ${file}`);

await browser.close();
process.exit(failed ? 1 : 0);
