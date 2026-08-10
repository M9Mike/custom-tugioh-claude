'use client';

/**
 * The character lab.
 *
 * The duelist is the thing this game is sold on, so it gets a workbench rather
 * than a screenshot. Three kinds of looking, because each catches faults the
 * others cannot:
 *
 *   sheet   one duelist from six angles. Silhouette and face. A nose that
 *           reads head-on is a wedge in profile, and a jaw that looks strong
 *           in profile vanishes from the front.
 *   seams   the joints where two parts can pass through each other, shot
 *           while walking. Clipping does not happen in a contact sheet of a
 *           standing figure; it happens mid-stride, at a seam, at a distance
 *           no camera in the game uses.
 *   sweeps  one axis of the creation booth at a time — every outfit, every
 *           cut of hair, every beard, every frame — side by side. A garment
 *           sized off the wrong profile looks fine on the default duelist and
 *           wrong on the fourth roll, and the only way to know is to lay the
 *           whole axis out and look down the row.
 *
 * Not linked from anywhere. `/diag/character` is a workbench, the same way
 * `/diag` is: you go to it on purpose.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  FACIAL_HAIR,
  FRAMES,
  GAUNTLETS,
  HAIR_STYLES,
  OUTFITS,
  SKIN_TONES,
  defaultCharacter,
  randomCharacter,
  type StoryCharacter,
} from '@/story/character';
import { buildCharacter, type Rig } from '@/components/story/humanoid';

/** A camera placement: what height it looks at, how far off, and from where. */
interface View {
  y: number;
  dist: number;
  yaw: number;
  pitch: number;
  label: string;
  /** Sideways offset of what the camera looks at. A hand is not on the axis. */
  x?: number;
}

const SHEET: View[] = [
  { y: 0.95, dist: 3.0, yaw: 0, pitch: 0.02, label: 'front' },
  { y: 0.95, dist: 3.0, yaw: 0.7, pitch: 0.02, label: 'three-quarter' },
  { y: 0.95, dist: 3.0, yaw: Math.PI / 2, pitch: 0.02, label: 'side' },
  { y: 0.95, dist: 3.0, yaw: Math.PI, pitch: 0.02, label: 'back' },
  { y: 1.62, dist: 0.62, yaw: 0.55, pitch: 0.0, label: 'head, three-quarter' },
  { y: 1.65, dist: 0.5, yaw: 0, pitch: 0.0, label: 'face' },
];

/**
 * Every region of the body, close enough to judge it.
 *
 * The sheet is for proportion and the seams are for clipping; neither is any
 * use for asking whether a wrist looks like a wrist. Nine views, head to feet,
 * at a distance where the surface is the subject.
 */
const PARTS: View[] = [
  { y: 1.63, dist: 0.55, yaw: 0.4, pitch: 0.02, label: 'head' },
  { y: 1.47, dist: 0.6, yaw: 0.85, pitch: 0.12, label: 'neck · collar' },
  { y: 1.38, dist: 0.9, yaw: 0.35, pitch: 0.22, label: 'shoulders' },
  { y: 1.2, dist: 1.0, yaw: 0.1, pitch: 0.04, label: 'chest' },
  /* Aimed at the arm, not the body: a hand hangs a quarter of a metre off the
     axis, and a camera pointed at the axis at that height photographs a hip. */
  { y: 1.02, dist: 0.5, yaw: 0.7, pitch: 0.06, label: 'elbow · gauntlet', x: 0.25 },
  /* Over the back of the hand, which is the face anybody actually sees of it. */
  { y: 0.72, dist: 0.44, yaw: -0.15, pitch: 0.45, label: 'wrist · hand', x: 0.24 },
  { y: 0.82, dist: 1.15, yaw: 0.0, pitch: 0.04, label: 'waist · hips' },
  { y: 0.46, dist: 1.0, yaw: 0.4, pitch: 0.04, label: 'knees' },
  { y: 0.1, dist: 0.55, yaw: 0.75, pitch: 0.28, label: 'feet', x: 0.09 },
];

/**
 * The joints where two parts can pass through each other.
 *
 * Every one of these is a place where geometry that moves meets geometry that
 * does not — a hand swinging past a thigh, a deltoid rotating inside a sleeve,
 * a jaw turning over a collar, a hem the leg sweeps inside of.
 */
const SEAMS: View[] = [
  /* Far enough back to hold the hand *and* the thigh through the whole stride.
     Framed for a standing pose the hand simply left the shot at the top of the
     swing, which is the one moment the two can collide. */
  { y: 0.86, dist: 1.35, yaw: 0.5, pitch: 0.1, label: 'hand · hem · thigh' },
  { y: 1.36, dist: 0.8, yaw: 0.9, pitch: 0.15, label: 'armpit · deltoid' },
  { y: 1.52, dist: 0.55, yaw: 0.7, pitch: -0.15, label: 'jaw · collar' },
  { y: 1.44, dist: 0.7, yaw: 1.15, pitch: 0.5, label: 'shoulder, from above' },
  { y: 1.48, dist: 0.5, yaw: Math.PI, pitch: -0.12, label: 'nape, from below' },
  { y: 1.1, dist: 2.2, yaw: 0, pitch: 0.05, label: 'whole, near' },
];

/** How a sweep frames each of its duelists. */
/* Framed for the tall end of the height slider: at 3.1 m the 1.9 m duelist
   in the frame sweep had its boots cut off, which is the half of the model a
   hem defect shows up in. */
const WHOLE: Omit<View, 'label'> = { y: 1.0, dist: 3.7, yaw: 0.45, pitch: 0.03 };
const BUST: Omit<View, 'label'> = { y: 1.6, dist: 0.75, yaw: 0.4, pitch: 0.0 };
const BEHIND: Omit<View, 'label'> = { y: 1.0, dist: 3.7, yaw: Math.PI - 0.4, pitch: 0.03 };

/**
 * Every axis the creation booth exposes, as a sweep.
 *
 * `frame` folds build and height in with it: the three frames at their
 * extremes are six bodies, and the extremes are where a profile table that
 * only works in the middle gives itself away.
 */
const SWEEPS = {
  outfit: {
    view: WHOLE,
    specs: OUTFITS.map((o) => ({ label: o.id, over: { outfit: o.id } as Partial<StoryCharacter> })),
  },
  'outfit-behind': {
    view: BEHIND,
    specs: OUTFITS.map((o) => ({ label: o.id, over: { outfit: o.id, cape: true } as Partial<StoryCharacter> })),
  },
  hair: {
    view: BUST,
    specs: HAIR_STYLES.map((h) => ({ label: h.id, over: { hair: h.id } as Partial<StoryCharacter> })),
  },
  'hair-behind': {
    /* Half the cuts put their mass at the back — a tail, a knot, a curtain
       down the spine — and none of it exists in a front view. */
    view: { y: 1.5, dist: 0.95, yaw: Math.PI - 0.5, pitch: 0.08 },
    specs: HAIR_STYLES.map((h) => ({ label: h.id, over: { hair: h.id } as Partial<StoryCharacter> })),
  },
  beard: {
    view: BUST,
    specs: FACIAL_HAIR.map((f) => ({ label: f.id, over: { facialHair: f.id } as Partial<StoryCharacter> })),
  },
  frame: {
    view: WHOLE,
    specs: FRAMES.flatMap((f) => [
      { label: `${f.id} slight`, over: { frame: f.id, build: 0, height: 0 } as Partial<StoryCharacter> },
      { label: `${f.id} heavy`, over: { frame: f.id, build: 1, height: 1 } as Partial<StoryCharacter> },
    ]),
  },
  gauntlet: {
    view: WHOLE,
    specs: GAUNTLETS.map((g) => ({ label: g.id, over: { gauntlet: g.id } as Partial<StoryCharacter> })),
  },
  skin: {
    view: BUST,
    specs: SKIN_TONES.map((_, i) => ({ label: `skin ${i}`, over: { skin: i } as Partial<StoryCharacter> })),
  },
} as const;

type Mode = 'sheet' | 'seams' | 'parts' | keyof typeof SWEEPS;
/* Derived rather than restated: a sweep added to `SWEEPS` widens `Mode` but
   would not have added a button, and nothing would have complained — the mode
   would simply never be photographed. */
const MODES: Mode[] = ['sheet', 'seams', 'parts', ...(Object.keys(SWEEPS) as (keyof typeof SWEEPS)[])];

/** How far apart sweep duelists stand. Wide enough that none overlaps a neighbour. */
const SPACING = 2.6;

/**
 * How many moments the stride is cut into, and how long one stride lasts.
 *
 * `pose` advances its gait as `t * (4.6 + stride * 6.4)`, so at full pace a
 * whole cycle is 2π/11 seconds. Feeding it `PHASES` evenly spaced values of `t`
 * across that gives the same set of poses every run.
 */
const PHASES = 8;
const CYCLE = (Math.PI * 2) / 11;

type Paint = 'shaded' | 'matte' | 'wire';
const PAINTS: Paint[] = ['shaded', 'matte', 'wire'];

/**
 * Which surfaces may not end up inside which.
 *
 * `probe` names the parts that move, `into` the tubes they must stay out of.
 * `otherSideOnly` is for pairs that share a limb and are *meant* to overlap
 * where they join — a shin lives inside the bottom of its own thigh, and a foot
 * inside the bottom of its own shin. Those get checked against the far leg,
 * where any overlap is a real one.
 */
const CLASHES: { probe: string; into: string[]; otherSideOnly?: boolean }[] = [
  { probe: 'hand', into: ['thigh', 'shin', 'torso'] },
  { probe: 'gauntlet', into: ['thigh', 'torso'] },
  { probe: 'forearm', into: ['thigh', 'shin', 'torso'] },
  { probe: 'hand', into: ['forearm'], otherSideOnly: true },
  { probe: 'foot', into: ['shin', 'thigh'], otherSideOnly: true },
  { probe: 'sole', into: ['shin', 'thigh'], otherSideOnly: true },
  { probe: 'shin', into: ['thigh'], otherSideOnly: true },
];

/**
 * Only tubes lofted along their own Y may be a target — see `insideDepth`.
 *
 * A foot is not one of those: it is a form that runs *forward*, so a line from
 * a point to its local Y axis says nothing about being inside it. Asked
 * anyway, the test reported one foot a metre deep inside the other. A hand is
 * the same, its fingers standing off in Z. Both stay as probes, where all that
 * is needed of them is their vertices.
 */
const TUBES = new Set(['torso', 'thigh', 'shin', 'forearm', 'upperarm']);

/**
 * Is a world-space point inside a lofted tube?
 *
 * Every limb and the torso are built as a stack of closed sections around their
 * own local Y, so each is *star-shaped about that axis*: a straight line from
 * any point on the surface to the axis at the same height stays inside. That
 * gives an exact test with no watertightness needed, which matters because
 * these tubes are deliberately open at the ends where another part takes over.
 *
 * Fire a ray from the point at the axis. Cross the surface on the way and the
 * point was outside; reach the axis without crossing and it was inside. The
 * distance to the axis is then how deep inside it is.
 */
function insideDepth(
  ray: THREE.Raycaster,
  point: THREE.Vector3,
  target: THREE.Mesh,
  local: THREE.Vector3,
  axis: THREE.Vector3,
  dir: THREE.Vector3
): number {
  target.worldToLocal(local.copy(point));
  const box = target.geometry.boundingBox;
  /* Outside the box is outside the surface, and saying so first is what keeps
     a missed ray from being read as a deep penetration. A ray can fail to hit
     for reasons that have nothing to do with the point being inside — a
     tangent grazing the silhouette, a gap at a ring — and without this the
     test cheerfully reported a hand half a metre inside a thigh. Nothing truly
     inside a surface is outside the box that contains it. */
  if (!box || !box.containsPoint(local)) return 0;
  /* Dead on the axis there is no direction to fire in, and nothing to report. */
  const reach = Math.hypot(local.x, local.z);
  if (reach < 1e-6) return 0;
  target.localToWorld(axis.set(0, local.y, 0));
  dir.copy(axis).sub(point);
  const far = dir.length();
  if (far < 1e-6) return 0;
  dir.divideScalar(far);
  ray.set(point, dir);
  ray.far = far;
  if (ray.intersectObject(target, false).length > 0) return 0;

  /**
   * Inside. How far in is the distance back out to the wall, not the distance
   * to the axis — those are opposites, and reporting the wrong one calls a
   * vertex that has just broken the surface the worst offender on the model.
   * Reading it needs the target double-sided for the length of the audit,
   * because this ray meets the wall from behind.
   */
  ray.set(point, dir.negate());
  ray.far = Infinity;
  const out = ray.intersectObject(target, false);
  /* No wall on the way out means the inward ray missed for some reason other
     than the point being inside — a tangent along the silhouette, most often.
     Refusing to assert a penetration that cannot be measured is what separates
     a real fault from the noise around every grazing contact. */
  return out.length ? out[0].distance : 0;
}

/** Below this, a contact is a rounding error rather than a limb inside a body. */
const CLASH_TOLERANCE = 0.0005;

/** A deterministic random, so a given seed is always the same duelist. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** The specs a mode needs, and the camera for each. */
function plan(mode: Mode, seed: number): { specs: StoryCharacter[]; views: View[] } {
  const base = seed === 0 ? defaultCharacter('Mike') : randomCharacter('Mike', seeded(seed * 7919));
  if (mode === 'sheet' || mode === 'seams' || mode === 'parts') {
    const views = mode === 'sheet' ? SHEET : mode === 'parts' ? PARTS : SEAMS;
    return { specs: [base], views };
  }
  const sweep = SWEEPS[mode];
  return {
    specs: sweep.specs.map((s) => ({ ...base, ...s.over })),
    views: sweep.specs.map((s) => ({ ...sweep.view, label: s.label })),
  };
}

/** Columns that keep the viewports as square as the canvas allows. */
function gridFor(n: number): { cols: number; rows: number } {
  if (n <= 2) return { cols: n, rows: 1 };
  if (n <= 4) return { cols: 2, rows: 2 };
  if (n <= 6) return { cols: 3, rows: 2 };
  if (n <= 9) return { cols: 3, rows: 3 };
  if (n <= 12) return { cols: 4, rows: 3 };
  return { cols: 5, rows: Math.ceil(n / 5) };
}

export default function CharacterLab() {
  const holder = useRef<HTMLDivElement>(null);
  const [seed, setSeed] = useState(0);
  const [mode, setMode] = useState<Mode>('sheet');
  const [walking, setWalking] = useState(false);
  /**
   * What the surface is painted with.
   *
   * A fault you can see is not the same as a fault you can name. The head
   * carries its pigment and its ambient occlusion in the vertex colours, so a
   * dark edge on a cheek is either a crease in the geometry or a step in a
   * mask, and the shaded render cannot tell you which — twice now I have
   * corrected the wrong one. `matte` strips every material back to one grey
   * with no vertex colour, which leaves only form; `wire` shows the
   * tessellation the mask is being sampled on.
   */
  const [paint, setPaint] = useState<Paint>('shaded');
  /**
   * Which moment of the stride to hold, or `-1` to let it run.
   *
   * Walking against the wall clock cannot be inspected. Two runs of the shot
   * script catch different moments, so a before and an after are not
   * comparable — you cannot tell a fix from a phase, and I spent a round
   * believing a clearance change had done nothing when I was simply looking at
   * a different part of the cycle. Held at a numbered phase the same frame
   * comes back every time.
   */
  const [phase, setPhase] = useState(-1);
  /**
   * The self-intersection verdict, tagged with the bodies it was measured on.
   *
   * Kept that way rather than cleared when the mode changes: a verdict left
   * standing is the previous mode's answer, and a script polling for "not
   * empty" takes it and moves on. Comparing the tag on the way past is the
   * same guarantee without a second render to do it in.
   */
  const [clash, setClash] = useState<{ of: unknown; text: string } | null>(null);
  const auditRef = useRef<(() => string) | null>(null);
  /**
   * Frozen by default.
   *
   * The idle pose turns the head about a fifth of a radian either way, which
   * is right in the world and useless here: a face shot at a random moment is
   * a three-quarter view with one eye behind the nose, and you end up
   * correcting a model against a camera angle you did not choose. Held at
   * t = 0 the duelist faces front with its eyes open.
   */
  const [live, setLive] = useState(false);

  /* Derived at render, then handed to the loop through a ref. The loop is
     outside React and only ever reads it; the labels below are read from the
     memo, so nothing touches a ref while rendering. */
  const current = useMemo(() => plan(mode, seed), [mode, seed]);
  const clashText = clash && clash.of === current ? clash.text : '';
  const strideRef = useRef(0);
  const liveRef = useRef(false);
  const planRef = useRef(current);
  const paintRef = useRef<Paint>('shaded');
  const phaseRef = useRef(-1);

  useEffect(() => {
    strideRef.current = walking ? 1 : 0;
    liveRef.current = live;
    planRef.current = current;
    paintRef.current = paint;
    phaseRef.current = phase;
  }, [walking, live, current, paint, phase]);

  useEffect(() => {
    const el = holder.current;
    if (!el) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.setScissorTest(true);
    el.appendChild(renderer.domElement);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#20262f');

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.55;

    /* Lit to match the creation booth, so what is corrected here is what
       ships. See the note on lighting in `CharacterCreator`. */
    const key = new THREE.DirectionalLight('#fff0d8', 1.7);
    key.position.set(2.2, 3.4, 3.0);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 30;
    /* Wide enough to cover a whole sweep standing in a row. */
    key.shadow.camera.left = -18;
    key.shadow.camera.right = 18;
    key.shadow.camera.top = 2.6;
    key.shadow.camera.bottom = -0.4;
    key.shadow.bias = -0.0012;
    key.shadow.normalBias = 0.02;
    scene.add(key);

    const rim = new THREE.DirectionalLight('#9dc0ff', 0.75);
    rim.position.set(-2.6, 2.0, -2.4);
    scene.add(rim);

    const floorGeo = new THREE.CircleGeometry(40, 64);
    const floorMat = new THREE.MeshStandardMaterial({ color: '#161b22', roughness: 0.85, metalness: 0.05 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    let rigs: Rig[] = [];
    let builtFor: typeof planRef.current | null = null;

    /* Diagnostic overrides. Kept next to the rigs rather than inside
       `buildCharacter`, so nothing about the shipped model knows they exist. */
    const matteMat = new THREE.MeshStandardMaterial({ color: '#b9bec7', roughness: 0.78, metalness: 0 });
    const wireMat = new THREE.MeshBasicMaterial({ color: '#8fd0ff', wireframe: true });
    const shipped = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    let paintedAs: Paint | null = null;
    const repaint = (p: Paint) => {
      rigs.forEach((r) =>
        r.root.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          if (!shipped.has(mesh)) shipped.set(mesh, mesh.material);
          mesh.material = p === 'matte' ? matteMat : p === 'wire' ? wireMat : shipped.get(mesh)!;
        })
      );
      paintedAs = p;
    };

    /* Stood in a row rather than swapped in and out: each viewport gets its
       own camera pointed at its own duelist, so one frame draws the whole
       sweep and there is nothing to toggle between shots. */
    const rebuild = (next: typeof planRef.current) => {
      rigs.forEach((r) => {
        scene.remove(r.root);
        r.dispose();
      });
      /* The old meshes are gone, and with them any right to their entries. */
      shipped.clear();
      rigs = next.specs.map((spec, i) => {
        const rig = buildCharacter(spec);
        rig.root.position.x = (i - (next.specs.length - 1) / 2) * SPACING;
        scene.add(rig.root);
        return rig;
      });
      builtFor = next;
      repaint(paintRef.current);
    };
    rebuild(planRef.current);

    /**
     * Walks the duelist through the whole stride and reports the deepest any
     * moving part gets inside another.
     *
     * Looking for clipping by eye means looking at one moment, from one angle,
     * on one duelist, and being sure — and I have been sure and wrong about
     * this three times. Every vertex of every hand, bracer, forearm, boot and
     * shin is tested against every tube it could be inside of, at sixteen
     * moments of the walk and again standing. The answer is a number in
     * millimetres, and zero is the only acceptable one.
     */
    const audit = () => {
      const ray = new THREE.Raycaster();
      const p = new THREE.Vector3();
      const local = new THREE.Vector3();
      const axis = new THREE.Vector3();
      const dir = new THREE.Vector3();
      const worst = new Map<string, number>();

      /* Every surface double-sided for the duration, so a ray leaving a body
         from the inside registers the wall it passes through. Restored below —
         the shipped materials are front-faced and stay that way. */
      const sides = new Map<THREE.Material, THREE.Side>();
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          if (!sides.has(mat)) sides.set(mat, mat.side);
          mat.side = THREE.DoubleSide;
        }
      });

      for (const rig of rigs) {
        /* Keyed by the part, keeping which side each one is. */
        const byPart = new Map<string, { side: string; mesh: THREE.Mesh }[]>();
        rig.root.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh || !mesh.name) return;
          const [part, side = ''] = mesh.name.split('.');
          const list = byPart.get(part) ?? [];
          list.push({ side, mesh });
          byPart.set(part, list);
          mesh.geometry.computeBoundingBox();
        });

        const STEPS = 16;
        for (let k = 0; k <= STEPS; k++) {
          /* The last pass is the standing pose: a fault that only exists at
             rest is still a fault. */
          const walking = k < STEPS;
          rig.pose(walking ? (k / STEPS) * CYCLE : 0, walking ? 1 : 0);
          rig.root.updateWorldMatrix(true, true);

          for (const { probe, into, otherSideOnly } of CLASHES) {
            for (const src of byPart.get(probe) ?? []) {
              const pos = src.mesh.geometry.attributes.position;
              /* Enough points to catch a limb inside a body, few enough that
                 sixteen poses of a twelve-strong sweep still finishes. */
              const step = Math.max(1, Math.ceil(pos.count / 260));
              for (const targetPart of into) {
                if (!TUBES.has(targetPart)) continue;
                for (const dst of byPart.get(targetPart) ?? []) {
                  if (dst.mesh === src.mesh) continue;
                  if (otherSideOnly && dst.side === src.side) continue;
                  for (let i = 0; i < pos.count; i += step) {
                    p.fromBufferAttribute(pos, i);
                    src.mesh.localToWorld(p);
                    const d = insideDepth(ray, p, dst.mesh, local, axis, dir);
                    if (d > CLASH_TOLERANCE) {
                      const key = `${probe}.${src.side} in ${targetPart}${dst.side ? `.${dst.side}` : ''}`;
                      worst.set(key, Math.max(worst.get(key) ?? 0, d));
                    }
                  }
                }
              }
            }
          }
        }
      }

      sides.forEach((side, mat) => (mat.side = side));
      rigs.forEach((r) => r.pose(0, 0));

      const rows = [...worst.entries()].sort((a, b) => b[1] - a[1]);
      return rows.length
        ? rows.map(([k, v]) => `${k} ${(v * 1000).toFixed(1)}mm`).join(' · ')
        : 'clear';
    };

    auditRef.current = audit;

    const cameras: THREE.PerspectiveCamera[] = [];
    const cameraAt = (i: number) => {
      while (cameras.length <= i) cameras.push(new THREE.PerspectiveCamera(35, 1, 0.02, 100));
      return cameras[i];
    };

    const resize = () => renderer.setSize(el.clientWidth || 1, el.clientHeight || 1, false);
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    const clock = new THREE.Clock();
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (builtFor !== planRef.current) rebuild(planRef.current);
      if (paintedAs !== paintRef.current) repaint(paintRef.current);
      const held = phaseRef.current;
      const t =
        held >= 0
          ? (held / PHASES) * CYCLE
          : liveRef.current || strideRef.current > 0
            ? clock.getElapsedTime()
            : 0;
      rigs.forEach((r) => r.pose(t, strideRef.current));

      const { views, specs } = planRef.current;
      const W = el.clientWidth;
      const H = el.clientHeight;
      /* Nothing to draw into, and a zero-sized viewport would set every
         camera's aspect to NaN on the way past. */
      if (W === 0 || H === 0) return;
      const { cols, rows } = gridFor(views.length);
      const cw = Math.floor(W / cols);
      const ch = Math.floor(H / rows);

      views.forEach((v, i) => {
        const cx = (i % cols) * cw;
        const cy = H - Math.floor(i / cols) * ch - ch;
        renderer.setViewport(cx, cy, cw, ch);
        renderer.setScissor(cx, cy, cw, ch);
        const cam = cameraAt(i);
        cam.aspect = cw / ch;
        cam.updateProjectionMatrix();
        /* One duelist per viewport when sweeping; the same one from six angles
           otherwise. */
        const ox = (specs.length > 1 ? (i - (specs.length - 1) / 2) * SPACING : 0) + (v.x ?? 0);
        cam.position.set(
          ox + Math.sin(v.yaw) * Math.cos(v.pitch) * v.dist,
          v.y + Math.sin(v.pitch) * v.dist,
          Math.cos(v.yaw) * Math.cos(v.pitch) * v.dist
        );
        cam.lookAt(ox, v.y, 0);
        renderer.render(scene, cam);
      });
    };
    frame();

    return () => {
      cancelAnimationFrame(raf);
      auditRef.current = null;
      ro.disconnect();
      rigs.forEach((r) => r.dispose());
      matteMat.dispose();
      wireMat.dispose();
      floorGeo.dispose();
      floorMat.dispose();
      pmrem.dispose();
      renderer.forceContextLoss();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  const labels = current.views.map((v) => v.label).join(' · ');

  return (
    <main className="flex h-[100svh] w-full flex-col bg-[#0d1016]">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 p-2">
        {MODES.map((m) => (
          <button
            key={m}
            data-mode={m}
            data-on={m === mode ? 'yes' : 'no'}
            className={`btn rounded px-2.5 py-1.5 text-[11px] ${m === mode ? 'btn-primary' : ''}`}
            onClick={() => setMode(m)}
          >
            {m}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-white/15" />
        <button className="btn rounded px-2.5 py-1.5 text-[11px]" onClick={() => setSeed((s) => s + 1)}>
          Next duelist
        </button>
        <button
          data-walk={walking ? 'on' : 'off'}
          className={`btn rounded px-2.5 py-1.5 text-[11px] ${walking ? 'btn-primary' : ''}`}
          onClick={() => setWalking((w) => !w)}
        >
          {walking ? 'Walking' : 'Standing'}
        </button>
        <button
          className={`btn rounded px-2.5 py-1.5 text-[11px] ${live ? 'btn-primary' : ''}`}
          onClick={() => setLive((l) => !l)}
        >
          {live ? 'Live' : 'Frozen'}
        </button>
        <span className="mx-1 h-4 w-px bg-white/15" />
        <button
          data-phase="-1"
          data-on={phase < 0 ? 'yes' : 'no'}
          className={`btn rounded px-2.5 py-1.5 text-[11px] ${phase < 0 ? 'btn-primary' : ''}`}
          onClick={() => setPhase(-1)}
        >
          run
        </button>
        {Array.from({ length: PHASES }, (_, i) => (
          <button
            key={i}
            data-phase={i}
            data-on={phase === i ? 'yes' : 'no'}
            className={`btn rounded px-2 py-1.5 text-[11px] ${phase === i ? 'btn-primary' : ''}`}
            onClick={() => setPhase(i)}
          >
            {i}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-white/15" />
        <button
          data-clash={clashText}
          className="btn rounded px-2.5 py-1.5 text-[11px]"
          onClick={() => setClash({ of: current, text: auditRef.current?.() ?? 'no rig' })}
        >
          {clashText ? `clash: ${clashText}` : 'check clipping'}
        </button>
        <span className="mx-1 h-4 w-px bg-white/15" />
        {PAINTS.map((p) => (
          <button
            key={p}
            data-paint={p}
            data-on={p === paint ? 'yes' : 'no'}
            className={`btn rounded px-2.5 py-1.5 text-[11px] ${p === paint ? 'btn-primary' : ''}`}
            onClick={() => setPaint(p)}
          >
            {p}
          </button>
        ))}
      </div>
      <div className="shrink-0 px-2 pb-1">
        <span className="font-display text-[10px] uppercase tracking-widest text-ptextdim">
          seed {seed} · {labels}
        </span>
      </div>
      <div ref={holder} className="min-h-0 flex-1" />
    </main>
  );
}
