/**
 * Grandpa's Shop Area — the Kame Game Shop, from the inside.
 *
 * Where Story Mode opens, so it is the first thing anybody sees of the world and
 * it has to hold up at a standstill: you arrive facing into it and the camera is
 * three metres away in a room eleven metres across, which is about as close as
 * this game ever looks at its own scenery.
 *
 * ## What is in here, and why each thing earns its place
 *
 * A shop is not a room with a counter in it. It is a room that has clearly been
 * *worked in* for forty years, and the difference is entirely in the small
 * stuff — so this builds the till and the stool and the box of singles on the
 * counter and the poster curling off the wall, because those are what say
 * somebody lives here. The geometry is cheap; the impression is not.
 *
 * Everything is generated, which means every one of these is a few boxes and a
 * texture rather than a model. The budget that buys the detail is the one saved
 * by not shipping any assets at all.
 *
 * ## Lighting
 *
 * Interiors are lit warm and from above, with a cool spill through the window at
 * the front — two temperatures in one room, which is most of what makes an
 * interior read as an interior rather than as a box with an ambient light in it.
 * The window light also gives the doorway a direction to be, so a player who has
 * just walked in knows where they came from without being told.
 */

import * as THREE from 'three';
import { woodFloor, darkWood, plaster, ceiling } from './surfaces';
import { Owned, box, matt, surfaceOf, type BuiltArea } from './kit';
export type { BuiltArea };

const SHOP_W = 6.5;
const SHOP_D = 5.5;
const WALL_H = 3.6;



export function buildShop(anisotropy: number): BuiltArea {
  const own = new Owned();
  const root = new THREE.Group();
  root.name = 'grandpa-shop';

  /* ---- shell ---- */

  const floorMat = matt(own, '#ffffff', surfaceOf(own, woodFloor, 3, 2.4, anisotropy));
  const floor = new THREE.Mesh(own.keep(new THREE.PlaneGeometry(SHOP_W * 2, SHOP_D * 2)), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  root.add(floor);

  const ceilMat = matt(own, '#ffffff', surfaceOf(own, ceiling, 3, 2.4, anisotropy));
  const ceil = new THREE.Mesh(own.keep(new THREE.PlaneGeometry(SHOP_W * 2, SHOP_D * 2)), ceilMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = WALL_H;
  root.add(ceil);

  const wallTex = surfaceOf(own, () => plaster('#cbbfa6'), 3, 1.2, anisotropy);

  /*
   * Walls are double-sided, and that is not a detail.
   *
   * They were single-sided planes facing into the room, which is correct for
   * every frame the camera is where it should be — and catastrophic for the one
   * frame it is not. A camera that slips outside sees straight through the back
   * of the wall into a lit room floating in black, which is the single most
   * broken-looking thing this world can do. `cameraReach` is what stops that
   * happening; this is what stops it *mattering* when it does.
   */
  const wallMatSolid = own.keep(new THREE.MeshStandardMaterial({
    color: '#ffffff', map: wallTex, roughness: 1, metalness: 0, side: THREE.DoubleSide,
  }));
  const wall = (w: number, x: number, z: number, rotY: number) => {
    const m = new THREE.Mesh(own.keep(new THREE.PlaneGeometry(w, WALL_H)), wallMatSolid);
    m.position.set(x, WALL_H / 2, z);
    m.rotation.y = rotY;
    m.receiveShadow = true;
    root.add(m);
  };
  wall(SHOP_W * 2, 0, -SHOP_D, 0);                  // back
  wall(SHOP_D * 2, -SHOP_W, 0, Math.PI / 2);        // left
  wall(SHOP_D * 2, SHOP_W, 0, -Math.PI / 2);        // right

  /* The front wall is built in pieces so the door and window are holes in it
     rather than panels stuck onto it. */
  const frontZ = SHOP_D;
  const doorX = 2.6;
  const doorW = 1.5;
  const doorH = 2.35;
  const winX = -1.6;
  const winW = 4.2;
  const winSill = 1.0;
  const winTop = 2.5;
  const frontPiece = (w: number, h: number, x: number, y: number) => {
    const m = new THREE.Mesh(own.keep(new THREE.PlaneGeometry(w, h)), wallMatSolid);
    m.position.set(x, y, frontZ);
    m.rotation.y = Math.PI;
    m.receiveShadow = true;
    root.add(m);
  };
  /* left of the window */
  frontPiece(SHOP_W + winX - winW / 2, WALL_H, (-SHOP_W + (winX - winW / 2)) / 2, WALL_H / 2);
  /* between window and door */
  frontPiece((doorX - doorW / 2) - (winX + winW / 2), WALL_H,
             ((winX + winW / 2) + (doorX - doorW / 2)) / 2, WALL_H / 2);
  /* right of the door */
  frontPiece(SHOP_W - (doorX + doorW / 2), WALL_H, (SHOP_W + (doorX + doorW / 2)) / 2, WALL_H / 2);
  /* under and over the window */
  frontPiece(winW, winSill, winX, winSill / 2);
  frontPiece(winW, WALL_H - winTop, winX, (WALL_H + winTop) / 2);
  /* over the door */
  frontPiece(doorW, WALL_H - doorH, doorX, (WALL_H + doorH) / 2);

  /* Skirting, which is a two-centimetre detail that makes a room look built. */
  /*
   * Skirting, and it stands off the wall rather than flush against it.
   *
   * At 0.03 from a wall and 0.06 deep, its back face sat on exactly the wall's
   * own plane. Every one of these near-misses was a surface pair at identical
   * depth, and they all flickered.
   */
  const skirtMat = matt(own, '#6b5638');
  /* Stopped short at both ends: run to the full width and the skirting's own end
   faces land on the side walls' planes, and the two boards meet each other at
   the corner sharing a top and a bottom. */
  root.add(box(own, SHOP_W * 2 - 0.3, 0.16, 0.06, skirtMat, 0, 0.08, -SHOP_D + 0.06));
  root.add(box(own, 0.06, 0.16, SHOP_D * 2 - 0.3, skirtMat, -SHOP_W + 0.06, 0.08, 0));
  root.add(box(own, 0.06, 0.16, SHOP_D * 2 - 0.3, skirtMat, SHOP_W - 0.06, 0.08, 0));

  /* ---- the window onto the street ---- */

  const glassMat = own.keep(new THREE.MeshStandardMaterial({
    color: '#9fc4d8', roughness: 0.15, metalness: 0, transparent: true, opacity: 0.22,
  }));
  /*
   * Something to see through the window.
   *
   * Without it the panes are black, because there genuinely is nothing out there
   * — the street is a different area and is not built while you are in here. A
   * black window in a lit room does not read as night, it reads as a hole in the
   * wall, and it was the first thing wrong with the finished shop.
   *
   * So the glass is backed by a dusk-coloured panel with a few warm lights on
   * it, sitting just outside the frame. It is a painted backdrop and it is doing
   * exactly the job a painted backdrop does on a stage.
   */
  const outside = new THREE.Mesh(
    own.keep(new THREE.PlaneGeometry(winW + 0.5, winTop - winSill + 0.4)),
    own.keep(new THREE.MeshBasicMaterial({ color: '#2b3444' }))
  );
  outside.position.set(winX, (winSill + winTop) / 2, frontZ + 0.55);
  outside.rotation.y = Math.PI;
  root.add(outside);
  for (const [gx, gy, gs, gc] of [
    [-1.5, 0.42, 0.14, '#ffc27a'], [0.4, 0.55, 0.1, '#ffd79a'],
    [1.5, 0.3, 0.12, '#e8b46a'], [-0.6, 0.2, 0.08, '#c9d8f0'],
  ] as const) {
    const spark = new THREE.Mesh(
      own.keep(new THREE.PlaneGeometry(gs, gs)),
      own.keep(new THREE.MeshBasicMaterial({ color: gc }))
    );
    spark.position.set(winX + gx, (winSill + winTop) / 2 + gy, frontZ + 0.5);
    spark.rotation.y = Math.PI;
    root.add(spark);
  }
  /* The same trick behind the door's pane. */
  const doorOut = new THREE.Mesh(
    own.keep(new THREE.PlaneGeometry(1.4, 1.1)),
    own.keep(new THREE.MeshBasicMaterial({ color: '#2b3444' }))
  );
  doorOut.position.set(doorX, 1.72, frontZ + 0.4);
  doorOut.rotation.y = Math.PI;
  root.add(doorOut);

  const glass = new THREE.Mesh(own.keep(new THREE.PlaneGeometry(winW, winTop - winSill)), glassMat);
  glass.position.set(winX, (winSill + winTop) / 2, frontZ - 0.02);
  glass.rotation.y = Math.PI;
  root.add(glass);

  const frameMat = matt(own, '#3a2a1a');
  /* Mullions: three uprights and the surround. */
  for (const fx of [winX - winW / 2, winX - winW / 6, winX + winW / 6, winX + winW / 2]) {
    root.add(box(own, 0.08, winTop - winSill, 0.12, frameMat, fx, (winSill + winTop) / 2, frontZ - 0.05));
  }
  root.add(box(own, winW + 0.12, 0.1, 0.14, frameMat, winX, winSill, frontZ - 0.05));
  root.add(box(own, winW + 0.12, 0.1, 0.14, frameMat, winX, winTop, frontZ - 0.05));

  /* ---- the door out ---- */

  const doorMat = matt(own, '#ffffff', surfaceOf(own, darkWood, 1, 2, anisotropy));
  const door = box(own, doorW - 0.08, doorH - 0.06, 0.07, doorMat, doorX, (doorH - 0.06) / 2, frontZ - 0.06);
  root.add(door);
  /* A pane in the top half, so the door reads as a shop door. */
  const doorGlass = new THREE.Mesh(own.keep(new THREE.PlaneGeometry(doorW - 0.5, 0.8)), glassMat);
  doorGlass.position.set(doorX, 1.72, frontZ - 0.11);
  doorGlass.rotation.y = Math.PI;
  root.add(doorGlass);
  root.add(box(own, 0.07, 0.07, 0.16, matt(own, '#c9a227'), doorX - 0.5, 1.05, frontZ - 0.16));
  /* Frame around the opening. */
  root.add(box(own, 0.1, doorH, 0.16, frameMat, doorX - doorW / 2, doorH / 2, frontZ - 0.05));
  root.add(box(own, 0.1, doorH, 0.16, frameMat, doorX + doorW / 2, doorH / 2, frontZ - 0.05));
  root.add(box(own, doorW + 0.2, 0.1, 0.16, frameMat, doorX, doorH, frontZ - 0.05));

  /* An "OPEN" card hung on the glass. */
  const openSign = box(own, 0.42, 0.2, 0.02, matt(own, '#1d6b3a'), doorX + 0.2, 1.9, frontZ - 0.13);
  root.add(openSign);

  /* ---- the counter ---- */

  const counterTop = matt(own, '#ffffff', surfaceOf(own, darkWood, 4, 1, anisotropy));
  const counterBody = matt(own, '#3f2b1a');
  const cx = -1.1;
  const cz = -2.6;
  root.add(box(own, 7.8, 0.86, 1.1, counterBody, cx, 0.43, cz));
  /* The top overhangs, which is what a counter does and what makes it read as
     furniture rather than as a block. */
  root.add(box(own, 8.05, 0.07, 1.3, counterTop, cx, 0.9, cz));
  /* A panelled front, three recessed panels. */
  for (let i = -1; i <= 1; i++) {
    root.add(box(own, 2.1, 0.6, 0.04, matt(own, '#513722'), cx + i * 2.35, 0.46, cz + 0.59));
  }

  /*
   * Till, box of singles, mug and stool — all of them kept off Grandpa's line.
   *
   * The till used to stand at `cx + 2.2`, which is x 1.1, and Grandpa stands at
   * x 0.9. So the first thing a player saw on walking in was a white box with
   * the top of a head behind it. Everything on the counter is now pushed to the
   * ends, leaving the middle — where he is, and where you meet him — clear.
   */
  root.add(box(own, 0.5, 0.34, 0.42, matt(own, '#d9d4c8'), cx + 3.5, 1.11, cz - 0.05));
  root.add(box(own, 0.42, 0.1, 0.3, matt(own, '#2b2b2b'), cx + 3.5, 1.33, cz + 0.05));
  const singles = box(own, 0.62, 0.16, 0.4, matt(own, '#b4462f'), cx - 0.55, 1.02, cz + 0.1);
  root.add(singles);
  for (let i = 0; i < 7; i++) {
    root.add(box(own, 0.055, 0.13, 0.34, matt(own, i % 2 ? '#e8e2d2' : '#d8cfba'),
                 cx - 0.8 + i * 0.075, 1.05, cz + 0.1));
  }
  root.add(box(own, 0.1, 0.12, 0.1, matt(own, '#e4e0d6'), cx + 3.0, 1.0, cz - 0.1));
  /* His stool, pushed along the counter out of the way — he is standing, and a
     stool directly behind him reads as furniture he is straddling. */
  root.add(box(own, 0.42, 0.06, 0.42, matt(own, '#6a4a2c'), cx - 2.6, 0.64, cz - 1.05));
  for (const [sx, sz] of [[-0.16, -0.16], [0.16, -0.16], [-0.16, 0.16], [0.16, 0.16]]) {
    root.add(box(own, 0.05, 0.62, 0.05, matt(own, '#4a3520'), cx - 2.6 + sx, 0.31, cz - 1.05 + sz));
  }

  /* A glass display case let into the counter — the good cards. */
  const caseGlass = own.keep(new THREE.MeshStandardMaterial({
    color: '#cfe6f2', roughness: 0.1, metalness: 0, transparent: true, opacity: 0.18,
  }));
  const caseTop = new THREE.Mesh(own.keep(new THREE.BoxGeometry(2.0, 0.02, 0.8)), caseGlass);
  /* 3 cm above the counter it stands on, not 1.5. The glass top of a display
     case is a large flat sheet directly over another large flat sheet, and at
     15 mm the pair of them was the biggest near-coincidence left in the shop. */
  caseTop.position.set(cx - 2.2, 0.975, cz);
  root.add(caseTop);
  for (let i = 0; i < 5; i++) {
    root.add(box(own, 0.28, 0.012, 0.4, matt(own, ['#7a5aa8', '#3f6fb0', '#a8863f', '#8f3f4f', '#3f8f6a'][i]),
                 cx - 2.9 + i * 0.36, 0.88, cz));
  }

  /* ---- shelving ---- */

  const shelfMat = matt(own, '#ffffff', surfaceOf(own, darkWood, 2, 1, anisotropy));
  const unit = (x: number, z: number, w: number, d: number, rotY: number) => {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    g.add(box(own, w, 2.0, 0.06, shelfMat, 0, 1.0, -d / 2));
    g.add(box(own, 0.06, 2.0, d, shelfMat, -w / 2, 1.0, 0));
    g.add(box(own, 0.06, 2.0, d, shelfMat, w / 2, 1.0, 0));
    for (let i = 0; i < 4; i++) {
      const y = 0.36 + i * 0.48;
      g.add(box(own, w, 0.05, d, shelfMat, 0, y, 0));
      /*
       * Boxes of product, on a fixed pitch.
       *
       * Muted on purpose: the first pass used saturated primaries and the
       * shelves read as a sweet shop — stock is printed card in a dim room, not
       * boiled sweets.
       *
       * Laid out by slot rather than by accumulating a running offset. The
       * accumulating version derived each box's *size* from the offset it had
       * reached, which on some shelves produced two boxes at the same place —
       * four coincident pairs, one per shelf, found by `npm run coplanar`. A
       * slot index cannot do that: each box owns a cell and is drawn inside it.
       */
      const palette = ['#7a4638', '#3f566f', '#6b5f3c', '#47654f', '#5b3f5b', '#7d6840'];
      const slots = Math.max(3, Math.floor((w - 0.24) / 0.3));
      const pitch = (w - 0.24) / slots;
      for (let k = 0; k < slots; k++) {
        const wobble = ((k * 37 + i * 53) % 11) / 11;
        const bw = pitch * (0.62 + wobble * 0.24);
        const bh = 0.2 + (((k * 29 + i * 17) % 9) / 9) * 0.18;
        g.add(box(own, bw, bh, d * 0.72,
                  matt(own, palette[(k + i * 2) % palette.length]),
                  -w / 2 + 0.12 + pitch * (k + 0.5), y + 0.025 + bh / 2, 0));
      }
    }
    root.add(g);
  };
  /*
   * Stood 12 cm off the wall rather than 5.
   *
   * Their backs used to land a centimetre off the skirting board running behind
   * them — two thin vertical faces sharing the better part of a square metre,
   * down both sides of the room. Shelving does not touch a skirting anyway; it
   * stands in front of it.
   *
   * The matching solids in `areas.ts` moved with them.
   */
  unit(-SHOP_W + 0.67, 0.6, 4.6, 1.0, Math.PI / 2);
  unit(SHOP_W - 0.67, -0.9, 5.4, 1.0, -Math.PI / 2);

  /* The back wall behind the counter: pegboard and a rack of boosters. */
  const pegMat = matt(own, '#8a7a5c');
  root.add(box(own, 6.4, 2.1, 0.05, pegMat, -1.1, 1.7, -SHOP_D + 0.05));
  for (let i = 0; i < 18; i++) {
    const px = -4.0 + (i % 9) * 0.64;
    const py = 1.15 + Math.floor(i / 9) * 0.86;
    root.add(box(own, 0.3, 0.42, 0.03, matt(own, ['#a8503f', '#41618f', '#a2853c', '#4a7d5c'][i % 4]),
                 px, py, -SHOP_D + 0.09));
  }

  /* ---- the things that say somebody works here ---- */

  /* A poster, slightly off square. */
  const poster = box(own, 0.9, 1.25, 0.02, matt(own, '#c9b98f'), -SHOP_W + 0.08, 2.2, -2.6, 0);
  poster.rotation.z = 0.014;
  poster.rotation.y = Math.PI / 2;
  root.add(poster);

  /* Cardboard boxes stacked in the corner, not quite squared up. */
  const cardboard = matt(own, '#9c7d54');
  const stack = new THREE.Group();
  stack.position.set(-4.4, 0, -3.2);
  stack.rotation.y = 0.22;
  stack.add(box(own, 0.75, 0.5, 0.6, cardboard, 0, 0.25, 0));
  stack.add(box(own, 0.68, 0.44, 0.55, cardboard, 0.06, 0.72, 0.04, 0.3));
  root.add(stack);

  /* A rug in front of the counter, worn thin down the middle. */
  /* Flat on the floorboards, so it needs the same depth bias the street's road
     markings get — a rug and a floor at the same depth strobe against each other
     as the camera moves. */
  const rugMat = own.keep(new THREE.MeshStandardMaterial({
    color: '#6a3a3a', roughness: 1, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
  const rug = new THREE.Mesh(own.keep(new THREE.PlaneGeometry(3.2, 1.8)), rugMat);
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(-0.6, 0.02, -0.4);
  rug.receiveShadow = true;
  root.add(rug);

  /* ---- light ---- */

  /* Ambient, low: the room is lit by its lamps, not by magic. */
  /*
   * Interior light, and the numbers are large on purpose.
   *
   * three.js has been physically-based since r155: a point light's intensity is
   * in candela and falls off with the square of the distance, so the 26 this
   * shop was first lit with delivered almost nothing three metres away.
   *
   * The correction then went too far the other way — 230 candela a fitting over
   * an ambient of 2.4 blew the whole room to white under ACES, which looked
   * worse than the dark version because at least the dark one had contrast in
   * it. These are the numbers that came back from actually looking: enough that
   * the far corners read, little enough that the floorboards keep their grain.
   */
  const ambient = new THREE.AmbientLight('#8d8471', 0.85);
  root.add(ambient);

  /* Two warm pendants over the floor, each with its shade. */
  const lamps: THREE.PointLight[] = [];
  for (const lx of [-4.2, 0, 4.2]) {
    const shade = box(own, 0.44, 0.2, 0.44, matt(own, '#3a3128'), lx, WALL_H - 0.34, -0.2);
    root.add(shade);
    root.add(box(own, 0.03, 0.5, 0.03, matt(own, '#2a241c'), lx, WALL_H - 0.1, -0.2));
    const bulb = new THREE.Mesh(own.keep(new THREE.SphereGeometry(0.09, 12, 10)),
      own.keep(new THREE.MeshBasicMaterial({ color: '#ffe6b8' })));
    bulb.position.set(lx, WALL_H - 0.5, -0.2);
    root.add(bulb);
    const lamp = new THREE.PointLight('#ffd8a0', 58, 14, 2);
    lamp.position.set(lx, WALL_H - 0.55, -0.2);
    lamp.castShadow = true;
    lamp.shadow.mapSize.set(1024, 1024);
    /* See `market.ts` on `normalBias`. A room is a kinder case than a street —
       everything is close and the light is above it — but the walls are still
       edge-on to a ceiling lamp. */
    lamp.shadow.bias = -0.002;
    lamp.shadow.normalBias = 0.017;
    root.add(lamp);
    lamps.push(lamp);
  }

  /*
   * Daylight through the shopfront: cool, directional, and the reason the room
   * has two temperatures in it. Aimed inwards and slightly down, so it lands on
   * the floor in front of the window the way a real one would.
   */
  const day = new THREE.DirectionalLight('#8fb0d4', 0.45);
  day.position.set(-1.0, 2.6, SHOP_D + 4);
  day.target.position.set(-1.0, 0.4, -1.5);
  day.castShadow = true;
  day.shadow.mapSize.set(1024, 1024);
  day.shadow.camera.left = -8;
  day.shadow.camera.right = 8;
  day.shadow.camera.top = 6;
  day.shadow.camera.bottom = -3;
  day.shadow.camera.near = 0.5;
  day.shadow.camera.far = 22;
  day.shadow.bias = -0.0009;
  day.shadow.normalBias = 0.018;
  root.add(day);
  root.add(day.target);

  /* A little bounce off the floor, so undersides are not pitch black. */
  const bounce = new THREE.HemisphereLight('#f0e2c6', '#5a4736', 0.55);
  root.add(bounce);

  return {
    root,
    dispose() {
      for (const item of own.items) item.dispose();
      for (const lamp of lamps) lamp.shadow?.map?.dispose();
      day.shadow?.map?.dispose();
    },
  };
}
