/**
 * An area that was built in three.js by hand and is a file now.
 *
 * `npm run world -- <area>` runs the old builder in Node, writes down every
 * box and plane it drew, and Blender puts them back with photographed
 * materials (`scripts/blender/world/port.py`). What is left for the browser
 * is this: the lamps and the sky the old builder was tuned for, read from
 * the area's dressing, and the file.
 */

import * as THREE from 'three';
import blackCrown from '../../../../data/world/black-crown.dressing.json';
import crownShop from '../../../../data/world/crown-shop.dressing.json';
import cemetery from '../../../../data/world/old-cemetery.dressing.json';
import station from '../../../../data/world/domino-station.dressing.json';
import plaza from '../../../../data/world/station-plaza.dressing.json';
import high from '../../../../data/world/domino-high.dressing.json';
import towers from '../../../../data/world/central-towers.dressing.json';
import { Owned, type BuiltArea } from './kit';
import { loadArea } from './glb';
import { Sky, ownSky, type SkyOptions } from './sky';
import { GLB_OF } from './files';
import type { AreaId } from '@/story/areas';

interface Dressing {
  lights?: Array<{ x: number; y: number; z: number; colour: string; intensity: number; distance: number }>;
  sky?: SkyOptions | null;
}

const DRESSING: Partial<Record<AreaId, Dressing>> = {
  'black-crown': blackCrown as unknown as Dressing,
  'crown-shop': crownShop as unknown as Dressing,
  'old-cemetery': cemetery as unknown as Dressing,
  'domino-station': station as unknown as Dressing,
  'station-plaza': plaza as unknown as Dressing,
  'domino-high': high as unknown as Dressing,
  'central-towers': towers as unknown as Dressing,
};

export function buildPorted(id: AreaId, anisotropy: number): BuiltArea {
  const dressing = DRESSING[id];
  const url = GLB_OF[id];
  if (!dressing || !url) throw new Error(`${id} is not a ported area`);
  const own = new Owned();
  const root = new THREE.Group();
  root.name = id;

  const lamps: THREE.PointLight[] = [];
  for (const l of dressing.lights ?? []) {
    const light = new THREE.PointLight(l.colour, l.intensity, l.distance, 2);
    light.position.set(l.x, l.y, l.z);
    root.add(light);
    lamps.push(light);
  }

  const s = dressing.sky ?? { reach: 30, half: 30, deep: 30, normalBias: 0.02 };
  const sky = ownSky(own, new Sky(own, root, s));
  sky.claim();

  const ready = loadArea(own, root, url, anisotropy).then(() => undefined);

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

export const buildBlackCrown = (a: number) => buildPorted('black-crown', a);
export const buildCrownShop = (a: number) => buildPorted('crown-shop', a);
export const buildCemetery = (a: number) => buildPorted('old-cemetery', a);
export const buildStation = (a: number) => buildPorted('domino-station', a);
export const buildPlaza = (a: number) => buildPorted('station-plaza', a);
export const buildHigh = (a: number) => buildPorted('domino-high', a);
export const buildTowers = (a: number) => buildPorted('central-towers', a);
