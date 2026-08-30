/**
 * Inside Black Crown: three floors round an atrium, thirty-four metres by
 * twenty-six, and fourteen to the lantern.
 *
 * The first room in this world with a storey in it. Everything before it was a
 * street or a single room, and both of those get by on a flat notion of ground
 * and a wall that runs the whole height of the world. A gallery is neither: you
 * walk under it and over it, and the balustrade round it is not something you
 * bump into from below. `groundAt` and `settle` learned about floors for this
 * building, and this is the first thing that uses them.
 *
 * ## What you see, in the order you see it
 *
 * You come in at the west into the full height of the room — no lobby, no
 * ceiling over the door, the atrium open above you the moment you are through.
 * The flight up the east side is visible from the mat, which is what makes the
 * upper floors read as somewhere to go rather than as scenery. The second
 * flight goes back down the west, so the circuit crosses the atrium twice and
 * you look at it from two heights on the way round.
 *
 * ## The light
 *
 * A shop keeps its lights on. `Sky` is given `indoor`, which means the hour
 * changes the colour and the level of what comes through the front glass and
 * leaves the pendants alone — so the room is blue at dawn, warm at four, and
 * lit by nothing but its own lamps after dark, without a single fixture going
 * out in the middle of the day.
 *
 * ## Nothing is for sale
 *
 * Deliberately. The shelves have stock on them and none of it is a card you can
 * buy: the counter is built, the room is built, and what goes on the shelves is
 * a later job. What this has to prove now is that a room can have floors.
 */

import * as THREE from 'three';
import {
  woodFloor, darkWood, plaster, brick, concrete, paving, signBoard,
} from './surfaces';
import {
  Owned, box, matt, tiled, glow, surfaceOf, seeded, type BuiltArea,
} from './kit';
import { Sky, ownSky } from './sky';
import { AREAS, CS_G1, CS_G2, CS_TOP, CS_GROUND, groundAt } from '@/story/areas';

const AREA = AREAS['crown-shop'];
const at = (x: number, z: number, near?: number) => groundAt(AREA, x, z, near);

export function buildCrownShop(anisotropy: number): BuiltArea {
  const own = new Owned();
  const root = new THREE.Group();
  root.name = 'crown-shop';
  const rnd = seeded(0xc0a7);

  /* ---- surfaces ---- */

  /* Fourteen by eleven over thirty-four metres by twenty-six, which is a board
     about as wide as a board. At six by five each plank was two metres across
     and the floor read as decking. */
  const boardTex = surfaceOf(own, woodFloor, 14, 11, anisotropy);
  const galleryTex = surfaceOf(own, woodFloor, 8, 3, anisotropy);
  const wallTex = surfaceOf(own, () => plaster('#a8977c'), 1, 1, anisotropy);
  const brickTex = surfaceOf(own, () => brick('#6f584c'), 1, 1, anisotropy);
  const stoneTex = surfaceOf(own, () => concrete('#8a8478'), 1, 1, anisotropy);
  const timberTex = surfaceOf(own, darkWood, 1, 2, anisotropy);

  const walls = () => tiled(matt(own, '#ffffff', wallTex));
  const brickwork = () => tiled(matt(own, '#ffffff', brickTex));
  const stone = () => tiled(matt(own, '#ffffff', stoneTex));
  const timber = matt(own, '#ffffff', timberTex);
  const dark = matt(own, '#4a3f36');
  const iron = matt(own, '#413c36');
  const brass = matt(own, '#9a7d42');
  const oxblood = matt(own, '#7d3a35');
  const felt = matt(own, '#2f4a41');

  const W = 17;
  const D = 13;

  /* ---- the floors ---- */

  /** A run of floor. */
  const slab = (w: number, d: number, x: number, y: number, z: number, tex: THREE.Texture | null) => {
    const m = new THREE.Mesh(own.keep(new THREE.PlaneGeometry(w, d)), matt(own, '#ffffff', tex));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    m.receiveShadow = true;
    root.add(m);
  };

  /* The shop floor: boards, laid the length of the room. */
  slab(W * 2, D * 2, 0, 0, 0, boardTex);

  /*
   * The galleries, and the flights between them, read off `CS_GROUND`.
   *
   * Written once in the data and drawn from it here, so the step you can see is
   * the step `groundAt` answers with. A gallery is drawn as a slab with a
   * soffit under it; a tread is drawn as a box down to the one below, because a
   * flight with daylight under every step is a ladder.
   */
  for (const t of CS_GROUND) {
    const wide = t.hw > 2 && t.hd > 2;
    if (wide) {
      /* A floor plate with a beam-and-soffit underside. */
      /* The boards sit fourteen millimetres over the plate they are laid on,
         not four: at four the two of them are one plane as far as the depth
         buffer is concerned, and 174 m² of gallery flickers. */
      root.add(box(own, t.hw * 2, 0.36, t.hd * 2, timber, t.x, t.y - 0.18, t.z));
      slab(t.hw * 2 - 0.04, t.hd * 2 - 0.04, t.x, t.y + 0.014, t.z, galleryTex);
    } else {
      /*
       * Exactly its own platform, neither wider nor narrower.
       *
       * The platforms overlap each other by four millimetres so `groundAt` is
       * never deciding on a boundary. Drawing the tread *wider* than that undoes
       * it from the other side — at the join the box underfoot is the higher
       * tread while the height you are given is the lower, which
       * `npm run footing` reads as feet inside the floor. Drawing it *narrower*
       * leaves four millimetres at the end of a flight with nothing under it at
       * all, which the same check reads as a hole. Both of those were real. The
       * size the platform says is the only one that is neither.
       */
      root.add(box(own, t.hw * 2, 0.34, t.hd * 2, timber, t.x, t.y - 0.17, t.z));
      /* A nosing, wholly on its own tread — see `shrine.ts` on why it must not
         overhang the one below. */
      root.add(box(own, t.hw * 2, 0.05, 0.06, dark, t.x, t.y - 0.02, t.z - t.hd + 0.032));
    }
  }

  /* ---- the shell ---- */

  /** One wall of the room, with a plinth and a picture rail on it. */
  const wall = (
    along: 'x' | 'z', from: number, to: number, face: number, outward: 1 | -1,
    /*
     * A hair up or down.
     *
     * The long walls run past the corners and the short ones stop inside them,
     * so at each corner two walls occupy the same cubic metre — which is fine,
     * and would be fine invisibly, except that both start at zero and both stop
     * at 14.6. Two undersides in one plane and two tops in another, eight
     * times. Thirteen centimetres of difference is invisible and is the fix.
     */
    dy = 0
  ) => {
    const run = Math.abs(to - from);
    const mid = (from + to) / 2;
    const put = (len: number, h: number, thick: number, y: number, c: number, m: THREE.Material) => {
      const cross = face + outward * c;
      return along === 'x'
        ? box(own, len, h, thick, m, mid, y, cross)
        : box(own, thick, h, len, m, cross, y, mid);
    };
    root.add(put(run, CS_TOP + 1, 0.3, (CS_TOP + 1) / 2 + dy, 0.15, brickwork()));
    /* Plaster above the plinth, brick below it, which is what an old shop is. */
    root.add(put(run - 0.1, CS_TOP - 1.3, 0.16, 1.55 + (CS_TOP - 1.3) / 2 + dy, 0.32, walls()));
    root.add(put(run - 0.16, 1.4, 0.22, 0.68 + dy, 0.35, timber));
    root.add(put(run - 0.22, 0.14, 0.3, 1.47 + dy, 0.37, dark));
    /* And a picture rail at each gallery, which is what stops thirteen metres
       of wall reading as one flat sheet. */
    for (const y of [CS_G1 + 2.6, CS_G2 + 2.6]) {
      root.add(put(run - 0.3, 0.12, 0.26, y + dy, 0.36, dark));
    }
  };

  /*
   * The long walls run past the corners; the short ones stop inside them.
   *
   * Inset half a metre at every end — which is how these were first written —
   * leaves a metre of unclad building at each of the four corners, and what is
   * behind an unclad wall is the void. From inside the shop that is a
   * full-height slit of daylight down both sides of the room, which is exactly
   * what it looks like: a hole.
   */
  wall('x', -W - 0.6, W + 0.6, -D, 1);
  wall('x', -W - 0.6, W + 0.6, D, -1);
  wall('z', -D + 0.2, D - 0.2, W, -1, -0.13);
  /* The west wall, in two pieces with the way out between them. */
  wall('z', -D + 0.2, -2.9, -W, 1, -0.13);
  wall('z', 2.9, D - 0.2, -W, 1, -0.13);

  /*
   * The way out, dressed as a doorway.
   *
   * The same three pieces as every other threshold in this world: a stone
   * surround standing proud, the floor carrying through it, and something lit
   * on the other side — you cannot see into another area, but you can see that
   * this one goes somewhere.
   */
  /* Standing proud of the wall rather than flush into it: at x −17 the jambs
     share a face with the wall they are set in, and at z ±2.9 they share one
     with where it stops. */
  for (const s of [-1, 1] as const) {
    root.add(box(own, 0.7, 4.6, 0.6, stone(), -W + 0.45, 2.3, s * 3.3));
  }
  root.add(box(own, 0.7, 0.6, 7.2, stone(), -W + 0.45, 4.9, 0));
  /*
   * And the nine metres of wall *above* the lintel.
   *
   * The west wall is in two pieces with a five-point-eight metre gap between
   * them, and the gap is the full fourteen and a half metres of the room —
   * because a doorway was drawn into it and a doorway is five metres tall. The
   * lintel closed the bottom third and the rest of it was a hole, which from
   * inside the shop is the sky standing in a slot beside the door. It is what
   * Mike photographed, and no check saw it: the seam check excused every ray
   * that left near a doorway, which is exactly where this one is.
   *
   * Tucked five centimetres behind the lintel's top rather than started on it,
   * so the two of them are not a plane shared over four square metres.
   */
  {
    const top = CS_TOP + 1;
    const plasterTop = 1.55 + (CS_TOP - 1.3);
    /*
     * Each course butts its own neighbour rather than overlapping it.
     *
     * The head is the same three layers at the same depths as the wall either
     * side, so the only thing keeping it out of their planes is where it stops:
     * the brick ends exactly where their brick begins and the plaster exactly
     * where their plaster does. Meeting end to end is two opposite faces, which
     * is a joint; overlapping by a centimetre is two faces the same way round,
     * which is a flicker.
     */
    const put = (len: number, h: number, thick: number, y: number, c: number, m: THREE.Material) =>
      root.add(box(own, thick, h, len, m, -W + c, y, 0));
    put(5.8, top - 5.15, 0.3, (top + 5.15) / 2, 0.15, brickwork());
    put(5.9, plasterTop - 5.21, 0.16, (plasterTop + 5.21) / 2, 0.32, walls());
    /* And the picture rails carry across it, at the height the walls put them,
       so the room reads as one wall with a hole in it and not as a patch. */
    for (const y of [CS_G1 + 2.6, CS_G2 + 2.6]) put(6.1, 0.12, 0.26, y - 0.13, 0.36, dark);
  }
  /*
   * The doors, seen from the inside.
   *
   * There are doors on this shopfront from the street — timber, leaded, brass
   * handles — and from in here there was a dark rectangle with a light behind
   * it. A doorway you can see out of is not the same as a door, and a shop with
   * no door on the inside of its own entrance reads as a hole in the wall. The
   * leaves stand in the opening; the trigger that takes you out is a metre and
   * a half inside them, so nobody ever walks into one.
   */
  for (const s of [-1, 1] as const) {
    const z = s * 1.48;
    /*
     * Everything on the *room* side of the leaf.
     *
     * Written the way the outside face is written — glass and bars set back
     * behind the timber — and from in here that is the back of a plank: two
     * black rectangles where the doors should be. You are standing on the other
     * side of these ones, so the glass, the bars and the handle all come
     * forward of the leaf rather than behind it.
     */
    /* Two point nine wide each, so the pair fills the opening from jamb to
       jamb. At two point four there was half a metre of daylight down each side
       of them, which is what you see from inside looking out. */
    root.add(box(own, 0.14, 4.5, 2.9, timber, -W - 0.25, 2.25, z));
    root.add(box(own, 0.08, 3.4, 2.2, glow(own, '#8c6c3c'), -W - 0.15, 2.3, z));
    /* Glazing bars, so they are doors and not two lit panels. */
    for (let g = 0; g < 3; g++) {
      root.add(box(own, 0.1, 0.1, 2.24, matt(own, '#2a2320'), -W - 0.10, 1.0 + g * 1.3, z));
    }
    /* Two centimetres in front of the horizontals it crosses, or the two of
       them share both faces at every intersection. */
    root.add(box(own, 0.1, 3.44, 0.1, matt(own, '#2a2320'), -W - 0.08, 2.3, z));
    root.add(box(own, 0.16, 0.6, 0.09, brass, -W - 0.02, 1.9, s * 0.16));
  }
  slab(3.0, 9.0, -W - 1.4, 0.01, 0, surfaceOf(own, () => paving({ dirt: 0.3 }), 1, 2, anisotropy));
  /*
   * What is on the other side: a closed box, not a panel.
   *
   * A flat backdrop behind a doorway only works for somebody standing square in
   * front of it. Every other sight line leaves the opening at an angle and
   * misses the panel's edge — from ten metres inside the shop, a ray through the
   * edge of the door is two thirds of a metre wide of the backdrop by the time
   * it gets there, and what it finds instead is the sky. That was still a strip
   * of daylight down both sides of the door after the panel had been widened
   * once, and it would have been after widening it again.
   *
   * So it is a back, two returns and a lid: whatever angle you look out at, you
   * are looking at the inside of a box with a warm light in it, which is what
   * "the street is out there" looks like from in here.
   */
  {
    /* No two of the four in a plane: they are four faces of one box, so written
       to the same numbers they would share a corner edge apiece. */
    const dark3 = matt(own, '#3a3029');
    root.add(box(own, 0.4, 7.0, 9.6, dark3, -19.2, 3.5, 0));
    for (const s of [-1, 1] as const) {
      root.add(box(own, 2.15, 7.0, 0.4, dark3, -17.875, 3.6, s * 4.5));
    }
    root.add(box(own, 2.65, 0.4, 9.8, dark3, -18.175, 7.35, 0));
  }
  const outside = new THREE.PointLight('#ffd2a0', 22, 12, 2);
  outside.position.set(-W - 1.4, 3, 0);
  root.add(outside);

  /* The lantern: a coffered roof over the atrium with glass in it, which is
     where the room's daylight comes from and why the atrium exists. */
  /* Inside the walls rather than flush with them — the two of them meeting
     exactly at z ±13 is thirty-three square metres at one depth. */
  root.add(box(own, W * 2 - 0.7, 0.5, D * 2 - 0.7, timber, 0, CS_TOP + 0.25, 0));
  root.add(box(own, 20, 0.6, 14, timber, 0, CS_TOP + 0.6, 0));
  const lantern = glow(own, '#8e7c58');
  root.add(box(own, 18.4, 0.12, 12.4, lantern, 0, CS_TOP + 0.34, 0));
  for (let i = 0; i < 5; i++) {
    root.add(box(own, 0.3, 0.34, 12.8, timber, -8 + i * 4, CS_TOP + 0.42, 0));
  }
  const sun = new THREE.PointLight('#ffe6bd', 90, 26, 2);
  sun.position.set(0, CS_TOP - 1.4, 0);
  root.add(sun);

  /* ---- what is in it ---- */

  /** A run of shelving: uprights, shelves, and boxes left on them. */
  const shelving = (
    along: 'x' | 'z', from: number, to: number, face: number, outward: 1 | -1,
    y: number, h: number
  ) => {
    const run = Math.abs(to - from);
    const mid = (from + to) / 2;
    const put = (len: number, hh: number, thick: number, a: number, yy: number, c: number, m: THREE.Material) => {
      const cross = face + outward * c;
      return along === 'x'
        ? box(own, len, hh, thick, m, a, yy, cross)
        : box(own, thick, hh, len, m, cross, yy, a);
    };
    root.add(put(run, h, 0.62, mid, y + h / 2, 0.31, timber));
    const bays = Math.max(2, Math.round(run / 1.6));
    const posts: number[] = [];
    for (let i = 0; i <= bays; i++) {
      const a = from + (to > from ? 1 : -1) * (run / bays) * i;
      posts.push(a);
      /* The uprights and the shelves both stand clear of the carcass's own
         back rather than flush with it — flush is three boxes in one plane down
         twenty-five metres of shelving, times three floors. */
      root.add(put(0.1, h - 0.1, 0.66, a, y + h / 2, 0.37, dark));
    }
    const shelves = Math.max(3, Math.floor(h / 0.62));
    for (let k = 1; k < shelves; k++) {
      root.add(put(run - 0.06, 0.06, 0.62, mid, y + k * (h / shelves), 0.35, dark));
      /* Stock. Nothing you can buy — see the note at the top of this file. */
      const boxes = Math.round(run / 0.55);
      for (let b = 0; b < boxes; b++) {
        const t = rnd();
        if (t < 0.18) continue;
        /* Nudged off the bay grid. The uprights sit on an even division of the
           run and the stock on another, so every so often a box lands with one
           face exactly on an upright's — which is two boxes at one depth, and
           there are hundreds of them. */
        const a = from + (to > from ? 1 : -1) * ((b + 0.5) * (run / boxes))
                + (rnd() - 0.5) * 0.14;
        /*
         * Nothing goes right up against an upright.
         *
         * The uprights sit on an even division of the run and the stock on
         * another, so every so often a box lands with one face exactly on a
         * post's — two boxes at one depth, and there are several hundred of
         * them across three floors. Jittering only moves which ones; leaving a
         * hand's width clear of every post removes the case, and is what a
         * shelf actually looks like anyway.
         */
        if (posts.some((q) => Math.abs(q - a) < 0.3)) continue;
        const bw = 0.26 + rnd() * 0.16;
        const bh = 0.2 + rnd() * 0.16;
        const m = matt(own, ['#7d5f3c', '#5f6b4a', '#6d4a44', '#4a5566', '#7a6a4a'][b % 5]);
        root.add(put(bw, bh, 0.34 + rnd() * 0.1, a, y + k * (h / shelves) + 0.03 + bh / 2, 0.3, m));
      }
    }
  };

  /* Ground floor: the walls are shelved to head height all the way round. */
  shelving('x', -12.4, 12.4, -D + 0.6, 1, 0, 2.4);
  shelving('x', -12.4, 12.4, D - 0.6, -1, 0, 2.4);
  shelving('z', -9.4, 9.4, W - 0.6, -1, 0, 2.4);
  shelving('z', -9.4, -3.6, -W + 0.6, 1, 0, 2.4);
  shelving('z', 3.6, 9.4, -W + 0.6, 1, 0, 2.4);

  /* The galleries are shelved on their outer walls too, which is what makes
     three floors read as one shop rather than three rooms. */
  for (const y of [CS_G1, CS_G2]) {
    shelving('x', -12.4, 12.4, -D + 0.6, 1, y, 2.2);
    shelving('x', -12.4, 12.4, D - 0.6, -1, y, 2.2);
    shelving('z', -9.4, 9.4, W - 0.6, -1, y, 2.2);
    shelving('z', -9.4, -3.6, -W + 0.6, 1, y, 2.2);
    shelving('z', 3.6, 9.4, -W + 0.6, 1, y, 2.2);
  }

  /*
   * The balustrades: the same rectangles the collision uses, built as a rail on
   * turned balusters so the atrium has an edge you can see as well as one you
   * cannot cross.
   */
  const rail = (along: 'x' | 'z', from: number, to: number, cross: number, y: number) => {
    const run = Math.abs(to - from);
    const mid = (from + to) / 2;
    const put = (len: number, h: number, thick: number, a: number, yy: number, m: THREE.Material) =>
      along === 'x'
        ? box(own, len, h, thick, m, a, yy, cross)
        : box(own, thick, h, len, m, cross, yy, a);
    root.add(put(run, 0.42, 0.4, mid, y + 0.21, timber));
    root.add(put(run, 0.14, 0.52, mid, y + 1.06, timber));
    root.add(put(run + 0.06, 0.1, 0.6, mid, y + 1.18, dark));
    const n = Math.max(3, Math.round(run / 0.62));
    for (let i = 0; i <= n; i++) {
      const a = from + (to > from ? 1 : -1) * (run / n) * i;
      root.add(put(0.09, 0.52, 0.09, a, y + 0.72, iron));
    }
  };

  /*
   * A balustrade that climbs with the flight it guards.
   *
   * Written because there was not one: the sides of both staircases were
   * `solid` and nothing else, so what stopped a duelist walking off a flight
   * four metres up was a wall nobody could see. Either you fall or there is
   * something there.
   *
   * The panel is drawn tread by tread — one short box per step, each at the
   * height of the step it stands on — which is what a stair balustrade is, and
   * is the only way to follow a slope with axis-aligned boxes.
   */
  const stairRail = (
    fromZ: number, toZ: number, cross: number, y0: number, y1: number
  ) => {
    /* Twenty-five of the twenty-six, so the last one does not push its cap
       into the underside of the floor the flight arrives at. */
    const steps = 25;
    const dz = (toZ - fromZ) / steps;
    for (let i = 0; i < steps; i++) {
      const z = fromZ + dz * (i + 0.5);
      const y = y0 + ((y1 - y0) / steps) * (i + 1);
      root.add(box(own, 0.24, 0.44, Math.abs(dz) + 0.01, timber, cross, y + 0.22, z));
      /* Twenty-eight centimetres and not thirty: at thirty the cap's outer
         face lands on the edge of the gallery slab the flight runs past. */
      root.add(box(own, 0.28, 0.12, Math.abs(dz) + 0.01, dark, cross, y + 1.02, z));
      root.add(box(own, 0.09, 0.54, 0.09, iron, cross, y + 0.71, z));
    }
  };

  /*
   * The atrium's rails, on the edge of the floor rather than half a metre in.
   *
   * The long runs go through and the short ones stop against them: two rails
   * meeting at a right angle and overlapping share their top and their
   * underside over the square where they cross, and there are sixteen corners.
   */
  rail('x', -9, 9, -6.5, CS_G1);
  rail('x', -9, 9, 6.5, CS_G1);
  /* Far enough short that the *caps* clear too — they oversail the rails they
     sit on, so stopping the rail at the corner still crosses at the cap. */
  rail('z', -5.8, 5.8, -9, CS_G1);
  rail('z', -5.8, 5.8, 9, CS_G1);
  rail('x', -9, 9, -6.5, CS_G2);
  rail('x', -9, 9, 6.5, CS_G2);
  rail('z', -5.8, 5.8, -9, CS_G2);
  rail('z', -5.8, 5.8, 9, CS_G2);

  /* And round each well: the two long sides and the far end, never the end the
     flight arrives at. */
  rail('z', 0.75, 10.15, 12.25, CS_G1);
  rail('x', 12.6, 15.75, 0.05, CS_G1);
  rail('z', -0.75, -10.15, -12.25, CS_G2);
  rail('x', -12.6, -15.75, -0.05, CS_G2);

  /* The flights' own sides — the open one only. The other is the east wall. */
  stairRail(0.4, 10.5, 12.45, 0, CS_G1);
  stairRail(-0.4, -10.5, -12.45, CS_G1, CS_G2);

  /* The counter, which is where the shop would be if there were one. */
  {
    /*
     * At the west end of the south wall, not the east.
     *
     * The flight up to the galleries stands in the south-east corner, and a
     * counter anywhere near it means the way upstairs is *behind the till* —
     * which is not where a staircase goes in a shop and is not somewhere a
     * customer should have to walk. Shortening it was not enough; it had to
     * move. It is by the door now, which is where a counter belongs anyway, and
     * the whole south-east corner is clear from the middle of the room.
     */
    const cx = -6;
    const cz = 9.4;
    root.add(box(own, 6.8, 1.05, 2.2, timber, cx, 0.525, cz));
    root.add(box(own, 7.1, 0.12, 2.5, dark, cx, 1.11, cz));
    root.add(box(own, 6.4, 0.7, 0.14, felt, cx, 0.6, cz - 1.05));
    /* A glass case let into it, with dice in it and no price on anything. */
    root.add(box(own, 3.6, 0.5, 1.4, matt(own, '#241d18'), cx - 1.8, 1.42, cz));
    root.add(box(own, 3.3, 0.42, 1.2, glow(own, '#8d7448'), cx - 1.8, 1.42, cz));
    /* Turned about the upright only, and standing on the case's lid rather than
       a centimetre over it — a cube tilted on three axes rests on a corner, and
       these were hanging in the air for the same reason the window's were. */
    for (let i = 0; i < 6; i++) {
      /* Over the case, all six of them, and standing on its lid. The sixth
         used to sit past the case's edge with nothing under it but the counter
         forty-five centimetres below — one white cube hanging in the air. */
      const d = box(own, 0.2, 0.2, 0.2, matt(own, '#ded3ba'),
                    cx - 3.1 + i * 0.5, 1.67 + 0.1 - 0.005, cz - 0.3 + (i % 2) * 0.5);
      d.rotation.y = 0.4 + i * 0.7;
      root.add(d);
    }
    /* And the board over it, which is the only place the name is written
       inside its own shop. */
    const board = new THREE.Mesh(
      own.keep(new THREE.PlaneGeometry(6.4, 1.1)),
      own.keep(new THREE.MeshBasicMaterial({
        map: surfaceOf(own, () => signBoard('BLACK CROWN', '#e2c583', '#1a1714', undefined, 6.4 / 1.1),
                       1, 1, anisotropy),
        color: '#b6a488',
      }))
    );
    board.position.set(cx, 3.1, cz + 1.18);
    board.rotation.y = Math.PI;
    root.add(board);
    root.add(box(own, 6.8, 1.4, 0.2, dark, cx, 3.1, cz + 1.3));
    for (const s of [-1, 1] as const) {
      root.add(box(own, 0.34, 0.4, 0.34, brass, cx + s * 3.6, 3.95, cz + 1.2));
    }
  }

  /* Tables out on the floor, with games left half-played on them. */
  const table = (x: number, z: number, w: number, d: number, i: number) => {
    const y = at(x, z);
    root.add(box(own, w, 0.1, d, timber, x, y + 0.78, z));
    root.add(box(own, w - 0.3, 0.06, d - 0.3, felt, x, y + 0.85, z));
    for (const sx of [-1, 1] as const) {
      for (const sz of [-1, 1] as const) {
        root.add(box(own, 0.11, 0.78, 0.11, dark,
                     x + sx * (w / 2 - 0.16), y + 0.39, z + sz * (d / 2 - 0.16)));
      }
    }
    for (let k = 0; k < 5; k++) {
      const p = box(own, 0.16, 0.16, 0.16, matt(own, ['#d8cdb4', '#8d4b44', '#3f5a6b'][k % 3]),
                    x - w / 4 + (k % 3) * (w / 4), y + 0.96, z - d / 5 + Math.floor(k / 3) * (d / 3));
      p.rotation.y = 0.3 * k + i;
      root.add(p);
    }
  };
  table(-4.5, -2, 3.2, 2.0, 0);
  table(4.5, -2, 3.2, 2.0, 1);
  table(0, 3.5, 4.4, 2.4, 2);

  /* ---- light ---- */

  /*
   * Pendants over the floor and a lamp on each gallery. These do not go out:
   * `Sky` is given `indoor`, and a shop with its lights off at noon is a shut
   * shop.
   */
  const pendant = (x: number, z: number, y: number, watts: number) => {
    root.add(box(own, 0.06, 0.9, 0.06, iron, x, y + 0.45, z));
    root.add(box(own, 0.62, 0.3, 0.62, oxblood, x, y - 0.05, z));
    root.add(box(own, 0.46, 0.1, 0.46, glow(own, '#c9954e'), x, y - 0.22, z));
    const l = new THREE.PointLight('#ffbe78', watts, 16, 2);
    l.position.set(x, y - 0.4, z);
    root.add(l);
  };
  pendant(-6, -4, 6.2, 30);
  pendant(6, -4, 6.2, 30);
  pendant(-6, 4, 6.2, 30);
  pendant(6, 4, 6.2, 30);
  pendant(0, 0, 8.6, 34);
  /*
   * The galleries' lamps, on the wall behind them.
   *
   * These were a glowing box hanging in mid-air over each gallery with a light
   * inside it: nothing held them up, and on the second floor you walk straight
   * past one floating at head height. A lamp is fixed to something. These are
   * brackets on the outer wall, the same as the ones under the first gallery.
   */
  for (const [gx, gz, gy] of [
    [-16.4, -8, CS_G1], [-16.4, 8, CS_G1], [16.4, -8, CS_G1], [16.4, 8, CS_G1],
    [-8, -12.4, CS_G1], [8, -12.4, CS_G1], [-8, 12.4, CS_G1], [8, 12.4, CS_G1],
    [-16.4, -4, CS_G2], [-16.4, 4, CS_G2], [16.4, -4, CS_G2], [16.4, 4, CS_G2],
    [-8, -12.4, CS_G2], [8, -12.4, CS_G2], [-8, 12.4, CS_G2], [8, 12.4, CS_G2],
  ] as const) {
    const out = Math.abs(gx) > Math.abs(gz) ? [-Math.sign(gx), 0] : [0, -Math.sign(gz)];
    root.add(box(own, 0.3, 0.16, 0.3, iron, gx + out[0] * 0.12, gy + 2.72, gz + out[1] * 0.12));
    root.add(box(own, 0.34, 0.44, 0.34, glow(own, '#c9954e'),
                 gx + out[0] * 0.3, gy + 2.4, gz + out[1] * 0.3));
    const l = new THREE.PointLight('#ffb469', 15, 9, 2);
    l.position.set(gx + out[0] * 0.5, gy + 2.3, gz + out[1] * 0.5);
    root.add(l);
  }
  /*
   * And a bracket on the wall under each gallery.
   *
   * Every light in here hung at six metres or higher — the pendants over the
   * atrium, the lamps on the galleries — and the first gallery is at four and a
   * half. So the four-metre-deep ring of room *underneath* it, which is where
   * all the shelving is and where you walk in, had nothing but ambient: black
   * shelves, and a hard black stripe of soffit right round the room.
   */
  for (const [bx, bz] of [
    [-11, -12.4], [-4, -12.4], [4, -12.4], [11, -12.4],
    [-11, 12.4], [-4, 12.4], [4, 12.4], [11, 12.4],
    [16.4, -7], [16.4, 0], [16.4, 7],
    [-16.4, -8], [-16.4, 8],
  ] as const) {
    /* Turned to face into the room, which is what puts the bracket against the
       wall rather than the shade. */
    const out = Math.abs(bx) > Math.abs(bz) ? [-Math.sign(bx), 0] : [0, -Math.sign(bz)];
    root.add(box(own, 0.3, 0.16, 0.3, iron, bx + out[0] * 0.12, 3.72, bz + out[1] * 0.12));
    root.add(box(own, 0.34, 0.44, 0.34, glow(own, '#c9954e'), bx + out[0] * 0.3, 3.4, bz + out[1] * 0.3));
    const l = new THREE.PointLight('#ffb469', 13, 9, 2);
    l.position.set(bx + out[0] * 0.5, 3.3, bz + out[1] * 0.5);
    root.add(l);
  }

  /* One over the counter, because that is where you would be looking. */
  const till = new THREE.PointLight('#ffcf96', 26, 10, 2);
  till.position.set(-5, 3.4, 8.4);
  root.add(till);

  /*
   * The sky, through the front glass and the lantern.
   *
   * Fixed rather than swinging: indoors the light comes from where the windows
   * are, not from where the sun is, so only its colour and its level follow the
   * hour. That is what makes the same room blue at dawn, warm at four and lit
   * by nothing but its own lamps after dark.
   *
   * See `market.ts` on `normalBias`: 34 m across 2048 is 1.7 cm.
   */
  const sky = ownSky(own, new Sky(own, root, {
    reach: 24,
    half: 18,
    deep: 15,
    target: [0, 1.2, 0],
    fixedKey: [-14, 16, -6],
    normalBias: 0.017,
    gain: 1.0,
    fill: 1.0,
    indoor: true,
    hemi: { sky: '#e8dcc0', ground: '#5a4736' },
  }));

  return {
    root,
    setTime: (hour) => { sky.apply(hour); },
    dispose() {
      for (const item of own.items) item.dispose();
    },
  };
}
