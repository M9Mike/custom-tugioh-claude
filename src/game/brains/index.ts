/**
 * Every duelist who plays their own deck with more than the general search.
 *
 * Looked up by the `duelistId` a seat was dealt, which is on the state for
 * every duel there is — rooms, the bracket, the arena, the checks — so a brain
 * follows its deck everywhere without a call site having to name it.
 */
import type { DuelistBrain } from '../brain';
import { JADEN } from './jaden';
import { PRIESTSETO } from './priestseto';
import { YAMI } from './yami';
import { YAMIMARIK } from './yamimarik';

const BRAINS: Record<string, DuelistBrain> = {
  [JADEN.id]: JADEN,
  [YAMI.id]: YAMI,
  [PRIESTSETO.id]: PRIESTSETO,
  [YAMIMARIK.id]: YAMIMARIK,
};

export function brainFor(duelistId: string | undefined | null): DuelistBrain | null {
  return duelistId ? (BRAINS[duelistId] ?? null) : null;
}
