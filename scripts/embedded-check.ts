/**
 * Things standing inside other things.
 *
 *   npm run embedded [baseUrl]
 *
 * ## The class of bug this is for
 *
 * "There is like a fridge or something half in the wall." A vending machine
 * placed at x 17.6 against a building whose face is at 18, and it is a metre
 * wide — so ten centimetres of it are inside the brickwork. Nothing catches
 * that: it is not a collision problem, the player never gets near it, both
 * surfaces are exactly where they were put, and `npm run coplanar` is looking
 * for faces at the same depth rather than volumes in the same place.
 *
 * It is also not only ugly. Where two solids interpenetrate they share a line,
 * and that line is the sort of thing that crawls as you walk past it — which is
 * why this reads as flicker and gets reported as flicker.
 *
 * ## How it decides
 *
 * Not by volume — that was the first attempt and it let the vending machine
 * through. A metre-wide machine ten centimetres into a wall is only fourteen per
 * cent of itself, which is less than plenty of trim that is *meant* to be set
 * into something.
 *
 * By **penetration depth**: how far past the surface does it reach. Five
 * centimetres. A sign standing proud of a wall touches it by a centimetre or two
 * of its own backing and passes; anything that has driven a hand's width into
 * brickwork has gone somewhere it was not put on purpose.
 *
 * And only for things with some bulk to them. A world like this is *built* out
 * of thin members set into other members — rafters into a roof, party walls into
 * a block, sign bands into a facade — and every one of those is deliberate. What
 * is never deliberate is a chunky object standing in a wall, so the check wants
 * an object at least 40 cm through in its narrowest direction. That is the
 * difference between a vending machine and a length of trim, and it takes the
 * report from a hundred and sixty lines of correct joinery to the handful that
 * are mistakes.
 *
 * Boxes only, and axis-aligned boxes at that. A rotated crate is measured by the
 * box around it, which overstates its reach — that is the right way round for a
 * check whose job is to raise a hand.
 */

import { chromium } from 'playwright';
import { AREAS, type AreaId } from '../src/story/areas';
import { BASE, NAME, ensurePlayer, enterStory } from './story-setup';

/** Under this, it is an object somebody placed. */
const OBJECT_M3 = 5;
/** Over this in its narrowest direction, it is an object rather than trim. */
const OBJECT_MIN_M = 0.4;
/**
 * Over this, it is a building.
 *
 * 220, not 50. A tree's canopy is a hundred and sixty cubic metres once its
 * rotation is boxed, and its own trunk goes a good way into it — which is what a
 * tree is, and which at the old threshold read as a post driven into a wall.
 * Every real building in this world is over 270.
 */
const STRUCTURE_M3 = 220;
/** How far into a building an object may reach, in metres. */
const ALLOWED = 0.05;

let failures = 0;
const check = (ok: boolean, what: string, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${what}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

async function main() {
  await ensurePlayer();
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  });
  const page = await (await browser.newContext({ viewport: { width: 700, height: 500 } })).newPage();

  console.log('\nNothing standing inside anything else\n');

  for (const id of Object.keys(AREAS) as AreaId[]) {
    await fetch(`${BASE}/api/story/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: NAME, world: { area: id, ...AREAS[id].spawn } }),
    }).catch(() => {});
    if (!(await enterStory(page, id))) {
      check(false, id, 'the area never finished building');
      continue;
    }

    const buried = await page.evaluate(
      ({ objectM3, objectMinM, structureM3, allowed }) => {
        interface Obj3D {
          isMesh?: boolean;
          isSkinnedMesh?: boolean;
          geometry?: { boundingBox: { min: XYZ; max: XYZ } | null; computeBoundingBox(): void };
          matrixWorld: { elements: number[] };
          material?: { color?: { getHexString(): string } };
        }
        interface XYZ { x: number; y: number; z: number }
        const w = window as unknown as {
          __scene?: { updateMatrixWorld(f: boolean): void; traverse(fn: (o: Obj3D) => void): void };
        };
        const boxes: {
          lo: number[];
          hi: number[];
          vol: number;
          colour: string;
          size: number[];
          at: number[];
          frame: {
            axes: number[][];
            origin: number[];
            lo: number[];
            hi: number[];
          } | null;
        }[] = [];
        w.__scene?.updateMatrixWorld(true);
        w.__scene?.traverse((o) => {
          if (!o.isMesh || o.isSkinnedMesh || !o.geometry) return;
          const g = o.geometry;
          if (!g.boundingBox) g.computeBoundingBox();
          const bb = g.boundingBox;
          if (!bb) return;
          const lo = [Infinity, Infinity, Infinity];
          const hi = [-Infinity, -Infinity, -Infinity];
          const m = o.matrixWorld.elements;
          for (let i = 0; i < 8; i++) {
            const v = {
              x: i & 1 ? bb.max.x : bb.min.x,
              y: i & 2 ? bb.max.y : bb.min.y,
              z: i & 4 ? bb.max.z : bb.min.z,
            };
            const p = [
              m[0] * v.x + m[4] * v.y + m[8] * v.z + m[12],
              m[1] * v.x + m[5] * v.y + m[9] * v.z + m[13],
              m[2] * v.x + m[6] * v.y + m[10] * v.z + m[14],
            ];
            for (let k = 0; k < 3; k++) {
              lo[k] = Math.min(lo[k], p[k]);
              hi[k] = Math.max(hi[k], p[k]);
            }
          }
          /*
           * Kept so a turned thing can be asked about in its own frame.
           *
           * A pitched roof is a thin slab standing at an angle. Boxed to the
           * world axes it becomes a solid the height of the whole pitch, and
           * anything under the eaves reads as buried in it. In its own frame it
           * is 36 cm thick again and the question has an honest answer.
           *
           * Only for a rigid placement: with a scale on it the columns are not
           * unit length, the shortcut inverse below is wrong, and the world box
           * — too fat, but never too thin — is the safe thing to fall back on.
           */
          const rigid = [0, 4, 8].every(
            (c) => Math.abs(Math.hypot(m[c], m[c + 1], m[c + 2]) - 1) < 1e-6
          );
          const frame = rigid
            ? {
                axes: [
                  [m[0], m[1], m[2]],
                  [m[4], m[5], m[6]],
                  [m[8], m[9], m[10]],
                ],
                origin: [m[12], m[13], m[14]],
                lo: [bb.min.x, bb.min.y, bb.min.z],
                hi: [bb.max.x, bb.max.y, bb.max.z],
              }
            : null;
          const size = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
          /* Anything flat is a panel, a decal or a plane; it cannot be "inside"
             something in the sense this is looking for. */
          if (Math.min(size[0], size[1], size[2]) < 0.02) return;
          boxes.push({
            lo,
            hi,
            frame,
            vol: size[0] * size[1] * size[2],
            colour: o.material?.color ? '#' + o.material.color.getHexString() : '?',
            size: size.map((n) => +n.toFixed(2)),
            at: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2].map((n) => +n.toFixed(2)),
          });
        });

        const out: { depth: number; line: string }[] = [];
        for (const small of boxes) {
          if (small.vol > objectM3) continue;
          if (Math.min(small.size[0], small.size[1], small.size[2]) < objectMinM) continue;
          let deepest = 0;
          let host = '';
          for (const big of boxes) {
            if (big === small || big.vol < structureM3) continue;
            /* Overlap along each axis; the *smallest* of the three is how far it
               had to be pushed in, which is the number that means something. */
            const spans = [0, 1, 2].map((k) =>
              Math.min(small.hi[k], big.hi[k]) - Math.max(small.lo[k], big.lo[k])
            );
            if (spans.some((v) => v <= 0)) continue;
            /* Past the cheap world-axis reject, ask the container in its own
               frame — for anything square that is the same answer, and for
               anything turned it is the true one. */
            const f = big.frame;
            let real = spans;
            if (f) {
              const lo2 = [Infinity, Infinity, Infinity];
              const hi2 = [-Infinity, -Infinity, -Infinity];
              for (let i = 0; i < 8; i++) {
                const d = [
                  (i & 1 ? small.hi[0] : small.lo[0]) - f.origin[0],
                  (i & 2 ? small.hi[1] : small.lo[1]) - f.origin[1],
                  (i & 4 ? small.hi[2] : small.lo[2]) - f.origin[2],
                ];
                for (let k = 0; k < 3; k++) {
                  const v = f.axes[k][0] * d[0] + f.axes[k][1] * d[1] + f.axes[k][2] * d[2];
                  lo2[k] = Math.min(lo2[k], v);
                  hi2[k] = Math.max(hi2[k], v);
                }
              }
              real = [0, 1, 2].map((k) => Math.min(hi2[k], f.hi[k]) - Math.max(lo2[k], f.lo[k]));
              if (real.some((v) => v <= 0)) continue;
            }
            const depth = Math.min(...real);
            if (depth > deepest) {
              deepest = depth;
              host = `${big.size.join('x')} @ ${big.at.join(',')}`;
            }
          }
          if (deepest > allowed) {
            out.push({
              depth: deepest,
              line: `${(deepest * 100).toFixed(0)} cm into ${host}  <-  ${small.size.join('x')} ${small.colour} @ ${small.at.join(',')}`,
            });
          }
        }
        return out.sort((a, b) => b.depth - a.depth).map((o) => o.line);
      },
      { objectM3: OBJECT_M3, objectMinM: OBJECT_MIN_M, structureM3: STRUCTURE_M3, allowed: ALLOWED }
    );

    check(buried.length === 0, `${id}: nothing is driven into a wall`, `${buried.length} found`);
    for (const line of buried.slice(0, 14)) console.log(`       ${line}`);
  }

  await browser.close();
  console.log(
    failures === 0
      ? '\nEverything stands where it was put. ✅\n'
      : `\n${failures} area(s) have something inside something else. ❌\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nembedded check failed to run:', err);
  process.exit(1);
});
