import { canonicalUsername, loadOrCreateProfile } from '@/server/story';
import { describeStoreError } from '@/server/store';
import { readBody } from '../body';
import { stageFor } from '@/story/profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Signs a player into Story Mode.
 *
 * No password yet — see `AUTHORISED` in `src/server/story.ts`. An unknown name
 * is refused with a message that says so, rather than being turned into a new
 * account: there is no registration in the game yet, so the only thing a typo
 * could do is strand a character behind a name nobody meant to type.
 */
export async function POST(req: Request) {
  const body = await readBody(req);
  const canonical = canonicalUsername(body.username);
  if (!canonical) {
    return Response.json(
      { ok: false, error: 'No duelist by that name. Story Mode is not open to new names yet.' },
      { status: 401 }
    );
  }
  try {
    const profile = await loadOrCreateProfile(canonical);
    return Response.json({ ok: true, profile, stage: stageFor(profile) });
  } catch (err) {
    const reason = describeStoreError(err);
    console.error('story login failed:', reason, err);
    return Response.json(
      { ok: false, reason, error: 'Story Mode could not reach its database. Try again in a moment.' },
      { status: 503 }
    );
  }
}
