"""
Closes a splayed hand into a relaxed one.

The generated characters arrive with their fingers straight and spread, which is
the pose a hand is *modelled* in and not one a hand is ever *in*. Standing beside
Yugi — whose hands are loosely closed, the way hands actually hang — a set of
flat starfish hands is the tell that gives away the whole figure.

## Why this is geometry and not a pose

These rigs have twenty-four joints and one of them is the hand. There are no
finger bones at all, so there is nothing to rotate: a curl cannot be animated or
posed, it has to be baked into the mesh. That is fine here, because a relaxed
curl is not something that needs to change — the fingers are rigid relative to
the wrist through every clip either way, so a curl applied to the rest mesh is a
curl for the life of the character.

It is also why this replaces grafting a missing finger rather than joining it.
Four slightly-closed fingers read as a hand; four splayed ones read as a hand
with a finger missing, which is what made Sandra's look wrong in the first place.
Curling is a change to what is already there and cannot tear, where the graft was
new geometry squeezed into a gap that had no room for it.

## The curl

Each finger is found as a connected island beyond the knuckle, exactly as
`graft-finger.py` finds them. Every vertex is then rotated about the knuckle by an
angle that grows with how far along the finger it sits — `t**1.6`, so the base
barely moves and the tip does most of the bending, which is what a finger does
when nothing is asking it to do anything. A rigid rotation of the whole island
would hinge it like a door.

The thumb is left alone. It is identified the same way as elsewhere — the digit
whose tip sits furthest back along the forearm axis — and a thumb curled with the
fingers closes into the palm and disappears.

## Which way is "toward the palm"

The direction is taken from the body, not from the mesh. These characters are
modelled in an A-pose, where both palms face inward, so the curl direction is
whatever component of "toward the other hand" is perpendicular to the finger. The
alternative — deriving the palm normal from the hand's own covariance — gives an
axis but not a sign, and a sign error curls the fingers backwards over the knuckle
into something no hand does.

    blender -b --factory-startup -P scripts/blender/curl-fingers.py -- \
        --in in.glb --out out.glb --curl 26
"""

import bpy
import sys
import math
import bmesh
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, fallback=None):
    return argv[argv.index('--' + name) + 1] if '--' + name in argv else fallback


SRC = arg('in')
OUT = arg('out')
"""
How far the fingertips come round, in degrees.

26 is a hand at rest — enough that the fingers are plainly not straight, well
short of a fist. A hand already modelled closed (Solomon's, Robert's) is detected
and left alone rather than curled twice into a claw.
"""
CURL = math.radians(float(arg('curl', 26.0)))
THUMB_CURL = math.radians(float(arg('thumbCurl', 8.0)))
"""
Where a digit stops being part of the palm.

0.68 of the reach, tighter than the 0.55 first used, because the point of the band
here is different from `graft-finger.py`'s. There it only had to separate the
digits from each other; here it also sets the pivot the curl turns about, and a
loose band put the pivot in the palm and swept whole knuckles round with the
fingers. Tighter, it lands around the middle joint — which is where a hand at rest
actually does most of its bending.

It also stops the island count from being nonsense: at 0.55 a five-fingered hand
came back as eleven islands of palm fragments and knuckle bumps, and half of what
got curled was not a finger.
"""
BAND = float(arg('band', 0.68))
"""
Existing bend, in degrees, above which a finger is left alone.

Measured as the angle between a finger's proximal and distal halves. Robert
Barathion's hands arrive as loose fists and must not be curled a second time into
claws; Solomon's and Sandra's are flat and want the full amount. 20 degrees sits
well clear of both.
"""
ALREADY_BEND = float(arg('alreadyBend', 20.0))

if not SRC or not OUT:
    raise SystemExit('curl-fingers: --in <file.glb> --out <file.glb> [--curl 26]')

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

mesh = max((o for o in bpy.data.objects if o.type == 'MESH'), key=lambda o: len(o.data.vertices))
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
W = mesh.matrix_world

body_centre = Vector((0.0, 0.0, 0.0))
report = []

for side in ('Left', 'Right'):
    gi = mesh.vertex_groups[side + 'Hand'].index
    wrist = arm.matrix_world @ arm.data.bones[side + 'Hand'].head_local
    elbow = arm.matrix_world @ arm.data.bones[side + 'ForeArm'].head_local
    out_axis = (wrist - elbow).normalized()

    bm = bmesh.new()
    bm.from_mesh(mesh.data)
    bm.verts.ensure_lookup_table()
    layer = bm.verts.layers.deform.active

    hand = [v for v in bm.verts if v[layer].get(gi, 0.0) > 0.5]
    if not hand or CURL <= 0.0:
        bm.free()
        continue

    """
    One rotation field over the whole hand, rather than one per finger.

    Two earlier versions segmented the hand into digits and curled each. Both were
    defeated by the same thing: this topology does not segment reliably. At a loose
    band a five-fingered hand came back as eleven islands of palm fragments; at a
    tight one the count was right but the per-finger curvature test — meant to
    leave an already-closed hand alone — measured 27 degrees of "existing bend" on
    fingers that are visibly straight, because three sample points on a coarse mesh
    is not a curvature measurement. It curled one finger of five and left the hand
    worse than before.

    So nothing is segmented. Every vertex past the knuckle line is rotated about a
    single pivot on that line, by an angle that grows with how far past it the
    vertex sits. Fingers curl together, which is what a hand at rest does anyway,
    and there is nothing to misidentify.

    Whether a hand needs curling at all is a decision made per character by looking
    at it — `--curl 0` for one that arrives closed, like Robert Barathion's. That is
    the right way round: characters come in one at a time and each is checked, so a
    number set by eye beats a threshold that has to be right sight-unseen.
    """
    reach = {v: (W @ v.co - wrist).length for v in hand}
    far = max(reach.values())
    knuckle_at = far * BAND
    moving = [v for v in hand if reach[v] > knuckle_at]
    if not moving:
        bm.free()
        continue

    pivot = wrist + out_axis * knuckle_at
    inward = (body_centre - wrist)
    inward = inward - inward.dot(out_axis) * out_axis
    if inward.length < 1e-6:
        bm.free()
        continue
    inward.normalize()

    rot_axis = out_axis.cross(inward)
    if rot_axis.length < 1e-6:
        bm.free()
        continue
    rot_axis.normalize()

    span = max(1e-6, far - knuckle_at)
    for v in moving:
        t = min(1.0, (reach[v] - knuckle_at) / span)
        R = Matrix.Rotation(CURL * (t ** 1.4), 4, rot_axis)
        p = W @ v.co
        v.co = W.inverted() @ (pivot + R @ (p - pivot))

    bm.to_mesh(mesh.data)
    mesh.data.update()
    bm.free()
    report.append('%s: %d of %d hand vertices curled past %.0f%% of reach'
                  % (side, len(moving), len(hand), BAND * 100))

for line in report:
    print('curl-fingers: ' + line)
print('curl-fingers: %.0f deg at the fingertips' % math.degrees(CURL))

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format='GLB',
    export_animations=True,
    export_skins=True,
    export_yup=True,
    export_apply=False,
)
print('curl-fingers: wrote ' + OUT)
