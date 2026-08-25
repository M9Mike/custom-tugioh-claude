/**
 * The Thrill of the Pull.
 *
 * Beat a duelist and you get a Pack. Open it and you pull up to three cards out
 * of *their* deck — not a global rarity table, not a random card from the game.
 * The reward for beating somebody is a piece of the thing that beat you, which
 * is the whole idea and the reason none of this is generic.
 *
 * No three.js and no server in here, exactly like `roster.ts` and `premade.ts`:
 * this is what a pull *is*. The route applies it, the panel animates it.
 *
 * ## A duelist's deck is twenty-five cards, not twenty-five names
 *
 * Tony runs three Feral Imps. Those are three cards, and pulling one leaves two.
 * So the pool is the deck *flattened* — every copy its own entry — and a pull
 * takes one entry out of it for good.
 *
 * Entries are keyed `slug#copy` rather than by index into that flattened list.
 * An index is only meaningful against the exact deck it was computed from, and
 * these decks are actively being rebalanced in another branch: reorder Tony's
 * list and every index a player had banked would silently point at a different
 * card. `feral-imp#2` still means the third Feral Imp however the list is
 * shuffled, and if a rebalance ever cuts him to two copies the stale key simply
 * stops matching anything, which costs the player nothing.
 *
 * ## Two rules that look like one
 *
 * **Within a pack, no card twice.** Three Feral Imps in one opening is three
 * lines of the same message and reads as a bug even when it is not. So a single
 * pack draws distinct *names*.
 *
 * **Across packs, every copy is consumed.** The three Imp entries still leave
 * the pool one at a time, which is what lets "all twenty-five" ever be reached.
 * The later ones land as cards you already own — and that is the honest shape of
 * it, because the collection holds one of each for now.
 *
 * Those two together mean a pack can come back with fewer than three cards near
 * the end, when what is left is four copies of two names. That is correct, and
 * the panel says so rather than padding it out.
 */

import { DUELIST_BY_ID } from '@/game/cards';
import type { StoryProfile } from './profile';

/** How many cards one pack may yield. */
export const PACK_SIZE = 3;

/** One card in a duelist's deck, as a thing that can be pulled exactly once. */
export type PullKey = string;

/** The name behind a key: `feral-imp#2` is a Feral Imp. */
export function slugOf(key: PullKey): string {
  const cut = key.lastIndexOf('#');
  return cut < 0 ? key : key.slice(0, cut);
}

/**
 * Every card in a duelist's deck, one entry per physical copy.
 *
 * Twenty-five entries for every duelist in the game. Returns an empty list for
 * an id that is not a duelist, which is what a caller gets if a deck is ever
 * renamed out from under a saved pack — the pack then opens to nothing rather
 * than throwing inside a route.
 */
export function packPool(duelistId: string): PullKey[] {
  const duelist = DUELIST_BY_ID[duelistId];
  if (!duelist) return [];
  const out: PullKey[] = [];
  for (const [slug, count] of duelist.deck) {
    for (let copy = 0; copy < count; copy++) out.push(`${slug}#${copy}`);
  }
  return out;
}

/** The entries of this duelist's deck the player has not taken yet. */
export function remainingPool(profile: StoryProfile, duelistId: string): PullKey[] {
  const taken = new Set(profile.pulled?.[duelistId] ?? []);
  return packPool(duelistId).filter((key) => !taken.has(key));
}

/** True once every copy of every card in that deck has been pulled. */
export function isExhausted(profile: StoryProfile, duelistId: string): boolean {
  const pool = packPool(duelistId);
  return pool.length > 0 && remainingPool(profile, duelistId).length === 0;
}

export interface Pull {
  /** The entry that left the pool. */
  key: PullKey;
  /** The card itself. */
  slug: string;
  /**
   * What happened to it.
   *
   * `kept` went into the Trunk. `duplicate` did not, because the collection
   * holds one of each for now — the player is told they already have it and
   * deliberately not told why a second is impossible.
   */
  outcome: 'kept' | 'duplicate';
}

export interface PackResult {
  duelistId: string;
  pulls: Pull[];
  /** Entries still in that duelist's pool after this pack. */
  left: number;
  /** True when this pack emptied the pool, or it was already empty. */
  exhausted: boolean;
}

/**
 * Draws up to `PACK_SIZE` entries, no two of the same card.
 *
 * `pick` returns a float in [0, 1) — `Math.random` in the route, a seeded
 * generator in the tests, which is the only reason it is a parameter.
 */
export function drawPack(pool: readonly PullKey[], pick: () => number = Math.random): PullKey[] {
  const left = [...pool];
  const drawn: PullKey[] = [];
  const names = new Set<string>();
  while (drawn.length < PACK_SIZE && left.length > 0) {
    const at = Math.floor(pick() * left.length);
    const key = left[Math.min(at, left.length - 1)];
    left.splice(Math.min(at, left.length - 1), 1);
    const slug = slugOf(key);
    if (names.has(slug)) continue;   // same card twice in one pack: skip it
    names.add(slug);
    drawn.push(key);
  }
  return drawn;
}

/**
 * Opens one pack against a profile, returning the new profile and what was in it.
 *
 * Pure: it does not write anything. The route hands the returned profile to
 * `updateProfile`, so a pack that loses its compare-and-set is re-drawn against
 * whatever is stored now rather than being applied twice.
 *
 * **A pulled entry leaves the pool whatever happens to it.** A duplicate is
 * still a card taken out of that duelist's deck — otherwise the pool could never
 * empty and "you have obtained all cards from this duelist" would be
 * unreachable for anyone who owned a card already.
 */
export function openPack(
  profile: StoryProfile,
  duelistId: string,
  pick: () => number = Math.random
): { profile: StoryProfile; result: PackResult } {
  const pool = remainingPool(profile, duelistId);
  const keys = drawPack(pool, pick);

  const owned = new Set(profile.collection);
  const pulls: Pull[] = [];
  const gained: string[] = [];
  for (const key of keys) {
    const slug = slugOf(key);
    if (owned.has(slug)) {
      pulls.push({ key, slug, outcome: 'duplicate' });
    } else {
      owned.add(slug);
      gained.push(slug);
      pulls.push({ key, slug, outcome: 'kept' });
    }
  }

  const pulled = { ...(profile.pulled ?? {}) };
  pulled[duelistId] = [...(pulled[duelistId] ?? []), ...keys];

  const next: StoryProfile = {
    ...profile,
    collection: gained.length ? [...profile.collection, ...gained] : profile.collection,
    pulled,
  };

  return {
    profile: next,
    result: {
      duelistId,
      pulls,
      left: remainingPool(next, duelistId).length,
      exhausted: isExhausted(next, duelistId),
    },
  };
}

/**
 * The cards a player owns but is not currently duelling with.
 *
 * Derived rather than stored, and that is the point: ownership is
 * `collection`, the deck is a selection out of it, and the Trunk is
 * everything else. Storing the Trunk as its own list would make two records
 * that have to agree about the same cards, and they would eventually not.
 *
 * When duplicates arrive, `collection` becomes a multiset and this becomes a
 * subtraction with counts. Nothing above this line has to change.
 */
export function trunkOf(profile: StoryProfile): string[] {
  const inDeck = new Set(profile.deck ?? []);
  return profile.collection.filter((slug) => !inDeck.has(slug));
}
