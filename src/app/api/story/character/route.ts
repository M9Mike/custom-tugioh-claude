import { canonicalUsername, loadOrCreateProfile, saveProfile } from '@/server/story';
import { describeStoreError } from '@/server/store';
import { normaliseCharacter } from '@/story/character';
import { stageFor } from '@/story/profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Locks a character to an account, once and for all.
 *
 * The refusal on line ~40 is the feature, not a guard against a bug: a duelist
 * is made once and then belongs to the name that made it, on every device that
 * name is ever typed on. A second POST is answered with the character that
 * already exists rather than an error the client would have to interpret —
 * whoever asked ends up looking at the right duelist either way.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { username?: string; character?: unknown };
  const canonical = canonicalUsername(body.username ?? '');
  if (!canonical) return Response.json({ ok: false, error: 'Not signed in.' }, { status: 401 });

  try {
    const profile = await loadOrCreateProfile(canonical);
    if (profile.character) {
      return Response.json({ ok: true, locked: true, profile, stage: stageFor(profile) });
    }
    const character = normaliseCharacter(body.character, canonical);
    const next = { ...profile, character };
    await saveProfile(next);
    return Response.json({ ok: true, locked: false, profile: next, stage: stageFor(next) });
  } catch (err) {
    const reason = describeStoreError(err);
    console.error('story character save failed:', reason, err);
    return Response.json(
      { ok: false, reason, error: 'Your duelist could not be saved. Try again in a moment.' },
      { status: 503 }
    );
  }
}
