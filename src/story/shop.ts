/**
 * What a win is worth, and what Solomon will sell you.
 *
 * Pure data and the arithmetic over it — no three.js, no React, no server, the
 * same rule the rest of `src/story` follows. The route spends it, the panel
 * draws it.
 *
 * ## The player is never told how this works
 *
 * Not in a tooltip, not in a hint, not in a line of Grandpa's. Stock appears
 * when it appears and the game does not explain the rule, exactly as the
 * one-copy limit is never explained. Everything player-facing here is a price
 * and a refusal in his own voice; anything that would read as documentation
 * belongs in this file's comments and nowhere else.
 *
 * So: if you are adding to `STOCK`, do not add a "how to unlock" string with it.
 */

import { CARDS } from '@/game/cards';
import { compareCards } from './deckSort';
import type { StoryProfile } from './profile';

/**
 * What beating each duelist pays, in dollars.
 *
 * Per duelist rather than a flat rate, because who you beat is the only thing
 * that distinguishes one win from another right now. Keyed by the id in
 * `decklists.json` — the same id the room records for the far seat, which is
 * what lets the server work out a payout from the room alone.
 *
 * **A duelist not listed here pays nothing**, deliberately. Money is minted by
 * this table and by nothing else, so a character who arrives without a line in
 * it cannot quietly become a source of currency; they simply are not worth
 * anything until somebody decides what they are worth.
 */
export const BOUNTY: Record<string, number> = {
  tony: 1,
  sarah: 1,
};

/** What beating this duelist pays. Zero for anyone not on the list. */
export function bountyFor(duelistId: string): number {
  return BOUNTY[duelistId] ?? 0;
}

export interface ShopItem {
  slug: string;
  /** In dollars. Cards have a price only here — nothing sells one back. */
  price: number;
}

/**
 * Solomon's stock.
 *
 * Add a card by adding a line. Nothing else needs touching: the shelf sorts
 * itself into the same order a deck is listed in, the panel draws whatever is
 * here, and the route prices from this table rather than from anything a client
 * sends. The only rule is that the slug must be a real card, which `npm run
 * shop` checks.
 *
 * **And add no explanation with it.** Not a note about what makes it appear, not
 * an "unlocks at". How stock arrives is the one thing the game never tells
 * anybody.
 *
 * Blue-Eyes at 7,500 is not a mistake: at a dollar a win that is seven and a half
 * thousand duels. It is the number Mike chose and wants to watch, written down
 * here so nobody later "fixes" it on the assumption that a zero slipped in.
 */
export const STOCK: ShopItem[] = [
  { slug: 'blue-eyes-white-dragon', price: 7500 },
  { slug: 'alligator-s-sword', price: 25 },
];

/** The stock, in the same order a deck is listed in. */
export function shopStock(): ShopItem[] {
  return [...STOCK].sort((a, b) => compareCards(a.slug, b.slug));
}

export function priceOf(slug: string): number | null {
  return STOCK.find((s) => s.slug === slug)?.price ?? null;
}

/**
 * Why a purchase cannot go through, or `null` when it can.
 *
 * Returned as a reason rather than a message so the caller decides the wording:
 * the route answers an API and the panel answers in Solomon's voice, and those
 * are not the same sentence.
 */
export type Refusal = 'unstocked' | 'owned' | 'poor';

export function refuseBuy(profile: StoryProfile, slug: string): Refusal | null {
  const price = priceOf(slug);
  if (price === null || !CARDS[slug]) return 'unstocked';
  /*
   * Owned means owned anywhere — Trunk or Deck.
   *
   * The collection is the whole of what you have and the deck is a selection out
   * of it, so a card sleeved in your deck is still one you own and Solomon still
   * will not sell you a second. The same rule the pull uses, asked the same way,
   * because two different answers to "do you have this" is how a game ends up
   * selling somebody a duplicate it will not let them keep.
   */
  if (profile.collection.includes(slug)) return 'owned';
  if ((profile.money ?? 0) < price) return 'poor';
  return null;
}

/** The profile after a purchase that `refuseBuy` has already allowed. */
export function buy(profile: StoryProfile, slug: string): StoryProfile {
  const price = priceOf(slug) ?? 0;
  return {
    ...profile,
    money: (profile.money ?? 0) - price,
    collection: [...profile.collection, slug],
  };
}
