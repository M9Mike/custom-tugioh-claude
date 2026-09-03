/**
 * The Old Cemetery — the burial ground behind Domino Shrine.
 *
 * A hundred and twelve metres by a hundred and four, which makes it the largest
 * place in the city so far, and the plan gives it one job nothing else has
 * asked for: *dense small collision — hundreds of markers, not one of them
 * walkable.* Eight hundred and thirty-four stones stand in this ground.
 *
 * ## Two problems that number creates, and what answers them
 *
 * **Collision.** Eight hundred rectangles tested twice a frame is more work
 * than the whole rest of the city put together. `solidsNear` in `areas.ts`
 * files them on a four-metre grid and hands `settle` the two dozen that could
 * possibly matter. Every other area has too few solids to bother and skips it.
 *
 * **Draw calls.** Eight hundred meshes is eight hundred draw calls before a
 * single wall is built. They are merged instead: every stone of a kind becomes
 * one geometry, baked at its own position and turn, so the ground full of them
 * costs four calls rather than a thousand. Nothing in here moves, which is
 * exactly the condition that makes merging free.
 *
 * ## Why it is laid out and not scattered
 *
 * A burial ground is the most ordered piece of land a city owns, and the order
 * is what you read it by. Three terraces climbing north — the oldest ground is
 * always the highest — one avenue on the axis from the gate to the ossuary, and
 * four more paths crossing it. What is left between the paths is the plots, and
 * in the plots the stones stand in rows 2.8 m apart with 1.8 m between them:
 * close enough that a plot is a wall of stone seen from the side, open enough
 * that you can walk down any row of it. Dense in one direction and passable in
 * the other is what a cemetery actually is.
 *
 * The one grave with flowers on it is on the oldest ground, a little clear of
 * its row, where you meet it on the way to the ossuary and not before.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { turf, concrete, paving, darkWood } from './surfaces';
import {
  Owned, basePlate, box, matt, tiled, glow, surfaceOf, seeded, type BuiltArea,
} from './kit';
import { Sky, ownSky } from './sky';
import {
  AREAS, CM_MARKERS, CM_THINGS, CM_WALK, CM_WALKS, CM_MID, CM_HIGH, groundAt, type Marker,
} from '@/story/areas';

const AREA = AREAS['old-cemetery'];
const W = AREA.bounds.hw;
const D = AREA.bounds.hd;

/** How high the ground is at a point, which is the only source for it here. */
const at = (x: number, z: number) => groundAt(AREA, x, z);

export function buildCemetery(anisotropy: number): BuiltArea {
  const own = new Owned();
  const root = new THREE.Group();
  root.name = 'old-cemetery';
  const rnd = seeded(0xce3e7e);
  const lamps: THREE.PointLight[] = [];

  /* `turf`, and not `gravel`: gravel is the shrine's yard and draws twenty-six
     rake furrows, which over eleven thousand square metres tile into corduroy.
     The ground here read as decking. */
  const mossTex = surfaceOf(own, turf, 1, 1, anisotropy);
  /* Worn, not filthy: at 0.55 of dirt the avenue read darker than the grass
     beside it, which is the wrong way round for flagstones. */
  const pathTex = surfaceOf(own, () => paving({ dirt: 0.22, vary: 0.35 }), 1, 1, anisotropy);
  const wallTex = surfaceOf(own, () => concrete('#8c8779'), 1, 1, anisotropy);
  const stoneTex = surfaceOf(own, () => concrete('#9a958a'), 1, 1, anisotropy);

  /* White, because the colour is in the drawing: `turf` is already the green
     it should be, and a tint on top of it only takes light away. */
  const moss = () => tiled(matt(own, '#ffffff', mossTex), 3.2);
  const path = () => tiled(matt(own, '#c6bfa8', pathTex), 2);
  const wall = () => tiled(matt(own, '#ffffff', wallTex));
  const kerb = () => matt(own, '#8a8477');
  const woodTex = surfaceOf(own, darkWood, 1, 2, anisotropy);
  const timber = matt(own, '#3a2f26', woodTex);
  /* The ossuary's door, three shades up from the gate's beams. At the same dark
     brown it was the blackest thing in the frame — a four-metre hole in a
     building you cannot go into, which is the opposite of what a shut door
     says. */
  const doorWood = matt(own, '#5c4835', woodTex);
  const iron = matt(own, '#2b2b2c');

  /* ---- the ground ---- */

  basePlate(own, root, AREA.bounds, '#242a20');

  /**
   * A flat run of ground, laid at a height, its texture sized in metres.
   *
   * A plane's UVs run 0 to 1 whatever the plane measures, so one shared texture
   * stretches to fit every mesh it is put on. The three terraces are 40, 28 and
   * 36 m deep and all carried the same 30 × 28 repeat, which drew close-mown
   * ground as corduroy — three and a half metres of it across and one and a
   * half along. The avenues are worse: split either side of every junction they
   * run from four metres to twenty-eight, and one repeat over each of those is
   * six different sizes of flagstone in one path.
   *
   * So the UVs are scaled by the mesh instead, and a tile is the same size
   * everywhere. `box` has done this since Market Row; this is the same rule for
   * the ground.
   */
  const slab = (
    w: number, d: number, x: number, y: number, z: number, mat: THREE.Material
  ) => {
    const geo = own.keep(new THREE.PlaneGeometry(w, d));
    const metres = mat.userData?.tile as number | undefined;
    if (metres) {
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, uv.getX(i) * (w / metres), uv.getY(i) * (d / metres));
      }
      uv.needsUpdate = true;
    }
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    m.receiveShadow = true;
    root.add(m);
    return m;
  };

  /*
   * The three terraces.
   *
   * Each is a plane at its own height, and each ends where the flights up from
   * the one below begin — abutting, never overlapping, because two grounds at
   * one depth is the oldest flicker in this world.
   */
  slab(W * 2, D - 12, 0, 0.002, -(D + 12) / 2, moss());
  slab(W * 2, 28, 0, CM_MID + 0.002, 2, moss());
  slab(W * 2, 36, 0, CM_HIGH + 0.002, 34, moss());

  /*
   * The paths, and the flights that carry them up the terraces.
   *
   * Drawn a centimetre over the ground they cross rather than cut into it: a
   * path and the grass beside it at one height is the same flicker as two
   * grounds, and a flagged path standing a little proud of soft ground is what
   * happens anyway.
   */
  /*
   * Each terrace carries one cross path, and the four avenues stop either side
   * of it rather than running through.
   *
   * Two paths laid over one another at the same height is that same flicker
   * again — twelve junctions, twelve of them — and it had been papered over by
   * laying the cross paths two millimetres lower, which is nothing at all once
   * the far end of the avenue is ninety metres away. A junction belongs to the
   * path already crossing it, so the avenue simply ends at its kerb.
   */
  for (const t of [
    { from: -D, to: -12, y: 0.014, cross: -20 },
    { from: -12, to: 16, y: CM_MID + 0.014, cross: 0 },
    { from: 16, to: D, y: CM_HIGH + 0.014, cross: 30 },
  ]) {
    slab(W * 2, CM_WALK * 2, 0, t.y, t.cross, path());
    for (const avenue of CM_WALKS) {
      for (const [from, to] of [
        [t.from, t.cross - CM_WALK],
        [t.cross + CM_WALK, t.to],
      ] as const) {
        if (to - from < 0.05) continue;
        slab(CM_WALK * 2, to - from, avenue, t.y, (from + to) / 2, path());
      }
    }
  }

  /*
   * The terrace faces, and the steps.
   *
   * The collision for a terrace edge is already there — a platform more than a
   * stride above you and less than a room is a wall, which is the rule `settle`
   * learned on Black Crown's podium. So this is only the face of it: a course
   * of retaining stone with a coping along the top, broken where each flight
   * comes up.
   */
  const face = (z: number, y: number, gapAt: number[]) => {
    let from = -W;
    const runs: [number, number][] = [];
    for (const g of [...gapAt].sort((a, b) => a - b)) {
      runs.push([from, g - CM_WALK]);
      from = g + CM_WALK;
    }
    runs.push([from, W]);
    for (const [a, b] of runs) {
      if (b - a < 0.2) continue;
      root.add(box(own, b - a, y + 0.4, 1.2, wall(), (a + b) / 2, (y + 0.4) / 2 - 0.4, z));
      root.add(box(own, b - a + 0.12, 0.22, 1.44, kerb(), (a + b) / 2, y + 0.11, z));
    }
  };
  face(-12.6, CM_MID, CM_WALKS);
  face(15.4, CM_HIGH, CM_WALKS);

  /* And the treads themselves, read off the platforms so the step you see is
     the step `groundAt` answers with. */
  for (const t of AREA.platforms ?? []) {
    if (t.hw > 6 || t.hd > 6) continue;
    root.add(box(own, t.hw * 2, 0.34, t.hd * 2, kerb(), t.x, t.y - 0.17, t.z));
  }

  /* ---- the wall round it, and the way in ---- */

  /*
   * A boundary wall on all four sides, with the lych-gate in the south.
   *
   * The wall is what makes this ground *set apart* rather than a field — and it
   * is also the thing that closes the horizon, which an area this size needs on
   * every side or the void is visible from the middle of it.
   */
  const boundary = (
    along: 'x' | 'z', from: number, to: number, cross: number, h: number, dy = 0
  ) => {
    const run = Math.abs(to - from);
    const mid = (from + to) / 2;
    const put = (len: number, hh: number, thick: number, y: number, m: THREE.Material) =>
      along === 'x'
        ? box(own, len, hh, thick, m, mid, y, cross)
        : box(own, thick, hh, len, m, cross, y, mid);
    /* The ground climbs under it, so the wall is drawn from below the lowest
       terrace to a constant height above the highest — buried at the bottom
       rather than stepped, which is what a real boundary wall does. */
    root.add(put(run, h + 4, 0.7, (h + 4) / 2 - 4 + dy, wall()));
    root.add(put(run + 0.16, 0.3, 0.94, h + 0.15 + dy, kerb()));
  };
  /* The south wall runs into the gate piers, whose centres are at 12.4 ± 4.2.
     It used to stop at −3.2 and 28 — a thirty-one metre gap for an eleven metre
     gate, so nine metres of open sky stood either side of it. */
  boundary('x', -W, 8.2, -D, 3.4);
  boundary('x', 16.6, W, -D, 3.4);
  boundary('x', -W, W, D, CM_HIGH + 3.4);
  /*
   * The sides step with the terraces, three runs apiece.
   *
   * Run at one height they topped out at 3.32 — which is four fifths of a wall
   * on the low ground and twenty-eight centimetres *under* the oldest, where
   * you would have stood on the top terrace looking over a boundary wall buried
   * beneath your own feet. A wall on a hillside steps; only the ground under it
   * is continuous.
   *
   * Eight centimetres down, so that where two walls meet at a corner they are
   * two walls and not two pairs of faces in two planes.
   */
  for (const side of [-W, W] as const) {
    /* Stepped at the middle of each terrace face rather than at its edge, so
       the break is buried inside the retaining course instead of sharing a
       plane with it. */
    boundary('z', -D, -12.6, side, 3.4, -0.08);
    boundary('z', -12.6, 15.4, side, CM_MID + 3.4, -0.08);
    boundary('z', 15.4, D, side, CM_HIGH + 3.4, -0.08);
  }

  /*
   * The lych-gate: two piers, a beam and a tiled roof over the threshold.
   *
   * You arrive under it out of the shrine, and it is the only roofed thing on
   * the lower ground — so it reads from the far end of the avenue as the way
   * out, which is the one piece of information a place this size owes you.
   */
  {
    const gx = 12.4;
    for (const s of [-1, 1] as const) {
      root.add(box(own, 1.1, 4.2, 1.1, wall(), gx + s * 4.2, 2.1, -D));
      root.add(box(own, 1.34, 0.26, 1.34, kerb(), gx + s * 4.2, 4.33, -D));
    }
    root.add(box(own, 10.6, 0.7, 1.5, timber, gx, 4.85, -D));
    root.add(box(own, 11.6, 0.34, 2.6, kerb(), gx, 5.4, -D));
    root.add(box(own, 12.4, 0.3, 3.4, matt(own, '#3b332d'), gx, 5.72, -D));
    /*
     * And what is beyond the gate, which is the shrine — a different scene, so
     * what you would actually see through a seven-metre opening is the void.
     * A closed box, the same answer as Black Crown Games' front door, sized so
     * that no sight line from inside the ground gets past its edges.
     */
    const beyond = matt(own, '#2b2f28');
    root.add(box(own, 12.6, 6, 0.4, beyond, gx, 3, -D - 3.2));
    for (const s2 of [-1, 1] as const) {
      root.add(box(own, 0.4, 6, 3.2, beyond, gx + s2 * 5.3, 2.95, -D - 1.6));
    }
    root.add(box(own, 11.8, 0.4, 3.8, beyond, gx, 6.15, -D - 1.8));
    /* Hung from the beam, not floating under it. A light with nothing making it
       is the fault Mike found on the third floor of Black Crown Games, and it
       is just as visible out of doors. */
    root.add(box(own, 0.08, 1.0, 0.08, iron, gx, 4.1, -D));
    root.add(box(own, 0.5, 0.66, 0.5, glow(own, '#c9954e'), gx, 3.53, -D));
    root.add(box(own, 0.64, 0.12, 0.64, kerb(), gx, 3.92, -D));
    const under = new THREE.PointLight('#ffbe78', 26, 13, 2);
    under.position.set(gx, 3.5, -D);
    root.add(under);
    lamps.push(under);
    /*
     * And what is in the box, which is the back of the shrine.
     *
     * A closed box you can see into is a hole until something stands in it:
     * from the avenue the gate framed a lantern hanging in flat black. So the
     * first two metres past the threshold are here — the path going on, a
     * stone lantern burning beside it, the shrine's back fence dark behind.
     * Enough to say where the gate goes; the precinct is built when you walk
     * through.
     */
    root.add(box(own, 3.6, 0.02, 2.6, matt(own, '#9a9382'), gx, 0.03, -D - 1.5));
    const px = gx - 2.4;
    const pz = -D - 1.9;
    root.add(box(own, 0.5, 0.2, 0.5, kerb(), px, 0.1, pz));
    root.add(box(own, 0.24, 0.9, 0.24, kerb(), px, 0.65, pz));
    root.add(box(own, 0.44, 0.44, 0.44, glow(own, '#c9954e'), px, 1.32, pz));
    root.add(box(own, 0.6, 0.12, 0.6, kerb(), px, 1.6, pz));
    root.add(box(own, 8, 0.9, 0.14, matt(own, '#2e2a24'), gx, 0.45, -D - 2.7));
    const past = new THREE.PointLight('#ffb469', 14, 7, 2);
    past.position.set(px, 1.32, pz);
    root.add(past);
    lamps.push(past);
  }

  /* ---- the stones ---- */

  /*
   * Every marker of a kind, merged into one geometry.
   *
   * Each box is built at the origin, turned, lifted onto the ground under it
   * and then baked into the merge — so the whole plot is one mesh with one
   * material and one draw call, and the stones still stand exactly where the
   * collision says they do, because both read `CM_MARKERS`.
   */
  const bake = (parts: { g: THREE.BufferGeometry }[], mat: THREE.Material) => {
    if (!parts.length) return;
    const merged = mergeGeometries(parts.map((p) => p.g), false);
    for (const p of parts) p.g.dispose();
    if (!merged) return;
    const m = new THREE.Mesh(own.keep(merged), mat);
    /*
     * The stones receive shadow and do not cast it.
     *
     * One directional light covers a hundred and twenty-four metres here, so a
     * 2048 map is six centimetres a texel — and a headstone is sixty. Eight
     * hundred casters that size do not produce eight hundred shadows, they
     * produce noise: every stone self-shadows across its own face and the whole
     * burial ground renders black under a bright sky, which is exactly what the
     * first build looked like. The wall, the gate, the ossuary and the trees are
     * big enough to cast and still do.
     */
    m.castShadow = false;
    m.receiveShadow = true;
    root.add(m);
  };

  const piece = (
    w: number, h: number, d: number, x: number, y: number, z: number, turn: number
  ) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.applyMatrix4(new THREE.Matrix4().makeRotationY(turn));
    g.translate(x, y, z);
    return { g };
  };

  const pale: { g: THREE.BufferGeometry }[] = [];
  const dark: { g: THREE.BufferGeometry }[] = [];
  const mossy: { g: THREE.BufferGeometry }[] = [];
  const trunks: { g: THREE.BufferGeometry }[] = [];
  const leaves: { g: THREE.BufferGeometry }[] = [];

  for (const m of CM_MARKERS) {
    const y = at(m.x, m.z);
    if (m.kind === 'tree') {
      /*
       * The trunk is drawn the size it collides.
       *
       * At 0.7 of the marker it was half a metre through, and the solid round
       * it — the box about a stone turned up to a right angle — is two metres.
       * That is an invisible ring you walk into a metre and a half from a tree
       * you can see all of, which is the same complaint as the wall you cannot
       * see on Black Crown's third floor.
       */
      trunks.push(piece(m.hw * 2, m.h, m.hd * 2, m.x, y + m.h / 2, m.z, m.turn));
      /* Four courses, not three: at 1.7 m thick and 4.4 across they read as
         parasols rather than trees. The wood outside the wall is built the same
         way and this is that shape at grove scale. */
      for (let i = 0; i < 4; i++) {
        const s = 5 - i * 0.9;
        leaves.push(piece(s, 2.4, s, m.x, y + m.h * 0.5 + i * 1.6, m.z, m.turn + i * 0.4));
      }
      continue;
    }
    /* A stone is a base and an upright. The base is what keeps it standing on
       ground that is never quite flat; the upright is what you read. */
    const bin = m.tended ? pale : rnd() < 0.42 ? mossy : rnd() < 0.5 ? dark : pale;
    if (m.kind === 'slab') {
      bin.push(piece(m.hw * 2, m.h, m.hd * 2, m.x, y + m.h / 2, m.z, m.turn));
      continue;
    }
    bin.push(piece(m.hw * 2 + 0.16, 0.18, m.hd * 2 + 0.16, m.x, y + 0.09, m.z, m.turn));
    if (m.kind === 'obelisk') {
      bin.push(piece(m.hw * 1.3, m.h, m.hd * 1.3, m.x, y + 0.18 + m.h / 2, m.z, m.turn));
      bin.push(piece(m.hw * 1.6, 0.16, m.hd * 1.6, m.x, y + 0.18 + m.h + 0.08, m.z, m.turn));
      continue;
    }
    if (m.kind === 'family') {
      bin.push(piece(m.hw * 2, 0.34, m.hd * 2, m.x, y + 0.35, m.z, m.turn));
      bin.push(piece(m.hw * 1.7, m.h, m.hd * 1.2, m.x, y + 0.52 + m.h / 2, m.z, m.turn));
      bin.push(piece(m.hw * 2.1, 0.2, m.hd * 1.5, m.x, y + 0.52 + m.h + 0.1, m.z, m.turn));
      continue;
    }
    bin.push(piece(m.hw * 1.7, m.h, m.hd * 1.1, m.x, y + 0.18 + m.h / 2, m.z, m.turn));
  }

  bake(pale, matt(own, '#bdb7a8', stoneTex));
  bake(dark, matt(own, '#8e877c', stoneTex));
  bake(mossy, matt(own, '#828c70', stoneTex));
  bake(trunks, matt(own, '#4a3d30'));
  bake(leaves, matt(own, '#465836'));

  /* ---- the ossuary at the head of the avenue ---- */

  /*
   * The one building, and the thing the avenue points at.
   *
   * Forty metres of straight path needs something at the end of it or it is a
   * corridor to nowhere. Stone, shut, with a lamp burning in the porch — you
   * cannot go in, and you can see from the gate that there is somewhere to go.
   */
  {
    const ox = 21;
    const oz = 41;
    const oy = CM_HIGH;
    root.add(box(own, 13, 7.4, 11, wall(), ox, oy + 3.7, oz));
    root.add(box(own, 14, 0.6, 12, kerb(), ox, oy + 7.7, oz));
    root.add(box(own, 15.2, 0.5, 13.2, matt(own, '#3b332d'), ox, oy + 8.25, oz));
    /* A porch you can stand under, on the avenue side. */
    for (const s of [-1, 1] as const) {
      root.add(box(own, 0.8, 4.4, 0.8, wall(), ox + s * 4, oy + 2.2, oz - 6.6));
    }
    root.add(box(own, 10, 0.6, 1.4, timber, ox, oy + 4.7, oz - 6.6));
    root.add(box(own, 11, 0.34, 2.2, kerb(), ox, oy + 5.17, oz - 6.6));
    /* The door, shut, with light under it and two straps across it. */
    root.add(box(own, 3, 4, 0.3, doorWood, ox, oy + 2, oz - 5.6));
    for (const s2 of [-1, 1] as const) {
      root.add(box(own, 0.16, 3.6, 0.1, iron, ox + s2 * 0.9, oy + 2, oz - 5.78));
    }
    root.add(box(own, 0.34, 0.34, 0.12, iron, ox + 0.5, oy + 1.9, oz - 5.79));
    root.add(box(own, 2.4, 0.14, 0.16, glow(own, '#c9954e'), ox, oy + 0.1, oz - 5.78));
    root.add(box(own, 3.6, 0.36, 0.5, kerb(), ox, oy + 4.2, oz - 5.7));
    /* And a lamp on the porch beam, for the same reason. */
    root.add(box(own, 0.08, 1.8, 0.08, iron, ox, oy + 3.6, oz - 6.6));
    root.add(box(own, 0.44, 0.6, 0.44, glow(own, '#c9954e'), ox, oy + 2.8, oz - 6.6));
    root.add(box(own, 0.58, 0.12, 0.58, kerb(), ox, oy + 3.16, oz - 6.6));
    const porch = new THREE.PointLight('#ffbe78', 34, 15, 2);
    porch.position.set(ox, oy + 2.8, oz - 6.6);
    root.add(porch);
    lamps.push(porch);
  }

  /* ---- what stands about the place ---- */

  /*
   * The water basin, by the gate.
   *
   * You wash a grave before you visit it, so the basin is the first thing on
   * the way in and the ladles are the tell that somebody still does.
   */
  {
    const basin = CM_THINGS.find((t) => t.kind === 'basin')!;
    const bx = basin.x;
    const bz = basin.z;
    const by = at(bx, bz);
    root.add(box(own, 2.6, 0.9, 1.7, kerb(), bx, by + 0.45, bz));
    root.add(box(own, 2.2, 0.12, 1.3, matt(own, '#2b3a3c'), bx, by + 0.94, bz));
    /* Laid across the water, not along the rim: at 90 cm long and 60 apart they
       used to run a third of their length through one another. */
    for (let i = 0; i < 3; i++) {
      root.add(box(own, 0.06, 0.06, 0.9, timber, bx - 0.7 + i * 0.7, by + 1.03, bz - 0.1));
    }
  }

  /*
   * Lanterns down the avenue and along the cross paths.
   *
   * Ten of them carry a light and the rest are stone — a burial ground at night
   * wants to be mostly dark, and a lit lantern every twenty metres is enough to
   * read the path by and few enough that the ground between them stays black.
   */
  const lantern = (x: number, z: number, lit: boolean) => {
    const y = at(x, z);
    root.add(box(own, 0.66, 0.26, 0.66, kerb(), x, y + 0.13, z));
    root.add(box(own, 0.3, 1.3, 0.3, kerb(), x, y + 0.91, z));
    root.add(box(own, 0.78, 0.16, 0.78, kerb(), x, y + 1.64, z));
    root.add(box(own, 0.56, 0.6, 0.56, lit ? glow(own, '#c9954e') : matt(own, '#6d6862'), x, y + 2.02, z));
    root.add(box(own, 0.92, 0.18, 0.92, kerb(), x, y + 2.41, z));
    root.add(box(own, 0.3, 0.24, 0.3, kerb(), x, y + 2.62, z));
    if (!lit) return;
    const l = new THREE.PointLight('#ffb469', 30, 14, 2);
    l.position.set(x, y + 2.0, z);
    root.add(l);
    lamps.push(l);
  };
  /* Read off the same list the collision uses — see `CM_THINGS`. */
  for (const t of CM_THINGS) {
    if (t.kind === 'lantern') lantern(t.x, t.z, !!t.lit);
  }

  /*
   * And the grave with flowers on it.
   *
   * One, on the oldest ground, a little out of its row. Everything about it is
   * ordinary except that it is *kept*: the stone is washed, there is water in
   * the cup, and the flowers have not been there long. It has its own small
   * light because in a hundred and four metres of dark ground the eye needs a
   * reason to walk this far, and this is it.
   */
  {
    const g = CM_MARKERS.find((m) => m.tended) as Marker;
    const y = at(g.x, g.z);
    root.add(box(own, 1.5, 0.1, 1.2, kerb(), g.x, y + 0.05, g.z));
    root.add(box(own, 0.36, 0.3, 0.3, matt(own, '#2f3a3c'), g.x - 0.42, y + 0.25, g.z - 0.42));
    root.add(box(own, 0.36, 0.3, 0.3, matt(own, '#2f3a3c'), g.x + 0.42, y + 0.25, g.z - 0.42));
    /* The flowers. The only saturated colour in the area, and it is four
       centimetres across — which is the whole point of it. */
    for (const s of [-1, 1] as const) {
      root.add(box(own, 0.22, 0.5, 0.22, matt(own, '#3f5236'), g.x + s * 0.42, y + 0.62, g.z - 0.42));
      root.add(box(own, 0.3, 0.16, 0.3, matt(own, '#8d3a44'), g.x + s * 0.42, y + 0.9, g.z - 0.42));
    }
    root.add(box(own, 0.5, 0.24, 0.5, kerb(), g.x, y + 0.14, g.z + 0.7));
    root.add(box(own, 0.34, 0.2, 0.34, glow(own, '#c9954e'), g.x, y + 0.36, g.z + 0.7));
    const votive = new THREE.PointLight('#ffb469', 12, 6, 2);
    votive.position.set(g.x, y + 0.5, g.z + 0.7);
    root.add(votive);
    lamps.push(votive);
  }

  /* ---- light ---- */

  const sky = ownSky(own, new Sky(own, root, {
    reach: 92,
    /* Wide enough to take in the wood outside the wall as well as the ground
       inside it: at 62 the trees stood outside the shadow camera and rendered
       as flat black cut-outs against a lit sky. */
    half: 70,
    deep: 70,
    target: [0, CM_MID, 4],
    /* One texel of a 2048 map over 140 m of camera. See `market.ts`. */
    normalBias: 0.069,
    gain: 1.05,
    fill: 1,
  }));

  /*
   * The hill beyond the wall.
   *
   * A hundred and twelve metres of open ground has a horizon on all four sides,
   * and a 3.4 m wall seen from the middle of it leaves most of the frame as
   * sky — so the wall alone reads as a line with nothing behind it. The shrine
   * solved the same problem with tree mass it built *outside* its own fence,
   * and this is that: dark canopies standing above the coping, close enough
   * together to be a wood and far enough out that nobody can reach them.
   */
  {
    const beyond: { g: THREE.BufferGeometry }[] = [];
    for (let i = 0; i < 96; i++) {
      const side = i % 4;
      const t = (Math.floor(i / 4) / 24 - 0.5) * 2;
      const across = t * W;
      /*
       * Far enough out that a canopy cannot reach the wall — at 3.5 m the
       * widest of them stopped ten centimetres short of the wall's inner face.
       *
       * And much further out behind the gate. What is beyond the gate is a
       * closed box three metres deep, and a canopy seven and a half metres
       * across standing five metres out reaches straight through its back and
       * hangs in the gateway, which is the one opening anybody looks through.
       */
      const out = side === 2 && Math.abs(across - 12.4) < 12
        ? 13 + rnd() * 5
        : 5.5 + rnd() * 7;
      const bx = side === 0 ? -W - out : side === 1 ? W + out : across;
      const bz = side === 2 ? -D - out : side === 3 ? D + out : t * D;
      const h = 8 + rnd() * 7;
      const y = at(Math.max(-W, Math.min(W, bx)), Math.max(-D, Math.min(D, bz)));
      beyond.push(piece(1.7, h, 1.7, bx, y + h / 2, bz, rnd()));
      /* Canopies from just above the coping, overlapping each other — a wood is
         a mass with a ragged top, not a row of blocks on sticks. */
      for (let k = 0; k < 4; k++) {
        const sz = 7.5 - k * 1.5;
        beyond.push(piece(sz, 2.8, sz, bx, y + h * 0.42 + k * 1.9, bz, rnd() * 3));
      }
    }
    bake(beyond, matt(own, '#46543a'));
  }

  sky.claim();

  return {
    root,
    setTime: (hour) => { sky.apply(hour); },
    dispose() {
      for (const item of own.items) item.dispose();
      for (const lamp of lamps) lamp.shadow?.map?.dispose();
    },
  };
}
