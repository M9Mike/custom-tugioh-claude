/**
 * One deck against one other deck, played by the real game AI.
 *
 *   npx tsx scripts/head-to-head.ts yami yamimarik [games]
 *
 * `npm run deck-bench` is round-robin against the whole field, which makes it
 * zero-sum and therefore a measurement of the *field* as much as of the deck:
 * adding a weak twelfth duelist moved Yami 72 → 81 without a card of his
 * changing. That is the right number for "where does this deck sit on the
 * ladder" and the wrong one for "are these two decks an even match", which is
 * a question about exactly two decks and nobody else.
 *
 * Both seats are the same brain and the first deck named alternates between
 * going first and second, so the first-turn advantage cancels out — the same
 * discipline `deck-bench` uses. The 95% interval is printed because it is wide
 * at these sample sizes: at 100 games it is around ±10, so two runs a dozen
 * points apart are usually the same matchup.
 */
import { playGame } from './ai-arena';
import { AI_LEVELS } from '../src/game/ai';
import { GAME_AI } from '../src/game/ai-levels';
import { DUELISTS } from '../src/game/cards';

const left = process.argv[2];
const right = process.argv[3];
const games = Number(process.argv[4] ?? 100);

const known = (id: string) => DUELISTS.some((d) => d.id === id);

if (!left || !right || !known(left) || !known(right) || left === right) {
  console.error('Usage: npx tsx scripts/head-to-head.ts <duelist> <duelist> [games]');
  console.error(`Duelists: ${DUELISTS.map((d) => d.id).join(', ')}`);
  process.exit(1);
}

const brain = AI_LEVELS[GAME_AI];

let wins = 0;
let played = 0;
for (let i = 0; i < games; i++) {
  const leftFirst = i % 2 === 0;
  const r = playGame({
    seed: 7000 + i,
    d1: leftFirst ? left : right,
    d2: leftFirst ? right : left,
    a: brain,
    b: brain,
    aIsP1: leftFirst,
  });
  if (r.win === 'a' || r.win === 'b') {
    played += 1;
    if (r.win === 'a') wins += 1;
  }
}

if (!played) {
  /* Never silently report 0% — a matchup where nothing resolves is a broken
     harness, not a one-sided matchup, and the two read identically. */
  console.log(`${left} vs ${right}: no games resolved — this proves nothing`);
  process.exitCode = 1;
} else {
  const p = wins / played;
  const ci = 1.96 * Math.sqrt((p * (1 - p)) / played);
  console.log(
    `${left} vs ${right}: ${(p * 100).toFixed(0)}% ±${(ci * 100).toFixed(0)} to ${left} ` +
      `(${wins}/${played}, real AI on both seats)`
  );
}
