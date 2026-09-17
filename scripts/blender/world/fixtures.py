"""
The things a room is made of, built to the collision.

Every function here takes game metres and builds through `Kit`, so the
`parts` the checks read come out of the same numbers the geometry did. A
fixture that is *stood in* — a counter, a run of shelving, a display case —
is built to the footprint of the solid that stops the player, never to a
second copy of it; the dressing file says what it looks like and the layout
says where it is and how big.
"""

import math
import random

from kit import G


# ------------------------------------------------------------------ the room

def interior_of(layout):
    """
    The rectangle inside the walls, from the tall solids that are the walls.

    An interior's walls are a metre thick and centred just outside the room, so
    the inner face of each is the solid's centre less its half-thickness. The
    bounds cannot say this — they are held half a metre inside the walls on
    purpose — so it is derived, and a room whose walls move takes its floor and
    ceiling with them.
    """
    b = layout['bounds']
    walls = [s for s in layout['solids'] if s.get('tall')]
    left = max((s['x'] + s['hw'] for s in walls if s['x'] + s['hw'] <= b['x'] - b['hw'] + 1e-6), default=b['x'] - b['hw'])
    right = min((s['x'] - s['hw'] for s in walls if s['x'] - s['hw'] >= b['x'] + b['hw'] - 1e-6), default=b['x'] + b['hw'])
    back = max((s['z'] + s['hd'] for s in walls if s['z'] + s['hd'] <= b['z'] - b['hd'] + 1e-6), default=b['z'] - b['hd'])
    front = min((s['z'] - s['hd'] for s in walls if s['z'] - s['hd'] >= b['z'] + b['hd'] - 1e-6), default=b['z'] + b['hd'])
    return {'x0': left, 'x1': right, 'z0': back, 'z1': front,
            'cx': (left + right) / 2, 'cz': (back + front) / 2, 'w': right - left, 'd': front - back}


def _segments(lo, hi, holes):
    """The stretches of [lo, hi] left once each (a, b) hole is cut out of it."""
    out = []
    at = lo
    for a, b in sorted(holes):
        if a > at:
            out.append((at, a))
        at = max(at, b)
    if hi > at:
        out.append((at, hi))
    return out


def shell(k, layout, room, height, mats, openings, thick=0.3):
    """
    Floor, ceiling and the four walls, with the openings cut where the doors
    and windows are.

    The walls are drawn `thick` deep from their inner face inwards-out — the
    collision is a metre thick so nobody can get behind them, but a metre-deep
    window reveal reads as a castle. Their inner faces are exactly the
    solids' inner faces, which is the law: the drawn thing is the colliding
    thing.
    """
    x0, x1, z0, z1 = room['x0'], room['x1'], room['z0'], room['z1']
    k.slab(mats['floor'], room['cx'], 0.0, room['cz'], room['w'], room['d'], face='top')
    k.slab(mats['ceiling'], room['cx'], height, room['cz'], room['w'], room['d'], face='bottom')
    by_wall = {'south': [], 'north': [], 'west': [], 'east': []}
    for o in openings:
        by_wall[o['wall']].append(o)

    def wall(side):
        """One wall as boxes: full-height pieces between openings, and the
        pieces over and under each opening."""
        holes = []
        for o in by_wall[side]:
            a = o['x'] - o['w'] / 2 if side in ('south', 'north') else o['z'] - o['w'] / 2
            holes.append((a, a + o['w']))
        along0, along1 = (x0, x1) if side in ('south', 'north') else (z0, z1)
        # A grid, not pieces: every opening's edges are columns of the whole
        # wall and every sill and head a row of it, and a cell is skipped
        # where it is an opening. Cut as separate pieces, the full-height
        # piece beside a window met the piece over it at a T-junction, and a
        # T-junction rasterises as a hairline crack up the wall.
        cols = sorted({along0, along1, *(edge for a, b in holes for edge in (a, b))})
        rows = {0.0, height}
        for o in by_wall[side]:
            rows.add(o.get('sill', 0.0))
            rows.add(o.get('top', o.get('h', height)))
        rows = sorted(r for r in rows if 0.0 <= r <= height)
        opening_cells = []
        for o in by_wall[side]:
            a = (o['x'] if side in ('south', 'north') else o['z']) - o['w'] / 2
            opening_cells.append((a, a + o['w'], o.get('sill', 0.0), o.get('top', o.get('h', height))))
        pieces = []
        for ci in range(len(cols) - 1):
            for ri in range(len(rows) - 1):
                a, b, y0, y1 = cols[ci], cols[ci + 1], rows[ri], rows[ri + 1]
                mid_a, mid_y = (a + b) / 2, (y0 + y1) / 2
                if any(oa <= mid_a <= ob and oy0 <= mid_y <= oy1 for oa, ob, oy0, oy1 in opening_cells):
                    continue
                pieces.append((a, b, y0, y1))
        for a, b, y0, y1 in pieces:
            length = b - a
            mid = (a + b) / 2
            cy = (y0 + y1) / 2
            h = y1 - y0
            # every face, including the one that looks at the street: a camera
            # that slips outside must see a wall, not a lit room floating in
            # black (see `shop.ts`'s note on double-sided walls, which this
            # honours with an outside instead)
            if side == 'south':
                k.box(mats['wall'], mid, cy, z1 + thick / 2, length, h, thick)
            elif side == 'north':
                k.box(mats['wall'], mid, cy, z0 - thick / 2, length, h, thick)
            elif side == 'west':
                k.box(mats['wall'], x0 - thick / 2, cy, mid, thick, h, length)
            else:
                k.box(mats['wall'], x1 + thick / 2, cy, mid, thick, h, length)
        # the reveals: the sides of each opening, so a door is a hole in a wall
        # and not a hole in a sheet of paper
        for o in by_wall[side]:
            a = (o['x'] if side in ('south', 'north') else o['z']) - o['w'] / 2
            b = a + o['w']
            y0 = o.get('sill', 0.0)
            y1 = o.get('top', o.get('h', height))
            cy = (y0 + y1) / 2
            h = y1 - y0
            for edge in (a, b):
                if side == 'south':
                    k.box(mats['wall'], edge, cy, z1 + thick / 2, 0.02, h, thick, faces={'left', 'right'})
                elif side == 'north':
                    k.box(mats['wall'], edge, cy, z0 - thick / 2, 0.02, h, thick, faces={'left', 'right'})
                elif side == 'west':
                    k.box(mats['wall'], x0 - thick / 2, cy, edge, thick, h, 0.02, faces={'front', 'back'})
                else:
                    k.box(mats['wall'], x1 + thick / 2, cy, edge, thick, h, 0.02, faces={'front', 'back'})
            # head and sill faces of the opening
            length = b - a
            mid = (a + b) / 2
            for yy, face_up in ((y1, False), (y0, True)):
                if yy <= 0.0 or yy >= height:
                    continue
                if side in ('south', 'north'):
                    zc = z1 + thick / 2 if side == 'south' else z0 - thick / 2
                    k.box(mats['wall'], mid, yy, zc, length, 0.02, thick, faces={'top' if face_up else 'bottom'})
                else:
                    xc = x0 - thick / 2 if side == 'west' else x1 + thick / 2
                    k.box(mats['wall'], xc, yy, mid, thick, 0.02, length, faces={'top' if face_up else 'bottom'})

    for side in ('south', 'north', 'west', 'east'):
        wall(side)


def trims(k, room, height, mats, openings, skirting=0.16, dado=1.02, wainscot=True, cornice=0.12):
    """
    Skirting, wainscot, dado rail, picture rail and cornice around the room,
    broken across the doors. Each stands a few millimetres proud of the wall
    it runs along — flush is a flicker.
    """
    x0, x1, z0, z1 = room['x0'], room['x1'], room['z0'], room['z1']
    gap = 0.004
    doors = [o for o in openings if o.get('kind') == 'door']

    def run(side, y0, y1, proud, mat, breaks, inset=0.0):
        """A strip along one wall, from y0 to y1, `proud` of the wall face."""
        holes = [((o['x'] if side in ('south', 'north') else o['z']) - o['w'] / 2 - 0.02,
                  (o['x'] if side in ('south', 'north') else o['z']) + o['w'] / 2 + 0.02)
                 for o in breaks if o['wall'] == side]
        along0, along1 = (x0 + inset, x1 - inset) if side in ('south', 'north') else (z0 + inset, z1 - inset)
        cy = (y0 + y1) / 2
        h = y1 - y0
        for a, b in _segments(along0, along1, holes):
            mid = (a + b) / 2
            length = b - a
            if side == 'south':
                k.box(mat, mid, cy, z1 - gap - proud / 2, length, h, proud, faces={'back', 'top', 'bottom', 'left', 'right'})
            elif side == 'north':
                k.box(mat, mid, cy, z0 + gap + proud / 2, length, h, proud, faces={'front', 'top', 'bottom', 'left', 'right'})
            elif side == 'west':
                k.box(mat, x0 + gap + proud / 2, cy, mid, proud, h, length, faces={'right', 'top', 'bottom', 'front', 'back'})
            else:
                k.box(mat, x1 - gap - proud / 2, cy, mid, proud, h, length, faces={'left', 'top', 'bottom', 'front', 'back'})

    # each band is inset a little more than the one below it, so their end
    # faces never share a plane where two walls meet
    for i, side in enumerate(('south', 'north', 'west', 'east')):
        run(side, 0.0, skirting, 0.03, mats['trim'], doors, inset=0.045 if side in ('west', 'east') else 0.0)
        if wainscot:
            run(side, skirting + 0.002, dado - 0.03, 0.012, mats['wainscot'], doors + [o for o in openings if o.get('kind') == 'window' and o['sill'] < dado],
                inset=0.06 if side in ('west', 'east') else 0.015)
        run(side, dado - 0.03, dado + 0.03, 0.026, mats['trim'],
            doors + [o for o in openings if o.get('kind') == 'window' and o['sill'] < dado + 0.05],
            inset=0.075 if side in ('west', 'east') else 0.03)
        run(side, height - cornice, height - 0.004, 0.06, mats['trim'], [], inset=0.09 if side in ('west', 'east') else 0.045)
        run(side, 2.42, 2.46, 0.018, mats['trim'], [o for o in openings if o.get('top', o.get('h', 0)) > 2.4],
            inset=0.105 if side in ('west', 'east') else 0.06)


# --------------------------------------------------------------- openings

def door_set(k, room, o, mats, art, thick=0.3):
    """
    A shop door in the south wall: frame, a panelled leaf with a pane in its
    top half, a brass handle and kick plate, and the OPEN card on the glass.
    """
    x, w, h = o['x'], o['w'], o['h']
    z_face = room['z1']
    zc = z_face + thick * 0.45
    frame, leaf = mats['frame'], mats['door']
    # the surround, set into the reveal
    k.box(frame, x - w / 2 + 0.05, h / 2, zc, 0.1, h, 0.14)
    k.box(frame, x + w / 2 - 0.05, h / 2, zc, 0.1, h, 0.14)
    k.box(frame, x, h - 0.05, zc, w, 0.1, 0.14)
    # the leaf, a hair inside the frame
    lw, lh, lt = w - 0.2, h - 0.1, 0.045
    ly = lh / 2
    lz = zc + 0.005
    k.box(leaf, x, ly, lz, lw, lh, lt, bevel=0.004)
    # two recessed panels below the pane, drawn proud so they read as panels
    for py in (0.42, 1.0):
        k.box(mats['door_panel'], x, py, lz - lt / 2 - 0.006, lw - 0.24, 0.42, 0.012)
        k.box(mats['door_panel'], x, py, lz + lt / 2 + 0.006, lw - 0.24, 0.42, 0.012)
    # the pane, cut through the leaf: drawn as glass sitting in the leaf's plane
    k.box(mats['glass'], x, 1.72, lz, lw - 0.3, 0.8, 0.006, uv='fit')
    k.box(frame, x, 1.72 - 0.42, lz, lw - 0.24, 0.04, lt + 0.012)
    k.box(frame, x, 1.72 + 0.42, lz, lw - 0.24, 0.04, lt + 0.012)
    # brass: a lever handle on the inside, and a kick plate
    k.box(mats['brass'], x - lw / 2 + 0.16, 1.04, lz - lt / 2 - 0.04, 0.14, 0.022, 0.022, bevel=0.004)
    k.box(mats['brass'], x - lw / 2 + 0.1, 1.04, lz - lt / 2 - 0.02, 0.02, 0.06, 0.04)
    k.box(mats['brass'], x, 0.17, lz - lt / 2 - 0.004, lw - 0.16, 0.22, 0.004)
    # the OPEN card, hung on the pane, facing the street (its back to us)
    k.box(k.picture('open-sign', art['sign_open']), x + 0.18, 1.86, lz - lt / 2 - 0.012, 0.36, 0.2, 0.01, uv='fit', uv_face='back')


def window_set(k, room, o, mats, art, thick=0.3):
    """The shopfront window: sill, surround, mullions, transom, glass."""
    x, w, sill, top = o['x'], o['w'], o['sill'], o['top']
    z_face = room['z1']
    zc = z_face + thick * 0.5
    frame = mats['frame']
    h = top - sill
    cy = (sill + top) / 2
    # sill board, proud into the room
    k.box(mats['sill'], x, sill + 0.025, z_face - 0.04, w + 0.24, 0.05, 0.2, bevel=0.006)
    # surround
    k.box(frame, x - w / 2 + 0.04, cy, zc, 0.08, h, 0.12)
    k.box(frame, x + w / 2 - 0.04, cy, zc, 0.08, h, 0.12)
    k.box(frame, x, top - 0.04, zc, w, 0.08, 0.12)
    k.box(frame, x, sill + 0.06, zc, w, 0.08, 0.12)
    # three lights, a transom two thirds of the way up
    for fx in (x - w / 6, x + w / 6):
        k.box(frame, fx, cy, zc, 0.06, h, 0.1)
    ty = sill + h * 0.68
    k.box(frame, x, ty, zc, w - 0.16, 0.06, 0.1)
    k.box(mats['glass'], x, cy, zc, w - 0.16, h - 0.16, 0.006, uv='fit')
    # the shop's name, painted on the glass and read from the street
    # painted on the inside of the glass to be read from the street, so from
    # in here it reads backwards, as a shop's own name does
    k.box(k.picture('kame-sign', art['sign_kame'], rough=0.4), x, ty + (top - ty) / 2 - 0.02, zc - 0.012, w * 0.7, 0.26, 0.004, uv='fit', uv_face='back', flip=True)


# ------------------------------------------------------------- furniture

def counter(k, solid, mats, art, top_h=0.9):
    """
    The counter Grandpa works behind, to the footprint of the solid that stops
    you walking through it: a panelled body, an overhanging top with a brass
    nosing, and a glass case let into its left end.
    """
    cx, cz, hw, hd = solid['x'], solid['z'], solid['hw'], solid['hd']
    w, d = hw * 2, hd * 2
    body_h = top_h - 0.05
    bw, bd = w - 0.2, d - 0.16
    k.box(mats['counter_body'], cx, body_h / 2, cz, bw, body_h, bd)
    # a panelled front: rails top and bottom, stiles between, and the recessed
    # panels a lighter wood behind them — joinery, not a block with stripes
    front = cz + bd / 2
    n = 4
    stile, rail = 0.09, 0.1
    k.box(mats['counter_body'], cx, body_h - rail / 2 - 0.01, front + 0.02, bw, rail, 0.04, bevel=0.004)
    k.box(mats['counter_body'], cx, 0.11 + rail / 2, front + 0.02, bw, rail, 0.04, bevel=0.004)
    for i in range(n + 1):
        sx = cx - bw / 2 + stile / 2 + i * (bw - stile) / n
        k.box(mats['counter_body'], sx, body_h / 2 + 0.05, front + 0.02, stile, body_h - 0.11 - 0.02, 0.04, bevel=0.004)
    for i in range(n):
        px = cx - bw / 2 + stile + (bw - stile) / n * i + ((bw - stile) / n - stile) / 2
        pw = (bw - stile) / n - stile
        # the panel sits back in its frame, with a raised field in the middle
        k.box(mats['counter_panel'], px, body_h / 2 + 0.05, front + 0.004, pw + 0.01, body_h - 0.11 - 0.02 - rail * 2 + 0.02, 0.008)
        k.box(mats['counter_panel'], px, body_h / 2 + 0.05, front + 0.012, pw - 0.1, body_h - 0.11 - 0.02 - rail * 2 - 0.1, 0.012, bevel=0.005)
    # kick plate, a shade darker
    k.box(mats['trim'], cx, 0.055, front + 0.006, bw, 0.11, 0.012)
    # the top, overhanging all round
    k.box(mats['counter_top'], cx, top_h - 0.035, cz, w, 0.07, d, bevel=0.008)
    k.box(mats['brass'], cx, top_h - 0.06, cz + d / 2 - 0.006, w - 0.02, 0.028, 0.012)
    # the glass case let into the left end of the top
    case_w = min(2.0, w * 0.28)
    case_x = cx - w / 2 + 0.35 + case_w / 2
    case_y0 = top_h
    k.box(mats['brass'], case_x, case_y0 + 0.006, cz, case_w + 0.04, 0.012, d - 0.24)
    k.box(mats['glass'], case_x, case_y0 + 0.16, cz, case_w, 0.3, d - 0.28, uv='fit')
    for ex in (-1, 1):
        k.box(mats['brass'], case_x + ex * case_w / 2, case_y0 + 0.16, cz, 0.014, 0.3, d - 0.28)
    k.box(mats['brass'], case_x, case_y0 + 0.31, cz, case_w + 0.03, 0.012, d - 0.26)
    # the good cards, standing on little easels inside
    cards = art['cards']
    ncards = 5
    for i in range(ncards):
        fx = case_x - case_w / 2 + case_w / ncards * (i + 0.5)
        pic = k.picture(f'case-card-{i}', cards[i % len(cards)], rough=0.5)
        k.box(mats['trim'], fx, case_y0 + 0.02, cz - 0.02, 0.03, 0.04, 0.05, rot_y=0.0)
        k.box(pic, fx, case_y0 + 0.075, cz - 0.03, 0.06, 0.086, 0.002, uv='fit', uv_face='front', turned=1)
    # a box of singles, near the case
    sx = cx + w * 0.1
    k.box(mats['singles'], sx, top_h + 0.08, cz + 0.08, 0.6, 0.16, 0.38, bevel=0.003)
    for i in range(9):
        k.box(k.picture(f'single-{i}', cards[(i * 3) % len(cards)], rough=0.55), sx - 0.24 + i * 0.06, top_h + 0.17, cz + 0.08, 0.05, 0.07, 0.003, uv='fit', uv_face='front', turned=1)
    # a mug
    k.box(mats['mug'], cx + w * 0.34, top_h + 0.05, cz - 0.28, 0.09, 0.1, 0.09, bevel=0.01)


def display_case(k, solid, mats, art):
    """A glass display cabinet by the window: a dark base and a glazed top."""
    cx, cz, hw, hd = solid['x'], solid['z'], solid['hw'], solid['hd']
    w, d = hw * 2, hd * 2
    base_h = 0.86
    k.box(mats['counter_body'], cx, base_h / 2, cz, w - 0.04, base_h, d - 0.04, bevel=0.004)
    k.box(mats['counter_top'], cx, base_h + 0.02, cz, w, 0.04, d, bevel=0.005)
    top_h = 0.5
    k.box(mats['glass'], cx, base_h + 0.04 + top_h / 2, cz, w - 0.06, top_h, d - 0.06, uv='fit')
    for ex in (-1, 1):
        for ez in (-1, 1):
            k.box(mats['brass'], cx + ex * (w - 0.06) / 2, base_h + 0.04 + top_h / 2, cz + ez * (d - 0.06) / 2, 0.014, top_h, 0.014)
    k.box(mats['brass'], cx, base_h + 0.04 + top_h + 0.006, cz, w - 0.04, 0.012, d - 0.04)
    # a glass shelf halfway up, with cards on both levels
    k.box(mats['glass'], cx, base_h + 0.04 + top_h * 0.5, cz, w - 0.1, 0.006, d - 0.1, uv='fit')
    cards = art['cards']
    for level, y in ((0, base_h + 0.04), (1, base_h + 0.04 + top_h * 0.5 + 0.003)):
        for i in range(3):
            fx = cx - w / 2 + 0.2 + i * (w - 0.4) / 2
            pic = k.picture(f'case2-{level}-{i}', cards[(level * 3 + i + 2) % len(cards)], rough=0.5)
            k.box(mats['trim'], fx, y + 0.015, cz, 0.03, 0.03, 0.05)
            k.box(pic, fx, y + 0.075, cz - 0.01, 0.062, 0.09, 0.002, uv='fit', uv_face='front', turned=1)


def shelf_run(k, solid, against, mats, art, seed=1):
    """
    Shop shelving to a solid's footprint, its back to the wall it stands
    against, stocked with boxed product whose fronts are the game's own card
    art. Units of at most 1.4 m fill the run; the stock is laid out by slot so
    no two boxes can land in one place.
    """
    rnd = random.Random(seed)
    cx, cz, hw, hd = solid['x'], solid['z'], solid['hw'], solid['hd']
    along = 'z' if hd > hw else 'x'
    length = (hd if along == 'z' else hw) * 2
    depth = (hw if along == 'z' else hd) * 2
    n = max(1, math.ceil(length / 1.4))
    unit_w = length / n
    height = 2.05
    side_t, board_t, back_t = 0.03, 0.028, 0.012
    # which way the front faces: into the room
    facing = {'left': 'right', 'right': 'left', 'back': 'front', 'front': 'back'}[against]
    boxes = art['boxes']
    tins = ['#3f566f', '#6b5f3c', '#47654f', '#5b3f5b', '#7d6840', '#7a4638']
    for u in range(n):
        u0 = (cz - hd if along == 'z' else cx - hw) + u * unit_w
        uc = u0 + unit_w / 2

        def place(mat, a, y, t, wa, h, wt, **kw):
            """A box at `a` along the run, `t` through it (0 at the wall), sized `wa` along, `h` tall, `wt` through."""
            if along == 'z':
                # against the west or east wall: through runs in x
                x = (cx - hw + t) if against == 'left' else (cx + hw - t)
                return k.box(mat, x, y, a, wt, h, wa, **kw)
            z = (cz - hd + t) if against == 'back' else (cz + hd - t)
            return k.box(mat, a, y, z, wa, h, wt, **kw)

        # carcass: back, two sides, top with a cornice, a kick base
        place(mats['shelf'], uc, height / 2, back_t / 2 + 0.004, unit_w, height, back_t)
        place(mats['shelf'], u0 + side_t / 2, height / 2, depth / 2, side_t, height, depth, bevel=0.003)
        place(mats['shelf'], u0 + unit_w - side_t / 2, height / 2, depth / 2, side_t, height, depth, bevel=0.003)
        place(mats['shelf'], uc, height - board_t / 2, depth / 2, unit_w, board_t, depth)
        place(mats['trim'], uc, height + 0.03, depth * 0.55, unit_w + 0.02, 0.06, depth * 0.1 + 0.02, bevel=0.004)
        place(mats['shelf'], uc, 0.05, depth / 2 - 0.03, unit_w - side_t * 2, 0.1, depth - 0.06)
        # four shelves and their stock
        for i in range(4):
            y = 0.32 + i * 0.44
            place(mats['shelf'], uc, y, depth / 2, unit_w - side_t * 2, board_t, depth - 0.004)
            place(mats['brass'], uc, y + 0.01, depth - 0.006, unit_w - side_t * 2 - 0.02, 0.022, 0.006)
            slots = max(3, int((unit_w - 0.12) / 0.19))
            pitch = (unit_w - 0.1) / slots
            for s in range(slots):
                if rnd.random() < 0.12:
                    continue  # a gap where something sold
                bw = pitch * rnd.uniform(0.66, 0.9)
                bh = rnd.uniform(0.17, 0.3)
                bd = depth * rnd.uniform(0.45, 0.62)
                a = u0 + 0.05 + pitch * (s + 0.5)
                if rnd.random() < 0.28:
                    place(k.plain(f'tin-{rnd.randrange(len(tins))}', tins[rnd.randrange(len(tins))], rough=0.45, metal=0.15),
                          a, y + board_t / 2 + bh * 0.42, depth / 2, bw * 0.7, bh * 0.85, bd * 0.6, bevel=0.006)
                    continue
                pic = k.picture(f'box-{rnd.randrange(len(boxes))}', boxes[rnd.randrange(len(boxes))], rough=0.55)
                # the front of the box faces the room
                place(pic, a, y + board_t / 2 + bh / 2, depth / 2 + (depth * 0.15), bw, bh, bd, uv='fit', uv_face=facing)


def box_stack(k, solid):
    """Cardboard boxes stacked in a corner, not quite squared up."""
    cx, cz = solid['x'], solid['z']
    _, s = k.import_model('cardboard_box_01', cx - 0.2, 0.0, cz + 0.12, rot_y=0.22, scale=1.0)
    k.import_model('cardboard_box_01', cx + 0.24, 0.0, cz - 0.16, rot_y=-0.35, scale=0.96)
    k.import_model('cardboard_box_01', cx + 0.02, s[1], cz - 0.02, rot_y=0.55, scale=0.92)


def pegboard(k, room, cx, cy, w, h, mats, art, seed=3):
    """
    A pegboard on the back wall with the display packs hanging in two rows —
    the big blister cards a shop hangs, not the loose boosters, which at
    twelve centimetres read as confetti from the door.
    """
    rnd = random.Random(seed)
    z = room['z0'] + 0.004 + 0.01
    k.box(mats['pegboard'], cx, cy, z, w, h, 0.02)
    # a frame round the board
    for ex in (-1, 1):
        k.box(mats['trim'], cx + ex * (w / 2 + 0.02), cy, z + 0.01, 0.04, h + 0.08, 0.04)
    for ey in (-1, 1):
        k.box(mats['trim'], cx, cy + ey * (h / 2 + 0.02), z + 0.01, w + 0.08, 0.04, 0.04)
    packs = art['packs']
    pw, ph = 0.3, 0.42
    cols = max(1, int((w - 0.2) / (pw + 0.16)))
    rows = 2
    for r in range(rows):
        py = cy + (h / 2 - 0.36) - r * (ph + 0.22)
        for c in range(cols):
            if rnd.random() < 0.07:
                continue
            px = cx - w / 2 + 0.1 + pw / 2 + c * ((w - 0.2 - pw) / max(1, cols - 1))
            k.box(mats['brass'], px, py + ph / 2 + 0.02, z + 0.03, 0.006, 0.006, 0.06)
            pic = k.picture(f'pack-{rnd.randrange(len(packs))}', packs[rnd.randrange(len(packs))], rough=0.35)
            k.box(pic, px, py, z + 0.05, pw, ph, 0.012, uv='fit', uv_face='front', rot_y=rnd.uniform(-0.03, 0.03), turned=1)


def poster(k, room, wall, along, y, w, h, art_path, mats, key, tilt=0.0):
    """A framed poster on a wall, `along` the wall's axis, its middle at `y`."""
    gap = 0.006
    frame = mats['frame']
    pic = k.picture(key, art_path, rough=0.55)
    fw = 0.03
    if wall == 'west':
        x = room['x0'] + gap
        k.box(pic, x + 0.008, y, along, 0.004, h, w, uv='fit', uv_face='right')
        k.box(frame, x + 0.012, y + h / 2 + fw / 2, along, 0.024, fw, w + fw * 2)
        k.box(frame, x + 0.012, y - h / 2 - fw / 2, along, 0.024, fw, w + fw * 2)
        k.box(frame, x + 0.012, y, along - w / 2 - fw / 2, 0.024, h, fw)
        k.box(frame, x + 0.012, y, along + w / 2 + fw / 2, 0.024, h, fw)
    elif wall == 'east':
        x = room['x1'] - gap
        k.box(pic, x - 0.008, y, along, 0.004, h, w, uv='fit', uv_face='left')
        k.box(frame, x - 0.012, y + h / 2 + fw / 2, along, 0.024, fw, w + fw * 2)
        k.box(frame, x - 0.012, y - h / 2 - fw / 2, along, 0.024, fw, w + fw * 2)
        k.box(frame, x - 0.012, y, along - w / 2 - fw / 2, 0.024, h, fw)
        k.box(frame, x - 0.012, y, along + w / 2 + fw / 2, 0.024, h, fw)
    elif wall == 'north':
        z = room['z0'] + gap
        k.box(pic, along, y, z + 0.008, w, h, 0.004, uv='fit', uv_face='front')
        k.box(frame, along, y + h / 2 + fw / 2, z + 0.012, w + fw * 2, fw, 0.024)
        k.box(frame, along, y - h / 2 - fw / 2, z + 0.012, w + fw * 2, fw, 0.024)
        k.box(frame, along - w / 2 - fw / 2, y, z + 0.012, fw, h, 0.024)
        k.box(frame, along + w / 2 + fw / 2, y, z + 0.012, fw, h, 0.024)
    else:
        z = room['z1'] - gap
        k.box(pic, along, y, z - 0.008, w, h, 0.004, uv='fit', uv_face='back')
        k.box(frame, along, y + h / 2 + fw / 2, z - 0.012, w + fw * 2, fw, 0.024)
        k.box(frame, along, y - h / 2 - fw / 2, z - 0.012, w + fw * 2, fw, 0.024)
        k.box(frame, along - w / 2 - fw / 2, y, z - 0.012, fw, h, 0.024)
        k.box(frame, along + w / 2 + fw / 2, y, z - 0.012, fw, h, 0.024)


def rug(k, cx, cz, w, d, mat):
    """Flat on the boards, a few millimetres up so it never fights the floor."""
    k.slab(mat, cx, 0.008, cz, w, d, face='top')


def pendant(k, lamp, ceiling, mats):
    """
    A hanging lamp: the fitting from Poly Haven, hung from the ceiling so its
    bulb sits where the light in the dressing says the light is, and a bulb
    that glows.
    """
    x, y, z = lamp['x'], lamp['y'], lamp['z']
    model = lamp.get('fixture', 'hanging_industrial_lamp')
    if not model:
        return  # a light whose fitting is a prop placed by the dressing
    size = k.sized(model)
    # the fitting's own height is its cord plus its shade: hang the top from the ceiling
    scale = min(1.0, (ceiling - y + 0.1) / size[1]) if size[1] > 0 else 1.0
    k.import_model(model, x, ceiling - 0.005, z, rot_y=lamp.get('rotY', 0.0), scale=scale, base='top', name=f'lamp:{x}:{z}')
    k.box(mats['bulb'], x, y, z, 0.08, 0.1, 0.08, bevel=0.03)


def backdrop(k, room, mats, art, height):
    """
    What is beyond the shopfront: pavement, road, and the terrace across the
    street, so a window is a window and not a hole into the sky. It is a
    painted backdrop and it stands nineteen metres off, where the fog takes
    it after dark.
    """
    z_face = room['z1']
    far = z_face + 19.0
    width = 60.0
    # ground: pavement then road
    k.slab(mats['pavement'], room['cx'], -0.02, z_face + 1.9, width, 3.8 + 0.6, face='top')
    k.slab(mats['road'], room['cx'], -0.03, z_face + 3.8 + (far - z_face - 3.8) / 2, width, far - z_face - 3.8 + 2, face='top')
    k.box(mats['pavement'], room['cx'], -0.09, z_face + 3.8, width, 0.14, 0.12)
    # the terrace opposite: brick, with lit windows and a sign band
    k.box(mats['brick'], room['cx'], height * 1.3, far + 0.5, width, height * 2.6, 1.0, faces={'back', 'top'})
    win = k.plain('far-window', '#2a2418', rough=0.3, emissive='#ffd28a', emissive_strength=2.2)
    dark = k.plain('far-window-dark', '#1b1c22', rough=0.25)
    n = int(width / 3.2)
    for i in range(n):
        wx = room['cx'] - width / 2 + 1.6 + i * 3.2
        for level, wy in ((0, 1.6), (1, 4.6), (2, 7.4)):
            lit = ((i * 7 + level * 3) % 5) != 0
            k.box(win if lit else dark, wx, wy, far - 0.01, 1.2, 1.5 if level else 2.2, 0.02, faces={'back'})
            k.box(mats['frame'], wx, wy + (0.85 if level else 1.2), far - 0.03, 1.36, 0.08, 0.08)
            k.box(mats['frame'], wx, wy - (0.85 if level else 1.2), far - 0.03, 1.36, 0.08, 0.08)
    k.box(mats['trim'], room['cx'], 3.2, far - 0.05, width, 0.3, 0.12)
    k.box(k.picture('far-sign', art['sign_far'], rough=0.6), room['cx'] + 4.0, 3.2, far - 0.14, 4.2, 0.6, 0.06, uv='fit', uv_face='back')
