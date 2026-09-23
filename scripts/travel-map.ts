/**
 * The ground a traveller can cover in each area, drawn as a plan.
 *
 *   npx tsx scripts/travel-map.ts [area…] [--out=dir]
 *
 * A tool, not a gate. Every cell the tournament's duelists could reach from a
 * gate — flooded out from each door's landing with the same step test `nav.ts`
 * walks with, inside the band the travel rules allow — is painted by its height;
 * everything else is left dark. The gates, the stops already chosen in
 * `travel.ts` and the legs `travel-paths.json` holds are drawn over the top, so
 * a stop that has landed on a road or a leg that hugs a wall is a thing you see
 * rather than a thing you reason about.
 */
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { areaById, type AreaId } from '../src/story/areas';
import { NAV_CELL, stepOnto, standsAt, lineClear } from '../src/story/nav';
import { TRAVEL_AREAS, bandOf, stopsIn, gatesIn } from '../src/story/travel';
import paths from '../src/story/generated/travel-paths.json';

const args = process.argv.slice(2);
const outFlag = args.find((a) => a.startsWith('--out='));
const OUT = outFlag ? outFlag.slice(6) : '.cache/travel-maps';
const only = args.filter((a) => !a.startsWith('--')) as AreaId[];
const PX = 6;

mkdirSync(OUT, { recursive: true });

async function main() {
for (const id of only.length ? only : TRAVEL_AREAS) {
  const area = areaById(id);
  const band = bandOf(area);
  const b = area.bounds;
  const x0 = b.x - b.hw;
  const z0 = b.z - b.hd;
  const nx = Math.floor((b.hw * 2) / NAV_CELL) + 1;
  const nz = Math.floor((b.hd * 2) / NAV_CELL) + 1;
  const floor = new Float32Array(nx * nz).fill(Number.NaN);
  const room = new Uint8Array(nx * nz);
  const queue: number[] = [];
  for (const gate of gatesIn(id)) {
    const i = Math.round((gate.inner.x - x0) / NAV_CELL);
    const j = Math.round((gate.inner.z - z0) / NAV_CELL);
    const y = stepOnto(area, x0 + i * NAV_CELL, z0 + j * NAV_CELL, gate.innerY, undefined, band);
    if (y === null) {
      console.log(`  ${id}: the landing of ${gate.door.id} cannot be stood on`);
      continue;
    }
    floor[j * nx + i] = y;
    queue.push(j * nx + i);
  }
  let head = 0;
  while (head < queue.length) {
    const k = queue[head++];
    const i = k % nx;
    const j = (k - i) / nx;
    const y = floor[k];
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
      const nk = nj * nx + ni;
      if (Number.isFinite(floor[nk])) continue;
      const x = x0 + ni * NAV_CELL;
      const z = z0 + nj * NAV_CELL;
      const ny = stepOnto(area, x, z, y, undefined, band);
      if (ny === null) continue;
      if (lineClear(area, { x: x0 + i * NAV_CELL, z: z0 + j * NAV_CELL }, y, { x, z }, undefined, band) === null) continue;
      floor[nk] = ny;
      room[nk] = standsAt(area, x, z, ny, 1.6) ? 2 : standsAt(area, x, z, ny, 0.8) ? 1 : 0;
      queue.push(nk);
    }
  }
  const reached = queue.length;
  let lo = Infinity;
  let hi = -Infinity;
  for (const k of queue) {
    lo = Math.min(lo, floor[k]);
    hi = Math.max(hi, floor[k]);
  }
  const W = nx * PX;
  const H = nz * PX;
  const px = Buffer.alloc(W * H * 3);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const y = floor[j * nx + i];
      let r = 14;
      let g = 16;
      let bl = 20;
      if (Number.isFinite(y)) {
        const t = hi > lo ? (y - lo) / (hi - lo) : 0;
        const tight = room[j * nx + i];
        r = Math.round(60 + 150 * t);
        g = Math.round(90 + 60 * (1 - t) + (tight === 2 ? 40 : tight === 1 ? 15 : 0));
        bl = Math.round(70 + 40 * (1 - t));
      }
      for (let py = 0; py < PX; py++) {
        for (let pxx = 0; pxx < PX; pxx++) {
          const o = ((j * PX + py) * W + (i * PX + pxx)) * 3;
          px[o] = r;
          px[o + 1] = g;
          px[o + 2] = bl;
        }
      }
    }
  }
  const sx = (x: number) => ((x - x0) / NAV_CELL) * PX + PX / 2;
  const sz = (z: number) => ((z - z0) / NAV_CELL) * PX + PX / 2;
  const svg: string[] = [];
  /* A ten-metre grid, labelled, so a spot can be read off the picture. */
  for (let x = Math.ceil(x0 / 10) * 10; x <= b.x + b.hw; x += 10) {
    svg.push(`<line x1="${sx(x)}" y1="0" x2="${sx(x)}" y2="${H}" stroke="#ffffff" stroke-opacity="0.12"/>`);
    svg.push(`<text x="${sx(x) + 2}" y="12" font-size="11" fill="#cfd6e0">${x}</text>`);
  }
  for (let z = Math.ceil(z0 / 10) * 10; z <= b.z + b.hd; z += 10) {
    svg.push(`<line x1="0" y1="${sz(z)}" x2="${W}" y2="${sz(z)}" stroke="#ffffff" stroke-opacity="0.12"/>`);
    svg.push(`<text x="2" y="${sz(z) - 2}" font-size="11" fill="#cfd6e0">${z}</text>`);
  }
  for (const d of area.doors) {
    const t = d.trigger;
    svg.push(`<rect x="${sx(t.x - t.hw) - PX / 2}" y="${sz(t.z - t.hd) - PX / 2}" width="${(t.hw * 2 / NAV_CELL) * PX}" height="${(t.hd * 2 / NAV_CELL) * PX}" fill="#d9a441" fill-opacity="0.35" stroke="#d9a441"/>`);
    svg.push(`<text x="${sx(t.x)}" y="${sz(t.z)}" font-size="11" fill="#ffd27a" text-anchor="middle">${d.to}</text>`);
  }
  const legs = (paths as { areas: Record<string, { legs: { points: number[] }[] }> }).areas[id]?.legs ?? [];
  for (const leg of legs) {
    const pts: string[] = [];
    for (let k = 0; k < leg.points.length; k += 2) pts.push(`${sx(leg.points[k])},${sz(leg.points[k + 1])}`);
    svg.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="#7fd1ff" stroke-opacity="0.55" stroke-width="1.5"/>`);
  }
  for (const s of stopsIn(id)) {
    svg.push(`<circle cx="${sx(s.x)}" cy="${sz(s.z)}" r="${(3.2 / NAV_CELL) * PX}" fill="none" stroke="#ff6b6b" stroke-opacity="0.5"/>`);
    svg.push(`<circle cx="${sx(s.x)}" cy="${sz(s.z)}" r="5" fill="#ff6b6b"/>`);
    svg.push(`<text x="${sx(s.x) + 7}" y="${sz(s.z) + 4}" font-size="12" fill="#ffd0d0">${s.id}</text>`);
  }
  const file = join(OUT, `${id}.png`);
  await sharp(px, { raw: { width: W, height: H, channels: 3 } })
    .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${svg.join('')}</svg>`), top: 0, left: 0 }])
    .png()
    .toFile(file);
  console.log(`${id.padEnd(15)} ${reached} cells reachable, floors ${lo.toFixed(2)}–${hi.toFixed(2)} → ${file}`);
}
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
