import { createExhibitionRoom, createRoom, createSoloRoom, createStoryRoom, createTournamentRoom, viewOf } from '@/server/rooms';
import { canonicalUsername, loadProfile, updateProfile } from '@/server/story';
import { describeStoreError } from '@/server/store';
import { deckIsShort, escrowCard, forfeitFor, refuseWager, stakeFor, wagersACard } from '@/story/shop';
import { CARDS } from '@/game/cards';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    vsAi?: boolean;
    /**
     * A duel entered from a conversation in Story Mode.
     *
     * The deck is read from the player's own save rather than accepted from the
     * request. Story Mode has no authentication yet — see `canonicalUsername` —
     * so believing a posted deck would let any caller deal themselves any
     * twenty-five cards, and the save is the one place that already knows which
     * cards this player actually owns.
     */
    storyUser?: string;
    /** With `storyUser`: who the duel is with in the story, and where it resumes. */
    npcId?: string;
    won?: string;
    lost?: string;
    dress?: string;
    /** What the player is putting up, for a duelist who plays for money. */
    stake?: number;
    /** Or the card they are putting up, by slug, for one who plays for a card. */
    wager?: string;
    tournament?: boolean;
    spectate?: boolean;
    duelistId?: string;
    opponentId?: string;
    duelistA?: string;
    duelistB?: string;
  };
  try {
    if (body.spectate) {
      // An exhibition seats nobody: the creator gets the code and a front-row
      // view, and the 'spectator' token is a placeholder the routes ignore.
      const { room } = await createExhibitionRoom(body.duelistA ?? '', body.duelistB ?? '');
      return Response.json({ ok: true, code: room.code, token: 'spectator', pid: 'p1', view: viewOf(room, 'p1', true) });
    }
    if (body.storyUser) {
      const canonical = canonicalUsername(body.storyUser);
      if (!canonical) {
        return Response.json({ ok: false, error: 'No duelist by that name.' }, { status: 401 });
      }
      const profile = await loadProfile(canonical);
      if (!profile?.deck?.length) {
        return Response.json(
          { ok: false, error: 'You have no deck to duel with yet.' },
          { status: 409 }
        );
      }
      /* A deck a card short does not sit down anywhere. The only way it gets
         short is losing a sleeved card to Ash, and the world has already sent
         the player to the builder; this is the server agreeing. */
      if (deckIsShort(profile)) {
        return Response.json(
          { ok: false, error: `Your deck is ${profile.deck.length} cards. Sleeve 25 before you duel.` },
          { status: 409 }
        );
      }
      /*
       * Money on the table, before there is a table.
       *
       * One duelist plays for a stake (`WAGER` in `story/shop.ts`) and the
       * stake is taken here, at the moment the duel is seated, rather than
       * settled when it ends. A win is claimed through `/api/story/pack`; a
       * loss is claimed by nobody, because there is nothing to collect — so
       * charging for a loss on the way out would be asking the loser to own up.
       * Escrow asks nobody anything.
       *
       * Taken *before* `createStoryRoom` and refunded if that throws, which is
       * the right way round to fail: a player charged for a duel that never
       * opened is a bug report, and a duel that opened without charging is free
       * money for anybody who makes the room creation fail on purpose.
       */
      const opponentId = body.opponentId ?? 'mai';
      /* Capped by *her* purse as well as by her range — she cannot match a bet
         she has not got. See `PURSE` in `story/shop.ts`; the figure is read off
         the save and never off the request. */
      const stake = stakeFor(opponentId, body.stake, profile.purse);
      /*
       * And what losing to them costs, which is taken the same way.
       *
       * Three duelists charge a dollar for a loss (`FORFEIT`), and it is
       * escrowed rather than collected afterwards for the same reason a stake
       * is: a loss is claimed by nobody. It comes home with the bounty on a win
       * the server has proved, and stays on the table otherwise — including
       * when the player refreshes out of a board they do not like.
       *
       * Off the duelist rather than off the request, so there is nothing here
       * for a client to name.
       */
      const forfeit = forfeitFor(opponentId);
      const owed = stake + forfeit;
      if (owed > 0) {
        const paid = await updateProfile(canonical, (p) => {
          const held = p.money ?? 0;
          if (held < owed) {
            return {
              ok: false,
              status: 409,
              error: stake > 0
                ? `You need $${stake} on you to play for $${stake}.`
                : `You need $${forfeit} on you to sit down — that is what losing costs.`,
            };
          }
          return { ok: true, profile: { ...p, money: held - owed } };
        });
        if (!paid.ok) {
          return Response.json({ ok: false, error: paid.error }, { status: paid.status });
        }
      }

      /*
       * A card on the table.
       *
       * The same escrow as the money, for the one duelist who asks for a card
       * (`CARD_WAGER`): the slug is checked against the save — owned, and with
       * more than a deck's worth to own it from — and leaves the collection
       * when the duel is seated. A claimed win is the only road back; a loss
       * is never reported by anybody and needs no branch. The deck is
       * untouched, because the player is about to duel *with* it, and
       * `mendDeck` squares the two once the wager is settled.
       *
       * Refused outright rather than waved through without a card: a duel
       * with him is a duel for a card, and a request that names none — or
       * names one the save does not hold — is not that duel.
       *
       * Checked here and *taken* below, in the same write as the duel's note,
       * after the room exists. The money leaves before the room is made, and
       * the first version of this did the same with the card — which opened a
       * gap between the escrow and the note in which the save held a deck
       * naming a card the collection no longer did, with no duel on record to
       * excuse it, and `mendDeck` squared the deck a card short on the way
       * into a duel the player was about to win. `npm run ash` walks it.
       */
      let wagerCard: string | undefined;
      if (wagersACard(opponentId)) {
        const slug = typeof body.wager === 'string' ? body.wager : '';
        const why = CARDS[slug] ? refuseWager(profile, slug) : 'unowned';
        if (why) {
          return Response.json(
            {
              ok: false,
              error:
                why === 'few'
                  ? 'You need more than a deck to bet a card from.'
                  : 'You cannot put up a card you do not own.',
            },
            { status: 409 }
          );
        }
        wagerCard = slug;
      }

      let seated;
      try {
        seated = await createStoryRoom(
          profile.character?.name ?? canonical,
          profile.deck,
          opponentId,
          body.dress,
          stake,
          wagerCard
        );
      } catch (err) {
        if (owed > 0) {
          await updateProfile(canonical, (p) => ({
            ok: true,
            profile: { ...p, money: (p.money ?? 0) + owed },
          })).catch(() => null);
        }
        throw err;
      }
      const { room, token, pid } = seated;
      /* Written on the save as well as handed back — see `DuelInProgress`. */
      const note =
        typeof body.npcId === 'string' && typeof body.won === 'string' && typeof body.lost === 'string'
          ? {
              code: room.code,
              token,
              npcId: body.npcId,
              won: body.won,
              lost: body.lost,
              startedAt: Date.now(),
              ...(wagerCard ? { wagered: wagerCard } : {}),
            }
          : null;
      if (wagerCard) {
        /* The card and the note in one write, so there is never a save with
           the one and not the other. Strict, unlike the note on its own: a
           duel for a card that failed to take the card is a free duel, so the
           player is not handed the room. It stays unreachable — nobody holds
           its token — and expires; the money stake, if any, goes back. */
        const held = wagerCard;
        const took = await updateProfile(canonical, (p) => {
          const again = refuseWager(p, held);
          if (again) return { ok: false, status: 409, error: 'That card is not yours to bet.' };
          return { ok: true, profile: { ...escrowCard(p, held), pendingDuel: note ?? p.pendingDuel } };
        });
        if (!took.ok) {
          if (stake > 0) {
            await updateProfile(canonical, (p) => ({ ok: true, profile: { ...p, money: (p.money ?? 0) + stake } })).catch(() => null);
          }
          return Response.json({ ok: false, error: took.error }, { status: took.status });
        }
      } else if (note) {
        /* Best effort: a save that is busy does not stop a duel that is ready. */
        await updateProfile(canonical, (p) => ({ ok: true, profile: { ...p, pendingDuel: note } })).catch(() => null);
      }
      return Response.json({ ok: true, code: room.code, token, pid });
    }

    const { room, token, pid } = body.tournament
      ? await createTournamentRoom(body.name ?? '', body.duelistId ?? '')
      : body.vsAi
        ? await createSoloRoom(body.name ?? '', body.opponentId)
        : await createRoom(body.name ?? '');
    return Response.json({ ok: true, code: room.code, token, pid, view: viewOf(room, pid) });
  } catch (err) {
    const reason = describeStoreError(err);
    console.error('createRoom failed:', reason, err);
    return Response.json(
      { ok: false, reason, error: 'The duel server could not reach its database. Check MONGODB_URI.' },
      { status: 503 }
    );
  }
}
