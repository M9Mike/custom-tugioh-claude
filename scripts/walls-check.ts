/**
 * Walks into every wall, and asks whether it is there.
 *
 * Collision and geometry are two files that describe one thing, and this
 * world has been wrong both ways: an alley with collision and no geometry
 * (`ee85ec4`), walls that were never drawn and a shop door you could walk
 * through (`7fe5a9f`), a tree drawn at a quarter of the solid round it. Every
 * other check looks at one side or the other — `footing` at where you can
 * stand, `seams` at what you can see. This one stands where you can stand and
 * looks at what stops you.
 *
 * Two questions, asked from every reachable quarter-metre of every area:
 *
 * - **Stopped by nothing.** A cell you can stand on, next to a cell you
 *   cannot: something stops you there. Cast a ray that way, at hip height and
 *   at knee height. If neither finds anything drawn within a stride, you have
 *   walked into an invisible wall.
 * - **Walked through.** A cell you can stand on with drawn geometry inside
 *   it: the game let you in, the picture says you cannot be there. Four short
 *   rays from the cell at hip height; any that hits before the cell's edge is
 *   a wall you can walk through.
 *
 * Doorways are left alone on the first question — the fill stops at a
 * trigger on purpose and the void box is metres behind it — and the burial
 * ground's eight hundred turned stones are tested as the boxes they were
 * drawn as, because a merged mesh has no faces a box test can find.
 *
 *   npm run walls                  every area
 *   npm run walls -- old-cemetery  one
 */
import { chromium, type Page } from 'playwright';
import { AREAS, CM_MARKERS, groundAt, hasStoreys, type Area, type AreaId } from '../src/story/areas';
import { STEP, standable, walkableCells } from './walkable';
import { BASE, NAME, PINNED_HOUR, ensurePlayer, enterStory, refuseRemote } from './story-setup';

/**
 * A wall is looked for as *footprint*, not by ray.
 *
 * A ray is the wrong instrument for a thin thing with a fat solid: a lamp post
 * seventeen centimetres wide inside a collision box fifty-six wide stops a
 * dozen cells whose rays all pass beside it, and every one of them reported
 * a wall of air. So instead, points are laid past the cell along the way it
 * was stopped — a quarter-metre apart, out to a stride and a half — and each
 * is asked whether any drawn thing's footprint, grown by a hand's width,
 * covers it at standing height. A post, a stone, a rail, a bench all do; a
 * solid with nothing drawn near it does not.
 */
const REACH = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5];
/*
 * A solid may stand this much proud of the thing it is for. A lamp post is
 * seventeen centimetres through with a solid fifty-six wide — the duelist's
 * own body fills most of the difference — and that is not a wall anybody
 * meets. Thirty-five centimetres of air past a drawn edge is where a fitting
 * cut generously becomes a wall that is not there.
 */
const GROW = 0.35;

const only = process.argv.slice(2).filter((a) => !a.startsWith('-') && !/^https?:/.test(a));
/** `--why=x,z`: for the stopped edges within a metre of a point, say what was looked at. */
const WHY = (() => {
  const f = process.argv.slice(2).find((a) => a.startsWith('--why='));
  if (!f) return null;
  const [x, z] = f.slice(6).split(',').map(Number);
  return Number.isFinite(x) && Number.isFinite(z) ? { x, z } : null;
})();
const chosen = (Object.keys(AREAS) as AreaId[]).filter((id) => !only.length || only.some((o) => id.includes(o)));

interface Ray { x: number; y: number; z: number; dx: number; dz: number; far: number }
/** A standing-height point: is a drawn footprint here? `lo/hi` is the height band. */
interface Spot { x: number; z: number; lo: number; hi: number }

/** A turned box, for the stones: centre, half sizes, height and yaw. */
interface Obb { x: number; z: number; hw: number; hd: number; h: number; y: number; turn: number }

function stonesOf(area: Area): Obb[] {
  if (area.id !== 'old-cemetery') return [];
  /* Drawn as `piece(hw * 1.7, h, hd * 1.1)` on a plinth `hw * 2 + 0.16` wide
     and 0.18 high — see `world/cemetery.ts`. The upright is what a hip-height
     ray meets; the plinth is what a knee-height one meets on a slab. */
  return CM_MARKERS.flatMap((m) => {
    const y = groundAt(area, m.x, m.z); /* the terrace it stands on */
    if (m.kind === 'tree') return [{ x: m.x, z: m.z, hw: m.hw, hd: m.hd, h: m.h, y, turn: m.turn }];
    if (m.kind === 'slab') return [{ x: m.x, z: m.z, hw: m.hw, hd: m.hd, h: m.h, y, turn: m.turn }];
    return [
      { x: m.x, z: m.z, hw: m.hw + 0.08, hd: m.hd + 0.08, h: 0.18, y, turn: m.turn },
      { x: m.x, z: m.z, hw: m.hw * 0.85, hd: m.hd * 0.55, h: m.h + 0.2, y, turn: m.turn },
    ];
  });
}

function nearDoor(area: Area, x: number, z: number): boolean {
  return area.doors.some((d) =>
    Math.abs(x - d.trigger.x) <= d.trigger.hw + 1.0 && Math.abs(z - d.trigger.z) <= d.trigger.hd + 1.0);
}

/** Groups hits by place so a missing wall is one line, not two hundred. */
function cluster(pts: { x: number; z: number; d: number; i: number }[]): { x: number; z: number; n: number; d: number; i: number }[] {
  const out: { x: number; z: number; n: number; d: number; i: number }[] = [];
  for (const p of pts) {
    const near = out.find((c) => Math.abs(c.x - p.x) < 3 && Math.abs(c.z - p.z) < 3);
    if (near) { near.n++; if (p.d < near.d) { near.d = p.d; near.i = p.i; } } else out.push({ x: p.x, z: p.z, n: 1, d: p.d, i: p.i });
  }
  return out.sort((a, b) => b.n - a.n);
}

/**
 * Casts a batch of rays in the page and returns the nearest hit distance for
 * each, or Infinity. Axis-aligned meshes as world boxes, turned stones as
 * their own boxes; skinned meshes (the cast) and decals are not walls.
 */
async function cast(page: Page, rays: Ray[], stones: Obb[]): Promise<{ d: number; i: number }[]> {
  return page.evaluate(({ rays, stones }) => {
    const w = window as unknown as { __scene?: unknown; __THREE?: unknown };
    const THREE = w.__THREE as typeof import('three') | undefined;
    const scene = w.__scene as import('three').Scene | undefined;
    if (!THREE || !scene) return rays.map(() => ({ d: -1, i: -1 }));

    /*
     * Every mesh as the box it was built as, in its own frame.
     *
     * Not the world-axis box: a shed turned a few degrees has a world box that
     * is mostly air, and leaving turned meshes out — which is what the seam
     * sweep does, rightly, for weather — leaves every turned shed, stall and
     * tree out of *this*, and the collision that follows them reads as a wall
     * of air. So each ray is carried into the mesh's frame and tested against
     * its local box, which is exact for a box and honest for a lathe.
     */
    const lo: number[] = [];
    const hi: number[] = [];
    const inv: number[] = [];
    scene.updateMatrixWorld(true);
    const m4 = new THREE.Matrix4();
    scene.traverse((o) => {
      const m = o as import('three').Mesh;
      if (!m.isMesh || !m.geometry) return;
      if ((m as unknown as { isSkinnedMesh?: boolean }).isSkinnedMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      if (mats.some((mm) => mm && (mm as import('three').Material).polygonOffset)) return;
      const g = m.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      const b = g.boundingBox;
      if (!b) return;
      /* A merge has no faces its box describes. One box is twenty-four
         vertices; more than that with a footprint over six metres is a
         scatter — the stones, the wood, a grove — and the stones come in as
         boxes of their own below. */
      const pos = g.attributes.position;
      const e = m.matrixWorld.elements;
      const sx = Math.hypot(e[0], e[1], e[2]) * (b.max.x - b.min.x);
      const sz = Math.hypot(e[8], e[9], e[10]) * (b.max.z - b.min.z);
      if (pos && pos.count > 24 && (sx > 6 || sz > 6)) return;
      /* Ground planes are not walls: anything under 5 cm tall is a floor. */
      const sy = Math.hypot(e[4], e[5], e[6]) * (b.max.y - b.min.y);
      if (sy < 0.05) return;
      m4.copy(m.matrixWorld).invert();
      lo.push(b.min.x, b.min.y, b.min.z);
      hi.push(b.max.x, b.max.y, b.max.z);
      inv.push(...m4.elements);
    });
    const n = lo.length / 3;

    const slab = (ox: number, oy: number, oz: number, dx: number, dz: number, far: number): { d: number; i: number } => {
      let best = far;
      let who = -1;
      for (let i = 0; i < n; i++) {
        const j = i * 3;
        const k = i * 16;
        /* The ray in the mesh's own frame: origin as a point, direction as a
           vector. Uniform scale is folded into the inverse, so `t` stays in
           world metres as long as the direction is not re-normalised. */
        const px = inv[k] * ox + inv[k + 4] * oy + inv[k + 8] * oz + inv[k + 12];
        const py = inv[k + 1] * ox + inv[k + 5] * oy + inv[k + 9] * oz + inv[k + 13];
        const pz = inv[k + 2] * ox + inv[k + 6] * oy + inv[k + 10] * oz + inv[k + 14];
        const vx = inv[k] * dx + inv[k + 8] * dz;
        const vy = inv[k + 1] * dx + inv[k + 9] * dz;
        const vz = inv[k + 2] * dx + inv[k + 10] * dz;
        let t0 = 0, t1 = best;
        const axes: [number, number, number][] = [[px, vx, 0], [py, vy, 1], [pz, vz, 2]];
        let miss = false;
        for (const [p0, v, ax] of axes) {
          const l = lo[j + ax], h = hi[j + ax];
          if (Math.abs(v) < 1e-9) { if (p0 < l || p0 > h) { miss = true; break; } continue; }
          let a = (l - p0) / v, b = (h - p0) / v;
          if (a > b) { const t = a; a = b; b = t; }
          if (a > t0) t0 = a;
          if (b < t1) t1 = b;
          if (t0 > t1) { miss = true; break; }
        }
        if (miss) continue;
        /* Inside the box already: that is a hit at nothing. */
        if (t0 < best) { best = t0; who = i; }
      }
      /* The turned stones, in their own frames. */
      for (const s of stones) {
        if (oy < s.y || oy > s.y + s.h) continue;
        /* Into the stone's frame: a turn of `turn` about Y undone, which in
           three.js's convention is x' = x cos t − z sin t, z' = x sin t + z cos t. */
        const c = Math.cos(s.turn), sn = Math.sin(s.turn);
        const px = ox - s.x, pz = oz - s.z;
        const lx = px * c - pz * sn, lz = px * sn + pz * c;
        const ldx = dx * c - dz * sn, ldz = dx * sn + dz * c;
        const jx = ldx === 0 ? Infinity : 1 / ldx;
        const jz = ldz === 0 ? Infinity : 1 / ldz;
        let t0 = 0, t1 = best;
        let a = (-s.hw - lx) * jx, b = (s.hw - lx) * jx;
        if (a > b) { const t = a; a = b; b = t; }
        if (a > t0) t0 = a;
        if (b < t1) t1 = b;
        if (t0 > t1) continue;
        a = (-s.hd - lz) * jz; b = (s.hd - lz) * jz;
        if (a > b) { const t = a; a = b; b = t; }
        if (a > t0) t0 = a;
        if (b < t1) t1 = b;
        if (t0 > t1) continue;
        if (t0 < best) { best = t0; who = -2 - stones.indexOf(s); }
      }
      return { d: best, i: who };
    };
    /* The boxes themselves ride back once, so a hit can be named. */
    /* Named later in world terms: the local box's centre and size carried
       through the matrix, which for a turned mesh is its own size, not its
       world box's. */
    const named: { size: string; at: string }[] = [];
    const inverse = new THREE.Matrix4();
    const centre = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const j = i * 3, k = i * 16;
      inverse.fromArray(inv.slice(k, k + 16)).invert();
      centre.set((lo[j] + hi[j]) / 2, (lo[j + 1] + hi[j + 1]) / 2, (lo[j + 2] + hi[j + 2]) / 2).applyMatrix4(inverse);
      const el = inverse.elements;
      const s = [
        Math.hypot(el[0], el[1], el[2]) * (hi[j] - lo[j]),
        Math.hypot(el[4], el[5], el[6]) * (hi[j + 1] - lo[j + 1]),
        Math.hypot(el[8], el[9], el[10]) * (hi[j + 2] - lo[j + 2]),
      ];
      named.push({ size: s.map((v) => v.toFixed(2)).join('×'), at: centre.toArray().map((v) => v.toFixed(1)).join(',') });
    }
    (window as unknown as { __wallBoxes?: { size: string; at: string }[] }).__wallBoxes = named;
    return rays.map((r) => {
      const h = slab(r.x, r.y, r.z, r.dx, r.dz, r.far);
      return h.d >= r.far ? { d: Infinity, i: -1 } : h;
    });
  }, { rays, stones });
}

/**
 * For each spot, the index of a drawn box whose grown footprint covers it
 * within the height band, or -1. Same boxes as `cast`, same frames; the stones
 * as their own turned boxes.
 */
async function covered(page: Page, spots: Spot[], stones: Obb[]): Promise<number[]> {
  return page.evaluate(({ spots, stones, GROW }) => {
    const w = window as unknown as { __scene?: unknown; __THREE?: unknown };
    const THREE = w.__THREE as typeof import('three') | undefined;
    const scene = w.__scene as import('three').Scene | undefined;
    if (!THREE || !scene) return spots.map(() => -1);
    const lo: number[] = [];
    const hi: number[] = [];
    const inv: number[] = [];
    const m4 = new THREE.Matrix4();
    scene.updateMatrixWorld(true);
    scene.traverse((o) => {
      const m = o as import('three').Mesh;
      if (!m.isMesh || !m.geometry) return;
      if ((m as unknown as { isSkinnedMesh?: boolean }).isSkinnedMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      if (mats.some((mm) => mm && (mm as import('three').Material).polygonOffset)) return;
      const g = m.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      const b = g.boundingBox;
      if (!b) return;
      /* Merges included here, unlike `cast`: a building drawn as one merged
         mesh is solid and its box is its shape, and a scatter's box saying
         "drawn" can only hide a wall of air, never invent one. */
      const e = m.matrixWorld.elements;
      const sy = Math.hypot(e[4], e[5], e[6]) * (b.max.y - b.min.y);
      if (sy < 0.05) return;
      m4.copy(m.matrixWorld).invert();
      lo.push(b.min.x, b.min.y, b.min.z);
      hi.push(b.max.x, b.max.y, b.max.z);
      inv.push(...m4.elements);
    });
    const n = lo.length / 3;
    return spots.map((sp) => {
      /* The whole band at once: the spot is a vertical segment from the shin to
         the chest, and a box covers it if the segment crosses the box. Three
         sampled heights let a rail thinner than the gap between them read as
         air; a segment cannot miss anything that is there. */
      for (let i = 0; i < n; i++) {
        const j = i * 3, k = i * 16;
        const p0 = [
          inv[k] * sp.x + inv[k + 4] * sp.lo + inv[k + 8] * sp.z + inv[k + 12],
          inv[k + 1] * sp.x + inv[k + 5] * sp.lo + inv[k + 9] * sp.z + inv[k + 13],
          inv[k + 2] * sp.x + inv[k + 6] * sp.lo + inv[k + 10] * sp.z + inv[k + 14],
        ];
        const p1 = [
          inv[k] * sp.x + inv[k + 4] * sp.hi + inv[k + 8] * sp.z + inv[k + 12],
          inv[k + 1] * sp.x + inv[k + 5] * sp.hi + inv[k + 9] * sp.z + inv[k + 13],
          inv[k + 2] * sp.x + inv[k + 6] * sp.hi + inv[k + 10] * sp.z + inv[k + 14],
        ];
        /* The growth is in world metres; the local box may be scaled, so
           grow by the local equivalent along each axis — sideways only. */
        const g = [
          GROW * Math.hypot(inv[k], inv[k + 1], inv[k + 2]),
          0,
          GROW * Math.hypot(inv[k + 8], inv[k + 9], inv[k + 10]),
        ];
        let tmin = 0, tmax = 1, miss = false;
        for (let a = 0; a < 3 && !miss; a++) {
          const min = lo[j + a] - g[a], max = hi[j + a] + g[a];
          const d = p1[a] - p0[a];
          if (Math.abs(d) < 1e-9) { if (p0[a] < min || p0[a] > max) miss = true; continue; }
          let t0 = (min - p0[a]) / d, t1 = (max - p0[a]) / d;
          if (t0 > t1) { const t = t0; t0 = t1; t1 = t; }
          if (t0 > tmin) tmin = t0;
          if (t1 < tmax) tmax = t1;
          if (tmin > tmax) miss = true;
        }
        if (!miss) return i;
      }
      for (let si = 0; si < stones.length; si++) {
        const st = stones[si];
        if (sp.hi < st.y || sp.lo > st.y + st.h) continue;
        const c = Math.cos(st.turn), sn = Math.sin(st.turn);
        const dx = sp.x - st.x, dz = sp.z - st.z;
        const lx = dx * c - dz * sn, lz = dx * sn + dz * c;
        if (Math.abs(lx) <= st.hw + GROW && Math.abs(lz) <= st.hd + GROW) return -2 - si;
      }
      return -1;
    });
  }, { spots, stones, GROW });
}

/** Names a box the page reported: its size and centre. */
async function nameOf(page: Page, i: number, stones: Obb[]): Promise<string> {
  if (i <= -2) { const st = stones[-2 - i]; return `stone ${(st.hw * 2).toFixed(2)}×${(st.hd * 2).toFixed(2)} @ ${st.x.toFixed(1)},${st.z.toFixed(1)}`; }
  if (i < 0) return 'nothing';
  return page.evaluate((i) => {
    const b = (window as unknown as { __wallBoxes?: { size: string; at: string }[] }).__wallBoxes;
    const e = b?.[i];
    return e ? `box ${e.size} @ ${e.at}` : '?';
  }, i);
}

async function main() {
  refuseRemote();
  await ensurePlayer();
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
  console.log(`\nWalls — collision against what is drawn, against ${BASE}\n`);
  let bad = 0;

  for (const id of chosen) {
    const area = AREAS[id];
    const cells = walkableCells(area);
    const key = (x: number, z: number, y: number) => `${Math.round(x / STEP)}|${Math.round(z / STEP)}|${y.toFixed(1)}`;
    const have = new Set(cells.map((c) => key(c.x, c.z, c.y)));
    const storeys = hasStoreys(area);
    const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    /* Question one: from every cell that is stopped, look at what stops it. */
    /* Flat areas' cells carry no floor (`walkableCells` only tracks one where
       storeys stack), and a ray at `NaN + 0.9` is a ray at every height at
       once: it reported the shop's ceiling lamps as walls at hip height. */
    const floorOf = (c: { x: number; z: number; y: number }) =>
      Number.isFinite(c.y) ? c.y : groundAt(area, c.x, c.z);
    const stopped: { x: number; z: number; y: number; dx: number; dz: number }[] = [];
    for (const c of cells) {
      if (nearDoor(area, c.x, c.z)) continue;
      const cy = floorOf(c);
      for (const [dx, dz] of dirs) {
        const nx = c.x + dx * STEP;
        const nz = c.z + dz * STEP;
        if (have.has(key(nx, nz, c.y))) continue;
        /* A neighbour that is standable but simply unreached is not a wall;
           a neighbour the duelist cannot fit on is. */
        if (standable(area, nx, nz, storeys ? c.y : Number.NaN)) continue;
        /* A drop is not a wall either. The terraces and the galleries stop you
           at their edge on purpose, and what stops you there is the edge —
           a coping, a rail, the ground falling away — which a hip-height ray
           looks straight over. */
        const below = groundAt(area, nx, nz, cy);
        if (Number.isFinite(below) && below < cy - 0.4) continue;
        stopped.push({ x: c.x, z: c.z, y: cy, dx, dz });
      }
    }
    /* Question two: from every other cell, look for a wall inside it. */
    const inside: { x: number; z: number; y: number }[] = cells
      .filter((c) => Math.round(c.x / STEP) % 2 === 0 && Math.round(c.z / STEP) % 2 === 0)
      .map((c) => ({ x: c.x, z: c.z, y: floorOf(c) }));

    const ctx = await browser.newContext({ viewport: { width: 900, height: 600 } });
    const page = await ctx.newPage();
    await fetch(`${BASE}/api/story/save`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: NAME, world: { area: id, ...area.spawn } }),
    }).catch(() => {});
    let there = await enterStory(page, id, PINNED_HOUR);
    if (!there) there = await enterStory(page, id, PINNED_HOUR);
    if (!there) { console.log(`  ❌ ${id} — never reached`); bad++; await ctx.close(); continue; }
    /* esbuild's `keepNames` wraps the inner functions of an evaluate in a
       `__name(...)` helper that the page has never heard of. Same shim as the
       seam sweep. */
    await page.evaluate('globalThis.__name = globalThis.__name || ((f) => f)');
    const stones = stonesOf(area);

    /* Batch the rays: a page.evaluate carrying a hundred thousand of them is fine. */
    const spots: Spot[] = [];
    for (const s of stopped) {
      /* From the feet up: a coping, a kerb, a plinth is a thing you can see
         stopping you, and the terraces stop you at their copings on purpose. */
      for (const r of REACH) spots.push({ x: s.x + s.dx * r, z: s.z + s.dz * r, lo: s.y + 0.05, hi: s.y + 1.4 });
    }
    const PER = REACH.length;
    const rays2: Ray[] = [];
    for (const c of inside) for (const [dx, dz] of dirs) rays2.push({ x: c.x, y: c.y + 0.9, z: c.z, dx, dz, far: STEP });

    const hit1 = await covered(page, spots, stones);
    if (WHY) {
      for (let i = 0; i < stopped.length; i++) {
        const st = stopped[i];
        if (Math.hypot(st.x - WHY.x, st.z - WHY.z) > 1) continue;
        const hits = [];
        for (let k = 0; k < PER; k++) hits.push(hit1[i * PER + k]);
        console.log(`     why ${st.x.toFixed(2)},${st.z.toFixed(2)} floor ${st.y.toFixed(2)} dir ${st.dx},${st.dz}: ${hits.map((h) => (h === -1 ? '·' : h <= -2 ? 'stone' : String(h))).join(' ')}`);
      }
      const nearby = await page.evaluate(({ x, z }) => {
        const w = window as unknown as { __scene?: import('three').Scene; __THREE?: typeof import('three') };
        const THREE = w.__THREE!; const scene = w.__scene!;
        const box = new THREE.Box3(); const out: string[] = [];
        scene.traverse((o) => {
          const m = o as import('three').Mesh;
          if (!m.isMesh) return;
          box.setFromObject(m);
          if (x < box.min.x - 1.6 || x > box.max.x + 1.6 || z < box.min.z - 1.6 || z > box.max.z + 1.6) return;
          const pos = m.geometry.attributes.position;
          out.push(`${m.geometry.type} v${pos.count} y ${box.min.y.toFixed(2)}..${box.max.y.toFixed(2)} x ${box.min.x.toFixed(2)}..${box.max.x.toFixed(2)} z ${box.min.z.toFixed(2)}..${box.max.z.toFixed(2)}`);
        });
        return out.slice(0, 25);
      }, WHY);
      console.log(`     meshes within 1.6 m of ${WHY.x},${WHY.z}:\n       ` + nearby.join('\n       '));
    }
    const hit2 = await cast(page, rays2, stones);

    const nothing: { x: number; z: number; d: number; i: number }[] = [];
    for (let i = 0; i < stopped.length; i++) {
      let drawn = false;
      for (let k = 0; k < PER; k++) if (hit1[i * PER + k] !== -1) { drawn = true; break; }
      if (!drawn) nothing.push({ x: stopped[i].x, z: stopped[i].z, d: Infinity, i: -1 });
    }
    const through: { x: number; z: number; d: number; i: number }[] = [];
    for (let i = 0; i < inside.length; i++) {
      let best = { d: Infinity, i: -1 };
      for (let k = 0; k < 4; k++) if (hit2[i * 4 + k].d < best.d) best = hit2[i * 4 + k];
      /* Inside, not merely near: a drawn face fourteen centimetres proud of
         its collision puts the nearest cell's edge within reach without anybody
         ever being inside anything. Zero is the duelist standing in the wall. */
      if (best.d <= 0) through.push({ x: inside[i].x, z: inside[i].z, d: best.d, i: best.i });
    }

    /*
     * Two kinds of "stopped by nothing", and only one of them is a wall.
     *
     * A solid that stands a metre or two proud of the thing it is for — a
     * lantern's plinth, a lamp post, the foot of a flight — is a fitting cut
     * generously, and the eye reads the thing and stops for it. That is a
     * warning. A solid with nothing drawn anywhere near it is a wall of air,
     * which is what this check exists to find, and that fails.
     */
    const air = nothing.filter((n) => !Number.isFinite(n.d));
    const proud = nothing.filter((n) => Number.isFinite(n.d));
    const c1 = cluster(air);
    const c1w = cluster(proud);
    const c2 = cluster(through);
    console.log(`  ${id}: ${cells.length} cells, ${stopped.length} stopped edges, ${inside.length} interior samples`);
    if (!c1.length) console.log(`  ✅ ${id}: nothing stops you where nothing is drawn`);
    else {
      bad++;
      console.log(`  ❌ ${id}: walls of air at ${air.length} edge(s), in ${c1.length} place(s)`);
      for (const c of c1.slice(0, 8)) console.log(`       ${String(c.n).padStart(4)} edges  around ${c.x.toFixed(1)}, ${c.z.toFixed(1)}`);
      if (c1.length > 8) console.log(`       …and ${c1.length - 8} more`);
    }
    if (c1w.length) {
      console.log(`  ⚠️  ${id}: collision more than a metre proud of its drawing at ${proud.length} edge(s), in ${c1w.length} place(s)`);
      for (const c of c1w.slice(0, 5)) {
        console.log(`       ${String(c.n).padStart(4)} edges  around ${c.x.toFixed(1)}, ${c.z.toFixed(1)}  — ${c.d.toFixed(2)} m to ${await nameOf(page, c.i, stones)}`);
      }
      if (c1w.length > 5) console.log(`       …and ${c1w.length - 5} more`);
    }
    if (!c2.length) console.log(`  ✅ ${id}: and nothing drawn stands where you can`);
    else {
      bad++;
      console.log(`  ❌ ${id}: walked into ${through.length} drawn thing(s), in ${c2.length} place(s)`);
      for (const c of c2.slice(0, 8)) {
        console.log(`       ${String(c.n).padStart(4)} cells  around ${c.x.toFixed(1)}, ${c.z.toFixed(1)}  — ${await nameOf(page, c.i, stones)}`);
      }
      if (c2.length > 8) console.log(`       …and ${c2.length - 8} more`);
    }
    await ctx.close();
  }
  await browser.close();
  console.log(bad ? `\nWALLS: ${bad} problem(s). ❌` : '\nWALLS: every wall you meet is the wall you see. ✅');
  process.exit(bad ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
