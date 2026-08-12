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

export type AccessoryKind = 'bandana' | 'beard' | 'star-hair';

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

  /* The band, crossing just above the brows and standing clear of the skull.
     Circular in x and stretched in z, because the head is. */
  const oval = HEAD.radiusZ / HEAD.radiusX;
  const R = HEAD.radiusX * HEAD.clearance * scale;
  const cz = HEAD.centreZ * scale;
  const bandBottom = HEAD.hemY * scale;
  const bandTop = (HEAD.hemY + 0.05) * scale;
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
  const capRise = HEAD.crownY + 0.012 - (HEAD.hemY + 0.05);
  const cap = new THREE.SphereGeometry(R, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.5);
  cap.scale(1, capRise / R, oval);
  disposables.push(cap);
  const capMesh = new THREE.Mesh(cap, cloth);
  capMesh.position.set(0, bandTop, cz);
  capMesh.castShadow = true;
  group.add(capMesh);

  /* The knot, at the back on the band itself. */
  const knot = new THREE.SphereGeometry(0.024 * scale, 10, 8);
  disposables.push(knot);
  const knotMesh = new THREE.Mesh(knot, cloth);
  knotMesh.position.set(0, (HEAD.hemY + 0.018) * scale, cz - R * oval * 0.98);
  knotMesh.castShadow = true;
  group.add(knotMesh);

  /* Two short tails hanging off the knot. */
  for (const side of [-1, 1]) {
    const tail = new THREE.ConeGeometry(0.014 * scale, 0.06 * scale, 6);
    disposables.push(tail);
    const tailMesh = new THREE.Mesh(tail, cloth);
    tailMesh.position.set(side * 0.018 * scale, (HEAD.hemY - 0.014) * scale, cz - R * oval * 0.96);
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
      const bar = new THREE.BoxGeometry(0.015 * scale, 0.03 * scale, 0.006 * scale);
      disposables.push(bar);
      const barMesh = new THREE.Mesh(bar, mark);
      barMesh.position.set(side * 0.026 * scale, (HEAD.hemY + 0.024) * scale, cz + R * oval * 0.92);
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
  const jaw = new THREE.SphereGeometry(0.074 * scale, 16, 12);
  jaw.scale(0.92, 0.9, 1.0);
  disposables.push(jaw);
  const jawMesh = new THREE.Mesh(jaw, hair);
  jawMesh.position.set(0, (HEAD.chinY + 0.038) * scale, 0.052 * scale);
  jawMesh.castShadow = true;
  group.add(jawMesh);

  /* The point below it. Short — he is bearded, not a wizard. */
  const tip = new THREE.ConeGeometry(0.044 * scale, 0.062 * scale, 10);
  disposables.push(tip);
  const tipMesh = new THREE.Mesh(tip, hair);
  tipMesh.position.set(0, (HEAD.chinY - 0.042) * scale, 0.058 * scale);
  tipMesh.rotation.set(Math.PI, 0, 0);
  tipMesh.castShadow = true;
  group.add(tipMesh);

  /* The moustache, under the nose and standing proud of it on purpose: it is
     the one part of him that is meant to be noticed first. */
  const tache = new THREE.SphereGeometry(0.03 * scale, 14, 10);
  tache.scale(1.75, 0.62, 0.95);
  disposables.push(tache);
  const tacheMesh = new THREE.Mesh(tache, hair);
  tacheMesh.position.set(0, (HEAD.noseY - 0.026) * scale, (HEAD.noseZ - 0.022) * scale);
  tacheMesh.rotation.x = -0.12;
  tacheMesh.castShadow = true;
  group.add(tacheMesh);

  return { object: group, dispose: () => disposables.forEach((d) => d.dispose()) };
}

/**
 * A crown of big spikes radiating outward, with a fringe hanging over the brow.
 *
 * This is the one silhouette in the whole series that has to be built rather
 * than tinted: no model on the roster has hair that points anywhere but down,
 * and without it the character is a short teenager in a school jacket and
 * nobody in the world. With it, he is recognisable from across the field, which
 * is the entire test.
 *
 * Seven spikes, not seventeen. The lesson every accessory in this file has
 * taught is that a mass of small shapes turns to noise at conversation
 * distance, so these are few and enormous — each about half a head long — and
 * they read as a star from the front and a fan from the side.
 *
 * `accent` is the fringe: the blond bangs that fall forward over the face, and
 * the reason the front of the head is left clear of spikes.
 */
function starHair(color: string, accent: string | undefined, scale: number, HEAD: HeadMetrics) {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const hair = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: 1,
    metalness: 0,
  });
  disposables.push(hair);

  /* Rooted just under the top of the model's own hair, so the spikes grow out
     of that mass rather than hovering above it — but not so deep that half of
     each one is buried and only a tip shows, which is what 0.055 down gave. */
  const root = new THREE.Vector3(0, HEAD.crownY - 0.025, HEAD.centreZ);
  const up = new THREE.Vector3(0, 1, 0);

  /* Azimuth round the head and how far each spike is tilted up from horizontal.
     The front (azimuth near 0) is deliberately empty — the fringe is there. */
  const spikes: [number, number, number][] = [
    [Math.PI, 0.62, 0.23],
    [Math.PI * 0.72, 0.5, 0.22],
    [-Math.PI * 0.72, 0.5, 0.22],
    [Math.PI * 0.42, 0.44, 0.2],
    [-Math.PI * 0.42, 0.44, 0.2],
    [Math.PI * 0.16, 1.15, 0.19],
    [-Math.PI * 0.16, 1.15, 0.19],
  ];
  for (const [az, tilt, len] of spikes) {
    const dir = new THREE.Vector3(
      Math.sin(az) * Math.cos(tilt),
      Math.sin(tilt),
      Math.cos(az) * Math.cos(tilt)
    ).normalize();
    const cone = new THREE.ConeGeometry(0.046 * scale, len * scale, 7);
    disposables.push(cone);
    const mesh = new THREE.Mesh(cone, hair);
    mesh.quaternion.setFromUnitVectors(up, dir);
    /* Half a length along the spike, so its base is buried in the skull. */
    mesh.position
      .copy(root)
      .addScaledVector(dir, len * 0.42)
      .multiplyScalar(scale);
    mesh.castShadow = true;
    group.add(mesh);
  }

  /* The fringe: three blades falling down the forehead to the brow. Placed
     against the brow rather than the crown — the first fit hung them off the
     top of the skull, where they read as a second set of horns. */
  if (accent) {
    const bang = new THREE.MeshStandardMaterial({
      color: new THREE.Color(accent),
      roughness: 1,
      metalness: 0,
    });
    disposables.push(bang);
    for (const [x, len, lean] of [
      [0, 0.11, 0.12],
      [-0.05, 0.095, 0.36],
      [0.05, 0.095, -0.36],
    ] as const) {
      const cone = new THREE.ConeGeometry(0.03 * scale, len * scale, 6);
      disposables.push(cone);
      const mesh = new THREE.Mesh(cone, bang);
      mesh.position.set(
        x * scale,
        (HEAD.hemY + 0.015) * scale,
        (HEAD.noseZ - 0.012) * scale
      );
      /* Pointing down the face, splayed outward from the middle. */
      mesh.rotation.set(Math.PI * 0.86, 0, lean);
      mesh.castShadow = true;
      group.add(mesh);
    }
  }

  return { object: group, dispose: () => disposables.forEach((d) => d.dispose()) };
}

export function buildAccessory(spec: AccessorySpec, head: HeadMetrics): BuiltAccessory | null {
  const scale = spec.scale ?? 1;
  switch (spec.kind) {
    case 'bandana':
      return bandana(spec.color, spec.accent, scale, head);
    case 'beard':
      return beard(spec.color, scale, head);
    case 'star-hair':
      return starHair(spec.color, spec.accent, scale, head);
    default:
      return null;
  }
}
