/**
 * Duel rooms.
 *
 * A room is a plain serialisable object read from and written back to the store
 * on every request, so any serverless instance can serve any request. Clients
 * poll for changes rather than holding a stream open, which keeps the whole
 * thing stateless and immune to Vercel scaling out mid-duel.
 */
import { applyAction, createDuel, other, viewFor } from '@/game/engine';
import { DUELIST_BY_ID } from '@/game/cards';
import { claim, readJson, writeJson } from './store';
import type { DuelAction, DuelState, PlayerId } from '@/game/types';

export interface Seat {
  token: string;
  name: string;
  duelistId: string | null;
  lastSeen: number;
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
}

export interface RoomView {
  type: 'sync';
  code: string;
  you: PlayerId;
  revision: number;
  seats: Record<PlayerId, { name: string; duelistId: string | null; connected: boolean } | null>;
  stage: 'lobby' | 'duel';
  state: DuelState | null;
  rematch: PlayerId[];
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
    return { name: s.name, duelistId: s.duelistId, connected: Date.now() - s.lastSeen < 20_000 };
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
}

export async function requestRematch(room: Room, pid: PlayerId): Promise<void> {
  if (!room.state?.winner) return;
  if (!room.rematch.includes(pid)) room.rematch.push(pid);
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
  for (const id of ['p1', 'p2'] as PlayerId[]) {
    if (room.seats[id]) room.seats[id]!.duelistId = null;
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
  await saveRoom(room);
  return null;
}

export function opponentOf(pid: PlayerId): PlayerId {
  return other(pid);
}

export type { DuelState };
