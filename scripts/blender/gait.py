"""
Measures what a character's clips actually do, so the catalog can be told.

Three numbers per model, none of which can be guessed:

- **Ground speed of Walk and Run.** `premadeRig` divides real ground speed by
  these to get the playback rate, which is the whole mechanism that stops feet
  sliding. A clip is in-place, so the speed it *depicts* has to be inferred from
  its stride: the two feet reach their widest separation once per step, a cycle
  is two steps, so the distance covered per cycle is twice that separation.

- **Root drift.** A clip that translates its own root fights the stick — the
  character walks away from itself. Measured on the mesh in world space rather
  than on the root bone, because these rigs carry an 0.01 scale on the armature
  object and a bone matrix is in armature space: measured there, Mai's hips
  appeared to travel eight metres vertically on a 1.7 m body.

- **Grounding.** How far the lowest vertex strays from the floor, which is what
  tells you a foot sinks through it.

    blender -b --factory-startup -P scripts/blender/gait.py -- --in model.glb
"""

import bpy
import sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
SRC = argv[argv.index('--in') + 1] if '--in' in argv else (argv[0] if argv else None)
if not SRC:
    raise SystemExit('gait: --in <model.glb>')

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
arm = next((o for o in bpy.data.objects if o.type == 'ARMATURE'), None)
if arm is None:
    raise SystemExit('gait: not rigged')
mesh = max((o for o in bpy.data.objects if o.type == 'MESH'), key=lambda o: len(o.data.vertices))

names = {b.name.lower(): b.name for b in arm.data.bones}


def bone(*pats):
    for p in pats:
        for low, real in names.items():
            if p in low:
                return real
    return None


LF, RF = bone('lefttoe', 'leftfoot', 'foot.l'), bone('righttoe', 'rightfoot', 'foot.r')
pts = [mesh.matrix_world @ v.co for v in mesh.data.vertices]
H = max(p.z for p in pts) - min(p.z for p in pts)
print('gait: %s  height %.3f m' % (SRC.split('/')[-1], H))

for act in sorted(bpy.data.actions, key=lambda a: a.name):
    arm.animation_data_create()
    arm.animation_data.action = act
    if hasattr(act, 'slots') and len(act.slots):
        arm.animation_data.action_slot = act.slots[0]
    start, end = (int(round(x)) for x in act.frame_range)
    cycle = (end - start + 1) / 30.0
    sep = 0.0
    centres, lows = [], []
    for f in range(start, end + 1):
        bpy.context.scene.frame_set(f)
        bpy.context.view_layer.update()
        if LF and RF:
            a = arm.matrix_world @ arm.pose.bones[LF].matrix.translation
            b = arm.matrix_world @ arm.pose.bones[RF].matrix.translation
            sep = max(sep, abs(a.y - b.y))
        dg = bpy.context.evaluated_depsgraph_get()
        ev = mesh.evaluated_get(dg)
        me = ev.to_mesh()
        wp = [mesh.matrix_world @ v.co for v in me.vertices]
        centres.append(sum(wp, Vector()) / len(wp))
        lows.append(min(p.z for p in wp))
        ev.to_mesh_clear()

    drift = max((c - centres[0]).length for c in centres)
    speed = (2 * sep) / cycle if cycle else 0
    print('  %-5s %3d fr / %.2fs   stride %.3f m -> %.2f m/s (%.2f x height)   drift %.3f m   floor %.3f..%.3f'
          % (act.name, end - start + 1, cycle, sep, speed, speed / H if H else 0, drift, min(lows), max(lows)))
