/**
 * The head, drawn the way an anime game draws one.
 *
 * The old head chased skull anatomy and painted features on with soft
 * airbrushed tints, and it landed in the valley: too real to be a character,
 * too simple to be a person. This one states its stylisation outright:
 *
 * - The **eyes are the face**. Each is a big, flat, painted plate — white,
 *   bold dark rim heavier along the top, a tall iris with a ring, a pupil,
 *   and one bright catchlight — sitting proud of the skull like a decal,
 *   which is exactly how the games this look comes from build theirs.
 * - The **nose is a suggestion**: one small wedge. The **mouth is a drawn
 *   line**. The **brows are solid strips** that float just off the skin, so
 *   they read at any distance and never alias into the mesh.
 * - The **hair is the character**. Every style is a mass of big, chunky,
 *   curved strands with real silhouettes — spikes, sweeps, tails — built
 *   from lofted wedges, cel-shaded, inked round the outside, and sprung by
 *   the pose so it follows a beat behind the body.
 *
 * Everything is still generated geometry and vertex colour; the only texture
 * anywhere is the shared 4-pixel toon ramp.
 */

import * as THREE from 'three';
import { EYE_COLORS, HAIR_COLORS, type StoryCharacter } from '@/story/character';
import { MeshBuilder, domeRings, sectionPoint, type Profile, sample } from './loft';
import { addOutline, toonMat } from './toon';

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * clamp01(t);
const smooth = (t: number) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

/* ------------------------------------------------------------------ */
/* The skull                                                           */
/* ------------------------------------------------------------------ */

/**
 * Chin to crown in H units: half-width, front, back, squareness.
 *
 * Anime skull: a wide, round cranium over a face that tapers hard to a small
 * chin. The front column is deliberately flat through the eye band so the
 * eye plates have a wall to sit against, and the occiput carries real depth
 * so the profile is a character's, not an egg's.
 */
const SKULL: Profile = [
  /* v      hw     front   back   square */
  [0.0, 0.09, 0.1, 0.055, 1.7],
  [0.06, 0.145, 0.175, 0.105, 1.8],
  [0.16, 0.215, 0.255, 0.17, 1.9],
  [0.28, 0.265, 0.285, 0.24, 2.0],
  [0.4, 0.315, 0.302, 0.315, 2.05],
  [0.52, 0.35, 0.315, 0.37, 2.1],
  [0.66, 0.378, 0.315, 0.41, 2.1],
  [0.78, 0.385, 0.3, 0.418, 2.05],
  [0.9, 0.35, 0.26, 0.38, 2.0],
  [0.97, 0.29, 0.208, 0.31, 2.0],
];

const SKULL_RINGS = 56;
const SKULL_SEG = 44;

/**
 * The eye line and the face features, in skull v.
 *
 * High, all of them: an anime face is a short lower face under big eyes, and
 * the first render of this head put the eyes at the anatomy books' 0.42 with
 * the mouth at 0.155 — which read as a long, mournful mid-face the moment it
 * was photographed. The features sit where the style says, not where the
 * skull chart does.
 */
const EYE_V = 0.46;
const BROW_V = 0.565;
const MOUTH_V = 0.19;
const NOSE_V = 0.35;

export interface HeadRig {
  /** Origin at the top of the neck, which is what the head turns about. */
  group: THREE.Group;
  /** Local y of the top of the skull, hair excluded. */
  crown: number;
  /** The hair mass, for the pose's follow-through spring. Null when shaved. */
  hair: THREE.Group | null;
  lidL: THREE.Group;
  lidR: THREE.Group;
  lidOpen: number;
  lidShut: number;
  dispose(): void;
}

/**
 * Builds the whole head: skull, eyes, lids, brows, nose, mouth, ears, hair,
 * facial hair.
 *
 * @param H head height in metres, chin to crown
 */
export function buildHead(spec: StoryCharacter, H: number, skinColor: THREE.Color): HeadRig {
  const kept: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T): T => {
    kept.push(x);
    return x;
  };

  const female = spec.sex === 'female';
  const group = new THREE.Group();

  /* Chin sits just above the neck pivot — an anime chin rides close to the
     collar, and most of what reads as "neck" belongs to the body's own
     stub. */
  const BASE = 0.085 * H;
  const y = (v: number) => BASE + v * H;

  /* ---------------- colours ---------------- */

  const hairColor = new THREE.Color(HAIR_COLORS[spec.hairColor] ?? HAIR_COLORS[0]);
  /* Age greys the hair before anything is derived from it, so brows and
     beard grey with it. */
  hairColor.lerp(new THREE.Color('#c9c6c2'), smooth((spec.age - 0.45) / 0.5) * 0.85);

  const skinT = keep(toonMat(skinColor, { vertexColors: true }));
  const eyeMat = keep(toonMat('#ffffff', { vertexColors: true }));
  const hairMat = keep(toonMat(hairColor, { vertexColors: true }));

  const LINE = 0.013 * H;

  const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, line = 0) => {
    keep(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    parent.add(mesh);
    if (line > 0) addOutline(parent, geo, line, keep);
    return mesh;
  };

  /* ---------------- the skull ---------------- */

  /** Jaw: 0 narrow and pointed, 1 wide with a corner. */
  const jawW = lerp(0.86, 1.14, spec.jaw);
  const jawSq = lerp(-0.1, 0.3, spec.jaw);

  const skullAt = (v: number, col: 1 | 2 | 3) => {
    let x = sample(SKULL, v, col) * H;
    if (col !== 2 && v < 0.34) x *= lerp(jawW, 1, v / 0.34);
    if (col === 1 && v < 0.34) x *= female ? 0.96 : 1;
    return x;
  };
  const skullSq = (v: number) => sample(SKULL, v, 4) + (v < 0.3 ? jawSq * (1 - v / 0.3) : 0);

  /* Paint: the toon face carries almost nothing — a drawn mouth, a lip, a
     faint blush — and states each with a hard edge. */
  const MOUTH_INK = new THREE.Color(0.32, 0.18, 0.2);
  const LIP = new THREE.Color(1.0, 0.72, 0.68);
  const BLUSH = new THREE.Color(1.05, 0.9, 0.9);
  const STUBBLE = new THREE.Color(0.88, 0.84, 0.84);

  const mouthHalf = lerp(0.085, 0.125, spec.mouth) * H;
  /** The mouth's cast: 0 a slight frown, 0.5 level, 1 an upturn. */
  const mouthCurve = lerp(0.016, -0.016, spec.mouth) * H;

  const stubbled = spec.facialHair === 'stubble';

  const paintSkull = (px: number, py: number, pz: number): THREE.Color | undefined => {
    const v = (py - BASE) / H;
    /* Only the front of the face carries paint. */
    if (pz < 0.05 * H) return undefined;
    const ax = Math.abs(px);

    /* The mouth: one drawn line with a hint of curve, and a lip below it. */
    const my = y(MOUTH_V) + mouthCurve * (ax / mouthHalf) ** 2;
    if (ax < mouthHalf && Math.abs(py - my) < 0.012 * H) return MOUTH_INK;
    if (female && ax < mouthHalf * 0.82 && py < my && py > my - 0.032 * H) return LIP;

    /* Blush, high on the cheek, young faces only. */
    if (female && spec.age < 0.55) {
      const bx = ax - 0.2 * H;
      const by = py - y(0.36);
      if ((bx * bx) / (0.052 * H * 0.052 * H) + (by * by) / (0.03 * H * 0.03 * H) < 1) return BLUSH;
    }

    /* Stubble: a *suggestion* — a slightly cooler band hugging the jaw's
       edge, not a painted bib. The first pass masked the whole lower face
       and read as a muzzle from across the room. */
    if (stubbled && v < 0.13 && ax > 0.04 * H) return STUBBLE;

    return undefined;
  };

  {
    const m = new MeshBuilder();
    const rings: number[][] = [];
    for (let i = 0; i <= SKULL_RINGS; i++) {
      const v = (i / SKULL_RINGS) * 0.97;
      const hw = skullAt(v, 1);
      const fr = skullAt(v, 2);
      const bk = skullAt(v, 3);
      const sq = skullSq(v);
      const ring: number[] = [];
      for (let k = 0; k < SKULL_SEG; k++) {
        const a = (k / SKULL_SEG) * Math.PI * 2;
        const q = sectionPoint(hw, fr, bk, sq, a);
        const tint = paintSkull(q.x, y(v), q.z);
        ring.push(m.vertex(q.x, y(v), q.z, tint));
      }
      rings.push(ring);
    }
    /* Close the crown with an arc, tangent where it leaves the table. */
    const rTop = skullAt(0.97, 1);
    const slope = (skullAt(0.97, 1) - skullAt(0.9, 1)) / (0.07 * H);
    const dome = domeRings(rTop, Math.min(-0.2, slope), 5);
    for (let d = 1; d < dome.length; d++) {
      const { scale, rise } = dome[d];
      const ring: number[] = [];
      for (let k = 0; k < SKULL_SEG; k++) {
        const a = (k / SKULL_SEG) * Math.PI * 2;
        const q = sectionPoint(rTop * scale, skullAt(0.97, 2) * scale, skullAt(0.97, 3) * scale, 2, a);
        ring.push(m.vertex(q.x, y(0.97) + rise, q.z));
      }
      if (ring.length) rings.push(ring);
    }
    m.loft(rings);
    const apex = m.vertex(0, y(0.97) + dome[dome.length - 1].rise + 0.002 * H, 0);
    m.cap(rings[rings.length - 1], apex, 1);
    const chin = m.vertex(0, y(0) - 0.01 * H, 0.02 * H);
    m.cap(rings[0], chin, -1);
    add(group, m.build(), skinT, LINE);
  }

  /* ---------------- ears ---------------- */

  for (const side of [1, -1] as const) {
    const m = new MeshBuilder();
    const ex = skullAt(0.44, 1) * 0.98;
    const rows = 5;
    const rings: number[][] = [];
    for (let i = 0; i <= rows; i++) {
      const t = i / rows;
      const r = Math.sin(Math.PI * Math.min(1, 0.15 + t * 0.85)) * 0.05 * H;
      const ring: number[] = [];
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        ring.push(
          m.vertex(
            side * (ex + t * 0.028 * H),
            y(0.4) + Math.cos(a) * r * 1.25 + 0.01 * H,
            -0.045 * H + Math.sin(a) * r * (side === 1 ? 1 : -1)
          )
        );
      }
      rings.push(ring);
    }
    m.loft(rings);
    add(group, m.build(), skinT);
  }

  /* ---------------- eyes ---------------- */

  const eyeW = lerp(0.225, 0.19, spec.eyeShape) * H * (female ? 1.05 : 1);
  const eyeH = lerp(0.17, 0.115, spec.eyeShape) * H * (female ? 1.1 : 1);
  const eyeX = 0.152 * H;
  const eyeColor = new THREE.Color(EYE_COLORS[spec.eyeColor] ?? EYE_COLORS[0]);
  const irisDark = eyeColor.clone().multiplyScalar(0.42);
  const irisLight = eyeColor.clone().lerp(new THREE.Color('#ffffff'), 0.45);
  const RIM = new THREE.Color(0.14, 0.09, 0.11);
  const SCLERA = new THREE.Color(0.985, 0.975, 0.965);
  const PUPIL = new THREE.Color(0.05, 0.04, 0.05);
  const GLINT = new THREE.Color(1.6, 1.6, 1.6);

  /** Where the face wall is at the eye line, for placing plates and lids. */
  const faceZ = skullAt(EYE_V, 2) * 0.93;

  /**
   * One eye: an elliptical painted plate, shallow-domed, sitting proud of
   * the face like the decal it is in every game this style comes from.
   *
   * The geometry is a grid *clamped to the ellipse* — vertices outside r = 1
   * collapse onto the rim — so the plate's edge IS the eye's outline and no
   * rectangle corner ever shows. The paint is a fixed stack, innermost
   * winning: sclera, iris (light at the centre, ringed dark), pupil, one
   * catchlight, and the dark rim drawn last so it always closes the shape.
   * The catchlight sits top-left in *view* on both eyes — shared, not
   * mirrored — which is the convention every animated face is read by.
   */
  const eyePlate = (side: 1 | -1) => {
    const m = new MeshBuilder();
    /* Dense enough that the iris rings read as drawn curves at the booth's
       face framing — the closest look the game ever takes. */
    const NU = 28;
    const NV = 20;
    const grid: number[][] = [];
    for (let iv = 0; iv <= NV; iv++) {
      const w0 = (iv / NV) * 2 - 1;
      const row: number[] = [];
      for (let iu = 0; iu <= NU; iu++) {
        const u0 = (iu / NU) * 2 - 1;
        const r0 = Math.hypot(u0, w0);
        /* Clamp to the ellipse: the plate is eye-shaped, not card-shaped. */
        const cl = r0 > 1 ? 1 / r0 : 1;
        const u = u0 * cl;
        const w = w0 * cl;
        const r = Math.min(1, r0);
        const bulge = Math.sqrt(Math.max(0, 1 - r * r)) * 0.016 * H;

        /* ---- the paint stack ---- */
        let tint = SCLERA;
        const iu2 = (u + side * 0.08) / 0.5;
        const iw2 = (w + 0.04) / 0.8;
        const ir = Math.hypot(iu2, iw2);
        if (ir < 1) {
          tint = irisLight.clone().lerp(eyeColor, smooth(ir * 1.05));
          if (ir > 0.78) tint = irisDark;
          /* Lash shadow across the top of the iris. */
          if (iw2 > 0.42) tint = irisDark;
          if (Math.hypot(iu2 / 0.44, iw2 / 0.5) < 1) tint = PUPIL;
          if (Math.hypot((u + side * 0.08 - 0.13) / 0.13, (w - 0.3) / 0.16) < 1) tint = GLINT;
        }
        /* The rim, always last: the drawn outline of the eye, heavier along
           the top where the lashes are. */
        if (r0 > 0.86) tint = RIM;
        if (w > 0.6 && r0 > 0.5) tint = RIM;
        if (female && w < -0.6 && u * side > 0.5) tint = RIM;

        row.push(m.vertex(u * eyeW * 0.5, w * eyeH * 0.5, bulge, tint));
      }
      grid.push(row);
    }
    for (let iv = 0; iv < NV; iv++) {
      for (let iu = 0; iu < NU; iu++) {
        m.quad(grid[iv][iu], grid[iv][iu + 1], grid[iv + 1][iu + 1], grid[iv + 1][iu]);
      }
    }
    const mesh = add(group, m.build(), eyeMat);
    mesh.position.set(side * eyeX, y(EYE_V), faceZ);
    mesh.rotation.y = side * 0.22;
    mesh.rotation.x = -0.05;
    return mesh;
  };
  eyePlate(1);
  eyePlate(-1);

  /* Lids: a skin plate hinged at the eye's top edge. Open, it is the upper
     lid's line; shut, it curtains the whole plate. The blink is a rotation,
     driven by the body's pose through the joints below. */
  const lidOpen = -0.18;
  const lidShut = -1.15;
  const buildLid = (side: 1 | -1) => {
    const hinge = new THREE.Group();
    hinge.position.set(side * eyeX, y(EYE_V) + eyeH * 0.5, faceZ + 0.012 * H);
    hinge.rotation.y = side * 0.24;
    group.add(hinge);
    const m = new MeshBuilder();
    const NU = 10;
    const rows: number[][] = [];
    for (let iv = 0; iv <= 4; iv++) {
      const t = iv / 4;
      const row: number[] = [];
      for (let iu = 0; iu <= NU; iu++) {
        const u = (iu / NU) * 2 - 1;
        const wobble = Math.sqrt(Math.max(0, 1 - u * u));
        row.push(m.vertex(u * eyeW * 0.56, -t * eyeH * 1.08 * wobble, 0.012 * H * wobble * (1 - t * 0.4)));
      }
      rows.push(row);
    }
    for (let iv = 0; iv < 4; iv++) {
      for (let iu = 0; iu < NU; iu++) {
        m.quad(rows[iv][iu], rows[iv][iu + 1], rows[iv + 1][iu + 1], rows[iv + 1][iu]);
      }
    }
    add(hinge, m.build(), skinT);
    hinge.rotation.x = lidOpen;
    return hinge;
  };
  const lidL = buildLid(1);
  const lidR = buildLid(-1);

  /* ---------------- brows ---------------- */

  const browTint = new THREE.Color(0.42, 0.35, 0.36);
  for (const side of [1, -1] as const) {
    const m = new MeshBuilder();
    const len = eyeW * 1.15;
    const thick = lerp(0.02, 0.034, spec.brow) * H * (female ? 0.7 : 1);
    /** Brow cast: 0 a gentle arc, 1 a hard determined slant. */
    const slant = lerp(-0.008, 0.045, spec.brow) * H;
    const rows: number[][] = [];
    for (let iv = 0; iv <= 1; iv++) {
      const row: number[] = [];
      for (let iu = 0; iu <= 8; iu++) {
        const t = iu / 8;
        const bx = side * (eyeX - eyeW * 0.55 + t * len);
        const arch = Math.sin(t * Math.PI) * 0.012 * H;
        const by = y(BROW_V) + arch - t * slant + iv * thick;
        row.push(m.vertex(bx, by, faceZ + 0.016 * H - t * 0.012 * H, browTint));
      }
      rows.push(row);
    }
    for (let iu = 0; iu < 8; iu++) {
      if (side === 1) m.quad(rows[0][iu], rows[0][iu + 1], rows[1][iu + 1], rows[1][iu]);
      else m.quad(rows[0][iu + 1], rows[0][iu], rows[1][iu], rows[1][iu + 1]);
    }
    const mesh = add(group, m.build(), hairMat);
    mesh.material = hairMat;
  }

  /* ---------------- nose ---------------- */

  {
    /* The anime nose: one small, sharp wedge — its point is the whole
       feature, and the profile is where it earns its place. */
    const m = new MeshBuilder();
    const rows: number[][] = [];
    for (let i = 0; i <= 4; i++) {
      const t = i / 4;
      const v = NOSE_V - 0.045 + t * 0.085;
      const w = lerp(0.034, 0.008, t) * H;
      const stand = Math.sin(Math.PI * Math.min(1, 0.2 + t * 0.85)) * 0.058 * H;
      const ring: number[] = [];
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const q = sectionPoint(w, stand + 0.004 * H, 0.002 * H, 1.7, a);
        ring.push(m.vertex(q.x, y(v), skullAt(v, 2) * 0.97 + q.z));
      }
      rows.push(ring);
    }
    m.loft(rows);
    add(group, m.build(), skinT);
  }

  /* ---------------- hair ---------------- */

  const TIPDARK = new THREE.Color(0.8, 0.78, 0.82);
  let hairGroup: THREE.Group | null = null;

  /** One chunky strand: a curved, tapering wedge from a scalp point. */
  const strand = (
    m: MeshBuilder,
    px: number,
    py: number,
    pz: number,
    dx: number,
    dy: number,
    dz: number,
    len: number,
    w: number,
    curl: number
  ) => {
    const d = Math.hypot(dx, dy, dz) || 1;
    const ux = dx / d;
    const uy = dy / d;
    const uz = dz / d;
    /* A side vector for the ribbon's width. */
    let sx = -uz;
    let sz = ux;
    const sl = Math.hypot(sx, 0, sz) || 1;
    sx /= sl;
    sz /= sl;
    const rings: number[][] = [];
    const ROWS = 5;
    for (let i = 0; i <= ROWS; i++) {
      const t = i / ROWS;
      const taper = 1 - t * t;
      const wt = w * Math.max(0.06, taper);
      /* The curl bends the strand tip-down (or wherever `curl` points). */
      const cx = px + ux * len * t;
      const cy = py + uy * len * t - curl * len * t * t;
      const cz = pz + uz * len * t - curl * len * t * t * 0.3;
      const ring: number[] = [];
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const q = sectionPoint(wt, wt * 0.62, wt * 0.62, 1.7, a);
        const tint = t > 0.7 ? TIPDARK : undefined;
        ring.push(m.vertex(cx + sx * q.x + ux * 0, cy + q.z * 0.4, cz + sz * q.x + q.z * 0.6, tint));
      }
      rings.push(ring);
    }
    m.loft(rings);
    const tip = m.vertex(px + ux * len, py + uy * len - curl * len, pz + uz * len - curl * len * 0.3, TIPDARK);
    m.cap(rings[ROWS], tip, 1);
  };

  /** A point on the scalp with its outward direction, by azimuth and v. */
  const scalp = (a: number, v: number) => {
    const hw = skullAt(v, 1);
    const fr = skullAt(v, 2);
    const bk = skullAt(v, 3);
    const q = sectionPoint(hw, fr, bk, skullSq(v), a);
    const r = Math.hypot(q.x, q.z) || 1;
    return { x: q.x, y: y(v), z: q.z, nx: q.x / r, nz: q.z / r };
  };

  /**
   * The base cap: an inflated copy of the scalp above the hairline, so the
   * strands always have a solid mass under them and scalp never shows
   * through. The hairline sits *low* — an anime forehead is mostly fringe —
   * and drops further at the temples and nape.
   */
  const cap = (m: MeshBuilder, hairlineFront: number, inflate: number) => {
    const rings: number[][] = [];
    const STEPS = 12;
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      const ring: number[] = [];
      for (let k = 0; k < SKULL_SEG; k++) {
        const a = (k / SKULL_SEG) * Math.PI * 2;
        const away = Math.abs(a > Math.PI ? a - Math.PI * 2 : a) / Math.PI;
        const v0 = hairlineFront - 0.3 * smooth(away * 1.4);
        const v = lerp(v0, 0.99, t);
        /* Snug at the crown: the cap is the base coat, and the strands are
           the silhouette — a cap that balloons swallows them whole. */
        const swell = inflate * (1 - 0.3 * t);
        const hw = skullAt(v, 1) + swell;
        const fr = skullAt(v, 2) + swell * (v > hairlineFront + 0.04 ? 1 : 0.35);
        const bk = skullAt(v, 3) + swell;
        const q = sectionPoint(hw, fr, bk, skullSq(v), a);
        ring.push(m.vertex(q.x, y(v) + t * inflate * 0.5, q.z));
      }
      rings.push(ring);
    }
    m.loft(rings);
    const apex = m.vertex(0, y(0.99) + inflate * 1.1, -0.015 * H);
    m.cap(rings[STEPS], apex, 1);
  };

  const buildHair = () => {
    const id = spec.hair;
    if (id === 'shaved') return null;
    const g = new THREE.Group();
    group.add(g);
    const m = new MeshBuilder();

    /* The fringe: a solid bang of *overlapping* wide strands. The first
       pass spaced them apart and the forehead wore a row of teeth; hair
       chunks have to share their edges to read as one mass. */
    const fringe = (n: number, v: number, len: number, w: number) => {
      for (let i = 0; i < n; i++) {
        const a = ((i + 0.5) / n - 0.5) * 1.45;
        const p = scalp(a, v);
        const stagger = 1 + 0.15 * Math.sin(i * 2.6);
        strand(m, p.x, p.y + 0.02 * H, p.z - 0.012 * H, p.nx * 0.22, -0.85, p.nz * 0.38, len * stagger, w * 2.1, 0.08);
      }
    };

    switch (id) {
      case 'crop': {
        cap(m, 0.62, 0.032 * H);
        fringe(5, 0.64, 0.1 * H, 0.045 * H);
        break;
      }
      case 'swept': {
        cap(m, 0.64, 0.038 * H);
        /* Swept back: ridges rising off the forehead, streaming over the
           crown, tips kicking *up* at the back — the flick is the style. */
        for (let i = 0; i < 6; i++) {
          const a = ((i + 0.5) / 6 - 0.5) * 1.9;
          const p = scalp(a, 0.84);
          strand(m, p.x, p.y - 0.005 * H, p.z + 0.02 * H, p.nx * 0.25, 0.85, -0.9, 0.38 * H, 0.08 * H, -0.16);
        }
        for (let i = 0; i < 3; i++) {
          const a = Math.PI + (i / 2 - 0.5) * 1.2;
          const p = scalp(a, 0.52);
          strand(m, p.x, p.y, p.z, p.nx * 0.3, -0.35, p.nz * 0.9, 0.2 * H, 0.06 * H, -0.22);
        }
        break;
      }
      case 'spiked': {
        cap(m, 0.6, 0.034 * H);
        /* The hero head: big spikes swept up and back, smaller at the
           temples, every one placed by hand off the midline. */
        const spikes: [number, number, number, number, number][] = [
          /* a, v, up, back, len */
          [0.0, 0.86, 1.15, -0.2, 0.42],
          [0.55, 0.83, 1.0, -0.05, 0.38],
          [-0.55, 0.83, 1.0, -0.05, 0.38],
          [1.1, 0.74, 0.8, 0.15, 0.34],
          [-1.1, 0.74, 0.8, 0.15, 0.34],
          [1.9, 0.76, 0.75, 0.5, 0.36],
          [-1.9, 0.76, 0.75, 0.5, 0.36],
          [2.7, 0.8, 0.9, 0.65, 0.4],
          [-2.7, 0.8, 0.9, 0.65, 0.4],
          [Math.PI, 0.84, 1.0, 0.75, 0.44],
        ];
        for (const [a, v, up, back, len] of spikes) {
          const p = scalp(a, v);
          strand(m, p.x, p.y - 0.012 * H, p.z, p.nx * 0.55, up, p.nz * 0.55 - back, len * H, 0.098 * H, 0.06);
        }
        fringe(5, 0.62, 0.14 * H, 0.052 * H);
        break;
      }
      case 'curtain': {
        cap(m, 0.6, 0.034 * H);
        for (const side of [1, -1] as const) {
          const p = scalp(side * 0.75, 0.6);
          strand(m, p.x, p.y, p.z + 0.01 * H, side * 0.25, -1, 0.06, 0.42 * H, 0.085 * H, 0.05);
        }
        for (let i = 0; i < 5; i++) {
          const a = Math.PI + ((i + 0.5) / 5 - 0.5) * 2.4;
          const p = scalp(a, 0.5);
          strand(m, p.x, p.y, p.z, p.nx * 0.3, -1, p.nz * 0.4, 0.3 * H, 0.07 * H, 0.05);
        }
        break;
      }
      case 'wild': {
        cap(m, 0.6, 0.036 * H);
        for (let i = 0; i < 11; i++) {
          const a = (i / 11) * Math.PI * 2;
          const v = 0.72 + 0.12 * Math.sin(i * 2.7);
          const p = scalp(a, v);
          const up = 0.5 + 0.6 * Math.abs(Math.sin(i * 1.9));
          strand(m, p.x, p.y, p.z, p.nx * 0.85, up, p.nz * 0.85, (0.3 + 0.12 * Math.sin(i * 3.1)) * H, 0.065 * H, 0.22);
        }
        fringe(5, 0.62, 0.14 * H, 0.05 * H);
        break;
      }
      case 'long': {
        cap(m, 0.62, 0.036 * H);
        fringe(6, 0.64, 0.12 * H, 0.05 * H);
        /* Big face-framing curtains falling past the jaw to the chest, then
           a full back mass ending in points. The curtains are what read
           from the front — they are most of what "long" means there. */
        for (const side of [1, -1] as const) {
          const p = scalp(side * 0.8, 0.58);
          strand(m, p.x, p.y + 0.02 * H, p.z + 0.03 * H, side * 0.16, -1, 0.03, 0.62 * H, 0.125 * H, 0.03);
          const p2 = scalp(side * 1.35, 0.55);
          strand(m, p2.x, p2.y + 0.01 * H, p2.z, side * 0.24, -1, -0.05, 0.55 * H, 0.1 * H, 0.04);
        }
        for (let i = 0; i < 7; i++) {
          const a = Math.PI + ((i + 0.5) / 7 - 0.5) * 2.4;
          const p = scalp(a, 0.55);
          strand(m, p.x, p.y, p.z - 0.01 * H, p.nx * 0.22, -1, p.nz * 0.3 - 0.06, 0.66 * H, 0.095 * H, 0.03);
        }
        break;
      }
      case 'ponytail': {
        cap(m, 0.64, 0.034 * H);
        fringe(6, 0.66, 0.12 * H, 0.048 * H);
        const p = scalp(Math.PI, 0.88);
        /* The tie. */
        const tie = keep(new THREE.SphereGeometry(0.05 * H, 10, 8));
        const tieMesh = new THREE.Mesh(tie, keep(toonMat('#2a2126')));
        tieMesh.position.set(0, p.y, p.z - 0.01 * H);
        g.add(tieMesh);
        strand(m, p.x, p.y + 0.01 * H, p.z - 0.03 * H, 0, -0.35, -1, 0.55 * H, 0.075 * H, 0.5);
        strand(m, p.x, p.y, p.z - 0.02 * H, 0.12, -0.5, -0.9, 0.45 * H, 0.055 * H, 0.42);
        break;
      }
      case 'topknot': {
        cap(m, 0.6, 0.03 * H);
        const p = scalp(0, 0.96);
        const tie = keep(new THREE.SphereGeometry(0.045 * H, 10, 8));
        const tieMesh = new THREE.Mesh(tie, keep(toonMat('#2a2126')));
        tieMesh.position.set(0, p.y + 0.03 * H, -0.045 * H);
        g.add(tieMesh);
        strand(m, 0, p.y + 0.02 * H, -0.05 * H, 0, 1, -0.3, 0.26 * H, 0.075 * H, 0.42);
        break;
      }
      case 'braids': {
        cap(m, 0.62, 0.03 * H);
        fringe(4, 0.64, 0.09 * H, 0.045 * H);
        for (let i = 0; i < 4; i++) {
          const a = Math.PI + (i / 3 - 0.5) * 1.7;
          const p = scalp(a, 0.6);
          /* A braid is a strand with a beaded taper — rebuilt as three short
             strands end to end reads as segments without a new builder. */
          const px = p.x;
          let py = p.y;
          let pz = p.z;
          for (let seg2 = 0; seg2 < 3; seg2++) {
            strand(m, px, py, pz, p.nx * 0.08, -1, p.nz * 0.12 - 0.03, 0.17 * H, (0.042 - seg2 * 0.008) * H, 0.05);
            py -= 0.16 * H;
            pz -= 0.012 * H;
          }
        }
        break;
      }
      case 'mohawk': {
        cap(m, 0.75, 0.014 * H);
        /* The crest rides the midline by construction — placed at x = 0,
           driven by distance along the skull, never by azimuth. */
        for (let i = 0; i < 6; i++) {
          const t = i / 5;
          const v = lerp(0.55, 0.92, 1 - Math.abs(t - 0.5) * 0.5);
          const front = lerp(0.26, -0.32, t) * H;
          const p = { x: 0, y: y(Math.min(0.97, v + 0.08)), z: front };
          strand(m, p.x, p.y, p.z, 0, 1, t < 0.5 ? 0.15 : -0.2, 0.36 * H, 0.062 * H, 0.05);
        }
        break;
      }
      case 'bun': {
        cap(m, 0.62, 0.032 * H);
        fringe(5, 0.64, 0.1 * H, 0.045 * H);
        const bun = keep(new THREE.SphereGeometry(0.14 * H, 14, 10));
        const bunMesh = new THREE.Mesh(bun, hairMat);
        bunMesh.castShadow = true;
        bunMesh.position.set(0, y(0.9), -skullAt(0.9, 3) - 0.05 * H);
        g.add(bunMesh);
        addOutline(g, bun, LINE, keep).position.copy(bunMesh.position);
        break;
      }
      default:
        cap(m, 0.62, 0.03 * H);
    }

    add(g, m.build(), hairMat, LINE);
    return g;
  };
  hairGroup = buildHair();

  /* ---------------- facial hair ---------------- */

  if (spec.facialHair !== 'none' && spec.facialHair !== 'stubble') {
    const m = new MeshBuilder();
    const kind = spec.facialHair;
    /* Every beard stays clear of the mouth: the drawn line is the face's
       one expression, and the first full beard buried it under a bib. */
    const moustache = () => {
      for (const side of [1, -1] as const) {
        strand(
          m,
          side * 0.012 * H,
          y(MOUTH_V) + 0.028 * H,
          skullAt(0.24, 2) * 0.95,
          side * 0.95,
          -0.28,
          0.08,
          0.062 * H,
          0.02 * H,
          0.06
        );
      }
    };
    if (kind === 'moustache') moustache();
    if (kind === 'goatee') {
      moustache();
      strand(m, 0, y(0.05), skullAt(0.04, 2) * 0.88, 0, -1, 0.3, 0.085 * H, 0.042 * H, -0.04);
    }
    if (kind === 'full') {
      /* A chunky jaw band from below the mouth down round the chin, ending
         in three points — a drawn beard, not fur. */
      const rows: number[][] = [];
      for (let i = 0; i <= 4; i++) {
        const t = i / 4;
        const v = lerp(0.15, 0.01, t);
        const swellT = Math.sin(Math.PI * Math.min(1, 0.25 + t * 0.75));
        const ring: number[] = [];
        for (let k = 0; k <= 12; k++) {
          const a = -1.3 + (2.6 * k) / 12;
          const hw = skullAt(v, 1) + 0.024 * H * swellT;
          const fr = skullAt(v, 2) + 0.026 * H * swellT;
          const q = sectionPoint(hw, fr, fr, skullSq(v), a);
          ring.push(m.vertex(q.x, y(v) - t * 0.04 * H, q.z));
        }
        rows.push(ring);
      }
      for (let i = 0; i < 4; i++) {
        for (let k = 0; k < 12; k++) {
          m.quad(rows[i][k], rows[i][k + 1], rows[i + 1][k + 1], rows[i + 1][k]);
        }
      }
      for (const side of [0, 1, -1] as const) {
        strand(m, side * 0.055 * H, y(0.015), skullAt(0.015, 2) * 0.78 + 0.02 * H, side * 0.22, -1, 0.12, 0.08 * H, 0.032 * H, 0);
      }
      moustache();
    }
    if (kind === 'sideburns') {
      for (const side of [1, -1] as const) {
        strand(m, side * skullAt(0.4, 1) * 0.92, y(0.42), 0.02 * H, side * 0.1, -1, 0.35, 0.16 * H, 0.045 * H, 0);
      }
    }
    const beardMat = keep(toonMat(hairColor.clone().multiplyScalar(0.62)));
    add(group, m.build(), beardMat, LINE * 0.7);
  }

  const crown = y(1) + 0.02 * H;

  return {
    group,
    crown,
    hair: hairGroup,
    lidL,
    lidR,
    lidOpen,
    lidShut,
    dispose() {
      kept.forEach((k) => k.dispose());
    },
  };
}
