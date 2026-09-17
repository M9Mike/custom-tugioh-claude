/**
 * Market Row — the covered shopping street east of Turtle Lane.
 *
 * A shōtengai: two rows of small shops facing each other across ten metres of
 * tiled floor, with a canopy over the whole forty-six metres of it. You come in
 * under an arch at one end; the other end is gated, and the station is through
 * the gate.
 *
 * ## Built in Blender
 *
 * The arcade is a file, `public/models/world/market-row.glb`, built by
 * `npm run world -- market-row` from `areas.ts` and
 * `data/world/market-row.dressing.json` — see `shop.ts` for the rules. The
 * two rows stand on the tall slabs, the goods left out on the floor are the
 * `MARKET_GOODS` solids read through their `kind`, and the eighteen units
 * are the dressing's own list, each with its name on its fascia.
 *
 * ## The one thing this area has to do
 *
 * Put a roof on and the black above is no longer sky — it is a hole in the
 * building you are standing inside. So the canopy is the top wall, the light
 * is all hanging (eight pendants down the spine), and the two ends are
 * brighter than the middle because that is where the daylight gets in. The
 * lights are here, off the dressing's own list, so the lamp budget is
 * counted before the file lands.
 */

import * as THREE from 'three';
import dressing from '../../../../data/world/market-row.dressing.json';
import { Owned, type BuiltArea } from './kit';
import { loadArea } from './glb';
import { Sky, ownSky } from './sky';

export function buildMarket(anisotropy: number): BuiltArea {
  const own = new Owned();
  const root = new THREE.Group();
  root.name = 'market-row';

  const lights: THREE.PointLight[] = [];
  for (const l of dressing.lights) {
    const light = new THREE.PointLight(l.colour, l.intensity, l.distance, 2);
    light.position.set(l.x, l.y, l.z);
    root.add(light);
    lights.push(light);
  }

  /*
   * The sky over an arcade: a shōtengai under a painted metal canopy a metre
   * and a half above its lamps. The light coming down in there is the
   * pendants' own, returned warm, so the hemisphere is named rather than
   * taken from the hour — see `sky.ts`.
   */
  const s = dressing.sky;
  const sky = ownSky(own, new Sky(own, root, {
    reach: s.reach,
    half: s.half,
    deep: s.deep,
    normalBias: s.normalBias,
    gain: s.gain,
    fill: s.fill,
    hemi: s.hemi,
  }));
  sky.claim();

  const ready = loadArea(own, root, '/models/world/market-row.glb', anisotropy).then(() => undefined);

  return {
    root,
    ready,
    setTime: (hour) => { sky.apply(hour); },
    dispose() {
      for (const item of own.items) item.dispose();
      for (const light of lights) light.shadow?.map?.dispose();
    },
  };
}
