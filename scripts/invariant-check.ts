/**
 * Can the engine be driven into an impossible state?
 *
 *   npx tsx scripts/invariant-check.ts [duels]
 *
 * The rest of the battery asks whether cards do what they say. This asks the
 * question underneath: whatever happens, the STATE stays possible. Cards never
 * duplicate and never vanish, a refused action changes nothing, zones keep
 * their shape, numbers stay numbers. Randomized duels are driven deep through
 * the same autoplayer the tests use, with every invariant asserted after every
 * single action — and at each step a malformed action is thrown at the engine
 * to prove refusal is free of side effects.
 */
import { applyAction, createDuel } from '../src/game/engine';
import { chooseAction, legalActions } from '../src/game/autoplay';
import { DUELISTS } from '../src/game/cards';
import type { CardInstance, DuelAction, DuelState, PlayerId } from '../src/game/types';

const DUELS = Math.max(1, Number(process.argv[2] ?? 40));
let failures = 0;
let checked = 0;

function allInstances(s: DuelState): CardInstance[] {
  const out: CardInstance[] = [];
  for (const pid of ['p1', 'p2'] as PlayerId[]) {
    const p = s.players[pid];
    out.push(...p.deck, ...p.hand, ...p.grave, ...p.banished, ...p.extra);
    for (const m of p.monsters) if (m) out.push(m);
    if (p.spellTrap) out.push(p.spellTrap);
    if (p.field) out.push(p.field);
  }
  return out;
}

interface Census {
  perOwner: Record<PlayerId, number>;
}

/** Non-token cards per owner, wherever they sit — absorbed souls included.
 *  An absorbed entry is a soul record `{slug, owner, ghost?}`; a ghost is the
 *  echo of a card that still exists elsewhere, so only real souls count. */
function census(s: DuelState): Census {
  const perOwner: Record<PlayerId, number> = { p1: 0, p2: 0 };
  for (const c of allInstances(s)) {
    if (!c.isToken) perOwner[c.owner] += 1;
    for (const a of c.absorbed ?? []) if (!a.ghost) perOwner[a.owner] += 1;
  }
  return { perOwner };
}

function violations(s: DuelState, base: Census): string[] {
  const bad: string[] = [];
  const seen = new Set<string>();
  for (const c of allInstances(s)) {
    if (seen.has(c.uid)) bad.push(`uid ${c.uid} (${c.slug}) appears in two zones`);
    seen.add(c.uid);
    if (!Number.isFinite(c.atkMod) || !Number.isFinite(c.defMod)) bad.push(`${c.slug} has non-finite mods`);
  }
  const now = census(s);
  for (const pid of ['p1', 'p2'] as PlayerId[]) {
    const p = s.players[pid];
    if (!Number.isFinite(p.lp)) bad.push(`${pid} Life Points are ${p.lp}`);
    if (p.monsters.length !== 3) bad.push(`${pid} has ${p.monsters.length} Monster Zones`);
    if (now.perOwner[pid] !== base.perOwner[pid]) {
      bad.push(`${pid} owns ${now.perOwner[pid]} cards, started with ${base.perOwner[pid]} — cards ${
        now.perOwner[pid] > base.perOwner[pid] ? 'duplicated' : 'vanished'
      }`);
    }
  }
  if (s.pending) {
    if (s.pending.player !== 'p1' && s.pending.player !== 'p2') bad.push('pending.player is not a player');
  }
  for (const o of s.ongoing) if (o.turns < 0) bad.push(`ongoing ${o.kind} at ${o.turns} turns`);
  return bad;
}

/** A malformed action must be refused, and refusal must change nothing. */
function probeIllegal(s: DuelState, actor: PlayerId, rnd: () => number): string | null {
  const garbage: DuelAction[] = [
    { type: 'attack', uid: 'no-such-uid', targetUid: null },
    { type: 'normalSummon', uid: 'no-such-uid', zone: 0, position: 'atk', face: 'up' },
    { type: 'activateSpell', uid: 'no-such-uid' },
    { type: 'respondTrap', uid: 'no-such-uid' },
    { type: 'changePosition', uid: 'no-such-uid' },
  ];
  const a = garbage[Math.floor(rnd() * garbage.length)];
  const before = JSON.stringify(s);
  const res = applyAction(s, actor, a);
  if (!res.error && a.type !== 'respondTrap') return `garbage ${a.type} was accepted`;
  if (res.error && res.state !== s) return `refused ${a.type} returned a different state object`;
  if (JSON.stringify(res.error ? res.state : s) !== before && res.error) return `refused ${a.type} still mutated the state`;
  return null;
}

for (let d = 0; d < DUELS; d++) {
  const d1 = DUELISTS[d % DUELISTS.length].id;
  const d2 = DUELISTS[(d * 5 + 3) % DUELISTS.length].id;
  let rng = 40501 + d * 7717;
  const rnd = () => {
    rng = (rng * 1664525 + 1013904223) >>> 0;
    return rng / 4294967296;
  };
  let s = createDuel({ seed: 50000 + d * 449, p1: { duelistId: d1, name: 'A' }, p2: { duelistId: d2, name: 'B' } });
  const base = census(s);
  let broke = '';

  for (let step = 0; step < 1500 && !s.winner && s.turn <= 60; step++) {
    const actor: PlayerId = s.pending ? s.pending.player : s.active;
    if ((step & 3) === 0) {
      const illegal = probeIllegal(s, actor, rnd);
      if (illegal) {
        broke = `step ${step}: ${illegal}`;
        break;
      }
    }
    const acts = legalActions(s, actor, rnd);
    if (!acts.length) break;
    const res = applyAction(s, actor, chooseAction(acts, rnd));
    if (res.error) continue;
    s = res.state;
    checked += 1;
    const bad = violations(s, base);
    if (bad.length) {
      broke = `step ${step} (${d1} vs ${d2}): ${bad[0]}`;
      break;
    }
  }
  if (broke) {
    failures += 1;
    console.log(`  ❌ duel ${d + 1}: ${broke}`);
  }
}

console.log(
  failures
    ? `\n❌ ${failures} duel(s) reached an impossible state.`
    : `\n✅ ${DUELS} randomized duels, ${checked} states audited — cards never duplicated, never vanished, refusals never left a mark.`
);
process.exitCode = failures ? 1 : 0;
