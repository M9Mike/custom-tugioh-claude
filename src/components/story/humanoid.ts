/**
 * The duelist, as an anime game character.
 *
 * This file used to chase anatomy — real deltoid depths, real calf offsets —
 * and the closer it got, the more the result read as a mannequin, because a
 * low-poly body with honest proportions sits exactly in the valley between
 * "person" and "character". So it stopped chasing. The duelist is now drawn
 * the way the games this one grew up on draw theirs: six heads tall with long
 * legs and a slim waist, cel-shaded in three steps, inked along every
 * silhouette, dressed in bold colour-blocked garments with collars that mean
 * it. Stylisation is not a budget cut — it is the look, chosen on purpose,
 * and every table below is authored *to* it.
 *
 * What did not change: everything is still generated — lofted cross-sections,
 * vertex colour, no assets — and the skeleton, the mesh naming the clash
 * audit reads, and the pose/gait contract are the same, so the booth, the
 * world and the lab all keep working while the body inside them is new.
 */

import * as THREE from 'three';
import { CLOTH_COLORS, SKIN_TONES, TRIM_COLORS, type StoryCharacter } from '@/story/character';
import { buildHead } from './head';
import { MeshBuilder, type Profile, limb, sectionPoint, sample } from './loft';
import { addOutline, toonMat } from './toon';

/* ------------------------------------------------------------------ */
/* Tables — authored to the style, in metres on a 1.78 m duelist       */
/* ------------------------------------------------------------------ */

/**
 * The torso in section: height fraction, half-width, front, back, squareness.
 *
 * Anime torso: shoulders carry the width, the waist gives it back, the hip
 * stays modest. The squareness runs high through the chest so the front of
 * the jacket is a *plane* the cel shadow can split cleanly, and drops toward
 * the waist so the middle stays slim from every angle.
 */
const TORSO: Profile = [
  /* v      hw     front   back   square */
  [0.0, 0.148, 0.1, 0.112, 2.2], // hip
  [0.14, 0.138, 0.094, 0.106, 2.15],
  [0.32, 0.124, 0.086, 0.096, 2.1], // waist
  [0.5, 0.132, 0.092, 0.104, 2.2],
  [0.68, 0.15, 0.099, 0.112, 2.35], // ribs
  [0.84, 0.168, 0.103, 0.115, 2.5], // chest
  [0.95, 0.178, 0.1, 0.112, 2.6], // shoulders
  [1.0, 0.175, 0.094, 0.105, 2.6],
];

/** Limb sections: t, half-width, depth, back-offset. Slim, clean taper. */
const UPPER_ARM: Profile = [
  [0.0, 0.024, 0.026, 0.0],
  [0.08, 0.042, 0.045, 0.0],
  [0.2, 0.047, 0.05, -0.002],
  [0.45, 0.043, 0.046, -0.003],
  [0.75, 0.038, 0.04, -0.002],
  [1.0, 0.034, 0.035, 0.0],
];

const FOREARM: Profile = [
  [0.0, 0.034, 0.036, 0.0],
  [0.15, 0.038, 0.04, -0.002],
  [0.45, 0.033, 0.034, -0.001],
  [0.75, 0.027, 0.027, 0.0],
  [1.0, 0.024, 0.021, 0.0],
];

const THIGH: Profile = [
  [0.0, 0.088, 0.095, 0.003],
  [0.12, 0.085, 0.092, 0.001],
  [0.35, 0.075, 0.08, 0.0],
  [0.6, 0.064, 0.068, -0.002],
  [0.85, 0.054, 0.057, -0.001],
  [1.0, 0.05, 0.052, 0.0],
];

const SHIN: Profile = [
  [0.0, 0.05, 0.054, 0.0],
  [0.08, 0.049, 0.055, -0.003],
  [0.24, 0.047, 0.06, -0.013], // the calf still hangs behind the bone
  [0.45, 0.04, 0.049, -0.01],
  [0.7, 0.032, 0.035, -0.004],
  [0.92, 0.027, 0.028, 0.0],
  [1.0, 0.026, 0.029, 0.001],
];

/** The boot's foot, as sections along its length: half-width and height. */
const FOOT: Profile = [
  [0.0, 0.032, 0.062, 0.0],
  [0.14, 0.041, 0.08, 0.0],
  [0.4, 0.045, 0.062, 0.0],
  [0.66, 0.047, 0.046, 0.0],
  [0.88, 0.043, 0.034, 0.0],
  [1.0, 0.034, 0.026, 0.0],
];

/** What the frame choice, and nothing else, decides. */
const FRAME_METRICS = {
  lean: { shoulder: 0.88, chest: 0.88, waist: 0.84, hip: 0.92, limb: 0.88 },
  balanced: { shoulder: 1, chest: 1, waist: 1, hip: 1, limb: 1 },
  sturdy: { shoulder: 1.16, chest: 1.14, waist: 1.18, hip: 1.09, limb: 1.14 },
} as const;

/**
 * What the body plan, and nothing else, decides — applied on top of the frame
 * so every frame exists in both. One table, read by the build *and* by the
 * pose: the arms' resting splay has to clear whatever hips the plan actually
 * built.
 */
const PLAN_METRICS = {
  male: { shoulder: 1, chest: 1, waist: 1, hip: 1, limb: 1 },
  female: { shoulder: 0.84, chest: 0.92, waist: 0.82, hip: 1.06, limb: 0.86 },
} as const;

/**
 * What each outfit id changes about the garment. `collar` is the standing
 * collar's height — the anime coat collar — and `coat` is how far the skirt
 * of it falls, as a fraction of leg.
 */
const OUTFIT_SHAPE = {
  duelist: { coat: 0.0, flare: 1, collar: 0.052, sleeve: 1, pauldron: false, split: 0, hem: 0.05 },
  traveller: { coat: 0.5, flare: 1.55, collar: 0.062, sleeve: 1, pauldron: false, split: 0.3, hem: -0.02 },
  scholar: { coat: 0.88, flare: 1.8, collar: 0.085, sleeve: 1, pauldron: false, split: 0.1, hem: -0.04 },
  warden: { coat: 0.28, flare: 1.4, collar: 0.075, sleeve: 1, pauldron: true, split: 0.2, hem: 0.03 },
  street: { coat: 0.0, flare: 1, collar: 0, sleeve: 0.5, pauldron: false, split: 0, hem: 0.085 },
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
   * @param t      seconds since the rig was built — drives breath, blink, sway
   * @param stride 0 standing, 1 walking at full pace; blended, not switched
   * @param phase  where the gait is, in radians. **Integrated by the caller**,
   *               `gaitRate(stride)` a second — see that function for why it
   *               cannot be computed here as `t` times a rate.
   */
  pose(t: number, stride: number, phase: number): void;
  dispose(): void;
}

/**
 * How fast the gait turns over, in radians a second, at a given fraction of
 * full pace. Exported because whoever moves the duelist has to integrate it.
 *
 * **Integrate it.** A phase computed as `t × rate` jumps by `t × Δrate`
 * whenever the rate changes, and the rate changes every time the stick eases
 * — ten minutes in, that was five thousand gait cycles a second. The caller
 * accumulates `gaitRate(stride) × dt` instead, and the lab integrates the
 * same way so the workbench moves like the game.
 *
 * **The numbers are fitted, not styled.** Ground speed is step length times
 * cadence; the step length is whatever the leg tables and the thigh arc in
 * `pose` actually cover, so this rate is fitted against a simulation of the
 * planted foot until the feet stop sliding: within ±4% across the stick's
 * whole range on the current tables. Retuning the walk means refitting this.
 */
export function gaitRate(stride: number): number {
  const s = Math.min(1, Math.max(0, stride));
  return (5.88 + 0.3 * s) * Math.sqrt(s);
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * clamp01(t);

const REF = 1.78;

export function buildCharacter(spec: StoryCharacter): Rig {
  const kept: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T): T => {
    kept.push(x);
    return x;
  };

  /* ---------------- scale ---------------- */

  const stature = lerp(1.66, 1.9, spec.height);
  const S = stature / REF;
  /**
   * Six heads and a bit. A real adult is seven and a half; the difference is
   * the single loudest stylisation choice on the model, and everything else
   * is proportioned to it.
   */
  const H = stature / 6.15;
  const FR = FRAME_METRICS[spec.frame] ?? FRAME_METRICS.balanced;
  const female = spec.sex === 'female';
  const X = PLAN_METRICS[spec.sex] ?? PLAN_METRICS.male;
  const F = {
    shoulder: FR.shoulder * X.shoulder,
    chest: FR.chest * X.chest,
    waist: FR.waist * X.waist,
    hip: FR.hip * X.hip,
    limb: FR.limb * X.limb,
  };
  const O = OUTFIT_SHAPE[spec.outfit] ?? OUTFIT_SHAPE.duelist;
  /* Wider than life on both ends: a stylised body has to *state* its build,
     and at the old ±10% the three body choices photographed identical. */
  const G = lerp(0.84, 1.34, spec.build);
  /** Radial scale for every limb: stature, frame, build — slimmed to style. */
  const LS = S * F.limb * lerp(0.86, 1.22, spec.build) * 0.96;
  const neckG = S * lerp(0.9, 1.02, spec.build) * (female ? 0.86 : 1) * 0.92;

  /* Long legs, high hip: the anime cut. */
  const hipY = 0.535 * stature;
  const thighL = (0.535 - 0.3) * stature;
  const shinL = (0.3 - 0.042) * stature;
  const ankleY = 0.042 * stature;
  const upperArmL = 0.182 * stature;
  const foreArmL = 0.15 * stature;
  const shoulderY = 0.788 * stature - hipY;
  const neckBaseY = 0.812 * stature - hipY;
  /* Short: an anime neck is a connector, not a feature. The head's own base
     offset supplies the visible length. */
  const neckLen = Math.max(0.012 * S, stature - H - 0.812 * stature - 0.004 * S);

  /* ---------------- materials ---------------- */

  const skinColor = new THREE.Color(SKIN_TONES[spec.skin] ?? SKIN_TONES[0]);
  const skin = keep(toonMat(skinColor, { vertexColors: true }));
  const cloth = (idx: number, fallback: number) =>
    keep(toonMat(CLOTH_COLORS[idx] ?? CLOTH_COLORS[fallback]));
  const primary = cloth(spec.primary, 0);
  const secondary = cloth(spec.secondary, 1);
  const trouser = cloth(spec.trouser, 4);
  const boots = cloth(spec.boots, 5);
  const capeMat = cloth(spec.capeColor, 10);
  const trim = keep(toonMat(TRIM_COLORS[spec.trim] ?? TRIM_COLORS[0]));
  const dark = keep(toonMat('#2a2126'));

  /** Ink weight, scaled with the body so a tall duelist is not finer-lined. */
  const LINE = 0.0034 * S;

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
  chest.position.y = 0.62 * shoulderY;
  spine.add(chest);

  const neck = new THREE.Group();
  neck.position.set(0, neckBaseY - 0.62 * shoulderY, 0);
  chest.add(neck);

  /* `part` names the mesh for the clash audit and nothing else; ink hulls
     stay unnamed so the audit never sees a body two millimetres inside its
     own outline. `line` is the hull thickness — 0 skips the ink, for parts
     that live inside others. */
  const add = (
    parent: THREE.Group,
    geo: THREE.BufferGeometry,
    m: THREE.Material,
    part = '',
    line = 0
  ) => {
    keep(geo);
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = true;
    mesh.name = part;
    parent.add(mesh);
    if (line > 0) addOutline(parent, geo, line, keep);
    return mesh;
  };

  /* ---------------- torso and jacket ---------------- */

  /** Frame/plan multiplier for a torso height: hip → waist → chest → shoulder. */
  const factorAt = (v: number) => {
    if (v < 0.32) return lerp(F.hip, F.waist, v / 0.32);
    if (v < 0.68) return lerp(F.waist, F.chest, (v - 0.32) / 0.36);
    return lerp(F.chest, F.shoulder, (v - 0.68) / 0.32);
  };
  /** Build's girth, strongest at the waist, gentle at the shoulders. */
  const girthAt = (v: number) => lerp(G, 1 + (G - 1) * 0.4, v);
  /**
   * The bust, as extra front depth only, so the upper back stays flat.
   */
  const bustAt = (v: number) => {
    if (!female || v <= 0.5 || v >= 0.74) return 0;
    const u = Math.sin((Math.PI * (v - 0.5)) / 0.24);
    return u * u * (0.02 + 0.008 * (G - 0.9)) * S;
  };

  const torsoAt = (v: number, col: 1 | 2 | 3) => {
    const base = sample(TORSO, v, col) * S * factorAt(v) * girthAt(v);
    return col === 2 ? base + bustAt(v) : base;
  };
  const squareAt = (v: number) => sample(TORSO, v, 4);

  /** One lofted torso surface in a given material, inflated for garments. */
  const torsoLoft = (
    m: MeshBuilder,
    v0: number,
    v1: number,
    inflate: number,
    seg = 26
  ) => {
    const rings: number[][] = [];
    const steps = Math.max(6, Math.round((v1 - v0) * 22));
    for (let i = 0; i <= steps; i++) {
      const v = v0 + ((v1 - v0) * i) / steps;
      const hw = torsoAt(v, 1) + inflate;
      const fr = torsoAt(v, 2) + inflate;
      const bk = torsoAt(v, 3) + inflate;
      const sq = squareAt(v);
      const ring: number[] = [];
      for (let k = 0; k < seg; k++) {
        const a = (k / seg) * Math.PI * 2;
        const q = sectionPoint(hw, fr, bk, sq, a);
        ring.push(m.vertex(q.x, v * shoulderY, q.z));
      }
      rings.push(ring);
    }
    m.loft(rings);
    return rings;
  };

  {
    /* The jacket body. Closed at the top so the collar has ground to stand
       on, open at the hip where the skirt or hem takes over. */
    const m = new MeshBuilder();
    const rings = torsoLoft(m, 0.02, 1, 0.011 * S);
    const topApex = m.vertex(0, shoulderY + 0.02 * S, 0);
    m.cap(rings[rings.length - 1], topApex, 1);
    const lowApex = m.vertex(0, -0.05 * S, 0);
    m.cap(rings[0], lowApex, -1);
    add(torso, m.build(), primary, 'torso', LINE);
  }

  {
    /* The chest panel: a front plate in the secondary colour, the single
       colour-block that gives every outfit a readable front. */
    const m = new MeshBuilder();
    const seg = 14;
    const rings: number[][] = [];
    for (let i = 0; i <= 12; i++) {
      const v = 0.3 + (0.68 * i) / 12;
      const hw = torsoAt(v, 1) + 0.013 * S;
      const fr = torsoAt(v, 2) + 0.013 * S;
      const sq = squareAt(v);
      const ring: number[] = [];
      /* Only the front 100° of the section. */
      for (let k = 0; k <= seg; k++) {
        const a = -0.88 + (1.76 * k) / seg;
        const q = sectionPoint(hw, fr, fr, sq, a);
        ring.push(m.vertex(q.x, v * shoulderY, q.z));
      }
      rings.push(ring);
    }
    for (let i = 0; i < rings.length - 1; i++) {
      for (let k = 0; k < seg; k++) {
        m.quad(rings[i][k], rings[i][k + 1], rings[i + 1][k + 1], rings[i + 1][k]);
      }
    }
    add(torso, m.build(), secondary, '', LINE * 0.8);
  }

  /* Belt and buckle. */
  {
    const m = new MeshBuilder();
    torsoLoft(m, 0.26, 0.36, 0.016 * S, 22);
    add(torso, m.build(), dark, '');
    const buckle = keep(new THREE.BoxGeometry(0.052 * S, 0.045 * S, 0.02 * S));
    const b = new THREE.Mesh(buckle, trim);
    b.position.set(0, 0.31 * shoulderY, torsoAt(0.31, 2) + 0.02 * S);
    torso.add(b);
  }

  /* The coat skirt, split front and back so the legs read through it. */
  if (O.coat > 0) {
    const m = new MeshBuilder();
    const seg = 30;
    const topY = 0.24 * shoulderY;
    const drop = O.coat * (hipY - 0.1 * stature);
    const rows = 9;
    const rings: number[][] = [];
    for (let i = 0; i <= rows; i++) {
      const t = i / rows;
      const flare = 1 + (O.flare - 1) * t * t;
      const hw = (torsoAt(0.24, 1) + 0.02 * S) * flare;
      const fr = (torsoAt(0.24, 2) + 0.02 * S) * flare;
      const bk = (torsoAt(0.24, 3) + 0.02 * S) * flare;
      const ring: number[] = [];
      for (let k = 0; k < seg; k++) {
        const a = (k / seg) * Math.PI * 2;
        const q = sectionPoint(hw, fr, bk, 2.2, a);
        ring.push(m.vertex(q.x, topY - t * drop, q.z));
      }
      rings.push(ring);
    }
    /* The split: skip the quads nearest the front (and back, half as wide)
       below the waist, so the coat hangs as panels rather than a tube. */
    for (let i = 0; i < rows; i++) {
      const t = i / rows;
      for (let k = 0; k < seg; k++) {
        const a = ((k + 0.5) / seg) * Math.PI * 2;
        const away = Math.abs(a > Math.PI ? a - Math.PI * 2 : a);
        const splitFrom = 0.36;
        if (t > splitFrom && O.split > 0) {
          if (away < O.split * (t - splitFrom) * 2.6) continue;
          if (Math.PI - away < O.split * (t - splitFrom) * 1.8) continue;
        }
        m.quad(rings[i][k], rings[i][(k + 1) % seg], rings[i + 1][(k + 1) % seg], rings[i + 1][k]);
      }
    }
    add(torso, m.build(), primary, '', LINE);
  } else if (O.hem > 0) {
    /* No coat: a short hem band finishes the jacket below the belt. */
    const m = new MeshBuilder();
    torsoLoft(m, 0.0, 0.24, 0.014 * S, 24);
    add(torso, m.build(), primary, '', LINE * 0.8);
  }

  /**
   * The neckline, closed. Two pieces, both full rings so there is no free
   * edge anywhere near the face:
   *
   * - a **yoke**: a shallow cone of jacket from the neck's root out to the
   *   shoulders, which is what stops the collar reading as a floating ribbon
   *   around a bare pole — it is the garment the collar grows out of;
   * - the **standing collar** itself, hugging the neck, tall at the back and
   *   dipping to a V at the front so the chin sits in an open frame.
   */
  {
    const yokeBase = neckBaseY - 0.62 * shoulderY;
    const m = new MeshBuilder();
    const seg = 24;
    const inner = neckG * 0.06;
    const rows: number[][] = [];
    for (let i = 0; i <= 3; i++) {
      const t = i / 3;
      const r = lerp(inner, torsoAt(0.96, 1) * 0.98 + 0.011 * S, t * t * 0.55 + t * 0.45);
      const ring: number[] = [];
      for (let k = 0; k < seg; k++) {
        const a = (k / seg) * Math.PI * 2;
        const q = sectionPoint(r, r * 0.82, r * 0.92, 2.3, a);
        ring.push(m.vertex(q.x, yokeBase + 0.012 * S - t * 0.052 * S, q.z));
      }
      rows.push(ring);
    }
    /* Outer ring first, inner last: the surface faces up and out. */
    m.loft([...rows].reverse());
    add(chest, m.build(), primary, '');
  }

  if (O.collar > 0) {
    const m = new MeshBuilder();
    const seg = 24;
    const rows = 5;
    const baseHw = neckG * 0.064 + 0.006 * S;
    const rings: number[][] = [];
    for (let i = 0; i <= rows; i++) {
      const t = i / rows;
      const flare = 1 + t * 0.3;
      const ring: number[] = [];
      for (let k = 0; k < seg; k++) {
        const a = (k / seg) * Math.PI * 2;
        const away = Math.abs(a > Math.PI ? a - Math.PI * 2 : a) / Math.PI;
        /* Low at the front, full height from the shoulders round the back. */
        const hfac = 0.24 + 0.76 * Math.min(1, away * 1.9);
        const q = sectionPoint(baseHw * flare, baseHw * flare * 0.88, baseHw * flare * 1.04, 2.3, a);
        ring.push(
          m.vertex(q.x, neckBaseY - 0.62 * shoulderY + 0.004 * S + t * O.collar * stature * 0.36 * hfac, q.z)
        );
      }
      rings.push(ring);
    }
    m.loft(rings);
    add(chest, m.build(), primary, '', LINE * 0.8);
  }

  /* ---------------- arms ---------------- */

  const shoulderX = torsoAt(0.95, 1) * 0.94;

  const buildArm = (side: 1 | -1) => {
    const arm = new THREE.Group();
    arm.position.set(side * shoulderX, shoulderY - 0.012 * S, 0);
    chest.add(arm);
    /* The group sits at chest height; convert to chest-local. */
    arm.position.y = shoulderY - 0.62 * shoulderY - 0.012 * S;

    const sleeveLen = O.sleeve;
    const sleeved = sleeveLen > 0.05;
    {
      const m = new MeshBuilder();
      /* The upper arm, in sleeve or skin. A short sleeve covers the deltoid
         and hands over to skin — both surfaces are built from the same
         profile so the join is a seam, not a step. */
      if (sleeved) {
        limb(m, UPPER_ARM, upperArmL, {
          scale: LS,
          inflate: 0.008 * S,
          to: Math.min(1, sleeveLen * 2),
          seg: 16,
        });
      }
      const mesh = add(arm, m.build(), primary, 'upperarm', LINE * 0.9);
      mesh.visible = sleeved;
    }
    {
      const m = new MeshBuilder();
      limb(m, UPPER_ARM, upperArmL, { scale: LS, seg: 16 });
      add(arm, m.build(), skin, 'upperarm', sleeveLen >= 1 ? 0 : LINE * 0.8);
    }

    const fore = new THREE.Group();
    fore.position.y = -upperArmL;
    arm.add(fore);
    {
      const m = new MeshBuilder();
      limb(m, FOREARM, foreArmL, { scale: LS, seg: 16 });
      add(fore, m.build(), skin, 'forearm', sleeveLen >= 1 ? 0 : LINE * 0.8);
    }
    if (sleeveLen >= 1) {
      const m = new MeshBuilder();
      limb(m, FOREARM, foreArmL, { scale: LS, inflate: 0.007 * S, to: 0.86, seg: 16 });
      add(fore, m.build(), primary, 'forearm', LINE * 0.9);
      /* Cuff. */
      const c = new MeshBuilder();
      limb(c, FOREARM, foreArmL, { scale: LS, inflate: 0.011 * S, from: 0.72, to: 0.88, seg: 16 });
      add(fore, c.build(), secondary, '');
    }

    /* Gauntlet: a flared, squared bracer over the forearm. */
    if (spec.gauntlet === 'both' || (spec.gauntlet === 'left' && side === 1)) {
      const m = new MeshBuilder();
      const seg = 16;
      const rings: number[][] = [];
      for (let i = 0; i <= 6; i++) {
        const t = 0.45 + (0.55 * i) / 6;
        const flareUp = 1 + (1 - (t - 0.45) / 0.55) * 0.3;
        const rx = (sample(FOREARM, t, 1) * LS + 0.012 * S) * flareUp;
        const rz = (sample(FOREARM, t, 2) * LS + 0.012 * S) * flareUp;
        const ring: number[] = [];
        for (let k = 0; k < seg; k++) {
          const a = (k / seg) * Math.PI * 2;
          const q = sectionPoint(rx, rz, rz, 2.6, a);
          ring.push(m.vertex(q.x, -t * foreArmL, q.z));
        }
        rings.push(ring);
      }
      m.loft([...rings].reverse());
      add(fore, m.build(), trim, 'gauntlet', LINE * 0.8);
    }

    /* The hand: a clean mitt — palm, a fused finger block, a thumb wedge.
       At game distance a hand is a shape, not five shapes. */
    const hand = new THREE.Group();
    hand.position.y = -foreArmL;
    fore.add(hand);
    {
      const m = new MeshBuilder();
      const palmL = 0.062 * S;
      const rows = 7;
      const rings: number[][] = [];
      for (let i = 0; i <= rows; i++) {
        const t = i / rows;
        /* Wrist → knuckles → fingertips in one taper. */
        const w = t < 0.35 ? lerp(0.024, 0.034, t / 0.35) : lerp(0.034, 0.018, (t - 0.35) / 0.65);
        const d = t < 0.35 ? lerp(0.02, 0.017, t / 0.35) : lerp(0.017, 0.011, (t - 0.35) / 0.65);
        const ring: number[] = [];
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2;
          const q = sectionPoint(w * S * F.limb, d * S, d * S, 2.7, a);
          /* Fingers curl gently forward. */
          ring.push(m.vertex(q.x, -t * palmL * 1.9, q.z + 0.055 * palmL * t * t * 1.8));
        }
        rings.push(ring);
      }
      m.loft([...rings].reverse());
      const tip = m.vertex(0, -palmL * 1.9 - 0.006 * S, 0.011 * S);
      m.cap(rings[rows], tip, -1);
      const root = m.vertex(0, 0.008 * S, 0);
      m.cap(rings[0], root, 1);
      /* Thumb. */
      const thumbRings: number[][] = [];
      for (let i = 0; i <= 3; i++) {
        const t = i / 3;
        const r = lerp(0.009, 0.005, t) * S;
        const ring: number[] = [];
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          ring.push(
            m.vertex(
              side * (0.028 * S + t * 0.014 * S) * F.limb,
              -0.022 * S - t * 0.03 * S,
              0.012 * S + t * 0.018 * S + Math.cos(a) * r
            )
          );
        }
        /* Cheap round section: offset circle in x/y. */
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          const idx = ring[k];
          m.pos[idx * 3] += Math.sin(a) * r * 0.9;
          m.pos[idx * 3 + 1] += Math.cos(a) * r * 0.35;
        }
        thumbRings.push(ring);
      }
      m.loft(side === 1 ? thumbRings : [...thumbRings].reverse());
      const thumbTip = m.vertex(side * 0.047 * S * F.limb, -0.057 * S, 0.033 * S);
      m.cap(thumbRings[3], thumbTip, side === 1 ? 1 : -1);
      add(hand, m.build(), skin, 'hand', LINE * 0.7);
    }

    return { arm, fore, hand };
  };

  const L = buildArm(1);
  const R = buildArm(-1);

  /* Pauldrons. */
  if (O.pauldron) {
    for (const side of [1, -1] as const) {
      const m = new MeshBuilder();
      const seg = 16;
      const rings: number[][] = [];
      for (let i = 0; i <= 5; i++) {
        const t = i / 5;
        const r = Math.sin((1 - t * 0.85) * Math.PI * 0.5) * 0.062 * S;
        const ring: number[] = [];
        for (let k = 0; k < seg; k++) {
          const a = (k / seg) * Math.PI * 2;
          const q = sectionPoint(r, r * 0.9, r * 0.9, 2.4, a);
          ring.push(m.vertex(q.x, t * 0.055 * S, q.z));
        }
        rings.push(ring);
      }
      m.loft(rings);
      const apex = m.vertex(0, 0.062 * S, 0);
      m.cap(rings[5], apex, 1);
      const mesh = new THREE.Mesh(keep(m.build()), trim);
      mesh.castShadow = true;
      mesh.position.set(side * (shoulderX + 0.02 * S), shoulderY - 0.62 * shoulderY + 0.02 * S, 0);
      chest.add(mesh);
      addOutline(chest, mesh.geometry as THREE.BufferGeometry, LINE * 0.8, keep).position.copy(mesh.position);
    }
  }

  /* ---------------- legs ---------------- */

  const hipX = torsoAt(0.04, 1) * 0.52;

  const buildLeg = (side: 1 | -1) => {
    const leg = new THREE.Group();
    leg.position.set(side * hipX, 0, 0);
    hips.add(leg);
    {
      const m = new MeshBuilder();
      limb(m, THIGH, thighL, { scale: LS, inflate: 0.006 * S, seg: 18 });
      add(leg, m.build(), trouser, 'thigh', LINE);
    }
    const shin = new THREE.Group();
    shin.position.y = -thighL;
    leg.add(shin);
    {
      /* Trouser to mid-calf, boot from there down, one profile. */
      const m = new MeshBuilder();
      limb(m, SHIN, shinL, { scale: LS, inflate: 0.005 * S, to: 0.5, seg: 18 });
      add(shin, m.build(), trouser, 'shin', LINE * 0.9);
      const b = new MeshBuilder();
      limb(b, SHIN, shinL, { scale: LS, inflate: 0.009 * S, from: 0.42, seg: 18, square: 2.4 });
      add(shin, b.build(), boots, 'shin', LINE);
    }
    const foot = new THREE.Group();
    foot.position.y = -shinL;
    shin.add(foot);
    {
      const m = new MeshBuilder();
      const footL = 0.148 * S;
      const rows = 8;
      const rings: number[][] = [];
      for (let i = 0; i <= rows; i++) {
        const t = i / rows;
        const hw = sample(FOOT, t, 1) * S * F.limb * 1.05;
        const ht = sample(FOOT, t, 2) * S;
        const ring: number[] = [];
        for (let k = 0; k < 14; k++) {
          const a = (k / 14) * Math.PI * 2;
          /* A squared boot toe: the section is a rounded box lying on the
             ground, lofted along the foot's own +Z. */
          const q = sectionPoint(hw, ht, ht * 0.12, 2.8, a);
          ring.push(m.vertex(q.x, Math.max(0.004 * S, q.z) - ankleY + ht * 0, -0.03 * S + t * footL));
        }
        rings.push(ring);
      }
      /* Lofted along Z — not a Y tube, so it is a probe, never a target. */
      for (let i = 0; i < rows; i++) {
        for (let k = 0; k < 14; k++) {
          m.quad(rings[i][(k + 1) % 14], rings[i][k], rings[i + 1][k], rings[i + 1][(k + 1) % 14]);
        }
      }
      const toe = m.vertex(0, 0.012 * S - ankleY, -0.03 * S + footL + 0.008 * S);
      m.cap(rings[rows], toe, -1);
      const heel = m.vertex(0, 0.02 * S - ankleY, -0.036 * S);
      m.cap(rings[0], heel, 1);
      add(foot, m.build(), boots, 'foot', LINE * 0.9);
      /* Sole: a thin dark slab under the foot. */
      const sole = keep(new THREE.BoxGeometry(0.075 * S, 0.014 * S, footL + 0.015 * S));
      const sm = new THREE.Mesh(sole, dark);
      sm.position.set(0, -ankleY + 0.002 * S, -0.03 * S + footL / 2);
      sm.name = 'sole';
      foot.add(sm);
    }
    return { leg, shin, foot };
  };

  const LL = buildLeg(1);
  const RL = buildLeg(-1);

  /* ---------------- cape ---------------- */

  let cape: THREE.Group | null = null;
  if (spec.cape) {
    cape = new THREE.Group();
    cape.position.set(0, shoulderY - 0.62 * shoulderY + 0.01 * S, -(torsoAt(0.9, 3) + 0.016 * S));
    chest.add(cape);
    const m = new MeshBuilder();
    const COLS = 16;
    const ROWS = 10;
    const capeL = 0.52 * stature;
    const grid: number[][] = [];
    for (let i = 0; i <= ROWS; i++) {
      const t = i / ROWS;
      const row: number[] = [];
      for (let k = 0; k <= COLS; k++) {
        const u = k / COLS - 0.5;
        const w = lerp(0.2, 0.42, t * t) * stature;
        /* Falls straight, curls slightly round the body at the top. */
        row.push(m.vertex(u * w, -t * capeL, -t * 0.05 * S + Math.abs(u) * 0.09 * S * (1 - t)));
      }
      grid.push(row);
    }
    for (let i = 0; i < ROWS; i++) {
      for (let k = 0; k < COLS; k++) {
        m.quad(grid[i][k], grid[i][k + 1], grid[i + 1][k + 1], grid[i + 1][k]);
      }
    }
    capeMat.side = THREE.DoubleSide;
    add(cape, m.build(), capeMat, '');
  }

  /* ---------------- head ---------------- */

  const headRig = buildHead(spec, H, skinColor);
  keep(headRig);
  const headG = headRig.group;
  headG.position.y = neckLen;
  neck.add(headG);

  {
    const m = new MeshBuilder();
    const rows = 5;
    const rings: number[][] = [];
    for (let i = 0; i <= rows; i++) {
      const t = i / rows;
      const r = lerp(0.058, 0.052, t) * neckG;
      const ring: number[] = [];
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * Math.PI * 2;
        const q = sectionPoint(r, r * 0.94, r, 2.2, a);
        ring.push(m.vertex(q.x, -0.02 * S + t * (neckLen + 0.09 * S), q.z - 0.004 * S));
      }
      rings.push(ring);
    }
    m.loft(rings);
    add(neck, m.build(), skin, '', LINE * 0.7);
  }

  const height = hipY + neckBaseY + neckLen + headRig.crown;

  /* ---------------- pose ---------------- */

  const j = {
    hips,
    spine,
    chest,
    neck,
    head: headG,
    armL: L.arm,
    armR: R.arm,
    foreL: L.fore,
    foreR: R.fore,
    handL: L.hand,
    handR: R.hand,
    legL: LL.leg,
    legR: RL.leg,
    shinL: LL.shin,
    shinR: RL.shin,
    footL: LL.foot,
    footR: RL.foot,
    cape,
    hair: headRig.hair,
    lidL: headRig.lidL,
    lidR: headRig.lidR,
  };

  /**
   * The arms' resting splay, computed from what was actually built: the
   * forearm (plus its gauntlet, when worn) must hang clear of the thigh
   * this body has. The first cut eyeballed a constant and the clash audit
   * found the gauntlet 25 mm inside the thigh on the default body and 45 mm
   * on the heavy one — clearance is geometry, so it is read from the same
   * tables and scales the geometry came from, never restated.
   */
  const thighOuterX = hipX + sample(THIGH, 0.08, 1) * LS + 0.006 * S;
  /* A heavy build's jacketed waist reaches further out than its thigh does;
     the arm has to clear whichever is widest at the height it hangs. */
  const waistOuterX = torsoAt(0.32, 1) + 0.013 * S;
  const wornGauntlet = spec.gauntlet !== 'none';
  const foreR = wornGauntlet
    ? (sample(FOREARM, 0.45, 1) * LS + 0.012 * S) * 1.3
    : sample(FOREARM, 0.3, 1) * LS + 0.009 * S;
  /* The gauntlet's widest point rides the upper forearm. */
  const armReach = upperArmL + foreArmL * 0.55;
  const needed = Math.max(thighOuterX, waistOuterX) + foreR + 0.012 * S - shoulderX;
  const splay = Math.max(0.07, Math.min(0.34, Math.asin(Math.min(0.9, Math.max(0, needed) / armReach))));

  const TAU = Math.PI * 2;
  /** A smooth window on the cycle: 0 outside `lo..hi`, a sin² hump inside. */
  const wsin = (c: number, lo: number, hi: number) => {
    const d = (((c - lo) % TAU) + TAU) % TAU;
    if (d >= hi - lo) return 0;
    const u = Math.sin((Math.PI * d) / (hi - lo));
    return u * u;
  };

  /* Spring state for the hair and cape — the one place the pose keeps
     memory, because follow-through *is* memory. */
  let lastT = 0;
  let hairSwing = 0;
  let hairVel = 0;
  let lastBob = 0;

  const pose = (t: number, stride: number, phase: number) => {
    const s = clamp01(stride);
    const gs = Math.sqrt(s);
    const c = phase;
    const dt = Math.min(0.05, Math.max(0.0001, t - lastT));
    lastT = t;

    /* ---- idle life: breath, layered sway, slow weight shift ---- */
    const breath = Math.sin(t * 1.8);
    const sway = (Math.sin(t * 0.83 + 1.4) * 0.6 + Math.sin(t * 1.31) * 0.4) * (1 - s);
    const shift = Math.sin(t * 0.19 + 0.7) * (1 - s);

    /* ---- the gait ----
       Convention: rotation.x positive swings a limb backward, a knee flexes
       negative, a foot rotates toe-up positive. Left leg strikes at 3π/2,
       toes off at π/2; the right is half a turn later. */
    const gait = Math.sin(c);

    const leg = (cc: number) => {
      const thigh = Math.sin(cc) * 0.6 * gs - 0.07 * s;
      const knee =
        -0.08 * s -
        1.18 * gs * wsin(cc, Math.PI * 0.36, Math.PI * 1.36) -
        0.26 * s * wsin(cc, Math.PI * 1.5, Math.PI * 2.14);
      const foot =
        -thigh -
        knee -
        0.42 * s * wsin(cc, Math.PI * 0.12, Math.PI * 0.56) +
        0.18 * s * wsin(cc, Math.PI * 1.3, Math.PI * 1.74);
      return { thigh, knee, foot };
    };
    const ll = leg(c);
    const rl = leg(c + Math.PI);

    j.legL.rotation.x = ll.thigh;
    j.shinL.rotation.x = ll.knee;
    j.footL.rotation.x = ll.foot;
    j.legR.rotation.x = rl.thigh;
    j.shinR.rotation.x = rl.knee;
    j.footR.rotation.x = rl.foot;

    /* Standing: a soft knee and a light toe-out, never a locked scarecrow. */
    j.legL.rotation.y = 0.07 * (1 - s);
    j.legR.rotation.y = -0.07 * (1 - s);
    j.shinL.rotation.x += -0.04 * (1 - s);
    j.shinR.rotation.x += -0.04 * (1 - s);
    j.footL.rotation.x += 0.04 * (1 - s);
    j.footR.rotation.x += 0.04 * (1 - s);

    /* ---- pelvis: the engine of the walk ----
       Lowest at double support, swaying onto the planted side, yawing with
       the stride. The bob is what everything above inherits. */
    const bob = -(1 - Math.cos(c * 2)) * 0.017 * s;
    j.hips.position.y = hipY + bob + breath * 0.001 * (1 - s) - 0.004 * s;
    j.hips.position.x = Math.sin(c) * 0.014 * s + shift * 0.006;
    j.hips.rotation.y = gait * 0.13 * s;
    j.hips.rotation.z = gait * 0.045 * s + shift * 0.02;

    /* ---- the lag chain: shoulders follow the hips late, the head
       stabilises against the shoulders later still. The delay is the whole
       difference between a walk and a march. ---- */
    const lag1 = Math.sin(c - 0.5);
    j.spine.rotation.y = -lag1 * 0.15 * s + sway * 0.015;
    j.spine.rotation.z = -lag1 * 0.028 * s + sway * 0.01;
    j.spine.rotation.x = 0.055 * s + Math.cos(c * 2 - 0.4) * 0.016 * s;

    j.chest.rotation.x = breath * 0.014 * (1 - s * 0.5);

    j.neck.rotation.y = lag1 * 0.06 * s - sway * 0.012;
    j.head.rotation.y = Math.sin(c - 0.8) * 0.045 * s + Math.sin(t * 0.4 + 2.1) * 0.05 * (1 - s);
    j.head.rotation.x = -0.045 * s - Math.cos(c * 2 - 0.5) * 0.012 * s + Math.sin(t * 0.31) * 0.02 * (1 - s);
    j.head.rotation.z = Math.sin(t * 0.23 + 1.1) * 0.014 * (1 - s);

    /* ---- arms: swing with lag, elbows fold on the forward pass, wrists
       trail. At rest they hang bent and easy, never straight. ---- */
    const armC = c - 0.28;
    const swing = Math.sin(armC) * 0.52 * gs;
    /* At rest the arm hangs a touch *behind* the hip line, so the bent
       forearm falls beside the thigh rather than across its front — the
       other half of the clearance the splay buys sideways. */
    j.armL.rotation.x = 0.06 * (1 - s) - swing + sway * 0.02;
    j.armR.rotation.x = 0.06 * (1 - s) + swing - sway * 0.02;
    j.armL.rotation.z = splay + 0.02 * Math.sin(t * 1.1) * (1 - s) + 0.05 * s;
    j.armR.rotation.z = -splay - 0.02 * Math.sin(t * 1.27 + 0.9) * (1 - s) - 0.05 * s;

    const foldL = wsin(armC, 0, Math.PI);
    const foldR = wsin(armC, Math.PI, TAU);
    j.foreL.rotation.x = -0.2 - 0.05 * breath * (1 - s) - 0.22 * s - foldL * 0.5 * s;
    j.foreR.rotation.x = -0.2 - 0.05 * breath * (1 - s) - 0.22 * s - foldR * 0.5 * s;

    j.handL.rotation.x = 0.1 + Math.sin(armC - 0.55) * 0.12 * s;
    j.handR.rotation.x = 0.1 + Math.sin(armC + Math.PI - 0.55) * 0.12 * s;

    /* ---- follow-through: hair and cape ride a spring driven by the bob,
       so every step ends with a little settle the body itself already
       finished. ---- */
    const bobVel = (bob - lastBob) / dt;
    lastBob = bob;
    const drive = bobVel * 0.14 + gait * 0.03 * s;
    hairVel += (-hairSwing * 130 - hairVel * 11 + drive * 60) * dt;
    hairSwing += hairVel * dt;
    const hs = Math.max(-0.16, Math.min(0.16, hairSwing));
    if (j.hair) {
      j.hair.rotation.x = hs * 0.55;
      j.hair.position.y = -Math.abs(hs) * 0.006;
    }
    if (j.cape) {
      j.cape.rotation.x = 0.06 + s * 0.14 + hs * 1.3 + Math.sin(t * 0.9) * 0.02 * (1 - s);
    }

    /* ---- blink ---- */
    const blinkT = (t % 3.7) / 3.7;
    const lid = blinkT > 0.96 ? Math.sin(((blinkT - 0.96) / 0.04) * Math.PI) : 0;
    const lidAngle = headRig.lidOpen + (headRig.lidShut - headRig.lidOpen) * lid;
    j.lidL.rotation.x = lidAngle;
    j.lidR.rotation.x = lidAngle;
  };

  pose(0, 0, 0);

  return {
    root,
    height,
    pose,
    dispose() {
      kept.forEach((k) => k.dispose());
    },
  };
}
