/**
 * The tournament: the number that opens it, and the rules it runs by.
 *
 * ## The door
 *
 * Ninety-nine cards on your name and you are in it. Wins are a number the
 * player cannot see and cannot plan against; a collection is on the screen, it
 * goes up in threes when a pack opens, and every duelist in the world is
 * visibly a piece of it — so "ninety-nine" is a sentence an NPC can say and a
 * player can act on the same afternoon. The city has been saying it for weeks.
 *
 * ## What is behind it
 *
 * Seto Kaiba opens it — a broadcast, the first time the player is carrying the
 * ninety-nine — and it is not a hall. It is the city. Every duelist in it is out
 * in Domino City, walking gate to gate (`travel.ts`), except Sarah and Tony, who
 * keep the street they have always kept. Beat one and their **star chip** is
 * yours: one chip per duelist, however many times you beat them. Ten chips is a
 * place in the finals.
 *
 * Nobody waits for you, either. Every time the player finishes a duel the rest
 * of the field finishes one too, somewhere off screen, and the winners take
 * chips off each other the same way (`settleDuel`). When the player's tenth
 * chip lands, the three entrants holding the most go through with them — four
 * finalists — and the finals are at Central Towers, where Kaiba is waiting. The
 * story stops there for now: the four of them, and him.
 *
 * Cards and money still change hands at every table exactly as they did before
 * the tournament (`shop.ts`) — the chips are on top of the city's economy, not
 * instead of it.
 *
 * No three.js, no server, no React: this is the rule, and the profile carries
 * the state it is applied to (`StoryProfile.tournament`). The server is the only
 * thing that writes it.
 */

/** Cards on your name before the tournament will have you. */
export const TOURNAMENT_CARDS = 99;

/** How many more are needed — never negative, so a line can print it. */
export function cardsLeft(held: number): number {
  return Math.max(0, TOURNAMENT_CARDS - held);
}

/** Is the tournament open to somebody holding this many? */
export function tournamentOpen(held: number): boolean {
  return held >= TOURNAMENT_CARDS;
}

/** Star chips that buy a place in the finals. */
export const CHIPS_TO_FINALS = 10;

/** How many of the field join the player in the finals. */
export const FINALISTS_BESIDES_YOU = 3;

/** The player, wherever the board names somebody by id. */
export const YOU = '@you';

/**
 * Everybody in the tournament, and how strong their deck plays.
 *
 * Thirteen: the nine who were already in the city, and the four who arrive
 * with it — Yugi, Yami, Joey and Mai, who were built and waiting for exactly
 * this. Grandpa keeps his shop and is not entered; Ash is not from here and the
 * tournament is not his. Kaiba runs it.
 *
 * `rating` is on the Elo scale and decides the duels nobody watches: a
 * four-hundred-point gap is ten wins to one. Measured, not typed — played out
 * by the real game AI across a full round robin, see
 * `scripts/tournament-ratings.ts`.
 *
 * `stays` is Sarah and Tony, who keep the street.
 */
export interface Entrant {
  id: string;
  rating: number;
  stays?: boolean;
}

export const ENTRANTS: Entrant[] = [
  /* Measured 2026-09-22: eight games a pair, every pair, 624 duels, real AI on
     both seats (`scripts/tournament-ratings.ts`). Won/played in brackets. */
  { id: 'yami', rating: 1791 }, // 82/96
  { id: 'seraphina', rating: 1677 }, // 72/96
  { id: 'isha', rating: 1608 }, // 64/95
  { id: 'kaela', rating: 1591 }, // 63/96
  { id: 'mai', rating: 1582 }, // 62/96
  { id: 'hippolyta', rating: 1564 }, // 60/96
  { id: 'yugi', rating: 1510 }, // 54/96
  { id: 'joey', rating: 1428 }, // 45/96
  { id: 'panthesilea', rating: 1381 }, // 40/96
  { id: 'antiope', rating: 1342 }, // 36/95
  { id: 'tina', rating: 1340 }, // 36/96
  /* The street's two, who are there to be beaten first and are. */
  { id: 'sarah', rating: 748, stays: true }, // 6/96
  { id: 'tony', rating: 640, stays: true }, // 3/96
];

export const ENTRANT_IDS = new Set(ENTRANTS.map((e) => e.id));
const RATING = new Map(ENTRANTS.map((e) => [e.id, e.rating]));

/** The four who only exist in the city once the tournament does. */
export const ARRIVALS = new Set(['yugi', 'yami', 'joey', 'mai']);

/** Whether a duelist is in the tournament at all. */
export function isEntrant(id: string): boolean {
  return ENTRANT_IDS.has(id);
}

/** One duel nobody watched, and who won it. */
export interface OffScreenDuel {
  a: string;
  b: string;
  winner: string;
}

/**
 * The tournament as one player's save holds it.
 *
 * Absent until Kaiba's broadcast has played, which is the whole test for "has
 * it started" — the ninety-nine cards open the door, and the broadcast is the
 * player walking through it.
 */
export interface TournamentState {
  /** When the broadcast finished and the tournament began, for this player. */
  startedAt: number;
  /** Entrants the player has beaten since it began — one star chip each. */
  chips: string[];
  /** For every entrant, whom they have beaten: ids, and `YOU`. Their chips. */
  board: Record<string, string[]>;
  /** Duels the player has finished since it began; each one is a round off screen. */
  round: number;
  /** Rooms already counted, newest last — a duel is settled exactly once. */
  settled: string[];
  /** What happened off screen the last time the player finished a duel. */
  latest?: OffScreenDuel[];
  /** Set the moment the player's tenth chip lands. */
  finals?: {
    at: number;
    /** `YOU` and the three who went through with you, most chips first. */
    finalists: string[];
    /** The announcement has been shown. */
    seen?: boolean;
  };
}

export function startTournament(now: number): TournamentState {
  return {
    startedAt: now,
    chips: [],
    board: Object.fromEntries(ENTRANTS.map((e) => [e.id, []])),
    round: 0,
    settled: [],
  };
}

export type Phase = 'before' | 'running' | 'finals';

export function phaseOf(t: TournamentState | null | undefined): Phase {
  if (!t) return 'before';
  return t.finals ? 'finals' : 'running';
}

/** How many chips somebody holds — an entrant, or `YOU`. */
export function chipsOf(t: TournamentState, id: string): number {
  if (id === YOU) return t.chips.length;
  return (t.board[id] ?? []).length;
}

/** Whether the player already holds this duelist's chip. */
export function holdsChip(t: TournamentState | null | undefined, npcId: string): boolean {
  return !!t && t.chips.includes(npcId);
}

/** Whether somebody made the finals. */
export function isFinalist(t: TournamentState | null | undefined, id: string): boolean {
  return !!t?.finals?.finalists.includes(id);
}

/**
 * The table, most chips first. Ties go to the stronger deck — the one that
 * would be expected to win the play-off nobody is going to hold — and then to
 * the name, so the order never wobbles between two reads.
 */
export function standings(t: TournamentState): { id: string; chips: number }[] {
  const rows = [
    { id: YOU, chips: t.chips.length },
    ...ENTRANTS.map((e) => ({ id: e.id, chips: chipsOf(t, e.id) })),
  ];
  return rows.sort((a, b) => b.chips - a.chips || (RATING.get(b.id) ?? 0) - (RATING.get(a.id) ?? 0) || a.id.localeCompare(b.id));
}

/** The chance that `a` beats `b`, on the ratings. */
export function oddsOf(a: string, b: string): number {
  const ra = RATING.get(a) ?? 1400;
  const rb = RATING.get(b) ?? 1400;
  return 1 / (1 + 10 ** ((rb - ra) / 400));
}

function seeded(text: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let a = h || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Whoever beat whom takes a chip — once per opponent. */
function award(board: Record<string, string[]>, winner: string, loser: string): void {
  const had = board[winner] ?? [];
  if (!had.includes(loser)) board[winner] = [...had, loser];
}

/**
 * One finished duel, and everything it sets moving.
 *
 * The player's half first. Beat an entrant whose chip you do not have and it
 * is yours; lose to one who has never beaten you and yours is theirs — one chip
 * per opponent both ways, so a player cannot farm the street and an entrant
 * cannot farm the player.
 *
 * Then the round nobody watched: everybody else in the field is paired off —
 * preferring pairs who can still take a chip off each other, because a duel
 * between two people who have both already won it is a duel with nothing on it
 * — and each pair is decided on the ratings. An odd one out sits the round.
 * Seeded by the player and the round, so the same save always has the same
 * tournament behind it, and a retried request settles to the same answer.
 *
 * And if that was the tenth chip, the finals are set: the three with the most,
 * by `standings`, go through with the player. Nothing moves after that.
 *
 * Pure: the state in, the state out, nothing mutated. `code` is the room, and a
 * room already in `settled` settles nothing.
 */
export function settleDuel(
  t: TournamentState,
  duel: { username: string; npcId: string; won: boolean; code: string; now: number }
): TournamentState {
  if (t.finals || t.settled.includes(duel.code)) return t;
  const board: Record<string, string[]> = Object.fromEntries(
    ENTRANTS.map((e) => [e.id, [...(t.board[e.id] ?? [])]])
  );
  let chips = t.chips;
  const facing = isEntrant(duel.npcId) ? duel.npcId : null;
  if (facing) {
    if (duel.won && !chips.includes(facing)) chips = [...chips, facing];
    if (!duel.won) award(board, facing, YOU);
  }

  /* The rest of the field. */
  const rng = seeded(`tournament:${duel.username.toLowerCase()}:${t.round}`);
  const pool = ENTRANTS.map((e) => e.id).filter((id) => id !== facing);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const open = (a: string, b: string) => !board[a].includes(b) || !board[b].includes(a);
  const latest: OffScreenDuel[] = [];
  while (pool.length >= 2) {
    const a = pool.shift()!;
    let at = pool.findIndex((b) => open(a, b));
    if (at < 0) at = 0;
    const b = pool.splice(at, 1)[0];
    const winner = rng() < oddsOf(a, b) ? a : b;
    const loser = winner === a ? b : a;
    award(board, winner, loser);
    latest.push({ a, b, winner });
  }

  let next: TournamentState = {
    ...t,
    chips,
    board,
    round: t.round + 1,
    settled: [...t.settled, duel.code].slice(-40),
    latest,
  };
  if (chips.length >= CHIPS_TO_FINALS) {
    const through = standings(next)
      .filter((r) => r.id !== YOU)
      .slice(0, FINALISTS_BESIDES_YOU)
      .map((r) => r.id);
    next = { ...next, finals: { at: duel.now, finalists: [YOU, ...through] } };
  }
  return next;
}
