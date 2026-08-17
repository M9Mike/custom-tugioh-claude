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
 *
 * ## Two kinds of file come through here
 *
 * The rigged ones — the vendored roster and the 3DS rips — are the case
 * everything above describes. The **sculpted cast** is not: single static
 * meshes with no skeleton, no skin and no clips (see
 * `scripts/import-sculpt.mjs`). They are supported rather than special-cased,
 * and it is worth being clear about what that costs and what it buys.
 *
 * It buys one seam. `OpenWorld` builds an NPC the same way whichever kind it
 * is, so placement, the turn-to-look, the talk range and the conversation
 * camera are all written once. Three things bend to allow it: the floor is
 * measured from the bounding box rather than from the idle pose, frustum
 * culling stays on, and the three clip actions come back null.
 *
 * What it costs is that a sculpt **does not move**. It does not breathe, it
 * does not walk, and if one were ever driven by the stick it would slide
 * across the field in a fixed pose. That is a property of the files, not of
 * this code — nothing here can invent a skeleton — and it is the reason the
 * sculpts are NPCs who stand and talk rather than duelists who walk.
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
  type RepaintRule,
} from '@/story/premade';
import { buildAccessory, headFor, type AccessorySpec } from './accessories';
import { repaintTexture } from './repaint';

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
  /**
   * Where this model's feet actually are once it is standing, in file units.
   *
   * Not zero, and not the same twice. A rig is placed with its origin on the
   * ground, which assumes the origin is between the feet — true of the rest
   * pose, and false of every one of these models the moment the Idle clip
   * runs. The rips carry their own root motion: the four real duelists are
   * within 1% of the ground, the generic townspeople stand 4–9% of their own
   * height *below* it, and `boy1` hovers 4% above.
   *
   * Mai was the one that showed, because she is at 9% and stands next to Yugi,
   * who is at 0.1%. Correcting the clips would mean re-cutting every import
   * against a baseline the source game never promised; measuring where the
   * feet end up and lifting the model by that is one number per file and
   * cannot drift out of step with the animation.
   */
  floor: number;
}

/**
 * The lowest point the model reaches while standing.
 *
 * Measured on a clone, deliberately: posing the template's own scene would
 * leave its bones out of the rest pose, and every rig built afterwards is
 * cloned from it — one measurement would bend the whole cast.
 *
 * Sampled rather than exhaustive. A few hundred vertices across a handful of
 * moments through the clip finds the planted foot; the idle on these models is
 * a breath and a weight shift, so nothing is hiding between the samples.
 *
 * **A model with no Idle is measured where it stands.** The sculpted cast
 * (`scripts/import-sculpt.mjs`) has no skeleton and no clips, so there is no
 * pose to sample and nothing that will ever move it — its own bounding box is
 * not an approximation of the answer, it *is* the answer. This used to return
 * zero for that case, which assumed the origin sat between the feet; those
 * models are normalised into a box centred on the origin instead, so the whole
 * cast would have stood buried to the waist.
 */
function restingFloor(gltf: GLTF): number {
  const idle = gltf.animations.find((a) => a.name === 'Idle');

  const scene = cloneSkeleton(gltf.scene);
  const skinned: THREE.SkinnedMesh[] = [];
  scene.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh);
  });
  if (!idle || !skinned.length) {
    return new THREE.Box3().setFromObject(gltf.scene).min.y;
  }

  const mixer = new THREE.AnimationMixer(scene);
  mixer.clipAction(idle).play();
  const at = new THREE.Vector3();
  let lowest = Infinity;
  const MOMENTS = 6;
  for (let i = 0; i < MOMENTS; i++) {
    mixer.setTime((idle.duration * i) / MOMENTS);
    scene.updateMatrixWorld(true);
    for (const mesh of skinned) {
      const count = mesh.geometry.attributes.position.count;
      const step = Math.max(1, Math.floor(count / 400));
      for (let v = 0; v < count; v += step) {
        mesh.getVertexPosition(v, at);
        mesh.localToWorld(at);
        if (at.y < lowest) lowest = at.y;
      }
    }
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(scene);
  return Number.isFinite(lowest) ? lowest : 0;
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
    return { gltf, rawHeight, floor: restingFloor(gltf) };
  });
  templates.set(model.id, promise);
  /* A failed fetch must not poison the cache for the retry. */
  promise.catch(() => templates.delete(model.id));
  return promise;
}

/** Warms the cache so the booth can flick between models without a stall. */
export function preloadAllDuelists(): void {
  /* Only what the booth shows: the named characters are megabytes nobody
     picking a duelist is about to look at. */
  import('@/story/premade').then(({ BOOTH_MODELS }) => {
    for (const m of BOOTH_MODELS) void loadDuelistTemplate(m.id).catch(() => {});
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
 * What an *authored* character may do on top of what the booth offers.
 *
 * The booth's tint slots exist to constrain the player: three garments, a
 * palette each, and the face out of reach. A character somebody wrote down
 * is under no such constraint — they are meant to look like a particular
 * person — so they may repaint any material in the file by name, and hide
 * one outright.
 *
 * Hiding is why this is not just "more tints": the closest model to an old
 * shopkeeper on the roster is a king, and a king is only a king because of
 * the crown. The crown shares a mesh with his head, so it cannot be removed
 * by hiding a node — but it has a material of its own, and a material can be
 * made to draw nothing.
 */
export interface RigOptions {
  /**
   * Material name → hex to paint it, or `null` to make it invisible.
   * Applied after the record's own tints, so an override wins.
   */
  overrides?: Record<string, string | null>;
  /** Generated props hung off named bones — see `accessories.ts`. */
  accessories?: AccessorySpec[];
  /**
   * Colour in the model's texture → colour to repaint it, for the models that
   * carry their look in an image. The texture's answer to `overrides`.
   */
  repaint?: Record<string, RepaintRule>;
  /** Bone name → local scale, for a character built unlike the body they wear. */
  build?: Record<string, [number, number, number]>;
}

/**
 * Builds a rig for one duelist. Asynchronous because the model may still be
 * coming down; everything after the fetch is a few milliseconds.
 */
/**
 * Gives one character a different build from the body they share.
 *
 * The roster is a dozen bodies and a cast much larger than that, so two
 * characters who are nothing alike end up on the same mesh. Solomon Muto is
 * short and stout and Mai Valentine is a grown woman; the generic adults they
 * are cast on are neither. Scaling a bone scales the skin weighted to it, so
 * naming a bone and a factor reshapes that segment and nothing else.
 *
 * **The children are put back.** A bone's scale runs down the hierarchy, so
 * widening a ribcage would also widen the arms hanging off it and push the head
 * up and out — the classic result being a barrel-chested man with balloon hands
 * and a hat three sizes too big. Each direct child has the factor divided back
 * out of both its scale and its position, so it keeps its size and stays where
 * it was. What changes is the one segment asked for.
 *
 * The two passes are not tidiness. A build usually names a chain — hips, then
 * spine, then chest — and doing each bone completely before starting the next
 * lets the second overwrite the correction the first just applied to it, so
 * the factors multiply down the chain instead of standing alone. Grandpa's
 * head came out 1.6× that way. Setting every scale first and correcting
 * afterwards leaves each named bone at exactly the factor it asked for.
 *
 * Applied to the rest pose, before any clip runs, because the clips animate
 * rotations and positions rather than scale and so leave this alone.
 */
function reshape(body: THREE.Object3D, build: Record<string, [number, number, number]>): void {
  const bones = new Map<string, THREE.Object3D>();
  body.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.set(o.name, o);
  });

  for (const [name, [x, y, z]] of Object.entries(build)) {
    const bone = bones.get(name);
    if (!bone) throw new Error(`build names a bone this model does not have: ${name}`);
    bone.scale.set(x, y, z);
  }

  for (const [name, [x, y, z]] of Object.entries(build)) {
    for (const child of bones.get(name)!.children) {
      if (!(child as THREE.Bone).isBone) continue;
      child.scale.set(child.scale.x / x, child.scale.y / y, child.scale.z / z);
      child.position.set(child.position.x / x, child.position.y / y, child.position.z / z);
    }
  }
}

export async function buildPremadeRig(
  spec: PremadeCharacter,
  options: RigOptions = {}
): Promise<PremadeRig> {
  const model = modelById(spec.model);
  const template = await loadDuelistTemplate(model.id);

  const body = cloneSkeleton(template.gltf.scene);

  /*
   * The textured models take their tints on the texture rather than on the
   * material, so the choices are resolved here and applied per-map below.
   * `null` for a slot means as-authored.
   */
  const paint = (model.textureTints ?? []).map((slot, i) => {
    const tint = spec.tints[i] ?? AS_AUTHORED;
    return tint === AS_AUTHORED ? null : paletteFor(slot)[tint] ?? null;
  });
  const repainted = new Map<THREE.Texture, THREE.Texture>();

  /* Which colour each material name ends up, per the player's tints. */
  const tinted = new Map<string, string>();
  model.tintSlots.forEach((slot, i) => {
    const tint = spec.tints[i] ?? AS_AUTHORED;
    if (tint === AS_AUTHORED) return;
    const hex = paletteFor(slot)[tint];
    for (const name of slot.materials) tinted.set(name, hex);
  });
  /* An authored character's own painting, last word. */
  const hidden = new Set<string>();
  for (const [name, hex] of Object.entries(options.overrides ?? {})) {
    if (hex === null) hidden.add(name);
    else tinted.set(name, hex);
  }

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
      /*
       * Carried over, not dropped.
       *
       * This rebuild exists for the vendored roster, which is untextured — every
       * part a named flat colour — so for years there was nothing to carry. The
       * imported characters *are* textured, and rebuilding their materials
       * without the map turned Yugi into a white statue: correct geometry,
       * correct animation, no face. A model that came with a picture of itself
       * keeps it, and tinting one is a colour multiplied over that picture,
       * which is why those models declare no tint slots.
       */
      map: (() => {
        if (!source.map) return null;
        if (!paint.some(Boolean) && !options.repaint) return source.map;
        /* One repaint per distinct source texture, shared by every material
           that uses it — a body and a face can be the same image. */
        const done = repainted.get(source.map);
        if (done) return done;
        const next = repaintTexture(source.map, model.textureTints, paint, model.skin, options.repaint);
        if (!next) return source.map;
        repainted.set(source.map, next);
        disposables.push(next);
        return next;
      })(),
      /* Hair and eyelash cards on the rips are cut-outs, and without the
         threshold they render as opaque rectangles round the head. */
      alphaTest: source.alphaTest || 0,
      side: source.side ?? THREE.FrontSide,
    });
    /* Hidden, not deleted: the polygons stay in the mesh they share with the
       face, and simply draw nothing. `depthWrite` off as well, or the crown
       that is no longer there still punches a hole in whatever is behind
       it. */
    if (hidden.has(old.name)) {
      mat.visible = false;
      mat.depthWrite = false;
    }
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
       screen mid-stride. A sculpt has no bones and never leaves its box, so it
       keeps its culling — which is most of what makes a field of fourteen of
       them affordable, since you are only ever looking at a few. */
    mesh.frustumCulled = !skinned.isSkinnedMesh;
  });

  const height = model.height * statureScale(spec.stature);
  const scale = height / template.rawHeight;
  body.scale.setScalar(scale);
  /* Stand them on the ground rather than on their origin. Scaled with the
     model, because `floor` is in the file's own units. */
  body.position.y = -template.floor * scale;

  if (options.build) reshape(body, options.build);

  const root = new THREE.Group();
  root.add(body);

  /* ---- accessories ----
     Added to the bone itself, so the skeleton carries them through every clip
     the model has without this file knowing what the clips are. A bone the
     rig does not have is an authoring mistake and says so, rather than
     silently dropping the prop that was the whole point of the character. */
  const worn: { dispose(): void }[] = [];
  if (options.accessories?.length) {
    const bones = new Map<string, THREE.Object3D>();
    body.traverse((o) => {
      if ((o as THREE.Bone).isBone) bones.set(o.name, o);
    });
    for (const spec2 of options.accessories) {
      const bone = bones.get(spec2.bone);
      if (!bone) {
        console.error(
          `premadeRig: ${model.id} has no bone "${spec2.bone}" for a ${spec2.kind}`
        );
        continue;
      }
      /* Accessories are placed in the head's own coordinates, and those differ
         from model to model. A model nobody has measured cannot be worn on. */
      const head = headFor(model.id);
      if (!head) {
        console.error(`premadeRig: no head metrics for "${model.id}" — cannot fit a ${spec2.kind}`);
        continue;
      }
      const built = buildAccessory(spec2, head);
      if (!built) continue;
      bone.add(built.object);
      worn.push(built);
    }
  }

  /* ---- animation ---- */

  const mixer = new THREE.AnimationMixer(body);
  const action = (name: string): THREE.AnimationAction | null => {
    const clip = THREE.AnimationClip.findByName(template.gltf.animations, name);
    if (!clip) return null;
    const a = mixer.clipAction(clip);
    a.play();
    return a;
  };
  /* The rigged pack ships all three. The sculpted cast ships none — no
     skeleton, so nothing to animate — and gets three nulls, which every line
     below is written to survive: it stands, it can still be turned to face
     you, and it can still be talked to. Standing still is the honest state
     for a model nobody has rigged yet, and it is not a failure to be logged. */
  const idle = action('Idle');
  const walk = action('Walk');
  const run = action('Run');

  /* ---- what a model with no skeleton does instead ----
   *
   * **This is a mitigation, not an animation system, and it is worth being
   * blunt about which.** A sculpt has no bones, so no limb on it can be made
   * to move by any amount of code here. What it does have is a root, and the
   * two things that read as *dead* rather than merely still are a body that
   * holds one height exactly while crossing forty metres of ground, and one
   * that holds plumb vertical while doing it. Both are fixable at the root.
   *
   * So: a breath while standing, and while moving a rise and fall at step
   * frequency with a small lean into the direction of travel and a roll off
   * the planted foot. It reads as somebody walking seen from across a field,
   * and it does not survive close inspection, because the legs do not move.
   * It buys time until these are rigged; it is not a substitute for rigging
   * them.
   *
   * Amplitudes are in model heights rather than metres, so a 1.5 m Weevil and
   * a 5.5 m dragon breathe by the same proportion of themselves rather than
   * the same absolute centimetre. Every number is deliberately under what
   * looks "right" in isolation: the failure mode of this trick is a character
   * who bounces, and a bounce is more obviously wrong than a glide.
   */
  const inert = !idle && !walk && !run;
  /** The grounded height, which the bob is measured from rather than replacing. */
  const groundY = body.position.y;
  const rise = height * 0.012;
  const breath = height * 0.004;
  let clock = 0;

  const staticMotion = (dt: number, stride: number, groundSpeed: number) => {
    clock += dt;
    const moving = smoothstep(0.03, 0.3, stride);
    /* Steps a second, from real ground speed: about two a second at a walk.
       Tied to the ground rather than to the clock for the same reason the
       clip playback rate is — a cadence that does not match the speed is the
       thing that makes feet look like they are sliding, and these feet have
       no other way to be honest. */
    const cadence = Math.max(0.9, groundSpeed * 1.35);
    /* Two rises per stride: a body lifts on each foot, not each pair. */
    const step = clock * cadence * Math.PI * 2;
    body.position.y = groundY + Math.sin(step) * rise * moving + Math.sin(clock * 1.6) * breath * (1 - moving);
    /* Lean into it. +X tips the head toward +Z, which is the way these models
       face, so this is a lean forward rather than a stumble backward. */
    body.rotation.x = 0.055 * moving;
    /* And a roll off the planted foot, at half the rise's frequency because
       the weight changes side once per stride rather than twice. */
    body.rotation.z = Math.sin(step * 0.5) * 0.03 * moving;
  };

  const update = (dt: number, stride: number, groundSpeed: number) => {
    if (inert) {
      staticMotion(dt, stride, groundSpeed);
      return;
    }
    /* Moving-ness and running-ness, each eased so the blend has no seams.
       The run blend starts where a brisk walk stops looking like walking. */
    const moving = smoothstep(0.03, 0.3, stride);
    const running = smoothstep(0.62, 0.92, stride);
    idle?.setEffectiveWeight(1 - moving);
    walk?.setEffectiveWeight(moving * (1 - running));
    run?.setEffectiveWeight(moving * running);
    /* Feet: playback rate is ground speed over the clip's own speed. Held at
       1 when standing so the last steps of a stop do not freeze mid-air.
       The fallbacks are unreachable — a model with no `walkSpeed` is a sculpt,
       and a sculpt has no Walk action to scale — but they keep the arithmetic
       honest rather than dividing by `undefined` if that ever stops being
       true. */
    walk?.setEffectiveTimeScale(groundSpeed > 0.01 ? groundSpeed / (model.walkSpeed ?? 1.5) : 1);
    run?.setEffectiveTimeScale(groundSpeed > 0.01 ? groundSpeed / (model.runSpeed ?? 3.4) : 1);

    /*
     * While both leg cycles are playing, they have to be the *same* cycle.
     *
     * Each clip is rated to its own ground coverage so its feet do not slide,
     * and those rates are far apart — a walk covers 1.5 m a second and a run
     * 3.4, so at a jog the walk plays at 2.2× and the run at 0.97×. Left free
     * the two drift through each other, and blending two leg cycles in opposite
     * phase muddles the stride.
     *
     * This is a tidy-up, not a bug fix, and it is worth saying which: the
     * crossed-legged run it was first written to explain turned out to be the
     * Run clip's own stance, corrected offline by
     * `scripts/blender/widen-stance.py`. Syncing measurably helps the low end
     * of the blend and nothing else — around a jog it halves how much of the
     * loop has the legs together.
     *
     * Matching on *normalised* phase works here because both clips are a single
     * gait cycle and both open on the same foot — checked, not assumed. The
     * louder clip leads, so the quieter one is the one being bent.
     */
    if (walk && run && running > 0 && running < 1) {
      const lead = running < 0.5 ? walk : run;
      const follow = running < 0.5 ? run : walk;
      const span = lead.getClip().duration;
      if (span > 0) {
        follow.time = (((lead.time / span) % 1) + 1) % 1 * follow.getClip().duration;
      }
    }
    mixer.update(dt);
  };
  /* Settle into the rest of the idle immediately rather than showing one
     frame of T-pose while the first `update` is still a frame away. */
  update(0, 0, 0);

  return {
    root,
    height,
    update,
    dispose() {
      mixer.stopAllAction();
      /* Materials and skeletons are this rig's own; the geometry belongs to
         the template and outlives it. */
      for (const d of disposables) d.dispose();
      for (const w of worn) w.dispose();
      for (const s of skeletons) s.dispose();
    },
  };
}
