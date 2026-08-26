/**
 * What order cards are shown in, in the deck builder.
 *
 * Two different jobs wearing one coat. The **Deck** has a single canonical
 * order and the player has no say in it: a deck you are reading should look the
 * same every time you open it, so the eye learns where things are. The **Trunk**
 * is a collection you are rummaging through, so it sorts however you ask.
 *
 * Pure, and free of three.js and React for the usual reason — this is what an
 * order *is*, and `DeckBuilder` is what it looks like.
 *
 * ## The canonical order
 *
 *   gods · monsters by ATK · spells · traps
 *
 * Gods first because they are the reason you built the deck. They also cannot be
 * sorted with the other monsters even if you wanted to: Slifer and Ra carry an
 * ATK of `-1` in the card data, because theirs is computed at the table rather
 * than printed, and sorting on that number puts the two strongest cards in the
 * game below Kuriboh.
 *
 * ## And a second key, always
 *
 * Every comparison falls through to the card's name. Without it, cards that tie
 * on the first key — and they tie constantly, a deck is full of 1200-ATK
 * monsters — come out in whatever order the array happened to be in, which
 * changes as you add and remove. Cards appeared to shuffle themselves. Sorting by
 * name underneath makes the whole order a function of the deck's *contents* and
 * nothing else, so the same twenty-five always look the same.
 */

import { CARDS } from '@/game/cards';

/** How the Trunk may be sorted. The Deck is not sortable — see above. */
export type TrunkSort = 'type' | 'atk' | 'def' | 'name';

export const TRUNK_SORTS: { key: TrunkSort; label: string }[] = [
  { key: 'type', label: 'Type' },
  { key: 'atk', label: 'ATK' },
  { key: 'def', label: 'DEF' },
  { key: 'name', label: 'Name' },
];

/** Gods, then monsters, then spells, then traps. */
function group(slug: string): number {
  const card = CARDS[slug];
  if (!card) return 9;
  if (card.kind === 'monster') return card.type === 'Divine-Beast' ? 0 : 1;
  if (card.kind === 'spell') return 2;
  if (card.kind === 'trap') return 3;
  return 9;
}

const nameOf = (slug: string) => CARDS[slug]?.name ?? slug;
const byName = (a: string, b: string) => nameOf(a).localeCompare(nameOf(b));

/**
 * A monster's ATK or DEF for sorting, with the variable ones pushed to the back
 * of their own group rather than the front.
 *
 * `-1` means "computed at the table". Treated as the lowest possible value so it
 * cannot masquerade as a weak card among real numbers — the gods that carry it
 * are in group 0 and never reach this comparison anyway, which is the point of
 * separating them.
 */
function power(slug: string, key: 'atk' | 'def'): number {
  const v = CARDS[slug]?.[key];
  return typeof v === 'number' && v >= 0 ? v : -Infinity;
}

/**
 * The Deck's order. Fixed, and not a preference.
 *
 * Returns a new array; the caller's own list is left alone, because the stored
 * deck is the player's and its order is not this module's business.
 */
export function deckOrder(slugs: readonly string[]): string[] {
  return [...slugs].sort((a, b) => {
    const g = group(a) - group(b);
    if (g !== 0) return g;
    if (group(a) === 1) {
      const p = power(b, 'atk') - power(a, 'atk');
      if (p !== 0) return p;
    }
    return byName(a, b);
  });
}

/**
 * The Trunk's order, for the sort the player picked.
 *
 * `atk` and `def` still group by type — you are not looking for "the strongest
 * thing I own including spells", you are looking through your monsters. What
 * changes is which number orders them. `name` flattens the groups entirely,
 * because that is the sort you reach for when you know what you are looking for
 * and only want to find it.
 */
export function trunkOrder(slugs: readonly string[], sort: TrunkSort): string[] {
  if (sort === 'name') return [...slugs].sort(byName);
  return [...slugs].sort((a, b) => {
    const g = group(a) - group(b);
    if (g !== 0) return g;
    if (group(a) === 1 && (sort === 'atk' || sort === 'def')) {
      const p = power(b, sort) - power(a, sort);
      if (p !== 0) return p;
    } else if (group(a) === 1) {
      const p = power(b, 'atk') - power(a, 'atk');
      if (p !== 0) return p;
    }
    return byName(a, b);
  });
}

/**
 * Cards whose name or type contains what was typed.
 *
 * Matched against the printed name and the monster's type — "fiend" finds the
 * Fiends, "dark" finds the DARK attribute — because those are the words a player
 * actually has in their head while building. Empty query returns everything
 * rather than nothing.
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
