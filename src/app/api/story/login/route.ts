import { canonicalUsername, loadOrCreateProfile, updateProfile } from '@/server/story';
import { loadRoom } from '@/server/rooms';
import type { StoryProfile } from '@/story/profile';
import { describeStoreError } from '@/server/store';
import { readBody } from '../body';
import { stageFor } from '@/story/profile';

/**
 * A duel walked into and not come back from: ask the room how it went.
 *
 * The verdict is the room's, never the client's. A room that has gone — they
 * expire — is nothing to come back to, and the note is cleared. A room still
 * being played is left alone: no outcome, no conversation to resume.
 */
async function withVerdict(canonical: string, profile: StoryProfile): Promise<StoryProfile> {
  const pending = profile.pendingDuel;
  if (!pending) return profile;
  const room = await loadRoom(pending.code).catch(() => null);
  if (!room || !room.story) {
    const cleared = await updateProfile(canonical, (p) => ({ ok: true, profile: { ...p, pendingDuel: null } })).catch(() => null);
    return cleared?.ok ? cleared.profile : { ...profile, pendingDuel: null };
  }
  const winner = room.state?.winner;
  if (!winner) return profile;
  const mine = (['p1', 'p2'] as const).find((seat) => room.seats[seat]?.token === pending.token);
  return { ...profile, pendingDuel: { ...pending, outcome: mine && winner === mine ? 'won' : 'lost' } };
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Signs a player into Story Mode.
 *
 * No password yet — see `AUTHORISED` in `src/server/story.ts`. An unknown name
 * is refused with a message that says so, rather than being turned into a new
 * account: there is no registration in the game yet, so the only thing a typo
 * could do is strand a character behind a name nobody meant to type.
 */
export async function POST(req: Request) {
  const body = await readBody(req);
  const canonical = canonicalUsername(body.username);
  if (!canonical) {
    return Response.json(
      { ok: false, error: 'No duelist by that name. Story Mode is not open to new names yet.' },
      { status: 401 }
    );
  }
  try {
    const profile = await withVerdict(canonical, await loadOrCreateProfile(canonical));
    return Response.json({ ok: true, profile, stage: stageFor(profile) });
  } catch (err) {
    const reason = describeStoreError(err);
    console.error('story login failed:', reason, err);
    return Response.json(
      { ok: false, reason, error: 'Story Mode could not reach its database. Try again in a moment.' },
      { status: 503 }
    );
  }
}
