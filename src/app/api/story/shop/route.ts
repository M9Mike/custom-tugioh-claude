import { canonicalUsername, updateProfile } from '@/server/story';
import { describeStoreError } from '@/server/store';
import { readBody } from '../body';
import { stageFor } from '@/story/profile';
import { buy, priceOf, refuseBuy, shopStock } from '@/story/shop';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Buying a card from the Kame Game Shop.
 *
 * ## Every rule is checked here, not in the panel
 *
 * The panel knows what it is showing and greys out what it should, and none of
 * that is a control — it is a courtesy. What actually decides a purchase is this
 * route, because the panel is a thing anybody can edit and this is not:
 *
 * - the card must be **in stock**, so a slug nobody is selling cannot be minted
 *   by naming it;
 * - the player must **not already own it**, in Trunk or Deck alike;
 * - the money must **already be there**, and the price comes from the server's
 *   own table rather than from anything the client sends.
 *
 * The whole purchase is one `updateProfile`, so the money and the card move
 * together and a lost compare-and-set re-reads and re-decides against whatever
 * is stored now. Two tabs buying the last affordable card cannot both succeed.
 *
 * ## The refusal is a reason, not a sentence
 *
 * `owned` and `poor` come back as codes. Solomon says them in his own voice in
 * the panel, and the API stays something a second client could speak to without
 * inheriting a shopkeeper's manner.
 */
export async function POST(req: Request) {
  const body = await readBody(req);
  const canonical = canonicalUsername(body.username);
  if (!canonical) return Response.json({ ok: false, error: 'Not signed in.' }, { status: 401 });

  /* The stock list is public — the panel needs it to draw anything. */
  if (body.action === 'stock') {
    return Response.json({ ok: true, stock: shopStock() });
  }

  const slug = typeof body.slug === 'string' ? body.slug : '';

  try {
    let refusal: string | null = null;
    let spent = 0;
    const result = await updateProfile(canonical, (profile) => {
      if (!profile.character) return { ok: false, status: 409, error: 'Make your duelist first.' };

      /*
       * Decided inside `apply`, against the profile that is actually stored.
       *
       * `updateProfile` re-runs this when it loses a compare-and-set, and a
       * decision made outside would be applied to a profile it was never made
       * for — buying a card the player had just been given, or spending money
       * that had already gone.
       */
      const no = refuseBuy(profile, slug);
      if (no) {
        refusal = no;
        /* Not an error status: a refusal is an answer, and the panel has
           something to say about each one. */
        return { ok: true, profile };
      }
      spent = priceOf(slug) ?? 0;
      return { ok: true, profile: buy(profile, slug) };
    });

    if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: result.status });
    if (refusal) {
      return Response.json({ ok: true, bought: false, refusal, profile: result.profile });
    }
    return Response.json({
      ok: true,
      bought: true,
      slug,
      spent,
      profile: result.profile,
      stage: stageFor(result.profile),
    });
  } catch (err) {
    const reason = describeStoreError(err);
    console.error('story shop failed:', reason, err);
    return Response.json(
      { ok: false, reason, error: 'That could not be bought. Try again in a moment.' },
      { status: 503 }
    );
  }
}
