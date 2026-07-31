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
 * Joins a room, retrying on 404. A room lives in one warm serverless instance;
 * a 404 usually means this request reached a different (cold) instance, so we
 * back off and try again rather than declaring the duel dead.
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
  const esRef = useRef<EventSource | null>(null);
  const aliveRef = useRef(true);
  const revisionRef = useRef(-1);

  const applyView = useCallback((v: RoomView) => {
    revisionRef.current = v.revision;
    setView(v);
  }, []);

  /* ---- connect / reconnect loop ---- */
  useEffect(() => {
    if (!code) return;
    aliveRef.current = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let backoff = 500;

    const openStream = (token: string) => {
      if (!aliveRef.current) return;
      esRef.current?.close();
      const es = new EventSource(`/api/room/${code}/stream?token=${encodeURIComponent(token)}`);
      esRef.current = es;

      es.onopen = () => {
        if (!aliveRef.current) return;
        backoff = 500;
        setStatus('live');
      };
      es.onmessage = (ev) => {
        if (!aliveRef.current) return;
        try {
          applyView(JSON.parse(ev.data) as RoomView);
          setStatus('live');
        } catch {
          /* malformed frame — the next one will resync */
        }
      };
      es.onerror = () => {
        es.close();
        if (!aliveRef.current) return;
        setStatus('reconnecting');
        // The server closes the stream every ~45s on purpose; reconnect fast.
        retryTimer = setTimeout(() => reconnect(), backoff);
        backoff = Math.min(backoff * 1.6, 5000);
      };
    };

    const reconnect = async () => {
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
      tokenRef.current = res.token;
      saveIdentity({ code: res.code, token: res.token });
      applyView(res.view);
      openStream(res.token);
    };

    setStatus('connecting');
    void reconnect();

    return () => {
      aliveRef.current = false;
      clearTimeout(retryTimer);
      esRef.current?.close();
      esRef.current = null;
    };
  }, [code, applyView]);

  /* ---- polling safety net + instance keepalive ---- */
  useEffect(() => {
    if (!code) return;
    const poll = setInterval(async () => {
      const token = tokenRef.current;
      if (!token || document.hidden) return;
      try {
        const res = await fetch(
          `/api/room/${code}/state?token=${encodeURIComponent(token)}&since=${revisionRef.current}`,
          { cache: 'no-store' }
        );
        if (!res.ok) return;
        const data = (await res.json()) as { unchanged?: boolean; view?: RoomView };
        if (data.view) applyView(data.view);
      } catch {
        /* the SSE stream is the primary channel; ignore poll failures */
      }
    }, 3000);
    const ping = setInterval(() => {
      void fetch('/api/ping', { cache: 'no-store' }).catch(() => {});
    }, 20_000);
    return () => {
      clearInterval(poll);
      clearInterval(ping);
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

  const act = useCallback((action: DuelAction) => send({ kind: 'duel', action }), [send]);
  const chooseDuelist = useCallback((duelistId: string) => send({ kind: 'chooseDuelist', duelistId }), [send]);
  const setPlayerName = useCallback((name: string) => send({ kind: 'setName', name }), [send]);
  const rematch = useCallback(() => send({ kind: 'rematch' }), [send]);
  const toLobby = useCallback(() => send({ kind: 'toLobby' }), [send]);

  return { view, status, error, errorKind, act, chooseDuelist, setPlayerName, rematch, toLobby, clearError: () => setError(null) };
}
