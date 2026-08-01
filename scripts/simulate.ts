/**
 * Random-play simulator. Plays full duels between every pair of duelists using
 * only legal actions, to shake out crashes, soft-locks and wild imbalance.
 *
 *   npx tsx scripts/simulate.ts [games]
 */
import { CARDS, DUELISTS } from '../src/game/cards';
import {
  applyAction,
  canActivateFromHand,
  canActivateSetCard,
  canAttackWith,
  canChangePosition,
  canIgnite,
  fusionOptions,
  legalAttackTargets,
  other,
  summonBlocked,
  tributesRequired,
} from '../src/game/engine';
import { MONSTER_ZONES, type CardInstance, type DuelAction, type DuelState, type PlayerId } from '../src/game/types';

let rngState = 12345;
function rnd(): number {
  rngState = (rngState * 1664525 + 1013904223) >>> 0;
  return rngState / 4294967296;
}
const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];

/** All legal actions for the player who is allowed to act right now. */
function legalActions(state: DuelState, pid: PlayerId): DuelAction[] {
  const acts: DuelAction[] = [];
  const p = state.players[pid];

  if (state.pending) {
    if (state.pending.player !== pid) return acts;
    acts.push({ type: 'respondTrap', uid: null });
    for (const uid of state.pending.options) {
      const oppMonsters = state.players[other(pid)].monsters.filter((m): m is CardInstance => !!m);
      acts.push({ type: 'respondTrap', uid, targets: oppMonsters.length ? [pick(oppMonsters).uid] : [] });
    }
    return acts;
  }

  if (state.active !== pid || state.winner) return acts;

  const oppMonsters = state.players[other(pid)].monsters.filter((m): m is CardInstance => !!m);
  const ownMonsters = p.monsters.filter((m): m is CardInstance => !!m);
  const someTarget = (own = false) => {
    const pool = own ? ownMonsters : oppMonsters;
    return pool.length ? [pick(pool).uid] : [];
  };

  if (state.phase === 'main') {
    const freeZone = p.monsters.findIndex((m) => !m);
    if (!p.normalSummonUsed && freeZone >= 0) {
      for (const h of p.hand) {
        const def = CARDS[h.slug];
        if (!def || def.kind !== 'monster') continue;
        // The engine's own gate: no Fusions from the Extra Deck, no Rituals,
        // and no Toon without its Toon World. Repeating the rule here instead
        // is how the random driver started generating illegal summons.
        if (summonBlocked(state, pid, h.slug)) continue;
        // A real player holds the Forbidden One in hand rather than summoning it.
        if (def.name.includes('Forbidden One') || def.name === 'Exodia the Forbidden One') continue;
        const need = tributesRequired(h.slug, state, pid);
        if (need === 0) {
          acts.push({ type: 'normalSummon', uid: h.uid, zone: freeZone, position: 'atk', face: 'up' });
          acts.push({ type: 'normalSummon', uid: h.uid, zone: freeZone, position: 'def', face: 'down' });
        } else if (ownMonsters.length >= need) {
          acts.push({
            type: 'normalSummon',
            uid: h.uid,
            zone: freeZone,
            position: 'atk',
            face: 'up',
            tributes: ownMonsters.slice(0, need).map((m) => m.uid),
          });
        }
      }
    }
    for (const m of ownMonsters) {
      if (canChangePosition(state, pid, m)) acts.push({ type: 'changePosition', uid: m.uid });
      if (canIgnite(state, pid, m)) acts.push({ type: 'ignition', uid: m.uid, targets: someTarget() });
    }
    for (const h of p.hand) {
      if (canActivateFromHand(state, pid, h)) {
        const def = CARDS[h.slug];
        const eff = def.effects.find((e) => e.trigger === 'activate');
        const ownTargeting = ['salamandra', 'legendary-sword', 'cyber-shield', 'malevolent-nuzzler', 'laser-cannon-armor', 'insect-armor-with-laser-cannon', 'machine-conversion-factory', '7-completed'].includes(def.slug);
        const graveTargeting = def.slug === 'monster-reborn';
        let targets: string[] = [];
        if (graveTargeting) {
          const pool = [...p.grave, ...state.players[other(pid)].grave].filter((c) => CARDS[c.slug]?.kind === 'monster');
          targets = pool.length ? [pick(pool).uid] : [];
        } else if (eff?.targets) {
          targets = someTarget(ownTargeting);
        }
        acts.push({ type: 'activateSpell', uid: h.uid, targets });
      }
      if (!p.spellTrap && CARDS[h.slug] && CARDS[h.slug].kind !== 'monster') {
        acts.push({ type: 'setSpellTrap', uid: h.uid });
      }
    }
    if (p.spellTrap && canActivateSetCard(state, pid, p.spellTrap)) {
      acts.push({ type: 'activateSetCard', uid: p.spellTrap.uid, targets: someTarget() });
    }
    for (const f of fusionOptions(state, pid)) {
      const zone = p.monsters.findIndex((m) => !m);
      if (zone >= 0) acts.push({ type: 'fusionSummon', extraUid: f.extraUid, materials: f.materials, zone, position: 'atk' });
    }
    if (state.turn > 1) acts.push({ type: 'toPhase', phase: 'battle' });
    acts.push({ type: 'endTurn' });
  }

  if (state.phase === 'battle') {
    for (const m of ownMonsters) {
      if (!canAttackWith(state, pid, m)) continue;
      const { uids, direct } = legalAttackTargets(state, pid, m);
      if (direct) acts.push({ type: 'attack', uid: m.uid, targetUid: null });
      for (const t of uids) acts.push({ type: 'attack', uid: m.uid, targetUid: t });
    }
    acts.push({ type: 'endTurn' });
  }

  return acts;
}

interface Result {
  winner: PlayerId | 'draw' | null;
  turns: number;
  reason?: string;
  error?: string;
}

function playGame(seed: number, d1: string, d2: string, verbose = false): Result {
  const { createDuel } = require('../src/game/engine') as typeof import('../src/game/engine');
  let state = createDuel({ seed, p1: { duelistId: d1, name: d1 }, p2: { duelistId: d2, name: d2 } });
  let steps = 0;

  while (!state.winner && steps < 4000) {
    steps += 1;
    const actor: PlayerId = state.pending ? state.pending.player : state.active;
    const acts = legalActions(state, actor);
    if (!acts.length) {
      if (state.pending) return { winner: null, turns: state.turn, error: 'pending window with no legal response' };
      return { winner: null, turns: state.turn, error: `no legal actions (phase=${state.phase})` };
    }
    // Bias toward aggression so games actually finish.
    const attacks = acts.filter((a) => a.type === 'attack');
    const battle = acts.filter((a) => a.type === 'toPhase');
    let chosen: DuelAction;
    if (attacks.length && rnd() < 0.85) chosen = pick(attacks);
    else if (battle.length && rnd() < 0.6) chosen = pick(battle);
    else chosen = pick(acts);

    const res = applyAction(state, actor, chosen);
    if (res.error && res.state === state) {
      // Illegal action the simulator thought was legal — that is a real bug.
      return { winner: null, turns: state.turn, error: `${chosen.type}: ${res.error}` };
    }
    state = res.state;
    if (verbose) console.log(`${actor} ${chosen.type} -> ${state.log.at(-1)?.text ?? ''}`);
    if (state.turn > 60) break;
  }
  return { winner: state.winner, turns: state.turn, reason: state.winReason };
}

const GAMES = Number(process.argv[2] ?? 400);
const errors: Record<string, number> = {};
const wins: Record<string, { w: number; l: number; d: number }> = {};
let totalTurns = 0;
let finished = 0;
let stalled = 0;

for (const d of DUELISTS) wins[d.id] = { w: 0, l: 0, d: 0 };

for (let i = 0; i < GAMES; i++) {
  const a = DUELISTS[i % DUELISTS.length].id;
  const b = DUELISTS[(i * 7 + 3) % DUELISTS.length].id;
  if (a === b) continue;
  const r = playGame(1000 + i * 17, a, b);
  if (r.error) {
    errors[r.error] = (errors[r.error] ?? 0) + 1;
    continue;
  }
  if (!r.winner) {
    stalled += 1;
    continue;
  }
  finished += 1;
  totalTurns += r.turns;
  if (r.winner === 'draw') {
    wins[a].d += 1;
    wins[b].d += 1;
  } else if (r.winner === 'p1') {
    wins[a].w += 1;
    wins[b].l += 1;
  } else {
    wins[b].w += 1;
    wins[a].l += 1;
  }
}

console.log(`\nGames: ${GAMES}   finished: ${finished}   stalled(>60 turns): ${stalled}`);
console.log(`Average turns per finished duel: ${(totalTurns / Math.max(1, finished)).toFixed(1)}`);

const errKeys = Object.keys(errors);
if (errKeys.length) {
  console.log('\n!! ERRORS');
  for (const [k, v] of Object.entries(errors).sort((x, y) => y[1] - x[1])) console.log(`  ${v.toString().padStart(4)} × ${k}`);
} else {
  console.log('\nNo rule errors. ✅');
}

console.log('\nWin rate by duelist (random play):');
for (const d of DUELISTS) {
  const w = wins[d.id];
  const total = w.w + w.l + w.d;
  if (!total) continue;
  console.log(`  ${d.id.padEnd(9)} ${((w.w / total) * 100).toFixed(0).padStart(3)}%  (${w.w}W ${w.l}L ${w.d}D)`);
}

if (errKeys.length) process.exitCode = 1;
