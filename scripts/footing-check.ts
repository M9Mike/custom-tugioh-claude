/**
 * Whether the floor you are drawn standing on is the floor the game thinks
 * you are standing on.
 *
 *   npm run footing
 *
 * ## The bug this exists for
 *
 * The pavements on Turtle Lane are a kerb — fourteen centimetres — above the
 * road. They were drawn at that height in `world/street.ts` and declared nowhere,
 * so `groundAt` answered zero everywhere and the duelist was placed at zero
 * everywhere. Step onto the pavement and both feet went into it to the ankle.
 *
 * The geometry was right. The collision was right. Nothing was wrong except that
 * two files disagreed about a number, and the only way to find out was to walk
 * onto it and look down. That is exactly the class of bug a screenshot from any
 * other angle misses, and exactly the class that gets worse with every area
 * added — thirty-six of them, each with its own steps and kerbs and thresholds.
 *
 * ## How it checks
 *
 * Every point a duelist can stand on, at a quarter of a metre, in every area.
 * For each one: what does `groundAt` say, and what is actually drawn under it?
 *
 * The scene is a world of boxes and planes, so "what is drawn under it" is the
 * highest surface at or below knee height whose footprint contains the point —
 * no raycaster needed, and no dependency on three.js being reachable from
 * inside the page. The two numbers have to agree within four centimetres, which
 * is the difference between a foot on the floor and a foot in it.
 *
 * It also fails on any reachable point with **nothing at all** under it, which
 * is the other half of the same rule: a floor with a hole in it is a place you
 * can stand on nothing.
 */

import { chromium, type Page } from 'playwright';
import { AREAS, groundAt, type AreaId } from '../src/story/areas';
import { walkableCells } from './walkable';
import { BASE, NAME, ensurePlayer, enterStory } from './story-setup';

/** A foot on the floor versus a foot in it. */
const TOLERANCE = 0.04;

/** Nothing anybody stands on in this world is above this. */
const KNEE = 0.6;

let failures = 0;
const check = (ok: boolean, what: string, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${what}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
};

interface Box {
  minX: number; maxX: number;
  minY: number; maxY: number;
  minZ: number; maxZ: number;
}

/*
 * The little of three.js this needs, named rather than left as `any`.
 *
 * These run inside `page.evaluate`, so the real classes are in the browser and
 * not here — but "an object with a world matrix and a geometry" is a small
 * enough shape to write down, and writing it down is what stops a typo in
 * `matrixWorld` becoming a silent pass.
 */
interface XYZ { x: number; y: number; z: number }
interface GeometryLike {
  boundingBox?: { min: XYZ; max: XYZ } | null;
  computeBoundingBox(): void;
}
interface ObjectLike {
  isMesh?: boolean;
  geometry?: GeometryLike;
  matrixWorld: { elements: ArrayLike<number> };
}
interface SceneLike {
  updateMatrixWorld(force: boolean): void;
  traverse(visit: (obj: ObjectLike) => void): void;
}

/**
 * Every mesh in the built area, as a world-space box.
 *
 * Computed in the page by hand rather than with `Box3.setFromObject`, because
 * three.js itself is not on `window` — only the scene is. Eight corners through
 * `matrixWorld` is the whole of what `Box3` would have done anyway.
 */
async function boxesOf(page: Page): Promise<Box[]> {
  return page.evaluate(() => {
    const scene = (window as unknown as { __scene?: SceneLike }).__scene;
    if (!scene) return [];
    const out: Box[] = [];
    scene.updateMatrixWorld(true);
    scene.traverse((obj: ObjectLike) => {
      if (!obj.isMesh || !obj.geometry) return;
      const g = obj.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      const bb = g.boundingBox;
      if (!bb) return;
      const e = obj.matrixWorld.elements;
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (const cx of [bb.min.x, bb.max.x]) {
        for (const cy of [bb.min.y, bb.max.y]) {
          for (const cz of [bb.min.z, bb.max.z]) {
            const x = e[0] * cx + e[4] * cy + e[8] * cz + e[12];
            const y = e[1] * cx + e[5] * cy + e[9] * cz + e[13];
            const z = e[2] * cx + e[6] * cy + e[10] * cz + e[14];
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
            if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
          }
        }
      }
      out.push({ minX, maxX, minY, maxY, minZ, maxZ });
    });
    return out;
  });
}

/** The highest thing drawn under a point that anybody could stand on. */
function surfaceUnder(boxes: Box[], x: number, z: number, told: number): number | null {
  let best: number | null = null;
  for (const b of boxes) {
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
    /*
     * Underfoot, not overhead — and *underfoot* is relative to where the ground
     * is, not to zero.
     *
     * This used to reject anything whose top was above 0.6 m absolute, so that
     * an awning containing the point could not be mistaken for the floor. That
     * is correct in a world whose floor is at zero, and every area was, until
     * Step Lane climbed 5.76 m: from the second flight upward *the stair itself*
     * is above the line, so every tread was thrown away and the check compared
     * `groundAt` against whatever it found further down the hill. 1647 cells,
     * all of them fine.
     *
     * A knee above what the area says the ground is, and a stride below it. The
     * window still excludes awnings and still catches a floor drawn at the wrong
     * height, because a floor wrong by more than a knee shows up in the other
     * direction as a duelist standing in mid-air.
     */
    if (b.maxY > told + KNEE || b.maxY < told - 1.2) continue;
    if (best === null || b.maxY > best) best = b.maxY;
  }
  return best;
}

/** Puts the player in an area and waits for it to be built. */
async function enterArea(page: Page, area: AreaId): Promise<boolean> {
  await fetch(`${BASE}/api/story/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: NAME, world: { area, ...AREAS[area].spawn } }),
  }).catch(() => {});
  return enterStory(page, area);
}

async function main() {
  console.log(`\nFeet on the floor, against ${BASE}\n`);
  await ensurePlayer();
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.on('pageerror', (e) => check(false, 'the world threw', e.message));

  /* `npm run footing -- crown` for one area. Every area is minutes of real page
     loads, which is right before a release and wrong while building one. */
  const only = process.argv.slice(2).filter((a) => !a.startsWith('-') && !/^https?:\/\//.test(a));
  const pick = (id: string) => !only.length || only.some((o) => id.includes(o));
  for (const id of (Object.keys(AREAS) as AreaId[]).filter(pick)) {
    const area = AREAS[id];
    /* Twice before giving up. A cold Next.js route and eight hundred meshes is
       occasionally slower than the wait, and a flaky "never reached" is worse
       than useless — it is a failure nobody trusts. */
    if (!(await enterArea(page, id)) && !(await enterArea(page, id))) {
      check(false, `${id}: the area builds`, 'never reached, twice');
      continue;
    }
    const boxes = await boxesOf(page);
    const cells = walkableCells(area);

    let holes = 0;
    let sunk = 0;
    let floating = 0;
    let worstSunk = '';
    let worstFloat = '';
    let firstHole = '';

    for (const p of cells) {
      /*
       * The floor the cell was *reached* on, not the highest floor over it.
       *
       * In a building with storeys those are different numbers, and taking the
       * second compares the ground floor against the balustrade of a gallery
       * three floors up — 449 cells of it, all of them fine. The fill already
       * knows which floor it climbed to; this is that.
       */
      /* In a building with storeys, the floor the cell was *reached* on — the
         highest floor over that spot is the balustrade of a gallery three
         floors up. Everywhere else, the answer it always gave. */
      const told = Number.isFinite(p.y) ? p.y : groundAt(area, p.x, p.z);
      const drawn = surfaceUnder(boxes, p.x, p.z, told);
      if (drawn === null) {
        holes++;
        if (!firstHole) firstHole = `(${p.x.toFixed(2)}, ${p.z.toFixed(2)})`;
        continue;
      }
      const diff = drawn - told;
      if (diff > TOLERANCE) {
        sunk++;
        if (!worstSunk) {
          worstSunk = `(${p.x.toFixed(2)}, ${p.z.toFixed(2)}) drawn at ${drawn.toFixed(3)}, told ${told.toFixed(3)}`;
        }
      } else if (diff < -TOLERANCE) {
        floating++;
        if (!worstFloat) {
          worstFloat = `(${p.x.toFixed(2)}, ${p.z.toFixed(2)}) drawn at ${drawn.toFixed(3)}, told ${told.toFixed(3)}`;
        }
      }
    }

    console.log(`  ${id}: ${cells.length} standable cells, ${boxes.length} meshes`);
    check(holes === 0, `${id}: there is a floor everywhere you can stand`,
          holes ? `${holes} cell(s) over nothing, first ${firstHole}` : '');
    check(sunk === 0, `${id}: and your feet are never inside it`,
          sunk ? `${sunk} cell(s), worst ${worstSunk}` : '');
    check(floating === 0, `${id}: and never hovering above it`,
          floating ? `${floating} cell(s), worst ${worstFloat}` : '');
  }

  await browser.close();
  console.log(
    failures === 0
      ? '\nEvery step lands on the floor. ✅\n'
      : `\n${failures} footing problem(s). ❌\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nfooting check failed to run:', err);
  process.exit(1);
});
