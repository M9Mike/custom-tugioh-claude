/**
 * The computer opponent.
 *
 * Not a scripted bot: it searches. A turn in this game is a *sequence* of
 * decisions (summon, activate, attack, end), so the AI runs a beam search over
 * whole-turn sequences, scores the resulting board with a hand-written
 * evaluation, and plays the best line it found. Trap responses are decided by
 * simulating both branches and comparing.
 *
 * It cannot see hidden information: it plans from the same view a player would
 * have, so it never cheats by reading your hand.
 */
import { CARDS } from './cards';
import {
  applyAction,
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
  other,
  summonBlocked,
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
   * back"; 2 also asks "and what do we do about that". Each extra turn is
   * another pair of narrow searches per candidate line, which is affordable
   * because a turn search costs well under a tenth of the time budget.
   */
  depth: number;
  /**
   * How much of a line's final score comes from the lookahead rather than from
   * the board we can actually read. 0 ignores the playout entirely, 1 lets it
   * replace the immediate evaluation outright.
   *
   * It used to replace it, and that was wrong: a playout is one sample of a
   * future the AI cannot see, played by a deliberately cheap model, so it is a
   * hint about where a line leads and not a verdict on it. See `blendRollout`.
   * Defaults to 0.5.
   */
  rolloutMix?: number;
  /**
   * How many sampled futures each candidate line is played out against, with
   * the results averaged. One playout is one shuffle of the unseen decks — a
   * single sample can land on a lucky draw order and mis-rank a line for a
   * reason that exists in no other future. Averaging over several is the
   * honest version of the strength the old clairvoyant lookahead had: less
   * variance, no peeking. Defaults to 1; each extra sample splits the line's
   * playout budget, so it only pays where the budget can feed it.
   */
  rolloutSamples?: number;
  /** Evaluation weights; defaults to the tuned set. */
  weights?: EvalWeights;
}

export const AI_LEVELS: Record<AiLevel, AiConfig> = {
  rookie: { beam: 1, branch: 6, slack: 0.55, depth: 0 },
  duelist: { beam: 4, branch: 14, slack: 0.12, depth: 1 },
  champion: { beam: 10, branch: 26, slack: 0, depth: 3, rolloutSamples: 2 },
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
  return {
    atk,
    def,
    wall: m.face === 'up' && m.position === 'atk' ? atk : def,
    atkPos: m.face === 'up' && m.position === 'atk',
    attacks: hidden ? 1 : maxAttacks(state, m, ctrl),
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
  // No guards on atk or attacks are needed: `effAtk` clamps to zero so ATK is
  // never negative, and `maxAttacks` never returns less than one. A 0 ATK
  // monster falls out on its own — it beats nothing, so it never swings.
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
  //
  // Every attacker counts, including the ones that just killed a blocker: they
  // survived that fight — they only swung at something they beat — and next
  // turn they swing again into a board with that blocker gone. Netting off the
  // ATK "spent" blocking would be double-counting the same removal twice, and
  // would understate how fast the board actually closes out.
  const freeAtk = attackers.reduce((sum, a) => sum + a.atk * a.attacks, 0);
  return { damage, freeAtk };
}

/**
 * How many turns `att` needs to finish `def` off from the current board.
 *
 * This is the number that actually decides duels here: 4000 Life Points and
 * 3000 ATK bodies mean a game is over in two or three connected attacks, so a
 * player who is one turn faster wins almost regardless of card count. Scoring
 * the race directly is far more informative than adding up ATK.
 */
function clock(state: DuelState, att: PlayerId, def: PlayerId, viewer: PlayerId): number {
  const lp = state.players[def].lp;
  const attackers = bodiesOf(state, att, viewer).filter((b) => b.atkPos);
  if (!attackers.length) return 99;
  const blockers = bodiesOf(state, def, viewer);
  const { damage, freeAtk } = battleOutcome(attackers, blockers);
  if (damage >= lp) return 1;
  if (freeAtk <= 0) return 99;
  // After this turn's battle the board is assumed cleared enough that the
  // survivors connect. Optimistic, but symmetric for both sides.
  return 1 + Math.ceil((lp - damage) / freeAtk);
}

/**
 * Damage `defender` would take from a full battle phase right now, judged from
 * `viewer`'s information. The viewer is explicit because the same board is
 * scored twice — once for the threat against us, once for our own lethal — and
 * both readings must use what the AI can actually see.
 */
function threatAgainst(state: DuelState, defender: PlayerId, viewer: PlayerId): number {
  const attackers = bodiesOf(state, other(defender), viewer).filter((b) => b.atkPos);
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
  // worth is already priced into the race term below. Counting ATK at close to
  // face value on top of that double-counts it and makes the AI hoard bodies
  // instead of converting them into damage.
  for (const m of my.monsters) {
    if (!m) continue;
    const b = bodyOf(state, m, me, me);
    score += b.atkPos ? b.atk * w.atkPosAtk + b.def * w.atkPosDef : b.def * w.defPosDef + b.atk * w.defPosAtk;
    if (m.face === 'down') score += 120; // unknown to the opponent
    if (b.pierce) score += 120;
    if (b.direct) score += 260;
    if (b.wallProof) score += 220;
    if (b.attacks > 1) score += 200 * (b.attacks - 1);
  }
  for (const m of their.monsters) {
    if (!m) continue;
    const b = bodyOf(state, m, foe, me);
    score -= b.atkPos ? b.atk * w.atkPosAtk + b.def * w.atkPosDef : b.def * w.defPosDef + b.atk * w.defPosAtk;
    if (m.face === 'down') score -= 120;
  }

  // Card advantage. A card in hand is a future threat; a set Spell/Trap is a
  // live one.
  score += (my.hand.length - their.hand.length) * w.hand;
  if (my.spellTrap) score += my.spellTrap.face === 'down' ? 260 : 180;
  if (their.spellTrap) score -= their.spellTrap.face === 'down' ? 300 : 180;
  if (my.field) score += 120;
  if (their.field) score -= 120;

  // Running out of deck loses the duel.
  if (my.deck.length < 6) score -= (6 - my.deck.length) * 380;
  if (their.deck.length < 6) score += (6 - their.deck.length) * 380;

  // Exodia: holding pieces is real progress towards an instant win.
  const pieces = my.hand.filter((c) => EXODIA.has(c.slug)).length;
  if (pieces) score += pieces * pieces * 260;

  // The race. Whoever needs fewer turns to finish the other off is winning,
  // and by roughly how much is the single most informative thing on the board.
  // Half a turn of credit goes to whoever is holding the initiative.
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
function targetsFor(state: DuelState, pid: PlayerId, slug: string, trigger: 'activate' | 'ignition' | 'trap' | 'onSummon'): string[][] {
  const spec = trigger === 'onSummon' ? summonTargetSpec(slug) : targetSpecFor(slug, trigger);
  if (!spec) return [[]];
  const foe = other(pid);
  const sides: PlayerId[] = spec.side === 'own' ? [pid] : spec.side === 'opp' ? [foe] : [pid, foe];
  const pool: CardInstance[] = [];
  for (const id of sides) {
    const p = state.players[id];
    if (spec.zone === 'monster') pool.push(...p.monsters.filter((m): m is CardInstance => !!m));
    else if (spec.zone === 'spellTrap') {
      if (p.spellTrap) pool.push(p.spellTrap);
      if (p.field) pool.push(p.field);
    } else if (spec.zone === 'grave') {
      pool.push(...p.grave.filter((c) => CARDS[c.slug]?.kind === 'monster'));
    } else if (spec.zone === 'hand' && id === pid) pool.push(...p.hand);
  }
  if (!pool.length) return [[]];

  // Strongest first: for removal that is the opponent's best body, for equips
  // and revival it is the best body to invest in.
  const ranked = [...pool].sort((a, b) => (CARDS[b.slug]?.atk ?? 0) - (CARDS[a.slug]?.atk ?? 0));
  const out: string[][] = [];
  // Offer up to three alternative target *sets*, each a full `spec.count` of
  // them, sliding down the ranked list. The last valid starting point is
  // `length - count`, so stopping at `length` would hand back short sets for
  // any effect that needs more than one target — actions the engine then
  // rejects, burning search budget on candidates that could never be played.
  // With the usual count of 1 this is unchanged.
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
        // The same gate the player's own summon goes through: no Rituals, no
        // Fusions, and no Toon without its Toon World.
        .filter((h) => !summonBlocked(state, pid, h.slug))
        // Holding the Forbidden One is worth more than summoning it.
        .filter((h) => !EXODIA.has(h.slug))
        .sort((a, b) => (CARDS[b.slug].atk ?? 0) - (CARDS[a.slug].atk ?? 0));

      for (const h of summonable) {
        const need = tributesRequired(h.slug, state, pid);
        const fodder = ownMonsters.filter((m) => !m.isToken).sort(byAtkDesc(state, pid)).reverse();
        if (need === 0 && freeZone >= 0) {
          for (const t of targetsFor(state, pid, h.slug, 'onSummon')) {
            acts.push({ type: 'normalSummon', uid: h.uid, zone: freeZone, position: 'atk', face: 'up', targets: t });
          }
          acts.push({ type: 'normalSummon', uid: h.uid, zone: freeZone, position: 'def', face: 'down' });
        } else if (need > 0 && fodder.length >= need) {
          // Tribute the weakest bodies.
          const tributes = fodder.slice(0, need).map((m) => m.uid);
          const zone = freeZone >= 0 ? freeZone : p.monsters.findIndex((m) => m && tributes.includes(m.uid));
          if (zone >= 0) {
            for (const t of targetsFor(state, pid, h.slug, 'onSummon')) {
              acts.push({ type: 'normalSummon', uid: h.uid, zone, position: 'atk', face: 'up', tributes, targets: t });
            }
          }
        }
      }
    }

    for (const h of p.hand) {
      if (canActivateFromHand(state, pid, h)) {
        for (const t of targetsFor(state, pid, h.slug, 'activate')) {
          acts.push({ type: 'activateSpell', uid: h.uid, targets: t });
        }
      }
    }
    for (const m of ownMonsters) {
      if (canIgnite(state, pid, m)) {
        for (const t of targetsFor(state, pid, m.slug, 'ignition')) {
          acts.push({ type: 'ignition', uid: m.uid, targets: t });
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
/* Search                                                              */
/* ------------------------------------------------------------------ */

interface Line {
  state: DuelState;
  actions: DuelAction[];
  score: number;
  done: boolean;
}

/**
 * Beam search over the whole turn. Each step expands the surviving lines by
 * every candidate action, keeps the best `beam` of them, and stops when a line
 * ends the turn.
 */
export function planTurn(state: DuelState, pid: PlayerId, level: AiSetting = 'champion', budgetMs = 2500): DuelAction[] {
  return planWith(state, pid, cfgOf(level), budgetMs);
}

/** Either a named level or a raw config, so variants can be benchmarked. */
export type AiSetting = AiLevel | AiConfig;
const cfgOf = (s: AiSetting): AiConfig => (typeof s === 'string' ? AI_LEVELS[s] : s);

/** Cheap, deterministic settings used to model a reply turn or a trap window. */
const MODEL_CFG: AiConfig = { beam: 2, branch: 10, slack: 0, depth: 0 };

/**
 * Plays out every response window a position is holding open, so a line is
 * judged on what happened rather than on what was merely declared.
 *
 * Declaring an attack opens a window, and the search used to stop the line
 * there and score the board with the attack still hanging in the air — the
 * blow neither landed nor answered. Against a face-up Mirror Wall that reads as
 * a clean kill, when what really follows is the attack negated, the attacker
 * permanently halved and 300 Life Points to the other side. It is why the AI
 * kept swinging into walls it had every reason to respect, and why it could
 * never plan a second attack in a turn where the first drew a response.
 *
 * `viewer` is the seat doing the planning, and it is the whole difference
 * between reading the board and reading the cards. The AI may model a response
 * only with what it could legitimately see: everything in its own seat, and
 * only *face-up* cards in the other. Without that filter this would settle a
 * face-down Set trap by its real text — the AI would sidestep a card it has
 * never been shown, which is both cheating and, from the other side of the
 * table, unmistakable.
 *
 * Which leaves the question of what to assume when it *cannot* see. "They
 * decline" is the obvious answer and it is a bad one — see `canSeeResponse`,
 * which is why the turn search does not call this unless it can see.
 */
function settleWindows(state: DuelState, viewer: PlayerId, w: EvalWeights): DuelState {
  if (!state.pending) return state;
  const model: AiConfig = { ...MODEL_CFG, weights: w };
  let cur = state;
  for (let guard = 0; guard < 4 && cur.pending && !cur.winner; guard++) {
    const responder = cur.pending.player;
    const res = applyAction(cur, responder, chooseVisibleResponse(cur, responder, viewer, model));
    if (res.error) break;
    cur = res.state;
  }
  return cur;
}

/**
 * True when `viewer` can actually see what would answer this window.
 *
 * Measured, and the measurement was the surprise of this whole change: settling
 * a window the AI cannot see into costs about six points of win rate over 800
 * games. The reason is that there is no honest way to settle it. Not seeing the
 * card, the only thing to assume is that the opponent declines — so the attack
 * is scored as landing cleanly, and the AI walks into every Set trap on the
 * table. Leaving the line where it was is *also* wrong, in the other direction:
 * the blow is scored neither landed nor answered, which reads as nothing having
 * happened. But that pessimism turns out to be much the better error, and it is
 * what the AI did before any of this.
 *
 * So the turn search settles the windows it can read and leaves the rest
 * exactly as they were. Face-up Mirror Wall: respected, which is the whole
 * point. Face-down anything: unchanged, and no worse than it ever was.
 *
 * The playout is the exception — it has to resolve a window to keep playing —
 * and it can afford to, being a guess about several turns' time either way.
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
function chooseVisibleResponse(state: DuelState, responder: PlayerId, viewer: PlayerId, cfg: AiConfig): DuelAction {
  if (responder === viewer) return chooseTrapResponse(state, responder, cfg);
  const p = state.players[responder];
  const seen = (state.pending?.options ?? []).filter((uid) => p.spellTrap?.uid === uid && p.spellTrap.face === 'up');
  if (!seen.length) return { type: 'respondTrap', uid: null };
  // Decide on a view holding only what is showing, then play that decision
  // against the real position — the chosen card is face-up either way.
  const view: DuelState = { ...state, pending: { ...state.pending!, options: seen } };
  return chooseTrapResponse(view, responder, cfg);
}

function planWith(state: DuelState, pid: PlayerId, cfg: AiConfig, budgetMs: number): DuelAction[] {
  // `budgetMs` is a hard bound on the whole call, because a human is waiting on
  // the other end of a request. The second ply gets its own slice reserved up
  // front — otherwise a wide beam search would spend the lot and leave nothing
  // for the lookahead, or the lookahead would run past the budget entirely.
  const started = Date.now();
  const hardDeadline = started + budgetMs;
  const deadline = cfg.depth > 0 ? started + budgetMs * 0.35 : hardDeadline;
  const w = cfg.weights ?? WEIGHTS;
  let lines: Line[] = [{ state, actions: [], score: evaluate(state, pid, w), done: false }];
  const finished: Line[] = [];

  for (let step = 0; step < 24; step++) {
    if (Date.now() > deadline) break;
    const next: Line[] = [];
    for (const line of lines) {
      if (line.done) {
        finished.push(line);
        continue;
      }
      for (const action of candidates(line.state, pid, cfg.branch)) {
        if (Date.now() > deadline) break;
        const res = applyAction(line.state, pid, action);
        if (res.error) continue;
        const after = canSeeResponse(res.state, pid) ? settleWindows(res.state, pid, w) : res.state;
        const ends = action.type === 'endTurn' || after.active !== pid || !!after.winner;
        next.push({
          state: after,
          actions: [...line.actions, action],
          score: evaluate(after, pid, w),
          done: ends || !!after.pending,
        });
      }
    }
    if (!next.length) break;
    // Finished and unfinished lines are not comparable — a half-played turn is
    // scored mid-air, while a finished one already includes the consequences of
    // passing. Keeping them in one pool let "end turn" crowd the beam out and
    // the search never explored attacking. Prune only among continuations.
    const stillGoing = next.filter((l) => !l.done).sort((a, b) => b.score - a.score);
    finished.push(...next.filter((l) => l.done));
    if (finished.length > 120) {
      finished.sort((a, b) => b.score - a.score);
      finished.length = 120;
    }
    lines = stillGoing.slice(0, Math.max(1, cfg.beam));
    if (!lines.length) break;
  }

  // Close out anything the search left half-played, so the pool it picks from
  // is all complete turns. Pruning already keeps the two kinds apart — a
  // mid-turn board has not paid for handing the turn over, so it flatters
  // itself against a finished one — but the final comparison put them straight
  // back in together, and the winner could be a plan that simply stops.
  //
  // Measured, not assumed: over eight full duels it never actually happened,
  // because the step loop finishes every line long before it runs out of steps.
  // So this closes a hole rather than fixing a symptom — worth doing because
  // the alternative is a rule the code states in one place and breaks two
  // dozen lines later, but it is not what made the AI misplay.
  for (const line of lines) {
    const res = applyAction(line.state, pid, { type: 'endTurn' });
    // A line cut short by an open response window cannot be closed from here.
    // It is judged as it stands, which is the best that can be said for it.
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
  if (!all.length) return [{ type: 'endTurn' }];

  for (const line of all) line.score = evaluate(line.state, pid, w);
  all.sort((a, b) => b.score - a.score);

  // Deeper plies: for the most promising lines, actually play the turns that
  // follow and re-score where they lead. Judging a line by the board the
  // instant our turn ends badly overrates anything that hands the opponent a
  // winning swing, and underrates a line that looks quiet but leaves them
  // without an answer.
  if (cfg.depth > 0) {
    const examine = all.slice(0, cfg.beam >= 8 ? 12 : 6);
    // Only lines that were actually played out get re-ranked. One that ran out
    // of budget keeps the score we can defend — the board as it stands — and
    // sits behind the ones we looked at properly, which costs nothing because
    // `examine` is already in immediate-score order.
    const judged: Line[] = [];
    const starved: Line[] = [];
    for (let i = 0; i < examine.length; i++) {
      const line = examine[i];
      // A line that already ended the duel is settled, not speculative: there
      // is nothing to play out and its score is exact, so it ranks on merit.
      if (line.state.winner) {
        judged.push(line);
        continue;
      }
      const left = hardDeadline - Date.now();
      if (left <= 0) {
        starved.push(line);
        continue;
      }
      /* Several futures, averaged, rather than one believed. Each sample gets
         an equal split of this line's slice; a sample the deadline cannot feed
         is simply not taken, so a tight budget degrades to fewer samples
         rather than to shallower ones. */
      const samples = Math.max(1, cfg.rolloutSamples ?? 1);
      const slice = left / (examine.length - i);
      let sum = 0;
      let taken = 0;
      for (let k = 0; k < samples; k++) {
        const remaining = hardDeadline - Date.now();
        if (remaining <= 0) break;
        sum += rollout(line.state, pid, cfg.depth, Math.min(slice / samples, remaining), w, k);
        taken += 1;
      }
      if (!taken) {
        starved.push(line);
        continue;
      }
      line.score = blendRollout(line.score, sum / taken, cfg.rolloutMix ?? DEFAULT_ROLLOUT_MIX);
      judged.push(line);
    }
    judged.sort((a, b) => b.score - a.score);
    const rest = all.slice(examine.length);
    all.length = 0;
    all.push(...judged, ...starved, ...rest);
  }

  // Slack lets the easier levels pick a line that is merely good.
  const index = cfg.slack > 0 ? Math.min(all.length - 1, Math.floor(Math.random() * cfg.slack * all.length)) : 0;
  return all[index].actions;
}

/** How much of a line's score the playout is allowed to be, by default. */
const DEFAULT_ROLLOUT_MIX = 0.5;

/**
 * The most a playout may move a line's score, either way.
 *
 * Roughly the full range of the evaluation's own race term — ±4 turns at 900 a
 * turn — and that is the right size, because a playout is a second opinion
 * about how the race goes and not about the arithmetic on the table. `evaluate`
 * returns ±1e9 for a decided duel, and a duel decided three modelled turns away
 * over a shuffled deck is not decided at all; unbounded, one such guess
 * outranked every real reading of the board.
 */
const ROLLOUT_AUTHORITY = 3600;

/**
 * Mixes what the board says now with what the playout thinks happens next.
 *
 * It used to be a straight replacement, and that lost real duels: with a 2200
 * body in hand and a 2500 attacker across the table, the board said summon by
 * nearly 6000 points — the blocker is worth that much — and the playout
 * overruled it with "pass, and you win in two turns". Now the playout can
 * re-rank lines the evaluation rates closely, which is its job, and cannot
 * overturn a reading this decisive, which never was.
 */
function blendRollout(immediate: number, seen: number, mix: number): number {
  const k = Math.max(0, Math.min(1, mix));
  const shift = (seen - immediate) * k;
  return immediate + Math.max(-ROLLOUT_AUTHORITY, Math.min(ROLLOUT_AUTHORITY, shift));
}

/**
 * Reshuffles everything the AI is not entitled to know, before a playout reads
 * the future by living it.
 *
 * `rollout` plays real turns through the real `applyAction`, which draws the
 * real next card — so an untouched playout is clairvoyant. That is not a
 * theoretical worry: it is precisely why the AI passed its turn holding the one
 * monster that could block a lethal swing. Passing "won", three modelled turns
 * later, because the card that won was on top of the deck and the playout knew
 * it.
 *
 * Both decks are reordered, from the state's own seed so a rerun repeats. Card
 * counts and contents are untouched — only the order the future arrives in,
 * which is the part nobody can see.
 *
 * This costs about five points of win rate, and that is the correct sign.
 * Measured against the AI as it shipped, everything else in this change is
 * level (49.0% ±5.7 over 300 games with the reshuffle disabled, 45.7% ±4.0 over
 * 600 with it on) — so the whole difference is games the old search was winning
 * by knowing its own next three draws. `blendRollout` alone would have fixed
 * the reported blunder, by bounding what any playout may claim; this removes
 * what was making the claim wrong. The file's first paragraph promises the AI
 * plans from the view a player would have, and it was not true of the
 * lookahead.
 *
 * That strength is bought back honestly now: `rolloutSamples` plays each line
 * against several differently-shuffled futures and averages them — variance
 * reduction, not peeking. The `salt` below is what keys the samples apart.
 */
function hideTheFuture(state: DuelState, salt = 0): DuelState {
  const view = structuredClone(state);
  // The salt keys each sample to a different future. Mixed multiplicatively so
  // consecutive salts land far apart in the generator's cycle; still seeded
  // from the state, so a rerun repeats.
  let s = (state.seed ^ Math.imul(salt + 1, 0x9e3779b9)) >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (const pid of ['p1', 'p2'] as PlayerId[]) {
    const deck = view.players[pid].deck;
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
  }
  return view;
}

/**
 * Plays the next `turns` whole turns out — both sides, alternating — with the
 * same search machinery at low width, then scores where we ended up.
 *
 * Both players are driven by the same evaluation, so this is a principal
 * variation rather than a full minimax, but it is the deep part: a line that
 * wins the board this turn and loses it next now scores like the loss it is.
 *
 * An earlier version played the opponent greedily, one best-looking action at a
 * time. That model was bad enough that searching deeper with it made the AI
 * weaker than searching shallowly — the classic pathology of a strong search
 * over a poor model, and the reason this plays whole turns properly instead.
 */
function rollout(state: DuelState, me: PlayerId, turns: number, budgetMs: number, w: EvalWeights, salt = 0): number {
  let cur = hideTheFuture(state, salt);
  const model: AiConfig = { ...MODEL_CFG, weights: w };
  const deadline = Date.now() + budgetMs;
  const per = Math.max(8, budgetMs / Math.max(1, turns));

  for (let t = 0; t < turns; t++) {
    if (cur.winner || Date.now() > deadline) break;
    // Resolve any response window that is owed before the turn can proceed.
    cur = settleWindows(cur, me, w);
    if (cur.winner) break;

    const mover = cur.active;
    for (const action of planWith(cur, mover, model, per)) {
      const res = applyAction(cur, mover, action);
      if (res.error) break;
      cur = res.state;
      if (cur.winner) break;
      // A window opened mid-turn: settle it and carry on with the plan.
      cur = settleWindows(cur, me, w);
    }
    // If the turn did not actually change hands, stop rather than spin.
    if (cur.active === mover && !cur.winner) break;
  }
  return evaluate(cur, me, w);
}

/** Decide a pending trap window by simulating both branches. */
export function chooseTrapResponse(state: DuelState, pid: PlayerId, level: AiSetting = 'champion'): DuelAction {
  const cfg = cfgOf(level);
  const w = cfg.weights ?? WEIGHTS;
  const options = candidates(state, pid, cfg.branch);
  if (!options.length) return { type: 'respondTrap', uid: null };
  let best: DuelAction = { type: 'respondTrap', uid: null };
  let bestScore = -Infinity;
  for (const action of options) {
    const res = applyAction(state, pid, action);
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
    return state.pending.player === pid ? chooseTrapResponse(state, pid, level) : null;
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
