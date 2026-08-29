/**
 * Finds surfaces that sit at exactly the same depth as another surface.
 *
 * Z-fighting is not a rendering bug to be tuned away, it is a *geometry* bug:
 * two faces at the same position, with the depth buffer arbitrating between them
 * and changing its mind as the camera moves. So the reliable way to find it is
 * to look at the geometry, not at the picture.
 *
 * Which matters, because looking at the picture failed twice. Sampling a still
 * camera reported 0.00% and shipped three flickering surfaces — a still camera
 * is the one condition under which z-fighting is invisible, since the same
 * fragments win every frame. Nudging the camera instead reported 7–16%, which is
 * just what a camera rotation does to every edge in the frame. Neither number
 * had anything to do with the defect.
 *
 * This walks the built scene, takes every mesh's world-space box, and reports
 * any pair that overlaps on two axes and touches within `--gap` on the third.
 * That is the shape of the bug, stated directly: the hoarding and its bills, the
 * doorstep and the pavement, the drain covers and the road, all found in one
 * pass and none of them needing an eye.
 *
 *   npm run coplanar
 */
import { chromium } from 'playwright';

/* A URL, or nothing — the other positional arguments here are numbers and the
   filter below is a name, so taking "the second argument" as the host meant
   `-- crown` tried to open http://crown/story. Same fix as `story-setup`. */
const BASE = process.argv.slice(2).find((a) => /^https?:\/\//.test(a)) || 'http://localhost:3000';
const NUMS = process.argv.slice(2).filter((a) => /^[\d.]+$/.test(a));
const GAP = Number(NUMS[0] || 0.004);
/* How many pairs to print per area. Twenty is plenty when the answer is meant to
   be none; hunting a reported flicker at a wider gap needs all of them. */
const SHOW = Number(NUMS[1] || 20);

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

/* `?t=16` pins the sun: the world has a cycle now, and two frames taken
   under a moving one are not comparable. See `story-setup.ts`. */
await page.goto(`${BASE}/story?t=16`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.locator('input[placeholder="Enter your name"]').fill('Mike');
const enter = page.locator('button:has-text("Enter Story Mode")');
for (let i = 0; i < 400 && !(await enter.isEnabled().catch(() => false)); i++) await page.waitForTimeout(200);
await enter.click();
await page.waitForTimeout(8000);

const audit = async (label) => {
  const where = await page.evaluate(() => window.__probe && window.__probe.area).catch(() => '?');
  const hits = await page.evaluate((gap) => {
    const scene = window.__scene;
    if (!scene) return { error: 'no scene on window — is this a production build?' };
    const THREE = window.__three ?? null;
    const boxes = [];
    scene.updateMatrixWorld(true);
    scene.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const g = o.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      const bb = g.boundingBox;
      if (!bb) return;
      /* Eight corners through the world matrix: correct for rotated meshes,
         where transforming only min and max is not. */
      let lo = [Infinity, Infinity, Infinity];
      let hi = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < 8; i++) {
        const v = {
          x: i & 1 ? bb.max.x : bb.min.x,
          y: i & 2 ? bb.max.y : bb.min.y,
          z: i & 4 ? bb.max.z : bb.min.z,
        };
        const m = o.matrixWorld.elements;
        const x = m[0] * v.x + m[4] * v.y + m[8] * v.z + m[12];
        const y = m[1] * v.x + m[5] * v.y + m[9] * v.z + m[13];
        const z = m[2] * v.x + m[6] * v.y + m[10] * v.z + m[14];
        lo = [Math.min(lo[0], x), Math.min(lo[1], y), Math.min(lo[2], z)];
        hi = [Math.max(hi[0], x), Math.max(hi[1], y), Math.max(hi[2], z)];
      }
      /* A decal declares itself out of the running: polygonOffset is exactly the
         instruction "resolve me in front, whatever the depth says". */
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const offset = mats.some((m) => m && m.polygonOffset);
      /*
       * Whether this mesh is square to the world.
       *
       * This matters because the plane comparison below is about *faces*. On a
       * mesh that sits square, the sides of the bounding box are the faces, and
       * two of them in the same plane is exactly the thing that z-fights. On a
       * mesh that is turned — a canopy given a tumble, a roof pitched up — the
       * bounding box touches the geometry along an edge or at a single corner,
       * and there is no face in that plane at all. Comparing those planes finds
       * pairs of leaves that share nothing but a tangent, which is not a fault
       * and cannot be fixed, only jittered until it lands somewhere else.
       *
       * Square means each column of the rotation is one axis: one entry with
       * length in it and the other two at nothing.
       */
      const m = o.matrixWorld.elements;
      const square = [0, 1, 2].every((c) => {
        const col = [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]].map(Math.abs);
        const len = Math.hypot(...col);
        return len > 1e-9 && col.filter((v) => v > len * 1e-4).length === 1;
      });
      boxes.push({ name: o.name || o.type, lo, hi, offset, square,
                   size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] });
    });

    const out = [];
    const seen = new Set();
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (a.offset || b.offset) continue;
        if (!a.square || !b.square) continue;
        for (let axis = 0; axis < 3; axis++) {
          const o1 = (axis + 1) % 3;
          const o2 = (axis + 2) % 3;
          /* They must genuinely share some area on the other two axes, or a
             touch on this one is two things meeting at an edge. */
          const over1 = Math.min(a.hi[o1], b.hi[o1]) - Math.max(a.lo[o1], b.lo[o1]);
          const over2 = Math.min(a.hi[o2], b.hi[o2]) - Math.max(a.lo[o2], b.lo[o2]);
          if (over1 < 0.05 || over2 < 0.05) continue;
          /*
           * And they must share real area, not just an edge.
           *
           * An awning and the arm holding it up touch along a line: one axis
           * overlaps by the width of the arm and the other by nothing at all.
           * Sixteen of those in Market Row alone, every one reported at 0.00 m².
           * A hundred square centimetres is the floor for something anybody
           * could see.
           */
          if (over1 * over2 < 0.01) continue;
          for (const fa of [a.lo[axis], a.hi[axis]]) {
            for (const fb of [b.lo[axis], b.hi[axis]]) {
              if (Math.abs(fa - fb) > gap) continue;
              /*
               * There used to be a thinness rule here — skip the pair unless one
               * side is under 60 cm through — on the reasoning that two thick
               * solids meeting share a face buried between them.
               *
               * The reasoning is right and the rule was the wrong way to get it.
               * Two solids *meeting* are handled below by `stacked`, which asks
               * whether they sit on opposite sides of the contact; two solids
               * that **interpenetrate** are not meeting at all, and both faces
               * are drawn. That is what the passage walls beyond Market Row's
               * arch were doing: 30 m long and 2 m thick, running back through
               * the wall the arch is cut into, with their end faces on exactly
               * its plane. Six metres tall, brick on brick, and skipped for
               * being thick.
               */

              /*
               * Something standing on the ground is not a fight.
               *
               * A lamp base, a planter, a bench leg and a building all have their
               * underside on the pavement — a shared plane, but the two faces
               * point in opposite directions and the lower one is covered by the
               * thing sitting on it. 150 of the first run's hits were this, and
               * every one of them renders perfectly.
               *
               * What does fight is two faces at the same depth pointing the *same
               * way*: a step whose top is level with the pavement, a bill whose
               * outer face is level with the hoarding it is pasted to. So the
               * test is whether both objects lie on the same side of the contact.
               */
              /*
               * Two things standing on the same floor is not a fight.
               *
               * Their undersides are both at y 0 and neither is ever drawn — the
               * floor is over them. It only started showing up when the
               * thinness threshold moved to 60 cm and swept in every crate,
               * counter and stallboard in the world.
               */
              if (axis === 1 && Math.abs(fa) < 0.001 && Math.abs(fb) < 0.001
                  && a.hi[1] > 0.001 && b.hi[1] > 0.001) continue;

              const aAbove = a.hi[axis] > fa + gap;
              const bAbove = b.hi[axis] > fb + gap;
              const aBelow = a.lo[axis] < fa - gap;
              const bBelow = b.lo[axis] < fb - gap;
              const stacked = (aAbove && bBelow && !aBelow && !bAbove)
                           || (bAbove && aBelow && !bBelow && !aAbove);
              if (stacked) continue;

              /*
               * A ground plane has no thickness, so it is neither above nor below
               * the contact and the stacking test cannot see which side it is on.
               * It is still the floor: anything whose underside is on it, and
               * which extends upwards, is *standing* on it and hides the contact.
               */
              const aPlane = a.size[axis] < 1e-4;
              const bPlane = b.size[axis] < 1e-4;
              const restsOn = (plane, solid) =>
                Math.abs(solid.lo[axis] - plane.lo[axis]) <= gap && solid.hi[axis] > plane.lo[axis] + gap;
              if (aPlane && !bPlane && restsOn(a, b)) continue;
              if (bPlane && !aPlane && restsOn(b, a)) continue;
              /* Two planes at the same depth genuinely do fight, so those stay. */
              const key = `${axis}|${fa.toFixed(3)}|${i}|${j}`;
              if (seen.has(key)) continue;
              seen.add(key);
              out.push({
                axis: 'xyz'[axis],
                at: +fa.toFixed(4),
                overlap: +(over1 * over2).toFixed(2),
                a: `${a.name}[${a.size.map((v) => v.toFixed(2)).join('x')}] @ ${a.lo.map((v, k) => ((v + a.hi[k]) / 2).toFixed(2)).join(',')}`,
                b: `${b.name}[${b.size.map((v) => v.toFixed(2)).join('x')}] @ ${b.lo.map((v, k) => ((v + b.hi[k]) / 2).toFixed(2)).join(',')}`,
              });
            }
          }
        }
      }
    }
    return { count: boxes.length, hits: out };
  }, GAP);
  if (hits.error) { console.log(label, 'ERROR', hits.error); return 1; }
  console.log(`${label} (actually in: ${where}): ${hits.count} meshes, ${hits.hits.length} coplanar pair(s)`);
  for (const h of hits.hits.slice(0, SHOW)) {
    console.log(`   ${h.axis} = ${h.at}  overlap ${h.overlap} m²   ${h.a} / ${h.b}`);
  }
  return hits.hits.length;
};

/*
 * Every area is reached by putting the player in it and reloading.
 *
 * It used to walk: audit the shop, hold ArrowDown for 3.4 seconds, audit the
 * street. That worked for exactly one door and then lied. Once Market Row opened
 * off the east end of Turtle Lane, a run that happened to start from a save out
 * that way walked straight through the arch — so the pass labelled
 * "starting-area" was auditing the arcade, and the arcade's own pass found
 * nothing because the player was already past it. The labels were wrong and one
 * area went unswept, which is the worst possible failure for a check whose whole
 * job is to look at things nobody looks at.
 *
 * Posting a position and coming back in is what the door check does to set up
 * its run-ups. It costs a page load per area and it cannot end up somewhere it
 * did not mean to be — and the script prints where it actually is next to where
 * it meant to be, so a lie of this kind can never be silent again.
 */
const visit = async (area) => {
  await fetch(`${BASE}/api/story/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'Mike', world: { area, x: 0, z: 0, facing: 0 } }),
  }).catch(() => {});
  await page.goto(`${BASE}/story?t=16`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  /* The name has to go back in. Reloading /story returns to the sign-in card
     with an empty field, and clicking Enter without filling it does nothing at
     all — which is how three areas in a row reported "no scene on window". */
  /* Only typed when it is wrong. The field comes back pre-filled from
     `localStorage`, and filling a controlled input that is not empty signs you
     in as "MikeMike" — which is not a duelist, so the world never opens. */
  const field = page.locator('input[placeholder="Enter your name"]');
  if (await field.isVisible().catch(() => false)) {
    if ((await field.inputValue().catch(() => '')) !== 'Mike') {
      await field.fill('');
      await field.fill('Mike');
    }
    const again = page.locator('button:has-text("Enter Story Mode")');
    for (let i = 0; i < 400 && !(await again.isEnabled().catch(() => false)); i++) await page.waitForTimeout(200);
    await again.click();
  }
  /* Built, not merely loaded: the scene appears on `window` the first frame the
     area is in it, and auditing before that reports zero meshes and passes. */
  for (let i = 0; i < 150; i++) {
    const there = await page.evaluate(
      (want) => !!window.__scene && window.__probe && window.__probe.area === want, area
    ).catch(() => false);
    if (there) break;
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(1200);
  return audit(area);
};

let total = 0;
/* `node scripts/coplanar-check.mjs -- crown` for one area; see the note in
   `door-check.ts` on why every check in here grew a filter. */
const only = process.argv.slice(2).filter((a) => !a.startsWith('-') && !/^https?:\/\//.test(a) && !/^[\d.]+$/.test(a));
const AREAS_TO_VISIT = ['grandpa-shop', 'starting-area', 'market-row', 'step-lane', 'domino-shrine', 'black-crown', 'crown-shop']
  .filter((id) => !only.length || only.some((o) => id.includes(o)));
for (const area of AREAS_TO_VISIT) {
  total += await visit(area);
}

console.log(total === 0 ? 'COPLANAR: none' : `COPLANAR: ${total} pair(s) — these will flicker`);
await browser.close();
process.exit(total === 0 ? 0 : 1);
