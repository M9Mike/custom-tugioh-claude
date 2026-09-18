/**
 * `npm run whystop -- <area> x,z,dx,dz[,y] …`
 *
 * Which solid stops the duelist here? For each spot, one step (0.25 m) in the
 * direction given, settled the way the game settles her, and every rectangle
 * whose grown box overlaps the body there — with its height band, so a solid
 * that applies only on another storey says so. The companion to `npm run
 * walls -- <area> --why=x,z`, which says what is *drawn* near a stop; this
 * says what *collides*. Between the two, a wall of air is named in a minute.
 */
import { AREAS, PLAYER_RADIUS, groundAt, settle, type AreaId } from '../src/story/areas';

const [id, ...specs] = process.argv.slice(2);
const area = AREAS[id as AreaId];
if (!area) {
  console.error(`whystop: no area "${id}"`);
  process.exit(2);
}
for (const spec of specs) {
  const [x, z, dx, dz, y0] = spec.split(',').map(Number);
  const y = Number.isFinite(y0) ? y0 : groundAt(area, x, z);
  const nx = x + (dx || 0) * 0.25;
  const nz = z + (dz || 0) * 0.25;
  const s = settle(area, nx, nz, PLAYER_RADIUS, y);
  const free = Math.abs(s.x - nx) < 1e-9 && Math.abs(s.z - nz) < 1e-9;
  console.log(
    `${id} from ${x},${z} (floor ${y.toFixed(2)}) step to ${nx},${nz}: settle -> ${s.x.toFixed(3)},${s.z.toFixed(3)} ` +
    `${free ? 'FREE' : 'STOPPED'}; ground there ${groundAt(area, nx, nz, y).toFixed(2)}`
  );
  area.solids.forEach((r, i) => {
    const ox = Math.abs(r.x - nx) < r.hw + PLAYER_RADIUS;
    const oz = Math.abs(r.z - nz) < r.hd + PLAYER_RADIUS;
    if (!ox || !oz) return;
    const band = y >= (r.from ?? -Infinity) - 0.5 && y <= (r.to ?? Infinity);
    const draw = (r as { draw?: string }).draw;
    console.log(
      `   solid #${i} ${band ? 'IN BAND' : 'out of band'}: x ${(r.x - r.hw).toFixed(2)}..${(r.x + r.hw).toFixed(2)} ` +
      `z ${(r.z - r.hd).toFixed(2)}..${(r.z + r.hd).toFixed(2)} from ${r.from ?? '-'} to ${r.to ?? '-'}` +
      `${r.tall ? ' tall' : ''}${draw ? ` draw:${draw}` : ''}`
    );
  });
}
