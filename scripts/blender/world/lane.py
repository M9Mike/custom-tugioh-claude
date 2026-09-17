"""
A stepped lane between houses — a residential hill.

Everything is measured off the climb. The platforms in the layout are the
treads and landings `flightPlatforms` made from the runs, and `ground_at`
reads them the way `groundAt` does; the houses, the retaining walls, the
poles and the handrail all stand at whatever height that gives back. Nothing
here knows a height of its own.
"""

import math
import random

from street import tree


def ground_at(layout, x, z):
    """The highest platform under a point, or the ground."""
    y = 0.0
    for p in layout['platforms']:
        if abs(x - p['x']) <= p['hw'] and abs(z - p['z']) <= p['hd']:
            y = max(y, p['y'])
    return y


def _sides(layout):
    b = layout['bounds']
    rows = [s for s in layout['solids'] if s.get('tall') and s['hw'] > s['hd']]
    lane_half = min(abs(s['z']) - s['hd'] for s in rows)
    ends = [s for s in layout['solids'] if s.get('tall') and s['hd'] >= s['hw']]
    west = max(s['x'] + s['hw'] for s in ends) if ends else b['x'] - b['hw']
    return lane_half, west


def _win(k, mats, x, y, z, out, pane, w, h):
    """A window in a house: reveal, pane, sill and head, and a frame with a
    bar each way across it — a pane on its own is a yellow rectangle."""
    front = 'front' if out > 0 else 'back'
    k.box(mats['reveal'], x, y, z + out * 0.02, w, h, 0.12)
    k.box(pane, x, y, z + out * 0.09, w - 0.16, h - 0.18, 0.02, faces={front})
    k.box(mats['sill'], x, y - h / 2 - 0.05, z + out * 0.1, w + 0.2, 0.1, 0.22)
    k.box(mats['sill'], x, y + h / 2 + 0.06, z + out * 0.06, w + 0.12, 0.12, 0.14)
    for mx in (-w / 2 + 0.08, w / 2 - 0.08):
        k.box(mats['frame'], x + mx, y, z + out * 0.07, 0.06, h - 0.16, 0.05)
    k.box(mats['frame'], x, y, z + out * 0.07, w - 0.16, 0.05, 0.05)
    k.box(mats['frame'], x, y, z + out * 0.07, 0.05, h - 0.16, 0.05)


def wall_model(k, model, x, y_bottom, zf, out, scale=1.0, rot=0.0):
    """A model hung on a wall face at `zf` looking `out`, its back to the wall."""
    across, up, deep = k.sized(model)
    k.import_model(model, x, y_bottom, zf + out * (deep * scale / 2 + 0.01), rot_y=rot + (0.0 if out > 0 else math.pi), scale=scale)
    return across * scale, up * scale, deep * scale


def fit(k, model, w=None, h=None, d=None):
    """The scale that fits a model into the sizes given, whichever binds."""
    across, up, deep = k.sized(model)
    s = 1e9
    if w: s = min(s, w / across)
    if h: s = min(s, h / up)
    if d: s = min(s, d / deep)
    return s if s < 1e9 else 1.0


def house(k, mats, art, rnd, layout, cx, w, side, i, house_face, depth):
    face = side * house_face
    out = -side
    zc = face + side * depth / 2
    terrace = ground_at(layout, cx, 0) + 1.05
    height = 6.4 + (i % 3) * 0.7
    skin = mats[['brick', 'render', 'render_alt'][i % 3]]
    front = 'front' if out > 0 else 'back'
    k.box(mats['retaining'], cx, terrace / 2, zc, w, terrace, depth)
    k.box(skin, cx, terrace + height / 2, zc, w, height, depth)
    eaves = terrace + height
    k.box(mats['roof'], cx, eaves + 0.08, zc, w + 0.5, 0.16, depth + 0.5)
    k.box(mats['pitch'], cx, eaves + 0.42, zc + side * depth * 0.16, w + 0.3, 0.14, depth * 0.62, rot_x=out * 0.2)
    zf = face + out * 0.06
    door_x = cx - w / 2 + 0.95
    k.box(mats['timber'], door_x, terrace + 1.02, zf + out * 0.05, 1.0, 2.05, 0.14, uv='fit', uv_face=front)
    k.box(mats['roof'], door_x, terrace + 2.22, zf + out * 0.22, 1.24, 0.12, 0.5)
    lamp_y = terrace + 2.05
    k.box(mats['steel'], door_x + 0.72, lamp_y, zf + out * 0.1, 0.16, 0.2, 0.16)
    k.box(mats['porch'], door_x + 0.72, lamp_y - 0.02, zf + out * 0.2, 0.1, 0.12, 0.02, faces={front})
    wall_model(k, ['utility_box_01', 'utility_box_02'][i % 2], door_x + 1.35, terrace + 1.25, zf, out, scale=fit(k, ['utility_box_01', 'utility_box_02'][i % 2], w=0.46, h=0.6))
    k.box(mats['postbox'], door_x - 0.78, terrace + 1.05, zf + out * 0.12, 0.3, 0.36, 0.22, bevel=0.006)
    k.box(mats['bin_dark'], door_x - 0.78, terrace + 1.16, zf + out * 0.235, 0.2, 0.025, 0.01)
    k.box(mats['plate'], door_x + 0.62, terrace + 1.72, zf + out * 0.16, 0.26, 0.1, 0.02)
    win_x = cx + w / 2 - 1.15
    _win(k, mats, win_x, terrace + 1.5, zf, out, mats['pane_lit'] if i % 4 == 0 else mats['pane_dark'], 1.5, 1.1)
    for kk in range(2):
        wx = cx - w / 2 + w * (0.3 + kk * 0.42)
        lit = rnd.random() > 0.55
        _win(k, mats, wx, terrace + 4.15, zf, out, mats['pane_lit'] if lit else mats['pane_cool'], 1.1, 1.24)
    if i % 3 == 1:
        # an air-con unit on a bracket under the upper windows, which every house like this has
        ax = cx + w / 2 - 0.75
        k.box(mats['steel'], ax, terrace + 2.62, zf + out * 0.3, 0.7, 0.05, 0.6)
        wall_model(k, 'exterior_aircon_unit', ax, terrace + 2.645, zf, out, scale=fit(k, 'exterior_aircon_unit', w=0.8, h=0.6))
    if i % 2 == 0:
        by = terrace + 3.42
        k.box(mats['sill'], cx, by, zf + out * 0.45, w - 0.9, 0.1, 0.9)
        for r in range(3):
            k.box(mats['steel'], cx, by + 0.22 + r * 0.22, zf + out * 0.88, w - 0.9, 0.05, 0.05)
        k.box(mats['washing_pole'], cx, by + 0.95, zf + out * 0.6, w - 1.2, 0.05, 0.05)
        for c in range(3):
            col = ['#c9c2b0', '#7f95a8', '#b08c74'][c]
            k.box(k.plain(f'washing-{col}', col, rough=0.95), cx - (w - 2.2) / 2 + c * 0.85, by + 0.62, zf + out * 0.6, 0.34, 0.6, 0.02)
    k.box(mats['pipe'], cx + w / 2 - 0.18, terrace + height / 2, zf + out * 0.1, 0.12, height, 0.12)
    return eaves


def close_gaps(k, mats, layout, row, w, side, i0, house_face, depth):
    def eaves(cx, i):
        return ground_at(layout, cx, 0) + 1.05 + 6.4 + (i % 3) * 0.7
    for kk in range(len(row) - 1):
        a, b2 = row[kk], row[kk + 1]
        x0, x1 = min(a, b2) + w / 2, max(a, b2) - w / 2
        if x1 - x0 < 0.05:
            continue
        top = max(eaves(a, i0 + kk), eaves(b2, i0 + kk + 1)) - 0.05
        length = depth - 0.35
        k.box(mats['retaining'], (x0 + x1) / 2, top / 2, side * house_face + side * (0.3 + length / 2), x1 - x0, top, length)


def build_lane(k, layout, dressing, art, mats):
    rnd = random.Random(dressing.get('seed', 0x57e9a))
    b = layout['bounds']
    lane_half, west = _sides(layout)
    sl_w = b['hw'] + 0.6
    sl_d = b['hd'] + 1
    house_face = dressing['house_face']
    depth = sl_d - house_face
    climb = layout.get('climb', [])
    # under everything: the ground the houses stand on is ground, not sky
    k.slab(mats['base'], b['x'], -0.06, b['z'], b['hw'] * 2 + 16, b['hd'] * 2 + 16, face='top')
    # the stair: every tread and landing, stone from the ground up
    for t in layout['platforms']:
        if t['y'] <= 0.001:
            continue
        k.box(mats['stone'], t['x'], t['y'] / 2, t['z'], t['hw'] * 2, t['y'], t['hd'] * 2)
    # the floor of the mouth, level with the street
    mouth = [r for r in climb if r['from'] == 0 and r['to'] == 0]
    for r in mouth:
        k.slab(mats['lane_floor'], (r['east'] + r['west']) / 2, 0.0, 0, r['east'] - r['west'], lane_half * 2, face='top')
    # nosings on the treads
    for t in layout['platforms']:
        if t['y'] <= 0.001 or t['hw'] >= 0.4:
            continue
        k.box(mats['nosing'], t['x'] + t['hw'] - 0.036, t['y'] - 0.02, t['z'], 0.07, 0.05, t['hd'] * 2)
    # the handrail, run by run
    rail_z = -lane_half + 0.28
    for r in climb:
        length = r['east'] - r['west']
        rise = r['to'] - r['from']
        span = math.hypot(length, rise)
        k.box(mats['steel'], (r['east'] + r['west']) / 2, (r['from'] + r['to']) / 2 + 0.98, rail_z, span, 0.07, 0.07, rot_z=math.atan2(rise, -length))
        posts = max(2, round(length / 1.6))
        for i in range(posts):
            x = r['east'] - (length / posts) * i
            foot = ground_at(layout, x - 0.01, 0)
            head = r['from'] + (rise * i) / posts + 0.98
            k.box(mats['steel'], x, (head + foot) / 2, rail_z, 0.05, max(0.2, head - foot), 0.05)
    # the retaining walls the lane is cut into, and their caps
    for t in layout['platforms']:
        top = t['y'] + 0.92
        for side in (-1, 1):
            k.box(mats['retaining'], t['x'], top / 2, side * (lane_half + 0.3), t['hw'] * 2, top, 0.6)
    for r in climb:
        length = r['east'] - r['west']
        rise = r['to'] - r['from']
        span = math.hypot(length, rise)
        for side in (-1, 1):
            k.box(mats['cap'], (r['east'] + r['west']) / 2, (r['from'] + r['to']) / 2 + 1.02, side * (lane_half + 0.3), span, 0.2, 0.76, rot_z=math.atan2(rise, -length))
    # the houses, two runs offset so the two sides never line up
    north = dressing['north']
    south = dressing['south']
    for i, cx in enumerate(north):
        house(k, mats, art, rnd, layout, cx, dressing['house_w_north'], -1, i, house_face, depth)
    for i, cx in enumerate(south):
        house(k, mats, art, rnd, layout, cx, dressing['house_w_south'], 1, i + 3, house_face, depth)
    close_gaps(k, mats, layout, north, dressing['house_w_north'], -1, 0, house_face, depth)
    close_gaps(k, mats, layout, south, dressing['house_w_south'], 1, 3, house_face, depth)
    # poles and the lines between them
    poles = [s for s in layout['solids'] if s.get('kind') == 'pole']
    for p in poles:
        base = ground_at(layout, p['x'], 0)
        toward = -1 if p['z'] > 0 else 1
        k.box(mats['retaining'], p['x'], base + 4.2, p['z'], 0.26, 8.4, 0.26)
        for arm in (0, 1):
            ay = base + 6.6 + arm * 0.7
            k.box(mats['steel'], p['x'], ay, p['z'] + toward * 0.55, 0.1, 0.08, 1.7)
            for kk in (-0.6, 0.0, 0.6):
                k.box(mats['insulator'], p['x'], ay + 0.12, p['z'] + toward * 0.55 + kk, 0.09, 0.16, 0.09)
        k.box(mats['transformer'], p['x'], base + 5.7, p['z'] + toward * 0.34, 0.44, 0.7, 0.44, bevel=0.01)
    if len(poles) >= 2:
        a, b2 = poles[0], poles[1]
        ta = -1 if a['z'] > 0 else 1
        tb = -1 if b2['z'] > 0 else 1
        for kk in (-0.55, 0.0, 0.55):
            ends = [
                (sl_w - 1, ground_at(layout, sl_w - 1, 0) + 6.9, a['z'] + ta * 0.55 + kk),
                (a['x'], ground_at(layout, a['x'], 0) + 6.72, a['z'] + ta * 0.55 + kk),
                (b2['x'], ground_at(layout, b2['x'], 0) + 6.72, b2['z'] + tb * 0.55 + kk),
                (-sl_w + 1.6, ground_at(layout, -sl_w + 1.6, 0) + 6.9, b2['z'] + tb * 0.55 + kk),
            ]
            for i in range(len(ends) - 1):
                (x0, y0, z0), (x1, y1, z1) = ends[i], ends[i + 1]
                seg = 3
                for j in range(seg):
                    t0, t1 = j / seg, (j + 1) / seg
                    sag = lambda t: -0.34 * math.sin(math.pi * t)
                    ax, ay, az = x0 + (x1 - x0) * t0, y0 + (y1 - y0) * t0 + sag(t0), z0 + (z1 - z0) * t0
                    bx, by, bz = x0 + (x1 - x0) * t1, y0 + (y1 - y0) * t1 + sag(t1), z0 + (z1 - z0) * t1
                    dx, dy, dz = bx - ax, by - ay, bz - az
                    k.box(mats['wire'], (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, math.hypot(dx, dy, dz), 0.035, 0.035,
                          rot_z=math.atan2(dy, dx), rot_y=-math.atan2(dz, dx) if abs(dz) > 1e-6 else 0.0)
    # what is left out along the lane
    for t in layout['solids']:
        kind = t.get('kind')
        if not kind or kind == 'pole':
            continue
        y = ground_at(layout, t['x'], 0)
        x, z, hw, hd = t['x'], t['z'], t['hw'], t['hd']
        if kind == 'planter':
            k.box(mats['planter'], x, y + 0.21, z, hw * 2, 0.42, hd * 2, bevel=0.01)
            k.box(mats['soil'], x, y + 0.45, z, hw * 2 - 0.1, 0.06, hd * 2 - 0.1)
            tree(k, art, x, y + 0.44, z, 0.9, f'lane-planter-{x}', rot_y=rnd.random() * 3)
        elif kind == 'bicycles':
            # what gets left against a wall in a lane like this: crates, a box, tyres, on a rack
            toward = -1 if z > 0 else 1
            k.box(mats['steel'], x, y + 0.62, z - toward * 0.2, hw * 2 + 0.4, 0.06, 0.06)
            for px in (-1, 1):
                k.box(mats['steel'], x + px * (hw + 0.16), y + 0.31, z - toward * 0.2, 0.05, 0.62, 0.05)
            k.import_model('wooden_crate_01', x - hw + 0.42, y, z, rot_y=0.08 * toward, scale=fit(k, 'wooden_crate_01', w=0.8, d=hd * 2 - 0.02))
            k.import_model('cardboard_box_01', x - hw + 0.42, y + 0.02 + k.sized('wooden_crate_01')[1] * fit(k, 'wooden_crate_01', w=0.8, d=hd * 2 - 0.02), z, rot_y=-0.3 * toward, scale=fit(k, 'cardboard_box_01', w=0.6, d=hd * 2 - 0.1))
            k.import_model('wooden_crate_01', x + 0.05, y, z, rot_y=-0.05 * toward, scale=fit(k, 'wooden_crate_01', w=0.7, d=hd * 2 - 0.02))
            for n in range(3):
                k.import_model('old_tyre', x + hw - 0.42, y + n * 0.19, z, rot_y=n * 0.6, scale=fit(k, 'old_tyre', w=hd * 2 - 0.02))
        elif kind == 'bin':
            k.import_model('metal_trash_can', x, y, z, rot_y=rnd.random() * 6.28, scale=fit(k, 'metal_trash_can', w=hw * 2, d=hd * 2))
        elif kind == 'jizo':
            back = 1 if z > 0 else -1
            k.box(mats['niche'], x, y + 0.58, z + back * 0.16, hw * 2, 1.15, 0.3)
            k.box(mats['niche_dark'], x, y + 0.56, z + back * 0.04, hw * 2 - 0.16, 0.9, 0.16)
            k.box(mats['figure'], x, y + 0.36, z - back * 0.02, 0.2, 0.42, 0.18, bevel=0.03)
            k.box(mats['figure'], x, y + 0.66, z - back * 0.02, 0.22, 0.22, 0.22, bevel=0.09)
            k.box(mats['bib'], x, y + 0.46, z - back * 0.11, 0.22, 0.2, 0.03)
            k.box(mats['offering'], x - 0.16, y + 0.2, z - back * 0.06, 0.1, 0.1, 0.1)
            k.box(mats['sill'], x, y + 1.2, z + back * 0.06, hw * 2 + 0.14, 0.08, 0.42)
        elif kind == 'crates':
            for i in range(3):
                col = '#6f5a3a' if i % 2 else '#8a6b45'
                k.box(k.plain(f'crate-{col}', col, rough=0.85), x - hw + 0.32 + (i % 2) * 0.52, y + 0.17 + (i // 2) * 0.35, z, 0.5, 0.34, hd * 2 - 0.08, rot_y=(i - 1) * 0.05, bevel=0.008)
    # the top, and what is past it
    top_y = max((r['to'] for r in climb), default=0.0)
    gate_x = west
    # the piers stand in the plane of the wall that closes the lane, not in front of it
    for s in (-1, 1):
        k.box(mats['retaining'], gate_x - 0.55, top_y + 1.55, s * 1.75, 1.1, 3.1, 0.9)
        k.box(mats['cap'], gate_x - 0.6, top_y + 3.2, s * 1.75, 1.3, 0.2, 1.1)
    k.box(mats['cap'], gate_x - 0.6, top_y + 3.02, 0, 1.2, 0.28, 2.7)
    for s, house_west, eaves in (
        (1, south[-1] - dressing['house_w_south'] / 2, ground_at(layout, south[-1], 0) + 1.05 + 6.4),
        (-1, north[-1] - dressing['house_w_north'] / 2, ground_at(layout, north[-1], 0) + 1.05 + 6.4),
    ):
        x0 = gate_x - 0.55
        x1 = min(house_west, gate_x + 0.55)
        gy = ground_at(layout, gate_x, 0) - 0.5
        d = house_face - 2.2 - 0.05
        k.box(mats['retaining'], (x0 + x1) / 2, (gy + eaves) / 2, s * (2.2 + d / 2), x1 - x0, eaves - gy, d)
    for i in range(9):
        k.box(mats['steel'], gate_x, top_y + 1.2, -1.2 + i * 0.3, 0.06, 2.4, 0.06)
    for ry in (0.5, 2.1):
        k.box(mats['steel'], gate_x, top_y + ry, 0, 0.07, 0.07, 2.6)
    k.box(mats['steel'], gate_x + 0.2, top_y + 3.55, 0, 0.3, 0.34, 0.3)
    k.box(mats['bulb'], gate_x + 0.2, top_y + 3.32, 0, 0.26, 0.02, 0.26, faces={'bottom'})
    rise = dressing.get('rise', 0.18)
    for i in range(9):
        y = top_y + rise * (i + 1)
        k.box(mats['stone'], gate_x - 1.1 - i * 0.46, y / 2, 0, 0.46, y, lane_half * 2 - 0.22)
    k.box(mats['retaining'], gate_x - 7, 5.5, 0, 3.4, 11, sl_d * 2 + 6)
    for i in range(5):
        tree(k, art, gate_x - 7.6 - (i % 3) * 1.9, 10.9, -sl_d + 1.8 + i * (sl_d * 2 - 3.6) / 4, 4.0 + (i % 2) * 1.2, f'lane-top-{i}', rot_y=i * 0.7)
    # the mouth, and the street beyond it
    k.slab(mats['paving'], sl_w + 5.1, 0.0, 0, 9, 16, face='top')
    k.box(mats['brick'], sl_w + 9.4, 4.75, 0, 2.4, 9.5, sl_d * 2 + 8)
    for i in range(3):
        bz = -4.4 + i * 4.4
        k.box(mats['reveal'], sl_w + 8.18, 1.75, bz, 0.14, 2.1, 3.4)
        k.box(mats['pane_lit'] if i == 1 else mats['pane_cool'], sl_w + 8.1, 1.75, bz, 0.05, 1.9, 3.1, faces={'left'})
    for s in (-1, 1):
        k.box(mats['retaining'], sl_w - 0.4, 2.7, s * (lane_half + 0.52), 1.4, 5.4, 0.7)
    k.box(mats['retaining'], sl_w - 0.4, 5.85, 0, 1.4, 0.9, lane_half * 2 + 1.4)
    if 'steplane' in art.get('signs', {}):
        k.box(k.picture('sign-steplane-in', art['signs']['steplane'], rough=0.5), sl_w - 1.12, 5.85, 0, 0.02, 2.1 / 5.2, 2.1, uv='fit', uv_face='right')
    return {'cx': 0, 'cz': 0}
