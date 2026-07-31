/**
 * End-to-end test: drives two real HTTP clients against a running server,
 * exactly as two browsers would — create room, join, pick duelists, subscribe to
 * the SSE stream, then play a complete duel through the action API.
 *
 *   npx tsx scripts/e2e.ts [baseUrl] [rounds]
 */
import { chooseAction, legalActions } from '../src/game/autoplay';
import type { DuelAction, DuelState, PlayerId } from '../src/game/types';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const ROUNDS = Number(process.argv[3] ?? 3);

let rngState = 987654321;
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
  seats: Record<string, { name: string; duelistId: string | null; connected: boolean } | null>;
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

async function playOne(round: number): Promise<{ ok: boolean; detail: string }> {
  const created = await post<{ code: string; token: string; pid: PlayerId }>('/api/room', { name: 'Mihail' });
  const code = created.code;
  const joined = await post<{ token: string; pid: PlayerId }>(`/api/room/${code}/join`, { name: 'Sister' });

  const tokens: Record<PlayerId, string> = { p1: created.token, p2: joined.token } as Record<PlayerId, string>;
  const views: Partial<Record<PlayerId, RoomView>> = {};
  let polls = 0;

  const roster = ['yugi', 'kaiba', 'joey', 'mai', 'pegasus', 'bakura', 'mako', 'weevil', 'rex', 'keith'];
  const d1 = roster[(round * 3) % roster.length];
  const d2 = roster[(round * 7 + 1) % roster.length];
  await post(`/api/room/${code}/act`, { kind: 'chooseDuelist', token: tokens.p1, duelistId: d1 });
  const afterBoth = await post<{ view: RoomView }>(`/api/room/${code}/act`, {
    kind: 'chooseDuelist',
    token: tokens.p2,
    duelistId: d2,
  });

  let view: RoomView = afterBoth.view;
  if (view.stage !== 'duel' || !view.state) {
    return { ok: false, detail: 'duel did not start after both players chose' };
  }

  const fetchView = async (pid: PlayerId): Promise<RoomView> => {
    const res = await fetch(`${BASE}/api/room/${code}/state?token=${tokens[pid]}&since=-1`);
    if (!res.ok) throw new Error(`state ${res.status} for ${pid}`);
    const data = (await res.json()) as { view: RoomView };
    polls += 1;
    return data.view;
  };

  let steps = 0;
  let lastError: string | null = null;
  for (;;) {
    const cur: DuelState | null = view.state;
    if (!cur || cur.winner || steps >= 3000) break;
    steps += 1;
    const actor: PlayerId = cur.pending ? cur.pending.player : cur.active;
    // Each client only ever acts from its own view of the room, like a browser.
    const actorView = await fetchView(actor);
    const stateForActor = actorView.state!;
    const acts = legalActions(stateForActor, actor, rnd);
    if (!acts.length) {
      return { ok: false, detail: `no legal actions for ${actor} (phase=${stateForActor.phase}, pending=${!!stateForActor.pending})` };
    }
    const action: DuelAction = chooseAction(acts, rnd);
    const res = await post<{ ok: boolean; error?: string; view: RoomView }>(`/api/room/${code}/act`, {
      kind: 'duel',
      token: tokens[actor],
      action,
    });
    if (!res.ok) lastError = `${action.type}: ${res.error}`;
    view = res.view;
    views[actor] = res.view;
    if ((view.state?.turn ?? 0) > 60) break;
  }

  const winner = view.state?.winner;
  // Both clients must converge on the same room revision once play stops.
  const finalA = await fetchView('p1');
  const finalB = await fetchView('p2');
  const bothSaw = finalA.revision === finalB.revision && finalA.state?.winner === finalB.state?.winner;
  return {
    ok: !!winner && !lastError,
    detail: `${d1} vs ${d2} → winner=${winner ?? 'none'} turns=${view.state?.turn} steps=${steps} polls=${polls} inSync=${bothSaw}${
      lastError ? ` LAST_ERROR=${lastError}` : ''
    }`,
  };
}

const main = async () => {
  console.log(`e2e against ${BASE}`);
  let pass = 0;
  for (let i = 0; i < ROUNDS; i++) {
    try {
      const r = await playOne(i);
      console.log(`${r.ok ? '✅' : '❌'} round ${i + 1}: ${r.detail}`);
      if (r.ok) pass += 1;
    } catch (err) {
      console.log(`❌ round ${i + 1}: ${(err as Error).message}`);
    }
  }
  console.log(`\n${pass}/${ROUNDS} rounds passed`);
  if (pass !== ROUNDS) process.exitCode = 1;
};

void main();
