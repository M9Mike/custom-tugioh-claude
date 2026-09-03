/**
 * Domino Shrine — the precinct above the south side of Turtle Lane.
 *
 * Sixty-four metres by fifty-two, and the first area in this world you can get
 * lost in for a moment. Everything before it was a route; this is grounds.
 *
 * ## What that costs, and what it buys
 *
 * A corridor hides the void for free — you are always looking along it at a wall
 * at the far end. An open precinct has a horizon in every direction, so the
 * enclosure has to be built deliberately: a wall on three sides, two groves of
 * real trees standing in front of it, and the hill of the terrace behind you as
 * you come up the steps.
 *
 * What it buys is a player deciding where to go. The approach runs dead straight
 * from the gate to the hall and everything else is off it — the basin west, the
 * plaque rack east, a smaller shrine inside the eastern trees that you only find
 * by leaving the path, and a stone behind the hall you only find by walking round
 * it. The middle is empty gravel on purpose. Emptiness is what makes the sides
 * worth looking at.
 *
 * ## Dusk, and the light
 *
 * The same evening as everywhere else. Stone lanterns down the avenue with a
 * flame in a few of them, the hall lit from under its eaves, and the moon doing
 * the rest — so the gravel reads pale, the trees read as mass, and the only warm
 * things are the ones somebody lit.
 */

import * as THREE from 'three';
import { gravel, concrete, paving, darkWood, brick, plaster, asphalt, soil, signBoard } from './surfaces';
import {
  Owned, box, matt, tiled, glow, surfaceOf, seeded, type BuiltArea,
} from './kit';
import { Sky, ownSky } from './sky';
import {
  AREAS, SHRINE_FLOOR, SHRINE_PLATFORM, SHRINE_GROUND, SHRINE_THINGS, groundAt,
} from '@/story/areas';

const AREA = AREAS['domino-shrine'];

/** How high the ground is at a point. The one source for every height here. */
const at = (x: number, z: number) => groundAt(AREA, x, z);

export function buildShrine(anisotropy: number): BuiltArea {
  const own = new Owned();
  const root = new THREE.Group();
  root.name = 'domino-shrine';
  const rnd = seeded(0x5417e);

  /* ---- surfaces ---- */

  /* Four metres of ground per tile put the grain below noticing and the tile
     itself well above it. Under three is the other way round. */
  const gravelTex = surfaceOf(own, gravel, 20, 14, anisotropy);
  const stoneTex = surfaceOf(own, () => concrete('#847f74'), 1, 1, anisotropy);
  const wallTex = surfaceOf(own, () => plaster('#b6ab95'), 1, 1, anisotropy);
  const timberTex = surfaceOf(own, darkWood, 1, 2, anisotropy);
  const soilTex = surfaceOf(own, soil, 1, 1, anisotropy);

  const stone = () => tiled(matt(own, '#ffffff', stoneTex));
  const plaster_ = () => tiled(matt(own, '#ffffff', wallTex));
  const timber = matt(own, '#ffffff', timberTex);
  const post = matt(own, '#6a5442');
  /*
   * Everything reads a stop lighter than it would in daylight.
   *
   * At night a material's colour is nearly all of what you see of it — there is
   * no sun to model the form — so the tile, the timber and the leaves were all
   * chosen as if lit and came out as one black mass with lanterns floating in
   * front of it. The hall in particular is the thing the whole precinct points
   * at, and it was a silhouette against a sky the same colour as itself.
   */
  const roofTile = matt(own, '#525a63');
  const vermilion = matt(own, '#9c4433');
  const rope = matt(own, '#c9bda0');
  const leaf = [matt(own, '#3d5a42'), matt(own, '#48684c', ), matt(own, '#37503c')];
  /* Bark, which was written inline at #4a3b30 and so never got the stop that
     everything above it got. On the far side of a trunk from the moon that is
     no colour at all, and the groves came out as black posts. */
  const bark = matt(own, '#7e6854');
  /*
   * The hill behind the fence, which is lighter than the trees in front of it.
   *
   * Not an error and not the same material: things far off at night are lighter
   * and bluer than things close, because there is air between. Painted at the
   * near green it stops being a hillside and becomes a hole in the world — and
   * a hole is exactly what somebody standing behind the hall was looking at.
   */
  const far = [matt(own, '#55705c'), matt(own, '#607d68'), matt(own, '#4c6754')];
  const hallWood = matt(own, '#6b5340');

  /* Every light with a shadow map to give back on the way out. Declared up
     here because the way out of the precinct is lit too, and that is built
     before anything that stands in the grounds. */
  const lamps: THREE.PointLight[] = [];

  /* ---- the ground ---- */

  /* The gravel of the precinct, which is most of what you stand on. */
  /*
   * The tone across it is painted into the mesh, not into the tile.
   *
   * A tile cannot carry anything metres wide: whatever it carries comes round
   * again every few metres and reads as a grid — which is how the nine soft
   * patches that used to be in `gravel()` earned their removal. The plane can
   * carry it, because it is one piece fifty-six metres across and its vertices
   * never come round at all. Eight per cent either way, which is nothing to look
   * at directly and the difference between ground and cardboard at a distance.
   */
  /* Wider and deeper than the fence that rings it. At 56 by 39 the ground
     stopped 25 cm inside the fence line, so the fence and the gate posts stood
     on the last of it with their undersides out over nothing — which is the
     same fault as a floor that does not reach its wall, one storey up and
     outdoors.

     North and sideways only: the south edge stops on the entrance step, whose
     top is at this exact height, and a plane laid over that is the flicker this
     is trying to avoid. */
  const yardGeo = own.keep(new THREE.PlaneGeometry(57.4, 39.6, 28, 20));
  const yp = yardGeo.attributes.position;
  const tone = new Float32Array(yp.count * 3);
  for (let i = 0; i < yp.count; i++) {
    const u = yp.getX(i);
    const v = yp.getY(i);
    const t = 1 + 0.085 * (
      Math.sin(u * 0.13 + 1.7) * Math.cos(v * 0.11 - 0.4) * 0.5 +
      Math.sin(u * 0.31 - 2.2) * Math.cos(v * 0.27 + 1.1) * 0.3 +
      Math.sin((u + v) * 0.07) * 0.2
    );
    tone[i * 3] = t;
    tone[i * 3 + 1] = t;
    tone[i * 3 + 2] = t * 0.99;
  }
  yardGeo.setAttribute('color', new THREE.BufferAttribute(tone, 3));
  const yardMat = matt(own, '#ffffff', gravelTex);
  yardMat.vertexColors = true;
  const yard = new THREE.Mesh(yardGeo, yardMat);
  yard.rotation.x = -Math.PI / 2;
  yard.position.set(0, SHRINE_FLOOR, 4.8);
  yard.receiveShadow = true;
  root.add(yard);

  /*
   * The approach, paved, running the length of it.
   *
   * A shrine's path is flagged even when the rest is loose, because it is the
   * one part everybody walks — and it is what makes the avenue read as an
   * avenue rather than as two rows of lanterns standing in a field.
   */
  const sando = new THREE.Mesh(
    own.keep(new THREE.PlaneGeometry(6, 21)),
    matt(own, '#ffffff', surfaceOf(own, () => paving({ dirt: 0.2, vary: 0.4 }), 3, 10, anisotropy))
  );
  sando.rotation.x = -Math.PI / 2;
  sando.position.set(0, SHRINE_FLOOR + 0.012, -4.5);
  sando.receiveShadow = true;
  root.add(sando);

  /*
   * The mass of the steps and the hall's platform, one box per tread.
   *
   * Not the precinct itself. It is 56 by 39 and the gravel plane covers every
   * centimetre of its top, so drawing it as a solid put two thousand square
   * metres of hidden surface four millimetres under a visible one — the largest
   * coplanar pair this world has ever had, and all of it for a face nobody can
   * see. What is actually needed is its *edge*, which is a skirt.
   */
  for (const t of SHRINE_GROUND) {
    if (t.y <= 0.001 || t.hw > 20) continue;
    root.add(box(own, t.hw * 2, t.y, t.hd * 2, stone(), t.x, t.y / 2, t.z));
  }
  /*
   * The precinct's own edge: a kerb standing proud of the gravel it holds in.
   *
   * Proud, not flush. Level with the gravel its top is the same plane as a
   * surface fifty metres across, and the five of them meeting at the corners are
   * the same plane as each other — so they abut here rather than overlap, and
   * stand nine centimetres above, which is both what a stone edging does and
   * what leaves nothing at one depth.
   */
  const KERB = SHRINE_FLOOR + 0.09;
  for (const [ex, ez, ew, ed] of [
    [-28.3, 4.35, 0.6, 38.1], [28.3, 4.35, 0.6, 38.1],
    [0, 23.7, 56, 0.6],
    [-16.5, -14.85, 23, 0.3], [16.5, -14.85, 23, 0.3],
  ] as const) {
    root.add(box(own, ew, KERB, ed, stone(), ex, KERB / 2, ez));
  }
  /* The floor of the passage, level with the street. */
  const passage = new THREE.Mesh(
    own.keep(new THREE.PlaneGeometry(10, 5.5)),
    matt(own, '#ffffff', surfaceOf(own, paving, 3, 2, anisotropy))
  );
  passage.rotation.x = -Math.PI / 2;
  passage.position.set(0, 0.006, -23.25);
  root.add(passage);

  /* A nosing on each of the great flight's steps. */
  for (const t of SHRINE_GROUND) {
    if (t.y <= 0.001 || t.hd > 0.4) continue;
    /*
     * Wholly on its own tread, not overhanging the one below.
     *
     * At `- t.hd + 0.02` the nosing stuck 15 mm out past the front of its step,
     * so for that sliver the ground was *drawn* at this step's height while
     * `groundAt` answered with the step below — 18 cm of daylight under the
     * player's feet, forty cells wide, twelve times over. `npm run footing`
     * counted 475 of them.
     */
    root.add(box(own, t.hw * 2, 0.05, 0.07, matt(own, '#6f6a60'), t.x, t.y - 0.02, t.z - t.hd + 0.036));
  }

  /* ---- the way in ---- */

  /*
   * Walls each side of the approach, and the terrace behind you.
   *
   * From inside the precinct this is the only edge that is not trees, so it has
   * to hold on its own: a plastered wall with a tiled coping, the back of the
   * street's terrace rising over it, and the roofs of Turtle Lane beyond that.
   */
  for (const side of [-1, 1] as const) {
    root.add(box(own, 27, 3.4, 11, plaster_(), side * 18.5, SHRINE_FLOOR + 1.7, -20.5));
    root.add(box(own, 27.4, 0.3, 11.4, roofTile, side * 18.5, SHRINE_FLOOR + 3.5, -20.5));
    /* The wall carrying on along the sides of the steps, down to the passage. */
    /* Set in from the outer wall's face at ±5 rather than landing on it. */
    /* And 40 cm shorter than the outer wall, whose ends it was landing on. */
    root.add(box(own, 1.8, 4.6, 10.6, plaster_(), side * 6.1, 2.3, -20.5));
    root.add(box(own, 2.1, 0.26, 10.9, roofTile, side * 6.1, 4.72, -20.5));
  }
  /*
   * The back of the street's terrace, and the way out cut through it.
   *
   * This was one block of brick forty metres wide with nothing in it. The door
   * worked — walk south and the street loads — but what you were walking at was
   * a blank wall, and a wall is what it read as: no opening, no light, nothing
   * to say there was a city on the other side. The way out of an area has to
   * look like a way out from the far end of it, or nobody believes there is one.
   */
  const terraceBrick = tiled(
    matt(own, '#ffffff', surfaceOf(own, () => brick('#7a6357'), 1, 1, anisotropy))
  );
  /** Half the opening, and how high it goes. */
  const WAY_W = 3.2;
  const WAY_H = 4.2;
  for (const side of [-1, 1] as const) {
    const w = 20 - WAY_W;
    root.add(box(own, w, 11, 4, terraceBrick, side * (WAY_W + w / 2), 5.5, -28));
  }
  /* The brick carried over the top of it. */
  root.add(box(own, WAY_W * 2, 11 - WAY_H, 4, terraceBrick, 0, (WAY_H + 11) / 2, -28));
  for (let i = 0; i < 5; i++) {
    root.add(box(own, 6.4, 0.5, 4.6, roofTile, -16 + i * 8, 11.3, -28));
  }

  /*
   * A stone surround standing proud of the brick, which is what turns a hole
   * into a doorway. Wholly in front of the face rather than let into it: set
   * into the wall, every one of these shares a plane with the brick it is
   * supposed to be sitting on.
   */
  for (const side of [-1, 1] as const) {
    root.add(box(own, 0.5, WAY_H, 0.7, stone(), side * (WAY_W + 0.1), WAY_H / 2, -25.65));
  }
  root.add(box(own, WAY_W * 2 + 1.2, 0.5, 0.7, stone(), 0, WAY_H + 0.25, -25.65));

  /* The floor under it, carrying on out of sight. */
  const throughFloor = new THREE.Mesh(
    own.keep(new THREE.PlaneGeometry(WAY_W * 2, 4)),
    matt(own, '#ffffff', surfaceOf(own, () => paving({ dirt: 0.4 }), 2, 1.4, anisotropy))
  );
  throughFloor.rotation.x = -Math.PI / 2;
  throughFloor.position.set(0, 0.008, -28);
  throughFloor.receiveShadow = true;
  root.add(throughFloor);

  /*
   * And a piece of Turtle Lane at the end of it.
   *
   * You cannot see into the next area — it is a different scene — but you can
   * see that there *is* one. The road surface, the far side of the street, and
   * a lit window on it: three boxes that turn the end of the passage from a
   * black stop into somewhere the passage goes.
   */
  const road = new THREE.Mesh(
    own.keep(new THREE.PlaneGeometry(30, 6)),
    matt(own, '#ffffff', surfaceOf(own, asphalt, 6, 1.4, anisotropy))
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.004, -33);
  root.add(road);
  root.add(box(own, 30, 10, 0.8, terraceBrick, 0, 5, -36.4));
  for (const wx of [-3.4, 3.4]) {
    root.add(box(own, 1.5, 1.8, 0.14, glow(own, '#c9a05c'), wx, 3.1, -35.95));
  }
  const beyond = new THREE.PointLight('#ffd0a0', 30, 20, 2);
  beyond.position.set(0, 4.4, -33.6);
  root.add(beyond);
  lamps.push(beyond);

  /* A lamp in the mouth of it, so the way out is the brightest thing on this
     side of the precinct rather than the darkest. */
  root.add(box(own, 0.34, 0.5, 0.24, glow(own, '#d9a25e'), 0, WAY_H - 0.5, -26.1));
  const wayOut = new THREE.PointLight('#ffbc78', 34, 15, 2);
  wayOut.position.set(0, WAY_H - 0.7, -26.6);
  root.add(wayOut);
  lamps.push(wayOut);

  /* ---- the precinct wall and the trees behind it ---- */

  const fence = (cx: number, cz: number, w: number, d: number, along: 'x' | 'z') => {
    const y = SHRINE_FLOOR;
    const len = along === 'x' ? w : d;
    root.add(box(own, w, 0.34, d, stone(), cx, y + 0.17, cz));
    root.add(box(own, along === 'x' ? w : 0.2, 1.5, along === 'x' ? 0.2 : d, post,
                 cx, y + 1.05, cz));
    root.add(box(own, along === 'x' ? w + 0.3 : 0.34, 0.16, along === 'x' ? 0.34 : d + 0.3,
                 matt(own, '#57453a'), cx, y + 1.86, cz));
    const posts = Math.max(2, Math.round(len / 2.4));
    for (let i = 0; i <= posts; i++) {
      const t = -len / 2 + (len / posts) * i;
      /* Set 5 cm into the base rather than standing on exactly its underside,
         which is a plane the two of them shared all the way along. */
      root.add(box(own, 0.24, 1.95, 0.24, post,
                   cx + (along === 'x' ? t : 0), y + 0.925, cz + (along === 'x' ? 0 : t)));
    }
  };
  /* Stopping a metre short of the approach wall rather than standing in it. */
  /* Meeting the back fence rather than crossing it: overlapping, the two share
     both their top and their underside along the whole corner. */
  fence(-28.6, 4.775, 0.7, 37.55, 'z');
  fence(28.6, 4.775, 0.7, 37.55, 'z');
  /*
   * The back fence, in two pieces with the gate to the burial ground between
   * them.
   *
   * A shrine's own graveyard is behind it, and this is the way through — the
   * one opening in three sides of fence, on the west side of the hall where you
   * only find it by walking round. Everything about it is smaller than the way
   * in from the street, which is the point: that is the entrance and this is a
   * back gate.
   */
  fence(-23.85, 23.9, 9.3, 0.7, 'x');
  fence(6.65, 23.9, 43.7, 0.7, 'x');
  {
    const gx = -17.2;
    const gz = 23.9;
    const gy = SHRINE_FLOOR;
    for (const side of [-1, 1] as const) {
      root.add(box(own, 0.44, 3.1, 0.44, post, gx + side * 2, gy + 1.55, gz));
      root.add(box(own, 0.62, 0.18, 0.62, stone(), gx + side * 2, gy + 3.19, gz));
    }
    root.add(box(own, 5.2, 0.34, 0.5, post, gx, gy + 3.45, gz));
    root.add(box(own, 6, 0.26, 0.9, matt(own, '#57453a'), gx, gy + 3.75, gz));
    /*
     * And what is beyond it, which is not the cemetery — that is a different
     * scene. A closed box, for the same reason Black Crown Games has one behind
     * its front door: a doorway you can see through is a doorway you can see the
     * void through, and `npm run areas` counted five thousand sight lines
     * leaving the precinct through this gap the moment it was cut.
     */
    const beyond = matt(own, '#2b2f28');
    root.add(box(own, 6.4, 4.2, 0.4, beyond, gx, gy + 2.1, gz + 2.2));
    for (const side of [-1, 1] as const) {
      root.add(box(own, 0.4, 4.2, 2.1, beyond, gx + side * 2.6, gy + 2.05, gz + 1.15));
    }
    root.add(box(own, 6.2, 0.4, 2.7, beyond, gx, gy + 4.35, gz + 1.3));
    const lamp = new THREE.PointLight('#ffb469', 20, 9, 2);
    lamp.position.set(gx, gy + 2.6, gz - 1.4);
    root.add(lamp);
    lamps.push(lamp);
    /*
     * And what is *in* the box, because a closed box you can see into is a
     * hole until something stands in it.
     *
     * Standing at the gate, what you saw through it was flat black: the box
     * did its one job — nothing past its edges — and nothing else. What is
     * actually through that gate is a burial ground, so the first two metres
     * of it are here: the path going on, a stone lantern burning beside it, and
     * two markers behind, dark against the dark. Enough to say where the gate
     * goes; the real ground is built when you walk through.
     */
    root.add(box(own, 5.4, 0.04, 1.9, matt(own, '#3a4032'), gx, gy + 0.02, gz + 1.05));
    root.add(box(own, 1.6, 0.02, 1.9, matt(own, '#9a9382'), gx, gy + 0.05, gz + 1.05));
    const lx = gx + 1.4;
    const lz = gz + 1.3;
    root.add(box(own, 0.5, 0.2, 0.5, stone(), lx, gy + 0.14, lz));
    root.add(box(own, 0.24, 0.9, 0.24, stone(), lx, gy + 0.69, lz));
    root.add(box(own, 0.44, 0.44, 0.44, glow(own, '#c9954e'), lx, gy + 1.36, lz));
    root.add(box(own, 0.6, 0.12, 0.6, stone(), lx, gy + 1.64, lz));
    const grave = matt(own, '#4a4b45');
    root.add(box(own, 0.5, 0.9, 0.3, grave, gx - 1.5, gy + 0.49, gz + 1.5));
    root.add(box(own, 0.42, 0.7, 0.28, grave, gx - 0.6, gy + 0.39, gz + 1.7));
    const yonder = new THREE.PointLight('#ffb469', 14, 6, 2);
    yonder.position.set(lx, gy + 1.36, lz);
    root.add(yonder);
    lamps.push(yonder);
  }

  /* Beyond the fence, the hill: dark tree mass and nothing you can reach. */
  for (let i = 0; i < 34; i++) {
    const side = i % 3;
    const bx = side === 0 ? -31 - (i % 4) * 1.6
             : side === 1 ? 31 + (i % 4) * 1.6
             : -26 + ((i * 7.3) % 52);
    const bz = side === 2 ? 26 + (i % 3) * 2.2 : -18 + ((i * 9.1) % 44);
    const s = 4.2 + ((i * 0.53) % 2.6);
    const m = box(own, s, s * 0.85, s, far[i % 3], bx, SHRINE_FLOOR + 5.6 + ((i * 0.41) % 3.4), bz);
    m.rotation.set(0.2 + i * 0.31, 0.4 + i * 0.77, 0.12 + i * 0.59);
    /* Neither casting nor receiving. This is scenery on the far side of a fence
       nobody crosses: shadowing it only ever subtracted the little light it had
       and turned the treeline into the same black as the sky behind it. */
    m.castShadow = false;
    m.receiveShadow = false;
    root.add(m);
  }

  /* ---- what stands in the grounds ---- */

  const torii = (t: (typeof SHRINE_THINGS)[number]) => {
    const y = at(t.x, t.z);
    const big = t.hw > 3.4;
    const skin = big ? stone() : vermilion;
    const h = big ? 5.2 : 4.4;
    const span = t.hw * 2;
    for (const side of [-1, 1] as const) {
      const leg = box(own, 0.44, h, 0.44, skin, t.x + side * (t.hw - 0.3), y + h / 2, t.z);
      leg.rotation.z = -side * 0.024;
      root.add(leg);
      root.add(box(own, 0.6, 0.24, 0.6, skin, t.x + side * (t.hw - 0.3), y + 0.12, t.z));
    }
    /* The two rails: the curved one over the top and the straight one under it. */
    root.add(box(own, span + 1.5, 0.4, 0.72, skin, t.x, y + h - 0.05, t.z));
    root.add(box(own, span + 1.9, 0.2, 0.4, matt(own, big ? '#6f6a60' : '#3b2b22'), t.x, y + h + 0.28, t.z));
    root.add(box(own, span - 0.2, 0.28, 0.5, skin, t.x, y + h - 1.0, t.z));
    /* And the plaque hung between them. */
    root.add(box(own, 0.8, 0.7, 0.12, matt(own, '#3b2b22'), t.x, y + h - 0.52, t.z - 0.24));
  };

  const lantern = (t: (typeof SHRINE_THINGS)[number]) => {
    const y = at(t.x, t.z);
    root.add(box(own, 0.84, 0.26, 0.84, stone(), t.x, y + 0.13, t.z));
    root.add(box(own, 0.44, 1.06, 0.44, stone(), t.x, y + 0.79, t.z));
    root.add(box(own, 0.78, 0.16, 0.78, stone(), t.x, y + 1.4, t.z));
    /* The fire box, and the light in about half of them. */
    root.add(box(own, 0.62, 0.6, 0.62, stone(), t.x, y + 1.78, t.z));
    const alight = t.lit === true;
    for (const s of [-1, 1] as const) {
      root.add(box(own, 0.34, 0.36, 0.03, alight ? glow(own, '#d9a25e') : matt(own, '#2b2723'),
                   t.x + s * 0.32, y + 1.78, t.z));
      root.add(box(own, 0.03, 0.36, 0.34, alight ? glow(own, '#d9a25e') : matt(own, '#2b2723'),
                   t.x, y + 1.78, t.z + s * 0.32));
    }
    /* The roof, and the bud on top. */
    const cap = box(own, 1.06, 0.3, 1.06, stone(), t.x, y + 2.2, t.z);
    root.add(cap);
    root.add(box(own, 0.26, 0.34, 0.26, stone(), t.x, y + 2.5, t.z));
    if (alight) {
      const flame = new THREE.PointLight('#ffb063', 34, 9.5, 2);
      flame.position.set(t.x, y + 1.8, t.z);
      root.add(flame);
      lamps.push(flame);
    }
  };

  const chozuya = (t: (typeof SHRINE_THINGS)[number]) => {
    const y = at(t.x, t.z);
    /* The basin. */
    root.add(box(own, t.hw * 2, 0.2, t.hd * 2, stone(), t.x, y + 0.1, t.z));
    root.add(box(own, t.hw * 2 - 0.5, 0.72, t.hd * 2 - 0.4, stone(), t.x, y + 0.56, t.z));
    /*
     * The water: the one smooth thing in the precinct.
     *
     * As a flat matt slab it read as pond scum, because matt is what everything
     * else here is and the eye has nothing to tell it this is a liquid. What
     * says water is the lamp overhead arriving back as a hard highlight, and
     * that needs a low roughness — which is the whole difference.
     */
    root.add(box(own, t.hw * 2 - 0.9, 0.1, t.hd * 2 - 0.8,
                 own.keep(new THREE.MeshStandardMaterial({
                   color: '#16232b', roughness: 0.11, metalness: 0.12,
                 })), t.x, y + 0.92, t.z));
    /* The bamboo spout over it, and the dippers across the rim. */
    root.add(box(own, 0.09, 0.09, 1.1, matt(own, '#9aa36a'), t.x, y + 1.36, t.z - 0.3));
    root.add(box(own, 0.09, 0.44, 0.09, matt(own, '#9aa36a'), t.x, y + 1.14, t.z - 0.82));
    for (let i = 0; i < 3; i++) {
      root.add(box(own, 0.14, 0.06, 0.5, matt(own, '#8a7248'), t.x - 0.7 + i * 0.7, y + 0.99, t.z));
      root.add(box(own, 0.16, 0.09, 0.16, matt(own, '#6f5a3a'), t.x - 0.7 + i * 0.7, y + 1.02, t.z + 0.28));
    }
    /* Four posts and a roof over the lot. */
    /* Set in from the edge of the base and 5 cm into it, rather than flush with
       its side and standing on exactly its underside. */
    for (const sx of [-1, 1] as const) {
      for (const sz of [-1, 1] as const) {
        root.add(box(own, 0.2, 2.45, 0.2, post,
                     t.x + sx * (t.hw - 0.22), y + 1.175, t.z + sz * (t.hd - 0.22)));
      }
    }
    root.add(box(own, t.hw * 2 + 1.1, 0.18, t.hd * 2 + 1.1, timber, t.x, y + 2.46, t.z));
    for (const sz of [-1, 1] as const) {
      const slope = box(own, t.hw * 2 + 1.3, 0.16, t.hd + 0.9, roofTile,
                        t.x, y + 2.76, t.z + sz * (t.hd * 0.55));
      slope.rotation.x = sz * 0.3;
      root.add(slope);
    }
    const wash = new THREE.PointLight('#ffbe78', 22, 8, 2);
    wash.position.set(t.x, y + 2.1, t.z);
    root.add(wash);
    lamps.push(wash);
  };

  const ema = (t: (typeof SHRINE_THINGS)[number]) => {
    const y = at(t.x, t.z);
    for (const s of [-1, 1] as const) {
      root.add(box(own, 0.16, 2.1, 0.16, post, t.x + s * t.hw, y + 1.05, t.z));
    }
    root.add(box(own, t.hw * 2 + 0.3, 0.14, 0.14, post, t.x, y + 1.95, t.z));
    root.add(box(own, t.hw * 2 + 0.5, 0.14, 0.7, roofTile, t.x, y + 2.16, t.z));
    /* The plaques, hung in two rows and none of them straight. */
    for (let i = 0; i < 14; i++) {
      const px = t.x - t.hw + 0.28 + (i % 7) * ((t.hw * 2 - 0.56) / 6);
      const py = y + 1.66 - Math.floor(i / 7) * 0.42;
      const plaque = box(own, 0.24, 0.2, 0.03,
                         matt(own, ['#c9b88e', '#b8a179', '#d2c39c'][i % 3]), px, py, t.z + 0.06);
      plaque.rotation.z = (rnd() - 0.5) * 0.28;
      root.add(plaque);
    }
  };

  const komainu = (t: (typeof SHRINE_THINGS)[number]) => {
    const y = at(t.x, t.z);
    root.add(box(own, t.hw * 2, 1.0, t.hd * 2, stone(), t.x, y + 0.5, t.z));
    root.add(box(own, t.hw * 2 - 0.2, 0.16, t.hd * 2 - 0.2, matt(own, '#6f6a60'), t.x, y + 1.06, t.z));
    /* The animal, blocked in rather than sculpted — it reads at four metres and
       nobody in this game gets closer than that to it. */
    const body = box(own, 0.4, 0.44, 0.72, stone(), t.x, y + 1.34, t.z);
    root.add(body);
    root.add(box(own, 0.34, 0.34, 0.34, stone(), t.x, y + 1.72, t.z - 0.22));
    root.add(box(own, 0.12, 0.5, 0.12, stone(), t.x, y + 1.4, t.z + 0.34));
    for (const s of [-1, 1] as const) {
      root.add(box(own, 0.1, 0.4, 0.12, stone(), t.x + s * 0.14, y + 1.28, t.z - 0.28));
    }
  };

  const subshrine = (t: (typeof SHRINE_THINGS)[number]) => {
    const y = at(t.x, t.z);
    /* A little torii in front of it, so you know what you have found. */
    for (const s of [-1, 1] as const) {
      root.add(box(own, 0.14, 1.5, 0.14, vermilion, t.x + s * 0.62, y + 0.75, t.z - 1.5));
    }
    root.add(box(own, 1.8, 0.14, 0.2, vermilion, t.x, y + 1.5, t.z - 1.5));
    root.add(box(own, 1.5, 0.1, 0.16, vermilion, t.x, y + 1.24, t.z - 1.5));
    /* The shrine: a plinth, a box, a roof. */
    root.add(box(own, t.hw * 2, 0.5, t.hd * 2, stone(), t.x, y + 0.25, t.z));
    root.add(box(own, t.hw * 1.5, 1.1, t.hd * 1.4, timber, t.x, y + 1.05, t.z));
    root.add(box(own, t.hw * 1.9, 0.14, t.hd * 1.8, timber, t.x, y + 1.68, t.z));
    for (const s of [-1, 1] as const) {
      const slope = box(own, t.hw * 2.1, 0.13, t.hd * 1.2, roofTile,
                        t.x, y + 1.92, t.z + s * (t.hd * 0.42));
      slope.rotation.x = s * 0.36;
      root.add(slope);
    }
    /* An offering left on the step, and a lamp nobody has put out. The step is
       the front lip of the plinth — 0.7 back from the middle was inside the box
       these are supposed to be sat in front of. */
    const step = t.z - t.hd * 0.85;
    root.add(box(own, 0.16, 0.2, 0.16, matt(own, '#cfc4a6'), t.x - 0.4, y + 0.585, step));
    root.add(box(own, 0.22, 0.28, 0.22, glow(own, '#c98f4e'), t.x + 0.45, y + 0.625, step));
    const votive = new THREE.PointLight('#ffab5c', 16, 6.5, 2);
    votive.position.set(t.x + 0.45, y + 0.75, step);
    root.add(votive);
    lamps.push(votive);
  };

  const marker = (t: (typeof SHRINE_THINGS)[number]) => {
    const y = at(t.x, t.z);
    /*
     * A light on it, because it is round the back.
     *
     * The whole point of this stone is that you only find it by walking round
     * the hall, and the back of the hall is the one part of the precinct with
     * nothing lit in it — so what you found by walking round was a black wall
     * with a grey box against it. Something has to be burning here or the walk
     * round is not worth taking.
     */
    const votive = new THREE.PointLight('#ffb469', 30, 13, 2);
    votive.position.set(t.x + 1.5, y + 1.5, t.z - 1.4);
    root.add(votive);
    lamps.push(votive);
    root.add(box(own, 0.36, 0.5, 0.36, glow(own, '#c9954e'), t.x + 1.5, y + 1.3, t.z - 1.4));
    root.add(box(own, 0.5, 1.1, 0.5, stone(), t.x + 1.5, y + 0.55, t.z - 1.4));
    root.add(box(own, 0.6, 0.16, 0.6, stone(), t.x + 1.5, y + 1.63, t.z - 1.4));
    root.add(box(own, t.hw * 2 + 0.4, 0.24, t.hd * 2 + 0.4, stone(), t.x, y + 0.12, t.z));
    const shaft = box(own, 0.5, 2.0, 0.42, stone(), t.x, y + 1.14, t.z);
    shaft.rotation.z = 0.02;
    root.add(shaft);
    root.add(box(own, 0.56, 0.2, 0.48, stone(), t.x, y + 2.2, t.z));
    /* A rope round it, which is what says the stone is the point and not the
       building in front of it. */
    root.add(box(own, 0.56, 0.09, 0.48, rope, t.x, y + 1.5, t.z));
    for (let i = 0; i < 4; i++) {
      root.add(box(own, 0.09, 0.26, 0.02, matt(own, '#e4dcc6'), t.x - 0.18 + i * 0.12, y + 1.36, t.z - 0.25));
    }
  };

  const notice = (t: (typeof SHRINE_THINGS)[number]) => {
    const y = at(t.x, t.z);
    for (const s of [-1, 1] as const) {
      root.add(box(own, 0.14, 2.2, 0.14, post, t.x + s * t.hw, y + 1.1, t.z));
    }
    root.add(box(own, t.hw * 2, 1.1, 0.1, timber, t.x, y + 1.6, t.z));
    const face = new THREE.Mesh(
      own.keep(new THREE.PlaneGeometry(t.hw * 2 - 0.2, 0.9)),
      own.keep(new THREE.MeshBasicMaterial({
        map: surfaceOf(own, () => signBoard('DOMINO', '#e6dcc2', '#2f3a33', 'SHRINE', 2.0), 1, 1, anisotropy),
        color: '#b8ae94',
      }))
    );
    face.position.set(t.x, y + 1.6, t.z + 0.06);
    root.add(face);
    root.add(box(own, t.hw * 2 + 0.4, 0.14, 0.5, roofTile, t.x, y + 2.28, t.z));
  };

  const tree = (t: (typeof SHRINE_THINGS)[number], i: number) => {
    const y = at(t.x, t.z);
    const h = 4.6 + ((i * 0.73) % 2.8);
    /*
     * The planter it grows out of. Something somebody built, not a hole.
     *
     * Nothing grows out of gravel, and every one of these was pushed straight
     * through it like a post. The first attempt at fixing that sank a square of
     * earth four centimetres into the ground behind a 1.5 cm lip, so as not to
     * put an obstacle where the collision was only the trunk — and from standing
     * height it read as a dark square painted on the floor, which is not what a
     * tree in a paved courtyard looks like either.
     *
     * So it is a box: four walls, a moulded cap sitting proud of them all round
     * the way a coping does, earth filled to six centimetres under the rim, and
     * the soil mounded a little where it meets the trunk. The tree's footprint
     * in `SHRINE_THINGS` was widened to the box so you walk round it rather than
     * through it.
     */
    const bed = t.hw;
    const WALL = 0.26;
    const RIM = 0.44;
    /* How far the coping oversails the wall it sits on, which is the whole
       difference between a built box and four blocks stood on end. */
    const CAP = 0.07;
    /*
     * Laid like brickwork: the two walls along x run the full width, and the
     * two along z fit between them. Their copings are cut the same way — the
     * long pair oversail on all sides, the short pair stop just shy of them.
     * Run the short coping full length instead and the four of them overlap at
     * every corner, which is eighty coincident faces across the two groves.
     */
    const inner = bed - WALL - CAP;
    for (const dz of [-1, 1] as const) {
      const cz = t.z + dz * (bed - WALL / 2);
      root.add(box(own, bed * 2, RIM, WALL, stone(), t.x, y + RIM / 2, cz));
      root.add(box(own, bed * 2 + CAP * 2, 0.09, WALL + CAP * 2, stone(),
                   t.x, y + RIM + 0.045, cz));
    }
    for (const dx of [-1, 1] as const) {
      const cx = t.x + dx * (bed - WALL / 2);
      root.add(box(own, WALL, RIM, (bed - WALL) * 2, stone(), cx, y + RIM / 2, t.z));
      root.add(box(own, WALL + CAP * 2, 0.09, inner * 2 - 0.04, stone(),
                   cx, y + RIM + 0.045, t.z));
    }
    /*
     * The earth, and a mound of it round the trunk.
     *
     * Filled nearly to the rim and taking no shadow. Sunk 15 cm with the canopy
     * shadowing it, the inside of every box was black, and twenty boxes with a
     * black hole in each is worse to look at than the bare gravel was.
     */
    const fill = (m: THREE.Mesh) => {
      m.receiveShadow = false;
      root.add(m);
    };
    fill(box(own, (bed - WALL) * 2 - 0.04, RIM, (bed - WALL) * 2 - 0.04,
             matt(own, '#ffffff', soilTex), t.x, y + RIM / 2 + 0.02, t.z));
    /* No mound heaped round the trunk. Turned to keep it off the plane of the
       earth below it, a flat box reads as a plank laid across the bed rather
       than as soil piled up, and the bed is better plain. */
    /*
     * A tree does not shadow itself here.
     *
     * The canopy sits directly over the trunk, so with the trunk receiving, its
     * own leaves put it in full shadow from top to bottom — and a trunk you walk
     * past at arm's length, lit by nothing, is a black slab across a third of
     * the screen. Both groves read as a row of them. The canopies still cast
     * onto the gravel, which is where that shadow is worth having.
     */
    /* Its own width, and not `t.hw` any more — `t.hw` is the planter now, and
       reading the trunk off it would give a two-metre trunk. */
    const thick = 0.66 + (i % 4) * 0.08;
    /* Standing *in* the earth, not on the same underside as it: the trunk used
       to start at the ground and so shared its bottom face with the soil it is
       supposed to be planted in, twenty times over. */
    const trunk = box(own, thick, h, thick, bark, t.x, y + 0.1 + h / 2, t.z);
    trunk.receiveShadow = false;
    root.add(trunk);
    /* A branch or two, then the canopy in layers. */
    for (let b = 0; b < 2; b++) {
      const arm = box(own, 1.5, 0.16, 0.16, bark,
                      t.x + (b ? 0.7 : -0.7), y + h * 0.62 + b * 0.5, t.z);
      arm.rotation.z = (b ? -1 : 1) * 0.5;
      arm.receiveShadow = false;
      root.add(arm);
    }
    for (let c = 0; c < 5; c++) {
      const s = 2.4 + ((i + c) % 3) * 0.7;
      const canopy = box(own, s, s * 0.7, s, leaf[(i + c) % 3],
                         t.x + Math.cos(i * 2.4 + c * 1.9) * 0.9,
                         y + h + 0.3 + c * 0.5,
                         t.z + Math.sin(i * 2.4 + c * 1.9) * 0.9);
      canopy.rotation.set(0.2 + c * 0.4, 0.3 + i * 0.6, 0.15 + c * 0.5);
      canopy.receiveShadow = false;
      root.add(canopy);
    }
  };

  const draw: Record<string, (t: (typeof SHRINE_THINGS)[number], i: number) => void> = {
    torii, lantern, chozuya, ema, komainu, subshrine, marker, notice, tree,
  };
  SHRINE_THINGS.forEach((t, i) => draw[t.kind]?.(t, i));

  /* ---- the hall ---- */

  /*
   * The haiden: the building you walk up to, offer at, and do not go into.
   *
   * Raised on its platform, open at the front under a deep roof, with the bell
   * and its rope hanging in the middle of the opening and the offering box below
   * that. It is the destination the whole precinct is arranged around, so it is
   * the one thing here allowed to be symmetrical.
   */
  const hy = SHRINE_PLATFORM;
  root.add(box(own, 15, 0.5, 8, stone(), 0, hy + 0.25, 14.5));
  /*
   * Seven metres and a bit of body on eight metres of stone left forty
   * centimetres in front of it, which is not a porch — and a haiden is a porch.
   * Everything that is supposed to hang in the opening had nowhere to hang: the
   * offering box was out past the edge of the platform in mid-air, and pushing
   * it back far enough to stand on put three quarters of it inside the wall.
   * Six and a half metres of body leaves a metre and a half of floor under the
   * eaves, which is the room the whole front of the building needs.
   */
  root.add(box(own, 14, 3.6, 6.4, hallWood, 0, hy + 2.3, 15.2));
  /*
   * The open front: posts up to the eaves and a header across them, both stood
   * clear of the body. They used to be centred on z 10.9, which is the body's
   * own front face — so half of every one of them was inside the building, and
   * the header shared a face with it besides.
   */
  root.add(box(own, 13.4, 0.44, 0.44, matt(own, '#3a2f26'), 0, hy + 3.68, 10.64));
  for (const px of [-5.4, -1.9, 1.9, 5.4]) {
    root.add(box(own, 0.36, 3.62, 0.36, post, px, hy + 2.31, 10.66));
  }
  /* The roof: a deep overhang and a heavy ridge, which is the whole silhouette. */
  root.add(box(own, 16.4, 0.3, 9.4, hallWood, 0, hy + 4.2, 14.6));
  for (const s of [-1, 1] as const) {
    const slope = box(own, 17, 0.36, 5.6, roofTile, 0, hy + 4.86, 14.6 + s * 2.5);
    slope.rotation.x = s * 0.42;
    root.add(slope);
  }
  root.add(box(own, 17.4, 0.5, 1.1, roofTile, 0, hy + 5.9, 14.6));
  for (const s of [-1, 1] as const) {
    root.add(box(own, 0.5, 0.7, 0.9, matt(own, '#5a5148'), s * 8.85, hy + 5.9, 14.6));
  }

  /* The bell, its rope, and the box you drop a coin in. */
  /*
   * In the opening, not in the building.
   *
   * The hall's body starts at z 10.9 and all of this was hung at 11.1 — half a
   * metre inside the wall it is supposed to hang in front of. You would have
   * seen a rope coming out of solid timber.
   */
  /*
   * And hung 40 cm lower, clear of the roof slope coming down over them — and
   * standing on the platform rather than off the end of it.
   *
   * The stone the hall sits on stops at z 10.5. The box was centred at 10.2 and
   * a metre deep, so two thirds of it hung over the top step with nothing
   * underneath, and the rope came down past the edge to meet it. It read
   * exactly as what it was: a crate floating in the air.
   */
  root.add(box(own, 0.9, 0.34, 0.6, matt(own, '#6b5a3a'), 0, hy + 3.6, 11.05));

  /*
   * A rail round the veranda.
   *
   * The plinth stands three metres over the yard, and the collision has
   * always stopped you at its edge — with nothing to see there. Mike's rule
   * from the galleries of Black Crown Games: either you fall or there is a
   * visible fence. So a low timber balustrade runs along both sides and the
   * back, and along the two front corners either side of the steps, standing
   * where the solids stand. `npm run walls` found the eight places it was
   * missing.
   */
  const railWood = matt(own, '#3a2f26');
  const railRun = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    const n = Math.max(2, Math.round(len / 1.8) + 1);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      root.add(box(own, 0.12, 0.84, 0.12, post, x0 + (x1 - x0) * t, hy + 0.42, z0 + (z1 - z0) * t));
    }
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    /* The top rail sits on the posts and overhangs the end ones by a hand;
       the middle rail runs through them, thinner than they are. */
    root.add(box(own, alongX ? len + 0.2 : 0.1, 0.08, alongX ? 0.1 : len + 0.2, railWood, cx, hy + 0.88, cz));
    root.add(box(own, alongX ? len - 0.02 : 0.08, 0.06, alongX ? 0.08 : len - 0.02, railWood, cx, hy + 0.46, cz));
  };
  for (const s of [-1, 1] as const) {
    railRun(s * 9.3, 9.08, s * 9.3, 19.3);
    railRun(s * 7.2, 9.08, s * 9.05, 9.08);
  }
  railRun(-9.05, 19.3, 9.05, 19.3);
  root.add(box(own, 0.6, 0.7, 0.6, matt(own, '#8a7448'), 0, hy + 3.1, 11.05));
  /* Two lengths, not six. The rope hangs above the box you throw past it — six
     of them reached down through its lid. */
  for (let i = 0; i < 2; i++) {
    const seg = box(own, 0.16 + (i % 2) * 0.04, 0.42, 0.16 + (i % 2) * 0.04, rope,
                    0, hy + 2.5 - i * 0.42, 11.05);
    seg.rotation.y = i * 0.5;
    root.add(seg);
  }
  root.add(box(own, 2.6, 0.9, 1.1, timber, 0, hy + 0.95, 11.05));
  for (let i = 0; i < 9; i++) {
    root.add(box(own, 0.08, 0.9, 0.08, matt(own, '#241d18'), -1.1 + i * 0.275, hy + 1.0, 10.52));
  }

  /* Lanterns under the eaves, which is where the hall's light comes from. */
  for (const lx of [-5.4, 5.4]) {
    root.add(box(own, 0.1, 0.5, 0.1, matt(own, '#241d18'), lx, hy + 3.45, 10.4));
    root.add(box(own, 0.5, 0.62, 0.5, glow(own, '#c99a52'), lx, hy + 2.9, 10.4));
    const l = new THREE.PointLight('#ffbc72', 38, 16, 2);
    l.position.set(lx, hy + 3.2, 10.2);
    root.add(l);
    lamps.push(l);
  }

  /* ---- light ---- */

  /*
   * A high cold moon, and everything warm standing on the ground.
   *
   * The key comes from behind the hall so the approach is lit towards its
   * destination and the trees read as mass rather than as detail. It is the only
   * area so far with a real horizon in three directions, so the shadow camera is
   * wide enough to cover the whole precinct — a shadow that stops half way
   * across an open space is more obvious than no shadow at all.
   */
  /*
   * Brighter than the street, and much more of it from the sky.
   *
   * A walled street gets away with a dim key because every surface in it is
   * within a few metres of a lamp somebody hung. Fifty metres of open gravel has
   * no such help: the first build of this was lit like Turtle Lane and read as
   * near black, with the lanterns as isolated pools and the hall invisible from
   * the gate.
   *
   * Open ground at dusk is lit by the *sky*, not by the sun that has gone — so
   * the hemisphere does most of the work here and the moon only models the
   * shapes. That is also what makes the gravel read pale, which is the whole
   * character of the place.
   */
  /*
   * The sky over the precinct, at whatever hour it is.
   *
   * The most of any area here, and the most it can take: this is open ground
   * sixty metres across with nothing over it, so it gets the sky at full and
   * the ground bounce of a pale gravel floor with it.
   *
   * 68 m across 2048 is 3.3 cm and this sits below it: the texel figure is the
   * worst case, which is a surface edge-on to the light, and nothing in an open
   * precinct is anywhere near that. See `market.ts` on `normalBias`.
   */
  const sky = ownSky(own, new Sky(own, root, {
    reach: 46,
    half: 34,
    deep: 30,
    target: [0, SHRINE_FLOOR, 0],
    normalBias: 0.026,
    gain: 1.1,
    fill: 1.05,
  }));

  /* And a wash at the top of the steps, so the way in reads as a way in. */
  const gate = new THREE.PointLight('#ffb469', 40, 14, 2);
  gate.position.set(0, SHRINE_FLOOR + 3.2, -19);
  root.add(gate);
  lamps.push(gate);



  /* And a wash across the front of the hall, from below the eaves. It is the
     one thing in the precinct that has to read from the gate, forty metres
     away, or the approach has nothing to approach. */
  /* Forty-six, not a hundred and twenty. At a hundred and twenty it did read
     from the gate, and it also washed the hall to a flat orange sheet with no
     timber left in it and crushed everything not facing it to black. */
  const facade = new THREE.PointLight('#ffc98c', 46, 24, 2);
  facade.position.set(0, SHRINE_PLATFORM + 4.4, 8.6);
  root.add(facade);
  lamps.push(facade);

  /* Every lamp in the precinct, found rather than listed. See `sky.ts`. */
  sky.claim();

  return {
    root,
    setTime: (hour) => { sky.apply(hour); },
    dispose() {
      for (const item of own.items) item.dispose();
      for (const lamp of lamps) lamp.shadow?.map?.dispose();
    },
  };
}
