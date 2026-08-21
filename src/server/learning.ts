/**
 * The part of the computer that remembers losing.
 *
 * Every real duel a deck plays against a human updates that deck's brain: a
 * small, bounded set of style parameters the search reads at plan time. Lose
 * with a fistful of unspent cards and the deck leans harder next game; lose
 * fast with everything overextended into a punishment and it grows more
 * careful; win cleanly and the current style consolidates. The knobs move a
 * little after every game — the way a human's judgement does — and never
 * further than the clamps, so a losing streak tilts the style without ever
 * unseating the play discipline the check suite pins.
 *
 * Neutral knobs are EXACTLY the shipped search: every pin and probe runs at
 * neutral, and the learning can only shade decisions inside the bounds those
 * checks were validated against.
 */
import { claim, readJson, writeJsonIf } from './store';

export interface DeckBrain {
  games: number;
  wins: number;
  /** Leans the race and pressure terms. Positive presses; negative holds. */
  aggression: number;
  /** Leans the paranoid prior and the standing-leak charge. */
  caution: number;
  updated: number;
}

export interface GameSummary {
  won: boolean;
  /** The AI seat's Life Points at the end, and the opponent's. */
  myLp: number;
  theirLp: number;
  /** Resources the AI still held when the duel ended. */
  myHandLeft: number;
  myBoardLeft: number;
  turns: number;
}

export const NEUTRAL: DeckBrain = { games: 0, wins: 0, aggression: 0, caution: 0, updated: 0 };

/** How far a knob may ever lean, and how fast one game may move it. */
export const KNOB_LIMIT = 0.6;
const LEARN_RATE = 0.08;

const clamp = (x: number) => Math.max(-KNOB_LIMIT, Math.min(KNOB_LIMIT, x));
const brainKey = (deckId: string) => `learn:brain:${deckId}`;

interface Held {
  revision: number;
  brain: DeckBrain;
}

export async function loadBrain(deckId: string): Promise<DeckBrain> {
  const held = await readJson<Held>(brainKey(deckId));
  return held?.brain ?? { ...NEUTRAL };
}

/**
 * One game's lesson, as a pure function so the rules suite can pin it.
 *
 * The signals are deliberately coarse — a human does not regression-fit a
 * loss either. What they notice is the SHAPE of it: "I never used half my
 * hand" or "I walked everything into a wipe again".
 */
export function updateBrain(brain: DeckBrain, s: GameSummary): DeckBrain {
  const next: DeckBrain = { ...brain, games: brain.games + 1, wins: brain.wins + (s.won ? 1 : 0), updated: brain.updated + 1 };
  if (s.won) {
    // Winning consolidates: the style that just worked drifts nowhere, and
    // old leanings relax a touch so one bad week does not define the deck.
    next.aggression = clamp(next.aggression * 0.97);
    next.caution = clamp(next.caution * 0.97);
    return next;
  }
  const resourcesIdle = s.myHandLeft >= 3 || (s.myBoardLeft >= 2 && s.theirLp > 4000);
  const overextended = s.myBoardLeft === 0 && s.turns <= 12;
  if (resourcesIdle) {
    // Lost holding cards: too passive — press harder next time.
    next.aggression = clamp(next.aggression + LEARN_RATE);
    next.caution = clamp(next.caution - LEARN_RATE / 2);
  }
  if (overextended) {
    // Lost with an empty board in a short game: fed something — respect
    // answers more, commit less.
    next.caution = clamp(next.caution + LEARN_RATE);
    next.aggression = clamp(next.aggression - LEARN_RATE / 2);
  }
  if (!resourcesIdle && !overextended) {
    // A plain loss nudges toward whatever the deck has NOT been trying.
    next.aggression = clamp(next.aggression + (next.aggression <= 0 ? LEARN_RATE / 2 : -LEARN_RATE / 2));
  }
  return next;
}

/** Records one finished duel, compare-and-swap so concurrent games both count. */
export async function recordGame(deckId: string, summary: GameSummary): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const held = await readJson<Held>(brainKey(deckId));
    if (!held) {
      /* Claimed atomically, so two duels ending in the same instant cannot
         both deal the first lesson — the loser re-reads and folds its game
         in on top. Force-creating here lost a lesson, and the race suite is
         what caught it. */
      const fresh: Held = { revision: 1, brain: updateBrain({ ...NEUTRAL }, summary) };
      if (await claim(brainKey(deckId), JSON.stringify(fresh))) return;
      continue;
    }
    const next: Held = { revision: held.revision + 1, brain: updateBrain(held.brain, summary) };
    if (await writeJsonIf(brainKey(deckId), next, held.revision, next.revision)) return;
  }
}
