"""
A covered shopping street — a shōtengai: two rows of small units facing each
other across a tiled floor, a steel canopy over the whole length, pendants
down the spine, and a way out at each end and one through the side.

The collision says where the two rows stand (the tall slabs), where the ways
out are (the doors), and what is left out on the floor (the goods solids,
which carry a `kind`). The dressing says who the shops are.
"""

import math
import random

from street import _window


def _rows(layout):
    b = layout['bounds']
    walls = [s for s in layout['solids'] if s.get('tall') and s['hw'] > s['hd']]
    north = max(s['z'] + s['hd'] for s in walls if s['z'] < b['z'])
    south = min(s['z'] - s['hd'] for s in walls if s['z'] > b['z'])
    ends = [s for s in layout['solids'] if s.get('tall') and s['hd'] >= s['hw']]
    west = max(s['x'] + s['hw'] for s in ends if s['x'] < b['x'])
    east = min(s['x'] - s['hw'] for s in ends if s['x'] > b['x'])
    return north, south, west, east


def unit(k, mats, art, rnd, u, cx, side, front, unit_w, eave):
    """One unit of the row. `side` -1 is the north row (front looks +z)."""
    face_z = side * front
    out = -side
    zf = face_z + out * 0.05
    w = unit_w - 0.14
    front_face = 'front' if out > 0 else 'back'
    ground = k.plain(f'ground-{u["ground"]}', u['ground'], rough=0.8)
    ink = k.plain(f'ink-{u["ink"]}', u['ink'], rough=0.7)
    # party wall and stallboard
    k.box(mats['party'], cx - unit_w / 2, 2.25, face_z + out * 0.16, 0.16, 4.5, 0.5)
    k.box(mats['timber'], cx, 0.17, face_z + out * 0.16, w, 0.34, 0.5)
    if u.get('shut'):
        shut = k.plain(f'shutter-{u["shut"]}', u['shut'], rough=0.7)
        # the shutter: a run of slats, each proud of the last by a hair
        for i in range(13):
            k.box(shut, cx, 0.38 + i * 0.2, zf + out * 0.14, w - 0.3, 0.19, 0.03)
        for gx in (-1, 1):
            k.box(mats['rail'], cx + gx * (w / 2 - 0.1), 1.65, face_z + out * 0.2, 0.12, 2.7, 0.22)
        k.box(mats['shutter_box'], cx, 3.14, face_z + out * 0.18, w - 0.1, 0.42, 0.30)
        if rnd.random() > 0.4:
            bills = art['posters'] + art['boxes']
            pic = k.picture(f'unit-bill-{cx:.1f}', bills[rnd.randrange(len(bills))], rough=0.8)
            k.box(pic, cx + (rnd.random() - 0.5) * 1.6, 1.7, zf + out * 0.3, 0.5, 0.7, 0.02, uv='fit', uv_face=front_face)
    else:
        gw = w - 0.5
        bays = max(3, round(gw / 1.05))
        bay_w = gw / bays
        lit = mats['interior_cool'] if u.get('cool') else mats['interior']
        k.box(mats['reveal'], cx, 1.72, zf + out * 0.06, gw + 0.12, 2.62, 0.1)
        k.box(lit, cx, 1.72, zf + out * 0.12, gw - 0.1, 2.5, 0.02, faces={front_face})
        for m in range(bays):
            bx = cx - gw / 2 + bay_w * (m + 0.5)
            k.box(mats['glass'], bx, 1.55, zf + out * 0.17, bay_w - 0.1, 1.66, 0.01, uv='fit')
            k.box(mats['glass'], bx, 2.66, zf + out * 0.17, bay_w - 0.1, 0.26, 0.01, uv='fit')
        for m in range(1, bays):
            k.box(mats['frame'], cx - gw / 2 + bay_w * m, 1.75, zf + out * 0.20, 0.08, 2.5, 0.10)
        k.box(mats['frame'], cx - gw / 2, 1.72, zf + out * 0.20, 0.1, 2.66, 0.10)
        k.box(mats['frame'], cx + gw / 2, 1.72, zf + out * 0.20, 0.1, 2.66, 0.10)
        k.box(mats['frame'], cx, 2.455, zf + out * 0.165, gw, 0.09, 0.07)
        k.box(mats['frame'], cx, 2.93, zf + out * 0.165, gw + 0.2, 0.12, 0.07)
        # stock in the window: the shop's own colours, and some of the game's boxes
        stock = [u['ground'], u['ink'], u.get('awning') or u['ground'], u.get('noren') or u['ink']]
        boxes = art['boxes']
        for d in range(max(3, int(gw // 0.9))):
            x = cx - gw / 2 + 0.45 + d * 0.9
            if d % 3 == 1:
                pic = k.picture(f'stock-{rnd.randrange(len(boxes))}', boxes[rnd.randrange(len(boxes))], rough=0.55)
                k.box(pic, x, 0.92 + (d % 2) * 0.16, zf + out * 0.31, 0.28, 0.34, 0.16, uv='fit', uv_face=front_face)
            else:
                k.box(k.plain(f'stock-{stock[d % 4]}', stock[d % 4], rough=0.7), x, 0.92 + (d % 2) * 0.16, zf + out * 0.31, 0.28, 0.24 + rnd.random() * 0.2, 0.16, bevel=0.006)
        if u.get('noren'):
            cloth = k.plain(f'noren-{u["noren"]}', u['noren'], rough=0.95)
            nx = cx + (rnd.random() - 0.5) * (w * 0.3)
            for n in (-1, 0, 1):
                k.box(cloth, nx + n * 0.56, 2.16, zf + out * 0.26, 0.52, 0.72, 0.03)
            k.box(mats['rail'], nx, 2.56, zf + out * 0.26, 1.8, 0.07, 0.12)
    # the fascia and its board
    fw, fh = w - 0.24, 1.0
    k.box(ground, cx, 3.62, face_z + out * 0.24, w, 1.2, 0.3)
    if u['name'] and u['sign'] in art.get('signs', {}):
        k.box(k.picture(f'sign-{u["sign"]}', art['signs'][u['sign']], rough=0.5), cx, 3.62, face_z + out * 0.47, fw, fh, 0.02, uv='fit', uv_face=front_face)
    # a hanging sign at right angles, the shop's own board on both faces
    k.box(mats['rail'], cx, 4.32, face_z + out * 0.5, 0.1, 0.1, 0.8)
    k.box(ground, cx, 3.92, face_z + out * 0.92, 0.09, 0.78, 0.62)
    if u['name'] and u['sign'] in art.get('signs', {}):
        pic = k.picture(f'sign-{u["sign"]}', art['signs'][u['sign']], rough=0.5)
        k.box(pic, cx - 0.06, 3.92, face_z + out * 0.92, 0.004, 0.6, 0.5, uv='fit', uv_face='left')
        k.box(pic, cx + 0.06, 3.92, face_z + out * 0.92, 0.004, 0.6, 0.5, uv='fit', uv_face='right')
    else:
        k.box(ink, cx, 3.92, face_z + out * 0.92, 0.17, 0.5, 0.4)
    if u.get('awning'):
        aw = w - 0.7
        awn = k.plain(f'awning-{u["awning"]}', u['awning'], rough=0.9)
        k.box(awn, cx, 3.0, face_z + out * 0.78, aw, 0.09, 1.35, rot_x=side * 0.17)
        for i in range(int(aw / 0.4)):
            k.box(awn, cx - aw / 2 + 0.2 + i * 0.4, 2.79, face_z + out * 1.42, 0.32, 0.2, 0.05)
        for ax in (-1, 1):
            k.box(mats['rail'], cx + ax * (aw / 2 - 0.15), 3.06, face_z + out * 0.76, 0.06, 0.06, 1.3)
    # the floor above, up to the eaves
    k.box(mats['render'], cx, 5.06, face_z + out * 0.18, w, 1.68, 0.4)
    for i in range(2):
        wx = cx - w / 2 + (w / 2) * (i + 0.5)
        lit_up = rnd.random() > 0.68
        k.box(mats['reveal'], wx, 5.06, face_z + out * 0.36, 0.9, 0.9, 0.1)
        k.box(mats['pane_lit'] if lit_up else mats['pane_dark'], wx, 5.06, face_z + out * 0.42, 0.74, 0.74, 0.05, faces={front_face})
        k.box(mats['stone'], wx, 4.57, face_z + out * 0.42, 1.04, 0.08, 0.16)


def canopy(k, mats, x0, x1, front, eave, ridge):
    steel = mats['steel']
    length = x1 - x0
    cx = (x0 + x1) / 2
    for s in (-1, 1):
        k.box(steel, cx, eave, s * (front + 0.25), length - 0.12, 0.4, 0.36)
    k.box(steel, cx, ridge + 0.1, 0, length, 0.3, 0.3)
    rise = ridge - eave
    run = front + 0.25
    leg = math.hypot(run, rise)
    ang = math.atan2(rise, run)
    n = 10
    for i in range(n + 1):
        x = x0 + length / n * i
        for s in (-1, 1):
            k.box(steel, x, eave + rise / 2, s * run / 2, 0.16, 0.22, leg, rot_x=-s * ang)
        k.box(steel, x, eave - 0.2, 0, 0.26, 0.14, run * 2)
        k.box(steel, x, eave + rise / 2, 0, 0.08, rise, 0.08)
    panel_len = math.hypot(run + 0.2, rise)
    for s in (-1, 1):
        k.box(mats['panel'], cx, eave + rise / 2 + 0.16, s * (run + 0.2) / 2, length + 0.5, 0.09, panel_len, rot_x=-s * ang, faces={'bottom', 'top'})
        for kk in (1, 2):
            t = kk / 3
            k.box(steel, cx, eave + rise * t + 0.03, s * run * (1 - t), length, 0.1, 0.1)


def pendants(k, mats, x0, x1, n=8):
    length = x1 - x0
    for i in range(n):
        x = x0 + length / n * (i + 0.5)
        k.box(mats['steel'], x, 6.4, 0, 0.035, 1.35, 0.035)
        # a conical shade, as a stack of narrowing rings
        for r in range(4):
            t = r / 3
            k.box(mats['shade'], x, 5.44 + t * 0.28, 0, 0.76 - t * 0.5, 0.08, 0.76 - t * 0.5, bevel=0.01)
        k.box(mats['bulb'], x, 5.36, 0, 0.5, 0.02, 0.5, faces={'bottom'})


def bunting(k, mats, front):
    run = front + 0.25
    for bx in (-15.5, -2.3, 11.8):
        k.box(mats['cord'], bx, 5.34, 0, 0.04, 0.04, run * 2)
        for i in range(11):
            z = -4.6 + i * 0.92
            col = ['#8a4a3a', '#3f6a72', '#a8894a', '#5a7a4a', '#7a4a6a'][i % 5]
            k.box(k.plain(f'flag-{col}', col, rough=0.95), bx, 5.16, z, 0.03, 0.3, 0.26)
    for i in range(6):
        x = 15.5 + i * 1.35
        k.box(mats['cord'], x, 5.1, 3.4, 0.03, 0.55, 0.03)
        k.box(mats['lantern'], x, 4.68, 3.4, 0.34, 0.3, 0.34, bevel=0.06)


def goods(k, mats, art, rnd, g):
    kind = g['kind']
    x, z, hw, hd = g['x'], g['z'], g['hw'], g['hd']
    if kind == 'crates':
        cols = max(2, round(hw))
        cw = hw * 2 / cols
        for i in range(cols):
            cx = x - hw + cw * (i + 0.5)
            high = 1 + rnd.randrange(2)
            top = 0.0
            for kk in range(high):
                y = 0.19 + kk * 0.37
                tint = g.get('tint', '#6f5a3a') if kk % 2 else '#8a6b45'
                k.box(k.plain(f'crate-{tint}', tint, rough=0.85), cx, y, z, cw - 0.1, 0.36, hd * 2 - 0.12, rot_y=(rnd.random() - 0.5) * 0.09, bevel=0.008)
                top = y + 0.18
            for n in range(3):
                col = ['#7a8a3a', '#a8703a', '#8a3a3a', '#c2a04a', '#6a7a4a'][(i + n) % 5]
                k.box(k.plain(f'fruit-{col}', col, rough=0.6), cx + (n - 1) * 0.3, top + 0.074, z + (rnd.random() - 0.5) * (hd * 0.9), 0.18, 0.15, 0.18, bevel=0.03)
    elif kind == 'bin':
        k.box(mats['bin'], x, 0.45, z, hw * 2, 0.9, hd * 2, bevel=0.012)
        k.box(mats['bin_lid'], x, 0.93, z, hw * 2 + 0.08, 0.08, hd * 2 + 0.08, bevel=0.01)
    elif kind == 'sacks':
        n = max(3, round(hw * 2.4))
        for i in range(n):
            # the sacks fill the footprint they are given: the solid is the
            # drawing, front to back
            k.box(mats['sack'], x - hw + (hw * 2 / n) * (i + 0.5), 0.17 + (i % 2) * 0.34, z, (hw * 2) / n - 0.06, 0.34, hd * 2 - 0.08, rot_y=(rnd.random() - 0.5) * 0.12, bevel=0.03)
    elif kind == 'rack':
        k.box(mats['rail'], x, 0.75, z, 0.12, 1.5, 0.12)
        cards = art['cards']
        for i in range(4):
            y = 0.42 + i * 0.34
            k.box(mats['rail'], x, y, z, hw * 1.8, 0.05, hd * 1.2)
            for c in range(5):
                pic = k.picture(f'rack-card-{(i + c) % len(cards)}', cards[(i + c) % len(cards)], rough=0.5)
                k.box(pic, x - hw * 0.72 + c * (hw * 1.44 / 4), y + 0.15, z - hd * 0.3, 0.2, 0.28, 0.01, uv='fit', uv_face='front', turned=1)
    elif kind == 'ice':
        k.box(mats['ice_box'], x, 0.36, z, hw * 2, 0.72, hd * 2, bevel=0.01)
        k.box(mats['ice'], x, 0.78, z, hw * 2 - 0.2, 0.12, hd * 2 - 0.2)
        for i in range(7):
            col = '#8f9aa4' if i % 3 else '#a4736a'
            k.box(k.plain(f'fish-{col}', col, rough=0.4), x - hw + 0.4 + i * ((hw * 2 - 0.8) / 6), 0.87, z + (rnd.random() - 0.5) * (hd * 1.1), 0.33, 0.1, 0.15, rot_y=(rnd.random() - 0.5) * 0.7, bevel=0.02)
    elif kind == 'bench':
        w = hw * 2 - 0.2
        for i in range(4):
            k.box(mats['timber'], x, 0.44, z - 0.22 + i * 0.16, w, 0.06, 0.13, bevel=0.006)
        for i in range(3):
            k.box(mats['timber'], x, 0.6 + i * 0.16, z + 0.32, w, 0.13, 0.05, bevel=0.006)
        for sx in (-w / 2 + 0.2, w / 2 - 0.2):
            k.box(mats['rail'], x + sx, 0.22, z - 0.18, 0.09, 0.44, 0.09)
            k.box(mats['rail'], x + sx, 0.22, z + 0.28, 0.09, 0.44, 0.09)
    elif kind == 'bicycles':
        k.box(mats['rail'], x, 0.34, z, hw * 2, 0.1, 0.1)
        n = 4
        for i in range(n):
            bx = x - hw + (hw * 2 / n) * (i + 0.5)
            col = ['#6a3a3a', '#3a4a6a', '#3a5a3a', '#5a4a2a'][i % 4]
            for wz in (-0.34, 0.34):
                k.box(mats['rail'], bx, 0.34, z + wz, 0.05, 0.62, 0.05)
            k.box(k.plain(f'bike-{col}', col, rough=0.5), bx, 0.62, z, 0.05, 0.05, 0.6)
            k.box(mats['rail'], bx, 0.86, z - 0.3, 0.34, 0.05, 0.05)


def build_arcade(k, layout, dressing, art, mats):
    rnd = random.Random(dressing.get('seed', 0x3a4c8e))
    north, south, west, east = _rows(layout)
    b = layout['bounds']
    front = dressing['front']
    eave, ridge = dressing['eave'], dressing['ridge']
    x0, x1 = west, east
    length = x1 - x0
    # the floor and the lane down the middle
    # through both doorways, edge to edge with the ground beyond: a strip of
    # nothing between two floors is the void, seen as a blue line under a gate
    ends = [s for s in layout['solids'] if s.get('tall') and s['hd'] >= s['hw'] and s['hw'] >= 0.8]
    outer_w = min(s['x'] - s['hw'] for s in ends if s['x'] < b['x']) if ends else x0 - 1
    outer_e = max(s['x'] + s['hw'] for s in ends if s['x'] > b['x']) if ends else x1 + 1
    k.slab(mats['floor'], (outer_w + outer_e) / 2, 0.0, 0, outer_e - outer_w, (front + 0.4) * 2, face='top')
    # a hair above the floor, so its underside is not the floor's top
    k.slab(mats['lane'], (x0 + x1) / 2, 0.012, 0.2, length - 1.5, 4.6, face='top')
    k.box(mats['gutter'], (x0 + x1) / 2, 0.007, -4.6, length, 0.014, 0.34, faces={'top'})
    # the two blocks the units are cut into, from the collision
    # The blocks the units are cut into, drawn from the shopfront plane back
    # to the solid's far face. The solid reaches nearer than the shopfront —
    # it keeps the player off the stallboards and the goods in the window —
    # and drawn to the solid it swallowed all of them.
    for s in [s for s in layout['solids'] if s.get('tall') and s['hw'] > s['hd']]:
        if s['z'] < 0:
            back, near = s['z'] - s['hd'], -front
        else:
            back, near = s['z'] + s['hd'], front
        k.box(mats['brick'], s['x'], 4.3, (back + near) / 2, s['hw'] * 2, 8.6, abs(back - near))
    units_n = dressing['units_per_side']
    unit_w = length / units_n
    for i in range(units_n):
        cx = x0 + unit_w * (i + 0.5)
        unit(k, mats, art, rnd, dressing['north'][i], cx, -1, front, unit_w, eave)
        if i < len(dressing['south']):
            unit(k, mats, art, rnd, dressing['south'][i], cx, 1, front, unit_w, eave)
    # the way through to Black Crown, in the south row
    bc = dressing['side_passage']
    pz = front - 0.4
    for s in (-1, 1):
        k.box(mats['stone'], bc['x'] + s * 2.25, 2.7, pz - 0.3, 0.6, 5.4, 0.75)
    k.box(mats['stone'], bc['x'], 5.7, pz - 0.3, 5.7, 0.6, 0.75)
    k.slab(mats['paving'], bc['x'], 0.01, 7.2, 4.3, 5, face='top')
    k.box(mats['brick'], bc['x'], 2.8, 9.6, 4.7, 5.6, 0.4)
    k.box(mats['pane_lit'], bc['x'], 3.1, 9.35, 1.9, 1.5, 0.14, faces={'back'})
    k.box(mats['fascia'], bc['x'], 6.55, pz - 0.6, 4.4, 1.3, 0.3)
    if 'blackcrown' in art.get('signs', {}):
        k.box(k.picture('sign-blackcrown', art['signs']['blackcrown'], rough=0.5), bc['x'], 6.55, pz - 0.78, 4.0, 1.05, 0.02, uv='fit', uv_face='back')
    canopy(k, mats, x0, x1, front, eave, ridge)
    pendants(k, mats, x0, x1)
    bunting(k, mats, front)
    # the west arch and Turtle Lane beyond it
    # the piers are exactly the solids either side of the doorway — the wall
    # the collision has there is the wall you see, and nothing stands proud of
    # it into the arcade to be walked into
    flank = [s for s in layout['solids'] if s.get('tall') and s['hd'] >= s['hw'] and s['x'] < b['x']]
    ax = sum(f['x'] for f in flank) / len(flank) if flank else x0 - 1
    for s in (-1, 1):
        mine = [f for f in flank if (f['z'] < 0) == (s < 0)]
        z0f = min(f['z'] - f['hd'] for f in mine) if mine else s * 2.2
        z1f = max(f['z'] + f['hd'] for f in mine) if mine else s * 3.3
        pw = max(f['hw'] for f in mine) * 2 if mine else 1.5
        k.box(mats['stone'], ax, 2.8, (z0f + z1f) / 2, pw, 5.6, z1f - z0f)
        k.box(mats['cornice'], ax, 5.72, (z0f + z1f) / 2, pw + 0.2, 0.24, z1f - z0f + 0.2)
        k.box(mats['iron'], x0 + 0.4, 4.5, s * 2.75, 0.3, 0.5, 0.3)
        k.box(mats['bulb'], x0 + 0.4, 4.19, s * 2.75, 0.24, 0.02, 0.24, faces={'bottom'})
    k.box(mats['stone'], ax, 6.0, 0, 1.42, 1.0, 6.52)
    k.box(mats['cornice'], ax, 6.56, 0, 1.8, 0.26, 7.0)
    if 'market' in art.get('signs', {}):
        k.box(k.picture('sign-market-in', art['signs']['market'], rough=0.5), x0 + 0.3, 6.05, 0, 0.02, 0.82, 5.4, uv='fit', uv_face='right')
    k.slab(mats['road'], outer_w - 4.5, 0.0, 0, 9, 20, face='top')
    k.box(mats['pavement'], outer_w - 4.5, 0.08, -7.4, 9, 0.16, 2.4)
    k.box(mats['brick_far'], x0 - 1 - 9.6, 6.9, 0, 3, 14, 19)
    for f in range(4):
        for c in range(5):
            wy, wz = 3.4 + f * 2.7, -7.2 + c * 3.6
            lit = rnd.random() > 0.5
            k.box(mats['reveal'], x0 - 1 - 8.05, wy, wz, 0.12, 1.4, 1.0)
            k.box(mats['pane_lit'] if lit else mats['pane_dark'], x0 - 1 - 7.98, wy, wz, 0.05, 1.2, 0.84, faces={'right'})
    # the east gates and the station vestibule beyond
    # the two piers either side of the gate, and not the sliver of the south
    # row that stands beyond the passage to Black Crown
    gates = [s for s in layout['solids'] if s.get('tall') and s['hd'] >= s['hw'] and s['x'] > b['x'] and s['hw'] >= 0.8]
    gx = sum(f['x'] for f in gates) / len(gates) if gates else x1 + 1
    half = min(abs(f['z']) - f['hd'] for f in gates) if gates else 2
    for s in (-1, 1):
        mine = [f for f in gates if (f['z'] < 0) == (s < 0)]
        z0f = min(f['z'] - f['hd'] for f in mine) if mine else s * half
        z1f = max(f['z'] + f['hd'] for f in mine) if mine else s * front
        pw = max(f['hw'] for f in mine) * 2 if mine else 2.0
        k.box(mats['brick'], gx, 3.2, (z0f + z1f) / 2, pw, 6.4, abs(z1f - z0f))
        k.box(mats['stone'], gx, 2.5, s * (half - 0.05), pw + 0.2, 5.0, 0.34)
        for i in range(5):
            k.box(mats['iron'], gx - 0.86, 1.65, s * (half + 0.24 + i * 0.13), 0.12, 3.0, 0.08)
        k.box(mats['iron'], gx - 0.86, 1.72, s * (half + 0.5), 0.2, 0.26, 0.9)
    k.box(mats['iron'], gx - 0.86, 3.28, 0, 0.16, 0.14, half * 2 + 0.8)
    k.box(mats['party'], gx, 5.31, 0, 2.4, 0.62, half * 2 + 0.9)
    k.box(mats['brick'], gx, 6.15, 0, 1.92, 1.1, half * 2 + 0.4)
    if 'station' in art.get('signs', {}):
        k.box(k.picture('sign-station', art['signs']['station'], rough=0.5), gx - 1.02, 4.55, 0, 0.02, 0.62, 2.9, uv='fit', uv_face='left')
    for s in (-1, 1):
        k.box(mats['brick'], gx + 5, 4.6, s * (front + 2.5), 8, 9.2, 4.6)
    k.box(mats['brick'], gx + 8.4, 4.67, 0, 1.8, 9.34, front * 2 + 9.2 - 0.4)
    k.box(mats['panel'], gx + 4.6, 8.4, 0, 9.2, 1.2, front * 2 + 9.2)
    k.slab(mats['paving'], outer_e + 4.2, 0.0, 0, 8.4, front * 2 + 4, face='top')
    k.box(mats['reveal'], gx + 7.32, 2.4, 0, 0.14, 2.0, 3.4)
    k.box(mats['pane_lit'], gx + 7.25, 2.4, 0, 0.06, 1.7, 3.1, faces={'left'})
    for bz in (-1.0, 0.0, 1.0):
        k.box(mats['frame'], gx + 7.21, 2.4, bz, 0.1, 1.76, 0.09)
    k.box(mats['frame'], gx + 7.21, 2.42, 0, 0.1, 0.09, 3.16)
    k.box(mats['stone'], gx + 7.2, 3.58, 0, 0.5, 0.34, 4.0)
    # what is left out on the floor
    for g in layout['solids']:
        if g.get('kind'):
            goods(k, mats, art, rnd, g)
    return {'cx': 0, 'cz': 0}
