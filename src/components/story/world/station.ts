/**
 * Domino Station — the terminus at the east end of the arcade.
 *
 * Ninety-six metres square: a concourse across the south end, a barrier line,
 * and five platforms under a five-span train shed with two trains standing in
 * it. The ward plan asks this area for one thing nothing before it has needed —
 * *vast, roofed and outdoors at once* — and everything here is an answer to
 * some part of that.
 *
 * ## The roof is the area
 *
 * A shed is not a lid on a street; it is the thing you have come to look at. So
 * it is built the way the real ones are: a ridge down the centre of every
 * platform, a valley over every road, and the load coming down one row of
 * columns per platform with the eaves cantilevered out over the tracks. Five
 * spans, four valleys, and the same roof carries straight on over the hall —
 * because a flat ceiling running into the side of a pitched roof is a gable,
 * and a gable made of axis-aligned boxes is a staircase.
 *
 * The glazing is what makes it a *building* rather than a ceiling. A band of
 * roof light runs down both sides of every ridge and **does not cast a
 * shadow** — which is not an oversight, it is the whole effect: the one
 * directional light in this area passes straight through those bands and lays
 * ten strips of moving daylight down the platforms, and the opaque sheet
 * between them puts everything else in shade. Market Row turns its canopy's
 * shadow off for the opposite reason (there is nothing above it to come
 * through); here there is, and the difference between the lit strips and the
 * shade is most of the picture at four in the afternoon.
 *
 * Everything under that sheet is painted *light* — the steel, the columns, the
 * barriers, the soffit. They are in its shade all day, and the first pass drew
 * them at the greys instinct suggests, which came out as black bands across a
 * lit floor.
 *
 * ## The trench nobody can reach
 *
 * A road is 1.05 m below the platform beside it, drawn with ballast, sleepers
 * and rail — and there is no way into it. Every platform edge carries the
 * closed barrier that `areas.ts` describes, the head of every road is a
 * masonry stop block, and the north end is the screen. Which means the ballast
 * is there to be *seen* and never stood on, and that is the only reason the
 * two empty roads exist: a shed with a train in every road is a shed with no
 * railway in it.
 *
 * ## Why almost everything here is baked
 *
 * Nine hundred metres of platform barrier, eighty light fittings, a hundred and
 * ten stair treads and two trains came to thirteen hundred draw calls before a
 * wall was built — twice Market Row, in the area that also has to hold the
 * largest floor in the city. Nothing in here moves, which is exactly the
 * condition that makes merging free, so `put` files every box by material and
 * `bake` hands the scene one mesh per material. The cemetery's eight hundred
 * stones learned this first.
 *
 * ## Nothing here is a second copy of a number
 *
 * Every line this file draws on comes out of `areas.ts` — the platform and road
 * centres, the gate pitch, the terrace, the flights, the buffer stops, and
 * every bench and bin in `DS_THINGS`. The collision and the picture are the
 * same numbers read twice, which is the rule this world has had since the tree
 * drawn at a quarter of its solid.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ballast, brick, concrete, darkWood, paving, render, shutter, signBoard } from './surfaces';
import {
  Owned, bakedFrom, basePlate, decal, glow, lit, matt, scaleBoxUVs, surfaceOf, tiled,
  type BakedPart, type BuiltArea,
} from './kit';
import { Sky, ownSky } from './sky';
import {
  AREAS, DS_ARCH, DS_ARCH_AT, DS_ARCH_COLUMNS, DS_BARRIER, DS_BUFF, DS_COLUMNS, DS_CROSS,
  DS_EAVES, DS_FLIGHT_HALF, DS_GATE, DS_GATES, DS_GATE_HALF, DS_HALL_COLUMNS, DS_HALL_ROWS,
  DS_NORTH, DS_PLAT, DS_PLATFORMS, DS_RANGE, DS_RIDGE, DS_ROAD, DS_ROADS, DS_SOUTH, DS_SPAN,
  DS_FRONT, DS_TERRACE, DS_THINGS, DS_TRACK, DS_TRAIN_TAIL, DS_WALL, type StationThing,
} from '@/story/areas';

const AREA = AREAS['domino-station'];
/** The outer limit of the building: where the walls' outer faces are. */
const OUT = AREA.bounds.hw + 1;   // 48
/** The inner face of the east and west walls. */
const W = OUT - 1.8;              // 46.2
/**
 * The roof covers everything, walls included, and overhangs them by a metre
 * and a half.
 *
 * Flush with the walls' outer faces — which is where it started — every
 * longitudinal member of it ends in the same plane as the wall it meets, and
 * `npm run coplanar` counted four hundred pairs of purlin, gutter, ridge and
 * fascia sharing that plane with the brickwork. A roof overhangs anyway.
 */
const ROOF_N = DS_NORTH - 3.4;
const ROOF_S = DS_SOUTH + 3.4;
const ROOF_LEN = ROOF_S - ROOF_N;
const ROOF_MID = (ROOF_S + ROOF_N) / 2;
/** Half a road, which is where every platform edge in the place is. */
const RH = DS_ROAD / 2;

/**
 * How high the roof is over a point, which is the only source for it.
 *
 * A ridge over every platform centre, a valley half a span either side, and
 * straight between them. The hall is under the same roof as the platforms, so
 * this answers for the whole building — which is why the columns in the hall
 * come in two heights and the ones on the platforms in only one.
 */
function roofY(x: number): number {
  let best = DS_EAVES;
  for (const px of DS_PLATFORMS) {
    const d = Math.abs(x - px);
    if (d >= DS_SPAN) continue;
    best = Math.max(best, DS_RIDGE - (DS_RIDGE - DS_EAVES) * (d / DS_SPAN));
  }
  return best;
}

export function buildStation(anisotropy: number): BuiltArea {
  const own = new Owned();
  const root = new THREE.Group();
  root.name = 'domino-station';
  const lights: THREE.PointLight[] = [];
  /*
   * The lamps that never go out.
   *
   * Everything under this roof is in its shade at every hour, and a station
   * does not turn the gallery brackets or the ticket office off at noon
   * because the sun is up outside. See `Sky.burning`.
   */
  const burning: THREE.PointLight[] = [];

  /* ---------------------------------------------------------------- */
  /* what everything is made of                                        */
  /* ---------------------------------------------------------------- */

  const floorTex = surfaceOf(own, () => paving({ dirt: 0.16, vary: 0.3 }), 1, 1, anisotropy);
  const deckTex = surfaceOf(own, () => concrete('#9a9484'), 1, 1, anisotropy);
  const brickTex = surfaceOf(own, () => brick('#7c6a58'), 1, 1, anisotropy);
  const renderTex = surfaceOf(own, () => render('#b3a894'), 1, 1, anisotropy);
  const ballastTex = surfaceOf(own, ballast, 1, 1, anisotropy);
  const woodTex = surfaceOf(own, darkWood, 1, 2, anisotropy);
  const shutTex = surfaceOf(own, () => shutter('#6d6154'), 1, 1, anisotropy);

  /* White over the tinted drawings, because the colour is already in them: a
     tint on top of a drawn texture only takes light away. */
  const stone = tiled(matt(own, '#ffffff', renderTex), 3);
  const brickwork = tiled(matt(own, '#ffffff', brickTex), 3);
  const deck = tiled(matt(own, '#cfc7b6', deckTex), 3);
  /* Not white: the hall's stone under a cool sky came out mauve, and a
     station floor is a warm grey granite. The drawing carries the pattern; this
     carries the colour of the stone it is. */
  const flags = tiled(matt(own, '#dcd1b9', floorTex), 2.4);
    const bed = tiled(matt(own, '#ffffff', ballastTex), 2.2);
  const timber = matt(own, '#7b6449', woodTex);
  /*
   * Painted steel, and far paler than instinct says.
   *
   * Every piece of it is *under* the sheet, which is to say in its shade all
   * day. A dark grey up there comes out black, and the first pass drew the
   * whole structure as a set of black bands across a lit floor. A shed's
   * ironwork is painted light for exactly this reason.
   */
  const steel = matt(own, '#6b6c63');
  const steelPale = matt(own, '#8a8779');
  /* The columns get a shade of their own, and it is the palest thing in the
     structure: they are the nearest thing to the eye on every platform, and at
     the roof's grey they read as black slabs a metre in front of you. */
  const column = matt(own, '#9c9789');
  const brass = matt(own, '#8f7436');
  const kerb = matt(own, '#8b857a');
  const iron = matt(own, '#55554f');
  const dark = matt(own, '#2c2f33');
  const cream = matt(own, '#d5cbb0');
  const cladding = matt(own, '#9d9a8d');
  const frosted = matt(own, '#b9b19c');
  const roadTop = matt(own, '#4a4640');
  const sand = matt(own, '#6f6553');
  const rails = matt(own, '#6b5a4a');
  /* The running face of a rail in use is polished bright, and it is the one
     thing in a trench that catches what light gets down there. */
  const railHead = matt(own, '#b5b0a6');
  const bogie = matt(own, '#2a2724');
  const retaining = matt(own, '#5b544b');
  const soffitDark = matt(own, '#38342f');
  const dial = matt(own, '#e0d7c0');
  const boardGround = matt(own, '#241f1a');
  const canopy = matt(own, '#5c4632');
  /* A pasted bill: pale, because a dark panel in a lit frame is a hole. */
  const bill = matt(own, '#b6ab8e');
  const spout = matt(own, '#5d6f6d');
  const stopRed = matt(own, '#8d3a33');
  const signalRed = glow(own, '#7d3a33');
  const lamplight = glow(own, '#c9954e');
  const battenLight = glow(own, '#c08c48');
  const signLight = glow(own, '#a8863f');
  /* The board and the gate arrows are on all day — see `lit`. */
  const boardLight = lit(own, '#b08b3e');
  const windowLight = glow(own, '#93763f');
  const trainWindow = glow(own, '#8a7440');
  const trainDoorGlass = glow(own, '#7d6a3c');
  const paint = decal(own, '#9a8340');
  const doormat = decal(own, '#4a4239');
  const livery: Record<string, THREE.Material> = {
    green: matt(own, '#3d5a44'),
    maroon: matt(own, '#6b3a36'),
  };

  /* ---------------------------------------------------------------- */
  /* the baker                                                         */
  /* ---------------------------------------------------------------- */

  /**
   * A box, filed rather than added.
   *
   * `group` keeps a run of things in a merge of its own where its *bounding
   * box* has to stay honest. `npm run walls` reads a mesh as the box it was
   * built as, so one merge holding every barrier in the shed would claim to
   * cover the roads between them; one merge per barrier run is a thin box
   * lying exactly along that barrier, which is the truth.
   */
  const piles = new Map<string, {
    material: THREE.Material; cast: boolean;
    parts: THREE.BufferGeometry[]; boxes: BakedPart[];
  }>();
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
      /* And the note that says what went into it — see `bakedFrom`. Without it
         every box-reading check takes this mesh's bounding box for its shape,
         which for a merge is a lie the size of the building. */
      bakedFrom(mesh, pile.boxes);
      root.add(mesh);
    }
    piles.clear();
  };

  /**
   * A flat run of ground at a height, its texture sized in metres.
   *
   * The same helper the cemetery needs and for the same reason: a plane's UVs
   * run 0 to 1 whatever it measures, so one repeat shared between a 92 m
   * concourse and a 3.6 m road draws two entirely different sizes of stone.
   */
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

  /* Below the roads, not under the platforms: see `basePlate`. */
  basePlate(own, root, AREA.bounds, '#211f1c', DS_TRACK - 0.3);

  /* ---------------------------------------------------------------- */
  /* the ground                                                        */
  /* ---------------------------------------------------------------- */

  /* The concourse and the cross passage: one floor, ninety-two metres across,
     from the frontage wall to the head of the roads. Two pieces because the
     barrier line stands between them; the same stone, at the same height, so a
     duelist crossing the gate line does not step. */
  slab(W * 2, DS_SOUTH - DS_GATE, 0, 0.002, (DS_SOUTH + DS_GATE) / 2, flags);
  slab(W * 2, DS_GATE - DS_CROSS, 0, 0.002, (DS_GATE + DS_CROSS) / 2, flags);

  /* Every platform, from the cross passage to the screen. */
  for (const px of DS_PLATFORMS) {
    slab(DS_PLAT, DS_CROSS - DS_NORTH, px, 0.002, (DS_CROSS + DS_NORTH) / 2, deck);
  }

  /*
   * The trench under every road: ballast to the screen, a stone side wall under
   * each platform edge, and a stop block at the head of it you can see from the
   * cross passage — drawn exactly where the collision ends.
   */
  for (const r of DS_ROADS) {
    slab(DS_ROAD, DS_BUFF - DS_NORTH, r.x, DS_TRACK, (DS_BUFF + DS_NORTH) / 2, bed);
    for (const s of [-1, 1] as const) {
      put(0.34, 1.05, DS_BUFF - DS_NORTH, kerb, r.x + s * (RH - 0.17), DS_TRACK + 0.525, (DS_BUFF + DS_NORTH) / 2);
    }
    put(DS_ROAD, 2.15, 0.6, kerb, r.x, DS_TRACK + 1.075, DS_CROSS - 0.3);
    put(DS_ROAD + 0.3, 0.26, 0.9, kerb, r.x, DS_TRACK + 2.25, DS_CROSS - 0.3);
    for (const s of [-1, 1] as const) {
      put(0.34, 0.62, 0.85, iron, r.x + s * 0.72, DS_TRACK + 0.95, DS_CROSS - 0.95);
      put(0.5, 0.5, 0.18, stopRed, r.x + s * 0.72, DS_TRACK + 0.95, DS_CROSS - 1.45);
    }
    /* Sand, heaped against it, which is what actually stops a train. */
    put(DS_ROAD - 0.5, 0.34, 2.4, sand, r.x, DS_TRACK + 0.17, DS_CROSS - 2.6);
  }

  /* Rail and sleeper, each road in a merge of its own so its bounding box
     stays a road and not the whole shed. */
  for (const r of DS_ROADS) {
    const group = `rail${r.x}`;
    for (let z = DS_BUFF - 0.4; z > DS_NORTH - 13; z -= 0.66) {
      put(2.55, 0.16, 0.24, rails, r.x, DS_TRACK + 0.08, z, { cast: false, group });
    }
    for (const s of [-1, 1] as const) {
      put(0.09, 0.15, DS_BUFF - (DS_NORTH - 13), rails, r.x + s * 0.7175, DS_TRACK + 0.23,
          (DS_BUFF + DS_NORTH - 13) / 2, { cast: false, group });
      put(0.06, 0.04, DS_BUFF - (DS_NORTH - 13) - 0.2, railHead, r.x + s * 0.7175, DS_TRACK + 0.32,
          (DS_BUFF + DS_NORTH - 13) / 2, { cast: false, group });
    }
  }

  /* ---------------------------------------------------------------- */
  /* the box it is all in                                              */
  /* ---------------------------------------------------------------- */

  /**
   * A wall. The coping is *not* part of it.
   *
   * Four walls each with their own coping overlap at the four corners, and two
   * courses of stone at one height sharing four square metres is a flicker you
   * would see from anywhere in the hall. So the coping is laid afterwards as a
   * ring whose four pieces abut.
   */
  const wall = (along: 'x' | 'z', from: number, to: number, cross: number, h: number) => {
    const run = Math.abs(to - from);
    const mid = (from + to) / 2;
    if (along === 'x') put(run, h + 2, 1.8, brickwork, mid, (h + 2) / 2 - 2, cross);
    else put(1.8, h + 2, run, brickwork, cross, (h + 2) / 2 - 2, mid);
  };

  /*
   * The frontage, the two sides, and the gap in the west one for the arcade.
   *
   * All four go to 14.6, which is over the highest ridge — so wherever the
   * roof's zigzag meets a wall, the wall is the taller of the two and there is
   * no slot between them. Below the valleys it stands four metres proud of the
   * gutter, which is what a gable is.
   */
  /* Between the side walls, not across their ends: run the full width and the
     four corners interpenetrate, and two walls sharing a corner share four
     planes with sixty square metres in them. */
  wall('x', -W, W, DS_SOUTH + 0.9, DS_WALL);
  wall('z', -OUT, 41.5, -OUT + 0.9, DS_WALL);
  wall('z', 45.5, DS_SOUTH + 1.8, -OUT + 0.9, DS_WALL);
  wall('z', -OUT, DS_SOUTH + 1.8, OUT - 0.9, DS_WALL);
  /* The coping, as a ring: north and south the full width, east and west
     between them. */
  {
    const y = DS_WALL + 0.17;
    /* The side pieces stop exactly where the end pieces begin. */
    const along = (DS_SOUTH + 0.9 - 1.05) * 2;
    put(OUT * 2 + 0.24, 0.34, 2.1, kerb, 0, y, DS_SOUTH + 0.9);
    put(OUT * 2 + 0.24, 0.34, 2.1, kerb, 0, y, DS_NORTH - 0.9);
    for (const s of [-1, 1] as const) put(2.1, 0.34, along, kerb, s * (OUT - 0.9), y, 0);
  }

  /* Tall windows down the frontage, well under the roof: frosted, mullioned and
     opaque, because what is on the other side of them is the void. */
  for (let i = 0; i < 11; i++) {
    const x = -42 + i * 8.4;
    put(3.4, 3.2, 0.3, frosted, x, 7.0, DS_SOUTH - 0.12);
    for (let k = 0; k < 3; k++) put(0.16, 3.3, 0.16, kerb, x - 1.1 + k * 1.1, 7.0, DS_SOUTH - 0.26);
    put(3.9, 0.34, 0.5, kerb, x, 8.85, DS_SOUTH - 0.2);
    put(3.9, 0.3, 0.5, kerb, x, 5.3, DS_SOUTH - 0.2);
  }

  /*
   * The arcade's gateway, in the west wall: a brick arch with its own jambs and
   * a lamp over it, and a reveal deep enough that you walk *through* something
   * rather than past a hole.
   */
  {
    const gx = -OUT + 0.9;
    put(1.9, 1.1, 4.6, stone, gx, 4.55, 43.5);
    for (const s of [-1, 1] as const) put(2.1, 4.2, 0.36, stone, gx, 2.1, 43.5 + s * 2.24);
    put(2.2, 0.34, 5.1, kerb, gx, 5.27, 43.5);
    put(0.34, 0.5, 0.34, lamplight, gx + 1.1, 3.5, 43.5);
    put(0.5, 0.14, 0.5, iron, gx + 1.1, 3.82, 43.5);
    const l = new THREE.PointLight('#ffbe78', 44, 15, 2);
    l.position.set(gx + 1.4, 3.5, 43.5);
    root.add(l);
    lights.push(l);
  }

  /*
   * The north screen, with a portal over every road.
   *
   * Built as the wall it is and then opened four times, rather than as four
   * arches with wall between them: the runs come off the road centres, so a
   * road that moves takes its portal with it.
   */
  {
    const zc = DS_NORTH - 0.9;
    const HEAD = 7.4;
    /* Between the side walls, like the frontage: across their ends it shares
       four planes with each of them. */
    const edges: number[] = [-W];
    for (const r of DS_ROADS) edges.push(r.x - RH - 0.35, r.x + RH + 0.35);
    edges.push(W);
    for (let i = 0; i < edges.length; i += 2) {
      const a = edges[i];
      const b = edges[i + 1];
      put(b - a, DS_WALL + 2, 1.8, brickwork, (a + b) / 2, (DS_WALL + 2) / 2 - 2, zc);
    }
    for (const r of DS_ROADS) {
      put(DS_ROAD + 0.7, DS_WALL - HEAD - 0.15, 1.8, brickwork, r.x,
          HEAD + 0.15 + (DS_WALL - HEAD - 0.15) / 2, zc);
      /* The portal's own ring, so a hole in a wall is a doorway. The head is
         deeper than the jambs it sits on: cut to the same 2.1 they share four
         faces with it and every one of them fights. */
      put(DS_ROAD + 1.3, 0.5, 2.3, kerb, r.x, HEAD + 0.25, zc);
      for (const s of [-1, 1] as const) {
        put(0.36, HEAD + 0.25, 2.1, kerb, r.x + s * (RH + 0.5), (HEAD + 0.25) / 2, zc);
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* the south range, and the terrace over it                          */
  /* ---------------------------------------------------------------- */

  /*
   * The range is a plinth two metres and ten centimetres high, and the terrace
   * is its roof.
   *
   * Two metres is a ticket machine, a locker bank and a kiosk hatch — which is
   * what the south side of a station concourse actually is — and it is also the
   * tallest a floor can be in this world without being a storey. See
   * `DS_TERRACE`.
   */
  {
    const z0 = DS_RANGE;
    const z1 = DS_SOUTH;
    /*
     * The deck is the top course of the plinth, not a plane laid on it.
     *
     * Twice wrong as a plane. Two millimetres over a box top is two up-facing
     * surfaces in one plane over five hundred and seventy square metres, which
     * would be the largest z-fight this world could possibly have. Lifted clear
     * of that, it was six centimetres above a shadow *caster* directly under it
     * — so the plinth shadowed its own roof and the best vantage in the area
     * rendered as a black shelf. A course of stone is both the floor and the
     * thing that carries it, which is what a plinth is.
     */
    put(60, DS_TERRACE - 0.12, z1 - z0, stone, 0, (DS_TERRACE - 0.12) / 2, (z0 + z1) / 2);
    put(60, 0.12, z1 - z0, flags, 0, DS_TERRACE - 0.06, (z0 + z1) / 2);
    /* Proud of the deck's own face by two centimetres, not flush with it: the
       nosing and the deck share sixty metres of that plane otherwise. */
    put(60.3, 0.3, 0.34, kerb, 0, DS_TERRACE - 0.16, z0 + 0.15);

    /*
     * Ticket machines at the west end, lockers at the east, and the office
     * between them with its window lit because somebody is working.
     *
     * Every one of them is a rectangle in `DS_FRONT`, and each is drawn on the
     * rectangle it is: a machine half a metre deep against a plinth a duelist
     * can only reach to within eighteen centimetres of is a machine you stand
     * inside, which is what `npm run walls` said about all sixteen.
     */
    for (let i = 0; i < 7; i++) {
      const f = DS_FRONT[i];
      /* Six centimetres clear of the plinth's face, on both counts: flush with
         it, sixteen of these shared that plane, and driven into it they are
         sixteen things standing inside a wall. */
      put(f.hw * 2, 1.75, f.hd * 2 - 0.06, steelPale, f.x, 0.875, f.z - 0.03);
      put(1.1, 0.62, 0.12, dark, f.x, 1.28, f.z - f.hd - 0.02);
      put(0.9, 0.1, 0.1, signLight, f.x, 0.86, f.z - f.hd - 0.04);
    }
    for (let i = 0; i < 8; i++) {
      const f = DS_FRONT[7 + i];
      put(f.hw * 2, 1.9, f.hd * 2 - 0.06, cladding, f.x, 0.95, f.z - 0.03);
      for (let k = 0; k < 3; k++) put(f.hw * 2 - 0.14, 0.05, 0.06, iron, f.x, 0.35 + k * 0.6, f.z - f.hd - 0.02);
    }
    {
      const f = DS_FRONT[15];
      put(f.hw * 2 - 0.6, 1.9, f.hd * 2 - 0.22, timber, f.x, 0.95, f.z + 0.11);
      put(f.hw * 2 - 1.4, 1.1, 0.1, signLight, f.x, 1.2, f.z - f.hd + 0.16);
      for (let i = 0; i < 4; i++) put(0.14, 1.98, f.hd * 2 - 0.28, timber, f.x - 5.4 + i * 3.6, 0.99, f.z + 0.11);
      put(f.hw * 2, 0.3, f.hd * 2 + 0.1, kerb, f.x, 2.0, f.z + 0.05);
    }
    const office = new THREE.PointLight('#ffca8a', 30, 12, 2);
    office.position.set(-3, 1.5, z0 - 1.2);
    root.add(office);
    lights.push(office);
    burning.push(office);

    /*
     * The name of the place, high on the frontage.
     *
     * It was over the office, a metre and a half above the terrace — which put
     * a fourteen-metre sign at eye level four metres in front of anybody
     * standing on the terrace, across the one view the terrace exists for. Up
     * here it is read from the whole length of the hall and is behind you when
     * you are looking at the shed.
     */
    const nameTex = surfaceOf(own, () => signBoard('DOMINO STATION', '#e2d3ae', '#2f2a24', undefined, 9), 1, 1, anisotropy);
    put(18, 2.0, 0.16, matt(own, '#ffffff', nameTex), 0, 10.9, DS_SOUTH - 0.16);
    put(18.6, 0.3, 0.42, kerb, 0, 12.05, DS_SOUTH - 0.2);
    put(18.6, 0.26, 0.42, kerb, 0, 9.78, DS_SOUTH - 0.2);
  }

  /* The blocks that close the terrace's ends and rise past it: the stair core
     over the lobby, and the station offices at the east end. */
  for (const b of [{ x: -31.5, hw: 1.5 }, { x: (30 + W) / 2, hw: (W - 30) / 2 }]) {
    const h = 8;
    put(b.hw * 2, h, DS_SOUTH - DS_RANGE, stone, b.x, h / 2, (DS_RANGE + DS_SOUTH) / 2);
    put(b.hw * 2 + 0.4, 0.44, DS_SOUTH - DS_RANGE + 0.4, kerb, b.x, h + 0.22, (DS_RANGE + DS_SOUTH) / 2);
    for (let i = 0; i < Math.max(1, Math.round(b.hw / 2.6)); i++) {
      const x = b.x - b.hw + 1.6 + i * 3.2;
      if (x > b.x + b.hw - 1.2) continue;
      put(1.5, 1.9, 0.14, windowLight, x, 5.3, DS_RANGE - 0.07);
      put(1.74, 0.2, 0.32, kerb, x, 6.4, DS_RANGE - 0.09);
    }
  }

  /*
   * The east exit, shut.
   *
   * The plan puts Station Plaza on the other side of this wall and it is not
   * built, so the way to it is a rolled shutter with the notice still on it —
   * the same answer Market Row's far gates gave for five areas. A dead end you
   * can see the reason for is a place; one you cannot is a budget.
   */
  {
    const ex = W - 0.14;
    put(0.24, 5.4, 9, matt(own, '#ffffff', shutTex), ex, 2.7, 26);
    for (const s of [-1, 1] as const) put(0.7, 6.1, 0.7, stone, ex - 0.23, 3.05, 26 + s * 5.0);
    put(0.94, 0.5, 10.6, kerb, ex - 0.38, 5.91, 26);
    const noticeTex = surfaceOf(own, () => signBoard('EAST EXIT', '#2f2a24', '#c3b795', 'CLOSED', 3), 1, 1, anisotropy);
    put(0.1, 0.9, 2.7, matt(own, '#ffffff', noticeTex), ex - 0.18, 2.6, 26);
  }

  /* ---- the two flights up to the terrace ---- */

  /*
   * Drawn from the platforms the collision answers with, so the step you see is
   * the step you stand on — and drawn as the *mass* of a stone stair, from the
   * floor up to each tread, because a flight you can see under is a flight a
   * duelist can be pushed into from the side.
   */
  for (const t of AREA.platforms ?? []) {
    if (t.hw > 6 || t.hd > 6) continue;
    put(t.hw * 2, t.y, t.hd * 2, stone, t.x, t.y / 2, t.z);
    /*
     * The nosing is flush, and that is not a detail.
     *
     * Drawn the way a stone stair really is — six centimetres proud of the
     * riser — it overhangs the tread *below* it by six centimetres, and
     * `npm run footing` is right to call that a floor drawn eighteen
     * centimetres above the one the game says you are standing on. Seventy-six
     * cells of it. A band inside the tread's own footprint gives the flight its
     * line and overhangs nothing.
     */
    put(t.hw * 2, 0.16, 0.05, kerb, t.x, t.y - 0.09, t.z - t.hd + 0.035);
    for (const s of [-1, 1] as const) {
      put(0.4, t.y + 0.95, t.hd * 2, stone, t.x + s * (DS_FLIGHT_HALF + 0.2), (t.y + 0.95) / 2, t.z);
      put(0.52, 0.16, t.hd * 2, kerb, t.x + s * (DS_FLIGHT_HALF + 0.2), t.y + 1.03, t.z);
    }
  }

  /* The balustrade along the terrace, broken where each flight arrives — the
     same three runs the collision is written as. */
  for (const run of [{ x: -28.25, hw: 1.75 }, { x: 0, hw: 21.5 }, { x: 28.25, hw: 1.75 }]) {
    const zc = DS_RANGE + 0.25;
    put(run.hw * 2, 0.34, 0.5, stone, run.x, DS_TERRACE + 0.17, zc);
    put(run.hw * 2, 0.14, 0.62, brass, run.x, DS_TERRACE + 1.02, zc);
    put(run.hw * 2, 0.06, 0.06, brass, run.x, DS_TERRACE + 0.62, zc);
    const posts = Math.max(2, Math.round(run.hw / 0.75));
    for (let i = 0; i <= posts; i++) {
      put(0.07, 0.62, 0.07, brass, run.x - run.hw + (run.hw * 2 / posts) * i, DS_TERRACE + 0.64, zc);
    }
  }

  /*
   * Brackets along the frontage, over the terrace.
   *
   * The deepest shade in the building is up here: it is under the roof, behind
   * the range, and forty metres from the nearest pendant. Four lamps on the
   * wall are what a gallery like this actually has, and without them the best
   * vantage in the area is a black shelf.
   */
  for (const x of [-24, -8, 8, 24]) {
    const zw = DS_SOUTH - 0.3;
    put(0.16, 0.16, 0.9, iron, x, DS_TERRACE + 2.5, zw - 0.4);
    put(0.62, 0.5, 0.62, iron, x, DS_TERRACE + 2.2, zw - 0.85);
    put(0.5, 0.14, 0.5, lamplight, x, DS_TERRACE + 1.94, zw - 0.85);
    const l = new THREE.PointLight('#ffbe78', 130, 20, 2);
    l.position.set(x, DS_TERRACE + 1.9, zw - 1.1);
    root.add(l);
    lights.push(l);
    burning.push(l);
  }

  /* ---------------------------------------------------------------- */
  /* the hall                                                          */
  /* ---------------------------------------------------------------- */

  /*
   * The hall is under the same roof as the platforms, so what it needs is not a
   * ceiling but columns — and they stand under the *valleys*, which is the
   * whole of why the middle of the hall is clear. See `DS_HALL_COLUMNS`.
   *
   * Between each pair, a tie beam across the width with a post up to every
   * ridge: that is what carries the middle of a span with nothing under it, and
   * it is the structure you look up at from the floor of the hall.
   */
  for (const z of DS_HALL_ROWS) {
    for (const x of DS_HALL_COLUMNS) {
      const top = roofY(x);
      const group = `hall${x}:${z}`;
      put(1.5, 0.4, 1.5, kerb, x, 0.2, z, { group });
      put(1.2, top - 1.1, 1.2, stone, x, 0.4 + (top - 1.1) / 2, z, { group });
      put(1.5, 0.34, 1.5, kerb, x, top - 0.53, z, { group });
      put(1.9, 0.26, 1.9, kerb, x, top - 0.23, z, { group });
    }
    put(W * 2, 0.36, 0.5, steel, 0, 9.18, z);
    put(W * 2, 0.12, 0.9, steel, 0, 9.42, z, { cast: false });
    for (const px of DS_PLATFORMS) {
      put(0.34, DS_RIDGE - 1.1 - 9.36, 0.34, steel, px, 9.36 + (DS_RIDGE - 1.1 - 9.36) / 2, z);
      for (const s of [-1, 1] as const) {
        put(Math.hypot(DS_SPAN, DS_RIDGE - DS_EAVES) * 0.5, 0.22, 0.22, steel,
            px + s * DS_SPAN * 0.25, 9.36 + (DS_RIDGE - 1.1 - 9.36) * 0.5, z,
            { rotZ: s * -Math.atan2(DS_RIDGE - DS_EAVES, DS_SPAN), cast: false });
      }
    }
  }

  /* Pendants down the hall, hung on rods off the roof between the columns. */
  for (const x of [-33.6, -14.4, 4.8, 24]) {
    for (const z of [20, 28.5]) {
      const up = roofY(x);
      put(0.05, up - 6.2, 0.05, iron, x, 6.2 + (up - 6.2) / 2, z, { cast: false });
      put(1.1, 0.26, 1.1, iron, x, 6.15, z);
      put(0.95, 0.12, 0.95, lamplight, x, 5.97, z);
    }
    const l = new THREE.PointLight('#ffbe78', 200, 32, 2);
    l.position.set(x, 5.7, 24);
    root.add(l);
    lights.push(l);
  }

  /* ---------------------------------------------------------------- */
  /* what is left out on the floor                                     */
  /* ---------------------------------------------------------------- */

  /*
   * One list, read here and spread into `solids` in `areas.ts`.
   *
   * The seats on the platforms are the reason it exists: drawn and not solid,
   * they are furniture a duelist walks straight through, and `npm run walls`
   * calls that walking into a drawn thing. Which it is.
   */
  const things: Record<StationThing['kind'], (t: StationThing) => void> = {
    seat: (t) => {
      put(t.hw * 2, 0.4, t.hd * 2, kerb, t.x, 0.2, t.z);
      for (const s of [-1, 1] as const) put(0.56, 0.12, t.hd * 2 - 0.2, timber, t.x + s * 0.34, 0.86, t.z);
      put(0.1, 0.56, t.hd * 2 - 0.2, timber, t.x, 1.2, t.z);
    },
    bench: (t) => {
      put(t.hw * 2, 0.4, t.hd * 2, kerb, t.x, 0.2, t.z);
      for (const s of [-1, 1] as const) put(t.hw * 2 - 0.2, 0.12, 0.56, timber, t.x, 0.86, t.z + s * 0.34);
      put(t.hw * 2 - 0.2, 0.56, 0.1, timber, t.x, 1.2, t.z);
    },
    perch: (t) => {
      /* The plank is the whole rectangle. Drawn narrower than its solid, the
         eight ends of these four benches were eight walls of air. */
      put(t.hw * 2, 0.1, t.hd * 2, timber, t.x, DS_TERRACE + 0.44, t.z);
      put(t.hw * 2, 0.5, 0.12, timber, t.x, DS_TERRACE + 0.72, t.z + t.hd - 0.06);
      for (const s of [-1, 1] as const) {
        put(0.12, 0.44, t.hd * 2, iron, t.x + s * (t.hw - 0.06), DS_TERRACE + 0.22, t.z);
      }
    },
    bin: (t) => {
      put(t.hw * 2, 0.86, t.hd * 2, iron, t.x, 0.43, t.z);
      put(t.hw * 2 + 0.1, 0.12, t.hd * 2 + 0.1, steelPale, t.x, 0.92, t.z);
    },
    fountain: (t) => {
      put(t.hw * 2, 0.9, t.hd * 2, kerb, t.x, 0.45, t.z);
      put(t.hw * 2 - 0.1, 0.08, t.hd * 2 - 0.1, spout, t.x, 0.94, t.z);
    },
    notice: (t) => {
      /* Its face is the one that looks at the lobby, which is west: the first
         pass put the pale panel on the side that is inside the stair core and
         left the lobby a two-metre black rectangle. */
      put(t.hw * 2, 2.2, t.hd * 2, kerb, t.x, 1.4, t.z);
      put(t.hw * 2 - 0.14, 1.6, t.hd * 2 - 0.5, timber, t.x - 0.04, 1.4, t.z);
      /* Proud of its own frame, not inside it: drawn eight centimetres behind
         the timber it is pinned to, the board is a black rectangle two metres
         from the door you come in by. */
      put(t.hw * 2 - 0.3, 1.3, t.hd * 2 - 0.9, bill, t.x - 0.18, 1.4, t.z);
    },
    kiosk: (t) => {
      const w = t.hw * 2 - 0.6;
      const d = t.hd * 2 - 0.6;
      put(w, 3.1, d, stone, t.x, 1.55, t.z);
      put(t.hw * 2, 0.34, t.hd * 2, kerb, t.x, 3.27, t.z);
      /*
       * Open on the hall side: a hatch with a light in it, a canopy over, and
       * somebody's papers stacked on the sill.
       *
       * And a fascia and a bill on each of the other three, because a stall in
       * the middle of a hall is seen from every side and the first pass gave it
       * one face and three blank walls — a six-metre grey slab in the one place
       * the length of the concourse is meant to read from.
       */
      put(w - 0.6, 1.5, 0.16, signLight, t.x, 1.6, t.z - t.hd + 0.34);
      put(w - 0.4, 0.5, 1.3, canopy, t.x, 2.6, t.z - t.hd - 0.1);
      for (let i = 0; i < 3; i++) put(1.3, 0.34, 0.9, cladding, t.x - 1.9 + i * 1.9, 0.62, t.z - t.hd + 0.1);
      put(w + 0.2, 0.44, d + 0.2, kerb, t.x, 2.82, t.z);
      for (const s of [-1, 1] as const) {
        put(0.14, 1.7, d - 1.0, kerb, t.x + s * (w / 2), 1.5, t.z);
        put(0.1, 1.4, d - 1.4, bill, t.x + s * (w / 2 + 0.07), 1.5, t.z);
      }
      put(w - 1.0, 1.7, 0.14, kerb, t.x, 1.5, t.z + d / 2);
      put(w - 1.4, 1.4, 0.1, bill, t.x, 1.5, t.z + d / 2 + 0.07);
      const l = new THREE.PointLight('#ffc186', 52, 14, 2);
      l.position.set(t.x, 2.2, t.z - t.hd - 0.4);
      root.add(l);
      lights.push(l);
      burning.push(l);
    },
  };
  for (const t of DS_THINGS) things[t.kind](t);

  /* The lobby you come in at: a mat, and a light over the door, so the corner
     is a room and not a leftover. */
  {
    put(5.4, 0.03, 3.4, doormat, -42.5, 0.02, 43.5, { cast: false });
    const l = new THREE.PointLight('#ffc186', 70, 18, 2);
    l.position.set(-40, 4.4, 42);
    root.add(l);
    lights.push(l);
    burning.push(l);
    put(1.2, 0.16, 1.2, iron, -40, 4.6, 42);
    put(1.0, 0.12, 1.0, lamplight, -40, 4.5, 42);
    const up = roofY(-40);
    put(0.05, up - 4.68, 0.05, iron, -40, 4.68 + (up - 4.68) / 2, 42, { cast: false });
  }

  /* ---------------------------------------------------------------- */
  /* the gate line                                                     */
  /* ---------------------------------------------------------------- */

  for (const s of [-1, 1] as const) {
    const a = s * DS_GATE_HALF;
    const b = s * W;
    put(Math.abs(b - a), 2.6, 0.8, stone, (a + b) / 2, 1.3, DS_GATE);
    put(Math.abs(b - a) + 0.2, 0.2, 1.0, kerb, (a + b) / 2, 2.7, DS_GATE);
    put(Math.abs(b - a) - 1.2, 0.1, 0.1, brass, (a + b) / 2, 2.86, DS_GATE);
  }
  for (const gx of DS_GATES) {
    put(0.6, 1.06, 2.2, steelPale, gx, 0.53, DS_GATE);
    put(0.64, 0.1, 2.24, iron, gx, 1.11, DS_GATE);
    /* The reader panel, and the little amber arrow that says which way this one
       runs. Amber on dark is the only lit colour in the building. */
    put(0.5, 0.24, 0.5, dark, gx, 1.02, DS_GATE - 0.7);
    put(0.3, 0.03, 0.3, boardLight, gx, 1.16, DS_GATE - 0.7);
    for (const s of [-1, 1] as const) put(0.36, 0.5, 0.1, cladding, gx, 0.78, DS_GATE + s * 1.06);
  }
  /* Paint across the floor at the gates: the line you queue behind. */
  for (const s of [-1, 1] as const) {
    put(DS_GATE_HALF * 2, 0.02, 0.18, paint, 0, 0.02, DS_GATE + s * 2.2, { cast: false });
  }

  /*
   * The girder across the mouth of the shed, and what hangs off it.
   *
   * This is the lid the camera is held under — `ceiling` in `areas.ts` is set
   * forty centimetres below its soffit — and it is the frame the whole shed is
   * seen through from the hall. A deep plate girder on four columns, with the
   * departure board slung under the middle and the clock at the centre where
   * everybody in the building can find it.
   */
  {
    const zc = DS_ARCH_AT;
    const TOP = DS_ARCH + 0.8;
    for (const x of DS_ARCH_COLUMNS) {
      /* Up to the valley over the road they stand on, not merely to the girder:
         these are the only support the gutter has for its whole length. */
      const up = roofY(x);
      const group = `arch${x}`;
      put(1.1, 0.4, 1.1, kerb, x, 0.2, zc, { group });
      put(0.9, up - 0.4, 0.9, column, x, 0.4 + (up - 0.4) / 2, zc, { group });
      put(1.4, 0.3, 1.4, steel, x, TOP + 0.15, zc, { group });
    }
    put(W * 2, TOP - DS_ARCH, 2.0, steel, 0, (DS_ARCH + TOP) / 2, zc);
    put(W * 2, 0.26, 2.4, kerb, 0, DS_ARCH - 0.13, zc);
    for (const y of [DS_ARCH + 0.22, TOP - 0.22]) {
      for (let i = 0; i < 46; i++) put(0.16, 0.16, 0.14, iron, -45 + i * 2, y, zc - 1.02, { cast: false });
    }

    /* The board. Amber on a dark ground: a bulb matrix, which is what a
       departure board was before it was a screen. */
    put(17, 1.9, 0.5, boardGround, 0, 7.5, zc - 1.2);
    put(17.4, 0.26, 0.7, kerb, 0, 8.58, zc - 1.2);
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const w = [4.4, 2.2, 3.0, 1.4][c];
        const x = -7.2 + [0, 5.2, 8.6, 12.6][c] + w / 2 - 1.4;
        put(w * 0.82, 0.16, 0.06, boardLight, x, 7.9 - r * 0.42, zc - 1.47);
      }
    }
    put(15.4, 0.16, 0.06, boardLight, 0, 8.34, zc - 1.47);

    /* The clock, four-faced, on the centre line. */
    for (const s of [-1, 1] as const) {
      put(2.2, 2.2, 0.16, brass, 0, 4.9, zc + s * 0.5);
      put(1.9, 1.9, 0.12, dial, 0, 4.9, zc + s * 0.6);
      put(0.07, 0.66, 0.05, iron, 0, 5.16, zc + s * 0.68);
      put(0.48, 0.06, 0.05, iron, 0.19, 4.9, zc + s * 0.68);
      put(0.14, 0.14, 0.06, brass, 0, 4.9, zc + s * 0.69);
    }
    put(0.16, 1.5, 0.16, iron, 0, 6.6, zc);
  }

  /* ---------------------------------------------------------------- */
  /* the shed roof                                                     */
  /* ---------------------------------------------------------------- */

  const glazing = own.keep(new THREE.MeshStandardMaterial({
    color: '#cfd2cb', roughness: 0.35, metalness: 0,
  }));
  /* The underside of the sheet is the largest surface in the area and is never
     in the sun. Pale, for the same reason the steel is. */
  const roofSkin = own.keep(new THREE.MeshStandardMaterial({
    color: '#6e6f68', roughness: 0.7, metalness: 0,
  }));

  /** One slope of the roof, from a ridge down to a valley: a box turned about z. */
  const slope = (
    x0: number, y0: number, x1: number, y1: number,
    material: THREE.Material, thick: number, cast: boolean
  ) => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    put(Math.hypot(dx, dy), thick, ROOF_LEN, material, (x0 + x1) / 2, (y0 + y1) / 2, ROOF_MID,
        { rotZ: Math.atan2(dy, dx), cast, group: `roof${x0}:${x1}` });
  };

  for (const px of DS_PLATFORMS) {
    for (const s of [-1, 1] as const) {
      const outer = Math.max(-W, Math.min(W, px + s * DS_SPAN));
      const run = Math.abs(outer - px);
      const yOuter = DS_RIDGE - (DS_RIDGE - DS_EAVES) * (run / DS_SPAN);
      const len = Math.hypot(outer - px, yOuter - DS_RIDGE);
      const ux = (outer - px) / len;
      const uy = (yOuter - DS_RIDGE) / len;
      /* The roof light: 2.6 m of the slope, from the ridge down, and the one
         panel that must not cast — see the note at the top of this file. */
      const gx = px + ux * 2.6;
      const gy = DS_RIDGE + uy * 2.6;
      slope(px, DS_RIDGE, gx, gy, glazing, 0.14, false);
      slope(gx, gy, outer, yOuter, roofSkin, 0.3, true);
      /* Purlins under the sheet, so the underside has structure to catch the
         lamplight instead of being a flat plane four metres over your head. */
      for (let k = 1; k <= 3; k++) {
        const t = 2.6 + (len - 2.6) * (k / 4);
        put(0.12, 0.34, ROOF_LEN - 0.6 - k * 0.2, steel, px + ux * t, DS_RIDGE + uy * t - 0.28,
            ROOF_MID, { cast: false });
      }
    }
    /* No two of these are the same length, and that is the point: four members
       run the whole ninety-eight metres over every ridge and valley, and any
       two of them cut to the same length end in one plane. */
    put(0.34, 0.9, ROOF_LEN - 0.3, steel, px, DS_RIDGE - 0.55, ROOF_MID);
    put(1.4, 0.34, ROOF_LEN + 0.3, steel, px, DS_RIDGE + 0.24, ROOF_MID);
  }
  /* The valley over every road, which is where two spans meet and the water
     goes. A gutter and a fascia; nothing else fits there. */
  for (const r of DS_ROADS) {
    put(1.6, 0.5, ROOF_LEN + 0.15, steel, r.x, DS_EAVES - 0.2, ROOF_MID);
    put(1.9, 0.22, ROOF_LEN - 0.15, kerb, r.x, DS_EAVES + 0.1, ROOF_MID);
  }

  /*
   * The columns, one row per platform, and the rafters they carry.
   *
   * A shed roof is an umbrella: the load comes down the middle of the platform
   * and the eaves cantilever out over the roads, which is why there is no
   * column anywhere a train has to be.
   */
  for (const px of DS_PLATFORMS) {
    for (const z of DS_COLUMNS) {
      const top = DS_RIDGE - 1.2;
      const group = `col${px}:${z}`;
      put(1.3, 0.34, 1.3, kerb, px, 0.17, z, { group });
      put(0.86, top - 0.34, 0.86, column, px, 0.34 + (top - 0.34) / 2, z, { group });
      put(1.6, 0.36, 1.6, steel, px, top + 0.18, z, { group });
      for (const s of [-1, 1] as const) {
        put(Math.hypot(DS_SPAN, DS_RIDGE - DS_EAVES) * 0.62, 0.3, 0.3, steel,
            px + s * DS_SPAN * 0.31, DS_EAVES + (DS_RIDGE - DS_EAVES) * 0.68, z,
            { rotZ: s * -Math.atan2(DS_RIDGE - DS_EAVES, DS_SPAN), cast: false });
      }
    }
  }

  /*
   * The lights over the platforms.
   *
   * Fittings, spaced — not one continuous strip. The strip was drawn first and
   * it was wrong twice over: it read as a ninety-metre line of light, which is
   * the one thing this city does not have and never will, and a lit line under
   * a roof with no fitting on it is a light with no lamp, which is the fault
   * this world has been corrected on three times. Each of these hangs off the
   * rafter over it on a rod you can see.
   */
  {
    const from = DS_NORTH + 2;
    const to = DS_GATE - 2;
    for (const px of DS_PLATFORMS) {
      for (const s of [-1, 1] as const) {
        const bx = px + s * 2.6;
        for (let z = from + 4; z < to; z += 7.4) {
          const up = roofY(bx) - 0.34;
          put(0.05, up - 8.55, 0.05, iron, bx, 8.55 + (up - 8.55) / 2, z, { cast: false });
          put(0.4, 0.2, 2.1, iron, bx, 8.45, z);
          put(0.3, 0.08, 1.9, battenLight, bx, 8.31, z);
        }
      }
      for (const z of [DS_NORTH + 14, DS_NORTH + 38]) {
        const l = new THREE.PointLight('#ffbe78', 190, 30, 2);
        l.position.set(px, 8.1, z);
        root.add(l);
        lights.push(l);
      }
    }
  }

  /* ---- what marks a platform out ---- */

  const platformNameTex = surfaceOf(own, () => signBoard('DOMINO', '#2f2a24', '#d6cbaa', undefined, 4), 1, 1, anisotropy);
  const platformName = matt(own, '#ffffff', platformNameTex);
  /*
   * The line and the tactile strip, on the edges that face a road.
   *
   * Off the roads and not off the platforms: the outer face of platform one and
   * of platform five is a wall, and a yellow line along a wall is a line
   * warning you about the brickwork. Two centimetres proud and no more —
   * anything a duelist can stand on that is drawn higher than `groundAt` says
   * is a foot inside the floor, and `npm run footing` counted eight hundred
   * cells of it at five.
   */
  for (const r of DS_ROADS) {
    for (const s of [-1, 1] as const) {
      const ex = r.x + s * RH;
      put(0.5, 0.02, DS_CROSS - DS_NORTH, paint, ex + s * 0.86, 0.02, (DS_CROSS + DS_NORTH) / 2, { cast: false });
      /* Inboard of the barrier's plinth, not under it: laid on the edge line
         itself it shares that plane with the plinth for fifty-two metres. */
      put(0.34, 0.02, DS_CROSS - DS_NORTH - 0.4, kerb, ex + s * (DS_BARRIER.d + 0.17), 0.01,
          (DS_CROSS + DS_NORTH) / 2, { cast: false });
    }
  }

  for (let i = 0; i < DS_PLATFORMS.length; i++) {
    const px = DS_PLATFORMS[i];
    /* A name board hanging off the roof at each end, and the platform number on
       the column beside it. */
    for (const z of [DS_NORTH + 12, DS_NORTH + 40]) {
      put(0.06, 1.1, 0.06, iron, px, 8.85, z, { cast: false });
      put(3.4, 0.9, 0.12, platformName, px, 7.85, z);
      put(3.6, 0.14, 0.26, brass, px, 8.4, z);
    }
    const numTex = surfaceOf(own, () => signBoard(String(i + 1), '#e6d9b6', '#38312a', undefined, 1), 1, 1, anisotropy);
    put(0.9, 0.9, 0.06, matt(own, '#ffffff', numTex), px + 0.46, 2.9, DS_COLUMNS[3]);
  }

  /*
   * The barriers, drawn exactly where the collision is — and open above the
   * plinth, which is the whole reason the roads are worth digging.
   *
   * Drawn first as a solid run of panels, and it hid the thing it exists for.
   * A camera four and a half metres behind a duelist stopped at a barrier
   * 1.2 m high looks *down* at about a quarter — over the near barrier's top
   * that line is still thirty centimetres above the far platform when it gets
   * there, so the trench, the ballast, the sleepers and the rail were never
   * once visible from anywhere a player can stand. Two roads left empty so the
   * railway can be seen, and a wall in front of both.
   *
   * So: a solid kick plate, uprights every metre and a half, two rails, and the
   * closed leaves only where a door would be. Fifty-eight per cent of it is
   * air, and through the air is the road.
   *
   * Nine hundred metres of it all told, in one loop, because it is one thing
   * repeated and the moment it is written twice it stops matching.
   */
  for (const r of DS_ROADS) {
    for (const s of [-1, 1] as const) {
      const bx = r.x + s * (RH + DS_BARRIER.d / 2);
      const len = DS_CROSS - DS_NORTH;
      const zc = (DS_CROSS + DS_NORTH) / 2;
      const group = `bar${bx}`;
      /* Five pieces, and no two of them the same height: an upright whose top
         is the top rail's top is thirty-five shared planes down every run. */
      put(DS_BARRIER.d, 0.34, len, kerb, bx, 0.17, zc, { group });
      put(DS_BARRIER.d - 0.02, 0.08, len, steel, bx, 0.74, zc, { group });
      put(DS_BARRIER.d + 0.06, 0.1, len, steel, bx, DS_BARRIER.h - 0.05, zc, { group });
      for (let z = DS_NORTH + 2.4; z < DS_CROSS - 2; z += 4.5) {
        put(DS_BARRIER.d + 0.02, 0.8, 1.9, cladding, bx, 0.76, z, { group });
        put(DS_BARRIER.d + 0.04, 0.09, 1.82, brass, bx, 1.085, z, { group });
      }
      for (let z = DS_NORTH + 1; z < DS_CROSS; z += 1.5) {
        put(DS_BARRIER.d + 0.08, DS_BARRIER.h - 0.1, 0.12, steelPale, bx, (DS_BARRIER.h - 0.1) / 2, z, { group });
      }
    }
  }

  /* ---- the two trains ---- */

  /**
   * A carriage: cream over a colour, on a dark skirt with the bogies under it,
   * which is a Japanese commuter car of about 1975 and is exactly the register
   * this city is built in.
   *
   * The windows are `glow`, so they go out with the lamps: a train standing in
   * a shed at four in the afternoon has its lights off, and at midnight it does
   * not.
   */
  const carriage = (cx: number, z0: number, body: THREE.Material, first: boolean, group: string) => {
    const LEN = 19.5;
    const zc = z0 - LEN / 2;
    const y0 = DS_TRACK + 0.15;
    const g = { group };
    /* Underframe, bogie and wheel each sit at their own depth. Cut to one
       datum they share the plane under the whole train — forty pairs of it,
       and it is the one part of this area nobody will ever see. */
    put(2.86, 0.5, LEN - 0.4, iron, cx, y0 + 0.28, zc, g);
    for (const s of [-1, 1] as const) {
      put(2.4, 0.72, 2.6, iron, cx, y0 + 0.4, zc + s * (LEN / 2 - 3.4), g);
      for (const k of [-1, 1] as const) {
        put(2.62, 0.86, 0.86, bogie, cx, y0 + 0.44, zc + s * (LEN / 2 - 3.4) + k * 1.05, g);
      }
    }
    put(3.0, 1.15, LEN, body, cx, y0 + 1.08, zc, g);
    put(3.0, 1.5, LEN, cream, cx, y0 + 2.4, zc, g);
    put(3.0, 0.62, LEN, body, cx, y0 + 3.46, zc, g);
    put(2.86, 0.34, LEN - 0.5, cladding, cx, y0 + 3.9, zc, g);
    put(2.5, 0.22, LEN - 1.6, steelPale, cx, y0 + 4.06, zc, g);
    for (const s of [-1, 1] as const) {
      for (let i = 0; i < 4; i++) {
        const wz = zc - LEN / 2 + 3.1 + i * 4.5;
        /* Inside the cream band it sits in, not the same height as it. */
        put(0.1, 1.36, 1.3, dark, cx + s * 1.5, y0 + 2.4, wz, g);
        put(0.06, 1.16, 1.16, trainWindow, cx + s * 1.54, y0 + 2.45, wz, g);
        if (i >= 3) continue;
        const dz = wz + 2.25;
        put(0.12, 2.56, 1.3, cream, cx + s * 1.51, y0 + 1.93, dz, g);
        put(0.14, 0.9, 1.16, trainDoorGlass, cx + s * 1.56, y0 + 2.6, dz, g);
        put(0.16, 0.06, 1.26, iron, cx + s * 1.53, y0 + 0.62, dz, g);
      }
    }
    if (!first) return;
    put(2.9, 2.2, 0.4, cream, cx, y0 + 2.6, z0 + 0.18, g);
    put(2.1, 0.95, 0.14, dark, cx, y0 + 3.0, z0 + 0.42, g);
    put(1.9, 0.8, 0.06, trainDoorGlass, cx, y0 + 3.0, z0 + 0.49, g);
    for (const s of [-1, 1] as const) put(0.34, 0.3, 0.12, signLight, cx + s * 1.05, y0 + 1.5, z0 + 0.45, g);
    put(2.9, 0.4, 0.5, roadTop, cx, y0 + 0.5, z0 + 0.2, g);
  };

  for (const r of DS_ROADS) {
    if (!r.livery) continue;
    const group = `train${r.x}`;
    carriage(r.x, DS_BUFF, livery[r.livery], true, group);
    carriage(r.x, DS_BUFF - 19.6, livery[r.livery], false, group);
    /* And the rest of it, running out through the portal. Only ever seen edge
       on, and what it is for is that the portal is not a hole. */
    put(3.0, 4.3, 12, livery[r.livery], r.x, DS_TRACK + 2.3, DS_TRAIN_TAIL - 6.2, { group });
  }

  /* ---------------------------------------------------------------- */
  /* what is beyond the doors                                          */
  /* ---------------------------------------------------------------- */

  /*
   * The railway, north of the screen.
   *
   * One closed box across the whole width rather than four, because the four
   * portals look into one place and it is the same place: the line going on.
   * Its back, its returns and its lid are clear of every wall in the area, so
   * no two faces of it are in one plane with anything and no sight line from
   * inside can reach an edge of it.
   *
   * What is standing in it matters more than its size. A gate you can see into
   * with nothing there is a hole; this has ballast running away under a road
   * bridge, retaining walls either side, and a signal with a light on it —
   * which is the first two metres of the place beyond, and says where it goes.
   */
  {
    const back = DS_NORTH - 16.7;
    const lid = 8.6;
    const wide = OUT * 2 + 6;
    put(wide, 16, 2.6, brickwork, 0, 6, back);
    for (const s of [-1, 1] as const) put(2.6, 16, 15.4, brickwork, s * (OUT + 1.3), 6, DS_NORTH - 7.7);
    /* The road bridge, which is the lid. */
    put(wide, 1.5, 7.2, roadTop, 0, lid + 0.75, DS_NORTH - 6.4);
    put(wide - 0.6, 0.9, 0.62, kerb, 0, lid + 1.95, DS_NORTH - 9.71);
    put(wide - 0.6, 0.9, 0.62, kerb, 0, lid + 1.95, DS_NORTH - 3.09);
    put(wide - 1.2, 1.2, 8.4, soffitDark, 0, lid + 0.1, DS_NORTH - 6.4);
    slab(wide - 3, 15.4, 0, DS_TRACK, DS_NORTH - 7.7, bed);
    for (const r of DS_ROADS) {
      for (const s of [-1, 1] as const) {
        put(1.6, 2.6, 14.8, retaining, r.x + s * (RH + 0.8), DS_TRACK + 1.3, DS_NORTH - 8.0);
      }
      /* A signal at the end of every road: red where a train is standing, amber
         where the road is clear. */
      const sx = r.x + RH + 1.5;
      put(0.3, 5.4, 0.3, iron, sx, DS_TRACK + 2.7, DS_NORTH - 4);
      put(0.7, 1.5, 0.5, dark, sx, DS_TRACK + 5.6, DS_NORTH - 4);
      put(0.36, 0.36, 0.1, r.livery ? signalRed : boardLight, sx, DS_TRACK + 5.9, DS_NORTH - 4.28);
      put(0.36, 0.36, 0.1, bogie, sx, DS_TRACK + 5.3, DS_NORTH - 4.28);
    }
    /* Two, and close to the screen: a portal you can see into and there is
       nothing there is a hole, and one lamp fifteen metres back lit nothing a
       duelist on a platform could actually see. */
    for (const x of [-19.2, 19.2]) {
      const l = new THREE.PointLight('#ffbe78', 260, 34, 2);
      l.position.set(x, DS_TRACK + 5.6, DS_NORTH - 5.5);
      root.add(l);
      lights.push(l);
    }
  }

  /*
   * And Market Row, west of the gateway.
   *
   * A short box with the arcade's floor running into it, its last unit's wall
   * either side, and a pendant burning — the two metres of the place beyond
   * that stop a doorway being a hole in the world.
   */
  {
    const gx = -OUT;
    put(2.4, 12, 13, brickwork, gx - 5.6, 3.6, 43.5);
    put(9, 12.4, 2.4, brickwork, gx - 2.6, 3.7, 37.6);
    put(9, 12.4, 2.4, brickwork, gx - 2.6, 3.7, 49.4);
    put(10.4, 1.4, 14, dark, gx - 3.2, 7.1, 43.5);
    /* Two centimetres up, not two millimetres: the hall's own floor reaches
       the wall line and two planes four millimetres apart is the flicker this
       whole file is careful about. */
    slab(9.6, 12, gx - 2.8, 0.02, 43.5, flags);
    put(0.05, 1.4, 0.05, iron, gx - 3.2, 5.7, 43.5);
    put(0.9, 0.24, 0.9, iron, gx - 3.2, 4.9, 43.5);
    put(0.8, 0.1, 0.8, lamplight, gx - 3.2, 4.74, 43.5);
    const l = new THREE.PointLight('#ffbe78', 120, 20, 2);
    l.position.set(gx - 3.2, 4.6, 43.5);
    root.add(l);
    lights.push(l);
  }

  bake();

  /* ---------------------------------------------------------------- */
  /* light                                                             */
  /* ---------------------------------------------------------------- */

  /*
   * One sun, and a shadow camera big enough for the shed and the block behind
   * it.
   *
   * `fill` is about enclosure, and this enclosure is made of glass. Market Row
   * takes a quarter of the sky because a painted metal canopy a metre over its
   * lamps lets nothing through; ten bands of roof light down a ninety-five
   * metre roof let a great deal through, and the first pass here borrowed
   * Market Row's number and drew a daylit terminus as a car park at dusk.
   *
   * Over one, in the end. Ninety per cent of this floor is in the roof's shadow
   * at any hour, so the shade is not an accent here — it is the room, and what
   * fills it is light off eleven thousand square metres of pale sheet. A number
   * under one draws that as night with the lights off.
   */
  const sky = ownSky(own, new Sky(own, root, {
    reach: 98,
    half: 76,
    deep: 76,
    target: [0, 1.5, -6],
    /* One texel of a 2048 map over 152 m of camera. See `market.ts`. */
    normalBias: 0.075,
    /*
     * And the sky in here is the roof.
     *
     * A hemisphere light puts its sky colour on what faces up and its ground
     * colour on what faces down, and everything vertical gets the average. Left
     * as the real sky, every column, barrier and wall in the shade of this roof
     * — which is all of them, all day — took a cold blue average and came out
     * near black beside a floor that faces the light. Market Row names its own
     * hemisphere for the same reason; here it is the pale underside of eleven
     * thousand square metres of sheet, over a warm stone floor. Only the
     * *level* follows the hour.
     */
    hemi: { sky: '#a3a79f', ground: '#7c6f5c' },
    gain: 1.05,
    fill: 1.3,
  }));

  const glassLit = new THREE.Color('#cfd2cb');
  const glassDark = new THREE.Color('#3b3f42');

  for (const l of burning) sky.burning(l);
  sky.claim();

  return {
    root,
    setTime: (hour) => {
      const p = sky.apply(hour);
      /* The roof lights are lit from above by day and dark holes at night,
         which is the opposite of everything `glow` does — so they are an
         ordinary material moved by hand off the same number the lamps use. */
      glazing.color.copy(glassDark).lerp(glassLit, 1 - p.lamps);
    },
    dispose() {
      for (const item of own.items) item.dispose();
      for (const lamp of lights) lamp.shadow?.map?.dispose();
    },
  };
}
