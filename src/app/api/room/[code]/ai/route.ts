import { StaleRoom, aiSeatToMove, loadRoom, seatFor, stepAI, stepTournament, tournamentPending, viewOf } from '@/server/rooms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/* The search needs room to think; the default 10s would be tight on a busy
   position with the widest level. */
export const maxDuration = 30;

/**
 * Plays one computer action.
 *
 * The client calls this on a timer whenever the view says the computer owes a
 * move, which is what paces the board so a human can follow it. Anyone holding
 * a seat in the room may nudge it — the AI's own move is the only thing that
 * happens, so there is nothing to abuse.
 */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { token?: string };

  /* One retry only. A lost race here just means somebody else already moved
     the duel along, and the search is four seconds of CPU — far better to
     report "nothing moved" and let the poll loop pick it up than to spend it
     twice. */
  try {
    return await handle(code, body.token ?? '');
  } catch (err) {
    if (!(err instanceof StaleRoom)) throw err;
  }
  try {
    return await handle(code, body.token ?? '');
  } catch (err) {
    if (err instanceof StaleRoom) return Response.json({ ok: true, moved: false });
    throw err;
  }
}

async function handle(code: string, token: string) {
  const room = await loadRoom(code);
  if (!room) return Response.json({ ok: false, error: 'Room not found.' }, { status: 404 });
  /* An exhibition is nudged by its audience, who hold no seat. The nudge is
     as harmless as ever — the only thing it can cause is the computer's own
     next move — and viewers see the spectator view, both hands open. */
  if (room.spectate) {
    const moved = await stepAI(room);
    return Response.json({ ok: true, moved, view: viewOf(room, 'p1', true) });
  }
  const pid = seatFor(room, token);
  if (!pid) return Response.json({ ok: false, error: 'You are not in this duel.' }, { status: 403 });

  // The bracket takes priority: once a tournament duel is decided there is no
  // AI move left to make, only a result to record and side matches to play out.
  if (tournamentPending(room)) {
    const moved = await stepTournament(room);
    return Response.json({ ok: true, moved, view: viewOf(room, pid) });
  }
  if (!aiSeatToMove(room)) {
    return Response.json({ ok: true, moved: false, view: viewOf(room, pid) });
  }
  const moved = await stepAI(room);
  return Response.json({ ok: true, moved, view: viewOf(room, pid) });
}
