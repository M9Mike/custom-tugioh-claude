"""
Gives a hand back a finger it was generated without.

Sandra Afrika arrives with three fingers and a thumb on each hand, plus a
forty-vertex nub where the fourth finger should be — the generator started one
and did not finish it. This grows the missing finger by copying a neighbouring
one, which is the only approach available: her texture is a baked 4096 atlas
with no space allocated for new surfaces, so anything modelled from scratch
would arrive untextured. A copy brings its own UVs and lands on the same patch
of skin.

## Why a copy is good enough here

A finger is nearly featureless. There is no distinctive detail to give the trick
away — the same knuckle creases and the same nail, seen at a different angle,
read as a different finger. That is not true of a face or a garment, which is
why this script is about fingers and nothing else.

## Why it is not mirrored from the other hand

The obvious move — take the good hand, mirror it — is wrong for this cast. The
characters are posed individually and are *deliberately* not symmetrical: her
wrists sit at different angles and her two hands have different topology
(1642 vertices against 1148). Mirroring would replace one of her hands with a
flipped copy of the other and throw away the pose. So the donor is always a
finger from the *same* hand.

## How the copy is placed

The three real fingers give a knuckle line and a spacing. Ordered along that
line they are unevenly spaced — the gap between the middle finger and the
outermost is half again the gap on the other side — so the missing finger's slot
is that wide gap, and its position is the gap's centre. Length is interpolated
from its two neighbours rather than copied, because a finger that matched its
donor exactly would break the taper a hand reads by.

**The base is buried, not stitched.** The copy is pushed back along the palm
normal until its base ring is inside the palm. Nothing is welded: the surfaces
interpenetrate, and from outside — which is the only place anyone looks — it is
a finger emerging from a knuckle. Stitching would mean cutting a hole in the
palm and bridging two loops of different vertex counts, which is a great deal
more that can go visibly wrong for a join nobody can see.

The nub is deleted first, or it pokes out through the new finger.

    blender -b --factory-startup -P scripts/blender/graft-finger.py -- \
        --in ~/Downloads/SandraAfrika.glb --out /tmp/sandra-fixed.glb
"""

import bpy
import sys
import bmesh
import math
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, fallback=None):
    return argv[argv.index('--' + name) + 1] if '--' + name in argv else fallback


SRC = arg('in')
OUT = arg('out')
NUB_MAX = int(arg('nubMax', 70))        # a finger below this is a fragment
BAND = float(arg('band', 0.62))         # fraction of reach that isolates fingers
SINK = float(arg('sink', 0.018))        # how far the base goes into the knuckle
# girth of the copy relative to its donor, across the finger's own axis
THIN = float(arg('thin', 0.80))
# swing the neighbouring fingers apart to make room; see the note below
SPREAD = float(arg('spread', 0.0))

if not SRC or not OUT:
    raise SystemExit('graft-finger: --in <file.glb> --out <file.glb>')

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

mesh = max((o for o in bpy.data.objects if o.type == 'MESH'), key=lambda o: len(o.data.vertices))
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
W = mesh.matrix_world


def digit_islands(bm, group_index, wrist, band):
    """Connected components of the outer hand, one per digit (plus fragments)."""
    layer = bm.verts.layers.deform.active
    hand = [v for v in bm.verts if v[layer].get(group_index, 0.0) > 0.5]
    if not hand:
        return [], 0.0
    reach = max((W @ v.co - wrist).length for v in hand)
    keep = set(v for v in hand if (W @ v.co - wrist).length > reach * band)
    seen, comps = set(), []
    for v in keep:
        if v in seen:
            continue
        stack, comp = [v], []
        while stack:
            x = stack.pop()
            if x in seen:
                continue
            seen.add(x)
            comp.append(x)
            for e in x.link_edges:
                o = e.other_vert(x)
                if o in keep and o not in seen:
                    stack.append(o)
        comps.append(comp)

    """
    A nail is split from the skin it sits on, so one finger arrives as two
    islands whose far ends are a few millimetres apart. Merged by proximity of
    their far ends — anything within 20 mm is the same digit.
    """
    merged = []
    for comp in sorted(comps, key=lambda c: -len(c)):
        end = W @ max(comp, key=lambda v: (W @ v.co - wrist).length).co
        hit = next((m for m in merged if (m[0] - end).length < 0.020), None)
        if hit:
            hit[1].extend(comp)
        else:
            merged.append([end, comp])
    return merged, reach


report = []

for side in ('Left', 'Right'):
    gi = mesh.vertex_groups[side + 'Hand'].index
    wrist = arm.matrix_world @ arm.data.bones[side + 'Hand'].head_local
    elbow = arm.matrix_world @ arm.data.bones[side + 'ForeArm'].head_local

    bm = bmesh.new()
    bm.from_mesh(mesh.data)
    bm.verts.ensure_lookup_table()
    digits, reach = digit_islands(bm, gi, wrist, BAND)

    real = [d for d in digits if len(d[1]) > NUB_MAX]
    nubs = [d for d in digits if len(d[1]) <= NUB_MAX]

    """
    The thumb is not part of the knuckle line and must not be counted into its
    spacing. It is the digit whose far end is closest to the forearm axis —
    every finger points away down the hand, the thumb sticks out sideways and
    sits much further back.
    """
    out_axis = (wrist - elbow).normalized()
    def along(p):
        return (p - wrist).dot(out_axis)
    real.sort(key=lambda d: -along(d[0]))
    fingers = real[:3]
    thumb = real[3] if len(real) > 3 else None

    """
    The knuckle line: the axis the fingers are spread along, taken as the
    direction of greatest spread between their far ends. Ordered along it, the
    missing finger's slot is the widest gap.
    """
    ends = [d[0] for d in fingers]
    centre = sum(ends, Vector()) / len(ends)
    spread = None
    for ax in (Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))):
        s = max((p - centre).dot(ax) for p in ends) - min((p - centre).dot(ax) for p in ends)
        if spread is None or s > spread[0]:
            spread = (s, ax)
    axis = spread[1]
    ordered = sorted(fingers, key=lambda d: d[0].dot(axis))

    gaps = [((ordered[i + 1][0] - ordered[i][0]).length, i) for i in range(len(ordered) - 1)]
    gaps.sort(reverse=True)
    width, at = gaps[0]
    left, right = ordered[at], ordered[at + 1]

    """
    Donor is the *longer* of the two fingers bracketing the gap, because a copy
    can be shortened convincingly and lengthening one stretches its nail.
    """
    donor = left if (left[0] - wrist).length > (right[0] - wrist).length else right
    other = right if donor is left else left
    slot = (left[0] + right[0]) / 2
    want_len = ((left[0] - wrist).length + (right[0] - wrist).length) / 2

    # ---- copy the donor finger ----
    donor_set = set(donor[1])
    faces = [f for f in bm.faces if all(v in donor_set for v in f.verts)]
    """
    Faces only. `duplicate` brings each face's own edges and vertices with it,
    so listing them as well passes the same element twice and it refuses the
    whole call.
    """
    ret = bmesh.ops.duplicate(bm, geom=faces)
    new_verts = [g for g in ret['geom'] if isinstance(g, bmesh.types.BMVert)]

    """
    Placement, in the hand's own frame:
      · slide along the knuckle line into the empty slot
      · scale toward the wrist so the length matches its neighbours
      · sink along the palm normal so the base ring ends up inside the palm
    """
    donor_end = donor[0]
    shift = (slot - donor_end)
    shift = shift.dot(axis) * axis                    # along the knuckle line only

    """
    Sink along the finger's *own* axis, not the palm normal.

    The first attempt pushed the copy sideways into the palm by 4 mm, which was
    both too little and the wrong direction: the island was cut at the knuckle,
    so its base is an open rim, and a rim that clears the palm surface lets you
    look straight down the inside of the finger. It rendered as a bright hole
    beside every graft.

    Pushing back along the finger's own axis is how a finger actually meets a
    knuckle — the base slides into the hand rather than through the side of it.
    The length lost to sinking is added back by `scale`, so the exposed finger
    still matches its neighbours.
    """
    base = sum((W @ v.co for v in donor[1]), Vector()) / len(donor[1])
    finger_axis = (donor_end - base).normalized()
    exposed = want_len + SINK
    scale = exposed / max(1e-6, (donor_end - wrist).length)

    """
    Rotated into the slot about the wrist, not slid into it.

    Translating along the knuckle line was the obvious move and it is wrong,
    because fingers are not parallel — they radiate from the palm. A copy moved
    sideways keeps its donor's direction, so it converges on its new neighbour
    and the two surfaces cut through each other: the render came back with a dark
    crevice down the side of every graft.

    A rotation about the wrist follows the fan. The angle is the one between the
    donor's own direction and the slot's, taken about the axis those two span, so
    the copy arrives pointing the way a finger in that position points and stays
    the same distance from both neighbours along its whole length.
    """
    """
    Make room for it, rather than shaving it down to fit.

    Two earlier versions failed the same way. The slot is the midpoint of the
    widest gap *measured at the fingertips*, which is where the fan is widest —
    nearer the knuckle the two bracketing fingers are far closer than that, so a
    full-girth copy cut through both of them and the overlap rendered as a dark
    crevice. Thinning the copy to 0.78 helped a little and did not fix it, because
    the crevice was never about girth: three fingers are spread across the whole
    width of a hand, and there is simply no room between two of them for a fourth.

    A four-fingered hand does not have thinner fingers than a three-fingered one.
    It has them spread differently. So the obvious third idea was to swing the two
    neighbours apart about the wrist and drop the copy into the room that opens.

    **That is off by default, because it is worse.** A finger "island" here is only
    the part beyond the knuckle — the band that isolates the digits starts at 62%
    of the reach — so rotating one about the wrist slides it away from the palm it
    grows out of and tears a gap at its base. At nine degrees it put a visible
    sliver through the side of the hand. Opening a slot needs the knuckle and the
    web between the fingers to deform with it, which is a soft-body edit this does
    not do.

    `--spread 1` re-enables it if a hand ever has the room to make it work.

    So what actually ships is the second-best thing: the copy is thinned across
    its own axis and placed at the midpoint. The residual is a faint crease where
    it passes its neighbour, visible at roughly thirty times the size a hand
    occupies in game, and not resolvable by moving geometry that has nowhere to go.
    """
    from mathutils import Matrix
    fan_normal = out_axis.cross(axis)
    if fan_normal.length < 1e-6:
        fan_normal = Vector((0.0, 0.0, 1.0))
    fan_normal.normalize()
    slot_dir = (slot - wrist).normalized()

    def fan_angle(point):
        """Signed angle of a direction from the slot, in the plane the fingers fan in."""
        d = (point - wrist).normalized()
        return math.atan2(d.cross(slot_dir).dot(fan_normal), d.dot(slot_dir))

    girth = max(
        (W @ v.co - (base + finger_axis * (W @ v.co - base).dot(finger_axis))).length
        for v in donor[1]
    )
    need = SPREAD * 2.0 * math.atan2(girth, max(1e-6, want_len))

    def swing_island(island, radians):
        R = Matrix.Rotation(radians, 4, fan_normal)
        for v in island:
            p = W @ v.co
            v.co = W.inverted() @ (wrist + R @ (p - wrist))

    swung = 0.0
    for bracket in (left, right):
        a = fan_angle(bracket[0])
        if abs(a) < 1e-4:
            continue
        away = math.copysign(need / 2.0, a)
        swing_island(bracket[1], away)
        swung += abs(away)

    """
    The copy is then rotated from its donor's direction onto the slot, which is
    now genuinely empty. Length is set about the wrist and the base sunk along the
    finger's own axis, exactly as before.
    """
    v_donor = (donor_end - wrist).normalized()
    swing_axis = v_donor.cross(slot_dir)
    if swing_axis.length > 1e-6:
        R = Matrix.Rotation(v_donor.angle(slot_dir), 4, swing_axis.normalized())
    else:
        R = Matrix.Identity(4)

    axis_centre = (base + donor_end) / 2
    for v in new_verts:
        p = W @ v.co
        # squeeze toward the finger's own centre line, so it fits between two others
        rel = p - axis_centre
        along_axis = rel.dot(finger_axis) * finger_axis
        p = axis_centre + along_axis + (rel - along_axis) * THIN
        p = wrist + R @ ((p - wrist) * scale)         # onto the slot, at length
        p = p - finger_axis * SINK                    # base into the knuckle
        v.co = W.inverted() @ p

    """
    Cap the rim regardless. Sinking should put it inside the palm, but a hand
    the graft is 2 mm shallow on would show the inside of a finger, and a filled
    rim is a few triangles that can never be seen if the sinking worked.
    """
    rim = [e for e in bm.edges
           if e.is_boundary and all(v in set(new_verts) for v in e.verts)]
    if rim:
        bmesh.ops.holes_fill(bm, edges=rim, sides=0)

    # ---- delete the unfinished nub ----
    doomed = []
    for end, comp in nubs:
        # only nubs on this hand, and only ones near the slot we just filled
        if (end - slot).length < 0.05:
            doomed.extend(comp)
    if doomed:
        """
        Delete the nub, then close the hole it leaves.

        Deleting vertices takes their faces with them, which opens the surface —
        and `import-rigged` turns off double-siding, so an open surface is a hole
        you can see straight through into the inside of the hand. It rendered as a
        dark notch beside the new finger, and read as the grafted finger being cut
        off at the tip rather than as a hole in the knuckle behind it.

        The boundary is collected *after* the delete, because that is when it
        exists, and only edges that were not already boundaries before it — a
        model with pre-existing open edges elsewhere must not have them filled by
        a finger graft.
        """
        was_open = set(e for e in bm.edges if e.is_boundary)
        bmesh.ops.delete(bm, geom=list(set(doomed)), context='VERTS')
        opened = [e for e in bm.edges if e.is_boundary and e not in was_open]
        if opened:
            bmesh.ops.holes_fill(bm, edges=opened, sides=0)
            filled = len(opened)
        else:
            filled = 0
    else:
        filled = 0

    bm.to_mesh(mesh.data)
    mesh.data.update()
    bm.free()

    report.append(
        '%s: %d fingers + %s -> grafted 1 (donor len %.3f, new len %.3f, slot gap %.3f, '
        'nub %d verts, %d edges closed, neighbours opened %.1f deg)'
        % (side, len(fingers), 'thumb' if thumb else 'no thumb',
           (donor_end - wrist).length, want_len, width, len(set(doomed)), filled,
           math.degrees(swung))
    )

for line in report:
    print('graft-finger: ' + line)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format='GLB',
    export_animations=True,
    export_skins=True,
    export_yup=True,
    export_apply=False,
)
print('graft-finger: wrote ' + OUT)
