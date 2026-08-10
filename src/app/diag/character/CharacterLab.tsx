'use client';

/**
 * The character lab.
 *
 * One canvas, six cameras: the duelist from the front, three-quarter, side and
 * back, plus a head-and-shoulders and a face. It exists because the model is
 * the thing this game is sold on, and you cannot tell whether a face works from
 * one angle — a nose that reads correctly head-on can be a wedge in profile,
 * and a jaw that looks strong in profile can vanish from the front.
 *
 * Not linked from anywhere. `/diag/character` is a workbench, the same way
 * `/diag` is: you go to it on purpose.
 */

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { defaultCharacter, randomCharacter, type StoryCharacter } from '@/story/character';
import { buildCharacter, type Rig } from '@/components/story/humanoid';

/** Every view is (target height, distance, yaw, pitch, label). */
const SHEET = [
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
 * A separate set because clipping is not something you see in a contact
 * sheet: it happens at the seams, mid-stride, at a distance you would never
 * frame a character at. Every one of these is a place where geometry that
 * moves meets geometry that does not — a hand swinging past a thigh, a
 * deltoid rotating inside a sleeve, a jaw turning over a collar.
 */
const SEAMS = [
  { y: 0.92, dist: 0.75, yaw: 0.5, pitch: 0.1, label: 'hand · thigh' },
  { y: 1.36, dist: 0.8, yaw: 0.9, pitch: 0.15, label: 'armpit · deltoid' },
  { y: 1.52, dist: 0.55, yaw: 0.7, pitch: -0.15, label: 'jaw · collar' },
  { y: 1.44, dist: 0.7, yaw: 1.15, pitch: 0.5, label: 'shoulder, from above' },
  { y: 1.48, dist: 0.5, yaw: Math.PI, pitch: -0.12, label: 'nape · collar, from below' },
  { y: 1.1, dist: 2.2, yaw: 0, pitch: 0.05, label: 'whole, near' },
];

/** A deterministic random, so a given seed is always the same duelist. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export default function CharacterLab() {
  const holder = useRef<HTMLDivElement>(null);
  const [seed, setSeed] = useState(0);
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
  const [seams, setSeams] = useState(false);
  const specRef = useRef<StoryCharacter>(defaultCharacter('Mike'));
  const strideRef = useRef(0);
  const liveRef = useRef(false);
  const viewsRef = useRef(SHEET);

  useEffect(() => {
    strideRef.current = walking ? 1 : 0;
    liveRef.current = live;
    viewsRef.current = seams ? SEAMS : SHEET;
  }, [walking, live, seams]);

  useEffect(() => {
    specRef.current = seed === 0 ? defaultCharacter('Mike') : randomCharacter('Mike', seeded(seed * 7919));
  }, [seed]);

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

    const key = new THREE.DirectionalLight('#fff0d8', 1.7);
    key.position.set(2.2, 3.4, 3.0);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 12;
    key.shadow.camera.left = -1.4;
    key.shadow.camera.right = 1.4;
    key.shadow.camera.top = 2.4;
    key.shadow.camera.bottom = -0.3;
    key.shadow.bias = -0.0012;
    key.shadow.normalBias = 0.02;
    scene.add(key);

    const rim = new THREE.DirectionalLight('#9dc0ff', 0.75);
    rim.position.set(-2.6, 2.0, -2.4);
    scene.add(rim);

    const floorGeo = new THREE.CircleGeometry(4, 48);
    const floorMat = new THREE.MeshStandardMaterial({ color: '#161b22', roughness: 0.85, metalness: 0.05 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    let rig: Rig | null = null;
    let built: StoryCharacter | null = null;
    const rebuild = (next: StoryCharacter) => {
      if (rig) {
        scene.remove(rig.root);
        rig.dispose();
      }
      rig = buildCharacter(next);
      scene.add(rig.root);
      built = next;
    };
    rebuild(specRef.current);

    const cameras = SHEET.map(() => new THREE.PerspectiveCamera(35, 1, 0.02, 100));

    const resize = () => {
      renderer.setSize(el.clientWidth || 1, el.clientHeight || 1, false);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    const clock = new THREE.Clock();
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const t = liveRef.current || strideRef.current > 0 ? clock.getElapsedTime() : 0;
      if (built !== specRef.current) rebuild(specRef.current);
      rig?.pose(t, strideRef.current);

      const W = el.clientWidth;
      const H = el.clientHeight;
      const cols = 3;
      const rows = 2;
      const cw = Math.floor(W / cols);
      const ch = Math.floor(H / rows);

      viewsRef.current.forEach((v, i) => {
        const cx = (i % cols) * cw;
        const cy = H - Math.floor(i / cols) * ch - ch;
        renderer.setViewport(cx, cy, cw, ch);
        renderer.setScissor(cx, cy, cw, ch);
        const cam = cameras[i];
        cam.aspect = cw / ch;
        cam.updateProjectionMatrix();
        cam.position.set(
          Math.sin(v.yaw) * Math.cos(v.pitch) * v.dist,
          v.y + Math.sin(v.pitch) * v.dist,
          Math.cos(v.yaw) * Math.cos(v.pitch) * v.dist
        );
        cam.lookAt(0, v.y, 0);
        renderer.render(scene, cam);
      });
    };
    frame();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      rig?.dispose();
      floorGeo.dispose();
      floorMat.dispose();
      pmrem.dispose();
      renderer.forceContextLoss();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <main className="flex h-[100svh] w-full flex-col bg-[#0d1016]">
      <div className="flex shrink-0 items-center gap-2 p-2">
        <button className="btn rounded px-3 py-1.5 text-[11px]" onClick={() => setSeed(0)}>
          Default
        </button>
        <button className="btn rounded px-3 py-1.5 text-[11px]" onClick={() => setSeed((s) => s + 1)}>
          Next duelist
        </button>
        <button
          className={`btn rounded px-3 py-1.5 text-[11px] ${walking ? 'btn-primary' : ''}`}
          onClick={() => setWalking((w) => !w)}
        >
          {walking ? 'Walking' : 'Standing'}
        </button>
        <button
          className={`btn rounded px-3 py-1.5 text-[11px] ${live ? 'btn-primary' : ''}`}
          onClick={() => setLive((l) => !l)}
        >
          {live ? 'Live' : 'Frozen'}
        </button>
        <button
          className={`btn rounded px-3 py-1.5 text-[11px] ${seams ? 'btn-primary' : ''}`}
          onClick={() => setSeams((s) => !s)}
        >
          {seams ? 'Seams' : 'Contact sheet'}
        </button>
        <span className="font-display text-[10px] uppercase tracking-widest text-ptextdim">
          seed {seed} · {seams ? 'hand · armpit · collar · knees · cape · near' : 'front · ¾ · side · back · head · face'}
        </span>
      </div>
      <div ref={holder} className="min-h-0 flex-1" />
    </main>
  );
}
