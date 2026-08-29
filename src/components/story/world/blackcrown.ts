/**
 * Black Crown — the block behind Market Row, and the shop that names it.
 *
 * Eighty-four metres by ninety-six, which is about three times the shrine and
 * the largest thing in this world. The size is the point: this is a block of a
 * city rather than a set, and there is nowhere in it you can stand and see all
 * of it at once.
 *
 * ## What holds an area this big up
 *
 * Not detail — there is not enough detail in the world to cover ten thousand
 * square metres, and trying would only make it uniform. What holds it up is
 * that it is *six places*, each with its own ground, its own light and its own
 * reason to be walked into:
 *
 * - the **lane** in from the back of Market Row, which is a service road: one
 *   lamp every ten metres down one side, bins, and nothing else
 * - the **square**, setts rather than flags, lit round its edge
 * - **Black Crown**, nine steps up, the only thing here with any height to it
 * - the **dice court** beside it, two steps and round a corner
 * - the **south street**, asphalt and a kerb, running down to a railway
 * - the **alley** west and the **yard** at the end of it, unlit but for one lamp
 *
 * ## Dusk, and the light
 *
 * The same evening as the rest of the ward. The shop is the brightest thing in
 * the block by a wide margin and everything else is arranged so that it stays
 * that way: the square's lamps are low and warm, the lane and the yard have one
 * apiece, and the moon does the rest. If you can see where you are going
 * anywhere in here, it is because Black Crown is lit.
 */

import * as THREE from 'three';
import {
  asphalt, paving, brick, render, plaster, darkWood, concrete, shutter, signBoard,
} from './surfaces';
import {
  Owned, box, matt, tiled, glow, surfaceOf, type BuiltArea,
} from './kit';
import { Sky, ownSky } from './sky';
import {
  AREAS, BC_PODIUM, BC_COURT, BC_STEPS, BC_PAVEMENTS, CROWN_THINGS, groundAt,
} from '@/story/areas';

const AREA = AREAS['black-crown'];

/** How high the ground is at a point. The one source for every height here. */
const at = (x: number, z: number) => groundAt(AREA, x, z);

export function buildBlackCrown(anisotropy: number): BuiltArea {
  const own = new Owned();
  const root = new THREE.Group();
  root.name = 'black-crown';

  /* ---- surfaces ---- */

  /* Ten by twelve over thirty-two metres by thirty-eight, which is a slab
     0.8 m across. At twenty-six by thirty they were 0.3 m and the square read
     as tiled rather than paved. */
  const settTex = surfaceOf(own, () => paving({ dirt: 0.35, vary: 0.5 }), 10, 12, anisotropy);
  const roadTex = surfaceOf(own, asphalt, 5, 12, anisotropy);
  const laneTex = surfaceOf(own, asphalt, 4, 10, anisotropy);
  const yardTex = surfaceOf(own, () => concrete('#7e7a72'), 1, 1, anisotropy);
  const stoneTex = surfaceOf(own, () => concrete('#8a8478'), 1, 1, anisotropy);
  const brickTex = surfaceOf(own, () => brick('#7d6154'), 1, 1, anisotropy);
  const darkBrickTex = surfaceOf(own, () => brick('#5d4a45'), 1, 1, anisotropy);
  const renderTex = surfaceOf(own, () => render('#b7a88e'), 1, 1, anisotropy);
  const plasterTex = surfaceOf(own, () => plaster('#a89a83'), 1, 1, anisotropy);
  const woodTex = surfaceOf(own, darkWood, 1, 2, anisotropy);
  const shutterTex = surfaceOf(own, () => shutter('#6a6259'), 1, 1, anisotropy);

  const stone = () => tiled(matt(own, '#ffffff', stoneTex));
  const brickwork = () => tiled(matt(own, '#ffffff', brickTex));
  const darkBrick = () => tiled(matt(own, '#ffffff', darkBrickTex));
  const rendered = () => tiled(matt(own, '#ffffff', renderTex));
  const plastered = () => tiled(matt(own, '#ffffff', plasterTex));
  const timber = matt(own, '#ffffff', woodTex);
  const shutters = matt(own, '#ffffff', shutterTex);

  /*
   * Everything reads a stop lighter than daylight would have it, for the reason
   * set out in `shrine.ts`: at night a material's colour is nearly all of what
   * you see of it, and colours chosen as if lit come out as one black mass.
   */
  const kerbStone = matt(own, '#6f6a62');
  const iron = matt(own, '#4a453f');
  const oxblood = matt(own, '#7d3a35');
  const brass = matt(own, '#9a7d42');

  /*
   * The sky, and everything in the block that answers to the hour.
   *
   * One rig rather than three lights written out here: the key light swings
   * from east at dawn to west at dusk and is a cool moon in between, and every
   * lamp registered below goes out when it gets light. See `world/sky.ts`.
   */
  const sky = ownSky(own, new Sky(own, root, {
    reach: 52,
    half: 46,
    deep: 40,
    target: [-6, 0, 0],
    /* 92 m across 2048 is 4.5 cm, which is more drift than any shadow in this
       game — so this is under it, bought by never letting the key light stand
       square-on to a wall. See `market.ts` on `normalBias`. */
    normalBias: 0.032,
  }));

  /* ---- the ground ---- */

  /** A flat run of ground. Every surface in the block is one of these. */
  const floor = (
    w: number, d: number, x: number, y: number, z: number,
    tex: THREE.Texture | null
  ) => {
    const m = new THREE.Mesh(own.keep(new THREE.PlaneGeometry(w, d)), matt(own, '#ffffff', tex));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    m.receiveShadow = true;
    root.add(m);
    return m;
  };

  /*
   * The square, and the tone across it painted into the mesh.
   *
   * Same reason as the shrine's gravel: a tile cannot carry anything metres
   * wide without that thing repeating every few metres, and on ground this size
   * the repeat is the first thing you see. The plane can carry it, because it is
   * one piece thirty metres across whose vertices never come round again.
   */
  const squareGeo = own.keep(new THREE.PlaneGeometry(32, 38, 18, 20));
  const sp = squareGeo.attributes.position;
  const tone = new Float32Array(sp.count * 3);
  for (let i = 0; i < sp.count; i++) {
    const u = sp.getX(i);
    const v = sp.getY(i);
    const t = 1 + 0.07 * (
      Math.sin(u * 0.17 + 0.6) * Math.cos(v * 0.12 - 1.1) * 0.55 +
      Math.sin(u * 0.33 - 1.4) * Math.cos(v * 0.29 + 0.3) * 0.3 +
      Math.sin((u - v) * 0.08) * 0.15
    );
    tone[i * 3] = t;
    tone[i * 3 + 1] = t;
    tone[i * 3 + 2] = t * 0.99;
  }
  squareGeo.setAttribute('color', new THREE.BufferAttribute(tone, 3));
  const squareMat = matt(own, '#ffffff', settTex);
  squareMat.vertexColors = true;
  const square = new THREE.Mesh(squareGeo, squareMat);
  square.rotation.x = -Math.PI / 2;
  /* East to x 11, under the foot of both flights — the open ground between the
     two of them is walkable and was over nothing at all. */
  square.position.set(-5, 0, -3);
  square.receiveShadow = true;
  root.add(square);

  /*
   * The other four surfaces, each ending where the next begins.
   *
   * Abutting and not overlapping. These are single-sided planes at one height,
   * so a metre of overlap is a metre of two floors at one depth — the square
   * ran two metres into the south street and half a metre into the alley, which
   * between them is the largest coplanar pair this world has had since the
   * shrine's precinct slab.
   */
  floor(11, 26, -19, 0.002, -35, laneTex);          // the lane in
  floor(12, 28, -8, 0.002, 30, roadTex);            // the south street
  floor(19.5, 9, -30.75, 0.002, -1.5, laneTex);     // the alley
  floor(10, 38, -45.5, 0.002, -3, yardTex);         // the yard

  /*
   * The podium, the court, and one box per tread between them.
   *
   * Read off `BC_GROUND` rather than written twice, so the step you see is the
   * step `groundAt` answers with. The podium's own top is the last entry and is
   * drawn as a slab; everything narrower than it is a tread.
   */
  for (const t of BC_STEPS) {
    root.add(box(own, t.hw * 2, t.y, t.hd * 2, stone(), t.x, t.y / 2, t.z));
  }
  /* A nosing on each tread, wholly on its own step — see `shrine.ts` on why not
     overhanging the one below. The two wide entries are the slabs the flights
     land on; everything narrow is a tread. */
  for (const t of BC_STEPS) {
    if (t.hw > 2.5) continue;
    root.add(box(own, 0.06, 0.05, t.hd * 2, matt(own, '#6c675e'),
                 t.x + t.hw - 0.035, t.y - 0.02, t.z));
  }

  /*
   * The pavements, drawn to the heights `BC_GROUND` declares for them, with a
   * kerbstone along the road edge of each.
   */
  for (const p of BC_PAVEMENTS) {
    root.add(box(own, p.hw * 2, p.y, p.hd * 2, stone(), p.x, p.y / 2, p.z));
    /* A kerbstone along the road edge, set in from the pavement's own side so
       that two stones do not share a face down twenty-seven metres. */
    const road = p.x < -8 ? 1 : -1;
    root.add(box(own, 0.22, p.y + 0.02, p.hd * 2 - 0.04,
                 kerbStone, p.x + road * (p.hw - 0.13), (p.y + 0.02) / 2, p.z));
  }
  /*
   * And a gutter down the lane, which has no pavement because a service road
   * behind an arcade does not have one. Twelve millimetres, so it is a line in
   * the road rather than something to trip over.
   */
  for (const gx of [-23.2, -14.8]) {
    /*
     * Sunk, not laid on. Twelve millimetres proud of the road puts its
     * *underside* within four of every wall, plinth, lamp base and bin in the
     * lane — all of which also stand at zero — and the check reads those as one
     * plane, correctly. Dropping the bottom out of sight costs nothing.
     */
    root.add(box(own, 0.34, 0.07, 26, kerbStone, gx, -0.023, -35));
  }

  /* ---- the buildings ---- */

  /**
   * A run of building front.
   *
   * The slab behind it is already in `solids`; this is the face of it, drawn a
   * little proud so that the plinth, the windows and the parapet have somewhere
   * to sit without any two of them landing in one plane. `outward` is which way
   * it looks: +1 means the front faces increasing x (or z).
   */
  const frontage = (o: {
    along: 'x' | 'z';
    from: number;
    to: number;
    /** The cross coordinate of the building line the front sits on. */
    face: number;
    outward: 1 | -1;
    h: number;
    bays?: number;
    /** How many of the bays are lit from inside. */
    lit?: number;
    skin?: THREE.Material;
    /** Shutters instead of glass on the ground floor. */
    shut?: boolean;
    base?: number;
  }) => {
    const alongX = o.along === 'x';
    const run = Math.abs(o.to - o.from);
    const mid = (o.from + o.to) / 2;
    const y0 = o.base ?? 0;
    const bays = o.bays ?? Math.max(1, Math.round(run / 5));
    const skin = o.skin ?? brickwork();
    /** Puts a box in the run's frame: `a` along it, `c` out from the face. */
    const put = (
      lenAlong: number, h: number, thick: number,
      a: number, y: number, c: number, mat: THREE.Material
    ) => {
      const cross = o.face + o.outward * c;
      return alongX
        ? box(own, lenAlong, h, thick, mat, a, y, cross)
        : box(own, thick, h, lenAlong, mat, cross, y, a);
    };

    /*
     * Five courses, and no two of them starting or ending in one plane.
     *
     * They are all proud of the same building line and all as long as the run,
     * so written the obvious way the face, the plinth, the band, the parapet
     * and the coping share their back face down the whole length of every
     * building in the block — twenty-three square metres on one wall alone, and
     * a dozen walls. Each one is given its own depth *and* its own length; a
     * few centimetres is invisible from anywhere and is the whole fix.
     */
    const course = (
      lenExtra: number, h: number, inner: number, outer: number, y: number, mat: THREE.Material
    ) => root.add(put(run + lenExtra, h, outer - inner, mid, y, (inner + outer) / 2, mat));

    course(0, o.h, 0, 0.24, y0 + o.h / 2, skin);                          // the face
    /* The plinth starts twelve centimetres below the face rather than level
       with it: standing on the same underside, the two of them share that plane
       down the length of every wall the moment the wall is not at ground zero. */
    course(-0.12, 1.02, -0.10, 0.42, y0 + 0.39, stone());                 // the plinth
    course(0.22, 0.28, -0.06, 0.38, y0 + 3.9, stone());                   // the band
    /* A parapet with a coping on it, because a flat top edge against a black
       sky is the one silhouette in this game that reads as unfinished. */
    course(-0.06, 0.8, 0.03, 0.47, y0 + o.h + 0.4, skin);
    course(0.34, 0.18, -0.02, 0.56, y0 + o.h + 0.89, stone());

    /* Windows, two floors of them, with the ground floor either glazed or shut
       up. Recessed into a reveal rather than pasted on the face. */
    const step = run / bays;
    for (let i = 0; i < bays; i++) {
      const a = o.from + (o.to > o.from ? 1 : -1) * (step * (i + 0.5));
      const alight = i < (o.lit ?? Math.round(bays * 0.35));
      /* Ground floor. */
      if (o.shut) {
        root.add(put(step * 0.62, 2.5, 0.14, a, y0 + 2.05, 0.26, shutters));
        root.add(put(step * 0.66, 0.16, 0.3, a, y0 + 3.35, 0.3, iron));
      } else {
        root.add(put(step * 0.66, 2.6, 0.1, a, y0 + 2.1, 0.02, matt(own, '#241d18')));
        root.add(put(step * 0.58, 2.3, 0.06, a, y0 + 2.05, 0.06,
                     alight ? glow(own, '#b98f52') : matt(own, '#2b2723')));
        root.add(put(step * 0.72, 0.2, 0.36, a, y0 + 3.52, 0.28, stone()));
      }
      /* First floor: smaller, and lit on a different rhythm from below. Only
         on something with a first floor — the yard's sheds are five metres
         tall and were getting upstairs windows above their own parapets. */
      if (o.h <= 7) continue;
      const upLit = (i + 1) % 3 === 0;
      root.add(put(1.7, 1.9, 0.1, a, y0 + 5.6, 0.02, matt(own, '#241d18')));
      root.add(put(1.42, 1.62, 0.06, a, y0 + 5.6, 0.06,
                   upLit ? glow(own, '#a8814c') : matt(own, '#2b2723')));
      root.add(put(2.0, 0.14, 0.34, a, y0 + 4.62, 0.27, stone()));
      /* And a third floor on anything tall enough to want one. */
      if (o.h > 11) {
        const topLit = (i + 2) % 4 === 0;
        root.add(put(1.5, 1.7, 0.1, a, y0 + 8.7, 0.02, matt(own, '#241d18')));
        root.add(put(1.24, 1.44, 0.06, a, y0 + 8.7, 0.06,
                     topLit ? glow(own, '#9a7746') : matt(own, '#2b2723')));
      }
    }
  };

  /* The lane in: the backs of two blocks, blank and high, which is what the
     back of a shopping arcade actually looks like. */
  frontage({ along: 'z', from: -49, to: -23, face: -23.5, outward: 1, h: 12, bays: 5, lit: 1, shut: true });
  frontage({ along: 'z', from: -49, to: -23, face: -14, outward: -1, h: 13, bays: 5, lit: 1, shut: true,
             skin: darkBrick() });

  /*
   * A painted sign on the flank wall of the lane, high up and lit.
   *
   * The shop is thirty-seven metres east of this lane and behind a building, so
   * from the way in there is nothing to walk towards — you come down a service
   * road in the dark and only meet Black Crown by turning left at the end of
   * it. A painted advertisement on a gable is what a city actually does about
   * that, and it gives the approach a target that is legible from the archway.
   */
  {
    const ghost = new THREE.Mesh(
      own.keep(new THREE.PlaneGeometry(13, 3.4)),
      own.keep(new THREE.MeshBasicMaterial({
        map: surfaceOf(own, () => signBoard('BLACK CROWN', '#cdb98a', '#2a2320', 'THIS WAY', 13 / 3.4),
                       1, 1, anisotropy),
        color: '#8d8168',
      }))
    );
    /* At five metres and not at eight. The camera looks slightly down, so from
       the archway anything above about six is off the top of the frame — and a
       sign nobody can see from the approach is not a sign. */
    ghost.rotation.y = -Math.PI / 2;
    ghost.position.set(-14.4, 5.2, -36);
    root.add(ghost);
    const on = new THREE.PointLight('#ffc186', 24, 17, 2);
    on.position.set(-17.5, 5.6, -36);
    root.add(on);
    /* The bracket it hangs off, so the light comes from something. */
    root.add(box(own, 3.2, 0.14, 0.14, iron, -16.2, 6.5, -36));
    root.add(box(own, 0.5, 0.3, 0.5, iron, -17.5, 6.1, -36));
  }

  /* The square's four sides. */
  frontage({ along: 'x', from: -13.5, to: 10.2, face: -22, outward: 1, h: 13, bays: 5, lit: 2,
             skin: darkBrick() });
  /*
   * The corner over the court's steps, plain.
   *
   * `frontage` stands its plinth twenty centimetres proud of the building line,
   * which is inside nothing anywhere else in the block — the player is held off
   * by their own radius long before they reach it. Here the top step of the
   * court runs up to that line, so twenty centimetres proud was twenty
   * centimetres of stone standing on ground somebody is walking on.
   */
  root.add(box(own, 1.86, 13, 0.24, darkBrick(), 11.31, 6.5, -21.88));
  root.add(box(own, 1.94, 0.8, 0.3, darkBrick(), 11.31, 13.4, -21.91));
  root.add(box(own, 1.9, 0.18, 0.4, stone(), 11.4, 13.89, -21.94));
  frontage({ along: 'z', from: -21.5, to: -6.5, face: -20.5, outward: 1, h: 11, bays: 3, lit: 1,
             skin: rendered() });
  frontage({ along: 'z', from: 3.5, to: 15.5, face: -20.5, outward: 1, h: 11, bays: 3, lit: 1,
             skin: rendered() });
  frontage({ along: 'x', from: -20, to: -14.5, face: 16, outward: -1, h: 12, bays: 1, lit: 1 });
  frontage({ along: 'x', from: -1.5, to: 7.5, face: 14, outward: -1, h: 12, bays: 2, lit: 1,
             skin: rendered() });

  /* The alley, which is the backs of the same two blocks. */
  frontage({ along: 'x', from: -40, to: -21, face: -6, outward: 1, h: 11, bays: 4, lit: 0, shut: true,
             skin: plastered() });
  frontage({ along: 'x', from: -40, to: -21, face: 3, outward: -1, h: 11, bays: 4, lit: 0, shut: true,
             skin: plastered() });

  /*
   * The yard's east side: the backs of the two terrace blocks.
   *
   * These had no face at all. A block's *sides* get drawn because that is where
   * you obviously stand; its back gets forgotten, and the back of this one is
   * the whole east wall of a thirty-eight metre yard you can walk into.
   */
  frontage({ along: 'z', from: -21.5, to: -6.5, face: -40.5, outward: -1, h: 11, bays: 3, lit: 0,
             shut: true, skin: plastered() });
  frontage({ along: 'z', from: 3.5, to: 15.5, face: -40.5, outward: -1, h: 11, bays: 3, lit: 0,
             shut: true, skin: plastered() });

  /* The yard: a blank back wall and a shed at each end. */
  frontage({ along: 'z', from: -21, to: 15, face: -50.5, outward: 1, h: 9, bays: 5, lit: 0, shut: true,
             skin: plastered() });
  frontage({ along: 'x', from: -50, to: -41, face: -22, outward: 1, h: 5, bays: 2, lit: 0, shut: true,
             skin: plastered() });
  frontage({ along: 'x', from: -50, to: -41, face: 16, outward: -1, h: 5, bays: 2, lit: 0, shut: true,
             skin: plastered() });

  /* The south street. */
  frontage({ along: 'z', from: 17, to: 43, face: -14, outward: 1, h: 12, bays: 5, lit: 2, base: 0.13 });
  frontage({ along: 'z', from: 15, to: 43, face: -2, outward: -1, h: 13, bays: 5, lit: 2,
             skin: rendered(), base: 0.13 });

  /* The court, closed behind the sculpture. From 12.4 rather than 13, which
     left three quarters of a metre of nothing at its north-west corner. */
  frontage({ along: 'x', from: 12.4, to: 31, face: -22, outward: 1, h: 12, bays: 3, lit: 1,
             skin: darkBrick(), base: BC_COURT });
  frontage({ along: 'z', from: -21, to: -11, face: 32, outward: -1, h: 12, bays: 2, lit: 1,
             skin: darkBrick(), base: BC_COURT });

  /* ---- the way back to Market Row ---- */

  /*
   * The arcade's back wall, with the way through cut out of it.
   *
   * The same shape as the shrine's way out and for the same reason: a doorway
   * has to read as a doorway from the far end of the area, or the player walks
   * the whole block without ever knowing there is a way back.
   */
  const BACK = -48.5;
  /* Set in a hundred millimetres from the building line the lane's frontages
     sit on, so this wall's ends are not in the same plane as their backs. */
  /* Meeting the head exactly at its edges rather than running past them: they
     are the same thickness at the same depth, so any overlap is two whole faces
     at one depth on both sides of the opening. */
  for (const side of [-1, 1] as const) {
    root.add(box(own, 6.2, 13.6, 2, brickwork(), -19 + side * 7.5, 6.8, BACK));
  }
  root.add(box(own, 8.8, 8.2, 2, brickwork(), -19, 9.5, BACK));
  /* A stone surround standing proud of the brick, not let into it. */
  for (const side of [-1, 1] as const) {
    root.add(box(own, 0.55, 5.4, 0.7, stone(), -19 + side * 4.75, 2.7, BACK + 1.35));
  }
  root.add(box(own, 10.5, 0.55, 0.7, stone(), -19, 5.65, BACK + 1.35));
  /* And the arcade beyond it: a floor, a lit end wall, nothing else. There is
     nothing to see through a doorway into another area, only that it goes. */
  floor(9, 4, -19, 0.01, BACK - 2.5, laneTex);
  root.add(box(own, 9, 5.2, 0.4, matt(own, '#3a2f28'), -19, 2.6, BACK - 4.3));
  const backGlass = glow(own, '#a37f4a');
  root.add(box(own, 5, 1.6, 0.14, backGlass, -19, 2.6, BACK - 4.05));
  const backLight = new THREE.PointLight('#ffc186', 26, 14, 2);
  backLight.position.set(-19, 3.4, BACK - 2.2);
  root.add(backLight);


  /* ---- Black Crown ---- */

  /*
   * The shop, and the only thing in the block with any height to it.
   *
   * Everything about it is one size up from its neighbours — the podium, the
   * frontage, the sign, the light — because it has to be the thing you walk
   * towards from the mouth of a lane ninety metres away. There is no neon in it
   * and there is not going to be: it is painted board, gilt lettering, leaded
   * glass and lamplight, which is what a games shop that has been there a long
   * time looks like.
   */
  const BCY = BC_PODIUM;
  const FRONT = 18;

  /* The body, and a taller centre bay so the roofline is not a straight edge. */
  root.add(box(own, 24, 15, 26, brickwork(), 30, BCY + 7.5, 3));
  root.add(box(own, 12, 3.4, 26, brickwork(), 30, BCY + 16.7, 3));
  /* The cornice reaches below the storey it carries rather than sharing an
     underside with it — three hundred square metres at one depth otherwise. */
  root.add(box(own, 25, 0.86, 27, stone(), 30, BCY + 15.27, 3));
  root.add(box(own, 13, 0.7, 27, stone(), 30, BCY + 18.75, 3));

  /* The front, which is where all of it is. A stone ground floor, a deep
     recessed entrance, and a painted board above with the name on it. */
  /* Each of these starts a little below the podium it stands on: the body, the
     stone front and the jambs all standing on exactly BCY put three of their
     undersides in one plane. */
  root.add(box(own, 0.5, 5.75, 25.8, stone(), FRONT - 0.25, BCY + 2.72, 3.1));
  /* The opening: jambs, a head, and the doors set back inside it. */
  for (const s of [-1, 1] as const) {
    root.add(box(own, 1.5, 5.35, 1.1, stone(), FRONT - 0.7, BCY + 2.525, 3 + s * 3.05));
  }
  /* A hair wider than the jambs it lands on, so the head and the two of them
     are three stones and not one plane repeated. */
  root.add(box(own, 1.62, 0.9, 7.4, stone(), FRONT - 0.74, BCY + 4.72, 3));
  root.add(box(own, 0.4, 4.3, 5, timber, FRONT - 1.5, BCY + 2.15, 3));
  for (const s of [-1, 1] as const) {
    root.add(box(own, 0.12, 3.5, 2.1, matt(own, '#2a2320'), FRONT - 1.75, BCY + 1.75, 3 + s * 1.2));
    root.add(box(own, 0.06, 2.9, 1.7, glow(own, '#8c6c3c'), FRONT - 1.82, BCY + 1.75, 3 + s * 1.2));
    /* Glazing bars, so the doors are doors and not two lit panels. */
    for (let g = 0; g < 3; g++) {
      root.add(box(own, 0.08, 0.09, 1.74, matt(own, '#2a2320'),
                   FRONT - 1.86, BCY + 0.6 + g * 1.15, 3 + s * 1.2));
    }
    root.add(box(own, 0.08, 2.94, 0.09, matt(own, '#2a2320'), FRONT - 1.86, BCY + 1.75, 3 + s * 1.2));
    root.add(box(own, 0.14, 0.5, 0.08, brass, FRONT - 1.92, BCY + 1.5, 3 + s * 0.28));
  }
  /* Two display windows either side of it, which is the whole reason a game
     shop has a front at all. */
  for (const s of [-1, 1] as const) {
    const cz = 3 + s * 8.4;
    /* Set into the stone rather than flush with its outer face, which the two
       of them were sharing over twenty-two square metres. */
    root.add(box(own, 0.4, 3.4, 6.6, matt(own, '#241d18'), FRONT - 0.25, BCY + 2.5, cz));
    const windowGlass = glow(own, '#c0964f');
    root.add(box(own, 0.14, 3.0, 6.2, windowGlass, FRONT - 0.3, BCY + 2.5, cz));
    /* Sills and heads stand proud of the stone they are set in, which is both
       what a sill does and what keeps three boxes out of two planes. */
    /* Eighty centimetres deep, not fifty-six. The glass starts at x 17.55 and
       the sill only reached 17.34, which left twenty-one centimetres of ledge
       for a forty-six centimetre die — so they sat half off the front of it. */
    root.add(box(own, 0.8, 0.34, 7.2, stone(), FRONT - 0.5, BCY + 0.6, cz));
    root.add(box(own, 0.64, 0.3, 7.4, stone(), FRONT - 0.4, BCY + 4.4, cz));
    /* Dice on the sill, because the window of a dice shop has dice in it. On
       the sill and not in the glass: at x 17.55 they were inside the pane and
       came out as white wedges growing through it. */
    for (let i = 0; i < 3; i++) {
      const S = 0.46;
      const px = FRONT - 0.73;
      const pz = cz - 2.1 + i * 2.1;
      const d = box(own, S, S, S, matt(own, '#ddd2b8'), px, BCY + 1.01, pz);
      d.rotation.set(0.3 + i * 0.4, 0.6 + i * 0.9, 0.2 + i * 0.5);
      root.add(d);
      /* Pips, or they are just pale cubes — which at this size read as litter
         on the sill rather than as the stock of a dice shop. */
      for (let k = 0; k < 3; k++) {
        const pip = box(own, 0.09, 0.09, 0.09, matt(own, '#38302a'),
                        px - S / 2 - 0.02, BCY + 1.01 - 0.12 + k * 0.12, pz - 0.12 + k * 0.12);
        pip.rotation.copy(d.rotation);
        root.add(pip);
      }
    }
    /* And a light behind the glass, so the window is lit from inside it. */
    const inside = new THREE.PointLight('#ffcf96', 14, 7, 2);
    inside.position.set(FRONT - 1.0, BCY + 2.2, cz);
    root.add(inside);
  }

  /* The board, the name on it, and the crown over the middle. */
  /*
   * The board sits at six metres and not at nine.
   *
   * The camera looks slightly down, so the top of a tall building is off the
   * frame from anywhere you can stand in front of it — and the name of the shop
   * is the one thing here that has to be read. Everything above the board is
   * silhouette, which the roofline can carry on its own.
   */
  root.add(box(own, 0.66, 2.4, 25, matt(own, '#241f1c'), FRONT - 0.34, BCY + 6.3, 3));
  const board = new THREE.Mesh(
    own.keep(new THREE.PlaneGeometry(21, 2.1)),
    own.keep(new THREE.MeshBasicMaterial({
      map: surfaceOf(own, () => signBoard('BLACK CROWN', '#e2c583', '#1a1714', undefined, 21 / 2.1),
                     1, 1, anisotropy),
      color: '#b6a488',
    }))
  );
  board.rotation.y = -Math.PI / 2;
  board.position.set(FRONT - 0.72, BCY + 6.3, 3);
  root.add(board);
  /* The crown itself: five points on a band, in brass, over the entrance. */
  root.add(box(own, 0.4, 0.42, 3.4, brass, FRONT - 0.55, BCY + 7.9, 3));
  for (let i = 0; i < 5; i++) {
    const h = i % 2 === 0 ? 1.0 : 0.62;
    root.add(box(own, 0.36, h, 0.34, brass, FRONT - 0.55, BCY + 8.11 + h / 2, 3 - 1.4 + i * 0.7));
  }

  /* A canopy over the entrance, and the lamps under it. */
  root.add(box(own, 2.5, 0.24, 9, oxblood, FRONT - 1.35, BCY + 4.9, 3));
  root.add(box(own, 2.66, 0.14, 0.34, brass, FRONT - 1.32, BCY + 5.06, 3));
  for (const s of [-1, 1] as const) {
    root.add(box(own, 0.16, 0.7, 0.16, iron, FRONT - 2.4, BCY + 4.55, 3 + s * 3.6));
    const shade = glow(own, '#c9954e');
    root.add(box(own, 0.42, 0.5, 0.42, shade, FRONT - 2.4, BCY + 4.05, 3 + s * 3.6));
    const l = new THREE.PointLight('#ffbe78', 26, 13, 2);
    l.position.set(FRONT - 2.6, BCY + 3.95, 3 + s * 3.6);
    root.add(l);
  }

  /*
   * Its north flank, onto the court.
   *
   * This was a stone band and a side door on nothing: the wall they were fixed
   * to is a `solid`, and solids are not drawn. From the court you were looking
   * at twenty-four metres by fifteen of void with a door floating in it.
   */
  frontage({ along: 'x', from: 18.6, to: 41.4, face: -10, outward: -1, h: 15, bays: 4, lit: 1,
             base: BC_COURT });
  /* And the side door nobody uses, on the wall now that there is one. */
  root.add(box(own, 1.4, 3.2, 0.34, timber, 20.5, BC_COURT + 1.6, -10.55));
  root.add(box(own, 1.7, 0.3, 0.5, stone(), 20.5, BC_COURT + 3.35, -10.6));

  /*
   * And the building south of the podium, which had the same fault: from the
   * top of the shop's steps you were looking along a terrace at a hole.
   */
  frontage({ along: 'x', from: 8.4, to: 17, face: 14, outward: -1, h: 14, bays: 2, lit: 1,
             skin: rendered() });

  /* ---- the dice court ---- */

  /*
   * Six faces of a die, two metres across, on a plinth.
   *
   * This is the reason to walk round the corner rather than straight up the
   * steps, so it is the one piece of sculpture in the block and it gets a light
   * of its own. Pips are cut as shallow recesses rather than painted on, which
   * at this size is the difference between a die and a white box.
   */
  const dieThing = CROWN_THINGS.find((t) => t.kind === 'dice');
  if (dieThing) {
    const dx = dieThing.x;
    const dz = dieThing.z;
    const dy = at(dx, dz);
    root.add(box(own, 4.4, 0.5, 4.4, stone(), dx, dy + 0.25, dz));
    root.add(box(own, 3.4, 0.34, 3.4, stone(), dx, dy + 0.67, dz));
    const die = new THREE.Group();
    const S = 2.1;
    die.add(box(own, S, S, S, matt(own, '#ded3ba'), 0, 0, 0));
    /** One face's worth of pips, sunk a centimetre into it. */
    const pips = (n: number, axis: 'x' | 'y' | 'z', sign: 1 | -1) => {
      const spots: [number, number][] =
        n === 1 ? [[0, 0]]
        : n === 2 ? [[-0.5, -0.5], [0.5, 0.5]]
        : n === 3 ? [[-0.5, -0.5], [0, 0], [0.5, 0.5]]
        : n === 4 ? [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]
        : n === 5 ? [[-0.5, -0.5], [0.5, -0.5], [0, 0], [-0.5, 0.5], [0.5, 0.5]]
        : [[-0.5, -0.55], [0.5, -0.55], [-0.5, 0], [0.5, 0], [-0.5, 0.55], [0.5, 0.55]];
      for (const [u, v] of spots) {
        const r = 0.19;
        const o = S / 2 - 0.04;
        const p = axis === 'x' ? [sign * o, v * S * 0.62, u * S * 0.62]
                : axis === 'y' ? [u * S * 0.62, sign * o, v * S * 0.62]
                : [u * S * 0.62, v * S * 0.62, sign * o];
        const g = axis === 'x' ? [0.1, r * 2, r * 2]
                : axis === 'y' ? [r * 2, 0.1, r * 2]
                : [r * 2, r * 2, 0.1];
        die.add(box(own, g[0], g[1], g[2], matt(own, '#3b332c'), p[0], p[1], p[2]));
      }
    };
    pips(1, 'y', 1); pips(6, 'y', -1);
    pips(2, 'x', -1); pips(5, 'x', 1);
    pips(3, 'z', -1); pips(4, 'z', 1);
    die.position.set(dx, dy + 0.84 + S / 2, dz);
    die.rotation.y = 0.42;
    root.add(die);
    const spot = new THREE.PointLight('#ffcf96', 26, 12, 2);
    spot.position.set(dx - 2.6, dy + 3.4, dz + 2.2);
    root.add(spot);
  }

  /* ---- the railway at the end of the south street ---- */

  /*
   * Not a hoarding. The street stops because something is in the way, and what
   * is in the way is a viaduct with a parapet on it — which also puts a
   * silhouette above the roofline at the far end of the longest view here.
   */
  root.add(box(own, 16, 5.4, 6, darkBrick(), -8, 2.7, 46.5));
  root.add(box(own, 17, 0.6, 7, stone(), -8, 5.7, 46.5));
  root.add(box(own, 17, 1.3, 0.5, darkBrick(), -8, 6.65, 43.4));
  root.add(box(own, 17.4, 0.24, 0.7, stone(), -8, 7.42, 43.35));
  /* Buffers at the foot of it, which is the reason the road ends and not just
     the fact of it. */
  for (const s of [-1, 1] as const) {
    root.add(box(own, 0.9, 1.1, 0.5, iron, -8 + s * 3, 0.55, 43.0));
    root.add(box(own, 1.3, 0.34, 0.4, oxblood, -8 + s * 3, 1.22, 43.0));
  }
  /* A blind arch in the viaduct, bricked up. Cities are full of them. */
  root.add(box(own, 4.6, 3.6, 0.4, matt(own, '#3f342f'), -8, 1.8, 43.25));
  root.add(box(own, 5.2, 0.4, 0.6, stone(), -8, 3.8, 43.2));

  /* ---- what stands in the block ---- */

  const lampPost = (t: (typeof CROWN_THINGS)[number]) => {
    const y = at(t.x, t.z);
    root.add(box(own, 0.52, 0.22, 0.52, stone(), t.x, y + 0.11, t.z));
    root.add(box(own, 0.24, 3.6, 0.24, iron, t.x, y + 2.0, t.z));
    root.add(box(own, 0.42, 0.2, 0.42, iron, t.x, y + 3.9, t.z));
    const lantern = t.lit ? glow(own, '#c99a52') : matt(own, '#2b2723');
    root.add(box(own, 0.5, 0.62, 0.5, lantern, t.x, y + 4.32, t.z));
    root.add(box(own, 0.6, 0.16, 0.6, iron, t.x, y + 4.71, t.z));
    if (t.lit) {
      const l = new THREE.PointLight('#ffb469', 30, 15, 2);
      l.position.set(t.x, y + 4.2, t.z);
      root.add(l);
    }
  };

  const bollard = (t: (typeof CROWN_THINGS)[number]) => {
    const y = at(t.x, t.z);
    root.add(box(own, 0.3, 0.12, 0.3, stone(), t.x, y + 0.06, t.z));
    root.add(box(own, 0.22, 0.78, 0.22, iron, t.x, y + 0.51, t.z));
    root.add(box(own, 0.28, 0.1, 0.28, iron, t.x, y + 0.95, t.z));
  };

  /* A planter, built the same way as the shrine's tree beds and for the same
     reason — nothing grows out of paving. */
  const planter = (t: (typeof CROWN_THINGS)[number], i: number) => {
    const y = at(t.x, t.z);
    const bed = t.hw;
    const WALL = 0.28;
    const RIM = 0.5;
    const CAP = 0.07;
    for (const dz of [-1, 1] as const) {
      const cz = t.z + dz * (bed - WALL / 2);
      root.add(box(own, bed * 2, RIM, WALL, stone(), t.x, y + RIM / 2, cz));
      root.add(box(own, bed * 2 + CAP * 2, 0.09, WALL + CAP * 2, stone(), t.x, y + RIM + 0.045, cz));
    }
    for (const dx of [-1, 1] as const) {
      const cx = t.x + dx * (bed - WALL / 2);
      root.add(box(own, WALL, RIM, (bed - WALL) * 2, stone(), cx, y + RIM / 2, t.z));
      root.add(box(own, WALL + CAP * 2, 0.09, (bed - WALL - CAP) * 2 - 0.04, stone(),
                   cx, y + RIM + 0.045, t.z));
    }
    const earth = box(own, (bed - WALL) * 2 - 0.04, RIM, (bed - WALL) * 2 - 0.04,
                      matt(own, '#584a3a'), t.x, y + RIM / 2 + 0.02, t.z);
    earth.receiveShadow = false;
    root.add(earth);
    /* A clipped shrub, which is what a square planter in a city holds. */
    for (let c = 0; c < 3; c++) {
      const s = 1.5 - c * 0.28;
      const bush = box(own, s, 0.5, s, matt(own, ['#3f5a45', '#48684c', '#3a5340'][(i + c) % 3]),
                       t.x, y + RIM + 0.28 + c * 0.4, t.z);
      bush.rotation.y = 0.3 + c * 0.6 + i;
      bush.receiveShadow = false;
      root.add(bush);
    }
  };

  const bench = (t: (typeof CROWN_THINGS)[number]) => {
    const y = at(t.x, t.z);
    const g = new THREE.Group();
    g.add(box(own, 2.4, 0.12, 0.62, timber, 0, 0.44, 0));
    g.add(box(own, 2.4, 0.5, 0.12, timber, 0, 0.74, -0.25));
    for (const s of [-1, 1] as const) {
      g.add(box(own, 0.12, 0.44, 0.56, iron, s * 1.05, 0.22, 0));
    }
    g.position.set(t.x, y, t.z);
    g.rotation.y = t.face ?? 0;
    root.add(g);
  };

  const stall = (t: (typeof CROWN_THINGS)[number], i: number) => {
    const y = at(t.x, t.z);
    const g = new THREE.Group();
    g.add(box(own, 3.2, 0.14, 2.0, timber, 0, 0.86, 0));
    for (const sx of [-1, 1] as const) {
      for (const sz of [-1, 1] as const) {
        g.add(box(own, 0.12, 0.86, 0.12, iron, sx * 1.45, 0.43, sz * 0.88));
        g.add(box(own, 0.1, 1.4, 0.1, iron, sx * 1.45, 1.62, sz * 0.88));
      }
    }
    /* The awning, folded back for the night on half of them. */
    g.add(box(own, 3.5, 0.12, 2.3, i % 2 === 0 ? oxblood : matt(own, '#3d5060'), 0, 2.36, 0));
    g.add(box(own, 3.6, 0.3, 0.14, i % 2 === 0 ? oxblood : matt(own, '#3d5060'), 0, 2.16, 1.12));
    /* And what is left on it. */
    for (let c = 0; c < 3; c++) {
      const crate = box(own, 0.6, 0.44, 0.5, timber, -0.9 + c * 0.9, 1.15, (c % 2) * 0.3 - 0.15);
      crate.rotation.y = 0.2 * c;
      g.add(crate);
    }
    g.position.set(t.x, y, t.z);
    g.rotation.y = t.face ?? 0;
    root.add(g);
  };

  const bin = (t: (typeof CROWN_THINGS)[number]) => {
    const y = at(t.x, t.z);
    root.add(box(own, t.hw * 2, 1.05, t.hd * 2, matt(own, '#3d4a42'), t.x, y + 0.525, t.z));
    root.add(box(own, t.hw * 2 + 0.06, 0.1, t.hd * 2 + 0.06, matt(own, '#2f3a34'), t.x, y + 1.09, t.z));
  };

  const crate = (t: (typeof CROWN_THINGS)[number], i: number) => {
    const y = at(t.x, t.z);
    const h = t.hw * 1.5;
    const g = box(own, t.hw * 2, h, t.hd * 2, timber, t.x, y + h / 2, t.z);
    g.rotation.y = 0.15 + i * 0.31;
    root.add(g);
  };

  const noticeBoard = (t: (typeof CROWN_THINGS)[number]) => {
    const y = at(t.x, t.z);
    const g = new THREE.Group();
    for (const s of [-1, 1] as const) {
      g.add(box(own, 0.14, 2.0, 0.14, iron, s * (t.hw - 0.1), 1.0, 0));
    }
    /* The panel is thinner than the posts and set forward of them, rather than
       the same thickness in the same place — which is the two of them sharing
       both faces. */
    g.add(box(own, t.hw * 2, 1.2, 0.1, matt(own, '#2f3640'), 0, 1.65, 0.04));
    g.add(box(own, t.hw * 2 + 0.24, 0.16, 0.34, iron, 0, 2.36, 0.02));
    const face = new THREE.Mesh(
      own.keep(new THREE.PlaneGeometry(t.hw * 2 - 0.24, 1.0)),
      own.keep(new THREE.MeshBasicMaterial({
        map: surfaceOf(own, () => signBoard('BLACK CROWN', '#d8cba6', '#232a33', 'THIS WAY', 2.5),
                       1, 1, anisotropy),
        color: '#9d947e',
      }))
    );
    face.position.set(0, 1.65, 0.1);
    g.add(face);
    g.position.set(t.x, y, t.z);
    g.rotation.y = t.face ?? 0;
    root.add(g);
  };

  const draw: Record<string, (t: (typeof CROWN_THINGS)[number], i: number) => void> = {
    lamp: lampPost, bollard, planter, bench, stall, bin, crate, board: noticeBoard,
    /* The die is built above, with its plinth and its light. */
    dice: () => {},
  };
  CROWN_THINGS.forEach((t, i) => draw[t.kind]?.(t, i));

  /* ---- light ---- */

  /*
   * A wash across the front of the shop, and nothing else written here.
   *
   * The sun, the moon, the sky and the ground bounce all belong to `Sky` at the
   * top of this file, which is what lets the hour move. This is the one light
   * that is a fact about *this* building: ninety metres from the mouth of the
   * lane with a square in between, and it has to still be the brightest thing
   * in the frame from there, or the block has nothing to walk towards and is
   * only large. It goes out at dawn with the rest of them.
   */
  const facade = new THREE.PointLight('#ffc98c', 40, 38, 2);
  facade.position.set(FRONT - 11, BCY + 7.5, 3);
  root.add(facade);

  /* Every lamp in the block, found rather than listed. See `sky.ts`. */
  sky.claim();

  return {
    root,
    setTime: (hour) => { sky.apply(hour); },
    dispose() {
      for (const item of own.items) item.dispose();
    },
  };
}
