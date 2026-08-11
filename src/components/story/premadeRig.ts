/**
 * Turns a `PremadeCharacter` record into a duelist standing in a scene.
 *
 * The geometry, rig and animations all live in the vendored `.glb` files —
 * this file's whole job is loading one, painting the player's tints into its
 * texture, scaling it to its catalog height, and playing its own clips at the
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
 * - **The default look must be reachable.** Tints of `AS_AUTHORED` reuse the
 *   file's own texture, byte for byte, rather than a repaint that happens to
 *   land close.
 */

import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  AS_AUTHORED,
  modelById,
  paletteFor,
  statureScale,
  hslOfRgb,
  windowCatches,
  type DuelistModel,
  type PremadeCharacter,
} from '@/story/premade';

export interface PremadeRig {
  /** Add this to a scene. Origin between the feet, on the ground. */
  root: THREE.Group;
  /** Metres from the ground to the top of the model, tints and all. */
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
/* Templates: one fetch and one pixel-read per model, ever             */
/* ------------------------------------------------------------------ */

interface Template {
  gltf: GLTF;
  /** Height of the unscaled rest pose, measured once. */
  rawHeight: number;
  /** The atlas pixels of every textured material, for repainting. */
  images: Map<THREE.Texture, ImageData>;
}

const templates = new Map<string, Promise<Template>>();

/** Reads a texture's pixels into an ImageData the repaint can loop over. */
function readPixels(tex: THREE.Texture): ImageData | null {
  const img = tex.image as CanvasImageSource & { width: number; height: number };
  if (!img || !img.width || !img.height) return null;
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, img.width, img.height);
}

/**
 * Loads a model once and shares it with every rig built from it. The booth
 * shows six of these and the world shows one; nobody should be re-fetching
 * two megabytes because a tint changed.
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
    const images = new Map<THREE.Texture, ImageData>();
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const map = (mat as THREE.MeshStandardMaterial).map;
        if (map && !images.has(map)) {
          const px = readPixels(map);
          if (px) images.set(map, px);
        }
      }
    });
    return { gltf, rawHeight, images };
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
/* Repainting                                                          */
/* ------------------------------------------------------------------ */

const hexToRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/**
 * The player's tints, painted into a copy of an atlas.
 *
 * Two passes. The first decides which slot, if any, owns each pixel and takes
 * the mean lightness of everything each slot caught; the second repaints a
 * caught pixel as the chosen swatch scaled by the pixel's own lightness over
 * that mean. Lightness is the painting — the brush strokes, the baked shadow
 * — and scaling by it is what recolours a garment without flattening it. The
 * mean comes from the pixels actually caught in *this* image rather than a
 * number authored per model, so the weapon atlas and the body atlas each keep
 * their own exposure.
 */
function repaint(src: ImageData, model: DuelistModel, tints: number[]): HTMLCanvasElement | null {
  const active = model.tintSlots
    .map((slot, i) => ({ slot, tint: tints[i] ?? AS_AUTHORED }))
    .filter((s) => s.tint !== AS_AUTHORED);
  if (active.length === 0) return null;

  const n = src.width * src.height;
  const px = src.data;
  const owner = new Uint8Array(n).fill(255);
  const lum = new Float32Array(n);
  const sum = new Float64Array(active.length);
  const count = new Uint32Array(active.length);
  for (let p = 0; p < n; p++) {
    const { h, s, l } = hslOfRgb(px[p * 4], px[p * 4 + 1], px[p * 4 + 2]);
    lum[p] = l;
    for (let a = 0; a < active.length; a++) {
      if (windowCatches(active[a].slot.window, h, s, l)) {
        owner[p] = a;
        sum[a] += l;
        count[a] += 1;
        break;
      }
    }
  }

  const out = new ImageData(new Uint8ClampedArray(px), src.width, src.height);
  const target = active.map(({ slot, tint }) => hexToRgb(paletteFor(slot)[tint] as string));
  const ref = active.map((_, a) => (count[a] > 0 ? sum[a] / count[a] : 0.5));
  for (let p = 0; p < n; p++) {
    const a = owner[p];
    if (a === 255) continue;
    const k = lum[p] / ref[a];
    out.data[p * 4] = Math.min(255, target[a][0] * k);
    out.data[p * 4 + 1] = Math.min(255, target[a][1] * k);
    out.data[p * 4 + 2] = Math.min(255, target[a][2] * k);
  }

  const canvas = document.createElement('canvas');
  canvas.width = src.width;
  canvas.height = src.height;
  canvas.getContext('2d')?.putImageData(out, 0, 0);
  return canvas;
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

  /* The clone shares the template's materials; give it its own, repainted
     where the player chose and lit by the scene either way. The files ship
     `KHR_materials_unlit`, which three turns into a material the sun cannot
     touch — flatly wrong in a field with a sun in it, so the map is rehung
     on a standard material instead. Cloth-rough on purpose; the painted
     atlas already carries every highlight the style wants. */
  const disposables: { dispose(): void }[] = [];
  const retinted = new Map<THREE.Texture, THREE.Texture>();
  const materialFor = (old: THREE.Material): THREE.Material => {
    const oldMap = (old as THREE.MeshStandardMaterial).map ?? null;
    let map = oldMap;
    if (oldMap) {
      const cached = retinted.get(oldMap);
      if (cached) {
        map = cached;
      } else {
        const src = template.images.get(oldMap);
        const painted = src ? repaint(src, model, spec.tints) : null;
        if (painted) {
          map = new THREE.CanvasTexture(painted);
          /* glTF textures hang with UV (0,0) at the top; a canvas texture
             defaults to flipping, which would paint every garment on the
             wrong half of the body. */
          map.flipY = false;
          map.colorSpace = THREE.SRGBColorSpace;
          disposables.push(map);
        }
        retinted.set(oldMap, map as THREE.Texture);
      }
    }
    const mat = new THREE.MeshStandardMaterial({ map, roughness: 1, metalness: 0 });
    disposables.push(mat);
    return mat;
  };
  body.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
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
      /* Materials and repainted textures are this rig's own; the geometry and
         the file's original textures belong to the template and outlive it. */
      for (const d of disposables) d.dispose();
    },
  };
}
