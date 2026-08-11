'use client';

/**
 * Story Mode, end to end: sign in, make a duelist, cut a deck, walk into the
 * world.
 *
 * One route and one piece of state, because the four screens are one *journey*
 * and which of them you are on is not something the player chooses — it is
 * whatever the save says you have not done yet. `stageFor` on the server's
 * profile decides it, so opening `/story` on a new phone lands exactly where
 * the old one left off with no client-side memory involved at all.
 *
 * The 3D screens are pulled in with `next/dynamic`. Story Mode is the only part
 * of this game with a WebGL renderer in it, and loading it here rather than at
 * the top of the module is what keeps that renderer off the home page and out
 * of the duel board entirely.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import DeckBuilder from '@/components/story/DeckBuilder';
import type { StoryProfile, StoryStage, WorldPosition } from '@/story/profile';
import { STARTER_POOL } from '@/story/roster';
import type { PremadeCharacter } from '@/story/premade';
import { primeAudio, sfx } from '@/lib/sfx';

const CharacterCreator = dynamic(() => import('@/components/story/CharacterCreator'), {
  ssr: false,
  loading: () => <Waiting line="Lighting the booth…" />,
});
const OpenWorld = dynamic(() => import('@/components/story/OpenWorld'), {
  ssr: false,
  loading: () => <Waiting line="Walking out into the field…" />,
});

const NAME_KEY = 'story-name';

type Screen = StoryStage | 'editDeck';

export default function StoryMode() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<StoryProfile | null>(null);
  const [screen, setScreen] = useState<Screen | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  /* Same trick as the home page: both fields are controlled, so React's first
     commit after hydration would otherwise wipe whatever was typed during a
     slow start. Whatever is in the field at that moment wins. */
  useEffect(() => {
    const typed = nameRef.current?.value ?? '';
    let remembered = '';
    try {
      remembered = window.localStorage.getItem(NAME_KEY) ?? '';
    } catch {
      /* private browsing */
    }
    setName(typed || remembered);
    primeAudio();
    setReady(true);
  }, []);

  const post = async <T,>(url: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> => {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!data.ok) return { ok: false, error: data.error ?? 'Something went wrong. Try again in a moment.' };
      return { ok: true, data: data as T };
    } catch {
      return { ok: false, error: 'Could not reach the server. Check your connection and try again.' };
    }
  };

  const signIn = async () => {
    setBusy(true);
    setError(null);
    primeAudio();
    sfx.click();
    const res = await post<{ profile: StoryProfile; stage: StoryStage }>('/api/story/login', { username: name });
    setBusy(false);
    if (!res.ok) {
      sfx.error();
      setError(res.error);
      return;
    }
    try {
      window.localStorage.setItem(NAME_KEY, res.data.profile.username);
    } catch {
      /* private browsing — they will type it again next time */
    }
    setProfile(res.data.profile);
    setScreen(res.data.stage);
  };

  const saveCharacter = async (character: PremadeCharacter): Promise<string | null> => {
    const res = await post<{ profile: StoryProfile; stage: StoryStage }>('/api/story/character', {
      username: profile?.username,
      character,
    });
    if (!res.ok) return res.error;
    setProfile(res.data.profile);
    setScreen(res.data.stage);
    return null;
  };

  const saveDeck = async (deck: string[]): Promise<string | null> => {
    const res = await post<{ profile: StoryProfile; stage: StoryStage }>('/api/story/deck', {
      username: profile?.username,
      deck,
    });
    if (!res.ok) return res.error;
    setProfile(res.data.profile);
    setScreen('world');
    return null;
  };

  const saveWorld = async (world: WorldPosition): Promise<string | null> => {
    const res = await post<{ profile: StoryProfile }>('/api/story/save', { username: profile?.username, world });
    if (!res.ok) return res.error;
    setProfile(res.data.profile);
    return null;
  };

  const deleteCharacter = async (): Promise<string | null> => {
    const res = await post<Record<string, never>>('/api/story/delete', { username: profile?.username });
    if (!res.ok) return res.error;
    /* The save is gone; forget every trace of it here too. Landing back on the
       sign-in screen rather than the home page makes the result visible:
       signing straight back in walks into the creation booth as on day one,
       which is the whole point of deleting. */
    setProfile(null);
    setScreen(null);
    return null;
  };

  const toMenu = () => router.push('/');

  /* ---------------- sign in ---------------- */

  if (!profile || !screen) {
    return (
      <main className="safe-page mx-auto flex min-h-[100dvh] w-full max-w-lg flex-col items-center justify-center gap-6 p-5">
        <div className="text-center">
          <h1 className="font-display text-4xl leading-none tracking-wide text-brassbright sm:text-5xl">Story Mode</h1>
          <div className="brass-rule mx-auto my-4 w-48" />
          <p className="mx-auto max-w-sm text-xs leading-relaxed text-ptext/85">
            Your duelist, your deck and your progress are kept against your name — sign in with it on any device and
            you pick up where you stopped.
          </p>
        </div>

        <div className="panel grain w-full rounded p-5">
          <label className="block">
            <span className="font-display text-[10px] uppercase tracking-widest text-ptextdim">Duelist name</span>
            <input
              ref={nameRef}
              value={name}
              maxLength={18}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && ready && !busy) void signIn();
              }}
              placeholder="Enter your name"
              className="mt-1 w-full rounded border border-stoneline bg-black/45 px-3 py-2 text-sm text-parchment outline-none focus:border-brass"
            />
          </label>

          <button
            className="btn btn-primary mt-4 w-full rounded px-4 py-3 text-sm"
            onClick={signIn}
            disabled={busy || !ready || !name.trim()}
          >
            {!ready ? 'Waking the arena…' : busy ? 'Signing in…' : 'Enter Story Mode'}
          </button>

          {error && (
            <p className="mt-3 rounded border border-oxblood bg-[#2a1216]/70 px-3 py-2 text-xs text-[#f0c9cc]">{error}</p>
          )}

          <p className="mt-4 text-center text-[11px] leading-relaxed text-ptextdim">
            No password yet, and no way to make a new name — that comes later.
          </p>
        </div>

        <button className="btn rounded px-4 py-2 text-xs" onClick={toMenu} disabled={busy}>
          Back to the main menu
        </button>
      </main>
    );
  }

  /* ---------------- the journey ---------------- */

  if (screen === 'character') {
    return (
      <CharacterCreator
        username={profile.username}
        onConfirm={saveCharacter}
        onBack={toMenu}
      />
    );
  }

  if (screen === 'deck') {
    return <DeckBuilder pool={STARTER_POOL} first onConfirm={saveDeck} />;
  }

  if (screen === 'editDeck') {
    return (
      <DeckBuilder
        pool={profile.collection}
        initial={profile.deck ?? []}
        first={false}
        onConfirm={saveDeck}
        onCancel={() => setScreen('world')}
      />
    );
  }

  return (
    <OpenWorld
      profile={profile}
      onEditDeck={() => setScreen('editDeck')}
      onSave={saveWorld}
      onDelete={deleteCharacter}
      onExit={toMenu}
    />
  );
}

/** What a dynamic import shows while the 3D chunk is still coming down. */
function Waiting({ line }: { line: string }) {
  return (
    <main className="safe-page grid min-h-[100dvh] w-full place-items-center p-6 text-center">
      <div>
        <p className="font-display text-sm uppercase tracking-[0.3em] text-brass">{line}</p>
        <div className="brass-rule mx-auto mt-3 w-40" />
      </div>
    </main>
  );
}
