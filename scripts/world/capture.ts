/**
 * Run an area's old three.js builder in Node and write down what it drew.
 *
 * The world is built in Blender now (`scripts/world/build.mjs`), and the way
 * an area that was hand-built in TypeScript gets there is this: build it here
 * with the real three.js and a canvas that draws nothing, walk the group it
 * returns, and write every mesh out as triangles in world metres with the
 * material it wore — its colour, which surface drawer made its texture (the
 * texture's `name`, tagged by `surfaces.ts` when there is no window), whether
 * it glowed, the parts a merge was baked from, and every lamp and the sky it
 * was tuned for. `scripts/blender/world/port.py` rebuilds that with the
 * photographed materials in `data/world/<area>.dressing.json`.
 *
 * Nothing about the geometry changes on the way through: what passed
 * `footing`, `walls`, `coplanar` and `embedded` in three.js passes them as a
 * file, because it is the same boxes.
 *
 *   npx tsx scripts/world/capture.ts <area> <out.json>
 */

import { readFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';

/**
 * The first string a drawer was called with, read off the line that called
 * it. A canvas texture carries which drawer made it and where it was asked
 * for (`surfaces.ts`, `tagged`); the tint the drawer was handed is on that
 * line, `brick('#6b3f34')`, and it is what the port tints the photograph by.
 */
const sources = new Map<string, string[]>();
function argOf(drawer: string, at: string): string | null {
  const m = /^(.*?):(\d+):(\d+)$/.exec(at.replace(/^file:\/\//, ''));
  if (!m) return null;
  const [, file, line] = m;
  if (!sources.has(file)) {
    try { sources.set(file, readFileSync(file, 'utf8').split('\n')); } catch { sources.set(file, []); }
  }
  const text = sources.get(file)?.[Number(line) - 1] ?? '';
  const call = new RegExp(`\\b${drawer}\\(([^)]*)\\)`).exec(text);
  if (!call) return null;
  const lit = /'([^']*)'|"([^"]*)"/.exec(call[1]);
  return lit ? (lit[1] ?? lit[2]) : null;
}

/* ---- a document with a canvas that draws nothing ---- */

/* Every property is a callable that returns itself; every number it is asked
   to be is nought. The drawers run to completion and produce a texture that
   knows its name and nothing else, which is all the port needs. */
const nothing: unknown = new Proxy(function () { /* draws nothing */ }, {
  get: (_t, p) => (p === Symbol.toPrimitive ? () => 0 : p === 'length' ? 0 : nothing),
  apply: () => nothing,
  set: () => true,
});
(globalThis as { document?: unknown }).document = {
  createElement: (tag: string) => (tag === 'canvas'
    ? { width: 0, height: 0, getContext: () => nothing, toDataURL: () => '' }
    : {}),
};

/* ---- the builders ---- */

type Builder = (anisotropy: number) => { root: THREE.Group; dispose(): void };

async function builderOf(area: string): Promise<Builder> {
  switch (area) {
    case 'black-crown': return (await import('./legacy/blackcrown')).buildBlackCrown;
    case 'crown-shop': return (await import('./legacy/crownshop')).buildCrownShop;
    case 'old-cemetery': return (await import('./legacy/cemetery')).buildCemetery;
    case 'domino-station': return (await import('./legacy/station')).buildStation;
    case 'station-plaza': return (await import('./legacy/plaza')).buildPlaza;
    case 'domino-high': return (await import('./legacy/high')).buildHigh;
    case 'central-towers': return (await import('./legacy/towers')).buildTowers;
    default: throw new Error(`no old builder to capture for ${area}`);
  }
}

/* ---- the capture ---- */

interface Captured {
  area: string;
  meshes: Array<{
    name: string;
    geo: 'box' | 'plane' | 'raw';
    /** For a box: its size and full world matrix, so the port can keep it a box. */
    box?: { w: number; h: number; d: number; matrix: number[] };
    pos: number[];
    idx: number[];
    uv: number[];
    mat: {
      color: string;
      map: string | null;
      /** What the drawer was handed: a tint for the surface, when it took one. */
      arg: string | null;
      repeat: [number, number];
      sign?: { text: string; ink: string; ground: string; sub?: string; aspect?: number };
      glow: boolean;
      opacity: number;
      transparent: boolean;
      side: number;
      roughness: number;
      metalness: number;
      tile: number | null;
      polygonOffset: boolean;
    };
    cast: boolean;
    receive: boolean;
    parts?: number[][];
  }>;
  lights: Array<{ x: number; y: number; z: number; colour: string; intensity: number; distance: number }>;
  sky: unknown;
  counts: { meshes: number; tris: number; lights: number };
}

const round = (v: number) => Math.round(v * 1e4) / 1e4;

/**
 * The boxes a merge was made of, worked out from the geometry when the
 * builder did not say: `mergeGeometries` keeps every box's vertices to
 * itself, so the connected pieces of the index are the boxes. Each becomes
 * a part for the checks — an axis-aligned one, flagged `turned` when its
 * corners do not sit on its own bounding box.
 */
function partsOf(pos: number[], idx: number[]): number[][] | undefined {
  const n = pos.length / 3;
  /* A merged box keeps its 24 vertices and 36 indices together; a merged
     plane its 4 and 6. Read the pieces off that; fall back to the connected
     pieces of the index when the merge is neither. */
  let groups: number[][];
  if (n >= 48 && n % 24 === 0 && idx.length === n * 1.5) {
    groups = Array.from({ length: n / 24 }, (_, b) => Array.from({ length: 24 }, (_, v) => b * 24 + v));
  } else if (n >= 8 && n % 4 === 0 && idx.length === n * 1.5) {
    groups = Array.from({ length: n / 4 }, (_, b) => Array.from({ length: 4 }, (_, v) => b * 4 + v));
  } else {
    if (n < 16) return undefined;
    const parent = Array.from({ length: n }, (_, i) => i);
    const find = (a: number): number => {
      while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
      return a;
    };
    const unite = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
    for (let i = 0; i < idx.length; i += 3) { unite(idx[i], idx[i + 1]); unite(idx[i + 1], idx[i + 2]); }
    const byRoot = new Map<number, number[]>();
    for (let i = 0; i < n; i++) { const r = find(i); const g = byRoot.get(r); if (g) g.push(i); else byRoot.set(r, [i]); }
    groups = [...byRoot.values()];
  }
  if (groups.length < 2) return undefined;
  const parts: number[][] = [];
  for (const g of groups) {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const v of g) {
      const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    /* Axis-aligned when every vertex sits on a face of its own box in both x and z. */
    const eps = 1e-3;
    const turned = g.some((v) => {
      const x = pos[v * 3], z = pos[v * 3 + 2];
      return (Math.abs(x - x0) > eps && Math.abs(x - x1) > eps) || (Math.abs(z - z0) > eps && Math.abs(z - z1) > eps);
    }) ? 1 : 0;
    parts.push([round(x0), round(y0), round(z0), round(x1), round(y1), round(z1), turned]);
  }
  return parts;
}

async function main() {
  const [area, out] = process.argv.slice(2);
  if (!area || !out) throw new Error('usage: capture.ts <area> <out.json>');
  const build = await builderOf(area);
  const { SKIES_MADE } = await import('../../src/components/story/world/sky');
  const built = build(1);
  const root = built.root;
  root.updateMatrixWorld(true);

  const cap: Captured = { area, meshes: [], lights: [], sky: null, counts: { meshes: 0, tris: 0, lights: 0 } };
  const v = new THREE.Vector3();
  root.traverse((o) => {
    if ((o as THREE.PointLight).isPointLight) {
      const l = o as THREE.PointLight;
      l.getWorldPosition(v);
      cap.lights.push({ x: round(v.x), y: round(v.y), z: round(v.z), colour: `#${l.color.getHexString()}`, intensity: l.intensity, distance: l.distance });
      return;
    }
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.visible) return;
    const geo = m.geometry as THREE.BufferGeometry;
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial & { map?: THREE.Texture | null };
    const posAttr = geo.getAttribute('position');
    if (!posAttr) return;
    const pos: number[] = [];
    for (let i = 0; i < posAttr.count; i++) {
      v.fromBufferAttribute(posAttr, i).applyMatrix4(m.matrixWorld);
      pos.push(round(v.x), round(v.y), round(v.z));
    }
    const idx: number[] = geo.index ? Array.from(geo.index.array as ArrayLike<number>) : Array.from({ length: posAttr.count }, (_, i) => i);
    const uvAttr = geo.getAttribute('uv');
    const uv: number[] = uvAttr ? Array.from(uvAttr.array as ArrayLike<number>).map(round) : [];
    const p = (geo as THREE.BoxGeometry).parameters as { width?: number; height?: number; depth?: number } | undefined;
    const kind: 'box' | 'plane' | 'raw' = geo.type === 'BoxGeometry' ? 'box' : geo.type === 'PlaneGeometry' ? 'plane' : 'raw';
    const map = mat.map ?? null;
    let sign = map && map.name === 'signBoard' ? (map.userData as { sign?: Captured['meshes'][number]['mat']['sign'] }).sign : undefined;
    if (sign) {
      /* The proportion of the face it is on, for the picture drawn for it. */
      const xs = pos.filter((_, i) => i % 3 === 0), ys = pos.filter((_, i) => i % 3 === 1), zs = pos.filter((_, i) => i % 3 === 2);
      const ext = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), Math.max(...zs) - Math.min(...zs)].sort((a, b) => b - a);
      sign = { ...sign, aspect: round(ext[0] / Math.max(ext[1], 1e-3)) };
    }
    const isBasic = (mat as unknown as THREE.MeshBasicMaterial).isMeshBasicMaterial === true;
    cap.meshes.push({
      name: m.name,
      geo: kind,
      box: kind === 'box' && p ? { w: p.width ?? 1, h: p.height ?? 1, d: p.depth ?? 1, matrix: m.matrixWorld.toArray().map(round) } : undefined,
      pos,
      idx,
      uv,
      mat: {
        color: `#${mat.color.getHexString()}`,
        map: map ? map.name || 'unknown' : null,
        arg: map && map.name ? argOf(map.name, String((map.userData as { at?: string }).at ?? '')) : null,
        repeat: map ? [round(map.repeat.x), round(map.repeat.y)] : [1, 1],
        sign,
        glow: isBasic,
        opacity: mat.opacity ?? 1,
        transparent: mat.transparent === true,
        side: mat.side,
        roughness: mat.roughness ?? 1,
        metalness: mat.metalness ?? 0,
        tile: (mat.userData?.tile as number | undefined) ?? null,
        polygonOffset: mat.polygonOffset === true,
      },
      cast: m.castShadow,
      receive: m.receiveShadow,
      parts: (m.userData?.parts as number[][] | undefined) ?? (kind === 'raw' ? partsOf(pos, idx) : undefined),
    });
    cap.counts.tris += idx.length / 3;
  });
  cap.counts.meshes = cap.meshes.length;
  cap.counts.lights = cap.lights.length;
  cap.sky = SKIES_MADE[SKIES_MADE.length - 1] ?? null;
  built.dispose();
  writeFileSync(out, JSON.stringify(cap));
  console.log(`  captured ${area}: ${cap.counts.meshes} meshes, ${cap.counts.tris} tris, ${cap.counts.lights} lamps, sky ${cap.sky ? 'yes' : 'NO'}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
