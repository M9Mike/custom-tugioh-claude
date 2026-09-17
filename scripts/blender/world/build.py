"""
Builds one area of Domino City in Blender and exports it as a GLB.

    blender -b --factory-startup --python scripts/blender/world/build.py -- \
        --layout .cache/world/grandpa-shop.layout.json \
        --dressing data/world/grandpa-shop.dressing.json \
        --assets .cache/assets/polyhaven --art .cache/world/art \
        --sizes .cache/world/texture-sizes.json \
        --out .cache/world/grandpa-shop.raw.glb [--render look.png]

Driven by `scripts/world/build.mjs`, which writes the layout from `areas.ts`
and the pictures the room hangs, runs this, and compresses what comes out.
The layout is the collision truth and everything stood in is built to it;
the dressing is what it all looks like. The GLB carries the layout's hash so
`npm run world` can refuse a drawing that is older than its room.
"""

import argparse
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402

import arcade as ar  # noqa: E402
import fixtures as fx  # noqa: E402
import lane as ln  # noqa: E402
import shrine as sh  # noqa: E402
import port as pt  # noqa: E402
import street as st  # noqa: E402
from kit import Kit, clear_scene  # noqa: E402


def parse():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument('--layout', required=True)
    p.add_argument('--dressing', required=True)
    p.add_argument('--assets', required=True)
    p.add_argument('--art', required=True)
    p.add_argument('--sizes', required=True)
    p.add_argument('--out', required=True)
    p.add_argument('--render')
    p.add_argument('--capture', help='what scripts/world/capture.ts wrote, for the port recipe')
    return p.parse_args(argv)


def materials_for(k, dressing):
    """Every material the recipe reaches for, from the dressing's palette."""
    s = dressing['surfaces']
    m = {}
    for key, spec in s.items():
        if 'tex' in spec:
            m[key] = k.pbr(key, spec['tex'], tint=spec.get('tint'), rough=spec.get('rough', 1.0),
                           normal=spec.get('normal', 1.0), size=spec.get('size'), blend=spec.get('blend', 'MULTIPLY'))
        else:
            m[key] = k.plain(key, spec['colour'], rough=spec.get('rough', 0.85), metal=spec.get('metal', 0.0),
                             emissive=spec.get('emissive'), emissive_strength=spec.get('emissive_strength', 1.0),
                             alpha=spec.get('alpha'))
    return m


def build_shop(k, layout, dressing, art):
    height = dressing['height']
    room = fx.interior_of(layout)
    mats = materials_for(k, dressing)
    openings = []
    door_spec = dressing['door']
    for d in layout['doors']:
        openings.append({'kind': 'door', 'wall': 'south', 'x': d['seam']['x'], 'w': door_spec['w'], 'h': door_spec['h'], 'top': door_spec['h']})
    for w in dressing.get('windows', []):
        openings.append({'kind': 'window', **w})
    fx.shell(k, layout, room, height, mats, openings)
    fx.trims(k, room, height, mats, openings, dado=dressing.get('dado', 1.02), cornice=dressing.get('cornice', 0.12))
    for o in openings:
        if o['kind'] == 'door':
            fx.door_set(k, room, o, mats, art)
        else:
            fx.window_set(k, room, o, mats, art)
    by_draw = {}
    for s in layout['solids']:
        if s.get('draw'):
            by_draw.setdefault(s['draw'], []).append(s)
    for s in by_draw.get('counter', []):
        fx.counter(k, s, mats, art)
    for s in by_draw.get('case', []):
        fx.display_case(k, s, mats, art)
    for i, s in enumerate(by_draw.get('shelf', [])):
        against = 'left' if s['x'] < room['cx'] else 'right'
        fx.shelf_run(k, s, against, mats, art, seed=11 + i)
    for s in by_draw.get('boxes', []):
        fx.box_stack(k, s)
    for s in by_draw.get('crate', []):
        # a crate is longer than it is deep: turned to lie along the longer side of its footprint
        k.import_model('wooden_crate_01', s['x'], 0.0, s['z'], rot_y=0.0 if s['hw'] >= s['hd'] else math.pi / 2)
    for s in by_draw.get('stool', []):
        k.import_model('wooden_stool_01', s['x'], 0.0, s['z'], rot_y=0.4)
    for s in by_draw.get('chalkboard', []):
        k.import_model('standing_chalkboard_01', s['x'], 0.0, s['z'], rot_y=dressing.get('chalkboardRotY', 0.0))
    for p in dressing.get('pegboards', []):
        fx.pegboard(k, room, p['x'], p['y'], p['w'], p['h'], mats, art)
    for i, p in enumerate(dressing.get('posters', [])):
        fx.poster(k, room, p['wall'], p['along'], p['y'], p['w'], p['h'], art['posters'][p['art'] % len(art['posters'])], mats, key=f'poster-{i}')
    for r in dressing.get('rugs', []):
        fx.rug(k, r['x'], r['z'], r['w'], r['d'], mats['rug'])
    for lamp in dressing.get('lamps', []):
        fx.pendant(k, lamp, height, mats)
    for p in dressing.get('props', []):
        k.import_model(p['model'], p['x'], p.get('y', 0.0), p['z'], rot_y=p.get('rotY', 0.0), scale=p.get('scale', 1.0), base=p.get('base', 'floor'))
    fx.backdrop(k, room, mats, art, height)
    return room


def build_street(k, layout, dressing, art):
    mats = materials_for(k, dressing)
    st.build_street(k, layout, dressing, art, mats)
    b = layout['bounds']
    return {'cx': b['x'], 'cz': b['z']}


def build_arcade(k, layout, dressing, art):
    mats = materials_for(k, dressing)
    return ar.build_arcade(k, layout, dressing, art, mats)


def build_lane(k, layout, dressing, art):
    mats = materials_for(k, dressing)
    return ln.build_lane(k, layout, dressing, art, mats)


def build_shrine(k, layout, dressing, art):
    mats = materials_for(k, dressing)
    return sh.build_shrine(k, layout, dressing, art, mats)


def build_port(k, layout, dressing, art):
    mats = materials_for(k, dressing)
    capture = json.load(open(ARGS.capture))
    return pt.build_port(k, layout, dressing, art, mats, capture)


RECIPES = {'shop': build_shop, 'street': build_street, 'arcade': build_arcade, 'lane': build_lane, 'shrine': build_shrine, 'port': build_port}
ARGS = None


def main():
    global ARGS
    args = parse()
    ARGS = args
    layout = json.load(open(args.layout))
    dressing = json.load(open(args.dressing))
    art = json.load(open(os.path.join(args.art, 'index.json')))
    sizes = json.load(open(args.sizes))
    clear_scene()
    k = Kit(args.assets, args.art, sizes)
    recipe = RECIPES[dressing['recipe']]
    room = recipe(k, layout, dressing, art)
    made = k.realise()
    tris = sum(len(o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')
    print(f'• {layout["id"]}: {len(made)} bakes, {len(k.props)} props, {tris} faces')
    k.export(args.out, {'area': layout['id'], 'layoutHash': layout['hash'], 'recipe': dressing['recipe']})
    print(f'• wrote {args.out} ({os.path.getsize(args.out) // 1024} KB)')
    if args.render:
        look = dressing.get('look', {})
        eye = look.get('eye', [layout['spawn']['x'], 1.5, layout['spawn']['z']])
        at = look.get('at', [room['cx'], 1.0, room['cz']])
        lamps = [(l['x'], l['y'], l['z'], l.get('colour', '#ffd8a0'), l.get('watts', 60)) for l in dressing.get('lamps', [])]
        k.render(args.render, eye, at, lamps)
        print(f'• rendered {args.render}')


main()
