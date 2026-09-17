/**
 * Step Lane — the residential hill above Turtle Lane.
 *
 * Thirty-six metres of stepped alley climbing five and three-quarter metres
 * between houses. Nothing is for sale up here: this is where people live, and
 * everything in it is the evidence of that — meter boxes, post boxes, bicycles
 * chained to railings, pot plants left on the steps, a jizo in a niche with a
 * bib on it, and the power lines that hang over every street like this.
 *
 * ## Built in Blender
 *
 * The lane is a file, `public/models/world/step-lane.glb`, built by
 * `npm run world -- step-lane` from `areas.ts` and
 * `data/world/step-lane.dressing.json` — see `shop.ts` for the rules. The
 * treads and landings are the platforms `climbPlatforms` makes, the walls and
 * the houses stand at whatever height the climb gives back, and nothing in
 * the file knows a height of its own. The porch lights below ask `groundAt`
 * for theirs the same way.
 *
 * ## Dusk, and where the light is
 *
 * Lit the same way as the street below: porch lights over front doors and the
 * brightest thing in the area at the very top, over the gate — because on a
 * stair the eye goes where the light is and up is where you want it to go.
 */

import * as THREE from 'three';
import dressing from '../../../../data/world/step-lane.dressing.json';
import { Owned, type BuiltArea } from './kit';
import { loadArea } from './glb';
import { Sky, ownSky } from './sky';
import { AREAS, groundAt } from '@/story/areas';

const AREA = AREAS['step-lane'];

export function buildStepLane(anisotropy: number): BuiltArea {
  const own = new Owned();
  const root = new THREE.Group();
  root.name = 'step-lane';

  const lamps: THREE.PointLight[] = [];
  for (const l of dressing.lights) {
    const light = new THREE.PointLight(l.colour, l.intensity, l.distance, 2);
    /* Off the climb, like everything else here. */
    light.position.set(l.x, groundAt(AREA, l.x, 0) + l.above, l.z);
    root.add(light);
    lamps.push(light);
  }

  const s = dressing.sky;
  const sky = ownSky(own, new Sky(own, root, {
    reach: s.reach,
    half: s.half,
    deep: s.deep,
    target: s.target as [number, number, number],
    normalBias: s.normalBias,
    gain: s.gain,
    fill: s.fill,
  }));
  sky.claim();

  const ready = loadArea(own, root, '/models/world/step-lane.glb', anisotropy).then(() => undefined);

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
