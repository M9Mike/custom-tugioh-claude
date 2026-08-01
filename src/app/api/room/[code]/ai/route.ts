import { aiSeatToMove, loadRoom, seatFor, stepAI, stepTournament, tournamentPending, viewOf } from '@/server/rooms';

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

  const room = await loadRoom(code);
  if (!room) return Response.json({ ok: false, error: 'Room not found.' }, { status: 404 });
  const pid = seatFor(room, body.token ?? '');
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
