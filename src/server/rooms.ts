/**
 * Duel rooms.
 *
 * A room is a plain serialisable object read from and written back to the store
 * on every request, so any serverless instance can serve any request. Clients
 * poll for changes rather than holding a stream open, which keeps the whole
 * thing stateless and immune to Vercel scaling out mid-duel.
 */
import { applyAction, createDuel, other, viewFor } from '@/game/engine';
import { AI_LEVELS, aiNext, chooseTrapResponse, createAiRuntime, planTurn, type AiLevel } from '@/game/ai';
import { DUELIST_BY_ID, DUELISTS } from '@/game/cards';
import { claim, readJson, writeJson } from './store';
import type { DuelAction, DuelState, PlayerId } from '@/game/types';

export interface Seat {
  token: string;
  name: string;
  duelistId: string | null;
  lastSeen: number;
  /** Set when nobody is sitting here — the computer plays this side. */
  ai?: AiLevel;
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
}

export interface RoomView {
  type: 'sync';
  code: string;
  you: PlayerId;
  revision: number;
  seats: Record<PlayerId, { name: string; duelistId: string | null; connected: boolean; ai?: AiLevel } | null>;
  stage: 'lobby' | 'duel';
  state: DuelState | null;
  rematch: PlayerId[];
  /** True while the computer still owes a move, so the client keeps nudging. */
  aiToMove?: boolean;
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

async function saveRoom(room: Room): Promise<void> {
  room.revision += 1;
  room.lastActivity = Date.now();
  await writeJson(key(room.code), room);
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
  level: AiLevel,
  duelistId?: string
): Promise<{ room: Room; token: string; pid: PlayerId }> {
  const { room, token, pid } = await createRoom(name);
  const pick = duelistId && DUELIST_BY_ID[duelistId] ? duelistId : DUELISTS[Math.floor(Math.random() * DUELISTS.length)].id;
  room.seats.p2 = {
    token: randomToken(),
    name: DUELIST_BY_ID[pick]?.name ?? 'Opponent',
    duelistId: pick,
    lastSeen: Date.now(),
    ai: AI_LEVELS[level] ? level : 'duelist',
  };
  await saveRoom(room);
  return { room, token, pid };
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
  const level = room.seats[pid]!.ai!;
  const s = room.state;

  let action: DuelAction;
  if (s.pending) {
    // A response window cannot be planned in advance — decide it on the spot,
    // and drop whatever was left of the turn plan, since the board is about to
    // change underneath it.
    room.aiPlan = undefined;
    action = chooseTrapResponse(s, pid, level);
  } else {
    const key = `${s.turn}:${pid}`;
    if (room.aiPlan?.key !== key || !room.aiPlan.actions.length) {
      room.aiPlan = { key, actions: planTurn(s, pid, level, 2500) };
    }
    action = room.aiPlan.actions.shift() ?? { type: 'endTurn' };
  }

  let res = applyAction(s, pid, action);
  if (res.error) {
    // The plan went stale against the real position. Search again from here.
    room.aiPlan = undefined;
    const rt = createAiRuntime();
    const retry = aiNext(s, pid, level, rt, 2500);
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
  };
}

/** Records that this seat is alive, without forcing a write on every poll. */
export async function touch(room: Room, pid: PlayerId): Promise<void> {
  const seat = room.seats[pid];
  if (!seat) return;
  // Only write when the timestamp is stale enough to matter for the presence
  // indicator — polls happen every second or two and must stay cheap.
  if (Date.now() - seat.lastSeen < 8000) return;
  seat.lastSeen = Date.now();
  await writeJson(key(room.code), room);
}

/* ------------------------------------------------------------------ */
/* Lobby actions                                                       */
/* ------------------------------------------------------------------ */

export async function chooseDuelist(room: Room, pid: PlayerId, duelistId: string): Promise<string | null> {
  if (!DUELIST_BY_ID[duelistId]) return 'Unknown duelist.';
  const seat = room.seats[pid];
  if (!seat) return 'You are not seated in this duel.';
  if (room.state) return 'The duel has already begun.';
  seat.duelistId = duelistId;
  maybeStart(room);
  await saveRoom(room);
  return null;
}

/** Lets the human pick who the computer plays, and at what strength. */
export async function configureAi(
  room: Room,
  duelistId?: string,
  level?: AiLevel
): Promise<string | null> {
  const pid = (['p1', 'p2'] as PlayerId[]).find((id) => room.seats[id]?.ai);
  if (!pid) return 'There is no computer opponent in this duel.';
  if (room.state) return 'The duel has already begun.';
  const seat = room.seats[pid]!;
  if (duelistId) {
    if (!DUELIST_BY_ID[duelistId]) return 'Unknown duelist.';
    seat.duelistId = duelistId;
    seat.name = DUELIST_BY_ID[duelistId].name;
  }
  if (level && AI_LEVELS[level]) seat.ai = level;
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
}

export async function requestRematch(room: Room, pid: PlayerId): Promise<void> {
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
  room.state = null;
  room.rematch = [];
  room.aiPlan = undefined;
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
