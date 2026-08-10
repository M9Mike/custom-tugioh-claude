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
 * The joints where two parts can pass through each other.
 *
 * Every one of these is a place where geometry that moves meets geometry that
 * does not — a hand swinging past a thigh, a deltoid rotating inside a sleeve,
 * a jaw turning over a collar, a hem the leg sweeps inside of.
 */
const SEAMS: View[] = [
  { y: 0.92, dist: 0.75, yaw: 0.5, pitch: 0.1, label: 'hand · hem · thigh' },
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

type Mode = 'sheet' | 'seams' | keyof typeof SWEEPS;
const MODES: Mode[] = [
  'sheet',
  'seams',
  'outfit',
  'outfit-behind',
  'hair',
  'hair-behind',
  'beard',
  'frame',
  'gauntlet',
  'skin',
];

/** How far apart sweep duelists stand. Wide enough that none overlaps a neighbour. */
const SPACING = 2.6;

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
  if (mode === 'sheet' || mode === 'seams') {
    const views = mode === 'sheet' ? SHEET : SEAMS;
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
  const strideRef = useRef(0);
  const liveRef = useRef(false);
  const planRef = useRef(current);

  useEffect(() => {
    strideRef.current = walking ? 1 : 0;
    liveRef.current = live;
    planRef.current = current;
  }, [walking, live, current]);

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

    /* Stood in a row rather than swapped in and out: each viewport gets its
       own camera pointed at its own duelist, so one frame draws the whole
       sweep and there is nothing to toggle between shots. */
    const rebuild = (next: typeof planRef.current) => {
      rigs.forEach((r) => {
        scene.remove(r.root);
        r.dispose();
      });
      rigs = next.specs.map((spec, i) => {
        const rig = buildCharacter(spec);
        rig.root.position.x = (i - (next.specs.length - 1) / 2) * SPACING;
        scene.add(rig.root);
        return rig;
      });
      builtFor = next;
    };
    rebuild(planRef.current);

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
      const t = liveRef.current || strideRef.current > 0 ? clock.getElapsedTime() : 0;
      rigs.forEach((r) => r.pose(t, strideRef.current));

      const { views, specs } = planRef.current;
      const W = el.clientWidth;
      const H = el.clientHeight;
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
        const ox = specs.length > 1 ? (i - (specs.length - 1) / 2) * SPACING : 0;
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
      ro.disconnect();
      rigs.forEach((r) => r.dispose());
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
