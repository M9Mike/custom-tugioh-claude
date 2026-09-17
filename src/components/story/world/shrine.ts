/**
 * Domino Shrine — the precinct above the south side of Turtle Lane.
 *
 * Sixty-four metres by fifty-two, and the first area in this world you can get
 * lost in for a moment. Everything before it was a route; this is grounds: a
 * walled yard of gravel, a great flight up to it from the street, an approach
 * dead straight from the gate to the hall, and everything else off it — the
 * basin west, the plaque rack east, a smaller shrine inside the eastern trees
 * you only find by leaving the path, and a stone behind the hall you only find
 * by walking round it.
 *
 * ## Built in Blender
 *
 * The precinct is a file, `public/models/world/domino-shrine.glb`, built by
 * `npm run world -- domino-shrine` from `areas.ts` and
 * `data/world/domino-shrine.dressing.json` — see `shop.ts` for the rules. The
 * floor, the flights and the hall's platform are the platforms; everything
 * that stands in the grounds is `SHRINE_THINGS`, each drawn at whatever height
 * the ground gives back. The lamps below ask `groundAt` for theirs the same
 * way, except the ones outside the yard, which say their height.
 *
 * ## Dusk, and the light
 *
 * Open ground at dusk is lit by the sky, not by the sun that has gone — so the
 * hemisphere does most of the work here and the moon only models the shapes.
 * Stone lanterns down the avenue with a flame in some of them, the hall lit
 * from under its eaves, a wash at the top of the steps so the way in reads as
 * a way in, and the gravel reading pale, which is the whole character of the
 * place.
 */

import * as THREE from 'three';
import dressing from '../../../../data/world/domino-shrine.dressing.json';
import { Owned, type BuiltArea } from './kit';
import { loadArea } from './glb';
import { Sky, ownSky } from './sky';
import { AREAS, groundAt } from '@/story/areas';

const AREA = AREAS['domino-shrine'];

type Lamp = { x: number; z: number; colour: string; intensity: number; distance: number; y?: number; above?: number };

export function buildShrine(anisotropy: number): BuiltArea {
  const own = new Owned();
  const root = new THREE.Group();
  root.name = 'domino-shrine';

  const lamps: THREE.PointLight[] = [];
  for (const l of dressing.lights as Lamp[]) {
    const light = new THREE.PointLight(l.colour, l.intensity, l.distance, 2);
    light.position.set(l.x, l.y ?? groundAt(AREA, l.x, l.z) + (l.above ?? 0), l.z);
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

  const ready = loadArea(own, root, '/models/world/domino-shrine.glb', anisotropy).then(() => undefined);

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
