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
import { DECK_SIZE } from './roster';

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
  /*
   * Tina is not here, and her absence is the point.
   *
   * She is the one duelist who does not pay a bounty, because she plays for
   * money on the table instead — see `WAGER`. Her winnings come out of the pot
   * and the pot is the two stakes, so a line in this table would be a second
   * source of money for the same win. She still hands over a pack like everyone
   * but Solomon; it is only the coin that changed hands differently.
   */
  /*
   * A hundred, against the one and two the street pays, and it is not a
   * difficulty curve — it is the only money in the game that is not a share of
   * somebody's cards.
   *
   * Beating Tony pays a dollar and his deck; beating Solomon pays a hundred and
   * nothing else, because he keeps his cards (see `KEEPS_THEIR_CARDS`). The
   * number is what makes the fixture worth walking back to when the prize is
   * not a pack, and it is his money rather than his collection, which is the
   * right way round for a man who owns a shop.
   */
  solomon: 100,
  /*
   * Three thousand, and it is the only money in the game that comes from
   * somebody who is not supposed to be here.
   *
   * Ash keeps his cards like Solomon (see `KEEPS_THEIR_CARDS`) — a Pokémon in a
   * Duel Monsters collection would be a hole in the world — so what a win is
   * worth has to be the money, and the money has to be worth the thing he asks
   * for first: a card of yours on the table. See `CARD_WAGER`.
   */
  ash: 3000,
  /*
   * The three Amazons: five, ten and fifteen, which is the order they stand in
   * and the order they say they stand in. Antiope is the one you practise on,
   * Hippolyta is the one worth walking back for.
   *
   * They are the first duelists who charge for losing as well as paying for
   * winning — a dollar a time, see `FORFEIT` — so the money moves both ways
   * across the same table and beating them is worth the difference.
   */
  antiope: 5,
  panthesilea: 10,
  hippolyta: 15,
  /*
   * Step Lane, and the first table in the city where the money is against you.
   *
   * Fifteen and ten for beating them, twenty for losing either way. Kaela's
   * machines are the harder deck — a 2600 ace behind a King that pays every
   * machine on her side four hundred — so she is the one worth fifteen, and
   * the break-evens follow the difficulty: 1.3 wins a loss against her, 2.0
   * against Seraphina. They are the last two before the tournament and they
   * are priced like it.
   */
  kaela: 15,
  seraphina: 10,
  /*
   * The four who came for the tournament, and the top of the market.
   *
   * Twenty for Joey and Mai, twenty-five for Yugi and thirty for Yami — the
   * order the ratings put their decks in (`ENTRANTS` in `tournament.ts`), and
   * the order the city would put them in anyway. They pay a pack like
   * everybody else; the money is what makes going back for a second win worth
   * it after their chip is already in your pocket.
   */
  joey: 20,
  mai: 20,
  yugi: 25,
  yami: 30,
};

/**
 * What losing to this duelist costs, in dollars.
 *
 * ## Why anybody charges for losing
 *
 * Because a bounty with nothing against it is a wage: the worst thing that can
 * happen at a free table is that you try again, so the optimal play against
 * every duelist in the city is to keep sitting down until the cards fall your
 * way. A dollar on the other side of the ledger is small enough to be no
 * punishment and large enough to make the fifteen-dollar fixture a thing you
 * choose rather than grind. Mike's rule, and the sisters are the first to have
 * it.
 *
 * ## Taken at the table, not asked for afterwards
 *
 * The dollar leaves the player's money the moment the duel is *seated*
 * (`/api/room`) and comes back with the bounty on a win that has been proved
 * (`/api/story/pack`). Exactly the escrow Tina's stake uses, and for exactly
 * her reasons: a win is claimed, a loss is claimed by nobody, and deducting on
 * a reported loss would be asking the loser to report it. It also settles
 * walking out — seeing the opening hand and closing the tab is a loss the
 * table has already been paid for.
 *
 * So a win is `+BOUNTY` (the dollar comes home with it), a loss is `-1`, and
 * refreshing out of a bad board is `-1`.
 *
 * Absent means losing costs nothing, which is everybody else.
 */
export const FORFEIT: Record<string, number> = {
  antiope: 1,
  panthesilea: 1,
  hippolyta: 1,
  /* Twenty, against a bounty of ten and fifteen. The sisters charge a dollar
     to keep a free table from being a wage; these two charge enough that
     sitting down is a decision. Twenty is also the floor on who may sit: the
     route will not seat a duel somebody cannot cover. */
  kaela: 20,
  seraphina: 20,
};

/** What losing to this duelist costs. Zero for anyone not on the list. */
export function forfeitFor(duelistId: string): number {
  return FORFEIT[duelistId] ?? 0;
}

/** What beating this duelist pays. Zero for anyone not on the list. */
export function bountyFor(duelistId: string): number {
  return BOUNTY[duelistId] ?? 0;
}

/**
 * Who keeps their cards when they lose.
 *
 * Every other duelist in this game hands over a pack of their own deck when
 * they are beaten, which is how a collection grows. Solomon does not, and it is
 * a fact about the fixture rather than a balance lever: duelling him is
 * *practice against the best*, and a practice partner who paid you in cards
 * every time would be the shortest route to owning the game rather than a hard
 * match you go back to. He pays in money instead, out of his own till.
 *
 * A set rather than a flag on the duelist record, and in this file rather than
 * in `decklists.json`, for the same reason `BOUNTY` is here: what a win is
 * *worth* is the shop's business, and the decklist should stay a list of cards
 * that anybody can rewrite without changing what beating him does. Mike is
 * going to change Solomon's deck entirely, more than once.
 */
export const KEEPS_THEIR_CARDS = new Set<string>(['solomon', 'ash']);

/** Does beating this duelist hand over a pack of their deck? */
export function givesAPack(duelistId: string): boolean {
  return !KEEPS_THEIR_CARDS.has(duelistId);
}

/* ------------------------------------------------------------------ */
/* Duelists who play for money on the table                            */
/* ------------------------------------------------------------------ */

/**
 * Who will not sit down without a stake, and what they will sit down for.
 *
 * A bounty is the house paying you for a win. A wager is two people putting the
 * same money up and one of them walking off with all of it — so unlike `BOUNTY`
 * it can take money as well as give it, which makes *when* it moves the whole
 * question.
 *
 * It moves at the table. The stake leaves the player's money the moment the
 * duel is seated and the pot comes back doubled if they win, which settles
 * three things a payout-on-result could not:
 *
 * - **A loss costs, without the client admitting anything.** Winning is claimed
 *   through `/api/story/pack`; losing is not claimed at all, because there is
 *   nothing to collect. Deducting on a reported loss would be asking the loser
 *   to report it, and nobody would.
 * - **You cannot bet what you have not got.** The check happens where the money
 *   is, before the room exists, so there is no path to a negative balance and
 *   `npm run shop`'s rule about that still holds.
 * - **Walking out costs the stake.** Seating a duel, seeing the opening hand and
 *   closing the tab is a loss she has already been paid for. That is the right
 *   answer and it is a property of escrow rather than a rule anybody wrote.
 *
 * Both sides stake the same amount, so a win is +stake and a loss is −stake. The
 * player picks the figure, which is why the range is here and the choice is four
 * replies in her script rather than a slider: `npm run rules` can read a table,
 * and a conversation you can read top to bottom is the house style.
 */
export const WAGER: Record<string, { min: number; max: number }> = {
  /* Two to five. Two because that is what beating the street pair twice buys,
     so she is reachable from the shop door without being free; five because a
     new player's whole purse is a few dollars and a bet that can take all of it
     is a bet nobody takes twice. */
  tina: { min: 2, max: 5 },
};

/** What this duelist will play for, or `null` if they do not play for money. */
export function wagerFor(duelistId: string): { min: number; max: number } | null {
  return WAGER[duelistId] ?? null;
}

/* ------------------------------------------------------------------ */
/* A duelist who plays for a card                                      */
/* ------------------------------------------------------------------ */

/**
 * Who will not sit down unless one of *your* cards is on the table.
 *
 * Tina's stake is money and the pot is two stakes; Ash's stake is a card and
 * the pot is one-sided by design. Win and the card comes back with three
 * thousand dollars (`BOUNTY`); lose and the card is his, which in a collection
 * that holds one of everything is a real loss — and if it was in your deck,
 * your deck is a card short and the game will not seat you again until it is
 * twenty-five (see `deckIsShort`).
 *
 * The same escrow as the money, for the same three reasons written on `WAGER`:
 * the card leaves the collection when the duel is seated, a claimed win is the
 * only road back, and nobody is asked to own up to a loss. What is different is
 * that the card has to be *chosen*, so the conversation opens a picker over the
 * collection rather than offering four replies.
 */
export const CARD_WAGER = new Set<string>(['ash']);

/** Does this duelist ask for a card rather than money? */
export function wagersACard(duelistId: string): boolean {
  return CARD_WAGER.has(duelistId);
}

/**
 * Why a card cannot be put on the table, or `null` when it can.
 *
 * `few` is the owner's rule word for word: "you can't wager a card if you
 * don't have over 25 cards" — a collection that is exactly a deck has nothing
 * spare, and losing out of it would be losing the ability to duel at all.
 * `unowned` covers a slug the client made up as much as one it no longer has.
 */
export type WagerRefusal = 'few' | 'unowned';

export function refuseWager(profile: StoryProfile, slug: string): WagerRefusal | null {
  if (profile.collection.length <= DECK_SIZE) return 'few';
  if (!profile.collection.includes(slug)) return 'unowned';
  return null;
}

/**
 * The collection with the wagered card taken out of it — one copy, the first.
 *
 * The deck is deliberately left alone. The player is about to duel *with* the
 * deck they sleeved, wagered card and all; what they have put up is the card's
 * ownership, not its seat. Which is why a loss leaves a deck naming a card the
 * collection no longer holds, and `mendDeck` exists.
 */
export function escrowCard(profile: StoryProfile, slug: string): StoryProfile {
  const at = profile.collection.indexOf(slug);
  if (at < 0) return profile;
  return { ...profile, collection: [...profile.collection.slice(0, at), ...profile.collection.slice(at + 1)] };
}

/** The collection with a won card back in it. */
export function returnCard(profile: StoryProfile, slug: string): StoryProfile {
  return { ...profile, collection: [...profile.collection, slug], fresh: profile.fresh };
}

/**
 * A deck that holds only cards the collection still does.
 *
 * Applied once a wager is settled or abandoned — never while a duel is in
 * flight, because during one the deck is *meant* to name a card the collection
 * has lent to the table. Cards are counted, not merely named: a collection may
 * one day hold two of something, and a deck with two must lose only one.
 */
export function mendDeck(profile: StoryProfile): StoryProfile {
  if (!profile.deck) return profile;
  const left = new Map<string, number>();
  for (const slug of profile.collection) left.set(slug, (left.get(slug) ?? 0) + 1);
  const deck = profile.deck.filter((slug) => {
    const n = left.get(slug) ?? 0;
    if (n <= 0) return false;
    left.set(slug, n - 1);
    return true;
  });
  return deck.length === profile.deck.length ? profile : { ...profile, deck };
}

/** A sleeved deck that is no longer the size the rules demand. */
export function deckIsShort(profile: StoryProfile): boolean {
  return !!profile.deck && profile.deck.length !== DECK_SIZE;
}

/**
 * What a duelist who plays for money has in their pocket, and the floor it
 * never goes under.
 *
 * ## Why they have a balance at all
 *
 * Because a wager without one is a faucet. She matches your stake out of
 * nowhere and loses it back to you for ever, so twenty duels at five dollars is
 * a hundred dollars minted by patience — which is not a difficulty curve, it is
 * a job. A purse makes beating her *spend* something of hers: a hundred dollars
 * is what she brought, and when it is gone the size of the game she can offer
 * has gone with it.
 *
 * ## Why the floor
 *
 * So she is never a character you cannot play. A duelist with nothing in her
 * pocket would be a duel prompt that refuses every answer, which reads as a
 * bug however correct it is. Two dollars is the bottom of her range, so at the
 * floor she can still always take you on for the smallest game — and *only*
 * the smallest, which is the point: the last of her money buys a two dollar
 * duel and never a five dollar one.
 *
 * ## Which way it moves
 *
 * Down, on a win the server has already proved — see `/api/story/pack`. It does
 * not climb back when she wins, and that is a decision rather than an
 * oversight: crediting her would mean trusting somebody's word for a loss
 * nobody has to report, and a purse that only falls is a budget the player can
 * empty exactly once. Mike asked for a hundred dollars that cannot be farmed
 * for fives, and this is that number and nothing more clever.
 *
 * Keyed by duelist id like everything else here, and the table is the whole
 * feature: the next character who plays for money is a line in it.
 */
export const PURSE: Record<string, { start: number; floor: number }> = {
  tina: { start: 100, floor: 2 },
};

/** What this duelist brought, or `null` if they do not play for money. */
export function purseFor(duelistId: string): { start: number; floor: number } | null {
  return PURSE[duelistId] ?? null;
}

/**
 * How much they have left against this player.
 *
 * A save with nothing written down has never beaten them, so they still have
 * everything they came with. Clamped on read as well as on write, so a stored
 * figure from a bad write or an older build cannot put them under the floor.
 */
export function purseOf(purse: Record<string, number> | undefined, duelistId: string): number {
  const held = purseFor(duelistId);
  if (!held) return 0;
  const stored = purse?.[duelistId];
  if (typeof stored !== 'number' || !Number.isFinite(stored)) return held.start;
  return Math.max(held.floor, Math.min(held.start, Math.floor(stored)));
}

/**
 * The most they can be played for right now: their range, capped by what they
 * have actually got left.
 *
 * Never below the minimum, because of the floor — at the bottom of her purse
 * the smallest game is still on. Zero for anybody who does not wager.
 */
export function ceilingFor(duelistId: string, purse: Record<string, number> | undefined): number {
  const range = wagerFor(duelistId);
  if (!range) return 0;
  return Math.max(range.min, Math.min(range.max, purseOf(purse, duelistId)));
}

/**
 * What they have left after losing a duel for this much.
 *
 * The floor is applied here and not by the caller: this is the one line that
 * decides how poor she can get, and it should be readable in one place.
 */
export function purseAfterLosing(duelistId: string, purse: Record<string, number> | undefined, stake: number): number {
  const held = purseFor(duelistId);
  if (!held) return 0;
  return Math.max(held.floor, purseOf(purse, duelistId) - Math.max(0, stake));
}

/**
 * The whole ledger after a win, ready to be written to the save.
 *
 * The route that pays a win is the only writer, and what it wrote used to be
 * spelled out there: a spread, a computed key and two conditions, inside the
 * object literal of an `updateProfile`. None of that could be checked without
 * a finished duel, so the arithmetic that *can* be checked lived in this file
 * and the arithmetic that actually ran lived in the route. This is the same
 * expression with a name, so `npm run shop` exercises the thing that runs.
 *
 * Handed back unchanged for a duelist with no purse and for a duel with
 * nothing on the table, so the caller needs no conditions of its own.
 */
export function purseAfterWin(
  purse: Record<string, number> | undefined,
  duelistId: string,
  stake: number
): Record<string, number> | undefined {
  if (!purseFor(duelistId) || stake <= 0) return purse;
  return { ...(purse ?? {}), [duelistId]: purseAfterLosing(duelistId, purse, stake) };
}

/**
 * What the player is actually staking, whatever they asked for.
 *
 * Zero for a duelist who does not wager, so every caller can ask unconditionally
 * and the arithmetic stays the same shape for everybody. Anything that is not a
 * whole number of dollars inside the range becomes the minimum rather than an
 * error: this is money, the client chose it, and the server is the only opinion
 * that counts.
 *
 * `purse` is the other half of that opinion — she cannot match a bet she has
 * not got, so the ask is capped by what is left of hers as well as by her
 * range. Omitted, it is the range alone, which is what every caller who is not
 * seating a duel wants.
 */
export function stakeFor(duelistId: string, asked: unknown, purse?: Record<string, number>): number {
  const range = wagerFor(duelistId);
  if (!range) return 0;
  const n = typeof asked === 'number' && Number.isInteger(asked) ? asked : range.min;
  const top = purse ? ceilingFor(duelistId, purse) : range.max;
  return Math.max(range.min, Math.min(top, n));
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
    /* Bought counts as new. You have seen the card on the shelf, but you have
       not seen it in your own Trunk, and the Trunk is where you will be
       looking for it. */
    fresh: [...(profile.fresh ?? []), slug],
  };
}
