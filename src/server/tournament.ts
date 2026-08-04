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

/**
 * The bracket holds every duelist, and everybody duels.
 *
 * It was a fixed eight, then the next power of two with the empty places as
 * byes — which put ten duelists into a bracket of sixteen and handed six of
 * them a walkover. Nobody wants to win a tournament by not turning up.
 *
 * Each round now simply pairs off whoever is left: ten becomes five matches,
 * five becomes two matches and one bye, three becomes one and one, then a
 * final. Only an odd count produces a bye at all, and it never goes to the
 * player.
 */

/** How many rounds it takes to get from `n` duelists to one. */
export function roundsFor(n: number): number {
  let rounds = 0;
  for (let left = Math.max(2, n); left > 1; left = Math.ceil(left / 2)) rounds += 1;
  return rounds;
}

/** How many are still standing at the start of round `r`. */
export function survivorsAt(entrants: number, r: number): number {
  let left = entrants;
  for (let i = 0; i < r; i++) left = Math.ceil(left / 2);
  return left;
}

/**
 * What a round is called, from how many duelists are still standing. Naming it
 * from the survivors rather than the round number keeps it right as the roster
 * grows, and copes with the odd counts that pairing off produces.
 */
export function roundName(remaining: number): string {
  if (remaining <= 2) return 'Final';
  if (remaining <= 4) return 'Semi-final';
  if (remaining <= 8) return 'Quarter-final';
  return `Round of ${remaining}`;
}

/** The name of round `r` in a bracket that started with `entrants`. */
export const roundNameAt = (entrants: number, r: number): string => roundName(survivorsAt(entrants, r));

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
  /** Every duelist in the draw, in pairing order. */
  entrants: string[];
  /** Which bracket position the human occupies. */
  humanSeat: number;
  humanDuelist: string;
  round: number;
  matches: TourMatch[];
  status: 'duelling' | 'resolving' | 'won' | 'eliminated';
  /** Set once the final is decided — including brackets the human lost. */
  champion?: string;
  /** Seed base so a bracket replays identically if a request is retried. */
  seed: number;
}

export function createTournament(humanDuelist: string, seed: number): Tournament {
  const roster = DUELISTS.map((d) => d.id);
  const others = roster.filter((id) => id !== humanDuelist);
  // Deterministic shuffle from the seed, so the same bracket is rebuilt if a
  // creation request is retried.
  let r = seed >>> 0;
  const rnd = () => {
    r = (r * 1664525 + 1013904223) >>> 0;
    return r / 4294967296;
  };
  const shuffle = <T,>(xs: T[]) => {
    for (let i = xs.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [xs[i], xs[j]] = [xs[j], xs[i]];
    }
    return xs;
  };
  shuffle(others);

  /* The player goes in first so they are always half of a real pairing. With an
     odd roster somebody has to sit the round out, and it is not going to be the
     person who came to play. */
  const entrants: string[] = [humanDuelist, ...others];

  return {
    entrants,
    humanSeat: 0,
    humanDuelist,
    round: 0,
    matches: matchesForRound(entrants, 0, humanDuelist),
    status: 'duelling',
    seed,
  };
}

/**
 * Builds the pairings for a round by walking the survivors two at a time.
 *
 * An odd number leaves one over, and that one gets the bye — so the list is
 * ordered with the player first, which keeps them in a real match. `human` is
 * read off the entrants rather than a seat position, because after a loss the
 * slot belongs to whoever knocked them out.
 */
function matchesForRound(survivors: string[], round: number, humanDuelist: string): TourMatch[] {
  const out: TourMatch[] = [];
  for (let slot = 0; slot * 2 < survivors.length; slot++) {
    const a = survivors[slot * 2] ?? null;
    const b = survivors[slot * 2 + 1] ?? null;
    out.push({ round, slot, a, b, winner: null, human: a === humanDuelist || b === humanDuelist });
  }
  return out;
}

/** The match the human is playing this round. */
export function humanMatch(t: Tournament): TourMatch | undefined {
  return t.matches.find((m) => m.round === t.round && m.human);
}

/**
 * Is the round being played right now the final?
 *
 * One match and both seats filled. The "both seats" half is the whole point:
 * a round can also come down to a single match *and* a bye — three survivors
 * pair one against one and send the third through — and that is a semi-final
 * with a spectator, not the final.
 *
 * Lives here rather than in the win screen that needed it, because the win
 * screen is not allowed to be the second place this rule is written down.
 * `status` cannot answer it: at the moment the screen appears the server has
 * not been told the result yet, so the tournament still says 'duelling'.
 */
export function isFinalRound(t: Tournament): boolean {
  const playing = t.matches.filter((m) => m.round === t.round);
  return playing.length === 1 && !!playing[0].a && !!playing[0].b;
}

/** The duelist the human faces this round. */
export function humanOpponent(t: Tournament): string | null {
  const m = humanMatch(t);
  if (!m) return null;
  return m.a === t.humanDuelist ? m.b : m.a;
}

/**
 * The next unresolved computer-versus-computer match in the current round.
 *
 * Once the human is out, their own slot is a computer match too: the duelist
 * who knocked them out carries on, and the bracket is played to a champion so
 * the run ends with standings rather than a dead screen.
 */
export function nextSideMatch(t: Tournament): TourMatch | undefined {
  const out = t.status === 'eliminated';
  return t.matches.find((m) => m.round === t.round && !m.winner && (out || !m.human));
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
  /* Byes first, and all of them at once: they cost nothing to settle, and
     stepping through six of them one request at a time would leave the player
     watching a spinner for no reason. */
  let settled = false;
  const out = t.status === 'eliminated';
  for (const m of t.matches) {
    if (m.round !== t.round || m.winner || (m.human && !out)) continue;
    if (m.a && !m.b) { m.winner = m.a; settled = true; }
    else if (m.b && !m.a) { m.winner = m.b; settled = true; }
  }
  if (settled) return true;

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

  // The final is the round with a single match, whatever the bracket's size.
  if (thisRound.length <= 1) {
    t.champion = thisRound[0]?.winner ?? undefined;
    // A player who was knocked out stays knocked out — but they still get to
    // see who took the crown.
    if (t.status !== 'eliminated') t.status = 'won';
    return false;
  }
  /* Whoever just had a bye goes to the front of the queue.
   *
   * `matchesForRound` walks the list in pairs, so an odd count always leaves
   * the *last* name over — and a bye winner stayed last, having been last when
   * they got the bye. The same duelist could ride byes from the quarter-final
   * to the trophy without duelling once. Moving them forward puts them in slot
   * zero, which is a real match by construction, and pushes the next bye onto
   * somebody who has actually been fighting.
   *
   * The human still comes first of all, for the reason `matchesForRound`
   * gives: the bye is never theirs to take. */
  const justByed = new Set(thisRound.filter((m) => !m.a || !m.b).map((m) => m.winner!));
  const survivors = thisRound
    .map((m) => m.winner!)
    .sort((x, y) => {
      const rank = (d: string) => (d === t.humanDuelist ? 0 : justByed.has(d) ? 1 : 2);
      return rank(x) - rank(y);
    });
  t.round += 1;
  t.matches.push(...matchesForRound(survivors, t.round, t.humanDuelist));
  // An eliminated player is a spectator from here: the bracket keeps resolving
  // rather than waiting for a duel they are not in.
  if (t.status !== 'eliminated') t.status = 'duelling';
  return true;
}
