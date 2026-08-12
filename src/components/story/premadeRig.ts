/**
 * Turns a `PremadeCharacter` record into a duelist standing in a scene.
 *
 * The geometry, rig and animations all live in the vendored `.glb` files —
 * this file's whole job is loading one, colouring the materials the player
 * tinted, scaling it to its catalog height, and playing its own clips at the
 * speed the ground is actually moving. It is the heir to `humanoid.ts`'s
 * `buildCharacter`, and it keeps the same shape of seam: a root to add to a
 * scene, one call per frame, a dispose. What changed is where the walking
 * comes from — a clip authored with the model, not a pose function — and that
 * building one is asynchronous, because there is a file to fetch.
 *
 * Three rules carried over from the old system, because they are not about
 * meshes, they are about walking:
 *
 * - **Feet must not slide.** The clip covers `walkSpeed` metres of ground per
 *   second at playback rate 1 (a catalog number, tuned by photograph), so the
 *   playback rate is real ground speed divided by that. One speed, both
 *   derived from it — the same arithmetic `gaitRate` wrote down.
 * - **Nothing here advances by `time × rate`.** The mixer is fed `dt` and
 *   integrates its own clock, which is what a mixer is.
 * - **The default look must be reachable.** Tints of `AS_AUTHORED` keep the
 *   file's own material colour, exactly, rather than a swatch that happens to
 *   land close.
 *
 * Tinting is a material recolour and nothing more: these models have no
 * textures, every part is a named flat-colour material, and a slot names the
 * materials it owns (`src/story/premade.ts`). Skin and faces are materials no
 * slot may name, so a tint cannot touch them by construction.
 */

import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  AS_AUTHORED,
  modelById,
  paletteFor,
  statureScale,
  type PremadeCharacter,
} from '@/story/premade';

export interface PremadeRig {
  /** Add this to a scene. Origin between the feet, on the ground. */
  root: THREE.Group;
  /** Metres from the ground to the top of the model, stature and all. */
  height: number;
  /**
   * Advances the duelist.
   *
   * @param dt          seconds since the last call
   * @param stride      0 standing, 1 full pace; blended, not switched
   * @param groundSpeed how fast the root is actually crossing the field, in
   *                    metres a second — what keeps the clip's feet honest
   */
  update(dt: number, stride: number, groundSpeed: number): void;
  dispose(): void;
}

/* ------------------------------------------------------------------ */
/* Templates: one fetch per model, ever                                */
/* ------------------------------------------------------------------ */

interface Template {
  gltf: GLTF;
  /** Height of the unscaled rest pose, measured once. */
  rawHeight: number;
}

const templates = new Map<string, Promise<Template>>();

/**
 * Loads a model once and shares it with every rig built from it. The booth
 * shows twelve of these and the world shows one; nobody should be re-fetching
 * a megabyte because a tint changed.
 */
export function loadDuelistTemplate(modelId: string): Promise<Template> {
  const model = modelById(modelId);
  const cached = templates.get(model.id);
  if (cached) return cached;
  const promise = new GLTFLoader().loadAsync(model.file).then((gltf) => {
    /* Measured before any scaling: the catalog stores a target height in
       metres, and the file's own units are whatever Blender left them as. */
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const rawHeight = Math.max(0.01, box.max.y - box.min.y);
    return { gltf, rawHeight };
  });
  templates.set(model.id, promise);
  /* A failed fetch must not poison the cache for the retry. */
  promise.catch(() => templates.delete(model.id));
  return promise;
}

/** Warms the cache so the booth can flick between models without a stall. */
export function preloadAllDuelists(): void {
  import('@/story/premade').then(({ DUELIST_MODELS }) => {
    for (const m of DUELIST_MODELS) void loadDuelistTemplate(m.id).catch(() => {});
  });
}

/* ------------------------------------------------------------------ */
/* The rig                                                             */
/* ------------------------------------------------------------------ */

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Builds a rig for one duelist. Asynchronous because the model may still be
 * coming down; everything after the fetch is a few milliseconds.
 */
export async function buildPremadeRig(spec: PremadeCharacter): Promise<PremadeRig> {
  const model = modelById(spec.model);
  const template = await loadDuelistTemplate(model.id);

  const body = cloneSkeleton(template.gltf.scene);

  /* Which colour each material name ends up, per the player's tints. */
  const tinted = new Map<string, string>();
  model.tintSlots.forEach((slot, i) => {
    const tint = spec.tints[i] ?? AS_AUTHORED;
    if (tint === AS_AUTHORED) return;
    const hex = paletteFor(slot)[tint];
    for (const name of slot.materials) tinted.set(name, hex);
  });

  /* The clone shares the template's materials; give it its own, recoloured
     where the player chose and lit by the scene either way. Rebuilt as
     cloth-rough standard materials on purpose: the files ship PBR defaults
     tuned for nothing in particular, and the game's two scenes both light a
     matte duelist well. `AS_AUTHORED` keeps the file's own colour value,
     untouched. */
  const disposables: { dispose(): void }[] = [];
  const cache = new Map<THREE.Material, THREE.Material>();
  const materialFor = (old: THREE.Material): THREE.Material => {
    const hit = cache.get(old);
    if (hit) return hit;
    const source = old as THREE.MeshStandardMaterial;
    const hex = tinted.get(old.name);
    const mat = new THREE.MeshStandardMaterial({
      color: hex ? new THREE.Color(hex) : source.color?.clone() ?? new THREE.Color('#888888'),
      roughness: 1,
      metalness: 0,
    });
    mat.name = old.name;
    cache.set(old, mat);
    disposables.push(mat);
    return mat;
  };
  /* Cloning a skinned mesh clones its skeleton, and a skeleton owns a GPU
     bone texture of its own — one leak per tint change if nobody collects
     them. Shared between meshes, so a set, not a list. */
  const skeletons = new Set<THREE.Skeleton>();
  body.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const skinned = o as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh) skeletons.add(skinned.skeleton);
    mesh.castShadow = true;
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(materialFor)
      : materialFor(mesh.material);
    /* The rest pose's bounds are meaningless once the clips start moving the
       bones, and a skinned mesh culled by them vanishes at the edge of the
       screen mid-stride. */
    mesh.frustumCulled = false;
  });

  const scale = (model.height * statureScale(spec.stature)) / template.rawHeight;
  body.scale.setScalar(scale);

  const root = new THREE.Group();
  root.add(body);

  /* ---- animation ---- */

  const mixer = new THREE.AnimationMixer(body);
  const action = (name: string): THREE.AnimationAction | null => {
    const clip = THREE.AnimationClip.findByName(template.gltf.animations, name);
    if (!clip) return null;
    const a = mixer.clipAction(clip);
    a.play();
    return a;
  };
  /* Every model in the pack ships all three; `null` only if one is ever
     swapped for a file that does not, in which case standing still beats
     crashing the world. */
  const idle = action('Idle');
  const walk = action('Walk');
  const run = action('Run');

  const update = (dt: number, stride: number, groundSpeed: number) => {
    /* Moving-ness and running-ness, each eased so the blend has no seams.
       The run blend starts where a brisk walk stops looking like walking. */
    const moving = smoothstep(0.03, 0.3, stride);
    const running = smoothstep(0.62, 0.92, stride);
    idle?.setEffectiveWeight(1 - moving);
    walk?.setEffectiveWeight(moving * (1 - running));
    run?.setEffectiveWeight(moving * running);
    /* Feet: playback rate is ground speed over the clip's own speed. Held at
       1 when standing so the last steps of a stop do not freeze mid-air. */
    walk?.setEffectiveTimeScale(groundSpeed > 0.01 ? groundSpeed / model.walkSpeed : 1);
    run?.setEffectiveTimeScale(groundSpeed > 0.01 ? groundSpeed / model.runSpeed : 1);
    mixer.update(dt);
  };
  /* Settle into the rest of the idle immediately rather than showing one
     frame of T-pose while the first `update` is still a frame away. */
  update(0, 0, 0);

  return {
    root,
    height: model.height * statureScale(spec.stature),
    update,
    dispose() {
      mixer.stopAllAction();
      /* Materials and skeletons are this rig's own; the geometry belongs to
         the template and outlives it. */
      for (const d of disposables) d.dispose();
      for (const s of skeletons) s.dispose();
    },
  };
}
