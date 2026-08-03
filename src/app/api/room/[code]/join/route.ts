import { joinRoom, loadRoom, viewOf } from '@/server/rooms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { name?: string; token?: string };
  /* Joining an exhibition never takes a seat — there is none to take, both are
     the computer's. Whoever has the code walks into the audience, which is
     also what lets a second phone watch the same duel. */
  const spectate = await loadRoom(code);
  if (spectate?.spectate) {
    return Response.json({
      ok: true,
      code: spectate.code,
      token: 'spectator',
      pid: 'p1',
      view: viewOf(spectate, 'p1', true),
    });
  }
  const result = await joinRoom(code, body.name ?? '', body.token);
  if (!result.ok) {
    const status = result.reason === 'not-found' ? 404 : 409;
    return Response.json({ ok: false, reason: result.reason }, { status });
  }
  return Response.json({
    ok: true,
    code: result.code,
    token: result.token,
    pid: result.pid,
    view: viewOf(result.room, result.pid),
  });
}
