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
import { asphalt, paving, brick, render, darkWood, plaster, signBoard, tile } from './surfaces';
import type { BuiltArea } from './shop';

const ST_W = 22;
const ST_D = 17;

/** Where the buildings' front faces are. */
const NORTH_FACE = -9;
const SOUTH_FACE = 10;
const WEST_FACE = -18;
const EAST_FACE = 18;

/** Pavement runs from each building face to these. */
const NORTH_KERB = -6.5;
const SOUTH_KERB = 7.5;

class Owned {
  readonly items: { dispose(): void }[] = [];
  keep<T extends { dispose(): void }>(x: T): T {
    this.items.push(x);
    return x;
  }
}

function surfaceOf(
  own: Owned,
  make: () => THREE.Texture | null,
  rx: number, ry: number, anisotropy: number
): THREE.Texture | null {
  const tex = make();
  if (!tex) return null;
  own.keep(tex);
  return tile(tex, rx, ry, anisotropy);
}

function matt(own: Owned, colour: string, map?: THREE.Texture | null): THREE.MeshStandardMaterial {
  return own.keep(new THREE.MeshStandardMaterial({
    color: colour, map: map ?? null, roughness: 1, metalness: 0,
  }));
}

/**
 * A material for anything laid flat *on* another surface — road markings, bills,
 * posters.
 *
 * `polygonOffset` biases the fragment's depth away from the camera by a hair, so
 * a decal and the thing it is painted on can never resolve to the same depth
 * value and strobe against each other as the camera moves. Tightening the near
 * and far planes (see `OpenWorld`) removes almost all of the risk; this removes
 * the rest, and costs nothing.
 */
function decal(own: Owned, colour: string): THREE.MeshStandardMaterial {
  return own.keep(new THREE.MeshStandardMaterial({
    color: colour, roughness: 1, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
}

/**
 * An unlit material, for anything that is a light source rather than lit by one.
 *
 * The colours passed in are much darker than instinct suggests, and they have to
 * be. A `MeshBasicMaterial` ignores every light in the scene and draws its colour
 * flat, so a window painted `#ffd9a0` comes out at almost full white *everywhere*
 * — no falloff, no shading, no tone response. Fifteen of them across two terraces
 * turned the street into a row of light boxes with a road in front. Lit glass
 * seen from outside is a mid amber, not a lamp, and these are pitched there.
 */
function glow(own: Owned, colour: string): THREE.MeshBasicMaterial {
  return own.keep(new THREE.MeshBasicMaterial({ color: colour }));
}

function box(
  own: Owned, w: number, h: number, d: number,
  material: THREE.Material, x: number, y: number, z: number, rotY = 0
): THREE.Mesh {
  const geo = own.keep(new THREE.BoxGeometry(w, h, d));
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotY;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Deterministic, so the street is the same street every time it is entered. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function buildStreet(anisotropy: number): BuiltArea {
  const own = new Owned();
  const root = new THREE.Group();
  root.name = 'starting-area';
  const rnd = seeded(0x51ee7);

  /* ---- ground ---- */

  const roadMat = matt(own, '#ffffff', surfaceOf(own, asphalt, 6, 4, anisotropy));
  const road = new THREE.Mesh(own.keep(new THREE.PlaneGeometry(ST_W * 2, SOUTH_KERB - NORTH_KERB)), roadMat);
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0, (NORTH_KERB + SOUTH_KERB) / 2);
  road.receiveShadow = true;
  root.add(road);

  const paveMat = matt(own, '#ffffff', surfaceOf(own, paving, 10, 1.6, anisotropy));
  for (const [z0, z1] of [[NORTH_FACE, NORTH_KERB], [SOUTH_KERB, SOUTH_FACE]]) {
    const pave = new THREE.Mesh(own.keep(new THREE.PlaneGeometry(ST_W * 2, z1 - z0)), paveMat);
    pave.rotation.x = -Math.PI / 2;
    pave.position.set(0, 0.14, (z0 + z1) / 2);
    pave.receiveShadow = true;
    root.add(pave);
    /* The kerb itself — a lip, not a painted line. */
    const kerb = box(own, ST_W * 2, 0.16, 0.3, matt(own, '#8b8d90'), 0,
                     0.07, z0 === NORTH_FACE ? z1 - 0.15 : z0 + 0.15);
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

  const brickTex = surfaceOf(own, () => brick('#8a5344'), 3, 2.2, anisotropy);
  const brickAlt = surfaceOf(own, () => brick('#6f6257'), 3, 2.2, anisotropy);
  const renderTex = surfaceOf(own, () => render('#b9ae97'), 2.2, 2, anisotropy);
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
    const depth = 8;
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
    const body = matt(own, '#ffffff', skin);
    root.add(box(own, w, height, depth, body, cx, height / 2, zc));

    /* Cornice and parapet, which is what stops a building looking like a box. */
    root.add(box(own, w + 0.34, 0.32, depth + 0.34, matt(own, '#4e4a43'), cx, height + 0.16, zc));
    root.add(box(own, w + 0.1, 0.7, depth + 0.1, matt(own, '#5a544c'), cx, height + 0.5, zc));

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
      const gw = w - 1.0;
      root.add(box(own, gw, 2.1, 0.14, darkWindow, cx, 1.9, zf + out * 0.08));
      /* Warm spill from inside, which is what makes a street at dusk look
         inhabited rather than abandoned. */
      root.add(box(own, gw - 0.24, 1.86, 0.05, glow(own, '#9d6f35'), cx, 1.9, zf + out * 0.13));
      /*
       * Mullions across it, and the transom above.
       *
       * Without them a shopfront is a single lit rectangle two metres tall, and
       * a terrace of those reads as a row of billboards. Three bars and a
       * cross-piece cost twelve triangles each and turn every one of them into a
       * window with panes — which is the difference between a street and a set.
       */
      const bars = Math.max(2, Math.round(gw / 1.1));
      for (let m = 1; m < bars; m++) {
        root.add(box(own, 0.08, 1.86, 0.07, matt(own, '#33291f'),
                     cx - gw / 2 + (gw / bars) * m, 1.9, zf + out * 0.16));
      }
      /*
       * The transom sits a centimetre proud of the uprights it crosses.
       *
       * At the same depth they share a face wherever they intersect, and each of
       * those little crossings flickers — 68 of them across the two terraces,
       * which `npm run coplanar` found and no screenshot ever would have.
       */
      root.add(box(own, gw - 0.24, 0.09, 0.07, matt(own, '#33291f'), cx, 2.46, zf + out * 0.175));
      /* Something on the other side of the glass, so it is not a light box. */
      for (let d2 = 0; d2 < Math.max(2, Math.floor(gw / 1.4)); d2++) {
        root.add(box(own, 0.34, 0.3, 0.22,
                     matt(own, ['#7a4638', '#3f566f', '#6b5f3c', '#47654f'][d2 % 4]),
                     cx - gw / 2 + 0.6 + d2 * 1.4, 1.35, zf + out * 0.03));
      }
      root.add(box(own, gw + 0.3, 0.22, 0.28, matt(own, '#3b332a'), cx, 3.06, zf + out * 0.14));
      root.add(box(own, gw + 0.3, 0.24, 0.28, matt(own, '#3b332a'), cx, 0.82, zf + out * 0.14));
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
  const shopSkin = matt(own, '#ffffff', surfaceOf(own, () => plaster('#c2b498'), 2, 2, anisotropy));
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
  root.add(box(own, shopW - 0.3, 1.45, 0.22, matt(own, '#2f4a3a'), shopX, 3.42, zf + 0.08));
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
   * A step up to the door — and its top has to be *above* the pavement.
   *
   * It was 0.14 tall standing on the ground, so its top face landed on exactly
   * the same plane as the pavement at y 0.14. That is what was flickering
   * underfoot at the shop door. Twenty-two centimetres tall now, which both
   * fixes it and makes the threshold read as a step rather than a paving slab.
   */
  root.add(box(own, 2.0, 0.22, 0.7, matt(own, '#8b8d90'), shopX, 0.11, NORTH_FACE + 0.5));

  /* ---- the ends ---- */

  /* West: a hoarding round a building site, plastered with bills. */
  const hoard = matt(own, '#4a5a52');
  root.add(box(own, 4, 3.6, ST_D * 2, hoard, WEST_FACE - 2, 1.8, 0));
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
    const z = -ST_D + 2 + i * 3.6;
    root.add(box(own, 0.05, 1.1, 0.8, decal(own, ['#8a4a4a', '#4a5a8a', '#8a7a4a', '#5a8a5a'][i % 4]),
                 WEST_FACE + 0.05, 1.5 + (i % 3) * 0.5, z));
  }
  /* Scaffolding poles above it, so something is clearly going on back there. */
  for (let i = 0; i < 6; i++) {
    root.add(box(own, 0.1, 6, 0.1, matt(own, '#7a7266'), WEST_FACE - 1.2, 3 + 3.6 / 2, -ST_D + 3 + i * 5.6));
  }

  /* East: a railed-off alley mouth. You can see down it; you cannot go. */
  root.add(box(own, 4, 9.5, ST_D * 2, matt(own, '#ffffff', brickAlt), EAST_FACE + 2, 4.75, 0));
  const railMat = matt(own, '#2f3336');
  root.add(box(own, 0.12, 1.5, 6.2, railMat, EAST_FACE - 0.1, 0.9, 0.5));
  for (let i = 0; i < 13; i++) {
    root.add(box(own, 0.06, 1.4, 0.06, railMat, EAST_FACE - 0.1, 0.85, -2.6 + i * 0.52));
  }
  /* The handrail sits above the panel rather than flush with it: at 1.58 its top
     landed on exactly the panel's top at 1.65 and the two fought along the whole
     six metres of it. */
  root.add(box(own, 0.14, 0.14, 6.4, railMat, EAST_FACE - 0.1, 1.64, 0.5));

  /* ---- street furniture ---- */

  const lampMat = matt(own, '#33373a');
  const lamps: THREE.PointLight[] = [];
  for (const [lx, lz] of [[-9.5, -6.9], [9.5, -6.9], [-9.5, 7.9], [9.5, 7.9]] as const) {
    root.add(box(own, 0.34, 0.28, 0.34, lampMat, lx, 0.28, lz));
    root.add(box(own, 0.17, 4.6, 0.17, lampMat, lx, 2.5, lz));
    const armZ = lz < 0 ? 0.55 : -0.55;
    root.add(box(own, 0.12, 0.12, 1.2, lampMat, lx, 4.75, lz + armZ));
    const head = box(own, 0.44, 0.22, 0.7, lampMat, lx, 4.62, lz + armZ * 2);
    root.add(head);
    const lens = new THREE.Mesh(own.keep(new THREE.PlaneGeometry(0.36, 0.6)), glow(own, '#ffd9a2'));
    lens.rotation.x = Math.PI / 2;
    lens.position.set(lx, 4.5, lz + armZ * 2);
    root.add(lens);
    const light = new THREE.PointLight('#ffb469', 210, 24, 2);
    light.position.set(lx, 4.4, lz + armZ * 2);
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    light.shadow.bias = -0.005;
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
    for (let i = 0; i < 7; i++) {
      const s = 0.4 + rnd() * 0.45;
      /* Clear of the soil's own top face at 0.9 — one of these used to land with
         its underside exactly on it. */
      const b = box(own, s, s, s, matt(own, i % 2 ? '#3f6b3a' : '#4f7d46'),
                    px + (rnd() - 0.5) * 0.9, 0.94 + s / 2 + rnd() * 0.4, -7.5 + (rnd() - 0.5) * 0.9);
      b.rotation.set(rnd(), rnd(), rnd());
      root.add(b);
    }
  }

  /* A vending machine, lit — the other warm thing on the street. */
  root.add(box(own, 1.0, 1.9, 0.7, matt(own, '#2f3a4a'), 17.6, 1.09, -4.0));
  root.add(box(own, 0.78, 1.15, 0.05, glow(own, '#5f93bc'), 17.6, 1.35, -4.36));
  for (let i = 0; i < 8; i++) {
    root.add(box(own, 0.14, 0.22, 0.02, matt(own, ['#c44', '#4c4', '#44c', '#cc4'][i % 4]),
                 17.28 + (i % 4) * 0.22, 1.72 - Math.floor(i / 4) * 0.4, -4.4));
  }
  const vend = new THREE.PointLight('#8fc8ff', 40, 9, 2);
  vend.position.set(17.2, 1.5, -4.5);
  root.add(vend);

  /* A post box, and two bins. */
  root.add(box(own, 1.0, 1.5, 1.0, matt(own, '#8a3a3a'), -17.2, 0.89, 2.5));
  root.add(box(own, 0.6, 0.1, 0.14, matt(own, '#2a2a2a'), -17.2, 1.42, 2.0));
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
  dusk.shadow.bias = -0.0014;
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
