/**
 * Duel rooms.
 *
 * A room is a plain serialisable object read from and written back to the store
 * on every request, so any serverless instance can serve any request. Clients
 * poll for changes rather than holding a stream open, which keeps the whole
 * thing stateless and immune to Vercel scaling out mid-duel.
 */
import { applyAction, createDuel, other, viewFor, viewForSpectator } from '@/game/engine';
import { AI_LEVELS, aiNext, chooseCardResponse, chooseTrapResponse, createAiRuntime, planTurn, type AiConfig } from '@/game/ai';
import { loadBrain, recordGame } from './learning';
import { GAME_AI } from '@/game/ai-levels';
import { DUELIST_BY_ID, DUELISTS } from '@/game/cards';
import {
  advanceRound,
  createSideDuel,
  createTournament,
  humanOpponent,
  nextSideMatch,
  recordHumanResult,
  settleByes,
  sideSeed,
  sideWinner,
  stepSideDuel,
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
  /**
   * An explicit deck for this seat, overriding the duelist's premade list.
   *
   * Only Story Mode sets it: a story duelist brings the twenty-five cards they
   * chose and own. Held on the seat rather than the room because the two sides
   * are seated independently — Mai plays her own premade across the table from
   * a deck somebody built.
   */
  deck?: string[];
}

export interface Room {
  code: string;
  created: number;
  lastActivity: number;
  seats: Partial<Record<PlayerId, Seat>>;
  state: DuelState | null;
  /** Players who have asked for a rematch. */
  rematch: PlayerId[];
  /** Entered from a conversation in Story Mode, so the way out is back to it. */
  story?: boolean;
  /**
   * Set once the winner has taken the pack this duel owed them.
   *
   * On the room rather than the profile because the room is the thing that can
   * only be won once. A finished room sticks around for ninety minutes, so
   * without this a refresh of the win screen is another pack, and another.
   */
  packClaimed?: boolean;
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
  /**
   * An exhibition: both seats are the computer and whoever opened the room is
   * only watching. There is no seat to protect and nothing secret — both hands
   * are shown to the audience by design — so anyone holding the code may view
   * and nudge it, which is also what lets two phones watch the same duel.
   */
  spectate?: boolean;
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
  /** This viewer is watching an exhibition, not sitting in it. */
  spectate?: boolean;
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

/**
 * Decides whether a finished Story Mode duel owes its caller a pack, and if so
 * marks it paid.
 *
 * Lives here rather than in the route because it is the only thing outside this
 * file that needs to reason about seats, tokens and winners, and handing those
 * out is how a room's rules end up enforced in two places. The route gets back
 * a verdict and a duelist id.
 *
 * The write is a compare-and-set through `saveRoom`, so two tabs claiming at
 * once cannot both win it: the loser reloads and sees `packClaimed`.
 */
export async function claimStoryPack(
  code: string,
  token: string
): Promise<
  | { ok: true; duelistId: string }
  | { ok: false; already: true }
  | { ok: false; lost: true }
  | { ok: false; status: number; error: string }
> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const room = await loadRoom(code);
    if (!room || !room.story) return { ok: false, status: 404, error: 'No such duel.' };
    if (room.packClaimed) return { ok: false, already: true };

    const mine = (['p1', 'p2'] as const).find((p) => room.seats[p]?.token === token);
    if (!mine) return { ok: false, status: 403, error: 'That is not your duel.' };
    if (!room.state?.winner) return { ok: false, status: 409, error: 'That duel is not over.' };
    if (room.state.winner !== mine) return { ok: false, lost: true };

    const foe = mine === 'p1' ? 'p2' : 'p1';
    const duelistId = room.seats[foe]?.duelistId;
    if (!duelistId) return { ok: false, status: 409, error: 'That duel has no opponent.' };

    room.packClaimed = true;
    try {
      await saveRoom(room);
      return { ok: true, duelistId };
    } catch (err) {
      if (!(err instanceof StaleRoom)) throw err;
      /* Somebody else moved the room; read it again and re-decide. */
    }
  }
  return { ok: false, status: 409, error: 'That duel is busy. Try again in a moment.' };
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
 * A duel started from inside Story Mode.
 *
 * Unlike the menu's solo duel, nobody picks anything: both seats are decided
 * here and the duel begins the moment the room exists. The player is seated as
 * the character they made, holding the twenty-five cards they own; the far side
 * is whichever duelist invited them, playing that duelist's own premade.
 *
 * The player's seat still carries a `duelistId`, because the board is dressed
 * from one — accent colours and an epithet. It is a costume over their own
 * cards, and `story` is what says so: the lobby, the rematch and "choose new
 * duelists" all mean something different when the duel was entered from a
 * conversation, and the flag is how the room says which kind it is.
 */
export async function createStoryRoom(
  name: string,
  deck: string[],
  opponentId: string,
  dress = 'yugi'
): Promise<{ room: Room; token: string; pid: PlayerId }> {
  const { room, token, pid } = await createRoom(name);
  const foe = DUELIST_BY_ID[opponentId] ? opponentId : 'mai';
  /*
   * The player's costume must not be the opponent's.
   *
   * The board takes its accent colours from each side's duelist, so seating both
   * in the same one makes the two halves of the table identical — which is a
   * confusing duel and was the first thing this got wrong.
   */
  let costume = DUELIST_BY_ID[dress] ? dress : 'yugi';
  if (costume === foe) costume = foe === 'yugi' ? 'kaiba' : 'yugi';
  const seat = room.seats[pid];
  if (seat) {
    seat.duelistId = costume;
    seat.deck = deck;
  }
  room.story = true;
  room.seats.p2 = {
    token: randomToken(),
    name: DUELIST_BY_ID[foe]?.name ?? 'Opponent',
    duelistId: foe,
    lastSeen: Date.now(),
    ai: true,
  };
  maybeStart(room);
  await saveRoom(room);
  return { room, token, pid };
}

/**
 * An exhibition room: both seats are the computer, chosen up front, and the
 * duel starts the moment the room exists. The creator holds no seat — they
 * are the audience — so the duel only ever advances when a watcher nudges it,
 * which is also what makes pausing free: stop nudging and the board freezes
 * exactly where it is, because on a serverless room nothing moves by itself.
 */
export async function createExhibitionRoom(a: string, b: string): Promise<{ room: Room }> {
  const { room } = await createRoom('');
  const pick = (id: string) => (DUELIST_BY_ID[id] ? id : DUELISTS[Math.floor(Math.random() * DUELISTS.length)].id);
  const first = pick(a);
  const second = pick(b);
  room.spectate = true;
  room.seats.p1 = {
    token: randomToken(),
    name: DUELIST_BY_ID[first]?.name ?? 'Duelist',
    duelistId: first,
    lastSeen: Date.now(),
    ai: true,
  };
  room.seats.p2 = {
    token: randomToken(),
    name: DUELIST_BY_ID[second]?.name ?? 'Duelist',
    duelistId: second,
    lastSeen: Date.now(),
    ai: true,
  };
  maybeStart(room);
  await saveRoom(room);
  return { room };
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

  // 2. Advance one outstanding computer match by a slice. Usually the duel is
  // already finished or nearly so — the background nudges played it while the
  // human was still fighting their own — and this is only the tail.
  if (await stepSideDuels(room)) return true;

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

/** Where a bracket match's in-progress board lives between slices. */
const sideDuelKey = (code: string, round: number, slot: number) =>
  `duel:tour:${code.toUpperCase()}:r${round}s${slot}`;

interface HeldSideDuel {
  revision: number;
  state: DuelState;
}

/**
 * Advances the bracket's computer matches by one budgeted slice.
 *
 * This is what lets the side matches play out WHILE the human plays their own
 * — the client nudges it quietly in the background, and by the time the
 * human's duel ends the bracket is usually already filled in. The in-progress
 * board lives under its own store key, not on the room: a slice then never
 * contends with the human's duel for the room object, and two racing nudges
 * settle by compare-and-swap — the loser's slice is discarded and replayed,
 * identically, because every action in it is deterministic.
 *
 * Only the finished RESULT touches the room, and that write reloads the room
 * fresh first: this function's copy may be minutes stale against a live duel,
 * and writing it back would hand the player an old board.
 */
export async function stepSideDuels(room: Room, budgetMs = 3500, actionMs = 900): Promise<boolean> {
  const t = room.tournament;
  if (!t || t.champion) return false;
  if (settleByes(t)) {
    await saveRoom(room);
    return true;
  }
  const m = nextSideMatch(t);
  if (!m || !m.a || !m.b) return false;

  const key = sideDuelKey(room.code, m.round, m.slot);
  let held = await readJson<HeldSideDuel>(key);
  if (!held) {
    const fresh: HeldSideDuel = { revision: 1, state: createSideDuel(m.a, m.b, sideSeed(t, m)) };
    // Claimed atomically so two simultaneous nudges cannot both deal the
    // opening hand; the loser reads whatever the winner wrote.
    held = (await claim(key, JSON.stringify(fresh))) ? fresh : await readJson<HeldSideDuel>(key);
    if (!held) return false;
  }

  const from = held.revision;
  const res = stepSideDuel(held.state, budgetMs, actionMs);
  if (!res.done) {
    await writeJsonIf(key, { revision: from + 1, state: res.state }, from, from + 1);
    return true;
  }

  const winner = sideWinner(res.state, m.a, m.b);
  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await loadRoom(room.code);
    const cm = cur?.tournament?.matches.find((x) => x.round === m.round && x.slot === m.slot);
    if (!cur || !cm || cm.winner) return true;
    cm.winner = winner;
    try {
      await saveRoom(cur);
      return true;
    } catch (err) {
      if (!(err instanceof StaleRoom)) throw err;
    }
  }
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
  const hadWinner = !!s.winner;
  if (room.aiActions.count > 60 && !s.pending) {
    room.aiPlan = undefined;
    const bail = applyAction(s, pid, { type: 'endTurn' });
    if (!bail.error) {
      room.state = bail.state;
      await saveRoom(room);
      if (!hadWinner && room.state.winner) await learnFromEnd(room);
      return true;
    }
  }

  /* The deck's learned style, folded into the search config. Neutral (a new
     deck, or the store unreachable) is exactly the shipped search. */
  const deckId = room.seats[pid]?.duelistId;
  const brain = deckId ? await loadBrain(deckId).catch(() => null) : null;
  const cfg: AiConfig = brain
    ? { ...AI_LEVELS[GAME_AI], style: { aggression: brain.aggression, caution: brain.caution } }
    : { ...AI_LEVELS[GAME_AI] };

  let action: DuelAction;
  if (s.pending) {
    // A response window cannot be planned in advance — decide it on the spot,
    // and drop whatever was left of the turn plan, since the board is about to
    // change underneath it.
    room.aiPlan = undefined;
    action = s.pending.kind === 'choose' ? chooseCardResponse(s, pid, cfg, 800) : chooseTrapResponse(s, pid, cfg, 2000);
  } else {
    const key = turnKey;
    if (room.aiPlan?.key !== key || !room.aiPlan.actions.length) {
      /* Eight seconds to plan the whole turn, once per turn. The board
         narrates every beat for over a second anyway, so the think overlaps
         the tail of the previous action far more often than it is felt — and
         the function has a 30s ceiling with a hard wall inside the search,
         so there is no platform pressure to hurry. */
      room.aiPlan = { key, actions: planTurn(s, pid, cfg, 8000) };
    }
    action = room.aiPlan.actions.shift() ?? { type: 'endTurn' };
  }

  let res = applyAction(s, pid, action);
  if (res.error) {
    // The plan went stale against the real position. Search again from here.
    room.aiPlan = undefined;
    const rt = createAiRuntime();
    const retry = aiNext(s, pid, cfg, rt, 8000);
    res = retry ? applyAction(s, pid, retry) : res;
  }
  if (res.error) {
    // Still stuck — never let the computer wedge the duel; pass instead.
    /* Still stuck — never let the computer wedge the duel. A choice window has
       no "decline": passing on it would leave the question open forever, so the
       fallback answers it with the first legal option. */
    const bail: DuelAction = !s.pending
      ? { type: 'endTurn' }
      : s.pending.kind === 'choose'
        ? { type: 'chooseCard', uids: s.pending.options.slice(0, s.pending.want) }
        : { type: 'respondTrap', uid: null };
    res = applyAction(s, pid, bail);
    if (res.error) return false;
  }
  room.state = res.state;
  await saveRoom(room);
  if (!hadWinner && room.state.winner) await learnFromEnd(room);
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

export function viewOf(room: Room, pid: PlayerId, spectator = false): RoomView {
  const seatView = (id: PlayerId) => {
    const s = room.seats[id];
    if (!s) return null;
    // The computer is always "connected" — there is nothing to disconnect.
    return { name: s.name, duelistId: s.duelistId, connected: s.ai ? true : Date.now() - s.lastSeen < 20_000, ai: s.ai };
  };
  /* The audience is shown both hands; a seated player only ever their own. */
  let state = room.state ? (spectator ? viewForSpectator(room.state) : viewFor(room.state, pid)) : null;
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
    spectate: spectator || undefined,
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
    p1: { duelistId: a.duelistId, name: a.name, deck: a.deck },
    p2: { duelistId: b.duelistId, name: b.name, deck: b.deck },
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
  const hadWinner = !!room.state.winner;
  const res = applyAction(room.state, pid, action);
  if (res.error) return res.error;
  room.state = res.state;
  // Anything the human does can invalidate a half-played computer turn.
  room.aiPlan = undefined;
  await saveRoom(room);
  if (!hadWinner && room.state.winner) await learnFromEnd(room);
  return null;
}

export function opponentOf(pid: PlayerId): PlayerId {
  return other(pid);
}

/**
 * A finished duel teaches the deck that played it — see `server/learning.ts`.
 *
 * Human-versus-computer only: exhibitions and headless bracket matches are
 * the same brain playing itself, and a brain grading its own homework learns
 * style drift, not duelling. Failures are swallowed: a lost lesson costs one
 * game of learning, a thrown error here would cost the player their sync.
 */
async function learnFromEnd(room: Room): Promise<void> {
  const s = room.state;
  if (!s?.winner || s.winner === 'draw' || room.spectate) return;
  for (const pid of ['p1', 'p2'] as PlayerId[]) {
    const seat = room.seats[pid];
    const foeSeat = room.seats[other(pid)];
    if (!seat?.ai || !seat.duelistId || foeSeat?.ai) continue;
    const me = s.players[pid];
    const them = s.players[other(pid)];
    await recordGame(seat.duelistId, {
      won: s.winner === pid,
      myLp: me.lp,
      theirLp: them.lp,
      myHandLeft: me.hand.length,
      myBoardLeft: me.monsters.filter(Boolean).length,
      turns: s.turn,
    }).catch(() => {});
  }
}

export type { DuelState };
