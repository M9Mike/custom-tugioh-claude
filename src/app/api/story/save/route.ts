import { canonicalUsername, loadProfile, saveProfile } from '@/server/story';
import { describeStoreError } from '@/server/store';
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
 * them: this route reads the stored profile and puts back everything else
 * exactly as it found it.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { username?: string; world?: Partial<WorldPosition> };
  const canonical = canonicalUsername(body.username ?? '');
  if (!canonical) return Response.json({ ok: false, error: 'Not signed in.' }, { status: 401 });

  try {
    const profile = await loadProfile(canonical);
    if (!profile) return Response.json({ ok: false, error: 'No save to write to.' }, { status: 404 });

    const clamp = (v: number) => (v < -WORLD_RADIUS ? -WORLD_RADIUS : v > WORLD_RADIUS ? WORLD_RADIUS : v);
    const world: WorldPosition = {
      x: clamp(finite(body.world?.x, profile.world.x)),
      z: clamp(finite(body.world?.z, profile.world.z)),
      facing: finite(body.world?.facing, profile.world.facing) % (Math.PI * 2),
    };
    const next = { ...profile, world };
    await saveProfile(next);
    return Response.json({ ok: true, profile: next });
  } catch (err) {
    const reason = describeStoreError(err);
    console.error('story save failed:', reason, err);
    return Response.json(
      { ok: false, reason, error: 'Could not save. Try again in a moment.' },
      { status: 503 }
    );
  }
}
