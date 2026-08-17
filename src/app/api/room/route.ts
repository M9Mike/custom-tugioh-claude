import { createExhibitionRoom, createRoom, createSoloRoom, createStoryRoom, createTournamentRoom, viewOf } from '@/server/rooms';
import { canonicalUsername, loadProfile } from '@/server/story';
import { describeStoreError } from '@/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    vsAi?: boolean;
    /**
     * A duel entered from a conversation in Story Mode.
     *
     * The deck is read from the player's own save rather than accepted from the
     * request. Story Mode has no authentication yet — see `canonicalUsername` —
     * so believing a posted deck would let any caller deal themselves any
     * twenty-five cards, and the save is the one place that already knows which
     * cards this player actually owns.
     */
    storyUser?: string;
    dress?: string;
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
    if (body.storyUser) {
      const canonical = canonicalUsername(body.storyUser);
      if (!canonical) {
        return Response.json({ ok: false, error: 'No duelist by that name.' }, { status: 401 });
      }
      const profile = await loadProfile(canonical);
      if (!profile?.deck?.length) {
        return Response.json(
          { ok: false, error: 'You have no deck to duel with yet.' },
          { status: 409 }
        );
      }
      const { room, token, pid } = await createStoryRoom(
        profile.character?.name ?? canonical,
        profile.deck,
        body.opponentId ?? 'mai',
        body.dress
      );
      return Response.json({ ok: true, code: room.code, token, pid });
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
