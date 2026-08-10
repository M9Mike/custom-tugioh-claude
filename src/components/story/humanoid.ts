/**
 * The duelist, built out of measurements from a `StoryCharacter`.
 *
 * One model, two screens: the creation booth rebuilds it on every change to a
 * knob, and the open world builds it once and walks it around. That is the
 * whole reason this is a plain function over a plain record rather than a React
 * component — a character is a description, and the description is what gets
 * stored, sent and re-read a year later.
 *
 * Everything is generated: no meshes are downloaded, nothing is skinned, and
 * there is not a single texture. A body is a chain of `Group`s at the joints
 * with lofted geometry hung off them, so posing is ten Euler angles rather than
 * a bone hierarchy and an animation clip — which keeps the whole of Story
 * Mode's 3D to one dependency, on a phone.
 *
 * The numbers below are not taste, they are anthropometry, written against a
 * 1.78 m reference and scaled from there. Stature × 0.52 is the hip joint,
 * × 0.80 the shoulder, × 0.285 the knee; an upper arm is 0.186 of stature and a
 * head is a seventh and a half of it. Getting a character to read as a person
 * is overwhelmingly a matter of getting those right, and almost not at all a
 * matter of detail: no amount of modelling rescues a figure whose head is a
 * sixth of its height, and a correctly proportioned one survives being simple.
 *
 * Units are metres and the duelist faces +Z. The root's origin is between the
 * feet, at ground level, so placing one in the world is `position.set(x, 0, z)`.
 */

import * as THREE from 'three';
import {
  CLOTH_COLORS,
  SKIN_TONES,
  TRIM_COLORS,
  type StoryCharacter,
} from '@/story/character';
import { buildHead } from './head';
import { MeshBuilder, type Profile, limb, sample, sectionPoint } from './loft';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/* ------------------------------------------------------------------ */
/* Proportions                                                         */
/* ------------------------------------------------------------------ */

/** The reference body every table below is written against. */
const REF = 1.78;

/**
 * The torso in section, as heights above the hip joint.
 *
 * The waist row is the one that matters. A torso lofted straight from hip to
 * shoulder is a barrel, and a barrel is what every quickly-made character
 * looks like; the 30 mm the waist comes in at y = 0.175 is most of what makes
 * a silhouette read as a person rather than a bollard. The depth column earns
 * its keep the same way — a chest is far wider than it is deep, and revolving
 * a profile instead of lofting one loses that on the very first frame.
 */
const TORSO: Profile = [
  /* y       half-breadth  half-depth  square */
  [-0.115, 0.15, 0.098, 2.3],
  [-0.085, 0.168, 0.111, 2.3], // the seat, at its widest
  [-0.04, 0.172, 0.114, 2.3],
  [0.02, 0.164, 0.106, 2.4], // iliac crest
  [0.09, 0.149, 0.099, 2.5],
  [0.175, 0.143, 0.096, 2.6], // waist
  [0.25, 0.152, 0.106, 2.6],
  [0.33, 0.163, 0.116, 2.5], // ribcage
  [0.38, 0.17, 0.117, 2.4], // pectoral
  [0.44, 0.171, 0.108, 2.3],
  [0.49, 0.163, 0.096, 2.2], // the shelf the shoulder hangs off
  [0.525, 0.13, 0.086, 2.1], // trapezius
  [0.56, 0.084, 0.075, 2.0], // base of the neck
];

/**
 * The neck. The `dz` column leans it back, and it has to stay small.
 *
 * A neck really does sit behind the sternum, but the collar around it is a
 * ring on the torso's own axis: lean the neck far enough and its back passes
 * out through the back of its own collar, leaving a strip of bare skin at the
 * nape that is invisible from the front and obvious from anywhere behind.
 */
const NECK: Profile = [
  [0.0, 0.083, 0.077, -0.004],
  [0.25, 0.064, 0.058, -0.004],
  [0.55, 0.059, 0.053, -0.003],
  [0.8, 0.06, 0.056, -0.002],
  [1.0, 0.067, 0.065, 0.0],
];

/**
 * The upper arm, from a little above the shoulder joint down to the elbow.
 *
 * It starts above the joint on purpose. A deltoid is not a ball stuck on the
 * side of a torso, it is a cap that comes over the top of the joint and tucks
 * under the trapezius, and modelling it as a sphere at the shoulder is what
 * gives a character the puffed sleeves of a stage costume. Rows 0 to 2 are the
 * part that lives inside the torso; row 3 is where it is widest.
 */
const UPPER_ARM: Profile = [
  [0.0, 0.026, 0.028, 0.0],
  [0.06, 0.048, 0.05, 0.0],
  [0.14, 0.054, 0.058, -0.002],
  [0.24, 0.055, 0.062, -0.004], // deltoid: deeper than it is wide, as it is
  [0.38, 0.051, 0.058, -0.004],
  [0.55, 0.049, 0.055, -0.004], // bicep in front, triceps behind
  [0.75, 0.045, 0.05, -0.003],
  [0.92, 0.042, 0.045, -0.001],
  [1.0, 0.041, 0.043, 0.0], // elbow
];

const FOREARM: Profile = [
  [0.0, 0.042, 0.044, 0.0],
  [0.12, 0.046, 0.049, -0.002], // the belly of the forearm, up near the elbow
  [0.3, 0.044, 0.046, -0.002],
  [0.55, 0.038, 0.039, -0.001],
  [0.8, 0.031, 0.031, 0.0],
  [1.0, 0.029, 0.024, 0.0], // the wrist, which is flat, not round
];

const THIGH: Profile = [
  [0.0, 0.098, 0.104, 0.004],
  [0.1, 0.096, 0.102, 0.002],
  [0.3, 0.089, 0.094, 0.0],
  [0.55, 0.079, 0.083, -0.002],
  [0.8, 0.068, 0.072, -0.002],
  [0.94, 0.061, 0.065, -0.001],
  [1.0, 0.059, 0.062, 0.0],
];

/**
 * The shin. The `dz` column is the whole point of it.
 *
 * A calf is a mass hung *behind* the bone, not a swelling on it. Put it on the
 * axis and the leg reads as a balloon; put it 18 mm back and the leg gets a
 * front edge, which is the line the eye actually follows down a standing
 * figure.
 */
const SHIN: Profile = [
  [0.0, 0.06, 0.064, 0.0], // knee
  [0.07, 0.058, 0.064, -0.004],
  [0.22, 0.056, 0.072, -0.018], // calf
  [0.42, 0.049, 0.06, -0.014],
  [0.68, 0.039, 0.043, -0.006],
  [0.9, 0.033, 0.035, -0.001],
  [1.0, 0.031, 0.036, 0.002], // ankle
];

/** The foot, as sections along its length: half-width and height. */
const FOOT: Profile = [
  [0.0, 0.036, 0.072, 0.0],
  [0.12, 0.045, 0.09, 0.0],
  [0.38, 0.049, 0.076, 0.0],
  [0.62, 0.051, 0.056, 0.0],
  [0.84, 0.046, 0.039, 0.0],
  [1.0, 0.031, 0.024, 0.0],
];

/** What the frame choice, and nothing else, decides. */
const FRAME_METRICS = {
  lean: { shoulder: 0.9, chest: 0.9, waist: 0.88, hip: 0.94, limb: 0.9 },
  balanced: { shoulder: 1, chest: 1, waist: 1, hip: 1, limb: 1 },
  sturdy: { shoulder: 1.11, chest: 1.09, waist: 1.12, hip: 1.06, limb: 1.1 },
} as const;

/** What each outfit id actually changes about the garment. */
const OUTFIT_SHAPE = {
  duelist: { hem: 0.055, skirt: 0, flare: 1, collar: 0.075, sleeve: 1, pauldron: false, split: 0 },
  traveller: { hem: -0.03, skirt: 0.46, flare: 1.5, collar: 0.055, sleeve: 1, pauldron: false, split: 0.22 },
  scholar: { hem: -0.05, skirt: 0.86, flare: 1.8, collar: 0.045, sleeve: 1, pauldron: false, split: 0.06 },
  warden: { hem: 0.04, skirt: 0.24, flare: 1.35, collar: 0.07, sleeve: 1, pauldron: true, split: 0.16 },
  street: { hem: 0.09, skirt: 0, flare: 1, collar: 0, sleeve: 0.55, pauldron: false, split: 0 },
} as const;

/* ------------------------------------------------------------------ */
/* The rig                                                             */
/* ------------------------------------------------------------------ */

export interface Rig {
  /** Add this to a scene. Origin between the feet, on the ground. */
  root: THREE.Group;
  /** Metres from the ground to the top of the skull, hair excluded. */
  height: number;
  /**
   * Poses the whole body.
   *
   * @param t      seconds since the rig was built — the only clock it has
   * @param stride 0 standing, 1 walking at full pace; blended, not switched
   */
  pose(t: number, stride: number): void;
  dispose(): void;
}

interface Joints {
  hips: THREE.Group;
  spine: THREE.Group;
  torso: THREE.Group;
  chest: THREE.Group;
  neck: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  foreL: THREE.Group;
  foreR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  shinL: THREE.Group;
  shinR: THREE.Group;
  footL: THREE.Group;
  footR: THREE.Group;
  cape: THREE.Group | null;
  lidL: THREE.Group;
  lidR: THREE.Group;
  lidOpen: number;
  lidShut: number;
}

export function buildCharacter(spec: StoryCharacter): Rig {
  const kept: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T): T => {
    kept.push(x);
    return x;
  };

  /* ---------------- scale ---------------- */

  const stature = lerp(1.66, 1.9, spec.height);
  const S = stature / REF;
  /* Heads do not scale with stature — a tall person is a person with longer
     legs, not a bigger head — so this deliberately lags behind S. It is what
     makes the tall end of the slider read as tall rather than as zoomed in. */
  const H = 0.234 * (0.42 + 0.58 * S);
  const F = FRAME_METRICS[spec.frame] ?? FRAME_METRICS.balanced;
  const O = OUTFIT_SHAPE[spec.outfit] ?? OUTFIT_SHAPE.duelist;
  /* Girth, which is `build`. Kept off the shoulders: a heavier duelist is
     thicker through the middle and the limbs, not broader across the frame —
     and the limbs take it more gently than the waist does, because that is
     where weight actually goes. */
  const G = lerp(0.9, 1.2, spec.build);
  /** Radial scale for every limb: stature, frame and build together. */
  const LS = S * F.limb * lerp(0.93, 1.14, spec.build);

  /** The neck's own girth, which the collar has to be cut to fit. */
  const neckG = S * lerp(0.95, 1.1, spec.build);

  const hipY = 0.52 * stature;
  /** Shoulders to the head's own pivot. Declared here because the collar is
      cut to the neck's taper and needs it before the neck is built. */
  const neckLen = 0.174 * stature - 0.68 * H;
  const thighL = (0.52 - 0.285) * stature;
  const shinL = (0.285 - 0.039) * stature;
  const ankleY = 0.039 * stature;
  const upperArmL = 0.186 * stature;
  const foreArmL = 0.146 * stature;
  const shoulderY = 0.8 * stature - hipY;
  const neckBaseY = 0.826 * stature - hipY;

  /* ---------------- materials ---------------- */

  const skinColor = new THREE.Color(SKIN_TONES[spec.skin] ?? SKIN_TONES[0]);
  const mat = (color: string, roughness = 0.85, metalness = 0) =>
    keep(new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness, metalness }));

  /**
   * Skin.
   *
   * `MeshPhysicalMaterial` rather than Standard, for the sheen: skin is not
   * matte, and a body with no specular at all is the single loudest way of
   * saying "plastic". The roughness is high enough that it never looks wet.
   */
  const skin = keep(
    new THREE.MeshPhysicalMaterial({
      color: skinColor,
      roughness: 0.6,
      metalness: 0,
      sheen: 0.5,
      sheenRoughness: 0.65,
      sheenColor: new THREE.Color('#ffd4c2'),
      specularIntensity: 0.38,
    })
  );
  /**
   * Cloth.
   *
   * Sheen is what stops a garment reading as painted rubber — but it is a
   * broad, view-facing lobe, and at white it lays a flat wash over the whole
   * surface. Tried at 0.65 white, every dark colour in the palette came out
   * the same pale grey and the duelist looked like it was dressed in fog. The
   * fix is to keep the sheen and colour it: a fibre catches the light of the
   * cloth it is part of, not a studio bulb.
   */
  const cloth = (idx: number, fallback: number) => {
    const c = new THREE.Color(CLOTH_COLORS[idx] ?? CLOTH_COLORS[fallback]);
    return keep(
      new THREE.MeshPhysicalMaterial({
        color: c,
        roughness: 0.84,
        metalness: 0,
        sheen: 0.3,
        sheenRoughness: 0.8,
        sheenColor: c.clone().lerp(new THREE.Color('#ffffff'), 0.35),
      })
    );
  };

  const primary = cloth(spec.primary, 0);
  const secondary = cloth(spec.secondary, 1);
  const trouser = cloth(spec.trouser, 4);
  const boots = cloth(spec.boots, 5);
  const capeMat = cloth(spec.capeColor, 10);
  const trim = mat(TRIM_COLORS[spec.trim] ?? TRIM_COLORS[0], 0.32, 0.9);
  const leather = mat('#241c18', 0.75, 0.05);

  /* ---------------- skeleton ---------------- */

  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = hipY;
  root.add(hips);

  const spine = new THREE.Group();
  hips.add(spine);
  const torso = new THREE.Group();
  spine.add(torso);
  const chest = new THREE.Group();
  chest.position.y = 0.175 * S;
  spine.add(chest);

  const neck = new THREE.Group();
  /* Barely off the torso's axis — see `NECK`. */
  neck.position.set(0, neckBaseY - 0.175 * S, -0.004 * S);
  chest.add(neck);

  const add = (parent: THREE.Group, geo: THREE.BufferGeometry, m: THREE.Material) => {
    keep(geo);
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };

  /* ---------------- torso and garment ---------------- */

  /** The torso profile, after the frame and the build have had their say. */
  const torsoAt = (y: number, col: number) => {
    const raw = sample(TORSO, y / S, col);
    if (col === 0) return raw;
    const t = y / S;
    /* One curve, three regions: hips, waist, chest. Blending between the frame
       multipliers rather than switching keeps the silhouette continuous — a
       sturdy duelist has to be sturdy all the way up, not in three steps. */
    const w =
      t < 0.02
        ? F.hip
        : t < 0.175
          ? lerp(F.hip, F.waist, (t - 0.02) / 0.155)
          : t < 0.38
            ? lerp(F.waist, F.chest, (t - 0.175) / 0.205)
            : lerp(F.chest, F.shoulder, Math.min(1, (t - 0.38) / 0.14));
    const girth = 1 + (G - 1) * (t < 0.42 ? 1 : Math.max(0, 1 - (t - 0.42) / 0.16));
    return raw * w * girth * S;
  };

  const torsoLoft = (
    y0: number,
    y1: number,
    inflate: number,
    flareBelow = 0,
    hole: { r: number; cz: number } | null = null,
    rows = 22
  ) => {
    const m = new MeshBuilder();
    const rings: number[][] = [];
    for (let i = 0; i <= rows; i++) {
      const y = lerp(y0, y1, i / rows);
      /**
       * A garment flares over the hip, and it has to: the thigh rotates about
       * a joint inside the coat and sweeps wider than the waist above it. Cut
       * straight the hem is narrower than the leg at full stride, and the
       * thigh comes through the cloth — which is the single most obvious
       * defect a body can have, and it only shows mid-step.
       */
      const flare = flareBelow > 0 ? Math.max(0, 1 - Math.max(0, y - y0) / flareBelow) ** 2 * 0.008 * S : 0;
      const hw = torsoAt(y, 1) + inflate + flare;
      const hd = torsoAt(y, 2) + inflate + flare * 0.7;
      const sq = sample(TORSO, y / S, 3);
      const ring: number[] = [];
      for (let k = 0; k < 30; k++) {
        const a = (k / 30) * Math.PI * 2;
        const p = sectionPoint(hw, hd, hd * 1.02, sq, a);
        ring.push(m.vertex(p.x, y, p.z));
      }
      rings.push(ring);
    }
    m.loft(rings);
    m.cap(rings[0], m.vertex(0, y0 - 0.04 * S, 0), -1);

    /**
     * The neck hole, closed onto the neck rather than to a point.
     *
     * A cone from the shoulders to a spike above them leaves the garment's
     * opening far wider than the neck for most of its height, and the neck —
     * which is not on the torso's axis — finds its way out through the back of
     * it. Tapering onto a ring the size of the neck, at the neck's own centre,
     * means there is no opening left to escape through, whatever the collar
     * above it happens to be doing.
     */
    if (hole) {
      let prev = rings[rows];
      for (let i = 1; i <= 3; i++) {
        const t = i / 3;
        const y = y1 + t * 0.03 * S;
        const r = lerp(1, hole.r / Math.max(hole.r, torsoAt(y1, 1) + inflate), t);
        const ring: number[] = [];
        for (let k = 0; k < 30; k++) {
          const a = (k / 30) * Math.PI * 2;
          const hw = lerp(torsoAt(y1, 1) + inflate, hole.r, t);
          const hd = lerp(torsoAt(y1, 2) + inflate, hole.r * 0.95, t);
          const q = sectionPoint(hw * (r > 0 ? 1 : 1), hd, hd, lerp(sample(TORSO, y1 / S, 3), 2.1, t), a);
          ring.push(m.vertex(q.x, y, q.z + hole.cz * t));
        }
        m.loft([prev, ring]);
        prev = ring;
      }
    } else {
      m.cap(rings[rows], m.vertex(0, y1 + 0.03 * S, -0.01 * S), 1);
    }
    return m.build();
  };

  const hemY = O.hem * S;
  const topY = neckBaseY + 0.012 * S;
  add(torso, torsoLoft(-0.1 * S, hemY + 0.03 * S, 0.008 * S), trouser);
  add(torso, torsoLoft(hemY, topY, 0.015 * S, 0.16 * S, { r: 0.088 * neckG, cz: -0.006 * S }), primary);

  /* The jacket's closure, in the secondary colour: a placket down the centre
     front, which is what turns one lofted tube into a garment that was cut and
     sewn. Narrow on purpose — widened out it stops being a seam and becomes a
     bib, and the duelist looks like it is wearing a tabard by accident. */
  add(torso, panelGeometry(torsoAt, hemY, topY - 0.035 * S, S), secondary);

  if (O.skirt > 0) add(torso, skirtGeometry(torsoAt, hemY, O.skirt * S, O.flare, O.split, S), primary);

  /* Belt and buckle. */
  const beltY = 0.16 * S;
  add(torso, beltGeometry(torsoAt, beltY, 0.036 * S, S), leather);
  add(torso, buckleGeometry(torsoAt, beltY, S), trim);

  /* Hips-local, like everything else the torso profile is written in. Handed
     chest-local heights it sampled the ribcage instead of the neck and came
     out as a funnel twice the width of the throat it was supposed to fit. */
  /* Rooted well below the neckline, not at it. A collar whose bottom rim is
     wider than the hole it sits in leaves a ring of bare neck showing between
     the two — invisible from the front and unmissable from behind. Sunk this
     far the rim is buried inside the jacket and the collar emerges from the
     shoulders, which is where a collar comes from. */
  if (O.collar > 0) {
    add(torso, collarGeometry(neckG, neckBaseY, neckLen, (O.collar * 0.7 + 0.02) * S, S), primary);
  }

  /* ---------------- neck and head ---------------- */

  {
    const m = new MeshBuilder();
    limb(m, NECK, neckLen, {
      down: false,
      seg: 20,
      scale: neckG,
      capRoot: false,
      capTip: false,
    });
    add(neck, m.build(), skin);
  }

  const headRig = buildHead(spec, H, skinColor);
  kept.push(headRig);
  const head = new THREE.Group();
  head.position.set(0, neckLen, 0.022 * S);
  head.add(headRig.group);
  neck.add(head);

  /* ---------------- arms ---------------- */

  /**
    * The glenohumeral joint, which is further out than the ribcage under it.
    * Mounted flush with the torso the whole arm hangs *inside* the coat's
    * silhouette: the forearm crosses the hem, the hand ends up in the thigh,
    * and anything worn on the arm erupts through the jacket's side.
    */
  const shoulderX = torsoAt(shoulderY, 1) * 1.08;
  const arms: THREE.Group[] = [];
  const fores: THREE.Group[] = [];

  for (const side of [1, -1] as const) {
    const arm = new THREE.Group();
    /* Set forward of the coronal plane, as a relaxed arm hangs — which is
       also what keeps the forearm in front of the hip rather than beside it. */
    arm.position.set(side * shoulderX, shoulderY - 0.175 * S, 0.06 * S);
    chest.add(arm);
    arms.push(arm);

    /* The deltoid reaches above the joint, so the mesh is offset up by the
       part of the profile that lives inside the shoulder. */
    const overshoot = 0.2;
    const holder = new THREE.Group();
    holder.position.y = upperArmL * overshoot;
    arm.add(holder);

    const m = new MeshBuilder();
    limb(m, UPPER_ARM, upperArmL * (1 + overshoot), {
      scale: LS,
      inflate: 0.012 * S,
      capTip: false,
    });
    add(holder, m.build(), primary);

    if (O.pauldron) add(holder, pauldronGeometry(S), trim);

    const fore = new THREE.Group();
    fore.position.y = -upperArmL;
    arm.add(fore);
    fores.push(fore);

    /* A short sleeve stops at the elbow and the forearm is skin from there. */
    const bare = O.sleeve < 1;
    const fm = new MeshBuilder();
    limb(fm, FOREARM, foreArmL, {
      scale: LS,
      inflate: bare ? 0 : 0.01 * S,
      capRoot: false,
      capTip: false,
    });
    add(fore, fm.build(), bare ? skin : primary);

    const wearsGauntlet =
      spec.gauntlet === 'both' || (spec.gauntlet === 'right' ? side === 1 : spec.gauntlet === 'left' && side === -1);
    if (wearsGauntlet) {
      const gm = new MeshBuilder();
      /* Started below the elbow and kept thin. Run up to the elbow it sits at
         hip height in a metal that contrasts with the coat, so every
         millimetre it overlaps is a millimetre you can see. */
      limb(gm, FOREARM, foreArmL, {
        from: 0.44,
        to: 0.99,
        scale: LS,
        inflate: 0.011 * S,
        square: 2.6,
        seg: 20,
      });
      add(fore, gm.build(), trim);
    }

    const hand = new THREE.Group();
    hand.position.y = -foreArmL;
    /**
      * Turned so the palm faces the thigh — a hand at rest is not a paddle
      * held out front. Only three-quarters of the way, though: the digits are
      * built curling towards +Z, so the same rotation that turns the palm
      * inward turns the curl inward with it, and at a right angle the fingers
      * are aimed straight into the thigh they are supposed to hang beside.
      */
    hand.rotation.y = -side * 0.8;
    fore.add(hand);
    add(hand, handGeometry(side, S), skin);
  }

  /* ---------------- legs ---------------- */

  const hipX = torsoAt(0, 1) * 0.53;
  const legs: THREE.Group[] = [];
  const shins: THREE.Group[] = [];
  const feet: THREE.Group[] = [];
  const bootTop = 0.42;

  for (const side of [1, -1] as const) {
    const leg = new THREE.Group();
    leg.position.set(side * hipX, 0, 0);
    hips.add(leg);
    legs.push(leg);

    const tm = new MeshBuilder();
    limb(tm, THIGH, thighL, { scale: LS, inflate: 0.01 * S, capTip: false });
    add(leg, tm.build(), trouser);

    const shin = new THREE.Group();
    shin.position.y = -thighL;
    leg.add(shin);
    shins.push(shin);

    const sm = new MeshBuilder();
    limb(sm, SHIN, shinL, {
      to: bootTop + 0.06,
      scale: LS,
      inflate: 0.009 * S,
      capRoot: false,
      capTip: false,
    });
    add(shin, sm.build(), trouser);

    /* The boot: the bottom of the shin again, one layer out and squarer,
       because leather holds a shape where a trouser leg does not. */
    const bm = new MeshBuilder();
    limb(bm, SHIN, shinL, {
      from: bootTop,
      scale: LS,
      inflate: 0.016 * S,
      square: 2.5,
      capTip: false,
    });
    add(shin, bm.build(), boots);

    const foot = new THREE.Group();
    foot.position.y = -shinL;
    shin.add(foot);
    feet.push(foot);
    add(foot, footGeometry(ankleY, S), boots);
  }

  /* ---------------- cape ---------------- */

  let cape: THREE.Group | null = null;
  if (spec.cape) {
    cape = new THREE.Group();
    cape.position.set(0, shoulderY - 0.175 * S + 0.03 * S, -torsoAt(shoulderY, 2) * 0.55);
    chest.add(cape);
    const cm = new THREE.Mesh(keep(capeGeometry(stature, S)), capeMat);
    cm.castShadow = true;
    capeMat.side = THREE.DoubleSide;
    cape.add(cm);
  }

  const j: Joints = {
    hips,
    spine,
    torso,
    chest,
    neck,
    head,
    armL: arms[1],
    armR: arms[0],
    foreL: fores[1],
    foreR: fores[0],
    legL: legs[1],
    legR: legs[0],
    shinL: shins[1],
    shinR: shins[0],
    footL: feet[1],
    footR: feet[0],
    cape,
    lidL: headRig.lidL,
    lidR: headRig.lidR,
    lidOpen: headRig.lidOpen,
    lidShut: headRig.lidShut,
  };

  pose(j, 0, 0, hipY, spec);

  return {
    root,
    height: stature,
    pose: (t, stride) => pose(j, t, stride, hipY, spec),
    dispose: () => kept.forEach((k) => k.dispose()),
  };
}

/* ------------------------------------------------------------------ */
/* Garment pieces                                                      */
/* ------------------------------------------------------------------ */

type TorsoAt = (y: number, col: number) => number;

/**
 * An open sheet, lofted between two arcs of azimuth.
 *
 * Panels, collars and capes are all sheets rather than tubes, and a tube loft
 * wraps its last column back round to its first — which on a collar means a
 * strip of cloth across the duelist's throat.
 */
function sheet(
  m: MeshBuilder,
  rows: number,
  cols: number,
  at: (u: number, v: number) => { x: number; y: number; z: number }
): void {
  const grid: number[][] = [];
  for (let i = 0; i <= rows; i++) {
    const line: number[] = [];
    for (let k = 0; k <= cols; k++) {
      const p = at(i / rows, k / cols);
      line.push(m.vertex(p.x, p.y, p.z));
    }
    grid.push(line);
  }
  for (let i = 0; i < rows; i++) {
    for (let k = 0; k < cols; k++) {
      m.quad(grid[i][k], grid[i][k + 1], grid[i + 1][k + 1], grid[i + 1][k]);
    }
  }
}

/** The jacket's front, laid over the chest between the lapels. */
function panelGeometry(at: TorsoAt, y0: number, y1: number, S: number): THREE.BufferGeometry {
  const m = new MeshBuilder();
  sheet(m, 16, 8, (u, v) => {
    const y = lerp(y0, y1, u);
    /* Barely wider at the chest than at the hem, which is how a jacket front
       is cut and is enough to stop the strip reading as a stripe. */
    const half = lerp(0.15, 0.2, u);
    const a = lerp(-half, half, v);
    const p = sectionPoint(at(y, 1) + 0.006 * S, at(y, 2) + 0.006 * S, 0, sampleSq(y, S), a);
    return { x: p.x, y, z: p.z };
  });
  return m.build();
}

const sampleSq = (y: number, S: number) => sample(TORSO, y / S, 3);

/**
 * A coat's tails or a robe's skirt: flared, split up the front, and — this is
 * the whole of it — *two-sided*.
 *
 * A garment that wraps the body is seen from inside as well as out: at the
 * split, and from any angle where the far half faces away. Built as one
 * surface it is backface-culled to nothing there, and a full robe renders as
 * two red ribbons hanging at the hips. So the rings run down the outside,
 * turn at the hem and come back up the inside, which reverses the winding
 * exactly where the cloth turns over and gives the hem a thickness to catch
 * the light on.
 */
function skirtGeometry(
  at: TorsoAt,
  hemY: number,
  len: number,
  flare: number,
  gap: number,
  S: number
): THREE.BufferGeometry {
  const m = new MeshBuilder();
  const base = at(hemY, 1) + 0.03 * S;
  const baseD = at(hemY, 2) + 0.03 * S;
  sheet(m, 30, 40, (u, v) => {
    /* Down the outside for the first half, back up the inside for the second. */
    const outside = u <= 0.5;
    const t = outside ? u * 2 : (1 - u) * 2;
    /**
     * A vent, not a slot.
     *
     * Held open the same width from waist to hem, the split shows a column of
     * near-black trouser at the hip that reads as a hole punched in the
     * garment. A real one is closed where the cloth is belted and opens as it
     * falls, which is both what a coat does and what stops the eye finding a
     * void at the top of it.
     */
    const a = lerp(gap * (0.12 + 0.88 * t * t), Math.PI * 2 - gap * (0.12 + 0.88 * t * t), v);
    const grow = 1 + (flare - 1) * t * t;
    /* The lining sits inside the shell, and meets it at the fold. */
    const inset = outside ? 0 : 0.045 * S * (1 - t);
    const p = sectionPoint(base * grow - inset, baseD * grow - inset, (baseD * grow - inset) * 1.08, 2.4, a);
    /* A hem that hangs: lower at the back than at the front, so it reads as
       cloth under gravity rather than a cone. */
    const hang = 1 + 0.14 * Math.cos(a - Math.PI);
    return { x: p.x, y: hemY - t * len * hang, z: p.z };
  });
  return m.build();
}

function beltGeometry(at: TorsoAt, y: number, h: number, S: number): THREE.BufferGeometry {
  const m = new MeshBuilder();
  const rings: number[][] = [];
  for (let i = 0; i <= 3; i++) {
    const yy = y + (i / 3 - 0.5) * h;
    const bulge = i === 0 || i === 3 ? 0.019 : 0.027;
    const ring: number[] = [];
    for (let k = 0; k < 30; k++) {
      const a = (k / 30) * Math.PI * 2;
      const p = sectionPoint(at(yy, 1) + bulge * S, at(yy, 2) + bulge * S, at(yy, 2) + bulge * S, sampleSq(yy, S), a);
      ring.push(m.vertex(p.x, yy, p.z));
    }
    rings.push(ring);
  }
  m.loft(rings);
  return m.build();
}

function buckleGeometry(at: TorsoAt, y: number, S: number): THREE.BufferGeometry {
  const z = at(y, 2) + 0.05 * S;
  const g = new THREE.BoxGeometry(0.06 * S, 0.045 * S, 0.014 * S);
  g.translate(0, y, z);
  return g;
}

/**
 * A stand-up collar.
 *
 * A band with two skins, not a sheet. Built as one surface it was invisible
 * from inside and its free edges read as two teal flaps stuck to the
 * shoulders; a collar is a folded piece of cloth and needs the fold. The rings
 * climb the outside, turn over at the top and come back down the inside,
 * which reverses the winding exactly where the surface reverses.
 */
function collarGeometry(
  neckG: number,
  neckBase: number,
  neckLen: number,
  h: number,
  S: number
): THREE.BufferGeometry {
  const m = new MeshBuilder();
  const N = 7;
  const base = neckBase - 0.035 * S;
  const rings: number[][] = [];
  for (let i = 0; i <= N * 2; i++) {
    const outside = i <= N;
    const up = outside ? i / N : (2 * N - i) / N;
    const ring: number[] = [];
    for (let k = 0; k < 34; k++) {
      const a = (k / 34) * Math.PI * 2;
      /* Low at the throat, high behind the neck — a collar you can see the jaw
         over, and the shape that says "cut and sewn" rather than "extruded". */
      const tall = 0.42 + 0.58 * (1 + Math.cos(a - Math.PI)) * 0.5;
      const y = base + up * h * tall * 1.15;
      /**
       * Cut to the neck at every height, not to its base.
       *
       * A neck narrows sharply as it rises. Held at the base radius and then
       * flared on top of that, a collar stands 60 mm clear of the throat by
       * the time it reaches its rim — and from anywhere behind and above you
       * look straight down into the funnel and see the nape inside it. That
       * pale sliver at the back of every duelist was this.
       */
      const t = Math.max(0, Math.min(1, (y - neckBase) / neckLen));
      const r = (sample(NECK, t, 1) * neckG + 0.01 * S) * (1 + 0.15 * up * up) * (outside ? 1 : 0.84);
      const p = sectionPoint(r, r * 0.97, r * 0.97, 2.1, a);
      ring.push(m.vertex(p.x, y, p.z));
    }
    rings.push(ring);
  }
  m.loft(rings);
  return m.build();
}

/**
 * A pauldron: a plate over the shoulder, wrapping it rather than perched on it.
 *
 * Sized to clear the deltoid underneath — a cap the same width as the arm
 * reads as a bead balanced on the shoulder, with the sleeve visible all round
 * the edge of it.
 */
function pauldronGeometry(S: number): THREE.BufferGeometry {
  const m = new MeshBuilder();
  const rings: number[][] = [];
  /* From the second ring in. At `th` = 0 the radius is zero, so the first ring
     would be twenty-two vertices stacked on one point: twenty-two zero-area
     quads, and twenty-two different normals meeting at the crown of the plate,
     which catches the key light as a star. One apex and a fan instead. */
  for (let i = 1; i <= 10; i++) {
    const t = i / 10;
    const th = t * Math.PI * 0.72;
    const r = Math.sin(th) * 0.086 * S;
    const ring: number[] = [];
    for (let k = 0; k < 22; k++) {
      const a = (k / 22) * Math.PI * 2;
      const p = sectionPoint(r, r * 1.12, r * 1.12, 2.6, a);
      ring.push(m.vertex(p.x, 0.006 * S - (1 - Math.cos(th)) * 0.085 * S, p.z));
    }
    rings.push(ring);
  }
  /* Reversed so the faces point out of the dome rather than into it. */
  const order = [...rings].reverse();
  m.loft(order);
  m.cap(order[order.length - 1], m.vertex(0, 0.006 * S, 0), 1);
  return m.build();
}

/**
 * A cape.
 *
 * Wrapped as a cone round the back rather than hung as a flat panel: a sheet
 * of cloth on a person takes the shape of what it is draped over, and a plane
 * behind the shoulders reads as a sheet of card every time. The fold term is
 * what stops the cone reading as a lampshade.
 */
function capeGeometry(stature: number, S: number): THREE.BufferGeometry {
  const m = new MeshBuilder();
  const len = 0.46 * stature;
  sheet(m, 20, 34, (u, v) => {
    const a = lerp(-1.95, 1.95, v);
    const r = (0.17 + 0.2 * u * u) * S;
    /* Vertical folds, deepest at the hem, where the cloth has slack. */
    const fold = 0.02 * S * Math.sin(a * 4.5) * u * u;
    /* A hem that is not a circle, because cloth never falls level. */
    const hem = 1 + 0.05 * Math.cos(a * 3.2);
    return {
      x: Math.sin(a) * (r + fold),
      y: -u * len * hem + (1 - Math.cos(a)) * 0.02 * S,
      z: -Math.cos(a) * (r + fold) - 0.03 * S * u,
    };
  });
  return m.build();
}

/* ------------------------------------------------------------------ */
/* Extremities                                                         */
/* ------------------------------------------------------------------ */

/**
 * A hand: a palm and five digits.
 *
 * The temptation is a nub, and a nub is what the model had. It is a false
 * economy — hands hang at the silhouette's edge at exactly the height the eye
 * rests, and a mitten there is the one part of a figure people can name as
 * wrong without knowing anything about anatomy. Five short tubes cost almost
 * nothing and stop the question being asked.
 */
function handGeometry(side: 1 | -1, S: number): THREE.BufferGeometry {
  const m = new MeshBuilder();
  const palmL = 0.1 * S;

  /* The palm: a slab, flat front-to-back and slightly wider at the knuckles. */
  const rings: number[][] = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    const rx = lerp(0.03, 0.043, t) * S;
    const rz = lerp(0.023, 0.019, t) * S;
    const ring: number[] = [];
    for (let k = 0; k < 18; k++) {
      const a = (k / 18) * Math.PI * 2;
      const p = sectionPoint(rx, rz, rz, 3, a);
      ring.push(m.vertex(p.x + side * t * 0.004 * S, -t * palmL, p.z));
    }
    rings.push(ring);
  }
  m.loft([...rings].reverse());
  m.cap(rings[0], m.vertex(0, 0.02 * S, 0), 1);

  /** One finger, curled forward as a hand at rest always is. */
  const digit = (x: number, y0: number, len: number, r0: number, curl: number) => {
    const fr: number[][] = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const r = lerp(r0, r0 * 0.78, t) * S;
      const bend = curl * t * t;
      const ring: number[] = [];
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        const p = sectionPoint(r, r * 1.05, r * 1.05, 2.4, a);
        ring.push(m.vertex(x * S + p.x, y0 - t * len * Math.cos(bend), p.z + t * len * Math.sin(bend)));
      }
      fr.push(ring);
    }
    m.loft([...fr].reverse());
    m.cap(fr[fr.length - 1], m.vertex(x * S, y0 - len * Math.cos(curl) - r0 * 0.7 * S, len * Math.sin(curl)), -1);
  };

  const knuckle = -palmL + 0.004 * S;
  digit(side * -0.03, knuckle, 0.072 * S, 0.0115, 0.24);
  digit(side * -0.0105, knuckle + 0.003 * S, 0.079 * S, 0.0122, 0.22);
  digit(side * 0.0105, knuckle + 0.001 * S, 0.074 * S, 0.0118, 0.24);
  digit(side * 0.029, knuckle - 0.005 * S, 0.058 * S, 0.0102, 0.27);

  /* The thumb: off the side of the palm, higher up and turned forward. */
  const tr: number[][] = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    const r = lerp(0.015, 0.011, t) * S;
    const ring: number[] = [];
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const p = sectionPoint(r, r, r, 2.4, a);
      ring.push(
        m.vertex(
          side * (0.032 + t * 0.02) * S + p.x,
          -0.03 * S - t * 0.058 * S,
          p.z + t * 0.03 * S
        )
      );
    }
    tr.push(ring);
  }
  m.loft([...tr].reverse());
  m.cap(tr[tr.length - 1], m.vertex(side * 0.052 * S, -0.092 * S, 0.032 * S), -1);
  return m.build();
}

/** The foot, lofted along its own length rather than down the leg. */
function footGeometry(ankleY: number, S: number): THREE.BufferGeometry {
  const m = new MeshBuilder();
  const len = 0.26 * S;
  const heel = -0.075 * S;
  const rings: number[][] = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    const z = heel + t * len;
    const hw = sample(FOOT, t, 1) * S;
    const h = sample(FOOT, t, 2) * S * (ankleY / (0.069 * S));
    const ring: number[] = [];
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const p = sectionPoint(hw, h / 2, h / 2, 2.9, a);
      /* Rings run bottom-first so the surface faces outward: see `loft`. */
      ring.push(m.vertex(p.x, -ankleY + h / 2 - p.z, z));
    }
    rings.push(ring);
  }
  m.loft(rings);
  m.cap(rings[0], m.vertex(0, -ankleY + 0.03 * S, heel - 0.012 * S), -1);
  m.cap(rings[14], m.vertex(0, -ankleY + 0.012 * S, heel + len + 0.006 * S), 1);
  return m.build();
}

/* ------------------------------------------------------------------ */
/* Pose                                                                */
/* ------------------------------------------------------------------ */

/**
 * Standing and walking, as one blended pose.
 *
 * There is no state and no animation clip: everything is a function of the
 * clock and a single 0..1 stride, so the caller can hand it whatever the
 * player's thumb is doing — nudging the stick and letting go — and never see a
 * transition. Standing is the walk with its stride turned to nothing, plus a
 * breath the walk keeps anyway.
 */
function pose(j: Joints, t: number, stride: number, hipsY: number, spec: StoryCharacter) {
  const s = Math.max(0, Math.min(1, stride));
  const cycle = t * (4.6 + s * 6.4);
  const sway = Math.sin(t * 1.3);
  const breath = Math.sin(t * 1.9);

  const swing = 0.72 * s;
  const gait = Math.sin(cycle);
  const gait2 = Math.sin(cycle * 2);

  /* legs */
  j.legL.rotation.x = gait * swing;
  j.legR.rotation.x = -gait * swing;
  /* A knee only bends one way. Clamping at 0 is what stops the shin snapping
     through the thigh on the back half of the stride. */
  j.shinL.rotation.x = -Math.max(0, Math.sin(cycle - 0.9)) * 1.15 * s;
  j.shinR.rotation.x = -Math.max(0, Math.sin(cycle - 0.9 + Math.PI)) * 1.15 * s;
  /* The ankle keeps the sole flat: it undoes whatever the thigh and shin above
     it have done, plus a push-off at the back of the stride. */
  j.footL.rotation.x = -j.legL.rotation.x - j.shinL.rotation.x + Math.max(0, -gait) * 0.34 * s;
  j.footR.rotation.x = -j.legR.rotation.x - j.shinR.rotation.x + Math.max(0, gait) * 0.34 * s;

  /* arms: counter-swing, plus a resting angle so they never clip the coat */
  /* Arms hang a little away from the body, not flat against it. Too little
     and the hands finish inside the thighs; too much and the duelist reads as
     spoiling for a fight. */
  const rest = 0.12 + 0.03 * spec.build;
  j.armL.rotation.x = -gait * swing * 0.72 + sway * 0.03 * (1 - s);
  j.armR.rotation.x = gait * swing * 0.72 - sway * 0.03 * (1 - s);
  j.armL.rotation.z = rest + 0.1 * s;
  j.armR.rotation.z = -rest - 0.1 * s;
  j.foreL.rotation.x = -0.22 - Math.max(0, -gait) * 0.5 * s;
  j.foreR.rotation.x = -0.22 - Math.max(0, gait) * 0.5 * s;

  /* body: bob twice per stride, roll into each step, lean into the walk */
  j.hips.position.y = hipsY - Math.abs(gait2) * 0.028 * s;
  j.hips.rotation.y = gait * 0.14 * s;
  j.hips.rotation.z = gait2 * 0.03 * s;
  j.spine.rotation.x = 0.1 * s + breath * 0.006 * (1 - s);
  j.spine.rotation.y = -gait * 0.1 * s;
  j.torso.scale.set(1, 1 + breath * 0.008 * (1 - s * 0.7), 1 + breath * 0.016 * (1 - s * 0.7));

  /* head: stays level while the shoulders move under it, and looks around a
     little when standing still */
  j.neck.rotation.x = -0.08 * s + breath * 0.01;
  j.head.rotation.y = (1 - s) * Math.sin(t * 0.42) * 0.28 - gait * 0.05 * s;
  j.head.rotation.x = (1 - s) * Math.sin(t * 0.31) * 0.06;

  if (j.cape) {
    j.cape.rotation.x = -0.05 - 0.22 * s - gait2 * 0.05 * s;
    j.cape.rotation.z = sway * 0.03 * (1 - s) + gait * 0.06 * s;
  }

  /* Blink: the lids swing down over the eyeballs and back, about every four
     seconds, on a period that is not a round number so it never lines up with
     the step. */
  const phase = (t % 4.3) / 4.3;
  const closed = phase > 0.985 ? Math.sin(((phase - 0.985) / 0.015) * Math.PI) : 0;
  const angle = lerp(j.lidOpen, j.lidShut, closed);
  j.lidL.rotation.x = angle;
  j.lidR.rotation.x = angle;
}
