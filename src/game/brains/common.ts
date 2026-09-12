/**
 * What every duelist brain needs to read a board, in one copy.
 *
 * Four decks now add their own terms to the evaluation, and the first three
 * questions each of them asks are the same three: what is standing across the
 * table, which of my own cards are real rather than imagined, and where is a
 * card I care about. Written once here rather than four times, for the reason
 * the rest of this codebase gives: a rule copied is a rule that drifts.
 *
 * Public information only. Own hand and own Deck's CONTENTS (never its order),
 * both fields as shown, both Graveyards, the size of their hand.
 */
import { CARDS } from '../cards';
import { effAtk, other } from '../engine';
import type { CardInstance, DuelState, PlayerId } from '../types';

/**
 * A card the plan may actually spend.
 *
 * A card drawn inside an imagined world is marked `worldBlind` — it is counted,
 * never spent, because the real turn will draw something else. A brain that
 * priced one would be building its deck's combo out of a card nobody has.
 */
export const known = (c: CardInstance): boolean => !c.turnFlags.worldBlind;

/** Their face-up bodies as they stand, and what they hide under card backs. */
export function theirBoard(state: DuelState, me: PlayerId): { atks: number[]; hidden: number; backrow: number; hand: number } {
  const foe = state.players[other(me)];
  const atks: number[] = [];
  let hidden = 0;
  for (const m of foe.monsters) {
    if (!m) continue;
    if (m.face === 'down') hidden += 1;
    else atks.push(effAtk(state, m, other(me)));
  }
  const backrow = (foe.spellTrap ? 1 : 0) + (foe.field ? 1 : 0);
  return { atks, hidden, backrow, hand: foe.hand.length };
}

/** Anywhere on my side a choice could be pointing. */
export function findOwn(state: DuelState, me: PlayerId, uid: string): CardInstance | null {
  const p = state.players[me];
  return (
    p.hand.find((c) => c.uid === uid) ??
    p.deck.find((c) => c.uid === uid) ??
    p.grave.find((c) => c.uid === uid) ??
    p.monsters.find((c) => c?.uid === uid) ??
    p.extra.find((c) => c.uid === uid) ??
    null
  );
}

/** Is this card in my hand, ready to be spent? */
export const inHand = (state: DuelState, me: PlayerId, slug: string): boolean =>
  state.players[me].hand.some((h) => known(h) && h.slug === slug);

/** Is this card anywhere I could still get it from — Deck or Graveyard? */
export const inPile = (state: DuelState, me: PlayerId, slug: string): boolean =>
  state.players[me].deck.some((c) => c.slug === slug) || state.players[me].grave.some((c) => c.slug === slug);

/** My own face-up bodies, as instances. */
export const myBodies = (state: DuelState, me: PlayerId): CardInstance[] =>
  state.players[me].monsters.filter((m): m is CardInstance => !!m);

/**
 * How many Tributes my board can pay, in bodies.
 *
 * Every body counts, tokens included — the price of a God is three bodies and
 * the decks that reach one do it with Kuriboh Tokens and Ka Tokens as often as
 * with monsters. Double Coston's discount is not applied here: it changes the
 * PRICE, which each brain asks the engine for, not the number of bodies stood
 * on the field.
 */
export const bodyCount = (state: DuelState, me: PlayerId): number => myBodies(state, me).length;

/**
 * Damage that arrives every turn on its own, from cards already standing.
 *
 * The beam searches one turn, so an engine that bills 1100 at the start of
 * every turn for the rest of the duel is worth, to it, exactly one turn of
 * 1100 — and only on the turn it happens to look at. `onOwnTurnStart` damage
 * is the whole of Yami Marik's plan B and most of his plan A, so somebody has
 * to count it. Read off the cards' own effects rather than a list of slugs, so
 * a card added to the deck tomorrow is counted the day it arrives.
 */
export function turnStartBurn(state: DuelState, me: PlayerId): number {
  let burn = 0;
  for (const m of myBodies(state, me)) {
    if (m.face === 'down') continue;
    for (const eff of CARDS[m.slug]?.effects ?? []) {
      if (eff.trigger !== 'onOwnTurnStart') continue;
      for (const op of eff.ops) {
        if (op.op === 'damage' && op.to === 'opp') burn += op.amount ?? 0;
      }
    }
  }
  const backrow = [state.players[me].spellTrap, state.players[me].field];
  for (const c of backrow) {
    if (!c || c.face === 'down') continue;
    for (const eff of CARDS[c.slug]?.effects ?? []) {
      if (eff.trigger !== 'onOwnTurnStart') continue;
      for (const op of eff.ops) {
        if (op.op === 'damage' && op.to === 'opp') burn += op.amount ?? 0;
      }
    }
  }
  return burn;
}
