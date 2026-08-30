/**
 * Walks the world and records it, then looks for what flickers while moving.
 *
 *   npm run walk                 every route
 *   npm run walk -- gates        just the routes whose name contains "gates"
 *
 * ## Why this exists when `npm run shimmer` already passed
 *
 * Because it passed and the flicker was still there.
 *
 * `shimmer` compares two frames 1.2 mm apart. That finds a surface which is
 * unstable *in principle*, and it found two real ones. But a player is not
 * moving 1.2 mm — they are moving about five centimetres per frame at walking
 * pace, which is forty times further, and a pattern that is merely marginal at a
 * millimetre is violent at five centimetres. Worse, two static frames cannot see
 * the thing that actually reads as flicker: a pixel going light, dark, light,
 * dark over successive frames. Parallax never does that. Only instability does.
 *
 * ## It records; it does not judge
 *
 * The first version of this scored every pixel by how often it reversed
 * direction between frames, on the theory that honest parallax moves one way and
 * a fight flips back and forth. That theory is wrong the moment anything is
 * *moving*: a brick edge sweeping across a pixel reverses it too, so a clean
 * walk down the arcade measured 47% and the heat map was a white rectangle. The
 * number was measuring the walk.
 *
 * There is no cheap frame-to-frame statistic that separates the two while the
 * camera is moving, so this does not pretend to have one. It records — a real
 * video per route in `/tmp/walk`, at a quarter speed so a flicker is visible —
 * and prints a churn figure for reference only. **Watching it is the point.**
 *
 * The gates live elsewhere and each of them measures something it actually can:
 * `npm run coplanar` for two surfaces at one depth, `npm run embedded` for a
 * thing standing inside another thing, `npm run shimmer` for a surface unstable
 * under a camera that has barely moved.
 */

import { chromium, type Page } from 'playwright';
import sharp from 'sharp';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import type { AreaId } from '../src/story/areas';
import { BASE, NAME, ensurePlayer, enterStory } from './story-setup';

interface Route {
  name: string;
  area: AreaId;
  from: { x: number; z: number; facing: number };
  /** Which key to hold. 'w' walks the way you are facing. */
  key: 'w' | 's' | 'a' | 'd';
  /** How many frames to grab. */
  frames: number;
}

const ROUTES: Route[] = [
  { name: 'up to the far gates', area: 'market-row', from: { x: 2, z: 0, facing: Math.PI / 2 }, key: 'w', frames: 34 },
  { name: 'out under the arch', area: 'market-row', from: { x: -8, z: 0, facing: -Math.PI / 2 }, key: 'w', frames: 34 },
  { name: 'past the bakery', area: 'market-row', from: { x: -21, z: 2.4, facing: Math.PI / 2 }, key: 'w', frames: 34 },
  { name: 'east to the arch', area: 'starting-area', from: { x: -4, z: 0.5, facing: Math.PI / 2 }, key: 'w', frames: 34 },
  { name: 'up step lane', area: 'step-lane', from: { x: 14.6, z: 0, facing: -Math.PI / 2 }, key: 'w', frames: 40 },
  { name: 'down the crown lane', area: 'black-crown', from: { x: -19, z: -43, facing: 0 }, key: 'w', frames: 46 },
  { name: 'across the crown square', area: 'black-crown', from: { x: -17, z: 2, facing: Math.PI / 2 }, key: 'w', frames: 44 },
  { name: 'down the crown street', area: 'black-crown', from: { x: -8, z: 17, facing: 0 }, key: 'w', frames: 40 },
  { name: 'up to the shrine', area: 'domino-shrine', from: { x: 0, z: -22.6, facing: 0 }, key: 'w', frames: 44 },
  { name: 'along the sando', area: 'domino-shrine', from: { x: 0, z: -14, facing: 0 }, key: 'w', frames: 44 },
  { name: 'into the east trees', area: 'domino-shrine', from: { x: 14, z: 6, facing: Math.PI / 4 }, key: 'w', frames: 40 },
  { name: 'up the cemetery avenue', area: 'old-cemetery', from: { x: 12.4, z: -46, facing: 0 }, key: 'w', frames: 48 },
  /* Down a row, which runs north — the stones are 1.8 m apart along a row and
     the rows are 2.8 m apart, so this is the passable direction and across it
     is the wall of stone. Aimed across, the duelist did not move at all. */
  { name: 'down a cemetery row', area: 'old-cemetery', from: { x: -21, z: -44, facing: 0 }, key: 'w', frames: 40 },
];

/** A step this big between frames is a real change, not dithering. */
const STEP = 20;

let missing = 0;

async function hidePeople(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as {
      __scene?: { traverse(fn: (o: { isSkinnedMesh?: boolean; visible: boolean }) => void): void };
    };
    w.__scene?.traverse((o) => { if (o.isSkinnedMesh) o.visible = false; });
  }).catch(() => {});
}

async function walk(page: Page, r: Route, dir: string) {
  await fetch(`${BASE}/api/story/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: NAME, world: { area: r.area, ...r.from } }),
  }).catch(() => {});
  if (!(await enterStory(page, r.area))) return null;

  /* Wait for the rig, then take it out of shot — a duelist filling the middle of
     every frame is movement this is not measuring. */
  for (let i = 0; i < 60; i++) {
    const n = await page.evaluate(() => {
      const w = window as unknown as {
        __scene?: { traverse(fn: (o: { isSkinnedMesh?: boolean; visible: boolean }) => void): void };
      };
      let c = 0;
      w.__scene?.traverse((o) => { if (o.isSkinnedMesh) { o.visible = false; c++; } });
      return c;
    }).catch(() => 0);
    if (n > 0) break;
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(1200);

  const shots: string[] = [];
  await page.keyboard.down(r.key);
  for (let i = 0; i < r.frames; i++) {
    await hidePeople(page);
    const file = `${dir}/f${String(i).padStart(3, '0')}.png`;
    await page.screenshot({ path: file, timeout: 60000 });
    shots.push(file);
  }
  await page.keyboard.up(r.key);
  return shots;
}

/** Pixels that reverse direction between frames, and where they are. */
async function score(shots: string[], out: string) {
  const grey: Buffer[] = [];
  let w = 0;
  let h = 0;
  for (const s of shots) {
    const { data, info } = await sharp(s).greyscale().raw().toBuffer({ resolveWithObject: true });
    grey.push(data);
    w = info.width;
    h = info.height;
  }
  const flips = new Uint16Array(w * h);
  for (let f = 1; f + 1 < grey.length; f++) {
    const a = grey[f - 1];
    const b = grey[f];
    const c = grey[f + 1];
    for (let i = 0; i < w * h; i++) {
      const d1 = b[i] - a[i];
      const d2 = c[i] - b[i];
      if (Math.abs(d1) > STEP && Math.abs(d2) > STEP && Math.sign(d1) !== Math.sign(d2)) flips[i]++;
    }
  }
  const heat = Buffer.alloc(w * h);
  const blocks = new Map<string, number>();
  let hot = 0;
  for (let i = 0; i < w * h; i++) {
    /* Reversing once can be an edge crossing a pixel. Three times is a surface
       arguing with itself. */
    const bad = flips[i] >= 3;
    heat[i] = bad ? 255 : flips[i] > 0 ? 90 : 0;
    if (bad) {
      hot++;
      const k = `${Math.floor((i % w) / 80) * 80},${Math.floor(Math.floor(i / w) / 80) * 80}`;
      blocks.set(k, (blocks.get(k) ?? 0) + 1);
    }
  }
  await sharp(heat, { raw: { width: w, height: h, channels: 1 } }).png().toFile(out);
  const worst = [...blocks.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  return { share: hot / (w * h), worst };
}

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('-') && !a.startsWith('http'));
  const routes = only.length
    ? ROUTES.filter((r) => only.some((o) => r.name.includes(o)))
    : ROUTES;

  await ensurePlayer();
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  });
  const page = await (await browser.newContext({ viewport: { width: 800, height: 560 } })).newPage();

  console.log('\nWalking, and watching for what argues with itself\n');

  for (const r of routes) {
    const slug = r.name.replace(/[^a-z]+/gi, '-').toLowerCase();
    const dir = `/tmp/walk/${slug}`;
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });

    const shots = await walk(page, r, dir);
    if (!shots) {
      console.log(`  ⚠️  ${r.area}: ${r.name} — the area never finished building`);
      missing++;
      continue;
    }

    /* Something to watch, at a quarter speed so a flicker is visible. */
    try {
      execFileSync('ffmpeg', [
        '-y', '-framerate', '8', '-i', `${dir}/f%03d.png`,
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18',
        `/tmp/walk/${slug}.mp4`,
      ], { stdio: 'ignore' });
    } catch {
      /* No video is a shame, not a failure — the numbers still stand. */
    }

    const { share, worst } = await score(shots, `/tmp/walk/${slug}-churn.png`);
    console.log(
      `  🎬 ${r.area}: ${r.name} — /tmp/walk/${slug}.mp4` +
        `  (churn ${(share * 100).toFixed(0)}%${worst.length ? `, densest at ${worst[0][0]}` : ''})`
    );
  }

  await browser.close();
  console.log(
    `\nRecorded. Watch /tmp/walk/*.mp4 — churn is descriptive, not a verdict.` +
      (missing ? `  (${missing} route(s) never built)\n` : '\n')
  );
  process.exit(missing === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nwalk failed to run:', err);
  process.exit(1);
});
