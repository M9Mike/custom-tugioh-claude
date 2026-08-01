/** Where does the AI's thinking time actually go? */
import { applyAction, createDuel } from '../src/game/engine';
import { evaluate, planTurn, candidates } from '../src/game/ai';

const state = createDuel({ seed: 42, p1: { duelistId: 'kaiba', name: 'A' }, p2: { duelistId: 'yugi', name: 'B' } });

let t0 = Date.now();
const N = 300;
for (let i = 0; i < N; i++) applyAction(state, state.active, { type: 'endTurn' });
console.log(`applyAction: ${((Date.now() - t0) / N).toFixed(2)} ms each`);

t0 = Date.now();
for (let i = 0; i < N; i++) evaluate(state, 'p1');
console.log(`evaluate:    ${((Date.now() - t0) / N).toFixed(3)} ms each`);

t0 = Date.now();
for (let i = 0; i < 50; i++) candidates(state, state.active, 30);
console.log(`candidates:  ${((Date.now() - t0) / 50).toFixed(2)} ms each`);

for (const level of ['rookie', 'duelist', 'champion'] as const) {
  t0 = Date.now();
  const plan = planTurn(state, state.active, level, 3000);
  console.log(`planTurn(${level}): ${Date.now() - t0} ms -> ${plan.length} actions`);
}
