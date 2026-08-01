/**
 * Is the AI *better*, or only different?
 *
 *   git show HEAD:src/game/ai.ts > src/game/ai-baseline.ts
 *   npm run ai-ab -- 300
 *
 * Nothing else in the battery can answer this. `npm run sim` and
 * `npm run deck-bench` put the same brain in both seats, so a change to the AI
 * moves both sides at once and the win rates barely stir. `npm run ai` proves
 * specific positions are played right, which is necessary and not sufficient —
 * a search can start playing a textbook position correctly and lose ground
 * everywhere else.
 *
 * So this plays the working copy against a snapshot of whatever it is replacing,
 * over the same seeds and the same deck pairs from both seats, and prints a 95%
 * interval. Believe the interval: at 300 games it is about ±5.7, so two configs
 * five points apart are the same config.
 *
 * The snapshot is a plain copy of the old `ai.ts` — same directory, so its
 * imports resolve unchanged — and is git-ignored, because it is a build
 * artefact of the comparison and goes stale the moment it is written.
 */
import { fork, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyAction, createDuel } from '../src/game/engine';
import * as WORKING from '../src/game/ai';
import { DUELISTS } from '../src/game/cards';
import type { DuelAction, DuelState, PlayerId } from '../src/game/types';

const SELF = fileURLToPath(import.meta.url);
const BASELINE_PATH = new URL('../src/game/ai-baseline.ts', import.meta.url);

/** The same surface `aiNext` is driven through, from either module. */
type Brain = Pick<typeof WORKING, 'aiNext' | 'invalidatePlan' | 'createAiRuntime'>;

async function loadBaseline(): Promise<Brain> {
  if (!existsSync(BASELINE_PATH)) {
    console.error(
      'No baseline to compare against. Write one first:\n' +
        '  git show HEAD:src/game/ai.ts > src/game/ai-baseline.ts\n' +
        '(or any other revision — it is git-ignored, and only has to compile.)'
    );
    process.exit(1);
  }
  // Resolved through a variable so TypeScript does not demand the file exist at
  // compile time — it is created on demand and never committed.
  const spec = '../src/game/ai-baseline';
  return (await import(spec)) as Brain;
}

interface Job {
  seed: number;
  d1: string;
  d2: string;
  /** true when the working copy sits in the p1 seat. */
  workingIsP1: boolean;
}
type Res = 'working' | 'baseline' | 'draw' | 'none';

async function playGame(job: Job): Promise<Res> {
  const BASELINE = await loadBaseline();
  const { seed, d1, d2, workingIsP1 } = job;
  let state: DuelState = createDuel({ seed, p1: { duelistId: d1, name: 'P1' }, p2: { duelistId: d2, name: 'P2' } });
  const brainFor = (pid: PlayerId): Brain => ((pid === 'p1') === workingIsP1 ? WORKING : BASELINE);
  const rt: Record<PlayerId, { plan: DuelAction[]; key: string }> = {
    p1: WORKING.createAiRuntime(),
    p2: WORKING.createAiRuntime(),
  };

  for (let step = 0; step < 3000 && !state.winner && state.turn <= 60; step++) {
    const actor: PlayerId = state.pending ? state.pending.player : state.active;
    const brain = brainFor(actor);
    const action = brain.aiNext(state, actor, 'champion', rt[actor] as never, 1200);
    if (!action) break;
    let res = applyAction(state, actor, action);
    if (res.error) {
      // Plan went stale against the real position — search again, as the room does.
      brain.invalidatePlan(rt[actor] as never);
      const retry = brain.aiNext(state, actor, 'champion', rt[actor] as never, 1200);
      if (!retry) break;
      res = applyAction(state, actor, retry);
      if (res.error) break;
    }
    state = res.state;
  }

  if (!state.winner) return 'none';
  if (state.winner === 'draw') return 'draw';
  return (state.winner === 'p1') === workingIsP1 ? 'working' : 'baseline';
}

/* ------------------------------------------------------------------ */
/* Worker                                                              */
/* ------------------------------------------------------------------ */

if (process.env.AB_WORKER === '1') {
  const send = process.send?.bind(process);
  // Workers are only ever started by the pool below. Without the channel every
  // result would vanish and the parent would wait for games that never report.
  if (!send) throw new Error('AB_WORKER is set but no IPC channel exists — run scripts/ai-ab.ts directly instead');
  process.on('message', (job: Job | 'stop') => {
    if (job === 'stop') process.exit(0);
    playGame(job)
      .catch((err) => {
        // A crashed game still has to be reported or the pool stalls, but it
        // must not vanish: it lands in the unfinished column and dilutes the
        // sample, so say which job died and why.
        console.error(`[ai-ab] game crashed (seed ${job.seed}, ${job.d1} vs ${job.d2}):`, err);
        return 'none' as Res;
      })
      .then(send);
  });
  send('ready');
}

/* ------------------------------------------------------------------ */
/* Pool                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  const games = Math.max(2, Number(process.argv[2] ?? 200));
  const workers = Math.max(1, Number(process.env.AB_WORKERS ?? 4));
  await loadBaseline(); // fail fast, before forking anything

  const jobs: Job[] = [];
  for (let i = 0; i < Math.round(games / 2); i++) {
    const d1 = DUELISTS[i % DUELISTS.length].id;
    const d2 = DUELISTS[(i * 7 + 4) % DUELISTS.length].id;
    const seed = 70000 + i * 131;
    jobs.push({ seed, d1, d2, workingIsP1: true });
    // Same seed and deck pair, seats swapped, so neither brain gets the better half.
    jobs.push({ seed, d1: d2, d2: d1, workingIsP1: false });
  }
  console.log(`working copy vs src/game/ai-baseline.ts — ${jobs.length} games, ${workers} workers\n`);

  const tally: Record<Res, number> = { working: 0, baseline: 0, draw: 0, none: 0 };
  let next = 0;
  let done = 0;
  const every = Math.max(20, Math.round(jobs.length / 10));

  await new Promise<void>((resolve, reject) => {
    const kids: ChildProcess[] = [];
    let alive = 0;
    const feed = (kid: ChildProcess) => (next < jobs.length ? kid.send(jobs[next++]) : kid.send('stop'));

    for (let i = 0; i < workers; i++) {
      const kid = fork(SELF, [], {
        env: { ...process.env, AB_WORKER: '1' },
        execArgv: ['--import', 'tsx'],
        stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      });
      alive += 1;
      kids.push(kid);
      kid.on('message', (msg: Res | 'ready') => {
        if (msg === 'ready') return feed(kid);
        tally[msg] += 1;
        done += 1;
        if (done % every === 0 || done === jobs.length) process.stderr.write(`  ${done}/${jobs.length} games\n`);
        feed(kid);
      });
      kid.on('exit', (code) => {
        alive -= 1;
        if (code) console.error(`[ai-ab] worker exited with code ${code}`);
        if (alive === 0) {
          // A silently smaller sample still prints a confident-looking interval,
          // which is exactly what this harness exists to avoid.
          if (done < jobs.length) console.error(`[ai-ab] WARNING: ${jobs.length - done} of ${jobs.length} games never ran`);
          resolve();
        }
      });
      kid.once('error', (err) => {
        for (const k of kids) if (k !== kid) k.kill();
        reject(err);
      });
    }
  });

  const total = tally.working + tally.baseline + tally.draw;
  const p = total ? tally.working / total : 0;
  const ci = total ? 1.96 * Math.sqrt((p * (1 - p)) / total) * 100 : 0;
  console.log(
    `\nworking copy: ${(p * 100).toFixed(1)}% ±${ci.toFixed(1)}  ` +
      `(${tally.working}W ${tally.baseline}L ${tally.draw}D${tally.none ? ` ${tally.none}?` : ''}) over ${total} games`
  );
  console.log(
    p * 100 - ci > 50
      ? 'Stronger than the baseline.'
      : p * 100 + ci < 50
        ? 'WEAKER than the baseline.'
        : 'No measurable difference — the interval spans 50%.'
  );
}

if (process.env.AB_WORKER !== '1' && process.argv[1] === SELF) main();
