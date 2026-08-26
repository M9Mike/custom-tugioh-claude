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

const BASE = process.argv[2] || 'http://localhost:3000';
const GAP = Number(process.argv[3] || 0.004);

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

await page.goto(`${BASE}/story`, { waitUntil: 'domcontentloaded', timeout: 180000 });
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
      boxes.push({ name: o.name || o.type, lo, hi, offset, size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] });
    });

    const out = [];
    const seen = new Set();
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (a.offset || b.offset) continue;
        for (let axis = 0; axis < 3; axis++) {
          const o1 = (axis + 1) % 3;
          const o2 = (axis + 2) % 3;
          /* They must genuinely share some area on the other two axes, or a
             touch on this one is two things meeting at an edge. */
          const over1 = Math.min(a.hi[o1], b.hi[o1]) - Math.max(a.lo[o1], b.lo[o1]);
          const over2 = Math.min(a.hi[o2], b.hi[o2]) - Math.max(a.lo[o2], b.lo[o2]);
          if (over1 < 0.05 || over2 < 0.05) continue;
          for (const fa of [a.lo[axis], a.hi[axis]]) {
            for (const fb of [b.lo[axis], b.hi[axis]]) {
              if (Math.abs(fa - fb) > gap) continue;
              /*
               * Only a *thin* thing can be seen fighting.
               *
               * Two thick solids meeting — a building sitting on the road, a wall
               * standing on the floor — share a face that is buried inside the
               * pair and never rendered. What flickers is something flat laid on
               * a surface: a decal, a panel, a step, a bill. So one side has to
               * be thin along the contact axis, and both have to reach that face
               * from opposite directions rather than one containing the other.
               */
              const thin = Math.min(a.size[axis], b.size[axis]) < 0.3;
              if (!thin) continue;

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
  for (const h of hits.hits.slice(0, 20)) {
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
  await page.goto(`${BASE}/story`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  /* The name has to go back in. Reloading /story returns to the sign-in card
     with an empty field, and clicking Enter without filling it does nothing at
     all — which is how three areas in a row reported "no scene on window". */
  const field = page.locator('input[placeholder="Enter your name"]');
  if (await field.isVisible().catch(() => false)) {
    await field.fill('Mike');
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
for (const area of ['grandpa-shop', 'starting-area', 'market-row']) {
  total += await visit(area);
}

console.log(total === 0 ? 'COPLANAR: none' : `COPLANAR: ${total} pair(s) — these will flicker`);
await browser.close();
process.exit(total === 0 ? 0 : 1);
