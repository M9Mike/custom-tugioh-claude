import { canonicalUsername, loadOrCreateProfile, saveProfile } from '@/server/story';
import { describeStoreError } from '@/server/store';
import { stageFor } from '@/story/profile';
import { STARTER_POOL, validateDeck } from '@/story/roster';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Writes a deck, and — the first time — the collection it was cut from.
 *
 * Two different things happen here depending on whether this account has ever
 * had a deck. The first deck is chosen out of the starter pool and *becomes*
 * the collection: what is written back is the 25 cards that went in, and
 * nothing else. Every deck after that is checked against that collection, so
 * the same endpoint serves Edit Deck unchanged once the player owns more than
 * they can field.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { username?: string; deck?: unknown };
  const canonical = canonicalUsername(body.username ?? '');
  if (!canonical) return Response.json({ ok: false, error: 'Not signed in.' }, { status: 401 });

  try {
    const profile = await loadOrCreateProfile(canonical);
    if (!profile.character) {
      return Response.json({ ok: false, error: 'Make your duelist first.' }, { status: 409 });
    }

    const first = profile.deck === null;
    const available = first ? STARTER_POOL : profile.collection;
    const checked = validateDeck(body.deck, available);
    if (!checked.ok) return Response.json({ ok: false, error: checked.reason }, { status: 400 });

    const next = {
      ...profile,
      deck: checked.deck,
      collection: first ? [...checked.deck] : profile.collection,
    };
    await saveProfile(next);
    return Response.json({ ok: true, profile: next, stage: stageFor(next) });
  } catch (err) {
    const reason = describeStoreError(err);
    console.error('story deck save failed:', reason, err);
    return Response.json(
      { ok: false, reason, error: 'Your deck could not be saved. Try again in a moment.' },
      { status: 503 }
    );
  }
}
