'use client';

/**
 * The plan of Domino City, drawn from the city itself.
 *
 * Nothing here is authored. Every rectangle is an area's own `bounds` put
 * through its own `world` offset, so the map is a *projection* of
 * `src/story/areas.ts` rather than a second copy of it — the day an area
 * lands, it appears here at the right size in the right place with its name
 * on it, and nobody has to remember to come and draw it. That is the whole
 * design: a hand-drawn map of a world that is still being built is a map that
 * is wrong within a week.
 *
 * ## Clicking it moves you, and that part is scaffolding
 *
 * Mike asked for it and said so out loud: for now the map is a teleport, and
 * later it will be something else. So the teleport is one prop — `onGo` — and
 * the drawing does not depend on it. Take the prop away and what is left is a
 * map.
 *
 * ## Which area a click means
 *
 * The rectangles overlap: the Kame Game Shop's footprint is inside the
 * Starting Area's, because in the city the shop *is* inside the street's
 * block. So a hit test takes the **smallest** rectangle containing the point,
 * which is the one drawn on top, which is the one under the cursor. Click the
 * shop's outline and you are in the shop; click the street around it and you
 * are in the street.
 *
 * The point is then put through `settle`, so a click on a wall lands you
 * beside the wall rather than inside it — the same call the game makes sixty
 * times a second, so a landing from here is always a place the duelist could
 * have walked to.
 */

import { useMemo, useRef } from 'react';
import {
  AREAS,
  PLAYER_RADIUS,
  areaById,
  settle,
  toWorld,
  type AreaId,
} from '@/story/areas';

/** One area's footprint, in the city's own metres. */
interface Place {
  id: AreaId;
  name: string;
  kind: 'interior' | 'exterior';
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** In square metres — what decides who is on top, and who wins a click. */
  size: number;
}

/**
 * Every area as a rectangle in city coordinates.
 *
 * `bounds` is a `Rect` with a centre of its own — Black Crown's is offset from
 * its origin — so the corner is `world + bounds.centre ± half`, not
 * `world ± half`. Computed once at module load: the city does not change
 * between renders, and this is the same arithmetic `toWorld` does.
 */
const PLACES: Place[] = Object.values(AREAS)
  .map((a) => {
    const c = toWorld(a, a.bounds.x, a.bounds.z);
    return {
      id: a.id,
      name: a.name,
      kind: a.kind,
      x0: c.x - a.bounds.hw,
      x1: c.x + a.bounds.hw,
      z0: c.z - a.bounds.hd,
      z1: c.z + a.bounds.hd,
      size: a.bounds.hw * a.bounds.hd * 4,
    };
  })
  /* Biggest first, so the small ones are painted last and are on top. */
  .sort((a, b) => b.size - a.size);

/**
 * Where the ways between areas are.
 *
 * A door's `seam` is the doorway itself, and both sides of one doorway put
 * through `toWorld` land on the same point — that agreement is what holds the
 * city together, so one dot per pair is drawn rather than one per door, and
 * two dots on top of each other would mean the city had come apart.
 */
const SEAMS: { x: number; z: number }[] = (() => {
  const out: { x: number; z: number }[] = [];
  for (const a of Object.values(AREAS)) {
    for (const d of a.doors) {
      const w = toWorld(a, d.seam.x, d.seam.z);
      if (out.some((s) => Math.hypot(s.x - w.x, s.z - w.z) < 0.5)) continue;
      out.push(w);
    }
  }
  return out;
})();

/**
 * Where each name goes.
 *
 * A name at the middle of its own rectangle is right for Central Towers and
 * useless for the Old Ward, where four areas share ninety metres and the shop
 * is *inside* the street: the first drawing of this map had "Grandpa's Shop",
 * "Starting Area", "Step Lane" and "Market Row" printed on top of one another.
 *
 * So a label goes in the middle when the rectangle is big enough to hold it,
 * and otherwise takes the first free spot in a ring around it with a line
 * drawn back to what it names — which is what a plan does. Big areas are
 * placed first and take their centres; the small ones then find the gaps,
 * which is the order that gives the fewest leaders.
 *
 * `CHAR` is the display face's advance at size 1, measured off the rendered
 * names rather than assumed: it only has to be close enough to keep two labels
 * from touching.
 */
const LABEL = 11;
const CHAR = 0.52;

interface Placed extends Place {
  lx: number;
  lz: number;
  /** Drawn outside its rectangle, so it needs a line back to it. */
  lead: boolean;
}

const LABELLED: Placed[] = (() => {
  const taken: { x0: number; x1: number; z0: number; z1: number }[] = [];
  const out: Placed[] = [];
  for (const p of PLACES) {
    const w = p.name.length * CHAR * LABEL;
    const cx = (p.x0 + p.x1) / 2;
    const cz = (p.z0 + p.z1) / 2;
    const fits = p.x1 - p.x0 > w + 8 && p.z1 - p.z0 > LABEL + 8;
    const tries: [number, number][] = fits
      ? [[cx, cz]]
      : [
          [cx, p.z0 - 7],
          [cx, p.z1 + 13],
          [p.x0 - w / 2 - 7, cz],
          [p.x1 + w / 2 + 7, cz],
          [cx, p.z0 - 21],
          [cx, p.z1 + 27],
          [p.x0 - w / 2 - 7, p.z0 - 7],
          [p.x1 + w / 2 + 7, p.z1 + 13],
        ];
    let put: [number, number] = tries[0];
    for (const t of tries) {
      const r = { x0: t[0] - w / 2, x1: t[0] + w / 2, z0: t[1] - LABEL * 0.8, z1: t[1] + LABEL * 0.4 };
      if (taken.some((q) => r.x0 < q.x1 && r.x1 > q.x0 && r.z0 < q.z1 && r.z1 > q.z0)) continue;
      put = t;
      taken.push(r);
      break;
    }
    out.push({ ...p, lx: put[0], lz: put[1], lead: !fits });
  }
  return out;
})();

/**
 * The whole city, with a margin so nothing is drawn against the edge.
 *
 * Sized off the *labels* as well as the rectangles, because a name pushed
 * outside the area it names can sit outside the city, and a map that clips its
 * own legend is worse than one with a wide border.
 */
const EDGE = 24;
const SPAN = LABELLED.flatMap((p) => {
  const w = (p.name.length * CHAR * LABEL) / 2;
  return [
    { x: p.x0, z: p.z0 },
    { x: p.x1, z: p.z1 },
    { x: p.lx - w, z: p.lz - LABEL },
    { x: p.lx + w, z: p.lz + LABEL },
  ];
});
const VIEW = {
  x0: Math.min(...SPAN.map((p) => p.x)) - EDGE,
  x1: Math.max(...SPAN.map((p) => p.x)) + EDGE,
  z0: Math.min(...SPAN.map((p) => p.z)) - EDGE,
  z1: Math.max(...SPAN.map((p) => p.z)) + EDGE,
};
const W = VIEW.x1 - VIEW.x0;
const H = VIEW.z1 - VIEW.z0;

/** A hundred metres, for the scale bar — long enough to be worth reading. */
const BAR = 100;

/** A box in city metres, for keeping names off each other. */
interface Box {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}
const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0));

/** The area names, where `LABELLED` put them — letter-spacing and outline included. */
const AREA_NAMES: Box[] = LABELLED.map((p) => {
  const w = p.name.length * (CHAR * LABEL + 0.6) + 6;
  return { x0: p.lx - w / 2, x1: p.lx + w / 2, z0: p.lz - LABEL / 2 - 2, z1: p.lz + LABEL / 2 + 2 };
});

/** A duelist's name on the map. */
const MARK = 10;

/**
 * Where each duelist's name goes: beside the dot, and if that is taken, on
 * the other side, above or below it, or off one of its corners.
 *
 * The same idea as the area names, for the same reason — the Old Ward is four
 * areas in ninety metres and on a busy afternoon half the tournament is in
 * it, so "right of the dot" alone printed Seraphina across Domino Shrine and
 * Panthesilea into Kaiba. Kaiba and the finalists are placed first, then
 * everybody whose chip is still out there, and the chips already won last —
 * the names that matter least give way, and one with nowhere clear to go is
 * left off: a grey dot is a duelist you have already beaten, and needs no
 * caption printed over somebody else's.
 */
function placeNames(marks: { key: string; x: number; z: number; label: string; rank: number }[], you: { x: number; z: number }) {
  const dots: Box[] = [
    ...marks.map((m) => ({ x0: m.x - 5, x1: m.x + 5, z0: m.z - 5, z1: m.z + 5 })),
    { x0: you.x - 12, x1: you.x + 12, z0: you.z - 12, z1: you.z + 12 },
  ];
  const taken: Box[] = [...AREA_NAMES];
  const out = new Map<string, { x: number; y: number; anchor: 'start' | 'end' | 'middle' } | null>();
  for (const m of [...marks].sort((a, b) => a.rank - b.rank)) {
    const w = m.label.length * CHAR * MARK * 1.1 + 5;
    /* Beside, then above and below, then the four diagonals. */
    const beside = (dz: number, side: 1 | -1) => ({
      x: m.x + side * 7,
      y: m.z + 3.5 + dz,
      anchor: side === 1 ? ('start' as const) : ('end' as const),
      box:
        side === 1
          ? { x0: m.x + 6, x1: m.x + 6 + w, z0: m.z - 5 + dz, z1: m.z + 6 + dz }
          : { x0: m.x - 6 - w, x1: m.x - 6, z0: m.z - 5 + dz, z1: m.z + 6 + dz },
    });
    const stacked = (dz: number) => ({
      x: m.x,
      y: m.z + dz,
      anchor: 'middle' as const,
      box: { x0: m.x - w / 2, x1: m.x + w / 2, z0: m.z + dz - 9, z1: m.z + dz + 2 },
    });
    const tries = [beside(0, 1), beside(0, -1), stacked(-8), stacked(16), beside(-10, 1), beside(-10, -1), beside(10, 1), beside(10, -1)];
    const cost = (b: Box) => [...taken, ...dots].reduce((sum, t) => sum + overlap(b, t), 0);
    const clear = tries.find((t) => cost(t.box) === 0);
    if (!clear && m.rank >= 3) {
      out.set(m.key, null);
      continue;
    }
    const pick = clear ?? tries.reduce((a, b) => (cost(b.box) < cost(a.box) ? b : a));
    taken.push(pick.box);
    out.set(m.key, { x: pick.x, y: pick.y, anchor: pick.anchor });
  }
  return out;
}

/** One duelist on the map, and what the player has to do with them. */
export interface DuelistMark {
  id: string;
  name: string;
  area: AreaId;
  x: number;
  z: number;
  /** The player already holds their star chip. */
  chip: boolean;
  finalist: boolean;
  /** Kaiba, who is not on the board but is where the finals are. */
  host?: boolean;
}

export interface WorldMapProps {
  /** Which area the duelist is in, and where in it. */
  at: { area: AreaId; x: number; z: number };
  /**
   * The tournament's duelists, where they are right now — the duel disk's
   * tracker, which is what Kaiba's broadcast tells you to use. Empty before
   * the tournament, when there is nobody to track.
   */
  duelists?: DuelistMark[];
  /** Go there. Area-local metres, already settled. */
  onGo: (area: AreaId, x: number, z: number) => void;
  onClose: () => void;
}

export default function WorldMap({ at, duelists = [], onGo, onClose }: WorldMapProps) {
  const svg = useRef<SVGSVGElement | null>(null);

  /* Where the duelist is, in city metres. */
  const you = useMemo(() => toWorld(areaById(at.area), at.x, at.z), [at]);

  /* The tournament, in city metres, with its names placed. */
  const marks = useMemo(() => {
    const list = duelists.map((d) => {
      const w = toWorld(areaById(d.area), d.x, d.z);
      /* Kaiba is Kaiba; everybody else goes by their first name. */
      const label = d.host ? d.name.split(' ').slice(-1)[0] : d.name.split(' ')[0];
      return { ...d, key: d.id, x: w.x, z: w.z, label, rank: d.host ? 0 : d.finalist ? 1 : d.chip ? 3 : 2 };
    });
    const names = placeNames(list, you);
    return list.map((m) => ({ ...m, tag: names.get(m.key) ?? null }));
  }, [duelists, you]);

  /**
   * A click, in city metres.
   *
   * Through the SVG's own matrix rather than off `getBoundingClientRect`: the
   * element is laid out to fit whatever space it has, so the scale is not a
   * number this component knows, and `getScreenCTM` is the one that does.
   */
  const pick = (e: React.PointerEvent<SVGSVGElement>) => {
    const el = svg.current;
    const ctm = el?.getScreenCTM();
    if (!el || !ctm) return;
    const p = el.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const { x, y } = p.matrixTransform(ctm.inverse());

    /* Smallest rectangle containing it — the one on top. */
    let hit: Place | null = null;
    for (const q of PLACES) {
      if (x < q.x0 || x > q.x1 || y < q.z0 || y > q.z1) continue;
      if (!hit || q.size < hit.size) hit = q;
    }
    if (!hit) return;

    const area = areaById(hit.id);
    const local = { x: x - area.world.x, z: y - area.world.z };
    const fixed = settle(area, local.x, local.z, PLAYER_RADIUS);
    onGo(hit.id, fixed.x, fixed.z);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-ink/80 p-3 backdrop-blur-[2px]"
      style={{ paddingTop: 'calc(var(--safe-top) + 12px)', paddingBottom: 'calc(var(--safe-bottom) + 12px)' }}
      onClick={onClose}
    >
      <div
        className="panel grain flex h-full w-full max-w-3xl flex-col overflow-hidden rounded"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal
        aria-label="The plan of Domino City"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-stoneline bg-black/25 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.32em] text-brass">The plan</p>
            <h2 className="font-display text-xl leading-none text-brassbright">Domino City</h2>
          </div>
          <div className="hidden text-right text-[10px] uppercase tracking-widest text-ptextdim sm:block">
            {PLACES.length} places · {Math.round(W)} × {Math.round(H)} m
            <br />
            standing in <span className="text-parchment">{areaById(at.area).name}</span>
          </div>
          <button className="btn shrink-0 rounded px-3 py-2 text-[11px]" onClick={onClose}>
            ✕ Close
          </button>
        </div>

        <div className="relative min-h-0 flex-1 bg-[#0a0c11]">
          <svg
            ref={svg}
            viewBox={`${VIEW.x0} ${VIEW.z0} ${W} ${H}`}
            className="h-full w-full cursor-crosshair touch-none"
            onPointerDown={pick}
            role="img"
            aria-label="Plan of Domino City — tap anywhere to go there"
          >
            <defs>
              {/* A hundred-metre grid, so the scale is readable without the bar. */}
              <pattern id="map-grid" width="100" height="100" patternUnits="userSpaceOnUse">
                <path d="M 100 0 L 0 0 0 100" fill="none" stroke="#3a4351" strokeWidth="1" opacity="0.5" />
              </pattern>
              {/* Hatching for the places with a roof over them. */}
              <pattern id="map-roof" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="6" stroke="#4a5364" strokeWidth="1" opacity="0.5" />
              </pattern>
              <filter id="map-glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="4" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <rect x={VIEW.x0} y={VIEW.z0} width={W} height={H} fill="#0a0c11" />
            <rect x={VIEW.x0} y={VIEW.z0} width={W} height={H} fill="url(#map-grid)" />

            {/* Rectangles first, every one of them, then every label — or a
                later area's fill paints over an earlier one's leader line. */}
            {LABELLED.map((p) => (
              <g key={p.id}>
                <rect
                  x={p.x0}
                  y={p.z0}
                  width={p.x1 - p.x0}
                  height={p.z1 - p.z0}
                  fill={p.kind === 'interior' ? '#2a313d' : '#1c222b'}
                  fillOpacity={p.id === at.area ? 1 : 0.85}
                  stroke={p.id === at.area ? '#e6c980' : '#8a723d'}
                  strokeWidth={p.id === at.area ? 3 : 1.6}
                  filter={p.id === at.area ? 'url(#map-glow)' : undefined}
                />
                {p.kind === 'interior' && (
                  <rect x={p.x0} y={p.z0} width={p.x1 - p.x0} height={p.z1 - p.z0} fill="url(#map-roof)" pointerEvents="none" />
                )}
              </g>
            ))}

            {LABELLED.map((p) => {
              const here = p.id === at.area;
              return (
                <g key={p.id} style={{ pointerEvents: 'none' }}>
                  {p.lead && (
                    <line
                      x1={p.lx}
                      y1={p.lz + 2}
                      x2={(p.x0 + p.x1) / 2}
                      y2={(p.z0 + p.z1) / 2}
                      stroke={here ? '#e6c980' : '#8a723d'}
                      strokeWidth={1}
                      opacity={0.65}
                    />
                  )}
                  <text
                    x={p.lx}
                    y={p.lz}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={LABEL}
                    fontFamily="var(--font-display), Georgia, serif"
                    letterSpacing={0.6}
                    fill={here ? '#e8dfc9' : '#a39c8c'}
                    stroke="#0a0c11"
                    strokeWidth={3}
                    paintOrder="stroke"
                  >
                    {p.name}
                  </text>
                </g>
              );
            })}

            {/* The doorways: a brass diamond on every seam. */}
            {SEAMS.map((s, i) => (
              <rect key={i} x={s.x - 3.2} y={s.z - 3.2} width={6.4} height={6.4} transform={`rotate(45 ${s.x} ${s.z})`} fill="#c2a15a" opacity={0.95} />
            ))}

            {/* The tournament: everybody still carrying a chip in brass, the
                ones whose chip is already yours in grey, Kaiba as a diamond
                where the finals are. Each with their name, small, beside it. */}
            {marks.map((d) => {
              const colour = d.host ? '#e8dfc9' : d.chip ? '#6f7784' : '#e6c980';
              return (
                <g key={d.id} style={{ pointerEvents: 'none' }} data-duelist={d.id}>
                  {d.host ? (
                    <rect x={d.x - 4.6} y={d.z - 4.6} width={9.2} height={9.2} transform={`rotate(45 ${d.x} ${d.z})`} fill="#0a0c11" stroke={colour} strokeWidth={2} />
                  ) : (
                    <circle cx={d.x} cy={d.z} r={d.finalist ? 5.2 : 4.2} fill={d.chip ? '#2a313d' : '#8a2f2a'} stroke={colour} strokeWidth={d.finalist ? 2.6 : 1.8} />
                  )}
                  {d.tag && (
                    <text
                      x={d.tag.x}
                      y={d.tag.y}
                      textAnchor={d.tag.anchor}
                      fontSize={MARK}
                      fontFamily="var(--font-display), Georgia, serif"
                      fill={colour}
                      stroke="#0a0c11"
                      strokeWidth={2.5}
                      paintOrder="stroke"
                    >
                      {d.label}
                    </text>
                  )}
                </g>
              );
            })}

            {/* You. Two rings rather than a dot, so it reads on top of a name. */}
            <circle cx={you.x} cy={you.z} r={11} fill="none" stroke="#e6c980" strokeWidth={2.5} opacity={0.75}>
              <animate attributeName="r" values="9;13;9" dur="2.4s" repeatCount="indefinite" />
            </circle>
            <circle cx={you.x} cy={you.z} r={4.5} fill="#e6c980" />

            {/* Scale bar, bottom left. */}
            <g transform={`translate(${VIEW.x0 + 16} ${VIEW.z1 - 20})`}>
              <line x1={0} y1={0} x2={BAR} y2={0} stroke="#8a723d" strokeWidth={2.5} />
              <line x1={0} y1={-5} x2={0} y2={5} stroke="#8a723d" strokeWidth={2.5} />
              <line x1={BAR} y1={-5} x2={BAR} y2={5} stroke="#8a723d" strokeWidth={2.5} />
              <text x={BAR / 2} y={-9} textAnchor="middle" fontSize={12} fill="#8a723d" fontFamily="var(--font-display), Georgia, serif">
                {BAR} m
              </text>
            </g>

            {/* The compass, top right: north is up. */}
            <g transform={`translate(${VIEW.x1 - 28} ${VIEW.z0 + 34})`} opacity={0.9}>
              <circle r={16} fill="#0a0c11" stroke="#8a723d" strokeWidth={1.2} />
              <path d="M0 -13 L4 0 L0 -3 L-4 0 Z" fill="#e6c980" />
              <path d="M0 13 L4 0 L0 3 L-4 0 Z" fill="#4a5364" />
              <text y={-18} textAnchor="middle" fontSize={9} fill="#e6c980" fontFamily="var(--font-display), Georgia, serif">N</text>
            </g>
          </svg>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-stoneline bg-black/25 px-4 py-2 text-[10px] text-ptextdim">
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 border border-[#8a723d] bg-[#1c222b]" />outdoors</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 border border-[#8a723d] bg-[#2a313d]" />under a roof</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rotate-45 bg-[#c2a15a]" />a door</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-[#e6c980]" />you</span>
          </span>
        </div>
      </div>
    </div>
  );
}
