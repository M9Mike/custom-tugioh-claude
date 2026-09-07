/**
 * Domino High — two hundred metres by a hundred and seventy.
 *
 * Thirty-four thousand square metres, which is two and a half Station Plazas
 * and the largest area in the city by a factor of two. Almost none of it is
 * building: a teaching wing along the north edge, a gym in one corner, and the
 * rest is ground — the drive up from the gate, the courtyard between the
 * blocks, and a sports field with a running track round it that on its own is
 * larger than the square outside the station. From the gate to the far
 * touchline is a hundred and sixty metres, which is two and a half minutes'
 * walk, and the walk is the point.
 *
 * ## Corridors
 *
 * Everything in this city so far is *crossed*: you can see where you are going
 * from where you are standing, and the shape of an area is one glance. A
 * hundred and forty-four metres of teaching block on two floors cannot be seen
 * at a glance from anywhere inside it. Fifteen bays off one corridor, an
 * entrance hall halfway along, a stair tower at each end that is the only way
 * up — the first place in Domino City you have to *navigate*.
 *
 * Which also makes it the first outdoor area with storeys. Black Crown's shop
 * is a room three floors high and every one of its floors is in sight of the
 * others; here the corridor above you is a lid you cannot see through, and the
 * camera has to know that.
 *
 * ## What a school looks like when it is not in use
 *
 * Empty, and lit. The corridors keep their lights on, the vending machines
 * hum, one classroom in four has its blinds up, and the flag is still up the
 * pole. The cast comes later — what this has to be today is a place that looks
 * like somebody left ten minutes ago.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  asphalt, brick, concrete, darkWood, paving, render, shutter, signBoard, soil, turf, woodFloor,
} from './surfaces';
import {
  Owned, bakedFrom, basePlate, decal, glow, lit, matt, scaleBoxUVs, seeded, surfaceOf, tiled,
  type BakedPart, type BuiltArea,
} from './kit';
import { Sky, ownSky } from './sky';
import {
  AREAS, dhBay, DH_BAY, DH_BAYS, DH_CORR, DH_EAVES, DH_FIELD, DH_FLIGHT, DH_FLIGHT_STEPS,
  DH_FLOOR, DH_GATE, DH_GATE_HALF, DH_GYM, DH_GYM_DOOR, DH_HALL, DH_IN, DH_INNER, DH_LIBRARY, DH_MAIN,
  DH_DESKS, DH_OPEN, DH_OPEN_UP, DH_POOL, DH_ROOM, DH_SPECIAL, DH_THINGS, DH_TOWER, DH_TOWERS, DH_TRACK,
  DH_UPPER, DH_WALKS, groundAt, type HighThing,
} from '@/story/areas';

const AREA = AREAS['domino-high'];
/** How high the ground is under a point — asked, never assumed. */
const at = (x: number, z: number) => groundAt(AREA, x, z);
/** The outer face of the boundary wall, both ways. */
const OUT_X = AREA.bounds.hw + 1;   // 100
const OUT_Z = AREA.bounds.hd + 1;   // 85

export function buildHigh(anisotropy: number): BuiltArea {
  const own = new Owned();
  const root = new THREE.Group();
  root.name = 'domino-high';
  const rnd = seeded(0x5c4d21);
  const lights: THREE.PointLight[] = [];
  /* Lamps that do not answer to the clock: a corridor light is on in the day. */
  const burning: THREE.PointLight[] = [];

  /* ---------------------------------------------------------------- */
  /* what everything is made of                                        */
  /* ---------------------------------------------------------------- */

  /* A forecourt, not a yard: at dirt 0.18 the ground between the gate and the
     building read as mud at every hour, and the brightness of a paved surface
     is in the drawing — a tint can only ever take it further down. */
  const yardTex = surfaceOf(own, () => paving({ dirt: 0.1, vary: 0.26 }), 1, 1, anisotropy);
  const flagTex = surfaceOf(own, () => paving({ dirt: 0.09, vary: 0.22 }), 1, 1, anisotropy);
  const roadTex = surfaceOf(own, asphalt, 1, 1, anisotropy);
  const brickTex = surfaceOf(own, () => brick('#7a6a5b'), 1, 1, anisotropy);
  const renderTex = surfaceOf(own, () => render('#b8ad98'), 1, 1, anisotropy);
  const renderWarm = surfaceOf(own, () => render('#c3b49a'), 1, 1, anisotropy);
  const renderPale = surfaceOf(own, () => render('#cec3ad'), 1, 1, anisotropy);
  const concTex = surfaceOf(own, () => concrete('#9a948b'), 1, 1, anisotropy);
  const woodTex = surfaceOf(own, darkWood, 1, 2, anisotropy);
  const boardTex = surfaceOf(own, woodFloor, 1, 2, anisotropy);
  const shutTex = surfaceOf(own, () => shutter('#6f6357'), 1, 1, anisotropy);
  const soilTex = surfaceOf(own, soil, 1, 1, anisotropy);
  const turfTex = surfaceOf(own, turf, 1, 1, anisotropy);

  /* Tints multiply, so the brightness is in the drawing and the tint is only
     the difference between one surface and its neighbour. */
  const yard = tiled(matt(own, '#f2e9d2', yardTex), 2.2);
  const flags = tiled(matt(own, '#f0e8d2', flagTex), 2.4);
  const road = tiled(matt(own, '#ffffff', roadTex), 4);
  const brickwork = tiled(matt(own, '#ffffff', brickTex), 3);
  const stone = tiled(matt(own, '#ffffff', renderTex), 3);
  const warm = tiled(matt(own, '#ffffff', renderWarm), 3);
  /*
   * The teaching block is *rendered*, not brick.
   *
   * Both of its long faces run east to west, so the corridor elevation — the
   * one you arrive at, the one the drive points at — never sees the sun at
   * any hour of any day. In brick it was black at four in the afternoon and
   * black again at noon, which is the correct answer to the wrong question:
   * a school of this period is pale render on a brick plinth, and pale render
   * in shade is a wall you can see.
   */
  const pale = tiled(matt(own, '#ffffff', renderPale), 3);
  const ashlar = tiled(matt(own, '#ffffff', concTex), 2.6);
  const timber = matt(own, '#7b6449', woodTex);
  const boards = tiled(matt(own, '#ffffff', boardTex), 1.4);
  const kerb = matt(own, '#a09a8e');
  const kerbDark = matt(own, '#7e786d');
  const steel = matt(own, '#6b6c63');
  const steelPale = matt(own, '#8a8779');
  const iron = matt(own, '#55554f');
  const brass = matt(own, '#8f7436');
  const dark = matt(own, '#2c2f33');
  const cream = matt(own, '#d5cbb0');
  const glassPale = matt(own, '#6f7a7c');
  const leaf = matt(own, '#4d5c3c');
  const leafPale = matt(own, '#5c6c46');
  const blossom = matt(own, '#8d7568');
  const bark = matt(own, '#4e4034');
  const earth = tiled(matt(own, '#ffffff', soilTex), 2);
  const grass = tiled(matt(own, '#ffffff', turfTex), 3.2);
  const hoarding = matt(own, '#ffffff', shutTex);
  const chalkboard = matt(own, '#3a4a3f');
  const desk = matt(own, '#b09a72');
  const city = matt(own, '#837d72');
  const paint = decal(own, '#c3b78e');
  const clay = decal(own, '#9c7358');
  const lineWhite = decal(own, '#cfc7b2');
  const lampGlass = glow(own, '#c9954e');
  const windowLight = glow(own, '#9d7f45');
  const roomLight = lit(own, '#a8863f');

  /* ---------------------------------------------------------------- */
  /* the baker                                                         */
  /* ---------------------------------------------------------------- */

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
    const pile = piles.get(key);
    if (pile) { pile.parts.push(geo); pile.boxes.push(box); }
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

  basePlate(own, root, AREA.bounds, '#24211d');

  /* ---------------------------------------------------------------- */
  /* the ground                                                        */
  /* ---------------------------------------------------------------- */

  /*
   * Four surfaces and one of them is grass.
   *
   * The yard is the whole site at zero; the drive up from the gate is asphalt
   * laid on it; the field is turf with a clay track round it; and every
   * building stands a step above the lot. Laid as one slab per surface rather
   * than as a tiled grid, because a plane's UVs run 0 to 1 whatever it
   * measures and `tiled` is what turns that into metres.
   */
  slab(DH_IN.x * 2, DH_IN.z * 2, 0, 0.004, 0, yard);
  /*
   * The drive: in at the gate, down to the hall, and a turning circle in front
   * of it — which is what a coach has to be able to do.
   *
   * Seven metres wide and not fourteen, with a twenty-six metre apron and not
   * a forty-eight: asphalt is the darkest surface in this world and the first
   * thing you see on arriving is the ground in front of you. Laid at the width
   * a car park wants, the whole forecourt was black tarmac at noon under a
   * blue sky, with the paving only showing at the edges of the frame.
   */
  /* And the gateway's own floor, the full width of the opening: the yard stops
     at the wall's inner face and the drive is only seven metres wide, so the
     two metres of ground *inside* the gate had nothing drawn on it. */
  slab(DH_GATE_HALF * 2 + 2, 4.4, DH_GATE, 0.012, -OUT_Z + 1, yard);
  slab(7, 24, DH_GATE, 0.022, -72, road);
  slab(26, 8, DH_GATE, 0.022, -56, road);
  /* The field, and the track round it. */
  slab(DH_FIELD.east - DH_FIELD.west, DH_FIELD.south - DH_FIELD.north,
       (DH_FIELD.west + DH_FIELD.east) / 2, 0.010,
       (DH_FIELD.north + DH_FIELD.south) / 2, grass);
  /* The courtyard is flagged, not paved: it is the one piece of ground here
     that is nobody's route to anywhere. */
  slab(DH_MAIN.hw * 2, 32, 0, 0.016, -22, flags);

  /*
   * The running track, drawn as a course of clay in eight straight pieces.
   *
   * A two-hundred-metre oval is two straights and two ends, and the ends are
   * the thing: drawn as one rectangle the corners are square and the whole
   * field reads as a car park with a red border. Four straights and four
   * corner runs at forty-five degrees is an oval at this distance, and every
   * piece of it is a `decal` so it resolves in front of the turf whatever the
   * depth buffer thinks.
   */
  {
    const T = DH_TRACK;
    const W = 6.4;
    for (const s of [-1, 1] as const) {
      put(T.hw * 2 - 18, 0.008, W, clay, T.x, 0.031, T.z + s * (T.hd - W / 2), { cast: false, group: 'track' });
      put(W, 0.008, T.hd * 2 - 18, clay, T.x + s * (T.hw - W / 2), 0.031, T.z, { cast: false, group: 'track' });
      for (const q of [-1, 1] as const) {
        put(W, 0.008, 26, clay, T.x + s * (T.hw - 4.6), 0.031, T.z + q * (T.hd - 4.6),
            { cast: false, rotY: s * q * Math.PI / 4, group: 'track' });
      }
    }
    /* The lanes on the straights, and the line they all start behind. */
    for (let i = 1; i < 4; i++) {
      for (const s of [-1, 1] as const) {
        put(T.hw * 2 - 20, 0.008, 0.12, lineWhite, T.x, 0.05,
            T.z + s * (T.hd - W + i * (W / 4)), { cast: false, group: 'lanes' });
      }
    }
    put(0.16, 0.008, W, lineWhite, T.x + 12, 0.05, T.z - T.hd + W / 2, { cast: false, group: 'lanes' });
  }

  /* The pitch inside it: a touchline, a halfway line and a centre circle drawn
     as twelve short runs, because a circle of boxes is a circle. */
  {
    const P = { x: -38, z: 45, hw: 30, hd: 18 };
    for (const s of [-1, 1] as const) {
      put(P.hw * 2, 0.008, 0.14, lineWhite, P.x, 0.03, P.z + s * P.hd, { cast: false, group: 'pitch' });
      put(0.14, 0.008, P.hd * 2, lineWhite, P.x + s * P.hw, 0.03, P.z, { cast: false, group: 'pitch' });
    }
    put(0.14, 0.008, P.hd * 2, lineWhite, P.x, 0.03, P.z, { cast: false, group: 'pitch' });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      put(1.6, 0.008, 0.14, lineWhite, P.x + Math.cos(a) * 6, 0.03, P.z + Math.sin(a) * 6,
          { cast: false, rotY: -a + Math.PI / 2, group: 'pitch' });
    }
  }

  /* ---------------------------------------------------------------- */
  /* the boundary and the gate                                         */
  /* ---------------------------------------------------------------- */

  /*
   * A wall you cannot see over and a gate you can.
   *
   * Rendered blockwork with a coping, which is what every school of this kind
   * is walled with, and the north side is broken by the gate: two piers, both
   * leaves rolled back against them, and the school's name on the left-hand
   * one. The leaves are *open* — this is the way to Station Plaza and a door
   * that works behind a shut gate is the fault the station's east exit was.
   */
  {
    const H = 2.6;
    /*
     * The coping overhangs *across* the wall and stops short along it.
     *
     * Four walls each with a coping that overhangs both ways meet at the four
     * corners, and two courses of stone at one height sharing a corner is a
     * flicker you would see from the middle of the field. The plaza's ranges
     * settled this; a boundary wall is the same ring.
     */
    const wall = (x: number, z: number, hw: number, hd: number, along: 'x' | 'z') => {
      put(hw * 2, H, hd * 2, stone, x, H / 2, z, { group: 'wall' });
      put(hw * 2 + (along === 'x' ? 0 : 0.3), 0.24, hd * 2 + (along === 'x' ? 0.3 : 0),
          kerb, x, H + 0.12, z, { group: 'wall' });
    };
    for (const [a, b] of [[-OUT_X, DH_GATE - DH_GATE_HALF], [DH_GATE + DH_GATE_HALF, OUT_X]]) {
      wall((a + b) / 2, -OUT_Z + 1, (b - a) / 2, 1, 'x');
    }
    wall(0, OUT_Z - 1, OUT_X, 1, 'x');
    for (const s of [-1, 1] as const) wall(s * (OUT_X - 1), 0, 1, DH_IN.z - 0.4, 'z');
    /* The piers, the rolled-back leaves, and the name. */
    for (const s of [-1, 1] as const) {
      /* Wider than the wall it ends, and offset — flush, the pier's own face
         and the wall's end face are one plane with four square metres in it. */
      put(1.8, 4.2, 1.8, ashlar, DH_GATE + s * (DH_GATE_HALF + 0.4), 2.1, -OUT_Z + 1);
      put(2.1, 0.34, 2.1, kerb, DH_GATE + s * (DH_GATE_HALF + 0.4), 4.37, -OUT_Z + 1);
      /* A leaf, rolled back along the inside of the wall. */
      put(0.12, 2.2, 4.6, iron, DH_GATE + s * (DH_GATE_HALF + 1.5), 1.2, -OUT_Z + 3.7);
      for (let i = 0; i < 9; i++) {
        put(0.09, 2.0, 0.09, iron, DH_GATE + s * (DH_GATE_HALF + 1.5), 1.1,
            -OUT_Z + 1.6 + i * 0.52);
      }
    }
    /*
     * The name, on the face of the west pier.
     *
     * `put` takes (w, h, d), and this was written 0.12 × 0.9 × 3.24 — three
     * and a quarter metres of board running along *z*, which at a gate in a
     * wall that also runs along z is three and a quarter metres driven
     * straight through the wall behind it. Two and a half of it was inside
     * stone; what you could read from the drive was "DO".
     *
     * A board on a wall is thin in the direction it faces. This one is thin in
     * z and long in x — and no longer than the pier it is bolted to, which is
     * 1.8 m. It sits in the metre and a half of pier that stands above the
     * wall, where a school's name goes.
     *
     * Facing *south*, into the grounds, which is the opposite of where a
     * school puts its name and the only place anybody can read it from: north
     * of the wall is outside the area, the drive is the one long sight line
     * there is, and you walk up it towards the gate every time you leave.
     */
    const NAME_W = 1.5;
    const nameTex = surfaceOf(own, () => signBoard('DOMINO HIGH SCHOOL', '#2f2a24', '#c9bf9e', undefined, 3.6), 1, 1, anisotropy);
    put(NAME_W, NAME_W / 3.6, 0.14, matt(own, '#ffffff', nameTex),
        DH_GATE - (DH_GATE_HALF + 0.4), 3.36, -OUT_Z + 1 + 0.9 + 0.07);
    /* On the pier, not floating over the gateway. */
    for (const s of [-1, 1] as const) {
      put(0.44, 0.5, 0.44, iron, DH_GATE + s * (DH_GATE_HALF + 0.4), 4.74, -OUT_Z + 1);
      put(0.34, 0.22, 0.34, lampGlass, DH_GATE + s * (DH_GATE_HALF + 0.4), 4.66, -OUT_Z + 1);
    }
    const l = new THREE.PointLight('#ffbe78', 90, 16, 2);
    l.position.set(DH_GATE, 3.4, -OUT_Z + 3);
    root.add(l);
    lights.push(l);
  }

  /* ---------------------------------------------------------------- */
  /* the main teaching block                                           */
  /* ---------------------------------------------------------------- */

  /*
   * A hundred and forty-four metres of it, and it is one loop over the bays.
   *
   * Everything here is drawn from `DH_MAIN`, `DH_CORR`, `DH_ROOM` and
   * `dhBay` — the same four numbers the collision in `areas.ts` is written
   * from — so a doorway is in one place and a classroom is nine point six
   * metres wide in one place. Fifteen bays, two floors, and the difference
   * between a bay you can walk into and one you cannot is which list its
   * index is in.
   */
  {
    const FRONT = DH_MAIN.north;      // -52
    const BACK = DH_MAIN.south;       // -38
    const HALL = dhBay(DH_HALL);
    const floors = [DH_FLOOR, DH_UPPER];

    /*
     * The plinth the whole block stands on.
     *
     * Every wall in here starts at the ground floor's own height, which is
     * three hundred millimetres over the yard — so without this there is a
     * thirty-centimetre gap under a hundred and forty-four metres of building
     * and you can see the courtyard through it from the drive.
     */
    put(DH_MAIN.hw * 2, DH_FLOOR, BACK - FRONT, ashlar, 0, DH_FLOOR / 2, (FRONT + BACK) / 2, { group: 'main' });

    /* The shell: four walls in pieces, a floor slab per storey, and a roof. */
    const holeAt = (f: number, i: number): boolean =>
      f === DH_FLOOR ? i === DH_HALL : false;

    for (const f of floors) {
      const top = f + 4.2;
      /* The north wall, bay by bay: a run of windows over the corridor, and a
         doorway where the entrance hall or a stair tower cuts through it. */
      for (let i = 0; i < DH_BAYS; i++) {
        const c = dhBay(i);
        const at = f === DH_UPPER ? DH_TOWERS.find((t) => Math.abs(t - c) < DH_BAY / 2) : undefined;
        if (at !== undefined) {
          /*
           * A tower's doorway is the flight's own width, not the bay's.
           *
           * Drawn as a whole open bay it was nine and a half metres of hole in
           * front of a four-metre-eight opening, and the two and a bit metres
           * either side were wall in the collision with nothing drawn on them.
           * Nobody could see it because nobody could get up here: the towers
           * were unclimbable, so `walls` had never once sampled this floor.
           * It failed on the first run after they opened.
           */
          for (const q of [-1, 1] as const) {
            const a = q < 0 ? c - DH_BAY / 2 : at + DH_FLIGHT.half;
            const b = q < 0 ? at - DH_FLIGHT.half : c + DH_BAY / 2;
            if (b - a > 0.02) {
              put(b - a, top - f, 1, pale, (a + b) / 2, (f + top) / 2, FRONT + 0.5, { group: 'main' });
            }
          }
          put(DH_FLIGHT.half * 2, top - (f + 2.8), 1, pale, at, (f + 2.8 + top) / 2, FRONT + 0.5, { group: 'main' });
          continue;
        }
        if (holeAt(f, i)) {
          /* The head over the opening, and nothing under it. */
          put(DH_BAY, top - (f + 2.8), 1, pale, c, (f + 2.8 + top) / 2, FRONT + 0.5, { group: 'main' });
          continue;
        }
        /* At a stair tower the ground-floor wall stops three hundred
           millimetres short of the storey above it, because that last three
           hundred is the floor of the doorway the tower delivers you through. */
        const cut = f === DH_FLOOR && DH_TOWERS.some((t) => Math.abs(t - c) < DH_BAY / 2)
          ? DH_UPPER - 0.3 : top;
        put(DH_BAY, 1.1, 1, pale, c, f + 0.55, FRONT + 0.5, { group: 'main' });
        /* The corridor's own windows, lit where the pendants are and not where
           they are not — a hundred and forty-four metres of one unbroken glow
           is a strip light, not a building. */
        put(DH_BAY - 0.6, 1.6, 1, i % 2 === 0 ? windowLight : glassPale, c, f + 1.9, FRONT + 0.5, { group: 'main' });
        put(DH_BAY, cut - (f + 2.7), 1, pale, c, (f + 2.7 + cut) / 2, FRONT + 0.5, { group: 'main' });
        /* Glazing bars, so a run of window is a run of windows. */
        for (const q of [-1, 0, 1] as const) {
          put(0.12, 1.5, 1.05, kerb, c + q * 2.4, f + 1.9, FRONT + 0.5, { group: 'main' });
        }
        put(DH_BAY - 0.6, 0.14, 1.18, kerb, c, f + 2.72, FRONT + 0.5, { group: 'main' });
      }
      /* The south wall: the classroom windows, which is where the light is. */
      for (let i = 0; i < DH_BAYS; i++) {
        const c = dhBay(i);
        if (holeAt(f, i)) {
          put(DH_BAY, top - (f + 2.8), 1, pale, c, (f + 2.8 + top) / 2, BACK - 0.5, { group: 'main' });
          continue;
        }
        const on = (i + (f === DH_UPPER ? 1 : 0)) % 3 === 1;
        put(DH_BAY, 0.9, 1, pale, c, f + 0.45, BACK - 0.5, { group: 'main' });
        put(DH_BAY - 0.6, 2.1, 1, on ? windowLight : glassPale, c, f + 1.95, BACK - 0.5, { group: 'main' });
        for (const q of [-1, 1] as const) {
          put(0.12, 2.0, 1.05, kerb, c + q * 2.2, f + 1.95, BACK - 0.5, { group: 'main' });
        }
        put(DH_BAY, top - (f + 3), 1, pale, c, (f + 3 + top) / 2, BACK - 0.5, { group: 'main' });
        put(DH_BAY - 0.6, 0.16, 1.2, kerb, c, f + 3.08, BACK - 0.5, { group: 'main' });
      }
      /*
       * The piers between one window and the next, centred on the bay
       * boundary rather than offset inside it.
       *
       * Written at `c + DH_BAY / 2 - 0.3` a pier overlapped the *next* bay's
       * glass by three hundred millimetres, sharing its top and bottom planes
       * — fifteen bays, two floors, one elevation of it.
       */
      for (let k = 0; k <= DH_BAYS; k++) {
        const xb = -DH_INNER + DH_BAY * k;
        const end = k === 0 || k === DH_BAYS;
        const pw = end ? 0.3 : 0.6;
        const px = k === 0 ? xb + 0.15 : k === DH_BAYS ? xb - 0.15 : xb;
        put(pw, 2.1, 1.02, pale, px, f + 1.95, BACK - 0.5, { group: 'main' });
        const atTower = f === DH_UPPER && DH_TOWERS.some((t) => Math.abs(t - px) < DH_BAY / 2);
        const atHall = f === DH_FLOOR && Math.abs(px - HALL) < DH_BAY / 2;
        if (!atTower && !atHall) {
          put(pw, 1.6, 1.02, pale, px, f + 1.9, FRONT + 0.5, { group: 'main' });
        }
      }
      /* The two ends, outboard of every bay. */
      for (const s of [-1, 1] as const) {
        put(DH_MAIN.hw - DH_INNER, 4.2, BACK - FRONT, pale,
            s * (DH_MAIN.hw + DH_INNER) / 2, f + 2.1, (FRONT + BACK) / 2, { group: 'main' });
      }
      /* The floor of this storey, and the ceiling of the one under it. */
      slab(DH_INNER * 2, BACK - FRONT - 2, 0, f + 0.02, (FRONT + BACK) / 2,
           f === DH_FLOOR ? flags : boards);
      if (f === DH_UPPER) {
        /* The ceiling of the storey under this one — and it stops short of the
           floor it hangs from, because every wall in that storey tops out at
           the same 4.5 and a ceiling that reaches it shares a plane with all
           of them. */
        put(DH_INNER * 2 - 0.4, 0.24, BACK - FRONT - 2.4, cream, 0, f - 0.18, (FRONT + BACK) / 2, { group: 'main' });
      }
    }
    /* The roof, its parapet, and the string course between the floors. */
    put(DH_MAIN.hw * 2 + 0.4, 0.4, BACK - FRONT + 0.4, kerbDark, 0, DH_EAVES - 0.2, (FRONT + BACK) / 2, { group: 'main' });
    put(DH_MAIN.hw * 2 + 0.7, 0.5, BACK - FRONT + 0.7, kerb, 0, DH_EAVES + 0.25, (FRONT + BACK) / 2, { group: 'main' });
    put(DH_MAIN.hw * 2 + 0.34, 0.26, BACK - FRONT + 0.34, kerb, 0, DH_UPPER - 0.4, (FRONT + BACK) / 2, { group: 'main' });

    /*
     * Inside: the corridor wall, bay by bay.
     *
     * A classroom front is a sliding door, a run of frosted glass over a dado,
     * and a name plate — and whether you can open it is whether the bay's
     * index is in `DH_OPEN`. What is drawn for a shut one is a door; what is
     * drawn for an open one is a doorway, and `areas.ts` cuts the collision at
     * the same two numbers.
     */
    const roomNames = ['1-A', '1-B', '1-C', '1-D', '2-A', '2-B', '2-C', 'STAFF',
                       '2-D', '3-A', '3-B', '3-C', '3-D', 'MUSIC', 'ART'];
    const plate = roomNames.map((n) => matt(own, '#ffffff',
      surfaceOf(own, () => signBoard(n, '#e6d8b4', '#33302a', undefined, 1.6), 1, 1, anisotropy)));
    for (const f of floors) {
      const open = f === DH_FLOOR ? DH_OPEN : DH_OPEN_UP;
      for (let i = 0; i < DH_BAYS; i++) {
        if (i === DH_HALL) continue;
        const c = dhBay(i);
        const isOpen = open.includes(i);
        /*
         * Three bands and nothing overlaps: dado to nine hundred, the opening
         * to three point one, the head to the ceiling.
         *
         * Every piece of a corridor wall is in the *same plane* — that is what
         * a wall is — so the only thing keeping them off each other's faces is
         * that no two of them share any height. Written to overlap by two
         * hundred millimetres they did, fifteen bays by two floors of it.
         */
        const z = DH_ROOM.north - 0.15;
        put(DH_BAY, 1.1, 0.3, warm, c, f + 3.65, z, { group: 'main' });
        if (isOpen) {
          /* A doorway, with the door slid back against the glass beside it. */
          for (const q of [-1, 1] as const) {
            put(DH_BAY / 2 - 0.9, 0.9, 0.3, warm, c + q * (DH_BAY / 4 + 0.45), f + 0.45, z, { group: 'main' });
            put(DH_BAY / 2 - 0.9, 2.2, 0.3, glassPale, c + q * (DH_BAY / 4 + 0.45), f + 2.0, z, { group: 'main' });
          }
          put(0.1, 2.0, 0.36, timber, c + 0.9, f + 2.0, z, { group: 'main' });
        } else {
          put(DH_BAY, 0.9, 0.3, warm, c, f + 0.45, z, { group: 'main' });
          put(DH_BAY - 1.8, 0.9, 0.3, timber, c, f + 1.35, z, { group: 'main' });
          put(DH_BAY - 1.8, 1.3, 0.3, glassPale, c, f + 2.45, z, { group: 'main' });
          put(0.12, 2.0, 0.36, timber, c, f + 2.0, z, { group: 'main' });
          for (const q of [-1, 1] as const) {
            put(0.9, 2.2, 0.3, warm, c + q * (DH_BAY / 2 - 0.45), f + 2.0, z, { group: 'main' });
          }
        }
        /* The name plate over it. */
        put(1.6, 0.4, 0.1, plate[i % plate.length], c - DH_BAY / 2 + 1.1, f + 3.4, z - 0.26, { group: `plate${i % plate.length}` });
      }
      /* The wall between one classroom and the next. */
      for (let k = 1; k < DH_BAYS; k++) {
        put(0.3, 4.2, DH_ROOM.south - DH_ROOM.north, warm,
            -DH_INNER + DH_BAY * k, f + 2.1, (DH_ROOM.north + DH_ROOM.south) / 2, { group: 'main' });
      }
      /* And the corridor's own lights, every other bay, on all day. */
      for (let i = 0; i < DH_BAYS; i += 2) {
        const c = dhBay(i);
        put(2.4, 0.12, 0.36, lampGlass, c, f + 3.55, (DH_CORR.north + DH_CORR.south) / 2, { group: 'main' });
        const l = new THREE.PointLight('#ffdca8', 70, 14, 2);
        l.position.set(c, f + 3.3, (DH_CORR.north + DH_CORR.south) / 2);
        root.add(l);
        lights.push(l);
        burning.push(l);
      }
    }

    /*
     * What is in a classroom you can walk into.
     *
     * Thirty desks in five rows, a blackboard, a teacher's table and a clock —
     * and every one of them drawn from the bay's own centre line, so a room is
     * a room wherever the loop puts it.
     */
    for (const f of floors) {
      for (const i of f === DH_FLOOR ? DH_OPEN : DH_OPEN_UP) {
        const c = dhBay(i);
        const zc = (DH_ROOM.north + DH_ROOM.south) / 2;
        slab(DH_BAY - 0.4, DH_ROOM.south - DH_ROOM.north - 0.4, c, f + 0.032, zc, boards);
        put(DH_BAY - 1.4, 1.2, 0.1, chalkboard, c, f + 1.5, DH_ROOM.north + 0.06, { group: 'rooms' });
        put(DH_BAY - 1.2, 0.12, 0.16, timber, c, f + 0.84, DH_ROOM.north + 0.1, { group: 'rooms' });
        put(1.7, 0.06, 0.8, desk, c, f + 0.76, DH_ROOM.north + 1.2, { group: 'rooms' });
        for (const s of [-1, 1] as const) {
          put(0.08, 0.74, 0.08, iron, c + s * 0.7, f + 0.38, DH_ROOM.north + 1.2, { group: 'rooms' });
        }
        /* The desks, from the very list the collision is written from. */
        for (const d of DH_DESKS) {
          const dx = c + d.dx;
          const dz = DH_ROOM.north + d.dz;
          put(1.1, 0.05, 0.55, desk, dx, f + 0.72, dz, { group: 'rooms' });
          for (const s of [-1, 1] as const) {
            put(0.06, 0.7, 0.06, iron, dx + s * 0.48, f + 0.35, dz, { group: 'rooms' });
          }
          put(0.42, 0.05, 0.42, timber, dx, f + 0.44, dz + 0.42, { group: 'rooms' });
          put(0.4, 0.5, 0.06, timber, dx, f + 0.69, dz + 0.6, { group: 'rooms' });
        }
        /* The light on, because somebody left it on. */
        put(2.6, 0.12, 1.0, roomLight, c, f + 3.5, zc, { group: 'rooms' });
        const l = new THREE.PointLight('#ffe0b0', 90, 13, 2);
        l.position.set(c, f + 3.2, zc);
        root.add(l);
        lights.push(l);
        burning.push(l);
      }
    }

    /*
     * Four lamps on the building itself — two over the drive, two over the
     * courtyard.
     *
     * A hundred and forty-four metres of elevation with nothing on it is a
     * hundred and forty-four metres of brick, and at four in the afternoon
     * both of these faces are in their own shadow. A bracket lamp every thirty
     * metres is what a school has and what makes the wall read as a building.
     */
    for (const bx of [-36, 36]) {
      for (const [zz, dir] of [[FRONT - 0.1, -1], [BACK + 0.1, 1]] as const) {
        put(0.3, 0.5, 0.9, iron, bx, DH_UPPER + 0.9, zz + dir * 0.45, { group: 'main' });
        put(0.5, 0.34, 0.5, iron, bx, DH_UPPER + 0.72, zz + dir * 0.8, { group: 'main' });
        put(0.4, 0.2, 0.4, lampGlass, bx, DH_UPPER + 0.53, zz + dir * 0.8, { group: 'main' });
        const l = new THREE.PointLight('#ffbe78', 150, 20, 2);
        l.position.set(bx, DH_UPPER + 0.4, zz + dir * 1.2);
        root.add(l);
        lights.push(l);
        burning.push(l);
      }
    }

    /*
     * The entrance hall, which is the middle bay and goes straight through.
     *
     * Shoe lockers down both sides, a noticeboard, and the school's crest on
     * the floor — the one thing in this building you are meant to stop at.
     */
    {
      slab(DH_BAY - 0.4, BACK - FRONT - 2, HALL, DH_FLOOR + 0.032, (FRONT + BACK) / 2, flags);
      for (const s of [-1, 1] as const) {
        for (let k = 0; k < 4; k++) {
          const zz = DH_ROOM.north + 0.9 + k * 2.0;
          put(0.5, 2.0, 1.8, steelPale, HALL + s * (DH_BAY / 2 - 0.4), DH_FLOOR + 1.0, zz, { group: 'hall' });
          for (let d = 0; d < 4; d++) {
            put(0.06, 0.42, 1.66, dark, HALL + s * (DH_BAY / 2 - 0.68), DH_FLOOR + 0.35 + d * 0.46, zz, { group: 'hall' });
          }
        }
      }
      const noticeTex = surfaceOf(own, () => signBoard('DOMINO HIGH', '#e6d8b4', '#33302a', 'EST. 1954', 3.2), 1, 1, anisotropy);
      put(3.2, 1.0, 0.1, matt(own, '#ffffff', noticeTex), HALL, DH_FLOOR + 2.5, FRONT + 1.05, { group: 'hall' });
      /* A light has a fixture or it does not exist. */
      for (const zz of [FRONT + 3.5, BACK - 3.5]) {
        put(2.2, 0.12, 0.5, lampGlass, HALL, DH_FLOOR + 3.6, zz, { group: 'hall' });
      }
      const l = new THREE.PointLight('#ffdca8', 110, 15, 2);
      l.position.set(HALL, DH_FLOOR + 3.2, (FRONT + BACK) / 2);
      root.add(l);
      lights.push(l);
      burning.push(l);
    }
  }

  /* ---------------------------------------------------------------- */
  /* the stair towers                                                  */
  /* ---------------------------------------------------------------- */

  /*
   * The only way to the first floor, and outside the block on purpose.
   *
   * A flight in a corridor is a hole you fall down; a flight in a tower on the
   * north face is a thing you can see from the forecourt and walk into. You go
   * up from the yard and come out at the top *inside* the corridor, which is
   * why the block's north wall has a doorway in it on the first floor and a
   * window on the ground.
   */
  for (const c of DH_TOWERS) {
    const g = { group: `tower${c}` };
    for (const s of [-1, 1] as const) {
      put(0.3, DH_UPPER + 3.4, DH_TOWER.south - DH_TOWER.north, stone,
          c + s * (DH_TOWER.hw - 0.15), (DH_UPPER + 3.4) / 2, (DH_TOWER.north + DH_TOWER.south) / 2, g);
    }
    /* The tower's own floor, which is the step up off the yard every building
       here stands on — and without it two thousand cells of tower were a
       duelist standing three hundred millimetres over the ground. */
    put(DH_TOWER.hw * 2 - 0.3, DH_FLOOR - 0.02, 9.5, ashlar, c, (DH_FLOOR - 0.02) / 2, -56.55, g);
    /* The treads, read off the very platforms the collision answers with, and
       standing on that floor rather than through it. */
    for (const t of DH_FLIGHT_STEPS) {
      if (Math.abs(t.x - c) > 0.5) continue;
      put(t.hw * 2, t.y - DH_FLOOR, t.hd * 2, ashlar, t.x, (t.y + DH_FLOOR) / 2, t.z, g);
      put(t.hw * 2, 0.05, 0.16, kerb, t.x, t.y - 0.03, t.z - t.hd + 0.1, g);
    }
    /* The landing at the top, its floor and the rail along the open side. */
    put(DH_FLIGHT.half * 2, 0.3, 1.2, ashlar, c, DH_UPPER - 0.15, -52.6, g);
    put(DH_TOWER.hw * 2, 0.3, DH_TOWER.south - DH_TOWER.north, kerbDark, c,
        DH_UPPER + 3.55, (DH_TOWER.north + DH_TOWER.south) / 2, g);
    /* The rail steps with the flight, tread by tread.
       One slab at a fixed height is a brass wall beside a staircase, which is
       what this was until somebody looked at it. */
    for (const t of DH_FLIGHT_STEPS) {
      if (Math.abs(t.x - c) > 0.5) continue;
      for (const s of [-1, 1] as const) {
        put(0.12, 0.9, t.hd * 2, brass, c + s * (DH_FLIGHT.half + 0.06), t.y + 0.45, t.z, g);
      }
    }
    /* The doorway through the block's north wall at first-floor level, which is
       where the tower delivers you — floor in it, or a metre of nothing. */
    put(DH_FLIGHT.half * 2, 0.3, 1, ashlar, c, DH_UPPER - 0.15, DH_MAIN.north + 0.5, g);
    /* And a lamp under the tower's own roof. */
    put(1.2, 0.1, 0.5, lampGlass, c, DH_UPPER + 3.3, -56, g);
    const l = new THREE.PointLight('#ffdca8', 60, 12, 2);
    l.position.set(c, DH_UPPER + 3.0, -56);
    root.add(l);
    lights.push(l);
    burning.push(l);
  }

  /* ---------------------------------------------------------------- */
  /* the special block and its library                                 */
  /* ---------------------------------------------------------------- */

  {
    const N = DH_SPECIAL.north;
    const S = DH_SPECIAL.south;
    const H = 5.4;
    for (const [a, b] of [[-DH_SPECIAL.hw, -DH_LIBRARY.hw], [DH_LIBRARY.hw, DH_SPECIAL.hw]]) {
      const c = (a + b) / 2;
      const w = b - a;
      put(w, H, S - N, warm, c, H / 2, (N + S) / 2, { group: 'special' });
      /* A run of windows along the courtyard side, and shutters on two of them. */
      const bays = Math.max(1, Math.round(w / 6.4));
      for (let i = 0; i < bays; i++) {
        const bx = a + (w / bays) * (i + 0.5);
        put(w / bays - 1.6, 2.2, 0.3, i % 3 === 0 ? hoarding : glassPale, bx, 2.3, N - 0.1, { group: 'special' });
        put(w / bays - 1.2, 0.18, 0.5, kerb, bx, 3.55, N - 0.16, { group: 'special' });
      }
    }
    /* The library: a doorway with a head over it, and the room behind it —
       drawn in the same three pieces the collision is cut into. */
    for (const [a, b] of [[-DH_LIBRARY.hw, -1.4], [1.4, DH_LIBRARY.hw]]) {
      put(b - a, H, 0.4, warm, (a + b) / 2, H / 2, N + 0.2, { group: 'special' });
    }
    put(2.8, H - 2.6, 0.4, warm, 0, (2.6 + H) / 2, N + 0.2, { group: 'special' });
    put(3.4, 0.3, 0.7, kerb, 0, 2.7, N + 0.1, { group: 'special' });
    put(DH_LIBRARY.hw * 2, H, 0.4, warm, 0, H / 2, S - 0.2, { group: 'special' });
    /* Between the library's own front and back, not across their ends. */
    for (const s of [-1, 1] as const) {
      put(0.4, H, S - N - 0.8, warm, s * (DH_LIBRARY.hw - 0.2), H / 2, (N + S) / 2, { group: 'special' });
    }
    put(DH_SPECIAL.hw * 2 + 0.6, 0.44, S - N + 0.6, kerb, 0, H + 0.22, (N + S) / 2, { group: 'special' });
    slab(DH_LIBRARY.hw * 2 - 0.8, S - N - 0.8, 0, DH_FLOOR + 0.02, (N + S) / 2, boards);
    put(DH_LIBRARY.hw * 2 - 0.8, DH_FLOOR, S - N - 0.8, ashlar, 0, DH_FLOOR / 2, (N + S) / 2, { group: 'special' });
    put(2.8, DH_FLOOR, 0.4, ashlar, 0, DH_FLOOR / 2, N + 0.2, { group: 'special' });
    /* Stacks down both ends, tables in the middle, and the lamps on them. */
    for (const s of [-1, 1] as const) {
      for (let k = 0; k < 4; k++) {
        const sx = s * (5.4 + k * 3.2);
        /*
         * A stack is a back and two sides of shelving, not a solid block.
         *
         * Drawn as one 0.6 m carcass with the shelves inside it, every board
         * and every book was buried in timber and what you saw was a wardrobe.
         * The back panel is a hundred millimetres; everything else hangs off it
         * and faces the room.
         */
        put(0.1, 2.1, 6.28, timber, sx, DH_FLOOR + 1.05, (N + S) / 2, { group: 'library' });
        put(0.62, 0.1, 6.2, timber, sx, DH_FLOOR + 2.15, (N + S) / 2, { group: 'library' });
        /* Ends, not sides. Panels down the long faces are exactly where the
           books are, and six centimetres of timber in front of four hundred of
           book is a wardrobe with a cream stripe on it. */
        for (const e of [-1, 1] as const) {
          put(0.62, 2.1, 0.06, timber, sx, DH_FLOOR + 1.05, (N + S) / 2 + e * 3.2, { group: 'library' });
        }
        for (const q of [-1, 1] as const) {
          for (let r = 0; r < 4; r++) {
            const by = DH_FLOOR + 0.45 + r * 0.5;
            put(0.44, 0.06, 6.0, cream, sx + q * 0.24, by, (N + S) / 2, { group: 'library' });
            for (let b = 0; b < 6; b++) {
              const run = 0.55 + rnd() * 0.3;
              put(0.4, 0.4, run, [leaf, blossom, kerbDark, brass][b % 4],
                  sx + q * 0.24, by + 0.23, (N + S) / 2 - 2.4 + b * 0.96, { group: 'library' });
            }
          }
        }
      }
    }
    for (const s of [-1, 1] as const) {
      put(3.4, 0.08, 1.2, desk, s * 2, DH_FLOOR + 0.76, (N + S) / 2, { group: 'library' });
      for (const q of [-1, 1] as const) {
        put(0.08, 0.72, 0.08, iron, s * 2 + q * 1.5, DH_FLOOR + 0.36, (N + S) / 2, { group: 'library' });
      }
      put(0.5, 0.1, 0.5, lampGlass, s * 2, DH_FLOOR + 1.0, (N + S) / 2, { group: 'library' });
    }
    for (const lx of [-8, 8]) {
      put(2.6, 0.14, 0.6, lampGlass, lx, DH_FLOOR + 3.9, (N + S) / 2, { group: 'library' });
    }
    const l = new THREE.PointLight('#ffdca8', 130, 18, 2);
    l.position.set(0, DH_FLOOR + 3.4, (N + S) / 2);
    root.add(l);
    lights.push(l);
    burning.push(l);
    const libTex = surfaceOf(own, () => signBoard('LIBRARY', '#e6d8b4', '#33302a', undefined, 2.6), 1, 1, anisotropy);
    put(2.6, 1.0, 0.1, matt(own, '#ffffff', libTex), 0, 4.2, N - 0.06, { group: 'special' });
  }

  /* ---------------------------------------------------------------- */
  /* the gymnasium                                                     */
  /* ---------------------------------------------------------------- */

  /*
   * One volume, and the biggest room in the city: forty-seven metres by
   * thirty-one and eleven to the trusses. What makes it read as a gym rather
   * than a shed is the *floor* — a sprung board floor with the lines painted
   * on it — and the fact that the light comes in high, from a clerestory you
   * cannot see out of.
   */
  {
    const G = DH_GYM;
    const cx = (G.west + G.east) / 2;
    const cz = (G.north + G.south) / 2;
    const w = G.east - G.west;
    const d = G.south - G.north;
    /* Walls, with the doorway on the courtyard side. */
    for (const [a, b] of [[G.north, DH_GYM_DOOR.z - DH_GYM_DOOR.half], [DH_GYM_DOOR.z + DH_GYM_DOOR.half, G.south]]) {
      put(0.8, G.high, b - a, brickwork, G.west + 0.4, G.high / 2, (a + b) / 2, { group: 'gym' });
    }
    put(0.8, G.high - 3.4, DH_GYM_DOOR.half * 2, brickwork, G.west + 0.4,
        (3.4 + G.high) / 2, DH_GYM_DOOR.z, { group: 'gym' });
    put(0.8, G.high, d, brickwork, G.east - 0.4, G.high / 2, cz, { group: 'gym' });
    for (const s of [-1, 1] as const) {
      put(w - 1.6, G.high, 0.8, brickwork, cx, G.high / 2, s < 0 ? G.north + 0.4 : G.south - 0.4, { group: 'gym' });
    }
    /* The clerestory, which is where the light comes from. */
    for (const s of [-1, 1] as const) {
      for (let i = 0; i < 6; i++) {
        put(w / 7, 1.6, 0.84, glassPale, G.west + (w / 7) * (i + 1), G.high - 1.8,
            s < 0 ? G.north + 0.4 : G.south - 0.4, { group: 'gym' });
      }
    }
    /* The roof, its trusses and its parapet. */
    put(w + 0.8, 0.5, d + 0.8, kerbDark, cx, G.high + 0.25, cz, { group: 'gym' });
    put(w + 1.2, 0.44, d + 1.2, kerb, cx, G.high + 0.72, cz, { group: 'gym' });
    for (let i = 0; i < 7; i++) {
      put(w - 1.6, 0.6, 0.36, steel, cx, G.high - 0.6, G.north + 2 + i * ((d - 4) / 6), { group: 'gym' });
    }
    /* The floor, its lines, and the stage at the far end. */
    slab(w - 1.6, d - 1.6, cx, DH_FLOOR + 0.02, cz, boards);
    put(w - 1.6, DH_FLOOR, d - 1.6, ashlar, cx, DH_FLOOR / 2, cz, { group: 'gym' });
    put(0.8, DH_FLOOR, DH_GYM_DOOR.half * 2, ashlar, G.west + 0.4, DH_FLOOR / 2, DH_GYM_DOOR.z, { group: 'gym' });
    for (const s of [-1, 1] as const) {
      put(w - 8, 0.008, 0.1, paint, cx, DH_FLOOR + 0.05, cz + s * 12, { cast: false, group: 'court' });
      put(0.1, 0.008, 24, paint, cx + s * 18, DH_FLOOR + 0.05, cz, { cast: false, group: 'court' });
    }
    put(0.1, 0.008, 24, paint, cx, DH_FLOOR + 0.05, cz, { cast: false, group: 'court' });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      put(1.1, 0.008, 0.1, paint, cx + Math.cos(a) * 3.6, DH_FLOOR + 0.033, cz + Math.sin(a) * 3.6,
          { cast: false, rotY: -a + Math.PI / 2, group: 'court' });
    }
    put(10, 1.0, d - 4, timber, G.east - 5.4, DH_FLOOR + 0.5, cz, { group: 'gym' });
    put(10.4, 0.14, d - 3.6, boards, G.east - 5.4, DH_FLOOR + 1.07, cz, { group: 'gym' });
    /* Two hoops, on their own frames. */
    for (const s of [-1, 1] as const) {
      put(0.24, 4.2, 0.24, steel, cx + s * 19, DH_FLOOR + 2.1, cz, { group: 'gym' });
      put(1.9, 1.1, 0.14, cream, cx + s * 17.6, DH_FLOOR + 3.6, cz, { group: 'gym' });
      put(0.1, 0.1, 0.9, brass, cx + s * 17.2, DH_FLOOR + 3.05, cz, { group: 'gym' });
    }
    /* Wall bars along the north side, and the lights over the court. */
    for (let i = 0; i < 5; i++) {
      const bx = G.west + 8 + i * 6;
      put(2.6, 2.6, 0.16, timber, bx, DH_FLOOR + 1.4, G.north + 0.9, { group: 'gym' });
      for (let r = 0; r < 8; r++) {
        put(2.4, 0.08, 0.3, cream, bx, DH_FLOOR + 0.4 + r * 0.3, G.north + 0.82, { group: 'gym' });
      }
    }
    for (const s of [-1, 1] as const) {
      for (const q of [-1, 1] as const) {
        put(2.4, 0.16, 1.2, lampGlass, cx + s * 12, G.high - 1.4, cz + q * 8, { group: 'gym' });
        const l = new THREE.PointLight('#ffe4bc', 220, 26, 2);
        l.position.set(cx + s * 12, G.high - 1.9, cz + q * 8);
        root.add(l);
        lights.push(l);
        burning.push(l);
      }
    }
    const gymTex = surfaceOf(own, () => signBoard('GYMNASIUM', '#e6d8b4', '#33302a', undefined, 3.0), 1, 1, anisotropy);
    put(0.1, 1.0, 3.0, matt(own, '#ffffff', gymTex), G.west - 0.06, 5.2, DH_GYM_DOOR.z, { group: 'gym' });
  }

  /* ---------------------------------------------------------------- */
  /* the pool                                                          */
  /* ---------------------------------------------------------------- */

  {
    const P = DH_POOL;
    const cx = (P.west + P.east) / 2;
    const cz = (P.north + P.south) / 2;
    /*
     * The deck in four strips round the water, which is exactly the four
     * platforms `areas.ts` writes.
     *
     * Laid as one slab over the whole enclosure it is a floor drawn across a
     * swimming pool: `npm run footing` stood a duelist inside three hundred
     * millimetres of concrete over the deep end.
     */
    for (const s of [-1, 1] as const) {
      slab(P.east - P.west, 3.65, cx, DH_FLOOR + 0.02, cz + s * 8.175, ashlar);
      slab(7.15, 12.7, cx + s * 16.425, DH_FLOOR + 0.02, cz, ashlar);
    }
    /* And its mass in the same four strips: one block under the enclosure is
       three hundred millimetres of concrete drawn across the deep end. */
    for (const s of [-1, 1] as const) {
      put(P.east - P.west, DH_FLOOR, 3.65, ashlar, cx, DH_FLOOR / 2, cz + s * 8.175, { group: 'pool' });
      put(7.15, DH_FLOOR, 12.7, ashlar, cx + s * 16.425, DH_FLOOR / 2, cz, { group: 'pool' });
    }
    for (const s of [-1, 1] as const) {
      put(25.7, 0.36, 0.7, kerb, cx, DH_FLOOR + 0.18, cz + s * 6.35, { group: 'pool' });
      put(0.7, 0.36, 12, kerb, cx + s * 12.85, DH_FLOOR + 0.18, cz, { group: 'pool' });
    }
    slab(25, 12, cx, 0.05, cz, matt(own, '#4e6f76'));
    for (let i = 1; i < 6; i++) {
      put(25, 0.02, 0.12, lineWhite, cx, 0.06, cz - 6 + i * 2, { cast: false, group: 'lanes2' });
    }
    /* The fence round it, with the gate at the north. */
    const fence = (x: number, z: number, hw: number, hd: number) => {
      put(hw * 2, 0.1, hd * 2, steel, x, DH_FLOOR + 2.0, z, { group: 'poolfence' });
      const n = Math.max(2, Math.round(Math.max(hw, hd) / 0.6));
      for (let i = 0; i <= n; i++) {
        const t = -1 + (2 / n) * i;
        put(0.06, 2.0, 0.06, steel, x + (hw > hd ? t * hw : 0), DH_FLOOR + 1.0,
            z + (hw > hd ? 0 : t * hd), { group: 'poolfence' });
      }
    };
    for (const [a, b] of [[P.west, 54], [58, P.east]]) fence((a + b) / 2, P.north + 0.06, (b - a) / 2, 0.06);
    fence(cx, P.south - 0.06, (P.east - P.west) / 2, 0.06);
    for (const s of [-1, 1] as const) {
      fence(s < 0 ? P.west + 0.06 : P.east - 0.06, cz, 0.06, (P.south - P.north) / 2 - 0.12);
    }
  }

  /* ---------------------------------------------------------------- */
  /* the covered walkways                                              */
  /* ---------------------------------------------------------------- */

  for (const x of DH_WALKS) {
    put(3.4, 0.24, 32, kerbDark, x, 3.3, -22, { group: `walk${x}` });
    put(3.0, 0.14, 31.6, cream, x, 3.14, -22, { group: `walk${x}` });
    for (const z of [-34, -26, -18, -10]) {
      put(0.44, 3.1, 0.44, ashlar, x, 1.55, z, { group: `walk${x}` });
      put(0.6, 0.2, 0.6, kerb, x, 3.1, z, { group: `walk${x}` });
    }
  }

  /* ---------------------------------------------------------------- */
  /* what stands on the ground                                         */
  /* ---------------------------------------------------------------- */

  const things: Record<HighThing['kind'], (t: HighThing) => void> = {
    tree: (t) => {
      const g = { group: `tree${t.x}:${t.z}` };
      const y = at(t.x, t.z);
      put(1.6, 0.1, 1.6, earth, t.x, y + 0.02, t.z, { ...g, cast: false });
      put(0.44, 4.0, 0.44, bark, t.x, y + 2.0, t.z, g);
      /* Cherry, so the canopy is pale and the mass is four turned slabs. */
      for (let i = 0; i < 4; i++) {
        const sz = 5.6 - i * 1.1;
        put(sz, 1.4, sz, i % 2 ? blossom : leafPale, t.x, y + 4.2 + i * 1.0, t.z,
            { ...g, rotY: 0.4 + i * 0.7 });
      }
    },
    bench: (t) => {
      const g = { group: `bench${t.x}:${t.z}` };
      const y = at(t.x, t.z);
      const across = t.turn === Math.PI / 2;
      const w = (a: number, b: number) => (across ? b : a);
      put(w(t.hw * 2, 0.5), 0.34, w(0.5, t.hd * 2), kerbDark, t.x, y + 0.17, t.z, g);
      put(w(t.hw * 2 - 0.2, 0.5), 0.1, w(0.5, t.hd * 2 - 0.2), timber, t.x, y + 0.78, t.z, g);
      put(w(t.hw * 2 - 0.2, 0.1), 0.5, w(0.1, t.hd * 2 - 0.2), timber, t.x, y + 1.1, t.z, g);
    },
    lamp: (t) => {
      const g = { group: `lamp${t.x}:${t.z}` };
      const y = at(t.x, t.z);
      put(0.56, 0.3, 0.56, kerbDark, t.x, y + 0.15, t.z, g);
      put(0.26, 5.2, 0.26, iron, t.x, y + 2.9, t.z, g);
      put(0.4, 0.3, 0.4, iron, t.x, y + 5.65, t.z, g);
      put(0.8, 0.44, 0.8, iron, t.x, y + 5.98, t.z, g);
      put(0.6, 0.22, 0.6, lampGlass, t.x, y + 5.75, t.z, g);
      const l = new THREE.PointLight('#ffbe78', 190, 24, 2);
      l.position.set(t.x, y + 5.6, t.z);
      root.add(l);
      lights.push(l);
    },
    bin: (t) => {
      const g = { group: `bin${t.x}:${t.z}` };
      const y = at(t.x, t.z);
      put(t.hw * 2, 0.9, t.hd * 2, steel, t.x, y + 0.45, t.z, g);
      put(t.hw * 2 + 0.12, 0.14, t.hd * 2 + 0.12, steelPale, t.x, y + 0.97, t.z, g);
      put(t.hw * 2 - 0.3, 0.1, t.hd * 2 - 0.3, dark, t.x, y + 1.03, t.z, g);
    },
    planter: (t) => {
      const g = { group: `plant${t.x}:${t.z}` };
      const y = at(t.x, t.z);
      put(t.hw * 2, 0.6, t.hd * 2, ashlar, t.x, y + 0.3, t.z, g);
      put(t.hw * 2 + 0.16, 0.16, t.hd * 2 + 0.16, kerb, t.x, y + 0.68, t.z, g);
      put(t.hw * 2 - 0.5, 0.12, t.hd * 2 - 0.5, earth, t.x, y + 0.62, t.z, { ...g, cast: false });
      for (let i = 0; i < 6; i++) {
        put(0.8, 0.7, 0.8, rnd() > 0.5 ? leaf : leafPale,
            t.x + (rnd() - 0.5) * (t.hw * 2 - 1.2), y + 1.0,
            t.z + (rnd() - 0.5) * (t.hd * 2 - 1.2), { ...g, rotY: rnd() * 2 });
      }
    },
    bikeShed: (t) => {
      const g = { group: `shed${t.x}` };
      const y = at(t.x, t.z);
      put(t.hw * 2 + 0.6, 0.2, t.hd * 2 + 0.6, kerbDark, t.x, y + 2.5, t.z, g);
      put(t.hw * 2 + 0.2, 0.14, t.hd * 2 + 0.2, steelPale, t.x, y + 2.34, t.z, g);
      for (const sx of [-1, 1] as const) {
        for (let k = 0; k < 4; k++) {
          put(0.14, 2.4, 0.14, steel, t.x + sx * (t.hw - 0.3), y + 1.2,
              t.z - t.hd + 1.2 + k * ((t.hd * 2 - 2.4) / 3), g);
        }
      }
      /* The racks, and a bicycle in most of them. */
      for (let k = 0; k < 9; k++) {
        const bz = t.z - t.hd + 1.4 + k * ((t.hd * 2 - 2.8) / 8);
        put(t.hw * 2 - 1.6, 0.1, 0.1, steel, t.x, y + 0.3, bz, g);
        if ((k + (t.x < 0 ? 0 : 1)) % 3 === 0) continue;
        put(1.7, 0.08, 0.1, dark, t.x - 0.2, y + 0.66, bz, g);
        for (const s of [-1, 1] as const) {
          put(0.6, 0.6, 0.06, iron, t.x - 0.2 + s * 0.6, y + 0.34, bz, g);
        }
        put(0.5, 0.1, 0.3, dark, t.x - 0.85, y + 0.86, bz, g);
        put(0.08, 0.6, 0.08, iron, t.x + 0.4, y + 0.62, bz, g);
      }
      const tex = surfaceOf(own, () => signBoard(t.tag ?? 'A', '#2f2a24', '#c9bf9e', undefined, 1), 1, 1, anisotropy);
      put(0.7, 0.7, 0.08, matt(own, '#ffffff', tex), t.x, y + 2.0, t.z - t.hd - 0.05, { group: `shedsign${t.tag}` });
    },
    goal: (t) => {
      const g = { group: `goal${t.z}` };
      const y = at(t.x, t.z);
      /* The bar sits *on* the posts and caps them, rather than ending inside
         them: flush, a goal is four planes shared at every corner. */
      for (const s of [-1, 1] as const) put(0.16, 2.36, 0.16, cream, t.x + s * 3.62, y + 1.18, t.z, g);
      put(t.hw * 2 + 0.16, 0.16, 0.2, cream, t.x, y + 2.44, t.z, g);
      for (const s of [-1, 1] as const) put(0.1, 2.24, 0.1, steelPale, t.x + s * 3.62, y + 1.12, t.z + 1.1, g);
      put(t.hw * 2 + 0.1, 0.1, 0.14, steelPale, t.x, y + 2.29, t.z + 1.1, g);
    },
    backstop: (t) => {
      const g = { group: 'backstop' };
      const y = at(t.x, t.z);
      for (let k = 0; k <= 8; k++) {
        put(0.14, 5.0, 0.14, steel, t.x, y + 2.5, t.z - t.hd + k * (t.hd * 2 / 8), g);
      }
      put(0.06, 4.6, t.hd * 2, steelPale, t.x, y + 2.5, t.z, { ...g, cast: false });
      put(0.2, 0.14, t.hd * 2, steel, t.x, y + 4.94, t.z, g);
    },
    hut: (t) => {
      const g = { group: 'hut' };
      const y = at(t.x, t.z);
      put(t.hw * 2, 2.9, t.hd * 2, warm, t.x, y + 1.45, t.z, g);
      put(t.hw * 2 + 0.5, 0.26, t.hd * 2 + 0.5, kerbDark, t.x, y + 3.03, t.z, g);
      put(t.hw * 2 - 1.2, 1.2, 0.12, windowLight, t.x, y + 1.9, t.z - t.hd - 0.02, g);
      put(0.12, 1.2, t.hd * 2 - 1.2, windowLight, t.x - t.hw - 0.02, y + 1.9, t.z, g);
      const l = new THREE.PointLight('#ffdca8', 55, 11, 2);
      l.position.set(t.x, y + 2.2, t.z);
      root.add(l);
      lights.push(l);
      burning.push(l);
    },
    stone: (t) => {
      const g = { group: 'stone' };
      const y = at(t.x, t.z);
      put(t.hw * 2 + 0.6, 0.3, t.hd * 2 + 0.6, kerbDark, t.x, y + 0.15, t.z, g);
      put(t.hw * 2, 1.7, t.hd * 2, ashlar, t.x, y + 1.15, t.z, g);
      const tex = surfaceOf(own, () => signBoard(t.tag ?? '', '#4a443c', '#8f8a80', undefined, 4.4), 1, 1, anisotropy);
      put(t.hw * 2 - 0.4, 0.9, 0.08, matt(own, '#ffffff', tex), t.x, y + 1.2, t.z - t.hd - 0.04, { group: 'stonetext' });
    },
    flagpole: (t) => {
      const g = { group: 'flag' };
      const y = at(t.x, t.z);
      put(1.6, 0.34, 1.6, ashlar, t.x, y + 0.17, t.z, g);
      put(0.22, 11, 0.22, steelPale, t.x, y + 5.6, t.z, g);
      put(0.3, 0.3, 0.3, brass, t.x, y + 11.2, t.z, g);
      put(0.06, 1.3, 2.1, cream, t.x + 0.14, y + 9.6, t.z + 1.1, g);
    },
    vending: (t) => {
      const g = { group: `vend${t.x}` };
      const y = at(t.x, t.z);
      put(t.hw * 2, 1.9, t.hd * 2, dark, t.x, y + 0.95, t.z, g);
      put(t.hw * 2 - 0.2, 1.2, 0.1, roomLight, t.x, y + 1.25, t.z - t.hd - 0.04, g);
      put(t.hw * 2, 0.14, t.hd * 2 + 0.1, steelPale, t.x, y + 1.97, t.z, g);
      const l = new THREE.PointLight('#ffd9a0', 26, 7, 2);
      l.position.set(t.x, y + 1.4, t.z - 1);
      root.add(l);
      lights.push(l);
      burning.push(l);
    },
    bollard: (t) => {
      const g = { group: 'bollards' };
      const y = at(t.x, t.z);
      put(t.hw * 2, 0.9, t.hd * 2, steelPale, t.x, y + 0.45, t.z, g);
      put(t.hw * 2 + 0.06, 0.08, t.hd * 2 + 0.06, steel, t.x, y + 0.93, t.z, g);
    },
    post: (t) => {
      const g = { group: `post${t.x}:${t.z}` };
      const y = at(t.x, t.z);
      put(0.9, 0.4, 0.9, kerbDark, t.x, y + 0.2, t.z, g);
      put(0.4, 11.5, 0.4, steel, t.x, y + 5.95, t.z, g);
      put(2.4, 0.9, 0.5, steel, t.x, y + 11.6, t.z, g);
      put(2.2, 0.7, 0.16, lampGlass, t.x, y + 11.6, t.z - 0.3, g);
      const l = new THREE.PointLight('#ffd7a2', 320, 42, 2);
      l.position.set(t.x, y + 11.2, t.z - 1);
      root.add(l);
      lights.push(l);
    },
  };
  for (const t of DH_THINGS) things[t.kind](t);

  /* ---------------------------------------------------------------- */
  /* the city outside the wall                                         */
  /* ---------------------------------------------------------------- */

  /*
   * Three ranks of it, as the square has, and for the same reason: two hundred
   * metres of ground with a two-and-a-half-metre wall round it is a field, and
   * what makes it a school *in a city* is roofs standing over that wall.
   */
  {
    const piece = (w: number, h: number, d: number, x: number, z: number) => {
      const sink = 1 + rnd() * 3;
      put(w, h + sink, d, city, x, (h + sink) / 2 - sink, z,
          { cast: false, group: `city${x.toFixed(0)}:${z.toFixed(0)}` });
    };
    const lay = (side: 'n' | 's' | 'e' | 'w', rank: number) => {
      const back = 30 + rank * 26;
      const tall = side === 'n' ? 1.25 : side === 'e' ? 1.0 : 0.85;
      for (let i = 0; i < 9; i++) {
        const t = (i / 8 - 0.5) * 2;
        const jitter = (rnd() - 0.5) * 16;
        const w = 16 + rnd() * 20;
        const h = (14 + rnd() * 12 + rank * 5) * tall;
        if (side === 'n') piece(w, h, 14 + rnd() * 12, t * (OUT_X + 14) + jitter, -OUT_Z - back);
        if (side === 's') piece(w, h, 14 + rnd() * 12, t * (OUT_X + 14) + jitter, OUT_Z + back);
        if (side === 'e') piece(14 + rnd() * 12, h, w, OUT_X + back, t * (OUT_Z + 14) + jitter);
        if (side === 'w') piece(14 + rnd() * 12, h, w, -OUT_X - back, t * (OUT_Z + 14) + jitter);
      }
    };
    for (const side of ['n', 's', 'e', 'w'] as const) for (let r = 0; r < 3; r++) lay(side, r);
  }

  /*
   * And Station Plaza, north of the gate.
   *
   * A closed box with the first two metres of the square in it: the pavement
   * running on, the square's own south range standing over it, and a lamp
   * burning — sized so no sight line from inside this site can reach an edge
   * of it, and with a floor that reaches the gateway.
   */
  {
    const gz = -OUT_Z;
    const skin = tiled(matt(own, '#ffffff', renderTex), 3);
    /* The box faces the way the gate does: a back across it, a return down
       each side, and a lid. Written the way the station's doorway is written —
       which faces west — its back and its returns came out at right angles to
       the hole they were closing. */
    put(24, 18, 2.6, skin, DH_GATE, 7.2, gz - 12);
    for (const s of [-1, 1] as const) put(2.6, 18.6, 12.6, skin, DH_GATE + s * 10, 7.3, gz - 6);
    put(22, 1.4, 13.4, matt(own, '#2c2f33'), DH_GATE, 15.3, gz - 6);
    slab(19.4, 12.6, DH_GATE, 0.03, gz - 6, yard);
    /* Two metres of the square: its kerb, its pavement and a lamp on it. */
    put(19.4, 0.3, 0.36, kerb, DH_GATE, 0.15, gz - 0.5);
    put(0.3, 5.4, 0.3, iron, DH_GATE - 6.6, 2.7, gz - 5);
    put(0.9, 0.44, 0.9, iron, DH_GATE - 6.6, 5.12, gz - 5);
    put(0.7, 0.24, 0.7, lampGlass, DH_GATE - 6.6, 4.88, gz - 5);
    const l = new THREE.PointLight('#ffbe78', 220, 26, 2);
    l.position.set(DH_GATE - 5.6, 4.7, gz - 5);
    root.add(l);
    lights.push(l);
    burning.push(l);
  }

  bake();

  /* ---------------------------------------------------------------- */
  /* light                                                             */
  /* ---------------------------------------------------------------- */

  /*
   * The shadow camera has to cover two hundred metres of site *and* the ranks
   * of city standing outside its wall, because the block's shadow across the
   * yard all afternoon is the largest thing in the picture here.
   */
  const sky = ownSky(own, new Sky(own, root, {
    reach: 150,
    half: 118,
    deep: 112,
    target: [0, 2, -20],
    /*
     * A fifth more fill than an open square gets.
     *
     * Both of this school's long buildings run east to west, so one of their
     * two long faces is in its own shadow from the moment the sun clears the
     * roof — the corridor elevation faces the drive and never sees it at all.
     * `fill` is about enclosure and a courtyard between two blocks is
     * enclosure; without it the two elevations you walk between all day are
     * black brick.
     */
    fill: 1.35,
    /* One texel of a 2048 map over 236 m of camera. See `market.ts`. */
    normalBias: 0.115,
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
