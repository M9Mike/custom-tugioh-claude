/**
 * *Why* a deck wins, not whether it does.
 *
 *   npx tsx scripts/deck-shape.ts <duelist> [games]
 *
 * `deck-bench` gives one number, and one number cannot tell you which lever to
 * pull. Three decks came in at 83/75/73 against a 50% target here; a
 * substantial trim to every coefficient on all three moved them to 87/72/63 —
 * every interval overlapping, which is what a *wrong shape* looks like when you
 * tune its numbers. Nothing in the battery could say more than "still too
 * strong".
 *
 * This reads the board instead, and the answer was one table:
 *
 *     turn 4      bodies    board ATK    duel ends
 *     yami          1.25         2269         8.7     (the reference, ~63%)
 *     ishizu        1.46         3490         7.3     (87%)
 *     priestseto    1.74         3598         6.7     (75%)
 *     odion         1.70         3378         7.2     (73%)
 *
 * Half again as much board by turn 4 and a duel a turn and a half shorter — so
 * the fault was width and per-body power, not any single card's numbers. Two of
 * the three turned out to be carrying the Gazelle-and-Berfomet double-dip
 * recorded in CLAUDE.md: two auras counting the same quantity onto the same
 * cards, where the second's only real function is doubling the first. Removing
 * *that* moved them where a whole round of coefficient trimming had not.
 *
 * The same lesson is already written down for Yami Marik, whose gap was found
 * by instrumenting bodies-on-board rather than by staring at a win count. It
 * kept having to be rediscovered because the tool was thrown away each time.
 * So it lives here now.
 *
 * Read it against a deck you consider correctly priced rather than against
 * absolutes — the numbers move with the Life Point pool and with the roster.
 */
import { createDuel, applyAction, effAtk } from '../src/game/engine';
import { aiNext, createAiRuntime, invalidatePlan, AI_LEVELS } from '../src/game/ai';
import { GAME_AI } from '../src/game/ai-levels';
import { DUELISTS } from '../src/game/cards';
import type { DuelState, PlayerId } from '../src/game/types';

const who = process.argv[2];
const games = Number(process.argv[3] ?? 24);

if (!who || !DUELISTS.some((d) => d.id === who)) {
  console.error('Usage: npx tsx scripts/deck-shape.ts <duelist> [games]');
  console.error(`Duelists: ${DUELISTS.map((d) => d.id).join(', ')}`);
  process.exit(1);
}

const brain = AI_LEVELS[GAME_AI];
const others = DUELISTS.map((d) => d.id).filter((d) => d !== who);

const bodies = (s: DuelState, p: PlayerId) => s.players[p].monsters.filter(Boolean).length;
const power = (s: DuelState, p: PlayerId) =>
  s.players[p].monsters.reduce((n, m) => n + (m ? effAtk(s, m, p) : 0), 0);

const MARKS = [4, 6, 8, 10];
type Row = { meB: number; foeB: number; meA: number; foeA: number };
const at: Record<number, Row[]> = Object.fromEntries(MARKS.map((t) => [t, [] as Row[]]));
let wins = 0, played = 0, endTurns = 0, graveAtEnd = 0, lpAtEnd = 0, foeLpAtEnd = 0;

for (let i = 0; i < games; i++) {
  const foe = others[i % others.length];
  // The duelist under test alternates seats, so first-turn advantage cancels
  // out exactly as it does in `deck-bench`.
  const meFirst = i % 2 === 0;
  const me: PlayerId = meFirst ? 'p1' : 'p2';
  const them: PlayerId = meFirst ? 'p2' : 'p1';
  let state = createDuel({
    seed: 1000 + i,
    p1: { duelistId: meFirst ? who : foe, name: 'P1' },
    p2: { duelistId: meFirst ? foe : who, name: 'P2' },
  });
  const rt = { p1: createAiRuntime(), p2: createAiRuntime() };
  const seen = new Set<number>();

  for (let step = 0; step < 3000 && !state.winner && state.turn <= 60; step++) {
    // Sampled on the first action of the turn, so every duel is read at the
    // same point in the turn rather than wherever it happened to be looked at.
    for (const t of MARKS) {
      if (state.turn === t && !seen.has(t)) {
        seen.add(t);
        at[t].push({ meB: bodies(state, me), foeB: bodies(state, them), meA: power(state, me), foeA: power(state, them) });
      }
    }
    const actor: PlayerId = state.pending ? state.pending.player : state.active;
    const action = aiNext(state, actor, brain, rt[actor], 1500);
    if (!action) break;
    let r = applyAction(state, actor, action);
    if (r.error) {
      // Plan went stale against the real position — search again, exactly as
      // the arena does, or a refused action would end the duel early and the
      // sample would be of short duels only.
      invalidatePlan(rt[actor]);
      const retry = aiNext(state, actor, brain, rt[actor], 1500);
      if (!retry) break;
      r = applyAction(state, actor, retry);
      if (r.error) break;
    }
    state = r.state;
  }

  if (!state.winner) continue;
  played += 1;
  if (state.winner === me) wins += 1;
  endTurns += state.turn;
  graveAtEnd += state.players[me].grave.length;
  lpAtEnd += state.players[me].lp;
  foeLpAtEnd += state.players[them].lp;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const per = Math.max(1, played);

console.log(`\n${who} — ${wins}/${played} (${Math.round((100 * wins) / per)}%) over ${games} duels`);
console.log('A win rate at this sample size is very wide; the shape below is the point.\n');
console.log('turn    bodies me / foe     board ATK me / foe');
for (const t of MARKS) {
  const rows = at[t];
  if (!rows.length) { console.log(`  ${String(t).padStart(2)}    (never reached)`); continue; }
  console.log(
    `  ${String(t).padStart(2)}    ${avg(rows.map((r) => r.meB)).toFixed(2)} / ${avg(rows.map((r) => r.foeB)).toFixed(2)}` +
      `            ${Math.round(avg(rows.map((r) => r.meA)))} / ${Math.round(avg(rows.map((r) => r.foeA)))}` +
      `   (n=${rows.length})`
  );
}
console.log(`\nduel ends on turn ${(endTurns / per).toFixed(1)} · own Graveyard ${(graveAtEnd / per).toFixed(1)} cards`);
console.log(`Life Points at the end: ${Math.round(lpAtEnd / per)} against ${Math.round(foeLpAtEnd / per)}`);
