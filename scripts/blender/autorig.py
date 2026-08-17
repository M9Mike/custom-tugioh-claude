"""
Puts a skeleton inside a sculpted character, so it can stand, walk and run.

The sculpts (`scripts/import-sculpt.mjs`) arrive as one static mesh with no
bones and no clips. Everything else in Story Mode is rigged, and standing dead
still next to Yugi — who shifts his weight — is what makes a sculpt read as
unfinished rather than as still. This is the fix: fit one of the game's own
skeletons to the sculpt, bind the mesh to it, and bring its clips along.

## Why fitting rather than authoring

There is no need to invent a walk. `public/models/duelists/man1.glb` and
`woman1.glb` are clean 24- and 26-bone FK bipeds carrying Idle, Walk and Run
already — the game's own animation, at the game's own cadence, tuned by the
handling frames. If the *same* skeleton ends up inside a sculpt, those clips
play on it directly and there is no retargeting step to get wrong.

So the whole job is geometric: move that skeleton's bones until they are inside
this particular body.

## The A-pose problem, and why the clips have to be rewritten

The donors' rest pose is a T-pose — arms straight out along X at constant Z.
Mike models in A-pose, arms angled down. Blender's automatic weights bind
against the *rest* pose, so binding an A-pose mesh to a T-pose skeleton weights
the ribcage to the arm bones and the character comes apart at the shoulder the
first time it moves.

The fix is to move the rest pose to where the body actually is. But a clip
stores each bone's rotation *relative to its rest*, so changing the rest without
touching the clips swings the arms a second time and the character walks with
its wrists crossed in front of it.

Both are fixed by the same identity. A bone's pose in armature space is

    world(b) = world(parent) · R(b) · basis(b)

where `R(b)` is the rest offset from the parent and `basis(b)` is what the clip
drives. Holding `world(b)` fixed while the rest moves from `R_old` to `R_new`
gives

    basis_new(b) = R_new(b)⁻¹ · R_old(b) · basis_old(b)

— one constant correction per bone, premultiplied onto every key. Applied to
every bone it is exact by induction: each parent's world matrix is unchanged, so
each child's correction is independent of the order they are done in. The result
is the donor's animation, unaltered, playing on a skeleton that now sits inside
somebody else's body.

Clips are resampled per frame rather than edited curve by curve. They are twenty
to sixty frames at 30fps and the correction is a matrix multiply, so sampling is
both simpler and exact at every key the original had.

    blender -b --factory-startup -P scripts/blender/autorig.py -- \
        --in public/models/cast/pegasus.glb --donor man1 --out /tmp/pegasus.glb
"""

import bpy
import sys
import math
from mathutils import Vector, Matrix

# ---------------------------------------------------------------- args

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, fallback=None):
    return argv[argv.index('--' + name) + 1] if '--' + name in argv else fallback


SCULPT = arg('in')
DONOR = arg('donor', 'man1')
OUT = arg('out')
DONOR_PATH = arg('donorPath', 'public/models/duelists/%s.glb' % DONOR)

if not SCULPT or not OUT:
    raise SystemExit('autorig: --in <sculpt.glb> --out <out.glb> [--donor man1]')

CLIPS = ('Idle', 'Walk', 'Run')


def wipe():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def imported(path):
    """Everything that arrived from one file, so two imports can be told apart."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


# ---------------------------------------------------------------- measuring

def mesh_bounds(meshes):
    """World-space bounds, and the vertices, of the sculpt."""
    pts = []
    for m in meshes:
        mw = m.matrix_world
        pts.extend([mw @ v.co for v in m.data.vertices])
    xs = [p.x for p in pts]
    zs = [p.z for p in pts]
    return {
        'pts': pts,
        'zmin': min(zs), 'zmax': max(zs),
        'xmin': min(xs), 'xmax': max(xs),
        'height': max(zs) - min(zs),
    }


"""
Why the arm angle is a constant and not a measurement.

The first version of this found the hand by looking for the most lateral
vertices in the upper body, which is correct on a bare humanoid and wrong on
most of this cast. Christy wears a flared dress whose hem is wider than her
reach; Amazoni has feathered pauldrons; Pegasus has a coat. The measurement
returned the widest *garment* and swung the arms 95 degrees into the floor at
twice their length.

Distance from the shoulder does not rescue it either — on a dress the hem is
farther from the shoulder than the hand is.

The angle does not need discovering. Mike authors these in an A-pose, which is
a convention with a number: arms 45 degrees below horizontal. Fitting the pose
we already know beats mis-measuring one we do not, and anything that deviates
shows up immediately in the render sheet.
"""
A_POSE_DEGREES = 45.0


# ---------------------------------------------------------------- clips

def sample_actions(arm):
    """Every clip's per-bone local transform, frame by frame, before anything moves."""
    out = {}
    for name in CLIPS:
        action = bpy.data.actions.get(name)
        if not action:
            continue
        arm.animation_data_create()
        arm.animation_data.action = action
        start, end = (int(round(x)) for x in action.frame_range)
        frames = {}
        for f in range(start, end + 1):
            bpy.context.scene.frame_set(f)
            bpy.context.view_layer.update()
            frames[f] = {pb.name: pb.matrix_basis.copy() for pb in arm.pose.bones}
        out[name] = {'range': (start, end), 'frames': frames}
    arm.animation_data.action = None
    return out


def rest_offsets(arm):
    """R(b): each bone's rest transform relative to its parent's."""
    out = {}
    for b in arm.data.bones:
        out[b.name] = (b.parent.matrix_local.inverted() @ b.matrix_local) if b.parent else b.matrix_local.copy()
    return out


def rebuild_actions(arm, samples, correction):
    """Write the clips back, each key premultiplied by its bone's correction."""
    for name, clip in samples.items():
        action = bpy.data.actions.new(name + '_fitted')
        arm.animation_data_create()
        arm.animation_data.action = action
        if hasattr(action, 'slots'):           # Blender 4.4+ slotted actions
            slot = action.slots.new(id_type='OBJECT', name='Rig')
            arm.animation_data.action_slot = slot
        for f, bones in clip['frames'].items():
            bpy.context.scene.frame_set(f)
            for pb in arm.pose.bones:
                basis = bones.get(pb.name)
                if basis is None:
                    continue
                pb.matrix_basis = correction.get(pb.name, Matrix.Identity(4)) @ basis
            for pb in arm.pose.bones:
                pb.keyframe_insert('location', frame=f)
                pb.keyframe_insert('rotation_quaternion', frame=f)
                pb.keyframe_insert('scale', frame=f)
        action.name = name
        arm.animation_data.action = None
    # the originals would otherwise be exported alongside the rebuilt ones
    for a in list(bpy.data.actions):
        if a.name.endswith('_fitted') or a.users == 0:
            bpy.data.actions.remove(a)


# ---------------------------------------------------------------- proportions

"""
Where a human's joints are, as fractions of standing height.

The donors are 3DS characters and they are *chibi*: measured against their own
meshes, their shoulders sit at 62% of height and the head bone at 69%, where a
realistic figure keeps them at about 81% and 87%. Nearly a third of a donor is
head.

Dropping that skeleton into one of Mike's sculpts scaled by total height put the
head bone in the middle of her chest, the shoulders down among the ribs and the
hips a hand's width too low — so the head bone drove the sternum, the arms grew
out of the ribcage, and the legs, whose knee bone sat up in the thigh, barely
moved at all. Every one of those was visible in the first render sheet and none
of them was a weighting problem.

Lateral figures are half-widths. Vertical figures are heights above the floor.
Both from standard 7.5-head artistic anatomy, which is what these sculpts are
drawn to.
"""
ANATOMY = {
    'Hips':          (0.000, 0.530),
    'Spine':         (0.000, 0.580),
    'Spine1':        (0.000, 0.680),
    'Neck':          (0.000, 0.820),
    'Head':          (0.000, 0.865),
    'LeftShoulder':  (0.045, 0.800), 'RightShoulder': (-0.045, 0.800),
    'LeftArm':       (0.115, 0.800), 'RightArm':      (-0.115, 0.800),
    'LeftForeArm':   (0.301, 0.800), 'RightForeArm':  (-0.301, 0.800),
    'LeftHand':      (0.447, 0.800), 'RightHand':     (-0.447, 0.800),
    'LeftFinger':    (0.537, 0.800), 'RightFinger':   (-0.537, 0.800),
    'LeftUpLeg':     (0.052, 0.520), 'RightUpLeg':    (-0.052, 0.520),
    'LeftLeg':       (0.052, 0.285), 'RightLeg':      (-0.052, 0.285),
    'LeftFoot':      (0.052, 0.045), 'RightFoot':     (-0.052, 0.045),
    'LeftToeBase':   (0.052, 0.020), 'RightToeBase':  (-0.052, 0.020),
}


def reproportion(arm, height, floor):
    """
    Move every joint to where a real one is, keeping each bone's orientation.

    Head *and* tail move by the same delta on purpose. A bone's rest orientation
    is its head-to-tail direction, and the clips' rotations are expressed
    against that — so translating both preserves the frame the animation was
    authored in, and the clips retarget by rotation alone. That is the same
    trade `import-rip` makes when it borrows a walk between two rips: bone
    rotations are the motion, bone positions are the body.

    Deliberately *not* compensated for afterwards. The A-pose correction further
    down preserves world poses, which is right for a change of pose and would be
    exactly wrong here — it would put every joint back where the chibi had it.
    """
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm.data.edit_bones
    # connected bones drag their children's heads around; move them freely
    for b in eb:
        b.use_connect = False
    moved = 0
    for name, (fx, fz) in ANATOMY.items():
        b = eb.get(name)
        if b is None:
            continue
        target = Vector((fx * height, b.head.y, floor + fz * height))
        delta = target - b.head
        b.head = b.head + delta
        b.tail = b.tail + delta
        moved += 1
    bpy.ops.object.mode_set(mode='OBJECT')
    return moved


# ---------------------------------------------------------------- fitting

ARM_CHAIN = {
    'L': ['LeftArm', 'LeftForeArm', 'LeftHand', 'LeftFinger'],
    'R': ['RightArm', 'RightForeArm', 'RightHand', 'RightFinger'],
}
SHOULDER = {'L': 'LeftShoulder', 'R': 'RightShoulder'}


def fit(arm, b, donor):
    """
    Move the skeleton into this body.

    Two steps, in this order and no other. The uniform scale is what makes every
    later number comparable — a donor scaled to the sculpt's height already has
    its hips, shoulders and knees within a few centimetres of where a humanoid
    of that height keeps them, because that is what being a humanoid means. Only
    then is the arm worth measuring, because only then is the discrepancy the
    pose rather than the size.
    """
    """
    The skeleton is never scaled — the body is brought to it.

    This is the opposite of the obvious way round, and it is the only way that
    keeps the clips intact. Scaling an armature and applying the transform bakes
    the factor into every bone's rest matrix, which does two things at once:
    the correction below picks up a ninefold scale and multiplies it onto every
    bone's animation (the first attempt exploded the head and flattened the
    legs), and the clips' own translation channels stay at their old magnitude
    while the bones they drive have changed size, so the root motion is wrong
    by the same factor.

    Nothing needs the file to be at any particular scale. `premadeRig` measures
    the bounding box on load and scales to the catalog's height in metres, so
    whatever these come out at is thrown away in the browser regardless. The
    mesh goes to the donor rather than the donor to the mesh.
    """
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm.data.edit_bones
    report = {}
    for side, sign in (('L', 1.0), ('R', -1.0)):
        chain = [eb[n] for n in ARM_CHAIN[side] if n in eb]
        if not chain:
            continue
        shoulder = eb.get(SHOULDER[side])
        origin = chain[0].head.copy()

        """
        Rotated about Y, which swings the arm in the frontal plane — down and
        slightly out, the way an A-pose hangs. The sign flips per side so both
        arms go down rather than one down and one up.
        """
        rot = Matrix.Rotation(math.radians(A_POSE_DEGREES) * sign, 4, 'Y')
        report[side] = (A_POSE_DEGREES, 1.0)
        pivot = Matrix.Translation(origin) @ rot @ Matrix.Translation(-origin)
        for bone in chain:
            bone.head = pivot @ bone.head
            bone.tail = pivot @ bone.tail
        if shoulder:
            shoulder.tail = chain[0].head
    bpy.ops.object.mode_set(mode='OBJECT')
    return report


# ---------------------------------------------------------------- skinning

"""
Which bone follows which, so a bone knows where it actually ends.

Needed because these skeletons came from SMD, which stores joint positions and
no lengths — every tail in the file is synthesised pointing +Z and lands
somewhere unrelated to the limb. A bone's real extent is the line from its own
head to the head of the bone that continues the chain, and for a branch point
like `Hips` that successor cannot be guessed from the hierarchy: its children
are the spine and both thighs, and picking the nearest or the farthest gets a
thigh. Written down once, for a skeleton this file already knows the shape of.
"""
CHAIN_NEXT = {
    'Hips': 'Spine', 'Spine': 'Spine1', 'Spine1': 'Neck', 'Neck': 'Head',
    'LeftShoulder': 'LeftArm', 'LeftArm': 'LeftForeArm',
    'LeftForeArm': 'LeftHand', 'LeftHand': 'LeftFinger',
    'RightShoulder': 'RightArm', 'RightArm': 'RightForeArm',
    'RightForeArm': 'RightHand', 'RightHand': 'RightFinger',
    'LeftUpLeg': 'LeftLeg', 'LeftLeg': 'LeftFoot', 'LeftFoot': 'LeftToeBase',
    'RightUpLeg': 'RightLeg', 'RightLeg': 'RightFoot', 'RightFoot': 'RightToeBase',
}
"""
`Root` sits on the floor between the feet and deforms nothing. Left in the
skeleton because the clips animate it — that is where the rips keep their root
motion — but excluded from skinning, since a bone at ankle height with no limb
around it would otherwise capture both feet and drag them together.
"""
NO_DEFORM = {'Root'}
SMOOTHING_PASSES = 6


def bone_segments(arm):
    """Each deforming bone as the line segment it actually occupies."""
    bones = {b.name: b for b in arm.data.bones}
    segs = {}
    for name, b in bones.items():
        if name in NO_DEFORM or name.startswith('mesh'):
            continue
        head = b.head_local.copy()
        nxt = bones.get(CHAIN_NEXT.get(name, ''))
        if nxt is not None:
            tail = nxt.head_local.copy()
        else:
            # A leaf — a hand, a foot, the head. Continue the direction it
            # arrived from, for a third of the length it arrived over, so it
            # owns a plausible volume instead of a point.
            parent = b.parent
            step = (head - parent.head_local) if parent else Vector((0, 0, 0.1))
            if step.length < 1e-6:
                step = Vector((0, 0, 0.1))
            tail = head + step * 0.34
        if (tail - head).length < 1e-6:
            tail = head + Vector((0, 0, 1e-3))
        segs[name] = (head, tail)
    return segs


def distance_to_segment(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (p - (a + ab * t)).length


def skin(mesh, arm, segs, influences=4, falloff=4.0):
    """
    Weights by distance to the nearest bone segments, then smoothed.

    Inverse distance alone is blocky: a vertex halfway between two bones flips
    allegiance across a hard line, and the seam shows as a crease that pops
    every time the joint bends. The smoothing passes average each vertex's
    weights with its edge neighbours, which turns those lines into gradients and
    is most of the difference between this and a rig that looks folded out of
    paper. It is also what stops a shoulder from tearing: the arm's influence
    fades into the chest over a few centimetres instead of stopping dead.
    """
    verts = mesh.data.vertices
    names = list(segs.keys())
    raw = []
    for v in verts:
        p = mesh.matrix_world @ v.co
        d = [(distance_to_segment(p, *segs[n]), n) for n in names]
        d.sort()
        near = d[:influences]
        ws = {}
        for dist, n in near:
            ws[n] = 1.0 / max(dist, 1e-4) ** falloff
        total = sum(ws.values())
        raw.append({n: w / total for n, w in ws.items()})

    # edge adjacency, for the smoothing passes
    adj = [[] for _ in verts]
    for e in mesh.data.edges:
        a, b = e.vertices
        adj[a].append(b)
        adj[b].append(a)

    for _ in range(SMOOTHING_PASSES):
        nxt = []
        for i, w in enumerate(raw):
            acc = dict(w)
            for j in adj[i]:
                for n, x in raw[j].items():
                    acc[n] = acc.get(n, 0.0) + x
            total = sum(acc.values()) or 1.0
            acc = {n: x / total for n, x in acc.items()}
            # keep it sparse, or every vertex ends up touched by every bone
            top = sorted(acc.items(), key=lambda kv: -kv[1])[:influences]
            t = sum(x for _, x in top) or 1.0
            nxt.append({n: x / t for n, x in top})
        raw = nxt

    for n in names:
        if n not in mesh.vertex_groups:
            mesh.vertex_groups.new(name=n)
    for i, w in enumerate(raw):
        for n, x in w.items():
            if x > 1e-4:
                mesh.vertex_groups[n].add([i], x, 'REPLACE')


# ---------------------------------------------------------------- run

wipe()

donor_objs = imported(DONOR_PATH)
arm = next(o for o in donor_objs if o.type == 'ARMATURE')
donor_meshes = [o for o in donor_objs if o.type == 'MESH' and len(o.data.vertices) > 100]
donor = mesh_bounds(donor_meshes)
print('autorig: donor %s height %.3f (z %.3f..%.3f)' % (DONOR, donor['height'], donor['zmin'], donor['zmax']))
for o in donor_objs:
    if o.type != 'ARMATURE':
        bpy.data.objects.remove(o, do_unlink=True)

"""
The importer's placeholder bones go before anything is measured.

An SMD model file lists its meshes as nodes alongside its bones, so every rip
carries one zero-length `mesh0`/`mesh1` bone sitting at the origin. They deform
nothing, but bone-heat weighting solves over *every* bone in the armature, and a
degenerate one at the character's feet is exactly the kind of input that makes
it give up and fall back to no weights at all.
"""
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
for junk in [b for b in arm.data.edit_bones if b.name.startswith('mesh')]:
    arm.data.edit_bones.remove(junk)
bpy.ops.object.mode_set(mode='OBJECT')

samples = sample_actions(arm)

"""
Proportions first, pose second, and the order is the whole trick.

`reproportion` moves joints and is deliberately *outside* the correction, so
the clips replay on the new skeleton by rotation alone and the character keeps
its own build. The A-pose swing below is *inside* it, because that is a change
of rest orientation and the clips have to be rewritten to survive it.

Recording `old_rest` between the two is what separates them.
"""
moved = reproportion(arm, donor['height'], donor['zmin'])
print('autorig: reproportioned %d joints to human anatomy' % moved)

old_rest = rest_offsets(arm)

sculpt_objs = imported(SCULPT)
meshes = [o for o in sculpt_objs if o.type == 'MESH']
for o in sculpt_objs:
    if o.type != 'MESH':
        bpy.data.objects.remove(o, do_unlink=True)
for m in meshes:
    bpy.ops.object.select_all(action='DESELECT')
    m.select_set(True)
    bpy.context.view_layer.objects.active = m
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

b = mesh_bounds(meshes)
scale = donor['height'] / b['height']
print('autorig: sculpt height %.3f -> donor units x%.3f' % (b['height'], scale))
for m in meshes:
    m.scale = (scale, scale, scale)
    m.location = (
        -( (b['xmin'] + b['xmax']) / 2 ) * scale,
        m.location.y * scale,
        donor['zmin'] - b['zmin'] * scale,
    )
    bpy.ops.object.select_all(action='DESELECT')
    m.select_set(True)
    bpy.context.view_layer.objects.active = m
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=True)
b = mesh_bounds(meshes)
print('autorig: sculpt now %.3f tall (z %.3f..%.3f), donor %.3f'
      % (b['height'], b['zmin'], b['zmax'], donor['height']))

swing = fit(arm, b, donor)
for side, (deg, stretch) in swing.items():
    print('autorig: %s arm swung %.1f deg, length x%.2f' % (side, deg, stretch))

new_rest = rest_offsets(arm)
correction = {n: new_rest[n].inverted() @ old_rest[n] for n in old_rest if n in new_rest}
rebuild_actions(arm, samples, correction)

# ---- bind ----
segs = bone_segments(arm)
print('autorig: skinning to %d bones' % len(segs))
for m in meshes:
    m.parent = arm
    m.matrix_parent_inverse = arm.matrix_world.inverted()
    mod = m.modifiers.new(name='Armature', type='ARMATURE')
    mod.object = arm
    skin(m, arm, segs)

"""
Bone heat is allowed to fail; a silently unbound character is not.

`parent_set` reports a failed solve as a warning and still parents the mesh,
which exports as a static mesh with a skeleton beside it — a model that looks
correct in every still and never moves. This turns that into an error, because
the whole point of the run is the skin.
"""
for m in meshes:
    groups = len(m.vertex_groups)
    mods = [mod.type for mod in m.modifiers]
    weighted = sum(1 for v in m.data.vertices if v.groups)
    print('autorig: %s -> %d vertex groups, modifiers %s, %d/%d vertices weighted'
          % (m.name, groups, mods, weighted, len(m.data.vertices)))
    if 'ARMATURE' not in mods or groups == 0:
        raise SystemExit('autorig: FAILED to bind %s — no armature modifier or no weights' % m.name)
    if weighted < len(m.data.vertices) * 0.98:
        raise SystemExit('autorig: FAILED — only %d of %d vertices got any weight'
                         % (weighted, len(m.data.vertices)))

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
print('autorig: wrote %s' % OUT)
