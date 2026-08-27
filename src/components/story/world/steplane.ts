/**
 * Step Lane — the residential hill above Turtle Lane.
 *
 * Thirty-six metres of stepped alley climbing five and three-quarter metres
 * between houses. Nothing is for sale up here: this is where people live, and
 * everything in it is the evidence of that — meter boxes, post boxes, bicycles
 * chained to railings, pot plants left on the steps, a jizo in a niche with a
 * bib on it, and the power lines that hang over every street like this.
 *
 * ## Everything is measured off the climb
 *
 * `STEP_LANE_CLIMB` in `areas.ts` says where the flights and landings are, and
 * this file draws the stone from that same list. It also asks `groundAt` where
 * the lane is at any x, and puts the houses, the retaining walls, the poles and
 * the handrail at whatever height it gets back.
 *
 * That is the rule this area exists to establish: **nothing here knows a height
 * of its own.** A world with a floor at zero can hard-code a height and get away
 * with it forever. A world with a hill in it cannot, and the moment a second
 * hill arrives the ones that guessed are the ones that break.
 *
 * ## Dusk, and where the light is
 *
 * The same evening as the street below, and lit the same way: nothing here is
 * lit by anything you cannot see hanging. Porch lights over front doors, one
 * lamp on a pole, and the brightest thing in the area at the very top — over
 * the gate you cannot get through yet — because on a stair the eye goes where
 * the light is and up is where you want it to go.
 */

import * as THREE from 'three';
import { concrete, render, paving, darkWood, brick, signBoard } from './surfaces';
import {
  Owned, box, matt, tiled, decal, glow, surfaceOf, seeded, type BuiltArea,
} from './kit';
import {
  AREAS, STEP_LANE_CLIMB, STEP_LANE_HALF, STEP_LANE_RISE, STEP_LANE_THINGS,
  STEP_LANE_TOP, climbPlatforms, groundAt,
} from '@/story/areas';

const AREA = AREAS['step-lane'];
const SL_W = 18;
const SL_D = 7;
const LANE = STEP_LANE_HALF;

/** Where the houses stand, just behind the lane's own edge. */
const HOUSE_FACE = 2.9;

/** How high the lane is at a point along it. The one source for every height. */
const laneY = (x: number) => groundAt(AREA, x, 0);

export function buildStepLane(anisotropy: number): BuiltArea {
  const own = new Owned();
  const root = new THREE.Group();
  root.name = 'step-lane';
  const rnd = seeded(0x57e9a);

  /* ---- surfaces ---- */

  const stoneTex = surfaceOf(own, () => concrete('#7c7a74'), 1, 1, anisotropy);
  const wallTex = surfaceOf(own, () => concrete('#6e6c67'), 1, 1, anisotropy);
  const renderTex = surfaceOf(own, () => render('#b3a894'), 1, 1, anisotropy);
  const renderAlt = surfaceOf(own, () => render('#9c9c93'), 1, 1, anisotropy);
  const brickTex = surfaceOf(own, () => brick('#7a6357'), 1, 1, anisotropy);

  const stone = () => tiled(matt(own, '#ffffff', stoneTex));
  const retaining = () => tiled(matt(own, '#ffffff', wallTex));
  const houseSkin = (i: number) =>
    tiled(matt(own, '#ffffff', i % 3 === 0 ? brickTex : i % 3 === 1 ? renderTex : renderAlt));

  const steel = matt(own, '#3f4348');
  const timber = matt(own, '#ffffff', surfaceOf(own, darkWood, 1, 2, anisotropy));
  const litPane = glow(own, '#9a7038');
  const coolPane = glow(own, '#5f7080');
  const darkPane = own.keep(new THREE.MeshStandardMaterial({ color: '#20252c', roughness: 0.4 }));

  /* ---- the stair ---- */

  /*
   * The whole mass of it, one box per tread, each standing on the ground.
   *
   * A box per *step* rather than a slab per flight, because the riser is the
   * only thing that makes a stair read as a stair, and a slab has none. Drawn
   * from y 0 up to the tread's own height so there is no underside to find and
   * no gap between one step and the next, whatever the tread depth.
   */
  const treads = climbPlatforms();
  for (const t of treads) {
    if (t.y <= 0.001) continue;
    root.add(box(own, t.hw * 2, t.y, t.hd * 2, stone(), t.x, t.y / 2, t.z));
  }
  /* The floor of the mouth, which is level with the street and has no step. */
  const laneFloor = new THREE.Mesh(
    own.keep(new THREE.PlaneGeometry(SL_W * 2, LANE * 2)),
    matt(own, '#ffffff', surfaceOf(own, () => concrete('#78766f'), 12, 1.5, anisotropy))
  );
  laneFloor.rotation.x = -Math.PI / 2;
  laneFloor.position.set(0, 0.004, 0);
  laneFloor.receiveShadow = true;
  root.add(laneFloor);

  /*
   * A nosing on every step.
   *
   * The lip a stair has along the front of each tread, a shade darker because it
   * is the edge everything scuffs. Two centimetres proud and one deep — it costs
   * a box each and it is the difference between a flight of steps and a ramp cut
   * into terraces.
   */
  const nosing = matt(own, '#76746e');
  for (const t of treads) {
    if (t.y <= 0.001) continue;
    const isStep = t.hw < 0.4;
    if (!isStep) continue;
    root.add(box(own, 0.07, 0.05, t.hd * 2, nosing, t.x + t.hw - 0.02, t.y - 0.02, t.z));
  }

  /* A worn strip down the middle of each landing, where everybody walks. */
  for (const t of treads) {
    if (t.hw < 0.4) continue;
    const worn = new THREE.Mesh(
      own.keep(new THREE.PlaneGeometry(t.hw * 2 - 0.4, 1.5)),
      decal(own, '#7e7c76')
    );
    worn.rotation.x = -Math.PI / 2;
    worn.position.set(t.x, t.y + 0.006, t.z);
    root.add(worn);
  }

  /*
   * The handrail, down the north side, following the climb.
   *
   * A level run gets a level rail; a flight gets one tilted to match, which is
   * the whole reason the climb is data rather than geometry — the angle comes
   * out of `from`, `to` and the length, and cannot disagree with the steps.
   */
  const railZ = -LANE + 0.28;
  for (const run of STEP_LANE_CLIMB) {
    const length = run.east - run.west;
    const rise = run.to - run.from;
    const span = Math.hypot(length, rise);
    const rail = box(own, span, 0.07, 0.07, steel,
                     (run.east + run.west) / 2, (run.from + run.to) / 2 + 0.98, railZ);
    rail.rotation.z = Math.atan2(rise, -length);
    root.add(rail);
    /*
     * Posts at a stride and a half, each standing on the tread below it.
     *
     * `i < posts`, not `i <= posts`: the west end of one run is the east end of
     * the next, so planting a post at both ends puts two identical posts in
     * exactly the same place at every join — sixteen pairs of them, which is
     * thirty-two coplanar faces and the largest single fault in the area.
     */
    const posts = Math.max(2, Math.round(length / 1.6));
    for (let i = 0; i < posts; i++) {
      const x = run.east - (length / posts) * i;
      const foot = laneY(x - 0.01);
      const head = run.from + (rise * i) / posts + 0.98;
      root.add(box(own, 0.05, Math.max(0.2, head - foot), 0.05, steel, x, (head + foot) / 2, railZ));
    }
  }

  /* ---- the walls the lane is cut into ---- */

  /*
   * A retaining wall each side, its top following the lane.
   *
   * Built as one box per tread rather than a single slab, for the same reason
   * the stair is: the top of a retaining wall on a hill steps with the ground it
   * holds back. Each one runs from zero up to the lane's height there plus the
   * metre of wall that shows above it.
   */
  for (const t of treads) {
    const top = t.y + 0.92;
    for (const side of [-1, 1] as const) {
      root.add(box(own, t.hw * 2, top, 0.6, retaining(),
                   t.x, top / 2, side * (LANE + 0.3)));
    }
  }
  /*
   * And a coping over the top of it, sloping with the flight.
   *
   * Without one the wall is a stack of half-metre blocks each 18 cm above the
   * last, and from anywhere above it that reads as a row of saw teeth running up
   * the hill — which is exactly what it is. A capping stone laid at the angle of
   * the flight covers the teeth and is what every wall like this actually has,
   * because a stepped top sheds water into the joints and nobody builds one.
   *
   * Same arithmetic as the handrail, off the same run.
   */
  for (const run of STEP_LANE_CLIMB) {
    const length = run.east - run.west;
    const rise = run.to - run.from;
    const span = Math.hypot(length, rise);
    for (const side of [-1, 1] as const) {
      const cap = box(own, span, 0.2, 0.76, matt(own, '#6c6a64'),
                      (run.east + run.west) / 2, (run.from + run.to) / 2 + 1.02,
                      side * (LANE + 0.3));
      cap.rotation.z = Math.atan2(rise, -length);
      root.add(cap);
    }
  }
  /* Weep holes, at a stride along the foot of each wall. */
  for (let x = -SL_W + 2; x < SL_W - 2; x += 3.1) {
    for (const side of [-1, 1] as const) {
      root.add(box(own, 0.1, 0.1, 0.06, matt(own, '#4a4844'),
                   x, laneY(x) + 0.3, side * (LANE + 0.02)));
    }
  }

  /* ---- the houses ---- */

  /**
   * One house: a plinth up to its terrace, a body on it, and the evidence that
   * somebody lives there.
   *
   * The plinth is the part that matters on a hill. Each house sits on ground a
   * little higher than the house below it, and the difference shows as the wall
   * carrying it — so the terrace steps up the lane without anybody drawing a
   * single retaining wall by hand.
   */
  const house = (cx: number, w: number, side: -1 | 1, i: number) => {
    const face = side * HOUSE_FACE;
    const out = -side;
    const depth = SL_D - HOUSE_FACE;
    const zc = face + side * depth / 2;
    const terrace = laneY(cx) + 1.05;
    const height = 6.4 + (i % 3) * 0.7;
    const skin = houseSkin(i);

    /* The plinth, and the body on top of it. */
    root.add(box(own, w, terrace, depth, retaining(), cx, terrace / 2, zc));
    root.add(box(own, w, height, depth, skin, cx, terrace + height / 2, zc));

    /* A shallow roof with a real overhang, which is most of what makes a house
       read as a house rather than as a block. */
    const eaves = terrace + height;
    root.add(box(own, w + 0.5, 0.16, depth + 0.5, matt(own, '#4a453e'), cx, eaves + 0.08, zc));
    const pitch = box(own, w + 0.3, 0.14, depth * 0.62, matt(own, '#3f3a34'),
                      cx, eaves + 0.42, zc + side * depth * 0.16);
    pitch.rotation.x = out * 0.2;
    root.add(pitch);

    const zf = face + out * 0.06;

    /* Ground floor: a door under a small porch, and a window beside it. */
    const doorX = cx - w / 2 + 0.95;
    root.add(box(own, 1.0, 2.05, 0.14, timber, doorX, terrace + 1.02, zf + out * 0.05));
    root.add(box(own, 1.24, 0.12, 0.5, matt(own, '#4a453e'), doorX, terrace + 2.22, zf + out * 0.22));
    /* The porch light: a small warm lens under the hood. */
    const lampY = terrace + 2.05;
    root.add(box(own, 0.16, 0.2, 0.16, matt(own, '#3f4348'), doorX + 0.72, lampY, zf + out * 0.1));
    root.add(box(own, 0.1, 0.12, 0.02, glow(own, '#d8a763'), doorX + 0.72, lampY - 0.02, zf + out * 0.2));

    /* Meter box, post box and a name plate — the three things every one of these
       doors has beside it. */
    root.add(box(own, 0.34, 0.44, 0.16, matt(own, '#9aa0a2'), doorX + 1.35, terrace + 1.5, zf + out * 0.08));
    root.add(box(own, 0.3, 0.36, 0.22, matt(own, '#5a6b5f'), doorX - 0.78, terrace + 1.05, zf + out * 0.12));
    root.add(box(own, 0.26, 0.1, 0.02, matt(own, '#d9d3c4'), doorX + 0.62, terrace + 1.72, zf + out * 0.16));

    const winX = cx + w / 2 - 1.15;
    root.add(box(own, 1.5, 1.1, 0.12, matt(own, '#4a453e'), winX, terrace + 1.5, zf));
    root.add(box(own, 1.3, 0.94, 0.05, i % 4 === 0 ? litPane : darkPane, winX, terrace + 1.5, zf + out * 0.08));
    root.add(box(own, 1.66, 0.09, 0.22, matt(own, '#57524a'), winX, terrace + 0.86, zf + out * 0.08));

    /* Upper floor: two windows, and a balcony on some of them. */
    for (let k = 0; k < 2; k++) {
      const wx = cx - w / 2 + w * (0.3 + k * 0.42);
      const lit = rnd() > 0.55;
      root.add(box(own, 1.1, 1.24, 0.12, matt(own, '#4a453e'), wx, terrace + 4.15, zf));
      root.add(box(own, 0.94, 1.06, 0.05, lit ? litPane : coolPane, wx, terrace + 4.15, zf + out * 0.08));
      root.add(box(own, 1.26, 0.09, 0.2, matt(own, '#57524a'), wx, terrace + 3.5, zf + out * 0.08));
    }
    if (i % 2 === 0) {
      const by = terrace + 3.42;
      root.add(box(own, w - 0.9, 0.1, 0.9, matt(own, '#57524a'), cx, by, zf + out * 0.45));
      for (let r = 0; r < 3; r++) {
        root.add(box(own, w - 0.9, 0.05, 0.05, steel, cx, by + 0.22 + r * 0.22, zf + out * 0.88));
      }
      /* A pole across it, and something drying on it. */
      root.add(box(own, w - 1.2, 0.05, 0.05, matt(own, '#b8b2a4'), cx, by + 0.95, zf + out * 0.6));
      for (let c = 0; c < 3; c++) {
        root.add(box(own, 0.34, 0.6, 0.02,
                     matt(own, ['#c9c2b0', '#7f95a8', '#b08c74'][c]),
                     cx - (w - 2.2) / 2 + c * 0.85, by + 0.62, zf + out * 0.6));
      }
    }

    /* A drainpipe down one edge, and a low garden wall beside the door. */
    root.add(box(own, 0.12, height, 0.12, matt(own, '#5a554d'),
                 cx + w / 2 - 0.18, terrace + height / 2, zf + out * 0.1));
  };

  /* Two runs of houses, offset so the two sides never line up — which is what
     stops a corridor reading as a corridor. */
  const NORTH = [15.2, 10.1, 5.0, -0.2, -5.4, -10.4, -15.2];
  const SOUTH = [16.6, 11.4, 6.2, 1.0, -4.2, -9.4, -14.4];
  NORTH.forEach((cx, i) => house(cx, 4.7, -1, i));
  SOUTH.forEach((cx, i) => house(cx, 4.6, 1, i + 3));

  /* ---- poles and lines ---- */

  const poles = STEP_LANE_THINGS.filter((t) => t.kind === 'pole');
  for (const p of poles) {
    const base = laneY(p.x);
    root.add(box(own, 0.26, 8.4, 0.26, retaining(), p.x, base + 4.2, p.z));
    for (const arm of [0, 1]) {
      const ay = base + 6.6 + arm * 0.7;
      root.add(box(own, 0.1, 0.08, 1.7, steel, p.x, ay, p.z + Math.sign(-p.z) * 0.55));
      for (const k of [-0.6, 0, 0.6]) {
        root.add(box(own, 0.09, 0.16, 0.09, matt(own, '#4f5257'),
                     p.x, ay + 0.12, p.z + Math.sign(-p.z) * 0.55 + k));
      }
    }
    /* A transformer can on the higher one, because they all have one. */
    root.add(box(own, 0.44, 0.7, 0.44, matt(own, '#6a6357'), p.x, base + 5.7, p.z + Math.sign(-p.z) * 0.34));
  }
  /*
   * The cables, strung the length of the lane and slack the way cables are.
   *
   * Drawn as a short chain of segments rather than one straight box: three per
   * span, the middle one lower, which is enough of a catenary to read from below
   * and costs almost nothing.
   */
  if (poles.length >= 2) {
    const a = poles[0];
    const b = poles[1];
    for (const k of [-0.55, 0, 0.55]) {
      const ends: [number, number, number][] = [
        [SL_W - 1, laneY(SL_W - 1) + 6.9, a.z + Math.sign(-a.z) * 0.55 + k],
        [a.x, laneY(a.x) + 6.72, a.z + Math.sign(-a.z) * 0.55 + k],
        [b.x, laneY(b.x) + 6.72, b.z + Math.sign(-b.z) * 0.55 + k],
        [-SL_W + 1.6, laneY(-SL_W + 1.6) + 6.9, b.z + Math.sign(-b.z) * 0.55 + k],
      ];
      for (let i = 0; i + 1 < ends.length; i++) {
        const [x0, y0, z0] = ends[i];
        const [x1, y1, z1] = ends[i + 1];
        const seg = 3;
        for (let j = 0; j < seg; j++) {
          const t0 = j / seg;
          const t1 = (j + 1) / seg;
          const sag = (t: number) => -0.34 * Math.sin(Math.PI * t);
          const ax = x0 + (x1 - x0) * t0;
          const ay = y0 + (y1 - y0) * t0 + sag(t0);
          const az = z0 + (z1 - z0) * t0;
          const bx = x0 + (x1 - x0) * t1;
          const by = y0 + (y1 - y0) * t1 + sag(t1);
          const bz = z0 + (z1 - z0) * t1;
          const wire = box(own, Math.hypot(bx - ax, by - ay), 0.035, 0.035,
                           matt(own, '#2f3134'), (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
          wire.rotation.z = Math.atan2(by - ay, bx - ax);
          wire.castShadow = false;
          root.add(wire);
        }
      }
    }
  }

  /* ---- what is left out along the lane ---- */

  const drawThing: Record<string, (t: (typeof STEP_LANE_THINGS)[number]) => void> = {
    planter: (t) => {
      const y = laneY(t.x);
      root.add(box(own, t.hw * 2, 0.42, t.hd * 2, matt(own, '#8a7f6e'), t.x, y + 0.21, t.z));
      root.add(box(own, t.hw * 2 - 0.1, 0.06, t.hd * 2 - 0.1, matt(own, '#3a2f22'), t.x, y + 0.45, t.z));
      for (let i = 0; i < 4; i++) {
        const s = 0.14 + ((i * 0.079) % 0.09);
        const angle = i * 2.39996;
        const reach = 0.17 + (i % 2) * 0.06;
        const leaf = box(own, s, s, s, matt(own, i % 2 ? '#41693c' : '#517f48'),
                         t.x + Math.cos(angle) * reach, y + 0.5 + s / 2 + (i % 3) * 0.06,
                         t.z + Math.sin(angle) * reach);
        leaf.rotation.set(0.29 + i * 0.67, 0.41 + i * 1.09, 0.19 + i * 0.83);
        root.add(leaf);
      }
    },
    bicycles: (t) => {
      const y = laneY(t.x);
      for (let i = 0; i < 2; i++) {
        const bx = t.x - t.hw + 0.5 + i * 1.32;
        const g = new THREE.Group();
        /* Staggered front to back as well as along, so the two bikes' wheels
           never share a slice of the lane. Side by side and dead in line, the
           wheel of one is a hand's width from the wheel of the other and the two
           agree on more planes than they disagree on. */
        g.position.set(bx, y, t.z + (i ? 0.13 : -0.11));
        g.rotation.y = 0.12 - i * 0.2;
        /* Each bike its own wheel, a centimetre and a half different. Two bikes
           chained side by side put a wheel each within a hand's width, and two
           identical wheels at one height share their whole silhouette. */
        /* Two bikes chained side by side put a wheel each within a hand's
           width. Different diameters *and* different tube, so neither their
           tops nor the ground line they both sit on can coincide — a lean was
           the obvious fix and made it worse, because turning the group moves
           every part of the bike into a fresh coincidence. */
        const rad = i ? 0.288 : 0.318;
        for (const wx of [-0.5, 0.5]) {
          const wheel = new THREE.Mesh(
            own.keep(new THREE.TorusGeometry(rad, i ? 0.024 : 0.031, 6, 16)),
            matt(own, '#2a2c2e')
          );
          wheel.position.set(wx, rad, 0);
          g.add(wheel);
        }
        g.add(box(own, 1.0, 0.05, 0.05, matt(own, i ? '#7a4a3a' : '#3f5a6b'), 0, 0.56, 0));
        /* The frame sits a couple of centimetres off the wheels' own plane. At
           dead centre a seat tube and a wheel share a face, which is two more
           pairs per bike for the sake of a alignment nobody could see. */
        g.add(box(own, 0.05, 0.34, 0.05, matt(own, i ? '#7a4a3a' : '#3f5a6b'), -0.28, 0.42, 0.022));
        g.add(box(own, 0.05, 0.5, 0.05, matt(own, i ? '#7a4a3a' : '#3f5a6b'), 0.44, 0.6, -0.022));
        g.add(box(own, 0.05, 0.05, 0.42, matt(own, '#2a2c2e'), 0.44, 0.86, 0));
        g.add(box(own, 0.24, 0.06, 0.12, matt(own, '#26282a'), -0.24, 0.78, 0));
        g.add(box(own, 0.34, 0.2, 0.26, matt(own, '#5a5347'), -0.42, 0.72, 0));
        root.add(g);
      }
      /* The railing they are chained to. */
      root.add(box(own, t.hw * 2 + 0.4, 0.06, 0.06, steel, t.x, y + 0.62, t.z - Math.sign(t.z) * 0.2));
      for (const px of [-1, 1]) {
        root.add(box(own, 0.05, 0.62, 0.05, steel,
                     t.x + px * (t.hw + 0.16), y + 0.31, t.z - Math.sign(t.z) * 0.2));
      }
    },
    bin: (t) => {
      const y = laneY(t.x);
      root.add(box(own, t.hw * 2, 0.82, t.hd * 2, matt(own, '#4a5348'), t.x, y + 0.41, t.z));
      root.add(box(own, t.hw * 2 + 0.06, 0.07, t.hd * 2 + 0.06, matt(own, '#39412f'), t.x, y + 0.85, t.z));
      root.add(box(own, 0.26, 0.03, 0.16, matt(own, '#2a2f26'), t.x, y + 0.89, t.z));
    },
    jizo: (t) => {
      const y = laneY(t.x);
      const back = Math.sign(t.z);
      /* A niche in the retaining wall, and the little figure in it. */
      root.add(box(own, t.hw * 2, 1.15, 0.3, matt(own, '#6f6c66'), t.x, y + 0.58, t.z + back * 0.16));
      root.add(box(own, t.hw * 2 - 0.16, 0.9, 0.16, matt(own, '#3a3833'), t.x, y + 0.56, t.z + back * 0.04));
      root.add(box(own, 0.2, 0.42, 0.18, matt(own, '#a8a49b'), t.x, y + 0.36, t.z - back * 0.02));
      const head = new THREE.Mesh(own.keep(new THREE.SphereGeometry(0.11, 10, 8)), matt(own, '#a8a49b'));
      head.position.set(t.x, y + 0.66, t.z - back * 0.02);
      root.add(head);
      /* The bib, which is the whole reason anybody notices one of these. */
      root.add(box(own, 0.22, 0.2, 0.03, matt(own, '#a83f42'), t.x, y + 0.46, t.z - back * 0.11));
      /* An offering, and the roof over it. */
      root.add(box(own, 0.1, 0.1, 0.1, matt(own, '#c9c2b0'), t.x - 0.16, y + 0.2, t.z - back * 0.06));
      root.add(box(own, t.hw * 2 + 0.14, 0.08, 0.42, matt(own, '#57524a'), t.x, y + 1.2, t.z + back * 0.06));
    },
    crates: (t) => {
      const y = laneY(t.x);
      for (let i = 0; i < 3; i++) {
        const c = box(own, 0.5, 0.34, t.hd * 2 - 0.08,
                      matt(own, i % 2 ? '#6f5a3a' : '#8a6b45'),
                      t.x - t.hw + 0.32 + (i % 2) * 0.52, y + 0.17 + Math.floor(i / 2) * 0.35, t.z);
        c.rotation.y = (i - 1) * 0.05;
        root.add(c);
      }
    },
    pole: () => {
      /* Drawn above with its crossarms and its cables. */
    },
  };
  for (const t of STEP_LANE_THINGS) drawThing[t.kind]?.(t);

  /* ---- the top, and what is past it ---- */

  const topY = STEP_LANE_TOP;
  const gateX = -SL_W + 1;

  /*
   * The gate across the top of the lane.
   *
   * The steps genuinely carry on towards Domino Park, and you can see them do
   * it — that is the point of closing this with a gate rather than a wall. Two
   * piers, a sliding gate between them, and the flight continuing behind at the
   * angle it has been climbing at all along.
   */
  for (const s of [-1, 1] as const) {
    root.add(box(own, 1.1, 3.1, 0.9, retaining(), gateX, topY + 1.55, s * 1.75));
    root.add(box(own, 1.3, 0.2, 1.1, matt(own, '#6a655c'), gateX, topY + 3.2, s * 1.75));
  }
  root.add(box(own, 1.2, 0.28, 2.7, matt(own, '#6a655c'), gateX, topY + 3.02, 0));
  /* The gate itself: uprights and two rails, so you see through it. */
  for (let i = 0; i < 9; i++) {
    root.add(box(own, 0.06, 2.4, 0.06, steel, gateX, topY + 1.2, -1.2 + i * 0.3));
  }
  for (const ry of [0.5, 2.1]) {
    root.add(box(own, 0.07, 0.07, 2.6, steel, gateX, topY + ry, 0));
  }
  /* A lamp over it — the brightest thing in the lane, and the reason you climb. */
  root.add(box(own, 0.3, 0.34, 0.3, matt(own, '#3f4348'), gateX + 0.2, topY + 3.55, 0));
  const gateLens = new THREE.Mesh(own.keep(new THREE.PlaneGeometry(0.26, 0.26)), glow(own, '#f0c98a'));
  gateLens.rotation.x = Math.PI / 2;
  gateLens.position.set(gateX + 0.2, topY + 3.32, 0);
  root.add(gateLens);

  /* The lane carrying on behind the gate, and then the hill it climbs into. */
  for (let i = 0; i < 9; i++) {
    const y = topY + STEP_LANE_RISE * (i + 1);
    root.add(box(own, 0.46, y, LANE * 2 - 0.22, stone(), gateX - 1.1 - i * 0.46, y / 2, 0));
  }
  /*
   * The hillside above, and trees over the top of it.
   *
   * The wall was 16 m tall with the trees behind it, so the only thing visible
   * through the gate was a wall — which closes the void perfectly well and says
   * nothing about where the lane goes. Eleven metres still blocks the sky from
   * anywhere on the lane and leaves the canopy showing above it, which is the
   * one hint this area gives that the Heights are up there.
   */
  root.add(box(own, 3.4, 11, SL_D * 2 + 6, tiled(matt(own, '#ffffff', wallTex)),
               gateX - 7, 5.5, 0));
  for (let i = 0; i < 14; i++) {
    const s = 2.4 + ((i * 0.41) % 1.8);
    const t = box(own, s, s * 0.85, s, matt(own, i % 2 ? '#26382a' : '#2f4633'),
                  gateX - 7.6 - (i % 3) * 1.9, 10.4 + ((i * 0.61) % 2.6),
                  -SL_D + 1.2 + ((i * 4.1) % (SL_D * 2 - 2.4)));
    t.rotation.set(0.2 + i * 0.31, 0.4 + i * 0.77, 0.15 + i * 0.59);
    root.add(t);
  }

  /* ---- the mouth, and the street beyond it ---- */

  /*
   * What you see looking back down and out.
   *
   * Turtle Lane is not built while you are up here, so the alley would open onto
   * nothing. A slice of the terrace across the road, lit, at the distance it
   * would really be — enough that the mouth reads as a way out to a street
   * rather than a hole.
   */
  const beyond = tiled(matt(own, '#ffffff', brickTex));
  const beyondRoad = new THREE.Mesh(
    own.keep(new THREE.PlaneGeometry(9, 16)),
    matt(own, '#ffffff', surfaceOf(own, paving, 3, 5, anisotropy))
  );
  beyondRoad.rotation.x = -Math.PI / 2;
  /* Clear of the lane's own floor plane, which ends at 18 — two planes at one
     height sharing half a square metre is the flattest fight there is. */
  beyondRoad.position.set(SL_W + 5.1, 0.006, 0);
  root.add(beyondRoad);
  root.add(box(own, 2.4, 9.5, SL_D * 2 + 8, beyond, SL_W + 9.4, 4.75, 0));
  for (let i = 0; i < 3; i++) {
    const bz = -4.4 + i * 4.4;
    root.add(box(own, 0.14, 2.1, 3.4, matt(own, '#3a3128'), SL_W + 8.18, 1.75, bz));
    root.add(box(own, 0.05, 1.9, 3.1, glow(own, i === 1 ? '#8a6432' : '#4f5f6b'), SL_W + 8.1, 1.75, bz));
  }
  /* The alley mouth's own frame, between the last two houses. */
  for (const s of [-1, 1] as const) {
    root.add(box(own, 1.4, 5.4, 0.7, retaining(), SL_W - 0.4, 2.7, s * (LANE + 0.52)));
  }
  root.add(box(own, 1.4, 0.9, LANE * 2 + 1.4, retaining(), SL_W - 0.4, 5.85, 0));
  const nameW = 2.1;
  const nameMesh = new THREE.Mesh(
    own.keep(new THREE.PlaneGeometry(nameW, nameW / 5.2)),
    own.keep(new THREE.MeshBasicMaterial({
      map: surfaceOf(own, () => signBoard('STEP LANE', '#e6dcc2', '#2f3a33', undefined, 5.2), 1, 1, anisotropy),
      color: '#cfc4a6',
    }))
  );
  nameMesh.rotation.y = Math.PI / 2;
  nameMesh.position.set(SL_W - 1.12, 5.85, 0);
  root.add(nameMesh);

  /* ---- light ---- */

  /*
   * A cold evening from over the hill, and everything warm hanging on a wall.
   *
   * The key is low and behind the top of the lane, so the climb is lit from
   * where it is going and the steps have a long shadow down them — which is what
   * makes a stair read as a stair from the bottom, before you can see a single
   * riser.
   */
  const moon = new THREE.DirectionalLight('#7f93b4', 0.62);
  moon.position.set(-26, 20, -10);
  moon.target.position.set(0, 2, 0);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  moon.shadow.camera.left = -22;
  moon.shadow.camera.right = 22;
  moon.shadow.camera.top = 18;
  moon.shadow.camera.bottom = -18;
  moon.shadow.camera.near = 1;
  moon.shadow.camera.far = 70;
  moon.shadow.bias = -0.0009;
  /* See `market.ts` on `normalBias`: every wall here is edge-on to a light
     coming down the hill, which is the case a constant bias cannot cover. */
  moon.shadow.normalBias = 0.05;
  root.add(moon);
  root.add(moon.target);

  root.add(new THREE.HemisphereLight('#38465c', '#241f1a', 0.38));
  root.add(new THREE.AmbientLight('#3d4557', 0.22));

  /*
   * Four porch lights and the lamp at the top, and no more than that.
   *
   * A point light is not free and fourteen front doors would be fourteen of
   * them. The rest of the porches have their lens and no light behind it, which
   * nobody can tell apart at this range and which costs a draw call rather than
   * a shadow map.
   */
  const lamps: THREE.PointLight[] = [];
  for (const [px, pz, warm] of [
    [13.4, -HOUSE_FACE + 0.5, 40],
    [4.2, HOUSE_FACE - 0.5, 36],
    [-3.6, -HOUSE_FACE + 0.5, 36],
    [-12.2, HOUSE_FACE - 0.5, 34],
  ] as const) {
    const light = new THREE.PointLight('#ffbc72', warm, 11, 2);
    light.position.set(px, laneY(px) + 2.6, pz);
    root.add(light);
    lamps.push(light);
  }
  const top = new THREE.PointLight('#ffd08a', 58, 13, 2);
  top.position.set(gateX + 0.6, topY + 3.2, 0);
  top.castShadow = true;
  top.shadow.mapSize.set(1024, 1024);
  top.shadow.bias = -0.0025;
  top.shadow.normalBias = 0.04;
  root.add(top);
  lamps.push(top);

  /* And a wash at the mouth, so the way out reads as lit from the street. */
  const mouth = new THREE.PointLight('#ffb469', 26, 12, 2);
  mouth.position.set(SL_W + 1.6, 3.0, 0);
  root.add(mouth);
  lamps.push(mouth);

  return {
    root,
    dispose() {
      for (const item of own.items) item.dispose();
      for (const lamp of lamps) lamp.shadow?.map?.dispose();
      moon.shadow?.map?.dispose();
    },
  };
}
