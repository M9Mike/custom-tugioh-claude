/**
 * End-to-end test for the vs-computer mode.
 *
 * Drives one real HTTP client exactly as a browser does: open a solo room, pick
 * a duelist, then alternate between playing the human's own moves and nudging
 * `/ai` whenever the room says the computer owes one. Proves the whole loop —
 * seat, routing, per-action stepping, trap windows, rematch — over the wire.
 *
 *   npx tsx scripts/e2e-ai.ts [baseUrl] [rounds] [level]
 */
import { chooseAction, legalActions } from '../src/game/autoplay';
import type { DuelAction, DuelState, PlayerId } from '../src/game/types';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const ROUNDS = Number(process.argv[3] ?? 3);
const LEVEL = process.argv[4] ?? 'champion';

let rngState = 424242;
const rnd = () => {
  rngState = (rngState * 1664525 + 1013904223) >>> 0;
  return rngState / 4294967296;
};

interface RoomView {
  code: string;
  you: PlayerId;
  revision: number;
  stage: 'lobby' | 'duel';
  state: DuelState | null;
  aiToMove?: boolean;
  seats: Record<string, { name: string; duelistId: string | null; connected: boolean; ai?: string } | null>;
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

const roster = ['yugi', 'kaiba', 'joey', 'mai', 'pegasus', 'bakura', 'mako', 'weevil', 'rex', 'keith'];

async function playOne(round: number): Promise<{ ok: boolean; detail: string }> {
  const created = await post<{ code: string; token: string; pid: PlayerId; view: RoomView }>('/api/room', {
    name: 'Mihail',
    vsAi: true,
    level: LEVEL,
  });
  const { code, token } = created;

  // The computer must already be seated and holding a deck.
  const foe: PlayerId = created.pid === 'p1' ? 'p2' : 'p1';
  const aiSeat = created.view.seats[foe];
  if (!aiSeat?.ai) return { ok: false, detail: 'no computer seat in a solo room' };
  if (!aiSeat.duelistId) return { ok: false, detail: 'computer seat has no deck' };

  // Choose the computer's deck too, so the matchup is deterministic per round.
  await post(`/api/room/${code}/act`, {
    kind: 'configureAi',
    token,
    duelistId: roster[(round * 7 + 1) % roster.length],
  });
  const started = await post<{ view: RoomView }>(`/api/room/${code}/act`, {
    kind: 'chooseDuelist',
    token,
    duelistId: roster[(round * 3) % roster.length],
  });

  let view = started.view;
  if (view.stage !== 'duel' || !view.state) {
    return { ok: false, detail: 'duel did not start once the human chose' };
  }

  let steps = 0;
  let aiActions = 0;
  let lastError: string | null = null;
  const me = created.pid;

  for (;;) {
    const cur = view.state;
    if (!cur || cur.winner || steps >= 2000) break;
    steps += 1;

    if (view.aiToMove) {
      const res = await post<{ moved: boolean; view: RoomView }>(`/api/room/${code}/ai`, { token });
      if (!res.moved) return { ok: false, detail: `aiToMove was set but /ai refused to move (turn ${cur.turn})` };
      aiActions += 1;
      view = res.view;
      continue;
    }

    const actor: PlayerId = cur.pending ? cur.pending.player : cur.active;
    if (actor !== me) {
      return { ok: false, detail: `stuck: it is ${actor}'s move but aiToMove is false` };
    }
    const acts = legalActions(cur, me, rnd);
    if (!acts.length) return { ok: false, detail: `no legal actions for the human (phase=${cur.phase})` };
    const action: DuelAction = chooseAction(acts, rnd);
    const res = await post<{ ok: boolean; error?: string; view: RoomView }>(`/api/room/${code}/act`, {
      kind: 'duel',
      token,
      action,
    });
    if (!res.ok) lastError = `${action.type}: ${res.error}`;
    view = res.view;
  }

  const winner = view.state?.winner;

  // A rematch must restart without a second player agreeing to it.
  const after = await post<{ view: RoomView }>(`/api/room/${code}/act`, { kind: 'rematch', token });
  const rematched = after.view.stage === 'duel' && after.view.state?.turn === 1;

  return {
    ok: !!winner && !lastError && aiActions > 0 && rematched,
    detail:
      `winner=${winner ?? 'none'} turns=${view.state?.turn} humanSteps=${steps - aiActions} aiActions=${aiActions} ` +
      `rematch=${rematched ? 'ok' : 'FAILED'}${lastError ? ` LAST_ERROR=${lastError}` : ''}`,
  };
}

const main = async () => {
  console.log(`vs-AI e2e against ${BASE} (level=${LEVEL})`);
  let pass = 0;
  for (let i = 0; i < ROUNDS; i++) {
    const t0 = Date.now();
    try {
      const r = await playOne(i);
      console.log(`${r.ok ? '✅' : '❌'} round ${i + 1}: ${r.detail} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
      if (r.ok) pass += 1;
    } catch (err) {
      console.log(`❌ round ${i + 1}: ${(err as Error).message}`);
    }
  }
  console.log(`\n${pass}/${ROUNDS} rounds passed`);
  if (pass !== ROUNDS) process.exitCode = 1;
};

void main();
