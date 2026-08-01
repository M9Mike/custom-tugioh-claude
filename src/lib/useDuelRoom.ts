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

function loadIdentity(code: string): Identity | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`${STORE_KEY}:${code.toUpperCase()}`);
    return raw ? (JSON.parse(raw) as Identity) : null;
  } catch {
    return null;
  }
}

function saveIdentity(id: Identity) {
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

  const applyView = useCallback((v: RoomView) => {
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
      applyView(res.view);
      setStatus('live');
    };

    setStatus('connecting');
    void connect().then(() => {
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
    if (!code || !(view?.aiToMove || view?.bracketBusy)) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      /* Hold while the board is still narrating. The computer used to be asked
         for its next action every 750ms whatever was on screen, so a turn of
         six actions was six requests deep before the first one had finished
         announcing itself — the board raced ahead and the declarations piled
         up behind it. Asking only once the last beat has played is what makes
         a turn read as one thing after another. */
      if (busyRef.current && !cancelled) return;
      const token = tokenRef.current;
      if (cancelled || !token) return;
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
        // When the server did not move, deliberately leave the view alone: a
        // fresh object would retrigger this effect and spin, so the slower poll
        // loop takes over instead.
        if (data.moved && data.view) applyView(data.view);
      } catch {
        /* the poll loop will pick the duel back up */
      }
    }, 750);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    /* `animating` is in the deps so the turn resumes the moment the board goes
       quiet, rather than waiting for the next poll to nudge it along. */
  }, [code, view, applyView, animating]);

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
    clearError: () => setError(null),
  };
}
