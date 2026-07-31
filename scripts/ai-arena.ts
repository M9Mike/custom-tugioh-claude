/**
 * Parallel arena for AI configs.
 *
 * The single-process bench could only afford ~30 games per matchup, which gives
 * a 95% confidence interval of roughly ±18% — wide enough to swallow any real
 * difference between two configs. This forks one worker per core and streams
 * games to them, so a matchup can be several hundred games and the numbers mean
 * something.
 *
 *   npx tsx scripts/ai-arena.ts              # default suite
 *   npx tsx scripts/ai-arena.ts --games 400
 */
import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { applyAction, createDuel } from '../src/game/engine';
import { aiNext, createAiRuntime, invalidatePlan, AI_LEVELS, LEGACY_WEIGHTS, type AiConfig } from '../src/game/ai';
import { chooseAction, legalActions } from '../src/game/autoplay';
import { DUELISTS } from '../src/game/cards';
import type { DuelAction, DuelState, PlayerId } from '../src/game/types';

const SELF = fileURLToPath(import.meta.url);

export type Brain = AiConfig | 'random';

export interface Job {
  seed: number;
  d1: string;
  d2: string;
  a: Brain;
  b: Brain;
  /** true when `a` sits in the p1 seat. */
  aIsP1: boolean;
}

export interface Result {
  win: 'a' | 'b' | 'draw' | 'none';
  turns: number;
  thinkMs: number;
  decisions: number;
}

/* ------------------------------------------------------------------ */
/* One game                                                            */
/* ------------------------------------------------------------------ */

export function playGame(job: Job): Result {
  const { seed, d1, d2, a, b, aIsP1 } = job;
  const brains: Record<PlayerId, Brain> = aIsP1 ? { p1: a, p2: b } : { p1: b, p2: a };
  let state: DuelState = createDuel({
    seed,
    p1: { duelistId: d1, name: 'P1' },
    p2: { duelistId: d2, name: 'P2' },
  });
  const rt = { p1: createAiRuntime(), p2: createAiRuntime() };

  // Deterministic per-game stream for the `random` brain, so a rerun repeats.
  let rngState = (seed * 2654435761) >>> 0;
  const rnd = () => {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 4294967296;
  };

  let thinkMs = 0;
  let decisions = 0;

  for (let step = 0; step < 3000 && !state.winner && state.turn <= 60; step++) {
    const actor: PlayerId = state.pending ? state.pending.player : state.active;
    const brain = brains[actor];
    let action: DuelAction | null;
    if (brain === 'random') {
      const acts = legalActions(state, actor, rnd);
      action = acts.length ? chooseAction(acts, rnd) : null;
    } else {
      const t0 = Date.now();
      action = aiNext(state, actor, brain, rt[actor], 1500);
      thinkMs += Date.now() - t0;
      decisions += 1;
    }
    if (!action) break;
    let next = apply(state, actor, action);
    if (!next && brain !== 'random') {
      // Plan went stale against the real position — search again.
      invalidatePlan(rt[actor]);
      const retry = aiNext(state, actor, brain, rt[actor], 1500);
      next = retry ? apply(state, actor, retry) : null;
    }
    if (!next) break;
    state = next;
  }

  const win: Result['win'] = !state.winner
    ? 'none'
    : state.winner === 'draw'
      ? 'draw'
      : (state.winner === 'p1') === aIsP1
        ? 'a'
        : 'b';
  return { win, turns: state.turn, thinkMs, decisions };
}

function apply(state: DuelState, pid: PlayerId, action: DuelAction) {
  const res = applyAction(state, pid, action);
  return res.error ? null : res.state;
}

/* ------------------------------------------------------------------ */
/* Worker                                                              */
/* ------------------------------------------------------------------ */

if (process.env.ARENA_WORKER === '1') {
  // Workers are only ever started by the pool below, via fork() with an IPC
  // channel. If that channel is missing something has gone wrong with how this
  // was launched, and saying so immediately beats the alternative: quietly
  // dropping every result and leaving the parent waiting for games that will
  // never be reported.
  const send = process.send?.bind(process);
  if (!send) throw new Error('ARENA_WORKER is set but no IPC channel exists — run scripts/ai-arena.ts directly instead');

  process.on('message', (job: Job | 'stop') => {
    if (job === 'stop') process.exit(0);
    let out: Result;
    try {
      out = playGame(job);
    } catch (err) {
      // A crashed game still has to be reported or the pool would stall, but it
      // must not vanish: it lands in the unfinished column and dilutes the
      // sample, so say loudly which job died and why.
      console.error(`[arena] game crashed (seed ${job.seed}, ${job.d1} vs ${job.d2}):`, err);
      out = { win: 'none', turns: 0, thinkMs: 0, decisions: 0 };
    }
    send(out);
  });
  send('ready');
}

/* ------------------------------------------------------------------ */
/* Pool                                                                */
/* ------------------------------------------------------------------ */

interface Tally {
  a: number;
  b: number;
  draw: number;
  none: number;
  turns: number;
  thinkMs: number;
  decisions: number;
}

async function runJobs(jobs: Job[], workers: number, onProgress?: (done: number) => void): Promise<Tally> {
  const t: Tally = { a: 0, b: 0, draw: 0, none: 0, turns: 0, thinkMs: 0, decisions: 0 };
  let next = 0;
  let done = 0;

  await new Promise<void>((resolve, reject) => {
    const kids: ChildProcess[] = [];
    let alive = 0;

    // A worker only gets its next job when it reports the last one, so one that
    // wedges mid-game is never spoken to again and the whole run waits on it
    // forever with nothing on screen. The watchdog turns that into a dead
    // worker and a warning about the games it took down with it. The default is
    // deliberately generous: a full-depth mirror match is seconds, not minutes.
    const JOB_TIMEOUT_MS = Number(process.env.ARENA_JOB_TIMEOUT_MS ?? 180_000);
    const watchdogs = new Map<ChildProcess, NodeJS.Timeout>();

    const clearWatch = (kid: ChildProcess) => {
      const timer = watchdogs.get(kid);
      if (timer) clearTimeout(timer);
      watchdogs.delete(kid);
    };
    const armWatch = (kid: ChildProcess, what: string) => {
      clearWatch(kid);
      const timer = setTimeout(() => {
        console.error(`[arena] worker ${kid.pid} stopped responding during ${what} — killing it`);
        kid.kill();
      }, JOB_TIMEOUT_MS);
      timer.unref();
      watchdogs.set(kid, timer);
    };

    const feed = (kid: ChildProcess) => {
      if (next >= jobs.length) {
        clearWatch(kid);
        kid.send('stop');
        return;
      }
      kid.send(jobs[next++]);
      armWatch(kid, 'a game');
    };

    for (let i = 0; i < workers; i++) {
      const kid = fork(SELF, [], {
        env: { ...process.env, ARENA_WORKER: '1' },
        execArgv: ['--import', 'tsx'],
        stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      });
      alive += 1;
      kids.push(kid);
      armWatch(kid, 'start-up');
      kid.on('message', (msg: Result | 'ready') => {
        if (msg === 'ready') {
          feed(kid);
          return;
        }
        t[msg.win] += 1;
        t.turns += msg.turns;
        t.thinkMs += msg.thinkMs;
        t.decisions += msg.decisions;
        done += 1;
        onProgress?.(done);
        feed(kid);
      });
      kid.on('exit', (code) => {
        clearWatch(kid);
        alive -= 1;
        // A worker that dies mid-job takes that game with it. Say so — a
        // silently smaller sample still prints a confident-looking interval,
        // which is exactly the trap this harness exists to avoid.
        if (code) console.error(`[arena] worker exited with code ${code}`);
        if (alive === 0) {
          const missing = jobs.length - done;
          if (missing > 0) console.error(`[arena] WARNING: ${missing} of ${jobs.length} games never ran`);
          resolve();
        }
      });
      kid.once('error', (err) => {
        clearWatch(kid);
        // `reject` settles the run, so the parent fails loudly rather than
        // hanging — but the siblings would carry on burning CPU on results
        // nobody is listening for any more. Take them down with it.
        for (const k of kids) if (k !== kid) k.kill();
        reject(err);
      });
    }
  });

  return t;
}

/* ------------------------------------------------------------------ */
/* Matchups                                                            */
/* ------------------------------------------------------------------ */

/** Builds a mirrored job list: every seed/deck pair is played from both seats. */
export function pairing(a: Brain, b: Brain, pairs: number, seedBase = 90000): Job[] {
  const jobs: Job[] = [];
  for (let i = 0; i < pairs; i++) {
    const d1 = DUELISTS[i % DUELISTS.length].id;
    const d2 = DUELISTS[(i * 7 + 4) % DUELISTS.length].id;
    const seed = seedBase + i * 131;
    jobs.push({ seed, d1, d2, a, b, aIsP1: true });
    // Same seed and same deck pair, seats and decks swapped.
    jobs.push({ seed, d1: d2, d2: d1, a, b, aIsP1: false });
  }
  return jobs;
}

export function report(label: string, t: Tally) {
  const total = t.a + t.b + t.draw;
  const p = total ? t.a / total : 0;
  const ci = total ? 1.96 * Math.sqrt((p * (1 - p)) / total) * 100 : 0;
  const played = total + t.none;
  console.log(
    `${label.padEnd(34)} ${(p * 100).toFixed(1).padStart(5)}% ±${ci.toFixed(1).padStart(4)}  ` +
      `(${t.a}W ${t.b}L ${t.draw}D${t.none ? ` ${t.none}?` : ''})  ` +
      `${(t.turns / Math.max(1, played)).toFixed(1)} turns  ` +
      `${(t.thinkMs / Math.max(1, t.decisions)).toFixed(0)}ms/dec`
  );
  return { pct: p * 100, ci, total };
}

export async function arena(label: string, a: Brain, b: Brain, pairs: number, workers = 4, seedBase = 90000) {
  const jobs = pairing(a, b, pairs, seedBase);
  // Long matchups used to print nothing at all until they finished, which makes
  // a slow run indistinguishable from a stuck one. Tick on stderr so the result
  // lines on stdout stay clean and greppable.
  const every = Math.max(20, Math.round(jobs.length / 10));
  const t = await runJobs(jobs, workers, (n) => {
    if (n % every === 0 || n === jobs.length) process.stderr.write(`  ${label}: ${n}/${jobs.length} games\n`);
  });
  return report(label, t);
}

/* ------------------------------------------------------------------ */
/* Default suite                                                       */
/* ------------------------------------------------------------------ */

/** Reads a positive numeric flag, refusing anything that is not one. */
function readCount(flag: string, fallback: number): number {
  const at = process.argv.indexOf(flag);
  if (at < 0) return fallback;
  const n = Number(process.argv[at + 1]);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`${flag} needs a positive number, e.g. ${flag} 400 — got ${process.argv[at + 1] ?? '(nothing)'}`);
    process.exit(1);
  }
  return n;
}

async function main() {
  // A bad --games value used to fall through as NaN, which made `pairing()`
  // build zero jobs and the run print a confident-looking 0% off no games at
  // all. Refuse it instead.
  const games = readCount('--games', 200);
  const pairs = Math.max(1, Math.round(games / 2));
  const workers = Math.max(1, Number(process.env.ARENA_WORKERS ?? 4));

  console.log(`Arena — ${pairs * 2} games per matchup, ${workers} workers\n`);

  const champ = AI_LEVELS.champion;
  const duelist = AI_LEVELS.duelist;
  const rookie = AI_LEVELS.rookie;
  const greedy: AiConfig = { beam: 1, branch: 8, slack: 0, depth: 0 };
  const legacy: AiConfig = { ...champ, weights: LEGACY_WEIGHTS };

  // Does looking further ahead actually pay? Same width, different depth.
  const flat: AiConfig = { ...champ, depth: 0 };
  const oneTurn: AiConfig = { ...champ, depth: 1 };
  const only = process.argv.includes('--depth-only');
  await arena('champion(d3) vs same width d1', champ, oneTurn, pairs, workers);
  if (only) return;
  await arena('champion(d3) vs same width d0', champ, flat, pairs, workers);
  console.log('');
  await arena('race-eval vs legacy-eval', champ, legacy, pairs, workers);
  await arena('champion  vs greedy', champ, greedy, pairs, workers);
  await arena('champion  vs duelist', champ, duelist, pairs, workers);
  await arena('champion  vs rookie', champ, rookie, pairs, workers);
  await arena('champion  vs random', champ, 'random', pairs, workers);
}

// Run the suite only when this file is what was invoked, not when another
// script imports `arena()`. Compared by resolved path rather than by filename
// suffix, which would also fire for anything else ending in ai-arena.ts.
if (process.env.ARENA_WORKER !== '1' && process.argv[1] === SELF) {
  main();
}
