'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Duel from '@/components/Duel';
import Lobby from '@/components/Lobby';
import Bracket from '@/components/Bracket';
import { useDuelRoom } from '@/lib/useDuelRoom';
import { readPendingDuel, writePendingDuel, type PendingDuel } from '@/app/story/StoryMode';

export default function DuelRoom({ code }: { code: string }) {
  const { view, status, error, errorKind, act, chooseDuelist, setPlayerName, rematch, toLobby, configureAi, setAnimating, setWatching, paused, setPaused } =
    useDuelRoom(code);
  const router = useRouter();
  const [shareUrl, setShareUrl] = useState('');
  /**
   * Whether this room was entered from a conversation in Story Mode.
   *
   * Matched on the room code, not on the note merely existing: a player who
   * leaves a story duel and starts an ordinary one would otherwise be sent back
   * to Mai from a duel she had nothing to do with.
   */
  const [storyDuel, setStoryDuel] = useState<PendingDuel | null>(null);
  useEffect(() => {
    const pending = readPendingDuel();
    setStoryDuel(pending && pending.code === code ? pending : null);
  }, [code]);

  const storyReturn = storyDuel
    ? (won: boolean) => {
        writePendingDuel({ ...storyDuel, outcome: won ? 'won' : 'lost' });
        router.push('/story');
      }
    : undefined;
  /* The bracket round whose duel the player has walked into. Holding the round
     rather than a bare flag is what makes each new round open on the bracket
     again, with no effect needed to reset it. */
  const [enteredRound, setEnteredRound] = useState<number | null>(null);

  useEffect(() => {
    setShareUrl(`${window.location.origin}/duel/${code}`);
  }, [code]);

  if (status === 'lost' || (error && !view)) {
    return (
      <main className="safe-page grid min-h-[100dvh] place-items-center p-6">
        <div className="panel grain w-full max-w-md rounded p-6 text-center">
          <h1 className="font-display text-xl text-brassbright">
            {errorKind === 'full' ? 'This duel is full' : 'Duel not found'}
          </h1>
          <p className="mt-2 text-sm text-ptext/85">{error ?? 'This duel is no longer running.'}</p>
          {errorKind !== 'full' && (
            <p className="mt-2 text-xs text-ptextdim">
              {/* This used to say duels live in memory while both players are
                  connected, and that leaving ends them. Both halves were
                  wrong: a room is a document with a 90-minute clock that every
                  move resets, and nothing frees a seat when you close the app
                  — which is the whole reason typing your own code puts you
                  back in. Telling a player their duel was gone when it was
                  waiting for them is the worst thing this screen could say. */}
              A duel is kept for 90 minutes after the last move, and closing the app does not end it — your seat is
              held. So either that code has a typo, or the room sat untouched for an hour and a half.
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
      <main className="safe-page grid min-h-[100dvh] place-items-center p-6">
        <div className="text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-stoneline border-t-brass" />
          <p className="mt-4 font-display text-sm uppercase tracking-[0.3em] text-brass">Entering the arena</p>
          <p className="mt-1 text-xs text-ptextdim">Room {code}</p>
        </div>
      </main>
    );
  }

  const t = view.tournament;

  /* A tournament room opens on the bracket: at the start of every round, while
     the other matches are played out, and at the end. The player leaves it by
     walking into their own duel, and comes back with the 🏆 button — nothing is
     conceded by looking, the duel lives on the server and is where they left it. */
  if (t) {
    const duelOver = !!view.state?.winner;
    /* When there is no duel to look at there is nothing to choose between.
       A *finished* duel is still worth showing — the win screen is how the
       round is announced — so `bracketBusy` alone does not force the switch. */
    /* Once the result is being recorded the duel is over and must not be
       re-entered: going back to it showed the finished board again, and the
       player had to poke at it before the bracket would move on. The win
       screen still gets its moment — the status is only 'resolving' after the
       server has taken the result. */
    if (!view.state || t.status === 'resolving' || enteredRound !== t.round) {
      return (
        <Bracket
          t={t}
          busy={!!view.bracketBusy}
          onContinue={
            t.status === 'duelling' && view.state && !duelOver ? () => setEnteredRound(t.round) : undefined
          }
        />
      );
    }
  }

  if (view.stage === 'duel' && view.state) {
    return (
      <Duel
        view={view}
        act={act}
        rematch={rematch}
        onStoryReturn={storyReturn}
        toLobby={toLobby}
        connection={status}
        onBracket={t ? () => setEnteredRound(null) : undefined}
        setAnimating={setAnimating}
        setWatching={setWatching}
        paused={paused}
        setPaused={setPaused}
      />
    );
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
