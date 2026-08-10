import { canonicalUsername, updateProfile } from '@/server/story';
import { describeStoreError } from '@/server/store';
import { readBody } from '../body';
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
 *
 * That the collection is the deck rather than the pool is the point and not an
 * oversight — see the note on `collection` in `src/story/profile.ts`. It does
 * mean Edit Deck can currently only reorder the same 25 cards, which is the
 * correct consequence of owning exactly 25.
 *
 * Both the pool decision and the validation run inside `updateProfile`, so they
 * are re-made against a fresh read on every retry rather than against a profile
 * that may have been replaced underneath.
 */
export async function POST(req: Request) {
  const body = await readBody(req);
  const canonical = canonicalUsername(body.username);
  if (!canonical) return Response.json({ ok: false, error: 'Not signed in.' }, { status: 401 });

  try {
    const result = await updateProfile(canonical, (profile) => {
      if (!profile.character) return { ok: false, status: 409, error: 'Make your duelist first.' };

      const first = profile.deck === null;
      const available = first ? STARTER_POOL : profile.collection;
      const checked = validateDeck(body.deck, available);
      if (!checked.ok) return { ok: false, status: 400, error: checked.reason };

      return {
        ok: true,
        profile: {
          ...profile,
          deck: checked.deck,
          collection: first ? [...checked.deck] : profile.collection,
        },
      };
    });
    if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: result.status });
    return Response.json({ ok: true, profile: result.profile, stage: stageFor(result.profile) });
  } catch (err) {
    const reason = describeStoreError(err);
    console.error('story deck save failed:', reason, err);
    return Response.json(
      { ok: false, reason, error: 'Your deck could not be saved. Try again in a moment.' },
      { status: 503 }
    );
  }
}
