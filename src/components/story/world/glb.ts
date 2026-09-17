/**
 * An area built in Blender, loaded into the world.
 *
 * `scripts/world/build.mjs` turns `areas.ts` and a dressing file into
 * `public/models/world/<area>.glb`; this is the other end. What arrives is
 * geometry and materials only — no lights, which an area keeps in its own
 * builder so the lamp budget and the sky see them the moment the area opens,
 * before a single byte of the file has landed.
 *
 * Three things the loader has to do that a plain `GLTFLoader.load` does not:
 *
 * - **Own everything.** Every geometry, material and texture in the file is
 *   handed to the area's `Owned`, so leaving the area disposes the lot. The
 *   garbage collector cannot see a texture on the card.
 * - **Hand the checks what was baked.** Blender joins boxes of one material
 *   into one mesh and writes what it joined as `parts` extras — a JSON string,
 *   because a glTF extra cannot carry a nested array. It is parsed here into
 *   the `BakedPart` list `footing`, `walls`, `embedded` and `coplanar` read,
 *   and the mesh's transform is baked into its vertices so those parts, which
 *   are in area metres, are in the mesh's own frame as the checks expect.
 * - **Say when it is there.** The builder returns at once with an empty root
 *   and a promise; `OpenWorld` reports `ready` on the probe from it and every
 *   check waits for the room before it looks at it.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { Owned } from './kit';

let loader: GLTFLoader | null = null;
function gltfLoader(): GLTFLoader {
  if (!loader) {
    loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
  }
  return loader;
}

const TEXTURE_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap'] as const;

export interface LoadedArea {
  /** The hash of the collision the file was built from, from its scene extras. */
  layoutHash: string | null;
  meshes: number;
}

/**
 * Loads the area's file under `root`, owning what it brings.
 */
export async function loadArea(own: Owned, root: THREE.Group, url: string, anisotropy: number): Promise<LoadedArea> {
  const gltf = await gltfLoader().loadAsync(url);
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  let meshes = 0;
  const seenMaterials = new Set<THREE.Material>();
  const seenTextures = new Set<THREE.Texture>();
  const baked: THREE.Mesh[] = [];
  /* How many meshes share each geometry — the optimiser deduplicates
     identical geometry, so fifteen bills of one size arrive as one. */
  const users = new Map<THREE.BufferGeometry, number>();
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    meshes += 1;
    users.set(mesh.geometry, (users.get(mesh.geometry) ?? 0) + 1);
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    /* A picture with holes in it — a tree on two crossed planes — is a mask in
       the file, and a mask alone left the holes filled with the picture's
       background in the software renderer the checks draw with. So it is
       blended *and* cut: blended, the empty texels vanish whatever the
       renderer; cut at half, the depth and shadow passes still see a tree
       and not a card. */
    for (const m of mats) {
      if (m.alphaTest > 0) {
        m.transparent = true;
        m.depthWrite = true;
      }
    }
    /* A shadow map is opaque: a pane of glass that casts one is a wall to the
       daylight, and the shop's window let nothing in at noon. A cut picture
       casts the shadow of what is left of it. */
    mesh.castShadow = !mats.some((m) => m.transparent && !(m.alphaTest > 0));
    mesh.receiveShadow = true;
    own.keep(mesh.geometry);
    for (const m of mats) {
      if (seenMaterials.has(m)) continue;
      seenMaterials.add(m);
      own.keep(m);
      const std = m as THREE.MeshStandardMaterial;
      if (std.emissive && std.emissiveIntensity > 0 && (std.emissive.r > 0 || std.emissive.g > 0 || std.emissive.b > 0)) {
        own.emissives.push({ material: std, full: std.emissiveIntensity });
      }
      for (const slot of TEXTURE_SLOTS) {
        const tex = std[slot] as THREE.Texture | null | undefined;
        if (!tex || seenTextures.has(tex)) continue;
        seenTextures.add(tex);
        own.keep(tex);
        tex.anisotropy = anisotropy;
      }
    }
    const parts = mesh.userData.parts;
    if (typeof parts === 'string') {
      try {
        mesh.userData.parts = JSON.parse(parts);
        baked.push(mesh);
      } catch {
        delete mesh.userData.parts;
      }
    }
  });
  /* A baked mesh's parts are written in area metres. If the exporter left a
     transform on the node, fold it into the vertices so the parts and the
     geometry agree in one frame — the checks multiply parts by the mesh's own
     matrix, and that matrix must then be the identity. */
  for (const mesh of baked) {
    mesh.updateMatrixWorld(true);
    const m = mesh.matrixWorld;
    const identity = m.elements.every((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) < 1e-9);
    if (identity) continue;
    /* A shared geometry is baked on a copy of the *pristine* one, by every
       mesh that shares it. Baking the first in place and cloning after it
       gave the second bill the first bill's transform under its own, and
       fifteen bills of one size on a hoarding all went missing. */
    if ((users.get(mesh.geometry) ?? 0) > 1) {
      mesh.geometry = own.keep(mesh.geometry.clone());
    }
    /* Meshopt keeps positions as normalised 16-bit integers and puts the
       scale on the node. Multiplying that attribute by a matrix in metres
       clamps every coordinate to ±1 — the whole room came back as unit cubes
       at the origin — so it is widened to floats first. */
    const pos = mesh.geometry.getAttribute('position');
    if (!(pos.array instanceof Float32Array) || pos.normalized) {
      const wide = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        wide[i * 3] = pos.getX(i);
        wide[i * 3 + 1] = pos.getY(i);
        wide[i * 3 + 2] = pos.getZ(i);
      }
      mesh.geometry.setAttribute('position', new THREE.BufferAttribute(wide, 3));
    }
    mesh.geometry.applyMatrix4(m);
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
    mesh.removeFromParent();
    mesh.position.set(0, 0, 0);
    mesh.quaternion.identity();
    mesh.scale.set(1, 1, 1);
    root.add(mesh);
  }
  root.add(scene);
  const extras = scene.userData as { layoutHash?: string };
  return { layoutHash: extras.layoutHash ?? null, meshes };
}
