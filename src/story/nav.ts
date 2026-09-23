/**
 * Finding a way across an area, using nothing but the area's own collision.
 *
 * Everybody who walked in this world until the tournament walked a route
 * somebody wrote down point by point, checked by `npm run roam` at forty
 * samples a leg. That is right for one courier in one arcade and impossible for
 * a dozen duelists crossing nine areas through every gate between them — there
 * are hundreds of legs, and a leg written by hand is a leg that cuts a corner
 * through a lamp post. So the legs are *found*, and they are found against the
 * same two numbers the player walks on: `settle`, which says where a body of a
 * given width can stand, and `groundAt`, which says which floor a step from here
 * lands on. A path out of here is a path the roam check would pass, because it
 * is made of the roam check's own test.
 *
 * No three.js, like everything else in `src/story`. Two callers:
 *
 * - `scripts/travel-paths.ts`, offline, which finds every leg between every
 *   gate and every place somebody stops, smooths it and writes it down
 *   (`generated/travel-paths.json`). The schedule is made of those.
 * - The world, at run time, for the one walk nobody can write down in advance:
 *   a duelist you have just finished talking to, standing wherever the
 *   conversation left them, finding the nearest way out. It is lazy — a cell is
 *   only asked about when the search reaches it — so a detour across an open
 *   precinct costs a few hundred questions, not the whole area's.
 */

import { groundAt, inside, settle, type Area, type Rect } from './areas';

/** Where a body may be pushed out of: the width `npm run roam` walks at. */
export const NAV_RADIUS = 0.4;
/** Half a metre: a pair of cells across every doorway worth the name. */
export const NAV_CELL = 0.5;
/**
 * The most a walk may drop in one sample.
 *
 * A kerb is fourteen centimetres and a tread eighteen; a terrace edge with no
 * rail is two metres. Anything under half a metre is a step down somebody
 * takes without thinking and anything over it is a ledge, which a person walks
 * round rather than off.
 */
const DROP = 0.45;
/** How finely a straight line is tested: every ten centimetres, twice the roam check's rate on its longest leg. */
const SAMPLE = 0.1;

export interface NavPoint {
  x: number;
  z: number;
}

/** A height band a walk must stay inside — the ground storeys, not the galleries. */
export type Band = readonly [number, number];

/** Whether a body of `radius` can stand at (x, z) on the floor at height `y`. */
export function standsAt(area: Area, x: number, z: number, y: number, radius = NAV_RADIUS): boolean {
  if (!inside(area.bounds, x, z)) return false;
  const s = settle(area, x, z, radius, y);
  return Math.hypot(s.x - x, s.z - z) <= 0.02;
}

/**
 * The floor a step from height `from` on to (x, z) lands on — or null when the
 * step cannot be taken: into something, off a ledge, or out of the band.
 */
export function stepOnto(
  area: Area,
  x: number,
  z: number,
  from: number,
  radius = NAV_RADIUS,
  band?: Band,
  avoid?: readonly Rect[]
): number | null {
  const y = groundAt(area, x, z, from);
  if (from - y > DROP) return null;
  if (band && (y < band[0] || y > band[1])) return null;
  if (avoid && avoid.some((r) => inside(r, x, z))) return null;
  return standsAt(area, x, z, y, radius) ? y : null;
}

/**
 * Walks a straight line from `a` (standing at height `ya`) to `b`.
 *
 * Returns the height it arrives at, or null if any sample on the way is
 * somewhere a body cannot be. The same test a roam leg is put to, at a finer
 * spacing.
 */
export function lineClear(
  area: Area,
  a: NavPoint,
  ya: number,
  b: NavPoint,
  radius = NAV_RADIUS,
  band?: Band,
  avoid?: readonly Rect[]
): number | null {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.max(1, Math.ceil(len / SAMPLE));
  let y = ya;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const next = stepOnto(area, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, y, radius, band, avoid);
    if (next === null) return null;
    y = next;
  }
  return y;
}

export interface FindOptions {
  radius?: number;
  band?: Band;
  /** Rectangles the walk may not enter — the gates it is not walking to. */
  avoid?: readonly Rect[];
  /** Give up after asking about this many cells. */
  budget?: number;
}

/**
 * The way from `from` (on the floor at `fromY`) to `to`, as a smoothed list of
 * corners — or null when there is none inside the budget.
 *
 * A* over half-metre cells, eight ways, asked lazily. A cell that is walkable
 * but tight — somewhere a body twice as wide could not stand — costs more to
 * cross, so a path keeps to the middle of a passage rather than grazing the
 * wall the way a shortest path always does; then the corners are pulled tight
 * along lines that are themselves walkable with a little room to spare.
 */
export function findPath(
  area: Area,
  from: NavPoint,
  fromY: number,
  to: NavPoint,
  opts: FindOptions = {}
): { points: NavPoint[]; heights: number[] } | null {
  const radius = opts.radius ?? NAV_RADIUS;
  const band = opts.band;
  const avoid = opts.avoid;
  const budget = opts.budget ?? 200_000;
  const b = area.bounds;
  const x0 = b.x - b.hw;
  const z0 = b.z - b.hd;
  const nx = Math.floor((b.hw * 2) / NAV_CELL) + 1;
  const nz = Math.floor((b.hd * 2) / NAV_CELL) + 1;
  const cx = (i: number) => x0 + i * NAV_CELL;
  const cz = (j: number) => z0 + j * NAV_CELL;
  const key = (i: number, j: number) => j * nx + i;

  /* Asked once each: the floor a cell was reached on, NaN for "cannot stand
     there", undefined for "not asked yet". */
  const floor = new Map<number, number>();
  const roomy = new Map<number, boolean>();
  let asked = 0;

  const reach = (i: number, j: number, fromHeight: number): number => {
    if (i < 0 || j < 0 || i >= nx || j >= nz) return Number.NaN;
    const k = key(i, j);
    const had = floor.get(k);
    if (had !== undefined) return had;
    asked++;
    const y = stepOnto(area, cx(i), cz(j), fromHeight, radius, band, avoid);
    const v = y === null ? Number.NaN : y;
    floor.set(k, v);
    return v;
  };
  const spacious = (i: number, j: number, y: number): boolean => {
    const k = key(i, j);
    const had = roomy.get(k);
    if (had !== undefined) return had;
    const v = standsAt(area, cx(i), cz(j), y, radius * 2);
    roomy.set(k, v);
    return v;
  };

  /* The nearest cell to a point that can be stood in, and walked to from it. */
  const snap = (p: NavPoint, py: number): { i: number; j: number; y: number } | null => {
    const bi = Math.round((p.x - x0) / NAV_CELL);
    const bj = Math.round((p.z - z0) / NAV_CELL);
    for (let ring = 0; ring <= 5; ring++) {
      let best: { i: number; j: number; y: number; d: number } | null = null;
      for (let di = -ring; di <= ring; di++) {
        for (let dj = -ring; dj <= ring; dj++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue;
          const i = bi + di;
          const j = bj + dj;
          if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
          const y = stepOnto(area, cx(i), cz(j), py, radius, band, avoid);
          if (y === null) continue;
          if (lineClear(area, p, py, { x: cx(i), z: cz(j) }, radius, band, avoid) === null && ring > 0) continue;
          const d = Math.hypot(cx(i) - p.x, cz(j) - p.z);
          if (!best || d < best.d) best = { i, j, y, d };
        }
      }
      if (best) return best;
    }
    return null;
  };

  const start = snap(from, fromY);
  if (!start) return null;
  floor.set(key(start.i, start.j), start.y);
  const goalI = Math.round((to.x - x0) / NAV_CELL);
  const goalJ = Math.round((to.z - z0) / NAV_CELL);

  /* A binary heap on f. */
  const heap: { k: number; f: number }[] = [];
  const push = (k: number, f: number) => {
    heap.push({ k, f });
    let n = heap.length - 1;
    while (n > 0) {
      const p = (n - 1) >> 1;
      if (heap[p].f <= heap[n].f) break;
      [heap[p], heap[n]] = [heap[n], heap[p]];
      n = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let n = 0;
      for (;;) {
        const l = n * 2 + 1;
        const r = l + 1;
        let m = n;
        if (l < heap.length && heap[l].f < heap[m].f) m = l;
        if (r < heap.length && heap[r].f < heap[m].f) m = r;
        if (m === n) break;
        [heap[m], heap[n]] = [heap[n], heap[m]];
        n = m;
      }
    }
    return top;
  };

  const g = new Map<number, number>();
  const came = new Map<number, number>();
  const closed = new Set<number>();
  const h = (i: number, j: number) => Math.hypot(i - goalI, j - goalJ) * NAV_CELL;
  const startK = key(start.i, start.j);
  g.set(startK, 0);
  push(startK, h(start.i, start.j));

  let reached = -1;
  let bestK = startK;
  let bestH = h(start.i, start.j);
  while (heap.length) {
    if (asked > budget) break;
    const { k } = pop();
    if (closed.has(k)) continue;
    closed.add(k);
    const i = k % nx;
    const j = (k - i) / nx;
    const y = floor.get(k)!;
    const here = h(i, j);
    if (here < bestH) {
      bestH = here;
      bestK = k;
    }
    if (here <= NAV_CELL * 0.75) {
      reached = k;
      break;
    }
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        if (!di && !dj) continue;
        const ni = i + di;
        const nj = j + dj;
        const nk = key(ni, nj);
        if (closed.has(nk)) continue;
        const ny = reach(ni, nj, y);
        if (!Number.isFinite(ny)) continue;
        /* A diagonal is only a diagonal if both sides of the corner it cuts
           are open — otherwise it is a squeeze past the edge of a solid. */
        if (di && dj) {
          if (!Number.isFinite(reach(i + di, j, y)) || !Number.isFinite(reach(i, j + dj, y))) continue;
        }
        /* And the half metre between the two centres is walked, not jumped:
           a rail twelve centimetres thick fits between two samples. */
        if (lineClear(area, { x: cx(i), z: cz(j) }, y, { x: cx(ni), z: cz(nj) }, radius, band, avoid) === null) continue;
        const step = (di && dj ? Math.SQRT2 : 1) * NAV_CELL;
        const cost = step * (spacious(ni, nj, ny) ? 1 : 2.2);
        const ng = g.get(k)! + cost;
        if (ng >= (g.get(nk) ?? Infinity)) continue;
        g.set(nk, ng);
        came.set(nk, k);
        push(nk, ng + h(ni, nj));
      }
    }
  }
  if (reached < 0) return null;

  /* Back from the goal to the start, as cell centres. */
  const cells: number[] = [];
  for (let k: number | undefined = reached; k !== undefined; k = came.get(k)) cells.push(k);
  cells.reverse();
  const raw: NavPoint[] = cells.map((k) => ({ x: cx(k % nx), z: cz(Math.floor(k / nx)) }));
  const rawY: number[] = cells.map((k) => floor.get(k)!);
  /* The real ends, when they can be walked to from their cells. */
  if (lineClear(area, from, fromY, raw[0], radius, band, avoid) !== null) {
    raw[0] = { x: from.x, z: from.z };
    rawY[0] = fromY;
  }
  const endY = lineClear(area, raw[raw.length - 1], rawY[rawY.length - 1], to, radius, band, avoid);
  if (endY !== null) {
    raw.push({ x: to.x, z: to.z });
    rawY.push(endY);
  }
  void bestK;
  return smooth(area, raw, rawY, radius, band, avoid);
}

/**
 * Pulls a cell-by-cell path tight.
 *
 * From each corner, as far along the rest as a straight line can go — tested
 * with a slightly wider body than the one walking it, so the line that
 * survives has a hand's width of room rather than none. Where the wider body
 * cannot get through at all (a gate exactly as wide as a person), the ordinary
 * one is enough.
 */
export function smooth(
  area: Area,
  pts: NavPoint[],
  ys: number[],
  radius = NAV_RADIUS,
  band?: Band,
  avoid?: readonly Rect[]
): { points: NavPoint[]; heights: number[] } {
  if (pts.length <= 2) return { points: pts.slice(), heights: ys.slice() };
  const wide = radius + 0.15;
  const clear = (a: number, b: number) =>
    lineClear(area, pts[a], ys[a], pts[b], wide, band, avoid) !== null ||
    lineClear(area, pts[a], ys[a], pts[b], radius, band, avoid) !== null && b - a === 1;
  const out: NavPoint[] = [pts[0]];
  const outY: number[] = [ys[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = i + 1;
    while (j + 1 < pts.length && clear(i, j + 1)) j++;
    out.push(pts[j]);
    outY.push(ys[j]);
    i = j;
  }
  return { points: out, heights: outY };
}

/** The length of a list of corners, in metres. */
export function pathLength(points: readonly NavPoint[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  return len;
}

/**
 * The point `d` metres along a list of corners, and which way it is heading.
 *
 * Past the end is the end; before the start is the start. The heading is the
 * direction of the leg the point is on, in the world's convention (0 is +Z).
 */
export function alongPath(points: readonly NavPoint[], d: number): { x: number; z: number; heading: number } {
  if (points.length === 1) return { x: points[0].x, z: points[0].z, heading: 0 };
  let left = Math.max(0, d);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const heading = Math.atan2(b.x - a.x, b.z - a.z);
    if (left <= len || i === points.length - 1) {
      const t = len > 1e-9 ? Math.min(1, left / len) : 1;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, heading };
    }
    left -= len;
  }
  const last = points[points.length - 1];
  return { x: last.x, z: last.z, heading: 0 };
}
