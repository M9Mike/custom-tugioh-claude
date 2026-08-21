/**
 * Two requests must never be able to undo each other.
 *
 *   npx tsx scripts/race-check.ts
 *
 * Every mutation in `rooms.ts` is load -> change -> save, which without a guard
 * is a plain lost update. It was not theoretical: the *poll* endpoint called
 * `touch`, which wrote the entire room — duel included — back from whatever
 * snapshot the poll had loaded, every eight seconds, per player. It went
 * through `writeJson` rather than `saveRoom`, so it did not even bump
 * `revision` and nothing downstream could tell.
 *
 * What that looked like from a phone, all reported from real duels:
 *
 *   "I summoned harpie lady and destroyed the ai's negate attack and it
 *    returned my harpie to the hand and re set their negate attack"
 *
 *   "I click the atk button from curse of dragon and when I select the enemy
 *    monster I see a banner you must be in the battle phase (obviously I am
 *    in it)"
 *
 * — the first is the write landing on top of a summon, the second is the same
 * write rolling the phase back to Main while the client, which correctly
 * refuses a view older than the one on screen, kept showing the Battle Phase.
 * It gets worse the longer a room lives, because it is a rate rather than an
 * event, which is why it looked like it was about rematches.
 *
 * This runs against the in-process memory backend, which implements the same
 * compare-and-set as MongoDB.
 */
import {
  StaleRoom,
  chooseDuelist,
  createSoloRoom,
  createTournamentRoom,
  loadRoom,
  performAction,
  requestRematch,
  stepAI,
  stepSideDuels,
  touch,
} from '../src/server/rooms';
import { legalActions } from '../src/game/autoplay';
import type { DuelState, PlayerId } from '../src/game/types';

let failures = 0;
function ok(pass: boolean, label: string, detail = '') {
  console.log(`  ${pass ? '✅' : '❌'} ${label}${!pass && detail ? ` — ${detail}` : ''}`);
  if (!pass) failures += 1;
}

/** A fingerprint of everything a player would see on the board. */
const boardOf = (s: DuelState) =>
  JSON.stringify(['p1', 'p2'].map((id) => {
    const p = s.players[id as PlayerId];
    return [p.lp, p.hand.length, p.grave.length, p.monsters.map((m) => m?.slug ?? '-'), p.spellTrap?.slug ?? '-', p.field?.slug ?? '-'];
  }).concat([[s.turn, s.phase, s.active, s.log.length] as never]));

/** A duel in progress, with the human to move. */
async function startedRoom(): Promise<string> {
  const { room, pid } = await createSoloRoom('Tester', 'yugi');
  await chooseDuelist(room, pid, 'kaiba');
  // Whoever goes first is a coin flip; let the computer play until it is ours.
  for (let i = 0; i < 40; i++) {
    const cur = await loadRoom(room.code);
    if (!cur?.state || cur.state.winner) break;
    if (cur.state.active === 'p1' && !cur.state.pending) break;
    if (!(await stepAI(cur))) break;
  }
  return room.code;
}

const rnd = () => 0.5;
function aMove(state: DuelState, pid: PlayerId) {
  const acts = legalActions(state, pid, rnd);
  // Something that visibly changes the board, not just a pass.
  return acts.find((a) => a.type === 'normalSummon') ?? acts.find((a) => a.type === 'setSpellTrap') ?? acts[0];
}

async function main() {
console.log('Room concurrency\n');

/* 1. The reported rewind: a poll that started before a move must not undo it. */
{
  const code = await startedRoom();
  const snapshot = await loadRoom(code); // the poll's copy, loaded first
  const acting = await loadRoom(code);
  const move = aMove(acting!.state!, 'p1');
  const err = await performAction(acting!, 'p1', move);
  ok(!err, 'the move is accepted', err ?? '');
  const afterMove = await loadRoom(code);
  const boardAfterMove = boardOf(afterMove!.state!);
  ok(boardOf(snapshot!.state!) !== boardAfterMove, 'and the snapshot really is out of date', 'the probe proves nothing otherwise');

  /* The old `touch` only wrote once the timestamp was eight seconds stale, so
     a snapshot taken moments ago never triggered it and this check passed
     happily on the broken code. Age it first. */
  snapshot!.seats.p1!.lastSeen = Date.now() - 30_000;
  await touch(snapshot!, 'p1');

  const now = await loadRoom(code);
  ok(boardOf(now!.state!) === boardAfterMove, 'a poll cannot roll the duel back', `board is ${boardOf(now!.state!) === boardOf(snapshot!.state!) ? 'the snapshot again' : 'something else'}`);
  ok(now!.revision >= afterMove!.revision, 'and cannot roll the revision back either', `revision ${now!.revision}, was ${afterMove!.revision}`);
}

/* 2. And any other stale writer is refused outright rather than clobbering. */
{
  const code = await startedRoom();
  const stale = await loadRoom(code);
  const fresh = await loadRoom(code);
  /* A legal move, asserted as accepted. Written as "Set the first card in
     hand" this was refused whenever that card was a monster — no save, so the
     revision never moved, so the stale copy below was still current and both
     assertions failed for a reason that had nothing to do with the guard. */
  const winnerErr = await performAction(fresh!, 'p1', aMove(fresh!.state!, 'p1'));
  ok(!winnerErr, 'the winner of the race moves first', winnerErr ?? '');
  const winner = await loadRoom(code);
  const boardAfterMove = boardOf(winner!.state!);

  let threw = false;
  try {
    await performAction(stale!, 'p1', aMove(stale!.state!, 'p1'));
  } catch (e) {
    threw = e instanceof StaleRoom;
  }
  ok(threw, 'a save from a stale copy is refused');
  const now = await loadRoom(code);
  ok(boardOf(now!.state!) === boardAfterMove, 'and the duel is exactly as the winner of the race left it');
}

/* 3. A rematch is a new duel, and must leave nothing of the old one behind. */
{
  const code = await startedRoom();
  const room = await loadRoom(code);
  // Hand the duel to somebody so a rematch is allowed.
  room!.state!.winner = 'p1';
  room!.aiActions = { key: 'stale', count: 59 };
  room!.aiPlan = { key: 'stale', actions: [{ type: 'endTurn' }] };
  const firstDuel = room!.state!.duelId;
  await requestRematch(room!, 'p1');

  const after = await loadRoom(code);
  ok(!!after!.state && !after!.state.winner, 'the rematch starts a fresh duel');
  ok(after!.aiPlan === undefined, "the computer's leftover plan is dropped");
  ok(after!.aiActions === undefined, 'and so is its action count');
  ok(!!after!.state!.duelId && after!.state!.duelId !== firstDuel, 'the new duel has its own identity', `${firstDuel} -> ${after!.state!.duelId}`);

  /* The identity is the real guard. Keyed by turn and seat alone, the new
     duel's turn 3 was the old duel's turn 3, so the count carried straight
     over — and once it crossed the 60-action ceiling the computer began
     abandoning that turn the moment it reached it. "The more rematches, the
     more bugs happen" was this. */
  const a = await startedRoom();
  const b = await startedRoom();
  const ra = await loadRoom(a);
  const rb = await loadRoom(b);
  ok(ra!.state!.duelId !== rb!.state!.duelId, 'two duels never share an identity', `${ra!.state!.duelId} vs ${rb!.state!.duelId}`);
}

/* 4. The bracket's side matches play in the background — racing nudges settle
      to one winner, and none of it can trample the human's live duel. */
{
  const { room } = await createTournamentRoom('Racer', 'yugi');
  const code = room.code;
  // Whoever goes first is a coin flip; let the computer play until it is ours.
  for (let i = 0; i < 40; i++) {
    const cur = await loadRoom(code);
    if (!cur?.state || cur.state.winner) break;
    if (cur.state.active === 'p1' && !cur.state.pending) break;
    if (!(await stepAI(cur))) break;
  }
  const live = await loadRoom(code);
  ok(!!live?.state && !live.state.winner && live.state.active === 'p1', 'the tournament duel is live with the human to move');

  /* Two nudges race the same slice; the route retries StaleRoom, so a test
     nudge treats it as "nothing moved" exactly as production does. */
  const nudge = async (budget: number) => {
    const copy = await loadRoom(code);
    if (!copy) return false;
    try {
      return await stepSideDuels(copy, budget, 120);
    } catch (e) {
      if (e instanceof StaleRoom) return false;
      throw e;
    }
  };
  const [a, b] = await Promise.all([nudge(150), nudge(150)]);
  ok(a || b, 'a background nudge advances a side match');

  /* A copy from before the human's next move, held back and replayed at the
     very end: a resolver that writes its own stale room instead of reloading
     would put this old board back on the table. */
  const ancient = await loadRoom(code);

  // The human plays on while the bracket resolves underneath.
  const mid = await loadRoom(code);
  const err = await performAction(mid!, 'p1', aMove(mid!.state!, 'p1'));
  ok(!err, 'the human moves while the bracket resolves', err ?? '');
  const humanBoard = boardOf((await loadRoom(code))!.state!);

  // Drive the first side match to its end with pairs of racing nudges.
  const firstOpen = () => {
    return loadRoom(code).then((r) => {
      const t = r!.tournament!;
      return t.matches.find((m) => m.round === t.round && !m.human && !m.winner && m.a && m.b);
    });
  };
  const target = await firstOpen();
  ok(!!target, 'a real side match is on the card');
  for (let i = 0; i < 300 && (await firstOpen())?.slot === target?.slot; i++) {
    await Promise.all([nudge(400), nudge(400)]);
  }
  const after = (await loadRoom(code))!;
  const settled = after.tournament!.matches.find((m) => m.round === target!.round && m.slot === target!.slot)!;
  ok(!!settled.winner && [settled.a, settled.b].includes(settled.winner), 'racing nudges settle the match to exactly one of its two duelists', settled.winner ?? '(none)');
  ok(boardOf(after.state!) === humanBoard, "and the human's board is exactly as they left it");

  // The held-back ancient copy finally takes its turn — and must change nothing.
  try {
    await stepSideDuels(ancient!, 400, 120);
  } catch (e) {
    if (!(e instanceof StaleRoom)) throw e;
  }
  const end = (await loadRoom(code))!;
  const still = end.tournament!.matches.find((m) => m.round === target!.round && m.slot === target!.slot)!;
  ok(boardOf(end.state!) === humanBoard, 'a resolver holding an ancient room cannot roll the duel back');
  ok(still.winner === settled.winner, 'nor un-decide a settled match', `${settled.winner} -> ${still.winner ?? '(none)'}`);
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nRooms cannot be raced into an earlier state. ✅');
process.exitCode = failures ? 1 : 0;
}

void main();
