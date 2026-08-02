import {
  StaleRoom,
  chooseDuelist,
  configureAi,
  leaveToLobby,
  loadRoom,
  performAction,
  requestRematch,
  seatFor,
  setName,
  viewOf,
} from '@/server/rooms';
import type { DuelAction } from '@/game/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Body =
  | { kind: 'chooseDuelist'; token: string; duelistId: string }
  | { kind: 'configureAi'; token: string; duelistId?: string }
  | { kind: 'setName'; token: string; name: string }
  | { kind: 'rematch'; token: string }
  | { kind: 'toLobby'; token: string }
  | { kind: 'duel'; token: string; action: DuelAction };

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.token) return Response.json({ ok: false, error: 'Missing token.' }, { status: 400 });

  /* Reload and replay if the room moved underneath us.
   *
   * Every mutation is load -> change -> save, and two interleaving is a lost
   * update — one player's move silently erased by another request that had
   * started earlier. The save is guarded now, so this is where the loser of
   * that race starts again against what is really stored. Replaying is safe
   * because the whole decision is re-made from the reloaded room: a move that
   * is no longer legal comes back as an ordinary refusal.
   */
  for (let attempt = 0; ; attempt++) {
    try {
      return await handle(code, body);
    } catch (err) {
      if (err instanceof StaleRoom && attempt < 4) continue;
      if (err instanceof StaleRoom) {
        return Response.json({ ok: false, error: 'The duel is busy — try that again.' }, { status: 409 });
      }
      throw err;
    }
  }
}

async function handle(code: string, body: Body) {
  const room = await loadRoom(code);
  if (!room) return Response.json({ ok: false, error: 'Room not found.' }, { status: 404 });
  const pid = seatFor(room, body.token);
  if (!pid) return Response.json({ ok: false, error: 'You are not in this duel.' }, { status: 403 });

  let error: string | null = null;
  switch (body.kind) {
    case 'chooseDuelist':
      error = await chooseDuelist(room, pid, body.duelistId);
      break;
    case 'configureAi':
      error = await configureAi(room, body.duelistId);
      break;
    case 'setName':
      await setName(room, pid, body.name);
      break;
    case 'rematch':
      await requestRematch(room, pid);
      break;
    case 'toLobby':
      await leaveToLobby(room);
      break;
    case 'duel':
      error = await performAction(room, pid, body.action);
      break;
    default:
      error = 'Unknown request.';
  }

  return Response.json({ ok: !error, error: error ?? undefined, view: viewOf(room, pid) });
}
