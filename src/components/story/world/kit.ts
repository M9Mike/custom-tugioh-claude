/**
 * The handful of things every area is built out of.
 *
 * `shop.ts` and `street.ts` each grew their own copy of `Owned`, `box`, `matt`
 * and `surfaceOf` — identical code, written twice, because the second area was
 * written by looking at the first. That is survivable at two. Market Row would
 * have made it three, and three copies of a helper is the point at which one of
 * them quietly stops matching the others: a shadow flag set in one and not the
 * rest, a `roughness` corrected in the file somebody happened to have open.
 *
 * So they live here, once, and every area imports them. Nothing in this file
 * knows anything about any particular place — it is the shading and the
 * bookkeeping that the whole world agrees on, and nothing else.
 */

import * as THREE from 'three';
import { tile } from './surfaces';

export interface BuiltArea {
  /** Added to the scene as one object, removed as one object. */
  root: THREE.Group;
  /** Lights belong to the area and are torn down with it. */
  dispose(): void;
}

/**
 * Everything an area owns, so nothing leaks when you walk out of it.
 *
 * Geometries, materials and textures are GPU resources that the garbage
 * collector cannot see. Dropping the last reference to a mesh frees the
 * JavaScript object and leaves the buffer on the card, so an area that is
 * entered and left twenty times leaks twenty arcades' worth of vertex data.
 * Everything made goes through `keep`, and leaving the area disposes the lot.
 */
export class Owned {
  readonly items: { dispose(): void }[] = [];
  keep<T extends { dispose(): void }>(x: T): T {
    this.items.push(x);
    return x;
  }
}

/**
 * A box, with the shading the whole world uses.
 *
 * `roughness: 1` and `metalness: 0` across the board on purpose: the scene is
 * lit by a handful of point and directional lights with no environment map, and
 * anything shiny in that setup goes black rather than glossy. Matte reads
 * correctly under every light in this game, which is the only test that matters.
 */
export function box(
  own: Owned,
  w: number, h: number, d: number,
  material: THREE.Material,
  x: number, y: number, z: number,
  rotY = 0
): THREE.Mesh {
  const geo = own.keep(new THREE.BoxGeometry(w, h, d));
  const metres = material.userData?.tile as number | undefined;
  if (metres) scaleBoxUVs(geo, w, h, d, metres);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotY;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * A texture from one of the `surfaces` drawers, tiled and owned in one step.
 *
 * The drawers return null when the browser will not hand over a 2D context, and
 * that null has to survive all the way to the material — a flat colour is a
 * perfectly good floor, and a thrown error is a black screen. So this keeps the
 * texture only when there is one, and passes the null straight through.
 */
export function surfaceOf(
  own: Owned,
  make: () => THREE.Texture | null,
  rx: number, ry: number, anisotropy: number
): THREE.Texture | null {
  const tex = make();
  if (!tex) return null;
  own.keep(tex);
  return tile(tex, rx, ry, anisotropy);
}

export function matt(
  own: Owned,
  colour: string,
  map?: THREE.Texture | null
): THREE.MeshStandardMaterial {
  return own.keep(new THREE.MeshStandardMaterial({
    color: colour,
    map: map ?? null,
    roughness: 1,
    metalness: 0,
  }));
}

/**
 * A material for anything laid flat *on* another surface — road markings, bills,
 * posters, painted lettering on a floor.
 *
 * `polygonOffset` biases the fragment's depth away from the camera by a hair, so
 * a decal and the thing it is painted on can never resolve to the same depth
 * value and strobe against each other as the camera moves. Tightening the near
 * and far planes (see `OpenWorld`) removes almost all of the risk; this removes
 * the rest, and costs nothing.
 */
export function decal(own: Owned, colour: string): THREE.MeshStandardMaterial {
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
export function glow(own: Owned, colour: string): THREE.MeshBasicMaterial {
  return own.keep(new THREE.MeshBasicMaterial({ color: colour }));
}

/** Deterministic, so an area is the same place every time it is entered. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* Masonry                                                             */
/* ------------------------------------------------------------------ */

/**
 * How much wall one tile of a masonry texture covers, in metres.
 *
 * One number for the whole world, which is the entire point — see `tiled`.
 */
export const MASONRY_TILE = 3.0;

/**
 * Marks a material as covering a fixed size in metres rather than a fixed
 * fraction of whatever it lands on.
 *
 * ## The bug this exists to kill
 *
 * `BoxGeometry` gives every face UVs from 0 to 1, so a texture with
 * `repeat.set(3, 2.2)` puts three tiles across a face **whatever size that face
 * is**. A terrace 8 m wide and a block 4 m wide, skinned with the same brick,
 * come out with bricks at half the size on one of them. Worse, one box's own
 * faces disagree: the same block is 4 m through and 7.3 m across, so its side
 * and its front are bricked at different scales.
 *
 * The whole street was built like that and it shows exactly where two of them
 * meet — the wall either side of the Market Row arch is a different brick from
 * the wall it joins, which is what Mike saw. Trimming those blocks made it worse
 * because it changed their size, and changing their size changed their bricks.
 *
 * With this, a material declares the size of its tile in metres and `box` scales
 * each face's UVs by that face's real dimensions. Every brick in Domino City is
 * then the same brick, and stays the same brick when a wall is resized.
 */
export function tiled<T extends THREE.Material>(material: T, metres = MASONRY_TILE): T {
  material.userData.tile = metres;
  return material;
}

/**
 * Rewrites a box's UVs so one tile covers `metres` of real surface.
 *
 * `BoxGeometry` lays its faces out in a fixed order — +X, −X, +Y, −Y, +Z, −Z,
 * four vertices each — and each face's U runs along one axis and V along
 * another. Which two depends on the face, so the scale factors do too.
 */
export function scaleBoxUVs(
  geo: THREE.BoxGeometry,
  w: number, h: number, d: number,
  metres: number
): void {
  const uv = geo.getAttribute('uv');
  if (!uv || uv.count < 24) return;
  const spans: [number, number][] = [
    [d, h], [d, h],   // ±X: across the depth, up the height
    [w, d], [w, d],   // ±Y: across the width, along the depth
    [w, h], [w, h],   // ±Z: across the width, up the height
  ];
  for (let face = 0; face < 6; face++) {
    const [su, sv] = spans[face];
    for (let i = 0; i < 4; i++) {
      const k = face * 4 + i;
      uv.setXY(k, uv.getX(k) * (su / metres), uv.getY(k) * (sv / metres));
    }
  }
  uv.needsUpdate = true;
}
