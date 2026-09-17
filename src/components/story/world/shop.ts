/**
 * Grandpa's Shop Area — the Kame Game Shop, from the inside.
 *
 * Where Story Mode opens, so it is the first thing anybody sees of the world and
 * it has to hold up at a standstill: you arrive facing into it and the camera is
 * three metres away in a room eleven metres across, which is about as close as
 * this game ever looks at its own scenery.
 *
 * ## Built in Blender
 *
 * The room is a file: `public/models/world/grandpa-shop.glb`, built by
 * `npm run world -- grandpa-shop` from two sources and nothing else. The
 * collision in `areas.ts` is where everything that stops you is — the walls,
 * the counter, the shelving, the boxes — and the drawing is made *to* those
 * footprints, so the drawn thing is the colliding thing by construction. The
 * dressing in `data/world/grandpa-shop.dressing.json` is what it all looks
 * like: the boards and plaster from Poly Haven, the panelled counter with the
 * glass case let into it, the shelving stocked with boxes whose fronts are the
 * game's own card art, the pegboard of display packs, the posters, the rug,
 * the pendants, and the street beyond the window so the glass looks out on
 * something.
 *
 * What this file keeps is what has to be here before the file lands: the
 * lamps, because the lamp budget and the sky are counted the moment the area
 * opens, and the sky itself. The lamps stand where the dressing hangs their
 * fittings — one list, read by both sides.
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
import dressing from '../../../../data/world/grandpa-shop.dressing.json';
import { Owned, type BuiltArea } from './kit';
import { loadArea } from './glb';
import { Sky, ownSky } from './sky';
export type { BuiltArea };

const SHOP_D = 5.5;

export function buildShop(anisotropy: number): BuiltArea {
  const own = new Owned();
  const root = new THREE.Group();
  root.name = 'grandpa-shop';

  /* ---- light ---- */

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

  const lamps: THREE.PointLight[] = [];
  for (const l of dressing.lamps) {
    const lamp = new THREE.PointLight(l.colour, l.intensity, l.distance, 2);
    lamp.position.set(l.x, l.y, l.z);
    /* A point light's shadow is six passes over the whole room; the pendants
       earn it, the little lamp by the door does not. */
    lamp.castShadow = (l as { shadow?: boolean }).shadow !== false;
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
   *
   * Fixed, not swinging. Indoors the light does not come from where the sun is,
   * it comes from where the window is — so only its colour and its level follow
   * the hour, which is what turns the same room blue at dawn, warm at four, and
   * lit by nothing but its own pendants after dark.
   *
   * See `market.ts` on `normalBias`. A room is a kinder case than a street:
   * 16 m across 1024 is 1.6 cm.
   */
  const sky = ownSky(own, new Sky(own, root, {
    reach: 12,
    half: 8,
    deep: 6,
    target: [-1.0, 0.4, -1.5],
    fixedKey: [-1.0, 2.6, SHOP_D + 4],
    normalBias: 0.018,
    gain: 1.0,
    fill: 1.0,
    indoor: true,
    hemi: { sky: '#f0e2c6', ground: '#5a4736' },
  }));
  sky.key.shadow.mapSize.set(1024, 1024);
  sky.key.shadow.camera.near = 0.5;
  sky.key.shadow.camera.far = 22;
  sky.key.shadow.camera.updateProjectionMatrix();

  /* ---- the room itself, from its file ---- */

  const ready = loadArea(own, root, '/models/world/grandpa-shop.glb', anisotropy).then(() => undefined);

  return {
    root,
    ready,
    setTime: (hour) => { sky.apply(hour); },
    dispose() {
      for (const item of own.items) item.dispose();
      for (const lamp of lamps) lamp.shadow?.map?.dispose();
    },
  };
}
