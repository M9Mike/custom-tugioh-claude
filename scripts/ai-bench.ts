/**
 * Fast sanity suite for the AI: hand-built positions with one obviously correct
 * answer, plus a short match against a random player.
 *
 * This is the check to run before committing. It catches an evaluation that
 * scores well in aggregate but plays nonsense in a concrete spot — a win-rate
 * number alone will happily hide "never blocks lethal" behind good luck
 * elsewhere. For statistical strength comparisons use `scripts/ai-arena.ts`.
 *
 *   npx tsx scripts/ai-bench.ts
 */
import { applyAction, createDuel } from '../src/game/engine';
import { aiNext, createAiRuntime, planTurn, type AiLevel } from '../src/game/ai';
import { chooseAction, legalActions } from '../src/game/autoplay';
import { DUELISTS } from '../src/game/cards';
import type { CardInstance, DuelState, PlayerId } from '../src/game/types';

const LEVEL: AiLevel = 'champion';

/* ------------------------------------------------------------------ */
/* Position building                                                   */
/* ------------------------------------------------------------------ */

function position(opts: {
  seed?: number;
  turn?: number;
  phase?: 'main' | 'battle';
  p1?: string;
  p2?: string;
}): DuelState {
  const s = structuredClone(
    createDuel({
      seed: opts.seed ?? 7,
      p1: { duelistId: opts.p1 ?? 'kaiba', name: 'A' },
      p2: { duelistId: opts.p2 ?? 'yugi', name: 'B' },
    })
  );
  s.turn = opts.turn ?? 4;
  s.active = 'p1';
  s.phase = opts.phase ?? 'main';
  s.players.p1.monsters = [null, null, null];
  s.players.p2.monsters = [null, null, null];
  s.players.p1.normalSummonUsed = false;
  return s;
}

/** Puts a specific card on the field, taking it out of that player's deck. */
function place(
  s: DuelState,
  pid: PlayerId,
  zone: number,
  slug: string,
  opts: { position?: 'atk' | 'def'; face?: 'up' | 'down' } = {}
) {
  // Any deck card will do as a donor — it is only here to supply a well-formed
  // instance (uid, owner, counters) whose slug is then overridden. It is
  // deliberately *not* looked up by slug: these positions routinely put a card
  // on a side whose deck never contained it, which is the whole point of being
  // able to build an arbitrary board.
  const donor = s.players[pid].deck.pop();
  if (!donor) throw new Error(`cannot place ${slug}: ${pid}'s deck is empty`);
  const card: CardInstance = {
    ...donor,
    slug,
    owner: pid,
    face: opts.face ?? 'up',
    position: opts.position ?? 'atk',
    summonedOnTurn: 1,
    attacksUsed: 0,
    atkMod: 0,
    defMod: 0,
    turnAtkMod: 0,
    turnDefMod: 0,
    absorbed: [],
    equips: [],
    flags: {},
    turnFlags: {},
  };
  s.players[pid].monsters[zone] = card;
  return card;
}

/** Replaces a hand so the AI's options are exactly what the test intends. */
function setHand(s: DuelState, pid: PlayerId, slugs: string[]) {
  const p = s.players[pid];
  const donors = p.hand.splice(0, p.hand.length);
  p.hand = slugs.map((slug, i) => ({ ...(donors[i] ?? p.deck.pop()!), slug, owner: pid }));
}

/**
 * Plays the AI's whole planned turn out and returns where it ends up.
 *
 * An action that will not apply is a real defect, not something to step over:
 * the search validated every action of this line against this very position, so
 * a rejection means the planner and the engine disagree. Skipping it quietly
 * would let a check pass for the wrong reason.
 */
function playPlan(s: DuelState, pid: PlayerId) {
  const plan = planTurn(s, pid, LEVEL, 3000);
  let cur = s;
  plan.forEach((a, i) => {
    const r = applyAction(cur, pid, a);
    if (r.error) throw new Error(`planned action ${i} (${a.type}) was rejected by the engine: ${r.error}`);
    cur = r.state;
  });
  return { plan, end: cur };
}

/* ------------------------------------------------------------------ */
/* Checks                                                              */
/* ------------------------------------------------------------------ */

let failures = 0;
const check = (ok: boolean, label: string, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail && !ok ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

console.log('Tactical checks\n');

// 1. Lethal is on the board. It must swing for the win rather than build.
{
  const s = position({ p1: 'kaiba', p2: 'yugi' });
  s.players.p2.lp = 1500;
  place(s, 'p1', 0, 'blue-eyes-white-dragon');
  const { end } = playPlan(s, 'p1');
  check(end.winner === 'p1', 'takes lethal with an unblocked 3000 ATK monster vs 1500 LP', `winner=${end.winner}`);
}

// 2. Its monster is far weaker than the only defender. Attacking just loses it.
{
  const s = position({ seed: 9, phase: 'battle', p1: 'joey', p2: 'kaiba' });
  place(s, 'p1', 0, 'baby-dragon');
  const wall = place(s, 'p2', 0, 'blue-eyes-white-dragon');
  const { plan } = playPlan(s, 'p1');
  const suicide = plan.some((a) => a.type === 'attack' && a.targetUid === wall.uid);
  check(!suicide, 'refuses to attack a 3000 ATK wall with a 1200 ATK monster');
}

// 3. A free kill is available: 3000 into a 1200 sitting in Attack Position.
{
  const s = position({ seed: 11, phase: 'battle', p1: 'kaiba', p2: 'joey' });
  place(s, 'p1', 0, 'saggi-the-dark-clown');
  place(s, 'p1', 1, 'blue-eyes-white-dragon');
  const prey = place(s, 'p2', 0, 'baby-dragon');
  const { plan } = playPlan(s, 'p1');
  const killed = plan.some((a) => a.type === 'attack' && a.targetUid === prey.uid);
  check(killed, 'attacks a monster it beats instead of passing');
}

// 4. Facing lethal next turn with a blocker in hand — it must not leave the
//    field empty. This is the case a purely material evaluation gets wrong.
{
  const s = position({ seed: 13, p1: 'joey', p2: 'kaiba' });
  s.players.p1.lp = 2000;
  place(s, 'p2', 0, 'blue-eyes-white-dragon');
  setHand(s, 'p1', ['baby-dragon', 'the-flute-of-summoning-dragon']);
  const { end } = playPlan(s, 'p1');
  const blockers = end.players.p1.monsters.filter(Boolean).length;
  check(blockers > 0, 'summons a blocker rather than passing into lethal', `${blockers} monsters left`);
}

// 5. With the opponent's field empty, a direct attack must happen.
{
  const s = position({ seed: 15, phase: 'battle', p1: 'mai', p2: 'weevil' });
  s.players.p2.lp = 4000;
  place(s, 'p1', 0, 'harpie-lady');
  const { end } = playPlan(s, 'p1');
  check(end.players.p2.lp < 4000, 'attacks directly into an empty field', `opponent still on ${end.players.p2.lp}`);
}

/* ------------------------------------------------------------------ */
/* Sanity match                                                        */
/* ------------------------------------------------------------------ */

let rngState = 20260731;
const rnd = () => {
  rngState = (rngState * 1664525 + 1013904223) >>> 0;
  return rngState / 4294967296;
};

console.log('\nSanity match');
{
  let wins = 0;
  const games = 12;
  for (let i = 0; i < games; i++) {
    let state = createDuel({
      seed: 5000 + i * 97,
      p1: { duelistId: DUELISTS[i % DUELISTS.length].id, name: 'AI' },
      p2: { duelistId: DUELISTS[(i * 3 + 2) % DUELISTS.length].id, name: 'Random' },
    });
    // One search per turn, replayed action by action — the same shape the
    // server uses, and eight times cheaper than re-planning every action.
    const rt = createAiRuntime();
    for (let step = 0; step < 2000 && !state.winner && state.turn <= 40; step++) {
      const actor: PlayerId = state.pending ? state.pending.player : state.active;
      const action =
        actor === 'p1'
          ? aiNext(state, 'p1', LEVEL, rt, 1200)
          : (() => {
              const acts = legalActions(state, actor, rnd);
              return acts.length ? chooseAction(acts, rnd) : null;
            })();
      if (!action) break;
      const r = applyAction(state, actor, action);
      if (r.error) break;
      state = r.state;
    }
    if (state.winner === 'p1') wins += 1;
  }
  check(wins >= games - 2, `beats a random player at least ${games - 2}/${games} times`, `${wins}/${games}`);
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks pass.');
if (failures) process.exitCode = 1;
