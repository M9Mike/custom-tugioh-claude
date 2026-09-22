import { canonicalUsername, updateProfile } from '@/server/story';
import { describeStoreError } from '@/server/store';
import { readBody } from '../body';
import { areaById, settle, PLAYER_RADIUS, standingOn } from '@/story/areas';
import type { WorldPosition } from '@/story/profile';
import { mendDeck } from '@/story/shop';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const finite = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;



/**
 * The Save button in the open world.
 *
 * Only the things the world itself owns are written — where you are standing
 * and which way you are looking. The character and the deck have their own
 * routes and their own locks, and a save must never be a way round either of
 * them: the patch below is applied to whatever profile is stored at the moment
 * it lands, and `updateProfile` re-reads and re-applies it if anything else
 * wrote in the meantime. Without that, pressing Save could put an older deck
 * back on top of one that had just been sleeved on another device.
 */
export async function POST(req: Request) {
  const body = await readBody(req);
  const canonical = canonicalUsername(body.username);
  if (!canonical) return Response.json({ ok: false, error: 'Not signed in.' }, { status: 401 });

  const patch = (body.world ?? {}) as Partial<WorldPosition>;
  /*
   * Cards the player has now looked at, which come off `fresh`.
   *
   * Sent here rather than to a route of its own because it is the same shape
   * of thing as a position: a small note about where the player has been,
   * batched up by the screen and posted when it closes. Filtered to strings
   * because it arrives over HTTP; a slug that is not in `fresh` simply removes
   * nothing, so there is nothing to validate it against.
   */
  const seen: string[] = Array.isArray(body.seen)
    ? (body.seen as unknown[]).filter((s): s is string => typeof s === 'string')
    : [];

  /*
   * Somebody the player has now talked to, who gets the short version from
   * here on — see `StoryProfile.met`.
   *
   * Posted with the position for exactly the reason `seen` is: it is a small
   * note about where the player has been, it must not lose a race with
   * anything else writing the profile, and `updateProfile` already re-reads
   * and re-applies under the revision guard. A name that is not an NPC costs
   * nothing — it is a string in a list that nothing looks up — so there is
   * nothing here to validate it against.
   */
  const met: string[] = Array.isArray(body.met)
    ? (body.met as unknown[]).filter((s): s is string => typeof s === 'string')
    : [];

  try {
    const result = await updateProfile(canonical, (profile) => {
      /*
       * Settled against the area's own geometry rather than clamped to a radius.
       *
       * The world used to be one circular field, so a save was two numbers held
       * inside 120 metres. It is rooms now, and the same job — "this position
       * must be somewhere a person could actually stand" — is the collision the
       * renderer already does. Running it here means a posted position lands
       * outside a wall even if it was invented rather than walked to, and a
       * player cannot be restored into the middle of a counter.
       *
       * The area is taken from the patch and resolved by `areaById`, which falls
       * back to the first area for anything unrecognised, including the saves
       * written before areas existed.
       */
      const area = areaById(patch.area ?? profile.world.area);
      const x = finite(patch.x, profile.world.x);
      const z = finite(patch.z, profile.world.z);
      /* On the floor they walked in on — see `standingOn`. Without it every
         gallery rail in the shop applies to somebody on the ground floor, and
         the position written back is one they were shoved to. */
      const settled = settle(area, x, z, PLAYER_RADIUS, standingOn(area, x, z));
      const world: WorldPosition = {
        area: area.id,
        x: settled.x,
        z: settled.z,
        facing: finite(patch.facing, profile.world.facing) % (Math.PI * 2),
      };
      /* `duelDone`: the conversation the duel came out of has picked up again,
         and the note on the save has done its job. */
      const pendingDuel = body.duelDone === true ? null : profile.pendingDuel;
      const fresh = seen.length
        ? (profile.fresh ?? []).filter((slug) => !seen.includes(slug))
        : profile.fresh;
      /* The bet is settled the moment the conversation has picked up: a card
         lost to Ash is out of the collection already, and a deck that still
         names it is squared in the same write, so the builder that opens
         next reads the deck as it really is. */
      /* Unioned, never replaced: two tabs and two conversations must not
         erase each other, and a name already there is simply already there. */
      const introduced = met.length
        ? [...new Set([...(profile.met ?? []), ...met])]
        : profile.met;
      const next = { ...profile, world, pendingDuel, fresh, met: introduced };
      return { ok: true, profile: pendingDuel ? next : mendDeck(next) };
    });
    if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: result.status });
    return Response.json({ ok: true, profile: result.profile });
  } catch (err) {
    const reason = describeStoreError(err);
    console.error('story save failed:', reason, err);
    return Response.json(
      { ok: false, reason, error: 'Could not save. Try again in a moment.' },
      { status: 503 }
    );
  }
}
