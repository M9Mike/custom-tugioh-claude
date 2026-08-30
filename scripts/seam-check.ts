/**
 * Where the world leaks.
 *
 * Every other check in here measures a surface: is it flickering, is it
 * floating, is it inside something else. None of them can see a *gap* — two
 * walls that stop short of each other leave nothing behind to measure, and the
 * coplanar, footing and embedded checks all pass an area with a slit of sky
 * through the corner of every building in it. That is exactly how Black Crown
 * shipped: four checks green, and Mike walked round the square photographing
 * daylight coming through the joints.
 *
 * So this one measures the absence. It stands where a duelist can stand, looks
 * horizontally in seventy-two directions at two heights, and asks whether the
 * ray ever finds anything. A ray that reaches four hundred metres has left the
 * world, and unless it left through a door, it left through a hole.
 *
 * ## Telling a hole from the sky
 *
 * The hard part is not finding rays that leave — over an open square most of
 * them do, and the ones that go up over a parapet are the view. The first
 * version of this check dodged that by only looking at eye level and four and a
 * half metres, and it paid for it: the shop had nine metres of open sky above
 * its own front door, no ray was ever cast that high, and the check called the
 * room closed while Mike was photographing the hole.
 *
 * So it looks at every height from a metre and a half to thirteen and a half,
 * and asks one more question of each ray that gets out — *is there anything
 * above it in the same direction?* Sky over a roofline has nothing above it,
 * all the way up. A slot in a wall has the rest of the wall above it. That is
 * the whole distinction, it needs no threshold, and it is what makes casting at
 * roof height safe.
 *
 * ## And the floor
 *
 * The same fault upside down, and `npm run footing` cannot see that one either:
 * it walks the cells a duelist can *stand* on, and these holes are all in
 * ground you can only look at. The drawn surfaces of an area abut rather than
 * overlap — which is right, two floors at one depth is a flicker — and then a
 * building is set down on the join. Nobody walks there, so nothing complains,
 * and from the top of the podium you look over its south edge into a strip of
 * sky where the pavement should be.
 *
 * So the second pass drops a ray on every half metre of the area and asks
 * whether there is anything under it at all.
 *
 *   npm run seams              every enclosed area
 *   npm run seams -- crown     the ones whose name says crown
 */

import { chromium, type Page } from 'playwright';
import { AREAS, type AreaId } from '../src/story/areas';
import { walkableCells } from './walkable';
import { BASE, NAME, PINNED_HOUR, ensurePlayer, enterStory, refuseRemote } from './story-setup';

/**
 * Put the duelist in the area first.
 *
 * `enterStory` loads whatever the save says and waits for the area it was
 * asked for, which for every area but the one you were last in is a wait that
 * times out. Black Crown reported "never reached" for exactly that reason on
 * the first run of this check.
 */
async function goTo(id: AreaId): Promise<void> {
  const a = AREAS[id];
  await fetch(`${BASE}/api/story/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: NAME, world: { area: id, ...a.spawn } }),
  }).catch(() => {});
}

/** How far a ray has to travel before it counts as having left. */
const GONE = 400;

/**
 * The areas that are supposed to be closed.
 *
 * Not every one is: the shrine precinct has a real horizon on three sides and
 * a ray leaving it is the view, not a fault. Listing them is honest about that
 * rather than tuning a threshold until the shrine goes quiet.
 */
const ENCLOSED: AreaId[] = ['grandpa-shop', 'starting-area', 'market-row', 'step-lane', 'black-crown', 'crown-shop'];

/**
 * Doors are holes on purpose. This is how much wider than its trigger.
 *
 * Sixty centimetres, not two and a half metres. Generous slack is what let the
 * shop pass with nine metres of open sky above its own front door: every ray
 * through it left within a couple of metres of the doorway, and the check
 * called every one of them a door. A doorway is a doorway and a wall beside it
 * is a wall.
 */
const DOOR_SLACK = 0.6;

interface Leak { x: number; z: number; y: number; ang: number; wide: number }

/** Everywhere inside the area's own bounds with nothing underneath it. */
async function voids(page: Page, id: AreaId): Promise<{ x: number; z: number }[]> {
  const b = AREAS[id].bounds;
  await page.evaluate('globalThis.__name = globalThis.__name || ((f) => f)');
  const found = await page.evaluate(
    ({ bx, bz, bhw, bhd }) => {
      const w = window as unknown as { __scene?: unknown; __THREE?: unknown };
      const THREE = w.__THREE as typeof import('three') | undefined;
      const scene = w.__scene as import('three').Scene | undefined;
      if (!THREE || !scene) return null;
      const ray = new THREE.Raycaster();
      const down = new THREE.Vector3(0, -1, 0);
      const org = new THREE.Vector3();
      const targets: import('three').Object3D[] = [];
      scene.traverse((o) => {
        const m = o as import('three').Mesh;
        if ((m as unknown as { isMesh?: boolean }).isMesh
            && !(m as unknown as { isSkinnedMesh?: boolean }).isSkinnedMesh) targets.push(m);
      });
      const out: { x: number; z: number }[] = [];
      const STEP = 0.5;
      for (let x = bx - bhw; x <= bx + bhw; x += STEP) {
        for (let z = bz - bhd; z <= bz + bhd; z += STEP) {
          /* From above the tallest thing in the block, and stopping just below
             zero: a ray allowed to keep going finds the underside of something
             far away and calls a hole a floor. */
          org.set(x, 60, z);
          ray.set(org, down);
          ray.far = 61;
          if (!ray.intersectObjects(targets, false).length) {
            out.push({ x: +x.toFixed(2), z: +z.toFixed(2) });
          }
        }
      }
      return out;
    },
    { bx: b.x, bz: b.z, bhw: b.hw, bhd: b.hd }
  );
  return found ?? [];
}

async function leaks(page: Page, id: AreaId): Promise<Leak[]> {
  const area = AREAS[id];
  const cells = walkableCells(area);
  /*
   * One standing place every two metres.
   *
   * Thinned onto a grid rather than by taking every Nth cell of the flood fill,
   * which walks in strips and gives a dense line down one edge and nothing in
   * the middle. Two metres is coarse for a duelist and fine for this: a hole
   * you can see from one spot you can see from the next, and the angular
   * resolution is what actually finds them.
   */
  const grid = new Map<string, { x: number; z: number; y: number }>();
  for (const c of cells) {
    const k = `${Math.round(c.x / 2)},${Math.round(c.z / 2)},${Math.round(c.y / 3)}`;
    if (!grid.has(k)) grid.set(k, c);
  }
  const from = [...grid.values()].map((c) => [c.x, c.z, c.y] as const);
  /* The trigger rect, widened a little: the opening is what you see through,
     and it is wider than the strip that fires the door. */
  const doors = area.doors.map((d) =>
    [d.trigger.x, d.trigger.z, d.trigger.hw + DOOR_SLACK, d.trigger.hd + DOOR_SLACK] as const);

  /*
   * `tsx` compiles this file with esbuild's `keepNames` on, which rewrites
   * every named function — the callback below included — as `__name(fn, "fn")`.
   * `__name` is a helper esbuild puts at the top of the module, and Playwright
   * ships only the function's own source to the page, so it arrives calling
   * something that is not there. Defining it in the page first is the fix; it
   * has to go through the *string* form of `evaluate`, which is the one thing
   * here that esbuild does not rewrite.
   */
  await page.evaluate('globalThis.__name = globalThis.__name || ((f) => f)');
  const found = await page.evaluate(
    ({ from, doors, GONE, RAYS, process_loose }) => {
      const w = window as unknown as { __scene?: unknown; __THREE?: unknown };
      const THREE = w.__THREE as typeof import('three') | undefined;
      const scene = w.__scene as import('three').Scene | undefined;
      if (!THREE || !scene) return null;

      /*
       * Every wall in the world, as six numbers.
       *
       * Not `Raycaster`: a slit twenty centimetres wide seen from five metres
       * away is two degrees, and a fan of seventy-two rays steps five. The
       * first version of this check walked the square at that resolution and
       * called it closed while there was an eighteen-centimetre gap of sky at
       * the corner of it — which is precisely the fault it exists to find. So
       * the fan is twenty-four hundred rays, a seventh of a degree, and that
       * is only affordable against flat arrays and a slab test.
       *
       * Rotated meshes are left out rather than boxed. A tree's bounding box
       * is mostly air, and a wall of air is exactly the thing that would hide
       * a hole behind it — and no tree was ever what keeps the weather out.
       */
      const lo: number[] = [];
      const hi: number[] = [];
      const box = new THREE.Box3();
      const q = new THREE.Quaternion();
      scene.updateMatrixWorld(true);
      scene.traverse((o) => {
        const m = o as import('three').Mesh;
        if (!(m as unknown as { isMesh?: boolean }).isMesh) return;
        if ((m as unknown as { isSkinnedMesh?: boolean }).isSkinnedMesh) return;
        m.getWorldQuaternion(q);
        /* Square to the world, to within a thousandth of a turn. */
        const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
        const sq = [e.x, e.y, e.z].every((r) => {
          const t = Math.abs(((r / (Math.PI / 2)) % 1 + 1) % 1);
          return t < 0.002 || t > 0.998;
        });
        if (!sq) return;
        box.setFromObject(m, true);
        if (!Number.isFinite(box.min.x)) return;
        lo.push(box.min.x, box.min.y, box.min.z);
        hi.push(box.max.x, box.max.y, box.max.z);
      });
      const L = new Float64Array(lo);
      const H = new Float64Array(hi);
      const N = L.length / 3;

      /*
       * The walls, filed by height.
       *
       * Nine heights times twenty-four hundred rays times two hundred standing
       * places is four million rays, and testing every one of them against
       * every box in the area is minutes of nothing. A ray is horizontal, so
       * all it can ever hit is what stands at its own height: one metre bands,
       * and each ray tests the band it is in.
       */
      const BAND = 1;
      const bands = new Map<number, number[]>();
      for (let i = 0, j = 0; i < N; i++, j += 3) {
        const b0 = Math.floor(L[j + 1] / BAND);
        const b1 = Math.floor(H[j + 1] / BAND);
        for (let b = b0; b <= b1; b++) {
          const at = bands.get(b);
          if (at) at.push(j); else bands.set(b, [j]);
        }
      }

      /** How far this ray gets before something stops it. `Infinity` if nothing does. */
      const reach = (ox: number, oy: number, oz: number, dx: number, dz: number): number => {
        const band = bands.get(Math.floor(oy / BAND));
        if (!band) return Infinity;
        const ix = dx === 0 ? Infinity : 1 / dx;
        const iz = dz === 0 ? Infinity : 1 / dz;
        let best = Infinity;
        for (let k = 0; k < band.length; k++) {
          const j = band[k];
          if (oy < L[j + 1] || oy > H[j + 1]) continue;
          let t0 = 0, t1 = GONE;
          let a = (L[j] - ox) * ix, b = (H[j] - ox) * ix;
          if (a > b) { const t = a; a = b; b = t; }
          if (a > t0) t0 = a;
          if (b < t1) t1 = b;
          if (t0 > t1) continue;
          a = (L[j + 2] - oz) * iz; b = (H[j + 2] - oz) * iz;
          if (a > b) { const t = a; a = b; b = t; }
          if (a > t0) t0 = a;
          if (b < t1) t1 = b;
          if (t0 <= t1 && t0 < best) best = t0;
        }
        return best;
      };
      const blocked = (ox: number, oy: number, oz: number, dx: number, dz: number): boolean =>
        reach(ox, oy, oz, dx, dz) < GONE;

      /**
       * How wide the opening this ray leaves through is, in metres.
       *
       * The other half of telling a hole from the sky, and the half the first
       * version of this check did not have. "Is there anything above it" finds a
       * slot with wall over it — the nine metres above the shop's front door —
       * and is blind to a slot that goes all the way up, which is exactly what
       * two buildings that do not quite meet leave behind. Mike photographed two
       * of those after this check had passed the world clean.
       *
       * So: sweep out to either side until something stops the ray, and measure
       * the chord between where those two neighbours hit. A street mouth comes
       * out at ten metres and is a street. A joint between two blocks comes out
       * at twenty centimetres and is a fault, and so is the three-metre notch where
       * the lane's west terrace ends — four metres is the line, because the
       * narrowest thing in this city anybody is meant to walk down is nine.
       */
      const opening = (ox: number, oy: number, oz: number, a: number): number => {
        const STEP = 0.004;
        const SWEEP = 0.6;
        let left = 0, right = 0, dl = Infinity, dr = Infinity;
        for (let k = STEP; k <= SWEEP; k += STEP) {
          if (!left) {
            const d = reach(ox, oy, oz, Math.sin(a - k), Math.cos(a - k));
            if (d < GONE) { left = k; dl = d; }
          }
          if (!right) {
            const d = reach(ox, oy, oz, Math.sin(a + k), Math.cos(a + k));
            if (d < GONE) { right = k; dr = d; }
          }
          if (left && right) break;
        }
        if (!left || !right) return Infinity;
        return (left + right) * Math.min(dl, dr);
      };

      /** Out through a doorway is the point of a doorway. */
      const throughDoor = (ox: number, oz: number, dx: number, dz: number): boolean => {
        const ix = dx === 0 ? Infinity : 1 / dx;
        const iz = dz === 0 ? Infinity : 1 / dz;
        for (const d of doors) {
          let t0 = -1, t1 = GONE;
          let a = (d[0] - d[2] - ox) * ix, b = (d[0] + d[2] - ox) * ix;
          if (a > b) { const t = a; a = b; b = t; }
          if (a > t0) t0 = a;
          if (b < t1) t1 = b;
          if (t0 > t1) continue;
          a = (d[1] - d[3] - oz) * iz; b = (d[1] + d[3] - oz) * iz;
          if (a > b) { const t = a; a = b; b = t; }
          if (a > t0) t0 = a;
          if (b < t1) t1 = b;
          if (t0 <= t1) return true;
        }
        return false;
      };

      /**
       * Is there wall above this ray?
       *
       * The one question that separates a hole from the sky, and the reason
       * this check can look at roof height at all. Sampled coarsely on purpose:
       * anything overhead at all settles it, and a slot in a wall has metres of
       * wall over it.
       */
      const roofedOver = (ox: number, oy: number, oz: number, dx: number, dz: number): boolean => {
        for (const up of [1.5, 3, 5, 7, 10, 14]) {
          if (blocked(ox, oy + up, oz, dx, dz)) return true;
        }
        return false;
      };

      const loose = process_loose;
      const out: { x: number; z: number; y: number; ang: number; wide: number }[] = [];
      for (const [x, z, fy] of from) {
        for (const eye of [1.5, 3, 4.5, 6, 7.5, 9, 10.5, 12, 13.5]) {
          const oy = fy + eye;
          for (let i = 0; i < RAYS; i++) {
            const a = (i / RAYS) * Math.PI * 2;
            const dx = Math.sin(a), dz = Math.cos(a);
            if (blocked(x, oy, z, dx, dz)) continue;
            if (throughDoor(x, z, dx, dz)) continue;
            /* Either there is wall above it, or the opening it leaves through
               is too narrow to be a way anywhere.
               `SEAMS_ALL=1` drops both tests and reports every ray that gets
               out, which is how you find a hole the tests do not describe. */
            const wide = opening(x, oy, z, a);
            if (!loose && !roofedOver(x, oy, z, dx, dz) && wide > 4) continue;
            out.push({ x, z, y: oy, ang: a, wide });
          }
        }
      }
      return out;
    },
    { from, doors, GONE, RAYS: 2400, process_loose: !!process.env.SEAMS_ALL }
  );
  return found ?? [];
}

/** The leaks, gathered into the places they come from. */
function cluster(all: Leak[]): { x: number; z: number; y: number; ang: number; wide: number; n: number }[] {
  const seen: { x: number; z: number; y: number; ang: number; wide: number; n: number }[] = [];
  for (const l of all) {
    const near = seen.find(
      (s) => Math.abs(s.x - l.x) < 6 && Math.abs(s.z - l.z) < 6 && Math.abs(s.y - l.y) < 3
    );
    if (near) { near.n++; continue; }
    seen.push({ ...l, n: 1 });
  }
  return seen.sort((a, b) => b.n - a.n);
}

async function main() {
  refuseRemote();
  await ensurePlayer();
  const only = process.argv.slice(2).filter((a) => !a.startsWith('-') && !/^https?:/.test(a));
  const chosen = ENCLOSED.filter((id) => !only.length || only.some((o) => id.includes(o)));

  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  });
  const page = await (await browser.newContext({ viewport: { width: 900, height: 640 } })).newPage();

  console.log(`\nSeams — where you can see out of a room that has no window\n`);
  let bad = 0;
  for (const id of chosen) {
    await goTo(id);
    /* Once more before giving up: a cold area can take longer to compile than
       the wait allows, and "never reached" is a fact about the machine. */
    let there = await enterStory(page, id, PINNED_HOUR);
    if (!there) there = await enterStory(page, id, PINNED_HOUR);
    if (!there) { console.log(`  ❌ ${id} — never reached`); bad++; continue; }
    const gaps = await voids(page, id);
    if (gaps.length) {
      bad++;
      /* Grouped by where they are: a missing strip is one fault, not the two
         hundred samples that landed in it. */
      const seen: { x: number; z: number; n: number }[] = [];
      for (const g of gaps) {
        const near = seen.find((k) => Math.abs(k.x - g.x) < 5 && Math.abs(k.z - g.z) < 5);
        if (near) near.n++; else seen.push({ ...g, n: 1 });
      }
      seen.sort((a, b) => b.n - a.n);
      console.log(`  ❌ ${id} — nothing under ${gaps.length} spot(s), in ${seen.length} place(s)`);
      for (const k of seen.slice(0, 10)) {
        console.log(`       ${k.n.toString().padStart(4)} samples  around ${k.x.toFixed(1)}, ${k.z.toFixed(1)}`);
      }
      if (seen.length > 10) console.log(`       …and ${seen.length - 10} more`);
    }
    const found = await leaks(page, id);
    const spots = cluster(found);
    if (!spots.length) { if (!gaps.length) console.log(`  ✅ ${id}`); continue; }
    if (!gaps.length) bad++;
    console.log(`  ❌ ${id} — ${found.length} escaping rays, from ${spots.length} place(s)`);
    for (const s of spots.slice(0, 12)) {
      const deg = Math.round((s.ang * 180) / Math.PI);
      console.log(`       ${s.n.toString().padStart(4)} rays  at ${s.x.toFixed(1)}, ${s.z.toFixed(1)}`
                  + `  eye ${s.y.toFixed(1)}  looking ${deg}°  gap ${
                      Number.isFinite(s.wide) ? `${s.wide.toFixed(1)} m` : 'open'}`);
    }
    if (spots.length > 12) console.log(`       …and ${spots.length - 12} more`);
  }
  await browser.close();
  console.log(bad ? `\nSEAMS: ${bad} area(s) leak\n` : '\nSEAMS: none\n');
  process.exit(bad ? 1 : 0);
}

main();
