/**
 * Priest Seto — one card is a God, and a God with two spare souls is the duel.
 *
 * Millennium Seeker is the whole deck in a single Normal Summon: it fetches
 * Obelisk out of the Deck *or the Graveyard* and lays two more Seekers beside
 * itself, which is three bodies and the God in hand from one card. The beam
 * finds that summon happily — what it cannot see is that the board it leaves
 * behind is next turn's Tribute Summon, because next turn is past its horizon.
 *
 * And Obelisk is not a 4000 body. Obelisk is two spare souls away from a Fist
 * of Fate, which is infinite ATK and a won duel — so the deck's Ka Tokens are
 * not chaff, they are ammunition. Mound of the Bound Creator lays one at every
 * turn start, Millennium Ankh lays three for a thousand Life Points, and Aswan
 * Apparition answers its own death with another of itself and a Token beside
 * it. A God standing with nothing to spend is half a card; a God standing over
 * two Tokens has already won.
 *
 * Public information only. Own hand and own Deck's CONTENTS (never its order),
 * both fields as shown, both Graveyards, the size of their hand.
 */
import { CARDS, baseAtk } from '../cards';
import { effAtk, other, tributesRequired } from '../engine';
import type { DuelistBrain } from '../brain';
import type { CardInstance, DuelState, PendingChoice, PlayerId } from '../types';
import { bodyCount, findOwn, inHand, inPile, known, myBodies, theirBoard } from './common';

const OBELISK = 'obelisk-the-tormentor';
const SEEKER = 'millennium-seeker';

/** Obelisk's own body, which is the one God with a printed number. */
const OBELISK_ATK = 4000;

/** Is the God already standing, face-up, ready to be asked for the Fist? */
const obeliskStanding = (state: DuelState, me: PlayerId): CardInstance | undefined =>
  myBodies(state, me).find((m) => m.slug === OBELISK && m.face === 'up');

/**
 * Bodies that could be fed to the Fist of Fate right now, or laid down to be.
 *
 * The Fist eats two monsters that are not the God itself, and the deck has
 * three ways to find them beyond whatever is already standing: the Ankh's
 * three Tokens for a thousand Life Points, the Mound's one at every turn
 * start, and Aswan answering her own death. Counted in bodies, because that is
 * what the cost is written in.
 */
function fodderReachable(state: DuelState, me: PlayerId): { now: number; soon: number } {
  const p = state.players[me];
  const god = obeliskStanding(state, me);
  const now = myBodies(state, me).filter((m) => m.uid !== god?.uid && CARDS[m.slug]?.type !== 'Divine-Beast').length;
  let soon = now;
  /* Three Tokens for a thousand Life Points, and they are destroyed at the end
     of the turn anyway — which makes them the purest Fist fodder in the deck:
     spent, they cost nothing they were not about to cost. */
  if (inHand(state, me, 'millennium-ankh') && p.lp > 1000) soon += 3;
  if (p.field?.slug === 'mound-of-the-bound-creator') soon += 1;
  return { now, soon: Math.min(3, soon) };
}

/**
 * What the God standing there is really threatening.
 *
 * Two souls and its ATK is not a number any more, which ends the duel against
 * any board at all; one soul and it swings four times. Both are once a turn
 * and both are already in the beam's reach when the bodies are standing — so
 * what is priced here is the half the beam cannot see: the ammunition that has
 * not arrived yet, and the Ankh sitting in hand waiting to make it.
 */
function fistReadiness(state: DuelState, me: PlayerId): number {
  const god = obeliskStanding(state, me);
  if (!god) return 0;
  const { now, soon } = fodderReachable(state, me);
  /* Already paid for: the search can see this line itself this turn, so it is
     priced at nothing here rather than counted twice. */
  if (now >= 2) return 0;
  if (soon >= 2) return 520;
  if (soon >= 1) return 220;
  return 0;
}

/**
 * How much of the God's price this board has already paid.
 *
 * Held well below what landing is worth, so standing one turn short of Obelisk
 * never outscores standing Obelisk — the trap every readiness term of this
 * shape has to be kept clear of.
 */
function obeliskReadiness(state: DuelState, me: PlayerId): number {
  const p = state.players[me];
  if (obeliskStanding(state, me)) return 0;
  const access = inHand(state, me, OBELISK) ? 1 : inPile(state, me, OBELISK) ? 0.3 : 0;
  if (access <= 0) return 0;
  const need = tributesRequired(OBELISK, state, me, true) || 3;
  const paid = Math.min(1, bodyCount(state, me) / need);
  if (paid <= 0) return 0;
  const now = !p.normalSummonUsed && bodyCount(state, me) >= need;
  return access * paid * (OBELISK_ATK * 0.3 + 260) * (now ? 0.3 : 0.22);
}

/**
 * The Seeker is the God, one turn earlier.
 *
 * One Normal Summon fetches Obelisk from the Deck or the Graveyard and lays
 * two more Seekers beside itself: three bodies and the God in hand, off one
 * card. Worth counting only while the Normal Summon is unspent, the God is
 * somewhere it can be fetched from, and there are Seekers left to call.
 */
function seekerReadiness(state: DuelState, me: PlayerId): number {
  const p = state.players[me];
  if (p.normalSummonUsed || obeliskStanding(state, me)) return 0;
  if (!inHand(state, me, SEEKER)) return 0;
  if (inHand(state, me, OBELISK)) return 0; // already held; the ordinary readiness above prices it
  if (!inPile(state, me, OBELISK)) return 0;
  const spare = p.deck.filter((c) => c.slug === SEEKER).length + p.hand.filter((h) => known(h) && h.slug === SEEKER).length - 1;
  /* Two more Seekers is three bodies; one is two; none is a lone 1000 body
     that still fetches the God. */
  const bodies = Math.min(3, 1 + Math.max(0, Math.min(2, spare)));
  return 180 + bodies * 110;
}

/**
 * Their monsters, borrowed as Tributes.
 *
 * Soul Exchange lends two of theirs for the price of a Summon, Possessed Dark
 * Soul tears one out and keeps it, Snatch Steal takes one for rent. Each is
 * removal and a Tribute in the same card, which is why this deck can pay for a
 * God off a board of nothing — and the beam prices them as removal alone.
 */
function borrowedTributes(state: DuelState, me: PlayerId): number {
  const t = theirBoard(state, me);
  if (!t.atks.length && !t.hidden) return 0;
  const godComing = inHand(state, me, OBELISK) || inPile(state, me, OBELISK);
  if (!godComing) return 0;
  let worth = 0;
  if (inHand(state, me, 'soul-exchange')) worth += Math.min(2, t.atks.length + t.hidden) * 160;
  if (myBodies(state, me).some((m) => m.slug === 'possessed-dark-soul')) worth += 140;
  if (inHand(state, me, 'snatch-steal')) worth += 120;
  return worth;
}

/** The whole of what the deck knows, on top of the general evaluation. */
function bonus(state: DuelState, me: PlayerId): number {
  return obeliskReadiness(state, me) + seekerReadiness(state, me) + fistReadiness(state, me) + borrowedTributes(state, me);
}

/**
 * Which card. This deck's questions are about ammunition and about the God:
 * a body is worth the Tribute it will pay, and the monster worth stealing is
 * the one that can be spent as well as the one that hurts.
 */
function rankChoice(state: DuelState, me: PlayerId, pending: PendingChoice): string[] | null {
  const p = state.players[me];
  const summoning = /Special Summon/i.test(pending.reason);
  const stealing = /control/i.test(pending.reason);
  const t = theirBoard(state, me);
  const god = obeliskStanding(state, me);
  const needFodder = !!god && fodderReachable(state, me).now < 2;
  const needBodies = !god && (inHand(state, me, OBELISK) || inPile(state, me, OBELISK)) && bodyCount(state, me) < 3;

  const worthOf = (c: CardInstance): number => {
    const slug = c.slug;
    const theirs = c.owner !== me;
    /* Taking one of theirs: the biggest body, and dearer still when the God is
       waiting for a soul to spend. */
    if (stealing || theirs) {
      const body = state.players[other(me)].monsters.find((m) => m?.uid === c.uid);
      const atk = body ? effAtk(state, body, other(me)) : baseAtk(slug);
      return atk * 0.4 + (needFodder || needBodies ? 300 : 0);
    }
    if (summoning) {
      let v = baseAtk(slug) * 0.25;
      if (needFodder || needBodies) v += 280;
      switch (slug) {
        case SEEKER:
          v += 160;
          break;
        case 'aswan-apparition':
          /* She answers her own death with another of herself and a Token —
             one body that keeps being two. */
          v += 200;
          break;
        case 'double-coston':
          /* A God costs one Tribute less while he stands there. */
          v += 320;
          break;
        case 'pharaoh-s-servant':
          v += 120;
          break;
      }
      return v;
    }
    /* Coming to the hand. */
    let v = baseAtk(slug) * 0.1;
    switch (slug) {
      case OBELISK:
        v += 900;
        break;
      case SEEKER:
        v += inPile(state, me, OBELISK) && !p.normalSummonUsed ? 420 : 200;
        break;
      case 'millennium-ankh':
        v += god ? 420 : 160;
        break;
      case 'double-coston':
        v += 300;
        break;
      case 'soul-exchange':
        v += t.atks.length ? 280 : 90;
        break;
      case 'mound-of-the-bound-creator':
        v += p.field ? 60 : 260;
        break;
      case 'monster-reborn':
        v += 260;
        break;
      case 'pharaoh-s-servant':
        v += 120;
        break;
    }
    return v;
  };

  const ranked = pending.options
    .map((uid) => ({ uid, c: findOwn(state, me, uid) ?? state.players[other(me)].monsters.find((m) => m?.uid === uid) ?? null }))
    .filter((x): x is { uid: string; c: CardInstance } => !!x.c)
    .map((x) => ({ uid: x.uid, worth: worthOf(x.c) }))
    .sort((a, b) => b.worth - a.worth || (a.uid < b.uid ? -1 : 1));
  return ranked.length ? ranked.map((r) => r.uid) : null;
}

export const PRIESTSETO: DuelistBrain = { id: 'priestseto', bonus, rankChoice };
