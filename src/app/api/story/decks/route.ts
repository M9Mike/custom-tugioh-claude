import { admittedUsernames, loadProfile } from '@/server/story';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The decks the people who walk the world are holding.
 *
 * The Home page shows every duelist's deck; these two are duelists as well,
 * they just do not live in `decklists.json`. So the strip gains them at the
 * end — Mike, then Teddy — the day each of them locks a deck, and neither is
 * listed before that, because "their deck" is the whole point and a name with
 * nothing behind it is a tile that opens on nothing.
 *
 * Read-only, and narrow on purpose. What comes back is the printed name, the
 * character's name and the 25 cards — not the collection, not the money, not
 * the packs and not where they are standing. Story Mode has no sign-in yet
 * (see `canonicalUsername`), so a route that hands anything back should hand
 * back only what is already meant to be looked at, which a deck on the menu is
 * by the owner's own ask.
 */
export async function GET() {
  const players = await Promise.all(
    admittedUsernames().map(async (username) => {
      const profile = await loadProfile(username).catch(() => null);
      if (!profile?.deck?.length) return null;
      return { username, character: profile.character?.name ?? username, deck: profile.deck };
    })
  );
  return Response.json({ ok: true, players: players.filter((p): p is NonNullable<typeof p> => !!p) });
}
