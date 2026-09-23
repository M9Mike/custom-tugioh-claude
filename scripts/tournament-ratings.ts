/**
 * How strong each tournament entrant's deck really is, measured.
 *
 *   npx tsx scripts/tournament-ratings.ts [games-per-pair] [--workers=n]
 *
 * The duels the tournament plays behind the player's back are decided by a
 * rating each (`ENTRANTS` in `story/tournament.ts`), and a rating typed by
 * feel is a rating somebody argues with. So this plays the entrants against
 * each other with the real game AI on both seats — a round robin, every pair,
 * the first seat alternating so neither deck is flattered by going first — and
 * fits the ratings that best explain the results: the Bradley–Terry maximum
 * likelihood, on the Elo scale, the field's mean pinned at 1400.
 *
 * A tool, not a gate: several minutes of CPU across every core. Run it when a
 * deck changes and copy the numbers it prints into `ENTRANTS`.
 */
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cpus } from 'node:os';
import { playGame } from './ai-arena';
import { AI_LEVELS } from '../src/game/ai';
import { GAME_AI } from '../src/game/ai-levels';
import { ENTRANTS } from '../src/story/tournament';

interface Job {
  a: string;
  b: string;
  seed: number;
  aFirst: boolean;
}

const SELF = fileURLToPath(import.meta.url);

if (process.env.RATINGS_WORKER === '1') {
  const brain = AI_LEVELS[GAME_AI];
  process.on('message', (jobs: Job[]) => {
    const out: { a: string; b: string; win: string }[] = [];
    for (const j of jobs) {
      const r = playGame({ seed: j.seed, d1: j.aFirst ? j.a : j.b, d2: j.aFirst ? j.b : j.a, a: brain, b: brain, aIsP1: j.aFirst });
      out.push({ a: j.a, b: j.b, win: r.win });
    }
    process.send?.(out);
    process.exit(0);
  });
} else {
  void main();
}

async function main() {
  const games = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 6);
  const flag = process.argv.find((a) => a.startsWith('--workers='));
  const workers = flag ? Number(flag.slice(10)) : Math.max(1, cpus().length - 2);
  const ids = ENTRANTS.map((e) => e.id);
  const jobs: Job[] = [];
  let seed = 9100;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      for (let g = 0; g < games; g++) jobs.push({ a: ids[i], b: ids[j], seed: seed++, aFirst: g % 2 === 0 });
    }
  }
  /* Dealt round-robin so every worker gets a mix of quick and slow matchups. */
  const piles: Job[][] = Array.from({ length: workers }, () => []);
  jobs.forEach((j, k) => piles[k % workers].push(j));
  const started = Date.now();
  console.log(`${jobs.length} games across ${workers} workers…`);
  const results = (
    await Promise.all(
      piles.map(
        (pile) =>
          new Promise<{ a: string; b: string; win: string }[]>((resolve, reject) => {
            const child = fork(SELF, [], { env: { ...process.env, RATINGS_WORKER: '1' }, execArgv: ['--import', 'tsx'] });
            child.on('message', (m) => resolve(m as { a: string; b: string; win: string }[]));
            child.on('error', reject);
            child.send(pile);
          })
      )
    )
  ).flat();

  /* Wins, pair by pair. A draw is half a win each; an unresolved game is nothing. */
  const w = new Map<string, number>();
  const n = new Map<string, number>();
  const key = (a: string, b: string) => `${a}|${b}`;
  for (const r of results) {
    if (r.win === 'none') continue;
    const score = r.win === 'a' ? 1 : r.win === 'b' ? 0 : 0.5;
    w.set(key(r.a, r.b), (w.get(key(r.a, r.b)) ?? 0) + score);
    w.set(key(r.b, r.a), (w.get(key(r.b, r.a)) ?? 0) + (1 - score));
    n.set(key(r.a, r.b), (n.get(key(r.a, r.b)) ?? 0) + 1);
    n.set(key(r.b, r.a), (n.get(key(r.b, r.a)) ?? 0) + 1);
  }

  /* Bradley–Terry by the minorisation–maximisation iteration, with half a game
     of prior against a mean opponent so a deck that won everything still has
     a finite rating. */
  const strength = new Map(ids.map((id) => [id, 1]));
  for (let it = 0; it < 500; it++) {
    for (const i of ids) {
      let wins = 0.5;
      let denom = 1 / (strength.get(i)! + 1);
      for (const j of ids) {
        if (i === j) continue;
        const nij = n.get(key(i, j)) ?? 0;
        if (!nij) continue;
        wins += w.get(key(i, j)) ?? 0;
        denom += nij / (strength.get(i)! + strength.get(j)!);
      }
      strength.set(i, wins / denom);
    }
    const mean = ids.reduce((m, id) => m + Math.log(strength.get(id)!), 0) / ids.length;
    for (const id of ids) strength.set(id, Math.exp(Math.log(strength.get(id)!) - mean));
  }
  const rating = (id: string) => Math.round(1400 + (400 / Math.LN10) * Math.log(strength.get(id)!));
  console.log(`\nplayed in ${((Date.now() - started) / 1000).toFixed(0)}s\n`);
  const rows = ids
    .map((id) => {
      let won = 0;
      let played = 0;
      for (const j of ids) {
        if (j === id) continue;
        won += w.get(key(id, j)) ?? 0;
        played += n.get(key(id, j)) ?? 0;
      }
      return { id, rating: rating(id), won, played };
    })
    .sort((a, b) => b.rating - a.rating);
  for (const r of rows) console.log(`${r.id.padEnd(12)} ${String(r.rating).padStart(5)}   ${r.won}/${r.played}`);
  console.log(`\n${rows.map((r) => `${r.id}: ${r.rating}`).join(', ')}`);
}
