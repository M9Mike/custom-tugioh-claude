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

export type AccessoryKind = 'bandana';

export interface BuiltAccessory {
  object: THREE.Object3D;
  dispose(): void;
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
function bandana(color: string, accent: string | undefined, scale: number) {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];

  const cloth = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 1, metalness: 0 });
  disposables.push(cloth);

  /**
   * The band, and it has to sit *over* the hair rather than around it.
   *
   * The first fit was a headband: radius just wider than the skull, low
   * enough to be a sweatband. On a model whose hair is a single smooth mass
   * that put the cloth underneath the hair, which is exactly backwards — in
   * the reference the bandana caps the head and the hair escapes from under
   * it. So it is wider than the skull on purpose, and high.
   */
  const R = 0.132 * scale;
  const band = new THREE.CylinderGeometry(R, R * 1.02, 0.062 * scale, 20, 1, true);
  band.scale(1, 1, 0.9);
  disposables.push(band);
  const bandMesh = new THREE.Mesh(band, cloth);
  bandMesh.castShadow = true;
  group.add(bandMesh);

  /* The crown of it: a dome closing the top, so this is a cap and not a ring
     — the whole top of the head is cloth. */
  const cap = new THREE.SphereGeometry(R, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.5);
  cap.scale(1, 0.82, 0.9);
  disposables.push(cap);
  const capMesh = new THREE.Mesh(cap, cloth);
  capMesh.position.y = 0.028 * scale;
  capMesh.castShadow = true;
  group.add(capMesh);

  /* The knot, at the back and just below the band's hem. */
  const knot = new THREE.SphereGeometry(0.03 * scale, 10, 8);
  disposables.push(knot);
  const knotMesh = new THREE.Mesh(knot, cloth);
  knotMesh.position.set(0, -0.03 * scale, -R * 0.94);
  knotMesh.castShadow = true;
  group.add(knotMesh);

  /* Two short tails hanging off the knot. */
  for (const side of [-1, 1]) {
    const tail = new THREE.ConeGeometry(0.016 * scale, 0.07 * scale, 6);
    disposables.push(tail);
    const tailMesh = new THREE.Mesh(tail, cloth);
    tailMesh.position.set(side * 0.02 * scale, -0.065 * scale, -R * 0.96);
    tailMesh.rotation.x = -0.3;
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
      const bar = new THREE.BoxGeometry(0.018 * scale, 0.042 * scale, 0.006 * scale);
      disposables.push(bar);
      const barMesh = new THREE.Mesh(bar, mark);
      barMesh.position.set(side * 0.032 * scale, 0.03 * scale, R * 0.82);
      barMesh.rotation.z = side * 0.32;
      group.add(barMesh);
    }
  }

  /* High on the skull, not at the neck joint the Head bone actually sits at.
     Tuned by photograph: at 0.1 the hair swallowed it. */
  group.position.y = 0.152 * scale;

  return {
    object: group,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

export function buildAccessory(spec: AccessorySpec): BuiltAccessory | null {
  const scale = spec.scale ?? 1;
  switch (spec.kind) {
    case 'bandana':
      return bandana(spec.color, spec.accent, scale);
    default:
      return null;
  }
}
