import { loadRoom, seatFor, touch, viewOf } from '@/server/rooms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The only channel the clients need: poll for the current room, and skip the
 *  payload entirely when nothing has changed since the caller's revision. */
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const url = new URL(req.url);
  const token = url.searchParams.get('token') ?? '';
  const since = Number(url.searchParams.get('since') ?? '-1');

  const room = await loadRoom(code);
  if (!room) return Response.json({ ok: false, reason: 'not-found' }, { status: 404 });
  // An exhibition has no seat to protect and no secrets — both hands are shown
  // to the audience by design — so the code alone admits a viewer.
  if (room.spectate) {
    if (room.revision === since) {
      return Response.json({ ok: true, unchanged: true, revision: room.revision });
    }
    return Response.json({ ok: true, view: viewOf(room, 'p1', true) });
  }
  const pid = seatFor(room, token);
  if (!pid) return Response.json({ ok: false, reason: 'bad-token' }, { status: 403 });

  await touch(room, pid);
  if (room.revision === since) {
    return Response.json({ ok: true, unchanged: true, revision: room.revision });
  }
  return Response.json({ ok: true, view: viewOf(room, pid) });
}
