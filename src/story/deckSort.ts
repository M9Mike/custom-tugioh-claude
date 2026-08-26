/**
 * The one order every deck is shown in, and the ways a Trunk may be narrowed.
 *
 * Pure, and free of three.js and React for the usual reason — this is what an
 * order *is*; `DeckBuilder` and the main menu are what it looks like.
 *
 * ## One order, everywhere
 *
 *   monsters · spells · traps
 *
 * and the monsters run by **what they cost to get onto the board**:
 *
 *   gods · 3 tributes · 2 · 1 · none · rituals · extra deck
 *
 * There were briefly two orders — the builder sorted by ATK and the menu by
 * tribute — and that was a mistake worth naming: the same twenty-five cards
 * looked like two different decks depending on which screen you opened them in,
 * so nothing you learned about a deck in one place helped you read it in the
 * other. A deck has one shape.
 *
 * Sorting by cost rather than by ATK is what makes that shape legible. Two decks
 * with the same top end play nothing alike if one pays for it with six tributes
 * and the other with two, and ATK-first hides exactly that.
 *
 * Gods lead their own rung rather than sharing the three-tribute one. They also
 * cannot be sorted by ATK even where you would want to: Slifer and Ra carry an
 * ATK of `-1` in the card data because theirs is counted at the table, and that
 * number puts the two strongest cards in the game below Kuriboh.
 *
 * Rituals sit below the whole ladder because a Ritual is not on it — it needs a
 * spell and a specific offering, which is a different way of paying. The Extra
 * Deck sits below that for the same reason and is ordered by ATK, having no
 * Summon cost of its own to sort by.
 *
 * ## And a name under everything
 *
 * Every comparison falls through to the card's name. Without it, cards that tie
 * — and they tie constantly, a deck is full of 1200-ATK monsters — come out in
 * whatever order the array happened to be in, which changes as you add and
 * remove. Cards appeared to shuffle themselves while you built. With it, the
 * order is a function of the deck's *contents* and nothing else.
 */

import { CARDS } from '@/game/cards';
import { tributesRequired } from '@/game/engine';

/* ------------------------------------------------------------------ */
/* The order                                                           */
/* ------------------------------------------------------------------ */

const nameOf = (slug: string) => CARDS[slug]?.name ?? slug;
const byName = (a: string, b: string) => nameOf(a).localeCompare(nameOf(b));

/**
 * ATK or DEF for sorting, with the counted-at-the-table ones pushed to the back.
 *
 * `-1` means "not printed" — Slifer and Ra, whose ATK is counted at the table.
 * Every real value is zero or more, so -1 sorts below all of them and above
 * nothing, which is what it should do.
 *
 * **It must be finite.** This returned `-Infinity` first, and the comparator
 * subtracts: `-Infinity - -Infinity` is `NaN`, a comparator that returns NaN is
 * not a comparator, and `Array.sort` given one produces a different answer
 * depending on the order it was handed. Slifer and Ra are the only two cards in
 * the game that tie on it, they are always adjacent, and the deck came out with
 * them swapped depending on nothing at all. Caught by the check that asserts the
 * order depends on the contents and nothing else, which is exactly the bug that
 * check exists for.
 */
function power(slug: string, key: 'atk' | 'def'): number {
  const v = CARDS[slug]?.[key];
  return typeof v === 'number' && v >= 0 ? v : -1;
}

/** Monsters, then spells, then traps. */
export function kindRank(slug: string): number {
  const card = CARDS[slug];
  if (!card) return 9;
  if (card.kind === 'monster') return 0;
  if (card.kind === 'spell') return 1;
  if (card.kind === 'trap') return 2;
  return 9;
}

/**
 * Where a monster sits on the ladder of what it costs to Summon.
 *
 * `tributesRequired` is the engine's own, called with nothing but a slug so it
 * answers for the card rather than for a board — the same function that charges
 * the player at the table, so a list can never disagree with the duel about what
 * something costs.
 */
export function summonRank(slug: string): number {
  const card = CARDS[slug];
  if (!card || card.kind !== 'monster') return 9;
  if (card.isFusion) return 6;                       // extra deck
  if (card.isRitual) return 5;
  if (card.type === 'Divine-Beast') return 0;        // gods, always first
  const need = Math.max(0, Math.min(3, tributesRequired(slug)));
  return 1 + (3 - need);                             // 3 -> 1, 2 -> 2, 1 -> 3, none -> 4
}

/** The canonical order: the one every deck is listed in. */
export function compareCards(a: string, b: string): number {
  const k = kindRank(a) - kindRank(b);
  if (k !== 0) return k;
  if (kindRank(a) === 0) {
    const r = summonRank(a) - summonRank(b);
    if (r !== 0) return r;
    const p = power(b, 'atk') - power(a, 'atk');
    if (p !== 0) return p;
  }
  return byName(a, b);
}

/** A list of slugs in the canonical order. The caller's array is left alone. */
export function deckOrder(slugs: readonly string[]): string[] {
  return [...slugs].sort(compareCards);
}

/**
 * A decklist of `[slug, count]` pairs in the canonical order.
 *
 * Pairs rather than slugs because that is how a duelist's deck is stored, and
 * expanding three Feral Imps into three entries to sort them would only mean
 * putting them back together afterwards.
 */
export function menuDeckOrder(
  entries: readonly (readonly [string, number])[]
): [string, number][] {
  return [...entries]
    .map(([slug, n]) => [slug, n] as [string, number])
    .sort((a, b) => compareCards(a[0], b[0]));
}

/**
 * The Extra Deck, listed after everything else.
 *
 * Nothing in it is Summoned by tribute, so the ladder has nothing to say: ATK
 * first, then name.
 */
export function menuExtraOrder(slugs: readonly string[]): string[] {
  return [...slugs].sort((a, b) => {
    const p = power(b, 'atk') - power(a, 'atk');
    return p !== 0 ? p : byName(a, b);
  });
}

/* ------------------------------------------------------------------ */
/* Narrowing the Trunk                                                 */
/* ------------------------------------------------------------------ */

/**
 * How the Trunk's monsters are ordered.
 *
 * Only the monsters — spells and traps are by name whichever of these is
 * chosen, because there is nothing else to order them by and a spell list that
 * rearranged itself when you pressed ATK would be a lie.
 *
 * `curve` is the canonical order and the default. `atk` and `def` throw the
 * ladder away entirely and sort on the number alone, which is the sort you want
 * when the question is "what is the biggest thing I own" rather than "what does
 * this deck do".
 */
export type TrunkSort = 'curve' | 'atk' | 'def';

export const TRUNK_SORTS: { key: TrunkSort; label: string }[] = [
  { key: 'curve', label: 'Curve' },
  { key: 'atk', label: 'ATK' },
  { key: 'def', label: 'DEF' },
];

/** Which kinds the Trunk is showing. */
export type TrunkFilter = 'all' | 'monster' | 'spell' | 'trap';

export const TRUNK_FILTERS: { key: TrunkFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'monster', label: 'Monsters' },
  { key: 'spell', label: 'Spells' },
  { key: 'trap', label: 'Traps' },
];

/** The Trunk, filtered to one kind and ordered by the chosen sort. */
export function trunkOrder(
  slugs: readonly string[],
  sort: TrunkSort,
  filter: TrunkFilter = 'all'
): string[] {
  const kept =
    filter === 'all' ? [...slugs] : slugs.filter((s) => CARDS[s]?.kind === filter);

  if (sort === 'curve') return kept.sort(compareCards);

  return kept.sort((a, b) => {
    const k = kindRank(a) - kindRank(b);
    if (k !== 0) return k;
    /* Only the monsters answer to ATK and DEF. */
    if (kindRank(a) === 0) {
      const p = power(b, sort) - power(a, sort);
      if (p !== 0) return p;
    }
    return byName(a, b);
  });
}

/**
 * Cards whose name, type, attribute or kind contains what was typed.
 *
 * Those are the words a player actually has in their head while building — a
 * search for "fiend" or "dark" should find what it obviously means. Empty query
 * returns everything rather than nothing.
 */
export function searchCards(slugs: readonly string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...slugs];
  return slugs.filter((slug) => {
    const c = CARDS[slug];
    if (!c) return false;
    return (
      c.name.toLowerCase().includes(q) ||
      (c.type ?? '').toLowerCase().includes(q) ||
      (c.attribute ?? '').toLowerCase().includes(q) ||
      c.kind.toLowerCase().includes(q)
    );
  });
}
