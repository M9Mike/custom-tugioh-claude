/**
 * Things a duelist wears that the model did not come with.
 *
 * The vendored models are finished people, and finished people are generic:
 * twelve archetypes covering "punk", "suit", "king". A *named* character is
 * the archetype plus the two or three props everyone pictures when they hear
 * the name — Grandpa's bandana, and in time a duel disk on somebody's arm.
 * Those are small pieces of generated geometry hung off a bone, which is why
 * they live here and not in a `.glb`: one accessory is thirty lines and no
 * download.
 *
 * The rule that makes this safe to grow: an accessory is **attached to a
 * bone**, so it rides the skeleton for free. Every clip the model plays —
 * idle, walk, run, and the attack clips waiting for the duels — moves it
 * correctly without this file knowing any of them exist.
 *
 * Sizes are in bone space, which the rig scales along with everything else,
 * so an accessory authored on one model is the same size on a taller one.
 */

import * as THREE from 'three';

/** What an authored character asks for, in data a record can hold. */
export interface AccessorySpec {
  kind: AccessoryKind;
  /** The bone it rides. `Head`, `Wrist.L`… — spelled as the rig spells it. */
  bone: string;
  /** Its main colour, as hex. */
  color: string;
  /** A second colour where the piece has one; ignored where it does not. */
  accent?: string;
  /** Multiplies the built size, for a piece that wants to sit differently. */
  scale?: number;
}

export type AccessoryKind = 'bandana' | 'beard';

export interface BuiltAccessory {
  object: THREE.Object3D;
  dispose(): void;
}

/* ------------------------------------------------------------------ */
/* The head, in bone space                                             */
/* ------------------------------------------------------------------ */

/**
 * Where the face is, in the `Head` bone's own coordinates.
 *
 * **Every number here is measured, and the measuring is automated.**
 * `/diag/npc?calib=1` hangs a ladder of markers off the `Head` bone — red every
 * 0.10, white every 0.05, plus axis dots at ±0.10 — and photographs the head
 * behind it. `npm run faces -- --bare --calib` redraws it, and the same run
 * prints every material's extents on one line.
 *
 * The ladder is the authority because it lives in **the same space accessories
 * do**: it is a child of the bone, exactly as they are. That distinction cost
 * three wrong fits. The first guessed the skull outright and built a bandana
 * three times too big. The second measured the head's own vertices — correct
 * arithmetic, and it gave the head's *size* right — but expressed them in a
 * frame whose origin sits a head-height below where a child of the bone starts,
 * so every piece was built far too low and the face ended up around the man's
 * collar. A measurement is only useful in the space you are going to build in.
 *
 * The two agree once the offset is known, and between them they give
 * everything: the ladder fixes the origin, the vertex dump gives extents per
 * material. On the `punk` body these numbers are, in child space:
 *
 *     Skin        x ±0.096  y  0.002 … 0.178   z −0.071 … 0.120
 *     Hair        x ±0.085  y  0.067 … 0.233   z −0.092 … 0.106
 *     Eyebrows              y  0.119 … 0.136
 *     Eye                   y  0.107 … 0.128
 *
 * **These are per model.** Heads across the pack sit at different heights on
 * their bones — the `king` carries its face 0.05 higher than the `punk` does —
 * so a second character on a different body re-runs the ladder rather than
 * inheriting this. That is a morning's work saved, not a day's.
 */
export interface HeadMetrics {
  /** Half-width and half-depth of the cranium, and where its centre sits in z. */
  radiusX: number;
  radiusZ: number;
  centreZ: number;
  /** How much a worn piece stands off the head so it reads as *on* it. */
  clearance: number;
  /** Above the brows: where a hem crosses. */
  hemY: number;
  /** Top of the hair, which is what a cap actually has to clear. */
  crownY: number;
  /** The underside of the jaw. */
  chinY: number;
  /** The tip of the nose: everything on the face is placed against it. */
  noseY: number;
  noseZ: number;
}

/**
 * One entry per model that anybody wears anything on.
 *
 * **Heads are not interchangeable.** They sit at different heights on their
 * bones across the pack — the `punk` carries its eyes a full 0.04 below where
 * the `suit` does, which is a third of a face — so a bandana fitted on one is
 * around the chin on another. A model with no row here is an authoring mistake
 * and says so rather than silently misplacing somebody's hair.
 */
const HEADS: Record<string, HeadMetrics> = {
  punk: {
    radiusX: 0.088,
    radiusZ: 0.099,
    centreZ: 0.007,
    clearance: 1.13,
    hemY: 0.145,
    crownY: 0.233,
    chinY: 0.002,
    noseY: 0.077,
    noseZ: 0.12,
  },
  /*
   * An imported body, and the numbers look nothing like the vendored ones
   * because the unit does not: this rig runs about 0.09 units to the metre
   * where the roster runs 0.92, so everything here is roughly ten times the
   * punk's. Read off `/diag/npc?only=grandpa&calib=1&bare=1`, whose ladder is
   * drawn in metres for exactly this reason.
   */
  man1: {
    radiusX: 1.67,
    radiusZ: 1.82,
    centreZ: 0.15,
    /* Wide, because what a cap has to clear here is a full head of hair rather
       than a skull — at 1.06 the bandana sat *inside* it and showed as a
       patch. */
    clearance: 1.34,
    hemY: 2.75,
    crownY: 4.9,
    chinY: 0.24,
    /*
     * The nose, not the bridge between the eyes. 1.62 was the first reading and
     * it put the moustache across his eyes like a pair of goggles: the ladder
     * steps 0.05 m, this rig runs 0.0896 bone units to the metre, so 1.62 units
     * is 0.145 m up — a whole rung above the nose. These faces are drawn, not
     * modelled, so the feature to measure against is the paint.
     */
    noseY: 0.95,
    noseZ: 1.95,
  },
  hoodie: {
    radiusX: 0.092,
    radiusZ: 0.103,
    centreZ: 0.005,
    clearance: 1.1,
    hemY: 0.175,
    crownY: 0.27,
    chinY: 0.003,
    noseY: 0.105,
    noseZ: 0.122,
  },
};

/** The metrics for a model, or `null` if nobody has measured it yet. */
export function headFor(modelId: string): HeadMetrics | null {
  return HEADS[modelId] ?? null;
}

/**
 * A bandana: a band round the skull with the crown of it filled in, and a
 * knot at the back.
 *
 * Built as a lathe-free stack of rings rather than a torus, because a torus
 * is a tube lying *on* a head and a bandana is cloth *round* one — the
 * difference is a flat outer wall and a hem, and it is most of what makes
 * this read as tied on rather than balanced on top.
 */
function bandana(color: string, accent: string | undefined, scale: number, HEAD: HeadMetrics) {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];

  const cloth = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 1, metalness: 0 });
  disposables.push(cloth);

  /*
   * Every size here is a fraction of the head's own radius, never a number of
   * units.
   *
   * The units are not comparable across rigs — the vendored roster runs about
   * 0.92 of them to the metre and the imported bodies about 0.09 — so a knot
   * authored as "0.024" is a knot on one model and a speck on the other. It was
   * a speck: moving Grandpa to an imported body left him under a smooth dome
   * with no band, no knot and no tails, because all three had shrunk by ten.
   */
  const oval = HEAD.radiusZ / HEAD.radiusX;
  const r = HEAD.radiusX;
  const R = r * HEAD.clearance * scale;
  const cz = HEAD.centreZ * scale;
  const bandBottom = HEAD.hemY * scale;
  const bandTop = (HEAD.hemY + r * 0.55) * scale;
  const band = new THREE.CylinderGeometry(R, R * 1.05, bandTop - bandBottom, 24, 1, true);
  band.scale(1, 1, oval);
  disposables.push(band);
  const bandMesh = new THREE.Mesh(band, cloth);
  bandMesh.position.set(0, (bandBottom + bandTop) / 2, cz);
  bandMesh.castShadow = true;
  group.add(bandMesh);

  /* The crown of it: a dome closing the top, so this is a cap and not a ring —
     the whole top of the head is cloth. Squashed to land just above the bare
     skull rather than ballooning over it. */
  const capRise = HEAD.crownY + r * 0.14 - (HEAD.hemY + r * 0.55);
  const cap = new THREE.SphereGeometry(R, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.5);
  cap.scale(1, capRise / R, oval);
  disposables.push(cap);
  const capMesh = new THREE.Mesh(cap, cloth);
  capMesh.position.set(0, bandTop, cz);
  capMesh.castShadow = true;
  group.add(capMesh);

  /* The knot, at the back on the band itself. */
  const knot = new THREE.SphereGeometry(r * 0.27 * scale, 10, 8);
  disposables.push(knot);
  const knotMesh = new THREE.Mesh(knot, cloth);
  knotMesh.position.set(0, (HEAD.hemY + r * 0.2) * scale, cz - R * oval * 0.98);
  knotMesh.castShadow = true;
  group.add(knotMesh);

  /* Two short tails hanging off the knot. */
  for (const side of [-1, 1]) {
    const tail = new THREE.ConeGeometry(r * 0.16 * scale, r * 0.68 * scale, 6);
    disposables.push(tail);
    const tailMesh = new THREE.Mesh(tail, cloth);
    tailMesh.position.set(side * r * 0.2 * scale, (HEAD.hemY - r * 0.16) * scale, cz - R * oval * 0.96);
    tailMesh.rotation.x = -0.25;
    tailMesh.rotation.z = side * 0.22;
    tailMesh.castShadow = true;
    group.add(tailMesh);
  }

  /* The pattern across the front, when one is asked for: two flat chevrons,
     which is all that survives being looked at from three metres away. */
  if (accent) {
    const mark = new THREE.MeshStandardMaterial({
      color: new THREE.Color(accent),
      roughness: 1,
      metalness: 0,
    });
    disposables.push(mark);
    for (const side of [-1, 1]) {
      const bar = new THREE.BoxGeometry(r * 0.17 * scale, r * 0.34 * scale, r * 0.07 * scale);
      disposables.push(bar);
      const barMesh = new THREE.Mesh(bar, mark);
      barMesh.position.set(side * r * 0.3 * scale, (HEAD.hemY + r * 0.27) * scale, cz + R * oval * 0.92);
      barMesh.rotation.z = side * 0.32;
      group.add(barMesh);
    }
  }

  return {
    object: group,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

/**
 * A moustache and a short beard, as three shapes and no more.
 *
 * Every version of this that tried to be hair lost: strands at this size are
 * smaller than the shadow they cast, and the face turned into grey noise. What
 * survives being looked at from three metres is the *outline* — a bar across
 * the upper lip and a mass under the jaw coming to a point — which is also how
 * the character is drawn.
 */
function beard(color: string, scale: number, HEAD: HeadMetrics) {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const hair = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: 1,
    metalness: 0,
  });
  disposables.push(hair);

  /* The jaw. Set forward as well as down: the chin is at the *front* of the
     head, and a beard centred on the bone is a beard inside the skull. */
  /*
   * Sized against the *face*, which on these heads is the bottom third of a
   * very large cranium. Fractions fitted to the whole head radius — which is
   * what the first version did, on a realistically proportioned model — come
   * out as a mask covering everything from the brow down.
   *
   * `scale` is deliberately not the lever for that: it multiplies the offsets
   * as well as the sizes, so shrinking the beard also walks it back into the
   * neck, where it disappears entirely. Ask for a smaller beard and you get no
   * beard. The sizes are small here instead.
   */
  /*
   * The jaw has to clear the mouth. At 0.46 of the head's half-width it is a
   * sphere reaching from under the chin up past the lip — which renders as a
   * muzzle, and it is the first thing you see. What a beard occupies is the
   * span between the chin and about two thirds of the way to the nose, and
   * these fractions are that span rather than the head's.
   */
  /*
   * Everything here hangs off the *front of the face*, which is where a beard
   * is. Measuring it out from the middle of the skull instead put the jaw at
   * z 1.19 on a face whose front is at 1.95 — a beard entirely inside the
   * head, and so an invisible one.
   */
  const r = HEAD.radiusX;
  const front = HEAD.noseZ;
  const jaw = new THREE.SphereGeometry(r * 0.25 * scale, 16, 12);
  jaw.scale(0.92, 0.9, 1.0);
  disposables.push(jaw);
  const jawMesh = new THREE.Mesh(jaw, hair);
  jawMesh.position.set(0, (HEAD.chinY + r * 0.13) * scale, (front - r * 0.26) * scale);
  jawMesh.castShadow = true;
  group.add(jawMesh);

  /* The point below it. Short — he is bearded, not a wizard. Sized off the
     head like everything else, so it stays in proportion on a body whose bone
     units differ by a factor of ten. */
  const tip = new THREE.ConeGeometry(r * 0.09 * scale, r * 0.2 * scale, 10);
  disposables.push(tip);
  const tipMesh = new THREE.Mesh(tip, hair);
  tipMesh.position.set(0, (HEAD.chinY - r * 0.14) * scale, (front - r * 0.26) * scale);
  tipMesh.rotation.set(Math.PI, 0, 0);
  tipMesh.castShadow = true;
  group.add(tipMesh);

  /* The moustache, under the nose and standing proud of it on purpose: it is
     the one part of him that is meant to be noticed first. */
  const tache = new THREE.SphereGeometry(r * 0.19 * scale, 14, 10);
  tache.scale(2.2, 0.62, 0.95);
  disposables.push(tache);
  const tacheMesh = new THREE.Mesh(tache, hair);
  tacheMesh.position.set(0, (HEAD.noseY - r * 0.16) * scale, (HEAD.noseZ - r * 0.05) * scale);
  tacheMesh.rotation.x = -0.12;
  tacheMesh.castShadow = true;
  group.add(tacheMesh);

  return { object: group, dispose: () => disposables.forEach((d) => d.dispose()) };
}

export function buildAccessory(spec: AccessorySpec, head: HeadMetrics): BuiltAccessory | null {
  const scale = spec.scale ?? 1;
  switch (spec.kind) {
    case 'bandana':
      return bandana(spec.color, spec.accent, scale, head);
    case 'beard':
      return beard(spec.color, scale, head);
    default:
      return null;
  }
}
