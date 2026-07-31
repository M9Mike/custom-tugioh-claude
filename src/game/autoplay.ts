/**
 * Enumerates the legal actions available to a player. Used by the offline
 * simulator and the end-to-end test client; it is deliberately built only from
 * the exported legality helpers, so anything it offers must be accepted by the
 * engine.
 */
import { CARDS } from './cards';
import {
  canActivateFromHand,
  canActivateSetCard,
  canAttackWith,
  canChangePosition,
  canIgnite,
  fusionOptions,
  legalAttackTargets,
  other,
  tributesRequired,
} from './engine';
import { targetSpecFor } from './ui';
import type { CardInstance, DuelAction, DuelState, PlayerId } from './types';

export function legalActions(state: DuelState, pid: PlayerId, rnd: () => number): DuelAction[] {
  const acts: DuelAction[] = [];
  const p = state.players[pid];
  const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];

  if (state.pending) {
    if (state.pending.player !== pid) return acts;
    acts.push({ type: 'respondTrap', uid: null });
    for (const uid of state.pending.options) {
      const c = p.hand.find((h) => h.uid === uid) ?? (p.spellTrap?.uid === uid ? p.spellTrap : null);
      acts.push({ type: 'respondTrap', uid, targets: c ? targetsFor(state, pid, c.slug, 'trap', rnd) : [] });
    }
    return acts;
  }

  if (state.active !== pid || state.winner) return acts;

  const ownMonsters = p.monsters.filter((m): m is CardInstance => !!m);

  if (state.phase === 'main') {
    const freeZone = p.monsters.findIndex((m) => !m);
    if (!p.normalSummonUsed) {
      for (const h of p.hand) {
        const def = CARDS[h.slug];
        if (!def || def.kind !== 'monster') continue;
        if (def.isFusion && p.extra.some((e) => e.slug === h.slug)) continue;
        if (def.name.includes('Forbidden One')) continue; // held for the Exodia win
        const need = tributesRequired(h.slug, state, pid);
        const bodies = ownMonsters.filter((m) => !m.isToken);
        if (need === 0 && freeZone >= 0) {
          const targets = targetsFor(state, pid, h.slug, 'onSummon', rnd);
          acts.push({ type: 'normalSummon', uid: h.uid, zone: freeZone, position: 'atk', face: 'up', targets });
          acts.push({ type: 'normalSummon', uid: h.uid, zone: freeZone, position: 'def', face: 'down' });
        } else if (need > 0 && bodies.length >= need) {
          const tributes = bodies.slice(0, need).map((m) => m.uid);
          const zone = freeZone >= 0 ? freeZone : p.monsters.findIndex((m) => m && tributes.includes(m.uid));
          if (zone >= 0) {
            acts.push({
              type: 'normalSummon',
              uid: h.uid,
              zone,
              position: 'atk',
              face: 'up',
              tributes,
              targets: targetsFor(state, pid, h.slug, 'onSummon', rnd),
            });
          }
        }
      }
    }
    for (const m of ownMonsters) {
      if (canChangePosition(state, pid, m)) acts.push({ type: 'changePosition', uid: m.uid });
      if (canIgnite(state, pid, m)) {
        acts.push({ type: 'ignition', uid: m.uid, targets: targetsFor(state, pid, m.slug, 'ignition', rnd) });
      }
    }
    for (const h of p.hand) {
      if (canActivateFromHand(state, pid, h)) {
        acts.push({ type: 'activateSpell', uid: h.uid, targets: targetsFor(state, pid, h.slug, 'activate', rnd) });
      }
      if (!p.spellTrap && CARDS[h.slug] && CARDS[h.slug].kind !== 'monster') {
        acts.push({ type: 'setSpellTrap', uid: h.uid });
      }
    }
    if (p.spellTrap && canActivateSetCard(state, pid, p.spellTrap)) {
      const trig = CARDS[p.spellTrap.slug]?.kind === 'trap' ? 'trap' : 'activate';
      acts.push({ type: 'activateSetCard', uid: p.spellTrap.uid, targets: targetsFor(state, pid, p.spellTrap.slug, trig, rnd) });
    }
    for (const f of fusionOptions(state, pid)) {
      const zone = p.monsters.findIndex((m) => !m);
      if (zone >= 0) acts.push({ type: 'fusionSummon', extraUid: f.extraUid, materials: f.materials, zone, position: 'atk' });
    }
    if (state.turn > 1 && !state.ongoing.some((o) => o.kind === 'skipBattlePhase' && o.target === pid)) {
      acts.push({ type: 'toPhase', phase: 'battle' });
    }
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

  void pick;
  return acts;
}

/** Picks plausible targets for a card's effect, mirroring what the UI would collect. */
function targetsFor(state: DuelState, pid: PlayerId, slug: string, trigger: 'activate' | 'ignition' | 'trap' | 'onSummon', rnd: () => number): string[] {
  const spec = targetSpecFor(slug, trigger);
  if (!spec) return [];
  const sides: PlayerId[] = spec.side === 'own' ? [pid] : spec.side === 'opp' ? [other(pid)] : [pid, other(pid)];
  const pool: string[] = [];
  for (const id of sides) {
    const pl = state.players[id];
    if (spec.zone === 'monster') pool.push(...pl.monsters.filter((m): m is CardInstance => !!m).map((m) => m.uid));
    else if (spec.zone === 'spellTrap') {
      if (pl.spellTrap) pool.push(pl.spellTrap.uid);
      if (pl.field) pool.push(pl.field.uid);
    } else if (spec.zone === 'grave') {
      pool.push(...pl.grave.filter((c) => CARDS[c.slug]?.kind === 'monster').map((c) => c.uid));
    } else if (spec.zone === 'hand' && id === pid) pool.push(...pl.hand.map((c) => c.uid));
  }
  const out: string[] = [];
  const avail = [...pool];
  for (let i = 0; i < spec.count && avail.length; i++) {
    out.push(...avail.splice(Math.floor(rnd() * avail.length), 1));
  }
  return out;
}

/** Chooses one action, biased toward finishing the duel rather than stalling. */
export function chooseAction(acts: DuelAction[], rnd: () => number): DuelAction {
  if (!acts.length) throw new Error('chooseAction called with no available actions');
  const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
  const attacks = acts.filter((a) => a.type === 'attack');
  const toBattle = acts.filter((a) => a.type === 'toPhase');
  if (attacks.length && rnd() < 0.85) return pick(attacks);
  if (toBattle.length && rnd() < 0.6) return pick(toBattle);
  return pick(acts);
}
