/**
 * Yami Marik — a God worth exactly what you feed it, above a deck that wins
 * without it.
 *
 * The Winged Dragon of Ra has no numbers of its own. Its ATK and DEF are the
 * combined ATK and DEF of the three monsters Tributed to Summon it — their
 * EFFECTIVE stats, read off the board a moment before they die — plus three
 * hundred for every monster already lying in the Graveyard. So Melchid the
 * Four-Face Beast, who gives every monster on this side five hundred ATK, is
 * worth fifteen hundred on the God he is fed to; and a Ra paid for with three
 * Viser Des is a fifteen-hundred God that cost the whole board. Which bodies
 * pay is the entire card, and it is not a thing the effect DSL says.
 *
 * Then there is the sun. Once a turn Ra will take every Life Point but one and
 * add it to its own ATK — so in this deck Life Points are not a health bar,
 * they are ammunition, and Granadora topping them up is loading the gun. Once
 * a turn it will also pay a thousand of them to burn every monster they
 * control off the board.
 *
 * And under all of that the deck does not need the God at all. Two Bowganian
 * bill eleven hundred each at the start of every turn, Nightmare Wheel another
 * eight, Granadora eight more, and Coffin Seller fifteen hundred every time
 * one of these bodies dies — which Revival Jam does, over and over, on purpose.
 * The beam searches one turn, so an engine that collects every turn for the
 * rest of the duel is worth one turn's collection to it. Somebody has to count
 * the rest.
 *
 * Public information only. Own hand and own Deck's CONTENTS (never its order),
 * both fields as shown, both Graveyards, the size of their hand.
 */
import { CARDS, baseAtk } from '../cards';
import { effAtk, effDef, other, tributesRequired } from '../engine';
import type { DuelistBrain } from '../brain';
import type { CardInstance, DuelState, PendingChoice, PlayerId } from '../types';
import { bodyCount, findOwn, inHand, inPile, myBodies, theirBoard, turnStartBurn } from './common';

const RA = 'the-winged-dragon-of-ra';

/** Is the God already standing, face-up? */
const raStanding = (state: DuelState, me: PlayerId): CardInstance | undefined =>
  myBodies(state, me).find((m) => m.slug === RA && m.face === 'up');

/**
 * What Ra would fight with if it were paid for out of this board.
 *
 * The bodies are read at their effective ATK, which is what the engine totals
 * a moment before they hit the Graveyard — so a board standing in Melchid's
 * aura is worth five hundred a head more to the God than the printed cards
 * say. The three hundred a head for the Graveyard counts the monsters already
 * there plus the ones about to be, because the Tributes arrive before the
 * number is read.
 */
function raArrivalAtk(state: DuelState, me: PlayerId): number {
  const p = state.players[me];
  const need = tributesRequired(RA, state, me, true) || 3;
  const bodies = myBodies(state, me)
    .filter((m) => CARDS[m.slug]?.type !== 'Divine-Beast')
    .map((m) => effAtk(state, m, me))
    .sort((a, b) => b - a);
  if (bodies.length < need) return 0;
  /* The cheapest bodies pay, which is what the engine's own picker does — the
     three zones mean a God usually eats the whole board anyway. */
  const paying = bodies.slice(-need);
  const graveMonsters = p.grave.filter((c) => CARDS[c.slug]?.kind === 'monster').length;
  return paying.reduce((a, b) => a + b, 0) + (graveMonsters + need) * 300;
}

/**
 * What Ra would be worth if one more body joined the board.
 *
 * `raArrivalAtk` answers nothing at all below the full price, which is the
 * right answer for "summon it now" and the wrong one for "is it worth
 * fetching" — a Viser Des lands beside another Viser Des, so a board of two is
 * a board of three by the time the God is asked for. This fills the missing
 * bodies in with the smallest one standing, which is what would actually pay.
 */
function raProspect(state: DuelState, me: PlayerId): number {
  const need = tributesRequired(RA, state, me, true) || 3;
  const bodies = myBodies(state, me)
    .filter((m) => CARDS[m.slug]?.type !== 'Divine-Beast')
    .map((m) => effAtk(state, m, me))
    .sort((a, b) => a - b);
  if (!bodies.length) return 0;
  const paying = [...bodies];
  /* Nothing better to assume than more of the same: the cheapest body standing
     is the one the next one will resemble. */
  while (paying.length < need) paying.push(bodies[0]);
  const graveMonsters = state.players[me].grave.filter((c) => CARDS[c.slug]?.kind === 'monster').length;
  return paying.slice(0, need).reduce((a, b) => a + b, 0) + (graveMonsters + need) * 300;
}

/**
 * Life Points as ammunition.
 *
 * Once a turn Ra pours everything but one into its own ATK. A God standing in
 * front of eight thousand Life Points is therefore an eight-thousand swing
 * waiting for a Battle Phase, and Life Points spent on anything else are
 * ammunition spent. Worth counting only while the God can actually use them —
 * standing, or close enough to land.
 */
function sunReach(state: DuelState, me: PlayerId): number {
  const p = state.players[me];
  const god = raStanding(state, me);
  const coming = !god && (inHand(state, me, RA) || inPile(state, me, RA)) && bodyCount(state, me) >= 2;
  if (!god && !coming) return 0;
  const ammo = Math.max(0, p.lp - 1);
  const body = god ? effAtk(state, god, me) : raArrivalAtk(state, me);
  const theirLp = state.players[other(me)].lp;
  /* Reach that ends the duel is a different thing from reach that dents it,
     and the search can only see the second. */
  if (god && body + ammo >= theirLp) return 1200;
  return Math.min(900, ammo * 0.06) * (god ? 1 : 0.4);
}

/**
 * The God Phoenix: a thousand Life Points, and every monster they control is
 * gone. Once a turn, for as long as Ra stands — so it is worth what their
 * board is worth, every turn, and the beam only ever sees one of them.
 */
function phoenixReach(state: DuelState, me: PlayerId): number {
  const god = raStanding(state, me);
  if (!god || state.players[me].lp <= 1000) return 0;
  const t = theirBoard(state, me);
  const board = t.atks.reduce((a, b) => a + b, 0) + t.hidden * 1200;
  return Math.min(700, board * 0.12);
}

/**
 * How much of the God's price this board has already paid, priced by what the
 * God would actually arrive as. A Ra fed three Viser Des is a 1500 body and
 * this says so; a Ra fed a board standing in Melchid's aura is worth landing.
 */
function raReadiness(state: DuelState, me: PlayerId): number {
  const p = state.players[me];
  if (raStanding(state, me)) return 0;
  const access = inHand(state, me, RA) ? 1 : inPile(state, me, RA) ? 0.3 : 0;
  if (access <= 0) return 0;
  const need = tributesRequired(RA, state, me, true) || 3;
  const paid = Math.min(1, bodyCount(state, me) / need);
  if (paid <= 0) return 0;
  const arrival = raArrivalAtk(state, me);
  /* Nothing at all for a God that would land smaller than the bodies that
     paid for it — which, in this deck, is most boards. */
  if (arrival <= 0) return access * paid * 120;
  const now = !p.normalSummonUsed && bodyCount(state, me) >= need;
  return access * paid * (arrival * 0.3 + 200) * (now ? 0.3 : 0.22);
}

/**
 * The engine that collects whether or not the God ever arrives.
 *
 * Damage that lands at the start of every turn, counted for the turns it will
 * plausibly keep landing rather than for the one the beam happens to be
 * looking at. Capped, because a burn clock is an advantage and not a win: they
 * are drawing cards the whole time it ticks.
 */
function burnClock(state: DuelState, me: PlayerId): number {
  const burn = turnStartBurn(state, me);
  if (!burn) return 0;
  const theirLp = state.players[other(me)].lp;
  const turns = Math.min(6, Math.ceil(theirLp / burn));
  /* Worth most when it alone would finish them, because then the deck does
     not have to do anything else at all. */
  return Math.min(1600, burn * 0.5 + (turns <= 3 ? 500 : 0));
}

/**
 * Coffin Seller bills fifteen hundred every time one of my own monsters dies,
 * and this deck kills its own on purpose: Revival Jam answers its own death by
 * coming back to die again. Face-up, with something fragile standing, that is
 * a second burn clock the beam cannot see.
 */
function coffinClock(state: DuelState, me: PlayerId): number {
  const p = state.players[me];
  const seller = p.spellTrap?.slug === 'coffin-seller' && p.spellTrap.face === 'up';
  if (!seller) return 0;
  const jam = myBodies(state, me).some((m) => m.slug === 'revival-jam') || p.grave.some((c) => c.slug === 'revival-jam');
  const fragile = myBodies(state, me).length;
  return (jam ? 600 : 0) + Math.min(400, fragile * 120);
}

/** The whole of what the deck knows, on top of the general evaluation. */
function bonus(state: DuelState, me: PlayerId): number {
  return raReadiness(state, me) + sunReach(state, me) + phoenixReach(state, me) + burnClock(state, me) + coffinClock(state, me);
}

/**
 * Which card. Viser Des asks the deck's one real question — the God, the burn,
 * the wall or the toll — and the answer is the board, not the biggest number.
 */
function rankChoice(state: DuelState, me: PlayerId, pending: PendingChoice): string[] | null {
  const p = state.players[me];
  const summoning = /Special Summon/i.test(pending.reason);
  const stealing = /control/i.test(pending.reason);
  const t = theirBoard(state, me);
  const theirBest = t.atks.length ? Math.max(...t.atks) : 0;
  const bodies = bodyCount(state, me);
  const burn = turnStartBurn(state, me);

  const worthOf = (c: CardInstance): number => {
    const slug = c.slug;
    if (stealing || c.owner !== me) {
      const body = state.players[other(me)].monsters.find((m) => m?.uid === c.uid);
      const atk = body ? effAtk(state, body, other(me)) : baseAtk(slug);
      /* Theirs is worth taking for what it hits with and for the Tribute it
         becomes — a borrowed body is a body the God can eat. */
      return atk * 0.4 + (inHand(state, me, RA) ? 260 : 0);
    }
    if (summoning) {
      /* A body called to the field is worth what it does and what the God
         would get for it: Ra eats effective ATK, so a big body called back is
         a bigger God. */
      let v = baseAtk(slug) * 0.3 + effDef(state, c, me) * 0.05;
      if (inHand(state, me, RA) && bodies < 3) v += 220 + baseAtk(slug) * 0.2;
      switch (slug) {
        case 'revival-jam':
          v += 220;
          break;
        case 'bowganian':
          v += 300;
          break;
        case 'granadora':
          v += 180;
          break;
        case 'viser-des':
          v += 80;
          break;
      }
      return v;
    }
    /* Coming to the hand — Viser Des's question, mostly. */
    let v = baseAtk(slug) * 0.1;
    switch (slug) {
      case RA:
        /* Priced by what it would arrive as and NOT by its printed ATK, which
           is nought — the whole card is the bodies it eats. A flat number here
           lost the fetch to Bowganian by ten points with a 5400 God waiting,
           which is how this came to be measured rather than guessed. */
        v += bodies >= 2 ? 300 + raProspect(state, me) * 0.1 : 200;
        break;
      case 'bowganian':
        /* Eleven hundred at every turn start, and a second one arrives with
           the first — but only once a Normal Summon can be spared for it, so
           a board that already has a plan for this turn values it lower. */
        v += 300 + (burn > 0 ? 120 : 0) + (p.normalSummonUsed ? 0 : 120);
        break;
      case 'nightmare-wheel':
        /* Negates the swing, binds the thing that swung for as long as it
           stands, and bills eight hundred a turn afterwards. Worth what it is
           pointed at, which is their biggest attacker. */
        v += 180 + theirBest * 0.2;
        break;
      case 'coffin-seller':
        /* Fifteen hundred every time one of mine dies, and this deck kills its
           own on purpose. */
        v += 180 + (p.grave.some((c) => c.slug === 'revival-jam') || myBodies(state, me).some((m) => m.slug === 'revival-jam') ? 320 : 0) + myBodies(state, me).length * 90;
        break;
      case 'metal-reflect-slime':
        v += theirBest > 2000 ? 300 : 160;
        break;
      case 'monster-reborn':
        v += 260;
        break;
      case 'granadora':
        /* Life Points are the God's ammunition, so gaining them is loading. */
        v += inHand(state, me, RA) || inPile(state, me, RA) ? 220 : 120;
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

export const YAMIMARIK: DuelistBrain = { id: 'yamimarik', bonus, rankChoice };
