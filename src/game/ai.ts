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
  tributesRequired,
} from './engine';
import { targetSpecFor } from './ui';
import { AI_LEVEL_LABELS, type AiLevel } from './ai-levels';
import { MONSTER_ZONES, type CardInstance, type DuelAction, type DuelState, type PlayerId } from './types';

export { AI_LEVEL_LABELS };
export type { AiLevel };

export interface AiConfig {
  /** How many partial lines are kept at each step of the turn search. */
  beam: number;
  /** How many candidate actions are considered per step. */
  branch: number;
  /** 0 = always play the best line; higher mixes in weaker ones. */
  slack: number;
  /** Whether the opponent's best reply is subtracted from a line's score. */
  lookahead: boolean;
  /** Evaluation weights; defaults to the tuned set. */
  weights?: EvalWeights;
}

export const AI_LEVELS: Record<AiLevel, AiConfig> = {
  rookie: { beam: 1, branch: 6, slack: 0.55, lookahead: false },
  duelist: { beam: 4, branch: 14, slack: 0.12, lookahead: true },
  champion: { beam: 10, branch: 26, slack: 0, lookahead: true },
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

  // Whatever the opponent could not block still threatens next turn.
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
  const spec = targetSpecFor(slug, trigger);
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
  const take = Math.min(3, ranked.length);
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
        .filter((h) => !(CARDS[h.slug].isFusion && p.extra.some((e) => e.slug === h.slug)))
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

/** Cheap, deterministic settings used to model the opponent's reply turn. */
const MODEL_CFG: AiConfig = { beam: 2, branch: 10, slack: 0, lookahead: false };

function planWith(state: DuelState, pid: PlayerId, cfg: AiConfig, budgetMs: number): DuelAction[] {
  // `budgetMs` is a hard bound on the whole call, because a human is waiting on
  // the other end of a request. The second ply gets its own slice reserved up
  // front — otherwise a wide beam search would spend the lot and leave nothing
  // for the lookahead, or the lookahead would run past the budget entirely.
  const started = Date.now();
  const hardDeadline = started + budgetMs;
  const deadline = cfg.lookahead ? started + budgetMs * 0.55 : hardDeadline;
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
        const ends = action.type === 'endTurn' || res.state.active !== pid || !!res.state.winner;
        next.push({
          state: res.state,
          actions: [...line.actions, action],
          score: evaluate(res.state, pid, w),
          done: ends || !!res.state.pending,
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

  const all = [...finished, ...lines].filter((l) => l.actions.length);
  if (!all.length) return [{ type: 'endTurn' }];

  for (const line of all) line.score = evaluate(line.state, pid, w);
  all.sort((a, b) => b.score - a.score);

  // Second ply: for the most promising lines, actually play the opponent's
  // whole reply turn and re-score. Considering only their single best *action*
  // badly underrates lines that lose to a two-card follow-up.
  if (cfg.lookahead) {
    const foe = other(pid);
    const examine = all.slice(0, cfg.beam >= 8 ? 12 : 6);
    // Share whatever is left of the budget out over the lines still to check,
    // so the first few cannot starve the rest.
    for (let i = 0; i < examine.length; i++) {
      const line = examine[i];
      const left = hardDeadline - Date.now();
      if (line.state.winner || left <= 0) continue;
      line.score = scoreAfterOpponentTurn(line.state, pid, foe, left / (examine.length - i), w);
    }
    examine.sort((a, b) => b.score - a.score);
    const rest = all.slice(examine.length);
    all.length = 0;
    all.push(...examine, ...rest);
  }

  // Slack lets the easier levels pick a line that is merely good.
  const index = cfg.slack > 0 ? Math.min(all.length - 1, Math.floor(Math.random() * cfg.slack * all.length)) : 0;
  return all[index].actions;
}

/**
 * Plays out the opponent's reply turn with the same search machinery (at low
 * width) and scores the position it leaves us in. This is the second ply.
 *
 * An earlier version played the opponent greedily, one best-looking action at a
 * time. That model was bad enough that searching deeper with it made the AI
 * weaker than searching shallowly — the classic pathology of a strong search
 * over a poor model.
 */
function scoreAfterOpponentTurn(
  state: DuelState,
  me: PlayerId,
  foe: PlayerId,
  budgetMs: number,
  w: EvalWeights
): number {
  let cur = state;
  const model: AiConfig = { ...MODEL_CFG, weights: w };
  // Resolve any window the opponent is owed first.
  for (let guard = 0; guard < 4 && cur.pending; guard++) {
    const responder = cur.pending.player;
    const res = applyAction(cur, responder, chooseTrapResponse(cur, responder, model));
    if (res.error) break;
    cur = res.state;
  }
  if (cur.winner || cur.active !== foe) return evaluate(cur, me, w);

  for (const action of planWith(cur, foe, model, budgetMs)) {
    const res = applyAction(cur, foe, action);
    if (res.error) break;
    cur = res.state;
    if (cur.winner || cur.pending) break;
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
