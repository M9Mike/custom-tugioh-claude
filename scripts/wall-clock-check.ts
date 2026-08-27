/**
 * The serving clock, held to its word.
 *
 *   npx tsx scripts/wall-clock-check.ts
 *
 * The batteries run on node budgets (`setPureClock`) so their verdicts are
 * load-immune; the ROOM runs on wall time, and the promise there is different:
 * a decision never overstays its budget by more than scheduling slop. This
 * drives real duels through the same call the room makes — `aiNext` at the
 * side-duel budget, `planTurn` at the live-room budget — and reports the
 * worst overstay. It is a gate on latency, not on strength.
 */
import { createDuel, applyAction } from '../src/game/engine';
import { aiNext, createAiRuntime, invalidatePlan, planTurn } from '../src/game/ai';
import { DUELISTS } from '../src/game/cards';
import type { DuelAction, DuelState, PlayerId } from '../src/game/types';

const ACTION_MS = 900; // tournament side duels (rooms.ts stepSideDuels)
const PLAN_MS = 8000; // the live room's whole-turn plan (rooms.ts)
const SLACK = 1.35; // scheduling slop the cap may legitimately eat

function duelists(i: number): [string, string] {
  const a = DUELISTS[i % DUELISTS.length].id;
  const b = DUELISTS[(i * 5 + 3) % DUELISTS.length].id;
  return a === b ? [a, DUELISTS[(i + 1) % DUELISTS.length].id] : [a, b];
}

let worstAction = 0;
let worstPlan = 0;
const planStates: DuelState[] = [];

for (let g = 0; g < 3; g++) {
  const [d1, d2] = duelists(g);
  let state = createDuel({ seed: 4200 + g * 97, p1: { duelistId: d1, name: 'P1' }, p2: { duelistId: d2, name: 'P2' } });
  const rt: Record<PlayerId, ReturnType<typeof createAiRuntime>> = { p1: createAiRuntime(), p2: createAiRuntime() };
  for (let step = 0; step < 400 && !state.winner && state.turn <= 12; step++) {
    const actor: PlayerId = state.pending ? state.pending.player : state.active;
    if (state.turn >= 4 && !state.pending && planStates.length < 6 && step % 17 === 0) planStates.push(structuredClone(state));
    const t0 = performance.now();
    const action: DuelAction | null = aiNext(state, actor, 'champion', rt[actor], ACTION_MS);
    worstAction = Math.max(worstAction, performance.now() - t0);
    if (!action) break;
    let res = applyAction(state, actor, action);
    if (res.error) {
      invalidatePlan(rt[actor]);
      const t1 = performance.now();
      const retry = aiNext(state, actor, 'champion', rt[actor], ACTION_MS);
      worstAction = Math.max(worstAction, performance.now() - t1);
      if (!retry) break;
      res = applyAction(state, actor, retry);
      if (res.error) break;
    }
    state = res.state;
  }
}

for (const s of planStates) {
  const pid = s.active;
  const t0 = performance.now();
  planTurn(s, pid, 'champion', PLAN_MS);
  worstPlan = Math.max(worstPlan, performance.now() - t0);
}

const capA = ACTION_MS * SLACK + 250;
const capP = PLAN_MS * SLACK + 250;
console.log(`worst aiNext at ${ACTION_MS}ms budget: ${Math.round(worstAction)}ms  (cap ${Math.round(capA)}ms)`);
console.log(`worst planTurn at ${PLAN_MS}ms budget: ${Math.round(worstPlan)}ms over ${planStates.length} states  (cap ${Math.round(capP)}ms)`);
if (worstAction > capA || worstPlan > capP) {
  console.log('❌ the serving clock overstayed its budget.');
  process.exit(1);
}
console.log('✅ the serving clock keeps its word.');
