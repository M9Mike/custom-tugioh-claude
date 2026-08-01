/**
 * How one duelist's deck actually performs, played by the real game AI.
 *
 *   npx tsx scripts/deck-bench.ts pegasus [games]
 *
 * `npm run sim` plays at random, and a combo deck at random never draws its
 * enabler on purpose — Pegasus measures 29% there and 85% here. CLAUDE.md says
 * to believe this number rather than that one before rebalancing anything, and
 * this is the tool that produces it.
 *
 * Both seats are the same brain and the duelist under test alternates between
 * them, so whatever first-turn advantage exists cancels out. A 95% interval is
 * printed because at these sample sizes it is wide: two runs a dozen points
 * apart are usually the same deck, and early tuning against raw win counts sent
 * this AI down a blind alley once already.
 */
import { playGame } from './ai-arena';
import { AI_LEVELS } from '../src/game/ai';
import { GAME_AI } from '../src/game/ai-levels';
import { DUELISTS } from '../src/game/cards';

const who = process.argv[2];
const games = Number(process.argv[3] ?? 100);

if (!who || !DUELISTS.some((d) => d.id === who)) {
  console.error(`Usage: npx tsx scripts/deck-bench.ts <duelist> [games]`);
  console.error(`Duelists: ${DUELISTS.map((d) => d.id).join(', ')}`);
  process.exit(1);
}

const brain = AI_LEVELS[GAME_AI];
const others = DUELISTS.map((d) => d.id).filter((d) => d !== who);

/* Cannot happen with ten duelists, and would be silent if it ever did:
   `i % 0` is NaN, so every opponent would be `undefined` and the run would
   report a win rate over whatever `playGame` made of that. Reported by Corgea
   on the pull request that added this file. */
if (!others.length) {
  console.error(`No opponent for ${who} — the roster holds nobody else to duel.`);
  process.exit(1);
}

let wins = 0;
let played = 0;
for (let i = 0; i < games; i++) {
  const foe = others[i % others.length];
  const meFirst = i % 2 === 0;
  const r = playGame({
    seed: 1000 + i,
    d1: meFirst ? who : foe,
    d2: meFirst ? foe : who,
    a: brain,
    b: brain,
    aIsP1: meFirst,
  });
  if (r.win === 'a' || r.win === 'b') {
    played += 1;
    if (r.win === 'a') wins += 1;
  }
}

if (!played) {
  console.log(`${who}: no games resolved — this proves nothing`);
  process.exitCode = 1;
} else {
  const p = wins / played;
  const ci = 1.96 * Math.sqrt((p * (1 - p)) / played);
  console.log(`${who}: ${(p * 100).toFixed(0)}% ±${(ci * 100).toFixed(0)} (${wins}/${played}, real AI on both seats)`);
}
