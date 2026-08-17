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
    """Mean armature-space transform of the arm chain across the walk."""
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
            m = pb.matrix
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


BASE = dict(rest)
for name, m in neutral_arms().items():
    BASE[name] = m
print('make-idle: arms relaxed from the walk (%d bones)' % len(ARM_CHAIN))

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
BOB = 0.0045 * height * STRENGTH
SWAY = 0.0035 * height * STRENGTH
LEAN = math.radians(0.9) * STRENGTH
BREATH = math.radians(1.3) * STRENGTH
NOD = math.radians(0.7) * STRENGTH
ARM = math.radians(1.1) * STRENGTH


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
    for side, bone in ((1.0, L_ARM), (-1.0, R_ARM)):
        if bone:
            offsets[bone] = about(BASE[bone].translation, Matrix.Rotation(side * ARM * breath, 4, 'Y'))

    bpy.context.scene.frame_set(f)
    for name in order:
        pb = arm.pose.bones.get(name)
        if pb is None:
            continue
        pb.matrix = offsets[name] @ BASE[name] if name in offsets else BASE[name]
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
