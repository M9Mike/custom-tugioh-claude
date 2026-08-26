import { canonicalUsername, updateProfile } from '@/server/story';
import { describeStoreError } from '@/server/store';
import { claimStoryPack } from '@/server/rooms';
import { readBody } from '../body';
import { stageFor } from '@/story/profile';
import { openPack } from '@/story/packs';
import { bountyFor } from '@/story/shop';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Packs: claiming one for a win, and opening one.
 *
 * ## Why a win is checked and not taken on trust
 *
 * Everything else in Story Mode believes the caller — there is no auth yet, and
 * the reason that is not a live hole is that exactly one account exists. That
 * argument covers reading your own save. It does not cover *minting rewards*: a
 * route that hands out a pack because the client said it won is a route that
 * hands out every card in the game to anybody who can spell `fetch`, and it
 * would still be true on the day accounts arrive.
 *
 * So the claim carries the room code and the seat token, and the server decides.
 * It loads the room, checks it is a Story Mode room, checks the token really is
 * that seat's, checks the duel is actually over and that this seat won, and only
 * then awards the pack for whoever was in the other chair.
 *
 * ## Claimed exactly once
 *
 * `claimStoryPack` sets `room.packClaimed` in the same compare-and-set that
 * reads the winner. Without it the reward is a page refresh away from
 * repeating, and a finished room lives for ninety minutes. The flag goes on the
 * *room* rather than the profile because the room is the thing that can only be
 * won once; a profile counter would have to remember which rooms it had already
 * counted, which is the same flag with extra steps.
 *
 * The room is marked before the profile is written, which is the safe order to
 * fail in only if you think a lost pack is worse than a repeated one. It is the
 * other way round, so the profile write comes second and a failure there leaves
 * the room claimed and the player short — see the note at the call.
 */
export async function POST(req: Request) {
  const body = await readBody(req);
  const canonical = canonicalUsername(body.username);
  if (!canonical) return Response.json({ ok: false, error: 'Not signed in.' }, { status: 401 });

  const action = body.action === 'open' ? 'open' : 'claim';

  try {
    if (action === 'claim') {
      const code = typeof body.code === 'string' ? body.code : '';
      const token = typeof body.token === 'string' ? body.token : '';
      const verdict = await claimStoryPack(code, token);

      if (!verdict.ok && 'already' in verdict) {
        /* Not an error: a retry, or a second tab. The player already has it. */
        return Response.json({ ok: true, awarded: false, already: true });
      }
      if (!verdict.ok && 'lost' in verdict) {
        return Response.json({ ok: true, awarded: false, lost: true });
      }
      if (!verdict.ok) {
        return Response.json({ ok: false, error: verdict.error }, { status: verdict.status });
      }

      const duelistId = verdict.duelistId;
      /*
       * The pack and the money are one transaction.
       *
       * Both are owed by the same win and both are settled against the same
       * already-checked room, so paying them in one `updateProfile` means there
       * is no state where a player got the cards and not the coin. It also means
       * the money inherits everything the pack claim already proves — right
       * room, right seat, duel actually finished, this seat actually won — and
       * cannot be minted by asking nicely.
       */
      const paid = bountyFor(duelistId);
      const result = await updateProfile(canonical, (profile) => ({
        ok: true,
        profile: {
          ...profile,
          packs: [...profile.packs, duelistId],
          money: (profile.money ?? 0) + paid,
        },
      }));
      if (!result.ok) {
        return Response.json({ ok: false, error: result.error }, { status: result.status });
      }
      return Response.json({
        ok: true,
        awarded: true,
        duelistId,
        paid,
        profile: result.profile,
        stage: stageFor(result.profile),
      });
    }

    /* ---- open the oldest unopened pack ---- */
    let opened: ReturnType<typeof openPack>['result'] | null = null;
    const result = await updateProfile(canonical, (profile) => {
      if (!profile.packs.length) {
        return { ok: false, status: 409, error: 'You have no packs to open.' };
      }
      const [duelistId, ...rest] = profile.packs;
      /*
       * Drawn inside `apply`, not before it.
       *
       * `updateProfile` re-runs this against a fresh read when it loses a
       * compare-and-set, and a pack drawn outside would then be applied to a
       * profile it was never drawn against — banking cards that were already
       * pulled, or spending entries twice. Drawing here means a retry draws
       * again, which is the only correct behaviour.
       */
      const out = openPack({ ...profile, packs: rest }, duelistId);
      opened = out.result;
      return { ok: true, profile: out.profile };
    });
    if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: result.status });

    return Response.json({
      ok: true,
      pack: opened,
      profile: result.profile,
      stage: stageFor(result.profile),
    });
  } catch (err) {
    const reason = describeStoreError(err);
    console.error('story pack failed:', reason, err);
    return Response.json(
      { ok: false, reason, error: 'That pack could not be opened. Try again in a moment.' },
      { status: 503 }
    );
  }
}
