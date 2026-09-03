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
import { mkdirSync } from 'node:fs';
import { AREAS, groundAt, type AreaId } from '../src/story/areas';
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
const ENCLOSED: AreaId[] = [
  'grandpa-shop', 'starting-area', 'market-row', 'step-lane', 'black-crown', 'crown-shop',
  /* Walled on all four sides, which is what makes a burial ground set apart —
     and what makes it checkable. */
  'old-cemetery',
];

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

/** `SEAMS_DEBUG=x,z` prints what the down-and-out rays from near that spot land on. */
const SEAMS_DEBUG: { x?: number; z?: number } | null = (() => {
  const f = process.env.SEAMS_DEBUG;
  if (!f) return null;
  const [x, z] = f.split(',').map(Number);
  return Number.isFinite(x) && Number.isFinite(z) ? { x, z } : {};
})();

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
          /* A mesh with a NaN transform answers every ray with a hit at NaN,
             which sorted first and made this pass blind for as long as one
             stood in the scene. Only a finite hit is a hit. */
          if (!ray.intersectObjects(targets, false).some((h) => Number.isFinite(h.distance))) {
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

interface Blind { x: number; z: number; ang: number; pitch: number }

/**
 * The floor you can see.
 *
 * `voids` drops rays inside the area's own bounds and `leaks` looks out level;
 * neither looks *down and out*. The strip of nothing between the arcade floor
 * and the vestibule floor behind Market Row's far gates was outside the bounds,
 * under every level ray, and in plain view through the gate's lower panel — a
 * flat band of sky behind the bars. So from every standing place, at eye
 * height, rays go out and down at three pitches, and each one has to land on
 * something. One that lands on nothing has found a hole in a floor you can
 * see. Rays through a doorway are let go: what is past a door is a closed box
 * with no floor of its own.
 */
async function unfloored(page: Page, id: AreaId): Promise<Blind[]> {
  const area = AREAS[id];
  const cells = walkableCells(area);
  const grid = new Map<string, { x: number; z: number; y: number }>();
  for (const c of cells) {
    const k = `${Math.round(c.x / 2)},${Math.round(c.z / 2)},${Math.round(c.y / 3)}`;
    if (!grid.has(k)) grid.set(k, c);
  }
  /* A cell's own `y` is not always a number — `walkableCells` leaves it NaN
     where the fill never settled a height — and a ray from a NaN origin hits
     everything at NaN, which counted as a hit. Every pass here stood on that
     for as long as it existed. The floor is what `groundAt` says it is. */
  const from = [...grid.values()].map((c) =>
    [c.x, c.z, Number.isFinite(c.y) ? c.y : groundAt(area, c.x, c.z)] as const);
  const doors = area.doors.map((d) =>
    [d.trigger.x, d.trigger.z, d.trigger.hw + DOOR_SLACK, d.trigger.hd + DOOR_SLACK] as const);
  await page.evaluate('globalThis.__name = globalThis.__name || ((f) => f)');
  const found = await page.evaluate(
    ({ from, doors, DIRS, PITCHES, DEBUG }) => {
      const w = window as unknown as { __scene?: unknown; __THREE?: unknown };
      const THREE = w.__THREE as typeof import('three') | undefined;
      const scene = w.__scene as import('three').Scene | undefined;
      if (!THREE || !scene) return null;
      const targets: import('three').Object3D[] = [];
      scene.traverse((o) => {
        const m = o as import('three').Mesh;
        if ((m as unknown as { isMesh?: boolean }).isMesh
            && !(m as unknown as { isSkinnedMesh?: boolean }).isSkinnedMesh) targets.push(m);
      });
      const ray = new THREE.Raycaster();
      ray.far = 120;
      const org = new THREE.Vector3();
      const dir = new THREE.Vector3();
      const throughDoor = (x: number, z: number, dx: number, dz: number, reach: number) => {
        for (let k = 0; k <= reach; k += 0.25) {
          const px = x + dx * k, pz = z + dz * k;
          for (const [cx, cz, hw, hd] of doors) {
            if (Math.abs(px - cx) <= hw && Math.abs(pz - cz) <= hd) return true;
          }
        }
        return false;
      };
      const out: { x: number; z: number; ang: number; pitch: number }[] = [];
      const debug: string[] = [];
      let cast = 0, skipped = 0;
      for (const [x, z, fy] of from) {
        const oy = fy + 1.5;
        for (const pitch of PITCHES) {
          const p = (pitch * Math.PI) / 180;
          /* Where a level floor would be met, plus a stride: a ray that would
             land past a doorway is looking through it. */
          const reach = 1.5 / Math.tan(p) + 1;
          for (let i = 0; i < DIRS; i++) {
            const a = (i / DIRS) * Math.PI * 2;
            const dx = Math.sin(a), dz = Math.cos(a);
            if (throughDoor(x, z, dx, dz, reach)) { skipped++; continue; }
            org.set(x, oy, z);
            dir.set(dx * Math.cos(p), -Math.sin(p), dz * Math.cos(p));
            ray.set(org, dir);
            cast++;
            const hits = ray.intersectObjects(targets, false).filter((h) => Number.isFinite(h.distance));
            if (!hits.length) out.push({ x, z, ang: a, pitch });
            if (DEBUG && DEBUG.x !== undefined && DEBUG.z !== undefined && Math.hypot(x - DEBUG.x, z - DEBUG.z) < 1.5 && debug.length < 60) {
              const h = hits[0];
              const g = h ? (h.object as import('three').Mesh).geometry : null;
              debug.push(`spot ${x.toFixed(2)},${z.toFixed(2)} dir ${Math.round((a * 180) / Math.PI)}° ${pitch}° down → ` + (h
                ? `${g?.type ?? '?'} at ${h.point.x.toFixed(2)},${h.point.y.toFixed(2)},${h.point.z.toFixed(2)} d ${h.distance.toFixed(2)}`
                : 'NOTHING'));
            }
          }
        }
      }
      if (DEBUG) {
        debug.unshift(`standing places ${from.length} (floors ${[...new Set(from.map((f) => f[2].toFixed(2)))].join(' ')}), rays cast ${cast}, through doors ${skipped}, targets ${targets.length}`);
        for (const t of targets) {
          const e = t.matrixWorld.elements;
          if (e.every((v) => Number.isFinite(v))) continue;
          const m = t as import('three').Mesh;
          debug.push(`NaN transform: ${m.geometry.type} "${t.name}" under "${t.parent?.name}" (${t.parent?.type}) pos ${t.position.x},${t.position.y},${t.position.z} scale ${t.scale.x},${t.scale.y},${t.scale.z}`);
        }
      }
      return { out, debug };
    },
    { from, doors, DIRS: 36, PITCHES: [15, 25, 40], DEBUG: SEAMS_DEBUG }
  );
  if (!found) return [];
  for (const line of found.debug) console.log(`     ${line}`);
  return found.out;
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
  /* A cell's own `y` is not always a number — `walkableCells` leaves it NaN
     where the fill never settled a height — and a ray from a NaN origin hits
     everything at NaN, which counted as a hit. Every pass here stood on that
     for as long as it existed. The floor is what `groundAt` says it is. */
  const from = [...grid.values()].map((c) =>
    [c.x, c.z, Number.isFinite(c.y) ? c.y : groundAt(area, c.x, c.z)] as const);
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
        /* Rods are not walls. A wire across Step Lane is six centimetres
           square, and a ray at the six-metre eye passing between a pole's
           two wires is a "narrow slit with the same surface above and
           below" — which is what a wire pair is, and what no hole is. A
           thing thin in two of its three dimensions closes nothing. */
        const thin = [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z].filter((d) => d < 0.15).length;
        if (thin >= 2) return;
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
      /* On a hill an eye is not four metres up, it is four metres above
         wherever the lane has climbed to — nine over the houses downhill,
         from where every level ray is the sky over their roofs. So "high"
         is measured from the area's lowest floor as well as from the one
         underfoot, and up there the harder question is asked. */
      const floorMin = Math.min(...from.map((f) => f[2]));
      for (const [x, z, fy] of from) {
        /*
         * Four heights, and the top one is six metres.
         *
         * There were nine, up to thirteen and a half, on the theory that a
         * slit under a roof is seen from below. Photographed, every escape
         * above six metres was the sky over a roofline: a lower parapet with
         * a taller neighbour a metre behind it satisfies every test a slit
         * does, because a terrace *is* walls at nearly one distance. Every
         * real hole this check has found was found from the ground. What is
         * above six metres is looked at, in the corner frames.
         */
        for (const eye of [1.5, 3, 4.5, 6]) {
          const oy = fy + eye;
          /* And no eye more than seven and a half metres over the area's
             lowest floor: from halfway up Step Lane a level ray at nine
             metres clears the roofs of the lowest houses at the mouth and
             leaves over the corner of the area, which is the sky over a
             roofline again. Seven and a half keeps the six-metre eye on the
             flat and the eyes that found the gate's corners on the hill. */
          if (oy - floorMin > 7.5) continue;
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
            /*
             * Below six metres a ray that gets out is a fault if there is wall
             * over it *or* the opening is too narrow to be a way anywhere.
             * Above six metres — eyes no player has, cast so that a slit
             * between a wall and its roof is seen from below — a ray gets out
             * over every roofline and every boundary wall, and a parapet with
             * a chimney beside it is a "narrow opening" with the whole sky in
             * it. Up there a hole is a hole only when it is one: wall above
             * it and narrow. Photographed, the first sweep at height was ten
             * rooflines out of ten.
             */
            const roofed = roofedOver(x, oy, z, dx, dz);
            /* At six metres — the camera never gets higher than three and a
               half — the harder question is the only fair one: Black Crown's
               precinct walls are six metres, and every ray over one of them
               at six was a "hole". */
            const high = oy - fy >= 5.5 || oy - floorMin >= 5.5;
            /*
             * "Roofed over" asks whether a higher ray in the same direction is
             * stopped, and a taller building behind a parapet stops it as
             * surely as the wall above a slit does. Up high, ask the harder
             * question: is what stops the ray just below this one the same
             * surface as what stops the ray just above it? A slit in a wall
             * has the wall on both sides at one distance; a parapet with a
             * facade behind it has them ten metres apart.
             */
            const sameWall = () => {
              const dLow = reach(x, oy - 0.6, z, dx, dz);
              const dUp = reach(x, oy + 1.5, z, dx, dz);
              return Number.isFinite(dLow) && Number.isFinite(dUp) && Math.abs(dLow - dUp) < 3;
            };
            if (!loose && (high ? !(roofed && wide <= 4 && sameWall()) : !roofed && wide > 4)) continue;
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
  /* `--shots`: photograph each leak from where it leaks, looking along it. */
  const SHOTS = process.argv.includes('--shots');
  if (SHOTS) mkdirSync('/tmp/seams', { recursive: true });

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
    const blind = await unfloored(page, id);
    if (blind.length) {
      if (!gaps.length) bad++;
      const seen: { x: number; z: number; n: number; pitch: number; ang: number }[] = [];
      for (const b of blind) {
        const near = seen.find((k) => Math.abs(k.x - b.x) < 5 && Math.abs(k.z - b.z) < 5);
        if (near) near.n++; else seen.push({ x: b.x, z: b.z, n: 1, pitch: b.pitch, ang: b.ang });
      }
      seen.sort((a, b) => b.n - a.n);
      console.log(`  ❌ ${id} — ${blind.length} ray(s) looking down see no floor, from ${seen.length} place(s)`);
      for (const k of seen.slice(0, 10)) {
        const deg = Math.round((k.ang * 180) / Math.PI);
        console.log(`       ${k.n.toString().padStart(4)} rays  at ${k.x.toFixed(1)}, ${k.z.toFixed(1)}  looking ${deg}°, ${k.pitch}° down`);
      }
      if (seen.length > 10) console.log(`       …and ${seen.length - 10} more`);
    }
    const found = await leaks(page, id);
    const spots = cluster(found);
    if (!spots.length) { if (!gaps.length && !blind.length) console.log(`  ✅ ${id}`); continue; }
    if (!gaps.length && !blind.length) bad++;
    console.log(`  ❌ ${id} — ${found.length} escaping rays, from ${spots.length} place(s)`);
    for (const s of spots.slice(0, 12)) {
      const deg = Math.round((s.ang * 180) / Math.PI);
      console.log(`       ${s.n.toString().padStart(4)} rays  at ${s.x.toFixed(1)}, ${s.z.toFixed(1)}`
                  + `  y ${s.y.toFixed(1)}  looking ${deg}°  gap ${
                      Number.isFinite(s.wide) ? `${s.wide.toFixed(1)} m` : 'open'}`);
    }
    if (SHOTS) {
      await page.evaluate('globalThis.__name = globalThis.__name || ((f) => f)');
      for (let i = 0; i < Math.min(spots.length, 10); i++) {
        const s = spots[i];
        await page.evaluate(({ x, y, z, ang }) => {
          const w = window as unknown as {
            __THREE?: typeof import('three'); __renderer?: import('three').WebGLRenderer; __scene?: import('three').Scene;
            __origRender?: (s: import('three').Object3D, c: import('three').Camera) => void;
          };
          const THREE = w.__THREE!; const r = w.__renderer!;
          const cam = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.2, 400);
          cam.position.set(x, y, z);
          cam.lookAt(x + Math.sin(ang) * 10, y, z + Math.cos(ang) * 10);
          if (!w.__origRender) w.__origRender = r.render.bind(r);
          r.render = (sc) => w.__origRender!(sc, cam);
          w.__scene?.traverse((o) => { if ((o as { isSkinnedMesh?: boolean }).isSkinnedMesh) o.visible = false; });
        }, { x: s.x, y: s.y, z: s.z, ang: s.ang });
        await page.waitForTimeout(1500);
        const file = `/tmp/seams/${id}-${i + 1}-${s.x.toFixed(1)}_${s.z.toFixed(1)}-eye${s.y.toFixed(1)}.png`;
        await page.screenshot({ path: file, timeout: 60000 });
        console.log(`       📸 ${file}`);
      }
      await page.evaluate(() => {
        const w = window as unknown as { __renderer?: import('three').WebGLRenderer; __origRender?: unknown };
        if (w.__renderer && w.__origRender) (w.__renderer as unknown as { render: unknown }).render = w.__origRender;
      });
    }
    if (spots.length > 12) console.log(`       …and ${spots.length - 12} more`);
  }
  await browser.close();
  console.log(bad ? `\nSEAMS: ${bad} area(s) leak\n` : '\nSEAMS: none\n');
  process.exit(bad ? 1 : 0);
}

main();
