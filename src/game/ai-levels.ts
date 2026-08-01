/**
 * Which configuration the AI plays at, kept apart from the AI itself.
 *
 * `rooms.ts` and the tournament only need to name a level. Importing that name
 * from `ai.ts` would drag the whole rules engine along behind it, for the sake
 * of one string.
 */
export type AiLevel = 'rookie' | 'duelist' | 'champion';

export const AI_LEVEL_ORDER: AiLevel[] = ['rookie', 'duelist', 'champion'];

/**
 * The level the game actually plays at — every duel, every bracket match.
 *
 * There is no difficulty setting. The weaker configurations survive only so
 * `scripts/ai-arena.ts` has something to measure the strong one against;
 * nothing a player can reach ever selects one.
 */
export const GAME_AI: AiLevel = 'champion';
