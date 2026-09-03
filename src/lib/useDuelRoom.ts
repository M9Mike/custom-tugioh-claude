'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoomView } from '@/server/rooms';
import type { DuelAction } from '@/game/types';

export type ConnStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'lost';

interface Identity {
  code: string;
  token: string;
}

const STORE_KEY = 'duel-identity';

/**
 * Your seat in a room, remembered per code.
 *
 * Exported because the home page needs it too: typing a code you are already
 * sitting in has to hand the stored token back, or the server has no way to
 * know it is you and tries to seat you afresh — into a room whose two seats
 * are already taken, including yours.
 */
export function loadIdentity(code: string): Identity | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`${STORE_KEY}:${code.toUpperCase()}`);
    return raw ? (JSON.parse(raw) as Identity) : null;
  } catch {
    return null;
  }
}

export function saveIdentity(id: Identity) {
  try {
    window.localStorage.setItem(`${STORE_KEY}:${id.code.toUpperCase()}`, JSON.stringify(id));
  } catch {
    /* private browsing — the session just won't survive a refresh */
  }
}

export function loadName(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem('duel-name') ?? '';
  } catch {
    return '';
  }
}

export function saveName(name: string) {
  try {
    window.localStorage.setItem('duel-name', name);
  } catch {
    /* ignore */
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Joins a room, retrying on 404 — a room created a moment ago may not be
 * readable yet, and a transient storage blip should not end a duel.
 */
export async function joinRoomWithRetry(
  code: string,
  name: string,
  token: string | undefined,
  onProgress?: (attempt: number) => void
): Promise<{ ok: true; code: string; token: string; view: RoomView } | { ok: false; reason: string; kind: 'full' | 'missing' }> {
  const delays = [0, 400, 800, 1200, 1600, 2000, 2500, 3000, 3500, 4000, 4500];
  for (let i = 0; i < delays.length; i++) {
    if (delays[i]) await sleep(delays[i]);
    onProgress?.(i + 1);
    let res: Response;
    try {
      res = await fetch(`/api/room/${encodeURIComponent(code.toUpperCase())}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, token }),
        cache: 'no-store',
      });
    } catch {
      continue; // transient network blip — retry
    }
    if (res.ok) {
      const data = (await res.json()) as { code: string; token: string; view: RoomView };
      return { ok: true, code: data.code, token: data.token, view: data.view };
    }
    if (res.status === 409) return { ok: false, kind: 'full', reason: 'This duel already has two players. Ask them to start a new one, or reopen the link on the device you first joined from.' };
    // 404 -> keep retrying
  }
  return { ok: false, kind: 'missing', reason: 'Could not find that duel. Check the code, or start a new duel.' };
}

export function useDuelRoom(code: string | null) {
  const [view, setView] = useState<RoomView | null>(null);
  const [status, setStatus] = useState<ConnStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<'full' | 'missing' | null>(null);
  const tokenRef = useRef<string | null>(null);
  const aliveRef = useRef(true);
  const revisionRef = useRef(-1);
  const viewRef = useRef<RoomView | null>(null);

  /* Set by the board while it still has animations to play. A ref rather than
     state: it must not re-render the tree, and the nudge only ever reads it at
     the moment it fires. */
  const busyRef = useRef(false);
  const [animating, setAnimatingState] = useState(false);
  const setAnimating = useCallback((busy: boolean) => {
    busyRef.current = busy;
    setAnimatingState(busy);
  }, []);

  /* The spectator's pause. On a serverless room nothing moves unless a client
     asks it to, so pausing really is just not asking: the nudge loop stops and
     the duel freezes exactly where it stands, for as long as you like. State
     (not a ref) so flipping it re-runs the nudge effect, which is what makes
     resume pick the duel straight back up rather than waiting on a poll.
     Local to this viewer — a second phone watching the same exhibition keeps
     its own finger on its own button. */
  const [paused, setPaused] = useState(false);

  /* Whether the duel board is on screen. The board sets it on mount and clears
     it on unmount; it starts false so a screen that is not the board can never
     let the computer play unwatched. State rather than a ref, because the nudge
     effect has to re-run the moment the player walks in. */
  const [watching, setWatching] = useState(false);

  /**
   * Applies a server view — unless a newer one has already landed.
   *
   * Three producers race for this call: the poll loop, action responses and the
   * AI nudge, each a separate HTTP request with its own latency. A poll that
   * left the server *before* an action resolved can arrive *after* the action's
   * own response, and applying it blindly rewound the board a frame — your
   * summon un-happened for a beat and then happened again on the next poll,
   * and the animation queue saw the same events arrive twice around a dip in
   * `state.version`. The room's `revision` only ever moves forward (it survives
   * a rematch, where the duel's own version resets), so it is the clock:
   * anything older than what is already on screen is news that has expired.
   *
   * `force` is for `connect()` alone — a re-join is authoritative, and must be
   * able to recover even if a stale ref says otherwise.
   */
  const applyView = useCallback((v: RoomView, force = false) => {
    if (!force && viewRef.current && v.revision < revisionRef.current) return;
    revisionRef.current = v.revision;
    viewRef.current = v;
    setView(v);
  }, []);

  /* ---- join, then poll for changes ----
   *
   * Polling rather than a held-open stream: rooms live in shared storage, so any
   * request can be served by any serverless instance. A stream would pin a
   * player to one instance and break the moment the platform scaled out.
   */
  useEffect(() => {
    if (!code) return;
    aliveRef.current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let missStreak = 0;

    const nextDelay = (): number => {
      if (typeof document !== 'undefined' && document.hidden) return 5000;
      const v = viewRef.current;
      if (!v) return 1200;
      // Poll hardest when waiting on the opponent; your own moves update the
      // board from their own response, so there is nothing to wait for.
      if (v.stage === 'lobby') return 1500;
      const s = v.state;
      if (!s || s.winner) return 3000;
      const waitingOnThem = s.pending ? s.pending.player !== v.you : s.active !== v.you;
      return waitingOnThem ? 1100 : 2600;
    };

    const poll = async () => {
      if (!aliveRef.current) return;
      const token = tokenRef.current;
      if (!token) return;
      try {
        const res = await fetch(
          `/api/room/${code}/state?token=${encodeURIComponent(token)}&since=${revisionRef.current}`,
          { cache: 'no-store' }
        );
        if (res.ok) {
          const data = (await res.json()) as { unchanged?: boolean; view?: RoomView };
          if (data.view) applyView(data.view);
          missStreak = 0;
          setStatus('live');
        } else if (res.status === 404 || res.status === 403) {
          // Seat or room went away — re-join, which also recovers a room that
          // was reallocated.
          missStreak += 1;
          setStatus('reconnecting');
          if (missStreak >= 2) await connect();
        }
      } catch {
        missStreak += 1;
        setStatus('reconnecting');
      } finally {
        if (aliveRef.current) timer = setTimeout(poll, nextDelay());
      }
    };

    const connect = async () => {
      if (!aliveRef.current) return;
      const stored = loadIdentity(code);
      const res = await joinRoomWithRetry(code, loadName(), stored?.token ?? tokenRef.current ?? undefined);
      if (!aliveRef.current) return;
      if (!res.ok) {
        setStatus('lost');
        setError(res.reason);
        setErrorKind(res.kind);
        return;
      }
      missStreak = 0;
      tokenRef.current = res.token;
      saveIdentity({ code: res.code, token: res.token });
      applyView(res.view, true);
      setStatus('live');
    };

    /* Deferred a tick rather than set straight out: setting state inside the
       effect's own body makes React re-render before it has finished
       committing, which is the cascade the compiler's rule is about. */
    queueMicrotask(() => { if (aliveRef.current) setStatus('connecting'); });
    /* The poll loop starts either way. `connect` swallows a failed fetch and
       returns a verdict, but the `res.json()` inside it can still throw on a
       body that arrives truncated — and a rejection here used to skip the
       `.then` and leave the loop unstarted, so the room went quiet for good
       over one malformed reply. The loop is the thing that recovers from that:
       two misses and it reconnects by itself. */
    void connect()
      .catch(() => setStatus('reconnecting'))
      .finally(() => {
        if (aliveRef.current) timer = setTimeout(poll, nextDelay());
      });

    // Coming back to the tab should refresh immediately, not on the next tick.
    const onVisible = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        void poll();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      aliveRef.current = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [code, applyView]);

  const send = useCallback(
    async (body: Record<string, unknown>): Promise<string | null> => {
      const token = tokenRef.current;
      if (!code || !token) return 'Not connected.';
      try {
        const res = await fetch(`/api/room/${code}/act`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, token }),
          cache: 'no-store',
        });
        const data = (await res.json()) as { ok: boolean; error?: string; view?: RoomView };
        if (data.view) applyView(data.view);
        if (!data.ok) return data.error ?? 'That move is not allowed.';
        return null;
      } catch {
        return 'Connection hiccup — try again.';
      }
    },
    [code, applyView]
  );

  /* ---- drive the computer opponent ----
   *
   * The AI plays one action per request rather than a whole turn at once, and
   * the client asks for the next one on a timer. That pacing is the point: a
   * turn that resolved instantly would flash past, and this way each summon and
   * attack lands with its own animation. The nudge is idempotent — the server
   * checks whose move it is — so a duplicate in flight is harmless.
   */
  useEffect(() => {
    /* The computer's own move waits for an audience — see the comment on the
       board's `setWatching` effect. A bracket's side matches do not: they are
       what the bracket screen is showing you, so gating them on the duel board
       being open would deadlock the round. */
    const owed = (view?.aiToMove && watching) || view?.bracketBusy;
    if (!code || paused || !owed) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    /* Grows across consecutive *failed* attempts only, and dies with the effect
       — the moment one lands, the new view rebuilds this closure from 1500. */
    let backoff = 1500;

    const attempt = async () => {
      if (cancelled) return;
      /* Hold while the board is still narrating. The computer used to be asked
         for its next action every 750ms whatever was on screen, so a turn of
         six actions was six requests deep before the first one had finished
         announcing itself — the board raced ahead and the declarations piled
         up behind it. Asking only once the last beat has played is what makes
         a turn read as one thing after another. */
      if (busyRef.current) {
        timer = setTimeout(attempt, 750);
        return;
      }
      /* No token yet is a race with `connect`, not a reason to stop asking. */
      const token = tokenRef.current;
      if (!token) {
        timer = setTimeout(attempt, backoff);
        return;
      }
      let moved = false;
      try {
        const res = await fetch(`/api/room/${code}/ai`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
          cache: 'no-store',
        });
        if (cancelled) return;
        const data = (await res.json()) as { moved?: boolean; view?: RoomView };
        // Re-running this effect on the new view is what continues the turn.
        // When the server did not move, deliberately leave the view alone —
        // a fresh object here would retrigger the effect immediately and spin.
        if (data.moved && data.view) {
          moved = true;
          applyView(data.view);
        }
      } catch {
        /* Dropped on the way out, or on the way back. Falls through to the
           retry below, which is the whole point of this rewrite. */
      }
      if (cancelled || moved) return;
      /* Ask again.
         This used to return here and leave it to the poll loop — and the poll
         loop cannot help, because it only ever hands back a view when the
         room's revision has moved, and the only thing that would have moved it
         is the nudge that just failed. So one dropped request stopped the duel
         for good: no reply, no new view, no re-run of this effect, nothing left
         to ask again. The poll went on succeeding against an unchanged room, so
         the connection still read as live while the Life Points sat still.
         Reported as an exhibition frozen for ten minutes on production; it was
         frozen permanently, and it could never happen on a local server because
         a fetch to your own machine does not fail.
         Backed off rather than immediate, so a server that answers "nothing
         moved" every time is asked at the poll loop's pace and no faster. */
      timer = setTimeout(attempt, backoff);
      backoff = Math.min(backoff * 2, 6000);
    };

    timer = setTimeout(attempt, 750);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    /* `animating` is in the deps so the turn resumes the moment the board goes
       quiet, rather than waiting for the next poll to nudge it along —
       `paused` for the same reason in the other direction. */
  }, [code, view, applyView, animating, paused, watching]);

  /* The bracket's other matches, played while you play yours.
     A quiet second heartbeat: while a tournament duel is in progress and side
     matches are still open, the server is asked every few seconds to advance
     one of them by a slice. Fire-and-forget — the response carries no view,
     because the poll loop owns the view and a stale copy would roll the board
     back. By the time the human's duel ends, the bracket has usually already
     filled itself in, which is the whole point: nobody waits on a robot. */
  const bracketTour = view?.tournament;
  /* A primitive, not the view object: the view is rebuilt on every poll, and
     an effect keyed on it would reset its timer each time — the heartbeat
     would starve exactly when the board is busiest. */
  const sideOpen =
    !!bracketTour &&
    bracketTour.status === 'duelling' &&
    view?.stage === 'duel' &&
    bracketTour.matches.some((m) => m.round === bracketTour.round && !m.human && !m.winner);
  useEffect(() => {
    if (!code || paused || !sideOpen) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const nudge = async () => {
      if (cancelled) return;
      const token = tokenRef.current;
      if (token) {
        try {
          await fetch(`/api/room/${code}/ai`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, bracket: true }),
            cache: 'no-store',
          });
        } catch {
          /* A dropped nudge costs nothing: the next one replays the slice. */
        }
      }
      if (!cancelled) timer = setTimeout(nudge, 5000);
    };
    timer = setTimeout(nudge, 2000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code, paused, sideOpen]);

  const act = useCallback((action: DuelAction) => send({ kind: 'duel', action }), [send]);
  const chooseDuelist = useCallback((duelistId: string) => send({ kind: 'chooseDuelist', duelistId }), [send]);
  const setPlayerName = useCallback((name: string) => send({ kind: 'setName', name }), [send]);
  const rematch = useCallback(() => send({ kind: 'rematch' }), [send]);
  const toLobby = useCallback(() => send({ kind: 'toLobby' }), [send]);
  const configureAi = useCallback(
    (opts: { duelistId?: string }) => send({ kind: 'configureAi', ...opts }),
    [send]
  );

  return {
    view,
    status,
    error,
    errorKind,
    act,
    chooseDuelist,
    setPlayerName,
    rematch,
    toLobby,
    configureAi,
    setAnimating,
    setWatching,
    paused,
    setPaused,
    clearError: () => setError(null),
  };
}
