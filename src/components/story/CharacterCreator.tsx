'use client';

/**
 * The creation booth.
 *
 * A live 3D duelist on one half of the screen and, on the other, the only two
 * questions there are: which one, and called what.
 *
 * **There is no customisation here, and its absence is the design.** The booth
 * used to offer tint swatches for three garments and a stature slider, because
 * its roster was nine generic townspeople who each needed dressing before they
 * were anybody. The roster is now eight sculpted characters
 * (`public/models/players/`, catalog in `src/story/premade.ts`), authored as
 * they are meant to look. The way to get more variety is another model, not
 * another knob.
 *
 * It was tried the other way round first, and the textures settled it: these
 * sculpts carry their look in one 1024px atlas where skin, leather and hair
 * all land in a single warm hue a few degrees wide. Recolouring works by hue
 * family, so on 77–88% of each texture there is no rule that repaints the
 * clothing and leaves the arms alone. The old roster tinted cleanly because it
 * was drawn in flat blocks of distinct hue; these are not.
 *
 * Nothing here is previewed as an icon or a paper doll: the model on screen is
 * the model that walks into the world, built by the same loader from the same
 * record, so what you approve is literally what you get.
 *
 * The confirmation is deliberately heavy, because the decision is: a duelist
 * is bound to the name that made them, and the only way back is Delete
 * Character, which starts the whole story over.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  BOOTH_MODELS,
  MAX_PREMADE_NAME,
  defaultPremade,
  modelById,
  type PremadeCharacter,
} from '@/story/premade';
import { buildPremadeRig, preloadAllDuelists, type PremadeRig } from './premadeRig';
import { canDraw3d } from './webgl';
import { sfx } from '@/lib/sfx';

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
  /* The face framing's height is a fallback only: the catalog spans a real
     spread of statures, so the render loop reads head height off the rig it
     actually built. */
  face: { y: 1.63, dist: 0.8, pitch: 0.0 },
} as const;
type Shot = keyof typeof SHOTS;

interface Props {
  username: string;
  /** Resolves once the server has the character; the caller moves on. */
  onConfirm: (character: PremadeCharacter) => Promise<string | null>;
  onBack: () => void;
}

export default function CharacterCreator({ username, onConfirm, onBack }: Props) {
  const [pick, setPick] = useState<PremadeCharacter>(() => defaultPremade(username));
  const [name, setName] = useState('');
  const [shot, setShot] = useState<Shot>('full');
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* Flipped when the first model lands on the plinth. The driving scripts
     wait for it before comparing screenshots, and it is honest UI besides:
     a model is a fetch away, not a constructor away. Binding is gated on it
     too — nobody may approve a duelist the plinth has never shown. */
  const [modelReady, setModelReady] = useState(false);
  /* A first load that failed outright — the plinth is empty and says so. */
  const [loadFailed, setLoadFailed] = useState(false);
  /* Asked once, before anything is built — see the note in `canDraw3d`. */
  const [webglFailed, setWebglFailed] = useState(() => !canDraw3d());

  /* The booth edits the record the world runs on, minus the name: the render
     loop rebuilds on identity, and a spec that changed with the name tore
     down and rebuilt the whole duelist on every keystroke of it. */
  const spec = useMemo(
    () => ({ ...pick, name: username }),
    [pick, username]
  );
  /* The same record with the chosen name on it — what binding actually posts. */
  const named = useMemo(
    () => ({ ...spec, name: (name.trim() || username).slice(0, MAX_PREMADE_NAME) }),
    [spec, name, username]
  );

  /* Picking a duelist is also framing: it pulls back to the whole body, so a
     player who has zoomed into one face is not left staring at the next one's
     collarbone. It is the only choice left that moves the camera. */
  const choose = (next: PremadeCharacter, framing?: Shot) => {
    sfx.click();
    setPick(next);
    if (framing) setShot(framing);
  };

  /* ---------------- the viewport ---------------- */

  const holder = useRef<HTMLDivElement>(null);
  /* The spec is read by the render loop rather than closed over, so changing
     a knob never tears down and rebuilds the renderer — only the duelist. */
  const specRef = useRef(spec);
  const shotRef = useRef<Shot>(shot);
  useEffect(() => {
    specRef.current = spec;
    shotRef.current = shot;
  }, [spec, shot]);

  useEffect(() => {
    const el = holder.current;
    if (!el) return;

    /* Warm the cache for the whole roster up front: the first thing every
       player does is flick through it, and a stall per flick reads as broken. */
    preloadAllDuelists();

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
     * A key, a rim, a soft front fill — and an environment carrying most of
     * the image, kept from the booth this one replaced: models lit only by
     * direct light read as cardboard, and the vendored atlases carry their
     * own painted shading that a hot key would blow out.
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

    let rig: PremadeRig | null = null;
    /* Eye level of whoever is actually standing on the plinth, kept fresh by
       every swap so the face framing follows a change of model or stature. */
    let faceY = SHOTS.face.y;

    /**
     * Building a duelist is asynchronous — there is a file behind it — so the
     * loop asks for a build when the spec moves and a sequence number throws
     * away everything but the newest answer. The old model holds the plinth
     * until its replacement is actually ready: an empty stage between two
     * models reads as the booth crashing, twice, on every tap.
     */
    let requestedKey: string | null = null;
    let buildSeq = 0;
    const rebuild = (next: PremadeCharacter) => {
      const seq = ++buildSeq;
      buildPremadeRig(next)
        .then((fresh) => {
          if (seq !== buildSeq) {
            fresh.dispose();
            return;
          }
          if (rig) {
            pivot.remove(rig.root);
            rig.dispose();
          }
          rig = fresh;
          pivot.add(rig.root);
          faceY = rig.height - 0.22;
          setModelReady(true);
          setLoadFailed(false);
        })
        .catch((err) => {
          /* A model that cannot be fetched is news from outside, not a render
             decision. The booth keeps whatever it was showing — but a failed
             fetch is not a permanent answer, so the ask is re-armed after a
             beat (a beat, not a frame: cleared per frame it would hammer a
             dead network sixty times a second). An empty plinth also says
             so, because a booth that failed silently and a booth still
             loading look identical from the outside. */
          console.error('character booth: model failed to load', err);
          if (seq !== buildSeq) return;
          setTimeout(() => {
            if (seq === buildSeq) requestedKey = null;
          }, 2000);
          if (!rig) setLoadFailed(true);
        });
    };

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
      const dt = Math.min(clock.getDelta(), 0.05);

      /* One build in flight per *distinct* duelist, however fast the knobs
         are worked. Keyed on what actually changes the rig rather than on
         object identity: a stature drag makes a new object per input event,
         and rebuilding a full clone per event stuttered the very drag it was
         following. Stature is quantised in the key — a rebuild a millimetre
         apart is a clone nobody can see. */
      const key = `${specRef.current.model}|${specRef.current.tints.join(',')}|${Math.round(
        specRef.current.stature * 24
      )}`;
      if (key !== requestedKey) {
        requestedKey = key;
        rebuild(specRef.current);
      }

      if (performance.now() > idleUntil && pointers.size === 0) yaw += 0.0035;

      /**
       * A new framing starts at its own distance and on its own level.
       *
       * Both of these persisted across a framing change, and both quietly broke
       * the promise the two buttons make. `zoom` multiplies whatever the framing
       * asks for, so after a pinch outwards "Face" put the camera at 0.8 m
       * times the zoom the player happened to be left at — a distant torso. And
       * a drag downwards leaves the camera 29° up, from where "Face" frames the
       * top of the head. Neither is a state a player can name or undo; the
       * buttons are presets, so they reset what a preset owns and leave yaw,
       * which is the player turning the model, alone.
       */
      if (shotRef.current !== lastShot) {
        lastShot = shotRef.current;
        zoom = 1;
        pitchGoal = 0;
      }
      const target = SHOTS[shotRef.current];
      const goalY = shotRef.current === 'face' ? faceY : target.y;
      camY += (goalY - camY) * 0.12;
      camDist += (target.dist * zoom - camDist) * 0.12;
      pitch += (pitchGoal - pitch) * 0.12;

      pivot.rotation.y = yaw;
      camera.position.set(
        0,
        camY + Math.sin(pitch + target.pitch) * camDist,
        Math.cos(pitch + target.pitch) * camDist
      );
      camera.lookAt(0, camY, 0);

      rig?.update(dt, 0, 0);
      renderer.render(scene, camera);
    };
    frame();

    return () => {
      cancelAnimationFrame(raf);
      /* Anything still being built belongs to nobody now. */
      buildSeq++;
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
      /* `named` is the record the viewport has been rendering, with the chosen
         name attached — geometry-identical to the preview by construction. */
      const problem = await onConfirm(named);
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
        <div ref={holder} data-ready={modelReady ? 'yes' : undefined} className="absolute inset-0" />
        {loadFailed && !modelReady && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <p className="rounded border border-oxblood bg-[#2a1216]/80 px-3 py-1.5 text-[11px] text-[#f0c9cc]">
              The duelist could not be loaded — check your connection. Retrying…
            </p>
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3">
          <div>
            <h1 className="font-display text-lg leading-none text-brassbright">Make your duelist</h1>
            <p className="mt-1 text-[10px] uppercase tracking-widest text-ptextdim">Drag to turn · pinch to zoom</p>
          </div>
          {/* The Body / Face framing toggle used to live here and is gone.
              It existed to inspect a face the booth could edit; these models
              come with faces nobody can change, so a close-up was a button
              that answered a question the player is not being asked. Turning
              and pinching still reach everything it framed. */}
        </div>
      </div>

      {/* ---- controls ---- */}
      <div className="flex min-h-0 flex-1 flex-col border-t border-stoneline lg:w-[420px] lg:flex-none lg:border-l lg:border-t-0">
        <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-2">
          <Field label="Name">
            <input
              value={name}
              maxLength={MAX_PREMADE_NAME}
              onChange={(e) => setName(e.target.value)}
              placeholder={username}
              className="w-full rounded border border-stoneline bg-black/30 px-3 py-2 text-sm text-parchment outline-none focus:border-brassdim"
            />
          </Field>

          <PickRow
            label="Duelist"
            options={BOOTH_MODELS.map((m) => ({ key: m.id, label: m.label, note: m.note }))}
            value={pick.model}
            onPick={(k) => choose({ ...pick, model: modelById(k).id }, 'full')}
          />

          {/* Three rows of tint swatches, a stature slider, Surprise me and
              Reset all used to be here. See the note at the top of this file
              for why they are not: the roster they were built for was nine
              generic bodies, and these eight are finished characters whose
              textures cannot be recoloured without taking the skin with the
              clothes. What is left is the whole question. */}
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
              /* Also gated on the first model having landed: binding is
                 permanent, and nobody may approve a duelist the plinth has
                 never actually shown. */
              disabled={busy || !modelReady}
              onClick={() => {
                sfx.click();
                setAsking(true);
              }}
            >
              {busy ? 'Binding…' : modelReady ? 'This is my duelist' : 'Summoning…'}
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
              back with it on any device. Their appearance cannot be changed afterwards — the only way back is Delete
              Character in the story menu, which erases them and starts the story over.
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

/**
 * One row of the picker: a label and a handful of finished options.
 *
 * `data-pick` names each button `group:key` (the group is the slugged label)
 * because the driving scripts need a selector that survives a wording change
 * to the visible text.
 */
function PickRow({
  label,
  options,
  value,
  onPick,
}: {
  label: string;
  options: { key: string; label: string; note?: string }[];
  value: string;
  onPick: (key: string) => void;
}) {
  const slug = label.toLowerCase().replace(/\s+/g, '-');
  const note = options.find((o) => o.key === value)?.note;
  return (
    <div className="mt-3">
      <p className="mb-1 font-display text-[10px] uppercase tracking-widest text-ptextdim">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.key}
            data-pick={`${slug}:${o.key}`}
            aria-pressed={value === o.key}
            onClick={() => onPick(o.key)}
            className={`btn rounded px-2.5 py-1.5 text-[10px] ${value === o.key ? 'btn-primary' : ''}`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {note && <p className="mt-1 text-[9px] leading-relaxed text-ptextdim/80">{note}</p>}
    </div>
  );
}
