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
import { WORLD_NPCS, openingNode, whereabouts, type WorldNpc } from '@/story/npcs';
import { CHIPS_TO_FINALS, cardsLeft, isEntrant, isFinalist, phaseOf, tournamentOpen, type Phase } from '@/story/tournament';
import { dayFrom, type Haunt } from '@/story/ash';
import {
  FINALIST_SPOTS,
  TRAVELLER_BY_ID,
  bandOf,
  legBetween,
  nodeAt,
  planFor,
  segmentAt,
  travelClock,
  travelState,
  type TravelState,
} from '@/story/travel';
import { findPath, alongPath, pathLength, type NavPoint } from '@/story/nav';
import { CARDS } from '@/game/cards';
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
  floorNear,
  standingOn,
  cameraReach,
} from '@/story/areas';
import WorldMap, { type DuelistMark } from './WorldMap';
import StoryMenu from './StoryMenu';
import type { BuiltArea } from './world/kit';
import { DAY_MINUTES, skyAt, hourFrom } from '@/story/sky';
import { TOP_SPEED, npcGait } from '@/story/gait';
import { ceilingFor, deckIsShort } from '@/story/shop';
import { setShadowQuality } from './world/sky';
import { buildShop } from './world/shop';
import { buildStreet } from './world/street';
import { buildMarket } from './world/market';
import { buildStepLane } from './world/steplane';
import { buildShrine } from './world/shrine';
import { prefetchAround } from './world/files';
import {
  buildBlackCrown, buildCrownShop, buildCemetery, buildStation, buildPlaza, buildTowers, buildHigh,
} from './world/ported';
import { buildPremadeRig, releaseTemplates, type PremadeRig } from './premadeRig';
import Conversation from './Conversation';
import Cutscene from './Cutscene';
import TournamentBoard, { FinalsCard } from './TournamentBoard';
import { canDraw3d } from './webgl';
import { sfx } from '@/lib/sfx';

/** Matches the clamp in `/api/story/save`; the field ends here. */
export const WORLD_RADIUS = 120;

/* Top speed and the stride an NPC is given for it both live in
   `story/gait.ts` now — the rig reads the same two numbers. */

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
  onDuel?: (npc: WorldNpc, stake?: number, wager?: string) => void;
  /** A character has been asked what they have for sale. */
  onShop?: (npc: WorldNpc) => void;
  /**
   * Somebody to walk straight back into a conversation with, and where to pick
   * it up — set when returning from a duel they sent the player to.
   */
  resume?: { npcId: string; node: string; wagered?: string } | null;
  /**
   * The resume has been taken up, and must not be handed over again.
   *
   * It is read in a `useState` initialiser, so it is read on *every* mount of
   * this screen — and this screen is unmounted by the deck builder, the
   * collection and the map. A note left in place therefore reopened the
   * conversation every time the player came back from editing a deck: you say
   * goodbye to Tina, go and sleeve a card, close the panel, and she is talking
   * to you again. Which she was, for as long as the note sat there.
   */
  onResumed?: () => void;
  /**
   * Somebody has now been talked to for the first time, and should get the
   * short version from here on — see `StoryProfile.met`.
   *
   * Told to the caller rather than written here because this screen owns no
   * save; it is the same shape as `onSeen` in the deck builder, and it is
   * fire-and-forget for the same reason. A note that never lands costs the
   * player one repeated introduction.
   */
  onMet?: (npcId: string) => void;
  /**
   * Something else has the screen and must finish first — keep the
   * conversation closed until it clears.
   *
   * One caller and one reason: a pack. Winning used to bring the world back
   * with the duelist's aftermath open *and* the pack opening over the top of
   * it, which is two scenes at once and the wrong order — see `packFirst` in
   * `StoryMode`.
   *
   * It holds the panel, not the conversation. Whoever the duel came back to is
   * already chosen, already stood in front of the player and already still,
   * because that is `resume`'s work and it happens on mount: a roamer put back
   * at the top of her route would have walked off by the time three cards had
   * been turned over. What waits is only the drawing of it.
   */
  hold?: boolean;
  /**
   * Nothing else is over the world — no pack being turned, no counter open —
   * so a broadcast may play. See the tournament's effects below.
   */
  quiet?: boolean;
  /** Kaiba's broadcast has played: open the tournament on the save. */
  onTournamentStart?: () => Promise<void> | void;
  /** The finals have been announced: say so on the save, so it plays once. */
  onFinalsSeen?: () => void;
}

/**
 * How far a traveller walks while fading, coming in through a gate or going
 * out of one. A metre and a quarter — a stride and a half — so somebody
 * appearing in a doorway reads as walking out of it rather than as a switch
 * being thrown.
 */
const FADE_METRES = 1.25;

/** Everybody's name, by id, for the table and the map. */
const NAMES: Record<string, string> = Object.fromEntries(WORLD_NPCS.map((n) => [n.id, n.character.name]));



export default function OpenWorld({ profile, onEditDeck, onSave, onDelete, onExit, onDuel, onShop, resume, onResumed, onMet, hold, quiet, onTournamentStart, onFinalsSeen }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  /** The name of the place on the pause menu's plaque, read as it opens. */
  const [menuPlace, setMenuPlace] = useState('');
  const [mapOpen, setMapOpen] = useState(false);
  /**
   * Put the duelist anywhere in the city, including in another area.
   *
   * `window.__teleport` is the checks' hook and stays in one area on purpose;
   * this is the app's, and it is the same thing a door does — swap the area,
   * set the position, let the floor and the camera catch up on the next frame.
   * Held in a ref because `enter` lives inside the effect that owns the scene
   * and React cannot see in there.
   */
  const warpRef = useRef<((to: AreaId, x: number, z: number) => void) | null>(null);
  /* Redrawn only while the map is open: this is where the marker comes from,
     and a position that updates every frame would re-render the world. */
  const [mapAt, setMapAt] = useState<{ area: AreaId; x: number; z: number } | null>(null);
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
  /**
   * The card the duel was played for, held here rather than read off `resume`
   * on every render: `onResumed` clears the note upstream the moment it has
   * been taken, and the conversation it named is still open. Read once, like
   * the node, and cleared with it.
   */
  const [wageredCard, setWageredCard] = useState<string | null>(resume?.wagered ?? null);
  /**
   * Everybody this player has been introduced to, which decides whether a
   * conversation opens on the scene or on the short version.
   *
   * Seeded from the save and added to *here*, on the spot, rather than waiting
   * for the write to come back: the note is posted fire-and-forget through
   * `onMet`, and a player who says goodbye to Tina and immediately walks back
   * into range must not get the introduction a second time because a round
   * trip is still in flight. The save is what carries it to tomorrow; this is
   * what carries it to the next step.
   */
  const [met, setMet] = useState<Set<string>>(() => new Set(profile.met ?? []));

  /**
   * The tournament, as the render loop reads it.
   *
   * The loop is built once and must not re-run when the save changes, so it
   * reads the tournament through a ref — and when the phase moves (the
   * broadcast has played, the finals are set) it is told to put the area's
   * people back together, because who is in the city has changed.
   */
  const tournamentRef = useRef(profile.tournament ?? null);
  const phaseRef = useRef<Phase>(phaseOf(profile.tournament));
  const repopulate = useRef(false);
  useEffect(() => {
    tournamentRef.current = profile.tournament ?? null;
    const phase = phaseOf(profile.tournament);
    if (phase !== phaseRef.current) {
      phaseRef.current = phase;
      repopulate.current = true;
    }
  }, [profile.tournament]);
  const phase = phaseOf(profile.tournament);
  /** Kaiba's broadcast, on screen. */
  const [broadcast, setBroadcast] = useState(false);
  /** The table, on screen. */
  const [boardOpen, setBoardOpen] = useState(false);
  /** A star chip just won, said once and then got out of the way. */
  const [chipNote, setChipNote] = useState<string | null>(null);
  /** Where the duelists are, redrawn while the map is open. */
  const [marks, setMarks] = useState<DuelistMark[]>([]);
  const marksRef = useRef<(() => DuelistMark[]) | null>(null);
  const names = NAMES;
  /* What the loop last reported, so it only calls setState when it changes. */
  const nearRef = useRef<WorldNpc | null>(null);
  /* Read by the render loop, which must not re-run when a conversation opens:
     rebuilding the field to show a panel would drop the player at spawn. */
  const talkingRef = useRef<WorldNpc | null>(null);
  /**
   * Somebody who is mid-conversation with you before they have been built.
   *
   * A roamer's live position lives in the field, and the field is thrown away
   * and rebuilt by a duel — so coming back to a resumed conversation stood
   * Tina at the first point of her route, which is twenty metres from where
   * the two of you were standing when you agreed to play. She would then walk
   * off, because a route runs on whoever is talking.
   *
   * Consumed once, in `populate`: the fiction is that you never stopped
   * talking, so she is put back in front of you *this* time and not every time
   * the area is entered for the rest of the session.
   */
  const rejoinRef = useRef<string | null>(resume?.npcId ?? null);
  useEffect(() => {
    talkingRef.current = talkingTo;
  }, [talkingTo]);
  /**
   * Tell the caller the note has been read — once, on the way in.
   *
   * The conversation it named is already open in this screen's own state by
   * the time this runs, so clearing it upstream costs nothing now and is the
   * whole of what stops it reopening later. See `onResumed`.
   */
  const tookResume = useRef(false);
  useEffect(() => {
    if (!resume || tookResume.current) return;
    tookResume.current = true;
    onResumed?.();
  }, [resume, onResumed]);

  /**
   * A deck a card short is a deck that cannot duel, and the game says so by
   * opening the builder rather than by refusing at the next table.
   *
   * The only way a sleeved deck loses a card is losing it to Ash — see
   * `CARD_WAGER` — and the conversation that tells you so is the one this
   * waits for: the builder replaces the world, so opening it over the panel
   * would cut him off mid-sentence. The moment the conversation closes, the
   * player is in the builder, and the builder has no way back until the deck
   * is twenty-five again (see `StoryMode`).
   */
  useEffect(() => {
    if (!deckIsShort(profile) || talkingTo) return;
    onEditDeck();
  }, [profile, talkingTo, onEditDeck]);

  /**
   * Kaiba's broadcast: the first time the player is standing in the world
   * with ninety-nine cards and nothing else going on.
   *
   * Nothing else means it: not mid-conversation (the duel the ninety-ninth
   * card came off still has something to say about it), not while a pack is
   * being turned or the counter is open (`quiet`), not over the menu or the
   * map. A moment's grace after all of that clears, so it does not land on
   * the same frame as the panel closing.
   */
  const broadcastDue = phase === 'before' && tournamentOpen(profile.collection.length);
  useEffect(() => {
    if (!broadcastDue || broadcast || talkingTo || hold || !quiet || menuOpen || mapOpen) return;
    const timer = window.setTimeout(() => setBroadcast(true), 1200);
    return () => window.clearTimeout(timer);
  }, [broadcastDue, broadcast, talkingTo, hold, quiet, menuOpen, mapOpen]);

  /** The finals, announced once, the first quiet moment after they are set. */
  const finalsDue = phase === 'finals' && !profile.tournament?.finals?.seen;

  /**
   * A star chip, said out loud the moment the save has it — which is the
   * moment the conversation the duel came back to has picked up, because
   * that is when the duel is settled (`/api/story/save`).
   */
  const chipsHeld = profile.tournament?.chips.length ?? 0;
  const chipsSeen = useRef(chipsHeld);
  useEffect(() => {
    if (chipsHeld > chipsSeen.current) {
      const newest = profile.tournament?.chips[chipsHeld - 1];
      const who = WORLD_NPCS.find((n) => n.id === newest)?.character.name ?? 'a duelist';
      setChipNote(`Star chip — ${who} · ${chipsHeld} of ${CHIPS_TO_FINALS}`);
      sfx.heal();
      const timer = window.setTimeout(() => setChipNote(null), 4200);
      chipsSeen.current = chipsHeld;
      return () => window.clearTimeout(timer);
    }
    chipsSeen.current = chipsHeld;
  }, [chipsHeld, profile.tournament]);

  /* The duelists on the map move while it is open: once a second. */
  useEffect(() => {
    if (!mapOpen) return;
    const read = () => setMarks(marksRef.current?.() ?? []);
    read();
    const timer = window.setInterval(read, 1000);
    return () => window.clearInterval(timer);
  }, [mapOpen]);


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
   * Whether where she stands is written in the corner — an Options switch,
   * off unless asked for. Mike asked for it so a place he sees something
   * wrong can be named ("the lamp at −26, 48"); it is not part of the game.
   */
  const [showWhere, setShowWhere] = useState(() => {
    try { return window.localStorage.getItem('story-where') === '1'; } catch { return false; }
  });
  const [where, setWhere] = useState('');
  const showWhereRef = useRef(showWhere);
  useEffect(() => {
    showWhereRef.current = showWhere;
  }, [showWhere]);
  /**
   * The black sheet a door transition plays behind.
   *
   * A plain div rather than anything in the scene, and driven by writing to its
   * style from the render loop rather than through React state — a fade is sixty
   * opacity values a second, and sixty re-renders a second to deliver them would
   * cost more than the world it is covering up.
   */
  const fade = useRef<HTMLDivElement>(null);
  /** The name on the sheet while it is down: written straight from the loop, like the sheet. */
  const card = useRef<HTMLSpanElement>(null);

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
    /*
     * Two on a desktop, one and a half on a phone.
     *
     * A three-times phone at two is four times the pixels of its own screen,
     * with antialiasing on top and a 2048 shadow map under it, and that is a
     * load a phone carries for four minutes before it is warm and starts
     * dropping frames — which is what Mike felt as "slow after five minutes,
     * fine again after a refresh". A refresh is a rest, not a fix. Fewer
     * pixels from the start, and the governor below for the rest.
     */
    const coarse = window.matchMedia?.('(hover: none) and (pointer: coarse)').matches ?? false;
    const baseRatio = Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2);
    renderer.setPixelRatio(baseRatio);
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
    /* And the day, for the one person whose whereabouts depend on it. A
       pinned hour already pins the day to nought (see `dayFrom`); `?day=` names
       a particular one, so a check can stand where Ash is known to be. */
    let pinnedDay: number | null = null;
    /*
     * `?from=` starts the clock at an hour and lets it run — for watching the
     * tournament's travellers walk the city at a time of day of one's
     * choosing, which a pinned hour cannot show: pinned, nobody moves.
     */
    let offset = 0;
    /*
     * `?steady` holds the governor at full quality. For the checks that
     * compare two screenshots: under software rendering the governor steps
     * down a moment into every page, and a frame drawn at a different
     * resolution from its twin is the whole picture flipping — a fact about
     * the governor, not the world being measured.
     */
    let steady = false;
    try {
      const search = new URLSearchParams(window.location.search);
      steady = search.has('steady');
      const raw = search.get('t');
      if (raw !== null && raw !== '' && Number.isFinite(Number(raw))) pinned = Number(raw);
      const rawDay = search.get('day');
      if (rawDay !== null && rawDay !== '' && Number.isFinite(Number(rawDay))) pinnedDay = Number(rawDay);
      const rawFrom = search.get('from');
      if (pinned === null && rawFrom !== null && rawFrom !== '' && Number.isFinite(Number(rawFrom))) {
        const dayMs = DAY_MINUTES * 60_000;
        const want = ((Number(rawFrom) % 24) + 24) % 24;
        const have = hourFrom(Date.now());
        offset = ((((want - have) % 24) + 24) % 24) / 24 * dayMs;
      }
    } catch {
      /* no window.location worth reading — leave it running */
    }
    /** The wall clock, as this world reads it. */
    const worldNow = () => Date.now() + offset;

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
      'domino-station': buildStation,
      'station-plaza': buildPlaza,
      'domino-high': buildHigh,
      'central-towers': buildTowers,
    };

    let built: BuiltArea | null = null;
    let area = areaById(areaRef.current);
    const anisotropy = renderer.capabilities.getMaxAnisotropy();

    /*
     * How many of an area's lamps may be lit at once.
     *
     * ## Why there is a number at all
     *
     * A point light is not scenery: three.js evaluates every one of them for
     * every lit fragment on the screen, so the cost of a lamp is paid by the
     * whole picture whether or not you can see the lamp. Station Plaza is a
     * hundred and thirty-two metres of square with fifty-three of them on it —
     * the standards round the island, the shopfronts, the shelters, the ways
     * out — and it ran at half the frame rate of Domino Station on *fewer*
     * triangles. Not the geometry. The lights.
     *
     * Measured, at t16, three interleaved rounds on one page, with the
     * geometry held still at 404 draw calls and 96,829 triangles and nothing
     * changing but how many lamps were lit:
     *
     *     52 lit   0.42  0.40  0.58 fps
     *     24 lit   1.24  1.17  0.99 fps
     *     14 lit   3.71  3.53  3.47 fps
     *
     * ## Why it is free
     *
     * Every lamp in this world is written with a `distance`, and a three.js
     * point light contributes exactly nothing beyond it. Counted over a metre
     * grid of every area there is — how many lamps actually reach a duelist's
     * head standing on that square metre — the worst place in the city is lit
     * by ten:
     *
     *     station-plaza   53 lamps, reach 9–27 m, at most  9 reach you
     *     domino-high     53 lamps, reach 7–42 m, at most 10
     *     domino-station  27 lamps, reach 12–34 m, at most 8
     *     old-cemetery    17 lamps, reach 6–15 m, at most  4
     *
     * So fourteen is not a compromise: it is every lamp that is doing anything
     * plus four spare, and the other thirty-nine were being multiplied through
     * the fragment shader to add zero.
     *
     * Sorted by the distance to a lamp's *pool* rather than to the lamp, so a
     * tall standard reaching twenty-seven metres outranks a shop light nearer
     * to you and reaching nine: what has to stay lit is the ground you can
     * see, not the fitting nearest your shoulder.
     *
     * ## Why the count is fixed and not a radius
     *
     * Because the *number* of visible lights is part of a material's shader
     * key: let it vary with where you stand and every few steps recompiles
     * every program in the scene, which is a stutter far worse than the cost
     * it saves. Exactly `LAMP_BUDGET` are lit whenever there are that many, so
     * the count never moves and no shader is ever rebuilt for it.
     */
    const LAMP_BUDGET = 14;
    let lamps: THREE.PointLight[] = [];
    const lampOrder: number[] = [];
    let lampTick = 0;
    /* SCAFFOLDING: when the coordinate readout last spoke. */

    /**
     * The nearest `LAMP_BUDGET` lamps on, the rest off.
     *
     * Called once on the way into an area and every fourth frame after, and
     * the entry call is not a nicety: three.js keys a material's shader on the
     * number of visible lights, so an area that renders even one frame with
     * all fifty-six of its lamps on compiles every program in it twice — once
     * at fifty-six and once at fourteen — and pays a stall for each. Twenty
     * doors, six laps, and that is two hundred and forty compilations.
     * Measured: `npm run soak` finished holding 61 shader programs without
     * this call and 32 with it, and the frame time it had been failing on
     * stopped growing.
     *
     * Sorted by distance to the lamp's *pool*, not to the lamp: a standard
     * reaching twenty-seven metres from thirty away is lighting ground you can
     * see, and a shop light reaching nine from fifteen away is lighting
     * nothing.
     */
    const budgetLamps = (x: number, y: number, z: number) => {
      if (lamps.length <= LAMP_BUDGET) return;
      const reach = (l: THREE.PointLight) =>
        Math.hypot(l.position.x - x, l.position.y - y, l.position.z - z) - l.distance;
      lampOrder.sort((a, b) => reach(lamps[a]) - reach(lamps[b]));
      for (let i = 0; i < lampOrder.length; i++) lamps[lampOrder[i]].visible = i < LAMP_BUDGET;
    };

    /* Whether the area on screen is all there. A procedural area is the
       moment it is built; one loaded from a file is when the file lands. The
       probe reports it and every check waits on it. */
    let areaReady = true;
    const enter = (id: AreaId) => {
      if (built) {
        scene.remove(built.root);
        built.dispose();
        built = null;
      }
      area = areaById(id);
      areaRef.current = area.id;
      built = BUILDERS[area.id](anisotropy);
      const mine = built;
      areaReady = !mine.ready;
      if (!mine.ready) prefetchAround(area.id);
      mine.ready?.then(
        () => {
          if (built === mine) {
            areaReady = true;
            prefetchAround(id);
          }
        },
        (err: unknown) => {
          /* A room whose file never came is a room with nothing in it. Say
             so; the lights and the floor collision still stand. */
          console.error('open world: the area failed to load', err);
          if (built === mine) areaReady = true;
        }
      );
      lamps = [];
      built.root.traverse((o) => {
        if ((o as THREE.PointLight).isPointLight) lamps.push(o as THREE.PointLight);
      });
      lampOrder.length = 0;
      for (let i = 0; i < lamps.length; i++) lampOrder.push(i);
      /* From wherever the duelist stands as this area opens — the spawn, or a
         door's landing. Which fourteen is a detail the next frame corrects;
         that it is *fourteen* is what keeps the shader key still. */
      budgetLamps(here.current.x, standingOn(area, here.current.x, here.current.z) + 1, here.current.z);
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
    /**
     * Where each of them actually is, which for most of them is where they
     * were put.
     *
     * `at` exists because of `roam`: everything that used to read `npc.x` —
     * the turn-to-face, the talk range, the cylinder you are pushed out of —
     * was reading the record, and a record is where somebody *starts*. Held
     * beside the rig rather than read back off `rig.root.position`, because
     * that carries the breath and the step-rise on top and is a centimetre
     * out at all times.
     *
     * `leg` is the point they are walking to, `hold` the seconds left standing
     * at the one they reached.
     */
    let npcs: {
      npc: WorldNpc;
      rig: PremadeRig;
      /**
       * Where they are — and how high. `y` is the floor they were last put
       * on, handed back to `groundAt` as `near` on every step: without it a
       * route under a gallery answered with the gallery, because the gallery
       * is over you and is higher, and Ash crossing the Crown's atrium stood
       * on the first floor's underside.
       */
      at: { x: number; z: number; y: number };
      /** The route and facing of the haunt they were built for — a schedule
          may put the same person on a different route in a different shop. */
      route: Haunt['roam'];
      facing: number;
      leg: number;
      dir: 1 | -1;
      hold: number;
      /** Seconds of walking left before the next unplanned stop. */
      rest: number;
      /**
       * How this person is moved: a `route` they pace, standing where they
       * were put, or the tournament's `travel` plan (`story/travel.ts`).
       */
      moves: 'route' | 'fixed' | 'travel';
      /**
       * Travel only: how many seconds behind the plan they are running.
       *
       * The plan is the wall clock's, and a traveller who stops to talk to
       * you has stopped and the clock has not — so they carry on from where
       * they were, a little late, and make the time up standing still at their
       * next stop rather than by teleporting to where the plan has got to.
       * Out of sight nobody is late: the next time the area is built, they are
       * wherever the clock says.
       */
      lag: number;
      /** Travel only: how much of them there is — fading in a doorway. */
      shown: number;
      /** Travel only: has appeared here, rather than being loaded ahead of arriving. */
      entered: boolean;
      born: number;
      /**
       * A walk of their own, off the plan: after a duel they are stood in
       * front of the player and have to find their way back into it. `wait`
       * holds it until the conversation is over.
       */
      detour: {
        points: NavPoint[];
        d: number;
        then: 'exit' | 'plan';
        wait?: boolean;
        /** For `plan`: the second of the plan they pick up at when the walk ends. */
        resumeAt?: number;
      } | null;
      /** Seconds stood looking at a player who has not spoken; after five they walk on. */
      waited: number;
      /** Walked on past a player who did not speak — not stopping for them again until they have gone. */
      passing: boolean;
      /** Seconds held up by somebody standing in the way. */
      blocked: number;
      /** Which way they are going, and whether they are, for whoever walks behind them. */
      heading: number;
      moving: boolean;
      /** The materials of the rig and what they were, for the fade. */
      mats: { mat: THREE.Material & { opacity: number }; opacity: number; transparent: boolean }[];
      meshes: THREE.Mesh[];
      faded: boolean;
    }[] = [];
    /**
     * Travellers who walked out after a duel, kept out of this area until
     * the plan agrees they have gone — otherwise the next presence check,
     * reading a plan that still has them waiting at a stop here, would stand
     * them back up at it a moment after they left.
     */
    const stayGone = new Set<string>();

    /** Draws somebody at a fraction of themselves, or wholly. */
    const fadeTo = (them: (typeof npcs)[number], shown: number) => {
      them.shown = shown;
      them.rig.root.visible = shown > 0.01;
      const faded = shown < 0.999;
      if (faded !== them.faded) {
        them.faded = faded;
        for (const m of them.mats) {
          m.mat.transparent = faded || m.transparent;
          m.mat.needsUpdate = true;
        }
      }
      for (const m of them.mats) m.mat.opacity = m.opacity * (faded ? shown : 1);
      for (const mesh of them.meshes) mesh.castShadow = !them.npc.spirit && shown > 0.5;
    };

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
    /** Takes one person out of the field, whole. */
    const depart = (id: string) => {
      const gone = npcs.find((n) => n.npc.id === id);
      if (!gone) return;
      scene.remove(gone.rig.root);
      gone.rig.dispose();
      npcs = npcs.filter((n) => n !== gone);
    };

    /**
     * Builds one person at one haunt, in the area that is open.
     *
     * Split out of `populate` so the presence loop can call it for somebody
     * who has just arrived on the clock, exactly as the door does for
     * everybody standing here when it opens.
     */
    /* Somebody whose model is still coming down. The presence loop asks every
       two seconds and a cold fetch can take longer than that, so without this
       the same person was built twice and stood in two places. */
    const building = new Set<string>();
    const arrive = (npc: WorldNpc, at: Haunt, id: AreaId, moves: 'route' | 'fixed' | 'travel') => {
      if (npcs.some((n) => n.npc.id === npc.id) || building.has(npc.id)) return;
      building.add(npc.id);
      buildPremadeRig(npc.character, {
          overrides: npc.overrides,
          accessories: npc.accessories,
          repaint: npc.repaint,
          build: npc.build,
          spirit: npc.spirit,
        })
          .then((fresh) => {
            building.delete(npc.id);
            /* Two ways to be stale: the screen is gone, or the player has
               already walked out of the area this rig belongs to — or they
               were built by the door and the clock both in the same breath. */
            if (gone || areaRef.current !== id || npcs.some((n) => n.npc.id === npc.id)) {
              fresh.dispose();
              return;
            }
            /* A roamer starts at the first point of its own path and walks to
               the second; `npc.x`/`npc.z` are that first point, so there is
               one place the route is written and it is the route.

               Unless the two of you were already talking when the duel took
               them out of the world — then they are standing where the
               conversation is, which is in front of the player. Far enough out
               to be clear of `NPC_RADIUS`, so putting them there cannot shove
               the player, and `settle` keeps them out of a wall if the
               conversation happened against one. */
            const rejoining = rejoinRef.current === npc.id;
            let start = { x: at.x, z: at.z };
            let leg = 1;
            if (rejoining) {
              rejoinRef.current = null;
              const ahead = settle(
                areaById(id),
                here.current.x + Math.sin(here.current.facing) * 1.8,
                here.current.z + Math.cos(here.current.facing) * 1.8,
                0.4
              );
              start = { x: ahead.x, z: ahead.z };
              /* Carry on to whichever point of the route is nearest, rather
                 than back to the leg they were on before the duel: from here
                 that one can be behind them. */
              const path = at.roam?.path;
              if (path) {
                let best = 0;
                let bestD = Infinity;
                path.forEach((point, i) => {
                  const away = Math.hypot(point.x - start.x, point.z - start.z);
                  if (away < bestD) {
                    bestD = away;
                    best = i;
                  }
                });
                leg = best;
              }
            }
            /* On the floor they walk in on. `standingOn` is what a door's
               landing asks, and a haunt's first point is a landing of sorts. */
            const floor = standingOn(areaById(id), start.x, start.z);
            fresh.root.position.set(start.x, floor, start.z);
            fresh.root.rotation.y = at.facing;
            scene.add(fresh.root);
            const mats: (typeof npcs)[number]['mats'] = [];
            const meshes: THREE.Mesh[] = [];
            fresh.root.traverse((o) => {
              const mesh = o as THREE.Mesh;
              if (!mesh.isMesh) return;
              meshes.push(mesh);
              for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
                const m = mat as THREE.Material & { opacity: number };
                if (!mats.some((x) => x.mat === m)) mats.push({ mat: m, opacity: m.opacity, transparent: m.transparent });
              }
            });
            const person: (typeof npcs)[number] = {
              npc,
              rig: fresh,
              at: { x: start.x, z: start.z, y: floor },
              route: moves === 'route' ? at.roam : undefined,
              facing: at.facing,
              leg,
              dir: 1,
              hold: 0,
              /* Staggered on arrival rather than started at the full interval,
                 so two people in one area do not stop together on the first
                 lap and then for ever after. */
              rest: at.roam?.restEvery ? at.roam.restEvery * (0.3 + Math.random()) : Infinity,
              moves,
              lag: 0,
              shown: 1,
              entered: moves !== 'travel' || rejoining,
              born: performance.now(),
              /* Back from a duel with a traveller: stood here for the rest of
                 the conversation, and then off to the nearest gate — the plan
                 has gone on without them. */
              detour: moves === 'travel' && rejoining ? { points: [], d: 0, then: 'exit', wait: true } : null,
              mats,
              meshes,
              faded: false,
              waited: 0,
              passing: false,
              blocked: 0,
              heading: at.facing,
              moving: false,
            };
            npcs.push(person);
            /* A traveller loaded ahead of walking in is drawn only once they
               have — the frame loop places and shows them. */
            if (moves === 'travel' && !rejoining) fadeTo(person, 0);
          })
          .catch((err) => {
            building.delete(npc.id);
            console.error(`open world: ${npc.id} failed to load`, err);
          });
    };

    /**
     * Who is in an area is a question with a time in it.
     *
     * Everybody placed is here whenever the area is; the one with a schedule
     * is here when the clock says so; and once the tournament is running the
     * travellers are wherever `travel.ts` has them — including, for twelve
     * seconds ahead, somebody about to walk in, so their model is down before
     * they reach the doorway. Asked on every door, and again every couple of
     * seconds by the frame loop below, which is what lets somebody walk in —
     * or leave — while you are standing in the room.
     */
    const presentNow = (id: AreaId): { npc: WorldNpc; at: Haunt; moves: 'route' | 'fixed' | 'travel' }[] => {
      const now = worldNow();
      const hour = hourFrom(now, pinned);
      const day = dayFrom(now, pinned, pinnedDay);
      const clock = travelClock(now, pinned, pinnedDay);
      const tour = tournamentRef.current;
      const phase = phaseOf(tour);
      const out: { npc: WorldNpc; at: Haunt; moves: 'route' | 'fixed' | 'travel' }[] = [];
      for (const npc of WORLD_NPCS) {
        /* Somebody mid-conversation is here whatever the clock says. A duel is
           a different page and the clock ran through it; the fiction on the
           way back is that you never stopped talking, so the person you were
           talking to is standing in front of you — see `rejoinRef` — and only
           leaves, like anyone on a schedule, once you have walked away. */
        const withMe = rejoinRef.current === npc.id || talkingRef.current?.id === npc.id;
        if (npc.arrives === 'tournament' && phase === 'before') continue;
        /* The finals: the three who went through wait in the forecourt. */
        if (phase === 'finals' && tour?.finals && isFinalist(tour, npc.id)) {
          const spot = FINALIST_SPOTS[tour.finals.finalists.indexOf(npc.id) - 1] ?? FINALIST_SPOTS[0];
          if (spot.area === id || withMe) out.push({ npc, at: { area: id, x: spot.x, z: spot.z, facing: spot.facing }, moves: 'fixed' });
          continue;
        }
        const traveller = phase !== 'before' ? TRAVELLER_BY_ID[npc.id] : undefined;
        if (traveller) {
          const st = travelState(npc.id, clock.day, clock.t);
          if (!st) continue;
          if (st.kind === 'home') {
            if (npc.area === id) out.push({ npc, at: { area: id, x: npc.x, z: npc.z, facing: npc.facing, roam: npc.roam }, moves: npc.roam ? 'route' : 'fixed' });
            else if (withMe) out.push({ npc, at: { area: id, x: npc.x, z: npc.z, facing: npc.facing }, moves: 'travel' });
            continue;
          }
          const inHere = (s: TravelState | null) => !!s && (s.kind === 'walking' || s.kind === 'waiting') && s.area === id;
          const soon = travelState(npc.id, clock.day, clock.t + 12);
          if (stayGone.has(npc.id)) {
            if (inHere(st) || inHere(soon)) continue;
            stayGone.delete(npc.id);
          }
          if (inHere(st) || inHere(soon) || withMe) {
            const p = st.kind === 'walking' || st.kind === 'waiting' ? st : null;
            out.push({ npc, at: { area: id, x: p?.x ?? npc.x, z: p?.z ?? npc.z, facing: st.kind === 'waiting' ? st.facing : 0 }, moves: 'travel' });
          }
          continue;
        }
        let at = whereabouts(npc, hour, day);
        if (withMe && npc.haunts && (!at || at.area !== id)) at = npc.haunts.find((h) => h.area === id) ?? at;
        if (at && at.area === id) out.push({ npc, at, moves: at.roam ? 'route' : 'fixed' });
      }
      return out;
    };

    const populate = (id: AreaId) => {
      for (const { rig: theirs } of npcs) {
        scene.remove(theirs.root);
        theirs.dispose();
      }
      npcs = [];
      stayGone.clear();
      const here = presentNow(id);
      /*
       * And the models nobody in this area is wearing are thrown away.
       *
       * A parsed model is cached for the life of the page, which for the booth
       * is right and for a city is a leak with a good reason: the *file* is ten
       * megabytes but the decoded texture is sixty-seven, so a page that has
       * walked through four areas is holding a quarter of a gigabyte of people
       * who are nowhere near it. Mike's phone was killed by that with the game
       * still on its main menu.
       *
       * Named rather than cleared: the player's own model is still standing,
       * and so is everybody about to be built here — a template disposed under
       * a live rig is a body with no geometry left to draw.
       */
      releaseTemplates([character.model, ...here.map(({ npc }) => npc.character.model)]);
      for (const { npc, at, moves } of here) arrive(npc, at, id, moves);
    };

    /**
     * Where every duelist in the tournament is, for the map — off the same
     * plan the frame loop walks them by, so the dot and the person agree.
     */
    marksRef.current = () => {
      const tour = tournamentRef.current;
      const phase = phaseOf(tour);
      if (phase === 'before' || !tour) return [];
      const clock = travelClock(worldNow(), pinned, pinnedDay);
      const out: DuelistMark[] = [];
      for (const npc of WORLD_NPCS) {
        const host = npc.id === 'kaiba';
        if (!host && !isEntrant(npc.id)) continue;
        const finalist = isFinalist(tour, npc.id);
        const chip = tour.chips.includes(npc.id);
        let place: { area: AreaId; x: number; z: number } | null = { area: npc.area, x: npc.x, z: npc.z };
        if (phase === 'finals' && finalist && tour.finals) {
          const spot = FINALIST_SPOTS[tour.finals.finalists.indexOf(npc.id) - 1] ?? FINALIST_SPOTS[0];
          place = { area: spot.area, x: spot.x, z: spot.z };
        } else if (TRAVELLER_BY_ID[npc.id]) {
          /* The live one, if they are in front of the player right now. */
          const live = npcs.find((n) => n.npc.id === npc.id && n.entered && areaRef.current === area.id);
          const st = travelState(npc.id, clock.day, clock.t);
          if (live) place = { area: area.id, x: live.at.x, z: live.at.z };
          else if (st?.kind === 'walking' || st?.kind === 'waiting') place = { area: st.area, x: st.x, z: st.z };
          else if (st?.kind === 'crossing') place = null;
        }
        if (place) out.push({ id: npc.id, name: npc.character.name, ...place, chip, finalist, host });
      }
      return out;
    };

    /* Now that both halves exist, open the area the save left us in. */
    enter(areaRef.current);

    /*
     * ---- the camera follows you ----
     *
     * There is nothing to drag. The camera swings in behind the way you are
     * walking, on its own, and you only ever walk — Mike's call, and the right
     * one on a phone, where a second thumb on the glass was a second thing to
     * do while the first one steered.
     *
     * Which means nobody can look up or down, so the resting shot has to hold
     * what matters without being asked: a shallower pitch than the old 0.28
     * and a higher point to look at, so the frame is the street ahead and the
     * fronts of the buildings on it rather than a third of pavement.
     */
    const CAM_PITCH = 0.2;
    let camYaw = here.current.facing + Math.PI;
    let camPitch = CAM_PITCH;
    /* Dev only (see the probe): a pitch held for a tool that needs the
       roofline, like `npm run corners`. A player has no way to set it. */
    let pitchHeld: number | null = null;

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
      /*
       * Taller on a phone held upright.
       *
       * 52° vertical is right on a landscape screen and a letterbox on a
       * portrait one: at a phone's aspect it is 25° across, so a follow camera
       * that nobody can turn by hand showed a corridor of street the width of
       * the duelist. Opening it towards 68° as the screen narrows gives back
       * the sides — and the sky and the pavement, which a camera that cannot
       * be tilted needs just as much.
       */
      camera.fov = w >= h ? 52 : 52 + (1 - w / h) * 30;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    /*
     * The governor: smooth beats sharp.
     *
     * A running average of the real frame time, and four levels of quality.
     * Three seconds over thirty frames a second steps down — fewer pixels,
     * then a smaller shadow map — and twelve seconds under fifty-five steps
     * back up. Frames nobody drew (a hidden tab, an area being built) are not
     * counted. `__probe.quality` says where it is, so `npm run linger` can
     * watch it act.
     */
    const RATIOS = [1, 0.85, 0.7, 0.55];
    const quality = { level: 0, ema: 1 / 60, since: performance.now(), frames: 0 };
    const applyQuality = () => {
      renderer.setPixelRatio(baseRatio * RATIOS[quality.level]);
      resize();
      setShadowQuality(quality.level);
    };
    const govern = (raw: number) => {
      /* A hidden tab hands back seconds; an area being built, a crossing.
         Neither is a frame anybody watched. A hitch of up to a second and a
         half is — counted, but capped, so one long frame cannot by itself
         drag the average over the line. */
      if (steady || raw > 1.5 || document.hidden || crossing !== null) return;
      quality.ema += (Math.min(raw, 0.1) - quality.ema) * 0.05;
      quality.frames++;
      const now = performance.now();
      if (quality.frames < 45 || now - quality.since < 3000) return;
      if (quality.ema > 1 / 30 && quality.level < 3) {
        quality.level++;
        applyQuality();
        quality.since = now; quality.frames = 0;
      } else if (quality.ema < 1 / 55 && quality.level > 0 && now - quality.since > 12000) {
        quality.level--;
        applyQuality();
        quality.since = now; quality.frames = 0;
      }
    };

    /* Seconds since the area was last asked who should be in it. */

    let presenceClock = 0;

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
    let whereAt = 0;
    let crossing: { door: Door; t: number; swapped: boolean; held: number } | null = null;
    /**
     * How long the sheet stays down after the swap, at least.
     *
     * Long enough to read the name of the place on it — and it stays down
     * past that for as long as the area's file takes to land, because the one
     * thing a door must never show is the duelist standing in a room that is
     * not there yet. A file already in the cache lands inside this.
     */
    const CARD_HOLD = 0.55;
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
    /* The floor under her feet, which is `groundY` without the ease. */
    let standing = groundY;
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
    /* And a pitch to hold, for `npm run corners`, which needs the roofline and
       used to get it the way a player did — by dragging, which is gone. Dev
       only: a player's camera is the follow camera and nothing else. */
    if (process.env.NODE_ENV !== 'production') {
      (window as unknown as { __look?: (pitch: number | null) => void }).__look = (pitch) => {
        pitchHeld = pitch;
      };
    }
    (window as unknown as { __teleport?: (x: number, z: number, facing: number) => void }).__teleport =
      (x, z, facing) => {
        here.current.x = x;
        here.current.z = z;
        here.current.facing = facing;
        heading = facing;
        camYaw = facing + Math.PI;
        /*
         * The floor here nearest the one she is on — which upstairs is
         * upstairs, and on the station's forecourt is the terrace.
         *
         * `standingOn` alone dropped her through an upper corridor, and
         * `groundAt` alone put her on nought where the only floor is a metre
         * and a fifth up with nothing under it: `npm run soak` teleports to
         * the plaza's door on the forecourt and stopped reaching the station.
         * `floorNear` is both answers in the right order.
         */
        groundY = floorNear(area, x, z, groundY);
      };
    /*
     * The map's way in: the same move a door makes, to anywhere in the city.
     *
     * Position first, `enter` second. `enter` budgets the lamps from where the
     * duelist is standing as the area opens — fourteen of them, chosen by
     * distance — so setting the position afterwards would light the fourteen
     * nearest wherever she *was*, and the shader key is the count rather than
     * the choice, so it would look wrong for a frame and cost nothing to get
     * right.
     *
     * `standingOn` rather than `floorNear`: arriving somewhere is the question
     * a spawn asks, not the one a step asks, and the height she was at in the
     * area she has just left means nothing here.
     */
    warpRef.current = (to, x, z) => {
      here.current.x = x;
      here.current.z = z;
      if (to !== areaRef.current) enter(to);
      const fixed = settle(area, x, z, PLAYER_RADIUS);
      here.current.x = fixed.x;
      here.current.z = fixed.z;
      groundY = standingOn(area, fixed.x, fixed.z);
      /* Facing kept, camera put back behind it: arriving looking at the back
         of your own head is what an unturned camera gives you. */
      heading = here.current.facing;
      camYaw = here.current.facing + Math.PI;
      camPitch = CAM_PITCH;
      crossing = null;
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

    /**
     * The nearest way out of the area on foot, for a traveller who has just
     * finished talking to you after a duel and whose plan has gone on without
     * them. A found path, not a straight line: the conversation may have
     * happened with a counter between them and the door.
     */
    const nearestExit = (from: { x: number; z: number; y: number }): NavPoint[] | null => {
      const exits = area.doors
        .map((door) => ({ door, mouth: nodeAt(area.id, `g:${door.id}`) }))
        .filter((e): e is { door: Door; mouth: NavPoint } => !!e.mouth)
        .sort((a, b) => Math.hypot(a.mouth.x - from.x, a.mouth.z - from.z) - Math.hypot(b.mouth.x - from.x, b.mouth.z - from.z));
      for (const { door, mouth } of exits) {
        const avoid = area.doors.filter((d) => d.id !== door.id).map((d) => d.trigger);
        const found = findPath(area, from, from.y, mouth, { band: bandOf(area), budget: 15000, avoid });
        if (found) return found.points;
      }
      return null;
    };

    /** How late somebody is if they set off now on the plan's walk from `node`. */
    const lagFrom = (id: string, clock: { day: number; t: number }, node: string): number => {
      let from: number | null = null;
      for (const seg of planFor(clock.day)[id] ?? []) {
        if (seg.t0 > clock.t) break;
        if (seg.kind === 'walk' && seg.from === node) from = seg.t0;
      }
      return from === null ? 0 : Math.max(0, clock.t - from);
    };

    /**
     * One frame of a traveller.
     *
     * The plan says where they are at `clock - lag`. Noticed by the player —
     * stopped to be talked to — they stand, and the lag grows by the time they
     * stood; at their next stop they make it up, standing a little less. In a
     * doorway they fade, in over the first metre and a quarter of a walk that
     * starts at a gate and out over the last of one that ends at one, and a
     * walk that ends at a gate ends them: out of sight, the clock is the truth.
     * Home again at night, they go back to pacing the route they paced before
     * the tournament, from its first point, which is where the day's last
     * walk left them.
     */
    const stepTraveller = (
      them: (typeof npcs)[number],
      dt: number,
      noticed: boolean,
      clock: { day: number; t: number }
    ): 'gone' | { speed: number; heading: number | null } => {
      const { npc, at, rig: theirs } = them;
      const speedOf = TRAVELLER_BY_ID[npc.id]?.speed ?? 1.5;
      const place = (x: number, z: number) => {
        at.x = x;
        at.z = z;
        /* The first place they appear is an arrival — the floor a landing
           stands on — and every step after it a step, from the floor they
           are on, so a flight is climbed rather than guessed at. */
        at.y = them.entered ? groundAt(area, x, z, at.y) : standingOn(area, x, z);
        theirs.root.position.set(x, at.y, z);
      };
      if (them.detour) {
        const det = them.detour;
        if (det.wait) {
          if (talkingRef.current?.id === npc.id || rejoinRef.current === npc.id) return { speed: 0, heading: null };
          const out = nearestExit(at);
          if (!out) {
            /* Nowhere to walk to from here: they stay put, and are gone
               the next time the area is built. */
            them.detour = null;
            them.moves = 'fixed';
            return { speed: 0, heading: null };
          }
          them.detour = { points: out, d: 0, then: 'exit' };
          return { speed: 0, heading: null };
        }
        if (noticed) return { speed: 0, heading: null };
        const len = pathLength(det.points);
        det.d = Math.min(len, det.d + speedOf * dt);
        const q = alongPath(det.points, det.d);
        place(q.x, q.z);
        if (det.then === 'exit') {
          const left = len - det.d;
          fadeTo(them, Math.max(0, Math.min(1, left / FADE_METRES)));
          if (left <= 0.02) {
            stayGone.add(npc.id);
            return 'gone';
          }
        } else if (det.d >= len - 1e-6) {
          them.detour = null;
          them.lag = det.resumeAt !== undefined ? Math.max(0, clock.t - det.resumeAt) : lagFrom(npc.id, clock, `h:${npc.id}`);
        }
        return { speed: len > 0.05 ? speedOf : 0, heading: q.heading };
      }
      if (noticed) {
        if (pinned === null) them.lag += dt;
        them.moving = false;
        return { speed: 0, heading: null };
      }
      const st = travelState(npc.id, clock.day, clock.t - them.lag);
      if (!st) return 'gone';
      if ((st.kind === 'waiting' || st.kind === 'walking') && st.area === area.id) {
        place(st.x, st.z);
        if (st.kind === 'waiting') {
          them.moving = false;
          them.facing = st.facing;
          if (them.lag > 0) them.lag = Math.max(0, them.lag - dt * 2);
          them.entered = true;
          if (them.shown < 1) fadeTo(them, 1);
          return { speed: 0, heading: null };
        }
        /*
         * Somebody in the way. The player, stood on the line they are
         * walking; or another traveller going the same way just ahead of
         * them, whom they fall in behind rather than walk into. Held up by
         * the player for more than a moment, they step round — a found path
         * with the player walled off, back on to their own leg a few metres
         * on.
         */
        if (them.entered) {
          const ax = at.x + Math.sin(st.heading) * 0.9;
          const az = at.z + Math.cos(st.heading) * 0.9;
          const player = here.current;
          const playerAhead = Math.hypot(player.x - ax, player.z - az) < 0.85;
          const queued = npcs.some((o) => o !== them && o.shown > 0.5 && o.moving
            && Math.cos(o.heading - st.heading) > 0.3 && Math.hypot(o.at.x - ax, o.at.z - az) < 0.95);
          if (playerAhead || queued) {
            if (pinned === null) them.lag += dt;
            them.blocked += dt;
            them.moving = false;
            them.heading = st.heading;
            if (playerAhead && them.blocked > 1.2) {
              const leg = legBetween(area.id, st.from, st.to);
              const seg = segmentAt(planFor(clock.day)[npc.id] ?? [], clock.t - them.lag);
              if (leg && seg.kind === 'walk') {
                const onward = Math.min(st.len, st.d + 3);
                const to = alongPath(leg.points, onward);
                const avoid = [
                  { x: player.x, z: player.z, hw: 0.7, hd: 0.7 },
                  ...area.doors.filter((dd) => `g:${dd.id}` !== st.to && `g:${dd.id}` !== st.from).map((dd) => dd.trigger),
                ];
                const round = findPath(area, at, at.y, to, { band: bandOf(area), budget: 3000, avoid });
                if (round) {
                  them.detour = { points: round.points, d: 0, then: 'plan', resumeAt: seg.t0 + onward / seg.speed };
                  them.blocked = 0;
                }
              }
            }
            return { speed: 0, heading: st.heading };
          }
          them.blocked = 0;
        }
        let shown = 1;
        if (st.from.startsWith('g:')) shown = Math.min(shown, st.d / FADE_METRES);
        if (st.to.startsWith('g:')) shown = Math.min(shown, (st.len - st.d) / FADE_METRES);
        shown = Math.max(0, Math.min(1, shown));
        if (!them.entered && shown > 0) them.entered = true;
        if (them.entered && Math.abs(shown - them.shown) > 1e-3) fadeTo(them, shown);
        if (them.entered && st.to.startsWith('g:') && st.len - st.d <= 0.02) return 'gone';
        them.heading = st.heading;
        them.moving = pinned === null;
        return { speed: pinned === null ? st.speed : 0, heading: st.heading };
      }
      if (st.kind === 'home' && npc.area === area.id) {
        them.moves = npc.roam ? 'route' : 'fixed';
        them.route = npc.roam;
        them.leg = 1;
        them.dir = 1;
        them.hold = 0;
        them.facing = npc.facing;
        them.entered = true;
        fadeTo(them, 1);
        return { speed: 0, heading: null };
      }
      if (them.entered) return 'gone';
      if (performance.now() - them.born > 25000) return 'gone';
      return { speed: 0, heading: null };
    };

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
      const raw = clock.getDelta();
      govern(raw);
      const dt = Math.min(raw, 0.05);

      /* The sky, before anything is drawn under it. */
      const hour = hourFrom(worldNow(), pinned);
      const sky = skyAt(hour);
      VOID.set(sky.voidColour);
      if (scene.fog instanceof THREE.Fog) {
        /*
         * The fog's colour as well as its distances.
         *
         * `new THREE.Fog(VOID, …)` *copies* the colour it is handed — the
         * background keeps the reference and follows the hour, the fog kept a
         * black from the first frame and never moved off it. Nothing showed it
         * while the biggest area was under a roof: in an open square a hundred
         * and thirty metres across, the far range and the whole skyline behind
         * it faded to black under a blue afternoon sky.
         */
        scene.fog.color.copy(VOID);
        scene.fog.near = sky.fogNear;
        scene.fog.far = sky.fogFar;
      }
      renderer.toneMappingExposure = sky.exposure;
      built?.setTime?.(hour);

      /*
       * And the nearest `LAMP_BUDGET` of them are the ones that are on.
       *
       * Every fourth frame, because the answer changes at walking pace and
       * fifty-odd square roots is not something to do sixty times a second for
       * a list that has not moved. Measured from the duelist and not from the
       * camera: the camera is four and a half metres behind her and the lamp
       * she is standing under is the one that has to be lit.
       */
      if ((lampTick++ & 3) === 0) budgetLamps(here.current.x, groundY + 1, here.current.z);

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
        /*
         * On their floor — the floor, not the height she is drawn at.
         *
         * `settle`'s `atY` means "which floor the duelist is on", and this was
         * handing it `groundY`, which is the *eased* height the rig is drawn
         * at. On the flat they are the same number. On a flight they are not,
         * and the difference is a stutter you can feel:
         *
         * `settle` treats a platform more than a stride above `atY` as the
         * face of a step and pushes you out of it. An exponential ease
         * approaches the tread it is climbing to but never arrives, so the
         * tread three ahead stayed "more than a stride up" for as long as the
         * ease was converging — she walked a third of a metre, was pinned
         * against a tread she was about to stand on, waited for `groundY` to
         * close the last millimetres, took another step, and stopped again.
         * Simulated at sixty frames a second up the school's west tower,
         * *eighty-two per cent* of frames made no progress. Told the floor
         * instead: none of them.
         *
         * Descending never showed it, because everything below you is skipped
         * by the same test — which is exactly what Mike reported: "walking up
         * the stairs stops and goes, walking down is ok".
         *
         * And only the school's towers showed it, because only they rise two
         * hundred millimetres against a four-hundred stride: the tread two
         * above sits exactly on the boundary, so the *third* is the blocker
         * and there is no slack left for the ease to eat. Every other flight
         * in the city rises 180 or 360 and never met it — measured, all nine
         * of them climb in the same number of frames before and after this.
         * The same coincidence that made these two unclimbable at all.
         *
         * The *higher* of the two, and that is not a hedge. Going up, the ease
         * lags below the floor and the unlagged answer is the higher one, which
         * is the fix. Going down, the ease lags *above* it — and handing the
         * lower number there makes more platforms count as walls than did
         * before, which is a change nobody asked for: it put four doors out of
         * reach and sent `npm run soak` through the wrong one on the first lap.
         * Taking the higher can only ever remove a wall, never add one, so
         * climbing is fixed and descending is left exactly as it was.
         */
        const fixed = settle(area, p.x, p.z, PLAYER_RADIUS, Math.max(groundY, standing));
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
        for (const { npc, at, shown } of npcs) {
          /* Somebody still walking in out of a doorway, or loaded ahead of
             arriving, is not somebody you can bump into yet. */
          if (shown < 0.5) continue;
          /* A spirit has no body to be pushed out of, which is the property
             that lets one walk down the middle of an avenue: a *moving*
             cylinder is one that can shove you off a terrace or corner you
             against a wall, and this one passes through you instead. */
          if (npc.spirit) continue;
          /* And a body on the gallery over your head is not in your way. */
          if (Math.abs(groundY - at.y) > 1.5) continue;
          const dx = p.x - at.x;
          const dz = p.z - at.z;
          const d = Math.hypot(dx, dz);
          if (d < NPC_RADIUS && d > 1e-4) {
            p.x = at.x + (dx / d) * NPC_RADIUS;
            p.z = at.z + (dz / d) * NPC_RADIUS;
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
          if (door) crossing = { door, t: 0, swapped: false, held: 0 };
        }
      }

      /* `groundY` is where the duelist already is, and that is what tells a
         building with storeys in it which floor they are on: without it,
         walking under a gallery puts them on top of it. See `groundAt`. */
      const wantY = groundAt(areaById(areaRef.current), p.x, p.z, groundY);
      /* And what she is standing on, for the next frame's `settle` — the
         answer without the ease on it. See above. */
      standing = wantY;
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

      /* Where she is, four times a second rather than sixty — React does not
         need to hear about a tenth of a metre. Only while it is asked for. */
      if (showWhereRef.current && performance.now() - whereAt > 250) {
        whereAt = performance.now();
        const deg = Math.round(((p.facing * 180) / Math.PI + 360)) % 360;
        setWhere(`${areaRef.current}  x ${p.x.toFixed(1)}  z ${p.z.toFixed(1)}  y ${groundY.toFixed(2)}  facing ${deg}°`);
      }

      /**
       * Everybody else: standing, and looking at you when you are close.
       *
       * The turn is the whole of "this person has noticed me" and it costs a
       * lerp. Eased rather than snapped, over the shortest arc, and released
       * back to their own facing when you leave — a character who tracks you
       * across the field like a turret is worse than one who never moves.
       */
      /*
       * Arrivals and departures, on the clock.
       *
       * Every two seconds — not every frame — the area is asked who should be
       * in it, and the answer is compared with who is. Somebody due here and
       * not built is built where their haunt puts them; somebody built and no
       * longer due leaves. Not while they are being looked at: a person who
       * vanishes in front of you, or mid-sentence, is a bug however correct
       * the clock is, so a departure waits until the player is well outside
       * the range that turns them to face you, and until the conversation is
       * over. Ash is the only one this ever moves, and he leaves the way he
       * came — when nobody is watching.
       */
      /* The tournament moved on — the broadcast played, or the finals were
         set — and the people of this area are not the people who were here. */
      if (repopulate.current) {
        repopulate.current = false;
        populate(area.id);
      }
      const clockNow = travelClock(worldNow(), pinned, pinnedDay);
      presenceClock += dt;
      if (presenceClock > 1) {
        presenceClock = 0;
        const due = presentNow(area.id);
        for (const { npc, at, moves } of due) arrive(npc, at, area.id, moves);
        for (const them of [...npcs]) {
          if (!them.npc.schedule) continue;
          if (due.some((d) => d.npc.id === them.npc.id)) continue;
          if (talkingRef.current?.id === them.npc.id) continue;
          if (Math.hypot(p.x - them.at.x, p.z - them.at.z) < them.npc.range * 2.5) continue;
          depart(them.npc.id);
        }
        /*
         * Morning, for somebody at home in front of you: the plan has them out
         * of the door. They walk back to where their day begins — the first
         * point of the route they pace, which is where the plan's first walk
         * starts — and set off from there, a few seconds late.
         */
        if (phaseRef.current !== 'before') {
          for (const them of npcs) {
            if (them.moves === 'travel' || !TRAVELLER_BY_ID[them.npc.id]) continue;
            if (isFinalist(tournamentRef.current, them.npc.id)) continue;
            if (talkingRef.current?.id === them.npc.id) continue;
            const st = travelState(them.npc.id, clockNow.day, clockNow.t);
            if (!st || st.kind === 'home') continue;
            const anchor = { x: them.npc.x, z: them.npc.z };
            const back = Math.hypot(anchor.x - them.at.x, anchor.z - them.at.z) < 0.05
              ? { points: [anchor, anchor] }
              : findPath(area, them.at, them.at.y, anchor, { band: bandOf(area), budget: 8000 }) ?? { points: [{ x: them.at.x, z: them.at.z }, anchor] };
            them.moves = 'travel';
            them.route = undefined;
            them.entered = true;
            let from = clockNow.t;
            for (const seg of planFor(clockNow.day)[them.npc.id] ?? []) {
              if (seg.t0 > clockNow.t) break;
              if (seg.kind === 'walk' && seg.from === `h:${them.npc.id}`) from = seg.t0;
            }
            them.detour = { points: back.points, d: 0, then: 'plan', resumeAt: from };
          }
        }
      }

      let closest: WorldNpc | null = null;
      let closestD = Infinity;
      /**
       * Where the person you are talking to actually is.
       *
       * The camera below needs it, and it must be this and not `npc.x` — a
       * record is where somebody *starts*. Tina's is the west end of the
       * arcade, so the two-shot swung round to look at a patch of pavement
       * twenty metres from the conversation it was framing.
       */
      let talkAt: { x: number; z: number } | null = null;
      for (const them of [...npcs]) {
        const { npc, rig: theirs, at } = them;
        const dx = p.x - at.x;
        const dz = p.z - at.z;
        /* Three dimensions, not two. Ash on the Crown's first gallery stopped
           and turned for a player standing on the shop floor under him —
           five metres away as the plan reads it, and a storey apart — and the
           prompt offered a conversation with somebody over your head. On the
           flat the height is nought and nothing changes. */
        const d = Math.hypot(dx, dz, groundY - at.y);
        /**
         * Noticed a little before the talk range, so they are already looking
         * at you by the time the prompt appears — and for as long as the
         * conversation lasts, whatever the distance.
         *
         * The conversation is the part that was missing. Coming back from a
         * duel resumes the talk, and a roamer resumed it by walking off down
         * the arcade while her own words were still on screen: `range * 1.6`
         * is a *proximity* test and the player had been away for a duel. Being
         * spoken to holds somebody still as surely as being stood next to.
         */
        const toMe = talkingRef.current?.id === npc.id;
        let noticed = toMe || (d < npc.range * 1.6 && them.shown > 0.9);
        /*
         * A traveller has somewhere to be.
         *
         * They stop and look at a player who comes near, the way anybody
         * noticed on a street does — and if the player says nothing for five
         * seconds they walk on, and do not stop for that player again until
         * the two of them have been apart. Standing in the middle of the
         * arcade used to stop every passer-by in the city where they were,
         * two of them in one place, for as long as the player stood there.
         * Being spoken to is different: that holds them for the whole
         * conversation, however long.
         */
        if (them.moves === 'travel' && !toMe) {
          if (them.passing) {
            if (d > npc.range * 2.2) them.passing = false;
            else noticed = false;
          } else if (noticed) {
            them.waited += dt;
            if (them.waited > 5) {
              them.passing = true;
              them.waited = 0;
              noticed = false;
            }
          } else {
            them.waited = 0;
          }
        }
        if (toMe) talkAt = at;
        /*
         * Walking a route, when there is one and nobody is standing in front
         * of them.
         *
         * Stopping when noticed is the whole of what makes a roamer talkable:
         * the prompt appears at `range` and they stop at `range * 1.6`, so by
         * the time you can speak to them they have been still for a step and
         * a half. Without it you would be reading a conversation panel while
         * its owner walked out of range of it.
         */
        let speed = 0;
        /* A traveller's own heading, when the plan is walking them. */
        let travelHeading: number | null = null;
        if (them.moves === 'travel') {
          const step = stepTraveller(them, dt, noticed, clockNow);
          if (step === 'gone') {
            depart(npc.id);
            continue;
          }
          speed = step.speed;
          travelHeading = step.heading;
        } else if (them.route && !noticed) {
          const route = them.route;
          if (them.hold > 0) {
            them.hold -= dt;
          } else if (them.rest <= 0) {
            /*
             * Stopping for no reason, which is the reason.
             *
             * A route on its own is a patrol — two end points, the same pause
             * at each, and the eye has the whole loop inside ten seconds.
             * Halting part way along a leg to stretch or look up the arcade is
             * what turns a patrol into somebody waiting, and it is deliberately
             * *not* tied to the path: the stop happens wherever she happens to
             * be when the clock runs out.
             *
             * The pause lasts exactly as long as the clip, because a stretch
             * cut off half way by the route moving on is worse than no stretch
             * at all — `gesture` hands back the length for this. A character
             * with no such clip stands for a moment instead, which is still
             * better than a body that only ever stops at two marks.
             */
            const pick = route.gestures?.length
              ? route.gestures[Math.floor(Math.random() * route.gestures.length)]
              : null;
            const played = pick ? theirs.gesture(pick) : 0;
            them.hold = played > 0 ? played : route.dwell * 0.6;
            them.rest = (route.restEvery ?? Infinity) * (0.5 + Math.random());
          } else {
            const to = route.path[them.leg];
            const tx = to.x - at.x;
            const tz = to.z - at.z;
            const left = Math.hypot(tx, tz);
            const step = route.speed * dt;
            if (left <= step || left < 1e-4) {
              at.x = to.x;
              at.z = to.z;
              /* There and back: turn round at either end rather than jumping
                 to the far one, which would be a walk through everything in
                 between. */
              const next = them.leg + them.dir;
              const turning = next < 0 || next >= route.path.length;
              if (turning) {
                them.dir = them.dir === 1 ? -1 : 1;
                them.leg = them.leg + them.dir;
              } else {
                them.leg = next;
              }
              /**
               * A pause where the route turns round, and nowhere else.
               *
               * The dwell used to be charged at *every* point, which on a path
               * bent through the middle of an arcade to stop it being a sentry
               * beat meant a stop in the middle of a straight walk for no
               * reason anybody could see — three and a half seconds of standing
               * every ten metres, and Mike's word for it was "few steps stop
               * few steps stop". A point in the middle of a path is a corner;
               * only the ends are somewhere to arrive at.
               *
               * The turn is also a natural place to look back down the way you
               * came, so some of them carry a gesture. Held for the longer of
               * the dwell and the clip, so neither is cut.
               */
              if (turning) {
                them.hold = route.dwell;
                if (route.gestures?.length && Math.random() < 0.22) {
                  const pick = route.gestures[Math.floor(Math.random() * route.gestures.length)];
                  them.hold = Math.max(them.hold, theirs.gesture(pick));
                }
              }
            } else {
              at.x += (tx / left) * step;
              at.z += (tz / left) * step;
              speed = route.speed;
              /* Ticked by walking rather than by the clock: somebody held up
                 talking to the player has not been strolling, and should not
                 come out of the conversation owing a stretch. */
              them.rest -= dt;
            }
          }
          theirs.root.position.x = at.x;
          theirs.root.position.z = at.z;
          /* Asked every step, so a route may climb stairs without the route
             knowing there are any — and asked from the floor they are on, so
             a route under a gallery stays under it. The rig's own breath and
             step-rise are measured from whatever height it is given. */
          at.y = groundAt(area, at.x, at.z, at.y);
          theirs.root.position.y = at.y;
        }
        /* Facing: at you when noticed, along the route while walking, and
           their own way when they are standing at the end of one. */
        const to = them.route?.path[them.leg];
        const heading = speed > 0 && to
          ? Math.atan2(to.x - at.x, to.z - at.z)
          : them.facing;
        const want = noticed ? Math.atan2(dx, dz) : travelHeading ?? heading;
        let turn = want - theirs.root.rotation.y;
        turn = Math.atan2(Math.sin(turn), Math.cos(turn));
        theirs.root.rotation.y += turn * Math.min(1, dt * 3.2);
        /* Their legs, on the same scale the player's are read on — see
           `npcGait`. The real ground speed goes with it, because that is what
           the clip's playback rate comes off. */
        theirs.update(dt, npcGait(speed), speed);
        if (d < npc.range && d < closestD && them.shown > 0.9) {
          closest = npc;
          closestD = d;
        }
      }
      /**
       * You turn to face them, the way they turn to face you.
       *
       * Both halves of a conversation were never both true: they pivot towards
       * whoever walks up, and the player stayed pointing whichever way they
       * happened to arrive — so half the conversations in the game were held
       * over a shoulder, with the camera dutifully framing the back of a head
       * talking to a profile.
       *
       * Eased at the same rate they use, over the shortest arc, and written to
       * `facing` rather than to the rig: `facing` is what the rig reads, what
       * the save records and what the camera's own heading comes off, so
       * turning the person turns all three and the panel closes with the player
       * still looking at the person they were talking to.
       */
      if (talkAt) {
        let d = Math.atan2(talkAt.x - p.x, talkAt.z - p.z) - p.facing;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        p.facing += d * Math.min(1, dt * 3.6);
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
          if (card.current) card.current.textContent = areaById(door.to).name;
          enter(door.to);
          p.x = to.x;
          p.z = to.z;
          p.facing = to.facing;
          heading = to.facing;
          /* Put the camera behind the arrival heading, so you step out of a door
             looking where you are going rather than at the door you just used. */
          camYaw = to.facing + Math.PI;
          camPitch = CAM_PITCH;
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
        if (crossing.swapped && crossing.t > 1) {
          crossing.held += dt;
          if (!areaReady || crossing.held < CARD_HOLD) crossing.t = 1;
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
      /* Head height rather than chest: with nobody able to tilt the camera up,
         aiming a little higher is what keeps the buildings in the shot. */
      let lookY = groundY + 1.35;
      let dist = 4.6;
      if (talkBlend > 0.001 && near) {
        /* Behind the duelist (`+ π`) and a third of a radian to the side —
           enough to clear their head, little enough that the person they are
           talking to stays inside the lens. */
        /* Where they *are*, which for a roamer is not where their record says.
           `talkAt` is carried out of the loop above for this. Read as two
           numbers rather than an object, because this is sixty times a second
           and the only thing worse than a wrong camera is a camera that
           allocates. */
        const themX = talkAt ? talkAt.x : near.x;
        const themZ = talkAt ? talkAt.z : near.z;
        const axis = Math.atan2(themX - p.x, themZ - p.z);
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
        /**
         * Half way, and further back: a conversation is a two-shot.
         *
         * It used to look all the way at the speaker from 2.9 m — the subject
         * dead centre, the player shoved to the edge or out of frame, and
         * because the camera comes *in* as it swings, the whole move read as a
         * zoom onto a spot slightly ahead of you rather than as the shot
         * changing. Aiming at the ground between the two and standing a little
         * further off puts both of them in the picture, which is the thing the
         * camera is being asked to say: these two are talking to each other.
         */
        lookX = p.x + (themX - p.x) * 0.5 * talkBlend;
        lookZ = p.z + (themZ - p.z) * 0.5 * talkBlend;
        /* Their heads, and above the panel that covers the bottom third. Off the
           ground they are standing on, not off zero — see the camera below. */
        lookY = groundY + 1.35 - 0.1 * talkBlend;
        /* Enough room for two people and the metre and a half between them.
           Held off the *player*, so the gap the pair needs comes out of the
           distance rather than out of the framing. */
        dist = 4.6 - 0.9 * talkBlend;
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
      /**
       * Behind the way you are walking — eased, and only while you walk.
       *
       * The camera turns towards `heading + π` at a rate that scales with how
       * fast the legs are going, so a stroll swings it gently and a stop leaves
       * it exactly where it is: standing still is when you look at something,
       * and a camera that drifted then would take it away.
       *
       * Except when you walk *at* it. Pushing the stick towards yourself means
       * "come back this way", and a camera that answered by racing round
       * through a hundred and eighty degrees would spin the world every time
       * somebody backed up a step. So the follow fades out between 110° and
       * 160° off straight-ahead: walk towards the lens and it holds and backs
       * off in front of you; turn aside and it comes round behind again.
       *
       * The stick is read in the camera's frame (above), so a held direction
       * off the straight becomes a turn that the camera follows — hold left and
       * you walk a circle, which is steering, which is what a stick is for.
       *
       * And the turn has a ceiling. An ease on its own is proportional to the
       * gap, and holding the stick sideways keeps the gap at ninety degrees for
       * ever — which spun the camera at nearly four radians a second and walked
       * her round a circle a metre across. Capped at 1.3 rad/s it is a steady
       * swing: a quarter turn in a little over a second, and at full speed a
       * circle five metres wide.
       */
      if (!near && stride > 0.05) {
        let off = heading - (camYaw + Math.PI);
        off = Math.abs(Math.atan2(Math.sin(off), Math.cos(off)));
        const follow = off <= 1.92 ? 1 : off >= 2.8 ? 0 : (2.8 - off) / 0.88;
        let d = heading + Math.PI - camYaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        camYaw += Math.max(-1.3, Math.min(1.3, d * 1.8)) * stride * follow * dt;
        camYaw = Math.atan2(Math.sin(camYaw), Math.cos(camYaw));
      }
      /* Back to the resting pitch once a conversation is over — it is the only
         thing that ever moves it. */
      if (!near) camPitch += ((pitchHeld ?? CAM_PITCH) - camPitch) * Math.min(1, dt * 2);

      const want = area.kind === 'interior' ? dist * 0.72 : dist;
      let reach = cameraReach(
        area, p.x, p.z,
        Math.sin(camYaw) * Math.cos(camPitch),
        Math.cos(camYaw) * Math.cos(camPitch),
        want
      );
      /**
       * And off the walls, while you walk.
       *
       * Pulled in and lifted (below) is the answer when a wall is in the way;
       * leaning off it is the better one when it can be had. When the camera is
       * squeezed it looks half a radian either side, and drifts towards the side
       * with more room — so walking along a wall, or turning with your back to a
       * shopfront, the shot slides round to the open side instead of pressing
       * its lens into the brick. Only while walking, for the same reason the
       * follow is: a camera that moves by itself when you are standing still is
       * a camera you are fighting.
       */
      if (!near && stride > 0.05 && reach < want * 0.9) {
        const side = 0.5;
        const around = (yaw: number) =>
          cameraReach(area, p.x, p.z, Math.sin(yaw) * Math.cos(camPitch), Math.cos(yaw) * Math.cos(camPitch), want);
        const lean = (around(camYaw + side) - around(camYaw - side)) / want;
        if (Math.abs(lean) > 0.12) {
          camYaw += lean * side * Math.min(1, dt * 1.8);
          reach = cameraReach(area, p.x, p.z, Math.sin(camYaw) * Math.cos(camPitch), Math.cos(camYaw) * Math.cos(camPitch), want);
        }
      }
      /**
       * And round the posts.
       *
       * A lamp post is too thin to pull the camera in for — the lens would lurch
       * forward every time you walked past one, which is the bench problem the
       * `tall` flag exists to avoid — and it is exactly thin enough to stand on
       * the line between the lens and you and hide you completely. With a hand
       * on the camera that was one flick; with nobody's hand on it, it is a
       * post you are standing behind until you walk off. So a thin solid on the
       * line of sight turns the camera the other way, a little at a time, until
       * the line is clear — standing still too, since it only ever moves as far
       * as it takes to see you.
       */
      if (!near) {
        const ax = Math.sin(camYaw) * camDist;
        const az = Math.cos(camYaw) * camDist;
        const len2 = ax * ax + az * az;
        for (const post of area.solids) {
          if (post.tall || post.hw > 0.6 || post.hd > 0.6) continue;
          const rx = post.x - p.x;
          const rz = post.z - p.z;
          const t = (rx * ax + rz * az) / len2;
          if (t < 0.12 || t > 1) continue;
          const side = ax * rz - az * rx;
          const gap = Math.abs(side) / Math.sqrt(len2) - Math.max(post.hw, post.hd);
          if (gap > 0.3) continue;
          /* The post is to one side of the line; swing the lens the same way
             round the player as the cross product says the post is not. Worked
             through once with a post at (0.2, 2) and the camera up +Z: `side`
             is negative, the lens must go to −X, and yaw falling is that. */
          camYaw += Math.sign(side || 1) * Math.min(1, dt * 2.2) * 0.35 * (1 - Math.max(0, gap) / 0.3);
          break;
        }
      }

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
      /*
       * Asked from the camera's own height, not the duelist's.
       *
       * From the duelist's floor, anything more than a stride above them is a
       * wall and not a floor — which is right for *them* and wrong for a camera
       * standing four metres behind on higher ground. Walking down the shrine's
       * great flight towards the street gate, the camera trailed over the
       * precinct two metres above her feet, the precinct did not count as
       * floor, and the shot was taken from inside it: a frame of solid grey.
       *
       * From its own height the terrace under it is a floor and it rides up
       * onto it. A gallery three and a half metres over the duelist's head is
       * still nothing to a camera at one and a half, which is what the old
       * comment was protecting.
       */
      /*
       * And not just from its own height: from a metre above it. At the foot
       * of the shrine's great flight the duelist is on the ground and the
       * camera, four metres behind, is over the precinct — a floor sixty
       * centimetres *above the lens*. Asked from the lens that floor is a wall.
       * Asked from a metre up it is a floor, and the camera rides onto it.
       *
       * Anything more than eighty centimetres over the lens is overhead — a
       * gallery, a ceiling — and is left to the duelist's own answer, or the
       * camera would climb through every gallery it walked under.
       */
      /*
       * And under the *line* from the lens to the duelist, not the lens alone.
       *
       * Standing on a flight and looking up, the camera drops behind you into
       * the risers: the tread under it is clear, the next tread up — between it
       * and you — is in its face, and the frame is stone from an inch away.
       * Sampled a third and two thirds of the way along as well, the highest
       * step between the two of you is what the camera rides.
       */
      let underCamera = -Infinity;
      for (const t of [0, 0.35, 0.7]) {
        const sx = camPos.x + (p.x - camPos.x) * t;
        const sz = camPos.z + (p.z - camPos.z) * t;
        const nearby = groundAt(area, sx, sz, camPos.y + 1);
        const g = nearby <= camPos.y + 0.8 ? nearby : groundAt(area, sx, sz, groundY);
        if (g > underCamera) underCamera = g;
      }
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
          /* The hour the sky and the travellers are reading. */
          hour: +hour.toFixed(3),
          /* The tournament's travellers standing here, and what they are doing. */
          travellers: npcs.filter((n) => n.moves === 'travel').map((n) => ({ id: n.npc.id, x: +n.at.x.toFixed(2), z: +n.at.z.toFixed(2), y: +n.at.y.toFixed(2), shown: +n.shown.toFixed(2), lag: +n.lag.toFixed(1), passing: n.passing, visible: n.rig.root.visible, entered: n.entered })),
          people: npcs.map((n) => n.npc.id),
          /* People still on their way down the wire — a check that means to
             photograph the world without them waits for this to reach nought. */
          loading: building.size,
          /* The height the duelist is actually drawn at, which is the eased one
             and not `groundAt` — `npm run stairs` compares the two. */
          y: +groundY.toFixed(3),
          cam: [+camera.position.x.toFixed(2), +camera.position.y.toFixed(2), +camera.position.z.toFixed(2)],
          camDist: +camDist.toFixed(2), camLift: +camLift.toFixed(2), camYaw: +camYaw.toFixed(3),
          near: nearRef.current?.id ?? null,
          lights: scene.children.length,
          built: built ? built.root.children.length : 0,
          /* False while an area built in Blender is still arriving. */
          ready: areaReady,
          quality: { level: quality.level, ratio: +renderer.getPixelRatio().toFixed(2), ms: +(quality.ema * 1000).toFixed(1) },
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
      >
        {/* The name of the place you are walking into, while nothing else can
            be seen. The sheet's opacity carries it in and out. */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <span className="text-[11px] tracking-[0.42em] text-amber-100/55 uppercase">Domino City</span>
          <span ref={card} className="font-serif text-2xl tracking-[0.22em] text-amber-100/90 uppercase" />
          <span className="mt-1 h-px w-24 bg-amber-100/30" />
        </div>
      </div>

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

      {/* the corner button, and the sheet it brings down */}
      <div
        className="absolute right-0 top-0 z-30 p-3"
        style={{ paddingTop: 'calc(var(--safe-top) + 12px)', paddingRight: 'calc(var(--safe-right) + 12px)' }}
      >
        <button
          className="btn flex items-center gap-2 rounded px-3 py-2 text-[11px]"
          onClick={() => {
            sfx.click();
            /* Read off the ref as the menu opens: what it says on the plaque
               is where she was when you pressed it. */
            setMenuPlace(areaById(areaRef.current).name);
            setMenuOpen((o) => !o);
          }}
          aria-expanded={menuOpen}
          aria-label="Menu"
        >
          <span aria-hidden className="flex flex-col gap-[3px]">
            <span className="block h-px w-3.5 bg-current" />
            <span className="block h-px w-3.5 bg-current" />
            <span className="block h-px w-3.5 bg-current" />
          </span>
          Menu
        </button>
      </div>

      {/* The chips, in the corner opposite the menu, for as long as the
          tournament runs. A tap opens the table. */}
      {phase !== 'before' && profile.tournament && (
        <div
          className="absolute left-0 top-0 z-30 p-3"
          style={{ paddingTop: 'calc(var(--safe-top) + 12px)', paddingLeft: 'calc(var(--safe-left) + 12px)' }}
        >
          <button
            data-chips={chipsHeld}
            className="btn flex items-center gap-1.5 rounded px-3 py-2 text-[11px]"
            onClick={() => {
              sfx.click();
              setBoardOpen(true);
            }}
            aria-label={`Star chips: ${chipsHeld} of ${CHIPS_TO_FINALS}. Open the tournament table`}
          >
            <span className="text-brassbright">★</span>
            {phase === 'finals' ? 'Finals' : `${chipsHeld} / ${CHIPS_TO_FINALS}`}
          </button>
        </div>
      )}

      {chipNote && (
        <div className="pointer-events-none absolute left-1/2 top-16 z-40 animate-[chipnote_4.2s_ease-out_forwards]" style={{ marginTop: 'var(--safe-top)' }}>
          <p data-chip-note className="whitespace-nowrap rounded border border-brassdim bg-black/80 px-4 py-2 font-display text-[13px] text-brassbright">
            ★ {chipNote}
          </p>
        </div>
      )}

      {boardOpen && profile.tournament && (
        <TournamentBoard tournament={profile.tournament} playerName={character.name} names={names} onClose={() => setBoardOpen(false)} />
      )}

      {finalsDue && profile.tournament && !talkingTo && !hold && quiet && !broadcast && (
        <FinalsCard
          tournament={profile.tournament}
          playerName={character.name}
          names={names}
          onClose={() => onFinalsSeen?.()}
        />
      )}

      {broadcast && (
        <Cutscene
          onDone={() => {
            setBroadcast(false);
            void onTournamentStart?.();
          }}
        />
      )}

      {menuOpen && (
        <StoryMenu
          name={character.name}
          level={profile.level}
          money={profile.money ?? 0}
          place={menuPlace}
          saving={saving}
          where={showWhere}
          onWhere={(on) => {
            setShowWhere(on);
            if (!on) setWhere('');
            try { window.localStorage.setItem('story-where', on ? '1' : '0'); } catch { /* ignore */ }
          }}
          onEditDeck={onEditDeck}
          tournament={phase !== 'before' ? (phase === 'finals' ? 'The finals are set' : `${chipsHeld} of ${CHIPS_TO_FINALS} star chips`) : undefined}
          onTournament={() => {
            setMenuOpen(false);
            setBoardOpen(true);
          }}
          onMap={() => {
            /* Read off the refs at the moment it opens, not subscribed to:
               the duelist's position changes sixty times a second and the map
               only needs to know where she was when you asked for it. */
            setMapAt({ area: areaRef.current, x: here.current.x, z: here.current.z });
            setMenuOpen(false);
            setMapOpen(true);
          }}
          onSave={() => void save()}
          onExit={() => {
            /* The way out writes where you were standing. Leaving by the
               menu used to write nothing, so coming back in put you at the
               last save rather than at the door you left by. */
            void persist().then(onExit);
          }}
          onDelete={() => {
            setMenuOpen(false);
            setAskingDelete('warn');
          }}
          onClose={() => setMenuOpen(false)}
        />
      )}

      {mapOpen && mapAt && (
        <WorldMap
          at={mapAt}
          duelists={marks}
          onGo={(to, x, z) => {
            sfx.click();
            warpRef.current?.(to, x, z);
            setMapOpen(false);
          }}
          onClose={() => {
            sfx.click();
            setMapOpen(false);
          }}
        />
      )}

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
            className="btn btn-primary flex items-center gap-2 rounded-full px-5 py-2 text-[11px]"
            onClick={() => {
              sfx.click();
              setTalkingTo(nearNpc);
            }}
          >
            <span className="text-[9px] tracking-[0.2em] text-parchment/70">Talk to</span>
            <span className="font-display text-[12px] tracking-[0.1em]">{nearNpc.character.name}</span>
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

      {showWhere && !talkingTo && where && (
        <p
          data-where-readout
          className="pointer-events-none absolute bottom-0 right-0 select-text rounded border border-amber-200/20 bg-black/40 px-2 py-1 font-mono text-[10px] leading-none text-amber-200/80"
          style={{ marginBottom: 'calc(var(--safe-bottom) + 44px)', marginRight: 'calc(var(--safe-right) + 16px)', textShadow: '0 1px 3px rgba(0,0,0,0.9)' }}
        >
          {where}
        </p>
      )}


      {talkingTo && !hold && (
        <Conversation
          npc={talkingTo}
          /* Where the conversation starts, in priority order: the node a duel
             sent it back to, then whichever of theirs fits who the player is
             by now — see `openingNode`. */
          openAt={resumeAt ?? openingNode(talkingTo, met.has(talkingTo.id), profile.collection.length, profile.tournament)}
          /* So a wager can be answered in her own voice instead of by a dead
             button — see the panel's `money`. The save is the figure; the
             server is still the decision. */
          money={profile.money ?? 0}
          ceiling={talkingTo.duel ? ceilingFor(talkingTo.duel.opponentId, profile.purse) : undefined}
          /* What could be put on the table, and which of it is sleeved — the
             picker marks a deck card, because losing one costs a rebuild. */
          collection={profile.collection}
          deck={profile.deck ?? []}
          /*
           * What the lines may name besides the player.
           *
           * `cards` and `left` are the tournament: how many the player is
           * carrying and how many more the hall wants. Filled for every
           * conversation rather than for the ones that ask, because the only
           * alternative is each script knowing whether it is allowed to
           * mention the thing everybody in the city is talking about.
           *
           * `card` is the one a duel was played for, off the note the duel
           * came back with; nothing else knows it.
           */
          fill={{
            cards: profile.collection.length,
            left: cardsLeft(profile.collection.length),
            chips: chipsHeld,
            ...(wageredCard ? { card: CARDS[wageredCard]?.name ?? wageredCard } : {}),
          }}
          onShop={() => onShop?.(talkingTo)}
          onDuel={(stake, wager) => {
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
              onDuel?.(talkingTo, stake, wager);
            })();
          }}
          playerName={character.name}
          onClose={() => {
            /* Introduced. From here on they open on their short node, and the
               save is told so it survives the page — see `onMet`. */
            if (!met.has(talkingTo.id)) {
              setMet((was) => new Set(was).add(talkingTo.id));
              onMet?.(talkingTo.id);
            }
            setTalkingTo(null);
            setResumeAt(null);
            setWageredCard(null);
          }}
        />
      )}
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Generated assets                                                    */
/* ------------------------------------------------------------------ */


