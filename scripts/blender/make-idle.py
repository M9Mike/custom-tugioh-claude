"""
Authors a standing idle for a character that arrived with only a walk and a run.

The rigged bundles carry locomotion and nothing else, and the idle is the clip a
player actually looks at: it is what a duelist does in the creation booth, what
the cast does standing in the field, and what is playing for all of the time
nobody is holding the stick. A character with no idle stands in its bind pose,
perfectly rigid, which is the exact thing this whole exercise was to get away
from.

## What it authors

A breath and a weight shift, and deliberately nothing more. Four seconds, one
inhale, looping seamlessly because every channel is a sine over the full period
— so the last frame is the first frame and there is no seam to hide.

Amplitudes are a fraction of the character's own height rather than absolute
centimetres, so a 1.5 m Weevil and a 2 m Odion breathe by the same proportion of
themselves. They are all deliberately smaller than looks right in isolation: on
a loop the eye integrates over many cycles, and anything big enough to notice
per-cycle reads as swaying rather than standing.

## Why it works in armature space

Every offset is composed against the bone's **rest matrix in armature space**,
not applied to its local rotation channels. Bone local axes are not a
convention — they run along whatever direction the exporter happened to give the
bone, and in these bundles the tails are synthesised and point nowhere near the
limb, so "rotate the spine about its local X" means a different thing on every
character. Composing in armature space means +Z is up and a rotation about X
tips forward, on every rig, measurably.

Parents are written before children and the view layer is updated between, so a
child's assignment sees where its parent actually ended up.

    blender -b --factory-startup -P scripts/blender/make-idle.py -- \
        --in mai.glb --out mai-idle.glb
"""

import bpy
import sys
import math
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, fallback=None):
    return argv[argv.index('--' + name) + 1] if '--' + name in argv else fallback


SRC = arg('in')
OUT = arg('out')
SECONDS = float(arg('seconds', '4.0'))
FPS = 30
STRENGTH = float(arg('strength', '1.0'))
# how far out from the side the upper arms are left, in degrees
"""
Where the arms come to rest, as degrees out from straight down.

13 first, which was wrong in a way only watching it showed. The swing was
symmetric then, so the arms spent the loop between 5 and 21 degrees out — and the
5 was the pose that looked right. Resting them at 13 and lifting from there put
the whole motion in the half that was already too high.

6 is the low end of that old swing, so the resting pose is now the one that read
as natural, and `ARM` lifts a few degrees off it. Not lower than that: an arm
inside about five degrees hangs inside the hip on these builds.
"""
ARM_DROP = math.radians(float(arg('armDrop', '6.0')))

if not SRC or not OUT:
    raise SystemExit('make-idle: --in <rigged.glb> --out <out.glb> [--seconds 4] [--strength 1]')

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

arm = next((o for o in bpy.data.objects if o.type == 'ARMATURE'), None)
if arm is None:
    raise SystemExit('make-idle: no armature in %s' % SRC)
meshes = [o for o in bpy.data.objects if o.type == 'MESH' and len(o.data.vertices) > 100]
pts = [m.matrix_world @ v.co for m in meshes for v in m.data.vertices]
height = max(p.z for p in pts) - min(p.z for p in pts)


def find(*patterns):
    """
    First bone whose name contains one of these, longest match first.

    Rigs disagree about naming — `Spine01`/`Spine1`/`Chest`, `neck`/`Neck`,
    `LeftArm`/`UpperArm.L` — and a character that names something unexpectedly
    should lose that one nuance of the idle, not fail the run. Everything below
    tolerates `None`.
    """
    names = {b.name.lower(): b.name for b in arm.data.bones}
    for p in patterns:
        for lower, real in names.items():
            if lower == p:
                return real
    for p in patterns:
        for lower, real in names.items():
            if p in lower:
                return real
    return None


HIPS = find('hips', 'pelvis')
SPINE = find('spine', 'spine02', 'abdomen')
CHEST = find('spine01', 'spine1', 'chest', 'torso')
NECK = find('neck')
HEAD = find('head')
L_ARM = find('leftarm', 'upperarm.l', 'arm.l', 'l_arm')
R_ARM = find('rightarm', 'upperarm.r', 'arm.r', 'r_arm')
print('make-idle: hips=%s spine=%s chest=%s neck=%s head=%s arms=%s/%s'
      % (HIPS, SPINE, CHEST, NECK, HEAD, L_ARM, R_ARM))

rest = {b.name: b.matrix_local.copy() for b in arm.data.bones}

"""
Where the arms hang, taken from the character's own walk.

The bind pose is an A-pose — arms out at forty degrees, because that is the pose
a model is *authored* in so the armpits are reachable. It is not a pose anybody
stands in. Breathing on top of it gives a mannequin holding its arms out, which
is what the first version of this produced.

The right posture is already in the file. Over a full walk cycle an arm swings
symmetrically fore and aft, so the *average* of its orientation across the cycle
is the neutral hang it swings about — the character's own idea of where its arms
rest, at its own proportions, for free. Averaged in armature space over the
whole clip, with quaternion signs aligned first, since q and −q are the same
rotation and summing them naively cancels to nothing.

Only the arm chain is taken this way. The legs and spine keep their rest pose,
because mid-walk the legs are mid-stride and their average is a straddle.
"""
ARM_CHAIN = [
    n for n in (
        find('leftshoulder', 'shoulder.l'), find('leftarm', 'upperarm.l'),
        find('leftforearm', 'lowerarm.l'), find('lefthand', 'wrist.l'),
        find('rightshoulder', 'shoulder.r'), find('rightarm', 'upperarm.r'),
        find('rightforearm', 'lowerarm.r'), find('righthand', 'wrist.r'),
    ) if n
]


def neutral_arms():
    """
    Mean *local* transform of the arm chain across the walk.

    `matrix_basis` rather than `matrix`, and that is the whole difference between
    an idle that moves and one that does not. A basis is the bone's offset from
    its own rest, so a child carrying one still inherits everything its parents
    do; an armature-space `matrix` is an absolute placement, and writing one to
    every bone pinned each child back to where it started and cancelled its
    parent's motion outright. The hips swayed thirty-five millimetres and the
    legs, spine and head stayed exactly where they were, so the only thing that
    visibly moved was whatever had an offset of its own.
    """
    source = bpy.data.actions.get('Walk') or bpy.data.actions.get('Run')
    if not source or not ARM_CHAIN:
        return {}
    arm.animation_data_create()
    arm.animation_data.action = source
    if hasattr(source, 'slots') and len(source.slots):
        arm.animation_data.action_slot = source.slots[0]
    start, end = (int(round(x)) for x in source.frame_range)

    acc = {n: {'q': None, 'sum': None, 'loc': Vector(), 'n': 0} for n in ARM_CHAIN}
    for f in range(start, end + 1):
        bpy.context.scene.frame_set(f)
        bpy.context.view_layer.update()
        for n in ARM_CHAIN:
            pb = arm.pose.bones.get(n)
            if pb is None:
                continue
            m = pb.matrix_basis
            q = m.to_quaternion()
            a = acc[n]
            if a['q'] is None:
                a['q'] = q
                a['sum'] = [q.w, q.x, q.y, q.z]
            else:
                # align to the running reference, or q and -q cancel
                if q.dot(a['q']) < 0:
                    q = -q
                a['sum'][0] += q.w
                a['sum'][1] += q.x
                a['sum'][2] += q.y
                a['sum'][3] += q.z
            a['loc'] += m.translation
            a['n'] += 1

    out = {}
    for n, a in acc.items():
        if not a['n']:
            continue
        from mathutils import Quaternion
        q = Quaternion(a['sum'])
        q.normalize()
        out[n] = Matrix.Translation(a['loc'] / a['n']) @ q.to_matrix().to_4x4()
    arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    return out


def lower_arms(base):
    """
    Bring the upper arms down against the body.

    Averaging the walk was supposed to supply a resting arm and does not, because
    these bundles barely swing the arms: Sandra's mean sits about forty degrees
    out from her side, which is her modelled A-pose almost unchanged. So the idle
    came out as the pose the model was authored in, standing still — which is
    exactly the thing it reads as, and exactly what it was written to avoid.

    The abduction angle is measured directly — the angle between the shoulder to
    elbow direction and straight down — and rotated until it reaches
    `--armDrop`. Measured rather than assumed, because the amount to remove is
    different on every character: an A-pose at 45 degrees needs 33 taken off and
    one already at 15 needs nothing.

    The rotation is about the axis those two directions span, so the arm swings
    down the shortest way and does not twist. The forearm and hand are children
    and follow, so the whole limb comes with it.
    """
    dropped = 0
    for upper, lower in ((find('leftarm', 'upperarm.l'), find('leftforearm', 'lowerarm.l')),
                         (find('rightarm', 'upperarm.r'), find('rightforearm', 'lowerarm.r'))):
        if not upper or not lower:
            continue
        a = rest[upper].translation
        b = rest[lower].translation
        limb = (b - a)
        if limb.length < 1e-6:
            continue
        limb.normalize()
        down = Vector((0.0, 0.0, -1.0))
        out = limb.angle(down)
        if out <= ARM_DROP:
            continue
        axis = limb.cross(down)
        if axis.length < 1e-6:
            continue
        R = Matrix.Rotation(out - ARM_DROP, 4, axis.normalized())
        # `about` is defined further down the file, so the pivot is inlined here
        pivoted = Matrix.Translation(a) @ R @ Matrix.Translation(-a)
        # a basis delta, conjugated into the bone's own space like every other
        local = rest[upper].inverted() @ pivoted @ rest[upper]
        base[upper] = local @ base.get(upper, Matrix.Identity(4))
        dropped += 1
        print('make-idle: %s was %.0f deg out, brought to %.0f'
              % (upper, math.degrees(out), math.degrees(ARM_DROP)))
    return dropped


ARM_BASIS = neutral_arms()
print('make-idle: arms relaxed from the walk (%d bones)' % len(ARM_CHAIN))
lower_arms(ARM_BASIS)

order = []


def walk(bone):
    order.append(bone.name)
    for c in bone.children:
        walk(c)


for b in arm.data.bones:
    if b.parent is None:
        walk(b)

action = bpy.data.actions.new('Idle')
arm.animation_data_create()
arm.animation_data.action = action
if hasattr(action, 'slots'):
    arm.animation_data.action_slot = action.slots.new(id_type='OBJECT', name='Rig')

total = int(SECONDS * FPS)
# a fraction of body height; every one of these is under a centimetre on a 1.7 m
# character, which is what standing still actually looks like
# world distance -> bone space; see the note on the amplitudes below
BONE_UNITS = 1.0 / max(1e-9, arm.matrix_world.to_scale().z)
BOB = 0.0040 * height * STRENGTH * BONE_UNITS
"""
Amplitudes, raised until the idle is visible.

The first version of these was a tenth of this size, on the argument that a loop
is integrated by the eye over many cycles and anything noticeable per-cycle reads
as swaying. That argument is sound and the numbers were still wrong: at 1.3
degrees of chest rotation and six millimetres of sway the result was
indistinguishable from a still model, which is not a subtle idle, it is no idle.
The reference is the 3DS rips standing next to these characters — Yami visibly
shifts his weight — and beside him a millimetre of breath reads as a bug.

Set by measurement against the clip the comparison is actually made to. The 3DS
rips stand next to these characters, so `scripts/blender/idle-motion.py` reports
how far a sampled vertex travels over one loop as a fraction of the character's
height: Yugi's median is 1.5%, Yami's 2.4%. The first pass here measured 0.07% —
twenty times less than the calmer of the two, which is why it read as a still
model rather than a subtle one.

Most of that gap is in the arms, not the torso, and that is the part worth
understanding: a real idle's biggest vertex travel is at the hands, because a
small rotation at the shoulder is amplified along the whole limb. Scaling breath
alone would have needed thirty-six degrees of chest rotation to move a hand as
far as thirteen degrees of shoulder does.

The numbers below are what came out of that measurement, not a guess: sway 0.008
of height puts the median at 2.1%, which sits between Yugi's 1.5% and Yami's
2.4%. Split across channels so no single one has to carry it:

`ARM` is halved against the others because it is one-sided — the arms lift from
their resting pose and never drop below it, so its whole amplitude is spent in the
direction that shows. Symmetric, it reached about twice as high as an idle should.
the chest breathes, the hips shift and rise, the head settles, and the arms swing
a little against the body. Several small motions at different phases read as
alive where one larger motion reads as a metronome.
"""
"""
Translations are in the armature's units, which are not the world's.

These bundles are authored in centimetres: the armature object carries scale 0.01,
so a bone's `matrix` translation of 1.0 moves the mesh ten millimetres. Every
translation here was written as a fraction of the character's *world* height and
handed straight to a bone, so it arrived a hundred times too small — a sway meant
to be 51 mm reached the mesh as 0.5 mm, and the hips travelled 1.1 mm over the
whole loop.

That is the whole reason the idle read as a still model. It was not too subtle by
judgement, it was two orders of magnitude out by arithmetic, and it was invisible
in review because rotations are scale-invariant: the arm swing worked, so the clip
was plainly *doing* something and the something looked tiny.

`BONE_UNITS` converts a world-space distance into the bone space that produces it.
Rotations do not need it and do not get it.
"""
SWAY = 0.008 * height * STRENGTH * BONE_UNITS
LEAN = math.radians(0.9) * STRENGTH
BREATH = math.radians(4.0) * STRENGTH
NOD = math.radians(3.0) * STRENGTH
ARM = math.radians(3.5) * STRENGTH


def about(pivot, rot):
    """A rotation around a point, in armature space."""
    return Matrix.Translation(pivot) @ rot @ Matrix.Translation(-pivot)


for f in range(total + 1):
    t = f / total
    phase = t * math.tau                      # one full cycle, so frame 0 == frame N
    breath = math.sin(phase)
    shift = math.sin(phase - math.pi / 3)     # weight lags the breath a little

    offsets = {}
    if HIPS:
        offsets[HIPS] = Matrix.Translation(Vector((SWAY * shift, 0.0, BOB * breath)))
    if SPINE:
        offsets[SPINE] = about(rest[SPINE].translation, Matrix.Rotation(-LEAN * breath, 4, 'X'))
    if CHEST:
        offsets[CHEST] = about(rest[CHEST].translation, Matrix.Rotation(BREATH * breath, 4, 'X'))
    if NECK:
        offsets[NECK] = about(rest[NECK].translation, Matrix.Rotation(-NOD * breath, 4, 'X'))
    if HEAD:
        offsets[HEAD] = about(rest[HEAD].translation, Matrix.Rotation(NOD * 0.6 * shift, 4, 'Z'))
    """
    The arms rise from their rest and never drop below it.

    `breath` is a sine, so multiplying it swung the arms symmetrically — as far
    above the resting pose as below. Watched, the low end of that swing was the
    pose that looked right and the high end was plainly too high: an idle should
    lift the arms off the body a little, not lever them out and back.

    `(1 - cos)/2` runs 0 -> 1 -> 0 over the loop instead of -1 -> +1 -> -1, so the
    resting pose *is* the bottom of the motion and the whole amplitude is spent
    going up. It still starts and ends at zero, so the loop is seamless.
    """
    lift = (1.0 - math.cos(phase)) / 2.0
    for side, bone in ((1.0, L_ARM), (-1.0, R_ARM)):
        if bone:
            offsets[bone] = about(rest[bone].translation, Matrix.Rotation(side * ARM * lift, 4, 'Y'))

    bpy.context.scene.frame_set(f)
    for name in order:
        pb = arm.pose.bones.get(name)
        if pb is None:
            continue
        """
        Every write is a *basis* — the bone's own offset from rest — so a parent's
        motion reaches its children instead of being cancelled by them.

        The offsets are authored in armature space, where +Z is up on every rig
        (bone local axes are not a convention in these bundles: the tails are
        synthesised and point nowhere near the limb). Conjugating through the
        bone's rest matrix turns an armature-space delta into the local one that
        produces it, which is the only step needed to keep both properties.

        Bones with neither an offset nor a resting-arm pose are not written at
        all. That is deliberate: an unwritten bone has an identity basis and
        follows its parent, which is exactly what a knee should do while the hips
        shift.
        """
        basis = ARM_BASIS.get(name, Matrix.Identity(4))
        delta = offsets.get(name)
        if delta is not None:
            R = rest[name].inverted() @ delta @ rest[name]
            basis = R @ basis
        elif name not in ARM_BASIS:
            pb.matrix_basis = Matrix.Identity(4)
            continue
        pb.matrix_basis = basis
        bpy.context.view_layer.update()
    for name in order:
        pb = arm.pose.bones.get(name)
        if pb is None:
            continue
        pb.keyframe_insert('location', frame=f)
        pb.keyframe_insert('rotation_quaternion', frame=f)

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
print('make-idle: wrote %s (%d frames, %.1fs)' % (OUT, total, SECONDS))
