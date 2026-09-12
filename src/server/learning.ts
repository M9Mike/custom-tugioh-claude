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
import { CARDS, DUELISTS } from '../game/cards';
import {
  EMPTY_BOOK,
  EMPTY_FOE,
  lessonFrom,
  readDuel,
  updateBook,
  updateProfile,
  type Experience,
  type FoeProfile,
  type Lesson,
  type LineBook,
  type TracePoint,
} from '../game/experience';
import type { LogEntry, PlayerId } from '../game/types';

/**
 * How long a memory lives: a year, refreshed by every duel that touches it.
 *
 * Every learning key used to be written with the store's DEFAULT expiry, which
 * is the room's — ninety minutes. So a deck learned from a duel and forgot it
 * before the next evening: "the computer gets better after each duel" was
 * true for an hour and a half at a time, and the built-in style being thrown
 * away by the first recorded game (see `recordGame`) could never be noticed
 * because the record that threw it away had itself expired by morning.
 */
export const LEARN_TTL_SECONDS = 365 * 24 * 60 * 60;

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

/**
 * The style a deck is BUILT to play, read off its own list — the brain's
 * starting point before a single game has taught it anything.
 *
 * A deck that runs a fistful of trap-window answers was built to hold and
 * punish; one whose monsters average big was built to press; one carrying the
 * Forbidden One was built to survive, and pressing with it is playing
 * somebody else's deck. The old starting point was NEUTRAL for everyone,
 * which meant Exodia spent its first dozen losses learning what its decklist
 * already said. Coarse on purpose, and bounded well inside `KNOB_LIMIT` so
 * the games still get the last word — and every pinned check still runs at
 * NEUTRAL, which this function never touches.
 */
export function deckStyle(deckId: string): { aggression: number; caution: number } {
  const d = DUELISTS.find((x) => x.id === deckId);
  if (!d) return { aggression: 0, caution: 0 };
  let monsters = 0;
  let atkSum = 0;
  let answers = 0;
  let total = 0;
  let exodia = 0;
  for (const [slug, count] of d.deck) {
    const def = CARDS[slug];
    if (!def) continue;
    total += count;
    if (def.kind === 'monster') {
      monsters += count;
      atkSum += Math.max(0, def.atk ?? 0) * count;
    }
    if ((def.effects ?? []).some((e) => e.trigger === 'trap')) answers += count;
    if (def.name.includes('Forbidden One') || def.name === 'Exodia the Forbidden One') exodia += count;
  }
  if (exodia >= 3) return { aggression: -0.3, caution: 0.3 };
  const meanAtk = monsters ? atkSum / monsters : 0;
  const aggression = Math.max(-0.3, Math.min(0.3, ((meanAtk - 1450) / 900) * 0.3));
  const caution = Math.max(0, Math.min(0.3, (answers / Math.max(1, total)) * 1.5));
  return { aggression: Math.round(aggression * 100) / 100, caution: Math.round(caution * 100) / 100 };
}

export async function loadBrain(deckId: string): Promise<DeckBrain> {
  const held = await readJson<Held>(brainKey(deckId));
  if (held) return held.brain;
  /* A deck that has never played starts from what it was built to be, not
     from nowhere. Only the two style knobs — games and wins stay zero, and
     the first recorded game folds its lesson in on top exactly as before. */
  const style = deckStyle(deckId);
  return { ...NEUTRAL, aggression: style.aggression, caution: style.caution };
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
/**
 * The first lesson a deck ever records, folded onto the style it was built
 * with. Pure, so the seam between `deckStyle` and `updateBrain` — the one the
 * rules suite never crossed, which is how a first duel came to wipe the style
 * unnoticed — is pinned.
 */
export function firstLesson(deckId: string, summary: GameSummary): DeckBrain {
  return updateBrain({ ...NEUTRAL, ...deckStyle(deckId) }, summary);
}

export async function recordGame(deckId: string, summary: GameSummary): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const held = await readJson<Held>(brainKey(deckId));
    if (!held) {
      /* Claimed atomically, so two duels ending in the same instant cannot
         both deal the first lesson — the loser re-reads and folds its game
         in on top. Force-creating here lost a lesson, and the race suite is
         what caught it. */
      /* Onto the style the deck was BUILT with, not onto nothing. This
         started from bare NEUTRAL, so the one duel that created the record
         also discarded the decklist's own starting point — every deck the
         owner had ever duelled was running at neutral rather than at the
         style its list implies, and `loadBrain`'s comment above had promised
         otherwise all along. */
      const fresh: Held = { revision: 1, brain: firstLesson(deckId, summary) };
      if (await claim(brainKey(deckId), JSON.stringify(fresh), LEARN_TTL_SECONDS)) return;
      continue;
    }
    const next: Held = { revision: held.revision + 1, brain: updateBrain(held.brain, summary) };
    if (await writeJsonIf(brainKey(deckId), next, held.revision, next.revision, LEARN_TTL_SECONDS)) return;
  }
}

/* ------------------------------------------------------------------ */
/* The memories: an opponent's habits, a matchup's book, the lessons   */
/* ------------------------------------------------------------------ */

interface Kept<T> {
  revision: number;
  value: T;
}

const foeKey = (name: string, deckKey: string) => `learn:foe:${name.trim().toLowerCase()}|${deckKey}`;
const bookKey = (mine: string, theirs: string) => `learn:book:${mine}|${theirs}`;
const lessonsKey = (deckKey: string) => `learn:lessons:${deckKey}`;

/** How many lessons a deck keeps. Enough to read back a week of duels. */
const LESSONS_KEPT = 8;

/**
 * Folds one step into a stored value, compare-and-swap, the way `recordGame`
 * does — two duels ending in the same instant both get their lesson in, and
 * the loser of the race re-reads and folds on top.
 */
async function fold<T>(key: string, seed: T, step: (value: T) => T): Promise<T | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const held = await readJson<Kept<T>>(key);
    if (!held) {
      const fresh: Kept<T> = { revision: 1, value: step(seed) };
      if (await claim(key, JSON.stringify(fresh), LEARN_TTL_SECONDS)) return fresh.value;
      continue;
    }
    const next: Kept<T> = { revision: held.revision + 1, value: step(held.value) };
    if (await writeJsonIf(key, next, held.revision, next.revision, LEARN_TTL_SECONDS)) return next.value;
  }
  return null;
}

/**
 * A memory changes only when a duel ends, and the computer asks for it on
 * every action it takes — so a reading is kept for a minute in this process,
 * and thrown away the moment a duel this process saw end has written to it.
 * Another instance's duel is a minute late at worst, which is the gap between
 * one duel and the next. Exact keys: a different deck or opponent is a miss.
 */
const remembered = new Map<string, { at: number; experience: Experience }>();
const REMEMBER_MS = 60_000;
const forget = (myDeck: string, foeName: string, foeDeck: string) => remembered.delete(`${myDeck}|${foeName.trim().toLowerCase()}|${foeDeck}`);

/**
 * What the computer remembers walking into this duel: how this opponent has
 * played before, and what has won with this deck against theirs. Either may
 * be absent, and absent is exactly the shipped search.
 */
export async function loadExperience(myDeck: string, foeName: string, foeDeck: string): Promise<Experience> {
  const key = `${myDeck}|${foeName.trim().toLowerCase()}|${foeDeck}`;
  const kept = remembered.get(key);
  if (kept && Date.now() - kept.at < REMEMBER_MS) return kept.experience;
  const [foe, book] = await Promise.all([
    readJson<Kept<FoeProfile>>(foeKey(foeName, foeDeck)).catch(() => null),
    readJson<Kept<LineBook>>(bookKey(myDeck, foeDeck)).catch(() => null),
  ]);
  const experience: Experience = { foe: foe?.value, book: book?.value };
  remembered.set(key, { at: Date.now(), experience });
  if (remembered.size > 64) remembered.delete(remembered.keys().next().value as string);
  return experience;
}

/** The lessons a deck has written down, newest first. */
export async function loadLessons(deckKey: string): Promise<Lesson[]> {
  const held = await readJson<Kept<Lesson[]>>(lessonsKey(deckKey)).catch(() => null);
  return held?.value ?? [];
}

export interface DuelEnd {
  /** The finished duel's log — the only record that says just what was shown. */
  log: LogEntry[];
  winner: PlayerId;
  /** The computer's seat, and the human's. */
  me: PlayerId;
  foeName: string;
  myDeck: string;
  foeDeck: string;
  /** The computer's reading of the board at the start of each of its turns. */
  trace: TracePoint[];
}

/**
 * Everything one finished duel teaches, written down.
 *
 * Three memories, from one reading of the log. The opponent's profile learns
 * how they play. The matchup's book learns what the computer's cards did
 * against theirs — and the REVERSE book learns what their cards did against
 * the computer's, so that the day the computer is dealt the human's deck it
 * already knows the lines the human won with. And the deck writes one
 * sentence about the turn the duel turned on, which the win screen shows.
 */
export async function recordDuel(end: DuelEnd): Promise<string | null> {
  const record = readDuel(end.log, end.winner);
  const foe: PlayerId = end.me === 'p1' ? 'p2' : 'p1';
  /* The post-mortem first: a lost duel's turning turn names the cards the
     profile should expect from now on. */
  const lesson = lessonFrom(end.trace, record, end.me, end.foeName);
  const decisive = lesson?.theirs ? lesson.slugs : [];
  forget(end.myDeck, end.foeName, end.foeDeck);
  await Promise.all([
    fold<FoeProfile>(foeKey(end.foeName, end.foeDeck), EMPTY_FOE, (v) => updateProfile(v, record, foe, decisive)),
    fold<LineBook>(bookKey(end.myDeck, end.foeDeck), EMPTY_BOOK, (v) => updateBook(v, record, end.me)),
    fold<LineBook>(bookKey(end.foeDeck, end.myDeck), EMPTY_BOOK, (v) => updateBook(v, record, foe)),
  ]);
  if (!lesson) return null;
  const entry: Lesson = { won: end.winner === end.me, turn: lesson.turn, text: lesson.text, foe: end.foeName, at: Date.now() };
  await fold<Lesson[]>(lessonsKey(end.myDeck), [], (v) => [entry, ...v].slice(0, LESSONS_KEPT));
  return lesson.text;
}
