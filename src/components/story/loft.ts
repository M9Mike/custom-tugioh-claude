/**
 * The surface engine every part of the duelist is built with.
 *
 * The model used to be spheres and lathes pushed around by Gaussian bumps, and
 * it never stopped reading as a mannequin. The reason is worth writing down,
 * because it decided this file: a bump on a sphere can only ever make a soft
 * mound, and a face is not made of mounds. It is made of *planes* — the flat of
 * the forehead, the shelf of the brow, the wall of the cheek, the corner where
 * the jaw turns. Those are what the eye reads as anatomy, and a displacement
 * field cannot state them, only smudge them.
 *
 * So everything here is lofted instead: a stack of closed cross-sections, each
 * one authored where it belongs, skinned together into a surface. It is how a
 * real game mesh is laid out, and it means the silhouette is something you
 * write down as a table of measurements rather than something you hope falls
 * out of a sum of blobs. A profile you can read is a profile you can correct.
 *
 * Nothing in here knows what a duelist is. It knows rings, quads and caps.
 */

import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/* Profile tables                                                      */
/* ------------------------------------------------------------------ */

/**
 * A keyframed measurement table. Row 0 is always the parameter (height, or
 * distance along a limb); the rest are whatever that part needs — half-width,
 * depth, how square the corner is.
 */
export type Profile = readonly (readonly number[])[];

/**
 * Reads a column of a profile at an arbitrary parameter.
 *
 * Smoothstepped rather than linear between rows. Straight lerping is visible:
 * the surface creases along every keyframe, because the normal changes
 * discontinuously there, and you get a body that looks faceted in exactly the
 * places you were trying to shape. Easing costs one multiply and makes the
 * table a set of *hints* about the curve rather than a set of hard corners.
 */
export function sample(table: Profile, v: number, col: number): number {
  const n = table.length;
  if (v <= table[0][0]) return table[0][col];
  if (v >= table[n - 1][0]) return table[n - 1][col];
  let i = 0;
  while (i < n - 2 && table[i + 1][0] < v) i++;
  const a = table[i];
  const b = table[i + 1];
  const t = (v - a[0]) / (b[0] - a[0]);
  return a[col] + (b[col] - a[col]) * t * t * (3 - 2 * t);
}

/* ------------------------------------------------------------------ */
/* Cross-sections                                                      */
/* ------------------------------------------------------------------ */

/**
 * A point on a superellipse, by azimuth.
 *
 * `a` is measured from straight ahead (+Z) turning towards +X, so 0 is the
 * front of the body, ±π/2 the sides and π the back. Front and back extents are
 * given separately because no part of a person is symmetric front-to-back: a
 * chest is shallow in front of the spine and deep behind it, and a skull is
 * mostly occiput.
 *
 * `n` is the squareness. At 2 this is an honest ellipse; above that the corners
 * push out towards a rounded box, which is what makes a jaw have a *corner* and
 * a ribcage have a front plane instead of both being tubes. It is the single
 * most useful number in the file.
 */
/**
 * How far round from straight ahead a point is, ignoring which side.
 *
 * Rings are generated over `[0, 2π)`, so the left half of a head arrives as
 * azimuths between π and 2π. Taking `Math.abs` of those says a point just left
 * of the nose is 5.9 radians from the front — further round than the back of
 * the skull — and every feature written as "within 0.8 radians of centre" then
 * lands on the right half of the face and nowhere else. This wraps to the
 * signed angle first, which is what makes a face symmetrical.
 */
export const fromFront = (a: number): number => Math.abs(a > Math.PI ? a - Math.PI * 2 : a);

export function sectionPoint(hw: number, front: number, back: number, n: number, a: number) {
  const sa = Math.sin(a);
  const ca = Math.cos(a);
  const p = 2 / n;
  const x = hw * Math.sign(sa) * Math.abs(sa) ** p;
  const z = (ca >= 0 ? front : back) * Math.sign(ca) * Math.abs(ca) ** p;
  return { x, z };
}

/* ------------------------------------------------------------------ */
/* The builder                                                         */
/* ------------------------------------------------------------------ */

const WHITE = new THREE.Color(1, 1, 1);

/**
 * An accumulating mesh.
 *
 * Every piece of the duelist pushes into one of these and hands back a single
 * geometry, which is what keeps the draw-call count on a phone sane: a head is
 * skull, nose, ears and brows in one buffer, not four meshes at four different
 * transforms that then have to agree with each other.
 *
 * Colour is per-vertex and multiplies the material, which is how the face
 * carries lips, sockets, brows and stubble with no texture at all. White means
 * "leave the material alone", so a part that never tints simply never asks.
 */
export class MeshBuilder {
  readonly pos: number[] = [];
  readonly col: number[] = [];
  readonly idx: number[] = [];

  /** Appends a vertex and returns its index. */
  vertex(x: number, y: number, z: number, tint: THREE.Color = WHITE): number {
    const i = this.pos.length / 3;
    this.pos.push(x, y, z);
    this.col.push(tint.r, tint.g, tint.b);
    return i;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  /** Wound so the surface faces outward when the ring azimuth increases. */
  quad(a: number, b: number, c: number, d: number): void {
    this.idx.push(a, b, c, a, c, d);
  }

  /**
   * Skins consecutive rings of equal length into a tube.
   *
   * Rings must run bottom-to-top (or root-to-tip) with azimuth increasing, or
   * the surface comes out inside-out — which on an opaque material shows up as
   * a part that has simply vanished, since you are then looking at its back
   * faces from inside.
   */
  loft(rings: number[][]): void {
    for (let i = 0; i < rings.length - 1; i++) {
      const A = rings[i];
      const B = rings[i + 1];
      const seg = A.length;
      for (let k = 0; k < seg; k++) {
        const k2 = (k + 1) % seg;
        this.quad(A[k], A[k2], B[k2], B[k]);
      }
    }
  }

  /** Fans a ring to a single point. `outward` is +1 for a tip, -1 for a root. */
  cap(ring: number[], apex: number, outward: 1 | -1): void {
    for (let k = 0; k < ring.length; k++) {
      const k2 = (k + 1) % ring.length;
      if (outward === 1) this.tri(ring[k], ring[k2], apex);
      else this.tri(ring[k2], ring[k], apex);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

/* ------------------------------------------------------------------ */
/* Limbs                                                               */
/* ------------------------------------------------------------------ */

/** One cross-section of a limb: how far along, how wide, how deep, how far back. */
export type LimbRow = readonly [t: number, rx: number, rz: number, dz: number];

export interface LimbOptions {
  /** Hangs downward from the origin when true — arms and legs, not necks. */
  down?: boolean;
  /**
   * The slice of the profile to build, as fractions of the whole limb.
   *
   * A trouser leg is the shin from the knee to mid-calf and a boot is the same
   * shin from mid-calf down, and both have to sit at the height the *whole*
   * profile puts them at. Building each from its own 0..1 range instead
   * squeezes an entire leg into half a leg, which is a mistake that looks like
   * a styling choice until you notice the knee is at the ankle.
   */
  from?: number;
  to?: number;
  /** Multiplies every radius. Girth, which is not the same knob as length. */
  scale?: number;
  /** Added after scaling. How a sleeve is the arm underneath it, plus cloth. */
  inflate?: number;
  /** Points around each ring. 18 is plenty for a limb at arm's length. */
  seg?: number;
  /** Squareness, as in `sectionPoint`. Boots and bracers want more than 2. */
  square?: number;
  capRoot?: boolean;
  capTip?: boolean;
}

/**
 * A limb, from a table of cross-sections.
 *
 * The `dz` column is the reason this exists rather than a `LatheGeometry`: a
 * calf is not a bulge on the axis of the shin, it is a mass hung *behind* it,
 * and a bicep sits forward of the humerus. Revolving a profile puts every bulge
 * on the centreline, which is precisely the look of a balloon animal. Letting
 * each ring slide gives the leg an actual back to it.
 */
export function limb(m: MeshBuilder, profile: Profile, length: number, opts: LimbOptions = {}): void {
  const {
    down = true,
    from = 0,
    to = 1,
    scale = 1,
    inflate = 0,
    seg = 18,
    square = 2,
    capRoot = true,
    capTip = true,
  } = opts;
  const dir = down ? -1 : 1;
  const rings: number[][] = [];

  /* Three rings per table row. The in-between rings are what let the smoothstep
     in `sample` actually curve; with rows alone the surface is only as smooth
     as the table is dense. */
  const steps = Math.max(4, Math.round((profile.length - 1) * 3 * (to - from)));
  for (let s = 0; s <= steps; s++) {
    const t = from + (to - from) * (s / steps);
    const rx = sample(profile, t, 1) * scale + inflate;
    const rz = sample(profile, t, 2) * scale + inflate;
    const dz = sample(profile, t, 3) * scale;
    const ring: number[] = [];
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      const q = sectionPoint(rx, rz, rz, square, a);
      ring.push(m.vertex(q.x, dir * t * length, q.z + dz));
    }
    rings.push(ring);
  }

  /* Lofted root-to-tip. When the limb hangs downward the rings descend, which
     reverses the winding, so they are skinned in the other order instead. */
  m.loft(down ? [...rings].reverse() : rings);

  if (capRoot) {
    const r = sample(profile, from, 1) * scale + inflate;
    const apex = m.vertex(0, dir * (from * length - r * 0.4), sample(profile, from, 3) * scale);
    m.cap(rings[0], apex, down ? 1 : -1);
  }
  if (capTip) {
    const r = sample(profile, to, 1) * scale + inflate;
    const apex = m.vertex(0, dir * (to * length + r * 0.4), sample(profile, to, 3) * scale);
    m.cap(rings[rings.length - 1], apex, down ? -1 : 1);
  }
}
