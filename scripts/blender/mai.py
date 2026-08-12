"""
Mai Valentine, built rather than repainted.

    pip install bpy && python3 scripts/blender/mai.py

Everything else in the cast is either a real rip or a generic body wearing a
recolour. Mai is neither and cannot be: no model of her is available to us, and
the body she is closest to wears a chin-length bob where she is drawn with a
mane. Colour is a texture problem and was solved in `repaint.ts`; *shape* is
not, and nothing at runtime can help — three.js can hang a prop off a bone but
it cannot cut faces out of a mesh.

So this does the surgery offline. It takes `woman2.glb`, removes the bob,
builds hair in its place, skins the new geometry to the same `Head` bone, and
writes `mai.glb`. The result is one mesh, one material, one draw call, and it
animates on the game's own Idle/Walk/Run because it is the same skeleton
throughout.

## Finding the bob

Two tests, and it needs both. The hair has no material of its own — the whole
body shares one 256×256 atlas — so material cannot find it. Its UVs sit in the
atlas's hair block, but so do eight stray faces down on the body. It is weighted
to the `Head` bone, but so is the face.

Weighted to `Head` *and* UV'd into the hair block is exactly the bob: 741 faces,
against 59 for the face and 8 for the strays.

## The hole

These models have no scalp. The bob is not hair laid over a head, it *is* the
top of the head, so deleting it opens the skull — which is why the new hair is
a closed shell around the whole cranium rather than a wig laid on top.

## Where the new hair takes its colour

From the atlas, at the texel the old bob was mostly made of. That keeps it
inside the existing pipeline: `repaint.ts` recolours the hair block at runtime,
so the built hair recolours with it and her blonde stays authored in one place
rather than baked into two.
"""

import math
import sys
from collections import Counter

import bpy
import bmesh
from mathutils import Matrix, Vector

SRC = 'public/models/duelists/woman2.glb'
OUT = 'public/models/duelists/mai.glb'

# ---------------------------------------------------------------- scene

bpy.ops.wm.read_factory_settings(use_empty=True)
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.import_scene.gltf(filepath=SRC)

mesh = bpy.data.objects['Mesh_0']
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
body_mat = next(i for i, m in enumerate(mesh.data.materials) if m.name.endswith('body_tex'))
head_group = mesh.vertex_groups['Head'].index
uvs = mesh.data.uv_layers.active


def dominant(vi):
    """Which bone owns this vertex."""
    best, weight = None, 0.0
    for g in mesh.data.vertices[vi].groups:
        if g.weight > weight:
            best, weight = g.group, g.weight
    return best


def face_uv(poly):
    us = [uvs.data[l].uv[0] for l in poly.loop_indices]
    vs = [uvs.data[l].uv[1] for l in poly.loop_indices]
    return (sum(us) / len(us)) % 1.0, (sum(vs) / len(vs)) % 1.0


def is_bob(poly):
    u, v = face_uv(poly)
    return u < 0.5 and v > 0.5 and all(dominant(i) == head_group for i in poly.vertices)


bob = [p.index for p in mesh.data.polygons if is_bob(p)]
if not 400 < len(bob) < 1200:
    sys.exit(f'the bob came out as {len(bob)} faces, which is not a head of hair — check the source model')

# --------------------------------------------- what the bob is painted

image = next(i for i in bpy.data.images if i.size[0] == 256)
px = list(image.pixels)
W, H = image.size


def texel(u, v):
    x = min(W - 1, max(0, int(u * W)))
    y = min(H - 1, max(0, int(v * H)))
    o = (y * W + x) * 4
    return tuple(round(c, 3) for c in px[o:o + 3])


counts = Counter()
spots = {}
bob_uv = []
for i in bob:
    u, v = face_uv(mesh.data.polygons[i])
    bob_uv.append((u, v))
    c = texel(u, v)
    counts[c] += 1
    spots.setdefault(c, (u, v))
HAIR_UV = spots[counts.most_common(1)[0][0]]

"""
The patch of atlas the new hair reads from.

Not one texel — a flat fill reads as plastic, and what makes this look like the
game's hair is that the game *drew strands on it*. So the built geometry is
mapped across a patch of the island the bob was using and picks the drawing up.

Which patch is searched for rather than guessed. The island runs from the solid
mid-tone down through the near-black lines between locks and out to the edges
where it meets skin, and a piece mapped across all of that comes out dark at one
end — the first run gave her a crown of black spikes. So this scores every
candidate window on how *uniform* it is and takes the steadiest bright one,
which is the middle of a lock: strand detail, no shadow, no bleed.
"""
def luma(uv_):
    r, g, b = texel(*uv_)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


us = sorted(u for u, _ in bob_uv)
vs = sorted(v for _, v in bob_uv)
IU0, IU1 = us[len(us) // 20], us[-len(us) // 20]
IV0, IV1 = vs[len(vs) // 20], vs[-len(vs) // 20]
WU, WV = 0.05, 0.04
best = None
step = 0.01
cu = IU0
while cu + WU <= IU1:
    cv = IV0
    while cv + WV <= IV1:
        vals = [
            luma((cu + WU * i / 4, cv + WV * j / 4))
            for i in range(5)
            for j in range(5)
        ]
        mean = sum(vals) / len(vals)
        spread = max(vals) - min(vals)
        # steadiest first, brightest to break ties: a dark patch is a shadow.
        score = spread - mean * 0.25
        if best is None or score < best[0]:
            best = (score, cu, cv, mean, spread)
        cv += step
    cu += step
_, U0, U1, MEAN, SPREAD = best[0], best[1], best[1] + WU, best[3], best[4]
V0, V1 = best[2], best[2] + WV
print(f'bob: {len(bob)} faces; hair patch u {U0:.3f}..{U1:.3f} v {V0:.3f}..{V1:.3f} (luma {MEAN:.3f}, spread {SPREAD:.3f})')

# ------------------------------------------------------ measure the head

face_pts = [
    mesh.matrix_world @ mesh.data.vertices[i].co
    for p in mesh.data.polygons
    if mesh.data.materials[p.material_index].name.endswith('face_tex')
    for i in p.vertices
]
bob_pts = [mesh.matrix_world @ mesh.data.vertices[i].co for i in bob for i in mesh.data.polygons[i].vertices]
CX = 0.0
CY = (min(p.y for p in bob_pts) + max(p.y for p in bob_pts)) / 2
CZ = (min(p.z for p in bob_pts) + max(p.z for p in bob_pts)) / 2
"""
The skull, measured off the *face* rather than off the bob.

The bob's widest point is the hair hanging beside the jaw, not the head — 2.91
against the cranium's 2.32 — and sizing spikes against it made every one of them
half again too big. The first run came out a pineapple.
"""
RX = max(abs(p.x) for p in face_pts)
BOB_RX = max(abs(p.x) for p in bob_pts)
FRONT = min(p.y for p in face_pts)   # the face looks down −Y
BROW = max(p.z for p in face_pts)
CHIN = min(p.z for p in face_pts)
print(f'head: centre ({CX:.2f},{CY:.2f},{CZ:.2f})  rx {RX:.2f}  face y {FRONT:.2f}  z {CHIN:.2f}..{BROW:.2f}')

# --------------------------------------------------------- remove the bob

bm = bmesh.new()
bm.from_mesh(mesh.data)
bm.faces.ensure_lookup_table()
bmesh.ops.delete(bm, geom=[bm.faces[i] for i in bob], context='FACES')
bm.to_mesh(mesh.data)
bm.free()

# ------------------------------------------------------------ build hair

built = []


def add(obj):
    built.append(obj)
    return obj


def cone(radius, depth, at, rot, squash):
    """One lock: a tapered wedge, flattened across the head.

    Round cones read as a crown of needles. A drawn lock of hair is a broad
    ribbon that comes to a point, which is what the squash is for.
    """
    bpy.ops.mesh.primitive_cone_add(vertices=7, radius1=radius, radius2=0, depth=depth, location=(0, 0, 0))
    o = bpy.context.object
    o.data.transform(Matrix.Translation((0, 0, depth / 2)))
    o.scale = squash
    o.rotation_euler = rot
    o.location = at
    return add(o)


"""
The cranium: a closed shell round the whole skull, opened at the face.

Solidified rather than left as a surface, because a one-sided shell shows the
inside of itself the moment the camera passes the ear.
"""

# Once the bob is gone the only head left is the drawn face, so the cap is not
# hair laid over a cranium — it *is* the cranium. Sized off the face and given
# the margin a head of hair has, rather than off the bob, whose depth is mostly
# the length hanging down the back of the neck.
HEAD_CY = (FRONT + max(p.y for p in face_pts)) / 2
HEAD_CZ = (CHIN + BROW) / 2
CAP_C = (CX, HEAD_CY + RX * 0.19, HEAD_CZ + RX * 0.21)
bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=16, radius=1, location=CAP_C)
cap = add(bpy.context.object)
cap.scale = (RX * 1.16, RX * 0.86, RX * 1.24)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

bm = bmesh.new()
bm.from_mesh(cap.data)
opening = []
for f in bm.faces:
    c = f.calc_center_median() + Vector(CAP_C)
    # Everything in front of the ears and below the brow comes out, so the face
    # is a face rather than something looking through a letterbox. Above the
    # brow stays: that is her fringe.
    if c.y < CAP_C[1] - RX * 0.1 and c.z < BROW - RX * 0.06:
        opening.append(f)
bmesh.ops.delete(bm, geom=opening, context='FACES')
bm.to_mesh(cap.data)
bm.free()

solid = cap.modifiers.new('shell', 'SOLIDIFY')
solid.thickness = RX * 0.1
solid.offset = 1.0
bpy.context.view_layer.objects.active = cap
bpy.ops.object.modifier_apply(modifier='shell')

# The crown: a fan of spikes, longest at the sides where the drawing throws two
# big wings out past the ears, and swept back rather than standing up.
CROWN = [
    (0.0, 1.0, 0.2), (0.62, 1.3, 0.22), (1.25, 1.75, 0.25),
    (1.95, 1.6, 0.24), (2.55, 1.2, 0.22), (math.pi, 1.05, 0.21),
]
for az, length, width in CROWN:
    for side in ([1] if az in (0.0, math.pi) else [1, -1]):
        a = az * side
        cone(
            RX * width, RX * length,
            (CX + math.sin(a) * RX * 0.86, CAP_C[1] - math.cos(a) * RX * 0.72, CAP_C[2] + RX * 0.72),
            (1.02, 0.0, -a),
            (1.9, 0.55, 1.0),
        )

# The locks that fall. The bob stopped at the jaw; the length past the shoulder
# is the other half of the silhouette.
FALL = [(1.15, 2.0, 0.28), (1.85, 2.35, 0.31), (2.65, 1.8, 0.29)]
for az, length, width in FALL:
    for side in [1, -1]:
        a = az * side
        cone(
            RX * width, RX * length,
            (CX + math.sin(a) * RX * 1.02, CAP_C[1] - math.cos(a) * RX * 0.8, CAP_C[2] - RX * 0.15),
            (math.pi - 0.14, 0.0, -a),
            (1.5, 0.6, 1.0),
        )

# ------------------------------------------- one object, on the head bone

for o in built:
    o.data.materials.clear()
    o.data.materials.append(mesh.data.materials[body_mat])
    uv = o.data.uv_layers.new(name='UVMap') if not o.data.uv_layers else o.data.uv_layers[0]
    lo = Vector((min(v.co.x for v in o.data.vertices), min(v.co.y for v in o.data.vertices),
                 min(v.co.z for v in o.data.vertices)))
    hi = Vector((max(v.co.x for v in o.data.vertices), max(v.co.y for v in o.data.vertices),
                 max(v.co.z for v in o.data.vertices)))
    size = Vector((max(1e-6, hi.x - lo.x), max(1e-6, hi.y - lo.y), max(1e-6, hi.z - lo.z)))
    for poly in o.data.polygons:
        for li in poly.loop_indices:
            co = o.data.vertices[o.data.loops[li].vertex_index].co
            # across the piece for u, along it for v — the drawn strands run
            # lengthwise, so this is the orientation that keeps them looking
            # like strands rather than like stripes.
            uv.data[li].uv = (
                U0 + (U1 - U0) * ((co.x - lo.x) / size.x),
                V0 + (V1 - V0) * ((co.z - lo.z) / size.z),
            )
    g = o.vertex_groups.new(name='Head')
    g.add(range(len(o.data.vertices)), 1.0, 'REPLACE')

bpy.ops.object.select_all(action='DESELECT')
for o in built:
    o.select_set(True)
mesh.select_set(True)
bpy.context.view_layer.objects.active = mesh
bpy.ops.object.join()

# Everything the hair added must be on the body material, not appended as a
# second slot — a stray slot is a second draw call and a second GLB primitive.
for p in mesh.data.polygons:
    if p.material_index >= len(mesh.data.materials):
        p.material_index = body_mat

# ------------------------------------------------------------- write it

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format='GLB',
    export_animations=True,
    export_skins=True,
    export_apply=False,
)
print(f'wrote {OUT}: {len(mesh.data.polygons)} faces')
