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

import { reloadIntoFresh, staleBuild } from '@/lib/freshBuild';
import { useEffect, useRef, useState } from 'react';
import { RESUME_KEY } from '@/lib/staleBuild';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import DeckBuilder from '@/components/story/DeckBuilder';
import DeckLab from '@/components/story/DeckLab';
import PackOpening from '@/components/story/PackOpening';
import Shop from '@/components/story/Shop';
import { deckIsShort, shopStock } from '@/story/shop';
import type { PackResult } from '@/story/packs';
import { DUELIST_BY_ID } from '@/game/cards';
import type { StoryProfile, StoryStage, WorldPosition } from '@/story/profile';
import { DECK_SIZE, STARTER_POOL } from '@/story/roster';
import type { PremadeCharacter } from '@/story/premade';
import type { WorldNpc } from '@/story/npcs';
import { saveIdentity } from '@/lib/useDuelRoom';
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
  /**
   * The deck bench, open on the sign-in screen and nowhere else.
   *
   * Behind the same gate as the world and for the same reason — it is only
   * useful to whoever is writing the game — but it is *not* a stage: the world
   * is never built, no profile is set, nothing is saved, and closing it comes
   * straight back to this screen with the name still typed.
   */
  const [labOpen, setLabOpen] = useState(false);
  const [profile, setProfile] = useState<StoryProfile | null>(null);
  const [screen, setScreen] = useState<Screen | null>(null);
  /**
   * A conversation to walk straight back into.
   *
   * Read once, on the way in, and cleared immediately: coming back from a duel
   * should resume the conversation exactly once, and a note left in place would
   * reopen Mai every time the world mounted for the rest of the session.
   */
  /**
   * The duel just returned from, read exactly once.
   *
   * One read, not three. The note is consumed — `writePendingDuel(null)` — by
   * whoever looks at it first, so two `useState` initialisers both calling
   * `readPendingDuel` meant the second always saw nothing: the conversation
   * resumed and the pack was silently never claimed. Everything that needs the
   * note is derived from this one value.
   */
  const [returned] = useState<PendingDuel | null>(() => {
    if (typeof window === 'undefined') return null;
    const pending = readPendingDuel();
    if (!pending?.outcome) return null;
    writePendingDuel(null);
    return pending;
  });
  /**
   * The other half of the road back, which does not depend on the note.
   *
   * `sessionStorage` is the note's home and on one phone it was not there when
   * the world came back — the sign-in card was, and then the first field. So
   * the save itself now says "in a duel with Sarah" (see `DuelInProgress`),
   * `login` brings it back with the room's verdict, and a mark in
   * `localStorage` is enough to know, on arrival, that this is a return and
   * not a cold visit: sign in without asking, and resume off the save.
   */
  const [walkingBack] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try { return window.localStorage.getItem(MIRROR) === '1'; } catch { return false; }
  });
  /**
   * A conversation to walk straight back into.
   *
   * Cleared once used: coming back from a duel should resume the conversation
   * exactly once, and a note left in place would reopen the character every time
   * the world mounted for the rest of the session.
   */
  const [resume, setResume] = useState<{ npcId: string; node: string; wagered?: string } | null>(() =>
    returned
      ? { npcId: returned.npcId, node: returned.outcome === 'won' ? returned.won : returned.lost, wagered: returned.wagered }
      : null
  );
  /**
   * The room a win still owes a pack for.
   *
   * Losing does not set this: for now a loss is just the rest of the
   * conversation, which is what the brief asks for until penalties exist.
   */
  const [owed, setOwed] = useState<{ code: string; token: string } | null>(() =>
    returned?.outcome === 'won' && returned.code && returned.token
      ? { code: returned.code, token: returned.token }
      : null
  );
  /** True while Solomon's counter is open over the world. */
  const [shopping, setShopping] = useState(false);
  /** The pack being opened, and who it came off. */
  const [pack, setPack] = useState<{ result: PackResult; from: string } | null>(null);
  /**
   * The pack could not be fetched, so stop waiting for it.
   *
   * Only ever set by a failed open. It exists because the conversation now
   * waits on the pack (see `packFirst`), and a wait with no way out is a
   * conversation that never opens: offline on the way back would otherwise
   * leave the player standing in front of somebody who has nothing to say. The
   * pack itself is not lost — it stays banked on the profile and opens on the
   * next visit, which is what it did before any of this.
   */
  const [packLost, setPackLost] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  /* Same trick as the home page: both fields are controlled, so React's first
     commit after hydration would otherwise wipe whatever was typed during a
     slow start. Whatever is in the field at that moment wins. */


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

  /**
   * `as` is for the resume above, which runs inside the same effect that sets
   * `name` — so the state it would otherwise read has not landed yet.
   */
  /**
   * One at a time, and not one per caller.
   *
   * `busy` is state, so it is not true until the next render — which is no
   * guard at all against two calls in the same tick. There are three ways in
   * now (the button, a rescue reload, and a session that has already signed in
   * once), and two of them can land together: the effect fires on mount while a
   * finger is already on the button. Two logins meant two profiles, two world
   * mounts and two WebGL contexts rendering the same city, which pinned nine
   * cores and never settled — `npm run doors` hung on the second door of every
   * area it tried.
   */
  const signingIn = useRef(false);
  const signIn = async (as?: string) => {
    if (signingIn.current) return;
    signingIn.current = true;
    setBusy(true);
    setError(null);
    primeAudio();
    sfx.click();
    const res = await post<{ profile: StoryProfile; stage: StoryStage }>('/api/story/login', { username: as ?? name });
    setBusy(false);
    if (!res.ok) {
      signingIn.current = false;
      sfx.error();
      setError(res.error);
      return;
    }
    try {
      window.localStorage.setItem(NAME_KEY, res.data.profile.username);
    } catch {
      /* private browsing — they will type it again next time */
    }
    /* Off the save, in the same render as the world mounts — `OpenWorld` reads
       `resume` once, on the way in. A loss resumes too; only a win owes. */
    const back = res.data.profile.pendingDuel;
    if (back?.outcome) {
      setResume({ npcId: back.npcId, node: back.outcome === 'won' ? back.won : back.lost, wagered: back.wagered });
      if (back.outcome === 'won') setOwed({ code: back.code, token: back.token });
    }
    try { window.localStorage.removeItem(MIRROR); } catch { /* private browsing */ }
    setProfile(res.data.profile);
    setScreen(res.data.stage);
  };

  /**
   * The same door as Story Mode, opening on a different room.
   *
   * The gate is the server's, not a name checked twice: `/api/story/login` is
   * what decides who is admitted, so asking it is the only way to be sure this
   * screen and that one agree. What is thrown away is the answer — the profile
   * and the stage are not set, so no world is built and nothing is resumed.
   */
  const openLab = async () => {
    if (signingIn.current) return;
    signingIn.current = true;
    setBusy(true);
    setError(null);
    primeAudio();
    sfx.click();
    const res = await post<{ profile: StoryProfile; stage: StoryStage }>('/api/story/login', { username: name });
    setBusy(false);
    signingIn.current = false;
    if (!res.ok) {
      sfx.error();
      setError(res.error);
      return;
    }
    setLabOpen(true);
  };

  useEffect(() => {
    const typed = nameRef.current?.value ?? '';
    let remembered = '';
    try {
      remembered = window.localStorage.getItem(NAME_KEY) ?? '';
    } catch {
      /* private browsing */
    }
    const who = typed || remembered;
    setName(who);
    primeAudio();
    setReady(true);

    /*
     * Carrying on after a rescue reload.
     *
     * `StaleBuild` reloads the page when a chunk from a replaced build has gone.
     * That fixes the build and loses every scrap of state with it, so Story Mode
     * comes back on its sign-in card — name already in the box — asking the
     * player who they are in the middle of something they were already doing.
     * Pressing Save across a deploy looked exactly like being thrown out, and
     * this is the half of it that is not about the bundle.
     *
     * The flag is written by that reload and by nothing else, and is consumed
     * the first time it is seen. Signing in the ordinary way is untouched:
     * this is not auto-sign-in, it is a session picking itself back up.
     *
     * It goes here rather than in an effect of its own because "once, on
     * arrival" is what this effect already is — and because signing in from a
     * second effect is a setState cascade, which is a real complaint and not
     * one to silence.
     */
    let carryOn = false;
    try {
      carryOn = window.sessionStorage.getItem(RESUME_KEY) === '1';
      if (carryOn) window.sessionStorage.removeItem(RESUME_KEY);
    } catch {
      /* private browsing — they type it again, exactly as before */
    }
    /*
     * Signing in on the way back from the main menu was tried here and taken
     * out again.
     *
     * The idea was sound — walking out to the menu and back is not a cold visit
     * and should not ask your name — but the world starts building the moment a
     * profile lands, which with an automatic sign-in is before the cast has
     * finished coming down: entry went from five seconds to thirty-two, and
     * every browser check that enters the world more than once started timing
     * out. One button press is a small price; half a minute of staring at a
     * loading line is not, and neither is a check that cannot be trusted.
     *
     * The name is still in the box. What is left to do is press the button.
     */
    if (carryOn && who) void signIn(who);
    /* And if this page is a build behind, into the current one, once: the
       resume flag above is what that reload sets, so it signs itself back
       in. A page that is current, or cannot tell, carries on. */
    if (!carryOn) void staleBuild().then((stale) => { if (stale) reloadIntoFresh('/story'); });
    /* Mount only. It sits below `signIn` rather than above it so that call is
       to something already declared — the order in this file is load-bearing. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  /**
   * A win owes a pack: claim it, then open it.
   *
   * Two calls rather than one because they are two different promises. The claim
   * is "this room owed me something" and is settled against the room itself, so
   * it can only ever pay out once however many times this effect runs. The open
   * is "give me what is in the next pack", and is a separate step so that a pack
   * survives a tab closing between winning and pulling.
   *
   * Failure is deliberately quiet. The pack is already banked on the profile by
   * the time opening can fail, so the worst case is that it opens the next time
   * the world loads — and a red banner over a conversation the player is walking
   * back into would be a worse trade than a silent retry later.
   */
  /**
   * A win owes a pack: claim it.
   *
   * Only claims. Opening is the effect below, which runs on *any* unopened pack
   * rather than only on one just claimed — the two were one effect at first and
   * it stranded packs: claiming a room that had already paid out returns
   * `awarded: false`, so a pack banked by an interrupted visit was never opened
   * and there was no other code that would ever open it.
   *
   * A ref, and nothing cancels. The first version aborted its own work in the
   * effect cleanup while depending on state it set itself, so it tore down
   * between claiming and opening and the player saw nothing at all.
   */
  const claiming = useRef(false);
  useEffect(() => {
    if (!owed || !profile || claiming.current) return;
    claiming.current = true;
    const claim = owed;
    const username = profile.username;
    void (async () => {
      try {
        const res = await fetch('/api/story/pack', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'claim', username, code: claim.code, token: claim.token }),
          cache: 'no-store',
        });
        const got = (await res.json()) as { ok?: boolean; profile?: StoryProfile };
        if (got.profile) setProfile(got.profile);
      } catch {
        /* Offline on the way back; the room keeps owing until it is asked again. */
      } finally {
        setOwed(null);
      }
    })();
  }, [owed, profile]);

  /**
   * Any unopened pack opens as soon as the player is standing in the world.
   *
   * Independent of how it got there, which is the point: won just now, banked by
   * a visit that was interrupted, or handed over by something that does not
   * exist yet. A pack on the profile is a promise, and this is what keeps it.
   */
  const opening = useRef(false);
  useEffect(() => {
    if (!profile || pack || opening.current) return;
    if (screen !== 'world' || !profile.packs.length) return;
    opening.current = true;
    const username = profile.username;
    void (async () => {
      try {
        const res = await fetch('/api/story/pack', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'open', username }),
          cache: 'no-store',
        });
        const out = (await res.json()) as { ok?: boolean; pack?: PackResult; profile?: StoryProfile };
        if (out.profile) setProfile(out.profile);
        if (!out.ok || !out.pack) return;
        setPack({
          result: out.pack,
          from: DUELIST_BY_ID[out.pack.duelistId]?.name ?? 'That duelist',
        });
      } catch {
        /* It stays on the profile and opens next time — and the conversation
           stops waiting for it, because it is not coming this visit. */
        setPackLost(true);
      } finally {
        opening.current = false;
      }
    })();
  }, [profile, pack, screen]);

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

  /**
   * Takes a character up on a duel.
   *
   * The room is opened here rather than in the world because this is the screen
   * that owns the username, and the deck is never sent — the server reads it off
   * the save, which is the only copy that knows which cards this player actually
   * owns. The note is written *before* navigating, so the win screen can find it
   * however the player gets there.
   */
  const startDuel = async (npc: WorldNpc, stake?: number, wager?: string) => {
    if (!npc.duel || busy) return;
    setBusy(true);
    sfx.click();
    try {
      const res = await fetch('/api/room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storyUser: name,
          opponentId: npc.duel.opponentId,
          /* What the player said they were putting up. The server clamps it
             into the character's own range and takes it from the save before
             the room exists; this is a request, not a figure. */
          stake,
          /* The card the player put on the table, for the one duelist who asks
             for one. A slug the save does not hold is refused by the route. */
          wager,
          npcId: npc.id,
          won: npc.duel.won,
          lost: npc.duel.lost,
        }),
        cache: 'no-store',
      });
      const data = (await res.json()) as { code?: string; token?: string; error?: string };
      if (!data.code || !data.token) {
        setError(data.error ?? 'Could not start that duel. Try again in a moment.');
        setBusy(false);
        return;
      }
      saveIdentity({ code: data.code, token: data.token });
      writePendingDuel({
        code: data.code,
        token: data.token,
        npcId: npc.id,
        won: npc.duel.won,
        lost: npc.duel.lost,
        wagered: wager,
      });
      try { window.localStorage.setItem(MIRROR, '1'); } catch { /* private browsing */ }
      router.push(`/duel/${data.code}`);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setBusy(false);
    }
  };

  /**
   * Coming back from a duel goes straight into the world.
   *
   * The duel is a different page, so returning re-mounts this one from nothing
   * and it showed the sign-in screen — asking a player who has been playing for
   * an hour to type their name again, in the middle of a conversation they are
   * halfway through. The name is already known and the note proves where they
   * came from, so the sign-in is skipped rather than pre-filled.
   *
   * Only on a return. A cold visit still signs in by hand, because that is the
   * one moment the name is a question rather than an answer.
   */
  const walkedBackIn = useRef(false);
  useEffect(() => {
    if (!ready || !(returned || walkingBack) || walkedBackIn.current) return;
    if (profile || busy || !name) return;
    walkedBackIn.current = true;
    /* Deferred a tick rather than called straight out: `signIn` sets state on its
       first line, and setting state synchronously inside an effect makes React
       re-render before this one has finished committing. The same
       `queueMicrotask` the world uses when it has to report a dead WebGL context
       from inside setup.

       `signIn` is not in the deps on purpose: it is re-created every render, and
       the ref above already guarantees this fires once. */
    queueMicrotask(() => void signIn());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, returned, walkingBack, profile, busy, name]);

  /**
   * And once the world has the conversation back, the save is told so —
   * otherwise every sign-in for the rest of time would resume it.
   */
  const settled = useRef<string | null>(null);
  useEffect(() => {
    const pending = profile?.pendingDuel;
    if (!profile || !pending?.outcome || screen !== 'world' || settled.current === pending.code) return;
    settled.current = pending.code;
    const username = profile.username;
    void (async () => {
      const res = await post<{ profile: StoryProfile }>('/api/story/save', { username, duelDone: true });
      if (res.ok && res.data.profile) setProfile(res.data.profile);
    })();
  }, [profile, screen]);

  /**
   * Buys one card, and returns what Solomon should say — or null when it worked.
   *
   * The wording lives here rather than in the route because a refusal is a
   * shopkeeper turning you down, not a status code. He never explains *why* a
   * second copy is impossible; he simply will not do it.
   */
  const buyCard = async (slug: string): Promise<string | null> => {
    const res = await post<{ bought?: boolean; refusal?: string; profile: StoryProfile }>(
      '/api/story/shop',
      { username: name, slug }
    );
    if (!res.ok) return res.error;
    if (res.data.profile) setProfile(res.data.profile);
    if (res.data.bought) return null;
    switch (res.data.refusal) {
      case 'owned':
        return 'You have got one of those already. I am not selling you another.';
      case 'poor':
        return 'Come back when your pockets are heavier.';
      default:
        return 'I do not have that. Not today.';
    }
  };

  const toMenu = () => router.push('/');

  /* ---------------- sign in ---------------- */

  if (!profile || !screen) {
    /* The bench sits in front of the sign-in rather than replacing it: closing
       it comes back here with the name still in the box. */
    if (labOpen) return <DeckLab onClose={() => setLabOpen(false)} />;
    /* Coming back from a duel is not a visit: no card, no question, until the
       sign-in has actually failed and the name is a question again. */
    if ((returned || walkingBack) && !error) return <Waiting line="Walking back in" />;
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
            /* Wrapped, not passed: `signIn` takes an optional name and a click
               handler is handed a MouseEvent, which would arrive as the name. */
            onClick={() => void signIn()}
            disabled={busy || !ready || !name.trim()}
          >
            {!ready ? 'Waking the arena…' : busy ? 'Signing in…' : 'Enter Story Mode'}
          </button>

          {/* The bench. Same gate, no world: it is for building a deck to hand
              to somebody who is not you. */}
          <button
            className="btn mt-2 w-full rounded px-4 py-2.5 text-xs"
            onClick={() => void openLab()}
            disabled={busy || !ready || !name.trim()}
          >
            Deck Lab
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
    /* A deck a card short has no way back to the world: the only door out of
       the builder is a twenty-five-card deck. See the effect in `OpenWorld`
       that opened it, and `CARD_WAGER` for the one way a deck gets short. */
    const short = deckIsShort(profile);
    return (
      <DeckBuilder
        pool={profile.collection}
        initial={profile.deck ?? []}
        first={false}
        fresh={profile.fresh}
        notice={short ? `Your deck is ${profile.deck?.length ?? 0} cards. Sleeve ${DECK_SIZE} before you duel again.` : undefined}
        onConfirm={saveDeck}
        onCancel={short ? undefined : () => setScreen('world')}
        /*
         * Posted with the position, which is the only reason this needs no
         * route of its own: `save` already writes the profile under the same
         * revision guard, so a card being marked seen cannot lose a race with
         * anything else writing at the same moment.
         *
         * Fire and mostly forget. If it fails the badges are still up next
         * time, which is exactly what should happen when the note never
         * arrived — so there is nothing to tell the player and nothing to
         * retry.
         */
        onSeen={(slugs) => {
          void post<{ profile: StoryProfile }>('/api/story/save', { username: name, seen: slugs }).then(
            (res) => {
              if (res.ok && res.data.profile) setProfile(res.data.profile);
            }
          );
        }}
      />
    );
  }

  /*
   * The pack happens first, and the conversation waits behind it.
   *
   * Mike's note: the opening was a modal with the duelist's aftermath lit
   * underneath it, so the win and the reaction to it were on screen together
   * and neither had the player's attention. The pack is its own screen now —
   * and being its own screen is only half of it, because a conversation that
   * is merely *covered* is still a conversation that opened first.
   *
   * So this is the whole window a pack occupies, from before it exists to
   * after it has been read:
   *
   * - `owed` — a win landed and the claim is in flight. Held from the first
   *   frame, which is the point: the resume note is handed to the world on
   *   mount, and anything decided a round trip later shows the conversation
   *   for a moment and then buries it.
   * - `packs` on the profile — claimed and banked, waiting for the open. Also
   *   covers a pack left over from a visit that was interrupted.
   * - `pack` — it is on screen, being turned over.
   *
   * A loss owes nothing, so `owed` is null and none of this applies: the
   * duelist tells you what you did wrong immediately, as before. A win against
   * somebody who keeps their cards (Solomon, Ash) holds only for the length of
   * the claim, which is shorter than the area takes to build.
   */
  const packFirst = !!pack || !!owed || (profile.packs.length > 0 && !packLost);

  return (
    <>
      {pack && (
        <PackOpening pack={pack.result} from={pack.from} onDone={() => setPack(null)} />
      )}
      {shopping && (
        <Shop
          profile={profile}
          stock={shopStock()}
          onBuy={buyCard}
          onClose={() => setShopping(false)}
        />
      )}
      <OpenWorld
      profile={profile}
      onEditDeck={() => setScreen('editDeck')}
      onSave={saveWorld}
      onDelete={deleteCharacter}
      onExit={toMenu}
      onDuel={startDuel}
      onShop={() => setShopping(true)}
      resume={resume}
      /* Hold the aftermath until the pack has been opened — see `packFirst`. */
      hold={packFirst}
      /* Read exactly once. The comment above this state says "cleared once
         used" and for months nothing cleared it, which is why a conversation
         you had ended came back every time you closed the deck builder: the
         world is unmounted by every other screen and rebuilt from this note. */
      onResumed={() => setResume(null)}
      /* Somebody has been met. Posted with the same route and the same
         revision guard as a position or a looked-at card, and not waited on:
         the world has already moved that character to their short greeting,
         and a note that never lands costs one repeated introduction. */
      onMet={(npcId) => {
        void post<{ profile: StoryProfile }>('/api/story/save', { username: profile.username, met: [npcId] }).then(
          (res) => {
            if (res.ok && res.data.profile) setProfile(res.data.profile);
          }
        );
      }}
    />
    </>
  );
}

/**
 * Where a duel started from a conversation leaves its note.
 *
 * `sessionStorage`, not the save: this is one leg of one visit — who to walk
 * back to and which node to resume on — and it is meaningless the moment the
 * tab is closed. Putting it in the profile would mean a write to the database
 * on the way into every duel and a second on the way out, to store something
 * that is only true for the next ninety seconds.
 */
const PENDING = 'story:duel';
/** Set on the way into a duel, cleared on the way back: "this is a return". */
const MIRROR = 'story:duel-mirror';

export interface PendingDuel {
  /** The room the duel is being played in, so a stale note can be told apart. */
  code: string;
  /**
   * The seat token, carried so the pack can be claimed on the way back.
   *
   * The server will not award a pack on the client's word that it won — it
   * reads the room and decides — so the claim has to prove which seat is asking.
   */
  token: string;
  npcId: string;
  /** Which node to resume on, per outcome. */
  won: string;
  lost: string;
  /** Filled in by the win screen on the way back. */
  outcome?: 'won' | 'lost';
  /** The card put on the table, if the duel was played for one. */
  wagered?: string;
}

export function readPendingDuel(): PendingDuel | null {
  try {
    const raw = sessionStorage.getItem(PENDING);
    return raw ? (JSON.parse(raw) as PendingDuel) : null;
  } catch {
    return null;
  }
}

export function writePendingDuel(v: PendingDuel | null): void {
  try {
    if (v) sessionStorage.setItem(PENDING, JSON.stringify(v));
    else sessionStorage.removeItem(PENDING);
  } catch {
    /* Private browsing with storage disabled. The duel still plays; it just
       ends at the arena rather than back in the field, which is a worse
       journey and not a broken one. */
  }
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
