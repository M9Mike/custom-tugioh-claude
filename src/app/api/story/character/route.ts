import { canonicalUsername, updateProfile } from '@/server/story';
import { describeStoreError } from '@/server/store';
import { normaliseCharacter } from '@/story/character';
import { readBody } from '../body';
import { stageFor } from '@/story/profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Locks a character to an account, once and for all.
 *
 * The refusal below is the feature, not a guard against a bug: a duelist is
 * made once and then belongs to the name that made it, on every device that
 * name is ever typed on. A second POST is answered with the character that
 * already exists rather than an error the client would have to interpret —
 * whoever asked ends up looking at the right duelist either way.
 *
 * The check runs *inside* `updateProfile`, so it is re-run against a fresh read
 * on every retry. Two requests racing to create a character therefore cannot
 * both pass it: the loser re-reads, finds a character, and hands that one back.
 */
export async function POST(req: Request) {
  const body = await readBody(req);
  const canonical = canonicalUsername(body.username);
  if (!canonical) return Response.json({ ok: false, error: 'Not signed in.' }, { status: 401 });

  try {
    let locked = false;
    const result = await updateProfile(canonical, (profile) => {
      if (profile.character) {
        locked = true;
        return { ok: true, profile };
      }
      locked = false;
      return { ok: true, profile: { ...profile, character: normaliseCharacter(body.character, canonical) } };
    });
    if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: result.status });
    return Response.json({ ok: true, locked, profile: result.profile, stage: stageFor(result.profile) });
  } catch (err) {
    const reason = describeStoreError(err);
    console.error('story character save failed:', reason, err);
    return Response.json(
      { ok: false, reason, error: 'Your duelist could not be saved. Try again in a moment.' },
      { status: 503 }
    );
  }
}
