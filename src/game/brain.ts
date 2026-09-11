/**
 * What one duelist's deck knows about itself.
 *
 * The search is general: it reads every card off the effect DSL and prices
 * what it can derive. A deck built around a combo knows things no derivation
 * reaches — that a Polymerization with both halves of a Fusion in hand is a
 * turn waiting to happen, that a Winged Kuriboh and a Transcendent Wings are
 * worth more the bigger the board across the table. A brain adds exactly
 * those terms, from public information only, and ranks the deck's own
 * questions. Everything else — the beam, the worlds, the judge — is shared.
 *
 * A separate file from `ai.ts` so a brain can import the engine without a
 * cycle; the registry in `brains/` is what the search reads.
 */
import type { DuelState, PendingChoice, PlayerId } from './types';

export interface DuelistBrain {
  /** The `decklists.json` id this brain plays. */
  id: string;
  /**
   * Extra evaluation for `me`'s position, in the same Life-Point-ish units
   * `evaluate` uses. Public information only: own hand, own Deck's contents
   * (never its order), both fields as they are shown, both Graveyards, the
   * other hand's SIZE. Called on every node, so it must be cheap.
   */
  bonus?: (state: DuelState, me: PlayerId) => number;
  /**
   * The order this deck answers one of its own questions in — best first, as
   * uids from `pending.options`. Null or empty hands the question back to the
   * engine's default ranking.
   */
  rankChoice?: (state: DuelState, me: PlayerId, pending: PendingChoice) => string[] | null;
}
