/**
 * End-to-end test for tournament mode.
 *
 * Drives a whole bracket the way a browser does: create the room with a chosen
 * duelist, play each round's duel through the action API, and nudge `/ai` for
 * the computer's moves, the recorded results and the simulated side matches
 * alike — they all come through the same endpoint.
 *
 * The "player" plays randomly by default and so usually loses early; pass
 * `--skilled` to have the AI play that seat too, which is what actually
 * exercises the rounds past the first — side matches, the next pairing, the
 * champion screen. Winning and losing are both valid outcomes: what is checked
 * is that the bracket stays coherent (the human is in their own match, rounds
 * shrink 4-2-1) and that the run *ends* rather than getting stuck.
 *
 * Getting stuck is not hypothetical. This test is how the position-change loop
 * was found: a monster could be flipped between Attack and Defence without
 * limit, so a turn of legal moves could go on for ever.
 *
 *   npx tsx scripts/e2e-tournament.ts [baseUrl] [runs] [duelistId] [--skilled]
 */
import { chooseAction, legalActions } from '../src/game/autoplay';
import { aiNext, createAiRuntime, invalidatePlan } from '../src/game/ai';
import { GAME_AI } from '../src/game/ai-levels';
import type { DuelAction, DuelState, PlayerId } from '../src/game/types';
import { bracketSlots, roundsFor, type Tournament } from '../src/server/tournament';
import { DUELISTS } from '../src/game/cards';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const RUNS = Number(process.argv[3] ?? 2);
const AS = process.argv[4] ?? 'yugi';
/* `--skilled` plays the human seat with the same AI the opponents use, so the
   run actually advances and the round-to-round machinery — side matches, the
   next pairing, the champion screen — gets exercised. A random player almost
   always loses in the quarter-final and never reaches any of it. */
const SKILLED = process.argv.includes('--skilled');

let rngState = 20260801;
const rnd = () => {
  rngState = (rngState * 1664525 + 1013904223) >>> 0;
  return rngState / 4294967296;
};

interface RoomView {
  code: string;
  you: PlayerId;
  stage: 'lobby' | 'duel';
  state: DuelState | null;
  aiToMove?: boolean;
  bracketBusy?: boolean;
  tournament?: Tournament;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${path} -> ${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text) as T;
}

function checkBracket(t: Tournament): string | null {
  const slots = t.entrants.length;
  if (slots !== bracketSlots(DUELISTS.length)) {
    return `bracket has ${slots} slots, expected ${bracketSlots(DUELISTS.length)} for ${DUELISTS.length} duelists`;
  }
  const named = t.entrants.filter((e): e is string => !!e);
  // Every duelist on the roster is in the draw, exactly once. This is the whole
  // point of sizing the bracket to the roster rather than fixing it at eight.
  if (named.length !== DUELISTS.length) return `${named.length} duelists drawn, roster has ${DUELISTS.length}`;
  if (new Set(named).size !== named.length) return 'a duelist appears twice in the bracket';
  if (!named.includes(t.humanDuelist)) return 'the human is not in their own bracket';

  const rounds = roundsFor(slots);
  for (let r = 0; r < rounds; r++) {
    const n = t.matches.filter((m) => m.round === r).length;
    if (n && n !== slots >> (r + 1)) return `round ${r} has ${n} matches, expected ${slots >> (r + 1)}`;
    const mine = t.matches.filter((m) => m.round === r && m.human);
    // Once knocked out the player is in no further match, which is correct —
    // their conqueror carries on in that slot.
    const stillIn = r === 0 || t.matches.some((m) => m.round === r - 1 && m.winner === t.humanDuelist);
    if (n && stillIn && mine.length !== 1) return `round ${r} has ${mine.length} matches for the human`;
    if (n && !stillIn && mine.length !== 0) return `round ${r} still claims a match for an eliminated human`;
    for (const m of mine) {
      if (m.a !== t.humanDuelist && m.b !== t.humanDuelist) return `round ${r}: human absent from their own match`;
      // A bye in your own bracket means turning up and watching a screen.
      if (r === 0 && (!m.a || !m.b)) return 'the human was given a bye in the opening round';
    }
  }
  return null;
}

async function playOne(run: number): Promise<{ ok: boolean; detail: string }> {
  const created = await post<{ code: string; token: string; view: RoomView }>('/api/room', {
    name: 'Mihail',
    tournament: true,
    duelistId: AS,
  });
  const { code, token } = created;
  let view = created.view;
  if (!view.tournament) return { ok: false, detail: 'no bracket on a tournament room' };

  const bad0 = checkBracket(view.tournament);
  if (bad0) return { ok: false, detail: bad0 };

  const faced: string[] = [];
  const runtime = createAiRuntime();
  let duels = 0;
  let nudges = 0;
  let rejected = 0;

  for (let guard = 0; guard < 4000; guard++) {
    const t = view.tournament!;
    // Being knocked out is not the end of the run: the bracket plays itself out
    // so the player sees who took it. Keep nudging until someone is crowned.
    if (t.status === 'won' || (t.status === 'eliminated' && t.champion)) break;

    const bad = checkBracket(t);
    if (bad) return { ok: false, detail: `after ${duels} duels: ${bad}` };

    // Anything the bracket or the computer owes goes through the same nudge.
    if (view.bracketBusy || view.aiToMove) {
      const r = await post<{ moved: boolean; view: RoomView }>(`/api/room/${code}/ai`, { token });
      nudges += 1;
      if (!r.moved && !r.view.state?.winner && r.view.tournament?.status === 'resolving') {
        return { ok: false, detail: 'bracket said it was busy but refused to step' };
      }
      view = r.view;
      continue;
    }

    const cur = view.state;
    if (!cur || cur.winner) {
      // Waiting for the server to notice; nudge again.
      const r = await post<{ view: RoomView }>(`/api/room/${code}/ai`, { token });
      nudges += 1;
      view = r.view;
      continue;
    }

    const opp = view.tournament!.matches.find((m) => m.round === view.tournament!.round && m.human);
    const oppId = opp ? (opp.a === AS ? opp.b : opp.a) : null;
    if (oppId && !faced.includes(oppId)) {
      faced.push(oppId);
      duels += 1;
    }

    const actor: PlayerId = cur.pending ? cur.pending.player : cur.active;
    if (actor !== view.you) {
      const r = await post<{ view: RoomView }>(`/api/room/${code}/ai`, { token });
      nudges += 1;
      view = r.view;
      continue;
    }
    let action: DuelAction | null;
    if (SKILLED) {
      action = aiNext(cur, view.you, GAME_AI, runtime, 900);
    } else {
      const acts = legalActions(cur, view.you, rnd);
      if (!acts.length) return { ok: false, detail: 'no legal actions for the human' };
      action = chooseAction(acts, rnd);
    }
    if (!action) return { ok: false, detail: 'no action for the human' };
    const r = await post<{ ok: boolean; error?: string; view: RoomView }>(`/api/room/${code}/act`, {
      kind: 'duel',
      token,
      action,
    });
    if (!r.ok) {
      // A rejected move means the cached plan no longer fits the position. The
      // real client cannot hit this — a person only ever taps legal buttons —
      // but a scripted player must resynchronise or it will offer the same
      // dead action forever, which is exactly how this test used to hang.
      invalidatePlan(runtime);
      rejected += 1;
      if (rejected > 40) return { ok: false, detail: `stuck: ${rejected} moves rejected (last: ${r.error})` };
    }
    view = r.view;
  }

  const t = view.tournament!;
  const ended = t.status === 'won' || t.status === 'eliminated';
  if (new Set(faced).size !== faced.length) return { ok: false, detail: 'faced the same duelist twice' };
  // Either way the bracket must have reached a champion — that is the whole
  // point of playing on past a loss.
  if (!t.champion) return { ok: false, detail: `${t.status} but no champion was crowned` };
  if (t.status === 'won' && t.champion !== t.humanDuelist) {
    return { ok: false, detail: `won the bracket but ${t.champion} is recorded as champion` };
  }
  if (t.matches.some((m) => !m.winner)) return { ok: false, detail: 'the bracket has undecided matches' };
  return {
    ok: ended,
    detail: `as ${AS} → ${t.status} in round ${t.round + 1}/${roundsFor(t.entrants.length)} ` +
      `(champion ${t.champion}; faced ${faced.join(', ') || 'nobody'}; ${duels} duels, ${nudges} nudges` +
      `${rejected ? `, ${rejected} resyncs` : ''})`,
  };
}

const main = async () => {
  console.log(`tournament e2e against ${BASE}${SKILLED ? ' (human seat played by the AI)' : ''}`);
  let pass = 0;
  for (let i = 0; i < RUNS; i++) {
    const t0 = Date.now();
    try {
      const r = await playOne(i);
      console.log(`${r.ok ? '✅' : '❌'} run ${i + 1}: ${r.detail} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
      if (r.ok) pass += 1;
    } catch (err) {
      console.log(`❌ run ${i + 1}: ${(err as Error).message}`);
    }
  }
  console.log(`\n${pass}/${RUNS} runs passed`);
  if (pass !== RUNS) process.exitCode = 1;
};

void main();
