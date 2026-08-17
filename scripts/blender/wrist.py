"""
Takes the break out of a wrist that was animated bent too hard.

The generated Walk and Run are good motion with one recurring tell: the hand is
carried at a sharp angle to the forearm, so the wrist reads as broken rather than
relaxed. It is most obvious at the extremes of the arm swing, where the hand
lags behind the forearm and the join creases.

## The number, and where it comes from

Two characters off the same generator and the same 24-bone layout give a
baseline. Mai's wrists sit at 8 degrees in her idle and range 3–30 through her
clips, which reads correctly. Sandra Afrika's sit at 27 in the idle and reach 53
on her right wrist mid-run — twice the bend, and past the point where a real
wrist stops looking loose and starts looking dislocated.

So the target is Mai's range, and the operation is a soft knee: below `--maxBend`
a frame is left exactly as animated, and above it the excess is compressed by
`--soft` rather than removed.

Compressed, not clamped, and the difference is the whole point. A hard cap was
tried first and it flattened the run: every frame of Sandra's Run exceeded the
limit, so every frame came back at precisely 20 degrees and her wrists went
rigid for the entire cycle — a wrist held at a constant angle through a run is
its own kind of wrong, and a worse kind, because a broken wrist looks like a bad
model and a frozen one looks like a bug. Compressing keeps the shape of the
motion and takes the extremes off it.

## Why this is not just an offset on the rest pose

A constant correction would work for the idle, where the bend never changes, and
fail everywhere else: the bend swings from 12 to 44 degrees inside one walk
cycle, so an offset big enough to fix the extreme over-corrects the middle and
bends the wrist the other way. The correction has to be computed per frame from
that frame's own bend, which is what this does.

Hands only. Nothing else in the clip is touched, so the arm swing, the stride and
the root motion all come out of this bit-identical.

    blender -b --factory-startup -P scripts/blender/wrist.py -- \
        --in in.glb --out out.glb --maxBend 20
"""

import bpy
import sys
import math
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, fallback=None):
    return argv[argv.index('--' + name) + 1] if '--' + name in argv else fallback


SRC = arg('in')
OUT = arg('out')
MAX_BEND = math.radians(float(arg('maxBend', 18.0)))
SOFT = float(arg('soft', 0.3))

"""
Clips are found by normalised name, not by exact match.

This runs before `import-rigged`, which is what renames the generator's
`Walking` and `Running` to the `Walk` and `Run` the game plays. Looking for the
game's names here silently found only `Idle` and left both gait clips at their
original bend — the fix reported success and changed nothing that moves.
"""
ALIASES = {'idle': 'Idle', 'walk': 'Walk', 'walking': 'Walk',
           'run': 'Run', 'running': 'Run'}

if not SRC or not OUT:
    raise SystemExit('wrist: --in <file.glb> --out <file.glb> [--maxBend 20]')

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')

bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='POSE')

report = {}

targets = [(a, ALIASES[a.name.lower().replace(' ', '').replace('_', '')])
           for a in bpy.data.actions
           if a.name.lower().replace(' ', '').replace('_', '') in ALIASES]
if not targets:
    raise SystemExit('wrist: no Idle/Walk/Run clip found in %s' % SRC)

for action, clip in targets:
    arm.animation_data_create()
    arm.animation_data.action = action
    if hasattr(action, 'slots') and action.slots:
        try:
            arm.animation_data.action_slot = action.slots[0]
        except Exception:
            pass

    start, end = (int(round(x)) for x in action.frame_range)
    worst = {}

    for f in range(start, end + 1):
        bpy.context.scene.frame_set(f)
        bpy.context.view_layer.update()

        for side in ('Left', 'Right'):
            fore = arm.pose.bones[side + 'ForeArm']
            hand = arm.pose.bones[side + 'Hand']

            """
            The forearm's direction is head-to-head, which is the segment the
            hand actually hangs off; the hand's own direction is its local +Y,
            which is what a bone points along in Blender.
            """
            fdir = (hand.head - fore.head).normalized()
            hdir = (hand.matrix.to_3x3() @ Vector((0, 1, 0))).normalized()
            bend = fdir.angle(hdir)
            worst[side] = max(worst.get(side, 0.0), math.degrees(bend))

            if bend <= MAX_BEND:
                continue

            axis = hdir.cross(fdir)
            if axis.length < 1e-6:
                continue
            # soft knee: keep a fraction of the excess so the cycle keeps its shape
            want = MAX_BEND + (bend - MAX_BEND) * SOFT
            R = Matrix.Rotation(bend - want, 4, axis.normalized())

            """
            Rotated about the wrist itself. `pose.bone.matrix` is in armature
            space, so the correction is conjugated by a translation to the head
            — rotating about the armature origin instead would swing the whole
            hand across the body.
            """
            h = hand.head.copy()
            hand.matrix = Matrix.Translation(h) @ R @ Matrix.Translation(-h) @ hand.matrix
            bpy.context.view_layer.update()

            hand.keyframe_insert('rotation_quaternion', frame=f)
            hand.keyframe_insert('location', frame=f)

    report[clip] = worst
    arm.animation_data.action = None

bpy.ops.object.mode_set(mode='OBJECT')

for clip, worst in report.items():
    print('wrist: %-4s worst bend before: %s'
          % (clip, '  '.join('%s %.1f' % (s, v) for s, v in worst.items())))
print('wrist: knee at %.0f degrees, excess kept at %.2f' % (math.degrees(MAX_BEND), SOFT))

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format='GLB',
    export_animations=True,
    export_skins=True,
    export_yup=True,
    export_apply=False,
)
print('wrist: wrote ' + OUT)
