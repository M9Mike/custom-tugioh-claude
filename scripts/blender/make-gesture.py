"""
Authors the small movements somebody makes while they are waiting.

A character standing in a market for an hour does not breathe on a four second
loop and nothing else. They stretch, they look up the arcade, they shift their
weight — and the difference between a world with people in it and a world with
mannequins in it is almost entirely those, because a loop is something the eye
learns in about ten seconds and then stops seeing.

`make-idle.py` writes the loop. This writes the interruptions: short clips that
play **once**, over the idle, and hand the body back where they found it.

## Why they are clips and not code

`premadeRig`'s `staticMotion` can move a root and nothing else, which is why a
model with no skeleton can be made to breathe and can never be made to wave. A
gesture is arms, a spine and a neck. That is a clip or it is nothing.

## Frame zero is the rest pose, and that is load-bearing

The glTF exporter bakes every bone into every action whatever has a curve on
it, so one of these clips is a full-skeleton pose track in which the bones the
gesture does not touch sit at the **rest** pose — which on these models is the
A-pose, arms out at forty degrees. Blended normally over an idle whose arms
hang, that drags the arms back out to the bind and a look around arrives with a
shrug attached. It did.

So `premadeRig` makes them **additive** at load, and the property that makes
that exact rather than approximate is that every clip here starts at zero:
`makeClipAdditive` takes frame 0 as the reference and subtracts it, so a bone
the gesture never moves becomes a zero delta and a bone it does move becomes a
pure offset. Idle plus gesture is then literally idle plus gesture. Author a
clip that opens part-way into the motion and that stops being true.

## The shape of one

Every gesture is a single arc: out from rest and back, on a raised cosine so it
begins and ends at exactly zero. That property is the whole reason it is safe to
play *over* an idle — the first and last frames are the rest pose, so nothing
snaps at either end whatever the idle is doing underneath, and the rig can
cross-fade on a fixed time rather than hunting for a good moment to start.

`swing` is the same idea run through a full sine, which goes one way, back
through zero, the other way and home. Looking left and then right is one gesture
rather than two, and it costs the same clip.

Amplitudes are in degrees and deliberately under what looks right in isolation.
These play at three to eight metres against a body that is already breathing,
and anything authored to read at arm's length reads as semaphore in a street.

## Where the bones come from

`rigshape.read_rig`, the same reading `retarget.py` transfers onto and `gait.py`
measures between — so this works on a named donor rig and on UniRig's
`Bone_000`s without being told which it has. Everything is composed in
**armature space**, where +Z is up, X tips forward and back and Z is the body's
own yaw, because bone local axes in these bundles point wherever the exporter's
synthesised tails happen to point and mean nothing at all.

    blender -b --factory-startup -P scripts/blender/make-gesture.py -- \
        --in public/models/cast/tina.glb --out /tmp/tina-gestures.glb
"""

import bpy
import math
import os
import sys
from mathutils import Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rigshape import load, read_rig   # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, fallback=None):
    return argv[argv.index('--' + name) + 1] if '--' + name in argv else fallback


SRC = arg('in')
OUT = arg('out')
FPS = int(arg('fps', '24'))
ONLY = [g for g in arg('only', '').split(',') if g]

if not SRC or not OUT:
    raise SystemExit('make-gesture: --in <model.glb> --out <out.glb>')


# ------------------------------------------------------------------ #
# The gestures                                                        #
# ------------------------------------------------------------------ #

"""
Each part is `(role, spread, degrees)`:

- **role** is a key from `read_rig` — `spine`, `neck`, `arm-`, `arm+`, `pelvis`.
- **spread** is a multiplier per bone down that chain, root first. It is what
  makes a limb *bend* rather than hinge: a shoulder carrying the whole rotation
  swings a straight arm like a gate, and the same total spread down the chain is
  an arm. Shorter than the chain leaves the rest at rest, which is how a hand
  stays out of a shrug.
- **degrees** is the rotation at the peak, about armature X, Y and Z.

The two arms are written out separately rather than mirrored, because the
sideways component flips sign between them and a mirror flag would hide that.
"""
GESTURES = {
    # Arms up and out, chest opens, chin lifts. The one everybody recognises.
    'Stretch': dict(
        seconds=3.8,
        wave='arc',
        parts=[
            # +X swings a down-pointing bone backward and -X forward; on the
            # neck, which points up, the same sign does the opposite. Both are
            # the same rotation and the bones point opposite ways, which is why
            # these two disagree in sign with the neck below and are right to.
            # Arms forward at shoulder height is a zombie reaching; a stretch
            # opens the chest.
            #
            # Sideways is the other sign nobody guesses right: raising an arm
            # *outward* is +Y on the bone at -X and -Y on the one at +X, so the
            # two lines below look mirrored and are. Written the obvious way
            # round, both arms swing across the body and the stretch reads as
            # somebody tucking their hands behind them.
            ('arm-', [0.15, 1.0, 0.40, 0.12], (22.0, 74.0, 0.0)),
            ('arm+', [0.15, 1.0, 0.40, 0.12], (22.0, -74.0, 0.0)),
            ('spine', [0.15, 0.35, 0.7, 1.0], (-7.0, 0.0, 0.0)),
            ('neck', [1.0, 0.7], (-9.0, 0.0, 0.0)),
        ],
    ),
    # A look up the arcade and back down it. Head leads, chest follows a little.
    'LookAround': dict(
        seconds=4.6,
        wave='swing',
        parts=[
            ('neck', [1.0, 0.75], (0.0, 0.0, 26.0)),
            ('spine', [0.0, 0.15, 0.35, 0.6], (0.0, 0.0, 7.0)),
            ('arm-', [0.0, 0.3], (0.0, 5.0, 0.0)),
            ('arm+', [0.0, 0.3], (0.0, -5.0, 0.0)),
        ],
    ),
    # Weight off one hip and onto the other. The quietest of the three, and the
    # one that does the most work when it plays between the other two.
    'Settle': dict(
        seconds=3.4,
        wave='swing',
        parts=[
            ('pelvis', [1.0], (0.0, 5.0, 0.0)),
            ('spine', [0.6, 0.4, 0.2, 0.0], (0.0, -4.5, 0.0)),
            ('neck', [0.5, 0.4], (0.0, 2.0, 0.0)),
            ('arm-', [0.0, 0.5], (0.0, 4.0, 0.0)),
            ('arm+', [0.0, 0.5], (0.0, -4.0, 0.0)),
        ],
    ),
}


def shape(wave, t):
    """
    The curve, from 0 at t=0 to 0 at t=1.

    `arc` rises to one in the middle and comes back. `swing` goes to one, back
    through zero to minus one, and home — the same arc run through a full sine,
    which is a look left followed by a look right rather than two clips.

    Both are exactly zero at both ends, which is what lets one of these be
    cross-faded on top of a running idle without a snap at either edge.
    """
    if wave == 'swing':
        return math.sin(t * math.tau)
    return (1.0 - math.cos(t * math.tau)) / 2.0


def about(pivot, rot):
    """A rotation around a point, in armature space."""
    return Matrix.Translation(pivot) @ rot @ Matrix.Translation(-pivot)


def euler(x, y, z):
    return (Matrix.Rotation(x, 4, 'X')
            @ Matrix.Rotation(y, 4, 'Y')
            @ Matrix.Rotation(z, 4, 'Z'))


arm = load(SRC)
rig, facing = read_rig(arm, SRC.split('/')[-1])
rest = {b.name: b.matrix_local.copy() for b in arm.data.bones}

"""
Parents before children, always, and the view layer updated between.

Same rule as `retarget.py` and for the same reason: a bone's basis is written
against where its parent actually ended up, and depth-first from the root is
the only order in which that is true when it is read.
"""
order = []


def walk(bone):
    order.append(bone.name)
    for c in bone.children:
        walk(c)


for b in arm.data.bones:
    if b.parent is None:
        walk(b)

wanted = [g for g in GESTURES if not ONLY or g in ONLY]
print('make-gesture: %s — writing %s' % (SRC.split('/')[-1], ', '.join(wanted)))

for name in wanted:
    spec = GESTURES[name]
    total = max(2, int(round(spec['seconds'] * FPS)))

    """
    Which bone takes which share of the rotation, worked out once per clip.

    A role the rig does not have is skipped rather than fatal — `pelvis` is one
    bone on every skeleton here but a chain could be missing on something odd,
    and losing one part of a stretch is better than refusing to write the file.
    """
    plan = []
    for role, spread, degrees in spec['parts']:
        chain = rig.get(role)
        if not chain:
            print('  ? %s has no %s — that part of %s is skipped' % (SRC.split('/')[-1], role, name))
            continue
        for i, bone in enumerate(chain):
            if i >= len(spread) or spread[i] == 0.0:
                continue
            plan.append((bone, spread[i], [math.radians(d) for d in degrees]))

    driven = sorted({bone for bone, _, _ in plan})
    action = bpy.data.actions.new(name)
    arm.animation_data_create()
    arm.animation_data.action = action
    if hasattr(action, 'slots'):
        arm.animation_data.action_slot = action.slots.new(id_type='OBJECT', name='Rig')

    for f in range(total + 1):
        k = shape(spec['wave'], f / total)
        bpy.context.scene.frame_set(f)
        offsets = {}
        for bone, share, (rx, ry, rz) in plan:
            amount = k * share
            offsets[bone] = about(rest[bone].translation, euler(rx * amount, ry * amount, rz * amount))
        for bone in order:
            pb = arm.pose.bones.get(bone)
            if pb is None:
                continue
            delta = offsets.get(bone)
            if delta is None:
                pb.matrix_basis = Matrix.Identity(4)
            else:
                """
                Conjugated through the bone's own rest matrix.

                The offsets above are written in armature space, where the axes
                mean something on every rig. `matrix_basis` is in the bone's own
                space, where they do not. This is the one line that turns the
                first into the second, and writing a *basis* rather than a
                matrix is what lets a parent's rotation reach its children
                instead of being cancelled by them.
                """
                pb.matrix_basis = rest[bone].inverted() @ delta @ rest[bone]
            bpy.context.view_layer.update()
        for bone in driven:
            pb = arm.pose.bones.get(bone)
            if pb is None:
                continue
            pb.keyframe_insert('location', frame=f)
            pb.keyframe_insert('rotation_quaternion', frame=f)

    print('  %-11s %d frames, %.1fs, %d bones' % (name, total + 1, spec['seconds'], len(plan)))

arm.animation_data.action = None
for pb in arm.pose.bones:
    pb.matrix_basis = Matrix.Identity(4)
bpy.context.view_layer.update()

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format='GLB',
    export_animations=True,
    export_animation_mode='ACTIONS',
    export_bake_animation=True,
    export_yup=True,
    export_apply=False,
)
print('make-gesture: wrote %s' % OUT)
