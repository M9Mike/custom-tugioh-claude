'use client';

/**
 * The creation booth.
 *
 * A live 3D duelist on one half of the screen and every knob that shapes them
 * on the other. Nothing here is previewed as an icon or a paper doll: the model
 * on screen is the model that walks into the world, built by the same function
 * from the same record, so what you approve is literally what you get.
 *
 * The confirmation is deliberately heavy, because the decision is: a duelist is
 * bound to the name that made them and there is no way back from this screen.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  CLOTH_COLORS,
  EYE_COLORS,
  FACIAL_HAIR,
  FRAMES,
  GAUNTLETS,
  HAIR_COLORS,
  HAIR_STYLES,
  MAX_CHARACTER_NAME,
  OUTFITS,
  SKIN_TONES,
  TRIM_COLORS,
  defaultCharacter,
  randomCharacter,
  type StoryCharacter,
} from '@/story/character';
import { buildCharacter, type Rig } from './humanoid';
import { canDraw3d } from './webgl';
import { sfx } from '@/lib/sfx';

type Tab = 'body' | 'face' | 'hair' | 'style';

const TABS: { id: Tab; label: string }[] = [
  { id: 'body', label: 'Body' },
  { id: 'face', label: 'Face' },
  { id: 'hair', label: 'Hair' },
  { id: 'style', label: 'Attire' },
];

/**
 * How far the pinch may take the camera, as a multiple of the framing's own
 * distance.
 *
 * It used to run to 2.2, which on the body framing is seven metres from a
 * 1.78 m duelist: the character you are making becomes a speck on an empty
 * stage, and there is no button that says "come back". A range you cannot get
 * lost in is worth more than one that goes further.
 */
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 1.6;

/** Where the camera sits for each framing, as (height, distance, pitch). */
const SHOTS = {
  /* Framed with headroom. The viewport runs under the screen's title, so a
     shot tight enough to fill it puts the duelist's head behind the words —
     and the head is the half of the model anybody is actually judging. */
  full: { y: 1.0, dist: 3.25, pitch: 0.05 },
  face: { y: 1.63, dist: 0.66, pitch: 0.0 },
} as const;
type Shot = keyof typeof SHOTS;

interface Props {
  username: string;
  /** Resolves once the server has the character; the caller moves on. */
  onConfirm: (character: StoryCharacter) => Promise<string | null>;
  onBack: () => void;
}

export default function CharacterCreator({ username, onConfirm, onBack }: Props) {
  const [spec, setSpec] = useState<StoryCharacter>(() => defaultCharacter(username));
  const [tab, setTab] = useState<Tab>('body');
  const [shot, setShot] = useState<Shot>('full');
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* Asked once, before anything is built. Finding out whether this browser can
     draw at all is a question with an answer, so it is answered up front rather
     than discovered by a constructor throwing halfway through a mount — which
     would mean rendering a viewport that can never contain anything. */
  const [webglFailed, setWebglFailed] = useState(() => !canDraw3d());

  const set = useCallback(<K extends keyof StoryCharacter>(key: K, value: StoryCharacter[K]) => {
    setSpec((s) => ({ ...s, [key]: value }));
  }, []);

  /* ---------------- the viewport ---------------- */

  const holder = useRef<HTMLDivElement>(null);
  /* The spec is read by the render loop rather than closed over, so changing a
     knob never tears down and rebuilds the renderer — only the body. */
  const specRef = useRef(spec);
  const shotRef = useRef<Shot>(shot);
  useEffect(() => {
    specRef.current = spec;
    shotRef.current = shot;
  }, [spec, shot]);

  useEffect(() => {
    const el = holder.current;
    if (!el) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch (err) {
      /* The probe above said yes and the real thing said no — a driver that
         gave up between one context and the next. Reported out of band because
         this is news arriving from an external system, not a render decision.  */
      console.error('character booth: no WebGL context', err);
      queueMicrotask(() => setWebglFailed(true));
      return;
    }
    /* Capped at 2. An iPhone 17 Pro Max reports 3, which is nine times the
       fragments of a 1x buffer for a difference nobody can see at arm's length
       — and it is the one device most likely to be running this on a battery. */
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    el.appendChild(renderer.domElement);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.touchAction = 'none';

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#171d26');
    scene.fog = new THREE.Fog('#171d26', 5, 12);

    const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 100);

    /**
     * A key, a rim, a soft front fill — and, carrying more of the image than
     * any of them, an environment.
     *
     * The duelist's skin and cloth are `MeshPhysicalMaterial` with sheen, and
     * sheen is a broad view-facing lobe: pile enough direct light on it and
     * every surface saturates towards white, which is how an earlier version
     * of this booth turned a black coat and a red jacket into the same pale
     * grey. Most of the light here is therefore image-based and low — it is
     * what gives a cheekbone a gradient instead of a hotspot — and the
     * directional lights only have to shape it.
     */
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envRT.texture;
    scene.environmentIntensity = 0.55;

    const key = new THREE.DirectionalLight('#ffe7c2', 1.8);
    key.position.set(2.4, 3.6, 3.2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 12;
    key.shadow.camera.left = -1.6;
    key.shadow.camera.right = 1.6;
    key.shadow.camera.top = 2.6;
    key.shadow.camera.bottom = -0.4;
    key.shadow.bias = -0.0015;
    key.shadow.normalBias = 0.02;
    scene.add(key);

    const rim = new THREE.DirectionalLight('#8fb6ff', 0.85);
    rim.position.set(-2.8, 2.2, -2.6);
    scene.add(rim);

    /* A second, weaker key from the front so a face is never read purely by its
       shadows — the booth's whole job is showing what somebody chose. */
    const fill = new THREE.DirectionalLight('#dfe8f5', 0.42);
    fill.position.set(-1.2, 1.4, 3.4);
    scene.add(fill);

    scene.add(new THREE.HemisphereLight('#b8c8dd', '#2a2620', 0.4));

    /* A plinth, so the duelist is standing on something rather than hovering in
       a void — and so the shadow has somewhere to land. */
    const plinthGeo = new THREE.CylinderGeometry(0.78, 0.86, 0.08, 48);
    const plinthMat = new THREE.MeshStandardMaterial({ color: '#1a1f27', roughness: 0.9, metalness: 0.15 });
    const plinth = new THREE.Mesh(plinthGeo, plinthMat);
    plinth.position.y = -0.04;
    plinth.receiveShadow = true;
    scene.add(plinth);

    const ringGeo = new THREE.TorusGeometry(0.8, 0.011, 8, 64);
    const ringMat = new THREE.MeshStandardMaterial({ color: '#c2a15a', roughness: 0.4, metalness: 0.8 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.002;
    scene.add(ring);

    const pivot = new THREE.Group();
    scene.add(pivot);

    let rig: Rig | null = null;
    let built: StoryCharacter | null = null;
    const rebuild = (next: StoryCharacter) => {
      if (rig) {
        pivot.remove(rig.root);
        rig.dispose();
      }
      rig = buildCharacter(next);
      pivot.add(rig.root);
      built = next;
    };
    rebuild(specRef.current);

    /* ---- pointer control: drag to turn, pinch to zoom ---- */
    let yaw = 0.35;
    /* `pitchGoal` is what the drag writes; `pitch` chases it. The gap is five
       frames at 60Hz, which is under the threshold of feeling like lag, and it
       buys the framing buttons a way to put the camera back on the level
       without the picture jumping. */
    let pitchGoal = 0;
    let pitch = 0;
    let zoom = 1;
    let idleUntil = 0;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinchStart = 0;
    let zoomStart = 1;
    let lastShot = shotRef.current;

    const canvas = renderer.domElement;
    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
        zoomStart = zoom;
      }
    };
    const onMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      idleUntil = performance.now() + 3000;
      if (pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchStart > 0) zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomStart * (pinchStart / d)));
        return;
      }
      yaw -= (e.clientX - prev.x) * 0.009;
      pitchGoal = Math.min(0.5, Math.max(-0.35, pitchGoal + (e.clientY - prev.y) * 0.004));
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchStart = 0;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      idleUntil = performance.now() + 3000;
      zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * (1 + e.deltaY * 0.0012)));
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    /* The camera eases towards whichever framing is selected rather than cutting
       to it — a jump between a full body and a face at 38° reads as a different
       character for a beat. */
    let camY = SHOTS.full.y;
    let camDist = SHOTS.full.dist;

    const clock = new THREE.Clock();
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const t = clock.getElapsedTime();

      /* One rebuild per frame at most, however fast a slider is dragged. */
      if (built !== specRef.current) rebuild(specRef.current);

      if (performance.now() > idleUntil && pointers.size === 0) yaw += 0.0035;

      /**
       * A new framing starts at its own distance and on its own level.
       *
       * Both of these persisted across a framing change, and both quietly broke
       * the promise the two buttons make. `zoom` multiplies whatever the framing
       * asks for, so after a pinch outwards "Face" put the camera at 0.66 m
       * times the zoom the player happened to be left at — a distant torso. And
       * a drag downwards leaves the camera 29° up, from where "Face" frames the
       * top of the head: the one shot in the booth that has to show a face
       * showed a scalp instead. Neither is a state a player can name or undo;
       * the buttons are presets, so they reset what a preset owns and leave yaw,
       * which is the player turning the model, alone.
       */
      if (shotRef.current !== lastShot) {
        lastShot = shotRef.current;
        zoom = 1;
        pitchGoal = 0;
      }
      const target = SHOTS[shotRef.current];
      camY += (target.y - camY) * 0.12;
      camDist += (target.dist * zoom - camDist) * 0.12;
      pitch += (pitchGoal - pitch) * 0.12;

      pivot.rotation.y = yaw;
      camera.position.set(
        0,
        camY + Math.sin(pitch + target.pitch) * camDist,
        Math.cos(pitch + target.pitch) * camDist
      );
      camera.lookAt(0, camY, 0);

      rig?.pose(t, 0);
      renderer.render(scene, camera);
    };
    frame();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
      rig?.dispose();
      plinthGeo.dispose();
      plinthMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      envRT.dispose();
      pmrem.dispose();
      /* `dispose()` frees three's own objects but leaves the WebGL context
         itself alive until the GC gets round to it. A browser allows only a
         handful at once, and walking booth → deck → world → booth opens one
         each time, so on a phone they run out. Asking for the loss hands it
         back at unmount. */
      renderer.forceContextLoss();
      renderer.dispose();
      canvas.remove();
    };
  }, []);

  /* ---------------- confirmation ---------------- */

  /* A ref, not `busy`: state does not update until the next render, so a fast
     double-tap on a button that reads `disabled={busy}` can still fire twice
     and post twice. On the one screen whose result is permanent, once means
     once. */
  const binding = useRef(false);

  const confirm = async () => {
    if (binding.current) return;
    binding.current = true;
    setBusy(true);
    setError(null);
    try {
      const problem = await onConfirm({ ...spec, name: spec.name.trim() || username });
      if (problem) {
        setError(problem);
        setBusy(false);
        setAsking(false);
        binding.current = false;
      }
      /* No success branch, deliberately: the caller swaps this screen out, and
         re-enabling the button first would flash it live for a frame on the way
         to unmounting. */
    } catch (err) {
      /* `onConfirm` is a prop and is only contracted to *resolve* a problem, so
         a rejection is a broken caller rather than a failed save. It still has
         to be caught here: nothing else clears `busy`, and nothing is going to
         unmount this screen either, so a throw would leave the duelist you just
         made behind a button that says "Binding…" for ever. */
      console.error('character booth: onConfirm rejected', err);
      setError('Your duelist could not be saved. Try again in a moment.');
      setBusy(false);
      setAsking(false);
      binding.current = false;
    }
  };

  if (webglFailed) {
    return (
      <main className="safe-page mx-auto flex min-h-[100dvh] w-full max-w-lg flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="font-display text-2xl text-brassbright">This device cannot draw the booth</h1>
        <p className="text-xs leading-relaxed text-ptext/85">
          Story Mode&apos;s character creator needs WebGL, and this browser would not give us a 3D context. Try
          Safari or Chrome with hardware acceleration switched on.
        </p>
        <button className="btn rounded px-4 py-2 text-xs" onClick={onBack}>
          Back
        </button>
      </main>
    );
  }

  return (
    <main className="safe-page flex h-[100svh] w-full flex-col overflow-hidden lg:flex-row">
      {/* ---- viewport ---- */}
      <div className="relative h-[40svh] shrink-0 lg:h-full lg:flex-1">
        <div ref={holder} className="absolute inset-0" />
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3">
          <div>
            <h1 className="font-display text-lg leading-none text-brassbright">Make your duelist</h1>
            <p className="mt-1 text-[10px] uppercase tracking-widest text-ptextdim">Drag to turn · pinch to zoom</p>
          </div>
          <div className="pointer-events-auto flex gap-1">
            {(['full', 'face'] as Shot[]).map((s) => (
              <button
                key={s}
                /* Named for the tests as well as for a screen reader: the tab
                   strip below has buttons reading "Body" and "Face" too, and a
                   text selector cannot tell the two apart. */
                data-shot={s}
                aria-label={s === 'full' ? 'Frame the whole body' : 'Frame the face'}
                onClick={() => {
                  sfx.click();
                  setShot(s);
                }}
                className={`btn rounded px-2 py-1 text-[9px] ${shot === s ? 'btn-primary' : ''}`}
              >
                {s === 'full' ? 'Body' : 'Face'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ---- controls ---- */}
      <div className="flex min-h-0 flex-1 flex-col border-t border-stoneline lg:w-[420px] lg:flex-none lg:border-l lg:border-t-0">
        <div className="flex shrink-0 gap-1 p-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              data-tab={t.id}
              onClick={() => {
                sfx.click();
                setTab(t.id);
                setShot(t.id === 'face' || t.id === 'hair' ? 'face' : 'full');
              }}
              className={`btn flex-1 rounded px-2 py-2 text-[10px] ${tab === t.id ? 'btn-primary' : ''}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {tab === 'body' && (
            <>
              <Field label="Name">
                <input
                  value={spec.name}
                  maxLength={MAX_CHARACTER_NAME}
                  onChange={(e) => set('name', e.target.value)}
                  placeholder={username}
                  className="w-full rounded border border-stoneline bg-black/45 px-3 py-2 text-sm text-parchment outline-none focus:border-brass"
                />
              </Field>
              <Choices
                label="Frame"
                options={FRAMES.map((f) => ({ id: f.id, label: f.label, note: f.note }))}
                value={spec.frame}
                onPick={(v) => set('frame', v)}
              />
              <Slider label="Build" hint="Slight — heavy-set" value={spec.build} onChange={(v) => set('build', v)} />
              <Slider label="Height" hint="Short — tall" value={spec.height} onChange={(v) => set('height', v)} />
              <Swatches label="Skin" colors={SKIN_TONES} value={spec.skin} onPick={(i) => set('skin', i)} />
            </>
          )}

          {tab === 'face' && (
            <>
              <Slider label="Jaw" hint="Tapered — square" value={spec.jaw} onChange={(v) => set('jaw', v)} />
              <Slider label="Eye shape" hint="Round — narrow" value={spec.eyeShape} onChange={(v) => set('eyeShape', v)} />
              <Swatches label="Eyes" colors={EYE_COLORS} value={spec.eyeColor} onPick={(i) => set('eyeColor', i)} />
              <Slider label="Brow" hint="Light — heavy" value={spec.brow} onChange={(v) => set('brow', v)} />
              <Slider label="Nose" hint="Small — strong" value={spec.nose} onChange={(v) => set('nose', v)} />
              <Slider label="Mouth" hint="Narrow — wide" value={spec.mouth} onChange={(v) => set('mouth', v)} />
              <Slider label="Years" hint="Young — weathered" value={spec.age} onChange={(v) => set('age', v)} />
            </>
          )}

          {tab === 'hair' && (
            <>
              <Choices
                label="Hair"
                options={HAIR_STYLES}
                value={spec.hair}
                onPick={(v) => set('hair', v)}
              />
              <Swatches label="Hair colour" colors={HAIR_COLORS} value={spec.hairColor} onPick={(i) => set('hairColor', i)} />
              <Choices
                label="Facial hair"
                options={FACIAL_HAIR}
                value={spec.facialHair}
                onPick={(v) => set('facialHair', v)}
              />
            </>
          )}

          {tab === 'style' && (
            <>
              <Choices
                label="Attire"
                options={OUTFITS.map((o) => ({ id: o.id, label: o.label, note: o.note }))}
                value={spec.outfit}
                onPick={(v) => set('outfit', v)}
              />
              <Swatches label="Main colour" colors={CLOTH_COLORS} value={spec.primary} onPick={(i) => set('primary', i)} />
              <Swatches label="Under layer" colors={CLOTH_COLORS} value={spec.secondary} onPick={(i) => set('secondary', i)} />
              <Swatches label="Fittings" colors={TRIM_COLORS} value={spec.trim} onPick={(i) => set('trim', i)} />
              <Swatches label="Trousers" colors={CLOTH_COLORS} value={spec.trouser} onPick={(i) => set('trouser', i)} />
              <Swatches label="Boots" colors={CLOTH_COLORS} value={spec.boots} onPick={(i) => set('boots', i)} />
              <Choices label="Gauntlet" options={GAUNTLETS} value={spec.gauntlet} onPick={(v) => set('gauntlet', v)} />
              <Field label="Cape">
                <div className="flex gap-2">
                  <button
                    className={`btn flex-1 rounded px-3 py-2 text-[10px] ${spec.cape ? 'btn-primary' : ''}`}
                    onClick={() => {
                      sfx.click();
                      set('cape', !spec.cape);
                    }}
                  >
                    {spec.cape ? 'Worn' : 'None'}
                  </button>
                </div>
              </Field>
              {spec.cape && (
                <Swatches label="Cape colour" colors={CLOTH_COLORS} value={spec.capeColor} onPick={(i) => set('capeColor', i)} />
              )}
            </>
          )}

          <div className="mt-4 flex gap-2">
            <button
              className="btn flex-1 rounded px-3 py-2 text-[10px]"
              onClick={() => {
                sfx.click();
                setSpec(randomCharacter(spec.name || username));
              }}
            >
              Surprise me
            </button>
            <button
              className="btn flex-1 rounded px-3 py-2 text-[10px]"
              onClick={() => {
                sfx.click();
                setSpec(defaultCharacter(spec.name || username));
              }}
            >
              Reset
            </button>
          </div>
        </div>

        <div className="shrink-0 border-t border-stoneline p-3">
          {error && (
            <p className="mb-2 rounded border border-oxblood bg-[#2a1216]/70 px-3 py-2 text-[11px] text-[#f0c9cc]">{error}</p>
          )}
          <div className="flex gap-2">
            <button className="btn rounded px-4 py-3 text-xs" onClick={onBack} disabled={busy}>
              Back
            </button>
            <button
              className="btn btn-primary flex-1 rounded px-4 py-3 text-xs"
              disabled={busy}
              onClick={() => {
                sfx.click();
                setAsking(true);
              }}
            >
              {busy ? 'Binding…' : 'This is my duelist'}
            </button>
          </div>
        </div>
      </div>

      {asking && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/85 p-5">
          <div className="panel grain w-full max-w-sm rounded p-5">
            <h2 className="font-display text-lg text-brassbright">Bind this duelist to {username}?</h2>
            <div className="brass-rule my-3" />
            <p className="text-xs leading-relaxed text-ptext/85">
              Your duelist is written against the name <span className="text-parchment">{username}</span> and comes
              back with it on any device. Their appearance cannot be changed afterwards — not by refreshing, not by
              signing in somewhere else.
            </p>
            <div className="mt-4 flex gap-2">
              <button className="btn flex-1 rounded px-4 py-2 text-xs" onClick={() => setAsking(false)} disabled={busy}>
                Keep editing
              </button>
              <button className="btn btn-primary flex-1 rounded px-4 py-2 text-xs" onClick={confirm} disabled={busy}>
                {busy ? 'Binding…' : 'Bind'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Controls                                                            */
/* ------------------------------------------------------------------ */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <p className="mb-1 font-display text-[10px] uppercase tracking-widest text-ptextdim">{label}</p>
      {children}
    </div>
  );
}

function Slider({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="mt-3">
      <div className="mb-1 flex items-baseline justify-between">
        <p className="font-display text-[10px] uppercase tracking-widest text-ptextdim">{label}</p>
        <p className="text-[9px] text-ptextdim/70">{hint}</p>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-6 w-full accent-[#c2a15a]"
      />
    </div>
  );
}

function Swatches({
  label,
  colors,
  value,
  onPick,
}: {
  label: string;
  colors: readonly string[];
  value: number;
  onPick: (i: number) => void;
}) {
  return (
    <div className="mt-3">
      <p className="mb-1 font-display text-[10px] uppercase tracking-widest text-ptextdim">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {colors.map((c, i) => (
          <button
            key={c + i}
            aria-label={`${label} ${i + 1}`}
            onClick={() => {
              sfx.click();
              onPick(i);
            }}
            className={`h-7 w-7 rounded border transition-transform ${
              value === i ? 'scale-110 border-brassbright ring-1 ring-brass' : 'border-stoneline'
            }`}
            style={{ background: c }}
          />
        ))}
      </div>
    </div>
  );
}

function Choices<T extends string>({
  label,
  options,
  value,
  onPick,
}: {
  label: string;
  options: readonly { id: T; label: string; note?: string }[];
  value: T;
  onPick: (v: T) => void;
}) {
  const note = options.find((o) => o.id === value)?.note;
  return (
    <div className="mt-3">
      <p className="mb-1 font-display text-[10px] uppercase tracking-widest text-ptextdim">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.id}
            onClick={() => {
              sfx.click();
              onPick(o.id);
            }}
            className={`btn rounded px-2.5 py-1.5 text-[10px] ${value === o.id ? 'btn-primary' : ''}`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {note && <p className="mt-1 text-[9px] leading-relaxed text-ptextdim/80">{note}</p>}
    </div>
  );
}
