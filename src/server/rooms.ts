/**
 * In-memory duel rooms.
 *
 * There is no database available, so rooms live in the Node process for as long
 * as the two players hold their SSE connections open (which keeps the serverless
 * instance warm). Joining retries against the warm instance rather than creating
 * a second room, so players can never silently end up in two different copies of
 * the same duel.
 */
import { applyAction, createDuel, other, viewFor } from '@/game/engine';
import { DUELIST_BY_ID } from '@/game/cards';
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
  rematch: Set<PlayerId>;
  /** Bumped on every change so pollers can tell whether they are behind. */
  revision: number;
  subs: Set<Sub>;
}

interface Sub {
  pid: PlayerId;
  send: (payload: string) => void;
  close: () => void;
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

/* Survive hot-reloads in development. */
const g = globalThis as unknown as { __duelRooms?: Map<string, Room> };
const rooms: Map<string, Room> = (g.__duelRooms ??= new Map());

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I/L/O/0/1
const ROOM_TTL_MS = 1000 * 60 * 90;

function randomCode(): string {
  let out = '';
  for (let i = 0; i < 4; i++) out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return out;
}

function randomToken(): string {
  return Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 10)).join('');
}

function sweep() {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.lastActivity > ROOM_TTL_MS && room.subs.size === 0) rooms.delete(code);
  }
}

export function createRoom(name: string): { room: Room; token: string; pid: PlayerId } {
  sweep();
  let code = randomCode();
  let guard = 0;
  while (rooms.has(code) && guard++ < 50) code = randomCode();
  const token = randomToken();
  const room: Room = {
    code,
    created: Date.now(),
    lastActivity: Date.now(),
    seats: { p1: { token, name: name.trim() || 'Player 1', duelistId: null, lastSeen: Date.now() } },
    state: null,
    rematch: new Set(),
    revision: 1,
    subs: new Set(),
  };
  rooms.set(code, room);
  return { room, token, pid: 'p1' };
}

export function getRoom(code: string): Room | null {
  sweep();
  return rooms.get(code.toUpperCase()) ?? null;
}

export type JoinResult =
  | { ok: true; token: string; pid: PlayerId; code: string }
  | { ok: false; reason: 'not-found' | 'full' };

export function joinRoom(code: string, name: string, existingToken?: string): JoinResult {
  const room = getRoom(code);
  if (!room) return { ok: false, reason: 'not-found' };
  room.lastActivity = Date.now();

  // Reconnecting with a token we already issued.
  if (existingToken) {
    for (const pid of ['p1', 'p2'] as PlayerId[]) {
      if (room.seats[pid]?.token === existingToken) {
        room.seats[pid]!.lastSeen = Date.now();
        return { ok: true, token: existingToken, pid, code: room.code };
      }
    }
  }

  if (!room.seats.p1) {
    const token = randomToken();
    room.seats.p1 = { token, name: name.trim() || 'Player 1', duelistId: null, lastSeen: Date.now() };
    bump(room);
    return { ok: true, token, pid: 'p1', code: room.code };
  }
  if (!room.seats.p2) {
    const token = randomToken();
    room.seats.p2 = { token, name: name.trim() || 'Player 2', duelistId: null, lastSeen: Date.now() };
    bump(room);
    return { ok: true, token, pid: 'p2', code: room.code };
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
    return {
      name: s.name,
      duelistId: s.duelistId,
      connected: Date.now() - s.lastSeen < 25_000 || [...room.subs].some((x) => x.pid === id),
    };
  };
  let state = room.state ? viewFor(room.state, pid) : null;
  if (state && state.log.length > 80) {
    state = { ...state, log: state.log.slice(-80) };
  }
  return {
    type: 'sync',
    code: room.code,
    you: pid,
    revision: room.revision,
    seats: { p1: seatView('p1'), p2: seatView('p2') },
    stage: room.state ? 'duel' : 'lobby',
    state,
    rematch: [...room.rematch],
  };
}

function bump(room: Room) {
  room.revision += 1;
  room.lastActivity = Date.now();
  broadcast(room);
}

export function broadcast(room: Room) {
  for (const sub of room.subs) {
    try {
      sub.send(JSON.stringify(viewOf(room, sub.pid)));
    } catch {
      room.subs.delete(sub);
    }
  }
}

export function subscribe(room: Room, pid: PlayerId, send: (p: string) => void, close: () => void): () => void {
  const sub: Sub = { pid, send, close };
  room.subs.add(sub);
  room.lastActivity = Date.now();
  if (room.seats[pid]) room.seats[pid]!.lastSeen = Date.now();
  // Tell the other player that this seat came online.
  broadcast(room);
  return () => {
    room.subs.delete(sub);
    room.lastActivity = Date.now();
    broadcast(room);
  };
}

export function touch(room: Room, pid: PlayerId) {
  if (room.seats[pid]) room.seats[pid]!.lastSeen = Date.now();
  room.lastActivity = Date.now();
}

/* ------------------------------------------------------------------ */
/* Lobby actions                                                       */
/* ------------------------------------------------------------------ */

export function chooseDuelist(room: Room, pid: PlayerId, duelistId: string): string | null {
  if (!DUELIST_BY_ID[duelistId]) return 'Unknown duelist.';
  const seat = room.seats[pid];
  if (!seat) return 'You are not seated in this duel.';
  if (room.state) return 'The duel has already begun.';
  seat.duelistId = duelistId;
  maybeStart(room);
  bump(room);
  return null;
}

export function setName(room: Room, pid: PlayerId, name: string) {
  const seat = room.seats[pid];
  if (!seat) return;
  seat.name = name.trim().slice(0, 18) || (pid === 'p1' ? 'Player 1' : 'Player 2');
  bump(room);
}

function maybeStart(room: Room) {
  const a = room.seats.p1;
  const b = room.seats.p2;
  if (!a?.duelistId || !b?.duelistId || room.state) return;
  const first: PlayerId = Math.random() < 0.5 ? 'p1' : 'p2';
  room.state = createDuel({
    seed: (Math.random() * 0xffffffff) >>> 0,
    p1: { duelistId: a.duelistId, name: a.name },
    p2: { duelistId: b.duelistId, name: b.name },
    firstPlayer: first,
  });
  room.rematch.clear();
}

export function requestRematch(room: Room, pid: PlayerId) {
  if (!room.state?.winner) return;
  room.rematch.add(pid);
  if (room.rematch.size >= 2) {
    room.rematch.clear();
    room.state = null;
    // Keep the duelist choices so a rematch is one click; players can re-pick.
    maybeStart(room);
  }
  bump(room);
}

export function leaveToLobby(room: Room, pid: PlayerId) {
  room.state = null;
  room.rematch.clear();
  for (const id of ['p1', 'p2'] as PlayerId[]) {
    if (room.seats[id]) room.seats[id]!.duelistId = null;
  }
  void pid;
  bump(room);
}

/* ------------------------------------------------------------------ */
/* Duel actions                                                        */
/* ------------------------------------------------------------------ */

export function performAction(room: Room, pid: PlayerId, action: DuelAction): string | null {
  if (!room.state) return 'The duel has not started.';
  const res = applyAction(room.state, pid, action);
  if (res.error) return res.error;
  room.state = res.state;
  bump(room);
  return null;
}

export function opponentOf(pid: PlayerId): PlayerId {
  return other(pid);
}

export type { DuelState };
