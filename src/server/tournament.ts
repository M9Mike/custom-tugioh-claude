/**
 * Tournament mode: a solo single-elimination bracket.
 *
 * Eight duelists, three rounds. You play your own match for real; the other
 * matches in your round are genuine duels too, played out headlessly by the
 * same AI at the same full strength — nothing is decided by a dice roll.
 *
 * A full-strength duel between two computers costs about five seconds of CPU,
 * which is far too long to resolve a whole round inside one request. They are
 * therefore simulated one per call, exactly like the AI's own moves are stepped
 * one per call, and the client nudges until the round is complete. That also
 * happens to be the better experience: the bracket fills in in front of you.
 */
import { applyAction, createDuel } from '@/game/engine';
import { aiNext, createAiRuntime, invalidatePlan } from '@/game/ai';
import { GAME_AI } from '@/game/ai-levels';
import { DUELIST_BY_ID, DUELISTS } from '@/game/cards';
import type { DuelState, PlayerId } from '@/game/types';

export const BRACKET_SIZE = 8;
export const ROUNDS = 3; // quarter-final, semi-final, final

export const ROUND_NAMES = ['Quarter-final', 'Semi-final', 'Final'] as const;

export interface TourMatch {
  round: number;
  /** Position within the round; the winner of slot i goes to slot i>>1 next. */
  slot: number;
  a: string | null;
  b: string | null;
  winner: string | null;
  /** True for the match the human plays themselves. */
  human: boolean;
}

export interface Tournament {
  /** Duelist ids seeded into the eight bracket positions. */
  entrants: string[];
  /** Which bracket position the human occupies. */
  humanSeat: number;
  humanDuelist: string;
  round: number;
  matches: TourMatch[];
  status: 'duelling' | 'resolving' | 'won' | 'eliminated';
  /** Seed base so a bracket replays identically if a request is retried. */
  seed: number;
}

/** Which bracket position a duelist occupies in a given round. */
const seatInRound = (seat: number, round: number) => seat >> round;

export function createTournament(humanDuelist: string, seed: number): Tournament {
  const others = DUELISTS.map((d) => d.id).filter((id) => id !== humanDuelist);
  // Deterministic shuffle from the seed, so the same bracket is rebuilt if a
  // creation request is retried.
  let r = seed >>> 0;
  const rnd = () => {
    r = (r * 1664525 + 1013904223) >>> 0;
    return r / 4294967296;
  };
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [others[i], others[j]] = [others[j], others[i]];
  }
  const field = others.slice(0, BRACKET_SIZE - 1);
  const humanSeat = Math.floor(rnd() * BRACKET_SIZE);
  const entrants: string[] = [];
  for (let i = 0, k = 0; i < BRACKET_SIZE; i++) {
    entrants.push(i === humanSeat ? humanDuelist : field[k++]);
  }

  return {
    entrants,
    humanSeat,
    humanDuelist,
    round: 0,
    matches: matchesForRound(entrants, 0, humanSeat),
    status: 'duelling',
    seed,
  };
}

/** Builds the pairings for a round from the surviving duelists. */
function matchesForRound(survivors: string[], round: number, humanSeat: number): TourMatch[] {
  const out: TourMatch[] = [];
  const humanAt = seatInRound(humanSeat, round);
  for (let slot = 0; slot * 2 < survivors.length; slot++) {
    out.push({
      round,
      slot,
      a: survivors[slot * 2] ?? null,
      b: survivors[slot * 2 + 1] ?? null,
      winner: null,
      human: Math.floor(humanAt / 2) === slot,
    });
  }
  return out;
}

/** The match the human is playing this round. */
export function humanMatch(t: Tournament): TourMatch | undefined {
  return t.matches.find((m) => m.round === t.round && m.human);
}

/** The duelist the human faces this round. */
export function humanOpponent(t: Tournament): string | null {
  const m = humanMatch(t);
  if (!m) return null;
  return m.a === t.humanDuelist ? m.b : m.a;
}

/** The next unresolved computer-versus-computer match in the current round. */
export function nextSideMatch(t: Tournament): TourMatch | undefined {
  return t.matches.find((m) => m.round === t.round && !m.human && !m.winner);
}

/**
 * Plays a whole duel between two computers and returns the winning duelist.
 *
 * Both sides use the same full-strength AI the human faces. The turn cap is the
 * engine's own stall guard; if a duel somehow reaches it, the duelist with more
 * Life Points takes it, because a bracket cannot have a draw.
 */
export function simulateDuel(d1: string, d2: string, seed: number): string {
  let state: DuelState = createDuel({
    seed,
    p1: { duelistId: d1, name: DUELIST_BY_ID[d1]?.name ?? 'P1' },
    p2: { duelistId: d2, name: DUELIST_BY_ID[d2]?.name ?? 'P2' },
  });
  const rt = { p1: createAiRuntime(), p2: createAiRuntime() };

  for (let step = 0; step < 3000 && !state.winner && state.turn <= 60; step++) {
    const actor: PlayerId = state.pending ? state.pending.player : state.active;
    // A tighter budget than a live duel gets: nobody is watching this one, and
    // three of them may need to resolve while a player waits on the bracket.
    const action = aiNext(state, actor, GAME_AI, rt[actor], 900);
    if (!action) break;
    let res = applyAction(state, actor, action);
    if (res.error) {
      invalidatePlan(rt[actor]);
      const retry = aiNext(state, actor, GAME_AI, rt[actor], 900);
      res = retry ? applyAction(state, actor, retry) : res;
    }
    if (res.error) break;
    state = res.state;
  }

  if (state.winner === 'p1') return d1;
  if (state.winner === 'p2') return d2;
  if (state.winner === 'draw' || !state.winner) {
    return state.players.p1.lp >= state.players.p2.lp ? d1 : d2;
  }
  return d2;
}

/** Records the human's result and, if they won, whether the round can advance. */
export function recordHumanResult(t: Tournament, won: boolean) {
  const m = humanMatch(t);
  if (!m) return;
  const opponent = humanOpponent(t);
  m.winner = won ? t.humanDuelist : opponent;
  if (!won) {
    t.status = 'eliminated';
    return;
  }
  t.status = 'resolving';
}

/** Resolves one outstanding computer match. Returns false when none are left. */
export function resolveOneSideMatch(t: Tournament): boolean {
  const m = nextSideMatch(t);
  if (!m || !m.a || !m.b) return false;
  // The seed folds in the round and slot so every match is its own duel, and so
  // a retried request replays the same one rather than rolling again.
  m.winner = simulateDuel(m.a, m.b, (t.seed + m.round * 977 + m.slot * 31) >>> 0);
  return true;
}

/**
 * Moves the bracket on once every match in the round has a winner.
 * Returns true when a new round is ready for the human to play.
 */
export function advanceRound(t: Tournament): boolean {
  const thisRound = t.matches.filter((m) => m.round === t.round);
  if (thisRound.some((m) => !m.winner)) return false;

  if (t.round >= ROUNDS - 1) {
    t.status = 'won';
    return false;
  }
  const survivors = thisRound.map((m) => m.winner!);
  t.round += 1;
  t.matches.push(...matchesForRound(survivors, t.round, t.humanSeat));
  t.status = 'duelling';
  return true;
}
