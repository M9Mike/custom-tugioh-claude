/**
 * Station Plaza — the square outside Domino Station's east exit.
 *
 * A hundred and thirty-two metres by a hundred and twenty, and the largest open
 * ground in the city: thirteen thousand eight hundred square metres you can
 * walk, against the burial ground's ten and the station's seven. The ward plan
 * calls it *the city's main junction — five doors off one square*, and four of
 * those five are areas that do not exist yet. What it has to be today is the
 * junction: somewhere big enough that arriving in it feels like arriving in the
 * city, with the ways out written on the walls.
 *
 * ## The first open sky since the burial ground
 *
 * Everything since Market Row has had something over it, and the station has a
 * roof you can see the far end of. This has nothing over it at all — which
 * makes the *light* the subject for the first time in three areas. Four ranges
 * of building throw the square's shadows across it, they move all day, and
 * the whole of the design is arranged so that at four in the afternoon the west
 * range's shadow falls short of the clock and at noon it does not.
 *
 * ## What closes the horizon
 *
 * A hundred and thirty metres of open ground with a fourteen-metre terrace
 * round it is a courtyard, not a square. What makes it a square is the second
 * and third rank standing behind that terrace — taller, set back, and reached
 * by nobody. The burial ground does the same thing with a wood. A city does it
 * with more city.
 *
 * ## The building you just came out of
 *
 * The west range is Domino Station's east elevation, and it is drawn in the
 * station's own brick with the station's own coping. Behind its parapet the
 * first two ridges of the train shed stand up exactly where they stand in
 * `world/station.ts` — the frontage is deliberately ten and a half metres, low
 * enough for them to show, because a station you have just walked ninety metres
 * of should be recognisable from outside.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { asphalt, brick, concrete, darkWood, paving, render, shutter, signBoard, soil, turf } from './surfaces';
import {
  Owned, bakedFrom, basePlate, decal, glow, lit, matt, scaleBoxUVs, seeded, surfaceOf, tiled,
  type BakedPart, type BuiltArea,
} from './kit';
import { Sky, ownSky } from './sky';
import {
  AREAS, DS_EAVES, DS_RIDGE, DS_SPAN, groundAt, PZ_CLOCK, PZ_DOOR, PZ_DOOR_HALF, PZ_FACE, PZ_FLIGHT,
  PZ_CROSS_HALF, PZ_FLIGHT_STEPS, PZ_IN, PZ_ISLAND, PZ_KERB, PZ_RAILS, PZ_ROAD, PZ_TERRACE,
  PZ_THINGS, PZ_WAYS, type PlazaThing, type PlazaWay,
} from '@/story/areas';

const AREA = AREAS['station-plaza'];
/**
 * How high the ground is under a point, which is the only source for it.
 *
 * Four heights in this square and eighty-odd things standing on them: a lamp
 * written at the kerb's height and placed on the carriageway floats fifteen
 * centimetres, and nothing in this world floats. Ask, do not assume — the
 * burial ground's lanterns settled this three areas ago.
 */
const at = (x: number, z: number) => groundAt(AREA, x, z);
/** The outer limit of the building line, both ways. */
const OUT_X = AREA.bounds.hw + 1;   // 66
const OUT_Z = AREA.bounds.hd + 1;   // 60
/** How tall each range stands, and the station's is deliberately the lowest. */
const RANGE = 15.5;
const FRONT = 10.5;

export function buildPlaza(anisotropy: number): BuiltArea {
  const own = new Owned();
  const root = new THREE.Group();
  root.name = 'station-plaza';
  const rnd = seeded(0x912a5a);
  const lights: THREE.PointLight[] = [];
  /* Lamps that do not answer to the clock — a shop that is open is open. */
  const burning: THREE.PointLight[] = [];

  /* ---------------------------------------------------------------- */
  /* what everything is made of                                        */
  /* ---------------------------------------------------------------- */

  const settTex = surfaceOf(own, () => paving({ dirt: 0.14, vary: 0.34 }), 1, 1, anisotropy);
  const flagTex = surfaceOf(own, () => paving({ dirt: 0.08, vary: 0.24 }), 1, 1, anisotropy);
  const roadTex = surfaceOf(own, asphalt, 1, 1, anisotropy);
  /* The same brick and the same plaster the station is built of, because the
     west range *is* the station. */
  const brickTex = surfaceOf(own, () => brick('#7c6a58'), 1, 1, anisotropy);
  const brickTex2 = surfaceOf(own, () => brick('#6f5e51'), 1, 1, anisotropy);
  const renderTex = surfaceOf(own, () => render('#b3a894'), 1, 1, anisotropy);
  const stoneTex = surfaceOf(own, () => concrete('#98928a'), 1, 1, anisotropy);
  const woodTex = surfaceOf(own, darkWood, 1, 2, anisotropy);
  const shutTex = surfaceOf(own, () => shutter('#6d6154'), 1, 1, anisotropy);
  const soilTex = surfaceOf(own, soil, 1, 1, anisotropy);
  const turfTex = surfaceOf(own, turf, 1, 1, anisotropy);

  /*
   * Near white, both of them.
   *
   * A tint multiplies, so it can only ever take a drawing further down — and
   * fourteen thousand square metres of ground at three quarters of the paving
   * drawer's own value is fourteen thousand square metres of brown. The colour
   * that makes a square bright is in the drawing; what the tint is for here is
   * the difference between the setts outside and the flags on the island.
   */
  const setts = tiled(matt(own, '#e8dfc7', settTex), 1.8);
  const flags = tiled(matt(own, '#f2ead4', flagTex), 2.4);
  const road = tiled(matt(own, '#ffffff', roadTex), 4);
  const brickwork = tiled(matt(own, '#ffffff', brickTex), 3);
  const brickDark = tiled(matt(own, '#ffffff', brickTex2), 3);
  const stone = tiled(matt(own, '#ffffff', renderTex), 3);
  const ashlar = tiled(matt(own, '#ffffff', stoneTex), 2.6);
  const timber = matt(own, '#7b6449', woodTex);
  const kerb = matt(own, '#a09a8e');
  const kerbDark = matt(own, '#7e786d');
  const steel = matt(own, '#6b6c63');
  const steelPale = matt(own, '#8a8779');
  const iron = matt(own, '#55554f');
  const brass = matt(own, '#8f7436');
  const dark = matt(own, '#2c2f33');
  const cream = matt(own, '#d5cbb0');
  const glassDim = matt(own, '#4a4f52');
  const leaf = matt(own, '#4d5c3c');
  const leafPale = matt(own, '#5c6c46');
  const bark = matt(own, '#4e4034');
  const earth = tiled(matt(own, '#ffffff', soilTex), 2);
  const grass = tiled(matt(own, '#ffffff', turfTex), 2.4);
  const hoarding = matt(own, '#ffffff', shutTex);
  const busGreen = matt(own, '#3f5a46');
  const busMaroon = matt(own, '#6b3a36');
  /* A cab is dark, not absent: at #26282b a rank of six read as six holes
     cut in the pavement the moment the sun went round the ranges. */
  const taxiBody = matt(own, '#3b4047');
  const feather = matt(own, '#6e6a66');
  const featherPale = matt(own, '#8d8985');
  /*
   * The shops' own names, twelve boards shared across every range.
   *
   * A ground floor of unnamed dark openings is a wall with holes in it —
   * Market Row is legible because every unit is somebody's. One material per
   * name and not one per bay: thirty bays would otherwise be thirty draw
   * calls and thirty canvases for twelve pieces of writing.
   */
  const SHOP_NAMES = [
    'AOKI & SON', 'HANATSUKI', 'THE PAPER MILL', 'KUROSE BOOKS',
    'MARUYAMA', 'ISHIDA TAILORS', 'THE BRASS KETTLE', 'YUKI FLORIST',
    'TOKUDA & CO', 'THE OLD MAP SHOP', 'SAWADA CAMERA', 'NAKANO PHARMACY',
  ];
  const shopSigns = SHOP_NAMES.map((n) => matt(own, '#ffffff',
    surfaceOf(own, () => signBoard(n, '#e6d8b4', '#2e2822', undefined, 3.2 / 0.5), 1, 1, anisotropy)));
  let signAt = 0;

  const paint = decal(own, '#b8ac82');
  const paintDim = decal(own, '#8d8467');
  /* A course of darker stone, not a painted line: the bands round the clock
     are paving, and at the road-marking tone they read as a grid of yellow
     lines across the island. */
  const bandStone = decal(own, '#b5ad9a');
  const lampGlass = glow(own, '#c9954e');
  const windowLight = glow(own, '#9d7f45');
  const shopLight = lit(own, '#a8863f');
  const blind = lit(own, '#b08b3e');

  /* ---------------------------------------------------------------- */
  /* the baker                                                         */
  /* ---------------------------------------------------------------- */

  /**
   * A box, filed by material rather than added.
   *
   * Same contract as the station's: `group` keeps a run of things in a merge of
   * its own wherever its bounding box has to stay honest, and every merge tells
   * the checks what went into it. See `bakedFrom` in `kit.ts` — without it
   * `footing`, `walls`, `embedded` and `coplanar` all take a merged mesh's box
   * for its shape, which for a square this size is a lie the size of the square.
   */
  const piles = new Map<string, { material: THREE.Material; cast: boolean; parts: THREE.BufferGeometry[]; boxes: BakedPart[] }>();
  const put = (
    w: number, h: number, d: number, material: THREE.Material,
    x: number, y: number, z: number,
    o?: { rotY?: number; rotZ?: number; cast?: boolean; group?: string }
  ) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    const metres = material.userData?.tile as number | undefined;
    if (metres) scaleBoxUVs(geo, w, h, d, metres);
    if (o?.rotZ) geo.rotateZ(o.rotZ);
    if (o?.rotY) geo.rotateY(o.rotY);
    geo.translate(x, y, z);
    geo.computeBoundingBox();
    const b = geo.boundingBox!;
    const cast = o?.cast ?? true;
    const key = `${material.uuid}|${cast ? 1 : 0}|${o?.group ?? ''}`;
    const box: BakedPart = [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z,
                            o?.rotZ || o?.rotY ? 1 : 0];
    const at = piles.get(key);
    if (at) { at.parts.push(geo); at.boxes.push(box); }
    else piles.set(key, { material, cast, parts: [geo], boxes: [box] });
  };

  const bake = () => {
    for (const pile of piles.values()) {
      const merged = mergeGeometries(pile.parts, false);
      for (const g of pile.parts) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(own.keep(merged), pile.material);
      mesh.castShadow = pile.cast;
      mesh.receiveShadow = true;
      bakedFrom(mesh, pile.boxes);
      root.add(mesh);
    }
    piles.clear();
  };

  /** A flat run of ground at a height, its texture sized in metres. */
  const slab = (w: number, d: number, x: number, y: number, z: number, material: THREE.Material) => {
    const geo = own.keep(new THREE.PlaneGeometry(w, d));
    const metres = material.userData?.tile as number | undefined;
    if (metres) {
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / metres), uv.getY(i) * (d / metres));
      uv.needsUpdate = true;
    }
    const m = new THREE.Mesh(geo, material);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    m.receiveShadow = true;
    root.add(m);
    return m;
  };

  basePlate(own, root, AREA.bounds, '#26231f');

  /* ---------------------------------------------------------------- */
  /* the ground                                                        */
  /* ---------------------------------------------------------------- */

  /*
   * The carriageway is the floor and everything else stands a kerb over it.
   *
   * Laid as the ring it is — the road between the island and the outer pavement
   * — so that the one surface at zero in this area is the one you are meant to
   * step down on to. The pavements are the four rectangles `areas.ts` spreads
   * into `platforms`, and they meet the road's kerb and nothing else.
   */
  {
    const R = PZ_ROAD;
    const I = PZ_ISLAND;
    slab(R.hw * 2, R.hd - I.hd, 0, 0.002, -(R.hd + I.hd) / 2, road);
    slab(R.hw * 2, R.hd - I.hd, 0, 0.002, (R.hd + I.hd) / 2, road);
    slab(R.hw - I.hw, I.hd * 2, -(R.hw + I.hw) / 2, 0.002, 0, road);
    slab(R.hw - I.hw, I.hd * 2, (R.hw + I.hw) / 2, 0.002, 0, road);
  }

  /*
   * Every raised surface is a *course of stone*, not a plane laid on the road.
   *
   * Which settles the kerb in one stroke. Drawn as a separate 0.4 m course it
   * is either under the pavement — seventeen square metres of one plane down
   * each side of the loop — or standing in the carriageway, where a duelist can
   * put their feet inside it and `npm run footing` counts two thousand cells of
   * exactly that. Drawn as the *edge of the pavement itself* it is neither: one
   * box for the paving, one for the kerb course beside it, tops abutting, and
   * the fifteen centimetres you step up is the fifteen centimetres that is
   * there.
   */
  const K = 0.44;
  const raised = (
    x: number, z: number, hw: number, hd: number, material: THREE.Material,
    sides: { n?: boolean; s?: boolean; e?: boolean; w?: boolean }
  ) => {
    const g = { group: `pave${x.toFixed(0)}:${z.toFixed(0)}` };
    const n = sides.n ? K : 0;
    const so = sides.s ? K : 0;
    const e = sides.e ? K : 0;
    const w = sides.w ? K : 0;
    put((hw - (w + e) / 2) * 2, PZ_KERB, (hd - (n + so) / 2) * 2, material,
        x + (w - e) / 2, PZ_KERB / 2, z + (n - so) / 2, g);
    /* North and south courses run the full width; east and west stop short of
       them, so no two courses share a corner. */
    if (sides.n) put(hw * 2, PZ_KERB, K, kerbDark, x, PZ_KERB / 2, z - hd + K / 2, g);
    if (sides.s) put(hw * 2, PZ_KERB, K, kerbDark, x, PZ_KERB / 2, z + hd - K / 2, g);
    if (sides.w) put(K, PZ_KERB, (hd - (n + so) / 2) * 2, kerbDark, x - hw + K / 2, PZ_KERB / 2, z + (n - so) / 2, g);
    if (sides.e) put(K, PZ_KERB, (hd - (n + so) / 2) * 2, kerbDark, x + hw - K / 2, PZ_KERB / 2, z + (n - so) / 2, g);
  };

  /* Setts on the outer pavements, flags on the island — the island is swept and
     the outer ring is walked on by everybody. Each pavement's one road-facing
     side is the side its kerb is on; the island's are all four. */
  raised(0, -(PZ_IN.z + PZ_ROAD.hd) / 2, PZ_IN.x, (PZ_IN.z - PZ_ROAD.hd) / 2, setts, { s: true });
  raised(0, (PZ_IN.z + PZ_ROAD.hd) / 2, PZ_IN.x, (PZ_IN.z - PZ_ROAD.hd) / 2, setts, { n: true });
  raised(-(PZ_IN.x + PZ_ROAD.hw) / 2, 0, (PZ_IN.x - PZ_ROAD.hw) / 2, PZ_ROAD.hd, setts, { e: true });
  raised((PZ_IN.x + PZ_ROAD.hw) / 2, 0, (PZ_IN.x - PZ_ROAD.hw) / 2, PZ_ROAD.hd, setts, { w: true });
  raised(0, 0, PZ_ISLAND.hw, PZ_ISLAND.hd, flags, { n: true, s: true, e: true, w: true });

  /*
   * The road, painted.
   *
   * A carriageway with nothing on it is a grey rectangle. Lane lines round the
   * loop, a box at every bus stand, a stop line at each mouth and two crossings
   * where anybody actually walks — all of it `decal`, which is the material
   * that declares itself in front of whatever it is painted on.
   */
  {
    const mid = (PZ_ROAD.hw + PZ_ISLAND.hw) / 2;
    const midZ = (PZ_ROAD.hd + PZ_ISLAND.hd) / 2;
    for (const s of [-1, 1] as const) {
      for (let x = -PZ_ROAD.hw + 3; x < PZ_ROAD.hw - 3; x += 5) {
        put(2.6, 0.02, 0.16, paintDim, x, 0.02, s * midZ, { cast: false, group: 'paint' });
      }
      for (let z = -PZ_ISLAND.hd + 3; z < PZ_ISLAND.hd - 3; z += 5) {
        put(0.16, 0.02, 2.6, paintDim, s * mid, 0.02, z, { cast: false, group: 'paint' });
      }
      /* The bus stand boxes, one under each shelter's kerb. */
      for (const t of PZ_THINGS) {
        if (t.kind !== 'bus') continue;
        const long = Math.max(t.hw, t.hd);
        put(t.turn ? 2.9 : long * 2 + 1.4, 0.02, t.turn ? long * 2 + 1.4 : 2.9,
            paintDim, t.x, 0.021, t.z, { cast: false, group: 'paint' });
      }
    }
    /* Two crossings: one on the axis of the station's steps, one on the axis of
       the way south. Bars across, the way a crossing is painted. */
    for (const c of [{ x: -mid, z: PZ_DOOR, along: 'z' as const }, { x: 0, z: midZ, along: 'x' as const }]) {
      /* Exactly as wide as the gap the guard rail leaves for it — see
         `PZ_CROSS_HALF`. A crossing that does not line up with the way through
         is a crossing to a railing. */
      const bars = Math.floor(PZ_CROSS_HALF / 0.55);
      for (let i = -bars; i <= bars; i++) {
        const off = (i / bars) * (PZ_CROSS_HALF - 0.3);
        if (c.along === 'z') put(PZ_ROAD.hw - PZ_ISLAND.hw - 0.6, 0.02, 0.5, paint, c.x, 0.022, c.z + off, { cast: false, group: 'paint' });
        else put(0.5, 0.02, PZ_ROAD.hd - PZ_ISLAND.hd - 0.6, paint, c.x + off, 0.022, c.z, { cast: false, group: 'paint' });
      }
    }
  }

  /* ---- the forecourt terrace and the flight down off it ---- */

  /*
   * The terrace is a course of stone, not a plane laid on one.
   *
   * The station's own terrace learned this twice: two millimetres over a box
   * top is the largest z-fight the area could have, and six centimetres over a
   * shadow *caster* is a plinth shadowing its own roof.
   */
  {
    const f = AREA.platforms!.find((p) => p.y === PZ_TERRACE)!;
    /* Three hundred millimetres into the range at the buried end, so the
       terrace's west face is not the pavement's west face: both were at −62
       and shared six square metres of it. */
    put(f.hw * 2 + 0.3, PZ_TERRACE - 0.12, f.hd * 2, ashlar, f.x - 0.15, (PZ_TERRACE - 0.12) / 2, f.z);
    put(f.hw * 2 + 0.3, 0.12, f.hd * 2, flags, f.x - 0.15, PZ_TERRACE - 0.06, f.z);
    put(f.hw * 2 + 0.24, 0.26, 0.34, kerb, f.x, PZ_TERRACE - 0.14, f.z + f.hd - 0.03);
  }
  /* The treads, read off the very platforms the collision answers with — see
     `PZ_FLIGHT_STEPS` — and drawn as the stepped mass of a stone stair. */
  for (const t of PZ_FLIGHT_STEPS) {
    /* Off the pavement, not through it: the flight stands on the kerbed
       surface it climbs from, so no part of it is buried in that course. */
    put(t.hw * 2, t.y - PZ_KERB, t.hd * 2, ashlar, t.x, (t.y + PZ_KERB) / 2, t.z);
    put(0.05, 0.16, t.hd * 2, kerb, t.x - t.hw + 0.035, t.y - 0.09, t.z);
    /* And the cheeks either side, which are the two solids in `areas.ts`: the
       tread's own depth in x, half a metre across in z. */
    for (const s of [-1, 1] as const) {
      put(t.hw * 2, t.y + 0.9 - PZ_KERB, 0.5, ashlar, t.x, (t.y + 0.9 + PZ_KERB) / 2,
          PZ_FLIGHT.cross + s * (PZ_FLIGHT.half + 0.25));
    }
  }

  /* ---------------------------------------------------------------- */
  /* the four ranges                                                   */
  /* ---------------------------------------------------------------- */

  /**
   * A range of building: the block, its coping, and a run of shopfronts along
   * the ground floor of whichever face looks at the square.
   */
  const range = (
    o: {
      x: number; z: number; hw: number; hd: number; h: number;
      face: 'n' | 's' | 'e' | 'w'; skin: THREE.Material; group: string;
    }
  ) => {
    /*
     * The block, its coping and its string course — and the courses overhang
     * only *across* the range, never along it.
     *
     * A coping that overhangs both ways meets the next range's coping at the
     * corner, and two courses of stone at one height sharing nineteen square
     * metres is a flicker you would see from the middle of the square. Along
     * the range they stop short instead.
     */
    const lengthwise = o.face === 'n' || o.face === 's';
    const ox = lengthwise ? -0.8 : 0.5;
    const oz = lengthwise ? 0.5 : -0.8;
    put(o.hw * 2, o.h, o.hd * 2, o.skin, o.x, o.h / 2, o.z, { group: o.group });
    put(o.hw * 2 + ox, 0.44, o.hd * 2 + oz, kerb, o.x, o.h + 0.22, o.z, { group: o.group });
    /* A string course at first-floor level, which is what stops a fifteen-metre
       wall reading as one slab of brick. */
    put(o.hw * 2 + ox * 0.7, 0.3, o.hd * 2 + oz * 0.7, kerb, o.x, 4.6, o.z, { group: o.group });
    const along = o.face === 'n' || o.face === 's' ? o.hw : o.hd;
    const dz = o.face === 'n' ? -o.hd : o.face === 's' ? o.hd : 0;
    const dx = o.face === 'w' ? -o.hw : o.face === 'e' ? o.hw : 0;
    const across = o.face === 'n' || o.face === 's' ? 0 : 1;
    /*
     * `u` is *out of the wall, into the square* — and everything on the ground
     * floor is measured along it.
     *
     * Subtracted instead of added, a shopfront went the other way: the glass,
     * the reveal and the fascia all stood inside the building, seventy
     * centimetres deep in brick, and the lamp meant to light them burned a
     * metre and a half inside the wall. `npm run embedded` counts this.
     */
    const ux = across ? Math.sign(dx) : 0;
    const uz = across ? 0 : Math.sign(dz);
    const fx = o.x + dx;
    const fz = o.z + dz;
    /*
     * A bay is drawn where the range is actually *seen*: not within a bay and
     * a half of the way out through it, and not past the ranges either end.
     *
     * The east range runs the full depth of the square and the north and south
     * ranges fit between it — so its last bays stand in the middle of their
     * brick, which is where `npm run embedded` found them.
     */
    const edge = (across ? PZ_IN.z : PZ_IN.x) - 0.4;
    const clear = (t: number) => Math.abs((across ? fz + t : fx + t)) <= edge
      && !PZ_WAYS.some((wy) => wy.face === o.face
        && Math.abs((across ? fz + t : fx + t) - (across ? wy.z : wy.x)) < wy.w / 2 + 2.4);
    const bays = Math.max(1, Math.round(along / 4.2));
    const wide = (a: number, b: number) => (across ? b : a);
    const deep = (a: number, b: number) => (across ? a : b);
    /*
     * The shopfront line stands 45 cm proud of the brick above it: pilasters
     * between the bays, one fascia band carried over them all, and the glass
     * set back in the reveal between. It is the frontage you bump into, and
     * `areas.ts` puts the range's face on it and not on the brick.
     */
    for (let i = 0; i <= bays; i++) {
      const t = -along + (along * 2 / bays) * i + (i === 0 ? 0.45 : i === bays ? -0.45 : 0);
      if (!clear(t)) continue;
      put(wide(0.9, 0.45), 3.6 - PZ_KERB, deep(0.9, 0.45), o.skin,
          fx + (across ? ux * 0.225 : t), (3.6 + PZ_KERB) / 2, fz + (across ? t : uz * 0.225), { group: o.group });
    }
    const span = across ? PZ_IN.z - 0.5 : along;
    put(wide(span * 2, 0.45), 0.7, deep(span * 2, 0.45), kerb,
        fx + ux * 0.225, 3.95, fz + uz * 0.225, { group: o.group });
    for (let i = 0; i < bays; i++) {
      const t = -along + (along * 2 / bays) * (i + 0.5);
      if (!clear(t)) continue;
      const px = fx + (across ? 0 : t);
      const pz = fz + (across ? t : 0);
      /* The shopfront: a dark reveal, the glass set back in it, and a stall
         riser under the glass. */
      put(wide(3.4, 0.3), 3.4, deep(3.4, 0.3), dark,
          px + ux * 0.15, 1.9, pz + uz * 0.15, { group: o.group });
      put(wide(3.0, 0.2), 2.4, deep(3.0, 0.2), i % 3 === 0 ? shopLight : glassDim,
          px + ux * 0.16, 1.8, pz + uz * 0.16, { group: o.group });
      /* Glazing bars over the pane — a transom and two mullions. Without them
         an unlit shopfront is a black rectangle and not a window. */
      put(wide(3.0, 0.14), 0.12, deep(3.0, 0.14), iron,
          px + ux * 0.3, 2.35, pz + uz * 0.3, { group: o.group });
      /* The mullions stop under the transom rather than crossing it: run past,
         and each shares that bar's front and back face where they meet. */
      for (const b of [-1, 1] as const) {
        put(wide(0.1, 0.14), 1.69, deep(0.1, 0.14), iron,
            px + ux * 0.3 + (across ? 0 : b * 0.85), 1.445,
            pz + uz * 0.3 + (across ? b * 0.85 : 0), { group: o.group });
      }
      put(wide(3.2, 0.16), 0.5 - PZ_KERB, deep(3.2, 0.16), kerbDark,
          px + ux * 0.32, (0.5 + PZ_KERB) / 2, pz + uz * 0.32, { group: o.group });
      /* And whose shop it is, on the fascia over the ones with their lights on. */
      if (i % 3 === 0) {
        put(wide(3.2, 0.06), 0.5, deep(3.2, 0.06), shopSigns[signAt % shopSigns.length],
            px + ux * 0.47, 3.95, pz + uz * 0.47, { group: `sign${signAt % shopSigns.length}` });
        signAt++;
      }
      /* Windows above, three floors of them. */
      for (let f = 0; f < Math.floor((o.h - 6) / 3.4); f++) {
        const wy = 6.4 + f * 3.4;
        put(wide(1.7, 0.3), 2.0, deep(1.7, 0.3), (i + f) % 4 === 1 ? windowLight : glassDim,
            px + ux * 0.12, wy, pz + uz * 0.12, { group: o.group });
        put(wide(2.1, 0.5), 0.26, deep(2.1, 0.5), kerb,
            px + ux * 0.19, wy + 1.2, pz + uz * 0.19, { group: o.group });
      }
      if (i % 3 !== 0) continue;
      const l = new THREE.PointLight('#ffc186', 40, 11, 2);
      l.position.set(px + ux * 1.6, 2.2, pz + uz * 1.6);
      root.add(l);
      lights.push(l);
      burning.push(l);
    }
  };

  /* North, east and south: the city. West is the station, and it is built
     separately below because it is a different building. */
  range({ x: 0, z: -(OUT_Z + PZ_IN.z) / 2, hw: PZ_IN.x, hd: (OUT_Z - PZ_IN.z) / 2, h: RANGE, face: 's', skin: brickwork, group: 'north' });
  range({ x: 0, z: (OUT_Z + PZ_IN.z) / 2, hw: PZ_IN.x, hd: (OUT_Z - PZ_IN.z) / 2, h: RANGE - 1.6, face: 'n', skin: brickDark, group: 'south' });
  range({ x: (OUT_X + PZ_IN.x) / 2, z: 0, hw: (OUT_X - PZ_IN.x) / 2, hd: OUT_Z, h: RANGE + 2.4, face: 'w', skin: stone, group: 'east' });

  /*
   * The three ways out that are not built yet.
   *
   * Each one is a real opening in a real range with a real reason it is shut:
   * a contractor's hoarding on the way to Central Towers, the library's own
   * gates locked, and a roller shutter with a diversion under the arch to Civic
   * Square. The collision runs straight through all three, because a hoarding
   * *is* the wall — what matters is that a player who walks up to one can read
   * where it goes and why they cannot.
   */
  const wayOut = (o: PlazaWay) => {
    /*
     * `n` is a hole in the *north* range, so everything drawn for it stands
     * south of that wall — into the square. Written the other way round the
     * hoarding, the gates and the shutter were all inside the four metres of
     * building they close, which is a way out with nothing on it.
     */
    const across = o.face === 'w';
    const nx = across ? -1 : 0;
    const nz = o.face === 'n' ? 1 : o.face === 's' ? -1 : 0;
    /*
     * Both take (along the opening, through the wall) — in that order.
     *
     * Written the other way round `deep` read its arguments mirrored, and a
     * hoarding three hundred millimetres thick came out fourteen metres deep:
     * a slab of boarding filling the pavement in front of the way out, which
     * is where `npm run walls` found six hundred cells of duelist inside it.
     */
    const wide = (along: number, thick: number) => (across ? thick : along);
    const deep = (along: number, thick: number) => (across ? along : thick);
    /* The opening's own surround: jambs, a soffit and a keystone. */
    for (const s of [-1, 1] as const) {
      put(wide(0.9, 1.1), 7.6, deep(0.9, 1.1), ashlar,
          o.x + (across ? nx * 0.4 : s * (o.w / 2 + 0.45)),
          3.8,
          o.z + (across ? s * (o.w / 2 + 0.45) : nz * 0.4));
    }
    put(wide(o.w + 2.6, 1.4), 1.2, deep(o.w + 2.6, 1.4), ashlar, o.x + nx * 0.4, 8.2, o.z + nz * 0.4);
    put(wide(o.w + 3.4, 1.8), 0.4, deep(o.w + 3.4, 1.8), kerb, o.x + nx * 0.4, 8.95, o.z + nz * 0.4);

    if (o.kind === 'hoard') {
      /* Boarding, a scaffold lift over it, and a site lamp burning. */
      put(wide(o.w, 0.3), 3.4, deep(o.w, 0.3), hoarding, o.x + nx * 0.55, 1.7, o.z + nz * 0.55);
      for (let i = 0; i < 5; i++) {
        const t = -o.w / 2 + (o.w / 4) * i;
        put(wide(0.16, 0.5), 4.6, deep(0.16, 0.5), timber,
            o.x + (across ? nx * 0.9 : t), 2.3, o.z + (across ? t : nz * 0.9));
      }
      for (const y of [4.4, 6.6]) {
        put(wide(o.w + 1.2, 0.24), 0.16, deep(o.w + 1.2, 0.24), steel, o.x + nx * 0.9, y, o.z + nz * 0.9);
      }
      const l = new THREE.PointLight('#ffbe78', 44, 13, 2);
      l.position.set(o.x + nx * 2.2, 4.0, o.z + nz * 2.2);
      root.add(l);
      lights.push(l);
    } else if (o.kind === 'gates') {
      /* Tall iron gates, shut, with the railings you can see the dark through. */
      /* The gates hang at the front of the reveal and the dark stands at the
         back of it — set at 1.4 the dark was half a metre out into the square,
         in front of the gates and inside a duelist. */
      put(wide(o.w, 0.36), 0.4, deep(o.w, 0.36), kerbDark, o.x + nx * 0.9, 0.2 + PZ_KERB, o.z + nz * 0.9);
      put(wide(o.w, 0.24), 0.14, deep(o.w, 0.24), iron, o.x + nx * 0.9, 5.4 + PZ_KERB, o.z + nz * 0.9);
      for (let i = 0; i <= Math.round(o.w / 0.42); i++) {
        const t = -o.w / 2 + (o.w / Math.round(o.w / 0.42)) * i;
        put(wide(0.09, 0.09), 5.1, deep(0.09, 0.09), iron,
            o.x + (across ? nx * 0.9 : t), 2.85 + PZ_KERB, o.z + (across ? t : nz * 0.9));
      }
      for (const s of [-1, 1] as const) {
        put(wide(0.34, 0.34), 5.8, deep(0.34, 0.34), iron,
            o.x + (across ? nx * 0.9 : s * o.w * 0.24), 3.05 + PZ_KERB, o.z + (across ? s * o.w * 0.24 : nz * 0.9));
      }
      /* Behind them, the dark of a building nobody has opened today. */
      put(wide(o.w + 1, 0.44), 6.4, deep(o.w + 1, 0.44), dark, o.x + nx * 0.25, 3.2, o.z + nz * 0.25);
    } else {
      put(wide(o.w, 0.26), 5.2, deep(o.w, 0.26), matt(own, '#ffffff', shutTex), o.x + nx * 0.5, 2.6 + PZ_KERB, o.z + nz * 0.5);
      put(wide(o.w + 0.5, 0.5), 0.6, deep(o.w + 0.5, 0.5), kerbDark, o.x + nx * 0.55, 5.5 + PZ_KERB, o.z + nz * 0.55);
    }

    /* And the name, which is the whole point of the thing. */
    const tex = surfaceOf(own, () => signBoard(o.name, '#e2d3ae', '#2f2a24', o.sub, 4.4), 1, 1, anisotropy);
    put(wide(o.w * 0.8, 0.12), o.w * 0.8 / 4.4, deep(o.w * 0.8, 0.12), matt(own, '#ffffff', tex),
        o.x + nx * 0.62, 9.9, o.z + nz * 0.62);
    const sl = new THREE.PointLight('#ffbe78', 52, 12, 2);
    sl.position.set(o.x + nx * 2.4, 10.6, o.z + nz * 2.4);
    root.add(sl);
    lights.push(sl);
  };

  for (const o of PZ_WAYS) wayOut(o);

  /* ---------------------------------------------------------------- */
  /* the station's east elevation                                      */
  /* ---------------------------------------------------------------- */

  /*
   * The building you have just walked out of, from outside.
   *
   * Ten and a half metres to the parapet and no more, which is a decision and
   * not a saving: the train shed's first two ridges stand at 14.4 and a taller
   * frontage hides them. Drawn at the height they are in `world/station.ts`,
   * off the same `DS_RIDGE`, `DS_EAVES` and `DS_SPAN` — so if the shed is ever
   * re-pitched this follows it.
   */
  {
    const west = PZ_FACE.west;
    const face = 'stationFront';
    /* The block, in two pieces with the exit between them. */
    for (const s of [-1, 1] as const) {
      const from = s < 0 ? -OUT_Z : PZ_DOOR + PZ_DOOR_HALF;
      const to = s < 0 ? PZ_DOOR - PZ_DOOR_HALF : OUT_Z;
      put(OUT_X - PZ_IN.x, FRONT, to - from, brickwork, -(OUT_X + PZ_IN.x) / 2, FRONT / 2, (from + to) / 2, { group: face });
    }
    /*
     * The wall over the doorway, its arch ring, and the reveals — and no two of
     * their faces in one plane.
     *
     * Cut to the same 2.4 m as the wall they sit in, the ring and both reveals
     * shared that wall's east face down its whole height, and each other's
     * along the jamb. A ring is narrower than the wall it rings and a reveal
     * stands *inside* the opening, which is both the fix and what they are.
     */
    put(OUT_X - PZ_IN.x, FRONT - 6.4, PZ_DOOR_HALF * 2, brickwork, -(OUT_X + PZ_IN.x) / 2, 6.4 + (FRONT - 6.4) / 2, PZ_DOOR, { group: face });
    put(1.6, 0.6, PZ_DOOR_HALF * 2 + 2.0, ashlar, west - 1.0, 6.6, PZ_DOOR);
    for (const s of [-1, 1] as const) {
      put(1.5, 6.3, 0.7, ashlar, west - 1.05, 3.15, PZ_DOOR + s * (PZ_DOOR_HALF - 0.35));
    }
    /* The coping, and a clock-less pediment with the station's name on it. */
    put(OUT_X - PZ_IN.x + 0.6, 0.5, OUT_Z * 2 - 0.8, kerb, -(OUT_X + PZ_IN.x) / 2, FRONT + 0.25, 0, { group: face });
    const nameTex = surfaceOf(own, () => signBoard('DOMINO STATION', '#e2d3ae', '#2f2a24', undefined, 7.5), 1, 1, anisotropy);
    /*
     * Everything on a wall stands *proud* of it.
     *
     * Sized to end exactly at the wall face, a board, a rail, a sill and a
     * hood are not dressings at all — they are a wall with pictures in it,
     * and each one shares that wall's whole east face. Two hundred and ninety
     * pairs of this. A hood projects, a board projects, and the pane sits
     * back inside its architrave.
     */
    put(0.16, 1.9, 14.2, matt(own, '#ffffff', nameTex), west + 0.06, 8.6, PZ_DOOR);
    put(0.4, 0.3, 15, kerb, west + 0.12, 9.7, PZ_DOOR);
    /* Windows down the frontage, and a lamp over the door. */
    /* Four metres in from the block's ends put the first and last window in
       the corner the north and south ranges close — half of it behind their
       shopfront line. Eight, and the frontage's own face carries them all. */
    for (let i = 0; i < 14; i++) {
      const z = -OUT_Z + 8 + i * 8;
      if (Math.abs(z - PZ_DOOR) < 9) continue;
      /* Architrave — head and sill across, jambs *between* them, so no two of
         the four overlap on the axes they share a face plane in. */
      put(0.28, 0.3, 3.2, kerb, west, 7.35, z, { group: face });
      put(0.28, 0.3, 3.2, kerb, west, 3.45, z, { group: face });
      for (const s of [-1, 1] as const) {
        put(0.28, 3.6, 0.3, kerb, west, 5.4, z + s * 1.45, { group: face });
      }
      put(0.24, 3.6, 2.6, glassDim, west - 0.05, 5.4, z, { group: face });
      put(0.6, 0.34, 3.8, kerb, west + 0.12, 7.67, z, { group: face });
    }
    for (const s of [-1, 1] as const) {
      put(0.5, 0.16, 0.5, iron, west + 0.05, 7.5, PZ_DOOR + s * 2.4);
      put(0.4, 0.5, 0.4, lampGlass, west + 0.04, 7.1, PZ_DOOR + s * 2.4);
      const l = new THREE.PointLight('#ffbe78', 60, 15, 2);
      l.position.set(west + 1.2, 7.0, PZ_DOOR + s * 2.4);
      root.add(l);
      lights.push(l);
    }

    /*
     * And the shed behind it.
     *
     * Two ridges and the slope between them, at the heights `world/station.ts`
     * builds them at, standing west of the frontage where nobody can reach
     * them. From the middle of the square the parapet cuts the first at about
     * two and a half metres of ridge, and the second at nothing — which is
     * exactly how much of a train shed you see over a station's front.
     */
    const roofSkin = own.keep(new THREE.MeshStandardMaterial({ color: '#6e6f68', roughness: 0.7, metalness: 0 }));
    const slope = (x0: number, y0: number, x1: number, y1: number, thick: number) => {
      const dx = x1 - x0;
      const dy = y1 - y0;
      put(Math.hypot(dx, dy), thick, OUT_Z * 2 - 4, roofSkin, (x0 + x1) / 2, (y0 + y1) / 2, 0,
          { rotZ: Math.atan2(dy, dx), cast: false, group: `shed${x0}` });
    };
    /* The east slope up to the first ridge, then down to the valley and up
       again — the same 9.6 m half-span the shed is built on. */
    const r1 = west - 9.6;
    const v1 = r1 - DS_SPAN;
    const r2 = v1 - DS_SPAN;
    slope(west - 1.8, DS_EAVES + 0.8, r1, DS_RIDGE, 0.34);
    slope(r1, DS_RIDGE, v1, DS_EAVES, 0.34);
    slope(v1, DS_EAVES, r2, DS_RIDGE, 0.34);
    for (const rx of [r1, r2]) put(1.5, 0.36, OUT_Z * 2 - 4, steel, rx, DS_RIDGE + 0.26, 0, { cast: false });
    put(1.8, 0.4, OUT_Z * 2 - 4, steel, v1, DS_EAVES - 0.1, 0, { cast: false });
  }

  /* ---------------------------------------------------------------- */
  /* the clock pillar                                                  */
  /* ---------------------------------------------------------------- */

  /*
   * The one thing in the square you can see from every corner of it, and the
   * reason the island is worth crossing.
   *
   * Three steps, a plinth with an inscription, a shaft, four faces at eight and
   * a half metres, and a finial. Twelve metres all told — taller than nothing
   * else on the island and shorter than every range, which is what puts it in
   * the middle of the picture from anywhere.
   */
  {
    /* Each step is a block with a stone cap laid on it, and the block stops
       where the cap begins: sized to the full height they share their top with
       their own cap, which is a hundred and forty square metres of it. Each
       one also starts on the cap below rather than at the ground, so no two
       share an underside either. */
    let base = 0;
    for (const c of PZ_CLOCK) {
      put(c.hw * 2, c.y - 0.06 - base, c.hd * 2, ashlar, 0, (c.y - 0.06 + base) / 2, 0, { group: 'clock' });
      /* The cap covers the whole step: inset five centimetres it left a ring of
         block top six centimetres under the height the collision answers, and
         `npm run footing` stood a duelist in the air all the way round. */
      put(c.hw * 2, 0.06, c.hd * 2, kerb, 0, c.y - 0.03, 0, { group: 'clock' });
      base = c.y;
    }
    const top = PZ_CLOCK[PZ_CLOCK.length - 1].y;
    put(2.6, 1.4, 2.6, ashlar, 0, top + 0.7, 0, { group: 'clock' });
    put(2.9, 0.28, 2.9, kerb, 0, top + 1.54, 0, { group: 'clock' });
    put(2.1, 6.1, 2.1, ashlar, 0, top + 4.73, 0, { group: 'clock' });
    put(2.5, 0.34, 2.5, kerb, 0, top + 7.95, 0, { group: 'clock' });
    /* The four faces. */
    const dial = matt(own, '#e0d7c0');
    for (const s of [-1, 1] as const) {
      for (const axis of ['x', 'z'] as const) {
        const dx = axis === 'x' ? s * 1.32 : 0;
        const dz = axis === 'z' ? s * 1.32 : 0;
        put(axis === 'x' ? 0.18 : 2.3, 2.3, axis === 'z' ? 0.18 : 2.3, brass, dx, top + 9.5, dz, { group: 'clock' });
        put(axis === 'x' ? 0.1 : 2.0, 2.0, axis === 'z' ? 0.1 : 2.0, dial, dx * 1.09, top + 9.5, dz * 1.09, { group: 'clock' });
        put(axis === 'x' ? 0.06 : 0.09, 0.72, axis === 'z' ? 0.06 : 0.09, iron, dx * 1.15, top + 9.78, dz * 1.15, { group: 'clock' });
        put(axis === 'x' ? 0.06 : 0.56, 0.08, axis === 'z' ? 0.06 : 0.56, iron,
            dx * 1.15 + (axis === 'z' ? 0.22 : 0), top + 9.5, dz * 1.15 + (axis === 'x' ? 0.22 : 0), { group: 'clock' });
      }
    }
    put(2.6, 0.5, 2.6, kerb, 0, top + 10.9, 0, { group: 'clock' });
    put(1.3, 1.3, 1.3, ashlar, 0, top + 11.75, 0, { group: 'clock' });
    put(0.5, 0.9, 0.5, brass, 0, top + 12.85, 0, { group: 'clock' });
    /* And the inscription round its plinth, which is the only writing in this
       square that is not telling you where a bus goes. */
    const cutTex = surfaceOf(own, () => signBoard('DOMINO', '#8f8579', '#a9a297', 'MCMLIV', 3.2), 1, 1, anisotropy);
    for (const s of [-1, 1] as const) {
      put(2.0, 0.62, 0.08, matt(own, '#ffffff', cutTex), 0, top + 0.72, s * 1.34, { group: 'clock' });
    }
    const l = new THREE.PointLight('#ffbe78', 70, 17, 2);
    l.position.set(0, top + 2.6, 0);
    root.add(l);
    lights.push(l);
  }

  /* ---------------------------------------------------------------- */
  /* what stands about the square                                      */
  /* ---------------------------------------------------------------- */

  /*
   * One list, read here and spread into `solids` in `areas.ts`.
   *
   * Every one of these is a thing you can see and therefore a thing you bump
   * into — which is the rule that stopped sixteen ticket machines at the
   * station being furniture a duelist walks straight through.
   */
  const things: Record<PlazaThing['kind'], (t: PlazaThing) => void> = {
    shelter: (t) => {
      const g = { group: `shel${t.x}:${t.z}` };
      const y = at(t.x, t.z);
      /* Four posts, a glazed back and side, a roof, and a bench under it. */
      for (const sx of [-1, 1] as const) {
        for (const sz of [-1, 1] as const) {
          put(0.16, 2.6, 0.16, steel, t.x + sx * (t.hw - 0.2), y + 1.3, t.z + sz * (t.hd - 0.2), g);
        }
      }
      const backX = t.turn === Math.PI / 2;
      put(backX ? 0.12 : t.hw * 2, 1.9, backX ? t.hd * 2 : 0.12, glassDim,
          t.x + (backX ? t.hw - 0.1 : 0), y + 1.35, t.z + (backX ? 0 : Math.cos(t.turn ?? 0) * -(t.hd - 0.1)), g);
      put(t.hw * 2 + 0.5, 0.22, t.hd * 2 + 0.5, steelPale, t.x, y + 2.72, t.z, g);
      put(t.hw * 2 + 0.2, 0.1, t.hd * 2 + 0.2, steel, t.x, y + 2.58, t.z, g);
      /* The bench, and the light under the canopy. */
      put(backX ? 0.5 : t.hw * 2 - 1.2, 0.1, backX ? t.hd * 2 - 1.2 : 0.5, timber,
          t.x + (backX ? t.hw - 0.5 : 0), y + 0.45, t.z + (backX ? 0 : Math.cos(t.turn ?? 0) * -(t.hd - 0.5)), g);
      put(t.hw * 2 - 0.8, 0.08, 0.34, lampGlass, t.x, y + 2.5, t.z, g);
      /* The stand letter, hung on the end of the roof. */
      if (t.tag) {
        const tex = surfaceOf(own, () => signBoard(t.tag!, '#2f2a24', '#c9bf9e', undefined, 1), 1, 1, anisotropy);
        put(0.7, 0.7, 0.1, matt(own, '#ffffff', tex), t.x + (backX ? 0 : t.hw - 0.4), y + 2.2,
            t.z + (backX ? t.hd - 0.4 : 0) + (backX ? 0 : 0.001));
      }
      const l = new THREE.PointLight('#ffc186', 34, 9, 2);
      l.position.set(t.x, y + 2.3, t.z);
      root.add(l);
      lights.push(l);
    },
    bus: (t) => {
      const g = { group: `bus${t.x}:${t.z}` };
      const long = Math.max(t.hw, t.hd) * 2;
      const across = t.turn === Math.PI / 2;
      const w = (a: number, b: number) => (across ? b : a);
      const d = (a: number, b: number) => (across ? a : b);
      const body = t.tag === 'CIVIC SQUARE' || t.tag === 'KAIBALAND' ? busMaroon : busGreen;
      put(w(long, 2.5), 0.5, d(long, 2.5), iron, t.x, 0.55, t.z, g);
      put(w(long, 2.55), 1.05, d(long, 2.55), body, t.x, 1.28, t.z, g);
      put(w(long, 2.55), 1.35, d(long, 2.55), cream, t.x, 2.48, t.z, g);
      put(w(long, 2.55), 0.34, d(long, 2.55), body, t.x, 3.32, t.z, g);
      put(w(long - 0.4, 2.4), 0.24, d(long - 0.4, 2.4), steelPale, t.x, 3.56, t.z, g);
      /* Wheels, windows and a destination blind. */
      for (const s of [-1, 1] as const) {
        for (const k of [-1, 1] as const) {
          put(w(1.0, 0.34), 1.0, d(1.0, 0.34), dark,
              t.x + (across ? s * 1.28 : k * (long / 2 - 1.6)), 0.5, t.z + (across ? k * (long / 2 - 1.6) : s * 1.28), g);
        }
        for (let i = 0; i < 5; i++) {
          const off = -long / 2 + 1.4 + i * ((long - 2.8) / 4);
          put(w(1.5, 0.1), 1.1, d(1.5, 0.1), glassDim,
              t.x + (across ? s * 1.29 : off), 2.5, t.z + (across ? off : s * 1.29), g);
        }
      }
      if (t.tag) {
        const tex = surfaceOf(own, () => signBoard(t.tag!, '#2b2620', '#b08b3e', undefined, 5), 1, 1, anisotropy);
        const front = across ? { x: 0, z: -(long / 2 + 0.02) } : { x: -(long / 2 + 0.02), z: 0 };
        put(w(0.08, 2.0), 0.4, d(0.08, 2.0), matt(own, '#ffffff', tex), t.x + front.x, 3.0, t.z + front.z, g);
        put(w(0.1, 2.1), 0.12, d(0.1, 2.1), dark, t.x + front.x * 1.02, 3.28, t.z + front.z * 1.02, g);
      }
      /* The windscreen stands proud of the body, as a cab does. Set flush it
         shared the body's whole end face — nearly three square metres of it. */
      put(w(0.12, 2.3), 1.3, d(0.12, 2.3), glassDim,
          t.x + (across ? 0 : -(long / 2 + 0.08)), 2.4, t.z + (across ? -(long / 2 + 0.08) : 0), g);
    },
    taxi: (t) => {
      /*
       * A cab, and not a slab.
       *
       * The first one was two dark boxes with its only glass buried inside the
       * upper one: from the rank you saw seven black cut-outs with wheels. The
       * glazing is on the outside of the cabin where glass goes, the roof is
       * cream because that is what tells you at fifty metres that the row of
       * dark shapes by the kerb is a taxi rank.
       */
      const g = { group: `taxi${t.z}` };
      put(1.85, 0.62, 4.7, taxiBody, t.x, 0.52, t.z, g);
      put(1.72, 0.72, 2.7, taxiBody, t.x, 1.16, t.z - 0.25, g);
      /* Glazing on all four sides of the cabin, each pane proud of it. */
      for (const sx of [-1, 1] as const) {
        put(0.06, 0.5, 2.2, glassDim, t.x + sx * 0.88, 1.24, t.z - 0.25, g);
      }
      put(1.5, 0.5, 0.06, glassDim, t.x, 1.24, t.z - 1.66, g);
      put(1.5, 0.5, 0.06, glassDim, t.x, 1.24, t.z + 1.16, g);
      /* The cream roof, and the light on it. */
      put(1.62, 0.1, 2.6, cream, t.x, 1.57, t.z - 0.25, g);
      put(0.5, 0.18, 0.24, blind, t.x, 1.71, t.z - 0.25, g);
      for (const sx of [-1, 1] as const) {
        for (const sz of [-1, 1] as const) {
          put(0.28, 0.62, 0.62, dark, t.x + sx * 0.86, 0.31, t.z + sz * 1.55, g);
        }
      }
      put(1.7, 0.12, 0.16, matt(own, '#8f8a80'), t.x, 0.9, t.z - 2.34, g);
    },
    tree: (t) => {
      const g = { group: `tree${t.x}:${t.z}` };
      const y = at(t.x, t.z);
      put(1.8, 0.1, 1.8, iron, t.x, y + 0.02, t.z, { ...g, cast: false });
      put(0.42, 4.2, 0.42, bark, t.x, y + 2.1, t.z, g);
      for (const s of [-1, 1] as const) {
        put(0.16, 1.6, 0.16, iron, t.x + s * 0.7, y + 0.8, t.z, g);
      }
      /* The canopy: four slabs, turned, so it is a mass with a ragged top and
         not a ball on a stick. */
      for (let i = 0; i < 4; i++) {
        const sz = 5.4 - i * 1.05;
        put(sz, 1.5, sz, i % 2 ? leaf : leafPale, t.x, y + 4.4 + i * 1.05, t.z, { ...g, rotY: 0.5 + i * 0.7 });
      }
    },
    lamp: (t) => {
      const g = { group: `lamp${t.x}:${t.z}` };
      const y = at(t.x, t.z);
      put(0.6, 0.34, 0.6, kerbDark, t.x, y + 0.17, t.z, g);
      put(0.3, 6.4, 0.3, iron, t.x, y + 3.5, t.z, g);
      put(0.44, 0.34, 0.44, iron, t.x, y + 6.85, t.z, g);
      put(0.9, 0.5, 0.9, iron, t.x, y + 7.2, t.z, g);
      put(0.66, 0.24, 0.66, lampGlass, t.x, y + 6.96, t.z, g);
      const l = new THREE.PointLight('#ffbe78', 230, 27, 2);
      l.position.set(t.x, y + 6.8, t.z);
      root.add(l);
      lights.push(l);
    },
    bench: (t) => {
      const g = { group: `bench${t.x}:${t.z}` };
      const y = at(t.x, t.z);
      put(t.hw * 2, 0.34, t.hd * 2, kerbDark, t.x, y + 0.17, t.z, g);
      for (const s of [-1, 1] as const) {
        put(t.hw * 2 - 0.2, 0.1, 0.5, timber, t.x, y + 0.78, t.z + s * 0.3, g);
      }
      put(t.hw * 2 - 0.2, 0.5, 0.1, timber, t.x, y + 1.1, t.z, g);
    },
    planter: (t) => {
      const g = { group: `plant${t.x}:${t.z}` };
      const y = at(t.x, t.z);
      put(t.hw * 2, 0.7, t.hd * 2, ashlar, t.x, y + 0.35, t.z, g);
      put(t.hw * 2 + 0.14, 0.16, t.hd * 2 + 0.14, kerb, t.x, y + 0.78, t.z, g);
      put(t.hw * 2 - 0.5, 0.12, t.hd * 2 - 0.5, earth, t.x, y + 0.72, t.z, { ...g, cast: false });
      put(t.hw * 2 - 0.9, 0.1, t.hd * 2 - 0.9, grass, t.x, y + 0.8, t.z, { ...g, cast: false });
      for (let i = 0; i < 7; i++) {
        const px = t.x + (rnd() - 0.5) * (t.hw * 2 - 1.1);
        const pz = t.z + (rnd() - 0.5) * (t.hd * 2 - 1.1);
        put(0.7, 0.6, 0.7, rnd() > 0.5 ? leaf : leafPale, px, y + 1.05, pz, { ...g, rotY: rnd() * 2 });
      }
    },
    bin: (t) => {
      const g = { group: `bin${t.x}:${t.z}` };
      const y = at(t.x, t.z);
      put(t.hw * 2, 0.9, t.hd * 2, iron, t.x, y + 0.45, t.z, g);
      put(t.hw * 2 + 0.12, 0.14, t.hd * 2 + 0.12, steelPale, t.x, y + 0.97, t.z, g);
      put(t.hw * 2 - 0.3, 0.1, t.hd * 2 - 0.3, dark, t.x, y + 1.03, t.z, g);
    },
    kiosk: (t) => {
      const g = { group: 'kiosk' };
      const y = at(t.x, t.z);
      put(t.hw * 2, 3.0, t.hd * 2, timber, t.x, y + 1.5, t.z, g);
      put(t.hw * 2 + 0.6, 0.3, t.hd * 2 + 0.6, kerbDark, t.x, y + 3.15, t.z, g);
      /* Open on the square side, with the papers out and a light in the hatch. */
      put(0.16, 1.5, t.hd * 2 - 0.8, shopLight, t.x - t.hw - 0.06, y + 1.7, t.z, g);
      put(1.2, 0.4, t.hd * 2 + 0.4, matt(own, '#5c4632'), t.x - t.hw - 0.4, y + 2.7, t.z, g);
      for (let i = 0; i < 3; i++) {
        put(0.8, 0.3, 1.1, cream, t.x - t.hw + 0.5, y + 0.62, t.z - 1.4 + i * 1.4, g);
      }
      /* And a bill on each of the other three, because a box in the middle of a
         square is seen from every side — the station's kiosk learned this. */
      for (const [dx, dz] of [[1, 0], [0, -1], [0, 1]] as const) {
        put(dx ? 0.1 : t.hw * 2 - 1.0, 1.5, dz ? 0.1 : t.hd * 2 - 1.0, matt(own, '#b6ab8e'),
            t.x + dx * (t.hw + 0.05), y + 1.7, t.z + dz * (t.hd + 0.05), g);
      }
      const l = new THREE.PointLight('#ffc186', 46, 12, 2);
      l.position.set(t.x - t.hw - 1.2, y + 2.2, t.z);
      root.add(l);
      lights.push(l);
      burning.push(l);
    },
    bollardRun: (t) => {
      /* The balustrade along the forecourt terrace: a drop of a metre twenty is
         a fall, and this is what a station puts along one. */
      const g = { group: `rail${t.z}` };
      const y = at(t.x, t.z);
      put(t.hw * 2, 0.34, t.hd * 2, ashlar, t.x, y + 0.17, t.z, g);
      put(t.hw * 2 + 0.1, 0.12, t.hd * 2, brass, t.x, y + 1.0, t.z, g);
      put(t.hw * 2 - 0.2, 0.07, t.hd * 2, brass, t.x, y + 0.66, t.z, g);
      const posts = Math.max(2, Math.round(t.hd / 0.85));
      for (let i = 0; i <= posts; i++) {
        put(0.09, 0.6, 0.09, brass, t.x, y + 0.63, t.z - t.hd + (t.hd * 2 / posts) * i, g);
      }
    },
  };
  for (const t of PZ_THINGS) things[t.kind](t);

  /*
   * The guard rail round the island, and the paint that goes with it.
   *
   * Six runs with the two crossings between them — see `PZ_RAILS`. A rail is
   * what stops a bus island being an expanse you wander off, and it is what
   * makes the painted crossings the way across rather than decoration.
   */
  const standards = new Set<string>();
  for (const r of PZ_RAILS) {
    const g = { group: `rail${r.x}:${r.z}` };
    const along = Math.max(r.hw, r.hd) * 2;
    const across = r.hw < r.hd;
    const w = (a: number, b: number) => (across ? b : a);
    const ry = at(r.x, r.z);
    put(w(along, 0.16), 0.12, w(0.16, along), steel, r.x, ry + 1.02, r.z, g);
    put(w(along, 0.1), 0.08, w(0.1, along), steel, r.x, ry + 0.6, r.z, g);
    for (let i = 0; i <= Math.round(along / 2.2); i++) {
      const t = -along / 2 + (along / Math.round(along / 2.2)) * i;
      const px = r.x + (across ? 0 : t);
      const pz = r.z + (across ? t : 0);
      /* One standard where two runs meet, not two in the same hole: every
         corner had a pair of identical posts sharing all six faces. */
      const key = `${px.toFixed(2)}:${pz.toFixed(2)}`;
      if (standards.has(key)) continue;
      standards.add(key);
      /* And they run past the rail they carry — level with it they shared its
         top face at every one of a hundred and thirty posts. */
      put(0.14, 1.2, 0.14, steelPale, px, ry + 0.6, pz, g);
    }
  }

  /*
   * And the bands in the paving round the clock.
   *
   * Sixty metres by sixty-eight of one flag size is a car park. Three square
   * courses of setts laid round the monument give the island a middle, which is
   * what a square is for — and they are `decal`, so they resolve in front of
   * the flags whatever the depth buffer thinks.
   */
  for (const r of [9.5, 13.5, 17.5]) {
    for (const s of [-1, 1] as const) {
      put(r * 2, 0.02, 0.7, bandStone, 0, at(0, s * r) + 0.02, s * r, { cast: false, group: 'bands' });
      put(0.7, 0.02, r * 2 - 1.4, bandStone, s * r, at(s * r, 0) + 0.02, 0, { cast: false, group: 'bands' });
    }
  }

  /* ---- the pigeons ---- */

  /*
   * Forty-odd of them, on the island, the clock's steps and the shelter roofs.
   *
   * Not solids, and that is deliberate rather than lazy: a pigeon is twenty
   * centimetres tall, `npm run walls` asks its questions at hip height, and the
   * honest thing for a bird you cannot make fly away is that you walk through
   * it. Baked into one geometry, they cost one draw call.
   */
  {
    const bird = (x: number, y: number, z: number, turn: number, mat: THREE.Material) => {
      const g = { rotY: turn, group: `bird${x.toFixed(2)}:${z.toFixed(2)}` };
      put(0.13, 0.15, 0.26, mat, x, y + 0.1, z, g);
      put(0.09, 0.11, 0.1, mat, x - Math.sin(turn) * 0.15, y + 0.22, z - Math.cos(turn) * 0.15, g);
      put(0.1, 0.04, 0.16, mat, x + Math.sin(turn) * 0.19, y + 0.12, z + Math.cos(turn) * 0.19, g);
    };
    for (let i = 0; i < 44; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 7 + rnd() * 15;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r * 0.8;
      bird(x, at(x, z), z, rnd() * 6.28, rnd() > 0.35 ? feather : featherPale);
    }
    const shelters = PZ_THINGS.filter((q) => q.kind === 'shelter');
    for (let i = 0; i < 7; i++) {
      const t = shelters[i % shelters.length];
      if (!t) continue;
      bird(t.x + (rnd() - 0.5) * t.hw, at(t.x, t.z) + 2.83, t.z + (rnd() - 0.5) * t.hd,
           rnd() * 6.28, rnd() > 0.5 ? feather : featherPale);
    }
  }

  /* ---------------------------------------------------------------- */
  /* what is beyond                                                    */
  /* ---------------------------------------------------------------- */

  /*
   * The city behind the ranges.
   *
   * A hundred and thirty metres of open ground with a fifteen-metre terrace
   * round it and nothing behind it is a courtyard: the terrace reads as a
   * hoarding with sky over it. So there is a second and a third rank — blocks
   * from eighteen to thirty-four metres, set back between six and thirty, on a
   * grid loose enough that no two line up. Nobody can reach any of it and it is
   * one draw call.
   *
   * It is also the only thing in this area that says which way the rest of the
   * city is: the tallest of them stand north and east, which is where North
   * Domino and the Civic ward are on the plan.
   */
  {
    /* Pale enough to be a city and not a shadow: at #5d5750 a vertical face
       took less than half the light the ground did under a noon sun, and three
       ranks of them read as one black band under a blue sky. */
    const city = matt(own, '#837d72');
    /* Each block goes into the ground its own depth: buried the same metre,
       a hundred and eight of them shared one underside at y = −1. */
    const piece = (w: number, h: number, d: number, x: number, z: number) => {
      const sink = 1 + rnd() * 3;
      put(w, h + sink, d, city, x, (h + sink) / 2 - sink, z,
          { cast: false, group: `city${x.toFixed(0)}:${z.toFixed(0)}` });
    };
    const lay = (side: 'n' | 's' | 'e' | 'w', rank: number) => {
      const back = 12 + rank * 22;
      const tall = side === 'n' ? 1.35 : side === 'e' ? 1.2 : 0.92;
      for (let i = 0; i < 9; i++) {
        const t = (i / 8 - 0.5) * 2;
        const jitter = (rnd() - 0.5) * 14;
        const w = 14 + rnd() * 18;
        const h = (17 + rnd() * 13 + rank * 5) * tall;
        if (side === 'n') piece(w, h, 12 + rnd() * 12, t * (OUT_X + 12) + jitter, -OUT_Z - back);
        if (side === 's') piece(w, h, 12 + rnd() * 12, t * (OUT_X + 12) + jitter, OUT_Z + back);
        if (side === 'e') piece(12 + rnd() * 12, h, w, OUT_X + back, t * (OUT_Z + 12) + jitter);
        if (side === 'w') piece(12 + rnd() * 12, h, w, -OUT_X - back, t * (OUT_Z + 12) + jitter);
      }
    };
    for (const side of ['n', 's', 'e', 'w'] as const) for (let r = 0; r < 3; r++) lay(side, r);
  }

  /*
   * And Domino Station's concourse, west of the doorway.
   *
   * A closed box: a back, two returns and a lid, sized so no sight line through
   * a six-metre doorway from four metres back can reach an edge of it. What
   * stands in it is the two metres of the place beyond that stop a doorway
   * being a hole — the hall's own floor running on, the barrier line's screen,
   * and the warm light of a building with its lamps on.
   */
  {
    const west = PZ_FACE.west - 4;
    const skin = tiled(matt(own, '#ffffff', renderTex), 3);
    /*
     * The concourse floor stands level with the forecourt you are standing on
     * — the terrace's own height — and reaches the wall.
     *
     * Laid at nought it was a metre and a quarter *below* the forecourt with
     * three and a half metres of nothing between the two, which through a six
     * metre doorway is a pit with the void at the bottom of it. What the door
     * does with the difference between two areas' floors is the door's business;
     * what you can see through it has to be one floor.
     */
    const inY = PZ_TERRACE;
    put(2.6, 13, 15, skin, west - 9.4, inY + 5.5, PZ_DOOR);
    /* The returns are taller than the back at both ends, so the three walls of
       the box share neither a top nor an underside. */
    for (const s of [-1, 1] as const) put(9, 13.8, 2.6, skin, west - 4.5, inY + 5.6, PZ_DOOR + s * 7.4);
    put(10.4, 1.4, 16, matt(own, '#2c2f33'), west - 4.6, inY + 7.0, PZ_DOOR);
    slab(12.9, 13, west - 2.75, inY + 0.02, PZ_DOOR, flags);
    /* The gate line's screen, seen down the hall. */
    put(0.7, 2.6, 12.4, stone, west - 8.4, inY + 1.3, PZ_DOOR);
    put(0.9, 0.2, 12.8, kerb, west - 8.4, inY + 2.7, PZ_DOOR);
    /* Two pendants and not one: a single lamp four metres in lit the floor of
       the concourse and left everything above it the flat grey of an unlit
       wall, which through a doorway is a hole with a lit sill. */
    for (const k of [3.6, 7.0]) {
      put(0.9, 0.24, 0.9, iron, west - k, inY + 4.4, PZ_DOOR);
      put(0.8, 0.1, 0.8, lampGlass, west - k, inY + 4.24, PZ_DOOR);
      const l = new THREE.PointLight('#ffbe78', 210, 26, 2);
      l.position.set(west - k, inY + 4.0, PZ_DOOR);
      root.add(l);
      lights.push(l);
      burning.push(l);
    }
  }

  bake();

  /* ---------------------------------------------------------------- */
  /* light                                                             */
  /* ---------------------------------------------------------------- */

  /*
   * Open sky, and the first area in three with nothing over it.
   *
   * So no `gain` and no `fill`: this takes the whole of what `skyAt` gives,
   * which is what an open square outdoors is. The shadow camera has to cover
   * the square *and* the ranges round it — a hundred and sixty-four metres —
   * because the shadows those ranges throw across the ground all afternoon are
   * the largest thing in the picture, and a shadow camera that stops at the
   * building line draws them as flat cut-outs.
   */
  const sky = ownSky(own, new Sky(own, root, {
    reach: 118,
    half: 84,
    deep: 78,
    target: [0, 1.5, 0],
    /* One texel of a 2048 map over 168 m of camera. See `market.ts`. */
    normalBias: 0.082,
  }));

  for (const l of burning) sky.burning(l);
  sky.claim();

  return {
    root,
    setTime: (hour) => { sky.apply(hour); },
    dispose() {
      for (const item of own.items) item.dispose();
      for (const lamp of lights) lamp.shadow?.map?.dispose();
    },
  };
}
