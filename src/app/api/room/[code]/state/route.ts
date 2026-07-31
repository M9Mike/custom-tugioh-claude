import { getRoom, seatFor, touch, viewOf } from '@/server/rooms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Polling fallback used alongside the SSE stream, so a dropped stream never
 *  leaves a player staring at a stale board. */
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const url = new URL(req.url);
  const token = url.searchParams.get('token') ?? '';
  const since = Number(url.searchParams.get('since') ?? '-1');

  const room = getRoom(code);
  if (!room) return Response.json({ ok: false, reason: 'not-found' }, { status: 404 });
  const pid = seatFor(room, token);
  if (!pid) return Response.json({ ok: false, reason: 'bad-token' }, { status: 403 });
  touch(room, pid);

  if (room.revision === since) return Response.json({ ok: true, unchanged: true, revision: room.revision });
  return Response.json({ ok: true, view: viewOf(room, pid) });
}
