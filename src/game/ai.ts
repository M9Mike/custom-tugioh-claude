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
import { CARDS, baseAtk } from './cards';
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
  tributesRequired, tributeSetFor } from './engine';
import { changesAnything, matchesFilter } from './targeting';
import { summonTargetSpec, targetSpecFor } from './ui';
import { type AiLevel } from './ai-levels';
import { MONSTER_ZONES, type CardFilter, type CardInstance, type DuelAction, type DuelState, type PlayerId } from './types';

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
  /**
   * The deck's learned style, from `src/server/learning.ts`. Bounded small:
   * neutral is exactly the shipped search, and the clamps keep every leaning
   * inside the range the check suite was validated against.
   */
  style?: { aggression: number; caution: number };
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
 *
 * Conditioned on the one public fact a Set carries: what it cost. A face-down
 * that arrived without Tributes can only be Level 4 or lower — the rules say
 * so — and one that visibly ate a Tribute is Level 5 or higher, so it reads
 * as a big body. Watching what was paid is reading the table, not the card.
 */
const unknownMeans = (() => {
  /* A Set is CHOSEN, not drawn: people Set their walls and their flip
     effects, not their average card, so the unknown averages over the
     Level ≤ 4 monsters somebody would actually put face-down — defence at
     least even with attack, or a flip effect worth hiding. The first cut of
     this averaged the whole small half of the pool, priced every unknown at
     1150/1050, and the engine turned globally optimistic about faces it had
     never seen — measured as three points of win rate given away to its own
     baseline. Selection bias is information too. */
  const setish = { atk: 0, def: 0, n: 0 };
  const big = { atk: 0, def: 0, n: 0 };
  for (const def of Object.values(CARDS)) {
    if (def.kind !== 'monster' || def.slug === 'facedown' || def.type === 'Divine-Beast') continue;
    if ((def.level ?? 0) > 4) {
      big.atk += Math.max(0, def.atk ?? 0);
      big.def += Math.max(0, def.def ?? 0);
      big.n += 1;
      continue;
    }
    const wall = (def.def ?? 0) >= (def.atk ?? 0);
    const flip = (def.effects ?? []).some((e) => e.trigger === 'onFlip');
    if (!wall && !flip) continue;
    setish.atk += Math.max(0, def.atk ?? 0);
    setish.def += Math.max(0, def.def ?? 0);
    setish.n += 1;
  }
  const mean = (t: { atk: number; def: number; n: number }) => ({
    atk: Math.round(t.atk / Math.max(1, t.n) / 50) * 50,
    def: Math.round(t.def / Math.max(1, t.n) / 50) * 50,
  });
  return { small: mean(setish), big: mean(big) };
})();
/* Derived, not written: the constants here were hand-set as "roughly the mean
   across the season-one decks" and the card pool walked away from them — the
   same rot that left UNKNOWN_PROXY pointing at a 2400/2000 wall. An untributed
   Set can only be Level 4 or lower, so it averages over that half of the pool;
   a Set that visibly cost a Tribute averages over the other. Gods excluded:
   they cannot be Set. */
/**
 * The same two averages, computed from ONE opponent's live unseen multiset —
 * their hand, their deck, and the face-down cards themselves, all of which is
 * decklist-minus-what-you-have-seen and therefore table knowledge.
 *
 * This is what breaks the tie the global constants could not: against a deck
 * whose walls are thin, an 1100 probe is a favourite and the anchor world
 * should say so; against a wall-heavy deck the same probe bounces, and the
 * SAME code says that instead. One number was serving both masters and lost
 * games at each extreme. Cached per state object — worlds are clones, and
 * every evaluation of one state asks many times.
 */
const POOL_UNKNOWN = new WeakMap<DuelState, Map<PlayerId, { small: { atk: number; def: number }; big: { atk: number; def: number } }>>();
function unknownFor(state: DuelState, pid: PlayerId): { small: { atk: number; def: number }; big: { atk: number; def: number } } {
  let byPid = POOL_UNKNOWN.get(state);
  if (!byPid) {
    byPid = new Map();
    POOL_UNKNOWN.set(state, byPid);
  }
  const hit = byPid.get(pid);
  if (hit) return hit;
  const p = state.players[pid];
  const smallAtk: number[] = [];
  const smallDef: number[] = [];
  const bigAtk: number[] = [];
  const bigDef: number[] = [];
  const consider = (slug: string) => {
    const d = CARDS[slug];
    if (d?.kind !== 'monster' || d.type === 'Divine-Beast') return;
    if ((d.level ?? 0) > 4) {
      bigAtk.push(Math.max(0, d.atk ?? 0));
      bigDef.push(Math.max(0, d.def ?? 0));
    } else {
      smallAtk.push(Math.max(0, d.atk ?? 0));
      smallDef.push(Math.max(0, d.def ?? 0));
    }
  };
  for (const c of p.hand) consider(c.slug);
  for (const c of p.deck) consider(c.slug);
  for (const m of p.monsters) if (m && m.face === 'down') consider(m.slug);
  /* MEDIAN, not mean, and it is load-bearing: the beam prunes lines by their
     anchor-world score before the judge ever votes, so the anchor body's DEF
     decides whether a probing attack survives to be sampled at all. The
     median answers the question the anchor world is standing in for — "what
     happens in the TYPICAL world" — where a mean dragged upward by a couple
     of 2000-DEF walls answered "bounce" against pools two-thirds of which
     die to the swing. Same statistic the sampler converges to, same
     distribution the sampler deals from: all of it, unweighted, because the
     sampled worlds deal unweighted. */
  const med = (xs: number[], fb: number): number => {
    if (!xs.length) return fb;
    const sorted = [...xs].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  const out = {
    small: { atk: med(smallAtk, unknownMeans.small.atk), def: med(smallDef, unknownMeans.small.def) },
    big: { atk: med(bigAtk, unknownMeans.big.atk), def: med(bigDef, unknownMeans.big.def) },
  };
  byPid.set(pid, out);
  return out;
}

const UNKNOWN_ATK = unknownMeans.small.atk;
/* What a body they have not summoned yet swings for — one number, shared by
   the threat term's phantom and the expectation world's hand proxies, so the
   two models of the same idea cannot drift apart. It sits above the Set-mean
   on purpose: people Set their walls and summon their attackers. */
const PHANTOM_SUMMON_ATK = 1600;
const UNKNOWN_DEF = unknownMeans.small.def;
const TRIBUTED_UNKNOWN_ATK = unknownMeans.big.atk;
const TRIBUTED_UNKNOWN_DEF = unknownMeans.big.def;

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
  const tributed = hidden && (m.setTributes ?? 0) > 0;
  const pool = hidden ? unknownFor(state, ctrl) : null;
  const atk = hidden ? (tributed ? pool!.big.atk : pool!.small.atk) : effAtk(state, m, ctrl);
  const def = hidden ? (tributed ? pool!.big.def : pool!.small.def) : effDef(state, m, ctrl);
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

  let cleared = 0;
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
      cleared += 1;
      continue;
    }
    // Nothing it beats: a sensible attacker simply does not swing.
  }

  /* Attack power available *per turn from next turn on*, which is what `clock`
     divides the remaining Life Points by — but ONLY if these attackers can
     ever actually connect. An army that cannot break a single blocker has no
     clock at all, and pretending otherwise made the race term claim a
     two-turn win for two monsters permanently walled behind a Dark Magician
     — which then out-voted every defensive truth on the table. */
  const walled = walls.length > 0 && cleared === 0 && !attackers.some((a) => a.direct);
  const freeAtk = walled ? 0 : attackers.reduce((sum, a) => sum + a.atk * a.attacks, 0);
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
  /* A full board is not a locked door — and it is not extra space either.
     Gating the phantom on an empty zone made KEEPING their zones jammed
     with harmless bodies read as safety: the computer refused to break a
     board of Sheep Tokens because killing one "let them summon", a
     protection racket the owner caught from one screen. But simply leaving
     the phantom ON over a full board counted a hypothetical body their
     zones cannot hold as a NEW attacker, and the walls-in-front-of-lethal
     pin fell to 0/10 — survival math where every wall was already dead to
     a summon that could not fit. The honest arithmetic: in space the hand
     ADDS its average body; on a full board it can only Tribute over its
     weakest attacker, so the phantom REPLACES that one. Clearing a blocker
     still toggles nothing — the threat reads the same both sides of the
     kill — and the racket stays dead. */
  /* D1 of the plan: the phantom's size scales gently with the grip. One
     card might be anything; a full hand almost certainly holds a real
     summon, and the flat phantom read both as the same threat — which is
     how a player tapped completely out and a player sitting on five cards
     came to press the same amount of respect out of the computer. Gentle
     on purpose: ±200 around the shared constant, never a new attacker. */
  const grip = Math.min(4, p.hand.length);
  const phantomAtk = PHANTOM_SUMMON_ATK - 200 + grip * 100;
  let fieldable = p.hand.length > 0 && !monstersFrozen(state, att);
  if (fieldable && !p.monsters.some((m) => !m)) {
    if (!attackers.length) {
      // All their bodies kneel: the tribute spends one of those, off-calc.
    } else {
      let weakest = 0;
      for (let i = 1; i < attackers.length; i++) if (attackers[i].atk < attackers[weakest].atk) weakest = i;
      // Tributing over a body BIGGER than the average summon is a downgrade
      // nobody performs; the phantom stands down instead of shrinking them.
      if (attackers[weakest].atk >= phantomAtk) fieldable = false;
      else attackers.splice(weakest, 1);
    }
  }
  if (fieldable) {
    attackers.push({
      atk: phantomAtk,
      def: 0,
      wall: phantomAtk,
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
  /** Learned style leanings, threaded so evaluate stays a pure function. */
  styleAggression?: number;
  styleCaution?: number;
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
 * What a monster threatens beyond its printed numbers, read off its effects.
 *
 * A Red-Eyes that burns for 800 a turn and grows with every kill, a Zoa about
 * to shed into Metalzoa, a scorpion that eats what it kills — all of them
 * read as "just a number" to an evaluation that stops at ATK and DEF, and the
 * owner watched the computer ignore every boss on the table because a plain
 * 2500 stood beside it. Derived from the card's own ops, cached, and honest:
 * face-up monsters only, because a face-down one has not been shown.
 */
/**
 * What a face-down monster of OURS is worth beyond its body: the flip effect
 * waiting inside it. Summoning Magician of Faith face-up throws her whole
 * card away — the effect only exists on the way from face-down to face-up —
 * and the evaluation priced every face-down at the same flat token, so the
 * search saw no reason not to. Own monsters only: reading the opponent's
 * face-down would be reading the card.
 */
/** How many cards this monster's FLIP draws its controller, if any. */
const FLIP_DRAWS = new Map<string, number>();
function flipDrawCount(slug: string): number {
  const cached = FLIP_DRAWS.get(slug);
  if (cached !== undefined) return cached;
  let n = 0;
  for (const eff of CARDS[slug]?.effects ?? []) {
    if (eff.trigger !== 'onFlip') continue;
    for (const op of eff.ops) {
      if (op.op === 'draw' && (!('who' in op) || op.who !== 'opp')) n += 'count' in op ? (op.count ?? 1) : 1;
    }
  }
  FLIP_DRAWS.set(slug, n);
  return n;
}

const FLIP_WORTH = new Map<string, number>();
function flipWorth(slug: string): number {
  const cached = FLIP_WORTH.get(slug);
  if (cached !== undefined) return cached;
  let worth = 0;
  for (const eff of CARDS[slug]?.effects ?? []) {
    if (eff.trigger !== 'onFlip') continue;
    for (const op of eff.ops) {
      if (op.op === 'destroy') worth += 'target' in op && op.target?.pick === 'all' ? 600 : 350;
      else if (op.op === 'bounce') worth += 300;
      else if (op.op === 'damage') worth += Math.min(400, ('amount' in op ? (op.amount ?? 0) : 0) * 0.4);
      /* Count-aware: Morphing Jar's flip draws FIVE, and the flat 240 priced
         it like a cantrip — which is how the Jar kept walking onto the table
         face-up to trade 700 ATK for a Sheep Token instead of Setting the
         strongest draw engine in the deck. */
      else if (op.op === 'draw') worth += Math.min(500, 100 * ('count' in op ? (op.count ?? 1) : 1) + 40);
      else if (op.op === 'stealFromGrave' || op.op === 'search') worth += 240;
      else if (op.op === 'specialSummon' || op.op === 'summonToken') worth += 260;
      else worth += 80;
    }
  }
  const clamped = Math.min(700, worth);
  FLIP_WORTH.set(slug, clamped);
  return clamped;
}

/**
 * What holding this card promises beyond itself: the strongest cards its own
 * ops can pull out of the Deck, derived from the effect DSL and cached.
 *
 * A hand was priced flat — 220 a card — so Witch of the Black Forest and a
 * vanilla 1100 read as the same asset, and the search happily discarded the
 * searcher. Nothing here is hand-written per combo: a card that fetches or
 * summons another names it in its ops, so every future card inherits its
 * lines for free. Top three targets only, kept as slugs; whether a target is
 * still IN the deck is checked at evaluation time, because a fetcher whose
 * every target is already spent promises nothing.
 */
const ENABLE_TARGETS = new Map<string, { slugs: string[]; summon: boolean }[]>();
function enableTargets(slug: string): { slugs: string[]; summon: boolean }[] {
  const cached = ENABLE_TARGETS.get(slug);
  if (cached) return cached;
  const out: { slugs: string[]; summon: boolean }[] = [];
  const worthOf = (t: string): number => (menace(t) + Math.max(0, CARDS[t]?.atk ?? 0) * 0.12) || 0;
  for (const eff of CARDS[slug]?.effects ?? []) {
    for (const op of eff.ops) {
      let filter: CardFilter | undefined;
      let summon = false;
      if (op.op === 'search') filter = op.filter;
      else if (op.op === 'specialSummon') {
        const zones = Array.isArray(op.from) ? op.from : [op.from];
        if (!zones.includes('deck')) continue;
        filter = op.filter;
        summon = true;
      } else continue;
      const matches = Object.values(CARDS)
        .filter((d) => d.slug !== 'facedown' && d.slug !== slug && matchesFilter({ slug: d.slug } as CardInstance, filter))
        .sort((x, y) => worthOf(y.slug) - worthOf(x.slug))
        .slice(0, 3)
        .map((d) => d.slug);
      if (matches.length) out.push({ slugs: matches, summon });
    }
  }
  ENABLE_TARGETS.set(slug, out);
  return out;
}

/** What this hand card promises, given what is still in the holder's Deck. */
function promiseOf(slug: string, deckSlugs: Set<string>): number {
  let best = 0;
  for (const en of enableTargets(slug)) {
    for (const t of en.slugs) {
      if (!deckSlugs.has(t)) continue;
      const worth = (menace(t) + Math.max(0, CARDS[t]?.atk ?? 0) * 0.12) * (en.summon ? 0.3 : 0.2);
      best = Math.max(best, Math.min(en.summon ? 300 : 220, worth));
    }
  }
  return best;
}

const MENACE = new Map<string, number>();
function menace(slug: string): number {
  const cached = MENACE.get(slug);
  if (cached !== undefined) return cached;
  let worth = 0;
  for (const eff of CARDS[slug]?.effects ?? []) {
    if (eff.trigger === 'ignition') {
      for (const op of eff.ops) {
        if (op.op === 'damage') worth += Math.min(600, ('amount' in op ? (op.amount ?? 0) : 0) * 0.5 + ('plusPerCounter' in op && op.plusPerCounter ? 200 : 0));
        else if (op.op === 'destroy') worth += 400;
        else if (op.op === 'possess' || op.op === 'takeControl') worth += 500;
        else worth += 60;
      }
    } else if (eff.trigger === 'onBattleDestroy') {
      for (const op of eff.ops) {
        if (op.op === 'gainAtk') worth += Math.min(500, 'amount' in op ? (op.amount ?? 0) : 0);
        else if (op.op === 'damage') worth += Math.min(400, ('amount' in op ? (op.amount ?? 0) : 0) * 0.4);
        else if (op.op === 'absorb') worth += 600;
        else worth += 80;
      }
    } else if (eff.trigger === 'onDestroyed') {
      // It dies into another body — killing it is only half a kill.
      if (eff.ops.some((op) => op.op === 'specialSummon' || op.op === 'summonToken')) worth += 250;
    }
  }
  const clamped = Math.min(1200, worth);
  MENACE.set(slug, clamped);
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
    if (m.face === 'up') score += menace(m.slug) * 0.6;
    /* Unknown to them, loaded for us — and the load is priced at face value:
       a FLIP effect fires on every road out of face-down (our own Flip
       Summon, or their attack walking into it), so the old half-price
       haircut treated a certainty as a maybe, and Morphing Jar walked onto
       the table face-up with its whole card thrown away. */
    if (m.face === 'down') {
      score += 120 + flipWorth(m.slug);
      /* A draw engine is worth more the emptier the hand that holds it: the
         Jar at zero cards in hand is a four-card swing waiting under the
         card back, and the static price read it like a mid-game cantrip.
         Scaled by the deficit and gone entirely at a full grip, derived
         from the ops like everything else. */
      const draws = flipDrawCount(m.slug);
      if (draws) score += Math.max(0, 4 - my.hand.length) * draws * 30;
    }
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
    if (m.face === 'up') score -= menace(m.slug) * 0.6;
    /* An unrevealed card of theirs is worth more than its average body: the
       flip effect that might be loaded inside it, and the information they
       hold that we do not. The number is MEASURED: doubling it to 240 (to
       fatten the probing margin) was a flat bounty on attacking Set monsters
       that fired in nearly every game, and the arena priced it at seven
       points of win rate — 43.2% ±3.2 against the pre-plan AI, back to
       51.0% ±5.7 the moment this line alone went back to 120. Every probe
       pin passes at 120; the sampled worlds, not a subsidy, decide when the
       unknown is worth hitting. Do not raise this without a race. */
    if (m.face === 'down') score -= 120;
    if (m.rentPerTurn && m.owner !== foe) score += m.rentPerTurn * 0.8;
  }

  // Card advantage. A card in hand is a future threat; a set Spell/Trap is a
  // live one — ours priced by what it actually does, theirs by not knowing.
  score += (my.hand.length - their.hand.length) * w.hand;
  /* The promise inside the hand, on top of the flat card value — a searcher
     whose target is still in the Deck is worth more than a vanilla body, and
     was priced identically. Own hand only: theirs is proxied in every world
     this function runs in, which is the honesty doing its job. */
  {
    const deckSlugs = new Set(my.deck.map((c) => c.slug));
    for (const h of my.hand) score += promiseOf(h.slug, deckSlugs);
  }
  /* The Tribute ladder: bodies standing where a boss is waiting are the
     price of Summoning it already half-paid, and fodder summons stopped
     reading as weak tempo the day this landed. Counted only up to what the
     biggest boss in hand actually needs, at a deliberately modest rate —
     the boss on the BOARD is the real prize, and this must never outbid
     summoning it. */
  {
    let need = 0;
    for (const h of my.hand) {
      const d = CARDS[h.slug];
      if (d?.kind !== 'monster' || EXODIA.has(h.slug)) continue;
      const lv = d.level ?? 0;
      const n = d.type === 'Divine-Beast' ? 3 : lv >= 7 ? 2 : lv >= 5 ? 1 : 0;
      need = Math.max(need, n);
    }
    if (need > 0) {
      const bodies = my.monsters.filter(Boolean).length;
      score += Math.min(bodies, need) * 140;
    }
  }
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
    /* At full voice only when somebody's kill is actually in sight. The
       clamp read "one 700 attacker versus none" as the same +4 whether the
       finish was three turns out or seventeen, and that 3600-point shout
       drowned every value judgment in quiet positions — a flip engine
       stayed in hand because a vanilla body "was winning the race" it
       could not finish this side of a dozen draws. Urgency falls with the
       SQUARE of the shorter clock past the clamp horizon: a real race is
       still the whole game, a distant one is background. */
    const soon = Math.max(1, Math.min(myClock, theirClock));
    const urgency = Math.min(1, (4 / soon) * (4 / soon));
    score += Math.max(-4, Math.min(4, theirClock - myClock)) * w.clock * urgency;
  }

  // Standing in front of lethal, or having lethal, still gets a hard cliff:
  // those are not gradual positions.
  const threat = threatAgainst(state, me, me);
  if (threat >= my.lp) score -= 25_000;
  else score -= threat * 0.55;

  /* Life Points are a cushion, not a score: the closer their board comes to
     covering what is left, the more every further point costs. Linear LP made
     the 800th point worth the 8000th, and the computer donated its cushion to
     bad trades all game. */
  if (threat > 0 && threat < my.lp && my.lp < threat * 2) score -= (threat * 2 - my.lp) * 0.4;

  /* A body standing in Attack Position it cannot justify is a Life-Point
     leak: whatever kneeling would save is charged for standing. The aggregate
     threat term already knows this, but at a weight the search's sampling
     noise drowns — the owner watched two outgunned monsters stand at
     attention while a 2500 queued up behind them, and the computer end its
     turn. Charged per body, against their best visible attacker, and only
     when Defence genuinely takes less. */
  {
    let bestFoe = 0;
    let foePierces = false;
    for (const fm of their.monsters) {
      if (!fm || fm.face !== 'up' || fm.position !== 'atk') continue;
      const fb = bodyOf(state, fm, foe, me);
      if (fb.atk > bestFoe) {
        bestFoe = fb.atk;
        foePierces = fb.pierce;
      }
    }
    if (bestFoe > 0) {
      let leak = 0;
      for (const m of my.monsters) {
        if (!m || m.face !== 'up' || m.position !== 'atk') continue;
        const b = bodyOf(state, m, me, me);
        if (b.atk >= bestFoe) continue;
        const standing = bestFoe - b.atk;
        const kneeling = foePierces ? Math.max(0, bestFoe - b.def) : 0;
        /* Capped per body and in total: the charge is for standing wrong,
           and it must never grow past the point where dying starts to look
           like relief. */
        if (standing > kneeling) leak += Math.min(400, (standing - kneeling) * 0.65 * (1 + 0.4 * (w.styleCaution ?? 0)));
      }
      score -= Math.min(800, leak);
    }
  }

  const pressure = threatAgainst(state, foe, me);
  if (pressure > 0 && pressure < their.lp && their.lp < pressure * 2) score += (pressure * 2 - their.lp) * 0.3 * (1 + 0.3 * (w.styleAggression ?? 0));
  /* "Lethal next turn" is not a fact while a Set card could erase the board
     that delivers it. The cliff was what made every all-in line tower over
     every careful one by more than any risk term could claw back — the
     mechanism, measured move for move, behind "I win 100% of the games". */
  if (pressure >= their.lp && !(their.spellTrap && their.spellTrap.face === 'down')) score += 20_000;
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
    /* The same two narrowings the board's own picker applies. Without them the
       search had a wider pool than the interface and ranked it by ATK, so Stop
       Defense beside a kneeling 800 and a standing 1300 aimed at the 1300 —
       which was already attacking — and the card was spent changing nothing.
       Watched happening in a real duel. */
    if (spec.zone === 'monster')
      pool.push(
        ...p.monsters.filter(
          (m): m is CardInstance => !!m && matchesFilter(m, spec.filter) && changesAnything(spec.changing, m)
        )
      );
    else if (spec.zone === 'spellTrap' || spec.zone === 'backrow') {
      if (p.spellTrap) pool.push(p.spellTrap);
      if (spec.zone === 'backrow' && p.field) pool.push(p.field);
    } else if (spec.zone === 'grave') {
      pool.push(...p.grave.filter((c) => CARDS[c.slug]?.kind === 'monster'));
    } else if (spec.zone === 'hand' && id === pid) pool.push(...p.hand);
    else if (spec.zone === 'deck' && id === pid) {
      /* Your own Deck's CONTENTS are yours to know — only its order is
         hidden, and picking the best card by worth reads none of it. This is
         what lets Temple of the Kings actually choose the next draw instead
         of shrugging and taking whatever falls. */
      pool.push(...p.deck);
    }
  }
  if (!pool.length) return [[]];

  /* Strongest first: for removal that is the opponent's best body, for equips
     and revival it is the best body to invest in. EFFECTIVE strength for cards
     on a field, base strength for cards in piles — base, not printed, because
     our Uraby is a 400 ATK mine and the database still says 1500 — a Two-Headed King Rex standing at
     2500 must outrank the 1700 beside it, and by printed ATK it never did, so
     the AI kept pointing its removal at the wrong monster. */
  const worth = (c: CardInstance): number => {
    for (const id of ['p1', 'p2'] as PlayerId[]) {
      if (state.players[id].monsters.some((m) => m?.uid === c.uid)) return effAtk(state, c, id) + menace(c.slug) * 0.8;
    }
    return baseAtk(c.slug) + menace(c.slug) * 0.8;
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
      /* The engine sends the materials to the Graveyard BEFORE it resolves
         the zone, so a board filled by its own materials is a legal fusion —
         and the audit caught the old free-zone check silently deleting
         Valkyrion's whole primary line: three magnets on the field is, by
         definition, a full board. If no zone is free now, aim at the slot a
         field material is about to vacate. */
      let zone = p.monsters.findIndex((m) => !m);
      if (zone < 0) zone = p.monsters.findIndex((m) => m && f.materials.includes(m.uid));
      if (zone >= 0) acts.push({ type: 'fusionSummon', extraUid: f.extraUid, materials: f.materials, zone, position: 'atk' });
    }

    const freeZone = p.monsters.findIndex((m) => !m);
    if (!p.normalSummonUsed) {
      const summonable = p.hand
        // A card drawn inside the world is imagined — counted, never spent.
        .filter((h) => !h.turnFlags.worldBlind)
        .filter((h) => CARDS[h.slug]?.kind === 'monster')
        .filter((h) => !summonBlocked(state, pid, h.slug))
        // Holding the Forbidden One is worth more than summoning it.
        .filter((h) => !EXODIA.has(h.slug))
        .sort((a, b) => baseAtk(b.slug) - baseAtk(a.slug));

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
          /* A wall summoned AS a wall used to be offered here, for a 2000-DEF
             body that would rather not arrive swinging its 800 ATK. It was good
             reasoning about a move that does not exist: out of the hand a
             monster stands up to fight or is Set face-down, and the board only
             ever showed those two buttons. The search was the one seat at the
             table with a third option, which is a cheat however sound it was.
             Face-up Defence is still reached the way everyone reaches it — by
             turning a monster that is already standing. */
        } else if (need > 0) {
          /* `tributeSetFor` rather than `fodder.slice(0, need)`: the price is
             counted in Tributes and Kaiser Sea Horse is worth two of them, so
             the front of a list sorted by what we can bear to lose reaches the
             price with two bodies and never notices that one would have done.
             The sort above is still the preference — it is passed straight in. */
          const set = tributeSetFor(state, pid, h.slug, fodder);
          const tributes = (set ?? []).map((m) => m.uid);
          const zone = !set ? -1 : freeZone >= 0 ? freeZone : p.monsters.findIndex((m) => m && tributes.includes(m.uid));
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
          const set = bodies > 0 ? tributeSetFor(state, pid, h.slug, fodder) : null;
          if (set) {
            acts.push({ type: 'normalSummon', uid: h.uid, zone: freeZone, position: 'atk', face: 'up', tributes: set.map((m) => m.uid) });
          }
        }
      }
    }

    /* A monster that calls itself onto the field — Steel Ogre Grotto beside a
       Machine, Pendulum Machine off the ogre's corpse. `handSummonOffer` is the
       same gate the hand button reads, so the price and the refusal cannot
       drift apart between the two. */
    for (const h of p.hand) {
      if (h.turnFlags.worldBlind) continue; // imagined draw — never spent
      const offer = handSummonOffer(state, pid, h);
      if (!offer?.ok) continue;
      /* The price of the summon is a card, and WHICH card is a real decision
         the old single pick by printed ATK got exactly backwards: every
         Spell prices at zero, so the equip that was the only kill got fed
         first. Offer the cheapest monster AND the cheapest spell as separate
         candidates and let the search compare what each future is worth. */
      const others = p.hand.filter((x) => x.uid !== h.uid);
      const spares: CardInstance[] = [];
      const cheapMonster = others
        .filter((x) => CARDS[x.slug]?.kind === 'monster')
        .sort((a, b) => baseAtk(a.slug) - baseAtk(b.slug))[0];
      const cheapSpell = others
        .filter((x) => CARDS[x.slug]?.kind !== 'monster')
        .sort((a, b) => trapWorth(a.slug) - trapWorth(b.slug))[0];
      if (cheapMonster) spares.push(cheapMonster);
      if (cheapSpell) spares.push(cheapSpell);
      if (offer.discard && !spares.length) continue;
      for (const spare of offer.discard ? spares : [undefined]) {
        for (const t of targetsFor(state, pid, h.slug, 'onSummon')) {
          acts.push({ type: 'handSummon', uid: h.uid, discardUid: spare?.uid, targets: t });
        }
      }
    }

    for (const h of p.hand) {
      if (h.turnFlags.worldBlind) continue; // imagined draw — never spent
      /* A Field Spell replacing an identical Field Spell buys nothing and
         pays a card — the owner watched Necrovalley land on Necrovalley.
         The spare copy is worth more in hand, as insurance for the day the
         first one is destroyed. */
      if (CARDS[h.slug]?.subKind === 'Field' && p.field?.slug === h.slug) continue;
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
    // Setting is worth considering for any card that can act from face-down:
    // every trap, and a Quick-Play Spell whose trap-trigger twin answers a
    // window on the opponent's turn.
    if (!p.spellTrap) {
      for (const h of p.hand) {
        if (h.turnFlags.worldBlind) continue; // imagined draw — never spent
        const def = CARDS[h.slug];
        if (def && (def.kind === 'trap' || def.effects.some((e) => e.trigger === 'trap'))) {
          acts.push({ type: 'setSpellTrap', uid: h.uid });
        }
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
    /* What the monster swings WITH, not what it stands at: Metalzoa doubles
       when attacking, Pendulum Machine hits Defence 1250 harder, and a
       declare-rider pumps on the way in. The audit caught the plain-ATK
       filter deleting on-board lethals through every one of these. */
    const declareRider = (slug: string): number => {
      let bonus = 0;
      for (const eff of CARDS[slug]?.effects ?? []) {
        if (eff.trigger !== 'onDeclareAttack') continue;
        for (const op of eff.ops) {
          if (op.op === 'gainAtk' && 'amount' in op) bonus += op.amount ?? 0;
        }
      }
      return bonus;
    };
    const swingAtk = (m: CardInstance, vsDefense: boolean): number => {
      const f = effFlags(state, m, pid);
      let atk = effAtk(state, m, pid) + declareRider(m.slug);
      if (f.doublesWhenAttacking) atk *= 2;
      if (vsDefense) atk += f.bonusVsDefense ?? 0;
      return atk;
    };
    for (const m of attackers) {
      const { uids, direct } = legalAttackTargets(state, pid, m);
      if (direct) acts.push({ type: 'attack', uid: m.uid, targetUid: null });
      // Prefer targets this monster actually beats, weakest-kill first.
      const atk = effAtk(state, m, pid);
      /* What the viewer is allowed to believe this target defends with. A
         face-down is the conditioned unknown, never its real numbers — the
         old sort read `effDef` straight off the hidden card, which quietly
         ordered the beam by information the player does not have. */
      const foePool = unknownFor(state, foe);
      const wallOf = (t: CardInstance): number =>
        t.face === 'down'
          ? (t.setTributes ?? 0) > 0
            ? foePool.big.def
            : foePool.small.def
          : t.position === 'atk'
            ? effAtk(state, t, foe)
            : effDef(state, t, foe);
      const ranked = uids
        .map((u) => state.players[foe].monsters.find((x) => x?.uid === u)!)
        .filter(Boolean)
        /* A losing attack into a FACE-UP body does not even trade — the
           attacker survives and its controller simply pays the difference in
           Life Points. Pure donation, never once the right line, and not
           offered at all: kills and even trades only.

           A face-down is a different sentence. The same rule applied through
           a flat unknown deleted every probe an attacker under 1300 could
           make — Lady of Faith beside a lone Set monster, 9000 Life Points
           behind her, and the computer ending the turn, reported by the
           owner. The move is generated now and the worlds price it: each
           sampled world deals the Set card a real identity from their unseen
           pool, so the swing is charged its true odds — kills, bounces and
           flip effects alike — instead of being unthinkable. */
        /* A probe must beat the MAJORITY world to be worth a beam slot: the
           wall it is measured against is the pool median the anchor resolves
           at, so a swing that bounces in most of their worlds is cut here —
           at thin serving budgets only two sampled worlds ever price it, and
           speculative below-median probes were beam pollution the real
           opponent punished with real cards. Above the median, the move
           generates and the samples decide. */
        .filter((t) => swingAtk(m, t.face === 'down' || t.position === 'def') >= wallOf(t))
        .sort((a, b) => {
          const av = wallOf(a);
          const bv = wallOf(b);
          const aKill = av < atk ? 0 : 1;
          const bKill = bv < atk ? 0 : 1;
          // Among kills, the monster that threatens the most goes down first.
          const am = a.face === 'up' ? menace(a.slug) * 0.8 : 0;
          const bm = b.face === 'up' ? menace(b.slug) * 0.8 : 0;
          return aKill - bKill || bv + bm - (av + am);
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
 * A proxy whose BODY matches what the evaluation assumes an unknown is worth.
 *
 * "The effectless monster closest to the unknown-average stats" was true the
 * day it was written and quietly stopped being true as the card pool grew:
 * today exactly one monster in the database is effectless — Thousand Dragon,
 * 2400/2000 — so every face-down in the expectation world stood as a wall
 * two-thirds of the game could not break, while the evaluation priced the
 * same card at 1250/1300. The anchor world and the judge disagreeing about
 * what an unknown IS was the deeper half of the owner's report; the modifiers
 * close the gap, whatever monster the pool leaves as the proxy.
 */
function proxyBody(c: CardInstance, atk = UNKNOWN_ATK, def = UNKNOWN_DEF): void {
  reidentify(c, UNKNOWN_PROXY);
  c.atkMod = atk - (CARDS[UNKNOWN_PROXY].atk ?? 0);
  c.defMod = def - (CARDS[UNKNOWN_PROXY].def ?? 0);
}

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
/**
 * The cards among the opponent's unseen that could actually answer from a Set
 * zone — anything carrying a trap-window effect, whatever kind the card is: a
 * Trap proper, or a quick-play Spell that fires from face-down.
 *
 * The pool includes the Set card ITSELF, and that inclusion is the fix for a
 * fear that outlived its object: with both Mirror Forces visible in the
 * Graveyard the old pool read hand+deck, found no trap, and still feared —
 * while the opposite corner was worse, a deck whose LAST trap was the very
 * card Set, which hand+deck alone counted as zero. The unseen multiset is
 * hand + deck + the face-down card, and what can be feared is exactly what it
 * still contains.
 */
function unseenAnswers(foe: { hand: CardInstance[]; deck: CardInstance[]; spellTrap: CardInstance | null }): CardInstance[] {
  const pool = [...foe.hand, ...foe.deck];
  if (foe.spellTrap && foe.spellTrap.face === 'down') pool.push(foe.spellTrap);
  return pool.filter((c) => (CARDS[c.slug]?.effects ?? []).some((e) => e.trigger === 'trap'));
}

/** The most punishing trap the opponent's unseen cards could put in that zone. */
function scariestUnseenTrap(foe: { hand: CardInstance[]; deck: CardInstance[]; spellTrap: CardInstance | null }): string | null {
  let best: string | null = null;
  let bestWorth = 0;
  for (const c of unseenAnswers(foe)) {
    const worth = trapWorth(c.slug);
    if (worth > bestWorth) {
      bestWorth = worth;
      best = c.slug;
    }
  }
  return best;
}

/**
 * How much of a vote the paranoid world gets.
 *
 * The honest base is "what share of their unseen cards are traps", scaled up
 * because a card somebody CHOSE to set face-down is not a uniform draw, and
 * floored well above zero for the same reason: a human's Set card is an
 * answer more often than chance ever says. Capped below one so doctrine still
 * rules — fear is a tax on overcommitting, never a veto on attacking. The
 * owner's report priced the old zero-floor version exactly: "I win 100% of
 * the games", by setting a wipe and watching the whole board walk into it.
 */
export function paranoiaPrior(state: DuelState, viewer: PlayerId): number {
  const foe = state.players[other(viewer)];
  if (!foe.spellTrap || foe.spellTrap.face !== 'down') return 0;
  const pool = [...foe.hand, ...foe.deck, foe.spellTrap];
  const answers = unseenAnswers(foe).length;
  /* Zero when zero could exist. With every answer the deck runs lying visible
     in the Graveyard, the Set card is a bluff by arithmetic, not by hope —
     and fearing it anyway was the owner's Tiger Axe report: an attack the
     computer's own effect had just created, declined to honour a card that
     could not be anything. Certainty is not paranoia's business. */
  if (!answers) return 0;
  /* The floor is high because the commitment scaling protects doctrine for
     it: a lone body risked carries zero fear whatever this says, so the
     prior only prices what it should — a human who CHOSE to set a card,
     answered with a whole board. */
  return Math.max(0.4, Math.min(0.55, (2.5 * answers) / pool.length));
}

function buildWorld(state: DuelState, viewer: PlayerId, salt: number, sample: boolean, paranoid = false): DuelState {
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
  /* A plan may not act on a card it has not SEEN. The viewer's own deck is
     hidden information — that is why it is shuffled here — but an in-world
     draw effect (Sonic Maid's "draw 1") moved the world's imagined top card
     into the world's hand, and the beam built whole turns around it: Set
     the trap it never drew, kneel the monster, attack. In the real duel the
     draw yields a different card, the plan dies mid-sequence, and whatever
     was summoned stands stranded where the plan left it. Every deck card is
     marked, the mark rides the draw into the in-world hand, and candidate
     generation refuses to SPEND a marked card — it still counts for hand
     size and everything a card is worth sight unseen. The real room replans
     after every action, so a genuinely drawn card is plannable one beat
     later, from reality instead of imagination. */
  for (const d of view.players[viewer].deck) d.turnFlags = { ...d.turnFlags, worldBlind: true };

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
  if (foe.spellTrap && foe.spellTrap.face === 'down') {
    const trap = paranoid ? scariestUnseenTrap(foe) : null;
    if (trap) reidentify(foe.spellTrap, trap);
    else proxyBody(foe.spellTrap);
  }

  if (!sample) {
    /* The conditioned unknown, matching `bodyOf` exactly: a Set that visibly
       cost a Tribute stands as a big body in the anchor world too, or the
       judge and the evaluation argue about the same card. */
    const pool = unknownFor(state, other(viewer));
    for (const m of hiddenMonsters) {
      if ((m.setTributes ?? 0) > 0) proxyBody(m, pool.big.atk, pool.big.def);
      else proxyBody(m, pool.small.atk, pool.small.def);
    }
    /* Their hand too. The beam never reads a hand card's identity directly,
       but it was reading one *indirectly*: declaring an attack asks the engine
       for the defender's responses, and a hand-trap they happen to hold opens
       a window while a hand without one does not — so whether the window
       opened at all told the search what they were holding. Proxied, the
       expectation world holds a hand of unknowns that answers nothing, and
       the sampled worlds are where a plausible Kuriboh gets its say. Caught
       by ai-honesty-check, not by eye. */
    /* A hand card is tomorrow's ATTACKER, not an average Set: proxied at the
       same phantom the threat term uses, or the in-world replies collapse to
       utility-monster size and every fear-shaped margin tips over. The first
       cut of this proxied hands at the Set-mean and two pinned positions —
       Swords with the duel on the line, the outgunned board kneeling — went
       from certain to coin-flip exactly there. */
    for (const h of foe.hand) proxyBody(h, PHANTOM_SUMMON_ATK, pool.small.def);
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
  /* Conditioned on what the Set was seen to cost. An untributed Set can only
     be Level 4 or lower — the rules priced it — and one that ate a Tribute is
     Level 5 or higher, so each face-down draws from the half of the pool the
     table says it must come from, falling back only when that half is empty.
     This is what turns "a face-down that cost a Tribute" from a superstition
     into a sampled fact: the worlds deal it Summoned Skulls, and the swing
     into it is priced accordingly. */
  /* Popped from the END of each half so that with no face-downs on the table
     the arrays are untouched and `remain` reassembles in exactly the order the
     old dealer built it. That is deliberate stream-stability, not tidiness: a
     semantically identical refactor that reorders this array reshuffles every
     sampled world, and a knife-edge pinned position flipped on precisely that
     — the same plans, the same rules, a different run of luck. */
  const isSmall = (sl: string) => (CARDS[sl]?.level ?? 0) <= 4;
  const takeFrom = (want: (sl: string) => boolean): string | undefined => {
    for (let k = monsters.length - 1; k >= 0; k--) {
      if (want(monsters[k])) return monsters.splice(k, 1)[0];
    }
    return undefined;
  };
  for (const m of hiddenMonsters) {
    const tributed = (m.setTributes ?? 0) > 0;
    const pick = tributed
      ? takeFrom((sl) => !isSmall(sl)) ?? takeFrom(() => true)
      : takeFrom(isSmall) ?? takeFrom(() => true);
    reidentify(m, pick ?? rest.pop()!);
  }
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

/**
 * Test harnesses think in nodes, the serving path thinks in milliseconds too.
 *
 * The wall cap is what keeps a live room responsive on a busy server — and it
 * is also what made two pinned positions flip verdicts with MACHINE LOAD: a
 * knife-edge case lost its judge rounds to a concurrent build and answered
 * differently on the same seed. A pin that wobbles with the weather proves
 * nothing, so the batteries switch the cap off and spend the same node budget
 * every run, on every machine. Serving keeps the cap; a player waiting on a
 * hung search is worse than a slightly shallower one.
 */
let PURE_CLOCK = false;
export function setPureClock(on: boolean): void {
  PURE_CLOCK = on;
}

function clockFor(budgetMs: number): Clock {
  return {
    left: Math.max(150, Math.round(budgetMs * NODES_PER_MS)),
    wallCap: PURE_CLOCK ? Number.MAX_SAFE_INTEGER : Date.now() + Math.max(150, budgetMs * 1.6),
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

/** The weight bundle with the deck's learned style folded in. Neutral style
 *  reproduces the base weights exactly, byte for byte of behaviour. */
function styledWeights(cfg: AiConfig): EvalWeights {
  const base = cfg.weights ?? WEIGHTS;
  const a = cfg.style?.aggression ?? 0;
  const c = cfg.style?.caution ?? 0;
  if (!a && !c) return base;
  return { ...base, clock: base.clock * (1 + 0.25 * a), styleAggression: a, styleCaution: c };
}

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
  const w = styledWeights(cfg);
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
    const before = merged.size;
    const found = beamSearch(base, pid, { ...cfg, beam: width, branch: cfg.branch + round * 6 }, clock, beamFloor, w);
    for (const line of found) {
      const key = line.actions.map(actionKey).join('|');
      if (!merged.has(key)) merged.set(key, line);
    }
    if (clock.left <= beamFloor + Math.round(total * beamShare * 0.2) || Date.now() > clock.wallCap) break;
    /* A wider pass that wrote down nothing new is a position the narrow pass
       had already exhausted — a forced line, an empty board, one legal play.
       Widening again re-derives the same turns at four times the price, and
       the saved nodes flow to the judging, or simply to answering sooner.
       Only after the second pass: the first widening is the cheap one that
       most often finds the extra summon orders, and it always gets its turn. */
    if (round >= 1 && merged.size === before) break;
    width *= 2;
  }
  /* The expendable attacker leads. When their Set card is watching, the order
     of a battle phase is an information play: a single-target answer eats
     whichever body swings first, so the cheapest one tests the water and the
     army walks in behind it. The beam cannot learn this — the Set card is an
     inert stand-in in every bright world, so every ordering scores the same —
     and a policy is applied where pricing has nothing to say. Reordering the
     actions of a found line is sound without replaying it: each attack keeps
     its own attacker and target, and order only changes the outcome in the
     worlds that respond, which replay the reordered list. Strongest-first
     stays everywhere else, where kills want the best body on the biggest
     threat. */
  if (state.players[other(pid)].spellTrap?.face === 'down') {
    const attackerWorth = (uid: string): number => {
      const onField = state.players[pid].monsters.find((m) => m?.uid === uid);
      if (onField) return effAtk(state, onField, pid);
      const inHand = state.players[pid].hand.find((h) => h.uid === uid);
      return inHand ? baseAtk(inHand.slug) : 0;
    };
    const reordered = new Map<string, Line>();
    for (const line of merged.values()) {
      const actions = [...line.actions];
      for (let i = 0; i < actions.length; ) {
        if (actions[i].type !== 'attack') {
          i += 1;
          continue;
        }
        let j = i;
        while (j < actions.length && actions[j].type === 'attack') j += 1;
        const run = actions.slice(i, j) as Extract<DuelAction, { type: 'attack' }>[];
        /* Only a run of independent swings may be shuffled. A direct attack
           is order-DEPENDENT — it is legal only once the blocker ahead of it
           in the plan is dead — and the first cut of this reorder moved one
           to the front, where the engine refused it and the whole battle
           phase died on an error. Distinct monster targets are the only
           attacks whose legality survives any order. */
        const independent = run.every((a) => a.targetUid != null) && new Set(run.map((a) => a.targetUid)).size === run.length;
        if (independent) {
          run.sort((a, b) => attackerWorth(a.uid) - attackerWorth(b.uid));
          actions.splice(i, j - i, ...run);
        }
        i = j;
      }
      const key = actions.map(actionKey).join('|');
      const have = reordered.get(key);
      if (!have || line.score > have.score) reordered.set(key, { ...line, actions });
    }
    merged.clear();
    for (const [k, v] of reordered) merged.set(k, v);
  }
  const all = [...merged.values()].sort((a, b) => b.score - a.score);
  if (!all.length) return [{ type: 'endTurn' }];

  /* A gambling leader is judged against its own sober twin: the same turn
     with the coin and dice actions removed. The beam never writes the twin
     down — in the one expectation world the throw came up good, so spinning
     first is free — and with nothing to compare against, the judge could
     only rank shades of the same gamble. The audit's Time Wizard spun a
     dominant board because of exactly this. */
  if (worlds > 0 && all.length > 0 && planGambles(all[0].actions, state)) {
    const sober = all[0].actions.filter((a) => {
      if (a.type !== 'ignition' && a.type !== 'activateSpell' && a.type !== 'activateSetCard') return true;
      return !planGambles([a], state);
    });
    if (sober.length < all[0].actions.length) {
      const key = sober.map(actionKey).join('|');
      if (!merged.has(key)) {
        let cur = cloneState(base);
        let okLine = true;
        for (const a of sober) {
          const r = sim(clock, cur, pid, a);
          if (r.error) {
            okLine = false;
            break;
          }
          cur = r.state;
        }
        if (okLine) {
          const line: Line = { state: cur, actions: sober, score: evaluate(cur, pid, w), done: true };
          merged.set(key, line);
          all.push(line);
          all.sort((a, b) => b.score - a.score);
        }
      }
    }
  }

  /* When a Set card lurks, the judged pool must contain the held-back
     versions of the leading attack — or the paranoid world has nothing to
     acquit. The beam never writes them down: every top slot goes to another
     ordering of the same all-in turn, because in the expectation world the
     extra attacks are free. Synthesized here: the leader cut short after
     each attack, replayed in the same world for an honest anchor score. */
  if (worlds > 0 && all.length > 1 && paranoiaPrior(state, pid) > 0) {
    const leader = all[0];
    const attackAt = leader.actions.map((a, i) => (a.type === 'attack' ? i : -1)).filter((i) => i >= 0);
    for (let cut = 1; cut < attackAt.length; cut++) {
      const trimmed: DuelAction[] = [...leader.actions.slice(0, attackAt[cut]), { type: 'endTurn' }];
      const tkey = trimmed.map(actionKey).join('|');
      if (merged.has(tkey)) continue;
      let cur = cloneState(base);
      let okLine = true;
      for (const a of trimmed) {
        const r = sim(clock, cur, pid, a);
        if (r.error) {
          okLine = false;
          break;
        }
        cur = r.state;
      }
      if (!okLine) continue;
      merged.set(tkey, { state: cur, actions: trimmed, score: evaluate(cur, pid, w), done: true });
    }
    all.length = 0;
    all.push(...[...merged.values()].sort((a, b) => b.score - a.score));
  }

  /* The judging can move a line's score by at most one bounded vote and one
     bounded rollout blend — ROLLOUT_AUTHORITY each way, each. When the beam's
     top two UNDECIDED lines sit further apart than both bounds combined, no
     count of sampled worlds can reorder them: the verdict is proven before
     the trial, and eight seconds of reassurance is eight seconds of a human
     waiting. Decided lines are exempt — a WIN-scored gamble needs the worlds
     to price the coin. */
  const UNFLIPPABLE = 4 * ROLLOUT_AUTHORITY;
  /* No proven verdict while a Set card lurks: the bound only covers the
     bounded votes, and the paranoid world's testimony is exactly the part
     of the trial an attack-heavy leader most needs to hear. */
  const settled =
    paranoiaPrior(state, pid) === 0 &&
    all.length > 1 &&
    Math.abs(all[0].score) < WIN / 2 &&
    Math.abs(all[1].score) < WIN / 2 &&
    all[0].score - all[1].score > UNFLIPPABLE;

  if (!settled && worlds > 0 && all.length > 1) {
    const judged = judgeAcrossWorlds(state, pid, all, cfg, w, clock, worlds);
    if (judged) return pickWithSlack(judged, cfg);
  }
  if (settled) return pickWithSlack(all, cfg);

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
      line.score = blendRollout(line.score, seen, cfg.rolloutMix ?? DEFAULT_ROLLOUT_MIX, rolloutTrust(slice));
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
/**
 * BODIES risked by a plan, not actions taken. Counting a summon and an attack
 * as two commitments made the same monster pay twice: Tiger Axe summoned,
 * forcing their board to kneel, then swinging at what it beats, was billed as
 * two commits — half the nightmare — for exposing exactly one body. The owner
 * watched it decline the attack its own effect had just created. One uid, one
 * commitment, however many things it did on the way in.
 */
export function commitsOf(actions: DuelAction[]): number {
  const bodies = new Set<string>();
  for (const a of actions) {
    if (a.type === 'attack' || a.type === 'normalSummon' || a.type === 'handSummon') bodies.add(a.uid);
    else if (a.type === 'fusionSummon') bodies.add(a.extraUid);
  }
  return bodies.size;
}

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
  const imm = examine.map(() => ({ sum: 0, n: 0, vals: [] as number[] }));
  const roll = examine.map(() => ({ sum: 0, n: 0, nodes: 0, vals: [] as number[] }));
  const dark = examine.map(() => ({ sum: 0, n: 0 }));
  const prior = Math.min(0.65, paranoiaPrior(state, pid) * (1 + 0.5 * (cfg.style?.caution ?? 0)));
  /* Doctrine, exactly as pinned: a Set card must neither be read nor FEARED —
     the first attack and the first summon go in whatever is face-down, or the
     computer stops duelling. The nightmare's weight therefore scales with the
     line's COMMITMENT: nothing for the first body risked, half for the
     second, full from the third — a tax on stacking the whole board behind
     one card, never a veto on playing the game. */
  const darkWeight = examine.map((l) => prior * Math.min(1, Math.max(0, (commitsOf(l.actions) - 1) / 2)));
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
    /* A decided line is only decided if it survives the nightmare too. A
       lethal that a Set card erases is a plan, not a verdict: it is demoted
       to mortal scale and weighed like everything else, where the dark
       branch can speak. When nothing is Set (prior 0), the pure decided
       path is untouched — the Ra coin-lethal pricing depends on it. */
    /* The commitment discount prices BODIES, never the duel. "A lone body
       risked carries zero fear" is doctrine because losing one probe to one
       trap is a fair price for the game the doctrine wants played — but a
       line whose nightmare ends with the duel LOST is not risking a body,
       it is risking everything, and the discount walked a lone attacker
       into a lethal answer with Swords sitting in hand. When the paranoid
       branch reads a loss, the prior applies at full strength whatever the
       line committed. */
    const darkLoss = dark[i].n > 0 && dark[i].sum / dark[i].n <= -WIN / 2;
    const wDark = darkLoss ? prior : darkWeight[i];
    /* A gambling line whose sampled worlds do not ALL land the win is a coin,
       not a verdict — the audit caught Time Wizard betting a dominant board
       because the one expectation world happened to flip heads into the
       lethal cliff. Its anchor demotes to mortal scale and the samples price
       the coin at its real odds. */
    const gambleBroken =
      planGambles(examine[i].actions, state) &&
      ends[i].length > 0 &&
      ends[i].some((e) => e.winner !== pid);
    const brokenWin = gambleBroken || (wDark > 0 && dark[i].n > 0 && dark[i].sum / dark[i].n < WIN / 2);
    const anchor = Math.abs(beamScore) >= WIN / 2 && brokenWin ? Math.sign(beamScore) * 14_000 : beamScore;
    const immA = Math.abs(anchor) >= WIN / 2 ? immAvg : Math.min(immAvg, Math.abs(anchor) + 2_000);
    const base = Math.abs(anchor) >= WIN / 2 ? immAvg : blendRollout(anchor, immA, cfg.voteMix ?? 0.6);
    /* No reweighting of the vote: both cuts of it — damp by magnitude
       scatter, damp by straddled direction — traded one set of pinned
       positions for another, because a playout's chaos and its testimony
       arrive in the same shapes. The honest instrument against noise is
       MORE SAMPLES, not a thumb on the scale: the overtime rounds below
       feed the contested pair until the average itself settles. */
    const bright = roll[i].n
      ? blendRollout(base, roll[i].sum / roll[i].n, cfg.rolloutMix ?? DEFAULT_ROLLOUT_MIX, rolloutTrust(roll[i].nodes / roll[i].n))
      : base;
    /* The nightmare is not a vote, it is a BRANCH: with probability `prior`
       their Set card is the answer they chose it to be, and the plan lives in
       that world at full weight. A clamped vote could never overturn a line
       towering on optimism — the owner's 100% win rate was the proof — so
       the two worlds are mixed as probabilities, the way a player actually
       weighs a face-down card. */
    if (!dark[i].n || wDark <= 0) return bright;
    return (1 - wDark) * bright + wDark * (dark[i].sum / dark[i].n);
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
      const seen = evaluate(end, pid, w);
      imm[i].sum += seen;
      imm[i].n += 1;
      imm[i].vals.push(seen);
    }

    /* The paranoid vote, every round: the same plans replayed in a world
       where their Set card is the strongest trap their unseen cards could
       be, folded in at the honest prior. This is what stops the computer
       committing three attackers through one card back — the wipe it risks
       is finally on the bill — while a lone profitable attack keeps its
       margin and goes in, which is what the doctrine checks demand. It was
       shipped once, removed on mirror-match evidence, and the owner priced
       that removal precisely: "I win 100% of the games."  Mirrors cannot
       see this term because both seats share the blindness; a human never
       shares it. */
    if (!drained(clock) && prior > 0) {
      const nightmare = buildWorld(state, pid, 990 + round, true, true);
      for (let i = 0; i < M; i++) {
        if (drained(clock)) break;
        const end = playOutPlan(clock, nightmare, pid, examine[i].actions, w);
        /* The nightmare deserves the same look-ahead the bright world gets,
           UNCLAMPED: a wiped board reads as a mild setback the moment the
           turn ends, and as the near-loss it actually is one reply later,
           when their counterattack stands over it and the evaluation's own
           cliffs finally see it. Clamped, that testimony could never outbid
           a tower of optimism — which is how the all-in kept winning the
           argument and losing the duel. */
        let seen = evaluate(end, pid, w);
        if (!end.winner && clock.left > ROLLOUT_FLOOR) {
          seen = (seen + rollout(clock, ROLLOUT_FLOOR, end, pid, 1, w, true)) / 2;
        }
        dark[i].sum += seen;
        dark[i].n += 1;
      }
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
      /* One slice, cut before the loop: computing it per line let every
         rollout shrink the next line's budget, so the current leader was
         always judged by a fatter, steadier playout than its rivals — a
         thumb on the scale that grew as the clock drained, and pure noise
         on a knife-edge decision. Same worlds, same food.

         And the food goes where the decision is. A single playout carries a
         bounded vote of up to ±ROLLOUT_AUTHORITY — thousands — while the
         real margins between good lines are routinely a few hundred, so on
         a close call one noisy future decided the turn: probes with a clear
         priced edge were being coin-flipped away, and the measured cost was
         real win rate. When the top two sit inside one authority of each
         other, the round's rollouts go to THEM, twice each, and the
         also-rans wait: variance falls exactly where the verdict lives. */
      const knifeEdge = order.length > 1 && Math.abs(score(order[0]) - score(order[1])) < ROLLOUT_AUTHORITY;
      /* Every contender keeps its rollout — a line judged with horizon beside
         a line judged without one is not a comparison, and the first cut of
         this starved third place of playouts entirely and lost a pinned
         position to exactly that. The knife-edge pair gets SECONDS, not the
         whole table. */
      const targets = [...order.slice(0, 5), ...(knifeEdge ? [order[0], order[1]] : [])];
      const slice = Math.max(ROLLOUT_FLOOR, Math.round(clock.left / targets.length));
      for (const i of targets) {
        if (clock.left <= ROLLOUT_FLOOR) break;
        const end = ends[i][ends[i].length - 1];
        if (!end) continue;
        const seenRoll = end.winner
          ? evaluate(end, pid, w)
          : rollout(clock, slice, end, pid, Math.min(2, cfg.depth), w, true);
        roll[i].sum += seenRoll;
        roll[i].n += 1;
        roll[i].vals.push(seenRoll);
        /* A line whose playouts were all run at the floor has seen less than
           one that was fed, and says less. Averaged rather than summed: what
           earns authority is how well EACH playout was run. */
        roll[i].nodes += end.winner ? ROLLOUT_TRUSTED : slice;
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
    /* Two quiet rounds is a verdict; ONE quiet round already is when the
       margin exceeds a full adverse swing of the bounded vote — the next
       round mathematically cannot close a gap that size. */
    if (round + 1 >= worlds && (leaderStable >= 2 || (leaderStable >= 1 && margin > 2 * ROLLOUT_AUTHORITY))) break;
    /* A checked win does not need eight seconds of reassurance. When the
       leader is a DECIDED line whose every sampled future so far ended in the
       win — the beam says lethal, and no redealt hand or re-thrown coin has
       contradicted it — further rounds can only re-confirm. Gambling plans
       wait one extra round so the rethrown dice get their say; everything
       else plays the kill now. */
    const lead = ranked[0];
    if (
      round + 1 >= (planGambles(examine[lead].actions, state) ? 2 : 1) &&
      score(lead) >= WIN / 2 &&
      ends[lead].length > 0 &&
      ends[lead].every((e) => e.winner === pid)
    ) {
      break;
    }
  }

  /* Overtime for a hung jury. When the scheduled rounds end with the top two
     inside one authority of each other, the verdict is standing on one or
     two playouts' worth of luck — and the measured failure mode was exactly
     that: a free token kill, a flip engine's Set, a wall in front of lethal,
     each flipped in one deck order by one ugly die. Chaos averages toward
     zero and testimony persists, so the honest fix is more throws, only
     where the decision lives, only while the clock allows: fresh worlds,
     both leaders replayed and rolled out, until they separate or the
     overtime is spent. */
  for (let extra = 0; extra < 3; extra++) {
    if (drained(clock) || clock.left <= 2 * ROLLOUT_FLOOR) break;
    const ranked = examine.map((_, i) => i).sort((a, b) => score(b) - score(a));
    if (ranked.length < 2) break;
    const [a, b] = [ranked[0], ranked[1]];
    if (Math.abs(score(a)) >= WIN / 2 || Math.abs(score(b)) >= WIN / 2) break;
    if (Math.abs(score(a) - score(b)) >= ROLLOUT_AUTHORITY) break;
    const world = buildWorld(state, pid, 500 + salt, true);
    salt += 1;
    const slice = Math.max(ROLLOUT_FLOOR, Math.round(clock.left / 6));
    for (const i of [a, b]) {
      if (drained(clock)) break;
      const end = playOutPlan(clock, world, pid, examine[i].actions, w);
      ends[i].push(end);
      const seen = evaluate(end, pid, w);
      imm[i].sum += seen;
      imm[i].n += 1;
      imm[i].vals.push(seen);
      const seenRoll = end.winner ? evaluate(end, pid, w) : rollout(clock, slice, end, pid, Math.min(2, cfg.depth), w, true);
      roll[i].sum += seenRoll;
      roll[i].n += 1;
      roll[i].vals.push(seenRoll);
      roll[i].nodes += end.winner ? ROLLOUT_TRUSTED : slice;
    }
  }

  if (process.env.DEBUG_AI === '1') {
    for (let i = 0; i < M; i++) {
      const atk = examine[i].actions.filter((a) => a.type === 'attack').length;
      const pos = examine[i].actions.filter((a) => a.type === 'changePosition').length;
      console.log(
        `    [judge] line ${i}: attacks=${atk} defswitch=${pos} beam=${Math.round(examine[i].score)} imm=${imm[i].n ? Math.round(imm[i].sum / imm[i].n) : '-'}(n${imm[i].n},r${roll[i].n}) dark=${dark[i].n ? Math.round(dark[i].sum / dark[i].n) : '-'} final=${Math.round(score(i))}`
      );
    }
    console.log(`    [judge] prior=${prior.toFixed(2)}`);
  }
  const out: Line[] = examine.map((line, i) => ({ ...line, score: score(i) }));
  out.sort((a, b) => b.score - a.score);
  /* A certain win outranks a coin-flip win whatever the sampled throws said:
     with few samples a fair coin can land heads every time, and the audit
     caught Time Wizard spinning a dominant board it could simply have swung.
     If the leader gambles and a non-gambling line is also decided, the sure
     thing leads. */
  if (out.length > 1 && out[0].score >= WIN / 2 && planGambles(out[0].actions, state)) {
    const sure = out.findIndex((l) => l.score >= WIN / 2 && !planGambles(l.actions, state));
    if (sure > 0) out.unshift(out.splice(sure, 1)[0]);
  }
  /* Near-ties are settled by the board, not by the noise. Two lines within a
     few hundred points are inside the sampling's own error bar, and which one
     the votes favoured is weather; what is NOT weather is Life Points kept
     and bodies left standing in the line of fire. Ordered: keep more Life
     Points first, then fewer outgunned bodies in Attack Position.
     "Kept" means after the blow already queued up on the other side of the
     table, not as they stand when we hand the turn over. Mystical Elf heals
     800 as it arrives face-up and is then run over by a piercing 2500 for
     1700; Set, it heals nothing and costs 500. Reading the number before the
     swing, the tie-break took the heal and was 400 Life Points worse for it —
     and the search stood an 800 ATK body in front of lethal to get it. */
  const lpAfterBlow = (s: DuelState): number => {
    const mineP = s.players[pid];
    const foeP = s.players[other(pid)];
    let best = 0;
    let pierces = false;
    for (const fm of foeP.monsters) {
      if (!fm || fm.face !== 'up' || fm.position !== 'atk') continue;
      const fb = bodyOf(s, fm, other(pid), pid);
      if (fb.atk > best) {
        best = fb.atk;
        pierces = fb.pierce;
      }
    }
    if (!best) return mineP.lp;
    const bodies = mineP.monsters.filter((m): m is CardInstance => !!m);
    if (!bodies.length) return mineP.lp - best; // nothing in the way at all
    /* They pick the target, so price the worst one they could pick. */
    let worst = 0;
    for (const m of bodies) {
      const b = bodyOf(s, m, pid, pid);
      const taken = b.atkPos ? Math.max(0, best - b.atk) : pierces ? Math.max(0, best - b.def) : 0;
      worst = Math.max(worst, taken);
    }
    return mineP.lp - worst;
  };
  const exposure = (s: DuelState): number => {
    const mine = s.players[pid];
    const foeP = s.players[other(pid)];
    let bestFoe = 0;
    for (const fm of foeP.monsters) {
      if (fm && fm.face === 'up' && fm.position === 'atk') bestFoe = Math.max(bestFoe, effAtk(s, fm, other(pid)));
    }
    if (!bestFoe) return 0;
    return mine.monsters.filter((m) => m && m.face === 'up' && m.position === 'atk' && effAtk(s, m, pid) < bestFoe).length;
  };
  /* The band is the sampling's real error bar — a few hundred points, as the
     note above says — not a policy lever. At 3000 it silently outranked the
     judge across differences the judge was RIGHT about, and it measured only
     Life Points KEPT: dealing 800 with a free attack counted for nothing,
     kneeling to save a hypothetical 400 counted for everything, and the
     owner watched Lady of Faith turn away from a Leghul she beat dry. Both
     halves fixed: the band holds only true near-ties, and the metric is the
     LP DIFFERENTIAL after the queued blow — damage dealt is worth exactly
     what damage kept is worth, which is what Life Points mean. */
  if (out.length > 1 && out[0].score - out[1].score < 700 && Math.abs(out[0].score) < WIN / 2) {
    const band = out.filter((l) => out[0].score - l.score < 700 && Math.abs(l.score) < WIN / 2);
    const lpDiff = (s: DuelState): number => lpAfterBlow(s) - s.players[other(pid)].lp;
    band.sort((a, b) => lpDiff(b.state) - lpDiff(a.state) || exposure(a.state) - exposure(b.state));
    if (band[0] !== out[0]) {
      out.splice(out.indexOf(band[0]), 1);
      out.unshift(band[0]);
    }
  }

  /* A rollout may reorder judgment calls, never coherence. The narrow claim,
     learned the hard way: between a line and THE SAME LINE plus trailing
     attacks, the two futures are identical except for consequences the
     immediate eval already priced in full — so with nothing Set (no paranoid
     branch to hear) and no coin in any plan, a playout that ranks the
     extension BELOW its own prefix is incoherent, and the measured cost of
     honouring it was a free +110 token kill outvoted by 2785 points of
     playout chaos. The claim is deliberately no wider: between genuinely
     different plans — a wall against a healer, a Set against a summon — the
     playout's horizon testimony is exactly what the judge exists to hear,
     and the first cut of this lift silenced it and walked a healer into a
     piercing 2500. Extension pairs only; nothing decided, feared, or
     gambled. */
  if (paranoiaPrior(state, pid) === 0 && !gambling) {
    /* Keyed by the actions array: `out` holds spread copies of the lines,
       and the actions reference is the one thing a spread carries through. */
    const idx = new Map(examine.map((l, i) => [l.actions, i] as const));
    const coreOf = (as: DuelAction[]) => as.filter((a) => a.type !== 'toPhase' && a.type !== 'endTurn');
    const extendsWithAttacks = (long: DuelAction[], short: DuelAction[]): boolean => {
      const L = coreOf(long);
      const S = coreOf(short);
      if (L.length <= S.length) return false;
      for (let k = 0; k < S.length; k++) if (actionKey(L[k]) !== actionKey(S[k])) return false;
      return L.slice(S.length).every((a) => a.type === 'attack');
    };
    const dominates = (a: Line, b: Line): boolean => {
      const i = idx.get(a.actions);
      const j = idx.get(b.actions);
      if (i === undefined || j === undefined) return false;
      if (Math.abs(a.score) >= WIN / 2 || Math.abs(b.score) >= WIN / 2) return false;
      if (examine[i].score <= examine[j].score) return false;
      if (!extendsWithAttacks(a.actions, b.actions)) return false;
      const n = Math.min(imm[i].vals.length, imm[j].vals.length);
      if (n < 1) return false;
      for (let k = 0; k < n; k++) if (imm[i].vals[k] <= imm[j].vals[k]) return false;
      return true;
    };
    for (let pos = 1; pos < out.length; pos++) {
      for (let above = 0; above < pos; above++) {
        if (dominates(out[pos], out[above])) {
          const [lifted] = out.splice(pos, 1);
          lifted.score = Math.max(lifted.score, out[above].score + 1);
          out.splice(above, 0, lifted);
          break;
        }
      }
    }
  }

  /* And below the certain-win line: a winning board is never gambled. The
     evaluation's cliff terms price a heads outcome far above what the tails
     side really costs, so a comfortable position kept reading spin-first as
     profit. If the best sober line is already clearly winning, the coin only
     has downside that matters — take the sure road and keep the dice for the
     days the board is losing, which is what they are for. */
  if (out.length > 1 && out[0].score < WIN / 2 && planGambles(out[0].actions, state)) {
    const sober = out.find((l) => !planGambles(l.actions, state));
    if (sober && sober.score >= 8000) {
      out.splice(out.indexOf(sober), 1);
      out.unshift(sober);
    }
  }
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
function blendRollout(immediate: number, seen: number, mix: number, confidence = 1): number {
  const k = Math.max(0, Math.min(1, mix));
  const cap = ROLLOUT_AUTHORITY * Math.max(0, Math.min(1, confidence));
  const shift = (seen - immediate) * k;
  return immediate + Math.max(-cap, Math.min(cap, shift));
}

/**
 * The node count at which a playout has earned its full say.
 *
 * `rollout` already knows this number: below it the opponent's reply model is
 * the narrow one, above it the model plays their turn nearly as well as they
 * would. A playout that thin was still allowed to move a line by the whole
 * ±3600 — and it did. Axe Raider 1700 with a clear swing at a Feral Imp 1300
 * and an empty backrow: the board rated the attack 1267 points above passing,
 * a 550-node playout — the floor this file itself calls noise — disagreed, and
 * the AI ended its turn. It attacked again at a smaller budget and at a larger
 * one, which is the tell: more thinking must never buy a worse move.
 *
 * So authority is earned rather than granted. A starved playout nudges; a fed
 * one can still overturn anything the evaluation has not already decided.
 */
const ROLLOUT_TRUSTED = 2000;
const rolloutTrust = (nodes: number) => Math.max(0, Math.min(1, nodes / ROLLOUT_TRUSTED));

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
  /* The worldBlind mark binds the PLAN — the turn being decided may not
     spend a card it has not seen. A rollout is the opposite instrument: it
     plays plausible FUTURES, and a future that draws a card gets to play
     it, the way the real room will after a real draw. Left in place, the
     marks rode the flipped Jar's five drawn cards into every modelled
     turn as permanently dead weight, and the judge learned that draw
     engines were garbage — two Set-the-flip pins fell in one battery. */
  for (const pid of ['p1', 'p2'] as PlayerId[]) {
    for (const zone of [cur.players[pid].hand, cur.players[pid].deck]) {
      for (const c of zone) if (c.turnFlags.worldBlind) delete c.turnFlags.worldBlind;
    }
  }
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
  const w = styledWeights(cfg);
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
  const w = styledWeights(cfg);
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
