/**
 * Central Towers — two hundred and forty metres by two hundred.
 *
 * The biggest area in Domino City and the first one you go *down* into. Two
 * office slabs face each other across forty-four metres of paved canyon, and
 * the middle of that canyon is a hole: a sunken forecourt six metres below the
 * street with the towers' basements running out of it east and west into their
 * own lobbies. Five floors you can stand on, and they are not stacked — they
 * are threaded through each other, so the way from one tower to the other is
 * either across the open or down and along, and the two do not look alike.
 *
 * ## A glass canyon without a single lit sign
 *
 * The plan calls this "verticality you look up at, and reflective material",
 * and reflective material is the trap: the obvious answer is neon and there is
 * none in this city and never will be. So the glass is doing the reflecting —
 * pale grey-green plate in bronze mullions, dark where the sky is dark and
 * bright where it is bright, in bands that step in every few floors so the
 * shafts read as *tall* rather than as two rectangles. What is lit at night is
 * lamplight: the lobbies burning behind their glass, the standards down the
 * canyon, and the strip under the colonnade.
 *
 * ## Inside
 *
 * Both lobbies are built. Thirteen metres to the ceiling, a gallery round two
 * sides with an open stair up to it, a lift core, a reception counter, and the
 * doors on to the canyon. From now on a place you can enter is a place that is
 * finished inside.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  asphalt, concrete, darkWood, paving, render, signBoard, woodFloor,
} from './surfaces';
import {
  Owned, bakedFrom, basePlate, decal, glow, lit, matt, scaleBoxUVs, seeded, surfaceOf, tiled,
  type BakedPart, type BuiltArea,
} from './kit';
import { Sky, ownSky } from './sky';
import {
  AREAS, CT_ALLEY, CT_ARCADE, CT_ARM, CT_ARM_E, CT_ARM_W, CT_DECK, CT_DECK_AT, CT_DOOR_HALF,
  CT_DROP, CT_DROP_N, CT_DROP_S, CT_EAST, CT_EAST_SHAFT, CT_EDOOR, CT_ELOBBY, CT_GALLERY,
  CT_GATE, CT_GATE_HALF, CT_IN, CT_LOBBY, CT_LOW, CT_MEZZ, CT_RISE, CT_ROAD, CT_STAIR,
  CT_ARM_FLAT, CT_SLOT, CT_UP, CT_UP_AT, CT_WALK, CT_WDOOR, CT_WELL, CT_WEST, CT_WEST_SHAFT,
  CT_WLOBBY, pavingPieces,
} from '@/story/areas';

const AREA = AREAS['central-towers'];
const OUT_X = AREA.bounds.hw + 1;   // 120
const OUT_Z = AREA.bounds.hd + 1;   // 100

export function buildTowers(anisotropy: number): BuiltArea {
  const own = new Owned();
  const root = new THREE.Group();
  root.name = 'central-towers';
  const rnd = seeded(0x71a3d5);
  const lights: THREE.PointLight[] = [];
  /* Lamps that do not answer to the clock: a lobby burns at noon, and the
     forecourt is six metres down between two towers and never sees the sun. */
  const burning: THREE.PointLight[] = [];

  /* ---------------------------------------------------------------- */
  /* what everything is made of                                        */
  /* ---------------------------------------------------------------- */

  const paveTex = surfaceOf(own, () => paving({ dirt: 0.08, vary: 0.2 }), 1, 1, anisotropy);
  const slabTex = surfaceOf(own, () => paving({ dirt: 0.12, vary: 0.3 }), 1, 1, anisotropy);
  const roadTex = surfaceOf(own, asphalt, 1, 1, anisotropy);
  const concTex = surfaceOf(own, () => concrete('#9d968c'), 1, 1, anisotropy);
  const stoneTex = surfaceOf(own, () => render('#c6bca8'), 1, 1, anisotropy);
  const warmTex = surfaceOf(own, () => render('#cabe a3'.replace(' ', '')), 1, 1, anisotropy);
  const boardTex = surfaceOf(own, woodFloor, 1, 2, anisotropy);
  const woodTex = surfaceOf(own, darkWood, 1, 2, anisotropy);

  /* Tints multiply: the brightness lives in the drawing, never in the tint. */
  const paving0 = tiled(matt(own, '#efe7d4', paveTex), 2.4);
  const slabs = tiled(matt(own, '#e7dfcc', slabTex), 1.8);
  const road = tiled(matt(own, '#ffffff', roadTex), 4);
  const ashlar = tiled(matt(own, '#ffffff', concTex), 2.6);
  const stone = tiled(matt(own, '#ffffff', stoneTex), 3);
  const warm = tiled(matt(own, '#ffffff', warmTex), 3);
  const boards = tiled(matt(own, '#ffffff', boardTex), 1.4);
  const timber = matt(own, '#6f5942', woodTex);
  const kerb = matt(own, '#a8a294');
  const kerbDark = matt(own, '#7c766b');
  const bronze = matt(own, '#7d6a45');
  const iron = matt(own, '#52524d');
  const steel = matt(own, '#6d6e66');
  const dark = matt(own, '#2b2e32');
  const cream = matt(own, '#d7cdb3');
  const city = matt(own, '#8e8779');
  /*
   * The glass. Two greys and nothing else: one for the pane and one a shade
   * colder for the spandrel between floors, so a shaft reads as courses rather
   * than as a sheet. Reflective is a *value* here, not a colour — anything
   * with saturation in it at this scale is a lit sign, and there are none.
   */
  const glassLit = matt(own, '#7c878a');
  const glassDark = matt(own, '#5d686c');
  const spandrel = matt(own, '#4f565a');
  const lineWhite = decal(own, '#cec6b1');
  const lampGlass = glow(own, '#c9954e');
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

  /** A flat plate, for ground you walk on rather than a box you walk round. */
  const slab = (w: number, d: number, x: number, y: number, z: number, material: THREE.Material) => {
    const geo = own.keep(new THREE.PlaneGeometry(w, d));
    /* A plane's UVs run nought to one whatever it measures, so one repeat
       shared across surfaces of different size is corduroy. Metres, always. */
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

  /* A lamp on a bracket or a pole, never a light on its own. */
  const lamp = (x: number, y: number, z: number, reach: number, power = 150, alwaysOn = false) => {
    const l = new THREE.PointLight('#ffbe78', power, reach, 2);
    l.position.set(x, y, z);
    root.add(l);
    lights.push(l);
    if (alwaysOn) burning.push(l);
    return l;
  };

  /* ---------------------------------------------------------------- */
  /* the ground                                                        */
  /* ---------------------------------------------------------------- */

  /*
   * The base plate is the forecourt's floor, because nothing in this engine can
   * be below nought — see `CT_LOW`. Everything else stands on top of it, which
   * is why the street is six metres up and the whole site is a table.
   */
  /* Its last argument is the plate's *y*, not a depth: passing +0.06 stood
     the backstop six centimetres above the collision's floor and put the
     duelist's feet inside it in all four hundred thousand cells. */
  basePlate(own, root, AREA.bounds, '#24211d');

  /* The forecourt and the two arms, at the bottom. */
  slab(CT_WELL.x1 - CT_WELL.x0, CT_WELL.z1 - CT_WELL.z0, 0, CT_LOW + 0.01, 0, slabs);
  for (const a of [CT_ARM_W, CT_ARM_E]) {
    slab(a.x1 - a.x0, CT_ARM.z1 - CT_ARM.z0, (a.x0 + a.x1) / 2, CT_LOW + 0.014,
         (CT_ARM.z0 + CT_ARM.z1) / 2, slabs);
  }

  /*
   * The street. One table six metres thick under the whole site, and the
   * pavement drawn on top of it — the table is what the forecourt's walls are
   * cut out of, and it is what you are standing on everywhere else.
   */
  /*
   * And no table under it.
   *
   * The obvious thing is a two-hundred-metre block of stone from the base
   * plate up to the pavement, with the hole cut out of it — and it is wrong,
   * because a box whose top face is the surface you walk on is a box you are
   * standing inside. `npm run walls` counted three thousand of them. Every
   * other area in this city draws its ground as a *plane* and its mass as the
   * things you walk round, and the only faces this site's hole actually
   * exposes are its own retaining walls, which are drawn where they collide.
   */
  /*
   * The pavement, in the same pieces its platforms are — around the two
   * carriageways, the well, and the two flights.
   *
   * One plane over the whole site is fifteen centimetres of paving laid across
   * both roads and over the top of both flights: `footing` found ninety-four
   * thousand cells whose feet were inside it.
   */
  /* Through the same cut the platforms are: the pavement runs on under both
     podiums, and inside a lobby that is a slab of street lying across the
     stairwell thirty centimetres under the floor. See `pavingPieces` in areas. */
  const pave = (w: number, d: number, x: number, z: number) => {
    if (d < 0.01 || w < 0.01) return;
    for (const b of pavingPieces({ x, z, hw: w / 2, hd: d / 2 })) {
      slab(b.x1 - b.x0, b.z1 - b.z0, (b.x0 + b.x1) / 2, CT_WALK + 0.004,
           (b.z0 + b.z1) / 2, paving0);
    }
  };
  for (const s of [-1, 1]) {
    pave(CT_IN.x * 2, 6, 0, s * 95);
    slab(CT_IN.x * 2, 12, 0, CT_ROAD + 0.006, s * 86, road);
  }
  pave(CT_IN.x * 2, CT_DROP_N.start + 80, 0, (-80 + CT_DROP_N.start) / 2);
  {
    const a = CT_UP_AT - CT_UP.half;
    const b = CT_UP_AT + CT_UP.half;
    pave(CT_IN.x * 2, 80 - b, 0, (80 + b) / 2);
    pave(CT_IN.x * 2, a - CT_DROP_S.start, 0, (CT_DROP_S.start + a) / 2);
    pave(CT_IN.x + CT_DECK_AT.x0 - CT_UP.run, b - a,
         (-CT_IN.x + CT_DECK_AT.x0 - CT_UP.run) / 2, CT_UP_AT);
    pave(CT_IN.x - CT_DECK_AT.x0, b - a, (CT_DECK_AT.x0 + CT_IN.x) / 2, CT_UP_AT);
  }
  for (const f of [CT_DROP_N, CT_DROP_S]) for (const s of [-1, 1]) {
    pave(CT_IN.x - CT_DROP.half, Math.abs(f.end - f.start),
         s * (CT_IN.x + CT_DROP.half) / 2, (f.start + f.end) / 2);
  }
  for (const s of [-1, 1]) {
    pave(CT_IN.x - CT_WELL.x1, CT_WELL.z1 * 2, s * (CT_IN.x + CT_WELL.x1) / 2, 0);
  }
  /* Kerbs down both sides of each cross street. */
  /* Proud of the paving by two centimetres, not flush with it: flush is one
     plane shared with two hundred and thirty-six metres of pavement, which is
     forty-seven square metres of flicker. A kerb stands proud anyway. */
  for (const s of [-1, 1]) for (const t of [-1, 1]) {
    put(CT_IN.x * 2, 0.17, 0.4, kerb, 0, CT_ROAD + 0.085, s * 86 + t * 6, { cast: false });
  }

  /* ---------------------------------------------------------------- */
  /* the perimeter and the gate                                        */
  /* ---------------------------------------------------------------- */

  {
    const H = 3.2;
    const at = CT_IN.z + 1;
    /* North: solid, the way to Domino Arcade held for later. South: the gate
       to Station Plaza, which is open. */
    for (const [a, b] of [[-OUT_X, CT_GATE - CT_GATE_HALF], [CT_GATE + CT_GATE_HALF, OUT_X]]) {
      put(b - a, H, 2, stone, (a + b) / 2, CT_ROAD + H / 2, at, { group: 'wall' });
      put(b - a - 0.4, 0.3, 2.4, kerb, (a + b) / 2, CT_ROAD + H + 0.15, at, { group: 'wall' });
    }
    put(OUT_X * 2, H, 2, stone, 0, CT_ROAD + H / 2, -at, { group: 'wall' });
    put(OUT_X * 2 - 0.4, 0.3, 2.4, kerb, 0, CT_ROAD + H + 0.15, -at, { group: 'wall' });
    for (const s of [-1, 1]) {
      put(2, H, OUT_Z * 2 - 4, stone, s * (CT_IN.x + 1), CT_ROAD + H / 2, 0, { group: 'wall' });
      /* Across the wall, not along it: four copings that overhang both ways
         meet at the four corners, and two courses of stone at one height
         sharing a corner is a flicker you see from the middle of the site. */
      put(2.4, 0.3, OUT_Z * 2 - 4.8, kerb, s * (CT_IN.x + 1), CT_ROAD + H + 0.15, 0, { group: 'wall' });
    }
    /* The gate's piers, and its name where it can be read from the ground. */
    /* Overlapping the wall they end, and starting a hair below it: butted
       flush, a pier's own face and the wall's end face are one plane with six
       square metres in them, and their two undersides are another four. */
    for (const s of [-1, 1]) {
      put(2, 5.5, 2.6, ashlar, CT_GATE + s * (CT_GATE_HALF + 0.8), CT_ROAD + 2.65, at);
      put(2.4, 0.34, 3, kerb, CT_GATE + s * (CT_GATE_HALF + 0.8), CT_ROAD + 5.57, at);
      put(0.5, 0.5, 0.5, iron, CT_GATE + s * (CT_GATE_HALF + 0.8), CT_ROAD + 6.0, at);
      put(0.4, 0.2, 0.4, lampGlass, CT_GATE + s * (CT_GATE_HALF + 0.8), CT_ROAD + 5.9, at);
    }
    const tex = surfaceOf(own, () => signBoard('CENTRAL TOWERS', '#2f2a24', '#c9bf9e', undefined, 3.6), 1, 1, anisotropy);
    put(4.6, 4.6 / 3.6, 0.14, matt(own, '#ffffff', tex),
        CT_GATE - (CT_GATE_HALF + 1), CT_ROAD + 3.6, at - 1.37);
    lamp(CT_GATE, CT_ROAD + 4.4, at - 3, 18, 120);
    /* The gateway floor through the wall. */
    slab(CT_GATE_HALF * 2, 4.8, CT_GATE, CT_WALK + 0.012, at, slabs);
  }

  /* ---------------------------------------------------------------- */
  /* the two towers                                                    */
  /* ---------------------------------------------------------------- */

  /**
   * A shaft, in courses.
   *
   * Floor bands rather than one sheet of glass: a pane, a spandrel, a pane,
   * for twenty-odd storeys, and the mullion grid over the top of it. The whole
   * point of the plan's "verticality you look up at" is that you can *count*
   * the floors, and you cannot count a rectangle.
   */
  const shaft = (b: { x0: number; x1: number; z0: number; z1: number; top: number }, base: number, group: string) => {
    const w = b.x1 - b.x0, d = b.z1 - b.z0;
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    const FLOOR = 3.6;
    const floors = Math.floor((b.top - base) / FLOOR);
    /* The core, which is what the glass is hung on and what casts the shadow. */
    put(w - 1.2, floors * FLOOR, d - 1.2, ashlar, cx, base + (floors * FLOOR) / 2, cz, { group });
    for (let i = 0; i < floors; i++) {
      const y = base + i * FLOOR;
      /* Every fourth course a shade colder, so the tower has a grain. */
      const pane = i % 4 === 3 ? glassDark : glassLit;
      put(w, 2.4, d, pane, cx, y + 1.4, cz, { group });
      put(w + 0.06, 1.2, d + 0.06, spandrel, cx, y + 3.2, cz, { group });
      /*
       * And a few of them burning.
       *
       * At midnight these two are the only thing you can see from anywhere in
       * the area and they were black slabs against a black sky — seventy and
       * eighty-four metres of nothing. One window in thirteen, on a pattern
       * that never lines up, and they are towers with people in them.
       */
      let k = 0;
      for (let x = b.x0 + 1.5; x < b.x1; x += 3, k++) {
        for (const s of [-1, 1] as const) {
          if ((i * 7 + k * 5 + (s < 0 ? 0 : 3)) % 13) continue;
          put(2.2, 1.6, 0.16, roomLight, x, y + 1.5,
              s < 0 ? b.z0 - 0.05 : b.z1 + 0.05, { cast: false, group });
        }
      }
      for (let z = b.z0 + 1.5; z < b.z1; z += 3, k++) {
        for (const s of [-1, 1] as const) {
          if ((i * 7 + k * 5 + (s < 0 ? 0 : 3)) % 13) continue;
          put(0.16, 1.6, 2.2, roomLight, s < 0 ? b.x0 - 0.05 : b.x1 + 0.05,
              y + 1.5, z, { cast: false, group });
        }
      }
    }
    /* Mullions: uprights every three metres on all four faces, and a capping
       band at the top. Bronze, because the only metal in this city is brass
       and bronze and this one has to read against grey glass. */
    for (const s of [-1, 1]) {
      for (let x = b.x0 + 3; x < b.x1; x += 3) {
        put(0.22, floors * FLOOR, 0.22, bronze, x, base + (floors * FLOOR) / 2, s < 0 ? b.z0 : b.z1, { group });
      }
      for (let z = b.z0 + 3; z < b.z1; z += 3) {
        put(0.22, floors * FLOOR, 0.22, bronze, s < 0 ? b.x0 : b.x1, base + (floors * FLOOR) / 2, z, { group });
      }
    }
    put(w + 0.8, 1.4, d + 0.8, ashlar, cx, base + floors * FLOOR + 0.7, cz, { group });
    put(w + 1.4, 0.5, d + 1.4, kerb, cx, base + floors * FLOOR + 1.65, cz, { group });
  };

  /**
   * A podium: the storeys at street level, in stone — with the lobby cut out
   * of it, and its courses run as four faces rather than one band.
   *
   * Drawn as a solid block with a string course round the outside, the course
   * passes straight through the room inside it: `footing` found sixteen
   * thousand cells on the galleries standing thirty-five centimetres inside a
   * band of stone that had no business being in the room at all. The mass is
   * the same three pieces the collision is, and the courses are four runs on
   * the four outside faces.
   */
  const podium = (
    b: { x0: number; x1: number; z0: number; z1: number; top: number },
    l: { x0: number; x1: number; z0: number; z1: number },
    side: -1 | 1, doorAt: number, group: string,
    /* The part of the footprint whose mass belongs to something else — the
       deck's, which is only thirteen metres tall and draws its own. Without
       this the podium stands twenty-three metres of stone straight up through
       a terrace people walk on. */
    omit?: { z0: number; z1: number }
  ) => {
    const face = side < 0 ? b.x1 : b.x0;        // the face on to the canyon
    const back = side < 0 ? l.x0 : l.x1;        // the lobby's inner limit
    const mass = (x0: number, x1: number, z0: number, z1: number) => {
      if (x1 - x0 < 0.02 || z1 - z0 < 0.02) return;
      put(x1 - x0, b.top, z1 - z0, stone, (x0 + x1) / 2, CT_WALK + b.top / 2, (z0 + z1) / 2, { group });
    };
    /*
     * Three pieces round the lobby — stopping three hundred millimetres *into*
     * the room's lining rather than on its face.
     *
     * The lining is the inner face of this mass, so drawn to the same line the
     * two share the plane of every wall of the room: nearly five hundred
     * square metres of it a pair. Overlap is the only junction that never
     * flickers.
     */
    const in0 = back + (side < 0 ? -0.3 : 0.3);
    if (side < 0) mass(b.x0, in0, b.z0, b.z1); else mass(in0, b.x1, b.z0, b.z1);
    for (const [z0, z1] of [[b.z0, l.z0 - 0.3], [l.z1 + 0.3, b.z1]] as const) {
      const end = omit && z1 > omit.z0 ? Math.min(z1, omit.z0) : z1;
      if (side < 0) mass(in0, b.x1, z0, end); else mass(b.x0, in0, z0, end);
    }
    /* The courses: a plinth, a string at the first floor and a cornice, run
       along each of the four outside faces and never through the room. */
    for (const [y, h, over, mat] of [
      [CT_WALK + 0.45, 0.9, 0.35, ashlar],
      [CT_WALK + 6.4, 0.4, 0.25, kerb],
      [CT_WALK + b.top - 0.55, 1.1, 0.55, ashlar],
    ] as const) {
      /*
       * The far end's course runs only over the part of the podium that is
       * still twenty-three metres tall there.
       *
       * Where the deck takes over, the mass under it is thirteen and a half,
       * so the full-width band left fifteen metres of stone hanging in the air
       * over a terrace people stand on.
       */
      for (const z of [b.z0, b.z1]) {
        const [a0, a1] = omit && z === b.z1 ? [in0, b.x1] : [b.x0, b.x1];
        put(a1 - a0 + over * 2, h, over * 2, mat, (a0 + a1) / 2, y,
            z + (z < 0 ? -over : over), { group });
      }
      /*
       * Outward from the mass, which is −1 at x0 and +1 at x1 — not "away from
       * the canyon face": written that way the east podium's courses projected
       * *into* its own lobby.
       *
       * And on the canyon face the run stops at the lobby, because a string
       * course is a course of masonry and the lobby's front is a curtain wall
       * of glass thirteen metres tall. Carried across it, its inner edge met
       * the gallery's floor plate exactly and stood in the last twenty-nine
       * cells of it.
       */
      const back = side < 0 ? b.x0 : b.x1;
      put(over * 2, h, b.z1 - b.z0 - over * 2, mat, back + (back === b.x0 ? -over : over), y,
          (b.z0 + b.z1) / 2, { group });
      /* And the canyon face's stops where the deck begins, for the same
         reason — and because the course stood three hundred millimetres proud
         of the face straight across the head of the deck's own flight. It is
         what the duelist walked into two treads below the top: the terrace
         could not be reached at all, and only a frame from a vantage on it
         ever said so. */
      const zEnd = omit ? omit.z0 : b.z1 - over;
      for (const [z0, z1] of [[b.z0 + over, l.z0], [l.z1, zEnd]] as const) {
        if (z1 - z0 < 0.05) continue;
        put(over * 2, h, z1 - z0, mat, face + (face === b.x0 ? -over : over), y,
            (z0 + z1) / 2, { group });
      }
    }
    /* Piers down the canyon face, and glazing between them — but not across
       the lobby, whose own front is glass from the floor to the ceiling. */
    for (let z = b.z0 + 4; z < b.z1 - 2; z += 8) {
      if (z > l.z0 - 3 && z < l.z1 + 3) continue;
      if (omit && z > omit.z0 - 3) continue;
      put(1.6, b.top - 2.2, 1.4, ashlar, face - side * 0.4, CT_WALK + (b.top - 2.2) / 2 + 0.9, z, { group });
      if (z + 8 < b.z1 - 2 && !(z + 4 > l.z0 - 3 && z + 4 < l.z1 + 3)) {
        put(0.9, 4.4, 6.2, glassLit, face - side * 0.4, CT_WALK + 3.3, z + 4, { group });
        put(0.9, 3.2, 6.2, spandrel, face - side * 0.4, CT_WALK + 7.6, z + 4, { group });
      }
    }
    void doorAt;
  };

  podium(CT_WEST, CT_WLOBBY, -1, CT_WDOOR, 'west');
  podium(CT_EAST, CT_ELOBBY, 1, CT_EDOOR, 'east', CT_DECK_AT);
  shaft(CT_WEST_SHAFT, CT_WALK + CT_WEST.top, 'westShaft');
  shaft(CT_EAST_SHAFT, CT_WALK + CT_EAST.top, 'eastShaft');

  /* ---------------------------------------------------------------- */
  /* the canyon and the hole in it                                     */
  /* ---------------------------------------------------------------- */

  {
    /* The well's retaining walls: what you meet as a parapet from the street
       and as a wall from the bottom, and therefore one piece of stone. */
    const H = CT_ROAD;
    /*
     * Four walls that *interpenetrate* rather than abut, and two heights.
     *
     * Butted at the corners, the pair running along z and the pair running
     * along x share the plane of each other's ends — five and a half square
     * metres of it — and their two tops share another. Run the second pair
     * into the middle of the first and give it a hundred millimetres less
     * height and no two faces of this hole are in one plane.
     */
    for (const s of [-1, 1]) {
      for (const [a, b] of [[CT_WELL.z0 - 0.6, CT_ARM.z0 - 0.2], [CT_ARM.z1 + 0.2, CT_WELL.z1 + 0.6]]) {
        put(0.8, H + 1.1, b - a, ashlar, s * (CT_WELL.x1 + 0.4), (H + 1.1) / 2, (a + b) / 2);
      }
    }
    for (const z of [CT_WELL.z0, CT_WELL.z1]) {
      for (const [a, b] of [[CT_WELL.x0 - 0.4, -CT_DROP.half - 0.6], [CT_DROP.half + 0.6, CT_WELL.x1 + 0.4]]) {
        put(b - a, H + 1.0, 0.9, ashlar, (a + b) / 2, (H + 1.0) / 2, z + Math.sign(z) * 0.35);
      }
    }
    /* A rail on top of the parapet, which is what stops it reading as a kerb. */
    for (const s of [-1, 1]) {
      for (const [a, b] of [[CT_WELL.z0 - 0.8, CT_ARM.z0], [CT_ARM.z1, CT_WELL.z1 + 0.8]]) {
        put(0.14, 0.1, b - a, bronze, s * (CT_WELL.x1 + 0.4), H + 1.15, (a + b) / 2);
      }
    }

    /* The two grand flights, tread by tread — drawn from the same numbers the
       collision is, so the step you see is the step you stand on. */
    for (const f of [CT_DROP_N, CT_DROP_S]) {
      const steps = Math.round(Math.abs(CT_LOW - CT_WALK) / CT_DROP.rise);
      const tread = (f.end - f.start) / steps;
      for (let i = 0; i < steps; i++) {
        const z = f.start + tread * (i + 0.5);
        const y = CT_WALK + ((CT_LOW - CT_WALK) / steps) * (i + 1);
        put(CT_DROP.half * 2, 0.3, Math.abs(tread) + 0.004, slabs, 0, y - 0.15, z, { cast: false });
      }
      /*
       * The cheeks either side, stepping with the flight — from the ground up
       * to a metre over each tread.
       *
       * They used to be written the other way round and came out as a wedge
       * with a flat bottom three metres over the forecourt's floor and a top
       * nearly four metres over the street: a parapet you could see daylight
       * under at the foot of the stair.
       *
       * And two more down the middle of it, because this flight is twenty-six
       * metres wide. Nothing that wide is one flight in life, and nothing that
       * wide can be lit: the middle twenty metres had no light on it at any
       * hour and the whole thing read as a black ramp with lines on it.
       */
      for (const [x, w, cap, rail] of [
        [-(CT_DROP.half + 0.5), 1, 1.2, false], [CT_DROP.half + 0.5, 1, 1.2, false],
        [-4.5, 0.36, 0.5, true], [4.5, 0.36, 0.5, true],
      ] as const) {
        for (let i = 0; i < steps; i++) {
          const z = f.start + tread * (i + 0.5);
          const y = CT_WALK + ((CT_LOW - CT_WALK) / steps) * (i + 1);
          const foot = rail ? y : CT_LOW;
          const top = y + 1.05;
          put(w, top - foot, 0.004 + Math.abs(tread), ashlar, x, (foot + top) / 2, z);
          put(cap, 0.12, 0.004 + Math.abs(tread), kerb, x, top + 0.06, z, { cast: false });
        }
        /* A lantern on each middle rail, half way down. */
        if (rail) {
          const i = Math.round(steps / 2);
          const z = f.start + tread * (i + 0.5);
          const y = CT_WALK + ((CT_LOW - CT_WALK) / steps) * (i + 1);
          put(0.44, 0.6, 0.44, iron, x, y + 1.42, z);
          put(0.34, 0.18, 0.34, lampGlass, x, y + 1.13, z);
          lamp(x, y + 1.05, z, 22, 160, true);
        }
      }
    }

    /* Lamp standards down the canyon, and two in the hole. */
    for (const z of [-64, -44, 44, 64]) for (const s of [-1, 1]) {
      const x = s * 19;
      put(0.34, 5.2, 0.34, iron, x, CT_WALK + 2.6, z);
      put(0.9, 0.34, 0.9, iron, x, CT_WALK + 5.35, z);
      put(0.8, 0.14, 0.8, lampGlass, x, CT_WALK + 5.15, z);
      /* Burning at every hour, like the forecourt's. Forty-four metres of
         canyon between two towers seventy and eighty-four metres tall never
         has daylight on its floor: at four in the afternoon the pavement down
         here is nearly black and these were switched off. */
      lamp(x, CT_WALK + 5.0, z, 26, 170, true);
    }
    for (const s of [-1, 1]) {
      const z = s * 11;
      put(0.3, 4.2, 0.3, iron, 12, CT_LOW + 2.1, z);
      put(0.8, 0.3, 0.8, iron, 12, CT_LOW + 4.35, z);
      put(0.7, 0.12, 0.7, lampGlass, 12, CT_LOW + 4.2, z);
      lamp(12, CT_LOW + 4.0, z, 22, 180, true);
    }
    /*
     * A bracket low on each cheek of each flight, washing the risers.
     *
     * The forecourt is six metres down between two towers and never sees the
     * sun; the treads face the hole and the risers face nothing at all, so
     * both flights read as a black ramp with lines on it at every hour. This
     * is the only light that ever falls on them.
     */
    for (const f of [CT_DROP_N, CT_DROP_S]) for (const s of [-1, 1]) for (const up of [3, 8]) {
      const dir = Math.sign(f.start - f.end);
      const z = f.end + dir * up;
      const y = CT_LOW + (up / CT_DROP.run) * (CT_WALK - CT_LOW) + 2.6;
      put(1.0, 0.14, 0.14, iron, s * (CT_DROP.half + 0.1), y + 0.4, z);
      put(0.42, 0.5, 0.42, iron, s * (CT_DROP.half - 0.4), y + 0.1, z);
      put(0.34, 0.16, 0.34, lampGlass, s * (CT_DROP.half - 0.4), y - 0.17, z);
      lamp(s * (CT_DROP.half - 0.4), y - 0.3, z, 20, 150, true);
    }
    /* And the still water table the forecourt is built round: black granite,
       a hand deep, with a stone kerb. Not a fountain — nothing here jets. */
    put(13, 0.5, 7, kerbDark, -6, CT_LOW + 0.25, 0, { cast: false });
    put(12.4, 0.12, 6.4, glassDark, -6, CT_LOW + 0.52, 0, { cast: false });
    put(13.6, 0.28, 7.6, ashlar, -6, CT_LOW + 0.14, 0, { cast: false });
  }

  /* ---------------------------------------------------------------- */
  /* inside                                                            */
  /* ---------------------------------------------------------------- */

  /**
   * A lobby, built.
   *
   * Thirteen metres to the ceiling, a gallery round two sides with an open
   * stair up to it, a lift core with four doors, a reception counter, and the
   * revolving doors on to the canyon. `side` is −1 for the west tower, whose
   * doors face east, and +1 for the east tower, whose doors face west.
   */
  const lobby = (
    l: { x0: number; x1: number; z0: number; z1: number },
    side: -1 | 1, doorAt: number, group: string
  ) => {
    const CEIL = 13;
    const face = side < 0 ? l.x1 : l.x0;      // the wall on to the canyon
    const back = side < 0 ? l.x0 : l.x1;      // and the one opposite it
    const cx = (l.x0 + l.x1) / 2, cz = (l.z0 + l.z1) / 2;
    const w = l.x1 - l.x0, d = l.z1 - l.z0;

    /*
     * Floor, ceiling and the four walls. The outer three walls are the
     * podium's own mass — what is drawn here is their inner face.
     *
     * The floor is in three pieces, round the slot the arm's flight rises
     * through, because that is how its platforms are cut: drawn as one plate
     * it lies over the top of the flight and you stand thirty-one centimetres
     * inside it.
     */
    const head = side < 0 ? CT_ARM_W.x0 : CT_ARM_E.x1;
    const open0 = Math.min(head, head - side * CT_SLOT);
    const open1 = Math.max(head, head - side * CT_SLOT);
    const sAt = cx + 6;
    const floor = (x0: number, x1: number, z0: number, z1: number) => {
      if (x1 - x0 < 0.02 || z1 - z0 < 0.02) return;
      slab(x1 - x0, z1 - z0, (x0 + x1) / 2, CT_LOBBY + 0.01, (z0 + z1) / 2, boards);
    };
    /* Off the same four rectangles the collision is cut into: the floor
       behind the stair, the strip between the opening and the glass, and the
       two pieces either side of the opening. */
    floor(Math.min(head, back), Math.max(head, back), l.z0, l.z1);
    floor(Math.min(face, side < 0 ? open1 : open0), Math.max(face, side < 0 ? open1 : open0),
          l.z0, l.z1);
    floor(open0, open1, CT_RISE.half, l.z1);
    floor(open0, open1, l.z0, -CT_RISE.half);
    /*
     * The balustrade round the opening — three sides of it, the fourth being
     * the head of the stair you walk off.
     *
     * And the soffits: the lobby floor is a plane, which has no underside, so
     * every piece of it with the arm's tunnel beneath gets a slab of its own
     * or you stand in the basement looking up into the lobby.
     */
    {
      /* Only the end of the opening is railed: its two long sides are the
         arm's own walls, which carry on a metre past the lobby floor and are
         the parapet. Set back a hundred and fifty from the floor's edge so
         nothing of it shares a plane with the downstand under it. */
      const end = side < 0 ? open1 + 0.15 : open0 - 0.15;
      put(0.2, 1.18, CT_ARM.z1 * 2 + 0.8, ashlar, end, CT_LOBBY + 0.44, 0, { group });
      put(0.26, 0.09, CT_ARM.z1 * 2 + 0.88, bronze, end, CT_LOBBY + 1.125, 0, { group });
      /*
       * The downstand under the strip between the opening and the glass, six
       * hundred deep.
       *
       * The lobby floor is a plane and a plane has no edge: standing on a
       * tread a metre and a half below it, what stops you walking off the
       * stair is the floor's own lip, and there is nothing drawn there at all.
       * An opening in a floor has a beam round it anyway.
       */
      const [s0, s1] = side < 0 ? [open1, face] : [face, open0];
      put(Math.abs(s1 - s0), 0.6, CT_ARM.z1 - CT_ARM.z0, cream,
          (s0 + s1) / 2, CT_LOBBY - 0.3, 0, { cast: false, group });
    }
    put(w, 0.5, d, cream, cx, CT_LOBBY + CEIL + 0.25, cz, { cast: false, group });
    /* Six hundred thick and set five centimetres into the podium's mass, not
       five hundred flush against it: flush, a room's lining and the block it
       is cut out of share the plane of every wall. */
    /* Its inner face *on* the room's boundary, so the lining is entirely
       inside the podium's mass. Set a quarter of a metre the other way it
       stands half a metre into its own room, which is where four hundred
       cells of duelist were walking into it. */
    for (const z of [l.z0, l.z1]) {
      put(w - 0.3, CEIL + 0.1, 0.6, cream, cx, CT_LOBBY + CEIL / 2, z + Math.sign(z - cz) * 0.3, { group });
    }
    put(0.6, CEIL + 0.2, d - 0.3, cream, back + side * 0.3, CT_LOBBY + CEIL / 2, cz, { group });
    /*
     * A dado and a string course round the three solid walls.
     *
     * Thirty-eight metres of unbroken render thirteen metres tall has no scale
     * in it at all — from the gallery the far wall of this room was one flat
     * field of colour. Two bands and it is a room.
     */
    for (const [y, h, mat] of [[CT_LOBBY + 0.55, 1.1, ashlar],
                               [CT_MEZZ - 0.75, 0.36, kerb]] as const) {
      /* Proud of the lining's inner face and into the room — the lining stands
         from the wall line *outward*, so a band set the same way as the lining
         is a band buried inside it. */
      for (const z of [l.z0, l.z1]) {
        put(w - 0.9, h, 0.16, mat, cx, y, z - Math.sign(z - cz) * 0.08, { group });
      }
      put(0.16, h, d - 0.9, mat, back - side * 0.08, y, cz, { group });
    }

    /*
     * The canyon wall: glass from the floor to the ceiling in bronze mullions,
     * with the revolving doors in the middle of it. This is the elevation the
     * street sees lit at night, so it is the one that has to be honest.
     */
    for (const [a, b] of [[l.z0, doorAt - CT_DOOR_HALF], [doorAt + CT_DOOR_HALF, l.z1]]) {
      /* On the wall's own line — `face - side * 0.5` — and not a quarter of a
         metre inside the room. Drawn there it is a curtain wall standing in
         its own lobby, with the collision a metre away in the canyon. */
      put(0.5, CEIL - 0.2, b - a, glassLit, face - side * 0.5, CT_LOBBY + CEIL / 2, (a + b) / 2, { group });
      /* Shorter than the glass by a hand at each end: the same height and the
         mullion's top and underside are the curtain wall's, thirty-two pairs
         of them down one elevation. */
      for (let z = a + 2; z < b; z += 2.5) {
        put(0.34, CEIL - 0.3, 0.2, bronze, face - side * 0.85, CT_LOBBY + CEIL / 2, z, { group });
      }
    }
    /* Over the doors, and the revolving drum itself: a bronze cylinder made of
       four quadrants, which at this size reads as a revolving door and at any
       size is a thing that touches the ground. */
    put(0.5, CEIL - 4.4, CT_DOOR_HALF * 2, cream, face - side * 0.5,
        CT_LOBBY + 4.4 + (CEIL - 4.4) / 2, doorAt, { group });
    /*
     * A revolving door as a post and two screens, not four vanes.
     *
     * Vanes radiating from the middle sweep the whole opening, so however they
     * are drawn they stand in the way you walk — two and a half thousand cells
     * of it. What is left standing when the door has turned is the centre post
     * and the two curved screens, and the way through is between them, which
     * is how you walk through a revolving door anyway.
     */
    put(0.4, 3.6, 0.4, bronze, face - side * 0.5, CT_LOBBY + 1.8, doorAt, { group });
    for (const q of [-1, 1] as const) {
      put(0.24, 3.6, 1.6, bronze, face - side * 0.5, CT_LOBBY + 1.8,
          doorAt + q * (CT_DOOR_HALF - 0.6), { group });
    }
    put(3.2, 0.34, 3.2, bronze, face - side * 0.5, CT_LOBBY + 3.75, doorAt, { group });
    lamp(face - side * 1.6, CT_LOBBY + 3.4, doorAt, 16, 120, true);

    /* The lift core, against the back wall: a stone box with four doors. */
    put(5, CEIL - 3, 14, ashlar, back - side * 3.2, CT_LOBBY + (CEIL - 3) / 2, cz, { group });
    for (const s of [-1, 1]) for (const t of [-1, 1]) {
      put(0.16, 3.1, 1.9, bronze, back - side * 5.75, CT_LOBBY + 1.55, cz + s * 4 + t * 1.2, { group });
    }
    lamp(back - side * 8, CT_LOBBY + 4.2, cz, 20, 150, true);

    /* The counter, with a stone top and a light over it. */
    put(9, 1.1, 2.2, timber, cx + side * 5, CT_LOBBY + 0.55, cz - d / 4, { group });
    put(9.4, 0.12, 2.6, ashlar, cx + side * 5, CT_LOBBY + 1.16, cz - d / 4, { group });
    lamp(cx + side * 5, CT_LOBBY + 4.4, cz - d / 4, 16, 130, true);

    /* The gallery: a floor round two sides, its edge beam, and a rail. */
    /* Written by its two edges, not by a centre and a depth: adding to both
       the depth and the centre moves the far edge and leaves the near one
       exactly on the gallery's line, which is the glass's line too. */
    {
      const near = l.z1 - CT_GALLERY - 0.15;
      const far = l.z1 + 0.2;
      put(w + 0.4, 0.5, far - near, cream, cx, CT_MEZZ - 0.25, (near + far) / 2, { group });
    }
    const gx = back + (side < 0 ? 1 : -1) * CT_GALLERY / 2;
    /* And two centimetres shallower than the run it meets, so the two beams
       of the L do not share an upper face. */
    put(CT_GALLERY + 0.7, 0.44, d - CT_GALLERY + 0.4, cream, gx + (side < 0 ? -0.35 : 0.35),
        CT_MEZZ - 0.24, (l.z0 + l.z1 - CT_GALLERY) / 2, { group });
    /* Reaching back over the stair's mouth, because the flight's last tread is
       the gallery and is not drawn twice — without this there are thirty-eight
       cells at the head of the stair standing on nothing. */
    {
      const near = l.z1 - CT_GALLERY - 0.4;
      slab(w, l.z1 - near, cx, CT_MEZZ + 0.01, (near + l.z1) / 2, boards);
    }
    /* Two planes at one depth genuinely do fight, and the L's two arms are
       two planes: three millimetres between them and neither ever wins. */
    slab(CT_GALLERY, d - CT_GALLERY, gx, CT_MEZZ + 0.024,
         (l.z0 + l.z1 - CT_GALLERY) / 2, boards);
    /* Its rail, with the hole where the stair arrives — the same hole the
       collision has, off the same two numbers. */
    const stairAt = sAt;
    const inner = side < 0 ? l.x0 + CT_GALLERY : l.x1 - CT_GALLERY;
    /* Held a hand clear of the curtain wall at its far end: run right up to
       the glass and the rail's end face is the glass's face. */
    for (const [a, b] of (side < 0
      ? [[inner, stairAt - CT_STAIR.half], [stairAt + CT_STAIR.half, l.x1 - 0.15]]
      : [[l.x0 + 0.15, stairAt - CT_STAIR.half], [stairAt + CT_STAIR.half, inner]]) as [number, number][]) {
      if (b - a < 0.05) continue;
      put(b - a, 1.05, 0.16, bronze, (a + b) / 2, CT_MEZZ + 0.53, l.z1 - CT_GALLERY - 0.2, { group });
      put(b - a, 0.1, 0.3, timber, (a + b) / 2, CT_MEZZ + 1.1, l.z1 - CT_GALLERY - 0.2, { group });
    }
    /* A hair shorter than the run it meets at the corner, so the two arms of
       the rail do not share a top, an underside or an end. */
    put(0.16, 1.0, d - CT_GALLERY + 0.3, bronze, inner + (side < 0 ? 0.2 : -0.2), CT_MEZZ + 0.5,
        (l.z0 + l.z1 - CT_GALLERY) / 2, { group });
    put(0.3, 0.09, d - CT_GALLERY + 0.3, timber, inner + (side < 0 ? 0.2 : -0.2), CT_MEZZ + 1.06,
        (l.z0 + l.z1 - CT_GALLERY) / 2, { group });

    /* The open stair up to it, tread by tread, off the collision's numbers. */
    {
      const steps = Math.round(Math.abs(CT_MEZZ - CT_LOBBY) / CT_STAIR.rise);
      const start = l.z1 - CT_GALLERY - CT_STAIR.run;
      const tread = CT_STAIR.run / steps;
      for (let i = 0; i < steps; i++) {
        const z = start + tread * (i + 0.5);
        const y = CT_LOBBY + ((CT_MEZZ - CT_LOBBY) / steps) * (i + 1);
        /* The last tread *is* the gallery — drawn as well, its top and the
           gallery's beam are one surface. The deck's flight learnt this first. */
        if (i === steps - 1) continue;
        put(CT_STAIR.half * 2, 0.24, tread + 0.004, timber, stairAt, y - 0.12, z);
        /*
         * Two balustrades at the sides, stepping with the treads, and nothing
         * at all underneath.
         *
         * A closed string is drawn across the whole width of the flight and
         * the lobby floor runs beneath it — three and a half thousand cells of
         * duelist standing inside a staircase. This is what an open stair is:
         * two solid sides and the treads between them, and you walk under it.
         *
         * Up to a hand over the tread, not level with it: `walls` reads a spot
         * as a segment from the shin to the chest, so a side that is one step
         * high at the foot of a flight is a thing you are stopped by with
         * nothing drawn across you. A stair has a balustrade.
         */
        for (const q of [-1, 1] as const) {
          const top = y + 1.05;
          put(0.2, top - CT_LOBBY, tread - 0.02, cream,
              stairAt + q * (CT_STAIR.half + 0.1), CT_LOBBY + (top - CT_LOBBY) / 2, z);
          put(0.3, 0.09, tread - 0.02, timber,
              stairAt + q * (CT_STAIR.half + 0.1), top + 0.06, z);
        }
      }
    }

    /* Ceiling fittings, and the pool of light they make. */
    for (const z of [cz - d / 3, cz, cz + d / 3]) {
      put(2.4, 0.3, 2.4, cream, cx, CT_LOBBY + CEIL - 0.35, z, { cast: false, group });
      put(2.1, 0.12, 2.1, roomLight, cx, CT_LOBBY + CEIL - 0.56, z, { cast: false, group });
      lamp(cx, CT_LOBBY + CEIL - 1.2, z, 24, 190, true);
    }
  };

  lobby(CT_WLOBBY, -1, CT_WDOOR, 'wlobby');
  lobby(CT_ELOBBY, 1, CT_EDOOR, 'elobby');

  /* ---------------------------------------------------------------- */
  /* the arms, under the street                                        */
  /* ---------------------------------------------------------------- */

  for (const [arm, side] of [[CT_ARM_W, -1], [CT_ARM_E, 1]] as const) {
    const H = 3.6;
    /* Walls, a soffit, and a floor: a corridor, not a slot. */
    /* The face of the podium, where the tunnel under the canyon becomes the
       hall under the lobby and the ceiling goes up by two metres. */
    const face = side < 0 ? CT_WLOBBY.x1 : CT_ELOBBY.x0;
    /* Fifty millimetres past the wall at each end rather than stopping on its
       face: a soffit that lands exactly on the plane of the wall it meets is
       two square metres of the two of them fighting. */
    const [t0, t1] = side < 0 ? [face + 0.05, arm.x1 + 0.05] : [arm.x0 - 0.05, face - 0.05];
    /*
     * Walls in two runs, because the two halves of an arm have different
     * things over them: the tunnel has the canyon's pavement and stops at its
     * own soffit, the hall has the lobby floor six metres up and goes to it.
     *
     * One run at the taller height stood three hundred millimetres proud of
     * the paving out in the canyon — a hundred and ninety-two cells with their
     * feet in it. They overlap by three hundred at the join, so neither end
     * face shares a plane with the other's.
     */
    const CEIL = CT_LOW + H + 0.44;
    const head = side < 0 ? arm.x0 : arm.x1;
    const open = side < 0 ? head + CT_SLOT : head - CT_SLOT;
    for (const z of [CT_ARM.z0, CT_ARM.z1]) {
      const zz = z + Math.sign(z) * 0.25;
      /* Reaching to the middle of the well's own wall at the mouth and no
         further: seven hundred the other way put a metre of corridor wall out
         in the open forecourt with nothing under it. */
      const run = (a: number, b: number, top: number) =>
        put(Math.abs(b - a), top - CT_LOW, 0.5, cream, (a + b) / 2,
            CT_LOW + (top - CT_LOW) / 2, zz);
      /* Abutting, never overlapping: two runs of one wall that lap each other
         share both long faces over the lap, which is a square metre of
         flicker. Overlap is for a junction between two walls that cross. */
      run(face, side < 0 ? arm.x1 - 0.4 : arm.x0 + 0.4, CEIL + 0.06);
      run(open, face, CT_LOBBY - 0.05);
      /* And beside the stairwell it carries on past the floor as its parapet,
         with a bronze coping — which is what stops you walking into the hole
         and is drawn where it stops you. */
      run(head, open, CT_LOBBY + 1.05);
      put(Math.abs(open - head) + 0.04, 0.09, 0.58, bronze, (head + open) / 2,
          CT_LOBBY + 1.095, zz, { cast: false });
    }
    /* The tunnel's soffit, under the canyon's pavement only. Run the whole
       length it passed straight through the flight: the treads are over four
       metres up by the time they are under the lobby. */
    put(t1 - t0, 0.44, CT_ARM.z1 - CT_ARM.z0 + 0.8, cream, (t0 + t1) / 2,
        CT_LOW + H + 0.22, 0, { cast: false });
    /* And the face between the two ceilings, from just under the tunnel's to
       just over the hall's — every edge of it clear of both, and of the wall it
       stands on, and of the pavement over it. */
    put(0.6, 5.90 - 3.55, CT_ARM.z1 - CT_ARM.z0 + 0.9, cream,
        face, CT_LOW + (3.55 + 5.90) / 2, 0, { cast: false });
    /* The far end, past the top of the flight — stopping *at* the lobby floor
       it holds up, not fifteen centimetres proud of it. */
    put(0.5, CT_LOBBY - CT_LOW, CT_ARM.z1 - CT_ARM.z0 + 1, cream,
        side < 0 ? arm.x0 - 0.25 : arm.x1 + 0.25, CT_LOW + (CT_LOBBY - CT_LOW) / 2, 0);
    /* The flight up into the lobby, and its soffit. */
    {
      const steps = Math.round(Math.abs(CT_LOBBY - CT_LOW) / CT_RISE.rise);
      const from = side < 0 ? arm.x1 - CT_ARM_FLAT : arm.x0 + CT_ARM_FLAT;
      const tread = (side < 0 ? -CT_RISE.run : CT_RISE.run) / steps;
      for (let i = 0; i < steps; i++) {
        const x = from + tread * (i + 0.5);
        const y = CT_LOW + ((CT_LOBBY - CT_LOW) / steps) * (i + 1);
        put(Math.abs(tread) + 0.004, 0.26, CT_RISE.half * 2, ashlar, x, y - 0.13, 0);
        put(Math.abs(tread) - 0.02, y - CT_LOW, CT_RISE.half * 2 - 0.12, cream,
            x, CT_LOW + (y - CT_LOW) / 2 - 0.13, 0, { cast: false });
      }
    }
    /* Two lights in the tunnel, because a tunnel with one is a tunnel with a
       bright end — hung from its own soffit and nowhere near the flight, which
       is where these two used to be. */
    for (const k of [0.3, 0.7]) {
      const x = t0 + (t1 - t0) * k;
      put(1.4, 0.24, 1.0, cream, x, CT_LOW + H - 0.3, 0, { cast: false });
      put(1.2, 0.1, 0.8, roomLight, x, CT_LOW + H - 0.47, 0, { cast: false });
      lamp(x, CT_LOW + H - 0.9, 0, 18, 160, true);
    }
    /* And a bracket on each wall of the roofed half of the hall, above the
       treads. The rest of the flight comes up into the lobby's own light. */
    for (const z of [CT_ARM.z0, CT_ARM.z1]) {
      const x = face - side * 2;
      const zz = z - Math.sign(z) * 0.5;
      put(0.5, 0.12, 0.5, bronze, x, CT_LOW + 4.6, zz, { cast: false });
      put(0.34, 0.34, 0.34, lampGlass, x, CT_LOW + 4.42, zz, { cast: false });
      lamp(x, CT_LOW + 4.3, zz, 16, 140, true);
    }
  }

  /* ---------------------------------------------------------------- */
  /* the deck, the alley and the colonnade                             */
  /* ---------------------------------------------------------------- */

  {
    /* The deck is the roof of the east podium's southern third. Its mass is
       drawn to the height you stand on, and the podium beside it is taller. */
    const d = CT_DECK_AT;
    put(d.x1 - d.x0, CT_DECK - CT_WALK, d.z1 - d.z0, stone,
        (d.x0 + d.x1) / 2, CT_WALK + (CT_DECK - CT_WALK) / 2, (d.z0 + d.z1) / 2, { group: 'deck' });
    slab(d.x1 - d.x0, d.z1 - d.z0, (d.x0 + d.x1) / 2, CT_DECK + 0.01, (d.z0 + d.z1) / 2, slabs);
    /* Its balustrade, with the gap where the flight lands. */
    for (const [a, b] of [[d.z0, CT_UP_AT - CT_UP.half], [CT_UP_AT + CT_UP.half, d.z1]]) {
      put(0.4, 1.1, b - a, ashlar, d.x0 + 0.2, CT_DECK + 0.55, (a + b) / 2, { group: 'deck' });
      put(0.56, 0.14, b - a, kerb, d.x0 + 0.2, CT_DECK + 1.17, (a + b) / 2, { group: 'deck' });
    }
    put(d.x1 - d.x0 - 0.8, 1.04, 0.4, ashlar, (d.x0 + d.x1) / 2, CT_DECK + 0.52, d.z1 - 0.2, { group: 'deck' });
    put(d.x1 - d.x0 - 0.8, 0.14, 0.56, kerb, (d.x0 + d.x1) / 2, CT_DECK + 1.11, d.z1 - 0.2, { group: 'deck' });
    /* The flight up on to it out of the canyon. */
    {
      const steps = Math.round(Math.abs(CT_DECK - CT_WALK) / CT_UP.rise);
      const tread = -CT_UP.run / steps;
      for (let i = 0; i < steps; i++) {
        const x = d.x0 + tread * (i + 0.5);
        const y = CT_DECK + ((CT_WALK - CT_DECK) / steps) * (i + 1);
        /* Drawn, all of them. The last tread used to be skipped because its
           top and the pavement plane were one surface — but the pavement is
           cut round this flight now, so skipping it leaves eighteen cells at
           the foot of the stair standing on nothing at all. */
        put(Math.abs(tread) + 0.004, 0.28, CT_UP.half * 2, ashlar, x, y - 0.14, CT_UP_AT);
        /* Exactly the tread's width and stopping under it: wider or taller and
           you stand on the pavement beside the flight with it through your
           feet. The lobby stairs learnt this first. */
        /* And none under the tread that sits on the ground: nought high, its
           top and the tread's are one surface. */
        if (y - 0.14 - CT_WALK > 0.02) {
          /* Its underside a hand below the pavement, so it does not share a
             base with the podium's plinth course beside it. */
          const h = y - 0.14 - (CT_WALK - 0.16);
          put(Math.abs(tread) - 0.02, h, CT_UP.half * 2 - 0.12, stone,
              x, CT_WALK - 0.16 + h / 2, CT_UP_AT, { cast: false });
        }
      }
      for (const s of [-1, 1]) {
        put(CT_UP.run - 0.8, 1.0, 0.3, ashlar, d.x0 - CT_UP.run / 2 - 0.4,
            CT_WALK + (CT_DECK - CT_WALK) / 2 + 0.85, CT_UP_AT + s * (CT_UP.half + 0.15));
      }
      lamp(d.x0 - 2, CT_DECK + 1.4, CT_UP_AT, 18, 120);
    }
    /* Two lamps on the deck itself. */
    for (const z of [d.z0 + 10, d.z1 - 10]) {
      put(0.3, 4.4, 0.3, iron, d.x0 + 5, CT_DECK + 2.2, z);
      put(0.8, 0.3, 0.8, iron, d.x0 + 5, CT_DECK + 4.55, z);
      put(0.7, 0.12, 0.7, lampGlass, d.x0 + 5, CT_DECK + 4.4, z);
      lamp(d.x0 + 5, CT_DECK + 4.2, z, 22, 160);
    }
  }

  {
    /* The city along each long edge, which the alley and the colonnade have
       their backs against: plain blocks, and the alley is the gap. */
    /*
     * Tiled to the solid's own extent, exactly.
     *
     * Stepped twenty-four and drawn twenty-two, they leave two metres of gap
     * between every pair and the last one hangs six metres past the end of the
     * collision — four thousand seven hundred cells of duelist standing inside
     * a building that is not there.
     */
    const RUN = CT_IN.z - 6;
    const N = 8;
    const DZ = (RUN * 2) / N;
    for (const [a, b] of [[-CT_IN.x, CT_ALLEY.x0], [CT_ARCADE.x1, CT_IN.x]]) {
      for (let i = 0; i < N; i++) {
        const z = -RUN + DZ * (i + 0.5);
        const h = 16 + rnd() * 10;
        put(b - a, h, DZ, stone, (a + b) / 2, CT_WALK + h / 2, z, { group: 'edge' });
        put(b - a + 0.6, 0.6, DZ - 0.4, kerb, (a + b) / 2, CT_WALK + h + 0.3, z, { group: 'edge' });
      }
    }
    /* Standards down both cross streets, on the pavement at the kerb. Two
       hundred and thirty-six metres of road each with nothing lighting them. */
    for (const s of [-1, 1]) for (const x of [-80, -30, 30, 80]) {
      const z = s * 79;
      put(0.34, 5.2, 0.34, iron, x, CT_WALK + 2.6, z);
      put(0.9, 0.34, 0.9, iron, x, CT_WALK + 5.35, z);
      put(0.8, 0.14, 0.8, lampGlass, x, CT_WALK + 5.15, z);
      lamp(x, CT_WALK + 5.0, z, 26, 170);
    }
    /*
     * The alley's back-of-house wall: lamps, service doors, downpipes.
     *
     * Eight metres of blank render on both sides and not one light in it — the
     * only place in the city with no lamp at all, and at night a corridor you
     * cannot see the end of. Everything here is on the podium's own face and
     * inside the collision of its plinth course, so none of it is anything you
     * can walk into.
     */
    {
      /*
       * All of it on the wall's own face and inside the collision of the
       * plinth course, which reaches six hundred out from it. Hung off the
       * plinth's *drawn* face instead — a hundred further out than anything
       * stops you — and the downpipes were things you walked through and their
       * shoes were things you stood inside.
       *
       * And the doors are loading shutters over the plinth, not doors through
       * it: the plinth is nine hundred tall and a door in front of it is a
       * door with its bottom metre buried in stone.
       */
      const F = CT_ALLEY.x1;
      for (let z = CT_WEST.z0 + 6; z < CT_WEST.z1; z += 18) {
        put(0.45, 0.12, 0.12, iron, F - 0.25, CT_WALK + 4.5, z);
        put(0.42, 0.5, 0.42, iron, F - 0.45, CT_WALK + 4.2, z);
        put(0.34, 0.16, 0.34, lampGlass, F - 0.45, CT_WALK + 3.93, z);
        lamp(F - 0.55, CT_WALK + 3.8, z, 18, 140, true);
      }
      for (let z = CT_WEST.z0 + 14; z < CT_WEST.z1; z += 26) {
        put(0.14, 2.9, 3, dark, F - 0.09, 8.6, z);
        put(0.2, 3.2, 3.4, kerbDark, F - 0.05, 8.7, z, { cast: false });
        put(0.5, 0.16, 3.6, kerb, F - 0.25, 10.3, z, { cast: false });
      }
      for (let z = CT_WEST.z0 + 3; z < CT_WEST.z1; z += 13) {
        put(0.24, 15, 0.24, iron, F - 0.16, CT_WALK + 7.5, z, { cast: false });
      }
    }
    /* The colonnade: a covered walk down the east tower's far side. */
    for (let z = CT_EAST.z0 + 4; z < CT_EAST.z1; z += 6) {
      put(1.1, 5.4, 1.1, ashlar, CT_ARCADE.x1 - 1.4, CT_WALK + 2.7, z, { group: 'arcade' });
    }
    put(CT_ARCADE.x1 - CT_ARCADE.x0 + 1, 0.7, CT_EAST.z1 - CT_EAST.z0 - 0.6, cream,
        (CT_ARCADE.x0 + CT_ARCADE.x1) / 2, CT_WALK + 5.75, (CT_EAST.z0 + CT_EAST.z1) / 2,
        { group: 'arcade' });
    for (let z = CT_EAST.z0 + 10; z < CT_EAST.z1; z += 20) {
      put(0.9, 0.24, 0.9, cream, CT_ARCADE.x1 - 4, CT_WALK + 5.3, z, { cast: false, group: 'arcade' });
      put(0.75, 0.1, 0.75, lampGlass, CT_ARCADE.x1 - 4, CT_WALK + 5.13, z, { cast: false, group: 'arcade' });
      lamp(CT_ARCADE.x1 - 4, CT_WALK + 5.0, z, 20, 150, true);
    }
  }

  /* ---------------------------------------------------------------- */
  /* what is beyond the gate                                           */
  /* ---------------------------------------------------------------- */

  /*
   * Station Plaza, south of the wall — a closed box with the first two metres
   * of the square in it, sized so no sight line through a fourteen-metre gate
   * reaches an edge of it. A back thin in *z*, returns thin in *x*: the school's
   * was copied from the station's and never turned, and came out as a fin
   * standing on edge down the middle of its own gateway.
   */
  {
    const sz = CT_IN.z + 2;
    const BACK = sz + 11;
    /* In render rather than the perimeter's own ashlar, and given a face.
       Built in the same stone as the wall it stands 28 m behind, blank, and lit
       by the gate's own lamp, it read as the wall carrying straight on: you
       stood in front of the one way out of this place and saw masonry. What
       says "there is a square through there" is a building on the far side of
       it with its lights on. */
    put(26, 17, 2.6, warm, CT_GATE, CT_WALK + 8, BACK);
    {
      const F = BACK - 1.3;                       // the face that looks at the gate
      /* Its underside below the pavement, so it does not share one with the
         shelter standing on the same ground. */
      put(25, 1.1, 0.9, kerbDark, CT_GATE, CT_WALK + 0.5, F - 0.35);
      put(25, 0.7, 1.2, kerb, CT_GATE, CT_WALK + 14.6, F - 0.5);
      /* Small and many, in a reveal: seven windows two metres wide across
         twenty-three of wall is a grid of playing cards, not a building. */
      for (let i = 0; i < 11; i++) {
        for (let row = 0; row < 5; row++) {
          const lit = (i * 4 + row * 3) % 9 < 3;
          const x = CT_GATE + (i - 5) * 2.1;
          const y = CT_WALK + 2.4 + row * 2.9;
          put(1.5, 2.1, 0.24, kerbDark, x, y, F - 0.05);
          put(1.1, 1.7, 0.3, lit ? roomLight : glassDark, x, y, F - 0.12);
        }
      }
    }
    for (const s of [-1, 1]) {
      put(2.6, 17.7, 11, stone, CT_GATE + s * 12, CT_WALK + 8.05, sz + 5.5);
    }
    /* Its lid in the city's own grey, not in black: the returns stand seven
       metres over the perimeter wall, so from inside the site — and any time
       Mike drags the camera up — the top of this box is on the skyline, and a
       black slab there is a hole in the sky. */
    put(28, 1.4, 13, city, CT_GATE, CT_WALK + 17.4, sz + 5.4);
    put(28.8, 0.7, 13.4, kerb, CT_GATE, CT_WALK + 16.6, sz + 5.4);
    slab(21, 12, CT_GATE, CT_WALK + 0.02, sz + 5.6, paving0);
    /* Two metres of the square: a kerb, a standard burning, a bus shelter's
       end. Enough that the gate says where it goes. */
    put(20, 0.16, 0.5, kerb, CT_GATE, CT_WALK + 0.08, sz + 3, { cast: false });
    put(0.34, 5.2, 0.34, iron, CT_GATE + 7, CT_WALK + 2.6, sz + 6);
    put(0.9, 0.34, 0.9, iron, CT_GATE + 7, CT_WALK + 5.35, sz + 6);
    put(0.8, 0.14, 0.8, lampGlass, CT_GATE + 7, CT_WALK + 5.15, sz + 6);
    lamp(CT_GATE + 6, CT_WALK + 5.0, sz + 5.5, 30, 200, true);
    put(9, 2.6, 2.4, glassDark, CT_GATE - 6, CT_WALK + 1.3, sz + 8);
    put(9.6, 0.3, 2.9, cream, CT_GATE - 6, CT_WALK + 2.75, sz + 8);
  }

  /* And three ranks of city over the perimeter, so the horizon is a city. */
  {
    const lay = (side: 'n' | 'e' | 'w' | 's', rank: number) => {
      const back = 16 + rank * 26;
      for (let i = 0; i < 8; i++) {
        const t = (i / 7 - 0.5) * 2;
        const jitter = (rnd() - 0.5) * 16;
        const w = 16 + rnd() * 20;
        const h = (24 + rnd() * 20 + rank * 6) * (side === 'n' ? 1.25 : 1);
        const sink = 1 + rnd() * 3;
        const piece = (px: number, pz: number, pw: number, pd: number) => {
          const group = `city${px.toFixed(0)}:${pz.toFixed(0)}`;
          put(pw, h + sink, pd, city, px, CT_WALK + (h + sink) / 2 - sink, pz,
              { cast: false, group });
          /*
           * And a face on it. A block of one flat colour at forty metres is a
           * piece of card standing on the skyline, which is what the two over
           * the head of the forecourt's stair looked like: courses of glass
           * with a few of them burning, and a cap, and it is a building.
           */
          put(pw + 0.6, 0.7, pd + 0.6, kerb, px, CT_WALK + h - 0.1, pz,
              { cast: false, group });
          /* Every side and every fourth block on its own line, because two
             blocks that touch at a corner put their courses in one plane. */
          const off = (side === 'n' ? 0 : side === 'e' ? 0.13 : side === 'w' ? 0.26 : 0.39)
                    + (i % 4) * 0.07;
          for (let r = 0; r * 3.6 + 4.5 < h; r++) {
            const y = CT_WALK + 2.6 + r * 3.6 + off;
            const m = (i * 5 + r * 3) % 11 < 2 ? roomLight : glassDark;
            if (side === 'n') put(pw - 3, 1.5, 0.3, m, px, y, pz + pd / 2 - 0.1, { cast: false, group });
            if (side === 's') put(pw - 3, 1.5, 0.3, m, px, y, pz - pd / 2 + 0.1, { cast: false, group });
            if (side === 'e') put(0.3, 1.5, pd - 3, m, px - pw / 2 + 0.1, y, pz, { cast: false, group });
            if (side === 'w') put(0.3, 1.5, pd - 3, m, px + pw / 2 - 0.1, y, pz, { cast: false, group });
          }
        };
        if (side === 'n') piece(t * (OUT_X + 16) + jitter, -OUT_Z - back, w, 14 + rnd() * 14);
        if (side === 'e') piece(OUT_X + back, t * (OUT_Z + 16) + jitter, 14 + rnd() * 14, w);
        if (side === 'w') piece(-OUT_X - back, t * (OUT_Z + 16) + jitter, 14 + rnd() * 14, w);
        /* Kept well inside the east and west ranks: laid to the same spread as
           the north one, the outermost of these stood in the same place as a
           west-rank block and shared five hundred square metres of face with
           it. */
        if (side === 's') piece(t * (OUT_X - 30) + jitter, OUT_Z + back, w, 14 + rnd() * 14);
      }
    };
    /* South last, so the other three keep the horizon they were signed off
       with — and south at all, because it had none: over the wall to Station
       Plaza there was the lid of the box behind the gate and then sky. */
    for (const side of ['n', 'e', 'w', 's'] as const) for (let r = 0; r < 3; r++) lay(side, r);
  }

  bake();

  /* ---------------------------------------------------------------- */
  /* light                                                             */
  /* ---------------------------------------------------------------- */

  /*
   * A canyon is enclosure, and enclosure wants fill.
   *
   * Two shafts seventy and eighty-four metres tall, forty-four metres apart,
   * running north to south: one of their facing elevations is in the other's
   * shadow at every hour of the day, and the forecourt at the bottom of the
   * hole never sees the sun at all. Without fill the whole middle of this area
   * — which is all of it you are ever walking down — is a black slot. The
   * shadow camera has to cover the towers as well as the ground, because what
   * casts across this site is eighty metres of building.
   */
  const sky = ownSky(own, new Sky(own, root, {
    reach: 200,
    half: 152,
    deep: 134,
    target: [0, 8, 0],
    /* A hole six metres deep between two towers seventy and eighty-four metres
       tall: at 1.35 the forecourt and both its flights were a black wedge at
       every hour of the day. Fill is about enclosure, and nothing in this city
       is more enclosed than the bottom of this one. */
    fill: 1.7,
    normalBias: 0.12,
  }));
  sky.claim();
  /* Claimed first, then the ones that never go out are taken back off the
     list — a lobby burns at noon and so does a hole six metres deep. */
  for (const l of burning) sky.burning(l);

  return {
    root,
    setTime: (hour) => { sky.apply(hour); },
    dispose() {
      for (const item of own.items) item.dispose();
      for (const lamp of lights) lamp.shadow?.map?.dispose();
    },
  };
}
