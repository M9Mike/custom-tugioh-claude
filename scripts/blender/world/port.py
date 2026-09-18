"""
An area ported from its old three.js builder.

`scripts/world/capture.ts` ran the builder in Node and wrote every mesh it
made as triangles in game metres with the material it wore. This puts those
triangles back, one bake per material, with the materials the dressing names
for each of the old surface drawers — `brick` becomes a photographed brick
with its normal map, `gravel` becomes gravel — and everything the old
material said for itself (its colour, its glow, its glass) kept.

The geometry is the geometry that passed the gates: a box captured is a box
put back, with the part the checks read written from its own corners.

What the dressing can say, beyond `surfaces`:

  "drawers":  { "<drawer name>": "<surface key>" } — which surface an old
              canvas texture becomes; a drawer not named keeps its colour and
              gets no texture.
  "drop":     [ "#rrggbb" | { "colour": "#rrggbb", "above": y }, ... ] —
              meshes of these plain colours are left out (box-drawn foliage
              that a billboard tree replaces, say); with `above`, only the
              triangles whose middle is higher than y go, so a hedge in the
              same green as a canopy stays.
  "trees":    { "trunk": "#rrggbb", "model": "...", "height": h, "lift": 0 }
              — a billboard tree stood on every mesh of the trunk's colour,
              at its foot, as tall as the trunk was plus `height`.
  "stand":    [ { "colour": "#rrggbb", "models": [...], "every": 4, "sink": 3,
                "extra": 4.8 } ] — box-drawn canopy masses of this colour go,
              and a billboard tree stands where every `every`th of them was:
              its foot `sink` metres under the mass, its top `extra` metres
              over it. For the woods beyond a wall that were drawn as
              floating blocks of leaf.
  "props":    [ { "model": "...", "x", "y", "z", "rotY", "scale" } ] — models
              added on top of what was captured.
"""

import json
import math
import re

from street import tree


def slug(s):
    return re.sub('-+$', '', re.sub('^-+', '', re.sub('[^a-z0-9]+', '-', s.lower())))


def _key_for(m):
    """One material key per distinct look: a drawer with a colour, or a plain colour."""
    mat = m['mat']
    bits = []
    if mat['map']:
        bits.append(mat['map'])
        if mat.get('arg'):
            bits.append(mat['arg'])
    bits.append(mat['color'])
    if mat['glow']:
        bits.append('glow')
    if mat['transparent'] and mat['opacity'] < 1:
        bits.append(f"a{mat['opacity']:.2f}")
    if mat.get('polygonOffset'):
        bits.append('decal')
    if mat.get('sign'):
        s = mat['sign']
        bits.append(f"sign:{s['text']}|{s.get('sub') or ''}")
    return ':'.join(bits)


def _material(k, key, m, dressing, mats, art):
    mat = m['mat']
    drawers = dressing.get('drawers', {})
    surface = drawers.get(mat['map']) if mat['map'] else None
    if mat.get('sign'):
        s = mat['sign']
        name = slug(s['text'] + ('-' + s['sub'] if s.get('sub') else ''))
        path = art.get('signs', {}).get(name)
        if path:
            return k.picture(f'sign-{name}', path, rough=0.6)
        surface = None
    if surface and surface in mats:
        # the old drawer was handed a tint and painted it into the canvas; the
        # photograph takes it as an overlay, so the brick that was redder stays redder
        tint = mat.get('arg') if (mat.get('arg') or '').startswith('#') else None
        if mat['color'].lower() != '#ffffff':
            tint = mat['color']
        if tint:
            spec = dict(dressing['surfaces'][surface])
            return k.pbr(f'{surface}:{tint}', spec['tex'], tint=tint, rough=spec.get('rough', 1.0), normal=spec.get('normal', 1.0), size=spec.get('size'), ao=spec.get('ao', True), blend=spec.get('tint_blend', 'OVERLAY'))
        return mats[surface]
    colour = mat['color']
    if mat.get('polygonOffset'):
        # a decal: a marking laid on a surface, drawn in front of it whatever the
        # depth says. The loader gives a material named `decal:` its offset, and
        # `coplanar` leaves it out of the running, as it did in three.js.
        return k.plain(f'decal:{colour}:{min(1.0, max(0.05, mat["roughness"])):.2f}', colour, rough=min(1.0, max(0.05, mat['roughness'])))
    if mat['glow']:
        return k.plain(f'glow:{colour}', colour, rough=0.5, emissive=colour, emissive_strength=dressing.get('glow_strength', 2.2))
    alpha = mat['opacity'] if mat['transparent'] and mat['opacity'] < 1 else None
    rough = min(1.0, max(0.05, mat['roughness']))
    metal = min(0.2, mat['metalness'])
    return k.plain(f'plain:{colour}:{rough:.2f}:{metal:.2f}:{alpha}', colour, rough=rough, metal=metal, alpha=alpha)


def _aabb(pos):
    xs = pos[0::3]
    ys = pos[1::3]
    zs = pos[2::3]
    return [min(xs), min(ys), min(zs), max(xs), max(ys), max(zs)]


def _is_turned(box):
    """Whether a captured box's world matrix turns it off the axes."""
    if not box:
        return 0
    mtx = box['matrix']  # column-major 4x4
    # a pure translation/scale has zero off-diagonals in the upper 3x3
    off = abs(mtx[1]) + abs(mtx[2]) + abs(mtx[4]) + abs(mtx[6]) + abs(mtx[8]) + abs(mtx[9])
    return 1 if off > 1e-4 else 0


def build_port(k, layout, dressing, art, mats, capture):
    drop = {}
    for d in dressing.get('drop', []):
        if isinstance(d, str):
            drop[d.lower()] = None
        else:
            drop[d['colour'].lower()] = d.get('above')
    trees = dressing.get('trees')
    trunk = trees['trunk'].lower() if trees else None
    stands = {st['colour'].lower(): st for st in dressing.get('stand', [])}
    made = {}
    kept = 0
    stood = 0
    for m in capture['meshes']:
        colour = m['mat']['color'].lower()
        if m['mat']['map'] is None and colour in stands:
            st = stands[colour]
            boxes = m['parts'] if m.get('parts') else [_aabb(m['pos'])]
            models = st.get('models') or ['fir_a']
            every = max(1, int(st.get('every', 1)))
            for n, a in enumerate(boxes):
                if n % every:
                    continue
                foot = a[1] - st.get('sink', 3.0)
                top = a[4] + st.get('extra', 4.8)
                tree(k, art, (a[0] + a[3]) / 2, foot, (a[2] + a[5]) / 2, top - foot, f'port-wood-{stood}', rot_y=stood * 0.7, model=models[stood % len(models)])
                stood += 1
            continue
        if m['mat']['map'] is None and colour in drop:
            above = drop[colour]
            if above is None:
                continue
            # only what stands higher than `above` goes: the canopies, not the hedges
            pos, idx = m['pos'], m['idx']
            kept_idx = []
            for i in range(0, len(idx), 3):
                mid = (pos[idx[i] * 3 + 1] + pos[idx[i + 1] * 3 + 1] + pos[idx[i + 2] * 3 + 1]) / 3
                if mid <= above:
                    kept_idx.extend(idx[i:i + 3])
            if not kept_idx:
                continue
            m = dict(m, idx=kept_idx, parts=[pp for pp in (m.get('parts') or []) if pp[1] <= above] or None)
        if trunk and m['mat']['map'] is None and colour == trunk:
            # every upright of the trunk's colour gets a tree stood on it — a merge
            # of trunks says what it was made of, so each part is one; a branch
            # (wider than it is tall) is left out with the canopy it held up
            boxes = m['parts'] if m.get('parts') else [_aabb(m['pos'])]
            models = trees.get('models') or [trees.get('model', 'island_tree_02')]
            for a in boxes:
                up = a[4] - a[1]
                if up < 1.4 * max(a[3] - a[0], a[5] - a[2]):
                    continue
                h = up + trees.get('height', 2.0)
                tree(k, art, (a[0] + a[3]) / 2, a[1] + trees.get('lift', 0.0), (a[2] + a[5]) / 2, h, f'port-tree-{stood}', rot_y=stood * 0.7, model=models[stood % len(models)])
                stood += 1
            continue
        key = _key_for(m)
        if key not in made:
            made[key] = _material(k, key, m, dressing, mats, art)
        mat = made[key]
        picture = m['mat'].get('sign') is not None
        uv = m['uv'] if picture else None
        # a surface that is one thing lying down and another standing up — turf
        # on the ground, a clipped hedge on a wall — is split by the way its
        # faces look
        surface = dressing.get('drawers', {}).get(m['mat']['map']) if m['mat']['map'] else None
        upright = dressing['surfaces'].get(surface, {}).get('vertical') if surface else None
        if upright and upright in mats and not picture:
            pos, idx = m['pos'], m['idx']
            flat, walls = [], []
            for i in range(0, len(idx), 3):
                a, b, c = idx[i] * 3, idx[i + 1] * 3, idx[i + 2] * 3
                ux, uy, uz = pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]
                vx, vy, vz = pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]
                ny = uz * vx - ux * vz
                nx = uy * vz - uz * vy
                nz = ux * vy - uy * vx
                length = (nx * nx + ny * ny + nz * nz) ** 0.5 or 1.0
                (flat if abs(ny) / length > 0.5 else walls).extend(idx[i:i + 3])
            boxes = m.get('parts') or [_aabb(pos) + [0]]
            if walls:
                # the upright bake carries the boxes, stopped a centimetre under
                # their tops; the flat bake carries the tops as faces. Written to
                # both whole, the two bakes read as one box drawn twice.
                k.mesh(mats[upright], pos, walls, uv=None, part=None)
                bm_parts = k._bake_for(mats[upright])[1]
                for pp in boxes:
                    bm_parts.append([round(pp[0], 4), round(pp[1], 4), round(pp[2], 4), round(pp[3], 4), round(pp[4] - 0.01, 4), round(pp[5], 4), int(pp[6]) if len(pp) > 6 else 0])
            if not flat:
                kept += 1
                continue
            m = dict(m, idx=flat, parts=[[pp[0], pp[4], pp[2], pp[3], pp[4], pp[5]] + [int(pp[6]) if len(pp) > 6 else 0] for pp in boxes])
        if m.get('parts'):
            # a merge says what it was made of; put the parts through as they were
            bm_parts = k._bake_for(mat)[1]
            k.mesh(mat, m['pos'], m['idx'], uv=uv, part=None)
            for p in m['parts']:
                bm_parts.append([round(p[0], 4), round(p[1], 4), round(p[2], 4), round(p[3], 4), round(p[4], 4), round(p[5], 4), int(p[6]) if len(p) > 6 else 0])
        else:
            k.mesh(mat, m['pos'], m['idx'], uv=uv, part=_aabb(m['pos']), turned=_is_turned(m.get('box')))
        kept += 1
    for p in dressing.get('props', []):
        k.import_model(p['model'], p['x'], p.get('y', 0.0), p['z'], rot_y=p.get('rotY', 0.0), scale=p.get('scale', 1.0), base=p.get('base', 'floor'))
    print(f'port: {kept} meshes kept, {stood} trees stood, {len(made)} materials')
    b = layout['bounds']
    return {'cx': b['x'], 'cz': b['z']}
