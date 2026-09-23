"""
Moves one character's locomotion onto a character that arrived without any.

This is the fourth door into `public/models`, and it exists because of a gap
between the other three. `import-rigged.mjs` takes a bundle that was rigged
*and animated* at source and only has to make it small. `import-sculpt.mjs`
takes a static mesh and fits a skeleton, which is the approach that wrecked
twenty-two characters and is kept for nothing that walks. And then there is the
case neither covers: a model auto-rigged by UniRig or Meshy — its own skeleton,
fitted to its own body, weights that work — exported with **no clips**. Isha
arrived that way and could stay that way, because she is an NPC who stands on
old ground and does not walk. Sky arrived that way and is a duelist you *are*,
watched from 4.6 m behind for the whole of Story Mode.

`premadeRig`'s `staticMotion` is what a model with no clips falls back to, and
its own comment is honest about it: "it does not survive close inspection,
because the legs do not move". Behind the camera in the open world is nothing
*but* close inspection.

## What it does

Transfers the armature-space rotation of every mapped bone, per frame, from a
donor character's clips onto this one's own skeleton. Nothing about the target
mesh, its weights or its skeleton is touched — the part that was got right is
the part that is left alone. What arrives is three new clips.

## Why this is not the thing that failed before

The auto-rig that mangled the cast was placing *joints* from a table of average
anatomy and then assigning weights by distance, on bodies that are each posed
individually. The skeleton was wrong, so the skin was wrong, and it showed in
the rest pose.

This never touches a joint position or a weight. The target's skeleton is
already fitted to the target's body; all that crosses over is rotation, and a
rotation has no opinion about where anybody's elbow is. The rest pose out is
byte-for-byte the rest pose in — which is also the cheapest way to check the
claim, and `pose-sheet.py`'s first frame is exactly that check.

## The mapping is derived, not written down

The donor rigs name their bones (`Hips`, `LeftUpLeg`, `Spine02`). UniRig names
them `Bone_000` through `Bone_067` in no order that means anything. So the
mapping cannot be a table of names on both sides, and a table of names on one
side plus a hand-written list on the other is the kind of list this project has
twice watched fall silently out of date.

Instead both skeletons are read as a shape:

- the **pelvis** is the first bone down from the root with three children;
- of those three, the two whose subtrees reach lowest are the **legs** and the
  third is the **spine**;
- the **chest** is where the spine next branches three ways;
- of *those* three, the one whose subtree reaches highest is the **neck** and
  the other two are the **clavicles**.

Sides are matched by the sign of X, which is only safe while both characters
face the same way — so which way each of them faces is *measured*, from the
sign of toe-minus-ankle along Y, and a pair that disagree is refused rather
than mirrored. (Not assumed, and not read off the exporter: Blender's importer
turns glTF's +Z into −Y, so the axis these characters face along is not the one
the file says.) That check is the whole defence against a mirrored transfer,
and a mirrored transfer is not subtle: it swings the arm and the leg on the
*same* side together, which reads as a wind-up toy.

## Chains of unequal length

The donor has 24 bones and UniRig gives 68, so the chains do not line up, and
the two ways they fail to line up want opposite treatment.

A limb's far end is **free**: the donor's leg is upper/knee/ankle/toe and
UniRig's is that plus a toe tip, the donor's arm ends at the hand and UniRig's
carries a palm and five fingers. Nothing downstream of the last mapped bone is
attached to anything, so the chains are aligned from the root and the surplus
is simply left in its rest pose. A finger that does not move is a finger nobody
sees at four metres; a knee mapped three-quarters of the way to an ankle is a
leg that bends in the wrong place.

The spine's far end is **anchored**: the chest carries the neck and both arms,
so both ends of that chain have to land. The donor has three spine bones and
UniRig has four, and there the right answer is to spread the donor's bend
across the target's bones — each target bone takes the donor's armature-space
rotation sampled at its own fraction of the way up the chain, slerped between
the two donor bones either side of it.

So: **limbs align from the root, the spine interpolates.** One rule each, and
which one a chain gets is a property of whether anything hangs off its end.

## Units

Rotations are scale-invariant and need no conversion. The hips' translation is
not: these bundles disagree about what a unit is — the donor's armature object
carries scale 0.01 because it was authored in centimetres, UniRig's carries 1.0
— and a sway handed straight across arrives a hundred times out. It goes out
through metres and back, scaled by the ratio of the two characters' heights on
the way. An armature's object scale is *metres per bone unit*, so the donor's
multiplies and the target's divides; inverted, the two errors compound to ten
thousand and the first frame of the walk is off camera. (`make-idle.py` learned
the same arithmetic the same expensive way — its `BONE_UNITS` note is this
paragraph from the other side.)

    blender -b --factory-startup -P scripts/blender/retarget.py -- \
        --from public/models/players/sandra-afrika.glb \
        --to ~/Downloads/Sky.glb --out /tmp/sky-animated.glb
"""

import bpy
import os
import sys
from mathutils import Matrix, Quaternion, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rigshape import down, floor_of, height_of, load, read_rig, soles   # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, fallback=None):
    return argv[argv.index('--' + name) + 1] if '--' + name in argv else fallback


SRC = arg('from')
DST = arg('to')
OUT = arg('out')
CLIPS = [c for c in arg('clips', 'Idle,Walk,Run').split(',') if c]
GROUND = '--no-ground' not in argv
ALIGN_ARMS = '--align-arms' in argv
"""
`--hold arm-` (or `arm+`, or both, comma-separated): a limb left as it was
modelled, carried by the body instead of driven.

For a character whose pose *is* the character. Yami Marik is modelled holding
the Millennium Rod across his chest, and the auto-rig let his hair and the
collar of his cape weigh on that hand; straightened into a walk, the arm drags
both down to his hip. Held, it rides the chest the way it was sculpted — the
Rod across him, the other arm swinging — which is how he would walk anyway.
"""
HOLD = [r for r in arg('hold', '').split(',') if r]

if not SRC or not DST or not OUT:
    raise SystemExit('retarget: --from <donor.glb> --to <target.glb> --out <out.glb>')


# ------------------------------------------------------------------ #
# The donor: read the clips out as armature-space deltas              #
# ------------------------------------------------------------------ #

def bind(arm, action):
    arm.animation_data_create()
    arm.animation_data.action = action
    if hasattr(action, 'slots') and action.slots and arm.animation_data.action_slot is None:
        arm.animation_data.action_slot = action.slots[0]


src = load(SRC)
src_rig, src_facing = read_rig(src, SRC.split('/')[-1])
src_height = height_of(src)
src_metres = src.matrix_world.to_scale().z         # metres per bone unit
src_rest = {b.name: b.matrix_local.copy() for b in src.data.bones}
src_soles = soles(src)

takes = {}
for name in CLIPS:
    action = bpy.data.actions.get(name)
    if action is None:
        print('retarget: ! %s has no "%s" clip' % (SRC.split('/')[-1], name))
        continue
    bind(src, action)
    first, last = (int(round(v)) for v in action.frame_range)

    frames, ground = [], []
    for f in range(first, last + 1):
        bpy.context.scene.frame_set(f)
        bpy.context.view_layer.update()
        pose = {}
        for role, chain in src_rig.items():
            for bone in chain:
                pb = src.pose.bones[bone]
                pose[bone] = pb.matrix.copy()
        frames.append(pose)
        ground.append(floor_of(*src_soles) if GROUND else 0.0)
    takes[name] = dict(first=first, last=last, frames=frames, ground=ground)
    print('retarget: read %s (%d frames, foot stray %.0f mm)'
          % (name, len(frames), (max(ground) - min(ground)) * 1000))

if not takes:
    raise SystemExit('retarget: donor carries none of %s' % ','.join(CLIPS))

FPS = bpy.context.scene.render.fps


def quat_at(pose, chain, t):
    """
    The donor chain's armature-space *delta* rotation a fraction `t` along it.

    `t` runs 0 at the chain's root to 1 at its tip. At a donor bone's own
    position this is exactly that bone's delta; between two it is the slerp,
    which is what lets three donor spine bones drive four of UniRig's.
    """
    n = len(chain) - 1
    if n <= 0:
        bone = chain[0]
        return (pose[bone].to_quaternion()
                @ src_rest[bone].to_quaternion().inverted())
    x = max(0.0, min(1.0, t)) * n
    i = min(int(x), n - 1)
    a, b = chain[i], chain[i + 1]
    qa = pose[a].to_quaternion() @ src_rest[a].to_quaternion().inverted()
    qb = pose[b].to_quaternion() @ src_rest[b].to_quaternion().inverted()
    return qa.slerp(qb, x - i)


# ------------------------------------------------------------------ #
# The target: write them back onto its own skeleton                   #
# ------------------------------------------------------------------ #

dst = load(DST)
dst_rig, dst_facing = read_rig(dst, DST.split('/')[-1])

if src_facing != dst_facing:
    raise SystemExit(
        'retarget: these two face opposite ways (%+.0fY against %+.0fY), so +X is '
        'one character\'s left and the other\'s right. Transferring across that '
        'mirrors the gait — same-side arm and leg swinging together — so turn one '
        'of them round before retargeting rather than letting this through.'
        % (src_facing, dst_facing))
dst_height = height_of(dst)
dst_metres = dst.matrix_world.to_scale().z
dst_rest = {b.name: b.matrix_local.copy() for b in dst.data.bones}

"""
Donor hip sway in donor bone units, to the same sway in target bone units.

Out of the donor's units into metres, scaled by the difference in the two
characters' heights, and into the target's units. An armature object's scale is
**metres per bone unit** — the donor's is 0.01 because it was authored in
centimetres — so the donor's factor multiplies and the target's divides. Written
the other way round it is 0.01 against 100, which is not a near-miss: the first
run of this put her ten thousand times out and a walk cycle threw her a
kilometre off camera. Hold the two factors as what they are and the direction
is readable instead of memorised.

When both characters are 1.70 m and one of them counts in centimetres this comes
to exactly 0.01, and writing *that* down as a constant would have been writing
down a coincidence.
"""
SWAY = (dst_height / src_height) * (src_metres / dst_metres)
print('retarget: %s %.3f m @ %.3g m/u  ->  %s %.3f m @ %.3g m/u   sway x%.4g'
      % (SRC.split('/')[-1], src_height, src_metres,
         DST.split('/')[-1], dst_height, dst_metres, SWAY))

"""
Parents before children, always.

A bone's armature-space matrix is written whole, and its translation has to be
read back *after* its parent has moved — otherwise every bone is pinned to where
its rest pose put it and the skeleton comes apart. Depth-first from the root is
that order, and `view_layer.update()` between writes is what makes the read see
the write.
"""
order = []


def walk(bone):
    order.append(bone.name)
    for c in bone.children:
        walk(c)


for b in dst.data.bones:
    if b.parent is None:
        walk(b)

written = {}
for role, chain in dst_rig.items():
    if role == 'pelvis' or role in HOLD:
        continue
    src_chain = src_rig[role]
    for i, bone in enumerate(chain):
        if role == 'spine':
            # Both ends anchored: spread the donor's bend across however many
            # bones this rig divides its back into.
            t = i / max(1, len(chain) - 1)
        else:
            # Free end: line the chains up from the root and let the surplus —
            # a toe tip, a palm, five fingers — stay in its rest pose.
            if i >= len(src_chain):
                continue
            t = i / max(1, len(src_chain) - 1)
        written[bone] = (src_chain, t)

pelvis_src = src_rig['pelvis'][0]
pelvis_dst = dst_rig['pelvis'][0]

"""
`--align-arms`: the donor's arms, not just the donor's arm *movement*.

What crosses over is each bone's change from its own rest pose, laid onto the
target's rest pose — which is right whenever the two stand alike and quietly
wrong when they do not. The Amazons were modelled with their arms most of the
way down, like Tony and Sarah, so nobody could tell. Jaden Yuki and the rest of
the main-menu cast were modelled in a wide A-pose, arms forty-odd degrees out,
and without this they walk the whole city holding them there: a donor idle whose
hands hang at the thighs arrives as a man about to be measured for a suit.

So each arm bone is first turned from the way it points at rest to the way the
donor's points at rest, and the donor's change is laid on top of that. "The
way it points" is joint to joint — this bone's head to the next one's — never
the bone's own tail, which on these exports is synthesised and points wherever
the exporter felt like. The hand has no next joint in the chain and follows the
forearm, so a wrist cannot come out of it bent. Only the arms: a leg or a spine
stands close enough to the donor's already, and a correction nobody needed is a
correction that can only make something worse.
"""
align = {}
if ALIGN_ARMS:
    # Heads out of the rest matrices kept above: the donor's object is gone by
    # now — loading the target cleared it — and a rest matrix's translation is
    # the bone's head in armature space anyway.
    def joint_dirs(rest, chain):
        heads = [rest[b].to_translation() for b in chain]
        return [(heads[i + 1] - heads[i]).normalized() for i in range(len(heads) - 1)]

    for role in ('arm-', 'arm+'):
        s_dirs, d_dirs = joint_dirs(src_rest, src_rig[role]), joint_dirs(dst_rest, dst_rig[role])
        turn = Quaternion()
        for i, bone in enumerate(dst_rig[role]):
            if i < len(s_dirs) and i < len(d_dirs):
                turn = d_dirs[i].rotation_difference(s_dirs[i])
            align[bone] = turn
        print('retarget: %s aligned to the donor at rest (upper arm turned %.0f deg)'
              % (role, align[dst_rig[role][1]].angle * 57.2958 if len(dst_rig[role]) > 1 else 0))

print('retarget: %d of %d bones driven' % (len(written) + 1, len(dst.data.bones)))

dst_soles = soles(dst)

"""
Up, in this armature's own units.

The correction below is a distance in metres along world up, and it is written
into a bone matrix, which is in armature space. Going through the armature's
inverse rather than assuming its Z is the world's costs one line and covers the
day a bundle arrives rotated — and it carries the 1/scale with it, so the
centimetre-vs-metre conversion happens here too rather than being remembered
separately.
"""
UP = dst.matrix_world.inverted().to_3x3() @ Vector((0.0, 0.0, 1.0))

for name, take in takes.items():
    action = bpy.data.actions.new(name)
    bind(dst, action)
    pelvis_pose, standing = [], []

    for index, pose in enumerate(take['frames']):
        f = take['first'] + index
        bpy.context.scene.frame_set(f)
        for bone in order:
            pb = dst.pose.bones.get(bone)
            if pb is None:
                continue
            if bone == pelvis_dst:
                q = (pose[pelvis_src].to_quaternion()
                     @ src_rest[pelvis_src].to_quaternion().inverted())
                shift = (pose[pelvis_src].to_translation()
                         - src_rest[pelvis_src].to_translation()) * SWAY
                here = dst_rest[bone].to_translation() + shift
            elif bone in written:
                src_chain, t = written[bone]
                q = quat_at(pose, src_chain, t)
                here = pb.matrix.to_translation()
            else:
                # Not driven: hold the rest pose relative to whatever the parent
                # is doing, which is what an unwritten bone should look like.
                pb.matrix_basis = Matrix.Identity(4)
                bpy.context.view_layer.update()
                continue
            rot = (q @ align.get(bone, Quaternion()) @ dst_rest[bone].to_quaternion()).to_matrix().to_4x4()
            pb.matrix = Matrix.Translation(here) @ rot
            bpy.context.view_layer.update()
            if bone == pelvis_dst:
                # Kept for the grounding pass, which re-writes this one bone
                # once the whole clip's foot heights are known.
                pelvis_pose.append((here.copy(), rot.copy()))

        for bone in order:
            pb = dst.pose.bones.get(bone)
            if pb is None:
                continue
            pb.keyframe_insert('location', frame=f)
            pb.keyframe_insert('rotation_quaternion', frame=f)
        if GROUND:
            standing.append(floor_of(*dst_soles))

    """
    Put the feet back on the floor.

    A rotation transferred onto a longer shin swings the foot further, and the
    donor's own stance is baked into the pose it swings *from* — the outgoing
    Sandra stands with her ankles crossed, so the delta out of her rest pose
    carries "uncross" in it, and applied to a character who already stands
    square that lands the trailing foot in the air. It did: hers hung five
    centimetres off the pavement for a third of every stride, which the
    contact sheet shows and no number in the catalog would ever have.

    The whole body is one rigid piece below the pelvis, so the fix is one
    number a frame. The donor's clip is the thing that was tuned and shipped,
    so the target is made to *follow its profile* rather than to sit at some
    absolute height: both height-over-the-clip's-lowest curves are taken, the
    donor's is scaled by the difference in the two characters' heights, and the
    pelvis is moved by the gap. Where the donor plants a foot the target plants
    one; where the donor is airborne mid-run the target is airborne by the same
    proportion of itself.

    Zero-referencing each curve to its own minimum is what keeps this a
    *grounding* pass and not a *lifting* one. The absolute standing height is
    `premadeRig`'s business — it measures the resting floor off the Idle clip
    and stands the model on it — and a pass that also moved that would be two
    mechanisms fighting over one number.
    """
    if GROUND and standing:
        base_src, base_dst = min(take['ground']), min(standing)
        ratio = dst_height / src_height
        """
        How far the foot is in the air while it is supposed to be planted.

        Not the range of the foot's height over the clip, which is the obvious
        number and the wrong one: a run *should* leave the ground, so a wide
        range is right there and a narrow one would mean she is skating. What is
        never right is daylight under a foot the clip is standing on.

        So the donor says which frames those are — the ones where its own sole is
        within 20 mm of the lowest it gets all clip — and the float is measured
        only across those.
        """
        plant = [i for i, g in enumerate(take['ground']) if g - base_src <= 0.020]
        before = max(standing[i] - base_dst for i in plant)
        after = max((take['ground'][i] - base_src) * ratio for i in plant)

        """
        Applied only where it helps, and the log says which.

        Following the donor's profile fixes a target whose foot floats where the
        donor's is planted, and it is exactly as capable of the reverse: Sky's
        own run plants her sole within 2 mm, and dragging that onto the donor's
        profile lifted it to 14 mm and threw her pelvis around by 141. A pass
        that can make a clip worse and does it silently is worse than no pass.

        The comparison needs no trial run — after the correction the target
        follows the donor by construction, so both numbers are known before a
        single keyframe is rewritten. Per clip rather than per frame, because
        the correction is a curve and clamping it frame by frame would put a
        kink in the hips wherever the clamp bit.
        """
        if after >= before:
            print('retarget: %s already stands better than the donor '
                  '(%.0f mm against %.0f) — left alone' % (name, before * 1000, after * 1000))
        else:
            worst = 0.0
            for index, (here, rot) in enumerate(pelvis_pose):
                f = take['first'] + index
                want = (take['ground'][index] - base_src) * ratio
                lift = want - (standing[index] - base_dst)
                worst = max(worst, abs(lift))
                bpy.context.scene.frame_set(f)
                pb = dst.pose.bones[pelvis_dst]
                pb.matrix = Matrix.Translation(here + UP * lift) @ rot
                bpy.context.view_layer.update()
                pb.keyframe_insert('location', frame=f)
            print('retarget: grounded %s (pelvis moved up to %.0f mm; planted foot '
                  'off the floor %.0f -> %.0f mm over %d of %d frames)'
                  % (name, worst * 1000, before * 1000, after * 1000,
                     len(plant), len(standing)))

    print('retarget: wrote %s (%d frames, %.2fs)'
          % (name, len(take['frames']), (take['last'] - take['first']) / FPS))

dst.animation_data.action = None
for pb in dst.pose.bones:
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
print('retarget: wrote %s' % OUT)
