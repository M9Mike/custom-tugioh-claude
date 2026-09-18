"""
The kit an area is built with, in Blender.

Run headless by `scripts/world/build.mjs`:

    blender -b --factory-startup --python scripts/blender/world/build.py -- ...

Everything here is about three rules the rest of the toolchain depends on.

**Game coordinates in, game coordinates out.** The game is Y-up with x across
and z towards the camera; Blender is Z-up. Every number a caller hands this
file is a game number, `G()` turns it into a Blender vector on the way in, and
the exporter's `export_yup` turns it back on the way out — so a box asked for
at game (2.6, 1.0, 5.5) is at (2.6, 1.0, 5.5) in the loaded GLB, and the
`parts` written for the checks are written in game metres directly, never
converted.

**Textures are sized in metres.** Every face this kit makes carries UVs that
are the face's own world coordinates in metres, and every Poly Haven material
scales those by the size the texture was photographed at. So a floor and a
counter top made of the same boards show boards of the same width, however
big either of them is, which is the law in `CLAUDE.md` and the thing a
`PlaneGeometry` with 0–1 UVs got wrong three areas running.

**A merge says what it is made of.** Boxes of one material are built into one
mesh, and that mesh records every box that went into it as
`[minX, minY, minZ, maxX, maxY, maxZ, turned]` in game metres — the
`BakedPart` of `world/kit.ts`, read by `footing`, `walls`, `embedded` and
`coplanar` — as a JSON string in the object's custom properties, which the
exporter writes as glTF extras and the loader hands to `bakedFrom`.
"""

import json
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector


def G(x, y, z):
    """A game point (x across, y up, z towards the camera) as a Blender vector."""
    return Vector((x, -z, y))


def clear_scene():
    """The factory scene has a cube, a light and a camera in it. Not ours."""
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
        for item in list(coll):
            if item.users == 0:
                coll.remove(item)


def hex_rgb(colour):
    """'#c9a227' → (r, g, b) in linear light, which is what a node wants."""
    s = colour.lstrip('#')
    srgb = [int(s[i:i + 2], 16) / 255 for i in (0, 2, 4)]

    def lin(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    return tuple(lin(c) for c in srgb)


class Kit:
    """One area's worth of geometry, materials and the record of what was baked."""

    def __init__(self, assets_dir, art_dir, texture_sizes):
        self.assets = assets_dir
        self.art = art_dir
        self.texture_sizes = texture_sizes
        self.materials = {}
        # material name → (bmesh, parts, uses_metres)
        self.bakes = {}
        self.props = []
        self.collection = bpy.data.collections.new('area')
        bpy.context.scene.collection.children.link(self.collection)

    # ------------------------------------------------------------ materials

    def _gltf_occlusion_group(self):
        """The node group the glTF exporter reads occlusion from, made once."""
        name = 'glTF Material Output'
        ng = bpy.data.node_groups.get(name)
        if ng:
            return ng
        ng = bpy.data.node_groups.new(name, 'ShaderNodeTree')
        ng.interface.new_socket(name='Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
        ng.nodes.new('NodeGroupInput')
        return ng

    def pbr(self, key, tex_id, tint=None, rough=1.0, normal=1.0, size=None, ao=True, blend='MULTIPLY'):
        """
        A Principled material from a Poly Haven texture set, tiled in metres.

        `tint` multiplies the photograph, which can only darken it — right for
        taking the red out of a floor, wrong for a panel that has to read
        lighter than its frame. `blend='OVERLAY'` lightens with a light tint
        and darkens with a dark one, which is what a stain does.
        """
        name = f'{tex_id}:{key}'
        if name in self.materials:
            return self.materials[name]
        size_m = size or self.texture_sizes.get(tex_id, 1.0)
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        # Single-sided, which the exporter writes as `doubleSided: false` and
        # three.js draws as FrontSide: half the fragments on a phone. Every
        # wall this kit builds is a box with an outside, so nothing needs
        # its back face.
        mat.use_backface_culling = True
        nt = mat.node_tree
        nodes, links = nt.nodes, nt.links
        bsdf = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
        texco = nodes.new('ShaderNodeTexCoord')
        mapping = nodes.new('ShaderNodeMapping')
        mapping.inputs['Scale'].default_value = (1.0 / size_m, 1.0 / size_m, 1.0)
        links.new(texco.outputs['UV'], mapping.inputs['Vector'])

        def image(map_name, colorspace):
            path = os.path.join(self.assets, tex_id, f'{map_name}.jpg')
            if not os.path.exists(path):
                return None
            im = bpy.data.images.load(path, check_existing=True)
            im.colorspace_settings.name = colorspace
            n = nodes.new('ShaderNodeTexImage')
            n.image = im
            links.new(mapping.outputs['Vector'], n.inputs['Vector'])
            return n

        diffuse = image('Diffuse', 'sRGB')
        if diffuse is not None:
            if tint:
                mix = nodes.new('ShaderNodeMix')
                mix.data_type = 'RGBA'
                mix.blend_type = blend
                mix.inputs['Factor'].default_value = 1.0
                links.new(diffuse.outputs['Color'], mix.inputs[6])
                mix.inputs[7].default_value = (*hex_rgb(tint), 1.0)
                links.new(mix.outputs[2], bsdf.inputs['Base Color'])
            else:
                links.new(diffuse.outputs['Color'], bsdf.inputs['Base Color'])
        nor = image('nor_gl', 'Non-Color')
        if nor is not None:
            nm = nodes.new('ShaderNodeNormalMap')
            nm.inputs['Strength'].default_value = normal
            links.new(nor.outputs['Color'], nm.inputs['Color'])
            links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
        arm = image('arm', 'Non-Color')
        if arm is not None:
            sep = nodes.new('ShaderNodeSeparateColor')
            links.new(arm.outputs['Color'], sep.inputs['Color'])
            if rough != 1.0:
                mul = nodes.new('ShaderNodeMath')
                mul.operation = 'MULTIPLY'
                mul.inputs[1].default_value = rough
                links.new(sep.outputs['Green'], mul.inputs[0])
                links.new(mul.outputs['Value'], bsdf.inputs['Roughness'])
            else:
                links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
            # Never metallic. Three.js without an environment map draws a metal
            # as black with a highlight, and the exporter packed this channel
            # as a metallicFactor of one — the whole street came out black
            # under the sun. Poly Haven's surfaces here are all dielectric.
            bsdf.inputs['Metallic'].default_value = 0.0
            if ao:
                grp = nodes.new('ShaderNodeGroup')
                grp.node_tree = self._gltf_occlusion_group()
                links.new(sep.outputs['Red'], grp.inputs['Occlusion'])
        else:
            bsdf.inputs['Roughness'].default_value = rough
        self.materials[name] = mat
        return mat

    def plain(self, key, colour, rough=0.85, metal=0.0, emissive=None, emissive_strength=1.0, alpha=None):
        """A flat material: a coat of paint, brass, glass, a bulb."""
        name = f'plain:{key}'
        if name in self.materials:
            return self.materials[name]
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        mat.use_backface_culling = alpha is None
        bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        bsdf.inputs['Base Color'].default_value = (*hex_rgb(colour), 1.0)
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Metallic'].default_value = metal
        if emissive:
            bsdf.inputs['Emission Color'].default_value = (*hex_rgb(emissive), 1.0)
            bsdf.inputs['Emission Strength'].default_value = emissive_strength
        if alpha is not None:
            bsdf.inputs['Alpha'].default_value = alpha
            mat.surface_render_method = 'BLENDED'
        self.materials[name] = mat
        return mat

    def picture(self, key, path, rough=0.6, emissive=None, emissive_strength=1.0, cutout=False):
        """
        An image on a surface — a poster, a box front, a sign. UVs run 0–1.
        `cutout` uses the image's alpha as a mask, which the exporter writes as
        `alphaMode: MASK` — a tree on two crossed planes is this.
        """
        name = f'picture:{key}'
        if name in self.materials:
            return self.materials[name]
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        mat.use_backface_culling = True
        nt = mat.node_tree
        bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
        im = bpy.data.images.load(path, check_existing=True)
        im.colorspace_settings.name = 'sRGB'
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = im
        tex.extension = 'EXTEND'
        nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        if cutout:
            nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
            try:
                mat.blend_method = 'CLIP'
                mat.alpha_threshold = 0.5
            except (AttributeError, TypeError):
                pass
            mat.surface_render_method = 'DITHERED'
        bsdf.inputs['Roughness'].default_value = rough
        if emissive:
            nt.links.new(tex.outputs['Color'], bsdf.inputs['Emission Color'])
            bsdf.inputs['Emission Strength'].default_value = emissive_strength
        self.materials[name] = mat
        return mat

    # ------------------------------------------------------------- geometry

    def _bake_for(self, mat):
        if mat.name not in self.bakes:
            bm = bmesh.new()
            bm.loops.layers.uv.new('UVMap')
            self.bakes[mat.name] = (bm, [])
        return self.bakes[mat.name]

    def box(self, mat, cx, cy, cz, w, h, d, rot_y=0.0, bevel=0.0, uv='metres', uv_face=None, turned=None, faces=None, flip=False, rot_x=0.0, rot_z=0.0):
        """
        A box of `mat`, centred on game (cx, cy, cz), `w` across, `h` tall, `d`
        deep, turned `rot_y` radians about its own vertical axis.

        `uv='metres'` writes each face's world coordinates as its UVs, which is
        what a tiled material wants. `uv='fit'` stretches 0–1 over every face,
        which is what a picture wants; `uv_face` then names the one face that
        gets the picture ('front' is +z in game terms, towards the camera) and
        the rest are folded to the picture's edge pixel.

        `faces`, if given, is the set of faces to keep — a floor is a box you
        only ever see the top of, and a wall's outer face is never seen.
        """
        bm, parts = self._bake_for(mat)
        uv_layer = bm.loops.layers.uv.verify()
        hw, hh, hd = w / 2, h / 2, d / 2
        local = [
            Vector((-hw, -hh, -hd)), Vector((hw, -hh, -hd)), Vector((hw, hh, -hd)), Vector((-hw, hh, -hd)),
            Vector((-hw, -hh, hd)), Vector((hw, -hh, hd)), Vector((hw, hh, hd)), Vector((-hw, hh, hd)),
        ]
        # game-space corner positions: rolled about z, tilted about x, turned about y, moved
        c, s = math.cos(rot_y), math.sin(rot_y)
        cx_, sx_ = math.cos(rot_x), math.sin(rot_x)
        cz_, sz_ = math.cos(rot_z), math.sin(rot_z)
        world = []
        for v in local:
            x0 = v.x * cz_ - v.y * sz_
            y0 = v.x * sz_ + v.y * cz_
            y1 = y0 * cx_ - v.z * sx_
            z1 = y0 * sx_ + v.z * cx_
            x = x0 * c + z1 * s
            z = -x0 * s + z1 * c
            world.append((cx + x, cy + y1, cz + z))
        fresh = bmesh.new()
        fresh_uv = fresh.loops.layers.uv.verify()
        verts = [fresh.verts.new(G(*p)) for p in world]
        # a picture is fitted in the box's own frame: a turned billboard read
        # its u off world x and smeared the picture down one column
        local_of = {v: local[i] for i, v in enumerate(verts)}
        # faces named in game terms; winding keeps normals outward
        face_index = {
            'back': (0, 3, 2, 1),    # -z (away from the camera)
            'front': (4, 5, 6, 7),   # +z
            'left': (0, 4, 7, 3),    # -x
            'right': (1, 2, 6, 5),   # +x
            'bottom': (0, 1, 5, 4),  # -y
            'top': (3, 7, 6, 2),     # +y
        }
        for fname, idx in face_index.items():
            if faces is not None and fname not in faces:
                continue
            f = fresh.faces.new([verts[i] for i in idx])
            f.smooth = False
            for loop in f.loops:
                p = loop.vert.co  # blender coords: (x, -z, y)
                gx, gy, gz = p.x, p.z, -p.y
                if uv == 'fit':
                    if uv_face is None or fname == uv_face or (uv_face == 'front' and fname == 'back' and faces == {'front', 'back'}):
                        # picture across the face: u along its width, v up, in
                        # the box's own frame whichever way it is turned
                        lv = local_of[loop.vert]
                        lx, ly, lz = lv.x, lv.y, lv.z
                        if fname in ('front', 'back'):
                            u = (lx + hw) / w if fname == 'front' else (hw - lx) / w
                            v = (ly + hh) / h
                        elif fname in ('left', 'right'):
                            # seen from -x the viewer's right is +z; from +x it is -z.
                            # The first cut had these the other way and every sign
                            # on a side face read backwards.
                            u = (lz + hd) / d if fname == 'left' else (hd - lz) / d
                            v = (ly + hh) / h
                        else:
                            u = (lx + hw) / w
                            v = (lz + hd) / d
                        if flip:
                            u = 1.0 - u
                        loop[fresh_uv].uv = (min(max(u, 0.0), 1.0), min(max(v, 0.0), 1.0))
                    else:
                        loop[fresh_uv].uv = (0.0, 0.0)
                else:
                    if fname in ('front', 'back'):
                        loop[fresh_uv].uv = (gx, gy)
                    elif fname in ('left', 'right'):
                        loop[fresh_uv].uv = (gz, gy)
                    else:
                        loop[fresh_uv].uv = (gx, gz)
        if bevel > 0:
            bmesh.ops.bevel(fresh, geom=list(fresh.edges), offset=bevel, segments=2, profile=0.7, affect='EDGES')
        # append into the material's bake. A fresh vertex carries index -1
        # until the table is renumbered — without this every un-bevelled box
        # mapped to one vertex and its faces were dropped without a word.
        fresh.verts.index_update()
        fresh.faces.index_update()
        vmap = {}
        for v in fresh.verts:
            vmap[v.index] = bm.verts.new(v.co)
        for f in fresh.faces:
            nf = bm.faces.new([vmap[v.index] for v in f.verts])
            nf.smooth = f.smooth
            for src, dst in zip(f.loops, nf.loops):
                dst[uv_layer].uv = src[fresh_uv].uv
        fresh.free()
        # the part, as an axis-aligned box in game metres
        xs = [p[0] for p in world]
        ys = [p[1] for p in world]
        zs = [p[2] for p in world]
        is_turned = 1 if (turned if turned is not None else (abs(math.sin(rot_y)) > 1e-6 or abs(math.sin(rot_x)) > 1e-6 or abs(math.sin(rot_z)) > 1e-6)) else 0
        parts.append([round(min(xs), 4), round(min(ys), 4), round(min(zs), 4),
                      round(max(xs), 4), round(max(ys), 4), round(max(zs), 4), is_turned])
        return parts[-1]

    def mesh(self, mat, pos, idx, uv=None, part=None, turned=0):
        """
        Triangles already in game metres, appended to `mat`'s bake — how a
        captured builder's geometry comes in (`scripts/world/capture.ts`).

        `pos` is a flat list of x, y, z; `idx` indexes triangles into it. With
        `uv=None` every face gets its world coordinates in metres, projected
        along its normal's biggest axis, which is what a tiled material wants
        and what `box()` writes; a list of u, v per vertex is used as given,
        which is what a picture wants. `part`, if given, is the box the checks
        should see for this mesh, `[minx, miny, minz, maxx, maxy, maxz]`;
        otherwise nothing is recorded and the caller records what it knows.
        """
        bm, parts = self._bake_for(mat)
        uv_layer = bm.loops.layers.uv.verify()
        verts = []
        for i in range(0, len(pos), 3):
            verts.append(bm.verts.new(G(pos[i], pos[i + 1], pos[i + 2])))
        made = 0
        for i in range(0, len(idx), 3):
            a, b, c = idx[i], idx[i + 1], idx[i + 2]
            if a == b or b == c or a == c:
                continue
            try:
                f = bm.faces.new((verts[a], verts[b], verts[c]))
            except ValueError:
                continue  # a duplicate face; the old builders drew a few
            made += 1
            f.smooth = False
            # a face fresh from bmesh has no normal until the mesh is told to
            # work them out; with (0, 0, 0) every wall projected like a floor
            # and the textures ran down the stone in streaks
            f.normal_update()
            n = f.normal
            for loop, vi in zip(f.loops, (a, b, c)):
                if uv is not None and len(uv) >= (vi + 1) * 2:
                    loop[uv_layer].uv = (uv[vi * 2], uv[vi * 2 + 1])
                else:
                    gx, gz, gy = pos[vi * 3], -pos[vi * 3 + 2], pos[vi * 3 + 1]
                    # blender-space normal: x, y(= -game z), z(= game y)
                    ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
                    if az >= ax and az >= ay:
                        loop[uv_layer].uv = (gx, -gz)
                    elif ax >= ay:
                        loop[uv_layer].uv = (-gz if n.x > 0 else gz, gy)
                    else:
                        loop[uv_layer].uv = (gx if n.y < 0 else -gx, gy)
        if part is not None:
            parts.append([round(part[0], 4), round(part[1], 4), round(part[2], 4), round(part[3], 4), round(part[4], 4), round(part[5], 4), int(turned)])
        return made

    def slab(self, mat, cx, cy, cz, w, d, face='top', uv='metres', **kw):
        """A single face — a floor, a ceiling, a rug. Its part is the face too:
        a centimetre of thickness gave every floor a second, downward face a
        few millimetres under whatever stood on it, and `coplanar` read that
        as a pair with the thing's own underside."""
        keep = {face}
        part = self.box(mat, cx, cy - (0.005 if face == 'top' else -0.005), cz, w, 0.01, d, faces=keep, uv=uv, **kw)
        part[1] = part[4] = round(cy, 4)
        return part

    # ------------------------------------------------------------ billboards

    def billboard(self, model_id, out_png, size_px=1024):
        """
        A model rendered to a picture with a transparent background, seen
        square-on from the side, cached at `out_png`. Returns (path, aspect)
        where aspect is height over width in the picture's metres. What a
        background tree should be: four triangles instead of three hundred
        thousand.
        """
        note = out_png + '.json'
        if os.path.exists(out_png) and os.path.exists(note):
            kept = json.load(open(note))
            return out_png, kept['aspect'], tuple(kept['size'])
        size = self.sized(model_id)  # (across, up, deep) in metres
        aspect = size[1] / max(size[0], 1e-6)
        if os.path.exists(out_png):
            json.dump({'aspect': aspect, 'size': list(size)}, open(note, 'w'))
            return out_png, aspect, size
        # a scene of its own, rendered, then torn down
        before = set(bpy.data.objects)
        path = os.path.join(self.assets, model_id, f'{model_id}.gltf')
        bpy.ops.import_scene.gltf(filepath=path)
        imported = [o for o in bpy.data.objects if o not in before]
        scene = bpy.context.scene
        cam_data = bpy.data.cameras.new('billboard')
        cam_data.type = 'ORTHO'
        cam_data.ortho_scale = max(size[0], size[1]) * 1.04
        cam = bpy.data.objects.new('billboard', cam_data)
        scene.collection.objects.link(cam)
        # the model stands with its base on z=0 in Blender terms after import? No:
        # measure and look at its middle, from far along -Y (the game's +z)
        lo = Vector((1e9, 1e9, 1e9))
        hi = Vector((-1e9, -1e9, -1e9))
        for o in imported:
            if o.type != 'MESH':
                continue
            for corner in o.bound_box:
                pt = o.matrix_world @ Vector(corner)
                lo = Vector((min(lo.x, pt.x), min(lo.y, pt.y), min(lo.z, pt.z)))
                hi = Vector((max(hi.x, pt.x), max(hi.y, pt.y), max(hi.z, pt.z)))
        mid = (lo + hi) / 2
        cam.location = Vector((mid.x, lo.y - max(size) * 3, mid.z))
        cam.rotation_euler = (math.pi / 2, 0.0, 0.0)
        old_cam = scene.camera
        scene.camera = cam
        sun = bpy.data.lights.new('billboard-sun', 'SUN')
        sun.energy = 3.0
        sun_o = bpy.data.objects.new('billboard-sun', sun)
        sun_o.rotation_euler = (math.radians(50), 0.0, math.radians(20))
        scene.collection.objects.link(sun_o)
        world = scene.world or bpy.data.worlds.new('World')
        scene.world = world
        world.use_nodes = True
        bg = next(n for n in world.node_tree.nodes if n.type == 'BACKGROUND')
        bg.inputs['Color'].default_value = (0.6, 0.65, 0.7, 1.0)
        bg.inputs['Strength'].default_value = 0.6
        engines = [e.identifier for e in scene.render.bl_rna.properties['engine'].enum_items]
        scene.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in engines else engines[0]
        scene.render.film_transparent = True
        w = size_px if aspect <= 1 else int(size_px / aspect)
        h = size_px if aspect >= 1 else int(size_px * aspect)
        scene.render.resolution_x = w
        scene.render.resolution_y = h
        scene.render.resolution_percentage = 100
        scene.render.image_settings.file_format = 'PNG'
        scene.render.image_settings.color_mode = 'RGBA'
        scene.render.filepath = out_png
        bpy.ops.render.render(write_still=True)
        for o in imported + [cam, sun_o]:
            bpy.data.objects.remove(o, do_unlink=True)
        scene.camera = old_cam
        scene.render.film_transparent = False
        json.dump({'aspect': aspect, 'size': list(size)}, open(note, 'w'))
        return out_png, aspect, size

    def cutout(self, key, png_path, x, y, z, width, height, rot_y=0.0):
        """Two crossed vertical planes carrying a cutout picture, base at y.
        One material per picture, whatever the key: a hundred trees of one
        kind bake into one mesh, not a hundred."""
        mat = self.picture(f'cutout:{os.path.basename(png_path)}', png_path, rough=0.9, cutout=True)
        for turn in (0.0, math.pi / 2):
            self.box(mat, x, y + height / 2, z, width, height, 0.002, rot_y=rot_y + turn, uv='fit', uv_face='front', turned=1, faces={'front', 'back'})

    # ---------------------------------------------------------------- props

    def import_model(self, model_id, x, y, z, rot_y=0.0, scale=1.0, base='floor', name=None):
        """
        A Poly Haven model, stood at game (x, y, z), turned `rot_y` radians and
        scaled. `base='floor'` puts the bottom of the model on y; `base='centre'`
        puts its centre there; `base='top'` hangs it from y.
        """
        path = os.path.join(self.assets, model_id, f'{model_id}.gltf')
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=path)
        imported = [o for o in bpy.data.objects if o not in before]
        meshes = [o for o in imported if o.type == 'MESH']
        if not meshes:
            raise RuntimeError(f'{model_id}: nothing imported')
        root = bpy.data.objects.new(name or model_id, None)
        self.collection.objects.link(root)
        for o in imported:
            if o.parent is None:
                o.parent = root
            for c in list(o.users_collection):
                c.objects.unlink(o)
            self.collection.objects.link(o)
        bpy.context.view_layer.update()
        # one mesh per prop: a model that arrives as a lid and a body is two
        # boxes to the checks, sharing every face where they meet
        if len(meshes) > 1:
            gone = set(meshes[1:])
            imported = [o for o in imported if o not in gone]
            bpy.ops.object.select_all(action='DESELECT')
            for o in meshes:
                o.select_set(True)
            bpy.context.view_layer.objects.active = meshes[0]
            bpy.ops.object.join()
            meshes = [meshes[0]]
            bpy.context.view_layer.update()
        lo = Vector((1e9, 1e9, 1e9))
        hi = Vector((-1e9, -1e9, -1e9))
        for o in meshes:
            for corner in o.bound_box:
                p = o.matrix_world @ Vector(corner)
                lo = Vector((min(lo.x, p.x), min(lo.y, p.y), min(lo.z, p.z)))
                hi = Vector((max(hi.x, p.x), max(hi.y, p.y), max(hi.z, p.z)))
        centre = (lo + hi) / 2
        if base == 'floor':
            anchor = Vector((centre.x, centre.y, lo.z))
        elif base == 'top':
            anchor = Vector((centre.x, centre.y, hi.z))
        else:
            anchor = centre
        # Blender rotation about Z; game rot_y turns the same way about up
        rot = Matrix.Rotation(rot_y, 4, 'Z')
        root.matrix_world = Matrix.Translation(G(x, y, z)) @ rot @ Matrix.Scale(scale, 4) @ Matrix.Translation(-anchor)
        bpy.context.view_layer.update()
        size = (hi - lo) * scale
        self.props.append({'model': model_id, 'at': [x, y, z], 'size': [round(size.x, 3), round(size.z, 3), round(size.y, 3)]})
        return root, size

    def sized(self, model_id):
        """The model's extent before placing it, in game metres (across, up, deep)."""
        if not hasattr(self, '_sizes'):
            self._sizes = {}
        if model_id in self._sizes:
            return self._sizes[model_id]
        self._sizes[model_id] = self._measure(model_id)
        return self._sizes[model_id]

    def _measure(self, model_id):
        path = os.path.join(self.assets, model_id, f'{model_id}.gltf')
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=path)
        imported = [o for o in bpy.data.objects if o not in before]
        lo = Vector((1e9, 1e9, 1e9))
        hi = Vector((-1e9, -1e9, -1e9))
        for o in imported:
            if o.type != 'MESH':
                continue
            for corner in o.bound_box:
                p = o.matrix_world @ Vector(corner)
                lo = Vector((min(lo.x, p.x), min(lo.y, p.y), min(lo.z, p.z)))
                hi = Vector((max(hi.x, p.x), max(hi.y, p.y), max(hi.z, p.z)))
        for o in imported:
            bpy.data.objects.remove(o, do_unlink=True)
        d = hi - lo
        return (d.x, d.z, d.y)

    # --------------------------------------------------------------- finish

    def realise(self):
        """Every bake becomes one object, carrying the boxes it was made of."""
        made = []
        for mat_name, (bm, parts) in self.bakes.items():
            if not bm.faces:
                bm.free()
                continue
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
            mesh = bpy.data.meshes.new(f'bake:{mat_name}')
            bm.to_mesh(mesh)
            bm.free()
            mesh.materials.append(bpy.data.materials[mat_name])
            obj = bpy.data.objects.new(f'bake:{mat_name}', mesh)
            obj['parts'] = json.dumps(parts, separators=(',', ':'))
            self.collection.objects.link(obj)
            made.append(obj)
        self.bakes = {}
        return made

    def export(self, out_path, extras):
        scene = bpy.context.scene
        for k, v in extras.items():
            scene[k] = v
        bpy.ops.object.select_all(action='DESELECT')
        bpy.ops.export_scene.gltf(
            filepath=out_path,
            export_format='GLB',
            export_apply=True,
            export_extras=True,
            export_yup=True,
            export_image_format='AUTO',
            export_jpeg_quality=88,
            export_texcoords=True,
            export_normals=True,
            export_tangents=False,
            export_materials='EXPORT',
            export_lights=False,
            export_animations=False,
            use_visible=True,
        )

    def render(self, out_path, eye, look, lamps, width=1280, height=800):
        """A quick look at the room in Blender's own renderer, for iterating."""
        scene = bpy.context.scene
        cam_data = bpy.data.cameras.new('look')
        cam_data.lens = 24
        cam = bpy.data.objects.new('look', cam_data)
        scene.collection.objects.link(cam)
        cam.location = G(*eye)
        direction = G(*look) - cam.location
        cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
        scene.camera = cam
        for i, (x, y, z, colour, watts) in enumerate(lamps):
            ld = bpy.data.lights.new(f'lamp{i}', 'POINT')
            ld.energy = watts
            ld.color = hex_rgb(colour)
            ld.shadow_soft_size = 0.15
            lo = bpy.data.objects.new(f'lamp{i}', ld)
            lo.location = G(x, y, z)
            scene.collection.objects.link(lo)
        world = scene.world or bpy.data.worlds.new('World')
        scene.world = world
        world.use_nodes = True
        bg = next(n for n in world.node_tree.nodes if n.type == 'BACKGROUND')
        bg.inputs['Color'].default_value = (0.35, 0.33, 0.30, 1.0)
        bg.inputs['Strength'].default_value = 0.35
        engines = [e.identifier for e in scene.render.bl_rna.properties['engine'].enum_items]
        scene.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in engines else engines[0]
        scene.render.resolution_x = width
        scene.render.resolution_y = height
        scene.render.resolution_percentage = 100
        scene.render.image_settings.file_format = 'PNG'
        scene.render.filepath = out_path
        bpy.ops.render.render(write_still=True)
