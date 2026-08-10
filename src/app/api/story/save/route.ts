import { canonicalUsername, updateProfile } from '@/server/story';
import { describeStoreError } from '@/server/store';
import { readBody } from '../body';
import type { WorldPosition } from '@/story/profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const finite = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

/** Matches the world's own walkable radius; see `WORLD_RADIUS` in OpenWorld. */
const WORLD_RADIUS = 120;

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
      const clamp = (v: number) => (v < -WORLD_RADIUS ? -WORLD_RADIUS : v > WORLD_RADIUS ? WORLD_RADIUS : v);
      const world: WorldPosition = {
        x: clamp(finite(patch.x, profile.world.x)),
        z: clamp(finite(patch.z, profile.world.z)),
        facing: finite(patch.facing, profile.world.facing) % (Math.PI * 2),
      };
      return { ok: true, profile: { ...profile, world } };
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
