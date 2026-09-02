'use client';

/**
 * The open world: the areas of Domino City, your duelist, and everything that
 * moves them.
 *
 * This file is the *harness* — input, camera, collision, doors, persistence —
 * and deliberately not a place. What each area looks like is `world/`, which
 * this calls into by id; adding an area should be adding an area, not rewriting
 * this.
 *
 * It began as one grass field with a radius, and the comments in here said so
 * for a while after it stopped being true. It is rooms and streets now, built
 * one at a time from `story/areas.ts` and thrown away on the way out.
 *
 * Everything is still generated at runtime — every texture is drawn into a
 * canvas on load — so the whole world downloads as code and costs no assets at
 * all. The only files are the characters.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { StoryProfile } from '@/story/profile';
import { WORLD_NPCS, type WorldNpc } from '@/story/npcs';
import {
  areaById,
  doorAt,
  arrivalThrough,
  landing,
  settle,
  PLAYER_RADIUS,
  type AreaId,
  type Door,
  groundAt,
  standingOn,
  cameraReach,
} from '@/story/areas';
import type { BuiltArea } from './world/kit';
import { skyAt, hourFrom } from '@/story/sky';
import { buildShop } from './world/shop';
import { buildStreet } from './world/street';
import { buildMarket } from './world/market';
import { buildStepLane } from './world/steplane';
import { buildShrine } from './world/shrine';
import { buildBlackCrown } from './world/blackcrown';
import { buildCrownShop } from './world/crownshop';
import { buildCemetery } from './world/cemetery';
import { buildPremadeRig, type PremadeRig } from './premadeRig';
import Conversation from './Conversation';
import { canDraw3d } from './webgl';
import { sfx } from '@/lib/sfx';

/** Matches the clamp in `/api/story/save`; the field ends here. */
export const WORLD_RADIUS = 120;

/**
 * Top speed, in metres a second — what a full stick gets you.
 *
 * 3.3, and it is a **run**, which is what the rig was already animating: the
 * legs cross-fade from the Walk clip to the Run clip as the stick passes 0.6,
 * and the Run clips on this roster cover 3.2–3.5 m of ground a second at
 * playback rate 1. Holding the top speed at 2.35 meant that clip played at
 * 0.7× — a running animation in slow motion, and the reason moving around
 * felt sluggish even though nothing was wrong with the walk.
 *
 * Matching the number to the clip fixes both ends at once: full stick now
 * covers ground at the pace the run was drawn for, and the feet stay honest
 * because the playback rate lands on 1 rather than being dragged below it.
 * Half a stick is still a walk at 1.65, which is a brisk one and plays its own
 * clip at about 1.1×.
 *
 * It is one number rather than each model's own `runSpeed` because the field
 * has to feel the same whoever you picked; the 0.06 spread across the roster
 * is well inside what a cross-fade hides.
 */
const TOP_SPEED = 3.3;

/**
 * How close you may get to somebody standing in the field, in metres.
 *
 * Two shoulders and a bit of manners. Comfortably inside every NPC's talk
 * range, so bumping into a person is always also close enough to speak to
 * them — the stop and the prompt happen together rather than the stop
 * happening first and leaving you pressed against a stranger in silence.
 */
const NPC_RADIUS = 1.1;

interface Props {
  profile: StoryProfile;
  onEditDeck: () => void;
  /** Returns an error to show, or null when the save landed. */
  onSave: (world: { area: AreaId; x: number; z: number; facing: number }) => Promise<string | null>;
  /**
   * Erases the whole save. Returns an error to show, or null — in which case
   * the caller swaps this screen out, the same contract as the booth's bind.
   */
  onDelete: () => Promise<string | null>;
  onExit: () => void;
  /**
   * A character has been taken up on a duel. The caller opens the room and
   * navigates; this screen is about to be unmounted either way.
   */
  onDuel?: (npc: WorldNpc) => void;
  /** A character has been asked what they have for sale. */
  onShop?: (npc: WorldNpc) => void;
  /**
   * Somebody to walk straight back into a conversation with, and where to pick
   * it up — set when returning from a duel they sent the player to.
   */
  resume?: { npcId: string; node: string } | null;
}

export default function OpenWorld({ profile, onEditDeck, onSave, onDelete, onExit, onDuel, onShop, resume }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  /*
   * Whether there is a keyboard to mention.
   *
   * "WASD on a keyboard" under the thumb stick of a phone is a line about a
   * thing the player does not have, and a real game does not tell you about
   * controls you cannot use. A fine pointer that can hover is a mouse, and a
   * mouse comes with a keyboard; a touch screen comes with neither. Read once,
   * on mount: nobody plugs a keyboard into a phone mid-duel.
   */
  const [hasKeyboard] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches
  );
  const [saving, setSaving] = useState(false);
  /**
   * How far through deleting the player is: nothing, warned, or asked twice.
   *
   * Two steps rather than one because the two questions are different. The first
   * says what is about to be destroyed; the second makes you say the word after
   * you have read it. One dialogue is a thing you can dismiss by tapping where
   * the button happens to be, and this is the only action in the game that
   * cannot be undone.
   */
  const [askingDelete, setAskingDelete] = useState<null | 'warn' | 'sure'>(null);
  const [deleting, setDeleting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  /* Asked before the field is built; see `canDraw3d`. */
  const [webglFailed, setWebglFailed] = useState(() => !canDraw3d());

  /**
   * Who is close enough to talk to, and who is being talked to.
   *
   * Two pieces of state, not one: the prompt appears on approach and the
   * conversation opens on a tap, and conflating them would mean walking near
   * somebody started a conversation at them.
   */
  const [nearNpc, setNearNpc] = useState<WorldNpc | null>(null);
  const [talkingTo, setTalkingTo] = useState<WorldNpc | null>(
    () => (resume ? WORLD_NPCS.find((n) => n.id === resume.npcId) ?? null : null)
  );
  /* Cleared the moment the conversation closes, so re-opening it later starts
     from the top rather than replaying the aftermath of a duel. */
  const [resumeAt, setResumeAt] = useState<string | null>(resume?.node ?? null);
  /* What the loop last reported, so it only calls setState when it changes. */
  const nearRef = useRef<WorldNpc | null>(null);
  /* Read by the render loop, which must not re-run when a conversation opens:
     rebuilding the field to show a panel would drop the player at spawn. */
  const talkingRef = useRef<WorldNpc | null>(null);
  useEffect(() => {
    talkingRef.current = talkingTo;
  }, [talkingTo]);


  const holder = useRef<HTMLDivElement>(null);
  const stick = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);

  /** Live input and live position, read by the render loop and by Save. */
  const move = useRef({ x: 0, y: 0 });
  /**
   * Where the duelist actually starts.
   *
   * Through `landing`, never straight off the profile: a save written before the
   * world had rooms holds coordinates from the old open field, and those put the
   * player outside the shop standing in the void.
   */
  const start = landing(profile.world);
  const here = useRef({ x: start.x, z: start.z, facing: start.facing });
  /**
   * Which area is on screen, held in a ref because the render loop owns it.
   *
   * Walking through a door must not re-run the effect that built the renderer —
   * that would drop the WebGL context and rebuild the world from scratch every
   * time somebody opened a shop door. The loop swaps the area's geometry in
   * place instead, and this is how it remembers which one is up.
   */
  const areaRef = useRef<AreaId>(start.area);
  /** The name of the place just entered, shown briefly and then faded out. */
  const [entered, setEntered] = useState<string | null>(null);
  /**
   * The black sheet a door transition plays behind.
   *
   * A plain div rather than anything in the scene, and driven by writing to its
   * style from the render loop rather than through React state — a fade is sixty
   * opacity values a second, and sixty re-renders a second to deliver them would
   * cost more than the world it is covering up.
   */
  const fade = useRef<HTMLDivElement>(null);

  /* The area card says its piece and goes. Cleared rather than left mounted so
     re-entering the same area re-triggers the animation. */
  useEffect(() => {
    if (!entered) return;
    const timer = window.setTimeout(() => setEntered(null), 2600);
    return () => window.clearTimeout(timer);
  }, [entered]);

  /**
   * The duelist this world was built for, frozen on the first render.
   *
   * Not `profile.character`, which is a *different object* after every save:
   * the parent replaces the whole profile with the server's response, and that
   * response is parsed JSON, so the character has a new identity even though
   * every field in it is the same. With the effect below keyed on that, pressing
   * Save tore down the renderer and rebuilt the sky, the ground texture and all
   * every mesh in the area — a visible stall on a phone, in exchange for
   * nothing, and it reset the camera angle while it was at it.
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
    /*
     * Black, and fogged to black.
     *
     * There is nothing outside an area — no sky sphere, no ground plane running
     * to a horizon. The fog is what makes that read as depth rather than as a
     * hole: geometry fades into the same black the background is, so the far end
     * of the street goes soft instead of ending at a hard edge with void behind
     * it. The near distance is set well past the width of the largest area so
     * nothing a player can walk up to is ever hazy.
     */
    const VOID = new THREE.Color('#000000');
    scene.background = VOID;
    scene.fog = new THREE.Fog(VOID, 34, 78);

    /*
     * What time it is.
     *
     * Derived from the wall clock rather than stored, so the hour is the same
     * in every area, survives a door, a reload and the world being rebuilt, and
     * costs nothing to save. See `story/sky.ts`.
     *
     * `?t=` pins it. That is not a debug flag left in by accident: a sweep that
     * compares two frames a millimetre apart cannot have the sun move between
     * them, and neither can a screenshot that is supposed to be comparable with
     * last week's. Every check in `scripts/` passes it.
     */
    let pinned: number | null = null;
    try {
      const raw = new URLSearchParams(window.location.search).get('t');
      if (raw !== null && raw !== '' && Number.isFinite(Number(raw))) pinned = Number(raw);
    } catch {
      /* no window.location worth reading — leave it running */
    }

    /*
     * Near and far are tight on purpose: it is the whole of the flicker fix.
     *
     * The depth buffer's precision is spent across the near/far ratio, not
     * across the distance — so a near of 0.1 with a far of 600 (which is what
     * the old open field needed) leaves almost none of it for the first twenty
     * metres, and every surface laid flat on another one starts fighting: road
     * markings strobing on the asphalt, the rug flickering on the floorboards,
     * shop signs tearing against the walls they hang on.
     *
     * The largest area is 44 m across with 11 m buildings on it and the fog is
     * gone by 78, so 140 is generous. Moving the near plane out to 0.2 costs
     * nothing — the camera is never closer than 0.9 to anything — and the two
     * together multiply the usable depth precision by a factor of about
     * twenty-five.
     */
    const camera = new THREE.PerspectiveCamera(52, 1, 0.2, 140);

    /* ---- the area ----
       Everything that is not a person: floor, walls, buildings, lamps, and the
       light they cast. Built by whichever area we are standing in, added as one
       group and thrown away as one group when we leave. The two builders own
       their own lighting because a shop and a street at dusk want completely
       different light, and passing one rig between them would mean tuning it
       for neither. */
    /*
     * Which builder draws which area.
     *
     * It used to be `kind === 'interior' ? shop : street`, which worked for
     * exactly as long as there was one of each. Market Row is an exterior and is
     * nothing like the street, and every area after it is its own place too — so
     * the mapping is by id, and a new area that forgets to add itself here is a
     * type error rather than a street with the wrong name on it.
     */
    const BUILDERS: Record<AreaId, (anisotropy: number) => BuiltArea> = {
      'grandpa-shop': buildShop,
      'starting-area': buildStreet,
      'market-row': buildMarket,
      'step-lane': buildStepLane,
      'domino-shrine': buildShrine,
      'black-crown': buildBlackCrown,
      'crown-shop': buildCrownShop,
      'old-cemetery': buildCemetery,
    };

    let built: BuiltArea | null = null;
    let area = areaById(areaRef.current);
    const anisotropy = renderer.capabilities.getMaxAnisotropy();

    const enter = (id: AreaId) => {
      if (built) {
        scene.remove(built.root);
        built.dispose();
        built = null;
      }
      area = areaById(id);
      areaRef.current = area.id;
      built = BUILDERS[area.id](anisotropy);
      scene.add(built.root);
      populate(area.id);
      setEntered(area.name);
    };


    /* ---- the duelist ----
       Fetched, not constructed: the model is a file. The area does not wait
       for it — every surface in it is runtime-made and appears at once — and
       the duelist steps into it the moment the fetch lands, usually from cache.
       Until then there is a room with nobody in it, which is a truthful picture
       of the situation. */
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

    /* ---- everybody else ----
       Same builder, same clips, same seam: an NPC is a duelist who is not
       being driven by a stick. Each is fetched independently and steps into
       the field when it lands, so one slow model never holds up the rest —
       and a model that never arrives costs its own character and nothing
       else. */
    let npcs: { npc: WorldNpc; rig: PremadeRig }[] = [];

    /**
     * Builds the people who live in one area, and only them.
     *
     * Re-run on every door, which means a rig is thrown away and re-fetched when
     * you walk back in. That is deliberate and it is nearly free: the model is
     * already in the browser cache and `loadDuelistTemplate` keeps the parsed
     * glTF for the life of the page, so re-entering costs a skeleton clone
     * rather than a download. Holding every area's cast in memory at once would
     * be the optimisation, and it would be the wrong one — this world is going
     * to have a lot more areas than it has people on screen.
     */
    const populate = (id: AreaId) => {
      for (const { rig: theirs } of npcs) {
        scene.remove(theirs.root);
        theirs.dispose();
      }
      npcs = [];
      const wanted = WORLD_NPCS.filter((n) => n.area === id);
      for (const npc of wanted) {
        buildPremadeRig(npc.character, {
          overrides: npc.overrides,
          accessories: npc.accessories,
          repaint: npc.repaint,
          build: npc.build,
        })
          .then((fresh) => {
            /* Two ways to be stale: the screen is gone, or the player has
               already walked out of the area this rig belongs to. */
            if (gone || areaRef.current !== id) {
              fresh.dispose();
              return;
            }
            fresh.root.position.set(npc.x, groundAt(areaById(npc.area), npc.x, npc.z), npc.z);
            fresh.root.rotation.y = npc.facing;
            scene.add(fresh.root);
            npcs.push({ npc, rig: fresh });
          })
          .catch((err) => {
            console.error(`open world: ${npc.id} failed to load`, err);
          });
      }
    };

    /* Now that both halves exist, open the area the save left us in. */
    enter(areaRef.current);

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
    /**
     * A door being walked through: black out, swap the world, come back.
     *
     * `t` runs 0 → 2. The first half fades to black, the area is swapped at the
     * exact moment nothing is visible, and the second half fades back in. Hiding
     * the swap is not only cosmetic — building a street is a few hundred meshes
     * and a couple of shadow maps, which is a visible hitch on a phone, and a
     * hitch that happens behind a black screen is a load rather than a stutter.
     */
    let crossing: { door: Door; t: number; swapped: boolean } | null = null;
    let stride = 0;
    /**
     * How high the ground is under the duelist right now.
     *
     * Eased rather than set, because the kerb is a 14 cm cliff: snapping to it
     * makes the whole scene jump, camera included, every time you step on or off
     * a pavement. Twelve per second covers the step in about a tenth of a second,
     * which reads as stepping up rather than as a glitch.
     */
    /*
     * The floor she arrives on. Indoors the one she walked in on; outdoors
     * whatever is under her feet — see `standingOn`.
     *
     * This asked for the ground floor everywhere, which is right in a building
     * with galleries and wrong on a podium: the shop's own doorstep is 1.62 m
     * up, so she arrived believing she was at zero, and once a step you cannot
     * climb became something you cannot walk into she was promptly shoved three
     * and a half metres off her own doorstep.
     */
    let groundY = standingOn(areaById(areaRef.current), here.current.x, here.current.z);
    /* The direction of travel, held from the last frame there was input, so a
       stop keeps going the way it was going while the legs slow down. */
    let heading = here.current.facing;
    /*
     * A hook for the checks: put the duelist somewhere, in this area, now.
     *
     * Every other way of moving her — the save route and a reload — throws the
     * page away, which is exactly what a long-session check must not do: the
     * question `npm run soak` asks is what the *same* page holds after a
     * hundred door crossings, and a reload answers a different one. Sets only
     * what a door crossing sets. Not a teleport anywhere: it stays in the area
     * she is in, and the collision, the floor and the camera all catch up on
     * the next frame exactly as they would after a door.
     */
    (window as unknown as { __teleport?: (x: number, z: number, facing: number) => void }).__teleport =
      (x, z, facing) => {
        here.current.x = x;
        here.current.z = z;
        here.current.facing = facing;
        heading = facing;
        camYaw = facing + Math.PI;
        groundY = standingOn(area, x, z);
      };
    /* 0 walking, 1 talking; eased, and read by the camera below. */
    let talkBlend = 0;
    let raf = 0;
    const camPos = new THREE.Vector3();
    /* Eased, so the fit never snaps. Starts at the walking distance. */
    let camDist = 4.6;
    /* 0 in the open, 1 when the camera is fully squeezed against something. */
    let camLift = 0;
    const lookAt = new THREE.Vector3();

    const frame = () => {
      raf = requestAnimationFrame(frame);
      /* Clamped: a backgrounded tab hands back a delta of many seconds, and an
         unclamped one teleports the duelist across the field on return. */
      /*
       * A tenth of a second, not a twentieth.
       *
       * The clamp is there so that a frame nobody rendered — a backgrounded
       * tab, an area being built — does not advance the world half a room in
       * one step. But it also means that *below the clamp's frame rate the
       * whole game runs in slow motion*: at fifteen frames a second every frame
       * still only moves the world by a fiftieth, so a duelist walks at three
       * quarters of her speed and nothing in the code says so. That is what
       * Mike felt as "running indoors is slower than outdoors" — not the speed,
       * the clock, in the one area heavy enough to drop under twenty.
       *
       * Ten frames a second is a genuine stall and worth clipping. Twenty is a
       * busy room, and a busy room should not slow time down.
       */
      const dt = Math.min(clock.getDelta(), 0.05);

      /* The sky, before anything is drawn under it. */
      const hour = hourFrom(Date.now(), pinned);
      const sky = skyAt(hour);
      VOID.set(sky.voidColour);
      if (scene.fog instanceof THREE.Fog) {
        scene.fog.near = sky.fogNear;
        scene.fog.far = sky.fogFar;
      }
      renderer.toneMappingExposure = sky.exposure;
      built?.setTime?.(hour);

      /* A conversation holds you still. Not by disabling the controls — the
         stick is hidden and the keys are simply not read — so that letting go
         of the stick to tap a reply cannot leave a held direction behind to
         walk off with when the panel closes. */
      const talking = talkingRef.current !== null || crossing !== null;
      let ix = talking ? 0 : move.current.x;
      let iy = talking ? 0 : move.current.y;
      if (!talking) {
        if (held.has('w') || held.has('arrowup')) iy -= 1;
        if (held.has('s') || held.has('arrowdown')) iy += 1;
        if (held.has('a') || held.has('arrowleft')) ix -= 1;
        if (held.has('d') || held.has('arrowright')) ix += 1;
      }
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
      /* Where the frame started, so the speed handed to the rig below is the
         ground actually covered — which the world's edge can cut short. */
      const fromX = p.x;
      const fromZ = p.z;

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
        p.x += Math.sin(heading) * TOP_SPEED * stride * dt;
        p.z += Math.cos(heading) * TOP_SPEED * stride * dt;
        /*
         * Stopped by the room, not by a radius.
         *
         * `settle` pushes the duelist out of every solid the area declares and
         * then clamps to its bounds — walls, counters, buildings, benches. It is
         * run every frame rather than only on contact because the resolution is
         * order-dependent in a corner: pushed out of one wall into another, the
         * second pass is what puts you back in the room.
         */
        /* On their floor: a gallery's railing is not a thing you walk into
           from underneath it. See `settle`. */
        const fixed = settle(area, p.x, p.z, PLAYER_RADIUS, groundY);
        p.x = fixed.x;
        p.z = fixed.z;
        /**
         * People are solid.
         *
         * Without this you walk *through* whoever you came to talk to, which
         * looks exactly as bad as it sounds — the first photograph of the
         * welcome had the player standing inside Grandpa's chest with his
         * boots poking out the front. Pushing back out along the line between
         * them is the whole of it: no physics, no sweeping, just a radius
         * nobody may be inside of. It stops you at conversation distance by
         * itself, which is the distance you wanted anyway.
         */
        for (const { npc } of npcs) {
          const dx = p.x - npc.x;
          const dz = p.z - npc.z;
          const d = Math.hypot(dx, dz);
          if (d < NPC_RADIUS && d > 1e-4) {
            p.x = npc.x + (dx / d) * NPC_RADIUS;
            p.z = npc.z + (dz / d) * NPC_RADIUS;
          }
        }

        /*
         * Doors are walked through, not pressed.
         *
         * Checked after the position has settled, so the trigger is tested
         * against where the duelist actually ended up rather than where they
         * were heading — otherwise a doorway you were pushed out of still counts
         * as one you walked into. `crossing` holds the transition for the length
         * of the fade so it cannot fire twice on consecutive frames.
         */
        if (!crossing) {
          const door = doorAt(area, p.x, p.z, groundY);
          if (door) crossing = { door, t: 0, swapped: false };
        }
      }

      /* `groundY` is where the duelist already is, and that is what tells a
         building with storeys in it which floor they are on: without it,
         walking under a gallery puts them on top of it. See `groundAt`. */
      const wantY = groundAt(areaById(areaRef.current), p.x, p.z, groundY);
      groundY += (wantY - groundY) * Math.min(1, dt * 12);
      /*
       * And never below the floor, whatever the ease says.
       *
       * An exponential ease does not lag by a fixed amount, it lags by speed
       * over rate — so on a slope it settles at a constant error and stays
       * there for as long as you are climbing. Black Crown's shop steps rise
       * 1.62 m over 4 m of run; at a full stick that is 1.34 m a second of
       * climb, and at a rate of twelve the duelist walks the entire flight
       * eleven centimetres under the treads. Which is what Mike saw: going up
       * the stairs, her feet are in the stone.
       *
       * Descending is the same error the other way, and *that* one is fine —
       * floating a hand's breadth over a step you are dropping off reads as a
       * step down. Feet inside a stair does not read as anything. So the ease
       * keeps its smoothing on the way down and is clamped on the way up.
       */
      if (groundY < wantY - 0.02) groundY = wantY - 0.02;

      if (rig) {
        rig.root.position.set(p.x, groundY, p.z);
        rig.root.rotation.y = p.facing;
        /* The clips advance by `dt` and play at ground speed over clip speed —
           the same one-speed arithmetic that kept the old gait's feet from
           sliding, now living in `premadeRig.ts`. The speed is measured off
           the position the clamp actually allowed, and the stride handed over
           is capped to it, so a duelist pinned against the world's edge slows
           to a stand instead of marching on the spot. */
        const covered = dt > 0 ? Math.hypot(p.x - fromX, p.z - fromZ) / dt : 0;
        rig.update(dt, Math.min(stride, covered / TOP_SPEED), covered);
      }

      /**
       * Everybody else: standing, and looking at you when you are close.
       *
       * The turn is the whole of "this person has noticed me" and it costs a
       * lerp. Eased rather than snapped, over the shortest arc, and released
       * back to their own facing when you leave — a character who tracks you
       * across the field like a turret is worse than one who never moves.
       */
      let closest: WorldNpc | null = null;
      let closestD = Infinity;
      for (const { npc, rig: theirs } of npcs) {
        const dx = p.x - npc.x;
        const dz = p.z - npc.z;
        const d = Math.hypot(dx, dz);
        /* Notice a little before the talk range, so they are already looking
           at you by the time the prompt appears. */
        const want = d < npc.range * 1.6 ? Math.atan2(dx, dz) : npc.facing;
        let turn = want - theirs.root.rotation.y;
        turn = Math.atan2(Math.sin(turn), Math.cos(turn));
        theirs.root.rotation.y += turn * Math.min(1, dt * 3.2);
        theirs.update(dt, 0, 0);
        if (d < npc.range && d < closestD) {
          closest = npc;
          closestD = d;
        }
      }
      /* Only on a change: this runs sixty times a second, and setting state
         with the same value every frame is a re-render per frame. */
      if (closest?.id !== nearRef.current?.id) {
        nearRef.current = closest;
        setNearNpc(closest);
      }

      /* ---- walking through a door ---- */
      if (crossing) {
        crossing.t += dt / 0.3;
        if (crossing.t >= 1 && !crossing.swapped) {
          crossing.swapped = true;
          const { door } = crossing;
          /*
           * Asked before `enter`, which reassigns `area`.
           *
           * The landing belongs to the door on the *other* side — the one you
           * would come back through — so working it out needs to know which area
           * you are walking out of, and a moment later that is no longer this
           * one.
           */
          const to = arrivalThrough(door, area.id);
          enter(door.to);
          p.x = to.x;
          p.z = to.z;
          p.facing = to.facing;
          heading = to.facing;
          /* Put the camera behind the arrival heading, so you step out of a door
             looking where you are going rather than at the door you just used. */
          camYaw = to.facing + Math.PI;
          camPitch = 0.24;
          /*
           * And the floor she arrives on, which is not the floor she left.
           *
           * `groundY` carried across the threshold, so walking out of the shop
           * onto its own podium arrived believing she was at zero — and once a
           * step you cannot climb became a wall, being at zero on top of a
           * 1.62 m podium meant being pushed off it. The ease then took her
           * smoothly to the right height somewhere she had never stood.
           */
          groundY = standingOn(areaById(door.to), p.x, p.z);
          if (rig) {
            rig.root.position.set(p.x, groundY, p.z);
            rig.root.rotation.y = p.facing;
          }
        }
        const shade = crossing.t <= 1 ? crossing.t : 2 - crossing.t;
        if (fade.current) fade.current.style.opacity = String(Math.max(0, Math.min(1, shade)));
        if (crossing.t >= 2) {
          crossing = null;
          if (fade.current) fade.current.style.opacity = '0';
        }
      }

      /**
       * The conversation camera.
       *
       * The walking camera sits directly behind the duelist, which during a
       * conversation means staring at the back of your own head while somebody
       * talks to you from behind it. So the camera steps aside — but only just.
       *
       * **It has to be a shoulder shot, and the lens says so.** The first
       * version swung a little over a right angle off the line between the two
       * of you and looked at the midpoint, on the theory that side-on shows two
       * faces. On a phone it showed neither: the field of view is 52° vertical,
       * and at a portrait aspect that is **under 13° either side of centre**.
       * Two people three metres apart, viewed square-on from three, sit about
       * 28° out — so both of them left the frame and the scene played over an
       * empty field. Fitting them side-on needs the camera six-odd metres back,
       * which is not a conversation, it is a surveillance photograph.
       *
       * So: stay behind the duelist, swing a third of a radian to one side, and
       * look at *the person speaking*. They land in the middle of the frame,
       * your own shoulder holds the left edge, and the geometry works at
       * conversation distance instead of fighting it.
       *
       * Eased, not cut — `talkBlend` crosses over about half a second — and
       * it drives `camYaw` itself rather than overriding it, so when the
       * panel closes the camera stays where the conversation left it instead
       * of snapping back to a heading the player never chose.
       */
      const near = talkingRef.current;
      talkBlend += ((near ? 1 : 0) - talkBlend) * Math.min(1, dt * 4);
      let lookX = p.x;
      let lookZ = p.z;
      let lookY = groundY + 1.15;
      let dist = 4.6;
      if (talkBlend > 0.001 && near) {
        /* Behind the duelist (`+ π`) and a third of a radian to the side —
           enough to clear their head, little enough that the person they are
           talking to stays inside the lens. */
        const axis = Math.atan2(near.x - p.x, near.z - p.z);
        /*
         * A third of a radian was not enough once the cast had real heights.
         *
         * The offset only has to clear the duelist's shoulder when both parties
         * are the same size. Robert Barathion is 1.9 m and Grandpa is 1.6 m
         * standing behind a counter, so at 0.34 the player's back covered him
         * completely and the conversation played against a shoulder blade. 0.62
         * puts the player at the edge of frame where they belong and leaves the
         * middle for whoever is talking.
         */
        let d = axis + Math.PI + 0.62 - camYaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        camYaw += d * talkBlend * Math.min(1, dt * 3);
        /* Lifted a little: a short character behind a counter is below the
           walking camera's eyeline, and looking slightly down at them is both
           how you would actually stand and what keeps them in frame. */
        camPitch += (0.17 - camPitch) * talkBlend * Math.min(1, dt * 3);
        /* All the way to the speaker, not half way: they are the subject. */
        lookX = p.x + (near.x - p.x) * talkBlend;
        lookZ = p.z + (near.z - p.z) * talkBlend;
        /* Their head, and above the panel that covers the bottom third. Off the
           ground they are standing on, not off zero — see the camera below. */
        lookY = groundY + 1.15 + 0.05 * talkBlend;
        dist = 4.6 - 1.7 * talkBlend;
      }

      /**
       * The camera is pulled in until it is inside the room with you.
       *
       * A shop is eleven metres across and the walking camera sits four and a
       * half metres back, so for most of the interior the ideal camera position
       * is through a wall and out on the street. `cameraReach` marches the ray
       * from the duelist outwards and stops at the first thing tall enough to
       * matter, so the shot tightens as you back into a corner and opens out
       * again the moment you have room — which is what every third-person game
       * does and what nobody notices when it is done.
       *
       * Interiors start closer as well. The same distance that frames a street
       * puts a ceiling across the top third of a shop.
       */
      const want = area.kind === 'interior' ? dist * 0.72 : dist;
      const reach = cameraReach(
        area, p.x, p.z,
        Math.sin(camYaw) * Math.cos(camPitch),
        Math.cos(camYaw) * Math.cos(camPitch),
        want
      );
      /* Eased towards the allowed distance rather than snapped to it: a camera
         that steps in and out on a threshold reads as a bug. */
      camDist += (Math.min(want, reach) - camDist) * Math.min(1, dt * 6);

      /**
       * When it cannot get back, it goes up instead.
       *
       * A camera pinned against a wall a metre behind the duelist is looking at
       * the back of their head from inside their collar, which is unusable — you
       * cannot see the room and you cannot see where you are going. Every
       * third-person game answers this the same way: trade the distance you
       * cannot have for height you can, and look down over the shoulder.
       *
       * The lift is proportional to how much distance was lost, so it is nothing
       * at all in the open and at its strongest in a corner, and it is eased on
       * the same clock as the distance so the two move together.
       */
      const squeezed = Math.max(0, Math.min(1, 1 - camDist / Math.max(0.001, want)));
      camLift += (squeezed - camLift) * Math.min(1, dt * 6);
      const pitch = camPitch + camLift * 0.55;

      /*
       * The camera rides the ground the duelist is standing on.
       *
       * It used to sit at a flat `1.55 + …`, measured from zero, which is
       * correct in a world where the floor is at zero everywhere — and every
       * area so far has been. Step Lane climbs six metres, so the same
       * arithmetic leaves the camera down at street level looking up through the
       * hillside while the player walks away over the top of it.
       *
       * `groundY` is already the eased height under the duelist, so the shot
       * follows them up a flight of steps the way it follows them along a
       * pavement — which is to say invisibly. On flat ground this changes the
       * camera by the height of a kerb.
       */
      camPos.set(
        p.x + Math.sin(camYaw) * Math.cos(pitch) * camDist,
        groundY + 1.55 + Math.sin(pitch) * camDist + camLift * 1.15,
        p.z + Math.cos(camYaw) * Math.cos(pitch) * camDist
      );
      /*
       * Never through the floor *under the camera*, which on a slope is not the
       * floor under the player.
       *
       * Walking down a flight, the camera is behind and therefore over ground
       * higher than the duelist's — so a clamp measured at their feet would let
       * it sink into the steps it is looking over. This asks what is under the
       * camera itself and keeps a knee's height above it.
       */
      /* The camera is on the duelist's floor too — otherwise it clears the
         gallery over their head rather than the floor under their feet. */
      const underCamera = groundAt(area, camPos.x, camPos.z, groundY);
      const ceilingLimit = area.kind === 'interior' ? groundY + 3.05 : (area.ceiling ?? 40);
      camera.position.set(
        camPos.x,
        Math.max(underCamera + 0.45, Math.min(ceilingLimit, camPos.y)),
        camPos.z
      );
      lookAt.set(lookX, lookY, lookZ);
      camera.lookAt(lookAt);

      /*
       * A window handle on the world's live state, for the driving scripts.
       *
       * Development only. The scripts that walk this world and photograph it
       * need to know where the duelist actually is — steering by keypress alone
       * is guesswork, and every camera-relative control makes it worse. It is
       * the difference between "the screenshot looks wrong" and "the player is
       * at (9.5, 14.5), which is outside the shop", which is how the stale-save
       * bug was found.
       *
       * Stripped from production builds: it is a debugging aid, not a feature.
       */
      if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
        const w = window as unknown as {
          __probe?: unknown; __scene?: unknown; __THREE?: unknown; __camera?: unknown; __renderer?: unknown };
        /* The scene itself, so `npm run coplanar` can audit the geometry for
           surfaces that sit at identical depth. See that script's header. */
        w.__scene = scene;
        /* And the renderer, so `npm run soak` can read `renderer.info` — how
           many geometries and textures the card is holding — across a hundred
           door crossings. A leak is a number that only ever goes up. */
        w.__renderer = renderer;
        /* And the library, so `npm run seams` can cast a ray with the same
           code the renderer uses rather than a hand-rolled box test that would
           miss every rotated mesh in the world. */
        w.__THREE = THREE;
        /* And the camera, so a check can ask what is behind a given pixel of a
           screenshot — which is the only way to answer "what is that patch of
           sky" without guessing at coordinates. */
        w.__camera = camera;
        w.__probe = {
          area: area.id,
          /*
           * Four places, not two.
           *
           * At two, a reported position is up to five millimetres from the real
           * one — which is nothing anywhere except at the edge of a step, where
           * it is a whole step. Turtle Lane's treads meet at x 8.502, and
           * `npm run stairs` read a duelist standing at 8.503 as standing at
           * 8.50, looked up the floor there, and reported her eighteen
           * centimetres inside a stone she was walking correctly down.
           */
          player: [+p.x.toFixed(4), +p.z.toFixed(4)],
          /* The height the duelist is actually drawn at, which is the eased one
             and not `groundAt` — `npm run stairs` compares the two. */
          y: +groundY.toFixed(3),
          cam: [+camera.position.x.toFixed(2), +camera.position.y.toFixed(2), +camera.position.z.toFixed(2)],
          camDist: +camDist.toFixed(2), camLift: +camLift.toFixed(2), camYaw: +camYaw.toFixed(3),
          near: nearRef.current?.id ?? null,
          lights: scene.children.length,
          built: built ? built.root.children.length : 0,
        };
      }
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
      /* The area owns its geometry, its textures and its lights; one call takes
         all of it. */
      if (built) {
        scene.remove(built.root);
        built.dispose();
      }
      rig?.dispose();
      for (const { rig: theirs } of npcs) theirs.dispose();
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

  /**
   * The position, written, with nobody told about it.
   *
   * The Save button is a *report* — a sound, a line of text, a spinner — and
   * none of that belongs to the saves the game takes on its own behalf.
   */
  const persist = useCallback(
    () => onSave({ ...here.current, area: areaRef.current }).catch(() => null),
    [onSave]
  );

  /**
   * And the game takes them constantly.
   *
   * Mike won a duel and came back to the street he starts on, twenty minutes
   * from where he had been standing. Nothing was broken about the save itself:
   * the world simply never wrote one unless he pressed the button. Leaving for
   * a duel fired a write and then navigated away in the same tick, which aborts
   * it; leaving to the main menu wrote nothing at all. So "carry on where you
   * left off" meant "carry on wherever you last remembered to press Save",
   * which is not a thing to ask of anybody.
   *
   * Every four seconds, and only when the duelist has actually moved a metre
   * since the last one. A position is four numbers and this is the cheapest
   * write in the game; not doing it cost an hour of somebody's evening.
   */
  const saved = useRef({ x: NaN, z: NaN, area: '' as string });
  useEffect(() => {
    const id = setInterval(() => {
      const at = here.current;
      const area = areaRef.current;
      const was = saved.current;
      const moved = area !== was.area || Math.hypot(at.x - was.x, at.z - was.z) > 1;
      if (!moved) return;
      saved.current = { x: at.x, z: at.z, area };
      void persist();
    }, 4000);
    return () => clearInterval(id);
  }, [persist]);

  const save = useCallback(async () => {
    setSaving(true);
    setNote(null);
    sfx.click();
    let problem: string | null;
    try {
      problem = await onSave({ ...here.current, area: areaRef.current });
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
    setNote(problem ?? 'Progress saved.');
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
    setAskingDelete(null);
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
        <button
          className="btn rounded px-4 py-2 text-xs"
          onClick={() => void persist().then(onExit)}
        >
          Back to the main menu
        </button>
      </main>
    );
  }

  return (
    <main className="relative h-[100svh] w-full overflow-hidden">
      <div ref={holder} className="absolute inset-0" />

      {/* The sheet a door transition plays behind. Opacity is written straight
          from the render loop; React never re-renders for it. */}
      <div
        ref={fade}
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-black"
        style={{ opacity: 0 }}
      />

      {/* Where you are, said once on arrival and then got out of the way. The
          areas have names because we are going to be referring to them for the
          rest of the game; this is the player learning them too. */}
      {entered && (
        <div
          data-area={entered}
          className="pointer-events-none absolute left-1/2 top-6 -translate-x-1/2 rounded-full
                     border border-white/15 bg-black/55 px-5 py-2 text-center backdrop-blur-sm
                     animate-[fadeaway_2.6s_ease-out_forwards]"
        >
          <span className="text-[13px] font-semibold tracking-[0.18em] text-amber-100/90 uppercase">
            {entered}
          </span>
        </div>
      )}

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
                /* The way out writes where you were standing. Leaving by the
                   menu used to write nothing, so coming back in put you at the
                   last save rather than at the door you left by. */
                void persist().then(onExit);
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
                setAskingDelete('warn');
              }}
            >
              Delete Character
            </button>
          </div>
        )}
      </div>

      {askingDelete === 'warn' && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/85 p-5">
          <div className="panel grain w-full max-w-sm rounded p-5">
            <h2 className="font-display text-lg text-brassbright">Delete {character.name}?</h2>
            <div className="brass-rule my-3" />
            <p className="text-xs leading-relaxed text-ptext/85">
              This erases everything saved for <span className="text-parchment">{profile.username}</span> — your
              duelist, your deck, every card in your Trunk, every pack you have opened and every duelist you have
              pulled from — and starts the story over from the beginning.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                className="btn flex-1 rounded px-4 py-2 text-xs"
                onClick={() => {
                  sfx.click();
                  setAskingDelete(null);
                }}
                disabled={deleting}
              >
                Keep playing
              </button>
              <button
                className="btn btn-danger flex-1 rounded px-4 py-2 text-xs"
                onClick={() => {
                  sfx.click();
                  setAskingDelete('sure');
                }}
                disabled={deleting}
              >
                Delete Character
              </button>
            </div>
          </div>
        </div>
      )}

      {askingDelete === 'sure' && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/90 p-5">
          <div className="panel grain w-full max-w-sm rounded border-oxblood p-5">
            <h2 className="font-display text-lg text-[#f0c9cc]">Are you certain?</h2>
            <div className="brass-rule my-3" />
            <p className="text-xs leading-relaxed text-ptext/85">
              There is no way to bring {character.name} back, and nothing you have collected survives this. Asked
              twice because it cannot be asked again afterwards.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                className="btn flex-1 rounded px-4 py-2 text-xs"
                onClick={() => {
                  sfx.click();
                  setAskingDelete(null);
                }}
                disabled={deleting}
              >
                No, keep playing
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

      {/* Somebody within reach. Sits above the stick rather than beside it,
          because the thumb that walks you over is the thumb that taps it. */}
      {nearNpc && !talkingTo && (
        <div className="absolute inset-x-0 bottom-0 z-20 flex justify-center" style={{ marginBottom: 'calc(var(--safe-bottom) + 156px)' }}>
          <button
            data-talk={nearNpc.id}
            className="btn btn-primary rounded px-4 py-2 text-[11px]"
            onClick={() => {
              sfx.click();
              setTalkingTo(nearNpc);
            }}
          >
            Talk to {nearNpc.character.name}
          </button>
        </div>
      )}

      {/* thumb stick — hidden mid-conversation, where it would only walk you
          out of the range that opened it. */}
      <div
        ref={stick}
        className={`absolute bottom-0 left-0 m-4 grid h-[124px] w-[124px] touch-none place-items-center rounded-full border border-stoneline bg-black/25 backdrop-blur-[2px] ${
          talkingTo ? 'hidden' : ''
        }`}
        style={{ marginBottom: 'calc(var(--safe-bottom) + 16px)', marginLeft: 'calc(var(--safe-left) + 16px)' }}
        aria-label="Move"
      >
        <div
          ref={knob}
          className="pointer-events-none h-[52px] w-[52px] rounded-full border border-brassdim bg-[#1c222b]/85"
        />
      </div>

      {!talkingTo && (
        <p
          className="pointer-events-none absolute bottom-0 right-0 m-4 text-right text-[9px] leading-relaxed text-white/45"
          style={{ marginBottom: 'calc(var(--safe-bottom) + 16px)', marginRight: 'calc(var(--safe-right) + 16px)' }}
        >
          Drag to look · stick to walk
          {hasKeyboard && (
            <>
              <br />
              WASD on a keyboard
            </>
          )}
        </p>
      )}

      {talkingTo && (
        <Conversation
          npc={talkingTo}
          openAt={resumeAt ?? undefined}
          onShop={() => onShop?.(talkingTo)}
          onDuel={() => {
            /*
             * Where you are standing is written down before the duel, not after.
             *
             * A duel is a different page: this component unmounts, and `here`
             * goes with it. Without this the world reloaded on whatever position
             * was last saved — which for most players is wherever they last
             * pressed Save, so beating somebody in the street put them back
             * inside the shop. Saving on the way out means you come back to the
             * conversation you left, standing where you left it.
             *
             * Not awaited. The duel should not wait on a write, and the position
             * is worth exactly as much as it costs: if it fails the player is
             * where they last saved, which is what would have happened anyway.
             */
            /*
             * Awaited, and not fired into the dark.
             *
             * `onDuel` navigates to another page, and a fetch started in the
             * same tick as a navigation is a fetch the browser is entitled to
             * cancel — which it does, often enough that winning a duel put Mike
             * back where he had last pressed Save rather than outside the
             * building he walked into. The duel can wait the one round trip.
             */
            void (async () => {
              await persist();
              onDuel?.(talkingTo);
            })();
          }}
          playerName={character.name}
          onClose={() => {
            setTalkingTo(null);
            setResumeAt(null);
          }}
        />
      )}
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Generated assets                                                    */
/* ------------------------------------------------------------------ */


