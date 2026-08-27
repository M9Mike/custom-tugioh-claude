/**
 * The Starting Area — the street outside the Kame Game Shop.
 *
 * Four times the floor of the shop and the first place with any distance in it,
 * so it carries a different job: the shop has to hold up close, and this has to
 * hold up *far*. What you see from the far end of it is a row of buildings, and
 * a row of buildings is only convincing if no two of them are the same.
 *
 * ## Dusk, and why the sky is black
 *
 * There is nothing beyond this street — the world ends where the geometry does,
 * and past that is void. A blue daytime sky would make that void look like a
 * missing skybox. At dusk it looks like the sky. So the street is lit at the end
 * of the day: warm lamps down both pavements, light spilling out of the shop
 * windows, and a fog that goes to black exactly where the buildings stop.
 *
 * It also does the one thing this area most needs done, which is to make the
 * shop the brightest thing in view. A new player walks out of a lit doorway into
 * a dim street; when they want to go back, they can see where back is.
 *
 * ## Enclosure
 *
 * Every edge is a building, a hoarding or a railing, and all of it is *taller
 * than the camera*. That is the real requirement — a two-metre wall is no use
 * when the camera sits at 1.55 m and pitches up. Nothing here is under three
 * metres, and the terraces run to nine, so from anywhere on the street the
 * horizon is roofline rather than void.
 */

import * as THREE from 'three';
import { asphalt, paving, brick, render, darkWood, plaster, signBoard, arcadeFloor, concrete } from './surfaces';
import { Owned, box, matt, tiled, decal, glow, surfaceOf, seeded, type BuiltArea } from './kit';
import { AREAS, SHOP_STEP, STREET_FACES } from '@/story/areas';

/**
 * The pavements, taken from the area rather than restated here.
 *
 * They used to be two spans written in this file and, separately, nothing at all
 * in `areas.ts` — which is why walking onto one buried the duelist's feet: the
 * paving was drawn at 14 cm and the game had no idea it was there. Adding the
 * heights to the area made two copies of the same rectangles, and two copies
 * drift.
 *
 * So the area owns them and this draws what it is told. `areas.ts` stays free of
 * three.js, which is the rule that made it the right place to put them.
 */
const PLATFORMS = AREAS['starting-area'].platforms ?? [];
/* The doorstep is a platform too, but it is not a pavement — it gets a kerb and
   a paving plane below if it goes through that loop. Told apart by identity
   rather than by size, so neither can be renamed into the other. */
const PAVEMENTS = PLATFORMS.filter((p) => p !== SHOP_STEP);

const ST_W = 22;

/**
 * The two edges of the archway into Market Row.
 *
 * The same 4.4 m gap `areas.ts` leaves in the east wall, on the same centre —
 * the road's, not the street's. Everything that closes this end is measured
 * between these and the terrace faces, so no piece of it can run on past the
 * building it is supposed to stop at.
 */
const ARCH_N = -1.7;

/**
 * The two edges of the alley into Step Lane, at the west end.
 *
 * The same 3.4 m gap `areas.ts` leaves in the west wall, on the same centre.
 * Everything that closes this end is measured between these and the terrace
 * faces, so no part of it can be missing and no part can overlap.
 */
const ALLEY_N = 2.3;
const ALLEY_S = 5.7;

/** How far the area runs north and south. `areas.ts` owns it; this reads it. */
const ST_END = AREAS['starting-area'].bounds.hd + 1;
const ARCH_S = 2.7;

/* Where the buildings' front faces are — from `areas.ts`, which needs them
   too so a door's threshold can say which wall it is in. */
const { north: NORTH_FACE, south: SOUTH_FACE, west: WEST_FACE, east: EAST_FACE } = STREET_FACES;

/** Pavement runs from each building face to these. */
const NORTH_KERB = -6.5;
const SOUTH_KERB = 7.5;



export function buildStreet(anisotropy: number): BuiltArea {
  const own = new Owned();
  const root = new THREE.Group();
  root.name = 'starting-area';
  const rnd = seeded(0x51ee7);
  /* Every point light the street owns, so their shadow maps go with it. */
  const lamps: THREE.PointLight[] = [];

  /* ---- ground ---- */

  const roadMat = matt(own, '#ffffff', surfaceOf(own, asphalt, 6, 4, anisotropy));
  const road = new THREE.Mesh(own.keep(new THREE.PlaneGeometry(ST_W * 2, SOUTH_KERB - NORTH_KERB)), roadMat);
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0, (NORTH_KERB + SOUTH_KERB) / 2);
  road.receiveShadow = true;
  root.add(road);

  const paveMat = matt(own, '#ffffff', surfaceOf(own, paving, 10, 1.6, anisotropy));
  for (const slab of PAVEMENTS) {
    const pave = new THREE.Mesh(
      own.keep(new THREE.PlaneGeometry(slab.hw * 2, slab.hd * 2)),
      paveMat
    );
    pave.rotation.x = -Math.PI / 2;
    pave.position.set(slab.x, slab.y, slab.z);
    pave.receiveShadow = true;
    root.add(pave);
    /* The kerb itself — a lip, not a painted line. It faces the road, which is
       whichever of the slab's two long edges is nearer the middle of the street. */
    const roadside = slab.z < 0 ? slab.z + slab.hd : slab.z - slab.hd;
    /*
     * Buried 20 cm, so its underside is not on the plane every building in the
     * street stands on.
     *
     * The kerbs run the full 44 m and both ends drive into a building — the
     * hoarding at the west, the arch at the east — and a kerb whose base is at
     * exactly y 0 shares that face with every one of them. Four pairs, 1.2 m²
     * each, all of it under the pavement where nobody would ever have looked.
     * Nothing below y 0 is ever seen, so the fix costs a number.
     */
    const kerbTop = slab.y + 0.02;
    /* Stopping at the buildings rather than running under them: at the full
       width its ends were 16 cm inside the blocks at either end of the street. */
    const kerb = box(own, Math.min(slab.hw, 17.9) * 2, kerbTop + 0.2, 0.3, matt(own, '#8b8d90'),
                     slab.x, kerbTop - (kerbTop + 0.2) / 2,
                     roadside + (slab.z < 0 ? -0.15 : 0.15));
    root.add(kerb);
  }

  /* Centre line, dashed and worn. */
  for (let x = -ST_W + 1; x < ST_W; x += 3.2) {
    const dash = new THREE.Mesh(own.keep(new THREE.PlaneGeometry(1.7, 0.16)),
                                decal(own, rnd() > 0.25 ? '#c9c3ac' : '#9c9789'));
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(x, 0.012, (NORTH_KERB + SOUTH_KERB) / 2);
    root.add(dash);
  }
  /* A couple of drain covers where the kerb meets the road. */
  /* Drain covers, sitting a centimetre proud so their underside is not coplanar
     with the road they are set into. */
  for (const [dx, dz] of [[-6, NORTH_KERB - 0.55], [7.5, SOUTH_KERB + 0.55]]) {
    root.add(box(own, 0.6, 0.04, 0.44, decal(own, '#3f4247'), dx, 0.03, dz));
  }

  /* ---- the terraces ---- */

  /*
   * Repeat 1 : the scale lives in the geometry now.
   *
   * These used to carry 3 x 2.2, which means "three tiles across whatever face
   * you land on" — so brick came out a different size on every differently-sized
   * wall in the street, and a different size on the two faces of the same wall.
   * `tiled` and `scaleBoxUVs` in `kit.ts` replace that with a fixed size in
   * metres, which is what makes the wall either side of the arch match the wall
   * it joins.
   */
  const brickTex = surfaceOf(own, () => brick('#8a5344'), 1, 1, anisotropy);
  const brickAlt = surfaceOf(own, () => brick('#6f6257'), 1, 1, anisotropy);
  const renderTex = surfaceOf(own, () => render('#b9ae97'), 1, 1, anisotropy);
  const brickWall = () => tiled(matt(own, '#ffffff', brickAlt));
  const litWindow = glow(own, '#c2954f');
  const darkWindow = own.keep(new THREE.MeshStandardMaterial({
    color: '#1b2028', roughness: 0.25, metalness: 0,
  }));

  /**
   * One building: a slab, a ground-floor front, rows of windows, and a cornice.
   *
   * The variation is the point. Height, width, facing material, how many floors,
   * which windows are lit and whether it has an awning are all drawn from the
   * seed, so a terrace of eight is eight different buildings rather than one
   * building repeated eight times — which is what a repeated facade always
   * looks like, however good the texture on it is.
   */
  const building = (
    cx: number, w: number, faceZ: number, facing: 1 | -1, height: number,
    opts: { shopfront?: boolean; awning?: string } = {}
  ) => {
    /* Each building its own depth. At a flat 8 every neighbour's cornice and
       parapet met its own back to back at exactly z −17, and an overhang wide
       enough to overlap the building next door made that a shared face. Varying
       it is also simply what a terrace looks like from above. */
    const depth = 7.7 + rnd() * 0.6;
    /*
     * `facing` points from the front face *into* the building — that is what
     * places the slab. Everything on the front therefore hangs off `out`, the
     * other way.
     *
     * This was the single worst bug in the street. Windows, doors, sills, signs
     * and awnings were all placed along `facing`, which buried every one of them
     * six centimetres inside the brickwork. The terraces rendered as blank
     * slabs, and because a blank slab is exactly what an unfinished building
     * looks like, it read as "the facades have not been built yet" rather than
     * as a sign error.
     */
    const zc = faceZ + facing * depth / 2;
    const out = -facing;
    const skin = rnd() > 0.62 ? renderTex : (rnd() > 0.5 ? brickTex : brickAlt);
    const body = tiled(matt(own, '#ffffff', skin));
    root.add(box(own, w, height, depth, body, cx, height / 2, zc));

    /* Cornice and parapet, which is what stops a building looking like a box. */
    /* The overhang is its own on each building. A terrace wants a continuous
       cornice line and a continuous cornice line is a shared face: neighbours
       overlap sideways by the overhang, so their fronts landed on one plane. A
       couple of centimetres of variation breaks that and reads as a terrace
       built at different times, which is what a terrace is. */
    const eave = 0.28 + rnd() * 0.14;
    root.add(box(own, w + eave, 0.32, depth + eave, matt(own, '#4e4a43'),
                 cx, height + 0.16, zc + out * (eave - 0.34) / 2));
    root.add(box(own, w + eave * 0.3, 0.7, depth + eave * 0.3, matt(own, '#5a544c'),
                 cx, height + 0.5, zc + out * (eave * 0.3 - 0.1) / 2));

    const zf = faceZ + out * 0.06;
    const floors = Math.max(1, Math.floor((height - 3.2) / 2.6));
    const cols = Math.max(1, Math.floor(w / 2.3));
    for (let f = 0; f < floors; f++) {
      const y = 4.3 + f * 2.6;
      for (let c = 0; c < cols; c++) {
        const x = cx - w / 2 + (w / cols) * (c + 0.5);
        const lit = rnd() > 0.55;
        /* Reveal, so the glass sits back in the wall rather than on it. */
        root.add(box(own, 1.1, 1.5, 0.12, matt(own, '#3c3630'), x, y, zf + out * 0.02));
        const pane = box(own, 0.94, 1.32, 0.05, lit ? litWindow : darkWindow, x, y, zf + out * 0.1);
        root.add(pane);
        /* Sill and a head, both proud of the face. */
        root.add(box(own, 1.3, 0.1, 0.2, matt(own, '#6f675c'), x, y - 0.8, zf + out * 0.1));
        if (lit && rnd() > 0.5) {
          /* Curtains: a strip of dimmer colour down one side of a lit pane. */
          root.add(box(own, 0.26, 1.32, 0.02, matt(own, '#8a6238'), x - 0.32, y, zf + out * 0.13));
        }
      }
    }

    /* Ground floor: either a shopfront or a plain frontage with a door. */
    if (opts.shopfront) {
      /*
       * Panes in a frame, the same way Market Row's are built.
       *
       * This used to be four surfaces stacked inside seven centimetres of depth:
       * a dark reveal, a lit sheet five millimetres proud of it, mullions three
       * centimetres in front of that, and a transom a centimetre in front of
       * those. Every one of those spacings is smaller than the thing it is
       * spacing, and the largest pair of them shared fourteen square metres.
       *
       * Cutting the glazing into bays removes the whole question. The frame goes
       * *between* the panes rather than on top of them, the uprights stand proud
       * of the rails as joinery does, and nothing overlaps anything.
       */
      const gw = w - 1.0;
      const bays = Math.max(2, Math.round(gw / 1.1));
      const bayW = gw / bays;
      const litPane = glow(own, '#9d6f35');
      const woodwork = matt(own, '#33291f');

      /* The reveal, seen only at the edges of the opening. */
      root.add(box(own, gw + 0.1, 2.24, 0.1, darkWindow, cx, 1.9, zf + out * 0.06));

      for (let m = 0; m < bays; m++) {
        const bx = cx - gw / 2 + bayW * (m + 0.5);
        root.add(box(own, bayW - 0.1, 1.32, 0.05, litPane, bx, 1.72, zf + out * 0.15));
        root.add(box(own, bayW - 0.1, 0.26, 0.05, litPane, bx, 2.62, zf + out * 0.15));
      }
      for (let m = 1; m < bays; m++) {
        root.add(box(own, 0.08, 2.14, 0.10, woodwork, cx - gw / 2 + bayW * m, 1.9, zf + out * 0.18));
      }
      root.add(box(own, 0.1, 2.28, 0.10, woodwork, cx - gw / 2, 1.9, zf + out * 0.18));
      root.add(box(own, 0.1, 2.28, 0.10, woodwork, cx + gw / 2, 1.9, zf + out * 0.18));
      root.add(box(own, gw, 0.09, 0.07, woodwork, cx, 2.43, zf + out * 0.145));

      /* Goods in the window, in front of the glazing rather than buried behind
         an opaque pane with a centimetre poking through. */
      for (let d2 = 0; d2 < Math.max(2, Math.floor(gw / 1.4)); d2++) {
        root.add(box(own, 0.32, 0.3, 0.14,
                     matt(own, ['#7a4638', '#3f566f', '#6b5f3c', '#47654f'][d2 % 4]),
                     cx - gw / 2 + 0.6 + d2 * 1.4, 1.32, zf + out * 0.28));
      }
      /* The bands over and under the window stand clear of the reveal behind
         them: at `out * 0.14` their back face was a centimetre off its back
         face, over more than a square metre, on every shopfront in the street. */
      root.add(box(own, gw + 0.3, 0.22, 0.28, matt(own, '#3b332a'), cx, 3.06, zf + out * 0.20));
      root.add(box(own, gw + 0.3, 0.24, 0.28, matt(own, '#3b332a'), cx, 0.82, zf + out * 0.20));
      const spill = new THREE.PointLight('#ffb96a', 45, 12, 2);
      spill.position.set(cx, 2.1, faceZ + out * 1.4);
      root.add(spill);
    } else {
      root.add(box(own, 1.1, 2.3, 0.12, matt(own, '#4a3626'), cx + (rnd() - 0.5) * (w * 0.4), 1.15, zf + out * 0.08));
    }

    if (opts.awning) {
      const aw = w - 1.2;
      const awning = box(own, aw, 0.1, 1.5, matt(own, opts.awning), cx, 3.35, faceZ + out * 0.85);
      awning.rotation.x = out * 0.16;
      root.add(awning);
      /* Scalloped edge, drawn as a row of little tabs. */
      for (let i = 0; i < Math.floor(aw / 0.42); i++) {
        root.add(box(own, 0.34, 0.22, 0.05, matt(own, opts.awning),
                     cx - aw / 2 + 0.21 + i * 0.42, 3.15, faceZ + out * 1.56));
      }
    }

    /* A drainpipe down one edge — three seconds of geometry, and its absence is
       one of those things you feel without being able to name. */
    root.add(box(own, 0.14, height, 0.14, matt(own, '#4c4a45'), cx + w / 2 - 0.2, height / 2, zf + out * 0.12));
  };

  /* North terrace: the shop sits in the middle of it, with neighbours either side. */
  building(-16, 8, NORTH_FACE, -1, 9.5, { shopfront: true, awning: '#7a4a3a' });
  building(-9.2, 5.2, NORTH_FACE, -1, 8.2, { shopfront: true });
  building(-3.65, 5.5, NORTH_FACE, -1, 10.5);
  /* --- the Kame Game Shop itself, at x = 2.6 --- */
  building(9.55, 6.9, NORTH_FACE, -1, 8.8, { shopfront: true, awning: '#3f5f7a' });
  building(15.6, 5.2, NORTH_FACE, -1, 9.8);

  /* South terrace, opposite. Unbroken, and taller, so the street feels held in. */
  building(-17, 9, SOUTH_FACE, 1, 10.5, { shopfront: true, awning: '#4a6a4a' });
  building(-8.5, 8, SOUTH_FACE, 1, 9.2);
  building(0, 8.5, SOUTH_FACE, 1, 11.2, { shopfront: true });
  building(8.5, 8, SOUTH_FACE, 1, 9.6, { awning: '#6a4a6a' });
  building(17, 9, SOUTH_FACE, 1, 10.8, { shopfront: true });

  /* ---- the Kame Game Shop frontage ---- */

  const shopX = 2.6;
  const shopW = 7.0;
  const shopSkin = tiled(matt(own, '#ffffff', surfaceOf(own, () => plaster('#c2b498'), 1, 1, anisotropy)));
  root.add(box(own, shopW, 9.0, 8, shopSkin, shopX, 4.5, NORTH_FACE - 4));
  root.add(box(own, shopW + 0.34, 0.32, 8.34, matt(own, '#4e463d'), shopX, 9.16, NORTH_FACE - 4));
  root.add(box(own, shopW + 0.1, 0.8, 8.1, matt(own, '#5a5048'), shopX, 9.6, NORTH_FACE - 4));

  /* The shop's own front. +Z is out of the building and onto the pavement; the
     whole frontage was previously built at −0.06 and lived inside the wall. */
  const zf = NORTH_FACE + 0.06;
  /* The door, aligned exactly with the interior's so walking through is
     continuous rather than a teleport that happens to look similar. */
  const doorMat = matt(own, '#ffffff', surfaceOf(own, darkWood, 1, 2, anisotropy));
  root.add(box(own, 1.5, 2.35, 0.12, doorMat, shopX, 1.18, zf + 0.02));
  root.add(box(own, 1.0, 0.8, 0.05, glow(own, '#b4823d'), shopX, 1.72, zf + 0.09));
  root.add(box(own, 1.7, 0.12, 0.2, matt(own, '#3a2a1a'), shopX, 2.42, zf + 0.06));

  /* The window beside it, lit from within — the brightest thing on the street. */
  /*
   * The window, and it is on the shop's own frontage now.
   *
   * It used to be centred at x 0.25 with a width of 3, which runs from −1.25 to
   * 1.75 — and the shop was only 5.4 wide, so a third of its display window was
   * mounted on the neighbouring building. Widening the frontage to 7 m and
   * pulling the neighbours back to meet it puts every part of the shop on the
   * shop.
   */
  const winCx = shopX - 2.05;
  root.add(box(own, 2.6, 1.7, 0.12, matt(own, '#3a2a1a'), winCx, 1.95, zf));
  root.add(box(own, 2.36, 1.5, 0.05, glow(own, '#b8894a'), winCx, 1.95, zf + 0.07));
  /* Mullions, so it reads as a shop window and not an illuminated panel. */
  for (const mx of [-0.8, 0, 0.8]) {
    root.add(box(own, 0.07, 1.5, 0.06, matt(own, '#3a2a1a'), winCx + mx, 1.95, zf + 0.1));
  }
  /* Same again on the shop's own window: the crossbar clears its mullions. */
  root.add(box(own, 2.36, 0.06, 0.06, matt(own, '#3a2a1a'), winCx, 1.95, zf + 0.115));
  /* A stepped display of boxes behind the glass. */
  for (let i = 0; i < 5; i++) {
    root.add(box(own, 0.3, 0.26, 0.2, matt(own, ['#8a4a3a', '#3f5f8a', '#7a6a3a', '#4a7a5a', '#6a3f6a'][i]),
                 winCx - 0.9 + i * 0.45, 1.42 + (i % 2) * 0.16, zf + 0.02));
  }
  const shopSpill = new THREE.PointLight('#ffbe78', 70, 14, 2);
  shopSpill.position.set(shopX - 1.4, 2.2, NORTH_FACE + 2.0);
  root.add(shopSpill);

  /* Sign board over the door, and a hanging turtle sign at right angles to it —
     the shop is "the little one with the turtle over the door". */
  root.add(box(own, shopW - 0.5, 1.45, 0.22, matt(own, '#2f4a3a'), shopX, 3.42, zf + 0.08));
  /* The fascia, and it says what the shop is called. */
  /*
   * The board is taller, and the lettering is drawn at the shape it is shown at.
   *
   * The sign was a square 512 canvas stretched across six metres by 0.66 — a 9:1
   * squash — so "KAME GAME SHOP" came out thin and short however large the
   * letters were drawn. Drawing into a canvas of the same proportions as the
   * plane is the whole fix: the type is now the size it looks.
   */
  const fasciaW = shopW - 0.9;
  const fasciaH = 1.15;
  const fascia = own.keep(new THREE.MeshBasicMaterial({
    map: surfaceOf(
      own,
      () => signBoard('KAME', '#f2e3ba', '#24402f', 'GAME SHOP', fasciaW / fasciaH),
      1, 1, anisotropy
    ),
    color: '#cfc4a6',
  }));
  const fasciaMesh = new THREE.Mesh(own.keep(new THREE.PlaneGeometry(fasciaW, fasciaH)), fascia);
  fasciaMesh.position.set(shopX, 3.42, zf + 0.22);
  root.add(fasciaMesh);
  root.add(box(own, 0.1, 0.1, 0.9, matt(own, '#3a3630'), shopX + 2.4, 3.9, NORTH_FACE + 0.5));
  const turtle = box(own, 0.72, 0.62, 0.1, matt(own, '#2f4a3a'), shopX + 2.4, 3.42, NORTH_FACE + 0.9, Math.PI / 2);
  root.add(turtle);
  root.add(box(own, 0.46, 0.3, 0.12, matt(own, '#5f8a5a'), shopX + 2.4, 3.46, NORTH_FACE + 0.9, Math.PI / 2));

  /*
   * The step up to the door, drawn from `SHOP_STEP`.
   *
   * Its height is declared in `areas.ts` and read here, so the game and the
   * picture cannot disagree about how high it is — which they did, twice: once
   * as a flicker when it matched the pavement exactly, and once as a pair of
   * feet 8 cm inside it after the flicker was fixed by raising it alone.
   */
  root.add(box(own, SHOP_STEP.hw * 2, SHOP_STEP.y, SHOP_STEP.hd * 2, matt(own, '#8b8d90'),
               SHOP_STEP.x, SHOP_STEP.y / 2, SHOP_STEP.z));

  /* ---- the ends ---- */

  /* West: a hoarding round a building site, plastered with bills. */
  /*
   * Across the open street only, not the full thirty-four metres.
   *
   * At `ST_D * 2` it ran from one end of the area to the other — straight through
   * both terraces, whose buildings reach back to x −20 and whose awnings and sign
   * bands were therefore standing a foot inside it. Nothing you could name, and
   * everything you could see: interpenetrating solids share a line, and that line
   * crawls as you walk past it.
   *
   * It only ever needed to close the gap between the two terraces, which is what
   * it does now.
   */
  /*
   * The whole west end, in three pieces, and every metre of it drawn.
   *
   * The collision was opened for Step Lane's alley and the *geometry* was not:
   * nothing was ever built for the 3.4 m of opening, and the hoarding was cut
   * back to z 2 with nothing put south of it either. So from the road you looked
   * west at a hole in the world with a green fence beside it — the alley reading
   * as one black nothing and half the end simply absent.
   *
   * Three pieces now, and they meet: the hoarding from the north terrace down to
   * the alley, the alley mouth itself, and the wall the alley is cut through
   * carrying on to the south terrace.
   */
  const hoard = matt(own, '#4a5a52');
  const hoardN = -ST_END;
  const hoardS = ALLEY_N;
  root.add(box(own, 4, 3.6, hoardS - hoardN, hoard,
               WEST_FACE - 2.4, 1.8, (hoardN + hoardS) / 2));
  /* Above it, the site it hides: a blank flank wall so nothing shows past the
     hoarding's own three and a half metres. */
  /* Its own height and its own ends: at a shared 9.5 its roof was one plane with
     the terrace beside it, and at the same z span its ends were one plane with
     the hoarding in front of it. */
  root.add(box(own, 3.8, 9.16, hoardS - hoardN + 0.1, brickWall(),
               WEST_FACE - 2.7, 4.58, (hoardN + hoardS) / 2 - 0.15));
  /*
   * Bills pasted on the hoarding, and they sit *proud* of it.
   *
   * They were centred at `WEST_FACE - 0.03` with a depth of 0.06, which puts
   * their outer face at exactly `WEST_FACE` — the same plane as the hoarding
   * itself. Two surfaces at identical depth is the definition of z-fighting, and
   * this is the one that showed as "rectangles flickering on the left wall".
   * Five centimetres clear, and a decal material on top of that.
   */
  for (let i = 0; i < 9; i++) {
    const z = -8 + i * 1.2;
    /* On the hoarding's own face at −18.4, not at −17.95 where `WEST_FACE` is:
       moving the hoarding back left every bill floating 45 cm off it, which is
       the red rectangle standing in mid-air beside the alley. */
    root.add(box(own, 0.05, 1.1, 0.8, decal(own, ['#8a4a4a', '#4a5a8a', '#8a7a4a', '#5a8a5a'][i % 4]),
                 WEST_FACE - 0.35, 1.5 + (i % 3) * 0.5, z));
  }
  /* Scaffolding poles above it, so something is clearly going on back there. */
  for (let i = 0; i < 6; i++) {
    root.add(box(own, 0.1, 6, 0.1, matt(own, '#7a7266'), WEST_FACE - 1.2, 3 + 3.6 / 2, -8 + i * 2.0));
  }

  /* ---- the alley up to Step Lane ---- */

  /*
   * The wall south of the alley, carrying on to the terrace.
   *
   * Between the alley and the south terrace there was nothing at all — eight
   * metres of end wall that existed in the collision and not in the world.
   */
  root.add(box(own, 3.8, 9.34, ST_END - ALLEY_S, brickWall(),
               WEST_FACE - 2.1, 4.67, (ALLEY_S + ST_END) / 2));

  /*
   * The mouth itself: two jambs, a head over them, and a name on it.
   *
   * Cut through a building rather than left as a gap between two, which is what
   * these alleys are — the wall carries straight over the top and you walk under
   * somebody's first floor to reach the steps.
   */
  const alleyStone = tiled(matt(own, '#ffffff', surfaceOf(own, () => plaster('#9c9081'), 1, 1, anisotropy)));
  const alleyMid = (ALLEY_N + ALLEY_S) / 2;
  for (const az of [ALLEY_N, ALLEY_S]) {
    const inward = az === ALLEY_N ? 1 : -1;
    root.add(box(own, 3.4, 4.6, 0.5, alleyStone, WEST_FACE - 1.7, 2.3, az + inward * 0.25));
  }
  root.add(box(own, 3.4, 1.1, ALLEY_S - ALLEY_N + 1.0, alleyStone, WEST_FACE - 1.7, 5.15, alleyMid));
  /* And the building above it, so the alley reads as cut through rather than as
     a slot with sky in it. */
  /* Set back from the walls either side of it on both faces, not just the one:
     fixing the west face alone left the east face still sharing a plane. */
  root.add(box(own, 3.7, 3.8, ALLEY_S - ALLEY_N + 1.0, brickWall(), WEST_FACE - 2.2, 7.6, alleyMid));

  const alleySignW = 2.0;
  const alleySign = new THREE.Mesh(
    own.keep(new THREE.PlaneGeometry(alleySignW, alleySignW / 5.4)),
    own.keep(new THREE.MeshBasicMaterial({
      map: surfaceOf(own, () => signBoard('STEP LANE', '#e6dcc2', '#2f3a33', undefined, 5.4), 1, 1, anisotropy),
      color: '#cfc4a6',
    }))
  );
  alleySign.rotation.y = -Math.PI / 2;
  alleySign.position.set(WEST_FACE + 0.02, 5.15, alleyMid);
  root.add(alleySign);

  /* A lamp under the head, because an alley you are meant to notice is a lit one. */
  root.add(box(own, 0.28, 0.3, 0.28, matt(own, '#3f4348'), WEST_FACE - 0.7, 4.32, alleyMid));
  const alleyLens = new THREE.Mesh(own.keep(new THREE.PlaneGeometry(0.24, 0.24)), glow(own, '#f0c98a'));
  alleyLens.rotation.x = Math.PI / 2;
  alleyLens.position.set(WEST_FACE - 0.7, 4.11, alleyMid);
  root.add(alleyLens);
  const alleyLight = new THREE.PointLight('#ffcf90', 46, 12, 2);
  alleyLight.position.set(WEST_FACE - 0.4, 3.9, alleyMid);
  root.add(alleyLight);

  /*
   * And what you see through it: the bottom of Step Lane.
   *
   * Not the real area — that is built when you walk in — but enough of it that
   * the opening reads as a way up rather than a hole. Flat ground, walls each
   * side, the first flight starting where it really does, and a wall across the
   * far end so nothing shows past.
   */
  const alleyFloor = new THREE.Mesh(
    own.keep(new THREE.PlaneGeometry(14, ALLEY_S - ALLEY_N)),
    matt(own, '#ffffff', surfaceOf(own, () => concrete('#78766f'), 5, 1.2, anisotropy))
  );
  alleyFloor.rotation.x = -Math.PI / 2;
  /* Beginning where the road's own plane ends at −22, not four metres under it. */
  alleyFloor.position.set(WEST_FACE - 11, 0.006, alleyMid);
  root.add(alleyFloor);
  /* The passage walls, two centimetres inside the opening and stopping short of
     the wall at the far end — a lining that lands on exactly the planes of the
     things it meets is a lining that fights all of them. */
  for (const az of [ALLEY_N - 0.32, ALLEY_S + 0.32] as const) {
    root.add(box(own, 11.2, 7, 0.6, tiled(matt(own, '#ffffff', surfaceOf(own, () => concrete('#6e6c67'), 1, 1, anisotropy))),
                 WEST_FACE - 10, 3.5, az));
  }
  for (let i = 0; i < 7; i++) {
    const y = 0.18 * (i + 1);
    root.add(box(own, 0.5, y, ALLEY_S - ALLEY_N, tiled(matt(own, '#ffffff', surfaceOf(own, () => concrete('#7c7a74'), 1, 1, anisotropy))),
                 WEST_FACE - 8.25 - i * 0.5, y / 2, alleyMid));
  }
  root.add(box(own, 2, 8, ALLEY_S - ALLEY_N + 1.4, tiled(matt(own, '#ffffff', surfaceOf(own, () => concrete('#6e6c67'), 1, 1, anisotropy))),
               WEST_FACE - 15, 4, alleyMid));

  /*
   * East: the arch into Market Row.
   *
   * It was a railed-off alley mouth — somewhere to look down and never enter,
   * which is what an area needs at its edge right up until there is something on
   * the other side. There is now, so the railing is gone and the wall has a way
   * through it: two building slabs with 4.4 m between them, a gate over the top,
   * and the arcade visible in the gap.
   *
   * The gap is on the road rather than the pavement, which is where a covered
   * shopping street always meets the traffic — the carriageway ends, bollards
   * stop the cars, and people carry on.
   */
  /* Same again at this end: these used to run the full depth and swallow the
     backs of both terraces. They close the street between them and stop. */
  root.add(box(own, 4, 9.5, ARCH_N - NORTH_FACE, brickWall(),
               EAST_FACE + 2, 4.75, (NORTH_FACE + ARCH_N) / 2));
  root.add(box(own, 4, 9.5, SOUTH_FACE - ARCH_S, brickWall(),
               EAST_FACE + 2, 4.75, (ARCH_S + SOUTH_FACE) / 2));
  /*
   * And the wall *above* the opening, which is the whole difference between an
   * archway and a hole.
   *
   * The two slabs above stop either side of the 4.4 m gap, so without this the
   * building has a 4.4 m slot running from head height to the roofline with the
   * void behind it — which is precisely what the first pass rendered, and it read
   * as a black rectangle hanging over the arch. A gate through a building has
   * building over it.
   */
  root.add(box(own, 4, 3.1, 4.4, brickWall(), EAST_FACE + 2, 7.95, 0.5));

  /*
   * The archway is lined, and the lining is plain.
   *
   * Its side walls are the two blocks either side, and from the street you look
   * straight down the four metres between them — so those faces are seen almost
   * exactly edge-on. That is the one angle anisotropic filtering cannot rescue: a
   * grazing surface needs far more than the sixteen samples the hardware will
   * give, so which part of the brick pattern wins changes with any movement at
   * all. `npm run shimmer` had the arch at 0.75% of the frame flipping on a
   * millimetre of camera, and these two walls were nearly all of it.
   *
   * Lining them with flat render fixes it completely, because there is no pattern
   * left to be unstable — and it is what an archway looks like anyway. Nobody
   * leaves bare brick inside an opening they have gone to the trouble of putting
   * a stone surround on.
   */
  const revealMat = matt(own, '#8e8271');
  root.add(box(own, 4.02, 6.4, 0.06, revealMat, EAST_FACE + 2, 3.2, -1.66));
  root.add(box(own, 4.02, 6.4, 0.06, revealMat, EAST_FACE + 2, 3.2, 2.66));
  /* And the soffit over them, so the tunnel has a ceiling rather than the
     underside of the spandrel. */
  root.add(box(own, 4.02, 0.06, 4.32, matt(own, '#7c7161'), EAST_FACE + 2, 6.37, 0.5));

  /* The gate: two piers, a header, and the name across it. */
  const gateStone = tiled(matt(own, '#ffffff', surfaceOf(own, () => plaster('#9c9081'), 1, 1, anisotropy)));
  for (const pz of [-2.25, 3.25]) {
    root.add(box(own, 1.5, 5.6, 1.1, gateStone, EAST_FACE, 2.8, pz + Math.sign(pz - 0.5) * 0.04));
    root.add(box(own, 1.7, 0.24, 1.3, matt(own, '#5f574c'), EAST_FACE, 5.72, pz));
  }
  /* Set into the pier caps rather than resting on them — see the same gate in
     `market.ts` for why two faces at one depth is the bug and not the fix. */
  /* Its top at 6.5 was exactly the underside of the canopy over the arcade
     beyond — five square metres of two surfaces on one plane, seen straight down
     the archway. The header is a little shallower than the opening it crowns. */
  /* Narrower and shallower than the piers it lands on, so a header and the
     pier under it never present the same face on the same plane. */
  root.add(box(own, 1.42, 0.86, 6.52, gateStone, EAST_FACE, 5.93, 0.5));
  root.add(box(own, 1.8, 0.26, 7.0, matt(own, '#5f574c'), EAST_FACE, 6.56, 0.5));

  /* Facing back down the street, because that is the only side of it anybody
     standing in Turtle Lane can see. */
  const marketBoard = own.keep(new THREE.MeshBasicMaterial({
    map: surfaceOf(own, () => signBoard('MARKET ROW', '#f0e2bc', '#3a2f22', undefined, 5.4 / 0.82),
                   1, 1, anisotropy),
    color: '#cfc4a6',
  }));
  const marketMesh = new THREE.Mesh(own.keep(new THREE.PlaneGeometry(5.4, 0.82)), marketBoard);
  marketMesh.position.set(EAST_FACE - 0.78, 6.05, 0.5);
  marketMesh.rotation.y = -Math.PI / 2;
  root.add(marketMesh);

  /* Bollards, matching the two solids the area declares at x 17. */
  for (const bz of [-1.2, 2.2]) {
    root.add(box(own, 0.32, 0.9, 0.32, matt(own, '#3f4348'), 17.0, 0.45, bz));
    root.add(box(own, 0.38, 0.08, 0.38, matt(own, '#5a5f62'), 17.0, 0.94, bz));
  }

  /*
   * And Market Row itself, in the gap, as a backdrop.
   *
   * The arch is a 4.4 m hole in the only thing closing this end of the street,
   * and the area on the far side of it is not in the scene — only one ever is.
   * So a few metres of arcade are drawn here: floor, a shopfront each side, a
   * canopy over the top and one warm light in it.
   *
   * It is the same trick Market Row plays back the other way, and it is built to
   * the cone the arch actually shows rather than to what is really over there —
   * about nine metres deep and never seen from closer than two, which is a view
   * five metres wide by the time it reaches the back of it.
   */
  /*
   * Thirty metres of it, not nine.
   *
   * The first backdrop was a short box: floor, a wall each side and a wall
   * across the end nine metres in. Through a 4.4 m arch that reads as an alcove
   * with brick at the back of it — the arch stopped being a way through and
   * became a recess, which is worse than the void it replaced because it is
   * confidently wrong rather than obviously missing.
   *
   * What the eye needs is *convergence*: two lines of shopfront running away to
   * a point, and the far end far enough off that the fog is already taking it.
   * Thirty metres does that, and thirty metres of two walls and a lid is sixteen
   * boxes. It is the cheapest thing in this file and it is the first thing
   * anybody ever sees of Market Row.
   */
  /* Starting where the road stops rather than four metres under it: two ground
     planes sharing forty-four square metres is the largest coplanar pair the
     sweep has ever found here. */
  const beyondFloor = new THREE.Mesh(
    own.keep(new THREE.PlaneGeometry(26, 11)),
    matt(own, '#ffffff', surfaceOf(own, arcadeFloor, 6.2, 2.6, anisotropy))
  );
  beyondFloor.rotation.x = -Math.PI / 2;
  /* 15 mm, not 4. The road runs to x 22 and this starts at 18, so the two share
     four metres of ground through the archway — and at 4 mm apart that is inside
     the tolerance `npm run coplanar` calls a flicker. Invisible either way; only
     one of them is stable. */
  beyondFloor.position.set(EAST_FACE + 17, 0.004, 0.5);
  beyondFloor.receiveShadow = true;
  root.add(beyondFloor);

  for (const fz of [-4.5, 5.5]) {
    const inward = fz < 0 ? 1 : -1;
    /*
     * Starting where the blocks stop, at x 22 — not at 18, where they start.
     *
     * These are the walls of the passage you see through the arch, and they used
     * to run the whole way from the street's east face. So their west end face
     * landed on exactly the plane of the wall the arch is cut into: two brick
     * surfaces at one depth, both facing the street, six metres tall and two
     * across. That is the pair of full-height bands that spike as you walk — one
     * above the vending machine, one the same distance the other side, because
     * the passage has a wall each side and they are symmetrical about the arch.
     *
     * `npm run coplanar` could not see them either. It skips a pair unless one
     * side is thin, reasoning that two thick solids meeting share a face buried
     * between them — but these do not meet. They interpenetrate, with both faces
     * pointing the same way and both drawn.
     */
    root.add(box(own, 26, 6.2, 2, brickWall(), EAST_FACE + 17, 3.1, fz));
    /* Four lit fronts down each side. Warm and cold alternating, the same mix
       the arcade itself is lit by — see `market.ts` on why that matters. */
    for (let i = 0; i < 4; i++) {
      const fx = EAST_FACE + 7 + i * 7;
      root.add(box(own, 5.4, 2.3, 0.12, matt(own, '#20252c'), fx, 1.7, fz + inward * 1.02));
      root.add(box(own, 5.0, 2.1, 0.05,
                   glow(own, (i + (fz < 0 ? 0 : 1)) % 2 ? '#6f8479' : '#8a6534'),
                   fx, 1.7, fz + inward * 1.1));
      /* A fascia over each, so the wall has a rhythm rather than being a strip
         of light thirty metres long. */
      root.add(box(own, 5.4, 0.9, 0.24, matt(own, '#3a3128'), fx, 3.3, fz + inward * 1.0));
    }
  }

  /* The lid, which is the thing that says "covered" from out here. */
  root.add(box(own, 26, 0.3, 11.4, matt(own, '#242930'), EAST_FACE + 17, 6.35, 0.5));
  /* And the far end, thirty metres off and already going into the fog. */
  root.add(box(own, 2, 6.4, 12.4, brickWall(), EAST_FACE + 31, 3.2, 0.5));

  for (let i = 0; i < 3; i++) {
    const beyond = new THREE.PointLight('#ffbe7c', 88, 15, 2);
    beyond.position.set(EAST_FACE + 5 + i * 9, 4.7, 0.5);
    root.add(beyond);
    lamps.push(beyond);
  }

  /* ---- street furniture ---- */

  const lampMat = matt(own, '#33373a');
  for (const [lx, lz] of [[-9.5, -6.9], [9.5, -6.9], [-9.5, 7.9], [9.5, 7.9]] as const) {
    root.add(box(own, 0.34, 0.28, 0.34, lampMat, lx, 0.28, lz));
    root.add(box(own, 0.17, 4.6, 0.17, lampMat, lx, 2.5, lz));
    const armZ = lz < 0 ? 0.55 : -0.55;
    root.add(box(own, 0.12, 0.12, 1.2, lampMat, lx, 4.75, lz + armZ));
    const head = box(own, 0.44, 0.22, 0.7, lampMat, lx, 4.62, lz + armZ * 2);
    root.add(head);
    /* 6 cm under the lamp head rather than 1. Four of these down the street,
       each a flat disc a centimetre below an opaque box — the same fault the
       arcade's pendants had. */
    const lens = new THREE.Mesh(own.keep(new THREE.PlaneGeometry(0.36, 0.6)), glow(own, '#ffd9a2'));
    lens.rotation.x = Math.PI / 2;
    lens.position.set(lx, 4.45, lz + armZ * 2);
    root.add(lens);
    const light = new THREE.PointLight('#ffb469', 210, 24, 2);
    light.position.set(lx, 4.4, lz + armZ * 2);
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    /* See `market.ts` on `normalBias`: a constant bias cannot cover a surface
       edge-on to the light, and a street lamp is edge-on to every wall it
       stands against. With the normal offset doing that work the constant can
       come down, which takes the shadows back under the things casting them. */
    light.shadow.bias = -0.0025;
    light.shadow.normalBias = 0.04;
    root.add(light);
    lamps.push(light);
  }

  /* Benches, with slats rather than a solid seat. */
  for (const bx of [-4.2, 13.5]) {
    const g = new THREE.Group();
    g.position.set(bx, 0.14, 8.6);
    for (let i = 0; i < 4; i++) {
      g.add(box(own, 1.9, 0.06, 0.13, matt(own, '#6b4a2f'), 0, 0.44, -0.24 + i * 0.16));
    }
    for (let i = 0; i < 3; i++) {
      g.add(box(own, 1.9, 0.13, 0.05, matt(own, '#6b4a2f'), 0, 0.6 + i * 0.16, 0.3));
    }
    for (const sx of [-0.8, 0.8]) {
      g.add(box(own, 0.09, 0.44, 0.09, matt(own, '#3a3d40'), sx, 0.22, -0.2));
      g.add(box(own, 0.09, 0.44, 0.09, matt(own, '#3a3d40'), sx, 0.22, 0.26));
    }
    root.add(g);
  }

  /* Planters with a shrub in each. */
  for (const px of [-14.5, 15.5]) {
    root.add(box(own, 1.7, 0.7, 1.7, matt(own, '#7b746a'), px, 0.49, -7.5));
    root.add(box(own, 1.5, 0.1, 1.5, matt(own, '#3a2f22'), px, 0.85, -7.5));
    /*
     * Foliage on a spiral rather than a scatter.
     *
     * Seven cubes thrown at random into a planter 85 cm across land on each
     * other, and two boxes that land on each other land on each other's *faces*
     * — four of the last coplanar pairs in the world were two leaves agreeing on
     * a plane. Random does not stop doing that by being told to jitter less; it
     * just does it slightly less often.
     *
     * A golden-angle spiral gives a cluster that still looks unplanned while
     * putting every cube somewhere no other cube is, and every size and angle
     * comes off the index rather than the generator — so nothing here shares a
     * round number with anything, which is what a coincidence is made of.
     *
     * They stay inside the planter, too: the old scatter reached a metre and a
     * quarter from the middle of a planter that is 85 cm across, and the leaves
     * went through the rim.
     */
    for (let i = 0; i < 7; i++) {
      const s = 0.33 + ((i * 0.137) % 0.27);
      const angle = i * 2.39996;
      const reach = 0.09 + (i % 3) * 0.085;
      const leaf = box(own, s, s, s, matt(own, i % 2 ? '#3f6b3a' : '#4f7d46'),
                       px + Math.cos(angle) * reach,
                       /* Clear of the soil's own top face at 0.9 — one of these
                          used to land with its underside exactly on it. */
                       0.945 + s / 2 + (i % 4) * 0.073,
                       -7.5 + Math.sin(angle) * reach);
      leaf.rotation.set(0.31 + i * 0.71, 0.53 + i * 1.13, 0.17 + i * 0.89);
      root.add(leaf);
    }
  }

  /* A vending machine, lit — the other warm thing on the street. */
  /*
   * Turned to face the street, which is the whole of "the fridge in the wall".
   *
   * It stands against the east building and it was facing *north*, along the
   * wall — so from anywhere on the street you saw its blank dark side and never
   * its front. A featureless slab the size of a door, flat against brickwork,
   * reads as something half sunk into it, and the blue spill from its own light
   * washing the bricks behind made it worse. It was never actually inside the
   * wall; it was never actually facing anybody either.
   *
   * A quarter turn puts the glass, the light and the rows of cans towards the
   * road, where a vending machine points, and the thing stops being a mystery
   * slab and becomes a vending machine.
   */
  root.add(box(own, 0.7, 1.9, 1.0, matt(own, '#2f3a4a'), 17.62, 1.09, -4.0));
  root.add(box(own, 0.05, 1.15, 0.78, glow(own, '#5f93bc'), 17.22, 1.35, -4.0));
  for (let i = 0; i < 8; i++) {
    root.add(box(own, 0.02, 0.22, 0.14, matt(own, ['#c44', '#4c4', '#44c', '#cc4'][i % 4]),
                 17.16, 1.72 - Math.floor(i / 4) * 0.4, -4.33 + (i % 4) * 0.22));
  }
  /* A brand board across the top, so it reads at a distance. */
  root.add(box(own, 0.06, 0.26, 0.84, matt(own, '#c0452f'), 17.24, 1.86, -4.0));
  const vend = new THREE.PointLight('#8fc8ff', 40, 9, 2);
  vend.position.set(17.0, 1.5, -4.0);
  root.add(vend);

  /* A post box, and two bins. */
  /*
   * On the pavement, and out of the alley.
   *
   * It stood at z 2.5, which is the middle of the road *and* the middle of the
   * opening Step Lane's alley was later cut at — so a red box a metre and a half
   * tall sat in the entrance looking like part of the wall. It was also drawn
   * from y 0.14 to 1.64, which is right on a kerb and 14 cm in the air on
   * tarmac, so it had been floating since the day it was placed.
   */
  root.add(box(own, 1.0, 1.5, 1.0, matt(own, '#8a3a3a'), -17.4, 0.89, -7.3));
  root.add(box(own, 0.6, 0.1, 0.14, matt(own, '#2a2a2a'), -17.4, 1.42, -7.8));
  for (const [bx, bz] of [[-11.5, -7.6], [6.0, 8.4]]) {
    root.add(box(own, 0.6, 0.9, 0.6, matt(own, '#3f443f'), bx, 0.59, bz));
    root.add(box(own, 0.68, 0.08, 0.68, matt(own, '#2f342f'), bx, 1.07, bz));
  }

  /* ---- light ---- */

  /* The last of the daylight: dim, cool, from low in the west. Enough to keep
     the far end of the street from being a silhouette, not enough to compete
     with the lamps. */
  const dusk = new THREE.DirectionalLight('#5d7391', 0.55);
  dusk.position.set(-30, 16, -8);
  dusk.target.position.set(0, 0, 0);
  dusk.castShadow = true;
  dusk.shadow.mapSize.set(2048, 2048);
  dusk.shadow.camera.left = -26;
  dusk.shadow.camera.right = 26;
  dusk.shadow.camera.top = 22;
  dusk.shadow.camera.bottom = -22;
  dusk.shadow.camera.near = 1;
  dusk.shadow.camera.far = 70;
  dusk.shadow.bias = -0.0009;
  /* One shadow texel at this scale: 52 m across 2048. See `market.ts`. */
  dusk.shadow.normalBias = 0.05;
  root.add(dusk);
  root.add(dusk.target);

  /* Sky above, ground below — the bounce that stops undersides going to pitch. */
  root.add(new THREE.HemisphereLight('#33465f', '#241f1a', 0.45));
  root.add(new THREE.AmbientLight('#3b4459', 0.32));

  /*
   * Why these are in the hundreds.
   *
   * Same lesson the shop's ceiling lamps taught, and it had to be learnt twice
   * because the street is bigger. A point light's intensity is candela and falls
   * off with the square of the distance, so a lamp head four and a half metres
   * up at 30 candela puts about one and a half lux on the pavement below it —
   * which rendered as a street with four dim smudges on it and black in between.
   * A real sodium lamp is thousands of candela; 420 over a thirty metre radius
   * is the value that lights the pavement without flattening the buildings.
   */

  return {
    root,
    dispose() {
      for (const item of own.items) item.dispose();
      for (const lamp of lamps) lamp.shadow?.map?.dispose();
      dusk.shadow?.map?.dispose();
    },
  };
}
