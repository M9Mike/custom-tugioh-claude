/**
 * The duelist's head.
 *
 * This is the part of the model people actually look at, so it is the part
 * that gets the measurements. Everything below is in *head units*: the table
 * is written against a head of height 1, and multiplied by `H` at the end, so
 * the numbers can be checked against a life-drawing canon rather than against
 * whatever looked right in one render at one distance.
 *
 * The canon this follows, chin at 0 and crown at 1:
 *
 *   0.00  chin        0.29  base of the nose   0.65  mid-forehead
 *   0.17  mouth       0.50  eye line           0.74  hairline
 *   0.09  chin front  0.57  brow ridge         1.00  crown
 *
 * and the two ratios that decide whether a head reads as a head at all:
 * breadth is 0.66 of height, and depth — glabella to the back of the skull —
 * is 0.83. A head modelled from a sphere gets both of those wrong at once,
 * which is why it always comes out looking like an egg with a face drawn on.
 *
 * The skull, the lips, the chin and the brow are all one lofted surface. The
 * nose and the ears are separate closed forms that intersect it. That is a
 * deliberate cheat and a very old one: an opaque surface poking through
 * another opaque surface has no seam to give it away, and it buys a nose with
 * a real underside and real nostrils instead of a bump on a cheek.
 */

import * as THREE from 'three';
import { EYE_COLORS, HAIR_COLORS, type StoryCharacter } from '@/story/character';
import { MeshBuilder, type Profile, domeRings, fromFront, sample, sectionPoint } from './loft';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v: number) => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};

/**
 * A soft window: 0 outside `lo..hi`, 1 in the middle, smooth at both edges.
 *
 * Every facial feature below is a window in height crossed with a window in
 * either azimuth or width. Saying "the brow ridge lives between 0.53 and 0.64
 * and stops before the temple" is a thing you can read and argue with; a sum
 * of Gaussians with hand-tuned sigmas is not.
 */
const win = (v: number, lo: number, hi: number) => {
  if (v <= lo || v >= hi) return 0;
  const t = (v - lo) / (hi - lo);
  return Math.sin(Math.PI * t) ** 2;
};

const smoothEdge = (v: number, a: number, b: number) => smooth((v - a) / (b - a));

/**
 * Overlapping regions, combined without a crease.
 *
 * `Math.max` is the obvious way to say "the beard grows here *or* here", and
 * it is wrong: where the winning term changes the result has a kink, and a
 * kink in a mask is a visible line across the cheek — which is how a clean
 * stubble ended up looking like a scar. This is the probabilistic union, which
 * is smooth wherever its inputs are.
 */
const union = (...xs: number[]): number => 1 - xs.reduce((p, x) => p * (1 - clamp01(x)), 1);

/**
 * How far forward of the head's mid-plane a point lies, 0..1.
 *
 * Every feature on a face — the socket shadow, the warmth over the cheekbone,
 * the brow, a beard — belongs to the front of the head and has to stop
 * somewhere on the way round. `z > 0 ? 1 : 0` is the obvious way to say that,
 * and it is a cliff: the plane it stops on runs from the temple, down in front
 * of the ear and along the jaw, and at sixty segments around the head a
 * full-strength colour that ends on it is a staircase cut into the side of the
 * face. It looked like the face had been masked off and sprayed. A ramp about
 * a centimetre wide reads as the same boundary and has no edge in it.
 */
const frontness = (z: number, H: number) => smooth(z / (0.07 * H));

/** Where the head group's origin sits, as a fraction of head height. */
const PIVOT_V = 0.32;

/**
 * The skull's tessellation — shared, not a local choice.
 *
 * The beard is a shell that lifts out of the skin, so its visible edge is
 * wherever it crosses the skull. Two grids of flat facets sampled at different
 * places cross each other unevenly, and the edge comes out as a torn stair —
 * which is what a full beard looked like at 76 × 36 against a 60 × 66 head.
 * Sampled at the *same* points the two surfaces differ only by a radial
 * offset, so the crossing follows one grid and reads as a shaved line.
 */
const SKULL_RINGS = 66;
const SKULL_SEG = 60;

/** The eye line, which is the vertical middle of every head there has ever been. */
const EYE_V = 0.5;
/** Half the distance between the pupils. 63 mm on a 230 mm head. */
const EYE_X = 0.139;
/** The eyeball. 12 mm across on that same head, and unforgiving about it. */
const EYE_R = 0.052;
/** The opening between the lids, as half-width and half-height. */
const FISSURE_W = 0.055;
const FISSURE_H = 0.021;

/**
 * The skull in section: height, half-breadth, how far the front reaches, how
 * far the back reaches, and how square the corner is.
 *
 * The squareness column is what gives the lower face its planes. A jaw at 2.8
 * has a corner you can see turn; the same jaw at 2.0 is a cylinder, and the
 * face above it has nothing to sit on.
 */
const SKULL: Profile = [
  /* v      hw     front   back    square */
  [0.0, 0.085, 0.235, 0.075, 2.3],
  [0.04, 0.132, 0.286, 0.15, 2.5],
  [0.1, 0.17, 0.302, 0.225, 2.7], // chin
  [0.165, 0.208, 0.306, 0.298, 2.8], // mouth
  [0.235, 0.243, 0.298, 0.362, 2.95], // jaw, at its corner
  [0.295, 0.276, 0.288, 0.412, 2.7], // base of the nose
  [0.365, 0.302, 0.278, 0.458, 2.5],
  [0.44, 0.324, 0.268, 0.5, 2.3], // cheekbone
  [0.5, 0.332, 0.256, 0.521, 2.2], // eye line
  [0.575, 0.331, 0.278, 0.535, 2.2], // brow
  [0.65, 0.332, 0.282, 0.54, 2.1], // widest, and the back of the skull
  [0.74, 0.325, 0.268, 0.534, 2.05],
  [0.83, 0.299, 0.234, 0.497, 2.0],
  [0.905, 0.25, 0.188, 0.424, 2.0],
  [0.96, 0.184, 0.136, 0.322, 2.0],
  [1.0, 0.062, 0.046, 0.128, 2.0],
];

/**
 * The nose, as its own stack of rings: height, half-width, how far it stands
 * off the face, and how deep the ring is.
 *
 * Read bottom-up it is the columella, the nostril plane, the wings, the tip,
 * then the bridge thinning back into the brow. The first and last rows stand
 * off by a negative amount, which parks their end caps safely inside the skull
 * where nobody can see them.
 */
const NOSE: Profile = [
  /* v      halfW   stand   depth */
  [0.283, 0.054, -0.028, 0.028],
  [0.292, 0.066, 0.014, 0.034],
  [0.301, 0.078, 0.044, 0.046],
  [0.312, 0.08, 0.058, 0.052], // wings
  [0.332, 0.068, 0.064, 0.056], // tip
  [0.365, 0.06, 0.054, 0.05],
  [0.41, 0.049, 0.046, 0.043],
  [0.46, 0.046, 0.031, 0.044],
  [0.508, 0.045, 0.016, 0.046],
  [0.548, 0.044, -0.018, 0.046], // the nasion, buried
];

/* Multipliers on the skin material. Tints, not colours: a lip written as a
   factor stays a lip on every skin tone in the palette, where a hex value is
   only ever right for one of them. */
const LIP = new THREE.Color(1.0, 0.68, 0.63);
const SEAM = new THREE.Color(0.58, 0.38, 0.36);
const LASH = new THREE.Color(0.24, 0.17, 0.16);
const WARM = new THREE.Color(1.08, 0.94, 0.92);
/** Occlusion: what collects in a crease. Cool, because skin in shadow is. */
const SHADE = new THREE.Color(0.6, 0.53, 0.53);
const NOSTRIL = new THREE.Color(0.3, 0.2, 0.19);
const UNDER = new THREE.Color(0.88, 0.84, 0.83);

export interface HeadRig {
  /** Origin at the top of the neck, which is what the head turns about. */
  group: THREE.Group;
  /** Local y of the top of the skull, hair excluded. */
  crown: number;
  lidL: THREE.Group;
  lidR: THREE.Group;
  lidOpen: number;
  lidShut: number;
  dispose(): void;
}

/**
 * Builds the whole head: skull, nose, ears, brows, eyes, lids, hair, beard.
 *
 * @param H head height in metres, chin to crown
 */
export function buildHead(spec: StoryCharacter, H: number, skinColor: THREE.Color): HeadRig {
  const kept: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T): T => {
    kept.push(x);
    return x;
  };

  const hairHex = HAIR_COLORS[spec.hairColor] ?? HAIR_COLORS[0];
  const hairColor = new THREE.Color(hairHex);
  /* Brows and stubble are hair lying on skin, so their tint is whatever turns
     this face's skin into this character's hair — which is a division, and is
     the reason it stays correct for every pairing in the palette rather than
     for the one it was eyeballed against. */
  const hairOnSkin = new THREE.Color(
    Math.min(4, hairColor.r / Math.max(0.04, skinColor.r)),
    Math.min(4, hairColor.g / Math.max(0.04, skinColor.g)),
    Math.min(4, hairColor.b / Math.max(0.04, skinColor.b))
  );

  const y = (v: number) => (v - PIVOT_V) * H;

  /* ---------------- the skull surface ---------------- */

  /**
   * How far a point is from the centre of the nearest eye, as a fraction of
   * the palpebral fissure. 1 is the lid margin.
   *
   * The tilt term raises the outer corner of the eye above the inner one,
   * which every face has and no face looks right without — level eyes read as
   * a mask even when everything around them is correct.
   */
  const eyeD = (v: number, x: number) => {
    const off = Math.abs(x) / H - EYE_X;
    return Math.hypot(off / FISSURE_W, (v - EYE_V - off * 0.11) / FISSURE_H);
  };

  const jaw = spec.jaw;
  const brow = spec.brow;
  const age = spec.age;
  const mouthHalf = 0.086 + 0.046 * spec.mouth;

  /**
   * A point on the face, by height and azimuth.
   *
   * Azimuth is measured from straight ahead, so 0 is the tip of the nose and
   * ±π/2 the ears. Everything from the table is anatomy that every head has;
   * everything after it is this particular head.
   */
  const surface = (v: number, a: number) => {
    let hw = sample(SKULL, v, 1) * H;
    let front = sample(SKULL, v, 2) * H;
    const back = sample(SKULL, v, 3) * H;
    let sq = sample(SKULL, v, 4);

    /* The jaw knob widens and squares the mandible and pushes the chin
       forward, fading out before it reaches the cheekbone — a heavy jaw is a
       heavy *jaw*, and letting it leak upwards is how you get a face that
       changes width rather than shape. */
    const jawZone = win(v, -0.15, 0.44);
    hw *= 1 + (jaw - 0.5) * 0.32 * jawZone;
    sq += (jaw - 0.5) * 0.75 * jawZone;
    front += (jaw - 0.5) * 0.02 * H * win(v, -0.06, 0.26);

    const p = sectionPoint(hw, front, back, sq, a);
    let { x, z } = p;
    const ax = fromFront(a);
    const bx = Math.abs(x) / H;

    /* Brow ridge. Two lobes over the eyes and a lower bridge between them —
       the glabella — because a single band across the forehead reads as a
       headache rather than a skull. */
    const ridge =
      0.5 * win(ax, -0.26, 0.26) + win(ax, 0.08, 0.82) * (0.55 + 0.45 * brow);
    z += 0.034 * H * ridge * win(v, 0.515, 0.645);

    /* Eye sockets, cut back under the ridge so the eyeball has somewhere to
       sit, and the nasion pinched in between them. */
    z -= 0.026 * H * win(v, 0.44, 0.552) * win(ax, 0.06, 0.8);
    z -= 0.016 * H * win(v, 0.5, 0.585) * win(ax, -0.17, 0.17);

    /* Cheekbone out, and the hollow under it that deepens with age. */
    const zygo = win(v, 0.392, 0.502) * win(ax, 0.28, 1.06);
    x += Math.sign(x || 1) * 0.024 * H * zygo;
    z += 0.016 * H * zygo;
    const hollow = win(v, 0.25, 0.398) * win(ax, 0.34, 0.98);
    x -= Math.sign(x || 1) * (0.006 + 0.016 * age) * H * hollow;
    z -= (0.007 + 0.018 * age) * H * hollow;

    /* Temples, which are flat-to-hollow on everyone and are most of what makes
       a forehead look like bone rather than a dome. */
    x -= Math.sign(x || 1) * 0.017 * H * win(v, 0.5, 0.72) * win(ax, 0.7, 1.24);

    /* Lips: two cushions, the seam between them, the philtrum above and the
       crease below. All of it stops at the corner of the mouth. */
    const lipW = win(bx, -mouthHalf, mouthHalf);
    /* The philtrum notches the upper lip down at the centre line — a cupid's
       bow. Two millimetres, and the mouth stops being a stripe. */
    const bow = 0.009 * win(bx, -0.032, 0.032);
    z += 0.024 * H * lipW * (0.92 * win(v + bow, 0.208, 0.262) + win(v, 0.15, 0.212));
    /* The seam is a line, not a slot. At 3 mm deep it read as an open mouth. */
    z -= 0.009 * H * lipW * win(v, 0.192, 0.22);
    z -= 0.011 * H * win(bx, -0.032, 0.032) * win(v, 0.252, 0.3);
    z -= 0.009 * H * win(bx, -mouthHalf * 0.8, mouthHalf * 0.8) * win(v, 0.132, 0.168);

    /* The chin's own bump, which is not the same thing as the jaw. */
    z += 0.015 * H * win(bx, -0.1, 0.1) * win(v, 0.03, 0.14);

    /* Nasolabial fold — the line from the wing of the nose to the corner of
       the mouth. Barely there on a young face, unmissable on an old one. */
    z -= (0.004 + 0.016 * age) * H * win(bx, 0.05, 0.115) * win(v, 0.2, 0.32);

    /**
     * The opening between the lids, cut into the skull.
     *
     * Without it the head is a closed surface that runs straight across the
     * socket and the eyeball merely pokes through, which shows as a small
     * circle of iris in an otherwise blank face — no sclera, no corners, no
     * eye. Retreating the surface behind the ball inside the fissure turns the
     * rim of that retreat into the lid margin, so the lids come free with the
     * hole they surround. Front of the face only: the arithmetic finds the
     * same |x| on the back of the skull and would put an eye behind each ear.
     */
    if (z > 0) z -= 0.075 * H * (1 - smooth((eyeD(v, x) - 0.7) / 0.55));

    return { x, y: y(v), z };
  };

  /**
   * The tint at a point of the face. White means "leave the skin alone".
   *
   * Two jobs, and the second one is the one that matters. The first is
   * pigment: lips, brows, lashes, the warmth over the cheekbone. The second is
   * *occlusion* — the shadow that collects in the corner of an eye socket, at
   * the wing of the nose, under the lower lip, beneath the jaw. A real-time
   * face gets that from a baked ambient-occlusion map, and without it a head
   * lit from one side is a smooth pale mass with features drawn on: every
   * plane reads at the same brightness, so none of them read at all. Painting
   * it into the vertex colours costs nothing and is most of the difference
   * between a face and a mask.
   */
  const scratch = new THREE.Color();
  const tintAt = (v: number, x: number, z: number) => {
    /* One colour, reused. The booth rebuilds the whole duelist on every frame
       of a slider drag, and a fresh `Color` per vertex is four thousand
       allocations per frame for a value the mesh builder copies out
       immediately. */
    const c = scratch.setRGB(1, 1, 1);
    const bx = Math.abs(x) / H;
    const front = frontness(z, H);
    const lipW = win(bx, -mouthHalf, mouthHalf) * front;
    const d = eyeD(v, x);

    /* --- occlusion, before anything is coloured --- */
    let ao = 0;
    /* The socket, deepest at the inner corner and along the upper lid — the
       upper/lower difference ramped across the lid rather than switched at the
       eye line, which would draw a horizontal step across the socket. */
    ao += 0.42 * front * win(d, 0.85, 2.6) * lerp(0.45, 1, smooth((v - EYE_V) / 0.05 + 0.5));
    /* Where the wing of the nose meets the cheek. */
    ao += 0.5 * front * win(bx, 0.03, 0.13) * win(v, 0.27, 0.37);
    /* Under the lower lip, and the crease under the nose. */
    ao += 0.45 * lipW * win(v, 0.118, 0.168);
    ao += 0.35 * win(bx, -0.05, 0.05) * win(v, 0.255, 0.295) * front;
    /* Under the jaw and back towards the neck, which is the darkest place on
       any head and the one that gives the chin an edge against the throat. */
    ao += 1.0 * win(v, -0.16, 0.1);
    /* The temple, and the hollow in front of the ear. */
    ao += 0.3 * win(bx, 0.24, 0.34) * win(v, 0.42, 0.68);
    c.lerp(SHADE, clamp01(ao));

    /* Brows. The band rises and thins as it runs outward, which is the
       difference between an eyebrow and a smear. */
    const bc = 0.556 + 0.03 * smooth((bx - 0.05) / 0.22);
    const bh = lerp(0.031, 0.015, clamp01((bx - 0.05) / 0.24)) * (0.75 + 0.5 * brow);
    const browW = win(v, bc - bh, bc + bh) * win(bx, 0.032, 0.3) * front;
    c.lerp(hairOnSkin, clamp01(browW * 1.4));

    const bow = 0.009 * win(bx, -0.032, 0.032);
    c.lerp(LIP, clamp01(lipW * (win(v + bow, 0.2, 0.266) + win(v, 0.144, 0.21)) * 1.35));
    c.lerp(SEAM, clamp01(lipW * win(v, 0.19, 0.222) * 1.6));

    /* Lashes, at the rim of the fissure — heavier above than below, as they
       are. An eye without a dark edge has nothing to hold it in the face. */
    c.lerp(LASH, clamp01(front * win(d, 0.82, 1.18) * (v > EYE_V ? 1.7 : 0.8)));
    c.lerp(WARM, clamp01(win(v, 0.3, 0.48) * win(bx, 0.1, 0.31) * 0.5 * front));

    /**
     * The beard, as colour on skin.
     *
     * This is where a beard's *edge* lives, not on the shell that gives it
     * thickness. The shell has to cross out of the skin somewhere, and two
     * surfaces crossing produce a staircase at whatever the mesh resolution
     * is — visible at any density worth shipping. Painting the skull itself
     * the full hair colour, and sinking the shell far enough that it only
     * emerges well inside the painted region, means the crossing happens
     * between two surfaces of the same colour and there is no edge to see.
     * The shaved line the eye reads is the tint's own gradient, which is as
     * smooth as the vertex colours are.
     *
     * Stubble stays a shadow: it has no silhouette, so it never gets a shell
     * and never goes to full strength.
     */
    const shave = beardMask(spec.facialHair, v, bx, front);
    if (shave > 0) {
      const solid = spec.facialHair === 'stubble' ? 0.5 : 1;
      c.lerp(hairOnSkin, clamp01(smooth(shave * 2.6)) * solid);
    }
    return c;
  };

  /* ---------------- the mesh ---------------- */

  const m = new MeshBuilder();
  const RINGS = SKULL_RINGS;
  const SEG = SKULL_SEG;
  const rings: number[][] = [];
  for (let i = 0; i <= RINGS; i++) {
    const v = i / RINGS;
    const ring: number[] = [];
    for (let k = 0; k < SEG; k++) {
      const a = (k / SEG) * Math.PI * 2;
      const p = surface(v, a);
      ring.push(m.vertex(p.x, p.y, p.z, tintAt(v, p.x, p.z)));
    }
    rings.push(ring);
  }
  /**
   * The crown, closed as a dome rather than fanned to a point.
   *
   * The slope is measured off the surface itself rather than assumed, so the
   * arc leaves the last ring going exactly where the skull was already going.
   * See `domeRings`.
   */
  const CROWN = 5;
  const rTop = sample(SKULL, 1, 1) * H;
  const rBelow = sample(SKULL, 0.99, 1) * H;
  const dome = domeRings(rTop, (rTop - rBelow) / (0.01 * H), CROWN);
  const white = new THREE.Color(1, 1, 1);
  for (let j = 1; j < CROWN; j++) {
    const { scale, rise } = dome[j];
    const ring: number[] = [];
    for (let k = 0; k < SEG; k++) {
      const a = (k / SEG) * Math.PI * 2;
      const p = surface(1, a);
      ring.push(m.vertex(p.x * scale, y(1) + rise, p.z * scale, white));
    }
    rings.push(ring);
  }
  m.loft(rings);
  m.cap(rings[0], m.vertex(0, y(-0.05), sample(SKULL, 0, 2) * H * 0.4, UNDER), -1);
  m.cap(rings[rings.length - 1], m.vertex(0, y(1) + dome[CROWN].rise, 0, white), 1);

  addNose(m, spec, H, y, surface);
  addEars(m, H, y, surface);

  const face = keep(m.build());
  const skinFace = keep(
    new THREE.MeshPhysicalMaterial({
      color: skinColor,
      roughness: 0.66,
      metalness: 0,
      vertexColors: true,
      sheen: 0.3,
      sheenRoughness: 0.7,
      sheenColor: skinColor.clone().lerp(new THREE.Color('#ffd4c2'), 0.5),
      specularIntensity: 0.32,
    })
  );
  const group = new THREE.Group();
  const headMesh = new THREE.Mesh(face, skinFace);
  headMesh.castShadow = true;
  group.add(headMesh);

  /* ---------------- eyes ---------------- */

  /* Getting the eyeball's size wrong by even a little is the loudest tell in
     the whole model: eyes a shade too big read as a doll, a shade too small as
     a portrait of somebody unwell. */
  const eyeR = EYE_R * H;
  const eyeX = EYE_X * H;
  /* Placed against the socket floor, taken from the table rather than from
     `surface` — which now has a hole cut in it exactly here, and would report
     the back of the aperture as the front of the face. The 0.9 foreshortens
     the skull's front extent to the eye's own azimuth; the second term is the
     socket recess. The ball then stands about 5 mm proud of the socket, which
     is where a cornea sits. */
  const eyeZ = sample(SKULL, EYE_V, 2) * H * 0.9 - 0.026 * H - eyeR;

  const sclera = keep(
    new THREE.MeshPhysicalMaterial({
      /* Not white. A sclera is a wet grey-pink thing in a shadowed socket,
         and painting it paper-white is what gives a model that stare. */
      color: new THREE.Color('#cfc6bf'),
      roughness: 0.3,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
    })
  );
  const irisMat = keep(
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(EYE_COLORS[spec.eyeColor] ?? EYE_COLORS[0]),
      roughness: 0.3,
      metalness: 0,
      vertexColors: true,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
    })
  );
  const ball = keep(new THREE.SphereGeometry(eyeR, 24, 18));
  const iris = keep(irisGeometry(eyeR));

  /**
   * The blinking lid: a spherical shell sharing the eyeball's centre.
   *
   * Now that the fissure is cut into the skull, the *open* eye needs no lid
   * geometry at all — the rim of the hole is the lid. This exists only to
   * close it, so at rest it is parked above the aperture, hidden behind the
   * face, and rotates down over the ball to blink. Rotating about the ball's
   * centre is exactly what the muscle does, and it keeps the lid the width of
   * the eye the whole way down; three earlier attempts slid a cap forward
   * instead and every one ended narrower than the eye it had to cover.
   */
  const lidGeo = keep(lidGeometry(eyeR * 1.035, 1.19, true));
  const lidOpen = lerp(-0.34, -0.12, spec.eyeShape);
  const lidShut = 0.62;

  const lids: THREE.Group[] = [];
  for (const side of [-1, 1] as const) {
    const eye = new THREE.Group();
    eye.position.set(side * eyeX, y(EYE_V), eyeZ);
    /* Toed out very slightly, as eyes are: parallel sockets stare. */
    eye.rotation.y = side * 0.05;
    const b = new THREE.Mesh(ball, sclera);
    const ir = new THREE.Mesh(iris, irisMat);
    eye.add(b, ir);

    const lid = new THREE.Group();
    lid.rotation.x = lidOpen;
    const lidMesh = new THREE.Mesh(lidGeo, skinFace);
    lidMesh.castShadow = true;
    lid.add(lidMesh);
    eye.add(lid);
    lids.push(lid);

    group.add(eye);
  }

  /* ---------------- hair and beard ---------------- */

  const hairMat = keep(
    new THREE.MeshPhysicalMaterial({
      color: hairColor,
      roughness: 0.62,
      metalness: 0,
      sheen: 0.9,
      sheenRoughness: 0.35,
      sheenColor: hairColor.clone().lerp(new THREE.Color('#ffffff'), 0.45),
      side: THREE.DoubleSide,
      vertexColors: true,
    })
  );
  const hairGeo = buildHair(spec, H, y, surface);
  if (hairGeo) {
    keep(hairGeo);
    const hm = new THREE.Mesh(hairGeo, hairMat);
    hm.castShadow = true;
    group.add(hm);
  }
  const beardGeo = buildBeard(spec, H, surface, hairOnSkin);
  if (beardGeo) {
    keep(beardGeo);
    /* Drawn with the *face's* material, not the hair's. The shell has to cross
       out of the skin somewhere, and a crossing between two different
       materials shows as blotches however well the colours match — matching
       both leaves only a soft change in curvature, which is what a beard's
       volume looks like anyway. */
    const bm = new THREE.Mesh(beardGeo, skinFace);
    bm.castShadow = true;
    group.add(bm);
  }

  return {
    group,
    crown: y(1),
    lidL: lids[0],
    lidR: lids[1],
    lidOpen,
    lidShut,
    dispose: () => kept.forEach((k) => k.dispose()),
  };
}

/* ------------------------------------------------------------------ */
/* The nose                                                            */
/* ------------------------------------------------------------------ */

function addNose(
  m: MeshBuilder,
  spec: StoryCharacter,
  H: number,
  y: (v: number) => number,
  surface: (v: number, a: number) => { x: number; y: number; z: number }
): void {
  const wide = 0.86 + 0.32 * spec.nose;
  const long = 0.74 + 0.56 * spec.nose;
  const SEG = 26;
  const rings: number[][] = [];
  const steps = (NOSE.length - 1) * 3;

  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const v = lerp(NOSE[0][0], NOSE[NOSE.length - 1][0], t);
    const hw = sample(NOSE, v, 1) * H * wide;
    const stand = sample(NOSE, v, 2) * H * long;
    const depth = sample(NOSE, v, 3) * H;
    /* Anchored to the face it grows out of, not to a fixed z, so a heavy jaw
       or a deep brow carries the nose with it instead of leaving it hanging. */
    const cz = surface(v, 0).z + stand - depth;
    const ring: number[] = [];
    for (let k = 0; k < SEG; k++) {
      const a = (k / SEG) * Math.PI * 2;
      const p = sectionPoint(hw, depth, depth, 2.5, a);
      /* The nostrils, as tint on the underside of the wings. */
      const under = v < 0.3 && p.z > -depth * 0.2 && Math.abs(p.x) > hw * 0.24;
      ring.push(m.vertex(p.x, y(v), cz + p.z, under ? NOSTRIL : new THREE.Color(1, 1, 1)));
    }
    rings.push(ring);
  }
  m.loft(rings);
  m.cap(rings[0], m.vertex(0, y(NOSE[0][0] - 0.02), surface(NOSE[0][0], 0).z - 0.03 * H, NOSTRIL), -1);
  m.cap(rings[rings.length - 1], m.vertex(0, y(0.57), surface(0.57, 0).z - 0.03 * H), 1);
}

/* ------------------------------------------------------------------ */
/* Ears                                                                */
/* ------------------------------------------------------------------ */

/** Ear height, from the lobe to the top of the helix, as fractions of H. */
const EAR: Profile = [
  [0.0, 0.2, 0.052, 0.0],
  [0.18, 0.28, 0.064, -0.004],
  [0.5, 0.34, 0.072, -0.006],
  [0.82, 0.3, 0.062, -0.002],
  [1.0, 0.19, 0.044, 0.004],
];

function addEars(
  m: MeshBuilder,
  H: number,
  y: (v: number) => number,
  surface: (v: number, a: number) => { x: number; y: number; z: number }
): void {
  /* An ear runs from the eye line down to the base of the nose. That single
     fact places it correctly on any head, which matters more than its own
     shape — an ear an inch too high makes a face look wrong in a way nobody
     can name. */
  const top = EYE_V + 0.035;
  const bottom = 0.285;
  const SEG = 18;

  for (const side of [-1, 1] as const) {
    const rings: number[][] = [];
    for (let s = 0; s <= 14; s++) {
      const t = s / 14;
      const v = lerp(bottom, top, t);
      const thick = sample(EAR, t, 1) * 0.045 * H;
      const depth = sample(EAR, t, 2) * H;
      const dz = sample(EAR, t, 3) * H;
      const at = surface(v, (side * Math.PI) / 2);
      /* Set slightly back from the widest point of the skull and canted out at
         the top, which is the difference between an ear and a handle. */
      const cx = at.x * 0.94 + side * thick * 1.4 * (0.5 + t * 0.9);
      const cz = at.z - 0.14 * H + dz;
      const ring: number[] = [];
      for (let k = 0; k < SEG; k++) {
        const a = (k / SEG) * Math.PI * 2;
        const p = sectionPoint(thick, depth, depth, 2.4, a);
        ring.push(m.vertex(cx + p.x, y(v), cz + p.z, s > 2 && s < 12 ? UNDER : undefined));
      }
      rings.push(ring);
    }
    m.loft(rings);
    const a0 = surface(bottom, (side * Math.PI) / 2);
    m.cap(rings[0], m.vertex(a0.x * 0.94, y(bottom - 0.03), a0.z - 0.14 * H), -1);
    const a1 = surface(top, (side * Math.PI) / 2);
    m.cap(rings[rings.length - 1], m.vertex(a1.x * 0.9, y(top + 0.02), a1.z - 0.145 * H), 1);
  }
}

/* ------------------------------------------------------------------ */
/* Hair                                                                */
/* ------------------------------------------------------------------ */

/**
 * How each cut behaves.
 *
 * `thick` is how far it stands off the scalp, `line` shifts the hairline,
 * `part` cuts a parting down the middle, `nape` is how far down the back it
 * grows, `tail` picks a mass that is not on the scalp, and `mantle` hangs a
 * curtain from the nape.
 *
 * The numbers are spread much further apart than they look like they need to
 * be. Laid out side by side at 8, 26 and 42 thousandths of a head, a shaved
 * scalp, a crop and a swept cut were the same haircut three times: a knob you
 * cannot tell from its neighbour is not a choice, whatever the label says.
 */
const HAIR_SHAPE = {
  shaved: { thick: 0.005, line: 0.05, part: 0, nape: 0.34, tail: 0, mantle: 0 },
  crop: { thick: 0.024, line: 0.01, part: 0, nape: 0.28, tail: 0, mantle: 0 },
  swept: { thick: 0.05, line: 0.03, part: 0, nape: 0.3, tail: 0, mantle: 0 },
  spiked: { thick: 0.062, line: 0.02, part: 0, nape: 0.29, tail: 0, mantle: 0 },
  curtain: { thick: 0.052, line: -0.06, part: 0.85, nape: 0.26, tail: 0, mantle: 0 },
  wild: { thick: 0.075, line: -0.03, part: 0.2, nape: 0.24, tail: 0, mantle: 0 },
  long: { thick: 0.046, line: -0.03, part: 0.35, nape: 0.16, tail: 0, mantle: 1.0 },
  ponytail: { thick: 0.026, line: 0.03, part: 0, nape: 0.3, tail: 1, mantle: 0 },
  topknot: { thick: 0.022, line: 0.07, part: 0, nape: 0.32, tail: 2, mantle: 0 },
  braids: { thick: 0.03, line: -0.02, part: 0.4, nape: 0.22, tail: 3, mantle: 0 },
  mohawk: { thick: 0.075, line: 0.0, part: 0, nape: 0.9, tail: 0, mantle: 0 },
  bun: { thick: 0.024, line: 0.05, part: 0, nape: 0.3, tail: 4, mantle: 0 },
} as const;

function buildHair(
  spec: StoryCharacter,
  H: number,
  y: (v: number) => number,
  surface: (v: number, a: number) => { x: number; y: number; z: number }
): THREE.BufferGeometry | null {
  const S = HAIR_SHAPE[spec.hair];
  if (!S) return null;
  const m = new MeshBuilder();
  /* The skull's own azimuths, for the same reason the beard uses them: the
     hairline is where this shell crosses out of the skull, and two lofts on
     grids that do not line up cross in a zigzag whose period is the beat
     between them. At 56 against the skull's 60 that beat was the visible edge
     of the haircut. */
  const SEG = SKULL_SEG;
  const ROWS = 22;
  const DARK = new THREE.Color(0.55, 0.55, 0.58);

  /**
   * Where the hairline crosses a given azimuth.
   *
   * This one function is most of the difference between hair and a swim cap.
   * A real hairline is not a circle: it dips at the middle of the forehead,
   * climbs at the temples, drops steeply in front of the ear into a sideburn,
   * and runs low across the nape. Drawing it as a constant height is exactly
   * what makes procedural hair look moulded on.
   */
  const hairline = (a: number) => {
    const ax = fromFront(a);
    /* A little grain, so the fringe is a hairline and not a machined edge.
       Deterministic — two sines, not a random — because the model is rebuilt
       on every slider move and hair that reshuffles as you drag a colour is
       worse than hair that is slightly too tidy.

       Both frequencies are kept well under the ring's own. At 13.7 and 27.3
       against sixty segments the second wave had barely two samples to a
       cycle, so what reached the mesh was not grain but its alias: a hard
       sawtooth, right along the one line a haircut is judged by. It showed at
       the fringe and worse across the nape. Detail finer than the mesh cannot
       be drawn by the mesh — it can only corrupt it. */
    const grain = 0.013 * (Math.sin(a * 5.3) * 0.6 + Math.sin(a * 9.7 + 1.1) * 0.4);
    if (ax < 0.62) return 0.735 + S.line + grain - 0.03 * Math.cos(ax * 2.5);
    if (ax < 1.02) return lerp(0.762, 0.66, smooth((ax - 0.62) / 0.4)) + S.line + grain;
    if (ax < 1.45) return lerp(0.66, 0.5, smooth((ax - 1.02) / 0.43)) + S.line * 0.5;
    return lerp(0.5, S.nape, smooth((ax - 1.45) / (Math.PI - 1.45)));
  };

  /** How far the hair stands off the scalp at a point. */
  const thickness = (a: number, u: number) => {
    const ax = fromFront(a);
    let t = S.thick;
    /**
     * Negative right at the hairline, so the shell starts *inside* the skull
     * and crosses out of it in a clean line.
     *
     * Tapered to a thin positive instead, it lies half a millimetre proud of
     * the scalp all along the edge — two near-coincident surfaces, which
     * speckle where they cross. The line a haircut is judged by is exactly
     * that edge.
     */
    t *= 0.02 + 1.05 * smooth(u * 2.4);
    /* Volume on the crown, because hair has a mass and gravity gives it a
       shape; a shell of constant offset never does. */
    t *= 1 + 0.55 * smooth((u - 0.35) / 0.6);
    /* A parting: the shell dips towards the scalp along the middle. */
    if (S.part > 0) t *= 1 - S.part * 0.75 * win(ax, -0.34, 0.34) * smooth(u * 1.6);
    /* Mohawks keep the crest and lose the sides. */
    /* Negative off the crest, so the shell is *inside* the skull there rather
       than lying on it — a shell at nominally zero thickness still crosses the
       scalp and speckles it. */
    if (spec.hair === 'mohawk') {
      t *= 0.02 + 2.4 * Math.max(win(ax, -0.5, 0.5), win(ax, Math.PI - 0.5, Math.PI + 0.5));
    }
    if (spec.hair === 'spiked') t *= 1 + 0.85 * Math.sin(a * 9) ** 2 * smooth((u - 0.3) / 0.6);
    if (spec.hair === 'wild') t *= 1 + 0.34 * Math.sin(a * 6.3 + u * 7) + 0.2 * Math.sin(a * 11);
    /**
     * Sunk a constant millimetre at the end, rather than by a factor.
     *
     * The shell has to start inside the skull and cross out of it, or its edge
     * speckles where two near-coincident surfaces meet. Doing that with a
     * negative *multiplier* looks equivalent and is not: a mohawk multiplies
     * by a second negative off the crest, the two cancel, and hair reappears
     * in a jagged patch exactly where it was supposed to vanish. Subtracting
     * cannot change sign twice.
     */
    return t * H - 0.005 * H;
  };

  const rows: number[][] = [];
  for (let r = 0; r <= ROWS; r++) {
    const u = r / ROWS;
    const ring: number[] = [];
    for (let k = 0; k < SEG; k++) {
      const a = (k / SEG) * Math.PI * 2;
      const v0 = hairline(a);
      const v = lerp(v0, 1.005, u);
      const p = surface(Math.min(v, 1), a);
      const off = thickness(a, u);
      /* Pushed out along the scalp's own outward direction, so the shell
         follows the skull instead of inflating away from its centre — and
         turned upright as it nears the crown, where "outward" is sideways and
         a purely radial offset would slide the hair off the top of the head. */
      const len = Math.hypot(p.x, p.z) || 1;
      const up = smoothEdge(v, 0.84, 1.0);
      const side = 1 - up;
      ring.push(
        m.vertex(
          p.x + (p.x / len) * off * side,
          p.y + off * up,
          p.z + (p.z / len) * off * side,
          u < 0.12 ? DARK : undefined
        )
      );
    }
    rows.push(ring);
  }
  m.loft(rows);

  if (S.tail) addHairMass(m, S.tail, H, y, surface);
  if (S.mantle) addMantle(m, S.mantle, H, surface);
  const g = m.build();
  return g;
}

/** Ponytails, knots, buns and braids: a mass of hair that is not on the scalp. */
function addHairMass(
  m: MeshBuilder,
  kind: number,
  H: number,
  y: (v: number) => number,
  surface: (v: number, a: number) => { x: number; y: number; z: number }
): void {
  const anchor = surface(kind === 2 ? 0.99 : 0.78, Math.PI);
  const SEG = 16;

  /** A tapered rope from the anchor, drooping as it goes. */
  const rope = (x0: number, len: number, r0: number, r1: number, droop: number) => {
    const rings: number[][] = [];
    for (let s = 0; s <= 12; s++) {
      const t = s / 12;
      /* Full for most of its length, then rounded off — tapered linearly to a
         capped point it reads as a spike rather than a plait. */
      const r = lerp(r0, r1, t ** 2) * H * Math.sqrt(Math.max(0.06, 1 - (t > 0.86 ? (t - 0.86) / 0.14 : 0) ** 2));
      const ring: number[] = [];
      for (let k = 0; k < SEG; k++) {
        const a = (k / SEG) * Math.PI * 2;
        ring.push(
          m.vertex(
            anchor.x + x0 * H + Math.sin(a) * r,
            anchor.y - t * len * H - droop * t * t * H,
            anchor.z - t * 0.1 * H + Math.cos(a) * r
          )
        );
      }
      rings.push(ring);
    }
    m.loft([...rings].reverse());
    m.cap(rings[rings.length - 1], m.vertex(anchor.x + x0 * H, anchor.y - len * H - droop * H - r1 * H, anchor.z - 0.1 * H), -1);
  };

  if (kind === 1) rope(0, 1.15, 0.115, 0.045, 0.12);
  if (kind === 3) {
    rope(-0.24, 1.25, 0.082, 0.036, 0.1);
    rope(0.24, 1.25, 0.082, 0.036, 0.1);
  }
  if (kind === 2 || kind === 4) {
    /* A knot or a bun: a squashed ball sitting on the crown or the nape. */
    const cy = kind === 2 ? y(1.05) : anchor.y + 0.06 * H;
    const cz = kind === 2 ? anchor.z * 0.25 : anchor.z - 0.09 * H;
    const rings: number[][] = [];
    /* Poles excluded from the loft: at `th` = 0 and π the radius is zero, so
       those rings would be sixteen vertices on one point. The zero-area quads
       that makes contribute nothing to `computeVertexNormals`, so the vertices
       at the top of the bun end up with no normal at all and shade black —
       which is what the topknot had sitting on its crown. */
    for (let s = 1; s < 12; s++) {
      const th = (s / 12) * Math.PI;
      const r = Math.sin(th) * 0.185 * H;
      const ring: number[] = [];
      for (let k = 0; k < SEG; k++) {
        const a = (k / SEG) * Math.PI * 2;
        ring.push(m.vertex(Math.sin(a) * r, cy - Math.cos(th) * 0.14 * H, cz + Math.cos(a) * r));
      }
      rings.push(ring);
    }
    m.loft(rings);
    m.cap(rings[0], m.vertex(0, cy - 0.14 * H, cz), -1);
    m.cap(rings[rings.length - 1], m.vertex(0, cy + 0.14 * H, cz), 1);
  }
}

/**
 * Long hair: a curtain hung from the nape, down the back and over the
 * shoulders.
 *
 * A scalp shell cannot be long. However far the hairline is pushed down the
 * neck, hair that follows the skull is a hat — the thing that reads as length
 * is mass *leaving* the head, falling past the jaw and breaking on the
 * shoulders. Drawn with the hair material, which is double-sided, so the
 * inside of the curtain is there when the head turns.
 */
function addMantle(
  m: MeshBuilder,
  len: number,
  H: number,
  surface: (v: number, a: number) => { x: number; y: number; z: number }
): void {
  const ROWS = 20;
  const COLS = 34;
  const grid: number[][] = [];
  for (let i = 0; i <= ROWS; i++) {
    const t = i / ROWS;
    const line: number[] = [];
    for (let k = 0; k <= COLS; k++) {
      /* The back two-thirds of the head: hair falls behind the ears, not over
         the face. */
      const a = lerp(0.95, Math.PI * 2 - 0.95, k / COLS);
      /* Hung from ear level, the same height all the way round. Hung from the
         hairline instead — which for a long cut runs from the temple down to
         the nape — the top of the curtain rose and fell by most of a head, and
         the hem inherited every wobble of it. */
      const top = surface(0.44, a);
      /* Widens to the head's own width within the first fifth of the drop,
         then falls straight with a little flare at the hem. */
      const wide = surface(0.3, a);
      const blend = Math.min(1, t * 4.5);
      /* Standing well off the body as it falls. At a gentler flare the curtain
         drops *inside* the jacket and is swallowed by the shoulders, which
         reads as a hood rather than as hair. */
      const flare = 1 + 0.95 * t * t;
      line.push(
        m.vertex(
          lerp(top.x, wide.x * flare, blend),
          top.y - t * len * H,
          lerp(top.z, wide.z * flare, blend)
        )
      );
    }
    grid.push(line);
  }
  for (let i = 0; i < ROWS; i++) {
    for (let k = 0; k < COLS; k++) {
      m.quad(grid[i][k], grid[i][k + 1], grid[i + 1][k + 1], grid[i + 1][k]);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Facial hair                                                         */
/* ------------------------------------------------------------------ */

/**
 * Where a given beard grows, as a 0..1 mask over the face.
 *
 * Used twice: as a tint, so stubble is a shadow rather than a shape, and as a
 * height, so a full beard has a silhouette. Sharing one mask is what keeps the
 * shaved edge of a goatee in the same place in both.
 */
function beardMask(kind: StoryCharacter['facialHair'], v: number, bx: number, fz: number): number {
  if (kind === 'none' || fz <= 0) return 0;
  /* Stops at the chin. Below v = 0 the skull table is being extrapolated and
     the surface is a small ring around the throat — a beard grown there is a
     black collar on the neck, which is exactly how it looked. */
  const jawline = win(v, 0.0, 0.36) * win(bx, -0.28, 0.28);
  const chin = win(v, 0.02, 0.2) * win(bx, -0.115, 0.115);
  const tache = win(v, 0.232, 0.3) * win(bx, -0.105, 0.105);
  const cheek = win(v, 0.16, 0.44) * win(bx, 0.1, 0.32);
  /* In front of the ear, not beside the eye: at bx 0.19 this reached the
     outer corner of the socket and speckled it. */
  const burns = win(v, 0.27, 0.5) * win(bx, 0.25, 0.37);
  let m: number;
  switch (kind) {
    case 'stubble':
      m = union(jawline * 0.85, chin * 0.7, tache * 0.7, cheek * 0.55);
      break;
    case 'moustache':
      m = tache;
      break;
    case 'goatee':
      m = union(chin, tache * 0.85);
      break;
    case 'full':
      m = union(jawline, chin, tache, cheek * 0.9, burns * 0.7);
      break;
    case 'sideburns':
      m = burns;
      break;
    default:
      return 0;
  }
  /* Nothing grows on the lips. Left in, a full beard swallows the mouth and
     the duelist ends up wearing its own face as a scarf. */
  /* Faded round the side of the head rather than cut off at the mid-plane —
     see `frontness`. A beard that stopped dead there had a vertical edge in
     front of the ear, on the shell as well as in the tint. */
  return Math.max(0, m - win(v, 0.145, 0.268) * win(bx, -0.1, 0.1) * 1.3) * fz;
}

/**
 * The part of a beard that has to be geometry rather than tint.
 *
 * Stubble stays flat — it is a shadow, and giving it thickness makes a face
 * look dusty. Everything longer gets a shell lifted off the skin by the mask,
 * so the silhouette changes too.
 */
function buildBeard(
  spec: StoryCharacter,
  H: number,
  surface: (v: number, a: number) => { x: number; y: number; z: number },
  tint: THREE.Color
): THREE.BufferGeometry | null {
  const kind = spec.facialHair;
  /**
   * Only what has a silhouette gets geometry.
   *
   * Stubble is a shadow. So, at this scale, are a moustache and a pair of
   * sideburns: their mask covers so little of the face that the shell emerges
   * as a few islands with holes between them, which reads as damage rather
   * than hair. They are painted instead; a full beard and a goatee have real
   * mass and keep their shell.
   */
  if (kind === 'none' || kind === 'stubble' || kind === 'moustache' || kind === 'sideburns') return null;
  const height = kind === 'full' ? 0.03 : 0.024;

  const m = new MeshBuilder();
  const V0 = 0.0;
  /**
   * High enough that the mask has died before the last row.
   *
   * The shell's edge is supposed to fall out of the arithmetic: where the mask
   * is small the surface sits inside the skin and cannot be seen. That only
   * works if the range covers the whole mask. Cut at 0.34 it did not — the
   * cheek window is still at two-thirds of its peak there, so the top row stood
   * 0.018 H proud of the face and the loft left it open, which is a hole at the
   * top of the cheek looking into the inside of the beard. By 0.47 the last
   * surviving term is under the lift threshold everywhere, so the final row is
   * back under the skin where an edge cannot be seen. It also lets a full
   * beard's sideburn exist as geometry at all, instead of being sheared off
   * halfway up.
   */
  const V1 = 0.46;
  const rings: number[][] = [];

  /* Rows snapped to the skull's own rings, and only those inside the beard's
     range — see `SKULL_RINGS`. */
  for (let i = Math.floor(V0 * SKULL_RINGS); i <= Math.ceil(V1 * SKULL_RINGS); i++) {
    const v = i / SKULL_RINGS;
    const ring: number[] = [];
    for (let k = 0; k < SKULL_SEG; k++) {
      const a = (k / SKULL_SEG) * Math.PI * 2;
      const p = surface(v, a);
      /* Sunk half a millimetre-of-a-head into the skin before the mask lifts
         it out, so the shell only exists where the beard does. Where the mask
         is zero the surface is inside the skull and cannot be seen; where it
         is one the beard stands proud. The cut edge falls out of the
         arithmetic instead of needing a separate outline. */
      /* Raised only where the tint has already saturated, so the shell's own
         edge — the place two surfaces cross, and the place a staircase would
         show — is buried well inside a region that is already hair-coloured. */
      const mask = beardMask(kind, v, Math.abs(p.x) / H, frontness(p.z, H));
      const off = (smooth(clamp01((mask - 0.34) / 0.5)) * height - 0.003) * H;
      const len = Math.hypot(p.x, p.z) || 1;
      ring.push(m.vertex(p.x + (p.x / len) * off, p.y, p.z + (p.z / len) * off, tint));
    }
    rings.push(ring);
  }
  m.loft(rings);
  return m.build();
}

/* ------------------------------------------------------------------ */
/* Lids                                                                */
/* ------------------------------------------------------------------ */

/**
 * A lid: a spherical cap around +Y, painted dark along its rim.
 *
 * The dark rim is the lash line, and it is doing a job out of all proportion
 * to its cost. An eye with no lash line has no edge to it, and a face whose
 * eyes have no edge looks embalmed no matter what the rest of the head does.
 * It has to be geometry-aware rather than a ring of its own, so it stays put
 * when the lid rotates.
 */
function lidGeometry(r: number, half: number, lash: boolean): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, 28, 18, 0, Math.PI * 2, 0, half);
  const p = g.attributes.position;
  const col: number[] = [];
  for (let i = 0; i < p.count; i++) {
    const th = Math.acos(Math.max(-1, Math.min(1, p.getY(i) / r)));
    const rim = smoothEdge(th, half - 0.2, half);
    /* Only the front half: the rest of the shell is buried in the socket, and
       darkening it there would show as a bruise above the eye. */
    const front = smoothEdge(p.getZ(i) / r, -0.1, 0.35);
    const k = 1 - rim * front * (lash ? 0.86 : 0.42);
    col.push(k, k * 0.97, k * 0.95);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/* ------------------------------------------------------------------ */
/* The iris                                                            */
/* ------------------------------------------------------------------ */

/**
 * A disc of iris lying *on* the eyeball rather than in front of it.
 *
 * Every vertex sits on a sphere a hair larger than the ball, which sounds
 * fussy until you get it wrong: a flat disc pushed forward until its centre
 * clears the sclera leaves its rim buried, and all that shows through is the
 * pupil — which reads, convincingly, as an eye with no iris at all.
 */
function irisGeometry(eyeR: number): THREE.BufferGeometry {
  const R = eyeR * 0.56;
  const RINGS = 9;
  const SEG = 32;
  const shell = eyeR * 1.006;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];

  for (let j = 0; j <= RINGS; j++) {
    const t = j / RINGS;
    const r = R * t;
    const z = Math.sqrt(Math.max(0, shell * shell - r * r));
    for (let i = 0; i <= SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      pos.push(Math.cos(a) * r, Math.sin(a) * r, z);
      /* Pupil at the centre, a darker limbal ring at the edge, and fibres
         between them — the three things the eye actually notices. */
      const pupil = t < 0.42 ? 1 : 0;
      const limb = smoothEdge(t, 0.86, 1);
      const fibre = 0.86 + 0.28 * Math.sin(a * 22) * (t > 0.45 ? 1 : 0);
      const k = pupil ? 0.04 : fibre * (1 - limb * 0.75);
      col.push(k, k, k);
    }
  }
  for (let j = 0; j < RINGS; j++) {
    for (let i = 0; i < SEG; i++) {
      const a = j * (SEG + 1) + i;
      const b = a + SEG + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
