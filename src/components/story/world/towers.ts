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
  CT_UP, CT_UP_AT, CT_WALK, CT_WDOOR, CT_WELL, CT_WEST, CT_WEST_SHAFT, CT_WLOBBY,
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
  const pave = (w: number, d: number, x: number, z: number) =>
    slab(w, d, x, CT_WALK + 0.004, z, paving0);
  for (const s of [-1, 1]) {
    pave(CT_IN.x * 2, 6, 0, s * 95);
    slab(CT_IN.x * 2, 12, 0, CT_ROAD + 0.006, s * 86, road);
  }
  pave(CT_IN.x * 2, CT_DROP_N.start + 80, 0, (-80 + CT_DROP_N.start) / 2);
  pave(CT_IN.x * 2, 80 - CT_DROP_S.start, 0, (80 + CT_DROP_S.start) / 2);
  for (const f of [CT_DROP_N, CT_DROP_S]) for (const s of [-1, 1]) {
    pave(CT_IN.x - CT_DROP.half, Math.abs(f.end - f.start),
         s * (CT_IN.x + CT_DROP.half) / 2, (f.start + f.end) / 2);
  }
  for (const s of [-1, 1]) {
    pave(CT_IN.x - CT_WELL.x1, CT_WELL.z1 * 2, s * (CT_IN.x + CT_WELL.x1) / 2, 0);
  }
  /* Kerbs down both sides of each cross street. */
  for (const s of [-1, 1]) for (const t of [-1, 1]) {
    put(CT_IN.x * 2, 0.15, 0.4, kerb, 0, CT_ROAD + 0.075, s * 86 + t * 6, { cast: false });
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
      put(b - a, 0.3, 2.4, kerb, (a + b) / 2, CT_ROAD + H + 0.15, at, { group: 'wall' });
    }
    put(OUT_X * 2, H, 2, stone, 0, CT_ROAD + H / 2, -at, { group: 'wall' });
    put(OUT_X * 2, 0.3, 2.4, kerb, 0, CT_ROAD + H + 0.15, -at, { group: 'wall' });
    for (const s of [-1, 1]) {
      put(2, H, OUT_Z * 2 - 4, stone, s * (CT_IN.x + 1), CT_ROAD + H / 2, 0, { group: 'wall' });
      put(2.4, 0.3, OUT_Z * 2 - 4, kerb, s * (CT_IN.x + 1), CT_ROAD + H + 0.15, 0, { group: 'wall' });
    }
    /* The gate's piers, and its name where it can be read from the ground. */
    for (const s of [-1, 1]) {
      put(2, 5.4, 2.6, ashlar, CT_GATE + s * (CT_GATE_HALF + 1), CT_ROAD + 2.7, at);
      put(2.4, 0.34, 3, kerb, CT_GATE + s * (CT_GATE_HALF + 1), CT_ROAD + 5.57, at);
      put(0.5, 0.5, 0.5, iron, CT_GATE + s * (CT_GATE_HALF + 1), CT_ROAD + 6.0, at);
      put(0.4, 0.2, 0.4, lampGlass, CT_GATE + s * (CT_GATE_HALF + 1), CT_ROAD + 5.9, at);
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
   * A podium: the storeys at street level, in stone, with a colonnade of piers
   * down the face that meets the canyon.
   */
  const podium = (b: { x0: number; x1: number; z0: number; z1: number; top: number }, face: number, group: string) => {
    const w = b.x1 - b.x0, d = b.z1 - b.z0;
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    put(w, b.top, d, stone, cx, CT_WALK + b.top / 2, cz, { group });
    /* A plinth, a string course at the first floor, and a cornice. */
    put(w + 0.7, 0.9, d + 0.7, ashlar, cx, CT_WALK + 0.45, cz, { group });
    put(w + 0.5, 0.4, d + 0.5, kerb, cx, CT_WALK + 6.4, cz, { group });
    put(w + 1.1, 1.1, d + 1.1, ashlar, cx, CT_WALK + b.top - 0.55, cz, { group });
    /* Piers down the canyon face, and glazing between them. */
    for (let z = b.z0 + 4; z < b.z1 - 2; z += 8) {
      put(1.6, b.top - 1.6, 1.4, ashlar, face, CT_WALK + (b.top - 1.6) / 2 + 0.9, z, { group });
      put(0.9, 4.4, 6.2, glassLit, face, CT_WALK + 3.3, z + 4, { group });
      put(0.9, 3.2, 6.2, spandrel, face, CT_WALK + 7.6, z + 4, { group });
    }
  };

  podium(CT_WEST, CT_WEST.x1 - 0.4, 'west');
  podium(CT_EAST, CT_EAST.x0 + 0.4, 'east');
  shaft(CT_WEST_SHAFT, CT_WALK + CT_WEST.top, 'westShaft');
  shaft(CT_EAST_SHAFT, CT_WALK + CT_EAST.top, 'eastShaft');

  /* ---------------------------------------------------------------- */
  /* the canyon and the hole in it                                     */
  /* ---------------------------------------------------------------- */

  {
    /* The well's retaining walls: what you meet as a parapet from the street
       and as a wall from the bottom, and therefore one piece of stone. */
    const H = CT_ROAD;
    for (const s of [-1, 1]) {
      for (const [a, b] of [[CT_WELL.z0 - 0.8, CT_ARM.z0], [CT_ARM.z1, CT_WELL.z1 + 0.8]]) {
        put(0.8, H + 1.1, b - a, ashlar, s * (CT_WELL.x1 + 0.4), (H + 1.1) / 2, (a + b) / 2);
      }
    }
    for (const z of [CT_WELL.z0, CT_WELL.z1]) {
      for (const [a, b] of [[CT_WELL.x0 - 0.8, -CT_DROP.half], [CT_DROP.half, CT_WELL.x1 + 0.8]]) {
        put(b - a, H + 1.1, 0.8, ashlar, (a + b) / 2, (H + 1.1) / 2, z + Math.sign(z) * 0.4);
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
      /* The cheeks either side, stepping with the flight. */
      for (const s of [-1, 1]) {
        for (let i = 0; i < steps; i++) {
          const z = f.start + tread * (i + 0.5);
          const y = CT_WALK + ((CT_LOW - CT_WALK) / steps) * (i + 1);
          put(1, CT_ROAD + 1.1 - (CT_WALK - y), 0.004 + Math.abs(tread), ashlar,
              s * (CT_DROP.half + 0.5), (y + CT_ROAD + 1.1) / 2 - 0.05, z);
        }
      }
    }

    /* Lamp standards down the canyon, and two in the hole. */
    for (const z of [-64, -44, 44, 64]) for (const s of [-1, 1]) {
      const x = s * 19;
      put(0.34, 5.2, 0.34, iron, x, CT_WALK + 2.6, z);
      put(0.9, 0.34, 0.9, iron, x, CT_WALK + 5.35, z);
      put(0.8, 0.14, 0.8, lampGlass, x, CT_WALK + 5.15, z);
      lamp(x, CT_WALK + 5.0, z, 26, 170);
    }
    for (const s of [-1, 1]) {
      const z = s * 11;
      put(0.3, 4.2, 0.3, iron, 12, CT_LOW + 2.1, z);
      put(0.8, 0.3, 0.8, iron, 12, CT_LOW + 4.35, z);
      put(0.7, 0.12, 0.7, lampGlass, 12, CT_LOW + 4.2, z);
      lamp(12, CT_LOW + 4.0, z, 22, 180, true);
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
    const slot0 = side < 0 ? l.x1 - 6 : l.x0;
    const slot1 = side < 0 ? l.x1 : l.x0 + 6;
    const plate = side < 0 ? l.x0 : l.x1;
    slab(Math.abs((side < 0 ? slot0 : slot1) - plate), d,
         (plate + (side < 0 ? slot0 : slot1)) / 2, CT_LOBBY + 0.01, cz, boards);
    for (const [a, b] of [[l.z0, CT_ARM.z0], [CT_ARM.z1, l.z1]] as const) {
      slab(slot1 - slot0, b - a, (slot0 + slot1) / 2, CT_LOBBY + 0.01, (a + b) / 2, boards);
    }
    put(w, 0.5, d, cream, cx, CT_LOBBY + CEIL + 0.25, cz, { cast: false, group });
    for (const z of [l.z0, l.z1]) {
      put(w, CEIL, 0.5, cream, cx, CT_LOBBY + CEIL / 2, z + Math.sign(z - cz) * 0.25, { group });
    }
    put(0.5, CEIL, d, cream, back - side * 0.25, CT_LOBBY + CEIL / 2, cz, { group });

    /*
     * The canyon wall: glass from the floor to the ceiling in bronze mullions,
     * with the revolving doors in the middle of it. This is the elevation the
     * street sees lit at night, so it is the one that has to be honest.
     */
    for (const [a, b] of [[l.z0, doorAt - CT_DOOR_HALF], [doorAt + CT_DOOR_HALF, l.z1]]) {
      put(0.5, CEIL, b - a, glassLit, face + side * 0.25, CT_LOBBY + CEIL / 2, (a + b) / 2, { group });
      for (let z = a + 2; z < b; z += 2.5) {
        put(0.34, CEIL, 0.2, bronze, face + side * 0.35, CT_LOBBY + CEIL / 2, z, { group });
      }
    }
    /* Over the doors, and the revolving drum itself: a bronze cylinder made of
       four quadrants, which at this size reads as a revolving door and at any
       size is a thing that touches the ground. */
    put(0.5, CEIL - 4.4, CT_DOOR_HALF * 2, cream, face + side * 0.25,
        CT_LOBBY + 4.4 + (CEIL - 4.4) / 2, doorAt, { group });
    for (let i = 0; i < 4; i++) {
      put(0.16, 3.6, 2.6, bronze, face - side * 0.4, CT_LOBBY + 1.8, doorAt,
          { rotY: (i * Math.PI) / 4 + 0.4, group });
    }
    put(3.2, 0.34, 3.2, bronze, face - side * 0.4, CT_LOBBY + 3.75, doorAt, { group });
    lamp(face - side * 1.6, CT_LOBBY + 3.4, doorAt, 16, 120, true);

    /* The lift core, against the back wall: a stone box with four doors. */
    put(5, CEIL - 3, 14, ashlar, back + side * 3.2, CT_LOBBY + (CEIL - 3) / 2, cz, { group });
    for (const s of [-1, 1]) for (const t of [-1, 1]) {
      put(0.16, 3.1, 1.9, bronze, back + side * 5.75, CT_LOBBY + 1.55, cz + s * 4 + t * 1.2, { group });
    }
    lamp(back + side * 8, CT_LOBBY + 4.2, cz, 20, 150, true);

    /* The counter, with a stone top and a light over it. */
    put(9, 1.1, 2.2, timber, cx + side * 5, CT_LOBBY + 0.55, cz - d / 4, { group });
    put(9.4, 0.12, 2.6, ashlar, cx + side * 5, CT_LOBBY + 1.16, cz - d / 4, { group });
    lamp(cx + side * 5, CT_LOBBY + 4.4, cz - d / 4, 16, 130, true);

    /* The gallery: a floor round two sides, its edge beam, and a rail. */
    put(w, 0.5, CT_GALLERY, cream, cx, CT_MEZZ - 0.25, l.z1 - CT_GALLERY / 2, { group });
    put(CT_GALLERY, 0.5, d - CT_GALLERY, cream, l.x0 + CT_GALLERY / 2, CT_MEZZ - 0.25,
        (l.z0 + l.z1 - CT_GALLERY) / 2, { group });
    slab(w, CT_GALLERY, cx, CT_MEZZ + 0.01, l.z1 - CT_GALLERY / 2, boards);
    slab(CT_GALLERY, d - CT_GALLERY, l.x0 + CT_GALLERY / 2, CT_MEZZ + 0.01,
         (l.z0 + l.z1 - CT_GALLERY) / 2, boards);
    /* Its rail, with the hole where the stair arrives — the same hole the
       collision has, off the same two numbers. */
    const stairAt = cx + 6;
    for (const [a, b] of [[l.x0 + CT_GALLERY, stairAt - CT_STAIR.half], [stairAt + CT_STAIR.half, l.x1]]) {
      if (b - a < 0.05) continue;
      put(b - a, 1.05, 0.16, bronze, (a + b) / 2, CT_MEZZ + 0.53, l.z1 - CT_GALLERY - 0.2, { group });
      put(b - a, 0.1, 0.3, timber, (a + b) / 2, CT_MEZZ + 1.1, l.z1 - CT_GALLERY - 0.2, { group });
    }
    put(0.16, 1.05, d - CT_GALLERY, bronze, l.x0 + CT_GALLERY + 0.2, CT_MEZZ + 0.53,
        (l.z0 + l.z1 - CT_GALLERY) / 2, { group });
    put(0.3, 0.1, d - CT_GALLERY, timber, l.x0 + CT_GALLERY + 0.2, CT_MEZZ + 1.1,
        (l.z0 + l.z1 - CT_GALLERY) / 2, { group });

    /* The open stair up to it, tread by tread, off the collision's numbers. */
    {
      const steps = Math.round(Math.abs(CT_MEZZ - CT_LOBBY) / CT_STAIR.rise);
      const start = l.z1 - CT_GALLERY - CT_STAIR.run;
      const tread = CT_STAIR.run / steps;
      for (let i = 0; i < steps; i++) {
        const z = start + tread * (i + 0.5);
        const y = CT_LOBBY + ((CT_MEZZ - CT_LOBBY) / steps) * (i + 1);
        put(CT_STAIR.half * 2, 0.24, tread + 0.004, timber, stairAt, y - 0.12, z);
        /* A stringer under it, stepping with the treads, so the flight has an
           underside and is not a run of floating boards. */
        /* Exactly the tread's width, not a hand wider: the extra stood proud
           of the flight on both sides and you could stand on the lobby floor
           beside it with your feet inside the beam. */
        put(CT_STAIR.half * 2, y - CT_LOBBY, tread + 0.004, cream,
            stairAt, CT_LOBBY + (y - CT_LOBBY) / 2 - 0.12, z, { cast: false });
      }
      for (const s of [-1, 1]) {
        put(0.14, 1.0, CT_STAIR.run, bronze, stairAt + s * CT_STAIR.half,
            CT_LOBBY + (CT_MEZZ - CT_LOBBY) / 2 + 1.1, start + CT_STAIR.run / 2,
            { rotZ: 0, group });
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
    const cx = (arm.x0 + arm.x1) / 2;
    const w = arm.x1 - arm.x0;
    const H = 3.6;
    /* Walls, a soffit, and a floor: a corridor, not a slot. */
    for (const z of [CT_ARM.z0, CT_ARM.z1]) {
      put(w, H, 0.5, cream, cx, CT_LOW + H / 2, z + Math.sign(z) * 0.25);
    }
    put(w, 0.5, CT_ARM.z1 - CT_ARM.z0 + 1, cream, cx, CT_LOW + H + 0.25, 0, { cast: false });
    /* The far end, past the top of the flight — stopping *at* the lobby floor
       it holds up, not fifteen centimetres proud of it. */
    put(0.5, CT_LOBBY - CT_LOW, CT_ARM.z1 - CT_ARM.z0 + 1, cream,
        side < 0 ? arm.x0 - 0.25 : arm.x1 + 0.25, CT_LOW + (CT_LOBBY - CT_LOW) / 2, 0);
    /* The flight up into the lobby, and its soffit. */
    {
      const steps = Math.round(Math.abs(CT_LOBBY - CT_LOW) / CT_RISE.rise);
      const from = side < 0 ? arm.x1 : arm.x0;
      const tread = (side < 0 ? -CT_RISE.run : CT_RISE.run) / steps;
      for (let i = 0; i < steps; i++) {
        const x = from + tread * (i + 0.5);
        const y = CT_LOW + ((CT_LOBBY - CT_LOW) / steps) * (i + 1);
        put(Math.abs(tread) + 0.004, 0.26, CT_RISE.half * 2, ashlar, x, y - 0.13, 0);
        put(Math.abs(tread) + 0.004, y - CT_LOW, CT_RISE.half * 2 + 0.3, cream,
            x, CT_LOW + (y - CT_LOW) / 2 - 0.13, 0, { cast: false });
      }
    }
    /* Two lights, because a tunnel with one is a tunnel with a bright end. */
    for (const k of [0.3, 0.7]) {
      const x = arm.x0 + (arm.x1 - arm.x0) * k;
      put(1.4, 0.24, 1.0, cream, x, CT_LOW + H - 0.3, 0, { cast: false });
      put(1.2, 0.1, 0.8, roomLight, x, CT_LOW + H - 0.47, 0, { cast: false });
      lamp(x, CT_LOW + H - 0.9, 0, 18, 160, true);
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
    put(d.x1 - d.x0, 1.1, 0.4, ashlar, (d.x0 + d.x1) / 2, CT_DECK + 0.55, d.z1 - 0.2, { group: 'deck' });
    put(d.x1 - d.x0, 0.14, 0.56, kerb, (d.x0 + d.x1) / 2, CT_DECK + 1.17, d.z1 - 0.2, { group: 'deck' });
    /* The flight up on to it out of the canyon. */
    {
      const steps = Math.round(Math.abs(CT_DECK - CT_WALK) / CT_UP.rise);
      const tread = -CT_UP.run / steps;
      for (let i = 0; i < steps; i++) {
        const x = d.x0 + tread * (i + 0.5);
        const y = CT_DECK + ((CT_WALK - CT_DECK) / steps) * (i + 1);
        put(Math.abs(tread) + 0.004, 0.28, CT_UP.half * 2, ashlar, x, y - 0.14, CT_UP_AT);
        put(Math.abs(tread) + 0.004, y - CT_WALK + 0.3, CT_UP.half * 2 + 0.4, stone,
            x, CT_WALK + (y - CT_WALK) / 2 - 0.14, CT_UP_AT, { cast: false });
      }
      for (const s of [-1, 1]) {
        put(CT_UP.run, 1.0, 0.3, ashlar, d.x0 - CT_UP.run / 2,
            CT_WALK + (CT_DECK - CT_WALK) / 2 + 0.9, CT_UP_AT + s * (CT_UP.half + 0.15));
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
    for (const [a, b] of [[-CT_IN.x, CT_ALLEY.x0], [CT_ARCADE.x1, CT_IN.x]]) {
      for (let z = -(CT_IN.z - 6); z < CT_IN.z - 6; z += 24) {
        const h = 16 + rnd() * 10;
        put(b - a, h, 22, stone, (a + b) / 2, CT_WALK + h / 2, z + 11, { group: 'edge' });
        put(b - a + 0.6, 0.6, 22.6, kerb, (a + b) / 2, CT_WALK + h + 0.3, z + 11, { group: 'edge' });
      }
    }
    /* The colonnade: a covered walk down the east tower's far side. */
    for (let z = CT_EAST.z0 + 4; z < CT_EAST.z1; z += 6) {
      put(1.1, 5.4, 1.1, ashlar, CT_ARCADE.x1 - 1.4, CT_WALK + 2.7, z, { group: 'arcade' });
    }
    put(CT_ARCADE.x1 - CT_ARCADE.x0 + 1, 0.7, CT_EAST.z1 - CT_EAST.z0, cream,
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
    put(26, 17, 2.6, stone, CT_GATE, CT_WALK + 8, BACK);
    for (const s of [-1, 1]) {
      put(2.6, 17.7, 11, stone, CT_GATE + s * 12, CT_WALK + 8.05, sz + 5.5);
    }
    put(28, 1.4, 13, dark, CT_GATE, CT_WALK + 17.4, sz + 5.4);
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
    const lay = (side: 'n' | 'e' | 'w', rank: number) => {
      const back = 16 + rank * 26;
      for (let i = 0; i < 8; i++) {
        const t = (i / 7 - 0.5) * 2;
        const jitter = (rnd() - 0.5) * 16;
        const w = 16 + rnd() * 20;
        const h = (24 + rnd() * 20 + rank * 6) * (side === 'n' ? 1.25 : 1);
        const sink = 1 + rnd() * 3;
        const piece = (px: number, pz: number, pw: number, pd: number) =>
          put(pw, h + sink, pd, city, px, CT_WALK + (h + sink) / 2 - sink, pz,
              { cast: false, group: `city${px.toFixed(0)}:${pz.toFixed(0)}` });
        if (side === 'n') piece(t * (OUT_X + 16) + jitter, -OUT_Z - back, w, 14 + rnd() * 14);
        if (side === 'e') piece(OUT_X + back, t * (OUT_Z + 16) + jitter, 14 + rnd() * 14, w);
        if (side === 'w') piece(-OUT_X - back, t * (OUT_Z + 16) + jitter, 14 + rnd() * 14, w);
      }
    };
    for (const side of ['n', 'e', 'w'] as const) for (let r = 0; r < 3; r++) lay(side, r);
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
    fill: 1.35,
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
