"""
Reading a character's skeleton as a shape rather than as a list of names.

Two tools need the same answer to "where is the pelvis, which chain is the left
leg, which bone is the toe" — `retarget.py`, to know what to transfer onto what,
and `gait.py`, to know which two things to measure the stride between. They used
to answer it separately and one of them answered it by name, which worked for
the vendored roster (`Hips`, `LeftUpLeg`, `Spine02`) and returned nothing at all
for a UniRig export, where the bones are called `Bone_000` through `Bone_067` in
no order that means anything. `gait` did not fail on that: it reported a stride
of exactly zero metres, three times, and a zero is a number a catalog will
happily accept.

So the answer lives in one place. Everything here is derived from the tree and
from where the joints are:

- the **pelvis** is the first bone down from the root with three children;
- of those three, the two whose subtrees reach lowest are the **legs** and the
  third is the **spine**;
- the **chest** is where the spine next branches three ways;
- of *those* three, the one whose subtree reaches highest is the **neck** and
  the other two are the **clavicles**;
- sides are keyed by the sign of X, and which way the character faces is
  measured from the sign of toe-minus-ankle along Y rather than assumed.

It raises rather than guesses. A skeleton this cannot read is a character
somebody has to look at, not one to transfer half a walk onto or to write a
made-up speed into the catalog for.
"""

import bpy


def load(path):
    """
    Import one `.glb` into an empty scene and hand back its armature.

    Everything that is not the armature or a mesh parented to it is deleted.
    Blender's empty scene is not reliably empty — an icosphere turns up in it on
    this install — and an extra object is invisible here and a stray 42-vertex
    ball welded into the character on the way out.
    """
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    arm = next((o for o in bpy.data.objects if o.type == 'ARMATURE'), None)
    if arm is None:
        raise SystemExit('rig: no armature in %s' % path)
    keep = {arm} | {o for o in bpy.data.objects if o.type == 'MESH' and o.parent is arm}
    for o in list(bpy.data.objects):
        if o not in keep:
            bpy.data.objects.remove(o, do_unlink=True)
    return arm


def height_of(arm):
    """The character's standing height in metres, from the mesh it wears."""
    pts = [o.matrix_world @ v.co
           for o in bpy.data.objects if o.type == 'MESH' and o.parent is arm
           for v in o.data.vertices]
    return max(p.z for p in pts) - min(p.z for p in pts)


def soles(arm):
    """
    The vertices that touch the floor, and the mesh they belong to.

    Everything in the bottom sixth of the character at rest, which on all of
    these is feet and whatever is strapped round them. Taken once and reused
    every frame: the lowest point of a walking body is always a foot, so
    chasing it over a whole 74,000-vertex mesh 174 times is 20x the work for
    the same number.
    """
    mesh = max([o for o in bpy.data.objects if o.type == 'MESH' and o.parent is arm],
               key=lambda o: len(o.data.vertices))
    zs = [(mesh.matrix_world @ v.co).z for v in mesh.data.vertices]
    cut = min(zs) + (max(zs) - min(zs)) * 0.17
    return mesh, [i for i, z in enumerate(zs) if z < cut]


def floor_of(mesh, indices):
    """How far off the ground the lowest sole vertex is right now, in metres."""
    ev = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
    me = ev.to_mesh()
    mw = ev.matrix_world
    z = min((mw @ me.vertices[i].co).z for i in indices)
    ev.to_mesh_clear()
    return z


def subtree(bone):
    out = [bone]
    for c in bone.children:
        out.extend(subtree(c))
    return out


def lowest(bone):
    return min(b.head_local.z for b in subtree(bone))


def highest(bone):
    return max(b.head_local.z for b in subtree(bone))


def down(bone, length):
    """
    `length` bones from `bone` inclusive, following the deepest child at a fork.

    A fork inside a limb is a hand growing fingers or an ankle growing a toe and
    a heel; the limb is the side that keeps going.
    """
    chain = [bone]
    while len(chain) < length and chain[-1].children:
        chain.append(max(chain[-1].children, key=lambda b: len(subtree(b))))
    return chain


def read_rig(arm, label):
    """
    The named parts of a skeleton, found by its shape rather than by its names.

    Returns chains — lists of bone names, root first — under fixed roles. Raises
    rather than guesses: a skeleton this cannot read is a character somebody has
    to look at, not one to transfer half a walk onto.
    """
    roots = [b for b in arm.data.bones if b.parent is None]
    if len(roots) != 1:
        raise SystemExit('rig: %s has %d root bones, expected 1' % (label, len(roots)))

    # The pelvis: first bone down from the root that branches three ways.
    pelvis = roots[0]
    while len(pelvis.children) < 3:
        if not pelvis.children:
            raise SystemExit('rig: %s has no three-way branch — not a humanoid' % label)
        pelvis = pelvis.children[0]

    kids = list(pelvis.children)
    if len(kids) != 3:
        raise SystemExit('rig: %s pelvis has %d children, expected 3' % (label, len(kids)))
    kids.sort(key=lowest)
    legs, spine_root = kids[:2], kids[2]

    # The chest: where the spine branches three ways in its turn.
    chest = spine_root
    spine = [chest]
    while len(chest.children) < 3:
        if not chest.children:
            raise SystemExit('rig: %s spine never reaches a chest' % label)
        chest = max(chest.children, key=lambda b: len(subtree(b)))
        spine.append(chest)

    above = sorted(chest.children, key=highest)
    neck_root, clavicles = above[-1], above[:-1]
    if len(clavicles) != 2:
        raise SystemExit('rig: %s chest has %d arms' % (label, len(clavicles)))

    """
    Which side is which, without trusting a name.

    +X is the same side of both characters *provided both are facing the same
    way*, so the sides are keyed by the sign of X and the facing is measured
    rather than assumed. A toe sits in front of its ankle, so the sign of
    toe minus ankle along Y is which way this character faces, in Blender's
    axes, whatever the exporter thought it was doing. The caller compares the
    two and refuses a pair that disagree.

    This is the whole defence against a mirrored transfer, and a mirrored
    transfer is not subtle: it swings the arm and the leg on the same side
    together, which reads as a wind-up toy.
    """
    def leg_chain(b):
        return down(b, 4)

    legs = sorted(legs, key=lambda b: b.head_local.x)      # -X first, +X second
    clavicles = sorted(clavicles, key=lambda b: b.head_local.x)

    reach = 0.0
    for leg in legs:
        ankle, toe = leg_chain(leg)[2:4]
        reach += toe.head_local.y - ankle.head_local.y
    if abs(reach) < 1e-6:
        raise SystemExit('rig: %s has no toes in front of its ankles' % label)
    facing = 1.0 if reach > 0 else -1.0

    rig = {
        'pelvis': [pelvis.name],
        'spine': [b.name for b in spine],
        'neck': [b.name for b in down(neck_root, 2)],
        'leg-': [b.name for b in leg_chain(legs[0])],
        'leg+': [b.name for b in leg_chain(legs[1])],
        'arm-': [b.name for b in down(clavicles[0], 4)],
        'arm+': [b.name for b in down(clavicles[1], 4)],
    }
    print('retarget: %s (facing %+.0fY)' % (label, facing))
    for role, chain in rig.items():
        print('    %-7s %s' % (role, ' -> '.join(chain)))
    return rig, facing


