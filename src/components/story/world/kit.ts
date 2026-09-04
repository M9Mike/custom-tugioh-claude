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
  /**
   * The hour, once a frame.
   *
   * An area answers to the clock: where the sun is, what colour it is, and
   * which of its lamps are still burning. Optional only so that an area can be
   * converted without breaking the others — every one of them implements it.
   */
  setTime?(hour: number): void;
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
  /**
   * Every unlit material in the area, so the sky can put them out.
   *
   * A `MeshBasicMaterial` ignores light by definition, which is the whole
   * reason `glow` exists — and the whole reason a lit window keeps burning at
   * noon unless somebody dims it by hand. Collecting them here rather than at
   * each call site means an area cannot forget one: there are sixty-odd of them
   * across six areas and they are written in ones and twos, forty lines apart.
   */
  readonly glows: THREE.MeshBasicMaterial[] = [];
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
/**
 * A base under a whole area, six centimetres down.
 *
 * Every drawn surface in this world is a place somebody walks, and they abut
 * each other exactly, because two floors at one depth is a flicker. Under the
 * *buildings* there was nothing at all — in Black Crown, nineteen thousand
 * square metres of block standing on the void, and smaller patches in Turtle
 * Lane and the street.
 *
 * Nobody can walk there, so `npm run footing` had nothing to say about it: that
 * check tests the cells a duelist can stand on. But you can *see* there. From
 * the top of Black Crown's podium you look over its south edge, across the
 * three quarters of a metre between the podium and the terrace wall, and out
 * into the sky. `npm run seams` drops a ray on every half metre of an area and
 * is the check that found it.
 *
 * One plane under everything is the whole fix, and it is one mesh. Dark, so
 * that wherever it does show it reads as ground in shadow — which is what a
 * strip of paving between a building and a podium actually looks like.
 */
export function basePlate(
  own: Owned,
  root: THREE.Group,
  bounds: { x: number; z: number; hw: number; hd: number },
  colour = '#2b2723',
  /*
   * How far down, and it is six centimetres unless an area digs.
   *
   * Domino Station has four roads a metre and five centimetres below its
   * platforms, drawn with ballast and rail — and every one of them was hidden
   * behind this plane, which is nearer the eye than the trench floor and
   * spans the whole area. Looking across an empty road you saw a flat dark
   * slot six centimetres deep. An area with ground below zero has to put its
   * backstop below that ground.
   */
  y = -0.06
): THREE.Mesh {
  const base = new THREE.Mesh(
    own.keep(new THREE.PlaneGeometry(bounds.hw * 2 + 16, bounds.hd * 2 + 16)),
    matt(own, colour)
  );
  base.rotation.x = -Math.PI / 2;
  base.position.set(bounds.x, y, bounds.z);
  base.receiveShadow = true;
  root.add(base);
  return base;
}

/**
 * One box that went into a merged mesh, in the mesh's own frame:
 * `[minX, minY, minZ, maxX, maxY, maxZ, turned]`.
 *
 * `turned` is 1 when the box was rotated before it was baked, and it matters to
 * exactly one reader. `npm run coplanar` is about *faces*, and the sides of a
 * turned box's bounding box are not its faces — they touch it along an edge.
 * The sweep already skips turned meshes for that reason; without this flag a
 * baked roof slope would come back looking square and every pair of rafters in
 * the shed would be reported as sharing a plane neither of them has.
 */
export type BakedPart = [number, number, number, number, number, number, number];

/**
 * What a merged mesh was made of, written where the checks can read it.
 *
 * ## Why this exists
 *
 * Four of the gates read the scene as *boxes* — `footing` asks what is drawn
 * under a point, `walls` asks what stopped you and whether anything is drawn
 * where you stand, `embedded` asks what is driven into what, `coplanar` asks
 * which faces share a plane — and every one of them takes a mesh's bounding
 * box as its shape. That is exact for a box and a lie for a merge: a hundred
 * light fittings baked into one mesh have a bounding box the size of the
 * building, and a check handed that box believes there is geometry everywhere
 * inside it.
 *
 * Which is the worst failure this toolchain has: not a check that fails, a
 * check that cannot. The seam sweep spent five days reporting "none" because
 * every ray it cast started from a NaN, and this is the same shape of fault
 * waiting to happen the moment an area merges anything.
 *
 * So a builder that merges says what it merged. The checks expand `parts` in
 * place of the mesh's own box and see exactly what they would have seen if
 * nothing had been merged at all — and the area gets its draw calls back for
 * nothing. Domino Station is 1294 calls unmerged and 228 merged.
 */
export function bakedFrom(mesh: THREE.Mesh, parts: BakedPart[]): THREE.Mesh {
  mesh.userData.parts = parts;
  return mesh;
}

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
  const m = own.keep(new THREE.MeshBasicMaterial({ color: colour }));
  own.glows.push(m);
  return m;
}

/**
 * An unlit material that does *not* go out.
 *
 * `glow` is street lighting: the sky dims every one of them towards a fifth by
 * day, because a window burning at noon is the single most obvious way to say
 * "this is a night scene with the brightness turned up". A departure board is
 * not street lighting. It is on at ten in the morning for the same reason the
 * ticket office light is, and drawn as a `glow` it is a black rectangle over
 * the ticket gates at every hour the sun is up.
 *
 * So: unlit, owned, and left out of `Owned.glows`, which is the list the sky
 * walks. The lamp equivalent is `Sky.burning`.
 */
export function lit(own: Owned, colour: string): THREE.MeshBasicMaterial {
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
