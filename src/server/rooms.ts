/**
 * Duel rooms.
 *
 * A room is a plain serialisable object read from and written back to the store
 * on every request, so any serverless instance can serve any request. Clients
 * poll for changes rather than holding a stream open, which keeps the whole
 * thing stateless and immune to Vercel scaling out mid-duel.
 */
import { applyAction, createDuel, other, viewFor } from '@/game/engine';
import { aiNext, chooseTrapResponse, createAiRuntime, planTurn } from '@/game/ai';
import { GAME_AI } from '@/game/ai-levels';
import { DUELIST_BY_ID, DUELISTS } from '@/game/cards';
import {
  advanceRound,
  createTournament,
  humanOpponent,
  recordHumanResult,
  resolveOneSideMatch,
  type Tournament,
} from './tournament';
import { claim, readJson, writeJsonIf } from './store';
import type { DuelAction, DuelState, PlayerId } from '@/game/types';

export interface Seat {
  token: string;
  name: string;
  duelistId: string | null;
  lastSeen: number;
  /** Set when nobody is sitting here — the computer plays this side. */
  ai?: boolean;
}

export interface Room {
  code: string;
  created: number;
  lastActivity: number;
  seats: Partial<Record<PlayerId, Seat>>;
  state: DuelState | null;
  /** Players who have asked for a rematch. */
  rematch: PlayerId[];
  /** Bumped on every change so pollers can tell whether they are behind. */
  revision: number;
  /**
   * The computer's remaining actions for the turn it planned them on. Searching
   * a whole turn is the expensive part; replaying it one action per request is
   * free, and it keeps the AI committed to the line it chose instead of
   * second-guessing itself halfway through a combo.
   */
  aiPlan?: { key: string; actions: DuelAction[] };
  /** How many actions the computer has taken on its current turn. */
  aiActions?: { key: string; count: number };
  /** Set on a tournament room: the bracket this series of duels belongs to. */
  tournament?: Tournament;
}

export interface RoomView {
  type: 'sync';
  code: string;
  you: PlayerId;
  revision: number;
  seats: Record<PlayerId, { name: string; duelistId: string | null; connected: boolean; ai?: boolean } | null>;
  stage: 'lobby' | 'duel';
  state: DuelState | null;
  rematch: PlayerId[];
  /** True while the computer still owes a move, so the client keeps nudging. */
  aiToMove?: boolean;
  /** Present on a tournament room; drives the bracket screen. */
  tournament?: Tournament;
  /** True while side matches are still being played out for this round. */
  bracketBusy?: boolean;
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I/L/O/0/1
const key = (code: string) => `duel:room:${code.toUpperCase()}`;

function randomCode(len = 4): string {
  let out = '';
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return out;
}

function randomToken(): string {
  return Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 10)).join('');
}

export async function loadRoom(code: string): Promise<Room | null> {
  if (!code) return null;
  return readJson<Room>(key(code));
}

/**
 * Thrown when the room moved underneath us between load and save.
 *
 * Every mutation is load -> change -> save, and two of those interleaving is a
 * plain lost update. The route reloads and replays rather than clobbering.
 */
export class StaleRoom extends Error {
  constructor() {
    super('The room changed while this move was being made.');
    this.name = 'StaleRoom';
  }
}

async function saveRoom(room: Room): Promise<void> {
  const from = room.revision;
  room.revision += 1;
  room.lastActivity = Date.now();
  const written = await writeJsonIf(key(room.code), room, from, room.revision);
  if (!written) {
    // Nothing was written, so this object is a fiction now — put its revision
    // back and let the caller start again from what is really stored.
    room.revision = from;
    throw new StaleRoom();
  }
}

/* ------------------------------------------------------------------ */
/* Creating and joining                                                */
/* ------------------------------------------------------------------ */

export async function createRoom(name: string): Promise<{ room: Room; token: string; pid: PlayerId }> {
  const token = randomToken();
  let code = '';
  // Claim the code atomically so two simultaneous creators can never be handed
  // the same room.
  for (let attempt = 0; attempt < 12 && !code; attempt++) {
    const candidate = randomCode(attempt < 8 ? 4 : 5);
    if (await claim(key(candidate), '{}')) code = candidate;
  }
  if (!code) throw new Error('Could not allocate a room code.');

  const room: Room = {
    code,
    created: Date.now(),
    lastActivity: Date.now(),
    seats: { p1: { token, name: name.trim().slice(0, 18) || 'Player 1', duelistId: null, lastSeen: Date.now() } },
    state: null,
    rematch: [],
    revision: 0,
  };
  await saveRoom(room);
  return { room, token, pid: 'p1' };
}

/**
 * A solo room: the human takes p1 and the computer permanently occupies p2.
 * The AI seat holds an unguessable token like any other seat, so nothing else
 * in the room code needs to know the difference.
 */
export async function createSoloRoom(
  name: string,
  duelistId?: string
): Promise<{ room: Room; token: string; pid: PlayerId }> {
  const { room, token, pid } = await createRoom(name);
  const pick = duelistId && DUELIST_BY_ID[duelistId] ? duelistId : DUELISTS[Math.floor(Math.random() * DUELISTS.length)].id;
  room.seats.p2 = {
    token: randomToken(),
    name: DUELIST_BY_ID[pick]?.name ?? 'Opponent',
    duelistId: pick,
    lastSeen: Date.now(),
    ai: true,
  };
  await saveRoom(room);
  return { room, token, pid };
}

/**
 * A tournament room: a solo room whose duels are bracket matches. The human
 * picks their duelist up front, because the bracket has to be drawn around it.
 */
export async function createTournamentRoom(
  name: string,
  duelistId: string
): Promise<{ room: Room; token: string; pid: PlayerId }> {
  // No opponent is named here: who the computer holds is the bracket's decision,
  // and `seatOpponent` applies it as each round is drawn.
  const { room, token, pid } = await createSoloRoom(name);
  const human = DUELIST_BY_ID[duelistId] ? duelistId : DUELISTS[0].id;
  room.tournament = createTournament(human, (Math.random() * 0xffffffff) >>> 0);
  room.seats.p1!.duelistId = human;
  seatOpponent(room);
  maybeStart(room);
  await saveRoom(room);
  return { room, token, pid };
}

/** Points the computer's seat at whoever the bracket says comes next. */
function seatOpponent(room: Room) {
  const t = room.tournament;
  if (!t) return;
  const opp = humanOpponent(t);
  if (!opp || !room.seats.p2) return;
  room.seats.p2.duelistId = opp;
  room.seats.p2.name = DUELIST_BY_ID[opp]?.name ?? 'Opponent';
}

/**
 * Drives the bracket forward by one step, and reports whether anything moved.
 *
 * Called on the same nudge as the AI's moves: first it notices a finished duel
 * and records it, then it plays out one computer-versus-computer match per
 * call, and finally it starts the next round's duel. One step per request
 * because a full-strength simulated duel is seconds of CPU, not milliseconds.
 */
export async function stepTournament(room: Room): Promise<boolean> {
  const t = room.tournament;
  if (!t) return false;

  // 1. The human's duel just ended — record it.
  if (t.status === 'duelling' && room.state?.winner) {
    recordHumanResult(t, room.state.winner === 'p1');
    await saveRoom(room);
    return true;
  }

  // A knocked-out player is a spectator: the bracket carries on to a champion
  // so the run ends on standings rather than a dead screen.
  const spectating = t.status === 'eliminated' && !t.champion;
  if (t.status !== 'resolving' && !spectating) return false;

  // 2. Play out one outstanding computer match.
  if (resolveOneSideMatch(t)) {
    await saveRoom(room);
    return true;
  }

  // 3. Round complete: either crown a champion or set up the next duel.
  if (advanceRound(t)) {
    room.state = null;
    room.rematch = [];
    room.aiPlan = undefined;
    room.aiActions = undefined;
    // Nothing to seat or start once the player is out — they only watch.
    if (t.status !== 'eliminated') {
      seatOpponent(room);
      maybeStart(room);
    }
  }
  await saveRoom(room);
  return true;
}

/** True while the bracket has work to do that the client should nudge along. */
export function tournamentPending(room: Room): boolean {
  const t = room.tournament;
  if (!t) return false;
  if (t.status === 'resolving') return true;
  // Knocked out is not finished: the rest of the bracket is still played so the
  // run ends on standings and a champion rather than a dead screen.
  if (t.status === 'eliminated') return t.matches.some((m) => !m.winner) || !t.champion;
  return t.status === 'duelling' && !!room.state?.winner;
}

/** The seat the computer owes a move for right now, if any. */
export function aiSeatToMove(room: Room): PlayerId | null {
  const s = room.state;
  if (!s || s.winner) return null;
  const actor: PlayerId = s.pending ? s.pending.player : s.active;
  return room.seats[actor]?.ai ? actor : null;
}

/**
 * Plays a single computer action and saves.
 *
 * One action per call rather than the whole turn, so the human watches the
 * board move a step at a time — the client nudges this endpoint on a timer,
 * which is also what paces the animations. The search itself runs once, on the
 * first action of a turn; the rest of the turn is replayed from `room.aiPlan`,
 * so only one request per turn is slow.
 */
export async function stepAI(room: Room): Promise<boolean> {
  const pid = aiSeatToMove(room);
  if (!pid || !room.state) return false;
  const s = room.state;

  // Nothing the computer does should be able to leave a player waiting for
  // ever. A rules gap once let it flip a monster between Attack and Defence
  // indefinitely — every move legal, the turn never ending — so past a
  // generous ceiling the turn is simply given up. The cap is well above any
  // real turn: the search itself never plans more than two dozen actions.
  /* Keyed by the duel as well as the turn. With just `turn:pid`, a rematch —
     which starts a fresh duel back at turn 1 — walked straight into the
     previous duel's bookkeeping: the action count for "3:p2" kept accumulating
     across duels until it crossed the 60 ceiling, at which point the computer
     began giving up that turn the moment it arrived. Which is exactly the
     shape of "the more rematches, the more it misbehaves". */
  const turnKey = `${s.duelId ?? 'legacy'}:${s.turn}:${pid}`;
  if (room.aiActions?.key !== turnKey) room.aiActions = { key: turnKey, count: 0 };
  room.aiActions.count += 1;
  if (room.aiActions.count > 60 && !s.pending) {
    room.aiPlan = undefined;
    const bail = applyAction(s, pid, { type: 'endTurn' });
    if (!bail.error) {
      room.state = bail.state;
      await saveRoom(room);
      return true;
    }
  }

  let action: DuelAction;
  if (s.pending) {
    // A response window cannot be planned in advance — decide it on the spot,
    // and drop whatever was left of the turn plan, since the board is about to
    // change underneath it.
    room.aiPlan = undefined;
    action = chooseTrapResponse(s, pid, GAME_AI);
  } else {
    const key = turnKey;
    if (room.aiPlan?.key !== key || !room.aiPlan.actions.length) {
      /* Four seconds to plan the whole turn, once per turn. The board narrates
         every beat for over a second anyway, so the think overlaps the tail of
         the previous action far more often than it is felt — and the function
         has a 30s ceiling, so there is no platform pressure to hurry. */
      room.aiPlan = { key, actions: planTurn(s, pid, GAME_AI, 4000) };
    }
    action = room.aiPlan.actions.shift() ?? { type: 'endTurn' };
  }

  let res = applyAction(s, pid, action);
  if (res.error) {
    // The plan went stale against the real position. Search again from here.
    room.aiPlan = undefined;
    const rt = createAiRuntime();
    const retry = aiNext(s, pid, GAME_AI, rt, 4000);
    res = retry ? applyAction(s, pid, retry) : res;
  }
  if (res.error) {
    // Still stuck — never let the computer wedge the duel; pass instead.
    res = applyAction(s, pid, s.pending ? { type: 'respondTrap', uid: null } : { type: 'endTurn' });
    if (res.error) return false;
  }
  room.state = res.state;
  await saveRoom(room);
  return true;
}

export type JoinResult =
  | { ok: true; token: string; pid: PlayerId; code: string; room: Room }
  | { ok: false; reason: 'not-found' | 'full' };

export async function joinRoom(code: string, name: string, existingToken?: string): Promise<JoinResult> {
  const room = await loadRoom(code);
  if (!room || !room.code) return { ok: false, reason: 'not-found' };

  // Reconnecting with a token we already issued — a refresh keeps your seat.
  if (existingToken) {
    for (const pid of ['p1', 'p2'] as PlayerId[]) {
      if (room.seats[pid]?.token === existingToken) {
        room.seats[pid]!.lastSeen = Date.now();
        await saveRoom(room);
        return { ok: true, token: existingToken, pid, code: room.code, room };
      }
    }
  }

  for (const pid of ['p1', 'p2'] as PlayerId[]) {
    if (!room.seats[pid]) {
      const token = randomToken();
      room.seats[pid] = {
        token,
        name: name.trim().slice(0, 18) || (pid === 'p1' ? 'Player 1' : 'Player 2'),
        duelistId: null,
        lastSeen: Date.now(),
      };
      await saveRoom(room);
      return { ok: true, token, pid, code: room.code, room };
    }
  }
  return { ok: false, reason: 'full' };
}

export function seatFor(room: Room, token: string): PlayerId | null {
  for (const pid of ['p1', 'p2'] as PlayerId[]) {
    if (room.seats[pid]?.token === token) return pid;
  }
  return null;
}

export function viewOf(room: Room, pid: PlayerId): RoomView {
  const seatView = (id: PlayerId) => {
    const s = room.seats[id];
    if (!s) return null;
    // The computer is always "connected" — there is nothing to disconnect.
    return { name: s.name, duelistId: s.duelistId, connected: s.ai ? true : Date.now() - s.lastSeen < 20_000, ai: s.ai };
  };
  let state = room.state ? viewFor(room.state, pid) : null;
  if (state && state.log.length > 80) state = { ...state, log: state.log.slice(-80) };
  return {
    type: 'sync',
    code: room.code,
    you: pid,
    revision: room.revision,
    seats: { p1: seatView('p1'), p2: seatView('p2') },
    stage: room.state ? 'duel' : 'lobby',
    state,
    rematch: room.rematch,
    aiToMove: aiSeatToMove(room) !== null,
    tournament: room.tournament,
    bracketBusy: tournamentPending(room),
  };
}

/** Records that this seat is alive, without forcing a write on every poll. */
/**
 * Marks a seat as still there. Deliberately does NOT write.
 *
 * This used to persist the *whole room* — including the duel — from whatever
 * snapshot the poll had loaded, every eight seconds, per player. It also wrote
 * through `writeJson` rather than `saveRoom`, so it did not bump `revision`
 * and nothing could detect it. A summon that landed between a poll's read and
 * its write was simply undone: the monster went back to the hand, a destroyed
 * Set trap came back, and the client — which correctly refuses a view older
 * than the one on screen — then sat showing a board the server did not have,
 * until the next action was refused for being in the wrong phase. All of that
 * was reported from real duels, and it got worse the longer a room lived,
 * because it is a rate, not an event.
 *
 * A write on the read path was never worth it: `connected` is derived from
 * `lastSeen` and no screen displays it. The timestamp is updated in memory so
 * the view built from this request is current, and real writes (joining,
 * acting) persist it as a side effect.
 */
export async function touch(room: Room, pid: PlayerId): Promise<void> {
  const seat = room.seats[pid];
  if (!seat) return;
  seat.lastSeen = Date.now();
}

/* ------------------------------------------------------------------ */
/* Lobby actions                                                       */
/* ------------------------------------------------------------------ */

export async function chooseDuelist(room: Room, pid: PlayerId, duelistId: string): Promise<string | null> {
  if (!DUELIST_BY_ID[duelistId]) return 'Unknown duelist.';
  const seat = room.seats[pid];
  if (!seat) return 'You are not seated in this duel.';
  if (room.tournament) return 'You entered the tournament with this deck.';
  if (room.state) return 'The duel has already begun.';
  seat.duelistId = duelistId;
  maybeStart(room);
  await saveRoom(room);
  return null;
}

/** Lets the human pick which duelist the computer brings. */
export async function configureAi(room: Room, duelistId?: string): Promise<string | null> {
  const pid = (['p1', 'p2'] as PlayerId[]).find((id) => room.seats[id]?.ai);
  if (!pid) return 'There is no computer opponent in this duel.';
  if (room.tournament) return 'The bracket decides who you face.';
  if (room.state) return 'The duel has already begun.';
  const seat = room.seats[pid]!;
  if (duelistId) {
    if (!DUELIST_BY_ID[duelistId]) return 'Unknown duelist.';
    seat.duelistId = duelistId;
    seat.name = DUELIST_BY_ID[duelistId].name;
  }
  maybeStart(room);
  await saveRoom(room);
  return null;
}

export async function setName(room: Room, pid: PlayerId, name: string): Promise<void> {
  const seat = room.seats[pid];
  if (!seat) return;
  seat.name = name.trim().slice(0, 18) || (pid === 'p1' ? 'Player 1' : 'Player 2');
  await saveRoom(room);
}

function maybeStart(room: Room) {
  const a = room.seats.p1;
  const b = room.seats.p2;
  if (!a?.duelistId || !b?.duelistId || room.state) return;
  room.state = createDuel({
    seed: (Math.random() * 0xffffffff) >>> 0,
    p1: { duelistId: a.duelistId, name: a.name },
    p2: { duelistId: b.duelistId, name: b.name },
    firstPlayer: Math.random() < 0.5 ? 'p1' : 'p2',
  });
  room.rematch = [];
  room.aiPlan = undefined;
  room.aiActions = undefined;
}

export async function requestRematch(room: Room, pid: PlayerId): Promise<void> {
  // A bracket match is a record. The interface offers no rematch during one;
  // this makes sure a stale client cannot replay a duel it lost either.
  if (room.tournament) return;
  if (!room.state?.winner) return;
  if (!room.rematch.includes(pid)) room.rematch.push(pid);
  // The computer never needs asking twice.
  for (const id of ['p1', 'p2'] as PlayerId[]) {
    if (room.seats[id]?.ai && !room.rematch.includes(id)) room.rematch.push(id);
  }
  if (room.rematch.length >= 2) {
    room.rematch = [];
    room.state = null;
    maybeStart(room);
  }
  await saveRoom(room);
}

export async function leaveToLobby(room: Room): Promise<void> {
  // There is no lobby to go back to in a tournament: the duelists are the
  // bracket's, and clearing them would strand the room with no way to start.
  if (room.tournament) return;
  room.state = null;
  room.rematch = [];
  room.aiPlan = undefined;
  room.aiActions = undefined;
  for (const id of ['p1', 'p2'] as PlayerId[]) {
    const seat = room.seats[id];
    if (!seat) continue;
    // The computer keeps a deck — otherwise the lobby would wait forever for a
    // choice nobody is there to make.
    seat.duelistId = seat.ai ? DUELISTS[Math.floor(Math.random() * DUELISTS.length)].id : null;
    if (seat.ai) seat.name = DUELIST_BY_ID[seat.duelistId!]?.name ?? seat.name;
  }
  await saveRoom(room);
}

/* ------------------------------------------------------------------ */
/* Duel actions                                                        */
/* ------------------------------------------------------------------ */

export async function performAction(room: Room, pid: PlayerId, action: DuelAction): Promise<string | null> {
  if (!room.state) return 'The duel has not started.';
  const res = applyAction(room.state, pid, action);
  if (res.error) return res.error;
  room.state = res.state;
  // Anything the human does can invalidate a half-played computer turn.
  room.aiPlan = undefined;
  await saveRoom(room);
  return null;
}

export function opponentOf(pid: PlayerId): PlayerId {
  return other(pid);
}

export type { DuelState };
