"""
Renders a rigged character mid-clip, so the skinning can be looked at.

Auto-skinning is not verifiable by inspection of its own output: every run
reports the same "every vertex weighted" and the difference between a good bind
and one that tears the shoulder open only exists on screen, part-way through a
stride. So the check is a contact sheet — the rest pose, then Idle, Walk and Run
sampled across their cycles — and the thing to look for is limbs bending at the
joint rather than the mesh stretching between them.

    blender -b --factory-startup -P scripts/blender/pose-sheet.py -- \
        --in /tmp/christy-rigged.glb --out /tmp/sheet
"""

import bpy
import sys
import math
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, fallback=None):
    return argv[argv.index('--' + name) + 1] if '--' + name in argv else fallback


SRC = arg('in')
OUT = arg('out', '/tmp/sheet')
SIZE = int(arg('size', '420'))
"""
Which way round the character is shot.

18 degrees is nearly front-on, which is the angle a bad *bind* shows at — a torn
shoulder, a bloated forearm, a face pulled sideways. It is the wrong angle for a
bad *clip*: a stride is almost entirely fore-and-aft, so front-on hides the size
of the step, whether the knee bends, and whether the planted foot stays planted.
Shoot 90 for those.
"""
AZIMUTH = float(arg('azimuth', '18'))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

arm = next((o for o in bpy.data.objects if o.type == 'ARMATURE'), None)
"""
Only the character, for framing.

Blender's "empty" scene is not reliably empty — a 42-vertex icosphere two metres
across turns up in it on this install — and these bundles are imported into it.
It is small enough not to draw and big enough to *frame*: bounds taken over
every mesh in the scene made a 1.70 m character 2.70 m tall, and every sheet
rendered of one was pulled back and shifted down by the difference. The camera
was looking at the wrong thing, quietly, in the one tool whose entire job is
being looked at.
"""
meshes = [o for o in bpy.data.objects
          if o.type == 'MESH' and (arm is None or o.parent is arm)]

pts = [m.matrix_world @ v.co for m in meshes for v in m.data.vertices]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
mid = (lo + hi) / 2
height = hi.z - lo.z

scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.render.resolution_x = SIZE
scene.render.resolution_y = int(SIZE * 1.5)
scene.render.film_transparent = False
shading = scene.display.shading
shading.light = 'STUDIO'
shading.color_type = 'TEXTURE'
shading.show_shadows = True
shading.show_cavity = True

cam_data = bpy.data.cameras.new('cam')
cam = bpy.data.objects.new('cam', cam_data)
scene.collection.objects.link(cam)
scene.camera = cam


def look_from(azimuth_deg):
    """Frame the whole body from a given angle around it."""
    dist = height * 1.9
    a = math.radians(azimuth_deg)
    cam.location = Vector((math.sin(a) * dist, -math.cos(a) * dist, mid.z + height * 0.10))
    direction = (Vector((mid.x, mid.y, mid.z)) - cam.location)
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    cam_data.lens = 55


def shoot(path):
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


look_from(AZIMUTH)

# rest pose first: nothing playing, so a bad bind shows before any motion does
if arm and arm.animation_data:
    arm.animation_data.action = None
shoot('%s/00-rest.png' % OUT)

for clip in ('Idle', 'Walk', 'Run'):
    action = bpy.data.actions.get(clip)
    if not action or not arm:
        print('pose-sheet: no %s' % clip)
        continue
    arm.animation_data_create()
    arm.animation_data.action = action
    if hasattr(action, 'slots') and len(action.slots):
        arm.animation_data.action_slot = action.slots[0]
    start, end = (int(round(x)) for x in action.frame_range)
    span = max(1, end - start)
    for i in range(4):
        scene.frame_set(start + int(span * i / 4))
        shoot('%s/%s-%d.png' % (OUT, clip, i))

print('pose-sheet: wrote %s' % OUT)
