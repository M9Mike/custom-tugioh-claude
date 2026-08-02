'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import GameCard, { statTint } from './GameCard';
import { previewInstances } from './deckPreview';
import CardDetail from './CardDetail';
import { CARDS, DUELIST_BY_ID, DUELISTS, artUrl, baseAtk, baseDef } from '@/game/cards';
import {
  canActivateFromHand,
  canActivateSetCard,
  canAttackWith,
  canChangePosition,
  canIgnite,
  effAtk,
  effDef,
  effFlags,
  fusionOptions,
  legalAttackTargets,
  maxAttacks,
  monstersFrozen,
  other,
  summonBlocked,
  tributesRequired,
} from '@/game/engine';
import { effectLabel, summonTargetSpec, targetSpecFor, type TargetSpec } from '@/game/ui';
import { getSfxEnabled, primeAudio, setSfxEnabled, sfx } from '@/lib/sfx';
import type { AnimEvent, CardInstance, DuelAction, DuelState, PlayerId } from '@/game/types';
import type { RoomView } from '@/server/rooms';

/** How long a signature card's moment runs. Must match the `sig-*` keyframes. */
const SIG_MS = 1400;
/**
 * The least time a beat that says something stays on screen.
 *
 * Measured rather than guessed: at 800ms the line was legible for 200–540ms
 * once the fade in and out were accounted for, which is not long enough to read
 * a sentence on a phone. With the animation holding full opacity across 86% of
 * its run, this leaves a shade under a second of actual reading.
 *
 * The band's fade is driven from `fxHold` inline, not from `.declare`, so it
 * already matches whatever the beat is actually held for — this floor and the
 * stylesheet cannot drift apart. The CSS duration is a fallback and is kept at
 * the same number for the case where the inline style is missing.
 */
const MIN_SPOKEN_MS = 1100;

/** A pointer that can genuinely hover: a mouse or a trackpad, never a finger. */
const HOVER_QUERY = '(hover: hover) and (pointer: fine)';

/**
 * Life Points still waiting to be shown, per player.
 *
 * The board state is current the moment the server replies, but the animations
 * that explain it are still queued — so the total dropped before the attack
 * that took it landed, and the number gave the result away. Adding back what
 * has not been played yet holds the displayed total until its own moment, and
 * it converges on its own: when the queue is empty there is nothing to add.
 */
/**
 * Life Points the server has already taken but the board has not yet said a
 * word about, added back so the total never runs ahead of the blow.
 *
 * `applied`, not `amount`: they differ exactly once per duel, on the blow that
 * ends it. A 1900 attack into 1200 Life Points is announced as 1900 and can
 * only ever move the bar by 1200 — adding 1900 back to a total already sitting
 * at zero showed 1900, so the bar jumped up to the attacker's ATK and counted
 * down from a number the player had never had. Reported as exactly that.
 */
function pendingLpIn(queue: AnimEvent[]): Record<PlayerId, number> {
  const out: Record<PlayerId, number> = { p1: 0, p2: 0 };
  for (const a of queue) {
    if (!a.player) continue;
    if (a.kind === 'damage') out[a.player] += a.applied ?? a.amount ?? 0;
    else if (a.kind === 'heal') out[a.player] -= a.amount ?? 0;
  }
  return out;
}

type Mode =
  | { kind: 'idle' }
  | { kind: 'hand'; uid: string }
  | { kind: 'tributes'; uid: string; need: number; picked: string[]; position: 'atk' | 'def'; face: 'up' | 'down' }
  | {
      kind: 'target';
      source: 'spell' | 'ignition' | 'setcard' | 'trap' | 'summon';
      uid: string;
      spec: TargetSpec;
      picked: string[];
      /** Pending summon that resolves once targets are chosen. */
      summon?: { position: 'atk' | 'def'; face: 'up' | 'down'; tributes: string[] };
    }
  | { kind: 'attack'; uid: string }
  /** Action sheet for one of your own monsters on the field. */
  | { kind: 'monster'; uid: string };

interface Props {
  view: RoomView;
  act: (a: DuelAction) => Promise<string | null>;
  rematch: () => void;
  toLobby: () => void;
  connection: string;
  /** Present during a tournament: return to the bracket. */
  onBracket?: () => void;
  /** Tells the room whether the board is still narrating, so the computer's
      next action waits for the current one to finish being announced. */
  setAnimating?: (busy: boolean) => void;
}

/* The board is sized from the space actually left after the fixed chrome, so
   the field fills a desktop screen instead of floating in a sea of empty. */
const BOARD_CARD = 'w-[var(--cw)]';
const SIDE_CARD = 'w-[var(--sw)]';
const HAND_CARD = 'w-[var(--hw)]';

/**
 * A duelist's name, portrait, Life Points and counts.
 *
 * Declared here rather than inside `Duel` on purpose. A component defined in
 * the render body is a new function identity every render, which React reads as
 * a different component type — so it unmounted and remounted this whole subtree
 * on every single render. The bar below carries a 500ms width transition, and a
 * node that mounts already at its final width has nothing to transition *from*,
 * so the Life Points snapped instead of sliding. Everything the queue does to
 * pace damage was landing on a bar that jumped anyway.
 */
function PlayerBar({
  player,
  duelist,
  isActive,
  isAi,
  shownLp,
  onGrave,
}: {
  player: DuelState['players'][PlayerId];
  duelist: (typeof DUELISTS)[number] | undefined;
  isActive: boolean;
  isAi: boolean;
  shownLp: number;
  onGrave: () => void;
}) {
  const lpPct = Math.max(0, Math.min(100, (shownLp / 4000) * 100));
  return (
    <div className={`panel grain relative flex items-center gap-2 rounded px-2 py-1.5 ${isActive ? 'ring-1 ring-brass' : ''}`}>
      <div
        className="h-8 w-8 shrink-0 overflow-hidden rounded-full border"
        style={{ borderColor: duelist?.accent ?? '#8a723d' }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={artUrl(duelist?.emblem ?? '')} alt="" className="h-full w-full object-cover" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-display text-[13px] text-parchment">
            {player.name}
            {isAi && (
              <span className="ml-1 align-middle text-[9px] uppercase tracking-wider text-brass">
                CPU
              </span>
            )}
          </span>
          <span className="font-display text-sm tabular-nums text-brassbright">{shownLp}</span>
        </div>
        <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-black/60">
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{
              width: `${lpPct}%`,
              background:
                lpPct > 50
                  ? 'linear-gradient(90deg,#7a9a52,#c2a15a)'
                  : lpPct > 22
                    ? 'linear-gradient(90deg,#c2a15a,#d2673a)'
                    : 'linear-gradient(90deg,#d2673a,#93313a)',
            }}
          />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 font-display text-[10px] text-ptextdim">
        <span title="Cards in hand">✋{player.hand.length}</span>
        <span title="Cards left in Deck">🂠{player.deck.length}</span>
        <button className="btn rounded px-1 py-0.5 text-[9px]" onClick={onGrave} title="View Graveyard">
          ⚰{player.grave.length}
        </button>
      </div>
    </div>
  );
}

export default function Duel({ view, act, rematch, toLobby, connection, onBracket, setAnimating }: Props) {
  const state = view.state!;
  const me = view.you;
  const foe = other(me);
  const mine = state.players[me];
  const theirs = state.players[foe];

  const [mode, setMode] = useState<Mode>({ kind: 'idle' });
  const [inspect, setInspect] = useState<CardInstance | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /* Two refusals in quick succession used to race: the first one's timer fired
     mid-way through the second's stay and took it down early. Each timer may
     only clear the toast it was set for — checked against the message itself,
     so no ref is read anywhere render can see. */
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2600);
  }, []);
  /* The cry banner is gone. It printed the card's flavour line in the middle
     while the declaration named the same card just below — Crush Card Virus,
     whose cry is "Crush Card!", read as the name twice over. One line now,
     in the middle, saying who did what. */
  const [shakeOn, setShakeOn] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [graveOpen, setGraveOpen] = useState<PlayerId | null>(null);
  /* The Graveyard viewer carries its own inspector. The board's one only opens
     on hover, which a phone never sends, so a card in here could not be read at
     all on the devices this is built for. */
  const [graveInspect, setGraveInspect] = useState<CardInstance | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  const [leaving, setLeaving] = useState(false);
  const seenAnims = useRef<Set<string>>(new Set());
  /** The event the board is reacting to right now, and the queue behind it. */
  const [fx, setFx] = useState<AnimEvent | null>(null);
  /* How long the current event is being held for. The declaration band takes
     its fade from this rather than a fixed second, or it vanished halfway
     through the longer events — a trap, or a signature card's moment — leaving
     the card on screen with nothing saying whose move it was. */
  const [fxHold, setFxHold] = useState(900);
  const [hit, setHit] = useState<{ id: string; who: PlayerId; amount: number; kind: 'damage' | 'heal' } | null>(null);
  /**
   * Beats whose moment has already been given. Everything else in `state.anims`
   * has happened on the server but not yet on screen, and the board is drawn as
   * though it has not happened at all.
   *
   * A ref, and read during render rather than kept in state: the server's state
   * arrives one commit before any effect can react to it, and in that commit
   * the board would show the new Life Points and the new monster before the
   * queue had said a word — which is exactly the flash of the final total, and
   * the monster appearing before its own summon animation.
   */
  const [playedAnims, setPlayedAnims] = useState<ReadonlySet<string>>(() => new Set());
  /** Remembers a beat as announced, bounded so a long duel cannot grow it. */
  const markPlayed = useCallback((id: string) => {
    setPlayedAnims((prev) => {
      const next = new Set(prev);
      next.add(id);
      if (next.size > 400) return new Set([...next].slice(-200));
      return next;
    });
  }, []);
  /** True once the queue has finished, so the win screen can wait for it. */
  const [settled, setSettled] = useState(true);
  /** True when the queue has gone quiet without finishing — see `narrating`. */
  const [stalled, setStalled] = useState(false);
  /** Forces the win screen up when the ending stalls — see the backstop below. */
  const [forceWin, setForceWin] = useState(false);
  /** When the last beat landed; both watchdogs measure silence from here. */
  const lastBeatAt = useRef(0);
  /** Which winner the victory sting has already played for. */
  const sungFor = useRef<string | null>(null);
  const fxQueue = useRef<AnimEvent[]>([]);
  const drainingRef = useRef(false);
  /** False until the first view has been absorbed without playing it. */
  const primedAnims = useRef(false);
  /* Everything the server has done that the board has not yet announced. */
  const unspoken = useMemo(
    () => state.anims.filter((a) => !playedAnims.has(a.id)),
    [state.anims, playedAnims]
  );
  /** Life Points whose beat has not played — held back so the total never
      moves before the blow that caused it. */
  const pending = useMemo(() => pendingLpIn(unspoken), [unspoken]);
  /**
   * Monsters that are on the server's board but whose arrival has not been
   * announced. They are drawn as an empty zone until their beat plays, so a
   * signature card's flourish happens *before* it lands rather than over a
   * monster that is already standing there.
   */
  const unannounced = useMemo(() => {
    const out = new Set<string>();
    for (const a of unspoken) {
      if ((a.kind === 'summon' || a.kind === 'fusion') && a.uid) out.add(a.uid);
    }
    return out;
  }, [unspoken]);
  const fxTimer = useRef<number | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const handRef = useRef<HTMLDivElement>(null);
  const [handOverflow, setHandOverflow] = useState(false);

  useEffect(() => {
    primeAudio();
    setSoundOn(getSfxEnabled());
  }, []);

  // Cards are sized so an opening hand of five fits; past that the strip
  // scrolls, and the edge fade is the only thing that says so.
  useEffect(() => {
    const el = handRef.current;
    if (!el) return;
    const check = () => setHandOverflow(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
    // No initial call: observing fires the callback once by itself.
    const ro = new ResizeObserver(check);
    ro.observe(el);
    el.addEventListener('scroll', check, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', check);
    };
  }, [mine.hand.length]);

  // Keep the phone awake while a duel is in progress — turns can be long and
  // nobody wants the screen dying mid-thought. Safari re-releases the lock when
  // the tab is backgrounded, so it is re-requested on return.
  useEffect(() => {
    type WakeLockSentinel = { release: () => Promise<void> };
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinel> } };
    if (!nav.wakeLock) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        const s = await nav.wakeLock!.request('screen');
        if (cancelled) void s.release();
        else sentinel = s;
      } catch {
        /* denied or unsupported — not worth telling the player about */
      }
    };
    void acquire();
    const onVisible = () => {
      if (!document.hidden) void acquire();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release().catch(() => {});
    };
  }, []);

  const myTurn = state.active === me && !state.winner;
  const respondingToTrap = state.pending?.player === me;
  /**
   * Everything except the thing being asked for is out of bounds.
   *
   * A window the *opponent* owes an answer to has always locked the board. A
   * half-finished interaction of your own did not, and Ring of Destruction made
   * that plain: activating it opens "choose a card to destroy", and with the
   * prompt still on screen you could summon a monster, and then end your turn —
   * leaving the trap mid-resolution. Picking a target, paying tributes and
   * choosing what to attack are all the same shape: a question on screen, and
   * nothing else to be done until it is answered or cancelled.
   */
  const choosing = mode.kind === 'target' || mode.kind === 'tributes' || mode.kind === 'attack';
  /**
   * And nothing at all while the board is still saying what just happened.
   *
   * Every beat is held long enough to read, and until now that was only true of
   * what the *computer* did — your own turn ran ahead of its own narration, so
   * you could summon, attack and end the turn with three declarations still
   * queued behind you, and they went past in a rush belonging to nobody. The
   * board finishes its sentence first, in both seats.
   *
   * `stalled` is the way out: if a beat somehow never lands, input comes back
   * rather than the duel becoming unplayable. Same shape as the win screen's
   * backstop, and for the same reason — silence is the failure, not slowness.
   */
  const narrating = !settled && !stalled;
  const busy = (!!state.pending && !respondingToTrap) || choosing || narrating;

  /* ---------------- the resolve queue ----------------
     Every animation the server reported used to be played in one burst, so a
     whole turn landed in a single frame: the board simply snapped to its final
     state, which is what made it feel like a spreadsheet rather than a duel.
     Events are now played one at a time, each held long enough to read.

     The engine already reports them in the order things actually happen, so a
     combo arrives as a chain of beats: the Flute is declared, then the dragon
     arrives, then the dragon's own effect is declared, then whatever it
     destroys. Each beat has to be given its moment or they run together and
     the dragon appears to come out of nowhere.

     It is purely cosmetic — the board state is already current, so input stays
     live throughout and nothing waits on the queue. */
  const FX_MS: Record<string, number> = {
    draw: 130,
    phase: 200,
    heal: 700,
    destroy: 520,
    damage: 620,
    flip: 560,
    // A monster arriving is a beat of its own, not a step on the way to one.
    summon: 780,
    // Long enough to read the declaration that goes with them.
    attack: 950,
    directAttack: 950,
    activate: 1050,
    trap: 1200,
    fusion: 1200,
    win: 0,
  };

  /**
   * What to announce for an event, before its consequences play.
   *
   * The engine emits these in the order things actually happen — the activate
   * comes before the ops it runs, the attack before the damage — so playing the
   * queue in order gives "I activate Ring of Destruction" and only then the
   * board reacting to it, which is what makes a chain readable rather than a
   * result that has already happened.
   */
  /* A duelist's signature card gets a moment. Only these ten, and only when
     they attack or go off — otherwise the game would be all cutscene. */
  const SIGNATURE = useMemo(
    // Exodia is nobody's emblem and wins from the hand rather than the field,
    // so it never qualified — the five pieces came together and the victory
    // modal simply appeared, with no moment at all for the one card in the game
    // that ends a duel outright.
    () => new Set([...DUELISTS.map((d) => d.emblem), 'exodia-the-forbidden-one']),
    []
  );
  const isSignature = (a: AnimEvent | null): boolean => {
    if (!a || !a.slug) return false;
    // A Fusion Summon is rare, costs three cards, and is the most spectacular
    // thing in the game — it earns the flourish whoever is holding it, not
    // only when the result happens to be a duelist's emblem.
    if (a.kind === 'fusion') return true;
    if (!SIGNATURE.has(a.slug)) return false;
    return (
      a.kind === 'attack' ||
      a.kind === 'directAttack' ||
      a.kind === 'activate' ||
      a.kind === 'trap' ||
      a.kind === 'win'
    );
  };

  /**
   * `form: 'actor'` reads "Kaiba activates Dark Hole"; `form: 'card'` reads
   * "Blue-Eyes White Dragon's effect activates" — a monster already on the
   * field going off is not the same sentence as a Spell being played, and
   * "Kaiba activates Blue-Eyes White Dragon" while the dragon stands there is
   * nonsense.
   */
  const declare = (
    a: AnimEvent
  ): { verb: string; name: string; slug: string; who: PlayerId; form: 'actor' | 'card' } | null => {
    if (!a.slug || !a.player) return null;
    // `as` when the beat is not about the card its art comes from — a Kuriboh
    // Token wears Kuriboh's face and is not Kuriboh, and announcing it as such
    // meant a second body arrived carrying the first one's line.
    const name = a.as ?? CARDS[a.slug]?.name ?? a.slug;
    const actor = { name, slug: a.slug, who: a.player, form: 'actor' as const };
    switch (a.kind) {
      case 'activate':
        return CARDS[a.slug]?.kind === 'monster'
          ? { ...actor, form: 'card', verb: "'s effect activates" }
          : { ...actor, verb: 'activates' };
      case 'summon':
        // The arrival is its own beat: without it a monster fetched by a Spell
        // simply appeared, with nothing saying where it had come from.
        return { ...actor, verb: 'summons' };
      case 'trap':
        return { ...actor, verb: 'springs' };
      case 'fusion':
        return { ...actor, verb: 'fusion summons' };
      case 'attack':
        return { ...actor, verb: `attacks ${a.text ?? ''} with`.replace('  ', ' ') };
      case 'directAttack':
        return { ...actor, verb: 'attacks directly with' };
      case 'win':
        // Only Exodia carries a slug here, and "assembles" is the line that
        // belongs to it — the five pieces coming together, not a card played.
        return { ...actor, verb: 'assembles' };
      default:
        return null;
    }
  };

  /**
   * What the board says for the beat currently resolving.
   *
   * A card-shaped declaration when there is one, and otherwise the log line the
   * engine paired with this beat. Nothing the duel records should have to be
   * read out of the log afterwards — the log is a memory aid, not the place a
   * player goes to find out what just happened.
   */
  const spoken = (a: AnimEvent | null): { text: string; slug?: string; who?: PlayerId } | null => {
    if (!a) return null;
    const d = declare(a);
    if (d) {
      const actor = state.players[d.who].name;
      return {
        text: d.form === 'actor' ? `${actor} ${d.verb} ${d.name}` : `${d.name}${d.verb}`,
        slug: d.slug,
        who: d.who,
      };
    }
    if (a.note) return { text: a.note, slug: a.slug, who: a.player };
    return null;
  };

  /**
   * A backstop for the vignette's own `onAnimationEnd`, which is what normally
   * retires a hit. Under `prefers-reduced-motion` the animation is `none`, so
   * that event never fires — the first blow of the duel left the vignette on
   * screen for good and, because the win screen waits on `!hit`, pushed every
   * ending onto the three-second stall backstop. Guarded by id, so a fresh hit
   * is never cleared by the timer of the one it replaced.
   */
  const clearHitLater = useCallback((id: string) => {
    window.setTimeout(() => setHit((h) => (h?.id === id ? null : h)), 1600);
  }, []);

  const playOne = useCallback((a: AnimEvent) => {
    switch (a.kind) {
        case 'draw':
          sfx.draw();
          break;
        case 'summon': {
          const big = a.slug ? (CARDS[a.slug]?.atk ?? 0) >= 2400 : false;
          if (big) sfx.bigSummon();
          else sfx.summon();
          break;
        }
        case 'fusion':
          sfx.bigSummon();
          break;
        case 'attack':
          sfx.attack();
          break;
        case 'directAttack':
          sfx.impact();
          break;
        case 'destroy':
          sfx.destroy();
          break;
        case 'flip':
          sfx.flip();
          break;
        case 'activate':
          sfx.spell();
          break;
        case 'trap':
          sfx.trap();
          break;
        case 'phase':
          sfx.phase();
          break;
        case 'damage':
          sfx.damage();
          // No small floating number: the struck player gets the big one below.
          setHit({ id: a.id, who: a.player ?? me, amount: a.amount ?? 0, kind: 'damage' });
          setShakeOn(true);
          window.setTimeout(() => setShakeOn(false), 520);
          clearHitLater(a.id);
          break;
        case 'heal':
          sfx.heal();
          // The same big centred number as damage, in green. Gaining Life
          // Points was the one swing still reported by a small line of drifting
          // text, which read as an afterthought next to losing them.
          setHit({ id: a.id, who: a.player ?? me, amount: a.amount ?? 0, kind: 'heal' });
          clearHitLater(a.id);
          break;
        case 'win':
          // Exodia arrives with a slug and gets the full flourish; an ordinary
          // win is silent here, because the victory screen has its own fanfare.
          if (a.slug) sfx.bigSummon();
          break;
      }
  }, [me, clearHitLater]);

  /* Drains the queue one event at a time. `fx` is what the board is currently
     reacting to; the cards read it to decide whether they lunge, recoil, turn
     over or drop in. */
  const lastVersionRef = useRef(-1);
  useEffect(() => {
    /* A rematch is a brand-new duel delivered into the same mounted board.
       Nothing remounts — the room stays on this component — so every piece of
       animation bookkeeping kept in a ref or state survived into the next duel,
       and all of it was wrong there:

       - The new duel's version restarts, so its beat ids (`a1_0`, `a2_0`…)
         collide with the *old* duel's earliest ids, which were still in
         `seenAnims` and `playedAnims` — the opening beats of every second duel
         were silently skipped as already played.
       - `forceWin` stayed true from the previous ending, so the next duel's win
         screen and fanfare fired the instant `state.winner` arrived, over the
         blow that was still being announced — the exact "nothing waits" bug,
         reintroduced by every rematch.
       - `sungFor` kept the old winner, so if the same seat won again the
         victory sting never played at all.
       - A tail still draining from the old duel would have mixed its beats
         into the new one's.

       The duel's own version only ever climbs while a duel is alive, and the
       transport now refuses stale views, so version going *backwards* means
       exactly one thing: a different duel is on the board. Reset everything,
       including `primedAnims` — the new duel's opening tail is history to
       swallow, the same as walking into any duel fresh. */
    if (state.version < lastVersionRef.current) {
      if (fxTimer.current) window.clearTimeout(fxTimer.current);
      fxQueue.current = [];
      drainingRef.current = false;
      seenAnims.current = new Set();
      primedAnims.current = false;
      sungFor.current = null;
      lastBeatAt.current = performance.now();
      setFx(null);
      setHit(null);
      setSettled(true);
      setStalled(false);
      setForceWin(false);
      setAnimating?.(false);
    }
    lastVersionRef.current = state.version;

    /* The server now keeps a short tail of past events so a client that missed
       a version still receives them. On the *first* view that tail is history,
       not news — replaying it would open a duel by re-enacting the last dozen
       beats, and reloading mid-duel would do it again. */
    if (!primedAnims.current) {
      primedAnims.current = true;
      for (const a of state.anims) seenAnims.current.add(a.id);
      setPlayedAnims(new Set(state.anims.map((a) => a.id)));
      return;
    }
    const fresh = state.anims.filter((a) => !seenAnims.current.has(a.id));
    if (!fresh.length) return;
    for (const a of fresh) seenAnims.current.add(a.id);
    if (seenAnims.current.size > 400) seenAnims.current = new Set([...seenAnims.current].slice(-200));
    fxQueue.current.push(...fresh);

    if (drainingRef.current) return;
    drainingRef.current = true;
    setSettled(false);
    setStalled(false);
    setAnimating?.(true);

    const step = () => {
      const next = fxQueue.current.shift();
      if (!next) {
        drainingRef.current = false;
        setFx(null);
        setSettled(true);
        setAnimating?.(false);
        return;
      }
      setFx(next);
      /* Announced now: the Life Points may move, and the monster may appear.
         Marking it here rather than when the hold ends is deliberate — this is
         the moment the beat is on screen, so the board should agree with it. */
      markPlayed(next.id);
      lastBeatAt.current = performance.now();
      playOne(next);
      const signature = isSignature(next);
      /* A backlog is the computer's whole turn arriving at once. Rather than
         make the player sit through it, the queue compresses — down to a third
         of the time once a dozen events are waiting. */
      const backlog = fxQueue.current.length;
      /* A signature moment is never compressed. It is one event out of a whole
         turn, and the animation is written for its full run — cut to a third it
         stops mid-rush, which looks like a bug rather than a flourish.

         Everything else compresses only gently, and only when a genuinely long
         line is waiting. The point of the queue is that a turn reads as a
         sequence; racing through it to save four seconds throws away the very
         thing it exists for, and a combo becomes a blur again. */
      const scale = signature ? 1 : backlog > 18 ? 0.62 : backlog > 10 ? 0.8 : 1;
      const base = signature ? SIG_MS : (FX_MS[next.kind] ?? 300);
      /* An event that puts a line on screen has to stay long enough to read it.
         The computer plays a whole turn in one breath, so its backlog is always
         long and compression used to squeeze the declarations down to a blur —
         the summon, the fusion and the attack all announced themselves and none
         of them could be read. Silent beats still compress freely; the ones
         that speak have a floor. */
      const speaks = spoken(next) !== null;
      const hold = Math.max(speaks ? MIN_SPOKEN_MS : 70, base * scale);
      setFxHold(hold);
      fxTimer.current = window.setTimeout(step, hold);
    };
    step();
    /* Deliberately no cleanup here. This effect re-runs on every state update —
       and the client polls — so clearing the timer here killed the drain on the
       first poll after an action. `draining` stayed true, nothing restarted it,
       and every animation after the first one silently never played. The timer
       is cleared on unmount instead, below. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.version]);

  useEffect(
    () => () => {
      if (fxTimer.current) window.clearTimeout(fxTimer.current);
      // Leaving mid-drain must not strand the computer waiting for a board
      // that is no longer on screen.
      setAnimating?.(false);
    },
    [setAnimating]
  );


  /* A backstop, because "the duel is over but nothing says so" is a far worse
     failure than a win screen arriving over the tail of an animation.
     
     It watches for a *stall* rather than counting down from the moment the duel
     ended. A fixed eight seconds was fine when beats were brief, and became a
     guillotine once each one held for over a second: the turn that killed you
     is the longest chain in the duel — summon, summon, battle, attack, damage,
     attack, damage — and the timer cut it off partway, which is why the end of
     a losing duel was the part nobody could follow. As long as beats keep
     arriving the tail plays out in full; three seconds of silence means
     something really is stuck. */

  /* Input waits for the narration, so the narration must never be able to wait
     for ever. A beat that does not land inside four seconds is not a beat, it
     is a bug — and a bug that locks the player out of their own duel is far
     worse than one that lets them play over the tail of an animation. Reset
     whenever the drain starts again, so a slow turn never trips it twice.

     Unlocking the input is not enough on its own. The first version of this
     left the dead drain standing: `drainingRef` stayed true, so every beat any
     later version delivered was queued behind a chain that would never run —
     the board fell silent for the rest of the duel — and `setAnimating(true)`
     was never taken back, so in a vs-computer duel the nudge held forever and
     the AI simply stopped playing. A stall ends the drain the same way a
     finished queue does, and the beats it strands are marked played so the
     Life Point holds they were carrying let go rather than pinning the bar to
     a stale total for good. */
  useEffect(() => {
    if (settled) return;
    const t = window.setInterval(() => {
      if (performance.now() - lastBeatAt.current <= 4000) return;
      setStalled(true);
      if (fxTimer.current) window.clearTimeout(fxTimer.current);
      const stranded = fxQueue.current;
      fxQueue.current = [];
      drainingRef.current = false;
      if (stranded.length) {
        setPlayedAnims((prev) => {
          const next = new Set(prev);
          for (const a of stranded) next.add(a.id);
          return next;
        });
      }
      setFx(null);
      setSettled(true);
      setAnimating?.(false);
    }, 500);
    return () => window.clearInterval(t);
  }, [settled, setAnimating]);
  useEffect(() => {
    if (!state.winner) return;
    const t = window.setInterval(() => {
      if (performance.now() - lastBeatAt.current < 3000) return;
      setSettled(true);
      setForceWin(true);
    }, 500);
    return () => window.clearInterval(t);
  }, [state.winner]);

  /* The victory sting belongs to the win screen, not to the server message that
     the duel is over — those are seconds apart. `state.winner` arrives one
     commit before the queue has said a word, so the fanfare used to play over
     the attack that was still being announced: you heard you had lost, and then
     watched the blow that did it. It waits for the same moment the modal does. */
  const winScreenUp = !!state.winner && (forceWin || (settled && !hit));
  useEffect(() => {
    if (!winScreenUp || !state.winner || sungFor.current === state.winner) return;
    sungFor.current = state.winner;
    if (state.winner === me) sfx.win();
    else if (state.winner !== 'draw') sfx.lose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winScreenUp, state.winner]);

  useEffect(() => {
    if (showLog && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [showLog, state.version]);

  /* ---------------- action plumbing ---------------- */
  const run = useCallback(
    async (a: DuelAction) => {
      setMode({ kind: 'idle' });
      const err = await act(a);
      if (err) {
        sfx.error();
        showToast(err);
      }
    },
    [act, showToast]
  );

  useEffect(() => {
    // Any state change from the server invalidates a half-built interaction —
    // the cards it referred to may already be gone.
    setMode({ kind: 'idle' });
    setInspect(null);
  }, [state.version]);

  /* ---------------- derived helpers ---------------- */
  /**
   * Whether this device can hover at all.
   *
   * `pointerType === 'mouse'` was supposed to keep the preview off phones, and
   * it does not hold: iOS synthesises mouse events after a tap on anything that
   * has `:hover` styling — which the hand cards do, they lift. So a tap on a
   * card in hand could open the card inspector instead of its action sheet, and
   * because the inspector is a modal with a full-screen scrim, the next tap
   * went into the scrim rather than the card. It looked exactly like the board
   * had stopped responding.
   *
   * A phone cannot hover, so ask the device rather than trusting the event. The
   * server has no way to know, and guessing "can hover" there would flash the
   * preview on before hydration corrected it — so it assumes touch.
   */
  const canHover = useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(HOVER_QUERY);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () => window.matchMedia(HOVER_QUERY).matches,
    () => false
  );

  /** Hover preview — real pointers only, so taps never trigger it. */
  const hoverInspect = (c: CardInstance | null) => (e: React.PointerEvent) => {
    if (canHover && c && e.pointerType === 'mouse') setInspect(c);
  };

  const statsOf = useCallback(
    (c: CardInstance, controller: PlayerId) => ({
      atk: effAtk(state, c, controller),
      def: effDef(state, c, controller),
    }),
    [state]
  );

  const fusions = useMemo(() => (myTurn && state.phase === 'main' ? fusionOptions(state, me) : []), [state, me, myTurn]);

  const startSummon = (uid: string, position: 'atk' | 'def', face: 'up' | 'down') => {
    const slug = mine.hand.find((h) => h.uid === uid)?.slug ?? '';
    const need = tributesRequired(slug, state, me);
    if (need > 0) {
      setMode({ kind: 'tributes', uid, need, picked: [], position, face });
      return;
    }
    finishSummon(uid, position, face, []);
  };

  /** Sends the summon, first collecting targets if the monster's own effect asks for one. */
  const finishSummon = (uid: string, position: 'atk' | 'def', face: 'up' | 'down', tributes: string[], targets?: string[]) => {
    const slug = mine.hand.find((h) => h.uid === uid)?.slug ?? '';
    const spec = face === 'up' && !targets ? summonTargetSpec(slug) : null;
    if (spec) {
      const options = pickableUids(spec);
      const want = spec.count ?? 1;
      // More candidates than the effect takes: that is a real choice. Exactly
      // as many, or fewer: name them and go, rather than opening a prompt with
      // nothing to decide. A summon whose effect has no legal target at all
      // still happens — the monster is the point, its effect is a bonus.
      if (options.length > want) {
        setMode({ kind: 'target', source: 'summon', uid, spec, picked: [], summon: { position, face, tributes } });
        return;
      }
      if (options.length) {
        finishSummon(uid, position, face, tributes, options.slice(0, want));
        return;
      }
    }
    // Tributes free a zone, so resolve the destination after they are paid.
    const zone = Math.max(0, mine.monsters.findIndex((m) => !m || tributes.includes(m.uid)));
    void run({ type: 'normalSummon', uid, zone, position, face, tributes, targets });
  };

  /** The subset of the engine's card filter a Deck search actually uses. */
  const matchesSpecFilter = (c: CardInstance, f?: TargetSpec['filter']): boolean => {
    if (!f) return true;
    const def = CARDS[c.slug];
    if (!def) return false;
    if (f.kind && def.kind !== f.kind) return false;
    if (f.type && def.type !== f.type) return false;
    if (f.attribute && def.attribute !== f.attribute) return false;
    if (f.minLevel != null && (def.level ?? 0) < f.minLevel) return false;
    if (f.maxLevel != null && (def.level ?? 0) > f.maxLevel) return false;
    if (f.minAtk != null && (def.atk ?? 0) < f.minAtk) return false;
    if (f.maxAtk != null && (def.atk ?? 0) > f.maxAtk) return false;
    if (f.slugs && !f.slugs.includes(c.slug)) return false;
    if (f.nameIncludes && !def.name.includes(f.nameIncludes)) return false;
    return true;
  };

  const pickableUids = useCallback(
    (spec: TargetSpec): string[] => {
      const sides: PlayerId[] = spec.side === 'own' ? [me] : spec.side === 'opp' ? [foe] : [me, foe];
      const out: string[] = [];
      for (const pid of sides) {
        const p = state.players[pid];
        if (spec.zone === 'monster')
          out.push(
            ...p.monsters
              .filter((m): m is CardInstance => !!m)
              /* What the engine will actually accept. Celtic Guardian cannot be
                 targeted by the opponent's effects, and it was still offered:
                 Ring of Destruction pointed at it destroyed nothing, and with
                 Celtic Guardian the only monster on the board there was nothing
                 else to point at — so the card was spent on a prompt that could
                 not be answered. */
              .filter((m) => pid === me || !effFlags(state, m, pid).untargetable)
              .map((m) => m.uid)
          );
        else if (spec.zone === 'spellTrap' || spec.zone === 'backrow') {
          if (p.spellTrap) out.push(p.spellTrap.uid);
          // Only `backrow` reaches the Field Zone. This used to offer the Field
          // Spell for a plain `spellTrap` spec, which the engine would then
          // refuse to touch — the client and the engine disagreeing about what
          // the words meant, with the player left pointing at a card nothing
          // would destroy.
          if (spec.zone === 'backrow' && p.field) out.push(p.field.uid);
        } else if (spec.zone === 'grave') {
          out.push(...p.grave.filter((c) => CARDS[c.slug]?.kind === 'monster').map((c) => c.uid));
        } else if (spec.zone === 'deck' && pid === me) {
          out.push(...p.deck.filter((c) => matchesSpecFilter(c, spec.filter)).map((c) => c.uid));
        } else if (spec.zone === 'hand' && pid === me) out.push(...p.hand.map((c) => c.uid));
      }
      return out;
    },
    [state, me, foe]
  );

  const send = (source: 'spell' | 'ignition' | 'setcard' | 'trap', uid: string, targets: string[]) => {
    if (source === 'trap') void run({ type: 'respondTrap', uid, targets });
    else if (source === 'spell') void run({ type: 'activateSpell', uid, targets });
    else if (source === 'ignition') void run({ type: 'ignition', uid, targets });
    else void run({ type: 'activateSetCard', uid, targets });
  };

  const beginTargeting = (source: 'spell' | 'ignition' | 'setcard' | 'trap', uid: string, slug: string, trigger: 'activate' | 'ignition' | 'trap') => {
    const spec = targetSpecFor(slug, trigger);
    if (!spec) {
      send(source, uid, []);
      return;
    }
    const options = pickableUids(spec);
    const want = spec.count ?? 1;

    /* Nothing it can legally point at, so there is nothing to activate. This
       used to go through anyway and the card was spent for no effect at all —
       Ring of Destruction against a lone Celtic Guardian, which it can never
       target, left the zone and did nothing. Saying so and keeping the card is
       the only sensible answer. */
    if (options.length === 0) {
      sfx.error();
      showToast('There is nothing this card can target.');
      setMode({ kind: 'idle' });
      return;
    }

    /* There is only a choice to make when more cards qualify than the effect
       will take. The Flute summons up to two Dragons, so holding exactly one
       left the player staring at a prompt with a single option and no way to
       decline. It goes straight through — but *naming* what it picked, rather
       than sending an empty list and hoping the engine guesses the same way.
       It did not always: `destroy` fell back to the strongest legal card while
       the damage beside it read the target list and found nothing. */
    if (options.length <= want) {
      send(source, uid, options.slice(0, want));
      return;
    }
    setMode({ kind: 'target', source, uid, spec, picked: [] });
  };

  const submitTargets = (picked: string[]) => {
    if (mode.kind !== 'target') return;
    const { source, uid, summon } = mode;
    if (source === 'summon' && summon) {
      finishSummon(uid, summon.position, summon.face, summon.tributes, picked);
      return;
    }
    if (source === 'spell') void run({ type: 'activateSpell', uid, targets: picked });
    else if (source === 'ignition') void run({ type: 'ignition', uid, targets: picked });
    else if (source === 'setcard') void run({ type: 'activateSetCard', uid, targets: picked });
    else if (source === 'trap') void run({ type: 'respondTrap', uid, targets: picked });
  };

  const onPickTarget = (uid: string) => {
    if (mode.kind !== 'target') return;
    const picked = [...mode.picked, uid];
    sfx.click();
    if (picked.length >= mode.spec.count) submitTargets(picked);
    else setMode({ ...mode, picked });
  };

  const targetableSet = useMemo(() => {
    if (mode.kind === 'target') return new Set(pickableUids(mode.spec).filter((u) => !mode.picked.includes(u)));
    if (mode.kind === 'attack') {
      const c = mine.monsters.find((m) => m?.uid === mode.uid);
      if (!c) return new Set<string>();
      return new Set(legalAttackTargets(state, me, c).uids);
    }
    if (mode.kind === 'tributes') {
      return new Set(
        /* Tokens are legal tribute fodder — that is half of what a wall of
           Kuriboh Tokens is *for*. They were excluded here, and a player whose
           three zones were full of tokens stood in front of a Tribute Summon
           they could see and could not pay. Nothing in any card's text says a
           token cannot be tributed, and the engine has always accepted it. */
        mine.monsters.filter((m): m is CardInstance => !!m && !mode.picked.includes(m.uid)).map((m) => m.uid)
      );
    }
    return new Set<string>();
  }, [mode, pickableUids, mine.monsters, state, me]);

  const canDirect = useMemo(() => {
    if (mode.kind !== 'attack') return false;
    const c = mine.monsters.find((m) => m?.uid === mode.uid);
    return !!c && legalAttackTargets(state, me, c).direct;
  }, [mode, mine.monsters, state, me]);

  /* ---------------- render pieces ---------------- */

  /**
   * What the event currently playing asks of this particular card.
   *
   * `owner` decides which way an attacker lunges: your monsters strike upward
   * at their half of the field, theirs strike down at yours.
   */
  const fxClass = (uid: string | undefined, owner: PlayerId): string => {
    if (!fx || !uid) return '';
    if (fx.uid === uid) {
      if (fx.kind === 'flip') return 'fx-flip';
      if (fx.kind === 'summon' || fx.kind === 'fusion') return 'fx-arrive';
      if (fx.kind === 'activate' || fx.kind === 'trap') return 'fx-charge';
      if (fx.kind === 'attack' || fx.kind === 'directAttack') {
        return owner === me ? 'fx-strike-up' : 'fx-strike-down';
      }
    }
    if (fx.targetUid === uid && fx.kind === 'attack') return 'fx-recoil';
    return '';
  };

  const renderMonsterZone = (owner: PlayerId, idx: number) => {
    const p = state.players[owner];
    /* A monster whose arrival has not been announced yet is not on the board
       yet. The server's state is already final, so without this the card
       appeared in its zone and *then* its summon animation played over the top
       of it — most obviously with a signature card, whose whole flourish is it
       coming towards you before it lands. */
    const c = p.monsters[idx] && unannounced.has(p.monsters[idx]!.uid) ? null : p.monsters[idx];
    const isMine = owner === me;
    const targetable = c ? targetableSet.has(c.uid) : false;
    const attackable = isMine && !!c && state.phase === 'battle' && myTurn && canAttackWith(state, me, c);
    const selectable =
      isMine && !!c && !targetable && myTurn && state.phase === 'main' && (canChangePosition(state, me, c) || canIgnite(state, me, c));

    return (
      <div
        key={idx}
        className={`zone ${BOARD_CARD} aspect-[59/86] ${targetable ? 'zone-target' : ''}`}
        onClick={() => {
          if (!c) return;
          if (targetable) {
            if (mode.kind === 'target') onPickTarget(c.uid);
            else if (mode.kind === 'attack') void run({ type: 'attack', uid: mode.uid, targetUid: c.uid });
            else if (mode.kind === 'tributes') {
              const picked = [...mode.picked, c.uid];
              sfx.click();
              if (picked.length >= mode.need) finishSummon(mode.uid, mode.position, mode.face, picked);
              else setMode({ ...mode, picked });
            }
            return;
          }
          // Your own monsters open an action sheet — attack, switch position, or
          // fire an ignition effect. Everything else just inspects. Not while a
          // question is on screen or the board is still narrating: `busy` is
          // the same gate every other way in already goes through, and this
          // click was the one that skipped it.
          if (isMine && myTurn && !busy && (attackable || selectable)) {
            sfx.click();
            setMode({ kind: 'monster', uid: c.uid });
            return;
          }
          setInspect(c);
        }}
        onPointerEnter={hoverInspect(c)}
        data-testid={isMine ? 'my-monster-zone' : 'foe-monster-zone'}
      >
        {!c && (
          <span className="absolute inset-0 grid place-items-center font-display text-[9px] tracking-widest text-ptextdim/30">
            ⬦
          </span>
        )}
        {c && (
          <div className="absolute inset-0 grid place-items-center">
            <div
              className={`${c.position === 'def' ? 'rotate-90 scale-[0.7]' : ''} w-full transition-transform ${
                targetable ? 'targetable' : attackable || selectable ? 'selectable' : ''
              }`}
            >
              <div className={fxClass(c.uid, owner)}>
              <GameCard
                card={c}
                {...statsOf(c, owner)}
                faceDown={c.face === 'down'}
                compact
              />
              </div>
            </div>
            {c.face === 'up' && (
              /* The board renders its cards compact, so these are the figures a
                 player actually reads off the field — and they are tinted for
                 the same reason the full card's are: a monster hollowed out by
                 a die roll looked exactly like an untouched one. */
              <div className="pointer-events-none absolute bottom-0 left-0 right-0 flex justify-between bg-black/70 px-1 font-display text-[9px] leading-tight text-parchment">
                <span style={statTint(statsOf(c, owner).atk, baseAtk(c.slug))}>{statsOf(c, owner).atk}</span>
                <span className="text-brass">{c.position === 'atk' ? 'ATK' : 'DEF'}</span>
                <span style={statTint(statsOf(c, owner).def, baseDef(c.slug))}>{statsOf(c, owner).def}</span>
              </div>
            )}
            {isMine && attackable && (
              <span className="pointer-events-none absolute -top-1 right-0 rounded bg-oxblood px-1 text-[8px] font-bold text-parchment">
                {maxAttacks(state, c, me) - c.attacksUsed}⚔
              </span>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderSTZone = (owner: PlayerId) => {
    const p = state.players[owner];
    const c = p.spellTrap;
    const isMine = owner === me;
    const targetable = c ? targetableSet.has(c.uid) : false;
    // `!busy` for the same reason as the monster sheet: a set card could be
    // flipped up mid-narration, and its prompt then raced the queue.
    const activatable = isMine && !!c && myTurn && !busy && canActivateSetCard(state, me, c);
    return (
      <div
        className={`zone ${SIDE_CARD} aspect-[59/86] ${targetable ? 'zone-target' : ''}`}
        onClick={() => {
          if (!c) return;
          if (targetable && mode.kind === 'target') return onPickTarget(c.uid);
          if (activatable) {
            sfx.click();
            beginTargeting('setcard', c.uid, c.slug, CARDS[c.slug]?.kind === 'trap' ? 'trap' : 'activate');
            return;
          }
          setInspect(c);
        }}
        onPointerEnter={hoverInspect(c)}
      >
        {c && (
          <div className={`absolute inset-0 ${targetable ? 'targetable' : activatable ? 'selectable' : ''}`}>
            <GameCard card={c} faceDown={c.face === 'down'} compact />
          </div>
        )}
        {!c && <span className="absolute inset-0 grid place-items-center font-display text-[9px] text-ptextdim/40">S/T</span>}
      </div>
    );
  };

  const renderFieldZone = (owner: PlayerId) => {
    const c = state.players[owner].field;
    return (
      <div
        className={`zone ${SIDE_CARD} aspect-[59/86]`}
        onClick={() => c && setInspect(c)}
        onPointerEnter={hoverInspect(c)}
      >
        {c ? <GameCard card={c} compact /> : <span className="absolute inset-0 grid place-items-center font-display text-[9px] text-ptextdim/40">FIELD</span>}
      </div>
    );
  };

  /* ---------------- hand action sheet ---------------- */
  const handCard = mode.kind === 'hand' ? mine.hand.find((h) => h.uid === mode.uid) : null;
  const handDef = handCard ? CARDS[handCard.slug] : null;
  const monsterCard = mode.kind === 'monster' ? mine.monsters.find((m) => m?.uid === mode.uid) ?? null : null;
  const monsterDef = monsterCard ? CARDS[monsterCard.slug] : null;

  const handActions = (): { label: string; run: () => void; disabled?: boolean; hint?: string }[] => {
    if (!handCard || !handDef) return [];
    const acts: { label: string; run: () => void; disabled?: boolean; hint?: string }[] = [];
    const freeZone = mine.monsters.findIndex((m) => !m) >= 0;
    if (handDef.kind === 'monster') {
      const need = tributesRequired(handCard.slug, state, me);
      const bodies = mine.monsters.filter((m): m is CardInstance => !!m).length;
      /* A Tribute Summon *makes* its own room — the tributes leave the field
         before the new monster arrives, and `finishSummon` already resolves the
         destination after they are paid. Demanding a free zone up front meant a
         full board locked out the one summon a full board is for, which is
         exactly backwards. Only a summon costing nothing needs a zone going
         spare. */
      const roomFor = need > 0 ? bodies >= need : freeZone;
      const canSummon = myTurn && state.phase === 'main' && !mine.normalSummonUsed && roomFor;
      /* The engine's own answer, asked here rather than left to refuse at the
         end: offering "Normal Summon" for a Ritual monster walked the player all
         the way through choosing what to absorb before telling them it was never
         allowed. The reason is shown on the button instead. */
      const gate = summonBlocked(state, me, handCard.slug);
      acts.push({
        /* A gated monster gets a label that tells the truth. "Tribute Summon
           (2)" on a Ritual monster reads as a route that exists and is merely
           unavailable right now, when the level and its tributes have nothing
           to do with how the card is summoned at all. */
        label: gate ? 'Cannot be Normal Summoned' : need > 0 ? `Tribute Summon (${need})` : 'Normal Summon',
        disabled: !canSummon || !!gate,
        hint:
          gate ??
          (!canSummon
            ? mine.normalSummonUsed
              ? 'Already summoned this turn'
              : need > bodies
                ? `Needs ${need} tribute(s)`
                : 'No free Monster Zone'
            : undefined),
        run: () => startSummon(handCard.uid, 'atk', 'up'),
      });
      if (!gate) {
        acts.push({
          label: 'Set (face-down)',
          disabled: !canSummon,
          hint: !canSummon && need > bodies ? `Needs ${need} tribute(s)` : undefined,
          run: () => startSummon(handCard.uid, 'def', 'down'),
        });
      }
    } else {
      const canAct = canActivateFromHand(state, me, handCard);
      if (handDef.kind === 'spell') {
        acts.push({
          label: 'Activate',
          disabled: !canAct,
          hint: !canAct
            ? handDef.slug === 'polymerization'
              ? 'Use the Fusion button'
              : mine.spellTrap
                ? 'Spell/Trap Zone is full'
                : 'Not available now'
            : undefined,
          run: () => beginTargeting('spell', handCard.uid, handCard.slug, 'activate'),
        });
      }
      acts.push({
        label: 'Set face-down',
        disabled: !(myTurn && state.phase === 'main' && !mine.spellTrap),
        hint: mine.spellTrap ? 'Spell/Trap Zone is full' : undefined,
        run: () => void run({ type: 'setSpellTrap', uid: handCard.uid }),
      });
    }
    return acts;
  };

  /* ---------------- overlays ---------------- */
  /* The response window is a full-screen modal, so it has to get out of the way
     the moment a trap that needs a target is chosen — Michizure and Ring of
     Destruction both ask you to point at a monster, and the modal was sitting
     over the board with no way past it. Cancelling targeting drops `mode` back
     to idle and the window comes straight back. */
  const pendingPrompt = respondingToTrap && state.pending && mode.kind === 'idle';
  const pendingCards = pendingPrompt
    ? state.pending!.options
        .map((uid) => mine.hand.find((h) => h.uid === uid) ?? (mine.spellTrap?.uid === uid ? mine.spellTrap : null))
        .filter((c): c is CardInstance => !!c)
    : [];

  return (
    <div className={`duel-root relative flex w-full flex-col overflow-hidden ${shakeOn ? 'hit-shake' : ''}`}>
      {/* Shown instead of the board when a phone is turned sideways — see the
          landscape rules in globals.css. Everything else is hidden by CSS, so
          no resize listener and no re-render. */}
      <div className="rotate-notice absolute inset-0 z-[80] place-items-center bg-ink p-8 text-center">
        <div>
          <p className="font-display text-4xl">📱</p>
          <h2 className="mt-3 font-display text-xl tracking-wide text-brassbright">Turn your phone upright</h2>
          <p className="mx-auto mt-2 max-w-xs text-xs leading-relaxed text-ptext/85">
            The board needs the height: two players&rsquo; rows, both Life Point bars and your hand. Sideways there
            is not enough room and the field ends up under the cards.
          </p>
          <p className="mt-3 text-[11px] text-ptextdim">Your duel is safe — it is waiting on the server.</p>
        </div>
      </div>

      {/* ---- top strip ---- */}
      <div className="flex shrink-0 items-center gap-2 px-2 pt-2">
        <div className="min-w-0 flex-1">
          <PlayerBar
            player={state.players[foe]}
            duelist={DUELIST_BY_ID[state.players[foe].duelistId]}
            isActive={state.active === foe && !state.winner}
            isAi={!!view.seats[foe]?.ai}
            /* The real total plus whatever damage or healing is still queued,
               so the number never runs ahead of the blow that caused it. */
            shownLp={Math.max(0, state.players[foe].lp + pending[foe])}
            onGrave={() => setGraveOpen(foe)}
          />
        </div>
        {/* Three rows, always. This column is taller than the Life Point bar
            beside it, so it — not the bar — sets the height of the whole strip,
            and a fourth row pushed the opponent's hand and both halves of the
            board down by a button. A duel in a bracket therefore sat lower than
            the same duel outside one, which is what "the pvp field is perfect,
            make the others match" was about. The bracket button shares the
            bottom row rather than adding to the stack. */}
        <div className="flex shrink-0 flex-col gap-1">
          <button
            className="btn rounded px-2 py-1 text-[10px]"
            onClick={() => {
              const next = !soundOn;
              setSoundOn(next);
              setSfxEnabled(next);
              if (next) sfx.click();
            }}
            title="Toggle sound"
          >
            {soundOn ? '🔊' : '🔇'}
          </button>
          <button className="btn rounded px-2 py-1 text-[10px]" onClick={() => setShowLog((v) => !v)} title="Duel log">
            ☰
          </button>
          <div className="flex gap-1">
            {/* A way out. The room lives on the server, so leaving loses nothing —
                the same link brings you straight back to this duel. */}
            <button className="btn rounded px-2 py-1 text-[10px]" onClick={() => setLeaving(true)} title="Menu">
              ⌂
            </button>
            {/* Only in a bracket match: look at the standings mid-duel and come
                back. Nothing is conceded by leaving the board — the duel is on
                the server and is exactly where you left it. */}
            {onBracket && (
              <button className="btn rounded px-2 py-1 text-[10px]" onClick={onBracket} title="Bracket">
                🏆
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ---- opponent hand (backs only) ----
          Sits high, just under their bar, and the backs are separated rather
          than touching. Knowing how many cards they are holding is real
          information in a duel, and a tight row of near-identical backs has to
          be counted twice to be trusted. */}
      <div data-testid="foe-hand" className="flex shrink-0 justify-center gap-[3px] px-2 pb-1.5 pt-0">
        {theirs.hand.slice(0, 12).map((c) => (
          <div key={c.uid} className="w-[clamp(20px,3.4vw,34px)]">
            <GameCard card={c} faceDown compact />
          </div>
        ))}
      </div>

      {/* ---- board ---- */}
      <div className="flex min-h-0 flex-1 gap-2 px-2">
        <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1.5">
          {/* Opponent's back row. Both rows keep the Monster Zones in the same
              three centre columns so attacker and defender line up on screen;
              the Spell/Trap and Field zones mirror to the outside. */}
          <div className="flex flex-col items-center gap-1.5 lg:flex-row">
            <div className="flex gap-1.5">
              {renderFieldZone(foe)}
              {renderSTZone(foe)}
            </div>
            <div className="flex gap-1.5">{[0, 1, 2].map((i) => renderMonsterZone(foe, i))}</div>
            <div className="hidden gap-1.5 lg:flex" aria-hidden>
              <div className={`${SIDE_CARD} shrink-0`} />
              <div className={`${SIDE_CARD} shrink-0`} />
            </div>
          </div>

          {/* centre rule */}
          <div className="my-0.5 flex w-full max-w-[560px] items-center gap-3">
            <div className="brass-rule flex-1" />
            <span className="whitespace-nowrap font-display text-[10px] uppercase tracking-[0.2em] text-brass">
              {state.winner ? 'Duel Over' : `Turn ${state.turn} · ${state.phase === 'battle' ? 'Battle' : state.phase === 'main' ? 'Main' : state.phase}`}
            </span>
            <div className="brass-rule flex-1" />
          </div>

          {/* my front row */}
          <div className="flex flex-col items-center gap-1.5 lg:flex-row">
            <div className="hidden gap-1.5 lg:flex" aria-hidden>
              <div className={`${SIDE_CARD} shrink-0`} />
              <div className={`${SIDE_CARD} shrink-0`} />
            </div>
            <div className="flex gap-1.5">{[0, 1, 2].map((i) => renderMonsterZone(me, i))}</div>
            <div className="flex gap-1.5">
              {renderSTZone(me)}
              {renderFieldZone(me)}
            </div>
          </div>
        </div>

        {/* inspector — desktop only */}
        <div className="hidden w-[210px] shrink-0 lg:block">
          <CardDetail
            card={inspect}
            {...(inspect ? statsOf(inspect, mine.monsters.some((m) => m?.uid === inspect.uid) ? me : foe) : {})}
          />
        </div>
      </div>

      {/* ---- my bar + hand + controls ----
          Above the card inspector's scrim on purpose. The inspector is a modal
          over the board, and it was eating taps meant for your own cards — so
          reading a card left the hand dead until you closed it. Your hand and
          the turn controls stay live behind it; the action sheets sit higher
          still, so nothing this opens ends up underneath. */}
      <div className="relative z-[31] shrink-0 px-2 pb-2 pt-1">
        <PlayerBar
          player={state.players[me]}
          duelist={DUELIST_BY_ID[state.players[me].duelistId]}
          isActive={state.active === me && !state.winner}
          isAi={!!view.seats[me]?.ai}
          shownLp={Math.max(0, state.players[me].lp + pending[me])}
          onGrave={() => setGraveOpen(me)}
        />

        <div className="mt-1.5 flex items-end gap-2">
          <div className="relative min-w-0 flex-1">
          <div
            ref={handRef}
            data-testid="hand-strip"
            className="thin-scroll flex items-end overflow-x-auto px-1 pb-2 pt-3"
          >
            <div className="mx-auto flex items-end gap-1">
            {mine.hand.map((c) => {
              const usable =
                myTurn &&
                state.phase === 'main' &&
                !busy &&
                (CARDS[c.slug]?.kind === 'monster'
                  ? !mine.normalSummonUsed && mine.monsters.some((m) => !m)
                  : canActivateFromHand(state, me, c) || !mine.spellTrap);
              return (
                <div
                  key={c.uid}
                  data-testid="hand-card"
                  className={`${HAND_CARD} shrink-0 transition-transform hover:-translate-y-1.5 ${
                    usable ? 'selectable rounded' : 'opacity-80'
                  }`}
                  onClick={() => {
                    if (mode.kind === 'target' && targetableSet.has(c.uid)) return onPickTarget(c.uid);
                    if (!busy && !state.winner) {
                      sfx.click();
                      setMode({ kind: 'hand', uid: c.uid });
                    }
                  }}
                  onPointerEnter={hoverInspect(c)}
                >
                  <GameCard card={c} />
                </div>
              );
            })}
            {mine.hand.length === 0 && <span className="py-4 font-display text-xs text-ptextdim">Your hand is empty</span>}
            </div>
          </div>
          {/* A hand of five always fits; a sixth card does not, and a card you
              cannot see is a card you forget you are holding. */}
          {handOverflow && (
            <div className="pointer-events-none absolute inset-y-0 right-0 flex w-8 items-center justify-end bg-gradient-to-l from-ink via-ink/70 to-transparent pr-0.5 text-brass">
              ›
            </div>
          )}
          </div>

          <div className="flex shrink-0 flex-col gap-1">
            {fusions.length > 0 && (
              <button
                className="btn btn-primary rounded px-2 py-1.5 text-[10px]"
                /* The one action button that carried no gate at all: a Fusion
                   could be summoned over the narration, or with a target
                   prompt still open. */
                disabled={busy}
                onClick={() => {
                  const f = fusions[0];
                  const zone = mine.monsters.findIndex((m) => !m);
                  sfx.click();
                  void run({ type: 'fusionSummon', extraUid: f.extraUid, materials: f.materials, zone: zone < 0 ? 0 : zone, position: 'atk' });
                }}
              >
                ✦ Fusion
              </button>
            )}
            {myTurn && state.phase === 'main' && (
              <button
                className="btn rounded px-2 py-1.5 text-[10px]"
                disabled={state.turn === 1 || busy}
                title={state.turn === 1 ? 'No attacks on the first turn' : undefined}
                onClick={() => {
                  sfx.click();
                  void run({ type: 'toPhase', phase: 'battle' });
                }}
              >
                ⚔ Battle
              </button>
            )}
            {myTurn && (
              <button
                className="btn rounded px-2 py-1.5 text-[10px]"
                disabled={busy}
                onClick={() => {
                  sfx.click();
                  void run({ type: 'endTurn' });
                }}
              >
                End Turn
              </button>
            )}
            {!myTurn && !state.winner && (
              <span className="flex items-center justify-center gap-1.5 rounded border border-stoneline px-2 py-1.5 text-center font-display text-[10px] text-ptextdim">
                {view.aiToMove && (
                  <span className="h-2.5 w-2.5 shrink-0 animate-spin rounded-full border border-brass/40 border-t-brass" />
                )}
                {state.pending ? 'Responding…' : view.aiToMove ? 'Thinking…' : 'Their turn'}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ================= overlays ================= */}

      {/* A signature card's moment: it comes out of the depth of the screen,
          turns as it arrives and rushes past. The board keeps playing behind
          it — this is a flourish, not a modal. */}
      {/* A Fusion Summon gets its own moment: the materials swing in, meet, and
          the monster comes out of the flash. Three cards spent at once for the
          strongest body in the game used to resolve with the same small banner
          as drawing a card. */}
      {fx?.kind === 'fusion' && (
        <div key={`fuse-${fx.id}`} className="fuse-stage" aria-hidden>
          {(fx.from ?? []).map((slug, i, all) => {
            /* Fanned by index so a two-card and a three-card recipe both read:
               spread across a half-circle, then pushed out to the edges. */
            const spread = all.length === 1 ? 0 : (i / (all.length - 1) - 0.5) * 2;
            return (
              <div
                key={`${slug}-${i}`}
                className="fuse-mat"
                style={
                  {
                    '--dx': Math.round(spread * 150),
                    '--dy': Math.round(Math.abs(spread) * 40 - 20),
                    '--spin': Math.round(spread * 70),
                    animationDelay: `${i * 70}ms`,
                  } as React.CSSProperties
                }
              >
                <GameCard card={previewInstances([[slug, 1]])[0]} compact />
              </div>
            );
          })}
          <div className="fuse-flare" />
          <div className="fuse-result">
            <GameCard card={previewInstances([[fx.slug!, 1]])[0]} />
          </div>
        </div>
      )}

      {isSignature(fx) && fx?.kind !== 'fusion' && (
        <div key={`sig-${fx!.id}`} className="sig-stage" aria-hidden>
          {/* No separate title. The card is legible at this size and the
              declaration below already names it — three copies of "Two-Headed
              King Rex" on screen at once was clutter, and the title collided
              with the card as it grew towards the viewer. */}
          <div className="sig-card relative">
            <GameCard card={previewInstances([[fx!.slug!, 1]])[0]} />
            <div className="sig-glint" />
          </div>
        </div>
      )}

      {/* What is happening, in the middle of the screen, one beat at a time.
          There used to be two lines — the card's cry in the centre and the
          declaration near the edge — so Crush Card Virus announced itself
          twice. This is the only one, and it speaks for every beat, including
          those whose only record was a line in the log. */}
      {(() => {
        const said = fx ? spoken(fx) : null;
        if (!said) return null;
        return (
          /* `say-` because a damage beat renders TWO keyed siblings from the
             same event: this declaration and the hit vignette below, which
             used `hit.id` — the same string. Two siblings with one key is
             undefined behaviour in React's reconciler, and what it actually
             did was orphan the loser: every damage beat left a frozen copy of
             this band in the DOM at opacity 0, in pairs, forever. Invisible to
             a player, but every probe that read the *first* declaration node
             found a fossil — which is where "the board went silent" kept
             coming from. Every keyed overlay in this layer carries its own
             prefix (`fuse-`, `sig-`, `say-`, `vign-`) for exactly this
             reason. */
          <div
            key={`say-${fx!.id}`}
            className="pointer-events-none absolute inset-x-0 top-1/2 z-[55] flex -translate-y-1/2 justify-center px-3"
          >
            <div
              data-testid="declaration"
              className="declare flex max-w-[92%] items-center gap-2.5 rounded border border-brass/70 bg-ink/95 px-3 py-2 shadow-2xl"
              style={{ animationDuration: `${fxHold}ms` }}
            >
              {said.slug && CARDS[said.slug] && (
                <div className="w-10 shrink-0">
                  <GameCard card={previewInstances([[said.slug, 1]])[0]} compact />
                </div>
              )}
              <p className="min-w-0 font-display text-[13px] leading-snug text-parchment sm:text-base">
                {said.text}
              </p>
            </div>
          </div>
        );
      })()}

      {leaving && (
        <div
          className="absolute inset-0 z-[75] flex items-center justify-center bg-black/80 p-6"
          style={{ paddingTop: 'calc(var(--safe-top) + 1.5rem)', paddingBottom: 'calc(var(--safe-bottom) + 1.5rem)' }}
          onClick={() => setLeaving(false)}
        >
          <div className="panel grain w-full max-w-xs rounded p-5 text-center" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-lg text-brassbright">Leave the duel?</h3>
            <p className="mt-2 text-[11px] leading-relaxed text-ptext/85">
              It stays exactly where it is. Open the same link and you are back in, on the same turn.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <Link className="btn btn-primary rounded px-4 py-2 text-xs" href="/">
                Back to the arena
              </Link>
              <button className="btn rounded px-4 py-2 text-xs" onClick={() => setLeaving(false)}>
                Keep duelling
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Taking damage. The bloom leans in from the struck player's own edge,
          so a hit reads as landing on someone rather than on the screen. */}
      {hit && (
        <div
          key={`vign-${hit.id}`}
          className="hit-vignette"
          style={{
            background: (() => {
              const rgb = hit.kind === 'heal' ? '90,190,120' : '190,40,48';
              const dim = hit.kind === 'heal' ? '60,150,95' : '150,25,35';
              const from = hit.who === me ? '50% 108%' : '50% -8%';
              return `radial-gradient(120% 70% at ${from}, rgba(${rgb},0.55) 0%, rgba(${dim},0.24) 38%, transparent 72%)`;
            })(),
          }}
          onAnimationEnd={() => setHit((h) => (h?.id === hit.id ? null : h))}
          aria-hidden
        />
      )}
      {hit && hit.amount > 0 && (
        <div
          key={`${hit.id}-n`}
          className="pointer-events-none absolute inset-x-0 z-[46] flex justify-center"
          style={{ top: hit.who === me ? '58%' : '26%' }}
          aria-hidden
        >
          <span
            className="dmg-pop font-display text-[13vw] font-black leading-none sm:text-6xl"
            style={
              hit.kind === 'heal'
                ? { color: '#7ff0a8', textShadow: '0 0 18px rgba(60,200,110,0.75), 0 4px 0 rgba(0,0,0,0.55)' }
                : { color: '#ff6b6b', textShadow: '0 0 18px rgba(220,40,50,0.75), 0 4px 0 rgba(0,0,0,0.55)' }
            }
          >
            {hit.kind === 'heal' ? '+' : '−'}
            {hit.amount}
          </span>
        </div>
      )}

      {toast && (
        <div className="pointer-events-none absolute inset-x-0 bottom-28 z-50 flex justify-center px-4">
          <div className="rounded border border-oxblood bg-[#2a1216]/95 px-4 py-2 text-center text-xs text-[#f0c9cc] shadow-xl">
            {toast}
          </div>
        </div>
      )}

      {/* hand action sheet */}
      {handCard && handDef && (
        <div
          className="absolute inset-0 z-40 flex items-end justify-center bg-black/55 p-3 sm:items-center"
          style={{ paddingTop: 'calc(var(--safe-top) + 0.75rem)', paddingBottom: 'calc(var(--safe-bottom) + 0.75rem)' }}
          onClick={() => setMode({ kind: 'idle' })}
        >
          <div className="panel grain w-full max-w-md rounded p-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex gap-3">
              <div className="w-24 shrink-0">
                <GameCard card={handCard} />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-display text-base text-parchment">{handDef.name}</h3>
                <p className="mt-1 max-h-24 overflow-y-auto thin-scroll pr-1 text-[11px] leading-relaxed text-ptext/85">
                  {handDef.text}
                </p>
              </div>
            </div>
            <div className="brass-rule my-3" />
            <div className="flex flex-col gap-1.5">
              {handActions().map((a) => (
                <button
                  key={a.label}
                  className="btn rounded px-3 py-2 text-xs"
                  disabled={a.disabled}
                  title={a.hint}
                  onClick={() => {
                    sfx.click();
                    a.run();
                  }}
                >
                  {a.label}
                  {a.disabled && a.hint ? <span className="ml-2 normal-case tracking-normal opacity-60">— {a.hint}</span> : null}
                </button>
              ))}
              <button className="btn rounded px-3 py-2 text-xs" onClick={() => setMode({ kind: 'idle' })}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* your-monster action sheet */}
      {monsterCard && monsterDef && (
        <div
          className="absolute inset-0 z-40 flex items-end justify-center bg-black/55 p-3 sm:items-center"
          style={{ paddingTop: 'calc(var(--safe-top) + 0.75rem)', paddingBottom: 'calc(var(--safe-bottom) + 0.75rem)' }}
          onClick={() => setMode({ kind: 'idle' })}
        >
          <div className="panel grain w-full max-w-md rounded p-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex gap-3">
              <div className="w-20 shrink-0">
                <GameCard card={monsterCard} {...statsOf(monsterCard, me)} />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-display text-base text-parchment">{monsterDef.name}</h3>
                <p className="text-[11px] text-brass">
                  ATK {statsOf(monsterCard, me).atk} · DEF {statsOf(monsterCard, me).def} ·{' '}
                  {monsterCard.position === 'atk' ? 'Attack' : 'Defence'} Position
                </p>
                <p className="mt-1 max-h-20 overflow-y-auto thin-scroll pr-1 text-[11px] leading-relaxed text-ptext/85">
                  {monsterDef.text}
                </p>
              </div>
            </div>
            <div className="brass-rule my-3" />
            <div className="flex flex-col gap-1.5">
              {canAttackWith(state, me, monsterCard) && (
                <button
                  className="btn btn-danger rounded px-3 py-2 text-xs"
                  onClick={() => {
                    sfx.click();
                    /* An empty field across the table is not a choice. Asking
                       "choose a target, or attack directly" when there is
                       nothing to choose put a confirmation between the player
                       and the only move available — twice, once to open the
                       prompt and once to press the button that was always the
                       answer. */
                    const legal = legalAttackTargets(state, me, monsterCard);
                    if (!legal.uids.length && legal.direct) {
                      void run({ type: 'attack', uid: monsterCard.uid, targetUid: null });
                      return;
                    }
                    setMode({ kind: 'attack', uid: monsterCard.uid });
                  }}
                >
                  {/* The ATK it will actually swing with, not just how many
                      attacks are left. A die roll or a Trap can hollow a monster
                      out between the board and this button, and attacking into
                      nothing because the number was somewhere else on screen is
                      not a mistake worth being allowed to make. */}
                  ⚔ Attack with {statsOf(monsterCard, me).atk} ATK
                  {maxAttacks(state, monsterCard, me) - monsterCard.attacksUsed > 1 && (
                    <span className="ml-1 normal-case opacity-70">
                      · {maxAttacks(state, monsterCard, me) - monsterCard.attacksUsed} attacks
                    </span>
                  )}
                </button>
              )}
              {canIgnite(state, me, monsterCard) && (
                <button
                  className="btn btn-primary rounded px-3 py-2 text-xs"
                  onClick={() => {
                    sfx.click();
                    beginTargeting('ignition', monsterCard.uid, monsterCard.slug, 'ignition');
                  }}
                >
                  ✦ {effectLabel(monsterCard.slug, 'ignition')}
                </button>
              )}
              {canChangePosition(state, me, monsterCard) && (
                <button
                  className="btn rounded px-3 py-2 text-xs"
                  onClick={() => {
                    sfx.click();
                    void run({ type: 'changePosition', uid: monsterCard.uid });
                  }}
                >
                  {monsterCard.face === 'down'
                    ? 'Flip Summon'
                    : monsterCard.position === 'atk'
                      ? 'Switch to Defence Position'
                      : 'Switch to Attack Position'}
                </button>
              )}
              <button className="btn rounded px-3 py-2 text-xs" onClick={() => setMode({ kind: 'idle' })}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* targeting / tribute prompt */}
      {(mode.kind === 'target' || mode.kind === 'tributes' || mode.kind === 'attack') && (
        <div
          data-testid="target-prompt"
          className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center px-3"
          style={{ paddingTop: 'calc(var(--safe-top) + 0.5rem)' }}
        >
          <div className="pointer-events-auto flex items-center gap-3 rounded border border-brass bg-ink/95 px-4 py-2 shadow-xl">
            <span className="font-display text-[11px] uppercase tracking-wider text-brassbright">
              {mode.kind === 'target'
                ? `${mode.spec.prompt} (${mode.picked.length}/${mode.spec.count})`
                : mode.kind === 'tributes'
                  ? `Choose ${mode.need} monster(s) to tribute (${mode.picked.length}/${mode.need})`
                  : canDirect
                    ? 'Choose a target, or attack directly'
                    : 'Choose a monster to attack'}
            </span>
            {mode.kind === 'attack' && canDirect && (
              <button
                className="btn btn-danger rounded px-3 py-1 text-[10px]"
                onClick={() => void run({ type: 'attack', uid: mode.uid, targetUid: null })}
              >
                Direct Attack
              </button>
            )}
            <button className="btn rounded px-3 py-1 text-[10px]" onClick={() => setMode({ kind: 'idle' })}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Deck search (Toon World, Toon Alligator). Your own deck, so showing it
          gives nothing away — and picking beats being handed whatever the
          shuffle put nearest the top. */}
      {mode.kind === 'target' && mode.spec.zone === 'deck' && (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-black/75 p-4"
          style={{ paddingTop: 'calc(var(--safe-top) + 1rem)', paddingBottom: 'calc(var(--safe-bottom) + 1rem)' }}
          onClick={() => setMode({ kind: 'idle' })}
        >
          <div className="panel grain thin-scroll max-h-[76dvh] w-full max-w-2xl overflow-y-auto rounded p-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-display text-sm text-parchment">{mode.spec.prompt}</h3>
              <button className="btn shrink-0 rounded px-2 py-1 text-[10px]" onClick={() => setMode({ kind: 'idle' })}>
                ✕
              </button>
            </div>
            <div className="brass-rule my-2" />
            <div className="flex flex-wrap gap-2">
              {mine.deck
                .filter((c) => matchesSpecFilter(c, mode.spec.filter))
                .map((c) => (
                  <button key={c.uid} className="w-[76px] text-left selectable rounded" onClick={() => onPickTarget(c.uid)}>
                    <GameCard card={c} />
                    <p className="mt-0.5 truncate text-center text-[9px] text-ptextdim">{CARDS[c.slug]?.name}</p>
                  </button>
                ))}
            </div>
            {!mine.deck.some((c) => matchesSpecFilter(c, mode.spec.filter)) && (
              <p className="py-4 text-center text-xs text-ptextdim">Nothing in your Deck matches.</p>
            )}
          </div>
        </div>
      )}

      {/* grave-zone target picker (Monster Reborn etc.) */}
      {mode.kind === 'target' && mode.spec.zone === 'grave' && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={() => setMode({ kind: 'idle' })}>
          <div className="panel grain max-h-[70vh] w-full max-w-2xl overflow-y-auto thin-scroll rounded p-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-sm text-parchment">{mode.spec.prompt}</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {(mode.spec.side === 'both' ? [me, foe] : [me]).flatMap((pid) =>
                state.players[pid].grave
                  .filter((c) => CARDS[c.slug]?.kind === 'monster')
                  .map((c) => (
                    <div key={c.uid} className="w-[72px] cursor-pointer selectable rounded" onClick={() => onPickTarget(c.uid)}>
                      <GameCard card={c} />
                      <p className="mt-0.5 truncate text-center text-[9px] text-ptextdim">
                        {pid === me ? 'Yours' : 'Theirs'}
                      </p>
                    </div>
                  ))
              )}
            </div>
            <button className="btn mt-3 rounded px-3 py-1.5 text-[10px]" onClick={() => setMode({ kind: 'idle' })}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* trap response window */}
      {pendingPrompt && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="panel grain w-full max-w-lg rounded p-4">
            <h3 className="font-display text-lg text-brassbright">Your move</h3>
            <p className="mt-1 text-xs text-ptext/85">{state.pending!.reason}</p>
            <div className="brass-rule my-3" />
            <div className="flex flex-wrap justify-center gap-3">
              {pendingCards.map((c) => (
                <button
                  key={c.uid}
                  className="w-24 selectable rounded"
                  onClick={() => {
                    sfx.click();
                    beginTargeting('trap', c.uid, c.slug, 'trap');
                  }}
                >
                  <GameCard card={c} />
                  <p className="mt-1 text-center font-display text-[10px] text-parchment">{CARDS[c.slug]?.name}</p>
                </button>
              ))}
            </div>
            <button
              className="btn mt-4 w-full rounded px-3 py-2 text-xs"
              onClick={() => void run({ type: 'respondTrap', uid: null })}
            >
              Do nothing
            </button>
          </div>
        </div>
      )}

      {/* graveyard viewer */}
      {graveOpen && (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-4"
          onClick={() => {
            setGraveOpen(null);
            setGraveInspect(null);
          }}
        >
          <div className="panel grain max-h-[70vh] w-full max-w-2xl overflow-y-auto thin-scroll rounded p-3" onClick={(e) => e.stopPropagation()}>
            {/* An explicit way out. Tapping the dark surround also closes it,
                but nobody should have to guess that. */}
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-display text-sm text-parchment">
                {state.players[graveOpen].name}&apos;s Graveyard ({state.players[graveOpen].grave.length})
              </h3>
              <button
                className="btn shrink-0 rounded px-2 py-1 text-[10px]"
                onClick={() => { setGraveOpen(null); setGraveInspect(null); }}
                aria-label="Close the Graveyard"
              >
                ✕
              </button>
            </div>
            {graveInspect && (
              <div className="mt-3">
                <CardDetail
                  card={graveInspect}
                  layout="row"
                  onClose={() => setGraveInspect(null)}
                  {...statsOf(graveInspect, graveOpen)}
                />
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {state.players[graveOpen].grave.map((c) => (
                <button
                  key={c.uid}
                  className={`w-[68px] rounded text-left transition-transform hover:-translate-y-0.5 ${
                    graveInspect?.uid === c.uid ? 'ring-2 ring-brass' : ''
                  }`}
                  onPointerEnter={hoverInspect(c)}
                  onClick={() => {
                    sfx.click();
                    setGraveInspect((cur) => (cur?.uid === c.uid ? null : c));
                  }}
                >
                  <GameCard card={c} />
                </button>
              ))}
              {state.players[graveOpen].grave.length === 0 && <p className="text-xs text-ptextdim">Empty.</p>}
            </div>
            <button
              className="btn mt-3 rounded px-3 py-1.5 text-[10px]"
              onClick={() => {
                setGraveOpen(null);
                setGraveInspect(null);
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* duel log */}
      {showLog && (
        <div
          className="absolute inset-y-0 right-0 z-[80] flex w-full max-w-sm flex-col panel grain p-3"
          style={{ paddingTop: 'calc(var(--safe-top) + 0.75rem)', paddingBottom: 'calc(var(--safe-bottom) + 0.75rem)' }}
        >
          <div className="flex items-center justify-between">
            <h3 className="font-display text-sm text-parchment">Duel Log</h3>
            <button className="btn rounded px-2 py-1 text-[10px]" onClick={() => setShowLog(false)}>
              ✕
            </button>
          </div>
          <div className="brass-rule my-2" />
          <div ref={logRef} className="thin-scroll min-h-0 flex-1 space-y-1 overflow-y-auto pr-1 text-[11px] leading-relaxed">
            {state.log.map((l) => (
              <p
                key={l.id}
                className={
                  l.tone === 'damage'
                    ? 'text-[#e08d93]'
                    : l.tone === 'attack'
                      ? 'text-[#e8b98a]'
                      : l.tone === 'effect'
                        ? 'text-[#9fd6cf]'
                        : l.tone === 'summon'
                          ? 'text-[#cdb6ee]'
                          : l.tone === 'system'
                            ? 'text-brass'
                            : 'text-ptext/80'
                }
              >
                {l.text}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Mobile inspector: a slim strip pinned under the top bar. It must never
          sit over the hand, or it would swallow taps meant for your own cards. */}
      {inspect && mode.kind === 'idle' && (
        <div
          data-testid="inspector-scrim"
          className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-4 lg:hidden"
          onClick={() => setInspect(null)}
        >
          <div className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <CardDetail
              card={inspect}
              layout="row"
              onClose={() => setInspect(null)}
              {...statsOf(inspect, mine.monsters.some((m) => m?.uid === inspect.uid) ? me : foe)}
            />
          </div>
        </div>
      )}

      {/* The win screen waits for the board to finish. It used to land on top of
          the last attack still playing, so the duel ended before you had seen
          how — and with the log underneath it there was no way to find out.
          The queue being empty is not enough on its own: the blow that ended the
          duel is still popping for another second after its event has played. */}
      {winScreenUp && (
        <div className="absolute inset-0 z-[60] grid place-items-center bg-black/85 p-6">
          <div className="panel grain w-full max-w-md rounded p-6 text-center">
            <p className="font-display text-3xl tracking-wide" style={{ color: state.winner === me ? '#e6c980' : '#c98a8a' }}>
              {state.winner === 'draw' ? 'Draw' : state.winner === me ? 'Victory' : 'Defeat'}
            </p>
            <p className="mt-2 text-sm text-ptext/85">{state.winReason}</p>
            <div className="brass-rule my-4" />
            <div className="flex flex-col gap-2">
              {/* The last few turns are worth being able to read back, and this
                  is the only screen still on top of them. */}
              <button
                className="btn rounded px-4 py-2 text-xs"
                onClick={() => {
                  sfx.click();
                  setShowLog(true);
                }}
              >
                📜 What happened
              </button>
              {onBracket ? (
                /* A bracket match has no rematch: the result stands. */
                <button className="btn btn-primary rounded px-4 py-2 text-xs" onClick={onBracket}>
                  To the bracket
                </button>
              ) : (
                <>
                  <button className="btn btn-primary rounded px-4 py-2 text-xs" onClick={rematch}>
                    {view.rematch.includes(me) ? 'Waiting for your opponent…' : 'Rematch'}
                  </button>
                  <button className="btn rounded px-4 py-2 text-xs" onClick={toLobby}>
                    Choose new duelists
                  </button>
                </>
              )}
            </div>
            {view.rematch.length === 1 && !view.rematch.includes(me) && (
              <p className="mt-3 text-[11px] text-brass">Your opponent wants a rematch!</p>
            )}
          </div>
        </div>
      )}

      {/* connection banner */}
      {connection !== 'live' && (
        <div
          className="absolute inset-x-0 top-0 z-[70] bg-oxblood/90 pb-1 text-center text-[11px] text-parchment"
          style={{ paddingTop: 'calc(var(--safe-top) + 0.25rem)' }}
        >
          {connection === 'lost' ? 'Connection lost — trying to restore your duel…' : 'Reconnecting…'}
        </div>
      )}

      {/* frozen-monsters notice */}
      {myTurn && monstersFrozen(state, me) && state.phase !== 'draw' && (
        <div className="pointer-events-none absolute inset-x-0 top-14 z-20 flex justify-center">
          <span className="rounded border border-sea/60 bg-[#0f2422]/90 px-3 py-1 text-[10px] text-[#bfe8e2]">
            Your monsters are locked down this turn
          </span>
        </div>
      )}
    </div>
  );
}
