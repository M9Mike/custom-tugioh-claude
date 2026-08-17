"""
Stops a running character putting one foot through the other.

    python3 scripts/blender/widen-stance.py public/models/duelists/*.glb

The Protagonist's Run clip swings his feet past the centre line — his left foot
ends up to the right of his right foot for a couple of frames each cycle, which
reads as crossed legs. Measured as a fraction of body height, the gap between
the feet through one cycle:

    yugi    +5.25% .. +9.40%    never crosses
    kaiba   +5.17% .. +11.01%   never crosses
    joey    +5.75% .. +11.04%   never crosses
    rookie  -1.16% .. +11.50%   crosses
    woman2  -0.47% .. +10.56%   crosses

The three that came with their own Run are clean. The ones that cross are the
Protagonist and everybody who borrows from him, which is the whole generic
roster — so it is one clip's problem wearing thirteen faces.

## What it does

Adds hip abduction — the legs spread a little — and only on the frames that
need it, scaled by how far under the target that frame is. A constant widening
would fix the crossing and leave the character bow-legged for the rest of the
cycle; this leaves the parts of the stride that were already fine exactly as
they were.

The axis to rotate about and the degrees-per-millimetre are both *measured* on
the rig rather than assumed, because bone axes differ between skeletons and a
guess here silently rotates the leg the wrong way.
"""

import sys

import bpy
from mathutils import Matrix

# A fraction of body height. The clean clips sit above 0.05; this is the floor
# rather than the ideal, so a correction only ever nudges the worst frames.
TARGET = 0.035
HIPS = ('LeftUpLeg', 'RightUpLeg')
FEET = ('LeftFoot', 'RightFoot')


def curves(action):
    """Every F-Curve, whichever way Blender laid the action out."""
    direct = getattr(action, 'fcurves', None)
    if direct is not None:
        return list(direct)
    out = []
    for layer in action.layers:
        for strip in layer.strips:
            for bag in getattr(strip, 'channelbags', []):
                out.extend(bag.fcurves)
    return out


def gap(arm, top, side):
    """Foot separation at the current frame, as a fraction of height.

    Signed so that positive is "the left foot is on the left" whichever way
    round this particular rig numbers its axes.
    """
    left = (arm.matrix_world @ arm.pose.bones['LeftFoot'].matrix).translation
    right = (arm.matrix_world @ arm.pose.bones['RightFoot'].matrix).translation
    return (left.x - right.x) * side / top


def widen(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.import_scene.gltf(filepath=path)

    arm = next((o for o in bpy.data.objects if o.type == 'ARMATURE'), None)
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    action = next((a for a in bpy.data.actions if a.name == 'Run'), None)
    name = path.rsplit('/', 1)[-1]
    if not arm or not meshes or not action or any(h not in arm.pose.bones for h in HIPS):
        print(f'{name:14} no rigged Run, skipped')
        return
    mesh = max(meshes, key=lambda o: len(o.data.polygons))
    top = max((mesh.matrix_world @ v.co).z for v in mesh.data.vertices)
    if not arm.animation_data:
        arm.animation_data_create()
    arm.animation_data.action = action

    end = int(action.frame_range[1])
    frames = list(range(0, end + 1))
    name_pad = f'{name:14}'

    def measure():
        out = {}
        for f in frames:
            bpy.context.scene.frame_set(f)
            out[f] = gap(arm, top, side)
        return out

    bpy.context.scene.frame_set(frames[0])
    side = 1 if gap(arm, top, 1) > 0 else -1
    gaps = measure()
    worst = min(gaps.values())
    if worst >= TARGET:
        print(f'{name_pad} {worst * 100:+6.2f}%  already clear')
        return

    #
    # Widened a step at a time rather than in one go.
    #
    # The step is sized from a probe — rotate the hips a little, see how far the
    # feet move — which is a linear estimate of something that is not linear,
    # and it undershot by a factor of three or more. Repeating it converges;
    # solving it exactly would mean inverting the rig.
    #
    # The probe is taken at the *pinch*, the frame where the legs are closest,
    # and re-taken each pass because the pinch moves as the stride opens up. A
    # hip bone's local axes run along the leg, so which way a given rotation
    # throws the foot depends on where in the stride that leg is — probing at
    # frame 0 instead made four models five times worse.
    #
    applied = 0
    for _ in range(8):
        pinch = min(gaps, key=gaps.get)
        if gaps[pinch] >= TARGET:
            break
        probe = 0.12
        bpy.context.scene.frame_set(pinch)
        base = gap(arm, top, side)
        best = None
        # Both handednesses are tried. Mirroring the two hips is what spreads
        # the legs on most of these rigs, but not all of them orient the left
        # and right bones as mirror images — three models stalled half-corrected
        # until the same-direction pairing was offered as well.
        for axis in 'XYZ':
            for direction in (1, -1):
                for hands in ((1, -1), (1, 1)):
                    for bone, hand in zip(HIPS, hands):
                        arm.pose.bones[bone].matrix_basis = Matrix.Rotation(probe * direction * hand, 4, axis)
                    bpy.context.view_layer.update()
                    moved = gap(arm, top, side) - base
                    for bone in HIPS:
                        arm.pose.bones[bone].matrix_basis = Matrix.Identity(4)
                    bpy.context.view_layer.update()
                    if moved > 0 and (best is None or moved > best[3]):
                        best = (axis, direction, hands, moved)
        if not best:
            break
        axis, direction, hands, per_probe = best
        rate = per_probe / probe

        need = {f: max(0.0, TARGET - gaps[f]) for f in frames}
        current = {}
        for f in frames:
            bpy.context.scene.frame_set(f)
            current[f] = {h: arm.pose.bones[h].rotation_quaternion.copy() for h in HIPS}
        for f in frames:
            bpy.context.scene.frame_set(f)
            extra = need[f] / rate if rate else 0.0
            for bone, hand in zip(HIPS, hands):
                pb = arm.pose.bones[bone]
                pb.rotation_quaternion = current[f][bone] @ Matrix.Rotation(
                    extra * direction * hand, 4, axis
                ).to_quaternion()
                pb.keyframe_insert('rotation_quaternion', frame=f)
        moved_to = measure()
        if min(moved_to.values()) <= min(gaps.values()) + 1e-4:
            break          # this pass bought nothing; stop rather than thrash
        gaps = moved_to
        applied += 1

    after = min(gaps.values())
    if after <= worst:
        print(f'{name_pad} {worst * 100:+6.2f}% → {after * 100:+6.2f}%  no better, left alone')
        return
    print(f'{name_pad} {worst * 100:+6.2f}% → {after * 100:+6.2f}%  ({applied} passes)')

    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', export_animations=True, export_skins=True
    )


for target in sys.argv[1:]:
    if target.endswith('.glb'):
        widen(target)
