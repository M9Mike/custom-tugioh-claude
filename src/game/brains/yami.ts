/**
 * Yami Yugi — a deck that builds bodies to spend on a God.
 *
 * Slifer the Sky Dragon is three Tributes and a printed ATK of nought: it
 * fights with a thousand for every card in the hand that summoned it. Two
 * things follow, and neither is derivable from the effect DSL.
 *
 * The first is that the deck's real engine is not the God, it is the monsters
 * that arrive in threes. Queen's Knight calls King's Knight, who calls Jack's
 * Knight — one Normal Summon, three bodies, the exact price of a Divine-Beast.
 * Alpha fetches two more Magnet Warriors, Gamma and Beta call them out of the
 * pile, Multiply lays three Kuriboh Tokens for one card, and Valkyrion comes
 * apart into the three Warriors that made him. The beam sees the bodies land;
 * what it cannot see is that a board of three and a God in hand is next turn's
 * duel, because next turn is past its horizon.
 *
 * The second is that summoning Slifer costs nothing in hand size — it leaves
 * the hand and its own Summon draws the card back — so it lands at exactly a
 * thousand times the hand that paid for it, and every card played before it
 * lands is a thousand ATK the God will never have.
 *
 * Public information only. Own hand and own Deck's CONTENTS (never its order),
 * both fields as shown, both Graveyards, the size of their hand.
 */
import { CARDS, baseAtk } from '../cards';
import { effAtk, other, tributesRequired } from '../engine';
import type { DuelistBrain } from '../brain';
import type { CardInstance, DuelState, PendingChoice, PlayerId } from '../types';
import { bodyCount, findOwn, inHand, inPile, known, myBodies, theirBoard } from './common';

const SLIFER = 'slifer-the-sky-dragon';

/**
 * What Slifer would fight with the moment it landed.
 *
 * The hand it is counted against is the hand *after* the Summon, and that is
 * the same size as the hand before it: the God leaves, its own effect draws
 * one back. So the number is a thousand times the hand holding it, Slifer
 * included — which is also why every card spent first is a thousand lost.
 */
function sliferArrivalAtk(state: DuelState, me: PlayerId): number {
  return 1000 * state.players[me].hand.length;
}

/**
 * What Slifer is worth standing there, beyond its body.
 *
 * Every monster they Summon loses two thousand ATK for good and dies on the
 * spot if that was all it had, and nothing they hold can target the God. That
 * is a tax on the rest of their deck, and it is only worth what they still
 * have to pay it with — most of a duel against a full hand, nothing at all
 * against an empty one.
 *
 * The rate is a judgement and was measured as one: at half of what it says
 * here the deck scored 65.7% against the field, at this rate 66.2%, and with
 * no brain at all 66.7% — three numbers inside one ±6.5 band, which is to say
 * the search was already playing this card about right and neither rate is
 * worth anything over the other. The larger is kept because it is the better
 * model of the card, not because it measured better.
 */
function sliferLock(state: DuelState, me: PlayerId): number {
  const t = theirBoard(state, me);
  return Math.min(5, t.hand) * 330 + 200;
}

/**
 * Bodies this turn could still put on the board, capped at the three zones.
 *
 * Only the routes this deck actually owns, and only when the card that opens
 * one is in hand and the pieces it calls are somewhere it can reach them. The
 * Normal Summon is spent once, so the chains compete for it; Multiply is a
 * Spell and does not.
 */
function bodiesReachable(state: DuelState, me: PlayerId): number {
  const p = state.players[me];
  let bodies = bodyCount(state, me);
  if (bodies >= 3) return 3;

  /* Valkyrion comes apart into the three Warriors that made him, out of the
     Graveyard, and does not touch the Normal Summon — so he is the one route
     that stacks with a chain. Net two: he leaves, three arrive. */
  const magnets = ['alpha-the-magnet-warrior', 'beta-the-magnet-warrior', 'gamma-the-magnet-warrior'];
  const valkyrion = myBodies(state, me).find((m) => m.slug === 'valkyrion-the-magna-warrior');
  if (valkyrion && magnets.every((s) => p.grave.some((c) => c.slug === s))) bodies += 2;
  if (bodies >= 3) return 3;

  /* Multiply is a Spell: three Tokens for one card, and the Normal Summon is
     still in hand afterwards. It needs the Spell/Trap Zone free of a card it
     would have to sit on top of. */
  if (inHand(state, me, 'multiply')) bodies += 3;
  if (bodies >= 3) return 3;

  if (!p.normalSummonUsed) {
    let best = 0;
    for (const h of p.hand) {
      if (!known(h) || CARDS[h.slug]?.kind !== 'monster') continue;
      /* A body that costs bodies is not a body that makes them. */
      if (tributesRequired(h.slug, state, me) > 0) continue;
      let chain = 1;
      switch (h.slug) {
        case 'queen-s-knight':
          /* She calls the King, and the King calls the Jack while a Warrior
             stands beside him — which she is. One card, three bodies. */
          if (inPile(state, me, 'king-s-knight')) chain = inPile(state, me, 'jack-s-knight') ? 3 : 2;
          break;
        case 'king-s-knight':
          if (inPile(state, me, 'jack-s-knight') && myBodies(state, me).some((m) => CARDS[m.slug]?.type === 'Warrior')) chain = 2;
          break;
        case 'gamma-the-magnet-warrior':
          if (magnets.some((s) => s !== h.slug && (inPile(state, me, s) || inHand(state, me, s)))) chain = 2;
          break;
        case 'beta-the-magnet-warrior':
          if (magnets.some((s) => s !== h.slug && p.grave.some((c) => c.slug === s))) chain = 2;
          break;
        case 'kuriboh':
          chain = 2;
          break;
        case 'berfomet':
          if (inPile(state, me, 'gazelle-the-king-of-mythical-beasts')) chain = 2;
          break;
        case 'gazelle-the-king-of-mythical-beasts':
          /* Gazelle fetches Berfomet to the HAND, which is a card and not a
             body — so he is one body this turn, and two the turn after. */
          chain = 1;
          break;
      }
      best = Math.max(best, chain);
    }
    bodies += best;
  }
  return Math.min(3, bodies);
}

/**
 * How much of the God's price this position has already paid.
 *
 * Kept below what landing is actually worth, or the search would rather stand
 * one turn away from Slifer for ever than summon it — the readiness trap every
 * term of this shape has to be held clear of.
 */
function sliferReadiness(state: DuelState, me: PlayerId): number {
  const p = state.players[me];
  /* On the field it is not a plan, it is a monster, and the evaluation is
     already counting it. */
  if (myBodies(state, me).some((m) => m.slug === SLIFER)) return 0;
  const access = inHand(state, me, SLIFER) ? 1 : inPile(state, me, SLIFER) ? 0.25 : 0;
  if (access <= 0) return 0;
  const need = tributesRequired(SLIFER, state, me, true) || 3;
  const paid = Math.min(1, bodiesReachable(state, me) / need);
  if (paid <= 0) return 0;
  /* The God cannot be Summoned at all on a turn whose Normal Summon is gone,
     so a board that is ready but spent is ready for *next* turn. */
  const now = !p.normalSummonUsed && bodyCount(state, me) >= need;
  /* The body only. The lock is paid in full the moment the God lands (see
     `sliferStanding`), so counting it here as well would make the plan worth
     as much as the deed. */
  const landed = sliferArrivalAtk(state, me) * 0.3;
  return access * paid * landed * (now ? 0.3 : 0.22);
}

/**
 * Catapult Turtle throws a monster at their face for exactly what it was
 * worth, once a turn, over everything standing in the way. With a big body
 * beside it that is reach the board does not show, and against low Life
 * Points it is the duel.
 */
function catapultReach(state: DuelState, me: PlayerId): number {
  const turtle = myBodies(state, me).find((m) => m.slug === 'catapult-turtle' && m.face === 'up');
  if (!turtle) return 0;
  const ammo = myBodies(state, me).filter((m) => m.uid !== turtle.uid && !CARDS[m.slug]?.type?.includes('Divine'));
  if (!ammo.length) return 0;
  const best = Math.max(...ammo.map((m) => effAtk(state, m, me)));
  const theirLp = state.players[other(me)].lp;
  /* Reach that finishes the duel is worth more than reach that dents it. */
  return best >= theirLp ? 900 : best * 0.12;
}

/**
 * Buster Blader is priced by the other deck: eight hundred for every Dragon
 * on the field or lying in either Graveyard. In hand the general search sees
 * a 2600 body; across the table from Kaiba he is a five-thousand.
 */
function busterWorth(state: DuelState, me: PlayerId): number {
  if (!inHand(state, me, 'buster-blader')) return 0;
  const dragons = (['p1', 'p2'] as PlayerId[]).reduce((n, pid) => {
    const p = state.players[pid];
    const onField = p.monsters.filter((m) => m && CARDS[m.slug]?.type === 'Dragon').length;
    return n + onField + p.grave.filter((c) => CARDS[c.slug]?.type === 'Dragon').length;
  }, 0);
  return dragons * 800 * 0.12;
}

/**
 * What the God is worth once it is actually standing there.
 *
 * The same tax the readiness term prices, paid for real. It has to be here as
 * well as there, or the lock would be worth something only while Slifer was
 * still in the hand — and a term that pays for the plan and not for the deed
 * teaches the search to keep planning.
 */
function sliferStanding(state: DuelState, me: PlayerId): number {
  const god = myBodies(state, me).find((m) => m.slug === SLIFER && m.face === 'up');
  return god ? sliferLock(state, me) : 0;
}

/** The whole of what the deck knows, on top of the general evaluation. */
function bonus(state: DuelState, me: PlayerId): number {
  return sliferReadiness(state, me) + sliferStanding(state, me) + catapultReach(state, me) + busterWorth(state, me);
}

/**
 * Which card. The engine's default takes the biggest number; this deck's
 * questions are about what a card *becomes* — a Magnet Warrior is worth the
 * two more it calls, a body fetched to the hand is a thousand ATK on a God
 * that has not been Summoned yet.
 */
function rankChoice(state: DuelState, me: PlayerId, pending: PendingChoice): string[] | null {
  const p = state.players[me];
  const summoning = /Special Summon/i.test(pending.reason);
  const t = theirBoard(state, me);
  const theirBest = t.atks.length ? Math.max(...t.atks) : 0;
  const bodies = bodyCount(state, me);
  const wantsBodies = inHand(state, me, SLIFER) && bodies < 3;

  const worthOf = (c: CardInstance): number => {
    const slug = c.slug;
    if (summoning) {
      let v = baseAtk(slug) * 0.3;
      /* A body called to the field while the God waits is worth a third of a
         Tribute, whatever it is printed at. */
      if (wantsBodies) v += 260;
      switch (slug) {
        case 'beta-the-magnet-warrior':
          /* He calls a third Magnet out of the pile as he lands, and stands
             800 taller beside another Rock. */
          v += 220;
          break;
        case 'gamma-the-magnet-warrior':
          v += 200;
          break;
        case 'alpha-the-magnet-warrior':
          v += 140;
          break;
        case 'jack-s-knight':
          v += p.monsters.some((m) => m?.slug === 'queen-s-knight') && p.monsters.some((m) => m?.slug === 'king-s-knight') ? 300 : 100;
          break;
        case 'dark-magician':
          v += t.backrow * 260 + 120;
          break;
        case 'gazelle-the-king-of-mythical-beasts':
        case 'berfomet':
          v += 150;
          break;
      }
      return v;
    }
    /* Coming to the hand — and a card in this hand is a thousand ATK on a God
       that has not landed yet. */
    let v = baseAtk(slug) * 0.1 + (inHand(state, me, SLIFER) ? 300 : 0);
    switch (slug) {
      case SLIFER:
        v += 900;
        break;
      case 'multiply':
        /* Three bodies for one card is the God's whole price in a single
           Spell, and worth nothing at all once the board is already full. */
        v += bodies >= 3 ? 40 : 420;
        break;
      case 'queen-s-knight':
        v += inPile(state, me, 'king-s-knight') ? 360 : 120;
        break;
      case 'alpha-the-magnet-warrior':
        v += 240;
        break;
      case 'beta-the-magnet-warrior':
      case 'gamma-the-magnet-warrior':
        v += 200;
        break;
      case 'catapult-turtle':
        v += bodies >= 2 ? 280 : 120;
        break;
      case 'buster-blader':
        v += busterWorth(state, me) > 0 ? 200 : 80;
        break;
      case 'dark-magician':
        v += theirBest > 2000 ? 220 : 120;
        break;
      case 'monster-reborn':
        v += 260;
        break;
      case 'card-of-sanctity':
        /* Draws both sides to six. It fills the hand the God is measured
           against — and fills theirs too, so it is worth most when Slifer is
           the one waiting on it. */
        v += inHand(state, me, SLIFER) ? 360 : 160;
        break;
    }
    return v;
  };

  const ranked = pending.options
    .map((uid) => ({ uid, c: findOwn(state, me, uid) }))
    .filter((x): x is { uid: string; c: CardInstance } => !!x.c)
    .map((x) => ({ uid: x.uid, worth: worthOf(x.c) }))
    .sort((a, b) => b.worth - a.worth || (a.uid < b.uid ? -1 : 1));
  return ranked.length ? ranked.map((r) => r.uid) : null;
}

export const YAMI: DuelistBrain = { id: 'yami', bonus, rankChoice };
