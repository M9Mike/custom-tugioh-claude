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


def limb(bone, length):
    """
    `length` joints of a limb from `bone`, down its main path, with a joint that
    sits on top of the one before it folded into it.

    `down` alone is right for every rig that has one bone per joint, and wrong
    the day a rig has two at one place: Ishizu Ishtar's knee is two bones six
    centimetres apart, so four bones down from her hip were hip, knee, knee and
    ankle, her "toe" was her ankle, and the facing test read her as turned round.
    A segment shorter than a tenth of the limb, above its lowest quarter, is not
    a joint anybody bends at, so the deeper of the two stands for both. On a rig
    without such a pair nothing folds, and the chain is exactly `down`'s.
    """
    path = [bone]
    while path[-1].children:
        path.append(max(path[-1].children, key=lambda b: len(subtree(b))))
    floor = min(b.head_local.z for b in path)
    span = max(1e-6, bone.head_local.z - floor)
    out = [bone]
    for b in path[1:]:
        if len(out) >= length:
            break
        # Folded only above the lowest quarter of the leg: a doubled joint is a
        # knee problem, and a foot is short enough on its own — Sandra's ankle
        # to toe is a tenth of her leg exactly — to look like one.
        doubled = (b.head_local - out[-1].head_local).length < 0.1 * span
        if len(out) > 1 and doubled and b.head_local.z - floor > 0.25 * span:
            out[-1] = b
        else:
            out.append(b)
    return out


def hand_of(root):
    """
    The hand at the end of an arm: the first bone at least three down from the
    shoulder that forks into short chains — fingers.

    This is what tells an arm from a cape. Yami Marik's chest carries seven
    chains and Priest Seto's four; the arms are the two that end in a hand, and
    a cape panel never grows fingers. `None` for a rig whose hands have none,
    which the donors' do not — and they do not need this, having only arms.
    """
    stack = [(root, 0)]
    while stack:
        b, depth = stack.pop(0)
        if depth >= 3 and len(b.children) >= 2 and all(len(subtree(c)) <= 4 for c in b.children):
            return b
        stack.extend((c, depth + 1) for c in b.children)
    return None


def arm_chain(clavicle):
    """
    Clavicle, upper arm, forearm, hand — four bones however many the arm has.

    One bone per joint and the hand four down, and it is `down(clavicle, 4)`.
    Otherwise the ends are fixed — the clavicle, and the hand `hand_of` found —
    a joint sitting on its neighbour is folded away (Priest Seto's shoulder pad
    starts four centimetres from his upper arm), and of what is left the elbow
    is the joint nearest halfway from the shoulder to the hand. A forearm twist
    bone then stays at rest under the forearm, where it belongs, instead of
    taking the hand's rotation and bending the wrist at mid-forearm.
    """
    simple = down(clavicle, 4)
    hand = hand_of(clavicle)
    if hand is None:
        return simple
    # Four bones that already reach most of the way to the hand are the arm —
    # the fourth is the wrist, a few centimetres short of the palm, which is
    # what every rig before these read and what their clips were made on.
    reach = (hand.head_local - clavicle.head_local).length
    if (simple[-1].head_local - clavicle.head_local).length >= 0.8 * reach:
        return simple
    path = [hand]
    # By name: every access to a bone hands back a new Python wrapper, so `is`
    # between two lookups of the same bone is False.
    while path[-1].name != clavicle.name:
        path.append(path[-1].parent)
    path.reverse()
    if len(path) == 4:
        return path
    span = max(1e-6, (hand.head_local - clavicle.head_local).length)
    kept = [path[0]]
    for b in path[1:-1]:
        near_hand = (hand.head_local - b.head_local).length < 0.1 * span
        if near_hand:
            continue
        if len(kept) > 1 and (b.head_local - kept[-1].head_local).length < 0.1 * span:
            kept[-1] = b
        else:
            kept.append(b)
    kept.append(hand)
    if len(kept) <= 4:
        return kept
    upper = kept[1]
    run, marks = 0.0, []
    for a, b in zip(kept[1:], kept[2:]):
        run += (b.head_local - a.head_local).length
        marks.append((run, b))
    half = run / 2
    elbow = min((m for m in marks[:-1]), key=lambda m: abs(m[0] - half))[1]
    return [clavicle, upper, elbow, hand]


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

    # The pelvis: first bone down from the root that branches.
    pelvis = roots[0]
    while len(pelvis.children) < 2:
        if not pelvis.children:
            raise SystemExit('rig: %s has no branch at all — not a humanoid' % label)
        pelvis = pelvis.children[0]

    """
    Hips in two stages.

    Most rigs fork once at the pelvis — spine and both legs. Rex Raptor's and
    Odion's fork twice: the pelvis into the spine and a block of hip, and only
    the hip block into the legs. The spine is still the child that reaches
    highest; the legs are then looked for at the hip block's own fork, which is
    one more place for cloth to hang (Odion's does) and is read the same way.
    The pelvis stays the bone that drives the body — the hip block is its child
    and follows it at rest.
    """
    if len(pelvis.children) == 2:
        top = max(pelvis.children, key=highest)
        hips = next(b for b in pelvis.children if b.name != top.name)
        while len(hips.children) < 2:
            if not hips.children:
                raise SystemExit('rig: %s has no fork for the legs — not a humanoid' % label)
            hips = hips.children[0]
        kids = [top] + list(hips.children)
    else:
        kids = list(pelvis.children)

    """
    Two legs and a spine, and whatever else is tied to the hips.

    Three children was the rule until Kaela Veyron arrived with five: the two
    legs, the spine, and two short chains of skirt hanging off the pelvis — 82
    bones against the 24 of the donor. Refusing her was the check being literal
    rather than careful, because the test that sorts a leg from a spine already
    tells cloth from both: a leg reaches the floor (hers stop at z 0.02), a
    spine reaches the head (0.96 up to 1.61), and a skirt panel stops somewhere
    in between (0.38 and 0.72). So the spine is the child that reaches highest,
    the legs are the two of the rest that reach lowest, and anything else
    hanging off the hips is cloth.

    Cloth is then simply never driven. Nothing here animates it and nothing
    should: a skirt bone left at its rest pose follows the hips it is parented
    to, which is what a skirt does, and a retarget that tried to guess at it
    would be inventing motion nobody authored.
    """
    if len(kids) < 3:
        raise SystemExit('rig: %s pelvis has %d children, expected at least 3' % (label, len(kids)))
    spine_root = max(kids, key=highest)
    legs = sorted([b for b in kids if b is not spine_root], key=lowest)[:2]
    spare = len(kids) - 3
    if spare:
        print('rig: %s has %d chain(s) of cloth on the hips, left at rest' % (label, spare))

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
    if len(clavicles) > 2:
        # More than two hanging off the chest is arms and cloth; the arms are
        # the two that end in hands.
        handed = [b for b in clavicles if hand_of(b) is not None]
        if len(handed) != 2:
            raise SystemExit('rig: %s chest has %d chains and %d hands' % (label, len(clavicles), len(handed)))
        print('rig: %s has %d chain(s) of cloth on the chest, left at rest' % (label, len(clavicles) - 2))
        clavicles = handed
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
        return limb(b, 4)

    legs = sorted(legs, key=lambda b: b.head_local.x)      # -X first, +X second
    # By the shoulder rather than the clavicle's root, which on Yami Marik sits
    # a centimetre either side of the middle of his chest.
    clavicles = sorted(clavicles, key=lambda b: arm_chain(b)[1].head_local.x)

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
        'arm-': [b.name for b in arm_chain(clavicles[0])],
        'arm+': [b.name for b in arm_chain(clavicles[1])],
    }
    print('retarget: %s (facing %+.0fY)' % (label, facing))
    for role, chain in rig.items():
        print('    %-7s %s' % (role, ' -> '.join(chain)))
    return rig, facing


