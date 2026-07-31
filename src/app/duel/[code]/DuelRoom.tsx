'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Duel from '@/components/Duel';
import Lobby from '@/components/Lobby';
import { useDuelRoom } from '@/lib/useDuelRoom';

export default function DuelRoom({ code }: { code: string }) {
  const { view, status, error, errorKind, act, chooseDuelist, setPlayerName, rematch, toLobby, configureAi } =
    useDuelRoom(code);
  const [shareUrl, setShareUrl] = useState('');

  useEffect(() => {
    setShareUrl(`${window.location.origin}/duel/${code}`);
  }, [code]);

  if (status === 'lost' || (error && !view)) {
    return (
      <main className="grid min-h-[100dvh] place-items-center p-6">
        <div className="panel grain w-full max-w-md rounded p-6 text-center">
          <h1 className="font-display text-xl text-brassbright">
            {errorKind === 'full' ? 'This duel is full' : 'Duel not found'}
          </h1>
          <p className="mt-2 text-sm text-ptext/85">{error ?? 'This duel is no longer running.'}</p>
          {errorKind !== 'full' && (
            <p className="mt-2 text-xs text-ptextdim">
              Duels live in memory while both players are connected. If everyone left, the room is gone — but starting a
              fresh one takes two seconds.
            </p>
          )}
          <Link href="/" className="btn btn-primary mt-5 inline-block rounded px-5 py-2 text-xs">
            Start a new duel
          </Link>
        </div>
      </main>
    );
  }

  if (!view) {
    return (
      <main className="grid min-h-[100dvh] place-items-center p-6">
        <div className="text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-stoneline border-t-brass" />
          <p className="mt-4 font-display text-sm uppercase tracking-[0.3em] text-brass">Entering the arena</p>
          <p className="mt-1 text-xs text-ptextdim">Room {code}</p>
        </div>
      </main>
    );
  }

  if (view.stage === 'duel' && view.state) {
    return <Duel view={view} act={act} rematch={rematch} toLobby={toLobby} connection={status} />;
  }

  return (
    <Lobby
      view={view}
      chooseDuelist={chooseDuelist}
      setPlayerName={setPlayerName}
      shareUrl={shareUrl}
      configureAi={configureAi}
    />
  );
}
