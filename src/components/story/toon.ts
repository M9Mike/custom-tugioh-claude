/**
 * The look: cel shading and ink lines.
 *
 * The duelist is drawn the way an anime game draws a character, because that
 * is what it is. Two decisions carry the whole style, and both live here so
 * every part of the body states them the same way:
 *
 * - **Stepped light.** `MeshToonMaterial` with a generated three-step ramp:
 *   one shadow tone, one mid, one lit. A surface is either in the light or it
 *   is not, and the terminator is a drawn line rather than a fade. This is
 *   the single change that moves the model from "mannequin" to "character" —
 *   smooth shading *reports* form, stepped shading *states* it.
 *
 * - **Ink outlines.** Every silhouette wears a dark line, built as an
 *   inverted hull: the same geometry pushed out along its normals and drawn
 *   back-face only, so it is visible exactly where the surface turns away.
 *   No post-processing, no second camera, works on every generated mesh.
 *
 * The ramp is a 4×1 texture generated in code — the one texture in the whole
 * duelist, and it never leaves this module. Everything else is still vertex
 * colour on generated geometry.
 */

import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/* The ramp                                                            */
/* ------------------------------------------------------------------ */

let ramp: THREE.DataTexture | null = null;

/**
 * Two tones, exactly.
 *
 * The reference frames this whole style draws with one shadow tone and one
 * lit tone per surface — the three-step ramp this shipped with was already a
 * step too painterly, and the mid-band read as airbrushing on every face.
 * The shadow sits at 0.66: a colour choice, not darkness.
 */
function toonRamp(): THREE.DataTexture {
  if (ramp) return ramp;
  const steps = [0.66, 0.66, 0.66, 1.0, 1.0, 1.0];
  const data = new Uint8Array(steps.length * 4);
  steps.forEach((s, i) => {
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = Math.round(s * 255);
    data[i * 4 + 3] = 255;
  });
  ramp = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
  ramp.needsUpdate = true;
  /* Nearest is the point: the steps must be steps. */
  ramp.magFilter = THREE.NearestFilter;
  ramp.minFilter = THREE.NearestFilter;
  return ramp;
}

export interface ToonOptions {
  /** Per-vertex tinting — the face paints itself through this. */
  vertexColors?: boolean;
  /** A little specular pop for metal trim; plain cloth leaves it off. */
  shiny?: boolean;
}

/** A cel-shaded material in the duelist's shared ramp. */
export function toonMat(color: THREE.Color | string, opts: ToonOptions = {}): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({
    color: color instanceof THREE.Color ? color : new THREE.Color(color),
    gradientMap: toonRamp(),
    vertexColors: opts.vertexColors ?? false,
  });
}

/* ------------------------------------------------------------------ */
/* The ink                                                             */
/* ------------------------------------------------------------------ */

/**
 * Not pure black: ink over a warm palette wants to be warm, and true black
 * outlines flicker against the dark booth backdrop. One material for every
 * line on the model, so the line weight is a *style*, not a per-part choice.
 */
const INK = new THREE.Color('#241a1c');

/**
 * The inverted hull for a geometry: every vertex pushed `offset` metres out
 * along its (already computed) normal. Drawn back-face only, it is the
 * geometry's own silhouette line, exactly as thick as the push.
 */
export function outlineGeometry(geo: THREE.BufferGeometry, offset: number): THREE.BufferGeometry {
  const src = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const pos = new Float32Array(src.count * 3);
  for (let i = 0; i < src.count; i++) {
    pos[i * 3] = src.getX(i) + nrm.getX(i) * offset;
    pos[i * 3 + 1] = src.getY(i) + nrm.getY(i) * offset;
    pos[i * 3 + 2] = src.getZ(i) + nrm.getZ(i) * offset;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (geo.index) out.setIndex(geo.index.clone());
  return out;
}

/**
 * Adds the ink line for a mesh to its parent, sharing the mesh's transform.
 *
 * The hull is **unnamed** on purpose: the clash audit reads mesh names to
 * know what is a limb and what is a body, and a hull is neither — it is a
 * drawing of the thing, two millimetres bigger than the thing, and letting
 * the audit see it would report every part two millimetres inside its own
 * outline.
 */
export function addOutline(
  parent: THREE.Object3D,
  geo: THREE.BufferGeometry,
  offset: number,
  keep: <T extends { dispose(): void }>(x: T) => T
): THREE.Mesh {
  const hull = keep(outlineGeometry(geo, offset));
  const mat = keep(new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide }));
  const mesh = new THREE.Mesh(hull, mat);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  parent.add(mesh);
  return mesh;
}
