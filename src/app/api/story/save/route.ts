import { canonicalUsername, updateProfile } from '@/server/story';
import { describeStoreError } from '@/server/store';
import { readBody } from '../body';
import { areaById, settle, PLAYER_RADIUS, standingOn } from '@/story/areas';
import type { WorldPosition } from '@/story/profile';

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
      return { ok: true, profile: { ...profile, world, pendingDuel } };
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
