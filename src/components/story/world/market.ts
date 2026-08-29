/**
 * Market Row — the covered shopping street east of Turtle Lane.
 *
 * A shōtengai: two rows of small shops facing each other across ten metres of
 * tiled floor, with a canopy over the whole forty-six metres of it. You come in
 * under an arch at one end; the other end is gated shut.
 *
 * ## The one new thing this area has to do
 *
 * Every area so far solves the void by being taller than the camera. Look up at
 * the end of Turtle Lane and you see roofline, and the black above it reads as
 * dusk sky because you are outdoors and sky is what belongs up there.
 *
 * Put a roof on and that stops working. The black is no longer sky — it is a
 * hole in the building you are standing inside, and there is nowhere to look up
 * to instead. So the canopy is not scenery here. **It is the top wall**, the
 * first piece of enclosure in this world that runs horizontally, and every
 * decision below hangs off it:
 *
 * - **The light is all hanging.** Nothing in the middle of this arcade is lit by
 *   anything you cannot see holding it up. Eight pendants down the spine do the
 *   work the sky and the lamp posts do outside, and the two ends are brighter
 *   than the middle because that is where the daylight gets in.
 * - **The one shadow-caster points straight down.** A directional light from
 *   overhead is what a line of pendants *reads* as, at a fraction of the cost of
 *   eight shadowed point lights. It is also why the canopy has `castShadow` off:
 *   it is between that light and the floor, and left alone it would put the
 *   whole arcade in shade.
 * - **The far end is shut, and visibly so.** Roll a gate across it, light the
 *   wall behind, and a dead end becomes a place that carries on without you. A
 *   blank stretch of building would have been cheaper and would have said the
 *   arcade was always this long, which is a lie the player can feel.
 *
 * ## Why it is close in
 *
 * Ten metres wide against the street's thirty, and the goods are on the floor
 * rather than behind glass. Being crowded is what a market is; the camera clamps
 * to a shopfront in a metre and a half when you walk across the arcade, and that
 * is the correct feeling rather than a compromise.
 *
 * ## Nobody lives here yet
 *
 * Not one person, on purpose. The city is being built area by area and the cast
 * goes in once it is all standing — so this is a market at the quiet end of the
 * day, and every bit of life in it has to come from the place itself: the half
 * of the units that are shut, the crates left out, the bicycles, the bench.
 */

import * as THREE from 'three';
import {
  arcadeFloor, shutter, brick, render, plaster, darkWood, concrete, paving, signBoard,
} from './surfaces';
import { Owned, box, matt, tiled, decal, glow, surfaceOf, seeded, type BuiltArea } from './kit';
import { MARKET_GOODS, type Goods, type GoodsKind } from '@/story/areas';

const MR_W = 23;        // half-length, matching `areas.ts`
const MR_D = 9;         // half-depth
const MR_FRONT = 5;     // where the shopfronts face each other

/** The canopy: eaves height, ridge height, and where the slopes spring from. */
/*
 * Lower than a real arcade canopy, on purpose.
 *
 * A shōtengai roof springs from above the second floor, six or seven metres up,
 * and at that height the camera — which pitches up to about thirty degrees —
 * never gets more than a sliver of it into frame. Which wastes the one piece of
 * geometry this whole area is built around: if the lid is never seen, the place
 * reads as a street whose sky happens to be black.
 *
 * At 5.9 it is in the top of the shot from anywhere in the arcade, and the
 * pendants hang into the middle of the view rather than out of the top of it.
 */
const EAVE_Y = 5.9;
const RIDGE_Y = 7.05;

/** Nine units a side, evenly across the length. */
const UNITS = 9;
const UNIT_W = (MR_W * 2) / UNITS;   // 5.11 m

interface Unit {
  /** What is over the door. Empty means the board is up but blank. */
  name: string;
  trade?: string;
  ink: string;
  ground: string;
  /** Shut, and what colour the shutter is. */
  shut?: string;
  awning?: string;
  /** A split cloth curtain across the doorway. */
  noren?: string;
  /**
   * Lit by a fluorescent tube rather than a bulb.
   *
   * The single most useful colour decision in this area. Everything here is
   * warm — timber, brass, painted board, eight incandescent pendants — and a
   * scene lit in one temperature goes flat no matter how much detail is in it.
   * Real shopping streets are not lit in one temperature: anything selling food
   * is under cold white tubes, because that is what makes fish and bread look
   * like fish and bread, and everything else is under something warmer.
   *
   * So the fishmonger, the baker and the butcher are cold, and they are cold
   * against a warm street. It is true to the place and it is what stops the
   * arcade reading as a corridor with an orange filter over it.
   */
  cool?: boolean;
}

/**
 * The two rows, written out rather than generated.
 *
 * The street's terraces are seeded noise, and that is right for a row of
 * buildings you look at from thirty metres. A market is read from two metres and
 * the mix is the whole character of it — a greengrocer next to a shut unit next
 * to a tea shop is a place, and nine random shopfronts is wallpaper. So these
 * are chosen: what trade, what colour, which four are closed, and which of those
 * four has had its sign taken down for good.
 */
const NORTH: Unit[] = [
  { name: 'MARUYAMA', trade: 'GREENGROCER', ink: '#f0e6c6', ground: '#2e4a30', awning: '#3f6a42' },
  { name: '', ink: '#8a8375', ground: '#3a3f3a', shut: '#59605a' },
  { name: 'KOME-YA', trade: 'RICE', ink: '#2c2118', ground: '#cbb488', noren: '#7d6244' },
  { name: 'TSUBAKI', trade: 'TEA', ink: '#f2e2c4', ground: '#5c2630', awning: '#7a3540', noren: '#8d4450' },
  { name: 'HANAMURA', trade: 'FLOWERS', ink: '#3a2b1e', ground: '#d8c9a4', awning: '#a8607a', cool: true },
  { name: 'ITSUKI', ink: '#7d7466', ground: '#2f3742', shut: '#3f5064' },
  { name: 'KAWASE', trade: 'STATIONERY', ink: '#efe4c8', ground: '#2f4358', noren: '#3f5a72' },
  { name: 'YAMADA', trade: 'HARDWARE', ink: '#e8dcc0', ground: '#4a3a24' },
  { name: 'SUZU', trade: 'SWEETS', ink: '#4a2a2a', ground: '#e6c58c', awning: '#c98f5a' },
];

const SOUTH: Unit[] = [
  { name: 'ISO-MARU', trade: 'FISH', ink: '#e6eef2', ground: '#22415c', awning: '#2f5a7a', cool: true },
  { name: 'PAN-YA', trade: 'BAKERY', ink: '#3d2a18', ground: '#dcc596', awning: '#c2a06a', noren: '#a8814e', cool: true },
  { name: '', ink: '#7a7064', ground: '#40342c', shut: '#7a5136' },
  { name: 'ORIHARA', trade: 'BUTCHER', ink: '#f0e0d4', ground: '#6b2a26', awning: '#8a3630', cool: true },
  { name: 'NAKANO', trade: 'BOOKS', ink: '#e9dfc4', ground: '#33402f', noren: '#4a5a42' },
  { name: 'TOKI', trade: 'CLOCKS', ink: '#e4d8b8', ground: '#3c3226', cool: true },
  { name: 'KURATA', ink: '#6f7a70', ground: '#2c3830', shut: '#46584a' },
  { name: 'MIYABI', trade: 'FABRIC', ink: '#f2e6d0', ground: '#4a3350', noren: '#6a4a72' },
  { name: 'HARUKAZE', trade: 'NOODLES', ink: '#2e2317', ground: '#d9b872', awning: '#b8894a', noren: '#8a5f36' },
];

export function buildMarket(anisotropy: number): BuiltArea {
  const own = new Owned();
  const root = new THREE.Group();
  root.name = 'market-row';
  const rnd = seeded(0x3a4c8e);

  /** Kept so the lights can be torn down with their shadow maps. */
  const lights: THREE.Light[] = [];

  /* ---------------------------------------------------------------- */
  /* the floor                                                         */
  /* ---------------------------------------------------------------- */

  const floorMat = matt(own, '#ffffff', surfaceOf(own, arcadeFloor, 11.5, 2.7, anisotropy));
  const floor = new THREE.Mesh(
    own.keep(new THREE.PlaneGeometry(MR_W * 2, (MR_FRONT + 0.4) * 2)),
    floorMat
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  root.add(floor);

  /*
   * The worn lane, as one plane down the whole length.
   *
   * Forty years of everybody walking the middle of an arcade and nobody walking
   * the edges. It has to be a single object — see `arcadeFloor`, where trying to
   * bake it into the tile produced a stripe every four metres — and it is
   * transparent white rather than a lighter texture so it takes the pendant
   * light with the floor underneath it.
   */
  const laneMat = own.keep(new THREE.MeshStandardMaterial({
    color: '#efe6d2', roughness: 0.62, metalness: 0,
    transparent: true, opacity: 0.085, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
  const lane = new THREE.Mesh(own.keep(new THREE.PlaneGeometry(MR_W * 2 - 1.5, 4.6)), laneMat);
  lane.rotation.x = -Math.PI / 2;
  lane.position.set(0, 0.006, 0.2);
  root.add(lane);

  /*
   * A drainage channel down one side, with grates. Every covered street has one
   * and it is the sort of thing only its absence is noticed.
   *
   * Flush with the floor, and that is not a detail. It was 5 cm proud — a strip
   * of raised geometry forty-six metres long that the game had never been told
   * about, so `groundAt` answered zero along the whole of it and a duelist
   * walking the north side of the arcade sank to the ankle for its entire
   * length. `npm run footing` found 107 cells of it.
   *
   * A channel is a recess anyway. Anything you walk over belongs at the height
   * the game says the ground is, or it belongs in `platforms`.
   */
  root.add(box(own, MR_W * 2, 0.014, 0.34, decal(own, '#4e4941'), 0, 0.007, -4.6));
  for (let i = 0; i < 10; i++) {
    root.add(box(own, 0.5, 0.02, 0.3, decal(own, '#3f4247'), -21 + i * 4.7, 0.01, -4.6));
  }

  /* ---------------------------------------------------------------- */
  /* the two rows of units                                             */
  /* ---------------------------------------------------------------- */

  /* Repeat 1: `tiled` puts the scale in the geometry, so every brick in the city
     is the same brick whatever size the wall it is on. See `kit.ts`. */
  const brickTex = surfaceOf(own, () => brick('#645749'), 1, 1, anisotropy);
  const renderTex = surfaceOf(own, () => render('#8c8170'), 1, 1, anisotropy);
  const upperSkin = tiled(matt(own, '#ffffff', renderTex));
  const blockSkin = tiled(matt(own, '#ffffff', brickTex));
  /* For the surround on the way through to Black Crown — the one piece of cut
     stone in an arcade otherwise made of brick, board and steel. */
  const stoneTrim = tiled(matt(own, '#ffffff',
                               surfaceOf(own, () => concrete('#8a8478'), 1, 1, anisotropy)));
  const timber = matt(own, '#ffffff', surfaceOf(own, darkWood, 2, 1, anisotropy));
  const dimGlass = own.keep(new THREE.MeshStandardMaterial({
    color: '#161b22', roughness: 0.3, metalness: 0,
  }));

  /**
   * One shop unit, on whichever side it belongs to.
   *
   * `side` is −1 for the north row and +1 for the south, and every offset below
   * hangs off it — which is the bug the street taught: place things along the
   * direction the building faces *into* and the whole frontage ends up buried
   * inside the brickwork.
   */
  const unit = (u: Unit, cx: number, side: -1 | 1) => {
    const faceZ = side * MR_FRONT;      // the plane the shopfront sits on
    const out = -side;                  // into the arcade
    const zf = faceZ + out * 0.05;
    const w = UNIT_W - 0.14;            // a hair of shadow between neighbours

    /* Party walls between units — the vertical rhythm that says "nine shops"
       rather than "one long wall with signs on it". */
    root.add(box(own, 0.16, 4.5, 0.5, matt(own, '#4a423a'),
                 cx - UNIT_W / 2, 2.25, faceZ + out * 0.16));

    /* Stallboard: the low plinth every one of these sits on. */
    root.add(box(own, w, 0.34, 0.5, timber, cx, 0.17, faceZ + out * 0.16));

    if (u.shut) {
      /* Shut: the shutter, its guide rails, and the box it rolls into. */
      const shutMat = own.keep(new THREE.MeshStandardMaterial({
        color: '#ffffff', roughness: 0.72, metalness: 0,
        map: surfaceOf(own, () => shutter(u.shut as string), 1, 1, anisotropy),
      }));
      const face = new THREE.Mesh(own.keep(new THREE.PlaneGeometry(w - 0.3, 2.62)), shutMat);
      face.position.set(cx, 1.65, zf + out * 0.16);
      face.rotation.y = side === -1 ? 0 : Math.PI;
      face.receiveShadow = true;
      root.add(face);
      for (const gx of [-1, 1]) {
        root.add(box(own, 0.12, 2.7, 0.22, matt(own, '#4e4a44'),
                     cx + gx * (w / 2 - 0.1), 1.65, faceZ + out * 0.2));
      }
      /* The shutter box sits back from the fascia above it. At `out * 0.22` with
         0.34 of depth the two shared their front face over a square metre and a
         half, on every shuttered unit in the arcade. */
      root.add(box(own, w - 0.1, 0.42, 0.30, matt(own, '#403c37'), cx, 3.14, faceZ + out * 0.18));
      /* A bill pasted on it, because a shut shutter is where bills end up. */
      if (rnd() > 0.4) {
        root.add(box(own, 0.5, 0.7, 0.02, decal(own, '#b8ae94'),
                     cx + (rnd() - 0.5) * 1.6, 1.7, faceZ + out * 0.3));
      }
    } else {
      /*
       * Open: a recess of dark glass with warm light behind it, mullioned, with
       * goods stacked against the inside.
       *
       * The mullions are not detail for its own sake. Without them a shopfront
       * is one lit rectangle two and a half metres tall, and nine of those in a
       * row read as a lightbox rather than a street — the same lesson the
       * terraces on Turtle Lane taught, arriving at half the viewing distance.
       */
      /*
       * A window with panes in it, not one lit slab with bars laid over it.
       *
       * It was a single sheet 4.3 m wide and 2.3 m tall in one flat colour, with
       * the mullions floating 3 cm in front of it and a near-black reveal behind
       * that. From thirty metres it read as a shopfront. From two — which is the
       * distance this whole area is designed to be seen at — it read as a slab
       * of colour inside a slab of black, and the bars laid over it were three
       * more surfaces stacked inside four centimetres of depth.
       *
       * So the glazing is cut into bays and the frame goes *between* them.
       * Nothing overlaps anything on any axis: each pane sits in its own hole,
       * each mullion in its own gap. There is nothing left for the depth buffer
       * to arbitrate, and it reads as joinery rather than as a poster.
       */
      const gw = w - 0.5;
      const bays = Math.max(3, Math.round(gw / 1.05));
      const bayW = gw / bays;
      const lit = glow(own, u.cool ? '#6f8479' : '#9a6f36');
      const frame = matt(own, '#33291f');

      /* The reveal, behind the glazing and only ever seen at its edges. Dark
         timber rather than near-black: a surround is a frame, and #161b22 seen
         from two metres is a hole in the world. */
      root.add(box(own, gw + 0.12, 2.62, 0.1, matt(own, '#2b2119'), cx, 1.72, zf + out * 0.06));

      for (let m = 0; m < bays; m++) {
        const bx = cx - gw / 2 + bayW * (m + 0.5);
        root.add(box(own, bayW - 0.1, 1.66, 0.05, lit, bx, 1.55, zf + out * 0.17));
        root.add(box(own, bayW - 0.1, 0.26, 0.05, lit, bx, 2.66, zf + out * 0.17));
      }
      /*
       * Uprights in front, rails behind, and the two at different depths.
       *
       * A frame whose members all sit on one plane is a frame whose members all
       * share a face wherever they cross — and they cross at every joint, which
       * is nine times per unit and 280 pairs across the arcade. Real joinery does
       * not do that either: the stiles stand proud and the rails are set back
       * into them, which is both why it reads as woodwork and why nothing here
       * is coplanar with anything.
       */
      for (let m = 1; m < bays; m++) {
        root.add(box(own, 0.08, 2.5, 0.10, frame, cx - gw / 2 + bayW * m, 1.75, zf + out * 0.20));
      }
      root.add(box(own, 0.1, 2.66, 0.10, frame, cx - gw / 2, 1.72, zf + out * 0.20));
      root.add(box(own, 0.1, 2.66, 0.10, frame, cx + gw / 2, 1.72, zf + out * 0.20));
      root.add(box(own, gw, 0.09, 0.07, frame, cx, 2.455, zf + out * 0.165));
      root.add(box(own, gw + 0.2, 0.12, 0.07, frame, cx, 2.93, zf + out * 0.165));

      /*
       * Stock in the window, standing in front of the glazing rather than buried
       * behind it.
       *
       * These used to sit at `out * 0.02` — inside the reveal, behind an opaque
       * pane — so the only part anybody ever saw was the centimetre poking out
       * through the front of the glass. A row of coloured slivers exactly level
       * with a large flat surface: invisible as a detail, and the sort of thing
       * that fights.
       */
      const stock = [u.ground, u.ink, u.awning ?? u.ground, u.noren ?? u.ink];
      for (let d = 0; d < Math.max(3, Math.floor(gw / 0.9)); d++) {
        root.add(box(own, 0.28, 0.24 + rnd() * 0.2, 0.16, matt(own, stock[d % stock.length]),
                     cx - gw / 2 + 0.45 + d * 0.9, 0.92 + (d % 2) * 0.16, zf + out * 0.31));
      }

      if (u.noren) {
        /* A split curtain over the doorway — three panels with a gap between,
           which is the whole reason it reads as cloth and not as a board. */
        const nx = cx + (rnd() - 0.5) * (w * 0.3);
        for (let n = -1; n <= 1; n++) {
          root.add(box(own, 0.52, 0.72, 0.03, matt(own, u.noren),
                       nx + n * 0.56, 2.16, zf + out * 0.26));
        }
        /* The rail is deeper than the cloth hanging off it, so its faces are
           3 cm outside the panels' rather than 1.5 cm inside them. */
        root.add(box(own, 1.8, 0.07, 0.12, matt(own, '#3a3128'), nx, 2.56, zf + out * 0.26));
      }

      /* Light out of the doorway onto the floor. Three of these across the whole
         arcade, not fourteen — the pendants do the lighting, and these are only
         there so the open units read warmer than the shut ones. */
      if (rnd() > 0.72) {
        const spill = new THREE.PointLight(u.cool ? '#a8c4b6' : '#ffb069', 24, 7, 2);
        spill.position.set(cx, 1.9, faceZ + out * 1.1);
        root.add(spill);
        lights.push(spill);
      }
    }

    /* ---- the fascia, and what is written on it ---- */

    const fw = w - 0.24;
    const fh = 1.0;
    root.add(box(own, w, 1.2, 0.3, matt(own, u.ground), cx, 3.62, faceZ + out * 0.24));
    if (u.name) {
      const board = own.keep(new THREE.MeshBasicMaterial({
        map: surfaceOf(
          own,
          () => signBoard(u.name, u.ink, u.ground, u.trade, fw / fh),
          1, 1, anisotropy
        ),
        color: u.shut ? '#7c7568' : '#cfc4a6',
      }));
      const mesh = new THREE.Mesh(own.keep(new THREE.PlaneGeometry(fw, fh)), board);
      /* 0.47, not 0.41: the board behind it ends at 0.39, and 20 mm is not
         enough clearance for two large flat faces pointing the same way. */
      mesh.position.set(cx, 3.62, faceZ + out * 0.47);
      mesh.rotation.y = side === -1 ? 0 : Math.PI;
      root.add(mesh);
    }

    /*
     * The projecting sign, hung at right angles out over the arcade.
     *
     * This is the single most recognisable thing about a Japanese shopping
     * street, and it is the reason the canopy does not read as a corridor: a row
     * of boards sticking out into the middle at head height gives the long view
     * something to be interrupted by, so forty-six metres of arcade has depth
     * cues all the way down it instead of two converging walls.
     */
    root.add(box(own, 0.1, 0.1, 0.8, matt(own, '#403a33'), cx, 4.32, faceZ + out * 0.5));
    const hang = box(own, 0.09, 0.78, 0.62, matt(own, u.ground), cx, 3.92, faceZ + out * 0.92);
    root.add(hang);
    /*
     * The device on it stands *proud* of the board — 0.17 against the board's
     * 0.09, so it is 4 cm out on both faces rather than 1.5 cm in.
     *
     * At 0.06 it sat inside the board with 15 mm between their side faces, on
     * every one of the eighteen units, hanging at head height in the middle of
     * the arcade. It is the flicker you see standing between the bakery and the
     * butcher, and it was there on all of them.
     */
    root.add(box(own, 0.17, 0.5, 0.4, matt(own, u.ink), cx, 3.92, faceZ + out * 0.92));

    if (u.awning) {
      const aw = w - 0.7;
      const awn = box(own, aw, 0.09, 1.35, matt(own, u.awning), cx, 3.0, faceZ + out * 0.78);
      awn.rotation.x = side * 0.17;
      root.add(awn);
      /* The scalloped edge, as a row of tabs. */
      for (let i = 0; i < Math.floor(aw / 0.4); i++) {
        root.add(box(own, 0.32, 0.2, 0.05, matt(own, u.awning),
                     cx - aw / 2 + 0.2 + i * 0.4, 2.79, faceZ + out * 1.42));
      }
      /* And the two arms holding it up. */
      for (const ax of [-1, 1]) {
        root.add(box(own, 0.06, 0.06, 1.3, matt(own, '#4a443c'),
                     cx + ax * (aw / 2 - 0.15), 3.06, faceZ + out * 0.76));
      }
    }

    /* ---- the floor above, up to the eaves ---- */

    root.add(box(own, w, 1.68, 0.4, upperSkin, cx, 5.06, faceZ + out * 0.18));
    const wins = 2;
    for (let i = 0; i < wins; i++) {
      const wx = cx - w / 2 + (w / wins) * (i + 0.5);
      const lit = rnd() > 0.68;
      root.add(box(own, 0.9, 0.9, 0.1, matt(own, '#3c3630'), wx, 5.06, faceZ + out * 0.36));
      root.add(box(own, 0.74, 0.74, 0.05, lit ? glow(own, '#7d5c33') : dimGlass,
                   wx, 5.06, faceZ + out * 0.42));
      root.add(box(own, 1.04, 0.08, 0.16, matt(own, '#5c554c'), wx, 4.57, faceZ + out * 0.42));
    }
  };

  /* The blocks the units are cut into — one slab a side, which is all collision
     ever needed and all the camera ever sees the back of. */
  const blockDepth = MR_D - MR_FRONT;
  const blockZ = (MR_FRONT + MR_D) / 2;
  root.add(box(own, MR_W * 2, 8.6, blockDepth, blockSkin, 0, 4.3, -blockZ));
  /*
   * The south block, with the way through to Black Crown cut out of it.
   *
   * Six metres at the far end, where the last unit used to be. That unit is not
   * drawn: a shopfront and a passage cannot both be in one bay, and a passage
   * that begins behind a shutter is not a passage.
   */
  root.add(box(own, 39, 8.6, blockDepth, blockSkin, -3.5, 4.3, blockZ));
  root.add(box(own, 1, 8.6, blockDepth, blockSkin, 22.5, 4.3, blockZ));
  root.add(box(own, 6, 3.4, blockDepth, blockSkin, 19, 6.9, blockZ));

  for (let i = 0; i < UNITS; i++) {
    const cx = -MR_W + UNIT_W * (i + 0.5);
    unit(NORTH[i], cx, -1);
    if (i < UNITS - 1) unit(SOUTH[i], cx, 1);
  }

  /*
   * And the passage itself, dressed as an opening rather than left as a hole.
   *
   * Same three pieces as the shrine's way out, and for the same reason: a
   * doorway has to read as one from the far end of the arcade, or forty-six
   * metres of shopfront swallow it. Jambs and a head standing proud of the
   * building line, a floor going through, and the far end lit — you cannot see
   * into another area, but you can see that this one goes somewhere.
   */
  {
    const PZ = MR_FRONT - 0.4;      // the face the surround stands on
    for (const side of [-1, 1] as const) {
      root.add(box(own, 0.6, 5.4, 0.75, stoneTrim, 19 + side * 3.3, 2.7, PZ - 0.3));
    }
    root.add(box(own, 7.4, 0.6, 0.75, stoneTrim, 19, 5.7, PZ - 0.3));
    const through = new THREE.Mesh(
      own.keep(new THREE.PlaneGeometry(6, 5)),
      matt(own, '#ffffff', surfaceOf(own, () => paving({ dirt: 0.4 }), 2, 1.6, anisotropy))
    );
    through.rotation.x = -Math.PI / 2;
    through.position.set(19, 0.01, 7.2);
    root.add(through);
    /* The lane beyond, suggested and not modelled: a wall, a lit window on it,
       and one lamp. */
    root.add(box(own, 6.4, 5.6, 0.4, matt(own, '#3a3029'), 19, 2.8, 9.6));
    root.add(box(own, 2.2, 1.5, 0.14, glow(own, '#a37f4a'), 19, 3.1, 9.35));
    const beyond = new THREE.PointLight('#ffc186', 24, 12, 2);
    beyond.position.set(19, 3.4, 7.6);
    root.add(beyond);
    /* And a board over it, because a turning nobody has signposted is a gap. */
    const sign = new THREE.Mesh(
      own.keep(new THREE.PlaneGeometry(5.6, 1.05)),
      own.keep(new THREE.MeshBasicMaterial({
        map: surfaceOf(own, () => signBoard('BLACK CROWN', '#e0cfa2', '#232a33', undefined, 5.6 / 1.05),
                       1, 1, anisotropy),
        color: '#a89a7c',
      }))
    );
    sign.rotation.y = Math.PI;
    sign.position.set(19, 6.55, PZ - 0.72);
    root.add(sign);
    root.add(box(own, 6, 1.3, 0.3, matt(own, '#2b2723'), 19, 6.55, PZ - 0.6));
  }

  /* ---------------------------------------------------------------- */
  /* the canopy — the top wall                                         */
  /* ---------------------------------------------------------------- */

  const steel = matt(own, '#4a5058');

  /* Eaves beams, running the full length on both sides. */
  for (const s of [-1, 1] as const) {
    /* A hair shorter than the block behind it, so their ends are not one face. */
    root.add(box(own, MR_W * 2 - 0.12, 0.4, 0.36, steel, 0, EAVE_Y, s * (MR_FRONT + 0.25)));
  }
  /* Ridge. */
  root.add(box(own, MR_W * 2, 0.3, 0.3, steel, 0, RIDGE_Y + 0.1, 0));

  /* Trusses across, every 4.6 m. */
  const rise = RIDGE_Y - EAVE_Y;
  const run = MR_FRONT + 0.25;
  const legLen = Math.hypot(run, rise);
  const legAngle = Math.atan2(rise, run);
  for (let i = 0; i <= 10; i++) {
    const x = -MR_W + (MR_W * 2 / 10) * i;
    for (const s of [-1, 1] as const) {
      const leg = box(own, 0.16, 0.22, legLen, steel, x, EAVE_Y + rise / 2, s * run / 2);
      leg.rotation.x = -s * legAngle;
      leg.castShadow = false;
      root.add(leg);
    }
    /*
     * The tie across the bottom of the truss, and a king post up to the ridge.
     *
     * Their widths are chosen so no two of the three ever sit 15 mm apart. The
     * rafters are 0.16 across; a tie of 0.13 and a post of 0.11 put every one of
     * their side faces a centimetre and a half inside a rafter, over a metre of
     * shared length, eleven trusses down the arcade — which is 44 flickering
     * pairs directly over the player's head, and the biggest single source of it
     * in the area.
     *
     * A tie beam heavier than the rafters it carries is also simply what a truss
     * looks like. The post is slimmer than both for the same reason in reverse.
     */
    /* Slung below the rafters rather than level with their feet: the rafters'
       lowest point is 5.79 and a tie at 5.88 put its underside within 2 cm of
       it across the full width of the arcade, eleven times over. */
    const tie = box(own, 0.26, 0.14, run * 2, steel, x, EAVE_Y - 0.2, 0);
    tie.castShadow = false;
    root.add(tie);
    const post = box(own, 0.08, rise, 0.08, steel, x, EAVE_Y + rise / 2, 0);
    post.castShadow = false;
    root.add(post);
  }

  /*
   * The panels themselves.
   *
   * `castShadow` off, on every piece of the canopy, and that is not an oversight
   * to be tidied up later. The one shadow-casting light in this area points
   * straight down from above the roof, because that is what a line of pendants
   * looks like and it costs a fraction of eight shadowed point lights. Leave the
   * roof casting and it sits between that light and the floor, and the entire
   * arcade renders in its shade.
   *
   * They are dark and slightly glossy rather than translucent. A real arcade
   * roof glows at midday; at the end of the day there is nothing above it to
   * come through, so what sells it is the pendants catching the underside — and
   * that wants a surface, not a sheet of fake daylight.
   */
  const panelMat = own.keep(new THREE.MeshStandardMaterial({
    color: '#262b33', roughness: 0.5, metalness: 0,
  }));
  const panelLen = Math.hypot(run + 0.2, rise);
  for (const s of [-1, 1] as const) {
    const panel = box(own, MR_W * 2 + 0.5, 0.09, panelLen, panelMat,
                      0, EAVE_Y + rise / 2 + 0.16, s * (run + 0.2) / 2);
    panel.rotation.x = -s * legAngle;
    panel.castShadow = false;
    panel.receiveShadow = false;
    root.add(panel);
    /* Purlins under it, so the underside has structure to catch the light. */
    for (let k = 1; k <= 2; k++) {
      const t = k / 3;
      const pur = box(own, MR_W * 2, 0.1, 0.1, steel,
                      0, EAVE_Y + rise * t + 0.03, s * run * (1 - t));
      pur.castShadow = false;
      root.add(pur);
    }
  }

  /* ---- pendants ---- */

  const shadeGeo = own.keep(new THREE.CylinderGeometry(0.12, 0.38, 0.3, 14, 1, true));
  const shadeMat = own.keep(new THREE.MeshStandardMaterial({
    color: '#3d4148', roughness: 0.5, metalness: 0, side: THREE.DoubleSide,
  }));
  const lensGeo = own.keep(new THREE.CircleGeometry(0.34, 14));
  const lensMat = glow(own, '#e8b878');
  const PENDANTS = 8;
  for (let i = 0; i < PENDANTS; i++) {
    const x = -MR_W + (MR_W * 2 / PENDANTS) * (i + 0.5);
    const cord = box(own, 0.035, 1.35, 0.035, steel, x, 6.4, 0);
    cord.castShadow = false;
    root.add(cord);

    const shade = new THREE.Mesh(shadeGeo, shadeMat);
    shade.position.set(x, 5.58, 0);
    root.add(shade);

    /* 6 cm below the shade's rim, not 1. A flat disc a centimetre under an
       opaque cone is two horizontal faces the depth buffer has to choose
       between, on every one of the eight pendants down the middle of the
       arcade — see the same fault on the arch lamps and on Turtle Lane's. */
    const lens = new THREE.Mesh(lensGeo, lensMat);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(x, 5.37, 0);
    root.add(lens);

    /*
     * In the hundreds, like every other lamp in this world, and for the same
     * reason: intensity is candela and falls off with the square of distance, so
     * a fitting five and a half metres up needs three figures before anything
     * reaches the floor. Unshadowed — the directional below does that job for
     * all eight of them at once.
     */
    const bulb = new THREE.PointLight('#ffbe7c', 62, 13, 2);
    bulb.position.set(x, 5.34, 0);
    root.add(bulb);
    lights.push(bulb);
  }

  /* ---- bunting and lanterns, strung between the trusses ---- */

  for (const bx of [-15.5, -2.3, 11.8]) {
    root.add(box(own, 0.04, 0.04, run * 2, matt(own, '#4a443c'), bx, 5.34, 0));
    for (let i = 0; i < 11; i++) {
      const z = -4.6 + i * 0.92;
      const flag = box(own, 0.03, 0.3, 0.26,
                       matt(own, ['#8a4a3a', '#3f6a72', '#a8894a', '#5a7a4a', '#7a4a6a'][i % 5]),
                       bx, 5.16, z);
      flag.castShadow = false;
      root.add(flag);
    }
  }

  /* Paper lanterns over the noodle end — warm, and the only round thing in here. */
  const lanternGeo = own.keep(new THREE.CylinderGeometry(0.17, 0.17, 0.3, 12));
  const lanternMat = glow(own, '#c98a4e');
  for (let i = 0; i < 6; i++) {
    const x = 15.5 + i * 1.35;
    const cord = box(own, 0.03, 0.55, 0.03, matt(own, '#4a443c'), x, 5.1, 3.4);
    cord.castShadow = false;
    root.add(cord);
    const lantern = new THREE.Mesh(lanternGeo, lanternMat);
    lantern.position.set(x, 4.68, 3.4);
    root.add(lantern);
  }
  const lanternGlow = new THREE.PointLight('#ff9f52', 34, 9, 2);
  lanternGlow.position.set(18.8, 4.5, 3.2);
  root.add(lanternGlow);
  lights.push(lanternGlow);

  /* ---------------------------------------------------------------- */
  /* the west arch, and the street on the other side of it             */
  /* ---------------------------------------------------------------- */

  const archX = -MR_W;
  const stone = matt(own, '#ffffff', surfaceOf(own, () => plaster('#a2988a'), 1.6, 2, anisotropy));

  /* Two piers and a header. They stand just outside the 4.4 m opening, which is
     the same gap `areas.ts` leaves between its two west-end solids. */
  for (const s of [-1, 1] as const) {
    root.add(box(own, 1.5, 5.6, 1.1, stone, archX, 2.8, s * 2.75));
    root.add(box(own, 1.7, 0.24, 1.3, matt(own, '#5f574c'), archX, 5.72, s * 2.75));
  }
  /*
   * The header runs *into* the pier caps rather than sitting on them.
   *
   * At 6.05 by 0.9 its underside was at 5.60, which is exactly where the caps
   * begin — two faces at one depth, arbitrated by the depth buffer, changing
   * their minds as the camera moves. Dropping it 5 cm buries that face inside
   * the cap instead. Interpenetration is invisible; alignment flickers.
   */
  /* Inset from the piers, as the street's header is: flush is a shared face. */
  root.add(box(own, 1.42, 1.0, 6.52, stone, archX, 6.0, 0));
  root.add(box(own, 1.8, 0.26, 7.0, matt(own, '#5f574c'), archX, 6.56, 0));

  /*
   * The name, on the inside face.
   *
   * Facing back down the arcade rather than out at the street, which is the
   * opposite of where a real shōtengai gate puts it — and is right here for a
   * reason the fiction cannot help with: the street is a different area, so
   * nobody standing in Turtle Lane can see this board at all. The only place it
   * is ever read from is inside, on the way out.
   */
  const archBoard = own.keep(new THREE.MeshBasicMaterial({
    map: surfaceOf(own, () => signBoard('MARKET ROW', '#f0e2bc', '#3a2f22', undefined, 5.4 / 0.82),
                   1, 1, anisotropy),
    color: '#cfc4a6',
  }));
  const archMesh = new THREE.Mesh(own.keep(new THREE.PlaneGeometry(5.4, 0.82)), archBoard);
  archMesh.position.set(archX + 0.78, 6.05, 0);
  archMesh.rotation.y = Math.PI / 2;
  root.add(archMesh);

  /* A lamp on each pier, throwing light down onto the threshold. */
  for (const s of [-1, 1] as const) {
    /*
    * Mounted proud of the pier, not flush with it.
    *
    * At `archX + 0.6` the housing's front face landed on exactly the pier's, so
    * two surfaces 30 cm across were arguing for the same depth — one on each
    * side of the arch. They are the two grey rectangles that flicker as you walk
    * out of the arcade.
    *
    * `npm run coplanar` could not see them: it only considers a pair where one
    * side is under 30 cm deep, because two *thick* solids meeting share a face
    * that is buried between them and never drawn. A 30 cm box hung on a wall is
    * the case that rule was not written for, and the threshold has moved.
    */
    root.add(box(own, 0.3, 0.5, 0.3, matt(own, '#3f4348'), archX + 0.75, 4.5, s * 2.75));
    /* Clear of the housing above it by 6 cm. At 1 cm these two — one on each
       pier — are the grey rectangles that flicker on the wall as you walk out
       of the arcade. */
    const lens = new THREE.Mesh(own.keep(new THREE.PlaneGeometry(0.24, 0.24)), glow(own, '#e0b47e'));
    lens.rotation.x = Math.PI / 2;
    lens.position.set(archX + 0.75, 4.19, s * 2.75);
    root.add(lens);
  }
  /*
   * Cool, and it is the only cool light hanging in this area.
   *
   * What comes through the arch is the end of the day on Turtle Lane, which is
   * the blue the street is lit by. Warm light here would have said the arch was
   * another shop; cool light says it is outside, and it gives the west end of
   * the arcade a temperature to be different from the middle.
   */
  const archLight = new THREE.PointLight('#8fa8c4', 105, 15, 2);
  archLight.position.set(archX + 1.4, 4.3, 0);
  root.add(archLight);
  lights.push(archLight);

  /*
   * Turtle Lane, on the other side, built as a backdrop.
   *
   * The one place in this area where the void can still be reached with the eye.
   * Everywhere else is walled or roofed; the arch is a four-metre hole with a
   * different area behind it, and only one of the two is ever in the scene.
   *
   * So a slice of the street is drawn here — road, kerb, and a terrace front
   * with a few lit windows. It is not the real Starting Area and it does not
   * have to be: it is seen through a 4.4 m opening from at least four metres
   * back, which is a cone about eleven metres wide and fourteen tall by the time
   * it reaches the building. Those are the dimensions it is built to, and not a
   * centimetre more.
   */
  const beyondSkin = tiled(matt(own, '#ffffff', surfaceOf(own, () => brick('#6d5f54'), 1, 1, anisotropy)));
  const beyondRoad = new THREE.Mesh(
    own.keep(new THREE.PlaneGeometry(9, 20)),
    matt(own, '#33353a')
  );
  beyondRoad.rotation.x = -Math.PI / 2;
  beyondRoad.position.set(archX - 4.5, 0.002, 0);
  beyondRoad.receiveShadow = true;
  root.add(beyondRoad);
  root.add(box(own, 9, 0.16, 2.4, matt(own, '#7c7e82'), archX - 4.5, 0.08, -7.4));

  /* Sunk 10 cm, so its base is not on the plane the kerb in front of it starts
     from — both sat at exactly y 0 and fought over two square metres. */
  root.add(box(own, 3, 14, 19, beyondSkin, archX - 9.6, 6.9, 0));
  for (let f = 0; f < 4; f++) {
    for (let c = 0; c < 5; c++) {
      const wy = 3.4 + f * 2.7;
      const wz = -7.2 + c * 3.6;
      const lit = rnd() > 0.5;
      root.add(box(own, 0.12, 1.4, 1.0, matt(own, '#3c3630'), archX - 8.05, wy, wz));
      root.add(box(own, 0.05, 1.2, 0.84, lit ? glow(own, '#8a6334') : dimGlass,
                   archX - 7.98, wy, wz));
    }
  }
  const beyondLamp = new THREE.PointLight('#ffb469', 150, 20, 2);
  beyondLamp.position.set(archX - 4.2, 4.2, -5.5);
  root.add(beyondLamp);
  lights.push(beyondLamp);

  /* ---------------------------------------------------------------- */
  /* the east gates — shut, and clearly not the end of the arcade      */
  /* ---------------------------------------------------------------- */

  const gateX = MR_W - 1;

  /*
   * A lattice you can see through, not a shutter you cannot.
   *
   * The whole job of this end is to say "the arcade carries on and this part of
   * it is closed", and a solid surface says the opposite — it says the arcade
   * ends here and always did. So it is barred, and the space behind it is built
   * and lit: floor, side walls, and a wall at the far end with a notice on it.
   * Six metres of geometry nobody can reach, earning its place by making the
   * other forty-six believable.
   */
  const barMat = matt(own, '#3f4348');
  const bars = 34;
  for (let i = 0; i <= bars; i++) {
    root.add(box(own, 0.07, 3.0, 0.07, barMat,
                 gateX, 1.65, -MR_FRONT + (MR_FRONT * 2 / bars) * i));
  }
  for (const ry of [0.32, 1.72, 3.06]) {
    root.add(box(own, 0.1, 0.1, MR_FRONT * 2, barMat, gateX, ry, 0));
  }
  /* The box the gate rolls into, and the runner it hangs off. */
  /* The lintel and the beam over it are *seated* on the walls, not driven 20 and
     30 cm into them. Six centimetres of bearing each side is enough to read as
     carried, and leaves no long intersection line down either wall. */
  root.add(box(own, 0.6, 0.5, MR_FRONT * 2 + 0.08, matt(own, '#4a443c'), gateX, 3.44, 0));
  root.add(box(own, 0.9, 0.9, MR_FRONT * 2 + 0.08, matt(own, '#3a352e'), gateX, 4.1, 0));

  /* The vestibule on the far side: walls, floor, and a wall to stop the view. */
  for (const s of [-1, 1] as const) {
    root.add(box(own, 6, 8.6, 4, blockSkin, gateX + 4, 4.3, s * (MR_FRONT + 2)));
  }
  /* A little taller than the blocks it stands behind: at a shared 8.6 their
     roofs were one plane over five square metres. */
  /* Also a little short of the blocks in front of it, so their ends and its
     ends are not the same two planes. */
  root.add(box(own, 1.4, 8.74, MR_FRONT * 2 + 7.88, blockSkin, gateX + 6.4, 4.37, 0));
  /* Starting past the arcade floor's own edge at x 23 rather than under it:
     two planes at y 0 sharing 40 cm of ground is z-fighting by definition, and
     `npm run coplanar` found it as four square metres of it. */
  const vestibule = new THREE.Mesh(
    own.keep(new THREE.PlaneGeometry(5.4, MR_FRONT * 2)),
    floorMat
  );
  vestibule.rotation.x = -Math.PI / 2;
  vestibule.position.set(gateX + 4.5, 0.001, 0);
  vestibule.receiveShadow = true;
  root.add(vestibule);

  /* The notice on the wall at the end, which is the only thing in this area that
     tells you where the arcade goes next. */
  const noticeMat = own.keep(new THREE.MeshBasicMaterial({
    map: surfaceOf(own, () => signBoard('STATION', '#e8dcc0', '#2f3a48', 'THIS WAY', 2.6 / 0.8),
                   1, 1, anisotropy),
    color: '#9a917e',
  }));
  const notice = new THREE.Mesh(own.keep(new THREE.PlaneGeometry(2.6, 0.8)), noticeMat);
  notice.position.set(gateX + 5.65, 2.5, 0);
  notice.rotation.y = -Math.PI / 2;
  root.add(notice);

  const gateLight = new THREE.PointLight('#c4a274', 52, 11, 2);
  gateLight.position.set(gateX + 3.4, 4.0, 0);
  root.add(gateLight);
  lights.push(gateLight);

  /* ---------------------------------------------------------------- */
  /* what is left out on the floor                                     */
  /* ---------------------------------------------------------------- */

  /*
   * Drawn from `MARKET_GOODS`, which is the same list `areas.ts` spreads into
   * its solids.
   *
   * So a crate stands exactly where the thing you bump into stands, and it
   * cannot drift: there is one set of nine rectangles and this reads it. The
   * pavements on Turtle Lane are arranged the same way and for the same reason —
   * when the collision and the picture are two copies of a number, one of them
   * eventually gets edited alone, and the bug that follows is somebody's feet
   * disappearing into the ground.
   *
   * Each drawer fills the rectangle it is handed rather than using numbers of
   * its own, so moving a crate stack in `areas.ts` moves the crates.
   */
  const goods: Record<GoodsKind, (g: Goods) => void> = {
    crates: (g) => {
      const cols = Math.max(2, Math.round(g.hw));
      const cw = (g.hw * 2) / cols;
      for (let i = 0; i < cols; i++) {
        const cx = g.x - g.hw + cw * (i + 0.5);
        const high = 1 + Math.floor(rnd() * 2);
        let top = 0;
        for (let k = 0; k < high; k++) {
          const y = 0.19 + k * 0.37;
          const c = box(own, cw - 0.1, 0.36, g.hd * 2 - 0.12,
                        matt(own, k % 2 ? (g.tint ?? '#6f5a3a') : '#8a6b45'),
                        cx, y, g.z);
          c.rotation.y = (rnd() - 0.5) * 0.09;
          root.add(c);
          top = y + 0.18;
        }
        /*
         * Something in the top one, sitting *on* it.
         *
         * The height used to be worked out from the number of crates rather than
         * from where the top of them actually was, and it came out 17 cm high —
         * so every stack in the arcade had three little boxes of vegetables
         * hovering in the air above it. Measured off `top` now, which is the one
         * number that cannot be wrong.
         */
        for (let n = 0; n < 3; n++) {
          root.add(box(own, 0.18, 0.15, 0.18,
                       matt(own, ['#7a8a3a', '#a8703a', '#8a3a3a', '#c2a04a', '#6a7a4a'][(i + n) % 5]),
                       cx + (n - 1) * 0.3, top + 0.074,
                       g.z + (rnd() - 0.5) * (g.hd * 0.9)));
        }
      }
    },

    bin: (g) => {
      root.add(box(own, g.hw * 2, 0.9, g.hd * 2, matt(own, '#3f443f'), g.x, 0.45, g.z));
      root.add(box(own, g.hw * 2 + 0.08, 0.08, g.hd * 2 + 0.08, matt(own, '#2f342f'), g.x, 0.93, g.z));
    },

    sacks: (g) => {
      /*
       * Kept inside the rectangle they are declared as.
       *
       * At one and a half times the depth, with half of it again as jitter and a
       * quarter-radian turn on top, a sack reached 20 cm past the front of its
       * own footprint — straight into the shopfront behind it.
       */
      const n = Math.max(3, Math.round(g.hw * 2.4));
      for (let i = 0; i < n; i++) {
        const sk = box(own, (g.hw * 2) / n - 0.06, 0.34, g.hd * 1.1, matt(own, '#c4b48e'),
                       g.x - g.hw + ((g.hw * 2) / n) * (i + 0.5),
                       0.17 + (i % 2) * 0.34, g.z + (rnd() - 0.5) * (g.hd * 0.2));
        sk.rotation.y = (rnd() - 0.5) * 0.24;
        root.add(sk);
      }
    },

    rack: (g) => {
      /* Shelves are shelves: 6 cm of board with the cards standing on them.
         They were half a metre thick at 36 cm spacing, which means every tier
         was inside the one above it. */
      root.add(box(own, 0.12, 1.5, 0.12, matt(own, '#4a443c'), g.x, 0.75, g.z));
      for (let i = 0; i < 4; i++) {
        const y = 0.42 + i * 0.34;
        root.add(box(own, g.hw * 1.8, 0.05, g.hd * 1.2, matt(own, '#4a443c'), g.x, y, g.z));
        for (let c = 0; c < 5; c++) {
          root.add(box(own, 0.34, 0.24, 0.03,
                       matt(own, ['#8a7a5a', '#6a7a8a', '#8a6a5a', '#7a8a6a', '#8a6a7a'][(i + c) % 5]),
                       g.x - g.hw * 0.72 + c * (g.hw * 1.44 / 4), y + 0.15, g.z - g.hd * 0.3));
        }
      }
    },

    ice: (g) => {
      root.add(box(own, g.hw * 2, 0.72, g.hd * 2, matt(own, '#6f7276'), g.x, 0.36, g.z));
      root.add(box(own, g.hw * 2 - 0.2, 0.12, g.hd * 2 - 0.2, matt(own, '#c8d4d8'), g.x, 0.78, g.z));
      for (let i = 0; i < 7; i++) {
        const f = box(own, 0.33, 0.1, 0.15, matt(own, i % 3 ? '#8f9aa4' : '#a4736a'),
                      g.x - g.hw + 0.4 + i * ((g.hw * 2 - 0.8) / 6), 0.87,
                      g.z + (rnd() - 0.5) * (g.hd * 1.1));
        f.rotation.y = (rnd() - 0.5) * 0.7;
        root.add(f);
      }
    },

    bench: (g) => {
      const grp = new THREE.Group();
      grp.position.set(g.x, 0, g.z);
      const w = g.hw * 2 - 0.2;
      for (let i = 0; i < 4; i++) grp.add(box(own, w, 0.06, 0.13, timber, 0, 0.44, -0.22 + i * 0.16));
      for (let i = 0; i < 3; i++) grp.add(box(own, w, 0.13, 0.05, timber, 0, 0.6 + i * 0.16, 0.32));
      for (const sx of [-w / 2 + 0.2, w / 2 - 0.2]) {
        grp.add(box(own, 0.09, 0.44, 0.09, matt(own, '#3a3d40'), sx, 0.22, -0.18));
        grp.add(box(own, 0.09, 0.44, 0.09, matt(own, '#3a3d40'), sx, 0.22, 0.28));
      }
      root.add(grp);
    },

    bicycles: (g) => {
      root.add(box(own, g.hw * 2, 0.1, 0.1, matt(own, '#5a5f62'), g.x, 0.34, g.z));
      const n = 4;
      for (let i = 0; i < n; i++) {
        const b = new THREE.Group();
        b.position.set(g.x - g.hw + ((g.hw * 2) / n) * (i + 0.5), 0, g.z);
        b.rotation.z = 0.13;
        b.add(box(own, 0.05, 0.62, 0.05, matt(own, '#3f4348'), 0, 0.34, -0.34));
        b.add(box(own, 0.05, 0.62, 0.05, matt(own, '#3f4348'), 0, 0.34, 0.34));
        /* 0.6, not 0.8: at eight tenths the crossbar reached its own wheels and
           touched them exactly on the x face — eight pairs of it, one per wheel. */
        b.add(box(own, 0.05, 0.05, 0.6,
                  matt(own, ['#6a3a3a', '#3a4a6a', '#3a5a3a', '#5a4a2a'][i % 4]), 0, 0.62, 0));
        b.add(box(own, 0.34, 0.05, 0.05, matt(own, '#4a4e52'), 0, 0.86, -0.3));
        root.add(b);
      }
    },
  };

  for (const g of MARKET_GOODS) goods[g.kind](g);

  /* ---------------------------------------------------------------- */
  /* light                                                             */
  /* ---------------------------------------------------------------- */

  /*
   * One shadow-caster, pointing very nearly straight down.
   *
   * Eight pendants in a line is what this arcade *looks* lit by, and eight
   * shadow-casting point lights is six cube faces each — forty-eight shadow
   * renders a frame for a corridor. A single directional from above the canopy
   * produces the same read: short shadows directly under everything, which is
   * exactly what overhead lighting does.
   *
   * Very nearly, not exactly. A perfectly vertical light gives every object a
   * shadow of zero length hidden under its own footprint, and the arcade loses
   * all of its contact. A couple of degrees off gives each crate and each hanging
   * sign a short shadow that says which way is up.
   *
   * The canopy has `castShadow` off for this light's sake — see the panels.
   */
  const overhead = new THREE.DirectionalLight('#ffcf9e', 0.28);
  overhead.position.set(6, 24, 3);
  overhead.target.position.set(0, 0, 0);
  overhead.castShadow = true;
  overhead.shadow.mapSize.set(2048, 2048);
  overhead.shadow.camera.left = -25;
  overhead.shadow.camera.right = 25;
  overhead.shadow.camera.top = 11;
  overhead.shadow.camera.bottom = -11;
  overhead.shadow.camera.near = 1;
  overhead.shadow.camera.far = 42;
  /*
   * `bias` alone was never going to be enough here, and this area is the worst
   * case for it in the whole world.
   *
   * A constant depth bias shifts every shadow sample by the same amount, which
   * is right for a surface facing the light and hopeless for one edge-on to it —
   * the depth across a single shadow texel varies by far more than the bias, so
   * half the texel shadows itself. It shows as grey rectangles crawling over a
   * wall as the camera moves, which is exactly what it is: the shadow map
   * disagreeing with itself, one texel at a time.
   *
   * This light points very nearly straight down and every wall in the arcade is
   * vertical, so *every* wall is edge-on to it. `normalBias` pushes the sample
   * along the surface normal instead — off the surface, into the air in front of
   * it — and the amount it needs is about one shadow texel, which at 50 m across
   * 2048 is 2.4 cm.
   *
   * Not one light in this game set it. All five do now.
   */
  overhead.shadow.bias = -0.0009;
  /*
   * One texel, not two.
   *
   * `normalBias` buys its way out of acne by sampling the shadow map off the
   * surface, into the air in front of it — so whatever it is set to is also how
   * far a shadow slides away from the thing casting it. On the ground that shows
   * as a gap under the duelist's feet, with the shadow keeping its own company a
   * hand's width away: a figure standing on nothing.
   *
   * The amount needed is one shadow texel, which is what the note above works
   * out and is not what any of these were set to — every one of them was at
   * about twice it, and paid for it in daylight under everybody's shoes.
   */
  /* 50 m across 2048 is 2.4 cm. */
  overhead.shadow.normalBias = 0.027;
  root.add(overhead);
  root.add(overhead.target);
  lights.push(overhead);

  /*
   * Warm from above, dark below — the opposite way round from the street.
   *
   * Outside, the sky is a cool blue fill and the ground bounces almost nothing.
   * In here there is no sky: what is over your head is a painted metal canopy a
   * metre and a half above the lamps, so the ambient coming down is the pendants'
   * own light returned warm. Getting this the wrong way round is what makes an
   * interior look like an exterior with the lights turned off.
   */
  root.add(new THREE.HemisphereLight('#4a3c28', '#17130e', 0.22));
  root.add(new THREE.AmbientLight('#3a3128', 0.13));

  return {
    root,
    dispose() {
      for (const item of own.items) item.dispose();
      for (const light of lights) {
        const shadow = (light as THREE.PointLight | THREE.DirectionalLight).shadow;
        shadow?.map?.dispose();
      }
    },
  };
}
