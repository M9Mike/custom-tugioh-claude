import { canonicalUsername, deleteProfile } from '@/server/story';
import { describeStoreError } from '@/server/store';
import { readBody } from '../body';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Erases an account's whole save — the one way back from a bound duelist.
 *
 * Idempotent by nature: deleting a save that is already gone is the outcome
 * the caller asked for, so a repeat POST answers ok rather than 404. The
 * client treats the answer as "you may now return to the title screen", and
 * the next login walks into the creation booth as on day one.
 */
export async function POST(req: Request) {
  const body = await readBody(req);
  const canonical = canonicalUsername(body.username);
  if (!canonical) return Response.json({ ok: false, error: 'Not signed in.' }, { status: 401 });

  try {
    await deleteProfile(canonical);
    return Response.json({ ok: true });
  } catch (err) {
    const reason = describeStoreError(err);
    console.error('story delete failed:', reason, err);
    return Response.json(
      { ok: false, reason, error: 'Your save could not be deleted. Try again in a moment.' },
      { status: 503 }
    );
  }
}
