"""
A shrine precinct — grounds, not a route.

A walled yard of gravel on a raised floor, a great flight up to it from the
street, a paved approach dead straight from the gate to the hall, and
everything else off it: the basin, the plaque rack, the lanterns, the groves
in their planters, a smaller shrine in the trees, a stone behind the hall.
The platforms in the layout are the floor, the flights and the hall's
platform; `things` in the layout are what stands in the grounds, each with a
kind, and every one is stood at whatever height the ground gives back.
"""

import math
import random

from street import tree


def ground_at(layout, x, z):
    y = 0.0
    for p in layout['platforms']:
        if abs(x - p['x']) <= p['hw'] and abs(z - p['z']) <= p['hd']:
            y = max(y, p['y'])
    return y


def torii(k, mats, t, y):
    big = t['hw'] > 3.4
    skin = mats['stone'] if big else mats['vermilion']
    h = 5.2 if big else 4.4
    span = t['hw'] * 2
    for side in (-1, 1):
        k.box(skin, t['x'] + side * (t['hw'] - 0.3), y + h / 2, t['z'], 0.44, h, 0.44, rot_z=-side * 0.024)
        k.box(skin, t['x'] + side * (t['hw'] - 0.3), y + 0.12, t['z'], 0.6, 0.24, 0.6)
    k.box(skin, t['x'], y + h - 0.05, t['z'], span + 1.5, 0.4, 0.72)
    k.box(mats['stone_dark'] if big else mats['dark_wood'], t['x'], y + h + 0.28, t['z'], span + 1.9, 0.2, 0.4)
    k.box(skin, t['x'], y + h - 1.0, t['z'], span - 0.2, 0.28, 0.5)
    k.box(mats['dark_wood'], t['x'], y + h - 0.52, t['z'] - 0.24, 0.8, 0.7, 0.12)


def lantern(k, mats, t, y):
    x, z = t['x'], t['z']
    k.box(mats['stone'], x, y + 0.13, z, 0.84, 0.26, 0.84)
    k.box(mats['stone'], x, y + 0.79, z, 0.44, 1.06, 0.44)
    k.box(mats['stone'], x, y + 1.4, z, 0.78, 0.16, 0.78)
    k.box(mats['stone'], x, y + 1.78, z, 0.62, 0.6, 0.62)
    lit = t.get('lit') is True
    pane = mats['flame'] if lit else mats['soot']
    for s in (-1, 1):
        k.box(pane, x + s * 0.32, y + 1.78, z, 0.03, 0.36, 0.34)
        k.box(pane, x, y + 1.78, z + s * 0.32, 0.34, 0.36, 0.03)
    k.box(mats['stone'], x, y + 2.2, z, 1.06, 0.3, 1.06, bevel=0.02)
    k.box(mats['stone'], x, y + 2.5, z, 0.26, 0.34, 0.26, bevel=0.04)


def chozuya(k, mats, t, y):
    x, z, hw, hd = t['x'], t['z'], t['hw'], t['hd']
    k.box(mats['stone'], x, y + 0.1, z, hw * 2, 0.2, hd * 2)
    k.box(mats['stone'], x, y + 0.56, z, hw * 2 - 0.5, 0.72, hd * 2 - 0.4)
    k.box(mats['water'], x, y + 0.92, z, hw * 2 - 0.9, 0.1, hd * 2 - 0.8)
    k.box(mats['bamboo'], x, y + 1.36, z - 0.3, 0.09, 0.09, 1.1)
    k.box(mats['bamboo'], x, y + 1.14, z - 0.82, 0.09, 0.44, 0.09)
    for i in range(3):
        k.box(mats['dipper'], x - 0.7 + i * 0.7, y + 0.99, z, 0.14, 0.06, 0.5)
        k.box(mats['dipper_cup'], x - 0.7 + i * 0.7, y + 1.02, z + 0.28, 0.16, 0.09, 0.16)
    for sx in (-1, 1):
        for sz in (-1, 1):
            k.box(mats['post'], x + sx * (hw - 0.22), y + 1.175, z + sz * (hd - 0.22), 0.2, 2.45, 0.2)
    k.box(mats['timber'], x, y + 2.46, z, hw * 2 + 1.1, 0.18, hd * 2 + 1.1)
    for sz in (-1, 1):
        k.box(mats['roof_tile'], x, y + 2.76, z + sz * (hd * 0.55), hw * 2 + 1.3, 0.16, hd + 0.9, rot_x=sz * 0.3)


def ema(k, mats, rnd, t, y):
    x, z, hw = t['x'], t['z'], t['hw']
    for s in (-1, 1):
        k.box(mats['post'], x + s * hw, y + 1.05, z, 0.16, 2.1, 0.16)
    k.box(mats['post'], x, y + 1.95, z, hw * 2 + 0.3, 0.14, 0.14)
    k.box(mats['roof_tile'], x, y + 2.16, z, hw * 2 + 0.5, 0.14, 0.7)
    for i in range(14):
        px = x - hw + 0.28 + (i % 7) * ((hw * 2 - 0.56) / 6)
        py = y + 1.66 - (i // 7) * 0.42
        col = ['#c9b88e', '#b8a179', '#d2c39c'][i % 3]
        k.box(k.plain(f'plaque-{col}', col, rough=0.8), px, py, z + 0.06, 0.24, 0.2, 0.03, rot_z=(rnd.random() - 0.5) * 0.28)


def komainu(k, mats, t, y):
    x, z, hw, hd = t['x'], t['z'], t['hw'], t['hd']
    k.box(mats['stone'], x, y + 0.5, z, hw * 2, 1.0, hd * 2)
    k.box(mats['stone_dark'], x, y + 1.06, z, hw * 2 - 0.2, 0.16, hd * 2 - 0.2)
    k.box(mats['stone'], x, y + 1.34, z, 0.4, 0.44, 0.72, bevel=0.04)
    k.box(mats['stone'], x, y + 1.72, z - 0.22, 0.34, 0.34, 0.34, bevel=0.06)
    k.box(mats['stone'], x, y + 1.4, z + 0.34, 0.12, 0.5, 0.12, bevel=0.02)
    for s in (-1, 1):
        k.box(mats['stone'], x + s * 0.14, y + 1.28, z - 0.28, 0.1, 0.4, 0.12)


def subshrine(k, mats, t, y):
    x, z, hw, hd = t['x'], t['z'], t['hw'], t['hd']
    for s in (-1, 1):
        k.box(mats['vermilion'], x + s * 0.62, y + 0.75, z - 1.5, 0.14, 1.5, 0.14)
    k.box(mats['vermilion'], x, y + 1.5, z - 1.5, 1.8, 0.14, 0.2)
    k.box(mats['vermilion'], x, y + 1.24, z - 1.5, 1.5, 0.1, 0.16)
    k.box(mats['stone'], x, y + 0.25, z, hw * 2, 0.5, hd * 2)
    k.box(mats['timber'], x, y + 1.05, z, hw * 1.5, 1.1, hd * 1.4)
    k.box(mats['timber'], x, y + 1.68, z, hw * 1.9, 0.14, hd * 1.8)
    for s in (-1, 1):
        k.box(mats['roof_tile'], x, y + 1.92, z + s * (hd * 0.42), hw * 2.1, 0.13, hd * 1.2, rot_x=s * 0.36)
    step = z - hd * 0.85
    k.box(mats['offering'], x - 0.4, y + 0.585, step, 0.16, 0.2, 0.16)
    k.box(mats['votive'], x + 0.45, y + 0.625, step, 0.22, 0.28, 0.22)


def marker(k, mats, t, y):
    x, z, hw, hd = t['x'], t['z'], t['hw'], t['hd']
    k.box(mats['votive'], x + 1.5, y + 1.3, z - 1.4, 0.36, 0.5, 0.36)
    k.box(mats['stone'], x + 1.5, y + 0.55, z - 1.4, 0.5, 1.1, 0.5)
    k.box(mats['stone'], x + 1.5, y + 1.63, z - 1.4, 0.6, 0.16, 0.6)
    k.box(mats['stone'], x, y + 0.12, z, hw * 2 + 0.4, 0.24, hd * 2 + 0.4)
    k.box(mats['stone'], x, y + 1.14, z, 0.5, 2.0, 0.42, rot_z=0.02, bevel=0.03)
    k.box(mats['stone'], x, y + 2.2, z, 0.56, 0.2, 0.48, bevel=0.02)
    k.box(mats['rope'], x, y + 1.5, z, 0.56, 0.09, 0.48)
    for i in range(4):
        k.box(mats['paper'], x - 0.18 + i * 0.12, y + 1.36, z - 0.25, 0.09, 0.26, 0.02)


def notice(k, mats, art, t, y):
    x, z, hw = t['x'], t['z'], t['hw']
    for s in (-1, 1):
        k.box(mats['post'], x + s * hw, y + 1.1, z, 0.14, 2.2, 0.14)
    k.box(mats['timber'], x, y + 1.6, z, hw * 2, 1.1, 0.1)
    if 'notice' in art.get('signs', {}):
        k.box(k.picture('sign-notice', art['signs']['notice'], rough=0.6), x, y + 1.6, z + 0.06, hw * 2 - 0.2, 0.9, 0.01, uv='fit', uv_face='front')
    k.box(mats['roof_tile'], x, y + 2.28, z, hw * 2 + 0.4, 0.14, 0.5)


def planter_tree(k, mats, art, t, y, i):
    x, z, bed = t['x'], t['z'], t['hw']
    WALL, RIM, CAP = 0.26, 0.44, 0.07
    inner = bed - WALL - CAP
    for dz in (-1, 1):
        cz = z + dz * (bed - WALL / 2)
        k.box(mats['stone'], x, y + RIM / 2, cz, bed * 2, RIM, WALL)
        k.box(mats['stone'], x, y + RIM + 0.045, cz, bed * 2 + CAP * 2, 0.09, WALL + CAP * 2)
    for dx in (-1, 1):
        cx = x + dx * (bed - WALL / 2)
        k.box(mats['stone'], cx, y + RIM / 2, z, WALL, RIM, (bed - WALL) * 2)
        k.box(mats['stone'], cx, y + RIM + 0.045, z, WALL + CAP * 2, 0.09, inner * 2 - 0.04)
    k.box(mats['soil'], x, y + RIM / 2 + 0.02, z, (bed - WALL) * 2 - 0.04, RIM, (bed - WALL) * 2 - 0.04)
    # a tree that fits its planter: four to five and a half metres, with a trunk you can see
    h = 4.2 + ((i * 0.73) % 1.4)
    tree(k, art, x, y + RIM - 0.02, z, h, f'shrine-tree-{i}', rot_y=i * 0.9, model='tree_small')


def fence(k, mats, cx, cz, w, d, along, y):
    length = w if along == 'x' else d
    k.box(mats['stone'], cx, y + 0.17, cz, w, 0.34, d)
    k.box(mats['post'], cx, y + 1.05, cz, w if along == 'x' else 0.2, 1.5, 0.2 if along == 'x' else d)
    k.box(mats['rail_wood'], cx, y + 1.86, cz, w + 0.3 if along == 'x' else 0.34, 0.16, 0.34 if along == 'x' else d + 0.3)
    posts = max(2, round(length / 2.4))
    for i in range(posts + 1):
        t = -length / 2 + (length / posts) * i
        k.box(mats['post'], cx + (t if along == 'x' else 0), y + 0.925, cz + (0 if along == 'x' else t), 0.24, 1.95, 0.24)


def bank_at(x, z, floor):
    """The hill beyond the fence: which tier of it a point is on, or None in the yard."""
    for n in range(3):
        if abs(x) <= BANK_X[n + 1] and z <= BANK_Z[n + 1] and (z >= BANK_Z[n] or abs(x) >= BANK_X[n]):
            return floor + BANK_LIFT[n]
    return None


# the hill steps up in three banks on three sides of the precinct; the yard's
# fence stands at 28.6 and 23.9, the way in's walls end at x 32
BANK_X = (28.95, 32.0, 35.4, 39.4)
BANK_Z = (24.25, 27.25, 30.65, 34.65)
BANK_LIFT = (0.6, 1.5, 2.6)


def build_shrine(k, layout, dressing, art, mats):
    rnd = random.Random(dressing.get('seed', 0x51a3e))
    b = layout['bounds']
    floor = dressing['floor']
    platform = dressing['platform']
    things = layout.get('things', [])
    at = lambda x, z: ground_at(layout, x, z)
    # under everything
    k.slab(mats['base'], b['x'], -0.06, b['z'], b['hw'] * 2 + 24, b['hd'] * 2 + 24, face='top')
    # the yard: gravel over the whole precinct, the approach paved down the middle of it.
    # The precinct is not a mass — the gravel covers every centimetre of its top, so the
    # only part of it that shows is its edge, and that is the kerb and the flights.
    k.slab(mats['gravel'], 0, floor, 4.8, 57.4, 39.6, face='top')
    k.slab(mats['sando'], 0, floor + 0.012, -4.5, 6, 21, face='top')
    # the flights and the hall's platform, one box per tread
    for t in layout['platforms']:
        if t['y'] <= 0.001 or t['hw'] > 20:
            continue
        k.box(mats['stone'], t['x'], t['y'] / 2, t['z'], t['hw'] * 2, t['y'], t['hd'] * 2)
    for t in layout['platforms']:
        if t['y'] <= 0.001 or t['hd'] > 0.4:
            continue
        k.box(mats['nosing'], t['x'], t['y'] - 0.02, t['z'] - t['hd'] + 0.036, t['hw'] * 2, 0.05, 0.07)
    # the precinct's edge: a kerb standing proud of the gravel it holds in
    kerb = floor + 0.09
    for ex, ez, ew, ed in ((-28.3, 4.35, 0.6, 38.1), (28.3, 4.35, 0.6, 38.1), (0, 23.7, 56, 0.6), (-16.5, -14.85, 23, 0.3), (16.5, -14.85, 23, 0.3)):
        k.box(mats['stone'], ex, kerb / 2, ez, ew, kerb, ed)
    # the floor of the passage, level with the street
    k.slab(mats['paving'], 0, 0.006, -23.25, 10, 5.5, face='top')
    # the way in: walls each side of the approach, and the terrace behind you
    for side in (-1, 1):
        k.box(mats['plaster'], side * 18.5, floor + 1.7, -20.5, 27, 3.4, 11)
        k.box(mats['roof_tile'], side * 18.5, floor + 3.5, -20.5, 27.4, 0.3, 11.4)
        k.box(mats['plaster'], side * 6.1, 2.3, -20.5, 1.8, 4.6, 10.6)
        k.box(mats['roof_tile'], side * 6.1, 4.72, -20.5, 2.1, 0.26, 10.9)
    WAY_W, WAY_H = 3.2, 4.2
    for side in (-1, 1):
        w = 20 - WAY_W
        k.box(mats['brick'], side * (WAY_W + w / 2), 5.5, -28, w, 11, 4)
    k.box(mats['brick'], 0, (WAY_H + 11) / 2, -28, WAY_W * 2, 11 - WAY_H, 4)
    for i in range(5):
        k.box(mats['roof_tile'], -16 + i * 8, 11.3, -28, 6.4, 0.5, 4.6)
    for side in (-1, 1):
        k.box(mats['stone'], side * (WAY_W + 0.1), WAY_H / 2, -25.65, 0.5, WAY_H, 0.7)
    k.box(mats['stone'], 0, WAY_H + 0.25, -25.65, WAY_W * 2 + 1.2, 0.5, 0.7)
    k.slab(mats['paving'], 0, 0.006, -28, WAY_W * 2, 4, face='top')
    k.slab(mats['road'], 0, 0.004, -33, 30, 6, face='top')
    k.box(mats['brick'], 0, 5, -36.4, 30, 10, 0.8)
    for wx in (-3.4, 3.4):
        k.box(mats['pane_lit'], wx, 3.1, -35.95, 1.5, 1.8, 0.14, faces={'front'})
    k.box(mats['lamp_glow'], 0, WAY_H - 0.5, -26.1, 0.34, 0.5, 0.24)
    # the precinct fence, three sides, and the back gate to the burial ground
    fence(k, mats, -28.6, 4.775, 0.7, 37.55, 'z', floor)
    fence(k, mats, 28.6, 4.775, 0.7, 37.55, 'z', floor)
    fence(k, mats, -23.85, 23.9, 9.3, 0.7, 'x', floor)
    fence(k, mats, 6.65, 23.9, 43.7, 0.7, 'x', floor)
    gx, gz, gy = -17.2, 23.9, floor
    for side in (-1, 1):
        k.box(mats['post'], gx + side * 2, gy + 1.55, gz, 0.44, 3.1, 0.44)
        k.box(mats['stone'], gx + side * 2, gy + 3.19, gz, 0.62, 0.18, 0.62)
    k.box(mats['post'], gx, gy + 3.45, gz, 5.2, 0.34, 0.5)
    k.box(mats['rail_wood'], gx, gy + 3.75, gz, 6, 0.26, 0.9)
    # what is beyond it is a different scene: a closed box, with the first two
    # metres of the burial ground standing in it so the gate says where it goes
    k.box(mats['beyond'], gx, gy + 2.1, gz + 2.2, 6.4, 4.2, 0.4)
    for side in (-1, 1):
        k.box(mats['beyond'], gx + side * 2.6, gy + 2.05, gz + 1.15, 0.4, 4.2, 2.1)
    k.box(mats['beyond'], gx, gy + 4.35, gz + 1.3, 6.2, 0.4, 2.7)
    k.box(mats['moss'], gx, gy + 0.02, gz + 1.05, 5.4, 0.04, 1.9)
    k.box(mats['path'], gx, gy + 0.05, gz + 1.05, 1.6, 0.02, 1.9)
    lx, lz = gx + 1.4, gz + 1.3
    k.box(mats['stone'], lx, gy + 0.14, lz, 0.5, 0.2, 0.5)
    k.box(mats['stone'], lx, gy + 0.69, lz, 0.24, 0.9, 0.24)
    k.box(mats['flame'], lx, gy + 1.36, lz, 0.44, 0.44, 0.44)
    k.box(mats['stone'], lx, gy + 1.64, lz, 0.6, 0.12, 0.6)
    k.box(mats['grave'], gx - 1.5, gy + 0.49, gz + 1.5, 0.5, 0.9, 0.3)
    k.box(mats['grave'], gx - 0.6, gy + 0.39, gz + 1.7, 0.42, 0.7, 0.28)
    # the hill beyond the fence: three banks stepping up on three sides, with the
    # trees standing on them. Ground, not floating canopy — from the yard you look
    # over the fence at a hillside, and the base of every tree is on it.
    GATE_W, GATE_E, GATE_BACK = gx - 3.4, gx + 3.4, gz + 2.7
    for n in range(3):
        top = floor + BANK_LIFT[n]
        z0, z1 = BANK_Z[n], BANK_Z[n + 1]
        if z0 < GATE_BACK:
            # in three pieces, round the closed box behind the back gate: nothing may stand inside it
            for x0, x1 in ((-BANK_X[n], GATE_W), (GATE_E, BANK_X[n])):
                k.box(mats['bank'], (x0 + x1) / 2, top / 2, (z0 + z1) / 2, x1 - x0, top, z1 - z0, faces={'top', 'front', 'back', 'left', 'right'})
            if z1 > GATE_BACK:
                k.box(mats['bank'], gx, top / 2, (GATE_BACK + z1) / 2, GATE_E - GATE_W, top, z1 - GATE_BACK, faces={'top', 'front', 'back', 'left', 'right'})
        else:
            k.box(mats['bank'], 0, top / 2, (z0 + z1) / 2, BANK_X[n] * 2, top, z1 - z0, faces={'top', 'front', 'back', 'left', 'right'})
        z0 = -15 if n == 0 else -26
        for side in (-1, 1):
            k.box(mats['bank'], side * (BANK_X[n] + BANK_X[n + 1]) / 2, top / 2, (z0 + BANK_Z[n + 1]) / 2, BANK_X[n + 1] - BANK_X[n], top, BANK_Z[n + 1] - z0, faces={'top', 'front', 'back', 'left', 'right'})
    hill = 0
    for i in range(36):
        side = i % 3
        if side == 2:
            bx = -27 + ((i * 7.3) % 54)
            bz = 25.6 + ((i * 3.7) % 8.4)
            if abs(bx - gx) < 4.2 and bz < 27.2:
                bz = 27.6
        else:
            bx = (-1 if side == 0 else 1) * (29.6 + ((i * 2.9) % 8.6))
            bz = -13 + ((i * 9.1) % 38)
        by = bank_at(bx, bz, floor)
        if by is None:
            continue
        model = ('fir_a', 'fir_b', 'tree_small', 'fir_a')[i % 4]
        tree(k, art, bx, by - 0.05, bz, 7.6 + ((i * 0.53) % 3.0), f'hill-{i}', rot_y=i * 0.7, model=model)
        hill += 1
    # what stands in the grounds
    trees_seen = 0
    for t in things:
        y = at(t['x'], t['z'])
        kind = t['kind']
        if kind == 'torii':
            torii(k, mats, t, y)
        elif kind == 'lantern':
            lantern(k, mats, t, y)
        elif kind == 'chozuya':
            chozuya(k, mats, t, y)
        elif kind == 'ema':
            ema(k, mats, rnd, t, y)
        elif kind == 'komainu':
            komainu(k, mats, t, y)
        elif kind == 'subshrine':
            subshrine(k, mats, t, y)
        elif kind == 'marker':
            marker(k, mats, t, y)
        elif kind == 'notice':
            notice(k, mats, art, t, y)
        elif kind == 'tree':
            planter_tree(k, mats, art, t, y, trees_seen)
            trees_seen += 1
    # the hall
    hy = platform
    k.box(mats['stone'], 0, hy + 0.25, 14.5, 15, 0.5, 8)
    k.box(mats['hall_wood'], 0, hy + 2.3, 15.2, 14, 3.6, 6.4)
    k.box(mats['dark_wood'], 0, hy + 3.68, 10.64, 13.4, 0.44, 0.44)
    for px in (-5.4, -1.9, 1.9, 5.4):
        k.box(mats['post'], px, hy + 2.31, 10.66, 0.36, 3.62, 0.36)
    k.box(mats['hall_wood'], 0, hy + 4.2, 14.6, 16.4, 0.3, 9.4)
    for s in (-1, 1):
        k.box(mats['roof_tile'], 0, hy + 4.86, 14.6 + s * 2.5, 17, 0.36, 5.6, rot_x=s * 0.42)
    k.box(mats['roof_tile'], 0, hy + 5.9, 14.6, 17.4, 0.5, 1.1)
    for s in (-1, 1):
        k.box(mats['ridge_end'], s * 8.85, hy + 5.9, 14.6, 0.5, 0.7, 0.9)
    k.box(mats['bell'], 0, hy + 3.6, 11.05, 0.9, 0.34, 0.6, bevel=0.03)
    k.box(mats['bell_gold'], 0, hy + 3.1, 11.05, 0.6, 0.7, 0.6, bevel=0.06)
    for i in range(2):
        k.box(mats['rope'], 0, hy + 2.5 - i * 0.42, 11.05, 0.16 + (i % 2) * 0.04, 0.42, 0.16 + (i % 2) * 0.04, rot_y=i * 0.5)
    k.box(mats['timber'], 0, hy + 0.95, 11.05, 2.6, 0.9, 1.1)
    for i in range(9):
        k.box(mats['dark_wood'], -1.1 + i * 0.275, hy + 1.0, 10.52, 0.08, 0.9, 0.08)

    def rail_run(x0, z0, x1, z1):
        length = math.hypot(x1 - x0, z1 - z0)
        along_x = abs(x1 - x0) > abs(z1 - z0)
        n = max(2, round(length / 1.8) + 1)
        for i in range(n):
            t = i / (n - 1)
            k.box(mats['post'], x0 + (x1 - x0) * t, hy + 0.42, z0 + (z1 - z0) * t, 0.12, 0.84, 0.12)
        cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
        k.box(mats['dark_wood'], cx, hy + 0.88, cz, length + 0.2 if along_x else 0.1, 0.08, 0.1 if along_x else length + 0.2)
        k.box(mats['dark_wood'], cx, hy + 0.46, cz, length - 0.02 if along_x else 0.08, 0.06, 0.08 if along_x else length - 0.02)

    for s in (-1, 1):
        rail_run(s * 9.3, 9.08, s * 9.3, 19.3)
        rail_run(s * 7.2, 9.08, s * 9.05, 9.08)
    rail_run(-9.05, 19.3, 9.05, 19.3)
    for lx in (-5.4, 5.4):
        k.box(mats['dark_wood'], lx, hy + 3.45, 10.4, 0.1, 0.5, 0.1)
        k.box(mats['hall_lantern'], lx, hy + 2.9, 10.4, 0.5, 0.62, 0.5, bevel=0.02)
    print(f'shrine: {len(things)} things, {hill} trees on the hill')
    return {'cx': 0, 'cz': floor}
