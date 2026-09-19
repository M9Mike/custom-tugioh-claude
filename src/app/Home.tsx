'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CARDS, DUELISTS, artUrl } from '@/game/cards';
import GameCard from '@/components/GameCard';
import CardDetail from '@/components/CardDetail';
import { previewInstances } from '@/components/deckPreview';
import { menuDeckOrder, menuExtraOrder } from '@/story/deckSort';
import type { CardInstance } from '@/game/types';
import { joinRoomWithRetry, loadIdentity, loadName, saveIdentity, saveName } from '@/lib/useDuelRoom';
import { primeAudio, sfx } from '@/lib/sfx';
import { preloadStory, type StoryPreload } from '@/lib/storyPreload';

/** A player of the open world, as `/api/story/decks` prints them. */
type StoryPlayer = { username: string; character: string; deck: string[] };

/**
 * A deck the menu will open, whoever holds it.
 *
 * The strip used to map `DUELISTS` straight onto tiles and the viewer used to
 * look a `Duelist` up by id, which left no room for a deck that is not on the
 * roster. Both read this instead, and a duelist and a player differ only in
 * where the fields came from.
 */
type OnShow = {
  id: string;
  name: string;
  note: string;
  accent: string;
  emblem: string;
  deck: [string, number][];
  extra: string[];
};

/** `['dark-magician', 'kuriboh', …]` as the `[slug, count]` every deck screen reads. */
const tally = (slugs: readonly string[]): [string, number][] => {
  const counts = new Map<string, number>();
  for (const slug of slugs) counts.set(slug, (counts.get(slug) ?? 0) + 1);
  return [...counts];
};

/**
 * A player, as a tile and a deck.
 *
 * A duelist's emblem is a card chosen for them; a player has none, so theirs is
 * the card at the top of their own deck's ladder — the thing they paid the most
 * to put on the board. It moves when they rebuild, which is right: it is their
 * deck's own face and not a picture attached to their name.
 *
 * Story Mode has no Extra Deck (`validateDeck` takes exactly 25 and nothing
 * else), so there is nothing to show below the main deck.
 */
const asShelf = (p: StoryPlayer): OnShow => {
  const deck = menuDeckOrder(tally(p.deck));
  return {
    id: `player:${p.username}`,
    name: p.username,
    note: p.character && p.character !== p.username ? `walks Domino City as ${p.character}` : 'walks Domino City',
    accent: 'var(--brass)',
    emblem: deck[0]?.[0] ?? '',
    deck,
    extra: [],
  };
};

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | 'solo' | 'tournament' | 'spectate' | 'story' | null>(null);
  /**
   * How far Story Mode's assets have got.
   *
   * Its button stays shut until this says `ready`, so that walking in is
   * walking in rather than watching three.js and forty megabytes of duelists
   * arrive one at a time behind a placeholder. See `storyPreload`.
   */
  const [story, setStory] = useState<StoryPreload>({ phase: 'code' });
  /**
   * Whether the page is listening yet.
   *
   * These buttons do nothing at all until React has hydrated, and a tap that
   * lands before then is not queued — it is simply gone. On a warm load that
   * window does not exist; on a cold serverless start over a phone connection
   * it is a second or two, which is exactly when someone taps Join. They got
   * no room, no error and no reason, and tapping again was the only way
   * through. The buttons now say they are not ready instead of lying.
   */
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* One picker screen, three reasons to be on it: entering the tournament, or
     choosing each seat of an exhibition to watch. */
  const [picking, setPicking] = useState<null | 'tournament' | 'watchA' | 'watchB'>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  /** The first seat of an exhibition, locked in while the second is chosen. */
  const [watchA, setWatchA] = useState<string | null>(null);
  const [deckOpen, setDeckOpen] = useState<string | null>(null);
  const [deckInspect, setDeckInspect] = useState<CardInstance | null>(null);
  /**
   * The people who walk Domino City, and the decks they have locked.
   *
   * They are duelists as much as the roster is — they just do not live in
   * `decklists.json`, they live on the server, one save per account. Asked for
   * once on arrival; if the ask fails the strip is the roster and nothing else,
   * which is what it was before they were on it.
   */
  const [players, setPlayers] = useState<StoryPlayer[]>([]);
  const setPicked = (id: string) => { setPickedId(id); setDeckInspect(null); };
  const chosen = DUELISTS.find((d) => d.id === pickedId) ?? null;
  /* Everybody whose deck the menu will open, in the order they are shown: the
     roster first, then the players — and a player who has not built a deck yet
     is not here at all, because the route only hands back the ones who have. */
  const shelf: OnShow[] = [
    ...DUELISTS.map((d) => ({
      id: d.id,
      name: d.name,
      note: d.epithet,
      accent: d.accent,
      emblem: d.emblem,
      deck: d.deck,
      extra: d.extra,
    })),
    ...players.map(asShelf),
  ];
  const deck = deckOpen ? shelf.find((d) => d.id === deckOpen) ?? null : null;
  const nameRef = useRef<HTMLInputElement>(null);
  /** The tournament picker's choice panel, scrolled to when a duelist is tapped. */
  const pickRef = useRef<HTMLDivElement>(null);
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
    /* Arms the audio unlock before the first tap rather than during it. It used
       to be called from inside the button handlers, so the tap that called it
       was already past the listener it had just added — and on the home page
       that is the tap that starts the duel. */
    primeAudio();
    setReady(true);
  }, []);

  /* Started on arrival, not on hover or on press: the whole point is that it is
     already done by the time anybody reaches for it. */
  useEffect(() => preloadStory(setStory), []);

  /* The players' decks live on the server, so they arrive after the first
     paint and the strip grows by however many of them have built one. A
     failure is silence on purpose: the menu's job is the roster, and a tile
     that says "could not load" is worse than a tile that is not there. */
  useEffect(() => {
    let live = true;
    fetch('/api/story/decks', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { ok?: boolean; players?: StoryPlayer[] }) => {
        if (live && d?.ok && Array.isArray(d.players)) setPlayers(d.players);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const openRoom = async (body: Record<string, unknown>, kind: 'create' | 'solo' | 'tournament' | 'spectate') => {
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
      saveIdentity({ code: data.code, token: data.token });
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
  const tournament = () => setPicking('tournament');
  const enterTournament = (duelistId: string) => openRoom({ tournament: true, duelistId }, 'tournament');
  // An exhibition: both seats are chosen here, the duel starts on arrival, and
  // the only controls the watcher gets are a pause button and a rematch.
  const watch = () => {
    setPickedId(null);
    setDeckInspect(null);
    setWatchA(null);
    setPicking('watchA');
  };
  const beginExhibition = (a: string, b: string) => openRoom({ spectate: true, duelistA: a, duelistB: b }, 'spectate');

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
    /* Hand back the token for this code if we already hold a seat in it.
       Passing `undefined` asked the server to seat us afresh every time — so
       swiping the app away and typing your own room code back in was refused
       with "this duel already has two players", one of which was you. Only
       reopening the /duel/CODE link worked, because that path loads the
       identity; the home page did not. */
    const stored = loadIdentity(c);
    const res = await joinRoomWithRetry(c, name, stored?.token);
    if (!res.ok) {
      setError(res.reason);
      setBusy(null);
      return;
    }
    saveIdentity({ code: res.code, token: res.token });
    router.push(`/duel/${res.code}`);
  };

  /* The deck viewer, rendered by both screens.
     It used to live only inside the picker's markup, so opening it from
     anywhere else set the state and drew nothing at all. */
  const deckViewer = () =>
    deck && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4" onClick={() => { setDeckOpen(null); setDeckInspect(null); }}>
        <div className="panel grain thin-scroll max-h-[85dvh] w-full max-w-3xl overflow-y-auto rounded p-4" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between">
            {/* Counted, not written: the roster runs 25 and a player's deck is
                25 by `DECK_SIZE`, and a number that agrees with the cards under
                it by accident is a number that will stop agreeing. */}
            <h3 className="font-display text-lg text-parchment">
              {deck.name} — {deck.deck.reduce((n, [, c]) => n + c, 0)} cards
            </h3>
            <button className="btn rounded px-2 py-1 text-[10px]" onClick={() => { setDeckOpen(null); setDeckInspect(null); }}>✕</button>
          </div>
          <div className="brass-rule my-3" />
          {deckInspect && (
            <div className="mb-3">
              <CardDetail card={deckInspect} onClose={() => setDeckInspect(null)} layout="row" />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {/* Monsters, spells, traps, then the Extra Deck — and the monsters by
                what they cost to Summon. See `menuDeckOrder`. */}
            {previewInstances([
              ...menuDeckOrder(deck.deck),
              ...menuExtraOrder(deck.extra).map((x) => [x, 1] as [string, number]),
            ]).map((c) => (
              <button key={c.uid} data-deck-card={c.slug} className="w-[84px] text-left selectable rounded" onClick={() => { sfx.click(); setDeckInspect(c); }}>
                <GameCard card={c} />
                <p className="mt-0.5 truncate text-center text-[9px] text-ptextdim">{CARDS[c.slug]?.name}</p>
              </button>
            ))}
          </div>
        </div>
      </div>
    );

  if (picking) {
    const watchAName = DUELISTS.find((d) => d.id === watchA)?.name ?? '';
    return (
      <main className="safe-page mx-auto flex min-h-[100dvh] w-full max-w-3xl flex-col justify-center gap-4 p-5">
        <div className="text-center">
          <h1 className="font-display text-3xl tracking-wide text-brassbright">
            {picking === 'tournament'
              ? 'Choose your duelist'
              : picking === 'watchA'
                ? 'Choose the first duelist'
                : 'Choose the challenger'}
          </h1>
          <div className="brass-rule mx-auto my-3 w-48" />
          {picking === 'tournament' && (
            <p className="mx-auto max-w-md text-xs leading-relaxed text-ptext/85">
              Every duelist enters. You are drawn against them in a single-elimination bracket — lose once and the run
              is over.
            </p>
          )}
          {picking === 'watchB' && (
            <p className="mx-auto max-w-md text-xs leading-relaxed text-ptext/85">{watchAName} awaits an opponent.</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
          {DUELISTS.map((d) => (
            <button
              key={d.id}
              disabled={busy !== null}
              onClick={() => {
                sfx.click();
                setPicked(d.id);
                // The panel stacks below the grid on a phone, so bring it into
                // view — otherwise a tap looks like it did nothing, exactly as
                // it does in the versus lobby.
                requestAnimationFrame(() => pickRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
              }}
              className={`panel grain group relative flex flex-col overflow-hidden rounded p-0 text-left transition-transform hover:-translate-y-0.5 disabled:opacity-50 ${
                pickedId === d.id ? 'ring-2 ring-brass' : ''
              }`}
            >
              {/* Square by declaration, whatever shape the artwork is — the
                  same tile as the lobby's, for the same reason (see there). */}
              <div className="relative aspect-square w-full flex-1 overflow-hidden">
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

        {/* Tapping a portrait chooses, it does not commit — a three-duel run is
            worth reading the deck for first. */}
        {chosen && (
          <div ref={pickRef} className="panel grain rounded p-3">
            <div className="flex items-start gap-3">
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded border" style={{ borderColor: chosen.accent }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={artUrl(chosen.emblem)} alt="" className="h-full w-full object-cover" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-lg leading-tight text-parchment">{chosen.name}</h2>
                <p className="text-[11px] uppercase tracking-wider" style={{ color: chosen.accent2 }}>{chosen.epithet}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-ptext/85">{chosen.strategy}</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn rounded px-3 py-2 text-[11px]" onClick={() => setDeckOpen(chosen.id)}>
                View 25-card deck
              </button>
              <button
                className="btn btn-primary flex-1 rounded px-4 py-2 text-xs"
                disabled={busy !== null}
                onClick={() => {
                  sfx.click();
                  if (picking === 'tournament') return void enterTournament(chosen.id);
                  if (picking === 'watchA') {
                    // Lock the first seat and pick again for the second.
                    setWatchA(chosen.id);
                    setPickedId(null);
                    setDeckInspect(null);
                    setPicking('watchB');
                    return;
                  }
                  void beginExhibition(watchA ?? chosen.id, chosen.id);
                }}
              >
                {picking === 'tournament'
                  ? busy === 'tournament'
                    ? 'Drawing the bracket…'
                    : `Enter as ${chosen.name.split(' ')[0]}`
                  : picking === 'watchA'
                    ? `${chosen.name.split(' ')[0]} takes the field`
                    : busy === 'spectate'
                      ? 'Taking your seat…'
                      : `Watch ${watchAName.split(' ')[0]} vs ${chosen.name.split(' ')[0]}`}
              </button>
            </div>
          </div>
        )}

        {error && (
          <p className="rounded border border-oxblood bg-[#2a1216]/70 px-3 py-2 text-xs text-[#f0c9cc]">{error}</p>
        )}

        <button
          className="btn mx-auto rounded px-4 py-2 text-xs"
          onClick={() => {
            // From the second seat, back means re-choosing the first — not
            // abandoning the whole idea of watching.
            if (picking === 'watchB') {
              setPickedId(watchA);
              setWatchA(null);
              setPicking('watchA');
              return;
            }
            setPicking(null);
          }}
          disabled={busy !== null}
        >
          Back
        </button>

        {deckViewer()}
      </main>
    );
  }

  return (
    <main className="safe-page mx-auto flex min-h-[100dvh] w-full max-w-5xl flex-col items-center justify-center gap-6 p-5">
      <div className="text-center">
        {/* The "Duelist Kingdom" eyebrow is gone by the owner's request — here,
            over the duelist picker, on the bracket, in the lobby subtitle, and
            in the page and app metadata. The game is called Shadow Duel. */}
        <h1 className="font-display text-5xl leading-none tracking-wide text-brassbright sm:text-7xl">
          Shadow Duel
        </h1>
        <div className="brass-rule mx-auto my-4 w-56" />
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
          disabled={busy !== null || !ready}
        >
          {!ready ? 'Waking the arena…' : busy === 'create' ? 'Opening the arena…' : 'Start a new duel'}
        </button>

        <div className="my-4 flex items-center gap-3">
          <div className="brass-rule flex-1" />
          <span className="font-display text-[10px] uppercase tracking-widest text-ptextdim">or begin the story</span>
          <div className="brass-rule flex-1" />
        </div>

        {/* Story Mode signs in under its own name and keeps its own save, so it
            deliberately ignores the name field above and asks again on arrival.
            A plain navigation rather than an `openRoom` call: there is no duel
            room behind it, and there may never be one. */}
        <button
          className="btn btn-primary w-full rounded px-4 py-3 text-sm"
          onClick={() => {
            primeAudio();
            sfx.click();
            setBusy('story');
            router.push('/story');
          }}
          disabled={busy !== null || !ready || story.phase !== 'ready'}
        >
          {busy === 'story'
            ? 'Signing in…'
            : story.phase === 'code'
              ? 'Loading the world…'
              : story.phase === 'cast'
                ? `Loading the cast… ${Math.round(story.pct * 100)}%`
                : story.phase === 'parse'
                  ? 'Preparing the cast…'
                  : 'Enter Story Mode'}
        </button>

        <div className="my-4 flex items-center gap-3">
          <div className="brass-rule flex-1" />
          <span className="font-display text-[10px] uppercase tracking-widest text-ptextdim">or play alone</span>
          <div className="brass-rule flex-1" />
        </div>

        <button className="btn mt-1 w-full rounded px-4 py-3 text-sm" onClick={soloDuel} disabled={busy !== null || !ready}>
          {busy === 'solo' ? 'Shuffling…' : 'Duel the computer'}
        </button>

        <button className="btn mt-2 w-full rounded px-4 py-3 text-sm" onClick={watch} disabled={busy !== null || !ready}>
          {busy === 'spectate' ? 'Taking your seat…' : 'Watch the computers duel'}
        </button>

        <button
          className="btn btn-primary mt-2 w-full rounded px-4 py-3 text-sm"
          onClick={tournament}
          disabled={busy !== null || !ready}
        >
          {busy === 'tournament' ? 'Drawing the bracket…' : '🏆 Enter the tournament'}
        </button>

        <div className="my-4 flex items-center gap-3">
          <div className="brass-rule flex-1" />
          <span className="font-display text-[10px] uppercase tracking-widest text-ptextdim">or join</span>
          <div className="brass-rule flex-1" />
        </div>

        <div className="flex gap-2">
          <input
            ref={codeRef}
            value={code}
            /* Five, not four. `createRoom` falls back to a five-character code
               once eight four-character draws have all been taken — and this
               field physically could not accept one, so that room was
               reachable by its link and by nothing else. */
            maxLength={5}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void join();
            }}
            placeholder="CODE"
            className="w-full rounded border border-stoneline bg-black/45 px-3 py-2 text-center font-display text-2xl tracking-[0.4em] text-parchment outline-none focus:border-brass"
          />
          <button className="btn shrink-0 rounded px-5 text-xs" onClick={join} disabled={busy !== null || !ready}>
            {busy === 'join' ? '…' : 'Join'}
          </button>
        </div>

        {error && (
          <p className="mt-3 rounded border border-oxblood bg-[#2a1216]/70 px-3 py-2 text-xs text-[#f0c9cc]">{error}</p>
        )}

        <p className="mt-4 text-center text-[11px] leading-relaxed text-ptextdim">
          {/* Not "4-letter": a code is drawn from letters *and* digits, and
              runs to five characters if the first eight draws are taken. */}
          Start a duel, then send the link or the room code to your opponent — the game begins once you have both
          picked a duelist. Or take on the computer straight away, no second player needed.
        </p>
      </div>

      {/* duelist strip */}
      <div className="w-full">
        <p className="mb-2 text-center font-display text-[10px] uppercase tracking-[0.3em] text-ptextdim">
          {/* Counted, and therefore wrong: it said ten while the roster was
              eleven, and it would go stale again with the next duelist. */}
          The duelists · their decks
        </p>
        <div className="thin-scroll flex justify-start gap-2 overflow-x-auto pb-2 sm:justify-center">
          {/* Tapping a duelist opens their deck. The strip looked like a menu
              and behaved like a picture, which is the worst of both — the same
              viewer the picker already uses is one line away. */}
          {/* The roster, and then whoever walks the world with a deck of their
              own — last, after the duelists, and only once they have one. */}
          {shelf.map((d) => (
            <button
              key={d.id}
              type="button"
              data-deck={d.id}
              className="group w-[92px] shrink-0 text-center"
              title={`${d.name} — ${d.note}. See the deck.`}
              onClick={() => {
                sfx.click();
                setDeckOpen(d.id);
              }}
            >
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
            </button>
          ))}
        </div>
      </div>

      {deckViewer()}
    </main>
  );
}
