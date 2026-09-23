import { canonicalUsername, updateProfile } from '@/server/story';
import { describeStoreError } from '@/server/store';
import { readBody } from '../body';
import { startTournament, tournamentOpen } from '@/story/tournament';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The tournament's two moments that are the player's rather than a duel's.
 *
 * `start` is the broadcast having played. The door is the count — ninety-nine
 * cards — and it is checked here against the save rather than taken on the
 * client's word; a second start is the first one, handed back. `seen` is the
 * finals having been announced, so the announcement plays once on any device.
 *
 * Every chip is written elsewhere, by `/api/story/save` settling a finished
 * duel against the room's verdict: nothing a client says about who won is read
 * anywhere.
 */
export async function POST(req: Request) {
  const body = await readBody(req);
  const canonical = canonicalUsername(body.username);
  if (!canonical) return Response.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  const step = body.step === 'seen' ? 'seen' : 'start';
  try {
    const result = await updateProfile(canonical, (profile) => {
      if (step === 'start') {
        if (profile.tournament) return { ok: true, profile };
        if (!tournamentOpen(profile.collection.length)) {
          return { ok: false, status: 409, error: 'Not yet — the tournament wants ninety-nine cards on your name.' };
        }
        return { ok: true, profile: { ...profile, tournament: startTournament(Date.now()) } };
      }
      const finals = profile.tournament?.finals;
      if (!profile.tournament || !finals || finals.seen) return { ok: true, profile };
      return { ok: true, profile: { ...profile, tournament: { ...profile.tournament, finals: { ...finals, seen: true } } } };
    });
    if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: result.status });
    return Response.json({ ok: true, profile: result.profile });
  } catch (err) {
    const reason = describeStoreError(err);
    console.error('story tournament failed:', reason, err);
    return Response.json({ ok: false, reason, error: 'Could not reach the tournament. Try again in a moment.' }, { status: 503 });
  }
}
