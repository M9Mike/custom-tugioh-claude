'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DUELISTS, artUrl } from '@/game/cards';
import { joinRoomWithRetry, loadName, saveName } from '@/lib/useDuelRoom';
import { primeAudio, sfx } from '@/lib/sfx';

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | 'solo' | 'tournament' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  /* Both fields are controlled, so React's first commit after hydration
     replaces whatever the browser holds with React's own (empty) state. On a
     cold serverless start over a phone connection that can land a second or
     two in, by which time someone has already typed their name — and watched
     it vanish. Whatever is in the field at that moment wins. */
  useEffect(() => {
    const typed = nameRef.current?.value ?? '';
    setName(typed || loadName());
    const typedCode = codeRef.current?.value ?? '';
    if (typedCode) setCode(typedCode.toUpperCase());
  }, []);

  const openRoom = async (body: Record<string, unknown>, kind: 'create' | 'solo' | 'tournament') => {
    setError(null);
    setBusy(kind);
    primeAudio();
    sfx.click();
    saveName(name);
    try {
      const res = await fetch('/api/room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, ...body }),
        cache: 'no-store',
      });
      const data = (await res.json()) as { ok?: boolean; code?: string; token?: string; error?: string };
      if (!data.code || !data.token) {
        setError(data.error ?? 'Could not open a duel right now. Try again in a moment.');
        setBusy(null);
        return;
      }
      window.localStorage.setItem(`duel-identity:${data.code}`, JSON.stringify({ code: data.code, token: data.token }));
      router.push(`/duel/${data.code}`);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setBusy(null);
    }
  };

  const create = () => openRoom({}, 'create');
  const soloDuel = () => openRoom({ vsAi: true }, 'solo');
  // A bracket has to be drawn around the player's own duelist, so it is chosen
  // before the room exists rather than in the lobby afterwards.
  const tournament = () => setPicking(true);
  const enterTournament = (duelistId: string) => openRoom({ tournament: true, duelistId }, 'tournament');

  const join = async () => {
    const c = code.trim().toUpperCase();
    if (c.length < 4) {
      setError('A room code is 4 characters.');
      return;
    }
    setError(null);
    setBusy('join');
    primeAudio();
    sfx.click();
    saveName(name);
    const res = await joinRoomWithRetry(c, name, undefined);
    if (!res.ok) {
      setError(res.reason);
      setBusy(null);
      return;
    }
    window.localStorage.setItem(`duel-identity:${res.code}`, JSON.stringify({ code: res.code, token: res.token }));
    router.push(`/duel/${res.code}`);
  };

  if (picking) {
    return (
      <main className="safe-page mx-auto flex min-h-[100dvh] w-full max-w-3xl flex-col justify-center gap-4 p-5">
        <div className="text-center">
          <p className="font-display text-[11px] uppercase tracking-[0.45em] text-brass">Duelist Kingdom</p>
          <h1 className="mt-2 font-display text-3xl tracking-wide text-brassbright">Choose your duelist</h1>
          <div className="brass-rule mx-auto my-3 w-48" />
          <p className="mx-auto max-w-md text-xs leading-relaxed text-ptext/85">
            Seven rivals are drawn against you in a bracket of eight. Three wins takes the crown — lose once and the
            run is over.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
          {DUELISTS.map((d) => (
            <button
              key={d.id}
              disabled={busy !== null}
              onClick={() => {
                sfx.click();
                void enterTournament(d.id);
              }}
              className="panel grain group relative flex flex-col overflow-hidden rounded p-0 text-left transition-transform hover:-translate-y-0.5 disabled:opacity-50"
            >
              <div className="relative min-h-[86px] w-full flex-1 overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={artUrl(d.emblem)}
                  alt={d.name}
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/25 to-transparent" />
                <div
                  className="absolute inset-x-0 bottom-0 h-0.5"
                  style={{ background: `linear-gradient(90deg, transparent, ${d.accent}, transparent)` }}
                />
              </div>
              <div className="p-2">
                <p className="truncate font-display text-[13px] leading-tight text-parchment">{d.name}</p>
                <p className="truncate text-[10px] text-ptextdim">{d.epithet}</p>
              </div>
            </button>
          ))}
        </div>

        {error && (
          <p className="rounded border border-oxblood bg-[#2a1216]/70 px-3 py-2 text-xs text-[#f0c9cc]">{error}</p>
        )}

        <button className="btn mx-auto rounded px-4 py-2 text-xs" onClick={() => setPicking(false)} disabled={busy !== null}>
          {busy === 'tournament' ? 'Drawing the bracket…' : 'Back'}
        </button>
      </main>
    );
  }

  return (
    <main className="safe-page mx-auto flex min-h-[100dvh] w-full max-w-5xl flex-col items-center justify-center gap-6 p-5">
      <div className="text-center">
        <p className="font-display text-[11px] uppercase tracking-[0.45em] text-brass">Duelist Kingdom</p>
        <h1 className="mt-2 font-display text-5xl leading-none tracking-wide text-brassbright sm:text-7xl">
          Shadow Duel
        </h1>
        <div className="brass-rule mx-auto my-4 w-56" />
        <p className="mx-auto max-w-xl text-sm leading-relaxed text-ptext/85">
          A two-player duel between the original season&nbsp;1 duelists. Ten hand-built 25-card decks, real card art,
          and every single card rewritten with an overpowered anime effect.
        </p>
      </div>

      <div className="panel grain w-full max-w-lg rounded p-5">
        <label className="block">
          <span className="font-display text-[10px] uppercase tracking-widest text-ptextdim">Your name</span>
          <input
            ref={nameRef}
            value={name}
            maxLength={18}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter your name"
            className="mt-1 w-full rounded border border-stoneline bg-black/45 px-3 py-2 text-sm text-parchment outline-none focus:border-brass"
          />
        </label>

        <button
          className="btn btn-primary mt-4 w-full rounded px-4 py-3 text-sm"
          onClick={create}
          disabled={busy !== null}
        >
          {busy === 'create' ? 'Opening the arena…' : 'Start a new duel'}
        </button>

        <div className="my-4 flex items-center gap-3">
          <div className="brass-rule flex-1" />
          <span className="font-display text-[10px] uppercase tracking-widest text-ptextdim">or play alone</span>
          <div className="brass-rule flex-1" />
        </div>

        <button className="btn mt-1 w-full rounded px-4 py-3 text-sm" onClick={soloDuel} disabled={busy !== null}>
          {busy === 'solo' ? 'Shuffling…' : 'Duel the computer'}
        </button>

        <button
          className="btn btn-primary mt-2 w-full rounded px-4 py-3 text-sm"
          onClick={tournament}
          disabled={busy !== null}
        >
          {busy === 'tournament' ? 'Drawing the bracket…' : '🏆 Enter the tournament'}
        </button>

        <p className="mt-2 text-[10px] leading-relaxed text-ptextdim">
          Eight duelists, single elimination. Win three duels and the Kingdom is yours. The computer plays at full
          strength in every one of them — there is no easy setting.
        </p>

        <div className="my-4 flex items-center gap-3">
          <div className="brass-rule flex-1" />
          <span className="font-display text-[10px] uppercase tracking-widest text-ptextdim">or join</span>
          <div className="brass-rule flex-1" />
        </div>

        <div className="flex gap-2">
          <input
            ref={codeRef}
            value={code}
            maxLength={4}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void join();
            }}
            placeholder="CODE"
            className="w-full rounded border border-stoneline bg-black/45 px-3 py-2 text-center font-display text-2xl tracking-[0.4em] text-parchment outline-none focus:border-brass"
          />
          <button className="btn shrink-0 rounded px-5 text-xs" onClick={join} disabled={busy !== null}>
            {busy === 'join' ? '…' : 'Join'}
          </button>
        </div>

        {error && (
          <p className="mt-3 rounded border border-oxblood bg-[#2a1216]/70 px-3 py-2 text-xs text-[#f0c9cc]">{error}</p>
        )}

        <p className="mt-4 text-center text-[11px] leading-relaxed text-ptextdim">
          Start a duel, then send the link or the 4-letter code to your opponent — the game begins once you have both
          picked a duelist. Or take on the computer straight away, no second player needed.
        </p>
      </div>

      {/* duelist strip */}
      <div className="w-full">
        <p className="mb-2 text-center font-display text-[10px] uppercase tracking-[0.3em] text-ptextdim">
          Ten duelists · ten decks
        </p>
        <div className="thin-scroll flex justify-start gap-2 overflow-x-auto pb-2 sm:justify-center">
          {DUELISTS.map((d) => (
            <div key={d.id} className="group w-[92px] shrink-0 text-center" title={`${d.name} — ${d.epithet}`}>
              <div
                className="h-[68px] w-full overflow-hidden rounded border"
                style={{ borderColor: d.accent }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={artUrl(d.emblem)}
                  alt={d.name}
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                />
              </div>
              <p className="mt-1 truncate font-display text-[10px] text-ptext/80">{d.name}</p>
            </div>
          ))}
        </div>
      </div>

      <footer className="pb-2 text-center text-[10px] leading-relaxed text-ptextdim/70">
        A private, non-commercial fan project. Yu-Gi-Oh! and all card artwork are the property of Kazuki Takahashi and
        Konami. Card effects here are original and do not match the official game.
      </footer>
    </main>
  );
}
