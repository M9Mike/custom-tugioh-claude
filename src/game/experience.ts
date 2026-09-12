/**
 * What the computer remembers between duels, and how the search reads it.
 *
 * The search is a pure function of the position: it knows the rules, both
 * decklists, and the board in front of it, and nothing else. A human across
 * the table knows more than that — not more about *this* duel, but about the
 * last twenty. They remember that this opponent's Set card has been Mirror
 * Force three times out of four, that he fuses on turn two whenever he can,
 * that Soul Exchange has won every duel it was cast in against that deck and
 * that the turn they lost last time was the Fusion Recovery one. This file is
 * that memory: three shapes of it, the pure functions that build each from a
 * finished duel's log, and the pure functions that let the search consult
 * each one inside a bound.
 *
 * Three rules hold everything here.
 *
 * Only what was SEEN. A memory is built from the log, which records what was
 * shown across the table — a card Summoned, a Spell cast, a Trap that fired —
 * and never from the opponent's hand or Deck at the end. `ai-honesty` insists
 * the plan is independent of hidden information, and memory of past duels is
 * not hidden information; memory of this one's unrevealed hand would be.
 *
 * Every effect is bounded, and nothing at all with no memory. An empty
 * experience is byte-for-byte the shipped search, which is where every pinned
 * position runs, so the memories can only shade decisions inside the range
 * the batteries were validated against — the same rule the style knobs live
 * under. A lesson is a nudge, never a veto.
 *
 * Keyed by DECK, not by seat. A line book for "HERO against Obelisk" is filled
 * in by whoever piloted the HERO deck, human or computer, and read by whoever
 * pilots it next — so a strategy the human found is one the computer has
 * when it is dealt that deck, which is what learning from the other side of
 * the table means.
 */
import { CARDS } from './cards';
import type { LogEntry, PlayerId } from './types';

/* ------------------------------------------------------------------ */
/* Keys                                                                */
/* ------------------------------------------------------------------ */

/**
 * A deck's identity for the memories: a premade duelist's id, or a hash of a
 * custom list. A Story Mode character wears a duelist's colours over cards of
 * their own choosing, and a memory filed under the costume would be filed
 * under the wrong deck — the same twenty-five cards get the same key whatever
 * the dress, and a changed list is a different deck.
 */
export function deckKeyFor(duelistId: string | null | undefined, deck?: string[] | null): string {
  if (deck && deck.length) {
    const sorted = [...deck].sort().join(',');
    let h = 0x811c9dc5;
    for (let i = 0; i < sorted.length; i++) {
      h ^= sorted.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return `custom:${(h >>> 0).toString(36)}`;
  }
  return duelistId ?? 'unknown';
}

/* ------------------------------------------------------------------ */
/* The three memories                                                  */
/* ------------------------------------------------------------------ */

/** How one opponent plays — their habits, read off what they have shown. */
export interface FoeProfile {
  games: number;
  /** Cards they Set face-down in the Spell/Trap Zone. */
  sets: number;
  /** Set cards later shown to be an answer: a Trap that fired. */
  answers: number;
  /** Which answers they have fired, and how often. */
  traps: Record<string, number>;
  /** Cards they have been seen to play — in how many duels each appeared. */
  plays: Record<string, number>;
  /**
   * Cards they played on the turn that turned a duel they won — what the
   * post-mortem found. Absent on a profile written before it was kept.
   */
  decisive?: Record<string, number>;
}

/** Which cards have won with one deck against another, whoever played it. */
export interface LineBook {
  games: number;
  /** Per card the pilot played: duels it was played in, and how many were won. */
  cards: Record<string, { n: number; wins: number }>;
}

/** What the search is handed: the opponent's habits and the matchup's book. */
export interface Experience {
  foe?: FoeProfile;
  book?: LineBook;
}

/** One duel's worth of remembering, in words. */
export interface Lesson {
  won: boolean;
  turn: number;
  text: string;
  /** Who it was against, as the seat was named. */
  foe: string;
  at: number;
}

export const EMPTY_FOE: FoeProfile = { games: 0, sets: 0, answers: 0, traps: {}, plays: {}, decisive: {} };
export const EMPTY_BOOK: LineBook = { games: 0, cards: {} };

/* ------------------------------------------------------------------ */
/* Reading a finished duel                                             */
/* ------------------------------------------------------------------ */

/** What one seat was seen to do in one turn. */
export interface TurnPlays {
  turn: number;
  player: PlayerId;
  /** Cards shown being played: Summoned, cast, fused, ignited. In order. */
  slugs: string[];
}

/** Everything a memory can honestly be built from. */
export interface DuelRecord {
  winner: PlayerId;
  /** The plays of every turn, in order, for both seats. */
  turns: TurnPlays[];
  /** Per seat: distinct cards shown played across the duel. */
  played: Record<PlayerId, string[]>;
  /** Per seat: cards Set face-down in the Spell/Trap Zone. */
  sets: Record<PlayerId, number>;
  /** Per seat: Traps fired, by slug, in order. */
  trapsFired: Record<PlayerId, string[]>;
}

const isTrap = (slug: string): boolean => CARDS[slug]?.kind === 'trap';

/**
 * A finished duel, read off its log.
 *
 * The log is the one record of a duel that says only what was shown: a card
 * is named there when it is Summoned, cast, fused, flipped or fired, and a
 * Set is a line with no card on it. A Trap can only ever fire from a Set, so a
 * Trap activating IS the Set card being shown to have been an answer — which
 * is the whole of what the profile wants to know about their backrow. Whose
 * turn a line belongs to is the turn's own line, which the engine writes for
 * the player it belongs to.
 */
export function readDuel(log: LogEntry[], winner: PlayerId): DuelRecord {
  const turns: TurnPlays[] = [];
  const played: Record<PlayerId, Set<string>> = { p1: new Set(), p2: new Set() };
  const sets: Record<PlayerId, number> = { p1: 0, p2: 0 };
  const trapsFired: Record<PlayerId, string[]> = { p1: [], p2: [] };
  const activeOf = new Map<number, PlayerId>();
  for (const e of log) {
    if (e.player && /^Turn \d+ — /.test(e.text)) activeOf.set(e.turn, e.player);
  }
  /* The first turn's line is written before anybody is seated at it — "Turn 1
     — X's Main Phase." carries no player — and the log is capped, so a long
     duel has lost its opening lines. Turns alternate strictly, so any one turn
     that is known settles every other by parity; and a duel still on its
     first turn has only the opening player writing lines, so the first of
     those says who it was. */
  const opening = log.find((e) => e.turn === 1 && e.player);
  const known: [number, PlayerId] | undefined =
    [...activeOf.entries()].sort((a, b) => a[0] - b[0])[0] ?? (opening?.player ? [1, opening.player] : undefined);
  const activeAt = (turn: number): PlayerId | undefined => {
    const seen = activeOf.get(turn);
    if (seen || !known) return seen;
    return (turn - known[0]) % 2 === 0 ? known[1] : known[1] === 'p1' ? 'p2' : 'p1';
  };
  let cur: TurnPlays | null = null;
  for (const e of log) {
    if (!e.player) continue;
    const p = e.player;
    if (/ sets a card\.$/.test(e.text)) {
      sets[p] += 1;
      continue;
    }
    if (!e.slug) continue;
    const shown =
      / Normal Summons /.test(e.text) ||
      / Special Summons /.test(e.text) ||
      / Fusion Summons /.test(e.text) ||
      / activates /.test(e.text);
    if (!shown) continue;
    if (/ activates .*!$/.test(e.text) && !/'s effect!$/.test(e.text) && isTrap(e.slug)) trapsFired[p].push(e.slug);
    played[p].add(e.slug);
    /* The turn's line belongs to the turn's player. A Trap fired on the other
       side of the table is that player's answer, not part of the active
       player's line, and the profile has already counted it above. */
    const active = activeAt(e.turn);
    if (active !== p) continue;
    if (!cur || cur.turn !== e.turn || cur.player !== p) {
      cur = { turn: e.turn, player: p, slugs: [] };
      turns.push(cur);
    }
    if (!cur.slugs.includes(e.slug)) cur.slugs.push(e.slug);
  }
  return {
    winner,
    turns,
    played: { p1: [...played.p1], p2: [...played.p2] },
    sets,
    trapsFired,
  };
}

/* ------------------------------------------------------------------ */
/* Updating                                                            */
/* ------------------------------------------------------------------ */

/**
 * What one duel teaches about the opponent seated at `foe` — and, when the
 * post-mortem found the turn of theirs that turned it (`lessonFrom`), which
 * cards did it.
 */
export function updateProfile(profile: FoeProfile, record: DuelRecord, foe: PlayerId, decisive: string[] = []): FoeProfile {
  const next: FoeProfile = {
    games: profile.games + 1,
    sets: profile.sets + record.sets[foe],
    answers: profile.answers + record.trapsFired[foe].length,
    traps: { ...profile.traps },
    plays: { ...profile.plays },
    decisive: { ...(profile.decisive ?? {}) },
  };
  for (const slug of record.trapsFired[foe]) next.traps[slug] = (next.traps[slug] ?? 0) + 1;
  for (const slug of record.played[foe]) next.plays[slug] = (next.plays[slug] ?? 0) + 1;
  for (const slug of decisive) next.decisive![slug] = (next.decisive![slug] ?? 0) + 1;
  return next;
}

/** What one duel teaches about the deck seated at `me`, against the one across from it. */
export function updateBook(book: LineBook, record: DuelRecord, me: PlayerId): LineBook {
  const won = record.winner === me;
  const next: LineBook = { games: book.games + 1, cards: { ...book.cards } };
  for (const slug of record.played[me]) {
    const had = next.cards[slug] ?? { n: 0, wins: 0 };
    next.cards[slug] = { n: had.n + 1, wins: had.wins + (won ? 1 : 0) };
  }
  return next;
}

/* ------------------------------------------------------------------ */
/* What the search reads                                               */
/* ------------------------------------------------------------------ */

/** The nightmare's vote may lean this far either way on what this opponent has shown, and never past these walls. */
export const PRIOR_LEAN = 0.125;
export const PRIOR_FLOOR = 0.3;
export const PRIOR_CEILING = 0.65;

/**
 * The paranoid prior, leaned by how often this opponent's Set cards have
 * turned out to be answers.
 *
 * The arithmetic prior is what the decklist says a Set could be; this is what
 * the human has shown theirs to be. Six Sets is full confidence, and the lean
 * is a quarter of the base at most — so a human whose every Set has fired is
 * feared a little more and one who sets bluffs a little less, and neither is
 * ever feared past the ceiling the doctrine puts on fear, nor below the floor
 * that keeps a Set card a Set card.
 */
export function learnedPrior(base: number, foe: FoeProfile | undefined): number {
  if (base <= 0 || !foe || foe.sets <= 0) return base;
  const fired = Math.min(1, foe.answers / foe.sets);
  const confidence = Math.min(1, foe.sets / 6);
  const leaned = base + 2 * PRIOR_LEAN * (fired - 0.5) * confidence;
  return Math.max(PRIOR_FLOOR, Math.min(PRIOR_CEILING, leaned));
}

/**
 * The nightmare, sharpened. Among the answers their deck could still hold, the
 * one this opponent has actually fired before counts for more — three
 * sightings and it outranks a slightly scarier card they have never shown.
 */
export function nightmareWeight(slug: string, foe: FoeProfile | undefined): number {
  const seen = foe?.traps[slug] ?? 0;
  return 1 + 0.6 * Math.min(1, seen / 3);
}

/**
 * How likely a sampled world is to deal this card into their hand rather than
 * leave it in their Deck: cards this opponent has been seen to play are
 * dealt to the hand first, and the cards that have turned a duel against
 * this deck first of all. Used as an Efraimidis–Spirakis weight, so the
 * sample stays a sample — a card played in every duel so far is three times
 * as likely to be in hand as one never shown, not certain to be; one that has
 * also turned two duels is half again on top of that.
 */
export function handWeight(slug: string, foe: FoeProfile | undefined): number {
  if (!foe || foe.games <= 0) return 1;
  const rate = Math.min(1, (foe.plays[slug] ?? 0) / foe.games);
  const turned = Math.min(1, (foe.decisive?.[slug] ?? 0) / 2);
  return 1 + 2 * rate + 1.5 * turned;
}

/** A line may gain or lose this much from the book, and no more. */
export const BOOK_CAP = 300;

/**
 * What the book says about a line, from the cards it spends.
 *
 * Every card the line plays is worth its record in this matchup: a card that
 * has won every duel it was played in adds, one that has lost them all takes
 * away, and three sightings is full confidence. Capped on the whole line, so
 * the book is a tiebreak between near-equal turns and never the reason to
 * play one the board says is wrong.
 */
export function bookBonus(book: LineBook | undefined, slugs: Iterable<string>): number {
  if (!book) return 0;
  let bonus = 0;
  const seen = new Set<string>();
  for (const slug of slugs) {
    if (seen.has(slug)) continue;
    seen.add(slug);
    const rec = book.cards[slug];
    if (!rec || rec.n <= 0) continue;
    const margin = (2 * rec.wins - rec.n) / rec.n;
    const confidence = Math.min(1, rec.n / 3);
    bonus += 110 * margin * confidence;
  }
  return Math.max(-BOOK_CAP, Math.min(BOOK_CAP, bonus));
}

/* ------------------------------------------------------------------ */
/* The lesson                                                          */
/* ------------------------------------------------------------------ */

/** Where the computer's own evaluation stood at the start of each of its turns. */
export interface TracePoint {
  turn: number;
  eval: number;
}

const nameOf = (slug: string): string => CARDS[slug]?.name ?? slug;

function list(slugs: string[]): string {
  const names = slugs.slice(0, 3).map(nameOf);
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The one turn worth remembering, in a sentence.
 *
 * The trace is the computer's own reading of the board at the start of each
 * of its turns, so the biggest fall between two of them brackets the human's
 * turn that did the damage, and the biggest rise brackets its own turn that
 * won. The cards played in that turn are the lesson — which is exactly what a
 * human remembers of a duel: not the whole game, the turn it turned on.
 */
/** What the post-mortem found: the turn, the sentence, and whose cards. */
export interface PostMortem {
  turn: number;
  text: string;
  /** The cards played in that turn, as shown. */
  slugs: string[];
  /** True when it was the opponent's turn — a loss, and their line to expect. */
  theirs: boolean;
}

export function lessonFrom(
  trace: TracePoint[],
  record: DuelRecord,
  me: PlayerId,
  foeName: string
): PostMortem | null {
  const won = record.winner === me;
  if (trace.length < 2) {
    /* A duel over before the computer took a second turn has no swing to
       read; its lesson is the last thing that happened to it. */
    const last = [...record.turns].reverse().find((t) => (won ? t.player === me : t.player !== me) && t.slugs.length);
    if (!last) return null;
    return {
      turn: last.turn,
      text: won ? `Turn ${last.turn}: ${list(last.slugs)} won it.` : `Turn ${last.turn}: ${foeName}'s ${list(last.slugs)} ended it.`,
      slugs: last.slugs,
      theirs: !won,
    };
  }
  let bestAt = -1;
  let best = won ? -Infinity : Infinity;
  for (let i = 1; i < trace.length; i++) {
    const delta = trace[i].eval - trace[i - 1].eval;
    if (won ? delta > best : delta < best) {
      best = delta;
      bestAt = i;
    }
  }
  if (bestAt < 0) return null;
  const from = trace[bestAt - 1].turn;
  const to = trace[bestAt].turn;
  if (won) {
    const mine = record.turns.find((t) => t.player === me && t.turn === from && t.slugs.length);
    if (!mine) return null;
    return { turn: from, text: `Turn ${from}: ${list(mine.slugs)} turned the duel.`, slugs: mine.slugs, theirs: false };
  }
  const theirs = record.turns.find((t) => t.player !== me && t.turn > from && t.turn < to && t.slugs.length);
  if (!theirs) return null;
  return {
    turn: theirs.turn,
    text: `Turn ${theirs.turn}: ${foeName}'s ${list(theirs.slugs)} turned the duel, and the board never came back.`,
    slugs: theirs.slugs,
    theirs: true,
  };
}
