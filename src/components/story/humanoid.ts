/**
 * The duelist, built out of primitives from a `StoryCharacter`.
 *
 * One model, two screens: the creation booth rebuilds it on every change to a
 * knob, and the open world builds it once and walks it around. That is the
 * whole reason this is a plain function over a plain record rather than a React
 * component — a character is a description, and the description is what gets
 * stored, sent and re-read a year later.
 *
 * Everything is generated: no meshes are downloaded, nothing is skinned, and
 * there is not a single texture. A body is a chain of `Group`s at the joints
 * with geometry hung off them, so posing is nine or ten Euler angles rather
 * than a bone hierarchy and an animation clip — which keeps the whole of Story
 * Mode's 3D to one dependency and a few hundred triangles per limb, on a phone.
 *
 * Units are metres and the duelist faces +Z. The root's origin is between the
 * feet, at ground level, so placing one in the world is `position.set(x, 0, z)`.
 */

import * as THREE from 'three';
import {
  CLOTH_COLORS,
  EYE_COLORS,
  HAIR_COLORS,
  SKIN_TONES,
  TRIM_COLORS,
  type StoryCharacter,
} from '@/story/character';

/* ------------------------------------------------------------------ */
/* Small builders                                                      */
/* ------------------------------------------------------------------ */

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * A tapered capsule, used for every limb and the neck.
 *
 * `CylinderGeometry` would do at a glance and does not: an arm that ends in a
 * flat disc reads as a pipe, and the discs are exactly what you see at the
 * elbow when the joint bends. Revolving a profile with rounded ends costs the
 * same triangles and gives a limb that stays closed however far it folds.
 */
function limbGeometry(rTop: number, rBot: number, len: number, radial = 14): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [];
  const y0 = -len / 2;
  const y1 = len / 2;
  for (let i = 0; i <= 4; i++) {
    const a = (Math.PI / 2) * (i / 4);
    pts.push(new THREE.Vector2(Math.sin(a) * rBot, y0 - Math.cos(a) * rBot * 0.85));
  }
  for (let i = 4; i >= 0; i--) {
    const a = (Math.PI / 2) * (i / 4);
    pts.push(new THREE.Vector2(Math.sin(a) * rTop, y1 + Math.cos(a) * rTop * 0.85));
  }
  return new THREE.LatheGeometry(pts, radial);
}

/** A rounded box — the shape almost everything hard-edged actually wants. */
function blockGeometry(w: number, h: number, d: number): THREE.SphereGeometry {
  const g = new THREE.SphereGeometry(0.5, 14, 10);
  g.scale(w, h, d);
  return g;
}

/** A Gaussian bump, the shape every feature below is pushed out with. */
const bump = (v: number, centre: number, width: number) => Math.exp(-(((v - centre) / width) ** 2));

/**
 * A head, as one surface.
 *
 * The first version of this was a skull sphere with a jaw sphere, cheek
 * spheres, a brow block and two nose blocks piled on top, and every one of
 * those intersections drew a hard crease across the face — a chin with a seam
 * around it and a nose with a shelf under it. Nothing about lighting or
 * proportion fixes that: two surfaces crossing is two surfaces crossing.
 *
 * So there is exactly one surface. A sphere is squashed into a head-shaped
 * ellipsoid and then every feature is a *displacement field* over it — the jaw
 * tapers the sides below the equator, the brow and cheekbones are Gaussian
 * bumps pushed along +Z, the nose is a narrow ridge down the centre line, the
 * eye sockets are the same thing pushed inward. Normals are recomputed once at
 * the end, so the whole face is smooth and every knob deforms a face rather
 * than moving a part around on one.
 */
function headGeometry(spec: StoryCharacter, R: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(R, 44, 32);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    /* Field lookups use the *undeformed* direction, so one feature moving the
       surface never drags the next one's position with it. */
    const ux = v.x / R;
    const uy = v.y / R;
    const uz = v.z / R;
    const front = Math.max(0, uz);

    let x = v.x * 0.84;
    let y = v.y * 1.05;
    let z = v.z * 0.94;

    /* Jaw and chin. Below the equator the sides draw in — hard for a narrow
       jaw, barely at all for a square one — and the chin comes forward. */
    if (uy < 0) {
      const t = Math.min(1, -uy / 0.92) ** 2;
      x *= 1 - t * lerp(0.44, 0.2, spec.jaw);
      z *= 1 - t * lerp(0.26, 0.1, spec.jaw);
      z += R * t * front * lerp(0.05, 0.13, spec.jaw);
      y -= R * t * 0.05;
    }

    /* Brow ridge, across both eyes and fading out at the temples. */
    const brow = bump(uy, 0.3, 0.17) * bump(ux, 0, 0.55) * front;
    z += R * brow * lerp(0.025, 0.085, spec.brow);

    /* Eye sockets, pushed in so the eyeballs sit in a face rather than on it. */
    const socket = bump(uy, 0.11, 0.13) * (bump(ux, 0.36, 0.2) + bump(ux, -0.36, 0.2)) * front;
    z -= R * socket * 0.075;

    /* Cheekbones. They flatten and slide down with `age`, which is most of what
       makes a face look lived in. */
    const cheek =
      bump(uy, -0.06 - spec.age * 0.1, 0.22) * (bump(ux, 0.6, 0.3) + bump(ux, -0.6, 0.3)) * front;
    z += R * cheek * lerp(0.07, 0.025, spec.age);

    /* And the hollow under them, which only an older face has. */
    const hollow = bump(uy, -0.34, 0.16) * (bump(ux, 0.62, 0.22) + bump(ux, -0.62, 0.22)) * front;
    z -= R * hollow * spec.age * 0.06;

    /* The nose: a ridge down the centre line, widening towards the tip. */
    const noseW = lerp(0.13, 0.21, spec.nose);
    const along = bump(uy, 0.02, 0.26) * Math.max(0, uz - 0.25) / 0.75;
    const across = bump(ux, 0, noseW * (1 + Math.max(0, -uy) * 1.4));
    z += R * Math.max(0, along) * across * lerp(0.16, 0.34, spec.nose);

    /* A slight recess for the mouth, so the lips have somewhere to sit. */
    const lips = bump(uy, -0.46, 0.1) * bump(ux, 0, lerp(0.22, 0.36, spec.mouth)) * front;
    z -= R * lips * 0.03;

    pos.setXYZ(i, x, y, z);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

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
  cape: THREE.Group | null;
  eyeL: THREE.Group | null;
  eyeR: THREE.Group | null;
}

/**
 * Proportions that the frame choice, and nothing else, decides.
 *
 * `depth` is how flat the torso is front-to-back, and it is the number that
 * decides whether a body reads as a body: revolving the silhouette gives a
 * circular cross-section, which is a barrel. Nobody is a barrel.
 */
const FRAME_METRICS = {
  lean: { shoulder: 0.178, hip: 0.1, waist: 0.126, chest: 0.166, depth: 0.6 },
  balanced: { shoulder: 0.202, hip: 0.113, waist: 0.14, chest: 0.185, depth: 0.66 },
  sturdy: { shoulder: 0.234, hip: 0.126, waist: 0.17, chest: 0.212, depth: 0.73 },
} as const;

/** What each outfit id actually changes about the garment. */
const OUTFIT_SHAPE = {
  duelist: { gap: 0, top: 0.6, skirt: 0, flare: 1, collar: 0.07, belt: true, pauldrons: false, sleeve: 1 },
  traveller: { gap: 0.5, top: 0.58, skirt: 0.44, flare: 1.5, collar: 0.05, belt: true, pauldrons: false, sleeve: 1 },
  scholar: { gap: 0.26, top: 0.58, skirt: 0.8, flare: 1.75, collar: 0.045, belt: true, pauldrons: false, sleeve: 1 },
  warden: { gap: 0, top: 0.59, skirt: 0.26, flare: 1.35, collar: 0.065, belt: true, pauldrons: true, sleeve: 1 },
  street: { gap: 0.95, top: 0.5, skirt: 0, flare: 1, collar: 0, belt: true, pauldrons: false, sleeve: 0.45 },
} as const;

export function buildCharacter(spec: StoryCharacter): Rig {
  const kept: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T): T => {
    kept.push(x);
    return x;
  };

  const mat = (color: string, roughness = 0.82, metalness = 0) =>
    keep(new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness, metalness }));

  const skinColor = SKIN_TONES[spec.skin] ?? SKIN_TONES[0];
  const hairColor = HAIR_COLORS[spec.hairColor] ?? HAIR_COLORS[0];
  const skin = mat(skinColor, 0.74);
  /* Double-sided: the hair shell is an open cap, and the inside of it is what
     you see from below and behind the ear. */
  const hair = keep(
    new THREE.MeshStandardMaterial({ color: new THREE.Color(hairColor), roughness: 0.9, side: THREE.DoubleSide })
  );
  const primary = mat(CLOTH_COLORS[spec.primary] ?? CLOTH_COLORS[0], 0.88);
  const secondary = mat(CLOTH_COLORS[spec.secondary] ?? CLOTH_COLORS[1], 0.9);
  const trim = mat(TRIM_COLORS[spec.trim] ?? TRIM_COLORS[0], 0.36, 0.85);
  const trouser = mat(CLOTH_COLORS[spec.trouser] ?? CLOTH_COLORS[4], 0.92);
  const bootMat = mat(CLOTH_COLORS[spec.boots] ?? CLOTH_COLORS[5], 0.7);
  const capeMat = keep(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(CLOTH_COLORS[spec.capeColor] ?? CLOTH_COLORS[10]),
      roughness: 0.94,
      side: THREE.DoubleSide,
    })
  );
  const sclera = mat('#f2ede4', 0.42);
  const iris = mat(EYE_COLORS[spec.eyeColor] ?? EYE_COLORS[0], 0.3);
  const pupil = mat('#0a0a0c', 0.25);
  const mouthMat = mat('#7d4a48', 0.8);

  const m = FRAME_METRICS[spec.frame] ?? FRAME_METRICS.balanced;
  /* Build widens everything that carries weight and, deliberately, the waist
     most of all — scaling a body uniformly just makes a taller person. */
  const girth = lerp(0.86, 1.2, spec.build);
  const waistR = m.waist * lerp(0.84, 1.3, spec.build);
  const chestR = m.chest * girth;
  const hipR = m.hip * girth;
  const shoulderX = m.shoulder * lerp(0.94, 1.08, spec.build);
  const depth = m.depth;

  const shape = OUTFIT_SHAPE[spec.outfit] ?? OUTFIT_SHAPE.duelist;

  const root = new THREE.Group();
  root.name = 'duelist';

  /* ---------------- torso ---------------- */

  /**
   * The hips, and with them where the whole duelist stands.
   *
   * This number is not a style choice — it is the sum of the leg below it. Set
   * to 0.95 the sole came out 7cm above the floor, which on the plinth read as
   * a lighting bug and in the field as a duelist gliding over the grass with
   * their shadow detached. Leg is 0.02 + 0.42 + 0.40 + half a boot.
   */
  const hips = new THREE.Group();
  hips.position.y = 0.878;
  root.add(hips);

  const spine = new THREE.Group();
  hips.add(spine);

  /**
   * The body's silhouette, revolved.
   *
   * The same profile draws the bare torso and the garment over it, the garment
   * simply inflated — which is why a heavy-set duelist's coat is a heavy-set
   * coat rather than the same coat stretched over a different body.
   */
  /* A pelvis is wider than a waist, and `hipR` is the *joint* offset rather
     than a body width — using it for the bottom of the torso gave every duelist
     a waist that flared outward on the way down to a point, which read as a
     tunic tucked into nothing. */
  const pelvisR = waistR * 1.14;

  const torsoProfile = (scale: number, topY: number): THREE.Vector2[] => [
    new THREE.Vector2(0, -0.085 * scale),
    new THREE.Vector2(pelvisR * 0.72 * scale, -0.078 * scale),
    new THREE.Vector2(pelvisR * scale, -0.02 * scale),
    new THREE.Vector2(waistR * scale, 0.08),
    new THREE.Vector2(waistR * 1.03 * scale, 0.18),
    new THREE.Vector2(chestR * 0.95 * scale, 0.3),
    new THREE.Vector2(chestR * scale, 0.4),
    new THREE.Vector2(chestR * 0.78 * scale, topY - 0.05),
    new THREE.Vector2(0.058 * scale, topY),
    new THREE.Vector2(0, topY),
  ];

  const torsoGeo = keep(new THREE.LatheGeometry(torsoProfile(1, 0.56), 22));
  torsoGeo.scale(1, 1, depth);
  const torso = new THREE.Mesh(torsoGeo, secondary);
  spine.add(torso);

  /**
   * Trousers, from the hip down to where the thighs take over.
   *
   * The torso's revolution closes at a point under the hips and the thigh
   * capsules start below that, which left a wedge of nothing between the legs
   * from every angle but dead ahead. This also hides the closing cone itself:
   * the garment's hem stops at the hip and the trousers are what is below it,
   * which is how clothes work and looks like it.
   */
  const seatGeo = keep(
    new THREE.LatheGeometry(
      [
        new THREE.Vector2(0, -0.27),
        new THREE.Vector2(pelvisR * 0.82, -0.25),
        new THREE.Vector2(pelvisR * 0.96, -0.13),
        new THREE.Vector2(pelvisR * 1.0, -0.04),
        new THREE.Vector2(pelvisR * 0.96, 0.0),
        new THREE.Vector2(0, 0.0),
      ],
      22
    )
  );
  seatGeo.scale(1, 1, depth);
  const seat = new THREE.Mesh(seatGeo, trouser);
  hips.add(seat);

  /* The garment. A coat that hangs open is the same revolution with a wedge
     left out of the front — `phi` is measured from +Z, which is the way the
     duelist faces, so the gap lands down the sternum without any bookkeeping. */
  if (shape.top > 0) {
    const coatGeo = keep(
      new THREE.LatheGeometry(
        torsoProfile(1.055, shape.top),
        22,
        shape.gap / 2,
        Math.PI * 2 - shape.gap
      )
    );
    coatGeo.scale(1, 1, depth);
    const coat = new THREE.Mesh(coatGeo, primary);
    coat.material = keep(
      new THREE.MeshStandardMaterial({ color: primary.color.clone(), roughness: 0.88, side: THREE.DoubleSide })
    );
    spine.add(coat);
  }

  /* Coat tails / robe skirt. Open at the bottom, so it reads as cloth with an
     inside rather than a solid cone stuck to the hips. */
  if (shape.skirt > 0) {
    const skirtGeo = keep(
      new THREE.CylinderGeometry(hipR * 1.12, hipR * 1.12 * shape.flare, shape.skirt, 20, 1, true)
    );
    const skirtMat = keep(
      new THREE.MeshStandardMaterial({ color: primary.color.clone(), roughness: 0.9, side: THREE.DoubleSide })
    );
    const skirt = new THREE.Mesh(skirtGeo, skirtMat);
    skirt.position.y = -0.08 - shape.skirt / 2;
    skirt.scale.z = depth;
    hips.add(skirt);
  }

  if (shape.belt) {
    const beltGeo = keep(new THREE.CylinderGeometry(waistR * 1.14, waistR * 1.14, 0.055, 20, 1, true));
    const belt = new THREE.Mesh(beltGeo, mat('#2a2018', 0.7));
    belt.position.y = 0.05;
    belt.scale.z = depth;
    spine.add(belt);

    const buckle = new THREE.Mesh(keep(blockGeometry(0.06, 0.05, 0.03)), trim);
    buckle.position.set(0, 0.05, waistR * depth * 1.17);
    spine.add(buckle);
  }

  if (shape.collar > 0) {
    const collarGeo = keep(
      new THREE.CylinderGeometry(0.074, 0.064, shape.collar * 2, 18, 1, true, shape.gap ? shape.gap / 2 : 0.5, Math.PI * 2 - (shape.gap ? shape.gap : 1))
    );
    const collar = new THREE.Mesh(collarGeo, keep(new THREE.MeshStandardMaterial({ color: primary.color.clone(), roughness: 0.85, side: THREE.DoubleSide })));
    collar.position.y = 0.56;
    spine.add(collar);

    const edgeGeo = keep(new THREE.TorusGeometry(0.0645, 0.0042, 6, 20));
    const edge = new THREE.Mesh(edgeGeo, trim);
    edge.rotation.x = Math.PI / 2;
    edge.position.y = 0.56 + shape.collar;
    spine.add(edge);
  }

  const chest = new THREE.Group();
  chest.position.y = 0.36;
  spine.add(chest);

  /**
   * The shoulders.
   *
   * A revolved torso has no shoulders at all — it tapers to a neck hole, and
   * the arms were hung out in space beside it with a visible notch between. The
   * yoke is the horizontal span across the top of the chest that a torso of
   * revolution cannot describe, and a cap at each arm root is the deltoid that
   * closes the joint. Without both, the duelist reads as a doll with the arms
   * pushed on.
   */
  const yoke = new THREE.Mesh(
    keep(blockGeometry(shoulderX * 2.16, chestR * 0.72, chestR * depth * 1.95)),
    shape.top > 0 ? primary : secondary
  );
  yoke.position.y = 0.11;
  chest.add(yoke);

  const deltoidGeo = keep(new THREE.SphereGeometry(chestR * 0.36, 16, 12));
  for (const side of [-1, 1]) {
    const cap = new THREE.Mesh(deltoidGeo, shape.sleeve > 0 ? primary : skin);
    cap.position.set(side * shoulderX, 0.125, 0);
    cap.scale.set(1, 0.8, 0.86);
    chest.add(cap);
  }

  if (shape.pauldrons) {
    const pauldronGeo = keep(blockGeometry(0.13, 0.09, 0.13));
    for (const side of [-1, 1]) {
      const p = new THREE.Mesh(pauldronGeo, trim);
      p.position.set(side * (shoulderX + 0.012), 0.14, 0);
      chest.add(p);
    }
    const plate = new THREE.Mesh(keep(blockGeometry(chestR * 1.7, 0.3, chestR * depth * 1.5)), trim);
    plate.position.set(0, 0.02, 0.012);
    chest.add(plate);
  }

  /* ---------------- arms ---------------- */

  const armR_ = chestR * 0.29;
  const upperGeo = keep(limbGeometry(armR_, armR_ * 0.82, 0.26));
  const foreGeo = keep(limbGeometry(armR_ * 0.8, armR_ * 0.64, 0.24));
  const sleeveGeo = keep(limbGeometry(armR_ * 1.14, armR_ * 0.92, 0.26 * shape.sleeve));
  /* The lower half of a sleeve. Without it every coat in the game stopped at
     the elbow, which is a distinctive look to give five outfits by accident. */
  const cuffGeo = keep(limbGeometry(armR_ * 0.92, armR_ * 0.74, 0.22));
  const handGeo = keep(blockGeometry(armR_ * 1.5, 0.09, armR_ * 1.1));
  const gauntletGeo = keep(limbGeometry(armR_ * 1.02, armR_ * 0.86, 0.21));

  const arms: THREE.Group[] = [];
  const fores: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(side * shoulderX, 0.14, 0);
    chest.add(arm);
    arms.push(arm);

    const upper = new THREE.Mesh(upperGeo, skin);
    upper.position.y = -0.13;
    arm.add(upper);

    if (shape.sleeve > 0) {
      const sleeve = new THREE.Mesh(sleeveGeo, primary);
      sleeve.position.y = -0.13 + (0.26 * (1 - shape.sleeve)) / 2;
      arm.add(sleeve);
    }

    const fore = new THREE.Group();
    fore.position.y = -0.26;
    arm.add(fore);
    fores.push(fore);

    const forearm = new THREE.Mesh(foreGeo, skin);
    forearm.position.y = -0.12;
    fore.add(forearm);

    const wants =
      spec.gauntlet === 'both' ||
      (spec.gauntlet === 'left' && side < 0) ||
      (spec.gauntlet === 'right' && side > 0);
    if (wants) {
      const g = new THREE.Mesh(gauntletGeo, trim);
      g.position.y = -0.13;
      fore.add(g);
      /* A raised rim where the plate meets the elbow, so the gauntlet reads as
         a thing strapped on rather than a length of gold pipe. */
      const rim = new THREE.Mesh(keep(blockGeometry(armR_ * 2.4, 0.042, armR_ * 2.0)), secondary);
      rim.position.y = -0.025;
      fore.add(rim);
    } else if (shape.sleeve >= 1) {
      const cuff = new THREE.Mesh(cuffGeo, primary);
      cuff.position.y = -0.115;
      fore.add(cuff);
    }

    const hand = new THREE.Mesh(handGeo, skin);
    hand.position.y = -0.27;
    hand.rotation.x = 0.2;
    fore.add(hand);
  }

  /* ---------------- legs ---------------- */

  const thighR = hipR * 0.8;
  const thighGeo = keep(limbGeometry(thighR, thighR * 0.76, 0.4));
  const shinGeo = keep(limbGeometry(thighR * 0.72, thighR * 0.52, 0.38));
  const bootShaftGeo = keep(limbGeometry(thighR * 0.76, thighR * 0.6, 0.2));
  const footGeo = keep(blockGeometry(thighR * 1.2, 0.075, 0.23));

  const legs: THREE.Group[] = [];
  const shins: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(side * hipR * 0.62, -0.02, 0);
    hips.add(leg);
    legs.push(leg);

    const thigh = new THREE.Mesh(thighGeo, trouser);
    thigh.position.y = -0.2;
    leg.add(thigh);

    const shin = new THREE.Group();
    shin.position.y = -0.42;
    leg.add(shin);
    shins.push(shin);

    const calf = new THREE.Mesh(shinGeo, trouser);
    calf.position.y = -0.19;
    shin.add(calf);

    const shaft = new THREE.Mesh(bootShaftGeo, bootMat);
    shaft.position.y = -0.29;
    shin.add(shaft);

    const foot = new THREE.Mesh(footGeo, bootMat);
    foot.position.set(0, -0.4, 0.045);
    shin.add(foot);
  }

  /* ---------------- head ---------------- */

  const neck = new THREE.Group();
  neck.position.y = 0.23;
  chest.add(neck);

  const neckMesh = new THREE.Mesh(keep(limbGeometry(0.05, 0.062, 0.08)), skin);
  neckMesh.position.y = 0.018;
  neck.add(neckMesh);

  const head = new THREE.Group();
  head.position.y = 0.14;
  neck.add(head);

  /**
   * A head is about a seventh of a person and it is *narrow*: half again as
   * tall as it is wide. The jaw, brow, cheekbones and nose are all in here —
   * see `headGeometry`, which builds them as one surface.
   */
  const R = 0.093;
  const skull = new THREE.Mesh(keep(headGeometry(spec, R)), skin);
  head.add(skull);

  /**
   * Eyes.
   *
   * An eye is about an eighth of the width of a head. It was a quarter here at
   * first, which is exactly the difference between a duelist and a plush toy.
   *
   * There is no eyelid mesh, and there were two of them before there wasn't. A
   * lid is a shell around the eyeball, so opening it means moving the rim up
   * the ball's curve — and any lid big enough to close the eye is, when raised,
   * *narrower* than the ball at that height, so the eyeball bursts through the
   * top of its own lid. Sliding it, scaling it and re-cutting it all failed the
   * same way. What works is the oldest trick there is: the whole socket
   * squashes to a sliver, and what is behind it is the face. A closed eye is a
   * line on a cheek, which is what a closed eye looks like.
   */
  const eyeR = lerp(0.0165, 0.0135, spec.eyeShape);
  const eyeY = R * 0.1;
  const eyeX = R * 0.33;
  const eyeZ = R * 0.71;
  const eyeGeo = keep(new THREE.SphereGeometry(eyeR, 14, 12));
  const irisGeo = keep(new THREE.CircleGeometry(eyeR * 0.6, 14));
  const pupilGeo = keep(new THREE.CircleGeometry(eyeR * 0.28, 12));
  /* A dark line along the top of each eye. Two triangles, and they do more for
     whether a face reads as a face than anything else on it. */
  const lashGeo = keep(blockGeometry(eyeR * 2.15, eyeR * 0.3, eyeR * 1.5));
  const lashMat = mat('#2b2320', 0.9);
  const sockets: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const socket = new THREE.Group();
    socket.position.set(side * eyeX, eyeY, eyeZ);
    /* Turned outwards a little, following the curve of the face — eyes set flat
       on the front of a head stare in parallel and look glazed. */
    socket.rotation.y = side * 0.22;
    head.add(socket);
    sockets.push(socket);

    const ball = new THREE.Mesh(eyeGeo, sclera);
    ball.scale.set(1, lerp(0.86, 0.62, spec.eyeShape), 0.78);
    socket.add(ball);

    const ir = new THREE.Mesh(irisGeo, iris);
    ir.position.z = eyeR * 0.74;
    socket.add(ir);

    const pu = new THREE.Mesh(pupilGeo, pupil);
    pu.position.z = eyeR * 0.77;
    socket.add(pu);

    const lash = new THREE.Mesh(lashGeo, lashMat);
    lash.position.set(0, eyeR * lerp(0.72, 0.52, spec.eyeShape), eyeR * 0.2);
    socket.add(lash);
  }

  /* The brows are the only thing on the face still added on top, because they
     are hair and not skin: they carry the hair's colour, which is what stopped
     black-haired duelists having blond eyebrows. */
  const browGeo = keep(blockGeometry(R * 0.44, lerp(0.007, 0.016, spec.brow), 0.016));
  for (const side of [-1, 1]) {
    const brow = new THREE.Mesh(browGeo, hair);
    brow.position.set(side * eyeX, eyeY + eyeR * 2.1, eyeZ * 1.06);
    brow.rotation.z = side * lerp(0.26, -0.12, spec.brow);
    brow.rotation.y = -side * 0.2;
    head.add(brow);
  }

  const mouth = new THREE.Mesh(keep(blockGeometry(lerp(0.028, 0.046, spec.mouth), 0.0085, 0.012)), mouthMat);
  mouth.position.set(0, -R * 0.44, R * 0.71);
  head.add(mouth);

  /* Ears, on the skull rather than the jaw, and pushed out far enough to be
     seen from the front — otherwise they are geometry nobody ever renders. */
  const earGeo = keep(blockGeometry(0.014, 0.042, 0.026));
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(earGeo, skin);
    ear.position.set(side * R * 0.78, eyeY - R * 0.12, -R * 0.02);
    ear.rotation.z = side * 0.12;
    head.add(ear);
  }

  addHair(head, spec, hair, R, keep);
  addFacialHair(head, spec, hairColor, R, keep, mat);

  /* ---------------- cape ---------------- */

  let capeGroup: THREE.Group | null = null;
  if (spec.cape) {
    capeGroup = new THREE.Group();
    capeGroup.position.set(0, 0.15, -chestR * depth * 0.7);
    chest.add(capeGroup);

    /* A cloak hanging off the shoulders, not a tent pitched over the duelist:
       it covers the back and about a third of each side, and flares by half.
       At twice the chest at the hem it engulfed the whole body from behind and
       the character underneath stopped being visible at all. */
    const capeGeo = keep(
      new THREE.CylinderGeometry(chestR * 1.05, chestR * 1.55, 0.8, 18, 3, true, Math.PI * 0.52, Math.PI * 0.96)
    );
    const cape = new THREE.Mesh(capeGeo, capeMat);
    cape.position.y = -0.38;
    cape.scale.z = 1.15;
    capeGroup.add(cape);

    const clasp = new THREE.Mesh(keep(new THREE.TorusGeometry(0.05, 0.008, 6, 16)), trim);
    clasp.rotation.x = Math.PI / 2;
    clasp.position.set(0, 0.05, chestR * depth * 0.7);
    capeGroup.add(clasp);
  }

  /* ---------------- shadows ---------------- */

  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  const heightScale = lerp(0.92, 1.1, spec.height);
  root.scale.setScalar(heightScale);

  const joints: Joints = {
    hips,
    spine,
    chest,
    neck,
    head,
    armL: arms[0],
    armR: arms[1],
    foreL: fores[0],
    foreR: fores[1],
    legL: legs[0],
    legR: legs[1],
    shinL: shins[0],
    shinR: shins[1],
    cape: capeGroup,
    eyeL: sockets[0] ?? null,
    eyeR: sockets[1] ?? null,
  };

  const hipsY = hips.position.y;

  return {
    root,
    height: 1.74 * heightScale,
    dispose() {
      for (const k of kept) k.dispose();
    },
    pose(t, stride) {
      pose(joints, t, stride, hipsY, spec);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Hair                                                               */
/* ------------------------------------------------------------------ */

function addHair(
  head: THREE.Group,
  spec: StoryCharacter,
  hair: THREE.Material,
  R: number,
  keep: <T extends { dispose(): void }>(x: T) => T
) {
  /* The skull's own squash, so hair sits on the head rather than around it. */
  const SX = 0.855;
  const SY = 1.06;
  const SZ = 0.955;

  /**
   * A hairline, which no sphere can draw.
   *
   * Hair comes down past the ears at the back and sides and stops well above
   * the brows at the front. A cap with one cut angle therefore either buries
   * the eyes or sits on the crown like a beanie — both were tried. Two caps,
   * one cut low and one cut high, was tried after that, and left a step down
   * each temple where the two edges met at right angles.
   *
   * So the cut angle is a *function of the angle round the head*: high at the
   * front, easing to low by the ears, and the surface is generated directly
   * over that. It is thirty lines of parametric geometry and it is the
   * difference between hair and a hat.
   */
  const shell = (radius: number, lowTheta: number, highTheta: number) => {
    const SEG = 30;
    const RINGS = 14;
    const pos: number[] = [];
    const idx: number[] = [];
    /* 0 at the face, 1 by the ears and everywhere behind them. */
    const smooth = (t: number) => t * t * (3 - 2 * t);
    const cut = (phi: number) => {
      const away = Math.abs(Math.atan2(Math.sin(phi), Math.cos(phi))) / Math.PI;
      return lerp(highTheta, lowTheta, smooth(Math.min(1, away / 0.42)));
    };

    for (let i = 0; i <= SEG; i++) {
      const phi = (i / SEG) * Math.PI * 2;
      const thetaMax = cut(phi);
      for (let j = 0; j <= RINGS; j++) {
        const theta = (j / RINGS) * thetaMax;
        const s = Math.sin(theta);
        pos.push(radius * s * Math.sin(phi) * SX, radius * Math.cos(theta) * SY, radius * s * Math.cos(phi) * SZ);
      }
    }
    for (let i = 0; i < SEG; i++) {
      for (let j = 0; j < RINGS; j++) {
        const a = i * (RINGS + 1) + j;
        const b = a + RINGS + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const geo = keep(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, hair);
    head.add(mesh);
  };

  if (spec.hair === 'shaved') {
    /* Not "no hair" — a shaved head still has a hairline, and without one the
       skull reads as a bald egg whatever colour was chosen. */
    shell(R * 1.008, Math.PI * 0.56, Math.PI * 0.28);
    return;
  }

  if (spec.hair !== 'mohawk') shell(R * 1.06, Math.PI * 0.58, Math.PI * 0.3);

  const add = (geo: THREE.BufferGeometry, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rx = 0) => {
    const mesh = new THREE.Mesh(keep(geo), hair);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.rotation.x = rx;
    head.add(mesh);
    return mesh;
  };

  switch (spec.hair) {
    case 'crop':
      break;
    case 'swept':
      /* Volume swept back off the forehead and gathered behind the crown. */
      add(new THREE.SphereGeometry(R * 0.78, 16, 12), 0, R * 0.4, -R * 0.42, SX, 0.66, 1.1);
      break;
    case 'spiked':
      for (let i = 0; i < 7; i++) {
        const a = (i / 6 - 0.5) * 1.9;
        const spike = new THREE.Mesh(keep(new THREE.ConeGeometry(R * 0.17, R * 0.72, 7)), hair);
        spike.position.set(Math.sin(a) * R * 0.5, R * 0.9, Math.cos(a) * R * 0.36 - R * 0.08);
        spike.rotation.x = -0.5 + Math.cos(a) * 0.35;
        spike.rotation.z = -Math.sin(a) * 0.5;
        head.add(spike);
      }
      break;
    case 'curtain':
      for (const side of [-1, 1]) {
        add(new THREE.SphereGeometry(R * 0.34, 14, 12), side * R * 0.6, R * 0.1, R * 0.42, 0.62, 1.7, 0.68);
      }
      break;
    case 'wild':
      for (let i = 0; i < 11; i++) {
        const a = (i / 11) * Math.PI * 2;
        const r = R * (0.42 + ((i * 7) % 5) * 0.08);
        add(
          new THREE.SphereGeometry(R * 0.3, 10, 8),
          Math.sin(a) * r * SX,
          R * (0.52 + ((i * 3) % 4) * 0.13),
          Math.cos(a) * r * 0.9
        );
      }
      break;
    case 'long':
      add(new THREE.SphereGeometry(R * 0.82, 16, 14), 0, -R * 0.6, -R * 0.4, 1.02, 2.5, 0.74);
      break;
    case 'ponytail': {
      const tail = new THREE.Mesh(keep(new THREE.CylinderGeometry(R * 0.2, R * 0.08, R * 2, 10)), hair);
      tail.position.set(0, -R * 0.5, -R * 0.94);
      tail.rotation.x = -0.42;
      head.add(tail);
      add(new THREE.SphereGeometry(R * 0.26, 12, 10), 0, R * 0.26, -R * 0.86);
      break;
    }
    case 'topknot':
      add(new THREE.SphereGeometry(R * 0.3, 14, 12), 0, R * 1.2, -R * 0.08);
      add(new THREE.CylinderGeometry(R * 0.12, R * 0.12, R * 0.22, 10), 0, R * 1, -R * 0.08);
      break;
    case 'braids':
      for (const side of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          add(new THREE.SphereGeometry(R * 0.17, 10, 8), side * R * 0.72, -R * (0.26 + i * 0.4), R * 0.02, 1, 1.15, 1);
        }
      }
      break;
    case 'mohawk': {
      /* Shaved at the sides, and the strip stands proud along the crown. */
      shell(R * 1.005, Math.PI * 0.56, Math.PI * 0.28);
      const strip = new THREE.Mesh(
        keep(new THREE.SphereGeometry(R * 1.05, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.56)),
        hair
      );
      strip.scale.set(0.2, 1.55, SZ);
      strip.position.y = R * 0.04;
      head.add(strip);
      break;
    }
    case 'bun':
      add(new THREE.SphereGeometry(R * 0.36, 14, 12), 0, R * 0.46, -R * 0.88);
      break;
  }
}

/* ------------------------------------------------------------------ */
/* Facial hair                                                        */
/* ------------------------------------------------------------------ */

function addFacialHair(
  head: THREE.Group,
  spec: StoryCharacter,
  hairColor: string,
  R: number,
  keep: <T extends { dispose(): void }>(x: T) => T,
  mat: (color: string, roughness?: number, metalness?: number) => THREE.MeshStandardMaterial
) {
  if (spec.facialHair === 'none') return;

  /* Stubble is the same shell as a beard with the opacity turned down, which is
     also what stubble is. */
  const stubbly = spec.facialHair === 'stubble';
  const beardMat = stubbly
    ? keep(
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(hairColor),
          roughness: 0.95,
          transparent: true,
          opacity: 0.42,
        })
      )
    : mat(hairColor, 0.93);

  const moustache = () => {
    const m = new THREE.Mesh(keep(blockGeometry(0.042, 0.012, 0.018)), beardMat);
    m.position.set(0, -R * 0.31, R * 0.68);
    head.add(m);
  };

  /* The lower band of a sphere sitting just outside the jaw's own — so a beard
     follows whatever jaw was chosen instead of being one fixed shape stuck on
     every face. */
  const jawShell = (drop: number) => {
    const shell = new THREE.Mesh(
      keep(new THREE.SphereGeometry(R, 20, 16, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5)),
      beardMat
    );
    shell.scale.set(lerp(0.62, 0.84, spec.jaw) * 1.03, (lerp(0.62, 0.76, spec.jaw) + drop) * 1.03, 0.9);
    shell.position.set(0, -R * 0.32, R * 0.12);
    head.add(shell);
  };

  switch (spec.facialHair) {
    case 'stubble':
      jawShell(0);
      moustache();
      break;
    case 'moustache':
      moustache();
      break;
    case 'goatee': {
      moustache();
      const chin = new THREE.Mesh(keep(blockGeometry(0.038, 0.05, 0.036)), beardMat);
      chin.position.set(0, -R * 0.6, R * 0.5);
      head.add(chin);
      break;
    }
    case 'full':
      jawShell(0.34);
      moustache();
      break;
    case 'sideburns':
      for (const side of [-1, 1]) {
        const s = new THREE.Mesh(keep(blockGeometry(0.014, 0.06, 0.026)), beardMat);
        s.position.set(side * R * 0.72, -R * 0.16, R * 0.1);
        head.add(s);
      }
      break;
  }
}

/* ------------------------------------------------------------------ */
/* Posing                                                             */
/* ------------------------------------------------------------------ */

/**
 * One function for standing and for walking, blended by `stride`.
 *
 * Two separate animations that swap at a threshold read as a snap however
 * carefully they are matched at the seam, and the seam is exactly where the
 * player's thumb spends its time — nudging the stick and letting go. So both
 * are written as amplitudes and summed: standing is the walk with its stride
 * turned to nothing, plus a breath the walk keeps anyway.
 */
function pose(j: Joints, t: number, stride: number, hipsY: number, spec: StoryCharacter) {
  const s = Math.max(0, Math.min(1, stride));
  /* One step every ~0.55s at full pace, and the cycle keeps turning at a floor
     speed when standing so the arms never freeze mid-swing. */
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

  /* arms: counter-swing, plus a resting angle so they never clip the coat */
  const rest = 0.06 + 0.02 * spec.build;
  j.armL.rotation.x = -gait * swing * 0.72 + sway * 0.03 * (1 - s);
  j.armR.rotation.x = gait * swing * 0.72 - sway * 0.03 * (1 - s);
  j.armL.rotation.z = rest + 0.12 * s;
  j.armR.rotation.z = -rest - 0.12 * s;
  j.foreL.rotation.x = -0.18 - Math.max(0, -gait) * 0.5 * s;
  j.foreR.rotation.x = -0.18 - Math.max(0, gait) * 0.5 * s;

  /* body: bob twice per stride, roll into each step, lean into the walk */
  j.hips.position.y = hipsY - Math.abs(gait2) * 0.028 * s;
  j.hips.rotation.y = gait * 0.14 * s;
  j.hips.rotation.z = gait2 * 0.03 * s;
  j.spine.rotation.x = 0.11 * s + breath * 0.006 * (1 - s);
  j.spine.rotation.y = -gait * 0.1 * s;
  j.chest.scale.set(1, 1 + breath * 0.012 * (1 - s * 0.7), 1 + breath * 0.02 * (1 - s * 0.7));

  /* head: stays level while the shoulders move under it, and looks around a
     little when standing still */
  j.neck.rotation.x = -0.09 * s + breath * 0.01;
  j.head.rotation.y = (1 - s) * Math.sin(t * 0.42) * 0.28 - gait * 0.05 * s;
  j.head.rotation.x = (1 - s) * Math.sin(t * 0.31) * 0.06;

  if (j.cape) {
    j.cape.rotation.x = -0.05 - 0.22 * s - gait2 * 0.05 * s;
    j.cape.rotation.z = sway * 0.03 * (1 - s) + gait * 0.06 * s;
  }

  /* Blink: the eyes squash shut and come back over about 130ms, roughly every
     four seconds, on a period that is not a round number so it never lines up
     with the step. Interpolated rather than switched — an eye that teleports
     shut between two frames is a flicker, not a blink. */
  const phase = (t % 4.3) / 4.3;
  const closed = phase > 0.985 ? Math.sin(((phase - 0.985) / 0.015) * Math.PI) : 0;
  const open = lerp(1, 0.06, closed);
  if (j.eyeL) j.eyeL.scale.y = open;
  if (j.eyeR) j.eyeR.scale.y = open;
}
