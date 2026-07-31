import { createRoom, viewOf } from '@/server/rooms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { name?: string };
  const { room, token, pid } = createRoom(body.name ?? '');
  return Response.json({ ok: true, code: room.code, token, pid, view: viewOf(room, pid) });
}
