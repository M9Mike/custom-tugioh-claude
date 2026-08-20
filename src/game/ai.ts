/**
 * The computer opponent.
 *
 * Not a scripted bot: it searches. A turn in this game is a *sequence* of
 * decisions (summon, activate, attack, end), so the AI runs a beam search over
 * whole-turn sequences, then judges the best candidate plans against several
 * sampled futures — worlds in which everything it cannot see has been redealt —
 * and plays the plan that holds up across all of them.
 *
 * It cannot see hidden information, and that promise is structural rather than
 * aspirational. Three things used to leak through the simulation and are closed
 * by the world sampling:
 *
 *  - Attacking a face-down monster in the search resolved the battle against
 *    the real card. Now the search world carries a stand-in body, and the
 *    scoring worlds carry *samples* drawn from the cards it has not seen.
 *  - The RNG lives in `state.seed`, so simulating a coin flip revealed the
 *    exact result the real flip would produce. Every world re-salts the seed;
 *    averaging across worlds turns gamble cards back into gambles.
 *  - The lookahead modelled the opponent's reply using their real hand. In a
 *    sampled world their hand is dealt from the pool of cards the AI has not
 *    seen, so the model plays a *plausible* opponent, never the actual one.
 */
import { CARDS } from './cards';
import {
  applyAction,
  canActivateFromHand,
  canActivateSetCard,
  canAttackWith,
  canChangePosition,
  canDiscardForEffect,
  cloneState,
  ignitionOptions,
  handSummonOffer,
  choiceResponses,
  effAtk,
  effDef,
  effFlags,
  fusionOptions,
  legalAttackTargets,
  maxAttacks,
  monstersFrozen,
  other,
  summonBlocked,
  tributableBodies,
  tributesRequired,
} from './engine';
import { summonTargetSpec, targetSpecFor } from './ui';
import { type AiLevel } from './ai-levels';
import { MONSTER_ZONES, type CardInstance, type DuelAction, type DuelState, type PlayerId } from './types';

export type { AiLevel };

export interface AiConfig {
  /** How many partial lines are kept at each step of the turn search. */
  beam: number;
  /** How many candidate actions are considered per step. */
  branch: number;
  /** 0 = always play the best line; higher mixes in weaker ones. */
  slack: number;
  /**
   * How many whole turns to play out past our own before scoring a line.
   * 0 scores the board the moment our turn ends; 1 answers "what do they do
   * back"; 2 also asks "and what do we do about that".
   */
  depth: number;
  /**
   * How much of a line's final score comes from the lookahead rather than from
   * the board we can actually read. 0 ignores the playout entirely, 1 lets it
   * replace the immediate evaluation outright. See `blendRollout`.
   */
  rolloutMix?: number;
  /**
   * How many sampled futures each candidate line is judged against. One world
   * is one guess about the cards the AI cannot see — a single guess can land
   * on a lucky arrangement and mis-rank a line for a reason that exists in no
   * other future. The default scales with the time budget.
   */
  worlds?: number;
  /** Kept for the arena's older variants; folded into `worlds` now. */
  rolloutSamples?: number;
  /** Fraction of the budget the beam keeps; the rest judges plans. */
  beamShare?: number;
  /** How hard the sampled worlds may pull a plan away from its beam score. */
  voteMix?: number;
  /** Evaluation weights; defaults to the tuned set. */
  weights?: EvalWeights;
}

export const AI_LEVELS: Record<AiLevel, AiConfig> = {
  rookie: { beam: 1, branch: 6, slack: 0.55, depth: 0 },
  duelist: { beam: 4, branch: 14, slack: 0.12, depth: 1, worlds: 2 },
  champion: { beam: 10, branch: 26, slack: 0, depth: 3 },
};

const WIN = 1e9;

/* ------------------------------------------------------------------ */
/* Evaluation                                                          */
/* ------------------------------------------------------------------ */

const EXODIA = new Set([
  'exodia-the-forbidden-one',
  'left-arm-of-the-forbidden-one',
  'right-arm-of-the-forbidden-one',
  'left-leg-of-the-forbidden-one',
  'right-leg-of-the-forbidden-one',
]);

/**
 * A face-down monster's stats are not knowable, so it is treated as an average
 * body rather than peeked at. Roughly the mean across the season-one decks.
 */
const UNKNOWN_ATK = 1250;
const UNKNOWN_DEF = 1300;

interface Body {
  atk: number;
  def: number;
  /** Value it defends with: ATK when face-up attacking, DEF otherwise. */
  wall: number;
  atkPos: boolean;
  attacks: number;
  pierce: boolean;
  direct: boolean;
  wallProof: boolean;
}

/**
 * Reads a monster the way `viewer` is allowed to see it: its own cards fully,
 * the opponent's face-down cards only as an unknown average.
 */
function bodyOf(state: DuelState, m: CardInstance, ctrl: PlayerId, viewer: PlayerId): Body {
  const hidden = m.face === 'down' && ctrl !== viewer;
  const f = effFlags(state, m, ctrl);
  const atk = hidden ? UNKNOWN_ATK : effAtk(state, m, ctrl);
  const def = hidden ? UNKNOWN_DEF : effDef(state, m, ctrl);
  /* The engine refuses a frozen or held-down attack, and only a Divine-Beast
     walks through the lock — `canAttackWith`'s exact rule, mirrored. Without
     this, the threat model kept counting attacks the engine would never
     allow, and Swords of Revealing Light read as a card spent on nothing:
     the three quiet turns it buys were invisible to every threat and race
     term, so the beam pruned the lock before the lookahead could speak. */
  const divine = CARDS[m.slug]?.type === 'Divine-Beast';
  const locked = !divine && (monstersFrozen(state, ctrl) || (!hidden && !!f.cannotAttack));
  return {
    atk,
    def,
    wall: m.face === 'up' && m.position === 'atk' ? atk : def,
    atkPos: m.face === 'up' && m.position === 'atk',
    attacks: locked ? 0 : hidden ? 1 : maxAttacks(state, m, ctrl),
    pierce: !hidden && !!f.pierce,
    direct: !hidden && !!f.directAttack,
    wallProof: !hidden && !!f.indestructibleByBattle,
  };
}

function bodiesOf(state: DuelState, pid: PlayerId, viewer: PlayerId): Body[] {
  return state.players[pid].monsters
    .filter((m): m is CardInstance => !!m)
    .map((m) => bodyOf(state, m, pid, viewer));
}

/**
 * Damage `attackers` push through `blockers` in a single battle phase, plus the
 * attack power that is left standing afterwards.
 *
 * Attacks are assigned greedily biggest-first, which is what both a decent
 * human and this AI's own move ordering actually do: kill what you can beat,
 * then swing at the face.
 */
function battleOutcome(attackers: Body[], blockers: Body[]): { damage: number; freeAtk: number } {
  const live = attackers
    .flatMap((a) => Array.from({ length: a.attacks }, () => a))
    .sort((a, b) => b.atk - a.atk);
  const walls = blockers.map((b) => ({ ...b }));
  let damage = 0;

  for (const a of live) {
    if (a.direct || !walls.length) {
      damage += a.atk;
      continue;
    }
    // Prefer a kill; among kills take the biggest body off the board.
    const killable = walls.filter((w) => a.atk > w.wall && !w.wallProof);
    if (killable.length) {
      const t = killable.reduce((best, w) => (w.wall > best.wall ? w : best));
      if (t.atkPos) damage += a.atk - t.wall;
      else if (a.pierce) damage += a.atk - t.wall;
      walls.splice(walls.indexOf(t), 1);
      continue;
    }
    // Nothing it beats: a sensible attacker simply does not swing.
  }

  // Attack power available *per turn from next turn on*, which is what `clock`
  // divides the remaining Life Points by.
  const freeAtk = attackers.reduce((sum, a) => sum + a.atk * a.attacks, 0);
  return { damage, freeAtk };
}

/**
 * How many turns `att` needs to finish `def` off from the current board.
 *
 * This is the number that actually decides duels here: 8000 Life Points and
 * 3000 ATK bodies mean a game is over in a handful of connected attacks, so a
 * player who is one turn faster wins almost regardless of card count.
 */
function clock(state: DuelState, att: PlayerId, def: PlayerId, viewer: PlayerId): number {
  const lp = state.players[def].lp;
  const attackers = bodiesOf(state, att, viewer).filter((b) => b.atkPos);
  if (!attackers.length) return 99;
  const blockers = bodiesOf(state, def, viewer);
  const { damage, freeAtk } = battleOutcome(attackers, blockers);
  if (damage >= lp) return 1;
  if (freeAtk <= 0) return 99;
  return 1 + Math.ceil((lp - damage) / freeAtk);
}

/**
 * Damage `defender` would take from a full battle phase right now, judged from
 * `viewer`'s information.
 */
function threatAgainst(state: DuelState, defender: PlayerId, viewer: PlayerId): number {
  const att = other(defender);
  const attackers = bodiesOf(state, att, viewer).filter((b) => b.atkPos);
  /* One body they have not summoned yet. A hand is not just card advantage —
     it is next turn's attacker, and a threat term that read only the board
     said "safe" to a player tapped completely out against a full grip. The
     phantom is an average summonable body, added only when they hold cards
     and have somewhere to put one; it makes the AI keep a real blocker or a
     Life Point buffer where it used to end the turn naked. */
  const p = state.players[att];
  if (p.hand.length > 0 && p.monsters.some((m) => !m) && !monstersFrozen(state, att)) {
    attackers.push({
      atk: 1600,
      def: 0,
      wall: 1600,
      atkPos: true,
      attacks: 1,
      pierce: false,
      direct: false,
      wallProof: false,
    });
  }
  if (!attackers.length) return 0;
  return battleOutcome(attackers, bodiesOf(state, defender, viewer)).damage;
}

export interface EvalWeights {
  /** Multipliers on a body's ATK/DEF, by the position it is sitting in. */
  atkPosAtk: number;
  atkPosDef: number;
  defPosDef: number;
  defPosAtk: number;
  /** Points per card of hand advantage. */
  hand: number;
  /** Points per turn of race advantage. 0 disables the race term entirely. */
  clock: number;
}

/**
 * Tuned by `scripts/ai-arena.ts`. Material is priced low because most of a
 * monster's worth is already expressed by the race term; counting both at face
 * value double-counts it.
 */
export const WEIGHTS: EvalWeights = {
  atkPosAtk: 0.3,
  atkPosDef: 0.05,
  defPosDef: 0.22,
  defPosAtk: 0.08,
  hand: 220,
  clock: 900,
};

/** The pre-race weights, kept so the arena can measure the change. */
export const LEGACY_WEIGHTS: EvalWeights = {
  atkPosAtk: 0.85,
  atkPosDef: 0.15,
  defPosDef: 0.6,
  defPosAtk: 0.2,
  hand: 220,
  clock: 0,
};

/**
 * What a Set card of ours is actually worth, read off its own effects.
 *
 * The evaluation used to price every face-down Spell/Trap at a flat 260, which
 * made Mirror Force and a dead one-shot equally attractive to keep — and worse,
 * made *setting* the good one no more urgent than setting the bad one. This
 * reads the card's trap ops and prices the threat the way the search itself
 * would feel it: a board wipe is most of a turn, a single kill is half of one.
 * Only ever applied to the AI's own Set cards — the opponent's face-down is
 * still an unknown flat value, because reading it would be reading the card.
 */
const TRAP_WORTH = new Map<string, number>();
function trapWorth(slug: string): number {
  const cached = TRAP_WORTH.get(slug);
  if (cached !== undefined) return cached;
  const def = CARDS[slug];
  let worth = 0;
  for (const eff of def?.effects ?? []) {
    if (eff.trigger !== 'trap') continue;
    let one = 0;
    for (const op of eff.ops) {
      if (op.op === 'destroy') one += 'target' in op && op.target?.pick === 'all' ? 750 : 420;
      else if (op.op === 'negateAttack') one += 260;
      else if (op.op === 'damage') one += Math.min(500, (op.amount ?? 0) * 0.4);
      else if (op.op === 'takeControl') one += 550;
      else if (op.op === 'bounce') one += 300;
      else if (op.op === 'summonToken' || op.op === 'specialSummon') one += 260;
      else if (op.op === 'gainAtk' || op.op === 'equipTo') one += 150;
      else one += 60;
    }
    worth = Math.max(worth, one);
  }
  const clamped = Math.min(900, worth);
  TRAP_WORTH.set(slug, clamped);
  return clamped;
}

/**
 * Scores a position from `me`'s point of view, in Life-Point-ish units. Only
 * information this player could legitimately see is used: face-down cards on
 * the other side of the field count as an average body, never their real stats.
 */
export function evaluate(state: DuelState, me: PlayerId, w: EvalWeights = WEIGHTS): number {
  const foe = other(me);
  if (state.winner === me) return WIN;
  if (state.winner === foe) return -WIN;
  if (state.winner === 'draw') return -WIN / 2;

  const my = state.players[me];
  const their = state.players[foe];
  let score = 0;

  // Life totals are the win condition, so they anchor the scale.
  score += (my.lp - their.lp) * 1.0;

  // Board presence, at a deliberately modest weight: most of what a monster is
  // worth is already priced into the race term below.
  for (const m of my.monsters) {
    if (!m) continue;
    const b = bodyOf(state, m, me, me);
    score += b.atkPos ? b.atk * w.atkPosAtk + b.def * w.atkPosDef : b.def * w.defPosDef + b.atk * w.defPosAtk;
    if (m.face === 'down') score += 120; // unknown to the opponent
    if (b.pierce) score += 120;
    if (b.direct) score += 260;
    if (b.wallProof) score += 220;
    if (b.attacks > 1) score += 200 * (b.attacks - 1);
    /* A stolen body that pays its owner rent is a body on a meter. Priced at
       most of a turn's rent so keeping it must earn its keep, and symmetric
       below so the AI values inflicting the meter on the other side. */
    if (m.rentPerTurn && m.owner !== me) score -= m.rentPerTurn * 0.8;
  }
  for (const m of their.monsters) {
    if (!m) continue;
    const b = bodyOf(state, m, foe, me);
    score -= b.atkPos ? b.atk * w.atkPosAtk + b.def * w.atkPosDef : b.def * w.defPosDef + b.atk * w.defPosAtk;
    if (m.face === 'down') score -= 120;
    if (m.rentPerTurn && m.owner !== foe) score += m.rentPerTurn * 0.8;
  }

  // Card advantage. A card in hand is a future threat; a set Spell/Trap is a
  // live one — ours priced by what it actually does, theirs by not knowing.
  score += (my.hand.length - their.hand.length) * w.hand;
  /* A set trap must outscore the same trap sitting in hand, or the search
     never sets it. At 140 + 0.35x, a mid trap priced below the 220 a hand
     card is worth, and the disagreement probe caught the AI holding
     Spellbinding Circle in hand all game — armed answers beat stored ones,
     and the backrow slot has no other use. */
  if (my.spellTrap) score += my.spellTrap.face === 'down' ? 260 + trapWorth(my.spellTrap.slug) * 0.4 : 180;
  if (their.spellTrap) score -= their.spellTrap.face === 'down' ? 300 : 180;
  if (my.field) score += 120;
  if (their.field) score -= 120;

  // Running out of deck loses the duel.
  if (my.deck.length < 6) score -= (6 - my.deck.length) * 380;
  if (their.deck.length < 6) score += (6 - their.deck.length) * 380;

  /* Exodia: gathered pieces are real progress towards an instant win, and a
     piece standing in a Monster Zone counts towards the assembly exactly like
     one in hand. Only its own zones: the Graveyard does not assemble. */
  const pieces =
    my.hand.filter((c) => EXODIA.has(c.slug)).length +
    my.monsters.filter((m) => !!m && !m.isToken && EXODIA.has(m.slug)).length;
  if (pieces) score += pieces * pieces * 260;

  // The race. Whoever needs fewer turns to finish the other off is winning.
  if (w.clock) {
    const myClock = clock(state, me, foe, me) - (state.active === me ? 0.5 : 0);
    const theirClock = clock(state, foe, me, me) - (state.active === foe ? 0.5 : 0);
    score += Math.max(-4, Math.min(4, theirClock - myClock)) * w.clock;
  }

  // Standing in front of lethal, or having lethal, still gets a hard cliff:
  // those are not gradual positions.
  const threat = threatAgainst(state, me, me);
  if (threat >= my.lp) score -= 25_000;
  else score -= threat * 0.55;

  const pressure = threatAgainst(state, foe, me);
  if (pressure >= their.lp) score += 20_000;
  else score += pressure * 0.4;

  return score;
}

/* ------------------------------------------------------------------ */
/* Candidate moves                                                     */
/* ------------------------------------------------------------------ */

const byAtkDesc = (state: DuelState, pid: PlayerId) => (a: CardInstance, b: CardInstance) =>
  effAtk(state, b, pid) - effAtk(state, a, pid);

/** Sensible target choices for an effect, best-first rather than random. */
function targetsFor(
  state: DuelState,
  pid: PlayerId,
  slug: string,
  trigger: 'activate' | 'ignition' | 'trap' | 'onSummon' | 'handDiscard'
): string[][] {
  const spec = trigger === 'onSummon' ? summonTargetSpec(slug) : targetSpecFor(slug, trigger);
  if (!spec) return [[]];
  const foe = other(pid);
  const sides: PlayerId[] = spec.side === 'own' ? [pid] : spec.side === 'opp' ? [foe] : [pid, foe];
  const pool: CardInstance[] = [];
  for (const id of sides) {
    const p = state.players[id];
    if (spec.zone === 'monster') pool.push(...p.monsters.filter((m): m is CardInstance => !!m));
    else if (spec.zone === 'spellTrap' || spec.zone === 'backrow') {
      if (p.spellTrap) pool.push(p.spellTrap);
      if (spec.zone === 'backrow' && p.field) pool.push(p.field);
    } else if (spec.zone === 'grave') {
      pool.push(...p.grave.filter((c) => CARDS[c.slug]?.kind === 'monster'));
    } else if (spec.zone === 'hand' && id === pid) pool.push(...p.hand);
  }
  if (!pool.length) return [[]];

  /* Strongest first: for removal that is the opponent's best body, for equips
     and revival it is the best body to invest in. EFFECTIVE strength for cards
     on a field, printed for cards in piles — a Two-Headed King Rex standing at
     2500 must outrank the 1700 beside it, and by printed ATK it never did, so
     the AI kept pointing its removal at the wrong monster. */
  const worth = (c: CardInstance): number => {
    for (const id of ['p1', 'p2'] as PlayerId[]) {
      if (state.players[id].monsters.some((m) => m?.uid === c.uid)) return effAtk(state, c, id);
    }
    return CARDS[c.slug]?.atk ?? 0;
  };
  const ranked = [...pool].sort((a, b) => worth(b) - worth(a));
  const out: string[][] = [];
  const take = Math.min(3, Math.max(0, ranked.length - spec.count + 1));
  for (let i = 0; i < take; i++) {
    out.push(ranked.slice(i, i + spec.count).map((c) => c.uid));
  }
  return out.length ? out : [[]];
}

/** Every action worth considering right now, roughly best-first. */
export function candidates(state: DuelState, pid: PlayerId, limit: number): DuelAction[] {
  const acts: DuelAction[] = [];
  const p = state.players[pid];
  const foe = other(pid);
  const ownMonsters = p.monsters.filter((m): m is CardInstance => !!m);

  if (state.pending) {
    if (state.pending.player !== pid) return acts;
    /* A parked effect asking which card to take — one rule, in the engine, so
       the computer, the autoplayer and the simulator all answer it the same
       way. The search then picks between the candidates it hands back. */
    if (state.pending.kind === 'choose') return choiceResponses(state, pid);
    acts.push({ type: 'respondTrap', uid: null });
    for (const uid of state.pending.options) {
      const c = p.hand.find((h) => h.uid === uid) ?? (p.spellTrap?.uid === uid ? p.spellTrap : null);
      for (const t of c ? targetsFor(state, pid, c.slug, 'trap') : [[]]) {
        acts.push({ type: 'respondTrap', uid, targets: t });
      }
    }
    return acts;
  }

  if (state.active !== pid || state.winner) return acts;

  if (state.phase === 'main') {
    // Fusions first — they are usually the strongest play available.
    for (const f of fusionOptions(state, pid)) {
      const zone = p.monsters.findIndex((m) => !m);
      if (zone >= 0) acts.push({ type: 'fusionSummon', extraUid: f.extraUid, materials: f.materials, zone, position: 'atk' });
    }

    const freeZone = p.monsters.findIndex((m) => !m);
    if (!p.normalSummonUsed) {
      const summonable = p.hand
        .filter((h) => CARDS[h.slug]?.kind === 'monster')
        .filter((h) => !summonBlocked(state, pid, h.slug))
        // Holding the Forbidden One is worth more than summoning it.
        .filter((h) => !EXODIA.has(h.slug))
        .sort((a, b) => (CARDS[b.slug].atk ?? 0) - (CARDS[a.slug].atk ?? 0));

      for (const h of summonable) {
        const need = tributesRequired(h.slug, state, pid);
        /* Everything that can pay, not just the AI's own zones — Soul Exchange
           lends the opponent's monsters for a Tribute and leaves them standing
           over there, and a pool read off `p.monsters` could never spend them.
           Weakest first, which naturally spends tokens and borrowed bodies
           before real monsters — a borrowed body is one THEY lose, so the sort
           is by our attachment to it, not its size. */
        const fodder = tributableBodies(state, pid)
          .slice()
          .sort((a, b) => {
            const aBorrowed = a.owner !== pid ? 0 : 1;
            const bBorrowed = b.owner !== pid ? 0 : 1;
            return aBorrowed - bBorrowed || effAtk(state, a, pid) - effAtk(state, b, pid);
          });
        if (need === 0 && freeZone >= 0) {
          for (const t of targetsFor(state, pid, h.slug, 'onSummon')) {
            acts.push({ type: 'normalSummon', uid: h.uid, zone: freeZone, position: 'atk', face: 'up', targets: t });
          }
          acts.push({ type: 'normalSummon', uid: h.uid, zone: freeZone, position: 'def', face: 'down' });
          /* A wall summoned AS a wall. Face-up Defence was a move the search
             could not even consider — a 2000-DEF body arrived either swinging
             its 800 ATK or hiding as a guess for the opponent to poke. Only
             offered where the DEF is the better half, which is the only time
             the option differs from the two above in its favour. */
          const def = CARDS[h.slug];
          if ((def.def ?? 0) > (def.atk ?? 0)) {
            for (const t of targetsFor(state, pid, h.slug, 'onSummon')) {
              acts.push({ type: 'normalSummon', uid: h.uid, zone: freeZone, position: 'def', face: 'up', targets: t });
            }
          }
        } else if (need > 0 && fodder.length >= need) {
          const tributes = fodder.slice(0, need).map((m) => m.uid);
          const zone = freeZone >= 0 ? freeZone : p.monsters.findIndex((m) => m && tributes.includes(m.uid));
          if (zone >= 0) {
            for (const t of targetsFor(state, pid, h.slug, 'onSummon')) {
              acts.push({ type: 'normalSummon', uid: h.uid, zone, position: 'atk', face: 'up', tributes, targets: t });
            }
          }
        }
        /* The other door, where a card has one: Serket may be Summoned by
           banishing the Temple instead of paying bodies. `tributesRequired`
           already answers 0 when the shrine is up, so the zero-cost branch
           above covers it — but the AI should also see the *body* route when
           it would rather keep the shrine. */
        if (need === 0 && freeZone >= 0) {
          const bodies = tributesRequired(h.slug, state, pid, true);
          if (bodies > 0 && fodder.length >= bodies) {
            const tributes = fodder.slice(0, bodies).map((m) => m.uid);
            acts.push({ type: 'normalSummon', uid: h.uid, zone: freeZone, position: 'atk', face: 'up', tributes });
          }
        }
      }
    }

    /* A monster that calls itself onto the field — Steel Ogre Grotto beside a
       Machine, Pendulum Machine off the ogre's corpse. `handSummonOffer` is the
       same gate the hand button reads, so the price and the refusal cannot
       drift apart between the two. */
    for (const h of p.hand) {
      const offer = handSummonOffer(state, pid, h);
      if (!offer?.ok) continue;
      const spare = p.hand
        .filter((x) => x.uid !== h.uid)
        .sort((a, b) => (CARDS[a.slug]?.atk ?? 0) - (CARDS[b.slug]?.atk ?? 0))[0];
      if (offer.discard && !spare) continue;
      for (const t of targetsFor(state, pid, h.slug, 'onSummon')) {
        acts.push({ type: 'handSummon', uid: h.uid, discardUid: offer.discard ? spare!.uid : undefined, targets: t });
      }
    }

    for (const h of p.hand) {
      if (canActivateFromHand(state, pid, h)) {
        for (const t of targetsFor(state, pid, h.slug, 'activate')) {
          acts.push({ type: 'activateSpell', uid: h.uid, targets: t });
        }
      }
      /* A monster spent from the hand — Zolga breaking a Set card, the Toon
         panic button. Nothing here knew the action existed, so an entire class
         of plays was invisible to the search. The engine's own gate refuses a
         discard with nothing to do, so every candidate pushed is playable. */
      if (canDiscardForEffect(state, pid, h)) {
        for (const t of targetsFor(state, pid, h.slug, 'handDiscard')) {
          acts.push({ type: 'discardForEffect', uid: h.uid, targets: t });
        }
      }
    }
    for (const m of ownMonsters) {
      for (const opt of ignitionOptions(state, pid, m)) {
        for (const t of targetsFor(state, pid, m.slug, 'ignition')) {
          acts.push({ type: 'ignition', uid: m.uid, targets: t, effectIndex: opt.index });
        }
      }
    }
    if (p.spellTrap && canActivateSetCard(state, pid, p.spellTrap)) {
      for (const t of targetsFor(state, pid, p.spellTrap.slug, CARDS[p.spellTrap.slug]?.kind === 'trap' ? 'trap' : 'activate')) {
        acts.push({ type: 'activateSetCard', uid: p.spellTrap.uid, targets: t });
      }
    }
    // Setting a trap is worth considering, but only cards that actually do
    // something from face-down.
    if (!p.spellTrap) {
      for (const h of p.hand) {
        const def = CARDS[h.slug];
        if (def && def.kind === 'trap') acts.push({ type: 'setSpellTrap', uid: h.uid });
      }
    }
    for (const m of ownMonsters) {
      if (canChangePosition(state, pid, m)) acts.push({ type: 'changePosition', uid: m.uid });
    }
    if (state.turn > 1 && !state.ongoing.some((o) => o.kind === 'skipBattlePhase' && o.target === pid)) {
      acts.push({ type: 'toPhase', phase: 'battle' });
    }
    acts.push({ type: 'endTurn' });
    /* The two actions that END a line must survive the cap. They are pushed
       last, so a busy hand used to truncate them off — and a line that can
       never reach its Battle Phase attacks nothing, however wide the beam.
       The close-out at the bottom of the search papers over the missing
       endTurn; nothing papers over a missing Battle Phase. */
    if (acts.length > limit) {
      const keep = acts.slice(0, Math.max(0, limit - 2));
      const tail = acts.filter((a) => a.type === 'toPhase' || a.type === 'endTurn');
      return [...keep.filter((a) => a.type !== 'toPhase' && a.type !== 'endTurn'), ...tail];
    }
  }

  if (state.phase === 'battle') {
    const attackers = ownMonsters.filter((m) => canAttackWith(state, pid, m)).sort(byAtkDesc(state, pid));
    for (const m of attackers) {
      const { uids, direct } = legalAttackTargets(state, pid, m);
      if (direct) acts.push({ type: 'attack', uid: m.uid, targetUid: null });
      // Prefer targets this monster actually beats, weakest-kill first.
      const atk = effAtk(state, m, pid);
      const ranked = uids
        .map((u) => state.players[foe].monsters.find((x) => x?.uid === u)!)
        .filter(Boolean)
        .sort((a, b) => {
          const av = a.position === 'atk' ? effAtk(state, a, foe) : effDef(state, a, foe);
          const bv = b.position === 'atk' ? effAtk(state, b, foe) : effDef(state, b, foe);
          const aKill = av < atk ? 0 : 1;
          const bKill = bv < atk ? 0 : 1;
          return aKill - bKill || bv - av;
        });
      for (const t of ranked) acts.push({ type: 'attack', uid: m.uid, targetUid: t.uid });
    }
    acts.push({ type: 'endTurn' });
  }

  return acts.slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* Worlds — what the AI is allowed to know                             */
/* ------------------------------------------------------------------ */

/**
 * A body to stand in for a face-down monster the AI has not seen.
 *
 * The search world needs *something* in the zone that battles resolve against,
 * and using the real card would be reading it. Picked once from the card pool:
 * the effectless monster closest to the unknown-average stats the evaluation
 * already assumes, so the search and the evaluation agree about what an unseen
 * body is worth.
 */
const UNKNOWN_PROXY: string = (() => {
  let best = 'battle-ox';
  let bestD = Infinity;
  for (const def of Object.values(CARDS)) {
    if (def.kind !== 'monster' || def.slug === 'facedown') continue;
    if ((def.effects?.length ?? 0) > 0) continue;
    const d = Math.abs((def.atk ?? 0) - UNKNOWN_ATK) + Math.abs((def.def ?? 0) - UNKNOWN_DEF);
    if (d < bestD) {
      bestD = d;
      best = def.slug;
    }
  }
  return best;
})();

/**
 * Turns a card instance into `slug` while keeping everything about it that is
 * public: where it sits, which way it faces, when it arrived. Everything the
 * old identity carried — counters, mods, absorbed souls — goes with it, because
 * a sampled identity arrives fresh.
 */
function reidentify(c: CardInstance, slug: string): void {
  c.slug = slug;
  c.atkMod = 0;
  c.defMod = 0;
  c.turnAtkMod = 0;
  c.turnDefMod = 0;
  c.counters = 0;
  c.equips = [];
  c.equippedTo = undefined;
  c.flags = {};
  c.turnFlags = {};
  c.attacksUsed = 0;
  c.effectUsedOnTurn = -1;
  c.absorbed = [];
  c.isToken = false;
}

/**
 * A 32-bit hash of everything `viewer` can legitimately see.
 *
 * This is what keys the world sampling, and the choice of key is the honesty
 * guarantee itself: two states that LOOK identical to the viewer produce
 * identical worlds and therefore identical plans, whatever the hidden seed,
 * the hidden deck order or a hidden card's identity happen to be. The old
 * search keyed its futures off `state.seed` — the very number that encodes
 * the coin flips it was not supposed to know. Pinned in `ai-honesty-check`:
 * permuting hidden information must not move the AI's plan, and changing
 * visible information must.
 */
function visibleHash(state: DuelState, viewer: PlayerId): number {
  let h = 0x811c9dc5;
  const mix = (str: string) => {
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  };
  mix(`${state.turn}|${state.phase}|${state.active}|`);
  for (const pid of ['p1', 'p2'] as PlayerId[]) {
    const p = state.players[pid];
    const own = pid === viewer;
    mix(`${p.lp}|${p.hand.length}|${p.deck.length}|${p.grave.map((c) => c.slug).join(',')}|`);
    if (own) mix(p.hand.map((c) => c.slug).join(','));
    for (const m of p.monsters) {
      if (!m) {
        mix('-');
        continue;
      }
      const hidden = !own && m.face === 'down';
      mix(hidden ? `?${m.uid}` : `${m.slug}.${m.face}.${m.position}.${m.atkMod}.${m.counters}`);
    }
    const st = p.spellTrap;
    mix(st ? (!own && st.face === 'down' ? `?${st.uid}` : st.slug) : '-');
    mix(p.field?.slug ?? '-');
  }
  return h >>> 0;
}

/** A deterministic RNG keyed off the visible position and a salt. */
function saltedRng(state: DuelState, viewer: PlayerId, salt: number): () => number {
  let s = (visibleHash(state, viewer) ^ Math.imul(salt + 1, 0x9e3779b9)) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleWith<T>(arr: T[], rnd: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/**
 * A world the search may legitimately live in.
 *
 * Starts from a slimmed copy — the log and the animation queue are dead weight
 * the engine would otherwise clone on every single node, and they are most of
 * a mid-game state by volume. Then everything the viewer cannot see is dealt
 * with, in one of two ways:
 *
 *  - `sample: false` builds the *expectation* world the beam searches: the
 *    opponent's face-down monsters become the stand-in body, and everything
 *    else hidden is left in place but never read — the beam refuses to settle
 *    a response window it cannot see into, exactly as before.
 *  - `sample: true` builds a *scoring* world: the opponent's unseen cards
 *    (hand, deck, face-down monsters, face-down backrow) are pooled and
 *    redealt, so the world holds a plausible opponent rather than the real
 *    one. Within a sampled world everything is knowable, which is what lets a
 *    candidate plan be played out honestly to its consequences.
 *
 * In both: the viewer's own deck is reshuffled (nobody knows their next draw),
 * and the RNG seed is re-salted so a simulated coin flip is a *sample* of the
 * real one rather than a preview of it. Card counts in every zone are public
 * information and are preserved exactly.
 */
function buildWorld(state: DuelState, viewer: PlayerId, salt: number, sample: boolean): DuelState {
  const view = cloneState(state);
  view.log = [];
  view.logShown = 0;
  view.anims = [];
  const rnd = saltedRng(state, viewer, salt * 2 + (sample ? 1 : 0));
  /* The in-world RNG stream is keyed off what the viewer can SEE, never off
     the real seed — a simulated coin is a fair sample, not a preview. */
  view.seed = (visibleHash(state, viewer) ^ Math.imul(salt + 17, 0x85ebca6b)) >>> 0;

  /* Sorted before shuffling, both here and for every pool below: the input
     order of a hidden zone is itself hidden information, and a shuffle keyed
     off a stable seed still leaks it if the array arrives pre-arranged. Sorted
     by identity, the sample is a pure function of the multiset. */
  const sortHidden = (cards: CardInstance[]) =>
    cards.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : a.uid < b.uid ? -1 : 1));
  sortHidden(view.players[viewer].deck);
  shuffleWith(view.players[viewer].deck, rnd);

  const foe = view.players[other(viewer)];
  const hiddenMonsters = foe.monsters.filter((m): m is CardInstance => !!m && m.face === 'down');

  /* Their Set backrow becomes an inert stand-in in EVERY world, sampled or
     not. This is doctrine, not laziness, and it is pinned in `ai-check`: a Set
     card the AI has not been shown must neither be read nor feared. Sampling
     it from the unseen pool priced "maybe it is Mirror Force" at one-in-seven
     per world, and the AI stopped attacking through face-down cards it had no
     evidence about — trap-shy exactly the way the owner's checks forbid. The
     stand-in is a monster slug, so no trap window ever opens off it; the
     evaluation still counts the zone as an unknown threat, and the real card
     gets its say in the real duel, where it belongs. */
  if (foe.spellTrap && foe.spellTrap.face === 'down') reidentify(foe.spellTrap, UNKNOWN_PROXY);

  if (!sample) {
    for (const m of hiddenMonsters) reidentify(m, UNKNOWN_PROXY);
    /* Their hand too. The beam never reads a hand card's identity directly,
       but it was reading one *indirectly*: declaring an attack asks the engine
       for the defender's responses, and a hand-trap they happen to hold opens
       a window while a hand without one does not — so whether the window
       opened at all told the search what they were holding. Proxied, the
       expectation world holds a hand of unknowns that answers nothing, and
       the sampled worlds are where a plausible Kuriboh gets its say. Caught
       by ai-honesty-check, not by eye. */
    for (const h of foe.hand) reidentify(h, UNKNOWN_PROXY);
    sortHidden(foe.deck);
    shuffleWith(foe.deck, rnd);
    return view;
  }

  /* The pool is every card of theirs the viewer has not seen — hand, deck and
     face-down monsters. Redealt as a multiset: the counts stay exactly what
     they were, only the identities move between the unseen zones. */
  const pool: string[] = [
    ...foe.hand.map((c) => c.slug),
    ...foe.deck.map((c) => c.slug),
    ...hiddenMonsters.map((c) => c.slug),
  ].sort();
  shuffleWith(pool, rnd);
  /* A face-down card in a Monster Zone IS a monster — the rules put it there,
     and a world that deals it a Spell mis-prices every flip and battle played
     out inside it. The monsters among the unseen pool go to the face-down
     zones first; everything else falls where it may. Conditioning on what a
     zone announces is not peeking. */
  const monsters = pool.filter((s) => CARDS[s]?.kind === 'monster');
  const rest = pool.filter((s) => CARDS[s]?.kind !== 'monster');
  for (const m of hiddenMonsters) reidentify(m, monsters.pop() ?? rest.pop()!);
  const remain = [...monsters, ...rest];
  shuffleWith(remain, rnd);
  let at = 0;
  for (const h of foe.hand) reidentify(h, remain[at++]);
  for (const d of foe.deck) reidentify(d, remain[at++]);
  return view;
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

interface Line {
  state: DuelState;
  actions: DuelAction[];
  score: number;
  done: boolean;
}

/**
 * The search's clock, counted in NODES — engine actions simulated — rather
 * than milliseconds, with wall time kept only as an emergency stop.
 *
 * Two reasons, and the second one is the important one. Milliseconds made the
 * search's *shape* depend on the weather: a garbage-collection pause landed a
 * deadline check differently and the same position produced a different plan
 * on the next run, which turned every 10/10 play check flaky and made the
 * honesty invariants unprovable — a plan cannot be shown independent of hidden
 * information if it is not even independent of the wall clock. Nodes make the
 * whole search a pure function of (position, config, budget). And a node is
 * the honest unit of work anyway: a slow machine gets the same *search* and
 * merely takes longer, instead of a shallower one that plays worse.
 *
 * The wall cap exists for the pathological case — a serverless instance an
 * order of magnitude slower than the machine `NODES_PER_MS` was calibrated on
 * — where finishing eventually matters more than determinism.
 */
interface Clock {
  left: number;
  wallCap: number;
}

/** Simulated actions per millisecond, calibrated on the dev machine. */
const NODES_PER_MS = 5;

function clockFor(budgetMs: number): Clock {
  return {
    left: Math.max(150, Math.round(budgetMs * NODES_PER_MS)),
    wallCap: Date.now() + Math.max(150, budgetMs * 1.6),
  };
}

const drained = (c: Clock): boolean => c.left <= 0 || Date.now() > c.wallCap;

/** Every simulated action in this file goes through here and pays one node. */
function sim(c: Clock, state: DuelState, pid: PlayerId, action: DuelAction): { state: DuelState; error?: string } {
  c.left -= 1;
  return applyAction(state, pid, action);
}

/**
 * Beam search over the whole turn. Each step expands the surviving lines by
 * every candidate action, keeps the best `beam` of them, and stops when a line
 * ends the turn.
 */
export function planTurn(state: DuelState, pid: PlayerId, level: AiSetting = 'champion', budgetMs = 2500): DuelAction[] {
  return planWith(state, pid, cfgOf(level), clockFor(budgetMs));
}

/** Either a named level or a raw config, so variants can be benchmarked. */
export type AiSetting = AiLevel | AiConfig;
const cfgOf = (s: AiSetting): AiConfig => (typeof s === 'string' ? AI_LEVELS[s] : s);

/** Cheap, deterministic settings used to model a reply turn or a trap window. */
const MODEL_CFG: AiConfig = { beam: 3, branch: 12, slack: 0, depth: 0 };

/**
 * Plays out every response window a position is holding open, so a line is
 * judged on what happened rather than on what was merely declared.
 *
 * `viewer` is the seat doing the planning. In the expectation world the AI may
 * model a response only with what it could legitimately see: everything in its
 * own seat, and only *face-up* cards in the other — see `canSeeResponse`. In a
 * sampled world the face-down cards are samples of the AI's own making, so the
 * same machinery reads them as what the sample says they are.
 */
function settleWindows(clock: Clock, state: DuelState, viewer: PlayerId, w: EvalWeights, omniscient = false): DuelState {
  if (!state.pending) return state;
  const model: AiConfig = { ...MODEL_CFG, weights: w };
  let cur = state;
  for (let guard = 0; guard < 6 && cur.pending && !cur.winner; guard++) {
    const responder = cur.pending.player;
    const action = omniscient
      ? greedyResponse(clock, cur, responder, model)
      : chooseVisibleResponse(clock, cur, responder, viewer, model);
    const res = sim(clock, cur, responder, action);
    if (res.error) break;
    cur = res.state;
  }
  return cur;
}

/**
 * True when `viewer` can actually see what would answer this window.
 *
 * Measured: settling a window the AI cannot see into costs about six points of
 * win rate, because the only thing to assume is that the opponent declines —
 * so the attack is scored as landing cleanly, and the AI walks into every Set
 * trap on the table. The beam leaves those windows exactly as they are and
 * scores the worse of "hanging" and "landed"; the sampled worlds are where the
 * consequences are actually played out.
 */
function canSeeResponse(state: DuelState, viewer: PlayerId): boolean {
  if (!state.pending) return false;
  if (state.pending.player === viewer) return true;
  const p = state.players[state.pending.player];
  return state.pending.options.some((uid) => p.spellTrap?.uid === uid && p.spellTrap.face === 'up');
}

/**
 * The response `viewer` should expect, using only the cards it is entitled to
 * know about. Its own seat is fully known; the other seat is known only as far
 * as what is face-up on the field.
 */
function chooseVisibleResponse(clock: Clock, state: DuelState, responder: PlayerId, viewer: PlayerId, cfg: AiConfig): DuelAction {
  if (responder === viewer) return greedyResponse(clock, state, responder, cfg);
  const p = state.players[responder];
  const seen = (state.pending?.options ?? []).filter((uid) => p.spellTrap?.uid === uid && p.spellTrap.face === 'up');
  if (!seen.length) return { type: 'respondTrap', uid: null };
  const view: DuelState = { ...state, pending: { ...state.pending!, options: seen } };
  return greedyResponse(clock, view, responder, cfg);
}

/** One-step lookahead over a window's options — the model's answer, kept cheap. */
function greedyResponse(clock: Clock, state: DuelState, pid: PlayerId, cfg: AiConfig): DuelAction {
  const w = cfg.weights ?? WEIGHTS;
  const options = candidates(state, pid, cfg.branch);
  const fallback: DuelAction =
    state.pending?.kind === 'choose' ? { type: 'chooseCard', uids: [] } : { type: 'respondTrap', uid: null };
  let best: DuelAction = options[0] ?? fallback;
  let bestScore = -Infinity;
  for (const action of options) {
    const res = sim(clock, state, pid, action);
    if (res.error) continue;
    const score = evaluate(res.state, pid, w);
    if (score > bestScore) {
      bestScore = score;
      best = action;
    }
  }
  return best;
}

/**
 * The beam itself: whole-turn lines over one world, best-first, returning every
 * finished line worth judging rather than only the winner. The judging happens
 * across worlds this search never sees — see `planWith`. Stops when the clock
 * drains past `floor`, which is how a phase is given a share of the budget
 * without owning the clock.
 */
function beamSearch(world: DuelState, pid: PlayerId, cfg: AiConfig, clock: Clock, floor: number, w: EvalWeights): Line[] {
  let lines: Line[] = [{ state: world, actions: [], score: evaluate(world, pid, w), done: false }];
  const finished: Line[] = [];
  const out = () => clock.left <= floor || Date.now() > clock.wallCap;

  for (let step = 0; step < 24; step++) {
    if (out()) break;
    const next: Line[] = [];
    for (const line of lines) {
      if (line.done) {
        finished.push(line);
        continue;
      }
      for (const action of candidates(line.state, pid, cfg.branch)) {
        if (out()) break;
        const res = sim(clock, line.state, pid, action);
        if (res.error) continue;
        /* A window it can read is settled and scored as settled. A window it
           cannot read is left exactly where it is, but the score takes the
           *worse* of leaving it and of the attack simply landing — caution
           about unseen traps without blindness to what a move costs even if
           the opponent does nothing. */
        const unread = !!res.state.pending && !canSeeResponse(res.state, pid);
        const after = unread ? res.state : settleWindows(clock, res.state, pid, w);
        const score = unread
          ? Math.min(evaluate(after, pid, w), evaluate(settleWindows(clock, res.state, pid, w), pid, w))
          : evaluate(after, pid, w);
        const ends = action.type === 'endTurn' || after.active !== pid || !!after.winner;
        next.push({
          state: after,
          actions: [...line.actions, action],
          score,
          done: ends || !!after.pending,
        });
      }
    }
    if (!next.length) break;
    /* Two orders of the same actions land on the same board, and both used to
       occupy beam slots — with a beam of ten, three duplicates is a third of
       the search gone. A continuation is kept only if its *position* is new;
       the signature is deliberately coarse (life, bodies, zones, hand sizes),
       because a collision between genuinely different boards merely costs one
       slot while a missed duplicate costs one anyway. */
    const seen = new Set<string>();
    const fresh = next.filter((l) => {
      if (l.done) return true;
      const sig = stateSig(l.state);
      if (seen.has(sig)) return false;
      seen.add(sig);
      return true;
    });
    const stillGoing = fresh.filter((l) => !l.done).sort((a, b) => b.score - a.score);
    finished.push(...fresh.filter((l) => l.done));
    if (finished.length > 120) {
      finished.sort((a, b) => b.score - a.score);
      finished.length = 120;
    }
    lines = stillGoing.slice(0, Math.max(1, cfg.beam));
    if (!lines.length) break;
  }

  // Close out anything the search left half-played, so the pool it picks from
  // is all complete turns.
  for (const line of lines) {
    const res = sim(clock, line.state, pid, { type: 'endTurn' });
    if (res.error) {
      finished.push(line);
      continue;
    }
    finished.push({
      state: res.state,
      actions: [...line.actions, { type: 'endTurn' }],
      score: evaluate(res.state, pid, w),
      done: true,
    });
  }

  const all = finished.filter((l) => l.actions.length);
  all.sort((a, b) => b.score - a.score);
  return all;
}

/**
 * How many sampled worlds the judging insists on before it may declare
 * convergence. Below the floor the whole budget goes to the beam — that is
 * the regime of the tightest test budgets, where a narrow answer now beats a
 * broad answer late.
 */
function worldsFor(cfg: AiConfig, clock: Clock): number {
  if (cfg.worlds !== undefined) return Math.max(0, cfg.worlds);
  if (cfg.depth <= 0) return 0;
  if (clock.left < 400 * NODES_PER_MS) return 0;
  return clock.left < 2500 * NODES_PER_MS ? 2 : 3;
}

/**
 * Replays a candidate plan in one sampled world and returns where it leads.
 *
 * The world has usually drifted from the world the plan was found in — a
 * face-down monster is a different card here, a coin lands the other way — so
 * actions are allowed to fail and are simply skipped, exactly as the live room
 * re-plans around a stale step. Windows the plan opens are settled with full
 * knowledge of the world, which is honest *because* the world is a sample:
 * everything in it is the AI's own guess, laid out in advance.
 */
function playOutPlan(clock: Clock, world: DuelState, pid: PlayerId, actions: DuelAction[], w: EvalWeights): DuelState {
  let cur = world;
  for (const action of actions) {
    if (cur.winner) break;
    if (cur.pending) cur = settleWindows(clock, cur, pid, w, true);
    if (cur.winner || cur.active !== pid) break;
    const res = sim(clock, cur, pid, action);
    if (res.error) {
      /* The plan does not fit this world — the tribute it counted on is a
         different card here, the attack's target never existed. Skipping the
         step and stumbling on played out a nonsense turn: attacks without the
         summon they were built on, a Set that never happened, and the world
         score charged the PLAN for the incoherence of its corpse. The room
         re-plans when reality disagrees, so the judge does too: the rest of
         the turn is finished by the cheap model, from what this world really
         holds. Once per playout — a plan that keeps failing has been priced. */
      return finishTurnInWorld(clock, cur, pid, w);
    }
    cur = res.state;
  }
  if (cur.pending && !cur.winner) cur = settleWindows(clock, cur, pid, w, true);
  return cur;
}

/** Finishes the mover's turn inside a sampled world with the cheap model. */
function finishTurnInWorld(clock: Clock, state: DuelState, pid: PlayerId, w: EvalWeights): DuelState {
  const budget = Math.min(180, Math.max(0, clock.left));
  const share: Clock = { left: budget, wallCap: clock.wallCap };
  const plan = planWith(state, pid, { ...MODEL_CFG, weights: w }, share);
  clock.left -= budget - Math.max(0, share.left);
  let cur = state;
  for (const action of plan) {
    const res = sim(clock, cur, pid, action);
    if (res.error) break;
    cur = res.state;
    if (cur.winner) break;
    if (cur.pending) cur = settleWindows(clock, cur, pid, w, true);
    if (cur.winner || cur.active !== pid) break;
  }
  return cur;
}

function planWith(state: DuelState, pid: PlayerId, cfg: AiConfig, clock: Clock): DuelAction[] {
  const w = cfg.weights ?? WEIGHTS;
  const total = clock.left;

  /* When a window is open the only decisions are responses; the beam handles
     that fine, but there is nothing for worlds to add. */
  const worlds = state.pending ? 0 : worldsFor(cfg, clock);

  /* The expectation world: hidden info neutralised, never sampled. The beam
     runs here, so its pruning cannot over-fit to one lucky guess about a card
     nobody has seen. */
  const base = buildWorld(state, pid, 0, false);

  const beamShare = worlds > 0 ? (cfg.beamShare ?? 0.3) : cfg.depth > 0 ? Math.max(0.35, cfg.beamShare ?? 0.35) : 1;
  const beamFloor = total - Math.round(total * beamShare);

  /* Iterative widening. The beam at its base width finishes long before its
     share of the clock — the state clone got seven times cheaper and the width
     was tuned for the old price — so while there is work left in the share,
     the search runs again wider. A wider beam does not re-rank anything: it
     finds *plans the narrow beam never wrote down*, extra summon orders and
     target choices and attack sequences, which is the conversion of raw speed
     into strength. Lines are merged by their action signature; the score is
     world-deterministic, so duplicates are duplicates. */
  const merged = new Map<string, Line>();
  let width = Math.max(1, cfg.beam);
  for (let round = 0; round < 4; round++) {
    const found = beamSearch(base, pid, { ...cfg, beam: width, branch: cfg.branch + round * 6 }, clock, beamFloor, w);
    for (const line of found) {
      const key = line.actions.map(actionKey).join('|');
      if (!merged.has(key)) merged.set(key, line);
    }
    if (clock.left <= beamFloor + Math.round(total * beamShare * 0.2) || Date.now() > clock.wallCap) break;
    width *= 2;
  }
  const all = [...merged.values()].sort((a, b) => b.score - a.score);
  if (!all.length) return [{ type: 'endTurn' }];

  if (worlds > 0 && all.length > 1) {
    const judged = judgeAcrossWorlds(state, pid, all, cfg, w, clock, worlds);
    if (judged) return pickWithSlack(judged, cfg);
  }

  /* No worlds (tiny budget or a response window): the beam's own ranking,
     deepened by rollouts where the budget allows, exactly as before. */
  if (cfg.depth > 0 && !state.pending) {
    const examine = all.slice(0, cfg.beam >= 8 ? 12 : 6);
    const judged: Line[] = [];
    const starved: Line[] = [];
    for (let i = 0; i < examine.length; i++) {
      const line = examine[i];
      if (line.state.winner) {
        judged.push(line);
        continue;
      }
      if (drained(clock)) {
        starved.push(line);
        continue;
      }
      const slice = Math.max(80, Math.round(clock.left / (examine.length - i)));
      const seen = rollout(clock, slice, line.state, pid, cfg.depth, w);
      line.score = blendRollout(line.score, seen, cfg.rolloutMix ?? DEFAULT_ROLLOUT_MIX);
      judged.push(line);
    }
    judged.sort((a, b) => b.score - a.score);
    const rest = all.slice(examine.length);
    all.length = 0;
    all.push(...judged, ...starved, ...rest);
  }

  return pickWithSlack(all, cfg);
}

/**
 * The honest half of the strength: candidate plans from the beam are replayed
 * in worlds where every unseen card has been redealt and every coin re-thrown,
 * scored where they end up, and averaged. A plan that only works when the
 * face-down card is harmless, or when the coin lands heads, stops outranking
 * the plan that works everywhere.
 */
function judgeAcrossWorlds(
  state: DuelState,
  pid: PlayerId,
  all: Line[],
  cfg: AiConfig,
  w: EvalWeights,
  clock: Clock,
  worlds: number
): Line[] | null {
  const M = Math.min(10, all.length);
  const examine = all.slice(0, M);
  const gambling = examine.some((l) => planGambles(l.actions, state));

  /* Running estimates, folded into monotonically better averages for as long
     as the clock allows. `imm` is where a plan lands the moment the turn ends,
     `roll` is where the following turns take it — kept apart because the
     rollout is a noisier instrument and gets a bounded vote at the end. */
  const imm = examine.map(() => ({ sum: 0, n: 0 }));
  const roll = examine.map(() => ({ sum: 0, n: 0 }));
  const ends: DuelState[][] = examine.map(() => []);

  const ROLLOUT_FLOOR = 550; // nodes — a rollout thinner than this is noise
  const score = (i: number): number => {
    const beamScore = examine[i].score;
    const immAvg = imm[i].n ? imm[i].sum / imm[i].n : beamScore;
    /* A DECIDED beam line — a win or a loss — takes the pure sampled average:
       ±1e9 dwarfs any bounded vote, and whether the win is arithmetic or a
       lucky coin is exactly what the samples are for. Everything else keeps
       the expectation world's reading as the anchor and lets the samples move
       it a bounded amount; the first cut of this function let a three-sample
       average replace the anchor outright and lost five points of win rate to
       its own variance. */
    const base = Math.abs(beamScore) >= WIN / 2 ? immAvg : blendRollout(beamScore, immAvg, cfg.voteMix ?? 0.6);
    if (!roll[i].n) return base;
    return blendRollout(base, roll[i].sum / roll[i].n, cfg.rolloutMix ?? DEFAULT_ROLLOUT_MIX);
  };

  /* One round = one fresh sampled world, every candidate replayed in it, and
     the leaders rolled out inside it. Rounds repeat until the budget is spent
     or the verdict has stopped moving — a quiet board converges in two rounds
     and a knife-edge one soaks up everything the clock has. */
  const maxRounds = 8;
  let salt = 1;
  let leaderStable = 0;
  let prevLeader = -1;
  for (let round = 0; round < maxRounds; round++) {
    if (round > 0 && (clock.left <= 300 || Date.now() > clock.wallCap)) break;
    const world = buildWorld(state, pid, salt, true);
    salt += 1;
    for (let i = 0; i < M; i++) {
      if (round > 0 && drained(clock)) break;
      const end = playOutPlan(clock, world, pid, examine[i].actions, w);
      ends[i].push(end);
      imm[i].sum += evaluate(end, pid, w);
      imm[i].n += 1;
    }

    /* Gambling plans get a second throw of the same world's dice: identical
       opponent, re-salted RNG, so the coin is resampled while everything else
       is held constant. */
    if (gambling && !drained(clock)) {
      const rethrow = buildWorld(state, pid, salt + 100, true);
      for (let i = 0; i < M; i++) {
        if (!planGambles(examine[i].actions, state)) continue;
        if (drained(clock)) break;
        const end = playOutPlan(clock, rethrow, pid, examine[i].actions, w);
        imm[i].sum += evaluate(end, pid, w);
        imm[i].n += 1;
      }
    }

    /* Rollouts, leaders-first by the current estimate, while the round's
       share of the clock lasts. */
    if (cfg.depth > 0) {
      const order = examine.map((_, i) => i).sort((a, b) => score(b) - score(a));
      for (const i of order.slice(0, 4)) {
        if (clock.left <= ROLLOUT_FLOOR) break;
        const end = ends[i][ends[i].length - 1];
        if (!end) continue;
        const slice = Math.max(ROLLOUT_FLOOR, Math.round(clock.left / 6));
        roll[i].sum += end.winner
          ? evaluate(end, pid, w)
          : rollout(clock, slice, end, pid, Math.min(2, cfg.depth), w, true);
        roll[i].n += 1;
      }
    }

    /* Converged? The same leader by a clear margin two rounds running is a
       verdict; the remaining budget belongs to the next decision, not this
       one. `worlds` names the floor the caller asked for. */
    const ranked = examine.map((_, i) => i).sort((a, b) => score(b) - score(a));
    const margin = ranked.length > 1 ? score(ranked[0]) - score(ranked[1]) : Infinity;
    if (ranked[0] === prevLeader && margin > 800) leaderStable += 1;
    else leaderStable = 0;
    prevLeader = ranked[0];
    if (round + 1 >= worlds && leaderStable >= 2) break;
  }

  const out: Line[] = examine.map((line, i) => ({ ...line, score: score(i) }));
  out.sort((a, b) => b.score - a.score);
  out.push(...all.slice(examine.length));
  return out;
}

/** Ops that consume the RNG, read off a card's own effect definitions. */
const GAMBLE_SLUGS = new Map<string, boolean>();
function slugGambles(slug: string): boolean {
  const hit = GAMBLE_SLUGS.get(slug);
  if (hit !== undefined) return hit;
  const walk = (ops: readonly unknown[]): boolean =>
    ops.some((op) => {
      const o = op as { op: string; heads?: unknown[]; tails?: unknown[]; perPip?: unknown[]; onSuccess?: unknown[]; onFail?: unknown[] };
      if (o.op === 'coinFlip' || o.op === 'diceRoll' || o.op === 'diceMakeSeven') return true;
      for (const k of ['heads', 'tails', 'perPip', 'onSuccess', 'onFail'] as const) {
        const nested = o[k];
        if (nested && walk(nested)) return true;
      }
      return false;
    });
  const gambles = (CARDS[slug]?.effects ?? []).some((e) => walk(e.ops));
  GAMBLE_SLUGS.set(slug, gambles);
  return gambles;
}

/** Does any action in this plan set dice rolling or coins spinning? */
function planGambles(actions: DuelAction[], state: DuelState): boolean {
  for (const a of actions) {
    const uid =
      a.type === 'ignition' || a.type === 'activateSpell' || a.type === 'activateSetCard' || a.type === 'normalSummon' || a.type === 'handSummon'
        ? a.uid
        : null;
    if (!uid) continue;
    for (const pid of ['p1', 'p2'] as PlayerId[]) {
      const p = state.players[pid];
      const c =
        p.hand.find((x) => x.uid === uid) ??
        p.monsters.find((x) => x?.uid === uid) ??
        (p.spellTrap?.uid === uid ? p.spellTrap : undefined);
      if (c && slugGambles(c.slug)) return true;
    }
  }
  return false;
}

/** A coarse position signature for de-duplicating beam continuations. */
function stateSig(s: DuelState): string {
  const side = (pid: PlayerId) => {
    const p = s.players[pid];
    const mons = p.monsters
      .map((m) => (m ? `${m.slug}.${m.face}.${m.position}.${m.atkMod + m.turnAtkMod}.${m.attacksUsed}` : '-'))
      .join(',');
    return `${p.lp}|${mons}|${p.hand.length}|${p.spellTrap ? p.spellTrap.slug + p.spellTrap.face : '-'}|${p.field?.slug ?? '-'}|${p.grave.length}`;
  };
  return `${s.phase}|${side('p1')}#${side('p2')}`;
}

/** A stable short signature for one action, for de-duplicating merged beams. */
function actionKey(a: DuelAction): string {
  switch (a.type) {
    case 'normalSummon':
      return `ns:${a.uid}:${a.face}:${a.position}:${(a.tributes ?? []).join(',')}:${(a.targets ?? []).join(',')}`;
    case 'attack':
      return `at:${a.uid}:${a.targetUid ?? 'direct'}`;
    case 'activateSpell':
    case 'activateSetCard':
    case 'discardForEffect':
      return `${a.type}:${a.uid}:${(a.targets ?? []).join(',')}`;
    case 'ignition':
      return `ig:${a.uid}:${a.effectIndex ?? 0}:${(a.targets ?? []).join(',')}`;
    case 'fusionSummon':
      return `fu:${a.extraUid}:${a.materials.join(',')}`;
    case 'handSummon':
      return `hs:${a.uid}:${a.discardUid ?? ''}`;
    case 'chooseCard':
      return `ch:${a.uids.join(',')}`;
    case 'respondTrap':
      return `rt:${a.uid ?? 'pass'}:${(a.targets ?? []).join(',')}`;
    case 'toPhase':
      return `tp:${a.phase}`;
    case 'changePosition':
      return `cp:${a.uid}`;
    case 'setSpellTrap':
      return `st:${a.uid}`;
    default:
      return a.type;
  }
}

function pickWithSlack(all: Line[], cfg: AiConfig): DuelAction[] {
  if (!all.length) return [{ type: 'endTurn' }];
  const index = cfg.slack > 0 ? Math.min(all.length - 1, Math.floor(Math.random() * cfg.slack * all.length)) : 0;
  return all[index].actions;
}

/** How much of a line's score the playout is allowed to be, by default. */
const DEFAULT_ROLLOUT_MIX = 0.5;

/**
 * The most a playout may move a line's score, either way.
 *
 * Roughly the full range of the evaluation's own race term — ±4 turns at 900 a
 * turn. `evaluate` returns ±1e9 for a decided duel, and a duel decided three
 * modelled turns away over a shuffled deck is not decided at all; unbounded,
 * one such guess outranked every real reading of the board.
 */
const ROLLOUT_AUTHORITY = 3600;

/**
 * Mixes what the board says now with what the playout thinks happens next.
 * The playout can re-rank lines the evaluation rates closely, which is its
 * job, and cannot overturn a reading that is decisive on its face.
 */
function blendRollout(immediate: number, seen: number, mix: number): number {
  const k = Math.max(0, Math.min(1, mix));
  const shift = (seen - immediate) * k;
  return immediate + Math.max(-ROLLOUT_AUTHORITY, Math.min(ROLLOUT_AUTHORITY, shift));
}

/**
 * Plays the next `turns` whole turns out — both sides, alternating — with the
 * same search machinery at low width, then scores where we ended up. Spends at
 * most `nodes` from the clock.
 *
 * `masked` says the state is already a sampled world (deck orders hidden,
 * unseen cards redealt, seed salted); a raw state gets a world built around it
 * first, because playing out the *real* future would be reading the deck.
 */
function rollout(clock: Clock, nodes: number, state: DuelState, me: PlayerId, turns: number, w: EvalWeights, masked = false): number {
  let cur = masked ? state : buildWorld(state, me, 7, true);
  const floor = clock.left - Math.min(nodes, clock.left);
  /* The reply model earns width with budget. A starved slice plays the narrow
     model the old rollouts always did; a fed one models the opponent's turn
     nearly as well as the opponent would play it, which is what the defensive
     half of every decision is resting on. */
  const model: AiConfig =
    nodes >= 2000
      ? { beam: 6, branch: 16, slack: 0, depth: 0, weights: w }
      : { ...MODEL_CFG, weights: w };
  const perTurn = Math.max(70, Math.round(nodes / Math.max(1, turns)));

  for (let t = 0; t < turns; t++) {
    if (cur.winner || clock.left <= floor || Date.now() > clock.wallCap) break;
    cur = settleWindows(clock, cur, me, w, true);
    if (cur.winner) break;

    const mover = cur.active;
    const share: Clock = { left: Math.min(perTurn, clock.left - floor), wallCap: clock.wallCap };
    const plan = planWith(cur, mover, model, share);
    clock.left -= Math.min(perTurn, clock.left - floor) - Math.max(0, share.left);
    for (const action of plan) {
      const res = sim(clock, cur, mover, action);
      if (res.error) break;
      cur = res.state;
      if (cur.winner) break;
      cur = settleWindows(clock, cur, me, w, true);
    }
    if (cur.active === mover && !cur.winner) break;
  }
  return evaluate(cur, me, w);
}

/* ------------------------------------------------------------------ */
/* Response windows                                                    */
/* ------------------------------------------------------------------ */

/**
 * Answer a parked effect's question by playing each option out one step,
 * against sampled worlds when the budget allows.
 */
export function chooseCardResponse(state: DuelState, pid: PlayerId, level: AiSetting = 'champion', budgetMs = 400): DuelAction {
  const cfg = cfgOf(level);
  const w = cfg.weights ?? WEIGHTS;
  const clock = clockFor(budgetMs);
  const options = candidates(state, pid, cfg.branch);
  if (!options.length) return { type: 'chooseCard', uids: [] };
  if (options.length === 1) return options[0];

  const K = clock.left >= 1800 ? 2 : 1;
  const worlds: DuelState[] = [];
  for (let k = 0; k < K; k++) worlds.push(buildWorld(state, pid, k + 31, k > 0));

  let best: DuelAction = options[0];
  let bestScore = -Infinity;
  for (const action of options) {
    let sum = 0;
    let taken = 0;
    for (const world of worlds) {
      if (drained(clock) && taken) break;
      const res = sim(clock, world, pid, action);
      if (res.error) continue;
      sum += evaluate(settleWindows(clock, res.state, pid, w, true), pid, w);
      taken += 1;
    }
    if (!taken) continue;
    const score = sum / taken;
    if (score > bestScore) {
      bestScore = score;
      best = action;
    }
  }
  return best;
}

/**
 * Decide a pending trap window by playing each answer out — not just the
 * window itself, but the rest of the turn it interrupts.
 *
 * The one-step version had a blind spot the size of the whole decision: firing
 * Mirror Force at a lone weak attacker scored as a kill, and holding it scored
 * as nothing, so the Force always fired at the first thing that moved. What
 * holding it is worth only appears when the *rest* of the opponent's turn is
 * played out and their remaining attackers connect. Each option is therefore
 * settled and then rolled forward inside sampled worlds, and judged on where
 * the turn actually ends — as a bounded vote against the settled reading,
 * because it is one modelled turn in one sampled world.
 */
export function chooseTrapResponse(state: DuelState, pid: PlayerId, level: AiSetting = 'champion', budgetMs = 900): DuelAction {
  const cfg = cfgOf(level);
  const w = cfg.weights ?? WEIGHTS;
  const clock = clockFor(budgetMs);
  const options = candidates(state, pid, cfg.branch);
  if (!options.length) return { type: 'respondTrap', uid: null };
  if (options.length === 1) return options[0];

  /* Below the floor there is no room to play anything out — one-step greedy,
     which is what the search's own window-settling uses. */
  if (clock.left < 1000) return greedyResponse(clock, state, pid, cfg);

  /* A second world halves what each option's playout gets, and a rollout below
     ~800 nodes is the thin model the deep-window rework exists to avoid. So the
     depth is fixed first and the second world is bought only when both worlds
     can still afford a real playout per option. */
  const per1 = Math.max(400, Math.round((clock.left * 0.8) / options.length));
  const K = per1 >= 1600 ? 2 : 1;
  const worlds: DuelState[] = [];
  for (let k = 0; k < K; k++) worlds.push(buildWorld(state, pid, k + 53, true));

  let best: DuelAction = { type: 'respondTrap', uid: null };
  let bestScore = -Infinity;
  const per = Math.round(per1 / K);
  for (const action of options) {
    let sum = 0;
    let taken = 0;
    for (const world of worlds) {
      if (drained(clock) && taken) break;
      const res = sim(clock, world, pid, action);
      if (res.error) continue;
      const cur = settleWindows(clock, res.state, pid, w, true);
      const settled = evaluate(cur, pid, w);
      if (!cur.winner && cur.active !== pid && clock.left > 500) {
        const seen = rollout(clock, per, cur, pid, 1, w, true);
        sum += blendRollout(settled, seen, 0.5);
      } else {
        sum += settled;
      }
      taken += 1;
    }
    if (!taken) continue;
    const score = sum / taken;
    if (score > bestScore) {
      bestScore = score;
      best = action;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Runtime                                                             */
/* ------------------------------------------------------------------ */

/**
 * Holds the plan for the current turn. Searching once per turn rather than once
 * per action is roughly eight times cheaper and plays the same line, since the
 * search already decided the whole sequence.
 */
export interface AiRuntime {
  plan: DuelAction[];
  key: string;
}

export const createAiRuntime = (): AiRuntime => ({ plan: [], key: '' });

/** Forces a fresh search — call this whenever an action did not apply. */
export function invalidatePlan(rt: AiRuntime) {
  rt.plan = [];
  rt.key = '';
}

/** The next action the AI wants to take, planning a whole turn at a time. */
export function aiNext(
  state: DuelState,
  pid: PlayerId,
  level: AiSetting,
  rt: AiRuntime,
  budgetMs = 2500
): DuelAction | null {
  if (state.winner) return null;
  if (state.pending) {
    invalidatePlan(rt);
    if (state.pending.player !== pid) return null;
    return state.pending.kind === 'choose'
      ? chooseCardResponse(state, pid, level, Math.min(300, budgetMs * 0.4))
      : chooseTrapResponse(state, pid, level, Math.min(2000, budgetMs * 0.8));
  }
  if (state.active !== pid) {
    invalidatePlan(rt);
    return null;
  }
  const key = `${state.turn}:${pid}`;
  if (rt.key !== key || !rt.plan.length) {
    rt.plan = planTurn(state, pid, level, budgetMs);
    rt.key = key;
  }
  return rt.plan.shift() ?? { type: 'endTurn' };
}

/** One-shot convenience wrapper; prefer `aiNext` with a runtime in a loop. */
export function nextAction(state: DuelState, pid: PlayerId, level: AiSetting = 'champion', budgetMs = 2500): DuelAction | null {
  return aiNext(state, pid, level, createAiRuntime(), budgetMs);
}

export { MONSTER_ZONES };
