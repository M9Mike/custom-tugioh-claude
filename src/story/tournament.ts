/**
 * The tournament, and the one number that opens it.
 *
 * Nothing runs yet — there is no bracket, no hall and no seeding. What exists
 * today is the *door*, and the door is a count: ninety-nine cards on your name
 * and you are in it. This file is that number and the two readings of it every
 * other file wants, so when the tournament is built it is built around a
 * threshold that is already written down in one place and already being talked
 * about by everybody in the city.
 *
 * ## Why a card count and not a win count
 *
 * Wins are a number the player cannot see and cannot plan against. A
 * collection is on the screen, it goes up in threes when a pack opens, and
 * every duelist in the world is visibly a piece of it — so "ninety-nine" is a
 * sentence an NPC can say and a player can act on the same afternoon. It also
 * says the right thing about what the tournament is for: a hundred cards is not
 * a wall, it is proof you have been out there playing, which is the whole of
 * what the organiser is filtering for.
 *
 * ## What is at stake in it
 *
 * Cards and money, both ways — a bounty tournament, which is the city's own
 * economy at scale rather than a new one: every duelist in the hall carries a
 * price, beating them pays it in cards and coin, and losing to them costs. The
 * conversations in `npcs.ts` say the halves of that; `shop.ts` already holds
 * the machinery (`BOUNTY`, `FORFEIT`) it will be built out of.
 *
 * No three.js, no server, no profile shape: this is the rule, and whoever holds
 * a collection can ask it a question.
 */

/** Cards on your name before the hall will seat you. */
export const TOURNAMENT_CARDS = 99;

/** How many more are needed — never negative, so a line can print it. */
export function cardsLeft(held: number): number {
  return Math.max(0, TOURNAMENT_CARDS - held);
}

/** Is the hall open to somebody holding this many? */
export function tournamentOpen(held: number): boolean {
  return held >= TOURNAMENT_CARDS;
}
