"""
A street: terraces of buildings down both sides, a road between pavements,
and a way out at every end that shows the first few metres of where it goes.

The collision says where the terraces stand (the tall solids), where the
pavements are (the platforms), where the furniture is (the small solids) and
where the ways out are (the doors). The dressing says what the buildings
look like — how many, how tall, which have shopfronts, which colour of
awning — and what stands in the windows. Everything that stops a duelist is
built to its solid; everything else is dressing and stands clear of the
walking line.
"""

import math
import os
import random

from kit import G


def _faces(layout):
    """
    The four faces the street is held between, off the tall solids.

    A terrace is wide and shallow and an end wall is narrow and deep, and
    that is how they are told apart — not by where they stand. The end walls
    run the whole depth of the street, so asked by position alone they were
    the nearest thing to the middle on every side, and the whole street was
    built inside a box eleven metres across.
    """
    b = layout['bounds']
    walls = [s for s in layout['solids'] if s.get('tall')]
    across = [s for s in walls if s['hw'] > s['hd']]
    along = [s for s in walls if s['hd'] >= s['hw']]
    north = max(s['z'] + s['hd'] for s in across if s['z'] < b['z'])
    south = min(s['z'] - s['hd'] for s in across if s['z'] > b['z'])
    west = max(s['x'] + s['hw'] for s in along if s['x'] < b['x'])
    east = min(s['x'] - s['hw'] for s in along if s['x'] > b['x'])
    return {'north': north, 'south': south, 'west': west, 'east': east}


def ground(k, layout, faces, mats):
    """Road between the kerbs, pavements on the platforms, and the kerbs."""
    b = layout['bounds']
    ext_w = b['hw'] * 2 + 4
    # the road, drawn a hair below zero so nothing standing on 0 fights it
    k.slab(mats['road'], b['x'], -0.004, b['z'], ext_w, b['hd'] * 2 + 4, face='top')
    for p in layout['platforms']:
        if p['hw'] < 3:
            continue  # the shop's own doorstep, drawn with its frontage
        # a pavement is a box the height the collision says, a hair short of
        # the end walls it runs into so its end faces are not theirs
        k.box(mats['pavement'], p['x'], p['y'] / 2, p['z'], p['hw'] * 2 - 0.2, p['y'], p['hd'] * 2, faces={'top', 'front', 'back', 'left', 'right'})
        # a kerb stone line along the road edge: proud of the pavement's
        # face by six centimetres and a little taller, so no face of it is
        # a face of the pavement
        side = -1 if p['z'] < b['z'] else 1
        edge_z = p['z'] - side * p['hd']
        k.box(mats['kerb'], p['x'], p['y'] / 2 + 0.008, edge_z - side * 0.03, p['hw'] * 2 - 0.4, p['y'] + 0.016, 0.3)


def _window(k, mats, x, y, z, out, lit, w=1.1, h=1.5, curtains=False):
    """A window in a facade: reveal, pane, sill and head. `out` is +1 for a
    face looking towards +z, -1 for one looking towards -z."""
    k.box(mats['reveal'], x, y, z + out * 0.02, w, h, 0.12)
    pane = mats['pane_lit'] if lit else mats['pane_dark']
    k.box(pane, x, y, z + out * 0.09, w - 0.16, h - 0.18, 0.02, faces={'front' if out > 0 else 'back'})
    k.box(mats['stone'], x, y - h / 2 - 0.05, z + out * 0.1, w + 0.2, 0.1, 0.22)
    k.box(mats['stone'], x, y + h / 2 + 0.06, z + out * 0.06, w + 0.12, 0.12, 0.14)
    for mx in (-w / 2 + 0.08, w / 2 - 0.08):
        k.box(mats['frame'], x + mx, y, z + out * 0.07, 0.06, h - 0.16, 0.05)
    k.box(mats['frame'], x, y, z + out * 0.07, w - 0.16, 0.05, 0.05)
    k.box(mats['frame'], x, y, z + out * 0.07, 0.05, h - 0.16, 0.05)
    if lit and curtains:
        k.box(mats['curtain'], x - w * 0.3, y, z + out * 0.13, 0.26, h - 0.2, 0.02)


def building(k, mats, art, rnd, cx, w, face_z, out, height, depth, style):
    """
    One building of a terrace: a body, floors of windows, a cornice and
    parapet, a ground floor that is a shopfront or a door, a drainpipe.
    `out` is which way its front looks: +1 towards +z (a north terrace), -1
    towards -z (a south terrace).
    """
    zc = face_z - out * depth / 2
    skin = mats[style.get('skin', 'brick')]
    k.box(skin, cx, height / 2, zc, w, height, depth)
    # cornice and parapet
    eave = style.get('eave', 0.32)
    k.box(mats['cornice'], cx, height + 0.16, zc + out * (eave - 0.34) / 2, w + eave, 0.32, depth + eave)
    k.box(mats['parapet'], cx, height + 0.5, zc + out * (eave * 0.3 - 0.1) / 2, w + eave * 0.3, 0.7, depth + eave * 0.3)
    # a string course at each floor
    zf = face_z + out * 0.02
    floors = max(1, int((height - 3.2) // 2.6))
    cols = max(1, int(w // 2.3))
    for f in range(floors):
        y = 4.3 + f * 2.6
        k.box(mats['stone'], cx, y - 1.25, zf + out * 0.04, w - 0.2, 0.08, 0.08)
        for c in range(cols):
            x = cx - w / 2 + (w / cols) * (c + 0.5)
            lit = rnd.random() > 0.55
            _window(k, mats, x, y, zf, out, lit, curtains=rnd.random() > 0.5)
    if style.get('shopfront'):
        shopfront(k, mats, art, rnd, cx, w, zf, out, style)
    else:
        # a front door up a step, off to one side
        dx = cx + (rnd.random() - 0.5) * (w * 0.4)
        k.box(mats['reveal'], dx, 1.2, zf + out * 0.03, 1.2, 2.4, 0.14)
        k.box(mats['door'], dx, 1.15, zf + out * 0.08, 1.0, 2.2, 0.06, uv='fit', uv_face='front' if out > 0 else 'back')
        k.box(mats['brass'], dx + 0.36, 1.05, zf + out * 0.13, 0.03, 0.03, 0.06)
        # a threshold stone flush with the pavement, not a step: a step you
        # can stand on is a platform, and this one is not in the collision
        k.box(mats['stone'], dx, 0.14 + 0.004, zf + out * 0.22, 1.4, 0.008, 0.44)
        k.box(mats['frame'], dx, 2.42, zf + out * 0.08, 1.3, 0.1, 0.18)
        # a wall lamp by the door
        k.box(mats['iron'], dx + 0.85, 2.3, zf + out * 0.1, 0.16, 0.24, 0.16)
    if style.get('awning'):
        awning(k, mats, cx, w, face_z, out, style['awning'])
    # a drainpipe down one edge, stood clear of the face
    k.box(mats['iron'], cx + w / 2 - 0.2, height / 2 - 0.1, zf + out * 0.1, 0.12, height - 0.2, 0.12)


def shopfront(k, mats, art, rnd, cx, w, zf, out, style):
    """Glazing in bays, a fascia with the shop's name, goods in the window."""
    gw = w - 1.0
    bays = max(2, round(gw / 1.1))
    bay_w = gw / bays
    front_face = 'front' if out > 0 else 'back'
    # the reveal behind the glazing, and a lit interior seen through it
    k.box(mats['reveal'], cx, 1.9, zf + out * 0.06, gw + 0.1, 2.24, 0.1)
    k.box(mats['interior'], cx, 1.9, zf + out * 0.13, gw - 0.1, 2.1, 0.02, faces={front_face})
    for m in range(bays):
        bx = cx - gw / 2 + bay_w * (m + 0.5)
        k.box(mats['glass'], bx, 1.72, zf + out * 0.17, bay_w - 0.1, 1.32, 0.01, uv='fit')
        k.box(mats['glass'], bx, 2.62, zf + out * 0.17, bay_w - 0.1, 0.26, 0.01, uv='fit')
    for m in range(1, bays):
        k.box(mats['woodwork'], cx - gw / 2 + bay_w * m, 1.9, zf + out * 0.18, 0.08, 2.14, 0.1)
    k.box(mats['woodwork'], cx - gw / 2, 1.9, zf + out * 0.18, 0.1, 2.28, 0.1)
    k.box(mats['woodwork'], cx + gw / 2, 1.9, zf + out * 0.18, 0.1, 2.28, 0.1)
    k.box(mats['woodwork'], cx, 2.43, zf + out * 0.145, gw, 0.09, 0.07)
    # goods in the window: boxes whose fronts are the game's own art
    boxes = art['boxes']
    for d in range(max(2, int(gw // 1.4))):
        pic = k.picture(f'goods-{rnd.randrange(len(boxes))}', boxes[rnd.randrange(len(boxes))], rough=0.55)
        k.box(pic, cx - gw / 2 + 0.6 + d * 1.4, 1.32, zf + out * 0.28, 0.32, 0.36, 0.14, uv='fit', uv_face=front_face)
    # fascia and stall riser
    k.box(mats['fascia'], cx, 3.06, zf + out * 0.20, gw + 0.3, 0.7, 0.28)
    sign = style.get('sign')
    if sign and sign in art.get('signs', {}):
        k.box(k.picture(f'sign-{sign}', art['signs'][sign], rough=0.5), cx, 3.06, zf + out * 0.345, gw - 0.2, 0.5, 0.01, uv='fit', uv_face=front_face)
    k.box(mats['fascia'], cx, 0.82, zf + out * 0.12, gw + 0.3, 0.24, 0.16)


def awning(k, mats, cx, w, face_z, out, colour):
    aw = w - 1.2
    mat = k.plain(f'awning-{colour}', colour, rough=0.9)
    # sloped: a box turned about x, which `box` cannot do — so a run of short
    # stepped boxes, each a little lower and a little further out
    n = 6
    for i in range(n):
        t = (i + 0.5) / n
        k.box(mat, cx, 3.52 - t * 0.28, face_z + out * (0.16 + t * 1.36), aw, 0.05, 1.5 / n + 0.02)
    for i in range(int(aw / 0.42)):
        k.box(mat, cx - aw / 2 + 0.21 + i * 0.42, 3.15, face_z + out * 1.56, 0.34, 0.22, 0.05)
    for sx in (-aw / 2 + 0.1, aw / 2 - 0.1):
        k.box(mats['iron'], cx + sx, 3.55, face_z + out * 0.8, 0.05, 0.05, 1.5)


def lamp_post(k, x, z, arm_toward, mats):
    """A street lamp from Poly Haven, with the pool of light below its head."""
    k.import_model('street_lamp_01', x, 0.14, z, rot_y=math.pi / 2 if arm_toward > 0 else -math.pi / 2)


def bench(k, mats, x, z, y=0.14):
    for i in range(4):
        k.box(mats['bench_wood'], x, y + 0.44, z - 0.24 + i * 0.16, 1.9, 0.06, 0.13, bevel=0.006)
    for i in range(3):
        k.box(mats['bench_wood'], x, y + 0.6 + i * 0.16, z + 0.3, 1.9, 0.13, 0.05, bevel=0.006)
    for sx in (-0.8, 0.8):
        k.box(mats['iron'], x + sx, y + 0.22, z - 0.2, 0.09, 0.44, 0.09)
        k.box(mats['iron'], x + sx, y + 0.22, z + 0.26, 0.09, 0.44, 0.09)
        k.box(mats['iron'], x + sx, y + 0.5, z + 0.05, 0.07, 0.07, 0.6)


def tree(k, art, x, y, z, height, key, rot_y=0.0, model='island_tree_02'):
    """A tree as a picture on two crossed planes — see `Kit.billboard`."""
    out = art['tree'] if model == 'island_tree_02' else os.path.join(os.path.dirname(art['tree']), f'billboard-{model}.png')
    png, aspect, _ = k.billboard(model, out)
    k.cutout(f'tree-{key}', png, x, y, z, height / aspect, height, rot_y=rot_y)


def planter(k, mats, art, x, z, y=0.14):
    k.box(mats['planter'], x, y + 0.35, z, 1.7, 0.7, 1.7, bevel=0.01)
    k.box(mats['soil'], x, y + 0.71, z, 1.5, 0.06, 1.5)
    tree(k, art, x, y + 0.7, z, 1.6, f'planter-{x}', rot_y=0.4)


def vending(k, mats, x, z, facing):
    """A vending machine against a wall, lit, facing the road."""
    k.box(mats['vending'], x, 1.09, z, 0.7, 1.9, 1.0, bevel=0.01)
    fx = x + facing * 0.36
    k.box(mats['vending_glass'], fx, 1.35, z, 0.02, 1.15, 0.78, faces={'right' if facing > 0 else 'left'})
    for i in range(8):
        col = ['#c04040', '#40a050', '#4060c0', '#c0b040'][i % 4]
        k.box(k.plain(f'can-{i % 4}', col, rough=0.4, metal=0.3), fx - facing * 0.04, 1.72 - (i // 4) * 0.4, z - 0.33 + (i % 4) * 0.22, 0.04, 0.22, 0.14)
    k.box(mats['vending_brand'], fx + facing * 0.02, 1.86, z, 0.04, 0.26, 0.84)


def post_box(k, mats, x, z, y=0.14):
    k.box(mats['post_red'], x, y + 0.75, z, 1.0, 1.5, 1.0, bevel=0.02)
    k.box(mats['iron'], x, y + 1.42, z - 0.5, 0.6, 0.1, 0.14)
    k.box(mats['post_red'], x, y + 1.56, z, 1.1, 0.12, 1.1, bevel=0.02)


def bin_(k, mats, x, z, y=0.14):
    k.box(mats['bin'], x, y + 0.45, z, 0.6, 0.9, 0.6, bevel=0.012)
    k.box(mats['bin_lid'], x, y + 0.94, z, 0.68, 0.08, 0.68, bevel=0.01)


def bollard(k, mats, x, z):
    k.box(mats['iron'], x, 0.45, z, 0.32, 0.9, 0.32, bevel=0.02)
    k.box(mats['bollard_cap'], x, 0.94, z, 0.38, 0.08, 0.38, bevel=0.01)


def hoarding(k, mats, art, rnd, faces, layout, z0, z1):
    """The west end: a hoarding round a building site, bills pasted on it,
    scaffolding behind, and the flank wall above."""
    west = faces['west']
    k.box(mats['hoarding'], west - 2.4, 1.8, (z0 + z1) / 2, 4, 3.6, z1 - z0)
    k.box(mats['brick'], west - 2.7, 4.58, (z0 + z1) / 2 - 0.15, 3.8, 9.16, z1 - z0 + 0.1)
    posters = art['posters'] + art['boxes']
    # on the open face only: the hoarding runs on behind the north terrace's end
    z = max(z0 + 0.9, faces['north'] + 0.7)
    i = 0
    while z < z1 - 0.9:
        pic = k.picture(f'bill-{i}', posters[rnd.randrange(len(posters))], rough=0.8)
        k.box(pic, west - 0.35, 1.5 + (i % 3) * 0.5, z, 0.05, 1.1, 0.8, uv='fit', uv_face='right')
        z += 1.2
        i += 1
    for j in range(int((z1 - z0) / 2)):
        k.box(mats['scaffold'], west - 1.2, 3 + 1.8, z0 + 1 + j * 2.0, 0.1, 6, 0.1)


def passage(k, mats, art, cx, face_z, out, w, sign_key, depth=8.0, head=5.0):
    """A way cut through a terrace: jambs, a head, the building over it."""
    for sx in (cx - w / 2, cx + w / 2):
        inward = 1 if sx < cx else -1
        k.box(mats['stone'], sx + inward * 0.25, head / 2, face_z - out * depth / 2, 0.5, head, depth)
    k.box(mats['stone'], cx, head + 0.5, face_z - out * depth / 2 - out * 0.1, w + 1.0, 1.0, depth - 0.2)
    k.box(mats['brick'], cx, head + 1.0 + 2.2, face_z - out * depth / 2, w + 1.4, 4.4, depth + 0.2)
    if sign_key in art.get('signs', {}):
        k.box(k.picture(f'sign-{sign_key}', art['signs'][sign_key], rough=0.5), cx, head + 0.5, face_z + out * 0.02, 2.2, 2.2 / 5.6, 0.02, uv='fit', uv_face='front' if out > 0 else 'back')
    # the soffit lining, so the passage has a ceiling
    k.box(mats['reveal'], cx, head - 0.04, face_z - out * depth / 2, w - 0.02, 0.06, depth - 0.1, faces={'bottom'})


def build_street(k, layout, dressing, art, mats):
    rnd = random.Random(dressing.get('seed', 7))
    faces = _faces(layout)
    north, south, west, east = faces['north'], faces['south'], faces['west'], faces['east']
    b = layout['bounds']
    ground(k, layout, faces, mats)

    # the terraces, building by building, from the dressing's rows
    for row in dressing['terraces']:
        face_z = faces[row['face']]
        out = 1 if row['face'] == 'north' else -1
        for bd in row['buildings']:
            depth = bd.get('depth', 7.7 + rnd.random() * 0.6)
            building(k, mats, art, rnd, bd['x'], bd['w'], face_z, out, bd['h'], depth, bd)
        for pw in row.get('party_walls', []):
            k.box(mats['brick'], (pw[0] + pw[1]) / 2, (pw[2] - 0.05) / 2, face_z - out * (0.3 + 3.5), pw[1] - pw[0], pw[2] - 0.05, 7.0)

    # the shop's own frontage, over the door the interior shares
    shop = dressing['shop']
    zf = north + 0.06
    sx, sw = shop['x'], shop['w']
    k.box(mats['shop_skin'], sx, 4.5, north - 4, sw, 9.0, 8)
    k.box(mats['cornice'], sx, 9.16, north - 4, sw + 0.34, 0.32, 8.34)
    k.box(mats['parapet'], sx, 9.6, north - 4, sw + 0.1, 0.8, 8.1)
    # the flat over the shop: two floors of windows, Grandpa's rooms
    for f, y in enumerate((5.0, 7.5)):
        k.box(mats['stone'], sx, y - 1.25, zf + 0.04, sw - 0.4, 0.08, 0.08)
        for c in range(5):
            wx = sx - sw / 2 + sw / 5 * (c + 0.5)
            _window(k, mats, wx, y, zf, 1, lit=(c + f) % 3 != 1, curtains=(c % 2 == 0))
    # a poster case on the blank half of the frontage, right of the door
    px = shop['door']['x'] + 3.4
    k.box(mats['frame'], px, 1.85, zf + 0.04, 2.3, 1.7, 0.08)
    k.box(mats['reveal'], px, 1.85, zf + 0.06, 2.14, 1.54, 0.06)
    for i, ox in enumerate((-0.52, 0.52)):
        pic = k.picture(f'case-poster-{i}', art['posters'][i % len(art['posters'])], rough=0.5)
        k.box(pic, px + ox, 1.85, zf + 0.1, 0.92, 1.3, 0.01, uv='fit', uv_face='front')
    k.box(mats['glass'], px, 1.85, zf + 0.12, 2.14, 1.54, 0.006, uv='fit')
    door = shop['door']
    k.box(mats['reveal'], door['x'], door['h'] / 2, zf + 0.0, door['w'] + 0.2, door['h'] + 0.1, 0.16)
    k.box(mats['door'], door['x'], door['h'] / 2 - 0.02, zf + 0.06, door['w'] - 0.1, door['h'] - 0.08, 0.06, uv='fit', uv_face='front')
    k.box(mats['glass'], door['x'], 1.72, zf + 0.1, door['w'] - 0.5, 0.8, 0.01, uv='fit')
    k.box(mats['frame'], door['x'], door['h'] + 0.07, zf + 0.06, door['w'] + 0.2, 0.12, 0.2)
    k.box(k.picture('open-sign-out', art['sign_open'], rough=0.5), door['x'] + 0.18, 1.86, zf + 0.115, 0.36, 0.2, 0.01, uv='fit', uv_face='front')
    win = shop['window']
    wcx, ww, sill, top = win['x'], win['w'], win['sill'], win['top']
    wh = top - sill
    k.box(mats['reveal'], wcx, (sill + top) / 2, zf, ww + 0.16, wh + 0.16, 0.12)
    k.box(mats['interior'], wcx, (sill + top) / 2, zf + 0.07, ww - 0.1, wh - 0.1, 0.02, faces={'front'})
    k.box(mats['glass'], wcx, (sill + top) / 2, zf + 0.09, ww - 0.16, wh - 0.16, 0.01, uv='fit')
    for mx in (-ww / 6, ww / 6):
        k.box(mats['frame'], wcx + mx, (sill + top) / 2, zf + 0.1, 0.07, wh - 0.16, 0.06)
    k.box(mats['frame'], wcx, sill + wh * 0.68, zf + 0.125, ww - 0.16, 0.06, 0.06)
    for ex in (-ww / 2 + 0.04, ww / 2 - 0.04):
        k.box(mats['frame'], wcx + ex, (sill + top) / 2, zf + 0.1, 0.08, wh, 0.12)
    k.box(mats['frame'], wcx, top - 0.04, zf + 0.1, ww, 0.08, 0.12)
    k.box(mats['sill'], wcx, sill + 0.025, zf + 0.12, ww + 0.24, 0.05, 0.22, bevel=0.006)
    k.box(k.picture('kame-sign-out', art['sign_kame'], rough=0.4), wcx, sill + wh * 0.68 + (top - (sill + wh * 0.68)) / 2 - 0.02, zf + 0.102, ww * 0.7, 0.26, 0.004, uv='fit', uv_face='front')
    boxes = art['boxes']
    for i in range(5):
        pic = k.picture(f'shopwin-{i}', boxes[(i * 5) % len(boxes)], rough=0.55)
        k.box(pic, wcx - 0.9 + i * 0.45, sill + 0.2 + (i % 2) * 0.16, zf + 0.02 + 0.09, 0.3, 0.34, 0.2, uv='fit', uv_face='front')
    # fascia, its name, and the turtle hanging at right angles
    fw = sw - 0.9
    k.box(mats['shop_fascia'], sx, 3.42, zf + 0.08, sw - 0.5, 1.45, 0.22)
    k.box(k.picture('fascia-kame', art['signs']['kame-fascia'], rough=0.5), sx, 3.42, zf + 0.2, fw, 1.15, 0.02, uv='fit', uv_face='front')
    k.box(mats['iron'], sx + 2.4, 3.9, north + 0.5, 0.1, 0.1, 0.9)
    k.box(mats['shop_fascia'], sx + 2.4, 3.42, north + 0.9, 0.72, 0.62, 0.1, rot_y=math.pi / 2)
    k.box(k.plain('turtle', '#5f8a5a', rough=0.6), sx + 2.4, 3.46, north + 0.9, 0.46, 0.3, 0.12, rot_y=math.pi / 2)
    # the step, drawn from the platform the collision declares
    for p in layout['platforms']:
        if p['hw'] < 3:
            k.box(mats['step'], p['x'], p['y'] / 2, p['z'], p['hw'] * 2, p['y'], p['hd'] * 2, faces={'top', 'front', 'left', 'right'})

    # the ends
    ends = dressing['ends']
    hoarding(k, mats, art, rnd, faces, layout, -(b['hd'] + 1), ends['alley']['z0'])
    k.box(mats['brick'], west - 2.1, 4.67, (ends['alley']['z1'] + b['hd'] + 1) / 2, 3.8, 9.34, b['hd'] + 1 - ends['alley']['z1'])
    # the alley up to Step Lane, cut through the wall at the west end
    al = ends['alley']
    amid = (al['z0'] + al['z1']) / 2
    for az in (al['z0'], al['z1']):
        inward = 1 if az == al['z0'] else -1
        k.box(mats['stone'], west - 1.7, 2.3, az + inward * 0.25, 3.4, 4.6, 0.5)
    k.box(mats['stone'], west - 1.7, 5.15, amid, 3.4, 1.1, al['z1'] - al['z0'] + 1.0)
    k.box(mats['brick'], west - 2.2, 7.6, amid, 3.7, 3.8, al['z1'] - al['z0'] + 1.0)
    k.box(k.picture('sign-steplane', art['signs']['steplane'], rough=0.5), west + 0.02, 5.15, amid, 0.02, 2.0 / 5.4, 2.0, uv='fit', uv_face='right')
    k.box(mats['iron'], west - 0.7, 4.32, amid, 0.28, 0.3, 0.28)
    k.box(mats['bulb'], west - 0.7, 4.11, amid, 0.24, 0.02, 0.24, faces={'bottom'})
    # what you see through it: the bottom of the lane
    k.slab(mats['concrete'], west - 11, 0.006, amid, 14, al['z1'] - al['z0'], face='top')
    for az in (al['z0'] - 0.32, al['z1'] + 0.32):
        k.box(mats['concrete'], west - 10, 3.5, az, 11.2, 7, 0.6)
    for i in range(9):
        y = 0.18 * (i + 1)
        k.box(mats['tread'], west - 3.4 - i * 0.5, y / 2, amid, 0.5, y, al['z1'] - al['z0'] - 0.04)
    k.box(mats['iron'], west - 4.2, 2.6, al['z0'] + 0.15, 0.2, 0.34, 0.34)
    k.box(mats['bulb'], west - 4.2, 2.6, al['z0'] + 0.34, 0.24, 0.4, 0.24)
    k.box(mats['concrete'], west - 15, 4, amid, 2, 8, al['z1'] - al['z0'] + 1.4)

    # the arch into Market Row at the east end
    ar = ends['arch']
    # 4.4 wide from the inner face, not 4: at 4 the outer face was the last
    # terrace's own end face, and the two flickered over sixty square metres
    k.box(mats['brick'], east + 2.2, 4.72, (-(b['hd'] + 1) + ar['z0']) / 2, 4.4, 9.44, ar['z0'] + b['hd'] + 1)
    k.box(mats['brick'], east + 2.2, 4.72, (ar['z1'] + b['hd'] + 1) / 2, 4.4, 9.44, b['hd'] + 1 - ar['z1'])
    amid2 = (ar['z0'] + ar['z1']) / 2
    aw = ar['z1'] - ar['z0']
    k.box(mats['brick'], east + 2.2, 7.95, amid2, 4.4, 3.1, aw)
    k.box(mats['reveal'], east + 2, 3.2, ar['z0'] + 0.04, 4.02, 6.4, 0.06)
    k.box(mats['reveal'], east + 2, 3.2, ar['z1'] - 0.04, 4.02, 6.4, 0.06)
    k.box(mats['reveal'], east + 2, 6.37, amid2, 4.02, 0.06, aw - 0.08, faces={'bottom'})
    for pz in (ar['z0'] - 0.55, ar['z1'] + 0.55):
        k.box(mats['stone'], east, 2.8, pz + (0.04 if pz > amid2 else -0.04), 1.5, 5.6, 1.1)
        k.box(mats['cornice'], east, 5.72, pz, 1.7, 0.24, 1.3)
    k.box(mats['stone'], east, 5.93, amid2, 1.42, 0.86, aw + 2.12)
    k.box(mats['cornice'], east, 6.56, amid2, 1.8, 0.26, aw + 2.6)
    k.box(k.picture('sign-market', art['signs']['market'], rough=0.5), east - 0.78, 6.05, amid2, 0.02, 0.82, 5.4, uv='fit', uv_face='left')
    # the arcade beyond, converging into the fog
    k.slab(mats['arcade_floor'], east + 4.4 + 15, 0.006, amid2, 30, aw, face='top')
    for az, side in ((ar['z0'] - 0.34, 1), (ar['z1'] + 0.34, -1)):
        k.box(mats['render'], east + 4.4 + 15, 3.5, az, 30, 7, 0.6)
        for i in range(6):
            xx = east + 5 + i * 4.6
            k.box(mats['pane_lit'], xx, 1.6, az + side * 0.31, 2.6, 2.0, 0.02, faces={'front' if side > 0 else 'back'})
            k.box(mats['woodwork'], xx, 2.75, az + side * 0.34, 3.0, 0.3, 0.08)
    k.box(mats['canopy'], east + 4.4 + 15, 6.6, amid2, 29.8, 0.2, aw + 1.2)
    k.box(mats['render'], east + 4.4 + 30.5, 4, amid2, 1, 8, aw + 2)

    # the passage up to the shrine, through the south terrace
    sh = ends['shrine']
    smid = (sh['x0'] + sh['x1']) / 2
    sw2 = sh['x1'] - sh['x0']
    passage(k, mats, art, smid, south, -1, sw2, 'shrine')
    k.slab(mats['paving'], smid, 0.006, south + 11, sw2, 22, face='top')
    for sx2 in (sh['x0'] - 0.6, sh['x1'] + 0.6):
        k.box(mats['stone'], sx2, 3.5, south + 13, 0.8, 7, 14)
    for i in range(9):
        y = 0.18 * (i + 1)
        k.box(mats['tread'], smid, y / 2, south + 14.5 + i * 0.5, sw2, y, 0.5)
    for s2 in (-1, 1):
        k.box(mats['torii'], smid + s2 * 1.9, 3.9, south + 19.4, 0.42, 4.4, 0.42)
    k.box(mats['torii'], smid, 5.94, south + 19.4, 5.4, 0.38, 0.66)
    k.box(mats['torii_dark'], smid, 6.24, south + 19.4, 5.8, 0.18, 0.38)
    k.box(mats['torii'], smid, 5.0, south + 19.4, 4.4, 0.26, 0.46)
    k.box(mats['brick'], smid, 4.5, south + 22, sw2 + 2, 9, 2)
    tree(k, art, smid - 2.5, 5.0, south + 21.3, 5.5, 'shrine-a', rot_y=0.4)
    tree(k, art, smid + 2.8, 5.4, south + 21.6, 5.0, 'shrine-b', rot_y=1.3)

    # furniture, to the small solids that name what they are
    for s in layout['solids']:
        d = s.get('draw')
        if d == 'lamp':
            lamp_post(k, s['x'], s['z'], 1 if s['z'] < 0 else -1, mats)
        elif d == 'bench':
            bench(k, mats, s['x'], s['z'])
        elif d == 'planter':
            planter(k, mats, art, s['x'], s['z'])
        elif d == 'vending':
            vending(k, mats, s['x'], s['z'], -1)
        elif d == 'postbox':
            post_box(k, mats, s['x'], s['z'])
        elif d == 'bin':
            bin_(k, mats, s['x'], s['z'])
        elif d == 'bollard':
            bollard(k, mats, s['x'], s['z'])
        elif d == 'pier':
            # the arch's own column stands on this solid (see `build_street`);
            # a plinth drawn inside it shared every face with it
            pass
        elif d == 'hydrant':
            k.import_model('fire_hydrant', s['x'], 0.14, s['z'])
    # manhole covers in the road, flat, walked over
    for mx, mz in dressing.get('manholes', []):
        # the model is a seven-centimetre disc; a cover is flush with the road
        k.import_model('water_manhole_cover', mx, -0.062, mz, base='floor')
    return faces
