/**
 * Which areas are files, and where.
 *
 * An area built in Blender (`npm run world -- <area>`) is a GLB under
 * `public/models/world/`, loaded when the area is entered. This is the one
 * list of them, read by the door transition to warm the browser's cache
 * with the areas behind every door of the one you are standing in — so the
 * next door opens on a file that is already here. `npm run drawn` holds it
 * to naming every dressing there is.
 */

import { AREAS, type AreaId } from '../../../story/areas';

export const GLB_OF: Partial<Record<AreaId, string>> = {
  'grandpa-shop': '/models/world/grandpa-shop.glb',
  'starting-area': '/models/world/starting-area.glb',
  'market-row': '/models/world/market-row.glb',
  'step-lane': '/models/world/step-lane.glb',
  'domino-shrine': '/models/world/domino-shrine.glb',
  'black-crown': '/models/world/black-crown.glb',
  'crown-shop': '/models/world/crown-shop.glb',
  'old-cemetery': '/models/world/old-cemetery.glb',
  'domino-station': '/models/world/domino-station.glb',
  'station-plaza': '/models/world/station-plaza.glb',
  'domino-high': '/models/world/domino-high.glb',
  'central-towers': '/models/world/central-towers.glb',
};

const warmed = new Set<string>();

/**
 * Fetch the files of every area a door of this one leads to, when the
 * browser has a moment. The response is read to the end so the cache holds
 * all of it; a failure forgets the URL so the next area asks again.
 */
export function prefetchAround(id: AreaId): void {
  if (typeof window === 'undefined') return;
  const go = () => {
    for (const door of AREAS[id].doors) {
      const url = GLB_OF[door.to];
      if (!url || warmed.has(url)) continue;
      warmed.add(url);
      fetch(url).then((r) => r.arrayBuffer()).catch(() => warmed.delete(url));
    }
  };
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(go, { timeout: 4000 });
  else window.setTimeout(go, 1500);
}
