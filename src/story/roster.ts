/**
 * What a new Story Mode duelist is offered, and the rules their first deck is
 * built under.
 *
 * These are card *slugs* — the same keys `src/game/cards.ts` is built on — so a
 * deck built here is playable by the existing engine with no translation.
 * They are listed in the order they are offered, which is the order they were
 * given to us rather than anything the code derives; keep it.
 */

export const STARTER_POOL: string[] = [
  'mystical-elf',
  'kuriboh',
  'magician-of-faith',
  'saggi-the-dark-clown',
  'hitotsu-me-giant',
  'stop-defense',
  'swordsman-of-landstar',
  'kojikocy',
  'happy-lover',
  'just-desserts',
  'toon-alligator',
  'parrot-dragon',
  'negate-attack',
  'souls-of-the-forgotten',
  'lady-of-faith',
  'flying-fish',
  'jellyfish',
  'cocoon-of-evolution',
  'gift-of-the-mystical-elf',
  'leghul',
  'trakodon',
  'crawling-dragon',
  'cannon-soldier',
  'steel-ogre-grotto-1',
  'king-s-knight',
  'alpha-the-magnet-warrior',
  'viser-des',
  'legendary-fiend',
  'aswan-apparition',
  'possessed-dark-soul',
  'keldo',
  'agido',
  'mask-of-darkness',
  "ra-s-disciple",
];

/** The house deck size, matching the duel engine's own rule. */
export const DECK_SIZE = 25;

/**
 * How many of one card a Story Mode deck may hold.
 *
 * One, for now, and the reason is not the deck — it is the collection. A player
 * building here owns a single copy of each card, so a limit of one is really
 * just the collection's own arithmetic written down. The premade duelist decks
 * are untouched by this and still run their doubles.
 */
export const MAX_COPIES = 1;

export interface DeckProblem {
  ok: false;
  reason: string;
}

/**
 * Checks a deck against a collection, from the server's point of view.
 *
 * The builder will not let you assemble an illegal deck in the first place, but
 * the deck arrives over HTTP and is then locked to the account for good, so it
 * is checked again where it lands. Every rule is stated in the message: a
 * rejection the player cannot act on is the same as a crash.
 */
export function validateDeck(deck: unknown, collection: readonly string[]): { ok: true; deck: string[] } | DeckProblem {
  if (!Array.isArray(deck)) return { ok: false, reason: 'A deck must be a list of cards.' };
  const slugs = deck.filter((s): s is string => typeof s === 'string');
  if (slugs.length !== deck.length) return { ok: false, reason: 'A deck must be a list of card names.' };
  if (slugs.length !== DECK_SIZE) {
    return { ok: false, reason: `A deck is exactly ${DECK_SIZE} cards — this one has ${slugs.length}.` };
  }
  const owned = new Set(collection);
  const counts = new Map<string, number>();
  for (const slug of slugs) {
    if (!owned.has(slug)) return { ok: false, reason: `You do not own ${slug}.` };
    const n = (counts.get(slug) ?? 0) + 1;
    if (n > MAX_COPIES) {
      return { ok: false, reason: `Only ${MAX_COPIES} copy of each card is allowed for now — this deck has ${n} of ${slug}.` };
    }
    counts.set(slug, n);
  }
  return { ok: true, deck: slugs };
}
