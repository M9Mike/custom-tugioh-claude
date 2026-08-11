'use client';

/**
 * The open world, such as it is so far: a grass field, a sky, and your duelist
 * standing in it.
 *
 * Nothing is placed in it yet on purpose — what goes here is not decided, and a
 * field with a walkable character, a following camera and a save is the piece
 * that everything else will be attached to. So this file is written as the
 * *harness*: ground, weather, input, camera, persistence. Adding a thing to the
 * world should be adding a thing, not rewriting this.
 *
 * Everything is generated at runtime — the grass texture is drawn into a canvas
 * on load and the field is one instanced mesh — so the whole world downloads as
 * code and costs no assets at all.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { StoryProfile } from '@/story/profile';
import { buildPremadeRig, type PremadeRig } from './premadeRig';
import { canDraw3d } from './webgl';
import { sfx } from '@/lib/sfx';

/** Matches the clamp in `/api/story/save`; the field ends here. */
export const WORLD_RADIUS = 120;

/**
 * 2.35 m/s, down from 2.9 — because 2.9 is not a walking speed. It is 10.4
 * km/h, which a human can only do by jogging, and the old goose-step stride
 * was the shape that contradiction took: no honest walk cycle can cover that
 * much ground. 2.35 is the top of the genuinely brisk range, quick enough for
 * traversal at 2.5 steps a second without the legs having to lie.
 */
const WALK_SPEED = 2.35;

interface Props {
  profile: StoryProfile;
  onEditDeck: () => void;
  /** Returns an error to show, or null when the save landed. */
  onSave: (world: { x: number; z: number; facing: number }) => Promise<string | null>;
  /**
   * Erases the whole save. Returns an error to show, or null — in which case
   * the caller swaps this screen out, the same contract as the booth's bind.
   */
  onDelete: () => Promise<string | null>;
  onExit: () => void;
}

export default function OpenWorld({ profile, onEditDeck, onSave, onDelete, onExit }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [askingDelete, setAskingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  /* Asked before the field is built; see `canDraw3d`. */
  const [webglFailed, setWebglFailed] = useState(() => !canDraw3d());

  const holder = useRef<HTMLDivElement>(null);
  const stick = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);

  /** Live input and live position, read by the render loop and by Save. */
  const move = useRef({ x: 0, y: 0 });
  const here = useRef({ x: profile.world.x, z: profile.world.z, facing: profile.world.facing });

  /**
   * The duelist this world was built for, frozen on the first render.
   *
   * Not `profile.character`, which is a *different object* after every save:
   * the parent replaces the whole profile with the server's response, and that
   * response is parsed JSON, so the character has a new identity even though
   * every field in it is the same. With the effect below keyed on that, pressing
   * Save tore down the renderer and rebuilt the sky, the ground texture and all
   * sixteen thousand tufts of grass — a visible stall on a phone, in exchange
   * for nothing, and it reset the camera angle while it was at it.
   *
   * State with a lazy initialiser rather than a ref, because this *is* read
   * while rendering and a ref read during render is a different bug waiting to
   * happen. It is never set again: appearance is immutable once bound, which is
   * the whole promise of the creation booth. If that ever stops being true,
   * this is the line that has to change with it.
   */
  const [character] = useState(profile.character);

  useEffect(() => {
    const el = holder.current;
    if (!el || !character) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch (err) {
      /* The probe said yes and the real thing said no. Reported out of band
         because this is news from an external system, not a render decision. */
      console.error('open world: no WebGL context', err);
      queueMicrotask(() => setWebglFailed(true));
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    el.appendChild(renderer.domElement);
    const canvas = renderer.domElement;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    canvas.style.touchAction = 'none';

    const scene = new THREE.Scene();
    const HORIZON = new THREE.Color('#bcd0dd');
    scene.fog = new THREE.Fog(HORIZON, 70, 210);

    const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 600);

    const trash: { dispose(): void }[] = [];
    const keep = <T extends { dispose(): void }>(x: T): T => {
      trash.push(x);
      return x;
    };

    /* ---- sky ----
       A sphere turned inside out with two colours and a gradient between them.
       Cheaper than a cube map, has no files behind it, and the horizon colour is
       shared with the fog so the ground dissolves into the sky rather than
       ending at a hard line. */
    const skyGeo = keep(new THREE.SphereGeometry(400, 24, 16));
    const skyMat = keep(
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uTop: { value: new THREE.Color('#4d7fb5') },
          uBottom: { value: HORIZON },
        },
        vertexShader: `
          varying vec3 vPos;
          void main() {
            vPos = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 uTop;
          uniform vec3 uBottom;
          varying vec3 vPos;
          void main() {
            float h = clamp(normalize(vPos).y * 1.6 + 0.12, 0.0, 1.0);
            gl_FragColor = vec4(mix(uBottom, uTop, pow(h, 0.75)), 1.0);
          }
        `,
      })
    );
    const sky = new THREE.Mesh(skyGeo, skyMat);
    scene.add(sky);

    /* ---- light ---- */
    /* Daylight, but not as much of it as an open field suggests. The duelist's
       cloth and skin carry a sheen lobe that saturates towards white under a
       strong key, so the sun here is dialled to where a dark coat is still a
       dark coat — see the note on lighting in the creation booth. */
    const sun = new THREE.DirectionalLight('#fff2d8', 2.05);
    sun.position.set(30, 48, 22);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 90;
    /* A tight shadow frustum that travels with the player. Covering the whole
       field at this resolution would put one texel every 23cm and the duelist
       would stand in a blur; ten metres around them is four times sharper than
       anything they can see anyway. */
    sun.shadow.camera.left = -6;
    sun.shadow.camera.right = 6;
    sun.shadow.camera.top = 6;
    sun.shadow.camera.bottom = -6;
    sun.shadow.bias = -0.0018;
    scene.add(sun);
    scene.add(sun.target);
    /* 0.95, up from 0.72: the vendored duelists are matte standard materials,
       not the old sheen-lobed cloth, and at 0.72 the side of the body away
       from the sun read as a silhouette against the bright grass. The grass
       takes the same raise and stays grass. */
    scene.add(new THREE.HemisphereLight('#cfe0f2', '#3f5227', 0.95));

    /* ---- ground ----
       The texture is painted into a canvas rather than downloaded: five thousand
       short strokes in a spread of greens, tiled small enough that a metre of
       ground is a metre of grass rather than a metre of pattern. At head height
       it reads as grass and it weighs nothing. */
    const painted = grassTexture(renderer.capabilities.getMaxAnisotropy());
    const groundTex = painted ? keep(painted) : null;
    const groundGeo = keep(new THREE.CircleGeometry(WORLD_RADIUS + 60, 64));
    const groundMat = keep(
      new THREE.MeshStandardMaterial({
        map: groundTex,
        color: groundTex ? '#ffffff' : '#4d6b32',
        roughness: 1,
        metalness: 0,
      })
    );
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    /* ---- grass ----
       One instanced mesh for the whole field, and the sway is a handful of lines
       injected into the standard vertex shader — so sixteen thousand tufts move
       in the wind for one draw call and no per-frame work on the CPU at all. */
    const wind = { value: 0 };
    const tuftGeo = keep(tuftGeometry());
    const tuftMat = keep(
      new THREE.MeshStandardMaterial({ color: '#78a344', roughness: 1, side: THREE.DoubleSide })
    );
    tuftMat.onBeforeCompile = (shader) => {
      shader.uniforms.uWind = wind;
      shader.vertexShader = `uniform float uWind;\n${shader.vertexShader}`.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         #ifdef USE_INSTANCING
           float phase = instanceMatrix[3][0] * 0.6 + instanceMatrix[3][2] * 0.45;
           float bend = sin(uWind * 1.7 + phase) * 0.16 + sin(uWind * 0.6 + phase * 0.3) * 0.07;
           float up = max(transformed.y, 0.0);
           transformed.x += bend * up;
           transformed.z += bend * 0.45 * up;
         #endif`
      );
    };
    const TUFTS = 16000;
    const tufts = new THREE.InstancedMesh(tuftGeo, tuftMat, TUFTS);
    tufts.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    const dummy = new THREE.Object3D();
    /* Deterministic scatter: the field looks the same every time you walk into
       it, which is the difference between a place and a screensaver. */
    let seed = 20260810;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    for (let i = 0; i < TUFTS; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * (WORLD_RADIUS + 10);
      dummy.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      dummy.rotation.y = rnd() * Math.PI;
      const s = 0.7 + rnd() * 0.9;
      dummy.scale.set(s, s * (0.8 + rnd() * 0.7), s);
      dummy.updateMatrix();
      tufts.setMatrixAt(i, dummy.matrix);
    }
    tufts.instanceMatrix.needsUpdate = true;
    tufts.frustumCulled = false;
    scene.add(tufts);

    /* ---- the duelist ----
       Fetched, not constructed: the model is a file. The field does not wait
       for it — ground, sky and grass are all runtime-made and appear at once —
       and the duelist steps onto it the moment the fetch lands, usually from
       cache. Until then there is a field with nobody in it, which is a truthful
       picture of the situation. */
    let rig: PremadeRig | null = null;
    let gone = false;
    buildPremadeRig(character)
      .then((fresh) => {
        if (gone) {
          fresh.dispose();
          return;
        }
        rig = fresh;
        scene.add(rig.root);
        rig.root.position.set(here.current.x, 0, here.current.z);
        rig.root.rotation.y = here.current.facing;
      })
      .catch((err) => {
        /* A world with no duelist in it is broken, but a crash here would take
           the menu — and Delete Character — down with it. Say so and stand. */
        console.error('open world: the duelist failed to load', err);
      });

    /* ---- camera control: drag anywhere on the world to look ---- */
    let camYaw = here.current.facing + Math.PI;
    let camPitch = 0.28;
    const pointers = new Map<number, { x: number; y: number }>();
    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    };
    const onMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      camYaw -= (e.clientX - prev.x) * 0.006;
      camPitch = Math.min(0.85, Math.max(-0.12, camPitch + (e.clientY - prev.y) * 0.004));
    };
    const onUp = (e: PointerEvent) => pointers.delete(e.pointerId);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    /* ---- keyboard ---- */
    const held = new Set<string>();
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (!['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) return;
      e.preventDefault();
      if (e.type === 'keydown') held.add(k);
      else held.delete(k);
    };
    /* A key held while the tab goes away never sends its keyup, and the duelist
       marches off across the field on their own until you press it and let go
       again. Losing focus means letting go of everything. */
    const releaseAll = () => held.clear();
    const onHidden = () => {
      if (document.hidden) releaseAll();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', onHidden);

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

    const clock = new THREE.Clock();
    let stride = 0;
    /* The direction of travel, held from the last frame there was input, so a
       stop keeps going the way it was going while the legs slow down. */
    let heading = here.current.facing;
    let raf = 0;
    const camPos = new THREE.Vector3();
    const lookAt = new THREE.Vector3();

    const frame = () => {
      raf = requestAnimationFrame(frame);
      /* Clamped: a backgrounded tab hands back a delta of many seconds, and an
         unclamped one teleports the duelist across the field on return. */
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.getElapsedTime();
      wind.value = t;

      let ix = move.current.x;
      let iy = move.current.y;
      if (held.has('w') || held.has('arrowup')) iy -= 1;
      if (held.has('s') || held.has('arrowdown')) iy += 1;
      if (held.has('a') || held.has('arrowleft')) ix -= 1;
      if (held.has('d') || held.has('arrowright')) ix += 1;
      const mag = Math.min(1, Math.hypot(ix, iy));

      if (mag > 0.06) {
        /**
         * Input is read in the camera's frame, not the world's: pushing up on
         * the stick means "away from me", which is the only thing that stays
         * true while the camera is being swung around with the other thumb.
         *
         * The sign matters and was wrong once. `camYaw` points from the duelist
         * *towards* the camera — that is how the camera's own position is
         * computed below — so walking away from the viewer is `camYaw + π`, and
         * `atan2(ix, iy)` (rather than `-iy`) is that half-turn folded into the
         * stick's own angle. With `-iy` the duelist walked towards the camera
         * and turned round to do it, so pushing forward marched them into your
         * face.
         */
        heading = Math.atan2(ix, iy) + camYaw;
        stride += (mag - stride) * Math.min(1, dt * 8);

        /* Turn towards the heading over the shortest arc, so crossing ±π does
           not spin the duelist the long way round. */
        let d = heading - here.current.facing;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        here.current.facing += d * Math.min(1, dt * 11);
      } else {
        stride += (0 - stride) * Math.min(1, dt * 8);
      }

      const p = here.current;

      /**
       * Moved by `stride`, not by the stick.
       *
       * The stick is what you are asking for; `stride` is the speed the legs
       * are actually walking at, and it eases to the ask over about four
       * hundred milliseconds. Translating on the raw input meant the ground
       * moved at one speed while the legs stepped at another through every
       * start — and worse on release, where the input drops to nothing in a
       * single frame and the duelist stopped dead while its legs kept walking
       * on the spot for the rest of the ramp. The heading is held from the last
       * frame there was one, so the last steps of a stop carry on in the
       * direction they were already going, which is what a person does.
       */
      if (stride > 0.002) {
        p.x += Math.sin(heading) * WALK_SPEED * stride * dt;
        p.z += Math.cos(heading) * WALK_SPEED * stride * dt;
        const r = Math.hypot(p.x, p.z);
        if (r > WORLD_RADIUS) {
          p.x = (p.x / r) * WORLD_RADIUS;
          p.z = (p.z / r) * WORLD_RADIUS;
        }
      }

      if (rig) {
        rig.root.position.set(p.x, 0, p.z);
        rig.root.rotation.y = p.facing;
        /* The clips advance by `dt` and play at ground speed over clip speed —
           the same one-speed arithmetic that kept the old gait's feet from
           sliding, now living in `premadeRig.ts`. */
        rig.update(dt, stride, WALK_SPEED * stride);
      }

      /* Shadow box rides along with the duelist. */
      sun.position.set(p.x + 30, 48, p.z + 22);
      sun.target.position.set(p.x, 0, p.z);
      sun.target.updateMatrixWorld();

      const dist = 4.6;
      camPos.set(
        p.x + Math.sin(camYaw) * Math.cos(camPitch) * dist,
        1.55 + Math.sin(camPitch) * dist,
        p.z + Math.cos(camYaw) * Math.cos(camPitch) * dist
      );
      /* Never below the grass, however far the camera is pushed down. */
      camera.position.set(camPos.x, Math.max(0.45, camPos.y), camPos.z);
      lookAt.set(p.x, 1.15, p.z);
      camera.lookAt(lookAt);
      sky.position.set(camera.position.x, 0, camera.position.z);

      renderer.render(scene, camera);
    };
    frame();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', releaseAll);
      document.removeEventListener('visibilitychange', onHidden);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      gone = true;
      rig?.dispose();
      tufts.dispose();
      for (const x of trash) x.dispose();
      /* `dispose()` frees three's own objects but leaves the WebGL context
         itself alive until the GC gets round to it. A browser allows only a
         handful at once, and walking booth → deck → world → booth opens one
         each time, so on a phone they run out. Asking for the loss hands it
         back at unmount. */
      renderer.forceContextLoss();
      renderer.dispose();
      canvas.remove();
    };
    /* Built once. The starting position is read through a ref precisely so that
       a re-render — opening the menu, showing a toast — never tears the world
       down and drops the player back at spawn. */
  }, [character]);

  /* ---------------- the thumb stick ---------------- */

  useEffect(() => {
    const base = stick.current;
    const dot = knob.current;
    if (!base || !dot) return;
    let active: number | null = null;
    const radius = 46;

    const apply = (e: PointerEvent) => {
      const r = base.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy);
      const k = d > radius ? radius / d : 1;
      dot.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      move.current.x = (dx * k) / radius;
      move.current.y = (dy * k) / radius;
    };
    const down = (e: PointerEvent) => {
      if (active !== null) return;
      active = e.pointerId;
      base.setPointerCapture(e.pointerId);
      apply(e);
    };
    const moveHandler = (e: PointerEvent) => {
      if (active !== e.pointerId) return;
      apply(e);
    };
    const up = (e: PointerEvent) => {
      if (active !== e.pointerId) return;
      active = null;
      dot.style.transform = 'translate(0px, 0px)';
      move.current.x = 0;
      move.current.y = 0;
    };
    base.addEventListener('pointerdown', down);
    base.addEventListener('pointermove', moveHandler);
    base.addEventListener('pointerup', up);
    base.addEventListener('pointercancel', up);
    return () => {
      base.removeEventListener('pointerdown', down);
      base.removeEventListener('pointermove', moveHandler);
      base.removeEventListener('pointerup', up);
      base.removeEventListener('pointercancel', up);
    };
  }, []);

  /* One timer for the toast, cleared before it is replaced and cancelled on the
     way out. Two saves in quick succession used to schedule two, and the first
     one wiped the second one's message halfway through reading it. */
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* Also the guard for a save that is still in flight when the player leaves.
     Clearing the timer on unmount is not enough on its own: the one this save
     is about to schedule does not exist yet, so without knowing we are gone it
     would be armed *after* the cleanup and left to fire into nothing. */
  const alive = useRef(true);
  useEffect(() => {
    /* Re-armed on mount, not just cleared on unmount. An effect that only ever
       sets this false latches: once anything remounts the world — Strict Mode
       in development does it on the first render, and leaving for the deck
       builder and coming back does it in earnest — every later save runs to
       completion on the server and then reports nothing, because the button is
       still waiting for a component it has been told is gone. It reads as a
       Save that hangs on "Saving…" forever. */
    alive.current = true;
    return () => {
      alive.current = false;
      if (noteTimer.current) clearTimeout(noteTimer.current);
    };
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    setNote(null);
    sfx.click();
    let problem: string | null;
    try {
      problem = await onSave({ ...here.current });
    } catch (err) {
      /* `onSave` is contracted to *resolve* a problem, so a rejection is a
         broken caller. It still has to be caught: the clear is in `finally`
         because a throw past it would leave Save disabled and reading
         "Saving…" for the rest of the session. */
      console.error('open world: onSave rejected', err);
      problem = 'Could not save. Try again in a moment.';
    } finally {
      if (alive.current) setSaving(false);
    }
    /* The save itself has landed either way — only the reporting of it is
       skipped, because there is nobody left to report to. */
    if (!alive.current) return;
    setNote(problem ?? 'Saved.');
    if (!problem) sfx.heal();
    else sfx.error();
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(null), 2600);
  }, [onSave]);

  /* A ref, not `deleting`: state does not update until the next render, so a
     fast double-tap can fire twice through a button reading `disabled=`. The
     booth's bind has the same guard for the same reason — the two decisions
     that cannot be taken back are the two that must fire exactly once. */
  const erasing = useRef(false);

  const eraseSave = async () => {
    if (erasing.current) return;
    erasing.current = true;
    setDeleting(true);
    let problem: string | null;
    try {
      problem = await onDelete();
    } catch (err) {
      /* `onDelete` is contracted to *resolve* a problem; a rejection is a
         broken caller. Caught here because nothing else would re-enable the
         sheet, and an erase stuck on "Deleting…" for ever is this screen's
         version of the booth's stuck bind. */
      console.error('open world: onDelete rejected', err);
      problem = 'Could not delete. Try again in a moment.';
    }
    /* No success branch, deliberately: the caller has already unmounted this
       screen, and touching state on the way down would only flash the sheet. */
    if (!problem || !alive.current) return;
    setNote(problem);
    sfx.error();
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(null), 2600);
    setDeleting(false);
    setAskingDelete(false);
    erasing.current = false;
  };

  if (!character) return null;

  if (webglFailed) {
    return (
      <main className="safe-page mx-auto flex min-h-[100dvh] w-full max-w-lg flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="font-display text-2xl text-brassbright">This device cannot draw the world</h1>
        <p className="text-xs leading-relaxed text-ptext/85">
          The open world needs WebGL, and this browser would not give us a 3D context. Your duelist and deck are
          safe — try Safari or Chrome with hardware acceleration switched on.
        </p>
        <button className="btn rounded px-4 py-2 text-xs" onClick={onExit}>
          Back to the main menu
        </button>
      </main>
    );
  }

  return (
    <main className="relative h-[100svh] w-full overflow-hidden">
      <div ref={holder} className="absolute inset-0" />

      {/* corner menu */}
      {/* `items-end` is load-bearing. The box is only as wide as its widest
          child, so opening the panel widened it to 14rem and left the button —
          now a narrow ✕ rather than ☰ Menu — sitting against the box's left
          edge, a third of the way across the screen. The button you press to
          close a menu cannot walk out of the corner you pressed to open it. */}
      <div
        className="absolute right-0 top-0 flex flex-col items-end p-3"
        style={{ paddingTop: 'calc(var(--safe-top) + 12px)', paddingRight: 'calc(var(--safe-right) + 12px)' }}
      >
        <button
          className="btn rounded px-3 py-2 text-[11px]"
          onClick={() => {
            sfx.click();
            setMenuOpen((o) => !o);
          }}
          aria-expanded={menuOpen}
          aria-label="Menu"
        >
          {menuOpen ? '✕' : '☰ Menu'}
        </button>

        {menuOpen && (
          <div className="panel grain mt-2 w-56 rounded p-3">
            <p className="truncate font-display text-base leading-tight text-parchment">{character.name}</p>
            <p className="mt-0.5 text-[10px] uppercase tracking-widest text-brass">Level {profile.level}</p>
            <div className="brass-rule my-2.5" />
            <button
              className="btn mb-1.5 w-full rounded px-3 py-2 text-[11px]"
              onClick={() => {
                sfx.click();
                onEditDeck();
              }}
            >
              Edit Deck
            </button>
            <button className="btn mb-1.5 w-full rounded px-3 py-2 text-[11px]" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              className="btn w-full rounded px-3 py-2 text-[11px]"
              onClick={() => {
                sfx.click();
                onExit();
              }}
            >
              Return to the Main Menu
            </button>
            <div className="brass-rule my-2.5" />
            <button
              className="btn btn-danger w-full rounded px-3 py-2 text-[11px]"
              onClick={() => {
                sfx.click();
                setMenuOpen(false);
                setAskingDelete(true);
              }}
            >
              Delete Character
            </button>
          </div>
        )}
      </div>

      {askingDelete && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/85 p-5">
          <div className="panel grain w-full max-w-sm rounded p-5">
            <h2 className="font-display text-lg text-brassbright">Delete {character.name}?</h2>
            <div className="brass-rule my-3" />
            <p className="text-xs leading-relaxed text-ptext/85">
              This erases the whole save for <span className="text-parchment">{profile.username}</span> — duelist,
              deck, collection and progress — and starts the story over from the beginning. There is no way to bring
              them back.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                className="btn flex-1 rounded px-4 py-2 text-xs"
                onClick={() => {
                  sfx.click();
                  setAskingDelete(false);
                }}
                disabled={deleting}
              >
                Keep playing
              </button>
              <button className="btn btn-danger flex-1 rounded px-4 py-2 text-xs" onClick={eraseSave} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete for ever'}
              </button>
            </div>
          </div>
        </div>
      )}

      {note && (
        <div className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2">
          <p className="rounded border border-brassdim bg-black/75 px-3 py-1.5 text-[11px] text-parchment">{note}</p>
        </div>
      )}

      {/* thumb stick */}
      <div
        ref={stick}
        className="absolute bottom-0 left-0 m-4 grid h-[124px] w-[124px] touch-none place-items-center rounded-full border border-stoneline bg-black/25 backdrop-blur-[2px]"
        style={{ marginBottom: 'calc(var(--safe-bottom) + 16px)', marginLeft: 'calc(var(--safe-left) + 16px)' }}
        aria-label="Move"
      >
        <div
          ref={knob}
          className="pointer-events-none h-[52px] w-[52px] rounded-full border border-brassdim bg-[#1c222b]/85"
        />
      </div>

      <p
        className="pointer-events-none absolute bottom-0 right-0 m-4 text-right text-[9px] leading-relaxed text-white/45"
        style={{ marginBottom: 'calc(var(--safe-bottom) + 16px)', marginRight: 'calc(var(--safe-right) + 16px)' }}
      >
        Drag to look · stick to walk
        <br />
        WASD on a keyboard
      </p>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Generated assets                                                    */
/* ------------------------------------------------------------------ */

/**
 * Grass, painted into a canvas: a few thousand short strokes in six greens.
 *
 * Returns null if the browser will not give up a 2D context — which happens on
 * a device that has run out of them, and which used to take the whole world
 * down with a TypeError on the `!`. The caller falls back to a flat green,
 * because a plain field is a field and a crash is a black screen.
 */
function grassTexture(anisotropy: number): THREE.CanvasTexture | null {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#415c2a';
  ctx.fillRect(0, 0, size, size);
  let seed = 7717;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let i = 0; i < 5200; i++) {
    const shade = 0.62 + rnd() * 0.75;
    ctx.fillStyle = `rgb(${Math.round(78 * shade)},${Math.round(112 * shade)},${Math.round(50 * shade)})`;
    ctx.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 2, 2 + rnd() * 5);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(210, 210);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, anisotropy);
  return tex;
}

/** A clump of five blades, leaning different ways. One instance of this is one tuft. */
function tuftGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const blades = 5;
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI + 0.4;
    const w = 0.026;
    const h = 0.2 + (i % 3) * 0.09;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const lean = 0.07;
    pos.push(-dz * w, 0, dx * w, dz * w, 0, -dx * w, dx * lean, h, dz * lean);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
