import { getRoom, joinRoom, viewOf } from '@/server/rooms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { name?: string; token?: string };
  const result = joinRoom(code, body.name ?? '', body.token);
  if (!result.ok) {
    // 404 specifically means "retry" to the client: the room may live on another
    // warm instance, so it backs off and tries again rather than giving up.
    const status = result.reason === 'not-found' ? 404 : 409;
    return Response.json({ ok: false, reason: result.reason }, { status });
  }
  const room = getRoom(result.code)!;
  return Response.json({
    ok: true,
    code: result.code,
    token: result.token,
    pid: result.pid,
    view: viewOf(room, result.pid),
  });
}
