import { createExhibitionRoom, createRoom, createSoloRoom, createTournamentRoom, viewOf } from '@/server/rooms';
import { describeStoreError } from '@/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    vsAi?: boolean;
    tournament?: boolean;
    spectate?: boolean;
    duelistId?: string;
    opponentId?: string;
    duelistA?: string;
    duelistB?: string;
  };
  try {
    if (body.spectate) {
      // An exhibition seats nobody: the creator gets the code and a front-row
      // view, and the 'spectator' token is a placeholder the routes ignore.
      const { room } = await createExhibitionRoom(body.duelistA ?? '', body.duelistB ?? '');
      return Response.json({ ok: true, code: room.code, token: 'spectator', pid: 'p1', view: viewOf(room, 'p1', true) });
    }
    const { room, token, pid } = body.tournament
      ? await createTournamentRoom(body.name ?? '', body.duelistId ?? '')
      : body.vsAi
        ? await createSoloRoom(body.name ?? '', body.opponentId)
        : await createRoom(body.name ?? '');
    return Response.json({ ok: true, code: room.code, token, pid, view: viewOf(room, pid) });
  } catch (err) {
    const reason = describeStoreError(err);
    console.error('createRoom failed:', reason, err);
    return Response.json(
      { ok: false, reason, error: 'The duel server could not reach its database. Check MONGODB_URI.' },
      { status: 503 }
    );
  }
}
