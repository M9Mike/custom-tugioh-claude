import {
  chooseDuelist,
  getRoom,
  leaveToLobby,
  performAction,
  requestRematch,
  seatFor,
  setName,
  touch,
  viewOf,
} from '@/server/rooms';
import type { DuelAction } from '@/game/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Body =
  | { kind: 'chooseDuelist'; token: string; duelistId: string }
  | { kind: 'setName'; token: string; name: string }
  | { kind: 'rematch'; token: string }
  | { kind: 'toLobby'; token: string }
  | { kind: 'duel'; token: string; action: DuelAction };

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.token) return Response.json({ ok: false, error: 'Missing token.' }, { status: 400 });

  const room = getRoom(code);
  if (!room) return Response.json({ ok: false, error: 'Room not found.' }, { status: 404 });
  const pid = seatFor(room, body.token);
  if (!pid) return Response.json({ ok: false, error: 'You are not in this duel.' }, { status: 403 });
  touch(room, pid);

  let error: string | null = null;
  switch (body.kind) {
    case 'chooseDuelist':
      error = chooseDuelist(room, pid, body.duelistId);
      break;
    case 'setName':
      setName(room, pid, body.name);
      break;
    case 'rematch':
      requestRematch(room, pid);
      break;
    case 'toLobby':
      leaveToLobby(room, pid);
      break;
    case 'duel':
      error = performAction(room, pid, body.action);
      break;
    default:
      error = 'Unknown request.';
  }

  return Response.json({ ok: !error, error: error ?? undefined, view: viewOf(room, pid) });
}
