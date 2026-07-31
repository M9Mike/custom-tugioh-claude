'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import GameCard from './GameCard';
import CardDetail from './CardDetail';
import { CARDS, DUELIST_BY_ID, artUrl } from '@/game/cards';
import { AI_LEVEL_LABELS } from '@/game/ai-levels';
import {
  canActivateFromHand,
  canActivateSetCard,
  canAttackWith,
  canChangePosition,
  canIgnite,
  effAtk,
  effDef,
  fusionOptions,
  legalAttackTargets,
  maxAttacks,
  monstersFrozen,
  other,
  tributesRequired,
} from '@/game/engine';
import { effectLabel, summonTargetSpec, targetSpecFor, type TargetSpec } from '@/game/ui';
import { getSfxEnabled, primeAudio, setSfxEnabled, sfx } from '@/lib/sfx';
import type { AnimEvent, CardInstance, DuelAction, DuelState, PlayerId } from '@/game/types';
import type { RoomView } from '@/server/rooms';

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
}

/* The board is sized from the space actually left after the fixed chrome, so
   the field fills a desktop screen instead of floating in a sea of empty. */
const BOARD_CARD = 'w-[var(--cw)]';
const SIDE_CARD = 'w-[var(--sw)]';
const HAND_CARD = 'w-[var(--hw)]';

export default function Duel({ view, act, rematch, toLobby, connection }: Props) {
  const state = view.state!;
  const me = view.you;
  const foe = other(me);
  const mine = state.players[me];
  const theirs = state.players[foe];

  const [mode, setMode] = useState<Mode>({ kind: 'idle' });
  const [inspect, setInspect] = useState<CardInstance | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ text: string; tone: string } | null>(null);
  const [floats, setFloats] = useState<{ id: string; who: PlayerId; text: string; tone: string }[]>([]);
  const [shakeOn, setShakeOn] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [graveOpen, setGraveOpen] = useState<PlayerId | null>(null);
  /* The Graveyard viewer carries its own inspector. The board's one only opens
     on hover, which a phone never sends, so a card in here could not be read at
     all on the devices this is built for. */
  const [graveInspect, setGraveInspect] = useState<CardInstance | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  const seenAnims = useRef<Set<string>>(new Set());
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    primeAudio();
    setSoundOn(getSfxEnabled());
  }, []);

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
  const busy = !!state.pending && !respondingToTrap;

  /* ---------------- animation + sound reactions ---------------- */
  useEffect(() => {
    const fresh = state.anims.filter((a) => !seenAnims.current.has(a.id));
    if (!fresh.length) return;
    for (const a of fresh) seenAnims.current.add(a.id);
    if (seenAnims.current.size > 400) seenAnims.current = new Set([...seenAnims.current].slice(-200));

    let damaged = false;
    for (const a of fresh) {
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
          if (a.text) setBanner({ text: a.text, tone: 'fusion' });
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
          if (a.text) setBanner({ text: a.text, tone: 'spell' });
          break;
        case 'trap':
          sfx.trap();
          if (a.text) setBanner({ text: a.text, tone: 'trap' });
          break;
        case 'phase':
          sfx.phase();
          if (a.text) setBanner({ text: a.text, tone: 'phase' });
          break;
        case 'damage':
          damaged = true;
          sfx.damage();
          pushFloat(a, `-${a.amount}`, 'dmg');
          break;
        case 'heal':
          sfx.heal();
          pushFloat(a, `+${a.amount}`, 'heal');
          break;
        case 'win':
          break;
      }
    }
    if (damaged) {
      setShakeOn(true);
      setTimeout(() => setShakeOn(false), 460);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.version]);

  function pushFloat(a: AnimEvent, text: string, tone: string) {
    if (!a.player) return;
    const id = `${a.id}_${Math.random()}`;
    setFloats((f) => [...f, { id, who: a.player!, text, tone }]);
    setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 1600);
  }

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 1900);
    return () => clearTimeout(t);
  }, [banner]);

  useEffect(() => {
    if (!state.winner) return;
    if (state.winner === me) sfx.win();
    else if (state.winner !== 'draw') sfx.lose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.winner]);

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
        setToast(err);
        setTimeout(() => setToast(null), 2600);
      }
    },
    [act]
  );

  useEffect(() => {
    // Any state change from the server invalidates a half-built interaction —
    // the cards it referred to may already be gone.
    setMode({ kind: 'idle' });
    setInspect(null);
  }, [state.version]);

  /* ---------------- derived helpers ---------------- */
  /** Hover preview — mouse only, so taps never trigger it. */
  const hoverInspect = (c: CardInstance | null) => (e: React.PointerEvent) => {
    if (c && e.pointerType === 'mouse') setInspect(c);
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
    if (spec && hasPickable(spec)) {
      setMode({ kind: 'target', source: 'summon', uid, spec, picked: [], summon: { position, face, tributes } });
      return;
    }
    // Tributes free a zone, so resolve the destination after they are paid.
    const zone = Math.max(0, mine.monsters.findIndex((m) => !m || tributes.includes(m.uid)));
    void run({ type: 'normalSummon', uid, zone, position, face, tributes, targets });
  };

  const hasPickable = (spec: TargetSpec): boolean => pickableUids(spec).length > 0;

  const pickableUids = useCallback(
    (spec: TargetSpec): string[] => {
      const sides: PlayerId[] = spec.side === 'own' ? [me] : spec.side === 'opp' ? [foe] : [me, foe];
      const out: string[] = [];
      for (const pid of sides) {
        const p = state.players[pid];
        if (spec.zone === 'monster') out.push(...p.monsters.filter((m): m is CardInstance => !!m).map((m) => m.uid));
        else if (spec.zone === 'spellTrap') {
          if (p.spellTrap) out.push(p.spellTrap.uid);
          if (p.field) out.push(p.field.uid);
        } else if (spec.zone === 'grave') {
          out.push(...p.grave.filter((c) => CARDS[c.slug]?.kind === 'monster').map((c) => c.uid));
        } else if (spec.zone === 'hand' && pid === me) out.push(...p.hand.map((c) => c.uid));
      }
      return out;
    },
    [state, me, foe]
  );

  const beginTargeting = (source: 'spell' | 'ignition' | 'setcard' | 'trap', uid: string, slug: string, trigger: 'activate' | 'ignition' | 'trap') => {
    const spec = targetSpecFor(slug, trigger);
    if (!spec || !hasPickable(spec)) {
      if (source === 'trap') void run({ type: 'respondTrap', uid, targets: [] });
      else if (source === 'spell') void run({ type: 'activateSpell', uid, targets: [] });
      else if (source === 'ignition') void run({ type: 'ignition', uid, targets: [] });
      else void run({ type: 'activateSetCard', uid, targets: [] });
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
        mine.monsters.filter((m): m is CardInstance => !!m && !m.isToken && !mode.picked.includes(m.uid)).map((m) => m.uid)
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

  const renderMonsterZone = (owner: PlayerId, idx: number) => {
    const p = state.players[owner];
    const c = p.monsters[idx];
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
          // fire an ignition effect. Everything else just inspects.
          if (isMine && myTurn && (attackable || selectable)) {
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
              <GameCard
                card={c}
                {...statsOf(c, owner)}
                faceDown={c.face === 'down'}
                compact
              />
            </div>
            {c.face === 'up' && (
              <div className="pointer-events-none absolute bottom-0 left-0 right-0 flex justify-between bg-black/70 px-1 font-display text-[9px] leading-tight text-parchment">
                <span>{statsOf(c, owner).atk}</span>
                <span className="text-brass">{c.position === 'atk' ? 'ATK' : 'DEF'}</span>
                <span>{statsOf(c, owner).def}</span>
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
    const activatable = isMine && !!c && myTurn && canActivateSetCard(state, me, c);
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

  const PlayerBar = ({ pid, top }: { pid: PlayerId; top: boolean }) => {
    const p = state.players[pid];
    const duelist = DUELIST_BY_ID[p.duelistId];
    const isActive = state.active === pid && !state.winner;
    const lpPct = Math.max(0, Math.min(100, (p.lp / 4000) * 100));
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
              {p.name}
              {view.seats[pid]?.ai && (
                <span className="ml-1 align-middle text-[9px] uppercase tracking-wider text-brass">
                  CPU · {AI_LEVEL_LABELS[view.seats[pid]!.ai!].name}
                </span>
              )}
            </span>
            <span className="font-display text-sm tabular-nums text-brassbright">{p.lp}</span>
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
          <span title="Cards in hand">✋{p.hand.length}</span>
          <span title="Cards left in Deck">🂠{p.deck.length}</span>
          <button
            className="btn rounded px-1 py-0.5 text-[9px]"
            onClick={() => setGraveOpen(pid)}
            title="View Graveyard"
          >
            ⚰{p.grave.length}
          </button>
        </div>
        {floats
          .filter((f) => f.who === pid)
          .map((f) => (
            <span
              key={f.id}
              className={`float-number pointer-events-none absolute ${top ? 'top-8' : '-top-4'} right-16 text-xl font-bold ${
                f.tone === 'dmg' ? 'text-[#e0555f]' : 'text-[#8fd18a]'
              }`}
            >
              {f.text}
            </span>
          ))}
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
      const bodies = mine.monsters.filter((m): m is CardInstance => !!m && !m.isToken).length;
      const canSummon = myTurn && state.phase === 'main' && !mine.normalSummonUsed && freeZone && bodies >= need;
      const isExtra = handDef.isFusion && mine.extra.some((e) => e.slug === handCard.slug);
      acts.push({
        label: need > 0 ? `Tribute Summon (${need})` : 'Normal Summon',
        disabled: !canSummon || isExtra,
        hint: isExtra ? 'Must be Fusion Summoned' : !canSummon ? (mine.normalSummonUsed ? 'Already summoned this turn' : need > bodies ? `Needs ${need} tribute(s)` : undefined) : undefined,
        run: () => startSummon(handCard.uid, 'atk', 'up'),
      });
      acts.push({
        label: 'Set (face-down)',
        disabled: !canSummon || isExtra,
        run: () => startSummon(handCard.uid, 'def', 'down'),
      });
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
  const pendingPrompt = respondingToTrap && state.pending;
  const pendingCards = pendingPrompt
    ? state.pending!.options
        .map((uid) => mine.hand.find((h) => h.uid === uid) ?? (mine.spellTrap?.uid === uid ? mine.spellTrap : null))
        .filter((c): c is CardInstance => !!c)
    : [];

  return (
    <div className={`duel-root relative flex w-full flex-col overflow-hidden ${shakeOn ? 'shake' : ''}`}>
      {/* ---- top strip ---- */}
      <div className="flex shrink-0 items-center gap-2 px-2 pt-2">
        <div className="min-w-0 flex-1">
          <PlayerBar pid={foe} top />
        </div>
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
        </div>
      </div>

      {/* ---- opponent hand (backs only) ---- */}
      <div className="flex shrink-0 justify-center gap-0.5 px-2 py-1">
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

      {/* ---- my bar + hand + controls ---- */}
      <div className="shrink-0 px-2 pb-2 pt-1">
        <PlayerBar pid={me} top={false} />

        <div className="mt-1.5 flex items-end gap-2">
          <div className="thin-scroll flex min-w-0 flex-1 items-end overflow-x-auto px-1 pb-2 pt-3">
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

          <div className="flex shrink-0 flex-col gap-1">
            {fusions.length > 0 && (
              <button
                className="btn btn-primary rounded px-2 py-1.5 text-[10px]"
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

      {banner && (
        <div className="pointer-events-none absolute inset-x-0 top-[38%] z-40 flex justify-center px-4">
          <div
            className={`banner rounded border px-6 py-2 text-center font-display text-lg tracking-wide shadow-2xl sm:text-2xl ${
              banner.tone === 'trap'
                ? 'border-[#ab5a86] bg-[#2a1420]/95 text-[#f0c2da]'
                : banner.tone === 'fusion'
                  ? 'border-violet2 bg-[#1e1630]/95 text-[#d9c6f5]'
                  : banner.tone === 'phase'
                    ? 'border-brassdim bg-ink/95 text-brassbright'
                    : 'border-sea bg-[#0f2422]/95 text-[#bfe8e2]'
            }`}
          >
            {banner.text}
          </div>
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
        <div className="absolute inset-0 z-40 flex items-end justify-center bg-black/55 p-3 sm:items-center" onClick={() => setMode({ kind: 'idle' })}>
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
                    setMode({ kind: 'attack', uid: monsterCard.uid });
                  }}
                >
                  ⚔ Attack ({maxAttacks(state, monsterCard, me) - monsterCard.attacksUsed} left)
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
        <div className="pointer-events-none absolute inset-x-0 top-2 z-30 flex justify-center px-3">
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
            <h3 className="font-display text-sm text-parchment">
              {state.players[graveOpen].name}&apos;s Graveyard ({state.players[graveOpen].grave.length})
            </h3>
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
        <div className="absolute inset-y-0 right-0 z-40 flex w-full max-w-sm flex-col panel grain p-3">
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

      {/* win screen */}
      {state.winner && (
        <div className="absolute inset-0 z-[60] grid place-items-center bg-black/85 p-6">
          <div className="panel grain w-full max-w-md rounded p-6 text-center">
            <p className="font-display text-3xl tracking-wide" style={{ color: state.winner === me ? '#e6c980' : '#c98a8a' }}>
              {state.winner === 'draw' ? 'Draw' : state.winner === me ? 'Victory' : 'Defeat'}
            </p>
            <p className="mt-2 text-sm text-ptext/85">{state.winReason}</p>
            <div className="brass-rule my-4" />
            <div className="flex flex-col gap-2">
              <button className="btn btn-primary rounded px-4 py-2 text-xs" onClick={rematch}>
                {view.rematch.includes(me) ? 'Waiting for your opponent…' : 'Rematch'}
              </button>
              <button className="btn rounded px-4 py-2 text-xs" onClick={toLobby}>
                Choose new duelists
              </button>
            </div>
            {view.rematch.length === 1 && !view.rematch.includes(me) && (
              <p className="mt-3 text-[11px] text-brass">Your opponent wants a rematch!</p>
            )}
          </div>
        </div>
      )}

      {/* connection banner */}
      {connection !== 'live' && (
        <div className="absolute inset-x-0 top-0 z-[70] bg-oxblood/90 py-1 text-center text-[11px] text-parchment">
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
