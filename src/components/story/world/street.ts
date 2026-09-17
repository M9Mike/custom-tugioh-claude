/**
 * The Starting Area — the street outside the Kame Game Shop.
 *
 * Four times the floor of the shop and the first place with any distance in it,
 * so it carries a different job: the shop has to hold up close, and this has to
 * hold up *far*. What you see from the far end of it is a row of buildings, and
 * a row of buildings is only convincing if no two of them are the same.
 *
 * ## Built in Blender
 *
 * The street is a file, `public/models/world/starting-area.glb`, built by
 * `npm run world -- starting-area` from `areas.ts` and
 * `data/world/starting-area.dressing.json` — see `shop.ts` for the rules.
 * The terraces stand on the tall solids, the pavements are the platforms, the
 * furniture is built to the small solids that name what they are, and every
 * way out shows the first few metres of where it goes. The lights are here,
 * off the dressing's own list, so the lamp budget is counted before the
 * file lands; the lit windows in the file are emissive and the sky dims them
 * by day exactly as it dims the old `glow`s.
 *
 * ## Enclosure
 *
 * Every edge is a building, a hoarding or a railing, and all of it is *taller
 * than the camera*. Nothing here is under three metres, and the terraces run
 * to nine, so from anywhere on the street the horizon is roofline rather than
 * void.
 */

import * as THREE from 'three';
import dressing from '../../../../data/world/starting-area.dressing.json';
import { Owned, type BuiltArea } from './kit';
import { loadArea } from './glb';
import { Sky, ownSky } from './sky';

export function buildStreet(anisotropy: number): BuiltArea {
  const own = new Owned();
  const root = new THREE.Group();
  root.name = 'starting-area';

  /*
   * Why these are in the hundreds: a point light's intensity is candela and
   * falls off with the square of the distance, so a lamp head three and a
   * half metres up at 30 candela puts about one and a half lux on the
   * pavement below it. See the old builder's note, kept in git.
   */
  const lamps: THREE.PointLight[] = [];
  for (const l of dressing.lights) {
    const light = new THREE.PointLight(l.colour, l.intensity, l.distance, 2);
    light.position.set(l.x, l.y, l.z);
    if ((l as { shadow?: boolean }).shadow) {
      light.castShadow = true;
      light.shadow.mapSize.set(1024, 1024);
      /* See `market.ts` on `normalBias`: a street lamp is edge-on to every
         wall it stands against. */
      light.shadow.bias = -0.0025;
      light.shadow.normalBias = 0.025;
    }
    root.add(light);
    lamps.push(light);
  }

  /*
   * The sky over Turtle Lane: about half of what an open precinct gets — a
   * street with terraces down both sides only ever sees the strip above it —
   * and the shadow camera covers the whole 52 m of it. 52 m across 2048 is
   * 2.5 cm, which is what `normalBias` has to be.
   */
  const sky = ownSky(own, new Sky(own, root, {
    reach: 40,
    half: 26,
    deep: 22,
    normalBias: 0.029,
    gain: 0.8,
    fill: 0.78,
  }));
  /* Every lamp in the street, found rather than listed. See `sky.ts`. */
  sky.claim();

  const ready = loadArea(own, root, '/models/world/starting-area.glb', anisotropy).then(() => undefined);

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
