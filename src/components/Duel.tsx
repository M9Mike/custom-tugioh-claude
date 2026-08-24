'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import GameCard, { statTint } from './GameCard';
import { previewInstances } from './deckPreview';
import CardDetail from './CardDetail';
import { CARDS, DUELIST_BY_ID, DUELISTS, artUrl, baseAtk, baseDef, toonDisplayName } from '@/game/cards';
import {
  canActivateFromHand,
  canActivateSetCard,
  canAttackWith,
  canChangePosition,
  canDiscardForEffect,
  canIgnite,
  effAtk,
  effDef,
  effFlags,
  fusionOptions,
  ignitionOptions,
  handSummonOffer,
  legalAttackTargets,
  maxAttacks,
  monstersFrozen,
  other,
  summonAffordable,
  summonBanishFor,
  summonBlocked,
  tributableBodies,
  tributesRequired,
  wastedWithoutTarget,
} from '@/game/engine';
import { isSignatureBeat, shownNameFor, spokenFor } from '@/game/announce';
import { pickerSides, summonChoiceSpec, summonRiderSpec, summonTargetSpec, targetCandidates, targetSpecFor, targetSpecForEffect, type TargetSpec } from '@/game/ui';
import { getSfxEnabled, primeAudio, setSfxEnabled, sfx } from '@/lib/sfx';
import { STARTING_LP } from '@/game/types';
import type { AnimEvent, CardInstance, DuelAction, DuelState, PlayerId } from '@/game/types';
import type { RoomView } from '@/server/rooms';
import { isFinalRound } from '@/server/tournament';

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
      source: 'spell' | 'ignition' | 'setcard' | 'trap' | 'summon' | 'flip';
      uid: string;
      spec: TargetSpec;
      picked: string[];
      /** Which ignition, for a card carrying more than one. See `ignitionOptions`. */
      effectIndex?: number;
      /** Pending summon that resolves once targets are chosen. */
      summon?: { position: 'atk' | 'def'; face: 'up' | 'down'; tributes: string[] };
      /** Answers already given this activation, kept in front of the new ones.
       *  Black Illusion Ritual asks for a Tribute and then, because it puts
       *  Relinquished on the field, asks what to swallow. */
      carry?: string[];
    }
  | { kind: 'attack'; uid: string }
  /**
   * Which card out of your hand is being fed to something. Two cards buy their
   * way onto the field with one, and Two-Headed King Rex eats one for every
   * swing it makes — the same question either way, so it is one modal and the
   * `purpose` says where the answer goes.
   */
  | {
      kind: 'handCost';
      purpose: 'summon' | 'attack';
      uid: string;
      /** `attack` only: what it is swinging at, `null` for a direct attack. */
      targetUid?: string | null;
      prompt: string;
    }
  /** Action sheet for one of your own monsters on the field. */
  | { kind: 'monster'; uid: string };

interface Props {
  view: RoomView;
  act: (a: DuelAction) => Promise<string | null>;
  rematch: () => void;
  /**
   * Shown instead of the rematch and lobby buttons when the duel was entered
   * from a conversation in Story Mode: the only sensible way out of it is back
   * to the person who offered it.
   */
  onStoryReturn?: (won: boolean) => void;
  toLobby: () => void;
  connection: string;
  /** Present during a tournament: return to the bracket. */
  onBracket?: () => void;
  /** Tells the room whether the board is still narrating, so the computer's
      next action waits for the current one to finish being announced. */
  setAnimating?: (busy: boolean) => void;
  /** Tells the room that somebody is looking at the board, so the computer
      never plays a turn nobody is there to watch. Required rather than
      optional: a call site that forgets it would silently stop the computer,
      and that is the kind of thing the compiler should catch. */
  setWatching: (watching: boolean) => void;
  /** The spectator's pause — see useDuelRoom, where not-nudging is the pause. */
  paused?: boolean;
  setPaused?: (p: boolean) => void;
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
  const lpPct = Math.max(0, Math.min(100, (shownLp / STARTING_LP) * 100));
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
          <span data-testid="lp" className="font-display text-sm tabular-nums text-brassbright">{shownLp}</span>
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

export default function Duel({ view, act, rematch, toLobby, connection, onBracket, onStoryReturn, setAnimating, setWatching, paused, setPaused }: Props) {
  const state = view.state!;
  const me = view.you;
  const foe = other(me);
  const mine = state.players[me];
  const theirs = state.players[foe];
  /* Watching an exhibition. `me` is still p1 — the board needs an orientation —
     but it is nobody's seat: every way of acting is closed off below by the two
     flags everything else already asks, and a tap on any card only inspects. */
  const spectator = !!view.spectate;

  /* Winning the final wins the tournament, and the win screen used to say only
     "Victory" — the same word it says for a quarter-final — so the run ended
     with no announcement at all and the player had to tap through to the
     bracket to discover they had taken the Kingdom. The final is the round with
     one match and nobody sitting it out; a round of one match *and* a bye is
     not the final. Read here rather than from `tournament.status`, which is
     still 'duelling' at the moment the win screen appears: the server has not
     been told the result yet. */
  const wonTheKingdom = !!view.tournament && state.winner === me && isFinalRound(view.tournament);

  const [mode, setMode] = useState<Mode>({ kind: 'idle' });
  /* Picks collected in an "up to N" window. Cleared whenever an answer is sent,
     so a new window always opens empty — and anything stale that did survive is
     dropped by the engine, which only accepts uids it offered. */
  const [choicePicks, setChoicePicks] = useState<string[]>([]);
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

  /**
   * Somebody is looking at the board.
   *
   * The computer plays one action per nudge and the nudge loop lives in
   * `useDuelRoom` — the *room*, not this component — so it kept asking the
   * computer for its next move while the player was on a screen that is not
   * the board. In a tournament that is guaranteed: every round opens on the
   * bracket and the player walks into their duel by tapping Continue, so if
   * the computer had the first turn it played the whole thing behind the
   * bracket. Walking in afterwards, the board primes on a view where all of
   * that has already happened and correctly treats it as history — it swallows
   * the tail, exactly as it does when you re-join a duel mid-way. The player
   * arrives at a board that was built while they were somewhere else.
   *
   * Reported as "the duel can not start with the ai just ending its turn (no
   * matter if it played summoned set whatever, it must take place for the
   * human to see)".
   *
   * So the computer waits for an audience. Mounting says the board is being
   * watched and unmounting says it is not — which also covers tapping 🏆
   * mid-duel to look at the bracket: the turn pauses and plays out when you
   * come back. A tournament's *side* matches are driven by `bracketBusy` and
   * are deliberately not gated on this, or the bracket would never resolve.
   */
  useEffect(() => {
    setWatching(true);
    return () => setWatching(false);
  }, [setWatching]);

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

  /* Both gates carry `!spectator`: `me` is an AI seat in an exhibition, so
     without it the audience was offered that seat's whole turn — phase
     buttons, the hand's action sheets, and its trap windows as full-screen
     prompts the computer was already about to answer itself. */
  const myTurn = !spectator && state.active === me && !state.winner;
  const respondingToTrap = !spectator && state.pending?.kind === 'trap' && state.pending.player === me;
  /* A card of mine stopping to ask me which card to take — on whichever turn it
     happens to fire. The same overlay slot as a trap window, because from the
     player's side it is the same thing: the duel is waiting on me. */
  const choosing2 = !spectator && state.pending?.kind === 'choose' && state.pending.player === me
    ? state.pending
    : null;
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
  /* A window I owe an answer to is not "busy" — it is the one thing I may do.
     Both kinds count: a trap to respond to, and a card of mine asking which
     card to take. */
  const busy = (!!state.pending && !respondingToTrap && !choosing2) || choosing || narrating;

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
  /* The board's voice — which beat earns a flourish, and what it says out loud
     — lives beside the engine that writes the beats, in `announce.ts`. It used
     to be three closures here, where no test could reach them, and that is
     exactly how Barrel Dragon shipped announcing itself twice instead of
     saying what the coins did. */
  const isSignature = (a: AnimEvent | null) => isSignatureBeat(a);
  /* Whose Toon World is open — for the two places that name a card from a slug
     alone rather than from an instance. */
  const bookOpenFor = (pid: PlayerId | undefined) => !!pid && state.players[pid].field?.slug === 'toon-world';
  const shownName = (c: CardInstance | null | undefined) => shownNameFor(state, c);
  const spoken = (a: AnimEvent | null) => spokenFor(state, a);

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
        case 'discard':
          sfx.destroy();
          break;
        case 'summon': {
          const big = a.slug ? baseAtk(a.slug) >= 2400 : false;
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
  /* `settled` alone is a commit too late. It is turned off inside the effect
     that queues fresh beats, and `state.winner` arrives in the *same* commit as
     the beats that killed you — so the render that first sees a winner still
     reads the `settled: true` left over from the last quiet moment, and the
     modal went up over a board that had not yet said a word. That is the
     victory splash arriving early.
     `unspoken` is derived during render from this very commit's `state.anims`,
     so it is true the instant the killing blow lands and there is no ordering
     hole to lose. Same lesson as the Life Point total, which is held back by
     the same list: the board must not know things the player has not been
     told. `forceWin` is untouched and still the way out — three seconds of
     silence shows the result however stuck the queue is. */
  const winScreenUp = !!state.winner && (forceWin || (settled && !hit && unspoken.length === 0));
  useEffect(() => {
    if (!winScreenUp || !state.winner || sungFor.current === state.winner) return;
    sungFor.current = state.winner;
    // Neither duelist is the spectator's side, so a decided duel is always
    // an occasion rather than a defeat.
    if (state.winner === me || (spectator && state.winner !== 'draw')) sfx.win();
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
    /* The body price, deliberately — the shrine is a *second* button, not a
       discount applied behind the player's back. See `tributesRequired`. */
    const need = tributesRequired(slug, state, me, true);
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
      // Never the monster that is arriving — see `targetCandidates`.
      const options = pickableUids(spec, uid);
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

  /* One pool builder, in `ui.ts`, asked by the board and by the regressions
     alike. It was a closure in here, so the only way to test it was to
     re-implement it — and a test that re-implements the rule agrees with the
     bug it is meant to catch. */
  const pickableUids = useCallback(
    /* `exclude` is the card doing the asking — see `targetCandidates`, which
       owns that rule now rather than the engine keeping it to itself. Required
       rather than optional: seven of the eight callers passed it and the eighth
       was `targetableSet`, the one every picker on screen draws from, so Gamma
       the Magnet Warrior offered itself as a Magnet Warrior to Special Summon.
       A rule that can be forgotten at one call site will be. */
    (spec: TargetSpec, exclude: string): string[] =>
      targetCandidates(state, me, spec, (c, owner) => effFlags(state, c, owner).untargetable === true, exclude).map(
        (c) => c.uid
      ),
    [state, me]
  );

  /**
   * Swing, or ask what to throw first. One function rather than a check at each
   * of the three places an attack is declared — a monster in a zone, the sheet's
   * own Attack button, and the Direct Attack button — because two of them would
   * have gone straight past the cost and the engine would have paid it with
   * whatever happened to be first in hand.
   */
  const swing = (uid: string, targetUid: string | null) => {
    const attacker = mine.monsters.find((m) => m?.uid === uid) ?? undefined;
    if (attacker && effFlags(state, attacker, me).attackCostDiscard && mine.hand.length > 0) {
      setMode({
        kind: 'handCost',
        purpose: 'attack',
        uid,
        targetUid,
        prompt: `Discard 1 card to attack with ${shownName(attacker) ?? CARDS[attacker.slug]?.name}`,
      });
      return;
    }
    void run({ type: 'attack', uid, targetUid });
  };

  const send = (
    source: 'spell' | 'ignition' | 'setcard' | 'trap' | 'flip',
    uid: string,
    targets: string[],
    effectIndex?: number
  ) => {
    if (source === 'trap') void run({ type: 'respondTrap', uid, targets });
    else if (source === 'spell') void run({ type: 'activateSpell', uid, targets });
    else if (source === 'ignition') void run({ type: 'ignition', uid, targets, effectIndex });
    else if (source === 'flip') void run({ type: 'changePosition', uid, targets });
    else void run({ type: 'activateSetCard', uid, targets });
  };

  const beginTargeting = (
    source: 'spell' | 'ignition' | 'setcard' | 'trap' | 'flip',
    uid: string,
    slug: string,
    trigger: 'activate' | 'ignition' | 'trap' | 'onFlip',
    /* Which ignition was pressed, for a card with more than one — the spec and
       the action both have to name the same effect, or the player answers one
       question and the engine resolves the other. */
    effectIndex?: number
  ) => {
    const spec = effectIndex != null ? targetSpecForEffect(slug, effectIndex) : targetSpecFor(slug, trigger);
    if (!spec) {
      /* No question of its own, but the monster it summons may have one. */
      const rider = source === 'spell' ? summonRiderSpec(slug, 'activate') : null;
      if (rider) {
        const riderOptions = pickableUids(rider, uid);
        const riderWant = rider.count ?? 1;
        if (riderOptions.length > riderWant) {
          setMode({ kind: 'target', source, uid, spec: rider, picked: [], carry: [], effectIndex });
          return;
        }
        send(source, uid, riderOptions.slice(0, riderWant), effectIndex);
        return;
      }
      send(source, uid, [], effectIndex);
      return;
    }
    const options = pickableUids(spec, uid);
    const want = spec.count ?? 1;

    /* Nothing it can legally point at. That is a reason to refuse only when the
       card would be spent for nothing — Ring of Destruction against a lone
       Celtic Guardian, which it can never target, left the zone and did
       nothing. It is *not* a reason when the card's worth is what it leaves on
       the field: Toon World with no Toon left in the Deck still opens, and the
       search simply finds nobody. The board used to decide this by itself and
       got the second case wrong; the engine is asked now. */
    const activating =
      mine.hand.find((h) => h.uid === uid) ??
      (mine.spellTrap?.uid === uid ? mine.spellTrap : undefined) ??
      mine.monsters.find((m) => m?.uid === uid) ??
      undefined;
    /* A Flip Summon is never refused for want of a target. Turning your own
       monster face-up is a play in itself — Man-Eater Bug goes up whether or
       not there is anything across the table to bite, and the effect simply
       finds nobody. Only a card being *spent* can be spent for nothing. */
    if (source !== 'flip' && options.length === 0 && (!activating || wastedWithoutTarget(state, me, activating, trigger))) {
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
      send(source, uid, options.slice(0, want), effectIndex);
      return;
    }
    setMode({ kind: 'target', source, uid, spec, picked: [], effectIndex });
  };

  /* What the monster you just picked wants to know, if anything. Looked up
     from the uid because the choice is only known at answer time. */
  const chosenSummonRider = (chosenUid: string): TargetSpec | null => {
    const found = [...mine.hand, ...mine.deck].find((c) => c.uid === chosenUid);
    return found ? summonTargetSpec(found.slug) : null;
  };

  const submitTargets = (picked: string[]) => {
    if (mode.kind !== 'target') return;
    const { source, uid, summon, carry, effectIndex } = mode;
    if (source === 'summon' && summon) {
      finishSummon(uid, summon.position, summon.face, summon.tributes, picked);
      return;
    }
    const answers = [...(carry ?? []), ...picked];
    /* A Spell that offers a choice of monsters asks which, once its cost is
       paid — Fortress Whale's Oath names two and used to take the bigger one
       on its own. And once that is answered, the monster chosen may have a
       question of its own: Crab Turtle wants to know what to send back. */
    if (source === 'spell') {
      const slug = mine.hand.find((h) => h.uid === uid)?.slug ?? '';
      const choice = !carry ? summonChoiceSpec(slug, 'activate') : null;
      if (choice) {
        const options = pickableUids(choice, uid);
        if (options.length > 1) {
          setMode({ kind: 'target', source, uid, spec: choice, picked: [], carry: answers });
          return;
        }
        if (options.length === 1) {
          const chosen = [...answers, options[0]];
          const solo = chosenSummonRider(options[0]);
          if (solo) {
            const riderOptions = pickableUids(solo, uid);
            if (riderOptions.length > (solo.count ?? 1)) {
              setMode({ kind: 'target', source, uid, spec: solo, picked: [], carry: chosen });
              return;
            }
            void run({ type: 'activateSpell', uid, targets: [...chosen, ...riderOptions.slice(0, solo.count ?? 1)] });
            return;
          }
          void run({ type: 'activateSpell', uid, targets: chosen });
          return;
        }
      }
      /* The answer just given names the monster that is coming — so now ask
         what *it* wants, if anything. */
      if (carry) {
        const rider2 = picked.length === 1 ? chosenSummonRider(picked[0]) : null;
        if (rider2) {
          const riderOptions = pickableUids(rider2, uid);
          if (riderOptions.length > (rider2.count ?? 1)) {
            setMode({ kind: 'target', source, uid, spec: rider2, picked: [], carry: answers, effectIndex });
            return;
          }
          void run({ type: 'activateSpell', uid, targets: [...answers, ...riderOptions.slice(0, rider2.count ?? 1)] });
          return;
        }
      }
    }
    if (source === 'spell' && !carry) {
      const slug = mine.hand.find((h) => h.uid === uid)?.slug ?? '';
      const rider = summonRiderSpec(slug, 'activate');
      if (rider) {
        const options = pickableUids(rider, uid);
        const want = rider.count ?? 1;
        if (options.length > want) {
          setMode({ kind: 'target', source, uid, spec: rider, picked: [], carry: answers, effectIndex });
          return;
        }
        if (options.length) {
          void run({ type: 'activateSpell', uid, targets: [...answers, ...options.slice(0, want)] });
          return;
        }
      }
    }
    if (source === 'spell') void run({ type: 'activateSpell', uid, targets: answers });
    else if (source === 'ignition') void run({ type: 'ignition', uid, targets: picked, effectIndex });
    else if (source === 'setcard') void run({ type: 'activateSetCard', uid, targets: picked });
    else if (source === 'trap') void run({ type: 'respondTrap', uid, targets: picked });
    else if (source === 'flip') void run({ type: 'changePosition', uid, targets: picked });
  };

  const onPickTarget = (uid: string) => {
    if (mode.kind !== 'target') return;
    const picked = [...mode.picked, uid];
    sfx.click();
    if (picked.length >= mode.spec.count) submitTargets(picked);
    else setMode({ ...mode, picked });
  };

  const targetableSet = useMemo(() => {
    /* `mode.uid` is the card doing the asking, and it is never one of its own
       answers — the rule `targetCandidates` owns. The gate that decides whether
       to open this modal at all has always passed it; the modal itself did not,
       so Gamma the Magnet Warrior laid itself out as a Magnet Warrior to
       Special Summon while it was the card being Summoned. Reported. Every
       other picker on screen filters through this set, so saying it here says
       it everywhere. */
    if (mode.kind === 'target') return new Set(pickableUids(mode.spec, mode.uid).filter((u) => !mode.picked.includes(u)));
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
        /* Your own bodies *and* anything lent to you this turn — Soul Exchange
           leaves the opponent's monsters where they stand and makes them
           spendable, and a modal that only drew your own zones offered a
           Tribute Summon the engine would accept and the player could not
           reach. Asked of the engine rather than worked out here again. */
        tributableBodies(state, me).filter((m) => !mode.picked.includes(m.uid)).map((m) => m.uid)
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
            else if (mode.kind === 'attack') swing(mode.uid, c.uid);
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
                displayName={shownName(c)}
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
      /* What the bodies cost, with the shrine left out of it. Serket's Temple
         is an alternative price and gets its own button below; folding it in
         here priced the Tribute Summon at nothing, so the only route the board
         offered was the one that needs a free Monster Zone — and a full board,
         which is exactly when a Tribute Summon is wanted, could not Summon it
         at all. Reported. */
      const need = tributesRequired(handCard.slug, state, me, true);
      const bodies = tributableBodies(state, me).length;
      /* Asked, not worked out. This line counted `mine.monsters` and so had no
         idea that Soul Exchange had just lent three payable bodies — see
         `summonAffordable`, which is where the rule lives now. */
      const roomFor = summonAffordable(state, me, handCard.slug);
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
      /* The cheap way in. Only offered when there is a price to skip and the
         card says it may — one button rather than a second modal, because the
         choice is the whole of it and the label states what it costs. */
      if (!gate && need > 0 && handDef.mayForgoTributes) {
        acts.push({
          label: 'Summon untributed (half ATK/DEF)',
          disabled: !(myTurn && state.phase === 'main' && !mine.normalSummonUsed && freeZone),
          hint: !freeZone ? 'No free Monster Zone' : mine.normalSummonUsed ? 'Already summoned this turn' : undefined,
          run: () => finishSummon(handCard.uid, 'atk', 'up', []),
        });
      }
      /* The other way in, for the one card that has one. Serket is Normal
         Summoned either by paying two bodies or by banishing the Temple that
         was holding it, and those are two different Summons with two different
         costs — so they are two buttons, and the player says which. A single
         route that silently spent the Temple was not the card. */
      const shrine = summonBanishFor(handCard.slug);
      const shrineReady = !!shrine && mine.field?.slug === shrine && mine.field.face === 'up';
      if (!gate && need > 0 && shrine && shrineReady) {
        acts.push({
          label: `Normal Summon (banish ${CARDS[shrine].name})`,
          disabled: !(myTurn && state.phase === 'main' && !mine.normalSummonUsed && freeZone),
          hint: !freeZone ? 'No free Monster Zone' : mine.normalSummonUsed ? 'Already summoned this turn' : undefined,
          run: () => finishSummon(handCard.uid, 'atk', 'up', []),
        });
      }
      /* Spent from the hand rather than played onto the field. Offered on the
         monster itself, because that is where the player is looking when they
         are holding a card they cannot afford to summon. */
      /* Bought down rather than summoned. Offered whether or not the Normal
         Summon is still available, because that is the point of it: the herd
         arrives faster than the turn count allows. */
      /* The price, the label and the reason the button is dark all come out of
         the engine together. Working it out here priced every self-summon at
         "discard 1" — true of the batch that introduced the trigger and of
         nothing since, so a card whose route is a Graveyard banish or simply
         standing beside a Machine was offered a discard prompt it has no use
         for and refused for want of a card it never needed. */
      const offer = handSummonOffer(state, me, handCard);
      if (offer) {
        const price = offer.discard
          ? ` (discard ${offer.discard})`
          : offer.banish
            ? ` (banish ${CARDS[offer.banish].name})`
            : '';
        acts.push({
          label: `Special Summon${price}`,
          disabled: !offer.ok,
          hint: offer.why,
          run: () => {
            sfx.click();
            if (!offer.discard) {
              void run({ type: 'handSummon', uid: handCard.uid });
              return;
            }
            setMode({
              kind: 'handCost',
              purpose: 'summon',
              uid: handCard.uid,
              prompt: `Discard ${offer.discard} card to Special Summon ${handDef.name}`,
            });
          },
        });
      }
      if (handDef.effects.some((e) => e.trigger === 'handDiscard')) {
        /* Asked, not assumed. The button checked the turn and the phase and
           nothing else, so Zolga could be thrown into an empty backrow and the
           player lost a monster for nothing. Reported. */
        const canThrow = canDiscardForEffect(state, me, handCard);
        acts.push({
          label: 'Discard for its effect',
          disabled: !canThrow,
          hint: !myTurn
            ? 'Not your turn'
            : state.phase !== 'main'
              ? 'Main Phase only'
              : !canThrow
                ? 'There is nothing that effect can do right now'
                : undefined,
          run: () => {
            sfx.click();
            void run({ type: 'discardForEffect', uid: handCard.uid });
          },
        });
      }
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
          /* The zone is asked about first, including for Polymerization.
             Spending it is activating a Normal Spell, so a full zone refuses
             the Fusion and the button disappears with it — and the old hint
             said "Use the Fusion button" regardless, pointing at something
             that is no longer on screen. */
          hint: !canAct
            ? mine.spellTrap
              ? 'Spell/Trap Zone is full'
              : handDef.slug === 'polymerization'
                ? 'Use the Fusion button'
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
  /* Wherever the options happen to be lying — a Graveyard, a Deck, either
     player's field. The engine settled the list when it opened the window, so
     the board lays out exactly what it will accept. */
  const chooseCards: CardInstance[] = choosing2
    ? choosing2.options
        .map((uid) => {
          for (const pid of [me, foe] as PlayerId[]) {
            const p = state.players[pid];
            const hit =
              p.monsters.find((m) => m?.uid === uid) ??
              p.grave.find((c) => c.uid === uid) ??
              p.hand.find((c) => c.uid === uid) ??
              p.deck.find((c) => c.uid === uid) ??
              (p.spellTrap?.uid === uid ? p.spellTrap : undefined) ??
              (p.field?.uid === uid ? p.field : undefined);
            if (hit) return hit;
          }
          return null;
        })
        .filter((c): c is CardInstance => !!c)
    : [];
  const pendingCards = pendingPrompt
    ? state.pending!.options
        .map((uid) => mine.hand.find((h) => h.uid === uid) ?? (mine.spellTrap?.uid === uid ? mine.spellTrap : null))
        .filter((c): c is CardInstance => !!c)
    : [];

  return (
    /* `data-unspoken` is how many beats the board still owes the player. It is
       the exact quantity the win screen waits on, so a probe can check the
       thing itself rather than a stand-in: the first version of
       `npm run winscreen` asserted "a Life Point bar reads 0", which is only
       true of a duel that ended on damage — a deck-out ended one on 8700/5100
       and the check went red against working code. */
    <div data-unspoken={unspoken.length} className={`duel-root relative flex w-full flex-col overflow-hidden ${shakeOn ? 'hit-shake' : ''}`}>
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
            {/* The spectator's pause. It shares the bottom row the way the
                bracket button does — this column being three rows tall is what
                sets the height of the whole strip, and a fourth row once moved
                the entire board. An exhibition never has a bracket, so the row
                never holds more than two. */}
            {spectator && setPaused && (
              <button
                className={`btn rounded px-2 py-1 text-[10px] ${paused ? 'btn-primary' : ''}`}
                data-testid="pause-toggle"
                onClick={() => {
                  sfx.click();
                  setPaused(!paused);
                }}
                title={paused ? 'Resume the duel' : 'Pause the duel'}
              >
                {paused ? '▶' : '⏸'}
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
          /* The audience sees both hands open — that is what makes two
             computers worth watching — and a tap reads the card, since at this
             width the art is a hint rather than a name. Same wrapper either
             way, so the strip cannot sit differently in an exhibition. */
          <div key={c.uid} className="w-[clamp(20px,3.4vw,34px)]" onClick={spectator ? () => setInspect(c) : undefined}>
            <GameCard card={c} faceDown={!spectator} compact />
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
            displayName={shownName(inspect)}
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
                    // The audience reads cards; only a player plays them.
                    if (spectator) return setInspect(c);
                    if (mode.kind === 'target' && targetableSet.has(c.uid)) return onPickTarget(c.uid);
                    if (!busy && !state.winner) {
                      sfx.click();
                      setMode({ kind: 'hand', uid: c.uid });
                    }
                  }}
                  onPointerEnter={hoverInspect(c)}
                >
                  <GameCard card={c} displayName={shownName(c)} />
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
                {view.aiToMove && !(spectator && paused) && (
                  <span className="h-2.5 w-2.5 shrink-0 animate-spin rounded-full border border-brass/40 border-t-brass" />
                )}
                {spectator && paused
                  ? 'Paused'
                  : state.pending
                    ? 'Responding…'
                    : view.aiToMove
                      ? 'Thinking…'
                      : 'Their turn'}
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
            <GameCard card={previewInstances([[fx.slug!, 1]])[0]} displayName={toonDisplayName(fx.slug!, bookOpenFor(fx.player))} />
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
            <GameCard card={previewInstances([[fx!.slug!, 1]])[0]} displayName={toonDisplayName(fx!.slug!, bookOpenFor(fx!.player))} />
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
          data-testid="hand-sheet"
          className="absolute inset-0 z-40 flex items-end justify-center bg-black/55 p-3 sm:items-center"
          style={{ paddingTop: 'calc(var(--safe-top) + 0.75rem)', paddingBottom: 'calc(var(--safe-bottom) + 0.75rem)' }}
          onClick={() => setMode({ kind: 'idle' })}
        >
          <div className="panel grain w-full max-w-md rounded p-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex gap-3">
              <div className="w-24 shrink-0">
                <GameCard card={handCard} displayName={shownName(handCard)} />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-display text-base text-parchment">{shownName(handCard) ?? handDef.name}</h3>
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
                <GameCard card={monsterCard} {...statsOf(monsterCard, me)} displayName={shownName(monsterCard)} />
              </div>
              <div className="min-w-0 flex-1">
                {/* The sheet you get by tapping your own monster on your own
                    turn. It read the printed name while the inspector you get
                    on the opponent's turn read the Toon one, so a drawing
                    appeared to change its name every time the turn passed. */}
                <h3 className="font-display text-base text-parchment">{shownName(monsterCard) ?? monsterDef.name}</h3>
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
                      swing(monsterCard.uid, null);
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
              {/* One button per ignition the card can currently afford. A card
                  used to be allowed exactly one; Obelisk carries two, and a
                  second effect the board never draws is a second effect that
                  does not exist. */}
              {ignitionOptions(state, me, monsterCard).map((opt) => (
                <button
                  key={opt.index}
                  className="btn btn-primary rounded px-3 py-2 text-xs"
                  onClick={() => {
                    sfx.click();
                    beginTargeting('ignition', monsterCard.uid, monsterCard.slug, 'ignition', opt.index);
                  }}
                >
                  ✦ {opt.label}
                </button>
              ))}
              {canChangePosition(state, me, monsterCard) && (
                <button
                  className="btn rounded px-3 py-2 text-xs"
                  onClick={() => {
                    sfx.click();
                    /* Only a Flip Summon has an effect to aim. Switching an
                       already face-up monster between Attack and Defence asks
                       nothing and must not open a prompt. */
                    if (monsterCard.face === 'down') {
                      beginTargeting('flip', monsterCard.uid, monsterCard.slug, 'onFlip');
                    } else {
                      void run({ type: 'changePosition', uid: monsterCard.uid });
                    }
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
                onClick={() => swing(mode.uid, null)}
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

      {/* What to throw. The card being summoned is not on the menu — feeding it
          to itself would leave nothing to arrive — and an attack may spend
          anything, the King included, because a hand is a hand. */}
      {mode.kind === 'handCost' && (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-black/75 p-4"
          style={{ paddingTop: 'calc(var(--safe-top) + 1rem)', paddingBottom: 'calc(var(--safe-bottom) + 1rem)' }}
          onClick={() => setMode({ kind: 'idle' })}
        >
          <div className="panel grain thin-scroll max-h-[76dvh] w-full max-w-2xl overflow-y-auto rounded p-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-display text-sm text-parchment">{mode.prompt}</h3>
              <button className="btn shrink-0 rounded px-2 py-1 text-[10px]" onClick={() => setMode({ kind: 'idle' })}>
                ✕
              </button>
            </div>
            <div className="brass-rule my-2" />
            <div className="flex flex-wrap gap-2">
              {mine.hand
                .filter((c) => mode.purpose === 'attack' || c.uid !== mode.uid)
                .map((c) => (
                  <button
                    key={c.uid}
                    className="w-[76px] text-left selectable rounded"
                    onClick={() => {
                      const chosen = mode;
                      sfx.click();
                      setMode({ kind: 'idle' });
                      if (chosen.purpose === 'summon') void run({ type: 'handSummon', uid: chosen.uid, discardUid: c.uid });
                      else void run({ type: 'attack', uid: chosen.uid, targetUid: chosen.targetUid ?? null, discardUid: c.uid });
                    }}
                  >
                    <GameCard card={c} displayName={shownName(c)} />
                    <p className="mt-0.5 truncate text-center text-[9px] text-ptextdim">{shownName(c) ?? CARDS[c.slug]?.name}</p>
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* Deck search (Toon World, Toon Alligator). Your own deck, so showing it
          gives nothing away — and picking beats being handed whatever the
          shuffle put nearest the top. */}
      {mode.kind === 'target' &&
        (mode.spec.zone === 'deck' ||
          mode.spec.zone === 'handOrDeck' ||
          mode.spec.zone === 'deckOrGrave' ||
          mode.spec.zone === 'handOrDeckOrGrave') && (
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
            {/* Exactly what the picker counts as legal, so the modal can never
                show a card the pick would then refuse. */}
            <div className="flex flex-wrap gap-2">
              {/* Every private pile, filtered by what the picker actually
                  accepts. A multi-pile spec — "from your hand, Deck or
                  Graveyard" — is one choice rather than three prompts, and
                  drawing the piles this modal *thinks* the zone means is how a
                  picker ends up narrower than the card: `targetableSet` is the
                  authority, and each option says which pile it came from so the
                  player is not guessing. */}
              {[...mine.hand, ...mine.deck, ...mine.grave]
                .filter((c) => targetableSet.has(c.uid))
                .map((c) => (
                  <button key={c.uid} className="w-[76px] text-left selectable rounded" onClick={() => onPickTarget(c.uid)}>
                    <GameCard card={c} displayName={shownName(c)} />
                    <p className="mt-0.5 truncate text-center text-[9px] text-ptextdim">{shownName(c) ?? CARDS[c.slug]?.name}</p>
                    {mode.spec.zone !== 'deck' && (
                      <p className="truncate text-center text-[8px] uppercase tracking-wide text-brass">
                        {mine.hand.some((h) => h.uid === c.uid)
                          ? 'hand'
                          : mine.deck.some((d) => d.uid === c.uid)
                            ? 'deck'
                            : 'grave'}
                      </p>
                    )}
                  </button>
                ))}
            </div>
            {![...mine.hand, ...mine.deck, ...mine.grave].some((c) => targetableSet.has(c.uid)) && (
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
            {/* The filter, which this list did not apply either — so an effect
                naming exactly which cards it takes laid out the whole
                Graveyard and asked you to find them. */}
            <div className="mt-3 flex flex-wrap gap-2">
              {/* One rule, in `ui.ts`, asked by the modal and by the regressions
                  alike — see `pickerSides`. Written inline here it read
                  "both ? [me, foe] : [me]", so Graverobber's opponent-only pile
                  listed my own Graveyard and opened empty. */}
              {pickerSides(mode.spec, me, foe).flatMap((pid) =>
                state.players[pid].grave
                  .filter((c) => targetableSet.has(c.uid))
                  .map((c) => (
                    <div key={c.uid} className="w-[72px] cursor-pointer selectable rounded" onClick={() => onPickTarget(c.uid)}>
                      <GameCard card={c} displayName={shownName(c)} />
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

      {/* A card of mine asking me which card it should take. */}
      {choosing2 && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
             style={{ paddingTop: 'calc(var(--safe-top) + 1rem)', paddingBottom: 'calc(var(--safe-bottom) + 1rem)' }}>
          <div className="panel grain thin-scroll max-h-[80dvh] w-full max-w-2xl overflow-y-auto rounded p-4">
            <h3 className="font-display text-lg text-brassbright">Your choice</h3>
            <p className="mt-1 text-xs text-ptext/85">{choosing2.reason}</p>
            <div className="brass-rule my-3" />
            <div className="flex flex-wrap justify-center gap-3">
              {chooseCards
                .filter((c) => !choicePicks.includes(c.uid))
                .map((c) => {
                const theirs = state.players[foe].spellTrap?.uid === c.uid
                  || state.players[foe].field?.uid === c.uid
                  || state.players[foe].monsters.some((m) => m?.uid === c.uid)
                  || state.players[foe].grave.some((g) => g.uid === c.uid);
                return (
                  <button
                    key={c.uid}
                    className="w-24 selectable rounded"
                    onClick={() => {
                      sfx.click();
                      const next = [...choicePicks, c.uid];
                      /* Send as soon as the card has what it asked for; until
                         then the pick is held so a "up to 2" can take two. */
                      if (next.length >= choosing2.want) {
                        setChoicePicks([]);
                        void run({ type: 'chooseCard', uids: next });
                      } else {
                        setChoicePicks(next);
                      }
                    }}
                  >
                    <GameCard card={c} displayName={shownName(c)} />
                    <p className="mt-0.5 truncate text-center text-[9px] text-ptextdim">{shownName(c) ?? CARDS[c.slug]?.name}</p>
                    {/* Whose it is, because "up to 2 Spell or Trap cards on the
                        field" reaches your own side too and the two piles look
                        the same in a row. */}
                    <p className="truncate text-center text-[8px] uppercase tracking-wide text-brass">{theirs ? 'theirs' : 'yours'}</p>
                  </button>
                );
              })}
            </div>
            {/* "Up to" means declining is an answer, so there has to be a way to
                give it. Without one the only way past the window was to destroy
                something you did not want to. */}
            {choosing2.optional && (
              <div className="mt-3 flex justify-center">
                <button
                  className="btn rounded px-4 py-1.5 text-[11px]"
                  onClick={() => {
                    sfx.click();
                    const picks = choicePicks;
                    setChoicePicks([]);
                    void run({ type: 'chooseCard', uids: picks });
                  }}
                >
                  {choicePicks.length ? `Take ${choicePicks.length} and stop` : 'Take none'}
                </button>
              </div>
            )}
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
                  <GameCard card={c} displayName={shownName(c)} />
                  <p className="mt-1 text-center font-display text-[10px] text-parchment">{shownName(c) ?? CARDS[c.slug]?.name}</p>
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
                  displayName={shownName(graveInspect)}
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
                  <GameCard card={c} displayName={shownName(c)} />
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
              displayName={shownName(inspect)}
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
        <div data-testid="win-screen" className="absolute inset-0 z-[60] grid place-items-center bg-black/85 p-6">
          <div className="panel grain w-full max-w-md rounded p-6 text-center">
            <p className="font-display text-3xl tracking-wide" style={{ color: spectator || state.winner === me ? '#e6c980' : '#c98a8a' }}>
              {state.winner === 'draw'
                ? 'Draw'
                : spectator
                  ? /* The audience has no side, so the screen names the duelist
                       rather than calling somebody's loss yours. */
                    `${state.players[state.winner === 'p1' ? 'p1' : 'p2'].name} wins`
                  : wonTheKingdom
                    ? '👑 Champion of the Kingdom'
                    : state.winner === me
                      ? 'Victory'
                      : 'Defeat'}
            </p>
            <p className="mt-2 text-sm text-ptext/85">
              {wonTheKingdom ? 'You have won the final. The Kingdom is yours.' : state.winReason}
            </p>
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
              {onStoryReturn ? (
                /* A story duel has no rematch here and no lobby: Mai offers the
                   next one herself, in the conversation this came out of, and
                   what she says depends on the result — so the result travels
                   back with the player rather than being asked for again. */
                <button
                  className="btn btn-primary rounded px-4 py-2 text-xs"
                  data-story-return
                  onClick={() => {
                    sfx.click();
                    onStoryReturn(state.winner === me);
                  }}
                >
                  Continue
                </button>
              ) : onBracket ? (
                /* A bracket match has no rematch: the result stands. */
                <button className="btn btn-primary rounded px-4 py-2 text-xs" onClick={onBracket}>
                  {wonTheKingdom ? 'See the finished bracket' : 'To the bracket'}
                </button>
              ) : spectator ? (
                /* Both duelists are the computer, so one tap runs it back —
                   and the lobby is a seated player's screen, so the way out
                   is home rather than "choose new duelists". */
                <>
                  <button className="btn btn-primary rounded px-4 py-2 text-xs" onClick={rematch}>
                    Run it back
                  </button>
                  <Link className="btn rounded px-4 py-2 text-xs" href="/">
                    Back to the arena
                  </Link>
                </>
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
